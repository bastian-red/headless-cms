import { z } from 'zod';

/**
 * The content vocabulary: post and comment states, the slug format, and every
 * length limit.
 *
 * The database holds each of these as a CHECK constraint (`packages/db`
 * migrations), and `content.test.ts` in `@cms/db` reads the migration SQL and
 * fails if a number here and a number there disagree. So a limit raised in one
 * place and forgotten in the other is a red gate test, not a 500 the first
 * time somebody writes a long title.
 */

/**
 * Where a post's PENDING work stands. Whether readers can see the post is a
 * separate fact: a post is live exactly when it has a published revision.
 *
 * - `DRAFT`: there is unpublished work (the head revision is not the live one).
 * - `IN_REVIEW`: that work is waiting for an editor.
 * - `SCHEDULED`: an editor approved it to go live at `scheduledFor`.
 * - `PUBLISHED`: live, and the head revision IS the live one. Nothing pending.
 * - `UNPUBLISHED`: taken down; readers see nothing.
 *
 * So a live post being re-edited is `DRAFT` while readers keep seeing the old
 * revision. The database enforces every one of these sentences (see the
 * `posts_*_check` constraints).
 */
export const POST_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'SCHEDULED',
  'PUBLISHED',
  'UNPUBLISHED',
] as const;
export const postStatusSchema = z.enum(POST_STATUSES);
export type PostStatus = z.infer<typeof postStatusSchema>;

/** The states with work an editor has not yet put in front of readers. */
export const PENDING_STATUSES: readonly PostStatus[] = ['DRAFT', 'IN_REVIEW', 'SCHEDULED'];

/** Only `APPROVED` is ever rendered publicly. */
export const COMMENT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SPAM'] as const;
export const commentStatusSchema = z.enum(COMMENT_STATUSES);
export type CommentStatus = z.infer<typeof commentStatusSchema>;

/** Reading speed for the reading time every surface shows: page, list, studio. */
export const WORDS_PER_MINUTE = 230;

/**
 * Minutes to read `words` words, never less than one. One rule, here, because
 * the renderer computes it from a body and the content API from the count
 * stored on a revision, and a list that said 14 min beside a page that said
 * 15 would be the product contradicting itself.
 */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/**
 * Every length limit, in characters. The SEO pair follows what search results
 * show before truncating (about 60-70 and 155-160), so a limit here is a
 * promise the snippet will not be cut mid-word by the engine.
 */
export const LIMITS = Object.freeze({
  slug: 96,
  title: 160,
  excerpt: 300,
  body: 200_000,
  seoTitle: 70,
  seoDescription: 160,
  tagName: 40,
  commentName: 80,
  commentBody: 2_000,
  mediaAlt: 300,
});

/**
 * Lowercase words joined by single hyphens: `rendering-at-the-edge`. No leading
 * or trailing hyphen, no doubled one, nothing a URL would have to escape. The
 * Postgres CHECK uses the same pattern, spelled for POSIX regex.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const slugSchema = z
  .string()
  .max(LIMITS.slug)
  .regex(SLUG_PATTERN, 'Use lowercase words joined by hyphens.');
export type Slug = z.infer<typeof slugSchema>;

/**
 * Turns a title into a slug candidate. Accents fold to their base letter (`é`
 * to `e`), everything else outside `[a-z0-9]` becomes a separator, and the
 * result is cut at a word boundary under the limit. An empty result (a title
 * of only punctuation) returns `null`; the caller asks for a slug instead of
 * inventing one.
 */
export function slugify(title: string): Slug | null {
  const words = title
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word !== '');
  let slug = '';
  for (const word of words) {
    const next = slug === '' ? word : `${slug}-${word}`;
    if (next.length > LIMITS.slug) break;
    slug = next;
  }
  if (slug === '') {
    const first = words[0];
    return first === undefined ? null : first.slice(0, LIMITS.slug);
  }
  return slug;
}
