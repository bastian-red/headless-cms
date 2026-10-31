/**
 * The signature on a revalidation webhook (publisher -> `POST /api/revalidate`).
 *
 *   x-quire-signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *
 * - **The raw body is signed**, byte for byte, and verified before it is
 *   parsed, so nothing the sender did not sign is ever read.
 * - **The timestamp is signed with it** and must be within `toleranceSeconds`
 *   of the receiver's clock, so a captured request cannot be replayed later.
 *   Inside that window a replay only revalidates the same tags again, which
 *   is harmless: revalidation is idempotent.
 * - **Compared in constant time** (`timingSafeEqual`), so response timing
 *   says nothing about how much of a forged signature was right.
 *
 * The same shape Stripe uses for its webhooks, which keeps it recognisable.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const REVALIDATION_SIGNATURE_HEADER = 'x-quire-signature';
export const REVALIDATION_TOLERANCE_SECONDS = 300;
/** Shorter than this is guessable; `openssl rand -base64 32` gives 44 characters. */
export const REVALIDATE_SECRET_MIN_LENGTH = 32;

function hmac(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret)
    .update(`${String(timestamp)}.${body}`)
    .digest('hex');
}

/** The header value for `body`, signed at `nowSeconds`. */
export function signRevalidation(secret: string, body: string, nowSeconds: number): string {
  return `t=${String(nowSeconds)},v1=${hmac(secret, nowSeconds, body)}`;
}

export type WebhookFailure = 'missing' | 'malformed' | 'stale' | 'signature';
export type WebhookVerdict = { ok: true } | { ok: false; reason: WebhookFailure };

export function verifyRevalidation(
  secret: string,
  header: string | null | undefined,
  body: string,
  nowSeconds: number,
  toleranceSeconds: number = REVALIDATION_TOLERANCE_SECONDS,
): WebhookVerdict {
  if (header === null || header === undefined || header === '') {
    return { ok: false, reason: 'missing' };
  }
  const match = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/u.exec(header.trim());
  if (match === null) return { ok: false, reason: 'malformed' };
  const timestamp = Number(match[1]);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { ok: false, reason: 'stale' };
  const expected = Buffer.from(hmac(secret, timestamp, body), 'hex');
  const given = Buffer.from(match[2]!, 'hex');
  return timingSafeEqual(expected, given) ? { ok: true } : { ok: false, reason: 'signature' };
}
