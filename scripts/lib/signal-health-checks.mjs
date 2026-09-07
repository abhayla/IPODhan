// Issue #191 (G-F): pipeline-signal health — a signal that repeats forever
// stops being a signal. Three pure predicates, unit-tested independent of
// the DB, then wired into scripts/audit-detection-floor.mjs as checks[]
// entries so a repeated WARN, an unbounded backlog, or a detector reporting
// zero against a demonstrably-violated invariant all FAIL the nightly gate.
//
// Why these three (docs/data-quality/discovery-coverage.md, T-297 D6):
//   F1 — the same InvIT/REIT validation WARN logged 20+ times/cycle while the
//        mis-typed rows still wrote through (T-272 P2-2).
//   F2 — data_conflicts grew to 11,493 unresolved rows because the same
//        conflict re-inserts instead of upserting, with no prune (T-285 P2-3).
//   F3 — conflictsDetected read 0 every cycle across 3,760 fields while real
//        disagreements demonstrably existed (T-272 P3-5). A zero can look
//        like health; only a cross-check against an independently-known
//        violation exposes an inert detector.

export const REPEATED_MESSAGE_MAX_OCCURRENCES_24H = 20;
export const CONFLICT_BACKLOG_MAX_UNRESOLVED = 500;

// ---- F1: repeated-WARN detector ---------------------------------------------
// `rows` is [{ message, count }], already grouped+counted by the caller's SQL
// (GROUP BY truncated message, COUNT(*), status IN FAILURE/PARTIAL, last 24h).
// Pure over the aggregate — no DB access here, unit-testable without a
// fixture DB.
export function classifyRepeatedMessages(rows, maxOccurrences = REPEATED_MESSAGE_MAX_OCCURRENCES_24H) {
  const offenders = (rows || []).filter((r) => Number(r.count) > maxOccurrences);
  return { fail: offenders.length > 0, offenders };
}

// ---- F2: unbounded backlog ceiling ------------------------------------------
// Absolute ceiling, independent of and in addition to the noise-RATIO check
// (f_conflict_noise_ratio) — a backlog can be 100% "genuine" disagreements by
// ratio and still be unbounded because nothing prunes/upserts it (T-285).
export function classifyConflictBacklogCeiling(unresolvedTotal, ceiling = CONFLICT_BACKLOG_MAX_UNRESOLVED) {
  const total = Number(unresolvedTotal) || 0;
  return { fail: total > ceiling, total, ceiling };
}

// ---- F3: inert detector ------------------------------------------------------
// The important one: a detector reporting zero is indistinguishable from a
// healthy system UNLESS cross-checked against an invariant independently
// known to be violated. If rows are failing checkPriceBand (real
// corruption/disagreement exists) but the conflict detector inserted NOTHING
// in the same window, the detector is inert — not the data clean.
export function classifyInertDetector(priceBandViolationCount, conflictsInsertedLast24h) {
  const violations = Number(priceBandViolationCount) || 0;
  const inserted = Number(conflictsInsertedLast24h) || 0;
  return { fail: violations > 0 && inserted === 0, violations, inserted };
}
