import { healthSchema } from '@cms/shared';
import { describe, expect, it } from 'vitest';

import { loadConfig } from './config';
import { httpStatusFor, report } from './health';

const ok = async () => {};
const down = async () => {
  throw new Error('connect ECONNREFUSED');
};

describe('report', () => {
  it('is ok, and answers 200, only when every probe passes', async () => {
    const health = await report(
      { postgres: ok, redis: ok },
      { version: '1', startedAt: 0, now: 61_000 },
    );
    expect(healthSchema.parse(health)).toEqual(health);
    expect(health.status).toBe('ok');
    expect(health.uptimeSeconds).toBe(61);
    expect(httpStatusFor(health)).toBe(200);
  });

  it('names the failing dependency and answers 503', async () => {
    const health = await report({ postgres: ok, redis: down }, { version: '1', startedAt: 0 });
    expect(health.status).toBe('degraded');
    expect(httpStatusFor(health)).toBe(503);
    expect(health.checks.find((c) => c.name === 'redis')).toMatchObject({
      status: 'fail',
      detail: 'connect ECONNREFUSED',
    });
    expect(health.checks.find((c) => c.name === 'postgres')?.status).toBe('ok');
  });

  it('never puts a stack on the wire', async () => {
    const health = await report({ redis: down }, { version: '1', startedAt: 0 });
    expect(JSON.stringify(health)).not.toMatch(/\n\s+at /u);
  });
});

describe('loadConfig', () => {
  const env = {
    DATABASE_URL: 'postgresql://cms:cms@localhost:5444/cms',
    REDIS_URL: 'redis://localhost:6390',
    PUBLISHER_HEALTH_PORT: '4400',
  };

  it('reads the documented environment', () => {
    expect(loadConfig(env)).toMatchObject({ healthPort: 4400, appVersion: '0.0.0' });
  });

  it('names every bad variable in one message', () => {
    expect(() => loadConfig({ ...env, REDIS_URL: undefined, PUBLISHER_HEALTH_PORT: 'x' })).toThrow(
      /REDIS_URL[\s\S]*PUBLISHER_HEALTH_PORT/u,
    );
  });
});
