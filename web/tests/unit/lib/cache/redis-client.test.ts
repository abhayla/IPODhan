import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * F2 (T-264 P2-3): this client used to build its connection from
 * REDIS_HOST/REDIS_PORT/REDIS_PASSWORD only, ignoring both REDIS_URL (whose
 * path segment selects the db, e.g. "redis://...:6379/1") and an explicit
 * REDIS_DB override. That collapsed staging and prod onto the SAME Redis
 * db0 — proven on the box: db0 dbsize=3262, db1 dbsize=0, staging had never
 * written its own db. This test proves the client now honors both.
 */

const RedisMock = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.on = vi.fn();
});

vi.mock('ioredis', () => ({
  default: RedisMock,
}));

describe('web/lib/cache/redis-client — REDIS_URL / REDIS_DB honored (F2)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    RedisMock.mockClear();
    delete process.env.REDIS_URL;
    delete process.env.REDIS_DB;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.REDIS_PASSWORD;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('constructs from REDIS_URL (with its db suffix) when set', async () => {
    process.env.REDIS_URL = 'redis://:pw@127.0.0.1:6379/1';

    const { getRedisClient } = await import('../../../../lib/cache/redis-client');
    getRedisClient();

    expect(RedisMock).toHaveBeenCalledTimes(1);
    expect(RedisMock.mock.calls[0][0]).toBe('redis://:pw@127.0.0.1:6379/1');
  });

  it('REDIS_DB always wins as an explicit override, even with REDIS_URL set', async () => {
    process.env.REDIS_URL = 'redis://:pw@127.0.0.1:6379';
    process.env.REDIS_DB = '1';

    const { getRedisClient } = await import('../../../../lib/cache/redis-client');
    getRedisClient();

    expect(RedisMock).toHaveBeenCalledTimes(1);
    const [url, options] = RedisMock.mock.calls[0];
    expect(url).toBe('redis://:pw@127.0.0.1:6379');
    expect(options.db).toBe(1);
  });

  it('falls back to REDIS_HOST/REDIS_PORT/REDIS_PASSWORD when REDIS_URL is unset', async () => {
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6379';
    process.env.REDIS_PASSWORD = 'somepass';

    const { getRedisClient } = await import('../../../../lib/cache/redis-client');
    getRedisClient();

    expect(RedisMock).toHaveBeenCalledTimes(1);
    const [options] = RedisMock.mock.calls[0];
    expect(options.host).toBe('127.0.0.1');
    expect(options.port).toBe(6379);
    expect(options.password).toBe('somepass');
  });

  it('applies REDIS_DB on the host/port fallback path too (staging isolation)', async () => {
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6379';
    process.env.REDIS_DB = '1';

    const { getRedisClient } = await import('../../../../lib/cache/redis-client');
    getRedisClient();

    const [options] = RedisMock.mock.calls[0];
    expect(options.db).toBe(1);
  });

  it('does not set db at all when REDIS_DB is unset (prod default db0)', async () => {
    process.env.REDIS_URL = 'redis://:pw@127.0.0.1:6379';

    const { getRedisClient } = await import('../../../../lib/cache/redis-client');
    getRedisClient();

    const [, options] = RedisMock.mock.calls[0];
    expect(options.db).toBeUndefined();
  });
});
