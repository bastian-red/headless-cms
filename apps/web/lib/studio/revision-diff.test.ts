import type { RevisionView } from '@cms/shared';
import { describe, expect, it } from 'vitest';

import { diffRevisions, foldUnchanged } from './revision-diff';

const base: RevisionView = {
  id: 'a',
  number: 1,
  parentRevisionId: null,
  restoredFromId: null,
  author: { id: 'u', name: 'U' },
  title: 'Exactly once',
  excerpt: 'Short.',
  body: 'One\nTwo\nThree\n',
  seoTitle: null,
  seoDescription: null,
  tags: [
    { slug: 'pg', name: 'Postgres' },
    { slug: 'q', name: 'Queues' },
  ],
  createdAt: '2026-10-31T00:00:00.000Z',
};
const next: RevisionView = {
  ...base,
  id: 'b',
  title: 'Exactly once, never twice',
  body: 'One\nTwo and a half\nThree\n',
  seoTitle: 'Once',
  tags: [
    { slug: 'pg', name: 'Postgres' },
    { slug: 'r', name: 'Redis' },
  ],
};

// Expectations are the output of jsdiff 8.0.4 on these inputs, run before typing.
describe('diffRevisions', () => {
  const byField = Object.fromEntries(diffRevisions(base, next).map((d) => [d.field, d]));

  it('diffs one-line fields by word', () => {
    expect(byField.title?.parts).toEqual([
      { value: 'Exactly once', kind: 'same' },
      { value: ', never twice', kind: 'added' },
    ]);
    expect(byField.seoTitle?.parts).toEqual([{ value: 'Once', kind: 'added' }]);
  });

  it('diffs the body by line', () => {
    expect(byField.body?.parts).toEqual([
      { value: 'One\n', kind: 'same' },
      { value: 'Two\n', kind: 'removed' },
      { value: 'Two and a half\n', kind: 'added' },
      { value: 'Three\n', kind: 'same' },
    ]);
  });

  it('treats tags as a set, sorted by name', () => {
    expect(byField.tags?.parts).toEqual([
      { value: 'Postgres', kind: 'same' },
      { value: 'Queues', kind: 'removed' },
      { value: 'Redis', kind: 'added' },
    ]);
  });

  it('folds a long unchanged body down to the change and its context', () => {
    const long = Array.from({ length: 20 }, (_, i) => `Line ${String(i + 1)}\n`).join('');
    const edited = long.replace('Line 10\n', 'Line ten\n');
    const body = diffRevisions({ ...base, body: long }, { ...base, body: edited }).find(
      (d) => d.field === 'body',
    );
    expect(body?.parts.map((p) => p.kind)).toEqual([
      'fold',
      'same',
      'removed',
      'added',
      'same',
      'fold',
    ]);
    expect(body?.parts[0]).toEqual({ kind: 'fold', value: '7' });
  });

  it('marks what did not change, so the page can say so', () => {
    expect(
      diffRevisions(base, next)
        .filter((d) => !d.changed)
        .map((d) => d.field),
    ).toEqual(['excerpt', 'seoDescription']);
    expect(diffRevisions(base, base).every((d) => !d.changed)).toBe(true);
  });
});

describe('foldUnchanged', () => {
  const lines = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => `L${String(from + i)}\n`).join('');

  it('keeps two lines of context either side of a change and counts the rest', () => {
    const folded = foldUnchanged([
      { kind: 'same', value: lines(1, 10) },
      { kind: 'added', value: 'New\n' },
      { kind: 'same', value: lines(11, 20) },
      { kind: 'removed', value: 'Old\n' },
      { kind: 'same', value: lines(21, 30) },
    ]);
    expect(folded).toEqual([
      { kind: 'fold', value: '8' },
      { kind: 'same', value: 'L9\nL10\n' },
      { kind: 'added', value: 'New\n' },
      { kind: 'same', value: 'L11\nL12\n' },
      { kind: 'fold', value: '6' },
      { kind: 'same', value: 'L19\nL20\n' },
      { kind: 'removed', value: 'Old\n' },
      { kind: 'same', value: 'L21\nL22\n' },
      { kind: 'fold', value: '8' },
    ]);
  });

  it('leaves a short run alone: folding one line saves nothing', () => {
    const short = [
      { kind: 'added' as const, value: 'A\n' },
      { kind: 'same' as const, value: lines(1, 5) },
      { kind: 'added' as const, value: 'B\n' },
    ];
    expect(foldUnchanged(short)).toEqual(short);
  });
});
