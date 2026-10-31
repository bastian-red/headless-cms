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
      // The posts this suite made go with it (their revisions, documents and
      // redirects cascade), so live fixtures do not pile up across runs and
      // grow every crawl of the content API past its per-key budget.
      // Matched by author as well as by id: a test that creates a post
      // through the API itself (posts.test.ts checks the slug derived from a
      // title) never passes through newPost, and only the author is certain.
      await db.post.deleteMany({
        where: {
          OR: [{ id: { in: created.splice(0) } }, { authorId: { in: users.splice(0) } }],
        },
      });
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
/** Every user `newUser` made in this process: `close()` removes their posts. */
const users: string[] = [];

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
  users.push(row.id);
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
  options: {
    user?: SessionUser | null;
    body?: unknown;
    secret?: string;
    address?: string;
    /** A raw bearer credential (a content API key). Overrides `user`. */
    bearer?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<Reply<T>> {
  const headers: Record<string, string> = {
    'x-forwarded-for': options.address ?? randomAddress(),
    ...options.headers,
  };
  if (options.bearer !== undefined) {
    headers.authorization = `Bearer ${options.bearer}`;
  } else if (options.user !== null && options.user !== undefined) {
    headers.authorization = `Bearer ${mintServiceToken(options.user, options.secret ?? AUTH_SECRET)}`;
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${harness.base}${path}`, {
    method,
    headers,
    // A 308 is an answer under test, not something to follow.
    redirect: 'manual',
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

/** A content API key, made the way the studio makes one (through the API). */
export async function newApiKey(
  harness: Harness,
  admin: SessionUser,
  name = 'integration',
): Promise<string> {
  const r = await call<{ key: string }>(harness, 'POST', '/studio/api-keys', {
    user: admin,
    body: { name },
  });
  if (r.status !== 201) throw new Error(`could not create an API key: ${r.status} ${r.text}`);
  return r.body.key;
}

export interface PostReply {
  id: string;
  slug: string;
  status: string;
  live: boolean;
  headRevisionId: string;
  publishedRevisionId: string | null;
  publishedAt: string | null;
  scheduledFor: string | null;
  transitions: string[];
  head: { id: string; number: number; title: string; body: string; tags: { slug: string }[] };
}

/** Every post `newPost` made in this process, deleted by `close()`. */
const created: string[] = [];

/** A post with a unique slug, created through the studio API. */
export async function newPost(
  harness: Harness,
  author: SessionUser,
  fields: Record<string, unknown> = {},
): Promise<PostReply> {
  const r = await call<PostReply>(harness, 'POST', '/studio/posts', {
    user: author,
    body: {
      title: 'Integration post',
      slug: `it-${randomUUID().slice(0, 8)}`,
      excerpt: 'An excerpt.',
      body: '## Hello\n\nA body.',
      ...fields,
    },
  });
  if (r.status !== 201) throw new Error(`could not create a post: ${r.status} ${r.text}`);
  created.push(r.body.id);
  return r.body;
}

/** One workflow transition from the head the caller last saw. */
export function transition(
  harness: Harness,
  user: SessionUser,
  post: Pick<PostReply, 'id' | 'headRevisionId'>,
  action: string,
  extra: Record<string, unknown> = {},
) {
  return call<PostReply>(harness, 'POST', `/studio/posts/${post.id}/transitions`, {
    user,
    body: { action, revisionId: post.headRevisionId, ...extra },
  });
}

/**
 * Every route the Express router actually serves, as `METHOD /path`, read
 * from the running app rather than from a list someone keeps. The coverage
 * checks compare their own tables against this, so a route added without a
 * row in them fails the lane.
 */
export function routes(harness: Harness): string[] {
  const express = harness.app.getHttpAdapter().getInstance() as {
    _router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
  };
  return express._router.stack
    .flatMap((layer) =>
      layer.route === undefined
        ? []
        : Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${layer.route!.path}`),
    )
    .sort();
}
