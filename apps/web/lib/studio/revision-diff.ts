/**
 * What changed between two revisions, field by field, for the history page.
 *
 * jsdiff (`diff`, the library the API's stale-save patch uses): words for
 * one-line fields, lines for the body, where a moved paragraph should read as
 * a paragraph. Tags are a set: what was added and what was removed.
 */
import type { RevisionView } from '@cms/shared';
import { diffLines, diffWords } from 'diff';

export interface Part {
  readonly value: string;
  /** `fold`: unchanged body lines left out; `value` is how many, as text. */
  readonly kind: 'same' | 'added' | 'removed' | 'fold';
}

/** Unchanged body lines kept around each change; the rest fold into a count. */
export const CONTEXT_LINES = 2;

/**
 * A 3,000-word post with one changed sentence should read as that sentence,
 * not as the whole post: an unchanged run longer than twice the context keeps
 * its first and last `CONTEXT_LINES` lines (only the side next to a change at
 * the start or end) and says how many it left out.
 */
export function foldUnchanged(list: readonly Part[]): Part[] {
  const out: Part[] = [];
  list.forEach((part, index) => {
    if (part.kind !== 'same') {
      out.push(part);
      return;
    }
    const lines = part.value.split(/(?<=\n)/u);
    const keepHead = index === 0 ? 0 : CONTEXT_LINES;
    const keepTail = index === list.length - 1 ? 0 : CONTEXT_LINES;
    if (lines.length <= keepHead + keepTail + 1) {
      out.push(part);
      return;
    }
    if (keepHead > 0) out.push({ kind: 'same', value: lines.slice(0, keepHead).join('') });
    out.push({ kind: 'fold', value: String(lines.length - keepHead - keepTail) });
    if (keepTail > 0) out.push({ kind: 'same', value: lines.slice(-keepTail).join('') });
  });
  return out;
}

export interface FieldDiff {
  readonly field: 'title' | 'excerpt' | 'seoTitle' | 'seoDescription' | 'tags' | 'body';
  readonly label: string;
  readonly changed: boolean;
  readonly parts: readonly Part[];
}

const LABELS = {
  title: 'Title',
  excerpt: 'Excerpt',
  seoTitle: 'Search title',
  seoDescription: 'Search description',
  tags: 'Tags',
  body: 'Body',
} as const;

const parts = (changes: { value: string; added?: boolean; removed?: boolean }[]): Part[] =>
  changes
    .filter((c) => c.value !== '')
    .map((c) => ({ value: c.value, kind: c.added ? 'added' : c.removed ? 'removed' : 'same' }));

function words(
  field: 'title' | 'excerpt' | 'seoTitle' | 'seoDescription',
  from: RevisionView,
  to: RevisionView,
): FieldDiff {
  const a = from[field] ?? '';
  const b = to[field] ?? '';
  return { field, label: LABELS[field], changed: a !== b, parts: parts(diffWords(a, b)) };
}

function tags(from: RevisionView, to: RevisionView): FieldDiff {
  const before = new Set(from.tags.map((t) => t.name));
  const after = new Set(to.tags.map((t) => t.name));
  const all = [...new Set([...before, ...after])].sort((x, y) => x.localeCompare(y, 'en'));
  const list: Part[] = all.map((name) => ({
    value: name,
    kind: before.has(name) && after.has(name) ? 'same' : after.has(name) ? 'added' : 'removed',
  }));
  return {
    field: 'tags',
    label: LABELS.tags,
    changed: list.some((p) => p.kind !== 'same'),
    parts: list,
  };
}

/** Every field of `from` against `to`, in the order the editor shows them. */
export function diffRevisions(from: RevisionView, to: RevisionView): FieldDiff[] {
  return [
    words('title', from, to),
    words('excerpt', from, to),
    tags(from, to),
    {
      field: 'body',
      label: LABELS.body,
      changed: from.body !== to.body,
      parts: foldUnchanged(parts(diffLines(from.body, to.body))),
    },
    words('seoTitle', from, to),
    words('seoDescription', from, to),
  ];
}
