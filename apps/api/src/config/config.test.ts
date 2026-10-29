import { describe, expect, it } from 'vitest';

import { BootError, assertConsistent } from './boot';
import { ConfigError, loadConfig } from './config';

/** A complete environment, so every test changes exactly one thing. */
function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    APP_VERSION: '0.1.0',
    API_PORT: '4000',
    DATABASE_URL: 'postgresql://cms:pw@localhost:5444/cms',
    REDIS_URL: 'redis://localhost:6390',
    AUTH_SECRET: 'x'.repeat(32),
    PUBLISHER_INTERNAL_URL: 'http://localhost:4400',
    RATE_LIMIT_GLOBAL: '240',
    RATE_LIMIT_AUTH: '5',
    RATE_LIMIT_COMMENT: '10',
    ...overrides,
  };
}

describe('loadConfig', () => {
  it('reads the documented environment', () => {
    const config = loadConfig(env());
    expect(config.port).toBe(4000);
    expect(config.rateLimitComment).toBe(10);
  });

  it('prefers PORT over API_PORT, and falls through an empty PORT', () => {
    expect(loadConfig(env({ PORT: '4200' })).port).toBe(4200);
    expect(loadConfig(env({ PORT: '' })).port).toBe(4000);
  });

  it('names every missing variable in one message', () => {
    expect(() => loadConfig(env({ DATABASE_URL: undefined, AUTH_SECRET: undefined }))).toThrow(
      /DATABASE_URL[\s\S]*AUTH_SECRET/u,
    );
  });

  it('refuses a short secret', () => {
    expect(() => loadConfig(env({ AUTH_SECRET: 'short' }))).toThrow(ConfigError);
  });

  it('refuses a service URL with no protocol, which new URL() would have parsed', () => {
    expect(() => loadConfig(env({ PUBLISHER_INTERNAL_URL: 'localhost:4400' }))).toThrow(
      /PUBLISHER_INTERNAL_URL/u,
    );
  });

  it('strips a trailing slash from service URLs', () => {
    expect(
      loadConfig(env({ PUBLISHER_INTERNAL_URL: 'http://publisher:4400/' })).publisherInternalUrl,
    ).toBe('http://publisher:4400');
  });
});

describe('assertConsistent', () => {
  it('accepts the documented defaults', () => {
    expect(() => assertConsistent(loadConfig(env()))).not.toThrow();
  });

  it('refuses special budgets at or above the global one', () => {
    expect(() => assertConsistent(loadConfig(env({ RATE_LIMIT_AUTH: '240' })))).toThrow(
      /credential-stuffing/u,
    );
    expect(() => assertConsistent(loadConfig(env({ RATE_LIMIT_COMMENT: '300' })))).toThrow(
      BootError,
    );
  });
});
