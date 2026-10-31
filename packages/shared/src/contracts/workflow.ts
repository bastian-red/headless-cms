import { z } from 'zod';

import type { PostStatus } from './content';
import type { Action } from './roles';

/**
 * The editorial workflow, as data.
 *
 * Read by the API (which refuses anything not in this table) and by the
 * studio (which shows only the buttons this table allows), so the two cannot
 * disagree about what "publish" means from a given state.
 *
 * A post's state is two facts (see POST_STATUSES): its status, and whether it
 * is live (has a published revision). Every transition names the revision the
 * client was looking at; the API refuses one whose head has moved since
 * (409), so an editor publishes exactly the text they reviewed, never a save
 * that landed while they were reading.
 */
export const TRANSITIONS = [
  'submit',
  'withdraw',
  'publish',
  'schedule',
  'unschedule',
  'unpublish',
] as const;
export const transitionNameSchema = z.enum(TRANSITIONS);
export type TransitionName = z.infer<typeof transitionNameSchema>;

export interface PostState {
  readonly status: PostStatus;
  /** Whether the post has a published revision. */
  readonly live: boolean;
}

/** What a transition does to the post row. */
export interface TransitionPlan {
  readonly status: PostStatus;
  /** `head`: publish the head revision; `clear`: take the post down; `keep`: leave it. */
  readonly published: 'head' | 'clear' | 'keep';
  /** `set`: the request's time; `clear`: none. */
  readonly scheduledFor: 'set' | 'clear';
}

interface Rule {
  readonly requires: Action;
  /** Whether the transition applies from this state. */
  readonly from: (state: PostState) => boolean;
  readonly plan: TransitionPlan;
  /** Why it does not apply, for the 422 a refused transition answers with. */
  readonly refusal: string;
}

const pending = (s: PostState) => s.status === 'DRAFT' || s.status === 'IN_REVIEW';

export const WORKFLOW: Readonly<Record<TransitionName, Rule>> = Object.freeze({
  submit: {
    requires: 'post.submit',
    from: (s) => s.status === 'DRAFT',
    plan: { status: 'IN_REVIEW', published: 'keep', scheduledFor: 'clear' },
    refusal: 'Only a draft can be submitted for review.',
  },
  withdraw: {
    requires: 'post.submit',
    from: (s) => s.status === 'IN_REVIEW',
    plan: { status: 'DRAFT', published: 'keep', scheduledFor: 'clear' },
    refusal: 'Only a post in review can be withdrawn.',
  },
  publish: {
    requires: 'post.publish',
    // Anything with work readers have not seen. PUBLISHED has none.
    from: (s) => s.status !== 'PUBLISHED',
    plan: { status: 'PUBLISHED', published: 'head', scheduledFor: 'clear' },
    refusal: 'This post is already published with nothing pending.',
  },
  schedule: {
    requires: 'post.publish',
    // Rescheduling a scheduled post is allowed; so is scheduling a republish.
    from: (s) => pending(s) || s.status === 'SCHEDULED' || s.status === 'UNPUBLISHED',
    plan: { status: 'SCHEDULED', published: 'keep', scheduledFor: 'set' },
    refusal: 'There is nothing pending to schedule.',
  },
  unschedule: {
    requires: 'post.publish',
    from: (s) => s.status === 'SCHEDULED',
    plan: { status: 'DRAFT', published: 'keep', scheduledFor: 'clear' },
    refusal: 'This post is not scheduled.',
  },
  unpublish: {
    requires: 'post.publish',
    from: (s) => s.live,
    plan: { status: 'UNPUBLISHED', published: 'clear', scheduledFor: 'clear' },
    refusal: 'This post is not live.',
  },
});

export type TransitionDecision =
  | { readonly ok: true; readonly plan: TransitionPlan }
  | { readonly ok: false; readonly reason: string };

export function planTransition(name: TransitionName, state: PostState): TransitionDecision {
  const rule = WORKFLOW[name];
  return rule.from(state) ? { ok: true, plan: rule.plan } : { ok: false, reason: rule.refusal };
}

/** The transitions that apply from `state`, in table order: what the studio offers. */
export function availableTransitions(state: PostState): TransitionName[] {
  return TRANSITIONS.filter((name) => WORKFLOW[name].from(state));
}

/**
 * The status after a new revision is saved on top of the head.
 *
 * Saving always creates pending work. A published or unpublished post goes to
 * DRAFT (readers keep the live revision, if there is one). A post in review
 * stays in review: the editor's publish names the revision it approves, so a
 * later save cannot slip through. A scheduled post goes back to DRAFT, which
 * cancels the schedule; only an editor may do that (`SAVE_CANCELS_SCHEDULE`),
 * because otherwise an author's typo fix could quietly unschedule a launch.
 */
export function statusAfterSave(status: PostStatus): PostStatus {
  return status === 'IN_REVIEW' ? 'IN_REVIEW' : 'DRAFT';
}

export const SAVE_CANCELS_SCHEDULE: Action = 'post.publish';
