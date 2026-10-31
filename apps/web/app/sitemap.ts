import type { MetadataRoute } from 'next';

import { appBaseUrl } from '../lib/config';
import { allPosts } from '../lib/content';
import { absolute, lastChanged, latest, paths } from '../lib/seo';

/**
 * Every indexable public address, with `lastmod` from the content itself:
 * a post's is `lastChanged` (lib/seo.ts), a listing's is the latest of the
 * posts it lists. Never the build's clock, which would tell crawlers that
 * every page changed on every deploy. Search is left out: it is `noindex`.
 * Prerendered; tag `posts`.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await allPosts();
  const at = (instants: string[]) => {
    const newest = latest(instants);
    return newest === null ? {} : { lastModified: newest };
  };
  const everything = posts.map(lastChanged);
  const byTag = new Map<string, string[]>();
  const byAuthor = new Map<string, string[]>();
  for (const post of posts) {
    for (const tag of post.tags)
      byTag.set(tag.slug, [...(byTag.get(tag.slug) ?? []), lastChanged(post)]);
    byAuthor.set(post.author.id, [...(byAuthor.get(post.author.id) ?? []), lastChanged(post)]);
  }
  const url = (path: string) => absolute(appBaseUrl, path);
  return [
    { url: url(paths.home), ...at(everything) },
    { url: url(paths.archive), ...at(everything) },
    { url: url('/tags'), ...at(everything) },
    ...posts.map((post) => ({ url: url(paths.post(post.slug)), lastModified: lastChanged(post) })),
    ...[...byTag].map(([slug, instants]) => ({ url: url(paths.tag(slug)), ...at(instants) })),
    ...[...byAuthor].map(([id, instants]) => ({ url: url(paths.author(id)), ...at(instants) })),
  ];
}
