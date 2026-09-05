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
 * @param {object} args
 * @param {number} args.withCompletedFiling IPOs with at least one EXTRACTED filing (denominator).
 * @param {number} args.withDetailsRow      …of those, how many have an ipo_details row.
 * @param {number} [args.minPct]            threshold, default 90.
 * @returns {{num:number, den:number, pct:number, pass:boolean, detail:string}}
 */
export function evaluateDetailsRowCoverage({
  withCompletedFiling,
  withDetailsRow,
  minPct = DETAILS_ROW_MIN_PCT,
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
  return {
    num,
    den,
    pct,
    pass: pct >= minPct,
    detail: `${num}/${den} = ${pct.toFixed(1)}% (min ${minPct}%, pop=IPOs with a COMPLETED filing)`,
  };
}
