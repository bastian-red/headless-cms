/**
 * The OpenAPI document is generated, so what it promises is only as good as
 * the generator. These hold the two places it has already gone wrong.
 */
import { idSchema, slugSchema } from '@cms/shared';
import { describe, expect, it } from 'vitest';

import { openApiDocument } from './openapi';

/** Every `pattern` in the document, with the JSON path it sits at. */
function patterns(node: unknown, path = '$'): [string, string][] {
  if (Array.isArray(node)) return node.flatMap((item, i) => patterns(item, `${path}[${i}]`));
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) =>
    key === 'pattern' && typeof value === 'string'
      ? [[`${path}.pattern`, value] as [string, string]]
      : patterns(value, `${path}.${key}`),
  );
}

describe('openApiDocument', () => {
  it('names the five response schemas as components', () => {
    // zod 4 copies methods onto each schema when it is built, so the old
    // prototype patch (registry.register) reached none of ours; the names
    // now come from .meta({ id }).
    const names = Object.keys(openApiDocument().components?.schemas ?? {}).sort();
    expect(names).toEqual(['CommentList', 'Post', 'PostList', 'SearchResult', 'TagList']);
  });

  it('emits every pattern as a bare ECMA-262 source, without regex flags', () => {
    // zod-to-openapi 9.1.0 builds a pattern from RegExp#toString() and strips
    // only the slashes, so /^[a-z]+$/u came out as "^[a-z]+$/u": a pattern no
    // client could match. Patched in patches/ (upstream issue #400).
    const found = patterns(openApiDocument());
    expect(found.length).toBeGreaterThan(0);
    for (const [where, pattern] of found) {
      expect(pattern, where).not.toMatch(/\/[dgimsuvy]*$/u);
      expect(() => new RegExp(pattern, 'u'), where).not.toThrow();
    }
  });

  it('documents the same slug and id rules the API enforces', () => {
    const documented = new Set(patterns(openApiDocument()).map(([, p]) => p));
    for (const [schema, good, bad] of [
      [slugSchema, 'edge-caching-101', 'Edge_Caching'],
      [idSchema, 'clq1234567890abcdefghij', 'CLQ-not-an-id'],
    ] as const) {
      expect(schema.safeParse(good).success).toBe(true);
      expect(schema.safeParse(bad).success).toBe(false);
      const agrees = [...documented].some(
        (p) => new RegExp(p, 'u').test(good) && !new RegExp(p, 'u').test(bad),
      );
      expect(agrees, `a documented pattern accepts ${good} and refuses ${bad}`).toBe(true);
    }
  });
});
