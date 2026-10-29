/**
 * The publisher process.
 *
 * Build step 1 runs its health endpoint only: Postgres and Redis, checked for
 * real. Build step 7 adds the work it exists for -- draining the revalidation
 * outbox into HMAC-signed webhooks to the public site, with retries, and firing
 * scheduled publishes exactly once (a BullMQ delayed job per revision) -- and a
 * queue-depth check beside these two.
 */
import { createServer } from 'node:http';

import { createPrismaClient } from '@cms/db';
import { Redis } from 'ioredis';

import { loadConfig } from './config';
import { httpStatusFor, report } from './health';

const log = (event: string, data: Record<string, unknown> = {}) =>
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), service: 'publisher', event, ...data })}\n`,
  );

async function main(): Promise<void> {
  const config = loadConfig();
  const startedAt = Date.now();
  const prisma = createPrismaClient({ url: config.databaseUrl });
  // Fail rather than queue: an offline queue would let /health pass against a
  // Redis that is not there.
  const redis = new Redis(config.redisUrl, { enableOfflineQueue: false, lazyConnect: true });
  // An EventEmitter with no `error` listener throws, which would take the
  // process down on a Redis blip instead of reporting it through /health.
  redis.on('error', (error) => log('redis_error', { error: error.message }));
  await redis
    .connect()
    .catch((error: unknown) => log('redis_unavailable', { error: String(error) }));

  const probes = {
    postgres: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    redis: async () => {
      await redis.ping();
    },
  };

  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    void report(probes, { version: config.appVersion, startedAt }).then((body) => {
      res.writeHead(httpStatusFor(body), {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    });
  });
  server.listen(config.healthPort);
  log('started', { port: config.healthPort });

  const shutdown = async () => {
    server.close();
    await prisma.$disconnect();
    // `quit`, not `disconnect`: it waits for in-flight replies.
    await redis.quit().catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

main().catch((error: unknown) => {
  // The message alone: config errors are written to be read by whoever starts it.
  log('fatal', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
