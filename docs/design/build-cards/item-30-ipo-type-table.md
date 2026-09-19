# Item 30 — the canonical IPO type table, generated with live counts

Status: DONE (PR pending)

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
recent count (`sample_sufficient`) and the owner's scraper/admin boundary (`scraper_owned`), so
"does this type have two live samples?" and "does the scraper own this type?" are both lookups
instead of ad-hoc queries or a conflated single flag.

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
| `scripts/tests/generate-ipo-type-population.test.mjs` | NEW | asserts the `--check` drift detection, the `sample_sufficient` threshold, and that `scraper_owned` follows the owner's boundary independent of sample count |
| `.github/workflows/pr-gate.yml` | exists | one explicit `node --test` step running the fixture unit tests |

**Class-1 correction (built 2026-09-19):** the card as written named
`.github/workflows/docs-gate.yml` for the `--check` step. That workflow declares no `npm ci` and
runs only `node:` builtins by design (its own header comment) — `pg` is not a builtin, and CI has no
staging tunnel at all (only a spun-up local `ipodhan_test`, `.github/workflows/pr-gate.yml`), so the
generator cannot run in EITHER CI workflow. The intent — CI coverage of the transform logic — is met
instead by an explicit `node --test` step in `pr-gate.yml` running the fixture unit tests
(`scripts/tests/generate-ipo-type-population.test.mjs`); the `--check` red/green proof against real
staging data is the card's own "Staging proof" section below, run locally through the sanctioned
tunnel, same as every other staging-dependent script in this repo (`docs/ops/prod-ops-recipes.md`).

## Schema

No schema change. The generator reads `ipos.segment`, `ipos.offering_type`, `ipos.status` and
`ipos.listing_date`.

**Class-1 correction (built 2026-09-19):** the card as written claimed `ipos.issue_type`. That
column does not exist on `ipos` — `issue_type` lives on `ipo_details` (1:1 via
`ipo_details.ipo_id -> ipos.id`; `packages/shared/src/db/schema.ts`). The generator's intent (the
canonical key includes issue_type) is met with a `LEFT JOIN ipo_details` so rows with no
`ipo_details` row still surface, classified `UNCLASSIFIED`, rather than being silently dropped.

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
      "issue_type": "BOOK_BUILDING",
      "key": "MAINBOARD/IPO/BOOK_BUILDING",
      "total": 99,
      "live_or_recent": 59,
      "sample_sufficient": true,
      "scraper_owned": true
    }
  ]
}
```

`sample_sufficient` is `live_or_recent >= 2` and nothing else; the threshold is a named constant in
the generator, not a literal at its use site. `scraper_owned` is computed separately from a single
exported constant `SCRAPER_OWNED_TYPES` in the generator (segment in {MAINBOARD, SME} AND
offering_type in {IPO, FPO, RIGHTS}; an UNCLASSIFIED segment and OFS — frozen per OD-53 — are never
owned, regardless of sample count) — see the class-1 correction below.

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
- `sample_sufficient` is false at `live_or_recent` 0 and 1, true at 2 — the boundary, asserted at the
  value, not at "greater than zero";
- `scraper_owned` is true for MAINBOARD/IPO and false for OFS and for an UNCLASSIFIED segment,
  regardless of `live_or_recent` — proves the owner's boundary is not a function of sample count;
- `--check` exits 1 when one count in the committed markdown is altered by a single digit, and 0
  when it is not — a drift check that cannot fail is not a drift check;
- a row with a NULL segment lands in a named `UNCLASSIFIED` bucket rather than being dropped — 40
  such rows were measured on staging on 2026-09-19, and a silent drop would make the totals lie.

## Detection

`No detection change: this item adds a generated documentation artefact and its own drift gate; it writes nothing the pipeline reads and creates no new failure mode for a nightly check to watch.`

## Staging proof

The generator run itself is the proof, and it is read back rather than assumed: the committed
`docs/design/ipo-type-population.md` (NEW) names `MAINBOARD/IPO/BOOK_BUILDING` with `live_or_recent` at or
above 2 and `sample_sufficient: true`, and names at least one type with `live_or_recent` below 2 and
`sample_sufficient: false`. A table where every type is proven means the threshold is not being
applied — INVITS and REITS were measured at 1 each on 2026-09-19. The same run shows `MAINBOARD/NCD`
and `MAINBOARD/TENDER` at `sample_sufficient: true` but `scraper_owned: false` — evidence that a
healthy sample count does not, on its own, put a type on the scraper side of the boundary.

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

**Class-1 correction (item 30 follow-up, built 2026-09-19):** the DoD as originally built named a
single `proven_scrapable = live_or_recent >= 2` flag and described it as answering "does this type
have two live samples?" — but the guideline's §5 scraper/admin boundary table is explicit that FPO
is scraper-owned "by the owner's word, not by sample count" and OFS is admin-owned ("Frozen per
OD-53") regardless of its live count. A single count-derived flag cannot represent both facts at
once, and reading it as "the scraper may attempt this type" would have been wrong for every
MAINBOARD/NCD or MAINBOARD/TENDER row once its count crossed 2. The card's intent — a lookup that
answers "is this type scrapable" — is met by renaming the count flag to `sample_sufficient` (same
`>= 2` rule) and adding a second, independent `scraper_owned` flag computed from the exported
`SCRAPER_OWNED_TYPES` constant (§5's list) plus the explicit OFS/UNCLASSIFIED exclusions. A type is
scrapable only when both are true (§3.2's two-per-type evidence bar AND §5's ownership boundary).
