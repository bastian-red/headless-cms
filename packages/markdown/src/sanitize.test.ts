/**
 * Outcome 7 in the spec: `<script>`, `javascript:` URLs and event-handler
 * attributes never reach output, in the page, the preview or the feed.
 *
 * Every vector is checked three ways, each independent of the sanitizer:
 * the tree passes the audit, the serialized HTML re-parsed by a real HTML5
 * parser (parse5, the parser browsers follow) holds nothing executable, and
 * that re-parse gives back exactly the tree that was serialized. The last one
 * is what catches mutation XSS: markup that is text in our tree but becomes an
 * element once a browser parses the string.
 */
import { readFileSync } from 'node:fs';

import fc from 'fast-check';
import type { Nodes, Root } from 'hast';
import { describe, expect, it } from 'vitest';

import { findUnsafe, isAllowedUrl, schemeOf } from './audit.js';
import { VECTORS } from './fixtures/hostile.js';
import { LINK_PROTOCOLS } from './policy.js';
import { render, renderHtml } from './render.js';
import { reparse, strip } from './fixtures/support.js';

/** Everything in a re-parsed document a browser could execute or navigate to. */
function executable(tree: Nodes): string[] {
  const found: string[] = [];
  const walk = (node: Nodes): void => {
    if (node.type === 'element') {
      if (
        [
          'script',
          'iframe',
          'object',
          'embed',
          'style',
          'svg',
          'math',
          'form',
          'base',
          'meta',
        ].includes(node.tagName)
      ) {
        found.push(`<${node.tagName}>`);
      }
      for (const [name, value] of Object.entries(node.properties)) {
        if (/^on/iu.test(name)) found.push(`${node.tagName}[${name}]`);
        if ((name === 'href' || name === 'src') && !isAllowedUrl(String(value), LINK_PROTOCOLS)) {
          found.push(`${node.tagName}[${name}=${String(value)}]`);
        }
      }
    }
    if ('children' in node) node.children.forEach(walk);
  };
  walk(tree);
  return found;
}

function assertInert(markdown: string): string {
  const { tree } = render(markdown);
  const html = renderHtml(tree);
  const parsed = reparse(html);
  expect(executable(parsed), html).toEqual([]);
  expect(strip(parsed), html).toEqual(strip(tree));
  return html;
}

describe('the hostile corpus', () => {
  it.each(VECTORS.map((v) => [v.name, v] as const))('%s', (_name, vector) => {
    const html = assertInert(vector.markdown);
    for (const needle of vector.gone) expect(html, html).not.toContain(needle);
  });
});

describe('the hostile seed post', () => {
  // The post the demo publication ships, read from the seed rather than
  // copied: if someone edits the post, this test reads the edit.
  const source = readFileSync(
    new URL('../../db/prisma/content/posts/we-never-render-raw-html.md', import.meta.url),
    'utf8',
  );

  it('carries all three attacks in its source', () => {
    expect(source).toContain("<script>window.__quireHostile = 'script'</script>");
    expect(source).toContain('onerror="window.__quireHostile');
    expect(source).toContain("(javascript:window.__quireHostile='href')");
  });

  it('renders with none of them, and the code sample shown as text', () => {
    const html = assertInert(source);
    expect(html).not.toContain('__quireHostile');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<a>A link that tries to run code</a>');
    expect(html).toContain('&#x3C;script>\n  alert(');
  });

  it('matches the reviewed output exactly', async () => {
    await expect(renderHtml(render(source).tree)).toMatchFileSnapshot(
      './__snapshots__/we-never-render-raw-html.html',
    );
  });
});

describe('URL schemes, read the way a browser reads them', () => {
  it.each([
    ['javascript:x', 'javascript'],
    ['JAVASCRIPT:x', 'javascript'],
    ['  javascript:x', 'javascript'],
    ['\u0001javascript:x', 'javascript'],
    ['java\tscript:x', 'javascript'],
    ['java\nscript:x', 'javascript'],
    ['java\rscript:x', 'javascript'],
    ['https://example.test', 'https'],
    ['mailto:a@example.test', 'mailto'],
    ['/posts/a', null],
    ['#section', null],
    ['posts/a:b', null],
    ['?q=a:b', null],
    ['', null],
  ])('%j has scheme %j', (url, scheme) => {
    expect(schemeOf(url)).toBe(scheme);
  });
});

describe('the audit, on trees the sanitizer never saw', () => {
  const element = (tagName: string, properties: Record<string, unknown>): Root => ({
    type: 'root',
    children: [{ type: 'element', tagName, properties: properties as never, children: [] }],
  });

  it.each([
    ['a script element', element('script', {})],
    ['an event handler', element('p', { onClick: 'x' })],
    ['a lowercase event handler', element('p', { onclick: 'x' })],
    ['an inline style', element('p', { style: 'x' })],
    ['a javascript href', element('a', { href: 'javascript:x' })],
    ['a disguised javascript href', element('a', { href: ' java\tscript:x' })],
    ['a data image', element('img', { src: 'data:image/svg+xml,x' })],
    ['a mailto image', element('img', { src: 'mailto:a@b.test' })],
    ['a srcset', element('img', { srcSet: 'javascript:x 1x' })],
    ['an enabled checkbox', element('input', { type: 'checkbox', disabled: false })],
    ['a text input', element('input', { type: 'text', disabled: true })],
    ['an h1', element('h1', {})],
    ['an id that names a page global', element('h2', { id: '__next_f' })],
    ['an id with an underscore', element('h2', { id: 'a_b' })],
    ['a name attribute', element('a', { name: 'x' })],
    ['a raw node', { type: 'root', children: [{ type: 'raw', value: '<script>' }] } as Root],
  ])('refuses %s', (_name, tree) => {
    expect(findUnsafe(tree)).not.toEqual([]);
  });

  it('passes what markdown legitimately produces', () => {
    expect(findUnsafe(element('h2', { id: 'setup-2' }))).toEqual([]);
    expect(findUnsafe(element('li', { id: 'user-content-fn-__next_f' }))).toEqual([]);
    expect(
      findUnsafe(
        element('a', { href: 'https://example.test', title: 'x', ariaDescribedBy: ['a'] }),
      ),
    ).toEqual([]);
    expect(
      findUnsafe(element('input', { type: 'checkbox', disabled: true, checked: true })),
    ).toEqual([]);
  });
});

describe('random markdown with hostile fragments mixed in', () => {
  const atoms = fc.constantFrom(
    ...VECTORS.map((v) => v.markdown),
    '<',
    '>',
    '"',
    "'",
    '`',
    '```',
    '[',
    ']',
    '(',
    ')',
    '![',
    '](',
    '\n\n',
    '\n',
    '|',
    '- ',
    '> ',
    '# ',
    '*',
    '_',
    '&',
    '&#',
    ';',
    ':',
    'javascript:',
    'on',
    'error=',
    '</p>',
    '<img',
    '<script>',
    '</script>',
    '-->',
    '<!--',
    '[^1]',
    '[^1]: ',
  );
  const fragment = fc.oneof({ weight: 4, arbitrary: atoms }, { weight: 1, arbitrary: fc.string() });

  it('never yields output the audit refuses, and never mutates on re-parse', () => {
    fc.assert(
      fc.property(fc.array(fragment, { maxLength: 24 }), (parts) => {
        assertInert(parts.join(''));
      }),
      {
        numRuns: Number(process.env.FUZZ_RUNS ?? 150),
        seed: Number(process.env.FUZZ_SEED ?? 20261030),
      },
    );
  });
});
