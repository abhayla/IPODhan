/**
 * Item 40 (OD-164(c), row 27): the objects-of-the-offer reader's answer reaches `ipos.objectives`.
 *
 * The rows are the Hy-Tech Engineers PROSPECTUS's own utilisation table, as the reader returns them for
 * scraper/tests/fixtures/objects-of-offer/hy-tech-mainboard-prospectus.json (scraper/scripts/
 * test_objects_of_offer.py asserts the same values from the text): 299.66 / 160.00 / 59.64 million, stored
 * in crore (29.966 / 16 / 5.964), F4 passed against net proceeds 519.30 million.
 *
 * Proved: (1) an EMPTY column is written with a receipt, in crore; (2) a price band advertisement writes
 * nothing and leaves no receipt (OD-96); (3) a stored identical list is credited by the receipt, not
 * re-written (OD-73); (4) a stored different list (a website's, or ADMIN's) is left for the walk's OD-161
 * path, receipt filed; (5) a REFUSED (F4), MISSED or STATED_NOT_PRINTED answer writes nothing and files no
 * receipt; (6) a malformed row drops the whole list; an unpriced [bullet] row keeps `amount: null`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertIPOMock } = vi.hoisted(() => ({ upsertIPOMock: vi.fn(async () => 'ipo-id') }));
vi.mock('../../../src/services/data-persister.js', () => ({ upsertIPO: upsertIPOMock }));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  persistFilingExtraction,
  docObjectives,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';

const IPO_ID = 'b3b0f3c6-0f2e-4b9a-9f0c-1d2e3f4a5b6d';
type Field = FilingExtraction['fields'][string];

const CAPEX =
  'Funding capital expenditure requirement of our Company towards procurement of machinery and equipment for expansion at Kavathe Unit, Shirwal Unit and Pithampur Unit-I';
const DEBT = 'Prepayment or repayment, in full or in part, of certain outstanding borrowings availed by our Company';

const ROWS = [
  { serial: 1, label: CAPEX, printed_amount: 299.66, printed_unit: 'million', amount_cr: 29.966, check: 'priced' },
  { serial: 2, label: DEBT, printed_amount: 160, printed_unit: 'million', amount_cr: 16, check: 'priced' },
  { serial: 3, label: 'General corporate purposes', printed_amount: 59.64, printed_unit: 'million', amount_cr: 5.964, check: 'priced' },
];
const STORED_FROM_ROWS = ROWS.map((r) => ({ sno: r.serial, description: r.label, amount: r.amount_cr }));

function valueField(v: unknown): Field {
  return { value: v, page: 103, check: { name: 'objects_f4_vs_net_proceeds', passed: true }, state: 'VALUE' } as unknown as Field;
}
function stateField(state: string, detail: string): Field {
  return { value: null, page: null, check: { name: 'objects_f4_vs_net_proceeds', passed: false, detail }, state } as unknown as Field;
}

function extraction(docType: string, objects: Field): FilingExtraction {
  return {
    doc_type: docType,
    source_doc: 'hy-tech.pdf',
    pages: 416,
    extraction_status: 'OK',
    unit: 'million',
    fiscal_years: [],
    fields: { objects_of_offer: objects },
  } as FilingExtraction;
}

function makeDeps(stored: { objectives?: unknown } = {}) {
  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'Hy-Tech Engineers Limited',
        slug: 'hy-tech-engineers-ltd',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
        status: 'UPCOMING',
        listingExchanges: ['NSE'],
        ...stored,
      })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
    promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
    intermediaries: { replaceForIpo: vi.fn(async () => []) },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { replaceForIpo: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate: vi.fn(async () => ({})) },
    ipoDetailsWriter: { upsert: vi.fn(async () => undefined) },
  } as unknown as FilingPersisterDeps;
  return deps;
}

const scrapedOf = () => (upsertIPOMock.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
const objectivesReceipt = (summary: Awaited<ReturnType<typeof persistFilingExtraction>>) =>
  summary.receipt_fields?.find((r) => r.tableName === 'ipos' && r.fieldName === 'objectives');

describe('filing-persister — item 40 objectives', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('an EMPTY column: a PROSPECTUS writes ipos.objectives in crore with a receipt (row 27)', async () => {
    const summary = await persistFilingExtraction(
      IPO_ID, extraction('PROSPECTUS', valueField(ROWS)), { docType: 'PROSPECTUS', apply: true }, makeDeps());
    expect(upsertIPOMock).toHaveBeenCalledTimes(1);
    expect(scrapedOf().objectives).toEqual(STORED_FROM_ROWS);
    expect(summary.ipos_fields).toContain('objectives');
    expect(objectivesReceipt(summary)?.value).toContain('General corporate purposes');
  });

  it('an unpriced [bullet] row keeps amount: null (not priced yet), never a guessed number', () => {
    const rows = [
      { serial: 1, label: 'Working capital', amount_cr: 215 },
      { serial: 2, label: 'General corporate purposes', amount_cr: null },
    ];
    expect(docObjectives(extraction('RHP', valueField(rows)))).toEqual([
      { sno: 1, description: 'Working capital', amount: 215 },
      { sno: 2, description: 'General corporate purposes', amount: null },
    ]);
  });

  it('a malformed row drops the whole list (a half-read table is never written)', () => {
    for (const bad of [
      [{ serial: 1, label: 'Capex', amount_cr: 1 }, { label: 'No serial', amount_cr: 2 }],
      [{ serial: 1, label: '', amount_cr: 1 }],
      [{ serial: 1, label: 'Capex', amount_cr: '12' }],
      [],
    ]) {
      expect(docObjectives(extraction('RHP', valueField(bad)))).toBeNull();
    }
  });

  it('a PRICE_BAND_AD carrying the field writes nothing and leaves no receipt (OD-96)', async () => {
    const summary = await persistFilingExtraction(
      IPO_ID, extraction('PRICE_BAND_AD', valueField(ROWS)), { docType: 'PRICE_BAND_AD', apply: true }, makeDeps());
    expect(scrapedOf()).not.toHaveProperty('objectives');
    expect(objectivesReceipt(summary)).toBeUndefined();
  });

  it('a stored IDENTICAL list is credited by the receipt and not re-written (OD-73)', async () => {
    const summary = await persistFilingExtraction(
      IPO_ID, extraction('PROSPECTUS', valueField(ROWS)), { docType: 'PROSPECTUS', apply: true },
      makeDeps({ objectives: STORED_FROM_ROWS }));
    expect(scrapedOf()).not.toHaveProperty('objectives');
    expect(objectivesReceipt(summary)).toBeDefined();
    expect(summary.skipped_lower_priority_source?.some((s) => s.includes('ipos.objectives') && s.includes('OD-73'))).toBe(true);
  });

  it('a stored DIFFERENT list (a website\'s, or the admin\'s) is untouched; the receipt is filed (OD-161 decides later)', async () => {
    const stored = [{ sno: 1, description: 'Chittorgarh wording', amount: 51.93 }];
    const summary = await persistFilingExtraction(
      IPO_ID, extraction('PROSPECTUS', valueField(ROWS)), { docType: 'PROSPECTUS', apply: true },
      makeDeps({ objectives: stored }));
    expect(scrapedOf()).not.toHaveProperty('objectives');
    expect(objectivesReceipt(summary)?.value).toContain('General corporate purposes');
    expect(summary.skipped_lower_priority_source?.some((s) => s.includes('ipos.objectives') && s.includes('OD-161'))).toBe(true);
  });

  it.each([
    ['REFUSED (F4 failed)', stateField('REFUSED', 'check_failed: objects sum 54.93 Cr != net proceeds 51.93 Cr')],
    ['MISSED (table not found / unreadable)', stateField('MISSED', 'objects_table_not_found')],
    ['STATED_NOT_PRINTED (pure offer for sale)', stateField('STATED_NOT_PRINTED', 'no_fresh_issue_pure_offer_for_sale')],
  ])('%s writes nothing and files no receipt, so a stored list stays', async (_n, field) => {
    const summary = await persistFilingExtraction(
      IPO_ID, extraction('RHP', field), { docType: 'RHP', apply: true },
      makeDeps({ objectives: STORED_FROM_ROWS }));
    expect(scrapedOf()).not.toHaveProperty('objectives');
    expect(objectivesReceipt(summary)).toBeUndefined();
  });
});
