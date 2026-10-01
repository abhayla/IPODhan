// implements: #1420 -- spec data-sourcing-pull-model.md §6 rule 4 "Answer states for a re-read of the same
// document" (OD-153, OD-158, OD-160). The REAL clear (reread-answer-clear.ts + data-persister.ts's ipos clear
// door) on ipodhan_test through scraper/tests/test-utils/db.ts (no pool of its own). One test per table row.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { getTestDb, cleanupTestDb } from '../test-utils/db';
import { clearRereadAnswers, NOT_PRINTED_REASON, type RereadClearInput, type RereadEnvelopeField } from '../../src/services/reread-answer-clear.js';

const RUN = Boolean(process.env.DATABASE_URL || process.env.TEST_DB_NAME);
const IPO = '00000000-0000-4000-8000-000000142001';
const DOC = '00000000-0000-4000-8000-0000001420d1';
const OTHER_DOC = '00000000-0000-4000-8000-0000001420d2';
const SHA = 'e'.repeat(64);
const OLD = 'extract_filing.py@2026-09-01';
const NEW = 'extract_filing.py@2026-10-01';

describe.skipIf(!RUN)('#1420 re-read answer clear (ipodhan_test)', () => {
  let db: any;

  const q = async (text: ReturnType<typeof sql>) => ((await db.execute(text)) as { rows: any[] }).rows;
  async function wipe() {
    for (const t of ['ipo_field_plan', 'field_extraction_failures', 'field_sources', 'field_protection_metadata', 'financial_data', 'ipo_details', 'documents']) {
      await db.execute(sql`DELETE FROM ${sql.identifier(t)} WHERE ipo_id = ${IPO}::uuid`);
    }
    await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
  }

  /** A value an OLDER read of DOC stored: column + DRHP provenance + a SUPPLIED plan row chosen from DOC. */
  async function stored(table: 'ipos' | 'ipo_details' | 'financial_data', column: string, sqlColumn: string, lineage: Record<string, unknown> = { documentId: DOC, sourceSha: SHA, extractorVersion: OLD }) {
    await db.execute(sql`
      INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, data_lineage, updated_by)
      VALUES (${IPO}::uuid, ${table}, '', ${column}, 'DRHP', 100, ${JSON.stringify({ method: 'FILING_EXTRACTION', docType: 'RHP', ...lineage })}::jsonb, 'FILING_PERSISTER')`);
    await db.execute(sql`
      INSERT INTO ipo_field_plan (ipo_id, table_name, row_key, field_name, rank1_source, rank2_source, state, manifest_version, chosen_source, chosen_rank, chosen_document_id)
      VALUES (${IPO}::uuid, ${table}, '', ${sqlColumn}, 'DOC', 'CHITTORGARH', 'SUPPLIED', 2, 'DOC', 1, ${DOC}::uuid)`);
  }
  const input = (fields: Record<string, RereadEnvelopeField>, extra: Partial<RereadClearInput> = {}): RereadClearInput => ({
    ipoId: IPO, docType: 'RHP', documentId: DOC, sourceSha: SHA, extractorVersion: NEW, fields, ...extra,
  });
  const fd = async () => (await q(sql`SELECT current_ratio, inventory_turnover, pe_ratio FROM financial_data WHERE ipo_id = ${IPO}::uuid`))[0];
  const plan = async (field: string) => (await q(sql`SELECT state, cause FROM ipo_field_plan WHERE ipo_id = ${IPO}::uuid AND field_name = ${field}`))[0];
  const failures = async () => q(sql`SELECT table_name, field_name, rule_id, extracted_value, cause FROM field_extraction_failures WHERE ipo_id = ${IPO}::uuid ORDER BY field_name`);

  beforeAll(async () => {
    db = await getTestDb();
    const cur = (await q(sql`SELECT current_database() AS d`))[0].d;
    if (cur !== 'ipodhan_test') throw new Error(`refusing ${cur}`);
  });
  afterAll(async () => {
    if (db) await wipe();
    await cleanupTestDb();
  });
  beforeEach(async () => {
    await wipe();
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, segment, offering_type, status, sector, price_range_min, price_range_max, lot_size, cin, issue_size)
      VALUES (${IPO}::uuid, 'Zzq1420 Reread Testco Limited', 'zzq1420-reread-testco', 'MAINBOARD', 'IPO', 'UPCOMING', 'Technology', 100, 120, 125, 'U12345MH2001PLC123456', 5000000000)`);
    await db.execute(sql`
      INSERT INTO documents (id, ipo_id, type, title, url, extraction_status, sha256)
      VALUES (${DOC}::uuid, ${IPO}::uuid, 'RHP', 'Reread proof RHP', 'https://example.invalid/rhp.pdf', 'COMPLETED', ${SHA}),
             (${OTHER_DOC}::uuid, ${IPO}::uuid, 'DRHP', 'Other DRHP', 'https://example.invalid/drhp.pdf', 'COMPLETED', ${'f'.repeat(64)})`);
    await db.execute(sql`INSERT INTO ipo_details (ipo_id, data_source, fresh_issue, lot_multiple) VALUES (${IPO}::uuid, 'DRHP', 3000000000, 7)`);
    await db.execute(sql`INSERT INTO financial_data (ipo_id, current_ratio, inventory_turnover, pe_ratio) VALUES (${IPO}::uuid, 1.62, 23.14, 31.5)`);
  });

  it('READER REFUSES (financial_data): cleared, reason + refused_value recorded, rank 2 asked (plan reopened) in one pass', async () => {
    await stored('financial_data', 'currentRatio', 'current_ratio');
    const r = await clearRereadAnswers(db, input({ current_ratio: { value: null, state: 'REFUSED', refused_value: 1.54, check: { passed: false, detail: 'statement basis Standalone, P&L Consolidated' } } }));
    expect(r.cleared.map((c) => c.field)).toEqual(['financial_data.currentRatio']);
    expect((await fd()).current_ratio).toBeNull();
    expect((await fd()).inventory_turnover).toBe('23.14'); // one field's refusal never clears another
    const [f] = await failures();
    expect([f.rule_id, f.extracted_value]).toEqual(['FAILED_VALIDATION', '1.54']);
    expect(f.cause).toContain('current reader refused: statement basis Standalone');
    expect((await plan('current_ratio')).state).toBe('PENDING');
  });

  it('READER REFUSES (ipos, through the ipos clear door) with a LIST refused_value', async () => {
    await stored('ipos', 'priceRangeMax', 'price_range_max');
    const r = await clearRereadAnswers(db, input({ price_band_cap: { value: null, state: 'REFUSED', refused_value: [118, 120], check: { passed: false, detail: 'two caps printed' } } }));
    expect(r.cleared).toHaveLength(1);
    const [ipo] = await q(sql`SELECT price_range_min, price_range_max FROM ipos WHERE id = ${IPO}::uuid`);
    expect([Number(ipo.price_range_min), ipo.price_range_max]).toEqual([100, null]);
    expect((await failures())[0].extracted_value).toBe('[118,120]');
    expect((await plan('price_range_max')).state).toBe('PENDING');
  });

  it('READER REFUSES (ipo_details): cleared and plan reopened', async () => {
    await stored('ipo_details', 'lotMultiple', 'lot_multiple');
    await clearRereadAnswers(db, input({ lot_multiple: { value: null, state: 'REFUSED', refused_value: 0, check: { passed: false, detail: 'multiple below 1' } } }));
    expect((await q(sql`SELECT lot_multiple FROM ipo_details WHERE ipo_id = ${IPO}::uuid`))[0].lot_multiple).toBeNull();
    expect((await plan('lot_multiple')).state).toBe('PENDING');
  });

  it('STATED_NOT_PRINTED: cleared with "current reader: not printed", rank 2 asked', async () => {
    await stored('financial_data', 'inventoryTurnover', 'inventory_turnover');
    const r = await clearRereadAnswers(db, input({ inventory_turnover: { value: null, state: 'STATED_NOT_PRINTED', reason: 'ratio_not_applicable_stated' } }));
    expect(r.cleared[0]).toMatchObject({ state: 'STATED_NOT_PRINTED', reason: NOT_PRINTED_REASON });
    expect((await fd()).inventory_turnover).toBeNull();
    expect((await failures())[0].rule_id).toBe('NOT_PRINTED');
    expect((await plan('inventory_turnover')).state).toBe('PENDING');
  });

  it.each([
    ['MISSED label', { value: null, state: 'MISSED', check: { passed: true, detail: 'no ratio note' } }],
    ['OCR below the floor', { value: null, state: 'LOW_CONFIDENCE_OCR' }],
    ['no answer state (older output)', { value: null, check: { passed: false } }],
    ['a state this code does not know', { value: null, state: 'SOMETHING_NEW' }],
  ] as Array<[string, RereadEnvelopeField]>)('%s: kept, nothing asked', async (_name, field) => {
    await stored('financial_data', 'currentRatio', 'current_ratio');
    const r = await clearRereadAnswers(db, input({ current_ratio: field }));
    expect(r.cleared).toEqual([]);
    expect((await fd()).current_ratio).toBe('1.62');
    expect(await failures()).toEqual([]);
    expect((await plan('current_ratio')).state).toBe('SUPPLIED');
  });

  it('field absent from the newer output (extractor returned no result for it): kept', async () => {
    await stored('financial_data', 'currentRatio', 'current_ratio');
    await clearRereadAnswers(db, input({}));
    expect((await fd()).current_ratio).toBe('1.62');
  });

  it('OD-160 persister hold-back (fresh/OFS reconciliation; CIN not 21 chars): KEPT, cause recorded', async () => {
    await stored('ipo_details', 'freshIssue', 'fresh_issue');
    await stored('ipos', 'cin', 'cin');
    const r = await clearRereadAnswers(db, input(
      { fresh_issue_amount: { value: 260, state: 'VALUE' }, cin: { value: 'U1234', state: 'VALUE' } },
      { heldBack: new Map([['fresh_issue_amount', 'persister hold-back: fresh/OFS reconciliation failed'], ['cin', 'persister hold-back: not a 21-character CIN']]) }
    ));
    expect(r.cleared).toEqual([]);
    expect(r.keptHoldBack.map((k) => k.field).sort()).toEqual(['ipo_details.freshIssue', 'ipos.cin']);
    expect((await q(sql`SELECT fresh_issue FROM ipo_details WHERE ipo_id = ${IPO}::uuid`))[0].fresh_issue).toBe('3000000000.00');
    expect((await q(sql`SELECT cin FROM ipos WHERE id = ${IPO}::uuid`))[0].cin).toBe('U12345MH2001PLC123456');
  });

  it('OD-160 derived value (ipos.issueSize) when an input is refused: KEPT', async () => {
    await stored('ipos', 'issueSize', 'issue_size');
    const r = await clearRereadAnswers(db, input({ total_offer_amount_at_cap: { value: null, state: 'REFUSED', refused_value: 1, check: { passed: false } }, ofs_amount_at_cap: { value: null, state: 'REFUSED', refused_value: 1, check: { passed: false } } }));
    expect(r.cleared).toEqual([]);
    expect((await q(sql`SELECT issue_size FROM ipos WHERE id = ${IPO}::uuid`))[0].issue_size).not.toBeNull();
  });

  it('admin-held value (any answer): kept, hold re-read under the ipos row lock', async () => {
    await stored('financial_data', 'currentRatio', 'current_ratio');
    await db.execute(sql`INSERT INTO field_protection_metadata (ipo_id, table_name, field_name, is_protected) VALUES (${IPO}::uuid, 'financial_data', 'currentRatio', true)`);
    const r = await clearRereadAnswers(db, input({ current_ratio: { value: null, state: 'REFUSED', refused_value: 1.54, check: { passed: false } } }));
    expect(r.held).toEqual(['financial_data.currentRatio']);
    expect((await fd()).current_ratio).toBe('1.62');
    expect(await failures()).toEqual([]);
  });

  it('lineage records no extractor version: never cleared', async () => {
    await stored('financial_data', 'currentRatio', 'current_ratio', { documentId: DOC, sourceSha: SHA });
    const r = await clearRereadAnswers(db, input({ current_ratio: { value: null, state: 'REFUSED', refused_value: 1.54, check: { passed: false } } }));
    expect(r.notOlderRead).toEqual(['financial_data.currentRatio']);
    expect((await fd()).current_ratio).toBe('1.62');
  });

  it('stored value from a DIFFERENT document: kept (the rule is a re-read of the same document)', async () => {
    await stored('financial_data', 'currentRatio', 'current_ratio', { documentId: OTHER_DOC, sourceSha: 'f'.repeat(64), extractorVersion: OLD });
    await clearRereadAnswers(db, input({ current_ratio: { value: null, state: 'REFUSED', refused_value: 1.54, check: { passed: false } } }));
    expect((await fd()).current_ratio).toBe('1.62');
  });

  it('clear, reason and plan reopen commit together or not at all', async () => {
    await stored('financial_data', 'currentRatio', 'current_ratio');
    // documentId that is not a document: the reason row's FK fails after the clear ran -> all rolled back.
    const bad = '00000000-0000-4000-8000-0000001420ff';
    await db.execute(sql`UPDATE field_sources SET data_lineage = data_lineage || ${JSON.stringify({ documentId: bad })}::jsonb WHERE ipo_id = ${IPO}::uuid`);
    await expect(clearRereadAnswers(db, input({ current_ratio: { value: null, state: 'REFUSED', refused_value: 1.54, check: { passed: false } } }, { documentId: bad }))).rejects.toThrow();
    expect((await fd()).current_ratio).toBe('1.62');
    expect(await failures()).toEqual([]);
  });
});
