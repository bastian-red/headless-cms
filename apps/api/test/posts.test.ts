/**
 * Posts and revisions through the real graph: saves, the stale-save race,
 * the render gate, ownership, restore and rename.
 */
import { randomUUID } from 'node:crypto';

import { staleSaveDetailsSchema, studioPostSchema } from '@cms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { boot, call, newPost, newUser, type Harness, type PostReply } from './support';

let h: Harness;
let author: Awaited<ReturnType<typeof newUser>>;
let other: Awaited<ReturnType<typeof newUser>>;
let editor: Awaited<ReturnType<typeof newUser>>;
beforeAll(async () => {
  h = await boot();
  author = await newUser(h.db, 'posts-author');
  other = await newUser(h.db, 'posts-other-author');
  editor = await newUser(h.db, 'posts-editor', 'EDITOR');
});
afterAll(async () => {
  await h.close();
});

const save = (user: typeof author, post: Pick<PostReply, 'id'>, body: Record<string, unknown>) =>
  call<PostReply>(h, 'POST', `/studio/posts/${post.id}/revisions`, { user, body });

describe('creating a post', () => {
  it('writes revision 1 as the head of a DRAFT, in the contract shape', async () => {
    // A suffix in the title, because the slug comes from it and the lane must
    // pass a second time against the same database.
    const run = randomUUID().slice(0, 8);
    const r = await call(h, 'POST', '/studio/posts', {
      user: author,
      body: { title: `Café à la carte: a first post ${run}`, excerpt: 'x', body: 'Hello.' },
    });
    expect(r.status).toBe(201);
    const post = studioPostSchema.parse(r.body);
    expect(post.slug).toBe(`cafe-a-la-carte-a-first-post-${run}`);
    expect(post).toMatchObject({ status: 'DRAFT', live: false, publishedRevisionId: null });
    expect(post.head).toMatchObject({
      number: 1,
      parentRevisionId: null,
      author: { id: author.id },
    });
    expect(post.transitions).toEqual(['submit']);
  });

  it('refuses a slug another post has (409) and a tag that does not exist (422)', async () => {
    const first = await newPost(h, author);
    const taken = await call(h, 'POST', '/studio/posts', {
      user: author,
      body: { title: 'Again', slug: first.slug },
    });
    expect(taken.status).toBe(409);
    const tag = await call(h, 'POST', '/studio/posts', {
      user: author,
      body: { title: 'Tagged', tags: ['no-such-tag-anywhere'] },
    });
    expect(tag.status).toBe(422);
    expect(tag.body).toMatchObject({ details: { unknownTags: ['no-such-tag-anywhere'] } });
  });
});

describe('saving a revision', () => {
  it('writes n+1 on top of the base, and an unchanged autosave writes nothing (200)', async () => {
    const post = await newPost(h, author);
    const fields = { title: 'Integration post', excerpt: 'An excerpt.', body: 'Second.' };
    const first = await save(author, post, { baseRevisionId: post.headRevisionId, ...fields });
    expect(first.status).toBe(201);
    expect(first.body.head).toMatchObject({ number: 2 });

    const again = await save(author, post, {
      baseRevisionId: first.body.headRevisionId,
      ...fields,
    });
    expect(again.status).toBe(200);
    expect(again.body.headRevisionId).toBe(first.body.headRevisionId);
    expect(await h.db.revision.count({ where: { postId: post.id } })).toBe(2);
  });

  it('five saves racing from the same base: exactly one wins, every other gets 409 with the diff', async () => {
    const post = await newPost(h, author, { body: 'line one\nline two\n' });
    const base = post.headRevisionId;
    const replies = await Promise.all(
      [author, editor, editor, editor, editor].map((user, i) =>
        save(user, post, {
          baseRevisionId: base,
          title: `Attempt ${String(i)}`,
          body: `line one\nline two, attempt ${String(i)}\n`,
        }),
      ),
    );
    const winners = replies.filter((r) => r.status === 201);
    const losers = replies.filter((r) => r.status !== 201);
    expect(winners).toHaveLength(1);
    expect(losers.map((r) => r.status)).toEqual([409, 409, 409, 409]);

    for (const loser of losers) {
      // The lock path, not the unique index: a loser knows who won and what changed.
      const details = staleSaveDetailsSchema.parse(
        (loser.body as unknown as { details: unknown }).details,
      );
      expect(details.baseRevisionId).toBe(base);
      expect(details.current).toMatchObject({
        id: winners[0]!.body.headRevisionId,
        number: 2,
        isHead: true,
      });
      expect(details.changed).toEqual(expect.arrayContaining(['title', 'body']));
      expect(details.bodyPatch).toMatch(/^-line two$/mu);
    }
    expect(await h.db.revision.count({ where: { postId: post.id } })).toBe(2);
  });

  it('refuses a body that does not render in time (422), and writes nothing', async () => {
    const post = await newPost(h, author);
    const r = await save(author, post, {
      baseRevisionId: post.headRevisionId,
      title: 'Hostile',
      body: `${'*_'.repeat(4000)}a${'_*'.repeat(4000)}`,
    });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'UNPROCESSABLE', details: { render: 'timeout' } });
    expect(await h.db.revision.count({ where: { postId: post.id } })).toBe(1);

    // The checker recovered: the next save renders and lands.
    const next = await save(author, post, {
      baseRevisionId: post.headRevisionId,
      title: 'Fine',
      body: 'ok',
    });
    expect(next.status).toBe(201);
  });

  it('refuses a base revision that belongs to another post (422)', async () => {
    const mine = await newPost(h, author);
    const elsewhere = await newPost(h, author);
    const after = await save(author, mine, {
      baseRevisionId: mine.headRevisionId,
      title: 'Moved on',
      body: 'b',
    });
    expect(after.status).toBe(201);
    const r = await save(author, mine, { baseRevisionId: elsewhere.headRevisionId, title: 'x' });
    expect(r.status).toBe(422);
  });
});

describe('an author sees only their own posts', () => {
  it("answers 404, not 403, for somebody else's post, on every route", async () => {
    const post = await newPost(h, author);
    for (const [method, path, body] of [
      ['GET', `/studio/posts/${post.id}`, undefined],
      ['GET', `/studio/posts/${post.id}/revisions`, undefined],
      [
        'POST',
        `/studio/posts/${post.id}/revisions`,
        { baseRevisionId: post.headRevisionId, title: 'x' },
      ],
      ['PUT', `/studio/posts/${post.id}/slug`, { slug: 'stolen-slug' }],
      [
        'POST',
        `/studio/posts/${post.id}/transitions`,
        { action: 'submit', revisionId: post.headRevisionId },
      ],
    ] as const) {
      const r = await call(h, method, path, { user: other, body });
      expect(r.status, `${method} ${path}`).toBe(404);
    }
    const list = await call<{ items: { id: string }[] }>(h, 'GET', '/studio/posts?limit=100', {
      user: other,
    });
    expect(list.body.items.map((p) => p.id)).not.toContain(post.id);
  });

  it("lets an editor read and edit anybody's post", async () => {
    const post = await newPost(h, author);
    expect((await call(h, 'GET', `/studio/posts/${post.id}`, { user: editor })).status).toBe(200);
    const r = await save(editor, post, {
      baseRevisionId: post.headRevisionId,
      title: 'Edited',
      body: 'by an editor',
    });
    expect(r.status).toBe(201);
    expect(r.body.head).toMatchObject({ number: 2 });
  });
});

describe('restoring a revision', () => {
  it('writes a NEW revision with the old content and points back at it; history is never rewritten', async () => {
    const post = await newPost(h, author, { title: 'Version one', body: 'first' });
    const two = await save(author, post, {
      baseRevisionId: post.headRevisionId,
      title: 'Version two',
      body: 'second',
    });
    const r = await call<PostReply>(
      h,
      'POST',
      `/studio/posts/${post.id}/revisions/${post.headRevisionId}/restore`,
      {
        user: editor,
        body: { baseRevisionId: two.body.headRevisionId },
      },
    );
    expect(r.status).toBe(201);
    expect(r.body.head).toMatchObject({ number: 3, title: 'Version one', body: 'first' });
    const history = await call<{ number: number; restoredFromId: string | null }[]>(
      h,
      'GET',
      `/studio/posts/${post.id}/revisions`,
      { user: author },
    );
    expect(history.body.map((rev) => [rev.number, rev.restoredFromId])).toEqual([
      [3, post.headRevisionId],
      [2, null],
      [1, null],
    ]);
  });

  it("is an editor's action: an author gets 403", async () => {
    const post = await newPost(h, author);
    const r = await call(
      h,
      'POST',
      `/studio/posts/${post.id}/revisions/${post.headRevisionId}/restore`,
      {
        user: author,
        body: { baseRevisionId: post.headRevisionId },
      },
    );
    expect(r.status).toBe(403);
  });
});

describe('renaming', () => {
  it('lets an author rename a post that was never public, leaving no redirect', async () => {
    const post = await newPost(h, author);
    const r = await call<PostReply>(h, 'PUT', `/studio/posts/${post.id}/slug`, {
      user: author,
      body: { slug: `${post.slug}-renamed` },
    });
    expect(r.status).toBe(200);
    expect(await h.db.slugRedirect.count({ where: { postId: post.id } })).toBe(0);
  });

  it("refuses a slug that is another post's redirect (409)", async () => {
    const seededRedirect = await h.db.slugRedirect.findFirstOrThrow({ select: { fromSlug: true } });
    const post = await newPost(h, author);
    const r = await call(h, 'PUT', `/studio/posts/${post.id}/slug`, {
      user: author,
      body: { slug: seededRedirect.fromSlug },
    });
    expect(r.status).toBe(409);
  });
});
