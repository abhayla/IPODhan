# T-407 — plan: delete the dead DRHP path, make how.md honest

Contract: `T-407-ipodhan-delete-dead-drhp-path`. Context read before this plan:
`docs/reviews/ipo-pipeline-stage-gap-analysis.md` §2 and §4 (pulled from the unmerged
`docs/pipeline-stage-gap-analysis` branch — not present on this branch's tree, read via
`git show docs/pipeline-stage-gap-analysis:docs/reviews/ipo-pipeline-stage-gap-analysis.md`),
`how.md`, `docs/reviews/ipo-document-lifecycle-plan.md`.

## Caller counts (measured on this branch, `grep -rn` over `web/`, `scraper/`, `packages/`,
excluding `docs/`, `evidence/`, `IPODhan-t310/`, `node_modules`)

| File | Callers outside the deleted set | Evidence |
|---|---|---|
| `scraper/src/services/drhp-downloader.ts` | 0 | only `drhp-orchestrator.ts`, `exchange-monitor.ts`, `sebi-monitor.ts` (all deleted), `drhp-pipeline.test.ts` (deleted), one comment in `chittorgarh-document-scraper.ts` (comment only, not a caller) |
| `scraper/src/services/drhp-orchestrator.ts` | 0 | only `drhp-pipeline.test.ts` (deleted) |
| `scraper/src/services/drhp-extractor.ts` | 0 | only `drhp-orchestrator.ts`, `drhp-pipeline.test.ts` (both deleted) |
| `scraper/src/services/exchange-monitor.ts` | 0 | only `drhp-pipeline.test.ts` (deleted) |
| `scraper/src/services/sebi-monitor.ts` | 0 | only `drhp-pipeline.test.ts` (deleted) |
| `web/lib/services/drhp-extractor-service.ts` | 0 | only `web/app/api/ipos/[slug]/drhp-extract/route.ts` (deleted) |
| `web/app/api/ipos/[slug]/drhp-extract/route.ts` | 0 | no fetch call anywhere in `web/` references `/api/ipos/.../drhp-extract`; no test |
| `ecosystem.config.js` | 0 (already dead by its own header comment) | `scripts/deploy-linux.sh` starts PM2 apps with explicit CLI flags, never reads this file (confirmed in the file's own T-252 header note) |
| `ENABLE_DRHP_EXTRACTION` flag | 0 real consumers (only its own definition + 4 test mocks that set it `false`) | `scraper/src/config/feature-flags.ts:52,250`; 4 files under `scraper/tests/unit/services/data-consolidation-*.test.ts` |
| every reference to `pdf-parser-test/` | see sibling class below | |

## Sibling class found (0-caller files that exist only to serve the deleted path)

Per the "fix the class, not a symptom" instruction:

1. **`scraper/src/services/manual-review-queue.ts`** — 0 callers outside the deleted set.
   `import type { DRHPExtraction } from './drhp-extractor'` is its only import; only
   `drhp-orchestrator.ts` (deleted) imports it. No test file exists for it. **Delete.**
2. **`web/app/api/admin/drhp/extract/route.ts`** and
   **`web/app/api/admin/drhp/reprocess/[id]/route.ts`** — both build a path into
   `../pdf-parser-test/extract_drhp_pdfplumber_v3.py` (`pdf-parser-test/` does not exist
   anywhere in this repo — confirmed via `find . -iname "*pdf-parser-test*"` returning
   nothing). The DoD requires deleting "every reference to pdf-parser-test/"; gutting the
   `pdf-parser-test` call out of these routes would leave them with no function at all
   (that IS their function). **Delete both route files.**
3. **`web/app/admin/drhp-extraction/page.tsx`** — its only two write actions are
   `fetch('/api/admin/drhp/extract', …)` and `adminPost('/api/admin/drhp/reprocess/${logId}', …)`,
   both being deleted in (2). With those gone the page is a dead UI hitting 404s.
   **Delete.**
4. **`web/tests/e2e/admin/drhp-extraction-integration.spec.ts`** — E2E test for the page
   being deleted in (3). **Delete.**
5. Three dashboard files link to `/admin/drhp-extraction` (the page deleted in (3)):
   `web/app/admin/components/EnhancedDashboard.tsx`, `web/app/admin/dashboard/dynamic-tables.tsx`,
   `web/app/admin/metrics/page.tsx`. These are NOT DRHP-only — `metrics/page.tsx` is a
   4-section pipeline dashboard (Detection/Consolidation/DRHP/Data Quality) whose
   `/api/admin/metrics/data-pipeline` data source reads the generic `documents` table, not
   any deleted service. **Edit only the broken link/href to the deleted page; leave the
   surrounding metric displays alone** (out of scope — not part of the dead DRHP code path).

## Explicitly NOT deleted (checked, has legitimate live callers)

- `web/app/api/admin/drhp/ipo/[ipoId]/route.ts` — only reads `extractionLogs`, no
  `pdf-parser-test` reference; used by `web/components/admin/ExtractionResultsViewer.tsx`,
  which is also used by `web/app/admin/dynamic/[table]/[id]/page.tsx` and
  `web/app/admin/edit/[slug]/page.tsx` (generic admin infra, unrelated pages). Deleting it
  would break those. **Keep.**
- `scraper/tests/load/drhp-concurrent.test.ts` and
  `web/tests/integration/data-flow/drhp-financial-priority.integration.test.ts` — neither
  imports any deleted file; both exercise `DataConsolidationService` / the field-priority
  matrix with "DRHP" as a source label, which remains meaningful (the kept
  `extract_financials_pdf.py` pipeline still produces DRHP-sourced data). **Keep.**
- `scraper/src/services/normalization-engine.ts`, `scraper/src/services/ipo-deduplication.ts`
  — imported by `sebi-monitor.ts`/`exchange-monitor.ts` (deleted) but also by
  `data-consolidation-service.ts`, `moneycontrol-scraper.ts`, and other live tests. **Keep.**
- `scraper/src/scheduler/**` — grepped for `drhp|DRHP|exchange-monitor|sebi-monitor`; only
  comment mentions (referring to the kept financials-PDF scripts), no imports of any deleted
  file. No scheduler job needs deletion.
- `documents` DB table / `extractionLogs` DB table — schema/data changes are out of scope
  for a code-deletion contract; left as-is.

## Files to delete

Scraper services + tests:
- `scraper/src/services/drhp-downloader.ts`
- `scraper/src/services/drhp-orchestrator.ts`
- `scraper/src/services/drhp-extractor.ts`
- `scraper/src/services/exchange-monitor.ts`
- `scraper/src/services/sebi-monitor.ts`
- `scraper/src/services/manual-review-queue.ts` (sibling, item 1 above)
- `scraper/tests/integration/drhp-pipeline.test.ts` (imports all five deleted services)

Web:
- `web/lib/services/drhp-extractor-service.ts`
- `web/app/api/ipos/[slug]/drhp-extract/route.ts` (+ its now-empty `[slug]/drhp-extract` dir)
- `web/app/api/admin/drhp/extract/route.ts` (sibling, item 2)
- `web/app/api/admin/drhp/reprocess/[id]/route.ts` (sibling, item 2)
- `web/app/admin/drhp-extraction/page.tsx` (sibling, item 3)
- `web/tests/e2e/admin/drhp-extraction-integration.spec.ts` (sibling, item 4)

Config:
- `ecosystem.config.js`

## Files to edit

- `scraper/src/config/feature-flags.ts` — remove the `ENABLE_DRHP_EXTRACTION` flag
  definition (with its doc comment) and its `DRHP_EXTRACTION` entry in `getFeatureStatus()`.
- `scraper/tests/unit/services/data-consolidation-source-tracking-gate.test.ts`,
  `data-consolidation-service.test.ts`, `data-consolidation-null-incoming.test.ts`,
  `data-consolidation-hold-disputed.test.ts` — remove the `ENABLE_DRHP_EXTRACTION: false`
  line from each mock flags object.
- `scraper/README.md`, `scraper/.env.example` — remove the `ENABLE_DRHP_EXTRACTION` line.
- `web/app/admin/components/EnhancedDashboard.tsx`, `web/app/admin/dashboard/dynamic-tables.tsx`,
  `web/app/admin/metrics/page.tsx` — remove the dead `href="/admin/drhp-extraction"` link
  (sibling, item 5); leave everything else in these files untouched.
- `how.md` — rewrite Steps 1, 7, 12, 16 and the diagram per gap-analysis §4 (see below); no
  other wording changes.

## how.md rewrite (per gap-analysis §4)

- **Step 1**: drop the `ecosystem.config.js` citation (dead config, never read — see the
  file's own T-252 header before this PR deletes it); cite `scripts/deploy-linux.sh`'s
  `pm2 start … --cron-restart=*/30_*_*_*_*` as the real cron mechanism.
- **Step 7**: rewrite entirely. Today: NSE-only document-link discovery
  (`scraper/src/services/primary-source-discovery.ts`, pure/no-network core) behind
  `ENABLE_PRIMARY_SOURCE_DISCOVERY` (default `false`); no download, no extraction wired to
  the live cycle. Remove the "confidence score … flagged for human review" claim (no live
  path). Cite the pure financials extractor that DOES run, on demand:
  `scraper/scripts/extract_financials_pdf.py` via `scripts/backfill-financials-pdf.ts --apply`
  (CLI-only, not part of the scheduled cycle).
- **Step 12**: the tiered IST scheduler (`scraper/src/scheduler/config.ts`) does not run in
  prod. Prod is a flat 30-minute `cron_restart` calling `--source=all` once
  (`scripts/deploy-linux.sh`). The status updater (`triggerStatusUpdate`) runs inside that
  same one-shot cycle (`scraper/src/index.ts`), not from the tiered scheduler.
- **Step 16**: state plainly that financials/peers/objectives/documents render as
  "Awaiting data" for every IPO scraped since launch, because nothing in the live cycle
  writes those tables.
- **Diagram**: remove the "download DRHP/RHP PDF → pdfplumber reads pages →
  financials/objectives/peers" arrow, or mark it "planned — see
  `docs/reviews/ipo-document-lifecycle-plan.md`; status in `docs/reviews/T-403-plan.md` §8–9".
- Add the same pointer near Step 7's prose (not just the diagram).

## Verification (gate commands, run at the end)

1. `cd packages/shared && npx tsc`
2. `cd web && npx tsc --noEmit`
3. `cd scraper && npx tsc --noEmit -p tsconfig.json`
4. `cd scraper && npx vitest run`
5. `cd web && npx vitest run`
6. `grep -rn "drhp-downloader\|DRHPOrchestrator\|pdf-parser-test\|ENABLE_DRHP_EXTRACTION" .`
   excluding `docs/`, `evidence/`, `node_modules` — must return 0 hits.

## Commits (small, conventional)

1. `chore(scraper): remove dead DRHP downloader/orchestrator/extractor/monitor services`
2. `chore(scraper): remove ENABLE_DRHP_EXTRACTION flag and its test references`
3. `chore(web): remove dead DRHP extraction API route, service, and admin UI`
4. `docs: make how.md honest about the DRHP/document-discovery path`

## Deliberately NOT done (and why)

- Did not touch the `documents`/`extractionLogs` DB schema or write a migration — this is a
  code-deletion contract; schema changes need their own gate.
- Did not touch `scraper/scripts/extract_financials_pdf.py`, its test, or
  `scripts/backfill-financials-pdf.ts` — explicitly kept per the contract.
- Did not touch `scraper/src/services/primary-source-discovery.ts` — explicitly kept, and it
  is the live (flagged) replacement path `how.md` now cites.
- Did not edit the `/api/admin/metrics/data-pipeline` DRHP metrics section — it reads the
  generic `documents` table and has no import from the deleted files; rewriting it is out of
  scope for this contract.
