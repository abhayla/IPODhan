/**
 * Item 1 slice s7b — the `ipo_details` and `ipo_valuation` CALL SITES, and the
 * source rank that routing them through the consolidator finally gives
 * `ipo_details.issueType`.
 *
 * The valuable half of this file is the flag-OFF half: with
 * `ENABLE_CHILD_TABLE_CONSOLIDATION` off, `persistFilingExtraction` must write
 * exactly the rows it wrote before this slice and must never touch the
 * consolidator. The flag-ON half proves the RESOLVED value is what reaches the
 * repository, that `ipo_valuation` is keyed by its pricing event (it is NOT a
 * one-row-per-IPO table, whatever it looks like), and that a filing still
 * outranks the Chittorgarh report-82 list for `issueType`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { persistFilingExtraction } from '../../../src/services/filing-persister.js';
import type { FilingPersisterDeps } from '../../../src/services/filing-persister.js';
import { FEATURE_FLAGS } from '../../../src/config/feature-flags.js';
import { getSourcePriority, getFieldRules } from '../../../src/config/field-priority-matrix.js';
import { ipoDetailsRowKey, ipoValuationRowKey } from '../../../src/services/child-row-keys.js';

const IPO_ID = '11111111-2222-3333-4444-555555555555';

const f = (value: unknown) => ({ value, check: { passed: true } });

/**
 * A PRICE_BAND_AD cover: it carries a price band (so `ipo_valuation` is
 * written) and cover wording that decides `ipo_details.issueType` (so
 * `ipo_details` is written with a real column, not just the identity row).
 */
const EXTRACTION = {
  unit: 'MILLION',
  fields: {
    price_band_floor: f(100),
    price_band_cap: f(105),
    issue_price_type: f('BOOK_BUILDING'),
    face_value: f(10),
  },
} as never;

function makeDeps(overrides: Partial<FilingPersisterDeps> = {}) {
  const detailsUpsert = vi.fn(async () => undefined);
  const valuationUpsert = vi.fn(async () => undefined);
  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'S7B Fixture Ltd',
        status: 'OPEN',
      })),
      // This fixture carries a price band, so `ipos` is written too — the s5b
      // financials fixture never reached this call.
      update: vi.fn(async () => ({ id: IPO_ID })),
    },
    financialStatements: { upsert: vi.fn(async () => undefined), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: valuationUpsert },
    promoters: {
      replacePromoters: vi.fn(async () => undefined),
      replaceAcquisitionRanges: vi.fn(async () => undefined),
    },
    intermediaries: { replaceForIpo: vi.fn(async () => undefined) },
    brlmTrackRecord: { upsert: vi.fn(async () => undefined) },
    peerCompanies: { replaceForIpo: vi.fn(async () => undefined) },
    financialData: { upsert: vi.fn(async () => undefined) },
    fieldSources: {
      findByField: vi.fn(async () => null),
      trackFieldUpdate: vi.fn(async () => undefined),
    },
    ipoDetailsWriter: { upsert: detailsUpsert, insertIfMissing: vi.fn(async () => false) },
    ...overrides,
  } as unknown as FilingPersisterDeps;
  return { deps, detailsUpsert, valuationUpsert };
}

/** One resolved row, shaped like `ConsolidatedChildRowsResult`. */
const resolvedRow = (rowKey: string, consolidatedData: Record<string, unknown>) => ({
  rowsProcessed: 1,
  rowsUpdated: 1,
  rowsSkipped: 0,
  conflictsDetected: 0,
  rows: [
    {
      rowKey,
      consolidatedData,
      fieldsProcessed: Object.keys(consolidatedData).length,
      fieldsUpdated: Object.keys(consolidatedData).length,
      conflictsDetected: 0,
      skipped: false,
    },
  ],
});

const skippedRow = (rowKey: string, skipReason: string) => ({
  rowsProcessed: 0,
  rowsUpdated: 0,
  rowsSkipped: 1,
  conflictsDetected: 0,
  rows: [
    {
      rowKey,
      consolidatedData: {},
      fieldsProcessed: 0,
      fieldsUpdated: 0,
      conflictsDetected: 0,
      skipped: true,
      skipReason,
    },
  ],
});

function withFlag(value: boolean) {
  const original = FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION;
  beforeEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = value;
  });
  afterEach(() => {
    (FEATURE_FLAGS as any).ENABLE_CHILD_TABLE_CONSOLIDATION = original;
  });
}

describe('s7b row keys', () => {
  it('ipo_details is keyed with the singleton sentinel (its ipo_id is unique on its own)', () => {
    expect(ipoDetailsRowKey()).toBe('');
  });

  it('ipo_valuation is keyed by its pricing event, NOT as a singleton', () => {
    // The trap this test exists for: `ipo_valuation` reads like one row per IPO
    // but its unique constraint is (ipo_id, pricing_event). Keying it '' would
    // file the price-band ad's and the prospectus's numbers under one identity.
    expect(ipoValuationRowKey('PRICE_BAND_AD')).toBe('PRICE_BAND_AD');
    expect(ipoValuationRowKey('PROSPECTUS')).toBe('PROSPECTUS');
    expect(ipoValuationRowKey('PRICE_BAND_AD')).not.toBe(ipoValuationRowKey('PROSPECTUS'));
  });

  it('refuses to key a valuation row with nothing (null, never the sentinel)', () => {
    expect(ipoValuationRowKey(null)).toBeNull();
    expect(ipoValuationRowKey(undefined)).toBeNull();
    expect(ipoValuationRowKey('   ')).toBeNull();
  });
});

describe('ipo_details.issueType source rank (the #569 tripwire)', () => {
  it('ranks a filing (DRHP) strictly above the Chittorgarh list', () => {
    const drhp = getSourcePriority('issueType', 'DRHP');
    const chit = getSourcePriority('issueType', 'CHITTORGARH');
    expect(drhp).toBeGreaterThanOrEqual(0);
    expect(chit).toBeGreaterThanOrEqual(0);
    // Lower index = higher priority.
    expect(drhp).toBeLessThan(chit);
  });

  it('ranks ADMIN above every scraper source for issueType', () => {
    expect(getSourcePriority('issueType', 'ADMIN')).toBe(0);
    for (const s of ['DRHP', 'NSE', 'BSE', 'CHITTORGARH'] as const) {
      expect(getSourcePriority('issueType', 'ADMIN')).toBeLessThan(
        getSourcePriority('issueType', s)
      );
    }
  });

  it('CHITTORGARH is the LAST ranked source, so it can outrank nothing', () => {
    const rules = getFieldRules('issueType');
    expect(rules.sources[rules.sources.length - 1]).toBe('CHITTORGARH');
  });

  it('leaves the 22 DRHP-sourced rows alone: CHITTORGARH cannot outrank DRHP', () => {
    // #569 measured 22 existing `issueType` provenance rows that are NOT
    // CHITTORGARH-sourced (all 22 DRHP). If this inequality ever flips, the
    // report-82 job's values start winning against filings and that 22 moves.
    expect(getSourcePriority('issueType', 'CHITTORGARH')).toBeGreaterThan(
      getSourcePriority('issueType', 'DRHP')
    );
  });
});

describe('ipo_details + ipo_valuation call sites — flag OFF', () => {
  withFlag(false);

  it('writes the pre-slice rows and never calls the consolidator', async () => {
    const consolidate = vi.fn();
    const { deps, detailsUpsert, valuationUpsert } = makeDeps({
      childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never,
    });

    await persistFilingExtraction(
      IPO_ID,
      EXTRACTION,
      { docType: 'PRICE_BAND_AD', apply: true },
      deps
    );

    expect(consolidate).not.toHaveBeenCalled();
    expect(detailsUpsert).toHaveBeenCalledTimes(1);
    expect(detailsUpsert.mock.calls[0][1]).toMatchObject({
      issueType: 'BOOK_BUILDING',
      dataSource: 'DRHP',
    });
    expect(valuationUpsert).toHaveBeenCalledTimes(1);
    expect(valuationUpsert.mock.calls[0][0]).toMatchObject({
      ipoId: IPO_ID,
      pricingEvent: 'PRICE_BAND_AD',
      priceFloor: '100',
      priceCap: '105',
    });
  });
});

describe('ipo_details call site — flag ON', () => {
  withFlag(true);

  it('routes ipo_details through the consolidator under the singleton key', async () => {
    const consolidate = vi.fn(async (_i: string, table: string) =>
      table === 'ipo_details'
        ? resolvedRow('', { issueType: 'BOOK_BUILDING', faceValue: 10 })
        : resolvedRow('PRICE_BAND_AD', { priceFloor: 100, priceCap: 105 })
    );
    const { deps } = makeDeps({
      childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never,
    });

    await persistFilingExtraction(
      IPO_ID,
      EXTRACTION,
      { docType: 'PRICE_BAND_AD', apply: true },
      deps
    );

    const call = consolidate.mock.calls.find((c: any[]) => c[1] === 'ipo_details') as any[];
    expect(call).toBeDefined();
    expect(call[2][0].rowKey).toBe('');
    expect(call[3]).toBe('DRHP');
    expect(call[4]).toBe('PRICE_BAND_AD');
  });

  it('writes the RESOLVED value, not the value this extraction carried', async () => {
    // The consolidator keeps the stored FIXED_PRICE (say a higher-ranked source
    // wrote it); the extraction said BOOK_BUILDING. The repository must see the
    // resolved value.
    const consolidate = vi.fn(async (_i: string, table: string) =>
      table === 'ipo_details'
        ? resolvedRow('', { issueType: 'FIXED_PRICE', faceValue: '10' })
        : resolvedRow('PRICE_BAND_AD', { priceFloor: 100 })
    );
    const { deps, detailsUpsert } = makeDeps({
      childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never,
    });

    await persistFilingExtraction(
      IPO_ID,
      EXTRACTION,
      { docType: 'PRICE_BAND_AD', apply: true },
      deps
    );

    expect(detailsUpsert).toHaveBeenCalledTimes(1);
    expect((detailsUpsert.mock.calls[0] as any[])[1].issueType).toBe('FIXED_PRICE');
  });

  it('withholds the ipo_details write entirely when the consolidator skips the row', async () => {
    const consolidate = vi.fn(async (_i: string, table: string) =>
      table === 'ipo_details'
        ? skippedRow('', 'MISSING_ROW_KEY')
        : resolvedRow('PRICE_BAND_AD', { priceFloor: 100 })
    );
    const { deps, detailsUpsert } = makeDeps({
      childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never,
    });

    const summary = await persistFilingExtraction(
      IPO_ID,
      EXTRACTION,
      { docType: 'PRICE_BAND_AD', apply: true },
      deps
    );

    expect(detailsUpsert).not.toHaveBeenCalled();
    expect(summary.skipped_failed_check.join(' ')).toContain('ipo_details');
  });

  it('falls back to the unresolved write when the consolidator is not wired', async () => {
    const { deps, detailsUpsert } = makeDeps();

    await persistFilingExtraction(
      IPO_ID,
      EXTRACTION,
      { docType: 'PRICE_BAND_AD', apply: true },
      deps
    );

    // A wiring defect must cost provenance, never the write.
    expect(detailsUpsert).toHaveBeenCalledTimes(1);
    expect((detailsUpsert.mock.calls[0] as any[])[1].issueType).toBe('BOOK_BUILDING');
  });
});

describe('ipo_valuation call site — flag ON', () => {
  withFlag(true);

  it('routes ipo_valuation through the consolidator keyed by the pricing event', async () => {
    const consolidate = vi.fn(async (_i: string, table: string) =>
      table === 'ipo_valuation'
        ? resolvedRow('PRICE_BAND_AD', { priceFloor: 100, priceCap: 105 })
        : resolvedRow('', { issueType: 'BOOK_BUILDING' })
    );
    const { deps } = makeDeps({
      childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never,
    });

    await persistFilingExtraction(
      IPO_ID,
      EXTRACTION,
      { docType: 'PRICE_BAND_AD', apply: true },
      deps
    );

    const call = consolidate.mock.calls.find((c: any[]) => c[1] === 'ipo_valuation') as any[];
    expect(call).toBeDefined();
    expect(call[2][0].rowKey).toBe('PRICE_BAND_AD');
  });

  it('writes the RESOLVED price, not the extracted one', async () => {
    const consolidate = vi.fn(async (_i: string, table: string) =>
      table === 'ipo_valuation'
        ? resolvedRow('PRICE_BAND_AD', { priceFloor: 999, priceCap: 105 })
        : resolvedRow('', { issueType: 'BOOK_BUILDING' })
    );
    const { deps, valuationUpsert } = makeDeps({
      childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never,
    });

    await persistFilingExtraction(
      IPO_ID,
      EXTRACTION,
      { docType: 'PRICE_BAND_AD', apply: true },
      deps
    );

    expect(valuationUpsert).toHaveBeenCalledTimes(1);
    expect((valuationUpsert.mock.calls[0] as any[])[0].priceFloor).toBe('999');
  });

  it('never writes an identity-only valuation row when the consolidator skips', async () => {
    const consolidate = vi.fn(async (_i: string, table: string) =>
      table === 'ipo_valuation'
        ? skippedRow('PRICE_BAND_AD', 'CHILD_TABLE_CONSOLIDATION_DISABLED')
        : resolvedRow('', { issueType: 'BOOK_BUILDING' })
    );
    const { deps, valuationUpsert } = makeDeps({
      childRowConsolidator: { consolidatedUpsertChildRows: consolidate } as never,
    });

    const summary = await persistFilingExtraction(
      IPO_ID,
      EXTRACTION,
      { docType: 'PRICE_BAND_AD', apply: true },
      deps
    );

    expect(valuationUpsert).not.toHaveBeenCalled();
    expect(summary.skipped_failed_check.join(' ')).toContain('ipo_valuation');
  });
});
