/**
 * W-143 — `ipo_details.issue_type` is never set to FIXED_PRICE.
 *
 * FACT (prod, 2026-09-05): only 3 of 358 IPOs have an `ipo_details` row at
 * all, and every one of those is BOOK_BUILDING or null — 0 are FIXED_PRICE,
 * even though the enum has the value and BSE SME issues real fixed-price
 * offers every week (e.g. Fly-Hi Maritime Travels Ltd, BSE SME, Fixed Price
 * Issue at Rs.102/share, opened 2026-09-01 — chittorgarh.com / aninews.in).
 *
 * Root cause (`filing-persister.ts:687-688`):
 *
 *     const regulation = str(extraction, 'book_building_regulation');
 *     if (regulation) mark('issueType', 'BOOK_BUILDING');
 *
 * `issueType` has exactly ONE writer in the whole persister, and it can only
 * ever produce the literal string `'BOOK_BUILDING'` — gated on a PRICE_BAND_AD
 * extraction citing a book-building SEBI ICDR regulation. There is no sibling
 * branch that writes `'FIXED_PRICE'`, even though:
 *
 *   - `bse-ipo-board.ts:99` already derives `isFixedPrice` from BSE's
 *     `IR_FLAG_FULL` ("Fixed Price" vs book-building).
 *   - `document-cycle.ts:196-201` (`deriveIssueShape`) already derives
 *     `isFixedPrice` from `price_range_min === price_range_max` in `ipos`.
 *   - `data-validation.ts:56` documents the exact domain rule ("a FIXED_PRICE
 *     issue may legitimately have min === max") that would let the persister
 *     infer it from the SAME `price_band_floor`/`price_band_cap` extraction
 *     fields it already reads at `filing-persister.ts:544-545`.
 *
 * Both signals are computed elsewhere in the pipeline and neither is ever
 * threaded into `ipo_details.issue_type`. This test fails against the current
 * persister: a PRICE_BAND_AD extraction with `price_band_floor === price_band_cap`
 * and no `book_building_regulation` field writes no `issueType` at all.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/services/data-persister.js', () => ({
  upsertIPO: vi.fn(async () => 'ipo-id'),
}));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  persistFilingExtraction,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';

const IPO_ID = 'fixed-price-ipo-id';

function fixedPriceExtraction(): FilingExtraction {
  return {
    doc_type: 'PRICE_BAND_AD',
    source_doc: 'fly-hi-maritime-fixed-price-ad.pdf',
    pages: 1,
    extraction_status: 'OK',
    unit: 'rupees',
    fiscal_years: [],
    fields: {
      // A genuine fixed-price issue: one price, not a band. No
      // `book_building_regulation` field — a fixed-price ad cites SEBI ICDR
      // Regulation 8/230, never Reg 6(1)/6(2).
      price_band_floor: { value: 102, page: 1, check: { name: 'floor_check', passed: true } },
      price_band_cap: { value: 102, page: 1, check: { name: 'cap_check', passed: true } },
    },
  };
}

function makeDeps(): FilingPersisterDeps {
  return {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'Fly-Hi Maritime Travels Limited',
        slug: 'fly-hi-maritime-travels-ltd',
        segment: 'SME',
        offeringType: 'IPO',
        status: 'OPEN',
        listingExchanges: ['BSE'],
      })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
    promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
    intermediaries: { replaceForIpo: vi.fn(async () => []) },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { deleteByIPOId: vi.fn(async () => 0), batchCreate: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate: vi.fn(async () => ({})) },
    ipoDetailsWriter: { upsert: vi.fn(async () => undefined) },
  } as unknown as FilingPersisterDeps;
}

describe('W-143: ipo_details.issue_type must be derivable as FIXED_PRICE', () => {
  it('writes issueType FIXED_PRICE when the price band floor equals the cap and no book-building regulation is cited', async () => {
    const deps = makeDeps();

    await persistFilingExtraction(
      IPO_ID,
      fixedPriceExtraction(),
      { docType: 'PRICE_BAND_AD', apply: true },
      deps
    );

    const detailsUpsert = deps.ipoDetailsWriter.upsert as unknown as ReturnType<typeof vi.fn>;
    expect(detailsUpsert).toHaveBeenCalled();
    const [, values] = detailsUpsert.mock.calls[0] as [string, Record<string, unknown>];
    expect(values.issueType).toBe('FIXED_PRICE');
  });

  it('stays BOOK_BUILDING for a real band (floor < cap), never falls back to FIXED_PRICE', async () => {
    const deps = makeDeps();
    const bandExtraction: FilingExtraction = {
      doc_type: 'PRICE_BAND_AD',
      source_doc: 'book-built-band.pdf',
      pages: 1,
      extraction_status: 'OK',
      unit: 'rupees',
      fiscal_years: [],
      fields: {
        price_band_floor: { value: 168, page: 1, check: { name: 'floor_check', passed: true } },
        price_band_cap: { value: 177, page: 1, check: { name: 'cap_check', passed: true } },
        book_building_regulation: { value: '6(1)', page: 1, check: { name: 'reg_check', passed: true } },
      },
    };

    await persistFilingExtraction(
      IPO_ID,
      bandExtraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      deps
    );

    const detailsUpsert = deps.ipoDetailsWriter.upsert as unknown as ReturnType<typeof vi.fn>;
    const [, values] = detailsUpsert.mock.calls[0] as [string, Record<string, unknown>];
    expect(values.issueType).toBe('BOOK_BUILDING');
  });

  it('does not write FIXED_PRICE (or BOOK_BUILDING) when floor === cap === 0 — a passed extraction with no real price', async () => {
    const deps = makeDeps();
    const zeroExtraction: FilingExtraction = {
      doc_type: 'PRICE_BAND_AD',
      source_doc: 'zero-band.pdf',
      pages: 1,
      extraction_status: 'OK',
      unit: 'rupees',
      fiscal_years: [],
      fields: {
        price_band_floor: { value: 0, page: 1, check: { name: 'floor_check', passed: true } },
        price_band_cap: { value: 0, page: 1, check: { name: 'cap_check', passed: true } },
        compliance_officer: { value: 'Test Officer', page: 1, check: { name: 'co_check', passed: true } },
      },
    };

    await persistFilingExtraction(
      IPO_ID,
      zeroExtraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      deps
    );

    const detailsUpsert = deps.ipoDetailsWriter.upsert as unknown as ReturnType<typeof vi.fn>;
    const [, values] = detailsUpsert.mock.calls[0] as [string, Record<string, unknown>];
    expect(values.issueType).toBeUndefined();
  });

  it('does not write FIXED_PRICE when the band is a real range with no regulation cited either (unresolved, not guessed)', async () => {
    const deps = makeDeps();
    const unresolvedExtraction: FilingExtraction = {
      doc_type: 'PRICE_BAND_AD',
      source_doc: 'unresolved-band.pdf',
      pages: 1,
      extraction_status: 'OK',
      unit: 'rupees',
      fiscal_years: [],
      fields: {
        price_band_floor: { value: 100, page: 1, check: { name: 'floor_check', passed: true } },
        price_band_cap: { value: 110, page: 1, check: { name: 'cap_check', passed: true } },
        // A harmless unrelated field so ipo_details still gets a write to
        // inspect (an all-empty `details` payload short-circuits before the
        // writer is even called, which would make this assertion vacuous).
        compliance_officer: { value: 'Test Officer', page: 1, check: { name: 'co_check', passed: true } },
      },
    };

    await persistFilingExtraction(
      IPO_ID,
      unresolvedExtraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      deps
    );

    const detailsUpsert = deps.ipoDetailsWriter.upsert as unknown as ReturnType<typeof vi.fn>;
    const [, values] = detailsUpsert.mock.calls[0] as [string, Record<string, unknown>];
    expect(values.issueType).toBeUndefined();
  });
});
