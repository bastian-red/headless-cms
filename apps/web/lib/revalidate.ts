/**
 * The receiving end of the publisher's webhook, as a pure function so the gate
 * lane can hold every branch without a running Next server. The route handler
 * (`app/api/revalidate/route.ts`) only wires the request, the clock and
 * `revalidateTag` into it.
 *
 * Order matters and is the point: **verify the raw body, then parse it.** A
 * body that is not signed is never read, so a forged request cannot even reach
 * the schema, let alone the cache. The failure reason is logged but not sent:
 * a caller without the secret learns only "401".
 */
import { revalidationPayloadSchema } from '@cms/shared';
import { type WebhookFailure, verifyRevalidation } from '@cms/shared/server';

export interface RevalidationRequest {
  readonly secret: string;
  readonly signature: string | null;
  readonly body: string;
  readonly nowSeconds: number;
  readonly revalidate: (tag: string) => void;
}

export type RevalidationOutcome =
  | { status: 200; eventId: string; tags: string[] }
  | { status: 401; reason: WebhookFailure }
  | { status: 400; reason: 'payload' };

export function handleRevalidation(request: RevalidationRequest): RevalidationOutcome {
  const verdict = verifyRevalidation(
    request.secret,
    request.signature,
    request.body,
    request.nowSeconds,
  );
  if (!verdict.ok) return { status: 401, reason: verdict.reason };

  let json: unknown;
  try {
    json = JSON.parse(request.body);
  } catch {
    return { status: 400, reason: 'payload' };
  }
  const payload = revalidationPayloadSchema.safeParse(json);
  if (!payload.success) return { status: 400, reason: 'payload' };

  for (const tag of payload.data.tags) request.revalidate(tag);
  return { status: 200, eventId: payload.data.eventId, tags: payload.data.tags };
}
