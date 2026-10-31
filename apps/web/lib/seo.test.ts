/**
 * The SEO building blocks. Expected strings were produced by running the
 * functions (`Date#toUTCString`, the ellipsis cut) and checked by eye, not
 * typed from memory.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { describe as group, expect, it } from 'vitest';

import {
  absolute,
  blogPosting,
  breadcrumbs,
  cdata,
  describe,
  jsonLdText,
  lastChanged,
  latest,
  rfc822,
  rss,
  website,
  xmlText,
  type FeedItem,
  type PostFacts,
} from './seo';

const ORIGIN = 'https://quire.example';

const POST: PostFacts = {
  slug: 'a-post',
  title: 'A post',
  description: 'What it is about.',
  author: { id: 'cmvtux7sa0002rp1f8ahw36ao', name: 'Mara Lindgren' },
  tags: [{ slug: 'caching', name: 'Caching' }],
  publishedAt: '2026-10-20T08:00:00.000Z',
  // Written an hour before it went live: the seeded long read is exactly this.
  revisedAt: '2026-10-20T07:00:00.000Z',
  words: 3417,
};

group('describe', () => {
  it('keeps a short description as it is, whitespace collapsed', () => {
    expect(describe('  One  line\nonly. ')).toBe('One line only.');
  });

  it('cuts a long one at a word, with an ellipsis, within the limit', () => {
    const long =
      'Static rendering, tag-based revalidation, fonts, images and the measure: every decision ' +
      'behind a post that loads before the reader notices, and some more words to pass the limit.';
    const cut = describe(long);
    expect(cut).toBe(
      'Static rendering, tag-based revalidation, fonts, images and the measure: every decision ' +
        'behind a post that loads before the reader notices, and some more…',
    );
    expect(cut.length).toBeLessThanOrEqual(160);
    expect(describe('One two three four five six', 15)).toBe('One two three…');
  });
});

group('absolute', () => {
  it('resolves a path against the public origin', () => {
    expect(absolute(ORIGIN, '/posts/x')).toBe('https://quire.example/posts/x');
    expect(absolute('https://example.com/blog/', '/posts/x')).toBe('https://example.com/posts/x');
  });
});

group('lastChanged and latest', () => {
  it('is never earlier than the first publish', () => {
    expect(lastChanged(POST)).toBe(POST.publishedAt);
    expect(lastChanged({ ...POST, revisedAt: '2026-10-25T09:00:00.000Z' })).toBe(
      '2026-10-25T09:00:00.000Z',
    );
  });

  it('finds the newest instant, or null for none', () => {
    expect(latest(['2026-01-02T00:00:00.000Z', '2026-03-01T00:00:00.000Z'])).toBe(
      '2026-03-01T00:00:00.000Z',
    );
    expect(latest([])).toBeNull();
  });
});

group('JSON-LD', () => {
  it('BlogPosting: absolute URLs, and dateModified never before datePublished', () => {
    const data = blogPosting(ORIGIN, POST, `${ORIGIN}/posts/a-post/card.png`);
    expect(data).toMatchObject({
      '@type': 'BlogPosting',
      headline: 'A post',
      url: 'https://quire.example/posts/a-post',
      mainEntityOfPage: { '@id': 'https://quire.example/posts/a-post' },
      image: ['https://quire.example/posts/a-post/card.png'],
      datePublished: '2026-10-20T08:00:00.000Z',
      dateModified: '2026-10-20T08:00:00.000Z',
      wordCount: 3417,
      keywords: ['Caching'],
      author: {
        '@type': 'Person',
        name: 'Mara Lindgren',
        url: 'https://quire.example/authors/cmvtux7sa0002rp1f8ahw36ao',
      },
    });
  });

  it('BreadcrumbList: positions from 1, absolute items', () => {
    const data = breadcrumbs(ORIGIN, [
      { name: 'Home', path: '/' },
      { name: 'A post', path: '/posts/a-post' },
    ]);
    expect(data.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://quire.example/' },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'A post',
        item: 'https://quire.example/posts/a-post',
      },
    ]);
  });

  it('WebSite: a search action that points at the results page', () => {
    expect(website(ORIGIN).potentialAction.target.urlTemplate).toBe(
      'https://quire.example/search?q={q}',
    );
  });

  it('jsonLdText: no character that can end the element, and it parses back', () => {
    const hostile = { headline: '</script><!-- & > \u2028 \u2029 end' };
    const text = jsonLdText(hostile);
    expect(text).not.toMatch(/[<>&\u2028\u2029]/u);
    expect(text).toBe(
      '{"headline":"\\u003c/script\\u003e\\u003c!-- \\u0026 \\u003e \\u2028 \\u2029 end"}',
    );
    expect(JSON.parse(text)).toEqual(hostile);
  });
});

group('XML text', () => {
  it('escapes the five entities and drops characters XML 1.0 forbids', () => {
    expect(xmlText(`a & <b> "c" 'd' \u0000\u000b \u{1F600}`)).toBe(
      'a &amp; &lt;b&gt; &quot;c&quot; &apos;d&apos;  \u{1F600}',
    );
  });

  it('cdata holds a body that contains its own terminator', () => {
    expect(cdata('a]]>b')).toBe('<![CDATA[a]]]]><![CDATA[>b]]>');
  });

  it('dates in RFC 822, as RSS 2.0 requires', () => {
    expect(rfc822('2026-10-20T08:00:00.000Z')).toBe('Tue, 20 Oct 2026 08:00:00 GMT');
  });
});

group('rss', () => {
  const hostile: FeedItem = {
    title: 'Tags & <angles> "quoted" \u0000',
    slug: 'hostile',
    description: 'A ]]> in the summary',
    html: '<p>Code: <code>a]]&gt;b</code> and ]]> raw, \u000b too</p>',
    author: 'Mara & co',
    categories: ['Caching & CDNs'],
    publishedAt: '2026-10-21T08:00:00.000Z',
  };
  const plain: FeedItem = {
    ...hostile,
    title: 'Plain',
    slug: 'plain',
    html: '<p>Hi</p>',
    publishedAt: '2026-10-20T08:00:00.000Z',
  };

  it('is well-formed XML whatever the posts say, and round-trips their text', () => {
    const xml = rss(ORIGIN, [hostile, plain]);
    expect(XMLValidator.validate(xml)).toBe(true);
    const doc = new XMLParser({ ignoreAttributes: false, trimValues: false }).parse(xml);
    const [first] = doc.rss.channel.item;
    expect(first.title).toBe('Tags & <angles> "quoted" ');
    expect(first['content:encoded']).toBe('<p>Code: <code>a]]&gt;b</code> and ]]> raw,  too</p>');
    expect(first.link).toBe('https://quire.example/posts/hostile');
    expect(first.guid['#text']).toBe('https://quire.example/posts/hostile');
    expect(doc.rss.channel['atom:link']['@_href']).toBe('https://quire.example/feed.xml');
  });

  it('takes lastBuildDate from the newest post, so the same posts give the same bytes', () => {
    const xml = rss(ORIGIN, [plain, hostile]);
    expect(xml).toContain('<lastBuildDate>Wed, 21 Oct 2026 08:00:00 GMT</lastBuildDate>');
    expect(rss(ORIGIN, [plain, hostile])).toBe(xml);
    expect(rss(ORIGIN, [])).not.toContain('lastBuildDate');
  });
});
