-- C2: bse_scrip_code column on ipos
-- Branch: fix/ipo-bse-scrip-code-column
--
-- ADDITIVE / NON-DESTRUCTIVE: nullable ADD COLUMN only. No data change, no type change,
-- no drop. Safe to apply; parked here (not journaled) because db:generate is blocked by the
-- pre-existing extraction_status enum drift (see README) — hand-authored, owner-applied.
--
-- WHY: the deployed scheduler job scraper/src/scheduler/jobs/listing-performance-update.ts
-- selects ipos.bse_scrip_code (db.query.ipos.findMany columns: { bseScripCode: true }) to fetch
-- BSE prices via StockReachGraph. Prod currently LACKS this column, so the query errors every
-- run. This migration + the matching schema.ts declaration close that SSOT drift before deploy.
--
-- varchar(20) matches the neighbouring `symbol` column; BSE scrip codes are 6-digit strings.

ALTER TABLE ipos
  ADD COLUMN IF NOT EXISTS bse_scrip_code varchar(20);
