/**
 * The search query. Every choice here was measured against 2,000 published
 * posts (`scripts/search-bench.mjs`); the numbers are in the migrations.
 *
 * - **Only published text can match.** Documents exist for every revision,
 *   drafts included. The GIN index covers only `live` ones, the flag the
 *   database derives from `posts.published_revision_id`, and the query joins
 *   on that same pointer as well, so a wrong flag still could not leak.
 * - **A title hit ranks above a body-only hit, always.** Weights alone do
 *   not promise that: on the seeded corpus a post using a word throughout
 *   its body out-scores one with it in the title. So the first sort key is
 *   whether the title matched (`title_vector`).
 * - **Then by `ts_rank` on the lead** (title A, excerpt B, the opening of the
 *   body C), normalized by length, then newest first. Ranking on the whole
 *   body cost over 250 ms for a word in every post; the opening is where a
 *   post says what it is about, and a deep mention still matches, ranked by
 *   recency.
 * - **`websearch_to_tsquery`**: the syntax readers already type into search
 *   engines. `"exact phrase"`, `or`, `-without`, and never a syntax error,
 *   whatever the input. A query of only stop words ("the") or only
 *   exclusions ("-edge") matches nothing.
 * - **Snippets are cut for one page only**, after ordering and the limit:
 *   from the lead when the match is there, else from a window around the
 *   first stem, else from the whole body (see the query).
 */
import { Prisma, type PrismaClient } from '@cms/db';
import type { SnippetPart } from '@cms/shared';

import { decodeSearchCursor, encodeSearchCursor } from './cursor';
import { HEADLINE_OPTIONS, MATCH_START, snippetOf } from './snippet';

/** One text search configuration everywhere: the generated columns use the same. */
export const SEARCH_CONFIG = 'english';

/** The snippet window: this many characters before the first stem, this many in all. */
export const WINDOW_BEFORE = 300;
export const WINDOW_CHARS = 900;

export interface SearchInput {
  /** Already normalized (`v1SearchQuerySchema`). */
  readonly query: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface SearchHit {
  readonly postId: string;
  readonly revisionId: string;
  readonly titleHit: boolean;
  readonly rank: number;
  readonly snippet: SnippetPart[];
}

export interface SearchPage {
  readonly query: string;
  readonly total: number;
  readonly hits: SearchHit[];
  readonly nextCursor: string | null;
}

interface Row {
  total: number;
  postId: string | null;
  revisionId: string | null;
  titleHit: number | null;
  rank: number | null;
  publishedAt: Date | null;
  headline: string | null;
  excerpt: string | null;
}

export type SearchClient = Pick<PrismaClient, '$queryRaw'>;

export async function searchPublished(db: SearchClient, input: SearchInput): Promise<SearchPage> {
  const after =
    input.cursor === undefined ? undefined : decodeSearchCursor(input.cursor, input.query);
  const resume =
    after === undefined
      ? Prisma.sql`TRUE`
      : Prisma.sql`(title_hit, rank, published_at, id) <
          (${after.titleHit}::int, ${after.rank}::real, ${after.publishedAt}::timestamptz, ${after.id}::text)`;

  const rows = await db.$queryRaw<Row[]>`
    WITH q AS (
      SELECT websearch_to_tsquery(${SEARCH_CONFIG}::regconfig, ${input.query}) AS query,
             -- Where to look for a snippet: the stems of every word typed.
             tsvector_to_array(to_tsvector(${SEARCH_CONFIG}::regconfig, ${input.query})) AS stems
    ),
    asked AS (
      -- A query has to ask for something: one of only exclusions ("-edge")
      -- has no indexable part (querytree 'T') and would walk the whole index
      -- to return nearly every post. It matches nothing, as on a web search.
      SELECT q.* FROM q WHERE querytree(q.query) NOT IN ('', 'T')
    ),
    hits AS (
      SELECT p.id, p.published_at, d.revision_id,
             (d.title_vector @@ q.query)::int AS title_hit,
             ts_rank(d.lead_vector, q.query, 1) AS rank
      FROM asked q
      JOIN search_documents d ON d.live AND d.vector @@ q.query
      JOIN posts p ON p.published_revision_id = d.revision_id
    ),
    top AS (
      -- A plain ORDER BY + LIMIT, so Postgres keeps a top-N heap instead of
      -- sorting every hit; the rows are numbered after the cut.
      SELECT * FROM hits
      WHERE ${resume}
      ORDER BY title_hit DESC, rank DESC, published_at DESC, id DESC
      LIMIT ${input.limit + 1}
    ),
    page AS (
      SELECT *, row_number() OVER (ORDER BY title_hit DESC, rank DESC, published_at DESC, id DESC) AS n
      FROM top
    )
    SELECT c.total,
           page.id AS "postId", page.revision_id AS "revisionId", page.title_hit AS "titleHit",
           page.rank, page.published_at AS "publishedAt", d.excerpt,
           CASE
             -- The extra row only proves there is a next page.
             WHEN page.n > ${input.limit} THEN NULL
             -- '' is the lateral's "no typed word in the body": the excerpt stands in.
             WHEN w.headline = '' OR strpos(w.headline, ${MATCH_START}) > 0 THEN w.headline
             ELSE ts_headline(${SEARCH_CONFIG}::regconfig, d.body, q.query, ${HEADLINE_OPTIONS})
           END AS headline
    FROM (SELECT count(*)::int AS total FROM hits) c
    CROSS JOIN q
    LEFT JOIN page ON TRUE
    LEFT JOIN search_documents d ON d.revision_id = page.revision_id
    -- The cheap snippet, tried first. ts_headline parses all it is given
    -- (about 4 ms for a 10,000-character body), so it gets the lead when the
    -- match is there, or else a window around the first place one of the
    -- query's stems appears in the text. A window with no real match in it
    -- ("cach" inside "cachet", a negated word, "happi" for "happy") falls
    -- through to the whole body above: never a worse snippet than the slow
    -- way, only a cheaper one. Whether the body holds a typed word at all is
    -- read from its positions (weight C), not guessed from the text.
    LEFT JOIN LATERAL (
      SELECT CASE
               -- A title or excerpt hit: nothing in the body to mark.
               WHEN NOT tsvector_to_array(ts_filter(d.vector, '{c}')) && q.stems THEN ''
               WHEN ts_filter(d.lead_vector, '{c}') @@ q.query
                 THEN ts_headline(${SEARCH_CONFIG}::regconfig, d.lead, q.query, ${HEADLINE_OPTIONS})
               ELSE (
                 SELECT ts_headline(${SEARCH_CONFIG}::regconfig,
                          substring(d.body FROM greatest(1, f.at - ${WINDOW_BEFORE}::int) FOR ${WINDOW_CHARS}::int),
                          q.query, ${HEADLINE_OPTIONS})
                 FROM (
                   SELECT min(nullif(strpos(b.text, stem), 0)) AS at
                   FROM (SELECT lower(d.body) AS text OFFSET 0) b, unnest(q.stems) AS stem -- lowered once
                 ) f
                 WHERE f.at IS NOT NULL
               )
             END AS headline
      WHERE page.n <= ${input.limit}
    ) w ON TRUE
    ORDER BY page.n`;

  const total = rows[0]?.total ?? 0;
  const found = rows.filter((r): r is Row & { postId: string } => r.postId !== null);
  const pageRows = found.slice(0, input.limit);
  const last = pageRows.at(-1);
  return {
    query: input.query,
    total,
    hits: pageRows.map((r) => ({
      postId: r.postId,
      revisionId: r.revisionId!,
      titleHit: r.titleHit === 1,
      rank: r.rank!,
      snippet: snippetOf(r.headline ?? '', r.excerpt ?? ''),
    })),
    nextCursor:
      found.length > input.limit && last !== undefined
        ? encodeSearchCursor(
            {
              titleHit: last.titleHit === 1 ? 1 : 0,
              rank: last.rank!,
              publishedAt: last.publishedAt!,
              id: last.postId,
            },
            input.query,
          )
        : null,
  };
}
