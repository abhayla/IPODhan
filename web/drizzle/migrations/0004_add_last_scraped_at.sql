-- Migration: Add last_scraped_at column to ipos table
-- Story: 7.4 Scheduler & Cache Invalidation
-- Purpose: Track last successful scrape time for health checks

-- Add last_scraped_at column
ALTER TABLE ipos ADD COLUMN last_scraped_at TIMESTAMP;

-- Create index for efficient health check queries
CREATE INDEX idx_ipos_last_scraped_at ON ipos(last_scraped_at);

-- Add comment to column
COMMENT ON COLUMN ipos.last_scraped_at IS 'Timestamp of last successful scrape (updated by scraper on each run)';
