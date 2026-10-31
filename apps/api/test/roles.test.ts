/**
 * Who may call what: every studio route against every role, with the answer
 * computed from `can()` in `@cms/shared`, the table the studio reads too.
 *
 * Then the admin's own routes: people (and the last admin) and API keys.
 */
import { randomUUID } from 'node:crypto';

import { ROLES, apiKeySchema, can, createdApiKeySchema, type Action } from '@cms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { boot, call, newApiKey, newUser, routes, type Harness, type Reply } from './support';

let h: Harness;
beforeAll(async () => {
  h = await boot();
});
afterAll(async () => {
  await h.close();
});

const ID = 'c0000000000000000000000000';

/** Every signed-in route and the action it requires (`null`: any signed-in role). */
const MATRIX: readonly (readonly [string, Action | null])[] = [
  ['GET /auth/me', null],
  ['GET /studio/posts', 'post.read'],
  ['POST /studio/posts', 'post.write'],
  ['GET /studio/posts/:id', 'post.read'],
  ['GET /studio/posts/:id/revisions', 'post.read'],
  ['GET /studio/posts/:id/revisions/:revisionId', 'post.read'],
  ['POST /studio/posts/:id/revisions', 'post.write'],
  ['POST /studio/posts/:id/revisions/:revisionId/restore', 'post.restore'],
  ['PUT /studio/posts/:id/slug', 'post.write'],
  ['POST /studio/posts/:id/transitions', 'post.submit'],
  ['GET /studio/tags', 'post.read'],
  ['POST /studio/tags', 'tag.manage'],
  ['GET /studio/users', 'user.manage'],
  ['POST /studio/users', 'user.manage'],
  ['PATCH /studio/users/:id/role', 'user.manage'],
  ['GET /studio/api-keys', 'apikey.manage'],
  ['POST /studio/api-keys', 'apikey.manage'],
  ['DELETE /studio/api-keys/:id', 'apikey.manage'],
  ['GET /studio/comments', 'comment.moderate'],
  ['POST /studio/comments/:id/decision', 'comment.moderate'],
];

/** Routes that take no session: open to anyone, or to an API key. */
const NOT_SIGNED_IN = [
  'GET /health',
  'GET /status',
  'POST /auth/sign-in',
  'POST /comments',
  'GET /v1/posts',
  'GET /v1/posts/:slug',
  'GET /v1/posts/:slug/comments',
  'GET /v1/search',
  'GET /v1/tags',
  'GET /v1/openapi.json',
];

describe('the role matrix', () => {
  it('covers every route the router serves', () => {
    expect(routes(h)).toEqual([...MATRIX.map(([route]) => route), ...NOT_SIGNED_IN].sort());
  });

  it('401 without a session on every signed-in route', async () => {
    for (const [route] of MATRIX) {
      const [method, path] = route.split(' ') as [string, string];
      const r = await call(h, method, path.replace(/:\w+/gu, ID), { user: null });
      expect(r.status, route).toBe(401);
    }
  });

  for (const role of ROLES) {
    it(`${role}: 403 exactly where can() says no, before the body is even read`, async () => {
      const user = await newUser(h.db, `matrix-${role.toLowerCase()}`, role);
      for (const [route, action] of MATRIX) {
        const [method, path] = route.split(' ') as [string, string];
        // An empty body: a pipe that ran before the role check would answer 400.
        const r = await call(h, method, path.replace(/:\w+/gu, ID), {
          user,
          ...(method === 'GET' || method === 'DELETE' ? {} : { body: {} }),
        });
        const allowed = action === null || can(role, action);
        if (allowed) expect([401, 403], `${role} ${route}`).not.toContain(r.status);
        else expect(r.status, `${role} ${route}`).toBe(403);
      }
    });
  }

  it('reads the role from the database on every request, not from the token', async () => {
    const admin = await newUser(h.db, 'demoted-admin', 'ADMIN');
    expect((await call(h, 'GET', '/studio/users', { user: admin })).status).toBe(200);
    await h.db.user.update({ where: { id: admin.id }, data: { role: 'AUTHOR' } });
    // The same token claims ADMIN; the row says AUTHOR, and the row wins.
    expect((await call(h, 'GET', '/studio/users', { user: admin })).status).toBe(403);
    await h.db.user.delete({ where: { id: admin.id } });
    expect((await call(h, 'GET', '/auth/me', { user: admin })).status).toBe(401);
  });
});

describe('/studio/users', () => {
  it('creates a person, and refuses an email that is taken (409)', async () => {
    const admin = await newUser(h.db, 'users-admin', 'ADMIN');
    const email = `new-${randomUUID().slice(0, 8)}@cms.test`;
    const body = { email, name: 'New Person', role: 'AUTHOR', password: 'a-long-password-2026' };
    const created = await call<{ email: string; role: string }>(h, 'POST', '/studio/users', {
      user: admin,
      body,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ email, role: 'AUTHOR' });
    expect(created.text).not.toContain('passwordHash');
    expect((await call(h, 'POST', '/studio/users', { user: admin, body })).status).toBe(409);
  });

  it('never demotes the last admin, even when two admins demote each other at once', async () => {
    // Make this suite's two admins the only ones, and put everyone back after.
    const others = await h.db.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    const a = await newUser(h.db, 'last-admin-a', 'ADMIN');
    const b = await newUser(h.db, 'last-admin-b', 'ADMIN');
    await h.db.user.updateMany({
      where: { id: { in: others.map((o) => o.id) } },
      data: { role: 'EDITOR' },
    });
    try {
      // Two requests landing inside each other's count-then-update window by
      // chance is rare, so a plain Promise.all passes with the lock removed
      // (measured: red-proofs.mjs). Instead the test holds both admin rows
      // itself until both requests are waiting on Postgres, then lets go.
      // With the lock, both wait at the SELECT and the second recounts after
      // the first commits: one admin, refused. Without it, both count two
      // admins first and wait only at their UPDATE: both demotions land.
      let replies!: Promise<Reply[]>;
      await h.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM users WHERE id IN (${a.id}, ${b.id}) FOR UPDATE`;
          replies = Promise.all([
            call(h, 'PATCH', `/studio/users/${b.id}/role`, { user: a, body: { role: 'EDITOR' } }),
            call(h, 'PATCH', `/studio/users/${a.id}/role`, { user: b, body: { role: 'EDITOR' } }),
          ]);
          await expect
            .poll(
              async () => {
                const [row] = await h.db.$queryRaw<{ n: number }[]>`
                  SELECT count(*)::int AS n FROM pg_stat_activity
                  WHERE datname = current_database() AND wait_event_type = 'Lock'`;
                return row!.n;
              },
              { timeout: 10_000 },
            )
            .toBe(2);
        },
        { timeout: 15_000 },
      );
      const statuses = (await replies).map((r) => r.status).sort();
      // Both passed the role guard as admins, so the loser is the last-admin 422.
      expect(statuses).toEqual([200, 422]);
      const ab = (await replies)[0]!;
      expect(await h.db.user.count({ where: { role: 'ADMIN' } })).toBe(1);

      const survivor = ab.status === 200 ? a : b;
      const last = await call(h, 'PATCH', `/studio/users/${survivor.id}/role`, {
        user: survivor,
        body: { role: 'AUTHOR' },
      });
      expect(last.status).toBe(422);
      expect(last.body).toMatchObject({
        message: 'This is the last admin. Make somebody else an admin first.',
      });
    } finally {
      await h.db.user.updateMany({
        where: { id: { in: others.map((o) => o.id) } },
        data: { role: 'ADMIN' },
      });
    }
  });
});

describe('/studio/api-keys', () => {
  it('shows the key once, stores only its hash, and a revoked key stops working', async () => {
    const admin = await newUser(h.db, 'keys-admin', 'ADMIN');
    const created = await call(h, 'POST', '/studio/api-keys', {
      user: admin,
      body: { name: 'site' },
    });
    expect(created.status).toBe(201);
    const { key, apiKey } = createdApiKeySchema.parse(created.body);
    expect(key.startsWith(apiKey.prefix)).toBe(true);

    const row = await h.db.apiKey.findUniqueOrThrow({ where: { id: apiKey.id } });
    expect(JSON.stringify(row)).not.toContain(key);
    const listed = await call<unknown[]>(h, 'GET', '/studio/api-keys', { user: admin });
    expect(listed.text).not.toContain(key);
    listed.body.forEach((k) => apiKeySchema.parse(k));

    expect((await call(h, 'GET', '/v1/tags', { bearer: key })).status).toBe(200);
    expect((await call(h, 'DELETE', `/studio/api-keys/${apiKey.id}`, { user: admin })).status).toBe(
      204,
    );
    expect((await call(h, 'GET', '/v1/tags', { bearer: key })).status).toBe(401);
    // Revoking twice is fine; a key that never existed is not.
    expect((await call(h, 'DELETE', `/studio/api-keys/${apiKey.id}`, { user: admin })).status).toBe(
      204,
    );
    expect((await call(h, 'DELETE', `/studio/api-keys/${ID}`, { user: admin })).status).toBe(404);
  });

  it('keeps the revoked row, so the studio can still show who made it', async () => {
    const admin = await newUser(h.db, 'keys-history', 'ADMIN');
    const key = await newApiKey(h, admin, 'old site');
    const row = await h.db.apiKey.findFirstOrThrow({ where: { prefix: key.slice(0, 13) } });
    await call(h, 'DELETE', `/studio/api-keys/${row.id}`, { user: admin });
    const after = await h.db.apiKey.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.revokedAt).not.toBeNull();
    expect(after.createdById).toBe(admin.id);
  });
});
