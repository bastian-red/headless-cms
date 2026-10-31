import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_BACKOFF_MS, backlog, claimDue, drain } from '../src/outbox';
import { connect, db, fakeSite, quietOutbox, SECRET, type Site } from './support';

let site: Site;
const created: string[] = [];

async function newEvents(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const event = await db.revalidationEvent.create({
      data: { tags: ['posts', `post:outbox-${String(i)}`] },
    });
    ids.push(event.id);
  }
  created.push(...ids);
  return ids;
}

/** Drain until a pass claims nothing. */
async function drainAll(client = db, target = { url: site.url, secret: SECRET }) {
  for (let pass = 0; pass < 50; pass += 1) {
    if ((await drain(client, target)).length === 0) return;
  }
  throw new Error('outbox never emptied');
}

beforeEach(async () => {
  await quietOutbox();
  site = await fakeSite();
});
afterEach(async () => {
  await site.close();
  await db.revalidationEvent.deleteMany({ where: { id: { in: created.splice(0) } } });
});
afterAll(() => db.$disconnect());

describe('drain', () => {
  it('delivers each event signed, once, and records the delivery', async () => {
    const ids = await newEvents(3);
    await drainAll();

    expect(site.refused).toBe(0);
    expect(site.received.map((r) => r.eventId).sort()).toEqual([...ids].sort());
    const rows = await db.revalidationEvent.findMany({ where: { id: { in: ids } } });
    for (const row of rows) {
      expect(row).toMatchObject({ attempts: 1, lastError: null });
      expect(row.deliveredAt).not.toBeNull();
    }
    expect(await backlog(db)).toEqual({ undelivered: 0, oldestSeconds: null, lastError: null });
  });

  it('keeps a refused event, says why, and backs off before trying again', async () => {
    const [id] = await newEvents(1);
    site.status = () => 503;

    const [settled] = await drain(db, { url: site.url, secret: SECRET });
    expect(settled?.result).toEqual({ ok: false, error: 'HTTP 503: down for maintenance' });

    const row = await db.revalidationEvent.findUniqueOrThrow({ where: { id: id! } });
    expect(row).toMatchObject({
      attempts: 1,
      deliveredAt: null,
      lastError: 'HTTP 503: down for maintenance',
    });
    // First retry one second out: not claimable now.
    const wait = row.nextAttemptAt.getTime() - Date.now();
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(1_000);
    expect(await claimDue(db)).toEqual([]);
    expect((await backlog(db)).lastError).toBe('HTTP 503: down for maintenance');

    // The site comes back; once the backoff passes, it is delivered.
    site.status = () => 200;
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await drainAll();
    expect(site.received.map((r) => r.eventId)).toEqual([id]);
    const done = await db.revalidationEvent.findUniqueOrThrow({ where: { id: id! } });
    expect(done).toMatchObject({ attempts: 2, lastError: null });
    expect(done.deliveredAt).not.toBeNull();
  });

  it('never gives up: the wait stops growing at the cap', async () => {
    const [id] = await newEvents(1);
    await db.revalidationEvent.update({ where: { id: id! }, data: { attempts: 40 } });
    site.status = () => 500;
    await drain(db, { url: site.url, secret: SECRET });
    const row = await db.revalidationEvent.findUniqueOrThrow({ where: { id: id! } });
    expect(row.deliveredAt).toBeNull();
    const wait = row.nextAttemptAt.getTime() - Date.now();
    expect(wait).toBeGreaterThan(MAX_BACKOFF_MS - 5_000);
    expect(wait).toBeLessThanOrEqual(MAX_BACKOFF_MS);
  });

  it('leases what it claims, so a second publisher does not take it mid-delivery', async () => {
    const [id] = await newEvents(1);
    const first = await claimDue(db);
    expect(first.map((e) => e.id)).toEqual([id]);
    expect(await claimDue(db)).toEqual([]);
  });

  it('delivers each event exactly once when three publishers drain at the same time', async () => {
    const ids = await newEvents(45);
    const clients = [connect(), connect(), connect()];
    try {
      await Promise.all(clients.map((client) => drainAll(client)));
    } finally {
      await Promise.all(clients.map((client) => client.$disconnect()));
    }
    const delivered = site.received.map((r) => r.eventId);
    expect(delivered).toHaveLength(ids.length);
    expect(new Set(delivered).size).toBe(ids.length);
  });

  it('a site with another secret delivers nothing', async () => {
    const [id] = await newEvents(1);
    const [settled] = await drain(db, { url: site.url, secret: 'w'.repeat(44) });
    expect(settled?.result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^HTTP 401/u),
    });
    expect(site.received).toEqual([]);
    expect(
      (await db.revalidationEvent.findUniqueOrThrow({ where: { id: id! } })).deliveredAt,
    ).toBeNull();
  });
});
