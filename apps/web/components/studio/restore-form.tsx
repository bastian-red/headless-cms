'use client';

import { useActionState } from 'react';

import { restoreRevision, type SimpleState } from '../../app/studio/actions';
import { Result } from './result';

export function RestoreForm(props: {
  postId: string;
  revisionId: string;
  number: number;
  baseRevisionId: string;
}) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(restoreRevision, {
    kind: 'idle',
  });
  return (
    <form action={action}>
      <input type="hidden" name="postId" value={props.postId} />
      <input type="hidden" name="revisionId" value={props.revisionId} />
      <input type="hidden" name="baseRevisionId" value={props.baseRevisionId} />
      <button className="button" type="submit" disabled={pending || state.kind === 'done'}>
        {pending ? 'Restoring…' : `Restore revision ${String(props.number)}`}
      </button>
      <Result state={state} />
    </form>
  );
}
