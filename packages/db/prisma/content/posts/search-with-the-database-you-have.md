Our search runs inside the database that already stores the posts. There is no separate search server to run, feed and keep in step.

## What Postgres does

Postgres can turn text into a list of word stems, ignoring common words, so that a search for "caching" finds a post about a cache. It can rank results by how well they match, weight some parts of a document more than others, and produce a snippet with the matching words marked.

```sql
SELECT title, ts_rank_cd(search_vector, query) AS rank
FROM posts, websearch_to_tsquery('english', 'stale cache') AS query
WHERE search_vector @@ query
ORDER BY rank DESC
LIMIT 10;
```

## Only what is published

The search index is built from the live revision of each post, never from a draft. A post that is unpublished disappears from search in the same transaction.

## When to outgrow it

For a publication of a few thousand posts, this is fast and good. If we ever need typo tolerance across millions of documents, a dedicated engine will earn its keep. Until then it would be one more thing to keep running.
