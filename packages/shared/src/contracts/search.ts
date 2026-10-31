/**
 * Full-text search: what a search document holds and what `GET /v1/search`
 * takes and answers.
 *
 * The SQL lives in `@cms/search`. What is here is shared by the writers of
 * search documents (the API on every save, the seed) and by every reader of
 * results, so the two cannot disagree about the text or the shapes.
 */
import { z } from 'zod';

import { v1PostSummarySchema } from './content-api';

/** A longer query is a paste, not a search; refused at the boundary. */
export const SEARCH_QUERY_MAX = 200;
export const SEARCH_PAGE_DEFAULT = 10;
export const SEARCH_PAGE_MAX = 50;

/**
 * Text as a search document stores it: every control character becomes a
 * space and whitespace runs collapse to one. Two reasons. Snippets are cut by
 * `ts_headline` with control characters as the match markers (`@cms/search`),
 * so indexed text must never contain one, or a body could forge a highlight.
 * And a snippet is shown on one line, so a newline in it is noise.
 */
export function searchText(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex -- stripping them is the point
      .replace(/[\u0000-\u001f\u007f\u0080-\u009f]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
  );
}

export interface SearchDocumentInput {
  readonly title: string;
  readonly excerpt: string;
  /** `render().text` of the body: what a reader sees, not the markdown source. */
  readonly text: string;
}

/**
 * The row a revision gets in `search_documents`. One function for every
 * writer (the API's save path, the seed, `pnpm search:reindex`), so they
 * cannot store different text for the same revision.
 */
export function searchDocument(revisionId: string, input: SearchDocumentInput) {
  return {
    revisionId,
    title: searchText(input.title),
    excerpt: searchText(input.excerpt),
    body: searchText(input.text),
  };
}

export const v1SearchQuerySchema = z.object({
  q: z
    .string()
    .transform(searchText)
    .pipe(z.string().min(1, 'Type something to search for.').max(SEARCH_QUERY_MAX)),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(SEARCH_PAGE_MAX).default(SEARCH_PAGE_DEFAULT),
});
export type V1SearchQuery = z.infer<typeof v1SearchQuerySchema>;

/**
 * A snippet as data, not HTML: runs of text, the matched ones flagged. A
 * client wraps `match` runs in `<mark>` itself, so no markup ever crosses the
 * API and a body cannot inject any through its own text.
 */
export const snippetPartSchema = z.object({ text: z.string(), match: z.boolean() });
export type SnippetPart = z.infer<typeof snippetPartSchema>;

export const v1SearchHitSchema = v1PostSummarySchema.extend({
  /** Where the body matched; the excerpt (no `match` runs) when only the title or excerpt did. */
  snippet: z.array(snippetPartSchema),
});
export type V1SearchHit = z.infer<typeof v1SearchHitSchema>;

export const v1SearchResultSchema = z.object({
  /** The query as it was searched for (whitespace and control characters normalized). */
  query: z.string(),
  /** Every live post that matches, not only this page. */
  total: z.number().int().nonnegative(),
  items: z.array(v1SearchHitSchema),
  nextCursor: z.string().nullable(),
});
export type V1SearchResult = z.infer<typeof v1SearchResultSchema>;
