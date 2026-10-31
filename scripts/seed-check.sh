#!/usr/bin/env bash
#
# Prove the seed is deterministic, idempotent, and safe to build a public site on.
#
#   deterministic   two runs produce the same content digest, ids and dates
#                   included. Only the scheduled time moves (it is a week from
#                   now by design), so it is digested as "set or not".
#   idempotent      the second run replaces the first instead of adding to it
#                   (same digest, same row count).
#   leak-free       no canary word appears in any row the public site may read:
#                   the published revision of a live post, its tags, approved
#                   comments. The canaries ARE present in the private rows, every
#                   workflow state exists, and every /posts/ link in a public post
#                   points at a live post or a redirect to one. Search has a
#                   document per revision, live exactly for live posts, and no
#                   live document holds a canary.
#   fit for later   the long-form post is at least 3,000 words, the renamed post
#                   has its redirect, the hostile post is live.
#
#   ./scripts/seed-check.sh
set -euo pipefail

cd "$(dirname "$0")/.."

# Caller env > .env > .env.example (scripts/load-env.sh says why).
# shellcheck source=scripts/load-env.sh
. scripts/load-env.sh

# The check reads through the db package's built client; a fresh clone has
# nothing built. Turbo makes this a cache hit otherwise.
pnpm exec turbo run build --filter=@cms/db --output-logs=errors-only >/dev/null

exec node scripts/seed-check.mjs
