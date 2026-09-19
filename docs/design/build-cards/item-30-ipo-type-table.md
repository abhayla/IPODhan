# Item 24 — the canonical IPO type table, generated with live counts

Status: NOT STARTED

Model: Sonnet.

Core: the canonical IPO type list is `segment × offering_type × issue_type` read from the staging
database, not a list typed into a document — Proof: run the generator against staging through the
sanctioned tunnel and read back a table whose row count and per-type counts match a hand-run
`GROUP BY` of the same three columns.

Proof: `node scripts/ops/generate-ipo-type-population.mjs --check` exits 0 against a freshly
generated file, and exits 1 when one count in the committed table is edited by hand.

Class: none — mechanism, not a deviation.

## Purpose

There is one canonical list of IPO types, generated from the data, carrying each type's live and
recent count and a `proven-scrapable` flag, so "does this type have two live samples?" is a lookup
instead of an ad-hoc query.

## Serves

`docs/design/spec-deviation-guideline.md` §3.2 (the two-live-samples bar) and §5 (the scraper/admin
boundary, which is drawn on that same count). §1.11 of the design gathers exceptions by IPO type but
states populations that were measured once, by hand, in September 2026. Nothing regenerates them.

**This item is FIRST.** Items 25, 26, 28 and 29 all reference "the IPO type" or "two live samples";
none of them can be checked while the list of types is five different implicit lists.

## Files

| Path | State | Change |
|---|---|---|
| `scripts/ops/generate-ipo-type-population.mjs` | NEW | reads staging through the tunnel, writes the markdown table and the json |
| `docs/design/ipo-type-population.md` | NEW | the generated table — header comment says it is generated, do not hand-edit |
| `docs/design/ipo-type-population.json` | NEW | the same data as a machine-readable aggregate, for item 34 and item 35 to read |
| `scripts/tests/generate-ipo-type-population.test.mjs` | NEW | asserts the `--check` drift detection and the `proven-scrapable` threshold |
| `.github/workflows/docs-gate.yml` | exists | one step running the generator with `--check` |

## Schema

No schema change. The generator reads `ipos.segment`, `ipos.offering_type`, `ipos.issue_type` and
`ipos.status` only.

## Interfaces

```
// scripts/ops/generate-ipo-type-population.mjs
//   node scripts/ops/generate-ipo-type-population.mjs           regenerate both artefacts
//   node scripts/ops/generate-ipo-type-population.mjs --check    exit 1 if the committed files drift
```

Generated json shape, complete:

```json
{
  "generatedAt": "2026-09-19T00:00:00.000Z",
  "source": "ipodhan_staging via localhost:15432",
  "types": [
    {
      "segment": "MAINBOARD",
      "offering_type": "IPO",
      "issue_type": "BOOK_BUILT",
      "key": "MAINBOARD/IPO/BOOK_BUILT",
      "total": 99,
      "live_or_recent": 59,
      "proven_scrapable": true
    }
  ]
}
```

`proven_scrapable` is `live_or_recent >= 2` and nothing else; the threshold is a named constant in
the generator, not a literal at its use site.

`live_or_recent` counts rows whose status is UPCOMING, OPEN or CLOSED, plus LISTED rows whose
listing date is within 180 days — the same 180 days OD-35 already uses, cited rather than reinvented.

## Feature flag

No flag. The generator writes two documentation artefacts and reads nothing the pipeline writes to;
there is no runtime behaviour to turn off. Rollback is reverting the commit.

## Tests

`scripts/tests/generate-ipo-type-population.test.mjs` (NEW), red before the change because the generator
does not exist:

- a fixture of rows produces exactly the expected `key` set — proves the canonical key is the
  three-column product and not `segment` alone;
- `proven_scrapable` is false at `live_or_recent` 0 and 1, true at 2 — the boundary, asserted at the
  value, not at "greater than zero";
- `--check` exits 1 when one count in the committed markdown is altered by a single digit, and 0
  when it is not — a drift check that cannot fail is not a drift check;
- a row with a NULL segment lands in a named `UNCLASSIFIED` bucket rather than being dropped — 40
  such rows were measured on staging on 2026-09-19, and a silent drop would make the totals lie.

## Detection

`No detection change: this item adds a generated documentation artefact and its own drift gate; it writes nothing the pipeline reads and creates no new failure mode for a nightly check to watch.`

## Staging proof

The generator run itself is the proof, and it is read back rather than assumed: the committed
`docs/design/ipo-type-population.md` (NEW) names `MAINBOARD/IPO/BOOK_BUILT` with `live_or_recent` at or
above 2 and `proven_scrapable: true`, and names at least one type with `live_or_recent` below 2 and
`proven_scrapable: false`. A table where every type is proven means the threshold is not being
applied — INVITS and REITS were measured at 1 each on 2026-09-19.

No data repair, so no `assert-repair-held` run.

## Rollback

Revert the commit. Nothing is written to any database and no stored value is rewritten, so the
rollback is complete.

## Tier, budget and cost

Tier C — a generated documentation artefact plus its drift gate; CI and the self-check are the gate.
Budget: 15 min wall-clock, 30 tool calls. One review round expected.

## Rules implemented

No numbered design rule. This item serves `docs/design/spec-deviation-guideline.md` §3.2, which is a
rule about how we work rather than a rule about the pipeline, and §8.5(b) declares such rules in
`docs/design/rules-unclaimed.json` rather than pretending a build item implements them.

## Known gaps

Does NOT reconcile the five places the design and the code each define a type (segment,
offering_type, pricing, document type, status). It produces ONE generated list and names it
canonical; making the other four point at it is a separate change with a class of its own, and it is
left visible here rather than quietly folded in.
