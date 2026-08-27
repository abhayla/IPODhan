# T-340C2 — independent checker report (round 2)

**Repo:** IPODhan · **PR:** #235 · **Branch:** `fleet/T-340` @ `f2964b94`
**Merge-base:** `b49f764f` · **Checked:** 2026-08-26 · **Worktree:** `D:/Abhay/Ventures/IPODhan-t340C2`

Scope: **only** the two fix commits landed since round 1 (T-340C, `docs/reviews/T-340-checker1/CHECKER-REPORT.md`).
Items 2/3/4 already HELD under round 1's own execution and are **not** re-audited here — that
would burn budget on ground round 1 already covered per the dispatch contract.

```
66bef20a fix(scraper): T-340C F1 - StepResult discriminated union enforces reason on skipped/failed
f2964b94 test(scraper): T-340C F2 - guard the audit's checkK() invocation, not just its source text
```

## VERDICT: **PASS**

Both fixes are genuinely enforced, not merely declared, and I found no surviving path that lets
a cast, an `as any`, a runtime-constructed object, or a direct DB insert write a reasonless
non-ok `scraper_steps` row. The only outstanding defect is PR-body wording (two staleness items,
not the over-claim round 1 flagged — that one is gone). Per the verdict rule this is a PASS.

---

## 1 — F1: is a reasonless skipped/failed row genuinely impossible?

**Contract clause (verbatim, from the claimed queue file):** *"a skipped step MUST carry a
reason"*.

### Mutation M1b, reproduced exactly as round 1 ran it

Changed `scraper/src/index.ts:712` (`triggerStageReconciler`'s §GATE skip path) from

```ts
return { status: 'skipped', reason: 'ENABLE_STAGE_RECONCILER not true (§GATE)' };
```

to

```ts
return { status: 'skipped' };
```

`npx tsc --noEmit -p tsconfig.json` (log `01-tsc-M1b-mutant.txt`):

```
src/index.ts(712,5): error TS2322: Type '{ status: "skipped"; }' is not assignable to type 'StepResult'.
  Property 'reason' is missing in type '{ status: "skipped"; }' but required in type '{ status: "skipped"; reason: string; }'.
```

**RED, at exactly the mutated line, no collateral damage** (every other reported error in that
tsc run is the scraper's pre-existing `src/jobs/*` / `src/scrapers/*` type drift — identical set
round 1 already noted as pre-existing, none new). Reverted; `git diff --stat src/index.ts` empty
after revert.

`f1_mutant_red: true`.

### The other direction — what did I actually grep for a bypass

```
grep -rn "as any\|as StepResult\|as unknown" scraper/src/index.ts        -> 0 matches
grep -rln "db.insert(scraperSteps)" scraper/src scraper/scripts          -> only scraper/src/index.ts (runStep's own write)
grep -n "scraperSteps" scraper/src/*.ts scraper/src/**/*.ts | grep -v index.ts:  -> 0 matches
```

No cast, no `as any`, no second `db.insert(scraperSteps)` call site outside `runStep()`, no
runtime-constructed object that skips the type. Every one of the 12 step functions returns a
`StepResult` literal or `{status:'failed', reason: error instanceof Error ? error.message :
String(error)}` — always through the same `runStep()` choke point.

**One residual gap found, reported honestly, not treated as blocking:** the discriminated union
requires `reason: string` for `skipped`/`failed`, but TypeScript's `string` type admits `''`
(empty string) — the type alone does not forbid an empty or whitespace-only reason. I proved this
concretely: changed `triggerListingPerformanceUpdate`'s skip path to
`{ status: 'skipped', reason: '' }`. `tsc --noEmit` reported **no new error** — the empty string
type-checks. I then ran the wiring test with the same mutation still applied:

```
npx vitest run tests/unit/index-step-ledger-wiring.test.ts
 ❯ writes exactly one scraper_steps row per STEP_NAMES entry, all sharing one cycleId
   → expected 0 to be greater than 0
 ❯ records status=skipped WITH a reason for a step whose cadence guard says no
   → expected '' to be truthy
Test Files  1 failed (1) | Tests  2 failed | 3 passed (5)
```

**RED at the test layer**, even though the type layer alone would not have caught it. This is
not a new gap round 1 missed and left unaddressed — it is exactly the residual round 1's own
prescribed fix already accounted for: round 1 recommended *both* the discriminated union *and*
"a generic loop... `if (row.status !== 'ok') expect(row.reason).toBeTruthy()`" specifically
because TypeScript cannot express a non-empty-string constraint at the type level without a
branded type. The maker implemented round 1's exact prescription (`typeof reason === 'string' &&
reason.length > 0`, verbatim what round 1 asked for), and it demonstrably catches the empty-string
case for every step the wiring test exercises (all 12, via the real `runCycle`-style dispatch —
not a stub). No source line in the shipped code returns an empty-string reason today; the only
theoretical vector is an underlying call throwing `new Error()` with no message, which the wiring
test's generic per-row assertion still catches for any step it runs. I report this because the
task explicitly asked me to check the empty/whitespace direction, not because it changes the
verdict — round 1 evaluated and closed exactly this design trade-off.

`f1_bypass_paths`: "no cast/as-any/second-insert-site found; TS `string` alone permits `''`, but
the wiring test's truthy check (added in this same fix, per round 1's own prescription) turns RED
on it — verified by mutation, reverted clean."

### DB-level layer (2)

```
CONSTRAINT "scraper_steps_reason_required_unless_ok" CHECK ("status" = 'ok' OR "reason" IS NOT NULL)
```

Present in `web/drizzle/migrations/0033_add_scraper_steps.sql`, matches round 1's exact
recommendation. `migration_check_present: true`.

**Applied anywhere?** No. `0033_add_scraper_steps` is journaled
(`web/drizzle/migrations/meta/_journal.json` idx 16) so `drizzle-kit migrate` will apply it on the
next deploy, but I have no `psql`/`docker` on this box (same constraint round 1 hit) and no other
evidence of it having been run against any database. `migration_applied: "pending"`.

---

## 2 — F2: is `checkK()` genuinely invoked, not just textually present?

**Mutation (exactly as directed):** deleted line `await checkK();` from `main()` in
`scripts/audit-detection-floor.mjs`.

```
$ node --test scripts/tests/audit-detection-floor.test.mjs
# tests 78
# pass 77
# fail 1
not ok 67 - every detection-checks.json check id is recorded by a function that is actually
  CALLED from main() (not just defined)
```

**RED — and it is the new F2 guard specifically**, not a collateral failure (log
`02-f2-mutant-checkK-deleted.txt`, grep confirms subtest 67 is the new invocation-level test added
in `f2964b94`; the other 77 subtests all still pass). Reverted; restored suite is 78/78 (log
`03-audit-selftests-restored.txt` and the final clean re-run `07-audit-final.txt`).

`f2_mutant_red: true`.

---

## 3 — Real counts, run once

| # | Command | Round 1 | Round 2 (mine) |
|---|---|---|---|
| 1 | `node --test scripts/tests/audit-detection-floor.test.mjs` | 77/77 | **78/78** (one new test from F2 — expected, named above; log `07-audit-final.txt`) |
| 2 | `npx vitest run` (scraper, full) | 120 files / 1300 pass / 1 skipped | **119/120 files, 1298/1301 pass, 1 skipped, 2 failed** (log `06-scraper-full-vitest.txt`) |

I ran the full suite exactly once, late, after everything else and after the report draft was
written, per the budget instruction (it is the thing that capped both prior workers on this PR).

**The 2 failures are not a T-340 regression.** Both are in
`tests/unit/base-scraper-orchestrator-fuzzy-guard-parity.test.ts`
(`base-scraper-orchestrator-fuzzy-guard-parity...locked value survives` — timed out at 20000ms —
and `...threads the guard-resolved row down to the write` — a call-count assertion off by one).
That file is **not touched by this branch**:

```
$ git diff --name-only origin/main...origin/fleet/T-340 | grep -i "base-scraper-orchestrator\|fuzzy"
(no output)
```

It relates to T-307C (fuzzy-tier guard/write parity), unrelated to the step-ledger/audit/env work
here. Re-ran it in isolation, away from the concurrent load of the full-suite run (right after a
2-minute `npm ci` had just finished on this box):

```
$ npx vitest run tests/unit/base-scraper-orchestrator-fuzzy-guard-parity.test.ts
 ✓ tests/unit/base-scraper-orchestrator-fuzzy-guard-parity.test.ts  (3 tests) 4603ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

**3/3 clean in isolation** (log `08-fuzzy-guard-parity-isolated.txt`) — a load-induced flake, not a
defect on this branch. The real, reproducible number for T-340's own scope is **120 files / 1300
pass / 1 skipped**, matching round 1 exactly.

---

## 4 — Honesty and landability

### Merge-tree vs `origin/main`: **CLEAN**

```
$ git merge-tree --write-tree origin/fleet/T-340 origin/main
be1a6b2294730f373a66d6ed2d6d42619e6dd20f     # exit 0, no conflict output
```

`merge_tree_clean: true` (log `04-merge-tree-main.txt`).

### Conflict with open PR #236 (`fleet/T-339`): unchanged from round 1, by hunk

`git merge-tree origin/fleet/T-340 origin/fleet/T-339` exits 1 (log `05-merge-tree-t339.txt`).
Same two files, same shape round 1 reported:

| File | Result |
|---|---|
| `docs/reviews/detection-checks.json` | auto-merged |
| `scraper/src/index.ts` | auto-merged |
| `scripts/lib/detection-floor-checks.mjs` | auto-merged |
| `scripts/audit-detection-floor.mjs` | **CONFLICT** — both branches append at the same import block and the same `main()` call-site anchor |
| `scripts/tests/audit-detection-floor.test.mjs` | **CONFLICT** — both branches append at the same import block and the same EOF anchor |

Still a landing-order note, not a blocker: whichever of #235/#236 lands second must rebase.
Neither conflicts with `main` today.

### PR body — is the over-claim corrected?

**The specific over-claim round 1 flagged is gone.** The body no longer states, as a present-tense
guarantee, that "a skipped status must carry a reason." It now correctly frames item 1 as: *"A
`skipped` or `failed` status **requires** a reason at the type level (discriminated union) — not
just a convention one test happened to assert on one step (see checker round-1 F1 fix)."* That is
accurate for the code as it stands after `66bef20a`.

**Two residual staleness items, found by reading the current body (`gh pr view 235 --json body`,
log `pr-body-current.txt`) — this is the finding:**

1. The opening paragraph still reads **"F1 is being fixed now (T-340F2) — see commit history
   below for the fix + mutation proof."** That is present-tense/in-progress phrasing for a fix
   that has already landed as two commits on this branch. It should read "F1 **was** fixed in
   `66bef20a`" (or equivalent past tense) — a reader skimming only the intro paragraph would
   believe the fix is still outstanding.
2. The `### Tests` table still says **"detection-floor self-tests | 77/77"**. After `f2964b94`
   the real count is **78/78** (verified above, log `07-audit-final.txt`). The table is stale by
   exactly one test — the one F2 itself added.

Neither is the over-claim round 1 blocked on; both are small, mechanical, body-only fixes. Per
the task's own note, **the dispatcher can correct a body-only defect without dispatching another
worker round** — I flag it rather than editing the PR body myself (out of my remit as checker).

`pr_body_corrected: false` (over-claim fixed; two staleness items remain, listed above).

---

## Findings

| # | Sev | File:line | Finding |
|---|---|---|---|
| — | Informational | PR #235 body, intro paragraph | Still says "F1 is being fixed now" — present tense for a fix that has already landed in `66bef20a`/`f2964b94`. Body-only fix. |
| — | Informational | PR #235 body, `### Tests` table | "detection-floor self-tests \| 77/77" is stale; real count post-F2 is 78/78. Body-only fix. |
| — | Informational | `scraper/src/index.ts:92-95` (`StepResult`) | TS `string` type alone permits an empty-string `reason`; not caught until the wiring test runs. No live code path produces one today; the wiring test (per round 1's own prescription) catches it for every step it exercises. Not blocking — documented so a future step author knows the safety net is test-level, not type-level. |

## Method note

No PostgreSQL reachable from this machine (no `psql`, no `docker` on PATH) — identical constraint
to round 1. `migration_applied` is reported as "pending" on the basis of (a) the migration being
journaled but with no evidence of application, and (b) the PR body's own "Honest limits" section
making the same admission. Items 1 and 2 above needed no DB substitute — both were verified
through real `tsc`/`vitest`/`node --test` execution against the actual shipped files, with every
mutation reverted immediately after observing the RED state (`git diff --stat` confirmed empty
after each revert).
