import { z } from 'zod';

/**
 * Cache tags: the names the public site tags its cached pages with
 * (`cacheTag`) and the API puts in a revalidation event when what readers see
 * changes. One spelling for both sides, or a publish revalidates nothing.
 *
 * - `posts`: every listing (home, feed, sitemap, search results).
 * - `post:<slug>`: one post page. A rename names both slugs.
 * - `tag:<slug>`: one tag page.
 * - `author:<id>`: one author page.
 */
export const POSTS_TAG = 'posts';
export const postTag = (slug: string): string => `post:${slug}`;
export const tagTag = (slug: string): string => `tag:${slug}`;
export const authorTag = (id: string): string => `author:${id}`;

export const cacheTagSchema = z
  .string()
  .regex(/^(posts|post:[a-z0-9-]+|tag:[a-z0-9-]+|author:[a-z0-9]+)$/u);

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
