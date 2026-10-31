/**
 * The public routes' configuration, read from their source.
 *
 * The build is the final word on what is static (scripts/render-check.mjs
 * reads its manifest in the E2E lane); this catches the two usual ways to
 * lose it at commit time instead:
 *
 * - a different `revalidate` on one route, which silently gives that page its
 *   own staleness window. Next only reads a literal, so every route spells the
 *   number out, and this holds them equal to the loader's and the checker's.
 * - a request-reading import (cookies, headers, the session) anywhere in a
 *   public page or the loader, which makes the page render per request.
 * - a page `alternates` written by hand: Next merges metadata one key deep, so
 *   it would replace the layout's and drop the feed link (it did, on every
 *   page, until the E2E lane looked for it).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error -- a plain .mjs script with no types; only the constant is read.
import { REVALIDATE_SECONDS as CHECKER } from '../../../scripts/render-check.mjs';

const WEB = join(__dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/u.test(entry) && !entry.endsWith('.test.ts') ? [path] : [];
  });
}

const PUBLIC = [
  ...files(join(WEB, 'app/(site)')),
  join(WEB, 'app/feed.xml/route.ts'),
  join(WEB, 'app/sitemap.ts'),
  join(WEB, 'app/robots.ts'),
];
const LOADER = join(WEB, 'lib/content.ts');
const read = (path: string) => readFileSync(path, 'utf8');

describe('public routes', () => {
  it('share one revalidate window with the loader and the build check', () => {
    const loader = Number(/export const REVALIDATE_SECONDS = (\d+);/u.exec(read(LOADER))?.[1]);
    expect(loader).toBe(CHECKER);
    const windows = PUBLIC.flatMap((path) => {
      const match = /export const revalidate = ([^;]+);/u.exec(read(path));
      return match === null ? [] : [[relative(WEB, path), match[1]]];
    });
    // Every content route declares one (layouts and robots.ts have no data).
    expect(windows.length).toBeGreaterThanOrEqual(9);
    expect(windows.filter(([, value]) => Number(value) !== loader)).toEqual([]);
  });

  it('never read the request: no cookies, headers or session', () => {
    const offenders = [...PUBLIC, LOADER].filter((path) =>
      /from 'next\/headers'|from '[./]*(auth|lib\/session|lib\/api)'|\b(cookies|headers|draftMode)\(\)/u.test(
        read(path),
      ),
    );
    expect(offenders.map((path) => relative(WEB, path))).toEqual([]);
  });

  it('build alternates with alternatesFor, so no page drops the feed link', () => {
    const pages = PUBLIC.filter((path) => path.endsWith('page.tsx'));
    const handWritten = pages.filter((path) => /alternates:\s*\{/u.test(read(path)));
    expect(handWritten.map((path) => relative(WEB, path))).toEqual([]);
    const withCanonical = pages.filter((path) => /alternates: alternatesFor\(/u.test(read(path)));
    expect(withCanonical.length).toBeGreaterThanOrEqual(7);
  });
});
