/**
 * Rows to the studio's contract shapes, and the Prisma selects that feed them.
 * One place, so a field added to a contract is added to its select here.
 */
import {
  WORKFLOW,
  availableTransitions,
  can,
  type RevisionSummary,
  type RevisionView,
  type Role,
  type StudioPost,
} from '@cms/shared';

export const personSelect = { select: { id: true, name: true } } as const;

export const revisionSelect = {
  id: true,
  number: true,
  parentRevisionId: true,
  restoredFromId: true,
  title: true,
  excerpt: true,
  body: true,
  seoTitle: true,
  seoDescription: true,
  createdAt: true,
  author: personSelect,
  tags: { select: { tag: { select: { slug: true, name: true } } } },
} as const;

export interface RevisionRow {
  id: string;
  number: number;
  parentRevisionId: string | null;
  restoredFromId: string | null;
  title: string;
  excerpt: string;
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: Date;
  author: { id: string; name: string };
  tags: { tag: { slug: string; name: string } }[];
}

export const postSelect = {
  id: true,
  slug: true,
  status: true,
  authorId: true,
  headRevisionId: true,
  publishedRevisionId: true,
  publishedAt: true,
  scheduledFor: true,
  createdAt: true,
  updatedAt: true,
  author: personSelect,
  head: { select: revisionSelect },
} as const;

export interface PostRow {
  id: string;
  slug: string;
  status: StudioPost['status'];
  authorId: string;
  headRevisionId: string | null;
  publishedRevisionId: string | null;
  publishedAt: Date | null;
  scheduledFor: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; name: string };
  head: RevisionRow | null;
}

export const tagSlugsOf = (row: Pick<RevisionRow, 'tags'>): string[] =>
  row.tags.map((t) => t.tag.slug).sort();

export function revisionView(row: RevisionRow): RevisionView {
  return {
    id: row.id,
    number: row.number,
    parentRevisionId: row.parentRevisionId,
    restoredFromId: row.restoredFromId,
    author: row.author,
    title: row.title,
    excerpt: row.excerpt,
    body: row.body,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    tags: row.tags.map((t) => t.tag).sort((a, b) => a.slug.localeCompare(b.slug)),
    createdAt: row.createdAt.toISOString(),
  };
}

export function summaryView(
  row: Pick<RevisionRow, 'id' | 'number' | 'author' | 'title' | 'createdAt' | 'restoredFromId'>,
  post: Pick<PostRow, 'headRevisionId' | 'publishedRevisionId'>,
): RevisionSummary {
  return {
    id: row.id,
    number: row.number,
    author: row.author,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    restoredFromId: row.restoredFromId,
    isHead: row.id === post.headRevisionId,
    isPublished: row.id === post.publishedRevisionId,
  };
}

/** The post as the studio shows it to `role`: only the transitions that role may make. */
export function postView(row: PostRow, role: Role): StudioPost {
  if (row.head === null || row.headRevisionId === null) {
    // posts_pending_state_check allows a null head only inside the creating
    // transaction; the seed check asserts none is left. Seeing one is a bug.
    throw new Error(`post ${row.id} has no head revision`);
  }
  const state = { status: row.status, live: row.publishedRevisionId !== null };
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    live: state.live,
    author: row.author,
    headRevisionId: row.headRevisionId,
    publishedRevisionId: row.publishedRevisionId,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    head: revisionView(row.head),
    transitions: availableTransitions(state).filter((t) => can(role, WORKFLOW[t].requires)),
  };
}
