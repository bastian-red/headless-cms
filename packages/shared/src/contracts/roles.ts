import { z } from 'zod';

/**
 * Roles and what each may do, as DATA.
 *
 * One table read by the API guard, the studio (to hide what a role cannot use)
 * and the integration suite (which walks every role x action pair against the
 * real API). A permission granted in one place and forgotten in another is the
 * classic CMS bug -- an author who can publish because one route forgot to ask --
 * and with one table there is no second place.
 *
 * Ordered by power, weakest first:
 *
 * - `AUTHOR` writes: drafts, revisions, submitting a post for review. An author
 *   edits only posts they wrote; that ownership rule is data-dependent and lives
 *   in the posts service, not in this table.
 * - `EDITOR` decides what readers see: publish, schedule, unpublish, restore a
 *   revision, edit anybody's post, create tags, moderate comments.
 * - `ADMIN` runs the newsroom: people, their roles, content API keys.
 *
 * The spelling matches the Postgres enum (`packages/db`), so a role read from a
 * row needs no translation and a typo cannot compile in one place and not the
 * other.
 */
export const ROLES = ['AUTHOR', 'EDITOR', 'ADMIN'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const ACTIONS = [
  'post.read',
  'post.write',
  'post.submit',
  'post.write.any',
  'post.publish',
  'post.restore',
  'tag.manage',
  'comment.moderate',
  'user.manage',
  'apikey.manage',
] as const;
export const actionSchema = z.enum(ACTIONS);
export type Action = z.infer<typeof actionSchema>;

const AUTHOR_ACTIONS: readonly Action[] = ['post.read', 'post.write', 'post.submit'];
const EDITOR_ACTIONS: readonly Action[] = [
  ...AUTHOR_ACTIONS,
  'post.write.any',
  'post.publish',
  'post.restore',
  'tag.manage',
  'comment.moderate',
];

export const PERMISSIONS: Readonly<Record<Role, ReadonlySet<Action>>> = Object.freeze({
  AUTHOR: new Set(AUTHOR_ACTIONS),
  EDITOR: new Set(EDITOR_ACTIONS),
  ADMIN: new Set(ACTIONS),
});

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[role].has(action);
}

/** The roles at or above `role`, which is what "at least an editor" means in a guard. */
export function atLeast(role: Role, floor: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf(floor);
}
