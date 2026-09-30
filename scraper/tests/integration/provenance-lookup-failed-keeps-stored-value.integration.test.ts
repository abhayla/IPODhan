import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository, FieldSourcesRepository } from '@ipodhan/shared/repositories';

/**
 * #1236 (round 2): the real upsertIPO write path on ipodhan_test, with the stored-provenance READ
 * failing (the `field_sources` lookup throws). An SME row whose stored offering_type is FPO must
 * keep FPO when the lookup failed - "lookup failed" is not "no exchange vouches for it" - and must
 * still be rewritten to IPO when the lookup succeeded and found no row (the control). Redis is a
 * stub; the database is the sanctioned test database vetted by vitest.integration.setup.ts.
 */
const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] };
vi.mock('@ipodhan/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ipodhan/shared')>()),
  getRedisClient: () => noRedis,
}));

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8000-000000123601';
const NAME = 'Zzqlookup Fpo Testco Limited';
const SLUG = 'zzqlookup-fpo-testco-limited';

let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function cleanup() {
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, [IPO]));
  await db.delete(schema.dataConflicts).where(inArray(schema.dataConflicts.ipoId, [IPO]));
  await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, [IPO]));
  await db.delete(schema.ipos).where(eq(schema.ipos.id, IPO));
}

describe.skipIf(!DATABASE_URL)('#1236: a failed stored-provenance lookup keeps the stored offering type (ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, options: '-c timezone=UTC' });
    db = drizzle(pool, { schema });
    await cleanup();
  });
  afterAll(async () => {
    if (db) await cleanup();
    await pool?.end();
  });
  beforeEach(async () => {
    await cleanup();
    await db.insert(schema.ipos).values({
      id: IPO, companyName: NAME, slug: SLUG, segment: 'SME', offeringType: 'FPO', status: 'UPCOMING', sector: 'Technology',
    } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  async function storedOfferingType(): Promise<string | undefined> {
    const [row] = await db.select({ t: schema.ipos.offeringType }).from(schema.ipos).where(eq(schema.ipos.id, IPO));
    return row?.t as string | undefined;
  }
  async function scrapeAsChittorgarh() {
    const { upsertIPO } = await import('../../src/services/data-persister');
    const repo = new IPORepository(db as never, noRedis as never);
    const existing = await repo.findByIdUncached(IPO);
    await upsertIPO(repo, { companyName: NAME, offeringType: 'FPO', segment: 'SME', status: 'UPCOMING' } as never, 'CHITTORGARH', existing as never);
  }

  it('lookup THREW -> the stored FPO survives a non-exchange source', async () => {
    const spy = vi.spyOn(FieldSourcesRepository.prototype, 'findByField').mockRejectedValue(new Error('field_sources read failed (simulated)'));
    await scrapeAsChittorgarh();
    expect(spy).toHaveBeenCalled();
    expect(await storedOfferingType()).toBe('FPO');
  });

  it('control: lookup ok and no provenance row -> the SME FPO is rewritten to IPO (the guard still works)', async () => {
    await scrapeAsChittorgarh();
    expect(await storedOfferingType()).toBe('IPO');
  });
});
