import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql, inArray, eq } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { writeIposRebuildingPlanInTx } from '@ipodhan/shared/services/plan-invalidating-rebuild';
import { getTestDb, cleanupTestDb } from '../test-utils/db';
import { generateFieldPlan, type PlanIpo } from '../../src/services/field-plan-generator';
import { loadPlanManifest } from '../../src/config/field-manifest-loader';
import { writeSegmentRepairRow, applySegmentRepairs } from '../../scripts/repair-segment-provenance';
import { writeSourceTrustRepairRow } from '../../scripts/repair-source-trust-batch-t292';
import { IPORepository } from '@ipodhan/shared';

/**
 * #1402 (spec §2.8): a non-walk write to segment / offering_type / listing_exchanges "drops and
 * rebuilds that IPO's plan rows", in the same transaction as the value. Before the fix,
 * repair-segment-provenance wrote `ipos.segment` and left every plan row on the old segment's ranks.
 *
 *   cd scraper && npx vitest run -c vitest.integration.config.ts tests/integration/segment-writers-rebuild-plan-1402.integration.test.ts
 */
const IPO = '00000000-0000-4000-8000-000000001402';
const SLUG = 'issue-1402-segment-writer-rebuild-proof';
const manifest = loadPlanManifest();
let db: any;

async function cleanup() {
  await db.delete(schema.ipoFieldPlan).where(inArray(schema.ipoFieldPlan.ipoId, [IPO]));
  await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, [IPO]));
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, [IPO]));
  await db.delete(schema.fieldProtectionMetadata).where(inArray(schema.fieldProtectionMetadata.ipoId, [IPO]));
  await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
}

async function plant(ipo: PlanIpo) {
  const rows = generateFieldPlan(ipo, manifest);
  await db.insert(schema.ipoFieldPlan).values(
    rows.map((r) => ({
      ipoId: r.ipoId, tableName: r.tableName, rowKey: '', fieldName: r.fieldName,
      rank1Source: r.rank1Source, rank2Source: r.rank2Source, rank3Source: r.rank3Source,
      state: 'PENDING' as const, attempts: 0, manifestVersion: r.manifestVersion, policyOrigin: r.policyOrigin,
    }))
  );
}

const rank1Of = async () =>
  new Map(
    (await db.select({ t: schema.ipoFieldPlan.tableName, f: schema.ipoFieldPlan.fieldName, r: schema.ipoFieldPlan.rank1Source })
      .from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO))).map((x: any) => [`${x.t}.${x.f}`, x.r])
  );

const expectedRank1 = (ipo: PlanIpo) => new Map(generateFieldPlan(ipo, manifest).map((r) => [`${r.tableName}.${r.fieldName}`, r.rank1Source]));

describe('#1402: non-walk writers of a plan input rebuild the plan in the same transaction', () => {
  beforeAll(async () => {
    db = await getTestDb();
  });
  afterAll(async () => {
    await cleanup();
    await cleanupTestDb();
  });
  beforeEach(async () => {
    await cleanup();
    await db.insert(schema.ipos).values({
      id: IPO, slug: SLUG, companyName: 'Issue 1402 Proof Limited', status: 'UPCOMING',
      segment: 'SME', offeringType: 'IPO', listingExchanges: ['NSE'],
    } as never);
    await plant({ id: IPO, segment: 'SME', listingExchanges: ['NSE'], offeringType: 'IPO' });
  });

  it('the test pool reads a naive timestamp as UTC (configureUtcTimestampParsing, ist-timezone rule)', async () => {
    // Through the pool itself: drizzle's execute() hands timestamps back as text, which a rule about
    // the pool's parser cannot be checked against.
    const r = await (db as any).$client.query(`SELECT '2026-01-01 05:00:00'::timestamp AS t`);
    expect(r.rows[0].t).toBeInstanceOf(Date);
    expect(r.rows[0].t.toISOString()).toBe('2026-01-01T05:00:00.000Z');
  });

  it('the SME and MAINBOARD plans differ for this row (the test can fail)', () => {
    const sme = expectedRank1({ id: IPO, segment: 'SME', listingExchanges: ['NSE'], offeringType: 'IPO' });
    const mb = expectedRank1({ id: IPO, segment: 'MAINBOARD', listingExchanges: ['NSE'], offeringType: 'IPO' });
    expect([...mb].some(([k, v]) => sme.get(k) !== v) || sme.size !== mb.size).toBe(true);
  });

  it('repair-segment-provenance: SME -> MAINBOARD rebuilds the plan to the MAINBOARD ranks', async () => {
    expect(await writeSegmentRepairRow(db, { ipoId: IPO, newSegment: 'MAINBOARD', provenance: null, manifest })).toBe('written');
    const [row] = await db.select({ s: schema.ipos.segment }).from(schema.ipos).where(eq(schema.ipos.id, IPO));
    expect(row.s).toBe('MAINBOARD');
    expect(await rank1Of()).toEqual(expectedRank1({ id: IPO, segment: 'MAINBOARD', listingExchanges: ['NSE'], offeringType: 'IPO' }));
  });

  it('the helper refuses (fail closed) a plan-input write without a manifest, and writes nothing', async () => {
    await expect(db.transaction((tx: any) => writeIposRebuildingPlanInTx(tx, IPO, { segment: 'MAINBOARD' }, null))).rejects.toThrow(/needs the field manifest/);
    const [row] = await db.select({ s: schema.ipos.segment }).from(schema.ipos).where(eq(schema.ipos.id, IPO));
    expect(row.s).toBe('SME');
  });

  it('a rebuild failure rolls the value back (value and plan commit together)', async () => {
    const broken = { ...manifest, fields: null } as never;
    await expect(db.transaction((tx: any) => writeIposRebuildingPlanInTx(tx, IPO, { segment: 'MAINBOARD' }, broken))).rejects.toThrow();
    const [row] = await db.select({ s: schema.ipos.segment }).from(schema.ipos).where(eq(schema.ipos.id, IPO));
    expect(row.s).toBe('SME');
  });

  it('applySegmentRepairs writes the rollback ledger even when a later row throws mid-run', async () => {
    const ledgers: any[] = [];
    await expect(
      applySegmentRepairs(
        db,
        [
          { ipoId: IPO, before: 'SME', newSegment: 'MAINBOARD', provenance: null },
          { ipoId: '00000000-0000-4000-8000-00000000dead', before: 'SME', newSegment: 'MAINBOARD', provenance: null },
        ],
        manifest,
        (written, held) => ledgers.push({ written, held })
      )
    ).rejects.toThrow();
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0].written.map((w: any) => w.ipoId)).toEqual([IPO]);
  });
});

/**
 * #1408 review r2: the merge and the unmerge write segment through the same door. A merge fills
 * segment only on an OD-86 relaunch merge of a POSTPONED survivor (§2.9, #1298): segment is a
 * document field, so the relaunch clears the old offer's DRHP-sourced segment and refills it from
 * the newer record. Here the postponed survivor is SME on BSE and the relaunch record is MAINBOARD
 * on BSE: the merge must rebuild the survivor's plan to the MAINBOARD ranks, and the unmerge, which
 * restores SME, must rebuild it back.
 */
describe('#1402 r2: mergeDuplicateInto / unmergeDuplicate rebuild the survivor plan', () => {
  const OLD = '00000000-0000-4000-8000-0000000014a1';
  const NEW = '00000000-0000-4000-8000-0000000014a2';
  const PAIR = [OLD, NEW];
  const tick = () => new Promise((r) => setTimeout(r, 25));
  const noRedis = {
    get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0,
    keys: async () => [], scan: async () => ['0', []],
  } as never;
  const smeBse: PlanIpo = { id: OLD, segment: 'SME', listingExchanges: ['BSE'], offeringType: 'IPO' };
  const mainboardBse: PlanIpo = { id: OLD, segment: 'MAINBOARD', listingExchanges: ['BSE'], offeringType: 'IPO' };
  const ranks = (ipo: PlanIpo) => new Map(generateFieldPlan(ipo, manifest).map((r) => [`${r.tableName}.${r.fieldName}`, r.rank1Source]));
  const oldRank1 = async () =>
    new Map(
      (await db.select({ t: schema.ipoFieldPlan.tableName, f: schema.ipoFieldPlan.fieldName, r: schema.ipoFieldPlan.rank1Source })
        .from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, OLD))).map((x: any) => [`${x.t}.${x.f}`, x.r])
    );
  async function cleanPair() {
    await db.execute(sql`DELETE FROM ipo_merge_log WHERE keep_ipo_id IN (${OLD}::uuid, ${NEW}::uuid) OR drop_ipo_id IN (${OLD}::uuid, ${NEW}::uuid)`);
    for (const id of PAIR) {
      await db.execute(sql`DELETE FROM ipo_slug_redirects WHERE ipo_id = ${id}::uuid`);
      await db.execute(sql`DELETE FROM audit_logs WHERE ipo_id = ${id}::uuid`);
      await db.execute(sql`DELETE FROM ipo_source_keys WHERE ipo_id = ${id}::uuid`);
      await db.execute(sql`DELETE FROM ipos WHERE id = ${id}::uuid`);
    }
  }
  async function mk(repo: IPORepository, id: string, slug: string, open: string, ipoNo: string, segment: string, status: string) {
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, status, segment, offering_type, symbol, listing_exchanges, lot_size,
                        open_date, price_range_min, price_range_max)
      VALUES (${id}::uuid, 'Merge Rebuild 1402 Seeds Ltd', ${slug}, 'UPCOMING', ${segment}, 'IPO', 'MRGRB1402', '["BSE"]', 1200, ${open}, 95, 99)`);
    await db.execute(sql`
      INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, updated_at, created_at)
      VALUES (${id}::uuid, 'ipos', '', 'segment', 'DRHP', 95, now() - interval '10 days', now() - interval '10 days'),
             (${id}::uuid, 'ipos', '', 'lotSize', 'DRHP', 95, now() - interval '10 days', now() - interval '10 days')`);
    await repo.bindSourceKeys(id, [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: ipoNo, attrs: { shares: 2_700_000, priceMin: 95, priceMax: 99, postponed: status === 'POSTPONED' } }] as never, {
      boundVia: 'BACKFILL', boundBy: 'issue1402.test',
    } as never);
    if (status === 'POSTPONED') {
      await db.execute(sql`UPDATE ipos SET status = 'POSTPONED' WHERE id = ${id}::uuid`);
      await db.execute(sql`
        INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, updated_at)
        VALUES (${id}::uuid, 'ipos', '', 'status', 'BSE', now())
        ON CONFLICT (ipo_id, table_name, row_key, field_name) DO UPDATE SET source = 'BSE', updated_at = now()`);
      await tick();
    }
  }
  beforeAll(async () => {
    // The describe above closes the shared pool in its afterAll; this block opens its own.
    db = await getTestDb();
  });
  beforeEach(async () => {
    await cleanPair();
  });
  afterAll(async () => {
    await cleanPair();
    await cleanupTestDb();
  });

  it('the SME-on-BSE and MAINBOARD plans differ for this row (the test can fail)', () => {
    const a = ranks(smeBse);
    const b = ranks(mainboardBse);
    expect([...b].some(([k, v]) => a.get(k) !== v) || a.size !== b.size).toBe(true);
  });

  it('a relaunch merge refills segment MAINBOARD and rebuilds the plan; the unmerge restores SME and rebuilds back', async () => {
    const repo = new IPORepository(db as never, noRedis);
    await mk(repo, OLD, 'merge-rebuild-1402', '2026-06-23', '98402', 'SME', 'POSTPONED');
    await mk(repo, NEW, 'merge-rebuild-1402-o', '2026-08-19', '98403', 'MAINBOARD', 'UPCOMING');
    const planRows = generateFieldPlan(smeBse, manifest);
    await db.insert(schema.ipoFieldPlan).values(
      planRows.map((r) => ({
        ipoId: OLD, tableName: r.tableName, rowKey: '', fieldName: r.fieldName,
        rank1Source: r.rank1Source, rank2Source: r.rank2Source, rank3Source: r.rank3Source,
        state: 'PENDING' as const, attempts: 0, manifestVersion: r.manifestVersion, policyOrigin: r.policyOrigin,
      }))
    );
    const { isRelaunchDocumentField } = await import('../../src/services/relaunch-clear');
    await repo.mergeDuplicateInto(OLD, NEW, { apply: true, mergedBy: 'issue1402.test', isRelaunchDocumentField, planManifest: manifest } as never);
    const [merged] = await db.select({ s: schema.ipos.segment }).from(schema.ipos).where(eq(schema.ipos.id, OLD));
    expect(merged.s).toBe('MAINBOARD');
    expect(await oldRank1()).toEqual(ranks(mainboardBse));

    const mergeId = (await db.execute(sql`SELECT id::text AS id FROM ipo_merge_log WHERE drop_ipo_id = ${NEW}::uuid`)).rows[0].id;
    // The merge log is written before the relaunch refill (#1298), so today it never lists segment
    // and the unmerge never restores it. Name segment in the logged patch (the survivor's logged
    // before-row already holds SME), so the unmerge's restore of a plan input is exercised.
    await db.execute(sql`
      UPDATE ipo_merge_log
         SET survivor_patch = jsonb_set(survivor_patch, '{patch}',
               coalesce(survivor_patch->'patch', '[]'::jsonb) || '[{"column":"segment","value":"MAINBOARD","source":"DRHP","confidence":95,"note":"1402 test"}]'::jsonb)
       WHERE id = ${mergeId}::uuid`);
    await repo.unmergeDuplicate(mergeId, { apply: true, unmergedBy: 'issue1402.test', planManifest: manifest } as never);
    const [restored] = await db.select({ s: schema.ipos.segment }).from(schema.ipos).where(eq(schema.ipos.id, OLD));
    expect(restored.s).toBe('SME');
    expect(await oldRank1()).toEqual(ranks(smeBse));
  }, 120_000);
});

/**
 * #1408 review r3: repair-source-trust-batch-t292 --apply wrote offering_type (FPO -> IPO, IPO ->
 * RIGHTS) through a bare `db.update(ipos)`, leaving the plan on the old type's not-applicable set.
 */
describe('#1402 r3: repair-source-trust-batch-t292 offering_type write rebuilds the plan', () => {
  const ID = '00000000-0000-4000-8000-0000000014b1';
  const rights: PlanIpo = { id: ID, segment: 'MAINBOARD', listingExchanges: ['NSE'], offeringType: 'RIGHTS' };
  const ipoType: PlanIpo = { id: ID, segment: 'MAINBOARD', listingExchanges: ['NSE'], offeringType: 'IPO' };
  const rank1 = async () =>
    new Map(
      (await db.select({ t: schema.ipoFieldPlan.tableName, f: schema.ipoFieldPlan.fieldName, r: schema.ipoFieldPlan.rank1Source })
        .from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, ID))).map((x: any) => [`${x.t}.${x.f}`, x.r])
    );
  const keys = (ipo: PlanIpo) => new Set(generateFieldPlan(ipo, manifest).map((r) => `${r.tableName}.${r.fieldName}`));
  async function clean() {
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, ID));
    await db.execute(sql`DELETE FROM audit_logs WHERE ipo_id = ${ID}::uuid`);
    await db.execute(sql`DELETE FROM ipos WHERE id = ${ID}::uuid`);
  }
  beforeAll(async () => {
    db = await getTestDb();
  });
  beforeEach(async () => {
    await clean();
    await db.insert(schema.ipos).values({
      id: ID, slug: 'issue-1402-t292-rebuild', companyName: 'Issue 1402 T292 Limited', status: 'UPCOMING',
      segment: 'MAINBOARD', offeringType: 'IPO', listingExchanges: ['NSE'],
    } as never);
    const rows = generateFieldPlan(ipoType, manifest);
    await db.insert(schema.ipoFieldPlan).values(
      rows.map((r) => ({
        ipoId: ID, tableName: r.tableName, rowKey: '', fieldName: r.fieldName,
        rank1Source: r.rank1Source, rank2Source: r.rank2Source, rank3Source: r.rank3Source,
        state: 'PENDING' as const, attempts: 0, manifestVersion: r.manifestVersion, policyOrigin: r.policyOrigin,
      }))
    );
  });
  afterAll(async () => {
    await clean();
    await cleanupTestDb();
  });

  it('the IPO and RIGHTS plans differ for this row (the test can fail)', () => {
    expect(keys(rights)).not.toEqual(keys(ipoType));
  });

  it('writeSourceTrustRepairRow: IPO -> RIGHTS rebuilds the plan in the same transaction', async () => {
    const n = await writeSourceTrustRepairRow(db, { ipoId: ID, set: { offeringType: 'RIGHTS', lotSize: null }, manifest });
    expect(n).toBe(1);
    const [row] = await db.select({ t: schema.ipos.offeringType }).from(schema.ipos).where(eq(schema.ipos.id, ID));
    expect(row.t).toBe('RIGHTS');
    expect(new Set((await rank1()).keys())).toEqual(keys(rights));
  });

  it('a row that does not exist reports 0 and writes nothing', async () => {
    expect(await writeSourceTrustRepairRow(db, { ipoId: '00000000-0000-4000-8000-00000000dead', set: { offeringType: 'RIGHTS' }, manifest })).toBe(0);
  });
});
