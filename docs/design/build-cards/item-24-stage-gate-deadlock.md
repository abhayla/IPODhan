# Item 24 — break the stage-gate deadlock: promote to PRE_OPEN on facts the pipeline cannot suppress

Status: DONE 2026-09-19 PRs #798 proof 2026-09-19 board

Issue: #795 · Failure class: `stage gate requires the value the gated work would supply`
(`docs/reviews/failure-classes/stage-gate-requires-the-value-it-would-supply.json`)

## Core

**Core:** `deriveLifecycleStage` must promote an UPCOMING issue to PRE_OPEN without reading the
price band, so that `PRICE_BAND_AD` becomes due and the document that supplies the band is actually
fetched.

**Proof:** on staging, an UPCOMING IPO with `price_range_min IS NULL` gains a `PRICE_BAND_AD` row in
`document_fetch_state` after one real cycle. Today that is impossible for any such IPO — measured
16 of 16, below.

## Purpose

`deriveLifecycleStage` (`scraper/src/scheduler/stage-reconciler.ts:153-163`) promotes UPCOMING →
PRE_OPEN **only when a price band is already present**:

```ts
if (status === 'UPCOMING') {
  const hasBand = min !== null && min !== undefined && Number(min) > 0;
  return hasBand ? 'PRE_OPEN' : 'UPCOMING';
}
```

`PRICE_BAND_AD` is first due at PRE_OPEN (`document-state-machine.ts:85-102`):

```ts
UPCOMING: ['DRHP'],
PRE_OPEN: ['RHP', 'PRICE_BAND_AD', 'CORRIGENDUM', 'RATIOS_BASIS_ISSUE_PRICE', 'ANCHOR_ALLOCATION_REPORT'],
```

So: **no band → stage stays UPCOMING → PRICE_BAND_AD is never due → the advertisement that carries
the band is never fetched → no band.** The document that would supply the value is gated behind
already having the value.

Most IPOs escape only because exchange board data incidentally carries the band. That side channel
is what makes a systematic gate look like an intermittent minority bug.

## Serves

**The gate, 16 of 16 UPCOMING IPOs — a perfect split, not a scatter:**

| Has a band | count | `document_fetch_state` rows |
|---|---|---|
| yes | 14 | 6 each |
| no | 2 (Anand Seamless opens 09-22, Liqvd Digital opens 09-23) | **1 each (DRHP only)**, 0 documents |

A budget or ordering problem scatters by queue position; a gate produces a clean split.

**Disproved first RCA (recorded so it is not re-attempted):** budget starvation. The #468 rank-2
reservation is ON and firing (`upcomingReserved:1`, `upcomingProcessedAfterBudget:1`); the two IPOs
were visited **23 times across 78 elapsed cycles**; on every visit
`dueDocTypesForStage('UPCOMING')` returns `['DRHP']` only. Raising `UPCOMING_RESERVE_SLOTS` changes
nothing.

**N, measured across many IPOs.** `documents.filing_date` is 0 of 21 populated, so the true
FILING-to-open window is underivable. `field_sources` has 620 band rows over 310 IPOs; three nested
populations:

| population | n | median | p90 | max |
|---|---|---|---|---|
| all IPOs with a band | 310 | −30 | 5 | 12 |
| live-watched (row created before open) | 67 | 5 | 7 | 12 |
| **band watched arriving** (IPO known ≥2d before the band) | **17** | **4** | **5.8** | **7** |

The first is backfill (242 of 310 bands recorded AFTER the IPO opened, min −2085) and must not be
quoted. The third is the honest cut; its distribution is `0d:2, 1d:3, 2d:3, 4d:4, 5d:3, 7d:2`.

**Reading: use the upper end, not the median.** 5 of 17 (29%) had the band recorded 0–1 days before
open, so a median-sized window promotes too late for nearly a third of IPOs. **N = 7 days.** Being
early costs a few `NOT_YET_FILED` attempts the state machine already handles; being late costs a
blank price band on a live IPO.

**Caveat, load-bearing:** this measures when WE RECORDED the band, not when the issuer FILED it. It
is a LOWER bound on earliness, so the true value pushes N up, never down — safe for this fix. A
reviewer may challenge N=7 on this evidence; it must not be inherited unexamined.

## Files

| File | Change |
|---|---|
| `scraper/src/scheduler/stage-reconciler.ts` | `deriveLifecycleStage`: replace the `hasBand` test for UPCOMING with the multi-signal, null-safe rule below. Add `openDate` and `hasRhpOnFile` to `ReconcilerIpoRow` (it carries neither today, `:94-105`) |
| `scraper/src/services/document-state-machine.ts` | `notApplicableTypes`: add the explicit offering-type guard — an issue whose `offering_type` cannot file a price band ad never has `PRICE_BAND_AD` / `ANCHOR_ALLOCATION_REPORT` due, independent of `isFixedPrice` |
| `scraper/src/services/document-cycle.ts` | `deriveIssueShape` (`:522`) gains `offeringType` so the guard above has its input; thread `open_date` into the `deriveLifecycleStage` call at `:1008` |
| `scraper/scripts/run-document-discovery.ts` | `:248` — same call, same new fields |
| `scraper/src/scheduler/stage-reconciler.ts` (`planStageReconciliation`, `:311`) + `scraper/src/scheduler/jobs/stage-reconciler-job.ts` (`RECONCILER_PRESENCE_SQL`, `:87-101`) | **ADDED round 2 — the call site round 1 missed.** `planStageReconciliation` calls `deriveLifecycleStage(row)` with no new fields and no `opts`, and its SQL selects no `open_date`, no `offering_type` column and no RHP signal. This job WRITES pipeline-step DUE rows (`IpoPipelineStepsRepository`, `:175`), so an unthreaded call makes the ledger record UPCOMING while the document cycle fetches PRE_OPEN documents for the SAME IPO at the SAME instant. Also pass `opts.today` through — today it is accepted for the stale-CLOSED check and silently dropped for the stage call, so injected time is ignored |
| `scripts/lib/ipo-stage-completeness.mjs` | `deriveStage` (`:101`) is a SECOND implementation of the same rule (its own comment says it mirrors). Update in the same PR or the two definitions drift — this is the `one-concept-several-definitions` class |

## Schema

**A promotion condition must depend only on facts our own pipeline cannot suppress — never on an
output of the work it gates.**

## Interfaces

```
UPCOMING →
  if NOT bandBearing(offeringType)              → stay UPCOMING   (never hunt a band ad)
  if openDate present AND 0 <= (openDate - today) <= 7 → PRE_OPEN   (LOWER BOUND, round 2)
  if RHP on file                                → PRE_OPEN
  if band already present                       → PRE_OPEN        (kept: harmless, not the trigger)
  otherwise                                     → stay UPCOMING, and REPORT as unresolved
```

The final clause is the point: an issue with no usable signal must be **visible**, not silently
stalled. Silent stalling is the bug being fixed.

## Feature flag

Only `offering_type='IPO'` ever holds a `PRICE_BAND_AD` — **21 of 21**. Every non-IPO type stores
`min = max` (TENDER 16/16, RIGHTS 5/5, NCD 3/3, INVITS 3/3, BUYBACK 1/1, REITS 1/1): a single fixed
price in both columns, never a range. IPO itself is 210 `min=max` and 91 a real range.

The existing `isFixedPrice` guard excludes non-IPO types **only when a price is present**. With a
NULL band it is false, so **24 rows (19 OFS, 4 NCD, 1 RIGHTS)** escape it and would be promoted into
hunting a document that cannot exist — permanent `BLOCKED_ALL` and alert noise, the W-40 churn this
repo already fought. Hence an explicit guard, not a reliance on `isFixedPrice`.

## Tests

1. `deriveLifecycleStage` — UPCOMING, band NULL, `open_date` = today + 3 → **PRE_OPEN**. Red today.
2. `deriveLifecycleStage` — UPCOMING, band NULL, `open_date` NULL, RHP on file → **PRE_OPEN**.
3. `deriveLifecycleStage` — UPCOMING, band NULL, `open_date` NULL, no RHP → **UPCOMING + reported
   unresolved** (assert the report, not just the stage).
4. `deriveLifecycleStage` — UPCOMING, band NULL, `open_date` = today + 30 → stays UPCOMING
4b. **(round 2)** `open_date` in the PAST (today - 90, today - 1900) → stays UPCOMING. Round 1 had no such test, and a reviewer's `days >= 0` mutation left all 14 tests green — a suite that passes with and without a lower bound is testing nothing about the window's lower half.
4c. **(round 2)** the window boundary is evaluated on an IST CALENDAR DAY, not a raw ms delta: the same `open_date` must give the same verdict when `today` is 05:30 IST and 23:30 IST. Round 1 drifted 7 vs 8 days by hour of day (`ist-timezone.md`)
   (boundary: the window must not promote everything).
5. `notApplicableTypes` — `offering_type='OFS'`, band NULL → `PRICE_BAND_AD` NOT applicable. Red
   today (`isFixedPrice` is false, so nothing excludes it).
6. `dueDocTypesForStage('PRE_OPEN')` includes `PRICE_BAND_AD` — pins the link the deadlock broke.
7. Parity: `deriveStage` (mjs) and `deriveLifecycleStage` (ts) agree on a shared table of rows, so
   the two implementations cannot drift again.

Each must be shown RED before the change and GREEN after. A test that passes before the fix is
testing nothing (`proof-must-be-able-to-fail`).

## Detection

`m_upcoming_missing_price_band_tracking` (#796) is the check that would have caught this: live IPO
opening within 7 days with **no** `PRICE_BAND_AD` fetch-state row. Entity-anchored (`FROM ipos …
NOT EXISTS`), because every existing document check JOINs `document_fetch_state` and is structurally
blind to a row that was never created. Verified to discriminate: flags exactly the 2, passes the
other 18 of 20 opening within 7 days.

Ships in this PR or immediately after; the fix is not "done" while the class is unguarded.

## Staging proof

Before: `SELECT count(*) FROM document_fetch_state s JOIN ipos i ON i.id = s.ipo_id
WHERE i.status='UPCOMING' AND i.price_range_min IS NULL AND s.doc_type='PRICE_BAND_AD'` → **0**.

After one real cycle: **> 0**, named by identity (which IPO, which doc_type, which state).

Second assertion, guarding the regression this could introduce: no `PRICE_BAND_AD` row exists for
any `offering_type` other than `IPO`. Expected 0 before and after.

Read from the cycle log by identity, never from a count alone (`signal-ownership` R1).

## Rollback

Single-function revert. No migration, no data change. If the promotion misfires, the blast radius is
extra `NOT_YET_FILED` fetch attempts on issues promoted early. **Round 1's card claimed this was "bounded by the existing retry ladder". That was asserted, not checked, and it is FALSE:** `NOT_YET_FILED` has a 30-minute retry interval (`document-state-machine.ts:449`) and **no attempt cap** — unlike `NOT_FOUND`, which caps at 5 (`NOT_FOUND_MAX_ATTEMPTS`, `:468`) — and it never escalates to `BLOCKED_ALL` because it is explicitly not a failure. Alert noise is bounded; fetch attempts are not. This is why the window MUST carry a lower bound.

## Tier, budget and cost

**Tier A** — changes lifecycle staging, which drives what gets fetched for every IPO. Fresh-Opus
adversarial review with mutation tests on every guard.
Budget: 60 min wall-clock, 120 tool calls.
**Report: evidence-table.**

## Rules implemented

- `defect-fix-contract.md` - RCA, class, failing test first, fix at class level, real-data
  proof, detection upgrade. The disproved first RCA is recorded so it is not re-attempted.
- `proof-must-be-able-to-fail.md` - every test must be shown RED before the change. Round 1's
  lower-bound gap was found exactly because a mutation left all 14 tests green.
- `ist-timezone.md` - the window is evaluated on an IST calendar day, pinned by test 4c.
- `one-concept-several-definitions` - the TS and MJS rules are pinned together by a parity test.
- `signal-ownership.md` R1 - the staging proof is read by identity, never from a bare count.

## Known gaps

- N=7 rests on 17 IPOs and on OUR recording time, not the issuer's filing time. Underivable here
  because `documents.filing_date` is 0 of 21 populated. Populating `filing_date` would let N be
  derived properly and is a separate item.
- "RHP on file" is a proxy for pre-open, not a guarantee; it is a second signal, never the only one.
- This fixes the GATE. It does not fix document acquisition generally: only 11 of 23 live IPOs hold
  any document at all. That is a wider gap and a separate item.
