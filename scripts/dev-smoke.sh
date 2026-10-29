#!/usr/bin/env bash
#
# Prove the DOCUMENTED `pnpm dev` serves a working app from a cold start.
#
# Every other lane supplies its own environment (e2e.sh and integration.sh source
# .env and start the apps directly, bypassing turbo), so none of them can see the
# failure that sank three sibling projects for months: turbo in strict env mode
# stripping names the app needs, and `pnpm dev` booting an API with no
# AUTH_SECRET. This script strips every .env name from its own environment with
# `env -u` and runs `pnpm dev` exactly as the README says, so the only way the
# configuration can reach the processes is the path a reader's machine uses:
# scripts/dev.sh sourcing .env, turbo passing declared names through.
#
# Assert on content, never on a status code. A broken app answers 200 with an
# error page. So this requires, across all three processes: every /health ok
# (api, publisher); a sign-in through Auth.js; the studio rendering the seeded
# editor's name and the role the API read from Postgres (GET /auth/me, so the
# web -> service token -> API -> database path is whole); and /status reading
# both services as up through the API.
#
# Negative check: point "dev" in package.json back at `turbo run dev` and this
# fails, because nothing then loads .env.
#
# Usage: ./scripts/dev-smoke.sh      (datastores up, migrated, seeded)
set -euo pipefail
set -m

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOG="${LOG:-/tmp/cms-dev-smoke.log}"
COOKIES="$(mktemp -t cms-dev-smoke-cookies.XXXXXX)"
DEV_PID=""
WAIT_SECONDS="${WAIT_SECONDS:-120}"

cleanup() {
  if [[ -n "$DEV_PID" ]] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill -- -"$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
  rm -f "$COOKIES"
}
trap cleanup EXIT

die() {
  echo >&2
  echo "FAIL: $*" >&2
  exit 1
}

[[ -f .env ]] || die "no .env in the repo root. See README.md, 'Running it'."

env_value() { sed -n "s/^[[:space:]]*$1=//p" .env | tail -1; }
API_PORT="$(env_value API_PORT)"
WEB_PORT="$(env_value WEB_PORT)"
PUBLISHER_HEALTH_PORT="$(env_value PUBLISHER_HEALTH_PORT)"
API_BASE_URL="http://localhost:${API_PORT:-4000}"
APP_BASE_URL="http://localhost:${WEB_PORT:-3000}"
PUBLISHER_BASE_URL="http://localhost:${PUBLISHER_HEALTH_PORT:-4400}"

# The seeded facts, read out of the seed rather than retyped.
SEED=packages/db/prisma/seed.mts
seed_const() { sed -n "s/^const $1 = '\([^']*\)';.*/\1/p" "$SEED"; }
EDITOR_EMAIL="$(seed_const EDITOR_EMAIL)"
EDITOR_PASSWORD="$(seed_const EDITOR_PASSWORD)"
EDITOR_NAME="$(seed_const EDITOR_NAME)"
for pair in "EDITOR_EMAIL:$EDITOR_EMAIL" "EDITOR_PASSWORD:$EDITOR_PASSWORD" "EDITOR_NAME:$EDITOR_NAME"; do
  [[ -n "${pair#*:}" ]] || die "could not read ${pair%%:*} out of ${SEED}."
done

for url in "${API_BASE_URL}/health" "${APP_BASE_URL}/sign-in" "${PUBLISHER_BASE_URL}/health"; do
  if curl -sf -o /dev/null "$url" 2>/dev/null; then
    die "something is already serving ${url}. Stop it first."
  fi
done

# Cold, like a fresh clone: no app build output for `dev` to lean on. The
# workspace packages' dist/ is left alone deliberately -- `dev` dependsOn ^build,
# and whether that rebuild happens is part of what is being tested; CI runs this
# on a checkout that has none at all.
echo "==> Removing app build outputs"
for stale in apps/*/dist apps/*/.next; do
  [[ -e "$stale" ]] || continue
  rm -rf "${ROOT:?}/${stale}"
  echo "    removed ${stale}"
done

mapfile -t ENV_KEYS < <(
  sed -n 's/^[[:space:]]*#\?[[:space:]]*\([A-Z][A-Z0-9_]*\)[[:space:]]*=.*/\1/p' .env.example .env | sort -u
)
[[ ${#ENV_KEYS[@]} -gt 0 ]] || die "parsed no variable names out of .env.example."
UNSET_ARGS=()
for key in "${ENV_KEYS[@]}"; do UNSET_ARGS+=(-u "$key"); done

echo "==> Starting: pnpm dev (${#ENV_KEYS[@]} .env names stripped from the child environment)"
echo "    log: ${LOG}"
env "${UNSET_ARGS[@]}" pnpm dev >"$LOG" 2>&1 &
DEV_PID=$!

wait_for() {
  local url="$1" name="$2"
  local i
  for ((i = 0; i < WAIT_SECONDS; i++)); do
    curl -sf -o /dev/null "$url" 2>/dev/null && return 0
    if ! kill -0 "$DEV_PID" 2>/dev/null; then
      echo "pnpm dev exited before ${name} came up. Last 150 lines of ${LOG}:" >&2
      tail -150 "$LOG" >&2
      exit 1
    fi
    sleep 1
  done
  echo "${name} never came up at ${url} within ${WAIT_SECONDS}s. Last 150 lines of ${LOG}:" >&2
  tail -150 "$LOG" >&2
  exit 1
}
echo "==> Waiting for api, web and publisher"
wait_for "${API_BASE_URL}/health" api
wait_for "${APP_BASE_URL}/sign-in" web
wait_for "${PUBLISHER_BASE_URL}/health" publisher

json_field() {
  node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      try { process.stdout.write(String(JSON.parse(raw)[process.argv[1]] ?? "")); } catch {}
    });' "$1"
}

echo "==> Checking /health reports every dependency ok"
for pair in "api:${API_BASE_URL}" "publisher:${PUBLISHER_BASE_URL}"; do
  body="$(curl -s "${pair#*:}/health")"
  [[ "$(json_field status <<<"$body")" == "ok" ]] ||
    die "${pair%%:*} /health is not ok: ${body}"
done

echo "==> Signing in as ${EDITOR_EMAIL} through Auth.js"
csrf="$(curl -s -c "$COOKIES" -b "$COOKIES" "${APP_BASE_URL}/api/auth/csrf" | json_field csrfToken)"
[[ -n "$csrf" ]] || die "GET /api/auth/csrf returned no csrfToken. Auth.js is not mounted."
curl -s -o /dev/null -L -c "$COOKIES" -b "$COOKIES" \
  --data-urlencode "csrfToken=${csrf}" \
  --data-urlencode "email=${EDITOR_EMAIL}" \
  --data-urlencode "password=${EDITOR_PASSWORD}" \
  "${APP_BASE_URL}/api/auth/callback/credentials"
session="$(curl -s -c "$COOKIES" -b "$COOKIES" "${APP_BASE_URL}/api/auth/session")"
grep -qF "$EDITOR_EMAIL" <<<"$session" || {
  tail -150 "$LOG" >&2
  die "sign-in produced no session (${session}). AUTH_SECRET never reached a process, or the seed did not run."
}

echo "==> Checking /studio renders the editor as the API read them from Postgres"
studio="$(curl -s -L -b "$COOKIES" "${APP_BASE_URL}/studio")"
grep -qF "$EDITOR_NAME" <<<"$studio" || {
  tail -150 "$LOG" >&2
  die "/studio does not show '${EDITOR_NAME}'. It is an error page or an empty shell."
}
grep -qF 'data-testid="role">editor<' <<<"$studio" || {
  tail -150 "$LOG" >&2
  die "/studio does not show the editor role from GET /auth/me (web -> service token -> api -> Postgres)."
}

echo "==> Checking /status reads both services through the API"
status_page="$(curl -s "${APP_BASE_URL}/status")"
grep -qF "Every service is up" <<<"$status_page" || {
  tail -60 "$LOG" >&2
  die "/status does not say every service is up."
}

echo
echo "PASS: pnpm dev serves api, web and publisher, configured by .env alone; sign-in reaches Postgres through the API."
