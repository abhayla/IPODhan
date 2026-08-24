# Architecture Review — Round 2 (fresh assessment)

**Task:** T-313 (owner mandate, 2026-08-24 09:25 IST — *"perform a round of architectural review again and list all your findings"*)
**Role:** Systems Architect
**Scope reviewed:** `origin/main` @ `a3550864` **plus the two still-open round-6 PRs reviewed as if merged** — #215 (`fleet/T-311`) and #216 (`fleet/T-308`), merged into a scratch integration branch for this review. #214 (`fleet/T-306`) **merged into `main` at 09:41 IST while this review was running** and is therefore assessed as part of `main`, not as a pending PR.
**Prior art:** `docs/architecture/write-path-hardening.md` (T-298, approved after 3 review rounds). Read in full. This document **confirms its diagnosis, refutes its optimism, and re-orders its plan.**
**Prod access:** read-only only — `SELECT`s inside `BEGIN READ ONLY`, a `pg_constraint` dump, and log reads. No writes, no deploys, no merges.
**Evidence:** `D:\Abhay\GetWorkDone\evidence\2026-08-24-T-313\`
**Related:** a parallel independent review (PR #217, `docs/architecture/fable-review-2026-08-24.md`) was opened by another worker on the same mandate. This document was written without reading it, so the two are genuinely independent; the owner should read them side by side.

---

## 0. Executive summary (plain English)

The T-298 plan was right about *what is wrong*. It has not changed *what happens*.

The clearest fact in this review is a timestamp pair:

| Time (IST, 2026-08-24) | Commit | What landed |
|---|---|---|
| **04:13:20** | `d9ea401b` (#184) | The write-path hardening plan — "every write to `ipos` must go through one door" |
| **04:37:29** | `0878389e` (#204) | `scraper/src/services/registrar-reresolve.ts:64` — a brand-new raw `db.update(schema.ipos)`, wired into the live 30-minute production cycle, with no protection check, no sanitizer, no lineage, and no `rowCount` check |

**Twenty-four minutes.** The architecture review named the failure mode, and the very next merge into `main` reproduced it. That is not a discipline problem in the T-300 worker — it is proof that a plan written in a document changes nothing until it is a gate that fails a build.

Three more facts of the same shape:

1. **The write surface grew, it did not shrink.** Against T-298's own archived inventory (46 Drizzle statements in 37 files), `main` today carries **58 Drizzle statements in 41 files**, plus 21 raw-SQL statements — **79 write statements across 52 non-test files**. Four files are new; **zero are gone**. Merging both open PRs changes those totals by **nothing**.
2. **Phase 1 shipped but is not deployed. Neither is #214.** `main` is `a3550864`. Production serves `43b0c906` — **two merged PRs behind**, including Phase 1 itself. Staging is current. The exact regression T-298 §1.4 called "live right now" is **still live in production at the time of this review**.
3. **Nothing in the database was repaired.** Every violation count is identical to T-298's 2026-08-23 baseline: 3 invisible SME/FPO rows, 3 impossible date orders, 3 `issue_size = 0` IPO rows, 112 collapsed IPO price bands, 38 rows with no provenance at all, and — newly measured — **303 of 303 rows with a blank sector**. Six review rounds produced mechanisms. Zero produced repairs.

**What I would change about the plan.** The plan's five phases are the right five phases. Its **order is wrong**. It puts the enforcement layer (lint/CI — Phase 3) *after* the gateway (Phase 2), reasoning that a ban with no sanctioned alternative blocks work. That reasoning is correct for *migrating existing* writers and wrong for *stopping new ones*. A **baseline ratchet** — allow the 52 known files, fail the build on the 53rd — costs one contract, blocks nothing, and would have caught `registrar-reresolve.ts` at 04:37. It should be the next thing built, before the gateway.

**The second thing missing from the plan entirely is an owner for data repair.** Every round correctly defers repair until the protecting mechanism is deployed (`repair-before-deploy`, the T-281 lesson). Nobody drains the queue afterwards. The result is a permanently-red daily audit gate that alerts the owner every single day about the same nine rows — training the owner to ignore the alarm.

---

## 1. Inventory delta vs T-298

### 1.1 Method

Two greps, tests and journalled migrations excluded, run on `origin/main` **and** on an integration branch (main + #215 + #216):

```
git grep -nE '\.(insert|update|delete)\((schema\.)?ipos\)'          -- '*.ts' '*.mjs' '*.js'
git grep -nEi '(UPDATE +ipos|INSERT +INTO +ipos|DELETE +FROM +ipos)' -- '*.ts' '*.mjs' '*.js' '*.sql'
```

Raw output: `15-int2-drizzle.txt`, `15b-int2-rawsql.txt`, `15c-int2-files.txt` (integration) and `16-main-drizzle.txt`, `16b-main-rawsql.txt`, `16c-main-files.txt` (main).

### 1.2 The count

| Measure | T-298 (2026-08-23, its own archived inventory) | This review, `main` @ `a3550864` | This review, main + #215 + #216 |
|---|---|---|---|
| Drizzle write **statements** on `ipos` (non-test) | **46** | **58** | **58** — unchanged |
| Drizzle write **files** | **37** | **41** | **41** — unchanged |
| Raw-SQL write statements / files | (~11 files, not statement-counted) | **21 / 12** | **21 / 12** |
| **Total write statements / files** | — | **79 / 52** | **79 / 52** |
| Files calling `upsertIPO()` (protection lives in the *caller*, so a direct call is unprotected) | 12 | **12** | **7** |

T-298's headline "~57 statements / ~48 files" conflated its 46 Drizzle statements with a separate raw-SQL file list. Comparing like with like — its own `ipos-write-sites-real.txt` against today's identical grep — the Drizzle surface grew from **46 to 58 statements** and **37 to 41 files** in one day. That growth is real, not a counting artefact.

### 1.3 What the open PRs close

- **#215 (`fleet/T-311`) closes 5 protection bypasses**, and it is the only PR that closes anything structural. It rewires `scheduler.ts` onto the `-v2` orchestrators and deletes the five non-v2 files (`nse` / `bse` / `moneycontrol` / `chittorgarh` / `ipo-alerts-fallback`), each of which called `upsertIPO()` with zero `BaseScraperOrchestrator` and zero protection-API references. Verified: `16d-main-upsertipo-callers.txt` (13 files incl. the definition) vs `15d-int2-upsertipo-callers.txt` (8). This executes the plan's Phase-2 F1 item exactly as corrected — rewire, verify green, then delete — and `docs/scraper/scheduler-liveness.md` is a genuinely good per-job audit.
- **#216 (`fleet/T-308`) closes 0 write paths.** It fixes one *source* (`moneycontrol-scraper.ts` no longer writes a lone price into both band fields) and adds a widen-aware consolidation guard. Both are real fixes; neither reduces the write surface. See **P2-1** for a defect in the guard.
- **#214 (now on `main`) closed 0 write paths.** It was a correctness/carry-forward batch (date-rule reconciliation, subscription suppression tracking, the CI lint no-op fix, test coverage).

**Bypasses closed: 5 — all in #215, all `upsertIPO`-direct protection bypasses. Raw-write bypasses closed: 0. Bypasses new since T-298: 4 files (§1.4).**

### 1.4 What is NEW since T-298

Diffing T-298's archived inventory (`14-t298-drizzle-files.txt`) against today's (`17-new-drizzle-files-vs-t298.txt`):

| File | Status | Note |
|---|---|---|
| `scraper/src/services/registrar-reresolve.ts:64` | **NEW, LIVE, SCHEDULED** | Added by #204 at 04:37 on 2026-08-24, 24 min after the plan doc merged. Called every cycle from `scraper/src/index.ts:277` (`triggerRegistrarReresolve()`). Raw `db.update(schema.ipos).set({ registrarId })`. See **P1-1**. |
| `scraper/scripts/repair-field-sources-price-band-t276.ts` | NEW (one-shot repair script) | 2026-08-23. |
| `scraper/scripts/merge-atharva-polyplast-t277.ts` | NEW to the Drizzle list | Was previously counted on the raw-SQL side; matches both patterns. |
| `web/scripts/cleanup-test-data.ts` | NEW to the Drizzle list | Same. |

**No file on T-298's list has disappeared.** Nothing was migrated, archived, or deleted.

### 1.5 Classification of the 52 files

| Class | Count | Meaning |
|---|---|---|
| **Gateway** | **0** | The gateway does not exist. Phase 2 is not started. |
| **Protected persister** (`upsertIPO` reached *through* `BaseScraperOrchestrator`, which is where protection actually lives) | **1 path** | `BaseScraperOrchestrator.ts` to `upsertIPO`. The only protected write path in the system. |
| **Persister called directly, protection skipped** | **6 files** | `backfill-bse-historical.ts`, `backfill-description-sector.ts`, `backfill-stuck-listing.ts`, `force-nse-scrape.ts`, `ingest-historical-ipo.ts`, `test-nse-transform.ts`. Several announce in their own header comments that they route "via upsertIPO (write-path SSOT)" for safety. They do not get protection. |
| **Raw bypass** | **45 files** | Direct Drizzle or raw SQL. Includes three that run in production: `registrar-reresolve.ts` (every cycle), `duplicate-sweep-job.ts` (raw `UPDATE`+`DELETE`, wired dry-run-only by #215), and four `web/app/api/admin/` routes. |

### 1.6 Child tables (in scope of this review, out of scope of the plan)

| Table | Write statements | Write files | CHECK/UNIQUE constraints live in prod |
|---|---|---|---|
| `subscriptions` | 14 | 12 | **none** |
| `documents` | 14 | 6 | `unique_url`, `unique_doc_per_ipo` |
| `gmp_records` | 7 | 4 | `uq_gmp_records_ipo_ts_source` |
| `registrars` | 5 | 5 | none |
| `ipo_details` | 2 | 2 | `issue_type` CHECK, `isin` UNIQUE, `ipo_id` UNIQUE — **and 0 rows** |
| `listing_performance` / `financial_data` | 1 each | 1 each | `ipo_id` UNIQUE (+2 promoter-holding CHECKs) |

Evidence: `07-child-constraints.txt`, `08-child-writes.txt`, `12-band-scope.txt`.

---

## 2. Findings

Ranked by what a defect costs the reader of ipodhan.com, then by how structural the cause is.

### P1-1 — A new ungoverned live write path merged 24 minutes after the plan that forbids them

**Mechanism.** `scraper/src/services/registrar-reresolve.ts:64` runs `await db.update(schema.ipos).set({ registrarId }).where(eq(schema.ipos.id, row.id))` — a direct Drizzle write with no identity resolution, no IPO-lock check, no `filterProtectedFields`, no `sanitizeIpoWriteFields`, and no `field_sources` lineage. It is invoked from `scraper/src/index.ts:277` on **every** 30-minute production cycle.

**Second defect in the same 20 lines:** the `db.update(...)` result is discarded and `written++` is incremented unconditionally (`registrar-reresolve.ts:64-70`, captured verbatim in `20-code-claims.txt`). The log line `[registrar-reresolve] registrar_id backfilled` and the returned `written` count are emitted even if zero rows changed. This is the **exact T-287F silent-rowCount lesson**, re-committed after it was written down.

**Defect-corpus class.** Round-5/6 recurrence of the classes T-298 §1.7 names as *repair bypasses protection* and *silent rowCount*.

**Timeline (`git log`):** `d9ea401b` (#184, the plan) at `2026-08-24 04:13:20 +0530`; `0878389e` (#204, this write path) at `2026-08-24 04:37:29 +0530`.

**Why it matters more than the individual bug.** Nothing in the repository could have stopped this. There is no lint rule, no CI check, and no review step that mechanically asks "is this a new `ipos` write?". The plan document was, at that moment, the only defence — and a document loses to a worker under a turn budget every time.

**Minimal fix.** (a) Route this write through the protection helpers `BaseScraperOrchestrator` already calls, and check `rowCount`. (b) The structural fix is **P2-5's ratchet**, which is the real answer.

### P1-2 — Phase 1 unified identity for the guarded path only; the guarantee is still a convention

**Mechanism.** The new parameter on `upsertIPO` is **optional** (`scraper/src/services/data-persister.ts:196-209`):

```ts
export async function upsertIPO(
  ipoRepository, scrapedIPO, source = "NSE",
  preResolvedIPO?: IPO | null        // undefined (the default) means "resolve it here, as before"
)
```

`BaseScraperOrchestrator.ts` and `data-consolidation-orchestrator.ts` thread the resolved row correctly — I verified this and it is well done. But the **6 files in §1.5 that call `upsertIPO` directly pass nothing**, so they re-resolve independently *and* skip protection entirely.

**This is finding B7 from the T-298 independent review, in a new costume.** B7 said: never let two call sites choose independently; resolve once per request and pass it down. An optional parameter whose default is "resolve independently" is precisely a call-site choice. The plan's claim that Phase 1 makes divergence "structurally impossible" holds for one path, not for the system.

**Also unchanged:** a grep for `isIPOLocked|filterProtectedFields|isFieldProtected|fieldProtectionService` returns **0** hits in `data-persister.ts` and **5** in `BaseScraperOrchestrator.ts` (`20-code-claims.txt`). The documented "single write entry point" still does not gate. `data-persister.ts` is now **1,250 lines**, up from the 1,224 T-298 recorded — the god function is growing, not shrinking.

**Concrete failure.** An admin locks the price band on an IPO. `scraper/src/scripts/backfill-description-sector.ts` calls `upsertIPO(...)` with three arguments. No lock check runs. The locked field is overwritten. No error, no warning.

**Minimal fix.** Make `preResolvedIPO` required, and move the lock + `filterProtectedFields` calls from `BaseScraperOrchestrator` **into** `upsertIPO`. That is a smaller change than the full gateway and delivers most of the gateway protection benefit.

### P1-3 — Production is two merged PRs behind, including Phase 1 itself

`main` = `a3550864` (#214). **Production serves `43b0c906`** — `https://ipodhan.com/api/version` returns sha `43b0c906`, builtAt `2026-08-23T23:50:29Z`, matching `/var/www/ipodhan/DEPLOYED_SHA-prod`. **Staging serves `a3550864`** (`19-served-sha-and-flags.txt`).

Undeployed on prod right now: **#210 (Phase 1 — unified identity)** and **#214 (date-rule reconciliation, subscription suppression alerting, the CI lint fix)**.

The deploy design is deliberate and good — `deploy-linux.yml` hard-guarantees that a push to main deploys **staging only**, and prod requires a human `workflow_dispatch`. The gap is not the mechanism; it is that **no contract in the round-6 wave owns pressing the button.** Consequence: the live regression T-298 §1.4 describes — a mistyped company name causing the protection guard to miss the row the write hits — is still shipping to real users, and the two-day-old date fixes are not protecting anyone.

### P1-4 — Six review rounds produced mechanisms and zero data repairs

Read-only prod probe, 2026-08-24 (`11-prod-audit-gate.txt`, `12-band-scope.txt`, `18-reconcile-counts.txt`):

| Invariant | Violating rows | vs T-298 baseline (2026-08-23) |
|---|---|---|
| SME segment carrying offering_type FPO (invisible SME) | **3** — shipwaves-online-ltd, western-overseas-study-abroad-ltd, stanbik-agro-ltd | unchanged; the audit gate for this shipped in #181 |
| Impossible date ordering | **3** — Sunshine Pictures, Shankesh Jewellers, Happy Steels | unchanged (named rows deferred by #214) |
| `issue_size = 0`, scoped to offering_type IPO | **3** — Complete Sports & Management India, Rays of Belief, Priority Jewels | unchanged |
| Degenerate price band, offering_type IPO | **112** (146 unscoped) | unchanged; repair plan written by #216, not executed |
| `ipos` rows with **no** `field_sources` row at all | **38 / 303** (12.5%) | not previously measured; `ENABLE_SOURCE_TRACKING` is on in prod |
| Blank `sector` (NULL or empty string) | **303 / 303 = 100%** (107 NULL + 196 empty-string) | not previously measured this way |
| `price_range_min` greater than `price_range_max` | 0 | unchanged |
| duplicate ISINs | 0 | unchanged |

Every round follows the `repair-before-deploy` rule correctly and writes a careful ledger (`evidence/2026-08-24-T-306/POST-DEPLOY-REPAIRS.md`, `evidence/2026-08-24-T-308/REPAIR-PLAN.md`). Both ledgers hand the work to "the deploy wave" — **an actor that does not exist as a contract, a queue item, or a named owner.** The ledger only grows.

**Two sub-findings worth naming separately.** (a) `sector` is blank on **every row in the table**, in *two different representations* (NULL and empty-string) — so any "sector is populated" check has to handle both, and the site cannot offer sector filtering at all. (b) The `UPCOMING` stage — the rows a user most needs before deciding — scores **0.0% completeness (0 of 15 required fields across 3 rows)**, against `LISTED` at 79.8% (`11-prod-audit-gate.txt`). Completeness is inverted with respect to reader value.

**Minimal fix.** Every contract that defers a repair MUST create the follow-up contract in the same session, with the named rows and the verification query. A deferral without a successor is a silent drop.

### P1-5 — Four divergent identity implementations are live; Phase 1 unified three call sites of six

| Implementation | Tiers | Used by | Unified by Phase 1? |
|---|---|---|---|
| `resolveIpoRow` (`packages/shared/src/repositories/ipo-identity.ts:44`) | normalized-name, slug, fuzzy 0.85 | `data-persister`, `BaseScraperOrchestrator`, `data-consolidation-orchestrator` | **yes** |
| `IPODeduplicationService` (`scraper/src/services/ipo-deduplication.ts:106,119,168,191`) | slug, normalized, substring-fuzzy, **Levenshtein 0.75** | `exchange-monitor.ts:90`, `sebi-monitor.ts:79` — both of which **insert into `ipos`** | no |
| `DuplicateDetectionService` (`scraper/src/services/duplicate-detection-service.ts:57`) | symbol, ISIN, fuzzy name, date overlap | `data-validation-pipeline.ts:109` | no |
| GMP matching (`scraper/src/scrapers/investorgain-gmp-orchestrator-v2.ts:335`) | **single-tier** `findByNormalizedName`, then date match | the live GMP write path | no |

The Levenshtein-0.75 tier is materially looser than the 0.85 fuzzy threshold in `resolveIpoRow` — two services can reach opposite conclusions about whether the same scraped company is a new row. The GMP path is materially *tighter* (one tier), which is a plausible contributor to GMP coverage sitting at **71.4%** (`11-prod-audit-gate.txt`).

**Minimal fix.** Fold all four onto `resolveIpoRow`. The Phase 1 gate — "the count of `findByNormalizedName` call sites drops from 3 to 1" — was too narrow: it counted call sites of one helper, not implementations of one concept.

---

### P2-1 — The FIXED_PRICE exemption in #216 is a decorative guard, and its failure direction is force-overwrite

`data-consolidation-service.ts:163` and `:216` both read:

```ts
if (incomingData.issueType === "FIXED_PRICE" || existingData?.issueType === "FIXED_PRICE") return empty;
```

`issueType` is **not a column on `ipos`** — it lives only on `ipo_details` (`packages/shared/src/db/schema.ts:834,844`), and `incomingData` / `existingData` are `ipos`-shaped payloads. `ipo_details` has **0 rows in production** (`12-band-scope.txt`), and no scraper writes `issueType`. The condition is structurally always false.

**Why the compiler did not catch it:** both parameters are typed `Record<string, any>` (`data-consolidation-service.ts:146,202`). An untyped payload record defeats TypeScript on precisely the guard where type safety would have paid for itself.

The #216 PR body honestly discloses the exemption is "currently a no-op", but frames the consequence as *over-flagging in the audit gate*. The more serious consequence is on the **write** side: for a genuinely fixed-price issue whose stored min equals max correctly, any incoming range from any source will **force-win regardless of source priority**, because the only thing that would have stopped it cannot evaluate true. The blast radius is small today (fixed-price issues are rare and rarely receive a range), but this is a guard that reads as protection and provides none.

**Minimal fix.** Either populate `ipo_details.issue_type` end-to-end (larger scope, correctly deferred by #216), or delete the branch and say so. A guard that cannot fire is worse than no guard, because the next reader believes the case is handled. Typing the payload as the `ipos` insert shape would make this a compile error.

### P2-2 — RESOLVED during this review: the #214 / #215 file-set conflict

Earlier in this review, merging `fleet/T-306` (#214) then `fleet/T-311` (#215) produced a real modify/delete conflict on `nse-scraper-orchestrator.ts` and `bse-scraper-orchestrator.ts` — #214 modified them, #215 deletes them. **This is now resolved:** #214 merged to `main`, and `fleet/T-311` merged `main` back in (`01e05d74`, "T-311F2 — merge main conflict"), so main + #215 + #216 merges clean today.

I verified the substantive worry behind it: the subscription-suppression tracking #214 added lives in **`data-persister.ts:649` (`createSubscriptionSnapshot`)**, not in the orchestrators, so deleting the non-v2 files does not drop it (`22-code-claims3.txt`). No action needed.

**The signal is still worth recording:** three parallel round-6 contracts were scoped without a shared view of the file set, and it took a merge to discover it. Overlapping file sets should be checked at *dispatch* time, not at merge time.

### P2-3 — The daily data-integrity alert contradicts itself and fires every day for the same nine rows

From `/root/data-audit-ipodhan/state/run-2026-08-24.log` (captured as `13-daily-audit-cron-log.txt`):

```
line 110: === §7 GATE ===
line 113:   [FAIL] pollution.invisibleSme==0 (3 ...)
line 118:   [FAIL] Date ordering ...                 violations: 3
line 124:   [FAIL] issue_size > 0                    violations: 3
line 155:   GATE: FAIL (3 hard check(s))
...
line 195: === 33/33 passed, 0 failed ===
line 196: === exit code: 1 ===
```

The cron script mails the **last 1,200 characters** of that log as the alert body (`scripts/vps-data-audit-cron.sh`), so the owner notification literally reads *"33/33 passed, 0 failed"* immediately followed by *"exit code: 1"*. The summary counter is computed over the `audit-prod` check set and does not include the gate failures — a textbook shape-versus-substance log lie, of exactly the class this project's own `output-plausibility-verification.md` rule forbids.

Two aggravations in the same file: `[PASS] data-pipeline metrics reachable — fieldCompleteness=0.7%` — a 0.7% completeness figure passing a check named "reachable" is a threshold measuring the wrong thing; and the alert dedupe key is `data-audit-<date>`, so a permanently-red gate produces a **new P2 alert every single day** for nine rows nobody is assigned to fix. That is how an alerting channel gets muted.

### P2-4 — `subscriptions`, the most time-sensitive number on the site, has zero database constraints and 12 writers

`pg_constraint` for `subscriptions` returns nothing (`07-child-constraints.txt`): no UNIQUE on `(ipo_id, timestamp)` or `(ipo_id, category, timestamp)`, no CHECK that a multiple is non-negative. Twelve non-test files write it. Live coverage is `[WARN] subscriptions 12/19 63.2%`.

T-298 §2(a) declared child tables a non-goal on YAGNI grounds *and* named the T-250 subscription outage as the counter-example it was arguing against. That scope call is defensible; a table with no constraints, no unique key, twelve writers and 63% coverage is not "safe by omission". At minimum it should get the same Phase-4 treatment as `ipos`.

### P2-5 — There is still no lint or type-check gate for the `scraper` workspace, so Layer 3 cannot exist where the bypasses live

- `scraper/eslint.config.*` and `scraper/.eslintrc*` — **do not exist** (verified, `21-code-claims2.txt`).
- Root `lint` script is `npm run lint --workspace=web` — web only.
- `.github/workflows/pr-gate.yml` runs, on every PR: web `lint:ci`, web `tsc --noEmit`, web unit tests, and the **full scraper unit suite**. It does **not** run `tsc --noEmit` for `scraper`, and cannot run lint for `scraper` because there is no config.

Consequences: (a) a type error introduced in `scraper/src` is caught by no automatic gate; (b) the whole Layer-3 story in the plan — "you cannot write code that bypasses the gateway" — has no substrate in the workspace holding 30 of the 52 write files. The CI lint fix in #214 (the web `lint` script was a bare `eslint`, matching 0 files under flat config — a real and well-found bug) is now on `main` and fixes the *web* half only.

Also worth stating plainly: the `pr-gate.yml` header notes that required status checks are unavailable on this plan, so **the gate is advisory** — a PR can be merged with `pr-gate` red. The honesty in the workflow is good; the exposure is real.

### P2-6 — The liveness audit in #215 stopped at the `scheduler/` directory; two unscheduled `ipos` writers sit outside it

`docs/scraper/scheduler-liveness.md` is a genuinely good artifact — every job in `scraper/src/scheduler/*` audited with a WIRE/RETIRE decision and a reason. But the D9 "written but never scheduled" class is not confined to that directory:

- `scraper/src/services/exchange-monitor.ts` — inserts into `ipos`, uses `IPODeduplicationService`, **zero non-test importers**.
- `scraper/src/services/sebi-monitor.ts` — same shape, **zero non-test importers**.

Both export `runExchangeMonitor()` / `runSEBIMonitor()` entrypoints. They are dead today, and they are `ipos` insert paths with a different dedup implementation (**P1-5**) that will be silently wrong the day someone wires them. The word "scheduler" in the audit scope let them through: neither file is mentioned anywhere in `scheduler-liveness.md` (`22-code-claims3.txt`).

### P2-7 — Two percentage flags remain defined, defaulted to 0, absent from prod, and read by nothing

The live prod env (`/var/www/ipodhan/shared/env/prod/scraper.env`) contains 8 keys: `CONSOLIDATION_PERCENTAGE` plus 7 `ENABLE_*` (`19-served-sha-and-flags.txt`). `ENABLE_PRIMARY_SOURCE_DISCOVERY` — the T-298 open item — is present, and #215 gives it a real consumer. Both good, both closed.

Still open: `SOURCE_TRACKING_PERCENTAGE` and `CONFLICT_DETECTION_PERCENTAGE` are defined in `scraper/src/config/feature-flags.ts:138,144`, default to `0`, are documented as `100` in `.env.example`, are **absent from the prod env**, and are read by **no code** — a grep for `shouldUseFeature(` outside `feature-flags.ts` returns exactly one hit, for `CONSOLIDATION_PERCENTAGE` (`data-consolidation-service.ts:259`). Phase 5 has not started. This is exactly the decoy-config shape that made T-283 take three tasks to diagnose.

### P2-8 — The Phase-4 cost ordering is wrong for `issue_size`, for the same reason it already corrected `isin` and `lot_size`

The plan records `issue_size_positive (>0)` at **50 violations (17%)** and re-orders it late on that basis. Scoped by `offering_type` — which the plan already does for `isin` and `lot_size`, and must do here too, because a TENDER or BUYBACK row legitimately has no issue size (`12-band-scope.txt`):

```
OFS 19 | TENDER 16 | RIGHTS 6 | NCD 5 | BUYBACK 1  ->  47 non-IPO rows
IPO 3                                              ->   3 rows to repair
```

A CHECK of the form `offering_type <> 'IPO' OR issue_size IS NULL OR issue_size > 0` needs **3 repairs, not 50**, and belongs in the cheap first batch.

The same scoping instinct does **not** rescue `sector_not_blank`: scoped or unscoped, it is 100% of the table (**P1-4**). That one is a genuine backlog item, not a constraint candidate.

---

### P3 findings

- **P3-1 — No whole-cycle timeout.** `scraper/src/index.ts` awaits 5 scrapers and 7 post-triggers serially with no cycle-level `Promise.race` / `AbortController` (individual fetches have their own timeouts). The PM2 `cron_restart: */30` will kill and restart a hung cycle, silently dropping every downstream trigger. Measured today: about 156 s per cycle, 12 `scraper_logs` rows/hour = 6 sources x 2 cycles — healthy, with roughly 11x headroom (`10-prod-run-health.txt`). A latent risk, not a current fault; a single Puppeteer hang converts it into a live one. A cycle-level budget with a logged timeout would make the failure visible instead of invisible.
- **P3-2 — Two `IPORepository` implementations remain.** `packages/shared/src/repositories/ipo-repository.ts` (905 lines) and `web/lib/repositories/ipo-repository.ts` (1,850 lines), with 34 non-test web importers of the second. Unchanged since T-298. Phase 2 not started.
- **P3-3 — `ipo_details` has 0 rows** while the schema, the widen guard in #216, and the new audit check in #216 all read it. A table that exists, is joined, and is empty reads as "populated" to the next developer. This is the root cause of **P2-1**.
- **P3-4 — 38 of 303 `ipos` rows have no `field_sources` row at all**, with source tracking on in prod. Lineage-on-create was the T-292 P3-11 fix; 12.5% of the table predates or escapes it. Worth one query to establish whether these are all pre-fix rows before assuming so.
- **P3-5 — Stale comment in `packages/shared/src/repositories/gmp-repository.ts:117-123`** says the `onConflictDoNothing` has "no conflict target" pending a gated migration; `uq_gmp_records_ipo_ts_source` is live in prod today (`07-child-constraints.txt`). Behaviour is now correct; the comment describes the old world.
- **P3-6 — The optional-safety-parameter pattern recurs.** `createSubscriptionSnapshot(repo, ipoId, data, options = {})` (`data-persister.ts:614`) reads `options.redis` for the new suppression-streak alert. `BaseScraperOrchestrator.ts:541` passes it; `scraper/src/scripts/backfill-subscription.ts:49` calls with three arguments, so `recordSuppressionOutcome` silently no-ops (`subscription-coverage-registry.ts:175` returns early when the store is absent). The production path is correct today — but this is **the exact shape of P1-2**, shipped again in the same wave, in a different function. Safety mechanisms should not be opt-in parameters.

---

## 3. What is GOOD (and must not be traded away)

This is a well-operated system with one structural hole, not a bad system.

- **The deploy pipeline is the strongest thing in this repo.** `scripts/deploy-linux.sh` plus `deploy-linux.yml`: slot-isolated releases (`releases/` vs `releases-staging/`), `DEPLOYED_SHA-prod` / `-staging` marker files, an `/api/version` served-SHA endpoint that actually reflects reality, `assert-migrations-applied.sh` failing the deploy on journal drift, auto-rollback with an explicit delete-then-start sequence (never `reload`) that has its own dry-run regression coverage, `pm2 save` after the flip, and a trap that resumes the scraper on **every** exit path. The hard guarantee that a push to main can only ever deploy staging is exactly the right default.
- **Staging is real.** Its own database (`ipodhan_staging`), its own PM2 apps, its own scraper actually running the write path every 30 minutes, and it is currently *ahead* of prod. Most projects claim this and have a symlink.
- **`pr-gate.yml` runs the FULL scraper unit suite on every PR** (about 1,150 tests, no failure allowlist) plus web lint, type-check and unit tests — after T-301 repaired the 44-test baseline that previously made a full gate impossible. Deliberately scoped to the unit tier with a documented reason. Fast, honest, always-on.
- **`docs/scraper/scheduler-liveness.md` (#215)** is the model for how a liveness audit should read: every job, a decision, a reason, and explicit DEFERRED entries with the reason — including refusing to wire `dailySummary` because its report body is hardcoded zeros and shipping it would be a log lie. That is the right instinct, applied unprompted.
- **The mutation proofs in #216.** Both mechanisms were proven by disabling the fix and watching the test go red, then restoring. That is the standard the whole suite should meet.
- **The catch-up cadence in #215** (`scraper/src/scheduler/catch-up-cadence.ts`) replaces wall-clock windows with last-run tracking, so a missed cycle self-heals next cycle instead of waiting 24 h. Small, correct, the right generalisation.
- **The suppression-streak alert in #214** (`subscription-coverage-registry.ts:169-200`) does the hard thing: it makes a *suppression* — a silent non-write — visible to the owner after N consecutive cycles, with the manual un-stick procedure documented inline. Most projects never instrument the "we correctly did nothing, forever" case.
- **The `_gated/` and `_repair/` migration discipline**, the `repair-before-deploy` sequencing rule, and an audit gate whose checks map to issue numbers.
- **Notifier alerting is wired** (11 emitters, P0/P1/P2, dedupe keys, fail-open) and the freshness heartbeat runs every 30 min from cron.
- **The fleet review process itself.** Six rounds with independent checkers and archived evidence is why this document can cite file:line and a timestamp pair instead of an opinion.

---

## 4. Plan judgment — `docs/architecture/write-path-hardening.md`

**Verdict: the plan stands in substance and is REORDERED in priority.** Its diagnosis is confirmed by everything in §2. Its five phases are the right five phases. Two things change.

### 4.1 Per-phase judgment

| Phase | Verdict | Reason |
|---|---|---|
| **1 — Unify identity** | **RE-SCOPE (declare incomplete) + DEPLOY** | Correctly implemented for the guarded path. But `preResolvedIPO` is optional with a resolve-independently default (**P1-2**), three other identity implementations were never in scope (**P1-5**), and it is **not deployed** (**P1-3**). Phase 1 is roughly 40% done, not done. |
| **2 — Write gateway** | **KEEP, but move to third** | Still the correct structural fix and still the largest phase. The consolidation-callback design (B8) and the two-repository problem (**P3-2**) are both untouched and both real. It should not be next, because it does not stop *new* bypasses arriving while it is being built — and one arrived in 24 minutes. |
| **3 — Lint enforcement** | **RE-ORDER to FIRST, RE-SCOPE to a baseline ratchet** | The plan reasons that lint must follow the gateway because a ban with no sanctioned alternative blocks work. That is correct for *migrating the 52 existing files* and wrong for *stopping the 53rd*. Split it: **3a — baseline ratchet** (stand up `scraper/eslint.config.mjs`, add the ban with an explicit allowlist of today's 52 files, wire scraper lint plus `tsc --noEmit` into `pr-gate.yml`) blocks nothing that exists and fails the build on anything new. **3b — migrate the 52 files** stays after the gateway, exactly as planned. 3a is one contract and is the single highest-leverage item in the whole plan. |
| **4 — DB constraints** | **KEEP, RE-COST, EXTEND** | Re-cost `issue_size` by `offering_type` (3 rows, not 50 — **P2-8**) and move it into the cheap first batch. Add the `subscriptions` unique key (**P2-4**). Most importantly: **each constraint contract must execute its own repair**, not defer it (**P1-4**). The plan already says "repair the 3 SME/FPO rows before this lands — do not repeat the #180/#181 gap." That gap has now been repeated for two more days. |
| **5 — Flags + gate-liveness tests** | **KEEP as-is, lowest priority** | Genuinely low value now that `CONSOLIDATION_PERCENTAGE` is live in prod. The two dead percentage flags (**P2-7**) are a diagnosis hazard, not an outage risk. |
| **NEW — Phase 0: drain the repair ledger** | **ADD** | The plan has no step that converts a deferred repair into a completed one. Six review rounds and two ledgers later, the prod violation counts have not moved a single row (**P1-4**). Without an owner, `repair-before-deploy` degrades into repair-never. |

### 4.2 The one thing the plan gets structurally wrong

The plan §0 says: *"After this, adding a new write path that skips the rules is a build failure (lint), a test failure (gate-liveness), or a database error (constraint)."* All three enforcement layers are scheduled **after** the gateway. Between the plan merging and the gateway existing — a window the plan itself sizes at 3–4 contracts — there is **no enforcement at all**. That window opened at 04:13 and produced a new live bypass at 04:37.

Enforcement should never trail the thing it enforces when a cheap partial form exists. A baseline ratchet is that cheap partial form.

---

## 5. Next 3 contracts (priority order, sized for a Sonnet worker)

### C1 — Write-site ratchet: stand up scraper lint + CI, ban new `ipos` writes against a frozen allowlist

**Scope.** (1) Create `scraper/eslint.config.mjs` (flat config, mirroring `web/eslint.config.mjs`). (2) Add a `no-restricted-syntax` rule in **both** workspace configs banning `.insert(ipos)` / `.update(ipos)` / `.delete(ipos)` and the raw-SQL string patterns for UPDATE / INSERT INTO / DELETE FROM on `ipos`. (3) Seed an explicit, checked-in allowlist containing exactly the 52 files in `evidence/2026-08-24-T-313/15c-int2-files.txt` — no migrations, no refactors, nothing blocked. (4) Add scraper lint and scraper `tsc --noEmit` as steps in `.github/workflows/pr-gate.yml`. (5) Document the two permanent exceptions (the protection module's own write in `packages/shared/src/admin/field-protection-checker.ts`, and hand-applied `_repair/` / `_gated/` SQL).

**Verifiable gate.** Adding a `db.update(schema.ipos)` call to a new scratch file under `scraper/src/` turns `pr-gate` **RED**; removing it turns it green. Adding it to a file already on the allowlist does not. `scraper/eslint.config.mjs` exists and `pr-gate` has a step that runs it.

**Hold-test signal.** None needed — build-time only, zero runtime blast radius. Confirm the next 3 PRs into main still pass `pr-gate` unchanged (proves the allowlist is complete and the ratchet is not blocking legitimate work).

**Why first.** One contract, blocks no existing work, and it is the only proposed item that would have caught **P1-1**.

### C2 — Complete Phase 1: make identity resolution and protection non-optional, then deploy

**Scope.** (1) Make `preResolvedIPO` a **required** parameter of `upsertIPO`. (2) Move the IPO-lock check and `filterProtectedFields` from `BaseScraperOrchestrator` **into** `upsertIPO`, so the documented gateway actually gates. (3) Update the 6 direct callers in §1.5 to resolve identity via `resolveIpoRow` and pass it. (4) Fold `IPODeduplicationService`, `DuplicateDetectionService`, and the single-tier GMP match onto `resolveIpoRow` (**P1-5**) — or, where a different threshold is genuinely intended, document the reason inside the shared module rather than in a fourth implementation. (5) Fix `registrar-reresolve.ts:64` to route through the protected path and check `rowCount` (**P1-1**). (6) Make the `redis` option of `createSubscriptionSnapshot` non-optional, or supply it at every call site (**P3-6**).

**Verifiable gate.** A grep for the protection helpers in `scraper/src/services/data-persister.ts` returns more than 0 hits. A test that calls `upsertIPO` from a script-shaped caller against a locked IPO **fails** to overwrite the locked field — red before the change, green after. The count of `findByNormalizedName` implementations in `scraper/src` is 1.

**Hold-test signal.** Deploy to prod, then hold **2 full 30-minute cycles** and confirm: IPOs-updated per cycle stays within plus-or-minus 20% of the pre-deploy baseline (a collapse means over-matching; a jump means under-matching), and the count of protection-blocked-write log lines is **non-zero and stable** (zero would mean the guard stopped resolving rows).

### C3 — Deploy the backlog, drain the repair ledger, then land the first three DB constraints

**Scope, in this exact order (the T-281 lesson).** (1) Deploy current `main` to prod — #210 and #214 are both undeployed (**P1-3**), and the Phase-1 mechanism must be live before its data is touched. (2) Repair the 9 named rows: 3 date-ordering (`sunshine-pictures-ltd`, `shankesh-jewellers-ltd`, `happy-steels-ltd`), 3 zero-issue-size IPO rows (`rays-of-belief-ltd`, `complete-sports-and-management-india-ltd`, `priority-jewels-ltd`), 3 SME/FPO rows (`shipwaves-online-ltd`, `western-overseas-study-abroad-ltd`, `stanbik-agro-ltd`) — all listed in `evidence/2026-08-24-T-306/POST-DEPLOY-REPAIRS.md` and re-confirmed live in `11-prod-audit-gate.txt`. (3) Then add, via `_gated/`, one at a time with a read-back: price-band ordering (0 violations), SME-not-FPO (0 after step 2), and issue-size-positive scoped to offering_type IPO (0 after step 2). (4) Fix the contradictory summary line in the audit cron (**P2-3**) so the alert body cannot say "33/33 passed" while exiting 1.

**Verifiable gate.** `npm run audit:coverage` (the `--gate` path) **exits 0** against prod, and stays 0 for **2 consecutive nightly cron runs** — the first green daily audit this project has had.

**Hold-test signal.** One full scraper cycle after each constraint lands, watching `scraper-out.log` for SQLSTATE 23514 / 23505. A violation means a write path still produces bad data — **investigate it, do not drop the constraint.**

*(The 112 degenerate IPO price bands from #216 are deliberately NOT in this contract — 59 of them are externally corroborated and have their own repair plan in `evidence/2026-08-24-T-308/REPAIR-PLAN.md`, and that repair must follow the #216 deploy. It is the natural fourth contract. The 100%-blank `sector` column is the natural fifth.)*

---

## Appendix — evidence

All under `D:\Abhay\GetWorkDone\evidence\2026-08-24-T-313\`:

| File | Contents |
|---|---|
| `01-...` / `02-...` / `03-...` / `04-...` | first-pass write inventories (pre-#214-merge `main`); superseded by `15` / `16`, content identical |
| `05-upsertipo-callers-main.txt` / `-integration.txt` | the 5 bypasses #215 closes |
| `06-prod-violation-counts.txt` | first read-only invariant sweep |
| `07-child-constraints.txt` | `pg_constraint` for 8 child tables |
| `08-child-writes.txt` | child-table write statements |
| `09-mocked-gate-tests.txt` | tests stubbing `shouldUseFeature` |
| `10-prod-run-health.txt` | cycle cadence, PM2 cron config, `scraper_logs` histogram |
| `11-prod-audit-gate.txt` | the §7 gate section of today's prod audit run (named violating rows, stage completeness, coverage) |
| `12-band-scope.txt` | degenerate bands and zero issue-size **by `offering_type`**; `ipo_details` row count = 0 |
| `13-daily-audit-cron-log.txt` | full daily audit cron log — the "33/33 passed" versus "exit code: 1" contradiction |
| `14-t298-drizzle-files.txt` | the T-298 archived inventory (46 statements / 37 files), for the delta in §1.2 and §1.4 |
| `15-...` / `15b` / `15c` / `15d` | write inventory and `upsertIPO` callers on **main + #215 + #216** |
| `16-...` / `16b` / `16c` / `16d` | the same sweep on **`origin/main` @ `a3550864`** |
| `17-new-drizzle-files-vs-t298.txt` | the 4 new write files, and the empty gone-list |
| `18-reconcile-counts.txt` | total rows, `sector` NULL versus empty-string, missing `field_sources`, degenerate bands |
| `19-served-sha-and-flags.txt` | `/api/version`, `DEPLOYED_SHA-prod` / `-staging`, prod scraper env keys |
| `20-code-claims.txt` / `21-code-claims2.txt` / `22-code-claims3.txt` | verbatim source extracts backing P1-1, P1-2, P2-1, P2-5, P2-6, P2-7, P3-2, P3-5 |

**`ipos` constraints live in production (2026-08-24, read-only dump) — unchanged since T-298:**

```
ipos_issue_size_positive            CHECK (issue_size >= 0)
ipos_status_check                   CHECK (status = ANY (...))
ipos_symbol_key                     UNIQUE (symbol)
ipos_slug_unique                    UNIQUE (slug)
ipos_pkey                           PRIMARY KEY (id)
ipos_registrar_id_registrars_id_fk  FOREIGN KEY
```

**Method limitations, stated honestly.**

1. I did not re-run the test suites on the integration branch — the review worktree has no `node_modules`, and creating one via a directory junction is a known hazard in this repo (the worktree-removal incident of 2026-08-24). Each PR documents its own suite runs; I verified their *claims* against the code, not by re-execution.
2. All production access was read-only: SELECTs inside a read-only transaction, a `pg_constraint` dump, and log reads. Nothing was written, deployed, or merged.
3. The 52-file inventory is grep-based on two patterns. A write reaching `ipos` through a dynamically-constructed table name, or through an ORM helper not matching those patterns, would be missed. **The count is a floor, not a ceiling.**
4. `main` moved under this review (#214 merged at 09:41 IST). All counts in §1 were re-measured on `a3550864` after that merge; the pre-merge sweeps are retained as `01`–`04` for audit.
