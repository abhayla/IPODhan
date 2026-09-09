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
 * Every migration up to and including 0049 (idx 32) is already applied in
 * production, so stale ordering among entries below this boundary can no
 * longer cause a skip. Once idx 31's hand-typed `when` is itself corrected in
 * a future change, this boundary can be revisited — re-run the check with a
 * lower value against the live journal before lowering it, the same way this
 * comment was verified.
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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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
 * No entry — at any idx — may be dated more than ~24h into the future
 * relative to `nowMs` — that class (hand-typed dates up to 2026-09-10) is
 * exactly what caused blocker 1, and GitHub #442's fix means every real entry
 * in the journal today is honestly past-dated, so there is no longer any
 * entry that needs an exemption from this rule (see FUTURE_CHECK_AFTER_IDX).
 *
 * The one remaining wrinkle is idx 31 (0048_ipo_valuation_share_legs, a
 * hand-typed `when` this change does not correct — see
 * MONOTONIC_CHECK_FROM_IDX): it is NOT future-dated today, so it passes this
 * check without needing an exemption. If MONOTONIC_CHECK_FROM_IDX allowed the
 * monotonic rule and this rule to require mutually-exclusive `when` values
 * for some entry in the future, the allowed ceiling is the LARGER of the two
 * floors an honest new entry must clear: `max(nowMs + 24h, previousEntry.when
 * + 1ms)` — i.e. a migration may be future-dated exactly as far as it MUST be
 * to stay monotonic past a future-dated predecessor, never further.
 * @param {JournalEntry[]} entries
 * @param {number} nowMs
 * @returns {string[]}
 */
export function findFutureDatedWhen(entries, nowMs) {
  const violations = [];
  const sorted = [...entries].sort((a, b) => a.idx - b.idx);
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.idx <= FUTURE_CHECK_AFTER_IDX) continue; // no-op today: FUTURE_CHECK_AFTER_IDX = -1, no idx is <= -1
    const prev = sorted[i - 1];
    const minimumMonotonicCeiling = prev ? prev.when + 1000 : -Infinity;
    const allowedMax = Math.max(nowMs + ONE_DAY_MS, minimumMonotonicCeiling);
    if (e.when > allowedMax) {
      violations.push(
        `idx ${e.idx} (${e.tag}) has when=${e.when}, more than 24h in the future relative to now (${nowMs}) ` +
          `and beyond the minimum needed to stay monotonic past its predecessor (allowed max ${allowedMax}). ` +
          `Hand-typed future dates are exactly the class that caused a migration to be silently skipped (T-403 round 3).`
      );
    }
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
