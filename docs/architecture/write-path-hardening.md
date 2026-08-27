# Write-Path Hardening — architecture assessment and migration plan

**Task:** T-298 (owner architect mandate, 2026-08-23)
**Role:** Systems Architect
**Status:** Assessment + plan, **revised after an independent plan review (T-298C, verdict REVISE)**. No code changes in this PR. Implementation happens in follow-up phase contracts.
**Scope:** Why data defects kept recurring across five review rounds (T-250…T-295), what in the architecture causes it, and the minimum change that stops it.
**Revision note:** T-298C reproduced every core claim below (write-path count, H1/H2/H3, the live regression) but found the plan itself contained factual errors about production and about the repo — including one action that would have broken the build and one DB constraint that could not be added as written. Those corrections are folded in throughout; the biggest are in §1.9, §2, and §3. See `evidence/2026-08-23-T-298/plan-review/REVIEW.md` for the full independent review and `evidence/2026-08-23-T-298/plan-rev2/` for the per-finding self-verification behind this revision.

**Round-2 pointer (T-317, 2026-08-24):** The second independent-review round is complete — see `docs/architecture/fable-review-2026-08-24.md` §7 REVIEW-VERDICTS for the full T-314C verdict (REVISE, 5 corrections folded). Converged build order (adopted): R0 ratchet -> IDENT (NULL-safe) + Phase-1 completion -> LIFECYCLE-1 (no new tables) -> deploy+repairs -> constraints -> OBS-1/OBS-2 (retention/shadow/breaker) -> gateway-as-projection. R0 (the CI grep-ratchet gate) is shipping as T-316 — this doc's own "lint gate now exists after #214" framing (Phase 3 above) is superseded by that correction. Read the Fable doc §7 before building any further phase of this plan.

---

## 0. Executive summary (plain English)

**What is wrong.** IPODhan has good data rules — price bands must be sane, one company must be one row, an admin's manual edit must never be overwritten, every value must record where it came from. Those rules are real and they are written down in code. The problem is **where** they are written down: they live inside one 1,224-line function (`upsertIPO`) and inside its *caller* (`BaseScraperOrchestrator`), while **~48 other files write to the same table directly and obey none of them.**

So the rules are not rules. They are a convention that one path happens to follow.

**Why the same bugs kept coming back.** Every review round found a defect, and every fix added one more `if` statement inside that one function. The fix was always correct and always narrow. The next new write path — a repair script, a backfill, an admin API — never got the `if`. Round 5 finds the same class of bug that round 2 fixed, wearing new clothes.

The clearest proof is a bug that is **live right now.** Three hours before this review, T-293 shipped an improvement: `upsertIPO` gained a third way of recognising "is this company already in the database?" (a typo-tolerant match). The *protection check* that runs just before the write — in a different file — was not updated. It still uses only two ways. So today, if a scraper reports a company name with a typo, the protection check says "I don't know this company, nothing to protect" and lets the write through unfiltered, while the write itself recognises the company and overwrites it — including fields an admin manually locked. **This is the exact bug T-287F3 fixed 24 hours earlier.** It reopened in one day, because the thing holding it shut was a code comment asking a future developer to remember, not a structure that made forgetting impossible.

**What we change.** Four things, no rewrite, no new services:

1. **One door.** Every write to `ipos` goes through one function that enforces identity, protection, sanity and provenance. Scripts included. Direct `db.update(ipos)` becomes a lint error.
2. **A lock on the door frame.** The database itself gets `CHECK` and `UNIQUE` constraints for the hard rules. Today the **Drizzle schema file** declares **zero** `CHECK` constraints and no uniqueness on `isin` or `symbol` — but production already has three hand-applied guards outside the migration journal (`ipos_symbol_key` UNIQUE(symbol), `ipos_issue_size_positive` CHECK (issue_size >= 0), `ipos_status_check`; see §1.9). None of those cover `isin` uniqueness, price-band ordering, or `lot_size`. With the missing ones added, even a rogue script physically cannot write a backwards price band or a duplicate ISIN.
3. **Honest switches.** Retire the percentage-rollout flags. One of them (`CONSOLIDATION_PERCENTAGE`) silently disabled the entire multi-source merge engine for the product's whole life while the logs cheerfully reported success. Flags become plain on/off booleans that fail loudly when misconfigured.
4. **Tests that check the gate is open, not just that the gate works.** Today every consolidation test stubs the gate to `() => true`. That is why nobody noticed the real gate was shut.

**Why this stops the recurrence.** Right now, adding a new write path costs nothing and silently skips every rule. After this, adding a new write path that skips the rules is a *build failure* (lint), a *test failure* (gate-liveness), or a *database error* (constraint). The rule stops depending on whoever writes the next script remembering seven prior review rounds.

**Cost.** Five phases, each independently shippable and reversible. Phases 1–2 are the ones that actually stop the bleeding; 3–5 are cleanup. Honest estimate below.

---

## 1. Assessment

### 1.1 The write-path inventory

Method: `git grep -nE '\.(insert|update)\((schema\.)?ipos\)' -- '*.ts'`, tests excluded. Full output archived at `evidence/2026-08-23-T-298/ipos-write-sites.txt`.

**46 write statements across 37 distinct non-test files** target the `ipos` table via Drizzle's `.insert()`/`.update()`.

**This grep is pattern-blind to the majority of the real bypasses (T-298C finding B1).** It only matches the Drizzle query-builder shape. A second sweep for raw SQL and `.delete()` — `UPDATE ipos` / `INSERT INTO ipos` / `DELETE FROM ipos` / `.delete(ipos)` — finds 11 more non-test files entirely absent from the table below, including a **scheduled job**, an **identity-mutating** backfill, and a plain `.sql` file:

```
scraper/src/scheduler/jobs/duplicate-sweep-job.ts     <- SCHEDULED (cron), raw UPDATE + DELETE
scraper/scripts/merge-duplicate-ipos.ts               <- raw DELETE
scraper/scripts/merge-atharva-polyplast-t277.ts
scraper/scripts/deduplicate-test-ipos.ts
scraper/scripts/merge-citius-t287.ts
scraper/src/scripts/backfill-clean-company-names.ts   <- writes company_name + slug (IDENTITY fields)
scraper/src/scripts/backfill-isin-from-nse.ts
scraper/src/scripts/reclassify-corporate-actions.ts
scripts/fix-substance-corruption.mjs                  <- repo root, outside every workspace
web/scripts/cleanup-test-data.ts
web/scripts/fix-lot-size-defaults.sql                 <- a plain .sql file, not TypeScript
```

(Reproduced 2026-08-23; see `evidence/2026-08-23-T-298/plan-rev2/` for the raw grep output behind this revision. `web/drizzle/migrations/0015_restructure_category_to_segment_offering_type.sql` and the files under `web/tests/**` / `scraper/tests/**` also match the raw-SQL pattern but are migrations/tests, not live write paths, and are excluded from the count below.)

**Corrected total: roughly 57 write statements across ~48 non-test files.** The 46/37 Drizzle-only figure understates the surface by about a quarter. Two consequences that flow from this, both addressed in §1.9 and §2(d):

- **B2 — there is no DELETE story.** `duplicate-sweep-job.ts` and `merge-duplicate-ipos.ts` run `DELETE FROM ipos` outright. Row destruction — the worst-blast-radius operation of all — is completely ungoverned by everything below and unlinted by the Phase-3 rule as originally scoped.
- The Phase-3 lint rule (`no-restricted-syntax` on `.update(ipos)`/`.insert(ipos)`) as originally scoped would leave every one of the 11 files above unpoliced. §2(d) below widens the rule.

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
| **Canonical identity / dedup** (one company = one row) | `data-persister.ts:219–247` (3 tiers: normalized-name → slug → fuzzy) | `slug` UNIQUE only in the schema file; **`isin` and `symbol` are plain indexes there, not unique** (`schema.ts:142,143,210,211`) — *(schema file; prod differs — see §1.9: `ipos_symbol_key UNIQUE(symbol)` already exists out-of-journal; `isin` has no DB-level uniqueness in either the schema file or prod)* | all 35 non-repository write paths; and the two *other* copies of the lookup (§1.4) |
| **Field protection / IPO lock** (admin edits stick) | `BaseScraperOrchestrator.ts:385,402` — **the caller, not the write** | no | **`upsertIPO` itself** — `grep -cE 'isIPOLocked|filterProtectedFields|isFieldProtected|fieldProtectionService' data-persister.ts` = **0** (vs **5** in `BaseScraperOrchestrator.ts`). Every script that calls `upsertIPO` directly believes it is protected and is not. |
| **Band / value sanity** (min ≤ max, no `0` issue size, no `lot_size = 1`) | `data-persister.ts:307–320` (create) and `sanitizeIpoWriteFields` (update) — two different implementations | **zero `CHECK` constraints in the 1,375-line schema *file*** (`grep -c 'check(' = 0`) — *(schema file; prod differs — see §1.9: `ipos_issue_size_positive` CHECK (issue_size >= 0) and `ipos_status_check` already exist out-of-journal; no CHECK exists anywhere, schema file or prod, for band ordering or `lot_size`)* | all 35 non-repository paths |
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

**Correction (T-298C finding F1 — this assessment was wrong in the first draft).** The five non-`-v2` orchestrators (`nse-scraper-orchestrator.ts`, `bse-scraper-orchestrator.ts`, `chittorgarh-orchestrator.ts`, `moneycontrol-orchestrator.ts`, `ipo-alerts-fallback-orchestrator.ts`) also call `upsertIPO` directly and are not classes at all — they never touch `BaseScraperOrchestrator`. `scraper/src/index.ts:12–18` does import only the `-v2` versions, but **that is not the only entrypoint.** `scraper/src/scheduler/scheduler.ts:12–15` imports the **non-v2** `runNSEScraper`, `runBSEScraper`, `runMoneycontrolScraper`, `runChittorgarhScraper` directly, and the non-v2 `bse-scraper-orchestrator.ts`/`nse-scraper-orchestrator.ts` in turn import the non-v2 `ipo-alerts-fallback-orchestrator.ts` — so all five are reachable through `scheduler.ts`, not zero. `scraper/package.json` exposes `npm run scheduler`, and this plan's own Phase 5 (§3) treats `scheduler/index.ts` as an entrypoint to wire flag validation into.

**They are not dead code. They are a live protection bypass on a documented entrypoint.** Each of the four calls `upsertIPO` 3 times with **zero** references to `BaseScraperOrchestrator` and **zero** protection-API references — confirmed by the same grep as §1.3's main finding, re-run against each file. Every source `scheduler.ts` drives except GMP (which already imports `investorgain-gmp-orchestrator-v2.js`) runs with field protection and the IPO lock entirely absent when reached this way.

Mitigating fact, not a reason to downgrade the finding: today's production `ipodhan-scraper` PM2 app is the one-shot `src/index.ts` (`-v2` path), verified via `pm2 list` on the Linux VPS — `scheduler.ts` is not currently running in production. But it is a committed, documented, `npm run`-able entrypoint, and deleting these five files as originally planned (§2(a)/Phase 2) would **break the build** the moment anyone builds `scraper/` from a clean tree, because `scheduler.ts` would fail to resolve its imports. Resolution adopted below (§2(a), Phase 2): **rewire `scheduler.ts` to the `-v2` imports first, verify the scraper build stays green, then delete the five non-v2 files** — never delete-then-fix.

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

### 1.9 What the independent review (T-298C) found that this assessment missed

T-298C reproduced every claim in §1.1–§1.8 (write-path count corrected in §1.1; H1/H2/H3 exact; the live regression confirmed still live post-T-293). It then found gaps of its own — a live production database probe (301 rows, read-only, via the app's least-privilege role) and a second read of the repo's build graph. These are folded into §2 and §3 below; this section records what was found and why, so the "why" survives independently of the section it changed.

**Production schema drift — the plan's Layer-1 premise was checked against the wrong artifact (F4, F5, BLOCKING).** §1.2 and §2(b) originally said "zero `CHECK` constraints... no uniqueness on `isin` or `symbol`" — true of `packages/shared/src/db/schema.ts`, **false of the live production database**. `pg_constraint` on prod `ipodhan` shows:

```
ipos_issue_size_positive   CHECK (issue_size >= 0)      -- already exists
ipos_status_check          CHECK (status = ANY (...))   -- already exists
ipos_symbol_key            UNIQUE (symbol)               -- already exists
ipos_slug_unique           UNIQUE (slug), ipos_pkey, ipos_registrar_id_registrars_id_fk
```

`ipos_issue_size_positive` was added out-of-journal by `web/scripts/apply-issue-size-migration.ts:19` and enforces `>= 0`, not `> 0` — it *permits* the exact `0`-means-unknown class this plan wants to kill, while carrying a name that reads as if it forbids it. The plan's original Phase 4 step 3 (`ADD CONSTRAINT ipos_issue_size_positive ... NOT VALID`) would fail with **SQLSTATE 42710 (duplicate object)** on the very first constraint in its own ordering — the plan's own audit-before-add prerequisite was stated but not actually performed against the database it applies to. Resolution: Phase 4 now starts from a `pg_constraint` dump, not the schema file (§2(b), §3 Phase 4 step 0).

**Phase-4 ordering was backwards against measured cost (F8).** The plan ordered constraints "cheapest first" by inspection; a live count shows the opposite of the assumed cost for four of the seven:

| Constraint | Violating rows / 301 (measured 2026-08-23) | Plan's original position | Actual cost |
|---|---|---|---|
| `price_band_ordered` | 0 | 1st | cheapest — correct |
| `lot_size_sane (>1)` | 0 | 3rd | cheapest — correct |
| `isin_unique` | 0 | last | cheapest — was ordered last as if it were dearest |
| `symbol_unique` | 0 (already exists) | 2nd-to-last | zero cost — redundant work, see F6 |
| `sme_not_fpo` | 3 | mid | cheap, matches plan |
| `issue_size_positive (>0)` | 50 (17%) | 2nd | not cheap — was ordered as if it were |
| `sector_not_blank` | 196 (65%) | 4th | by far the most expensive — was ordered as "cheap" |

The two `UNIQUE`s need **zero** pre-repair today; `sector_not_blank` requires repairing two-thirds of the table. §2(b) and §3 Phase 4 re-order by this measurement and defer/cut `sector_not_blank` (§6 KISS below).

**Constraint scoping ignores non-IPO offering types (F6, F7, F9).** `ipos` holds 42 rows that are not IPOs by `offering_type`: 18 OFS, 16 TENDER, 7 RIGHTS, 1 BUYBACK.

- `ipos_symbol_key UNIQUE(symbol)` **already exists in prod** (making the plan's proposed `ipos_symbol_unique` redundant work) and is itself a live risk: a second-event row (an OFS or Rights issue for a company that already has a listed IPO row) can share that company's ticker and **cannot be inserted today** — a plausible silent insert-failure source, worth its own investigation, not something this plan should replicate for `isin`.
- `isin UNIQUE` has the identical problem: an IPO row and a later FPO/OFS/Rights row for the same company legitimately share an ISIN. 0 duplicates exist today (free to add), but 3 SME/FPO rows already exist (F10) and ISIN backfill will surface more collisions as it runs. Scope to `UNIQUE (isin, offering_type)` or `WHERE offering_type = 'IPO'`, not a bare `UNIQUE (isin)`.
- `lot_size > 1` rejects RIGHTS issues by design — a rights entitlement is legitimately lot-size 1 (per-share). 8 RIGHTS rows exist today at 0 violations, but the constraint as originally scoped is a ticking forward-risk, not a currently-measured one. Scope to `offering_type = 'IPO'` or accept the future rejections explicitly.

`min <= max` and excluding date ordering from DB constraints were both correct calls in the original plan — reconfirmed: 146/301 rows are fixed-price (`min == max`), 0 are inverted.

**Sibling-class omission (F2) — the plan's own flag table repeats the T-250 F9 reasoning error.** §2(c) originally classified `ENABLE_MONEYCONTROL_SUBSCRIPTION`, `ENABLE_GMP_NAME_MATCH`, `ENABLE_BSE_API`, `ENABLE_PRIMARY_SOURCE_DISCOVERY` as "KEEP as-is — live capability flags, set `true` in `ecosystem.config.js`, working as designed." `ecosystem.config.js` is the **retired Windows deploy path** (`self-hosted-windows-vps-deploy.md`, `pm2-scheduled-one-shot-scraper.md`) — citing it as the flag source of truth is the exact reasoning error that caused the T-250 F9 incident (`ENABLE_MONEYCONTROL_SUBSCRIPTION` was `true` there and silently absent from the Linux env for 3 cycles on the day two IPOs closed). Verified live on the Linux host: the real source of truth is `/var/www/ipodhan/shared/env/prod/scraper.env`, and `scripts/assert-env-keys.sh:57-72` already gates all 7 `ENABLE_*` flags deterministically at deploy time — this plan should extend that script, not build a second, parallel "config-contract test" that duplicates it. Also found live and previously unremarked: **`ENABLE_PRIMARY_SOURCE_DISCOVERY` is `'true'` in `ecosystem.config.js` but `false` in the live prod env right now** — the plan listed it as "working as designed" while it is silently off in production. This is not fixed by this revision (it may be an intentional owner decision); it is recorded as an open item the plan surfaces rather than silently resolves — see §2(c).

**Child-table non-goal needs to be argued against its own worst counter-example (F3).** §2(a) declares `subscriptions`, `gmp_records`, `documents`, `financial_data` a non-goal on YAGNI grounds. That is a defensible scope boundary for the *gateway*, but the corpus this plan is responding to includes T-250's headline finding: a `subscriptions` write outage — the single most time-sensitive number on the site went stale for 3 cycles. The YAGNI call stands (this plan is scoped to `ipos`), but it must say so against that incident by name, not read as if the defect class never reached a child table. Restated explicitly in §2(a).

**Design gaps that survive all three enforcement layers (B1–B8), beyond the inventory correction in §1.1:**

- **B3 — `scraper/` has no ESLint config at all**, and root `"lint": "npm run lint --workspace=web"` only lints `web/`. Confirmed: no `scraper/eslint.config.*` or `.eslintrc*` exists, and CI runs `npm run lint` (web-only). Phase 3's originally-stated "1–2 contracts, mostly mechanical" sizing assumed a lint layer that does not exist for the workspace where most of the missed bypasses (§1.1) live. Standing up scraper linting and wiring both workspaces into CI is now explicit Phase-3 work, sized accordingly (§3 Phase 3).
- **B4 — the protection module is itself a writer.** `packages/shared/src/admin/field-protection-checker.ts:424` writes `ipos`. A gateway that calls protection, which writes `ipos`, needs an explicit lint exemption and a documented re-entrancy story (the protection write must not re-trigger the gateway). Added to the Phase-3 lint design (§2(d)).
- **B5 — hand-applied `.sql` migrations are unlinted by construction.** `web/drizzle/migrations/_repair/` files are applied by hand with `psql -f` per `drizzle-migration-gated-ddl.md` — no lint layer can reach them, and this plan's own Phase 4 repairs will run the same way. Recorded as an accepted, permanent exception (not a gap to close) — see §2(d).
- **B7 — the `mode: 'fill' | 'overwrite'` parameter on `resolveIpoRow` re-creates the divergence Phase 1 exists to kill.** If the guard call site picks `'overwrite'` (strict) while the write's create-path picks `'fill'` (fuzzy), the guard still misses the row the write hits — the same class of bug as §1.4, now parameterised instead of hand-copied. The original claim that unifying the lookup makes reopening "structurally impossible" is **overclaimed** while two call-site-chosen modes exist. Fix (§2(a), §6 KISS): resolve identity **once per request**, in the gateway, and pass the resolved row down to both the protection step and the write step — never let two call sites choose independently. Drop the `mode` parameter until a second, genuinely different caller needs it (YAGNI).
- **B8 — the largest under-scoping in the original plan.** A gateway module in `packages/shared` cannot itself perform step 5 (consolidate): the consolidation engine (`data-consolidation-service.ts`, 854 lines) and the field-priority matrix (`field-priority-matrix.ts`, 759 lines) live in `scraper/src` and import `../config/feature-flags`. `shared-package-build.md` forbids `packages/shared` importing from `scraper/`, and confirmed by re-grep, `packages/shared/src` imports zero scraper modules today. Phase 2 as originally sized ("2–3 contracts") assumed this was solvable inline; it is not, without either moving ~1,600 lines into `shared` or injecting consolidation as a callback the gateway invokes but does not own. Resolution and re-sizing in §2(a) and §3 Phase 2.
- **F11 — gate-liveness tests partly already exist.** `scraper/tests/unit/services/consolidation-percentage-gate.test.ts` (added by T-283) already implements the unmocked-gate pattern §2(d) describes as new. Confirmed present on this branch. §3 Phase 5 now extends this file instead of introducing the pattern from scratch.

**KISS cuts adopted from the review (§6 in the review; folded into §2(b)/§2(c)/§2(a)/§3 below):** cut `ipos_symbol_unique` (redundant — already live); defer `ipos_sector_not_blank` (65% of rows violate; buys the least, costs the most; a NULL-normalising repair plus the existing `#181` audit assertion is enough for now); do not build a new config-contract test — extend `scripts/assert-env-keys.sh`; drop the `mode` parameter from `resolveIpoRow`; collapse `WriteIntent` from 5 members to the 3 with distinct behaviour (`SCRAPE` / `ADMIN` / `REPAIR` — `BACKFILL` and `MIGRATION` are undifferentiated in this spec and get no behaviour of their own; add them back only when a caller needs different behaviour, not just a different label).

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
export type WriteIntent = 'SCRAPE' | 'ADMIN' | 'REPAIR';

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

**Revised from the original draft (T-298C findings B7, KISS):** `WriteIntent` drops `'BACKFILL'` and `'MIGRATION'` — in this spec they have no behaviour distinct from `'SCRAPE'`/`'REPAIR'`, so carrying them is a label, not a design decision. Add a member back only when a concrete caller needs behaviour the existing three can't express (YAGNI). `resolveIpoRow` also drops the `mode: 'fill' | 'overwrite'` parameter it originally had — see step 1 below.

The gateway runs, in fixed order, for **every** caller:

1. **Resolve identity — once per request.** ONE exported function `resolveIpoRow(identity)` runs the full three-tier lookup (normalized-name → slug → fuzzy) and returns a single resolved row (or none). The gateway calls it **once**, at the top of the request, and passes the resolved row down to steps 2 and 6. `BaseScraperOrchestrator` and `data-consolidation-orchestrator` are refactored to call *this* function instead of hand-copying the tiers, closing §1.4.

   **Correction (T-298C finding B7):** the original draft gave `resolveIpoRow` a `mode: 'fill' | 'overwrite'` parameter, with the guard call site choosing `'overwrite'` (strict) and the write call site choosing `'fill'` (fuzzy). That re-creates exactly the bug this phase exists to close — if the two call sites pick different modes, the guard can still miss the row the write hits, now parameterised instead of hand-copied. There is no `mode` parameter in the corrected design: identity is resolved once, the same way, for the same request, and every downstream step reads that one result. The earlier claim that this "makes it structurally impossible to reopen" was **overclaimed** while two independently-chosen modes existed; with a single resolution per request and no mode branch, the claim now holds.
2. **Protection** — IPO lock, then `filterProtectedFields`, using the row resolved in step 1 (not re-resolved). Guard and write can no longer disagree because there is one resolution, computed once. `intent: 'ADMIN'` bypasses (that is the point of admin); `intent: 'REPAIR'` bypasses only with an explicit `allowProtectedOverwrite: true` plus a `reason`, and always logs.
3. **Sanitize** — one call to `sanitizeIpoWriteFields`, applied on both create and update (today they run different code). Absorbs `sanitizeIpoDates`, `coercePositiveOrNull`, `validateLotSize`, `sanitizeCompanyName`, `sanitizeRegistrar`.
4. **Consistency guards** — `guardSmeOfferingTypeAgainstFpo` and `resolveOfferingTypeKeepingClassification`, once, replacing today's three inline copies.
5. **Consolidate** — for `intent: 'SCRAPE'` on an existing row, through the priority matrix.

   **Correction (T-298C finding B8 — the largest under-scoping in the original draft).** The consolidation engine (`scraper/src/services/data-consolidation-service.ts`, 854 lines) and the field-priority matrix (`scraper/src/config/field-priority-matrix.ts`, 759 lines) live in `scraper/src` and import `../config/feature-flags`. `shared-package-build.md` forbids `packages/shared` importing from `scraper/`, and `packages/shared/src` imports zero scraper modules today — a gateway that lives in `packages/shared` **cannot call the consolidation engine directly** without violating that boundary. Two options, decided here rather than deferred to the implementing worker: **the gateway accepts consolidation as an injected callback** (`consolidate?: (existing, incoming) => Promise<ConsolidatedResult>`), supplied by `scraper`-side callers (which already have the engine in scope) and omitted by `web`-side callers (admin/repair writes don't consolidate — they already win outright by priority). The alternative — moving ~1,600 lines of consolidation logic into `shared` — is rejected: it is a far larger, riskier refactor than this plan's stated scope, and the engine's only reason to move would be to satisfy the gateway's own location, not a real second consumer. Phase 2 is re-sized in §3 to reflect that this design decision, not just the gateway's plumbing, is part of the phase.
6. **Persist** — repository write, using the row resolved in step 1, `rowCount` checked, `rowCount < 1` returned as an error (the T-287F lesson).
7. **Lineage** — `field_sources` written on create *and* update, from the same code, for every intent.

**Deliberate deviation from the contract's expected shape:** the contract says "one write gateway (repository/persister chokepoint)". I am proposing the gateway sit *above* the repository, not be the repository. Reason: there are two divergent `IPORepository` implementations (§1.1) and merging them is a large, risky, low-value refactor that would have to land before anything else could. A gateway module above both is smaller, ships sooner, and lets repository consolidation happen later as independent cleanup. The gateway calls the shared repository; the web repository keeps its read paths and loses its three write methods.

**Explicit non-goal, stated against its own worst counter-example (T-298C finding F3):** the gateway is for `ipos`. Child tables (`subscriptions`, `gmp_records`, `documents`, `financial_data`) keep their current write paths in this plan. This is a deliberate scope cut, not an implicit claim the defect class never reached a child table — **it already has.** T-250's headline finding was a `subscriptions` write outage (`ENABLE_MONEYCONTROL_SUBSCRIPTION` silently unset for 3 cycles), and subscription figures are the most time-sensitive number on the site. The YAGNI call still stands: this plan closes the `ipos` gateway first because that is where the corpus of five review rounds concentrates, and extends the pattern to child tables only if the same defect classes recur there after this ships. (Do not build five gateways because one was needed — but do not read the omission as "child tables are safe.")

### (b) Database-level constraints

**Correction (T-298C findings F4, F5, BLOCKING) — this section's premise was checked against the wrong artifact.** The claim "zero `CHECK` constraints exist today" is true of `packages/shared/src/db/schema.ts` and **false of the live production database.** Prod `ipos` already carries `ipos_issue_size_positive CHECK (issue_size >= 0)` (added out-of-journal by `web/scripts/apply-issue-size-migration.ts:19`), `ipos_status_check CHECK (status = ANY (...))`, and `ipos_symbol_key UNIQUE (symbol)`. Phase 4 (§3) now starts with a `pg_constraint` dump against production, not a read of the schema file — see §1.9 for the full account, including why the original Phase-4 step 3 would have failed with SQLSTATE 42710 on its first constraint.

Add the hard invariants where nothing can route around them, reconciled against what already exists and re-ordered by **measured pre-repair cost** (T-298C finding F8; 301-row prod probe, 2026-08-23), not by inspection:

| Constraint | Rule | Catches | Measured violations / 301 | Status |
|---|---|---|---|---|
| `ipos_price_band_ordered` | `CHECK (price_range_min IS NULL OR price_range_max IS NULL OR price_range_min <= price_range_max)` | inverted bands from any path | 0 | new |
| `ipos_isin_unique` | `UNIQUE (isin, offering_type) WHERE isin IS NOT NULL` — scoped by `offering_type`, not bare `UNIQUE(isin)` (finding F7: an IPO row and a later FPO/OFS/Rights row for the same company legitimately share an ISIN; 3 SME/FPO rows already violate a bare unique, see F10) | duplicate rows by hard identity, without rejecting legitimate multi-event ISIN reuse | 0 | new |
| `ipos_lot_size_sane` | `CHECK (offering_type <> 'IPO' OR lot_size IS NULL OR lot_size > 1)` — scoped to `offering_type = 'IPO'` (finding F9: a RIGHTS issue legitimately has lot size 1 — entitlement is per-share; 8 RIGHTS rows exist) | the `lot_size = 1` class, without rejecting RIGHTS issues | 0 | new |
| `ipos_sme_not_fpo` | `CHECK (NOT (segment = 'SME' AND offering_type = 'FPO'))` | #180/#181 invisible-SME, enforced at write not just audit | **3** (F10 — never repaired since #180/#181 shipped the audit gate) | new; **repair the 3 rows before this lands** |
| `ipos_issue_size_positive` | **Rename**, do not reuse the existing name: `ipos_issue_size_gt_zero CHECK (issue_size IS NULL OR issue_size > 0)`, then `DROP CONSTRAINT ipos_issue_size_positive` (the existing `>= 0` version, which permits the `0`-means-unknown class this constraint exists to kill) | the `0`-means-unknown class | **50 (17%)** | drop-then-add, prod already has a same-named weaker version (F4) |
| ~~`ipos_symbol_unique`~~ | ~~`UNIQUE (symbol) WHERE symbol IS NOT NULL`~~ | — | 0 (already enforced) | **CUT (finding F6/KISS)** — `ipos_symbol_key UNIQUE(symbol)` already exists in prod; adding a second one is redundant. Flagging instead, as an open item, not fixed by this plan: that existing constraint already blocks inserting a second-event row (OFS/TENDER/RIGHTS/BUYBACK) that shares a ticker with an already-listed company — 42 non-IPO rows are exposed to this, and it may be a live silent-insert-failure source worth its own investigation |
| `ipos_sector_not_blank` | `CHECK (sector IS NULL OR length(trim(sector)) > 0)` | the `''`-sector class that defeats NULL-based backfills | **196 (65%)** | **DEFER (finding F8/KISS)** — repairing two-thirds of the table to add this buys the least of the seven and costs the most; a NULL-normalising repair plus the existing `#181` audit assertion (`scripts/audit-ipo-coverage.mjs`) is sufficient for now. Revisit once the repair is done for other reasons, not as a Phase-4 deliverable |

Deliberately **not** constrained: date ordering (`open ≤ close ≤ allotment ≤ listing`). Real sources legitimately publish partial and revised date sets mid-lifecycle; a hard constraint would reject good scrapes. Date coherence stays an application guard with a logged warning, as today. (Reconfirmed correct by T-298C: `min <= max` as written is right — 146/301 rows are fixed-price `min == max`, 0 are inverted.)

Two prerequisites, both non-negotiable, now stated against a live probe instead of an assumption:

- **Audit before adding, against `pg_constraint` and a live row count — not the schema file.** Each constraint gets a `SELECT count(*)` against production first (table above records the 2026-08-23 baseline; re-run at implementation time, it will have moved). Existing violating rows must be repaired (or the constraint's predicate narrowed, as done above for `isin`/`lot_size`) *before* the DDL, or the deploy fails. `NOT VALID` → repair → `VALIDATE CONSTRAINT` is the safe sequence.
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
| `ENABLE_GMP_NAME_MATCH`, `ENABLE_MONEYCONTROL_SUBSCRIPTION`, `ENABLE_BSE_API`, `ENABLE_PRIMARY_SOURCE_DISCOVERY` | **KEEP**, but re-point the source of truth (finding F2, corrected below) | live capability flags |
| `ENABLE_GMP_SCHEDULED_JOB`, `ENABLE_STAGE_RECONCILER` | **KEEP** as-is | §GATE owner-activation flags per `owner-gated-feature-flags.md`; that convention is sound and stays |
| `ENABLE_DRHP_EXTRACTION`, `ENABLE_EARLY_DETECTION`, `SHADOW_MODE`, `DEBUG_DATA_FLOW`, `MAX_CONFLICTS_PER_IPO`, `SOURCE_TRACKING_BATCH_SIZE`, `ENABLED_SCRAPERS`, `ENABLED_IPO_IDS` | **AUDIT then keep-or-delete** in Phase 5 | each needs a live/dead call-site check; the T-283 lesson is that a defined-but-unread flag is worse than no flag |

**Correction (T-298C finding F2) — the flag source-of-truth cited above is wrong, and it is the same reasoning error that caused a prior incident.** The original draft classified `ENABLE_GMP_NAME_MATCH`/`ENABLE_MONEYCONTROL_SUBSCRIPTION`/`ENABLE_BSE_API`/`ENABLE_PRIMARY_SOURCE_DISCOVERY` as "working as designed" by citing `ecosystem.config.js`. That file is the **retired Windows deploy path** (`self-hosted-windows-vps-deploy.md`) — production has served from the Linux VPS since T-252. Citing it as live flag state is the precise reasoning error behind the T-250 F9 incident, where `ENABLE_MONEYCONTROL_SUBSCRIPTION` was `true` in `ecosystem.config.js` and silently absent from the Linux env, stopping subscription writes for 3 cycles on the day two IPOs closed.

The real source of truth is `/var/www/ipodhan/shared/env/prod/scraper.env` on the Linux host, and a deterministic gate for this already exists: `scripts/assert-env-keys.sh:57-72` lists all 7 `ENABLE_*` flags as required and fails the deploy if any is missing. §2(d)'s originally-proposed "config-contract test" would have duplicated this gate under a different name — **cut it (KISS)**; extend `assert-env-keys.sh` instead if a new flag needs the same guarantee.

**Open item surfaced, not resolved, by this plan:** re-checking the live prod env against `ecosystem.config.js` found `ENABLE_PRIMARY_SOURCE_DISCOVERY` is `'true'` in the retired-path config but **`false` in the actual live prod env today**. This may be an intentional owner decision (the flag could have been deliberately turned off after `ecosystem.config.js` was last edited) or it may be the same silent-drift class T-250 F9 was. This plan does not change it — flipping a live capability flag is an owner call, not an architecture-hardening default — but it must not ship unremarked a second time. Whoever picks up Phase 5 files this as an owner-open item (a one-line note in the PR, or a fleet task) rather than silently "fixing" it either direction.

Two structural rules to prevent recurrence:

1. **Two tiers only.** `REQUIRED_FLAGS` — absent or unparseable ⇒ `validateFeatureFlags()` **throws at startup**, process refuses to run. `OPTIONAL_FLAGS` — default documented, absent is fine. No flag may be silently-defaulting *and* behaviour-critical. That combination is what T-283 was.
2. **`validateFeatureFlags()` + `logFeatureFlags()` are called at every entrypoint.** Already wired into `index.ts` by T-283; add `scheduler/index.ts` and any future entrypoint, with a unit test asserting the call exists. Route through pino, not `console.warn` (`structured-logging.md`).
3. **The flag source-of-truth for "is this live in prod" is `/var/www/ipodhan/shared/env/prod/scraper.env` + `scripts/assert-env-keys.sh`, never `ecosystem.config.js`.** Any doc, plan, or PR description that cites `ecosystem.config.js` as current flag state is describing the retired Windows path and is wrong by construction.

### (d) Test-architecture rule: gate-liveness tests are unmocked

New rule file `.claude/rules/gate-liveness-tests.md`:

> Every gate that can disable a data-correctness behaviour MUST have at least one test that exercises it **unmocked**. A test that stubs the gate (`shouldUseFeature: () => true`, `FEATURE_FLAGS: {...literal}`, `validateFeatureFlags: vi.fn()`) proves the guarded logic is correct; it does not prove the guard is open. Both are required, and they are different tests.

Two concrete test/lint classes (a third — a standalone "config-contract test" — was cut; see below):

1. ~~**Config-contract test**~~ **CUT (finding F2/KISS).** The original draft proposed a new unit test importing `feature-flags.ts` against `process.env` values from `ecosystem.config.js` — the retired Windows path (§2(c)). A deterministic, deploy-time gate for exactly this already exists: `scripts/assert-env-keys.sh:57-72`, which lists all 7 `ENABLE_*` flags as required and fails the deploy on any gap, reading the real Linux `scraper.env`. Extend that script when a new flag needs the same guarantee; do not build a second, parallel mechanism that reads the wrong source of truth.
2. **Gateway-bypass test** (lint). An ESLint `no-restricted-syntax` rule making `.update(ipos)` / `.insert(ipos)` / `.delete(ipos)` **and the raw-SQL equivalents** (`UPDATE ipos`, `INSERT INTO ipos`, `DELETE FROM ipos` as string-literal patterns, per T-298C finding B1/B2) outside `ipo-write-gateway.ts` and the shared repository a build error, with a documented `eslint-disable` escape that requires a justification comment. This is the layer-3 enforcement — precedent exists: `web/eslint.config.mjs` already blocks `api-client` imports in services this way.

   **Widened scope (findings B1–B5):** the rule cannot be Drizzle-`.update`/`.insert`-only, or it leaves the 11 files found in §1.1 (raw SQL, a scheduled job, `.mjs`/`.sql` files outside every workspace) completely unpoliced. It also **cannot run at all until scraper linting exists** — see B3 in §3 Phase 3, which is now a prerequisite of this test class, not a parallel item. Two accepted, permanent exceptions to the rule, both documented in the ESLint config comment: (a) `packages/shared/src/admin/field-protection-checker.ts` — the protection module itself writes `ipos` as part of applying protection, and needs a re-entrancy note (it must not re-trigger the gateway) rather than a lint violation (finding B4); (b) hand-applied files under `web/drizzle/migrations/_repair/` and `_gated/`, which are `psql -f`'d by design per `drizzle-migration-gated-ddl.md` and cannot be reached by any lint layer (finding B5) — this is an accepted gap, not a defect to close.
3. **Invariant-liveness audit** (integration, real DB). Extends `scripts/audit-ipo-coverage.mjs` — the `#181` pattern — with one assertion per DB constraint from (b), so a constraint being dropped or a repair reintroducing violations is caught by the existing prod audit.
4. **Gate-liveness tests — extend, don't reintroduce (finding F11).** `scraper/tests/unit/services/consolidation-percentage-gate.test.ts` (added by T-283) already implements the unmocked-gate pattern this section describes. Phase 5 (§3) adds the remaining gates (source tracking, conflict detection, field protection, IPO lock) to that existing file rather than creating a new one.

---

## 3. Migration plan

> **AMENDED 2026-08-24 by the round-2 architecture review (T-313) — see `docs/architecture/review-round2-2026-08-24.md`.**
> The five phases below are confirmed as the right five phases. **Their ORDER is amended:**
>
> 1. **Phase 3 splits, and Phase 3a goes FIRST.** Phase 3a is a *baseline ratchet*: stand up `scraper/eslint.config.mjs`, add the `no-restricted-syntax` ban on direct `ipos` writes with an explicit allowlist of the 52 files that write today, and wire scraper lint + `tsc --noEmit` into `pr-gate.yml`. It blocks nothing that exists and fails the build on the 53rd writer. Phase 3b (migrating the 52 files) stays after the gateway, as originally planned. **Reason:** the sequencing note below is correct for *migrating existing* writers and wrong for *stopping new ones* — a brand-new ungoverned live write path (`scraper/src/services/registrar-reresolve.ts:64`, #204) merged **24 minutes after this plan did**, and nothing in the repo could have caught it.
> 2. **Phase 1 is INCOMPLETE, not done.** `preResolvedIPO` is an optional parameter whose default re-resolves independently; the 6 direct `upsertIPO` callers still skip protection entirely; three other identity implementations (`IPODeduplicationService`, `DuplicateDetectionService`, the single-tier GMP match) were never in scope. It is also **not deployed** — prod serves `43b0c906`, two merged PRs behind.
> 3. **Phase 4 is re-costed and extended.** `issue_size > 0` scoped by `offering_type` needs **3 repairs, not 50** — it belongs in the cheap first batch. Add a `subscriptions` unique key (that table has *zero* DB constraints and 12 writers). And each constraint contract MUST execute its own repair rather than defer it.
> 4. **NEW Phase 0 — drain the repair ledger.** Six review rounds produced mechanisms and **zero** data repairs; every prod violation count is unchanged from the 2026-08-23 baseline. `repair-before-deploy` has no successor step, so it degrades into repair-never. Every contract that defers a repair must create the follow-up contract in the same session.
>
> Phase 2 (the gateway) and Phase 5 (flags) are unchanged in scope; Phase 2 moves to third in the order.

Five phases. Each is independently shippable, independently revertible, checker-verifiable, and sized for a single Sonnet worker contract. **Phases 1 and 2 stop the bleeding; 3–5 are cleanup and can be reordered or deferred without losing the benefit.**

Sequencing is load-bearing: the identity unification (Phase 1) must precede the gateway (Phase 2), because the gateway's protection step depends on single-source identity. The lint ban (Phase 3) must follow the gateway, or it blocks work with no sanctioned alternative *(amended above: this holds for Phase 3b, the migration; it does NOT hold for Phase 3a, the baseline ratchet, which blocks nothing)*. Constraints (Phase 4) come after the gateway so the application stops *producing* violations before the DB starts *rejecting* them — otherwise every scraper cycle throws.

Per `.claude/tasks/lessons.md` (T-281): **any phase pairing a code fix with a data repair must sequence code → deploy → verify served SHA → repair → hold one full scraper cycle → re-verify.** Phase 4 is the one that does this.

---

### Phase 1 — Unify identity resolution *(highest value, smallest change)*

**Fixes the live regression from §1.4.**

- Extract `resolveIpoRow(identity)` — **no `mode` parameter** (corrected per T-298C finding B7, §2(a)) — into `packages/shared/src/repositories/ipo-identity.ts`, containing the full current three-tier logic from `data-persister.ts:219–247`. One function, one behaviour: every caller gets the same three-tier resolution, resolved once per request.
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
- **Corrected (T-298C finding F1, BLOCKING — the original plan here would have broken the build).** The original text was "delete the five dead non-`-v2` orchestrators — they are unreachable." They are not unreachable: `scraper/src/scheduler/scheduler.ts:12-15` imports the non-v2 `nse`/`bse`/`moneycontrol`/`chittorgarh` orchestrators directly (and those, in turn, import the non-v2 `ipo-alerts-fallback-orchestrator.ts`), and each of the four calls `upsertIPO` with zero `BaseScraperOrchestrator`/protection-API references — a live protection bypass on the documented `npm run scheduler` entrypoint (see §1.3, §1.9). Corrected sequence, in this order, not "delete first":
  1. Rewire `scheduler.ts`'s four imports to the `-v2` orchestrators.
  2. Run the scraper build (`cd scraper && npx tsc --noEmit` or the workspace build) and confirm it is green with the rewired imports.
  3. Only then delete the five non-`-v2` files, and confirm the build stays green with them gone.
  4. If rewiring `scheduler.ts` turns out to be riskier than this phase's budget (e.g. scheduler-specific behaviour differences between v2 and non-v2 orchestrators that need their own investigation), the fallback is to **gate the entrypoint** instead of deleting the files: leave the non-v2 files in place, but make `npm run scheduler` fail loudly at startup if it would import them (e.g. a `§GATE`-style guard per `owner-gated-feature-flags.md`), and file the v2 migration as a separate, explicitly-scoped follow-up. State which of the two (rewire-then-delete vs. gate-the-entrypoint) the implementing worker chose, and why, in that phase's PR — this plan does not pre-decide between them because it depends on how different the v2 scheduler behaviour turns out to be, which is an implementation-time discovery, not an architecture decision.
- Remove the three write methods from `web/lib/repositories/ipo-repository.ts`; it becomes read-only.
- **Resolve the consolidation-callback design (T-298C finding B8) as part of this phase, not deferred.** The gateway lives in `packages/shared` and cannot import the consolidation engine or field-priority matrix (both in `scraper/src`) without violating `shared-package-build.md`'s import direction. Implement consolidation as an injected callback (§2(a) step 5) supplied by `scraper`-side callers; `web`-side (`ADMIN`/`REPAIR`) callers omit it. This is real design and implementation work, not plumbing — it is the reason this phase is sized larger below.

**Verifiable by:** direct `ipos` write sites in `web/lib`, `web/app`, `scraper/src` drop from 11 to 0 (gateway + shared repository excepted); protection now demonstrably applies to admin and monitor paths (integration test); scraper build stays green with `scheduler.ts` rewired and the five non-v2 files deleted (or, if gated instead, `npm run scheduler` fails loudly with the non-v2 imports intact but unreachable).
**Risk:** MEDIUM — touches live admin and scraper paths, plus the scheduler entrypoint. Mitigated by intent-scoped behaviour (admin keeps its bypass), by shipping the gateway first with `upsertIPO` as its only caller and migrating callers in reviewable batches, and by never deleting the non-v2 orchestrators before the scheduler rewire is confirmed green.
**Rollback:** per-caller. Each migration is an independent commit; revert one without reverting the gateway. The scheduler rewire is its own commit, revertible independently of the gateway.
**Hold test:** 24h — confirm admin edits still persist, scraper cycles still write, `field_sources` row count grows on create as well as update, and (if `scheduler.ts` was rewired) a scheduler-driven scrape cycle still completes.
**Size:** the largest phase, larger than originally estimated (T-298C findings B8, F1). Split into 3–4 contracts: (1) gateway + adapter + consolidation-callback design; (2) admin/service callers; (3) monitors + web-repository cleanup; (4) scheduler rewire + non-v2 orchestrator deletion, kept separate so it can be reviewed and reverted independently of the other three.

---

### Phase 3 — Enforce the gateway with lint

**Corrected scope (T-298C finding B3) — this phase cannot start with "add a lint rule."** `scraper/` has **no ESLint config at all** (no `scraper/eslint.config.*`, no `.eslintrc*`), and the root `"lint"` script (`npm run lint --workspace=web`) only lints `web/`. CI's `npm run lint` therefore polices zero of `scraper/src`, `scraper/scripts`, or root `scripts/` — exactly where most of the missed bypasses in §1.1 live. The original "1–2 contracts, mostly mechanical" sizing assumed a lint layer for `scraper/` that does not exist. Corrected phase, in order:

0. **Stand up a `scraper/eslint.config.*`** (flat config, matching the project's existing `web/eslint.config.mjs` style) and wire `scraper/`'s lint into CI as its own step (or extend root `"lint"` to run both workspaces). This is new infrastructure, not configuration of existing infrastructure — budget it as such.
1. ESLint `no-restricted-syntax` in **both** workspace configs, on `.update(ipos)` / `.insert(ipos)` / `.delete(ipos)` **and the raw-SQL/`.sql`-adjacent patterns from §1.1/§2(d)** (B1, B2), outside the sanctioned gateway + shared repository, mirroring the existing `api-client` ban in `web/eslint.config.mjs`. Document the two accepted exceptions from §2(d) (the protection module's own write, and hand-applied `_repair/`/`_gated/` SQL) directly in the ESLint config comment.
2. Give `scraper/scripts/` and `web/scripts/` a sanctioned alternative first: a `runRepair()` helper wrapping `writeIpo({ intent: 'REPAIR' })` with dry-run default, `rowCount` verification, a ledger file, and non-zero exit on any unlanded write (the T-287F lesson, made structural). Cover the DELETE story explicitly (finding B2): `runRepair()` must support a delete mode with the same ledger + non-zero-exit discipline, since `duplicate-sweep-job.ts` and `merge-duplicate-ipos.ts` currently run raw `DELETE FROM ipos` with none.
3. Migrate the **~48 files** from the corrected §1.1 inventory (not the original 24 — the raw-SQL and `.sql`-file writers count too). Historical one-shot scripts already run may be moved to `scraper/scripts/archive/` and excluded rather than migrated — decide per script; do not burn a phase migrating dead code. The **one scheduled job** in the corrected inventory (`duplicate-sweep-job.ts`) is not optional to migrate — it runs on a live cron.
4. **Do not** rely on a scraper pre-commit hook: `shared-package-build.md` documents that `scraper/` deliberately has no pre-commit type/lint gate. Enforce in CI for both workspaces so the rule is not advisory in the workspace that needs it most.

**Verifiable by:** CI fails on a deliberately-added `db.update(ipos)` (or raw `UPDATE ipos`) in a scratch file, in **either** workspace; `scraper/eslint.config.*` exists and a CI job runs it.
**Risk:** LOW-MEDIUM — mostly mechanical once the lint infrastructure exists; risk is churn and merge conflicts across ~48 files, plus standing up new CI infrastructure for a workspace that has never had it.
**Rollback:** disable the rule; the scripts still work.
**Hold test:** confirm `duplicate-sweep-job.ts`'s next scheduled run still deletes/updates correctly after migration (it is the one item in this phase with a live blast radius; everything else is build-time only).
**Size:** 2–3 contracts (up from 1–2: standing up scraper ESLint + CI is its own contract; script migration is 1–2 more given the larger file count). Standing up the lint infrastructure (step 0) cannot be deferred without losing Phase 3's benefit entirely, since nothing else in this phase can land without it.

---

### Phase 4 — Database constraints *(the last line of defence)*

**Corrected premise (T-298C findings F4, F5, BLOCKING).** The original step 0 was implicit — "the schema has zero constraints, so start adding." Production is not the schema file (§1.9, §2(b)): it already has 3 constraints the Drizzle schema doesn't know about, including a same-named-but-weaker `ipos_issue_size_positive`. Corrected sequence, one constraint at a time:

0. **Dump `pg_constraint` for `ipos` from production first**, before touching any DDL. Reconcile against the table in §2(b): confirm `ipos_issue_size_positive`, `ipos_status_check`, and `ipos_symbol_key` are still present as documented, and re-run the violation counts (they will have moved since the 2026-08-23 baseline).
1. `SELECT count(*)` violating rows in production → record in evidence, compare against §2(b)'s baseline.
2. If > 0: repair via the Phase 3 `runRepair()` helper, or narrow the predicate (as §2(b) already does for `isin`/`lot_size` by `offering_type`). Do not "fix" by weakening a real invariant. **`ipos_sme_not_fpo` has 3 live violations (finding F10) that must be repaired before this constraint lands — #180/#181 shipped the audit gate but never repaired the data it flagged; do not repeat that gap here.**
3. Author DDL in `web/drizzle/migrations/_gated/` per `drizzle-migration-gated-ddl.md`. For `issue_size_positive`: **`DROP CONSTRAINT ipos_issue_size_positive` (the existing `>= 0` version) then `ADD CONSTRAINT ipos_issue_size_gt_zero ... NOT VALID`** — reusing the old name against an already-existing constraint fails with SQLSTATE 42710. Every other constraint: `ADD CONSTRAINT ... NOT VALID` as originally planned, except `ipos_symbol_unique`, which is cut (§2(b) — already exists as `ipos_symbol_key`).
4. Owner sign-off; manual apply via the SSH tunnel; read-back verify.
5. Hold one full scraper cycle; watch for `23514`/`23505` in `scraper-out.log`. A violation here means a write path still produces bad data — **investigate, do not drop the constraint.**
6. `VALIDATE CONSTRAINT`.
7. Add the matching assertion to `scripts/audit-ipo-coverage.mjs`.

**Corrected order (T-298C finding F8) — by measured pre-repair cost, not by inspection:** `price_band_ordered` (0 violations) → `isin_unique` (0, now cheapest since it needs zero pre-repair, scoped by `offering_type`) → `lot_size_sane` (0, scoped to `offering_type='IPO'`) → `sme_not_fpo` (3 — repair first, per step 2) → `issue_size_gt_zero` (50/17% — the drop-then-add case) → ~~`symbol_unique`~~ (cut, §2(b)) → ~~`sector_not_blank`~~ (deferred, §2(b)). The original order put the two zero-cost `UNIQUE`s last "because they need the most pre-repair" — measured, they need the least; and it put `sector_not_blank` 4th as if cheap, when it is the single most expensive constraint in the set (65% of rows). Re-verify these counts at implementation time — the 301-row snapshot is from 2026-08-23 and will have moved.

**Verifiable by:** violating writes now raise a Postgres error; audit assertions pass; the `pg_constraint` dump from step 0 is archived as evidence, not just cited.
**Risk:** MEDIUM-HIGH — a constraint on live data can break the scraper cycle. Mitigated by `NOT VALID` staging, one-at-a-time application, cycle-hold verification between each, and now also by not colliding with a pre-existing constraint of the same name.
**Rollback:** `DROP CONSTRAINT` — instant, non-destructive, no data loss.
**Size:** 2 contracts — (1) `price_band_ordered` + `isin_unique` + `lot_size_sane` (all 0-violation, can land together); (2) `sme_not_fpo` repair-then-constrain + `issue_size_gt_zero` drop-then-add. `symbol_unique` and `sector_not_blank` are cut/deferred, not a third contract.

---

### Phase 5 — Flag simplification and gate-liveness tests

- Delete the three `_PERCENTAGE` flags and `shouldUseFeature`'s percentage branch; remove from `.env.example`.
- Split `FEATURE_FLAGS` into `REQUIRED_FLAGS` (throw on absent) and `OPTIONAL_FLAGS`.
- Audit the 8 unclassified flags in §2(c); delete the dead ones.
- **Extend `scripts/assert-env-keys.sh`** (§2(c)/§2(d) finding F2) so the required-flags list covers whatever Phase 5's `REQUIRED_FLAGS`/`OPTIONAL_FLAGS` split produces — **not** the config-contract test the original draft proposed (cut; it would have read `ecosystem.config.js`, the retired path). File `ENABLE_PRIMARY_SOURCE_DISCOVERY`'s prod/repo divergence (§2(c)) as an owner-open item in this phase's PR, resolved neither direction by this plan.
- Add `.claude/rules/gate-liveness-tests.md`.
- Route `validateFeatureFlags` warnings through pino.
- **Extend, don't reintroduce, gate-liveness tests (finding F11).** `scraper/tests/unit/services/consolidation-percentage-gate.test.ts` (T-283) already covers the consolidation gate unmocked. Add the remaining gates — source tracking, conflict detection, field protection, IPO lock — to that file.

**Verifiable by:** deleting a required flag's value from the Linux env makes `assert-env-keys.sh` fail the deploy (it already does for the 7 flags it lists — extend the list, verify the extension); `consolidation-percentage-gate.test.ts` gains assertions for the remaining gates and they pass unmocked.
**Risk:** LOW.
**Rollback:** revert; flags are already at effective-100 so deletion is behaviour-neutral.
**Size:** one contract.

---

### Honest estimate

| Phase | Contracts | Risk | Stops recurrence of |
|---|---|---|---|
| 1 — identity | 1 | LOW | guard/write divergence (T-287F3 class, currently live) |
| 2 — gateway | 3–4 (up from 2–3: B8 consolidation-callback design + F1 scheduler rewire) | MEDIUM | protection bypass, lineage gaps, sanitizer asymmetry, offering-type triplication |
| 3 — lint | 2–3 (up from 1–2: B3 — scraper has no ESLint/CI today, must be stood up first) | LOW-MED | *new* bypass paths being added at all, across the corrected ~48-file inventory |
| 4 — constraints | 2 (unchanged count, re-ordered by F8 measured cost; symbol_unique cut, sector_not_blank deferred) | MED-HIGH | degenerate bands, duplicates, invisible SME — **regardless of path** |
| 5 — flags + tests | 1 | LOW | silent-disable class (T-283) |

**Total: 9–11 worker contracts** (revised up from 7–9 after T-298C — the increase is entirely in Phases 2 and 3, where the original sizing missed the consolidation-callback design (B8), the scheduler rewire (F1), and the absence of scraper linting (B3); Phase 4's count is unchanged, just re-ordered and two constraints lighter).

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

**Independent review (T-298C) and this revision:**

- `evidence/2026-08-23-T-298/plan-review/REVIEW.md` — the full independent review, verdict REVISE, 17 raw findings (F1–F11, B1–B8), reproduced against repo SHA `7d957009` and a live 301-row production DB probe
- `evidence/2026-08-23-T-298/plan-review/c1-c17-*.txt` — the reviewer's 10 raw capture files (write inventory, regression/schema checks, prod constraint dump, live env flags, feasibility/lint checks, scheduler-import proof, prod entrypoint proof)
- `evidence/2026-08-23-T-298/plan-rev2/` — this revision's own self-verification: re-run greps for F1 (`scheduler.ts` imports, non-v2 `upsertIPO`/`BaseScraperOrchestrator` reference counts), B3 (absence of `scraper/eslint.config.*`, root lint scope), B8 (`packages/shared` import graph, consolidation/matrix line counts), B1/B2 (raw-SQL/`.sql` write-site sweep), F11 (`consolidation-percentage-gate.test.ts` presence) — all reproduced independently of the reviewer's own capture files, on the same branch, before being folded into §1.9/§2/§3 above
- New file:line anchors from this revision: `scraper/src/scheduler/scheduler.ts:12-15`; `scraper/src/scrapers/{nse,bse,moneycontrol,chittorgarh}-orchestrator.ts` (non-v2, each 3× `upsertIPO`, 0× `BaseScraperOrchestrator`); `web/scripts/apply-issue-size-migration.ts:19`; `scripts/assert-env-keys.sh:57-72`; `scraper/tests/unit/services/consolidation-percentage-gate.test.ts`

---

## R0 — write ratchet (T-316, shipped)

Per T-313C's amendment, R0 is a **CI grep-ratchet**, not an ESLint rule — a syntax rule cannot
match the dynamic admin route's runtime-resolved table (`(schema as any)[tableName]`), and no
lint layer reaches raw `.mjs`/`.sql` writers. `scripts/check-write-ratchet.mjs` scans `.ts`/`.mjs`/`.sql`
for four pattern classes (drizzle, repository, raw SQL, dynamic-table) and compares the matched
file set against the shrink-only allowlist `config/write-ratchet-baseline.json` (61 files at
baseline time). It runs as a blocking `pr-gate.yml` step alongside its own mutation-proof self-test
(`scripts/tests/check-write-ratchet.test.mjs`). It **covers**: every file whose file-content
matches one of the four patterns, new or existing. It **deliberately does not cover**: the 61
baselined files themselves (Phase 2's gateway is what fixes those) or child tables other than
`ipos`. To shrink the baseline after fixing a listed file, run
`node scripts/check-write-ratchet.mjs --update` and commit the regenerated JSON — the script
fails loudly if the baseline still lists a file no longer found, so a shrink can never be silently
skipped.

---

## T-339 — rollout note and prod env cleanup (2026-08-26)

T-339 finished two things this document had been describing as future work:
consolidation is no longer optional, and an identity disagreement no longer
writes. This section is the deploy-facing part: what changes on the box, what
must be removed from the env files, and what to watch after the flip.

### What actually changes in production

Measured read-only on 2026-08-26 (method and table in the task's `STATUS.md`),
**prod and staging both already ran** `ENABLE_DATA_CONSOLIDATION=true`,
`ENABLE_CONFLICT_DETECTION=true`, `ENABLE_SOURCE_TRACKING=true` and
`CONSOLIDATION_PERCENTAGE=100`. So the deleted OFF paths were already dead code
on the box.

| Change | Prod behaviour before | Prod behaviour after |
|---|---|---|
| Consolidation flags/percentages deleted | already fully ON | identical — the flags simply no longer exist |
| Consolidation *skip* no longer falls back to `upsertIPO` | a skip wrote last-writer-wins | a skip writes nothing |
| `write-path-guard` decision check | absent | a HIGH_VALUE field with no consolidation decision throws `WritePathIntegrityError` instead of being published |
| Identity key-vs-name disagreement | logged, then wrote onto the NAME row | quarantined: nothing written, P1 page, nightly FAIL after 24h |

The first row is why this is a low-risk deploy. Rows 2–4 are real behaviour
changes, and all three trade **a wrong write for no write**. Expect the
observable effect to be a small number of skipped IPOs, not a data change.

### Startup refusal (read this before deploying)

`assertConsolidationFlagsNotDisabled()` runs inside `validateFeatureFlags()`,
which `scraper/src/index.ts` already turns into a startup refusal:

- A retired key present with an **OFF/partial** value (`false`, `0`, `50`) →
  **the scraper refuses to start.** Deliberate: that value used to mean
  "bypass consolidation", and silently ignoring it would be the T-283 class
  all over again.
- A retired key present with a **fully-ON** value (`true`, `100`) → starts, and
  logs a warning naming the keys. This is exactly the state prod and staging
  are in today, which is why this deploy does not need the env edit to land
  first.

So the deploy order is: **ship the code, then clean the env.** Not the reverse.

### Prod env cleanup list — next deploy wave

These keys are inert after T-339 and should be deleted from both slots. They
live in the hand-provisioned, release-independent env files that
`scripts/deploy-linux.sh` symlinks into each release — editing a release
directory does nothing.

Files: `/var/www/ipodhan/shared/env/prod/scraper.env` and
`/var/www/ipodhan/shared/env/staging/scraper.env`.

| Key | Current value (both slots) | Action |
|---|---|---|
| `ENABLE_DATA_CONSOLIDATION` | `true` | delete |
| `ENABLE_CONFLICT_DETECTION` | `true` | delete |
| `ENABLE_SOURCE_TRACKING` | `true` | delete |
| `CONSOLIDATION_PERCENTAGE` | `100` | delete |
| `SOURCE_TRACKING_PERCENTAGE` | present per `.env.example` lineage — confirm before deleting | delete if present |
| `CONFLICT_DETECTION_PERCENTAGE` | present per `.env.example` lineage — confirm before deleting | delete if present |

Nothing else changes. The three `ENABLE_*` keys were also removed from
`SCRAPER_REQUIRED_KEYS` in `scripts/assert-env-keys.sh`, so the required-key
ratchet will not fail once they are gone — that removal had to land in the same
change, otherwise deleting the keys would trip the ratchet instead.

Rollback: re-adding the keys does nothing (the code no longer reads them), so
the env cleanup is not rollback-relevant. Rolling back the *code* is the
ordinary release rollback.

### Identity quarantine — what an operator sees

1. A scrape hits a company where the ISIN/symbol key resolves row A and the
   name resolves row B. Nothing is written for that company.
2. An unresolved `data_conflicts` row appears:
   `resolution_reason = 'QUARANTINE_IDENTITY_CONFLICT'`, `severity = 'CRITICAL'`,
   `ipo_id` = the key candidate, `value1`/`value2` = both candidate ids,
   `detected_at` = now. This reuses the T-328 HOLD state — **no new table**, so
   it does not depend on PR #233 (open, unmerged) landing.
3. A P1 page goes out through the Notifier path, deduped per candidate pair, so
   a repeatedly-scraped conflict pages once, not every 30 minutes.
4. Every later scrape of that company is refused too. That is the point, and it
   is also the cost: **the company's data is frozen until a human resolves it.**
5. The nightly detection-floor audit (`k_identity_quarantine`, registered in
   `docs/reviews/detection-checks.json`) FAILs once any quarantine is older
   than 24h — a fresh quarantine is not a failure, a forgotten one is.

To clear a quarantine: decide which row is the real company, merge/correct the
data, then resolve the `data_conflicts` row. The next scrape resolves cleanly
and writes normally.

### Honest limits

- The quarantine only covers the disagreement `resolveIpoRow` can SEE. Two rows
  that share no key and no similar name still look like two companies.
- Standalone backfill scripts call `resolveIpoRow` directly and do not catch
  the error, so a disagreement surfaces there as a thrown error for that IPO
  rather than as a recorded quarantine. That is safe (still no write) but
  noisier; wiring those scripts through `recordIdentityQuarantine` is a
  follow-up, not part of this task.
- `write-path-guard` covers HIGH_VALUE fields only. Other fields can still be
  written without an explicit decision record.
