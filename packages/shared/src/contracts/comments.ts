import { z } from 'zod';

import { COMMENT_HONEYPOT_FIELD, DECISIONS } from '../constants';

import { commentStatusSchema, LIMITS, slugSchema, type CommentStatus } from './content';
import { idSchema, instantSchema } from './primitives';

/**
 * Readers' comments: anonymous (a name, no account), and moderated FIRST.
 * Nothing a reader submits is shown to anyone until an editor approves it, and
 * only `APPROVED` is ever rendered publicly.
 *
 * Comments are plain text. They are never markdown and never HTML: the site
 * renders them as text nodes split into paragraphs, so a comment cannot carry a
 * link, an image or a script, and needs no sanitizer to be safe.
 */

export { COMMENT_HONEYPOT_FIELD } from '../constants';

/* eslint-disable no-control-regex -- stripping control characters is the point */
const CONTROL =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu;
/* eslint-enable no-control-regex */

/**
 * A comment body as it is stored: line endings unified, control and
 * direction-override characters removed (they can reorder what a moderator
 * reads), trailing spaces cut, at most one blank line in a row, trimmed.
 */
export function normalizeCommentBody(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .replace(/\t/gu, ' ')
    .replace(CONTROL, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/** A name is one line: every run of whitespace becomes one space. */
export function normalizeCommentName(text: string): string {
  return text.replace(CONTROL, '').replace(/\s+/gu, ' ').trim();
}

/** The paragraphs a stored body is shown as, split on blank lines. */
export function commentParagraphs(body: string): string[] {
  return body.split(/\n{2,}/u).filter((p) => p !== '');
}

export const submitCommentSchema = z.object({
  postSlug: slugSchema,
  name: z
    .string()
    .transform(normalizeCommentName)
    .pipe(
      z
        .string()
        .min(1, 'Give a name.')
        .max(LIMITS.commentName, `At most ${String(LIMITS.commentName)} characters.`),
    ),
  body: z
    .string()
    .transform(normalizeCommentBody)
    .pipe(
      z
        .string()
        .min(1, 'Write a comment.')
        .max(LIMITS.commentBody, `At most ${String(LIMITS.commentBody)} characters.`),
    ),
  [COMMENT_HONEYPOT_FIELD]: z.string().max(500).optional(),
});
export type SubmitCommentInput = z.infer<typeof submitCommentSchema>;

/** What a submission gets back, honeypot or not: it waits for an editor. */
export const commentReceiptSchema = z.object({ status: z.literal('PENDING') });

// --- the public block (content API v1) ------------------------------------

export const v1CommentSchema = z.object({
  id: idSchema,
  name: z.string(),
  body: z.string(),
  createdAt: instantSchema,
});
export type V1Comment = z.infer<typeof v1CommentSchema>;

export const V1_COMMENTS_PAGE_MAX = 100;

export const v1CommentListSchema = z.object({
  items: z.array(v1CommentSchema),
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: z.string().nullable(),
});

export const v1CommentQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(V1_COMMENTS_PAGE_MAX).default(V1_COMMENTS_PAGE_MAX),
});
export type V1CommentQuery = z.infer<typeof v1CommentQuerySchema>;

// --- moderation (studio) ----------------------------------------------------

export { DECISIONS };
export const decisionSchema = z.enum(DECISIONS);
export type Decision = z.infer<typeof decisionSchema>;

/**
 * `from` is the state the moderator saw. If somebody decided in the meantime
 * the answer is 409 with the state it is in now, never a silent overwrite of
 * another editor's decision.
 */
export const moderateCommentSchema = z
  .object({ from: commentStatusSchema, to: decisionSchema })
  .refine((d) => d.from !== d.to, {
    message: 'The comment is already in that state.',
    path: ['to'],
  });
export type ModerateCommentInput = z.infer<typeof moderateCommentSchema>;

/** Whether a change of state changes what readers see (and so needs a revalidation). */
export function changesWhatReadersSee(from: CommentStatus, to: CommentStatus): boolean {
  return (from === 'APPROVED') !== (to === 'APPROVED');
}

export const MODERATION_PAGE_MAX = 50;

export const moderationQuerySchema = z.object({
  status: commentStatusSchema.default('PENDING'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MODERATION_PAGE_MAX).default(20),
});
export type ModerationQuery = z.infer<typeof moderationQuerySchema>;

export const studioCommentSchema = z.object({
  id: idSchema,
  name: z.string(),
  body: z.string(),
  status: commentStatusSchema,
  createdAt: instantSchema,
  moderatedAt: instantSchema.nullable(),
  moderatedBy: z.object({ id: idSchema, name: z.string() }).nullable(),
  post: z.object({ id: idSchema, slug: slugSchema, title: z.string(), live: z.boolean() }),
  /**
   * How many comments are PENDING from the same source (the same keyed
   * address hash), this one included: a flood shows as a number, without
   * anybody seeing an address.
   */
  pendingFromSameSource: z.number().int().min(1).nullable(),
});
export type StudioComment = z.infer<typeof studioCommentSchema>;

export const moderationQueueSchema = z.object({
  items: z.array(studioCommentSchema),
  nextCursor: z.string().nullable(),
});
