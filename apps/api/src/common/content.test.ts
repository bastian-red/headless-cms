import type { Role } from '@cms/shared';
import { describe, expect, it } from 'vitest';

import { refusal } from './actor.guard';
import { decodeCursor, encodeCursor, page } from './cursor';
import { etagOf, matches } from './etag';

describe('cursors', () => {
  const at = new Date('2026-10-20T08:00:00.000Z');
  const id = 'cpost000000000000000000001';

  it('round-trip the sort key exactly', () => {
    expect(decodeCursor(encodeCursor({ at, id }))).toEqual({ at, id });
  });

  it.each([
    ['not base64 JSON', 'bm90LWEtY3Vyc29y'],
    ['empty', ''],
    [
      'a bad id',
      Buffer.from(JSON.stringify({ t: at.toISOString(), i: 'X;DROP' })).toString('base64url'),
    ],
    ['a bad time', Buffer.from(JSON.stringify({ t: 'yesterday', i: id })).toString('base64url')],
  ])('refuse %s with INVALID (400)', (_, value) => {
    expect(() => decodeCursor(value)).toThrow(expect.objectContaining({ code: 'INVALID' }));
  });

  it('page: the extra row only proves a next page and is never returned', () => {
    const rows = [1, 2, 3].map((n) => ({
      n,
      at: new Date(at.getTime() - n),
      id: `${id.slice(0, -1)}${String(n)}`,
    }));
    const full = page(rows, 2, (r) => r);
    expect(full.items.map((r) => r.n)).toEqual([1, 2]);
    expect(decodeCursor(full.nextCursor!)).toEqual({ at: rows[1]!.at, id: rows[1]!.id });
    expect(page(rows, 3, (r) => r).nextCursor).toBeNull();
  });
});

describe('ETags', () => {
  it('is a strong tag of 27 base64url characters, stable for the same JSON', () => {
    expect(etagOf('{"a":1}')).toMatch(/^"[\w-]{27}"$/u);
    expect(etagOf('{"a":1}')).toBe(etagOf('{"a":1}'));
    expect(etagOf('{"a":1}')).not.toBe(etagOf('{"a":2}'));
  });

  it('matches a list, a weak form, and *; not a different tag or no header', () => {
    const tag = etagOf('x');
    expect(matches(tag, tag)).toBe(true);
    expect(matches(`"other", ${tag}`, tag)).toBe(true);
    expect(matches(`W/${tag}`, tag)).toBe(true);
    expect(matches('*', tag)).toBe(true);
    expect(matches('"other"', tag)).toBe(false);
    expect(matches(undefined, tag)).toBe(false);
  });
});

describe('refusal', () => {
  const actor = (role: Role) => ({ id: 'cuser1', name: 'A', role });
  it('allows a route with no required action to any role', () => {
    expect(refusal(actor('AUTHOR'), undefined)).toBeNull();
  });
  it('refuses with FORBIDDEN exactly where the role table says no', () => {
    expect(refusal(actor('AUTHOR'), 'post.publish')).toMatchObject({ code: 'FORBIDDEN' });
    expect(refusal(actor('EDITOR'), 'post.publish')).toBeNull();
    expect(refusal(actor('EDITOR'), 'apikey.manage')).toMatchObject({ code: 'FORBIDDEN' });
    expect(refusal(actor('ADMIN'), 'apikey.manage')).toBeNull();
  });
});
