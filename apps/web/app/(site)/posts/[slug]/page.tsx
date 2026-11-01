import { render } from '@cms/markdown';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';

import { ArticleBody } from '../../../../components/article-body';
import { CommentForm } from '../../../../components/comment-form';
import { Comments } from '../../../../components/comments';
import { JsonLd } from '../../../../components/json-ld';
import { PostByline } from '../../../../components/post-list';
import { appBaseUrl, contentAtBuild } from '../../../../lib/config';
import { longDate } from '../../../../lib/dates';
import { submitComment } from '../../../../lib/comment-action';
import { allPosts, approvedComments, postBySlug } from '../../../../lib/content';
import {
  absolute,
  alternatesFor,
  blogPosting,
  breadcrumbs,
  CARD,
  describe,
  lastChanged,
  paths,
} from '../../../../lib/seo';

/**
 * One post: prerendered for every live slug at build time, rendered once and
 * then cached for a slug published later (`dynamicParams`), and revalidated
 * by its `post:<slug>` tag. The body goes through the same renderer as the
 * studio preview and the feed, as React elements, never as an HTML string.
 *
 * An old slug answers 308 to the current one (the API keeps every rename);
 * a slug that never existed, or a post taken down, is a 404.
 *
 * The approved comments render inside the same static page, from their own
 * read tagged `comments:<slug>`, so an editor's decision refreshes this page
 * through the publisher's webhook and no reader's browser fetches anything.
 */
export const revalidate = 3600;
export const dynamicParams = true;

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  // A deferred build has no API to enumerate; every slug renders on request.
  if (contentAtBuild === 'deferred') return [];
  return (await allPosts()).map((post) => ({ slug: post.slug }));
}

async function load(slug: string) {
  const found = await postBySlug(slug);
  if (found.kind === 'moved') permanentRedirect(paths.post(found.slug));
  if (found.kind === 'missing') notFound();
  return found.post;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await load((await params).slug);
  const title = post.seoTitle ?? post.title;
  const description = describe(post.seoDescription ?? post.excerpt);
  const url = paths.post(post.slug);
  return {
    title,
    description,
    alternates: alternatesFor(url),
    authors: [{ name: post.author.name, url: paths.author(post.author.id) }],
    openGraph: {
      type: 'article',
      url,
      title,
      description,
      publishedTime: post.publishedAt,
      modifiedTime: lastChanged(post),
      authors: [absolute(appBaseUrl, paths.author(post.author.id))],
      tags: post.tags.map((tag) => tag.name),
      images: [
        {
          url: paths.card(post.slug),
          width: CARD.width,
          height: CARD.height,
          type: CARD.type,
          alt: title,
        },
      ],
    },
    twitter: { card: 'summary_large_image', title, description, images: [paths.card(post.slug)] },
  };
}

export default async function PostPage({ params }: Props) {
  const post = await load((await params).slug);
  const [rendered, comments] = [render(post.body), await approvedComments(post.slug)];
  const url = paths.post(post.slug);
  // headline is the article's own title; the SEO title is for <title> and cards.
  const facts = { ...post, description: describe(post.seoDescription ?? post.excerpt) };
  return (
    <main id="main" className="page">
      <JsonLd
        data={blogPosting(
          appBaseUrl,
          { ...facts, commentCount: comments.length },
          absolute(appBaseUrl, paths.card(post.slug)),
        )}
      />
      <JsonLd
        data={breadcrumbs(appBaseUrl, [
          { name: 'Home', path: paths.home },
          { name: 'All posts', path: paths.archive },
          { name: post.title, path: url },
        ])}
      />
      <nav aria-label="Breadcrumb" className="breadcrumbs muted">
        <ol role="list">
          <li>
            <Link href={paths.home}>Home</Link>
          </li>
          <li>
            <Link href={paths.archive}>All posts</Link>
          </li>
          <li aria-current="page">{post.title}</li>
        </ol>
      </nav>
      <article className="post">
        <header className="post-header">
          <h1>{post.title}</h1>
          <PostByline post={post} />
          <p className="muted">
            {String(post.readingMinutes)} min read · {post.words.toLocaleString('en')} words
            {/* revisedAt is when the shown revision was written, which can
                precede the first publish; only a later one is a revision. */}
            {post.revisedAt > post.publishedAt ? (
              <>
                {' · '}revised <time dateTime={post.revisedAt}>{longDate(post.revisedAt)}</time>
              </>
            ) : null}
          </p>
        </header>
        <ArticleBody rendered={rendered} />
      </article>
      <section className="comments" aria-labelledby="comments-title">
        <Comments comments={comments} />
        <CommentForm postSlug={post.slug} action={submitComment} />
      </section>
    </main>
  );
}
