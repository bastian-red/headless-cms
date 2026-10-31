import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { SITE, alternatesFor, paths } from '../../lib/seo';

/**
 * The public site's chrome: the publication's name, the three ways in (latest,
 * the archive, search) and the feed. Nothing here reads the request, so every
 * page under it can be prerendered.
 */
export const metadata: Metadata = {
  title: { default: SITE.name, template: `%s · ${SITE.name}` },
  description: SITE.description,
  // Pages under this layout set their own (lib/seo.ts alternatesFor); this
  // covers the ones that do not, such as the 404.
  alternates: { types: alternatesFor(paths.home).types },
  openGraph: { siteName: SITE.name, locale: 'en_US' },
};

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site" data-surface="read">
      <header className="site-header">
        <p className="site-name">
          <Link href={paths.home}>{SITE.name}</Link>
        </p>
        <nav aria-label="Site">
          <ul className="site-nav" role="list">
            <li>
              <Link href={paths.archive}>All posts</Link>
            </li>
            <li>
              <Link href={paths.search}>Search</Link>
            </li>
            <li>
              <a href={paths.feed}>RSS feed</a>
            </li>
          </ul>
        </nav>
      </header>
      {children}
      <footer className="site-footer muted">
        <p>
          {SITE.name}: {SITE.description}
        </p>
      </footer>
    </div>
  );
}
