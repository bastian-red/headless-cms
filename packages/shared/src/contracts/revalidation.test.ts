import { describe, expect, it } from 'vitest';

import { cacheTagSchema, tagsForPost } from './revalidation';

describe('tagsForPost', () => {
  it('names the listings, every slug, every tag and the author, once each, sorted', () => {
    expect(
      tagsForPost({
        slugs: ['new-name', 'old-name'],
        tagSlugs: ['caching', 'seo', 'caching'],
        authorId: 'c0123456789abcdef01234567',
      }),
    ).toEqual([
      'author:c0123456789abcdef01234567',
      'post:new-name',
      'post:old-name',
      'posts',
      'tag:caching',
      'tag:seo',
    ]);
  });

  it('produces only tags the webhook contract accepts', () => {
    const tags = tagsForPost({ slugs: ['a-b'], tagSlugs: ['c'], authorId: 'cabc123' });
    for (const tag of tags) expect(cacheTagSchema.safeParse(tag).success, tag).toBe(true);
    expect(cacheTagSchema.safeParse('post:../x').success).toBe(false);
  });
});
