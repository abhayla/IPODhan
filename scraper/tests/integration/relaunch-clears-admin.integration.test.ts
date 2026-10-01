/**
 * §9.2 item 27 (OD-120), items 28(c) and 8, §2.9, OD-83, OD-86 on the real database (ipodhan_test only).
 *
 * Admin values on a POSTPONED IPO's document fields (and its admin-owned lists) are cleared ONLY by a
 * relaunch filing: the OD-83 source-key supersede (or the OD-86 merge), or an RHP / PROSPECTUS /
 * PRICE_BAND_AD first discovered after the postponement whose own open/close date or price band
 * differs from the stored one. A postponement addendum, a re-extraction of the old RHP, or an offer
 * document with the same window and band clears nothing.
 *
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test REDIS_URL=redis://127.0.0.1:6379/15 \
 *     npx vitest run --config vitest.integration.config.ts tests/integration/relaunch-clears-admin.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../../../packages/shared/src/db/schema';
import { IPORepository } from '@ipodhan/shared/repositories';
import { writeAdminFieldValue, readAdminFieldVersion } from '../../../packages/shared/src/services/admin-field-write';
import { writeAdminListChange, readAdminList } from '../../../packages/shared/src/services/admin-list-write';
import {
  buildRelaunchReapplyInput,
  readRelaunchReapplyVersion,
  RELAUNCH_CLEARED_AUDIT_ACTION,
} from '../../../packages/shared/src/services/relaunch-reapply';
import type { RelaunchClearSummary } from '../../../packages/shared/src/services/relaunch-admin-clear';
import { writeReceiptAndReopen } from '../../src/services/filing-auto-persist';
import { sendRelaunchClearedAlert } from '../../src/services/admin-alerts';
import { clearAdminValuesOnSourceKeyRelaunch } from '../../src/services/relaunch-clear';
import { planPostponedAtBackfill, applyPostponedAtBackfill } from '../../src/services/postponed-at-backfill';

const DATABASE_URL = process.env.DATABASE_URL;
const A = '00000000-0000-4000-8000-0000000a2711'; // (a) addendum
const B = '00000000-0000-4000-8000-0000000a2712'; // (b) re-extraction / same terms
const C = '00000000-0000-4000-8000-0000000a2713'; // (c) OD-83 supersede
const D = '00000000-0000-4000-8000-0000000a2714'; // (d) new RHP, then a second postpone-and-relaunch
const LIVE = '00000000-0000-4000-8000-0000000a2715';
const E = '00000000-0000-4000-8000-0000000a2716'; // #1304 M1: status provenance re-touched after the relaunch
const F = '00000000-0000-4000-8000-0000000a2717'; // #1304 M1: no status provenance row at all
const G = '00000000-0000-4000-8000-0000000a2718'; // #1304 M1: postponed before postponed_at existed (unknown)
const H = '00000000-0000-4000-8000-0000000a2719'; // #1304 M1 backfill: legacy POSTPONED with a status provenance row
const ALL = [A, B, C, D, LIVE, E, F, G, H];
const actor = { name: 'Item27 Admin', adminId: 'item27-admin' };
const noRedis = {
  get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0,
  keys: async () => [], scan: async () => ['0', []],
} as never;
let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
const rows = (r: any) => (r.rows ?? r) as any[];
const tick = () => new Promise((r) => setTimeout(r, 25));

async function adminWrite(ipoId: string, tableName: string, fieldName: string, opts: { value?: unknown; empty?: string }) {
  const v = await readAdminFieldVersion(db as never, ipoId, tableName, fieldName);
  const res = await writeAdminFieldValue(db as never, {
    ipoId,
    tableName,
    fieldName,
    value: opts.value,
    empty: opts.empty ? { reason: opts.empty } : undefined,
    mode: { kind: 'typed', sourceNote: 'RHP p.12 (item 27 test)' },
    overrideReason: 'item 27 test value',
    expectedVersion: v!.version,
    actor,
    entryPoint: 'item27-test',
  });
  expect(res.kind, JSON.stringify(res)).toBe('OK');
}
async function adminAddPromoter(ipoId: string, name: string) {
  const cur = await readAdminList(db as never, ipoId, 'promoters');
  const res = await writeAdminListChange(db as never, {
    ipoId, list: 'promoters', op: { kind: 'add', row: { name } }, actor, entryPoint: 'item27-test', expectedVersion: cur.version,
  });
  expect(res.kind).toBe('OK');
}
/**
 * Moves the IPO to POSTPONED now (a fresh postponement: an IPO already POSTPONED is relaunched to UPCOMING
 * first, as a real second postponement is). The status write stamps ipos.postponed_at (#1304 M1); the
 * provenance row is written as the scraper writes it.
 */
async function postpone(ipoId: string) {
  await db.execute(sql`UPDATE ipos SET status = 'UPCOMING' WHERE id = ${ipoId}::uuid AND status = 'POSTPONED'`);
  await db.execute(sql`UPDATE ipos SET status = 'POSTPONED' WHERE id = ${ipoId}::uuid`);
  await db.execute(sql`
    INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, updated_at)
    VALUES (${ipoId}::uuid, 'ipos', '', 'status', 'BSE', now())
    ON CONFLICT (ipo_id, table_name, row_key, field_name) DO UPDATE SET updated_at = now()`);
  await tick();
}
async function newDoc(ipoId: string, type: string): Promise<string> {
  const r = await db.execute(sql`
    INSERT INTO documents (ipo_id, type, title, url, extraction_status, sequence_number)
    VALUES (${ipoId}::uuid, ${type}, ${'item27 ' + type}, ${'https://example.test/item27-' + Math.random().toString(36).slice(2) + '.pdf'}, 'COMPLETED',
            (SELECT coalesce(max(sequence_number), 0) + 1 FROM documents WHERE ipo_id = ${ipoId}::uuid))
    RETURNING id`);
  await tick();
  return rows(r)[0].id;
}
type ReceiptRow = { tableName: string; rowKey: string; fieldName: string; value: string };
const band = (min: string, max: string): ReceiptRow[] => [
  { tableName: 'ipos', rowKey: '', fieldName: 'priceRangeMin', value: min },
  { tableName: 'ipos', rowKey: '', fieldName: 'priceRangeMax', value: max },
];
const complete = (ipoId: string, id: string, type: string, receipt: ReceiptRow[]) =>
  writeReceiptAndReopen(db as never, { id, ipoId, type, filingDate: '2026-08-10', sha256: null }, receipt);
const holds = async (ipoId: string) =>
  rows(await db.execute(sql`SELECT table_name, field_name FROM field_protection_metadata WHERE ipo_id = ${ipoId}::uuid AND is_protected ORDER BY 1, 2`));
const issueSize = async (ipoId: string) => {
  const v = rows(await db.execute(sql`SELECT issue_size::text AS s FROM ipos WHERE id = ${ipoId}::uuid`))[0].s;
  return v == null ? null : Number(v);
};
const clearAudits = async (ipoId: string) =>
  rows(await db.execute(sql`
    SELECT id, table_name, field_name, old_value, new_value, details FROM audit_logs
     WHERE ipo_id = ${ipoId}::uuid AND action_type = ${RELAUNCH_CLEARED_AUDIT_ACTION} ORDER BY timestamp, table_name, field_name`));
function alertDeps() {
  const sends: Array<{ title: string; body?: string; dedupeKey?: string }> = [];
  const claims = new Set<string>();
  return {
    sends,
    deps: {
      env: 'test',
      isClaimed: async (k: string) => claims.has(k),
      claim: async (k: string) => void claims.add(k),
      send: async (_s: 'P2', title: string, o: { body?: string; dedupeKey?: string }) => {
        sends.push({ title, ...o });
        return { sent: true } as never;
      },
      record: async () => undefined,
      baseUrl: 'https://admin.example.test',
    },
  };
}
/** Admin values every scenario starts with: typed + EMPTY document fields, an identity field, E-1, non-document, a list. */
async function seedAdminValues(ipoId: string) {
  await adminWrite(ipoId, 'ipos', 'issueSize', { value: '300000000' });
  await adminWrite(ipoId, 'ipo_details', 'freshIssue', { empty: 'the draft figure did not apply' });
  await adminWrite(ipoId, 'ipos', 'cin', { value: `U01100MH2020PLC1234${ipoId.slice(-2)}` }); // identity: never cleared (OD-83 same IPO)
  await adminWrite(ipoId, 'ipos', 'openDate', { value: '2026-06-24' }); // E-1: never cleared here
  await adminWrite(ipoId, 'listing_performance', 'listingPrice', { value: '101' }); // not a document field
  await adminAddPromoter(ipoId, 'Item Twenty Seven Promoter');
  await tick();
}
const SEEDED_HOLDS = [
  { table_name: 'ipo_details', field_name: 'freshIssue' },
  { table_name: 'ipos', field_name: 'cin' },
  { table_name: 'ipos', field_name: 'issueSize' },
  { table_name: 'ipos', field_name: 'openDate' },
  { table_name: 'listing_performance', field_name: 'listingPrice' },
  { table_name: 'promoters', field_name: '*' },
];
const KEPT_HOLDS = [
  { table_name: 'ipos', field_name: 'cin' },
  { table_name: 'ipos', field_name: 'openDate' },
  { table_name: 'listing_performance', field_name: 'listingPrice' },
];

describe.skipIf(!DATABASE_URL)('a relaunch filing, and only a relaunch filing, clears admin values (OD-120, ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 3, options: '-c timezone=UTC' });
    db = drizzle(pool, { schema });
    const name = rows(await db.execute(sql`SELECT current_database() AS d`))[0].d;
    if (name !== 'ipodhan_test') throw new Error(`refusing to run against ${name}`);
    for (const id of ALL) {
      await db.execute(sql`DELETE FROM audit_logs WHERE ipo_id = ${id}::uuid`);
      await db.execute(sql`DELETE FROM ipos WHERE id = ${id}::uuid`);
    }
    for (const [i, id] of ALL.entries()) {
      await db.execute(sql`
        INSERT INTO ipos (id, company_name, slug, status, segment, issue_size, open_date, close_date, price_range_min, price_range_max)
        VALUES (${id}::uuid, ${`Item Twenty Seven ${i} Seeds Ltd`}, ${`item-twenty-seven-${i}-seeds-ltd`}, 'UPCOMING', 'SME', 267300000,
                '2026-06-23', '2026-06-25', 95, 99)`);
    }
  });
  afterAll(async () => {
    if (!pool) return;
    for (const id of ALL) {
      await db.execute(sql`DELETE FROM audit_logs WHERE ipo_id = ${id}::uuid`);
      await db.execute(sql`DELETE FROM ipos WHERE id = ${id}::uuid`);
    }
    await pool.end();
  });

  it('(a) a postponement addendum or corrigendum completing on a POSTPONED IPO clears nothing, even with new dates', async () => {
    await seedAdminValues(A);
    await postpone(A);
    for (const type of ['ADDENDUM', 'CORRIGENDUM']) {
      const id = await newDoc(A, type);
      const out = await complete(A, id, type, [
        { tableName: 'ipos', rowKey: '', fieldName: 'openDate', value: '2026-08-19' },
        ...band('100', '105'),
        { tableName: 'ipos', rowKey: '', fieldName: 'issueSize', value: '267300000' },
      ]);
      expect(out.relaunchCleared ?? null).toBeNull();
    }
    expect(await holds(A)).toEqual(SEEDED_HOLDS);
    expect(await issueSize(A)).toBe(300000000);
    expect(await clearAudits(A)).toEqual([]);
  }, 60_000);

  it('(b) a re-extraction of the pre-postponement RHP, or a new RHP with the same window and band, clears nothing', async () => {
    await seedAdminValues(B);
    const oldRhp = await newDoc(B, 'RHP'); // discovered BEFORE the postponement
    await postpone(B);
    const reread = await complete(B, oldRhp, 'RHP', [...band('100', '105')]);
    expect(reread.relaunchCleared ?? null).toBeNull();
    const sameTerms = await newDoc(B, 'RHP'); // after the postponement, but the same window and band
    const same = await complete(B, sameTerms, 'RHP', [
      { tableName: 'ipos', rowKey: '', fieldName: 'openDate', value: '2026-06-24' }, // the stored (admin) open date
      ...band('95', '99'),
    ]);
    expect(same.relaunchCleared ?? null).toBeNull();
    expect(await holds(B)).toEqual(SEEDED_HOLDS);
    expect(await issueSize(B)).toBe(300000000);
  }, 60_000);

  it('(c) an OD-83 relaunch supersede clears held fields and the admin-owned list, with audit rows and one alert', async () => {
    const repo = new IPORepository(db as never, noRedis);
    const attrs = { shares: 2_700_000, priceMin: 95, priceMax: 99 };
    await repo.bindSourceKeys(C, [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '97794', attrs: { ...attrs, postponed: true }, recordOpenDate: '2026-06-23' }] as never, {
      boundVia: 'BACKFILL', boundBy: 'item27.test',
    });
    await seedAdminValues(C);
    await postpone(C);

    // A bind that supersedes nothing is no relaunch: the hook never runs.
    let hookRuns = 0;
    await repo.bindSourceKeys(C, [{ source: 'CHITTORGARH', keyType: 'CG_PAGE_ID', keyValue: '92846' }] as never, {
      boundVia: 'BACKFILL', boundBy: 'item27.test', onSupersede: async () => void hookRuns++,
    });
    expect(hookRuns).toBe(0);
    expect(await holds(C)).toEqual(SEEDED_HOLDS);

    let summary: RelaunchClearSummary | null = null;
    await repo.bindSourceKeys(C, [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '97900', attrs, recordOpenDate: '2026-08-19' }] as never, {
      boundVia: 'BACKFILL', boundBy: 'item27.test',
      onSupersede: async (tx, id, superseded) => {
        summary = await clearAdminValuesOnSourceKeyRelaunch(tx, id, superseded);
      },
    });
    const s = summary as RelaunchClearSummary | null;
    expect(s?.documentType).toMatch(/^OD-83 relaunch:/);
    expect(await holds(C)).toEqual(KEPT_HOLDS);
    expect(await issueSize(C)).toBeNull();
    const audit = await clearAudits(C);
    expect(audit.map((a) => [a.table_name, a.field_name])).toEqual([
      ['ipo_details', 'freshIssue'],
      ['ipos', 'issueSize'],
      ['promoters', '*'],
    ]);
    expect(audit.every((a) => a.details.trigger === 'SOURCE_KEY_RELAUNCH')).toBe(true);
    expect(audit[2].old_value).toBe(JSON.stringify(['Item Twenty Seven Promoter']));

    const { sends, deps } = alertDeps();
    expect((await sendRelaunchClearedAlert(s!, deps)).outcome).toBe('sent');
    expect((await sendRelaunchClearedAlert(s!, deps)).outcome).toBe('already-sent');
    expect(sends).toHaveLength(1);
    expect(sends[0].body).toContain('you had blanked ipo_details.freshIssue');
    expect(sends[0].body).toContain('your list promoters (1 row(s)) is no longer held');
  }, 90_000);

  it('(d) a new RHP after the postponement with a new band clears them; a second postpone-and-relaunch clears again', async () => {
    await seedAdminValues(D);
    await postpone(D);
    const rhp = await newDoc(D, 'RHP');
    // Set AFTER the relaunch filing was discovered: already the relaunch's terms, kept.
    await adminWrite(D, 'ipos', 'lotSize', { value: '1200' });
    const out = await complete(D, rhp, 'RHP', [...band('100', '105'), { tableName: 'ipos', rowKey: '', fieldName: 'issueSize', value: '283500000' }]);
    expect(await holds(D)).toEqual([KEPT_HOLDS[0], { table_name: 'ipos', field_name: 'lotSize' }, ...KEPT_HOLDS.slice(1)]);
    expect(await issueSize(D)).toBeNull();
    const audit = await clearAudits(D);
    expect(audit.map((a) => [a.table_name, a.field_name, a.old_value])).toEqual([
      ['ipo_details', 'freshIssue', null],
      ['ipos', 'issueSize', '300000000.00'],
      ['promoters', '*', JSON.stringify(['Item Twenty Seven Promoter'])],
    ]);
    const size = audit[1];
    expect(size.details.documentId).toBe(rhp);
    expect(size.details.newFilingValue).toBe('283500000');
    const { sends, deps } = alertDeps();
    await sendRelaunchClearedAlert(out.relaunchCleared!, deps);
    expect(sends).toHaveLength(1);
    expect(sends[0].body).toContain('ipos.issueSize: you had 300000000.00; the new filing says 283500000');
    expect(sends[0].body).toContain(`https://admin.example.test/api/admin/relaunch-reapply?audit=${size.id}`);

    // MINOR 4: the confirm page's version token; a newer admin save after the page opened -> CONFLICT.
    const pageVersion = await readRelaunchReapplyVersion(db as never, size.id);
    expect(pageVersion).toBeTruthy();
    await adminWrite(D, 'ipos', 'issueSize', { value: '290000000' });
    const stale = await buildRelaunchReapplyInput(db as never, size.id, actor, pageVersion!);
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect((await writeAdminFieldValue(db as never, stale.input)).kind).toBe('CONFLICT');
    expect(await issueSize(D)).toBe(290000000);
    expect((await buildRelaunchReapplyInput(db as never, size.id, actor, '')).ok).toBe(false);

    // A fresh page re-applies it (the admin's choice after seeing 290000000).
    const fresh = await buildRelaunchReapplyInput(db as never, size.id, actor, (await readRelaunchReapplyVersion(db as never, size.id))!);
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect((await writeAdminFieldValue(db as never, fresh.input)).kind).toBe('OK');
    expect(await issueSize(D)).toBe(300000000);
    await tick();

    // Another relaunch filing of THIS relaunch (new band again, no new postponement): the re-applied value stays.
    const rhp2 = await newDoc(D, 'PRICE_BAND_AD');
    const again = await complete(D, rhp2, 'PRICE_BAND_AD', band('101', '106'));
    expect(again.relaunchCleared?.cleared ?? []).toEqual([]);
    expect(await issueSize(D)).toBe(300000000);

    // Postponed AGAIN, then relaunched again: the re-applied value is the old terms now and clears.
    await postpone(D);
    const rhp3 = await newDoc(D, 'PROSPECTUS');
    const second = await complete(D, rhp3, 'PROSPECTUS', band('110', '115'));
    expect(second.relaunchCleared?.cleared.map((c) => `${c.tableName}.${c.fieldName}`)).toContain('ipos.issueSize');
    expect(await issueSize(D)).toBeNull();
  }, 180_000);

  it('#1304 M1: a status provenance row re-written AFTER the relaunch filing does not hide the postponement time', async () => {
    await seedAdminValues(E);
    await postpone(E);
    const rhp = await newDoc(E, 'RHP');
    // A later provenance write of the same POSTPONED value moves field_sources.updated_at past the filing.
    await db.execute(sql`UPDATE field_sources SET updated_at = now() WHERE ipo_id = ${E}::uuid AND table_name = 'ipos' AND field_name = 'status'`);
    await tick();
    const out = await complete(E, rhp, 'RHP', band('100', '105'));
    expect(out.relaunchCleared?.cleared.map((c) => `${c.tableName}.${c.fieldName}`)).toContain('ipos.issueSize');
    expect(await issueSize(E)).toBeNull();
  }, 120_000);

  it('#1304 M1: a POSTPONED IPO with no status provenance row still clears on its relaunch filing', async () => {
    await seedAdminValues(F);
    await db.execute(sql`UPDATE ipos SET status = 'POSTPONED' WHERE id = ${F}::uuid`);
    await db.execute(sql`DELETE FROM field_sources WHERE ipo_id = ${F}::uuid AND table_name = 'ipos' AND field_name = 'status'`);
    const at = rows(await db.execute(sql`SELECT postponed_at::text AS at FROM ipos WHERE id = ${F}::uuid`))[0].at;
    expect(at, 'the status write stamps postponed_at on the database clock').not.toBeNull();
    await tick();
    const rhp = await newDoc(F, 'RHP');
    const out = await complete(F, rhp, 'RHP', band('100', '105'));
    expect(out.relaunchCleared?.cleared.map((c) => `${c.tableName}.${c.fieldName}`)).toContain('ipos.issueSize');
  }, 120_000);

  it('#1304 M1: an unknown postponement time (postponed_at NULL) clears nothing: a clear missed, never added', async () => {
    await seedAdminValues(G);
    await postpone(G);
    await db.execute(sql`UPDATE ipos SET postponed_at = NULL WHERE id = ${G}::uuid`);
    const rhp = await newDoc(G, 'RHP');
    const out = await complete(G, rhp, 'RHP', band('100', '105'));
    expect(out.relaunchCleared ?? null).toBeNull();
    expect(await issueSize(G)).toBe(300000000);
  }, 120_000);

  it('#1304 M1 backfill: fills postponed_at from the status provenance row, lists the IPO with none, and is idempotent', async () => {
    // H: postponed long ago (provenance row 10 days old), before postponed_at existed. G: NULL and (below) no row.
    await postpone(H);
    await db.execute(sql`UPDATE field_sources SET updated_at = (now() AT TIME ZONE 'UTC') - interval '10 days' WHERE ipo_id = ${H}::uuid AND field_name = 'status'`);
    await db.execute(sql`UPDATE ipos SET postponed_at = NULL WHERE id = ANY(${`{${H},${G}}`}::uuid[])`);
    await db.execute(sql`DELETE FROM field_sources WHERE ipo_id = ${G}::uuid AND table_name = 'ipos' AND field_name = 'status'`);
    const evidence = rows(await db.execute(sql`SELECT updated_at::text AS at FROM field_sources WHERE ipo_id = ${H}::uuid AND field_name = 'status'`))[0].at;

    const plan = await planPostponedAtBackfill(db as never, [H, G, LIVE]);
    expect(plan.fill).toEqual([{ ipoId: H, slug: 'item-twenty-seven-8-seeds-ltd', evidenceAt: evidence }]);
    expect(plan.unknown).toEqual([{ ipoId: G, slug: 'item-twenty-seven-7-seeds-ltd' }]);
    const before = rows(await db.execute(sql`SELECT status::text AS s FROM ipos WHERE id = ${H}::uuid`))[0].s;

    expect(await applyPostponedAtBackfill(db as never, plan)).toEqual([H]);
    const after = rows(await db.execute(sql`SELECT postponed_at::text AS at, status::text AS s FROM ipos WHERE id = ${H}::uuid`))[0];
    expect(after.at).toBe(evidence);
    expect(after.s).toBe(before);
    // Re-run: nothing left to fill; G stays unknown (NULL), never guessed.
    const again = await planPostponedAtBackfill(db as never, [H, G, LIVE]);
    expect(again.fill).toEqual([]);
    expect(await applyPostponedAtBackfill(db as never, plan)).toEqual([]);
    expect(rows(await db.execute(sql`SELECT postponed_at FROM ipos WHERE id = ${G}::uuid`))[0].postponed_at).toBeNull();
  }, 60_000);

  it('#1304 M1: the stamp is the database clock at the transition; a write that keeps POSTPONED does not move it', async () => {
    await db.execute(sql`UPDATE ipos SET status = 'UPCOMING', postponed_at = NULL WHERE id = ${LIVE}::uuid`);
    const t0 = rows(await db.execute(sql`SELECT (now() AT TIME ZONE 'UTC')::text AS t`))[0].t;
    await db.execute(sql`UPDATE ipos SET status = 'POSTPONED' WHERE id = ${LIVE}::uuid`);
    const first = rows(await db.execute(sql`SELECT postponed_at::text AS at FROM ipos WHERE id = ${LIVE}::uuid`))[0].at;
    expect(first >= t0).toBe(true);
    await tick();
    await db.execute(sql`UPDATE ipos SET status = 'POSTPONED', issue_size = issue_size WHERE id = ${LIVE}::uuid`);
    expect(rows(await db.execute(sql`SELECT postponed_at::text AS at FROM ipos WHERE id = ${LIVE}::uuid`))[0].at).toBe(first);
    await db.execute(sql`UPDATE ipos SET status = 'UPCOMING' WHERE id = ${LIVE}::uuid`);
  });

  it('a filing on an IPO that is not POSTPONED clears nothing', async () => {
    await adminWrite(LIVE, 'ipos', 'issueSize', { value: '120000000' });
    const rhp = await newDoc(LIVE, 'RHP');
    const out = await complete(LIVE, rhp, 'RHP', band('100', '105'));
    expect(out.relaunchCleared ?? null).toBeNull();
    expect(await issueSize(LIVE)).toBe(120000000);
  });
});
