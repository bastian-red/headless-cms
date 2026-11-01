/**
 * How the studio says where a post stands and what can be done to it.
 *
 * State always carries a glyph and a word, never colour alone. The buttons
 * come from the API's `transitions` (already filtered by the actor's role),
 * so this table only says how each one is worded, whether it is the page's
 * main action, and what a destructive one asks before it happens.
 */
import type { PostStatus, TransitionName } from '@cms/shared';

export const STATUS_UI: Readonly<Record<PostStatus, { glyph: string; word: string }>> = {
  DRAFT: { glyph: '✎', word: 'Draft' },
  IN_REVIEW: { glyph: '◔', word: 'In review' },
  SCHEDULED: { glyph: '◷', word: 'Scheduled' },
  PUBLISHED: { glyph: '●', word: 'Published' },
  UNPUBLISHED: { glyph: '○', word: 'Taken down' },
};

/** One sentence on what readers see right now, which the status alone does not say. */
export function readersSee(post: { status: PostStatus; live: boolean }): string {
  if (post.status === 'PUBLISHED') return 'Readers see this revision.';
  if (post.status === 'UNPUBLISHED') return 'Readers see nothing: the address is a 404.';
  return post.live
    ? 'Readers see an earlier revision; these changes are not public yet.'
    : 'Not public yet. Readers see nothing.';
}

export interface TransitionUi {
  readonly label: string;
  /** The page's main action: publishing, or handing a draft to an editor. */
  readonly primary: boolean;
  /** Asked in words before a change readers would notice is made. */
  readonly confirm?: string;
}

export const TRANSITION_UI: Readonly<Record<TransitionName, TransitionUi>> = {
  submit: { label: 'Submit for review', primary: true },
  withdraw: { label: 'Withdraw from review', primary: false },
  publish: { label: 'Publish now', primary: true },
  schedule: { label: 'Schedule', primary: false },
  unschedule: { label: 'Cancel the schedule', primary: false },
  unpublish: {
    label: 'Take down',
    primary: false,
    confirm:
      'Take this post down? Readers get a 404 at its address, and it leaves the archive, the feed ' +
      'and the sitemap. You can publish it again later.',
  },
};

/** The order buttons appear in: the main action first, the destructive one last. */
export function orderedTransitions(names: readonly TransitionName[]): TransitionName[] {
  const rank = (name: TransitionName) =>
    TRANSITION_UI[name].primary ? 0 : TRANSITION_UI[name].confirm === undefined ? 1 : 2;
  return [...names].sort((a, b) => rank(a) - rank(b));
}
