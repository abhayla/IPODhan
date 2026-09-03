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

describe('the cross-check flags are COMPUTED, not asserted (MAJOR-3)', () => {
  it('reports percentageCheckPassed:false from the PARSER on a mismatched fixture', () => {
    // Damage ONE printed percentage so the row no longer matches its share of
    // the total. The flag must come back false from the parser itself - it used
    // to be written into the result as the literal `true`, which made the
    // persister's corroboration rule a tautology.
    const damaged = pages().map((p) => p.replace('26.07', '96.07'));
    const result = parseAnchorReport(damaged);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.percentageCheckPassed).toBe(false);
    // The other check is independent and still passes - the flags are separate
    // results, not one verdict copied twice.
    expect(result.sharesTimesPriceCheckPassed).toBe(true);
  });

  it('reports both flags true on the clean fixture', () => {
    const result = parseAnchorReport(pages());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.percentageCheckPassed).toBe(true);
    expect(result.value.sharesTimesPriceCheckPassed).toBe(true);
  });
});

/**
 * W-81 - investor names inside a WRAPPING name cell must come back in reading
 * order. VERBATIM excerpt of `scripts/anchor_report_text.py` output for the
 * DEEPA letter (documents sha256 c77950f2...), pages 1-2, AFTER the reading-order
 * fix. The glyph damage ("N4" for M, "]" for I) is the PDF's own embedded OCR
 * text layer and is deliberately kept as-is: this test locks the ORDER of the
 * words, not their spelling - repairing spelling is the persister's name-quality
 * gate (`NAME_QUALITY_FLOOR`), never a guess made here.
 *
 * Before the fix the same cells came back sorted by (top, x0) across a skewed
 * two-line cell, which interleaved the lines:
 *   "OSWAL OT] LAL FINVEST N4 LI I\\4ITE D"   (Motilal Oswal Finvest Limited)
 *   "CAPITAL WH]TEOAK EQUITY FUND"          (WhiteOak Capital Equity Fund)
 *   "CAPITAL CP LTD"                        (CP Capital Ltd)
 */
const W81_PAGES: string[] = [
  "DEEPA IEWELLERS LIMITED\n#  | (Formerly | known as | Jewellers | Pvt. Ltd')\n#  | Add: 3-6-343, Basheer | Bagh Main | Hyderabad | - 500 029' Telangana\n#  | CIN: | U74999TG201 | 6PLC1 | 09435\n#  | Is d ch II | n P | e | L d\n#  | Board of Directors of the.company- at | its meeting | on August | 31, 2026, in consultation with the\n#  | running capjtar lead private managers Limired. to (together, the oifer,Jla-\"rv, | e-.riv | crobal | \n#  |  | Book iLr.iigi | Lead | Financial services Limited and valmjki\n#  | to Anchor Invesrors at Anchor | Investor | price | as.- tzi' pir have \"r,..\"'in finarized the aIocation fo|owing\n#  |  | No. of | Sha res | Bid Price\n#  | Name of Anchor Investor | Equity |  | ( Rs, per Total Amount\n#  |  | Shares | a o/o | Equity Allocation (Rs.)\n#  |  | Allocated | Anchor | Share)\n# 1 | N4 OT] LAL OSWAL FINVEST LI I\\4ITE D | 20,31,464 | 26.070/a | 777.00 3s,9s,69,128.00\n# 2 | WH]TEOAK CAPITAL EQUITY FUND | 5,08,273 | 6.52o/o | 177 .00 8,99,64,321.00\n# 3 | OPPO 360 RTUNITIES ONE FUND - SERIES EQUITY 2 | 5,Oa,274 | 6.52Vo | 1,77.00 8,99,64,498.00\n# 4 |  | 5 39 9s2 | 6.93o/o | L77 .O0 9 55 7l 504.00\n# 5 | TAT TATA UNIFI I D N I MUTUAL D I I D A EN C o D N Y S FUND I U ELD N4 ER F U FU N N D UNIFI D | 3 91 860 | 5.03o/o | 777.00 6 93 59 220 .00\n# 6 | FLEXI CAP FUND | 5,64,984 | 7 .25o/o | 177.00 10,00,02,168.00\n# 7 | CP CAPITAL LTD | 3 66 830 | 4.7 7o/o | 177.O0 6 49 2B 910.00\n# 8 | LRS D S EC U R I TI ES PVT LTD | 2 B2 486 | 3 ,630/o | 777.00 5 00 00 022.OO\n# 9 | [4AYBANK SECURITIES PTE LTD . ODI | 3,66,830 | 4.7 7o/o | 777.00 6,49,28,gt].oo\n# 10 | MAURITIUS PRIVATE LI c L | 2,82,486 | 3 .630/o | 777,00 5,00,00,022.00\n#  | lN: | 36AAFCD6847E1ZK |  | \n#  | +91 8341022117,8 I Email: | info@deepajewel.com; |  | accounts@deepajewel.com",
  "No of\nEquity\n#  |  | No. of | Shares Equity | Bid Price\n#  | Name of Anchor Investor | Equity | allocated | (Rs. per Total Amount\n#  |  | Shales | as a o/o | Equity Allocation (Rs.)\n#  |  | Allocated | Anchor | Share)\n# 11 | GIR EQUITY N o N4 IK U RA FUND- S MULTICAP I N GA III PO RE - INVESTIYENT t_I [4 GROWTH ITE D | 2 B2 486 | 3 .630/o | 177.O0 5 00 00 022,00\n# 12 | ACCOU NT | 3,66,830 | 4.71o/o | 777 .OO 6,49,28,910.OO\n# 13 | ALCHEMY LONG TERNl VENI-URES ASHOKA FUND SERIES INDIA 3 EQUITY | 2,A2,4A6 | 3.630/o | i77 .OO 5,0 0,0 0,0 2 2. 0 0\n# 74 | INVESTMENT HIGH CONVICTION TRUST PLC FUND | 5 ,O8 ,27 4 | 6 ,52o/o | 177 .00 8,99,64,498.00\n# 15 | SERIES 1 | 5,08,274 | 6,52o/o | 177.O0 8,99,64,498.00\n#  | Total | 77 9 749 | lOO.OOo/o | 1 7 9 653.OO\n#  | of the total allocation 77.,97,7ag Equity | shares | Anchor | Investor, 74,96,796 Equity shares\n#  | 19'21olo of the total illocation io | anchor |  | allocated to two domestic mutual\n#  | which have appried through a totar | of three |  | Nir alocated were made to Life\n#  | companies and peniion fund, | detairs of | are | in the tabre berow:\n#  |  | No. of | Sha Eq | Bid\n#  | Name of Mutual Fund Scheme | Equity | allocated | \n#  |  | Sha res | as a | of (Rs. Equity Price per Allocation Total Amount (Rs.)\n#  |  | Allocated | Anchor | Sha re)\n# 1 | TATA TATA I DIVIDEND N D I o N YIELD SU I\\4 ER FUND FU N D | 5,39,952 | 6 ,930/0 | t77.OO 9 55 71- 504.00\n#  |  | 3,91\",860 | 5.030/a | t77 .00 6,93,59,220.O0\n# 3 | U i\\]I F] I\\,]UTUAL FUND - UNIFI FLEXI CAP FUND | 5,64,984 | 7 .25o/o | t77.OO 10,00,02,168,00\n#  | Total | t4 9 796 |  | 26 3 892,OO\n#  | the securities and Exchange Board | of India | of | and Disclosure Requirement)\n#  | 2018, as amended, in case the | onei priie | aiscovered | through book building process is\n#  | than the Anchor investor Allocation | price, nncrroilnvestors |  | be required to pay the difference\n#  | Anchor investor pay-in Date as specified | in ifie | CeN. | \n#  | as per the securities and Excha.nge | Board | of India | (Issue of capital and Disclosure\n#  | Regulations, 2018, as amended, 10 and all relevant sub-ilauses. | irom time | to time, | shall abide by schedule XIII, part",
];

describe('anchor-report-parser - wrapping name cells read in order (W-81)', () => {
  it('keeps each printed line of a name intact instead of interleaving them', () => {
    const result = parseAnchorReport(W81_PAGES);
    if (!result.ok) throw new Error(result.reason);
    const names = result.value.rows.map((r) => r.name);

    expect(names).toContain('N4 OT] LAL OSWAL FINVEST LI I\\4ITE D');
    expect(names).toContain('WH]TEOAK CAPITAL EQUITY FUND');
    expect(names).toContain('CP CAPITAL LTD');
    expect(names).toContain('[4AYBANK SECURITIES PTE LTD . ODI');

    // The pre-fix interleavings must not come back.
    expect(names).not.toContain('OSWAL OT] LAL FINVEST N4 LI I\\4ITE D');
    expect(names).not.toContain('CAPITAL WH]TEOAK EQUITY FUND');
    expect(names).not.toContain('CAPITAL CP LTD');
  });

  it('still reads the arithmetic off the same excerpt', () => {
    const result = parseAnchorReport(W81_PAGES);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.rows.length).toBe(15);
    expect(result.value.bidPrice).toBe(177);
    expect(result.value.totalShares).toBe(
      result.value.rows.reduce((t, r) => t + r.shares, 0)
    );
  });
});
