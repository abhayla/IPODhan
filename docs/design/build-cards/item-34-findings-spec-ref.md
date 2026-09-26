# Item 34 — `spec_ref` on every failure class, validated against the spec's real sections

Status: NOT STARTED

Model: Sonnet.

Core: a registered finding names the spec section it touches, and the name is checked against the
spec rather than trusted — Proof: add `spec_ref` to one real failure class, regenerate, and read the
new column back out of the GENERATED `docs/reviews/failure-classes.md`; then break the reference to
a section that does not exist and read the generator refuse.

Proof: `node scripts/build-detection-registry.mjs --check` exits 0 with the new column committed,
and exits 1 when a `spec_ref` names `§9.9`, which the spec does not have.

Class: none — mechanism, not a deviation.

## Purpose

Every failure class carries the spec section or sections it touches, that reference is validated
against the spec's real section list, and it RENDERS in the generated table a reader actually reads.

## Serves

The owner's findings-sync decision of 2026-09-19 and `docs/design/spec-deviation-guideline.md` §6:
the spec and the registry never stand against each other, which is only checkable if a finding says
which part of the spec it is about.

Measured 2026-09-19: 40 entries under `docs/reviews/failure-classes/`, none carrying a spec
reference. And the mechanical trap this item exists to avoid — `COLUMNS` in
`scripts/build-detection-registry.mjs` is a fixed seven-element list, so a key outside it validates
cleanly, passes `--check`, and renders nowhere. A `measurements_*` key did exactly that on
2026-09-19.

## Files

| Path | State | Change |
|---|---|---|
| `scripts/build-detection-registry.mjs` | exists | `spec_ref` added to `COLUMNS` and `HEADER_LABELS`; a validator resolving each reference against the spec's headings |
| `docs/reviews/failure-classes.md` | exists | regenerated with the new column |
| `docs/reviews/README.md` | exists | the seven-column sentence becomes eight, with `spec_ref`'s shape and the rule that an unknown section is refused |
| `scripts/tests/build-detection-registry.test.mjs` | exists | cases for the new column and the refusal |
| `docs/design/data-sourcing-pull-model.md` | exists | read-only: the source of the valid section list |

Every file under `docs/reviews/failure-classes/` gains a `spec_ref` key; they are not listed
individually. A class that touches no part of the pull model carries `"spec_ref": []` — an empty
list, never a missing key, because a missing key and a deliberate "none" read identically.

## Schema

No schema change. These are repository JSON artefacts, not database tables.

## Interfaces

No new exported function. The key's shape, complete:

```json
"spec_ref": ["§2.5", "§3.3"]
```

The validator, and the reason it reads the spec rather than a list:

```js
// A hand-kept list of valid sections is a second definition of the spec's shape, and the two
// drift the first time a section is renumbered. Read the headings out of the document.
const SECTION_RE = /^#{2,4} (\d+(?:\.\d+)*)/gm;
const known = new Set([...spec.matchAll(SECTION_RE)].map((m) => '§' + m[1]));
for (const ref of data.spec_ref ?? [])
  if (!known.has(ref)) throw new Error(`failure-classes/${file}: spec_ref ${ref} names no section of the design`);
```

## Feature flag

No flag. The generator is a repository tool with no runtime path and no per-slot behaviour.
Rollback is reverting the commit, which removes the column and the validation together.

## Tests

In `scripts/tests/build-detection-registry.test.mjs`, red before the change because `spec_ref` is
not a column:

- a class carrying `"spec_ref": ["§2.5"]` renders `§2.5` in the generated table — asserted by
  grepping the GENERATED markdown, not the source JSON, which is the whole point of the R5b caution;
- a class carrying `"spec_ref": []` renders an empty cell and does not throw;
- a class carrying `"spec_ref": ["§9.9"]` makes the generator exit non-zero with a message naming
  the file and the bad reference — the refusal, asserted at the value;
- a class with **no** `spec_ref` key at all makes the generator exit non-zero, so the backfill cannot
  be half-finished silently;
- `--check` exits 1 against an aggregate regenerated before the column was added — the drift path,
  which is what stops a stale table merging.

## Detection

The check this item changes is the registry generator's own `--check`, already wired into the
`detection-change-gate` job in `.github/workflows/pr-gate.yml` via
`scripts/tests/build-detection-registry.test.mjs`. It now additionally asserts that every failure
class names a real spec section, so a finding that points at a section someone renumbered goes red
at the pull request instead of rotting.

## Staging proof

Not a pipeline change; there is no staging cycle to read. The proof is the generated artefact read
back: `grep -c 'spec_ref' docs/reviews/failure-classes.md` is non-zero and the header row carries the
column, plus one mutation run where a reference is pointed at `§9.9` and the generator refuses,
naming the file.

Reading the source JSON back is explicitly NOT the proof. That is what passed cleanly while the
`measurements_*` key rendered nowhere.

## Rollback

Revert the commit. The column leaves the generated table, the `spec_ref` keys remain in the
per-entry files as inert data, and nothing in a database is touched.

## Tier, budget and cost

Tier B — it changes a generator whose `--check` gates other people's pull requests, and a wrong
validator would refuse legitimate findings. Diff-only review, CI green, merge on PASS.
Budget: 30 min wall-clock, 60 tool calls. One to two review rounds expected.

## Rules implemented

<!-- hand-owned: not generated by apply-rule-ownership.mjs, see docs/design/apply-rule-ownership.mjs HAND_OWNED_MARKER -->

No numbered design rule. It implements the owner's findings-sync decision and
`docs/design/spec-deviation-guideline.md` §6, both rules about how we work; §8.5(b) declares such
rules in `docs/design/rules-unclaimed.json`.

## Known gaps

Does NOT check that a `spec_ref` is the RIGHT section — only that it names a section that exists. A
finding about the re-read loop may point at §7.6 and pass. Judging relevance is a reviewer's job and
is named here rather than pretended away.

Does NOT extend `spec_ref` to `docs/reviews/detection-checks/`. A detection check is about a
mechanism rather than a design clause, and adding the key there without a use for it is speculative
generality; it is left out deliberately, with this sentence as the record.
