#!/usr/bin/env node
/**
 * The Lighthouse lane: the reading pages against the budgets in docs/SPECS.md
 * ("SEO 100, Accessibility 100, Performance >= 95, LCP < 2.0 s, CLS < 0.05").
 *
 * Run by scripts/e2e.sh against the production build it starts, before
 * Playwright, so the server is idle and the data freshly seeded. Lighthouse's
 * default is a throttled phone (simulated slow 4G, CPU slowed 4x), which is
 * the reader this blog has to be fast for, so that is what is measured.
 *
 * Each page is measured RUNS times and judged on its median run (by
 * performance score), the way Lighthouse CI does it: one run's timing noise
 * should neither pass nor fail the lane.
 *
 * The browser is Playwright's Chromium, driven over a debugging port, so the
 * lane needs no second browser download. The median run's HTML report is kept
 * in $LOG_DIR/lighthouse/ for a reader to open.
 *
 * Usage: node lighthouse.mjs [baseUrl]   (default $APP_BASE_URL)
 * Exit 1 if any budget is missed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';

import { judge, medianRun } from './lighthouse-budget.mjs';

const BASE = (process.argv[2] ?? process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(
  /\/$/u,
  '',
);
const RUNS = Number(process.env.LIGHTHOUSE_RUNS ?? 3);
const OUT = join(process.env.LOG_DIR ?? '/tmp/cms-e2e', 'lighthouse');

/** The three shapes of public page: the index, a long read, a facet. */
const PAGES = [
  { name: 'home', path: '/' },
  { name: 'post', path: '/posts/the-long-way-to-a-fast-page' },
  { name: 'tag', path: '/tags/caching' },
];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

mkdirSync(OUT, { recursive: true });
const port = await freePort();
const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });

const summary = [];
let failed = false;
try {
  for (const page of PAGES) {
    const url = `${BASE}${page.path}`;
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const result = await lighthouse(url, {
        port,
        output: ['json', 'html'],
        logLevel: 'error',
      });
      if (result === undefined) throw new Error(`Lighthouse returned nothing for ${url}`);
      if (result.lhr.runtimeError) {
        throw new Error(
          `${url}: ${result.lhr.runtimeError.code} ${result.lhr.runtimeError.message}`,
        );
      }
      runs.push(result);
    }
    const median = medianRun(runs.map((run) => run.lhr));
    const chosen = runs[median];
    writeFileSync(join(OUT, `${page.name}.html`), chosen.report[1]);
    const verdict = judge(chosen.lhr);
    summary.push({ page: page.name, url, ...verdict });
    failed ||= verdict.failures.length > 0;

    const m = verdict.measured;
    console.info(
      `${verdict.failures.length === 0 ? 'ok  ' : 'FAIL'} ${page.name.padEnd(5)} ` +
        `perf ${m.performance} a11y ${m.accessibility} bp ${m.bestPractices} seo ${m.seo} ` +
        `LCP ${m.lcpMs} ms CLS ${m.cls} TBT ${m.tbtMs} ms  (median of ${RUNS})`,
    );
    for (const failure of verdict.failures) console.info(`       ${failure}`);
  }
} finally {
  await browser.close();
}

writeFileSync(join(OUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.info(`Reports: ${OUT}/{${PAGES.map((p) => p.name).join(',')}}.html`);
process.exit(failed ? 1 : 0);
