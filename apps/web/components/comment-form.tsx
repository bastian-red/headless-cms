'use client';

import { COMMENT_HONEYPOT_FIELD, LIMITS } from '@cms/shared';
import { useActionState, useId } from 'react';

import type { CommentFormState } from '../lib/comment-action';

interface CommentFormProps {
  readonly postSlug: string;
  readonly action: (previous: CommentFormState, form: FormData) => Promise<CommentFormState>;
}

/**
 * The comment form under a post.
 *
 * - **Works before JavaScript loads**: a server action through
 *   `useActionState`, so it is a plain POST without it.
 * - **Says what happens next, in words**: a sent comment waits for an editor,
 *   and the page says so (`role="status"`) instead of showing the comment,
 *   which would be a lie: nobody else can see it yet.
 * - **The honeypot** is a real input a person never meets: off-screen, out
 *   of the tab order, hidden from assistive technology, autocomplete off.
 */
export function CommentForm({ postSlug, action }: CommentFormProps) {
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' });
  const id = useId();
  const error = state.kind === 'error' ? state : null;

  return (
    <form action={formAction} className="comment-form" aria-labelledby={`${id}-title`} noValidate>
      <h3 id={`${id}-title`} className="comment-form-title">
        Leave a comment
      </h3>
      <p className="muted comment-form-note">
        No account needed. An editor reads every comment before it appears here.
      </p>
      <input type="hidden" name="postSlug" value={postSlug} />
      <div className="comment-honeypot" aria-hidden="true">
        <label>
          Leave this field empty
          <input
            type="text"
            name={COMMENT_HONEYPOT_FIELD}
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </label>
      </div>
      {/* A sent comment resets the fields: the key changes with each one. */}
      <div key={state.kind === 'sent' ? state.at : 'draft'}>
        <div className="field">
          <label htmlFor={`${id}-name`}>Name</label>
          <input
            id={`${id}-name`}
            className="field-input"
            name="name"
            required
            maxLength={LIMITS.commentName}
            autoComplete="name"
            defaultValue={error?.values.name ?? ''}
            aria-invalid={error?.fields.name === undefined ? undefined : true}
            aria-describedby={error?.fields.name === undefined ? undefined : `${id}-name-error`}
          />
          {error?.fields.name === undefined ? null : (
            <span id={`${id}-name-error`} className="field-error">
              <span aria-hidden="true">⚠ </span>
              {error.fields.name}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor={`${id}-body`}>Comment</label>
          <textarea
            id={`${id}-body`}
            className="field-input comment-body-input"
            name="body"
            required
            rows={5}
            maxLength={LIMITS.commentBody}
            defaultValue={error?.values.body ?? ''}
            aria-invalid={error?.fields.body === undefined ? undefined : true}
            aria-describedby={`${id}-body-hint${error?.fields.body === undefined ? '' : ` ${id}-body-error`}`}
          />
          <span id={`${id}-body-hint`} className="muted field-hint">
            Plain text, up to {LIMITS.commentBody.toLocaleString('en')} characters. A blank line
            starts a new paragraph.
          </span>
          {error?.fields.body === undefined ? null : (
            <span id={`${id}-body-error`} className="field-error">
              <span aria-hidden="true">⚠ </span>
              {error.fields.body}
            </span>
          )}
        </div>
      </div>
      {error === null ? null : (
        <p className="form-error" role="alert">
          <span aria-hidden="true">⚠ </span>
          {error.message}
        </p>
      )}
      <p className="comment-sent" role="status">
        {state.kind === 'sent'
          ? '✓ Thank you. Your comment is waiting for an editor and will appear here once approved.'
          : ''}
      </p>
      <button className="button button-primary" type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Send comment'}
      </button>
    </form>
  );
}
