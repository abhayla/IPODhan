-- =============================================================================
-- FIELD COVERAGE REPORT (Section 3.5)
-- =============================================================================
-- Purpose: Generate comprehensive field population statistics
-- Shows which fields are populated and their coverage percentages
-- Helps identify data gaps across all scrapers
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Core IPO Table Field Population Report
-- -----------------------------------------------------------------------------
-- Description: Shows count and percentage of populated fields in ipos table
-- Expected: Critical fields (company_name, status, category) should be 100%
--           Other fields vary by IPO status
-- -----------------------------------------------------------------------------
SELECT
  COUNT(*) as total_ipos,
  COUNT(company_name) as has_company_name,
  ROUND(100.0 * COUNT(company_name) / COUNT(*), 2) as company_name_pct,

  COUNT(slug) as has_slug,
  ROUND(100.0 * COUNT(slug) / COUNT(*), 2) as slug_pct,

  COUNT(symbol) as has_symbol,
  ROUND(100.0 * COUNT(symbol) / COUNT(*), 2) as symbol_pct,

  COUNT(isin) as has_isin,
  ROUND(100.0 * COUNT(isin) / COUNT(*), 2) as isin_pct,

  COUNT(category) as has_category,
  ROUND(100.0 * COUNT(category) / COUNT(*), 2) as category_pct,

  COUNT(sector) as has_sector,
  ROUND(100.0 * COUNT(sector) / COUNT(*), 2) as sector_pct,

  COUNT(status) as has_status,
  ROUND(100.0 * COUNT(status) / COUNT(*), 2) as status_pct,

  COUNT(issue_size) as has_issue_size,
  ROUND(100.0 * COUNT(issue_size) / COUNT(*), 2) as issue_size_pct,

  COUNT(price_range_min) as has_price_min,
  ROUND(100.0 * COUNT(price_range_min) / COUNT(*), 2) as price_min_pct,

  COUNT(price_range_max) as has_price_max,
  ROUND(100.0 * COUNT(price_range_max) / COUNT(*), 2) as price_max_pct,

  COUNT(lot_size) as has_lot_size,
  ROUND(100.0 * COUNT(lot_size) / COUNT(*), 2) as lot_size_pct,

  COUNT(face_value) as has_face_value,
  ROUND(100.0 * COUNT(face_value) / COUNT(*), 2) as face_value_pct,

  COUNT(open_date) as has_open_date,
  ROUND(100.0 * COUNT(open_date) / COUNT(*), 2) as open_date_pct,

  COUNT(close_date) as has_close_date,
  ROUND(100.0 * COUNT(close_date) / COUNT(*), 2) as close_date_pct,

  COUNT(allotment_date) as has_allotment_date,
  ROUND(100.0 * COUNT(allotment_date) / COUNT(*), 2) as allotment_date_pct,

  COUNT(listing_date) as has_listing_date,
  ROUND(100.0 * COUNT(listing_date) / COUNT(*), 2) as listing_date_pct,

  COUNT(listing_exchanges) as has_listing_exchanges,
  ROUND(100.0 * COUNT(listing_exchanges) / COUNT(*), 2) as listing_exchanges_pct,

  COUNT(registrar) as has_registrar,
  ROUND(100.0 * COUNT(registrar) / COUNT(*), 2) as registrar_pct,

  COUNT(lead_managers) as has_lead_managers,
  ROUND(100.0 * COUNT(lead_managers) / COUNT(*), 2) as lead_managers_pct,

  COUNT(last_scraped_at) as has_last_scraped,
  ROUND(100.0 * COUNT(last_scraped_at) / COUNT(*), 2) as last_scraped_pct
FROM ipos;

-- -----------------------------------------------------------------------------
-- 2. Historical Performance Fields Population
-- -----------------------------------------------------------------------------
-- Description: Shows population of historical/calculated fields
-- Expected: Only populated for CLOSED/LISTED IPOs
-- -----------------------------------------------------------------------------
SELECT
  COUNT(*) as total_ipos,

  -- Subscription fields
  COUNT(subscription_retail) as has_sub_retail,
  ROUND(100.0 * COUNT(subscription_retail) / COUNT(*), 2) as sub_retail_pct,

  COUNT(subscription_hni) as has_sub_hni,
  ROUND(100.0 * COUNT(subscription_hni) / COUNT(*), 2) as sub_hni_pct,

  COUNT(subscription_qib) as has_sub_qib,
  ROUND(100.0 * COUNT(subscription_qib) / COUNT(*), 2) as sub_qib_pct,

  COUNT(subscription_total) as has_sub_total,
  ROUND(100.0 * COUNT(subscription_total) / COUNT(*), 2) as sub_total_pct,

  -- GMP fields
  COUNT(gmp_price) as has_gmp_price,
  ROUND(100.0 * COUNT(gmp_price) / COUNT(*), 2) as gmp_price_pct,

  COUNT(gmp_percentage_historical) as has_gmp_percentage,
  ROUND(100.0 * COUNT(gmp_percentage_historical) / COUNT(*), 2) as gmp_percentage_pct,

  -- Listing performance fields
  COUNT(listing_price_historical) as has_listing_price,
  ROUND(100.0 * COUNT(listing_price_historical) / COUNT(*), 2) as listing_price_pct,

  COUNT(listing_gain_percentage_historical) as has_listing_gain_pct,
  ROUND(100.0 * COUNT(listing_gain_percentage_historical) / COUNT(*), 2) as listing_gain_pct_pct,

  COUNT(current_price_historical) as has_current_price,
  ROUND(100.0 * COUNT(current_price_historical) / COUNT(*), 2) as current_price_pct
FROM ipos;

-- -----------------------------------------------------------------------------
-- 3. Field Population by IPO Status
-- -----------------------------------------------------------------------------
-- Description: Shows field coverage segmented by IPO status
-- Expected: Different fields should be populated for different statuses
-- -----------------------------------------------------------------------------
SELECT
  status,
  COUNT(*) as total_count,

  -- Core fields
  COUNT(open_date) as has_open_date,
  ROUND(100.0 * COUNT(open_date) / COUNT(*), 1) as open_date_pct,

  COUNT(close_date) as has_close_date,
  ROUND(100.0 * COUNT(close_date) / COUNT(*), 1) as close_date_pct,

  COUNT(issue_size) as has_issue_size,
  ROUND(100.0 * COUNT(issue_size) / COUNT(*), 1) as issue_size_pct,

  COUNT(lot_size) as has_lot_size,
  ROUND(100.0 * COUNT(lot_size) / COUNT(*), 1) as lot_size_pct,

  COUNT(sector) as has_sector,
  ROUND(100.0 * COUNT(sector) / COUNT(*), 1) as sector_pct,

  -- Status-specific fields
  COUNT(subscription_total) as has_subscription,
  ROUND(100.0 * COUNT(subscription_total) / COUNT(*), 1) as subscription_pct,

  COUNT(gmp_price) as has_gmp,
  ROUND(100.0 * COUNT(gmp_price) / COUNT(*), 1) as gmp_pct,

  COUNT(listing_price_historical) as has_listing_price,
  ROUND(100.0 * COUNT(listing_price_historical) / COUNT(*), 1) as listing_price_pct
FROM ipos
GROUP BY status
ORDER BY
  CASE status
    WHEN 'UPCOMING' THEN 1
    WHEN 'OPEN' THEN 2
    WHEN 'CLOSED' THEN 3
    WHEN 'LISTED' THEN 4
    ELSE 5
  END;

-- -----------------------------------------------------------------------------
-- 4. Field Population by Category
-- -----------------------------------------------------------------------------
-- Description: Shows field coverage segmented by category (MAINBOARD vs SME)
-- Expected: Similar coverage across categories for core fields
-- -----------------------------------------------------------------------------
SELECT
  category,
  COUNT(*) as total_count,

  COUNT(company_name) as has_company_name,
  ROUND(100.0 * COUNT(company_name) / COUNT(*), 1) as company_name_pct,

  COUNT(sector) as has_sector,
  ROUND(100.0 * COUNT(sector) / COUNT(*), 1) as sector_pct,

  COUNT(issue_size) as has_issue_size,
  ROUND(100.0 * COUNT(issue_size) / COUNT(*), 1) as issue_size_pct,

  COUNT(lot_size) as has_lot_size,
  ROUND(100.0 * COUNT(lot_size) / COUNT(*), 1) as lot_size_pct,

  COUNT(open_date) as has_open_date,
  ROUND(100.0 * COUNT(open_date) / COUNT(*), 1) as open_date_pct,

  COUNT(close_date) as has_close_date,
  ROUND(100.0 * COUNT(close_date) / COUNT(*), 1) as close_date_pct,

  COUNT(registrar) as has_registrar,
  ROUND(100.0 * COUNT(registrar) / COUNT(*), 1) as registrar_pct,

  COUNT(gmp_price) as has_gmp,
  ROUND(100.0 * COUNT(gmp_price) / COUNT(*), 1) as gmp_pct
FROM ipos
GROUP BY category
ORDER BY category;

-- -----------------------------------------------------------------------------
-- 5. Detailed Field-by-Field Analysis (Transposed for readability)
-- -----------------------------------------------------------------------------
-- Description: Shows each field as a row with population statistics
-- Expected: Helps identify which specific fields need improvement
-- -----------------------------------------------------------------------------
WITH field_stats AS (
  SELECT 'company_name' as field_name, COUNT(company_name) as populated_count, COUNT(*) as total_count FROM ipos
  UNION ALL SELECT 'slug', COUNT(slug), COUNT(*) FROM ipos
  UNION ALL SELECT 'symbol', COUNT(symbol), COUNT(*) FROM ipos
  UNION ALL SELECT 'isin', COUNT(isin), COUNT(*) FROM ipos
  UNION ALL SELECT 'category', COUNT(category), COUNT(*) FROM ipos
  UNION ALL SELECT 'sector', COUNT(sector), COUNT(*) FROM ipos
  UNION ALL SELECT 'status', COUNT(status), COUNT(*) FROM ipos
  UNION ALL SELECT 'issue_size', COUNT(issue_size), COUNT(*) FROM ipos
  UNION ALL SELECT 'price_range_min', COUNT(price_range_min), COUNT(*) FROM ipos
  UNION ALL SELECT 'price_range_max', COUNT(price_range_max), COUNT(*) FROM ipos
  UNION ALL SELECT 'lot_size', COUNT(lot_size), COUNT(*) FROM ipos
  UNION ALL SELECT 'face_value', COUNT(face_value), COUNT(*) FROM ipos
  UNION ALL SELECT 'open_date', COUNT(open_date), COUNT(*) FROM ipos
  UNION ALL SELECT 'close_date', COUNT(close_date), COUNT(*) FROM ipos
  UNION ALL SELECT 'allotment_date', COUNT(allotment_date), COUNT(*) FROM ipos
  UNION ALL SELECT 'listing_date', COUNT(listing_date), COUNT(*) FROM ipos
  UNION ALL SELECT 'listing_exchanges', COUNT(listing_exchanges), COUNT(*) FROM ipos
  UNION ALL SELECT 'registrar', COUNT(registrar), COUNT(*) FROM ipos
  UNION ALL SELECT 'lead_managers', COUNT(lead_managers), COUNT(*) FROM ipos
  UNION ALL SELECT 'company_description', COUNT(company_description), COUNT(*) FROM ipos
  UNION ALL SELECT 'rating', COUNT(rating), COUNT(*) FROM ipos
  UNION ALL SELECT 'subscription_retail', COUNT(subscription_retail), COUNT(*) FROM ipos
  UNION ALL SELECT 'subscription_hni', COUNT(subscription_hni), COUNT(*) FROM ipos
  UNION ALL SELECT 'subscription_qib', COUNT(subscription_qib), COUNT(*) FROM ipos
  UNION ALL SELECT 'subscription_total', COUNT(subscription_total), COUNT(*) FROM ipos
  UNION ALL SELECT 'gmp_price', COUNT(gmp_price), COUNT(*) FROM ipos
  UNION ALL SELECT 'gmp_percentage_historical', COUNT(gmp_percentage_historical), COUNT(*) FROM ipos
  UNION ALL SELECT 'listing_price_historical', COUNT(listing_price_historical), COUNT(*) FROM ipos
  UNION ALL SELECT 'listing_gain_percentage_historical', COUNT(listing_gain_percentage_historical), COUNT(*) FROM ipos
  UNION ALL SELECT 'current_price_historical', COUNT(current_price_historical), COUNT(*) FROM ipos
  UNION ALL SELECT 'last_scraped_at', COUNT(last_scraped_at), COUNT(*) FROM ipos
)
SELECT
  field_name,
  populated_count,
  total_count,
  (total_count - populated_count) as null_count,
  ROUND(100.0 * populated_count / NULLIF(total_count, 0), 2) as population_pct,
  CASE
    WHEN ROUND(100.0 * populated_count / NULLIF(total_count, 0), 2) = 100 THEN '✓ Complete'
    WHEN ROUND(100.0 * populated_count / NULLIF(total_count, 0), 2) >= 90 THEN '⚠ Good'
    WHEN ROUND(100.0 * populated_count / NULLIF(total_count, 0), 2) >= 50 THEN '⚠ Fair'
    ELSE '✗ Poor'
  END as coverage_status
FROM field_stats
ORDER BY population_pct DESC, field_name;

-- -----------------------------------------------------------------------------
-- 6. Missing Critical Fields Report
-- -----------------------------------------------------------------------------
-- Description: Lists IPOs with missing critical fields that should be populated
-- Expected: Minimal results (only acceptable for UPCOMING IPOs)
-- -----------------------------------------------------------------------------
SELECT
  id,
  company_name,
  status,
  category,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN company_name IS NULL THEN 'company_name' END,
    CASE WHEN slug IS NULL THEN 'slug' END,
    CASE WHEN category IS NULL THEN 'category' END,
    CASE WHEN status IS NULL THEN 'status' END,
    CASE WHEN listing_exchanges IS NULL THEN 'listing_exchanges' END,
    CASE WHEN open_date IS NULL AND status IN ('OPEN', 'CLOSED', 'LISTED') THEN 'open_date' END,
    CASE WHEN close_date IS NULL AND status IN ('CLOSED', 'LISTED') THEN 'close_date' END,
    CASE WHEN issue_size IS NULL AND status IN ('OPEN', 'CLOSED', 'LISTED') THEN 'issue_size' END,
    CASE WHEN lot_size IS NULL AND status IN ('OPEN', 'CLOSED', 'LISTED') THEN 'lot_size' END,
    CASE WHEN price_range_min IS NULL AND status IN ('OPEN', 'CLOSED', 'LISTED') THEN 'price_range_min' END,
    CASE WHEN price_range_max IS NULL AND status IN ('OPEN', 'CLOSED', 'LISTED') THEN 'price_range_max' END,
    CASE WHEN sector IS NULL THEN 'sector' END
  ], NULL) as missing_critical_fields,
  last_scraped_at
FROM ipos
WHERE company_name IS NULL
   OR slug IS NULL
   OR category IS NULL
   OR status IS NULL
   OR listing_exchanges IS NULL
   OR (open_date IS NULL AND status IN ('OPEN', 'CLOSED', 'LISTED'))
   OR (close_date IS NULL AND status IN ('CLOSED', 'LISTED'))
   OR (issue_size IS NULL AND status IN ('OPEN', 'CLOSED', 'LISTED'))
   OR (lot_size IS NULL AND status IN ('OPEN', 'CLOSED', 'LISTED'))
   OR sector IS NULL
ORDER BY
  CASE status
    WHEN 'LISTED' THEN 1
    WHEN 'CLOSED' THEN 2
    WHEN 'OPEN' THEN 3
    WHEN 'UPCOMING' THEN 4
    ELSE 5
  END,
  company_name;

-- -----------------------------------------------------------------------------
-- 7. Field Population Timeline (Recent Scraping Activity)
-- -----------------------------------------------------------------------------
-- Description: Shows when fields were last populated (via last_scraped_at)
-- Expected: Recent scraping should show in last 24 hours
-- -----------------------------------------------------------------------------
SELECT
  CASE
    WHEN last_scraped_at IS NULL THEN 'Never scraped'
    WHEN last_scraped_at > NOW() - INTERVAL '1 hour' THEN 'Last hour'
    WHEN last_scraped_at > NOW() - INTERVAL '6 hours' THEN 'Last 6 hours'
    WHEN last_scraped_at > NOW() - INTERVAL '24 hours' THEN 'Last 24 hours'
    WHEN last_scraped_at > NOW() - INTERVAL '7 days' THEN 'Last week'
    ELSE 'Over 1 week ago'
  END as last_scraped_period,
  COUNT(*) as ipo_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM ipos
GROUP BY last_scraped_period
ORDER BY
  CASE last_scraped_period
    WHEN 'Last hour' THEN 1
    WHEN 'Last 6 hours' THEN 2
    WHEN 'Last 24 hours' THEN 3
    WHEN 'Last week' THEN 4
    WHEN 'Over 1 week ago' THEN 5
    WHEN 'Never scraped' THEN 6
  END;

-- -----------------------------------------------------------------------------
-- SUMMARY: Overall Field Coverage Score
-- -----------------------------------------------------------------------------
WITH field_coverage AS (
  SELECT
    COUNT(*) FILTER (WHERE company_name IS NOT NULL) * 1.0 / COUNT(*) as company_name_cov,
    COUNT(*) FILTER (WHERE slug IS NOT NULL) * 1.0 / COUNT(*) as slug_cov,
    COUNT(*) FILTER (WHERE sector IS NOT NULL) * 1.0 / COUNT(*) as sector_cov,
    COUNT(*) FILTER (WHERE issue_size IS NOT NULL) * 1.0 / COUNT(*) as issue_size_cov,
    COUNT(*) FILTER (WHERE lot_size IS NOT NULL) * 1.0 / COUNT(*) as lot_size_cov,
    COUNT(*) FILTER (WHERE open_date IS NOT NULL) * 1.0 / COUNT(*) as open_date_cov,
    COUNT(*) FILTER (WHERE close_date IS NOT NULL) * 1.0 / COUNT(*) as close_date_cov,
    COUNT(*) FILTER (WHERE registrar IS NOT NULL) * 1.0 / COUNT(*) as registrar_cov,
    COUNT(*) FILTER (WHERE gmp_price IS NOT NULL) * 1.0 / COUNT(*) as gmp_cov,
    COUNT(*) as total_ipos
  FROM ipos
)
SELECT
  total_ipos,
  ROUND(100.0 * (
    company_name_cov + slug_cov + sector_cov + issue_size_cov + lot_size_cov +
    open_date_cov + close_date_cov + registrar_cov + gmp_cov
  ) / 9, 2) as overall_coverage_pct,
  CASE
    WHEN ROUND(100.0 * (company_name_cov + slug_cov + sector_cov + issue_size_cov + lot_size_cov + open_date_cov + close_date_cov + registrar_cov + gmp_cov) / 9, 2) >= 90 THEN '✓ Excellent'
    WHEN ROUND(100.0 * (company_name_cov + slug_cov + sector_cov + issue_size_cov + lot_size_cov + open_date_cov + close_date_cov + registrar_cov + gmp_cov) / 9, 2) >= 75 THEN '⚠ Good'
    WHEN ROUND(100.0 * (company_name_cov + slug_cov + sector_cov + issue_size_cov + lot_size_cov + open_date_cov + close_date_cov + registrar_cov + gmp_cov) / 9, 2) >= 50 THEN '⚠ Fair'
    ELSE '✗ Poor'
  END as overall_status
FROM field_coverage;

-- =============================================================================
-- END OF FIELD COVERAGE REPORT QUERIES
-- =============================================================================
