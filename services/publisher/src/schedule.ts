/**
 * Scheduled publishing: the posts table is the schedule.
 *
 * The API commits a schedule as `status = SCHEDULED` plus `scheduled_for`, in
 * the same transaction as everything else about the post, and a save cancels
 * it the same way. So nothing outside Postgres has to agree with Postgres:
 * there is no job to enqueue, move or forget. Every tick this finds the due
 * posts and publishes them in one transaction together with their
 * revalidation event, so a published post without its event (or the
 * reverse) cannot exist.
 *
 * **Exactly once, with any number of publishers.** The due rows are taken
 * `FOR UPDATE SKIP LOCKED`: a second publisher skips a row the first holds
 * instead of waiting for it, and once the first commits, the row is no
 * longer `SCHEDULED`, so nobody selects it again. The UPDATE also repeats
 * `status = 'SCHEDULED'`, which READ COMMITTED re-checks against the
 * committed row, so even a reader that got past the lock would update nothing.
 *
 * What goes live is the head revision. That is the one the editor scheduled:
 * a save after scheduling cancels the schedule (`statusAfterSave`), and the
 * excerpt check ran when it was scheduled. The posts' CHECK constraints hold
 * the rest (published means published = head).
 *
 * `published_at` is the scheduled time, not the tick that noticed it, so the
 * date readers see is the one the editor chose, and a post first published
 * earlier keeps its original date.
 */
import type { PrismaClient } from '@cms/db';
import { tagsForPost } from '@cms/shared';

export interface PublishedPost {
  readonly postId: string;
  readonly slug: string;
  readonly revisionId: string;
  readonly scheduledFor: Date;
  readonly tags: readonly string[];
}

interface DueRow {
  id: string;
  slug: string;
  authorId: string;
  head: string;
  was: string | null;
  scheduledFor: Date;
}

export async function publishDue(
  prisma: PrismaClient,
  { limit = 20 }: { limit?: number } = {},
): Promise<PublishedPost[]> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<DueRow[]>`
      WITH due AS (
        SELECT id, published_revision_id AS was, scheduled_for
        FROM posts
        WHERE status = 'SCHEDULED' AND scheduled_for <= now()
        ORDER BY scheduled_for, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE posts AS p
      SET status = 'PUBLISHED',
          published_revision_id = p.head_revision_id,
          published_at = COALESCE(p.published_at, due.scheduled_for),
          scheduled_for = NULL,
          updated_at = now()
      FROM due
      WHERE p.id = due.id AND p.status = 'SCHEDULED'
      RETURNING p.id, p.slug, p.author_id AS "authorId", p.head_revision_id AS head,
                due.was, due.scheduled_for AS "scheduledFor"`;

    const published: PublishedPost[] = [];
    for (const row of rows) {
      // The tags of what readers saw and of what they will see: a tag the
      // post leaves still lists it until its page is revalidated.
      const links = await tx.revisionTag.findMany({
        where: { revisionId: { in: [row.head, ...(row.was === null ? [] : [row.was])] } },
        select: { tag: { select: { slug: true } } },
      });
      const tags = tagsForPost({
        slugs: [row.slug],
        tagSlugs: links.map((link) => link.tag.slug),
        authorId: row.authorId,
      });
      await tx.revalidationEvent.create({ data: { tags } });
      published.push({
        postId: row.id,
        slug: row.slug,
        revisionId: row.head,
        scheduledFor: row.scheduledFor,
        tags,
      });
    }
    return published;
  });
}

/** Scheduled posts more than `graceSeconds` past their time: a publisher that is not keeping up. */
export async function overdueSchedules(
  prisma: PrismaClient,
  graceSeconds = 60,
): Promise<{ count: number; oldestSeconds: number | null }> {
  const [row] = await prisma.$queryRaw<{ count: number; oldest: number | null }[]>`
    SELECT count(*)::int AS count,
           floor(extract(epoch FROM now() - min(scheduled_for)))::int AS oldest
    FROM posts
    WHERE status = 'SCHEDULED' AND scheduled_for < now() - make_interval(secs => ${graceSeconds})`;
  return { count: row?.count ?? 0, oldestSeconds: row?.oldest ?? null };
}
