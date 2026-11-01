import { POST_STATUSES, studioPostListSchema, type PostStatus } from '@cms/shared';
import Link from 'next/link';

import { Status } from '../../components/studio/status';
import { When } from '../../components/studio/when';
import { apiFetch, query } from '../../lib/api';
import { studioUser } from '../../lib/studio/me';
import { STATUS_UI } from '../../lib/studio/workflow-ui';

export const metadata = { title: 'Posts' };

type Props = { searchParams: Promise<{ status?: string; cursor?: string }> };

const ROLE_TEXT = {
  AUTHOR: 'You write drafts and submit them for review. You see your own posts.',
  EDITOR: 'You publish, schedule and take down posts, and moderate comments.',
  ADMIN: 'You do everything an editor does, and manage people and API keys.',
} as const;

/**
 * The studio's front page: every post the person may see, newest change
 * first, filtered by state through plain links (the filter is a URL, so it
 * can be bookmarked and works without JavaScript).
 */
export default async function PostsPage({ searchParams }: Props) {
  const params = await searchParams;
  const status = POST_STATUSES.find((s) => s === params.status);
  const here = `/studio${query({ status, cursor: params.cursor })}`;
  const { session, me } = await studioUser(here);
  const list = await apiFetch(
    session,
    `/studio/posts${query({ status, cursor: params.cursor, limit: '25' })}`,
    studioPostListSchema,
  );

  const filter = (value: PostStatus | undefined, label: string) => (
    <li key={value ?? 'all'}>
      <Link
        href={`/studio${query({ status: value })}`}
        aria-current={value === status ? 'page' : undefined}
      >
        {label}
      </Link>
    </li>
  );

  return (
    <main id="main" className="studio-page">
      <div className="studio-title-row">
        <h1>Posts</h1>
        <Link className="button button-primary" href="/studio/posts/new">
          New post
        </Link>
      </div>
      <p className="muted">{ROLE_TEXT[me.role]}</p>
      <nav aria-label="Filter posts by state">
        <ul className="studio-filter" role="list">
          {filter(undefined, 'All')}
          {POST_STATUSES.map((s) => filter(s, STATUS_UI[s].word))}
        </ul>
      </nav>
      {list.items.length === 0 ? (
        <p className="panel">
          {status === undefined
            ? 'No posts yet. Start one with New post.'
            : `No posts are ${STATUS_UI[status].word.toLowerCase()} right now.`}
        </p>
      ) : (
        <table className="table studio-posts">
          <caption className="visually-hidden">
            {status === undefined ? 'All posts' : `${STATUS_UI[status].word} posts`}, most recently
            changed first
          </caption>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">State</th>
              <th scope="col">Author</th>
              <th scope="col">Changed</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((post) => (
              <tr key={post.id}>
                <td data-label="Title">
                  <Link href={`/studio/posts/${post.id}`}>{post.title}</Link>
                  <span className="muted studio-slug" translate="no">
                    /posts/{post.slug}
                  </span>
                </td>
                <td data-label="State">
                  <Status status={post.status} />
                  {post.status === 'SCHEDULED' && post.scheduledFor !== null ? (
                    <span className="muted studio-when">
                      {' '}
                      for <When instant={post.scheduledFor} />
                    </span>
                  ) : null}
                  {post.live && post.status !== 'PUBLISHED' ? (
                    <span className="muted studio-when"> · an earlier revision is live</span>
                  ) : null}
                </td>
                <td data-label="Author">{post.author.name}</td>
                <td data-label="Changed">
                  <When instant={post.updatedAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.nextCursor === null ? null : (
        <p>
          <Link href={`/studio${query({ status, cursor: list.nextCursor })}`}>Older posts</Link>
        </p>
      )}
    </main>
  );
}
