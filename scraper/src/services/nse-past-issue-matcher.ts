/**
 * Matching + price-range parsing for NSE's `public-past-issues` payload.
 *
 * Extracted from `scraper/scripts/backfill-price-bands.ts` in T-270 so the
 * matching rules are unit-testable without importing (and therefore RUNNING)
 * the backfill script.
 *
 * The previous matcher scored name-token overlap with a bidirectional
 * substring test and only skipped short DB-side words. NSE company names that
 * contain single-letter tokens ("R K Swamy Limited", "S D Retail Limited")
 * therefore matched almost anything - `"gre".includes("r")` and
 * `"kasturi".includes("s")` are both true - and three accidental hits out of
 * four words cleared the 0.6 threshold. That wrote wrong price bands into 80
 * live production rows (T-270).
 *
 * The replacement only accepts a CONFIDENT identity signal:
 *   1. exact symbol match, or
 *   2. unique normalized-company-name match.
 * Everything else is reported as "no match" so the caller skips the row.
 * A missing band is honest; a wrong band reads as authoritative and is not.
 *
 * @module scraper/src/services/nse-past-issue-matcher
 */

/** The subset of NSE's `public-past-issues` record this module relies on. */
export interface NSEPastIssue {
  company: string;
  symbol?: string | null;
  priceRange?: string | null;
  ipoStartDate?: string;
  ipoEndDate?: string;
  listingDate?: string;
}

export interface MatchCandidate {
  companyName: string;
  symbol?: string | null;
}

export interface NSEMatch {
  issue: NSEPastIssue;
  matchedBy: 'symbol' | 'name';
}

/** Legal-entity suffixes that carry no identity signal. */
const LEGAL_SUFFIXES = /\b(limited|ltd|private|pvt)\b/g;

/**
 * Reduce a company name to its identity tokens: drop parentheticals (our DB
 * carries "... (Foo IPO)" annotations), fold punctuation to spaces, and strip
 * legal-entity suffixes so "Foo Ltd." and "Foo Limited" compare equal.
 */
export function normalizeCompanyName(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find the NSE past-issue row for a DB IPO, or null when no CONFIDENT match
 * exists. Returns null rather than a best guess - see the module note.
 */
export function matchNSEPastIssue(
  dbIPO: MatchCandidate,
  nseIssues: NSEPastIssue[],
  /**
   * T-276: `'symbol'` restricts matching to an exact stock-symbol hit and
   * disables the normalized-name fallback entirely. Repair runs that WRITE over
   * existing production values use this - after T-270 the bar for overwriting a
   * value a user can see is an exact identifier, nothing softer.
   */
  identity: 'symbol' | 'symbol+name' = 'symbol+name'
): NSEMatch | null {
  const symbol = dbIPO.symbol?.trim().toLowerCase();
  if (symbol) {
    const bySymbol = nseIssues.filter(i => i.symbol?.trim().toLowerCase() === symbol);
    if (bySymbol.length === 1) {
      return { issue: bySymbol[0], matchedBy: 'symbol' };
    }
  }

  if (identity === 'symbol') return null;

  const normalized = normalizeCompanyName(dbIPO.companyName);
  if (!normalized) return null;

  const byName = nseIssues.filter(i => normalizeCompanyName(i.company) === normalized);
  // Ambiguous (2+) is not a match - picking one would be a coin flip.
  if (byName.length === 1) {
    return { issue: byName[0], matchedBy: 'name' };
  }

  return null;
}

/**
 * Parse NSE's price-range string ("Rs.100 to Rs.106", "₹253-₹266", "100 - 120").
 * Returns null for placeholders ("--", "N/A") and unparseable values.
 */
export function parsePriceRange(priceStr: string | null | undefined): { min: number; max: number } | null {
  if (!priceStr) return null;
  const raw = String(priceStr).trim();
  if (raw === '--' || raw === '-' || raw.toUpperCase() === 'N/A') return null;

  const cleaned = raw.replace(/Rs\.?|₹|INR|,/gi, '').trim();

  const rangeMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:to|-)\s*(\d+(?:\.\d+)?)/i);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]);
    const max = parseFloat(rangeMatch[2]);
    if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) {
      return { min, max };
    }
    return null;
  }

  const price = parseFloat(cleaned);
  if (Number.isFinite(price) && price > 0) {
    return { min: price, max: price };
  }
  return null;
}
