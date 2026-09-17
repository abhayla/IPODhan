# Item 3 / slice S0a — spec repair: Moneycontrol out of the authored ranks, reasons on the fields that fell to two, counts regenerated

Stage 3 ("one source table", plan v2 §4, order S0a → S0b → S0c → S5 → S1a → S1b → S1c → S1d → S2 → S3
→ S4 → S6). Ledger: `docs/design/stage-3-ledger.md`. Gate: `node scripts/check-stage3-dod.mjs --slice S0a`.

## Purpose

After this ships, `docs/design/field-source-resolution.spec.mjs` names no retired source in any
authored rank, every field that dropped from three sources to two when Moneycontrol was retired carries
a stated reason, and the design's "mainboard source depth" table is a generated block that equals the
spec's own count — so S0b can generate the registry from a spec that is internally true.

## Serves

- OD-3 (Moneycontrol retired, 2026-09-09): §1.11.1 says "zero ranks"; the spec still authors `MC` in
  38 `r` arrays (measured 2026-09-17 with `RESOLVE`/`F`, see Files). `resolve()` drops it at read
  time (spec line 296-311, `MC_SERVES = new Set([])`), so Appendix A is right and D1/D10b pass; the
  authored list is the lie.
- Plan v2 §4 S0a and §4b finding 12 (order).
- OD-18 (no number typed from memory): the design's depth table at
  `docs/design/data-sourcing-pull-model.md:3474-3480` says three sources **97**, two **22**, one
  **71**, none **50**. Measured on origin/main b0fafc6b for the 190 class D/T/X/W/M fields, MAINBOARD
  type, via `RESOLVE(f,'MAINBOARD')` with `—`/`N/A` removed: three **50**, two **72**, one **68**,
  and 50 class C/I fields with no source. The table is hand-typed (no `<!-- generated:` marker; D2
  covers only marked blocks, `check-design-consistency.mjs:72-84`).

**Correction to plan v2 §4:** the plan says the gate "is red today on 'fewer than three sources with
no reason'". It is not: `node docs/design/check-design-consistency.mjs --gate` exits 0 on b0fafc6b
(run 2026-09-17 12:2x IST, 22 checks PASS) and no such check exists. S0a ADDS the check (D21) and it
is red before the spec edit.

## Files

### What already exists (reuse; do not write a second copy)

| Exists on origin/main | Reuse for |
|---|---|
| `docs/design/field-source-resolution.spec.mjs` — `F` (line 9), `add(...)` rows, `MC_SERVES` (line 311), `resolve()` (365-381), `RESOLVE`/`STATS` exports (363, 416-421), CLI guard (428+) | the data and the counting; `STATS()` gains depth counts |
| `docs/design/generate-appendix-a.mjs` (`--write`, `--check`) | regenerates A.1/A.2 and the `<!-- generated:evidence-summary -->` block; the depth table becomes a second generated block written by the same tool |
| `docs/design/check-design-consistency.mjs` — D1 (spec vs Appendix A), D2 (generated blocks, lines 72-84), D10b line 250 (already knows "the GENERATED appendix is the truth, not the spec's raw rank list") | add D21 next to D19/D20; reuse D2's generated-block reader for the new block |
| `docs/design/check-mutations.test.mjs` | every new check is mutation-tested red-then-green; add D21's two mutations there |
| `scripts/tests/check-design-consistency-exit.test.mjs` (in pr-gate.yml line 126) | unchanged; proves `--gate` exit codes |

### Changes

| Path | State | Change |
|---|---|---|
| `docs/design/field-source-resolution.spec.mjs` | exists | remove `'MC'` from the 38 `r` arrays that still carry it (list: `ipos.sector ipos.company_description ipos.objectives ipo_details.company_description financial_data.{revenue,profit,ebitda,total_income}_fy2022/23/24 financial_data.{net_worth,eps,roe,debt_to_equity,reserves_and_surplus,total_assets,total_borrowing,promoter_holding_pre_issue,promoter_holding_post_issue,market_cap,pre_ipo_eps,post_ipo_eps,ronw} financial_statements.{fiscal_year,revenue,total_income,ebitda,pat,net_worth} ipo_valuation.{mcap_at_cap,pe_at_cap} promoters.name`); add a `note` to the 29 of them that have none (the other 9 already carry one), stating why no third source exists (e.g. "NSE/BSE payloads carry no restated financials; CG is the only website that prints the per-FY table" — the reason must be a fact from the probes, not a guess); extend `STATS()` with `depth: {three, two, one, none}` computed exactly as above |
| `docs/design/generate-appendix-a.mjs` | exists | emit the depth table as `<!-- generated:source-depth -->` … block (same marker style as `evidence-summary`, line 3587 of the design) from `STATS().depth`; `--check` compares it like the other blocks |
| `docs/design/data-sourcing-pull-model.md` | exists | lines 3474-3480 replaced by the generated block (97/22/71/50 → 50/72/68/50); §1.11.1 sentence "zero ranks" now also true of the authored list |
| `docs/design/check-design-consistency.mjs` | exists | new **D21**: (a) no `r` array in `F` contains a retired source (`MC`); (b) every field in the 38-name list above carries a non-empty `note`; (c) the `source-depth` block equals `STATS().depth`. Fails with the offending names |
| `docs/design/check-mutations.test.mjs` | exists | two mutations for D21: re-insert `'MC'` into one `r`; blank one of the 29 notes — both must turn D21 red |

## Schema

No schema change.

## Interfaces

```js
// docs/design/field-source-resolution.spec.mjs — STATS() gains one key; nothing else changes shape
export const STATS = () => ({
  fields: 240, classes: {...}, e1: 10, singleSource: <n>,
  depth: { three: 50, two: 72, one: 68, none: 50 }   // MAINBOARD, classes D/T/X/W/M; none = C+I
});
```

## Feature flag

None. Docs and the design gate only; nothing runs in production.

## Tests

### Failing test first

`node docs/design/check-design-consistency.mjs --gate` must print `[FAIL] D21 38 authored rank(s)
still name a retired source; 29 field(s) fell below three sources with no reason; source-depth block
absent` BEFORE the spec edit, and `[PASS] D21 …` after. `node docs/design/check-mutations.test.mjs`
must list both D21 mutations as caught.

Tier: docs/design scripts have no vitest tier; the check and its mutation test are the tests.

## Detection

`No detection change: docs-only slice; the design gate (D21) is the detection and runs in pr-gate.yml`.

## Staging proof

Not applicable (no runtime change). Proof is the gate run and `STATS()` printed in the PR body.

### Definition of Done

| id | command | expect | env |
|---|---|---|---|
| S0a-1 | `node docs/design/check-design-consistency.mjs --gate` | exit 0 | local |
| S0a-2 | `node docs/design/check-design-consistency.mjs` | line: `[PASS] D21` | local |
| S0a-3 | `node docs/design/check-mutations.test.mjs` | exit 0 | local |
| S0a-4 | `node -e "import('./docs/design/field-source-resolution.spec.mjs').then(m=>{const n=m.F.filter(f=>(f.r||[]).includes('MC')).length;console.log('MC-in-r='+n);process.exit(n?1:0)})"` | line: `MC-in-r=0` | local |
| S0a-5 | `node -e "import('./docs/design/field-source-resolution.spec.mjs').then(m=>{const d=m.STATS().depth;console.log(JSON.stringify(d));process.exit(d&&d.three===50&&d.two===72&&d.one===68&&d.none===50?0:1)})"` | exit 0 | local |
| S0a-6 | `node docs/design/generate-appendix-a.mjs --check` | exit 0 | local |
| S0a-7 | `grep -c "generated:source-depth" docs/design/data-sourcing-pull-model.md` | line: `1` | local |

## Rollback

`git revert` of the one commit; no data was written anywhere.

## Tier, budget and cost

Tier C (docs, contracts, design gate). `Budget: 15 min wall-clock, 30 tool calls`. Review: none
(CI + the supervisor's gate run is the gate). Builder: Sonnet.

### Dependencies

None. First slice of the stage.

## Rules implemented

| Design section | Rule ids |
|---|---|
| §1.11.1 | R-157 |

## Known gaps

- 97 further class D/T/X/W/M fields resolve to one or two sources with no `note` (126 total minus the
  29 this slice fixes; measured 2026-09-17). They were never three-source, so OD-3 did not create
  them; they are single-source-by-nature fields (document-only, registrar-only). Left as is; D21
  checks only the ex-Moneycontrol list. Owner may widen D21 to all 126 later (a docs-only slice).
- `promoters.name` and the six `financial_statements.*` rows already carried notes; they are in the
  38-name list for the `MC` removal only.
