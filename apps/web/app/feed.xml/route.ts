import { render, renderHtml } from '@cms/markdown';

import { appBaseUrl } from '../../lib/config';
import { allPosts, postBySlug } from '../../lib/content';
import { absolute, describe, paths, rss, type FeedItem } from '../../lib/seo';

/**
 * RSS 2.0 with the full body of the latest posts. A feed reader is often the
 * only place a reader sees a post, so `content:encoded` carries the whole
 * thing, through the same renderer as the page (sanitized, audited) and with
 * every link made absolute. Prerendered; tags `posts` and each `post:<slug>`.
 */
export const revalidate = 3600;

/** How many posts the feed carries. */
const ITEMS = 20;

export async function GET(): Promise<Response> {
  const latest = (await allPosts()).slice(0, ITEMS);
  const items: FeedItem[] = [];
  for (const summary of latest) {
    const found = await postBySlug(summary.slug);
    if (found.kind !== 'post') continue;
    const post = found.post;
    items.push({
      title: post.title,
      slug: post.slug,
      description: describe(post.seoDescription ?? post.excerpt, 300),
      html: renderHtml(
        render(post.body, { base: absolute(appBaseUrl, paths.post(post.slug)) }).tree,
      ),
      author: post.author.name,
      categories: post.tags.map((tag) => tag.name),
      publishedAt: post.publishedAt,
    });
  }
  return new Response(rss(appBaseUrl, items), {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
  });
}
