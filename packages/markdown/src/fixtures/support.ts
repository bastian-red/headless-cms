/**
 * Test-only helpers. `src/fixtures` is excluded from the build (tsconfig.json).
 */
import type { Nodes, Root } from 'hast';
import { fromHtml } from 'hast-util-from-html';

/** `html` parsed the way a browser parses an element's contents. */
export function reparse(html: string): Root {
  return fromHtml(html, { fragment: true });
}

/**
 * A tree reduced to what a reader gets: no source positions, no `data`, and no
 * whitespace-only text between blocks (the serializer adds newlines there and
 * the parser keeps them; neither changes what is shown).
 */
export function strip(node: Nodes): unknown {
  if (node.type === 'text') return { type: 'text', value: node.value };
  if (node.type === 'element') {
    return {
      type: 'element',
      tagName: node.tagName,
      properties: normalizeProperties(node.properties),
      children: children(node.children, node.tagName),
    };
  }
  if (node.type === 'root') return { type: 'root', children: children(node.children, '') };
  return { type: node.type };
}

const KEEPS_WHITESPACE = new Set(['pre', 'code']);

/** Adjacent text nodes merged (a parser never produces two in a row). */
function children(nodes: readonly Nodes[], parent: string): unknown[] {
  const merged: Nodes[] = [];
  for (const node of nodes) {
    const last = merged.at(-1);
    if (node.type === 'text' && last?.type === 'text') {
      merged[merged.length - 1] = { type: 'text', value: last.value + node.value };
    } else if (node.type !== 'comment') {
      merged.push(node);
    }
  }
  return merged
    .filter((n) => n.type !== 'text' || n.value !== '')
    .filter((n) => KEEPS_WHITESPACE.has(parent) || n.type !== 'text' || n.value.trim() !== '')
    .map(strip);
}

function normalizeProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined || value === null || value === false) continue;
    out[key] = Array.isArray(value) ? value.map(String) : value;
  }
  return out;
}
