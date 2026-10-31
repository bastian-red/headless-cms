import { z } from 'zod';

/**
 * Cache tags: the names the public site tags its cached content reads with
 * (`fetch(..., { next: { tags } })` in apps/web/lib/content.ts) and the API
 * puts in a revalidation event when what readers see changes. One spelling for
 * both sides, or a publish revalidates nothing.
 *
 * - `posts`: every listing (home, archive, tag index, feed, sitemap) and every
 *   tag and author page. Search results are read per request, never cached.
 * - `post:<slug>`: one post page. A rename names both slugs.
 * - `tag:<slug>`: one tag page.
 * - `author:<id>`: one author page.
 * - `comments:<slug>`: the approved comments under one post. An editor's
 *   decision revalidates only this, so the post's own read stays cached.
 */
export const POSTS_TAG = 'posts';
export const postTag = (slug: string): string => `post:${slug}`;
export const tagTag = (slug: string): string => `tag:${slug}`;
export const authorTag = (id: string): string => `author:${id}`;
export const commentsTag = (slug: string): string => `comments:${slug}`;

export const cacheTagSchema = z
  .string()
  .regex(/^(posts|post:[a-z0-9-]+|tag:[a-z0-9-]+|author:[a-z0-9]+|comments:[a-z0-9-]+)$/u);

/** The webhook body the publisher delivers to `POST /api/revalidate` (step 7). */
export const revalidationPayloadSchema = z.object({
  eventId: z.string().min(1),
  tags: z.array(cacheTagSchema).min(1),
});

/** Everything a change to one post's public face invalidates, sorted and unique. */
export function tagsForPost(input: {
  slugs: readonly string[];
  tagSlugs: readonly string[];
  authorId: string;
}): string[] {
  return [
    ...new Set([
      POSTS_TAG,
      ...input.slugs.map(postTag),
      ...input.tagSlugs.map(tagTag),
      authorTag(input.authorId),
    ]),
  ].sort();
}
