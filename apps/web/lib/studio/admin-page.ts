import 'server-only';

import { can, type Action, type SessionUser } from '@cms/shared';
import { notFound } from 'next/navigation';

import { studioUser } from './me';

/**
 * A page only some roles have. For anyone else it does not exist (404, the
 * same answer the API gives a role that may not see a route's data), rather
 * than a page that renders and then fails on its first API call.
 */
export async function requireAbility(
  next: string,
  action: Action,
): Promise<{ session: SessionUser; me: SessionUser }> {
  const user = await studioUser(next);
  if (!can(user.me.role, action)) notFound();
  return user;
}
