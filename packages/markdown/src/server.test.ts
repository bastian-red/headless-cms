/**
 * The save-time render check. It runs against the BUILT worker (`dist/`),
 * because that is the file a consumer's `new Worker()` loads; turbo builds this
 * package before testing it (turbo.json, `@cms/markdown#test`).
 *
 * The slow inputs are each at least 10x over the deadline they are given
 * (measured in server.ts), so these are not races.
 */
import { readFileSync } from 'node:fs';

import { LIMITS } from '@cms/shared';
import { describe, expect, it } from 'vitest';

import type * as Server from './server.js';

const built = new URL('../dist/server.js', import.meta.url);
const { checkRenderable, RENDER_BUDGET_MS } = (await import(built.href)) as typeof Server;

const longRead = readFileSync(
  new URL('../../db/prisma/content/posts/the-long-way-to-a-fast-page.md', import.meta.url),
  'utf8',
);

describe('checkRenderable', () => {
  it('passes the seeded long read well inside the budget', async () => {
    const result = await checkRenderable(longRead);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.words).toBeGreaterThan(3000);
      expect(result.ms).toBeLessThan(RENDER_BUDGET_MS);
    }
  });

  it('passes a plain body at the size limit', async () => {
    const body = 'Plain words in a paragraph. '.repeat(LIMITS.body / 28);
    expect(body.length).toBeLessThanOrEqual(LIMITS.body);
    expect(await checkRenderable(body)).toMatchObject({ ok: true });
  });

  it.each([
    // 16,000 characters: 8 s measured, so 16x the deadline.
    ['alternating emphasis', `${'*_'.repeat(4000)}a${'_*'.repeat(4000)}`],
    // 16,000 characters: 4.8 s measured.
    [
      'deeply nested lists',
      Array.from({ length: 400 }, (_, i) => `${'  '.repeat(i)}- a`).join('\n'),
    ],
    // Overflows the parser's stack, or runs past the deadline first.
    ['8,000 nested quotes', '> '.repeat(8000)],
  ])('stops %s at the deadline, and the host survives', async (_name, body) => {
    const started = performance.now();
    const result = await checkRenderable(body, { timeoutMs: 500 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(['timeout', 'crash']).toContain(result.reason);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('runs checks side by side without one stalling another', async () => {
    const [slow, fast] = await Promise.all([
      checkRenderable(`${'*_'.repeat(4000)}a${'_*'.repeat(4000)}`, { timeoutMs: 800 }),
      checkRenderable('## Fine\n\nA short body.'),
    ]);
    expect(slow).toMatchObject({ ok: false, reason: 'timeout' });
    expect(fast).toMatchObject({ ok: true, words: 4 });
  });
});
