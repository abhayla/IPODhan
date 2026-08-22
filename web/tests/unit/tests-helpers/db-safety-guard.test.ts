import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  assertNotProductionDatabase,
  assertNotProductionRedis,
  assertSafeIntegrationTargets,
} from '../../helpers/db-safety-guard';

// T-265: this guard is what stops integration tests from writing seed rows
// into the production database (root cause of the 39-row registrar leak).
// T-275: extended with a Redis-side guard after a poisoned prod
// `registrars:all:active` cache key served 26 fabricated registrar rows on
// ipodhan.com for ~5.7 days.

describe('assertNotProductionDatabase', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalDatabaseHost = process.env.DATABASE_HOST;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_HOST;
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (originalDatabaseHost === undefined) {
      delete process.env.DATABASE_HOST;
    } else {
      process.env.DATABASE_HOST = originalDatabaseHost;
    }
  });

  it('throws when DATABASE_URL targets the production database name', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:pw@localhost:15432/ipodhan';
    expect(() => assertNotProductionDatabase('caller')).toThrow(/does not look like a test database/);
  });

  it('does not throw when DATABASE_URL targets a "*_test" database', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:pw@103.118.16.189:5432/ipodhan_test';
    expect(() => assertNotProductionDatabase('caller')).not.toThrow();
  });

  it('throws when DATABASE_URL is unset (cannot confirm a safe target)', () => {
    expect(() => assertNotProductionDatabase('caller')).toThrow(/could not determine the target database name/);
  });

  it('accepts a database name ending in "test" without an underscore prefix', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:pw@localhost:5432/ipodhantest';
    expect(() => assertNotProductionDatabase('caller')).not.toThrow();
  });

  it('throws when DATABASE_URL targets the known prod host even with a "_test"-shaped name missing', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:pw@103.118.16.189:5432/ipodhan';
    expect(() => assertNotProductionDatabase('caller')).toThrow(/does not look like a test database/);
  });
});

describe('assertNotProductionRedis', () => {
  const originalUrl = process.env.REDIS_URL;
  const originalHost = process.env.REDIS_HOST;
  const originalPassword = process.env.REDIS_PASSWORD;
  const originalAllow = process.env.ALLOW_INTEGRATION_TARGET;

  beforeEach(() => {
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PASSWORD;
    delete process.env.ALLOW_INTEGRATION_TARGET;
  });

  afterEach(() => {
    for (const [key, value] of [
      ['REDIS_URL', originalUrl],
      ['REDIS_HOST', originalHost],
      ['REDIS_PASSWORD', originalPassword],
      ['ALLOW_INTEGRATION_TARGET', originalAllow],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('throws when REDIS_URL is unset (cannot confirm a safe target)', () => {
    expect(() => assertNotProductionRedis('caller')).toThrow(/could not determine the target Redis host/);
  });

  it('does not throw for an unauthenticated localhost test Redis (CI shape)', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    expect(() => assertNotProductionRedis('caller')).not.toThrow();
  });

  it('throws when REDIS_URL embeds a password, even on localhost (T-275 prod-shaped signal)', () => {
    process.env.REDIS_URL = 'redis://:somepassword@localhost:6379/0';
    expect(() => assertNotProductionRedis('caller')).toThrow(/requires authentication/);
  });

  it('throws when REDIS_HOST + REDIS_PASSWORD are both set', () => {
    process.env.REDIS_HOST = 'localhost';
    process.env.REDIS_PASSWORD = 'somepassword';
    expect(() => assertNotProductionRedis('caller')).toThrow(/requires authentication/);
  });

  it('allows an authenticated target when ALLOW_INTEGRATION_TARGET=true is explicitly set', () => {
    process.env.REDIS_URL = 'redis://:somepassword@localhost:6379/0';
    process.env.ALLOW_INTEGRATION_TARGET = 'true';
    expect(() => assertNotProductionRedis('caller')).not.toThrow();
  });

  it('throws on the known prod Redis host even with ALLOW_INTEGRATION_TARGET=true (no override)', () => {
    process.env.REDIS_URL = 'redis://:somepassword@72.61.240.224:6379/0';
    process.env.ALLOW_INTEGRATION_TARGET = 'true';
    expect(() => assertNotProductionRedis('caller')).toThrow(/known production\/staging host/);
  });

  it('throws on the known prod Postgres host string appearing in REDIS_HOST', () => {
    process.env.REDIS_HOST = '103.118.16.189';
    expect(() => assertNotProductionRedis('caller')).toThrow(/known production\/staging host/);
  });
});

describe('assertSafeIntegrationTargets', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalRedisUrl = process.env.REDIS_URL;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
  });

  it('trips on a prod-looking DATABASE_URL even when REDIS_URL is safe', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:pw@103.118.16.189:5432/ipodhan';
    process.env.REDIS_URL = 'redis://localhost:6379';
    expect(() => assertSafeIntegrationTargets('caller')).toThrow(/does not look like a test database/);
  });

  it('trips on a prod-looking REDIS_URL even when DATABASE_URL is safe', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:pw@localhost:5432/ipodhan_test';
    process.env.REDIS_URL = 'redis://:pw@72.61.240.224:6379/0';
    expect(() => assertSafeIntegrationTargets('caller')).toThrow(/known production\/staging host/);
  });

  it('does not throw when both targets are test-shaped', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:pw@localhost:5432/ipodhan_test';
    process.env.REDIS_URL = 'redis://localhost:6379';
    expect(() => assertSafeIntegrationTargets('caller')).not.toThrow();
  });
});
