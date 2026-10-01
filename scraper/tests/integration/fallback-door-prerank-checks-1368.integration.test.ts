import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository } from '@ipodhan/shared/repositories';

/**
 * #1368: the consolidator's per-field pre-rank checks (the incapable-source refusal, spec section
 * 2.3.5, and the field matrix validation bounds) on the real upsertIPO write path on ipodhan_test,
 * through BOTH doors. The fallback door is forced by making `consolidateIPOData` throw, which is
 * exactly when it runs in production. The reviewer's two probes on #1360:
 *   - BSE issueSize 5000000000 into an empty issue_size (BSE is incapable of ipos.issue_size, #728);
 *   - faceValue 50000 (matrix max 10000).
 * Each must be refused on the fallback door the way the primary door refuses it.
 * Redis is a stub; the database is the sanctioned test database vetted by vitest.integration.setup.ts.
 */
const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] };
vi.mock('@ipodhan/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ipodhan/shared')>()),
  getRedisClient: () => noRedis,
}));

// Answer state "the check's own input cannot be read": the field-policy switchover file read throws.
const policyState = vi.hoisted(() => ({ throwOnRead: false }));
vi.mock('../../src/config/switchover.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/switchover.js')>();
  return {
    ...actual,
    isFlipped: (...args: Parameters<typeof actual.isFlipped>) => {
      if (policyState.throwOnRead) throw new Error('switchover.json unreadable (simulated)');
      return actual.isFlipped(...args);
    },
  };
});

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8000-000000136803';
const NAME = 'Zzqprerank Door Testco Limited';
const SLUG = 'zzqprerank-door-testco-limited';

let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let savedFlags: Record<string, unknown> = {};

async function cleanup() {
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, [IPO]));
  await db.delete(schema.dataConflicts).where(inArray(schema.dataConflicts.ipoId, [IPO]));
  await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, [IPO]));
  await db.delete(schema.ipos).where(eq(schema.ipos.id, IPO));
}

describe.skipIf(!DATABASE_URL)('#1368: both ipos write doors run the pre-rank checks (ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, options: '-c timezone=UTC' });
    db = drizzle(pool, { schema });
    await cleanup();
    const { FEATURE_FLAGS } = await import('../../src/config/feature-flags');
    const flags = FEATURE_FLAGS as Record<string, unknown>;
    savedFlags = {
      ENABLE_DATA_CONSOLIDATION: flags.ENABLE_DATA_CONSOLIDATION,
      ENABLE_POLICY_WRITER: flags.ENABLE_POLICY_WRITER,
      CONSOLIDATION_PERCENTAGE: flags.CONSOLIDATION_PERCENTAGE,
    };
    // Staging's state (switchover.json flips the issue-size group; the policy writer is on there).
    flags.ENABLE_DATA_CONSOLIDATION = true;
    flags.ENABLE_POLICY_WRITER = true;
    flags.CONSOLIDATION_PERCENTAGE = 100;
  });
  afterAll(async () => {
    const { FEATURE_FLAGS } = await import('../../src/config/feature-flags');
    Object.assign(FEATURE_FLAGS as Record<string, unknown>, savedFlags);
    if (db) await cleanup();
    await pool?.end();
  });
  beforeEach(async () => {
    await cleanup();
    await db.insert(schema.ipos).values({
      id: IPO, companyName: NAME, slug: SLUG, segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING', sector: 'Technology',
    } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  async function stored(): Promise<{ issueSize: unknown; faceValue: unknown }> {
    const [row] = await db
      .select({ issueSize: schema.ipos.issueSize, faceValue: schema.ipos.faceValue })
      .from(schema.ipos)
      .where(eq(schema.ipos.id, IPO));
    return { issueSize: row?.issueSize ?? null, faceValue: row?.faceValue ?? null };
  }

  async function scrape(source: 'BSE' | 'NSE', fields: Record<string, unknown>, door: 'primary' | 'fallback') {
    const { DataConsolidationService } = await import('../../src/services/data-consolidation-service');
    const spy = door === 'fallback'
      ? vi.spyOn(DataConsolidationService.prototype, 'consolidateIPOData').mockRejectedValue(new Error('consolidation failed (simulated)'))
      : null;
    const { upsertIPO } = await import('../../src/services/data-persister');
    const repo = new IPORepository(db as never, noRedis as never);
    const existing = await repo.findByIdUncached(IPO);
    await upsertIPO(repo, { companyName: NAME, segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING', ...fields } as never, source, existing as never);
    if (spy) expect(spy).toHaveBeenCalled();
  }

  it('fallback door: BSE issueSize into an empty issue_size is refused (incapable source, section 2.3.5)', async () => {
    await scrape('BSE', { issueSize: 5000000000 }, 'fallback');
    expect((await stored()).issueSize).toBeNull();
  });

  it('primary door (control): the same BSE issueSize is refused', async () => {
    await scrape('BSE', { issueSize: 5000000000 }, 'primary');
    expect((await stored()).issueSize).toBeNull();
  });

  it('fallback door: faceValue 50000 (matrix max 10000) is refused', async () => {
    await scrape('NSE', { faceValue: 50000 }, 'fallback');
    expect((await stored()).faceValue).toBeNull();
  });

  it('primary door (control): the same faceValue 50000 is refused', async () => {
    await scrape('NSE', { faceValue: 50000 }, 'primary');
    expect((await stored()).faceValue).toBeNull();
  });

  it('fallback door: the policy config cannot be read -> nothing is written (fail closed), even an in-bounds value', async () => {
    policyState.throwOnRead = true;
    try {
      await scrape('NSE', { faceValue: 10, issueSize: 5000000000 }, 'fallback');
    } finally {
      policyState.throwOnRead = false;
    }
    expect(await stored()).toEqual({ issueSize: null, faceValue: null });
  });

  it('fallback door (control): an in-bounds faceValue from a capable source is still written', async () => {
    await scrape('NSE', { faceValue: 10 }, 'fallback');
    expect(Number((await stored()).faceValue)).toBe(10);
  });
});
