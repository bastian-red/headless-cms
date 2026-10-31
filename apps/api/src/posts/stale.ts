/**
 * What changed between the revision an editor started from and the one that
 * won: the `details` of a stale save's 409.
 *
 * Pure, so it is tested with plain objects. The body diff is a unified patch
 * (jsdiff's `createPatch`, the format `git diff` prints), which the studio
 * can show as is and which loses nothing: the editor's own text is still in
 * their editor, and this is the other side.
 */
import { REVISION_DIFF_FIELDS } from '@cms/shared';
import { createPatch } from 'diff';

export interface ComparableRevision {
  readonly title: string;
  readonly excerpt: string;
  readonly body: string;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly tags: readonly string[];
}

export type DiffField = (typeof REVISION_DIFF_FIELDS)[number];

const sameTags = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((tag, i) => tag === [...b].sort()[i]);

/** The fields that differ, in the studio's display order. */
export function changedFields(base: ComparableRevision, current: ComparableRevision): DiffField[] {
  return REVISION_DIFF_FIELDS.filter((field) =>
    field === 'tags' ? !sameTags(base.tags, current.tags) : base[field] !== current[field],
  );
}

export function bodyPatch(base: string, current: string): string {
  return base === current ? '' : createPatch('body', base, current, 'your base', 'saved since');
}
