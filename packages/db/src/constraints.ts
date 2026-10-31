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
/** Raised by the `revisions_immutable` trigger. */
export const PG_RESTRICT_VIOLATION = '23001';

export const USER_EMAIL_UNIQUE = 'users_email_key';
export const POST_SLUG_UNIQUE = 'posts_slug_key';
export const REVISION_NUMBER_UNIQUE = 'revisions_post_id_number_key';
export const TAG_SLUG_UNIQUE = 'tags_slug_key';
export const TAG_NAME_UNIQUE = 'tags_name_key';
export const MEDIA_SHA256_UNIQUE = 'media_sha256_key';

export const UNIQUE_INDEXES = Object.freeze({
  USER_EMAIL_UNIQUE,
  POST_SLUG_UNIQUE,
  REVISION_NUMBER_UNIQUE,
  TAG_SLUG_UNIQUE,
  TAG_NAME_UNIQUE,
  MEDIA_SHA256_UNIQUE,
});

export const UNIQUE_INDEX_COLUMNS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  [USER_EMAIL_UNIQUE]: Object.freeze(['email']),
  [POST_SLUG_UNIQUE]: Object.freeze(['slug']),
  [REVISION_NUMBER_UNIQUE]: Object.freeze(['post_id', 'number']),
  [TAG_SLUG_UNIQUE]: Object.freeze(['slug']),
  [TAG_NAME_UNIQUE]: Object.freeze(['name']),
  [MEDIA_SHA256_UNIQUE]: Object.freeze(['sha256']),
});

/** Trigger-raised refusals (the trigger passes its own name as CONSTRAINT). */
export const REVISION_IMMUTABLE = 'revisions_immutable';
export const SLUG_REDIRECT_NOT_LIVE = 'slug_redirects_not_live';

/** Keeps a post's head and published revisions inside that post. */
export const POST_HEAD_SAME_POST = 'posts_head_revision_same_post_fkey';
export const POST_PUBLISHED_SAME_POST = 'posts_published_revision_same_post_fkey';
export const REVISION_PARENT_SAME_POST = 'revisions_parent_same_post_fkey';
export const REVISION_RESTORED_SAME_POST = 'revisions_restored_from_same_post_fkey';

/** The full-text index: GIN over `search_documents.vector`, partial on `live` (hand-written). */
export const SEARCH_VECTOR_INDEX = 'search_documents_live_vector_idx';

/**
 * Hand-written objects that `prisma migrate diff` sees and would DROP, because
 * schema.prisma cannot declare them. `scripts/db-drift.mjs` reads this list
 * from the built package and treats exactly these as intended. CHECKs,
 * triggers and partial indexes are not here: the diff does not report them.
 */
export const HAND_WRITTEN_DIFF_OBJECTS: readonly string[] = Object.freeze([
  POST_HEAD_SAME_POST,
  POST_PUBLISHED_SAME_POST,
  REVISION_PARENT_SAME_POST,
  REVISION_RESTORED_SAME_POST,
  SEARCH_VECTOR_INDEX,
]);
