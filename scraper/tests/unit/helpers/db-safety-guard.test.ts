import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  assertNotProductionDatabase,
  assertNotProductionRedis,
  assertSafeIntegrationTargets,
} from '../../helpers/db-safety-guard';

// T-279: this guard is what stops `npm run test:integration` in the scraper
// workspace from writing seed/insert/delete rows into the live production
// database -- GitHub #163, filed by the T-275C checker after finding
// scraper/.env's DATABASE_HOST/DATABASE_URL point at prod (103.118.16.189)
// with no guard in front of the >=5 integration suites that perform real
// writes. Ported from web/tests/helpers/db-safety-guard.ts (T-265/T-275),
// extended with a host-denylist on the DB side because scraper's own test
// helper derives a "*_test"-shaped name regardless of host.

describe('assertNotProductionDatabase', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalDatabaseHost = process.env.DATABASE_HOST;
  const originalDatabaseName = process.env.DATABASE_NAME;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_HOST;
    delete process.env.DATABASE_NAME;
  });

  afterEach(() => {
    for (const [key, value] of [
      ['DATABASE_URL', originalDatabaseUrl],
      ['DATABASE_HOST', originalDatabaseHost],
      ['DATABASE_NAME', originalDatabaseName],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('throws when DATABASE_URL targets the production database name', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:pw@localhost:15432/ipodhan';
    expect(() => assertNotProductionDatabase('caller')).toThrow(/does not look like a test database/);
  });

  it('does not throw when DATABASE_URL targets a "*_test" database on a safe host', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:pw@localhost:5432/ipodhan_test';
    expect(() => assertNotProductionDatabase('caller')).not.toThrow();
  });

  it('throws when DATABASE_URL is unset (cannot confirm a safe target)', () => {
    expect(() => assertNotProductionDatabase('caller')).toThrow(/could not determine the target database host/);
  });

  it('accepts a database name ending in "test" without an underscore prefix', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:pw@localhost:5432/ipodhantest';
    expect(() => assertNotProductionDatabase('caller')).not.toThrow();
  });

  it('throws on the known prod host even with a "_test"-shaped database NAME (GitHub #163 exact shape)', () => {
    // scraper/tests/test-utils/db.ts derives DATABASE_NAME + '_test' regardless
    // of host -- so "ipodhan_test" on the live prod host must still refuse.
    process.env.DATABASE_URL = 'postgresql://postgres:pw@103.118.16.189:5432/ipodhan_test';
    expect(() => assertNotProductionDatabase('caller')).toThrow(/known production\/staging host/);
  });

  it('throws on the known prod host via DATABASE_HOST alone, independent of DATABASE_URL', () => {
    process.env.DATABASE_HOST = '103.118.16.189';
    process.env.DATABASE_NAME = 'ipodhan_test';
    expect(() => assertNotProductionDatabase('caller')).toThrow(/known production\/staging host/);
  });

  it('throws on the known prod host even without a "_test"-shaped name', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:pw@103.118.16.189:5432/ipodhan';
    expect(() => assertNotProductionDatabase('caller')).toThrow(/known production\/staging host/);
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

  it('throws when REDIS_URL embeds a password, even on localhost (prod-shaped signal)', () => {
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
  const originalDatabaseHost = process.env.DATABASE_HOST;
  const originalRedisUrl = process.env.REDIS_URL;

  afterEach(() => {
    for (const [key, value] of [
      ['DATABASE_URL', originalDatabaseUrl],
      ['DATABASE_HOST', originalDatabaseHost],
      ['REDIS_URL', originalRedisUrl],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('trips on the real scraper/.env shape (prod DATABASE_HOST) even when REDIS_URL is safe', () => {
    process.env.DATABASE_URL =
      'postgresql://postgres:pw@103.118.16.189:5432/ipodhan';
    process.env.DATABASE_HOST = '103.118.16.189';
    process.env.REDIS_URL = 'redis://localhost:6379';
    expect(() => assertSafeIntegrationTargets('caller')).toThrow(/known production\/staging host/);
  });

  it('trips on a prod-looking REDIS_URL even when DATABASE_URL is safe', () => {
    delete process.env.DATABASE_HOST;
    process.env.DATABASE_URL = 'postgresql://postgres:pw@localhost:5432/ipodhan_test';
    process.env.REDIS_URL = 'redis://:pw@72.61.240.224:6379/0';
    expect(() => assertSafeIntegrationTargets('caller')).toThrow(/known production\/staging host/);
  });

  it('does not throw when both targets are test-shaped', () => {
    delete process.env.DATABASE_HOST;
    process.env.DATABASE_URL = 'postgresql://postgres:pw@localhost:5432/ipodhan_test';
    process.env.REDIS_URL = 'redis://localhost:6379';
    expect(() => assertSafeIntegrationTargets('caller')).not.toThrow();
  });
});
