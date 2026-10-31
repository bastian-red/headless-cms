#!/usr/bin/env bash
#
# Start the dev stack: load .env, check the datastores are reachable, hand off to
# turbo.
#
# `turbo run dev` on its own does not read .env. Turbo does not load dotenv files,
# and Next.js only reads a .env inside its own package directory (apps/web/.env),
# which this monorepo does not have. Three sibling projects in this portfolio
# shipped without this wrapper and their documented `pnpm dev` started an API with
# no AUTH_SECRET, which died at boot and left every server render failing with
# ECONNREFUSED. This repo has the wrapper from its first commit.
#
# The env-loading block below is deliberately the same shape as the one in
# scripts/e2e.sh, so the repo has one idiom for this rather than two that can
# drift apart.
#
# Usage: pnpm dev   (package.json points "dev" here)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cat >&2 <<'MSG'
No .env in the repo root.

  cp .env.example .env
  sed -i "s|^AUTH_SECRET=|AUTH_SECRET=$(openssl rand -base64 32)|" .env
  sed -i "s|^CONTENT_API_KEY=.*|CONTENT_API_KEY=$(node scripts/new-api-key.mjs)|" .env
  pnpm db:seed   # registers the key

See README.md, "Running it".
MSG
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

# Fail here, naming the variable, rather than 40 lines into a Nest stack trace.
# Both processes use it -- the web app mints the service token, the API checks
# it -- so a missing secret does not merely break sign-in, it makes every
# signed-in page fail, and an empty studio looks like a broken query rather
# than a broken secret.
if [[ ${#AUTH_SECRET} -lt 16 ]]; then
  echo "AUTH_SECRET must be at least 16 characters. Generate one:" >&2
  echo "  sed -i \"s|^AUTH_SECRET=.*|AUTH_SECRET=\$(openssl rand -base64 32)|\" .env" >&2
  exit 1
fi

# Postgres and Redis being absent is the other failure that presents as a slow or
# broken page rather than as an error, so it gets named up front too. Uses bash's
# own /dev/tcp rather than nc, which is not installed everywhere.
# The public site reads the content API with this key; without it every
# public page fails on its first read. Format only: whether the API knows the
# key is the seed's job (it registers it), and a 401 names itself.
if [[ ! "${CONTENT_API_KEY:-}" =~ ^hcms_[A-Za-z0-9_-]{51}$ ]]; then
  echo "CONTENT_API_KEY is not set to a content API key. Generate one, then reseed:" >&2
  echo '  sed -i "s|^CONTENT_API_KEY=.*|CONTENT_API_KEY=$(node scripts/new-api-key.mjs)|" .env' >&2
  echo "  pnpm db:seed" >&2
  exit 1
fi

check_reachable() {
  local url="$1" label="$2" host port
  if [[ ! "$url" =~ ^[a-z+]+://([^@/]*@)?([^:/?#]+):([0-9]+) ]]; then
    return 0 # No explicit host:port to check. Let the app report it.
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
check_reachable "${DATABASE_URL:-}" Postgres || failed=1
# Redis is not optional: the API's throttler stores its counters there, so every
# request fails without it.
check_reachable "${REDIS_URL:-}" Redis || failed=1
[[ $failed -eq 0 ]] || exit 1

# `exec` so Ctrl-C reaches turbo directly and the persistent tasks shut down
# cleanly instead of being orphaned behind a wrapper shell.
# --log-order=stream: under GITHUB_ACTIONS turbo otherwise groups each task's
# output until the task ends, and a dev server never ends, so a crashing web
# app would print nothing at all in CI.
exec pnpm exec turbo run dev --log-order=stream "$@"
