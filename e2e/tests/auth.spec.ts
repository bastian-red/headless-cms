import { expect, formError, PEOPLE, signIn, signOut, test, type Person } from '../fixtures';

const ROLE: Record<Person, string> = { admin: 'admin', editor: 'editor', author: 'author' };

for (const who of Object.keys(PEOPLE) as Person[]) {
  test(`the ${who} lands in the studio, shown the role the API holds`, async ({ page }) => {
    await signIn(page, who);
    await expect(page).toHaveURL(/\/studio$/u);
    await expect(page.getByTestId('who')).toContainText(PEOPLE[who].name);
    await expect(page.getByTestId('role')).toHaveText(ROLE[who]);
  });
}

test('a wrong password is one answer, whatever was wrong', async ({ page }) => {
  for (const email of [PEOPLE.editor.email, 'nobody@quire.test']) {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(formError(page)).toHaveText(/That email address and password do not match\./u);
  }
});

test('a signed-out deep link into the studio survives signing in', async ({ page }) => {
  await page.goto('/studio?tab=drafts');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fstudio%3Ftab%3Ddrafts/u);
  await page.getByLabel('Email').fill(PEOPLE.author.email);
  await page.getByLabel('Password').fill(PEOPLE.author.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/studio\?tab=drafts$/u);
});

test('a crafted next cannot leave the site', async ({ page }) => {
  await signIn(page, 'editor', '//evil.example/steal');
  await expect(page).toHaveURL(/\/studio$/u);
});

test('sign out ends the session: the studio asks again', async ({ page }) => {
  await signIn(page, 'admin');
  await signOut(page);
  await page.goto('/studio');
  await expect(page).toHaveURL(/\/sign-in/u);
});

test('the public front page needs no session', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/$/u);
});
