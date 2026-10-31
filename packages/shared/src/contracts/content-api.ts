import { z } from 'zod';

import { slugSchema } from './content';
import { idSchema, instantSchema } from './primitives';
import { personSchema, tagRefSchema } from './studio';

/**
 * The content API, v1: what any frontend reads, the public site included.
 *
 * Everything here comes from a post's PUBLISHED revision and never from its
 * head: these shapes have no field a draft could travel in. The integration
 * suite crawls every route and fails on the seed's draft canary.
 *
 * `/v1/openapi.json` is generated from these schemas, and the integration
 * suite parses every real response with them, so the document cannot describe
 * an API that is not the one running.
 */

export const API_KEY_PREFIX = 'hcms_';

/** `hcms_` + 8 characters shown in the studio + 43 secret ones (32 random bytes). */
export const API_KEY_PATTERN = /^hcms_[A-Za-z0-9_-]{8}[A-Za-z0-9_-]{43}$/u;

export const v1PostSummarySchema = z.object({
  slug: slugSchema,
  title: z.string(),
  excerpt: z.string(),
  author: personSchema,
  tags: z.array(tagRefSchema),
  /** When the post first went live. */
  publishedAt: instantSchema,
  /** When the revision readers see was written. */
  revisedAt: instantSchema,
});
export type V1PostSummary = z.infer<typeof v1PostSummarySchema>;

export const v1OutlineEntrySchema = z.object({
  depth: z.number().int().min(2).max(6),
  id: z.string(),
  text: z.string(),
});

export const v1PostSchema = v1PostSummarySchema.extend({
  /** The id of the published revision: a cache key that changes on every publish. */
  revisionId: idSchema,
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  /** Markdown source, for clients that render it themselves with @cms/markdown. */
  body: z.string(),
  /** The same body through @cms/markdown: sanitized, audited, relative URLs. */
  html: z.string(),
  outline: z.array(v1OutlineEntrySchema),
  words: z.number().int().nonnegative(),
  readingMinutes: z.number().int().positive(),
});
export type V1Post = z.infer<typeof v1PostSchema>;

export const v1PostListSchema = z.object({
  items: z.array(v1PostSummarySchema),
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: z.string().nullable(),
});

export const V1_PAGE_DEFAULT = 20;
export const V1_PAGE_MAX = 50;

export const v1PostQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  tag: slugSchema.optional(),
  author: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(V1_PAGE_MAX).default(V1_PAGE_DEFAULT),
});
export type V1PostQuery = z.infer<typeof v1PostQuerySchema>;

/** A 308 from an old slug carries the current one, so a client need not parse `Location`. */
export const v1MovedSchema = z.object({ code: z.literal('MOVED'), slug: slugSchema });

export const v1TagSchema = z.object({
  slug: slugSchema,
  name: z.string(),
  description: z.string().nullable(),
  /** Live posts whose published revision carries the tag. */
  posts: z.number().int().positive(),
});

export const v1TagListSchema = z.object({ items: z.array(v1TagSchema) });

export const v1ErrorSchema = z.object({ code: z.string(), message: z.string() });
