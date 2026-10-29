/**
 * Every environment variable the publisher reads, parsed once at boot.
 *
 * Each read is spelled `env.NAME` literally so `scripts/env-contract.mjs` can
 * see it (turbo strips undeclared names silently). A missing or malformed value
 * stops the process with one sentence naming every variable at fault.
 */
import { z } from 'zod';

export interface PublisherConfig {
  appVersion: string;
  databaseUrl: string;
  redisUrl: string;
  healthPort: number;
}

const port = z
  .string()
  .trim()
  .regex(/^\d+$/u, 'must be a whole number')
  .transform(Number)
  .pipe(z.number().int().min(1).max(65535));

const ENV_NAMES: Record<keyof PublisherConfig, string> = {
  appVersion: 'APP_VERSION',
  databaseUrl: 'DATABASE_URL',
  redisUrl: 'REDIS_URL',
  healthPort: 'PUBLISHER_HEALTH_PORT',
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PublisherConfig {
  const parsed = z
    .object({
      appVersion: z.string().default('0.0.0'),
      databaseUrl: z.string().url(),
      redisUrl: z.string().url(),
      healthPort: port,
    })
    .safeParse({
      appVersion: env.APP_VERSION,
      databaseUrl: env.DATABASE_URL,
      redisUrl: env.REDIS_URL,
      healthPort: env.PUBLISHER_HEALTH_PORT,
    });
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) =>
        `  ${ENV_NAMES[issue.path[0] as keyof PublisherConfig] ?? issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Cannot start the publisher. Fix these in .env:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
