# Build card template

Every card under `docs/design/build-cards/` carries these eleven headings, spelled exactly as below
and in this order. A grep for the eleven is part of the design gate, so a card that renames one is a
card that does not count.

The card exists to answer one question: **can an engineer who was not in any of these conversations
build this item without asking anybody a question?** If a heading would need "it depends" or "we
should decide", that is a fork — record it in §0.0.2 of the design as `O-nn` with a recommendation
(OD-24) and write the card on the recommendation, marked `**PROVISIONAL on O-nn**`.

Rules that apply to every card:

- **Every file path is real or marked `NEW`.** A path that neither exists nor says NEW is a defect.
- **Every line range refers to the current code**, read this session, not remembered.
- **No number is typed from memory** (OD-18). Measure it, or cite where it comes from.
- **No card invents a decision.** If the design does not say, the card says the design does not say.

---

## Purpose

One sentence. What is true after this ships that is not true today.

## Serves

The finding ids (`F-nn`), owner decisions (`OD-nn`) and design sections this item implements. If it
serves none, say so — an item nothing asked for is worth challenging before it is built.

## Files

A table: path · exists or NEW · what changes, with the current line range of the code being replaced.

| Path | State | Change |
|---|---|---|

## Schema

Every new table, column and index, written as Drizzle in `packages/shared/src/db/schema.ts` terms,
plus the migration SQL `npm run db:generate` will produce. Destructive DDL goes in
`web/drizzle/migrations/_gated/` and is applied by hand after the owner signs off — never added to
`meta/_journal.json`, which is how production columns get dropped. If there is no schema change, say
`No schema change.`

## Interfaces

TypeScript signatures of every new or changed exported function, and the full shape of every
configuration file with a complete worked example (not an ellipsis). If there is no new interface,
say so.

## Feature flag

The flag name, where it is read (`scraper/src/config/feature-flags.ts` or the env), and its default
per slot (prod / staging / local). If the change cannot sit behind a flag, say why and what the
rollback is instead.

## Tests

The tests that must exist and be **red before the change**: unit file path, integration file path,
and for scraper items the tier per `.claude/rules/scraper-test-layout.md`. Name what each asserts.
A test that would pass before the change is not a test of the change.

## Detection

The check under `docs/reviews/detection-checks/` that this item adds or changes, per
`.claude/rules/recurrence-detection-gate.md` — check id, what it asserts, where it runs (nightly
audit, CI, cycle). Or the single line `No detection change: <reason of 20+ characters>`, which the
PR gate accepts and a reviewer will read.

## Staging proof

The **exact** log line or audit counter that proves this worked on staging, its healthy value, and
which cycle carries it (`defect-fix-contract.md` item 5). For a data repair, additionally
`node scripts/assert-repair-held.mjs <invariant> --cycles 2` — a clean read straight after a repair
proves nothing about whether the next real scraper cycle overwrites it.

## Rollback

One paragraph. What is undone, how, and what cannot be undone. "Revert the commit" is only an answer
when no data was rewritten.

## Tier, budget and cost

Tier A / B / C per the review-tier rule (A: deletes, prod deploy, scheduled work, auth, payments,
migrations, gates · B: ordinary app code with CI green · C: docs, config text, renames).
`Budget: <N> min wall-clock, <M> tool calls`. Cost in wall-clock and expected review rounds.
