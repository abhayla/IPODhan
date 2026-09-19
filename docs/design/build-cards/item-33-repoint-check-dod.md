# Item 33 — repoint `check-dod.mjs` so it runs in any checkout, and wire it into CI

Status: NOT STARTED

Model: Sonnet.

Core: the Definition-of-Done walker must run where the code is, not where it was written — Proof:
run `node docs/design/check-dod.mjs` in this worktree before the change and read the ENOENT it
throws, then run it after the change in the same worktree and read a real per-item report.

Proof: the script exits with a report (0 or 1) in a fresh worktree whose path is not
`IPODhan-IPODhan-pullmodel-delta`, and the `docs-gate` job shows the step by name.

Class: none — mechanism, not a deviation.

## Purpose

`docs/design/check-dod.mjs` runs in any checkout of this repository and in CI, instead of crashing
everywhere except one developer's directory.

## Serves

`docs/design/spec-deviation-guideline.md` §8 mechanism 5, and §8.5(d)'s principle that a check
nobody can run is a check that is not run.

Measured 2026-09-19: line 3 of the script is
`process.chdir('D:/Abhay/Ventures/IPODhan-IPODhan-pullmodel-delta');` — an absolute path to a
worktree that no longer exists, so the script throws ENOENT before its first assertion in every
checkout including `main`. It is referenced by no workflow, so nothing noticed.

## Files

| Path | State | Change |
|---|---|---|
| `docs/design/check-dod.mjs` | exists | remove the hard-coded `process.chdir`; resolve the repo root from `process.argv[2]` when given, else `process.cwd()`; assert the root looks like this repo before running |
| `.github/workflows/docs-gate.yml` | exists | one step: `node docs/design/check-dod.mjs` |
| `scripts/tests/check-dod-root-resolution.test.mjs` | NEW | red-then-green test for the root resolution and the refusal |

## Schema

No schema change.

## Interfaces

```
// docs/design/check-dod.mjs
//   node docs/design/check-dod.mjs            root = process.cwd()
//   node docs/design/check-dod.mjs <path>     root = <path>
// EXIT: 0 every DoD item proven · 1 at least one item not proven · 2 the check itself broke
```

The refusal that replaces the chdir, and why it is a refusal rather than a guess:

```js
const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
// Running against the wrong directory is worse than not running: every item reads as
// unproven and the report is noise. Refuse instead of reporting a false failure.
if (!fs.existsSync(path.join(root, 'docs/design/data-sourcing-pull-model.md'))) {
  console.error(`check-dod: ${root} is not an IPODhan checkout (no docs/design/data-sourcing-pull-model.md). Pass the repo root as the first argument.`);
  process.exit(2);
}
```

Two assertions inside the script are counts that this pull request itself moves, and they are read
from the tree rather than typed: the card count (`22` in the committed script, 35 on `main` today,
41 after this pull request) and the owner-decision row count (`52` in the committed script, and the
register has grown since). Both become reads of the live artefact with the DoD item restated as
"the count matches the register", never a literal.

## Feature flag

No flag. The script is a developer and CI check with no runtime path. Rollback is reverting the
commit; the script returns to crashing, which is the state it is in today.

## Tests

`scripts/tests/check-dod-root-resolution.test.mjs` (NEW), red before the change because the script
crashes on import in any directory:

- run with no argument from a temporary directory that is NOT a checkout → exit 2 and a message
  naming the directory, not a stack trace;
- run with the repo root as `argv[2]` from that same temporary directory → a real report, proving
  the argument path is used and the cwd is not silently preferred;
- run with no argument from the repo root → the same report — the two paths agree;
- the script's source contains no `process.chdir(` at all, asserted directly, so the defect cannot
  be reintroduced by a later edit that adds a "temporary" chdir back.

## Detection

`No detection change: this item repairs a documentation checker and wires it into an existing docs gate; it touches no scraper or persister write path and adds no failure mode a nightly audit could observe.`

## Staging proof

Not a pipeline change; there is no staging cycle to read. The proof is the CI run itself: the
`docs-gate` job on the pull request shows a step named for the DoD walker, with its exit code, and
the job is green. A step that does not appear in the job's step list did not run — that absence is
precisely how this script went unnoticed for nine days.

## Rollback

Revert the commit. The step leaves `docs-gate.yml` and the script returns to its current crashing
state. No stored value is touched.

## Tier, budget and cost

Tier B — it changes a script and adds a step to a CI workflow that gates other people's pull
requests; a wrong refusal condition would block the docs gate for everyone. Diff-only review,
CI green, merge on PASS.
Budget: 30 min wall-clock, 60 tool calls. One to two review rounds expected.

## Rules implemented

No numbered design rule. This repairs the mechanism behind §8.5(d) rather than implementing a rule
of the pull model; §8.5(b) declares rules about how we work in
`docs/design/rules-unclaimed.json`.

## Known gaps

Does NOT re-derive the Definition of Done itself. Several of the script's items were written against
the state of the tree on 2026-09-09 and assert counts that have since moved for legitimate reasons;
this item makes those assertions read the live artefact, but it does not revisit whether each DoD
item is still the right question to ask. That review is the owner's and is left named here.
