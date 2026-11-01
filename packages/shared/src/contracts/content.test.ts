import { describe, expect, it } from 'vitest';

import {
  LIMITS,
  readingMinutes,
  SLUG_PATTERN,
  slugify,
  slugSchema,
  WORDS_PER_MINUTE,
} from './content';

describe('slugSchema', () => {
  it.each(['rendering', 'rendering-at-the-edge', 'web-vitals-2026', 'a'])('accepts %s', (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(true);
  });

  it.each([
    '',
    'Upper',
    '-leading',
    'trailing-',
    'double--hyphen',
    'under_score',
    'sp ace',
    'ñandú',
  ])('refuses %j', (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(false);
  });

  it(`refuses a slug over ${String(LIMITS.slug)} characters and accepts one at the limit`, () => {
    expect(slugSchema.safeParse('a'.repeat(LIMITS.slug)).success).toBe(true);
    expect(slugSchema.safeParse('a'.repeat(LIMITS.slug + 1)).success).toBe(false);
  });
});

describe('slugify', () => {
  it('lowercases and joins words with single hyphens', () => {
    expect(slugify('Rendering at the Edge')).toBe('rendering-at-the-edge');
  });

  it('folds accents instead of dropping the letter', () => {
    expect(slugify('Café com Ñandú')).toBe('cafe-com-nandu');
  });

  it('treats punctuation runs as one separator and trims both ends', () => {
    expect(slugify('  "Why ISR?" -- a field guide!  ')).toBe('why-isr-a-field-guide');
  });

  it('cuts at a word boundary under the limit, never mid-word', () => {
    const title = Array.from({ length: 30 }, () => 'word').join(' ');
    const slug = slugify(title)!;
    expect(slug.length).toBeLessThanOrEqual(LIMITS.slug);
    expect(slug.endsWith('word')).toBe(true);
    expect(slug).toMatch(SLUG_PATTERN);
  });

  it('cuts one word longer than the limit to the limit', () => {
    expect(slugify('x'.repeat(LIMITS.slug + 10))).toBe('x'.repeat(LIMITS.slug));
  });

  it('returns null for a title with nothing sluggable, so the caller asks', () => {
    expect(slugify('?!… —')).toBeNull();
    expect(slugify('')).toBeNull();
  });

  it('always produces something the schema accepts', () => {
    for (const title of [
      'Ünïcödé Tïtlé',
      '2026: the year in review',
      'a - b - c',
      'ISR/SSG & SSR',
    ]) {
      const slug = slugify(title);
      expect(slug === null || slugSchema.safeParse(slug).success).toBe(true);
    }
  });
});

describe('readingMinutes', () => {
  // Run with Math.max(1, Math.round(w / 230)) before being typed here.
  it.each([
    [0, 1],
    [114, 1],
    [344, 1],
    [345, 2],
    [3451, 15],
  ])('%i words read in %i min', (words, minutes) => {
    expect(readingMinutes(words)).toBe(minutes);
    expect(WORDS_PER_MINUTE).toBe(230);
  });
});
