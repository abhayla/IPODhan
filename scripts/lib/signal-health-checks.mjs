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

// ---- F2 (round 2): shrink-only ratchet baseline -----------------------------
// The flat 500 ceiling above is red forever on staging (14,252 unresolved,
// well above 500 today) — an absolute ceiling only works once the backlog is
// already under it. Ratchet instead: compare today's unresolved count against
// a checked-in per-database baseline. A RISE (new backlog growth, the T-285
// unbounded-growth class) FAILs; a FALL WARNs with the delta and the baseline
// is only ever lowered via an explicit rebaseline that refuses to raise it
// (see rebaselineConflictBacklog below and --rebaseline-conflicts in
// audit-detection-floor.mjs). No baseline entry yet for this database is
// UNVERIFIABLE, not PASS — an unseeded ratchet gates nothing silently.
export function classifyConflictBacklogRatchet(currentTotal, baselineTotal) {
  const total = Number(currentTotal) || 0;
  if (baselineTotal === null || baselineTotal === undefined) {
    return { status: 'UNVERIFIABLE', total, baseline: null, delta: null };
  }
  const baseline = Number(baselineTotal) || 0;
  const delta = total - baseline;
  if (delta > 0) return { status: 'FAIL', total, baseline, delta };
  if (delta < 0) return { status: 'WARN', total, baseline, delta };
  return { status: 'PASS', total, baseline, delta: 0 };
}

// Pure merge helper for `--rebaseline-conflicts`: returns the NEXT baseline
// map for a database, refusing to raise an existing entry (shrink-only). The
// caller (audit-detection-floor.mjs) is responsible for reading/writing the
// JSON file — this function only decides the number, so it is unit-testable
// without touching the filesystem.
export function nextRatchetBaseline(existingBaseline, measuredTotal) {
  const measured = Number(measuredTotal) || 0;
  if (existingBaseline === null || existingBaseline === undefined) return measured;
  const existing = Number(existingBaseline) || 0;
  return Math.min(existing, measured);
}

// ---- F3: inert detector (WINDOWED — T-465 round 2) ---------------------------
// The important one: a detector reporting zero is indistinguishable from a
// healthy system UNLESS cross-checked against an invariant independently
// known to be violated — but the cross-check must compare LIKE WITH LIKE.
// Round 1 compared a snapshot of violations over ALL rows (any age, any
// cause) against conflicts inserted in the trailing 24h: a violation caught
// days ago with no new writes, or an absolute-implausibility violation that
// never involves cross-source disagreement, was wrongly called "inert".
//
// Round 2: both sides are windowed to the SAME 24h period —
// `windowPopulationSize` is the count of rows whose relevant fields were
// WRITTEN in that window (the population the cross-check is even about);
// `violationsInWindow` is checkPriceBand violations among THOSE rows;
// `conflictsInsertedInWindow` is data_conflicts rows detected in the same
// window. An empty windowed population (nothing written) means the
// cross-check has nothing to say — SKIP, not PASS or FAIL, so a quiet night
// is never silently read as "detector healthy".
export function classifyInertDetector(windowPopulationSize, violationsInWindow, conflictsInsertedInWindow) {
  const population = Number(windowPopulationSize) || 0;
  const inserted = Number(conflictsInsertedInWindow) || 0;
  if (population === 0) {
    return { status: 'SKIP', population, violations: 0, inserted };
  }
  const violations = Number(violationsInWindow) || 0;
  const fail = violations > 0 && inserted === 0;
  return { status: fail ? 'FAIL' : 'PASS', population, violations, inserted };
}
