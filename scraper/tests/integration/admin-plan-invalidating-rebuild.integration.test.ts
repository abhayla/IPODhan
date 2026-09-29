import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq, and } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import {
  writeAdminFieldValue,
  readAdminFieldVersion,
  type AdminFieldWriteInput,
} from '@ipodhan/shared/services/admin-field-write';
import { generateFieldPlan, type PlanIpo } from '../../src/services/field-plan-generator';
import { loadFieldManifest } from '../../src/config/field-manifest-loader';

/**
 * Contract 2 Phase B item 18 core proof (spec §9.2 item 18, §2.8, §1.11, OD-35):
 *   an admin save of offering_type / segment / listing_exchanges rebuilds that IPO's plan inside the
 *   same save, keeping plan rows whose rank-1 source is unchanged, and fixes the SAME ipos row.
 * The expected plan is the scraper's own generator (`generateFieldPlan`) for the corrected type.
 * Runs against ipodhan_test through the tunnel:
 *   DATABASE_URL=postgresql://ipodhan_app:$PW@localhost:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts tests/integration/admin-plan-invalidating-rebuild.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8000-0000000a1801';
const SLUG = 'item18-plan-invalidating-proof-ipo';
const manifest = loadFieldManifest();

let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function cleanup() {
  await db.delete(schema.ipoFieldPlan).where(inArray(schema.ipoFieldPlan.ipoId, [IPO]));
  await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, [IPO]));
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, [IPO]));
  await db.delete(schema.fieldProtectionMetadata).where(inArray(schema.fieldProtectionMetadata.ipoId, [IPO]));
  await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
}

/** Plant the plan exactly as the cycle does (rowKey ''), every row SUPPLIED by its rank-1 source. */
async function plantSupplied(ipo: PlanIpo) {
  const rows = generateFieldPlan(ipo, manifest);
  const at = new Date('2026-09-20T05:00:00Z');
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
      lastAttemptAt: at,
      manifestVersion: r.manifestVersion,
      policyOrigin: r.policyOrigin,
    }))
  );
  return rows;
}

const planRows = () =>
  db
    .select({
      tableName: schema.ipoFieldPlan.tableName,
      rowKey: schema.ipoFieldPlan.rowKey,
      fieldName: schema.ipoFieldPlan.fieldName,
      rank1Source: schema.ipoFieldPlan.rank1Source,
      rank2Source: schema.ipoFieldPlan.rank2Source,
      rank3Source: schema.ipoFieldPlan.rank3Source,
      state: schema.ipoFieldPlan.state,
      chosenSource: schema.ipoFieldPlan.chosenSource,
      attempts: schema.ipoFieldPlan.attempts,
    })
    .from(schema.ipoFieldPlan)
    .where(eq(schema.ipoFieldPlan.ipoId, IPO));

const key = (r: { tableName: string; fieldName: string }) => `${r.tableName}.${r.fieldName}`;

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
      actor: { name: 'item18-admin', adminId: 'admin-it' },
      entryPoint: 'test',
      ...over,
    },
    undefined,
    { planManifest: manifest }
  );
}

describe.skipIf(!DATABASE_URL)('item 18: plan-invalidating admin saves rebuild the plan (ipodhan_test)', () => {
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
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, offering_type, segment, listing_exchanges, lot_size)
      VALUES (${IPO}::uuid, 'Item18 Proof Limited', ${SLUG}, 'MAINBOARD', 'UPCOMING', 'FPO', 'MAINBOARD', '["BSE"]'::jsonb, 1200)`);
  });

  it('CORE: FPO/MAINBOARD corrected to IPO/SME rebuilds the plan to the SME plan, keeps unchanged rank-1 rows, same ipos row, audited', async () => {
    const before = await plantSupplied({ id: IPO, segment: 'MAINBOARD', listingExchanges: ['BSE'] });

    const t = await save('offeringType', 'IPO');
    expect(t.kind).toBe('OK');
    const s = await save('segment', 'SME');
    expect(s.kind).toBe('OK');

    // SAME row: no second ipos row, same id (§2.8 Mopshop precedent; OD-35 is about a new offering).
    const same = await db.select({ id: schema.ipos.id, offeringType: schema.ipos.offeringType, segment: schema.ipos.segment }).from(schema.ipos).where(eq(schema.ipos.slug, SLUG));
    expect(same).toEqual([{ id: IPO, offeringType: 'IPO', segment: 'SME' }]);

    // The plan is exactly what the generator produces for the corrected type.
    const expected = generateFieldPlan({ id: IPO, segment: 'SME', listingExchanges: ['BSE'] }, manifest);
    const after = await planRows();
    const project = (rows: { tableName: string; fieldName: string; rank1Source: string | null; rank2Source: string | null; rank3Source: string | null }[]) =>
      rows.map((r) => `${key(r)}|${r.rank1Source}|${r.rank2Source}|${r.rank3Source}`).sort();
    expect(project(after)).toEqual(project(expected));
    expect(after.every((r) => r.rowKey === '')).toBe(true);

    // Unchanged rank 1 -> the settled row is kept; changed rank 1 -> dropped and re-asked.
    const beforeRank1 = new Map(before.map((r) => [key(r), r.rank1Source]));
    const kept = after.filter((r) => beforeRank1.get(key(r)) === r.rank1Source);
    const rebuilt = after.filter((r) => beforeRank1.get(key(r)) !== r.rank1Source);
    expect(kept.length).toBeGreaterThan(100);
    expect(rebuilt.length).toBeGreaterThan(0);
    for (const r of kept) expect(r).toMatchObject({ state: 'SUPPLIED', chosenSource: r.rank1Source, attempts: 1 });
    for (const r of rebuilt) expect(r).toMatchObject({ state: 'PENDING', chosenSource: null, attempts: 0 });
    expect(rebuilt.map(key)).toContain('ipos.open_date');
    // A field the SME_BSE type ranks no source for is no longer planned.
    expect(after.map(key)).not.toContain('listing_performance.current_price_nse');

    // Audit rows for both saves, the segment one recording the rebuild.
    const audits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.ipoId, IPO));
    const seg = audits.find((a) => a.fieldName === 'segment');
    expect(seg).toMatchObject({ oldValue: 'MAINBOARD', newValue: 'SME', success: true });
    expect((seg!.details as Record<string, unknown>).planRebuild).toMatchObject({ typeKeyBefore: 'MAINBOARD', typeKeyAfter: 'SME_BSE' });
    expect(audits.find((a) => a.fieldName === 'offeringType')).toMatchObject({ oldValue: 'FPO', newValue: 'IPO' });
  });

  it('listing_exchanges BSE -> NSE on an SME IPO rebuilds SME_BSE to SME_NSE', async () => {
    await db.execute(sql`UPDATE ipos SET segment = 'SME' WHERE id = ${IPO}::uuid`);
    await plantSupplied({ id: IPO, segment: 'SME', listingExchanges: ['BSE'] });
    const r = await save('listingExchanges', ['NSE']);
    expect(r.kind).toBe('OK');
    const expected = generateFieldPlan({ id: IPO, segment: 'SME', listingExchanges: ['NSE'] }, manifest);
    const after = await planRows();
    expect(after.map((x) => `${key(x)}|${x.rank1Source}|${x.rank2Source}|${x.rank3Source}`).sort()).toEqual(
      expected.map((x) => `${key(x)}|${x.rank1Source}|${x.rank2Source}|${x.rank3Source}`).sort()
    );
  });

  it('§1.11: a type the correction makes not-applicable (lot size on a BUYBACK) keeps the admin value in the audit row only', async () => {
    await plantSupplied({ id: IPO, segment: 'MAINBOARD', listingExchanges: ['BSE'] });
    const lot = await save('lotSize', 1500);
    expect(lot.kind).toBe('OK');
    const r = await save('offeringType', 'BUYBACK');
    expect(r.kind).toBe('OK');
    // The manifest's type rule marks the field not-applicable for the new type (the page hides it).
    expect((manifest.fields['ipos.lot_size'] as { na?: string[] }).na).toContain('BUYBACK');
    const lotAudit = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.ipoId, IPO), eq(schema.auditLogs.fieldName, 'lotSize')));
    expect(lotAudit).toHaveLength(1);
    expect(lotAudit[0]).toMatchObject({ newValue: '1500', success: true });
    // The plan still equals the generator's (offering type does not change ranks today).
    const expected = generateFieldPlan({ id: IPO, segment: 'MAINBOARD', listingExchanges: ['BSE'] }, manifest);
    expect((await planRows()).length).toBe(expected.length);
  });

  it('fail-closed: a plan-invalidating save without the plan manifest is refused and writes nothing', async () => {
    const v = await readAdminFieldVersion(db as never, IPO, 'ipos', 'segment');
    const r = await writeAdminFieldValue(db as never, {
      ipoId: IPO,
      tableName: 'ipos',
      fieldName: 'segment',
      value: 'SME',
      mode: { kind: 'typed', sourceNote: 'RHP cover page' },
      expectedVersion: v!.version,
      actor: { name: 'item18-admin', adminId: 'admin-it' },
      entryPoint: 'test',
    });
    expect(r.kind).toBe('INVALID');
    const [row] = await db.select({ segment: schema.ipos.segment }).from(schema.ipos).where(eq(schema.ipos.id, IPO));
    expect(row.segment).toBe('MAINBOARD');
  });
});
