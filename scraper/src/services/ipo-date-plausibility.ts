/**
 * IPO date plausibility guards (pure, DB-free).
 *
 * Two guards, one for each of the date-integrity issues:
 *  - isAllotmentPlausible (#41): a backfilled allotment_date MUST sit strictly
 *    inside (close_date, listing_date). A name-match backfill can otherwise pull a
 *    historical company's allotment onto the wrong row (the 7 domain-absurd dates).
 *  - isDateSequenceCoherent (#52): the full open ≤ close < allotment < listing
 *    ordering, used to detect the consolidation mis-merge that produced
 *    close_date > allotment_date on 7 rows.
 *
 * Both parse ISO-ish date strings (YYYY-MM-DD, leading portion of a timestamp).
 * A pair where either side is null is NOT treated as a violation — partial data
 * is not incoherent; only a present-vs-present ordering breach is.
 */

/** Parse a date-ish value to epoch ms, or null if unparseable. */
function toMs(v: string | Date | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const s = v instanceof Date ? v.toISOString() : String(v);
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (!m) return null;
  const t = Date.parse(m[0]);
  return Number.isNaN(t) ? null : t;
}

/**
 * #41 — Is an allotment_date plausible given the IPO's close and listing dates?
 *
 * Requires the allotment to fall STRICTLY within (close, listing) for whichever
 * bounds are present. If NEITHER bound is present the date cannot be confirmed
 * in-window, so we return false (skip the write) rather than ship an unverifiable
 * value — the class this guards (name-collision backfill) always leaves an absurd
 * date, so a conservative skip is correct.
 */
export function isAllotmentPlausible(
  allotment: string | Date | null | undefined,
  closeDate: string | Date | null | undefined,
  listingDate: string | Date | null | undefined
): boolean {
  const a = toMs(allotment);
  if (a === null) return false;

  const close = toMs(closeDate);
  const listing = toMs(listingDate);

  // No bound at all → cannot confirm plausibility → skip.
  if (close === null && listing === null) return false;

  if (close !== null && a <= close) return false; // allotment is after close
  if (listing !== null && a >= listing) return false; // allotment is before listing
  return true;
}

export interface DateSequence {
  openDate: string | Date | null | undefined;
  closeDate: string | Date | null | undefined;
  allotmentDate: string | Date | null | undefined;
  listingDate: string | Date | null | undefined;
}

export interface CoherenceResult {
  ok: boolean;
  reason?: string;
}

/**
 * #52 — Is the full date sequence coherent (open ≤ close < allotment < listing)?
 *
 * Only present-vs-present adjacent (and the key close/allotment) pairs are checked;
 * a null on either side of a pair is skipped. Returns the first breach found so the
 * caller can log which pair is corrupted.
 */
export function isDateSequenceCoherent(seq: DateSequence): CoherenceResult {
  const open = toMs(seq.openDate);
  const close = toMs(seq.closeDate);
  const allot = toMs(seq.allotmentDate);
  const listing = toMs(seq.listingDate);

  if (open !== null && close !== null && open > close) {
    return { ok: false, reason: 'open_date is after close_date' };
  }
  if (close !== null && allot !== null && close >= allot) {
    return { ok: false, reason: 'close_date is at/after allotment_date' };
  }
  if (allot !== null && listing !== null && allot >= listing) {
    return { ok: false, reason: 'allotment_date is at/after listing_date' };
  }
  // T-306 F1: a dedicated close-vs-listing rule, independent of allotment or open.
  // Without this, `open 2026-04-23 / close 2026-05-07 / allot null / listing
  // 2026-02-16` only failed by accident (the open-vs-listing check below), and an
  // otherwise-identical row with `open` absent slipped through as coherent.
  if (close !== null && listing !== null && close >= listing) {
    return { ok: false, reason: 'close_date is at/after listing_date' };
  }
  // Guard the open→allotment and close→listing spans too (catch corruption where
  // the intermediate date is null but the ends are inverted).
  if (open !== null && allot !== null && open > allot) {
    return { ok: false, reason: 'open_date is after allotment_date' };
  }
  if (open !== null && listing !== null && open > listing) {
    return { ok: false, reason: 'open_date is after listing_date' };
  }
  return { ok: true };
}
