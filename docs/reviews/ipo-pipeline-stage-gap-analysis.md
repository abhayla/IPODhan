# IPO pipeline — stage-by-stage gap analysis and staged test plan (2026-09-02)

Owner ask: "Find the spec for the whole IPO lifecycle (identify → fetch DRHP/RHP from NSE/BSE →
extract → update DB → update the page). Find what is missing or wrong in it. We keep hitting one
error after another when we run it against an IPO; I want to test it in stages."

Traced on `main` @ f20322f0 plus the unmerged T-403 branch `feat/wp-ab-document-discovery-state`
(worktree `IPODhan-wpab`, 06457dd4). Every claim below cites a file.

## 1. There are two specs, and they contradict each other

| Doc | Written | Claims | Reality |
|---|---|---|---|
| `how.md` (root, 19 steps) | Jun 2026 | "architecture as built" — Step 7 downloads the prospectus and runs pdfplumber; Step 12 runs a tiered IST scheduler | Step 7 and Step 12 describe code that has **never run in production** (§2) |
| `docs/reviews/ipo-document-lifecycle-plan.md` (S0–S6, E1–E14, WP A–F) | 28 Aug 2026 | a plan to make the document path real | Accurate. WP A+B are built on the T-403 branch, unmerged. WP C–F not started |

`how.md` is the one the owner remembers as "the detailed spec". It is the one that is wrong.

## 2. What actually runs for a new IPO today (prod, `--source=all` every 30 min)

| Stage | Verdict | Evidence |
|---|---|---|
| A. Discover the IPO (NSE/BSE/MC/CG orchestrators) | RUNS | `scraper/src/index.ts:246–408`, PM2 cron in `scripts/deploy-linux.sh:544` |
| B. Find DRHP/RHP URL | WIRED, FLAG OFF, NSE-only, no retry, 24 h cadence, symbol-gated | `index.ts:753`; `backfill-primary-source-documents.ts:69,88–108`; `ENABLE_PRIMARY_SOURCE_DISCOVERY=false` in the prod env fixture |
| B′. `drhp-downloader.ts` NSE→BSE→SEBI search (the one `how.md` cites) | DEAD + STUBBED | `searchNSE/searchBSE/searchSEBI` are `// TODO … return null` (:212, :254, :290); 0 callers |
| C. Download + store PDF | DEAD | `downloadPDF` (:327) has 0 callers; `documents` table has no `file_path`/`sha256` column |
| D. Extract (pdfplumber) | DEAD + BROKEN | `drhp-extractor.ts` spawns `pdf-parser-test/cli_extractor.py` — that directory is **not in git**; `__dirname` used in an ESM package (throws on construct); `ENABLE_DRHP_EXTRACTION` has 0 consumers |
| D′. The working extractor | CLI ONLY, dry-run | `scraper/scripts/extract_financials_pdf.py` via `scripts/backfill-financials-pdf.ts --apply` |
| E. Write `ipos` | RUNS | `data-persister.ts:196 upsertIPO` |
| E′. Write `financial_data` / `peer_companies` / `objectives` | CLI ONLY | only callers are the dead scheduler jobs (`scheduler/scheduler.ts:266,277,310`) and scripts |
| F. Stage reconciler | FLAG OFF **and hard-coded dry-run** | `index.ts:721 {dryRun:true}`; enqueue branch is an empty comment (`stage-reconciler-job.ts:64–67`) |
| G. Page render | RUNS | shows "Awaiting data" for financials/peers/documents on every real IPO (`web/app/ipos/[slug]/page.tsx:306–318`) |

Net: prod writes `ipos` + subscriptions + GMP + demand graph. It writes **zero** `documents`,
`financial_data`, `peer_companies`, `objectives` rows. The Skyways audit (0 of 18 sourced fields
from filings) was not a coverage dip. There is no code path.

## 3. Why "fix one error, get the next" is the pattern

1. **Each stage was built in isolation and never joined.** Discovery writes `extraction_status='PENDING'`; nothing reads PENDING. The extractor computes a confidence score; the persister has no parameter to receive it. Stage F plans work; nothing enqueues it.
2. **Testing has been full-pipeline or nothing.** The T-403 review went 4 rounds (r1 blocker + 8 majors, r2 an enum/table name collision that would have failed the prod deploy, r3 the SEBI rung could never fire, r4 a 503 recorded as "not filed"). Every round found the next stage's defect only after the previous one was fixed. That is the owner's complaint, and it is a test-design problem, not bad luck.
3. **The journal cannot rebuild a DB.** A journal-built `ipos` has 32 columns vs 55 in `schema.ts`; `documents` 8 vs 19; `ipo_details` is never created (`T-403-plan.md` §9). Any stage test that starts from an empty DB dies before the stage under test runs. Prod survives only because it was built from dumps + `_repair/`.
4. **Acceptance tests written after the code ratified the code.** T-403 r2 evidence "passed" a SEBI rung that was unreachable, because the check asserted zero SEBI calls (§9 B-1). A stage test must be written from the spec first.
5. **Environment differences are untested.** `python` vs `python3`, untracked `pdf-parser-test/`, `__dirname` in ESM, `TZ` unset on the VPS (T-327). Each surfaces only when that stage first runs on that box.

## 4. What is missing or wrong in `how.md` (the fixes it needs)

- Step 1: cites `ecosystem.config.js`, which is retired dead config. Cron lives in `deploy-linux.sh`.
- Step 7: rewrite entirely. Today: NSE-only URL discovery behind a flag that is off; no download; no extraction. Cite `primary-source-discovery.ts` and the lifecycle plan, not `drhp-downloader.ts`.
- Step 7: remove "confidence score … flagged for human review" — no live path.
- Step 12: the tiered IST scheduler does not run. Prod is a flat 30-min cron. Cite `index.ts:602`.
- Step 12: the status updater lives in the one-shot cycle (`triggerStatusUpdate`), not the scheduler.
- Step 16: say plainly that financials/peers/objectives/documents render as "Awaiting data" for every IPO scraped since launch.
- Diagram: remove the DRHP→pdfplumber→financials arrow or mark it "planned (WP C)".
- Add a pointer: "document lifecycle: see `docs/reviews/ipo-document-lifecycle-plan.md`; status of WP A–F in `T-403-plan.md` §8–9".

## 5. What is missing in the lifecycle plan itself

- No stage-isolated test harness. §6 mandates "build locally against a restored prod DB" and a 2-day soak, but every gate is end-to-end. Add per-stage fixtures + contracts (§6 below).
- WP C has no written extraction contract (which fields, from which chapter, with what arithmetic check) beyond `skyways-rhp-values.md`. E9 says "every table carries an arithmetic check" but no list of checks exists.
- No statement of what the extractor runtime is on the VPS (python3 + pdfplumber + tesseract for E4) or who installs it. `deploy-linux.sh` does not.
- BSE SME (`bsesme.com`) is explicitly not parsed (T-403 §9); E11 assumes it is.
- The journal/schema drift is named as "owner decision" and then never scheduled. Until it is fixed, no stage can be tested from a clean DB.
- The dead code the plan supersedes (`drhp-downloader.ts`, `drhp-orchestrator.ts`, `drhp-extractor.ts`, the `pdf-parser-test` reference, `ecosystem.config.js`) has no deletion ticket. It keeps misleading readers and reviewers.

## 6. Staged test plan (the owner's ask)

Principle: each stage has an **input fixture on disk**, a **pure function or CLI** that runs it, and an
**expected-output file**. A stage is green only when its output feeds the next stage's fixture unchanged.
Run stages in order; stop at the first red; fix; re-run only that stage. No stage test needs the network
except the "live" variant, which runs once per stage after the fixture variant is green.

| # | Stage | Input | Runs | Expected | Exists today? |
|---|---|---|---|---|---|
| 0 | DB rebuild from journal | empty Postgres | `drizzle-kit migrate` | column set == `schema.ts` (`audit:schema-drift` exit 0) | **NO — red today** (§3.3). Must be first |
| 1 | Discover IPO | captured BSE board + NSE list JSON (Skyways, Madhur, ESDS, Deepa) | NSE/BSE orchestrator parse only | 4 `ipos` rows with correct segment/offering_type/dates | partial (orchestrator unit tests) |
| 2 | Resolve document links | captured `GetMkt_ISSUE_BBS_IPO` + `ipo-detail` payloads | `document-discovery-runner` (T-403) with network stubbed | typed links: Skyways RHP/PBA/CORRIGENDUM/ADDENDUM, 3 BRLMs | YES on T-403 branch (fixtures exist) |
| 3 | Download + verify + store | those links, HTTP stubbed with real bytes + the BSE "Object Moved" HTML | verifier + store | sha256 dedup, no HTML stored, files under `<ipo_id>/` | YES on T-403 branch |
| 4 | State machine | run 1 then run 2 | `run-document-discovery.ts` | run 2 = 0 network calls; ESDS DRHP `NOT_YET_FILED` | YES on T-403 branch (8/8) |
| 5 | Extract | the stored Skyways RHP PDF | `extract_financials_pdf.py` | values == `skyways-rhp-values.md`; arithmetic checks pass | partial (Ather oracle only; no Skyways fixture; no E9 checks) |
| 6 | Persist extracted data | stage-5 JSON | `createFinancialData` etc. through `upsertIPO` precedence | rows in `financial_data`/`peer_companies`; `field_sources` = RHP | **NO** (functions exist, no precedence, no confidence) |
| 7 | Supersede | Prospectus after RHP | `decideSupersession`/`markSuperseded` | old row `is_active=false`, only carried fields overwritten | functions exist, unwired (T-403 §8.4) |
| 8 | Render | stage-6 DB | Playwright on `/ipos/skyways-…` | financials section rendered, "Awaiting data" gone | partial (E2E infra exists) |
| 9 | Runtime env | the VPS | preflight script | python3 + pdfplumber + tesseract present, `TZ` set, store dir writable | **NO** |

Order of work: 0 → 9 (both are pure infrastructure and block everything) → merge T-403 (2, 3, 4 already
green there) → 5 → 6 → 7 → 8. Stages 5–7 are WP C/D. Stage 8 is WP E.

**This staged plan has since been executed.** `docs/walks/2026-09-02-deepa-pipeline-walk.md` is
the walked version of the table above, run step-by-step on a real IPO (Deepa Jewellers, DEEPA)
instead of on fixtures, with its own step ids (B1–J3) covering the same ground as stages 1–8
here plus the reconciliation/protection/time-series/lifecycle/serving steps this table doesn't
break out separately. Per-section verdicts: **B (discover+write) 7/7 PASS; C (document links)
5/5 PASS; D (download/store/OCR) 5/6 PASS + D6 partial (no tesseract on the dev laptop); E
(extraction) 8/10 PASS; F (aggregator compare) 4/6; G (merge/protect/persist) 3/5; H
(time-series) 3/4; I (lifecycle/stage machine) 3/6; J (cache/render/admin) 2/3, pending G4.** The
walk found **46 defects** (W-01..W-47, W-42 never assigned), of which **24 are fixed and tested**
on branch `docs/deepa-walk-ledger` (Tier A reviewed where the change touched the write path) and
**22 remain open**. Nothing from the walk is deployed yet (walk decision D-09) — `how.md` Steps
B1–J3 carry the per-step LIVE/FIXED-not-deployed/MISSING/BLOCKED status this table's "Exists
today?" column used to approximate from code reading alone.

## 7. Decisions the owner must make (nothing else is blocked)

1. **Resume or restart T-403?** (tracked in #258 stage 2–4) 155 files / 20k lines, 4 review rounds, r4 unreviewed. Recommended: one more fresh Opus review of r4 only, then merge behind its off-by-default flag. Restarting throws away stages 2–4.
2. **Schema/journal repair (stage 0)** (#256) — owner called it a schema-ownership decision on 28 Aug. It is the first blocker of every stage test. Recommended: fold `_repair/` into journaled migrations (T-id, P1).
3. **Delete the dead DRHP code path** (#257) (`drhp-downloader.ts`, `drhp-orchestrator.ts`, `drhp-extractor.ts`, web `drhp-extractor-service.ts` + its API route, `ecosystem.config.js`). Recommended: yes, in the same PR that rewrites `how.md` Step 7.
