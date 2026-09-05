/**
 * W-147 — the offering headline read off a PROSPECTUS / RHP / DRHP cover.
 *
 * Two things are proved here:
 *   1. a cover headline is PERSISTED when no price band advertisement has
 *      written one (the SME case this work package exists for — most BSE SME /
 *      NSE Emerge issues never publish an ad, so their headline had no filing
 *      source at all);
 *   2. it does NOT overwrite a value an advertisement already set. Both doc
 *      types map to the single scraper_source member 'DRHP', so the
 *      field-priority matrix cannot separate them; the discriminator is the
 *      `dataLineage.docType` this module writes on every field_sources row.
 *
 * The numbers are the Autofurnish Limited prospectus (BSE SME, fixed price,
 * dated May 14, 2026) as read off its cover: 35,61,000 shares of face value
 * Rs 10 at Rs 41, aggregating Rs 1,460.01 lakh, minimum lot 3,000.
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

/** Every field passing, as `extract_offering_headline` emits them. */
function coverExtraction(overrides: Record<string, unknown> = {}): FilingExtraction {
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
    ...overrides,
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
    // The cover prints lakhs and the extractor converts into the DOCUMENT unit,
    // which for this prospectus is also lakhs.
    unit: 'lakhs',
    fiscal_years: [2026, 2025, 2024],
    fields,
  };
}

interface Harness {
  deps: FilingPersisterDeps;
  detailsUpsert: ReturnType<typeof vi.fn>;
  findByField: ReturnType<typeof vi.fn>;
}

/** `adOwned` names the (table, column) pairs a price band ad already wrote. */
function makeDeps(adOwned: ReadonlySet<string> = new Set()): Harness {
  const detailsUpsert = vi.fn(async () => undefined);
  const findByField = vi.fn(async (_ipoId: string, table: string, field: string) =>
    adOwned.has(`${table}.${field}`)
      ? {
          previousValue: '999',
          source: 'DRHP',
          dataLineage: { method: 'FILING_EXTRACTION', docType: 'PRICE_BAND_AD' },
        }
      : null
  );

  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'Autofurnish Limited',
        slug: 'autofurnish-ltd',
        segment: 'SME',
        offeringType: 'IPO',
        status: 'UPCOMING',
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
    fieldSources: { findByField, trackFieldUpdate: vi.fn(async () => ({})) },
    ipoDetailsWriter: { upsert: detailsUpsert },
  } as unknown as FilingPersisterDeps;

  return { deps, detailsUpsert, findByField };
}

describe('filing-persister — W-147 cover headline', () => {
  beforeEach(() => {
    upsertIPOMock.mockClear();
  });

  it('persists the cover headline when no price band advertisement wrote one', async () => {
    const h = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      coverExtraction(),
      { docType: 'PROSPECTUS', apply: true },
      h.deps
    );

    expect(upsertIPOMock).toHaveBeenCalledTimes(1);
    const scraped = upsertIPOMock.mock.calls[0][1] as Record<string, unknown>;
    // 1,460.01 lakh = Rs 146,001,000 — and 3,561,000 x 41 is exactly that.
    expect(scraped.issueSize).toBe(146_001_000);
    expect(scraped.priceRangeMin).toBe(41);
    expect(scraped.priceRangeMax).toBe(41);
    expect(scraped.lotSize).toBe(3000);
    expect(scraped.faceValue).toBe(10);
    expect(summary.ipos_fields).toEqual(
      expect.arrayContaining(['issueSize', 'priceRangeMin', 'priceRangeMax', 'lotSize', 'faceValue'])
    );
    expect(summary.skipped_lower_priority_source).toEqual([]);

    const details = h.detailsUpsert.mock.calls[0][1] as Record<string, unknown>;
    // The cover's own wording is the ONLY filing signal for a fixed-price issue;
    // without it data-validation.ts rejects the (legitimate) floor == cap band.
    expect(details.issueType).toBe('FIXED_PRICE');
    expect(details.freshIssue).toBe('146001000');
    expect(details.ofsIssue).toBe('0');
    expect(details.faceValue).toBe('10');
  });

  it('does NOT overwrite a headline a price band advertisement already set', async () => {
    const adOwned = new Set([
      'ipos.issueSize',
      'ipos.priceRangeMin',
      'ipos.priceRangeMax',
      'ipos.lotSize',
      'ipo_details.freshIssue',
    ]);
    const h = makeDeps(adOwned);
    const summary = await persistFilingExtraction(
      IPO_ID,
      coverExtraction(),
      { docType: 'PROSPECTUS', apply: true },
      h.deps
    );

    const scraped = upsertIPOMock.mock.calls[0][1] as Record<string, unknown>;
    expect(scraped).not.toHaveProperty('issueSize');
    expect(scraped).not.toHaveProperty('priceRangeMin');
    expect(scraped).not.toHaveProperty('priceRangeMax');
    expect(scraped).not.toHaveProperty('lotSize');
    // faceValue was NOT ad-owned, so the cover still writes it.
    expect(scraped.faceValue).toBe(10);

    const details = h.detailsUpsert.mock.calls[0][1] as Record<string, unknown>;
    expect(details).not.toHaveProperty('freshIssue');
    // ofsIssue and issueType were not ad-owned and still land.
    expect(details.ofsIssue).toBe('0');
    expect(details.issueType).toBe('FIXED_PRICE');

    expect(summary.skipped_lower_priority_source?.length).toBe(5);
    expect(summary.skipped_lower_priority_source?.join(' ')).toContain(
      'a price band advertisement already set it'
    );
  });

  it('leaves the PRICE_BAND_AD path itself unguarded (the ad outranks nothing)', async () => {
    // Same field values, but with NO cover marker — i.e. the ad path. Even with
    // a prior PRICE_BAND_AD lineage on every column, the ad rewrites its own
    // fields; the guard fires only on a cover-sourced headline.
    const h = makeDeps(new Set(['ipos.issueSize', 'ipos.priceRangeMin']));
    const extraction = coverExtraction();
    delete extraction.fields.headline_source;
    delete extraction.fields.issue_price_type;

    const summary = await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'PRICE_BAND_AD', apply: true },
      h.deps
    );

    const scraped = upsertIPOMock.mock.calls[0][1] as Record<string, unknown>;
    expect(scraped.issueSize).toBe(146_001_000);
    expect(scraped.priceRangeMin).toBe(41);
    expect(summary.skipped_lower_priority_source).toEqual([]);
  });

  it('refuses issueType when the cover says FIXED_PRICE but the filing cites a book-building regulation', async () => {
    const h = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      coverExtraction({ book_building_regulation: '229(1)' }),
      { docType: 'PROSPECTUS', apply: true },
      h.deps
    );

    const details = h.detailsUpsert.mock.calls[0][1] as Record<string, unknown>;
    expect(details).not.toHaveProperty('issueType');
    expect(summary.skipped_failed_check.join(' ')).toContain('ipo_details.issueType');
  });

  it('trusts the cover over the W-143 floor==cap heuristic: BOOK_BUILDING cover + collapsed band stays BOOK_BUILDING', async () => {
    // W-143 (main) infers FIXED_PRICE from floor === cap alone when there is no
    // other signal. This cover names its own process ("100% Book Built Issue")
    // while the band happens to have collapsed to one price (e.g. a revision) —
    // the cover wording is the PRIMARY signal and must win over that heuristic.
    const h = makeDeps();
    const summary = await persistFilingExtraction(
      IPO_ID,
      coverExtraction({ issue_price_type: 'BOOK_BUILDING' }),
      { docType: 'PROSPECTUS', apply: true },
      h.deps
    );

    const details = h.detailsUpsert.mock.calls[0][1] as Record<string, unknown>;
    expect(details.issueType).toBe('BOOK_BUILDING');
    expect(summary.skipped_failed_check).toEqual([]);
  });

  it('keeps the stored value when the field_sources row carries no doc type (fail closed)', async () => {
    // W-147 round 2 / MINOR-2: a row that EXISTS but names no docType is UNKNOWN
    // provenance, not "not an ad" — it may well be the advertisement's value.
    const h = makeDeps();
    (h.findByField as ReturnType<typeof vi.fn>).mockImplementation(
      async (_ipoId: string, table: string, field: string) =>
        `${table}.${field}` === 'ipos.issueSize'
          ? { previousValue: '999', source: 'DRHP', dataLineage: { method: 'FILING_EXTRACTION' } }
          : null
    );

    const summary = await persistFilingExtraction(
      IPO_ID,
      coverExtraction(),
      { docType: 'PROSPECTUS', apply: true },
      h.deps
    );

    const scraped = upsertIPOMock.mock.calls[0][1] as Record<string, unknown>;
    expect(scraped).not.toHaveProperty('issueSize');
    // Every other column has no row at all and is written normally.
    expect(scraped.priceRangeMin).toBe(41);
    expect(summary.skipped_lower_priority_source?.join(' ')).toContain(
      'no doc-type provenance'
    );
  });

  it('writes when the stored value names a NON-ad doc type', async () => {
    const h = makeDeps();
    (h.findByField as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      previousValue: '999',
      source: 'DRHP',
      dataLineage: { method: 'FILING_EXTRACTION', docType: 'DRHP' },
    }));

    const summary = await persistFilingExtraction(
      IPO_ID,
      coverExtraction(),
      { docType: 'PROSPECTUS', apply: true },
      h.deps
    );

    const scraped = upsertIPOMock.mock.calls[0][1] as Record<string, unknown>;
    expect(scraped.issueSize).toBe(146_001_000);
    expect(summary.skipped_lower_priority_source).toEqual([]);
  });

  it('keeps the stored value when the provenance read fails (fail closed)', async () => {
    const h = makeDeps();
    (h.findByField as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw new Error('field_sources unavailable');
    });

    const summary = await persistFilingExtraction(
      IPO_ID,
      coverExtraction(),
      { docType: 'PROSPECTUS', apply: true },
      h.deps
    );

    // A provenance read failure must not silently DOWNGRADE the guard into a
    // write — the advertisement's value, if any, is the one worth keeping.
    expect(summary.ipos_fields).toEqual([]);
    expect(summary.skipped_lower_priority_source?.join(' ')).toContain('provenance unreadable');
  });
});
