import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { JsonLd } from '../../../../components/json-ld';
import { PostList } from '../../../../components/post-list';
import { appBaseUrl, contentAtBuild } from '../../../../lib/config';
import { allTags, postsTagged } from '../../../../lib/content';
import { alternatesFor, breadcrumbs, describe, paths, SITE } from '../../../../lib/seo';

/**
 * One tag's live posts. Prerendered for every tag with a live post; a tag
 * with none is a 404 (an empty page is a soft 404 to a crawler). Tags `posts`
 * and `tag:<slug>`.
 */
export const revalidate = 3600;
export const dynamicParams = true;

type Props = { params: Promise<{ tag: string }> };

export async function generateStaticParams() {
  if (contentAtBuild === 'deferred') return [];
  return (await allTags()).map((tag) => ({ tag: tag.slug }));
}

async function load(slug: string) {
  const tag = (await allTags()).find((t) => t.slug === slug);
  if (tag === undefined) notFound();
  return tag;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tag = await load((await params).tag);
  const path = paths.tag(tag.slug);
  const description = describe(
    tag.description ?? `${String(tag.posts)} ${SITE.name} posts tagged ${tag.name}.`,
  );
  return {
    title: tag.name,
    description,
    alternates: alternatesFor(path),
    openGraph: { type: 'website', url: path, title: `${tag.name} · ${SITE.name}`, description },
  };
}

export default async function TagPage({ params }: Props) {
  const tag = await load((await params).tag);
  const posts = await postsTagged(tag.slug);
  return (
    <main id="main" className="page">
      <JsonLd
        data={breadcrumbs(appBaseUrl, [
          { name: 'Home', path: paths.home },
          { name: 'Tags', path: '/tags' },
          { name: tag.name, path: paths.tag(tag.slug) },
        ])}
      />
      <p className="muted">Tag</p>
      <h1>{tag.name}</h1>
      {tag.description === null ? null : <p>{tag.description}</p>}
      <PostList posts={posts} />
    </main>
  );
}
