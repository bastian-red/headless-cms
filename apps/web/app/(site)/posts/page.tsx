import type { Metadata } from 'next';

import { JsonLd } from '../../../components/json-ld';
import { PostList } from '../../../components/post-list';
import { appBaseUrl } from '../../../lib/config';
import { yearOf } from '../../../lib/dates';
import { allPosts } from '../../../lib/content';
import { alternatesFor, breadcrumbs, paths, SITE } from '../../../lib/seo';

/** Every live post, newest first, grouped by year. Prerendered; tag `posts`. */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'All posts',
  description: `Every post ${SITE.name} has published, newest first.`,
  alternates: alternatesFor(paths.archive),
  openGraph: { type: 'website', url: paths.archive, title: `All posts · ${SITE.name}` },
};

export default async function Archive() {
  const posts = await allPosts();
  const years = new Map<string, typeof posts>();
  for (const post of posts) {
    const year = yearOf(post.publishedAt);
    years.set(year, [...(years.get(year) ?? []), post]);
  }
  return (
    <main id="main" className="page">
      <JsonLd
        data={breadcrumbs(appBaseUrl, [
          { name: 'Home', path: paths.home },
          { name: 'All posts', path: paths.archive },
        ])}
      />
      <h1>All posts</h1>
      <p className="muted">
        {String(posts.length)} {posts.length === 1 ? 'post' : 'posts'}, newest first.
      </p>
      {[...years].map(([year, list]) => (
        <section key={year} aria-labelledby={`year-${year}`}>
          <h2 id={`year-${year}`}>{year}</h2>
          <PostList posts={list} headingLevel={3} />
        </section>
      ))}
    </main>
  );
}
