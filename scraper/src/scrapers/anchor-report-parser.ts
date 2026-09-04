/**
 * Parser for the exchange ANCHOR_ALLOCATION_REPORT ("Anchor Intimation letter").
 *
 * WHY THIS EXISTS (W-39). `anchor-investors-scraper.ts` used to look for a DRHP.
 * A DRHP cannot contain anchor investors: anchors are allotted on T-1 and the
 * names are published the same day in this letter (NSE "Anchor Allocation
 * Report", BSE "Anchor_Details"). The scraper was therefore structurally
 * incapable of ever returning data, and never did.
 *
 * The letter is filed as a SCAN. `scripts/anchor_report_text.py` rebuilds its
 * table from word coordinates; this module reads those rows. Two consequences
 * shape everything below:
 *
 *  1. Glyph damage. The text layer renders 1 as 7, 5 as s, 8 as B or a, 0 as O,
 *     9 as g, % as "o/o". Digit-shaped damage (1 vs 7) cannot be repaired by
 *     substitution, so nothing here trusts a printed number on its own.
 *  2. Arithmetic is the oracle. Every row satisfies amount = shares x price with
 *     ONE price for the whole allocation, so the price is derived from the rows
 *     and every row is then re-checked against it. A row that cannot be made to
 *     agree is not guessed at - the whole aggregate returns null with a reason.
 */

/** One anchor investor as printed in the letter. */
export interface AnchorReportRow {
  name: string;
  shares: number;
  /** Rupees, not crores - the caller converts. */
  amountRupees: number;
  /** Percentage of the anchor portion, as printed. */
  percentOfAnchorPortion: number;
}

export interface AnchorReportParse {
  rows: AnchorReportRow[];
  /** Bid price per equity share, derived from the rows (never the printed one). */
  bidPrice: number;
  totalShares: number;
  totalAmountRupees: number;
  /** Share counts that the letter's mutual-fund sub-table repeats. */
  mutualFundShares: number[];
  letterDate: Date | null;

  // ---------------------------------------------------------------- printed
  // The letter's OWN "Total" row and prose, read INDEPENDENTLY of the investor
  // rows. `totalShares`/`totalAmountRupees` above are SUMS of the rows, so
  // comparing the two is a real reconciliation; comparing a sum against itself
  // (which the round-3 gates did) proves nothing. Any of these is null when the
  // scan left it unreadable — a null means "not checkable", never "agrees".
  /** Share count printed on the letter's Total row. */
  printedTotalShares: number | null;
  /** Total allocation in RUPEES printed on the letter's Total row. */
  printedTotalAmountRupees: number | null;
  /** Investor count stated in the letter's prose ("15 anchor investors"). */
  printedCount: number | null;

  // -------------------------------------------------- independent-check flags
  // COMPUTED, not asserted. Both are necessarily true on this branch (either
  // failing returns ok:false, and the failure branch carries the real flags
  // too), but they are computed from the rows rather than written as literals:
  // the persister's corroboration rule reads them, and a rule that reads two
  // constants is a tautology, not a check.
  /** Each row's printed % matched its share of the summed total, and the printed percentages summed to 100. */
  percentageCheckPassed: boolean;
  /** The summed amounts matched summed shares x the derived bid price. */
  sharesTimesPriceCheckPassed: boolean;
}

export type AnchorReportResult =
  | { ok: true; value: AnchorReportParse }
  | {
      ok: false;
      reason: string;
      /**
       * The two cross-check results, reported on the FAILURE branch too. They
       * are what the persister's corroboration rule reads, so they must be the
       * real outcomes; a caller (and a test) can see which check actually failed
       * rather than inferring it from the prose reason.
       */
      percentageCheckPassed?: boolean;
      sharesTimesPriceCheckPassed?: boolean;
    };

/** Plausible per-share price band for an Indian IPO, in rupees. */
const MIN_PRICE = 5;
const MAX_PRICE = 50000;
/** A row's amount must agree with shares x derived price to this fraction. */
export const PRICE_TOLERANCE = 0.005;
/** Percentages must add up to 100 within this many points. */
const PERCENT_SUM_TOLERANCE = 1;
const MIN_ROWS = 2;
/** Longest a percentage cell can be before it is prose, not a value. */
const MAX_PERCENT_TEXT = 10;

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

/**
 * Repair the glyph damage that is unambiguous inside a NUMERIC cell.
 *
 * Only letters and punctuation that cannot legally appear in a number are
 * mapped, so this can never turn one digit into another - 1 vs 7 damage
 * survives on purpose and is caught by the arithmetic checks instead.
 */
export function normalizeNumeric(cell: string): string {
  return cell
    // A footnote marker is dropped BEFORE anything else: "(1)" would otherwise
    // leave a stray 1 glued to the share count.
    .replace(/\((\d{1,2})\)|\[\d{1,2}\]|[*#]/g, '')
    .replace(/[lLiI|]/g, '1')
    .replace(/[sS]/g, '5')
    .replace(/[bB]/g, '8')
    .replace(/[aA]/g, '8')
    .replace(/[oO\]]/g, '0')
    .replace(/[gG]/g, '9')
    .replace(/[tT]/g, '1')
    .replace(/[^\d.,]/g, '');
}

/** "26.070/a", "3 ,630/o", "6,52o/o", "lOO.OOo/o" -> 26.07, 3.63, 6.52, 100. */
export function parsePercent(cell: string): number | null {
  const marked = cell.replace(/[oO0]\s*\/\s*[oO0aA]|Vo/g, '%');
  if (!marked.includes('%')) return null;
  const digits = marked.slice(0, marked.indexOf('%')).trim();
  // A column HEADER also ends in "o/o" ("as a o/o of Anchor Investor Portion"),
  // and a caption normalises to some large nonsense number. A percentage is
  // short and lands in (0, 100] - which is also why the digits are not required
  // to be digits: the scan writes 100.00% as "lOO.OO".
  if (digits.length > MAX_PERCENT_TEXT) return null;
  const value = Number(normalizeNumeric(digits).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0 || value > 100) return null;
  return value;
}

/**
 * Read one numeric cell. Indian grouping is dropped; a trailing separator with
 * exactly two digits behind it is the decimal point, whichever glyph it is - a
 * scan renders "5,00,00,022.00" and "5,00,00,022,00" interchangeably.
 */
export function parseAmount(cell: string): number | null {
  const s = normalizeNumeric(cell);
  if (!/\d/.test(s)) return null;
  const decimal = s.match(/^(.*)[.,](\d{2})$/);
  const head = (decimal ? decimal[1] : s).replace(/[.,]/g, '');
  if (!head) return null;
  const value = Number(decimal ? head + '.' + decimal[2] : head);
  return Number.isFinite(value) ? value : null;
}

/** Digits only, in order - the raw material for splitting a price+amount cell. */
function digitsOf(cell: string): string {
  return normalizeNumeric(cell).replace(/[^\d]/g, '');
}

/**
 * Split a cell holding BOTH the bid price and the total amount.
 *
 * The two columns touch on a skewed scan, so the sidecar cannot always separate
 * them. Every split of the digit run is tried and each is scored by the price it
 * implies for the row's share count; the caller keeps the one consistent with
 * the rest of the letter. Returns the admissible (price, amount) pairs.
 *
 * Two amount SHAPES are tried at every split point k (W-132):
 *
 *  - DECIMAL: the mainboard scans print every amount with a literal ".00"
 *    suffix ("3s,9s,69,128.00"), which contributes two extra digit
 *    characters at the very end that are NOT part of the rupee value. The
 *    last two digits of the run are therefore treated as printed paise and
 *    dropped into a fractional part.
 *  - WHOLE: an NSE Emerge (SME) allocation letter prints the total in plain
 *    Indian-grouped rupees with no decimal at all ("3,26,39,000"). Chopping
 *    its last two digits as paise divides the real amount by 100 and no
 *    price in the letter ever reconciles, so the whole remaining digit run
 *    must also be tried as the amount, undivided.
 *
 * A spurious WHOLE-shaped read of a DECIMAL-shaped letter lands ~100x the
 * true price - MAX_PRICE bounds most of it, and where a decoy still slips
 * through, the derived price is a systematic 100x apart from the real one so
 * `modalPrice`'s lower-price tie-break and the row-level tolerance check
 * both still land on the true price (verified against the DEEPA fixture).
 */
export function splitPriceAndAmount(
  cell: string,
  shares: number
): Array<{ price: number; amount: number }> {
  const digits = digitsOf(cell);
  const out: Array<{ price: number; amount: number }> = [];
  for (let k = 3; k <= digits.length - 3; k++) {
    const decimalAmount = Number(digits.slice(k, -2) + '.' + digits.slice(-2));
    const wholeAmount = Number(digits.slice(k));
    for (const amount of [decimalAmount, wholeAmount]) {
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const price = amount / shares;
      if (price >= MIN_PRICE && price <= MAX_PRICE) out.push({ price, amount });
    }
  }
  return out;
}

/**
 * True when two printed numbers differ by at most one character.
 *
 * A percentage is checked against shares/total this way rather than by a numeric
 * tolerance: the only realistic corruption is a single flipped glyph (the letter
 * prints 4.71% as "4.7 7o/o"), and a one-character edit is a far tighter claim
 * than any tolerance wide enough to absorb it.
 */
export function withinOneGlyph(printed: string, expected: string): boolean {
  if (printed === expected) return true;
  if (printed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < printed.length; i++) {
    if (printed[i] !== expected[i]) diff++;
  }
  return diff <= 1;
}

/**
 * The date the letter was written, read from the FIRST page only.
 *
 * The last page cites the Red Herring Prospectus date, which is weeks earlier -
 * scanning the whole document would silently prefer whichever came first. The
 * separator class allows the column pipe the sidecar emits, because a scan can
 * place the month and the day in different cells of the letterhead.
 */
function parseLetterDate(firstPage: string): Date | null {
  const m = firstPage.match(
    /(January|February|March|April|May|June|July|August|September|October|November|December)[\s|]+(\d{1,2})[\s|]*,?[\s|]*(\d{4})/i
  );
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (month === undefined) return null;
  return new Date(Date.UTC(Number(m[3]), month, Number(m[2])));
}

interface RawRecord {
  name: string;
  cells: string[];
}

function records(pages: string[]): RawRecord[] {
  const out: RawRecord[] = [];
  for (const page of pages) {
    for (const line of page.split('\n')) {
      if (!line.startsWith('# ')) continue;
      const fields = line.slice(2).split('|').map((f) => f.trim());
      out.push({ name: fields[1] ?? '', cells: fields.slice(2) });
    }
  }
  return out;
}

interface Candidate {
  name: string;
  shares: number;
  percent: number;
  splits: Array<{ price: number; amount: number }>;
}

function readRow(rec: RawRecord): Candidate | null {
  const pctAt = rec.cells.findIndex((c) => parsePercent(c) !== null);
  if (pctAt <= 0) return null;
  const percent = parsePercent(rec.cells[pctAt]) as number;
  let shares: number | null = null;
  for (let i = pctAt - 1; i >= 0; i--) {
    // Count the digits the scan actually printed, before any repair: "Shares"
    // normalises to the number 5 and would otherwise pass for a share count.
    const printedDigits = (rec.cells[i].match(/\d/g) || []).length;
    if (printedDigits < 3) continue;
    const v = parseAmount(rec.cells[i]);
    if (v !== null && Number.isInteger(v) && v >= 1000) {
      shares = v;
      break;
    }
  }
  if (shares === null) return null;
  const tail = rec.cells.slice(pctAt + 1).join(' ');
  return { name: rec.name, shares, percent, splits: splitPriceAndAmount(tail, shares) };
}

/**
 * Read the letter's printed "Total" row: its share count and its total amount.
 *
 * The row has no percentage cell of its own in most letters, so `readRow`
 * cannot be reused. Cells run through the SAME confusable map as every other
 * number here (normalizeNumeric via parseAmount), so an OCR-damaged total is
 * still read where it can be read — and left null where it cannot, because a
 * guessed total would defeat the whole point of checking against it.
 *
 * Which cell is which: the share count is a whole number of at least four
 * printed digits; the amount is the largest remaining value that is not the
 * share count. A row that does not yield both leaves both null.
 */
export interface PrintedTotals {
  shares: number | null;
  amountRupees: number | null;
  /** The normalised digit string each value was parsed from, for the readability rule. */
  sharesDigits: string | null;
  amountDigits: string | null;
}

/** Digits only, after confusable normalisation and with separators dropped. */
function digitCountOf(cell: string): number {
  return normalizeNumeric(cell).replace(/[.,]/g, '').length;
}

export function readPrintedTotals(rec: RawRecord | undefined): PrintedTotals {
  const none: PrintedTotals = {
    shares: null,
    amountRupees: null,
    sharesDigits: null,
    amountDigits: null,
  };
  if (!rec) return none;
  const values: Array<{ value: number; digits: string }> = [];
  for (const cell of rec.cells) {
    const printedDigits = (cell.match(/\d/g) || []).length;
    if (printedDigits < 3) continue;
    const v = parseAmount(cell);
    if (v !== null && v > 0) {
      values.push({ value: v, digits: normalizeNumeric(cell).replace(/[.,]/g, '') });
    }
  }
  if (values.length === 0) return none;

  const shareLike = values.filter((c) => Number.isInteger(c.value) && c.value >= 1000);
  const sharesCell =
    shareLike.length > 0
      ? shareLike.reduce((a, b) => (b.value < a.value ? b : a))
      : null;
  const rest = sharesCell === null ? values : values.filter((c) => c !== sharesCell);
  const amountCell =
    rest.length > 0 ? rest.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  return {
    shares: sharesCell ? sharesCell.value : null,
    sharesDigits: sharesCell ? sharesCell.digits : null,
    amountRupees: amountCell ? amountCell.value : null,
    amountDigits: amountCell ? amountCell.digits : null,
  };
}

/**
 * Is a printed total READABLE, or did the scan mangle it beyond use?
 *
 * WHY THIS EXISTS (the false refusal it fixes): Deepa Jewellers' Total row is
 * scanned as "77 9 749" and "1 7 9 653.OO". The cell splitter reads those as
 * 179,653 shares and Rs 779,749 — well-formed numbers that are simply not what
 * the letter says. Comparing them against the correctly summed 7,791,789 shares
 * and Rs 137.91 Cr produced a hard FAIL and refused a report whose rows are
 * demonstrably right (both parser cross-checks passed). A mangled total is
 * MISSING information, not contradicting information, and must not be treated
 * as a contradiction.
 *
 * The rule: a printed total counts as readable only if its parse is plausible —
 *   (a) the digit count of the printed string, after confusable normalisation
 *       and with separators dropped, is within 1 of the summed value's digit
 *       count (a dropped or doubled digit is a mis-read, not a disagreement); AND
 *   (b) the printed value is within a factor of 2 of the summed value.
 * Anything else is treated as null -> `not_checkable`, which the persister
 * already handles by accepting ONLY when both parser cross-checks passed and
 * refusing otherwise.
 *
 * A printed total that IS readable and still disagrees beyond tolerance stays a
 * hard FAIL — that case is the real corroboration this whole mechanism exists
 * for, and loosening it would put the round-3 x === x hole back.
 */
export const PRINTED_DIGIT_SLACK = 1;
export const PRINTED_FACTOR_LIMIT = 2;

export function isPrintedTotalReadable(
  printed: number | null,
  printedDigits: string | null,
  summed: number
): boolean {
  if (printed === null || printedDigits === null) return false;
  if (!Number.isFinite(printed) || printed <= 0 || summed <= 0) return false;
  const summedDigits = Math.round(summed).toString().length;
  if (Math.abs(printedDigits.length - summedDigits) > PRINTED_DIGIT_SLACK) return false;
  const ratio = printed > summed ? printed / summed : summed / printed;
  return ratio <= PRINTED_FACTOR_LIMIT;
}

/**
 * The investor count the letter states in prose ("allocated to 15 anchor
 * investors"). Null when no such sentence survives the scan.
 */
export function readPrintedCount(text: string): number | null {
  const m = text.match(/\b(\d{1,3})\s+anchor\s+investors?\b/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n < 1000) return n;
  }
  const m2 = text.match(/\banchor\s+investors?\s*[:\-]?\s*(\d{1,3})\b/i);
  if (m2) {
    const n = Number(m2[1]);
    if (Number.isFinite(n) && n > 0 && n < 1000) return n;
  }
  return null;
}

/** The mode of a set of prices, bucketed to the paise; ties go to the lowest. */
function modalPrice(prices: number[]): number | null {
  const counts = new Map<string, number>();
  for (const p of prices) {
    const key = p.toFixed(2);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best: string | null = null;
  for (const [key, n] of counts) {
    const bestCount = best === null ? -1 : (counts.get(best) as number);
    if (n > bestCount || (n === bestCount && Number(key) < Number(best))) best = key;
  }
  return best === null ? null : Number(best);
}

/**
 * Parse the sidecar's page texts into the letter's allocation table.
 *
 * The main table ends at the row the letter labels "Total"; everything after it
 * (the mutual-fund sub-table, the SEBI boilerplate) is read separately, so the
 * sub-table's repeat of three investors can never be counted twice.
 */
export function parseAnchorReport(pages: string[]): AnchorReportResult {
  const all = records(pages);
  const totalAt = all.findIndex((r) => /^total\b/i.test(r.name.trim()));
  const main = totalAt === -1 ? all : all.slice(0, totalAt);
  const after = totalAt === -1 ? [] : all.slice(totalAt + 1);

  const candidates = main
    .map(readRow)
    .filter((c): c is Candidate => c !== null);
  if (candidates.length < MIN_ROWS) {
    return {
      ok: false,
      reason: `only ${candidates.length} investor rows could be read from the anchor report`,
    };
  }

  const price = modalPrice(
    candidates.reduce<number[]>((acc, c) => acc.concat(c.splits.map((s) => s.price)), [])
  );
  if (price === null) {
    return { ok: false, reason: 'no bid price could be derived from the investor rows' };
  }

  // Every row must have exactly one amount that agrees with that price. "Exactly
  // one" matters: two admissible amounts means the split is ambiguous, and a
  // guess between them is precisely what this parser must not make.
  const rows: AnchorReportRow[] = [];
  for (const c of candidates) {
    const fits = c.splits.filter((s) => Math.abs(s.price - price) / price <= PRICE_TOLERANCE);
    const amounts = Array.from(new Set(fits.map((s) => s.amount)));
    if (amounts.length === 0) {
      return {
        ok: false,
        reason: `row "${c.name || c.shares}" has no amount consistent with the derived bid price ${price}`,
      };
    }
    if (amounts.length > 1) {
      return { ok: false, reason: `row "${c.name || c.shares}" has ${amounts.length} possible amounts` };
    }
    rows.push({
      name: c.name,
      shares: c.shares,
      amountRupees: amounts[0],
      percentOfAnchorPortion: c.percent,
    });
  }

  const totalShares = rows.reduce((s, r) => s + r.shares, 0);
  const totalAmountRupees = rows.reduce((s, r) => s + r.amountRupees, 0);

  // The totals are cross-checked against the printed percentages, which are an
  // INDEPENDENT statement of each row's share of the anchor portion: had a share
  // count been misread, the percentages would not land on the total it produces.
  // Both cross-checks are COMPUTED, and their real results are returned on the
  // failure branch as well as the success one. They used to be written into the
  // result as the literals `true`/`true`, which made the persister's
  // `corroborated` test a tautology: it asked "did both checks pass?" of two
  // constants that could only say yes. Behaviour is unchanged — either failure
  // still returns ok:false — but the flags now report what actually happened,
  // so a test can drive a real false through the parser.
  let percentageCheckPassed = true;
  let percentageReason: string | null = null;
  for (const row of rows) {
    const expected = ((row.shares / totalShares) * 100).toFixed(2);
    const printed = row.percentOfAnchorPortion.toFixed(2);
    if (!withinOneGlyph(printed, expected)) {
      percentageCheckPassed = false;
      percentageReason = `row "${row.name || row.shares}" prints ${printed}% but holds ${expected}% of the anchor portion`;
      break;
    }
  }
  const percentSum = rows.reduce((s, r) => s + r.percentOfAnchorPortion, 0);
  if (percentageCheckPassed && Math.abs(percentSum - 100) > PERCENT_SUM_TOLERANCE) {
    percentageCheckPassed = false;
    percentageReason = `investor percentages add up to ${percentSum.toFixed(2)}%, not 100%`;
  }

  const implied = totalShares * price;
  const sharesTimesPriceCheckPassed =
    Math.abs(totalAmountRupees - implied) / implied <= PRICE_TOLERANCE;

  if (!percentageCheckPassed) {
    return {
      ok: false,
      reason: percentageReason as string,
      percentageCheckPassed,
      sharesTimesPriceCheckPassed,
    };
  }
  if (!sharesTimesPriceCheckPassed) {
    return {
      ok: false,
      reason: 'the investor amounts do not add up to the total allocation',
      percentageCheckPassed,
      sharesTimesPriceCheckPassed,
    };
  }

  // The sub-table repeats the mutual-fund allottees. Every share count it lists
  // must be one from the main table, or one of the two has been mis-read.
  const mutualFundShares: number[] = [];
  for (const rec of after) {
    const parsed = readRow(rec);
    if (!parsed) continue;
    if (!rows.some((r) => r.shares === parsed.shares)) break;
    mutualFundShares.push(parsed.shares);
  }

  const fullText = pages.join('\n');
  const printed = readPrintedTotals(totalAt === -1 ? undefined : all[totalAt]);
  // A total the scan mangled is MISSING, not contradicting — see
  // isPrintedTotalReadable. Null here becomes `not_checkable` downstream.
  const printedShares = isPrintedTotalReadable(printed.shares, printed.sharesDigits, totalShares)
    ? printed.shares
    : null;
  const printedAmount = isPrintedTotalReadable(
    printed.amountRupees,
    printed.amountDigits,
    totalAmountRupees
  )
    ? printed.amountRupees
    : null;

  return {
    ok: true,
    value: {
      rows,
      bidPrice: price,
      totalShares,
      totalAmountRupees,
      mutualFundShares,
      letterDate: parseLetterDate(fullText),
      printedTotalShares: printedShares,
      printedTotalAmountRupees: printedAmount,
      printedCount: readPrintedCount(fullText),
      percentageCheckPassed,
      sharesTimesPriceCheckPassed,
    },
  };
}
