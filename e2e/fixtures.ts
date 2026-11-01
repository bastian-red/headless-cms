/**
 * Shared E2E helpers.
 *
 * The seeded facts are read out of `packages/db/prisma/seed.mts` rather than
 * retyped, so a renamed seed account fails here with a sentence instead of
 * every spec failing with "element not found".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SessionUser } from '@cms/shared';
import { mintServiceToken } from '@cms/shared/server';
import { createPrismaClient } from '@cms/db';
import {
  expect,
  test as base,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

const SEED = readFileSync(join(__dirname, '..', 'packages', 'db', 'prisma', 'seed.mts'), 'utf8');

function seedConst(name: string): string {
  const match = new RegExp(`^const ${name} = '([^']*)';`, 'm').exec(SEED);
  if (!match) throw new Error(`Could not read ${name} out of packages/db/prisma/seed.mts.`);
  return match[1]!;
}

export const PEOPLE = {
  admin: {
    email: seedConst('ADMIN_EMAIL'),
    password: seedConst('ADMIN_PASSWORD'),
    name: seedConst('ADMIN_NAME'),
  },
  editor: {
    email: seedConst('EDITOR_EMAIL'),
    password: seedConst('EDITOR_PASSWORD'),
    name: seedConst('EDITOR_NAME'),
  },
  author: {
    email: seedConst('AUTHOR_EMAIL'),
    password: seedConst('AUTHOR_PASSWORD'),
    name: seedConst('AUTHOR_NAME'),
  },
} as const;
export type Person = keyof typeof PEOPLE;

/**
 * Facts about the seeded publication, read out of the catalog the seed writes
 * from (`packages/db/prisma/content/catalog.ts`), never retyped here.
 */
const CATALOG = readFileSync(
  join(__dirname, '..', 'packages', 'db', 'prisma', 'content', 'catalog.ts'),
  'utf8',
);

function catalogConst(name: string): string {
  const match = new RegExp(`export const ${name} = '([^']+)';`, 'u').exec(CATALOG);
  if (!match) throw new Error(`Could not read ${name} out of the seed catalog.`);
  return match[1]!;
}

/** The slug of the one post that was public and has been taken down. */
function takenDownSlug(): string {
  const match = /slug: '([^']+)',(?:(?!slug: )[\s\S])*?state: 'unpublished',/u.exec(CATALOG);
  if (!match) throw new Error('The seed catalog has no unpublished post.');
  return match[1]!;
}

export const SEEDED = {
  longForm: catalogConst('LONG_FORM_SLUG'),
  renamedTo: catalogConst('RENAMED_SLUG'),
  renamedFrom: catalogConst('RENAMED_FROM'),
  takenDown: takenDownSlug(),
  canaries: [catalogConst('DRAFT_CANARY'), catalogConst('COMMENT_CANARY')],
};

export const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';
export const PUBLISHER_URL = process.env.PUBLISHER_INTERNAL_URL ?? 'http://localhost:4400';

export function randomAddress(): string {
  const octet = () => String(1 + Math.floor(Math.random() * 254));
  return `10.${octet()}.${octet()}.${octet()}`;
}

/** Sign in through the form, as a person would, and wait for the studio to finish loading. */
export async function signIn(page: Page, who: Person = 'editor', next?: string) {
  const person = PEOPLE[who];
  await page.goto(next === undefined ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(person.email);
  await page.getByLabel('Password').fill(person.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Wait for the END of the redirect chain, not its first hop: navigating
  // mid-chain aborts it (Firefox: NS_BINDING_ABORTED).
  await page.waitForURL((url) => url.pathname.startsWith('/studio'));
  await page.waitForLoadState('load');
}

/** Sign out and wait until the sign-in page has finished loading. */
export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/sign-in/u);
  await page.waitForLoadState('load');
}

/**
 * A form's own error. Not getByRole('alert'): Next's route announcer is an
 * alert too, so that query matches two elements on every page.
 */
export const formError = (page: Page) => page.locator('.form-error[role="alert"]');

/**
 * Every spec fails on an uncaught error in the page, and every spec's browser
 * comes from its own address.
 *
 * The address: the web server forwards the browser's X-Forwarded-For to the
 * API, which keys its sign-in budget (5 a minute, the documented value) on it.
 * One shared address would make the sixth sign-in of the run a 429; a lifted
 * budget would hide real limiter bugs. A fresh address per test is how many
 * real people look.
 */
export const test = base.extend<{ failOnPageError: void }>({
  // Playwright reads a fixture's dependencies from the first parameter's
  // destructuring pattern, so an empty one is its documented form.
  // eslint-disable-next-line no-empty-pattern
  extraHTTPHeaders: async ({}, use) => {
    await use({ 'x-forwarded-for': randomAddress() });
  },
  failOnPageError: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await use();
      expect(errors, 'uncaught errors in the page').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

// --- the API, as the studio uses it, and the public pages as a reader gets them ----

/** How fast an editor's action must reach the cached public pages. */
export const WITHIN_MS = 5_000;

/** The editor, signed in against the API the way the web app does it, as a service token. */
export async function editorToken(request: APIRequestContext): Promise<string> {
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

/** One studio API call with a service token, asserting the status it must answer. */
export async function studio<T>(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown> | null,
  expected: number,
): Promise<T> {
  const headers = { authorization: `Bearer ${token}` };
  const response =
    data === null
      ? await request.get(`${API_BASE_URL}${path}`, { headers })
      : await request.post(`${API_BASE_URL}${path}`, { data, headers });
  expect(response.status(), `${path}: ${await response.text()}`).toBe(expected);
  return (await response.json()) as T;
}

/** The text of a public page, as a reader (or a crawler) gets it. */
export async function page(request: APIRequestContext, path: string) {
  const response = await request.get(path, { maxRedirects: 0 });
  return { status: response.status(), text: await response.text() };
}

/** Poll until `check` holds, failing if that takes longer than WITHIN_MS. Returns the time it took. */
export async function within(check: () => Promise<boolean>, what: string): Promise<number> {
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

// --- the studio --------------------------------------------------------------

/** A seeded post's id, read from the database: studio URLs carry ids, not slugs. */
export async function postIdOf(slug: string): Promise<string> {
  const db = createPrismaClient();
  try {
    const post = await db.post.findUnique({ where: { slug }, select: { id: true } });
    if (post === null) throw new Error(`No seeded post with the slug ${slug}.`);
    return post.id;
  } finally {
    await db.$disconnect();
  }
}

/**
 * A second (or third) person in their own browser context: their own cookies,
 * their own address, and the same uncaught-error gate as the `page` fixture.
 */
export async function personPage(
  browser: Browser,
  who: Person,
  options: { javaScriptEnabled?: boolean } = {},
): Promise<{ page: Page; context: BrowserContext; errors: string[] }> {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': randomAddress() },
    ...options,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signIn(page, who);
  return { page, context, errors };
}
