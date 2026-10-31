/**
 * The demo newsroom: three people, ten tags and forty posts in every workflow
 * state, with their revision history, redirects and comments.
 *
 * The content itself is `prisma/content/catalog.ts` plus one markdown file per
 * post; this file only writes it. Four properties, each with the mechanism
 * that holds it (`scripts/seed-check.sh` proves the first two and the last):
 *
 * 1. **Deterministic.** Every id is derived from a stable key (a slug, a tag,
 *    a comment's author and time) and every date comes from the catalog, so
 *    two runs write identical rows. The one exception is the scheduled post,
 *    whose time is a week from now, because a schedule in the past is not a
 *    schedule.
 * 2. **Idempotent, touching only its own rows.** People are upserted by email
 *    and tags by id. Seeded posts are deleted and rewritten in one transaction
 *    (their revisions, tags, redirects and comments go with them by cascade,
 *    the only way the database lets a revision be deleted). A post written in
 *    the studio is never touched.
 * 3. **Written the way the API will write it.** A post is inserted without a
 *    head, its revisions follow in order (each with its search document,
 *    from the same `searchDocument` the API uses), then the pointers and the
 *    status are set. Every CHECK, same-post key and trigger in the migrations
 *    runs on this data, so a seed that violates the content model cannot load.
 * 4. **Nothing unpublished is public.** Text in drafts, pending revisions,
 *    scheduled and unpublished posts and unmoderated comments carries a canary
 *    word (catalog.ts). The seed check fails if any public row contains it.
 *
 * The client comes from this package's own source, not from `@cms/db`: a
 * package importing itself resolves to its `dist/`, which a clean checkout has
 * not built (turbo's `^build` covers dependencies, never the package itself).
 *
 * `scripts/dev-smoke.sh` and the E2E suite `sed` the `const NAME = '...'`
 * lines below. One line each, single quotes, no template literals. These are
 * local accounts for a local database, published on purpose so the README's
 * sign-in and `scripts/dev-smoke.sh` work on a fresh clone.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render } from '@cms/markdown';
import { searchDocument } from '@cms/shared';
import { hashPassword } from '@cms/shared/server';

import { createPrismaClient, type PrismaClient } from '../src/client.ts';
import { POSTS, TAGS, type Person, type PostSeed } from './content/catalog.ts';

const ADMIN_EMAIL = 'ines@quire.test';
const ADMIN_PASSWORD = 'admin-password-2026';
const ADMIN_NAME = 'Ines Achterberg';
const EDITOR_EMAIL = 'tomas@quire.test';
const EDITOR_PASSWORD = 'editor-password-2026';
const EDITOR_NAME = 'Tomas Wexford';
const AUTHOR_EMAIL = 'mara@quire.test';
const AUTHOR_PASSWORD = 'author-password-2026';
const AUTHOR_NAME = 'Mara Lindgren';

const PEOPLE = {
  ines: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: ADMIN_NAME, role: 'ADMIN' },
  tomas: { email: EDITOR_EMAIL, password: EDITOR_PASSWORD, name: EDITOR_NAME, role: 'EDITOR' },
  mara: { email: AUTHOR_EMAIL, password: AUTHOR_PASSWORD, name: AUTHOR_NAME, role: 'AUTHOR' },
} as const satisfies Record<Person, unknown>;

const POSTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'content', 'posts');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A cuid-shaped id (lowercase, 25 characters) derived from a stable key. */
function seedId(kind: string, key: string): string {
  return `c${createHash('sha256').update(`${kind}:${key}`).digest('hex').slice(0, 24)}`;
}

/** The body without its last `count` `##` sections: an earlier draft. */
function trimSections(body: string, count: number): string {
  const sections = body.split(/\n(?=## )/u);
  return (
    sections
      .slice(0, Math.max(1, sections.length - count))
      .join('\n')
      .trimEnd() + '\n'
  );
}

function body(slug: string, variant: '' | '.draft' = ''): string {
  return readFileSync(join(POSTS_DIR, `${slug}${variant}.md`), 'utf8');
}

interface RevisionPlan {
  title: string;
  excerpt: string;
  body: string;
  tags: readonly string[];
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: Date;
}

/** Every revision the post has, oldest first, and which one is live. */
function plan(post: PostSeed): { revisions: RevisionPlan[]; publishedIndex: number | null } {
  const date = new Date(post.date);
  const current = body(post.slug);
  const history = post.history ?? [];
  const revisions: RevisionPlan[] = history.map((earlier, i) => ({
    title: earlier.title,
    excerpt: post.excerpt,
    body: trimSections(current, earlier.trimSections),
    tags: post.tags,
    seoTitle: null,
    seoDescription: null,
    createdAt: new Date(date.getTime() - (history.length - i) * DAY),
  }));
  revisions.push({
    title: post.title,
    excerpt: post.excerpt,
    body: current,
    tags: post.tags,
    seoTitle: post.seoTitle ?? null,
    seoDescription: post.seoDescription ?? null,
    createdAt: new Date(date.getTime() - HOUR),
  });

  if (post.state === 'live-with-draft') {
    if (post.draft === undefined) throw new Error(`${post.slug}: live-with-draft needs a draft`);
    revisions.push({
      title: post.draft.title,
      excerpt: post.draft.excerpt,
      body: body(post.slug, '.draft'),
      tags: post.draft.tags,
      seoTitle: null,
      seoDescription: post.draft.seoDescription ?? null,
      createdAt: new Date(date.getTime() + 30 * DAY),
    });
    return { revisions, publishedIndex: revisions.length - 2 };
  }
  return { revisions, publishedIndex: post.state === 'live' ? revisions.length - 1 : null };
}

/** The next whole UTC hour, a week from now. */
function nextWeek(): Date {
  const at = new Date(Date.now() + 7 * DAY);
  at.setUTCMinutes(0, 0, 0);
  return new Date(at.getTime() + HOUR);
}

const STATUS = {
  live: 'PUBLISHED',
  'live-with-draft': 'DRAFT',
  draft: 'DRAFT',
  'in-review': 'IN_REVIEW',
  scheduled: 'SCHEDULED',
  unpublished: 'UNPUBLISHED',
} as const satisfies Record<PostSeed['state'], string>;

async function seedPeople(prisma: PrismaClient): Promise<Record<Person, string>> {
  const ids = {} as Record<Person, string>;
  for (const [key, person] of Object.entries(PEOPLE) as [Person, (typeof PEOPLE)[Person]][]) {
    const data = {
      name: person.name,
      role: person.role,
      passwordHash: hashPassword(person.password),
    };
    const row = await prisma.user.upsert({
      where: { email: person.email },
      create: { email: person.email, ...data },
      update: data,
    });
    ids[key] = row.id;
  }
  return ids;
}

async function seedContent(prisma: PrismaClient, people: Record<Person, string>): Promise<void> {
  const tagId = (slug: string) => seedId('tag', slug);
  const scheduledFor = nextWeek();

  await prisma.$transaction(
    async (tx) => {
      await tx.post.deleteMany({ where: { id: { in: POSTS.map((p) => seedId('post', p.slug)) } } });

      for (const tag of TAGS) {
        const data = { slug: tag.slug, name: tag.name, description: tag.description };
        await tx.tag.upsert({
          where: { id: tagId(tag.slug) },
          create: { id: tagId(tag.slug), ...data },
          update: data,
        });
      }

      for (const post of POSTS) {
        const postId = seedId('post', post.slug);
        const authorId = people[post.author];
        const { revisions, publishedIndex } = plan(post);
        const ids = revisions.map((_, i) => seedId('revision', `${post.slug}#${String(i + 1)}`));

        await tx.post.create({
          data: { id: postId, slug: post.slug, authorId, createdAt: revisions[0]!.createdAt },
        });
        for (const [i, revision] of revisions.entries()) {
          await tx.revision.create({
            data: {
              id: ids[i]!,
              postId,
              number: i + 1,
              parentRevisionId: i === 0 ? null : ids[i - 1]!,
              authorId,
              title: revision.title,
              excerpt: revision.excerpt,
              body: revision.body,
              seoTitle: revision.seoTitle,
              seoDescription: revision.seoDescription,
              createdAt: revision.createdAt,
              tags: { create: revision.tags.map((slug) => ({ tagId: tagId(slug) })) },
            },
          });
          // As the API does on every save: the reader-visible text, indexed.
          // In-process here: these bodies are the renderer's own test corpus.
          await tx.searchDocument.create({
            data: {
              ...searchDocument(ids[i]!, { ...revision, text: render(revision.body).text }),
              createdAt: revision.createdAt,
            },
          });
        }

        const live = publishedIndex === null ? null : ids[publishedIndex]!;
        await tx.post.update({
          where: { id: postId },
          data: {
            status: STATUS[post.state],
            headRevisionId: ids.at(-1)!,
            publishedRevisionId: live,
            // Unpublished posts keep the date they first went live.
            publishedAt: live !== null || post.state === 'unpublished' ? new Date(post.date) : null,
            scheduledFor: post.state === 'scheduled' ? scheduledFor : null,
            updatedAt: revisions.at(-1)!.createdAt,
          },
        });

        for (const fromSlug of post.formerSlugs ?? []) {
          await tx.slugRedirect.create({
            data: { fromSlug, postId, createdAt: new Date(post.date) },
          });
        }

        for (const comment of post.comments ?? []) {
          const at = new Date(comment.at);
          const decided = comment.status !== 'PENDING';
          await tx.comment.create({
            data: {
              id: seedId('comment', `${post.slug}#${comment.name}#${comment.at}`),
              postId,
              name: comment.name,
              body: comment.body,
              status: comment.status,
              // A keyed hash in production; any 64 hex characters here.
              ipHash: createHash('sha256').update(`seed-address:${comment.name}`).digest('hex'),
              createdAt: at,
              moderatedAt: decided ? new Date(at.getTime() + 2 * HOUR) : null,
              moderatedById: decided ? people.tomas : null,
            },
          });
        }
      }
    },
    { timeout: 60_000 },
  );
}

const prisma = createPrismaClient();
try {
  const people = await seedPeople(prisma);
  await seedContent(prisma, people);
  const live = POSTS.filter((p) => p.state === 'live' || p.state === 'live-with-draft').length;
  console.info(
    `seed: 3 people (admin, editor, author), ${String(TAGS.length)} tags, ` +
      `${String(POSTS.length)} posts (${String(live)} live)`,
  );
} finally {
  await prisma.$disconnect();
}
