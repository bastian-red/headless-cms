# @cms/publisher

The process that turns "an editor pressed Publish" into "readers see it".

- **Today (build step 1):** `GET /health` on `PUBLISHER_HEALTH_PORT` (default 4400), checking
  Postgres (`SELECT 1`) and Redis (`PING`); 503 names the failing check. The API's `GET /status`
  asks it over HTTP.
- **Build step 7:** drains the revalidation outbox the API writes in the publish transaction into
  HMAC-SHA256-signed `POST /api/revalidate` calls to the web app (retries, idempotent by event id),
  and runs scheduled publishes as BullMQ delayed jobs keyed by revision id, so a publish fires once
  even with two replicas. `/health` gains a queue-depth check.

```bash
pnpm --filter @cms/publisher test     # gate lane: health report + config
pnpm --filter @cms/publisher dev      # tsx watch, reads the root .env through pnpm dev
```
