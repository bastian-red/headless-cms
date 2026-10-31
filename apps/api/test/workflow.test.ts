/**
 * The editorial workflow through the real graph, and the outbox row that
 * every change to what readers see writes in the same transaction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  boot,
  call,
  newApiKey,
  newPost,
  newUser,
  transition,
  type Harness,
  type PostReply,
} from './support';

let h: Harness;
let author: Awaited<ReturnType<typeof newUser>>;
let editor: Awaited<ReturnType<typeof newUser>>;
let key: string;
let tag: string;
beforeAll(async () => {
  h = await boot();
  author = await newUser(h.db, 'workflow-author');
  editor = await newUser(h.db, 'workflow-editor', 'EDITOR');
  const admin = await newUser(h.db, 'workflow-admin', 'ADMIN');
  key = await newApiKey(h, admin);
  tag = `wf-${author.id.slice(-8)}`;
  await call(h, 'POST', '/studio/tags', {
    user: editor,
    body: { name: `Workflow ${tag}`, slug: tag },
  });
});
afterAll(async () => {
  await h.close();
});

/** The outbox rows written after `since`, newest last. */
async function eventsSince(since: Date): Promise<string[][]> {
  const rows = await h.db.revalidationEvent.findMany({
    where: { createdAt: { gt: since } },
    orderBy: { createdAt: 'asc' },
    select: { tags: true },
  });
  return rows.map((r) => r.tags);
}

const v1 = (slug: string) =>
  call<{ title: string; revisionId: string }>(h, 'GET', `/v1/posts/${slug}`, { bearer: key });

describe('author to editor to reader', () => {
  it('submit, withdraw, resubmit, publish: readers see the post only after publish', async () => {
    const post = await newPost(h, author, { tags: [tag] });
    expect((await v1(post.slug)).status).toBe(404);

    const submitted = await transition(h, author, post, 'submit');
    expect(submitted.body).toMatchObject({ status: 'IN_REVIEW', transitions: ['withdraw'] });
    const withdrawn = await transition(h, author, submitted.body, 'withdraw');
    expect(withdrawn.body.status).toBe('DRAFT');
    const again = await transition(h, author, withdrawn.body, 'submit');

    // The author cannot publish; the editor can, and only what they looked at.
    expect((await transition(h, author, again.body, 'publish')).status).toBe(403);
    const since = new Date();
    const published = await transition(h, editor, again.body, 'publish');
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({
      status: 'PUBLISHED',
      live: true,
      publishedRevisionId: post.headRevisionId,
    });
    expect(published.body.publishedAt).not.toBeNull();

    const read = await v1(post.slug);
    expect(read.status).toBe(200);
    expect(read.body.revisionId).toBe(post.headRevisionId);

    expect(await eventsSince(since)).toEqual([
      ['author:' + author.id, `post:${post.slug}`, 'posts', `tag:${tag}`].sort(),
    ]);
  });

  it('an edit to a live post is a DRAFT that readers do not see until it is published', async () => {
    const post = await newPost(h, author, { title: 'Live title' });
    const live = await transition(h, editor, post, 'publish');
    const edit = await call<PostReply>(h, 'POST', `/studio/posts/${post.id}/revisions`, {
      user: author,
      body: {
        baseRevisionId: live.body.headRevisionId,
        title: 'Draft title',
        excerpt: 'x',
        body: 'new',
      },
    });
    expect(edit.body).toMatchObject({ status: 'DRAFT', live: true });
    expect((await v1(post.slug)).body.title).toBe('Live title');

    const since = new Date();
    await transition(h, editor, edit.body, 'publish');
    expect((await v1(post.slug)).body.title).toBe('Draft title');
    // publishedAt is the first time it went live, kept across republishing.
    const row = await h.db.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(row.publishedAt?.toISOString()).toBe(live.body.publishedAt);
    expect(await eventsSince(since)).toHaveLength(1);
  });
});

describe('an editor publishes exactly what they looked at', () => {
  it('a transition naming a stale head is 409, and nothing changes', async () => {
    const post = await newPost(h, author);
    const moved = await call<PostReply>(h, 'POST', `/studio/posts/${post.id}/revisions`, {
      user: author,
      body: { baseRevisionId: post.headRevisionId, title: 'Changed after review', body: 'sneaky' },
    });
    expect(moved.status).toBe(201);
    const r = await transition(h, editor, post, 'publish');
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ details: { headRevisionId: moved.body.headRevisionId } });
    const row = await h.db.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(row.publishedRevisionId).toBeNull();
  });
});

describe('publish rules', () => {
  it('needs an excerpt (422)', async () => {
    const post = await newPost(h, author, { excerpt: '' });
    const r = await transition(h, editor, post, 'publish');
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'UNPROCESSABLE' });
  });

  it('refuses a transition the state does not allow (422 with the reason)', async () => {
    const post = await newPost(h, author);
    expect((await transition(h, author, post, 'withdraw')).body).toMatchObject({
      code: 'UNPROCESSABLE',
      message: 'Only a post in review can be withdrawn.',
    });
    expect((await transition(h, editor, post, 'unpublish')).status).toBe(422);
  });
});

describe('scheduling', () => {
  const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

  it('schedules ahead, refuses the past, and an editor can unschedule', async () => {
    const post = await newPost(h, author);
    const past = await transition(h, editor, post, 'schedule', {
      scheduledFor: new Date(Date.now() - 1000).toISOString(),
    });
    expect(past.status).toBe(422);

    const at = inAnHour();
    const scheduled = await transition(h, editor, post, 'schedule', { scheduledFor: at });
    expect(scheduled.body).toMatchObject({ status: 'SCHEDULED', scheduledFor: at, live: false });
    expect((await v1(post.slug)).status).toBe(404);

    const back = await transition(h, editor, scheduled.body, 'unschedule');
    expect(back.body).toMatchObject({ status: 'DRAFT', scheduledFor: null });
  });

  it("an author cannot edit a scheduled post (403); an editor's edit cancels the schedule", async () => {
    const post = await newPost(h, author);
    const scheduled = await transition(h, editor, post, 'schedule', { scheduledFor: inAnHour() });
    const body = { baseRevisionId: scheduled.body.headRevisionId, title: 'Edited', body: 'x' };
    const byAuthor = await call(h, 'POST', `/studio/posts/${post.id}/revisions`, {
      user: author,
      body,
    });
    expect(byAuthor.status).toBe(403);
    const byEditor = await call<PostReply>(h, 'POST', `/studio/posts/${post.id}/revisions`, {
      user: editor,
      body,
    });
    expect(byEditor.body).toMatchObject({ status: 'DRAFT', scheduledFor: null });
  });

  it('writes no outbox row: nothing a reader sees has changed', async () => {
    const post = await newPost(h, author);
    const since = new Date();
    await transition(h, editor, post, 'schedule', { scheduledFor: inAnHour() });
    await transition(
      h,
      author,
      (await call<PostReply>(h, 'GET', `/studio/posts/${post.id}`, { user: author })).body,
      'submit',
    );
    expect(await eventsSince(since)).toEqual([]);
  });
});

describe('unpublish and rename', () => {
  it('unpublish takes the post down (410 to readers) and tells the cache', async () => {
    const post = await newPost(h, author, { tags: [tag] });
    const live = await transition(h, editor, post, 'publish');
    const since = new Date();
    const down = await transition(h, editor, live.body, 'unpublish');
    expect(down.body).toMatchObject({
      status: 'UNPUBLISHED',
      live: false,
      publishedRevisionId: null,
    });
    expect((await v1(post.slug)).status).toBe(410);
    expect(await eventsSince(since)).toEqual([
      ['author:' + author.id, `post:${post.slug}`, 'posts', `tag:${tag}`].sort(),
    ]);
    // And it can come back.
    expect((await transition(h, editor, down.body, 'publish')).body.status).toBe('PUBLISHED');
  });

  it("renaming a live post is an editor's call, leaves a 308 behind, and names both slugs", async () => {
    const post = await newPost(h, author);
    await transition(h, editor, post, 'publish');
    const next = `${post.slug}-moved`;
    expect(
      (
        await call(h, 'PUT', `/studio/posts/${post.id}/slug`, {
          user: author,
          body: { slug: next },
        })
      ).status,
    ).toBe(403);

    const since = new Date();
    const r = await call(h, 'PUT', `/studio/posts/${post.id}/slug`, {
      user: editor,
      body: { slug: next },
    });
    expect(r.status).toBe(200);
    const old = await v1(post.slug);
    expect(old.status).toBe(308);
    expect(old.headers.get('location')).toBe(`/v1/posts/${next}`);
    expect(old.body).toEqual({ code: 'MOVED', slug: next });
    expect((await eventsSince(since))[0]).toEqual(
      expect.arrayContaining([`post:${post.slug}`, `post:${next}`, 'posts']),
    );

    // Renaming back removes the redirect instead of pointing it at itself.
    const back = await call(h, 'PUT', `/studio/posts/${post.id}/slug`, {
      user: editor,
      body: { slug: post.slug },
    });
    expect(back.status).toBe(200);
    expect((await v1(post.slug)).status).toBe(200);
    expect((await v1(next)).status).toBe(308);
  });
});
