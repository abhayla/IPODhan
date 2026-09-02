/**
 * H4 demand-graph snapshot walk (docs/deepa-walk-ledger, 2026-09-02) - live-verified
 * against DEEPA on `/api/ipo-detail`. Two timestamp defects were found and fixed in
 * `extractDemandGraphData` (nse-api-client.ts), both instances of the same class as
 * the historic scraper-timestamp-tz-skew bug: recording when the SCRAPE ran instead
 * of when NSE captured the snapshot.
 *
 *   1. plotData-derived entries always stamped `new Date()` (wall-clock "now"),
 *      ignoring `demandGraph.timestamp` ("As on DD-MMM-YYYY HH:mm:ss IST") entirely.
 *   2. demandDataNSE/demandDataBSE detail-row entries looked up `entry.timeStamp`
 *      (camelCase S) but NSE's actual field is lowercase `entry.timestamp` - the
 *      lookup never matched, so these rows also silently fell back to "now".
 *
 * Fixture `tests/fixtures/nse/deepa-demand.json` is a trimmed capture of the real
 * live payload (DEEPA, 02-Sep-2026, open issue) taken during the walk.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { extractDemandGraphData } from '../../../src/scrapers/nse-api-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/nse/deepa-demand.json'), 'utf-8')
);

// NSE observation time for this fixture: "As on 02-Sep-2026 17:00:13 IST" and
// per-row "02-Sep-2026 17:00:00" (BSE) / "17:00:13" (NSE) - IST is UTC+5:30.
const EXPECTED_NSE_TS = '2026-09-02T11:30:13.000Z';
const EXPECTED_BSE_TS = '2026-09-02T11:30:00.000Z';

describe('extractDemandGraphData timestamp handling (live DEEPA fixture)', () => {
  it('stamps plotData-derived rows with the payload observation time, not wall-clock now', () => {
    const points = extractDemandGraphData(
      fixture.demandGraph,
      fixture.demandDataNSE,
      fixture.demandDataBSE,
      'DEEPA'
    );

    const nseRow = points.find((p: any) => p.exchange === 'NSE' && p.pricePoint === 168);
    expect(nseRow).toBeDefined();
    expect(nseRow.timestamp).toBe(EXPECTED_NSE_TS);

    // Guard against the regression directly: the observation time is nearly 15
    // years before "now" in this fixture's calendar terms would never happen, but
    // the real regression check is simpler - the stamped value must equal the
    // parsed NSE time, not `new Date().toISOString()` captured at test run time.
    expect(nseRow.timestamp).not.toBe(new Date().toISOString().slice(0, 10));
  });

  it('stamps detailed NSE/BSE per-row entries using entry.timestamp (lowercase), not entry.timeStamp', () => {
    const points = extractDemandGraphData(
      fixture.demandGraph,
      fixture.demandDataNSE,
      fixture.demandDataBSE,
      'DEEPA'
    );

    const bseRow = points.find((p: any) => p.exchange === 'BSE' && p.pricePoint === 177);
    expect(bseRow).toBeDefined();
    expect(bseRow.timestamp).toBe(EXPECTED_BSE_TS);
  });

  it('gives every entry a plausible bid price (168-177) or the Cut-Off marker, with a non-negative quantity', () => {
    const points = extractDemandGraphData(
      fixture.demandGraph,
      fixture.demandDataNSE,
      fixture.demandDataBSE,
      'DEEPA'
    );

    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      if (p.isCutOff) {
        expect(p.pricePoint).toBeNull();
      } else {
        expect(p.pricePoint).toBeGreaterThanOrEqual(168);
        expect(p.pricePoint).toBeLessThanOrEqual(177);
      }
      expect(p.cumulativeQuantity).toBeGreaterThanOrEqual(0);
    }
  });

  it('NSE-book total is self-consistent with demandGraph.totalBidRecieved', () => {
    const points = extractDemandGraphData(
      fixture.demandGraph,
      fixture.demandDataNSE,
      fixture.demandDataBSE,
      'DEEPA'
    );
    const nseAtLowestPrice = points.find((p: any) => p.exchange === 'NSE' && p.pricePoint === 168);
    expect(nseAtLowestPrice.cumulativeQuantity).toBe(Number(fixture.demandGraph.totalBidRecieved));
  });
});
