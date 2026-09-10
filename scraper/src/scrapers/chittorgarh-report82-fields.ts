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
 * WHY SOURCED, NOT DERIVED: because a price band cannot tell you the mechanism.
 * A book-built issue whose floor happens to equal its cap is indistinguishable
 * from a fixed-price one by arithmetic alone. This field states the issue's
 * mechanism INDEPENDENTLY of its price, which is the only reason it is worth
 * fetching at all.
 *
 * CORRECTION, and it matters because the earlier wording would mislead a future
 * reader. I wrote that this field feeds `checkDegenerateBookbuildingBand`'s
 * FIXED_PRICE exemption and therefore "removes the need for" the `floor === cap`
 * step in `filing-persister.ts`. BOTH HALVES ARE FALSE, proved in Tier A review:
 *
 *   - The FIXED_PRICE exemptions (`data-validation.ts:149`, `:482`) read
 *     `data.issueType` off the **`ipos`** payload. `issue_type` is a column on
 *     **`ipo_details`** ONLY - `ipos` has no such column - and nothing reads
 *     `ipo_details.issue_type` back into that validation. Writing this column
 *     neither feeds nor silences that check.
 *   - It therefore does not remove the `floor === cap` step either. Retiring
 *     that step is a separate slice whose detection change IS the exemption
 *     removal, and it must stand on its own evidence, not on this.
 *
 * The reverse risk is real and is NOT guarded here: `filing-persister.ts`
 * derives FIXED_PRICE from `floor === cap` and writes it through
 * `ipoDetailsWriter.upsert`, which OVERWRITES - so a heuristic guess can still
 * clobber a sourced value from this path. The null-guarded write below is
 * one-directional protection, not a symmetry.
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
const PRICING_METHOD: Readonly<Record<string, IssueType>> = Object.freeze(Object.assign(Object.create(null), {
  bookbuilding: 'BOOK_BUILDING',
  'fixed price': 'FIXED_PRICE',
}));

/**
 * `Mainboard` here, NOT `Mainline`. Chittorgarh's DETAIL page uses "Mainline"
 * and this LIST endpoint uses "Mainboard" — accepting both would paper over a
 * real difference between two sources that a future reader needs to see.
 */
const ISSUE_CATEGORY: Readonly<Record<string, Segment>> = Object.freeze(Object.assign(Object.create(null), {
  mainboard: 'MAINBOARD',
  sme: 'SME',
}));

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
  /**
   * The issue's OPEN DATE, ISO yyyy-mm-dd, from `~Issue_Open_Date`. Carried so
   * the caller can require it to agree with the stored row before writing.
   *
   * WHY: a name match is not an identity match. A company that withdrew and
   * refiled, or an old SME issue whose name folds identically to a newer
   * mainboard entry, would take this year's BOOK_BUILDING onto a previous
   * issue's row that was FIXED_PRICE - with sourced provenance saying we meant
   * it. The report already carries the date; dropping it threw away the one
   * cheap check that turns a name match into a checkable one.
   *
   * `null` when the report omits or malforms it - never guessed.
   */
  openDate: string | null;
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
/**
 * Read the issue's open date from a report record, as ISO yyyy-mm-dd.
 *
 * Returns null rather than a guess: an unparseable date must not become a date
 * that happens to compare equal to something.
 */
export function openDateFromRecord(record: Record<string, unknown>): string | null {
  const raw = record['~Issue_Open_Date'];
  if (typeof raw !== 'string') return null;
  // NO `new Date(...)` HERE, DELIBERATELY. `new Date(s).toISOString()` parses a
  // string without a timezone in LOCAL time and then renders UTC, so on this
  // IST machine (+05:30) it can shift the date by a whole day - which is how a
  // 2026-09-18 issue becomes 2026-09-17 and stops matching a stored row. The
  // repo's `date-tz-parse-ratchet` test caught exactly that chain in the first
  // version of this function. The field is already ISO, so read it, do not
  // reparse it: take the date part only, and refuse anything that is not
  // literally yyyy-mm-dd at the front.
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/.exec(raw.trim());
  return m ? m[1] : null;
}

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
    out.push({ companyName, issueType, openDate: openDateFromRecord(record) });
  }
  return out;
}
