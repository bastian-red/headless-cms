import type { V1PostSummary } from '@cms/shared';
import Link from 'next/link';

import { longDate } from '../lib/dates';
import { paths } from '../lib/seo';

/**
 * A list of posts: title, date, author, tags and the excerpt, which is the
 * line that answers "is this worth my next ten minutes?".
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
          <article>
            <Heading className="post-list-title">
              <Link href={paths.post(post.slug)}>{post.title}</Link>
            </Heading>
            <PostByline post={post} />
            {post.excerpt === '' ? null : <p className="post-list-excerpt">{post.excerpt}</p>}
          </article>
        </li>
      ))}
    </ol>
  );
}

export function PostByline({ post }: { post: V1PostSummary }) {
  return (
    <p className="byline muted">
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
    </p>
  );
}
