'use client';

import { LIMITS } from '@cms/shared';
import { useActionState, useId } from 'react';

import { renamePost, type SimpleState } from '../../app/studio/actions';
import { Result } from './result';

/**
 * The post's address. Renaming a live post keeps the old address working:
 * the API records it and the site answers it with a 308 to the new one.
 */
export function RenameForm({
  postId,
  slug,
  live,
}: {
  postId: string;
  slug: string;
  live: boolean;
}) {
  const id = useId();
  const [state, action, pending] = useActionState<SimpleState, FormData>(renamePost, {
    kind: 'idle',
  });
  return (
    <section className="panel" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="aside-title">
        Address
      </h2>
      <form action={action}>
        <input type="hidden" name="postId" value={postId} />
        <div className="field">
          <label htmlFor={`${id}-slug`}>/posts/</label>
          <input
            id={`${id}-slug`}
            className="field-input"
            name="slug"
            autoComplete="off"
            required
            maxLength={LIMITS.slug}
            translate="no"
            spellCheck={false}
            autoCapitalize="none"
            defaultValue={state.kind === 'error' ? (state.value ?? slug) : slug}
            key={slug}
            aria-describedby={`${id}-hint`}
          />
          <span id={`${id}-hint`} className="field-hint">
            {live
              ? 'Readers and search engines following the old address are redirected to the new one.'
              : 'Lowercase letters, digits and single hyphens.'}
          </span>
        </div>
        <button className="button" type="submit" disabled={pending}>
          {pending ? 'Renaming…' : 'Rename'}
        </button>
      </form>
      <Result state={state} />
    </section>
  );
}
