'use server';

/**
 * Every write the studio makes, as server actions.
 *
 * - **Forms work before JavaScript loads.** Each action is a form's `action`
 *   through `useActionState`, so without JS it is a plain POST and the page
 *   re-renders with the returned state.
 * - **The browser never calls the API.** Each action reads the session,
 *   mints a service token through `apiFetch`, and the API checks the role
 *   from its own table; hiding a button here is a courtesy, not the boundary.
 * - **The API's words reach the person.** A 4xx carries a sentence written
 *   for them ("Ada saved revision 4 since you started"); a 5xx or a network
 *   failure is logged and replaced with one that says nothing was changed.
 * - **What was typed comes back on a refusal**, so a failed save costs nothing.
 */
import {
  createApiKeySchema,
  createdApiKeySchema,
  createPostSchema,
  createTagSchema,
  createUserSchema,
  decisionSchema,
  commentStatusSchema,
  idSchema,
  moderateCommentSchema,
  renamePostSchema,
  roleSchema,
  saveRevisionSchema,
  staleSaveDetailsSchema,
  studioCommentSchema,
  studioPostSchema,
  tagSchema,
  transitionNameSchema,
  transitionSchema,
  userSchema,
  type SessionUser,
  type StaleSaveDetails,
  type StudioPost,
} from '@cms/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { auth } from '../../auth';
import { ApiError, apiFetch } from '../../lib/api';
import type { PostValues } from '../../lib/studio/post-values';
import { TRANSITION_UI } from '../../lib/studio/workflow-ui';

// --- Plumbing ----------------------------------------------------------------

async function actor(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user) redirect('/sign-in?next=%2Fstudio');
  return session.user;
}

const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** The person-facing sentence for a failed call. */
function sentence(error: unknown, context: string): string {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return error.message;
  }
  console.error(`[web] studio: ${context} failed`, error);
  return 'The server could not do that just now. Nothing was changed; try again.';
}

/** The first message zod gives for each top-level field. */
function fieldErrors(issues: readonly z.core.$ZodIssue[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? '');
    if (key !== '' && fields[key] === undefined) fields[key] = issue.message;
  }
  return fields;
}

const noContent = z.null();

// --- Posts -------------------------------------------------------------------

/** What the editor's fields hold, as typed. */
function postValues(form: FormData): PostValues {
  return {
    title: text(form, 'title'),
    excerpt: text(form, 'excerpt'),
    body: text(form, 'body'),
    seoTitle: text(form, 'seoTitle'),
    seoDescription: text(form, 'seoDescription'),
    tags: form.getAll('tags').filter((tag): tag is string => typeof tag === 'string'),
  };
}

export type CreatePostState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly fields: Record<string, string>;
      readonly values: { readonly title: string; readonly slug: string };
    };

/** A new draft, then straight into its editor. */
export async function createPost(
  _previous: CreatePostState,
  form: FormData,
): Promise<CreatePostState> {
  const user = await actor();
  const values = { title: text(form, 'title'), slug: text(form, 'slug').trim() };
  const parsed = createPostSchema.safeParse({
    title: values.title,
    ...(values.slug === '' ? {} : { slug: values.slug }),
  });
  if (!parsed.success) {
    return {
      kind: 'error',
      message: 'Check the highlighted fields.',
      fields: fieldErrors(parsed.error.issues),
      values,
    };
  }
  let post: StudioPost;
  try {
    post = await apiFetch(user, '/studio/posts', studioPostSchema, {
      method: 'POST',
      body: parsed.data,
    });
  } catch (error) {
    return { kind: 'error', message: sentence(error, 'create post'), fields: {}, values };
  }
  redirect(`/studio/posts/${post.id}`);
}

export type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saved'; readonly post: StudioPost; readonly at: number }
  | { readonly kind: 'unchanged'; readonly post: StudioPost; readonly at: number }
  | {
      readonly kind: 'stale';
      readonly message: string;
      readonly details: StaleSaveDetails;
      readonly values: PostValues;
    }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly fields: Record<string, string>;
      readonly values: PostValues;
    };

/**
 * A save: a new revision on top of the base the editor started from.
 *
 * `intent=keep-mine` comes from the stale panel: the editor has read what
 * changed and chooses to save their text on top of the revision that won
 * (`rebaseOnto`). That is an explicit overwrite, made by a person who saw the
 * diff, which is the only kind this product allows.
 */
export async function savePost(_previous: SaveState, form: FormData): Promise<SaveState> {
  const user = await actor();
  const postId = idSchema.parse(text(form, 'postId'));
  const values = postValues(form);
  const baseRevisionId =
    text(form, 'intent') === 'keep-mine' ? text(form, 'rebaseOnto') : text(form, 'baseRevisionId');

  const parsed = saveRevisionSchema.safeParse({ ...values, baseRevisionId });
  if (!parsed.success) {
    return {
      kind: 'error',
      message: 'Check the highlighted fields.',
      fields: fieldErrors(parsed.error.issues),
      values,
    };
  }

  try {
    const before = Date.now();
    const post = await apiFetch(user, `/studio/posts/${postId}/revisions`, studioPostSchema, {
      method: 'POST',
      body: parsed.data,
    });
    revalidatePath(`/studio/posts/${postId}`, 'layout');
    // 200 (nothing written) keeps the head; 201 moves it.
    return post.headRevisionId === parsed.data.baseRevisionId
      ? { kind: 'unchanged', post, at: before }
      : { kind: 'saved', post, at: before };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const details = staleSaveDetailsSchema.safeParse(error.details);
      if (details.success) {
        return { kind: 'stale', message: error.message, details: details.data, values };
      }
    }
    return { kind: 'error', message: sentence(error, 'save'), fields: {}, values };
  }
}

export type TransitionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'done'; readonly message: string; readonly at: number }
  | { readonly kind: 'confirm'; readonly action: 'unpublish'; readonly question: string }
  | { readonly kind: 'error'; readonly message: string };

const DONE: Record<z.infer<typeof transitionNameSchema>, string> = {
  submit: 'Submitted. An editor will review it.',
  withdraw: 'Withdrawn. It is a draft again.',
  publish: 'Published. Readers see it within seconds.',
  schedule: 'Scheduled.',
  unschedule: 'The schedule is cancelled. It is a draft again.',
  unpublish: 'Taken down. Its address is a 404 within seconds.',
};

/**
 * A workflow button. Unpublish answers with a question first (`confirm`), and
 * goes ahead only when the second form says `confirmed=yes`: a change readers
 * notice is never one stray click away, with or without JavaScript.
 *
 * A schedule's time arrives as `scheduledFor` (an instant the browser
 * computed from its own zone) or, without JavaScript, as the raw
 * `scheduledLocal`, which the form labels as UTC in that case.
 */
export async function transitionPost(
  _previous: TransitionState,
  form: FormData,
): Promise<TransitionState> {
  const user = await actor();
  const postId = idSchema.parse(text(form, 'postId'));
  const action = transitionNameSchema.safeParse(text(form, 'transition'));
  if (!action.success) return { kind: 'error', message: 'That is not something a post can do.' };

  if (action.data === 'unpublish' && text(form, 'confirmed') !== 'yes') {
    return {
      kind: 'confirm',
      action: 'unpublish',
      question: TRANSITION_UI.unpublish.confirm ?? 'Take this post down?',
    };
  }

  let scheduledFor = text(form, 'scheduledFor');
  if (action.data === 'schedule' && scheduledFor === '') {
    const local = text(form, 'scheduledLocal');
    scheduledFor = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(local) ? `${local}:00.000Z` : '';
  }
  const parsed = transitionSchema.safeParse({
    action: action.data,
    revisionId: text(form, 'revisionId'),
    ...(action.data === 'schedule' ? { scheduledFor } : {}),
  });
  if (!parsed.success) return { kind: 'error', message: 'Choose a date and a time.' };

  try {
    const post = await apiFetch(user, `/studio/posts/${postId}/transitions`, studioPostSchema, {
      method: 'POST',
      body: parsed.data,
    });
    revalidatePath('/studio', 'layout');
    const message =
      post.status === 'SCHEDULED' && post.scheduledFor !== null
        ? `Scheduled. It goes out at the time shown above.`
        : DONE[action.data];
    return { kind: 'done', message, at: Date.now() };
  } catch (error) {
    return { kind: 'error', message: sentence(error, `transition ${action.data}`) };
  }
}

export type SimpleState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'done'; readonly message: string; readonly at: number }
  | { readonly kind: 'error'; readonly message: string; readonly value?: string };

export async function renamePost(_previous: SimpleState, form: FormData): Promise<SimpleState> {
  const user = await actor();
  const postId = idSchema.parse(text(form, 'postId'));
  const slug = text(form, 'slug').trim();
  const parsed = renamePostSchema.safeParse({ slug });
  if (!parsed.success) {
    return {
      kind: 'error',
      message: 'Use lowercase letters, digits and single hyphens.',
      value: slug,
    };
  }
  try {
    const post = await apiFetch(user, `/studio/posts/${postId}/slug`, studioPostSchema, {
      method: 'PUT',
      body: parsed.data,
    });
    revalidatePath('/studio', 'layout');
    return {
      kind: 'done',
      message: post.live
        ? `Renamed. The old address now redirects to /posts/${post.slug}.`
        : `Renamed to ${post.slug}.`,
      at: Date.now(),
    };
  } catch (error) {
    return { kind: 'error', message: sentence(error, 'rename'), value: slug };
  }
}

/** Restore: a new head with an old revision's content. History is never rewritten. */
export async function restoreRevision(
  _previous: SimpleState,
  form: FormData,
): Promise<SimpleState> {
  const user = await actor();
  const postId = idSchema.parse(text(form, 'postId'));
  const revisionId = idSchema.parse(text(form, 'revisionId'));
  const baseRevisionId = text(form, 'baseRevisionId');
  try {
    const post = await apiFetch(
      user,
      `/studio/posts/${postId}/revisions/${revisionId}/restore`,
      studioPostSchema,
      { method: 'POST', body: { baseRevisionId } },
    );
    revalidatePath('/studio', 'layout');
    return {
      kind: 'done',
      message: `Restored as revision ${String(post.head.number)}. Nothing was deleted.`,
      at: Date.now(),
    };
  } catch (error) {
    return { kind: 'error', message: sentence(error, 'restore') };
  }
}

export async function createTag(_previous: SimpleState, form: FormData): Promise<SimpleState> {
  const user = await actor();
  const name = text(form, 'name');
  const parsed = createTagSchema.safeParse({ name });
  if (!parsed.success) return { kind: 'error', message: 'Give the tag a name.', value: name };
  try {
    const tag = await apiFetch(user, '/studio/tags', tagSchema, {
      method: 'POST',
      body: parsed.data,
    });
    revalidatePath('/studio', 'layout');
    return {
      kind: 'done',
      message: `Tag “${tag.name}” created. Tick it to use it.`,
      at: Date.now(),
    };
  } catch (error) {
    return { kind: 'error', message: sentence(error, 'create tag'), value: name };
  }
}

// --- Comments ----------------------------------------------------------------

const DECIDED = {
  APPROVED: 'Approved. It appears under the post within seconds.',
  REJECTED: 'Rejected. Readers do not see it.',
  SPAM: 'Marked as spam. Readers do not see it.',
} as const;

/**
 * One moderation decision. `from` is the state the moderator saw; if another
 * editor decided first, the API answers 409 with the state it is in now, and
 * that is what the moderator is told.
 */
export async function moderateComment(
  _previous: SimpleState,
  form: FormData,
): Promise<SimpleState> {
  const user = await actor();
  const id = idSchema.parse(text(form, 'commentId'));
  const parsed = moderateCommentSchema.safeParse({
    from: commentStatusSchema.parse(text(form, 'from')),
    to: decisionSchema.parse(text(form, 'to')),
  });
  if (!parsed.success) return { kind: 'error', message: 'The comment is already in that state.' };
  try {
    await apiFetch(user, `/studio/comments/${id}/decision`, studioCommentSchema, {
      method: 'POST',
      body: parsed.data,
    });
    // No revalidatePath: re-rendering the queue would remove the decided
    // comment and its confirmation with it. It leaves on the next load.
    return { kind: 'done', message: DECIDED[parsed.data.to], at: Date.now() };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const now = z.object({ status: commentStatusSchema }).safeParse(error.details);
      return {
        kind: 'error',
        message: now.success
          ? `Somebody decided first: it is ${now.data.status.toLowerCase()} now. Reload to see it.`
          : error.message,
      };
    }
    return { kind: 'error', message: sentence(error, 'moderate') };
  }
}

// --- People and keys (admin) --------------------------------------------------

export type CreateUserState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'done'; readonly message: string; readonly at: number }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly fields: Record<string, string>;
      readonly values: { readonly email: string; readonly name: string; readonly role: string };
    };

export async function createUser(
  _previous: CreateUserState,
  form: FormData,
): Promise<CreateUserState> {
  const user = await actor();
  const values = { email: text(form, 'email'), name: text(form, 'name'), role: text(form, 'role') };
  const parsed = createUserSchema.safeParse({ ...values, password: text(form, 'password') });
  if (!parsed.success) {
    return {
      kind: 'error',
      message: 'Check the highlighted fields.',
      fields: fieldErrors(parsed.error.issues),
      values,
    };
  }
  try {
    const created = await apiFetch(user, '/studio/users', userSchema, {
      method: 'POST',
      body: parsed.data,
    });
    revalidatePath('/studio/people');
    return {
      kind: 'done',
      message: `${created.name} can sign in now as ${created.role.toLowerCase()}. Tell them their password yourself; it is not shown again.`,
      at: Date.now(),
    };
  } catch (error) {
    return { kind: 'error', message: sentence(error, 'create user'), fields: {}, values };
  }
}

export async function changeRole(_previous: SimpleState, form: FormData): Promise<SimpleState> {
  const user = await actor();
  const id = idSchema.parse(text(form, 'userId'));
  const role = roleSchema.safeParse(text(form, 'role'));
  if (!role.success) return { kind: 'error', message: 'Choose a role.' };
  try {
    const changed = await apiFetch(user, `/studio/users/${id}/role`, userSchema, {
      method: 'PATCH',
      body: { role: role.data },
    });
    revalidatePath('/studio', 'layout');
    return {
      kind: 'done',
      message: `${changed.name} is ${changed.role.toLowerCase()} now, from their next page load.`,
      at: Date.now(),
    };
  } catch (error) {
    return { kind: 'error', message: sentence(error, 'change role') };
  }
}

export type CreateKeyState =
  | { readonly kind: 'idle' }
  /** The only time the key exists outside the API's memory. It is not stored anywhere. */
  | { readonly kind: 'created'; readonly key: string; readonly name: string; readonly at: number }
  | { readonly kind: 'error'; readonly message: string; readonly value: string };

export async function createKey(
  _previous: CreateKeyState,
  form: FormData,
): Promise<CreateKeyState> {
  const user = await actor();
  const name = text(form, 'name');
  const parsed = createApiKeySchema.safeParse({ name });
  if (!parsed.success) return { kind: 'error', message: 'Give the key a name.', value: name };
  try {
    const created = await apiFetch(user, '/studio/api-keys', createdApiKeySchema, {
      method: 'POST',
      body: parsed.data,
    });
    revalidatePath('/studio/api-keys');
    return { kind: 'created', key: created.key, name: created.apiKey.name, at: Date.now() };
  } catch (error) {
    return { kind: 'error', message: sentence(error, 'create key'), value: name };
  }
}

export type RevokeState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'done'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

/** Revoking asks first: every client using that key stops working at once. */
export async function revokeKey(_previous: RevokeState, form: FormData): Promise<RevokeState> {
  const user = await actor();
  const id = idSchema.parse(text(form, 'keyId'));
  if (text(form, 'confirmed') !== 'yes') return { kind: 'confirm' };
  try {
    await apiFetch(user, `/studio/api-keys/${id}`, noContent, { method: 'DELETE' });
    revalidatePath('/studio/api-keys');
    return { kind: 'done', message: 'Revoked. Requests with this key get 401 from now on.' };
  } catch (error) {
    return { kind: 'error', message: sentence(error, 'revoke key') };
  }
}
