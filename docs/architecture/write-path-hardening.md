# Write-Path Hardening — architecture assessment and migration plan

**Task:** T-298 (owner architect mandate, 2026-08-23)
**Role:** Systems Architect
**Status:** Assessment + plan. No code changes in this PR. Implementation happens in follow-up phase contracts.
**Scope:** Why data defects kept recurring across five review rounds (T-250…T-295), what in the architecture causes it, and the minimum change that stops it.

---

## 0. Executive summary (plain English)

**What is wrong.** IPODhan has good data rules — price bands must be sane, one company must be one row, an admin's manual edit must never be overwritten, every value must record where it came from. Those rules are real and they are written down in code. The problem is **where** they are written down: they live inside one 1,224-line function (`upsertIPO`) and inside its *caller* (`BaseScraperOrchestrator`), while **37 other files write to the same table directly and obey none of them.**

So the rules are not rules. They are a convention that one path happens to follow.

**Why the same bugs kept coming back.** Every review round found a defect, and every fix added one more `if` statement inside that one function. The fix was always correct and always narrow. The next new write path — a repair script, a backfill, an admin API — never got the `if`. Round 5 finds the same class of bug that round 2 fixed, wearing new clothes.

The clearest proof is a bug that is **live right now.** Three hours before this review, T-293 shipped an improvement: `upsertIPO` gained a third way of recognising "is this company already in the database?" (a typo-tolerant match). The *protection check* that runs just before the write — in a different file — was not updated. It still uses only two ways. So today, if a scraper reports a company name with a typo, the protection check says "I don't know this company, nothing to protect" and lets the write through unfiltered, while the write itself recognises the company and overwrites it — including fields an admin manually locked. **This is the exact bug T-287F3 fixed 24 hours earlier.** It reopened in one day, because the thing holding it shut was a code comment asking a future developer to remember, not a structure that made forgetting impossible.

**What we change.** Four things, no rewrite, no new services:

1. **One door.** Every write to `ipos` goes through one function that enforces identity, protection, sanity and provenance. Scripts included. Direct `db.update(ipos)` becomes a lint error.
2. **A lock on the door frame.** The database itself gets `CHECK` and `UNIQUE` constraints for the hard rules. Today the schema has **zero** `CHECK` constraints and no uniqueness on `isin` or `symbol`. With them, even a rogue script physically cannot write a backwards price band or a duplicate ISIN.
3. **Honest switches.** Retire the percentage-rollout flags. One of them (`CONSOLIDATION_PERCENTAGE`) silently disabled the entire multi-source merge engine for the product's whole life while the logs cheerfully reported success. Flags become plain on/off booleans that fail loudly when misconfigured.
4. **Tests that check the gate is open, not just that the gate works.** Today every consolidation test stubs the gate to `() => true`. That is why nobody noticed the real gate was shut.

**Why this stops the recurrence.** Right now, adding a new write path costs nothing and silently skips every rule. After this, adding a new write path that skips the rules is a *build failure* (lint), a *test failure* (gate-liveness), or a *database error* (constraint). The rule stops depending on whoever writes the next script remembering seven prior review rounds.

**Cost.** Five phases, each independently shippable and reversible. Phases 1–2 are the ones that actually stop the bleeding; 3–5 are cleanup. Honest estimate below.

---

## 1. Assessment

### 1.1 The write-path inventory

Method: `git grep -nE '\.(insert|update)\((schema\.)?ipos\)' -- '*.ts'`, tests excluded. Full output archived at `evidence/2026-08-23-T-298/ipos-write-sites.txt`.

**46 write statements across 37 distinct non-test files** target the `ipos` table.

| Location | Files | What they are |
|---|---|---|
| `scraper/scripts/` | 14 | one-off backfills, repairs, merges (T-276/T-277/T-278F/T-287/T-292 remediation scripts) |
| `web/scripts/` | 10 | fixes, reclassification, slug regeneration, seeding |
| `web/app/api/admin/` | 4 | update-field, protection, conflicts/resolve, drhp/extract |
| `web/lib/services/` | 2 | `status-updater-service.ts`, `conflict-resolution.ts` |
| `scraper/src/services/` | 2 | `exchange-monitor.ts`, `sebi-monitor.ts` |
| `web/lib/scrapers/sources/` | 1 | `historical-ipo-scraper.ts` |
| `scraper/src/scripts/` | 1 | `scrape-coolcaps.ts` |
| `packages/shared/src/repositories/` | 1 | `ipo-repository.ts` — the intended chokepoint |
| `web/lib/repositories/` | 1 | `ipo-repository.ts` — **a second, divergent copy** |
| `packages/shared/src/admin/` | 1 | `field-protection-checker.ts` |

Two observations before the invariant analysis:

- **There are two `IPORepository` implementations**, not one. `packages/shared/src/repositories/ipo-repository.ts` (905 lines) and `web/lib/repositories/ipo-repository.ts` (1,846 lines). 35 files in `web/` import the web copy. The "repository chokepoint" the project documents is itself duplicated, so "go through the repository" does not identify a single place.
- **The invariant helpers live in the wrong package.** `sanitizeIpoWriteFields` and `sanitizeCompanyName` are in `scraper/src/utils/validators.ts` (`scraper` workspace). The dependency rule is shared → consumers, so **`web/` physically cannot import them.** A third of all write paths are in `web/` and are structurally unable to reach the sanitizers. This is not carelessness; it is a package-layout consequence.

### 1.2 Invariants — who enforces what

Five invariants matter for data correctness. Here is where each is enforced.

| Invariant | Enforced in | Enforced by DB | Skipped by |
|---|---|---|---|
| **Canonical identity / dedup** (one company = one row) | `data-persister.ts:219–247` (3 tiers: normalized-name → slug → fuzzy) | `slug` UNIQUE only. **`isin` and `symbol` are plain indexes, not unique** (`schema.ts:142,143,210,211`) | all 35 non-repository write paths; and the two *other* copies of the lookup (§1.4) |
| **Field protection / IPO lock** (admin edits stick) | `BaseScraperOrchestrator.ts:385,402` — **the caller, not the write** | no | **`upsertIPO` itself** — `grep -cE 'isIPOLocked|filterProtectedFields|isFieldProtected|fieldProtectionService' data-persister.ts` = **0** (vs **5** in `BaseScraperOrchestrator.ts`). Every script that calls `upsertIPO` directly believes it is protected and is not. |
| **Band / value sanity** (min ≤ max, no `0` issue size, no `lot_size = 1`) | `data-persister.ts:307–320` (create) and `sanitizeIpoWriteFields` (update) — two different implementations | **zero `CHECK` constraints in the entire 1,375-line schema** (`grep -c 'check(' = 0`) | all 35 non-repository paths |
| **Lineage / provenance** (`field_sources`) | `data-persister.ts:587` (create, added T-292 P3-11) and `:480` (update) | no | all 35; and gated on `ENABLE_SOURCE_TRACKING` |
| **Offering-type / segment consistency** (an SME board has no FPO; a takeover is not an IPO) | `data-persister.ts:356`, `:458`, `:554` — **three separate copies of the same guard** in one function | no | all 35 |

Read the right-hand column: **for four of five invariants, the enforcement point is one function, and 35 of 37 write paths do not call it.**

### 1.3 H1 — no single write gateway: **CONFIRMED**

The hypothesis is confirmed, with one honest correction and one aggravation.

**Confirmed.** `upsertIPO` (`scraper/src/services/data-persister.ts:199`) is documented in `.claude/rules/scraper-write-path.md` as the "single write entry point" that applies "IPO-level lock check, field-level protection filtering, validation pipeline, consolidation."

It does not apply the first two. `data-persister.ts` contains **zero** references to any protection API:

```
PROT='isIPOLocked|filterProtectedFields|isFieldProtected|fieldProtectionService'

$ grep -cE "$PROT" scraper/src/services/data-persister.ts
0
$ grep -cE "$PROT" scraper/src/base/BaseScraperOrchestrator.ts
5
```

(A naive `grep -i 'protect\|lock'` on `data-persister.ts` returns 10 hits — all substring noise: `blocks`, `lock-step`, `block`, and `lockIn50PercentDate`, the anchor-investor lock-in date field, an unrelated domain concept. Use the API-name grep above to reproduce.)

The IPO-lock check and `filterProtectedFields` call live in `scraper/src/base/BaseScraperOrchestrator.ts:385` and `:402` — the *caller*. The documented gateway does not gate.

The practical consequence: these scripts and jobs call `upsertIPO` directly, several of them announcing in their own header comments that they route "via upsertIPO (write-path SSOT)" for safety —

`scraper/scripts/backfill-bse-historical.ts:179`, `scraper/src/scripts/backfill-description-sector.ts:129`, `scraper/src/scripts/backfill-stuck-listing.ts:127`, `scraper/src/scripts/ingest-historical-ipo.ts:115`, `scraper/src/scripts/force-nse-scrape.ts:99`, `scraper/src/scripts/test-nse-transform.ts:55`, plus (per the T-283 audit) `backfill-demand-graph.ts`, `backfill-subscription.ts`, `anchor-investors-job.ts`, `financial-data-job.ts`, `ipo-reviews-job.ts`, `objectives-job.ts`, `peer-companies-job.ts`.

**Every one of them bypasses field protection and the IPO lock, while believing it does not.** That belief is written in their comments. That is the most dangerous kind of architectural failure: the documentation and the developer's mental model are both wrong in the same direction.

**Honest correction.** The five non-`-v2` orchestrators (`nse-scraper-orchestrator.ts`, `bse-scraper-orchestrator.ts`, `chittorgarh-orchestrator.ts`, `moneycontrol-orchestrator.ts`, `ipo-alerts-fallback-orchestrator.ts`) also call `upsertIPO` directly and are not classes at all — they never touch `BaseScraperOrchestrator`. But `scraper/src/index.ts:12–18` imports only the `-v2` versions. **They are dead code, not live bypasses.** They are still a landmine: they look like production orchestrators, they are one import line away from being live, and they are the version a future developer is as likely to copy as the `-v2` one. Reported as dead-but-loaded, not as an active leak.

**Aggravation.** Even the protected path is only protected by a promise (§1.4).

### 1.4 The live regression that proves the thesis

`BaseScraperOrchestrator.ts:365–381` carries a 14-line comment explaining T-287F3: the protection lookup and the write lookup must resolve a row the *same* way, or the guard checks a row the write does not touch. The fix was to hand-copy the write path's two-tier lookup into the guard:

```
BaseScraperOrchestrator.ts:380              findByNormalizedName(...) ?? findBySlug(...)
data-persister.ts:219,223                   findByNormalizedName(...) → findBySlug(...)
data-consolidation-orchestrator.ts:128,131  findByNormalizedName(...) → findBySlug(...)
```

Three hand-maintained copies of "which row is this?", kept in sync by a comment.

On 2026-08-23 at 19:45 IST, commit `9955dbd3` (T-293, PR #183) added a **third** tier to one of them:

```
data-persister.ts:241   fuzzyMatch = await ipoRepository.findByFuzzyName(normalizedName)
```

`grep findByFuzzyName scraper/src/base/BaseScraperOrchestrator.ts` → **no match.** Same for `data-consolidation-orchestrator.ts`.

**The T-287F3 divergence is reopened and shipping.** Concrete failure: an admin locks the price band on "Dhanwel Hybrid Seeds Ltd." A scraper reports "Dhanwel Hybird Seeds Limited" (typo). The guard's two tiers both miss → `ipoId` is `undefined` → IPO-lock check and `filterProtectedFields` are skipped entirely → `upsertIPO`'s third tier finds the row → the locked price band is overwritten. No error, no warning; T-293's dedup fix *widened* the hole it was fixing on the other side.

Time from fix to recurrence: **under 24 hours.** Not a discipline failure — the T-293 worker had no way to know a second and third copy existed. This is the architecture generating the defect.

### 1.5 H2 — silent-default config flags as behaviour switches: **CONFIRMED**

`data-consolidation-service.ts:205–210`:

```ts
if (!FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION ||
    !shouldUseFeature('CONSOLIDATION_PERCENTAGE', input.ipoId)) {
  return this.fallbackConsolidation(input, startTime);
}
```

`CONSOLIDATION_PERCENTAGE` defaults to `'0'` (`feature-flags.ts:150`) and, per the T-283 audit (`evidence/2026-08-23-T-283/60-inert-fix-audit.md`), **was never set in any prod or staging environment on either Windows or Linux.** Only `ENABLE_DATA_CONSOLIDATION=true` was set — a *different* flag. So for the product's entire life, every consolidation call fell to `fallbackConsolidation`.

What `fallbackConsolidation` does (`data-consolidation-service.ts`): takes every incoming field verbatim, marks `hadConflict: false` on all of them, returns `conflictsDetected: 0` and `fieldsUpdated: N`. **The field-priority matrix — the whole multi-source arbitration design, 60+ field rules — never ran.** Any source could overwrite any field.

Three things make this a *design* fault, not a config typo:

1. **The observability lied.** `data-persister.ts:496` logs `'[DataConsolidation] Updated IPO with consolidated data'` with `fieldsUpdated: N`. Real consolidation and the accept-everything fallback produce byte-identical happy-path logs. The only distinguishing signal is `conflictsDetected: 0` — which is also what a genuinely clean cycle looks like.
2. **The detector existed and was dead.** `validateFeatureFlags()` contained the exact correct warning (`feature-flags.ts:288`) but was called from nowhere in the scraper. T-283 wired it into `index.ts`.
3. **It generated three prior tasks.** T-276, T-280 and T-282 each investigated "the price-band guard is dead code / never fires." All three were this one switch wearing a different costume. Three tasks' worth of work chasing a symptom.

Residual: `SOURCE_TRACKING_PERCENTAGE` and `CONFLICT_DETECTION_PERCENTAGE` are still defined, still default `0`, still documented as `100` in `.env.example`, and are read by nothing. Dead config that reads as live config.

Also note `validateFeatureFlags` uses `console.warn`, which violates the project's own `structured-logging.md` (pino only in `scraper/src/**`) — the warning is not queryable in production JSON logs.

### 1.6 H3 — tests mock the gates: **CONFIRMED**

`scraper/tests/unit/services/data-consolidation-service.test.ts:19–40`:

```ts
vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: { ENABLE_DATA_CONSOLIDATION: true, CONSOLIDATION_PERCENTAGE: 100, ... },
  shouldUseFeature: () => true,
  validateFeatureFlags: vi.fn(),
}));
```

`shouldUseFeature: () => true` **is the gate.** Stubbing it open means the suite cannot, even in principle, observe the production state in which the gate was shut. Same pattern in `price-band-consolidation.test.ts:26` and `data-persister-create-lineage.test.ts:36`.

The tests were not wrong about the merge logic — they proved the merge logic is correct. They asserted the *engine* works. Nothing asserted the *ignition* was connected. In production, it was not, for the entire product lifetime.

`validateFeatureFlags: vi.fn()` in the same mock is a second instance: the very function whose deadness caused the outage is stubbed to a no-op in the test that would have exercised it.

The counter-pattern already exists in the repo: `#181` / `scripts/audit-ipo-coverage.mjs` gates on a real invariant against the real production database (segment=SME AND offering_type=FPO must be zero rows). That is the shape to generalise.

### 1.7 Defect classes → architectural cause

| Defect class (task) | Symptom | Architectural cause |
|---|---|---|
| Guard/write identity mismatch (T-287F3, T-276; **reopened by T-293**) | protection silently skipped while write proceeds | identity resolution hand-copied into 3 files, no single function; no unique key on `isin`/`symbol` |
| Degenerate price band survives (T-276, T-280, T-281, T-282) | `285–300` collapses to `300/300` | guard read `field_sources` only; "untracked" read as "no value". No DB `CHECK (min <= max)` to catch it regardless of path |
| Consolidation inert for product lifetime (T-283) | priority matrix never ran; 3 tasks wasted on symptoms | two-flag design with silent `0` default; dead validator; logs indistinguishable from success |
| Repair bypasses protection (T-287C2) | repair script overwrites protected fields | repair scripts write with raw `db.update(ipos)`; nothing stops them |
| Lineage on update but not insert (T-292 P3-11) | new rows had zero provenance | lineage is an inline block in one branch of one function, not a property of writing |
| Silent `rowCount` (T-287F) | "8/8 written", 5 landed | no shared write helper; every script hand-rolls its result handling |
| Repair recorrupted next cycle (T-281) | 89 rows re-collapsed in 30 min | repair path and scraper path enforce different rules, so they fight |
| Duplicate rows (T-274, T-277, T-293) | two rows, one company | `isin`/`symbol` not unique in DB; dedup is app-level only, on one path |
| Invisible SME/FPO rows (T-292, #180) | SME row typed FPO renders nowhere | no `CHECK` on the segment/offering-type pair |
| Corporate actions polluting IPO lists | takeovers listed as IPOs | classification guard is an inline `if` in `upsertIPO`, absent from 35 other paths |

**Every row has the same shape:** a correct rule, implemented in one place, on one path, defended by a comment.

### 1.8 What is GOOD and must not change

This is not a bad codebase. The following are genuinely strong and the plan below deliberately preserves all of them:

- **The field-priority matrix** (`scraper/src/config/field-priority-matrix.ts`, 60+ fields with per-field source order, normalization, confidence thresholds, time-based rules). This is a real, well-designed multi-source arbitration model. Its problem was never its design — it was that a flag stopped it running.
- **`BaseScraperOrchestrator`'s template-method `run()`** — lock → filter → validate → consolidate → persist is exactly the right shape. The fix is to make more paths go through it, not to change it.
- **The pure sanitizer/validator functions** (`sanitizeIpoWriteFields`, `sanitizeCompanyName`, `sanitizeIpoDates`, `validateLotSize`, `guardSmeOfferingTypeAgainstFpo`, `resolveOfferingTypeKeepingClassification`). Pure, unit-testable, individually correct. They are the raw material for the gateway — they need relocating and calling from one place, not rewriting.
- **The production verification layer** — `scripts/audit-prod.mjs` (read-only, exit-1 on failure, checks mapped to issue numbers) plus the `prod-verify.yml` browser sweep. This is better than most projects have, and `#181` shows it evolving in the right direction (gating on invariants, not shapes).
- **Migration discipline** — `_gated/` (destructive DDL, owner sign-off) and `_repair/` (idempotent drift repair), plus `assert-migrations-applied.sh` failing the deploy on journal drift. The plan's DB constraints ride this existing rail.
- **Operational hygiene** — structured pino logging, non-fatal side-effect isolation, Redis fail-open, the distributed lock, the PM2 scheduled-one-shot pattern.
- **The fleet review process itself.** Five rounds of independent checkers with archived evidence is why this analysis is possible at all. The defect corpus is an asset. The process is working; it is finding real bugs. It is just finding the *same* bug repeatedly because the architecture keeps re-issuing it.

---

## 2. Target architecture

Principle: **harden what exists.** No rewrite, no new services, no new abstractions beyond one module. The goal is to move each invariant from "a place someone must remember to call" to "a place that cannot be bypassed."

Three enforcement layers, weakest to strongest:

```
Layer 3 (lint)      →  you cannot WRITE code that bypasses the gateway
Layer 2 (gateway)   →  all application writes enforce all invariants, once
Layer 1 (database)  →  even a rogue path physically cannot violate a hard rule
```

### (a) ONE write gateway

**New module:** `packages/shared/src/db/ipo-write-gateway.ts`.

`packages/shared` is the only package both `web/` and `scraper/` can import. This is the fix for §1.1's package-layout problem — the sanitizers move here (from `scraper/src/utils/validators.ts`) so `web/`'s 18 write paths can finally reach them. `scraper` keeps re-exporting from its current path so nothing breaks.

```ts
export type WriteIntent = 'SCRAPE' | 'ADMIN' | 'REPAIR' | 'BACKFILL' | 'MIGRATION';

export interface IpoWriteRequest {
  identity: IpoIdentity;        // never a raw id + name blob
  data:     Partial<IPOInsert>;
  source:   ScraperSource | 'ADMIN';
  intent:   WriteIntent;
  actor:    string;             // scraper name, admin name, or script name
  reason?:  string;             // required when intent === 'REPAIR'
}

export async function writeIpo(req: IpoWriteRequest): Promise<IpoWriteResult>;
```

The gateway runs, in fixed order, for **every** caller:

1. **Resolve identity** — via ONE exported function `resolveIpoRow(identity, mode)`. `mode: 'fill'` allows the fuzzy tier; `mode: 'overwrite'` requires a strict tier (the T-276 lesson). `BaseScraperOrchestrator` and `data-consolidation-orchestrator` are refactored to call *this* function instead of hand-copying the tiers. **This alone closes §1.4 permanently and makes it structurally impossible to reopen** — there is nothing left to copy out of sync.
2. **Protection** — IPO lock, then `filterProtectedFields`, using the row resolved in step 1. Guard and write can no longer disagree because there is one resolution. `intent: 'ADMIN'` bypasses (that is the point of admin); `intent: 'REPAIR'` bypasses only with an explicit `allowProtectedOverwrite: true` plus a `reason`, and always logs.
3. **Sanitize** — one call to `sanitizeIpoWriteFields`, applied on both create and update (today they run different code). Absorbs `sanitizeIpoDates`, `coercePositiveOrNull`, `validateLotSize`, `sanitizeCompanyName`, `sanitizeRegistrar`.
4. **Consistency guards** — `guardSmeOfferingTypeAgainstFpo` and `resolveOfferingTypeKeepingClassification`, once, replacing today's three inline copies.
5. **Consolidate** — for `intent: 'SCRAPE'` on an existing row, through the priority matrix. Unchanged logic.
6. **Persist** — repository write, `rowCount` checked, `rowCount < 1` returned as an error (the T-287F lesson).
7. **Lineage** — `field_sources` written on create *and* update, from the same code, for every intent.

**Deliberate deviation from the contract's expected shape:** the contract says "one write gateway (repository/persister chokepoint)". I am proposing the gateway sit *above* the repository, not be the repository. Reason: there are two divergent `IPORepository` implementations (§1.1) and merging them is a large, risky, low-value refactor that would have to land before anything else could. A gateway module above both is smaller, ships sooner, and lets repository consolidation happen later as independent cleanup. The gateway calls the shared repository; the web repository keeps its read paths and loses its three write methods.

**Explicit non-goal:** the gateway is for `ipos`. Child tables (`subscriptions`, `gmp_records`, `documents`, `financial_data`) keep their current write paths in this plan. Extending the pattern to them is a later decision, taken only if the same defect classes appear there. (YAGNI — do not build five gateways because one was needed.)

### (b) Database-level constraints

Zero `CHECK` constraints exist today. Add the hard invariants where nothing can route around them. These are the rules that are *always* true, independent of source, intent or code path.

| Constraint | Rule | Catches |
|---|---|---|
| `ipos_price_band_ordered` | `CHECK (price_range_min IS NULL OR price_range_max IS NULL OR price_range_min <= price_range_max)` | inverted bands from any path |
| `ipos_issue_size_positive` | `CHECK (issue_size IS NULL OR issue_size > 0)` | the `0`-means-unknown class |
| `ipos_lot_size_sane` | `CHECK (lot_size IS NULL OR lot_size > 1)` | the `lot_size = 1` class |
| `ipos_sme_not_fpo` | `CHECK (NOT (segment = 'SME' AND offering_type = 'FPO'))` | #180/#181 invisible-SME, enforced at write not just audit |
| `ipos_isin_unique` | `UNIQUE (isin) WHERE isin IS NOT NULL` | duplicate rows by hard identity |
| `ipos_symbol_unique` | `UNIQUE (symbol) WHERE symbol IS NOT NULL` | same, for listed rows |
| `ipos_sector_not_blank` | `CHECK (sector IS NULL OR length(trim(sector)) > 0)` | the `''`-sector class that defeats NULL-based backfills |

Deliberately **not** constrained: date ordering (`open ≤ close ≤ allotment ≤ listing`). Real sources legitimately publish partial and revised date sets mid-lifecycle; a hard constraint would reject good scrapes. Date coherence stays an application guard with a logged warning, as today.

Two prerequisites, both non-negotiable:

- **Audit before adding.** Each constraint gets a `SELECT count(*)` against production first. Existing violating rows must be repaired (or the constraint's predicate narrowed) *before* the DDL, or the deploy fails. `NOT VALID` → repair → `VALIDATE CONSTRAINT` is the safe sequence.
- **Route through `_gated/`.** These are destructive-class DDL per `drizzle-migration-gated-ddl.md`: owner sign-off, manual apply in order, read-back verify.

Expected effect: a constraint violation surfaces as a loud `23514`/`23505` error in the scraper log with the offending row, instead of silent corruption discovered by an audit three weeks later.

### (c) Flag-system simplification

Retire percentage rollout. It has produced exactly one outcome in this codebase — a silent full-disable — and zero gradual rollouts.

| Flag | Fate | Why |
|---|---|---|
| `CONSOLIDATION_PERCENTAGE` | **DELETE**; gate on `ENABLE_DATA_CONSOLIDATION` only | caused the lifetime outage (T-283); now `100`, so deletion is behaviour-neutral |
| `SOURCE_TRACKING_PERCENTAGE` | **DELETE** | read by nothing; documented as `100` in `.env.example`; pure decoy |
| `CONFLICT_DETECTION_PERCENTAGE` | **DELETE** | same |
| `ENABLE_DATA_CONSOLIDATION` | **KEEP**, promote to fail-loud required | core behaviour switch |
| `ENABLE_SOURCE_TRACKING` | **KEEP**, fail-loud required | hard prerequisite of conflict detection |
| `ENABLE_CONFLICT_DETECTION` | **KEEP**, fail-loud required | |
| `ENABLE_GMP_NAME_MATCH`, `ENABLE_MONEYCONTROL_SUBSCRIPTION`, `ENABLE_BSE_API`, `ENABLE_PRIMARY_SOURCE_DISCOVERY` | **KEEP** as-is | live capability flags, set `true` in `ecosystem.config.js`, working as designed |
| `ENABLE_GMP_SCHEDULED_JOB`, `ENABLE_STAGE_RECONCILER` | **KEEP** as-is | §GATE owner-activation flags per `owner-gated-feature-flags.md`; that convention is sound and stays |
| `ENABLE_DRHP_EXTRACTION`, `ENABLE_EARLY_DETECTION`, `SHADOW_MODE`, `DEBUG_DATA_FLOW`, `MAX_CONFLICTS_PER_IPO`, `SOURCE_TRACKING_BATCH_SIZE`, `ENABLED_SCRAPERS`, `ENABLED_IPO_IDS` | **AUDIT then keep-or-delete** in Phase 5 | each needs a live/dead call-site check; the T-283 lesson is that a defined-but-unread flag is worse than no flag |

Two structural rules to prevent recurrence:

1. **Two tiers only.** `REQUIRED_FLAGS` — absent or unparseable ⇒ `validateFeatureFlags()` **throws at startup**, process refuses to run. `OPTIONAL_FLAGS` — default documented, absent is fine. No flag may be silently-defaulting *and* behaviour-critical. That combination is what T-283 was.
2. **`validateFeatureFlags()` + `logFeatureFlags()` are called at every entrypoint.** Already wired into `index.ts` by T-283; add `scheduler/index.ts` and any future entrypoint, with a unit test asserting the call exists. Route through pino, not `console.warn` (`structured-logging.md`).

### (d) Test-architecture rule: gate-liveness tests are unmocked

New rule file `.claude/rules/gate-liveness-tests.md`:

> Every gate that can disable a data-correctness behaviour MUST have at least one test that exercises it **unmocked**. A test that stubs the gate (`shouldUseFeature: () => true`, `FEATURE_FLAGS: {...literal}`, `validateFeatureFlags: vi.fn()`) proves the guarded logic is correct; it does not prove the guard is open. Both are required, and they are different tests.

Three concrete test classes:

1. **Config-contract test** (unit, no DB). Imports the *real* `feature-flags.ts` with `process.env` set to the production values from `ecosystem.config.js` / `deploy-linux.sh`, and asserts every `REQUIRED_FLAGS` entry resolves to its intended live value. Catches T-283 at build time.
2. **Gateway-bypass test** (lint). An ESLint `no-restricted-syntax` rule making `.update(ipos)` / `.insert(ipos)` outside `ipo-write-gateway.ts` and the shared repository a build error, with a documented `eslint-disable` escape that requires a justification comment. This is the layer-3 enforcement — precedent exists: `web/eslint.config.mjs` already blocks `api-client` imports in services this way.
3. **Invariant-liveness audit** (integration, real DB). Extends `scripts/audit-ipo-coverage.mjs` — the `#181` pattern — with one assertion per DB constraint from (b), so a constraint being dropped or a repair reintroducing violations is caught by the existing prod audit.

---

## 3. Migration plan

Five phases. Each is independently shippable, independently revertible, checker-verifiable, and sized for a single Sonnet worker contract. **Phases 1 and 2 stop the bleeding; 3–5 are cleanup and can be reordered or deferred without losing the benefit.**

Sequencing is load-bearing: the identity unification (Phase 1) must precede the gateway (Phase 2), because the gateway's protection step depends on single-source identity. The lint ban (Phase 3) must follow the gateway, or it blocks work with no sanctioned alternative. Constraints (Phase 4) come after the gateway so the application stops *producing* violations before the DB starts *rejecting* them — otherwise every scraper cycle throws.

Per `.claude/tasks/lessons.md` (T-281): **any phase pairing a code fix with a data repair must sequence code → deploy → verify served SHA → repair → hold one full scraper cycle → re-verify.** Phase 4 is the one that does this.

---

### Phase 1 — Unify identity resolution *(highest value, smallest change)*

**Fixes the live regression from §1.4.**

- Extract `resolveIpoRow(identity, mode: 'fill' | 'overwrite')` into `packages/shared/src/repositories/ipo-identity.ts`, containing the full current three-tier logic from `data-persister.ts:219–247`.
- Replace all three copies with calls to it: `data-persister.ts`, `BaseScraperOrchestrator.ts:380`, `data-consolidation-orchestrator.ts:128`.
- Regression test: a typo'd company name resolves to the *same* row in the guard and the write. This test fails on `main` today.
- Delete the "MUST keep in sync" comments — they become false once there is nothing to keep in sync.

**Verifiable by:** the new test failing before, passing after; `grep -c findByNormalizedName scraper/src` drops from 3 to 1.
**Risk:** LOW. Pure extraction, no behaviour change except the guard gaining the fuzzy tier it should already have had.
**Rollback:** revert the PR; the three copies return.
**Hold test:** one live scraper cycle, confirm protected-field blocks still log at the same rate (a drop to zero would mean over-matching).
**Size:** small — one contract.

---

### Phase 2 — Introduce the write gateway *(the structural fix)*

- Move sanitizers/guards from `scraper/src/utils/validators.ts` to `packages/shared/src/db/ipo-write-sanitizers.ts`; re-export from the old path so no caller breaks.
- Create `packages/shared/src/db/ipo-write-gateway.ts` implementing the 7 steps in §2(a).
- `upsertIPO` becomes a thin adapter over `writeIpo({ intent: 'SCRAPE' })` — its callers do not change.
- Migrate the highest-risk direct writers, in this order:
  1. the 4 `web/app/api/admin/` routes → `intent: 'ADMIN'`
  2. `web/lib/services/status-updater-service.ts`, `conflict-resolution.ts`
  3. `scraper/src/services/exchange-monitor.ts`, `sebi-monitor.ts` (both currently `insert` with no dedup — a duplicate-row source)
  4. `web/lib/scrapers/sources/historical-ipo-scraper.ts`
- Delete the five dead non-`-v2` orchestrators (§1.3). They are unreachable and actively misleading.
- Remove the three write methods from `web/lib/repositories/ipo-repository.ts`; it becomes read-only.

**Verifiable by:** direct `ipos` write sites in `web/lib`, `web/app`, `scraper/src` drop from 11 to 0 (gateway + shared repository excepted); protection now demonstrably applies to admin and monitor paths (integration test).
**Risk:** MEDIUM — touches live admin and scraper paths. Mitigated by intent-scoped behaviour (admin keeps its bypass) and by shipping the gateway first with `upsertIPO` as its only caller, then migrating callers in reviewable batches.
**Rollback:** per-caller. Each migration is an independent commit; revert one without reverting the gateway.
**Hold test:** 24h — confirm admin edits still persist, scraper cycles still write, `field_sources` row count grows on create as well as update.
**Size:** the largest phase. Split into 2–3 contracts (gateway + adapter; admin/service callers; monitors + cleanup).

---

### Phase 3 — Enforce the gateway with lint

- ESLint `no-restricted-syntax` on `.update(ipos)` / `.insert(ipos)` outside the two sanctioned files, mirroring the existing `api-client` ban in `web/eslint.config.mjs`.
- Give `scraper/scripts/` and `web/scripts/` a sanctioned alternative first: a `runRepair()` helper wrapping `writeIpo({ intent: 'REPAIR' })` with dry-run default, `rowCount` verification, a ledger file, and non-zero exit on any unlanded write (the T-287F lesson, made structural).
- Migrate the 24 scripts. Historical one-shot scripts already run may be moved to `scraper/scripts/archive/` and excluded rather than migrated — decide per script; do not burn a phase migrating dead code.
- **Do not** rely on a scraper pre-commit hook: `shared-package-build.md` documents that `scraper/` deliberately has no pre-commit type/lint gate. Enforce in CI for both workspaces so the rule is not advisory in the workspace that needs it most.

**Verifiable by:** CI fails on a deliberately-added `db.update(ipos)` in a scratch file.
**Risk:** LOW-MEDIUM — mostly mechanical; risk is churn and merge conflicts across 24 files.
**Rollback:** disable the rule; the scripts still work.
**Hold test:** none needed (build-time only).
**Size:** 1–2 contracts, mostly mechanical. Can be deferred without losing Phase 2's benefit.

---

### Phase 4 — Database constraints *(the last line of defence)*

Strict per-constraint sequence, one constraint at a time:

1. `SELECT count(*)` violating rows in production → record in evidence.
2. If > 0: repair via the Phase 3 `runRepair()` helper, or narrow the predicate. Do not "fix" by weakening a real invariant.
3. Author DDL in `web/drizzle/migrations/_gated/` per `drizzle-migration-gated-ddl.md`; `ADD CONSTRAINT ... NOT VALID` first.
4. Owner sign-off; manual apply via the SSH tunnel; read-back verify.
5. Hold one full scraper cycle; watch for `23514`/`23505` in `scraper-out.log`. A violation here means a write path still produces bad data — **investigate, do not drop the constraint.**
6. `VALIDATE CONSTRAINT`.
7. Add the matching assertion to `scripts/audit-ipo-coverage.mjs`.

Order: `price_band_ordered` → `issue_size_positive` → `lot_size_sane` → `sector_not_blank` → `sme_not_fpo` → `isin_unique` → `symbol_unique`. Cheapest and most-evidenced first; the two `UNIQUE`s last because they need the most pre-repair (existing duplicates must merge first).

**Verifiable by:** violating writes now raise a Postgres error; audit assertions pass.
**Risk:** MEDIUM-HIGH — a constraint on live data can break the scraper cycle. Mitigated by `NOT VALID` staging, one-at-a-time application, and cycle-hold verification between each.
**Rollback:** `DROP CONSTRAINT` — instant, non-destructive, no data loss.
**Size:** 2 contracts (band/size/lot/sector; then the two `UNIQUE`s with their dedup pre-work).

---

### Phase 5 — Flag simplification and gate-liveness tests

- Delete the three `_PERCENTAGE` flags and `shouldUseFeature`'s percentage branch; remove from `.env.example`.
- Split `FEATURE_FLAGS` into `REQUIRED_FLAGS` (throw on absent) and `OPTIONAL_FLAGS`.
- Audit the 8 unclassified flags in §2(c); delete the dead ones.
- Add the config-contract test (§2(d).1) pinned to the real production env values.
- Add `.claude/rules/gate-liveness-tests.md`.
- Route `validateFeatureFlags` warnings through pino.
- Retro-fit gate-liveness tests to the existing gates: consolidation, source tracking, conflict detection, field protection, IPO lock.

**Verifiable by:** deleting `CONSOLIDATION_PERCENTAGE=100` from the env makes the config-contract test fail (today it makes nothing fail).
**Risk:** LOW.
**Rollback:** revert; flags are already at effective-100 so deletion is behaviour-neutral.
**Size:** one contract.

---

### Honest estimate

| Phase | Contracts | Risk | Stops recurrence of |
|---|---|---|---|
| 1 — identity | 1 | LOW | guard/write divergence (T-287F3 class, currently live) |
| 2 — gateway | 2–3 | MEDIUM | protection bypass, lineage gaps, sanitizer asymmetry, offering-type triplication |
| 3 — lint | 1–2 | LOW-MED | *new* bypass paths being added at all |
| 4 — constraints | 2 | MED-HIGH | degenerate bands, duplicates, invisible SME — **regardless of path** |
| 5 — flags + tests | 1 | LOW | silent-disable class (T-283) |

**Total: 7–9 worker contracts.**

Phases 1 and 2 deliver most of the value. If only two phases ship, ship those.

I am *not* claiming this eliminates data defects. It eliminates one specific and dominant failure mode: **a correct rule that a new code path silently skips.** Bugs of a different shape — a wrong parser, a source changing its HTML, a genuinely ambiguous merge — will keep occurring and the review process will keep catching them. That is the process working as intended.

What should stop is round 6 finding round 2's bug again.

---

## Appendix — evidence

- `evidence/2026-08-23-T-298/ipos-write-sites.txt` — full `git grep` output (47 lines)
- `evidence/2026-08-23-T-298/ipos-write-sites-real.txt` — 46 write statements, comment line removed
- `evidence/2026-08-23-T-283/60-inert-fix-audit.md` — authoritative H2 account (prior task)
- `.claude/tasks/lessons.md` §"2026-08-23 — Mechanism-class batch from T-276..T-293" — seven mechanism classes
- Key file:line anchors: `data-persister.ts:199,219,223,241,307,356,440,458,480,496,554,587`; `BaseScraperOrchestrator.ts:365,380,385,402`; `data-consolidation-orchestrator.ts:128,131`; `data-consolidation-service.ts:205,207`; `feature-flags.ts:150,194,207,264,288`; `schema.ts:141,142,143,210,211`; `data-consolidation-service.test.ts:19,36`
