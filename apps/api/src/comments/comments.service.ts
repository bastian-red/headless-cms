/**
 * Readers' comments: submitted anonymously, shown only once an editor approves.
 *
 * - **Moderated first.** A submission is stored `PENDING`. The public read
 *   (`approved`) selects `status = 'APPROVED'` on a live post and nothing else,
 *   so a pending, rejected or spam comment has no query to travel in.
 * - **The honeypot answers like a success and stores nothing**, so a bot that
 *   fills every field learns nothing from the reply. The decision is logged.
 * - **No address is stored.** `ip_hash` is `addressHash` (HMAC under
 *   AUTH_SECRET), which groups a flood from one source in the moderation queue
 *   without anyone seeing where it came from.
 * - **A decision names the state the moderator saw** (`from`). The UPDATE
 *   repeats it in its WHERE, so of two editors deciding at once exactly one
 *   lands and the other gets 409 with the state it is in now.
 * - **A decision that changes what readers see writes its revalidation event
 *   in the same transaction** (`comments:<slug>`), as a publish does, and the
 *   publisher delivers it.
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  changesWhatReadersSee,
  commentsTag,
  COMMENT_HONEYPOT_FIELD,
  DomainError,
  type CommentStatus,
  type ModerateCommentInput,
  type ModerationQuery,
  type StudioComment,
  type SubmitCommentInput,
  type V1Comment,
  type V1CommentQuery,
} from '@cms/shared';
import { addressHash } from '@cms/shared/server';

import type { ActorRecord } from '../common/actor.guard';
import { decodeCursor, page } from '../common/cursor';
import { API_CONFIG, type ApiConfig } from '../config/config';
import { PrismaService } from '../infra/prisma.service';

const log = (event: string, data: Record<string, unknown>) =>
  console.info(JSON.stringify({ event, ...data }));

const studioSelect = {
  id: true,
  name: true,
  body: true,
  status: true,
  ipHash: true,
  createdAt: true,
  moderatedAt: true,
  moderatedBy: { select: { id: true, name: true } },
  post: {
    select: {
      id: true,
      slug: true,
      publishedRevisionId: true,
      head: { select: { title: true } },
      published: { select: { title: true } },
    },
  },
} as const;

interface StudioRow {
  id: string;
  name: string;
  body: string;
  status: CommentStatus;
  ipHash: string;
  createdAt: Date;
  moderatedAt: Date | null;
  moderatedBy: { id: string; name: string } | null;
  post: {
    id: string;
    slug: string;
    publishedRevisionId: string | null;
    head: { title: string } | null;
    published: { title: string } | null;
  };
}

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  /** A reader's submission. Resolves the same way for a real one and a honeypot hit. */
  async submit(input: SubmitCommentInput, address: string): Promise<{ status: 'PENDING' }> {
    const post = await this.prisma.client.post.findFirst({
      where: { slug: input.postSlug, publishedRevisionId: { not: null } },
      select: { id: true },
    });
    // A post nobody can read takes no comments; same answer as one that never existed.
    if (post === null) throw new DomainError('NOT_FOUND', 'There is no such post to comment on.');

    const honeypot = input[COMMENT_HONEYPOT_FIELD];
    if (honeypot !== undefined && honeypot.trim() !== '') {
      log('comment_discarded', { reason: 'honeypot', postId: post.id });
      return { status: 'PENDING' };
    }

    const comment = await this.prisma.client.comment.create({
      data: {
        postId: post.id,
        name: input.name,
        body: input.body,
        ipHash: addressHash(this.config.authSecret, address),
      },
      select: { id: true },
    });
    log('comment_received', { commentId: comment.id, postId: post.id });
    return { status: 'PENDING' };
  }

  /** The public block: approved comments on a live post, oldest first. */
  async approved(
    slug: string,
    query: V1CommentQuery,
  ): Promise<{ items: V1Comment[]; nextCursor: string | null }> {
    const post = await this.prisma.client.post.findFirst({
      where: { slug, publishedRevisionId: { not: null } },
      select: { id: true },
    });
    if (post === null) throw new DomainError('NOT_FOUND', 'No live post has this address.');
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const rows = await this.prisma.client.comment.findMany({
      where: {
        postId: post.id,
        status: 'APPROVED',
        ...(after === undefined
          ? {}
          : {
              OR: [{ createdAt: { gt: after.at } }, { createdAt: after.at, id: { gt: after.id } }],
            }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: { id: true, name: true, body: true, createdAt: true },
    });
    const result = page(rows, query.limit, (row) => ({ at: row.createdAt, id: row.id }));
    return {
      items: result.items.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      nextCursor: result.nextCursor,
    };
  }

  /**
   * The moderation queue. Pending comments oldest first (the one that has
   * waited longest is on top); decided ones newest first.
   */
  async queue(
    query: ModerationQuery,
  ): Promise<{ items: StudioComment[]; nextCursor: string | null }> {
    const ascending = query.status === 'PENDING';
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const beyond = ascending ? 'gt' : 'lt';
    const rows = (await this.prisma.client.comment.findMany({
      where: {
        status: query.status,
        ...(after === undefined
          ? {}
          : {
              OR: [
                { createdAt: { [beyond]: after.at } },
                { createdAt: after.at, id: { [beyond]: after.id } },
              ],
            }),
      },
      orderBy: ascending
        ? [{ createdAt: 'asc' }, { id: 'asc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: studioSelect,
    })) as StudioRow[];
    const result = page(rows, query.limit, (row) => ({ at: row.createdAt, id: row.id }));
    const counts = await this.pendingBySource(
      result.items.filter((row) => row.status === 'PENDING').map((row) => row.ipHash),
    );
    return {
      items: result.items.map((row) => this.studio(row, counts)),
      nextCursor: result.nextCursor,
    };
  }

  async decide(
    id: string,
    input: ModerateCommentInput,
    actor: ActorRecord,
  ): Promise<StudioComment> {
    const row = await this.prisma.client.$transaction(async (tx) => {
      // The state the moderator saw is part of the WHERE: under READ COMMITTED
      // a second UPDATE waiting on this row re-checks it after the first
      // commits, finds the new status, and matches nothing.
      const updated = await tx.$queryRaw<{ post_id: string }[]>`
        UPDATE comments
        SET status = ${input.to}::"CommentStatus", moderated_at = now(), moderated_by_id = ${actor.id}
        WHERE id = ${id} AND status = ${input.from}::"CommentStatus"
        RETURNING post_id`;
      if (updated.length === 0) {
        const current = await tx.comment.findUnique({ where: { id }, select: { status: true } });
        if (current === null) throw new DomainError('NOT_FOUND', 'There is no such comment.');
        throw new DomainError(
          'CONFLICT',
          `Somebody decided first: this comment is ${current.status.toLowerCase()} now.`,
          { status: current.status },
        );
      }
      const post = await tx.post.findUniqueOrThrow({
        where: { id: updated[0]!.post_id },
        select: { slug: true, publishedRevisionId: true },
      });
      // A post nobody can read has no comments block to refresh.
      if (changesWhatReadersSee(input.from, input.to) && post.publishedRevisionId !== null) {
        await tx.revalidationEvent.create({ data: { tags: [commentsTag(post.slug)] } });
      }
      return tx.comment.findUniqueOrThrow({ where: { id }, select: studioSelect });
    });
    log('comment_moderated', { commentId: id, from: input.from, to: input.to, by: actor.id });
    const counts = await this.pendingBySource(row.status === 'PENDING' ? [row.ipHash] : []);
    return this.studio(row as StudioRow, counts);
  }

  private async pendingBySource(hashes: readonly string[]): Promise<Map<string, number>> {
    if (hashes.length === 0) return new Map();
    const groups = await this.prisma.client.comment.groupBy({
      by: ['ipHash'],
      where: { status: 'PENDING', ipHash: { in: [...new Set(hashes)] } },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.ipHash, g._count._all]));
  }

  private studio(row: StudioRow, counts: ReadonlyMap<string, number>): StudioComment {
    return {
      id: row.id,
      name: row.name,
      body: row.body,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      moderatedAt: row.moderatedAt?.toISOString() ?? null,
      moderatedBy: row.moderatedBy,
      post: {
        id: row.post.id,
        slug: row.post.slug,
        title: row.post.published?.title ?? row.post.head?.title ?? row.post.slug,
        live: row.post.publishedRevisionId !== null,
      },
      pendingFromSameSource: row.status === 'PENDING' ? (counts.get(row.ipHash) ?? 1) : null,
    };
  }
}
