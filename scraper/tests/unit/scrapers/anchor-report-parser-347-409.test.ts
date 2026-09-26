/**
 * #347 / #409 - real NSE anchor allocation letters the parser used to refuse.
 *
 * Each `<SYMBOL>-sidecar-pages.json` is the exact stdout of
 * `python scripts/anchor_report_text.py <pdf>` (after the #409 sidecar fix) for
 * the letter in https://nsearchives.nseindia.com/content/ipo/ANCHOR_<SYMBOL>.zip.
 * Totals and prices asserted below are the letter's OWN printed figures (the
 * preamble "allocation of N Equity Shares", the Total row, the stated price).
 *
 * Class A (#347), "row X prints P% but holds H% of the anchor portion":
 *  - TEMPSENS: the main table's Total is blank-named, and the mutual-fund and
 *    insurance sub-tables that REPEAT 24 of its investors follow it, so the
 *    Total was never recognised and the repeats were counted as investors.
 *  - VARMORA: the main table prints no Total at all before its sub-tables.
 *  - MANIKA: the first row's percent cell carries the header word
 *    ("Portion 46.87%"), so that row was dropped and every other row's share
 *    of the (smaller) portion came out wrong.
 * Class B (#409), "only 0 investor rows could be read": KANOHAR, PRASOLCHEM,
 * RENTOMOJO - the sidecar learned no serial column and read the SHARE column
 * as the serial, leaving every row without a name or a share count. KANOHAR
 * then exposed the 100x price decoy (whole-rupee amounts, 632 vs 6.32).
 */
import { describe, it, expect } from 'vitest';
import { parseAnchorReport, mainPortionEnd } from '../../../src/scrapers/anchor-report-parser';
import tempsens from '../../fixtures/anchor/TEMPSENS-sidecar-pages.json';
import manika from '../../fixtures/anchor/MANIKA-sidecar-pages.json';
import varmora from '../../fixtures/anchor/VARMORA-sidecar-pages.json';
import kanohar from '../../fixtures/anchor/KANOHAR-sidecar-pages.json';
import prasol from '../../fixtures/anchor/PRASOLCHEM-sidecar-pages.json';
import rentomojo from '../../fixtures/anchor/RENTOMOJO-sidecar-pages.json';

function ok(pages: string[]) {
  const r = parseAnchorReport(pages);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r.value;
}

describe('#347 - a letter whose sub-tables repeat the portion is read to the portion only', () => {
  it('TEMPSENS: 29 investors, 64,84,999 shares at Rs 300, sub-table repeats not counted', () => {
    const v = ok(tempsens.pages);
    expect(v.rows).toHaveLength(29);
    expect(v.bidPrice).toBe(300);
    expect(v.totalShares).toBe(6484999);
    expect(v.totalAmountRupees).toBe(1945499700);
    expect(v.printedTotalShares).toBe(6484999);
    expect(v.rows[0]).toEqual({
      name: 'ARANDA INVESTMENTS PTE. LTD.',
      shares: 554300,
      amountRupees: 166290000,
      percentOfAnchorPortion: 8.55,
    });
    expect(v.rows[28]).toEqual({
      name: 'KOTAK MAHINDRA LIFE INSURANCE',
      shares: 233550,
      amountRupees: 70065000,
      percentOfAnchorPortion: 3.6,
    });
    expect(v.rows.map((r) => r.shares)).toEqual([
      554300, 554300, 115500, 230950, 207850, 554300, 53450, 500850, 554300, 554300, 519650, 34650,
      200050, 116650, 316700, 316700, 316700, 87100, 229600, 1330, 22455, 1331, 3013, 6691, 4344,
      67364, 67364, 59657, 233550,
    ]);
    // The letter's mutual-fund sub-table: 14 schemes, 37,21,600 shares.
    expect(v.mutualFundShares).toHaveLength(14);
    expect(v.mutualFundShares.reduce((s, x) => s + x, 0)).toBe(3721600);
  });

  it('VARMORA: 17 investors, 1,43,51,775 shares at Rs 148, no printed main Total', () => {
    const v = ok(varmora.pages);
    expect(v.rows).toHaveLength(17);
    expect(v.bidPrice).toBe(148);
    expect(v.totalShares).toBe(14351775);
    expect(v.totalAmountRupees).toBe(2124062700);
    // The letter prints no Total for the main table: not checkable, never guessed.
    expect(v.printedTotalShares).toBeNull();
    expect(v.rows.map((r) => r.shares)).toEqual([
      1689225, 1351380, 1689225, 1689225, 1067570, 355924, 711646, 1067570, 202707, 135138, 270276,
      405414, 675690, 675690, 338025, 1351380, 675690,
    ]);
    expect(v.rows[0].percentOfAnchorPortion).toBe(11.77);
    expect(v.rows[0].amountRupees).toBe(250005300);
  });

  it('MANIKA: a header word in the first percent cell does not drop the row', () => {
    const v = ok(manika.pages);
    expect(v.rows).toHaveLength(5);
    expect(v.bidPrice).toBe(43);
    expect(v.totalShares).toBe(8755813);
    expect(v.printedTotalShares).toBe(8755813);
    expect(v.printedTotalAmountRupees).toBe(376499959);
    expect(v.rows[0]).toEqual({
      name: 'THE WEALTH COMPANY ALTERNATES TRUST-BHARAT VALUE FUND-SERIES HH',
      shares: 4104199,
      amountRupees: 176480557,
      percentOfAnchorPortion: 46.87,
    });
    expect(v.rows.map((r) => r.percentOfAnchorPortion)).toEqual([46.87, 15.94, 13.28, 13.28, 10.63]);
  });
});

describe('#409 - letters the sidecar used to render with no name and no share column', () => {
  it('KANOHAR: 42 investors, 50,11,424 shares at Rs 632 (not the 100x-low decoy 6.32)', () => {
    const v = ok(kanohar.pages);
    expect(v.rows).toHaveLength(42);
    expect(v.bidPrice).toBe(632);
    expect(v.totalShares).toBe(5011424);
    expect(v.totalAmountRupees).toBe(3167219968);
    expect(v.printedTotalShares).toBe(5011424);
    expect(v.printedTotalAmountRupees).toBe(3167219968);
    expect(v.rows[0]).toEqual({
      name: 'ISIF EQUITY EX-TOP 100 LONG- SHORT FUND',
      shares: 385664,
      amountRupees: 243739648,
      percentOfAnchorPortion: 7.7,
    });
    expect(v.rows[1]).toEqual({
      name: 'ICICI PRUDENTIAL MULTI CAP FUND',
      shares: 539948,
      amountRupees: 341247136,
      percentOfAnchorPortion: 10.77,
    });
  });

  it('PRASOLCHEM: 14 investors, 22,18,930 shares at Rs 676', () => {
    const v = ok(prasol.pages);
    expect(v.rows).toHaveLength(14);
    expect(v.bidPrice).toBe(676);
    expect(v.totalShares).toBe(2218930);
    expect(v.totalAmountRupees).toBe(1499996680);
    expect(v.rows.map((r) => r.shares)).toEqual([
      117898, 117876, 60104, 147950, 147928, 295878, 295878, 221892, 73986, 147950, 44374, 221914,
      177352, 147950,
    ]);
    expect(v.rows[0].amountRupees).toBe(79699048);
    expect(v.rows[0].percentOfAnchorPortion).toBe(5.31);
  });

  it('RENTOMOJO: 41 investors, 93,08,667 shares at Rs 404', () => {
    const v = ok(rentomojo.pages);
    expect(v.rows).toHaveLength(41);
    expect(v.bidPrice).toBe(404);
    expect(v.totalShares).toBe(9308667);
    expect(v.totalAmountRupees).toBe(3760701468);
    expect(v.printedTotalShares).toBe(9308667);
    expect(v.rows[0]).toEqual({
      name: 'Kotak ELSS Tax Saver Fund',
      shares: 432049,
      amountRupees: 174547796,
      percentOfAnchorPortion: 4.64,
    });
  });
});

describe('#347 - the refusal still fires when the letter is not shaped as assumed', () => {
  it('a row past 100% that is NOT a repeat of a portion row keeps the letter refused', () => {
    // Replace the first sub-table repeat (SBI RESURGENT 5,54,300) with a share
    // count no portion row printed: the tail is then not a sub-table, the
    // portion is not cut, and the repeats inflate the portion as before.
    const pages = tempsens.pages.map((p, i) =>
      i === 2
        ? p.replace(
            '#  | SBI RESURGENT INDIA OPPORTUNITIES | 5,54,300 | 8.55% | 300.00 | 16,62,90,000.00',
            '#  | SBI RESURGENT INDIA OPPORTUNITIES | 5,54,301 | 8.55% | 300.00 | 16,62,90,300.00'
          )
        : p
    );
    expect(pages[2]).not.toBe(tempsens.pages[2]);
    const r = parseAnchorReport(pages);
    expect(r.ok).toBe(false);
  });

  it('mainPortionEnd picks the position closest to 100, never an earlier near-miss', () => {
    const row = (name: string, shares: string, pct: string) => ({ name, cells: [shares, pct, '10', '1'] });
    const rows = [
      row('A', '9,900', '99.10%'),
      row('B', '50', '0.50%'),
      row('C', '40', '0.40%'),
      row('A', '9,900', '99.10%'),
    ];
    expect(mainPortionEnd(rows, (r) => r.name !== '')).toBe(2);
  });

  it('mainPortionEnd returns null when the rows never reach 100%', () => {
    const row = (name: string, shares: string, pct: string) => ({ name, cells: [shares, pct] });
    expect(mainPortionEnd([row('A', '1,000', '40.00%'), row('B', '1,000', '40.00%')], () => true)).toBeNull();
  });
});
