/**
 * The unified diff a stale save carries (`details.bodyPatch`, from jsdiff's
 * `createPatch` in the API), as lines a screen can show: the file headers are
 * dropped, each line keeps its sign as a glyph and a word for assistive
 * technology, never colour alone.
 */
export interface PatchLine {
  readonly kind: 'hunk' | 'added' | 'removed' | 'same';
  readonly text: string;
}

export function patchLines(patch: string): PatchLine[] {
  const lines = patch.split('\n');
  const start = lines.findIndex((line) => line.startsWith('@@'));
  if (start === -1) return [];
  return lines
    .slice(start)
    .filter((line, i, all) => !(line === '' && i === all.length - 1))
    .filter((line) => !line.startsWith('\\ No newline'))
    .map((line): PatchLine => {
      if (line.startsWith('@@')) return { kind: 'hunk', text: line };
      if (line.startsWith('+')) return { kind: 'added', text: line.slice(1) };
      if (line.startsWith('-')) return { kind: 'removed', text: line.slice(1) };
      return { kind: 'same', text: line.slice(1) };
    });
}
