/**
 * Shared plumbing for the API's integration lane.
 *
 * The Nest application is built from the real `AppModule` and listens on an
 * ephemeral port, so every request below travels the whole stack: the session
 * guard, the throttler, the pipes, the filter, Prisma, Postgres, Redis. Nothing
 * is mocked, because what this lane exists to catch -- a guard that is not
 * default-closed, a budget that limits the wrong routes -- is a failure of the
 * wiring rather than of a pure function, and the pure functions already have
 * their own tests.
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { createPrismaClient, type PrismaClient } from '@cms/db';
import type { Role, SessionUser } from '@cms/shared';
import { hashPassword, mintServiceToken } from '@cms/shared/server';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Redis } from 'ioredis';

import { AppModule } from '../src/app.module';
import { JSON_BODY_LIMIT_BYTES } from '../src/config/boot';

export const AUTH_SECRET = required('AUTH_SECRET', process.env.AUTH_SECRET);
export const DATABASE_URL = required('DATABASE_URL', process.env.DATABASE_URL);
export const REDIS_URL = required('REDIS_URL', process.env.REDIS_URL);

function required(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set. Run this through ./scripts/integration.sh.`);
  }
  return value;
}

export interface Harness {
  readonly app: INestApplication;
  readonly base: string;
  /** Test setup and assertions only, never the code under test. */
  readonly db: PrismaClient;
  readonly redis: Redis;
  close(): Promise<void>;
}

export async function boot(): Promise<Harness> {
  // The same body parser and proxy trust main.ts sets up, so the harness runs
  // the program that ships.
  const app = await NestFactory.create<
    INestApplication & {
      set(key: string, value: unknown): void;
      useBodyParser(type: string, options: { limit: number }): void;
    }
  >(AppModule, { logger: ['error'], bodyParser: false });
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT_BYTES });
  app.set('trust proxy', 1);
  app.enableShutdownHooks();
  await app.listen(0, '127.0.0.1');

  const server = app.getHttpServer() as { address(): AddressInfo | string | null };
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('the API did not bind a port');

  const db = createPrismaClient({ url: DATABASE_URL });
  const redis = new Redis(REDIS_URL);
  return {
    app,
    base: `http://127.0.0.1:${String(address.port)}`,
    db,
    redis,
    close: async () => {
      await db.$disconnect();
      redis.disconnect();
      await app.close();
    },
  };
}

/**
 * A fresh user for a test, with a real password hash so sign-in can be
 * exercised. Signed-in calls are rate-limited per user, so a user per suite
 * keeps this lane at the DOCUMENTED budgets without borrowing another suite's
 * minute.
 */
export async function newUser(
  db: PrismaClient,
  label: string,
  role: Role = 'AUTHOR',
  password = 'integration-password-2026',
): Promise<SessionUser & { password: string }> {
  const email = `${label}-${randomUUID().slice(0, 8)}@cms.test`;
  const row = await db.user.create({
    data: { email, name: label, role, passwordHash: hashPassword(password) },
    select: { id: true },
  });
  return { id: row.id, email, name: label, role, password };
}

export interface Reply<T = unknown> {
  readonly status: number;
  readonly body: T;
  readonly headers: Headers;
  readonly text: string;
}

/** A private address, random per call, so per-address budgets never leak between tests. */
export function randomAddress(): string {
  const octet = () => String(1 + Math.floor(Math.random() * 254));
  return `10.${octet()}.${octet()}.${octet()}`;
}

/**
 * One request.
 *
 * The token is minted per call rather than cached: a cached one works for two
 * minutes and then fails for the rest of the run, and that looks like
 * flakiness. `user: null` sends no `Authorization` header, which is how the
 * default-closed guard and the public routes are exercised. Anonymous calls get
 * a fresh `x-forwarded-for` each unless `address` pins one, so per-address
 * budgets do not leak between tests.
 */
export async function call<T = unknown>(
  harness: Harness,
  method: string,
  path: string,
  options: { user?: SessionUser | null; body?: unknown; secret?: string; address?: string } = {},
): Promise<Reply<T>> {
  const headers: Record<string, string> = { 'x-forwarded-for': options.address ?? randomAddress() };
  if (options.user !== null && options.user !== undefined) {
    headers.authorization = `Bearer ${mintServiceToken(options.user, options.secret ?? AUTH_SECRET)}`;
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${harness.base}${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  let body: unknown = undefined;
  try {
    body = text === '' ? undefined : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body: body as T, headers: response.headers, text };
}
