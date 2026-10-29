/**
 * The demo newsroom: one person per role.
 *
 * Build step 1 seeds people only; posts, revisions, tags and comments arrive
 * with their tables in step 2.
 *
 * Three properties, each with the mechanism that holds it:
 *
 * 1. **It is idempotent and touches only its own rows.** Every account is an
 *    upsert keyed on its email, so a second run changes nothing and a person
 *    created in the studio is never removed.
 * 2. **Passwords go through the production hasher** (`@cms/shared/server`), so
 *    signing in with a seeded account exercises the same scrypt path a real one
 *    does.
 * 3. **The constants are readable from outside.** `scripts/dev-smoke.sh` and
 *    the E2E suite `sed` the `const NAME = '...'` lines below. One line each,
 *    single quotes, no template literals.
 *
 * These are local accounts for a local database, published on purpose so the
 * README's sign-in and `scripts/dev-smoke.sh` work on a fresh clone.
 */
import { createPrismaClient } from '@cms/db';
import { hashPassword } from '@cms/shared/server';

const ADMIN_EMAIL = 'ines@quire.test';
const ADMIN_PASSWORD = 'admin-password-2026';
const ADMIN_NAME = 'Ines Achterberg';
const EDITOR_EMAIL = 'tomas@quire.test';
const EDITOR_PASSWORD = 'editor-password-2026';
const EDITOR_NAME = 'Tomas Wexford';
const AUTHOR_EMAIL = 'mara@quire.test';
const AUTHOR_PASSWORD = 'author-password-2026';
const AUTHOR_NAME = 'Mara Lindgren';

const PEOPLE = [
  { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: ADMIN_NAME, role: 'ADMIN' },
  { email: EDITOR_EMAIL, password: EDITOR_PASSWORD, name: EDITOR_NAME, role: 'EDITOR' },
  { email: AUTHOR_EMAIL, password: AUTHOR_PASSWORD, name: AUTHOR_NAME, role: 'AUTHOR' },
] as const;

const prisma = createPrismaClient();

try {
  for (const person of PEOPLE) {
    const data = {
      name: person.name,
      role: person.role,
      passwordHash: hashPassword(person.password),
    };
    await prisma.user.upsert({
      where: { email: person.email },
      create: { email: person.email, ...data },
      update: data,
    });
  }
  console.info(`seed: ${String(PEOPLE.length)} people (admin, editor, author)`);
} finally {
  await prisma.$disconnect();
}
