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

  it('parses the IST observation timestamp to the same UTC instant regardless of process.env.TZ', () => {
    // Regression guard for the T-327-class bug this fixture's fix round closed:
    // a `new Date(rawIstString).toISOString()` chain would parse the string in
    // the PROCESS's local timezone, so the same input yields a different UTC
    // instant depending on the host's TZ. The sanctioned fix (Date.UTC(...)
    // inlined directly into `new Date(...)`, see nse-api-client.ts) must be
    // TZ-invariant: the same known IST string -> the same UTC instant, no
    // matter what process.env.TZ is set to.
    const originalTz = process.env.TZ;
    const demandGraph = {
      timestamp: 'As on 02-Sep-2026 18:02:00 IST', // IST (UTC+5:30) -> 12:32:00 UTC
      plotData: { '170': '100' },
      totalBidRecieved: '100',
    };

    try {
      const tzCandidates = ['UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Kiritimati'];
      const results = tzCandidates.map((tz) => {
        process.env.TZ = tz;
        const points = extractDemandGraphData(demandGraph, [], [], 'DEEPA');
        return points[0]?.timestamp;
      });

      for (const result of results) {
        expect(result).toBe('2026-09-02T12:32:00.000Z');
      }
    } finally {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    }
  });
});
