/**
 * `/v1`, the headless content API, over the seeded newsroom.
 *
 * The seed's facts (which slug was renamed, which post was taken down, the
 * canary words written into everything unpublished) are read from its
 * catalog file rather than retyped here, so the two cannot drift apart.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  v1ErrorSchema,
  v1MovedSchema,
  v1PostListSchema,
  v1PostSchema,
  v1CommentListSchema,
  v1SearchResultSchema,
  v1TagListSchema,
  type V1PostSummary,
} from '@cms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DOCUMENTED_ROUTES } from '../src/content/openapi';
import {
  boot,
  call,
  newApiKey,
  newPost,
  newUser,
  routes,
  transition,
  type Harness,
  type PostReply,
  type Reply,
} from './support';

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

  it('gives every summary the same words and minutes as its page', async () => {
    const { items } = await crawl();
    for (const item of items) {
      const post = v1PostSchema.parse((await get(`/v1/posts/${item.slug}`)).body);
      expect([item.words, item.readingMinutes], item.slug).toEqual([
        post.words,
        post.readingMinutes,
      ]);
    }
    // The seed stores the count on every revision, so the list renders nothing.
    expect(await h.db.revision.count({ where: { words: null } })).toBe(0);
  });

  it("stores the renderer's count on a save and serves it on the list", async () => {
    const author = await newUser(h.db, 'words-author');
    const editor = await newUser(h.db, 'words-editor', 'EDITOR');
    // Computed with @cms/markdown's render(): 465 words (the heading, 460
    // words of prose and the code block), 2 minutes at 230 a minute.
    const body = `## Counted\n\n${Array.from({ length: 460 }, (_, i) => `w${String(i)}`).join(' ')}.\n\n\`\`\`js\nconst notProse = 1;\n\`\`\``;
    const post = await newPost(h, author, { body });
    expect(
      (await h.db.revision.findUniqueOrThrow({ where: { id: post.headRevisionId } })).words,
    ).toBe(465);
    await transition(h, editor, post, 'publish');
    const listed = (await crawl(`?author=${author.id}`)).items;
    expect(listed.map((p) => [p.slug, p.words, p.readingMinutes])).toEqual([[post.slug, 465, 2]]);
  });

  it('counts a revision written before the column existed by rendering it', async () => {
    const author = await newUser(h.db, 'legacy-author');
    const post = await newPost(h, author);
    // As a row from before 20261031140000: no words. Written straight to the
    // database, which is what a pre-migration API did.
    const legacy = await h.db.revision.create({
      data: {
        postId: post.id,
        number: 2,
        parentRevisionId: post.headRevisionId,
        authorId: author.id,
        title: 'Legacy',
        excerpt: 'Old.',
        body: '## Hello\n\nA body.',
      },
    });
    expect(legacy.words).toBeNull();
    const at = new Date();
    await h.db.post.update({
      where: { id: post.id },
      data: {
        headRevisionId: legacy.id,
        publishedRevisionId: legacy.id,
        status: 'PUBLISHED',
        publishedAt: at,
      },
    });
    const listed = (await crawl(`?author=${author.id}`)).items;
    // render('## Hello\n\nA body.').words, run: 3.
    expect(listed.map((p) => [p.words, p.readingMinutes])).toEqual([[3, 1]]);
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
    let approved = 0;
    for (const post of items) {
      bodies.push((await get(`/v1/posts/${post.slug}`)).text);
      // The seed puts pending and rejected comments, canary included, next to approved ones.
      const comments = await get(`/v1/posts/${post.slug}/comments`);
      approved += v1CommentListSchema.parse(comments.body).items.length;
      bodies.push(comments.text);
    }
    // A positive control: the crawl read real comments, so "no canary" means something.
    expect(approved).toBeGreaterThan(0);
    bodies.push((await get('/v1/tags')).text);
    for (const q of [DRAFT_CANARY, COMMENT_CANARY, 'two years in', 'caching']) {
      const r = await get(`/v1/search?q=${encodeURIComponent(q)}`);
      const result = v1SearchResultSchema.parse(r.body);
      if (q === DRAFT_CANARY || q === COMMENT_CANARY) expect(result.total).toBe(0);
      // Only the hits: `query` echoes what the client sent, canary included.
      bodies.push(JSON.stringify(result.items));
    }
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

describe('GET /v1/search', () => {
  it('answers in the contract shape, title hits first, snippets as data', async () => {
    const r = await get('/v1/search?q=caching&limit=3');
    expect(r.status).toBe(200);
    const result = v1SearchResultSchema.parse(r.body);
    expect(result.query).toBe('caching');
    expect(result.items).toHaveLength(3);
    expect(result.total).toBeGreaterThan(3);
    expect(result.nextCursor).not.toBeNull();
    // No markup crosses the API: matched runs are flagged, not wrapped.
    expect(r.text).not.toMatch(/<mark|<b>|\\u0002/u);
    expect(result.items.some((hit) => hit.snippet.some((p) => p.match))).toBe(true);

    const next = v1SearchResultSchema.parse(
      (await get(`/v1/search?q=caching&limit=3&cursor=${result.nextCursor!}`)).body,
    );
    const seen = new Set(result.items.map((p) => p.slug));
    expect(next.items.some((p) => seen.has(p.slug))).toBe(false);
  });

  it('normalizes the query, and refuses an empty, over-long or foreign-cursor one (400)', async () => {
    const r = v1SearchResultSchema.parse((await get('/v1/search?q=%20%20caching%0A')).body);
    expect(r.query).toBe('caching');
    for (const path of ['/v1/search', '/v1/search?q=%20', `/v1/search?q=${'a'.repeat(201)}`]) {
      const refused = await get(path);
      expect(refused.status, path).toBe(400);
    }
    const { nextCursor } = v1SearchResultSchema.parse(
      (await get('/v1/search?q=page&limit=1')).body,
    );
    expect((await get(`/v1/search?q=caching&cursor=${nextCursor!}`)).status).toBe(400);
  });

  it('needs a key, and answers 304 to a matching ETag', async () => {
    expect((await call(h, 'GET', '/v1/search?q=caching', { user: null })).status).toBe(401);
    const first = await get('/v1/search?q=caching');
    const again = await get('/v1/search?q=caching', {
      'if-none-match': first.headers.get('etag')!,
    });
    expect(again.status).toBe(304);
  });

  it('finds what readers can see: not a draft, then the publish, then only the new text', async () => {
    const author = await newUser(h.db, 'search-author');
    const editor = await newUser(h.db, 'search-editor', 'EDITOR');
    const first = `zyxfirst${randomUUID().slice(0, 6)}`;
    const second = `zyxsecond${randomUUID().slice(0, 6)}`;
    const total = async (q: string) =>
      v1SearchResultSchema.parse((await get(`/v1/search?q=${q}`)).body).total;

    const post = await newPost(h, author, { title: `About ${first}`, body: `Body with ${first}.` });
    expect(await total(first)).toBe(0);
    const live = await transition(h, editor, post, 'publish');
    expect(await total(first)).toBe(1);

    const edit = await call<PostReply>(h, 'POST', `/studio/posts/${post.id}/revisions`, {
      user: author,
      body: {
        baseRevisionId: live.body.headRevisionId,
        title: `About ${second}`,
        excerpt: 'x',
        body: 'New body.',
      },
    });
    expect(edit.status).toBe(201);
    // A pending edit is invisible; the live text still answers.
    expect(await total(second)).toBe(0);
    expect(await total(first)).toBe(1);

    await transition(h, editor, edit.body, 'publish');
    expect(await total(second)).toBe(1);
    expect(await total(first)).toBe(0);
    // Every revision the API wrote has its document, written with it.
    const docs = await h.db.searchDocument.count({ where: { revision: { postId: post.id } } });
    expect(docs).toBe(2);
  });
});
