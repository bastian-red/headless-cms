/**
 * How the moderation queue words a comment's state and the decisions on it.
 * A glyph and a word for each state; the buttons offered are every decision
 * except the state the comment is already in.
 */
import type { CommentStatus, Decision } from '@cms/shared';
import { DECISIONS } from '@cms/shared/constants';

export const COMMENT_STATUS_UI: Readonly<Record<CommentStatus, { glyph: string; word: string }>> = {
  PENDING: { glyph: '◔', word: 'Waiting' },
  APPROVED: { glyph: '✓', word: 'Approved' },
  REJECTED: { glyph: '✕', word: 'Rejected' },
  SPAM: { glyph: '⊘', word: 'Spam' },
};

export const DECISION_LABEL: Readonly<Record<Decision, string>> = {
  APPROVED: 'Approve',
  REJECTED: 'Reject',
  SPAM: 'Mark as spam',
};

/** The decisions a moderator can take from `status`, approval first. */
export function decisionsFrom(status: CommentStatus): Decision[] {
  return DECISIONS.filter((decision) => decision !== status);
}
