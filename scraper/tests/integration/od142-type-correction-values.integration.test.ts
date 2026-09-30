import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { writeAdminFieldValue, readAdminFieldVersion, type AdminFieldWriteInput } from '@ipodhan/shared/services/admin-field-write';
import { SOURCE_NO_LONGER_FIRST } from '@ipodhan/shared/services/source-no-longer-first';
import { IpoFieldPlanRepository } from '@ipodhan/shared/repositories';
import { generateFieldPlan, type PlanIpo } from '../../src/services/field-plan-generator';
import { loadFieldManifest } from '../../src/config/field-manifest-loader';

/**
 * OD-142 core proof (spec §2.8, §9.2 item 18; owner 2026-09-29): after an admin corrects the
 * Mopshop shape FPO/MAINBOARD -> IPO/SME, a still-applicable field whose rank-1 source changed
 * (ipos.open_date: NSE -> BSE) KEEPS its stored value and provenance and gets exactly one
 * "source no longer first" queue item; the item clears only when the NEW rank-1 source answers
 * (the real plan repository's recordOutcome, the walk's own write of a SUPPLIED answer).
 * Runs against ipodhan_test through the tunnel (DATABASE_URL, never printed):
 *   npx vitest run -c vitest.integration.config.ts tests/integration/od142-type-correction-values.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8000-0000000d1420';
const SLUG = 'od142-type-correction-proof-ipo';
const manifest = loadFieldManifest();

let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function cleanup() {
  await db.execute(sql`DELETE FROM data_conflicts WHERE ipo_id = ${IPO}::uuid`);
  await db.delete(schema.ipoFieldPlan).where(inArray(schema.ipoFieldPlan.ipoId, [IPO]));
  await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, [IPO]));
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, [IPO]));
  await db.delete(schema.fieldProtectionMetadata).where(inArray(schema.fieldProtectionMetadata.ipoId, [IPO]));
  await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
}

async function plantSupplied(ipo: PlanIpo) {
  const rows = generateFieldPlan(ipo, manifest);
  await db.insert(schema.ipoFieldPlan).values(
    rows.map((r) => ({
      ipoId: r.ipoId,
      tableName: r.tableName,
      rowKey: '',
      fieldName: r.fieldName,
      rank1Source: r.rank1Source,
      rank2Source: r.rank2Source,
      rank3Source: r.rank3Source,
      state: 'SUPPLIED' as const,
      chosenSource: r.rank1Source,
      chosenRank: 1,
      attempts: 1,
      lastAttemptAt: new Date('2026-09-20T05:00:00Z'),
      manifestVersion: r.manifestVersion,
      policyOrigin: r.policyOrigin,
    }))
  );
}

async function save(fieldName: string, value: unknown, over: Partial<AdminFieldWriteInput> = {}) {
  const v = await readAdminFieldVersion(db as never, IPO, 'ipos', fieldName);
  return writeAdminFieldValue(
    db as never,
    {
      ipoId: IPO,
      tableName: 'ipos',
      fieldName,
      value,
      mode: { kind: 'typed', sourceNote: 'RHP cover page' },
      expectedVersion: v!.version,
      actor: { name: 'od142-admin', adminId: 'admin-it' },
      entryPoint: 'test',
      ...over,
    },
    undefined,
    { planManifest: manifest }
  );
}

const openItems = async () =>
  (
    await db.execute(sql`
      SELECT field_name, table_name, row_key, source1::text AS source1, value1, source2::text AS source2, value2,
             evidence->>'oldRank1' AS old_rank1, evidence->>'newRank1' AS new_rank1
        FROM data_conflicts
       WHERE ipo_id = ${IPO}::uuid AND resolved_at IS NULL AND resolution_reason = ${SOURCE_NO_LONGER_FIRST}
       ORDER BY field_name`)
  ).rows as Array<Record<string, string | null>>;

describe.skipIf(!DATABASE_URL)('OD-142: values after a type/segment correction (ipodhan_test)', () => {
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
    // Mopshop shape: stored FPO / MAINBOARD, BSE-listed; open_date came from NSE (MAINBOARD rank 1).
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, offering_type, segment, listing_exchanges, open_date, lot_size)
      VALUES (${IPO}::uuid, 'OD142 Proof Distribution Limited', ${SLUG}, 'MAINBOARD', 'UPCOMING', 'FPO', 'MAINBOARD',
              '["BSE"]'::jsonb, '2026-10-05', 1200)`);
    await db.execute(sql`
      INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, updated_by)
      VALUES (${IPO}::uuid, 'ipos', '', 'openDate', 'NSE', 90, 'test')`);
    await plantSupplied({ id: IPO, segment: 'MAINBOARD', listingExchanges: ['BSE'] });
  });

  it('CORE: a still-applicable field whose rank 1 moved keeps its value + provenance and gets ONE queue item', async () => {
    expect((await save('offeringType', 'IPO')).kind).toBe('OK');
    const seg = await save('segment', 'SME');
    expect(seg.kind).toBe('OK');
    expect(seg.kind === 'OK' && seg.planRebuild).toMatchObject({ typeKeyAfter: 'SME_BSE', rebuilt: true, queued: 2 });

    // Value kept on the row, provenance untouched (no silent re-attribution).
    const [ipo] = await db.select({ openDate: schema.ipos.openDate }).from(schema.ipos).where(eq(schema.ipos.id, IPO));
    expect(String(ipo.openDate)).toContain('2026-10-05');
    const fs = await db.execute(sql`SELECT source::text AS source FROM field_sources WHERE ipo_id = ${IPO}::uuid AND field_name = 'openDate'`);
    expect(fs.rows).toEqual([{ source: 'NSE' }]);

    // One item per re-planted field that still holds a value: open_date (kept from NSE, its real
    // provenance) and status (stored UPCOMING, no provenance row: labelled with the plan's old rank 1,
    // evidence.keptFrom null). The other re-planted fields hold no value: plain missing, no item.
    expect(await openItems()).toEqual([
      { field_name: 'openDate', table_name: 'ipos', row_key: '', source1: 'NSE', value1: '2026-10-05', source2: 'BSE', value2: null, old_rank1: 'NSE', new_rank1: 'BSE' },
      { field_name: 'status', table_name: 'ipos', row_key: '', source1: 'NSE', value1: 'UPCOMING', source2: 'BSE', value2: null, old_rank1: 'NSE', new_rank1: 'BSE' },
    ]);
    const kept = await db.execute(sql`SELECT field_name, evidence->>'keptFrom' AS kept_from FROM data_conflicts WHERE ipo_id = ${IPO}::uuid AND resolved_at IS NULL ORDER BY field_name`);
    expect(kept.rows).toEqual([{ field_name: 'openDate', kept_from: 'NSE' }, { field_name: 'status', kept_from: null }]);

    // A second rebuild (segment flips back and forth) never leaves two open items for one field.
    // Back to MAINBOARD: open_date's kept value came FROM the new rank 1 (NSE) -> no item; status's
    // provenance is unknown -> still one item (superseded, not duplicated), now naming rank 1 NSE.
    expect((await save('segment', 'MAINBOARD')).kind).toBe('OK');
    expect((await openItems()).map((r) => `${r.field_name}:${r.new_rank1}`)).toEqual(['status:NSE']);
    expect((await save('segment', 'SME')).kind).toBe('OK');
    expect((await openItems()).map((r) => r.field_name)).toEqual(['openDate', 'status']);
  });

  it('the item clears only when the NEW rank-1 source answers (real recordOutcome); a lower rank does not clear it', async () => {
    await save('offeringType', 'IPO');
    await save('segment', 'SME');
    const repo = new IpoFieldPlanRepository(db as never, null as never);
    const [row] = await db
      .select({ id: schema.ipoFieldPlan.id, rank1: schema.ipoFieldPlan.rank1Source, rank2: schema.ipoFieldPlan.rank2Source })
      .from(schema.ipoFieldPlan)
      .where(sql`${schema.ipoFieldPlan.ipoId} = ${IPO}::uuid AND ${schema.ipoFieldPlan.fieldName} = 'open_date'`);
    expect(row.rank1).toBe('BSE');

    const claim = async (token: string) =>
      db.execute(sql`UPDATE ipo_field_plan SET claim_token = ${token}, claimed_at = now() WHERE id = ${row.id}::uuid`);

    // A rank-2 answer: SUPPLIED, but not from rank 1 -> the item stays.
    await claim('t-rank2');
    const r2 = await repo.recordOutcome({
      planRowId: row.id,
      claimToken: 't-rank2',
      writeHappened: true,
      state: 'SUPPLIED',
      chosen: { source: row.rank2 ?? 'CHITTORGARH', rank: 2 },
    } as never);
    expect(r2.written).toBe(true);
    expect((await openItems()).map((r) => r.field_name)).toEqual(['openDate', 'status']);

    // The new rank 1 (BSE) answers -> the item leaves the queue, recorded as RANK1_ANSWERED.
    await claim('t-rank1');
    const r1 = await repo.recordOutcome({
      planRowId: row.id,
      claimToken: 't-rank1',
      writeHappened: true,
      state: 'SUPPLIED',
      chosen: { source: 'BSE', rank: 1 },
    } as never);
    expect(r1.written).toBe(true);
    // Only open_date's item clears; status's rank 1 has not answered.
    expect((await openItems()).map((r) => r.field_name)).toEqual(['status']);
    const closed = await db.execute(sql`
      SELECT admin_note FROM data_conflicts WHERE ipo_id = ${IPO}::uuid AND resolution_reason = ${SOURCE_NO_LONGER_FIRST} AND resolved_at IS NOT NULL`);
    expect(closed.rows).toEqual([{ admin_note: 'OD-142 RANK1_ANSWERED' }]);
  });

  it('provenance: a kept value from a lower-ranked source is labelled with THAT source, never the old rank 1', async () => {
    await db.execute(sql`UPDATE ipos SET close_date = '2026-10-08' WHERE id = ${IPO}::uuid`);
    await db.execute(sql`
      INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, updated_by)
      VALUES (${IPO}::uuid, 'ipos', '', 'closeDate', 'CHITTORGARH', 60, 'test')`);
    await save('offeringType', 'IPO');
    await save('segment', 'SME');
    const close = (await openItems()).find((r) => r.field_name === 'closeDate');
    expect(close).toMatchObject({ source1: 'CHITTORGARH', value1: '2026-10-08', source2: 'BSE', old_rank1: 'NSE', new_rank1: 'BSE' });
    const fs = await db.execute(sql`SELECT source::text AS source FROM field_sources WHERE ipo_id = ${IPO}::uuid AND field_name = 'closeDate'`);
    expect(fs.rows).toEqual([{ source: 'CHITTORGARH' }]);
  });

  it('an admin-held field is never queued and never blanked by the correction (§2.7)', async () => {
    expect((await save('openDate', '2026-10-06')).kind).toBe('OK');
    await save('offeringType', 'IPO');
    const seg = await save('segment', 'SME');
    expect(seg.kind === 'OK' && seg.planRebuild).toMatchObject({ queued: 1 });
    expect((await openItems()).map((r) => r.field_name)).toEqual(['status']);
    const [ipo] = await db.select({ openDate: schema.ipos.openDate }).from(schema.ipos).where(eq(schema.ipos.id, IPO));
    expect(String(ipo.openDate)).toContain('2026-10-06');
  });

  it('an admin save on the queued field clears its item (the field is the admin\'s now)', async () => {
    await save('offeringType', 'IPO');
    await save('segment', 'SME');
    expect((await openItems()).map((r) => r.field_name)).toEqual(['openDate', 'status']);
    expect((await save('openDate', '2026-10-07')).kind).toBe('OK');
    expect((await openItems()).map((r) => r.field_name)).toEqual(['status']);
  });

  it('a field the corrected type no longer plans loses its open item (not applicable, item 18)', async () => {
    // SME_NSE -> SME_BSE drops listing_performance.current_price_nse (its SME_BSE rank list is empty).
    await db.execute(sql`DELETE FROM ipo_field_plan WHERE ipo_id = ${IPO}::uuid`);
    await db.execute(sql`UPDATE ipos SET segment = 'SME', listing_exchanges = '["NSE"]'::jsonb WHERE id = ${IPO}::uuid`);
    await plantSupplied({ id: IPO, segment: 'SME', listingExchanges: ['NSE'] });
    await db.execute(sql`
      INSERT INTO data_conflicts (ipo_id, table_name, row_key, field_name, source1, value1, source2, value2, resolution_reason, evidence)
      VALUES (${IPO}::uuid, 'listing_performance', '', 'currentPriceNse', 'NSE', '101', 'NSE', NULL, ${SOURCE_NO_LONGER_FIRST},
              '{"origin":"SOURCE_NO_LONGER_FIRST","newRank1":"NSE"}'::jsonb)`);
    expect((await save('listingExchanges', ['BSE'])).kind).toBe('OK');
    const planned = await db.execute(sql`SELECT 1 FROM ipo_field_plan WHERE ipo_id = ${IPO}::uuid AND field_name = 'current_price_nse'`);
    expect(planned.rows).toEqual([]);
    expect((await openItems()).map((r) => r.field_name)).not.toContain('currentPriceNse');
  });
});
