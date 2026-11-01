/**
 * The design's promises (docs/DESIGN.md), read back from the rendered page.
 *
 * - The specimen label tells the truth: the size, leading, measure and face
 *   it prints are the ones the browser actually set the column in, and its
 *   words and minutes are the ones the lists show for the same post.
 * - The measure is only claimed where it holds: on a phone the label folds to
 *   one line and drops the measure.
 * - The lists are a size index: every entry carries its reading time.
 * - The studio keeps an instant whole ("GMT-3" never splits) and the editor
 *   holds still: the body scrolls inside its pane, not the page.
 *
 * lib/specimen.test.ts holds the same claims against the stylesheet's source;
 * this spec holds them against what a reader's browser computes.
 */
import type { Page } from '@playwright/test';

import { SEEDED, expect, postIdOf, signIn, test } from '../fixtures';

async function label(page: Page) {
  const specimen = page.getByTestId('specimen');
  const fact = (name: string) => specimen.locator(`[data-fact="${name}"] dd`);
  return {
    specimen,
    words: (await fact('words').textContent())!.trim(),
    minutes: (await fact('minutes').textContent())!.trim(),
    face: (await specimen.locator('.specimen-face').textContent())!.trim(),
    setting: (await specimen.locator('.specimen-setting').textContent())!.trim(),
    measure: specimen.locator('.specimen-measure'),
  };
}

test.describe('at 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the label prints the setting the column is really set in', async ({ page }) => {
    await page.goto(`/posts/${SEEDED.longForm}`);
    await page.evaluate(() => document.fonts.ready);
    const shown = await label(page);
    const [size, leading] = shown.setting.split('/').map(Number);
    const measureText = (await shown.measure.textContent())!;
    const measure = Number(/(\d+) characters a line/u.exec(measureText)![1]);
    await expect(shown.measure).toBeVisible();

    const set = await page.locator('.prose').evaluate((prose) => {
      const p = prose.querySelector('p')!;
      const style = getComputedStyle(p);
      const family = style.fontFamily
        .split(',')[0]!
        .trim()
        .replace(/^['"]|['"]$/gu, '');
      // The width of "0" in the column's own font: what 1ch is.
      const zero = document.createElement('span');
      zero.textContent = '0';
      zero.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
      p.append(zero);
      const ch = zero.getBoundingClientRect().width;
      zero.remove();
      const faces = [...document.fonts].filter((f) => f.family.replace(/['"]/gu, '') === family);
      return {
        fontSize: parseFloat(style.fontSize),
        lineHeight: parseFloat(style.lineHeight),
        maxWidth: parseFloat(getComputedStyle(prose).maxWidth),
        width: prose.getBoundingClientRect().width,
        ch,
        loaded: faces.some((f) => f.status === 'loaded' && f.style === 'normal'),
        italic: faces.some((f) => f.style === 'italic'),
      };
    });

    expect(set.fontSize).toBe(size);
    expect(set.lineHeight).toBe(leading);
    // max-width: 66ch resolves to 66 widths of "0" (sub-pixel rounding aside).
    expect(Math.abs(set.maxWidth - measure * set.ch)).toBeLessThan(1);
    // And the column really is that wide: the margin does not squeeze it.
    expect(set.width).toBeGreaterThanOrEqual(set.maxWidth - 0.5);
    // The face the label names is loaded, not a fallback (lib/specimen.test.ts
    // proves --font-text is the Brygada 1918 file), and it has its italic.
    expect(shown.face).toBe('Brygada 1918');
    expect(set.loaded).toBe(true);
    expect(set.italic).toBe(true);
  });

  test('the label beside the column and the size index agree on the numbers', async ({ page }) => {
    await page.goto(`/posts/${SEEDED.longForm}`);
    const shown = await label(page);
    // Beside the column, not above it.
    const labelBox = (await shown.specimen.boundingBox())!;
    const proseBox = (await page.locator('.prose').boundingBox())!;
    expect(labelBox.x + labelBox.width).toBeLessThan(proseBox.x);

    await page.goto('/');
    const entry = page.locator('.entry', {
      has: page.locator(`a[href="/posts/${SEEDED.longForm}"]`),
    });
    const numeral = (await entry.locator('.entry-numeral').textContent())!;
    const words = (await entry.locator('.entry-words').textContent())!;
    expect(`${numeral} min`).toBe(shown.minutes);
    expect(words).toBe(shown.words);
    expect(Number(numeral)).toBeGreaterThan(10);
  });

  test('every list entry carries its reading time, beside its title', async ({ page }) => {
    for (const path of ['/', '/posts', '/tags/caching']) {
      await page.goto(path);
      const entries = page.locator('.entry');
      const count = await entries.count();
      expect(count, path).toBeGreaterThan(1);
      for (let i = 0; i < count; i++) {
        const entry = entries.nth(i);
        await expect(entry.locator('.entry-numeral'), path).toHaveText(/^\d+$/u);
        const size = (await entry.locator('.entry-size').boundingBox())!;
        const title = (await entry.locator('.post-list-title').boundingBox())!;
        expect(size.x + size.width, path).toBeLessThanOrEqual(title.x);
      }
    }
  });

  test('the studio keeps an instant whole, and the editor holds still', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/studio');
    const times = page.locator('td[data-label="Changed"] time');
    // Zoned once the page has loaded (components/studio/when.tsx).
    await expect(times.first()).toHaveText(/GMT|UTC/u);
    const lines = await times.evaluateAll((all) => all.map((t) => t.getClientRects().length));
    expect(lines.length).toBeGreaterThan(5);
    expect(
      lines.every((n) => n === 1),
      `line boxes per time: ${lines.join(',')}`,
    ).toBe(true);

    await page.goto(`/studio/posts/${await postIdOf(SEEDED.longForm)}`);
    const editor = page.locator('.editor-write .cm-editor');
    await expect(editor).toBeVisible();
    const { editorHeight, pageHeight, viewport } = await page.evaluate(() => ({
      editorHeight: document.querySelector('.editor-write .cm-editor')!.getBoundingClientRect()
        .height,
      pageHeight: document.documentElement.scrollHeight,
      viewport: innerHeight,
    }));
    // The 3,418-word body scrolls inside its pane (it opened 16 viewports tall).
    expect(editorHeight).toBeLessThanOrEqual(viewport);
    expect(pageHeight / viewport).toBeLessThan(3);
  });
});

test.describe('at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the label folds to one line under the byline and claims no measure', async ({ page }) => {
    await page.goto(`/posts/${SEEDED.longForm}`);
    const shown = await label(page);
    await expect(shown.measure).toBeHidden();
    const facts = page.getByTestId('specimen').locator('.specimen-facts');
    const { height, line } = await facts.evaluate((dl) => ({
      height: dl.getBoundingClientRect().height,
      line: parseFloat(getComputedStyle(dl).lineHeight),
    }));
    expect(height).toBeLessThan(line * 1.5);
    // Under the byline, above the first paragraph.
    const byline = (await page.locator('.post-header .byline').boundingBox())!;
    const factsBox = (await facts.boundingBox())!;
    const prose = (await page.locator('.prose').boundingBox())!;
    expect(factsBox.y).toBeGreaterThan(byline.y);
    expect(factsBox.y).toBeLessThan(prose.y);
    // The contents fold into a disclosure that opens onto the sections.
    const toggle = page.locator('.specimen-contents-narrow summary');
    await toggle.click();
    const first = page.getByRole('navigation', { name: 'In this post' }).getByRole('link').first();
    await expect(first).toBeVisible();
  });
});
