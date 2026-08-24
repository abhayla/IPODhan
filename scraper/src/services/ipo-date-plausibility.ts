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

// T-309: mirrors FAR_PAST_ANCHOR_THRESHOLD_MS in validators.ts — a listing
// older than this, relative to now, is treated as an already-happened
// historical fact rather than an unconfirmed future scheduling claim.
const FAR_PAST_LISTING_THRESHOLD_MS = 180 * 24 * 60 * 60 * 1000;

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

  // T-309 presence-coherence: a FUTURE-or-recent listing_date with NEITHER an
  // open_date NOR a close_date is an unconfirmable scheduling claim — an IPO
  // opens, then closes, then lists; nothing corroborates a bare promise to
  // list on a date that hasn't happened yet (the ORDER checks below only fire
  // when both sides of a pair are present, so they never catch this "both
  // sides entirely missing" shape). Real case: priority-jewels-ltd carried
  // listing_date=2026-09-04 (future) with open_date AND close_date both NULL.
  //
  // Gated to FUTURE/near-term listings only (not far in the past) so this does
  // NOT re-flag the WINDLAS-shape stomp result (sanitizeIpoDates deliberately
  // keeps a far-past listing alone as the trustworthy anchor after nulling a
  // conflicting near-term open/close — see FAR_PAST_ANCHOR_THRESHOLD_MS in
  // validators.ts, same threshold reused here) — a listing already in the past
  // is a historical fact, not a scheduling promise, and needs no open/close to
  // corroborate it. Gated on close also being absent (not just open) so this
  // does not re-flag the T-306 F1 shape — open absent but close present is a
  // legitimate partial-data case the close-vs-listing check below already
  // handles on its own terms. Checked FIRST and independent of the
  // present-vs-present ORDER checks below (T-306) so it composes without
  // touching their logic.
  if (listing !== null && open === null && close === null) {
    const isFarPast = Date.now() - listing > FAR_PAST_LISTING_THRESHOLD_MS;
    if (!isFarPast) {
      return { ok: false, reason: 'listing_date present without open_date' };
    }
  }

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
