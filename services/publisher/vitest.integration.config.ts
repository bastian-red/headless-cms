import { defineConfig } from 'vitest/config';

/**
 * The publisher's integration lane: real Postgres (cms_it), real HTTP. Its own
 * config and directory so the gate lane (`pnpm test`) never picks it up; only
 * `./scripts/integration.sh` brings the database up and points at it.
 *
 * One file at a time: the outbox tests own every undelivered event in the
 * database while they run, and a second file writing events would make the
 * delivery counts a question about ordering.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
