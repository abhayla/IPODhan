<!-- Landed verbatim by fleet worker T-314. Author: Claude Fable 5 (dispatcher session), owner-approved 2026-08-24 09:34-09:38 IST. -->
<!-- Method + evidence bundle: D:\Abhay\GetWorkDone\evidence\2026-08-24-FABLE-REVIEW\ (FABLE-ARCH-REVIEW.md, inventory.md, traces.md, scratchpad-notes.md) on the fleet bus. -->

# IPODhan — Fable-authored architecture review (2026-08-24, read-only)

Author: Claude Fable 5 (dispatcher session), first-principles, independent of the Opus reviews (T-298, T-313 — T-313's findings deliberately not read before this draft).
Method: invariants-first. (1) Classified all round 1–6 findings by mechanism → derived the invariants the system must hold. (2) Read the write path first-hand (persister, consolidation, identity resolver, protection). (3) Traced 4 real IPOs through production data (read-only). (4) Full write-site inventory (subagent, file:line). Every claim below carries a file:line or a query.

## 0. Executive summary (plain English)

The site keeps going wrong in the same *shapes* — a value that was right becomes wrong, a duplicate appears, a repair gets undone — because of five structural properties, not because of any one bug:

1. **The system has no memory.** Every scrape *overwrites* the served row. What was there before is thrown away (`field_sources` keeps one step back; `data_conflicts` only records values when two sources disagree in the same cycle). Gabion's real band ₹76–81 was *never in the database* — the row was created six months after listing from a page that only knew the final price, and there was nothing to compare against. This is why repairs must come from outside trackers, why "repair before deploy" bites, and why a collapsed band can never widen itself.
2. **Nothing knows what stage an IPO is in when it writes.** Price band, lot size, issue size, and event dates are fixed facts once an IPO opens. The code treats every field as forever re-writable by any source with priority. Every guard built so far (band-narrowing, date sanitizer, subscription floor, offering-type keep, SME/FPO) is a hand-written special case of one missing rule: *settled fields don't change; cumulative fields don't decrease.*
3. **Identity is resolved by name, while the natural keys sit unused.** `resolveIpoRow` (packages/shared/src/repositories/ipo-identity.ts) matches on normalized company name → slug → fuzzy. The scrapers emit `symbol` and `isin`; production has `UNIQUE(symbol)`. Name matching is inherently fuzzy, which is the root of duplicates, the typo bypass, and the 64-row fuzzy corruption.
4. **There is no single write path — there are ~255 files with ~250–260 write statements**, not the ~48/57 the first review counted. The web app has ~130 sites including its own scraper module and a generic "write any table by name" admin endpoint, none of which touch the scraper's protected persister. Even inside the scraper there are two parallel consolidation pipelines plus a legacy fallback that skips sanitising and lineage.
5. **Existence is mistaken for liveness.** Jobs, flags, gates and checks are written and never scheduled or never reached from what production actually runs (scheduler tree, discovery flag, audit gates, `ENABLE_EARLY_DETECTION` with zero consumers). The 6-round loop found this class in every round.

What this means for the plan: the first review's diagnosis (no single write gateway) is right but incomplete, and its Phase 2 as designed — a chokepoint that *guards mutation* — would still leave properties 1, 2 and 3 in place. A guarded mutation of a row with no memory and no lifecycle is still last-write-wins. The minimal change that removes the recurrence generator is: **make observations first-class and the served row a rebuildable projection with lifecycle rules, keyed by exchange identity.** That is not a rewrite: the consolidation service *is* the resolver already; the observation store is 80% present (`data_conflicts` has values; `field_sources` needs a `value` column and to lose its one-row-per-field uniqueness).

## 1. Invariants (what must be true for correct data to STAY correct)

| # | Invariant | Rounds that violated it |
|---|---|---|
| I1 | One IPO = one row, keyed by exchange symbol/ISIN when known; name matching may only *propose* a merge, never authorise an update of an existing row | R2 dupes ×11, R4 IC Electricals ×4 merges, T-268C (64 rows), T-287F3, T-291 invisible SME |
| I2 | Fields have a lifecycle; once an IPO passes a stage, that stage's fields are immutable to scrapers (ADMIN/DRHP only) | R2/R3/R6 band collapse ×3, date stomps, offering-type flips, segment rebound |
| I3 | Cumulative quantities never decrease; a lower observation is kept but never served | R5 P1-1 (40+ regressions) |
| I4 | Anything derivable is recomputed by a scheduled projection, never only at write time | registrar_id ×58, "Filed with SEBI", "Last updated today", status |
| I5 | Every source write is an append-only observation; the served row is rebuildable from observations + rules | repair-before-deploy ×3, rebound classes, un-widenable bands, Gabion born collapsed |
| I6 | One write path per table for every writer (scraper, web, scripts, jobs); direct writes fail lint and are denied by the DB role | ~255 writer files, second repository, second scraper module, dynamic admin editor |
| I7 | Liveness is proven, not assumed: every job/flag/gate has a last-run record the deploy and daily audit check | R6 P2-7 scheduler, discovery flag, R3/R4 unscheduled audits, T-300C dead path |
| I8 | At least one daily check re-derives served values against an external oracle and the observation log | 24/24 PASS on a 4-P1 site; 33/33 with 59 wrong bands |
| I9 | Every guard has a mutation test on the production path | T-307C ×2, T-311C, T-312C |

## 2. Findings (ranked)

### P1-A — No observation log: values are destroyed on write
- `packages/shared/src/db/schema.ts:1085` `field_sources` = one row per (ipo, table, field) (`unique_field_source_per_ipo`), columns source/confidence/previousValue — a *winner pointer with one step of memory*, no `value`. `data_conflicts` (`:1137`) carries `value1/value2` but only when two sources disagree in one cycle.
- Prod: Gabion `field_sources` all created 2026-07-01 11:01 (row birth), `previous_value` empty on every row, 0 conflicts; band 81–81 since birth. 38 of 301 rows have zero lineage; last 3 days NSE and Moneycontrol wrote **0** lineage rows (Chittorgarh 266, BSE 6). `index.ts` prunes `data_conflicts` every cycle (inventory §2C) — the only value history is deleted on a timer.
- Consequence: the system cannot repair itself, cannot prove what changed, and every hold-test can only *detect* rebound. Violates I5, I4.
- Fix: `observations(ipo_id, table, field, value, source, confidence, observed_at, run_id)` append-only (or: add `value` to `field_sources`, drop the uniqueness, stop pruning conflicts); every writer records the observation BEFORE the resolver decides. Cheap (one table, one insert per field per cycle ≈ the field_sources volume today).

### P1-B — No field lifecycle; every guard is a special case of "settled fields don't change"
- `data-consolidation-service.ts:495-600` `resolveConflict`: source priority → time-based → same-source refresh → keep existing. No stage dimension. `field-priority-matrix.ts` (759 lines) ranks sources per field but cannot say "after OPEN, no scraper may change the band".
- Evidence that the missing rule is the generator: band collapse fixed at T-272/T-281 (guard), T-287 (3 mechanisms), T-308 (emitter) — and T-308C found 4 more emitters; Gabion shows a fifth path (first-sight ingestion of a listed IPO). Same for dates (T-299, T-306, T-306F) and offering type (T-292/#181).
- Fix: a `FIELD_LIFECYCLE` table: field → stage after which it is frozen (band/lot/issueSize/openDate/closeDate: frozen at OPEN; allotment: at ALLOTTED; listing: at LISTED; subscription: monotone) enforced in ONE place (the resolver) for every source and every path. Then "which scraper emitted min==max" stops mattering.

### P1-C — Identity by name while exchange keys are unused
- `ipo-identity.ts:48-88`: normalizedName → slug → `findByFuzzyName` (threshold 0.85, `ipo-repository.ts:364`). No `findBySymbol`/`findByIsin` exists. Scrapers emit `symbol`/`isin` (`validators.ts:56-57`; NSE/BSE/Chittorgarh scrapers). Prod: `ipos_symbol_key UNIQUE(symbol)`.
- Fuzzy matching sits inside the write path: T-268C corrupted 64 unrelated companies via fuzzy false positives; T-287F3/Phase 1 spent 4 review rounds keeping guard and write in sync on a *name*.
- Caveat from data: `symbol` is the 2nd most conflicted field (902 conflicts) — sources disagree on the symbol string, so symbol-keyed identity needs a normalisation rule (NSE symbol vs BSE scrip code) and ISIN as tie-breaker. Design constraint, not a blocker.
- Fix: identity = ISIN when present, else exchange symbol (normalised), else name-exact; fuzzy only produces a `merge_candidates` row for the dedup sweep/admin. Never a write to an existing row.

### P1-D — ~255 writer files; two consolidation pipelines; web never uses the protected persister
- Inventory: web/ ~130 write sites (22 repositories, 9 admin routes with raw writes, 5 services incl. `status-updater-service.ts:97` hourly, web's own scraper module `web/lib/scrapers/sources/*`, ~40 script sites), **0 calls to `upsertIPO`**. `web/app/api/admin/dynamic/[table]/route.ts` writes any table by name with no allowlist.
- Scraper: `BaseScraperOrchestrator.ts:442` → `consolidatedUpsertIPO` (data-consolidation-orchestrator.ts) AND `data-persister.ts:374-480` own consolidation branch — two pipelines; legacy fallback `:544-558` writes without re-sanitise or lineage; `registrar-reresolve.ts:64` and `listing-performance-updater.ts:183` write unconditionally with no protection.
- Guards (inventory §6) are wired to exactly one caller for one table; `subscriptions`, `gmp_records`, `listing_performance`, `registrars` have no lock/protection path at all.
- Fix: one resolver module (the consolidation service, moved to packages/shared with the DB-facing repository) that BOTH scraper and web call; a DB role for the app that can only write `observations` + call a `project_ipo()` function (or: ESLint `no-restricted-imports` + a CI grep gate on `.insert(ipos)`/`.update(ipos)` outside the resolver — the lint gate now exists after #214).

### P2-E — Existence ≠ liveness (the T-297 D9 class, still open after #215)
- `ENABLE_EARLY_DETECTION`: zero consumers; `ENABLE_GMP_SCHEDULED_JOB`: unreachable even after T-311; `ENABLE_DRHP_EXTRACTION`: consumers only in the deleted v1 files; rollout `*_PERCENTAGE` flags still exist (the T-283 inert-pipeline class). `API_FALLBACK` logs SUCCESS with 0 records every cycle (scraper_logs).
- Fix: a `job_runs`/`flag_consumers` registry asserted at deploy (`assert-env-keys.sh` extended — T-306 started this) and in the daily audit; a flag with no reachable consumer fails the deploy.

### P2-F — Dual schemas, dual repositories, dead trees
- `web/lib/db/schema.ts` stale duplicate (12 tables missing) still used by 3 scripts + 2 tests; `packages/shared/src/repositories/*` 8 of 9 files have zero importers — and Phase 1's `resolveIpoRow` was placed in that dead tree, so web's live repositories cannot even see it. CHECK constraints live in raw migrations only, absent from Drizzle. `price_band_low/high` (numeric, dead) vs `price_range_min/max` (integer, live — cannot hold paise); `subscription_data` (empty) vs `subscriptions` (live).
- Fix: delete the dead tree and stale schema; one schema with the constraints declared; retire dead columns/tables in Phase 4.

### P2-G — Conflict churn is by design, and the only history is pruned
- Resolver is stateless per cycle: a persistent legitimate disagreement (NSE vs Chittorgarh faceValue) re-upserts the same conflict every cycle (tempsens: 519 conflicts, all SOURCE_PRIORITY NSE>CHITTORGARH). 6,737 rows, 3,144 "resolved" (= sources later agreed). `pruneDataConflicts()` in `index.ts` deletes them on a timer.
- Fix: with an observation log, a conflict is a *query* (distinct values per field per window), not a table; delete the churn.

### P2-H — Test architecture: guards are tested where they are not used
- `@ipodhan/shared` mocked in 15 of 113 scraper test files; consolidation service mocked in 4; T-307C found the Phase-1 mechanism deletable under a green suite, T-307C2 found the test covered the non-production branch. External-oracle substance assertions in e2e/audit: 0.
- Fix (small): a `production-path` test tier that runs the real `--source=all` cycle against a seeded test DB with fixture HTML (the 10 integration tests already exist as a base) + one oracle comparison in the daily gate (T-305's recommendation — I agree, as detection).

### P3 — operating model
- No per-source deadline inside the */30 cycle (NSE once took 282 s); no global cycle budget except pm2 cron restart. `duplicate-sweep-job` uses string-interpolated `sql.raw`. Repairs write lineage inconsistently (T-278 marker yes; T-292 protections with zero lineage).

## 3. What is GOOD and must not change
- The consolidation service's *shape* (normalise → compare → resolve → record) is the right resolver skeleton; keep it, feed it observations and lifecycle rules.
- Field protection (`field_protection_metadata`, `isIPOLocked`, `filterProtectedFields`) is the right ADMIN-wins model; make it a resolver rule instead of a caller step.
- Deploy pipeline (served-SHA probe, env-parity, migrations-applied, rollback) — mutation-tested, real. Keep.
- The subscription guard's *pattern* (compare against last persisted, not memory) is exactly I3 done right for one table.
- The fleet's checker discipline: 4 of this round's 6 checkers found real gaps the workers missed.

## 4. Plan judgment vs the Opus plan (docs/architecture/write-path-hardening.md)
| Phase | Verdict | Reason |
|---|---|---|
| 1 identity unification | KEEP (done) but INCOMPLETE | unified the *name* resolver; identity must move to symbol/ISIN (P1-C) or the fuzzy class recurs |
| 2 write gateway (guarded mutation chokepoint) | RE-SCOPE | a chokepoint over last-write-wins still has no memory and no lifecycle; make it "observations in, projection out" (P1-A + P1-B); also must include web (P1-D) — the plan scoped web out |
| 3 lint ban on direct writes | KEEP, MOVE EARLIER | the lint gate is real now (#214); a CI grep on `insert/update(ipos)` outside the resolver can land in days and stops the count growing from ~255 |
| 4 DB constraints | KEEP, ADD | plus `observations` table + DB role that cannot write `ipos` directly (the constraint that actually enforces I6) |
| 5 flags + liveness tests | KEEP, MERGE with P2-E | registry-asserted liveness, delete dead flags |

Recurrence metric: not findings-per-round but **recurrences of a previously fixed class per round** (R6: 1 — bands). Target: 0 for two consecutive rounds.

## 5. Next 3 contracts (each sonnet-sized, each with a falsifiable gate)
1. **OBS-1 observation log + lifecycle table (schema + resolver rule, no behaviour change yet):** add `observations` (append-only) written by BOTH consolidation pipelines and the create path; add `FIELD_LIFECYCLE` with the frozen-after-stage map; resolver refuses scraper changes to frozen fields (ADMIN/DRHP exempt). Gate: replay the last 24 h of observations for 5 IPOs → identical rows; the Gabion first-sight fixture → band stays NULL not 81–81; mutation test on the production path.
2. **OBS-2 rebuild + repair-by-projection:** `project_ipo(id)` recomputes a row from observations + rules; the 59-band, 9-row and priority-jewels repairs become ADMIN observations + re-project (no hand SQL); hold-test = re-project is idempotent across a live cycle. Gate: repair runbooks replaced by one command; daily audit compares projection vs served row (I8, internal oracle) + one external-oracle field check.
3. **IDENT-2 exchange-keyed identity + lint gate:** `findByIsin`/`findBySymbol` first, name-exact next, fuzzy → `merge_candidates` only; CI grep gate blocking new `.insert(ipos)/.update(ipos)` outside the resolver (web included); delete dead repository tree + stale schema. Gate: T-268C fixture (fuzzy false positive) produces a merge candidate, not a write; count of direct writers can only go down (ratchet file).

Deferred, with reason: moving all ~130 web writers onto the resolver (do it behind the ratchet, route by route, after IDENT-2); DB constraints beyond `observations` (after OBS-2 proves projections are clean — otherwise the constraints reject the projector).

## 6. What I'd stop doing
- Building another guard per source per field. (T-308's emitter fixes are still worth merging — they reduce noise — but they are not the fix.)
- Repair contracts that hand-write SQL from external trackers (after OBS-2 they are one command).
- Running the review loop as the primary defect finder before OBS-1/OBS-2 land; rounds 7+ will keep finding the same three classes until the generator is gone.
