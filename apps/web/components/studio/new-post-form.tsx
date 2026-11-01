'use client';

import { LIMITS } from '@cms/shared';
import { useActionState, useRef } from 'react';

import { createPost, type CreatePostState } from '../../app/studio/actions';
import { FieldError } from './field';
import { useFocusFirstError } from './use-focus-first-error';

export function NewPostForm() {
  const [state, action, pending] = useActionState<CreatePostState, FormData>(createPost, {
    kind: 'idle',
  });
  const error = state.kind === 'error' ? state : null;
  const form = useRef<HTMLFormElement>(null);
  useFocusFirstError(form, state);
  return (
    <form ref={form} action={action} className="panel" noValidate>
      {error === null ? null : (
        <p className="form-error" role="alert">
          {error.message}
        </p>
      )}
      <div className="field">
        <label htmlFor="new-title">Title</label>
        <input
          id="new-title"
          className="field-input"
          name="title"
          autoComplete="off"
          required
          maxLength={LIMITS.title}
          defaultValue={error?.values.title ?? ''}
          aria-invalid={error?.fields.title === undefined ? undefined : true}
          aria-describedby={error?.fields.title === undefined ? undefined : 'new-title-error'}
        />
        <FieldError id="new-title-error" message={error?.fields.title} />
      </div>
      <div className="field">
        <label htmlFor="new-slug">Address (optional)</label>
        <input
          id="new-slug"
          className="field-input"
          name="slug"
          autoComplete="off"
          maxLength={LIMITS.slug}
          translate="no"
          spellCheck={false}
          autoCapitalize="none"
          placeholder="made-from-the-title…"
          defaultValue={error?.values.slug ?? ''}
          aria-invalid={error?.fields.slug === undefined ? undefined : true}
          aria-describedby={`new-slug-hint${error?.fields.slug === undefined ? '' : ' new-slug-error'}`}
        />
        <span id="new-slug-hint" className="field-hint">
          Lowercase letters, digits and hyphens: /posts/your-address. Left empty, it is made from
          the title.
        </span>
        <FieldError id="new-slug-error" message={error?.fields.slug} />
      </div>
      <button className="button button-primary" type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create draft'}
      </button>
    </form>
  );
}
