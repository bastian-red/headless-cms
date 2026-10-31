import 'server-only';

/**
 * The public site's reads: the content API, as a headless client with its own
 * key, cached by Next and invalidated by tag.
 *
 * **Cached reads, tagged with the shared contract.** Every read the public
 * pages make is a `force-cache` fetch tagged with names from
 * `@cms/shared`'s revalidation contract (`posts`, `post:<slug>`,
 * `tag:<slug>`, `author:<id>`). The API's revalidation events carry the same
 * names, so a publish invalidates exactly the pages that show it, and the
 * pages themselves stay prerendered (scripts/render-check.mjs holds that).
 * `REVALIDATE_SECONDS` is the safety net if an event is ever lost.
 *
 * **Every listing also carries `posts`.** A tag or author page lists posts, and
 * any publish names `posts`, so a post that leaves a tag still leaves its page.
 *
 * **Nothing here reads a cookie or a header.** One such read and Next renders
 * the page per request; `apiFetch` (the studio's client) forwards the
 * browser's address and must not be used for these pages.
 *
 * **Search is the exception**, fetched per request and never cached: every
 * query is different and a result page is `noindex`.
 */
import {
  POSTS_TAG,
  authorTag,
  postTag,
  tagTag,
  v1MovedSchema,
  v1PostListSchema,
  v1PostSchema,
  v1SearchResultSchema,
  v1TagListSchema,
  type V1Post,
  type V1PostSummary,
} from '@cms/shared';
import { connection } from 'next/server';
import type { z } from 'zod';

import { apiBaseUrl, contentApiKey, contentAtBuild } from './config';

/** How long a cached read may live with no revalidation event: one hour. */
export const REVALIDATE_SECONDS = 3600;

/** The API's page size limit: the crawl reads whole pages. */
const PAGE = 50;

/** A 429 is retried this many times, waiting what `Retry-After` asks (capped). */
const RETRIES = 3;
const MAX_WAIT_MS = 10_000;

export class ContentError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ContentError';
  }
}

interface ReadOptions {
  /** Cache tags; omitted for a per-request read. */
  readonly tags?: readonly string[];
}

/** The raw response, after 429 retries. Redirects are never followed: a 308 is data. */
async function request(path: string, { tags }: ReadOptions): Promise<Response> {
  if (contentAtBuild === 'deferred') await connection();
  const init: RequestInit & { next?: { tags: string[]; revalidate: number } } = {
    headers: { authorization: `Bearer ${contentApiKey()}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
    ...(tags === undefined
      ? { cache: 'no-store' }
      : { cache: 'force-cache', next: { tags: [...tags], revalidate: REVALIDATE_SECONDS } }),
  };
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}${path}`, init);
    } catch (error) {
      throw new ContentError(
        503,
        `The content API at ${apiBaseUrl} is unreachable (${String(error)}). Every public page ` +
          'reads it: `pnpm dev` starts it, and `next build` needs it running (README, "Running it").',
      );
    }
    if (response.status !== 429 || attempt === RETRIES) return response;
    const seconds = Number(response.headers.get('retry-after'));
    const wait = Math.min(
      Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000,
      MAX_WAIT_MS,
    );
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

async function parse<T>(
  response: Response,
  path: string,
  schema: z.ZodType<T, unknown>,
): Promise<T> {
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    // The issues go to the log, never to a page.
    console.error(`[web] ${path} did not match its contract`, parsed.error.issues);
    throw new ContentError(500, `${path} did not match its contract.`);
  }
  return parsed.data;
}

async function read<T>(
  path: string,
  schema: z.ZodType<T, unknown>,
  options: ReadOptions,
): Promise<T> {
  const response = await request(path, options);
  if (!response.ok) {
    throw new ContentError(response.status, `${path} answered ${String(response.status)}.`);
  }
  return parse(response, path, schema);
}

/** Every live post, newest first: the API's pages, followed to the end. */
async function crawl(filter: string, tags: readonly string[]): Promise<V1PostSummary[]> {
  const posts: V1PostSummary[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams(filter);
    query.set('limit', String(PAGE));
    if (cursor !== null) query.set('cursor', cursor);
    const page = await read(`/v1/posts?${query.toString()}`, v1PostListSchema, { tags });
    posts.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return posts;
}

export function allPosts(): Promise<V1PostSummary[]> {
  return crawl('', [POSTS_TAG]);
}

export function postsTagged(slug: string): Promise<V1PostSummary[]> {
  return crawl(`tag=${encodeURIComponent(slug)}`, [POSTS_TAG, tagTag(slug)]);
}

export function postsBy(authorId: string): Promise<V1PostSummary[]> {
  return crawl(`author=${encodeURIComponent(authorId)}`, [POSTS_TAG, authorTag(authorId)]);
}

export async function allTags() {
  return (await read('/v1/tags', v1TagListSchema, { tags: [POSTS_TAG] })).items;
}

export type PostLookup =
  | { readonly kind: 'post'; readonly post: V1Post }
  | { readonly kind: 'moved'; readonly slug: string }
  | { readonly kind: 'missing' };

/**
 * One post by slug. An old slug is `moved` (the page answers 308); one that
 * never existed, or whose post was taken down (410), is `missing` (404).
 */
export async function postBySlug(slug: string): Promise<PostLookup> {
  const path = `/v1/posts/${encodeURIComponent(slug)}`;
  const response = await request(path, { tags: [postTag(slug)] });
  if (response.status === 308) {
    return { kind: 'moved', slug: (await parse(response, path, v1MovedSchema)).slug };
  }
  // 400 is a slug the API refuses outright (it is not a slug at all).
  if (response.status === 404 || response.status === 410 || response.status === 400) {
    return { kind: 'missing' };
  }
  if (!response.ok) {
    throw new ContentError(response.status, `${path} answered ${String(response.status)}.`);
  }
  return { kind: 'post', post: await parse(response, path, v1PostSchema) };
}

/** A page of search results, per request. Null for a query the API refuses (400). */
export async function search(q: string, cursor?: string) {
  const query = new URLSearchParams({ q, limit: '10' });
  if (cursor !== undefined) query.set('cursor', cursor);
  const path = `/v1/search?${query.toString()}`;
  const response = await request(path, {});
  if (response.status === 400) return null;
  if (!response.ok) {
    throw new ContentError(response.status, `${path} answered ${String(response.status)}.`);
  }
  return parse(response, path, v1SearchResultSchema);
}
