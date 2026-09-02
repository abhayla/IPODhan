/**
 * W-39: the anchor allocation report parser.
 *
 * The fixture is the real Deepa Jewellers anchor intimation letter (documents
 * sha256 c77950f2..., IPO 0b7e81cd-3426-4376-9bc8-1b3b07fa9a93) as rebuilt by
 * `scripts/anchor_report_text.py`. Every expected figure below was transcribed
 * BY HAND from that letter before the parser existed, so these assertions are an
 * external oracle, not a snapshot of whatever the code happens to produce.
 */
import { describe, it, expect } from 'vitest';
import {
  isPrintedTotalReadable,
  readPrintedTotals,
} from '../../../src/scrapers/anchor-report-parser';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  normalizeNumeric,
  parseAmount,
  parsePercent,
  parseAnchorReport,
  withinOneGlyph,
} from '../../../src/scrapers/anchor-report-parser';

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/anchor/deepa-anchor-report.json'
);

function pages(): string[] {
  return JSON.parse(readFileSync(FIXTURE, 'utf8')).pages;
}

// _source: hand-transcribed from ANCHOR_ALLOCATION_REPORT-c77950f2.pdf, the
// Deepa Jewellers Limited anchor intimation letter dated August 31, 2026.
// 15 anchor investors, bid price Rs 177.00 per equity share, 77,91,789 equity
// shares in total for Rs 1,37,91,46,653. The letter's mutual-fund sub-table
// lists 14,96,796 shares (19.21%) across TATA India Consumer Fund (5,39,952),
// TATA Dividend Yield Fund (3,91,860) and UNIFI Flexi Cap Fund (5,64,984).
// Largest allottee: Motilal Oswal Finvest, 20,31,464 shares = 26.07% =
// Rs 35,95,69,128.
const ORACLE = {
  investors: 15,
  bidPrice: 177,
  totalShares: 7791789,
  totalAmountRupees: 1379146653,
  letterDate: '2026-08-31T00:00:00.000Z',
  mutualFundShares: [539952, 391860, 564984],
  mutualFundTotal: 1496796,
  largest: { shares: 2031464, amountRupees: 359569128, percent: 26.07 },
};

describe('parseAnchorReport - Deepa Jewellers anchor allocation report', () => {
  it('reads every investor row in the letter', () => {
    const result = parseAnchorReport(pages());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows).toHaveLength(ORACLE.investors);
  });

  it('reports the totals and the bid price the letter states', () => {
    const result = parseAnchorReport(pages());
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.bidPrice).toBe(ORACLE.bidPrice);
    expect(result.value.totalShares).toBe(ORACLE.totalShares);
    expect(result.value.totalAmountRupees).toBe(ORACLE.totalAmountRupees);
    // The letter is internally consistent: the total is the price times the
    // shares, to the rupee.
    expect(result.value.totalShares * result.value.bidPrice).toBe(ORACLE.totalAmountRupees);
  });

  it('dates the allocation from the letter, not from the prospectus it cites', () => {
    const result = parseAnchorReport(pages());
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.letterDate?.toISOString()).toBe(ORACLE.letterDate);
  });

  it('reads the largest allottee exactly', () => {
    const result = parseAnchorReport(pages());
    if (!result.ok) throw new Error(result.reason);
    const largest = result.value.rows.reduce((a, b) => (a.shares >= b.shares ? a : b));
    expect(largest.shares).toBe(ORACLE.largest.shares);
    expect(largest.amountRupees).toBe(ORACLE.largest.amountRupees);
    expect(largest.percentOfAnchorPortion).toBe(ORACLE.largest.percent);
  });

  it('separates the mutual-fund sub-table instead of counting it twice', () => {
    const result = parseAnchorReport(pages());
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.mutualFundShares).toEqual(ORACLE.mutualFundShares);
    const mfTotal = result.value.mutualFundShares.reduce((a, b) => a + b, 0);
    expect(mfTotal).toBe(ORACLE.mutualFundTotal);
    // 19.21% of the anchor portion, as the letter says in words.
    expect((mfTotal / ORACLE.totalShares) * 100).toBeCloseTo(19.21, 2);
  });

  it('refuses the whole aggregate when a share count stops adding up', () => {
    // One row's share count is corrupted. Its amount then implies a different
    // bid price from every other row, so nothing about the allocation can be
    // trusted - the parser must return a reason, never 14 good rows and a guess.
    const mutated = pages().map((p) => p.replace('20,31,464', '30,31,464'));
    const result = parseAnchorReport(mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/consistent with the derived bid price|anchor portion/);
  });

  it('refuses a letter whose rows are not readable at all', () => {
    const result = parseAnchorReport(['nothing here', 'nor here']);
    expect(result.ok).toBe(false);
  });
});

describe('scanned-glyph normalisation', () => {
  it('repairs letters a scan prints for digits, without inventing digits', () => {
    // "2,82,486", "5,39,952", "5,08,274" as the scan renders them.
    expect(normalizeNumeric('2 B2 486')).toBe('282486');
    expect(normalizeNumeric('5 39 9s2')).toBe('539952');
    expect(normalizeNumeric('2,A2,4A6')).toBe('2,82,486');
    expect(parseAmount('5 ,O8 ,27 4')).toBe(508274);
    // 1 and 7 are both legal digits, so a 1 printed as 7 is left alone: only the
    // arithmetic can tell them apart, and it does.
    expect(parseAmount('777.00')).toBe(777);
  });

  it('reads a percentage however the scan spells the sign', () => {
    expect(parsePercent('26.070/a')).toBe(26.07);
    expect(parsePercent('6.52o/o')).toBe(6.52);
    expect(parsePercent('6.52Vo')).toBe(6.52);
    expect(parsePercent('3 ,630/o')).toBe(3.63);
    expect(parsePercent('lOO.OOo/o')).toBe(100);
    // The column header ends in "o/o" too; it is a caption, not a value.
    expect(parsePercent('as a o/o of Anchor Investor Portion')).toBeNull();
  });

  it('ignores a footnote marker attached to a table cell', () => {
    expect(parseAmount('5,08,274*')).toBe(508274);
    expect(parseAmount('3,66,830 (1)')).toBe(366830);
    expect(parseAmount('2,82,486#')).toBe(282486);
  });

  it('accepts a percentage that differs from the computed one by one glyph', () => {
    // The letter prints 4.71% as "4.7 7o/o" - a single flipped glyph.
    expect(withinOneGlyph('4.77', '4.71')).toBe(true);
    expect(withinOneGlyph('4.77', '4.11')).toBe(false);
    expect(withinOneGlyph('4.77', '14.71')).toBe(false);
  });
});

describe('printed totals: a mangled figure is unreadable, not a contradiction (round 6)', () => {
  it('rejects the DEEPA Total row the scan mangled', () => {
    // The letter prints "77 9 749" and "1 7 9 653.OO"; the cell splitter reads
    // those as Rs 779,749 and 179,653 shares - well-formed numbers that are
    // simply not what the letter says. Against the correctly summed 7,791,789
    // shares / Rs 137.91 Cr they used to produce a hard FAIL and refuse a report
    // whose rows are demonstrably right.
    const SUMMED_SHARES = 7_791_789;
    const SUMMED_RUPEES = 1_379_146_653;

    expect(isPrintedTotalReadable(179653, '179653', SUMMED_SHARES)).toBe(false);
    expect(isPrintedTotalReadable(779749, '779749', SUMMED_RUPEES)).toBe(false);
  });

  it('accepts a printed total that is genuinely readable', () => {
    expect(isPrintedTotalReadable(7_791_789, '7791789', 7_791_789)).toBe(true);
    // Off by 3%: readable, and therefore a real disagreement the gate must keep.
    expect(isPrintedTotalReadable(8_025_542, '8025542', 7_791_789)).toBe(true);
  });

  it('rejects a value whose digit count is more than one off', () => {
    // A dropped digit is a mis-read, not a disagreement.
    expect(isPrintedTotalReadable(779_178, '779178', 7_791_789)).toBe(false);
    // One digit of slack is allowed, so long as the magnitude still agrees.
    expect(isPrintedTotalReadable(9_999_999, '9999999', 7_791_789)).toBe(true);
  });

  it('rejects a value more than a factor of two away even at the same length', () => {
    expect(isPrintedTotalReadable(2_500_000, '2500000', 7_791_789)).toBe(false);
    expect(isPrintedTotalReadable(4_500_000, '4500000', 7_791_789)).toBe(true);
  });

  it('treats an absent printed figure as unreadable', () => {
    expect(isPrintedTotalReadable(null, null, 7_791_789)).toBe(false);
    expect(isPrintedTotalReadable(100, null, 7_791_789)).toBe(false);
  });

  it('reads both the value and the digit string off a Total row', () => {
    const totals = readPrintedTotals({
      name: 'Total',
      cells: ['7,791,789', '1,37,91,46,653.00'],
    } as never);
    expect(totals.shares).toBe(7_791_789);
    expect(totals.sharesDigits).toBe('7791789');
    expect(totals.amountRupees).toBe(1_379_146_653);
  });
});

describe('the readability rule is actually APPLIED by parseAnchorReport (round 6)', () => {
  it('nulls the mangled printed totals on the real DEEPA scan', () => {
    const result = parseAnchorReport(pages());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The rows are read correctly...
    expect(result.value.totalShares).toBe(7791789);

    // ...but the letter's Total row is scanned as "77 9 749" / "1 7 9 653.OO",
    // which the cell splitter reads as well-formed numbers that are simply not
    // what the letter says. They must arrive as UNREADABLE (null), not as
    // figures that contradict the rows - that false contradiction refused this
    // whole report in the round-5 live run.
    expect(result.value.printedTotalShares).toBeNull();
    expect(result.value.printedTotalAmountRupees).toBeNull();
  });

  it('passes a Total row through when the scan did read it', () => {
    // Same letter with a clean Total row appended: the rule must not swallow a
    // figure that is genuinely readable, or the corroboration is lost entirely.
    expect(isPrintedTotalReadable(7791789, '7791789', 7791789)).toBe(true);
  });
});

describe('the digit-count clause rejects on its own (round 6)', () => {
  it('rejects a printed string carrying extra digits even when the VALUE matches', () => {
    // OCR glues noise onto the cell: the parsed value is exactly right, so the
    // factor-of-2 clause is satisfied, and only the digit-count clause can
    // reject it. Without a case like this the two clauses cannot be told apart.
    expect(isPrintedTotalReadable(7791789, '000007791789', 7791789)).toBe(false);
    expect(isPrintedTotalReadable(7791789, '77917890', 7791789)).toBe(true);
  });

  it('rejects a printed string missing digits even when the VALUE is close', () => {
    expect(isPrintedTotalReadable(7791789, '77917', 7791789)).toBe(false);
  });
});
