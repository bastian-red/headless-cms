/**
 * Readers' comments, end to end on a production build.
 *
 * - The approved comments render inside the static post page, and nothing
 *   pending or refused ever does (the seed's canary sits in both).
 * - A reader's comment, sent through the form, waits: the page says so and
 *   does not show it, not even to them.
 * - An editor's approval reaches the cached page within 5 s through the
 *   publisher's webhook; taking it back removes it within 5 s.
 * - The form works without JavaScript, keeps what was typed when it refuses,
 *   and treats a honeypot hit exactly like a person, storing nothing.
 */
import { randomBytes } from 'node:crypto';

import { createPrismaClient } from '@cms/db';
import { COMMENT_HONEYPOT_FIELD, moderationQueueSchema, v1CommentListSchema } from '@cms/shared';
import type { APIRequestContext, Page } from '@playwright/test';

import {
  API_BASE_URL,
  editorToken,
  expect,
  page as fetchPage,
  SEEDED,
  studio,
  test,
  within,
} from '../fixtures';

const SLUG = SEEDED.longForm;
const markers: string[] = [];

test.afterAll(async () => {
  if (markers.length === 0) return;
  const db = createPrismaClient();
  try {
    await db.comment.deleteMany({ where: { OR: markers.map((m) => ({ body: { contains: m } })) } });
  } finally {
    await db.$disconnect();
  }
});

const marker = () => {
  const value = `e2e${randomBytes(5).toString('hex')}`;
  markers.push(value);
  return value;
};

/** The pending comment whose body carries `text`, from the moderation queue. */
async function queued(request: APIRequestContext, token: string, text: string) {
  const queue = moderationQueueSchema.parse(
    await studio(request, token, '/studio/comments?limit=50', null, 200),
  );
  return queue.items.find((c) => c.body.includes(text)) ?? null;
}

async function fill(page: Page, name: string, body: string) {
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Comment', { exact: true }).fill(body);
}

const sent = (page: Page) => page.getByRole('status').filter({ hasText: 'waiting for an editor' });

test('the post shows its approved comments, counted in words, and nothing pending or refused', async ({
  page,
  request,
}) => {
  const key = process.env.CONTENT_API_KEY;
  if (key === undefined)
    throw new Error('CONTENT_API_KEY is not set; run through ./scripts/e2e.sh.');
  const api = await request.get(`${API_BASE_URL}/v1/posts/${SLUG}/comments`, {
    headers: { authorization: `Bearer ${key}` },
  });
  const approved = v1CommentListSchema.parse(await api.json()).items;
  expect(approved.length).toBeGreaterThan(1);

  await page.goto(`/posts/${SLUG}`);
  const section = page.getByRole('region', { name: `${String(approved.length)} comments` });
  await expect(section).toBeVisible();
  const items = section.getByRole('listitem');
  await expect(items).toHaveCount(approved.length);
  await expect(items.first()).toContainText(approved[0]!.name);
  for (const canary of SEEDED.canaries)
    await expect(page.locator('body')).not.toContainText(canary);

  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  const article = ld.map((t) => JSON.parse(t) as { '@type': string; commentCount?: number });
  expect(article.find((d) => d['@type'] === 'BlogPosting')?.commentCount).toBe(approved.length);
});

test('a reader comment waits for an editor; approval and refusal reach the page within 5 s', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'one engine: this is about the server');
  const text = marker();
  const body = `Thanks for this ${text}.\n\nA second paragraph.`;

  await page.goto(`/posts/${SLUG}`);
  await fill(page, 'E2E Reader', body);
  await page.getByRole('button', { name: 'Send comment' }).click();
  await expect(sent(page)).toBeVisible();
  // The fields are cleared for the next comment.
  await expect(page.getByLabel('Name')).toHaveValue('');

  // Not on the page, not even for its writer.
  expect((await fetchPage(request, `/posts/${SLUG}`)).text).not.toContain(text);

  const token = await editorToken(request);
  const comment = await queued(request, token, text);
  expect(comment, 'the comment is in the moderation queue').not.toBeNull();
  expect(comment!.body).toBe(body);

  await studio(
    request,
    token,
    `/studio/comments/${comment!.id}/decision`,
    { from: 'PENDING', to: 'APPROVED' },
    200,
  );
  const shown = await within(
    async () => (await fetchPage(request, `/posts/${SLUG}`)).text.includes(text),
    'the approved comment on the cached post page',
  );
  testInfo.annotations.push({ type: 'approve-visible-ms', description: String(shown) });

  // It renders as two paragraphs of text.
  await page.reload();
  const item = page.locator(`#comment-${comment!.id}`);
  await expect(item.locator('.comment-body p')).toHaveCount(2);

  await studio(
    request,
    token,
    `/studio/comments/${comment!.id}/decision`,
    { from: 'APPROVED', to: 'REJECTED' },
    200,
  );
  const hidden = await within(
    async () => !(await fetchPage(request, `/posts/${SLUG}`)).text.includes(text),
    'the refused comment gone from the cached post page',
  );
  testInfo.annotations.push({ type: 'reject-hidden-ms', description: String(hidden) });
});

test('without JavaScript the form still sends, and says the comment is waiting', async ({
  browser,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'one engine: this is about the server');
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    const text = marker();
    await page.goto(`/posts/${SLUG}`);
    await fill(page, 'No Script', `Sent without JavaScript ${text}.`);
    await page.getByRole('button', { name: 'Send comment' }).click();
    await expect(sent(page)).toBeVisible();
    const token = await editorToken(request);
    expect(await queued(request, token, text)).not.toBeNull();
  } finally {
    await context.close();
  }
});

test('a refusal names the field and keeps what was typed', async ({ page }) => {
  await page.goto(`/posts/${SLUG}`);
  await fill(page, 'Keeps Its Name', '   ');
  await page.getByRole('button', { name: 'Send comment' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Check the highlighted fields.' }),
  ).toBeVisible();
  const field = page.getByLabel('Comment', { exact: true });
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Write a comment.')).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveValue('Keeps Its Name');
});

test('a honeypot hit is thanked like anyone, and stored nowhere', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'one engine: this is about the server');
  const text = marker();
  await page.goto(`/posts/${SLUG}`);
  // A person cannot reach the field: it is off-screen, out of the tab order
  // and hidden from assistive technology. A bot fills it.
  const trap = page.locator(`input[name="${COMMENT_HONEYPOT_FIELD}"]`);
  await expect(trap).toHaveAttribute('tabindex', '-1');
  await trap.fill('https://cheap-followers.example', { force: true });
  await fill(page, 'Bot', `Buy now ${text}`);
  await page.getByRole('button', { name: 'Send comment' }).click();
  await expect(sent(page)).toBeVisible();
  const token = await editorToken(request);
  expect(await queued(request, token, text)).toBeNull();
});
