import type { Metadata } from 'next';
import Link from 'next/link';

import { JsonLd } from '../../components/json-ld';
import { PostList } from '../../components/post-list';
import { appBaseUrl } from '../../lib/config';
import { allPosts } from '../../lib/content';
import { alternatesFor, paths, SITE, website } from '../../lib/seo';

/**
 * The front page: the latest posts, prerendered and revalidated by the
 * `posts` tag. Nothing here may read cookies or headers, or the whole route
 * turns dynamic (scripts/render-check.mjs fails the build if it does).
 */
export const revalidate = 3600;

/** How many posts the front page shows; the archive has the rest. */
const LATEST = 10;

export const metadata: Metadata = {
  title: { absolute: `${SITE.name}: ${SITE.description}` },
  alternates: alternatesFor(paths.home),
  openGraph: { type: 'website', url: paths.home, title: SITE.name, description: SITE.description },
};

export default async function Home() {
  const posts = await allPosts();
  const latest = posts.slice(0, LATEST);
  return (
    <main id="main" className="page">
      <JsonLd data={website(appBaseUrl)} />
      <h1>Latest from {SITE.name}</h1>
      {latest.length === 0 ? (
        <p>Nothing is published yet.</p>
      ) : (
        <>
          <PostList posts={latest} />
          {posts.length > LATEST ? (
            <p>
              <Link href={paths.archive}>All {String(posts.length)} posts, by year</Link>
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
