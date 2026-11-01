/**
 * The README's demo, captured as frames by `scripts/demo-gif.sh` (DEMO=1 only;
 * playwright.config.ts ignores this file otherwise).
 *
 * The story in eight frames, a reader's first and then an editor's:
 * the front page as a size index, a long read with its specimen label in the
 * margin, search with the matched words marked, the studio's editor with the
 * live preview the site renders with, a post waiting for review, the comment
 * queue, the same long read on a phone by day and by night, and the long read
 * by night. One 1280 x 800 viewport each, so the GIF does not jump.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { SEEDED, expect, postIdOf, signIn, test } from '../fixtures';

const SHOTS = join(__dirname, '..', 'demo-shots');
const IN_REVIEW = 'reading-time-is-a-guess';

test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });

async function frame(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running'),
  );
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

test('demo', async ({ page, browser }) => {
  test.setTimeout(120_000);

  await page.goto('/');
  await expect(page.locator('.entry-numeral').first()).toBeVisible();
  await frame(page, '01-size-index');

  await page.goto(`/posts/${SEEDED.longForm}`);
  await expect(page.getByTestId('specimen')).toBeVisible();
  await frame(page, '02-specimen-label');

  await page.goto('/search?q=cache');
  await expect(page.locator('.entry').first()).toBeVisible();
  await frame(page, '03-search');

  await signIn(page, 'editor');
  await page.goto(`/studio/posts/${await postIdOf(SEEDED.longForm)}`);
  await expect(page.locator('.editor-write .cm-editor')).toBeVisible();
  await expect(page.locator('.editor-preview .prose')).toBeVisible();
  await frame(page, '04-editor-live-preview');

  await page.goto(`/studio/posts/${await postIdOf(IN_REVIEW)}`);
  const workflow = page.locator('.workflow');
  await expect(workflow.getByRole('button', { name: 'Publish now' })).toBeVisible();
  await workflow.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await frame(page, '05-review');

  await page.goto('/studio/comments');
  await expect(page.getByRole('button', { name: 'Approve' }).first()).toBeVisible();
  await frame(page, '06-comment-queue');

  // A phone by day and by night, joined side by side by demo-gif.sh.
  for (const [scheme, side] of [
    ['light', 'a'],
    ['dark', 'b'],
  ] as const) {
    const phone = await browser.newContext({
      viewport: { width: 390, height: 800 },
      colorScheme: scheme,
      deviceScaleFactor: 1,
    });
    const tab = await phone.newPage();
    await tab.goto(`/posts/${SEEDED.longForm}`);
    await expect(tab.getByTestId('specimen')).toBeVisible();
    await frame(tab, `07-phone.${side}`);
    await phone.close();
  }

  const night = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
  });
  const dark = await night.newPage();
  await dark.goto(`/posts/${SEEDED.longForm}`);
  await expect(dark.getByTestId('specimen')).toBeVisible();
  await frame(dark, '08-by-night');
  await night.close();
});
