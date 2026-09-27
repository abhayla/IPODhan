/**
 * OD-129 (#938): the filing persister claims `listingExchange` from the cover
 * page's listing sentence — on the REAL text of NSE's own RHP on staging
 * (fixture: tests/fixtures/listing-sentence/staging-listing-sentences.json),
 * stored [BSE, NSE], which lists on BSE only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertIPOMock } = vi.hoisted(() => ({ upsertIPOMock: vi.fn(async () => 'ipo-id') }));
vi.mock('../../../src/services/data-persister.js', () => ({ upsertIPO: upsertIPOMock }));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
        segment: 'MAINBOARD',
        offeringType: 'IPO',
        status: 'UPCOMING',
        listingExchanges: STORED_EXCHANGES,
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


const STORED_EXCHANGES = ['BSE', 'NSE'];
const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/listing-sentence/staging-listing-sentences.json'), 'utf8')
) as { entries: Array<{ slug: string; docType: string; pageNumber: number; excerpt: string }> };
const page = (slug: string, docType: string) => {
  const e = fixture.entries.find((x) => x.slug === slug && x.docType === docType)!;
  return [e.pageNumber - 1, e.excerpt] as [number, string];
};

describe('OD-129: the listing sentence is the claim of this document on listingExchange', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  const run = async (pageTexts: Array<[number, string]> | undefined) => {
    const extraction = { ...datelessCover(), page_texts: pageTexts } as FilingExtraction;
    await persistFilingExtraction(IPO_ID, extraction, { docType: 'RHP', apply: true }, makeDeps());
    expect(upsertIPOMock).toHaveBeenCalledTimes(1);
    const call = upsertIPOMock.mock.calls[0] as unknown[];
    return { scraped: call[1] as Record<string, unknown>, contextFields: call[4] as string[] };
  };

  it('NSE RHP ("a recognised stock exchange being BSE Limited") -> claims BSE, not context', async () => {
    const { scraped, contextFields } = await run([page('national-stock-exchange-of-india-ltd', 'RHP')]);
    expect(scraped.listingExchange).toBe('BSE');
    expect(scraped.listingExchanges).toBeUndefined();
    expect(contextFields).not.toContain('listingExchange');
  });

  it('a two-exchange RHP claims BOTH', async () => {
    const { scraped, contextFields } = await run([page('a-one-steels-india-ltd', 'RHP')]);
    expect(scraped.listingExchange).toBe('BOTH');
    expect(contextFields).not.toContain('listingExchange');
  });

  it('a price band ad naming no exchange claims nothing: the stored set is only context', async () => {
    const { scraped, contextFields } = await run([page('hero-motors-ltd', 'PRICE_BAND_AD')]);
    expect(scraped.listingExchange).toBe('BOTH');
    expect(contextFields).toContain('listingExchange');
  });

  it('no page text at all -> the stored set is only context', async () => {
    const { contextFields } = await run(undefined);
    expect(contextFields).toContain('listingExchange');
  });
});
