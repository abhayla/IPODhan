# W-161: conflict detection has been at a 0% rollout since launch (Fable, 2026-09-05 18:09 IST)

## Correction (18:10 IST)
feature-flags.ts:380-392 says CONFLICT_DETECTION_PERCENTAGE is NEVER consulted (ENABLE_CONFLICT_DETECTION is a plain boolean, true on both slots) and data-persister.ts:840 passes shadowMode=false in production, so the percentage is NOT why the conflicts table is empty. The real reason for 0 rows (write never reached, silently failing upsert, or the W-79 same-source refusal) is with the W-160 round-2 reviewer; item 2 below (rollout to 100%) is therefore moot and item 1 stands.

## Fact (as first written)
Both slots log `CONFLICT_DETECTION: true, CONFLICT_DETECTION_PCT: 0` at every scraper start
(feature-flags.ts:249 `CONFLICT_DETECTION_PERCENTAGE` defaults to 0). The W-160 review traced the
HOLD path's `upsertConflict` to a gate that includes shadow mode, and prod has 0 `data_conflicts`
rows for Kanohar after weeks of holds. The conflicts table, the "conflicts repo refuses same-source"
work (W-79) and every conflict-based audit have therefore never seen real data in production.

## Decision
1. W-160 round 2 makes the live-IPO HOLD write its conflict row regardless of the rollout
   percentage (it is the audit trail, not a detection feature). If the reviewer finds "shadow mode"
   itself derives from the percentage, the write must be lifted out of that gate too.
2. Separate owner decision for the next release: set `CONFLICT_DETECTION_PERCENTAGE=100` on staging
   first (one soak day: row volume, notifier noise), then prod. The flag has never been exercised at
   scale; expect a burst of rows on the first cycle (every disputed HIGH_VALUE field on every live IPO).
3. `audit:substance` gains "conflict rows written in the last 24 h > 0 while holds were logged"
   so a dead conflicts table is a red audit, not a silent one.

## Not decided here
Whether a HOLD without a conflict row should be treated as a defect retroactively (backfill from
logs): no; the next release's first cycle rebuilds the current state.
