import { describe, expect, it } from 'vitest';

import { signRevalidation, verifyRevalidation } from './webhook';

const SECRET = 's'.repeat(32);
const BODY = '{"eventId":"e1","tags":["posts"]}';
const NOW = 1_793_462_400;

describe('signRevalidation', () => {
  it('signs "<t>.<body>" with HMAC-SHA256 (value computed with node:crypto, not recalled)', () => {
    expect(signRevalidation(SECRET, BODY, NOW)).toBe(
      't=1793462400,v1=a3e2d16de7a9ca252ab97b7676b9fd9549d27be08c80b189fc3312eb87d3372e',
    );
  });
});

describe('verifyRevalidation', () => {
  const header = signRevalidation(SECRET, BODY, NOW);

  it('accepts its own signature, inside the tolerance either side', () => {
    expect(verifyRevalidation(SECRET, header, BODY, NOW)).toEqual({ ok: true });
    expect(verifyRevalidation(SECRET, header, BODY, NOW + 300)).toEqual({ ok: true });
    expect(verifyRevalidation(SECRET, header, BODY, NOW - 300)).toEqual({ ok: true });
  });

  it('refuses a replay older than the tolerance, and one from the future', () => {
    expect(verifyRevalidation(SECRET, header, BODY, NOW + 301)).toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(verifyRevalidation(SECRET, header, BODY, NOW - 301)).toEqual({
      ok: false,
      reason: 'stale',
    });
  });

  it('refuses a changed body, a changed timestamp, and another secret', () => {
    expect(verifyRevalidation(SECRET, header, BODY.replace('posts', 'post:x'), NOW)).toEqual({
      ok: false,
      reason: 'signature',
    });
    const moved = header.replace(`t=${String(NOW)}`, `t=${String(NOW + 1)}`);
    expect(verifyRevalidation(SECRET, moved, BODY, NOW)).toEqual({
      ok: false,
      reason: 'signature',
    });
    expect(verifyRevalidation('t'.repeat(32), header, BODY, NOW)).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('refuses a missing or malformed header without throwing', () => {
    expect(verifyRevalidation(SECRET, null, BODY, NOW)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyRevalidation(SECRET, '', BODY, NOW)).toEqual({ ok: false, reason: 'missing' });
    for (const bad of [
      't=1,v1=abc',
      'v1=' + 'a'.repeat(64),
      `t=${String(NOW)},v1=${'z'.repeat(64)}`,
    ]) {
      expect(verifyRevalidation(SECRET, bad, BODY, NOW)).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
  });
});
