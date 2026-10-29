/**
 * Every environment variable the API reads, parsed once, at the edge.
 *
 * Not `@nestjs/config`. That module makes `configService.get('FOO')` reachable
 * from everywhere, which is the problem rather than the feature: a typo is
 * `undefined` at a call site three layers below the boot, and the failure arrives
 * as a request that 500s instead of a process that refused to start. One typed
 * object, built here, injected as a value.
 *
 * **Every read is spelled `env.NAME` literally.** `scripts/env-contract.mjs`
 * finds the names this process needs by scanning the source for that shape and
 * checks them against `turbo.json` and `.env.example` in all four directions. A
 * computed lookup -- `env[name]` -- is invisible to it, and turbo 2 runs in
 * strict env mode, so an undeclared name is stripped silently rather than
 * reported. The gate would then have to be weakened to stay green, which is how
 * a check stops meaning anything.
 *
 * `PORT` before `API_PORT`, matching what every container runtime injects. `.env.example` ships `PORT` empty because a
 * host running `pnpm dev` needs the two services on different ports.
 */
import { z } from 'zod';

const port = z
  .string()
  .trim()
  .regex(/^\d+$/u, 'must be a whole number')
  .transform(Number)
  .pipe(z.number().int().min(1).max(65535));

/** An absolute http(s) URL. The protocol check is the load-bearing half. */
const httpUrl = z
  .string()
  .trim()
  .url()
  .refine(
    (value) => value.startsWith('http://') || value.startsWith('https://'),
    'must be an http:// or https:// URL',
  );

const positiveInt = z
  .string()
  .trim()
  .regex(/^\d+$/u, 'must be a whole number')
  .transform(Number)
  .pipe(z.number().int().positive());

export interface ApiConfig {
  nodeEnv: string;
  appVersion: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  authSecret: string;
  /** Where this API reaches the publisher for GET /status. */
  publisherInternalUrl: string;
  rateLimitGlobal: number;
  rateLimitAuth: number;
  rateLimitComment: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Config key back to the variable name a reader can grep for. Written out per key. */
const ENV_NAMES: Record<string, string> = {
  nodeEnv: 'NODE_ENV',
  appVersion: 'APP_VERSION',
  port: 'PORT / API_PORT',
  databaseUrl: 'DATABASE_URL',
  redisUrl: 'REDIS_URL',
  authSecret: 'AUTH_SECRET',
  publisherInternalUrl: 'PUBLISHER_INTERNAL_URL',
  rateLimitGlobal: 'RATE_LIMIT_GLOBAL',
  rateLimitAuth: 'RATE_LIMIT_AUTH',
  rateLimitComment: 'RATE_LIMIT_COMMENT',
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const schema = z.object({
    nodeEnv: z.string().default('development'),
    appVersion: z.string().default('0.0.0'),
    port,
    databaseUrl: z.string().url(),
    redisUrl: z.string().url(),
    // At least 16 characters, the same floor `scripts/dev.sh` enforces before it
    // execs turbo. One secret, two processes: the web app mints a service token
    // with it and this API verifies it. A mismatch is not a broken sign-in, it is
    // every authenticated call failing at once.
    authSecret: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),
    // An http(s) URL specifically. `z.string().url()` alone accepts
    // `localhost:4400` -- `new URL` parses it as protocol `localhost:`, path
    // `4400` -- and every status probe would then fail with an error that names
    // neither the variable nor the mistake.
    publisherInternalUrl: httpUrl.transform((v) => v.replace(/\/+$/u, '')),
    rateLimitGlobal: positiveInt,
    rateLimitAuth: positiveInt,
    rateLimitComment: positiveInt,
  });

  const parsed = schema.safeParse({
    nodeEnv: env.NODE_ENV,
    appVersion: env.APP_VERSION,
    port: env.PORT !== undefined && env.PORT.trim() !== '' ? env.PORT : env.API_PORT,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    authSecret: env.AUTH_SECRET,
    publisherInternalUrl: env.PUBLISHER_INTERNAL_URL,
    rateLimitGlobal: env.RATE_LIMIT_GLOBAL,
    rateLimitAuth: env.RATE_LIMIT_AUTH,
    rateLimitComment: env.RATE_LIMIT_COMMENT,
  });

  if (!parsed.success) {
    // Every failing name in one message. Starting a process five times to
    // discover five missing variables is the common experience on a fresh clone,
    // and it is the one this avoids.
    const lines = parsed.error.issues.map(
      (issue) => `  ${ENV_NAMES[issue.path.join('.')] ?? issue.path.join('.')}: ${issue.message}`,
    );
    throw new ConfigError(`Cannot start the API. Fix these in .env:\n${lines.join('\n')}`);
  }

  return parsed.data;
}

/** The injection token. A value provider, so nothing can construct a second config. */
export const API_CONFIG = 'API_CONFIG';
