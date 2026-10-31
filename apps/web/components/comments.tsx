import { commentParagraphs, type V1Comment } from '@cms/shared';

import { longDate } from '../lib/dates';

/**
 * The approved comments under a post, oldest first. Plain text by contract:
 * each paragraph is a text node, so a comment cannot carry markup of any kind,
 * and the count is said in words, including when there are none.
 */
export function Comments({ comments }: { readonly comments: readonly V1Comment[] }) {
  return (
    <>
      <h2 id="comments-title" className="comments-title">
        {comments.length === 0
          ? 'No comments yet'
          : comments.length === 1
            ? '1 comment'
            : `${String(comments.length)} comments`}
      </h2>
      {comments.length === 0 ? null : (
        <ol role="list" className="comment-list">
          {comments.map((comment) => (
            <li key={comment.id} id={`comment-${comment.id}`} className="comment">
              <p className="comment-meta">
                <span className="comment-name">{comment.name}</span>
                <span className="muted">
                  {' · '}
                  <time dateTime={comment.createdAt}>{longDate(comment.createdAt)}</time>
                </span>
              </p>
              <div className="comment-body">
                {commentParagraphs(comment.body).map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
