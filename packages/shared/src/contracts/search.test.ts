import { describe, expect, it } from 'vitest';

import { SEARCH_PAGE_DEFAULT, SEARCH_QUERY_MAX, searchText, v1SearchQuerySchema } from './search';

describe('searchText', () => {
  it('turns every control character into a space, so no text can carry a snippet marker', () => {
    const forged = 'before\u0002forged highlight\u0003after\u0000\u001f\u007f\u0085end';
    expect(searchText(forged)).toBe('before forged highlight after end');
    // eslint-disable-next-line no-control-regex -- asserting their absence
    expect(searchText(forged)).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
  });

  it('collapses whitespace, newlines included, and trims', () => {
    expect(searchText('  one\n\n two\t three  ')).toBe('one two three');
  });

  it('leaves ordinary text, accents and punctuation alone', () => {
    expect(searchText('Café à la carte: "quoted" -not')).toBe('Café à la carte: "quoted" -not');
  });
});

describe('v1SearchQuerySchema', () => {
  it('normalizes the query and defaults the page size', () => {
    expect(v1SearchQuerySchema.parse({ q: '  edge\ncaching ' })).toEqual({
      q: 'edge caching',
      limit: SEARCH_PAGE_DEFAULT,
    });
  });

  it('refuses a query that is empty once normalized, or longer than the cap', () => {
    expect(v1SearchQuerySchema.safeParse({ q: ' \n\t ' }).success).toBe(false);
    expect(v1SearchQuerySchema.safeParse({}).success).toBe(false);
    expect(v1SearchQuerySchema.safeParse({ q: 'a'.repeat(SEARCH_QUERY_MAX) }).success).toBe(true);
    expect(v1SearchQuerySchema.safeParse({ q: 'a'.repeat(SEARCH_QUERY_MAX + 1) }).success).toBe(
      false,
    );
  });
});
