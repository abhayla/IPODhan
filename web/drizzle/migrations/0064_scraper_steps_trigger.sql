-- #698, migration 0064: what launched the run that wrote each scraper_steps row
-- ('schedule' | 'deploy' | 'unknown', from the wake wrapper's SCRAPER_WAKE_TRIGGER).
-- Hand-trimmed from drizzle-kit's output to this migration's statement only (same as 0063).
-- Nullable and additive, no backfill: rows written before this change read NULL, which
-- scripts/assert-repair-held.mjs prints as `unknown (not counted)`.
ALTER TABLE "scraper_steps" ADD COLUMN IF NOT EXISTS "trigger" text;
