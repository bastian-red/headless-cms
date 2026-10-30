/**
 * What the renderer adds beyond sanitizing: heading levels and ids, the
 * outline, working footnote links, images, feed URLs and the text the
 * search index reads. The time budget is server.test.ts.
 */
import { SLUG_PATTERN } from '@cms/shared';
import type { Element, Root } from 'hast';
import rehypeSanitize from 'rehype-sanitize';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { describe, expect, it } from 'vitest';

import { findUnsafe, UnsafeOutputError } from './audit.js';
import { render } from './render.js';
import { SCHEMA } from './schema.js';

function elements(tree: Root, tagName?: string): Element[] {
  const found: Element[] = [];
  visit(tree, 'element', (node: Element) => {
    if (tagName === undefined || node.tagName === tagName) found.push(node);
  });
  return found;
}

describe('headings', () => {
  it('shift down a level when the author used #, so the page keeps one h1', () => {
    const { tree } = render('# One\n\n## Two\n\n###### Six');
    expect(elements(tree).map((e) => e.tagName)).toEqual(['h2', 'h3', 'h6']);
  });

  it('stay where they are when the author started at ##', () => {
    const { tree } = render('## One\n\n### Two');
    expect(elements(tree).map((e) => e.tagName)).toEqual(['h2', 'h3']);
  });

  it('get unique slug ids, listed in the outline in order', () => {
    const { tree, outline } = render('## Setup\n\n### Setup\n\n## Café au lait\n\n## !!!');
    expect(outline).toEqual([
      { depth: 2, id: 'setup', text: 'Setup' },
      { depth: 3, id: 'setup-2', text: 'Setup' },
      { depth: 2, id: 'cafe-au-lait', text: 'Café au lait' },
      { depth: 2, id: 'section', text: '!!!' },
    ]);
    expect(elements(tree, 'h2').map((h) => h.properties.id)).toEqual([
      'setup',
      'cafe-au-lait',
      'section',
    ]);
  });

  it('never get an id that could shadow a global the page reads', () => {
    // `self.__next_f` is the array Next's runtime pushes the RSC payload into.
    const { outline } = render('## __next_f\n\n## __NEXT_DATA__\n\n## webpackChunk_N_E');
    expect(outline.map((h) => h.id)).toEqual(['next-f', 'next-data', 'webpackchunk-n-e']);
    for (const { id } of outline) expect(id).toMatch(SLUG_PATTERN);
  });
});

describe('footnotes', () => {
  const { tree } = render('Claim[^src] and another[^2].\n\n[^src]: The source.\n[^2]: Two.');
  const ids = new Set(
    elements(tree)
      .map((e) => e.properties.id)
      .filter(Boolean),
  );

  it('link both ways to ids that exist', () => {
    const fragments = elements(tree, 'a')
      .map((a) => String(a.properties.href))
      .filter((href) => href.startsWith('#'));
    expect(fragments).toHaveLength(4);
    for (const href of fragments) expect(ids, href).toContain(href.slice(1));
  });

  it('carry the sanitizer prefix on every id, never twice', () => {
    for (const id of ids) expect(String(id)).toMatch(/^user-content-(?!user-content-)/u);
  });

  it('keep a link the author wrote to a heading pointed at the heading', () => {
    const { tree: withHeading } = render('## Method\n\nSee [the method](#method).');
    expect(elements(withHeading, 'a')[0]?.properties.href).toBe('#method');
  });
});

describe('images', () => {
  it('load lazily, decode off the main thread, and always carry alt', () => {
    const { tree } = render('![A chart](https://example.test/a.png) ![](/media/b.png)');
    expect(elements(tree, 'img').map((i) => i.properties)).toEqual([
      { src: 'https://example.test/a.png', alt: 'A chart', loading: 'lazy', decoding: 'async' },
      { src: '/media/b.png', alt: '', loading: 'lazy', decoding: 'async' },
    ]);
  });
});

describe('feed output (base given)', () => {
  const markdown = [
    '[a post](/posts/a) [section](#part) [mail](mailto:ed@example.test)',
    '[elsewhere](https://example.test/x) ![img](/media/c.png)',
  ].join('\n');

  it('makes every relative URL absolute against the post URL', () => {
    const { tree } = render(markdown, { base: 'https://quire.test/posts/this-one' });
    expect(elements(tree, 'a').map((a) => a.properties.href)).toEqual([
      'https://quire.test/posts/a',
      'https://quire.test/posts/this-one#part',
      'mailto:ed@example.test',
      'https://example.test/x',
    ]);
    expect(elements(tree, 'img')[0]?.properties.src).toBe('https://quire.test/media/c.png');
  });

  it('leaves them relative for a page', () => {
    const { tree } = render(markdown);
    expect(elements(tree, 'a')[0]?.properties.href).toBe('/posts/a');
  });
});

describe('text for the search index', () => {
  it('is what a reader sees, block by block, with no markup', () => {
    const { text, words } = render('## Title\n\nSome *emphasis* and `code`.\n\n- one\n- two');
    expect(text).toBe('Title\n\nSome emphasis and code.\n\none\ntwo');
    expect(words).toBe(7);
  });

  it('never holds what the sanitizer removed', () => {
    const { text } = render('a <span>b</span> <script>evil()</script> c');
    expect(text).not.toContain('<');
  });

  it('rounds reading time to whole minutes, never below one', () => {
    expect(render('word').readingMinutes).toBe(1);
    expect(render(Array.from({ length: 2300 }, () => 'word').join(' ')).readingMinutes).toBe(10);
  });
});

describe('fail closed', () => {
  it('the audit refuses what the pipeline produces without its sanitizer', () => {
    // The same parser and converter, minus rehype-sanitize: what a refactor that
    // dropped the `.use(rehypeSanitize)` line would serve.
    const bare = unified().use(remarkParse).use(remarkRehype).freeze();
    const tree = bare.runSync(bare.parse('[x](javascript:alert(1))')) as Root;
    expect(findUnsafe(tree)).toEqual(['root>p>a: href uses javascript:']);

    const sanitized = unified().use(remarkParse).use(remarkRehype).use(rehypeSanitize, SCHEMA);
    expect(
      findUnsafe(sanitized.runSync(sanitized.parse('[x](javascript:alert(1))')) as Root),
    ).toEqual([]);
  });

  it('UnsafeOutputError names the findings', () => {
    const error = new UnsafeOutputError(['root>script: element not on the allowlist']);
    expect(error.message).toBe(
      'markdown output refused: root>script: element not on the allowlist',
    );
  });
});
