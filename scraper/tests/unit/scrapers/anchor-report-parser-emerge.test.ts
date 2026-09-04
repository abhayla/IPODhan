/**
 * W-132: NSE Emerge (SME) anchor allocation letters print the bid price and
 * total amount as plain, undivided Indian-grouped rupees ("127 3,26,39,000"),
 * with no decimal point anywhere in the cell. `splitPriceAndAmount` used to
 * assume every printed amount carries a literal ".00" suffix (true of the
 * mainboard DEEPA-style scans this parser was built against) and unconditionally
 * treated the LAST TWO digits of the merged run as printed paise - which divides
 * a whole-rupee Emerge amount by 100 and leaves no price any row agrees on.
 *
 * Fixture: the real Qualiance International Limited (NSE Emerge) anchor
 * intimation letter dated September 03, 2026 - see
 * tests/fixtures/sme/qualiance-anchor-letter-text.txt for the raw letter text
 * this was hand-transcribed from. Truth: 6 anchor investors, allocation price
 * Rs 127 per equity share, 10,09,000 equity shares for Rs 12,81,43,000 total.
 */
import { describe, it, expect } from 'vitest';
import { parseAnchorReport, splitPriceAndAmount } from '../../../src/scrapers/anchor-report-parser';

const ORACLE = {
  investors: 6,
  bidPrice: 127,
  totalShares: 1009000,
  totalAmountRupees: 128143000,
};

// One page string in the `scripts/anchor_report_text.py` sidecar's
// `# <serial> | <name> | <shares> | <pct> | <price> <amount>` format - the bid
// price and total amount arrive merged into a single trailing cell exactly as
// production observed (the letter's own column geometry puts the two columns
// closer together than the mainboard scans this format was designed for).
const PAGE_1 = [
  'Sub: Public Issue of equity shares of Qualiance International Limited',
  '# 1 | Bharat Venture Opportunities Fund | 2,57,000 | 25.47% | 127 3,26,39,000',
  '# 2 | Carnelian AIF Category I Trust-Scheme 1 | 2,57,000 | 25.47% | 127 3,26,39,000',
  '# 3 | Hem Growth Opportunities Fund | 2,57,000 | 25.47% | 127 3,26,39,000',
  '# 4 | Finavenue Capital Trust - Finavenue Growth Fund | 80,000 | 7.93% | 127 1,01,60,000',
  '# 5 | 360 ONE LVF Treasury Solutions Fund | 79,000 | 7.83% | 127 1,00,33,000',
  '# 6 | Tattvam AIF Trust -Aanjay Ageless AIF Fund | 79,000 | 7.83% | 127 1,00,33,000',
  '#  | TOTAL | 10,09,000 | 100.00% | 12,81,43,000',
  'No Mutual Funds, Life Insurance Companies, or Pension Funds have submitted applications.',
].join('\n');

const PAGE_2 = [
  'Sr. No. Name of Scheme No. of Equity Shares % of Anchor Investor Portion Bid price',
  'Nil',
].join('\n');

const PAGES = [PAGE_1, PAGE_2];

describe('splitPriceAndAmount - whole-rupee (no decimal) amounts', () => {
  it('splits a merged "<price> <amount>" cell with no printed decimal', () => {
    // "127 3,26,39,000": price 127, amount 32,639,000 rupees - shares 257,000.
    const splits = splitPriceAndAmount('127 3,26,39,000', 257000);
    expect(splits).toContainEqual({ price: 127, amount: 32639000 });
  });

  it('still finds the DEEPA decimal-paise split ("777.00 3,95,69,128.00" shaped)', () => {
    // Regression: the mainboard shape must keep working after adding the
    // whole-integer candidate.
    const splits = splitPriceAndAmount('177.00 35,95,69,128.00', 2031464);
    expect(splits).toContainEqual({ price: 177, amount: 35956912.8 * 10 });
  });
});

describe('parseAnchorReport - Qualiance International (NSE Emerge) anchor allocation report', () => {
  it('reads all 6 investor rows and is NOT refused', () => {
    const result = parseAnchorReport(PAGES);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error((result as { ok: false; reason: string }).reason);
    expect(result.value.rows).toHaveLength(ORACLE.investors);
  });

  it('derives the true bid price (127), not a decimal-paise misread', () => {
    const result = parseAnchorReport(PAGES);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.bidPrice).toBe(ORACLE.bidPrice);
  });

  it('sums shares and amount to the letter totals', () => {
    const result = parseAnchorReport(PAGES);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.totalShares).toBe(ORACLE.totalShares);
    expect(result.value.totalAmountRupees).toBe(ORACLE.totalAmountRupees);
  });

  it('passes both independent cross-checks', () => {
    const result = parseAnchorReport(PAGES);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.percentageCheckPassed).toBe(true);
    expect(result.value.sharesTimesPriceCheckPassed).toBe(true);
  });

  it('reads the printed TOTAL row and it agrees with the summed rows', () => {
    const result = parseAnchorReport(PAGES);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.printedTotalShares).toBe(ORACLE.totalShares);
    expect(result.value.printedTotalAmountRupees).toBe(ORACLE.totalAmountRupees);
  });

  it('reads every investor name cleanly - this letter is a text PDF, not an OCR scan', () => {
    const result = parseAnchorReport(PAGES);
    if (!result.ok) throw new Error(result.reason);
    const names = result.value.rows.map((r) => r.name).sort();
    expect(names).toEqual(
      [
        'Bharat Venture Opportunities Fund',
        'Carnelian AIF Category I Trust-Scheme 1',
        'Hem Growth Opportunities Fund',
        'Finavenue Capital Trust - Finavenue Growth Fund',
        '360 ONE LVF Treasury Solutions Fund',
        'Tattvam AIF Trust -Aanjay Ageless AIF Fund',
      ].sort()
    );
  });
});
