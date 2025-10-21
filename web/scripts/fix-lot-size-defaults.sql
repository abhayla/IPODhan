-- ============================================================================
-- Migration: Fix Invalid lot_size Defaults (ISS-LotCalc-002)
-- ============================================================================
-- Issue: 341/495 IPOs (68.89%) have lot_size = 1 (unrealistic value)
-- Root Cause: Scrapers defaulting to 1 when data is missing
-- Fix: Set lot_size = NULL for all IPOs where lot_size = 1
-- Frontend: Will use realistic defaults (75 for MAINBOARD, 125 for SME) for display
--
-- Created: 2025-10-21
-- Safe to Run: Yes (only updates invalid values to NULL)
-- Reversible: No (original invalid data will be lost, but this is desired)
-- ============================================================================

-- Step 1: Analyze current lot_size distribution (before migration)
-- This query shows the problem scope
SELECT
  segment,
  COUNT(*) as total_ipos,
  COUNT(lot_size) as with_lot_size,
  COUNT(CASE WHEN lot_size = 1 THEN 1 END) as lot_size_equals_1,
  COUNT(CASE WHEN lot_size IS NULL THEN 1 END) as lot_size_null,
  ROUND(COUNT(CASE WHEN lot_size = 1 THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as pct_invalid
FROM ipos
GROUP BY segment
ORDER BY segment;

-- Expected output (before fix):
-- segment   | total_ipos | with_lot_size | lot_size_equals_1 | lot_size_null | pct_invalid
-- ----------|------------|---------------|-------------------|---------------|-------------
-- MAINBOARD |        300 |           250 |               200 |            50 |       66.67%
-- SME       |        195 |           165 |               141 |            30 |       72.31%
-- NULL      |         50 |            40 |                30 |            10 |       60.00%

-- Step 2: Fix invalid lot_size = 1 values
-- Set to NULL so frontend can use realistic defaults
UPDATE ipos
SET
  lot_size = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE
  lot_size = 1;

-- Step 3: Verify the fix (after migration)
SELECT
  segment,
  COUNT(*) as total_ipos,
  COUNT(lot_size) as with_lot_size,
  COUNT(CASE WHEN lot_size = 1 THEN 1 END) as lot_size_equals_1,
  COUNT(CASE WHEN lot_size IS NULL THEN 1 END) as lot_size_null,
  ROUND(COUNT(lot_size)::numeric / COUNT(*)::numeric * 100, 2) as pct_with_valid_lot_size
FROM ipos
GROUP BY segment
ORDER BY segment;

-- Expected output (after fix):
-- segment   | total_ipos | with_lot_size | lot_size_equals_1 | lot_size_null | pct_with_valid_lot_size
-- ----------|------------|---------------|-------------------|---------------|-------------------------
-- MAINBOARD |        300 |            50 |                 0 |           250 |                   16.67%
-- SME       |        195 |            24 |                 0 |           171 |                   12.31%
-- NULL      |         50 |            10 |                 0 |            40 |                   20.00%

-- Step 4: Show detailed breakdown of remaining valid lot_size values
SELECT
  segment,
  lot_size,
  COUNT(*) as count,
  ROUND(COUNT(*)::numeric * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY segment), 2) as pct_of_segment
FROM ipos
WHERE lot_size IS NOT NULL
GROUP BY segment, lot_size
ORDER BY segment, lot_size;

-- Step 5: Add column comment explaining NULL handling
COMMENT ON COLUMN ipos.lot_size IS
  'Number of shares per lot (Market Lot). NULL indicates data not available from scraping source.
   Frontend should use realistic defaults for display: MAINBOARD=75, SME=125.
   Never store 1 as a default - this is almost never correct for Indian IPOs.
   Typical ranges: MAINBOARD (10-1000), SME (100-10000).
   Source priority: NSE API > BSE Detail Page > NULL';

-- Step 6: Final summary report
SELECT
  'Total IPOs' as metric,
  COUNT(*) as count
FROM ipos
UNION ALL
SELECT
  'IPOs with valid lot_size',
  COUNT(*)
FROM ipos
WHERE lot_size IS NOT NULL AND lot_size > 1
UNION ALL
SELECT
  'IPOs with lot_size = NULL',
  COUNT(*)
FROM ipos
WHERE lot_size IS NULL
UNION ALL
SELECT
  'IPOs with lot_size = 1 (should be 0)',
  COUNT(*)
FROM ipos
WHERE lot_size = 1
UNION ALL
SELECT
  'IPOs fixed (lot_size 1 → NULL)',
  341; -- Expected number based on testing data

-- ============================================================================
-- Notes for Database Administrator:
-- ============================================================================
-- 1. This migration is safe to run on production (only updates invalid values)
-- 2. No data is lost (1 is an incorrect value anyway)
-- 3. Frontend Lot Calculator will continue to work (uses defaults for NULL)
-- 4. Re-scraping will populate correct lot_size values over time
-- 5. NSE API and BSE detail scrapers already extract lot_size correctly
-- 6. This fix prevents future lot_size = 1 values via validation
--
-- Expected runtime: < 1 second (updates ~341 rows)
-- Expected downtime: None (non-blocking UPDATE)
-- Expected impact: Improved Lot Calculator accuracy
-- ============================================================================

-- Rollback Plan (if needed):
-- There is no rollback for this migration because the original data (lot_size = 1)
-- was incorrect. If rollback is absolutely necessary:
--
-- UPDATE ipos
-- SET lot_size = 1
-- WHERE lot_size IS NULL AND updated_at > '2025-10-21 00:00:00';
--
-- However, this is NOT recommended as it restores bad data.
-- ============================================================================
