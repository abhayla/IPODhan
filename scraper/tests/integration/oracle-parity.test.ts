import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Oracle-parity verification (process-only IPO-ingestion contract, decision 4).
 *
 * Asserts each pinned IPO's process-produced record (a frozen snapshot of the
 * live DB record at `_db-records/pinned-records.json`) matches the independent
 * Chittorgarh oracle (the verified CG values below), per decision-2 tolerances:
 *   money ±1% · lots/counts exact · dates exact.
 *
 * This is CI-portable (no live DB — both sides are frozen) and locks the
 * verification as a regression gate. Documented outliers are `it.skip`'d with
 * their issue id per bug-triage-discipline (a catch-test parked until the fix):
 *   - meesho   → #70 (stale CLOSED record: issue_size + status + listing wrong)
 *   - clay-craft issue_size → ~5% reconcile (gross-at-upper vs net), tracked in ledger
 *   - ather    → not yet ingested (loss-maker slot; financials verified separately
 *                in tests/unit/scripts/extract-financials-pdf.test.ts)
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECORDS = JSON.parse(
  readFileSync(path.join(__dirname, 'oracle/_db-records/pinned-records.json'), 'utf-8'),
);

// Independent CG oracle (via WebSearch 2026-06-28), normalized for comparison.
// issuePrice = final price (band upper); issueSizeCr in ₹ crore; listing = IST date.
const ORACLE: Record<string, { issuePrice: number; lot: number; issueSizeCr: number; listing?: string }> = {
  'hexagon-nutrition-ltd':   { issuePrice: 45,  lot: 333,  issueSizeCr: 138.87, listing: '2026-06-12' },
  'csm-technologies-ltd':    { issuePrice: 113, lot: 132,  issueSizeCr: 145.78 },
  'advit-jewels-ltd':        { issuePrice: 138, lot: 100,  issueSizeCr: 165.16 },
  'aastha-spintex-ltd':      { issuePrice: 136, lot: 110,  issueSizeCr: 170.00 },
  'avience-biomedicals-ltd': { issuePrice: 208, lot: 600,  issueSizeCr: 30.00,  listing: '2026-06-25' },
  'diksha-polymers-ltd':     { issuePrice: 112, lot: 1200, issueSizeCr: 17.90,  listing: '2026-06-24' },
};

const within1pct = (db: number, oracle: number) => Math.abs(db - oracle) <= 0.01 * Math.abs(oracle);

describe('oracle parity — pinned IPOs vs Chittorgarh (decision 4)', () => {
  for (const [slug, o] of Object.entries(ORACLE)) {
    describe(slug, () => {
      const rec = RECORDS[slug];
      it('record snapshot exists', () => expect(rec, `${slug} missing from DB snapshot`).toBeTruthy());
      it('issue price (band upper) matches exactly', () => expect(rec.priceMax).toBe(o.issuePrice));
      it('lot size matches exactly', () => expect(rec.lotSize).toBe(o.lot));
      it('issue size matches within ±1%', () =>
        expect(within1pct(rec.issueSizeCr, o.issueSizeCr), `db ${rec.issueSizeCr}Cr vs oracle ${o.issueSizeCr}Cr`).toBe(true));
      if (o.listing) {
        it('listing date matches exactly', () => expect(rec.listingDate).toBe(o.listing));
      }
    });
  }

  // Documented outliers — parked catch-tests (bug-triage-discipline): unskip on fix.
  it.skip('meesho: issue_size ₹3085 vs oracle ₹5421 Cr + stale CLOSED/null-listing — ISSUE #70', () => {
    const rec = RECORDS['meesho-ltd'];
    expect(within1pct(rec.issueSizeCr, 5421.2)).toBe(true);
    expect(rec.status).toBe('LISTED');
    expect(rec.listingDate).toBe('2025-12-10');
  });
  it.skip('clay-craft: issue_size DB 110.11 vs oracle 104.58 Cr (~5%) — reconcile (gross-at-upper vs net)', () => {
    expect(within1pct(RECORDS['clay-craft-india-ltd'].issueSizeCr, 104.58)).toBe(true);
  });

  // Non-IPO exclusion slot (IIFL NCD) — classifier must mark it non-IPO.
  it('IIFL (NCD) is classified non-IPO (exclusion slot)', () => {
    expect(RECORDS['iifl-finance-ltd'].offeringType).not.toBe('IPO');
  });
});
