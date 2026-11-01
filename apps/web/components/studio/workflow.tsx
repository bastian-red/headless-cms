'use client';

import type { StudioPost, TransitionName } from '@cms/shared';
import { useActionState, useEffect, useId, useState, type FormEvent } from 'react';

import { transitionPost, type TransitionState } from '../../app/studio/actions';
import { localInputToIso, scheduleProblem } from '../../lib/studio/schedule-time';
import { orderedTransitions, readersSee, TRANSITION_UI } from '../../lib/studio/workflow-ui';
import { Status } from './status';
import { When } from './when';

interface Props {
  readonly post: StudioPost;
  /** The revision this person is looking at: what a transition acts on. */
  readonly revisionId: string;
  readonly dirty: boolean;
}

/**
 * Where the post stands and what can be done to it. The buttons are the
 * API's `transitions`, already filtered by role and state; this only words
 * and orders them (`lib/studio/workflow-ui.ts`).
 *
 * The schedule field is wall-clock time in the browser's zone, converted to
 * an instant in the browser (the server does not know the zone). Without
 * JavaScript the label says UTC, and UTC is what the server reads.
 */
export function Workflow({ post, revisionId, dirty }: Props) {
  const id = useId();
  const [state, action, pending] = useActionState<TransitionState, FormData>(transitionPost, {
    kind: 'idle',
  });
  const [zone, setZone] = useState<string | null>(null);
  const [local, setLocal] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<TransitionState | null>(null);
  useEffect(() => setZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);

  const names = orderedTransitions(post.transitions);
  const confirming = state.kind === 'confirm' && dismissed !== state;
  const scheduling = names.includes('schedule');

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value !== 'schedule') {
      setProblem(null);
      return;
    }
    const found = scheduleProblem(local, Date.now());
    setProblem(found);
    if (found !== null) event.preventDefault();
  };

  const button = (name: TransitionName) => {
    const ui = TRANSITION_UI[name];
    return (
      <button
        key={name}
        className={ui.primary ? 'button button-primary' : 'button'}
        type="submit"
        name="transition"
        value={name}
        disabled={pending || dirty}
        data-danger={ui.confirm === undefined ? undefined : 'true'}
      >
        {ui.label}
      </button>
    );
  };

  return (
    <section className="panel workflow" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="workflow-title">
        <Status status={post.status} />
      </h2>
      <p>{readersSee(post)}</p>
      {post.status === 'SCHEDULED' && post.scheduledFor !== null ? (
        <p>
          Goes out at <When instant={post.scheduledFor} />.
        </p>
      ) : null}
      {post.live ? (
        <p>
          <a href={`/posts/${post.slug}`} translate="no">
            /posts/{post.slug}
          </a>
        </p>
      ) : null}

      {names.length === 0 ? (
        <p className="muted">Nothing for your role to do here right now.</p>
      ) : (
        <form action={action} onSubmit={onSubmit} className="workflow-form">
          <input type="hidden" name="postId" value={post.id} />
          <input type="hidden" name="revisionId" value={revisionId} />
          {dirty ? (
            <p className="muted" id={`${id}-dirty`}>
              Save your changes first: these act on the saved revision.
            </p>
          ) : null}
          {scheduling ? (
            <div className="field">
              <label htmlFor={`${id}-when`}>
                Publish at ({zone === null ? 'UTC' : `your time, ${zone}`})
              </label>
              <input
                id={`${id}-when`}
                className="field-input"
                type="datetime-local"
                name="scheduledLocal"
                value={local}
                onChange={(event) => {
                  setLocal(event.target.value);
                  setProblem(null);
                }}
                aria-invalid={problem === null ? undefined : true}
                aria-describedby={problem === null ? undefined : `${id}-when-error`}
              />
              {/* The instant, computed here in the browser's zone. Empty without JS. */}
              <input
                type="hidden"
                name="scheduledFor"
                value={zone === null ? '' : (localInputToIso(local) ?? '')}
              />
              {problem === null ? null : (
                <span id={`${id}-when-error`} className="field-error">
                  <span aria-hidden="true">⚠ </span>
                  {problem}
                </span>
              )}
            </div>
          ) : null}
          <div className="workflow-actions">{names.map(button)}</div>
        </form>
      )}

      {confirming ? (
        <form action={action} className="confirm" role="alertdialog" aria-labelledby={`${id}-q`}>
          <p id={`${id}-q`}>{state.question}</p>
          <input type="hidden" name="postId" value={post.id} />
          <input type="hidden" name="revisionId" value={revisionId} />
          <input type="hidden" name="transition" value="unpublish" />
          <input type="hidden" name="confirmed" value="yes" />
          <div className="workflow-actions">
            <button className="button" type="submit" data-danger="true" disabled={pending}>
              Yes, take it down
            </button>
            <a
              className="button"
              href={`/studio/posts/${post.id}`}
              onClick={(event) => {
                event.preventDefault();
                setDismissed(state);
              }}
            >
              Keep it published
            </a>
          </div>
        </form>
      ) : null}

      <p className="workflow-result" role="status">
        {state.kind === 'done' ? (
          <>
            <span aria-hidden="true">✓ </span>
            {state.message}
          </>
        ) : null}
      </p>
      {state.kind === 'error' ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
