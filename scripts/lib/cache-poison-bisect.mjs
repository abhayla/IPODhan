// Cache-poisoning bisect probe (T-463 / issue #189, G-D).
//
// A poisoned cache entry can sit exactly at a page's default parameter value
// (limit=20 served 240 stale rows with blank issuePrice for 19 hours) while
// limit=19 and limit=21 both returned the correct 243-row set. Probing only
// the default value misses this divergence; probing N-1/N/N+1 around it
// catches it. Pure predicate — no fetch/network here, so it is unit-testable
// against fixtures (see scripts/tests/cache-poison-bisect.test.mjs).

/**
 * @param {{n:number, total:number, leadingIds:string[], nullRate:number}} below  limit=N-1
 * @param {{n:number, total:number, leadingIds:string[], nullRate:number}} at     limit=N (the default)
 * @param {{n:number, total:number, leadingIds:string[], nullRate:number}} above  limit=N+1
 * @param {number} nullRateToleranceDeltaPct  max allowed percentage-point divergence (default 10)
 * @returns {string|null} violation detail, or null when all three samples agree
 */
export function bisectDefaultParameter(below, at, above, nullRateToleranceDeltaPct = 10) {
  const reasons = [];

  if (below.total !== at.total || at.total !== above.total) {
    reasons.push(`total mismatch: N-1=${below.total} N=${at.total} N+1=${above.total}`);
  }

  // Compare the leading ids by OVERLAP, not exact order or exact set: a tied
  // secondary sort key (two IPOs listed the same day, no deterministic
  // tiebreaker in the query) can legitimately swap ONE boundary row between
  // adjacent limits without any poisoning — observed live on prod 2026-09-07
  // (rank-5 of 5 differed by one id across limit=19/20/21 while every other
  // row matched). Poisoning replaces the page's content wholesale (the T-268
  // incident served an entirely different, stale 240-row set), so a majority
  // overlap requirement still catches the real incident shape while
  // tolerating single-row tie-break jitter at the window boundary.
  const leadCount = Math.min(below.leadingIds.length, at.leadingIds.length, above.leadingIds.length);
  const belowSet = new Set(below.leadingIds.slice(0, leadCount));
  const atSet = new Set(at.leadingIds.slice(0, leadCount));
  const aboveSet = new Set(above.leadingIds.slice(0, leadCount));
  const overlapRatio = (a, b) => (leadCount === 0 ? 1 : [...a].filter((v) => b.has(v)).length / leadCount);
  const MIN_OVERLAP = 0.6; // tolerates 1 differing id in a 5-item window; still fails on a wholesale swap
  if (overlapRatio(belowSet, atSet) < MIN_OVERLAP || overlapRatio(atSet, aboveSet) < MIN_OVERLAP) {
    reasons.push(`leading id overlap below ${MIN_OVERLAP * 100}% at N=${at.n}`);
  }

  const rates = [below.nullRate, at.nullRate, above.nullRate];
  const spreadPct = (Math.max(...rates) - Math.min(...rates)) * 100;
  if (spreadPct > nullRateToleranceDeltaPct) {
    reasons.push(
      `issuePrice null-rate divergence: N-1=${(below.nullRate * 100).toFixed(1)}% ` +
      `N=${(at.nullRate * 100).toFixed(1)}% N+1=${(above.nullRate * 100).toFixed(1)}% (> ${nullRateToleranceDeltaPct}pp)`
    );
  }

  return reasons.length ? reasons.join('; ') : null;
}

/** Fraction of rows whose issuePrice is null/undefined. */
export function issuePriceNullRate(rows) {
  if (!rows || rows.length === 0) return 0;
  const nulls = rows.filter((r) => r.issuePrice === null || r.issuePrice === undefined).length;
  return nulls / rows.length;
}
