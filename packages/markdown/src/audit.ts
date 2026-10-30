/**
 * An independent check of a finished tree: no element outside the allowlist,
 * no event handler, no style, no URL with a scheme outside its list.
 *
 * It shares the policy with the sanitizer but none of its code, and it reads
 * URLs the way a browser does rather than the way the sanitizer does. The
 * renderer runs it on every tree it returns and throws on a finding, so a
 * sanitizer regression is a failed render with a message, never a page that
 * serves script.
 */
import { SLUG_PATTERN } from '@cms/shared';
import type { Element, Nodes } from 'hast';

import { ALLOWED_TAGS, URL_PROPERTIES } from './policy.js';

const TAGS: ReadonlySet<string> = new Set(ALLOWED_TAGS);

/**
 * The scheme a browser would see in `url`, lowercased, or null for a relative
 * URL.
 *
 * The URL standard strips leading and trailing C0 controls and spaces, and
 * removes every tab and newline anywhere, before it looks for a scheme. That is
 * how `java\tscript:` and `\u0001javascript:` still run, so both steps are done
 * here before the scheme is read.
 */
export function schemeOf(url: string): string | null {
  const cleaned = url
    // eslint-disable-next-line no-control-regex -- the controls are the point
    .replace(/^[\u0000- ]+|[\u0000- ]+$/gu, '')
    .replace(/[\t\n\r]/gu, '');
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/u.exec(cleaned);
  return match === null ? null : match[1]!.toLowerCase();
}

/** True when `url` is relative or uses one of `allowed`. */
export function isAllowedUrl(url: string, allowed: readonly string[]): boolean {
  const scheme = schemeOf(url);
  return scheme === null || allowed.includes(scheme);
}

/** Why `tree` must not be served, one sentence per finding; empty when clean. */
export function findUnsafe(tree: Nodes): string[] {
  const findings: string[] = [];
  const visit = (node: Nodes, path: string): void => {
    if (node.type === 'raw') findings.push(`${path}: raw HTML node`);
    if (node.type === 'doctype') findings.push(`${path}: doctype`);
    if (node.type === 'element') {
      const at = `${path}>${node.tagName}`;
      checkElement(node, at, findings);
    }
    if ('children' in node) {
      for (const child of node.children) {
        visit(child, node.type === 'element' ? `${path}>${node.tagName}` : path);
      }
    }
  };
  visit(tree, 'root');
  return findings;
}

function checkElement(node: Element, at: string, findings: string[]): void {
  if (!TAGS.has(node.tagName)) findings.push(`${at}: element not on the allowlist`);
  if (node.tagName === 'template' || 'content' in node) {
    findings.push(`${at}: template content`);
  }
  for (const [name, value] of Object.entries(node.properties)) {
    if (/^on/iu.test(name)) findings.push(`${at}: event handler ${name}`);
    if (name === 'style') findings.push(`${at}: inline style`);
    if (name === 'name') findings.push(`${at}: name is never emitted`);
    // An id becomes a property of `window`. Only two shapes are allowed: the
    // sanitizer's prefixed ones and our heading slugs, which have no `_`.
    if (
      name === 'id' &&
      !/^user-content-/u.test(String(value)) &&
      !SLUG_PATTERN.test(String(value))
    ) {
      findings.push(`${at}: id ${String(value)} could shadow a global`);
    }
    if (name === 'srcSet' || name === 'formAction' || name === 'action') {
      findings.push(`${at}: ${name} is never emitted`);
    }
    const allowed = (URL_PROPERTIES as Record<string, readonly string[]>)[name];
    if (allowed !== undefined && value != null) {
      const url = String(value);
      if (!isAllowedUrl(url, allowed))
        findings.push(`${at}: ${name} uses ${String(schemeOf(url))}:`);
    }
  }
  if (node.tagName === 'input') {
    const { type, disabled } = node.properties;
    if (type !== 'checkbox' || disabled !== true) {
      findings.push(`${at}: an input other than a disabled task-list checkbox`);
    }
  }
}

/** Thrown instead of returning a tree the audit refused. */
export class UnsafeOutputError extends Error {
  constructor(readonly findings: readonly string[]) {
    super(`markdown output refused: ${findings.slice(0, 5).join('; ')}`);
    this.name = 'UnsafeOutputError';
  }
}
