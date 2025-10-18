-- =============================================================================
-- FIELD POPULATION REPORT (Section 3.10)
-- =============================================================================
-- Purpose: Comprehensive report on field population across all tables
-- Shows detailed statistics for every field in the database
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Core IPO Fields Population Report
-- -----------------------------------------------------------------------------
-- Description: Detailed analysis of all fields in ipos table
-- Shows count, percentage, and null count for each field
-- -----------------------------------------------------------------------------
SELECT
  'CORE IDENTITY FIELDS' as field_category,
  'company_name' as field_name,
  COUNT(company_name) as populated_count,
  COUNT(*) - COUNT(company_name) as null_count,
  COUNT(*) as total_count,
  ROUND(100.0 * COUNT(company_name) / COUNT(*), 2) as population_pct
FROM ipos

UNION ALL

SELECT 'CORE IDENTITY FIELDS', 'slug', COUNT(slug), COUNT(*) - COUNT(slug), COUNT(*),
       ROUND(100.0 * COUNT(slug) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'CORE IDENTITY FIELDS', 'symbol', COUNT(symbol), COUNT(*) - COUNT(symbol), COUNT(*),
       ROUND(100.0 * COUNT(symbol) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'CORE IDENTITY FIELDS', 'isin', COUNT(isin), COUNT(*) - COUNT(isin), COUNT(*),
       ROUND(100.0 * COUNT(isin) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'CLASSIFICATION FIELDS', 'category', COUNT(category), COUNT(*) - COUNT(category), COUNT(*),
       ROUND(100.0 * COUNT(category) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'CLASSIFICATION FIELDS', 'sector', COUNT(sector), COUNT(*) - COUNT(sector), COUNT(*),
       ROUND(100.0 * COUNT(sector) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'CLASSIFICATION FIELDS', 'status', COUNT(status), COUNT(*) - COUNT(status), COUNT(*),
       ROUND(100.0 * COUNT(status) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'FINANCIAL FIELDS', 'issue_size', COUNT(issue_size), COUNT(*) - COUNT(issue_size), COUNT(*),
       ROUND(100.0 * COUNT(issue_size) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'FINANCIAL FIELDS', 'price_range_min', COUNT(price_range_min), COUNT(*) - COUNT(price_range_min), COUNT(*),
       ROUND(100.0 * COUNT(price_range_min) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'FINANCIAL FIELDS', 'price_range_max', COUNT(price_range_max), COUNT(*) - COUNT(price_range_max), COUNT(*),
       ROUND(100.0 * COUNT(price_range_max) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'FINANCIAL FIELDS', 'lot_size', COUNT(lot_size), COUNT(*) - COUNT(lot_size), COUNT(*),
       ROUND(100.0 * COUNT(lot_size) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'FINANCIAL FIELDS', 'face_value', COUNT(face_value), COUNT(*) - COUNT(face_value), COUNT(*),
       ROUND(100.0 * COUNT(face_value) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'DATE FIELDS', 'open_date', COUNT(open_date), COUNT(*) - COUNT(open_date), COUNT(*),
       ROUND(100.0 * COUNT(open_date) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'DATE FIELDS', 'close_date', COUNT(close_date), COUNT(*) - COUNT(close_date), COUNT(*),
       ROUND(100.0 * COUNT(close_date) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'DATE FIELDS', 'allotment_date', COUNT(allotment_date), COUNT(*) - COUNT(allotment_date), COUNT(*),
       ROUND(100.0 * COUNT(allotment_date) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'DATE FIELDS', 'listing_date', COUNT(listing_date), COUNT(*) - COUNT(listing_date), COUNT(*),
       ROUND(100.0 * COUNT(listing_date) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'RELATIONSHIP FIELDS', 'listing_exchanges', COUNT(listing_exchanges), COUNT(*) - COUNT(listing_exchanges), COUNT(*),
       ROUND(100.0 * COUNT(listing_exchanges) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'RELATIONSHIP FIELDS', 'registrar', COUNT(registrar), COUNT(*) - COUNT(registrar), COUNT(*),
       ROUND(100.0 * COUNT(registrar) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'RELATIONSHIP FIELDS', 'lead_managers', COUNT(lead_managers), COUNT(*) - COUNT(lead_managers), COUNT(*),
       ROUND(100.0 * COUNT(lead_managers) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'DESCRIPTION FIELDS', 'company_description', COUNT(company_description), COUNT(*) - COUNT(company_description), COUNT(*),
       ROUND(100.0 * COUNT(company_description) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'DESCRIPTION FIELDS', 'rating', COUNT(rating), COUNT(*) - COUNT(rating), COUNT(*),
       ROUND(100.0 * COUNT(rating) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'HISTORICAL SUBSCRIPTION FIELDS', 'subscription_retail', COUNT(subscription_retail), COUNT(*) - COUNT(subscription_retail), COUNT(*),
       ROUND(100.0 * COUNT(subscription_retail) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'HISTORICAL SUBSCRIPTION FIELDS', 'subscription_hni', COUNT(subscription_hni), COUNT(*) - COUNT(subscription_hni), COUNT(*),
       ROUND(100.0 * COUNT(subscription_hni) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'HISTORICAL SUBSCRIPTION FIELDS', 'subscription_qib', COUNT(subscription_qib), COUNT(*) - COUNT(subscription_qib), COUNT(*),
       ROUND(100.0 * COUNT(subscription_qib) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'HISTORICAL SUBSCRIPTION FIELDS', 'subscription_total', COUNT(subscription_total), COUNT(*) - COUNT(subscription_total), COUNT(*),
       ROUND(100.0 * COUNT(subscription_total) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'GMP FIELDS', 'gmp_price', COUNT(gmp_price), COUNT(*) - COUNT(gmp_price), COUNT(*),
       ROUND(100.0 * COUNT(gmp_price) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'GMP FIELDS', 'gmp_percentage_historical', COUNT(gmp_percentage_historical), COUNT(*) - COUNT(gmp_percentage_historical), COUNT(*),
       ROUND(100.0 * COUNT(gmp_percentage_historical) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'LISTING PERFORMANCE FIELDS', 'listing_price_historical', COUNT(listing_price_historical), COUNT(*) - COUNT(listing_price_historical), COUNT(*),
       ROUND(100.0 * COUNT(listing_price_historical) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'LISTING PERFORMANCE FIELDS', 'listing_gain_percentage_historical', COUNT(listing_gain_percentage_historical), COUNT(*) - COUNT(listing_gain_percentage_historical), COUNT(*),
       ROUND(100.0 * COUNT(listing_gain_percentage_historical) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'LISTING PERFORMANCE FIELDS', 'current_price_historical', COUNT(current_price_historical), COUNT(*) - COUNT(current_price_historical), COUNT(*),
       ROUND(100.0 * COUNT(current_price_historical) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'METADATA FIELDS', 'last_scraped_at', COUNT(last_scraped_at), COUNT(*) - COUNT(last_scraped_at), COUNT(*),
       ROUND(100.0 * COUNT(last_scraped_at) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'METADATA FIELDS', 'created_at', COUNT(created_at), COUNT(*) - COUNT(created_at), COUNT(*),
       ROUND(100.0 * COUNT(created_at) / COUNT(*), 2) FROM ipos

UNION ALL

SELECT 'METADATA FIELDS', 'updated_at', COUNT(updated_at), COUNT(*) - COUNT(updated_at), COUNT(*),
       ROUND(100.0 * COUNT(updated_at) / COUNT(*), 2) FROM ipos

ORDER BY field_category, population_pct DESC, field_name;

-- -----------------------------------------------------------------------------
-- 2. Field Population by IPO Status
-- -----------------------------------------------------------------------------
-- Description: Shows how field population varies by IPO status
-- Expected: LISTED IPOs should have most complete data
-- -----------------------------------------------------------------------------
SELECT
  status,
  COUNT(*) as total_ipos,

  -- Critical fields (should be 100% for all statuses)
  ROUND(100.0 * COUNT(company_name) / COUNT(*), 1) as company_name_pct,
  ROUND(100.0 * COUNT(slug) / COUNT(*), 1) as slug_pct,
  ROUND(100.0 * COUNT(category) / COUNT(*), 1) as category_pct,

  -- Financial fields (should be high for OPEN/CLOSED/LISTED)
  ROUND(100.0 * COUNT(issue_size) / COUNT(*), 1) as issue_size_pct,
  ROUND(100.0 * COUNT(lot_size) / COUNT(*), 1) as lot_size_pct,
  ROUND(100.0 * COUNT(price_range_min) / COUNT(*), 1) as price_min_pct,
  ROUND(100.0 * COUNT(price_range_max) / COUNT(*), 1) as price_max_pct,

  -- Date fields (expected based on status)
  ROUND(100.0 * COUNT(open_date) / COUNT(*), 1) as open_date_pct,
  ROUND(100.0 * COUNT(close_date) / COUNT(*), 1) as close_date_pct,
  ROUND(100.0 * COUNT(listing_date) / COUNT(*), 1) as listing_date_pct,

  -- Optional/enrichment fields
  ROUND(100.0 * COUNT(sector) / COUNT(*), 1) as sector_pct,
  ROUND(100.0 * COUNT(registrar) / COUNT(*), 1) as registrar_pct,

  -- Performance fields (only for CLOSED/LISTED)
  ROUND(100.0 * COUNT(subscription_total) / COUNT(*), 1) as subscription_pct,
  ROUND(100.0 * COUNT(gmp_price) / COUNT(*), 1) as gmp_pct,
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
-- 3. Field Population by Category
-- -----------------------------------------------------------------------------
-- Description: Compares field population between MAINBOARD and SME IPOs
-- Expected: Similar coverage for core fields
-- -----------------------------------------------------------------------------
SELECT
  category,
  COUNT(*) as total_ipos,

  -- Core fields
  ROUND(100.0 * COUNT(company_name) / COUNT(*), 1) as company_name_pct,
  ROUND(100.0 * COUNT(sector) / COUNT(*), 1) as sector_pct,
  ROUND(100.0 * COUNT(symbol) / COUNT(*), 1) as symbol_pct,
  ROUND(100.0 * COUNT(isin) / COUNT(*), 1) as isin_pct,

  -- Financial fields
  ROUND(100.0 * COUNT(issue_size) / COUNT(*), 1) as issue_size_pct,
  ROUND(100.0 * COUNT(lot_size) / COUNT(*), 1) as lot_size_pct,
  ROUND(100.0 * COUNT(price_range_min) / COUNT(*), 1) as price_min_pct,

  -- Date fields
  ROUND(100.0 * COUNT(open_date) / COUNT(*), 1) as open_date_pct,
  ROUND(100.0 * COUNT(close_date) / COUNT(*), 1) as close_date_pct,

  -- Relationship fields
  ROUND(100.0 * COUNT(registrar) / COUNT(*), 1) as registrar_pct,
  ROUND(100.0 * COUNT(lead_managers) / COUNT(*), 1) as lead_managers_pct,

  -- GMP fields (may differ between categories)
  ROUND(100.0 * COUNT(gmp_price) / COUNT(*), 1) as gmp_pct

FROM ipos
GROUP BY category
ORDER BY category;

-- -----------------------------------------------------------------------------
-- 4. Field Population Heatmap (Status x Category)
-- -----------------------------------------------------------------------------
-- Description: Cross-tabulation of field population by status and category
-- Shows which combinations have data gaps
-- -----------------------------------------------------------------------------
SELECT
  category,
  status,
  COUNT(*) as ipo_count,
  ROUND(100.0 * COUNT(issue_size) / COUNT(*), 0) as issue_size_pct,
  ROUND(100.0 * COUNT(lot_size) / COUNT(*), 0) as lot_size_pct,
  ROUND(100.0 * COUNT(sector) / COUNT(*), 0) as sector_pct,
  ROUND(100.0 * COUNT(open_date) / COUNT(*), 0) as open_date_pct,
  ROUND(100.0 * COUNT(gmp_price) / COUNT(*), 0) as gmp_pct,
  ROUND(100.0 * COUNT(subscription_total) / COUNT(*), 0) as subscription_pct
FROM ipos
GROUP BY category, status
ORDER BY category,
  CASE status
    WHEN 'UPCOMING' THEN 1
    WHEN 'OPEN' THEN 2
    WHEN 'CLOSED' THEN 3
    WHEN 'LISTED' THEN 4
    ELSE 5
  END;

-- -----------------------------------------------------------------------------
-- 5. Recently Scraped vs Older Data Comparison
-- -----------------------------------------------------------------------------
-- Description: Compares field population for recently scraped vs older IPOs
-- Expected: Recently scraped IPOs should have better coverage
-- -----------------------------------------------------------------------------
SELECT
  CASE
    WHEN last_scraped_at > NOW() - INTERVAL '24 hours' THEN 'Last 24 hours'
    WHEN last_scraped_at > NOW() - INTERVAL '7 days' THEN 'Last 7 days'
    WHEN last_scraped_at > NOW() - INTERVAL '30 days' THEN 'Last 30 days'
    WHEN last_scraped_at IS NULL THEN 'Never scraped'
    ELSE 'Over 30 days ago'
  END as scrape_recency,

  COUNT(*) as ipo_count,

  -- Core field coverage
  ROUND(100.0 * COUNT(sector) / COUNT(*), 1) as sector_pct,
  ROUND(100.0 * COUNT(issue_size) / COUNT(*), 1) as issue_size_pct,
  ROUND(100.0 * COUNT(lot_size) / COUNT(*), 1) as lot_size_pct,
  ROUND(100.0 * COUNT(registrar) / COUNT(*), 1) as registrar_pct,

  -- Optional field coverage
  ROUND(100.0 * COUNT(symbol) / COUNT(*), 1) as symbol_pct,
  ROUND(100.0 * COUNT(isin) / COUNT(*), 1) as isin_pct,
  ROUND(100.0 * COUNT(company_description) / COUNT(*), 1) as description_pct

FROM ipos
GROUP BY scrape_recency
ORDER BY
  CASE scrape_recency
    WHEN 'Last 24 hours' THEN 1
    WHEN 'Last 7 days' THEN 2
    WHEN 'Last 30 days' THEN 3
    WHEN 'Over 30 days ago' THEN 4
    WHEN 'Never scraped' THEN 5
  END;

-- -----------------------------------------------------------------------------
-- 6. Top 10 Most Complete IPOs
-- -----------------------------------------------------------------------------
-- Description: IPOs with highest field population rates
-- Purpose: Examples of well-scraped records
-- -----------------------------------------------------------------------------
WITH field_completeness AS (
  SELECT
    id,
    company_name,
    status,
    category,
    (
      CASE WHEN company_name IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN slug IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN symbol IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN isin IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN sector IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN issue_size IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN lot_size IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN price_range_min IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN price_range_max IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN open_date IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN close_date IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN listing_exchanges IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN registrar IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN company_description IS NOT NULL THEN 1 ELSE 0 END
    ) as populated_fields,
    last_scraped_at
  FROM ipos
)
SELECT
  company_name,
  status,
  category,
  populated_fields,
  ROUND(100.0 * populated_fields / 14, 1) as completeness_pct,
  last_scraped_at
FROM field_completeness
ORDER BY populated_fields DESC, company_name
LIMIT 10;

-- -----------------------------------------------------------------------------
-- 7. Top 10 Least Complete IPOs (Needing Attention)
-- -----------------------------------------------------------------------------
-- Description: IPOs with lowest field population rates
-- Purpose: Identify records that need re-scraping
-- -----------------------------------------------------------------------------
WITH field_completeness AS (
  SELECT
    id,
    company_name,
    status,
    category,
    (
      CASE WHEN company_name IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN slug IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN sector IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN issue_size IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN lot_size IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN price_range_min IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN open_date IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN close_date IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN listing_exchanges IS NOT NULL THEN 1 ELSE 0 END
    ) as populated_critical_fields,
    last_scraped_at
  FROM ipos
)
SELECT
  company_name,
  status,
  category,
  populated_critical_fields,
  ROUND(100.0 * populated_critical_fields / 9, 1) as completeness_pct,
  last_scraped_at
FROM field_completeness
WHERE status IN ('OPEN', 'UPCOMING', 'CLOSED', 'LISTED')
ORDER BY populated_critical_fields ASC, company_name
LIMIT 10;

-- -----------------------------------------------------------------------------
-- SUMMARY: Overall Database Completeness Score
-- -----------------------------------------------------------------------------
WITH completeness_metrics AS (
  SELECT
    COUNT(*) as total_ipos,

    -- Critical fields score (weight: 2x)
    AVG(CASE WHEN company_name IS NOT NULL THEN 100 ELSE 0 END) as company_name_score,
    AVG(CASE WHEN slug IS NOT NULL THEN 100 ELSE 0 END) as slug_score,
    AVG(CASE WHEN status IS NOT NULL THEN 100 ELSE 0 END) as status_score,
    AVG(CASE WHEN category IS NOT NULL THEN 100 ELSE 0 END) as category_score,

    -- Important fields score (weight: 1.5x)
    AVG(CASE WHEN issue_size IS NOT NULL THEN 100 ELSE 0 END) as issue_size_score,
    AVG(CASE WHEN lot_size IS NOT NULL THEN 100 ELSE 0 END) as lot_size_score,
    AVG(CASE WHEN open_date IS NOT NULL THEN 100 ELSE 0 END) as open_date_score,
    AVG(CASE WHEN close_date IS NOT NULL THEN 100 ELSE 0 END) as close_date_score,

    -- Optional fields score (weight: 1x)
    AVG(CASE WHEN sector IS NOT NULL THEN 100 ELSE 0 END) as sector_score,
    AVG(CASE WHEN registrar IS NOT NULL THEN 100 ELSE 0 END) as registrar_score,
    AVG(CASE WHEN gmp_price IS NOT NULL THEN 100 ELSE 0 END) as gmp_score

  FROM ipos
)
SELECT
  total_ipos,
  ROUND((
    (company_name_score + slug_score + status_score + category_score) * 2 +
    (issue_size_score + lot_size_score + open_date_score + close_date_score) * 1.5 +
    (sector_score + registrar_score + gmp_score) * 1
  ) / 14, 2) as weighted_completeness_score,
  CASE
    WHEN ROUND((
      (company_name_score + slug_score + status_score + category_score) * 2 +
      (issue_size_score + lot_size_score + open_date_score + close_date_score) * 1.5 +
      (sector_score + registrar_score + gmp_score) * 1
    ) / 14, 2) >= 90 THEN '✓ Excellent (≥90%)'
    WHEN ROUND((
      (company_name_score + slug_score + status_score + category_score) * 2 +
      (issue_size_score + lot_size_score + open_date_score + close_date_score) * 1.5 +
      (sector_score + registrar_score + gmp_score) * 1
    ) / 14, 2) >= 75 THEN '⚠ Good (≥75%)'
    WHEN ROUND((
      (company_name_score + slug_score + status_score + category_score) * 2 +
      (issue_size_score + lot_size_score + open_date_score + close_date_score) * 1.5 +
      (sector_score + registrar_score + gmp_score) * 1
    ) / 14, 2) >= 60 THEN '⚠ Fair (≥60%)'
    ELSE '✗ Poor (<60%)'
  END as overall_grade
FROM completeness_metrics;

-- =============================================================================
-- END OF FIELD POPULATION REPORT QUERIES
-- =============================================================================
