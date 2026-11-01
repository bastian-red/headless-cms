import type { V1PostSummary } from '@cms/shared';
import Link from 'next/link';

import { longDate } from '../lib/dates';
import { paths } from '../lib/seo';

/**
 * A list of posts set as a size index (docs/DESIGN.md): each entry's reading
 * time is the large numeral beside its title, so a reader can choose ten
 * minutes from the list itself. Then the date, author and tags, and the
 * excerpt, which says what the ten minutes are about.
 *
 * The numeral comes after the title in the markup and is placed beside it by
 * the grid, so a screen reader hears the title first and the length second.
 */
export function PostList({
  posts,
  headingLevel = 2,
}: {
  posts: readonly V1PostSummary[];
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <ol className="post-list" role="list">
      {posts.map((post) => (
        <li key={post.slug} className="post-list-item">
          <article className="entry">
            <Heading className="post-list-title">
              <Link href={paths.post(post.slug)}>{post.title}</Link>
            </Heading>
            <PostSize post={post} />
            <PostByline post={post} />
            {post.excerpt === '' ? null : <p className="post-list-excerpt">{post.excerpt}</p>}
          </article>
        </li>
      ))}
    </ol>
  );
}

/** "15 min · 3,418 words", set as a numeral and its unit. */
export function PostSize({ post }: { post: Pick<V1PostSummary, 'words' | 'readingMinutes'> }) {
  return (
    <p className="entry-size">
      <span className="entry-numeral">{String(post.readingMinutes)}</span>{' '}
      <span className="entry-unit">min</span>{' '}
      <span className="entry-words">
        {post.words.toLocaleString('en')} {post.words === 1 ? 'word' : 'words'}
      </span>
    </p>
  );
}

export function PostByline({ post, revised }: { post: V1PostSummary; revised?: boolean }) {
  return (
    <p className="byline">
      <time dateTime={post.publishedAt}>{longDate(post.publishedAt)}</time>
      {' · '}
      <Link href={paths.author(post.author.id)}>{post.author.name}</Link>
      {post.tags.length === 0 ? null : (
        <>
          {' · '}
          {post.tags.map((tag, index) => (
            <span key={tag.slug}>
              {index === 0 ? '' : ', '}
              <Link href={paths.tag(tag.slug)}>{tag.name}</Link>
            </span>
          ))}
        </>
      )}
      {/* revisedAt is when the shown revision was written, which can precede
          the first publish; only a later one is a revision. */}
      {revised === true && post.revisedAt > post.publishedAt ? (
        <>
          {' · '}revised <time dateTime={post.revisedAt}>{longDate(post.revisedAt)}</time>
        </>
      ) : null}
    </p>
  );
}
