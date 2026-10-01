// #1442 (follow-up of #1417 / PR #1441): repair of documents rows the old Chittorgarh default typed
// PROSPECTUS. Drives the REAL tool functions against real Postgres (ipodhan_test) through
// tests/test-utils/db.ts, with the real cover fixtures from #1441 (no text typed from memory).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTestDb, cleanupTestDb } from '../test-utils/db';
import {
  applyRepair,
  formatReport,
  planRepair,
  selectDefaultTypedRows,
  type PlannedRow,
  type RepairDeps,
} from '../../scripts/repair-chittorgarh-default-prospectus';
import { chittorgarhDocumentTitle } from '../../src/scrapers/chittorgarh-document-scraper';
import { planRetype } from '../../src/scripts/retype-misclassified-documents';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'chittorgarh-untyped-covers');
const cover = (f: string) => readFileSync(path.join(FIX, f), 'utf8');
const DEAD_LINK_MARKER = Buffer.from('HTTP 404'); // what makeLiveFetch hands the resolver for a 404/410

const U = (n: number) => `00000000-0000-4000-9442-${String(n).padStart(12, '0')}`;
const D = (n: number) => `00000000-0000-4000-9443-${String(n).padStart(12, '0')}`;
const HOST = 'https://files.test.invalid/1442/';

interface Seed {
  n: number;
  slug: string;
  file: string;
  status?: string;
  title?: string;
  active?: boolean;
  exchange?: string;
}
// n: 1 confirmed, 2 RHP, 3 not-a-PDF, 4 title-less cover, 5 unreadable, 6 fetch fails, 7 RHP+COMPLETED,
// 8 file name names a type, 9 not a Chittorgarh title, 10 RHP rule-only (in no list), 11 retype collides, 12 already retired
const SEEDS: Seed[] = [
  { n: 1, slug: 't1442-confirmed', file: 'a997.pdf' },
  { n: 2, slug: 't1442-rhp', file: 'b201.pdf' },
  { n: 3, slug: 't1442-notpdf', file: 'c42.pdf' },
  { n: 4, slug: 't1442-notitle', file: 'd301.pdf' },
  { n: 5, slug: 't1442-unreadable', file: 'e401.pdf' },
  { n: 6, slug: 't1442-fetchfails', file: 'f501.pdf' },
  { n: 7, slug: 't1442-completed', file: 'g601.pdf', status: 'COMPLETED' },
  { n: 8, slug: 't1442-named', file: 'Final-Prospectus-h701.pdf' },
  { n: 9, slug: 't1442-otherpath', file: 'i801.pdf', title: 'PROSPECTUS - some other path' },
  { n: 10, slug: 'zz-t1442-unlisted-rule-only', file: 'j901.pdf' },
  { n: 11, slug: 't1442-collide', file: 'k1001.pdf', exchange: 'NSE' },
  { n: 12, slug: 't1442-retired', file: 'l1101.pdf', active: false },
];
const IDS = SEEDS.map((s) => U(s.n));
const urlOf = (s: Seed) => `${HOST}${s.file}`;
const COLLIDE_RHP_DOC = D(111);

// url -> what the "download" yields; PDFs carry their fixture key after the magic bytes.
const MAGIC = '%PDF-1.7 ';
const PDF = (key: string) => Buffer.from(`${MAGIC}${key}`);
const BYTES: Record<string, Buffer | null> = {
  'a997.pdf': PDF('adisoft-997.cover.txt'),
  'b201.pdf': PDF('dove-soft-rhp.cover.txt'),
  'c42.pdf': DEAD_LINK_MARKER,
  'd301.pdf': PDF('fractal-sebi-viewer.cover.txt'),
  'e401.pdf': PDF('UNREADABLE'),
  'f501.pdf': null,
  'g601.pdf': PDF('dove-soft-rhp.cover.txt'),
  'i801.pdf': PDF('dove-soft-rhp.cover.txt'),
  'j901.pdf': PDF('dove-soft-rhp.cover.txt'),
  'k1001.pdf': PDF('dove-soft-rhp.cover.txt'),
  'l1101.pdf': PDF('dove-soft-rhp.cover.txt'),
};
const deps: RepairDeps = {
  delayMs: 0,
  fetchPdf: async (url) => BYTES[url.slice(HOST.length)] ?? null,
  coverText: async (pdf) => {
    const key = pdf.toString('latin1').slice(MAGIC.length);
    if (key === 'UNREADABLE') return { usable: false, reason: 'no_text_layer', detail: 'scanned' };
    const text = cover(key);
    return { usable: true, text, alnum: text.length };
  },
};
const OPTS = { apply: true, includeCompleted: false, ipoIds: IDS, slotPrefix: 'testslot:' };

let db: Awaited<ReturnType<typeof getTestDb>>;
const q = async (s: ReturnType<typeof sql>) => ((await db.execute(s)) as unknown as { rows: Record<string, any>[] }).rows;
const docRow = async (n: number) =>
  (await q(sql`SELECT type::text AS type, title, url, is_active, extraction_error FROM documents WHERE id = ${D(n)}::uuid`))[0];
const planRow = async (n: number) =>
  (await q(sql`SELECT state::text AS state FROM ipo_field_plan WHERE id = ${D(n + 1000)}::uuid`))[0];

async function cleanup() {
  await db.execute(sql`DELETE FROM ipo_field_plan WHERE ipo_id = ANY(${sql.param(IDS)}::uuid[])`);
  await db.execute(sql`DELETE FROM documents WHERE ipo_id = ANY(${sql.param(IDS)}::uuid[])`);
  await db.execute(sql`DELETE FROM ipos WHERE id = ANY(${sql.param(IDS)}::uuid[])`);
}

beforeAll(async () => {
  db = await getTestDb();
  await cleanup();
  for (const s of SEEDS) {
    await db.execute(sql`INSERT INTO ipos (id, company_name, slug, offering_type, segment, status, open_date)
      VALUES (${U(s.n)}::uuid, ${s.slug}, ${s.slug}, 'IPO', 'SME', 'LISTED', '2026-08-01')`);
    await db.execute(sql`INSERT INTO documents (id, ipo_id, type, title, url, extraction_status, is_active, exchange)
      VALUES (${D(s.n)}::uuid, ${U(s.n)}::uuid, 'PROSPECTUS',
              ${s.title ?? chittorgarhDocumentTitle('PROSPECTUS', s.slug)}, ${urlOf(s)}, ${s.status ?? 'PENDING'}, ${s.active ?? true}, ${s.exchange ?? null})`);
  }
  // a real RHP already on the collide IPO (same type/exchange/sequence: the retype must collide and roll back)
  await db.execute(sql`INSERT INTO documents (id, ipo_id, type, title, url, extraction_status, exchange)
    VALUES (${COLLIDE_RHP_DOC}::uuid, ${U(11)}::uuid, 'RHP', 'RHP - collide', ${`${HOST}real-rhp-collide.pdf`}, 'PENDING', 'NSE')`);
  // fetch-state rows (PROSPECTUS) that hold documents 2 (retype) and 3 (retire) as FOUND
  for (const n of [2, 3]) {
    await db.execute(sql`INSERT INTO document_fetch_state (ipo_id, doc_type, state, document_id)
      VALUES (${U(n)}::uuid, 'PROSPECTUS', 'FOUND', ${D(n)}::uuid)`);
  }
  // plan rows SUPPLIED from documents 2 (RHP retype), 3 (retire) and 7 (completed)
  for (const n of [2, 3, 7]) {
    await db.execute(sql`INSERT INTO ipo_field_plan (id, ipo_id, table_name, row_key, field_name, rank1_source, state, manifest_version, chosen_source, chosen_document_id)
      VALUES (${D(n + 1000)}::uuid, ${U(n)}::uuid, 'ipos', '', 'priceBandLow', 'DOC', 'SUPPLIED', 1, 'DOC', ${D(n)}::uuid)`);
  }
});

afterAll(async () => {
  if (db) await cleanup();
  await cleanupTestDb();
});

describe('repair-chittorgarh-default-prospectus (#1442) on real Postgres', () => {
  let planned: PlannedRow[] = [];

  it('selects by RULE: stored PROSPECTUS + Chittorgarh title + file name naming no type; not by any list', async () => {
    const sel = await selectDefaultTypedRows(db as never, IDS);
    const slugs = sel.map((r) => r.slug).sort();
    expect(slugs).toEqual(
      [
        't1442-completed',
        't1442-collide',
        't1442-confirmed',
        't1442-fetchfails',
        't1442-notitle',
        't1442-notpdf',
        't1442-rhp',
        't1442-unreadable',
        'zz-t1442-unlisted-rule-only',
      ].sort()
    );
    // not selected: a file name that names a type, a non-Chittorgarh title, an already-retired row
    expect(slugs).not.toContain('t1442-named');
    expect(slugs).not.toContain('t1442-otherpath');
    expect(slugs).not.toContain('t1442-retired');
  });

  it('answer-state table: each cover result maps to its action; dry run writes nothing', async () => {
    planned = await planRepair(db as never, deps, IDS);
    const by = Object.fromEntries(planned.map((p) => [p.slug, p]));
    expect(by['t1442-confirmed']).toMatchObject({ action: 'KEEP_CONFIRMED', reason: 'confirmed by cover' });
    expect(by['t1442-rhp']).toMatchObject({ action: 'RETYPE', newType: 'RHP', planRowsToReopen: 1 });
    expect(by['zz-t1442-unlisted-rule-only']).toMatchObject({ action: 'RETYPE', newType: 'RHP' });
    expect(by['t1442-notpdf']).toMatchObject({ action: 'RETIRE', cover: 'not_pdf', planRowsToReopen: 1 });
    expect(by['t1442-notitle'].action).toBe('NO_CHANGE'); // fractal: cover names no offer type
    expect(by['t1442-unreadable']).toMatchObject({ action: 'NO_CHANGE', cover: 'cover_unreadable' });
    expect(by['t1442-fetchfails']).toMatchObject({ action: 'NO_CHANGE', cover: 'fetch_failed' });
    // never defaults to PROSPECTUS: the unchanged rows were not turned into KEEP
    expect(planned.filter((p) => p.action === 'KEEP_CONFIRMED').map((p) => p.slug)).toEqual(['t1442-confirmed']);
    const report = formatReport(planned).join('\n');
    expect(report).toMatch(/EXTRACTION ALREADY COMPLETED \(1\).*t1442-completed/);
    expect(report).toMatch(/KNOWN-DATA ISSUES \(unchanged, 3\)/);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 10]) expect((await docRow(n)).type).toBe('PROSPECTUS');
    expect((await docRow(3)).is_active).toBe(true);
  });

  it('apply: retypes by cover and re-opens the plan; retires a real non-PDF; leaves unreadable, completed and collisions alone', async () => {
    const { outcomes, cacheKeys } = await applyRepair(db as never, planned, OPTS);
    const st = Object.fromEntries(outcomes.map((o) => [o.slug, o]));
    expect(st['t1442-rhp'].status).toBe('APPLIED');
    expect(st['zz-t1442-unlisted-rule-only'].status).toBe('APPLIED');
    expect(st['t1442-notpdf'].status).toBe('APPLIED');
    expect(st['t1442-completed'].status).toBe('SKIPPED_COMPLETED');
    expect(st['t1442-collide']).toMatchObject({ status: 'NO_CHANGE', detail: `NO_CHANGE: an RHP/DRHP row already exists for this IPO (document ${COLLIDE_RHP_DOC})` });

    expect((await docRow(2)).type).toBe('RHP');
    // the title is rewritten with the type, so retype-misclassified-documents proposes NO change (it falls back to the title)
    const r2 = await docRow(2);
    expect(r2.title).toBe(chittorgarhDocumentTitle('RHP', 't1442-rhp'));
    expect(planRetype({ id: D(2), url: r2.url, title: r2.title, type: r2.type })).toBeNull();
    // fetch-state rows that held these documents are back to WANTED, pointer cleared (not FOUND forever)
    for (const n of [2, 3]) {
      expect((await q(sql`SELECT state::text AS state, document_id FROM document_fetch_state WHERE ipo_id = ${U(n)}::uuid`))[0]).toMatchObject({ state: 'WANTED', document_id: null });
    }
    expect((await planRow(2)).state).toBe('PENDING'); // re-opened so the field re-ranks (OD-154)
    expect((await docRow(10)).type).toBe('RHP');
    const retired = await docRow(3);
    expect(retired).toMatchObject({ type: 'PROSPECTUS', is_active: false });
    expect(retired.extraction_error).toMatch(/RETIRED_NOT_A_DOCUMENT/);
    expect((await planRow(3)).state).toBe('PENDING');
    // untouched: confirmed, title-less, unreadable, fetch failed, completed, and the collision (rolled back whole)
    for (const n of [1, 4, 5, 6, 7, 11]) expect(await docRow(n)).toMatchObject({ type: 'PROSPECTUS', is_active: true });
    expect((await planRow(7)).state).toBe('SUPPLIED');
    // cache keys for exactly the IPOs that changed, with the slot prefix
    expect(cacheKeys.sort()).toEqual([U(2), U(3), U(10)].map((id) => `testslot:documents:${id}`).sort());
  });

  it('is idempotent: a second run proposes writes only for what is still stored as PROSPECTUS and unfinished', async () => {
    const again = await planRepair(db as never, deps, IDS);
    expect(
      again.filter((p) => p.action === 'RETYPE' || p.action === 'RETIRE').map((p) => p.slug).sort()
    ).toEqual(['t1442-collide', 't1442-completed']);
  });

  it('--include-completed also repairs a COMPLETED row and re-opens its plan', async () => {
    const again = await planRepair(db as never, deps, IDS);
    const { outcomes } = await applyRepair(
      db as never,
      again.filter((p) => p.slug === 't1442-completed'),
      { ...OPTS, includeCompleted: true }
    );
    expect(outcomes[0].status).toBe('APPLIED');
    expect((await docRow(7)).type).toBe('RHP');
    expect((await planRow(7)).state).toBe('PENDING');
  });
});
