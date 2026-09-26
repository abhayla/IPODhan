import { afterEach, describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import { DistributedLock } from '../../../src/utils/distributed-lock';
import { InMemoryRedisBackend } from '../../../../packages/shared/src/testing/in-memory-redis-backend';

/**
 * #151: before the slot namespace, prod and staging shared ONE Redis with the
 * SAME lock key `lock:resource:scraper:cycle`, so a staging data cycle made
 * every prod wake skip (and a staging deploy's lock release could delete a
 * lock a live prod cycle held). Each slot now locks independently.
 */
const saved = { ...process.env };
const opened: Redis[] = [];

async function slotClient(database: string, backend: InMemoryRedisBackend): Promise<Redis> {
  vi.resetModules();
  process.env.DATABASE_URL = `postgresql://ipodhan_app@db:5432/${database}`;
  delete process.env.DATABASE_HOST;
  delete process.env.DEPLOY_SLOT;
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  const { getRedisClient } = await import('../../../../packages/shared/src/cache/redis-client');
  const client = backend.attach(getRedisClient());
  opened.push(client);
  return client;
}

afterEach(() => {
  for (const c of opened.splice(0)) c.disconnect();
  process.env = { ...saved };
  vi.restoreAllMocks();
});

describe('scraper locks are per slot (#151)', () => {
  it('a staging scraper:cycle holder does not block prod, and each slot still excludes itself', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const backend = new InMemoryRedisBackend();
    const staging = new DistributedLock(await slotClient('ipodhan_staging', backend));
    const prod = new DistributedLock(await slotClient('ipodhan', backend));

    expect((await staging.acquire('scraper:cycle', { ttl: 60_000 })).acquired).toBe(true);
    expect((await prod.acquire('scraper:cycle', { ttl: 60_000 })).acquired).toBe(true);

    const secondProd = new DistributedLock(await slotClient('ipodhan', backend));
    expect((await secondProd.acquire('scraper:cycle', { ttl: 60_000 })).acquired).toBe(false);

    // The exact keys the deploy script and scraper-wake.sh must name.
    expect([...backend.store.keys()].sort()).toEqual([
      'prod:lock:resource:scraper:cycle',
      'staging:lock:resource:scraper:cycle',
    ]);

    await staging.release('scraper:cycle');
    expect([...backend.store.keys()]).toEqual(['prod:lock:resource:scraper:cycle']);
  });
});
