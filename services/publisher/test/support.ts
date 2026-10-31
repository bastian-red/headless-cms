/**
 * Fixtures for the publisher's integration lane, written straight to cms_it
 * the way the API leaves them (the CHECK constraints refuse anything else).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createPrismaClient, type PrismaClient } from '@cms/db';
import { REVALIDATION_SIGNATURE_HEADER, verifyRevalidation } from '@cms/shared/server';

const url = process.env.DATABASE_URL;
if (url === undefined || !url.includes('cms_it')) {
  throw new Error('DATABASE_URL must point at cms_it. Run this through ./scripts/integration.sh.');
}

/** A client per simulated publisher: separate pools, so "concurrent" means separate sessions. */
export const connect = (): PrismaClient => createPrismaClient({ url });
export const db = connect();

export const SECRET = randomBytes(33).toString('base64');
const suffix = () => randomBytes(5).toString('hex');

const createdPosts: string[] = [];
const createdTags: string[] = [];

export async function cleanUp(): Promise<void> {
  const ids = createdPosts.splice(0);
  const slugs = (
    await db.post.findMany({ where: { id: { in: ids } }, select: { slug: true } })
  ).map((p) => p.slug);
  // Events have no foreign key to a post: they are found by the tags they carry.
  if (slugs.length > 0) {
    await db.$executeRaw`DELETE FROM revalidation_events
      WHERE tags && ${slugs.map((s) => `post:${s}`)}::text[]`;
  }
  await db.post.deleteMany({ where: { id: { in: ids } } });
  await db.tag.deleteMany({ where: { id: { in: createdTags.splice(0) } } });
}

export async function newTag(): Promise<{ id: string; slug: string }> {
  const slug = `tag-${suffix()}`;
  const tag = await db.tag.create({ data: { slug, name: slug } });
  createdTags.push(tag.id);
  return { id: tag.id, slug };
}

export interface ScheduledFixture {
  postId: string;
  slug: string;
  authorId: string;
  head: string;
  live: string | null;
  scheduledFor: Date;
}

/**
 * A scheduled post. With `republish`, revision 1 is live (tagged `liveTag`)
 * and revision 2 (tagged `headTag`) is the scheduled one, as when an editor
 * schedules an update to a live post.
 */
export async function scheduledPost(
  scheduledFor: Date,
  {
    republish = false,
    liveTag,
    headTag,
  }: { republish?: boolean; liveTag?: string; headTag?: string } = {},
): Promise<ScheduledFixture> {
  const user = await db.user.create({
    data: { email: `pub-${randomUUID()}@cms.test`, name: 'Publisher Test', passwordHash: 'x' },
  });
  const slug = `scheduled-${suffix()}`;
  return db.$transaction(async (tx) => {
    const post = await tx.post.create({ data: { slug, authorId: user.id } });
    const revision = (number: number, tagId?: string, parentRevisionId: string | null = null) =>
      tx.revision.create({
        data: {
          postId: post.id,
          number,
          parentRevisionId,
          authorId: user.id,
          title: `Scheduled ${String(number)}`,
          excerpt: 'An excerpt.',
          body: 'Body.',
          ...(tagId === undefined ? {} : { tags: { create: { tagId } } }),
        },
      });
    let live: string | null = null;
    if (republish) {
      live = (await revision(1, liveTag)).id;
      await tx.post.update({
        where: { id: post.id },
        data: {
          headRevisionId: live,
          publishedRevisionId: live,
          status: 'PUBLISHED',
          publishedAt: new Date('2026-01-02T03:04:05.000Z'),
        },
      });
    }
    const head = (await revision(republish ? 2 : 1, headTag, live)).id;
    await tx.post.update({
      where: { id: post.id },
      data: { headRevisionId: head, status: 'SCHEDULED', scheduledFor },
    });
    createdPosts.push(post.id);
    return { postId: post.id, slug, authorId: user.id, head, live, scheduledFor };
  });
}

/**
 * Mark every undelivered event in cms_it delivered, so a test owns the outbox
 * it drains. (cms_it is the lane's own database; the API suites leave events.)
 */
export async function quietOutbox(): Promise<void> {
  await db.$executeRaw`UPDATE revalidation_events SET delivered_at = now() WHERE delivered_at IS NULL`;
}

export interface Site {
  readonly url: string;
  /** Every verified delivery, in arrival order. */
  readonly received: { eventId: string; tags: string[] }[];
  /** Requests whose signature did not verify. */
  readonly refused: number;
  /** What the next requests answer; a function so a test can change it mid-run. */
  status: () => number;
  close(): Promise<void>;
}

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    req.on('end', () => resolve(body));
  });

/** A stand-in for the site's /api/revalidate that verifies signatures with the real check. */
export async function fakeSite(): Promise<Site> {
  const site = {
    received: [] as { eventId: string; tags: string[] }[],
    refused: 0,
    status: () => 200,
  };
  const server = createServer((req, res) => {
    void read(req).then((body) => {
      const header = req.headers[REVALIDATION_SIGNATURE_HEADER];
      const verdict = verifyRevalidation(
        SECRET,
        typeof header === 'string' ? header : null,
        body,
        Math.floor(Date.now() / 1000),
      );
      if (!verdict.ok) {
        site.refused += 1;
        res.writeHead(401).end(verdict.reason);
        return;
      }
      const status = site.status();
      if (status === 200)
        site.received.push(JSON.parse(body) as { eventId: string; tags: string[] });
      res.writeHead(status).end(status === 200 ? '{}' : 'down for maintenance');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return Object.assign(site, {
    url: `http://127.0.0.1:${String(port)}/api/revalidate`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }) as Site;
}
