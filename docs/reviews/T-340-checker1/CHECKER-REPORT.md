# T-340C — independent checker report (round 1)

**Repo:** IPODhan · **PR:** #235 · **Branch:** `fleet/T-340` @ `22584e6e`
**Merge-base:** `b49f764f` · **Checked:** 2026-08-26 · **Worktree:** `D:/Abhay/Ventures/IPODhan-t340C`

## VERDICT: **FAIL**

Three of the four DoD items hold under my own execution, and hold well. **Item 1 does not.**
The contract's clause — *"a skipped step MUST carry a reason"* — has **no enforcement**. I
proved it by mutation: a step that returns `{ status: 'skipped' }` with no reason type-checks
clean and passes **all 1300 scraper tests**. The PR body states this as a guarantee
("A `skipped` status **must** carry a reason"), which is the one place the body over-claims.

The fix is four lines and I verified it works (F1). Everything else on this branch is solid
and, in two places, better than the maker could prove.

---

## What I ran

| # | Command | Result |
|---|---|---|
| 1 | `node --test scripts/tests/audit-detection-floor.test.mjs` | **77/77 pass** (log `01`) |
| 2 | `npx vitest run tests/unit/index-step-ledger-wiring.test.ts tests/unit/index-env-assert.test.ts` | **12/12 pass** (log `02`) |
| 3 | `npx vitest run` (full scraper suite) | **120 files, 1300 pass, 1 skipped** (log `03`) |
| 4 | `npx tsx src/index.ts --source=all` x 2 env states | exit **1** both (log `04`) |
| 5 | `bash scripts/tests/assert-env-keys.test.sh` | exit **0** (logs `05`, `05b`) |
| 6 | Real audit runner x 7 DB/NSE states (stubbed-pg harness) | logs `audit-S*.txt` |
| 7 | 7 mutations (M1, M1b, M2, M3, M4, M5, M6) | 5 RED, **2 GREEN-when-they-should-be-RED** |
| 8 | `git merge-tree --write-tree origin/fleet/T-340 origin/main` | **clean** (exit 0) |

The maker's claimed suite numbers (1300 / 77 / 25) all reproduce. No inflation.

---

## Item 1 — step ledger · **FAIL**

**Contract clause (verbatim):** *"Step ledger: every post-scrape step writes one row (cycle_id,
step, status ok|skipped|failed, reason, duration) to scraper_logs (or a new scraper_steps table
if scraper_logs shape does not fit - state which); **a skipped step MUST carry a reason**; the
catch blocks stay non-fatal but never silent."*

### What holds

- `scraper/src/index.ts:108` `runStep()` writes **exactly one** `scraper_steps` row per step per
  cycle; `index.ts:409` mints one `cycleId` shared by all 12. Verified by execution (log `02`):
  `insertValuesMock` called exactly `STEP_NAMES.length` times, one distinct `cycleId`.
- Statuses are constrained to `ok|skipped|failed` and observed in all three states.
- Catches are **non-fatal but no longer silent**: `index.ts:110-115` converts a throw into
  `{status:'failed', reason: error.message}` — verified live, `duplicateSweep` recorded
  `failed` / `"duplicate sweep boom"`. The ledger write itself is separately try/caught
  (`index.ts:117-127`) and a DB-down ledger write still exits 0 — correct.
- New table justified in-code and in the migration header. `scraper_logs.status` genuinely has
  no `skipped` state. I accept the call.
- Bonus (the PR body under-sells this): migration 0033 **is** journaled
  (`meta/_journal.json` idx 16), so `drizzle-kit migrate` applies it on the next deploy without
  a manual step.

### F1 — a reasonless `skipped` row is NOT impossible *(the finding)*

`StepResult` (`scraper/src/index.ts:86-90`) declares `reason?: string` — **optional for every
status**. Nothing else enforces it: no DB `CHECK` in `0033_add_scraper_steps.sql`, no runtime
guard in `runStep`, and no generic test assertion.

**Mutation M1b** — I changed `scraper/src/index.ts:708` from

```ts
return { status: 'skipped', reason: 'ENABLE_STAGE_RECONCILER not true (§GATE)' };
```

to

```ts
return { status: 'skipped' };
```

**What I saw:**

- `npx tsc --noEmit -p tsconfig.json` → **no error on index.ts** (the scraper's pre-existing
  errors are all in `src/jobs/*`; none new).
- `npx vitest run` (whole scraper suite) → **120 files, 1300 pass, 1 skipped. Still green.**
  (log `03-scraper-full-M1b-reasonless-skip.txt`)

Result: a `reason: null` row lands in `scraper_steps`, the audit sees a step it cannot explain,
and no gate anywhere objects.

The only thing guarding this today is one incidental assertion on **one** step —
`index-step-ledger-wiring.test.ts:145`, `expect(listingRow.reason).toBeTruthy()`. **Mutation M1**
(making `runStep` drop the reason for `skipped`) does turn that RED, so the maker's mutation
claim is technically true — but it tests the *writer*, not the *contract*. Step #13, written six
months from now by someone who skips without a reason, sails through.

This matters because the reason IS the mechanism. `k_step_ledger_silence` FAILs on a silent
step; the on-call human then reads `reason` to know whether it is a config gap, a §GATE, or a
cadence window. A null reason turns a P1 page into a scavenger hunt.

**Verified fix (4 lines).** Replacing the interface with a discriminated union:

```ts
export type StepResult =
  | { status: 'ok'; reason?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };
```

With M1b still applied, `tsc` then emits exactly:

```
src/index.ts(707,5): error TS2322: Type '{ status: "skipped"; }' is not assignable to type 'StepResult'.
```

Recommended alongside it (cheap, independent layers):

1. A generic loop in `index-step-ledger-wiring.test.ts`: for every recorded row,
   `if (row.status !== 'ok') expect(row.reason).toBeTruthy()`.
2. `CHECK (status <> 'skipped' OR reason IS NOT NULL)` in `0033_add_scraper_steps.sql` — the
   migration is not yet applied anywhere, so this is free to add now and impossible later.

---

## Item 2 — audit checks · **HOLDS** (one guard gap, F2)

**Contract clause (verbatim):** *"FAIL if any expected step has zero ok rows in the last 24h, or
any step failed in >= 3 consecutive cycles; the expected-step list is derived from the code
(exported STEP_NAMES), never hand-typed. Self-test fixture per state."*

### Registration to execution: proven, not trusted

Both checks exist in `docs/reviews/detection-checks.json`. I did **not** trust that. I built a
harness (`checker-harness-audit.mjs.txt`) — a byte-for-byte copy of
`scripts/audit-detection-floor.mjs` with **only** the `pg` import swapped for a fixture-driven
fake — and ran the **real check bodies** against 6 DB states:

| Fixture | `k_step_ledger_silence` | `k_step_consecutive_failures` |
|---|---|---|
| `S1-no-table` (0033 unapplied) | UNVERIFIABLE | UNVERIFIABLE |
| `S1b-table-empty` (writer never ran) | UNVERIFIABLE | UNVERIFIABLE |
| `S2-silent-step` — `statusUpdate` **skipped** every cycle | **FAIL** — *"no ok row in 24h: statusUpdate"* | PASS |
| `S3-failure-streak` — 3 leading `failed` | PASS | **FAIL** — *"failing streak >=3: deployDriftMonitor"* |
| `S3b-two-failures` — 2 leading `failed` | PASS | PASS (threshold is 3, not "any") |
| `S4-all-ok` | PASS | PASS |

`S2` is the exact defect the task exists for: the `ADMIN_API_TOKEN`-unset shape, where the step
is wired, runs, records a documented skip, and does no work. **It FAILs, by name.** That
satisfies my contract's condition for accepting an UNVERIFIABLE-today check: the fixtures prove
the FAIL path fires once the data is present. It fires end-to-end through the real runner, not
just through the pure predicate.

### Derivation from STEP_NAMES: proven by mutation (M3)

I appended `'brandNewStepNobodyWired'` to `STEP_NAMES` (`scraper/src/index.ts:82`). Without
touching the audit:

- `parseStepNames()` returned **13** names including the new one;
- `checkStepSilence('brandNewStepNobodyWired', 0)` produced its FAIL message;
- self-test **#58** *("parseStepNames matches the REAL prod entrypoint and finds every wired
  step")* went **RED** — because the new name is never passed to `runStep()`.

So the list is genuinely derived, and a `STEP_NAMES` entry with no `runStep()` call is caught.

### Other mutations

- **M4** — weaken the silence predicate to `okCountInWindow >= 0`: **RED**, 2 tests
  (`#59`, `#65`).
- **M5** — add a paper-only entry `z_paper_only_check` to the manifest: **RED**, test `#66`.

### F2 — the wiring test proves *text*, not *invocation*

**Mutation M6** — I deleted `await checkK();` from `main()`
(`scripts/audit-detection-floor.mjs:709`). The self-test suite stayed **77/77 GREEN**.

The manifest-to-script test matches `/record\(\s*'([a-z0-9_]+)'/` against the script's **source
text**. Orphan `checkK` — never called — still contains the string
`record('k_step_ledger_silence'` inside its dead body, so the test passes while the check never
runs. That is `i_wire_or_retire`'s own failure class, applied to the file that defines it.

**Not a live defect** — I confirmed by execution that `main()` *does* call `checkK()` and
`checkL()` today (all 7 harness runs recorded them). It is a missing regression guard. Cheap
close: also assert each new check id appears in `main()`'s body, e.g.
`assert.match(script.slice(script.indexOf('async function main()')), /await checkK\(\)/)`.

---

## Item 3 — startup refusal · **HOLDS (both cases, executed)**

**Contract clause (verbatim):** *"ADMIN_API_TOKEN (and every env the post-steps need) added to
assert-env-keys so the scraper refuses to START without it - no silent status skip is possible.
Test: unset -> startup exit non-zero with the key named."*

I ran the real entrypoint (log `04-startup-refusal.txt`):

| Case | Command | Exit | Message |
|---|---|---|---|
| A — unset | `env -u ADMIN_API_TOKEN npx tsx src/index.ts --source=all` | **1** | `Missing required env var(s) for --source=all cycle: ADMIN_API_TOKEN — refusing to start` |
| B — blank | `ADMIN_API_TOKEN="" npx tsx src/index.ts --source=all` | **1** | identical, names the key |

Both name the key. Both stop **before** anything else: the process-TZ log line
(`index.ts:191`, which sits immediately *after* the assert) never printed in either run, so no
`runStep()` could have executed. Blank-is-missing works because the filter is truthiness
(`index.ts:156`) — T-230 respected.

**Drift guard (M2).** I removed `ADMIN_API_TOKEN` from `SCRAPER_REQUIRED_KEYS` in
`scripts/assert-env-keys.sh:88`. Test **RED**:

```
AssertionError: ADMIN_API_TOKEN is required at startup but absent from assert-env-keys.sh
```

The guard is one-directional (runtime is a subset of deploy), which is the correct direction —
deploy legitimately requires more keys (`TZ`, `WEB_INTERNAL_URL`, the four `ENABLE_*`).

`scripts/assert-env-keys.sh` itself is **unchanged** on this branch: `ADMIN_API_TOKEN` was
already a deploy-time key on `main`. The branch adds the two new shell cases (missing + blank)
and the binding test. `bash scripts/tests/assert-env-keys.test.sh` exits **0**.

`WEB_INTERNAL_URL` excluded from the startup list: I accept it. Its fallback
(`http://localhost:3001`) is correct on the box, and requiring it would break local
`--source=all`. It stays deploy-required.

---

## Item 4 — NSE cross-check · **HOLDS, and I got further than the maker did**

**Contract clause (verbatim):** *"Status cross-check: daily audit compares our OPEN/UPCOMING set
against NSE current-issue + upcoming APIs ... any IPO NSE lists as open that we show otherwise
(or vice versa) = FAIL naming it; report unverifiable separately from OK when NSE is down
(T-321 class)."*

### The maker's biggest disclosed gap is now closed

The PR body says: *"`checkL` has never run against live NSE from this worker ... the
fetch/handshake path is reviewed code, not executed evidence."*

**I ran it against live NSE.** In all 6 non-blind harness runs, `checkL` completed the cookie
handshake and both feed fetches and reported:

```
(7 current, 9 upcoming from NSE; 0 live rows of ours)
```

naming real, current issues — Annu Projects Limited, Symbiotec Pharmalab Limited, Hy-Tech
Engineers Limited, Skyways Air Services Limited, Sumax Engineering Limited, Madhur Knit Crafts
Limited, ABH Healthcare Limited, and (upcoming) Purple Style Labs Limited. The `FAIL`s there are
correct behaviour for my fixture, which deliberately returns zero rows of ours — not a live
defect. **The handshake, both endpoints, the field normalisation and the naming path all work
against the real NSE today.**

### UNVERIFIABLE is not OK, and it pages

Fixture `S5-all-blind` (`scraper_steps` absent + `NSE_BASE` pointed at an unroutable host):

```
[UNVERIFIABLE] k_step_ledger_silence   ... the audit is BLIND to step health, not green
[UNVERIFIABLE] k_step_consecutive_failures ...
[UNVERIFIABLE] l_nse_status_crosscheck ... NSE oracle unreachable (fetch failed) — BLIND tonight, not green (T-321 class)
```

and the paging layer emitted a **distinct P2 page per blind check**, day-scoped:

```
would page P2 detection-floor-unverifiable-l_nse_status_crosscheck-2026-08-26
would page P2 detection-floor-unverifiable-k_step_ledger_silence-2026-08-26
would page P2 detection-floor-unverifiable-k_step_consecutive_failures-2026-08-26
```

`computeExitCode({failCount:0, unverifiableCount:7})` returns **3**, and the same run under
`--gate` exited **1** (it also had real FAILs). The cron **does** pass the flag —
`scripts/vps-data-audit-cron.sh:123` runs `node scripts/audit-detection-floor.mjs --gate` and
line 127 maps exit 3 to `failed=1` with *"GATE BLIND ... (not a pass)"*. **An all-UNVERIFIABLE
night cannot exit 0 silently.**

One thing the owner should know: **without `--gate` the audit exits 0 even with FAILs.** My
`S5` run printed `8 PASS, 3 FAIL, 7 UNVERIFIABLE` and exited **0** in report mode. That is
pre-existing T-335 design, not T-340's doing, and the only scheduled caller uses `--gate` — but
any future caller that forgets the flag gets a silent green.

### Scope call

Restricting to `MAINBOARD` rows naming NSE (`detection-floor-checks.mjs` `inScope`) is right.
NSE Emerge and BSE-only issues never appear on `/api/ipo-current-issue`; FAILing them would page
nightly for non-defects, and a muted channel is a dead mechanism. Both directions are covered and
de-duplicated (self-tests confirm a company on both feeds reports once).

---

## Item 5 — honesty and landability

### Merge-tree vs main: **CLEAN**

```
$ git merge-tree --write-tree origin/fleet/T-340 origin/main
9ed06ab42dc26867dffd9206c3840c0033026160     # exit 0, no conflict output
```

### Contamination: **clean**

21 files, all in scope: the entrypoint + its tests, the schema row + migration + journal, the
audit lib/runner/self-tests, the manifest, two env fixtures, one shell-test addition. **No live
state files, no stray `STATUS.md` at repo root, no scratch config.** Fixture env files carry
placeholder credentials only (`pw`, `somepass`, `abcdef`) — no real secret. Nine sibling
`index-*-wiring.test.ts` files change by 3 lines each; that is the mechanical
`ADMIN_API_TOKEN`-in-test-env consequence of item 3, not scope creep.

### Overlap with OPEN PR #236 (`fleet/T-339`): **5 files, 2 conflict**

`git merge-tree origin/fleet/T-340 origin/fleet/T-339` exits **1**.

| File | Result | T-340 hunks | T-339 hunks |
|---|---|---|---|
| `docs/reviews/detection-checks.json` | auto-merged | — | — |
| `scraper/src/index.ts` | auto-merged | — | — |
| `scripts/lib/detection-floor-checks.mjs` | auto-merged | — | — |
| `scripts/audit-detection-floor.mjs` | **CONFLICT** | `@@ -46,6 +46,9` (import), `@@ -426,6 +429,196` (checkK/checkL), `@@ -513,6 +706,8` (main) | `@@ -46,6 +46,7` (import), `@@ -474,6 +475,36` (checkJ), `@@ -514,6 +545,7` (main) |
| `scripts/tests/audit-detection-floor.test.mjs` | **CONFLICT** | `@@ -7,6 +7,7` (import), `@@ -447,3 +448,228` (EOF append) | `@@ -23,6 +23,9` (import), `@@ -447,3 +450,41` (EOF append) |

Both branches append at the same import block, the same EOF anchor, and both add a line to
`main()`. Textual, trivially resolvable — but **whichever lands second must rebase**. Neither
conflicts with `main` today, so this is a landing-order note, not a blocker.

### Is the PR body honest? **Mostly yes — one over-claim**

Genuinely good: it volunteers that migration 0033 is unapplied and both `k_*` checks are
therefore UNVERIFIABLE; that `checkL` never ran against live NSE; that the
`index-*-wiring`/`dataConflicts` mock noise is pre-existing on `main`; and it explains the
`scraper_steps`-not-`scraper_logs`, SME-scope, and `WEB_INTERNAL_URL` calls with reasons that
survive scrutiny. Every claimed suite number reproduces. Every claimed mutation I re-ran was
genuinely RED. That is a high standard.

**The over-claim:** *"A `skipped` status **must** carry a reason."* It must not — nothing
enforces it (F1). One test asserts it for one step. The body presents a convention as a
guarantee, and that is precisely the DoD clause it is answering.

Minor, no action needed: the "Honest limits" section could add that 0033 **is** journaled, so
the two `k_*` checks turn green on their own at the next deploy — the body reads more pessimistic
than reality.

---

## Findings

| # | Sev | File:line | Finding |
|---|---|---|---|
| **F1** | **Blocking** | `scraper/src/index.ts:86-90` | `StepResult.reason` is optional for every status, so a `skipped` row with no reason type-checks and passes all 1300 tests. Contract requires it be impossible. Fix + proof in Item 1. |
| F2 | Non-blocking | `scripts/tests/audit-detection-floor.test.mjs` (manifest-to-script test) | Wiring test greps for `record('id'` in source text; deleting `await checkK()` from `main()` leaves 77/77 green. Guard the invocation, not the string. |
| F3 | Informational | `scripts/audit-detection-floor.mjs` `main()` | Without `--gate`, FAILs exit 0. Pre-existing (T-335); the only scheduled caller passes `--gate`. Flagged so a future caller does not inherit a silent green. |
| F4 | Informational | `scripts/audit-detection-floor.mjs`, `scripts/tests/audit-detection-floor.test.mjs` | Conflicts with open PR #236 (`fleet/T-339`). Second-to-land must rebase. |

## What would flip this to PASS

Fix **F1** only — the 4-line discriminated union (compile error verified), plus the generic
`status !== 'ok'` implies `reason` truthy assertion in the wiring test, and ideally the `CHECK`
constraint in the not-yet-applied migration. F2 is worth taking in the same commit while the
file is open. F3/F4 need no code change on this branch.

## Method note (honesty about my own evidence)

No PostgreSQL was reachable from this machine (no `psql`, no docker), so items 2 and 4 were
executed through `checker-harness-audit.mjs.txt`: a copy of the real runner with **only** the
`pg` import replaced by a fixture-backed fake (plus an env-overridable `NSE_BASE` used solely to
simulate an outage). Every check body, the record/notify path, `computeExitCode` and
`buildRunPayloads` are the shipped code, unmodified. Items 1 and 3 needed no such substitution —
those were the real `index.ts` under `vitest` and `tsx`. The audit's exit code was `2` in the six
non-blind runs because my fake DB starves the unrelated `checkJ` aggregate — `checkK` and
`checkL` both record before that point, which is exactly what proves the runner reaches them.
