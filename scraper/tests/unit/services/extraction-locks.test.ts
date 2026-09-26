import { afterEach, describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import { DistributedLock } from '../../../src/utils/distributed-lock';
import { InMemoryRedisBackend } from '../../../../packages/shared/src/testing/in-memory-redis-backend';
import {
  BOX_EXTRACTOR_LOCK_RESOURCE,
  acquireExtractionLocks,
  releaseExtractionLocks,
} from '../../../src/services/extraction-locks';

/**
 * #151 round 1, finding 2. Before the slot namespace, prod and staging shared
 * the unprefixed `lock:resource:scraper:cycle`, and that shared lock is what
 * (by accident) stopped both slots' python extractors running at once on the
 * 2-vCPU box (W-178: two extractors starved nginx/Next into Cloudflare 522s).
 * Per-slot cycle locks stay; the box-wide extractor lock is the deliberate
 * replacement for the accident.
 */
const saved = { ...process.env };
const opened: Redis[] = [];

interface Slot {
  cycle: DistributedLock;
  slotLock: DistributedLock;
  boxLock: DistributedLock;
}

async function slot(database: string, backend: InMemoryRedisBackend): Promise<Slot> {
  vi.resetModules();
  process.env.DATABASE_URL = `postgresql://ipodhan_app@db:5432/${database}`;
  delete process.env.DATABASE_HOST;
  delete process.env.DEPLOY_SLOT;
  delete process.env.NEXT_PHASE;
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  const mod = await import('../../../../packages/shared/src/cache/redis-client');
  const slotClient = backend.attach(mod.getRedisClient());
  const boxClient = backend.attach(mod.getBoxWideRedisClient());
  opened.push(slotClient, boxClient);
  const slotLock = new DistributedLock(slotClient);
  return { cycle: slotLock, slotLock, boxLock: new DistributedLock(boxClient) };
}

afterEach(() => {
  for (const c of opened.splice(0)) c.disconnect();
  process.env = { ...saved };
  vi.restoreAllMocks();
});

describe('box-wide extractor lock (#151 round 1)', () => {
  it('each slot takes its OWN cycle lock, but only one slot can hold the box-wide extractor lock', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const backend = new InMemoryRedisBackend();
    const staging = await slot('ipodhan_staging', backend);
    const prod = await slot('ipodhan', backend);

    // Per-slot cycle locks: both slots run their cycles.
    expect((await staging.cycle.acquire('scraper:cycle', { ttl: 60_000 })).acquired).toBe(true);
    expect((await prod.cycle.acquire('scraper:cycle', { ttl: 60_000 })).acquired).toBe(true);

    // Staging reaches its extraction phase first.
    const s = await acquireExtractionLocks(staging.slotLock, staging.boxLock, 60_000);
    expect(s.acquired).toBe(true);

    // Prod reaches ITS extraction phase while staging's extractor runs.
    const p = await acquireExtractionLocks(prod.slotLock, prod.boxLock, 60_000);
    expect(p).toEqual({ acquired: false, heldBy: 'box' });

    // Prod's refused attempt left NOTHING of its own held (its slot extraction
    // lock is given back, or it would block its own next cycle for the TTL).
    expect([...backend.store.keys()].sort()).toEqual([
      `box:lock:resource:${BOX_EXTRACTOR_LOCK_RESOURCE}`,
      'prod:lock:resource:scraper:cycle',
      'staging:lock:resource:filing-auto-persist:cycle',
      'staging:lock:resource:scraper:cycle',
    ]);

    // Staging finishes; prod's next attempt gets the box.
    if (!s.acquired) throw new Error('unreachable');
    await releaseExtractionLocks(staging.slotLock, staging.boxLock, s);
    expect(backend.store.has(`box:lock:resource:${BOX_EXTRACTOR_LOCK_RESOURCE}`)).toBe(false);
    const p2 = await acquireExtractionLocks(prod.slotLock, prod.boxLock, 60_000);
    expect(p2.acquired).toBe(true);
  });

  it('a second cycle of the SAME slot is refused on the slot lock first (the existing overlap guard)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const backend = new InMemoryRedisBackend();
    const a = await slot('ipodhan', backend);
    const b = await slot('ipodhan', backend);
    expect((await acquireExtractionLocks(a.slotLock, a.boxLock, 60_000)).acquired).toBe(true);
    expect(await acquireExtractionLocks(b.slotLock, b.boxLock, 60_000)).toEqual({ acquired: false, heldBy: 'slot' });
  });

  it('the box lock carries the extraction TTL and the release is token-checked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const backend = new InMemoryRedisBackend();
    const prod = await slot('ipodhan', backend);
    const before = Date.now();
    const got = await acquireExtractionLocks(prod.slotLock, prod.boxLock, 90_000);
    if (!got.acquired) throw new Error('expected acquire');
    const box = backend.store.get(`box:lock:resource:${BOX_EXTRACTOR_LOCK_RESOURCE}`);
    expect(box?.value).toBe(got.boxToken);
    expect(box?.expiresAt).toBeGreaterThanOrEqual(before + 90_000);
    expect(box?.expiresAt).toBeLessThanOrEqual(Date.now() + 90_000);

    // A foreign token (another slot's extractor took the box after a TTL
    // expiry) is never released by this slot.
    backend.store.set(`box:lock:resource:${BOX_EXTRACTOR_LOCK_RESOURCE}`, { value: 'other-slot' });
    await releaseExtractionLocks(prod.slotLock, prod.boxLock, got);
    expect(backend.store.get(`box:lock:resource:${BOX_EXTRACTOR_LOCK_RESOURCE}`)?.value).toBe('other-slot');
    expect(backend.store.has('prod:lock:resource:filing-auto-persist:cycle')).toBe(false);
  });
});
