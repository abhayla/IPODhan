# Contract: IPO data-correctness audit + fix (oracle-verified, headed-Playwright, independent-QA loop)

**Executor:** /goal (built-in autonomous run) · **Created:** 2026-07-01
**Mission:** Make **every** IPO on https://ipodhan.com show **correct** data (not merely present), and fix **every** open data-quality issue at root cause. For all ~285 IPO/FPO detail pages across every type (MAINBOARD/SME × OPEN/CLOSED/LISTED/UPCOMING), the run must: (1) **cross-verify each key field against the oracle — chittorgarh.com AND moneycontrol.com** — and correct any wrong value at its **root cause** (not a per-row patch); (2) fix the enumerated open issues **#79, #54, #52, #45, #42, #41, #69, #70** plus any issue surfaced during implementation/testing; (3) drive the **real pages in Playwright HEADED mode and screenshot EVERYTHING**; (4) gate every fix through a **context-blind independent QA agent** that reviews the screenshots + the oracle cross-check and **sends any discrepancy back to the dev agent** to fix and re-verify — looping until the QA agent signs off. Fixes are made and tested **in dev**; the actual production **deploy is a single batched deploy at the end**, behind the **owner's explicit approval gate** (`deploy-requires-approval`). **"Done" = the independent QA agent confirms, from screenshots + oracle cross-check, that every in-scope IPO renders correct data, with each fixed at root cause and each residual (genuinely oracle-unavailable) explicitly recorded.**

## §0.1 Worktree isolation
> **First action of the run, before §0.2 and any stage. Non-negotiable.** Run in a **dedicated git worktree off the CURRENT `main`**, never the user's primary checkout.
> 1. **Isolate:** `root=$(git rev-parse --show-toplevel)`. If `root` is the primary checkout, first `git -C "$root" fetch origin && git -C "$root" checkout main && git -C "$root" pull --ff-only`, then `git worktree add ../IPODhan-run-data-correctness -b feat/ipo-data-correctness-audit origin/main` and run every stage there.
> 2. **Claim it:** export a unique `RUN_TOKEN` and write `printf '%s\n' "$RUN_TOKEN" > "$(git rev-parse --show-toplevel)/.run-active.lock"`.
> 3. **Release on exit:** the FINAL action (after PR push, OR on any halt/defer) removes the lock: `rm -f "$(git rev-parse --show-toplevel)/.run-active.lock"`. `.run-active.lock` is gitignored.
> 4. **Self-clean ON SUCCESS ONLY:** after the branch is pushed + PR opened + lock released, leave the worktree+branch for owner review (owner merges + deploys in the batched deploy). On DEFER/HALT, keep worktree+branch; release only the lock.
> Full mechanism: `.claude/skills/git-worktrees`.

## §0.2 Idempotency preflight
> **First action after §0.1, before ANY stage. Non-negotiable.**
> 1. **Read the coverage ledger** `docs/contracts/.run/ipo-data-correctness-audit-LEDGER.md` — a per-issue × per-IPO-field status table (`DONE`/`PARTIAL`/`SOURCE-UNAVAILABLE`/`SUBISSUE#<n>`/`TODO`). If absent, Stage 0 creates it.
> 2. **For every field/issue, check the ledger + actual code + `git log` before building.** If `DONE`/code already implements it (grep/read to confirm) and the oracle cross-check passes, verify-only and move on. If `PARTIAL`, build only the delta.
> 3. **Record every skip** in the final report's "skipped (already covered)" list.

## §0.3 Progress log
> **Append-only progress log for the whole run; update BEFORE moving on from each stage/event.**
> 1. **Location:** `docs/contracts/.run/ipo-data-correctness-audit-PROGRESS.md` (this worktree; `.run/` gitignored).
> 2. **First line:** slug · branch · worktree · start time · contract path · one-line mission.
> 3. **Append ≤2-line entries at:** stage start; stage done (+gate result); every defect; every "not working" event **+ what you did**; each independent-QA-agent verdict (concur/dissent + what it sent back); each defer/skip; each blocker; final result.
> 4. **Format:** `[YYYY-MM-DD HH:MM] <STAGE|PROGRESS|DEFECT|EVENT|DECISION|QA-VERDICT|RECOVERY|BLOCKER|DONE> — <≤2-line summary>`.
> 5. **At run-end, route learnings per `.claude/rules/learnings-routing.md`** (prefer a gate over prose; one home; dedup). Auto-write only the one-line lessons-log entry; everything else PROPOSE-only.
> 6. **Run-end SUMMARY** (final entry + final report): DONE · PENDING(+reason) · BLOCKED(+why) · NEXT(action+owner).

## Scope boundary
- **In scope:** `scraper/src/**` + `scraper/scripts/**` (sources, extractors, status-updater, consolidation, sanitizers, plausibility guards, backfills), `packages/shared/src/**` (schema/validations/repositories/field-priority-matrix/consolidation), `web/**` (any render/field-mapping fix — e.g. #54 revenue_fy vs total_income_fy), `scraper/tests/**` + `web/tests/**` (oracle fixtures + unit/integration/e2e), the oracle-cross-check + headed-screenshot harness under `scraper/scripts/audit/` (new), `docs/contracts/.run/**`.
- **Read-only prod allowed → then owner-gated writes:** node+pg via the SSH tunnel (`localhost:15432`) to READ prod for the audit and to READ-BACK for verification. Prod **writes** (corrective backfills) run **on the VPS via `vps-backfill.yml`** (dry-run default; `--execute` only after the corresponding fix is QA-signed-off), all routed through `upsertIPO` (`scraper-write-path.md`).
- **Out of scope (HARD):** the production **deploy** itself (single batched deploy is the **owner's** call — `deploy-requires-approval`); applying any `_gated/` migration to prod without owner sign-off; `5Wealths/`; changing the IPO-vs-corporate-action classification rules (the `isRealIPO` predicate is correct — see #6/#8; only fix data, never reclassify to force a non-IPO to render).
- **Goal type:** data-correctness audit + bug-fix loop (forward-engineering the sources/guards needed to make data correct).

## Context to read first
- The open issues (read each body): **#79** (listing_performance numeric(5,2) current_gain overflow + integer price columns reject decimals — the 52 orphans), **#54** (Financial Performance "No revenue data" for ~132 IPOs — C3b stored `total_income_fy*`, UI reads `revenue_fy*` → field-mapping mismatch), **#52** (7 IPOs `close_date` after `allotment_date` — consolidation name-match mis-merge), **#45** (registrar values include address-pollution + missing-space), **#42** (name-quality: a write path bypasses `sanitizeCompanyName`), **#41** (allotment_date backfill ships 7 domain-absurd dates — no plausibility guard), **#69** (`company_description`+`sector` populated only 53%/92%; sector VALUE still NSE-driven — #73), **#70** (stuck CLOSED→LISTED; residual coverage #72). Also review **#36** (listing source gap), **#6/#7** (corporate-action pollution + blank pages — fold in ONLY if the audit surfaces a live recurrence).
- Existing prior contract `docs/contracts/2026-06-28-ipo-data-quality-fixes.md` (the source/oracle patterns, dry-run backfill mechanics) and the delivered code it produced: `scraper/src/services/listing-reconciliation.ts`, `scraper/src/services/description-backfill.ts`, `scraper/src/services/historical-ipo-assembler.ts`, `scraper/src/scrapers/chittorgarh-listing-scraper.ts`, `scraper/src/scrapers/chittorgarh-detail-fields.ts`, backfill scripts `backfill-stuck-listing.ts` / `backfill-description-sector.ts` / `ingest-historical-ipo.ts`.
- `scraper/src/config/field-priority-matrix.ts` (per-field source priority + normalization; matrix keys are **camelCase**) + `scraper/src/services/data-consolidation-service.ts`.
- `packages/shared/src/db/schema.ts` (SSOT — the `listing_performance` numeric(5,2)/integer columns behind #79; `financial_data` revenue vs total_income columns behind #54) + `packages/shared/src/db/validations.ts`.
- `web/app/ipos/[slug]/page.tsx` + the KeyMetrics / Financial Performance / IPO-details render path (the #54 field mapping lives on the WEB read side).
- The existing prod screenshot sweep this run should extend: `.sweep/sweep.mjs` (headless; **the new harness must run HEADED**) + the retained `.sweep/screenshots/*.png`.
- `.claude/rules/{scraper-write-path, financial-column-precision, drizzle-migration-gated-ddl, schema-imports, drizzle-validation-and-inferred-types, ipo-duplicate-detection, canonical-ipo-slug, web-display-formatting, web-data-access, cache-key-and-ttl-ssot, redis-best-effort-fail-open, india-market-hours-cron-tiers, scraper-test-layout, repeatable-production-audit, owner-gated-feature-flags, self-hosted-windows-vps-deploy}.md`.
- Memory: `july1-batch-release-status`, `prod-deep-test-2026-07-01`, `vps-db-tunnel-setup`, `ipo-corporate-action-pollution`, `bse-json-api-enrichment`, `ci-broken-billing-root-cause`.

## Pre-made design decisions (the run must NOT pause on these)
1. **Oracle = chittorgarh.com AND moneycontrol.com.** For each IPO field, fetch the value from both. **Agreement** (money within ±1%; dates exact; counts/lot exact; text normalized) → our stored+rendered value MUST match the oracle. **Single-source** (only one oracle has it) → match that one, best-effort. **Disagreement between the two oracles** → mark `SOURCE-CONFLICT` (record both values; do NOT guess; prefer Chittorgarh for IPO structural fields, Moneycontrol for post-listing/financial fields, and flag). **Neither has it** (aged-out IPO) → mark `SOURCE-UNAVAILABLE` (this is an acceptable residual, NOT a failure — the page must then show a graceful "Data Not Available", never blank/NaN).
2. **Fields cross-verified (per IPO, status-aware):** company name, issue size (₹Cr), price band (min–max), lot size, face value, open/close/allotment/listing dates, subscription (total + QIB/NII/Retail where the oracle publishes them), GMP (where applicable/pre-listing), listing price + listing gain % (LISTED), registrar, sector, company description (presence + plausibility, not verbatim), objects-of-issue (presence), financials (revenue/PAT for the disclosed FYs — #54). A field the oracle does not publish for that IPO status is not asserted.
3. **Root cause, never a per-row patch.** Every wrong value must be traced to the SOURCE (scraper/extractor/consolidation/matrix/normalizer) or the RENDER (web field mapping/formatter) and fixed **there**, so the whole class is corrected and re-scrapes stay correct. Direct `UPDATE ipos SET …` to "fix one page" is FORBIDDEN — corrections flow through `upsertIPO` after the source/guard is fixed. #54 is a WEB field-mapping fix (revenue_fy vs total_income_fy), not a data write.
4. **All UI verification runs Playwright in HEADED mode** (`headless: false`; on a headless Linux runner wrap with `xvfb-run`; the Windows VPS runner has a desktop so headed is native). Capture a **full-page screenshot of EVERY in-scope IPO detail page** every audit pass, plus the key list pages, into `docs/contracts/.run/screenshots/<pass>/<slug>.png` (retained; never deleted — they are the QA evidence and the owner-review artifact).
5. **Independent context-blind QA gate (`independent-test-verification.md`) — the loop:** the **dev agent** fixes + captures screenshots + the oracle cross-check report. A **separate QA agent, dispatched fresh with NO knowledge of how the dev agent worked**, is given ONLY {the field list + the raw screenshots + the raw oracle values} and must independently judge, per IPO: does the rendered value match the oracle, is the page visually correct (no blank/NaN/black-box/broken section), is coverage complete. **Any discrepancy the QA agent finds is returned to the dev agent** with the specific IPO+field+evidence; the dev agent root-cause-fixes and re-submits; **loop until the QA agent concurs** (or a field is agreed `SOURCE-UNAVAILABLE`/`SOURCE-CONFLICT`). The dev agent is NEVER its own final verifier. Single-level dispatch: the **T0 orchestrator** runs both waves (dev wave → blind-QA wave → reconcile) per `agent-orchestration.md`.
6. **No LLM values in shipped data.** Every corrected value comes from a deterministic source/extractor or the oracle cross-check; the run MAY use the LLM to build/diff/route, never to write a fabricated field value. Uncertainty = `**Assumption:** X`; oracle disagreement = `SOURCE-CONFLICT` — never fiction.
7. **Deploy = single batched deploy at the very end, owner-gated.** NOT one fix at a time. All fixes land on `feat/ipo-data-correctness-audit` → one PR → owner merges + triggers ONE `deploy.yml` run (`skip_tests=false`). Corrective prod backfills run via `vps-backfill.yml` AFTER deploy, dry-run-then-execute, each QA-signed-off. The run itself performs NO prod deploy and NO un-gated prod write.
8. **#79 fix specifics (baked):** widen `listing_performance.current_gain_percent` + `listing_gain_percent` `numeric(5,2)` → `numeric(7,2)`, and `listing_price`/`issue_price`/`current_price`/`current_price_bse`/`current_price_nse` `integer` → `numeric(10,2)` (per `financial-column-precision.md`); update `schema.ts` (mind Drizzle numeric→string return-type ripple to consumers — keep them numbers via the established pattern) + a `_gated/` type-widening migration (owner-applied via tunnel with read-back, per `drizzle-migration-gated-ddl.md`); add a catch integration test (upsert a listing row with currentGainPct=1500 + a decimal price → persists); then re-run `backfill:stuck-listing --execute` to fill the 52 orphans.
9. **Git:** branch `feat/ipo-data-correctness-audit` off current `main`; conventional commits per logical fix; **one PR to main, NO auto-merge**; CI stays manual-dispatch (billing — `ci-broken-billing-root-cause`).
10. **Per-issue budget:** generous for source-building; after the full per-source budget on a genuinely-unbuildable source/field, mark `SOURCE-UNAVAILABLE`/`SUBISSUE#n` + CONTINUE — never halt the whole run.

## Stages
### Stage 0: Ledger + oracle & headed-screenshot harness
- **Do:** Create the LEDGER (rows = each in-scope IPO × each cross-verified field, + a row per open issue #79/#54/#52/#45/#42/#41/#69/#70). Build the **oracle harness** `scraper/scripts/audit/oracle-crosscheck.ts` — given a slug/company, fetch the field set from **chittorgarh.com** and **moneycontrol.com**, normalize, and emit a per-field {ours, chittorgarh, moneycontrol, verdict∈CORRECT|WRONG|SOURCE-CONFLICT|SOURCE-UNAVAILABLE}. Build/extend the **headed screenshot sweep** `scraper/scripts/audit/headed-sweep.mjs` (Playwright `headless:false`, full-page shot of every in-scope page → `docs/contracts/.run/screenshots/<pass>/`). Freeze oracle fixtures for ≥5 sample IPOs per type as test anchors.
- **Acceptance:** LEDGER exists (all rows TODO); oracle harness returns a per-field verdict for a 5-IPO smoke set matching hand-checked truth; headed sweep produces real screenshots for the smoke set; fixtures frozen.

### Stage 1: Full audit (discovery) — oracle cross-check + headed screenshots for ALL ~285 IPOs
- **Do:** Run the oracle harness + headed screenshot sweep over **every** in-scope IPO. Produce the per-IPO×per-field correctness matrix + a per-page screenshot. Classify each field CORRECT / WRONG / SOURCE-CONFLICT / SOURCE-UNAVAILABLE, and each page render OK / BLANK / NaN / BLACK-BOX-class / BROKEN-SECTION. **This is the exhaustive discovery of every data-correctness + render defect** (item 1 + item 2 of the owner brief).
- **Acceptance:** the full matrix exists for all in-scope IPOs; every WRONG value and every render defect is enumerated with evidence (oracle values + screenshot path); the set of root-cause CLASSES is derived (grouped, not per-row). **Independent blind-QA wave** re-checks a random ≥15% sample of the matrix against the raw screenshots+oracle and concurs the classification is right before Stage 2 builds on it.

### Stage 2: Root-cause fixes (dev) — the enumerated issues + every class found in Stage 1
- **Do:** For each class (the 8 named issues + any WRONG-value/render class from Stage 1), trace to the single root cause and fix it in dev (source/extractor/consolidation/matrix/normalizer/plausibility-guard, or web field-mapping/formatter). Each fix carries a failing-first test (`bug-triage-discipline.md`: repro + "why missed?" + repo-wide sibling sweep). Examples baked: #54 → web `revenue_fy*`↔`total_income_fy*` mapping; #79 → precision migration + backfill; #52 → consolidation date mis-merge guard + correct via `upsertIPO`; #45 → registrar parse/normalize; #42 → route the bypassing write through `sanitizeCompanyName`; #41 → allotment-date plausibility guard.
- **Acceptance:** per class, green unit/integration test + the class's sample IPOs now oracle-match (or SOURCE-UNAVAILABLE recorded); sibling sweep done; no per-row patch; all writes via `upsertIPO`. Blind-QA wave concurs per class.

### Stage 3: Corrective backfills (VPS, dry-run→execute) + re-scrape
- **Do:** For classes needing prod data correction, run the corrective backfill on the VPS via `vps-backfill.yml` (extend it if a new target is needed) — **dry-run first, verify sane + oracle-matched, then `--execute`** (owner-gated for the actual write). Route everything through `upsertIPO`. Apply the #79 `_gated/` migration to prod via tunnel (owner sign-off + read-back) BEFORE its backfill.
- **Acceptance:** dry-run reports sane counts + 0 implausible; post-execute read-back shows the corrected values persisted; a re-run oracle cross-check on the affected IPOs now returns CORRECT (or SOURCE-UNAVAILABLE). No prod deploy yet.

### Stage 4: Full re-verification pass + independent-QA sign-off
- **Do:** Re-run the headed screenshot sweep + oracle cross-check over **all** in-scope IPOs (post-fix, on the dev/preview build or, after the batched deploy, on prod). Dispatch the **context-blind QA agent** over the full evidence set; every discrepancy it returns loops back to Stage 2 for the dev agent to root-cause-fix; repeat until the QA agent signs off that every in-scope IPO is CORRECT or an explicitly-recorded acceptable residual.
- **Acceptance:** QA agent's final verdict: for every in-scope IPO, each field CORRECT or {SOURCE-CONFLICT|SOURCE-UNAVAILABLE recorded}; each page renders correctly (no blank/NaN/black-box/broken). The final retained screenshot set is the owner-review artifact.

### Stage 5: Batch deploy (owner-gated) + post-deploy prod re-verify
- **Do:** Open ONE PR (all fixes). **ESCALATE to owner for the single batched deploy** (`deploy-requires-approval`): on approval, owner merges + one `deploy.yml` run; then run the corrective `vps-backfill --execute` waves; then re-run headed sweep + oracle cross-check + `npm run audit:prod` + `prod-verify.yml` on prod. NOT one deploy at a time.
- **Acceptance:** post-deploy prod passes the QA-agent sign-off + `audit:prod` (exit 0) + `prod-verify` green; final prod screenshots retained.

## Verification gates
> **All `.claude/rules/` operative. Test by BLAST RADIUS.** Placement per `testing.md` + `scraper-test-layout.md` + `e2e-best-practices.md`.

| Gate | Hub rule | What it gates | Fires |
|---|---|---|---|
| **Independent blind-QA** | `independent-test-verification.md` | A context-blind QA agent re-checks screenshots + oracle values; discrepancies routed back to dev; loop to sign-off | every audit/verify pass (non-skippable) |
| **Supervisor verification** | `supervisor-verification.md` | T0 reproduces the claimed gate + drives the HEADED app (screenshot + console) before accepting a worker's "fixed" | every worker output; every UI fix |
| **Output plausibility** | `output-plausibility-verification.md` | Every corrected value domain-sane on the DEFAULT page (issue size, gain %, dates, tax-free of absurdities) | any computed/displayed value |
| **Bug-triage discipline** | `bug-triage-discipline.md` | Each fix carries repro + "why missed?" + repo-wide sibling-class audit | every class fixed + every sub-issue filed |
| **Persistence verification** | `e2e-persistence-verification.md` | Every corrective write read back from prod (tunnel) asserts the value landed | every `--execute` backfill |
| **DoD verbs** | `dod-verbs.md` | Each DoD criterion states ACTION + COMPLETENESS BAR | DoD below |
| **Static gates** | project | `cd packages/shared && npx tsc` (0); `cd web && npx tsc --noEmit && npm run lint && npx vitest run <changed>`; `cd scraper && npx vitest run -c vitest.config.ts <changed>` (+ integration config) — green for every tree touched | every code stage |

**Evidence-handoff:** the dev agent copies the headed screenshots + the oracle-crosscheck JSON into the pass's evidence dir + `ls`-confirms before handing to the blind QA agent (which gets paths, not conclusions).

## Failure-recovery budget
- **Per-source/per-field budget:** generous (full-build in scope) — after the full budget on a genuinely-unbuildable source/field, mark `SOURCE-UNAVAILABLE`/file a scoped `SUBISSUE#n` + CONTINUE. Never halt on one field.
- **Oracle-fetch hardening:** chittorgarh/moneycontrol may rate-limit or block — throttle, retry with backoff, cache responses; if an oracle is unreachable after the retry budget, degrade to the reachable one + flag; NEVER fabricate an oracle value.
- **Tool-hang (browser/headed/MCP/dev-server):** 3 cycles — wait+retry; close+reopen; kill+restart captured-PID dev server → then DEFER that item + continue.
- **Hard halt ONLY:** dependency install failure; a contradiction inside this contract; an irrecoverable build break after the full budget; OS permission denial; a missing required credential. **Context-budget anxiety is NOT a halt** — hand off via the §0.3 log + a one-line continuation note; never fake-complete.

## Commit + push policy
- **Granularity:** one commit per logical fix/class/stage.
- **Message format:** Conventional Commits (`git-collaboration.md`) + the Co-Authored-By + Claude-Session trailers.
- **Branch / push target:** `feat/ipo-data-correctness-audit` → push → ONE PR to `main`. **NO auto-merge; owner merges + deploys in the single batched deploy.**
- **Do NOT stage:** `.run/`, `.sweep/`, `docs/contracts/.run/screenshots/`, `.run-active.lock`, any screenshot artifacts, `web/.playwright-mcp/`, any `GLOBAL.*` path.

## Definition of Done (ACTION + COMPLETENESS BAR)
- [ ] **Oracle cross-check RUN for EVERY in-scope IPO** (all ~285 IPO/FPO detail pages), each key field classified CORRECT / WRONG / SOURCE-CONFLICT / SOURCE-UNAVAILABLE against chittorgarh.com AND moneycontrol.com — the full per-IPO×per-field matrix exists (not a sample).
- [ ] **Every WRONG value fixed at ROOT CAUSE** (source/consolidation/matrix/normalizer/guard or web mapping), proven by: the class's green test + the affected IPOs re-cross-checked to CORRECT; **no per-row `UPDATE` patch**; all writes via `upsertIPO`.
- [ ] **All named issues resolved:** #79 (precision migration + 52 orphans backfilled + catch test), #54 (revenue mapping — Financial Performance shows real revenue/PAT), #52 (7 date-corrupted fixed at the consolidation root), #45 (registrar clean), #42 (name-quality — bypassing write routed through sanitizer), #41 (allotment plausibility guard + the 7 absurd dates corrected), #69 (description+sector coverage raised; residual → #73), #70 (stuck-listing coverage extended; residual → #72) — each with a green test.
- [ ] **HEADED-Playwright screenshots captured for EVERY in-scope IPO** each verify pass and **retained** (`docs/contracts/.run/screenshots/`), forming the owner-review artifact — nothing deleted.
- [ ] **Independent context-blind QA agent has signed off**: for every in-scope IPO it confirms, from screenshots + oracle values, each field CORRECT or an explicitly-recorded acceptable residual (SOURCE-CONFLICT/SOURCE-UNAVAILABLE), and each page renders correctly (no blank / NaN / black-box / broken section). Every discrepancy it raised was routed back to the dev agent and re-verified to closure.
- [ ] **No prod deploy performed by the run; no un-gated prod write** — grep/log-audited; the single batched deploy + corrective `--execute` backfills are owner-approved.
- [ ] Any genuinely-unbuildable source/field filed as a scoped sub-issue (repro + why); every SOURCE-UNAVAILABLE recorded.
- [ ] All baked-in verification gates passed (or each skip recorded with reason).
- [ ] Final report written; Run-end SUMMARY (DONE/PENDING/BLOCKED/NEXT) in PROGRESS + report; ONE PR opened (not merged); NEXT = owner's single batched deploy + corrective backfills.

## Guardrails (hard stops)
- **NO prod deploy; NO un-gated prod write; NO `_gated/` apply without owner sign-off** — the batched deploy + corrective backfills are the owner's call.
- **Root cause only — NO per-row `UPDATE` patch** to make one page look right; fix the source/render class and let `upsertIPO`/the re-scrape correct all instances.
- **The dev agent is NEVER its own final verifier** — the context-blind QA agent must independently sign off from the raw screenshots + oracle values.
- **No LLM/fabricated field value; no synthetic data** — deterministic source or oracle only; disagreement = SOURCE-CONFLICT; missing = SOURCE-UNAVAILABLE.
- **All UI verification is HEADED Playwright with a screenshot of every page** — a headless pass or a text-only check does NOT satisfy a verify gate.
- **Do NOT reclassify a non-IPO (FPO/OFS/RIGHTS/NCD) to force it to render** — `isRealIPO` 404 is correct (#6/#8); only fix genuine IPO data.
- **No new runtime dependency** without recording it; new/changed columns → additive/type-widening migration in `_gated/` (owner-applied), never an in-place prod `ALTER` by the run.
- **No `5Wealths/` write.**

## Final report (what the closing report must contain)
- The full per-IPO×per-field oracle-correctness matrix summary: counts of CORRECT / fixed-WRONG / SOURCE-CONFLICT / SOURCE-UNAVAILABLE, by IPO type.
- Per named issue (#79/#54/#52/#45/#42/#41/#69/#70): outcome (fixed/partial/sub-issue) + commit SHAs + green-test names + sample-IPO oracle-match table.
- The independent QA agent's final sign-off statement + the list of discrepancies it raised and how each was closed (the dev↔QA loop trail).
- The retained screenshot set location (owner-review artifact) — headed, per-IPO, retained.
- Grep-audit proof: no prod deploy, no un-gated prod write, no per-row patch, no LLM value; all via `upsertIPO`.
- Skipped (already covered) list from §0.2.
- LEARNINGS TO FOLD BACK (PROPOSE-only — routed per `learnings-routing.md`).
- DONE / PENDING / BLOCKED / NEXT — incl. the explicit NEXT = owner's single batched deploy (merge the PR, apply the #79 gated migration, run corrective `--execute` backfills, redeploy) + owner review of the retained screenshots.

## Authorization trail (decisions resolved before drafting)
| Fork | Decision | Why |
|---|---|---|
| Oracle | chittorgarh.com AND moneycontrol.com; agree→match, single→best-effort, disagree→SOURCE-CONFLICT, neither→SOURCE-UNAVAILABLE | Owner named both; two-source cross-check is the correctness bar |
| Correctness vs presence | Verify each value is RIGHT vs oracle, not just present | Owner's core point — a wrong-but-present value must be caught |
| Fix approach | Root cause in the source/render class; NO per-row patch | Owner: "always fix the root cause, don't patch" |
| Test mode | Playwright HEADED, screenshot EVERYTHING, retained | Owner: headed mode for all testing; screenshots are the QA evidence |
| Verification | Context-blind independent QA agent; discrepancy → back to dev agent; loop to sign-off | Owner: independent QA agent sends issues back to dev; `independent-test-verification.md` |
| Deploy | ONE batched deploy at the end, owner-gated; corrective backfills on VPS after | Owner: "don't deploy one at a time; deploy everything together at the end" |
| Scope | The 8 named issues + any found during implementation/testing | Owner: "all open issues + any found" |
| Prod writes | Read-only audit via tunnel; corrective writes via vps-backfill (dry-run→gated execute) through upsertIPO | Owner deploy-approval gate + write-path SSOT |

## References (load transitively)
- `.claude/rules/{supervisor-verification, independent-test-verification, output-plausibility-verification, e2e-persistence-verification, dod-verbs, bug-triage-discipline, testing, e2e-best-practices, git-worktrees, learnings-routing, scraper-write-path, financial-column-precision, drizzle-migration-gated-ddl, schema-imports, drizzle-validation-and-inferred-types, ipo-duplicate-detection, canonical-ipo-slug, web-display-formatting, web-data-access, cache-key-and-ttl-ssot, redis-best-effort-fail-open, india-market-hours-cron-tiers, scraper-test-layout, repeatable-production-audit, owner-gated-feature-flags, self-hosted-windows-vps-deploy, decision-authority}.md`
- `.claude/skills/git-worktrees/SKILL.md`
- GitHub issues #79, #54, #52, #45, #42, #41, #69, #70 (+ #36, #72, #73, #6, #7); prior contract `docs/contracts/2026-06-28-ipo-data-quality-fixes.md`.
- Memory: `july1-batch-release-status`, `prod-deep-test-2026-07-01`, `vps-db-tunnel-setup`, `ipo-corporate-action-pollution`, `ci-broken-billing-root-cause`.
- Prod DB: read/write via SSH tunnel `localhost:15432` (creds in `web/.env.local`); corrective writes execute on the VPS via `.github/workflows/vps-backfill.yml`.
