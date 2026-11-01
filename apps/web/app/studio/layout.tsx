import { can } from '@cms/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { maybeStudioUser } from '../../lib/studio/me';
import { signOutAction } from '../(auth)/actions';

export const metadata: Metadata = {
  title: { default: 'Studio', template: '%s · Studio' },
  robots: { index: false, follow: false },
};

/**
 * The studio's chrome (`data-surface="studio"`): where to go, filtered by
 * what the person's role can use, and how to leave. Hiding a link is a
 * courtesy; the API refuses the route for the wrong role either way
 * (`apps/api/test/roles.test.ts` walks every pair).
 */
export default async function StudioLayout({ children }: { children: ReactNode }) {
  const me = await maybeStudioUser();
  return (
    <div className="studio" data-surface="studio">
      {me === null ? null : (
        <header className="studio-header">
          <p className="studio-name">
            <Link href="/studio">Studio</Link>
          </p>
          <nav aria-label="Studio">
            <ul className="studio-nav" role="list">
              <li>
                <Link href="/studio">Posts</Link>
              </li>
              {can(me.role, 'comment.moderate') ? (
                <li>
                  <Link href="/studio/comments">Comments</Link>
                </li>
              ) : null}
              {can(me.role, 'user.manage') ? (
                <li>
                  <Link href="/studio/people">People</Link>
                </li>
              ) : null}
              {can(me.role, 'apikey.manage') ? (
                <li>
                  <Link href="/studio/api-keys">API keys</Link>
                </li>
              ) : null}
              <li>
                <Link href="/">View the site</Link>
              </li>
            </ul>
          </nav>
          <div className="studio-who">
            <span data-testid="who">
              {me.name}, <span data-testid="role">{me.role.toLowerCase()}</span>
            </span>
            <form action={signOutAction}>
              <button className="button" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </header>
      )}
      {children}
    </div>
  );
}
