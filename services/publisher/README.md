# @cms/publisher

The process that turns "an editor pressed Publish" into "readers see it", and "publish at 09:00"
into a post that goes out at 09:00, once.

Once a second it does two things, both against Postgres only:

1. **Scheduled publishing** (`src/schedule.ts`). Finds `SCHEDULED` posts whose `scheduled_for` has
   passed and publishes them, in one transaction with their revalidation event. The schedule is
   the posts table: there is no job in a second system that has to agree with it.
2. **Outbox delivery** (`src/outbox.ts`). Claims undelivered `revalidation_events` rows (written by
   the API in the same transaction as the change they announce), POSTs each to the site's
   `/api/revalidate` signed with HMAC-SHA256, and records the delivery or the failure.

## Guarantees, and the test that holds each

| Guarantee | How | Test (`test/`, integration lane) |
|---|---|---|
| A due post is published exactly once, with any number of publishers | due rows taken `FOR UPDATE SKIP LOCKED`; the UPDATE re-checks `status = 'SCHEDULED'` | `schedule.test.ts` "two publishers race" (red without the lock: posts published twice) |
| A published post always has its event, and the reverse | both in one transaction | `schedule.test.ts` "publishes a due post with its event in one go" |
| Readers see the editor's date, not the tick's | `published_at = COALESCE(published_at, scheduled_for)` | same test; a republish keeps the first date |
| A tag the post leaves is revalidated too | tags of the live and the scheduled revision | `schedule.test.ts` "tags of both what readers saw and what they will see" |
| Each event is delivered once, with any number of publishers | claim `SKIP LOCKED` + a 30 s lease in the same UPDATE | `outbox.test.ts` "three publishers drain at the same time" (red without either: 65 deliveries for 45 events) |
| A site that is down loses nothing | failures retried after 1 s, 2 s, 4 s ... capped at 5 min, never dropped | `outbox.test.ts` "keeps a refused event" and "never gives up" |
| Only the publisher can make the site refetch | `x-quire-signature: t=<unix>,v1=<hmac>`, 300 s window, constant-time compare | `packages/shared/src/server/webhook.test.ts`, `apps/web/lib/revalidate.test.ts`, `outbox.test.ts` "another secret" |

Delivery is **at least once**: a publisher that dies between delivering and recording lets the
lease run out and the event goes again. That is safe because expiring a tag twice costs one extra
render and nothing else.

End to end, `e2e/tests/publish.spec.ts` publishes, edits and unpublishes a post through the API
against a production build and asserts the post page, the archive, the feed and the sitemap follow
within 5 s (measured: about 1.2-1.6 s). It fails if the site's route answers 200 without expiring
the tags.

## Operating it

`GET /health` on `PUBLISHER_HEALTH_PORT` (default 4400); 503 names the failing check:

- `postgres`: `SELECT 1`.
- `outbox`: fails when the oldest undelivered event is more than 300 s old, with the count and
  the last error (`HTTP 401: ...` is a secret mismatch, `fetch failed` is the site being down).
- `schedule`: fails when a scheduled post is more than 60 s past its time.

Every publish and delivery is a JSON line on stdout: `published_scheduled` (with `lateMs`),
`delivered`, `delivery_failed` (with the attempt and the error). A database outage logs when it
starts, a reminder every minute, and when it ends, not once a second.

| Variable | |
|---|---|
| `DATABASE_URL` | Postgres |
| `REVALIDATE_URL` | the site's `POST /api/revalidate` (`http://web:3000/api/revalidate` in compose) |
| `REVALIDATE_SECRET` | at least 32 characters, the same value the site verifies with |
| `PUBLISHER_HEALTH_PORT` | `/health` |

```bash
pnpm --filter @cms/publisher test     # gate lane: config, health report, backoff, signed delivery
./scripts/integration.sh              # includes this package's test/ against cms_it
pnpm --filter @cms/publisher dev      # tsx watch, reads the root .env through pnpm dev
```
