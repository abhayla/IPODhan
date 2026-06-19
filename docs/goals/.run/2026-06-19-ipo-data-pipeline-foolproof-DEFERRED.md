# DEFERRED — Foolproof IPO data pipeline (`2026-06-19`)

Honest deferrals: a field/fix is here ONLY when genuinely unpublished at its stage,
source-capped, historical-unreachable, or higher-risk-than-reward right now. No faking.

## Stage A.5 integrity
- **#44 — duplicate-normalizer parenthesis case (`(India)` vs `India`).** DEFERRED.
  Reason: there are **0 active duplicate groups** today (gate `duplicates.groups==0`),
  so no current victim. The fix touches the paired JS+SQL matching normalizer
  (`packages/shared/src/utils/company-name-normalizer.ts`) which has a strict
  agreement integration test — change-risk to a critical matching SSOT exceeds the
  reward while no dup exists. Re-open if a `(India)`-vs-`India` dup appears.
- **Registrar "missing-space" variants** (e.g. `KfinTechnologies Limited`). PARTIAL:
  `sanitizeRegistrar` fixes a glued legal suffix (`TechnologiesLimited`→`Technologies Limited`)
  and strips `^`/tab/contact pollution (3 prod rows cleaned). Collapsing distinct
  spacing/spelling variants to ONE canonical registrar (Kfin vs KFIN vs Karvy) stays
  DEFERRED — prior sessions flagged mis-map risk; not a substance-gate failure.

## Stage-aware completeness (historical, best-effort per contract decision #9)
- All pre-activation (historical) rows are best-effort. The gate dashboard shows
  **historical required-field completeness 60.7%**; missing fields on historical rows
  are auto-deferred (an unreachable historical doc is not a failure). Go-forward 100%
  becomes mandatory once Abhay sets `PIPELINE_ACTIVATION_DATE` + activates the pipeline (§GATE).
- Domain gaps carried forward (need the later stages B–F, not faking):
  subscriptions 3.7%, gmp 50% (current), demand 0%, ipo_scores 0%, ipo_details 0%,
  anchor 0%, allotment_date 52.8%, SME listing price (#36).

## Stage B — live half (needs a network + tunnel session)
The pure parsing core shipped + unit-verified (commit `171587f3`). DEFERRED because they
need live network / a new dep / the tunnel, none safely verifiable in this session:
- **Live fetch wiring** of `parseNSEDocuments`/`parseBSEDocuments`/`parseSEBIDrhpListing`
  (NSE `ipo-detail?symbol&series=SME` — `&series=SME` MANDATORY for SME; archive host needs
  no cookies; BSE `GetMkt_ISSUE_BBS_IPO` detail row; SEBI `HomeAction.do?sid=3&ssid=15&smid=10`
  page-1 GET). Wire into the stubbed `drhp-downloader.ts` or a new fetch orchestrator.
- ~~`.zip`→`%PDF` unzip~~ **DONE** (commit `2ed23581`): `extractPdfFromZipBuffer` implemented with
  built-in `zlib` (no dep). The remaining B-live work is the live fetch + persistence, below.
- **BSE GID→URL builder:** no in-repo builder exists; `parseBSEDocuments` only accepts
  pre-resolved URLs today. Resolve the real GID→URL convention from a live BSE payload.
- **Persistence + downstream:** route discovered docs through `data-persister`/`DocumentRepository`
  → `documents` rows with `doc_type`; register new doc fields in `FIELD_PRIORITY_MATRIX`; the
  already-registered anchor/objectives/peers jobs then populate. Additive tunnel backfill + read-back.

## Stage D — closed-IPO subscription (source-capped, genuine)
- **CLOSED-IPO subscription is not backfillable.** NSE ipo-detail serves LIVE bid data
  (point-in-time); once an IPO closes the bids are gone. The write path works (verified:
  4/6 current OPEN IPOs already have subscription); the OPEN+SME backfill tools exist
  (`backfill-subscription.ts`, `backfill-demand-graph.ts`). The overall 2.6% subscription
  is dominated by historical CLOSED IPOs whose final subscription was never captured live →
  genuinely unobtainable now (no fabrication). Going-forward, the Stage-F cadence captures it.

## Out of scope (contract §0.1 — tracked independently, NOT this DoD)
- #35 CI red repo-wide; #56/#57/#51 web test + OOM debt; #1 prod DB password rotation.
- **Pre-existing scraper type-debt + 18 validators.test.ts failures** confirmed present
  on `main` (reproduced with this branch's changes stashed) — repo-wide test debt, not
  introduced here. Scraper is `strict:false` / not commit-type-gated.
