# Item 32 — a Status line on every build card, and a gate that keeps it there

Status: NOT STARTED

Model: Sonnet.

Core: a build card states whether it is built, so the spec and the board cannot disagree about what
exists — Proof: run the extended `check-build-cards.mjs --gate` against the current cards, read the
failure list, and confirm it names exactly the cards that carry no Status line.

Proof: `node docs/design/check-build-cards.mjs --gate` exits 1 while one card's Status line is
removed and exits 0 with all of them present — a gate that cannot go red is not a gate.

Class: none — mechanism, not a deviation.

## Purpose

Every card under `docs/design/build-cards/` carries a `Status:` line, and the card gate fails when
one is missing, so a reader of the design can tell built from unbuilt without opening the tracker.

## Serves

The implementation contract's decision 1c (`docs/contracts/2026-09-09-pull-model-implementation-loop.md`),
which already requires `Status: DONE <date> PRs #… proof <cycle>` on item close, and
`docs/design/spec-deviation-guideline.md` §8 mechanism 4.

Measured 2026-09-19: 35 cards exist under `docs/design/build-cards/`, and **not one carries a Status
line**, though the contract has required it since 2026-09-09. `docs/design/check-build-cards.mjs`
validates thirteen headings, a budget, a tier and that every cited path resolves — it never asks
whether the card was built. The visible cost: issue #807 records item 19 as done while the design
still reads it as open.

## Files

| Path | State | Change |
|---|---|---|
| `docs/design/build-cards/_TEMPLATE.md` | exists | documents the Status line, its two shapes and where it sits |
| `docs/design/check-build-cards.mjs` | exists | adds the Status assertion beside the existing budget and tier assertions |
| `docs/design/stage-3-ledger.md` | exists | read-only source for backfilling the DONE dates and PR numbers |
| `scripts/tests/check-build-cards-status.test.mjs` | exists | red-then-green mutation test for the new assertion; #1027 extends it with PARTIAL + REFUSE_UNKNOWN cases |
| `.github/workflows/docs-gate.yml` | exists | #1027: the "Build cards keep their promise" step gains `GITHUB_TOKEN`/`GH_TOKEN` env so `gh issue view` can run in CI |
| `docs/design/data-sourcing-pull-model.md` | exists | #1027: OD row recording the PARTIAL-shape decision |
| `scripts/ops/build-plan-board.mjs` | exists | #1027: `EXPECT.decisions` bumped for the new OD row |

Every card file under `docs/design/build-cards/` gains one line; they are not listed individually.

## Schema

No schema change.

## Interfaces

Two new exported functions in `docs/design/check-build-cards.mjs` (#1027): `classifyStatusLine(line)`
and `validateStatusLine(line, filename, opts)` — a pure predicate that takes pre-resolved parked-issue
states rather than calling `gh` itself, so tests drive every PARTIAL branch with no network. The
line's three accepted shapes, and nothing else:

```
Status: NOT STARTED
Status: DONE 2026-09-14 PRs #745, #758 proof 2026-09-14 22:00 cycle
Status: PARTIAL 2026-09-25 PRs #1027 proof 2026-09-25 22:00 cycle parked #943, #1022
```

(`unknown — <reason>` is a fourth, temporary shape, accepted only for the cards on
`UNKNOWN_ALLOWED` until `REFUSE_UNKNOWN` flips — see that file.)

The assertion in `check-build-cards.mjs`, stated so it can actually fail:

```js
// A bolded `**Status:**` must NOT satisfy this. The Budget regex on the line above is
// /Budget:\s*\d+\s*min/i and a bolded Budget line is invisible to it — the same shape that
// let a build card ship with a Budget the gate could not see.
if (!/^Status: (NOT STARTED|DONE \d{4}-\d{2}-\d{2} PRs #.+ proof .+)$/m.test(md))
  problems.push(`${f}: no "Status:" line, or one that does not match the accepted shapes`);
```

PARTIAL (#1027, `PARTIAL_RE`) additionally requires every named parked issue to resolve, via one
`gh issue view <n> --json state,labels` call per distinct number for the whole run, to open +
labelled `parked`; an unreachable `gh` fails the card (fails CLOSED), except under the local-only
`--offline-parked-check=skip` flag, which `docs-gate.yml` never sets.

## Feature flag

No flag. The change is a gate assertion plus text in documentation files; there is no runtime
behaviour to enable per slot. Rollback is reverting the commit, which removes the assertion.

## Tests

`scripts/tests/check-build-cards-status.test.mjs` (NEW), red before the change because the assertion does
not exist:

- a card with `Status: NOT STARTED` passes;
- a card with a full `Status: DONE <date> PRs #… proof <cycle>` line passes;
- a card with **no** Status line fails, and the failure message names that card's filename — a gate
  that fails without naming the file sends the reader to grep 35 cards;
- a card with `**Status:** NOT STARTED` (bolded) **fails**, asserted explicitly, because the
  bolded-line hole is exactly how a Budget line once went invisible to its own gate;
- a card with `Status: DONE soon` fails — the shape is asserted, not merely the word.

**#1027 additions:** a well-formed PARTIAL line parses its parked-issue numbers; a PARTIAL line
with no `parked #` is INVALID and fails the real gate; `validateStatusLine` (unit, no network)
passes an open+`parked` issue, fails a CLOSED one, fails one missing the `parked` label, fails one
that never resolved (naming it), and fails closed when `gh` itself is unreachable — naming
`--offline-parked-check=skip`; that flag then makes the same case pass; a real PARTIAL fixture
passes the real gate end-to-end under the flag with no network call; the flag is refused when
`process.env.CI` is set, even locally; flipping `REFUSE_UNKNOWN` to `true` (mutation test, same
technique as the Status-removal test above) turns every allow-listed `unknown` card red, naming
one of them.

The backfill itself is verified by reading the ledger and the merged PR list, never by inference:
a card marked DONE names PR numbers that exist and a cycle that appears in
`docs/design/stage-3-ledger.md`.

## Detection

`No detection change: this item adds an assertion to an existing documentation gate that already runs in docs-gate.yml; it introduces no write path and no runtime behaviour for a nightly check to observe.`

## Staging proof

Not a pipeline change; there is no staging cycle to read. The proof is the mutation run: remove one
card's Status line, `node docs/design/check-build-cards.mjs --gate` exits 1 and names that card;
restore it, and the gate exits 0 with `build cards: 41`.

## Rollback

Revert the commit. The assertion goes, the Status lines stay as harmless text, and nothing that was
written to a database has to be undone.

## Tier, budget and cost

Tier C — documentation text plus one assertion in an existing docs gate; CI and the mutation
self-check are the gate.
Budget: 15 min wall-clock, 30 tool calls. One review round expected.

## Rules implemented

<!-- hand-owned: not generated by apply-rule-ownership.mjs, see docs/design/apply-rule-ownership.mjs HAND_OWNED_MARKER -->

No numbered design rule. It implements the implementation contract's decision 1c, which is a rule
about how we work; §8.5(b) declares such rules in `docs/design/rules-unclaimed.json` rather than
claiming them from a build item.

## Known gaps

Does NOT verify that a `DONE` claim is true. The gate asserts the line's SHAPE; it does not open the
named PRs or confirm the named cycle produced a proof line. A card can be marked DONE against PR
numbers that were never merged and the gate will pass. Closing that needs the traceability chain of
item 20 and is not folded in here.

Does NOT (yet) refuse `unknown` outright. `REFUSE_UNKNOWN` is added as a constant the supervisor
flips once every UNKNOWN_ALLOWED card resolves to DONE / NOT STARTED / PARTIAL; until then, six
cards (items 6, 7, 9, 19, 21, 22) still read `unknown`, per the 2026-09-25 contract's own sequencing
("Last. Resolve each of the 10 unknown cards ... then make check-build-cards.mjs refuse unknown
outright"). Closing this card fully — flipping REFUSE_UNKNOWN and emptying UNKNOWN_ALLOWED — is the
supervisor's own final step of that contract, not this PR (#1027 answers only the Status-line shape
question the contract's last step surfaced: issue #1027).
