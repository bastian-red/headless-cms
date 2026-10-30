/**
 * Plumbing for the database integration lane. Every helper writes rows with
 * random slugs, so tests never collide and the database never needs clearing.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { createPrismaClient, type PrismaClient } from '../src/client';
import { violatedConstraint, violatedUniqueIndex } from '../src/errors';

const url = process.env.DATABASE_URL;
if (url === undefined || url === '' || !url.includes('cms_it')) {
  throw new Error('DATABASE_URL must point at cms_it. Run this through ./scripts/integration.sh.');
}

export const db: PrismaClient = createPrismaClient({ url });

export const suffix = () => randomBytes(5).toString('hex');

export async function newUser(): Promise<string> {
  const user = await db.user.create({
    data: {
      email: `db-${randomUUID()}@cms.test`,
      name: 'Schema Test',
      passwordHash: 'not-a-real-hash',
    },
  });
  return user.id;
}

export interface Fixture {
  postId: string;
  slug: string;
  authorId: string;
  /** Revision ids in order: first is number 1. */
  revisions: string[];
}

/**
 * A post with `count` revisions in one transaction, the way the API will write
 * it: the post first with no head, then its revisions, then the head pointer.
 */
export async function newPost(count = 1, authorId?: string): Promise<Fixture> {
  const author = authorId ?? (await newUser());
  const slug = `post-${suffix()}`;
  return db.$transaction(async (tx) => {
    const post = await tx.post.create({ data: { slug, authorId: author } });
    const revisions: string[] = [];
    for (let number = 1; number <= count; number += 1) {
      const revision = await tx.revision.create({
        data: {
          postId: post.id,
          number,
          parentRevisionId: revisions.at(-1) ?? null,
          authorId: author,
          title: `Title ${String(number)}`,
          excerpt: '',
          body: `Body ${String(number)}`,
        },
      });
      revisions.push(revision.id);
    }
    await tx.post.update({ where: { id: post.id }, data: { headRevisionId: revisions.at(-1)! } });
    return { postId: post.id, slug, authorId: author, revisions };
  });
}

/** Live: published revision = head, status PUBLISHED. */
export async function publish(fixture: Fixture): Promise<void> {
  const head = fixture.revisions.at(-1)!;
  await db.post.update({
    where: { id: fixture.postId },
    data: { status: 'PUBLISHED', publishedRevisionId: head, publishedAt: new Date() },
  });
}

/**
 * Await a write that must be refused, and return what refused it. Fails the
 * test if the write succeeds, so a guarantee that silently stopped holding
 * cannot pass by throwing nothing.
 */
export async function refused(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
  } catch (error) {
    return error;
  }
  throw new Error('the write was accepted; the database should have refused it');
}

/** Whether `error` names `constraint`, through either Prisma vocabulary. */
export function names(error: unknown, constraint: string): boolean {
  if (violatedConstraint(error, constraint) || violatedUniqueIndex(error, constraint)) return true;
  // A foreign-key refusal from the typed client names the constraint in
  // meta.field_name rather than meta.target.
  const meta = (error as { meta?: { field_name?: unknown } }).meta;
  return typeof meta?.field_name === 'string' && meta.field_name.includes(constraint);
}
