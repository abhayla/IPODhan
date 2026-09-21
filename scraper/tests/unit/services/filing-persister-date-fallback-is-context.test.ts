/**
 * #878 / OD-66 — a stored date re-sent by a filing is CONTEXT, not a claim.
 *
 * `filing-persister` adds an `openDate`/`closeDate` fallback read off the
 * STORED row when a filing carries no date of its own, so that a dateless
 * filing cannot null a date already on file. That fallback writes into
 * `scraped` but deliberately NOT into `iposFields`, and `contextFields` is
 * derived as `keys(scraped) - iposFields` AFTER it — so the fallback lands in
 * context and never becomes a claim by source DRHP.
 *
 * That is correct today and nothing asserted it. The property holds purely by
 * STATEMENT ORDER: move the fallback block above the `iposFields` freeze, or
 * start pushing fallbacks through `iposFields` for some plausible reason, and
 * the behaviour inverts silently with every existing test still green.
 *
 * Why it is worth a test rather than a comment: `openDate` and `closeDate` are
 * the two LARGEST auto-resolution populations in `data_conflicts` — 5,867 and
 * 5,130 converged rows measured on staging 2026-09-21. They are the fields
 * most exposed if a fallback ever starts counting as evidence, because
 * `autoResolveConverged` fires on an equal value and would close real
 * disagreements about a date no document ever read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertIPOMock } = vi.hoisted(() => ({ upsertIPOMock: vi.fn(async () => 'ipo-id') }));
vi.mock('../../../src/services/data-persister.js', () => ({ upsertIPO: upsertIPOMock }));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  persistFilingExtraction,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';

const IPO_ID = 'a2a0f3c6-0f2e-4b9a-9f0c-1d2e3f4a5b6c';
const STORED_OPEN = new Date('2026-06-10T00:00:00Z');
const STORED_CLOSE = new Date('2026-06-12T00:00:00Z');

/**
 * A cover extraction that supplies real headline numbers and NO DATES — the
 * ordinary SME prospectus shape, and exactly the case the fallback exists for.
 */
function datelessCover(): FilingExtraction {
  const values: Record<string, unknown> = {
    headline_source: 'PROSPECTUS_COVER',
    issue_price_type: 'FIXED_PRICE',
    price_band_floor: 41,
    price_band_cap: 41,
    face_value: 10,
    lot_size: 3000,
    fresh_issue_amount: 1460.01,
    total_offer_amount_at_cap: 1460.01,
    ofs_amount: 0,
    ofs_amount_at_cap: 0,
    ofs_shares: 0,
    shares_at_floor: 3561000,
    shares_at_cap: 3561000,
    total_offer_shares_at_cap: 3561000,
    issue_structure: 'FRESH_ONLY',
  };
  const fields: FilingExtraction['fields'] = {};
  for (const [k, v] of Object.entries(values)) {
    fields[k] = { value: v, page: 0, check: { name: `${k}_check`, passed: true } };
  }
  return {
    doc_type: 'PROSPECTUS',
    source_doc: 'prospectus_autofurnish.pdf',
    pages: 3,
    extraction_status: 'OK',
    unit: 'lakhs',
    fiscal_years: [2026, 2025, 2024],
    fields,
  };
}

function makeDeps(): FilingPersisterDeps {
  return {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'Autofurnish Limited',
        slug: 'autofurnish-ltd',
        segment: 'SME',
        offeringType: 'IPO',
        status: 'UPCOMING',
        listingExchanges: ['BSE'],
        // The dates the fallback will re-send.
        openDate: STORED_OPEN,
        closeDate: STORED_CLOSE,
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
}

describe('#878: a stored date re-sent by a dateless filing is context, not a claim', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  const run = async () => {
    const summary = await persistFilingExtraction(
      IPO_ID,
      datelessCover(),
      { docType: 'PROSPECTUS', apply: true },
      makeDeps()
    );
    expect(upsertIPOMock).toHaveBeenCalledTimes(1);
    const call = upsertIPOMock.mock.calls[0];
    return {
      summary,
      scraped: call[1] as Record<string, unknown>,
      contextFields: (call[4] ?? []) as string[],
    };
  };

  it('sends the stored dates, so a dateless filing cannot null them', async () => {
    const { scraped } = await run();
    expect(scraped.openDate).toBeDefined();
    expect(scraped.closeDate).toBeDefined();
  });

  it('declares those dates as CONTEXT, so they are never resolved as DRHP claims', async () => {
    const { contextFields } = await run();
    expect(contextFields).toContain('openDate');
    expect(contextFields).toContain('closeDate');
  });

  it('does NOT report the fallback dates as fields this filing supplied', async () => {
    // `ipos_fields` is the filing's own claim list and the input to
    // `contextFields`. A fallback appearing here is the exact inversion.
    const { summary } = await run();
    expect(summary.ipos_fields).not.toContain('openDate');
    expect(summary.ipos_fields).not.toContain('closeDate');
  });

  it('still claims the fields the filing genuinely read', async () => {
    // The regression guard: context must not swallow real claims.
    const { summary, contextFields } = await run();
    expect(summary.ipos_fields).toEqual(
      expect.arrayContaining(['issueSize', 'priceRangeMin', 'priceRangeMax'])
    );
    expect(contextFields).not.toContain('issueSize');
    expect(contextFields).not.toContain('priceRangeMin');
  });
});
