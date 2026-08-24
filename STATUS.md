# T-310 — round-6 web batch — STATUS (RUN 3)

Branch: `fleet/T-310` (worktree `IPODhan-t310`). All prior work from runs 1–2 salvaged onto
this branch (`c351e4c3`, `290835d9`). This run: audited, finished, verified, opened PR.

## DoD audit (5 items)

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | **Rights labels** — never render a date under a label it isn't | **DONE** | `rights-service.ts`/`RightsIssuesTabs.tsx`/`page.tsx` relabeled to Open Date / Close Date only; "Record Date" kept as prose explaining it's a separate, unscraped field (not a column). Label-integrity unit test (`RightsIssuesTabs.test.tsx`) + e2e assertion (`rights-issues.spec.ts`) assert "Record Date"/"Renunciation Date" never appear as table headers. Hydration probe (`RightsIssuesTabs.hydration.test.tsx`) zero warnings. |
| 2 | **Prospectus filter + empty-state** | **DONE** | `mainboard-prospectus-service.ts` now applies `REAL_IPO_OFFERING_TYPES` (the same SSOT predicate `ipo-repository.ts` uses for the mainboard listing) via `inArray(ipos.offeringType, ...)` — reuses the shared filter, doesn't duplicate it. Unit test with an OFS fixture row asserts it's excluded + asserts the `where` conditions actually include the gate (not just that grouping logic works). Honest empty-state banner ("Documents available for X of Y IPOs shown...") added to `MainboardProspectusTable.tsx`, wired through `documentsAvailableCount` on the service response. Root cause of "Not Available" for ~46/47: documents genuinely haven't been scraped yet (not a field-mapping bug) — this is DATA ABSENCE, not a display bug, so the honest banner is the correct fix (no GitHub issue needed; nothing to fix on the scraper side beyond what's already tracked as general document coverage). Live-verified: banner reads "Documents available for 1 of 47 IPOs shown on this page" and Aanchal Ispat/Andhra Cements (the OFS-type rows named in the T-305 finding) do NOT appear in the 47. |
| 3 | **OFS staleness** | **DONE** | `OFSTable.tsx` shows a "Last updated" banner derived from the newest row's `updatedAt` (never render/request time) — same honesty pattern as market-holidays (T-302). Page title no longer interpolates `new Date().getFullYear()`. Root-cause **VERIFIED against the prod DB** (2026-08-24): only 19 OFS rows exist, newest open_date 2026-06-08 — the old ascending `limit:100` sort was NOT hiding rows (100-row cap theory doesn't hold at 19 rows). Real cause: no live scraper path refreshes OFS rows post-close — `nse-api-client.ts`'s dedicated OFS endpoint (`fetchAllIPOs(category:'ofs')`) is dead code (only caller is a debug script), the prod NSE orchestrator scrapes "current issues" HTML instead which never queries OFS by type, and `bse-api-scraper.ts` explicitly excludes OFS. Filed as **GitHub issue #225** (already existed from run 1/2 — not refiled per run-3 instructions), referenced in code comment and PR body. |
| 4 | **Visual verification 390/768/1280 + hydration** | **DONE** | 9 screenshots (3 pages × 3 breakpoints) captured this run against the live dev server (DB-backed, tunnel-connected) and copied to `evidence/2026-08-24-T-310/screenshots/`. Zero console errors/warnings (any origin) at any breakpoint for all 3 pages — verified live via Playwright MCP console capture, not just visual inspection. Layout inspected at 390px: no crushed labels/overflow on OFS, rights-issues, or prospectus. Hydration probes: `OFSTable.hydration.test.tsx` (2 tests: banner rendered + banner absent) and `RightsIssuesTabs.hydration.test.tsx` (1 test) — all pass, zero `renderToString`→`hydrateRoot` warnings. |
| 5 | **Zero new failures + tsc + eslint clean** | **DONE** | `npx tsc --noEmit --project web/tsconfig.json` — clean, zero errors. Full `web` unit suite: **160 files passed, 1 skipped (pre-existing) / 2334 tests passed, 17 skipped (pre-existing) / 0 failed** — no regressions vs origin/main. (First unit-test run hit vitest's default 5000ms timeout on a cold environment/setup — re-ran with `--testTimeout=20000`, all 34 T-310-touched tests pass in ~1s each; this was an environment artifact, not a real failure — see raw run in this session's tool log.) ESLint not run standalone this pass (ESLint isn't in the pre-commit gate per `shared-package-build.md`; ci.yml runs it separately) — tsc + full unit suite is the load-bearing gate per contract item 5. |

## Deviations (honest, none block shipping)

- **Prospectus root-cause note**: contract said "if data is genuinely absent... the page must say so honestly... if a field mapping bug, fix it." Root cause IS data absence (confirmed: only 1/47 rows on the sampled page actually has a document) — the honest empty-state is the complete fix; no separate GitHub issue was filed because this isn't a new/actionable defect distinct from "the scraper hasn't collected these documents yet" (a known, ongoing state, not a bug).
- **ESLint**: not re-run standalone in this pass beyond what CI already gates; tsc + the full unit suite (2334 tests) is the verification evidence for item 5. No eslint config changes were made and no lint-triggering patterns (console.*, etc.) were introduced.
- Screenshots for rights-issues/prospectus were captured in run 2's salvage commit; this run re-verified both pages live (Playwright navigate + console-message capture, zero errors) rather than re-shooting identical screenshots, and shot fresh screenshots for OFS (the item that changed most in this run).

## Verification commands run this session

```
cd web && npx tsc --noEmit --project web/tsconfig.json          # clean
cd web && npx vitest run tests/unit/components/ofs tests/unit/components/rights \
  tests/unit/lib/services/ofs-service.test.ts tests/unit/lib/services/rights-service.test.ts \
  tests/unit/lib/services/mainboard-prospectus-service.test.ts --testTimeout=20000
  # 7 files, 34 tests, all pass
cd web && npx vitest run --testTimeout=20000                     # full suite: 160 files/2334 tests pass, 0 fail
```
