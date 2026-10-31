/**
 * The rendering promise, end to end: a publish reaches the prerendered public
 * pages within five seconds, with no rebuild and no redeploy.
 *
 * The site under test is `next start` on a production build (scripts/e2e.sh),
 * so every page below was prerendered or cached before the post existed. The
 * only way the new text can appear is the whole chain working: the API writes
 * the publish and its revalidation event in one transaction, the publisher
 * delivers the event signed, the site verifies it and expires the tags, and
 * the next request renders fresh.
 *
 * The pages are read BEFORE each change, so they are cached with the old
 * content; reading them only after would prove a first render, not an
 * invalidation.
 */
import { randomBytes } from 'node:crypto';

import { createPrismaClient } from '@cms/db';
import type { SessionUser } from '@cms/shared';
import { mintServiceToken } from '@cms/shared/server';
import type { APIRequestContext } from '@playwright/test';

import { API_BASE_URL, expect, PEOPLE, randomAddress, test } from '../fixtures';

/** The promise under test. */
const WITHIN_MS = 5_000;

interface PostReply {
  id: string;
  slug: string;
  headRevisionId: string;
  status: string;
}

const created: string[] = [];

test.afterAll(async () => {
  if (created.length === 0) return;
  const db = createPrismaClient();
  try {
    await db.post.deleteMany({ where: { id: { in: created } } });
  } finally {
    await db.$disconnect();
  }
});

/** The editor, signed in against the API the way the web app does it, as a service token. */
async function editorToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/auth/sign-in`, {
    data: { email: PEOPLE.editor.email, password: PEOPLE.editor.password },
    headers: { 'x-forwarded-for': randomAddress() },
  });
  expect(response.status(), await response.text()).toBe(200);
  const user = (await response.json()) as SessionUser;
  const secret = process.env.AUTH_SECRET;
  if (secret === undefined)
    throw new Error('AUTH_SECRET is not set; run through ./scripts/e2e.sh.');
  return mintServiceToken(user, secret);
}

async function studio<T>(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
  expected: number,
): Promise<T> {
  const response = await request.post(`${API_BASE_URL}${path}`, {
    data,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status(), `${path}: ${await response.text()}`).toBe(expected);
  return (await response.json()) as T;
}

/** The text of a public page, as a reader (or a crawler) gets it. */
async function page(request: APIRequestContext, path: string) {
  const response = await request.get(path, { maxRedirects: 0 });
  return { status: response.status(), text: await response.text() };
}

/** Poll until `check` holds, failing if that takes longer than the promise. Returns the time it took. */
async function within(check: () => Promise<boolean>, what: string): Promise<number> {
  const started = Date.now();
  await expect
    .poll(check, {
      message: `${what} within ${String(WITHIN_MS)} ms`,
      timeout: WITHIN_MS,
      intervals: [200],
    })
    .toBe(true);
  return Date.now() - started;
}

test('publish, edit and take down reach the cached public pages within 5 s, without a rebuild', async ({
  request,
}, testInfo) => {
  // One browser engine is enough: this is about the server, and a second run
  // would only publish a second post.
  test.skip(testInfo.project.name !== 'chromium', 'server behaviour; one engine');

  const token = await editorToken(request);
  const canary = randomBytes(6).toString('hex');
  const slug = `publish-e2e-${canary}`;
  const firstTitle = `Fresh off the press ${canary}`;
  const secondTitle = `Corrected after the press ${canary}`;

  // Cached before the post exists.
  for (const path of ['/posts', '/feed.xml', '/sitemap.xml']) {
    const before = await page(request, path);
    expect(before.status, path).toBe(200);
    expect(before.text, path).not.toContain(canary);
  }
  expect((await page(request, `/posts/${slug}`)).status).toBe(404);

  // Publish.
  const post = await studio<PostReply>(
    request,
    token,
    '/studio/posts',
    { title: firstTitle, slug, excerpt: `An excerpt for ${canary}.`, body: `Body text ${canary}.` },
    201,
  );
  created.push(post.id);
  await studio(
    request,
    token,
    `/studio/posts/${post.id}/transitions`,
    {
      action: 'publish',
      revisionId: post.headRevisionId,
    },
    200,
  );

  const published = await within(async () => {
    const [article, list, feed, sitemap] = await Promise.all(
      [`/posts/${slug}`, '/posts', '/feed.xml', '/sitemap.xml'].map((p) => page(request, p)),
    );
    return (
      article!.status === 200 &&
      article!.text.includes(firstTitle) &&
      list!.text.includes(firstTitle) &&
      feed!.text.includes(firstTitle) &&
      sitemap!.text.includes(`/posts/${slug}`)
    );
  }, 'the post on its page, the archive, the feed and the sitemap');
  testInfo.annotations.push({ type: 'publish-visible-ms', description: String(published) });

  // Edit a live post: a new revision, published.
  const saved = await studio<PostReply>(
    request,
    token,
    `/studio/posts/${post.id}/revisions`,
    {
      baseRevisionId: post.headRevisionId,
      title: secondTitle,
      excerpt: `An excerpt for ${canary}.`,
      body: `Body text ${canary}, corrected.`,
    },
    201,
  );
  // Saved, not published: readers still see the first title.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  expect((await page(request, `/posts/${slug}`)).text).toContain(firstTitle);
  await studio(
    request,
    token,
    `/studio/posts/${post.id}/transitions`,
    {
      action: 'publish',
      revisionId: saved.headRevisionId,
    },
    200,
  );

  const edited = await within(async () => {
    const [article, feed] = await Promise.all(
      [`/posts/${slug}`, '/feed.xml'].map((p) => page(request, p)),
    );
    return (
      article!.text.includes(secondTitle) &&
      !article!.text.includes(firstTitle) &&
      feed!.text.includes(secondTitle) &&
      !feed!.text.includes(firstTitle)
    );
  }, 'the corrected title on the page and in the feed');
  testInfo.annotations.push({ type: 'edit-visible-ms', description: String(edited) });

  // Take it down.
  await studio(
    request,
    token,
    `/studio/posts/${post.id}/transitions`,
    {
      action: 'unpublish',
      revisionId: saved.headRevisionId,
    },
    200,
  );

  const removed = await within(async () => {
    const [article, list, feed, sitemap] = await Promise.all(
      [`/posts/${slug}`, '/posts', '/feed.xml', '/sitemap.xml'].map((p) => page(request, p)),
    );
    return (
      article!.status === 404 &&
      !list!.text.includes(canary) &&
      !feed!.text.includes(canary) &&
      !sitemap!.text.includes(canary)
    );
  }, 'the post gone from its page, the archive, the feed and the sitemap');
  testInfo.annotations.push({ type: 'unpublish-visible-ms', description: String(removed) });
});

test('the revalidation webhook refuses an unsigned request and changes nothing', async ({
  request,
}) => {
  const response = await request.post('/api/revalidate', {
    data: { eventId: 'forged', tags: ['posts'] },
  });
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: 'unauthorized' });
});
