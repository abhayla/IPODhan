# Item 35 — the admin queue's open count in the nightly report, grouped by IPO, live first

Status: NOT STARTED

Model: Sonnet.

Core: the size of the admin queue is a number the owner reads every night, resolved to IPOs rather
than printed as a total — Proof: run the reporter against staging through the sanctioned tunnel and
read back a block naming real IPOs with their per-IPO counts, ordered live-and-upcoming first.

Proof: one nightly report block on staging naming at least one live IPO by slug with a non-zero
count, and a total line that equals the sum of the rows it printed.

Class: none — mechanism, not a deviation.

## Purpose

The nightly report prints how many admin-queue items are open, grouped by IPO with live and upcoming
IPOs first, so an unclearable queue is visible the night it becomes unclearable.

## Serves

`docs/design/spec-deviation-guideline.md` §5.1, OD-63 (the admin surface carries absences as well as
disagreements) and `.claude/rules/signal-ownership.md` R1 and R3 — a count resolved to identities,
with a same-day consumer.

Measured 2026-09-19: **45,804 conflicts, 31,659 resolved, every resolution recorded
`resolved_by = SYSTEM`, 14,145 still open, and no human has ever resolved one**; separately **12,701
absent fields across 71 IPOs**. Nothing prints either number anywhere the owner reads.

## Files

| Path | State | Change |
|---|---|---|
| `scripts/ops/admin-queue-size.mjs` | NEW | reads the open queue, groups by IPO, orders live first, prints the block |
| `scripts/audit-detection-floor.mjs` | exists | calls the reporter so the block lands in the nightly output the delta consumer already reads |
| `scripts/tests/admin-queue-size.test.mjs` | NEW | ordering, grouping, the identities rule and the sum assertion |
| `packages/shared/src/db/schema.ts` | exists | read-only: `data_conflicts` (line 1548) is the queue's table |

## Schema

No schema change. The reporter reads `data_conflicts` and the reason-coded absence rows; it writes
nothing.

## Interfaces

```
// scripts/ops/admin-queue-size.mjs
//   node scripts/ops/admin-queue-size.mjs           print the block, exit 0
//   node scripts/ops/admin-queue-size.mjs --json    the same data as json, for the floor script
export async function adminQueueSize(db): Promise<{
  total: number;
  byIpo: Array<{ slug: string; status: string; conflicts: number; absences: number; live: boolean }>;
}>;
```

The printed block, complete and with the ordering rule visible in it:

```
ADMIN-QUEUE  open 14145 across 71 IPOs  (live/upcoming first)
  OPEN      <slug>            conflicts 38   absences 112
  UPCOMING  <slug>            conflicts 12   absences  94
  ...
  LISTED and older: 63 IPOs, conflicts 13991, absences 12203
```

Live and upcoming IPOs are named individually. Everything older is one summary line — naming 63
closed IPOs every night is how a report becomes something nobody reads, which is the same failure
one level up from the queue this item is about.

## Feature flag

No flag. The reporter is read-only and adds lines to an existing nightly output; there is nothing to
turn off per slot beyond not calling it. Rollback is reverting the commit.

## Tests

`scripts/tests/admin-queue-size.test.mjs` (NEW), red before the change because the module does not exist:

- an OPEN IPO and a LISTED IPO with equal counts order OPEN first — the live-first rule, asserted at
  the order and not merely at the presence of both;
- rows are grouped by IPO, so one IPO with three open fields is one line reading 3, not three lines
  — the grouping rule from §5.1, which exists because a field-ordered list makes the admin open the
  same document three times;
- the printed total equals the sum of the rows plus the summary line's counts; a mismatch fails —
  a total that does not reconcile with its own breakdown is how a filter silently drops rows;
- an IPO with a zero count does not appear at all;
- with an empty queue the block still prints, reading `open 0 across 0 IPOs` — a check that vanishes
  when it has nothing to say is indistinguishable from a check that crashed (§4's `CHECK-ROSTER`).

## Detection

`No detection change: this item adds an identity-resolved reporting block to the existing nightly floor output; it changes no write path and asserts nothing, so it adds no check for the registry to carry.`

The line the block prints is itself read by the existing floor delta consumer
(`scripts/ops/floor-delta.mjs`), so a growth in the queue surfaces as a NEW line rather than as a
number someone has to compare by hand.

## Staging proof

One nightly run on staging whose output contains the `ADMIN-QUEUE` block, with at least one live or
upcoming IPO named by slug and a non-zero count, and a total that reconciles with the rows printed
beneath it. The counter that must move is `open`: it is read on two consecutive nights, and the
difference is explainable from that day's cycles.

No data repair, so no `assert-repair-held` run.

## Rollback

Revert the commit. The block leaves the nightly output. Nothing was written to any database, and no
admin-facing behaviour changes — this item is a report line only, and deliberately builds no UI.

## Tier, budget and cost

Tier B — it adds a module to a scheduled nightly script, and a query that scans the conflicts table
badly would slow a job that runs on a box serving production. Diff-only review, CI green, merge on
PASS.
Budget: 30 min wall-clock, 60 tool calls. One to two review rounds expected.

## Rules implemented

<!-- hand-owned: not generated by apply-rule-ownership.mjs, see docs/design/apply-rule-ownership.mjs HAND_OWNED_MARKER -->

No numbered design rule of the pull model. It implements `signal-ownership.md` R1 and R3 and
`docs/design/spec-deviation-guideline.md` §5.1, which are rules about how we work; §8.5(b) declares
such rules in `docs/design/rules-unclaimed.json`.

## Known gaps

Does NOT change the admin UI, and does not make the queue clearable. It reports the size; the
owner's rule that a count above one person's daily capacity is a pipeline defect is a conclusion a
human draws from this number, not an alarm this item raises.

Does NOT set a threshold. What one person clears in a day has never been measured here — nobody has
ever resolved a conflict by hand — so any number written now would be invented. It is recorded as
unmeasured, with the first week of real admin use as the measurement that would set it.
