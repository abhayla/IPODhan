-- Migration: Add GMP (Grey Market Premium) columns to ipos table
-- Story: 7.6b - Infrastructure for Alternative Data Sources
-- Date: 2025-10-09

-- Add GMP columns if they don't exist
ALTER TABLE ipos
  ADD COLUMN IF NOT EXISTS gmp DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS gmp_percentage DECIMAL(5, 2),
  ADD COLUMN IF NOT EXISTS gmp_updated_at TIMESTAMP;

-- Create index on gmp_updated_at for efficient queries
CREATE INDEX IF NOT EXISTS idx_ipos_gmp_updated_at ON ipos(gmp_updated_at);

-- Add comment to columns
COMMENT ON COLUMN ipos.gmp IS 'Grey Market Premium in INR';
COMMENT ON COLUMN ipos.gmp_percentage IS 'GMP as percentage of issue price';
COMMENT ON COLUMN ipos.gmp_updated_at IS 'Last time GMP data was updated';
