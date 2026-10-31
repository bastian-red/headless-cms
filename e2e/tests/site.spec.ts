/**
 * The public site, from the outside: what a reader, a crawler and a feed
 * reader get. Specs/outcomes 3 and 4 (docs/SPECS.md): technical SEO on every
 * public page, and no unpublished text anywhere a stranger can fetch.
 *
 * The truth to compare against is the content API itself, read with the
 * site's own key (`CONTENT_API_KEY`, which e2e.sh exports and the seed
 * registers), so nothing here restates what the seed contains.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { APIRequestContext } from '@playwright/test';

import { API_BASE_URL, SEEDED, expect, test } from '../fixtures';

/**
 * The feed link every public page carries so feed readers find the feed, as
 * an absolute URL ending in /feed.xml. Attribute order is Next's to choose.
 */
function feedLink(html: string): string | null {
  for (const [tag] of html.matchAll(/<link [^>]*>/gu)) {
    if (tag.includes('rel="alternate"') && tag.includes('type="application/rss+xml"'))
      return /href="([^"]*)"/u.exec(tag)?.[1] ?? null;
  }
  return null;
}

const xml = new XMLParser({ ignoreAttributes: false, trimValues: false });

interface Summary {
  slug: string;
  title: string;
  publishedAt: string;
  revisedAt: string;
  author: { id: string; name: string };
}

/** Every live post, from the content API (the source the site renders). */
async function livePosts(request: APIRequestContext): Promise<Summary[]> {
  const key = process.env.CONTENT_API_KEY;
  if (key === undefined) throw new Error('CONTENT_API_KEY is not set; run this through e2e.sh.');
  const posts: Summary[] = [];
  let cursor: string | null = null;
  do {
    const url = `${API_BASE_URL}/v1/posts?limit=50${cursor === null ? '' : `&cursor=${cursor}`}`;
    const page = (await (
      await request.get(url, { headers: { authorization: `Bearer ${key}` } })
    ).json()) as { items: Summary[]; nextCursor: string | null };
    posts.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return posts;
}

const lastChanged = (post: Summary) =>
  post.revisedAt > post.publishedAt ? post.revisedAt : post.publishedAt;

/** The address the sitemap lists, as a path on this server. */
const pathOf = (loc: string) => new URL(loc).pathname;

async function sitemap(request: APIRequestContext) {
  const response = await request.get('/sitemap.xml');
  expect(response.headers()['content-type']).toContain('xml');
  const text = await response.text();
  expect(XMLValidator.validate(text)).toBe(true);
  const urls = xml.parse(text).urlset.url as { loc: string; lastmod?: string }[];
  return urls;
}

/** Every `<script type="application/ld+json">` on a page, parsed. */
function jsonLd(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gsu)].map(
    (match) => JSON.parse(match[1]!) as Record<string, unknown>,
  );
}

function head(html: string) {
  const attr = (pattern: RegExp) => pattern.exec(html)?.[1] ?? null;
  return {
    title: attr(/<title>([^<]*)<\/title>/u),
    description: attr(/<meta name="description" content="([^"]*)"/u),
    canonical: attr(/<link rel="canonical" href="([^"]*)"/u),
    robots: attr(/<meta name="robots" content="([^"]*)"/u),
    ogImage: attr(/<meta property="og:image" content="([^"]*)"/u),
  };
}

test.describe('the public site', () => {
  test('the sitemap lists every live post once, with lastmod from its content', async ({
    request,
  }) => {
    const posts = await livePosts(request);
    const urls = await sitemap(request);
    const listed = new Map(urls.map((url) => [pathOf(url.loc), url.lastmod]));
    expect(urls.length, 'no address twice').toBe(listed.size);
    for (const post of posts) {
      expect(listed.get(`/posts/${post.slug}`), post.slug).toBe(lastChanged(post));
    }
    const postPaths = [...listed.keys()].filter((path) => /^\/posts\/[^/]+$/u.test(path));
    expect(postPaths.sort()).toEqual(posts.map((post) => `/posts/${post.slug}`).sort());
    expect(listed.has('/search'), 'search is noindex, so not in the sitemap').toBe(false);
  });

  test('every indexable page: 200, its own title and description, canonical to itself, no unpublished text', async ({
    request,
  }) => {
    const urls = await sitemap(request);
    const titles = new Map<string, string>();
    const descriptions = new Map<string, string>();
    for (const { loc } of urls) {
      const path = pathOf(loc);
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      const html = await response.text();
      for (const canary of SEEDED.canaries)
        expect(html, `${path} leaks ${canary}`).not.toContain(canary);
      const meta = head(html);
      // The same address, compared as URLs: Next writes the root's canonical
      // without its trailing slash, and the URL standard reads both as `/`.
      expect(meta.canonical && new URL(meta.canonical).href, path).toBe(loc);
      expect(feedLink(html), `${path} names the feed`).toBe(new URL('/feed.xml', loc).href);
      expect(meta.robots, `${path} must be indexable`).toBeNull();
      expect(meta.title, path).toBeTruthy();
      expect(meta.description, path).toBeTruthy();
      expect(titles.get(meta.title!), `${path} shares its title`).toBeUndefined();
      expect(descriptions.get(meta.description!), `${path} shares its description`).toBeUndefined();
      titles.set(meta.title!, path);
      descriptions.set(meta.description!, path);
      // Every page says where it sits.
      expect(
        jsonLd(html).some(
          (data) => data['@type'] === 'BreadcrumbList' || data['@type'] === 'WebSite',
        ),
        `${path} has a BreadcrumbList or WebSite`,
      ).toBe(true);
    }
  });

  test('a post: BlogPosting and BreadcrumbList that parse, a card that is an image, the body rendered', async ({
    page,
    request,
  }) => {
    const path = `/posts/${SEEDED.longForm}`;
    const html = await (await request.get(path)).text();
    const data = jsonLd(html);
    const article = data.find((d) => d['@type'] === 'BlogPosting')!;
    const trail = data.find((d) => d['@type'] === 'BreadcrumbList')!;
    expect(article).toBeTruthy();
    expect(trail).toBeTruthy();
    const url = (article.url as string) ?? '';
    expect(pathOf(url)).toBe(path);
    expect(String(article.datePublished) <= String(article.dateModified)).toBe(true);
    expect((trail.itemListElement as { item: string }[]).at(-1)!.item).toBe(url);

    const card = head(html).ogImage!;
    expect((article.image as string[])[0]).toBe(card);
    const png = await request.get(pathOf(card));
    expect(png.headers()['content-type']).toBe('image/png');
    const bytes = await png.body();
    // PNG IHDR: width and height, big-endian, at bytes 16 and 20.
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1200, 630]);

    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(article.headline as string);
    // The outline's links land on the headings the renderer gave ids.
    const first = page.getByRole('navigation', { name: 'In this post' }).getByRole('link').first();
    const target = (await first.getAttribute('href'))!;
    await expect(page.locator(target)).toBeVisible();
  });

  test('an old slug answers 308 to the current one; a missing or taken-down post is a 404', async ({
    request,
  }) => {
    const moved = await request.get(`/posts/${SEEDED.renamedFrom}`, { maxRedirects: 0 });
    expect(moved.status()).toBe(308);
    // Exactly one Location. The old slug is never prerendered, so the first
    // request of a fresh build renders it (a cache MISS), and Next 16.4.1 sent
    // that render's Location twice (patches/next@16.4.1.patch).
    const locations = moved.headersArray().filter((h) => h.name.toLowerCase() === 'location');
    expect(locations.map((h) => h.value)).toEqual([`/posts/${SEEDED.renamedTo}`]);
    expect(new URL(moved.headers().location!, 'http://x').pathname).toBe(
      `/posts/${SEEDED.renamedTo}`,
    );
    expect((await request.get('/posts/no-such-post-anywhere')).status()).toBe(404);
    expect((await request.get(`/posts/${SEEDED.takenDown}`)).status()).toBe(404);
    expect((await request.get(`/posts/${SEEDED.takenDown}/card.png`)).status()).toBe(404);
  });

  test('the feed: RSS 2.0, the newest posts in full, absolute links only, nothing unpublished', async ({
    request,
  }) => {
    const response = await request.get('/feed.xml');
    expect(response.headers()['content-type']).toBe('application/rss+xml; charset=utf-8');
    const text = await response.text();
    expect(XMLValidator.validate(text)).toBe(true);
    for (const canary of SEEDED.canaries) expect(text).not.toContain(canary);
    const channel = xml.parse(text).rss.channel;
    const items = channel.item as { link: string; 'content:encoded': string; title: string }[];
    const newest = (await livePosts(request)).slice(0, items.length);
    expect(items.map((item) => pathOf(item.link))).toEqual(
      newest.map((post) => `/posts/${post.slug}`),
    );
    for (const item of items) {
      expect(item['content:encoded'], item.title).not.toMatch(/(?:href|src)="\/(?!\/)/u);
      expect(item['content:encoded'], item.title).not.toMatch(/<script|javascript:|\son\w+=/iu);
    }
  });

  test('robots.txt keeps crawlers out of the studio and previews, and points at the sitemap', async ({
    request,
  }) => {
    const text = await (await request.get('/robots.txt')).text();
    expect(text).toContain('Disallow: /studio');
    expect(text).toContain('Disallow: /preview');
    expect(text).toMatch(/^Sitemap: https?:\/\/[^\s]+\/sitemap\.xml$/mu);
  });

  test('search: per request, noindex, matched words marked, and it pages', async ({
    page,
    request,
  }) => {
    // A word with more than one page of results (10 a page), checked against
    // the API first so a smaller corpus fails here and not as a missing link.
    const word = 'reader';
    const key = process.env.CONTENT_API_KEY!;
    const first = (await (
      await request.get(`${API_BASE_URL}/v1/search?q=${word}&limit=10`, {
        headers: { authorization: `Bearer ${key}` },
      })
    ).json()) as { nextCursor: string | null };
    expect(first.nextCursor, `"${word}" has a second page`).not.toBeNull();

    await page.goto('/search');
    await page.getByLabel('Search posts').fill(word);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(new RegExp(`/search\\?q=${word}$`, 'u'));
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(
      new RegExp(`posts match “${word}”`, 'u'),
    );
    await expect(page.locator('.snippet mark').first()).toBeVisible();
    const firstPage = await page.locator('.post-list-title').allTextContents();
    await page.getByRole('link', { name: 'More results' }).click();
    await expect(page).toHaveURL(/[?&]cursor=/u);
    const secondPage = await page.locator('.post-list-title').allTextContents();
    expect(secondPage.length).toBeGreaterThan(0);
    expect(secondPage.filter((title) => firstPage.includes(title))).toEqual([]);
    for (const canary of SEEDED.canaries) {
      await page.goto(`/search?q=${canary}`);
      await expect(page.getByRole('heading', { level: 2 })).toHaveText(
        `No posts match “${canary}”`,
      );
    }
  });
});
