# Item 12 — fold corporate-form words into the name normaliser, and run duplicate detection at discovery

> **Architect correction, 2026-09-10 (binding; this block wins over the text below where they differ).**
> 1. Identity does not live in `scraper/src/services/document-discovery-runner.ts` (it never creates an `ipos` row); the binding site is `packages/shared/src/repositories/ipo-identity.ts`. Slices target that file.
> 2. The existing binding accepts a 0.6 fuzzy-similarity match. The design forbids fuzzy identity (CIN-first; exact normalised name only as a fallback with provenance). The fuzzy accept is removed in this item, with a failing test first, and every row it bound is listed by the audit slice, never silently re-bound.
> 3. "Nothing destructive to roll back" is wrong since #445/#455: `rowKeyForName` output is persisted in three `normalized_name` columns under UNIQUE. Any normaliser change therefore needs a backfill slice: a `repair-*.ts` tool via `openRepairDb`, dry-run default, staging `--apply` only, `assert-repair-held.mjs --cycles 2`, with the UNIQUE pre-check by read-only query against `ipodhan_staging` and `ipodhan` pasted in the PR body.
> 4. Row merges go ONLY through `scraper/scripts/repair-merge-duplicate-ipo.ts` (item 19); no new SQL path.


## Purpose

Two rows can no longer exist for the same IPO past discovery time: the binding normaliser folds
corporate-form words a mainboard IPO carried into production twice (F-55), and a stricter
de-duplication key runs as a standing check every discovery cycle, not only when someone happens to
look. List-source row binding (F-46) also gets a stated rule for what an ambiguous or unbound match
does.

## Serves

Design §2.3.3 ("Binding a list row to an IPO (F-46)"), §2.3.3.1 ("late-binding identity"), design
§7.1 row 12 ("small code, high blast radius: it changes what binds to what"). Findings F-46
(CRITICAL, binding rule unguarded) and F-55 (CRITICAL, ARCIL duplicate, MERGED but "STILL OPEN" per
its own status — the normaliser fix is explicitly what remains). Owner: OD-16 "merge the two rows" /
"Is there a unique ID for each IPO? If yes then there should be only one row" (design §2.3.3.1).

## A finding this session adds, more precise than F-46/F-55's own framing

F-46's detail and F-55's title both say the shipped normaliser "strips Limited/Ltd/Pvt Ltd but not
Company vs Co." I read `packages/shared/src/utils/company-name-normalizer.ts` and ran
`normalizeCompanyNameForMatching` against the exact ARCIL pair in Node this session (not reasoned
from memory):

```
normalizeCompanyNameForMatching("ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED")
  -> "asset reconstruction company india"
normalizeCompanyNameForMatching("Asset Reconstruction Co.(India) Ltd.")
  -> "asset reconstruction co india"
```

**The normaliser already strips `company` and `co` as suffixes** — lines 111–113
(`.replace(/\s+company$/i, '')`, `.replace(/\s+co$/i, '')`, comment citing "P2-2, T-293": *"'Company'
/ a bare 'Co.' are generic-corporate-suffix synonyms for ltd/inc/corp"*. F-46/F-55 are wrong that
the word is simply missing from a list. **The real defect is pipeline order**: the trailing-parens
strip (`\s*\([^)]*\)\s*$`, line ~93) runs once, *before* the legal-suffix chain, and only fires when
a parenthetical already sits at the absolute end of the string. In both ARCIL variants the
parenthetical (`(india)` / `(India)`) sits **between** the corporate-form word and the legal suffix
at that point in the string, so it is not yet the last thing in the string when that rule runs; by
the time `limited`/`ltd` are stripped and the parenthetical becomes trailing, the pipeline has
already moved past the paren-strip step and past the `company`/`co` suffix checks (which look at
the string as it stood *before* the later `.replace(/[()]/g, ' ')` converts parens to spaces, line
~127). So `company`/`co` never sit at the true end when their own regex runs — the fold that exists
does not fire on this shape. **This changes the fix**: adding `Company`/`Co` to the word list would
be a no-op edit (they are already there); the fix must either reorder the pipeline (parens-to-spaces
before the suffix chain) or, more robustly, replace the suffix-anchored chain with a whole-word
strip that does not care about position — which is exactly what the shipped repair tool already
does (see below). **Flagging to the parent orchestrator: F-46 and F-55's stated root cause
("Company/Co missing from the list") should be corrected in the findings register** — I am not
editing `findings.json` myself (out of scope for this card), but the build must not be specified
against the wrong root cause.

## Files

| Path | State | Change |
|---|---|---|
| `packages/shared/src/utils/company-name-normalizer.ts` | exists (271 lines) | `normalizeCompanyNameForMatching` (lines 71–115) and its SQL twin `normalizedCompanyNameSql` (lines 178–271) both need the whole-word fold below, replacing (or running before) the current suffix-anchored `company`/`co`/legal-suffix chain. Both must change together — the file's own header says they "MUST stay in lock-step" and an agreement test enforces it. |
| `packages/shared/src/utils/company-name-normalizer.agreement.test.ts` (NEW) (or wherever that integration test lives — **not located this session; a fork for the implementer to find via the file's own doc comment reference**) | exists, path unverified | Fixture list must gain the ARCIL pair and the InvestorGain-suffix cases below; this is the test that currently passes with the two variants NOT colliding, and must be updated to assert they DO. | (NEW)
| `scripts/lib/repair-invariants/duplicate-ipo-rows.mjs` | exists | **Not changed by this card — read as the reference implementation.** Its `foldName()` (lines ~43–48) already implements the exact word list and whole-word strategy this card specifies; it is a one-off repair-invariant script, not wired into discovery. Item 12 is what promotes this logic (or a shared copy of it) into the live discovery path. |
| `scraper/src/services/document-discovery-runner.ts` | exists | New step: after a candidate IPO row is created/matched at discovery (the design does not name the exact function; **fork** — I did not trace the discovery insert/match call site this session, budget did not extend to it), run the stricter de-duplication key against all LIVE-status rows and raise `AMBIGUOUS`/log a duplicate candidate rather than silently inserting a second row. |
| `scraper/src/scrapers/investorgain-gmp-orchestrator-v2.ts` | exists, cited at lines 331–336 by the design (§2.3.2, F-46) | The row-binding call (`normalizeCompanyNameForMatching` per design's citation) needs the three-outcome contract below (exact-one / `AMBIGUOUS` / `UNBOUND`) plus the open/close-date cross-check (§2.3.3's "one cross-check the binding gets for free"). I did not re-read this file's current binding code this session — **fork**: whether it already has partial ambiguity handling or none is unverified; the design's own text ("nothing yet — F-46") says none exists. |

## Schema

**New table, `field_source_overrides`-adjacent but distinct — the design does not specify one for
duplicate candidates.** Recommendation (mine): a small table or a `documents`-adjacent log is
NOT proposed here because the design gives no shape for it and OD-18 ("no number typed from memory")
extends to "no schema invented where the design is silent" — **fork, escalate to the owner**: does
an `AMBIGUOUS`/`UNBOUND` binding outcome get its own row (auditable, queryable) or only a log line?
The design says (§2.3.3 outcomes table) "record both candidates by name" for `AMBIGUOUS` and "Record
it by name so it is visible" for `UNBOUND`, which reads as a requirement to persist somewhere
queryable, not merely log — but does not name the table. Until the owner picks, this card cannot
specify migration SQL. **No schema change is committed by this card; the schema question is the
fork.**

**Two columns this section's own rules cannot run without, named here because §2.3.3.2 is the
section this item owns (`rule-ownership.json`) and neither exists in the schema today (grepped
this session):**

- **`ipos.company_id`** (R-045) — §2.3.3.2's table: "Same identifier, offering type changes (IPO →
  FPO, IPO → rights) — **new row, linked by `company_id`**." There is no `company_id` column and no
  `companies` table (F-105). This card does not design that table — the design does not specify one
  — but the column this rule reads is `ipos.company_id`, and it is named here so the gap is not
  silently re-lost the next time someone greps for it.
- **`ipos.sebi_observation_date`** (R-170) — §2.3.3.2's lapsed-draft rule: "the lapsed-draft rule
  needs a new field (`ipos.sebi_observation_date`, sourced from SEBI's processing-status page)."
  `date`, nullable — an unknown observation date means not lapsed, never a guess (§2.3.3.2). Until
  this column lands, no row is ever declared lapsed; the rule is written but structurally cannot
  fire (§4.6, owned by item 10, lists it among the rules whose input does not exist yet).

Neither column is added by THIS card's own migration — both are blocked on the same owner fork
above (a `companies` table's shape, and SEBI processing-status ingestion are separate build
decisions this card does not make) — but the columns they need are named here rather than left for
a future reader to discover by grep a second time.

## Interfaces

The binding normaliser's word-fold, matching `scripts/lib/repair-invariants/duplicate-ipo-rows.mjs`
`foldName()` exactly (design §2.3.3, "The de-duplication key, specified"):

```
Lowercase, replace [.,()&'"-] with a space, delete the words below as WHOLE WORDS
(word-boundary, not suffix-anchored), then delete all remaining whitespace:

  private  pvt  limited  ltd  company  co  corporation  corp  incorporated  inc
  and  the  of  india  indian
```

**Why each word is on the list, per the design's own justification (§2.3.3), not invented here:**

- `private`, `pvt`, `limited`, `ltd` — the legal-suffix pair every filing carries; already the
  shipped normaliser's baseline (verified: these already fold correctly today).
- `company`, `co`, `corporation`, `corp`, `incorporated`, `inc` — corporate-form synonyms; already
  *intended* by the shipped normaliser (T-293) but defeated by pipeline order (see finding above).
  This is the direct fix for F-55.
- `and`, `the`, `of` — conjunctions/articles that vary between filings of the same company
  ("X and Y" vs "X & Y" vs "X Y") without changing identity; the design does not give a specific
  example for these three but lists them as part of the shipped key that "found the one duplicate
  group" and "329 production IPOs produce 329 distinct keys: zero false merges" — i.e., measured
  safe, not merely asserted.
- `india`, `indian` — strips the country qualifier ("Asset Reconstruction Co (India)" vs "Asset
  Reconstruction Co"), explicitly named by the design as **deliberately lossy**: "it is deliberately
  lossy — india and industries-style words are dropped — so on its own it would over-merge," which
  is why the design pairs this key with the open-date condition, not with binding.

**Binding vs de-duplication — two different keys, never shared (design §2.3.3, "Why this is a
de-duplication key and not the binding key"):**

```ts
// BINDING (list-source row -> our IPO). Exact match only. Design §2.3.3, numbered list.
function bindListRow(row: { symbol?: string; isin?: string; companyName: string },
                      candidates: Ipo[]): BindOutcome
// BindOutcome = { kind: 'BOUND'; ipoId: string }
//             | { kind: 'AMBIGUOUS'; candidateNames: string[] }
//             | { kind: 'UNBOUND' }
// Priority: symbol exact -> isin exact -> normalizeCompanyNameForMatching(companyName) exact.
// Never substring, edit-distance, or "closest" (design: "not fuzzy matching").

// DE-DUPLICATION (discovery-time check across existing IPO rows). Looser key, opposite bias.
function findDuplicateCandidates(companyName: string, openDate: string | null,
                                  liveIpos: Ipo[]): Ipo[]
// Uses foldName() + openDate equality (both required). Never merges — only flags for review.
```

**Outcomes table (design §2.3.3, verbatim obligations):**

| Result | What happens |
|---|---|
| Binding: exactly one IPO matches | bind, continue |
| Binding: more than one matches | `AMBIGUOUS` — bind nothing, write no value, record both candidates by name |
| Binding: no IPO matches | `UNBOUND` — not an error; the discovery signal for a new IPO; record by name |
| Binding: row's own open/close date disagrees with the bound IPO's | binding is suspect — record it, write nothing (the free cross-check, §2.3.3) |
| De-dup: fold+open-date collision on ≥2 live rows | flag for review — **never auto-merge**; design: "nothing in the loop merges rows" |

**Late-binding identity (§2.3.3.1), what discovery does on a stronger-identifier arrival:**

1. Create on best identity available at discovery time (the folded name).
2. Every time a stronger identifier (symbol, ISIN, CIN) arrives for a row, check it against every
   other row holding that identifier type.
3. A converging identifier (two rows sharing one symbol/CIN/ISIN) is a merge, not an alert — "keeps
   the union of populated fields, and preserves the provenance of both."
4. CIN + open date is usable earlier than symbol/ISIN (present on 8 of 13 upcoming IPOs per the
   design's own measurement, cited from §2.3.3.1's table — not re-measured this session).

**The merge mechanism itself is out of scope for item 12.** The design's own closed-in note on F-55
says the ARCIL merge ran via `scraper/scripts/repair-merge-duplicate-ipo.ts`, "owner-authorised," "dry run,"
"backup," "refusal on any disagreeing strong identifier" — item 12 is detection (flagging), not
the merge tool; §2.3.3.1's automatic-merge-on-converging-identifier behavior is **not scoped by
this card** — the design describes it as a rule the loop should follow but item 12's own listed
scope ("F-46, F-55" per §7.1) is the normaliser fix and discovery-time flagging. **Fork for the
orchestrator**: does automatic merge-on-convergence belong to item 12 or a separate item? The
sequence table does not list it separately; I am flagging rather than silently absorbing it.

## Feature flag

The design does not name one. **Recommendation (mine):** none needed for the normaliser fix itself
(it only makes matching *more* correct — a false-negative-safe change per the design's own "329
distinct keys, zero false merges" measurement) — but the discovery-time duplicate-flagging step
should sit behind `ENABLE_DISCOVERY_DUPLICATE_CHECK` in `feature-flags.ts` (pattern at line 67) so
it can be disabled without a deploy if it produces noise. Default `true` in local, `true` in staging
first, prod after a staging soak (per `defect-fix-contract.md` proof requirement).

## Tests

- **Unit, extend the normaliser's own test suite** (path not located this session — fork for
  implementer): add the ARCIL pair as a case that MUST now collide (currently does not — verified
  live this session via `node`, both directions traced above). Red before the change: confirmed by
  direct execution, not assumed.
- **Unit, `company-name-normalizer.ts` regression list**: every existing passing case in that file's
  test suite must still pass — the design's own measurement ("329 production IPOs produce 329
  distinct keys: zero false merges" for the *de-dup* key) is the safety bar; the *binding* key
  changing to whole-word matching needs the same zero-false-merge proof run against production
  company names, which I have not run this session (would need DB access).
- **Unit, discovery duplicate check**: feed two rows with the ARCIL fold + same open date -> expect
  a flagged candidate, not a silent pass and not an auto-merge.
- **Unit, binding outcomes**: three cases (exact-one, two-candidates, zero-candidates) against the
  `bindListRow` contract above, plus one case where dates disagree on an otherwise-clean bind.
- Tier per `.claude/rules/scraper-test-layout.md`: unit (`scraper/tests/unit/` for discovery/binding
  logic; `packages/shared` has its own test runner — location not verified this session for the
  normaliser's existing suite).

## Detection

New check, `docs/reviews/detection-checks/duplicate-ipo-at-discovery.json` (NEW) (or promote
`scripts/lib/repair-invariants/duplicate-ipo-rows.mjs`'s `foldName` logic into a nightly audit
entry) — asserts zero live-status rows share a fold+open-date key, run nightly, reported by IPO name
per `signal-ownership.md` R1 ("a number is not a reading"). This satisfies
`.claude/rules/recurrence-detection-gate.md` (item 12 touches
`scraper/src/scrapers/investorgain-gmp-orchestrator-v2.ts` and `document-discovery-runner.ts`, both
under the gate's paths). **Not "No detection change"** — a detection upgrade is required and named
here: check id `DUPLICATE-DISCOVERY`, asserting the same invariant `duplicate-ipo-rows.mjs` already
proves post-repair, but running every cycle rather than only under `assert-repair-held.mjs`.

## Staging proof

Run `scripts/lib/repair-invariants/duplicate-ipo-rows.mjs`'s logic (or the promoted discovery-time
check) against staging before and after the normaliser change; healthy value before is **12 groups**
(design §2.3.3: "Run on staging it reports 12 groups, all of a different defect (F-57, slug-suffix
rows)" — a number the design states, not one I re-measured this session). After the fix, the new
binding normaliser must not introduce new false collisions among those 329 (or current count)
production names — the exact assertion the design already ran for the *de-dup* key
("329 distinct keys: zero false merges") must be re-run for the *binding* key once it changes.
`node scripts/assert-repair-held.mjs duplicate-ipo-rows.mjs --cycles 2` per
`defect-fix-contract.md` item 5, since this touches a live write/matching path, not just a repair.

## Rollback

Reversible with effort (design §7.2 lists item 12 under "Reversible with effort" alongside 4, 5, 6,
7, 8, 13, 14: "field_sources records the previous value and source for every field, so a bad batch
can be rolled back per field"). Revert the commit to restore the old (weaker) normaliser; no rows
are merged or deleted by item 12 itself (merging is explicitly out of scope, per Interfaces above) —
only flags are raised, so rollback has nothing destructive to undo.

## Tier, budget and cost

**Tier A** (per the task brief and design §7.1: "small code, high blast radius: it changes what
binds to what" — this is a write-path identity change, matching the review-tier rule's "auth/
payments/secrets/DB migrations" class by analogy: a wrong bind here writes one company's data onto
another's row). `Budget: 30 min wall-clock, 60 tool calls` for implementation; reviewer gets the
full Tier A adversarial pass with mutation tests on the fold function (per
`.claude/rules/engineering-roles.md` Tier A definition) given the ARCIL incident's blast radius.

## Rules implemented

<!-- generated by docs/design/apply-rule-ownership.mjs - edits inside this block are overwritten -->

22 rule(s) from `docs/design/rules.json`, generated by
`node docs/design/apply-rule-ownership.mjs --apply` from `rule-ownership.json`.

| Design section | Rule ids |
|---|---|
| §2.3.1 | R-030, R-031 |
| §2.3.3 | R-032, R-033, R-034, R-035, R-036, R-038, R-039, R-167 |
| §2.3.3.1 | R-177, R-178 |
| §2.3.3.2 | R-041, R-042, R-043, R-044, R-045, R-046, R-047, R-048, R-170 |
| §2.3.4 | R-053 |

## Known gaps

None recorded yet. A finding this item owns but does not close is written here, with its
id and the reason — that is what stops "zero open findings" being reached by dropping one.
