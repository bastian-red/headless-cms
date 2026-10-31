import { REVALIDATION_SIGNATURE_HEADER, verifyRevalidation } from '@cms/shared/server';
import { describe, expect, it } from 'vitest';

import { backoffMs, deliver } from './outbox';

const SECRET = 'p'.repeat(44);
const NOW = 1_793_462_400;
const EVENT = { id: 'evt_1', tags: ['post:hello', 'posts'], attempts: 1 };

/** A fetch that records what it was sent and answers with `respond`. */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return { fn, calls };
}

describe('backoffMs', () => {
  it('doubles from one second and stops at five minutes (computed with node, not recalled)', () => {
    expect([0, 1, 2, 3, 9, 10, 50].map(backoffMs)).toEqual([
      1000, 1000, 2000, 4000, 256000, 300000, 300000,
    ]);
  });
});

describe('deliver', () => {
  it('posts the event signed so the site verifies it, and calls a 2xx a delivery', async () => {
    const fetch = fakeFetch(() => new Response('{}', { status: 200 }));
    const result = await deliver(EVENT, {
      url: 'http://web.test/api/revalidate',
      secret: SECRET,
      fetch: fetch.fn,
      nowSeconds: () => NOW,
    });
    expect(result).toEqual({ ok: true });
    expect(fetch.calls).toHaveLength(1);
    const [call] = fetch.calls;
    const body = call!.init.body as string;
    expect(call!.url).toBe('http://web.test/api/revalidate');
    expect(call!.init.method).toBe('POST');
    expect(call!.init.redirect).toBe('manual');
    expect(JSON.parse(body)).toEqual({ eventId: 'evt_1', tags: ['post:hello', 'posts'] });
    // The receiver's own check, not a re-derivation of the signing code.
    const header = (call!.init.headers as Record<string, string>)[REVALIDATION_SIGNATURE_HEADER];
    expect(verifyRevalidation(SECRET, header, body, NOW)).toEqual({ ok: true });
  });

  it('calls a refusal, a redirect and a network error failures, saying which', async () => {
    const target = { url: 'http://web.test/api/revalidate', secret: SECRET };
    expect(
      await deliver(EVENT, {
        ...target,
        fetch: fakeFetch(() => new Response('{"error":"unauthorized"}', { status: 401 })).fn,
      }),
    ).toEqual({ ok: false, error: 'HTTP 401: {"error":"unauthorized"}' });
    // A redirect is not a delivery: the site never ran the handler.
    expect(
      await deliver(EVENT, {
        ...target,
        fetch: fakeFetch(() => new Response(null, { status: 308, headers: { location: '/x' } })).fn,
      }),
    ).toEqual({ ok: false, error: 'HTTP 308' });
    expect(
      await deliver(EVENT, {
        ...target,
        fetch: fakeFetch(() => {
          throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') });
        }).fn,
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('fetch failed') });
  });
});
