/**
 * Posts and revisions, as the studio writes and reads them.
 *
 * **Every write is a transaction that locks the post row first**
 * (`SELECT ... FOR UPDATE`) and then checks the head the client named. Two
 * editors saving from the same base revision therefore serialise on the lock:
 * the first writes revision n+1, the second wakes up, sees the head has moved,
 * and gets 409 with what changed. `revisions_post_id_number_key` would refuse
 * the second revision n+1 anyway; the lock is what turns that refusal into a
 * useful answer instead of a constraint error.
 *
 * The body's render check (a worker thread, up to 2 s) runs BEFORE the
 * transaction, so a slow body never holds a row lock.
 *
 * **Visibility.** An author sees and edits only their own posts. Somebody
 * else's post answers 404, never 403, so an author probing ids cannot tell an
 * unpublished post from one that does not exist (see HTTP_STATUS).
 *
 * **What readers see changes only here, and only with an outbox row in the
 * same transaction**: publish, unpublish, and renaming a live post write a
 * `revalidation_events` row naming every cache tag the change touches. If the
 * transaction rolls back, so does the event; if it commits, the publisher
 * (step 7) will deliver it.
 */
import { Injectable } from '@nestjs/common';
import {
  POST_SLUG_UNIQUE,
  Prisma,
  REVISION_NUMBER_UNIQUE,
  SLUG_REDIRECT_NOT_LIVE,
  isCheckViolation,
  violatedConstraint,
  violatedUniqueIndex,
} from '@cms/db';
import {
  DomainError,
  MIN_SCHEDULE_LEAD_MS,
  SAVE_CANCELS_SCHEDULE,
  WORKFLOW,
  can,
  searchDocument,
  planTransition,
  slugify,
  statusAfterSave,
  tagsForPost,
  type CreatePostInput,
  type PostStatus,
  type RevisionFields,
  type RevisionSummary,
  type RevisionView,
  type SaveRevisionInput,
  type StaleSaveDetails,
  type StudioPost,
  type TransitionInput,
} from '@cms/shared';

import type { ActorRecord } from '../common/actor.guard';
import { decodeCursor, page } from '../common/cursor';
import { MarkdownService } from '../infra/markdown.service';
import { PrismaService } from '../infra/prisma.service';
import { canTouch, seesEveryPost } from './ownership';
import { bodyPatch, changedFields } from './stale';
import {
  postSelect,
  postView,
  revisionSelect,
  revisionView,
  summaryView,
  type PostRow,
  type RevisionRow,
} from './views';

/** What a passing render check hands a revision write. */
interface Rendered {
  readonly text: string;
  readonly words: number;
}

type Tx = Prisma.TransactionClient;

/** The post row as the lock returns it. */
interface Locked {
  id: string;
  slug: string;
  status: PostStatus;
  authorId: string;
  headRevisionId: string | null;
  publishedRevisionId: string | null;
  publishedAt: Date | null;
}

export interface SaveResult {
  readonly post: StudioPost;
  /** False when the save matched the head exactly and no revision was written. */
  readonly created: boolean;
}

const notFound = () => new DomainError('NOT_FOUND', 'There is no such post.');

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly markdown: MarkdownService,
  ) {}

  // --- Reads -----------------------------------------------------------------

  async list(
    actor: ActorRecord,
    query: { status?: PostStatus; cursor?: string; limit: number },
  ): Promise<{ items: ListItem[]; nextCursor: string | null }> {
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const rows = await this.prisma.client.post.findMany({
      where: {
        ...(seesEveryPost(actor) ? {} : { authorId: actor.id }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(after === undefined
          ? {}
          : {
              OR: [{ updatedAt: { lt: after.at } }, { updatedAt: after.at, id: { lt: after.id } }],
            }),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: {
        id: true,
        slug: true,
        status: true,
        publishedRevisionId: true,
        scheduledFor: true,
        updatedAt: true,
        author: { select: { id: true, name: true } },
        head: { select: { title: true } },
      },
    });
    const { items, nextCursor } = page(rows, query.limit, (r) => ({ at: r.updatedAt, id: r.id }));
    return {
      items: items.map((r) => ({
        id: r.id,
        slug: r.slug,
        status: r.status,
        live: r.publishedRevisionId !== null,
        author: r.author,
        title: r.head?.title ?? '',
        scheduledFor: r.scheduledFor?.toISOString() ?? null,
        updatedAt: r.updatedAt.toISOString(),
      })),
      nextCursor,
    };
  }

  async get(actor: ActorRecord, id: string): Promise<StudioPost> {
    return postView(await this.visible(this.prisma.client, actor, id), actor.role);
  }

  async revisions(actor: ActorRecord, id: string): Promise<RevisionSummary[]> {
    const post = await this.visible(this.prisma.client, actor, id);
    const rows = await this.prisma.client.revision.findMany({
      where: { postId: id },
      orderBy: { number: 'desc' },
      select: {
        id: true,
        number: true,
        title: true,
        createdAt: true,
        restoredFromId: true,
        author: { select: { id: true, name: true } },
      },
    });
    return rows.map((row) => summaryView(row, post));
  }

  async revision(actor: ActorRecord, id: string, revisionId: string): Promise<RevisionView> {
    await this.visible(this.prisma.client, actor, id);
    const row = await this.prisma.client.revision.findFirst({
      where: { id: revisionId, postId: id },
      select: revisionSelect,
    });
    if (row === null) throw new DomainError('NOT_FOUND', 'There is no such revision.');
    return revisionView(row);
  }

  // --- Writes ----------------------------------------------------------------

  async create(actor: ActorRecord, input: CreatePostInput): Promise<StudioPost> {
    const slug = input.slug ?? slugify(input.title);
    if (slug === null) {
      throw new DomainError('UNPROCESSABLE', 'That title makes no slug; give the post one.');
    }
    const rendered = await this.assertRenders(input.body);

    const id = await this.write(async (tx) => {
      const tagIds = await resolveTags(tx, input.tags);
      const post = await tx.post.create({
        data: { slug, authorId: actor.id },
        select: { id: true },
      });
      const revision = await tx.revision.create({
        data: {
          postId: post.id,
          number: 1,
          authorId: actor.id,
          ...fieldsOf(input),
          words: rendered.words,
          tags: tagLinks(tagIds),
        },
        select: { id: true },
      });
      await tx.searchDocument.create({
        data: searchDocument(revision.id, { ...input, text: rendered.text }),
      });
      await tx.post.update({ where: { id: post.id }, data: { headRevisionId: revision.id } });
      return post.id;
    });
    return this.get(actor, id);
  }

  async save(actor: ActorRecord, id: string, input: SaveRevisionInput): Promise<SaveResult> {
    // Visible at all, before spending a render on it.
    await this.visible(this.prisma.client, actor, id);
    const rendered = await this.assertRenders(input.body);
    return this.writeRevision(actor, id, input.baseRevisionId, input, rendered, null);
  }

  async restore(
    actor: ActorRecord,
    id: string,
    sourceId: string,
    baseRevisionId: string,
  ): Promise<SaveResult> {
    await this.visible(this.prisma.client, actor, id);
    const source = await this.prisma.client.revision.findFirst({
      where: { id: sourceId, postId: id },
      select: revisionSelect,
    });
    if (source === null) throw new DomainError('NOT_FOUND', 'There is no such revision.');
    const fields: RevisionFields = { ...comparable(source) };
    const rendered = await this.assertRenders(fields.body);
    return this.writeRevision(actor, id, baseRevisionId, fields, rendered, source.id);
  }

  async rename(actor: ActorRecord, id: string, slug: string): Promise<StudioPost> {
    await this.write(async (tx) => {
      const post = await this.lockVisible(tx, actor, id);
      if (post.slug === slug) return;
      // A post that was ever public has readers' links to it. Moving those is
      // an editor's decision, and it leaves a redirect behind.
      const everPublic = post.publishedAt !== null;
      if (everPublic && !can(actor.role, 'post.publish')) {
        throw new DomainError(
          'FORBIDDEN',
          'Only an editor can rename a post that has been published.',
        );
      }
      // Renaming back to one of this post's own old slugs: that redirect goes.
      await tx.slugRedirect.deleteMany({ where: { fromSlug: slug, postId: id } });
      await tx.post.update({ where: { id }, data: { slug } });
      if (everPublic) {
        await tx.slugRedirect.create({ data: { fromSlug: post.slug, postId: id } });
      }
      if (post.publishedRevisionId !== null) {
        const tagSlugs = await this.tagSlugs(tx, [post.publishedRevisionId]);
        await outbox(tx, { slugs: [post.slug, slug], tagSlugs, authorId: post.authorId });
      }
    });
    return this.get(actor, id);
  }

  async transition(actor: ActorRecord, id: string, input: TransitionInput): Promise<StudioPost> {
    const rule = WORKFLOW[input.action];
    await this.write(async (tx) => {
      const post = await this.lockVisible(tx, actor, id);
      if (!can(actor.role, rule.requires)) {
        throw new DomainError('FORBIDDEN', 'Your role does not allow that.');
      }
      if (post.headRevisionId !== input.revisionId) {
        throw new DomainError(
          'CONFLICT',
          'The post changed since you looked at it. Review the latest revision first.',
          { headRevisionId: post.headRevisionId },
        );
      }
      const decision = planTransition(input.action, {
        status: post.status,
        live: post.publishedRevisionId !== null,
      });
      if (!decision.ok) throw new DomainError('UNPROCESSABLE', decision.reason);
      const { plan } = decision;

      let scheduledFor: Date | null = null;
      if (input.action === 'schedule') {
        scheduledFor = new Date(input.scheduledFor);
        if (scheduledFor.getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS) {
          throw new DomainError('UNPROCESSABLE', 'Schedule at least a minute ahead.');
        }
      }
      if (input.action === 'publish' || input.action === 'schedule') {
        const head = await tx.revision.findUniqueOrThrow({
          where: { id: input.revisionId },
          select: { excerpt: true },
        });
        if (head.excerpt.trim() === '') {
          throw new DomainError(
            'UNPROCESSABLE',
            'Add an excerpt before publishing: it is the description search engines and feeds show.',
          );
        }
      }

      const published =
        plan.published === 'head'
          ? input.revisionId
          : plan.published === 'clear'
            ? null
            : post.publishedRevisionId;
      await tx.post.update({
        where: { id },
        data: {
          status: plan.status,
          publishedRevisionId: published,
          // The first time a post goes live it gets its date, and keeps it.
          publishedAt:
            plan.published === 'head' ? (post.publishedAt ?? new Date()) : post.publishedAt,
          scheduledFor: plan.scheduledFor === 'set' ? scheduledFor : null,
        },
      });

      if (published !== post.publishedRevisionId) {
        const revisions = [post.publishedRevisionId, published].filter(
          (r): r is string => r !== null,
        );
        await outbox(tx, {
          slugs: [post.slug],
          tagSlugs: await this.tagSlugs(tx, revisions),
          authorId: post.authorId,
        });
      }
    });
    return this.get(actor, id);
  }

  // --- Internals ---------------------------------------------------------------

  private async writeRevision(
    actor: ActorRecord,
    id: string,
    baseRevisionId: string,
    fields: RevisionFields,
    /** The body's reader-visible text and word count, from the render check that passed it. */
    rendered: Rendered,
    restoredFromId: string | null,
  ): Promise<SaveResult> {
    const created = await this.write(async (tx) => {
      const post = await this.lockVisible(tx, actor, id);
      if (post.status === 'SCHEDULED' && !can(actor.role, SAVE_CANCELS_SCHEDULE)) {
        throw new DomainError(
          'FORBIDDEN',
          'This post is scheduled. Ask an editor to unschedule it before editing.',
        );
      }
      const head = await tx.revision.findUniqueOrThrow({
        where: { id: post.headRevisionId ?? '' },
        select: revisionSelect,
      });
      if (head.id !== baseRevisionId) {
        throw await this.stale(tx, id, baseRevisionId, head, post);
      }
      // An autosave of unchanged text writes nothing.
      if (
        restoredFromId === null &&
        changedFields(comparable(head), comparable(fields)).length === 0
      ) {
        return false;
      }

      const tagIds = await resolveTags(tx, fields.tags);
      const revision = await tx.revision.create({
        data: {
          postId: id,
          number: head.number + 1,
          parentRevisionId: head.id,
          restoredFromId,
          authorId: actor.id,
          ...fieldsOf(fields),
          words: rendered.words,
          tags: tagLinks(tagIds),
        },
        select: { id: true },
      });
      // In the same transaction: a revision never exists without the text
      // search will find it by once it is published.
      await tx.searchDocument.create({
        data: searchDocument(revision.id, { ...fields, text: rendered.text }),
      });
      const status = statusAfterSave(post.status);
      await tx.post.update({
        where: { id },
        // A save never leaves a post scheduled (statusAfterSave), so its time goes.
        data: { headRevisionId: revision.id, status, scheduledFor: null },
      });
      return true;
    });
    return { post: await this.get(actor, id), created };
  }

  private async stale(
    tx: Tx,
    postId: string,
    baseRevisionId: string,
    head: RevisionRow,
    post: Locked,
  ): Promise<DomainError> {
    const base = await tx.revision.findFirst({
      where: { id: baseRevisionId, postId },
      select: revisionSelect,
    });
    if (base === null) {
      return new DomainError('UNPROCESSABLE', "That base revision is not one of this post's.");
    }
    const details: StaleSaveDetails = {
      baseRevisionId,
      current: summaryView(head, post),
      changed: changedFields(comparable(base), comparable(head)),
      bodyPatch: bodyPatch(base.body, head.body),
    };
    return new DomainError(
      'CONFLICT',
      `${head.author.name} saved revision ${String(head.number)} since you started. Your text is still in your editor.`,
      details,
    );
  }

  /** The body's reader-visible text and words, or a 422 if it does not render in time. */
  private async assertRenders(body: string): Promise<Rendered> {
    const result = await this.markdown.check(body);
    if (result.ok) return { text: result.text, words: result.words };
    throw new DomainError(
      'UNPROCESSABLE',
      result.reason === 'timeout'
        ? 'This body takes too long to render. Look for very deep nesting or long runs of * and _.'
        : 'This body could not be rendered safely.',
      { render: result.reason },
    );
  }

  /** The post with its head, or 404 if it does not exist or `actor` may not see it. */
  private async visible(client: Tx, actor: ActorRecord, id: string): Promise<PostRow> {
    const row = await client.post.findUnique({ where: { id }, select: postSelect });
    if (row === null || !canTouch(actor, row.authorId)) throw notFound();
    return row;
  }

  private async lockVisible(tx: Tx, actor: ActorRecord, id: string): Promise<Locked> {
    const rows = await tx.$queryRaw<Locked[]>`
      SELECT id, slug, status::text AS status, author_id AS "authorId",
             head_revision_id AS "headRevisionId", published_revision_id AS "publishedRevisionId",
             published_at AS "publishedAt"
      FROM posts WHERE id = ${id} FOR UPDATE`;
    const post = rows[0];
    if (post === undefined || !canTouch(actor, post.authorId)) throw notFound();
    return post;
  }

  private async tagSlugs(tx: Tx, revisionIds: readonly string[]): Promise<string[]> {
    const rows = await tx.revisionTag.findMany({
      where: { revisionId: { in: [...revisionIds] } },
      select: { tag: { select: { slug: true } } },
    });
    return rows.map((r) => r.tag.slug);
  }

  /** A transaction whose constraint refusals come back as domain answers. */
  private async write<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.client.$transaction(work, { timeout: 15_000 });
    } catch (error) {
      if (violatedUniqueIndex(error, POST_SLUG_UNIQUE)) {
        throw new DomainError('CONFLICT', 'Another post already uses that slug.');
      }
      if (isCheckViolation(error) && violatedConstraint(error, SLUG_REDIRECT_NOT_LIVE)) {
        throw new DomainError('CONFLICT', 'That slug redirects to another post.');
      }
      if (violatedUniqueIndex(error, REVISION_NUMBER_UNIQUE)) {
        // Unreachable while the row lock holds; kept so a refactor that drops
        // the lock degrades to a 409, not a 500.
        throw new DomainError(
          'CONFLICT',
          'Somebody saved at the same moment. Reload and try again.',
        );
      }
      throw error;
    }
  }
}

type ListItem = {
  id: string;
  slug: string;
  status: PostStatus;
  live: boolean;
  author: { id: string; name: string };
  title: string;
  scheduledFor: string | null;
  updatedAt: string;
};

function comparable(row: {
  title: string;
  excerpt: string;
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
  tags: readonly string[] | { tag: { slug: string } }[];
}): RevisionFields {
  const tags = row.tags.map((t) => (typeof t === 'string' ? t : t.tag.slug)).sort();
  return {
    title: row.title,
    excerpt: row.excerpt,
    body: row.body,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    tags,
  };
}

function fieldsOf(input: RevisionFields) {
  return {
    title: input.title,
    excerpt: input.excerpt,
    body: input.body,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
  };
}

const tagLinks = (tagIds: readonly string[]) => ({ create: tagIds.map((tagId) => ({ tagId })) });

/** Tag ids for slugs, or 422 naming the ones that do not exist. */
async function resolveTags(tx: Tx, slugs: readonly string[]): Promise<string[]> {
  if (slugs.length === 0) return [];
  const rows = await tx.tag.findMany({
    where: { slug: { in: [...slugs] } },
    select: { id: true, slug: true },
  });
  const known = new Set(rows.map((r) => r.slug));
  const unknown = slugs.filter((slug) => !known.has(slug));
  if (unknown.length > 0) {
    throw new DomainError('UNPROCESSABLE', 'Some tags do not exist yet.', { unknownTags: unknown });
  }
  return rows.map((r) => r.id);
}

async function outbox(
  tx: Tx,
  input: { slugs: readonly string[]; tagSlugs: readonly string[]; authorId: string },
): Promise<void> {
  await tx.revalidationEvent.create({ data: { tags: tagsForPost(input) } });
}
