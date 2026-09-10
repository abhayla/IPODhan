/**
 * Item 2 slice 7: the two fields Chittorgarh's report-82 LIST endpoint publishes
 * that we currently throw away.
 *
 * `chittorgarh-scraper.ts` already fetches these rows and maps seven fields out
 * of each record (company, verifierUrl from the anchor href, three dates, issue
 * price, total issue amount, listing-at, lead manager). It reads NEITHER
 * `Pricing Method` NOR `Issue Category`, though both sit in the same object.
 *
 * MEASURED against the live report 2026-09-11, read-only, 231 rows for FY2026-27:
 *   Pricing Method : Bookbuilding 206 / Fixed Price 25
 *   Issue Category : SME 145 / Mainboard 86
 *
 * WHY SOURCED, NOT DERIVED. `filing-persister.ts` has a last-resort
 * `floor === cap -> FIXED_PRICE` step, and `checkDegenerateBookbuildingBand`
 * exempts FIXED_PRICE. Deriving the type from the band and then exempting on it
 * would make that check permanently green on exactly the rows it exists to
 * catch. This field states the issue's mechanism INDEPENDENTLY of its price, so
 * it removes the need for that step rather than adding a second one.
 */

export type IssueType = 'BOOK_BUILDING' | 'FIXED_PRICE' | 'HYBRID';
export type Segment = 'MAINBOARD' | 'SME';

/**
 * The EXACT strings the source uses, and nothing else. Every key here appears in
 * the committed fixture `docs/design/probes/fixtures/chittorgarh/
 * report-82-pricing-method.json`, captured from the live endpoint.
 *
 * Deliberately NOT widened to near-spellings. "Book Building" with a space is
 * refused: the source writes one word, and quietly accepting a second spelling
 * would hide the day the source actually changes its vocabulary. A refusal is
 * visible; a silent alias is not.
 */
const PRICING_METHOD: Readonly<Record<string, IssueType>> = Object.freeze({
  bookbuilding: 'BOOK_BUILDING',
  'fixed price': 'FIXED_PRICE',
});

/**
 * `Mainboard` here, NOT `Mainline`. Chittorgarh's DETAIL page uses "Mainline"
 * and this LIST endpoint uses "Mainboard" — accepting both would paper over a
 * real difference between two sources that a future reader needs to see.
 */
const ISSUE_CATEGORY: Readonly<Record<string, Segment>> = Object.freeze({
  mainboard: 'MAINBOARD',
  sme: 'SME',
});

/** Cell text arrives with case and padding from the HTML table. */
function normaliseCell(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * `Pricing Method` -> `ipo_details.issue_type`. Returns null for anything the
 * source has not been observed to emit, so an unrecognised value is skipped
 * rather than guessed into the column.
 */
export function issueTypeFromPricingMethod(raw: string | null | undefined): IssueType | null {
  return PRICING_METHOD[normaliseCell(raw)] ?? null;
}

/**
 * `Issue Category` -> `ipos.segment`. Same refusal rule.
 *
 * NOTE, measured: on production all 194 rows this endpoint matches ALREADY have
 * segment provenance and already agree, so this mapping fills no gap today. It
 * is here because the value belongs to the same record and is worth conflict-
 * checking, not because it has rows to repair.
 */
export function issueCategoryToSegment(raw: string | null | undefined): Segment | null {
  return ISSUE_CATEGORY[normaliseCell(raw)] ?? null;
}

/** One IPO's sourced issue type, ready to match against a stored row. */
export interface Report82IssueType {
  /** The company name as the report prints it, anchor markup stripped. */
  companyName: string;
  issueType: IssueType;
}

/**
 * Collect the issue types a report-82 payload carries, from records the
 * Chittorgarh scraper has ALREADY parsed. Pure: no fetch, no database, no
 * matching — so the mapping is testable without either, and the caller decides
 * how to match and whether to write.
 *
 * Rows whose `Pricing Method` is unrecognised are DROPPED, not defaulted. A row
 * we cannot read is not a row we may guess at: `issue_type` feeds a check that
 * exempts FIXED_PRICE, so a wrong value there silences a real defect.
 */
export function collectIssueTypesFromReport(
  records: ReadonlyArray<Record<string, unknown>>,
  stripAnchor: (html: string) => string
): Report82IssueType[] {
  const out: Report82IssueType[] = [];
  for (const record of records ?? []) {
    const companyName = stripAnchor(String(record['Company'] ?? '')).trim();
    if (!companyName) continue;
    const issueType = issueTypeFromPricingMethod(record['Pricing Method'] as string);
    if (!issueType) continue;
    out.push({ companyName, issueType });
  }
  return out;
}
