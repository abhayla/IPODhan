import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql, inArray, eq } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { writeIposRebuildingPlanInTx } from '@ipodhan/shared/services/plan-invalidating-rebuild';
import { getTestDb, cleanupTestDb } from '../test-utils/db';
import { generateFieldPlan, type PlanIpo } from '../../src/services/field-plan-generator';
import { loadPlanManifest } from '../../src/config/field-manifest-loader';
import { writeSegmentRepairRow, applySegmentRepairs } from '../../scripts/repair-segment-provenance';

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
