/**
 * axe over every route, in both colour schemes, zero violations.
 *
 * Every route: the public site (front page, archive, tags, a post, an author,
 * search with results), sign-in (with an error on screen), the studio,
 * status, and the 404. Each build step adds its routes here in the same commit.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';

import { SEEDED, expect, signIn, test } from '../fixtures';

/** The public site's routes (build step 6); the author page is reached by its link. */
const PUBLIC = [
  '/posts',
  '/tags',
  '/tags/caching',
  `/posts/${SEEDED.longForm}`,
  '/search',
  '/search?q=caching',
];

const SCHEMES = ['light', 'dark'] as const;
const RECORDING = process.env.BASELINE === '1';

async function scan(page: Page, testInfo: TestInfo, route: string, scheme: string) {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  if (RECORDING) {
    await testInfo.attach('a11y', {
      contentType: 'application/json',
      body: JSON.stringify({ route, scheme, violations: results.violations }),
    });
    return;
  }
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target.join(' ')),
    })),
  ).toEqual([]);
}

for (const scheme of SCHEMES) {
  test.describe(`${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });

    test('front page, status and 404', async ({ page }, testInfo) => {
      for (const path of ['/', '/status', '/no-such-page']) {
        await page.goto(path);
        await scan(page, testInfo, path, scheme);
      }
    });

    test('sign in, with an error on screen', async ({ page }, testInfo) => {
      await page.goto('/sign-in');
      await scan(page, testInfo, '/sign-in', scheme);
      await page.getByLabel('Email').fill('nobody@quire.test');
      await page.getByLabel('Password').fill('wrong-password');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.locator('.form-error[role="alert"]')).toBeVisible();
      await scan(page, testInfo, '/sign-in (error)', scheme);
    });

    test('the public site: archive, tags, a long post, an author, search', async ({
      page,
    }, testInfo) => {
      for (const path of PUBLIC) {
        await page.goto(path);
        await scan(page, testInfo, path, scheme);
      }
      // The author page is reached through the post's byline. Followed by its
      // href rather than clicked: in Firefox, revisiting a page served from the
      // HTTP cache leaves a document request Playwright counts as a navigation
      // that never finishes, and click() waits on it forever. A DOM click
      // navigates fine, so this is the driver, not the page.
      await page.goto(`/posts/${SEEDED.longForm}`);
      const byline = page.locator('.byline a[href^="/authors/"]').first();
      await page.goto((await byline.getAttribute('href'))!);
      await expect(page.getByText('Author', { exact: true })).toBeVisible();
      await scan(page, testInfo, '/authors/[id]', scheme);
    });

    test('studio', async ({ page }, testInfo) => {
      await signIn(page);
      await scan(page, testInfo, '/studio', scheme);
    });
  });
}
