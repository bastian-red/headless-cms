'use client';

import { useActionState, useId, useState } from 'react';

import {
  createKey,
  revokeKey,
  type CreateKeyState,
  type RevokeState,
} from '../../app/studio/actions';

/**
 * A new key. It is shown once, here, and never again: the API stores only
 * its hash, so a lost key is revoked and replaced, not recovered.
 */
export function NewKeyForm() {
  const id = useId();
  const [state, action, pending] = useActionState<CreateKeyState, FormData>(createKey, {
    kind: 'idle',
  });
  const [copied, setCopied] = useState<number | null>(null);
  return (
    <section className="panel" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>New key</h2>
      <form action={action} key={state.kind === 'created' ? state.at : 'draft'}>
        <div className="field">
          <label htmlFor={`${id}-name`}>What it is for</label>
          <input
            id={`${id}-name`}
            className="field-input"
            name="name"
            autoComplete="off"
            required
            maxLength={80}
            placeholder="Mobile app, newsletter…"
            defaultValue={state.kind === 'error' ? state.value : ''}
          />
        </div>
        <button className="button button-primary" type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create key'}
        </button>
      </form>
      {state.kind === 'error' ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.kind === 'created' ? (
        <div className="key-once" role="status">
          <p>
            <span aria-hidden="true">✓ </span>Key “{state.name}” created. Copy it now: it is not
            shown again.
          </p>
          <p>
            <code className="key-value" translate="no" data-testid="new-key">
              {state.key}
            </code>
          </p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(state.key).then(() => setCopied(state.at));
            }}
          >
            {copied === state.at ? 'Copied' : 'Copy key'}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** Revoke, which asks first in words: every client using the key stops at once. */
export function RevokeKey({ keyId, name }: { keyId: string; name: string }) {
  const [state, action, pending] = useActionState<RevokeState, FormData>(revokeKey, {
    kind: 'idle',
  });
  const [dismissed, setDismissed] = useState<RevokeState | null>(null);
  if (state.kind === 'done') {
    return (
      <p role="status">
        <span aria-hidden="true">✓ </span>
        {state.message}
      </p>
    );
  }
  const asking = state.kind === 'confirm' && dismissed !== state;
  return (
    <form action={action} className="revoke">
      <input type="hidden" name="keyId" value={keyId} />
      {asking ? (
        <div role="alertdialog" aria-labelledby={`q-${keyId}`} className="confirm">
          <p id={`q-${keyId}`}>
            Revoke “{name}”? Everything using it gets 401 from the next request. This cannot be
            undone; you can create a new key.
          </p>
          <input type="hidden" name="confirmed" value="yes" />
          <div className="workflow-actions">
            <button className="button" type="submit" data-danger="true" disabled={pending}>
              Yes, revoke it
            </button>
            <button className="button" type="button" onClick={() => setDismissed(state)}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <button className="button" type="submit" disabled={pending}>
          Revoke<span className="visually-hidden"> {name}</span>
        </button>
      )}
      {state.kind === 'error' ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
