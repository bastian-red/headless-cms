/**
 * Sign-in, the default-closed guard and the auth budget, against the real
 * graph.
 *
 * The budget runs at its DOCUMENTED value (RATE_LIMIT_AUTH, 5 a minute). The
 * negative half is the one that matters: `@nestjs/throttler` v6 runs every named
 * throttler on every route unless it is skipped, and a sibling project shipped
 * an auth budget that capped every route. So this proves the sign-in budget
 * does not limit `/health`, `/status`, or a signed-in call from the same address.
 */
import { sessionUserSchema } from '@cms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { boot, call, newUser, randomAddress, type Harness } from './support';

let h: Harness;
beforeAll(async () => {
  h = await boot();
});
afterAll(async () => {
  await h.close();
});

const AUTH_BUDGET = Number(process.env.RATE_LIMIT_AUTH ?? '5');

describe('POST /auth/sign-in', () => {
  it('answers the user with their role, parsed by the contract the web app uses', async () => {
    const editor = await newUser(h.db, 'editor', 'EDITOR');
    const r = await call(h, 'POST', '/auth/sign-in', {
      body: { email: editor.email, password: editor.password },
    });
    expect(r.status).toBe(200);
    expect(sessionUserSchema.parse(r.body)).toEqual({
      id: editor.id,
      email: editor.email,
      name: editor.name,
      role: 'EDITOR',
    });
  });

  it('gives one answer for a wrong password and for an unknown address', async () => {
    const author = await newUser(h.db, 'author');
    const wrong = await call(h, 'POST', '/auth/sign-in', {
      body: { email: author.email, password: 'not-the-password' },
    });
    const unknown = await call(h, 'POST', '/auth/sign-in', {
      body: { email: `nobody-${author.id}@cms.test`, password: 'not-the-password' },
    });
    expect(wrong.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body).toMatchObject({ code: 'INVALID' });
  });

  it('never puts the submitted password in a validation error', async () => {
    const r = await call(h, 'POST', '/auth/sign-in', {
      body: { email: 'not-an-email', password: 'hunter2-secret-value' },
    });
    expect(r.status).toBe(400);
    expect(r.text).not.toContain('hunter2-secret-value');
    expect(r.body).toMatchObject({ code: 'INVALID', fields: ['email'] });
  });

  it('has no sign-up route: accounts are created by an admin', async () => {
    const r = await call(h, 'POST', '/auth/sign-up', {
      body: { email: 'walk-in@cms.test', name: 'Walk In', password: 'a-long-enough-password' },
    });
    expect(r.status).toBe(404);
    expect(await h.db.user.count({ where: { email: 'walk-in@cms.test' } })).toBe(0);
  });
});

describe('the session guard is default-closed', () => {
  it('refuses a route that is not @Public() without a token', async () => {
    const r = await call(h, 'GET', '/auth/me', { user: null });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuses a token minted with another secret', async () => {
    const author = await newUser(h.db, 'forger');
    const r = await call(h, 'GET', '/auth/me', {
      user: author,
      secret: 'some-other-secret-at-least-32-chars',
    });
    expect(r.status).toBe(401);
  });
});

describe('GET /auth/me', () => {
  it('reads the role from the users table, not from the token', async () => {
    const person = await newUser(h.db, 'demoted', 'EDITOR');
    await h.db.user.update({ where: { id: person.id }, data: { role: 'AUTHOR' } });
    // The token still says EDITOR, as one minted before the demotion would.
    const r = await call(h, 'GET', '/auth/me', { user: person });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: person.id, role: 'AUTHOR' });
  });

  it('is a 401 for a token whose account was deleted', async () => {
    const person = await newUser(h.db, 'deleted');
    await h.db.user.delete({ where: { id: person.id } });
    expect((await call(h, 'GET', '/auth/me', { user: person })).status).toBe(401);
  });
});

describe('the auth budget limits sign-in and nothing else', () => {
  it(`allows ${String(AUTH_BUDGET)} attempts a minute from one address, then 429`, async () => {
    const address = randomAddress();
    const attempt = () =>
      call(h, 'POST', '/auth/sign-in', {
        address,
        body: { email: 'nobody@cms.test', password: 'wrong-password' },
      });
    for (let i = 0; i < AUTH_BUDGET; i += 1) expect((await attempt()).status).toBe(400);
    expect((await attempt()).status).toBe(429);

    // A different address still has its own budget.
    const elsewhere = await call(h, 'POST', '/auth/sign-in', {
      body: { email: 'nobody@cms.test', password: 'wrong-password' },
    });
    expect(elsewhere.status).toBe(400);

    // An ordinary route is NOT capped at the auth number. /health and /status
    // below skip every budget by decorator, so they cannot show this; /auth/me
    // carries no budget decorator at all, which is the route shape a leaked
    // budget hits. Removing the auth `skipIf` turns the sixth call into a 429.
    const reader = await newUser(h.db, 'reader');
    for (let i = 0; i < AUTH_BUDGET + 3; i += 1) {
      expect((await call(h, 'GET', '/auth/me', { user: reader, address })).status).toBe(200);
    }

    // The exhausted address can still reach the public probes.
    for (let i = 0; i < AUTH_BUDGET + 2; i += 1) {
      expect((await call(h, 'GET', '/health', { address })).status).toBe(200);
      expect((await call(h, 'GET', '/status', { address })).status).toBe(200);
    }
  });
});

describe('GET /health', () => {
  it('checks Postgres and Redis for real', async () => {
    const r = await call<{
      status: string;
      service: string;
      checks: { name: string; status: string }[];
    }>(h, 'GET', '/health');
    expect(r.status).toBe(200);
    expect(r.body.service).toBe('api');
    expect(r.body.checks.map((c) => `${c.name}:${c.status}`).sort()).toEqual([
      'postgres:ok',
      'redis:ok',
    ]);
  });
});
