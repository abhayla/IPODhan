/**
 * W-170: three real NSE Emerge anchor letters, downloaded from
 * `nsearchives.nseindia.com` and run through `anchor_report_text.py`
 * (Shanti Inorganics, Ashutosh Fibre) or its OCR full-page-rebuild path
 * (Qualiance — see anchor_report_text.py's `ocr_full_page_rows`), captured
 * verbatim into the fixtures alongside this file (the PDFs themselves are
 * never committed, per `.scratch/` in .gitignore).
 *
 * Root causes fixed here (see anchor-report-parser.ts for the code):
 *  - Shanti Inorganics: the letter's amount cell carries NO price digits at
 *    all (the price is stated only in prose, "at ₹83 per share") -
 *    `splitPriceAndAmount`'s `k >= 3` floor never tried the correct cut
 *    (k = 0, "the whole cell is the amount"), so every row's derivation
 *    failed and the letter refused with "no bid price could be derived".
 *  - Ashutosh Fibre: the per-row cell carries a genuine 2-digit price prefix
 *    ("92 6,00,57,600"), which the same `k >= 3` floor also excluded — the
 *    modal price fell back to a decoy split (12.13) that happened to agree
 *    across two rows by coincidence, not derivation.
 *  - Ashutosh Fibre (second, independent bug): the letter's Total row prints
 *    with a BLANK name cell, so `totalAt` detection (which looked for a name
 *    starting "Total") missed it; the Total row then parsed as a 6th investor
 *    row, doubling every summed total and halving every percentage.
 *  - Qualiance: the stored PDF has NO text layer at all (0 pdfplumber chars,
 *    one full-page image per page) — a genuinely scanned letter, not a
 *    detection bug. `anchor_report_text.py`'s `ocr_full_page_rows` rebuilds
 *    the table from OCR word boxes when the text layer is completely empty.
 *
 * Oracle numbers below are hand-read from the letters' own printed prose/
 * Total row (Shanti, Ashutosh) or from the W-132 fixture's transcription
 * (Qualiance) — never re-derived from the code under test.
 */
import { describe, it, expect } from 'vitest';
import {
  parseAnchorReport,
  ROW_ERROR_FLOOR,
  parsePrintedBidPrice,
  amountMatchesPrice,
} from '../../../src/scrapers/anchor-report-parser';
import shanti from '../../fixtures/sme/shanti-inorganics-anchor-report-text.json';
import ashutosh from '../../fixtures/sme/ashutosh-fibre-anchor-report-text.json';
import qualianceOcr from '../../fixtures/sme/qualiance-anchor-report-ocr-text.json';

describe('parseAnchorReport - Shanti Inorganics (NSE Emerge, price stated only in prose)', () => {
  const ORACLE = { investors: 5, bidPrice: 83, totalShares: 1619200, totalAmountRupees: 134393600 };

  it('is not refused, and derives the price from row arithmetic (never guessed at 20.71)', () => {
    const result = parseAnchorReport(shanti.pages);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.bidPrice).toBe(ORACLE.bidPrice);
    expect(result.value.rows).toHaveLength(ORACLE.investors);
  });

  it('sums shares and amount to the letter totals', () => {
    const result = parseAnchorReport(shanti.pages);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.totalShares).toBe(ORACLE.totalShares);
    expect(result.value.totalAmountRupees).toBe(ORACLE.totalAmountRupees);
  });
});

describe('parseAnchorReport - Ashutosh Fibre (NSE Emerge, 2-digit price prefix + blank Total-row name)', () => {
  const ORACLE = { investors: 5, bidPrice: 92, totalShares: 1743600, totalAmountRupees: 160411200 };

  it('is not refused, and does not land on the 12.13 decoy price', () => {
    const result = parseAnchorReport(ashutosh.pages);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.bidPrice).toBe(ORACLE.bidPrice);
    expect(result.value.rows).toHaveLength(ORACLE.investors);
  });

  it('does not double-count the blank-named Total row as a 6th investor', () => {
    const result = parseAnchorReport(ashutosh.pages);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.totalShares).toBe(ORACLE.totalShares);
    expect(result.value.totalAmountRupees).toBe(ORACLE.totalAmountRupees);
    expect(result.value.percentageCheckPassed).toBe(true);
  });
});

describe('anchor_report_text.py OCR full-page rebuild - Qualiance (genuinely scanned, no text layer)', () => {
  it('recovers all 6 investor rows and the printed bid price from OCR alone', () => {
    const rows = qualianceOcr.pages[0]
      .split('\n')
      .filter((line: string) => /^#\s*\d/.test(line));
    expect(rows).toHaveLength(6);
    expect(qualianceOcr.pages[0]).toContain('127');
  });

  it(
    'STILL NOT FULLY PARSED (known residual gap): this OCR run drops row 5\'s ' +
      'percent cell, which readRow requires to locate the row at all - the row ' +
      'is silently omitted rather than skip-counted, so percentages compute ' +
      'against 5 rows instead of 6 and the cross-check fails',
    () => {
      const result = parseAnchorReport(qualianceOcr.pages);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.percentageCheckPassed).toBe(false);
      // sharesTimesPriceCheckPassed IS true: the 5 rows that DID read agree
      // with each other and with the derived price 127 - the gap is a missing
      // row, not a price-derivation bug.
      expect(result.sharesTimesPriceCheckPassed).toBe(true);
    }
  );
});

describe('parseAnchorReport - row-error skip (W-170)', () => {
  // A hand-built 4-row letter at price 100: three rows agree, one row's
  // amount cell is corrupted down to a single digit - too few digits for
  // `splitPriceAndAmount` to derive anything (guaranteed zero splits,
  // regardless of how the digit maps), standing in for a scan/OCR cell that
  // lost most of its characters.
  const PAGE = [
    '# 1 | Alpha Fund | 1,000 | 25.00% | 1,00,000',
    '# 2 | Beta Fund | 1,000 | 25.00% | 1,00,000',
    '# 3 | Gamma Fund | 1,000 | 25.00% | 1,00,000',
    '# 4 | Delta Fund | 1,000 | 25.00% | 5',
    '#  | Total | 4,000 | 100.00% | 4,00,000',
  ].join('\n');

  it('skips one corrupted row (25% of 4, under the 30% floor) instead of refusing the letter', () => {
    expect(ROW_ERROR_FLOOR).toBe(0.3);
    const result = parseAnchorReport([PAGE]);
    // 3 clean rows pass MIN_ROWS and the 25% skip rate is under the floor -
    // the letter parses with 3 rows, not 0.
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.rows).toHaveLength(3);
    expect(result.value.bidPrice).toBe(100);
  });

  it('refuses the letter when skipped rows cross the 30% floor', () => {
    const twoBad = [
      '# 1 | Alpha Fund | 1,000 | 50.00% | 1,00,000',
      '# 2 | Beta Fund | 1,000 | 50.00% | 1',
      '# 3 | Gamma Fund | 1,000 | 50.00% | 2',
    ].join('\n');
    const result = parseAnchorReport([twoBad]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/disagreed with the derived bid price/);
  });

  it('exposes rowErrors and rowsRead on the parsed value (round 2, Hole 1)', () => {
    const result = parseAnchorReport([PAGE]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.rowErrors).toBe(1);
    expect(result.value.rowsRead).toBe(3);
  });

  it('refuses at EXACTLY the 30% floor, not just over it (round 2: > became >=)', () => {
    // 10 rows, 3 bad = exactly 30%.
    const good = Array.from({ length: 7 }, (_, i) => `# ${i + 1} | Fund ${i + 1} | 1,000 | 10.00% | 1,00,000`);
    const bad = Array.from({ length: 3 }, (_, i) => `# ${i + 8} | Fund ${i + 8} | 1,000 | 10.00% | 1`);
    const result = parseAnchorReport([[...good, ...bad].join('\n')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/disagreed with the derived bid price/);
  });
});

describe('parseAnchorReport - prose bid price is a REAL fallback, not dead code (round 2, Hole 2)', () => {
  // Shanti-shaped: amount-only trailing cells (no price digits mixed in,
  // consistent with the real Shanti Inorganics letter). Every row's own
  // amount cell has been damaged down to a single digit - too few digits
  // (< 3) for the shared digit-cut search either function uses, so NEITHER
  // `splitPriceAndAmount` (row-derived) NOR `amountMatchesPrice` (prose
  // fallback) can recover an amount from any row - modalPrice returns null
  // (there is nothing in [MIN_PRICE, MAX_PRICE] to be modal OVER), and the
  // ONLY source left for a bid price at all is the letter's own prose ("at
  // Rs 83 per share").
  const PAGE = [
    'Anchor Investors have been allocated at Rs 83 per share.',
    '# 1 | Investor A | 4,81,600 | 29.74% | 3',
    '# 2 | Investor B | 1,21,600 | 7.51% | 8',
  ].join('\n');

  it('is reached (price derived from prose), not "no bid price could be derived" (that would mean the fallback never even fired)', () => {
    const result = parseAnchorReport([PAGE]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Every row's amount is unrecoverable either way, so the letter still
    // refuses (correctly - there is genuinely no reconcilable data) - but
    // the reason names 83, proving `price` reached that value via
    // `parsePrintedBidPrice`, not that no derivation was attempted at all.
    expect(result.reason).not.toBe('no bid price could be derived from the investor rows');
    expect(result.reason).toContain('83');
  });

  it('parsePrintedBidPrice reads the prose price directly', () => {
    expect(parsePrintedBidPrice(PAGE)).toBe(83);
  });

  it('amountMatchesPrice recovers a row the bound-only split search would also find (round-2 unification), proving the fallback and the row-derived path now share one live function', () => {
    // 4,81,600 shares @ Rs 83 = Rs 3,99,72,800 - the real Shanti Inorganics
    // row 1, amount-only cell.
    expect(amountMatchesPrice('3,99,72,800', 481600, 83)).toBe(39972800);
    // A cell with no relationship to shares x price at all is correctly
    // rejected, not guessed at.
    expect(amountMatchesPrice('9,99,999', 481600, 83)).toBeNull();
  });
});

describe('parseAnchorReport - W-170b: a percent-bearing footnote AFTER the Total row must not demote it', () => {
  // Ashutosh Fibre's page 0 text, with one extra line inserted right after the
  // real (blank-named) Total row: a percent-bearing footnote/restated note
  // that has neither a name nor a genuine share count - the exact shape that
  // used to become the "last percent-bearing record" and make the real Total
  // fail `isLastPercentBearingRecord`.
  const TOTAL_LINE = '#  |  | 17,43,600 | 100.00% |  | 16,04,11,200';
  const FOOTNOTE_LINE = '#  |  | Note | 60.00%';
  const ORACLE = { investors: 5, bidPrice: 92, totalShares: 1743600, totalAmountRupees: 160411200 };

  function pageWithLineAfterTotal(extraLine: string): string {
    const lines = ashutosh.pages[0].split('\n');
    const totalIdx = lines.indexOf(TOTAL_LINE);
    if (totalIdx === -1) throw new Error('fixture Total line moved - update TOTAL_LINE');
    return [...lines.slice(0, totalIdx + 1), extraLine, ...lines.slice(totalIdx + 1)].join('\n');
  }

  it('still recognises the Total row (not counted as a 6th investor) when a blank-named, non-~100% footnote follows it', () => {
    const pages = [pageWithLineAfterTotal(FOOTNOTE_LINE), ashutosh.pages[1]];
    const result = parseAnchorReport(pages);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.bidPrice).toBe(ORACLE.bidPrice);
    expect(result.value.rows).toHaveLength(ORACLE.investors);
    expect(result.value.totalShares).toBe(ORACLE.totalShares);
    expect(result.value.totalAmountRupees).toBe(ORACLE.totalAmountRupees);
    expect(result.value.percentageCheckPassed).toBe(true);
  });

  it('negative case: a genuinely investor-shaped row (name + shares + percent) after the Total still leaves the Total unrecognised, same as before this fix', () => {
    // A real investor-shaped line (has a name AND a share count) after the
    // Total is NOT a footnote - it means the letter's structure is not what
    // `looksLikeTotalRow` assumes, so the guard still refuses to trust the
    // blank-named ~100% row as the Total (unchanged from the pre-W-170b
    // behaviour, which also rejected this shape via the old
    // "last percent-bearing record" rule for the same underlying reason:
    // an investor-shaped record follows it).
    const EXTRA_INVESTOR_LINE = '# 6 | EXTRA INVESTOR | 50,000 | 5.00% | 92 | 46,00,000';
    const pages = [pageWithLineAfterTotal(EXTRA_INVESTOR_LINE), ashutosh.pages[1]];
    const result = parseAnchorReport(pages);
    // The blank-named Total row is no longer recognised as the Total, so it
    // (and the extra trailing row) are read as ordinary investor rows -
    // `totalShares` no longer equals the letter's true total, proving the
    // Total was NOT correctly separated out (matching pre-fix behaviour for
    // this shape, not a new pass).
    if (result.ok) {
      expect(result.value.totalShares).not.toBe(ORACLE.totalShares);
    } else {
      expect(result.ok).toBe(false);
    }
  });
});

describe('parseAnchorReport - W-170c: a blank-named category subtotal BEFORE the real Total must not be picked as the Total', () => {
  // Ashutosh Fibre's page 0 text, with one extra line inserted right BEFORE
  // the real (blank-named) Total row: a blank-named ~100% category subtotal
  // (e.g. a "Mutual Funds" sub-block total) that carries no readable share
  // count of its own - the exact shape `looksLikeTotalRow` also accepts,
  // which used to make `totalAt` land on this row (the first match) instead
  // of the real Total further down, truncating `main` at the wrong point.
  const TOTAL_LINE = '#  |  | 17,43,600 | 100.00% |  | 16,04,11,200';
  const MF_SUBTOTAL_LINE = '#  |  | Mutual Funds | 100.00%';
  const ORACLE = { investors: 5, bidPrice: 92, totalShares: 1743600, totalAmountRupees: 160411200 };

  function pageWithSubtotalBeforeTotal(): string {
    const lines = ashutosh.pages[0].split('\n');
    const totalIdx = lines.indexOf(TOTAL_LINE);
    if (totalIdx === -1) throw new Error('fixture Total line moved - update TOTAL_LINE');
    return [...lines.slice(0, totalIdx), MF_SUBTOTAL_LINE, ...lines.slice(totalIdx)].join('\n');
  }

  it('recognises the real Total row (corroborated by the investor sum), not the earlier blank-named subtotal', () => {
    const pages = [pageWithSubtotalBeforeTotal(), ashutosh.pages[1]];
    const result = parseAnchorReport(pages);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.bidPrice).toBe(ORACLE.bidPrice);
    expect(result.value.rows).toHaveLength(ORACLE.investors);
    expect(result.value.totalShares).toBe(ORACLE.totalShares);
    expect(result.value.totalAmountRupees).toBe(ORACLE.totalAmountRupees);
    expect(result.value.percentageCheckPassed).toBe(true);
    // Only the REAL Total row's printed figures corroborate here - proof the
    // parser did not stop at the earlier subtotal.
    expect(result.value.printedTotalShares).toBe(ORACLE.totalShares);
    expect(result.value.printedTotalAmountRupees).toBe(ORACLE.totalAmountRupees);
  });
});
