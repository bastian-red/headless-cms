/**
 * The names Postgres will use when it refuses a write. Catch blocks match on
 * these, never on message text.
 *
 * `constraints.test.ts` fails if a name exported here does not appear in a
 * migration, so a renamed index cannot leave a catch block matching nothing.
 */

export const PRISMA_UNIQUE_VIOLATION = 'P2002';
export const PRISMA_FOREIGN_KEY_VIOLATION = 'P2003';
export const PRISMA_NOT_FOUND = 'P2025';

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';

export const USER_EMAIL_UNIQUE = 'users_email_key';

export const UNIQUE_INDEXES = Object.freeze({
  USER_EMAIL_UNIQUE,
});

export const UNIQUE_INDEX_COLUMNS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  [USER_EMAIL_UNIQUE]: Object.freeze(['email']),
});
