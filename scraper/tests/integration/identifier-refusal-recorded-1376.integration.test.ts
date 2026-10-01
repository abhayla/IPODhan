/**
 * #1376 round 2 on the real database (ipodhan_test only), through the REAL orchestrator door.
 *
 * Class: every write path of ipos.cin / isin / symbol (create, update, the walk's single-field write) and
 * every value dropped because another live row of the SAME offering holds it. OD-62/OD-99 require a
 * recorded reason: the dropped identifier appears in the result (`refusedIdentifierFields`, which the
 * field walk turns into a validation refusal) AND in the B5 step ledger (`refused: [{field, rule}]`).
 * A log line is not a recorded reason.
 *
 * Spec basis: OD-68 (two rows of one offering sharing an identifier "should never happen"), OD-62/OD-99,
 * §2.3.3 rule 3 (a shared CIN/ISIN proves the same COMPANY, not the same offering: an OFS keeps sharing).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql, eq } from 'drizzle-orm';

process.env.ENABLE_DATA_CONSOLIDATION = 'true';
process.env.CONSOLIDATION_PERCENTAGE = '100';
process.env.ENABLE_SOURCE_TRACKING = 'true';

import * as schema from '../../../packages/shared/src/db/schema';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import { IDENTIFIER_HELD_RULE } from '../../src/services/identifier-refusal.js';
import { getTestDb, cleanupTestDb } from '../test-utils/db';

const A = '00000000-0000-4000-8137-6100000000a1';
const B = '00000000-0000-4000-8137-6100000000b1';
const OFS = '00000000-0000-4000-8137-6100000000c1';
const ISIN = 'INE137601015';
const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] };

describe('#1376 round 2: a dropped identifier is a recorded refusal (ipodhan_test)', () => {
  let db: Awaited<ReturnType<typeof getTestDb>>;
  let orchestrator: any;
  let repo: IPORepository;

  async function cleanup() {
    const ids = sql`SELECT id FROM ipos WHERE id IN (${A}::uuid, ${B}::uuid, ${OFS}::uuid) OR slug LIKE 'zzq1376r2-%'`;
    await db.execute(sql`DELETE FROM ipo_pipeline_steps WHERE ipo_id IN (${ids})`);
    await db.execute(sql`DELETE FROM field_sources WHERE ipo_id IN (${ids})`);
    await db.execute(sql`DELETE FROM ipos WHERE id IN (${A}::uuid, ${B}::uuid, ${OFS}::uuid) OR slug LIKE 'zzq1376r2-%'`);
  }
  async function insertIpo(id: string, slug: string, offeringType: string, openDate: string, isin: string | null = null) {
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, status, segment, offering_type, open_date, isin)
      VALUES (${id}::uuid, ${'Zzq1376r2 ' + slug}, ${slug}, 'UPCOMING', 'MAINBOARD', ${offeringType}, ${openDate}, ${isin})`);
  }
  const rowOf = async (id: string) => (await db.select().from(schema.ipos).where(eq(schema.ipos.id, id)))[0] as any;
  async function b5(id: string) {
    const r: any = await db.execute(sql`SELECT evidence FROM ipo_pipeline_steps WHERE ipo_id = ${id}::uuid AND step_id = 'B5'`);
    return ((r.rows ?? r) as any[])[0]?.evidence ?? null;
  }
  const scraped = (name: string, over: Record<string, unknown> = {}) =>
    ({ companyName: name, status: 'UPCOMING', dataSource: 'NSE', offeringType: 'IPO', segment: 'MAINBOARD', ...over }) as never;

  beforeAll(async () => {
    db = await getTestDb();
    const { DataConsolidationOrchestrator } = await import('../../src/services/data-consolidation-orchestrator.js');
    repo = new IPORepository(db as never, noRedis as never);
    orchestrator = new DataConsolidationOrchestrator(
      repo,
      new FieldSourcesRepository(db as never, noRedis as never),
      new DataConflictsRepository(db as never, noRedis as never),
      null
    );
  }, 60000);
  beforeEach(async () => {
    await cleanup();
    await insertIpo(A, 'zzq1376r2-a', 'IPO', '2026-10-20', ISIN);
    await insertIpo(B, 'zzq1376r2-b', 'IPO', '2026-10-22');
  });
  afterAll(async () => {
    if (db) await cleanup();
    await cleanupTestDb();
  }, 60000);

  it('update door: the ISIN row A holds is not written to B, and the refusal is in the result AND the B5 ledger', async () => {
    const rowB = await rowOf(B);
    const r = await orchestrator.consolidatedUpsertIPO(scraped(rowB.companyName, { isin: ISIN }), 'NSE', 100, rowB);
    expect(r.refusedIdentifierFields).toEqual(['isin']);
    expect((await rowOf(B)).isin).toBeNull();
    expect((await rowOf(A)).isin).toBe(ISIN);
    expect((await b5(B))?.refused).toEqual([{ field: 'isin', rule: IDENTIFIER_HELD_RULE }]);
  });

  it('create door: a new row of the same offering is created without the held ISIN, and the refusal is recorded', async () => {
    const r = await orchestrator.consolidatedUpsertIPO(
      scraped('Zzq1376r2 zzq1376r2-new', { isin: ISIN, openDate: '2026-10-23', closeDate: '2026-10-27' }),
      'NSE',
      100,
      null
    );
    expect(r.isNew).toBe(true);
    expect(r.refusedIdentifierFields).toEqual(['isin']);
    expect((await rowOf(r.ipoId)).isin).toBeNull();
    expect((await b5(r.ipoId))?.refused).toEqual([{ field: 'isin', rule: IDENTIFIER_HELD_RULE }]);
  });

  it('a write with no conflicting holder records no refusal (control)', async () => {
    const rowB = await rowOf(B);
    const r = await orchestrator.consolidatedUpsertIPO(scraped(rowB.companyName, { isin: 'INE137601023' }), 'NSE', 100, rowB);
    expect(r.refusedIdentifierFields).toBeUndefined();
    expect((await rowOf(B)).isin).toBe('INE137601023');
    expect((await b5(B))?.refused).toBeUndefined();
  });

  it('a row of a DIFFERENT offering (an OFS of the same company) keeps sharing the ISIN: no refusal', async () => {
    await insertIpo(OFS, 'zzq1376r2-ofs', 'OFS', '2026-10-21');
    const rowO = await rowOf(OFS);
    const r = await orchestrator.consolidatedUpsertIPO(scraped(rowO.companyName, { isin: ISIN, offeringType: 'OFS' }), 'NSE', 100, rowO);
    expect(r.refusedIdentifierFields).toBeUndefined();
    expect((await rowOf(OFS)).isin).toBe(ISIN);
  });

  it('repository callback: update and create report exactly the dropped fields; a no-conflict write reports none', async () => {
    const seen: string[][] = [];
    const cb = (r: { fieldName: string }[]) => seen.push(r.map((x) => x.fieldName));
    await repo.updateReportingHolds(B, { isin: ISIN } as never, { onIdentifierRefused: cb });
    await repo.create(
      {
        companyName: 'Zzq1376r2 cb', slug: 'zzq1376r2-cb', status: 'UPCOMING', segment: 'MAINBOARD',
        offeringType: 'IPO', openDate: '2026-10-21', isin: ISIN,
      } as never,
      { onIdentifierRefused: cb }
    );
    await repo.updateReportingHolds(B, { isin: 'INE137601031' } as never, { onIdentifierRefused: cb });
    expect(seen).toEqual([['isin'], ['isin']]);
  });

  it('null offering type on create: fail closed and RECORDED (a holder inside the window refuses), written when nobody holds it', async () => {
    await db.execute(sql`UPDATE ipos SET cin = 'U12345MH2020PLC137601' WHERE id = ${A}::uuid`);
    const seen: string[][] = [];
    const cb = (r: { fieldName: string }[]) => seen.push(r.map((x) => x.fieldName));
    const base = { status: 'UPCOMING', segment: 'MAINBOARD', openDate: '2026-10-21' };
    const refused = await repo.create(
      { ...base, companyName: 'Zzq1376r2 nulltype', slug: 'zzq1376r2-nulltype', cin: 'U12345MH2020PLC137601' } as never,
      { onIdentifierRefused: cb }
    );
    expect(refused.cin ?? null).toBeNull();
    expect(seen).toEqual([['cin']]);
    const free = await repo.create(
      { ...base, companyName: 'Zzq1376r2 nulltype2', slug: 'zzq1376r2-nulltype2', cin: 'U99999MH2020PLC137602' } as never,
      { onIdentifierRefused: cb }
    );
    expect(free.cin).toBe('U99999MH2020PLC137602');
    expect(seen).toEqual([['cin']]);
  });
});
