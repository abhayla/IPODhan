-- Migration: Add index on ipos.scraper_locked for performance
-- Purpose: Optimize scraper queries that check lock status
-- Date: 2025-10-22

-- Add index for scraper_locked column
CREATE INDEX IF NOT EXISTS "idx_ipos_scraper_locked" ON "ipos" ("scraper_locked");

-- Comment for documentation
COMMENT ON INDEX "idx_ipos_scraper_locked" IS 'Optimizes scraper queries checking IPO lock status before updates';
