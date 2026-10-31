import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { overdueSchedules, publishDue } from '../src/schedule';
import { cleanUp, connect, db, newTag, scheduledPost } from './support';

const ago = (ms: number) => new Date(Date.now() - ms);

/** The undelivered events naming this post. */
const eventsFor = (slug: string) =>
  db.revalidationEvent.findMany({ where: { tags: { has: `post:${slug}` } } });

afterEach(cleanUp);
afterAll(() => db.$disconnect());

describe('publishDue', () => {
  it('publishes a due post with its event in one go, and leaves a future one alone', async () => {
    const due = await scheduledPost(ago(5_000));
    const later = await scheduledPost(new Date(Date.now() + 60 * 60_000));

    const published = await publishDue(db);
    expect(published.map((p) => p.postId)).toContain(due.postId);
    expect(published.map((p) => p.postId)).not.toContain(later.postId);

    const row = await db.post.findUniqueOrThrow({ where: { id: due.postId } });
    expect(row).toMatchObject({
      status: 'PUBLISHED',
      publishedRevisionId: due.head,
      scheduledFor: null,
      // The time the editor chose, not the tick that noticed.
      publishedAt: due.scheduledFor,
    });
    expect(await eventsFor(due.slug)).toHaveLength(1);

    const untouched = await db.post.findUniqueOrThrow({ where: { id: later.postId } });
    expect(untouched).toMatchObject({ status: 'SCHEDULED', publishedRevisionId: null });
    expect(await eventsFor(later.slug)).toHaveLength(0);
  });

  it('announces the tags of both what readers saw and what they will see, and keeps the first publication date', async () => {
    const leaving = await newTag();
    const arriving = await newTag();
    const post = await scheduledPost(ago(1_000), {
      republish: true,
      liveTag: leaving.id,
      headTag: arriving.id,
    });

    await publishDue(db);

    const [event] = await eventsFor(post.slug);
    expect(event?.tags).toEqual(
      [
        'posts',
        `post:${post.slug}`,
        `tag:${leaving.slug}`,
        `tag:${arriving.slug}`,
        `author:${post.authorId}`,
      ].sort(),
    );
    const row = await db.post.findUniqueOrThrow({ where: { id: post.postId } });
    expect(row.publishedAt).toEqual(new Date('2026-01-02T03:04:05.000Z'));
    expect(row.publishedRevisionId).toBe(post.head);
  });

  it('publishes each due post exactly once when two publishers race for them', async () => {
    const posts = await Promise.all(Array.from({ length: 12 }, () => scheduledPost(ago(2_000))));
    const a = connect();
    const b = connect();
    try {
      // Several rounds from each, interleaved, small batches so they contend.
      const rounds = Array.from({ length: 6 }, (_, i) =>
        publishDue(i % 2 === 0 ? a : b, { limit: 3 }),
      );
      const results = (await Promise.all(rounds)).flat();
      const ours = new Set(posts.map((p) => p.postId));
      const claimed = results.filter((r) => ours.has(r.postId)).map((r) => r.postId);
      // Published once each: no post in two results, and one event each.
      expect(new Set(claimed).size).toBe(claimed.length);
      // A round may finish before the others commit, so drain the rest.
      await publishDue(db, { limit: 50 });
      for (const post of posts) {
        expect(await eventsFor(post.slug), post.slug).toHaveLength(1);
        const row = await db.post.findUniqueOrThrow({ where: { id: post.postId } });
        expect(row.status).toBe('PUBLISHED');
      }
    } finally {
      await Promise.all([a.$disconnect(), b.$disconnect()]);
    }
  });
});

describe('overdueSchedules', () => {
  it('counts a post more than the grace past its time, not one just due', async () => {
    const before = await overdueSchedules(db, 60);
    await scheduledPost(ago(10_000));
    expect(await overdueSchedules(db, 60)).toEqual(before);
    await scheduledPost(ago(5 * 60_000));
    const after = await overdueSchedules(db, 60);
    expect(after.count).toBe(before.count + 1);
    expect(after.oldestSeconds).toBeGreaterThanOrEqual(300);
  });
});
