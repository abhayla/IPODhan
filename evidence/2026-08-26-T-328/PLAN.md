# T-328 PLAN — HOLD disputed HIGH_VALUE fields on live IPOs (LIFECYCLE-1 step)

## Environment note (non-blocking)
The contract's evidence path `D:\Abhay\GetWorkDone\evidence\2026-08-26-T-328\` is
unreachable from this worktree — `D:` mounts as a read-only ISO (`OPENSTACK`) with
no `Abhay` tree. Evidence is committed in-repo instead at
`evidence/2026-08-26-T-328/` (the same convention cited by prior tasks, e.g.
`evidence/2026-08-23-T-298/`). Flagged in the final JSON `notes`.

## Reproduction of the reviewer's claim (read of code, not live DB — read-only
DB access isn't available in this worktree; the mechanism is confirmed by tracing
the write path)

1. `scraper/src/services/cross-source-disagreement-monitor.ts::checkCrossSourceDisagreements`
   reads UNRESOLVED `data_conflicts` rows for OPEN IPOs on `HIGH_VALUE_FIELDS =
   {priceRangeMin, priceRangeMax, openDate, closeDate}` and fires a P1
   `notifyOwner` per row. **It is read-only** — it never touches `ipos` or the
   write path. Detection and correction are two separate code paths with zero
   coupling today.
2. The write path (`data-persister.ts:380` → `DataConsolidationService
   .consolidateIPOData` → `consolidateField` → `resolveConflict`,
   `data-consolidation-service.ts:462-794`) has no status/lifecycle awareness at
   all. `resolveConflict` picks a winner purely by `getSourcePriority(fieldName,
   source)` (§`field-priority-matrix.ts:696`), independent of whether the IPO is
   live.
3. **Confirmed gap**: `field-priority-matrix.ts` has entries for `open_date`/
   `close_date` (snake_case) but **no `openDate`/`closeDate` camelCase entries**
   (unlike `listingDate`, which has both — see the comment at line 453 admitting
   the dual-key pattern is required and was done for `listingDate` only).
   `data-persister.ts` writes/reads the **camelCase** keys
   (`ipoData.openDate`/`closeDate`, confirmed at `data-persister.ts:366-368`).
   So `getFieldRules('openDate')` falls through to the DEFAULT rule:
   `sources: ['ADMIN','NSE','BSE','DRHP','MONEYCONTROL','CHITTORGARH','API_FALLBACK']`
   — NSE (index 1) beats CHITTORGARH (index 5). This is exactly the mechanism
   the reviewer describes: NSE's off-by-one-day value wins by default priority,
   gets written to `ipos.openDate`, `data_conflicts` gets a P1 alert (from the
   monitor above), and separately:
4. `web/lib/services/status-updater-service.ts::updateIPOStatuses` (the LIVE
   status-flip path — confirmed live via `scraper/src/index.ts:286`
   `triggerStatusUpdate()` → `POST /api/admin/status/update` →
   `updateIPOStatuses()`; the scheduler-based `update-statuses.ts` job is
   confirmed DEAD, per its own T-300F comment: "This job only exists inside
   `SchedulerService`, which prod never imports") recomputes status **purely
   from `ipos.openDate/closeDate/listingDate` already in the DB** via
   `computeTargetStatus`, with zero awareness that the date it's reading was
   contested minutes ago. Once NSE's wrong `openDate` lands, the very next
   hourly status-updater cycle flips UPCOMING→OPEN on it.

This confirms the reviewer's shape exactly: detection (the monitor) fires an
alert describing a fact the correction path (consolidation + status-updater)
has already overwritten and acted on, with no shared state between them.

## Where the fix lands (LIFECYCLE-1, no new tables, per the converged order)

Two chokepoints, following the reviewer's option (a) refuse-to-flip +
option (b) surface-the-dispute, plus the interim TZ tie-break (option c):

1. **`data-consolidation-service.ts::resolveConflict`** — add a `status`
   parameter (threaded from `ConsolidateIPODataInput.existingData.status`,
   already on the row, per LIFECYCLE-1's "needs only `ipos.status`" mandate).
   When resolving a HIGH_VALUE field (`priceRangeMin`, `priceRangeMax`,
   `openDate`, `closeDate` — the same set the monitor already treats as
   HIGH_VALUE) on a live IPO (`status IN ('OPEN','UPCOMING')`) AND the incoming
   value disagrees with the existing value AND neither is a NULL-side (a real
   two-value conflict, not a missing-field non-conflict already short-circuited
   above at line 518): apply the TZ tie-break first (see below); if the
   tie-break doesn't resolve it (not a 1-day NSE-vs-other delta), **HOLD**:
     - `finalValue` = the existing (previously published) value, never the
       incoming one — the row's served value never asserts one-sided.
     - `hadConflict: true`, `conflictReason: 'HELD_DISPUTED_HIGH_VALUE_LIVE'`.
     - `data_conflicts` row is written (existing `logConflict`/`upsertConflict`
       plumbing, unresolved, `resolutionReason: 'HELD_DISPUTED_HIGH_VALUE_LIVE'`)
       so the UI/monitor can read the dispute — no new table.
     - A structured `logger.warn` tagged `hold_status_transition` fires (this
       is the write-side log; see item 2 for the status-engine's own log).
   For a LOW_VALUE field (anything not in the HIGH_VALUE set) or a non-live IPO
   (CLOSED/LISTED), behavior is UNCHANGED — existing SOURCE_PRIORITY resolution
   applies as today (negative control, DoD item 2).
   For "first-sight, no previous value" (Case 1, line 556 — `normalizedExisting
   === null`), this is already handled correctly upstream — nothing to change;
   HOLD only applies when there IS a previously-published value being contested
   (per DoD item 1's "first-sight with no previous value: publish nothing +
   surface pending verification" — that is already the current behavior for the
   very first observation, since there is no "previous" to defend).

2. **`status-updater-service.ts::computeTargetStatus`/`updateIPOStatuses`** —
   before flipping UPCOMING→OPEN (or any transition driven by a date field),
   check whether the driving date field (`openDate` for UPCOMING→OPEN,
   `closeDate` for OPEN→CLOSED) has an UNRESOLVED HIGH_VALUE `data_conflicts`
   row for this IPO (read via `DataConflictsRepository.findUnresolvedForIPO`,
   already exists, no new table/query shape). If disputed: skip the transition
   for this IPO this cycle, log a structured `hold_status_transition` warning
   (ipoId, field, from/to status, the disputed value), and continue to the next
   row. This is the second half of "refuse to flip status on a disputed date" —
   HOLD in the consolidation service stops the WRONG value from being written,
   but if a wrong value were already resolved+written by an older code path (or
   admin-restored) with a lingering unresolved conflict row, the status engine
   independently refuses to act on it. Belt-and-suspenders, cheap, no new state.

## Tie-break (DoD item 3, interim + removable)

Inside `resolveConflict`, before falling into HOLD: if `fieldName` is `openDate`
or `closeDate`, both values parse as valid dates, and they differ by EXACTLY one
calendar day, AND one of `existingSource`/`incomingSource` is `'NSE'`: prefer the
**non-NSE** value (`chosenSource`/`chosenValue` = whichever isn't NSE),
`resolutionReason: 'TZ_SIGNATURE_TIEBREAK_PREFER_NON_NSE'`, and record the reason
on the `data_conflicts` row. This resolves the conflict (not a HOLD) — the
non-NSE value is asserted with an explicit, auditable reason. A code comment
ties this to T-327 ("remove this tie-break once T-327 lands nse-api-client.ts
date-parsing timezone fix — verify by re-running the Lumino-shape RED test; it
should no longer trigger this branch because NSE will report the correct date").

## UI marker (DoD item 4)

`DataConflictsRepository.findUnresolvedForIPO(ipoId)` already exists and returns
unresolved rows with `fieldName`. In `web/app/ipos/[slug]/page.tsx`, fetch
unresolved HIGH_VALUE disputes for the IPO (new thin repo call, no new table) and
pass a `disputedFields: Set<string>` down to the two places that render the
disputed values today: the "Price Band" cell and the "Open–Close" cell in
`ribbonCells` (page.tsx lines 299-334). When a cell's underlying field is
disputed, append a small inline marker (reuse the OFS/T-310 "Last updated"
convention's visual language: `text-xs text-muted-foreground` + an amber dot) —
"Under verification" — instead of asserting the number as settled fact. Minimal:
one new prop threaded into `FactRibbon`'s `RibbonCell` (`disputed?: boolean`)
rendering a small badge next to the value; no new component tree.

## Alert-to-correction link (DoD item 5)

`cross-source-disagreement-monitor.ts`'s P1 `notifyOwner` body currently reads
`"${source1}="${value1}" vs ${source2}="${value2}" (open IPO, unresolved)."` —
this predates HOLD and describes the disagreement but not the system's action.
After HOLD lands, the monitor is extended to state what happened: "HELD — no
value published change; ${publishedValue} (${publishedSource}) stays live" or,
when the tie-break resolved it, "TIE-BROKEN — preferred ${nonNseSource}
(${chosenValue}) over NSE per the T-327 TZ-signature interim rule." This requires
the monitor to read the SAME `data_conflicts.resolutionReason` HOLD/tie-break now
writes — no schema change, just reading a field that already exists.

## Commit sequence (one commit per DoD item, push after each)

1. `docs(T-328): PLAN.md` — this file.
2. `fix(scraper): HOLD disputed HIGH_VALUE fields in resolveConflict (T-328)` —
   mechanism + RED-then-GREEN tests + negative control (LOW_VALUE unaffected).
3. `fix(scraper): status-updater refuses to flip status on disputed date (T-328)`
   — the belt-and-suspenders half of HOLD.
4. `fix(scraper): TZ-signature tie-break for 1-day NSE date deltas (T-328)`.
5. `fix(web): 'under verification' marker for disputed live-IPO fields (T-328)`
   — UI + visual check at 390/768/1280.
6. `fix(scraper): alert body states HELD/tie-broken action, not raw values (T-328)`.
7. Final: STATUS.md audit, PR opened.

## Explicitly out of scope (per contract's coordination boundary)

- `nse-api-client.ts` date parsing (T-327 owns the root-cause TZ fix).
- `issueSize`/lot validation (T-329).
- No data repairs to already-corrupted rows (T-327/T-329's job).
- No new tables — `data_conflicts` + `field_sources` as-is.
