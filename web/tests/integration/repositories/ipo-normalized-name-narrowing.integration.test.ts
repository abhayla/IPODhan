/**
 * #1235 round 2 (MINOR-3): the REAL findByNormalizedName query on ipodhan_test, including the
 * offering-type filter and the bounded same-name fetch that the unit tests' mock cannot exercise
 * (the mock's limit() ignores every where() clause).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inArray } from 'drizzle-orm';
import { IPORepository } from '@ipodhan/shared/repositories';
import { db } from '@/lib/db/index';
import { ipos, auditLogs } from '@/lib/db';
import { IdentityHeldForReviewError } from '@ipodhan/shared/errors/repository-errors';

const NAME = 'Zzqnarrow Testco Ltd';
const KEY = 'zzqnarrow testco';
const ID = {
  sme: '00000000-0000-4000-8000-000000123501', main: '00000000-0000-4000-8000-000000123502',
  ofs: '00000000-0000-4000-8000-000000123503', other: '00000000-0000-4000-8000-000000123504',
};
const ALL_IDS = Object.values(ID);

const base = { companyName: NAME, status: 'UPCOMING' as const, sector: 'Technology' };

describe('IPORepository.findByNormalizedName narrowing (real query, #1235)', () => {
  // The query path never touches Redis; a stub keeps this test off any cache.
  const redis = { get: async () => null, setex: async () => 'OK', del: async () => 0, keys: async () => [] };
  const repo = new IPORepository(db, redis as never);

  async function seed(rows: Array<{ id: string; slug: string; segment: 'SME' | 'MAINBOARD'; offeringType: 'IPO' | 'OFS'; companyName?: string }>) {
    await cleanup();
    await db.insert(ipos).values(rows.map((r) => ({ ...base, ...r })) as never);
  }
  async function cleanup() {
    // A hold writes an audit_logs row keyed by the first candidate's ipo id; drop those first.
    await db.delete(auditLogs).where(inArray(auditLogs.ipoId, ALL_IDS));
    await db.delete(ipos).where(inArray(ipos.id, ALL_IDS));
  }

  beforeAll(cleanup);
  afterAll(cleanup);

  it('SME + MAINBOARD pair: the record segment separates them, no hold', async () => {
    await seed([
      { id: ID.sme, slug: 'zzq1235-sme-slug', segment: 'SME', offeringType: 'IPO' },
      { id: ID.main, slug: 'zzq1235-main-slug', segment: 'MAINBOARD', offeringType: 'IPO' },
    ]);
    expect((await repo.findByNormalizedName(KEY, undefined, { segment: 'SME' }))?.id).toBe(ID.sme);
    expect((await repo.findByNormalizedName(KEY, undefined, { segment: 'MAINBOARD' }))?.id).toBe(ID.main);
  });

  it('offering-type filter reaches the SQL: the OFS-filtered query returns only the OFS row', async () => {
    await seed([
      { id: ID.sme, slug: 'zzq1235-sme-slug', segment: 'MAINBOARD', offeringType: 'IPO' },
      { id: ID.ofs, slug: 'zzq1235-ofs-slug', segment: 'MAINBOARD', offeringType: 'OFS' },
    ]);
    expect((await repo.findByNormalizedName(KEY, 'OFS', { segment: 'MAINBOARD', offeringType: 'OFS' }))?.id).toBe(ID.ofs);
    expect((await repo.findByNormalizedName(KEY, 'IPO', { segment: 'MAINBOARD', offeringType: 'IPO' }))?.id).toBe(ID.sme);
  });

  it('fail closed: same segment and type, nothing separates the pair -> HELD', async () => {
    await seed([
      { id: ID.sme, slug: 'zzq1235-sme-slug', segment: 'SME', offeringType: 'IPO' },
      { id: ID.main, slug: 'zzq1235-main-slug', segment: 'SME', offeringType: 'IPO' },
    ]);
    const err = await repo.findByNormalizedName(KEY, undefined, { segment: 'SME', offeringType: 'IPO' }).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityHeldForReviewError);
  });

  it('MAJOR-1: a key-bound row OUTSIDE the same-name pair keeps the hold', async () => {
    await seed([
      { id: ID.sme, slug: 'zzq1235-sme-slug', segment: 'SME', offeringType: 'IPO' },
      { id: ID.main, slug: 'zzq1235-main-slug', segment: 'MAINBOARD', offeringType: 'IPO' },
      { id: ID.other, slug: 'zzq1235-other-slug', segment: 'SME', offeringType: 'IPO', companyName: 'Zzqnarrow Holdings Pvt' },
    ]);
    const err = await repo.findByNormalizedName(KEY, undefined, { segment: 'SME', keyBoundId: ID.other }).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityHeldForReviewError);
    // ...while a key row INSIDE the pair wins without a hold.
    expect((await repo.findByNormalizedName(KEY, undefined, { keyBoundId: ID.main }))?.id).toBe(ID.main);
  });
});
