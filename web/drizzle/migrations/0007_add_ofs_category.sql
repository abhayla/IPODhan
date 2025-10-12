-- Migration: Add OFS Category to IPO Category Enum
-- Story: 9.5 - Offer for Sale (OFS) Page
-- Purpose: Add 'OFS' value to ipo_category enum to support OFS page functionality

-- Add 'OFS' to ipo_category enum if it doesn't already exist
DO $$
BEGIN
  -- Check if 'OFS' value already exists in the enum
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'OFS'
    AND enumtypid = (
      SELECT oid
      FROM pg_type
      WHERE typname = 'ipo_category'
    )
  ) THEN
    -- Add 'OFS' as a new value to the ipo_category enum
    ALTER TYPE ipo_category ADD VALUE 'OFS';

    RAISE NOTICE 'Added OFS to ipo_category enum';
  ELSE
    RAISE NOTICE 'OFS already exists in ipo_category enum, skipping';
  END IF;
END $$;

-- Verify the change
DO $$
DECLARE
  enum_values TEXT[];
BEGIN
  SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
  INTO enum_values
  FROM pg_enum e
  JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname = 'ipo_category';

  RAISE NOTICE 'Current ipo_category enum values: %', enum_values;
END $$;

-- Add comment for documentation
COMMENT ON TYPE ipo_category IS 'IPO Categories: MAINBOARD, SME, RIGHTS, NCD, OFS (Offer for Sale)';
