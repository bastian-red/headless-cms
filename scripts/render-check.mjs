#!/usr/bin/env node
/**
 * The rendering matrix, read from the build rather than from anyone's memory.
 *
 * This product's graded challenge is choosing SSG, ISR or SSR per route and
 * keeping it that way. A single `await cookies()` or `auth()` in a shared
 * layout silently turns every public page into a per-request render: the site
 * still works, every test that looks at content still passes, and the static
 * promise is gone. Only the build knows, so this reads what `next build` wrote
 * (`.next/prerender-manifest.json` lists every prerendered route) and compares
 * it with the matrix below.
 *
 *   node scripts/render-check.mjs        (after `next build`; e2e.sh runs it)
 *
 * Each build step that adds a route adds it here in the same commit, on the
 * side of the matrix it was planned on.
 *
 * 0 = the build matches the matrix. 1 = a route moved. 2 = no build to read.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Prerendered at build time, revalidated by tag (from build step 6). */
export const STATIC = ['/', '/_not-found'];

/** Rendered per request on purpose: they read the session or the query string. */
export const DYNAMIC = ['/sign-in', '/status', '/studio'];

export function check(manifest) {
  const prerendered = new Set(Object.keys(manifest.routes ?? {}));
  const problems = [];
  for (const route of STATIC) {
    if (!prerendered.has(route))
      problems.push(
        `${route} should be prerendered (static) but the build renders it per request.`,
      );
  }
  for (const route of DYNAMIC) {
    if (prerendered.has(route))
      problems.push(`${route} should render per request but the build prerendered it.`);
  }
  return problems;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const path = join(root, 'apps', 'web', '.next', 'prerender-manifest.json');
  if (!existsSync(path)) {
    console.error(`render-check: ${path} does not exist. Run \`next build\` first.`);
    process.exit(2);
  }
  const problems = check(JSON.parse(readFileSync(path, 'utf8')));
  if (problems.length > 0) {
    console.error('render-check: the build does not match the rendering matrix:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(
    `render-check: ${String(STATIC.length)} static and ${String(DYNAMIC.length)} dynamic routes as planned.`,
  );
}
