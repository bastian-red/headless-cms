import 'server-only';

import { sessionUserSchema, type SessionUser } from '@cms/shared';
import { cache } from 'react';

import { auth } from '../../auth';
import { apiFetch } from '../api';
import { requireUser } from '../session';

/**
 * Who is signed in, as the API sees them now: the role comes from
 * `GET /auth/me`, not the session's copy, so a demotion takes effect on the
 * next page load. `cache()` makes it one call per request however many
 * components ask (the layout's navigation and the page itself).
 */
const current = cache(async (session: SessionUser) =>
  apiFetch(session, '/auth/me', sessionUserSchema),
);

/** For a page: the person, or a redirect to sign in that comes back to `next`. */
export async function studioUser(next: string): Promise<{ session: SessionUser; me: SessionUser }> {
  const session = await requireUser(next);
  return { session, me: await current(session) };
}

/** For the layout, which cannot redirect to the right place: the person, or null. */
export async function maybeStudioUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user) return null;
  return current(session.user);
}
