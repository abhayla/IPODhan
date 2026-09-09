// Pure predicates for the migration-journal linter (T-403 round 3, blocker 1).
//
// Root cause this guards: drizzle-orm's migrator (drizzle-orm/pg-core/dialect.js)
// only runs a journal entry whose `when` is STRICTLY GREATER than
// MAX(created_at) already recorded in the drizzle migrations table. Entries
// 0045-0049 in this repo carry hand-typed `when` values dated into the future
// (up to 2026-09-10 / 1789031999000) instead of the real authoring time. A
// migration authored for real on 2026-09-06 (`when` ~1788685598881) sorts
// BELOW those future-dated entries and is silently skipped by the migrator on
// prod/staging — while scripts/assert-migrations-applied.sh (which compares
// MAX(when) to MAX(created_at)) still reports success, because it never checks
// that every individual entry's `when` was actually applied.
//
// This module is imported by BOTH the live gate
// (scripts/ci/check-migration-journal.mjs) and its self-test
// (scripts/tests/check-migration-journal.test.mjs) so a weakened predicate
// turns the self-test red before it can stop catching the class again.

/**
 * @typedef {{ idx: number, when: number, tag: string, version?: string, breakpoints?: boolean }} JournalEntry
 */

/**
 * Monotonic-`when` is checked only for entries at/after this idx.
 *
 * Two anomalies sit below this boundary, and idx 33 is the smaller value
 * that clears BOTH of them (verified against the real journal, not assumed):
 *
 *   1. idx 12 / 0021_add_promoter_holding_fields has a lower `when` than
 *      idx 11 — a pre-existing, already-DEPLOYED anomaly that predates this
 *      lint. On its own this would only require the boundary to be >= 13.
 *   2. idx 31 / 0048_ipo_valuation_share_legs carries a hand-typed `when`
 *      (1788945600000, an exact "09:20:00" timestamp matching the same
 *      hand-typed pattern as the entries GitHub #442 fixed) that is HIGHER
 *      than idx 32's honest, corrected `when` (1788685590000) — because
 *      0049 (idx 32) was actually authored two days before idx 31's synthetic
 *      date. This is the pair that actually forces the boundary to 33; idx 12
 *      alone would not. Fixing idx 31 is out of scope for this change (not
 *      one of the three entries #442 named), so the boundary stays at 33.
 *
 * The real reason the boundary sits at 33, spelled out: idx 25-31 carry a
 * fabricated one-per-day ladder (each hand-typed to an exact "09:20:00.000Z",
 * one calendar day after the last — not real authoring times, just invented
 * to look ascending). Correcting idx 32 to its true, honest date (this
 * change round, GitHub #442) pulled it BELOW idx 31's fabricated date,
 * creating exactly one monotonic drop: idx 31 -> idx 32. That drop is a KNOWN, PINNED exception — see the
 * `findNonMonotonicWhen` regression test asserting it is the ONLY monotonic
 * violation in the journal (scripts/tests/check-migration-journal.test.mjs).
 * It does NOT get corrected here: idx 25-31's true authorship times are
 * unknown, and hand-typing a second set of fabricated dates over the first
 * would not be an improvement — every slot has already applied them, so no
 * database anywhere needs their ordering to be right any more.
 *
 * The drop is harmless ONLY because (a) idx 32-34 are already applied on
 * every existing slot (prod, staging, dev, ipodhan_test) — a database that
 * already has 0049/icy_firelord/left_loners recorded never re-evaluates
 * them — and (b) a genuinely FRESH database (nothing yet recorded in the
 * drizzle migrations table) runs the whole journal in idx order against a
 * migrations-table baseline of "nothing recorded", so every entry clears the
 * "when > previously recorded max" test regardless of the 31/32 ordering.
 *
 * It would STOP being harmless for exactly one condition: a database whose
 * recorded state sits precisely between idx 31 and idx 32 — i.e. 0048 (idx
 * 31, `when`=1788945600000) has been applied and recorded as the migrations
 * table's max `created_at`, but 0049 (idx 32, `when`=1788685590000) has not
 * yet run. A `db:migrate` against such a database would compare idx 32's
 * lower `when` against idx 31's higher recorded max, fail the strict-greater
 * check, and silently skip 0049 forever — the exact class this whole file
 * exists to catch. No such database is known to exist today (every real
 * slot's rebuild/restore path applies the full journal from empty, case (b)
 * above), but a partial restore, a manual migrations-table edit, or a new
 * migration path that starts mid-journal would create it. If one is ever
 * found, treat it as a live recurrence of GitHub #442's class, not a new bug.
 */
export const MONOTONIC_CHECK_FROM_IDX = 33;

/**
 * Future-dated `when` is checked for every entry — no idx-based exemption.
 *
 * Round 3 (T-403) had grandfathered idx <= 33 here because idx 33's `when`
 * had been pushed to just above idx 32's hand-typed future date to satisfy
 * MONOTONIC_CHECK_FROM_IDX, which made idx 33 itself future-dated as a side
 * effect. GitHub #442's fix corrects idx 32, 33 and 34 to their honest,
 * real-time `when` values, so none of them are future-dated any more and the
 * exemption that hid that class from CI is no longer needed for them — or for
 * any earlier entry, since every entry in the real journal predates `now`.
 * Removing the exemption (rather than just moving its boundary) is what
 * makes a recurrence of GitHub #442's mistake — a new hand-typed future
 * `when` at ANY idx, not only a fresh one above the old boundary — fail CI
 * instead of silently passing.
 */
export const FUTURE_CHECK_AFTER_IDX = -1;

// A generous "future" tolerance IS the hole this fix closes: a 24h window let
// an entry dated 16-17h ahead of real time (idx 32-34 pre-#442) pass this
// check silently, even though any positive `when` ahead of the real authoring
// time is exactly the class that causes drizzle's migrator to skip an entry
// once real time catches up to it. The only legitimate slack here is clock
// skew between the machine that generated the migration and the machine
// running this check — not a day of cover for hand-typed future dates.
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Entries at/after MONOTONIC_CHECK_FROM_IDX must have strictly increasing
 * `when` values relative to the immediately preceding entry (by idx order).
 * This is the exact invariant drizzle's migrator relies on to decide what
 * counts as "new".
 * @param {JournalEntry[]} entries
 * @returns {string[]} violation messages, empty when clean
 */
export function findNonMonotonicWhen(entries) {
  const violations = [];
  const sorted = [...entries].sort((a, b) => a.idx - b.idx);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.idx < MONOTONIC_CHECK_FROM_IDX) continue; // pre-existing, already-deployed drift — see doc above
    if (cur.when <= prev.when) {
      violations.push(
        `idx ${cur.idx} (${cur.tag}) has when=${cur.when}, which is <= idx ${prev.idx} (${prev.tag})'s when=${prev.when}. ` +
          `drizzle's migrator only applies an entry whose when is strictly greater than the last applied created_at — ` +
          `this entry would be silently skipped.`
      );
    }
  }
  return violations;
}

/**
 * No entry — at any idx — may be dated more than a small clock-skew margin
 * into the future relative to `nowMs`. A wide tolerance (this rule used to
 * allow a full 24h) is itself the defect: idx 32-34 pre-#442 were only
 * 16-17h ahead of real time and sailed through a 24h check without a single
 * violation, even though a `when` ahead of the real authoring time is
 * exactly the class that causes drizzle's migrator to skip an entry once
 * real time catches up to it (T-403 round 3, blocker 1; GitHub #442). The
 * tolerance is CLOCK_SKEW_TOLERANCE_MS (5 minutes) — enough to absorb clock
 * drift between the machine that ran `drizzle-kit generate` and the machine
 * running this check, not enough to hide a hand-typed future date.
 *
 * The one remaining wrinkle is idx 31 (0048_ipo_valuation_share_legs, a
 * hand-typed `when` this change does not correct — see
 * MONOTONIC_CHECK_FROM_IDX): it is NOT future-dated today (it fell into the
 * past earlier today, real time having caught up to its 09:20 timestamp), so
 * it passes this check without needing an exemption. If
 * MONOTONIC_CHECK_FROM_IDX allowed the monotonic rule and this rule to
 * require mutually-exclusive `when` values for some entry in the future, the
 * allowed ceiling is the LARGER of the two floors an honest new entry must
 * clear: `max(nowMs + CLOCK_SKEW_TOLERANCE_MS, previousEntry.when + 1ms)` —
 * i.e. a migration may be future-dated exactly as far as it MUST be to stay
 * monotonic past a future-dated predecessor, never further.
 *
 * That ceiling exemption is granted ONLY when the predecessor itself passed
 * this same check. Once a predecessor is a violation (e.g. idx 32's
 * hand-typed 2026-09-10 date pre-#442), its `when` is not an honest floor any
 * more, and a successor that merely clears it (idx 33, 34 — each hand-typed
 * exactly 1ms/500ms past its predecessor to satisfy the OLD monotonic rule)
 * is riding the same defect, not obeying a legitimate constraint. Without
 * this guard, a single bad future `when` would cascade into an unbounded
 * chain of "monotonically excused" future entries — precisely how idx 33 and
 * 34 slipped past the old 24h check even though they were, in absolute
 * terms, exactly as future-dated as idx 32.
 * @param {JournalEntry[]} entries
 * @param {number} nowMs
 * @returns {string[]}
 */
export function findFutureDatedWhen(entries, nowMs) {
  const violations = [];
  const sorted = [...entries].sort((a, b) => a.idx - b.idx);
  let prevViolated = false;
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.idx <= FUTURE_CHECK_AFTER_IDX) {
      // no-op today: FUTURE_CHECK_AFTER_IDX = -1, no real idx is <= -1
      prevViolated = false;
      continue;
    }
    const prev = sorted[i - 1];
    const minimumMonotonicCeiling = prev && !prevViolated ? prev.when + 1000 : -Infinity;
    const allowedMax = Math.max(nowMs + CLOCK_SKEW_TOLERANCE_MS, minimumMonotonicCeiling);
    const violated = e.when > allowedMax;
    if (violated) {
      violations.push(
        `idx ${e.idx} (${e.tag}) has when=${e.when}, more than ${CLOCK_SKEW_TOLERANCE_MS}ms in the future relative to now (${nowMs}) ` +
          `and beyond the minimum needed to stay monotonic past its predecessor (allowed max ${allowedMax}). ` +
          `Hand-typed future dates are exactly the class that caused a migration to be silently skipped (T-403 round 3). ` +
          `Fix the machine's clock and regenerate this migration (drizzle-kit generate) so its 'when' is stamped fresh — ` +
          `do NOT hand-edit the 'when' value in meta/_journal.json; a hand-edit here is exactly the act that caused #442.`
      );
    }
    prevViolated = violated;
  }
  return violations;
}

/**
 * Snapshot files are named by the numeric/timestamp PREFIX of the tag (e.g.
 * tag `0047_intermediary_role_sub_syndicate` -> `meta/0047_snapshot.json`),
 * not the full tag. Extract that key.
 * @param {string} tag
 * @returns {string}
 */
export function snapshotKey(tag) {
  return tag.split('_')[0];
}

/**
 * Every journal entry's tag must resolve to an actual .sql migration file on
 * disk (true for every entry in this repo's real history — a cheap,
 * unconditional check). Snapshot coverage is NOT unconditional: this repo's
 * real history has gaps (idx 12, 14-29, 31-32 have no snapshot — drizzle-kit
 * only needs the LATEST snapshot to diff against, and older ones were pruned
 * or a manual SQL migration skipped regeneration; see the 0047 "baseline
 * snapshot" restore in commit e3866d01). Rather than pretend that history is
 * clean, the snapshot check is scoped to entries at/after
 * MONOTONIC_CHECK_FROM_IDX — i.e. every migration added from now on must
 * carry a snapshot, so `drizzle-kit generate` was demonstrably run against it.
 * @param {JournalEntry[]} entries
 * @param {Set<string>} sqlTags - tags with a matching migrations/<tag>.sql file
 * @param {Set<string>} snapshotKeys - snapshotKey() values with a matching meta/<key>_snapshot.json file
 * @returns {string[]}
 */
export function findMissingArtifacts(entries, sqlTags, snapshotKeys) {
  const violations = [];
  for (const e of entries) {
    if (!sqlTags.has(e.tag)) {
      violations.push(`idx ${e.idx} (${e.tag}) has no matching .sql migration file.`);
    }
    if (e.idx >= MONOTONIC_CHECK_FROM_IDX && !snapshotKeys.has(snapshotKey(e.tag))) {
      violations.push(
        `idx ${e.idx} (${e.tag}) has no matching snapshot file in meta/ — run \`npm run db:generate\` before committing.`
      );
    }
  }
  return violations;
}

/**
 * Run all checks and return the combined violation list.
 * @param {JournalEntry[]} entries
 * @param {{ nowMs: number, sqlTags: Set<string>, snapshotKeys: Set<string> }} ctx
 * @returns {string[]}
 */
export function lintJournal(entries, ctx) {
  return [
    ...findNonMonotonicWhen(entries),
    ...findFutureDatedWhen(entries, ctx.nowMs),
    ...findMissingArtifacts(entries, ctx.sqlTags, ctx.snapshotKeys),
  ];
}
