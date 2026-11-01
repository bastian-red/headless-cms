/**
 * The studio, end to end, through the UI a person uses.
 *
 * - An author writes in CodeMirror, the preview follows every keystroke from
 *   the same renderer the site uses, Ctrl+S saves, and they submit.
 * - An editor publishes it and the public page has it within 5 s; taking it
 *   down asks first, and "keep it" really keeps it.
 * - Two people on one post: the second save is refused with what changed,
 *   and both ways out work ("save mine on top", "load theirs").
 * - History compares any revision with the current one and restores it as a
 *   new revision.
 * - A post scheduled through the form goes out on its own.
 * - Moderation, people and API keys through their pages, and each role sees
 *   only the pages it can use.
 * - Saving works without JavaScript.
 */
import { randomBytes } from 'node:crypto';

import { createPrismaClient } from '@cms/db';
import { moderationQueueSchema } from '@cms/shared';
import type { Browser, Page } from '@playwright/test';

import {
  API_BASE_URL,
  PEOPLE,
  SEEDED,
  editorToken,
  expect,
  page as fetchPage,
  personPage,
  randomAddress,
  signIn,
  studio,
  test,
  within,
} from '../fixtures';

const created = { posts: [] as string[], markers: [] as string[], keys: [] as string[] };

test.afterAll(async () => {
  const db = createPrismaClient();
  try {
    if (created.posts.length > 0) {
      await db.post.deleteMany({ where: { id: { in: created.posts } } });
    }
    if (created.markers.length > 0) {
      await db.comment.deleteMany({
        where: { OR: created.markers.map((m) => ({ body: { contains: m } })) },
      });
    }
    if (created.keys.length > 0)
      await db.apiKey.deleteMany({ where: { name: { in: created.keys } } });
  } finally {
    await db.$disconnect();
  }
});

const canary = () => randomBytes(5).toString('hex');

/** The editable surface CodeMirror puts over the body's textarea. */
const bodyEditor = (page: Page) => page.locator('.cm-content');
const editorState = (page: Page) => page.locator('.editor-state');
const workflowTitle = (page: Page) => page.locator('.workflow-title');

/** Create a draft through the New post form and return its id. */
async function newDraft(page: Page, title: string): Promise<string> {
  await page.goto('/studio');
  await page.getByRole('link', { name: 'New post' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Create draft' }).click();
  // Not `/studio/posts/new` itself, which the pattern would otherwise match.
  await page.waitForURL((url) => /^\/studio\/posts\/(?!new$)[^/]+$/u.test(url.pathname));
  const id = /\/studio\/posts\/([^/]+)$/u.exec(new URL(page.url()).pathname)?.[1];
  if (id === undefined) throw new Error(`No post id in ${page.url()}`);
  created.posts.push(id);
  await expect(bodyEditor(page)).toBeVisible();
  return id;
}

async function typeBody(page: Page, text: string) {
  await bodyEditor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
}

async function save(page: Page) {
  await page.keyboard.press('ControlOrMeta+s');
  await expect(editorState(page)).toContainText(/Saved as revision \d+/u);
}

/** A draft written through the UI by the author, with an excerpt, and its slug. */
async function authorDraft(browser: Browser, marker: string) {
  const author = await personPage(browser, 'author');
  const id = await newDraft(author.page, `Notes from the press ${marker}`);
  await author.page.getByLabel('Excerpt').fill(`What the press taught us, ${marker}.`);
  await typeBody(author.page, `## Section ${marker}\n\nThe first paragraph ${marker}.`);
  await save(author.page);
  const slug = await author.page.locator('#main input[name="slug"]').inputValue();
  return { author, id, slug };
}

test('an author writes with a live preview, saves with Ctrl+S and submits for review', async ({
  browser,
}) => {
  const marker = canary();
  const author = await personPage(browser, 'author');
  const page = author.page;
  await newDraft(page, `Notes from the press ${marker}`);
  await expect(editorState(page)).toContainText('Revision 1, saved.');

  await typeBody(page, `## Section ${marker}\n\nA paragraph with **bold ${marker}** in it.`);
  await expect(editorState(page)).toContainText('Unsaved changes.');

  // The preview is the site's renderer: the `##` became a heading and the
  // `**` a <strong>, while the text was still unsaved.
  const preview = page.getByTestId('preview');
  await expect(preview.getByRole('heading', { name: `Section ${marker}` })).toBeVisible();
  await expect(preview.locator('strong')).toHaveText(`bold ${marker}`);

  // A transition acts on the saved revision, so it waits for the save.
  await expect(page.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
  await save(page);
  await expect(editorState(page)).toContainText('Saved as revision 2.');

  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.locator('.workflow-result')).toContainText('Submitted');
  await expect(workflowTitle(page)).toContainText('In review');
  // An author cannot publish: the button is not offered at all.
  await expect(page.getByRole('button', { name: 'Publish now' })).toHaveCount(0);

  // Leaving with unsaved text asks first (Chromium fires beforeunload after typing).
  await typeBody(page, ' more');
  if (test.info().project.name === 'chromium') {
    const asked = page.waitForEvent('dialog');
    const leaving = page.goto('/studio');
    const dialog = await asked;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.accept();
    await leaving;
  }
  expect(author.errors).toEqual([]);
  await author.context.close();
});

test('an editor publishes, readers get it within 5 s, and taking it down asks first', async ({
  browser,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'one engine: this publishes for real');
  const marker = canary();
  const { author, id, slug } = await authorDraft(browser, marker);
  await author.context.close();

  const editor = await personPage(browser, 'editor');
  const page = editor.page;
  expect((await fetchPage(request, `/posts/${slug}`)).status).toBe(404);

  await page.goto(`/studio/posts/${id}`);
  await page.getByRole('button', { name: 'Publish now' }).click();
  await expect(page.locator('.workflow-result')).toContainText('Published');
  await expect(workflowTitle(page)).toContainText('Published');
  await within(async () => {
    const reader = await fetchPage(request, `/posts/${slug}`);
    return reader.status === 200 && reader.text.includes(`The first paragraph ${marker}.`);
  }, 'the published post on its public page');

  // Take down asks, and "Keep it published" keeps it.
  await page.getByRole('button', { name: 'Take down' }).click();
  const question = page.getByRole('alertdialog');
  await expect(question).toContainText('Readers get a 404');
  await question.getByRole('link', { name: 'Keep it published' }).click();
  await expect(question).toHaveCount(0);
  await expect(workflowTitle(page)).toContainText('Published');
  expect((await fetchPage(request, `/posts/${slug}`)).status).toBe(200);

  await page.getByRole('button', { name: 'Take down' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Yes, take it down' }).click();
  await expect(page.locator('.workflow-result')).toContainText('Taken down');
  await within(
    async () => (await fetchPage(request, `/posts/${slug}`)).status === 404,
    'the taken-down post answering 404',
  );
  expect(editor.errors).toEqual([]);
  await editor.context.close();
});

test('a second save on a stale base is refused with the diff, and both ways out work', async ({
  browser,
}) => {
  const marker = canary();
  const first = await personPage(browser, 'editor');
  const id = await newDraft(first.page, `Two hands ${marker}`);
  const second = await personPage(browser, 'admin');
  await second.page.goto(`/studio/posts/${id}`);
  await expect(bodyEditor(second.page)).toBeVisible();

  // The first saves; the second, still on revision 1, saves after.
  await typeBody(first.page, `First hand ${marker}.`);
  await save(first.page);
  await typeBody(second.page, `Second hand ${marker}.`);
  await second.page.keyboard.press('ControlOrMeta+s');

  const stale = second.page.locator('section.stale');
  await expect(stale.getByRole('heading', { name: 'Somebody saved first' })).toBeVisible();
  await expect(stale).toContainText(`${PEOPLE.editor.name} saved revision 2`);
  await expect(stale).toContainText('They changed: Body.');
  await stale.getByText('What they changed in the body').click();
  await expect(stale.locator('.patch-line[data-kind="added"]')).toContainText(
    `First hand ${marker}.`,
  );
  // Nothing typed was lost.
  await expect(bodyEditor(second.page)).toContainText(`Second hand ${marker}.`);

  // "Save mine on top": an overwrite made by somebody who saw the diff.
  await stale.getByRole('button', { name: 'Save mine on top of revision 2' }).click();
  await expect(editorState(second.page)).toContainText('Saved as revision 3.');
  await expect(stale).toHaveCount(0);

  // Now the first is stale; they choose to load the newer text instead.
  await typeBody(first.page, ' discarded');
  await first.page.keyboard.press('ControlOrMeta+s');
  const theirs = first.page.locator('section.stale');
  await expect(theirs).toContainText('saved revision 3');
  await theirs.getByRole('link', { name: 'Discard mine and load theirs' }).click();
  await expect(theirs).toHaveCount(0);
  await expect(bodyEditor(first.page)).toContainText(`Second hand ${marker}.`);
  await expect(bodyEditor(first.page)).not.toContainText('discarded');
  await expect(editorState(first.page)).toContainText('Revision 3, saved.');

  expect([...first.errors, ...second.errors]).toEqual([]);
  await first.context.close();
  await second.context.close();
});

test('history compares a revision with the current one and restores it as a new revision', async ({
  page,
}) => {
  const marker = canary();
  await signIn(page, 'editor');
  const id = await newDraft(page, `Changing my mind ${marker}`);
  await typeBody(page, `Second thoughts ${marker}.`);
  await save(page);

  await page.goto(`/studio/posts/${id}/history`);
  await page.getByRole('link', { name: 'Compare revision 1 with the current one' }).click();
  const compare = page.getByRole('region', { name: /Revision 1 → current/u });
  await expect(compare.locator('ins')).toContainText(`Second thoughts ${marker}.`);
  await expect(compare).toContainText('Unchanged: Title, Excerpt, Tags');

  await compare.getByRole('button', { name: 'Restore revision 1' }).click();
  await expect(compare).toContainText('Restored as revision 3. Nothing was deleted.');
  await page.goto(`/studio/posts/${id}`);
  await expect(bodyEditor(page)).not.toContainText(`Second thoughts ${marker}.`);
  await expect(editorState(page)).toContainText('Revision 3, saved.');
});

test('a post scheduled through the form goes out on its own', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'one engine: this waits for the clock');
  test.setTimeout(180_000);
  const marker = canary();
  await signIn(page, 'editor');
  await newDraft(page, `On the hour ${marker}`);
  await page.getByLabel('Excerpt').fill(`Goes out by itself, ${marker}.`);
  await typeBody(page, `Scheduled text ${marker}.`);
  await save(page);
  const slug = await page.locator('#main input[name="slug"]').inputValue();

  // The browser runs in UTC (playwright.config.ts), so its wall clock is the
  // ISO string. The input has minutes only: the next whole minute at least
  // 61 s away clears the one-minute lead.
  const at = Math.ceil((Date.now() + 61_000) / 60_000) * 60_000;
  const local = new Date(at).toISOString().slice(0, 16);
  await expect(page.getByLabel('Publish at (your time, UTC)')).toBeVisible();
  await page.getByLabel('Publish at (your time, UTC)').fill(local);
  await page.getByRole('button', { name: 'Schedule' }).click();
  await expect(workflowTitle(page)).toContainText('Scheduled');
  await expect(page.locator('.workflow')).toContainText('Goes out at');

  expect((await fetchPage(request, `/posts/${slug}`)).status).toBe(404);
  await expect
    .poll(
      async () => {
        const reader = await fetchPage(request, `/posts/${slug}`);
        return reader.status === 200 && reader.text.includes(`Scheduled text ${marker}.`);
      },
      { timeout: at - Date.now() + 10_000, intervals: [1_000] },
    )
    .toBe(true);
  await page.reload();
  await expect(workflowTitle(page)).toContainText('Published');

  // Undo the public change through the product, so the cached pages follow
  // before afterAll deletes the row. Deleting a live post behind the cache
  // left later specs reading a sitemap and a feed the API disagreed with.
  await page.getByRole('button', { name: 'Take down' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Yes, take it down' }).click();
  await within(
    async () => (await fetchPage(request, `/posts/${slug}`)).status === 404,
    'the scheduled post taken down again',
  );
});

test('a schedule in the past or inside the next minute is refused in the form', async ({
  page,
}) => {
  await signIn(page, 'editor');
  await newDraft(page, `Too soon ${canary()}`);
  const soon = new Date(Date.now() + 10_000).toISOString().slice(0, 16);
  await page.getByLabel(/Publish at/u).fill(soon);
  await page.getByRole('button', { name: 'Schedule' }).click();
  await expect(page.locator('.workflow .field-error')).toHaveText(
    /Choose a time at least a minute from now\./u,
  );
  await expect(workflowTitle(page)).toContainText('Draft');
});

test('an editor approves a comment from the queue and readers see it within 5 s', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'one engine: this publishes a comment');
  const marker = `e2e${canary()}`;
  created.markers.push(marker);
  const sent = await request.post(`${API_BASE_URL}/comments`, {
    data: {
      postSlug: SEEDED.longForm,
      name: 'Queue reader',
      body: `Moderate me ${marker}`,
      website: '',
    },
    headers: { 'x-forwarded-for': randomAddress() },
  });
  expect(sent.status(), await sent.text()).toBe(202);
  await fetchPage(request, `/posts/${SEEDED.longForm}`); // cached without it

  await signIn(page, 'editor');
  await page
    .getByRole('navigation', { name: 'Studio' })
    .getByRole('link', { name: 'Comments' })
    .click();
  const item = page.locator('.queue-item').filter({ hasText: marker });
  await expect(item).toContainText('Waiting');
  await item.getByRole('button', { name: 'Approve' }).click();
  await expect(item).toContainText('Approved. It appears under the post within seconds.');
  await within(
    async () => (await fetchPage(request, `/posts/${SEEDED.longForm}`)).text.includes(marker),
    'the approved comment on the post page',
  );

  // Refuse it again through the API, so the cached page drops it before
  // afterAll deletes the row (see the scheduled test above).
  const token = await editorToken(request);
  const queue = moderationQueueSchema.parse(
    await studio(request, token, '/studio/comments?status=APPROVED&limit=50', null, 200),
  );
  const approved = queue.items.find((c) => c.body.includes(marker));
  expect(approved, 'the approved comment in the queue').toBeDefined();
  await studio(
    request,
    token,
    `/studio/comments/${approved!.id}/decision`,
    { from: 'APPROVED', to: 'REJECTED' },
    200,
  );
  await within(
    async () => !(await fetchPage(request, `/posts/${SEEDED.longForm}`)).text.includes(marker),
    'the refused comment gone from the post page',
  );
});

test('an admin creates a content API key, sees it once, and revoking it asks first', async ({
  page,
  request,
}) => {
  const name = `E2E key ${canary()}`;
  created.keys.push(name);
  await signIn(page, 'admin');
  await page.goto('/studio/api-keys');
  await page.getByLabel('What it is for').fill(name);
  await page.getByRole('button', { name: 'Create key' }).click();
  const key = (await page.getByTestId('new-key').textContent())?.trim() ?? '';
  expect(key).toMatch(/^hcms_/u);

  const read = () =>
    request.get(`${API_BASE_URL}/v1/posts`, { headers: { authorization: `Bearer ${key}` } });
  expect((await read()).status()).toBe(200);

  // Shown once: a reload lists the prefix only.
  await page.reload();
  await expect(page.getByTestId('new-key')).toHaveCount(0);
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).not.toContainText(key);

  await row.getByRole('button', { name: `Revoke ${name}` }).click();
  const question = row.getByRole('alertdialog');
  await expect(question).toContainText('Everything using it gets 401');
  await question.getByRole('button', { name: 'Keep it' }).click();
  expect((await read()).status()).toBe(200);

  await row.getByRole('button', { name: `Revoke ${name}` }).click();
  await row.getByRole('button', { name: 'Yes, revoke it' }).click();
  await expect(row).toContainText('Revoked');
  expect((await read()).status()).toBe(401);
});

test('each role sees the studio pages it can use, and the others do not exist for it', async ({
  browser,
}) => {
  const expected = {
    author: {
      shown: ['Posts'],
      hidden: ['Comments', 'People', 'API keys'],
      missing: ['/studio/comments', '/studio/people', '/studio/api-keys'],
    },
    editor: {
      shown: ['Posts', 'Comments'],
      hidden: ['People', 'API keys'],
      missing: ['/studio/people', '/studio/api-keys'],
    },
    admin: { shown: ['Posts', 'Comments', 'People', 'API keys'], hidden: [], missing: [] },
  } as const;
  for (const who of ['author', 'editor', 'admin'] as const) {
    const person = await personPage(browser, who);
    const nav = person.page.getByRole('navigation', { name: 'Studio' });
    for (const link of expected[who].shown) {
      await expect(
        nav.getByRole('link', { name: link, exact: true }),
        `${who}: ${link}`,
      ).toBeVisible();
    }
    for (const link of expected[who].hidden) {
      await expect(
        nav.getByRole('link', { name: link, exact: true }),
        `${who}: ${link}`,
      ).toHaveCount(0);
    }
    for (const path of expected[who].missing) {
      const response = await person.page.goto(path);
      expect(response?.status(), `${who}: ${path}`).toBe(404);
    }
    await person.context.close();
  }
});

test('saving works without JavaScript, through the plain textarea', async ({ browser }) => {
  const marker = canary();
  const editor = await personPage(browser, 'editor');
  const id = await newDraft(editor.page, `No script ${marker}`);
  await editor.context.close();

  const noScript = await personPage(browser, 'editor', { javaScriptEnabled: false });
  await noScript.page.goto(`/studio/posts/${id}`);
  await expect(noScript.page.locator('.cm-content')).toHaveCount(0);
  await noScript.page.getByLabel('Body', { exact: true }).fill(`Typed without a script ${marker}.`);
  await noScript.page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editorState(noScript.page)).toContainText('Saved as revision 2.');
  await expect(noScript.page.getByLabel('Body', { exact: true })).toHaveValue(
    `Typed without a script ${marker}.`,
  );
  await noScript.context.close();
});
