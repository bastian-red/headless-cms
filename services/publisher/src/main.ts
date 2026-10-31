/**
 * The publisher process: the clock and the courier.
 *
 * Every second it publishes the scheduled posts that are due (`publishDue`)
 * and delivers the revalidation outbox to the site (`drain`). Both read and
 * write Postgres only, with row locks that make any number of replicas safe;
 * the API and the publisher share no queue, and Redis is not involved.
 *
 * Every publish and every delivery is a JSON log line (the trace), and
 * `/health` checks Postgres, the outbox backlog and the overdue schedules for
 * real, so a site that has stopped accepting webhooks, or a publisher that
 * has stopped keeping time, turns the check red rather than staying quiet.
 */
import { createServer } from 'node:http';

import { createPrismaClient } from '@cms/db';
import { ConnectionLog, describeError } from '@cms/shared/server';

import { loadConfig } from './config';
import { httpStatusFor, report } from './health';
import { BACKLOG_FAIL_SECONDS, backlog, drain } from './outbox';
import { overdueSchedules, publishDue } from './schedule';

/** How often it looks. Also the worst-case lateness of a scheduled publish. */
const TICK_MS = 1000;

const log = (event: string, data: Record<string, unknown> = {}) =>
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), service: 'publisher', event, ...data })}\n`,
  );

async function main(): Promise<void> {
  const config = loadConfig();
  const startedAt = Date.now();
  const prisma = createPrismaClient({ url: config.databaseUrl });
  const target = { url: config.revalidateUrl, secret: config.revalidateSecret };

  // A tick that fails because Postgres is down fails every second: log the
  // transitions, not every attempt.
  const database = new ConnectionLog({
    write: ({ event, ...data }) => log(`database_${event}`, data),
  });

  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const tick = async () => {
    try {
      for (const post of await publishDue(prisma)) {
        log('published_scheduled', {
          postId: post.postId,
          slug: post.slug,
          revisionId: post.revisionId,
          scheduledFor: post.scheduledFor.toISOString(),
          lateMs: Date.now() - post.scheduledFor.getTime(),
        });
      }
      for (const { event, result } of await drain(prisma, target)) {
        if (result.ok) {
          log('delivered', { eventId: event.id, tags: event.tags, attempt: event.attempts });
        } else {
          log('delivery_failed', {
            eventId: event.id,
            attempt: event.attempts,
            error: result.error,
          });
        }
      }
      database.recovered();
    } catch (error) {
      database.failed(error);
    }
  };

  const loop = () => {
    if (stopping) return;
    running = tick().finally(() => {
      if (!stopping) timer = setTimeout(loop, TICK_MS);
    });
  };

  const probes = {
    postgres: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    outbox: async () => {
      const state = await backlog(prisma);
      if (state.oldestSeconds !== null && state.oldestSeconds > BACKLOG_FAIL_SECONDS) {
        throw new Error(
          `${String(state.undelivered)} revalidation event(s) undelivered, the oldest for ` +
            `${String(state.oldestSeconds)} s` +
            (state.lastError === null ? '' : ` (last error: ${state.lastError})`),
        );
      }
    },
    schedule: async () => {
      const overdue = await overdueSchedules(prisma);
      if (overdue.count > 0) {
        throw new Error(
          `${String(overdue.count)} scheduled post(s) not published, the oldest ` +
            `${String(overdue.oldestSeconds)} s past its time`,
        );
      }
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
  log('started', { port: config.healthPort, revalidateUrl: config.revalidateUrl, tickMs: TICK_MS });
  loop();

  const shutdown = async () => {
    stopping = true;
    clearTimeout(timer);
    server.close();
    // Let a tick in flight finish settling what it delivered.
    await running;
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

main().catch((error: unknown) => {
  // The message alone: config errors are written to be read by whoever starts it.
  log('fatal', { error: describeError(error) });
  process.exit(1);
});
