/**
 * The editor's fields as plain values, and the one comparison that decides
 * "unsaved changes". Tags compare as a set: ticking A then B is the same
 * revision as ticking B then A, and must not read as an edit.
 */
import type { RevisionView } from '@cms/shared';

export interface PostValues {
  readonly title: string;
  readonly excerpt: string;
  readonly body: string;
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly tags: readonly string[];
}

export function valuesOf(revision: RevisionView): PostValues {
  return {
    title: revision.title,
    excerpt: revision.excerpt,
    body: revision.body,
    seoTitle: revision.seoTitle ?? '',
    seoDescription: revision.seoDescription ?? '',
    tags: revision.tags.map((tag) => tag.slug),
  };
}

/**
 * Whether two sets of values would save as the same revision. Text fields
 * other than the body compare trimmed, because the API trims them: a trailing
 * space typed into the title is not an unsaved change the API would keep.
 */
export function sameValues(a: PostValues, b: PostValues): boolean {
  const short = ['title', 'excerpt', 'seoTitle', 'seoDescription'] as const;
  if (short.some((field) => a[field].trim() !== b[field].trim())) return false;
  if (a.body !== b.body) return false;
  const tags = new Set(a.tags);
  return a.tags.length === b.tags.length && b.tags.every((tag) => tags.has(tag));
}
