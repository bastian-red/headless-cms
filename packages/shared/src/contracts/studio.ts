import { z } from 'zod';

import { MAX_TAGS_PER_REVISION } from '../constants';

import { LIMITS, postStatusSchema, slugSchema } from './content';
import { emailSchema, idSchema, instantSchema, nameSchema, passwordSchema } from './primitives';
import { roleSchema } from './roles';
import { transitionNameSchema } from './workflow';

/**
 * The studio API: what the editor sends and gets back. Session-token routes
 * under `/studio`, every one behind the role table.
 */

/** A revision carries at most this many tags. A tag page is a facet, not a keyword list. */
export { MAX_TAGS_PER_REVISION };

/** An optional text field: blank means "not set", stored as null, never as ''. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value));

export const revisionFieldsSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.title),
  excerpt: z.string().trim().max(LIMITS.excerpt).default(''),
  // LF only. A browser submits a textarea with CRLF line endings (the HTML
  // form rule), so without this every body saved through a form differed
  // from the same text in the editor, and an unchanged save wrote a revision.
  // Normalised before the length check, so CRLF never counts double.
  body: z
    .string()
    .default('')
    .transform((body) => body.replace(/\r\n?/gu, '\n'))
    .pipe(z.string().max(LIMITS.body)),
  seoTitle: optionalText(LIMITS.seoTitle),
  seoDescription: optionalText(LIMITS.seoDescription),
  tags: z
    .array(slugSchema)
    .max(MAX_TAGS_PER_REVISION)
    .refine((tags) => new Set(tags).size === tags.length, 'Each tag once.')
    .default([]),
});
export type RevisionFields = z.infer<typeof revisionFieldsSchema>;

/** A new post. The slug defaults to `slugify(title)`. */
export const createPostSchema = revisionFieldsSchema.extend({ slug: slugSchema.optional() });
export type CreatePostInput = z.infer<typeof createPostSchema>;

/**
 * A save. `baseRevisionId` is the head the editor started from; if somebody
 * saved since, the answer is 409 with what they changed (`StaleSaveDetails`).
 */
export const saveRevisionSchema = revisionFieldsSchema.extend({ baseRevisionId: idSchema });
export type SaveRevisionInput = z.infer<typeof saveRevisionSchema>;

/** Restore writes a NEW revision with the old one's content, on top of `baseRevisionId`. */
export const restoreRevisionSchema = z.object({ baseRevisionId: idSchema });

export const renamePostSchema = z.object({ slug: slugSchema });

/**
 * A workflow transition. `revisionId` is the head the client saw; a schedule
 * also names its time.
 */
export const transitionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('schedule'),
    revisionId: idSchema,
    scheduledFor: instantSchema,
  }),
  z.object({
    action: z.enum(['submit', 'withdraw', 'publish', 'unschedule', 'unpublish']),
    revisionId: idSchema,
  }),
]);
export type TransitionInput = z.infer<typeof transitionSchema>;

export { MIN_SCHEDULE_LEAD_MS } from '../constants';

export const personSchema = z.object({ id: idSchema, name: nameSchema });

export const tagRefSchema = z.object({ slug: slugSchema, name: z.string() });

export const revisionSummarySchema = z.object({
  id: idSchema,
  number: z.number().int().positive(),
  author: personSchema,
  title: z.string(),
  createdAt: instantSchema,
  restoredFromId: idSchema.nullable(),
  isHead: z.boolean(),
  isPublished: z.boolean(),
});
export type RevisionSummary = z.infer<typeof revisionSummarySchema>;

export const revisionSchema = z.object({
  id: idSchema,
  number: z.number().int().positive(),
  parentRevisionId: idSchema.nullable(),
  restoredFromId: idSchema.nullable(),
  author: personSchema,
  title: z.string(),
  excerpt: z.string(),
  body: z.string(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  tags: z.array(tagRefSchema),
  createdAt: instantSchema,
});
export type RevisionView = z.infer<typeof revisionSchema>;

export const studioPostSchema = z.object({
  id: idSchema,
  slug: slugSchema,
  status: postStatusSchema,
  live: z.boolean(),
  author: personSchema,
  headRevisionId: idSchema,
  publishedRevisionId: idSchema.nullable(),
  publishedAt: instantSchema.nullable(),
  scheduledFor: instantSchema.nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
  head: revisionSchema,
  transitions: z.array(transitionNameSchema),
});
export type StudioPost = z.infer<typeof studioPostSchema>;

export const studioPostListItemSchema = studioPostSchema
  .pick({
    id: true,
    slug: true,
    status: true,
    live: true,
    author: true,
    scheduledFor: true,
    updatedAt: true,
  })
  .extend({ title: z.string() });

export const studioPostListSchema = z.object({
  items: z.array(studioPostListItemSchema),
  nextCursor: z.string().nullable(),
});

export const studioPostQuerySchema = z.object({
  status: postStatusSchema.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** The fields a stale-save diff compares, in the order the studio shows them. */
export const REVISION_DIFF_FIELDS = [
  'title',
  'excerpt',
  'body',
  'seoTitle',
  'seoDescription',
  'tags',
] as const;

/**
 * `details` on a 409 from a save: the revision that won, which fields it
 * changed relative to the base the editor started from, and a unified diff of
 * the body. The studio shows this instead of a bare "conflict", and the
 * editor's own text is never discarded: it is still in their editor.
 */
export const staleSaveDetailsSchema = z.object({
  baseRevisionId: idSchema,
  current: revisionSummarySchema,
  changed: z.array(z.enum(REVISION_DIFF_FIELDS)),
  bodyPatch: z.string(),
});
export type StaleSaveDetails = z.infer<typeof staleSaveDetailsSchema>;

// --- Tags -------------------------------------------------------------------

export const tagSchema = z.object({
  id: idSchema,
  slug: slugSchema,
  name: z.string(),
  description: z.string().nullable(),
});

export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.tagName),
  slug: slugSchema.optional(),
  description: optionalText(300),
});

// --- People (admin) ---------------------------------------------------------

export const userSchema = z.object({
  id: idSchema,
  email: emailSchema,
  name: nameSchema,
  role: roleSchema,
  createdAt: instantSchema,
});

export const createUserSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  role: roleSchema,
  password: passwordSchema,
});

export const updateRoleSchema = z.object({ role: roleSchema });

// --- Content API keys (admin) -----------------------------------------------

export const apiKeySchema = z.object({
  id: idSchema,
  name: z.string(),
  prefix: z.string(),
  createdBy: personSchema,
  createdAt: instantSchema,
  lastUsedAt: instantSchema.nullable(),
  revokedAt: instantSchema.nullable(),
});

export const createApiKeySchema = z.object({ name: z.string().trim().min(1).max(80) });

/** The only response that ever carries the key itself. It is not stored. */
export const createdApiKeySchema = z.object({ key: z.string(), apiKey: apiKeySchema });
