/**
 * A phone is a first-class width: no route scrolls sideways at 390 px.
 *
 * Measured as `scrollWidth > clientWidth` on the document, which is what a
 * reader feels as the page sliding under their thumb. Every later build step
 * adds its routes to the list in the same commit.
 */
import type { Page } from '@playwright/test';

import { SEEDED, expect, signIn, test } from '../fixtures';

test.use({ viewport: { width: 390, height: 844 } });

async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test('public routes do not scroll sideways at 390 px', async ({ page }) => {
  for (const path of [
    '/',
    '/posts',
    '/tags',
    '/tags/caching',
    // The long read: code blocks and tables are where a page slides sideways.
    `/posts/${SEEDED.longForm}`,
    '/search?q=caching',
    '/sign-in',
    '/status',
    '/no-such-page',
  ]) {
    await page.goto(path);
    expect(await overflow(page), path).toBeLessThanOrEqual(0);
  }
});

test('the studio does not scroll sideways at 390 px', async ({ page }) => {
  await signIn(page, 'admin');
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
