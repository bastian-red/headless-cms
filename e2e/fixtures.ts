/**
 * Shared E2E helpers.
 *
 * The seeded facts are read out of `packages/db/prisma/seed.mts` rather than
 * retyped, so a renamed seed account fails here with a sentence instead of
 * every spec failing with "element not found".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test as base, type Page } from '@playwright/test';

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
