import { signRevalidation } from '@cms/shared/server';
import { describe, expect, it } from 'vitest';

import { handleRevalidation } from './revalidate';

const SECRET = 'r'.repeat(44);
const NOW = 1_793_462_400;

function call(body: string, signature: string | null = signRevalidation(SECRET, body, NOW)) {
  const revalidated: string[] = [];
  const outcome = handleRevalidation({
    secret: SECRET,
    signature,
    body,
    nowSeconds: NOW,
    revalidate: (tag) => revalidated.push(tag),
  });
  return { outcome, revalidated };
}

describe('handleRevalidation', () => {
  it('revalidates every tag of a signed, well-formed event', () => {
    const body = JSON.stringify({ eventId: 'e1', tags: ['author:u1', 'post:hello', 'posts'] });
    expect(call(body)).toEqual({
      outcome: { status: 200, eventId: 'e1', tags: ['author:u1', 'post:hello', 'posts'] },
      revalidated: ['author:u1', 'post:hello', 'posts'],
    });
  });

  it('touches nothing for an unsigned, forged or replayed request', () => {
    const body = JSON.stringify({ eventId: 'e1', tags: ['posts'] });
    expect(call(body, null)).toEqual({
      outcome: { status: 401, reason: 'missing' },
      revalidated: [],
    });
    expect(call(body, signRevalidation('x'.repeat(44), body, NOW))).toEqual({
      outcome: { status: 401, reason: 'signature' },
      revalidated: [],
    });
    expect(call(body, signRevalidation(SECRET, body, NOW - 301))).toEqual({
      outcome: { status: 401, reason: 'stale' },
      revalidated: [],
    });
  });

  it('refuses a signed body that is not JSON or names a tag the site never uses', () => {
    expect(call('not json')).toEqual({
      outcome: { status: 400, reason: 'payload' },
      revalidated: [],
    });
    for (const tags of [[], ['Posts'], ['post:../x'], ['/studio']]) {
      expect(call(JSON.stringify({ eventId: 'e1', tags }))).toEqual({
        outcome: { status: 400, reason: 'payload' },
        revalidated: [],
      });
    }
  });
});
