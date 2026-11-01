'use client';

import { LIMITS } from '@cms/shared';
import { useActionState, useId } from 'react';

import { createTag, type SimpleState } from '../../app/studio/actions';
import { Result } from './result';

/** A new tag, for editors: it appears in the editor's tag list once created. */
export function TagForm() {
  const id = useId();
  const [state, action, pending] = useActionState<SimpleState, FormData>(createTag, {
    kind: 'idle',
  });
  return (
    <section className="panel" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="aside-title">
        New tag
      </h2>
      <form action={action}>
        <div className="field">
          <label htmlFor={`${id}-name`}>Name</label>
          <input
            id={`${id}-name`}
            className="field-input"
            name="name"
            autoComplete="off"
            required
            maxLength={LIMITS.tagName}
            defaultValue={state.kind === 'error' ? (state.value ?? '') : ''}
            key={state.kind === 'done' ? state.at : 'draft'}
          />
        </div>
        <button className="button" type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create tag'}
        </button>
      </form>
      <Result state={state} />
    </section>
  );
}
