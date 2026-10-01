/**
 * #1298 (§2.9 "POSTPONED — not terminal, it comes back"; OD-83, OD-86, OD-120, OD-139) on the real
 * database (ipodhan_test only), through the real consolidation (DataConsolidationService with the real
 * repositories) and the real relaunch clear (item 27's `clearAdminValuesOnRelaunch`).
 *
 * Real-shaped on Dhanwel Hybrid Seeds (F-131 / F-144): BSE IPO_NO 7794 (23 Jun 2026, 2,700,000 shares,
 * band 95-99, "has been postponed") then 7900 (19-21 Aug 2026, same shares and band).
 *
 *   (1) a relaunch filing (the OD-83 source-key supersede, or an RHP first found after the
 *       postponement with a new band) invalidates the non-admin document-sourced values, clears the
 *       admin values exactly as item 27 does (one alert), and only then may an exchange move the
 *       status off POSTPONED;
 *   (2) without a relaunch filing, POSTPONED stays, whatever an ordinary scrape says;
 *   (3) WITHDRAWN and DELISTED stay terminal, even with a relaunch record present.
 *
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run --config vitest.integration.config.ts tests/integration/postponed-relaunch-1298.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
// Relative imports, not the `@ipodhan/shared` alias (a worktree's junctions can resolve it to main).
import * as schema from '../../../packages/shared/src/db/schema';
import { IPORepository } from '../../../packages/shared/src/repositories';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import { writeAdminFieldValue, readAdminFieldVersion } from '../../../packages/shared/src/services/admin-field-write';
import {
  RELAUNCH_CLEARED_AUDIT_ACTION,
  RELAUNCH_FILING_AUDIT_ACTION,
  readPostponedRelaunchState,
  type RelaunchClearSummary,
} from '../../../packages/shared/src/services/relaunch-admin-clear';
import { DataConsolidationService, POSTPONED_KEPT_NO_RELAUNCH } from '../../src/services/data-consolidation-service';
import { FEATURE_FLAGS } from '../../src/config/feature-flags';
import { writeReceiptAndReopen } from '../../src/services/filing-auto-persist';
import { sendRelaunchClearedAlert } from '../../src/services/admin-alerts';
import { clearAdminValuesOnSourceKeyRelaunch } from '../../src/services/relaunch-clear';

const DATABASE_URL = process.env.DATABASE_URL;
const KEY = '00000000-0000-4000-8000-00000000a981'; // OD-83 source-key relaunch
const DOC = '00000000-0000-4000-8000-00000000a982'; // relaunch RHP
const STAY = '00000000-0000-4000-8000-00000000a983'; // no relaunch filing
const WDN = '00000000-0000-4000-8000-00000000a984'; // WITHDRAWN
const DEL = '00000000-0000-4000-8000-00000000a985'; // DELISTED
const OLD = '00000000-0000-4000-8000-00000000a986'; // OD-86 merge: the older, postponed record
const NEW = '00000000-0000-4000-8000-00000000a987'; // OD-86 merge: the newer relaunch record
const NUL = '00000000-0000-4000-8000-00000000a988'; // #1304 M1: postponed_at NULL (unknown) with an old relaunch mark
const ALL = [KEY, DOC, STAY, WDN, DEL];
const actor = { name: 'Issue1298 Admin', adminId: 'issue1298-admin' };
const noRedis = {
  get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0,
  keys: async () => [], scan: async () => ['0', []],
} as never;
let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let service: DataConsolidationService;
const savedFlags: Record<string, unknown> = {};
const rows = (r: any) => (r.rows ?? r) as any[];
const tick = () => new Promise((r) => setTimeout(r, 25));

/** The old offer's document values (source DRHP), written 10 days before the postponement. */
const DOC_FIELDS: Array<[string, string]> = [
  ['issueSize', '267300000'],
  ['lotSize', '1200'],
  ['faceValue', '10'],
  ['cin', 'U01100MH2020PLC129812'], // identity: never invalidated (OD-83 same company)
  ['openDate', '2026-06-23'], // E-1: the exchange's, never invalidated here
];

async function seed(ipoId: string, i: number, status = 'UPCOMING') {
  await db.execute(sql`
    INSERT INTO ipos (id, company_name, slug, status, segment, listing_exchanges, issue_size, lot_size, face_value, cin,
                      open_date, close_date, price_range_min, price_range_max)
    VALUES (${ipoId}::uuid, ${`Issue Twelve Ninety Eight ${i} Seeds Ltd`}, ${`issue-1298-${i}-seeds-ltd`}, ${status}, 'SME', '["BSE"]',
            267300000, 1200, 10, ${'U01100MH2020PLC1298' + i}, '2026-06-23', '2026-06-25', 95, 99)`);
  for (const [f] of DOC_FIELDS) {
    await db.execute(sql`
      INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, updated_at, created_at)
      VALUES (${ipoId}::uuid, 'ipos', '', ${f}, 'DRHP', 95, now() - interval '10 days', now() - interval '10 days')`);
    await db.execute(sql`
      INSERT INTO ipo_field_plan (ipo_id, table_name, row_key, field_name, state, manifest_version)
      VALUES (${ipoId}::uuid, 'ipos', '', ${f}, 'SUPPLIED', 1)`);
  }
}
async function adminWrite(ipoId: string, tableName: string, fieldName: string, value: string) {
  const v = await readAdminFieldVersion(db as never, ipoId, tableName, fieldName);
  const res = await writeAdminFieldValue(db as never, {
    ipoId, tableName, fieldName, value,
    mode: { kind: 'typed', sourceNote: 'RHP p.9 (#1298 test)' },
    overrideReason: '#1298 test value', expectedVersion: v!.version, actor, entryPoint: 'issue1298-test',
  });
  expect(res.kind, JSON.stringify(res)).toBe('OK');
}
/** The exchange marks the IPO POSTPONED now (the status provenance row the relaunch rule reads). */
async function postpone(ipoId: string, status = 'POSTPONED') {
  await db.execute(sql`UPDATE ipos SET status = ${status} WHERE id = ${ipoId}::uuid`);
  await db.execute(sql`
    INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, updated_at)
    VALUES (${ipoId}::uuid, 'ipos', '', 'status', 'BSE', now())
    ON CONFLICT (ipo_id, table_name, row_key, field_name) DO UPDATE SET source = 'BSE', updated_at = now()`);
  await tick();
}
async function newDoc(ipoId: string, type: string): Promise<string> {
  const r = await db.execute(sql`
    INSERT INTO documents (ipo_id, type, title, url, extraction_status, sequence_number)
    VALUES (${ipoId}::uuid, ${type}, ${'1298 ' + type}, ${'https://example.test/1298-' + Math.random().toString(36).slice(2) + '.pdf'}, 'COMPLETED',
            (SELECT coalesce(max(sequence_number), 0) + 1 FROM documents WHERE ipo_id = ${ipoId}::uuid))
    RETURNING id`);
  await tick();
  return rows(r)[0].id;
}
const docValues = async (ipoId: string) =>
  rows(await db.execute(sql`
    SELECT issue_size::text AS "issueSize", lot_size::text AS "lotSize", face_value::text AS "faceValue", cin, open_date::text AS "openDate"
      FROM ipos WHERE id = ${ipoId}::uuid`))[0];
const drhpRows = async (ipoId: string) =>
  rows(await db.execute(sql`SELECT field_name FROM field_sources WHERE ipo_id = ${ipoId}::uuid AND source = 'DRHP' ORDER BY 1`)).map((r) => r.field_name);
const planStates = async (ipoId: string) =>
  Object.fromEntries(
    rows(await db.execute(sql`SELECT field_name, state::text AS state FROM ipo_field_plan WHERE ipo_id = ${ipoId}::uuid`)).map((r) => [r.field_name, r.state])
  );
const audits = async (ipoId: string, action: string) =>
  rows(await db.execute(sql`SELECT field_name, details FROM audit_logs WHERE ipo_id = ${ipoId}::uuid AND action_type = ${action} ORDER BY timestamp, field_name`));
const storedStatus = async (ipoId: string) =>
  rows(await db.execute(sql`SELECT status::text AS s FROM ipos WHERE id = ${ipoId}::uuid`))[0].s as string;

/** One scrape's `ipos` claim through the real consolidation; returns the status field's result. */
async function scrapeStatus(ipoId: string, source: string, status: string, dates?: { openDate: string; closeDate: string }) {
  const stored = rows(await db.execute(sql`
    SELECT status::text AS status, open_date::text AS "openDate", close_date::text AS "closeDate" FROM ipos WHERE id = ${ipoId}::uuid`))[0];
  const result = await service.consolidateIPOData({
    ipoId, tableName: 'ipos', source: source as never, confidence: 90,
    incomingData: { status, ...(dates ?? {}) },
    existingData: { status: stored.status, segment: 'SME', listingExchanges: ['BSE'], openDate: stored.openDate, closeDate: stored.closeDate, listingDate: null } as never,
    // Stamped on the DB clock (+1 s): provenance rows carry DB time, and the laptop runs ~0.8 s behind it.
    scrapedAt: new Date(new Date(rows(await db.execute(sql`SELECT (now() + interval '1 second')::text AS t`))[0].t.replace(' ', 'T').replace(/\+00$/, 'Z')).getTime()),
  });
  const f = result.fieldResults.find((x) => x.fieldName === 'status') as { finalValue: unknown; conflictReason?: string } | undefined;
  // The orchestrator stores the decided value; do the same so the next scrape reads it.
  if (f && f.finalValue != null) await db.execute(sql`UPDATE ipos SET status = ${String(f.finalValue)} WHERE id = ${ipoId}::uuid`);
  return f;
}
function alertDeps() {
  const sends: Array<{ title: string; body?: string }> = [];
  const claims = new Set<string>();
  return {
    sends,
    deps: {
      env: 'test',
      isClaimed: async (k: string) => claims.has(k),
      claim: async (k: string) => void claims.add(k),
      send: async (_s: 'P2', title: string, o: { body?: string }) => {
        sends.push({ title, ...o });
        return { sent: true } as never;
      },
      record: async () => undefined,
      baseUrl: 'https://admin.example.test',
    },
  };
}
const INVALIDATED = ['ipos.faceValue', 'ipos.issueSize', 'ipos.lotSize'];

async function cleanup() {
  for (const id of [...ALL, OLD, NEW, NUL]) {
    await db.execute(sql`DELETE FROM ipo_merge_log WHERE kept_ipo_id = ${id}::uuid OR dropped_ipo_id = ${id}::uuid`).catch(() => undefined);
    await db.execute(sql`DELETE FROM ipo_slug_redirects WHERE ipo_id = ${id}::uuid`).catch(() => undefined);
    await db.execute(sql`DELETE FROM audit_logs WHERE ipo_id = ${id}::uuid`);
    await db.execute(sql`DELETE FROM data_conflicts WHERE ipo_id = ${id}::uuid`);
    await db.execute(sql`DELETE FROM ipos WHERE id = ${id}::uuid`);
  }
}

describe.skipIf(!DATABASE_URL)('#1298 POSTPONED is not terminal; a relaunch filing invalidates document fields (ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 3, options: '-c timezone=UTC' });
    db = drizzle(pool, { schema });
    const name = rows(await db.execute(sql`SELECT current_database() AS d`))[0].d;
    if (name !== 'ipodhan_test') throw new Error(`refusing to run against ${name}`);
    service = new DataConsolidationService(
      new FieldSourcesRepository(db as never, noRedis) as never,
      new DataConflictsRepository(db as never, noRedis) as never
    );
    await cleanup();
    for (const [i, id] of ALL.entries()) await seed(id, i);
  }, 60_000);
  afterAll(async () => {
    for (const [k, v] of Object.entries(savedFlags)) (FEATURE_FLAGS as never as Record<string, unknown>)[k] = v;
    if (!pool) return;
    await cleanup();
    await pool.end();
  }, 60_000);
  beforeEach(() => {
    const f = FEATURE_FLAGS as never as Record<string, unknown>;
    for (const k of ['ENABLE_DATA_CONSOLIDATION', 'ENABLE_SOURCE_TRACKING', 'ENABLE_CONFLICT_DETECTION', 'CONSOLIDATION_PERCENTAGE']) {
      if (!(k in savedFlags)) savedFlags[k] = f[k];
    }
    f.ENABLE_DATA_CONSOLIDATION = true;
    f.ENABLE_SOURCE_TRACKING = true;
    f.ENABLE_CONFLICT_DETECTION = true;
    f.CONSOLIDATION_PERCENTAGE = 100;
  });

  it('(1a) OD-83 relaunch (BSE 7794 postponed -> 7900): POSTPONED held until the supersede, then document values invalidated, admin value cleared, one alert, and the exchange status replaces POSTPONED', async () => {
    const repo = new IPORepository(db as never, noRedis);
    const attrs = { shares: 2_700_000, priceMin: 95, priceMax: 99 };
    await repo.bindSourceKeys(KEY, [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '97794', attrs: { ...attrs, postponed: true }, recordOpenDate: '2026-06-23' }] as never, {
      boundVia: 'BACKFILL', boundBy: 'issue1298.test',
    });
    await adminWrite(KEY, 'ipo_details', 'freshIssue', '267300000');
    // The old offer's promoter list (a multi-row document list, MINOR-4), read 10 days ago.
    await db.execute(sql`
      INSERT INTO promoters (ipo_id, name, normalized_name, created_at, updated_at)
      VALUES (${KEY}::uuid, 'Old Offer Promoter', 'old offer promoter', now() - interval '10 days', now() - interval '10 days')`);
    await db.execute(sql`
      INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, updated_at, created_at)
      VALUES (${KEY}::uuid, 'promoters', 'old offer promoter', 'name', 'DRHP', 95, now() - interval '10 days', now() - interval '10 days')`);
    await postpone(KEY);

    // Before the relaunch filing: an ordinary exchange scrape does not re-open it.
    expect(await readPostponedRelaunchState(db as never, KEY)).toBe('NO_RELAUNCH');
    const before = await scrapeStatus(KEY, 'BSE', 'UPCOMING');
    expect(before).toMatchObject({ finalValue: 'POSTPONED', conflictReason: POSTPONED_KEPT_NO_RELAUNCH });

    let summary: RelaunchClearSummary | null = null;
    await repo.bindSourceKeys(KEY, [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '97900', attrs, recordOpenDate: '2026-08-19' }] as never, {
      boundVia: 'BACKFILL', boundBy: 'issue1298.test',
      onSupersede: async (tx, id, superseded) => {
        summary = await clearAdminValuesOnSourceKeyRelaunch(tx, id, superseded);
      },
    });
    const s = summary as RelaunchClearSummary | null;
    expect(s?.documentType).toMatch(/^OD-83 relaunch:/);
    // Non-admin half (#1298): the old offer's document values are gone and re-asked; identity and E-1 stay.
    expect((s?.invalidated ?? []).map((v) => `${v.tableName}.${v.fieldName}`).sort()).toEqual([...INVALIDATED, 'promoters.*']);
    expect(rows(await db.execute(sql`SELECT count(*)::int AS n FROM promoters WHERE ipo_id = ${KEY}::uuid`))[0].n).toBe(0);
    expect(await docValues(KEY)).toEqual({ issueSize: null, lotSize: null, faceValue: null, cin: 'U01100MH2020PLC12980', openDate: '2026-06-23' });
    expect(await drhpRows(KEY)).toEqual(['cin', 'openDate']);
    expect(await planStates(KEY)).toMatchObject({ issueSize: 'PENDING', lotSize: 'PENDING', faceValue: 'PENDING', cin: 'SUPPLIED', openDate: 'SUPPLIED' });
    // Admin half (item 27, unchanged): the admin value is cleared with its audit row, and ONE alert.
    expect(s?.cleared.map((c) => `${c.tableName}.${c.fieldName}`)).toEqual(['ipo_details.freshIssue']);
    expect((await audits(KEY, RELAUNCH_CLEARED_AUDIT_ACTION)).map((a) => a.field_name)).toEqual(['freshIssue']);
    const filing = await audits(KEY, RELAUNCH_FILING_AUDIT_ACTION);
    expect(filing).toHaveLength(1);
    expect(filing[0].details.trigger).toBe('SOURCE_KEY_RELAUNCH');
    const { sends, deps } = alertDeps();
    expect((await sendRelaunchClearedAlert(s!, deps)).outcome).toBe('sent');
    expect((await sendRelaunchClearedAlert(s!, deps)).outcome).toBe('already-sent');
    expect(sends).toHaveLength(1);

    // The relaunch path: now the exchange's status leaves POSTPONED; a website still cannot.
    expect(await readPostponedRelaunchState(db as never, KEY)).toBe('RELAUNCHED');
    const website = await scrapeStatus(KEY, 'CHITTORGARH', 'UPCOMING');
    expect(website).toMatchObject({ finalValue: 'POSTPONED', conflictReason: POSTPONED_KEPT_NO_RELAUNCH });
    const after = await scrapeStatus(KEY, 'BSE', 'UPCOMING', { openDate: '2026-08-19', closeDate: '2026-08-21' });
    expect(after?.finalValue).toBe('UPCOMING');
    expect(await storedStatus(KEY)).toBe('UPCOMING');
    // and from there the ladder moves forward as usual.
    const open = await scrapeStatus(KEY, 'BSE', 'OPEN');
    expect(open?.finalValue, JSON.stringify(open)).toBe('OPEN');

    // (MINOR-5b) Postponed AGAIN after the relaunch: the old relaunch record is older than this
    // postponement, so an ordinary exchange scrape no longer releases it.
    await postpone(KEY);
    expect(await readPostponedRelaunchState(db as never, KEY)).toBe('NO_RELAUNCH');
    expect(await scrapeStatus(KEY, 'BSE', 'UPCOMING')).toMatchObject({ finalValue: 'POSTPONED', conflictReason: POSTPONED_KEPT_NO_RELAUNCH });
  }, 120_000);

  it('(1b) a relaunch RHP (found after the postponement, new band) invalidates the old document values; then BSE (its venue) moves the status', async () => {
    await postpone(DOC);
    const rhp = await newDoc(DOC, 'RHP');
    const out = await writeReceiptAndReopen(db as never, { id: rhp, ipoId: DOC, type: 'RHP', filingDate: '2026-08-10', sha256: null }, [
      { tableName: 'ipos', rowKey: '', fieldName: 'priceRangeMin', value: '100' },
      { tableName: 'ipos', rowKey: '', fieldName: 'priceRangeMax', value: '105' },
    ]);
    expect(out.relaunchCleared?.cleared ?? []).toEqual([]); // no admin values here: no alert
    expect((out.relaunchCleared?.invalidated ?? []).map((v) => `${v.tableName}.${v.fieldName}`).sort()).toEqual(INVALIDATED);
    expect(await docValues(DOC)).toMatchObject({ issueSize: null, lotSize: null, faceValue: null, openDate: '2026-06-23' });
    const filing = await audits(DOC, RELAUNCH_FILING_AUDIT_ACTION);
    expect(filing.map((f) => [f.details.trigger, f.details.documentId])).toEqual([['OFFER_DOCUMENT', rhp]]);
    const moved = await scrapeStatus(DOC, 'BSE', 'OPEN', { openDate: '2026-08-19', closeDate: '2026-08-21' });
    expect(moved?.finalValue, JSON.stringify(moved)).toBe('OPEN');
  }, 120_000);

  it('(2) without a relaunch filing POSTPONED stays: an addendum, a same-terms RHP and ordinary scrapes from every source change nothing', async () => {
    const oldRhp = await newDoc(STAY, 'RHP'); // discovered BEFORE the postponement
    await postpone(STAY);
    for (const [id, type] of [[await newDoc(STAY, 'ADDENDUM'), 'ADDENDUM'], [oldRhp, 'RHP']] as const) {
      const out = await writeReceiptAndReopen(db as never, { id, ipoId: STAY, type, filingDate: '2026-08-10', sha256: null }, [
        { tableName: 'ipos', rowKey: '', fieldName: 'priceRangeMin', value: '100' },
        { tableName: 'ipos', rowKey: '', fieldName: 'priceRangeMax', value: '105' },
      ]);
      expect(out.relaunchCleared ?? null).toBeNull();
    }
    for (const [src, st] of [['BSE', 'UPCOMING'], ['NSE', 'OPEN'], ['CHITTORGARH', 'CLOSED'], ['BSE', 'LISTED']]) {
      expect(await scrapeStatus(STAY, src, st)).toMatchObject({ finalValue: 'POSTPONED', conflictReason: POSTPONED_KEPT_NO_RELAUNCH });
    }
    expect(await storedStatus(STAY)).toBe('POSTPONED');
    expect(await readPostponedRelaunchState(db as never, STAY)).toBe('NO_RELAUNCH');
    expect(await drhpRows(STAY)).toEqual(['cin', 'faceValue', 'issueSize', 'lotSize', 'openDate']);
    expect(await docValues(STAY)).toMatchObject({ issueSize: '267300000.00', lotSize: '1200' });
    expect(await audits(STAY, RELAUNCH_FILING_AUDIT_ACTION)).toEqual([]);
  }, 120_000);

  it('(3) WITHDRAWN and DELISTED stay terminal, even with a relaunch record on the row', async () => {
    for (const [id, st] of [[WDN, 'WITHDRAWN'], [DEL, 'DELISTED']] as const) {
      await postpone(id, st);
      await db.execute(sql`
        INSERT INTO audit_logs (timestamp, admin_user, action_type, ipo_id, table_name, field_name, details, success, created_at)
        VALUES (now(), 'issue1298.test', ${RELAUNCH_FILING_AUDIT_ACTION}, ${id}::uuid, 'ipos', 'status', '{}'::jsonb, true, now())`);
      for (const [src, to] of [['NSE', 'UPCOMING'], ['BSE', 'LISTED']]) {
        expect(await scrapeStatus(id, src, to)).toMatchObject({ finalValue: st, conflictReason: 'TERMINAL_STATUS_KEPT' });
      }
      expect(await storedStatus(id)).toBe(st);
    }
  }, 120_000);
  it('(MAJOR-3) an OD-86 relaunch merge is a relaunch filing: the postponed survivor is invalidated first, then refilled from the newer record', async () => {
    const repo = new IPORepository(db as never, noRedis);
    const mk = async (id: string, slug: string, open: string, ipoNo: string, size: number | null, lot: number, status: string) => {
      await db.execute(sql`
        INSERT INTO ipos (id, company_name, slug, status, segment, offering_type, symbol, listing_exchanges, issue_size, lot_size,
                          open_date, price_range_min, price_range_max)
        VALUES (${id}::uuid, 'Merge Relaunch 1298 Seeds Ltd', ${slug}, 'UPCOMING', 'SME', 'IPO', 'MRGRL1298', '["BSE"]', ${size}, ${lot}, ${open}, 95, 99)`);
      await db.execute(sql`
        INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, updated_at, created_at)
        VALUES (${id}::uuid, 'ipos', '', 'issueSize', 'DRHP', 95, now() - interval '10 days', now() - interval '10 days'),
               (${id}::uuid, 'ipos', '', 'lotSize', 'DRHP', 95, now() - interval '10 days', now() - interval '10 days')`);
      await repo.bindSourceKeys(id, [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: ipoNo, attrs: { shares: 2_700_000, priceMin: 95, priceMax: 99, postponed: status === 'POSTPONED' } }] as never, {
        boundVia: 'BACKFILL', boundBy: 'issue1298.test',
      } as never);
      if (status === 'POSTPONED') await postpone(id);
    };
    await mk(OLD, 'merge-relaunch-1298', '2026-06-23', '98794', 267300000, 1200, 'POSTPONED');
    // The merge tool refuses two different issue sizes (OD-69); the newer record has none yet.
    await mk(NEW, 'merge-relaunch-1298-o', '2026-08-19', '98900', null, 1000, 'UPCOMING');
    // Fail closed: a relaunch merge of a POSTPONED IPO without the document-field test is refused.
    await expect(repo.mergeDuplicateInto(OLD, NEW, { apply: true, mergedBy: 'issue1298.test' })).rejects.toThrow(/isRelaunchDocumentField/);
    const { isRelaunchDocumentField } = await import('../../src/services/relaunch-clear');
    const res = await repo.mergeDuplicateInto(OLD, NEW, { apply: true, mergedBy: 'issue1298.test', isRelaunchDocumentField });
    expect((res.relaunchCleared?.invalidated ?? []).map((v) => `${v.tableName}.${v.fieldName}`).sort()).toEqual(['ipos.issueSize', 'ipos.lotSize']);
    // The old offer's terms are gone; the newer record refills what it states (lot 1000), and what it
    // does not state stays empty and re-asked (issue size).
    expect(rows(await db.execute(sql`SELECT issue_size::text AS s, lot_size AS l FROM ipos WHERE id = ${OLD}::uuid`))[0]).toEqual({ s: null, l: 1000 });
    expect(await audits(OLD, RELAUNCH_FILING_AUDIT_ACTION)).toHaveLength(1);
    expect(await readPostponedRelaunchState(db as never, OLD)).toBe('RELAUNCHED');
  }, 120_000);

  it('(#1304 M1) an unknown postponement time (postponed_at NULL) keeps POSTPONED even with an older relaunch mark on the row', async () => {
    await seed(NUL, 8);
    try {
      await postpone(NUL);
      await db.execute(sql`
        INSERT INTO audit_logs (timestamp, admin_user, action_type, ipo_id, table_name, field_name, details, success, created_at)
        VALUES (now() - interval '5 days', 'issue1304.test', ${RELAUNCH_FILING_AUDIT_ACTION}, ${NUL}::uuid, 'ipos', 'status', '{}'::jsonb, true, now() - interval '5 days')`);
      await db.execute(sql`UPDATE ipos SET postponed_at = NULL WHERE id = ${NUL}::uuid`);
      expect(await readPostponedRelaunchState(db as never, NUL)).toBe('NO_RELAUNCH');
      expect(await scrapeStatus(NUL, 'BSE', 'UPCOMING')).toMatchObject({ finalValue: 'POSTPONED', conflictReason: POSTPONED_KEPT_NO_RELAUNCH });
      expect(await storedStatus(NUL)).toBe('POSTPONED');
      // A known postponement time before the mark: the mark is a relaunch.
      await db.execute(sql`UPDATE ipos SET postponed_at = (now() AT TIME ZONE 'UTC') - interval '10 days' WHERE id = ${NUL}::uuid`);
      expect(await readPostponedRelaunchState(db as never, NUL)).toBe('RELAUNCHED');
    } finally {
      await db.execute(sql`UPDATE ipos SET status = 'UPCOMING', postponed_at = NULL WHERE id = ${NUL}::uuid`);
    }
  }, 120_000);

});
