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
 * Monotonic-`when` is checked only for entries at/after this idx. Real repo
 * history has a pre-existing, already-DEPLOYED anomaly below this boundary
 * (idx 12 / 0021_add_promoter_holding_fields has a lower `when` than idx 11)
 * that predates this lint and is harmless now — every migration up to and
 * including 0049 (idx 32) is already applied in production, so a stale
 * ordering among them can no longer cause a skip. Round 3 (T-403) fixed the
 * live case that WOULD have caused a skip (idx 33 vs idx 32) by giving idx 33
 * a `when` above 0049's; this boundary keeps that pair (and every future
 * pair) covered while not resurrecting unrelated historical drift as a new
 * CI failure.
 */
export const MONOTONIC_CHECK_FROM_IDX = 33;

/**
 * Future-dated `when` is checked only for entries strictly AFTER idx 33.
 * idx 33 itself (20260906090638_icy_firelord, when=1789032000000) is
 * deliberately excluded: to satisfy MONOTONIC_CHECK_FROM_IDX against idx 32
 * (0049_ipo_details_ad_fields, hand-typed when=1789031999000, ~2026-09-10),
 * idx 33's `when` had to be pushed to just above it — which makes idx 33
 * itself future-dated too, as an unavoidable side effect of the repair, not a
 * new instance of the mistake. Once real time passes 2026-09-10, this
 * boundary can be safely reused for new entries without further action
 * (their real `when` will naturally exceed 0049's inflated one on its own).
 */
export const FUTURE_CHECK_AFTER_IDX = 33;

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
 * Entries strictly after FUTURE_CHECK_AFTER_IDX must not be dated more than
 * ~24h into the future relative to `nowMs` — that class (hand-typed dates up
 * to 2026-09-10) is exactly what caused blocker 1.
 *
 * This rule and MONOTONIC_CHECK_FROM_IDX contradict each other until real
 * time passes 2026-09-10 (idx 33's when=1789032000000): a migration authored
 * THIS week must sort above idx 33 (monotonic rule) but idx 33 is already
 * >24h in the future, so "when > previous.when" and "when <= now+24h" cannot
 * both hold for a real, honestly-timestamped new entry. The allowed ceiling
 * is therefore the LARGER of the two floors an honest entry must clear:
 * `max(nowMs + 24h, previousEntry.when + 1ms)` — i.e. a migration may be
 * future-dated exactly as far as it MUST be to stay monotonic against a
 * future-dated predecessor, never further. Once real time passes 2026-09-10
 * this collapses back to the plain `nowMs + 24h` ceiling on its own, since
 * idx 33's `when` will no longer be ahead of `nowMs`.
 * @param {JournalEntry[]} entries
 * @param {number} nowMs
 * @returns {string[]}
 */
export function findFutureDatedWhen(entries, nowMs) {
  const violations = [];
  const sorted = [...entries].sort((a, b) => a.idx - b.idx);
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.idx <= FUTURE_CHECK_AFTER_IDX) continue; // grandfathered, see doc above
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
