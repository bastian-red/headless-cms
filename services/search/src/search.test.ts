import { describe, expect, it } from 'vitest';

import { decodeSearchCursor, encodeSearchCursor, queryKey } from './cursor';
import {
  HEADLINE_OPTIONS,
  MATCH_START as S,
  MATCH_STOP as E,
  parseHeadline,
  snippetOf,
} from './snippet';

describe('parseHeadline', () => {
  it('splits a marked headline into runs', () => {
    expect(parseHeadline(`A ${S}cache${E} in front, ${S}Caching${E} pages`)).toEqual([
      { text: 'A ', match: false },
      { text: 'cache', match: true },
      { text: ' in front, ', match: false },
      { text: 'Caching', match: true },
      { text: ' pages', match: false },
    ]);
  });

  it('merges adjacent matches and drops empty runs', () => {
    expect(parseHeadline(`${S}edge${E}${S}cache${E}`)).toEqual([
      { text: 'edgecache', match: true },
    ]);
    expect(parseHeadline('')).toEqual([]);
  });

  it('is plain text when nothing is marked', () => {
    expect(parseHeadline('Opening words.')).toEqual([{ text: 'Opening words.', match: false }]);
  });
});

describe('snippetOf', () => {
  it('keeps a headline with a match', () => {
    expect(snippetOf(`x ${S}y${E}`, 'Excerpt.')).toEqual([
      { text: 'x ', match: false },
      { text: 'y', match: true },
    ]);
  });

  it('uses the excerpt when the body did not match', () => {
    expect(snippetOf('The opening words of the body.', 'Excerpt.')).toEqual([
      { text: 'Excerpt.', match: false },
    ]);
  });

  it('keeps the headline when there is no excerpt to prefer', () => {
    expect(snippetOf('Opening.', '')).toEqual([{ text: 'Opening.', match: false }]);
  });
});

describe('HEADLINE_OPTIONS', () => {
  it('marks with the two control characters searchText strips', () => {
    expect(HEADLINE_OPTIONS).toContain(`StartSel=${S}`);
    expect(HEADLINE_OPTIONS).toContain(`StopSel=${E}`);
    expect([S, E].map((c) => c.charCodeAt(0))).toEqual([2, 3]);
  });
});

describe('search cursors', () => {
  const cursor = {
    titleHit: 1 as const,
    rank: Math.fround(0.4433),
    publishedAt: new Date('2026-10-20T08:00:00.000Z'),
    id: 'cpost000000000000000000001',
  };

  it('round-trip exactly, a float4 rank included', () => {
    expect(decodeSearchCursor(encodeSearchCursor(cursor, 'caching'), 'caching')).toEqual(cursor);
    expect(Math.fround(decodeSearchCursor(encodeSearchCursor(cursor, 'q'), 'q').rank)).toBe(
      cursor.rank,
    );
  });

  it('belong to the query they were issued for', () => {
    const value = encodeSearchCursor(cursor, 'caching');
    expect(() => decodeSearchCursor(value, 'caching edge')).toThrow(
      expect.objectContaining({ code: 'INVALID' }),
    );
    expect(queryKey('a')).not.toBe(queryKey('b'));
  });

  it.each([
    ['not base64 JSON', 'garbage'],
    [
      'a negative rank',
      Buffer.from(
        JSON.stringify({
          h: 1,
          r: -1,
          t: '2026-10-20T08:00:00.000Z',
          i: cursor.id,
          q: queryKey('q'),
        }),
      ).toString('base64url'),
    ],
    [
      'a bad id',
      Buffer.from(
        JSON.stringify({ h: 0, r: 0, t: '2026-10-20T08:00:00.000Z', i: 'x;', q: queryKey('q') }),
      ).toString('base64url'),
    ],
  ])('refuse %s', (_, value) => {
    expect(() => decodeSearchCursor(value, 'q')).toThrow(
      expect.objectContaining({ code: 'INVALID' }),
    );
  });
});
