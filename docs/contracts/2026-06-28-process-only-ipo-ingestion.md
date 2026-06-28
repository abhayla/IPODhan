# Contract: process-only (no-LLM) IPO ingestion + oracle parity

**Executor:** /goal (built-in autonomous run)   ·   **Created:** 2026-06-28
**Mission:** Harden IPODhan's **deterministic, LLM-free** data pipeline (source scrapers + the pdfplumber DRHP/RHP extractor + consolidation + `upsertIPO`) until it can ingest **10 IPOs spanning every type** end-to-end, producing a DB record and a rendered detail page whose every available field **matches the Chittorgarh + Moneycontrol oracle**. The production *output* must be 100% LLM-free (live prod has no LLM); this run *may* use the LLM to build, fix, and verify that pipeline. "Done" = for each of the 10 pinned IPOs, every oracle-present + status-available field is process-produced and oracle-matched (data **and** UI), genuinely-unavailable fields are marked correctly-empty with a reason, and every gap the pipeline can't close within budget is a **filed GitHub issue** — never an LLM-extracted value written to the DB.

## §0.1 Worktree isolation
> **First action of the run, before §0.2 and any stage. Non-negotiable.** This run MUST execute in a **dedicated git worktree**, never the user's primary interactive checkout.
> 1. **Isolate:** `root=$(git rev-parse --show-toplevel)`. If `root` is the primary checkout (not an already-dedicated run worktree), create + switch before any stage: `git worktree add ../IPODhan-run-process-only-ipo-ingestion -b feat/process-only-ipo-ingestion` and run every stage there.
> 2. **Claim it:** export a unique `RUN_TOKEN` (e.g. `process-only-ipo-ingestion-<nonce>`) and write the lock: `printf '%s\n' "$RUN_TOKEN" > "$(git rev-parse --show-toplevel)/.run-active.lock"`. A `pre-commit` hook HARD-BLOCKS any commit whose `RUN_TOKEN` ≠ the lock.
> 3. **Release on exit:** the run's FINAL action (after merge/push, OR on any halt/defer) removes the lock: `rm -f "$(git rev-parse --show-toplevel)/.run-active.lock"`. `.run-active.lock` is gitignored.
> 4. **Self-clean ON SUCCESS ONLY:** after the branch is merged + pushed + lock released, `cd` to the primary root and `git worktree remove --force ../IPODhan-run-process-only-ipo-ingestion ; git branch -D feat/process-only-ipo-ingestion ; git worktree prune`. On DEFER/HALT, keep the worktree + branch (needed to resume); release only the lock.
> Full mechanism: `.claude/skills/git-worktrees` ("Background Autonomous-Run Isolation").

## §0.2 Idempotency preflight
> **First action after §0.1, before ANY stage. Non-negotiable.** Safe to run at any time without redoing finished work.
> 1. **Read the coverage ledger** `docs/contracts/.run/process-only-ipo-ingestion-LEDGER.md` — a per-IPO × per-field-group status table (`PASS` / `FIXED` / `CORRECTLY-EMPTY:<reason>` / `ISSUE#<n>` / `TODO`). It is the SSOT for what's done across sessions. If absent, Stage 0 creates it.
> 2. **For every IPO and every field-group, check the ledger + the actual code + `git log` before working it.** If `PASS`/`FIXED`/`CORRECTLY-EMPTY`/`ISSUE#`, do a verify-only pass and move on. If `TODO`/partial, build only the missing delta. Confirm against code (grep/read) — never trust the ledger blindly.
> 3. **Record every skip** in the final report's "skipped (already covered)" list.

## §0.3 Progress log
> **Append-only progress log for the whole run; update BEFORE moving on from each stage/event.**
> 1. **Location:** `docs/contracts/.run/process-only-ipo-ingestion-PROGRESS.md` (this worktree; `.run/` gitignored).
> 2. **First line:** slug · branch · worktree · start time · contract path · one-line mission.
> 3. **Append ≤2-line entries at:** stage start; stage done (+gate result); every defect; every "not working" event **+ what you did**; each independent-review outcome; each defer/skip; each blocker; final result.
> 4. **Format:** `[YYYY-MM-DD HH:MM] <STAGE|PROGRESS|DEFECT|EVENT|DECISION|RECOVERY|BLOCKER|DONE> — <≤2-line summary>`.
> 5. **At run-end, route learnings per `.claude/rules/learnings-routing.md`** (GENERIC → skill/process rule; PRODUCT → product rule or this contract; prefer a gate over prose). Auto-write only the one-line lessons-log entry; everything else PROPOSE-only (`claude-behavior.md` rule 5).
> 6. **Run-end SUMMARY** (final PROGRESS entry + final report): DONE · PENDING(+reason) · BLOCKED(+why) · NEXT(action+owner).

## Scope boundary
- **In scope:** `scraper/src/**`, `scraper/scripts/extract_financials_pdf.py`, `packages/shared/src/**` (schema/validations/repositories/services if a field needs a column or mapping), `web/lib/**` + `web/components/ipo*/**` (UI wiring of stored-but-unwired fields), `scraper/tests/**` + `web/tests/**` (oracle-fixture integration tests), `docs/contracts/.run/**` (ledger + progress).
- **Out of scope:** `D:\Abhay\VibeCoding\5Wealths\` (never write — L-042); applying any `_gated/` migration to prod; `deploy.yml` / any production deploy; making the repo public; changing the IPO-vs-corporate-action classification to *display* non-IPOs (the 1 non-IPO case is exclusion-verification only).
- **Goal type:** bug-fix loop + propagation (pipeline hardening), iterated per-IPO.

## Context to read first
- `about-me.md` §6 + `how.md` — the document-first acquisition strategy, the **status-aware availability matrix** (which fields exist at UPCOMING/OPEN/CLOSED/LISTED), and the source-by-data-class principle. The completeness bar derives from §6.3.
- `scraper/scripts/extract_financials_pdf.py` — the deterministic (no-LLM) DRHP/RHP financial extractor. **Known defect (issue #67):** matches `profit for the year` only (breaks on loss-makers that say "Loss for the year"), mis-detects unit ("lakhs" vs "in ₹ million"), and mis-aligns mainboard layouts → emits empty `metrics`. This is the first fix.
- `scraper/src/services/data-persister.ts` (`upsertIPO`) + `.claude/rules/scraper-write-path.md` — the SINGLE write entry point. **All DB writes MUST go through `upsertIPO`** (validation, field-priority, protection). Never `db.insert(ipos)` directly. Never write LLM-extracted values.
- `scraper/src/scrapers/{bse-api-scraper,investorgain-gmp-scraper,chittorgarh-scraper,*-orchestrator-v2}.ts` — source scrapers. Note: Chittorgarh's `data-read` API is version-blocked (`v=15-11` → "Invalid API Call"); BSE JSON API (`api.bseindia.com/BseIndiaAPI/api/IPO_HomePageDetail/w`, Origin/Referer `bseindia.com`) and InvestorGain (`webnodejs.investorgain.com/cloud/report/data-read/331/1/10/<yr>/<yr-range>/0/ipo`, **perPage=10**) work.
- `scraper/src/config/field-priority-matrix.ts` + `scraper/src/services/data-consolidation-service.ts` — per-field source winner; every new field needs a matrix entry.
- `web/lib/services/ipo-scoring-realtime.ts` — the deterministic IPO Score/Rating formula (5 components, 0–10). Score/Rating/Verdict are computed fields, verified by formula not the oracle.
- `web/app/ipos/[slug]/page.tsx` + `web/components/ipo-detail/**` + `web/components/ipo/**` — the detail page + field components; the UI-wiring target (pattern: `LotDetailsSection`/`ListingDetailsSection` as just wired for bid-tier/OHLC).
- `.claude/rules/{financial-column-precision,schema-imports,drizzle-validation-and-inferred-types,scraper-test-layout,redis-best-effort-fail-open,canonical-ipo-slug,ipo-duplicate-detection}.md`.

## Pre-made design decisions (the run must NOT pause on these)
1. **No-LLM boundary** — the *production pipeline output* (scrapers + `extract_financials_pdf.py` + consolidation + `upsertIPO`) MUST be pure deterministic code. The run MAY use LLM reasoning to write/fix that code and to read+diff the oracle. A field that only an LLM could produce is a **process bug to fix in code** — never an LLM value written to the DB.
2. **Completeness = oracle-anchored + bounded.** A field PASSES when Chittorgarh **and** Moneycontrol agree (money within ±1%; dates/lots/counts/`ISIN`/`symbol` exact) **and** our process-produced value matches. Single source has it → use it as best-effort reference (note it). CG↔MC disagree → mark `SOURCE-CONFLICT`, not our failure, skip. Computed fields (Score/Rating, EPS, P/E, market-cap, dilution) verified by **formula**, not the oracle. Genuinely-unavailable → `CORRECTLY-EMPTY:<reason>` (e.g. loss-maker P/E = N/M; historical IPO has no day-by-day GMP/subscription time-series; IPODhan-only Score absent from CG/MC).
3. **The 10 IPOs** are pinned in Stage 0 (then frozen in the ledger): slot 1 = **Ather Energy** (mainboard, LISTED, loss-maker — RHP already at the path Stage 0 records); slots 2–10 auto-selected deterministically as the most-recent live/DB example of each remaining type (mainboard profitable-listed, mainboard OPEN, mainboard UPCOMING, mainboard CLOSED, SME-BSE, SME-NSE/Emerge, a large IPO, a small IPO) **+ 1 non-IPO** (most-recent FPO or NCD on the BSE board) used ONLY to assert the classifier excludes/labels it. Process ONE IPO fully before the next.
4. **No prod writes during the fix loop.** Dev/verify runs the deterministic pipeline on each IPO's real PDFs/sources and asserts the oracle match via **integration tests** with the CG/MC values captured as fixtures (`scraper/tests/integration/oracle/<slug>.json`). PROD population is the final gated Stage F.
5. **Both data + UI, staged.** Per IPO: (a) data correctness (pipeline → record matches oracle, tested), then (b) UI — wire any stored-but-unwired oracle field into the detail components and visually verify it renders (no blank where the oracle has a value).
6. **Fixes go to the source code, not data patches.** Extractor regex/unit/layout, scraper field coverage, field-priority-matrix entries, schema columns (numeric per `financial-column-precision`), consolidation mapping. New columns → additive migration parked in `web/drizzle/migrations/_gated/` (db:generate is journal-blocked), NOT applied to prod by the run.
7. **Oracle reading** uses browser-UA `curl` of the Chittorgarh + Moneycontrol IPO pages (HTML, since CG's API is blocked); the parsed oracle values are frozen as the test fixtures. The agent MAY reason over the HTML to extract oracle values (verification, not production).
8. **Git:** branch `feat/process-only-ipo-ingestion`; conventional commits, one per logical fix/IPO-stage; **PR to `main`, NO auto-merge** (the user merges). CI stays manual-dispatch (won't auto-trigger).
9. **Per-IPO budget:** ≤15 fix attempts per field-class (5 inline → `/fix-loop` → `/systematic-debugging`) → then file a GitHub issue (with repro + root cause + sibling-class audit per `bug-triage-discipline.md`), mark the field `ISSUE#<n>`, and CONTINUE — never halt the whole run on one field.

## Stages
### Stage 0: Pin the 10 + build the ledger
- **Do:** Query the BSE board (`IPO_HomePageDetail/w`) + InvestorGain list + the prod DB (read-only, via tunnel if up; else DB-independent sources) to select the 10 per decision 3. Write them into `docs/contracts/.run/process-only-ipo-ingestion-LEDGER.md` with the field-group rows (identity, offer-structure, dates, financials, objects, peers, reservation, subscription, GMP, anchor, listing/OHLC, bid-tiers, ISIN, registrar, score) each `TODO`. Record Ather's RHP path.
- **Acceptance:** ledger file exists with exactly 10 IPOs × the field-group rows, each row `TODO`, the non-IPO slot tagged `EXCLUSION-TEST`.

### Stage 1: Fix the DRHP extractor (issue #67) — the unblocker
- **Do:** In `extract_financials_pdf.py`: match `(profit|loss)\s+for\s+the\s+(period|year)` (sign via existing accounting-negative parsing); read the unit from the actual restated-P&L section header (not the SME default); emit a confidence/empty-metrics signal so the consumer never persists silently-empty financials. Add unit tests with fixtures: a loss-maker ("Loss for the year"), an "in ₹ million" unit, a mainboard multi-page P&L.
- **Acceptance:** running the extractor on Ather's RHP returns non-empty `metrics` with revenue/profit(loss)/EPS/net-worth aligned to [2024,2023,2022] in the correct unit; unit tests green (`cd scraper && npx vitest run -c vitest.config.ts <new test>`); reference issue #67.

### Stages 2–11: Per-IPO loop (one stage per pinned IPO, in ledger order)
For IPO *k*:
- **Do:** (a) Read the CG + MC pages → freeze the oracle fixture `scraper/tests/integration/oracle/<slug>.json`. (b) Run the **deterministic** pipeline (download DRHP/RHP → extractor → source scrapers → consolidation → consolidated record) — NO prod write. (c) Diff every field vs the oracle (decision 2). (d) For each mismatch/missing-but-available field, FIX THE PROCESS CODE (decision 6), re-run, re-verify; budget per decision 9 → else file an issue + `ISSUE#`. (e) Write/extend an integration test asserting the record matches the oracle fixture. (f) UI: wire any stored oracle field not yet rendered into the detail components; visually verify it renders at 390/768/1280 (supervisor-verification). (g) Update the ledger rows (`PASS`/`FIXED`/`CORRECTLY-EMPTY`/`ISSUE#`) + PROGRESS. The non-IPO slot: assert the classifier sets `offering_type ≠ IPO` and it is excluded from IPO views (no full population).
- **Acceptance:** for IPO *k*, every ledger field-group row is `PASS`/`FIXED`/`CORRECTLY-EMPTY:<reason>`/`ISSUE#<n>` (none `TODO`); the integration test asserting oracle-match is green; for any UI-wired field, a screenshot shows it rendered non-blank where the oracle has a value; blind-verifier concurs (independent-test-verification).

### Stage F: Final prod population (gated; defers cleanly if tunnel down)
- **Do:** Check `localhost:15432`. **If up:** for each verified IPO, run the real pipeline through `upsertIPO` to write to prod; read back via node+pg and assert the persisted record matches the verified record (persistence gate). **If down:** DEFER — log `BLOCKED: prod write needs the SSH tunnel (owner-started)` in PROGRESS + final report; do NOT attempt prod DDL or tunnel-start (credential-gated). All code/tests/UI work remains complete regardless.
- **Acceptance:** either every verified IPO is upserted + read-back-matched in prod, OR the prod write is recorded DEFERRED with the exact resume command — never silently skipped, never a direct insert.

## Verification gates
> **All `.claude/rules/` are operative. Test by BLAST RADIUS of the changed surface** — full depth in every layer touched. Placement per `testing.md` + `scraper-test-layout.md` (unit/integration/e2e tiers) + `e2e-best-practices.md`.

| Gate | Hub rule | What it gates | Fires |
|---|---|---|---|
| **Supervisor verification** | `supervisor-verification.md` | Reproduce the claimed gate + inspect substance; for UI, drive the running app (screenshot + ARIA + console) — never code-inspection alone | every worker output; every UI-wiring row |
| **Blind test verification** | `independent-test-verification.md` | Each oracle-match verdict re-checked by a separate context-blind agent given the oracle fixture + raw evidence | every IPO's verdict (non-skippable) |
| **Output plausibility** | `output-plausibility-verification.md` | Computed values (score, EPS, P/E, market-cap) domain-sane on the default path | any computed/user-facing value |
| **Persistence verification** | `e2e-persistence-verification.md` | Stage F: the prod upsert actually persisted — node+pg read-back of the just-written row asserts field equality (a returned id is not proof) | Stage F only |
| **Bug-triage discipline** | `bug-triage-discipline.md` | Every filed gap carries repro + "why missed?" + repo-wide sibling-class audit | every `ISSUE#` filing + Stage 1 |
| **DoD verbs** | `dod-verbs.md` | Each DoD criterion states ACTION + COMPLETENESS BAR | DoD below |
| **Static gates** | project | `cd packages/shared && npx tsc` (0); `cd web && npx tsc --noEmit && npm run lint && npx vitest run <changed>`; `cd scraper && npx vitest run -c vitest.config.ts <changed>` (+ integration config for pipeline tests) — green for every tree touched | every code stage |

**Evidence-handoff:** browser screenshots may land in the primary worktree — copy/absolute-path them into this run's evidence dir and `ls`-confirm before handing to the blind verifier.

## Failure-recovery budget
- **Per-field-class fix budget:** ~15 attempts (≈5 inline → `/fix-loop` → `/systematic-debugging`) → file an issue, mark `ISSUE#`, CONTINUE. Never halt the run on one field.
- **Tool-hang (browser/MCP/dev-server):** 3 cycles — wait+retry; close+reopen; kill+restart the captured-PID dev server. All fail → DEFER that UI row + continue.
- **Hard halt ONLY:** dependency install failure; a contradiction inside this contract; an irrecoverable build break after the full budget; OS permission denial; a missing required credential. **Context-budget anxiety is NOT a halt** — hand off via a one-line continuation note in PROGRESS; never fake-complete.

## Commit + push policy
- **Granularity:** one commit per logical fix (extractor fix, a scraper field, a schema column, a UI wiring) and per per-IPO stage close.
- **Message format:** Conventional Commits (`.claude/rules/git-collaboration.md`); end each with the Co-Authored-By + Claude-Session trailers.
- **Branch / push target:** `feat/process-only-ipo-ingestion` → push → open a PR to `main`. **NO auto-merge; the user merges.**
- **Do NOT stage:** `.run/` (gitignored), `.run-active.lock`, scratchpad PDFs/text, screenshots, `web/.playwright-mcp/`, any `GLOBAL.*` path.

## Definition of Done (ACTION + COMPLETENESS BAR)
- [ ] The DRHP extractor (issue #67) **extracts non-empty, correct financials for a loss-maker** — Ather's RHP yields revenue/loss/EPS/net-worth for FY2024/2023/2022 in the right unit; unit tests (loss-maker + "in ₹ million" + mainboard layout) green.
- [ ] For **each of the 10 pinned IPOs**, the deterministic pipeline produces a record whose **every oracle-present + status-available field matches** CG∧MC (money ±1%, dates/lots/counts/ISIN/symbol exact); each is proven by a green integration test asserting the match against the frozen oracle fixture **and** (Stage F, if tunnel up) a prod read-back.
- [ ] **Every** ledger field-group row for all 10 IPOs is `PASS`/`FIXED`/`CORRECTLY-EMPTY:<reason>`/`ISSUE#<n>` — zero `TODO`, zero silent blanks.
- [ ] For **every** stored oracle field, the IPO detail PAGE renders it non-blank where the oracle has a value — verified by a screenshot at 390/768/1280 for each newly-wired field.
- [ ] The non-IPO slot is **excluded/labelled correctly** (`offering_type ≠ IPO`, absent from IPO views) — asserted by a test.
- [ ] **No LLM-extracted value was written to the DB** and **no direct `db.insert`** bypassed `upsertIPO` — grep-audited in the final report.
- [ ] All baked-in verification gates passed (or each skip recorded with reason).
- [ ] Final report written (below); Run-end SUMMARY (DONE/PENDING/BLOCKED/NEXT) in PROGRESS.md + report.

## Guardrails (hard stops)
- **No LLM in the production data path** — if a field can't be produced deterministically, fix the code or file an issue; NEVER write an LLM/hand value to the DB.
- **No `db.insert(ipos)` / direct writes** — only `upsertIPO` (`scraper-write-path.md`).
- **No new runtime dependency** without recording it; prefer existing libs (pdfplumber, pg, cheerio, drizzle).
- **No prod DDL apply, no deploy, no repo-visibility change, no `5Wealths/` write.**
- **No design reinvention** — reuse the named scrapers/components/patterns.
- **No synthetic/fake data; no fabricated oracle values** — surface uncertainty as `**Assumption:** X`; a CG↔MC disagreement is `SOURCE-CONFLICT`, never a guessed value.

## Final report (what the closing report must contain)
- Per-IPO oracle-parity table (field-group × status), with commit SHAs per fix.
- The list of filed `ISSUE#`s (un-closable gaps) with one-line reasons.
- `CORRECTLY-EMPTY` fields with reasons (loss-maker N/M, historical time-series, IPODhan-only).
- Skipped (already covered) list from the §0.2 preflight.
- Grep-audit proof: no `db.insert(ipos)` outside `data-persister`, no LLM value persisted.
- LEARNINGS TO FOLD BACK (PROPOSE-only — routed per `learnings-routing.md`).
- DONE / PENDING / BLOCKED / NEXT summary (incl. whether Stage F prod-write ran or deferred).

## Authorization trail (decisions resolved in the interview)
| Fork | Decision | Why |
|---|---|---|
| Completeness bar | Oracle-anchored + bounded; file-issue-and-continue | "Nothing blank for all types" is literally unachievable; prevents an infinite loop |
| No-LLM scope | Production pipeline OUTPUT only; run may use LLM to build/fix/verify | Live prod has no LLM; the goal is a process-only deliverable |
| Type matrix | IPO sub-type variety + 1 non-IPO exclusion test | Platform is IPO-only by design; non-IPO display is a separate scope |
| Write substrate | Tests-first vs oracle fixtures; prod write = final gated Stage F | No local DB; avoids landing intermediate wrong data in the live DB |
| Completeness level | Both data + UI, staged | User's bar is "labeled on the UI, nothing blank" |
| The 10 / selection | Pinned in Stage 0 (Ather + most-recent-per-type) | Deterministic, re-runnable |
| Git / merge | Feature branch → PR, no auto-merge | Owner merges; CI manual |
| Prod write tunnel-down | DEFER cleanly, never auto-start tunnel/DDL | Credential-gated; keeps run unattended-safe |

## References (load transitively)
- `.claude/rules/{supervisor-verification, independent-test-verification, output-plausibility-verification, e2e-persistence-verification, dod-verbs, bug-triage-discipline, testing, e2e-best-practices, git-worktrees, learnings-routing, scraper-write-path, field (field-priority via scraper-write-path), financial-column-precision, schema-imports, drizzle-validation-and-inferred-types, scraper-test-layout, canonical-ipo-slug, ipo-duplicate-detection, web-display-formatting, web-deploy-readiness}.md`
- `about-me.md` (§6 acquisition strategy + status-aware matrix), `how.md` (pipeline), GitHub issue **#67** (extractor defect).
- DB write: SSH tunnel `localhost:15432` (see auto-memory `vps-db-tunnel-setup`); creds in `D:\Abhay\VibeCoding\GLOBAL.env` (reference by path, never copy).
