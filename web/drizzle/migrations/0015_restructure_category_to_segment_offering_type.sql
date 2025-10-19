-- Migration: Restructure Category Field into Segment + Offering Type
-- Story 11.8: Fix duplicate IPO listings and separate exchange segment from offering type
-- Breaking Change: P0 CRITICAL
-- Author: Dev Agent (James)
-- Date: 2025-10-19

-- ===================================================================
-- ROLLBACK INSTRUCTIONS (if needed):
-- ===================================================================
-- 1. Restore database from backup: backup_pre_category_restructure.sql
-- 2. Revert code changes: git revert <commit-hash>
-- 3. Restart application
-- ===================================================================

-- Step 1: Create new enums
CREATE TYPE segment AS ENUM ('MAINBOARD', 'SME');
CREATE TYPE offering_type AS ENUM (
  'IPO',           -- Initial Public Offering
  'FPO',           -- Follow-on Public Offering
  'RIGHTS',        -- Rights Issue
  'OFS',           -- Offer for Sale
  'IPP',           -- Institutional Placement Program
  'QIP',           -- Qualified Institutional Placement
  'PREFERENTIAL',  -- Preferential Allotment
  'NCD',           -- Non-Convertible Debentures
  'BONDS',         -- Corporate Bonds
  'INVITS',        -- Infrastructure Investment Trusts
  'REITS',         -- Real Estate Investment Trusts
  'BUYBACK',       -- Share Buyback
  'DELISTING',     -- Delisting from Exchange
  'TENDER'         -- Tender Offer
);

-- Step 2: Add new columns to ipos table (nullable first to allow data migration)
ALTER TABLE ipos ADD COLUMN segment segment;
ALTER TABLE ipos ADD COLUMN offering_type offering_type;

-- Step 3: Migrate data from category to segment + offering_type
-- Map existing category values to new fields
UPDATE ipos SET
  segment = CASE
    WHEN category = 'MAINBOARD' THEN 'MAINBOARD'::segment
    WHEN category = 'SME' THEN 'SME'::segment
    WHEN category IN ('RIGHTS', 'NCD', 'FPO') THEN 'MAINBOARD'::segment
    ELSE 'MAINBOARD'::segment
  END,
  offering_type = CASE
    WHEN category = 'MAINBOARD' THEN 'IPO'::offering_type
    WHEN category = 'SME' THEN 'IPO'::offering_type
    WHEN category = 'RIGHTS' THEN 'RIGHTS'::offering_type
    WHEN category = 'NCD' THEN 'NCD'::offering_type
    WHEN category = 'FPO' THEN 'FPO'::offering_type
    ELSE 'IPO'::offering_type
  END;

-- Step 4: Detect TENDER offers from symbol suffix
-- This fixes the "3i Infotech" duplicate issue where TENDER offers appear as IPOs
UPDATE ipos SET offering_type = 'TENDER'::offering_type
WHERE symbol LIKE '%TDR' OR symbol LIKE '%TENDER';

-- Step 5: Make new columns NOT NULL
ALTER TABLE ipos ALTER COLUMN segment SET NOT NULL;
ALTER TABLE ipos ALTER COLUMN offering_type SET NOT NULL;

-- Step 6: Create indexes on new columns for query performance
CREATE INDEX IF NOT EXISTS idx_ipos_segment ON ipos(segment);
CREATE INDEX IF NOT EXISTS idx_ipos_offering_type ON ipos(offering_type);
CREATE INDEX IF NOT EXISTS idx_ipos_segment_offering_type ON ipos(segment, offering_type);

-- Step 7: Update ipo_reviews table (also uses category)
ALTER TABLE ipo_reviews ADD COLUMN segment segment;

-- Migrate ipo_reviews data
UPDATE ipo_reviews SET
  segment = CASE
    WHEN category = 'MAINBOARD' THEN 'MAINBOARD'::segment
    WHEN category = 'SME' THEN 'SME'::segment
    WHEN category IN ('RIGHTS', 'NCD', 'FPO') THEN 'MAINBOARD'::segment
    ELSE 'MAINBOARD'::segment
  END;

ALTER TABLE ipo_reviews ALTER COLUMN segment SET NOT NULL;

-- Drop old index on category
DROP INDEX IF EXISTS idx_ipo_reviews_category;
DROP INDEX IF EXISTS idx_ipo_reviews_category_year_published;

-- Create new indexes on segment
CREATE INDEX IF NOT EXISTS idx_ipo_reviews_segment ON ipo_reviews(segment);
CREATE INDEX IF NOT EXISTS idx_ipo_reviews_segment_year_published ON ipo_reviews(segment, year, published_date);

-- Step 8: Drop old category column from both tables
ALTER TABLE ipos DROP COLUMN category;
ALTER TABLE ipo_reviews DROP COLUMN category;

-- Step 9: Drop old enum (no longer referenced)
DROP TYPE IF EXISTS ipo_category;

-- ===================================================================
-- Verification Queries (run after migration):
-- ===================================================================
-- Check data distribution:
--   SELECT segment, offering_type, COUNT(*) FROM ipos GROUP BY segment, offering_type;
--
-- Verify no nulls:
--   SELECT COUNT(*) FROM ipos WHERE segment IS NULL OR offering_type IS NULL;
--
-- Check TENDER detection:
--   SELECT company_name, symbol, segment, offering_type FROM ipos WHERE offering_type = 'TENDER';
--
-- Verify indexes created:
--   SELECT indexname FROM pg_indexes WHERE tablename = 'ipos' AND indexname LIKE '%segment%';
-- ===================================================================
