/**
 * Appendix A rows 61-66 and 73-74: the issuer's registered office, its contact, and the retail /
 * employee maximum bid amounts reach `ipo_details` through the persister's one-to-one map, with a
 * receipt per column (OD-91).
 *
 * The values are the real NSE DRHP's, as the readers return them (scraper/scripts/test_issuer_address.py
 * and test_bid_limits.py read the same fixtures):
 *   company_address "Exchange Plaza, C-1, Block G, Bandra Kurla Complex, Bandra (East) Mumbai 400 051, Maharashtra, India"
 *   company_city "Mumbai", company_state "Maharashtra", company_pincode "400051"
 *   company_phone "+91 22 2659 8100", company_email "nse_ipo@nse.co.in" (the cover's issuer contact block,
 *     the same reading as compliance_officer_phone / _email; supervisor decision 2026-10-03, rows 62-63)
 *   max_retail_subscription 200000, max_employee_subscription 500000 (rupees, OD-48)
 *
 * Proved: (1) a DRHP writes every column and files a receipt for each; (2) a MISSED answer writes
 * nothing and files no receipt; (3) a REFUSED answer (value null) writes nothing.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/services/data-persister.js', () => ({
  upsertIPO: vi.fn(async () => 'ipo-id'),
  recordDocumentSourceHints: vi.fn(async () => undefined),
}));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  persistFilingExtraction,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';

const IPO_ID = 'c1b0f3c6-0f2e-4b9a-9f0c-1d2e3f4a5b6e';
type Field = FilingExtraction['fields'][string];

function value(v: unknown, page = 2): Field {
  return { value: v, page, check: { name: 'x', passed: true }, state: 'VALUE' } as unknown as Field;
}
function missed(reason: string): Field {
  return { value: null, page: null, check: { name: 'not_extractable', passed: true, detail: reason }, state: 'MISSED' } as unknown as Field;
}
function refused(reason: string): Field {
  return { value: null, page: null, check: { name: 'x', passed: false, detail: reason }, state: 'REFUSED', refused_value: 'x' } as unknown as Field;
}
function extraction(fields: Record<string, Field>): FilingExtraction {
  return { doc_type: 'DRHP', source_doc: 'nse-drhp.pdf', pages: 614, extraction_status: 'OK', unit: 'millions', fiscal_years: [], ocr_pages: [], fields } as unknown as FilingExtraction;
}

function makeDeps() {
  const ipoDetailsWriter = { upsert: vi.fn(async () => undefined) };
  const ipoRepository = {
    findById: vi.fn(async () => ({
      id: IPO_ID, companyName: 'National Stock Exchange of India Limited', slug: 'national-stock-exchange-of-india-ltd',
      segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING', listingExchanges: ['BSE'],
    })),
    updateDocumentSourceHints: vi.fn(async () => ({ id: IPO_ID })),
  };
  return {
    ipoDetailsWriter,
    deps: {
      ipoRepository,
      financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
      ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
      promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
      intermediaries: { replaceForIpo: vi.fn(async () => []) },
      brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
      peerCompanies: { replaceForIpo: vi.fn(async () => []) },
      financialData: { upsert: vi.fn(async (r: unknown) => r) },
      fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate: vi.fn(async () => ({})) },
      ipoDetailsWriter,
    } as unknown as FilingPersisterDeps,
  };
}

const NSE_DRHP: Record<string, Field> = {
  company_address: value('Exchange Plaza, C-1, Block G, Bandra Kurla Complex, Bandra (East) Mumbai 400 051, Maharashtra, India'),
  company_city: value('Mumbai'),
  company_state: value('Maharashtra'),
  company_pincode: value('400051'),
  company_phone: value('+91 22 2659 8100'),
  company_email: value('nse_ipo@nse.co.in', 0),
  max_retail_subscription: value(200000, 13),
  max_employee_subscription: value(500000, 9),
};

const WANT: Record<string, string> = {
  companyAddress: 'Exchange Plaza, C-1, Block G, Bandra Kurla Complex, Bandra (East) Mumbai 400 051, Maharashtra, India',
  companyCity: 'Mumbai',
  companyState: 'Maharashtra',
  companyPincode: '400051',
  companyPhone: '+91 22 2659 8100',
  companyEmail: 'nse_ipo@nse.co.in',
  maxRetailSubscription: '200000',
  maxEmployeeSubscription: '500000',
};

function written(w: { upsert: ReturnType<typeof vi.fn> }): Record<string, unknown> {
  return Object.assign({}, ...w.upsert.mock.calls.map((c) => (c as unknown[]).find((a) => a && typeof a === 'object' && !Array.isArray(a)) ?? {}));
}

describe('filing-persister - rows 61-66 and 73-74 reach ipo_details', () => {
  it('a DRHP writes every column, each with a receipt', async () => {
    const h = makeDeps();
    const summary = await persistFilingExtraction(IPO_ID, extraction(NSE_DRHP), { docType: 'DRHP', apply: true }, h.deps);
    const w = written(h.ipoDetailsWriter);
    for (const [col, v] of Object.entries(WANT)) expect(w[col], col).toBe(v);
    const receipts = (summary as unknown as { receipt_fields: Array<{ tableName: string; fieldName: string; value: unknown; sourceText: string | null }> }).receipt_fields;
    for (const col of Object.keys(WANT)) {
      const r = receipts.find((x) => x.tableName === 'ipo_details' && x.fieldName === col);
      expect(r, col).toBeDefined();
      expect(r?.sourceText, col).toBe('TEXT');
    }
  });

  it('a MISSED answer writes nothing and files no receipt', async () => {
    const h = makeDeps();
    const fields = Object.fromEntries(Object.keys(NSE_DRHP).map((k) => [k, missed(`${k}_not_found`)]));
    const summary = await persistFilingExtraction(IPO_ID, extraction(fields), { docType: 'DRHP', apply: true }, h.deps);
    const w = written(h.ipoDetailsWriter);
    for (const col of Object.keys(WANT)) expect(w[col], col).toBeUndefined();
    const receipts = (summary as unknown as { receipt_fields: Array<{ fieldName: string }> }).receipt_fields;
    for (const col of Object.keys(WANT)) expect(receipts.some((x) => x.fieldName === col), col).toBe(false);
  });

  it('a REFUSED answer writes nothing', async () => {
    const h = makeDeps();
    const fields = { ...NSE_DRHP, company_address: refused('no PIN'), max_retail_subscription: refused('outside range') };
    await persistFilingExtraction(IPO_ID, extraction(fields), { docType: 'DRHP', apply: true }, h.deps);
    const w = written(h.ipoDetailsWriter);
    expect(w.companyAddress).toBeUndefined();
    expect(w.maxRetailSubscription).toBeUndefined();
    expect(w.companyCity).toBe('Mumbai');
  });
});
