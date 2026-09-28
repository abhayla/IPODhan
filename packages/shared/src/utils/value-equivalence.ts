/**
 * OD-59 value equivalence: "agreement is judged on the MEANING of a value, never on its text."
 *
 * One implementation, shared: the scraper's write path and verdict writer compare two sources'
 * values with `areEquivalent`, and the admin queue (web) uses the SAME function to decide whether
 * an unresolved conflict is a real disagreement. Moved here from
 * scraper/src/services/normalization-engine.ts (which re-exports it) so the web app does not carry
 * a second, narrower copy. Pure: no I/O, no scraper config.
 */
import { foldCompanyIdentity } from './company-identity-fold';

// ==================== DATE NORMALIZATION ====================

/**
 * Normalize various date formats to ISO 8601 string (YYYY-MM-DD)
 *
 * Handles:
 * - DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY
 * - DD-MMM-YYYY (e.g., 15-Jan-2025)
 * - DD MMM YYYY (e.g., 15 January 2025)
 * - YYYY-MM-DD (ISO format)
 * - MM/DD/YYYY (US format - detects based on day > 12)
 * - Timestamps (milliseconds, seconds)
 *
 * Returns: string in YYYY-MM-DD format, or null if invalid
 */
export function normalizeDate(value: string | number | Date): string | null {
  if (!value) return null;

  // Already a Date object
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }

  // Unix timestamp (milliseconds or seconds)
  if (typeof value === 'number') {
    const timestamp = value < 1e10 ? value * 1000 : value; // Convert seconds to ms if needed
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
    return null;
  }

  const str = value.toString().trim();

  // ISO format (YYYY-MM-DD) - already normalized
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      return str;
    }
  }

  // Month name mapping
  const monthNames: Record<string, number> = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };

  // DD-MMM-YYYY or DD MMM YYYY (e.g., 15-Jan-2025, 15 January 2025)
  const monthNameMatch = str.match(/(\d{1,2})[\/\-\s\.]+([a-z]+)[\/\-\s\.]+(\d{4})/i);
  if (monthNameMatch) {
    const day = parseInt(monthNameMatch[1]);
    const monthStr = monthNameMatch[2].toLowerCase();
    const year = parseInt(monthNameMatch[3]);
    const month = monthNames[monthStr];

    if (month !== undefined && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
      // Use Date.UTC to avoid timezone issues
      const date = new Date(Date.UTC(year, month, day));
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (Indian format - most common)
  const ddmmyyyyMatch = str.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (ddmmyyyyMatch) {
    const part1 = parseInt(ddmmyyyyMatch[1]);
    const part2 = parseInt(ddmmyyyyMatch[2]);
    const year = parseInt(ddmmyyyyMatch[3]);

    // If part1 > 12, it must be day (DD/MM/YYYY)
    // If part2 > 12, it must be day (MM/DD/YYYY)
    // Otherwise, assume Indian format (DD/MM/YYYY)
    let day: number, month: number;

    if (part1 > 12) {
      day = part1;
      month = part2; // Use 1-indexed month for Date.UTC
    } else if (part2 > 12) {
      day = part2;
      month = part1; // Use 1-indexed month for Date.UTC
    } else {
      // Assume DD/MM/YYYY (Indian format)
      day = part1;
      month = part2; // Use 1-indexed month for Date.UTC
    }

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 2100) {
      // Use Date.UTC to avoid timezone issues
      const date = new Date(Date.UTC(year, month - 1, day));

      // Validate that the date components match (catch invalid dates like Feb 29 on non-leap years)
      if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1 || date.getUTCFullYear() !== year) {
        return null; // Invalid date (e.g., Feb 29 on non-leap year)
      }

      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }
  }

  // Try Date constructor as last resort
  const date = new Date(str);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }

  return null; // Invalid date
}

// ==================== EQUIVALENCE CHECKING ====================

/**
 * OD-59 (owner, 2026-09-18): "agreement is judged on the MEANING of a value,
 * never on its text." A family says HOW to read the two values before they are
 * compared. Absent, nothing changes — see the compatibility note on
 * `areEquivalent` below.
 *
 *   MONEY      absolute amounts and share counts. Numeric strings are read as
 *              numbers, and two values agree within 0.5%, because independent
 *              sources round the same figure differently (measured: 1,249,970,000
 *              against 1,250,000,000 is one issue size, not two).
 *   RATIO      derived figures — pe, eps, ronw, debt_to_equity. NOT 0.5%: a PE of
 *              24.0 against 24.1 is 0.4% and would pass, but for a ratio that gap
 *              usually means the sources used different denominators (pre- versus
 *              post-issue EPS), which is the disagreement most worth catching.
 *   IDENTITY   names. Compared after folding corporate forms, so "Pvt Ltd" and
 *              "Private Limited" are one registrar, not two.
 *   IDENTIFIER ISIN, CIN, symbol. Exact, case-sensitive. There is no
 *              close-enough for an identifier.
 *   DATE       open, close, listing, allotment, refund, credit. Compared as
 *              CALENDAR DAYS after normalisation, so "15 September 2026",
 *              "15/09/2026" and "2026-09-15" are one date. The time of day is
 *              deliberately dropped: two sources recording the same listing
 *              date with different timestamps agreed about the date, and the
 *              hour is noise they never agreed on. Dates are the LARGEST
 *              disagreement family measured -- 12,719 of 28,946 across 44
 *              IPOs (OD-57) -- so the string fallback below was the single
 *              biggest source of false conflicts (#773).
 */
export type ComparisonFamily = 'MONEY' | 'RATIO' | 'IDENTITY' | 'IDENTIFIER' | 'DATE' | 'SET' | 'BOOLEAN' | 'COUNT';

/**
 * #783: the manifest's `comparisonFamily` enum also allows `ABSTAIN`, which is
 * deliberately NOT in this union. ABSTAIN is not an instruction about HOW to
 * compare two values -- it is an instruction to the VERDICT WRITER not to
 * compare them at all (free prose and structured object lists, 14 fields).
 * There is no sensible `areEquivalent(a, b, { family: 'ABSTAIN' })`, so the
 * type refuses it and the writer must filter those fields out before reaching
 * this function.
 */

export interface EquivalenceOptions {
  family?: ComparisonFamily;
  /** Absolute tolerance for the family-less path. Unchanged default. */
  tolerance?: number;
}

/** Money agrees within this fraction of the larger value (OD-59). */
const MONEY_RELATIVE_TOLERANCE = 0.005;
/** A ratio is compared at 2 decimal places (OD-59). */
const RATIO_DECIMAL_PLACES = 2;

/**
 * The key one SET member is compared by. Deliberately the SAME shape
 * `unionSetValues` (data-consolidation-service.ts) uses to decide whether an
 * incoming member is already present: lower-cased and trimmed for a string,
 * structural otherwise. Two definitions of "the same member" would let the
 * writer union two values the comparator had just called different.
 */
export function setMemberKey(v: any): string {
  return typeof v === 'string' ? v.toLowerCase().trim() : JSON.stringify(v);
}

/** A string that is entirely a number, so "10.00" can be read as 10. */
function asNumber(value: any): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // Deliberately strict: only a bare numeric literal. "10 crore" is NOT a
  // number here — unit handling belongs to normalisation, before comparison.
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Check if two normalized values are equivalent
 * Uses tolerance for floating point comparison
 *
 * BACKWARDS COMPATIBILITY (load-bearing): the third argument was, and still is,
 * a bare `tolerance: number`. All seven existing production call sites pass
 * nothing and are unaffected — the family branches below run ONLY when a caller
 * opts in with `{ family }`. S3b switches the write path deliberately; until
 * then this function behaves exactly as it did.
 */
export function areEquivalent(
  val1: any,
  val2: any,
  toleranceOrOptions: number | EquivalenceOptions = 0.01
): boolean {
  const opts: EquivalenceOptions =
    typeof toleranceOrOptions === 'number' ? { tolerance: toleranceOrOptions } : toleranceOrOptions;
  const tolerance = opts.tolerance ?? 0.01;

  // A family is read BEFORE the generic branches: the whole point is that
  // "10" and "10.00" must not reach the string comparison below.
  if (opts.family) {
    // OD-60: only null/undefined/'' abstain. Zero is a value a source genuinely
    // supplied (ipo_valuation.ofs_shares = 0 on a pure fresh issue).
    const empty = (v: any) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
    if (empty(val1) || empty(val2)) return empty(val1) && empty(val2);

    if (opts.family === 'IDENTIFIER') {
      return typeof val1 === 'string' && typeof val2 === 'string' ? val1 === val2 : val1 === val2;
    }

    if (opts.family === 'IDENTITY') {
      if (typeof val1 === 'string' && typeof val2 === 'string') {
        return foldCompanyIdentity(val1) === foldCompanyIdentity(val2);
      }
      return val1 === val2;
    }

    if (opts.family === 'COUNT') {
      // #782: a COUNT is DISCRETE -- it has no rounding, so it gets no tolerance.
      // MONEY's 0.5% relative tolerance is right for a rupee figure two sources
      // round differently, and wrong here: 200 vs 201 anchor investors is a real
      // disagreement, and above ~200 that tolerance swallows an off-by-one
      // silently (199 vs 200 is exactly 0.0050). Zero is a real count a source
      // supplied, never an abstention -- the empty() check above already handled
      // null/undefined/'' (OD-60).
      const n1 = asNumber(val1);
      const n2 = asNumber(val2);
      if (n1 !== null && n2 !== null) return n1 === n2;
      // Not both numeric -- fall through rather than guess.
    }

    if (opts.family === 'BOOLEAN') {
      // A scraped page yields the STRING "true"; the same answer as `true`.
      // `false` is a real answer a source supplied, never an abstention --
      // the empty() check above already handled null/undefined/'' (OD-60).
      const asBool = (v: any): boolean | null => {
        if (typeof v === 'boolean') return v;
        if (typeof v === 'string') {
          const t = v.trim().toLowerCase();
          if (t === 'true') return true;
          if (t === 'false') return false;
        }
        return null;
      };
      const b1 = asBool(val1);
      const b2 = asBool(val2);
      if (b1 !== null && b2 !== null) return b1 === b2;
      // Neither readable as a boolean -- fall through rather than guess.
    }

    if (opts.family === 'SET') {
      // Order is not meaning: ['NSE','BSE'] and ['BSE','NSE'] are one answer.
      // A duplicate is not a new member either -- it is a SET, not a list.
      if (Array.isArray(val1) && Array.isArray(val2)) {
        const k1 = new Set(val1.map(setMemberKey));
        const k2 = new Set(val2.map(setMemberKey));
        if (k1.size !== k2.size) return false;
        for (const k of k1) if (!k2.has(k)) return false;
        return true;
      }
      // Not both arrays: a SET field holding a scalar is a normalisation
      // problem, not a comparison one. Fall through, never guess.
    }

    if (opts.family === 'DATE') {
      // `normalizeDate` returns a canonical YYYY-MM-DD, or null for anything
      // it cannot read as a date. A null on EITHER side means we do not know
      // these are dates, so we fall through to the generic rules rather than
      // guess -- the same shape MONEY uses when a value is not numeric.
      const d1 = normalizeDate(val1 as string | number | Date);
      const d2 = normalizeDate(val2 as string | number | Date);
      if (d1 !== null && d2 !== null) return d1 === d2;
      // fall through
    }

    const n1 = asNumber(val1);
    const n2 = asNumber(val2);
    if (n1 === null || n2 === null) {
      // Not both numeric — fall through to the generic rules rather than
      // guessing. A MONEY field holding a string is a normalisation problem,
      // not a comparison one.
    } else if (opts.family === 'RATIO') {
      return n1.toFixed(RATIO_DECIMAL_PLACES) === n2.toFixed(RATIO_DECIMAL_PLACES);
    } else {
      // MONEY. Relative to the larger magnitude, so the tolerance means the
      // same thing at ₹10 and at ₹17,570 crore. Both zero is handled by the
      // exact check first, so there is no divide-by-zero here.
      if (n1 === n2) return true;
      const scale = Math.max(Math.abs(n1), Math.abs(n2));
      if (scale === 0) return true;
      return Math.abs(n1 - n2) / scale <= MONEY_RELATIVE_TOLERANCE;
    }
  }

  // Exact equality
  if (val1 === val2) return true;

  // Both null/undefined
  if ((val1 === null || val1 === undefined) && (val2 === null || val2 === undefined)) {
    return true;
  }

  // One null, other not
  if ((val1 === null || val1 === undefined) !== (val2 === null || val2 === undefined)) {
    return false;
  }

  // Number comparison with tolerance
  if (typeof val1 === 'number' && typeof val2 === 'number') {
    return Math.abs(val1 - val2) <= tolerance;
  }

  // W-18(ii): array-valued fields (leadManagers, listingExchanges) reached the
  // `return false` below on every cycle because `===` is reference equality —
  // two IDENTICAL lists from two sources were logged as a `data_conflicts` row
  // forever. Compared as order-insensitive multisets of trimmed, lower-cased
  // members.
  if (Array.isArray(val1) && Array.isArray(val2)) {
    if (val1.length !== val2.length) return false;
    const key = (v: any) => (typeof v === 'string' ? v.toLowerCase().trim() : JSON.stringify(v));
    const sorted1 = val1.map(key).sort();
    const sorted2 = val2.map(key).sort();
    return sorted1.every((v, i) => v === sorted2[i]);
  }

  // String comparison (case-insensitive, trimmed)
  if (typeof val1 === 'string' && typeof val2 === 'string') {
    return val1.toLowerCase().trim() === val2.toLowerCase().trim();
  }

  // Date comparison (as ISO strings)
  if (val1 instanceof Date && val2 instanceof Date) {
    return val1.toISOString().split('T')[0] === val2.toISOString().split('T')[0];
  }

  return false;
}
