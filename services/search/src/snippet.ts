/**
 * Snippets as data.
 *
 * `ts_headline` marks each match with a start and a stop string. These are
 * two control characters, which `searchText` (`@cms/shared`) removes from
 * every stored document, so a marker in a headline can only be one Postgres
 * put there. The headline is split on them into runs of text, and the API
 * answers with the runs, never with HTML: a client puts the `match` runs in
 * `<mark>` itself.
 */
import type { SnippetPart } from '@cms/shared';

export const MATCH_START = '\u0002';
export const MATCH_STOP = '\u0003';

/**
 * Up to two fragments of 12 to 30 words around the matches, joined by an
 * ellipsis: about two lines of a results list each, enough context to judge
 * a hit without opening it.
 */
export const HEADLINE_OPTIONS = [
  `StartSel=${MATCH_START}`,
  `StopSel=${MATCH_STOP}`,
  'MaxWords=30',
  'MinWords=12',
  'MaxFragments=2',
  'FragmentDelimiter=" … "',
].join(', ');

/** Split a marked headline into runs. Adjacent runs of the same kind are merged; empty runs dropped. */
export function parseHeadline(headline: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  const push = (text: string, match: boolean) => {
    if (text === '') return;
    const last = parts.at(-1);
    if (last !== undefined && last.match === match) last.text += text;
    else parts.push({ text, match });
  };
  let match = false;
  let run = '';
  for (const char of headline) {
    if (char === MATCH_START || char === MATCH_STOP) {
      push(run, match);
      run = '';
      match = char === MATCH_START;
    } else {
      run += char;
    }
  }
  push(run, match);
  return parts;
}

/**
 * The snippet for one hit. When the body has no match (the title or excerpt
 * did), `ts_headline` returns the opening words with nothing marked, which
 * says nothing about why the post matched; the excerpt says more.
 */
export function snippetOf(headline: string, excerpt: string): SnippetPart[] {
  const parts = parseHeadline(headline);
  if (parts.some((p) => p.match) || excerpt === '') return parts;
  return [{ text: excerpt, match: false }];
}
