// implements: #1420 -- spec §6 rule 4 answer-state table (OD-153, OD-158, OD-160): the pure decision per row.
import { describe, it, expect, vi } from 'vitest';

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

vi.mock('../../../src/services/data-persister.js', () => ({ clearIpoColumnsForRereadAnswer: vi.fn(async (_tx: unknown, _id: string, cols: string[]) => cols) }));
vi.mock('../../../src/utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// The clear path's admin-hold read: no hold, so a due clear reaches the UPDATE.
vi.mock('@ipodhan/shared/services/field-hold', () => ({
  protectionTableName: (t: string) => t,
  lockAndReadFieldHolds: vi.fn(async (_tx: unknown, ids: string[]) => new Map(ids.map((id) => [id, { hidden: false, writeBlocked: false, protectedFields: new Set() }]))),
}));

import {
  clearRereadAnswers, compareExtractorVersions, decideRereadAnswer, findAmbiguousOcrFields, isOlderReadOfSameDocument,
  REREAD_CLEARABLE_FIELDS, NOT_PRINTED_REASON, DOCUMENT_HAS_AMBIGUOUS_OCR, type RereadEnvelopeField, type RereadExecutor,
} from '../../../src/services/reread-answer-clear.js';

describe('decideRereadAnswer: one row of the table per state', () => {
  it('REFUSED clears with the refusal as reason and carries refused_value (may be a list)', () => {
    const d = decideRereadAnswer({ value: null, state: 'REFUSED', refused_value: [1.54, 1.6], check: { passed: false, detail: 'basis mismatch' } });
    expect(d).toEqual({ action: 'CLEAR', state: 'REFUSED', reason: 'current reader refused: basis mismatch', refusedValue: [1.54, 1.6], extractorReason: null });
  });
  it('STATED_NOT_PRINTED clears with "current reader: not printed"', () => {
    expect(decideRereadAnswer({ value: null, state: 'STATED_NOT_PRINTED', check: { passed: true, detail: 'not_ascertainable_loss' } })).toMatchObject({ action: 'CLEAR', reason: NOT_PRINTED_REASON, extractorReason: 'not_ascertainable_loss' });
  });

  it('STATED_NOT_PRINTED with a reason that is not on the shared list (or none) is kept (fail closed)', () => {
    expect(decideRereadAnswer({ value: null, state: 'STATED_NOT_PRINTED', check: { passed: true, detail: 'peer_comparison_table_not_in_document' } })).toMatchObject({ action: 'KEEP', why: 'UNKNOWN_STATE' });
    expect(decideRereadAnswer({ value: null, state: 'STATED_NOT_PRINTED' })).toMatchObject({ action: 'KEEP', why: 'UNKNOWN_STATE' });
  });
  it.each([
    ['MISSED', { value: null, state: 'MISSED', check: { passed: true } }, 'MISSED'],
    ['MISSED with a failed check', { value: null, state: 'MISSED', check: { passed: false } }, 'MISSED'],
    ['LOW_CONFIDENCE_OCR', { value: 3, state: 'LOW_CONFIDENCE_OCR' }, 'LOW_CONFIDENCE_OCR'],
    ['VALUE', { value: 3, state: 'VALUE' }, 'VALUE'],
    ['no state (older output)', { value: null, check: { passed: false } }, 'NO_STATE'],
    ['unknown state', { value: null, state: 'NEW_STATE' }, 'UNKNOWN_STATE'],
  ] as const)('%s keeps', (_n, field, why) => {
    expect(decideRereadAnswer(field as never)).toMatchObject({ action: 'KEEP', why });
  });
  it('round 3: a REFUSED answer off a page under the OCR floor keeps (second layer to the extractor)', () => {
    const f = { value: null, page: null, state: 'REFUSED', refused_page: 3, source_text: 'OCR', ocr_confidence: 0.1,
      check: { name: 'ocr_confidence_floor', passed: false, detail: 'ocr_low_confidence: 0.1000 < 0.80' } };
    expect(decideRereadAnswer(f as never)).toMatchObject({ action: 'KEEP', why: 'LOW_CONFIDENCE_OCR' });
  });
  it('an absent field keeps', () => {
    expect(decideRereadAnswer(undefined)).toMatchObject({ action: 'KEEP', why: 'ABSENT' });
  });
  it('OD-160: a persister hold-back keeps, whatever state the envelope carries', () => {
    expect(decideRereadAnswer({ value: 260, state: 'VALUE' }, true)).toMatchObject({ action: 'KEEP', why: 'PERSISTER_HOLD_BACK' });
    expect(decideRereadAnswer({ value: null, state: 'REFUSED' }, true)).toMatchObject({ action: 'KEEP', why: 'PERSISTER_HOLD_BACK' });
  });
});

describe('isOlderReadOfSameDocument (fail closed)', () => {
  const V1 = 'extract_filing.py@2026-09-26';
  const V2 = 'extract_filing.py@2026-09-26b';
  const doc = { documentId: 'd1', sourceSha: 's1', extractorVersion: V2 };
  it('same document, older version: true', () => {
    expect(isOlderReadOfSameDocument({ source: 'DRHP', dataLineage: { documentId: 'd1', extractorVersion: V1 } }, doc)).toBe(true);
  });
  it.each([
    ['no extractor version in lineage', { source: 'DRHP', dataLineage: { documentId: 'd1' } }],
    ['empty extractor version', { source: 'DRHP', dataLineage: { documentId: 'd1', extractorVersion: '' } }],
    ['same version', { source: 'DRHP', dataLineage: { documentId: 'd1', extractorVersion: V2 } }],
    ['different document', { source: 'DRHP', dataLineage: { documentId: 'd9', sourceSha: 's9', extractorVersion: V1 } }],
    ['not a document source', { source: 'NSE', dataLineage: { documentId: 'd1', extractorVersion: V1 } }],
  ])('%s: false', (_n, prov) => {
    expect(isOlderReadOfSameDocument(prov as never, doc)).toBe(false);
  });
  it.each([
    ['stored NEWER than this reader', { source: 'DRHP', dataLineage: { documentId: 'd1', extractorVersion: 'extract_filing.py@2026-09-27' } }],
    ['stored version in an unknown form', { source: 'DRHP', dataLineage: { documentId: 'd1', extractorVersion: 'v1' } }],
    ['stored version of another extractor', { source: 'DRHP', dataLineage: { documentId: 'd1', extractorVersion: 'anchor_report_text.py@2026-01-01' } }],
  ])('round 3, version order: %s: false (never cleared)', (_n, prov) => {
    expect(isOlderReadOfSameDocument(prov as never, doc)).toBe(false);
  });
  it('round 3: an OLDER reader never clears a value a NEWER reader stored', () => {
    const newer = { source: 'DRHP', dataLineage: { documentId: 'd1', extractorVersion: 'extract_filing.py@2026-10-01' } };
    expect(isOlderReadOfSameDocument(newer, { ...doc, extractorVersion: 'extract_filing.py@2026-09-27' })).toBe(false);
    expect(isOlderReadOfSameDocument(newer, { ...doc, extractorVersion: 'extract_filing.py@2026-10-02' })).toBe(true);
  });
  it('compareExtractorVersions orders by date then same-day letter; unknown form is null', () => {
    expect(compareExtractorVersions('extract_filing.py@2026-09-26', 'extract_filing.py@2026-09-26b')).toBe(-1);
    expect(compareExtractorVersions('extract_filing.py@2026-09-26b', 'extract_filing.py@2026-09-27')).toBe(-1);
    expect(compareExtractorVersions('extract_filing.py@2026-09-27', 'extract_filing.py@2026-09-27')).toBe(0);
    expect(compareExtractorVersions('extract_filing.py@2026-10-01', 'extract_filing.py@2026-09-30')).toBe(1);
    expect(compareExtractorVersions('extract_filing.py@2026-9-1', 'extract_filing.py@2026-09-27')).toBeNull();
    expect(compareExtractorVersions(null, 'extract_filing.py@2026-09-27')).toBeNull();
  });
  it('no provenance or no current version: false', () => {
    expect(isOlderReadOfSameDocument(null, doc)).toBe(false);
    expect(isOlderReadOfSameDocument({ source: 'DRHP', dataLineage: { documentId: 'd1', extractorVersion: V1 } }, { ...doc, extractorVersion: null })).toBe(false);
  });
});

describe('REREAD_CLEARABLE_FIELDS', () => {
  it('never lists a derived value (OD-160, §2.6)', () => {
    const cols = REREAD_CLEARABLE_FIELDS.map((f) => `${f.tableName}.${f.column}`);
    expect(cols).not.toContain('ipos.issueSize');
    expect(cols).not.toContain('financial_data.quickRatio');
  });
});

// PR #1472 round 3 (B8): the clear path is the ONE choke point. A document whose envelope holds ANY
// ambiguous OCR value clears nothing, whichever check refused (listed or not).
describe('clearRereadAnswers: a document with an ambiguous OCR value clears nothing', () => {
  const OLDER = 'extract_filing.py@2026-09-26';
  const NEWER = 'extract_filing.py@2026-10-02';
  /** A fake DB on the real clear path: every stored value is an older read of this document. */
  function fakeDb() {
    const calls = { transactions: 0, executes: 0 };
    const tx: RereadExecutor = {
      execute: async () => {
        calls.executes += 1;
        return { rows: [{ source: 'DRHP', data_lineage: { documentId: 'd1', extractorVersion: OLDER }, ipo_id: 'i1', id: 'p1' }] };
      },
      transaction: async (fn) => { calls.transactions += 1; return fn(tx); },
    };
    return { db: tx, calls };
  }
  const run = (db: RereadExecutor, fields: Record<string, unknown>) =>
    clearRereadAnswers(db, { ipoId: 'i1', docType: 'RHP', documentId: 'd1', sourceSha: 's1', extractorVersion: NEWER, fields: fields as never });
  const refused = (check: string, refusedValue: unknown) =>
    ({ value: null, state: 'REFUSED', refused_value: refusedValue, source_text: 'TEXT', check: { name: check, passed: false, detail: `check_failed: ${check}` } });
  // The guard's own output for an OCR cap printed "1.785" (ocr_pages.guard_ambiguous_thousands).
  const AMBIGUOUS_CAP = { value: null, page: 0, source_text: 'OCR', state: 'MISSED', ambiguous_token: '1.785',
    check: { name: 'not_extractable', passed: true, detail: "ocr_ambiguous_thousands_separator: read '1.785' off OCR page 0" } };

  const CASES: ReadonlyArray<readonly [string, string, string, unknown]> = [
    ['price_band_ordering', 'price_band_floor', 'ipos.priceRangeMin', 1700],
    ['cover_price_within_bounds', 'price_band_floor', 'ipos.priceRangeMin', 1700],
    ['pe_equals_price_over_diluted_eps', 'pe_at_cap', 'financial_data.peRatio', 41.2],
    ['price_over_secondary_waca_equals_printed_multiple', 'market_cap_at_cap', 'financial_data.marketCap', 9000],
    ['shares_x_price_equals_amount', 'fresh_issue_amount', 'ipo_details.freshIssue', 2500],
    ['a_check_added_after_this_pr_in_no_list', 'lot_size', 'ipos.lotSize', 8],
  ];

  it.each(CASES)('%s refusal of %s: zero clears, kept as document_has_ambiguous_ocr', async (check, field, column, v) => {
    const { db, calls } = fakeDb();
    const r = await run(db, { price_band_cap: AMBIGUOUS_CAP, [field]: refused(check, v) });
    expect(r.cleared).toEqual([]);
    expect(calls.transactions).toBe(0);
    expect(calls.executes).toBe(0);
    expect(r.keptAmbiguousOcr).toEqual([{ field: column, reason: DOCUMENT_HAS_AMBIGUOUS_OCR, ambiguousFields: ['price_band_cap'] }]);
  });

  it.each(CASES)('control, no ambiguity: %s refusal of %s still clears (unchanged)', async (check, field, column, v) => {
    const { db, calls } = fakeDb();
    const r = await run(db, { price_band_cap: { value: 1785, state: 'VALUE', source_text: 'TEXT' }, [field]: refused(check, v) });
    expect(r.cleared.map((c) => c.field)).toEqual([column]);
    expect(calls.transactions).toBe(1);
    expect(r.keptAmbiguousOcr).toEqual([]);
  });

  it('a stated absence from that document is kept too; a demoted dependent alone is a marker', async () => {
    const { db, calls } = fakeDb();
    const dependent = { value: null, state: 'MISSED', depends_on_ambiguous_ocr: 'ofs_amount',
      check: { name: 'not_extractable', passed: true, detail: 'depends_on_ambiguous_ocr:ofs_amount (total_offer_size_reconciles refused against an ambiguous OCR value)' } };
    const r = await run(db, {
      total_offer_amount_at_cap: dependent,
      inventory_turnover: { value: null, state: 'STATED_NOT_PRINTED', check: { name: 'not_extractable', passed: true, detail: 'not_ascertainable_loss' } },
    });
    expect(r.cleared).toEqual([]);
    expect(calls.transactions).toBe(0);
    expect(r.keptAmbiguousOcr.map((k) => k.field)).toEqual(['financial_data.inventoryTurnover']);
  });

  it('findAmbiguousOcrFields: any field, any depth, either reason; a clean envelope has none', () => {
    expect(findAmbiguousOcrFields({ a: { state: 'VALUE' }, b: { rows: [{ note: { reason: 'ocr_ambiguous_thousands_separator' } }] } })).toEqual(['b']);
    expect(findAmbiguousOcrFields({ z: { ambiguous_token: '1.700' }, y: { depends_on_ambiguous_ocr: 'price_band_cap' } })).toEqual(['y', 'z']);
    expect(findAmbiguousOcrFields({ a: { state: 'REFUSED', check: { name: 'price_band_ordering', detail: 'floor 82 not < cap 72' } } })).toEqual([]);
    expect(findAmbiguousOcrFields(undefined)).toEqual([]);
  });

  it('the REAL extractor guard: OCR cap "1.785" + a P/E refused by a check missing from CROSS_FIELD_CHECK_INPUTS clear nothing', async (ctx) => {
    const scripts = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts');
    const envelope = {
      price_band_cap: { value: 1.785, page: 0, source_text: 'OCR', state: 'VALUE', check: { name: 'cap_check', passed: true } },
      pe_at_cap: { value: null, page: null, state: 'REFUSED', refused_value: 41.2, refused_page: 3, source_text: 'TEXT',
        check: { name: 'pe_equals_price_over_diluted_eps', passed: false, detail: 'P/E at cap 41.2 != 1.785 / 43.3' } },
      lot_size: { value: null, state: 'REFUSED', refused_value: 8, source_text: 'TEXT',
        check: { name: 'a_check_added_after_this_pr_in_no_list', passed: false, detail: 'x' } },
    };
    const code = 'import json,sys; from ocr_pages import guard_ambiguous_thousands as g; ' +
      'f=json.load(sys.stdin); g(f, {0: "PRICE BAND: TO Rs 1.785 PER EQUITY SHARE"}); print(json.dumps(f))';
    const py = (bin: string) => spawnSync(bin, ['-c', code], { cwd: scripts, input: JSON.stringify(envelope), encoding: 'utf8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' } });
    let out = py('python3');
    if (out.error) out = py('python');
    // No interpreter on this runner: the python suite (pr-gate python-tests) covers the guard's side.
    if (out.error) ctx.skip();
    expect(out.status, out.stderr).toBe(0);
    const guarded = JSON.parse(out.stdout.trim()) as Record<string, RereadEnvelopeField>;
    // The guard MISSES the cap but (by design of a hand-kept list) leaves both refusals REFUSED.
    expect(guarded.price_band_cap.state).toBe('MISSED');
    expect(guarded.pe_at_cap.state).toBe('REFUSED');
    const { db, calls } = fakeDb();
    const r = await run(db, guarded);
    expect(r.cleared).toEqual([]);
    expect(calls.transactions).toBe(0);
    expect(r.keptAmbiguousOcr.map((k) => k.field).sort()).toEqual(['financial_data.peRatio', 'ipos.lotSize']);
  });
});
