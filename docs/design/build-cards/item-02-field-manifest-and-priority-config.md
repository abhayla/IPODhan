# Item 2 — field manifest and priority configuration

**PROVISIONAL on nothing new.** Scoped entirely inside OD-5 (§2.3.5) and OD-1 (§1.1); no fork opened.

## Purpose

After this ships, which document type prints a field, its rank order per IPO type, and which
sources are even capable of serving it live in one validated file family under `scraper/config/` (NEW)
instead of scattered across `field-priority-matrix.ts` TypeScript and this design's Appendix A —
so changing a rank order is a config edit and a deploy, never a code change and a PR.

## Serves

- **OD-5** (§2.3.5) — *"Make this priorities configurable... we should not be required to change
  the code."* This item is the registry layer OD-5 names: *"The registry —
  `config/field-sources.json`, in the repo. One row per field: its ranks, its unit, its check, its
  exceptions."* (I used `.yaml` + a JSON Schema rather than raw `.json` — the brief for this card
  asked for a schema-validated file family, and YAML with a schema is the same contract with
  comments allowed; if the owner wants the literal filename `field-sources.json`, that is a
  one-line rename, not a re-design.)
- **§7.1 item 2** — "Field manifest + priority configuration... as one validated configuration
  file family." Depended on by items 3, 4, 5, 13 (§7.1's dependency column).
- **§1.1** — the six-class table (D/T/X/W/M/C/I) and the 190-of-240 pulled-field scope this
  manifest covers (C and I fields are never sourced, so they carry no manifest row).
- **§0.6** — closes part of the "130 populated published fields with NO matrix entry" gap by
  giving every D/T/X/W/M field exactly one entry, keyed on the real camelCase-derived path, not a
  second entry in the wrong case (item 3 does the deletion; this item is what item 3 adopts).

## Files

| Path | State | Change |
|---|---|---|
| `scraper/config/field-manifest.yaml` | **NEW** (`scraper/config/` does not exist today — `ls scraper/config` fails; only `scraper/src/config/` exists) | The manifest: one entry per D/T/X/W/M field, keyed `"<table>.<column>"` |
| `scraper/config/field-manifest.schema.json` | **NEW** | JSON Schema (draft-07) the loader validates the YAML against before anything reads it |
| `scraper/src/config/field-manifest-loader.ts` | **NEW** | `loadFieldManifest()` — parse + schema-validate + cross-check (see Interfaces) |
| `scraper/src/index.ts` | exists, 1390 lines | Add `loadFieldManifest()` at the top of the CLI guard (currently `if (import.meta.url === pathToFileURL(process.argv[1]).href) { main(); }` at lines 1388–1390) — call it **before** `main()` so a malformed file stops the process before any scraper runs, never mid-cycle |
| `scraper/src/config/field-priority-matrix.ts` | exists, 969 lines | Not touched by this item — item 3 is what makes the matrix read from the manifest instead of its own hard-coded object |

## Schema

No database schema change. This item is a configuration file plus its loader; nothing in
`packages/shared/src/db/schema.ts` moves.

## Interfaces

```typescript
// scraper/src/config/field-manifest-loader.ts

export type SourceCode =
  | 'ADMIN' | 'DOC' | 'DRHP' | 'RHP' | 'PROSPECTUS' | 'CORRIGENDUM' | 'PRICE_BAND_AD'
  | 'NSE' | 'BSE' | 'CHITTORGARH' | 'MONEYCONTROL' | 'INVESTORGAIN_GMP' | 'REG';
  // DOC is a virtual code — the manifest resolves it to the best available
  // document type per §1.1's "document type order inside rank 1"
  // (PRICE_BAND_AD/CORRIGENDUM > RHP > PROSPECTUS > DRHP for price-dependent
  // fields; PROSPECTUS > CORRIGENDUM > PRICE_BAND_AD > RHP > DRHP for final
  // post-issue facts) — a field's manifest row never repeats that ordering
  // itself.

export type IpoTypeKey = 'MAINBOARD' | 'SME_BSE' | 'SME_NSE' | string;
// MAINBOARD / SME_BSE / SME_NSE are the three the brief for this card named.
// A manifest row MAY add further keys (RIGHTS, OFS, NCD, TENDER, BUYBACK,
// INVITS, REITS, FPO) only where Appendix A names a *different* rank order for
// that offering type — see `na` below for the simpler "does not apply" case,
// which is not a rank override.

export interface FieldManifestEntry {
  /** D | T | X | W | M — see §1.1's six-class table. C and I fields carry no entry (never sourced). */
  class: 'D' | 'T' | 'X' | 'W' | 'M';
  /** Only present for class D. The best document type this field's rank-1 DOC slot resolves to when more than one type is on file. */
  documentType?: 'DRHP' | 'RHP' | 'PROSPECTUS' | 'CORRIGENDUM' | 'PRICE_BAND_AD' | 'RATIOS_BASIS_ISSUE_PRICE';
  /** Pointer into docs/reviews/wp-c-extraction-contract.md's §1 table — which section of that document type carries the field, and how it is read. Free text, not a fetched value. */
  documentSection?: string;
  /** Rank order per IPO type. A key absent here inherits MAINBOARD's order — the loader does NOT silently default to empty. */
  rank: Partial<Record<IpoTypeKey, SourceCode[]>> & { MAINBOARD: SourceCode[] };
  /**
   * Capability — §2.3.5's "can this source serve this field AT ALL", proven
   * by fetching, never a guess. `false` with no `reason` fails validation.
   * The loader's cross-check (below) refuses to start if any `rank[]` array
   * names a source whose capability entry is `false` or absent.
   */
  capability: Record<SourceCode, { capable: boolean; reason: string }>;
  /** Offering types (offeringTypeEnum values) this field does not apply to at all — distinct from a rank override. */
  na?: string[];
  /** rupee | crore | keep — §0.8's four-unit problem; `crore` is the OD-20 default, `keep` is a named O-12 exception. */
  unit: 'rupee' | 'crore' | 'keep';
}

export interface FieldManifest {
  version: 1;
  /** Where this file's initial content was generated from, so a stale copy is traceable. */
  generatedFrom: 'docs/design/field-source-resolution.spec.mjs';
  fields: Record<string, FieldManifestEntry>; // key = "<table>.<column>", e.g. "ipos.issue_size"
}

/**
 * Reads scraper/config/field-manifest.yaml, validates it against
 * scraper/config/field-manifest.schema.json (ajv, draft-07, strict mode),
 * then runs one further cross-check the JSON Schema cannot express: every
 * source named in every `rank[]` array must have a `capability.<source>.capable
 * === true` entry in the SAME row. A schema failure OR a capability
 * cross-check failure throws — this function is called before `main()` at
 * scraper/src/index.ts:1388, so a malformed file exits the process before any
 * scraper runs. There is no fallback default; that is the point (OD-5: no
 * silent code path when configuration is wrong).
 */
export function loadFieldManifest(path?: string): FieldManifest;
```

**Complete worked example — the three named fields, full content, no ellipsis:**

```yaml
# scraper/config/field-manifest.yaml
version: 1
generatedFrom: docs/design/field-source-resolution.spec.mjs
fields:
  "ipos.issue_size":
    class: D
    documentType: PRICE_BAND_AD
    documentSection: >-
      wp-c-extraction-contract.md §A5+A6 — PBA cover + "The Offer", and the
      table "details of the Fresh Issue and post-issue market capitalisation"
    rank:
      MAINBOARD: [DOC, BSE, CHITTORGARH]
      SME_BSE:   [DOC, BSE, CHITTORGARH]
      SME_NSE:   [DOC, BSE, CHITTORGARH]
      # The design does not split this rank between SME_BSE and SME_NSE —
      # Appendix A (field #3, ipos table) gives one order for the whole
      # field and excludes NSE on both SME variants, not only SME_NSE.
    capability:
      DOC:          { capable: true,  reason: "the PBA prints the total offer size at the cap (fresh + OFS)" }
      BSE:          { capable: true,  reason: "BSE detail payload carries a share-count-derived total" }
      CHITTORGARH:  { capable: true,  reason: "CG list API field 'Total Issue Amount (Incl. Firm reservations) (Rs.cr.)' reads the printed total directly, not shares x price (field-priority-matrix.ts:415-421, T-453 comment)" }
      NSE:          { capable: false, reason: "NSE computes (sharesOffered/netOffer) x price, excluding the OFS portion — it cannot print the total (field-priority-matrix.ts:406-412, T-453). The CURRENT field-priority-matrix.ts issueSize entry still lists NSE (rank 4, below CHITTORGARH) — item 3 removes it to match this manifest." }
      MONEYCONTROL: { capable: false, reason: "OD-3 retires Moneycontrol as a scheduled source" }
    na: []
    unit: crore

  "ipo_details.fresh_issue":
    class: D
    documentType: PRICE_BAND_AD
    documentSection: 'wp-c-extraction-contract.md §A — PBA cover + "The Offer"'
    rank:
      MAINBOARD: [DOC, BSE, CHITTORGARH]
      SME_BSE:   [DOC, BSE, CHITTORGARH]
      SME_NSE:   [DOC, BSE, CHITTORGARH]
      # Same "design does not split by exchange" note as ipos.issue_size above.
    capability:
      DOC:          { capable: true,  reason: "the PBA prints the fresh-issue rupee amount separately from the OFS amount" }
      BSE:          { capable: true,  reason: "BSE detail payload carries a fresh-issue figure" }
      CHITTORGARH:  { capable: true,  reason: "CG list API carries the fresh-issue line item" }
      NSE:          { capable: false, reason: "same T-453 reasoning as ipos.issue_size — no printed fresh/OFS split" }
      MONEYCONTROL: { capable: false, reason: "OD-3 retires Moneycontrol as a scheduled source" }
    na: [OFS, TENDER, BUYBACK]
    unit: crore
    # §7.1 item 13 depends on this row: fresh_issue is measured wrong on 6 of
    # 9 live IPOs today (F-51) because nothing gates the write on
    # fresh + OFS = total ±0.5%. That gate is item 13's job, not this
    # manifest's — this row only says who may answer and in what order.

  "financial_statements.revenue":
    class: D
    documentType: RHP
    documentSection: >-
      wp-c-extraction-contract.md §C1-C2 — "Restated Consolidated Statement of
      Profit and Loss" (falls back to "Summary of Financial Information")
    rank:
      MAINBOARD: [DOC, CHITTORGARH, MONEYCONTROL]
      SME_BSE:   [DOC, CHITTORGARH, MONEYCONTROL]
      SME_NSE:   [DOC, CHITTORGARH, MONEYCONTROL]
    capability:
      DOC:          { capable: true,  reason: "the RHP prints the full restated 3-5 year revenue series" }
      CHITTORGARH:  { capable: true,  reason: "CG's 'financialTable' (chittorgarh-detail-fields.ts, getTableById 'financialTable') DOES carry a restated per-fiscal-year revenue/total-income/EBITDA/PAT series — field-source-resolution.spec.mjs:122-124 corrects an earlier draft's wrong claim that no website publishes this" }
      MONEYCONTROL: { capable: true,  reason: "historically ranked rank 3 in field-source-resolution.spec.mjs:130 — SEE CONTRADICTION below" }
      NSE:          { capable: false, reason: "§2.3.5: NSE's API returns bidding and demand data only — no financial fields" }
      BSE:          { capable: false, reason: "no BSE financials endpoint carries a restated series" }
    na: [INVITS, REITS, TENDER, BUYBACK]
    unit: crore
    # OD-20 default is crore; financial_statements today stores whatever unit
    # the SOURCE document printed, tagged per row by its own `unit` column
    # (§0.8) — this manifest's `unit: crore` is the TARGET after build item 11
    # (crore conversion) ships, not what is written before then.
```

**Contradiction found and flagged, not silently resolved (per the task's rule against inventing a
decision):** `financial_statements.revenue`'s rank-3 slot names `MONEYCONTROL`
(`field-source-resolution.spec.mjs:130`, `add('financial_statements', c, 'D', ['DOC','CG','MC'], ...)`
for revenue/total_income/ebitda/pat/fiscal_year), but OD-3 retires Moneycontrol
(*"Retire the Moneycontrol scraper"*, §1.11.1) and §7.1 item 16 stops scheduling it — "keep the
enum value and the provenance rows already written," which is about **historical** rows, not new
ranks. Appendix A was generated before OD-3's retirement swept every rank list, so several D-class
fields (this one included) still name MONEYCONTROL as a live rank-3 source. **The design does not
say** whether every such row should have MONEYCONTROL mechanically dropped, or whether the manifest
should keep it as a documented no-op rank (a source configured but never able to answer, since
nothing schedules it) for the day Moneycontrol might be revived. I marked `capability.MONEYCONTROL.
capable: true` in the worked example above only because `financial_statements.revenue` is one of
the fields Appendix A explicitly lists it for — **this is a fork the owner should resolve as C-1**,
recommendation: drop MONEYCONTROL from every rank list system-wide in the same pass as item 16
(a source nothing schedules ranked third is dead weight, not a safety net), which item 3 (matrix
cleanup) is the natural place to apply once decided.

## Feature flag

`ENABLE_FIELD_MANIFEST`, read in `scraper/src/config/feature-flags.ts` (existing file, pattern
matches `ENABLE_DATA_CONSOLIDATION` at the line documented `PROD-REQUIRED-TRUE`). Default `false`
in every slot until item 3 lands and the matrix reads from the manifest — this item alone only adds
the loader and the file; nothing consumes it yet, so there is nothing to roll back if the flag stays
off. Once item 3 ships, the flag governs whether `getFieldRules()` reads the manifest or the
hard-coded matrix object, and it should flip on in staging first, per the standing staging-before-
prod rule.

## Tests

- **Unit** — `scraper/tests/unit/config/field-manifest-loader.test.ts` (NEW): (1) a well-formed
  fixture YAML loads and returns the typed object; (2) a YAML missing a required schema field
  throws; (3) a YAML whose `rank[]` names a source with `capability.<source>.capable: false` throws
  the cross-check error, not the generic schema error (so the failure message names which field and
  which source); (4) a YAML with valid schema but an unknown class value throws. Tier per
  `.claude/rules/scraper-test-layout.md` — config/loader tests are Tier 1 (pure function, no
  network, no DB).
- **Red before the change:** none of these three files exist yet, so every one of the four tests
  above is red (module not found) before this item lands — that is the correct "red" for a net-new
  loader, not a regression guard on existing behaviour.

## Detection

`No detection change: this item adds a file and a loader that nothing reads yet — item 3 is what
wires the matrix to consume it, and item 3's card carries the detection upgrade (a nightly check
that the manifest and the matrix agree) because that is the point at which disagreement becomes
observable.`

## Staging proof

None required to merge item 2 alone — nothing in the write path calls `loadFieldManifest()` until
item 3 flips `ENABLE_FIELD_MANIFEST`. The proof that belongs here is process-start behavior, not a
staging cycle: deploy to staging with `ENABLE_FIELD_MANIFEST=false` (default) and confirm the
scraper's staging PM2 log (`pm2 logs ipodhan-scraper --lines 20` right after the next scheduled
wake, per `docs/ops/prod-ops-recipes.md`) shows the normal cycle-start line and no new error —
proving the loader import does not throw even when unused. Once item 3 flips the flag, the real
proof (manifest actually governing a write) belongs on item 3's card.

## Rollback

Delete the three new files and the one call site in `scraper/src/index.ts`. Nothing is written to
the database by this item — the manifest is read-only configuration with no consumer yet — so a
revert is a plain `git revert`, no data to undo.

## Tier, budget and cost

**Tier B** — ordinary app code (a config file + a loader), no write-path change yet, no deploy
gate, no auth/payments/migration. `Budget: 30 min wall-clock, 60 tool calls`. One review round
expected (diff-only, per Tier B); the interesting risk is entirely in the YAML content being right,
not in the loader code, so the review should spend its budget re-deriving the three worked rows
from Appendix A rather than re-reading the ajv wiring.

---

### A note on the `C-n` numbering in this card

`C-1`, `C-2` and any other `C-n` in this card are **card-local decisions**: reversible, internal
choices the card author made and recorded so an implementer can see them and disagree. They are NOT
owner forks. Owner forks live in §0.0.2 of `docs/design/data-sourcing-pull-model.md` as `O-nn`, and
this card opened none — an earlier draft numbered these as `O-13` and `O-14`, which collided with the
real owner fork O-13 (the grey-market premium and the market-hours gate).

## Rules implemented

16 rule(s) from `docs/design/rules.json`, generated by
`node docs/design/apply-rule-ownership.mjs --apply` from `rule-ownership.json`.

| Design section | Rule ids |
|---|---|
| §1.1 | R-153, R-154, R-155 |
| §1.11 | R-166 |
| §2.3.5 | R-054, R-055 |
| §5.5 | R-118 |
| §6.6 | R-126, R-127, R-128, R-129, R-130, R-131 |
| §7.6 | R-142, R-143, R-144 |

## Known gaps

- **F-58 (MAJOR) — NSE returns an EMPTY issueInfo block for an SME IPO, so every SME-NSE rank that relies on an NSE LABEL is unproven.** Carried here rather than closed: NSE returns an empty issueInfo for SME, so SME_NSE ranks that rely on an NSE label are unproven; the manifest is where a per-type capability is declared. Not fixed in the design (OD-47); it is this item's to close.

None recorded yet. A finding this item owns but does not close is written here, with its
id and the reason — that is what stops "zero open findings" being reached by dropping one.
