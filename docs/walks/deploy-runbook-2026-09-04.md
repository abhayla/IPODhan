# Deploy runbook (PR #278 bundle) — 2026-09-04, owner reachable

Preconditions (all done on 2026-09-03 night): W-108b + W-109 landed and reproduced; full suites green on the final commit; pr-gate green; ledger + status doc current.

## 1. Merge (GitHub)
- `gh pr ready 278`
- `gh pr merge 278 --merge --subject "DEEPA pipeline walk + S-02 + due-step scheduler (PR #278)"` (merge commit; keeps per-fix commits)
- `gh pr close 277 --comment "Superseded: both commits are in #278"`
- Push to main auto-deploys STAGING (deploy-linux.yml push guard). Wait for it: `gh run list --workflow deploy-linux.yml --limit 1`; then `curl -s https://staging.ipodhan.com/api/version` (nginx `sites-enabled/staging.ipodhan.com` -> 127.0.0.1:3012; prod ipodhan.com -> 3011) and open one IPO page on staging.

## 2. Production deploy
- `gh workflow run deploy-linux.yml -f slot=prod` ; watch `gh run watch <id>`.
- Deploy script applies migrations 0043-0049 (journaled). After: `npm run audit:schema-drift` (gated B2/B3/B4/C1/C3/D1 still show as drift, expected).

## 3. VPS env + OCR (root@72.61.240.224, key ~/.ssh/firekaro_v6_vps)
- `mkdir -p /var/www/ipodhan/shared/prospectus/prod`
- append to `/var/www/ipodhan/shared/env/prod/scraper.env`:
  `PROSPECTUS_STORE_DIR=/var/www/ipodhan/shared/prospectus/prod`
  (do NOT add any ENABLE_* here yet)
- `pip3 install rapidocr-onnxruntime pypdfium2` ; verify `python3 -c "import rapidocr_onnxruntime, pypdfium2"`.
- `pm2 restart ipodhan-scraper --update-env` is NOT needed for a one-shot cron app; the next cron start reads the env file via the deploy's env link.

## 4. DEEPA production backfill (from the VPS, current-prod/scraper, prod flags)
- Copy the 6 DEEPA PDFs from the laptop: `scp -i ~/.ssh/firekaro_v6_vps "C:/Users/itsab/AppData/Local/Temp/claude/D--Abhay-Ventures-IPODhan/874ccc0d-4cd3-4fbf-b74d-34194bc2ff71/scratchpad/store/0b7e81cd-3426-4376-9bc8-1b3b07fa9a93/"*.pdf root@72.61.240.224:/var/www/ipodhan/shared/prospectus/prod/<DEEPA prod ipo id>/`
  (DEEPA's PROD id AND slug differ from the test DB: read both first: `select id, slug from ipos where company_name ilike '%deepa%'` -> id `2745843f-cbc5-4561-8459-212b37f86765`, slug `deepa-jewellers-ltd` (read 2026-09-04 00:00 IST). No psql on the laptop: use `node` + the repo's `pg` package through the tunnel.)
- Register the files on the documents rows (sha256 + file path) OR let the document cycle re-discover them (simpler: with ENABLE_DOCUMENT_STATE_MACHINE on, the cycle downloads DEEPA's filings itself; the copy is only a fallback).
- `python3 scripts/extract_filing.py <PRICE_BAND_AD text copy pdf> --doc-type PRICE_BAND_AD > /tmp/deepa-ad.json`
- `python3 scripts/extract_filing.py <RHP pdf> --doc-type RHP > /tmp/deepa-rhp.json`
- `ENABLE_DATA_CONSOLIDATION=true ENABLE_SOURCE_TRACKING=true ENABLE_CONFLICT_DETECTION=true CONSOLIDATION_PERCENTAGE=100 npx tsx scripts/persist-filing.ts --ipo deepa-jewellers-ltd --json-ad /tmp/deepa-ad.json --json-rhp /tmp/deepa-rhp.json` (dry run) then `--apply`.
- `npx tsx scripts/retype-ratios-documents.ts` (dry) then `--apply`.
- `npx tsx scripts/backfill-anchor-investor-list-json.ts --allow-prod` (dry) then `--allow-prod --apply`.
- Audit: `select count(*) from ipos where company_name = lower(company_name) and company_name <> ''` must be 0.

## 5. Post-deploy checks (laptop, against prod)
- `npm run audit:data`, `npm run audit:substance`, `cd web && npm run test:prod-verify`.
- Open https://ipodhan.com/ipos/deepa-jewellers and compare with docs/walks/evidence/ipo-page-deepa-r4-fable-2026-09-03.png (issue size 459.72 Cr, face value 2, all new sections).
- Open one listed IPO page (skyways-air-services) — unchanged.

## 6. Switch on (owner present), then watch
- scraper.env: `ENABLE_DOCUMENT_STATE_MACHINE=true`, `ENABLE_STAGE_RECONCILER=true`, `ENABLE_FILING_AUTO_PERSIST=true`, `ENABLE_DUE_STEP_SCHEDULER=true`.
- Next cron start (every 30 min): read `pm2 logs ipodhan-scraper --lines 200` for `Due-step cycle:` lines, `status-restricted` summary, extraction lines; exit code 0.
- After one day: scraper_logs per source (freshness monitor quiet at night), `extraction_blocked` count, no P1 alerts from the freshness monitor. Rollback = remove the four lines, next cron start is the old path.

## Not in this deploy (after): SME walk (W-05, D-15 gate lift), W-110 ad-layout extraction, W-105, W-106, W-107, W-77, W-78, W-56, W-97, W-99.
