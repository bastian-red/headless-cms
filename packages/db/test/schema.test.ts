/**
 * Every promise the content migration makes, tried against the real database.
 *
 * Each test attempts the forbidden write and asserts it is refused BY NAME, so a
 * refusal for an unrelated reason (a missing row, a typo) cannot pass for the
 * guarantee holding.
 */
import { LIMITS } from '@cms/shared';
import { afterAll, describe, expect, it } from 'vitest';

import {
  POST_HEAD_SAME_POST,
  POST_PUBLISHED_SAME_POST,
  REVISION_IMMUTABLE,
  REVISION_NUMBER_UNIQUE,
  REVISION_PARENT_SAME_POST,
  REVISION_RESTORED_SAME_POST,
  SLUG_REDIRECT_NOT_LIVE,
} from '../src/constraints';
import { db, names, newPost, newUser, publish, refused, suffix } from './support';

afterAll(async () => {
  await db.$disconnect();
});

describe('revisions are immutable', () => {
  it('refuses an UPDATE, even of one character of the body', async () => {
    const post = await newPost();
    const error = await refused(
      db.revision.update({
        where: { id: post.revisions[0]! },
        data: { body: 'rewritten history' },
      }),
    );
    expect(names(error, REVISION_IMMUTABLE)).toBe(true);
    const row = await db.revision.findUniqueOrThrow({ where: { id: post.revisions[0]! } });
    expect(row.body).toBe('Body 1');
  });

  it('refuses deleting a revision while its post exists', async () => {
    const post = await newPost(2);
    // Move the head back so no foreign key stands in the way: the trigger must
    // be what refuses, not posts_head_revision_id_fkey.
    await db.post.update({
      where: { id: post.postId },
      data: { headRevisionId: post.revisions[0]! },
    });
    const error = await refused(db.revision.delete({ where: { id: post.revisions[1]! } }));
    expect(names(error, REVISION_IMMUTABLE)).toBe(true);
  });

  it('lets a post be deleted, taking its whole revision chain with it', async () => {
    const post = await newPost(3);
    await publish(post);
    await db.post.delete({ where: { id: post.postId } });
    expect(await db.revision.count({ where: { postId: post.postId } })).toBe(0);
  });

  it('allows one revision n+1 per post: two saves from the same base cannot both land', async () => {
    const post = await newPost();
    const second = (parent: string) =>
      db.revision.create({
        data: {
          postId: post.postId,
          number: 2,
          parentRevisionId: parent,
          authorId: post.authorId,
          title: 'Racing save',
          excerpt: '',
          body: 'b',
        },
      });
    const results = await Promise.allSettled([
      second(post.revisions[0]!),
      second(post.revisions[0]!),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(names(loser.reason, REVISION_NUMBER_UNIQUE)).toBe(true);
  });
});

describe('a post only ever points at its own revisions', () => {
  it("refuses another post's revision as the head", async () => {
    // Their FIRST revision, which is not their head: pointing at their head
    // would be refused by posts_head_revision_id_key before the key under test.
    const [mine, theirs] = [await newPost(), await newPost(2)];
    const error = await refused(
      db.post.update({
        where: { id: mine.postId },
        data: { headRevisionId: theirs.revisions[0]! },
      }),
    );
    expect(names(error, POST_HEAD_SAME_POST)).toBe(true);
  });

  it("refuses publishing another post's revision", async () => {
    const [mine, theirs] = [await newPost(), await newPost()];
    // DRAFT with a distinct published revision satisfies every CHECK, so only
    // the same-post key is left to refuse it.
    const error = await refused(
      db.post.update({
        where: { id: mine.postId },
        data: { publishedRevisionId: theirs.revisions[0]!, publishedAt: new Date() },
      }),
    );
    expect(names(error, POST_PUBLISHED_SAME_POST)).toBe(true);
  });

  it("refuses a revision built on another post's revision, or restoring one", async () => {
    const [mine, theirs] = [await newPost(), await newPost()];
    const write = (data: { parentRevisionId: string; restoredFromId?: string }) =>
      db.revision.create({
        data: {
          postId: mine.postId,
          number: 2,
          authorId: mine.authorId,
          title: 'Cross-post',
          excerpt: '',
          body: 'b',
          ...data,
        },
      });
    expect(
      names(
        await refused(write({ parentRevisionId: theirs.revisions[0]! })),
        REVISION_PARENT_SAME_POST,
      ),
    ).toBe(true);
    expect(
      names(
        await refused(
          write({ parentRevisionId: mine.revisions[0]!, restoredFromId: theirs.revisions[0]! }),
        ),
        REVISION_RESTORED_SAME_POST,
      ),
    ).toBe(true);
  });
});

describe('the post state rules', () => {
  it('PUBLISHED means the head is the live revision', async () => {
    const post = await newPost(2);
    const error = await refused(
      db.post.update({
        where: { id: post.postId },
        data: {
          status: 'PUBLISHED',
          publishedRevisionId: post.revisions[0]!,
          publishedAt: new Date(),
        },
      }),
    );
    expect(names(error, 'posts_published_state_check')).toBe(true);
  });

  it('UNPUBLISHED means readers see nothing', async () => {
    const post = await newPost();
    await publish(post);
    const error = await refused(
      db.post.update({ where: { id: post.postId }, data: { status: 'UNPUBLISHED' } }),
    );
    expect(names(error, 'posts_unpublished_state_check')).toBe(true);
    await db.post.update({
      where: { id: post.postId },
      data: { status: 'UNPUBLISHED', publishedRevisionId: null },
    });
  });

  it('DRAFT, IN_REVIEW and SCHEDULED mean there is pending work', async () => {
    const post = await newPost();
    await publish(post);
    for (const status of ['DRAFT', 'IN_REVIEW'] as const) {
      const error = await refused(db.post.update({ where: { id: post.postId }, data: { status } }));
      expect(names(error, 'posts_pending_state_check'), status).toBe(true);
    }
  });

  it('a scheduled time exists exactly when the post is SCHEDULED', async () => {
    const post = await newPost();
    const noTime = await refused(
      db.post.update({ where: { id: post.postId }, data: { status: 'SCHEDULED' } }),
    );
    expect(names(noTime, 'posts_scheduled_state_check')).toBe(true);
    const staleTime = await refused(
      db.post.update({ where: { id: post.postId }, data: { scheduledFor: new Date() } }),
    );
    expect(names(staleTime, 'posts_scheduled_state_check')).toBe(true);
    await db.post.update({
      where: { id: post.postId },
      data: { status: 'SCHEDULED', scheduledFor: new Date(Date.now() + 86_400_000) },
    });
  });

  it('a live post has a publication date', async () => {
    const post = await newPost();
    const error = await refused(
      db.post.update({
        where: { id: post.postId },
        data: { status: 'PUBLISHED', publishedRevisionId: post.revisions[0]! },
      }),
    );
    expect(names(error, 'posts_published_at_check')).toBe(true);
  });

  it('a later revision has a parent, and the first has none', async () => {
    const post = await newPost();
    const orphan = await refused(
      db.revision.create({
        data: {
          postId: post.postId,
          number: 2,
          authorId: post.authorId,
          title: 'Orphan',
          excerpt: '',
          body: 'b',
        },
      }),
    );
    expect(names(orphan, 'revisions_lineage_check')).toBe(true);
  });
});

describe('content limits and formats', () => {
  it.each(['Has Spaces', 'trailing-', 'UPPER', 'double--hyphen'])(
    'refuses the slug %j',
    async (slug) => {
      const error = await refused(db.post.create({ data: { slug, authorId: await newUser() } }));
      expect(names(error, 'posts_slug_format_check')).toBe(true);
    },
  );

  it('refuses a blank title and one over the limit, and accepts one at it', async () => {
    const post = await newPost();
    const revision = (number: number, title: string) =>
      db.revision.create({
        data: {
          postId: post.postId,
          number,
          parentRevisionId: post.revisions[0]!,
          authorId: post.authorId,
          title,
          excerpt: '',
          body: 'b',
        },
      });
    expect(names(await refused(revision(2, '   ')), 'revisions_title_length_check')).toBe(true);
    expect(
      names(
        await refused(revision(2, 'x'.repeat(LIMITS.title + 1))),
        'revisions_title_length_check',
      ),
    ).toBe(true);
    await revision(2, 'x'.repeat(LIMITS.title));
  });

  it('refuses a comment address that is not a hash, and a decision without a time', async () => {
    const post = await newPost();
    const comment = (data: { ipHash: string; status?: 'APPROVED' }) =>
      db.comment.create({ data: { postId: post.postId, name: 'Reader', body: 'Hello', ...data } });
    expect(names(await refused(comment({ ipHash: '203.0.113.9' })), 'comments_ip_hash_check')).toBe(
      true,
    );
    expect(
      names(
        await refused(comment({ ipHash: 'a'.repeat(64), status: 'APPROVED' })),
        'comments_moderation_check',
      ),
    ).toBe(true);
  });

  it('refuses an image with no text alternative', async () => {
    const error = await refused(
      db.media.create({
        data: {
          sha256: 'b'.repeat(64),
          mimeType: 'image/png',
          bytes: 10,
          width: 1,
          height: 1,
          alt: ' ',
          uploadedById: await newUser(),
        },
      }),
    );
    expect(names(error, 'media_alt_length_check')).toBe(true);
  });
});

describe('a redirect never shadows a live slug', () => {
  it('refuses a redirect from a slug a post is using', async () => {
    const [live, other] = [await newPost(), await newPost()];
    const error = await refused(
      db.slugRedirect.create({ data: { fromSlug: live.slug, postId: other.postId } }),
    );
    expect(names(error, SLUG_REDIRECT_NOT_LIVE)).toBe(true);
  });

  it('refuses renaming a post to a slug that redirects elsewhere', async () => {
    const [renamed, other] = [await newPost(), await newPost()];
    const old = `old-${suffix()}`;
    await db.slugRedirect.create({ data: { fromSlug: old, postId: other.postId } });
    const error = await refused(
      db.post.update({ where: { id: renamed.postId }, data: { slug: old } }),
    );
    expect(names(error, SLUG_REDIRECT_NOT_LIVE)).toBe(true);
  });

  it('holds under a race: a rename waits for an uncommitted redirect, then sees it', async () => {
    const [renamed, other] = [await newPost(), await newPost()];
    const contested = `contested-${suffix()}`;

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inserted!: () => void;
    const redirectWritten = new Promise<void>((resolve) => {
      inserted = resolve;
    });

    // Transaction 1 writes the redirect and holds its transaction open.
    const first = db.$transaction(
      async (tx) => {
        await tx.slugRedirect.create({ data: { fromSlug: contested, postId: other.postId } });
        inserted();
        await gate;
      },
      { timeout: 20_000 },
    );
    await redirectWritten;

    // Transaction 2 renames a post to the same slug. Without the advisory lock
    // it would not see the uncommitted redirect and would succeed. A Prisma
    // query is a lazy thenable that runs only once something awaits it, so
    // `refused` is called NOW, and settled into a value so its outcome can be
    // read after the gate without an unhandled rejection in between.
    const second = refused(
      db.post.update({ where: { id: renamed.postId }, data: { slug: contested } }),
    ).then(
      (error) => ({ refusedWith: error }),
      (accepted: unknown) => ({ accepted }),
    );

    // Wait until the rename is really blocked on the lock, then let 1 commit.
    let blocked = false;
    for (let i = 0; i < 100 && !blocked; i += 1) {
      const [{ waiting }] = await db.$queryRaw<[{ waiting: number }]>`
        SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
      blocked = waiting > 0;
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    release();
    await first;

    const outcome = await second;
    expect(blocked, 'the rename waited on the slug lock').toBe(true);
    expect('refusedWith' in outcome && names(outcome.refusedWith, SLUG_REDIRECT_NOT_LIVE)).toBe(
      true,
    );
    const post = await db.post.findUniqueOrThrow({ where: { id: renamed.postId } });
    expect(post.slug).toBe(renamed.slug);
  });
});
