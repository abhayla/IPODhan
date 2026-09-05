// W-151 — "an `ipo_details` row exists for every IPO whose filing was persisted".
//
// The persister (scraper/src/services/filing-persister.ts) writes the row for
// every persisted filing, even when the extraction yielded no writable detail
// column. Coverage below the threshold therefore means the DOCUMENT CYCLE
// stopped short of the write door for those IPOs — the class of gap that was
// invisible while "no row" and "row with unknown fields" looked identical
// (prod, 2026-09-05: 3 rows for 358 IPOs).
//
// Pure so it is unit-testable without a database; the audit passes it two
// counts it reads with SQL.

export const DETAILS_ROW_MIN_PCT = 90;

/**
 * The check only becomes a HARD (exit-1) gate on this date. W-151 ships with 3
 * rows for ~40 IPOs with a completed filing; the rows are created by the normal
 * document cycle, so the population needs two full rotations before a shortfall
 * means a defect rather than "the cycle has not run yet". Until then a
 * shortfall is a WARN that still prints the number.
 */
export const DETAILS_ROW_HARD_FROM = '2026-09-09';

/** `DETAILS_ROW_MIN_PCT` env override, for a staging run with a thinner set. */
export function detailsRowMinPct(env = process.env) {
  const raw = env.DETAILS_ROW_MIN_PCT;
  if (raw === undefined || raw === '') return DETAILS_ROW_MIN_PCT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new RangeError(`DETAILS_ROW_MIN_PCT must be a number 0-100, got ${JSON.stringify(raw)}`);
  }
  return n;
}

/**
 * @param {object} args
 * @param {number} args.withCompletedFiling IPOs with at least one EXTRACTED filing (denominator).
 * @param {number} args.withDetailsRow      …of those, how many have an ipo_details row.
 * @param {number} [args.minPct]            threshold, default 90 (env DETAILS_ROW_MIN_PCT).
 * @param {Date|string} [args.now]          clock, for the WARN-until-activation window.
 * @param {string} [args.hardFrom]          activation date (ISO), default DETAILS_ROW_HARD_FROM.
 * @returns {{num:number, den:number, pct:number, pass:boolean, hard:boolean, detail:string}}
 */
export function evaluateDetailsRowCoverage({
  withCompletedFiling,
  withDetailsRow,
  minPct = detailsRowMinPct(),
  now = new Date(),
  hardFrom = DETAILS_ROW_HARD_FROM,
}) {
  const den = Number(withCompletedFiling) || 0;
  const num = Number(withDetailsRow) || 0;
  if (den < 0 || num < 0) throw new RangeError('details-row coverage counts must be >= 0');
  if (num > den) {
    // More detail rows than IPOs with a completed filing means the caller's two
    // queries disagree on their population — a broken measurement, not a pass.
    throw new RangeError(`details-row coverage: num (${num}) exceeds den (${den})`);
  }
  // No IPO has a completed filing yet: nothing to be missing. Vacuously passes,
  // exactly like the aggregate checks whose denominator is 0.
  const pct = den > 0 ? (num / den) * 100 : 100;
  const hard = new Date(now).getTime() >= new Date(`${hardFrom}T00:00:00Z`).getTime();
  return {
    num,
    den,
    pct,
    pass: pct >= minPct,
    hard,
    detail:
      `${num}/${den} = ${pct.toFixed(1)}% (min ${minPct}%, pop=IPOs with a COMPLETED filing` +
      (hard ? ')' : `; WARN until ${hardFrom})`),
  };
}
