/**
 * W-171 — a DRHP never emits a price band, defence-in-depth at the write path.
 *
 * `extract_offering_headline` (Python side) now nulls every headline field
 * for a DRHP unconditionally, before any cover regex runs. This test proves
 * the SEPARATE, independent guard in filing-persister.ts: even if a DRHP
 * extraction JSON somehow still carries `price_band_floor` / `price_band_cap`
 * / `issue_price_type` (a stale cache, a hand-edited fixture, a future bug in
 * the extractor), the persister discards them and logs a WARN naming the
 * document — it never trusts the doc type at only one layer.
 *
 * The numbers reproduce the prod incident shape (2026-09-05): a DRHP cover
 * misread as price band 72/82 against the RHP's true 601-632.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertIPOMock } = vi.hoisted(() => ({ upsertIPOMock: vi.fn(async () => 'ipo-id') }));
const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../../../src/services/data-persister.js', () => ({ upsertIPO: upsertIPOMock }));
vi.mock('../../../src/utils/logger.js', () => ({ default: loggerMocks }));

import {
  persistFilingExtraction,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';

const IPO_ID = 'a2a0f3c6-0f2e-4b9a-9f0c-1d2e3f4a5b6d';

/** A DRHP extraction that (incorrectly, for test purposes) still carries a
 * price band and price-process type in its JSON — the shape the persister
 * must discard regardless. */
function drhpExtractionWithStaleBand(overrides: Record<string, unknown> = {}): FilingExtraction {
  const values: Record<string, unknown> = {
    headline_source: 'PROSPECTUS_COVER',
    issue_price_type: 'BOOK_BUILDING',
    price_band_floor: 72,
    price_band_cap: 82,
    face_value: 10,
    lot_size: 23,
    ...overrides,
  };
  const fields: FilingExtraction['fields'] = {};
  for (const [k, v] of Object.entries(values)) {
    fields[k] = { value: v, page: 0, check: { name: `${k}_check`, passed: true } };
  }
  return {
    doc_type: 'DRHP',
    source_doc: 'drhp_kanohar_shape.pdf',
    pages: 3,
    extraction_status: 'OK',
    unit: 'lakhs',
    fiscal_years: [2026, 2025, 2024],
    fields,
  };
}

function makeDeps(): { deps: FilingPersisterDeps; detailsUpsert: ReturnType<typeof vi.fn> } {
  const detailsUpsert = vi.fn(async () => undefined);
  const findByField = vi.fn(async () => null);

  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'Kanohar-Shape Limited',
        slug: 'kanohar-shape-ltd',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
        status: 'UPCOMING',
        listingExchanges: ['NSE'],
      })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
    promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
    intermediaries: { replaceForIpo: vi.fn(async () => []) },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { replaceForIpo: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    fieldSources: { findByField, trackFieldUpdate: vi.fn(async () => ({})) },
    ipoDetailsWriter: { upsert: detailsUpsert },
  } as unknown as FilingPersisterDeps;

  return { deps, detailsUpsert };
}

describe('filing-persister — W-171 DRHP never emits a price band (defence in depth)', () => {
  beforeEach(() => {
    upsertIPOMock.mockClear();
    loggerMocks.warn.mockClear();
  });

  it('discards price_band_floor/price_band_cap even when the DRHP JSON carries them', async () => {
    const { deps } = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      drhpExtractionWithStaleBand(),
      { docType: 'DRHP', apply: true },
      deps
    );

    expect(upsertIPOMock).toHaveBeenCalledTimes(1);
    const scraped = upsertIPOMock.mock.calls[0][1] as Record<string, unknown>;
    expect(scraped.priceRangeMin).toBeUndefined();
    expect(scraped.priceRangeMax).toBeUndefined();
  });

  it('discards issue_price_type -> ipo_details.issueType for a DRHP too', async () => {
    const { deps, detailsUpsert } = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      drhpExtractionWithStaleBand(),
      { docType: 'DRHP', apply: true },
      deps
    );

    const details = detailsUpsert.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(details?.issueType).toBeUndefined();
  });

  it('logs a WARN naming the source document when a DRHP JSON carries a stale band', async () => {
    const { deps } = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      drhpExtractionWithStaleBand(),
      { docType: 'DRHP', apply: true },
      deps
    );

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        ipoId: IPO_ID,
        docType: 'DRHP',
        sourceDoc: 'drhp_kanohar_shape.pdf',
        rawFloor: 72,
        rawCap: 82,
      }),
      expect.stringContaining('DRHP')
    );
  });

  it('does NOT warn when a DRHP extraction has no band at all (the normal, fixed case)', async () => {
    const { deps } = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      drhpExtractionWithStaleBand({ price_band_floor: null, price_band_cap: null }),
      { docType: 'DRHP', apply: true },
      deps
    );

    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it('still writes a real price band for a non-DRHP doc type (no regression)', async () => {
    const { deps } = makeDeps();
    const rhpExtraction = drhpExtractionWithStaleBand();
    rhpExtraction.doc_type = 'RHP';
    await persistFilingExtraction(IPO_ID, rhpExtraction, { docType: 'RHP', apply: true }, deps);

    const scraped = upsertIPOMock.mock.calls[0][1] as Record<string, unknown>;
    expect(scraped.priceRangeMin).toBe(72);
    expect(scraped.priceRangeMax).toBe(82);
  });
});
