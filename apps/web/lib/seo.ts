/**
 * Technical SEO as plain functions: addresses, descriptions, JSON-LD and the
 * RSS document. No Next import and no environment read, so the gate lane tests
 * every one with computed expectations; the routes pass the origin in.
 */

export const SITE = {
  name: 'Quire',
  description: 'A small journal about how pages get made and read.',
  language: 'en',
} as const;

/** The social card's size: the 1.91:1 that Open Graph and X both crop to. */
export const CARD = { width: 1200, height: 630, type: 'image/png' } as const;

export const paths = {
  home: '/',
  archive: '/posts',
  post: (slug: string) => `/posts/${slug}`,
  card: (slug: string) => `/posts/${slug}/card.png`,
  tag: (slug: string) => `/tags/${slug}`,
  author: (id: string) => `/authors/${id}`,
  search: '/search',
  feed: '/feed.xml',
  sitemap: '/sitemap.xml',
} as const;

/**
 * A page's `alternates` metadata: its canonical address and the feed. Next
 * merges metadata one key deep, so a page that sets `alternates` for its
 * canonical replaces the layout's whole `alternates`, feed link included.
 * Every public page builds it here instead, so none can drop the feed.
 */
export function alternatesFor(canonical: string) {
  return {
    canonical,
    types: { 'application/rss+xml': [{ url: paths.feed, title: SITE.name }] },
  };
}

/** `path` on the public origin. The origin's own path, if any, is replaced. */
export function absolute(origin: string, path: string): string {
  return new URL(path, origin).href;
}

/**
 * A meta description: whole words, at most `max` characters including the
 * ellipsis, whitespace collapsed. Search engines cut around 155-160.
 */
export function describe(text: string, max = 160): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/u, '')}…`;
}

export interface PostFacts {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly author: { readonly id: string; readonly name: string };
  readonly tags: readonly { readonly slug: string; readonly name: string }[];
  readonly publishedAt: string;
  readonly revisedAt: string;
  readonly words: number;
}

/** schema.org `BlogPosting` for one post. */
export function blogPosting(origin: string, post: PostFacts, image: string) {
  const url = absolute(origin, paths.post(post.slug));
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    headline: post.title,
    description: post.description,
    image: [image],
    datePublished: post.publishedAt,
    // Never before datePublished: a revision written before the first
    // publish went public with it (see lastChanged).
    dateModified: lastChanged(post),
    wordCount: post.words,
    inLanguage: SITE.language,
    keywords: post.tags.map((tag) => tag.name),
    author: {
      '@type': 'Person',
      name: post.author.name,
      url: absolute(origin, paths.author(post.author.id)),
    },
    publisher: { '@type': 'Organization', name: SITE.name, url: absolute(origin, paths.home) },
  };
}

/** schema.org `BreadcrumbList`: Home first, the page itself last. */
export function breadcrumbs(origin: string, trail: readonly { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absolute(origin, crumb.path),
    })),
  };
}

/** schema.org `WebSite` with the search action a results page answers. */
export function website(origin: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
    description: SITE.description,
    url: absolute(origin, paths.home),
    inLanguage: SITE.language,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${absolute(origin, paths.search)}?q={q}` },
      'query-input': 'required name=q',
    },
  };
}

/**
 * JSON for a `<script type="application/ld+json">` text child. React already
 * escapes `</script`; this also escapes every `<`, `>` and `&` and the two
 * JavaScript line terminators, so no title can end the element or open a
 * comment, whatever renders it. The result is still JSON that parses to `data`.
 */
export function jsonLdText(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</gu, '\\u003c')
    .replace(/>/gu, '\\u003e')
    .replace(/&/gu, '\\u0026')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}

/** XML character data: the five predefined entities, and no character XML 1.0 forbids. */
export function xmlText(value: string): string {
  return value
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

/** A CDATA section that holds any string: `]]>` is split across two sections. */
export function cdata(value: string): string {
  const clean = value.replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '');
  return `<![CDATA[${clean.replace(/\]\]>/gu, ']]]]><![CDATA[>')}]]>`;
}

/** RFC 822 dates, as RSS 2.0 requires: `Sat, 31 Oct 2026 10:00:00 GMT`. */
export function rfc822(instant: string): string {
  return new Date(instant).toUTCString();
}

export interface FeedItem {
  readonly title: string;
  readonly slug: string;
  readonly description: string;
  /** The full, sanitized body with absolute URLs. */
  readonly html: string;
  readonly author: string;
  readonly categories: readonly string[];
  readonly publishedAt: string;
}

/**
 * An RSS 2.0 document. `lastBuildDate` is the newest item's date, not the
 * clock, so the same content always produces the same bytes (and the same
 * cache entry).
 */
export function rss(origin: string, items: readonly FeedItem[]): string {
  const home = absolute(origin, paths.home);
  const self = absolute(origin, paths.feed);
  const newest = items.reduce<string | null>(
    (latest, item) => (latest === null || item.publishedAt > latest ? item.publishedAt : latest),
    null,
  );
  const entries = items.map((item) => {
    const url = absolute(origin, paths.post(item.slug));
    return [
      '    <item>',
      `      <title>${xmlText(item.title)}</title>`,
      `      <link>${xmlText(url)}</link>`,
      `      <guid isPermaLink="true">${xmlText(url)}</guid>`,
      `      <pubDate>${rfc822(item.publishedAt)}</pubDate>`,
      `      <dc:creator>${xmlText(item.author)}</dc:creator>`,
      ...item.categories.map((name) => `      <category>${xmlText(name)}</category>`),
      `      <description>${xmlText(item.description)}</description>`,
      `      <content:encoded>${cdata(item.html)}</content:encoded>`,
      '    </item>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>',
    `    <title>${xmlText(SITE.name)}</title>`,
    `    <link>${xmlText(home)}</link>`,
    `    <description>${xmlText(SITE.description)}</description>`,
    `    <language>${SITE.language}</language>`,
    `    <atom:link href="${xmlText(self)}" rel="self" type="application/rss+xml"/>`,
    ...(newest === null ? [] : [`    <lastBuildDate>${rfc822(newest)}</lastBuildDate>`]),
    ...entries,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

/** The latest of some ISO instants (they sort as strings), or null for none. */
export function latest(instants: readonly string[]): string | null {
  return instants.reduce<string | null>((max, at) => (max === null || at > max ? at : max), null);
}

/**
 * When what readers see at a post's address last changed: the later of its
 * first publish and the writing of the revision it shows (a revision written
 * before the first publish went public with it). The sitemap's `lastmod`.
 */
export function lastChanged(post: { publishedAt: string; revisedAt: string }): string {
  return post.revisedAt > post.publishedAt ? post.revisedAt : post.publishedAt;
}
