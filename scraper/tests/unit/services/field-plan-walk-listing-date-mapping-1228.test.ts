/**
 * #1228 (refs #70): the field walk logged NO_MAPPING for `ipos.listingDate` from
 * NSE, BSE and CHITTORGARH on every attempt (glass-wall-systems-india-ltd,
 * 2026-09-22..09-25), so no web source could ever supply field 7 through the
 * pull model.
 *
 * Spec field 7 (`listing_date`, E-1): MAINBOARD NSE > BSE > CG; SME-BSE BSE > CG;
 * SME-NSE NSE > CG. Only CHITTORGARH's payload carries a listing date:
 *   - NSE: the real ipo-current-issue (13 keys) and all-upcoming-issues (8 keys)
 *     payloads carry none (docs/design/probes/nse-payload.out.json) -> stays a
 *     reported NO_MAPPING gap (review r1, MAJOR 1).
 *   - BSE: its board/detail endpoints carry none (bse-api-scraper.ts) -> gap.
 * So field 7 comes from CHITTORGARH (and documents).
 *
 * The CHITTORGARH case drives the REAL list parser (`scrapeChittorgarhIPOs`,
 * global fetch stubbed) over a REAL captured report-82 payload:
 * docs/design/probes/fixtures/chittorgarh/report-82-pricing-method.json
 * (captured 2026-09-10 from webnodejs.chittorgarh.com report 82). Its row
 * "Axiom Gas Engineering Ltd." carries `~ListingDate` 2026-09-25T00:00:00.000Z
 * with an EMPTY display "Listing Date" -- the parser's ISO-metadata path.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NSE_SERVEABLE_FIELDS } from '../../../src/services/field-plan-walk-nse-fetcher.js';
import {
  buildChittorgarhFetcher,
  ChittorgarhFieldFetcherState,
  CHITTORGARH_SERVEABLE_FIELDS,
} from '../../../src/services/field-plan-walk-chittorgarh-fetcher.js';
import { BSE_SERVEABLE_FIELDS } from '../../../src/services/field-plan-walk-bse-fetcher.js';
import { DOC_READABLE_TABLES } from '../../../src/services/field-plan-walk-doc-fetcher.js';
import { listManifestRankCoverageGaps } from '../../../src/config/manifest-rank-coverage-gaps.js';

const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REPORT82 = JSON.parse(
  readFileSync(
    path.join(SCRAPER_ROOT, '..', 'docs', 'design', 'probes', 'fixtures', 'chittorgarh', 'report-82-pricing-method.json'),
    'utf8'
  )
);
const IPO_ID = '00000000-0000-4000-8000-000000001228';

function stubReport(rows: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ msg: 1, sSearchWhere: '', reportTableData: rows }),
    })
  );
}

function cgFetcher(companyName: string) {
  return buildChittorgarhFetcher(
    { ipoRepository: { findById: vi.fn(async () => ({ companyName })) } as never, isChittorgarhCapable: () => true },
    new ChittorgarhFieldFetcherState()
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('#1228: listing_date through the field walk', () => {
  it('CHITTORGARH supplies listing_date from a REAL report-82 row (Axiom Gas Engineering, ~ListingDate 2026-09-25)', async () => {
    stubReport(REPORT82.sampleRows);
    const answer = await cgFetcher('Axiom Gas Engineering Ltd.')(IPO_ID, 'ipos', '', 'listing_date');
    expect(answer.outcome).toBe('SUPPLIED');
    expect(String((answer as { value: unknown }).value).slice(0, 10)).toBe('2026-09-25');
  });

  it('a REAL row with no listing date at all answers NOT_AVAILABLE_YET (re-asked), never SUPPLIED empty', async () => {
    const row = { ...REPORT82.sampleRows[0], 'Listing Date': '', '~ListingDate': '' };
    stubReport([row]);
    const answer = await cgFetcher('Axiom Gas Engineering Ltd.')(IPO_ID, 'ipos', '', 'listing_date');
    expect(answer).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
  });

  it('the real manifest: CHITTORGARH listing_date gap is closed; NSE and BSE stay reported gaps (no listing date in their payloads)', () => {
    const manifest = JSON.parse(readFileSync(path.join(SCRAPER_ROOT, 'config', 'field-manifest.json'), 'utf8'));
    const gaps = listManifestRankCoverageGaps(
      manifest,
      ['DOC', 'BSE', 'NSE', 'CHITTORGARH'],
      { BSE: BSE_SERVEABLE_FIELDS, NSE: new Set(NSE_SERVEABLE_FIELDS.keys()), CHITTORGARH: CHITTORGARH_SERVEABLE_FIELDS },
      DOC_READABLE_TABLES
    ).filter((g) => g.startsWith('ipos.listing_date '));
    expect(gaps).toEqual(['ipos.listing_date BSE NO_MAPPING', 'ipos.listing_date NSE NO_MAPPING']);
  });
});
