import type { Role } from '@cms/shared';
import { describe, expect, it } from 'vitest';

import { canTouch, seesEveryPost } from './ownership';
import { bodyPatch, changedFields, type ComparableRevision } from './stale';

const base: ComparableRevision = {
  title: 'A title',
  excerpt: 'An excerpt.',
  body: 'line one\nline two\nline three\n',
  seoTitle: null,
  seoDescription: null,
  tags: ['caching', 'rendering'],
};

describe('changedFields', () => {
  it('is empty for an identical revision, including tags in another order', () => {
    expect(changedFields(base, { ...base, tags: ['rendering', 'caching'] })).toEqual([]);
  });

  it('names every field that differs, in the studio display order', () => {
    expect(
      changedFields(base, { ...base, body: 'x', title: 'B', seoTitle: '', tags: ['caching'] }),
    ).toEqual(['title', 'body', 'seoTitle', 'tags']);
  });

  it('treats a null SEO field and an empty one as different (one is "use the title")', () => {
    expect(changedFields(base, { ...base, seoDescription: '' })).toEqual(['seoDescription']);
  });

  it('does not mutate the tag arrays it compares', () => {
    const tags = ['rendering', 'caching'];
    changedFields({ ...base, tags }, base);
    expect(tags).toEqual(['rendering', 'caching']);
  });
});

describe('bodyPatch', () => {
  it('is empty when the bodies match', () => {
    expect(bodyPatch(base.body, base.body)).toBe('');
  });

  it('is a unified diff from the base to what was saved since', () => {
    const patch = bodyPatch(base.body, 'line one\nline 2\nline three\n');
    expect(patch).toContain('--- body\tyour base');
    expect(patch).toContain('+++ body\tsaved since');
    expect(patch).toMatch(/^-line two$/mu);
    expect(patch).toMatch(/^\+line 2$/mu);
    expect(patch).toMatch(/^ line one$/mu);
  });
});

describe('ownership', () => {
  const me = 'cuser00000000000000000001';
  const them = 'cuser00000000000000000002';
  const cases: [Role, boolean][] = [
    ['AUTHOR', false],
    ['EDITOR', true],
    ['ADMIN', true],
  ];
  it.each(cases)("%s touches their own post, and somebody else's: %s", (role, others) => {
    expect(canTouch({ id: me, role }, me)).toBe(true);
    expect(canTouch({ id: me, role }, them)).toBe(others);
    expect(seesEveryPost({ id: me, role })).toBe(others);
  });
});
