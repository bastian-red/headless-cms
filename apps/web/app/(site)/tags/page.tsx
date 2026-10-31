import type { Metadata } from 'next';
import Link from 'next/link';

import { JsonLd } from '../../../components/json-ld';
import { appBaseUrl } from '../../../lib/config';
import { allTags } from '../../../lib/content';
import { alternatesFor, breadcrumbs, paths, SITE } from '../../../lib/seo';

/** Every tag on at least one live post, with how many. Prerendered; tag `posts`. */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Tags',
  description: `The subjects ${SITE.name} writes about, and how many posts each has.`,
  alternates: alternatesFor('/tags'),
  openGraph: { type: 'website', url: '/tags', title: `Tags · ${SITE.name}` },
};

export default async function Tags() {
  const tags = await allTags();
  return (
    <main id="main" className="page">
      <JsonLd
        data={breadcrumbs(appBaseUrl, [
          { name: 'Home', path: paths.home },
          { name: 'Tags', path: '/tags' },
        ])}
      />
      <h1>Tags</h1>
      <ul className="tag-list" role="list">
        {tags.map((tag) => (
          <li key={tag.slug}>
            <Link href={paths.tag(tag.slug)}>{tag.name}</Link>{' '}
            <span className="muted">
              ({String(tag.posts)} {tag.posts === 1 ? 'post' : 'posts'})
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
