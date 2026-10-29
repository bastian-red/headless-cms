import { sessionUserSchema } from '@cms/shared';
import Link from 'next/link';

import { apiFetch } from '../../lib/api';
import { requireUser } from '../../lib/session';
import { signOutAction } from '../(auth)/actions';

export const metadata = { title: 'Studio', robots: { index: false } };

const ROLE_TEXT = {
  AUTHOR: 'You can write drafts and submit them for review.',
  EDITOR: 'You can publish, schedule and unpublish posts, and moderate comments.',
  ADMIN: 'You can do everything an editor can, and manage people and API keys.',
} as const;

/**
 * The studio's front page.
 *
 * The role shown is the API's answer from `GET /auth/me`, not the session's
 * copy: an admin's demotion takes effect on the next page load, not at the next
 * sign-in. The post list, editor and moderation queue arrive in build step 9.
 */
export default async function StudioPage() {
  const session = await requireUser('/studio');
  const me = await apiFetch(session, '/auth/me', sessionUserSchema);

  return (
    <main id="main" className="page">
      <h1>Studio</h1>
      <div className="panel" data-testid="who">
        <p>
          Signed in as <strong>{me.name}</strong> ({me.email}),{' '}
          <span data-testid="role">{me.role.toLowerCase()}</span>.
        </p>
        <p className="muted">{ROLE_TEXT[me.role]}</p>
      </div>
      <form action={signOutAction}>
        <button className="button" type="submit">
          Sign out
        </button>
      </form>
      <p>
        <Link href="/">View the site</Link>
      </p>
    </main>
  );
}
