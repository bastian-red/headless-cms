import { idSchema } from '@cms/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { JsonLd } from '../../../../components/json-ld';
import { PostList } from '../../../../components/post-list';
import { appBaseUrl, contentAtBuild } from '../../../../lib/config';
import { allPosts, postsBy } from '../../../../lib/content';
import { alternatesFor, breadcrumbs, paths, SITE } from '../../../../lib/seo';

/**
 * One author's live posts. The content API has no author endpoint (an author
 * is public only through what they published), so the author set is read
 * from the posts, and an author with no live post is a 404. Tags `posts` and
 * `author:<id>`.
 */
export const revalidate = 3600;
export const dynamicParams = true;

type Props = { params: Promise<{ id: string }> };

export async function generateStaticParams() {
  if (contentAtBuild === 'deferred') return [];
  return [...new Set((await allPosts()).map((post) => post.author.id))].map((id) => ({ id }));
}

async function load(id: string) {
  // The API refuses an id that is not one; there is nobody to show.
  if (!idSchema.safeParse(id).success) notFound();
  const posts = await postsBy(id);
  const author = posts[0]?.author;
  if (author === undefined) notFound();
  return { author, posts };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { author, posts } = await load((await params).id);
  const path = paths.author(author.id);
  const description = `${String(posts.length)} ${posts.length === 1 ? 'post' : 'posts'} by ${author.name} in ${SITE.name}.`;
  return {
    title: author.name,
    description,
    alternates: alternatesFor(path),
    openGraph: { type: 'profile', url: path, title: `${author.name} · ${SITE.name}`, description },
  };
}

export default async function AuthorPage({ params }: Props) {
  const { author, posts } = await load((await params).id);
  return (
    <main id="main" className="page">
      <JsonLd
        data={breadcrumbs(appBaseUrl, [
          { name: 'Home', path: paths.home },
          { name: author.name, path: paths.author(author.id) },
        ])}
      />
      <p className="muted">Author</p>
      <h1>{author.name}</h1>
      <PostList posts={posts} />
    </main>
  );
}
