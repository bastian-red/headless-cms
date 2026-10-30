/**
 * The one markdown renderer. The studio preview, the post page, the RSS feed
 * and the search index all call `render()`, so what an editor previews is what
 * a reader gets and what a feed reader gets, element for element.
 *
 * The pipeline, in order:
 *
 * 1. `remark-parse` + `remark-gfm` turn the source into a markdown tree
 *    (tables, strikethrough, autolinks, task lists, footnotes).
 * 2. Headings shift down a level when the author used `#`: the page title is
 *    the page's one `h1`.
 * 3. `remark-rehype` turns it into an HTML tree. `allowDangerousHtml` stays
 *    off, so raw HTML in the source is dropped here, before anything else can
 *    see it. A `<script>` an author typed is gone, not escaped.
 * 4. `rehype-sanitize` (schema.ts) removes every element, attribute and URL
 *    scheme outside the policy.
 * 5. Our own finishing: heading ids for the outline, footnote links pointed
 *    at their prefixed ids, lazy images, and, for a feed, absolute URLs. These run after sanitizing, so nothing they add is
 *    filtered, and the audit below checks them like anything else.
 * 6. `findUnsafe()` (audit.ts) walks the result independently. A finding
 *    throws: a broken sanitizer costs a render, never a reader.
 */
import { slugify } from '@cms/shared';
import type { Element, Root } from 'hast';
import { toHtml } from 'hast-util-to-html';
import { toText } from 'hast-util-to-text';
import type { Root as MdastRoot } from 'mdast';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

import { findUnsafe, UnsafeOutputError } from './audit.js';
import { CLOBBER_PREFIX, SCHEMA } from './schema.js';

export interface RenderOptions {
  /**
   * The absolute URL the output will be read at. When given, every relative
   * link and image becomes absolute against it. A feed needs this (a feed
   * reader has no page to resolve `/posts/x` against); a page must not have it.
   */
  readonly base?: string;
}

export interface OutlineEntry {
  readonly depth: 2 | 3 | 4 | 5 | 6;
  readonly id: string;
  readonly text: string;
}

export interface Rendered {
  /** The sanitized, audited HTML tree. Render it with `toReact` or `toHtml`. */
  readonly tree: Root;
  /** Every heading, in order, with the id its element carries. */
  readonly outline: readonly OutlineEntry[];
  /** The text a reader sees, block by block: the search index's input. */
  readonly text: string;
  readonly words: number;
  /** At 230 words a minute, never less than one. */
  readonly readingMinutes: number;
}

export const WORDS_PER_MINUTE = 230;

/** If the author used `#`, shift every heading down one level (capped at 6). */
function demoteHeadings() {
  return (tree: MdastRoot) => {
    let top = 6;
    visit(tree, 'heading', (node) => {
      top = Math.min(top, node.depth);
    });
    if (top > 1) return;
    visit(tree, 'heading', (node) => {
      node.depth = Math.min(6, node.depth + 1) as typeof node.depth;
    });
  };
}

const pipeline = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(demoteHeadings)
  // No prefix here: the sanitizer adds it to every id (see linkFragments).
  .use(remarkRehype, { clobberPrefix: '' })
  .use(rehypeSanitize, SCHEMA)
  .freeze();

const HEADING = /^h([2-6])$/u;

/**
 * Ids from the shared `slugify`, so they are `[a-z0-9-]` only. That is what
 * keeps them out of the page's script: an element id becomes a property of
 * `window`, and an id such as `__next_f` would replace the array Next's
 * runtime pushes into. No slug can contain an underscore.
 */
function addHeadingIds(tree: Root): OutlineEntry[] {
  const outline: OutlineEntry[] = [];
  const used = new Map<string, number>();
  visit(tree, 'element', (node: Element) => {
    const level = HEADING.exec(node.tagName);
    if (level === null) return;
    // The footnotes label already carries a (prefixed) id; leave it.
    if (node.properties.id != null) return;
    const text = toText(node).trim();
    const base = slugify(text) ?? 'section';
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    const id = seen === 0 ? base : `${base}-${String(seen + 1)}`;
    node.properties.id = id;
    outline.push({ depth: Number(level[1]) as OutlineEntry['depth'], id, text });
  });
  return outline;
}

/**
 * The sanitizer prefixes every id with `user-content-` (a footnote id could
 * otherwise name a global the page's script reads), but it cannot see that
 * `#fn-1` in a link meant that id. Point each in-page link at the prefixed id
 * when only that one exists. github.com does this in the browser; here it is
 * done once, on the server, so footnotes work with no script.
 */
function linkFragments(tree: Root): void {
  const ids = new Set<string>();
  visit(tree, 'element', (node: Element) => {
    if (typeof node.properties.id === 'string') ids.add(node.properties.id);
  });
  visit(tree, 'element', (node: Element) => {
    const href = node.properties.href;
    if (node.tagName !== 'a' || typeof href !== 'string' || !href.startsWith('#')) return;
    const target = href.slice(1);
    if (!ids.has(target) && ids.has(`${CLOBBER_PREFIX}${target}`)) {
      node.properties.href = `#${CLOBBER_PREFIX}${target}`;
    }
  });
}

/**
 * `data-footnotes` and friends come out of remark-rehype as `true`. The HTML
 * serializer writes that as a bare attribute and React writes `="true"`, so
 * the page and the feed would differ. An empty string is the same in both.
 */
function settleDataAttributes(tree: Root): void {
  visit(tree, 'element', (node: Element) => {
    for (const [name, value] of Object.entries(node.properties)) {
      if (name.startsWith('data') && value === true) node.properties[name] = '';
    }
  });
}

function finishImages(tree: Root): void {
  visit(tree, 'element', (node: Element) => {
    if (node.tagName !== 'img') return;
    // An image with no alt is announced by its file name; an empty alt is
    // announced as nothing, which is the lesser harm. The studio asks for alt.
    if (typeof node.properties.alt !== 'string') node.properties.alt = '';
    node.properties.loading = 'lazy';
    node.properties.decoding = 'async';
  });
}

function absolutize(tree: Root, base: string): void {
  const resolve = (value: unknown): unknown =>
    typeof value === 'string' ? new URL(value, base).href : value;
  visit(tree, 'element', (node: Element) => {
    if (node.properties.href != null)
      node.properties.href = resolve(node.properties.href) as string;
    if (node.properties.src != null) node.properties.src = resolve(node.properties.src) as string;
  });
}

export function render(markdown: string, options: RenderOptions = {}): Rendered {
  const tree = pipeline.runSync(pipeline.parse(markdown)) as Root;
  const outline = addHeadingIds(tree);
  linkFragments(tree);
  settleDataAttributes(tree);
  finishImages(tree);
  if (options.base !== undefined) absolutize(tree, options.base);

  const findings = findUnsafe(tree);
  if (findings.length > 0) throw new UnsafeOutputError(findings);

  const text = toText(tree).trim();
  const words = text === '' ? 0 : text.split(/\s+/u).length;
  return {
    tree,
    outline,
    text,
    words,
    readingMinutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
  };
}

/** The tree as an HTML string: for the RSS feed only. Pages use `toReact`. */
export function renderHtml(tree: Root): string {
  return toHtml(tree);
}
