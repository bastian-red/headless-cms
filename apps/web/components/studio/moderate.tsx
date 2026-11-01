'use client';

import type { CommentStatus } from '@cms/shared';
import { useActionState } from 'react';

import { moderateComment, type SimpleState } from '../../app/studio/actions';
import { DECISION_LABEL, decisionsFrom } from '../../lib/studio/comment-ui';
import { Result } from './result';

/** The decision buttons for one comment, with that comment's own outcome beside them. */
export function Moderate({ commentId, status }: { commentId: string; status: CommentStatus }) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(moderateComment, {
    kind: 'idle',
  });
  return (
    <form action={action} className="moderate">
      <input type="hidden" name="commentId" value={commentId} />
      <input type="hidden" name="from" value={status} />
      <div className="workflow-actions">
        {decisionsFrom(status).map((to) => (
          <button
            key={to}
            className={to === 'APPROVED' ? 'button button-primary' : 'button'}
            type="submit"
            name="to"
            value={to}
            disabled={pending || state.kind === 'done'}
          >
            {DECISION_LABEL[to]}
          </button>
        ))}
      </div>
      <Result state={state} />
    </form>
  );
}
