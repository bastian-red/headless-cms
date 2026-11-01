import { describe, expect, it } from 'vitest';

import { LIMITS } from './content';
import {
  MAX_TAGS_PER_REVISION,
  createPostSchema,
  saveRevisionSchema,
  transitionSchema,
} from './studio';

const ID = 'c0123456789abcdef01234567';

describe('revision fields', () => {
  it('trims, defaults, and stores a blank SEO field as null', () => {
    expect(
      createPostSchema.parse({ title: '  A title  ', seoTitle: '  ', seoDescription: '' }),
    ).toEqual({
      title: 'A title',
      excerpt: '',
      body: '',
      seoTitle: null,
      seoDescription: null,
      tags: [],
    });
  });

  it('refuses a blank title, an over-long body, a repeated tag and too many tags', () => {
    const base = { baseRevisionId: ID, title: 'T' };
    expect(saveRevisionSchema.safeParse({ ...base, title: '   ' }).success).toBe(false);
    expect(
      saveRevisionSchema.safeParse({ ...base, body: 'x'.repeat(LIMITS.body + 1) }).success,
    ).toBe(false);
    expect(saveRevisionSchema.safeParse({ ...base, tags: ['a', 'a'] }).success).toBe(false);
    const many = Array.from({ length: MAX_TAGS_PER_REVISION + 1 }, (_, i) => `t${String(i)}`);
    expect(saveRevisionSchema.safeParse({ ...base, tags: many }).success).toBe(false);
  });

  it('stores a body with LF line endings whatever the browser sent', () => {
    // A form posts a textarea as CRLF; old Mac text uses a bare CR.
    const saved = saveRevisionSchema.parse({
      baseRevisionId: ID,
      title: 'T',
      body: 'a\r\n\r\nb\rc',
    });
    expect(saved.body).toBe('a\n\nb\nc');
    // The limit counts the stored text, so CRLF does not count double.
    const atLimit = 'x\r\n'.repeat(LIMITS.body / 2);
    expect(
      saveRevisionSchema.safeParse({ baseRevisionId: ID, title: 'T', body: atLimit }).success,
    ).toBe(true);
  });

  it('requires the base revision on a save', () => {
    expect(saveRevisionSchema.safeParse({ title: 'T' }).success).toBe(false);
  });
});

describe('transitions', () => {
  it('needs a time for a schedule and nothing else for the rest', () => {
    expect(transitionSchema.safeParse({ action: 'schedule', revisionId: ID }).success).toBe(false);
    expect(
      transitionSchema.safeParse({
        action: 'schedule',
        revisionId: ID,
        scheduledFor: '2026-11-02T09:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(transitionSchema.parse({ action: 'publish', revisionId: ID })).toEqual({
      action: 'publish',
      revisionId: ID,
    });
  });

  it('refuses an action that is not in the workflow', () => {
    expect(transitionSchema.safeParse({ action: 'delete', revisionId: ID }).success).toBe(false);
  });
});
