# Delta 2 candidates — implementation-loop contract, 2026-09-10

Not a delta. A list of places where the contract as written now disagrees with what the owner
typed later, or with what this session measured. Each entry says what the contract says, what is
actually true, and what I did in the meantime. Nothing here is applied to the contract file —
correcting the contract goes through a delta the owner approves.

---

## 1. Decision 8 names a command that cannot pass

**Contract:** every date-, timezone- or scheduler-touching slice runs
`cd scraper && npx vitest run -c vitest.tzcase.config.ts`.

**Actual:** that command has never passed for anyone. The tz-case files assert
`TZCASE_EXPECT_TZ must be set by the parent` and fail when run directly. Worse than failing:
with `TZ` and `TZCASE_EXPECT_TZ` both set correctly it **hangs**. `mergeConfig` concatenates
`include` globs rather than replacing them, so the config also collects the parent driver, which
then spawns itself recursively and never terminates (a reviewer's run hit a 120s timeout).

The requirement was therefore silently skipped, which is worse than being blocked by it: every
date-touching PR could claim compliance while executing nothing.

**Proposed sentence:**

> Run `npm run test:tzcase` from `scraper/`. Never invoke `vitest.tzcase.config.ts` directly — it
> self-spawns recursively and never terminates; the driver test it names is what sets
> `TZ`/`TZCASE_EXPECT_TZ` per child.

**Meanwhile:** PR #498 adds the `test:tzcase` script and a named pr-gate step, placed *before* the
full scraper suite (see item 5). Issue #478.

---

## 2. The Definition of Done caps PR-gate runs at 12 per day

**Contract, DoD:** "PR-gate runs per day ≤ 12".

**Actual:** the owner typed "cap 60 per day, 20 tonight" on 2026-09-09, and three lanes now share
that budget. Today reached 49. The 12 is dead text; leaving it in means any reader auditing the
DoD marks the run non-compliant on a rule the owner replaced.

**Meanwhile:** operating to 60, with a self-imposed stop at 50 agreed across the three lanes.

---

## 3. The count command in the contract is wrong in two ways

**Contract:** derives the day's PR-gate runs with `gh run list ... --created <date>`.

**Actual, both found by measurement:**

- `gh run list` defaults to **20 results** and silently truncates. A day with 49 runs reports 20.
- `--created <date>` and `startsWith("2026-09-10")` filter on the **UTC** day, which begins at
  05:30 IST. Between 00:00 and 05:30 IST it reports the *previous* IST day, and at any hour it
  drops that morning's overnight runs. Measured today: 46 by the UTC filter against a true 48,
  at a moment when the lanes believed four runs remained. That gap is large enough to authorise a
  push that should have been held.

**Correct form** (IST midnight expressed as UTC, an explicit limit, and a truncation check):

    gh run list --workflow pr-gate.yml --created ">=<IST-midnight-as-UTC>" --limit 100 \
      --json headBranch --jq "length"

**Meanwhile:** codified as `scripts/ops/pr-gate-count.mjs` on the ledger branch. It computes IST
midnight itself, prints the per-branch breakdown, exits 1 at the stop, and warns if it ever sees a
run whose `event` is not `pull_request` — because the "a push to a PR-less branch is free"
assumption depends on `pr-gate.yml` being `on: pull_request` and nothing else.

---

## 4. The shrink-only guardrail forbids the initial population it also requires

**Contract, guardrails:** "No baseline entry added to any shrink-only baseline" and "After any
baseline regeneration, `git diff config/*.json` must show deletions only; a diff containing an
added line is reverted."

**Actual:** PR #500 **added 25 entries** to `config/web-integration-baseline.json`. On a literal
reading that is a guardrail breach, and a later auditor will read it as one.

It is not, for two reasons worth writing down rather than assuming:

1. The owner typed the instruction that ordered it: *"baseline the 26 failing files by name in a
   shrink-only list, gate web-touching slices on no new failures … and the release cut requires
   the list empty."* Creating the list is the instruction; the guardrail governs what happens
   after it exists.
2. The file shipped with `files: []` and a `generated_from` reading `TODO: populate from the first
   CI run`. An empty shrink-only list is not a strict gate, it is a **dead** one — every failing
   file is "NEW", so it either fails on everything or, when no report arrives, proves nothing.

**Proposed wording:** the guardrail should distinguish the one-time creation of a baseline the
owner ordered (allowed, once, with the CI run URL recorded in `generated_from`) from a later
addition that grandfathers a newly-broken file (forbidden, always). As written it does not.

**Meanwhile:** #500 records its provenance — run 34474441392, artifact `web-integration-report`,
`main` at `d8ad025d` — and the file's `_comment` states that the earlier "26 of 44" figure is
withdrawn and why.

---

## 5. A named gate step placed LAST in a job can never show the failure it exists for

Not a contract contradiction — a class the contract should name, found by a Tier A review of #498.

GitHub skips every later step in a job once one fails. A step added at the end of a job "so a
regression is identifiable at a glance" is therefore rendered **grey**, not red, on exactly the
run where it mattered, because a longer suite earlier in the job contains the same test and fails
first. The visibility it was added for is the one thing it cannot deliver.

**Proposed rule:** a named gate step runs BEFORE the long suites in its job.

**Meanwhile:** #498 moved. `pr-gate.yml` has at least one pre-existing step with the same shape
(the pipeline-stage harness) — not fixed here, named so it is not forgotten.

---

## 6. Migration index is taken at merge time, not at build time

Not a contract contradiction — a gap the three-lane split created and the contract predates.

`web/drizzle/migrations/meta/_journal.json` entries are numbered from `origin/main`. A slice that
generates a migration and is then held while another slice merges carries a **stale index**.
Measured today: item 1 slice s6 and PR #459 both claimed `idx: 36`. Individually valid; merged,
drizzle skips or double-applies a step.

**Proposed rule:** any branch holding a generated migration is re-checked against `origin/main`
immediately before its PR opens, never at build time —
`git merge-tree --write-tree --messages origin/main <branch>`, which costs no Actions run. After
midnight three lanes merge in a queue, so every branch after the first is stale by construction.
The hard-coded `journalEntries` count in
`scraper/tests/unit/pipeline-stages/fixtures/stage-0/expected-schema.json` moves with it.

**Meanwhile:** s6 rebased to `idx: 37`, fixture bumped 37 to 38, verified by an independent
merge-tree run.

---

## 7. §0.3's `items/item-NN` board document was not being written

My own compliance gap, not a contract defect. §0.3 requires both `run/meta` **and**
`items/item-NN` on the status board at every slice transition. Only `run/meta` was being updated,
so the owner's board showed the headline but not the slice table.

**Meanwhile:** `items/item-01` written with all 19 slices and their statuses. No contract change
needed — the contract was right and I was not following it.
