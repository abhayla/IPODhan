/**
 * GitHub #70 / #36 — Chittorgarh report-25 listing source, frozen-fixture proof.
 *
 * Complements chittorgarh-listing-scraper.test.ts (single hand-built row) by
 * parsing REAL frozen report-25 responses (captured 2026-06-28, FY2025-26
 * mainboard + SME). The independent correctness check is the GAIN-CONSISTENCY
 * INVARIANT: CG's stated gain must equal the gain computed from issue price and
 * day-1 close (±1pp) — catches any parse/scale error without a 2nd network source.
 * Verified across >=7 IPOs of mixed type (mainboard large/mid + SME), per the
 * owner's "7 IPOs of different types" directive.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  parseListingReportRows,
  type ChittorgarhListingRow,
} from '../../../src/scrapers/chittorgarh-listing-scraper.js';
import {
  computeListingGainPct,
  isPlausibleListingGain,
  parseCgListingDate,
} from '../../../src/services/listing-reconciliation.js';

function loadFixture(name: string): any[] {
  const p = path.join(process.cwd(), 'tests', 'fixtures', 'listing', name);
  const json = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return json.reportTableData ?? [];
}

const mainboard = parseListingReportRows(loadFixture('cg-report25-mainboard-2025-26.json'));
const sme = parseListingReportRows(loadFixture('cg-report25-sme-2025-26.json'));
const all: ChittorgarhListingRow[] = [...mainboard, ...sme];

describe('Chittorgarh report-25 listing source — frozen fixture (#70)', () => {
  it('extracts listing rows across mainboard AND SME (>=7 IPOs of mixed type)', () => {
    expect(mainboard.length).toBeGreaterThanOrEqual(3);
    expect(sme.length).toBeGreaterThanOrEqual(3);
    expect(all.length).toBeGreaterThanOrEqual(7);
  });

  it('every row has listing essentials (parseable date + positive day-1 close)', () => {
    for (const r of all) {
      expect(r.companyName, JSON.stringify(r)).toBeTruthy();
      expect(parseCgListingDate(r.listingDate)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.listingClose).toBeGreaterThan(0);
    }
  });

  it('GAIN-CONSISTENCY: stated gain == gain computed from issue + day-1 close (±1pp), >=7 IPOs', () => {
    let checked = 0;
    for (const r of all) {
      if (r.issuePrice == null || r.listingGainPct == null) continue;
      const computed = computeListingGainPct(r.issuePrice, r.listingClose);
      expect(computed, `gain for ${r.companyName}`).not.toBeNull();
      expect(
        Math.abs((computed as number) - r.listingGainPct),
        `${r.companyName}: stated ${r.listingGainPct} vs computed ${computed}`
      ).toBeLessThanOrEqual(1.0);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(7);
  });

  it('output-plausibility: every listing gain is in a domain-sane range', () => {
    for (const r of all) {
      expect(isPlausibleListingGain(r.listingGainPct), `${r.companyName} gain ${r.listingGainPct}`).toBe(true);
    }
  });

  it('spot-check known IPOs against frozen oracle values', () => {
    const gksl = all.find((r) => r.nseSymbol === 'GKSL');
    expect(gksl).toBeDefined();
    expect(parseCgListingDate(gksl!.listingDate)).toBe('2025-12-30');
    expect(gksl!.issuePrice).toBe(114);
    expect(gksl!.listingClose).toBeCloseTo(104.54, 1);
    expect(gksl!.isin).toBe('INE0V0W01025');
    expect(gksl!.bseScripCode).toBe('544666');

    const icici = all.find((r) => r.nseSymbol === 'ICICIAMC');
    expect(icici).toBeDefined();
    expect(icici!.listingClose).toBeGreaterThan(2000); // large mainboard
  });
});
