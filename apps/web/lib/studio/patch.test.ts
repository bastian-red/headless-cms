import { describe, expect, it } from 'vitest';

import { patchLines } from './patch';

// Inputs are jsdiff 8.0.4 `createPatch` output, printed with JSON.stringify and pasted.
describe('patchLines', () => {
  it('drops the file headers and keeps each line with its sign as a kind', () => {
    const patch =
      'Index: body\n===================================================================\n' +
      '--- body\tyour base\n+++ body\tsaved since\n@@ -1,3 +1,4 @@\n One\n-Two\n+Two and a half\n Three\n+Four\n';
    expect(patchLines(patch)).toEqual([
      { kind: 'hunk', text: '@@ -1,3 +1,4 @@' },
      { kind: 'same', text: 'One' },
      { kind: 'removed', text: 'Two' },
      { kind: 'added', text: 'Two and a half' },
      { kind: 'same', text: 'Three' },
      { kind: 'added', text: 'Four' },
    ]);
  });

  it('ignores the no-newline markers', () => {
    const patch =
      'Index: body\n===================================================================\n--- body\n+++ body\n' +
      '@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n';
    expect(patchLines(patch)).toEqual([
      { kind: 'hunk', text: '@@ -1,1 +1,1 @@' },
      { kind: 'removed', text: 'a' },
      { kind: 'added', text: 'b' },
    ]);
  });

  it('has nothing to show for an empty patch (the body did not change)', () => {
    expect(patchLines('')).toEqual([]);
  });
});
