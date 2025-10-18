-- Fix listing_performance table schema mismatch
-- Add missing columns that are in the Drizzle schema but not in the database

ALTER TABLE listing_performance
  ADD COLUMN IF NOT EXISTS symbol VARCHAR(20),
  ADD COLUMN IF NOT EXISTS company_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS listing_date DATE,
  ADD COLUMN IF NOT EXISTS data_source VARCHAR(50) DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW() NOT NULL;

-- Verify the changes
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'listing_performance'
ORDER BY ordinal_position;
