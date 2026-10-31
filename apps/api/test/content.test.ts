/**
 * `/v1`, the headless content API, over the seeded newsroom.
 *
 * The seed's facts (which slug was renamed, which post was taken down, the
 * canary words written into everything unpublished) are read from its
 * catalog file rather than retyped here, so the two cannot drift apart.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  v1ErrorSchema,
  v1MovedSchema,
  v1PostListSchema,
  v1PostSchema,
  v1TagListSchema,
  type V1PostSummary,
} from '@cms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DOCUMENTED_ROUTES } from '../src/content/openapi';
import { boot, call, newApiKey, newUser, routes, type Harness, type Reply } from './support';

const catalog = readFileSync(
  join(__dirname, '../../../packages/db/prisma/content/catalog.ts'),
  'utf8',
);
function seedConstant(name: string): string {
  const match = new RegExp(`export const ${name} = '([^']+)';`, 'u').exec(catalog);
  if (match === null) throw new Error(`catalog.ts has no ${name}`);
  return match[1]!;
}
const DRAFT_CANARY = seedConstant('DRAFT_CANARY');
const COMMENT_CANARY = seedConstant('COMMENT_CANARY');
const RENAMED_SLUG = seedConstant('RENAMED_SLUG');
const RENAMED_FROM = seedConstant('RENAMED_FROM');
const HOSTILE_SLUG = seedConstant('HOSTILE_SLUG');
const LIVE_WITH_DRAFT_SLUG = seedConstant('LIVE_WITH_DRAFT_SLUG');
const TAKEN_DOWN_SLUG = 'a-correction-we-made-too-late';
const DRAFT_SLUG = 'notes-toward-a-style-guide';

let h: Harness;
let admin: Awaited<ReturnType<typeof newUser>>;
let key: string;
beforeAll(async () => {
  h = await boot();
  admin = await newUser(h.db, 'content-admin', 'ADMIN');
  key = await newApiKey(h, admin, 'content suite');
});
afterAll(async () => {
  await h.close();
});

const get = <T = unknown>(path: string, headers: Record<string, string> = {}) =>
  call<T>(h, 'GET', path, { bearer: key, headers });

/** Every page of `/v1/posts{query}`, following `nextCursor` to the end. */
async function crawl(query = '', limit = 7): Promise<{ items: V1PostSummary[]; replies: Reply[] }> {
  const items: V1PostSummary[] = [];
  const replies: Reply[] = [];
  let cursor: string | null = null;
  do {
    const sep = query === '' ? '?' : '&';
    const path = `/v1/posts${query}${sep}limit=${String(limit)}${cursor === null ? '' : `&cursor=${cursor}`}`;
    const r = await get(path);
    expect(r.status, path).toBe(200);
    const pageOf = v1PostListSchema.parse(r.body);
    items.push(...pageOf.items);
    replies.push(r);
    cursor = pageOf.nextCursor;
  } while (cursor !== null);
  return { items, replies };
}

describe('the key', () => {
  it('is required, and every refusal is the same 401', async () => {
    const studioToken = await call(h, 'GET', '/v1/posts', { user: admin });
    const revoked = await newApiKey(h, admin, 'to revoke');
    const listed = await call<{ id: string; prefix: string }[]>(h, 'GET', '/studio/api-keys', {
      user: admin,
    });
    const row = listed.body.find((k) => revoked.startsWith(k.prefix))!;
    expect((await call(h, 'DELETE', `/studio/api-keys/${row.id}`, { user: admin })).status).toBe(
      204,
    );

    const answers = [
      await call(h, 'GET', '/v1/posts', { user: null }),
      await call(h, 'GET', '/v1/posts', { bearer: 'not-a-key' }),
      await call(h, 'GET', '/v1/posts', { bearer: `hcms_${'a'.repeat(51)}` }),
      await call(h, 'GET', '/v1/posts', { bearer: revoked }),
      studioToken,
    ];
    for (const r of answers) {
      expect(r.status).toBe(401);
      expect(v1ErrorSchema.parse(r.body).message).toBe('That API key was not accepted.');
    }
  });

  it('records when it was last used', async () => {
    const fresh = await newApiKey(h, admin, 'touch');
    await call(h, 'GET', '/v1/tags', { bearer: fresh });
    const prefix = fresh.slice(0, 13);
    await expect
      .poll(async () => (await h.db.apiKey.findFirstOrThrow({ where: { prefix } })).lastUsedAt)
      .not.toBeNull();
  });
});

describe('GET /v1/posts', () => {
  it('pages through every live post once, newest first, and nothing else', async () => {
    const { items } = await crawl();
    const live = await h.db.post.count({ where: { publishedRevisionId: { not: null } } });
    expect(items).toHaveLength(live);
    expect(new Set(items.map((p) => p.slug)).size).toBe(live);
    const times = items.map((p) => p.publishedAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(items.map((p) => p.slug)).not.toContain(DRAFT_SLUG);
    expect(items.map((p) => p.slug)).not.toContain(TAKEN_DOWN_SLUG);
  });

  it('filters by tag and by author', async () => {
    const caching = await crawl('?tag=caching', 2);
    expect(caching.items.length).toBeGreaterThan(1);
    expect(caching.items.every((p) => p.tags.some((t) => t.slug === 'caching'))).toBe(true);

    const mara = await h.db.user.findUniqueOrThrow({ where: { email: 'mara@quire.test' } });
    const hers = await crawl(`?author=${mara.id}`);
    expect(hers.items.length).toBeGreaterThan(1);
    expect(hers.items.every((p) => p.author.id === mara.id)).toBe(true);
  });

  it('refuses a cursor it did not issue (400)', async () => {
    const r = await get('/v1/posts?cursor=bm90LWEtY3Vyc29y');
    expect(r.status).toBe(400);
  });
});

describe('GET /v1/posts/:slug', () => {
  it('serves the published revision, not the pending draft', async () => {
    const r = await get(`/v1/posts/${LIVE_WITH_DRAFT_SLUG}`);
    expect(r.status).toBe(200);
    const post = v1PostSchema.parse(r.body);
    expect(post.title).toBe('Caching at the edge, a year in');
    const row = await h.db.post.findUniqueOrThrow({ where: { slug: LIVE_WITH_DRAFT_SLUG } });
    expect(row.headRevisionId).not.toBe(row.publishedRevisionId);
    expect(post.revisionId).toBe(row.publishedRevisionId);
  });

  it('serves the hostile post through the sanitizer', async () => {
    const post = v1PostSchema.parse((await get(`/v1/posts/${HOSTILE_SLUG}`)).body);
    expect(post.body).toMatch(/<script/iu);
    expect(post.html).not.toMatch(/<script|javascript:|\son[a-z]+=/iu);
    expect(post.words).toBeGreaterThan(0);
  });

  it('308s an old slug to the current one', async () => {
    const r = await get(`/v1/posts/${RENAMED_FROM}`);
    expect(r.status).toBe(308);
    expect(r.headers.get('location')).toBe(`/v1/posts/${RENAMED_SLUG}`);
    expect(v1MovedSchema.parse(r.body)).toEqual({ code: 'MOVED', slug: RENAMED_SLUG });
  });

  it('says 410 for a post that was taken down and 404 for one that never went out', async () => {
    const gone = await get(`/v1/posts/${TAKEN_DOWN_SLUG}`);
    expect(gone.status).toBe(410);
    expect(v1ErrorSchema.parse(gone.body).code).toBe('GONE');
    const never = await get(`/v1/posts/${DRAFT_SLUG}`);
    const missing = await get('/v1/posts/there-is-no-such-post-at-all');
    expect(never.status).toBe(404);
    // A draft and nothing at all answer byte for byte the same.
    expect(never.text).toBe(missing.text);
  });
});

describe('ETags', () => {
  it('answers 304 with no body when the client already has it, and 200 when it changed', async () => {
    const first = await get('/v1/tags');
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^"[\w-]{27}"$/u);
    expect(first.headers.get('cache-control')).toBe('no-cache');

    const again = await get('/v1/tags', { 'if-none-match': etag! });
    expect(again.status).toBe(304);
    expect(again.text).toBe('');
    expect((await get('/v1/tags', { 'if-none-match': '"stale"' })).status).toBe(200);
  });
});

describe('GET /v1/tags', () => {
  it('lists only tags a reader can browse, with live counts', async () => {
    const tags = v1TagListSchema.parse((await get('/v1/tags')).body).items;
    expect(tags.map((t) => t.slug)).toContain('caching');
    // Only drafts carry it, and the live-with-draft post's pending revision.
    expect(tags.map((t) => t.slug)).not.toContain('unannounced');
  });
});

describe('nothing unpublished leaves the API', () => {
  it('no canary in any page, post or tag', async () => {
    const { items, replies } = await crawl('', 50);
    const bodies = replies.map((r) => r.text);
    for (const post of items) bodies.push((await get(`/v1/posts/${post.slug}`)).text);
    bodies.push((await get('/v1/tags')).text);
    bodies.push((await get(`/v1/posts/${TAKEN_DOWN_SLUG}`)).text);
    for (const text of bodies) {
      expect(text).not.toContain(DRAFT_CANARY);
      expect(text).not.toContain(COMMENT_CANARY);
    }
    // The crawl reached the post whose head holds the canary.
    expect(items.map((p) => p.slug)).toContain(LIVE_WITH_DRAFT_SLUG);
  });
});

describe('GET /v1/openapi.json', () => {
  it('is public, and documents exactly the content routes the router serves', async () => {
    const r = await call<{ openapi: string; paths: Record<string, Record<string, unknown>> }>(
      h,
      'GET',
      '/v1/openapi.json',
      { user: null },
    );
    expect(r.status).toBe(200);
    expect(r.body.openapi).toBe('3.0.3');
    const documented = Object.entries(r.body.paths)
      .flatMap(([path, methods]) => Object.keys(methods).map((m) => `${m.toUpperCase()} ${path}`))
      .sort();
    expect(documented).toEqual([...DOCUMENTED_ROUTES].sort());

    const served = routes(h)
      .filter((route) => route.includes(' /v1/') && !route.endsWith('/openapi.json'))
      .map((route) => route.replace(/:(\w+)/gu, '{$1}'));
    expect(served).toEqual([...DOCUMENTED_ROUTES].sort());
  });
});
