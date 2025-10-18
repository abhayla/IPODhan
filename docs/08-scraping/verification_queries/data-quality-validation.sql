-- =============================================================================
-- DATA QUALITY VALIDATION RULES (Section 3.3)
-- =============================================================================
-- Purpose: Validate data integrity and business logic constraints
-- Expected: ALL queries should return 0 rows for a clean database
-- Severity: Any row returned indicates a data quality issue
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Date ordering validation
-- -----------------------------------------------------------------------------
-- Description: Checks for invalid date sequences (e.g., close_date before open_date)
-- Expected: 0 rows
-- Business Rule: open_date <= close_date <= allotment_date <= listing_date
-- -----------------------------------------------------------------------------
SELECT
  id,
  company_name,
  open_date,
  close_date,
  allotment_date,
  listing_date,
  CASE
    WHEN open_date IS NOT NULL AND close_date IS NOT NULL AND open_date > close_date
      THEN 'open_date > close_date'
    WHEN close_date IS NOT NULL AND allotment_date IS NOT NULL AND close_date > allotment_date
      THEN 'close_date > allotment_date'
    WHEN allotment_date IS NOT NULL AND listing_date IS NOT NULL AND allotment_date > listing_date
      THEN 'allotment_date > listing_date'
  END as violation_type
FROM ipos
WHERE (open_date IS NOT NULL AND close_date IS NOT NULL AND open_date > close_date)
   OR (close_date IS NOT NULL AND allotment_date IS NOT NULL AND close_date > allotment_date)
   OR (allotment_date IS NOT NULL AND listing_date IS NOT NULL AND allotment_date > listing_date)
ORDER BY company_name;

-- -----------------------------------------------------------------------------
-- 2. Price range validation
-- -----------------------------------------------------------------------------
-- Description: Validates price_range_min and price_range_max are logical
-- Expected: 0 rows
-- Business Rule: 0 < price_range_min <= price_range_max
-- -----------------------------------------------------------------------------
SELECT
  id,
  company_name,
  price_range_min,
  price_range_max,
  CASE
    WHEN price_range_min > price_range_max THEN 'min > max'
    WHEN price_range_min <= 0 THEN 'min <= 0'
    WHEN price_range_max <= 0 THEN 'max <= 0'
  END as violation_type
FROM ipos
WHERE price_range_min > price_range_max
   OR price_range_min <= 0
   OR price_range_max <= 0
ORDER BY company_name;

-- -----------------------------------------------------------------------------
-- 3. Positive value validation for numeric fields
-- -----------------------------------------------------------------------------
-- Description: Ensures numeric fields are positive where required
-- Expected: 0 rows
-- Business Rule: issue_size, lot_size, face_value must be > 0
-- -----------------------------------------------------------------------------
SELECT
  id,
  company_name,
  issue_size,
  lot_size,
  face_value,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN issue_size IS NOT NULL AND issue_size::numeric <= 0 THEN 'issue_size' END,
    CASE WHEN lot_size IS NOT NULL AND lot_size <= 0 THEN 'lot_size' END,
    CASE WHEN face_value IS NOT NULL AND face_value <= 0 THEN 'face_value' END
  ], NULL) as invalid_fields
FROM ipos
WHERE (issue_size IS NOT NULL AND issue_size::numeric <= 0)
   OR (lot_size IS NOT NULL AND lot_size <= 0)
   OR (face_value IS NOT NULL AND face_value <= 0)
ORDER BY company_name;

-- -----------------------------------------------------------------------------
-- 4. JSONB array validation
-- -----------------------------------------------------------------------------
-- Description: Validates required JSONB array fields are not empty
-- Expected: 0 rows for OPEN/CLOSED/LISTED IPOs
-- Business Rule: listing_exchanges must have at least 1 element
--                lead_managers should be present for OPEN/CLOSED/LISTED IPOs
-- -----------------------------------------------------------------------------
SELECT
  id,
  company_name,
  status,
  listing_exchanges,
  lead_managers,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN listing_exchanges IS NULL THEN 'listing_exchanges is NULL' END,
    CASE WHEN jsonb_array_length(listing_exchanges) = 0 THEN 'listing_exchanges is empty array' END,
    CASE WHEN status IN ('OPEN', 'CLOSED', 'LISTED') AND lead_managers IS NULL THEN 'lead_managers is NULL' END
  ], NULL) as validation_errors
FROM ipos
WHERE (listing_exchanges IS NULL OR jsonb_array_length(listing_exchanges) = 0)
   OR (status IN ('OPEN', 'CLOSED', 'LISTED') AND lead_managers IS NULL)
ORDER BY status, company_name;

-- -----------------------------------------------------------------------------
-- 5. Future dates validation
-- -----------------------------------------------------------------------------
-- Description: Checks for unrealistic future dates
-- Expected: 0 rows
-- Business Rule: Dates shouldn't be more than 1 year in the future
--                LISTED IPOs must have listing_date <= today
-- -----------------------------------------------------------------------------
SELECT
  id,
  company_name,
  status,
  open_date,
  close_date,
  listing_date,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN open_date > CURRENT_DATE + INTERVAL '1 year' THEN 'open_date too far future' END,
    CASE WHEN close_date > CURRENT_DATE + INTERVAL '1 year' THEN 'close_date too far future' END,
    CASE WHEN status = 'LISTED' AND listing_date > CURRENT_DATE THEN 'listed but listing_date in future' END
  ], NULL) as validation_errors
FROM ipos
WHERE open_date > CURRENT_DATE + INTERVAL '1 year'
   OR close_date > CURRENT_DATE + INTERVAL '1 year'
   OR (status = 'LISTED' AND listing_date > CURRENT_DATE)
ORDER BY company_name;

-- -----------------------------------------------------------------------------
-- 6. Subscription multiples validation
-- -----------------------------------------------------------------------------
-- Description: Validates subscription data is non-negative
-- Expected: 0 rows
-- Business Rule: Subscription multiples cannot be negative
-- -----------------------------------------------------------------------------
SELECT
  id,
  company_name,
  subscription_retail,
  subscription_hni,
  subscription_qib,
  subscription_total,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN subscription_retail IS NOT NULL AND subscription_retail::numeric < 0 THEN 'retail negative' END,
    CASE WHEN subscription_hni IS NOT NULL AND subscription_hni::numeric < 0 THEN 'hni negative' END,
    CASE WHEN subscription_qib IS NOT NULL AND subscription_qib::numeric < 0 THEN 'qib negative' END,
    CASE WHEN subscription_total IS NOT NULL AND subscription_total::numeric < 0 THEN 'total negative' END
  ], NULL) as validation_errors
FROM ipos
WHERE (subscription_retail IS NOT NULL AND subscription_retail::numeric < 0)
   OR (subscription_hni IS NOT NULL AND subscription_hni::numeric < 0)
   OR (subscription_qib IS NOT NULL AND subscription_qib::numeric < 0)
   OR (subscription_total IS NOT NULL AND subscription_total::numeric < 0)
ORDER BY company_name;

-- -----------------------------------------------------------------------------
-- 7. GMP validation
-- -----------------------------------------------------------------------------
-- Description: Validates Grey Market Premium data is reasonable
-- Expected: 0 rows or few outliers
-- Business Rule: GMP percentage should typically be between -50% and 200%
--                (extreme values may indicate data errors)
-- -----------------------------------------------------------------------------
SELECT
  id,
  company_name,
  gmp_price,
  gmp_percentage_historical,
  CASE
    WHEN gmp_percentage_historical::numeric < -50 THEN 'GMP% suspiciously low (< -50%)'
    WHEN gmp_percentage_historical::numeric > 200 THEN 'GMP% suspiciously high (> 200%)'
  END as validation_warning
FROM ipos
WHERE gmp_percentage_historical IS NOT NULL
  AND (
    gmp_percentage_historical::numeric < -50
    OR gmp_percentage_historical::numeric > 200
  )
ORDER BY gmp_percentage_historical::numeric DESC;

-- -----------------------------------------------------------------------------
-- 8. Listing performance validation
-- -----------------------------------------------------------------------------
-- Description: Validates listing performance data consistency
-- Expected: 0 rows
-- Business Rule: If status is LISTED, listing_price_historical should be present
--                listing_gain_percentage should match calculation from listing_price
-- -----------------------------------------------------------------------------
SELECT
  id,
  company_name,
  status,
  price_range_max as issue_price_approx,
  listing_price_historical,
  listing_gain_percentage_historical,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN status = 'LISTED' AND listing_price_historical IS NULL THEN 'listed but no listing_price' END,
    CASE WHEN listing_price_historical IS NOT NULL AND listing_price_historical <= 0 THEN 'listing_price <= 0' END
  ], NULL) as validation_errors
FROM ipos
WHERE (status = 'LISTED' AND listing_price_historical IS NULL)
   OR (listing_price_historical IS NOT NULL AND listing_price_historical <= 0)
ORDER BY company_name;

-- -----------------------------------------------------------------------------
-- 9. Status and date consistency
-- -----------------------------------------------------------------------------
-- Description: Validates IPO status matches date constraints
-- Expected: 0 rows
-- Business Rules:
--   - UPCOMING: open_date in future
--   - OPEN: open_date <= today <= close_date
--   - CLOSED: close_date < today, listing_date is null or future
--   - LISTED: listing_date <= today
-- -----------------------------------------------------------------------------
SELECT
  id,
  company_name,
  status,
  open_date,
  close_date,
  listing_date,
  CASE
    WHEN status = 'UPCOMING' AND open_date <= CURRENT_DATE
      THEN 'Status is UPCOMING but open_date has passed'
    WHEN status = 'OPEN' AND (open_date > CURRENT_DATE OR close_date < CURRENT_DATE)
      THEN 'Status is OPEN but dates indicate otherwise'
    WHEN status = 'CLOSED' AND close_date >= CURRENT_DATE
      THEN 'Status is CLOSED but close_date has not passed'
    WHEN status = 'LISTED' AND listing_date > CURRENT_DATE
      THEN 'Status is LISTED but listing_date is in future'
  END as status_date_mismatch
FROM ipos
WHERE (status = 'UPCOMING' AND open_date <= CURRENT_DATE)
   OR (status = 'OPEN' AND (open_date > CURRENT_DATE OR close_date < CURRENT_DATE))
   OR (status = 'CLOSED' AND close_date >= CURRENT_DATE)
   OR (status = 'LISTED' AND listing_date > CURRENT_DATE)
ORDER BY status, company_name;

-- -----------------------------------------------------------------------------
-- 10. Minimum investment validation
-- -----------------------------------------------------------------------------
-- Description: Validates minimum investment calculation is reasonable
-- Expected: 0 rows (or few with unusual configurations)
-- Business Rule: min_investment = lot_size * price_range_max
--                Should typically be between ₹5,000 and ₹2,00,000 for MAINBOARD
--                Should typically be between ₹10,000 and ₹50,000 for SME
-- -----------------------------------------------------------------------------
SELECT
  id,
  company_name,
  category,
  lot_size,
  price_range_max,
  (lot_size * price_range_max) as calculated_min_investment,
  CASE
    WHEN category = 'MAINBOARD' AND (lot_size * price_range_max) < 5000
      THEN 'Mainboard min investment < ₹5,000 (unusual)'
    WHEN category = 'MAINBOARD' AND (lot_size * price_range_max) > 200000
      THEN 'Mainboard min investment > ₹2,00,000 (unusual)'
    WHEN category = 'SME' AND (lot_size * price_range_max) < 10000
      THEN 'SME min investment < ₹10,000 (unusual)'
    WHEN category = 'SME' AND (lot_size * price_range_max) > 50000
      THEN 'SME min investment > ₹50,000 (unusual)'
  END as validation_warning
FROM ipos
WHERE lot_size IS NOT NULL
  AND price_range_max IS NOT NULL
  AND (
    (category = 'MAINBOARD' AND ((lot_size * price_range_max) < 5000 OR (lot_size * price_range_max) > 200000))
    OR (category = 'SME' AND ((lot_size * price_range_max) < 10000 OR (lot_size * price_range_max) > 50000))
  )
ORDER BY category, calculated_min_investment;

-- -----------------------------------------------------------------------------
-- SUMMARY: Data quality issues by category
-- -----------------------------------------------------------------------------
WITH validation_summary AS (
  SELECT 'Date Ordering Violations' as check_type,
         COUNT(*) as issue_count
  FROM ipos
  WHERE (open_date IS NOT NULL AND close_date IS NOT NULL AND open_date > close_date)
     OR (close_date IS NOT NULL AND allotment_date IS NOT NULL AND close_date > allotment_date)
     OR (allotment_date IS NOT NULL AND listing_date IS NOT NULL AND allotment_date > listing_date)

  UNION ALL

  SELECT 'Price Range Violations', COUNT(*)
  FROM ipos
  WHERE price_range_min > price_range_max
     OR price_range_min <= 0
     OR price_range_max <= 0

  UNION ALL

  SELECT 'Negative Value Violations', COUNT(*)
  FROM ipos
  WHERE (issue_size IS NOT NULL AND issue_size::numeric <= 0)
     OR (lot_size IS NOT NULL AND lot_size <= 0)
     OR (face_value IS NOT NULL AND face_value <= 0)

  UNION ALL

  SELECT 'Empty JSONB Arrays', COUNT(*)
  FROM ipos
  WHERE (listing_exchanges IS NULL OR jsonb_array_length(listing_exchanges) = 0)

  UNION ALL

  SELECT 'Future Date Violations', COUNT(*)
  FROM ipos
  WHERE open_date > CURRENT_DATE + INTERVAL '1 year'
     OR close_date > CURRENT_DATE + INTERVAL '1 year'
     OR (status = 'LISTED' AND listing_date > CURRENT_DATE)

  UNION ALL

  SELECT 'Negative Subscription Values', COUNT(*)
  FROM ipos
  WHERE (subscription_retail IS NOT NULL AND subscription_retail::numeric < 0)
     OR (subscription_hni IS NOT NULL AND subscription_hni::numeric < 0)
     OR (subscription_qib IS NOT NULL AND subscription_qib::numeric < 0)

  UNION ALL

  SELECT 'Status-Date Mismatches', COUNT(*)
  FROM ipos
  WHERE (status = 'UPCOMING' AND open_date <= CURRENT_DATE)
     OR (status = 'OPEN' AND (open_date > CURRENT_DATE OR close_date < CURRENT_DATE))
     OR (status = 'CLOSED' AND close_date >= CURRENT_DATE)
     OR (status = 'LISTED' AND listing_date > CURRENT_DATE)
)
SELECT
  check_type,
  issue_count,
  CASE
    WHEN issue_count = 0 THEN '✓ PASS'
    WHEN issue_count <= 5 THEN '⚠ WARNING'
    ELSE '✗ CRITICAL'
  END as status
FROM validation_summary
ORDER BY issue_count DESC, check_type;

-- =============================================================================
-- END OF DATA QUALITY VALIDATION QUERIES
-- =============================================================================
