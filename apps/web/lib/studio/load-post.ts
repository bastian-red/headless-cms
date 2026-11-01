import 'server-only';

import { idSchema, studioPostSchema, type SessionUser, type StudioPost } from '@cms/shared';
import { notFound } from 'next/navigation';

import { ApiError, apiFetch } from '../api';

/**
 * One post for a studio page, or the 404 page. The API answers 404 both for
 * an id that is not a post and for somebody else's post asked for by an
 * author, so the page cannot tell those apart either.
 */
export async function loadPost(session: SessionUser, id: string): Promise<StudioPost> {
  if (!idSchema.safeParse(id).success) notFound();
  try {
    return await apiFetch(session, `/studio/posts/${id}`, studioPostSchema);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
