-- =============================================================================
-- CONFLICT RESOLUTION PRIORITY VERIFICATION (Section 3.6)
-- =============================================================================
-- Purpose: Verify scraper priority system works correctly
-- Scraper Priority: NSE(1) > BSE(2) > Moneycontrol(3) > Chittorgarh(4) > API_Fallback(5)
-- Expected: Higher priority data should overwrite lower priority data
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Identify Dual-Listed IPOs (Scraped by Multiple Sources)
-- -----------------------------------------------------------------------------
-- Description: Finds IPOs listed on both NSE and BSE
-- These are candidates for conflict resolution testing
-- Expected: Some dual-listed IPOs should exist
-- -----------------------------------------------------------------------------
SELECT
  id,
  company_name,
  category,
  listing_exchanges,
  issue_size,
  sector,
  lot_size,
  price_range_min,
  price_range_max,
  last_scraped_at,
  jsonb_array_length(listing_exchanges) as exchange_count
FROM ipos
WHERE listing_exchanges @> '["NSE"]'::jsonb
  AND listing_exchanges @> '["BSE"]'::jsonb
ORDER BY company_name;

-- -----------------------------------------------------------------------------
-- 2. Scraper Execution Timeline
-- -----------------------------------------------------------------------------
-- Description: Shows the order in which scrapers ran
-- Purpose: Determine if NSE ran before BSE (or vice versa)
-- Expected: Helps verify conflict resolution based on run order
-- -----------------------------------------------------------------------------
SELECT
  id,
  source,
  status,
  created_at,
  records_processed,
  records_failed,
  duration_ms,
  ROW_NUMBER() OVER (ORDER BY created_at) as execution_order
FROM scraper_logs
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND status = 'SUCCESS'
  AND source IN ('NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH', 'API_FALLBACK')
ORDER BY created_at;

-- -----------------------------------------------------------------------------
-- 3. Scraper Run Summary by Source
-- -----------------------------------------------------------------------------
-- Description: Shows last successful run for each scraper
-- Expected: All scrapers should have recent successful runs
-- -----------------------------------------------------------------------------
SELECT
  source,
  MAX(created_at) as last_successful_run,
  COUNT(*) as total_successful_runs,
  SUM(records_processed) as total_records_processed,
  AVG(duration_ms) as avg_duration_ms
FROM scraper_logs
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND status = 'SUCCESS'
GROUP BY source
ORDER BY
  CASE source
    WHEN 'NSE' THEN 1
    WHEN 'BSE' THEN 2
    WHEN 'MONEYCONTROL' THEN 3
    WHEN 'CHITTORGARH' THEN 4
    WHEN 'API_FALLBACK' THEN 5
    ELSE 6
  END;

-- -----------------------------------------------------------------------------
-- 4. Dual-Listed IPO Data Comparison
-- -----------------------------------------------------------------------------
-- Description: For dual-listed IPOs, show key fields that might conflict
-- Purpose: Manual verification of which source's data was kept
-- Expected: NSE data should be preserved over BSE data for conflicting fields
-- Note: This query helps identify if conflict resolution worked
-- -----------------------------------------------------------------------------
WITH dual_listed AS (
  SELECT
    id,
    company_name,
    listing_exchanges,
    issue_size,
    lot_size,
    price_range_min,
    price_range_max,
    sector,
    open_date,
    close_date,
    last_scraped_at
  FROM ipos
  WHERE listing_exchanges @> '["NSE"]'::jsonb
    AND listing_exchanges @> '["BSE"]'::jsonb
)
SELECT
  dl.*,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM scraper_logs
      WHERE source = 'NSE'
        AND status = 'SUCCESS'
        AND created_at > dl.last_scraped_at - INTERVAL '1 hour'
    ) THEN 'NSE scraped recently'
    ELSE 'NSE not in recent scrape'
  END as nse_scrape_status,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM scraper_logs
      WHERE source = 'BSE'
        AND status = 'SUCCESS'
        AND created_at > dl.last_scraped_at - INTERVAL '1 hour'
    ) THEN 'BSE scraped recently'
    ELSE 'BSE not in recent scrape'
  END as bse_scrape_status
FROM dual_listed dl
ORDER BY dl.company_name;

-- -----------------------------------------------------------------------------
-- 5. Field-Level Conflict Detection
-- -----------------------------------------------------------------------------
-- Description: Identifies fields that might have conflicting data from different sources
-- Note: This is a heuristic check - actual conflict resolution happens in code
-- Expected: Helps identify suspicious data patterns
-- -----------------------------------------------------------------------------
SELECT
  i.id,
  i.company_name,
  i.listing_exchanges,
  i.issue_size,
  i.lot_size,
  i.sector,
  ARRAY_REMOVE(ARRAY[
    -- Check if critical fields are missing despite dual listing
    CASE WHEN i.issue_size IS NULL THEN 'issue_size missing' END,
    CASE WHEN i.lot_size IS NULL THEN 'lot_size missing' END,
    CASE WHEN i.sector IS NULL THEN 'sector missing' END,
    CASE WHEN i.open_date IS NULL THEN 'open_date missing' END,
    CASE WHEN i.close_date IS NULL THEN 'close_date missing' END
  ], NULL) as potential_conflict_indicators
FROM ipos i
WHERE i.listing_exchanges @> '["NSE"]'::jsonb
  AND i.listing_exchanges @> '["BSE"]'::jsonb
  AND (
    i.issue_size IS NULL
    OR i.lot_size IS NULL
    OR i.sector IS NULL
    OR i.open_date IS NULL
    OR i.close_date IS NULL
  )
ORDER BY i.company_name;

-- -----------------------------------------------------------------------------
-- 6. Data Freshness Check
-- -----------------------------------------------------------------------------
-- Description: Checks how recently each IPO was updated
-- Purpose: Identify stale data that might indicate scraper issues
-- Expected: Most IPOs should be updated within last 24 hours
-- -----------------------------------------------------------------------------
SELECT
  id,
  company_name,
  status,
  category,
  listing_exchanges,
  last_scraped_at,
  updated_at,
  CASE
    WHEN last_scraped_at IS NULL THEN 'Never scraped'
    WHEN last_scraped_at > NOW() - INTERVAL '1 hour' THEN 'Very fresh (< 1h)'
    WHEN last_scraped_at > NOW() - INTERVAL '6 hours' THEN 'Fresh (< 6h)'
    WHEN last_scraped_at > NOW() - INTERVAL '24 hours' THEN 'Recent (< 24h)'
    WHEN last_scraped_at > NOW() - INTERVAL '7 days' THEN 'Stale (< 7 days)'
    ELSE 'Very stale (> 7 days)'
  END as data_freshness,
  CASE
    WHEN listing_exchanges @> '["NSE"]'::jsonb AND listing_exchanges @> '["BSE"]'::jsonb THEN 'Dual-listed'
    WHEN listing_exchanges @> '["NSE"]'::jsonb THEN 'NSE only'
    WHEN listing_exchanges @> '["BSE"]'::jsonb THEN 'BSE only'
    ELSE 'Other'
  END as listing_type
FROM ipos
WHERE status IN ('OPEN', 'UPCOMING', 'CLOSED')
ORDER BY last_scraped_at DESC NULLS LAST;

-- -----------------------------------------------------------------------------
-- 7. Scraper Priority Verification Test Cases
-- -----------------------------------------------------------------------------
-- Description: Manual test cases for verifying conflict resolution
-- Purpose: Document specific IPOs to manually verify conflict resolution
-- Expected: Use these cases for detailed manual verification
-- -----------------------------------------------------------------------------

-- Test Case 1: Find dual-listed IPOs with recent scraper activity
WITH test_cases AS (
  SELECT
    i.id,
    i.company_name,
    i.listing_exchanges,
    i.issue_size,
    i.lot_size,
    i.sector,
    i.last_scraped_at,
    (SELECT created_at FROM scraper_logs WHERE source = 'NSE' AND status = 'SUCCESS' ORDER BY created_at DESC LIMIT 1) as nse_last_run,
    (SELECT created_at FROM scraper_logs WHERE source = 'BSE' AND status = 'SUCCESS' ORDER BY created_at DESC LIMIT 1) as bse_last_run
  FROM ipos i
  WHERE i.listing_exchanges @> '["NSE"]'::jsonb
    AND i.listing_exchanges @> '["BSE"]'::jsonb
    AND i.last_scraped_at > NOW() - INTERVAL '24 hours'
)
SELECT
  id,
  company_name,
  listing_exchanges,
  issue_size,
  lot_size,
  sector,
  last_scraped_at,
  nse_last_run,
  bse_last_run,
  CASE
    WHEN nse_last_run > bse_last_run THEN 'NSE ran after BSE (NSE data should win)'
    WHEN bse_last_run > nse_last_run THEN 'BSE ran after NSE (NSE data should still win due to priority)'
    ELSE 'Cannot determine order'
  END as expected_winner,
  CASE
    WHEN issue_size IS NOT NULL AND lot_size IS NOT NULL AND sector IS NOT NULL THEN '✓ All key fields populated'
    ELSE '⚠ Some key fields missing'
  END as data_completeness
FROM test_cases
ORDER BY last_scraped_at DESC
LIMIT 10;

-- -----------------------------------------------------------------------------
-- 8. Moneycontrol Data Supplementation Check
-- -----------------------------------------------------------------------------
-- Description: Verifies Moneycontrol data (lower priority) supplements NSE/BSE data
-- Expected: Sector and descriptions should be present from Moneycontrol
--           but shouldn't overwrite NSE/BSE core fields
-- -----------------------------------------------------------------------------
SELECT
  i.id,
  i.company_name,
  i.category,
  i.listing_exchanges,
  i.sector,
  LENGTH(i.company_description) as description_length,
  i.rating,
  i.issue_size,
  i.lot_size,
  CASE
    WHEN i.sector IS NOT NULL AND i.company_description IS NOT NULL THEN '✓ Moneycontrol data present'
    WHEN i.sector IS NULL OR i.company_description IS NULL THEN '⚠ Moneycontrol data missing'
    ELSE 'Unknown'
  END as moneycontrol_status,
  CASE
    WHEN i.issue_size IS NOT NULL AND i.lot_size IS NOT NULL THEN '✓ NSE/BSE core data intact'
    ELSE '✗ NSE/BSE core data missing'
  END as core_data_status
FROM ipos i
WHERE i.status IN ('OPEN', 'UPCOMING', 'CLOSED', 'LISTED')
  AND i.last_scraped_at > NOW() - INTERVAL '24 hours'
ORDER BY i.company_name
LIMIT 20;

-- -----------------------------------------------------------------------------
-- 9. GMP Data Priority Check (Chittorgarh)
-- -----------------------------------------------------------------------------
-- Description: Verifies GMP data from Chittorgarh is added without affecting core data
-- Expected: GMP fields populated, core fields unchanged
-- -----------------------------------------------------------------------------
SELECT
  i.id,
  i.company_name,
  i.status,
  i.gmp_price,
  i.gmp_percentage_historical,
  COUNT(g.id) as gmp_record_count,
  MAX(g.timestamp) as latest_gmp_timestamp,
  i.issue_size,
  i.lot_size,
  i.sector,
  CASE
    WHEN i.gmp_price IS NOT NULL AND COUNT(g.id) > 0 THEN '✓ GMP data present'
    WHEN i.status IN ('OPEN', 'CLOSED', 'LISTED') THEN '⚠ GMP data missing for active IPO'
    ELSE 'N/A (UPCOMING IPO)'
  END as gmp_status,
  CASE
    WHEN i.issue_size IS NOT NULL AND i.lot_size IS NOT NULL THEN '✓ Core data intact'
    ELSE '✗ Core data missing'
  END as core_data_status
FROM ipos i
LEFT JOIN gmp_records g ON g.ipo_id = i.id
WHERE i.last_scraped_at > NOW() - INTERVAL '24 hours'
GROUP BY i.id, i.company_name, i.status, i.gmp_price, i.gmp_percentage_historical, i.issue_size, i.lot_size, i.sector
ORDER BY i.status, i.company_name
LIMIT 20;

-- -----------------------------------------------------------------------------
-- 10. Conflict Resolution Integrity Check
-- -----------------------------------------------------------------------------
-- Description: Verifies no data was lost during conflict resolution
-- Expected: All dual-listed IPOs should have complete data from highest priority source
-- -----------------------------------------------------------------------------
WITH conflict_check AS (
  SELECT
    i.id,
    i.company_name,
    i.listing_exchanges,
    CASE
      WHEN i.listing_exchanges @> '["NSE"]'::jsonb AND i.listing_exchanges @> '["BSE"]'::jsonb THEN 'DUAL'
      WHEN i.listing_exchanges @> '["NSE"]'::jsonb THEN 'NSE_ONLY'
      WHEN i.listing_exchanges @> '["BSE"]'::jsonb THEN 'BSE_ONLY'
      ELSE 'OTHER'
    END as listing_type,
    CASE
      WHEN i.open_date IS NULL THEN 0 ELSE 1 END +
      CASE WHEN i.close_date IS NULL THEN 0 ELSE 1 END +
      CASE WHEN i.issue_size IS NULL THEN 0 ELSE 1 END +
      CASE WHEN i.lot_size IS NULL THEN 0 ELSE 1 END +
      CASE WHEN i.price_range_min IS NULL THEN 0 ELSE 1 END +
      CASE WHEN i.price_range_max IS NULL THEN 0 ELSE 1 END +
      CASE WHEN i.sector IS NULL THEN 0 ELSE 1 END +
      CASE WHEN i.listing_exchanges IS NULL THEN 0 ELSE 1 END
    as field_completeness_score,
    i.last_scraped_at
  FROM ipos i
  WHERE i.status IN ('OPEN', 'UPCOMING', 'CLOSED', 'LISTED')
)
SELECT
  listing_type,
  COUNT(*) as ipo_count,
  ROUND(AVG(field_completeness_score), 2) as avg_completeness_score,
  MIN(field_completeness_score) as min_completeness_score,
  MAX(field_completeness_score) as max_completeness_score,
  CASE
    WHEN AVG(field_completeness_score) >= 7 THEN '✓ Excellent'
    WHEN AVG(field_completeness_score) >= 5 THEN '⚠ Good'
    WHEN AVG(field_completeness_score) >= 3 THEN '⚠ Fair'
    ELSE '✗ Poor'
  END as data_quality
FROM conflict_check
GROUP BY listing_type
ORDER BY listing_type;

-- -----------------------------------------------------------------------------
-- SUMMARY: Conflict Resolution Health Check
-- -----------------------------------------------------------------------------
WITH dual_listed_count AS (
  SELECT COUNT(*) as count
  FROM ipos
  WHERE listing_exchanges @> '["NSE"]'::jsonb
    AND listing_exchanges @> '["BSE"]'::jsonb
),
recent_scraper_runs AS (
  SELECT source, MAX(created_at) as last_run
  FROM scraper_logs
  WHERE status = 'SUCCESS'
    AND created_at > NOW() - INTERVAL '24 hours'
  GROUP BY source
),
data_quality AS (
  SELECT
    COUNT(*) FILTER (WHERE issue_size IS NOT NULL) as with_issue_size,
    COUNT(*) FILTER (WHERE lot_size IS NOT NULL) as with_lot_size,
    COUNT(*) FILTER (WHERE sector IS NOT NULL) as with_sector,
    COUNT(*) as total
  FROM ipos
  WHERE listing_exchanges @> '["NSE"]'::jsonb
    AND listing_exchanges @> '["BSE"]'::jsonb
)
SELECT
  (SELECT count FROM dual_listed_count) as total_dual_listed_ipos,
  (SELECT COUNT(*) FROM recent_scraper_runs) as scrapers_ran_recently,
  (SELECT string_agg(source || ' (' || last_run::date || ')', ', ') FROM recent_scraper_runs) as recent_scrapers,
  ROUND(100.0 * (SELECT with_issue_size FROM data_quality) / NULLIF((SELECT total FROM data_quality), 0), 2) as dual_listed_issue_size_pct,
  ROUND(100.0 * (SELECT with_lot_size FROM data_quality) / NULLIF((SELECT total FROM data_quality), 0), 2) as dual_listed_lot_size_pct,
  ROUND(100.0 * (SELECT with_sector FROM data_quality) / NULLIF((SELECT total FROM data_quality), 0), 2) as dual_listed_sector_pct,
  CASE
    WHEN (SELECT COUNT(*) FROM recent_scraper_runs WHERE source IN ('NSE', 'BSE')) >= 2
      AND ROUND(100.0 * (SELECT with_issue_size FROM data_quality) / NULLIF((SELECT total FROM data_quality), 0), 2) >= 90
    THEN '✓ Conflict resolution appears healthy'
    ELSE '⚠ Review conflict resolution logic'
  END as health_status;

-- =============================================================================
-- END OF CONFLICT RESOLUTION VERIFICATION QUERIES
-- =============================================================================
