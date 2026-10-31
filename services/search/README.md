# @cms/search

Full-text search over published posts, in the Postgres the content already lives in. A library,
not a process: `apps/api` calls `searchPublished()` for `GET /v1/search`, and the bench calls the
same function.

```ts
import { searchPublished } from '@cms/search';

const page = await searchPublished(prisma, { query: 'edge caching', limit: 10 });
// { query, total, hits: [{ postId, revisionId, titleHit, rank, snippet }], nextCursor }
```

```bash
pnpm --filter @cms/search test        # gate lane: snippet parsing, cursors
pnpm search:reindex [--all]           # write missing documents (or every one) from the renderer
pnpm search:bench                     # p95 < 50 ms over 2,000 published posts
```

## What is indexed

One `search_documents` row per revision, written in the same transaction as the revision. Its
body is the **rendered text** (`render(body).text` from `@cms/markdown`, which the API's save-time
render check already returns), never the markdown source. So a word in a link URL, a raw `<script>`
the sanitizer drops, or a footnote marker cannot match, and the hostile seeded post's payload
(`__quireHostile`) is not findable at all. Control characters are stripped on the way in
(`searchText` in `@cms/shared`), because the snippet markers are two of them: a body cannot forge a
highlight.

Drafts are indexed too, so a publish only flips a flag and never re-parses text. Whether a
document is readable is the `live` column, which **the database maintains**: a trigger on `posts`
re-derives it whenever `published_revision_id` moves, and a trigger on the document re-derives it
on every write, so `UPDATE search_documents SET live = true` on a draft is undone. The query then
also joins `posts.published_revision_id`, and the API keeps a hit only if the post's published
revision is still the one that matched. Three independent reasons a draft cannot come out.

| Column         | Generated from                                 | Used for                                  |
| -------------- | ---------------------------------------------- | ----------------------------------------- |
| `vector`       | title (A), excerpt (B), body (C)               | matching; GIN index **partial on `live`** |
| `title_vector` | title                                          | the first sort key                        |
| `lead`         | the body's first 600 characters, cut at a word | cheap snippets                            |
| `lead_vector`  | title (A), excerpt (B), lead (C)               | ranking                                   |

## The query

- `websearch_to_tsquery('english', q)`: quotes for a phrase, `or`, `-without`, and never a syntax
  error. A query of only stop words (`the`) or only exclusions (`-edge`) matches nothing. The
  second is a rule, not an accident: it has no indexable part, so it would walk the whole index to
  return nearly every post.
- **Order:** title hit first (`title_vector @@ q`), then `ts_rank(lead_vector, q, 1)`, then
  newest, then id. Weights alone do not promise a title hit wins: `ts_rank` averages over the
  query's terms and divides by length, so a short body that says all five words of an `or` query
  out-scores a long post with one of them in its title. The integration suite builds exactly that
  pair and asserts both the raw ranks and the order.
- **Total** is an exact `count(*)` over the same match.
- **Pages** are keyset (`(title_hit, rank, published_at, id) <` the cursor), and a cursor carries a
  hash of its query: replayed with another query it is a 400, not a page of something else.
- **Snippets** are cut for the returned page only, and returned as data, `[{ text, match }]`,
  never HTML. In order of cost: the lead, when the match is there; else a 900-character window
  around the first place a query stem occurs in the text; else the whole body. A window with no
  real match in it (`cach` inside `cachet`, a stem that is not a prefix of its word like `happi`
  for `happy`) falls through to the whole body, so a cheap snippet is never a worse one. A hit
  with no typed word in its body (a title or excerpt match) shows the excerpt.

## Measured

On the bench corpus (2,000 live posts plus 2,500 unpublished revisions, Zipf-distributed words
from the seeded publication, bodies of 300 to 2,400 words, so a common word matches all 2,000):

| Design                                                                                      | p95       |
| ------------------------------------------------------------------------------------------- | --------- |
| Rank `ts_rank_cd` on the whole vector, headline from the whole body, index on all revisions | 513 ms    |
| Partial index on `live`, rank on the lead, lead headline                                    | 47 ms     |
| + snippet window, top-N sort, no headline for title-only hits                               | **33 ms** |

Where the time went, each measured on its own: decompressing a large `tsvector` costs about 30 µs
a row whatever its storage, `ts_rank_cd` another 55 µs (`ts_rank` 2 µs), and `ts_headline` parses
everything it is given (about 4 ms for a 10,000-character body). A `row_number()` over the hits
kept Postgres from using a top-N heap and sorted all 1,500 of them. After a bulk load the GIN
pending list makes the planner choose a sequential scan (140 ms) until a `VACUUM`; the bench runs
one, and autovacuum does on a live database. The full history is in the two migrations' headers.

## Tests

| Guarantee                                                                                        | Held by                                                   |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Every title hit before every body-only hit, for seven seeded words, ranks descending within each | `test/search.test.ts` ranking                             |
| The title tier is needed: a built pair where the raw ranks invert                                | `test/search.test.ts` ranking                             |
| No draft, pending revision, comment canary or taken-down post is findable                        | `test/search.test.ts`, and the content API's canary crawl |
| `live` follows publish, unpublish and republish, and a forged flag is undone                     | `packages/db/test/schema.test.ts`                         |
| Phrase, `or` (exactly the union), `-word`, stop words, only exclusions                           | `test/search.test.ts`                                     |
| Each snippet path finds its match (lead, window, whole body, decoy prefix, title-only)           | `test/search.test.ts` snippets                            |
| Forged markers and the hostile payload never reach a snippet                                     | `test/search.test.ts` snippets                            |
| A cursor crawl returns every hit once, in order; a foreign cursor is refused                     | `test/search.test.ts` pages, `src/search.test.ts`         |
| p95 < 50 ms on 2,000 posts                                                                       | `scripts/search-bench.mjs` (CI)                           |

Each one has been broken on purpose: `node scripts/red-proofs.mjs search` removes the title tier,
both draft defenses, the exclusion rule, the window's match check and the cursor binding, and puts
the first design's ranking back for the bench, and requires each suite to fail.
