-- =============================================================================
-- SCRAPER-SPECIFIC FIELD VALIDATION (Section 3.4)
-- =============================================================================
-- Purpose: Verify each scraper populated its assigned fields correctly
-- Expected: Empty result sets indicate complete coverage
-- Non-empty results = missing data from that scraper
-- Scraper Priority: NSE(1) > BSE(2) > Moneycontrol(3) > Chittorgarh(4) > API_Fallback(5)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- NSE SCRAPER RESPONSIBILITY MATRIX
-- -----------------------------------------------------------------------------
-- Description: NSE should populate subscription data, MAINBOARD IPOs, listing exchanges
-- Fields: open_date, close_date, price_range_min, price_range_max, lot_size,
--         listing_exchanges (NSE), subscription data
-- Expected: All MAINBOARD IPOs with NSE listing should have complete NSE data
-- -----------------------------------------------------------------------------

-- Check if NSE scraper ran successfully in last scraping cycle
SELECT
  id,
  source,
  status,
  created_at,
  records_processed,
  records_failed,
  error_message
FROM scraper_logs
WHERE source = 'NSE'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 5;

-- Find MAINBOARD IPOs with NSE listing but missing NSE data
SELECT
  id,
  company_name,
  category,
  status,
  listing_exchanges,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN open_date IS NULL THEN 'open_date' END,
    CASE WHEN close_date IS NULL THEN 'close_date' END,
    CASE WHEN price_range_min IS NULL THEN 'price_range_min' END,
    CASE WHEN price_range_max IS NULL THEN 'price_range_max' END,
    CASE WHEN lot_size IS NULL THEN 'lot_size' END,
    CASE WHEN issue_size IS NULL THEN 'issue_size' END
  ], NULL) as missing_nse_fields,
  CASE WHEN EXISTS (
    SELECT 1 FROM subscriptions WHERE ipo_id = ipos.id
  ) THEN 'YES' ELSE 'NO' END as has_subscription_data,
  last_scraped_at
FROM ipos
WHERE category = 'MAINBOARD'
  AND listing_exchanges @> '["NSE"]'::jsonb
  AND status IN ('OPEN', 'UPCOMING', 'CLOSED', 'LISTED')
  AND (
    open_date IS NULL
    OR close_date IS NULL
    OR price_range_min IS NULL
    OR price_range_max IS NULL
    OR lot_size IS NULL
    OR issue_size IS NULL
  )
ORDER BY status, company_name;

-- Check subscription data coverage for NSE IPOs
SELECT
  i.id,
  i.company_name,
  i.status,
  i.open_date,
  i.close_date,
  COUNT(s.id) as subscription_record_count,
  MAX(s.timestamp) as latest_subscription_timestamp
FROM ipos i
LEFT JOIN subscriptions s ON s.ipo_id = i.id
WHERE i.category = 'MAINBOARD'
  AND i.listing_exchanges @> '["NSE"]'::jsonb
  AND i.status IN ('OPEN', 'CLOSED')
GROUP BY i.id, i.company_name, i.status, i.open_date, i.close_date
HAVING COUNT(s.id) = 0
ORDER BY i.open_date DESC;

-- -----------------------------------------------------------------------------
-- BSE SCRAPER RESPONSIBILITY MATRIX
-- -----------------------------------------------------------------------------
-- Description: BSE should populate SME IPOs, issue_size, price bands
-- Fields: issue_size, price_range_min, price_range_max, lot_size,
--         listing_exchanges (BSE), company details
-- Expected: All SME IPOs with BSE listing should have complete BSE data
-- -----------------------------------------------------------------------------

-- Check if BSE scraper ran successfully
SELECT
  id,
  source,
  status,
  created_at,
  records_processed,
  records_failed,
  error_message
FROM scraper_logs
WHERE source = 'BSE'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 5;

-- Find SME IPOs with BSE listing but missing BSE data
SELECT
  id,
  company_name,
  category,
  status,
  listing_exchanges,
  issue_size,
  price_range_min,
  price_range_max,
  lot_size,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN issue_size IS NULL THEN 'issue_size' END,
    CASE WHEN price_range_min IS NULL THEN 'price_range_min' END,
    CASE WHEN price_range_max IS NULL THEN 'price_range_max' END,
    CASE WHEN lot_size IS NULL THEN 'lot_size' END,
    CASE WHEN open_date IS NULL THEN 'open_date' END,
    CASE WHEN close_date IS NULL THEN 'close_date' END
  ], NULL) as missing_bse_fields,
  last_scraped_at
FROM ipos
WHERE category = 'SME'
  AND listing_exchanges @> '["BSE"]'::jsonb
  AND status IN ('OPEN', 'UPCOMING', 'CLOSED', 'LISTED')
  AND (
    issue_size IS NULL
    OR price_range_min IS NULL
    OR price_range_max IS NULL
    OR lot_size IS NULL
    OR open_date IS NULL
    OR close_date IS NULL
  )
ORDER BY status, company_name;

-- Check for dual-listed IPOs that should have merged NSE+BSE data
SELECT
  id,
  company_name,
  category,
  listing_exchanges,
  issue_size,
  lot_size,
  CASE
    WHEN jsonb_array_length(listing_exchanges) >= 2 THEN 'Dual-listed'
    ELSE 'Single-listed'
  END as listing_type,
  last_scraped_at
FROM ipos
WHERE listing_exchanges @> '["NSE"]'::jsonb
  AND listing_exchanges @> '["BSE"]'::jsonb
  AND (issue_size IS NULL OR lot_size IS NULL)
ORDER BY company_name;

-- -----------------------------------------------------------------------------
-- CHITTORGARH SCRAPER RESPONSIBILITY MATRIX
-- -----------------------------------------------------------------------------
-- Description: Chittorgarh should populate GMP data (historical tracking)
-- Fields: gmp_price, gmp_percentage_historical, gmp_records table entries
-- Expected: All OPEN/CLOSED/LISTED IPOs should have GMP data
-- -----------------------------------------------------------------------------

-- Check if Chittorgarh scraper ran successfully
SELECT
  id,
  source,
  status,
  created_at,
  records_processed,
  records_failed,
  error_message
FROM scraper_logs
WHERE source = 'CHITTORGARH'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 5;

-- Find IPOs missing GMP data that Chittorgarh should provide
SELECT
  i.id,
  i.company_name,
  i.category,
  i.status,
  i.gmp_price,
  i.gmp_percentage_historical,
  COUNT(g.id) as gmp_record_count,
  MAX(g.timestamp) as latest_gmp_timestamp,
  i.last_scraped_at
FROM ipos i
LEFT JOIN gmp_records g ON g.ipo_id = i.id
WHERE i.status IN ('OPEN', 'CLOSED', 'LISTED')
GROUP BY i.id, i.company_name, i.category, i.status, i.gmp_price, i.gmp_percentage_historical, i.last_scraped_at
HAVING i.gmp_price IS NULL OR COUNT(g.id) = 0
ORDER BY i.status, i.company_name;

-- Check GMP records time-series coverage
SELECT
  i.company_name,
  i.status,
  COUNT(g.id) as total_gmp_records,
  MIN(g.timestamp) as first_gmp_record,
  MAX(g.timestamp) as latest_gmp_record,
  CASE
    WHEN COUNT(g.id) = 0 THEN 'NO GMP DATA'
    WHEN COUNT(g.id) = 1 THEN 'SINGLE RECORD (not time-series)'
    WHEN MAX(g.timestamp) < NOW() - INTERVAL '7 days' THEN 'STALE DATA (> 7 days old)'
    ELSE 'OK'
  END as gmp_data_status
FROM ipos i
LEFT JOIN gmp_records g ON g.ipo_id = i.id
WHERE i.status IN ('OPEN', 'CLOSED', 'LISTED')
GROUP BY i.id, i.company_name, i.status
ORDER BY total_gmp_records, i.company_name;

-- -----------------------------------------------------------------------------
-- MONEYCONTROL SCRAPER RESPONSIBILITY MATRIX
-- -----------------------------------------------------------------------------
-- Description: Moneycontrol should populate sector, company descriptions, ratings
-- Fields: sector, company_description, rating, company_overview
-- Expected: All IPOs should have sector and descriptions from Moneycontrol
-- -----------------------------------------------------------------------------

-- Check if Moneycontrol scraper ran successfully
SELECT
  id,
  source,
  status,
  created_at,
  records_processed,
  records_failed,
  error_message
FROM scraper_logs
WHERE source = 'MONEYCONTROL'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 5;

-- Find IPOs missing Moneycontrol data
SELECT
  id,
  company_name,
  category,
  status,
  sector,
  company_description,
  rating,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN sector IS NULL THEN 'sector' END,
    CASE WHEN company_description IS NULL THEN 'company_description' END,
    CASE WHEN company_description IS NOT NULL AND LENGTH(company_description) < 50 THEN 'description_too_short' END,
    CASE WHEN rating IS NULL THEN 'rating' END
  ], NULL) as missing_moneycontrol_fields,
  last_scraped_at
FROM ipos
WHERE sector IS NULL
   OR company_description IS NULL
   OR LENGTH(company_description) < 50
   OR rating IS NULL
ORDER BY status, company_name;

-- Check company description quality
SELECT
  company_name,
  status,
  sector,
  LENGTH(company_description) as description_length,
  CASE
    WHEN company_description IS NULL THEN 'MISSING'
    WHEN LENGTH(company_description) < 50 THEN 'TOO SHORT'
    WHEN LENGTH(company_description) < 200 THEN 'MINIMAL'
    WHEN LENGTH(company_description) < 500 THEN 'ADEQUATE'
    ELSE 'COMPREHENSIVE'
  END as description_quality,
  rating
FROM ipos
WHERE status IN ('OPEN', 'UPCOMING', 'CLOSED', 'LISTED')
ORDER BY description_length;

-- -----------------------------------------------------------------------------
-- API FALLBACK RESPONSIBILITY MATRIX
-- -----------------------------------------------------------------------------
-- Description: API Fallback (IPO Alerts) should fill gaps from other scrapers
-- Purpose: Catch any IPOs that main scrapers missed
-- Expected: Minimal usage (only for edge cases)
-- -----------------------------------------------------------------------------

-- Check if API Fallback ran successfully
SELECT
  id,
  source,
  status,
  created_at,
  records_processed,
  records_failed,
  error_message
FROM scraper_logs
WHERE source = 'API_FALLBACK'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 5;

-- Find IPOs that were populated only by API fallback (no other source)
-- Note: This requires tracking which scraper populated which IPO
-- For now, check IPOs with minimal data that might be API-only
SELECT
  id,
  company_name,
  category,
  status,
  listing_exchanges,
  open_date,
  close_date,
  issue_size,
  sector,
  last_scraped_at,
  CASE
    WHEN sector IS NOT NULL AND company_description IS NOT NULL THEN 'Has Moneycontrol data'
    WHEN EXISTS (SELECT 1 FROM subscriptions WHERE ipo_id = ipos.id) THEN 'Has NSE subscription data'
    WHEN EXISTS (SELECT 1 FROM gmp_records WHERE ipo_id = ipos.id) THEN 'Has Chittorgarh GMP data'
    ELSE 'Possibly API-only data'
  END as likely_primary_source
FROM ipos
WHERE last_scraped_at > NOW() - INTERVAL '24 hours'
ORDER BY last_scraped_at DESC;

-- -----------------------------------------------------------------------------
-- SUMMARY: Field population by scraper responsibility
-- -----------------------------------------------------------------------------
WITH scraper_coverage AS (
  SELECT
    'NSE Fields (MAINBOARD with NSE)' as coverage_type,
    COUNT(*) as total_ipos,
    COUNT(*) FILTER (WHERE open_date IS NOT NULL) as has_open_date,
    COUNT(*) FILTER (WHERE close_date IS NOT NULL) as has_close_date,
    COUNT(*) FILTER (WHERE price_range_min IS NOT NULL) as has_price_min,
    COUNT(*) FILTER (WHERE lot_size IS NOT NULL) as has_lot_size,
    COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM subscriptions WHERE ipo_id = ipos.id)) as has_subscriptions
  FROM ipos
  WHERE category = 'MAINBOARD'
    AND listing_exchanges @> '["NSE"]'::jsonb
    AND status IN ('OPEN', 'UPCOMING', 'CLOSED', 'LISTED')

  UNION ALL

  SELECT
    'BSE Fields (SME with BSE)' as coverage_type,
    COUNT(*) as total_ipos,
    COUNT(*) FILTER (WHERE issue_size IS NOT NULL) as has_issue_size,
    COUNT(*) FILTER (WHERE price_range_min IS NOT NULL) as has_price_min,
    COUNT(*) FILTER (WHERE price_range_max IS NOT NULL) as has_price_max,
    COUNT(*) FILTER (WHERE lot_size IS NOT NULL) as has_lot_size,
    0 as placeholder -- BSE doesn't track subscriptions same way
  FROM ipos
  WHERE category = 'SME'
    AND listing_exchanges @> '["BSE"]'::jsonb

  UNION ALL

  SELECT
    'Chittorgarh GMP Data' as coverage_type,
    COUNT(*) as total_ipos,
    COUNT(*) FILTER (WHERE gmp_price IS NOT NULL) as has_gmp_price,
    COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM gmp_records WHERE ipo_id = ipos.id)) as has_gmp_records,
    0, 0, 0 -- placeholders
  FROM ipos
  WHERE status IN ('OPEN', 'CLOSED', 'LISTED')

  UNION ALL

  SELECT
    'Moneycontrol Company Data' as coverage_type,
    COUNT(*) as total_ipos,
    COUNT(*) FILTER (WHERE sector IS NOT NULL) as has_sector,
    COUNT(*) FILTER (WHERE company_description IS NOT NULL) as has_description,
    COUNT(*) FILTER (WHERE rating IS NOT NULL) as has_rating,
    0, 0 -- placeholders
  FROM ipos
  WHERE status IN ('OPEN', 'UPCOMING', 'CLOSED', 'LISTED')
)
SELECT
  coverage_type,
  total_ipos,
  has_open_date,
  has_close_date,
  has_price_min,
  has_lot_size,
  has_subscriptions,
  CASE
    WHEN total_ipos = 0 THEN 0
    ELSE ROUND(100.0 * has_open_date / total_ipos, 1)
  END as coverage_pct
FROM scraper_coverage
ORDER BY coverage_type;

-- =============================================================================
-- END OF SCRAPER-SPECIFIC FIELD VALIDATION QUERIES
-- =============================================================================
