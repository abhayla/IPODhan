# Item 6 — The pull walk over the plan

## Purpose

After this ships, each data-job cycle (00:00 / 08:00 / 14:00 IST, §2.1) asks one field at a time for
every IPO in phase 1, commits each field's outcome before attempting the next, and can be killed at
any point without losing more than the one field in flight — closing §2.2's rule ("the walk commits
one field at a time and is resumable from any point") against the table item 5 now gives it to do
that in.

## Serves

§2.4 (the per-field loop body, reproduced and wired to item 5's repository), §2.2 (one-field-at-a-time,
resumable-from-any-point — the walk's whole shape), §2.1 (runs inside the data job, takes what's left
of the wake budget after discovery+extraction), §7.1 item 6 ("large — the core", depends on item 5),
and the explicit prerequisite named in §2.5.2: item 15 (`valueActuallyChanged`) must land first or
the walk's own no-op-suppression cannot be verified.

## Files

| Path | State | Change |
|---|---|---|
| `scraper/src/services/field-plan-walk.ts` | **NEW** | The walk itself: claims one field via `FieldPlanRepository.claimNextDueField` (item 5), runs §2.4's rank-1/2/3 loop, calls `consolidatedUpsertIPO` or `consolidatedUpsertChildRows` (item 1) for a `SUPPLIED` outcome, calls `FieldPlanRepository.recordOutcome` (item 5) in every branch, repeats until the field-plan's own budget (see Budget accounting below) is spent or no due field remains. |
| `scraper/src/services/document-cycle.ts` | exists (per the extraction-pass evidence read this session, well over 1200 lines) | A third pass, appended after PASS 2 (extraction, which ends its budget-exhaustion loop around line 1250) — **PASS 3, the field-plan walk** — following the exact pattern PASS 2 already uses: `fieldPlanBudgetMs = Math.max(0, wakeBudgetMs - (now() - startedAt) - PURGE_RESERVE_MS)`, gated by a new `FEATURE_FLAGS.ENABLE_FIELD_PLAN` (item 5), iterating candidates and calling the walk per IPO until the shared wake budget (not a fixed per-pass budget) is exhausted — mirroring PASS 2's own comment: *"extraction gets whatever is LEFT of the shared wake budget after discovery ... never the fixed budget on top of it."* The walk is PASS 3, not a fourth reserved slot, for the identical reason PASS 2 isn't. |
| `scraper/src/services/data-consolidation-service.ts` | exists | **Not modified by item 6 directly** — `valueActuallyChanged` (line 930-931) is item 15's fix, a named prerequisite (see below), not something this card re-implements. Item 6's own detection check (below) depends on item 15 having landed first. |
| `scraper/src/config/feature-flags.ts` | exists | `ENABLE_FIELD_PLAN_WALK` (**NEW**, distinct from item 5's `ENABLE_FIELD_PLAN` which only gates row generation) — the walk's own on/off switch, so the plan table can exist and be populated by items 2/3's generator before the walk is trusted to run against it. |
| `scraper/src/scrapers/*-orchestrator*.ts` (the per-source scrapers the walk's rank-1/2/3 loop calls into — NSE, BSE, Chittorgarh, InvestorGain, and the document extractor via `filing-persister.ts`) | exist | **Not changed by item 6.** The walk calls the SAME orchestrators and the SAME `persistFilingExtraction`/`consolidatedUpsertIPO` entry points that already exist — item 6 is a new caller sitting above them (deciding *when* and *in what order* to call each field's source), not a new fetch implementation. This is deliberate: §2.4's loop is a scheduling and bookkeeping layer, not a twelfth scraper. |

## Schema

No schema change beyond item 5's `ipo_field_plan` (already specified there). Item 6 is a consumer of
that table, not a table of its own.

## Interfaces

```typescript
// scraper/src/services/field-plan-walk.ts

export interface FieldPlanWalkResult {
  ipoId: string;
  fieldsAttempted: number;
  fieldsSupplied: number;
  fieldsExhausted: number;
  fieldsSkippedProtected: number;
  stoppedReason: 'NO_DUE_FIELDS' | 'BUDGET_EXHAUSTED';
}

/**
 * §2.4's loop, run for ONE ipo until its own due fields are drained or the
 * shared budget passed in is spent. The budget is the CALLER's remaining wake
 * budget (document-cycle.ts PASS 3) — this function does not compute its own
 * budget; it is handed a deadline and a "how much is left" callback, exactly
 * the shape PASS 2's extraction loop already uses (`now() - extractionStartedAt
 * >= extractionBudgetMs`).
 */
export async function walkFieldPlanForIPO(
  ipoId: string,
  deps: {
    fieldPlanRepository: FieldPlanRepository;         // item 5
    orchestrator: DataConsolidationOrchestrator;       // item 1's consolidatedUpsertIPO / consolidatedUpsertChildRows
    sourceFetchers: Record<ScraperSource, FieldFetcher>; // one per rank-eligible source, existing scrapers
    protectionFilter?: ProtectionFilter;                // existing admin field-protection gate (filing-persister.ts's own)
  },
  budget: { deadlineMs: number; now: () => number },
  claimToken: string,
): Promise<FieldPlanWalkResult>;

export type FieldFetcher = (
  ipoId: string,
  tableName: string,
  rowKey: string,
  fieldName: string,
) => Promise<
  | { outcome: 'SUPPLIED'; value: unknown; documentId?: string; documentType?: string; sha256?: string; page?: number }
  | { outcome: 'NOT_PRINTED' }
  | { outcome: 'NOT_AVAILABLE_YET' }
  | { outcome: 'CHECK_FAILED'; reason: string }
>;
```

**§2.4's loop, reproduced against these interfaces** (pseudocode the design already specifies,
wired to item 5's real methods rather than left abstract):

```
for each IPO in phase 1, at each of the four slots (the fourth being the 21:00 evening slot, F-42):
  loop:
    if now() >= deadlineMs: return { stoppedReason: 'BUDGET_EXHAUSTED', ... }

    plan = fieldPlanRepository.claimNextDueField(ipoId, claimToken)
    if plan is null: return { stoppedReason: 'NO_DUE_FIELDS', ... }

    if an admin protection row exists for plan.fieldName:
      // §2.7 — skip; do not store a state. Release the claim without recording an outcome.
      fieldPlanRepository.releaseClaimUnrecorded(plan.id, claimToken)  // see note below
      continue

    for rank of [1, 2, 3]:
      source = plan[`rank${rank}Source`]
      if source is null: continue  // this IPO's type has no source at this rank (§2.3.5 capability)
      answer = await deps.sourceFetchers[source](ipoId, plan.tableName, plan.rowKey, plan.fieldName)

      switch answer.outcome:
        case 'SUPPLIED':
          // the §1 check ran INSIDE the fetcher/extractor already (existing code —
          // filing-persister.ts's per-field check.passed gate, or the equivalent
          // website-scraper validation); a plan-level re-check is not this item's job
          writeResult = await orchestrator.consolidatedUpsertIPO / consolidatedUpsertChildRows(...)
          if writeResult.skipped:
            // LOCK_NOT_ACQUIRED — §2.3's false-clean-state guard: do NOT record SUPPLIED
            await fieldPlanRepository.recordOutcome({ id: plan.id, claimToken, state: 'PENDING', nextDueAt: null })
          else:
            await fieldPlanRepository.recordOutcome({
              id: plan.id, claimToken, state: 'SUPPLIED', chosenSource: source, chosenRank: rank,
              chosenDocumentId: answer.documentId, chosenDocumentType: answer.documentType,
              chosenSha256: answer.sha256, chosenPage: answer.page, nextDueAt: null,
            })
          break out of the rank loop
        case 'CHECK_FAILED':
          // record the cause (signal-ownership.md R6: failures carry their cause), try next rank
          continue to rank+1
        case 'NOT_PRINTED':
          continue to rank+1  // no retry, no error — this source never carries it
        case 'NOT_AVAILABLE_YET':
          provisionalAnswer = try rank+1 for a PROVISIONAL value (§2.4's own words)
          await fieldPlanRepository.recordOutcome({
            id: plan.id, claimToken, state: 'NOT_AVAILABLE_YET', nextDueAt: <see backoff note>,
          })
          break out of the rank loop  // field stays due; reclaimed once next_due_at passes

    if every rank failed (fell through without a SUPPLIED/PENDING/NOT_AVAILABLE_YET write):
      await fieldPlanRepository.recordOutcome({ id: plan.id, claimToken, state: 'EXHAUSTED', nextDueAt: <see backoff note> })
      // §2.6: the field's EXISTING value in ipos/the child table is untouched — EXHAUSTED
      // marks the PLAN row only, never blanks the data row. This item does not touch §2.6's
      // "keep, never blank" rule; it is a fact about the existing column value, this walk
      // never writes null over a value that failed re-sourcing.
```

**A gap this pseudocode surfaces that §2.3/§2.4 do not resolve:** `recordOutcome`'s signature (item
5) always bumps `attempts` and writes a `state`. The §2.7 admin-protection skip explicitly must
**not** store a state (*"skip; do not store a state"*) — so a plain call to `recordOutcome` is the
wrong call for that branch. **This item adds `FieldPlanRepository.releaseClaimUnrecorded(id,
claimToken)`** (clears `claimed_at`/`claim_token`, touches nothing else, no `attempts` increment) as
a third repository method beyond item 5's two — named here because item 5's card, written to the
letter of "the two queries the walk runs against it," did not anticipate the skip branch needing a
third one. **Flagged as a fork between the two cards, resolved by adding the method here rather than
silently overloading `recordOutcome` with a "do nothing" mode that a future reader would have to
puzzle out.**

## Feature flag

`ENABLE_FIELD_PLAN_WALK` (`scraper/src/config/feature-flags.ts`, **NEW**). Default **off** in every
slot at first merge. Rollout: **on in staging only**, until the staging proof below passes for at
least one full data-job cycle across a representative IPO set (a mix of MAINBOARD/SME, OPEN/UPCOMING,
at least one with a `financial_statements` multi-year row so item 1's row-key path is exercised).
Then **on in prod**. If the walk cannot sit behind this flag cleanly (it shouldn't need more than
this — it is a new PASS 3, not a change to PASS 1/2's behaviour), that would itself be a defect in
how PASS 3 was wired into `document-cycle.ts`, not a reason to skip the flag.

## Tests

Tier: unit, `scraper/tests/unit/services/field-plan-walk.test.ts` (**NEW**) — **red before the
change** (the module doesn't exist yet):

1. A `PENDING` field with all three ranks fetchable: rank 1 returns `SUPPLIED` — asserts
   `recordOutcome` is called with `state: 'SUPPLIED'`, `chosenRank: 1`, and the write path
   (`consolidatedUpsertIPO`/`consolidatedUpsertChildRows`) was called exactly once.
2. Rank 1 returns `NOT_PRINTED`, rank 2 returns `SUPPLIED` — asserts no error is recorded for rank 1
   (§2.4: "no retry, no error") and the final state credits rank 2.
3. All three ranks `CHECK_FAILED` — asserts `state: 'EXHAUSTED'` and that the field's existing data
   value (passed via a fake existing-row fixture) is **never** written as null — the direct test of
   §2.6's "keep, never blank" rule at the walk's own call site, not re-testing §2.6 itself.
4. `consolidatedUpsertIPO` returns `skipped: true, skipReason: 'LOCK_NOT_ACQUIRED'` for a `SUPPLIED`
   answer — asserts the plan row is left `PENDING`, not `SUPPLIED` (the exact false-clean-state guard
   §2.3 names).
5. An admin-protected field — asserts `releaseClaimUnrecorded` is called and `attempts` is
   unchanged (proves the gap this card surfaces is actually closed, not just described).
6. Budget exhaustion mid-IPO: `now()` advanced past `deadlineMs` between claiming field 2 and field
   3 of a five-field plan — asserts the walk returns `stoppedReason: 'BUDGET_EXHAUSTED'` after
   exactly 2 fields' outcomes were recorded, and the 3rd-5th fields are still `PENDING`/unclaimed
   (nothing left half-written).

Integration, `scraper/tests/integration/field-plan-walk-resume.integration.test.ts` (**NEW**, real
DB — the resume behaviour is exactly what a mock cannot prove): start a walk, kill it (simulate
process exit) after field 2 of 5 is claimed but before `recordOutcome` runs, start a second walk
instance, assert field 2 is reclaimed (via the stale-claim path, item 5) and fields 3-5 are picked up
in the same run — the concrete proof of "resumable from any point" (§2.2).

## Detection

`docs/reviews/detection-checks/pull-noop-suppression.json` (**NEW** — this is check **PULL-NOOP**,
named in §2.5.2: *"writes per cycle divided by fields re-asked per cycle, which on a quiet day must
be near zero"*). Asserts: for a data-job cycle with no newly-filed documents and no genuine source
disagreements, `(field_sources rows written this cycle) / (ipo_field_plan rows with verify_state =
'DUE' or state re-evaluated this cycle)` stays under a small threshold (the design does not name the
threshold numerically — **recommended: under 5%, revisited once real cycle data exists to set it
from measurement rather than a guess**, per OD-18's "no number typed from memory": this is a starting
value stated as a recommendation, not a measured one, and the check's own first weeks of output are
what should replace it). Runs nightly, reads the cycle's `field_sources.updated_at` and
`ipo_field_plan.verify_state`/`updated_at` deltas. **This check is unbuildable-as-meaningful without
item 15** — `valueActuallyChanged` is, per the code read this session
(`data-consolidation-service.ts:930-932`), computed but then masked: `valueChanged = !existingValueFromMap
|| (choseIncoming && (hadDifferentSource || valueActuallyChanged))` — the `hadDifferentSource ||`
means a higher-priority source re-confirming an unchanged value already satisfies `valueChanged` via
`hadDifferentSource` before `valueActuallyChanged` is ever consulted, exactly the "dead on every
tested path" W-106 already found. Until item 15 fixes this, PULL-NOOP would read every
higher-priority-source re-confirmation as a real write, and the check would never go green on a
quiet day even when the walk is behaving correctly — making the check itself unable to distinguish
"verification confirmed N fields" from "verification rewrote N fields identically," which is the
exact indistinguishability the task brief and §2.5.2 both name. **Item 6 does not fix item 15; it
depends on it.**

## Staging proof

After deploying with `ENABLE_FIELD_PLAN_WALK=true` on staging: pick one IPO with a plan already
populated (item 5 + the generator from items 2/3), read before and after one data-job cycle:

```sql
SELECT state, count(*) FROM ipo_field_plan WHERE ipo_id = '<id>' GROUP BY state;
```

Healthy value: `PENDING` count drops between the two reads (fields were attempted), `SUPPLIED` count
rises by the same or a related amount, and no row is left with a non-null `claimed_at` after the
cycle completes (a stuck claim would mean the walk crashed without releasing it — the resume test
above proves this in isolation; this staging read proves it under a real cycle's real timing).
Second line: the PULL-NOOP counter (once item 15 lands) reads near-zero on a cycle where no document
changed. Cycle: the first 00:00/08:00/14:00 data-job run after deploy that reaches this IPO within
its wake budget — if PASS 3 never gets budget on a given cycle (PASS 1+2 consumed it all), that is
itself worth reading from the cycle's own log line (`document-cycle.ts`'s existing
budget-exhaustion warning, extended to name PASS 3 the same way PASS 1/2 already do) before treating
a quiet plan table as evidence the walk works.

## Rollback

Turn `ENABLE_FIELD_PLAN_WALK` off. Nothing the walk wrote is destructive — every write it makes goes
through item 1's per-field consolidated writer, which means every changed value has a `field_sources`
row recording the previous value and source (per `defect-fix-contract.md`'s "reversible with effort"
class, matching §7.2's own classification of items 4-8 including this one). A bad batch from the
walk can be rolled back per field by replaying `field_sources.previousValue`/`previousSource` — this
card does not build that replay tool; it is implied by item 1's provenance but is its own utility if
ever needed, named here rather than assumed to already exist.

## Tier, budget and cost

**Tier A** — the core of the whole pull loop (§7.1: "large — the core"), touching every field this
design's 190 D/T/X/W/M-class fields cover, run unattended three (soon four) times a day against
production data. `Budget: 60 min wall-clock, 120 tool calls`. Cost: high — §7.1 places it after items
1, 2, 3, 5 for a reason (nowhere to write, no manifest to read, no plan to claim from, without them),
and this card's own dependency on item 15 (not listed as a direct §7.1 dependency edge, but named
explicitly in §2.5.2 as a prerequisite "rather than a follow-up") means a reviewer should confirm
item 15 has actually landed — not just been scheduled — before approving this item's merge, or the
PULL-NOOP detection check ships unable to do its one job.
