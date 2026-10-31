#!/usr/bin/env bash
#
# The integration lane: real Postgres, real Redis, every service's integration
# suite.
#
#   ./scripts/integration.sh              # everything
#   ./scripts/integration.sh auth         # the database suite, then API files matching "auth"
#
# Its own database (cms_it) and Redis database (1), so it never touches what
# `pnpm dev` is using. Every budget is the DOCUMENTED one from .env.example:
# the suites spread signed-in calls over fresh users and anonymous calls over
# random addresses, which is how real traffic is keyed, and a lane that lifts a
# limit hides that limit's bugs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/load-env.sh
. scripts/load-env.sh

BASE_DB="${DATABASE_URL:-postgresql://cms:cms@localhost:5444/cms?schema=public}"
export DATABASE_URL="${INTEGRATION_DATABASE_URL:-${BASE_DB/\/cms\?/\/cms_it?}}"
BASE_REDIS="${REDIS_URL:-redis://localhost:6390}"
export REDIS_URL="${INTEGRATION_REDIS_URL:-${BASE_REDIS%/}/1}"
[[ -n "${AUTH_SECRET:-}" ]] || export AUTH_SECRET=integration-auth-secret-0123456789

[[ "$DATABASE_URL" != "$BASE_DB" ]] ||
  { echo "integration: refusing to run against the dev database (${BASE_DB%%\?*})." >&2; exit 1; }

echo "integration: build"
pnpm exec turbo run build --output-logs=errors-only >/dev/null

echo "integration: database ${DATABASE_URL%%\?*}, redis ${REDIS_URL}"
pnpm --filter @cms/db exec node -e "
  const { PrismaClient } = require('./generated/client');
  const url = new URL(process.env.DATABASE_URL);
  const name = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  admin.\$queryRawUnsafe('SELECT 1 FROM pg_database WHERE datname = \$1', name)
    .then((rows) => rows.length === 0 ? admin.\$executeRawUnsafe('CREATE DATABASE \"' + name + '\"') : null)
    .finally(() => admin.\$disconnect());
"
pnpm --filter @cms/api exec node -e "
  const { Redis } = require('ioredis');
  const r = new Redis(process.env.REDIS_URL);
  r.flushdb().finally(() => r.disconnect());
"
pnpm --filter @cms/db exec prisma migrate deploy >/dev/null
node scripts/db-drift.mjs

echo "integration: database guarantees"
pnpm --filter @cms/db exec vitest run --config vitest.integration.config.ts

# The API suites read the demo newsroom (redirects, a taken-down post, the
# canaries), so it is loaded here. The seed only rewrites its own rows.
echo "integration: seed"
pnpm --filter @cms/db exec tsx prisma/seed.mts >/dev/null

echo "integration: search"
pnpm --filter @cms/search exec vitest run --config vitest.integration.config.ts

echo "integration: API"
if [[ $# -gt 0 ]]; then
  pnpm --filter @cms/api exec vitest run --config vitest.integration.config.ts "$@"
else
  pnpm --filter @cms/api exec vitest run --config vitest.integration.config.ts
fi
