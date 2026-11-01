#!/usr/bin/env bash
#
# The E2E lane: build in production mode, reseed, start the API, build the
# site against it, start all three processes (api, web, publisher), run
# Playwright. Arguments go straight to
# `playwright test`.
#
# This lane supplies its own environment and starts the apps directly, bypassing
# turbo -- which is exactly why it proves nothing about whether the documented
# `pnpm dev` works. That is scripts/dev-smoke.sh's job, and it strips the
# environment first.
#
# Every budget runs at its DOCUMENTED value (.env.example). Lifting the sign-in
# budget "so tests are not rate-limited" is how a sibling repo hid a throttler
# that capped every route. Instead each spec's browser carries its own
# X-Forwarded-For (e2e/fixtures.ts), the web server forwards it, and the API
# (trust proxy = 1 hop) keys the per-address budgets on it, the way real
# traffic from many people is keyed.
#
# Usage: ./scripts/e2e.sh [playwright args...]
set -euo pipefail
set -m # each background job leads its own process group, so cleanup kills the whole tree

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOG_DIR="${LOG_DIR:-/tmp/cms-e2e}"
mkdir -p "$LOG_DIR"
API_LOG="$LOG_DIR/api.log"
WEB_LOG="$LOG_DIR/web.log"
PUB_LOG="$LOG_DIR/publisher.log"
API_PID=""
WEB_PID=""
PUB_PID=""
WAIT_SECONDS="${WAIT_SECONDS:-90}"

cleanup() {
  for pid in "$WEB_PID" "$API_PID" "$PUB_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -- -"$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT

# Caller env > .env > .env.example (scripts/load-env.sh says why).
# shellcheck source=scripts/load-env.sh
. scripts/load-env.sh

[[ -n "${AUTH_SECRET:-}" ]] || export AUTH_SECRET=ci-secret-at-least-32-characters-long
REVALIDATE_SECRET_CHECK="${REVALIDATE_SECRET:-}"
[[ ${#REVALIDATE_SECRET_CHECK} -ge 32 ]] || export REVALIDATE_SECRET=e2e-revalidate-secret-0123456789abcdef
# The publisher delivers to the site this lane starts, wherever that is.
export REVALIDATE_URL="${APP_BASE_URL%/}/api/revalidate"
# The site's content API key: the seed registers whatever this is.
[[ -n "${CONTENT_API_KEY:-}" ]] || CONTENT_API_KEY="$(node scripts/new-api-key.mjs)"
export CONTENT_API_KEY
export PORT=""

check_reachable() {
  local url="$1" label="$2" host port
  if [[ ! "$url" =~ ^[a-z+]+://([^@/]*@)?([^:/?#]+):([0-9]+) ]]; then
    return 0
  fi
  host="${BASH_REMATCH[2]}"
  port="${BASH_REMATCH[3]}"
  if ! (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null; then
    echo "${label} is not reachable at ${host}:${port}. Start the datastores:" >&2
    echo "  docker compose -f infra/docker-compose.yml up -d" >&2
    return 1
  fi
}
failed=0
check_reachable "$DATABASE_URL" Postgres || failed=1
check_reachable "$REDIS_URL" Redis || failed=1
[[ $failed -eq 0 ]] || exit 1

# Refuse to run against something already listening: the suite would test that
# instead, with whatever environment and build it happens to have.
for url in "${API_BASE_URL}/health" "${APP_BASE_URL}/sign-in" "${PUBLISHER_INTERNAL_URL}/health"; do
  if curl -sf -o /dev/null "$url" 2>/dev/null; then
    echo "Something is already serving ${url}. Stop it first (pnpm dev?)." >&2
    exit 1
  fi
done

wait_for() {
  local url="$1" name="$2" pid="$3" log="$4"
  local i
  for ((i = 0; i < WAIT_SECONDS; i++)); do
    if curl -sf -o /dev/null "$url" 2>/dev/null; then return 0; fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "${name} exited during startup. Last 30 lines of ${log}:" >&2
      tail -30 "$log" >&2
      exit 1
    fi
    sleep 1
  done
  echo "${name} never came up at ${url} within ${WAIT_SECONDS}s. Last 30 lines of ${log}:" >&2
  tail -30 "$log" >&2
  exit 1
}

# The order is the point. The site prerenders from the content API, so the
# API has to be built, migrated, seeded and serving BEFORE the site is built;
# a site built first would have nothing to prerender, and the check after the
# build would be grading an empty site.
echo "==> Building the API, publisher and packages (production)"
NODE_ENV=production pnpm exec turbo run build --filter='!@cms/web' >"$LOG_DIR/build.log" 2>&1 || {
  tail -40 "$LOG_DIR/build.log" >&2
  exit 1
}

echo "==> Applying migrations and seeding"
pnpm --filter @cms/db run migrate:deploy >"$LOG_DIR/migrate.log" 2>&1 || {
  tail -30 "$LOG_DIR/migrate.log" >&2
  exit 1
}
# The seed restores its own accounts and registers the site's content API key,
# so a previous run never decides this run's outcome. Specs that change things
# do it on rows they create themselves.
pnpm --filter @cms/db run seed >"$LOG_DIR/seed.log" 2>&1 || {
  tail -30 "$LOG_DIR/seed.log" >&2
  exit 1
}

echo "==> Starting api, publisher (logs in ${LOG_DIR})"
node apps/api/dist/main.js >"$API_LOG" 2>&1 &
API_PID=$!
node services/publisher/dist/main.js >"$PUB_LOG" 2>&1 &
PUB_PID=$!
wait_for "${API_BASE_URL}/health" api "$API_PID" "$API_LOG"
wait_for "${PUBLISHER_INTERNAL_URL}/health" publisher "$PUB_PID" "$PUB_LOG"

echo "==> Building the site against the seeded API (production)"
# The data cache from the previous build would answer the build's fetches with
# what the API held then: a run killed before its cleanup left a published test
# post, and the next build prerendered it from this cache although the reseeded
# API no longer had it (render-check caught it: 37 post pages for 36 live posts).
# The build must read THIS API, so it starts from an empty data cache.
rm -rf apps/web/.next/cache/fetch-cache
NODE_ENV=production pnpm exec turbo run build --filter=@cms/web >>"$LOG_DIR/build.log" 2>&1 || {
  tail -40 "$LOG_DIR/build.log" >&2
  exit 1
}

# Before anything runs: a public page that turned dynamic still renders
# correctly, so no spec below would notice. Only the build output can. With
# --content it also requires every seeded live post to have been prerendered
# and finds no draft or pending-comment text anywhere in .next/.
echo "==> Checking the rendering matrix and the build's content"
node scripts/render-check.mjs --content

echo "==> Starting web"
(cd apps/web && exec node_modules/.bin/next start -p "$WEB_PORT") >"$WEB_LOG" 2>&1 &
WEB_PID=$!
wait_for "${APP_BASE_URL}/sign-in" web "$WEB_PID" "$WEB_LOG"

# Lighthouse first, while the server is idle and nothing has been written yet:
# the budgets (e2e/lighthouse-budget.mjs) are timing measurements, and the
# specs below sign in, publish and comment. LIGHTHOUSE=0 skips it for a quick
# local loop; CI never sets it. The demo recording has no use for it.
if [[ "${LIGHTHOUSE:-1}" != "0" && "${DEMO:-0}" != "1" ]]; then
  echo "==> Running Lighthouse (reports in ${LOG_DIR}/lighthouse)"
  LOG_DIR="$LOG_DIR" pnpm --filter @cms/e2e exec node lighthouse.mjs "$APP_BASE_URL"
fi

echo "==> Running Playwright"
pnpm --filter @cms/e2e exec playwright test "$@"
