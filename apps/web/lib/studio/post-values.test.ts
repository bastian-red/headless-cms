import { describe, expect, it } from 'vitest';

import { sameValues, type PostValues } from './post-values';

const base: PostValues = {
  title: 'Exactly once',
  excerpt: 'Short.',
  body: 'One\n',
  seoTitle: '',
  seoDescription: '',
  tags: ['pg', 'queues'],
};

describe('sameValues', () => {
  it('ignores tag order and the spaces the API trims', () => {
    expect(sameValues(base, { ...base, tags: ['queues', 'pg'] })).toBe(true);
    expect(sameValues(base, { ...base, title: 'Exactly once ' })).toBe(true);
  });

  it('counts every other difference, including whitespace in the body', () => {
    expect(sameValues(base, { ...base, body: 'One\n\n' })).toBe(false);
    expect(sameValues(base, { ...base, tags: ['pg'] })).toBe(false);
    expect(sameValues(base, { ...base, tags: ['pg', 'redis'] })).toBe(false);
    expect(sameValues(base, { ...base, seoTitle: 'Once' })).toBe(false);
  });
});
