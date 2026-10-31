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
# Not the site: its build prerenders from a running API, and this lane tests
# the API itself (e2e.sh builds the site against one).
pnpm exec turbo run build --filter='!@cms/web' --output-logs=errors-only >/dev/null

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


# The suites delete every post they make. A post left behind is a failure:
# leftovers are live fixtures that pile up run after run, until every crawl of
# the content API outgrows its per-key budget and the lane 429s for a reason
# no test names. Counted around each phase, so the message names the phase.
count_posts() {
  pnpm --silent --filter @cms/db exec node -e "
    const { PrismaClient } = require('./generated/client');
    const db = new PrismaClient();
    db.post.count().then((n) => console.log(n)).finally(() => db.\$disconnect());
  "
}
leftovers() { # phase before after
  [[ "$2" == "$3" ]] ||
    { echo "integration: the $1 suites left $(($3 - $2)) post(s) in ${DATABASE_URL%%\?*}." >&2; exit 1; }
}

echo "integration: database guarantees"
before=$(count_posts)
pnpm --filter @cms/db exec vitest run --config vitest.integration.config.ts
leftovers database "$before" "$(count_posts)"

# The API suites read the demo newsroom (redirects, a taken-down post, the
# canaries), so it is loaded here. The seed only rewrites its own rows.
echo "integration: seed"
pnpm --filter @cms/db exec tsx prisma/seed.mts >/dev/null
before=$(count_posts)

echo "integration: search"
pnpm --filter @cms/search exec vitest run --config vitest.integration.config.ts

echo "integration: API"
if [[ $# -gt 0 ]]; then
  pnpm --filter @cms/api exec vitest run --config vitest.integration.config.ts "$@"
else
  pnpm --filter @cms/api exec vitest run --config vitest.integration.config.ts
fi
leftovers "search and API" "$before" "$(count_posts)"

# Last: these tests mark every undelivered event in cms_it delivered so each
# one owns the outbox it drains, and the API suites above leave events behind.
echo "integration: publisher (scheduling, outbox delivery)"
before=$(count_posts)
pnpm --filter @cms/publisher exec vitest run --config vitest.integration.config.ts
leftovers publisher "$before" "$(count_posts)"
echo "integration: no posts left behind ($before)"
