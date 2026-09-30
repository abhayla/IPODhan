import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool, Client } from 'pg';
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
import { plantFieldPlanForIpo, createIpoTypeShareLock } from '../../src/services/field-plan-planting';
import { IpoFieldPlanRepository } from '@ipodhan/shared/repositories';

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
  await db.execute(sql`DELETE FROM field_source_overrides WHERE ipo_id = ${IPO}::uuid`);
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
    // The plan equals the generator's for the corrected offering type: the ranks are unchanged, and
    // every field the manifest's `na` list makes not applicable to a BUYBACK is no longer planned.
    const expected = generateFieldPlan({ id: IPO, segment: 'MAINBOARD', listingExchanges: ['BSE'], offeringType: 'BUYBACK' }, manifest);
    const typeOnly = generateFieldPlan({ id: IPO, segment: 'MAINBOARD', listingExchanges: ['BSE'] }, manifest);
    const naForBuyback = typeOnly.filter((r) => (manifest.fields[key(r)] as { na?: string[] }).na?.includes('BUYBACK')).length;
    expect(naForBuyback).toBeGreaterThan(0);
    expect(expected.length).toBe(typeOnly.length - naForBuyback);
    const after = await planRows();
    expect(after.map(key).sort()).toEqual(expected.map(key).sort());
    expect(after.map(key)).not.toContain('ipos.lot_size');
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
  it('MAJOR-1: a cycle that read the IPO BEFORE the admin save never re-plants the old type (plant under the ipos lock)', async () => {
    // The cycle's normal plant for the MAINBOARD IPO it selected at the start of the wake.
    const stale = { id: IPO, segment: 'MAINBOARD' as const, listingExchanges: ['BSE' as const] };
    const lock = createIpoTypeShareLock(db as never, (tx) => new IpoFieldPlanRepository(tx as never, undefined as never));
    const deps = (m = manifest) => ({ fieldPlanRepository: new IpoFieldPlanRepository(db as never, undefined as never), lockIpoType: lock, manifest: m });
    await plantFieldPlanForIpo(stale, deps());

    // The admin corrects the segment while the wake is still running; the plan is rebuilt to SME_BSE.
    expect((await save('segment', 'SME')).kind).toBe('OK');

    // The same wake now reaches its plant step with the snapshot it read before the save.
    await plantFieldPlanForIpo(stale, deps());

    const sme = generateFieldPlan({ id: IPO, segment: 'SME', listingExchanges: ['BSE'] }, manifest);
    const smeRank1 = new Map(sme.map((r) => [key(r), r.rank1Source]));
    const after = await planRows();
    // No row of the old type appears ...
    expect(after.map(key).sort()).toEqual(sme.map(key).sort());
    // ... and no PENDING row moved back to the old type's rank-1 source.
    for (const r of after.filter((x) => x.state === 'PENDING')) expect(r.rank1Source).toBe(smeRank1.get(key(r)));
  });

  it('MINOR: an offering_type save alone (type key unchanged) re-versions and deletes nothing', async () => {
    const planted = await plantSupplied({ id: IPO, segment: 'MAINBOARD', listingExchanges: ['BSE'] });
    const oldVersion = planted[0].manifestVersion - 1;
    await db.execute(sql`UPDATE ipo_field_plan SET manifest_version = ${oldVersion} WHERE ipo_id = ${IPO}::uuid`);
    const ids = async () => (await db.select({ id: schema.ipoFieldPlan.id, v: schema.ipoFieldPlan.manifestVersion }).from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO))).map((r) => `${r.id}|${r.v}`).sort();
    const before = await ids();
    expect((await save('offeringType', 'IPO')).kind).toBe('OK');
    expect(await ids()).toEqual(before);
    const audit = (await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.ipoId, IPO), eq(schema.auditLogs.fieldName, 'offeringType'))))[0];
    expect((audit.details as Record<string, unknown>).planRebuild).toMatchObject({ rebuilt: false });
  });

  it("MINOR: a held field's walk-read stamp survives its row being re-planted", async () => {
    await plantSupplied({ id: IPO, segment: 'MAINBOARD', listingExchanges: ['BSE'] });
    const readAt = new Date('2026-09-21T05:00:00Z');
    await db.execute(sql`
      UPDATE ipo_field_plan SET state = 'PENDING', chosen_source = NULL, cause = '[held-read:UPCOMING|0] earlier cause',
             last_attempt_at = ${readAt.toISOString()}::timestamp, next_due_at = NULL
       WHERE ipo_id = ${IPO}::uuid AND table_name = 'ipos' AND field_name = 'open_date'`);
    expect((await save('segment', 'SME')).kind).toBe('OK');
    const [row] = (await db.execute(sql`
      SELECT rank1_source, cause, last_attempt_at::text AS last_attempt_at, next_due_at FROM ipo_field_plan
       WHERE ipo_id = ${IPO}::uuid AND table_name = 'ipos' AND field_name = 'open_date'`)).rows as Array<Record<string, unknown>>;
    const sme = generateFieldPlan({ id: IPO, segment: 'SME', listingExchanges: ['BSE'] }, manifest).find((r) => key(r) === 'ipos.open_date')!;
    expect(row.rank1_source).toBe(sme.rank1Source);
    expect(String(row.cause)).toMatch(/^\[held-read:UPCOMING\|0\]/);
    expect(row.last_attempt_at).toBe('2026-09-21 05:00:00');
    expect(row.next_due_at).toBeNull();
  });

  it('MAJOR-1 concurrency: a plant that starts while a segment save holds the ipos row WAITS, then plants only the new type', async () => {
    // Two dedicated connections (not the pool): A plays the admin save, B runs the production plant.
    const a = new Client({ connectionString: DATABASE_URL, options: '-c timezone=UTC' });
    const b = new Client({ connectionString: DATABASE_URL, options: '-c timezone=UTC' });
    await a.connect();
    await b.connect();
    const events: string[] = [];
    let plant: Promise<Awaited<ReturnType<typeof plantFieldPlanForIpo>>> | undefined;
    let lockWait: unknown;
    try {
      const bPid = Number(((await b.query('SELECT pg_backend_pid() AS pid')).rows[0] as { pid: number }).pid);
      // A: the admin save's lock and its uncommitted segment change, held open.
      await a.query('BEGIN');
      await a.query('SELECT id FROM ipos WHERE id = $1::uuid FOR NO KEY UPDATE', [IPO]);
      await a.query(`UPDATE ipos SET segment = 'SME' WHERE id = $1::uuid`, [IPO]);
      events.push('A-locked');

      // B: the cycle plants with the MAINBOARD snapshot it read before the save.
      const dbB = drizzle(b, { schema });
      const lock = createIpoTypeShareLock(dbB as never, (tx) => new IpoFieldPlanRepository(tx as never, undefined as never));
      const stale = { id: IPO, segment: 'MAINBOARD' as const, listingExchanges: ['BSE' as const] };
      events.push('plant-started');
      plant = plantFieldPlanForIpo(stale, {
        fieldPlanRepository: new IpoFieldPlanRepository(dbB as never, undefined as never),
        lockIpoType: lock,
        manifest,
      }).then((r) => {
        events.push('plant-finished');
        return r;
      });

      // Waiting ON A LOCK, not merely slow: poll (up to 5 s) until B's backend reports a Lock wait on
      // its FOR SHARE read while A is open. A plant that never locks finishes instead and never waits.
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && !events.includes('plant-finished')) {
        const row = (await db.execute(sql`SELECT wait_event_type, query FROM pg_stat_activity WHERE pid = ${bPid}`)).rows[0] as
          | { wait_event_type: string | null; query: string }
          | undefined;
        if (row?.wait_event_type === 'Lock') {
          lockWait = { wait_event_type: row.wait_event_type, forShare: /FOR SHARE/.test(row.query) };
          break;
        }
        await new Promise((r) => setTimeout(r, 25));
      }
      // Still blocked 300 ms later: the wait is on A, not a transient.
      await new Promise((r) => setTimeout(r, 300));
      if (!events.includes('plant-finished')) events.push('plant-still-pending@300ms');

      await a.query('COMMIT');
      events.push('A-committed');
      const result = await plant;

      expect(events).toEqual(['A-locked', 'plant-started', 'plant-still-pending@300ms', 'A-committed', 'plant-finished']);
      expect(lockWait).toEqual({ wait_event_type: 'Lock', forShare: true });
      const sme = generateFieldPlan({ id: IPO, segment: 'SME', listingExchanges: ['BSE'] }, manifest);
      expect(result.inserted).toBe(sme.length);
      const after = await planRows();
      expect(after.map(key).sort()).toEqual(sme.map(key).sort());
      const smeRank1 = new Map(sme.map((r) => [key(r), r.rank1Source]));
      for (const r of after) expect(r.rank1Source).toBe(smeRank1.get(key(r)));
      // The old type's plan differs, so the check above could have failed.
      const mainboard = generateFieldPlan(stale, manifest);
      expect(mainboard.map(key).sort()).not.toEqual(sme.map(key).sort());
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      if (plant) await plant.catch(() => undefined);
      await a.end();
      await b.end();
    }
  });

  it('m1: an override with a rank gap [r1, null, r3] is planned as [r1, r3] by the admin rebuild', async () => {
    await plantSupplied({ id: IPO, segment: 'MAINBOARD', listingExchanges: ['BSE'] });
    const mbOpen = generateFieldPlan({ id: IPO, segment: 'MAINBOARD', listingExchanges: ['BSE'] }, manifest).find((r) => key(r) === 'ipos.open_date')!;
    const [r1, r3] = ['CHITTORGARH', 'NSE'];
    expect(mbOpen.rank1Source).not.toBe(r1);
    await db.execute(sql`
      INSERT INTO field_source_overrides (table_name, field_name, ipo_id, rank1_source, rank2_source, rank3_source, reason, set_by, expires_at)
      VALUES ('ipos', 'open_date', ${IPO}::uuid, ${r1}, NULL, ${r3}, 'item18 rank-gap test', 'item18-admin', now() + interval '1 day')`);
    expect((await save('segment', 'SME')).kind).toBe('OK');
    const [row] = (await db.execute(sql`
      SELECT rank1_source, rank2_source, rank3_source, policy_origin FROM ipo_field_plan
       WHERE ipo_id = ${IPO}::uuid AND table_name = 'ipos' AND field_name = 'open_date'`)).rows as Array<Record<string, unknown>>;
    expect(row).toMatchObject({ rank1_source: r1, rank2_source: r3, rank3_source: null });
    expect(String(row.policy_origin)).toMatch(/^override:/);
  });
});
