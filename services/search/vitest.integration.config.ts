import { defineConfig } from 'vitest/config';

/**
 * The search queries against the real Postgres and the seeded newsroom, run
 * by `./scripts/integration.sh` after it seeds `cms_it`. A separate directory
 * from `src/`, so the gate lane (`pnpm test`) never needs a database.
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
