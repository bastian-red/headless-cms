'use server';

/**
 * A reader's comment, from the form under a post to `POST /comments`.
 *
 * A server action, so the form posts without JavaScript too. It lives outside
 * `app/(site)` on purpose: it reads the request (the browser's address, which
 * the API rate-limits and hashes), and nothing under `app/(site)` may read the
 * request, or the static post pages would render per request
 * (`public-routes.test.ts`). An action runs only when the form is posted, so
 * the page itself stays prerendered (`scripts/render-check.mjs` holds that).
 *
 * The reply never says whether the honeypot was tripped: the API answers a
 * bot exactly as it answers a person, and so does this.
 */
import { COMMENT_HONEYPOT_FIELD, commentReceiptSchema, submitCommentSchema } from '@cms/shared';

import { ApiError, apiFetch } from './api';

export type CommentFormState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sent'; readonly at: number }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly fields: { readonly name?: string; readonly body?: string };
      /** What the reader typed, put back so a refusal costs them nothing. */
      readonly values: { readonly name: string; readonly body: string };
    };

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

export async function submitComment(
  _previous: CommentFormState,
  form: FormData,
): Promise<CommentFormState> {
  const values = { name: text(form, 'name'), body: text(form, 'body') };
  const input = {
    postSlug: text(form, 'postSlug'),
    ...values,
    [COMMENT_HONEYPOT_FIELD]: text(form, COMMENT_HONEYPOT_FIELD),
  };

  // The same schema the API applies, so a reader is told which field is wrong
  // without a round trip, in the same words.
  const parsed = submitCommentSchema.safeParse(input);
  if (!parsed.success) {
    const fields: { name?: string; body?: string } = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if ((key === 'name' || key === 'body') && fields[key] === undefined)
        fields[key] = issue.message;
    }
    return { kind: 'error', message: 'Check the highlighted fields.', fields, values };
  }

  try {
    await apiFetch(null, '/comments', commentReceiptSchema, { method: 'POST', body: input });
    return { kind: 'sent', at: Date.now() };
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 0;
    const message =
      status === 429
        ? 'That is a lot of comments from one place. Wait a minute and send it again.'
        : status === 404
          ? 'This post is no longer published, so it takes no comments.'
          : 'Your comment could not be sent. Nothing was saved; try again.';
    if (status !== 429 && status !== 404) console.error('[web] comment submission failed', error);
    return { kind: 'error', message, fields: {}, values };
  }
}
