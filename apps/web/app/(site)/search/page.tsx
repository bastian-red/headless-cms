import { SEARCH_QUERY_MAX } from '@cms/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { longDate } from '../../../lib/dates';
import { search } from '../../../lib/content';
import { alternatesFor, paths } from '../../../lib/seo';

/**
 * Search, rendered per request (it reads the query string) and never indexed:
 * a results page is a different page for every query, and an index full of
 * them is thin, duplicate content. Links on it are still followed.
 *
 * Snippets arrive as data (`[{ text, match }]`); a matched run becomes a
 * `<mark>` here, so no HTML from the index ever reaches the page.
 */
export const metadata: Metadata = {
  title: 'Search',
  robots: { index: false, follow: true },
  alternates: alternatesFor(paths.search),
};

type Props = { searchParams: Promise<{ q?: string | string[]; cursor?: string | string[] }> };

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? '';

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const q = one(params.q);
  const cursor = one(params.cursor);
  const result = q === '' ? null : await search(q, cursor === '' ? undefined : cursor);
  return (
    <main id="main" className="page">
      <h1>Search</h1>
      <form action={paths.search} method="get" role="search" className="search-form">
        <label htmlFor="q">Search posts</label>
        <div className="search-row">
          <input
            id="q"
            name="q"
            type="search"
            className="field-input"
            defaultValue={q}
            maxLength={SEARCH_QUERY_MAX}
            placeholder="caching, “exact phrase”, -without…"
          />
          <button type="submit" className="button button-primary">
            Search
          </button>
        </div>
      </form>
      {q === '' ? (
        <p className="muted">Titles count first, then the opening of each post.</p>
      ) : result === null ? (
        <p role="status">That search could not be run. Try fewer or shorter words.</p>
      ) : (
        <section aria-labelledby="results">
          <h2 id="results">
            {result.total === 0
              ? `No posts match “${q}”`
              : `${String(result.total)} ${result.total === 1 ? 'post matches' : 'posts match'} “${q}”`}
          </h2>
          <ol className="post-list" role="list">
            {result.items.map((hit) => (
              <li key={hit.slug} className="post-list-item">
                <article>
                  <h3 className="post-list-title">
                    <Link href={paths.post(hit.slug)}>{hit.title}</Link>
                  </h3>
                  <p className="byline muted">
                    <time dateTime={hit.publishedAt}>{longDate(hit.publishedAt)}</time>
                    {' · '}
                    {hit.author.name}
                  </p>
                  <p className="snippet">
                    {hit.snippet.map((part, index) =>
                      part.match ? (
                        <mark key={index}>{part.text}</mark>
                      ) : (
                        <span key={index}>{part.text}</span>
                      ),
                    )}
                  </p>
                </article>
              </li>
            ))}
          </ol>
          {result.nextCursor === null ? null : (
            <p>
              <Link
                href={`${paths.search}?${new URLSearchParams({ q, cursor: result.nextCursor }).toString()}`}
              >
                More results
              </Link>
            </p>
          )}
        </section>
      )}
    </main>
  );
}
