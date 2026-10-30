/**
 * "Identically in preview, page and RSS" (spec outcome 7), checked rather than
 * claimed: the page and the preview render the tree through React
 * (`toReact`), the feed through `renderHtml`. Both strings are parsed back by
 * an HTML5 parser and must give the same document, for every seeded post and
 * every hostile vector.
 *
 * It also renders the whole demo publication, which is the realistic corpus:
 * if a seeded post ever stops rendering, or loses an internal link, this is
 * where it shows.
 */
import { readdirSync, readFileSync } from 'node:fs';

import { SLUG_PATTERN } from '@cms/shared';
import type { Element } from 'hast';
import { renderToStaticMarkup } from 'react-dom/server';
import { visit } from 'unist-util-visit';
import { describe, expect, it } from 'vitest';

import { VECTORS } from './fixtures/hostile.js';
import { reparse, strip } from './fixtures/support.js';
import { toReact } from './react.js';
import { render, renderHtml } from './render.js';

const POSTS = new URL('../../db/prisma/content/posts/', import.meta.url);
const seeded = readdirSync(POSTS)
  .filter((file) => file.endsWith('.md'))
  .sort()
  .map((file) => [file, readFileSync(new URL(file, POSTS), 'utf8')] as const);

const corpus = [...seeded, ...VECTORS.map((v) => [`vector: ${v.name}`, v.markdown] as const)];

describe('page and preview (React) and feed (HTML) render the same document', () => {
  it('reads the whole demo publication', () => {
    expect(seeded.length).toBe(41);
  });

  it.each(corpus)('%s', (_name, markdown) => {
    const { tree } = render(markdown);
    const viaReact = reparse(renderToStaticMarkup(toReact(tree)));
    const viaHtml = reparse(renderHtml(tree));
    expect(strip(viaReact)).toEqual(strip(viaHtml));
  });
});

describe('the demo publication', () => {
  it.each(seeded)('%s renders with valid ids, live fragments and its links intact', (_f, md) => {
    const { tree, outline } = render(md);
    const ids: string[] = [];
    const hrefs: string[] = [];
    visit(tree, 'element', (node: Element) => {
      if (node.properties.id != null) ids.push(String(node.properties.id));
      if (node.tagName === 'a' && node.properties.href != null)
        hrefs.push(String(node.properties.href));
    });
    expect(new Set(ids).size, 'duplicate id').toBe(ids.length);
    for (const id of ids)
      expect(id).toMatch(new RegExp(`${SLUG_PATTERN.source}|^user-content-`, 'u'));
    for (const href of hrefs.filter((h) => h.startsWith('#'))) expect(ids).toContain(href.slice(1));

    // Every internal post link in the source survives as a link.
    const sourceLinks = [...md.matchAll(/\]\((\/posts\/[^)\s]+)\)/gu)].map((m) => m[1]);
    for (const link of sourceLinks) expect(hrefs).toContain(link);
    expect(outline.every((h) => h.text !== '')).toBe(true);
  });

  it('gives the long read an outline a reader can navigate', () => {
    const md = seeded.find(([file]) => file === 'the-long-way-to-a-fast-page.md')![1];
    const { outline, words, readingMinutes } = render(md);
    expect(outline.filter((h) => h.depth === 2).length).toBeGreaterThanOrEqual(6);
    expect(words).toBeGreaterThan(3000);
    expect(readingMinutes).toBe(Math.round(words / 230));
  });
});

describe('the package runs in the browser too', () => {
  // The studio preview bundles it client-side: a `node:` import or a `process`
  // read would build for the server and break the editor.
  const SOURCE = new URL('./', import.meta.url);
  // Except these two, behind `@cms/markdown/server`, which nothing else imports.
  const SERVER_ONLY = ['server.ts', 'worker.ts'];
  const files = readdirSync(SOURCE).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !SERVER_ONLY.includes(f),
  );

  it.each(files)('%s imports nothing from Node and nothing server-only', (file) => {
    const text = readFileSync(new URL(file, SOURCE), 'utf8');
    expect(text).not.toMatch(/from 'node:|require\(|\bprocess\.|\/(server|worker)\.js'/u);
  });

  it('keeps the server-only files out of the browser entry points', () => {
    expect(files).toEqual(expect.arrayContaining(['index.ts', 'react.ts', 'render.ts']));
    expect(files).not.toContain('server.ts');
  });
});
