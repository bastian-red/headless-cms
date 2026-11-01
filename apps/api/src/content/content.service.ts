/**
 * The content API's reads. Every query here goes through
 * `published_revision_id`; nothing selects `head`, so there is no code path
 * by which a draft reaches a client. The integration suite crawls every route
 * for the seed's draft canary and fails if one does.
 */
import { Injectable } from '@nestjs/common';
import { searchPublished } from '@cms/search';
import {
  DomainError,
  readingMinutes,
  type V1Post,
  type V1PostQuery,
  type V1PostSummary,
  type V1SearchQuery,
  type V1SearchResult,
} from '@cms/shared';

import { decodeCursor, page } from '../common/cursor';
import { MarkdownService } from '../infra/markdown.service';
import { PrismaService } from '../infra/prisma.service';

const summarySelect = {
  slug: true,
  publishedAt: true,
  author: { select: { id: true, name: true } },
  published: {
    select: {
      id: true,
      title: true,
      excerpt: true,
      words: true,
      createdAt: true,
      tags: { select: { tag: { select: { slug: true, name: true } } } },
    },
  },
} as const;

interface SummaryRow {
  slug: string;
  publishedAt: Date | null;
  author: { id: string; name: string };
  published: {
    id: string;
    title: string;
    excerpt: string;
    words: number | null;
    createdAt: Date;
    tags: { tag: { slug: string; name: string } }[];
  } | null;
}

export type PostLookup =
  | { readonly kind: 'post'; readonly post: V1Post }
  | { readonly kind: 'moved'; readonly slug: string };

/**
 * Only live posts reach here: both dates exist by posts_published_at_check.
 * `words` is the stored count, or the renderer's for a revision written before
 * the column existed (see `wordsOf`).
 */
function summary(row: SummaryRow, words: number): V1PostSummary {
  const published = row.published!;
  return {
    slug: row.slug,
    title: published.title,
    excerpt: published.excerpt,
    author: row.author,
    tags: published.tags.map((t) => t.tag).sort((a, b) => a.slug.localeCompare(b.slug)),
    publishedAt: row.publishedAt!.toISOString(),
    revisedAt: published.createdAt.toISOString(),
    words,
    readingMinutes: readingMinutes(words),
  };
}

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly markdown: MarkdownService,
  ) {}

  async list(query: V1PostQuery): Promise<{ items: V1PostSummary[]; nextCursor: string | null }> {
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const rows = await this.prisma.client.post.findMany({
      where: {
        publishedRevisionId: { not: null },
        ...(query.author === undefined ? {} : { authorId: query.author }),
        ...(query.tag === undefined
          ? {}
          : { published: { tags: { some: { tag: { slug: query.tag } } } } }),
        ...(after === undefined
          ? {}
          : {
              OR: [
                { publishedAt: { lt: after.at } },
                { publishedAt: after.at, id: { lt: after.id } },
              ],
            }),
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: { id: true, ...summarySelect },
    });
    const result = page(rows, query.limit, (r) => ({ at: r.publishedAt!, id: r.id }));
    const words = await this.wordsOf(result.items);
    return {
      items: result.items.map((row, i) => summary(row, words[i]!)),
      nextCursor: result.nextCursor,
    };
  }

  /**
   * A live post, or where it moved. An address that was public once and is
   * not now is 410 (crawlers drop it); one that never was is 404, and the two
   * never reveal anything about drafts: a never-published post is 404 whether
   * or not it exists.
   */
  async get(slug: string): Promise<PostLookup> {
    const row = await this.prisma.client.post.findUnique({
      where: { slug },
      select: {
        ...summarySelect,
        published: {
          select: {
            ...summarySelect.published.select,
            body: true,
            seoTitle: true,
            seoDescription: true,
          },
        },
      },
    });

    if (row?.published) {
      const rendered = await this.markdown.render(row.published.id, row.published.body);
      return {
        kind: 'post',
        post: {
          ...summary(row, rendered.words),
          revisionId: row.published.id,
          seoTitle: row.published.seoTitle,
          seoDescription: row.published.seoDescription,
          body: row.published.body,
          html: rendered.html,
          outline: rendered.outline,
        },
      };
    }
    if (row !== null) throw row.publishedAt === null ? notFound() : gone();

    const redirect = await this.prisma.client.slugRedirect.findUnique({
      where: { fromSlug: slug },
      select: { post: { select: { slug: true, publishedRevisionId: true, publishedAt: true } } },
    });
    if (redirect === null) throw notFound();
    if (redirect.post.publishedRevisionId !== null)
      return { kind: 'moved', slug: redirect.post.slug };
    throw redirect.post.publishedAt === null ? notFound() : gone();
  }

  /**
   * Full-text search (`@cms/search`), each hit with the same summary fields
   * as `/v1/posts`. A hit is kept only while the post's published revision is
   * still the one that matched: a publish landing between the search and
   * this read would otherwise pair one revision's snippet with another's
   * title, so that hit is left out of the page instead.
   */
  async search(query: V1SearchQuery): Promise<V1SearchResult> {
    const found = await searchPublished(this.prisma.client, {
      query: query.q,
      limit: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });
    const rows = await this.prisma.client.post.findMany({
      where: { id: { in: found.hits.map((h) => h.postId) } },
      select: summarySelect,
    });
    const byRevision = new Map(rows.map((r) => [r.published?.id, r]));
    const matched = found.hits.flatMap((hit) => {
      const row = byRevision.get(hit.revisionId);
      return row === undefined ? [] : [{ row, snippet: hit.snippet }];
    });
    const words = await this.wordsOf(matched.map((m) => m.row));
    const items = matched.map((m, i) => ({ ...summary(m.row, words[i]!), snippet: m.snippet }));
    return { query: found.query, total: found.total, items, nextCursor: found.nextCursor };
  }

  /**
   * Each row's published word count, in order. Stored on every revision
   * written since 20261031140000; an older one is rendered once (the render
   * is cached by revision id, and a revision never changes), so a reader
   * sees the same number on the list and on the page either way.
   */
  private async wordsOf(rows: readonly SummaryRow[]): Promise<number[]> {
    const missing = rows.flatMap((r) =>
      r.published !== null && r.published.words === null ? [r.published.id] : [],
    );
    const counted = new Map<string, number>();
    if (missing.length > 0) {
      const bodies = await this.prisma.client.revision.findMany({
        where: { id: { in: missing } },
        select: { id: true, body: true },
      });
      for (const b of bodies) counted.set(b.id, (await this.markdown.render(b.id, b.body)).words);
    }
    return rows.map((r) => r.published!.words ?? counted.get(r.published!.id)!);
  }

  /** Tags carried by at least one live post's published revision. */
  tags(): Promise<{ slug: string; name: string; description: string | null; posts: number }[]> {
    return this.prisma.client.$queryRaw`
      SELECT t.slug, t.name, t.description, count(DISTINCT p.id)::int AS posts
      FROM tags t
      JOIN revision_tags rt ON rt.tag_id = t.id
      JOIN posts p ON p.published_revision_id = rt.revision_id
      GROUP BY t.id
      ORDER BY t.name`;
  }
}

const notFound = () => new DomainError('NOT_FOUND', 'There is no such post.');
const gone = () => new DomainError('GONE', 'This post has been taken down.');
