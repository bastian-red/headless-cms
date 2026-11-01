import { commentParagraphs, COMMENT_STATUSES, moderationQueueSchema } from '@cms/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Moderate } from '../../../components/studio/moderate';
import { When } from '../../../components/studio/when';
import { ApiError, apiFetch, query } from '../../../lib/api';
import { COMMENT_STATUS_UI } from '../../../lib/studio/comment-ui';
import { studioUser } from '../../../lib/studio/me';

export const metadata = { title: 'Comments' };

type Props = { searchParams: Promise<{ status?: string; cursor?: string }> };

/**
 * The moderation queue: waiting comments oldest first (the one that has
 * waited longest is decided first), decided ones newest first. A burst from
 * one source shows as a count, without anybody seeing an address.
 */
export default async function CommentsPage({ searchParams }: Props) {
  const params = await searchParams;
  const status = COMMENT_STATUSES.find((s) => s === params.status) ?? 'PENDING';
  const { session } = await studioUser(
    `/studio/comments${query({ status: params.status, cursor: params.cursor })}`,
  );
  let queue;
  try {
    queue = await apiFetch(
      session,
      `/studio/comments${query({ status, cursor: params.cursor })}`,
      moderationQueueSchema,
    );
  } catch (error) {
    // An author has no queue; the page does not exist for them.
    if (error instanceof ApiError && error.status === 403) notFound();
    throw error;
  }

  return (
    <main id="main" className="studio-page">
      <h1>Comments</h1>
      <nav aria-label="Comments by state">
        <ul className="studio-filter" role="list">
          {COMMENT_STATUSES.map((s) => (
            <li key={s}>
              <Link
                href={`/studio/comments${query({ status: s === 'PENDING' ? undefined : s })}`}
                aria-current={s === status ? 'page' : undefined}
              >
                {COMMENT_STATUS_UI[s].word}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {queue.items.length === 0 ? (
        <p className="panel">
          {status === 'PENDING'
            ? 'Nothing is waiting. Every comment has been decided.'
            : `No comments are ${COMMENT_STATUS_UI[status].word.toLowerCase()}.`}
        </p>
      ) : (
        <ol className="queue" role="list">
          {queue.items.map((comment) => (
            <li key={comment.id} className="panel queue-item">
              <article aria-labelledby={`c-${comment.id}`}>
                <h2 id={`c-${comment.id}`} className="queue-title">
                  {comment.name}{' '}
                  <span className="muted">
                    on <Link href={`/studio/posts/${comment.post.id}`}>{comment.post.title}</Link>
                  </span>
                </h2>
                <p className="muted queue-meta">
                  <span aria-hidden="true">{COMMENT_STATUS_UI[comment.status].glyph} </span>
                  {COMMENT_STATUS_UI[comment.status].word} · sent{' '}
                  <When instant={comment.createdAt} />
                  {comment.moderatedBy === null || comment.moderatedAt === null ? null : (
                    <>
                      {' '}
                      · decided by {comment.moderatedBy.name},{' '}
                      <When instant={comment.moderatedAt} />
                    </>
                  )}
                  {comment.pendingFromSameSource !== null && comment.pendingFromSameSource > 1 ? (
                    <>
                      {' '}
                      ·{' '}
                      <strong>
                        {String(comment.pendingFromSameSource)} waiting from the same source
                      </strong>
                    </>
                  ) : null}
                  {comment.post.live ? null : ' · the post is not public'}
                </p>
                <div className="queue-body">
                  {commentParagraphs(comment.body).map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
                <Moderate commentId={comment.id} status={comment.status} />
              </article>
            </li>
          ))}
        </ol>
      )}
      {queue.nextCursor === null ? null : (
        <p>
          <Link
            href={`/studio/comments${query({ status: params.status, cursor: queue.nextCursor })}`}
          >
            More
          </Link>
        </p>
      )}
    </main>
  );
}
