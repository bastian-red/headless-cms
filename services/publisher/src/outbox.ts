/**
 * Delivering the revalidation outbox: `revalidation_events` rows, written by
 * the API (and by `publishDue`) in the same transaction as the change they
 * announce, become HMAC-signed `POST /api/revalidate` calls to the site.
 *
 * **Claim, then deliver, then settle**, never holding a transaction across
 * HTTP. Claiming takes due rows `FOR UPDATE SKIP LOCKED` and pushes their
 * `next_attempt_at` a lease ahead in the same statement, so another publisher
 * neither waits for nor re-takes them. A publisher that dies mid-delivery
 * leaves the row to come due again when the lease runs out: delivery is at
 * least once, which is safe because revalidating a tag twice changes nothing.
 *
 * **A failure is retried with exponential backoff** (1 s, 2 s, 4 s ... capped
 * at 5 min) and never dropped: a site that is down for an hour still has
 * stale pages when it comes back, and still needs to hear about them.
 * `/health` fails once the oldest undelivered event is older than
 * `BACKLOG_FAIL_SECONDS`, which is the signal someone has to act on.
 */
import type { PrismaClient } from '@cms/db';
import { REVALIDATION_SIGNATURE_HEADER, describeError, signRevalidation } from '@cms/shared/server';

export const BATCH = 20;
export const LEASE_MS = 30_000;
export const MAX_BACKOFF_MS = 300_000;
export const DELIVERY_TIMEOUT_MS = 10_000;
export const BACKLOG_FAIL_SECONDS = 300;

export interface ClaimedEvent {
  readonly id: string;
  readonly tags: readonly string[];
  /** Including this one. */
  readonly attempts: number;
}

export type DeliveryResult = { ok: true } | { ok: false; error: string };

/** Wait before the next try after `attempts` failures: 1 s, 2 s, 4 s ... at most 5 min. */
export function backoffMs(attempts: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

export async function claimDue(
  prisma: PrismaClient,
  { limit = BATCH, leaseMs = LEASE_MS }: { limit?: number; leaseMs?: number } = {},
): Promise<ClaimedEvent[]> {
  return prisma.$queryRaw<ClaimedEvent[]>`
    UPDATE revalidation_events
    SET attempts = attempts + 1,
        next_attempt_at = now() + make_interval(secs => ${leaseMs / 1000})
    WHERE id IN (
      SELECT id FROM revalidation_events
      WHERE delivered_at IS NULL AND next_attempt_at <= now()
      ORDER BY next_attempt_at, created_at, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, tags, attempts`;
}

export interface DeliveryTarget {
  readonly url: string;
  readonly secret: string;
  readonly fetch?: typeof fetch;
  readonly nowSeconds?: () => number;
}

export async function deliver(
  event: ClaimedEvent,
  target: DeliveryTarget,
): Promise<DeliveryResult> {
  const body = JSON.stringify({ eventId: event.id, tags: event.tags });
  const now = target.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
  try {
    const response = await (target.fetch ?? fetch)(target.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [REVALIDATION_SIGNATURE_HEADER]: signRevalidation(target.secret, body, now),
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (response.ok) {
      await response.body?.cancel();
      return { ok: true };
    }
    const text = (await response.text()).slice(0, 200);
    return { ok: false, error: `HTTP ${String(response.status)}${text === '' ? '' : `: ${text}`}` };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

export async function settle(
  prisma: PrismaClient,
  event: ClaimedEvent,
  result: DeliveryResult,
): Promise<void> {
  if (result.ok) {
    await prisma.revalidationEvent.update({
      where: { id: event.id },
      data: { deliveredAt: new Date(), lastError: null },
    });
    return;
  }
  await prisma.$executeRaw`
    UPDATE revalidation_events
    SET next_attempt_at = now() + make_interval(secs => ${backoffMs(event.attempts) / 1000}),
        last_error = ${result.error.slice(0, 500)}
    WHERE id = ${event.id}`;
}

export interface Settled {
  readonly event: ClaimedEvent;
  readonly result: DeliveryResult;
}

/** One claim-deliver-settle pass. */
export async function drain(prisma: PrismaClient, target: DeliveryTarget): Promise<Settled[]> {
  const claimed = await claimDue(prisma);
  return Promise.all(
    claimed.map(async (event) => {
      const result = await deliver(event, target);
      await settle(prisma, event, result);
      return { event, result };
    }),
  );
}

export async function backlog(
  prisma: PrismaClient,
): Promise<{ undelivered: number; oldestSeconds: number | null; lastError: string | null }> {
  const [row] = await prisma.$queryRaw<
    { undelivered: number; oldest: number | null; last_error: string | null }[]
  >`
    SELECT count(*)::int AS undelivered,
           floor(extract(epoch FROM now() - min(created_at)))::int AS oldest,
           (SELECT last_error FROM revalidation_events
            WHERE delivered_at IS NULL AND last_error IS NOT NULL
            ORDER BY created_at LIMIT 1) AS last_error
    FROM revalidation_events
    WHERE delivered_at IS NULL`;
  return {
    undelivered: row?.undelivered ?? 0,
    oldestSeconds: row?.oldest ?? null,
    lastError: row?.last_error ?? null,
  };
}
