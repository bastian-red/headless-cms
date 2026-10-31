/**
 * The ownership rule: an author sees and edits only their own posts; a role
 * with `post.write.any` (editor, admin) sees and edits all of them. Somebody
 * else's post answers 404, never 403, so its existence is not disclosed.
 */
import { can } from '@cms/shared';

import type { ActorRecord } from '../common/actor.guard';

type Who = Pick<ActorRecord, 'id' | 'role'>;

/** Whether `actor` sees every post, not only their own (the studio list's filter). */
export function seesEveryPost(actor: Who): boolean {
  return can(actor.role, 'post.write.any');
}

/** Whether `actor` may see and edit a post written by `authorId`. */
export function canTouch(actor: Who, authorId: string): boolean {
  return actor.id === authorId || seesEveryPost(actor);
}
