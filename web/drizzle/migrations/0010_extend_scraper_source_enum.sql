-- Migration: Extend scraper_source enum with MONEYCONTROL and CHITTORGARH
-- Story: 7.6 Alternative Data Sources
-- Date: 2025-10-16

-- Add new enum values to scraper_source
ALTER TYPE scraper_source ADD VALUE IF NOT EXISTS 'MONEYCONTROL';
ALTER TYPE scraper_source ADD VALUE IF NOT EXISTS 'CHITTORGARH';

-- Verify enum values
DO $$
DECLARE
  enum_values text;
BEGIN
  SELECT array_to_string(enum_range(NULL::scraper_source), ', ') INTO enum_values;
  RAISE NOTICE 'scraper_source enum values: %', enum_values;
END$$;
