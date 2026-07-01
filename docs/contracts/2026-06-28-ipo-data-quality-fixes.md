# Contract: IPO data-quality fixes (#8 / #69 / #70 / #71) — code + sources, no prod writes

**Executor:** /goal (built-in autonomous run)   ·   **Created:** 2026-06-28
**Mission:** Implement the four data-quality gaps the process-only-ingestion run surfaced — **#8** (OPEN-IPO renders wrong issue size), **#69** (`company_description`+`sector` 0/285, no source/matrix entry), **#70** (~85% of genuine IPOs stuck `status=CLOSED` with null `listing_date`, never advance to LISTED), **#71** (no deterministic ingestion path for aged-out historical IPOs like Ather) — as **deterministic, LLM-free production code** (live prod has no LLM; the run may use the LLM to build/fix/verify). **Full source build is in scope** for #69/#70 (build whatever NSE/BSE/Chittorgarh/InvestorGain/DRHP source is needed). Each fix is verified by tests + the Chittorgarh/Moneycontrol oracle. **This goal ships CODE + SOURCES + TESTS only — NO prod writes and NO deploy** (the actual prod backfill + deploy are the owner's separate **July-1 batch**, when GitHub Actions billing is restored). "Done" = each of #8/#69/#70/#71 is fixed in deterministic code, proven on real sample IPOs against the oracle via green tests (+ UI screenshot for #8), with any genuinely-unbuildable source filed as a scoped sub-issue — and a PR opened (not merged, not deployed).

## §0.1 Worktree isolation
> **First action of the run, before §0.2 and any stage. Non-negotiable.** Run in a **dedicated git worktree off the CURRENT (post-#68-merge) `main`**, never the user's primary checkout.
> 1. **Isolate:** `root=$(git rev-parse --show-toplevel)`. If `root` is the primary checkout, first `git -C "$root" fetch origin && git -C "$root" checkout main && git -C "$root" pull --ff-only`, then `git worktree add ../IPODhan-run-ipo-data-quality-fixes -b feat/ipo-data-quality-fixes origin/main` and run every stage there. (Branch off the merged-#68 main so the #67 extractor fix is present.)
> 2. **Claim it:** export a unique `RUN_TOKEN` and write `printf '%s\n' "$RUN_TOKEN" > "$(git rev-parse --show-toplevel)/.run-active.lock"`.
> 3. **Release on exit:** the FINAL action (after PR push, OR on any halt/defer) removes the lock: `rm -f "$(git rev-parse --show-toplevel)/.run-active.lock"`. `.run-active.lock` is gitignored.
> 4. **Self-clean ON SUCCESS ONLY:** after the branch is pushed + PR opened + lock released, leave the worktree+branch for owner review (do NOT auto-remove — owner merges later in the July-1 batch). On DEFER/HALT, keep worktree+branch; release only the lock.
> Full mechanism: `.claude/skills/git-worktrees`.

## §0.2 Idempotency preflight
> **First action after §0.1, before ANY stage. Non-negotiable.**
> 1. **Read the coverage ledger** `docs/contracts/.run/ipo-data-quality-fixes-LEDGER.md` — a per-issue × per-sub-task status table (`DONE`/`PARTIAL`/`SUBISSUE#<n>`/`TODO`). If absent, Stage 0 creates it.
> 2. **For every sub-task, check the ledger + actual code + `git log` before building.** If `DONE`/code already implements it (grep/read to confirm), verify-only and move on. If `PARTIAL`, build only the delta.
> 3. **Record every skip** in the final report's "skipped (already covered)" list.

## §0.3 Progress log
> **Append-only progress log for the whole run; update BEFORE moving on from each stage/event.**
> 1. **Location:** `docs/contracts/.run/ipo-data-quality-fixes-PROGRESS.md` (this worktree; `.run/` gitignored).
> 2. **First line:** slug · branch · worktree · start time · contract path · one-line mission.
> 3. **Append ≤2-line entries at:** stage start; stage done (+gate result); every defect; every "not working" event **+ what you did**; each independent-review outcome; each defer/skip; each blocker; final result.
> 4. **Format:** `[YYYY-MM-DD HH:MM] <STAGE|PROGRESS|DEFECT|EVENT|DECISION|RECOVERY|BLOCKER|DONE> — <≤2-line summary>`.
> 5. **At run-end, route learnings per `.claude/rules/learnings-routing.md`** (prefer a gate over prose; one home; dedup). Auto-write only the one-line lessons-log entry; everything else PROPOSE-only.
> 6. **Run-end SUMMARY** (final entry + final report): DONE · PENDING(+reason) · BLOCKED(+why) · NEXT(action+owner).

## Scope boundary
- **In scope:** `scraper/src/**` + `scraper/scripts/**` (new sources, status-updater, ingestion path), `packages/shared/src/**` (schema/validations/repositories/field-priority-matrix entries/consolidation), `web/**` (the #8 render fix + any field display), `scraper/tests/**` + `web/tests/**` (oracle + unit/integration tests), `docs/contracts/.run/**`.
- **Read-only prod allowed:** node+pg via the SSH tunnel (`localhost:15432`) to IDENTIFY the stuck IPOs (#70) and to READ-BACK for verification — **READS ONLY**.
- **Out of scope (HARD):** any **prod WRITE** (`upsertIPO`/DB mutation against prod) — deferred to the owner's July-1 batch; any **deploy**; applying any `_gated/` migration to prod; `5Wealths/`; changing the IPO-vs-corporate-action classification.
- **Goal type:** bug-fix + source build (forward engineering).

## Context to read first
- GitHub issues **#8, #69, #70, #71** (the four targets — read each issue body) and **#36** / memory `b1-listing-backfill-diagnosis` (prior listing-source attempt: NSE had 1364 listing records but the existing backfill matched 0/92 — the real source build #70 needs).
- `scraper/src/scrapers/listing-performance-updater.ts` + `scraper/src/scripts/backfill-listing-performance.ts` (existing listing-perf code using `api.bseindia.com/.../StockReachGraph/w?scripcode=`), `scraper/src/scheduler/jobs/` status-updater (CLOSED→LISTED transition logic).
- `scraper/src/config/field-priority-matrix.ts` + `scraper/src/services/data-consolidation-service.ts` (#69 needs new `company_description`/`sector` matrix entries + a source; sector→peers cascade).
- `scraper/scripts/extract_financials_pdf.py` (the now-fixed #67 extractor — #71 reuses it for historical-IPO financials) + `scraper/src/services/drhp-downloader.ts` (find/download DRHP by name — the basis of the #71 ingestion path).
- `web/app/ipos/[slug]/page.tsx` + the issue-size render path / KPI components + `web/lib/cache/**` (#8: OPEN-IPO shows ₹1.11 Cr vs DB ₹145.78 Cr — live-render or stale-cache; LISTED/CLOSED/UPCOMING render correctly → OPEN-specific).
- `.claude/rules/{scraper-write-path, financial-column-precision, schema-imports, drizzle-validation-and-inferred-types, ipo-duplicate-detection, canonical-ipo-slug, india-market-hours-cron-tiers, scraper-test-layout, web-data-access, cache-key-and-ttl-ssot, redis-best-effort-fail-open}.md`.

## Pre-made design decisions (the run must NOT pause on these)
1. **No-LLM production output** — every new source/extractor/wiring shipped is deterministic code. The run MAY use the LLM to build/fix and to read+diff the oracle. A field a deterministic source can't supply → keep building the source (full-build in scope) or, only after the full per-source budget, file a scoped sub-issue — NEVER an LLM value written.
2. **NO prod writes; NO deploy.** This goal produces code + sources + tests + a backfill SCRIPT proven on samples. The actual prod backfill (142 stuck IPOs, description/sector, Ather ingestion) and the deploy are the owner's **July-1 batch**. Prod is READ-ONLY here.
3. **Full source build for #69/#70.** #70: build a real listing-performance source (BSE `StockReachGraph` by scripcode and/or NSE listing-day API) that returns `listing_date`/`listing_price`/`listing_gain` for LISTED-but-stuck IPOs, plus the status-updater fix that advances CLOSED→LISTED once listing data exists. #69: build a `company_description`+`sector` source (DRHP "Our Business" section via the fixed extractor for description; sector from DRHP industry classification / Chittorgarh / Moneycontrol) + field-priority-matrix entries + consolidation mapping (incl. sector→peers cascade).
4. **#71 deterministic historical-IPO ingestion path** — a script/path that ingests an aged-out IPO by name or DRHP URL (download DRHP → fixed extractor → exchange/aggregator scrape for the rest → consolidated record), so Ather-class IPOs CAN be ingested by process (not by LLM). Verify it produces Ather's consolidated record matching the oracle — WITHOUT writing to prod (dry-run / test assertion).
5. **#8 render fix** — find why an OPEN IPO renders ₹1.11 Cr vs the DB's ₹145.78 Cr (likely a unit/scale bug or stale cache on the OPEN live-render path) and fix the ROOT cause; verify with a component/integration test + a UI screenshot showing the correct issue size for an OPEN IPO.
6. **Oracle verification** per issue: Chittorgarh + Moneycontrol; agree (money ±1%, dates/counts exact) → our value must match; single-source → best-effort; disagree → SOURCE-CONFLICT. Freeze oracle values as test fixtures.
7. **Git:** branch `feat/ipo-data-quality-fixes` off post-#68 main; conventional commits per logical fix; **PR to main, NO auto-merge** (owner merges in the July-1 batch). CI stays manual-dispatch.
8. **Per-issue budget:** generous for source-building (full-build in scope), but the failure-recovery budget is the backstop — after the full budget on a genuinely-unbuildable source, DEFER + file a scoped sub-issue + continue; never halt the whole run.

## Stages
### Stage 0: Ledger + oracle baselines
- **Do:** Create `docs/contracts/.run/ipo-data-quality-fixes-LEDGER.md` with rows for #8/#69/#70/#71 sub-tasks. Read-only prod query (tunnel) to quantify #70 (list the stuck CLOSED/null-listing IPOs) + #69 (confirm 0/285). Freeze oracle fixtures for 3–5 sample IPOs per issue.
- **Acceptance:** ledger exists with sub-task rows TODO; the stuck-IPO set + 0/285 confirmed from prod (read-only); oracle fixtures frozen.

### Stage A: #8 — OPEN-IPO issue-size render bug
- **Do:** Reproduce (csm or any OPEN IPO: UI ₹1.11 Cr vs DB ₹145.78 Cr). Root-cause the OPEN-specific render/cache path. Fix root cause. Add a failing-first test (component/integration) + fix → green. UI screenshot at 390/768/1280 showing correct issue size for an OPEN IPO.
- **Acceptance:** test green asserting OPEN-IPO issue size == DB value == oracle; screenshot shows correct value; bug-triage "why missed?" + sibling sweep (other OPEN-only computed fields) recorded.

### Stage B: #70 — listing source + CLOSED→LISTED advance
- **Do:** Build the deterministic listing-performance source (BSE `StockReachGraph` by scripcode / NSE listing API) returning `listing_date`/`listing_price`/`listing_gain`; fix the status-updater to advance CLOSED→LISTED once listing data exists. Prove on ≥5 of the 142 stuck IPOs: the source returns correct listing data oracle-matched (integration test with frozen fixtures). Deliver the backfill SCRIPT (idempotent, via `upsertIPO`) but DO NOT run it against prod (dry-run + test only).
- **Acceptance:** integration test green — for ≥5 sample stuck IPOs the new source yields `listing_date`/price/gain matching the CG/MC oracle; status-updater unit test advances CLOSED→LISTED given listing data; backfill script exists + dry-run-validated; remaining un-sourceable cases (if any, after full budget) → scoped sub-issue.

### Stage C: #69 — description + sector source
- **Do:** Build deterministic `company_description` (DRHP "Our Business" via the fixed extractor) + `sector` (DRHP industry / Chittorgarh / Moneycontrol) sources; add field-priority-matrix entries + consolidation mapping + sector→peers cascade. Prove on ≥5 IPOs vs oracle.
- **Acceptance:** integration test green — description+sector populated + oracle-plausible for ≥5 sample IPOs; matrix entries present; no LLM values.

### Stage D: #71 — historical-IPO deterministic ingestion path
- **Do:** Build the by-name/by-DRHP-URL ingestion path (download DRHP → fixed extractor → exchange/aggregator scrape → consolidated record), routed through `upsertIPO` (but NOT executed against prod). Prove it produces **Ather's** consolidated record matching the frozen oracle (dry-run / test assertion), end-to-end deterministic.
- **Acceptance:** test green — the path yields Ather's consolidated record (financials from the fixed extractor + scraped offer/dates/subscription/listing) matching the oracle, with NO prod write and NO LLM value.

## Verification gates
> **All `.claude/rules/` operative. Test by BLAST RADIUS.** Placement per `testing.md` + `scraper-test-layout.md` (unit/integration tiers) + `e2e-best-practices.md`.

| Gate | Hub rule | What it gates | Fires |
|---|---|---|---|
| **Supervisor verification** | `supervisor-verification.md` | Reproduce the claimed gate + inspect substance; for #8 UI, drive the running app (screenshot + console) | every worker output; Stage A UI |
| **Blind test verification** | `independent-test-verification.md` | Each oracle-match/fix verdict re-checked by a separate context-blind agent + raw evidence | every stage verdict (non-skippable) |
| **Output plausibility** | `output-plausibility-verification.md` | Computed/displayed values domain-sane on the default path (issue size, listing gain) | any computed/user-facing value |
| **Bug-triage discipline** | `bug-triage-discipline.md` | Each fix carries repro + "why missed?" + repo-wide sibling-class audit | every stage + every sub-issue filed |
| **Persistence verification** | `e2e-persistence-verification.md` | N/A for prod (no prod writes); for any test-DB/fixture round-trip, read-back asserts the value | only if a stage uses a test-DB write |
| **DoD verbs** | `dod-verbs.md` | Each DoD criterion states ACTION + COMPLETENESS BAR | DoD below |
| **Static gates** | project | `cd packages/shared && npx tsc` (0); `cd web && npx tsc --noEmit && npm run lint && npx vitest run <changed>`; `cd scraper && npx vitest run -c vitest.config.ts <changed>` (+ integration config) — green for every tree touched | every code stage |

**Evidence-handoff:** copy browser screenshots into this run's evidence dir + `ls`-confirm before handing to the blind verifier.

## Failure-recovery budget
- **Per-source/per-issue budget:** generous (full-build in scope) — but after the full budget on a genuinely-unbuildable source, DEFER + file a scoped sub-issue + CONTINUE. Never halt the run on one source/field.
- **Tool-hang (browser/MCP/dev-server):** 3 cycles — wait+retry; close+reopen; kill+restart captured-PID dev server → then DEFER that item + continue.
- **Hard halt ONLY:** dependency install failure; a contradiction inside this contract; an irrecoverable build break after the full budget; OS permission denial; a missing required credential. **Context-budget anxiety is NOT a halt** — hand off via a one-line continuation note; never fake-complete.

## Commit + push policy
- **Granularity:** one commit per logical fix/source/stage.
- **Message format:** Conventional Commits (`.claude/rules/git-collaboration.md`) + the Co-Authored-By + Claude-Session trailers.
- **Branch / push target:** `feat/ipo-data-quality-fixes` → push → open a PR to `main`. **NO auto-merge; owner merges in the July-1 batch.**
- **Do NOT stage:** `.run/`, `.run-active.lock`, scratchpad assets, screenshots, `web/.playwright-mcp/`, any `GLOBAL.*` path.

## Definition of Done (ACTION + COMPLETENESS BAR)
- [ ] **#8 fixed:** an OPEN IPO's rendered issue size == its DB value == the oracle — proven by a green component/integration test **and** a screenshot at 390/768/1280; sibling sweep of other OPEN-only computed fields recorded.
- [ ] **#70:** a deterministic listing source + CLOSED→LISTED status-fix that, for **≥5** of the stuck IPOs, yields `listing_date`/price/gain **matching the CG/MC oracle** (green integration test); an idempotent backfill script delivered + **dry-run-validated (NOT run against prod)**.
- [ ] **#69:** deterministic `company_description`+`sector` sources + matrix entries that populate + oracle-plausibly match for **≥5** sample IPOs (green test); sector→peers cascade handled.
- [ ] **#71:** a deterministic historical-IPO ingestion path that produces **Ather's** consolidated record matching the oracle end-to-end (green test), **no prod write, no LLM value**.
- [ ] **No prod write occurred and no `db.insert`/`upsertIPO` ran against prod** — grep/log-audited in the final report; prod access was read-only.
- [ ] Any genuinely-unbuildable source filed as a scoped sub-issue (with repro + why).
- [ ] All baked-in verification gates passed (or each skip recorded with reason).
- [ ] Final report written; Run-end SUMMARY (DONE/PENDING/BLOCKED/NEXT) in PROGRESS + report; PR opened (not merged).

## Guardrails (hard stops)
- **NO prod writes, NO deploy, NO `_gated/` apply** — this goal is code + sources + tests; the prod backfill + deploy are the owner's July-1 batch. Prod is READ-ONLY.
- **No LLM value in any shipped source/path** — build the deterministic source or file a sub-issue.
- **All writes (in tests/dry-runs) route through `upsertIPO`** — never a direct `db.insert` (`scraper-write-path.md`).
- **No new runtime dependency** without recording it; new columns → additive migration in `web/drizzle/migrations/_gated/` (NOT applied).
- **No `5Wealths/` write; no classification change to display non-IPOs.**
- **No synthetic/fake data; no fabricated oracle values** — uncertainty = `**Assumption:** X`; CG↔MC disagreement = SOURCE-CONFLICT.

## Final report (what the closing report must contain)
- Per-issue (#8/#69/#70/#71) outcome: fixed/partial/sub-issue, with commit SHAs + the green-test names + sample-IPO oracle-match table.
- The stuck-IPO count (#70) the new source can now resolve (proven on samples) vs any residual sub-issue.
- Grep-audit proof: no prod write, no LLM value shipped, all routes via `upsertIPO`.
- Skipped (already covered) list from §0.2.
- LEARNINGS TO FOLD BACK (PROPOSE-only — routed per `learnings-routing.md`).
- DONE / PENDING / BLOCKED / NEXT — incl. the explicit NEXT = owner's July-1 batch (merge this PR + #67's, deploy, run the backfill scripts).

## Authorization trail (decisions resolved in the interview)
| Fork | Decision | Why |
|---|---|---|
| Scope | All four: #8/#69/#70/#71 | Batch the run's found gaps before the July-1 deploy |
| Source-build boundary | FULL source build in scope (#69/#70) | Owner wants complete population, not wire-or-skip |
| Prod writes / deploy | NONE — code + sources + tests only; prod read-only | Deferred to the owner's July-1 batch (billing restored → clean CI) |
| No-LLM scope | Production output deterministic; run may use LLM to build/verify | Live prod has no LLM (carried from prior goal) |
| Verification | Tests-first + CG/MC oracle fixtures; UI screenshot for #8 | Prove correctness without prod writes |
| Branch base | off post-#68 main (so #67 fix present) | The #67 extractor underpins #69 description + #71 ingestion |
| Git / merge | feature branch → PR, no auto-merge | Owner merges in the July-1 batch |
| Failure budget | Generous per-source, then sub-issue + continue | Honor full-build intent without infinite loops |

## References (load transitively)
- `.claude/rules/{supervisor-verification, independent-test-verification, output-plausibility-verification, e2e-persistence-verification, dod-verbs, bug-triage-discipline, testing, e2e-best-practices, git-worktrees, learnings-routing, scraper-write-path, financial-column-precision, schema-imports, drizzle-validation-and-inferred-types, ipo-duplicate-detection, canonical-ipo-slug, india-market-hours-cron-tiers, scraper-test-layout, web-data-access, cache-key-and-ttl-ssot, redis-best-effort-fail-open}.md`
- GitHub issues #8, #69, #70, #71, #36; memory `b1-listing-backfill-diagnosis`, `vps-db-tunnel-setup` (read-only prod via `localhost:15432`), `ci-broken-billing-root-cause`.
- `about-me.md` §6 (status-aware availability), `how.md` (pipeline), `scraper/scripts/extract_financials_pdf.py` (#67 fixed extractor — now on main).
