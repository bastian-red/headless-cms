#!/usr/bin/env node
/**
 * The rendering matrix, read from the build rather than from anyone's memory.
 *
 * This product's graded challenge is choosing SSG, ISR or SSR per route and
 * keeping it that way. A single `await cookies()` or `auth()` in a shared
 * layout silently turns every public page into a per-request render: the site
 * still works, every test that looks at content still passes, and the static
 * promise is gone. Only the build knows, so this reads what `next build` wrote
 * (`.next/prerender-manifest.json`) and compares it with the matrix below.
 *
 *   node scripts/render-check.mjs              after any `next build`
 *   node scripts/render-check.mjs --content    after a build against the seeded API (e2e.sh):
 *                                              the seeded pages were prerendered, and no
 *                                              unpublished text is anywhere in .next/
 *   node scripts/render-check.mjs --self-test  the checker against built manifests
 *
 * Each build step that adds a route adds it here in the same commit.
 *
 * 0 = the build matches. 1 = a route moved, or unpublished text leaked. 2 = no build to read.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Prerendered at build time. */
export const STATIC = [
  '/',
  '/_not-found',
  '/posts',
  '/tags',
  '/feed.xml',
  '/sitemap.xml',
  '/robots.txt',
];

/**
 * Of those, the ones that show content: revalidated by tag, with this safety
 * net (lib/content.ts REVALIDATE_SECONDS) if an event is lost.
 */
export const REVALIDATED = ['/', '/posts', '/tags', '/feed.xml', '/sitemap.xml'];
export const REVALIDATE_SECONDS = 3600;

/**
 * Prerendered for every value known at build time and rendered once (then
 * cached) for a value published later: Next lists these under dynamicRoutes.
 */
export const ON_DEMAND = [
  '/posts/[slug]',
  '/posts/[slug]/card.png',
  '/tags/[tag]',
  '/authors/[id]',
];

/** Rendered per request on purpose: they read the session or the query string. */
export const DYNAMIC = ['/sign-in', '/status', '/studio', '/search'];

export function check(manifest) {
  const routes = manifest.routes ?? {};
  const onDemand = manifest.dynamicRoutes ?? {};
  const problems = [];
  for (const route of STATIC) {
    if (!(route in routes))
      problems.push(
        `${route} should be prerendered (static) but the build renders it per request.`,
      );
  }
  for (const route of REVALIDATED) {
    const seconds = routes[route]?.initialRevalidateSeconds;
    if (route in routes && seconds !== REVALIDATE_SECONDS)
      problems.push(
        `${route} revalidates every ${String(seconds)} s; the matrix says ${String(REVALIDATE_SECONDS)}.`,
      );
  }
  for (const route of ON_DEMAND) {
    if (!(route in onDemand))
      problems.push(
        `${route} should be prerendered per value and cached on demand, but it is not.`,
      );
  }
  for (const route of DYNAMIC) {
    if (route in routes || route in onDemand)
      problems.push(`${route} should render per request but the build prerendered it.`);
  }
  return problems;
}

/**
 * The seeded content made it into the build: one concrete page per on-demand
 * route, revalidated like the rest. `expect` names them.
 */
export function checkContent(manifest, expect) {
  const routes = manifest.routes ?? {};
  const problems = [];
  for (const route of expect.prerendered) {
    if (!(route in routes))
      problems.push(`${route} was not prerendered: did the build reach the API?`);
    else if (routes[route].initialRevalidateSeconds !== REVALIDATE_SECONDS)
      problems.push(
        `${route} is prerendered but does not revalidate every ${String(REVALIDATE_SECONDS)} s.`,
      );
  }
  const posts = Object.keys(routes).filter((r) => /^\/posts\/[^/]+$/u.test(r));
  if (posts.length !== expect.livePosts)
    problems.push(
      `${String(posts.length)} post pages were prerendered; the seed has ${String(expect.livePosts)} live posts.`,
    );
  return problems;
}

/** Text files under `dir` that contain any of `words`, and how many files were read. */
export function findWords(dir, words) {
  const hits = [];
  let read = 0;
  const walk = (path) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (entry === 'cache' && path.endsWith('.next')) continue; // the fetch cache is not output
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(html|rsc|body|json|js|xml|txt|meta)$/u.test(entry)) {
        read += 1;
        const text = readFileSync(full, 'utf8');
        for (const word of words) if (text.includes(word)) hits.push(`${full}: ${word}`);
      }
    }
  };
  walk(dir);
  return { hits, read };
}

function seedFacts(root) {
  const catalog = readFileSync(join(root, 'packages/db/prisma/content/catalog.ts'), 'utf8');
  const constant = (name) => {
    const match = new RegExp(`export const ${name} = '([^']+)';`, 'u').exec(catalog);
    if (match === null) throw new Error(`catalog.ts has no ${name}`);
    return match[1];
  };
  // A live post is an entry with `state: 'live',` or `'live-with-draft',` (the
  // trailing comma leaves out the type declaration that lists every state).
  const livePosts = (catalog.match(/state: '(live|live-with-draft)',/gu) ?? []).length;
  return {
    canaries: [constant('DRAFT_CANARY'), constant('COMMENT_CANARY')],
    longForm: constant('LONG_FORM_SLUG'),
    livePosts,
  };
}

function selfTest() {
  const route = (seconds) => ({ initialRevalidateSeconds: seconds });
  const good = {
    routes: Object.fromEntries([
      ...STATIC.map((r) => [r, route(REVALIDATED.includes(r) ? REVALIDATE_SECONDS : false)]),
      ['/posts/a', route(REVALIDATE_SECONDS)],
      ['/posts/a/card.png', route(REVALIDATE_SECONDS)],
    ]),
    dynamicRoutes: Object.fromEntries(ON_DEMAND.map((r) => [r, {}])),
  };
  const without = (key) => {
    const routes = { ...good.routes };
    delete routes[key];
    return { ...good, routes };
  };
  const cases = [
    ['the planned matrix passes', good, 0],
    ['a static page rendered per request fails', without('/'), 1],
    [
      'a prerendered /search fails',
      { ...good, routes: { ...good.routes, '/search': route(false) } },
      1,
    ],
    [
      'an on-demand route made fully dynamic fails',
      { ...good, dynamicRoutes: {} },
      ON_DEMAND.length,
    ],
    [
      'a lost safety net fails',
      { ...good, routes: { ...good.routes, '/feed.xml': route(false) } },
      1,
    ],
  ];
  let failed = 0;
  for (const [name, manifest, want] of cases) {
    const got = check(manifest).length;
    if (got !== want) {
      failed += 1;
      console.error(
        `render-check self-test FAILED: ${name}: ${String(got)} problems, want ${String(want)}`,
      );
    }
  }
  const content = { prerendered: ['/posts/a', '/posts/a/card.png'], livePosts: 1 };
  const contentCases = [
    ['seeded pages prerendered pass', good, content, 0],
    ['a build without the API fails', { routes: {} }, content, 3],
    ['a missing live post fails', good, { ...content, livePosts: 2 }, 1],
  ];
  for (const [name, manifest, expect, want] of contentCases) {
    const got = checkContent(manifest, expect).length;
    if (got !== want) {
      failed += 1;
      console.error(
        `render-check self-test FAILED: ${name}: ${String(got)} problems, want ${String(want)}`,
      );
    }
  }
  if (failed > 0) process.exit(1);
  console.log(`render-check self-test: ${String(cases.length + contentCases.length)} cases pass.`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) {
    selfTest();
    process.exit(0);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const next = join(root, 'apps', 'web', '.next');
  const path = join(next, 'prerender-manifest.json');
  if (!existsSync(path)) {
    console.error(`render-check: ${path} does not exist. Run \`next build\` first.`);
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const problems = check(manifest);
  let summary = `${String(STATIC.length)} static, ${String(ON_DEMAND.length)} on-demand and ${String(DYNAMIC.length)} dynamic routes as planned`;
  if (process.argv.includes('--content')) {
    const facts = seedFacts(root);
    problems.push(
      ...checkContent(manifest, {
        prerendered: [`/posts/${facts.longForm}`, `/posts/${facts.longForm}/card.png`, '/feed.xml'],
        livePosts: facts.livePosts,
      }),
    );
    const { hits, read } = findWords(next, facts.canaries);
    problems.push(...hits.map((hit) => `unpublished text in the build: ${hit}`));
    // The scan is only meaningful if the seeded text is there to be found.
    const control = findWords(join(next, 'server'), [facts.longForm]);
    if (control.hits.length === 0)
      problems.push('the long-form post is nowhere in .next/server: the scan read no content.');
    summary += `; ${String(facts.livePosts)} live posts prerendered; ${String(read)} build files carry no unpublished text`;
  }
  if (problems.length > 0) {
    console.error('render-check: the build does not match the rendering matrix:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`render-check: ${summary}.`);
}
