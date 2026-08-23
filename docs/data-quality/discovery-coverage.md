# Discovery coverage — why every review round finds issues the last round missed

**Task:** T-297 (owner directive, 2026-08-23). **Status:** analysis + gap-closure.
**Scope:** every finding from review rounds 1–4 (T-253, T-264, T-272, T-285, T-291) and
every checker round attached to their fix tasks (T-259C … T-294C), read from the fleet
evidence packs under `D:\Abhay\GetWorkDone\evidence\` and `LEDGER.md`.

---

## 0. The one-paragraph answer

Each round finds new issues **because each round used a discovery METHOD the previous
round did not use** — not because it looked harder at the same places. Round 1 compared
our fields to an external tracker and found zero new bugs. Round 2 added a real browser
and log-pattern reading and found sixteen. Round 3 added an audit of the alerting channel
itself and found the alert channel was 86% noise. Round 4 ran the comparison **backwards**
(external list → our site) and instantly found a real IPO that was invisible on the site —
something no forward comparison can ever find, no matter how many rounds you run.

Findings per round are roughly flat (0 → 16 → 12 → 12 → 11) while the defect population
shrinks. That is the signature of a **method-limited** search, not a defect-limited one.
So the loop will not converge to zero by repeating reviews. It converges when the METHOD
SPACE is covered by standing checks, and the review round is left to find only what a
machine cannot.

**And the method space is not covered.** Of 18 distinct discovery methods this project has
demonstrably used, **6 are automated and scheduled, 8 are automated but never scheduled,
and the rest have no automation at all.** The most valuable one — comparing against the
outside world in either direction — has *zero* automation, which every round's own bottom
line said out loud and none of them fixed.

---

## 1. Why the rounds keep producing new findings — the evidence

| Round | Task | Findings | The method it added that the previous round lacked |
|---|---|---|---|
| 1 | T-253 (08-21) | **0 new** (3 known issues re-confirmed) | D1 forward field-compare vs external, on a 26-IPO sample |
| 2a | T-264 (08-22) | **16** (4 P1 / 5 P2 / 7 P3) | **D3 real-browser render**, **D6 log-pattern counting**, D8 mutation-proof, D10 SHA lineage, D13' running our own gate and reading its verdict critically |
| 2b | T-272 (08-22) | **12** (2 P1 / 4 P2 / 6 P3) | **D4 whole-table invariants** (not samples), **D5 serving-vs-storage delta**, D11 provenance, D16 sitemap completeness |
| 3 | T-285 (08-23) | **12** (3 P1 / 3 P2 / 6 P3) | **D12 alert-channel audit**, **D9 config-vs-code liveness** (orphaned cron), D14 test-coverage negative grep, D13 time-bomb scan |
| 4 | T-291 (08-23) | **11** (1 P1 / 5 P2 / 5 P3) | **D2 reverse sweep (external → ours)**, D13' running the repo's own dormant browser gate against prod |

Read the third column top to bottom. Every jump in yield tracks a **new method**, never a
new area. The three clearest proofs:

- **Round 1 found nothing new** with the richest data of any round (26 IPOs, three external
  trackers, DB *and* API cross-checked). Its own report says: *"New findings: **None.** Every
  discrepancy found in this pass maps to an already-open, already-diagnosed GitHub issue."*
  One method, applied carefully, yields nothing — because a forward compare can only inspect
  rows we already have and fields we already populate.
- **Round 2 found sixteen the next morning** on the same site, because it opened a browser.
  `/history` returned HTTP 200 with every gain column blank; `/market-holidays` rendered a
  breadcrumb and a footer and nothing else, *with no console error*. No amount of API
  comparison sees that.
- **Round 4's only P1 was found by reversing the direction.** *Mopshop Distribution Ltd.* is
  a real BSE SME IPO. Chittorgarh and ipowatch both list it. Our site 404s it, it is absent
  from the sitemap, absent from `/sme-ipos`, absent from the API — because Moneycontrol typed
  it `FPO` at confidence 100 and won uncontested. **Rounds 1–3 could not have found it.** They
  all iterated over *our* rows. A row we do not have cannot fail a check we run over our rows.

### 1.1 The three structural reasons a round misses what the next one finds

1. **Method not used.** The dominant cause. Nothing was wrong with the earlier reviewer's
   diligence — the layer was simply never exercised in that way.
2. **Direction of iteration.** Forward (ours → world) finds *wrong* values. Reverse (world →
   ours) finds *missing* rows and *invisible* rows. These are disjoint failure sets. Almost
   all automated checking in this repo is forward-only.
3. **Created later, or re-created after the fix.** A real minority, and the checker rounds are
   where it shows: T-281 (band collapse regressed 11 minutes after deploy), T-277C (duplicates
   re-minted after the merge), T-287C2/F2/F3 (one defect rebounded through three separate
   mechanisms — scraper hardcode, matrix gap, protection hole — before it held). This is the
   D7 *hold-through-cycle* class, and it is why "the fix is merged" is not evidence.

### 1.2 The failure mode that outranks all the findings

Round 2 ran the project's own production gate against the broken site and got
**24/24 PASS**, minutes before writing up four P1s. Round 4 found that the browser gate built
to catch exactly this class had been **switched to manual-only in commit `b5011df5`** to save
Actions minutes, had **last run 2026-07-01 (53 days earlier)**, and that **all 8 recorded runs
had failed**. Round 3 found the freshness watchdog had **no scheduler at all** — no crontab
entry, no timer — and had only ever run when an ad-hoc session invoked it.

That is the real answer to "why do new issues never stop": **checks were being written and
then not being run.** A gate that is not scheduled is a document.

---

## 2. Finding catalog — deduped by mechanism

Each row is a distinct *mechanism*, not a distinct symptom. Columns:
**(a)** the discovery method that found it, **(b)** why earlier rounds missed it, **(c)**
whether a standing automated check covers that method today.

Method codes are defined in §3.

### 2.1 Data-layer mechanisms

| # | Mechanism (round) | (a) Found by | (b) Why earlier rounds missed it | (c) Standing check today |
|---|---|---|---|---|
| 1 | Price band collapsed to a single price on 82% of rows; `parsePriceRange()` synthesizes a zero-width band, and a same-source conflict resolves `DEFAULT_KEEP_EXISTING` so the correct value never wins (T-272 P1-1; first seen T-264 P2-1) | D4 whole-table invariant + D1 external compare | R1 sampled 26 IPOs and every *populated* band matched — the defect is that a band is populated *wrongly*, uniformly, which a sample reads as consistency | **YES** — `audit-ipo-coverage.mjs` substance `checkPriceBand` + scraper `PRICE_BAND_DEGENERATE`. But the gate is **unscheduled** (§4.1) |
| 2 | 26 fabricated registrars served from a poisoned Redis key while the DB held 15 (T-272 P1-2); 39/54 DB rows fabricated (T-264 P1-1) | **D5 serving-vs-storage delta** | Only visible as a *difference*: the DB query alone looks fine, the page alone looks plausible. R1/R2a never diffed the two counts | **NO** — T-272 explicitly specified the check (`count(/api/registrars) == count(registrars)`); it was never built. **Gap G-A**; fingerprint half closed as **G1** |
| 3 | 11 + 2 duplicate IPO pairs, contradictory statuses/dates, both slugs live and in the sitemap (T-272 P2-1, T-291 P2-2) | D4 whole-table near-duplicate scan | Requires an all-pairs scan of 328 rows; per-IPO review never compares row *i* to row *j* | **YES** — `duplicates.groups==0` in `audit-ipo-coverage.mjs --gate` (unscheduled) |
| 4 | InvIT/REIT written as an equity IPO, renders ₹0.00; the detector fires and the row is written anyway (T-272 P2-2) | D6 log-pattern (same WARN 20×/cycle) | The row *renders*; only the repeated log line reveals the system knew and proceeded | **PARTIAL** — run-health now honest (T-287); no standing "same WARN N× per cycle" detector. **Gap G-F** |
| 5 | A genuine SME IPO invisible: `offering_type=FPO` written by a mid-trust source at confidence 100 (T-291 P1-1) | **D2 reverse sweep** | Structurally impossible forward. A missing row fails no check that iterates our rows | **PARTIAL** — `pollution.invisibleSme==0` invariant added (PR #181) catches that *specific* SME+FPO shape, unscheduled. The general "world has it, we don't" sweep is **Gap G-B** |
| 6 | Fabricated open/close dates with **zero** `field_sources` rows (T-291 P2-5); no provenance written on insert (P3-11) | **D11 provenance inspection** | The dates render honestly-shaped; only the absence of lineage marks them as invented | **PARTIAL** — lineage-on-insert fixed (T-292). No standing "hard date asserted with no provenance" gate. **Gap G-C** |
| 7 | Two different companies carrying byte-identical figures to the rupee (T-291 P3-9) | D4 whole-table invariant (cross-row equality) | Per-IPO review reads each row as internally plausible | **NO** — issue #178 open, root cause unresolved. **Gap G-C** |
| 8 | Name pollution `(X IPO)` inside `company_name` → 76-character public URLs (T-272 P3-1) | D4 invariant + D16 URL surface | Cosmetic at row level; only obvious as a class | **YES** — `name-quality.smells==0` (unscheduled) |
| 9 | `allotment_date` 0% on OPEN/UPCOMING and 98% on LISTED — populated only after it stops mattering (T-285 P3-2) | D4 invariant **sliced by lifecycle stage** | A flat "coverage %" reads 92% and looks healthy. The defect appears only when coverage is cut by stage | **YES** — `ipo-stage-completeness.mjs` stage-due-fields (unscheduled) |
| 10 | LISTED IPOs with no `listing_performance` row at all — the job refreshes what exists, nothing backfills what is missing (T-272 P3-6, T-285 P3-3, T-291 P3-8) | D4 invariant | Recurs across three rounds at shrinking magnitude (26 → 8 → 3): a genuine long tail, not a missed method | **YES** — `listing_performance` ≥95% threshold (unscheduled); residual is #182 |

### 2.2 Serving / render-layer mechanisms

| # | Mechanism (round) | (a) Found by | (b) Why earlier rounds missed it | (c) Standing check today |
|---|---|---|---|---|
| 11 | `/ncd` and `/rights-issues` showed **zero rows for eight months** — `useState('2025')` filter default plus an empty state that hid the year control (T-285 P1-1); `/ofs` same class, showing 5 of 19 (P2-1) | **D3 real-browser render** | HTTP 200, correct payload shipped into the page, **no console error**, more than 80 characters of text. Every non-browser check passes it. R2's browser sweep did not include these routes | **PARTIAL** — the daily VPS browser cron (T-294) covers 31 routes including `/ncd`, but asserts only *no crash / no console error / >80 chars*, all of which an empty state satisfies. **Closed now — §5 G2** |
| 12 | `/history` served a ≥19-hour stale cache with every gain blank; `limit=20` (the page default) returned a poisoned 240-row set while `limit=19` and `limit=21` were correct (T-264 P1-4) | D3 render + **D5 parameter bisect** | Requires probing *around* the default parameter. A single call at the default returns the poisoned data and looks self-consistent | **NO** standing cache-poisoning probe. Invalidation itself fixed (T-268). **Gap G-D** |
| 13 | `/market-holidays` blank: no filters, no cards, no empty-state message, no console error; the API silently ignored both `year` and `exchange` (T-264 P2-2) | D3 render + D5 API-parameter probe | A `.where()` replacing a `.where()` — the API returns 200 with *wrong* rows | **PARTIAL** — the browser cron's thin-content check covers the blank page; the ignored-filter class has a regression test (T-268) but no standing prod probe |
| 14 | Fabricated companies on both performance trackers and a fake registrar phone `022-12345678` (T-264 P1-1) | D3 render (client-side mock data, invisible to the API) | The mock rows are rendered *client-side*; the seed-name grep in `audit:prod` inspects the **IPO API** only, so it cannot see them. Round 2's own P2-5 named this | **PARTIAL** — generators purged (T-265); the *fingerprint* check that catches a recurrence is **closed now — §5 G1** |
| 15 | React #418 hydration error on `/terms`, `/privacy`, `/disclaimer`, caused by Cloudflare Email Obfuscation rewriting SSR output (T-291 P2-3) | **D13' running our own dormant gate** | The gate existed and would have caught it; it had not been pointed at prod since 2026-07-01 | **YES** — CF obfuscation disabled and prod-verify re-armed on VPS cron (T-294) |
| 16 | Sitemap omits 4 live landing pages; duplicate slugs both indexed; reviews pages serve the generic homepage `<title>` (T-272 P2-4/P2-3, T-264 P3-5) | **D16 SEO-surface completeness** | Nothing links the route inventory to the sitemap; each looks fine alone | **NO**. **Gap G-E** |

### 2.3 Scraper-pipeline mechanisms

| # | Mechanism (round) | (a) Found by | (b) Why earlier rounds missed it | (c) Standing check today |
|---|---|---|---|---|
| 17 | Subscription understated 2–3×: `nse-api-client.ts` read a `bidDetails` array the live payload never contained; the real numbers sit at an endpoint the scraper never called (T-264 P1-2) | **D6 log-pattern** (`totalSubscriptions:0` every 30 min) + D1 external compare | The per-run success flag said SUCCESS. Only the *repeated zero* across cycles is the signal | **PARTIAL** — a zero-yield anomaly alert exists (T-266) but **had no committed test** (T-266C, HIGH). Residual under-report is #153 |
| 18 | listing-performance failed **243/243, every cycle, silently** — NOT NULL schema drift, with the pg cause dropped by a generic wrapper (T-264 P1-3) | D6 log-pattern + D4 DB nullability diff | `error.message` only, no cause chain; the run kept reporting completion | **YES** — `db-cause.ts` error-cause surfacing, mutation-proven to catch a revert (T-285, T-291) |
| 19 | Every scraper cycle reported `success:false` for months (2 InvIT rows), making the run-level health flag worthless (T-285 P2-2) | D6 run-flag reading | Everyone reads "did it complete"; nobody reads "what does the flag say every single time" | **YES** — run-health honesty fixed (T-287) |
| 20 | `data_conflicts` grew unbounded (11,493 rows), the same conflict re-inserted per cycle, `resolved_at` never set (T-285 P2-3) | D4 invariant (table growth) | Invisible from the product; only a row-count trend shows it | **PARTIAL** — inflow cut ~86% (T-286); no standing unbounded-growth check. **Gap G-F** |
| 21 | Conflict detection **inert**: `conflictsDetected: 0` every cycle while real disagreements existed (T-272 P3-5) | D6 log-pattern contradicted by D4 | A zero looks like health. Only cross-checking against a known-true disagreement exposes it | **PARTIAL** — cause fixed; no standing "detector reported 0 for N cycles while invariant X is violated" cross-check. **Gap G-F** |
| 22 | A **repair script** wrote the same wrong band to 64 unrelated companies via false-positive fuzzy matches — a fix that corrupted production (T-268C run 2) | **D18 checker re-sample outside the maker's own sample** | The maker's own five-row spot check was clean. The corruption lived in the rows the maker did not pick | **PROCESS** — institutionalised as the mandatory C-round; not code-automatable |
| 23 | A repaired value **rebounds on the next cycle**, through a different mechanism each time (T-281, T-287C2/F2/F3, T-293C) | **D7 hold-through-cycle** | "Merged, deployed, row now correct" is not evidence. Only surviving a real cycle is | **NO** standing post-repair hold assertion. **Gap G-G** |

### 2.4 Config / deploy / infrastructure mechanisms

| # | Mechanism (round) | (a) Found by | (b) Why earlier rounds missed it | (c) Standing check today |
|---|---|---|---|---|
| 24 | **The consolidation pipeline was inert in production** — `CONSOLIDATION_PERCENTAGE=0`, so every priority rule and guard built across multiple rounds never executed (T-282) | **D9 config-vs-code liveness** | Code review proves the guard exists. Only reading the live env proves it runs | **PARTIAL** — `assert-env-keys.sh` checks key *presence*, not that a rollout percentage is non-zero. **Gap G-H** |
| 25 | Freshness watchdog dead 23 hours with **no scheduler at all** — no crontab, no timer; it had only ever run when a session invoked it (T-285 P1-3) | **D9 config-vs-code liveness** | The script exists and works. Nothing asserted it was *installed* | **YES** — re-armed on VPS cron `*/30` (T-286) with heartbeat and dead-man's switch |
| 26 | `prod-verify.yml` demoted to `workflow_dispatch`-only; last run 53 days earlier; all 8 runs red (T-291 P2-4) | D9 liveness + D13' running it | Same class: a gate exists in the repo and is not scheduled | **YES** — VPS cron `15 3 * * *` (T-294) |
| 27 | Production running a commit on **no merged branch** (`1a0b76f`, existing only on a feature branch) while missing a merged fix (T-264 P2-4); recurrence noted at T-266C | **D10 deployed-artifact lineage** | The served-SHA probe proves `served == deployed`. It never proves `deployed ∈ main` — the exact hole | **NO** — still uncovered; no issue existed until this task. **Gap G-I** |
| 28 | Staging and production share one Redis DB; `REDIS_DB`/`REDIS_URL` ignored by the client factory, so a staging page view can overwrite what production serves (T-264 P2-3) | D9 config-vs-code + D5 (db0 = 3262 keys, db1 = 0) | Config *declares* isolation. Only counting keys per slot disproves it | **PARTIAL** — client honours `REDIS_DB` plus `assert_slot_redis_db()` (T-268). Residual #151/#156 |
| 29 | Integration tests ran against the **production** DB and Redis; DB rows cleaned by teardown, the 7-day cache was not (T-272 P1-2 root cause) | D11 fingerprint + D5 delta | Nothing in the test config prevented it | **YES** — prod-target guard, fail-closed (T-275/T-279) |
| 30 | `packages/shared` exports map missing an entry → the real ESM loader fails → **the whole scraper cannot start**, while CI stays green because every unit test `vi.mock`s the import (T-268C) | **D15 real-runtime module-load probe** | `tsc` with bundler resolution does not enforce the runtime exports map; mocked unit tests never reach it | **YES** — `shared-package-exports-real-esm.test.ts` in `pr-gate.yml`, revert-proofed |

### 2.5 Monitoring / meta mechanisms

| # | Mechanism (round) | (a) Found by | (b) Why earlier rounds missed it | (c) Standing check today |
|---|---|---|---|---|
| 31 | **86% of owner P1 alerts compared a source against itself** (NSE vs NSE — the top and bottom of one price band). The one real alert, the dead watchdog, sat unactioned for 23 hours under 346 false ones (T-285 P1-2) | **D12 alert-channel audit** | Requires reading the *outbound delivery log* as a dataset. Neither code review, DB queries, nor the site show it | **PARTIAL** — same-source suppression and a `source1 <> source2` filter shipped (T-286). Nothing measures alert signal-to-noise on an ongoing basis. **Gap G-J** |
| 32 | The alerting code path itself was **dead** — a brace group's `exit` after a redirect made the notify block unreachable; two further instances of the same bug were found (T-294C) | D8 mutation / D18 checker | The script "ran fine" and logged. Only forcing a failure proves an alert fires | **PARTIAL** — fixed with live delivery-log proof (T-294F). No standing synthetic-alert drill. **Gap G-J** |
| 33 | Two shipped guards (served-SHA probe, env-parity DSN checks) could be **deleted with a fully green suite** (T-285 P3-1; first flagged T-262C) | **D8 mutation / revert-proof** | A green suite is not evidence a guard is load-bearing; redundant fixtures mask deletion | **PARTIAL** — deploy mutation tests added (T-287); no standing mutation job over the guard set. **Gap G-K** |
| 34 | `PRICE_BAND` appeared **zero times** in the validation test file; `NCDTable`/`OFSTable`/`RightsIssuesTabs` had **zero** tests — which is exactly where the eight-month bug lived (T-272 P1-1, T-285 P1-1) | **D14 test-coverage negative grep** | Aggregate coverage looked acceptable; the *named* untested surface is the predictor | **NO**. **Gap G-L** |
| 35 | Hardcoded year constants — a time bomb with a known next detonation, 2027-01-01 (T-285 P3-5) | **D13 time-bomb scan** | Correct today, wrong at a future date boundary. No test fails before the boundary unless it fakes the clock | **YES** — `DataTable.test.tsx` asserts a future system clock still reaches the current year (T-286F) |
| 36 | The project's own production gate returned **24/24 PASS** on a site carrying four live P1s (T-264 P2-5) | **D13' meta: run our gate, then distrust its verdict** | Gates asserted HTTP 200 and API-name greps — *shape*, never *substance* | **PARTIAL** — substance checks now exist (`substance-checks.mjs`); they are **unscheduled** (§4.1) |
| 37 | `.claude/tasks/lessons.md` stale for 52 days across roughly ten fix tasks (T-291 P3-10) | D14-style staleness read | Nothing asserts that a fix round produces either a lesson or a gate | **PROCESS** — lessons now current; no gate |
| 38 | **No workflow runs the full scraper suite** — CI green does not mean the changed scraper code was exercised (T-259C F1) | D9 liveness applied to CI itself | The check is named "Unit Tests" and it is green | **PARTIAL** — `pr-gate.yml` runs *targeted* scraper regressions, not the full suite. **Gap G-M** |

---

## 3. The discovery methods (D-codes)

| Code | Method | What only this method can find |
|---|---|---|
| D1 | Forward compare: our field → external oracle | A value we hold that is *wrong* |
| D2 | **Reverse sweep: external list → our site** | A row we are *missing*, or hold but render *invisible* |
| D3 | Real-browser render (console, painted DOM, screenshot) | Anything the server ships correctly and the client discards |
| D4 | Whole-table DB invariant (100% of rows, sliced by lifecycle stage) | Class defects a sample reads as consistency |
| D5 | Serving-vs-storage delta (API/render count vs DB count; parameter bisect) | Cache poisoning, stale slices, silently ignored query params |
| D6 | Log-pattern analysis (repeat-count across cycles; run-flag reading) | A failure that repeats identically forever and reports success |
| D7 | Hold-through-cycle (re-assert after a real scraper cycle) | A repair that rebounds |
| D8 | Mutation / revert-proof of a guard | A guard that is decorative |
| D9 | Config-vs-code liveness (is it *scheduled / enabled / non-zero* in prod?) | Code that exists and never executes |
| D10 | Deployed-artifact lineage (is the served SHA an ancestor of main?) | Production running unreviewed or superseded code |
| D11 | Provenance inspection (`field_sources`: who, when, at what confidence; rows with none) | Fabricated values; a low-trust source winning uncontested |
| D12 | Alert-channel audit (read the delivery log as a dataset) | Monitoring switched off by its own noise |
| D13 | Time-bomb / boundary scan (hardcoded years, thresholds) | A defect scheduled for a future date |
| D13' | Meta: run our own gates against prod **and distrust a green verdict** | Gates that assert shape while substance is broken |
| D14 | Test-coverage negative grep (which shipped name appears in **zero** tests) | Where the next bug will be |
| D15 | Real-runtime module-load probe (real loader, no mocks) | CI-green code that cannot start in production |
| D16 | SEO-surface completeness (route inventory ↔ sitemap ↔ titles) | Revenue leaks invisible to every functional check |
| D17 | Internal arithmetic re-derivation (recompute a shown number from its parts) | Incoherent numbers — mostly green here, which is itself worth knowing |
| D18 | Independent re-sample outside the maker's own sample | A fix that is correct only on the rows its author chose |

---

## 4. COVERAGE MATRIX — methods × layers

Legend: **A** = automated **and scheduled** · **U** = automated but **unscheduled** (runs only
when a human types the path — *this is a document, not a gate*) · **M** = manual review only ·
**—** = not applicable · **P** = process-enforced (fleet role, not code).

| Method \ Layer | Data / DB | Serving / API | Render | Scraper pipeline | Config / deploy | Infra / monitoring | SEO surface |
|---|---|---|---|---|---|---|---|
| D1 forward external compare | **M** | **M** | **M** | **M** | — | — | — |
| D2 **reverse sweep (world→ours)** | **M** | **M** | **M** | — | — | — | **M** |
| D3 real-browser render | — | — | **A** (VPS cron daily, T-294) | — | — | — | — |
| D4 whole-table invariant | **U** (`audit-ipo-coverage --gate`) | — | — | **U** | — | **M** | — |
| D5 serving-vs-storage delta | — | **M** | **M** | — | **M** (redis slots) | — | — |
| D6 log-pattern analysis | — | — | — | **A**-partial (zero-yield alert, run-health) | — | **M** | — |
| D7 hold-through-cycle | **M** | — | — | **M** | — | — | — |
| D8 mutation / revert-proof | — | — | — | **U** (`data-validation` tests) | **U** (`deploy-linux.test.sh`) | **M** | — |
| D9 config-vs-code liveness | — | — | — | **M** | **A**-partial (`assert-env-keys.sh`, deploy-time) | **A** (freshness heartbeat) | — |
| D10 deployed-artifact lineage | — | — | — | — | **A**-partial (served == deployed only) | — | — |
| D11 provenance inspection | **M** | — | — | **M** | — | — | — |
| D12 alert-channel audit | — | — | — | — | — | **M** | — |
| D13 time-bomb scan | **M** | — | **A** (`DataTable.test.tsx`, T-286F) | **M** | **M** | — | — |
| D13' run-our-gate-and-distrust | **U** | **U** (`audit:prod` — script exists, no schedule) | **A** (VPS cron) | **M** | **M** | **M** | **M** |
| D14 test-coverage negative grep | — | **M** | **M** | **M** | **M** | — | — |
| D15 real-runtime load probe | — | — | — | **A** (`pr-gate.yml`) | — | — | — |
| D16 SEO-surface completeness | — | — | — | — | — | — | **M** |
| D17 arithmetic re-derivation | **U** (substance checks) | — | **M** | — | — | — | — |
| D18 independent re-sample | **P** | **P** | **P** | **P** | **P** | **P** | **P** |

### 4.1 The answer to the owner's question, read straight off the matrix

**Every `M` and every `U` cell is a place the next review round will find something, and the
round after that will find something else.**

Three facts stand out, and they are the whole story.

1. **The `U` cells are the cheapest and the most damaging.** `audit-ipo-coverage.mjs --gate`
   is a genuinely good gate — it holds the `invisibleSme` invariant added yesterday (PR #181),
   duplicate detection, name quality, stage-sliced completeness thresholds, and nine substance
   checks. **It is wired to no npm script, no CI workflow, and no cron.** It runs only when a
   worker types the path. The same is true of `audit-substance-plausibility.mjs`. Even
   `audit:prod` — which *has* an npm script — is on no schedule anywhere. Verified:
   `grep -rn "audit-ipo-coverage\|audit-substance\|audit:prod" package.json .github/workflows/ scripts/*.sh`
   returns exactly one line, the npm alias for `audit:prod`. The box crontab
   (`evidence/2026-08-22-T-296/box-env.txt`) contains the freshness check and the browser sweep
   and **no data audit at all**.
2. **D1 and D2 — the entire external-oracle row — are 100% manual.** Every round's bottom line
   said so in its own words. Round 2: *"Until at least one check re-derives a rendered value
   against an outside source … the next regression of this class will ship green again."*
   Round 4 then proved the harder half: the reverse direction found a P1 that forward
   comparison structurally cannot reach.
3. **D5, D7, D12, D14, D16 have no automation anywhere.** Each has already produced at least
   one P1 or P2 in these five rounds.

---

## 5. Gap closure

### 5.1 Closed in this change

| ID | Gap | What was added |
|---|---|---|
| **G1** | D5/D11 fabrication fingerprint at the serving layer (mechanisms #2, #14) | `scripts/audit-prod.mjs` now rejects placeholder registrar/company names (`Alpha`/`Beta`/`Gamma`/`Test`/`Demo`/`Sample` registrar shapes), placeholder phone numbers (`022-12345678`, `011-87654321`) and placeholder domains, across `/api/registrars` and the IPO APIs. HTTP-only, so it runs from anywhere. This is the check T-272 specified and nobody built. |
| **G2** | D3 substance-of-render (mechanisms #11, #13) | `web/tests/e2e/production-verification.spec.ts` gains a `MUST_SHOW_DATA` table. For each route known to have rows, the sweep now fails on an empty-state phrase (`No NCDs available`, `No upcoming rights issues available`, …) and requires a substance marker in the rendered text. It lands in the **already-daily** VPS cron harness — this is the check that would have caught the eight-month `/ncd` bug on day one. |
| **G3** | The `U` → `A` promotion: the DB-invariant gate is on no schedule (§4.1, fact 1) | `npm run audit:coverage` and `npm run audit:substance` aliases, plus `scripts/vps-data-audit-cron.sh` modelled line-for-line on the working `vps-prod-verify-cron.sh` (T-294): runs `audit-ipo-coverage.mjs --gate` daily on the box, alerts the owner through the Notifier gateway on a non-zero exit, day-scoped dedupe, log retention. **One manual install step remains** — adding the crontab line on `72.61.240.224`, a production mutation outside a read-only worker's authority. It is documented in the script header exactly as T-294 did. |

### 5.2 Filed as issues — remaining `M` / uncovered cells

Every gap below carries an exact specification (query, assertion, schedule) in its issue.
No gap is left unlisted.

| ID | Gap | Layer | Method |
|---|---|---|---|
| **G-A** | Serving-vs-storage row-count delta for every list API (`/api/registrars`, `/api/ipos`, holidays, NCD, OFS, rights) | serving | D5 |
| **G-B** | **Reverse sweep**: every IPO on an external calendar must exist, be typed `IPO`, and return 200 on our detail route | data + render | D2 |
| **G-C** | Provenance gate: a row asserting a hard date or band with **zero** `field_sources`, or two rows with byte-identical figures, fails the gate | data | D11 |
| **G-D** | Cache-poisoning probe: bisect the default list parameter and assert the default page's dataset matches its neighbours | serving | D5 |
| **G-E** | SEO-surface completeness: sitemap ⊇ every live 200 route; no duplicate-slug pair indexed; every page type has its own `<title>` | SEO | D16 |
| **G-F** | Pipeline-signal health: repeated-WARN-per-cycle detector, unbounded-table-growth alarm, and an inert-detector cross-check | scraper | D6 |
| **G-G** | Post-repair hold assertion: after any data repair, re-assert the invariant following at least one real scraper cycle before the task closes | data + scraper | D7 |
| **G-H** | Liveness of rollout flags: assert every `*_PERCENTAGE` gating live logic is non-zero in production (the T-282 inert-pipeline class) | config | D9 |
| **G-I** | Deployed-SHA lineage: assert the deployed SHA is an ancestor of `origin/main` (the exact hole T-264 P2-4 fell through; still open) | deploy | D10 |
| **G-J** | Alert-channel quality: standing signal-to-noise measurement plus a periodic synthetic-alert drill proving the notify path is live | monitoring | D12 |
| **G-K** | Standing mutation job over the declared guard set — a guard that survives deletion with a green suite fails the job | meta | D8 |
| **G-L** | Test-coverage negative grep: every shipped data-table component and every named validation rule must appear in at least one test | meta | D14 |
| **G-M** | Run the **full** scraper suite in CI, not a targeted subset (T-259C F1, still true) | meta | D9 |
| **G-N** | Forward external-oracle compare as a standing check, using an oracle the scraper does **not** ingest | data | D1 |

---

## 6. What this means for how the loop should run

1. **Stop measuring the loop by findings per round.** That number is flat by construction.
   Measure it by **method coverage**: how many `M`/`U` cells in §4 became `A` this round.
2. **Every fix round must promote at least one cell.** A round that fixes ten bugs and promotes
   zero cells has not reduced the rate at which round N+1 finds new bugs.
3. **`U` is not `A`.** Writing a gate and not scheduling it produces the same outcome as not
   writing it, with more confidence attached. Any new check must land with its trigger in the
   same change.
4. **Forward and reverse are different checks.** Anything that iterates over our rows is half a
   check. The other half iterates over the world's rows.
5. **A green gate is a claim, not evidence** (T-264 P2-5: 24/24 PASS on a four-P1 site). New
   gates must assert *substance* — a value re-derived, a count reconciled, a row proven to
   exist — never only shape.

---

*Sources: `evidence/2026-08-21-T-253/OWNER-REPORT.md` and `checker/CHECKER-VERDICT.md`;
`evidence/2026-08-22-T-264/REVIEW-VERDICT.md`; `evidence/2026-08-22-T-272/REVIEW-VERDICT.md`;
`evidence/2026-08-22-T-285/REVIEW-VERDICT.md`; `evidence/2026-08-22-T-291/REVIEW-VERDICT.md`;
`evidence/2026-08-22-T-296/box-env.txt` (live crontab); `LEDGER.md` lines 2568–2660 (checker
verdicts T-259C … T-295); IPODhan issues #139–#183. All paths relative to
`D:\Abhay\GetWorkDone\`.*
