/**
 * Readers' comments against the real Nest graph, Postgres and Redis, at the
 * documented budget (RATE_LIMIT_COMMENT = 10 a minute per address).
 *
 * The promises: a submission waits for an editor; the honeypot stores nothing
 * and says so to nobody; no address is stored; only approved comments reach
 * the content API; a decision names what the moderator saw, so two editors
 * cannot both decide; and a decision readers can see writes its revalidation
 * event in the same transaction.
 */
import {
  COMMENT_HONEYPOT_FIELD,
  moderationQueueSchema,
  studioCommentSchema,
  v1CommentListSchema,
} from '@cms/shared';
import { addressHash } from '@cms/shared/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AUTH_SECRET,
  boot,
  call,
  newApiKey,
  newPost,
  newUser,
  randomAddress,
  transition,
  type Harness,
  type PostReply,
} from './support';

let h: Harness;
let editor: Awaited<ReturnType<typeof newUser>>;
let key: string;
let live: PostReply;
let draft: PostReply;

beforeAll(async () => {
  h = await boot();
  editor = await newUser(h.db, 'comments-editor', 'EDITOR');
  const admin = await newUser(h.db, 'comments-admin', 'ADMIN');
  key = await newApiKey(h, admin, 'comments suite');
  live = await newPost(h, editor, { title: 'Comments live post' });
  const published = await transition(h, editor, live, 'publish');
  expect(published.status, published.text).toBe(200);
  draft = await newPost(h, editor, { title: 'Comments draft post' });
});
afterAll(async () => {
  await h.close();
});

const submit = (body: Record<string, unknown>, address = randomAddress()) =>
  call<{ status: string }>(h, 'POST', '/comments', { user: null, body, address });

const comment = (fields: Record<string, unknown> = {}) => ({
  postSlug: live.slug,
  name: 'A Reader',
  body: `A comment ${Math.random().toString(36).slice(2)}.`,
  ...fields,
});

/** The stored row for a body this suite submitted. */
const rowFor = (body: string) => h.db.comment.findFirst({ where: { postId: live.id, body } });

const decide = (id: string, from: string, to: string) =>
  call(h, 'POST', `/studio/comments/${id}/decision`, { user: editor, body: { from, to } });

const eventsFor = (slug: string) =>
  h.db.revalidationEvent.count({ where: { tags: { has: `comments:${slug}` } } });

const publicComments = async (slug: string, query = '') => {
  const r = await call(h, 'GET', `/v1/posts/${slug}/comments${query}`, { bearer: key });
  return { status: r.status, list: r.status === 200 ? v1CommentListSchema.parse(r.body) : null };
};

async function pending(body: string, address = randomAddress()): Promise<string> {
  const r = await submit(comment({ body }), address);
  expect(r.status, r.text).toBe(202);
  return (await rowFor(body))!.id;
}

describe('POST /comments', () => {
  it('accepts a comment as pending, normalized, with only a keyed hash of the address', async () => {
    const address = randomAddress();
    const marker = Math.random().toString(36).slice(2);
    const r = await submit(
      comment({
        name: '  Ada \n Lovelace ',
        body: `  First line\r\n\r\n\r\nSecond ${marker}\u202e  `,
      }),
      address,
    );
    expect(r.status, r.text).toBe(202);
    expect(r.body).toEqual({ status: 'PENDING' });

    const row = await h.db.comment.findFirstOrThrow({
      where: { postId: live.id, body: { contains: marker } },
    });
    expect(row).toMatchObject({
      status: 'PENDING',
      name: 'Ada Lovelace',
      body: `First line\n\nSecond ${marker}`,
      moderatedAt: null,
      ipHash: addressHash(AUTH_SECRET, address),
    });
    expect(JSON.stringify(row)).not.toContain(address);
    // Pending is not public, not even to its writer.
    expect((await publicComments(live.slug)).list?.items.map((c) => c.id)).not.toContain(row.id);
  });

  it('answers a honeypot hit exactly like a comment, and stores nothing', async () => {
    const before = await h.db.comment.count({ where: { postId: live.id } });
    const real = await submit(comment());
    const bot = await submit(comment({ [COMMENT_HONEYPOT_FIELD]: 'https://spam.example' }));
    expect(bot.status).toBe(real.status);
    expect(bot.text).toBe(real.text);
    expect(await h.db.comment.count({ where: { postId: live.id } })).toBe(before + 1);
  });

  it('takes no comment on a post readers cannot see, answering as if it did not exist', async () => {
    const onDraft = await submit(comment({ postSlug: draft.slug }));
    const nowhere = await submit(comment({ postSlug: 'there-is-no-such-post-at-all' }));
    expect(onDraft.status).toBe(404);
    expect(onDraft.text.replace(draft.slug, '')).toBe(
      nowhere.text.replace('there-is-no-such-post-at-all', ''),
    );
    expect(await h.db.comment.count({ where: { postId: draft.id } })).toBe(0);
  });

  it('refuses an empty or over-long comment by field', async () => {
    expect((await submit(comment({ body: ' \n ' }))).status).toBe(400);
    expect((await submit(comment({ name: '' }))).status).toBe(400);
    expect((await submit(comment({ body: 'b'.repeat(2001) }))).status).toBe(400);
  });

  it('allows 10 a minute from one address, then 429, and limits nothing else', async () => {
    const address = randomAddress();
    for (let i = 0; i < 10; i += 1) {
      expect((await submit(comment(), address)).status, `comment ${String(i + 1)}`).toBe(202);
    }
    expect((await submit(comment(), address)).status).toBe(429);
    // Another reader is not affected.
    expect((await submit(comment())).status).toBe(202);
    // The comment budget is the comment route's alone: the same address can
    // still sign in (a wrong password is the usual 400, not a 429) and reach health.
    const signIn = await call(h, 'POST', '/auth/sign-in', {
      user: null,
      address,
      body: { email: editor.email, password: 'not-the-password-2026' },
    });
    expect(signIn.status).toBe(400);
    expect((await call(h, 'GET', '/health', { user: null, address })).status).toBe(200);
  });
});

describe('GET /v1/posts/:slug/comments', () => {
  it('lists approved comments only, oldest first, page by page', async () => {
    const tag = Math.random().toString(36).slice(2);
    const ids = [];
    for (const n of [1, 2, 3]) ids.push(await pending(`Approved ${tag} ${String(n)}`));
    const refused = await pending(`Refused ${tag}`);
    for (const id of ids) expect((await decide(id, 'PENDING', 'APPROVED')).status).toBe(200);
    expect((await decide(refused, 'PENDING', 'REJECTED')).status).toBe(200);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const { status, list } = await publicComments(
        live.slug,
        `?limit=2${cursor === null ? '' : `&cursor=${cursor}`}`,
      );
      expect(status).toBe(200);
      seen.push(...list!.items.filter((c) => c.body.includes(tag)).map((c) => c.body));
      cursor = list!.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual([1, 2, 3].map((n) => `Approved ${tag} ${String(n)}`));
  });

  it('is 404 for a post readers cannot see', async () => {
    expect((await publicComments(draft.slug)).status).toBe(404);
  });
});

describe('moderation', () => {
  it('queues pending comments oldest first, with how many came from the same source', async () => {
    const address = randomAddress();
    const tag = Math.random().toString(36).slice(2);
    const first = await pending(`Queued ${tag} a`, address);
    await pending(`Queued ${tag} b`, address);
    await pending(`Queued ${tag} c`);

    const items = [];
    let cursor: string | null = null;
    do {
      const r = await call(
        h,
        'GET',
        `/studio/comments?limit=50${cursor === null ? '' : `&cursor=${cursor}`}`,
        {
          user: editor,
        },
      );
      expect(r.status, r.text).toBe(200);
      const queue = moderationQueueSchema.parse(r.body);
      items.push(...queue.items);
      cursor = queue.nextCursor;
    } while (cursor !== null);

    expect(items.every((c) => c.status === 'PENDING')).toBe(true);
    const times = items.map((c) => c.createdAt);
    expect(times).toEqual([...times].sort());
    const ours = items.filter((c) => c.body.includes(tag));
    expect(ours.map((c) => c.body)).toEqual([
      `Queued ${tag} a`,
      `Queued ${tag} b`,
      `Queued ${tag} c`,
    ]);
    expect(ours.map((c) => c.pendingFromSameSource)).toEqual([2, 2, 1]);
    expect(ours[0]).toMatchObject({
      id: first,
      post: { id: live.id, slug: live.slug, live: true },
    });
    expect(JSON.stringify(items)).not.toMatch(/ipHash|ip_hash/u);
  });

  it('writes a revalidation event exactly when readers will see a difference', async () => {
    const id = await pending(`Visible ${Math.random().toString(36).slice(2)}`);
    const spam = await pending(`Spam ${Math.random().toString(36).slice(2)}`);
    const before = await eventsFor(live.slug);

    const approved = await decide(id, 'PENDING', 'APPROVED');
    expect(approved.status).toBe(200);
    expect(studioCommentSchema.parse(approved.body)).toMatchObject({
      status: 'APPROVED',
      moderatedBy: { id: editor.id },
      pendingFromSameSource: null,
    });
    expect(await eventsFor(live.slug)).toBe(before + 1);

    expect((await decide(spam, 'PENDING', 'SPAM')).status).toBe(200);
    expect(await eventsFor(live.slug)).toBe(before + 1);

    expect((await decide(id, 'APPROVED', 'REJECTED')).status).toBe(200);
    expect(await eventsFor(live.slug)).toBe(before + 2);
    expect((await publicComments(live.slug)).list?.items.map((c) => c.id)).not.toContain(id);
  });

  it('refuses a decision on a state the moderator did not see (409, naming the state now)', async () => {
    const id = await pending(`Stale ${Math.random().toString(36).slice(2)}`);
    expect((await decide(id, 'PENDING', 'APPROVED')).status).toBe(200);
    const stale = await decide(id, 'PENDING', 'SPAM');
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'CONFLICT', details: { status: 'APPROVED' } });
    expect((await h.db.comment.findUniqueOrThrow({ where: { id } })).status).toBe('APPROVED');
  });

  it('lets exactly one of two editors decide a comment at the same moment', async () => {
    const other = await newUser(h.db, 'comments-editor-b', 'EDITOR');
    for (let round = 0; round < 5; round += 1) {
      const id = await pending(`Race ${String(round)} ${Math.random().toString(36).slice(2)}`);
      const replies = await Promise.all([
        decide(id, 'PENDING', 'APPROVED'),
        call(h, 'POST', `/studio/comments/${id}/decision`, {
          user: other,
          body: { from: 'PENDING', to: 'SPAM' },
        }),
      ]);
      expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    }
  });

  it('never returns a comment to pending, and 404s one that does not exist', async () => {
    const id = await pending(`Back ${Math.random().toString(36).slice(2)}`);
    expect((await decide(id, 'APPROVED', 'PENDING')).status).toBe(400);
    expect((await decide('c0000000000000000000000000', 'PENDING', 'APPROVED')).status).toBe(404);
  });

  it('decides on a post that is not live without announcing anything', async () => {
    const id = (
      await h.db.comment.create({
        data: {
          postId: draft.id,
          name: 'Early',
          body: 'Before it went down.',
          ipHash: 'a'.repeat(64),
        },
      })
    ).id;
    const before = await eventsFor(draft.slug);
    expect((await decide(id, 'PENDING', 'APPROVED')).status).toBe(200);
    expect(await eventsFor(draft.slug)).toBe(before);
  });
});
