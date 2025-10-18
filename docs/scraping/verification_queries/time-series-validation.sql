-- =============================================================================
-- TIME-SERIES DATA VALIDATION (Section 3.7)
-- =============================================================================
-- Purpose: Validate time-series data integrity for subscriptions and GMP records
-- Expected: No duplicates, no future timestamps, proper ordering, no gaps
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SUBSCRIPTIONS TABLE VALIDATION
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 1. Duplicate Subscription Timestamps
-- -----------------------------------------------------------------------------
-- Description: Finds duplicate subscription records for same IPO at same timestamp
-- Expected: 0 rows (each timestamp should be unique per IPO)
-- Severity: HIGH - indicates data duplication
-- -----------------------------------------------------------------------------
SELECT
  s.ipo_id,
  i.company_name,
  s.timestamp,
  COUNT(*) as duplicate_count,
  array_agg(s.id) as subscription_ids,
  array_agg(s.total_subscription) as total_subscription_values
FROM subscriptions s
JOIN ipos i ON i.id = s.ipo_id
GROUP BY s.ipo_id, i.company_name, s.timestamp
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, i.company_name, s.timestamp;

-- -----------------------------------------------------------------------------
-- 2. Future Timestamps in Subscriptions
-- -----------------------------------------------------------------------------
-- Description: Finds subscription records with timestamps in the future
-- Expected: 0 rows
-- Severity: HIGH - indicates data error or system clock issue
-- -----------------------------------------------------------------------------
SELECT
  s.id,
  i.company_name,
  i.status,
  s.timestamp,
  NOW() as current_time,
  s.timestamp - NOW() as time_difference,
  s.total_subscription,
  s.qib_subscription,
  s.nii_subscription,
  s.retail_subscription
FROM subscriptions s
JOIN ipos i ON s.ipo_id = i.id
WHERE s.timestamp > NOW()
ORDER BY s.timestamp DESC;

-- -----------------------------------------------------------------------------
-- 3. Subscriptions Before IPO Open Date
-- -----------------------------------------------------------------------------
-- Description: Finds subscription records with timestamps before IPO opening
-- Expected: 0 rows
-- Severity: HIGH - subscription cannot exist before IPO opens
-- -----------------------------------------------------------------------------
SELECT
  s.id,
  i.company_name,
  i.open_date,
  s.timestamp,
  s.timestamp::date - i.open_date as days_before_opening,
  s.total_subscription
FROM subscriptions s
JOIN ipos i ON s.ipo_id = i.id
WHERE i.open_date IS NOT NULL
  AND s.timestamp < i.open_date
ORDER BY i.company_name, s.timestamp;

-- -----------------------------------------------------------------------------
-- 4. Subscriptions After IPO Close Date
-- -----------------------------------------------------------------------------
-- Description: Finds subscription records after IPO has closed
-- Expected: Few rows (grace period of 1 day is acceptable for final tallies)
-- Severity: MEDIUM - acceptable within 24 hours of close, else suspicious
-- -----------------------------------------------------------------------------
SELECT
  s.id,
  i.company_name,
  i.close_date,
  s.timestamp,
  s.timestamp::date - i.close_date as days_after_closing,
  s.total_subscription,
  CASE
    WHEN s.timestamp::date - i.close_date <= 1 THEN 'Acceptable (final tally)'
    ELSE 'Suspicious (too late)'
  END as validity
FROM subscriptions s
JOIN ipos i ON s.ipo_id = i.id
WHERE i.close_date IS NOT NULL
  AND s.timestamp > i.close_date + INTERVAL '1 day'
ORDER BY days_after_closing DESC;

-- -----------------------------------------------------------------------------
-- 5. Time-Series Ordering Verification
-- -----------------------------------------------------------------------------
-- Description: Verifies subscriptions are in chronological order per IPO
-- Expected: All sequences should be properly ordered
-- -----------------------------------------------------------------------------
WITH subscription_sequences AS (
  SELECT
    ipo_id,
    array_agg(timestamp ORDER BY timestamp) as timestamps,
    COUNT(*) as record_count,
    MIN(timestamp) as first_record,
    MAX(timestamp) as latest_record,
    MAX(timestamp) - MIN(timestamp) as time_span
  FROM subscriptions
  GROUP BY ipo_id
)
SELECT
  ss.ipo_id,
  i.company_name,
  i.status,
  i.open_date,
  i.close_date,
  ss.record_count,
  ss.first_record,
  ss.latest_record,
  ss.time_span,
  CASE
    WHEN ss.record_count = 0 THEN 'No data'
    WHEN ss.record_count = 1 THEN 'Single record (not time-series)'
    WHEN ss.record_count < 5 THEN 'Sparse data (< 5 records)'
    WHEN ss.time_span < INTERVAL '1 day' THEN 'Compressed timeline (< 1 day)'
    ELSE 'Normal time-series'
  END as series_quality
FROM subscription_sequences ss
JOIN ipos i ON i.id = ss.ipo_id
WHERE i.status IN ('OPEN', 'CLOSED', 'LISTED')
ORDER BY ss.record_count DESC, i.company_name;

-- -----------------------------------------------------------------------------
-- 6. Subscription Time Gaps Detection
-- -----------------------------------------------------------------------------
-- Description: Finds large gaps between subscription updates
-- Expected: For OPEN IPOs, gaps should be < 24 hours
-- Severity: MEDIUM - indicates scraper may have missed updates
-- -----------------------------------------------------------------------------
WITH subscription_gaps AS (
  SELECT
    s1.ipo_id,
    s1.timestamp as timestamp1,
    s2.timestamp as timestamp2,
    s2.timestamp - s1.timestamp as gap_duration,
    s1.total_subscription as subscription1,
    s2.total_subscription as subscription2
  FROM subscriptions s1
  JOIN subscriptions s2 ON s1.ipo_id = s2.ipo_id
  WHERE s2.timestamp > s1.timestamp
    AND NOT EXISTS (
      SELECT 1 FROM subscriptions s3
      WHERE s3.ipo_id = s1.ipo_id
        AND s3.timestamp > s1.timestamp
        AND s3.timestamp < s2.timestamp
    )
)
SELECT
  sg.ipo_id,
  i.company_name,
  i.status,
  sg.timestamp1,
  sg.timestamp2,
  sg.gap_duration,
  EXTRACT(EPOCH FROM sg.gap_duration) / 3600 as gap_hours,
  sg.subscription1,
  sg.subscription2,
  CASE
    WHEN sg.gap_duration > INTERVAL '24 hours' AND i.status = 'OPEN' THEN '⚠ Large gap for OPEN IPO'
    WHEN sg.gap_duration > INTERVAL '48 hours' THEN '⚠ Very large gap'
    ELSE 'Acceptable'
  END as gap_severity
FROM subscription_gaps sg
JOIN ipos i ON i.id = sg.ipo_id
WHERE sg.gap_duration > INTERVAL '12 hours'
ORDER BY sg.gap_duration DESC
LIMIT 50;

-- -----------------------------------------------------------------------------
-- 7. Subscription Data Completeness Check
-- -----------------------------------------------------------------------------
-- Description: Verifies all subscription record fields are populated
-- Expected: All fields should be non-null for valid records
-- -----------------------------------------------------------------------------
SELECT
  s.id,
  i.company_name,
  s.timestamp,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN s.qib_subscription IS NULL THEN 'qib_subscription' END,
    CASE WHEN s.nii_subscription IS NULL THEN 'nii_subscription' END,
    CASE WHEN s.retail_subscription IS NULL THEN 'retail_subscription' END,
    CASE WHEN s.total_subscription IS NULL THEN 'total_subscription' END,
    CASE WHEN s.total_applications IS NULL THEN 'total_applications' END,
    CASE WHEN s.shares_bid IS NULL THEN 'shares_bid' END
  ], NULL) as null_fields
FROM subscriptions s
JOIN ipos i ON i.id = s.ipo_id
WHERE s.qib_subscription IS NULL
   OR s.nii_subscription IS NULL
   OR s.retail_subscription IS NULL
   OR s.total_subscription IS NULL
ORDER BY i.company_name, s.timestamp;

-- -----------------------------------------------------------------------------
-- GMP_RECORDS TABLE VALIDATION
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 8. Duplicate GMP Timestamps
-- -----------------------------------------------------------------------------
-- Description: Finds duplicate GMP records for same IPO at same timestamp
-- Expected: 0 rows
-- Severity: HIGH - indicates data duplication
-- -----------------------------------------------------------------------------
SELECT
  g.ipo_id,
  i.company_name,
  g.timestamp,
  COUNT(*) as duplicate_count,
  array_agg(g.id) as gmp_record_ids,
  array_agg(g.price) as gmp_prices,
  array_agg(g.percentage) as gmp_percentages
FROM gmp_records g
JOIN ipos i ON i.id = g.ipo_id
GROUP BY g.ipo_id, i.company_name, g.timestamp
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, i.company_name, g.timestamp;

-- -----------------------------------------------------------------------------
-- 9. Future Timestamps in GMP Records
-- -----------------------------------------------------------------------------
-- Description: Finds GMP records with timestamps in the future
-- Expected: 0 rows
-- Severity: HIGH - indicates data error
-- -----------------------------------------------------------------------------
SELECT
  g.id,
  i.company_name,
  i.status,
  g.timestamp,
  NOW() as current_time,
  g.timestamp - NOW() as time_difference,
  g.price as gmp_price,
  g.percentage as gmp_percentage
FROM gmp_records g
JOIN ipos i ON g.ipo_id = i.id
WHERE g.timestamp > NOW()
ORDER BY g.timestamp DESC;

-- -----------------------------------------------------------------------------
-- 10. GMP Records Before IPO Open Date
-- -----------------------------------------------------------------------------
-- Description: Finds GMP records before IPO opening
-- Expected: Some rows acceptable (pre-listing GMP can exist before opening)
-- Note: This is informational, not necessarily an error
-- -----------------------------------------------------------------------------
SELECT
  g.id,
  i.company_name,
  i.open_date,
  g.timestamp,
  g.timestamp::date - i.open_date as days_before_opening,
  g.price as gmp_price,
  g.percentage as gmp_percentage,
  CASE
    WHEN g.timestamp::date - i.open_date > -30 THEN 'Acceptable (pre-listing GMP)'
    ELSE 'Suspicious (too early)'
  END as validity
FROM gmp_records g
JOIN ipos i ON g.ipo_id = i.id
WHERE i.open_date IS NOT NULL
  AND g.timestamp < i.open_date
ORDER BY days_before_opening;

-- -----------------------------------------------------------------------------
-- 11. GMP Time-Series Ordering Verification
-- -----------------------------------------------------------------------------
-- Description: Verifies GMP records are in chronological order per IPO
-- Expected: Proper time-series progression
-- -----------------------------------------------------------------------------
WITH gmp_sequences AS (
  SELECT
    ipo_id,
    array_agg(timestamp ORDER BY timestamp) as timestamps,
    COUNT(*) as record_count,
    MIN(timestamp) as first_record,
    MAX(timestamp) as latest_record,
    MAX(timestamp) - MIN(timestamp) as time_span
  FROM gmp_records
  GROUP BY ipo_id
)
SELECT
  gs.ipo_id,
  i.company_name,
  i.status,
  gs.record_count,
  gs.first_record,
  gs.latest_record,
  gs.time_span,
  CASE
    WHEN gs.record_count = 0 THEN 'No GMP data'
    WHEN gs.record_count = 1 THEN 'Single GMP record (not time-series)'
    WHEN gs.record_count < 3 THEN 'Minimal GMP data (< 3 records)'
    WHEN gs.time_span < INTERVAL '1 day' THEN 'Short GMP timeline (< 1 day)'
    WHEN gs.latest_record < NOW() - INTERVAL '7 days' AND i.status = 'OPEN' THEN 'Stale GMP data (> 7 days old for OPEN IPO)'
    ELSE 'Normal GMP time-series'
  END as gmp_quality
FROM gmp_sequences gs
JOIN ipos i ON i.id = gs.ipo_id
WHERE i.status IN ('OPEN', 'CLOSED', 'LISTED')
ORDER BY gs.record_count DESC, i.company_name;

-- -----------------------------------------------------------------------------
-- 12. GMP Data Freshness Check
-- -----------------------------------------------------------------------------
-- Description: Identifies IPOs with stale GMP data
-- Expected: OPEN IPOs should have recent GMP data (< 24 hours)
-- -----------------------------------------------------------------------------
SELECT
  i.id,
  i.company_name,
  i.status,
  i.open_date,
  i.close_date,
  COUNT(g.id) as gmp_record_count,
  MAX(g.timestamp) as latest_gmp_timestamp,
  NOW() - MAX(g.timestamp) as time_since_last_gmp,
  CASE
    WHEN MAX(g.timestamp) IS NULL THEN '✗ No GMP data'
    WHEN NOW() - MAX(g.timestamp) < INTERVAL '24 hours' THEN '✓ Fresh (< 24h)'
    WHEN NOW() - MAX(g.timestamp) < INTERVAL '7 days' THEN '⚠ Stale (< 7 days)'
    ELSE '✗ Very stale (> 7 days)'
  END as freshness_status
FROM ipos i
LEFT JOIN gmp_records g ON g.ipo_id = i.id
WHERE i.status IN ('OPEN', 'CLOSED', 'LISTED')
GROUP BY i.id, i.company_name, i.status, i.open_date, i.close_date
ORDER BY
  CASE i.status
    WHEN 'OPEN' THEN 1
    WHEN 'CLOSED' THEN 2
    WHEN 'LISTED' THEN 3
  END,
  latest_gmp_timestamp DESC NULLS LAST;

-- -----------------------------------------------------------------------------
-- 13. Negative or Zero GMP Values
-- -----------------------------------------------------------------------------
-- Description: Finds GMP records with invalid values
-- Expected: GMP percentage can be negative (realistic), but price should be reasonable
-- Note: Very extreme values (< -100% or > 500%) are suspicious
-- -----------------------------------------------------------------------------
SELECT
  g.id,
  i.company_name,
  i.status,
  g.timestamp,
  g.price as gmp_price,
  g.percentage as gmp_percentage,
  CASE
    WHEN g.percentage < -100 THEN 'Suspicious (GMP < -100%)'
    WHEN g.percentage > 500 THEN 'Suspicious (GMP > 500%)'
    WHEN g.price < 0 THEN 'Invalid (negative price)'
    ELSE 'Acceptable range'
  END as validation_status
FROM gmp_records g
JOIN ipos i ON g.ipo_id = i.id
WHERE g.percentage < -100
   OR g.percentage > 500
   OR g.price < 0
ORDER BY g.percentage DESC;

-- -----------------------------------------------------------------------------
-- SUMMARY: Time-Series Data Quality Report
-- -----------------------------------------------------------------------------
WITH subscription_summary AS (
  SELECT
    COUNT(DISTINCT ipo_id) as ipos_with_subscriptions,
    COUNT(*) as total_subscription_records,
    AVG(record_count) as avg_records_per_ipo
  FROM (
    SELECT ipo_id, COUNT(*) as record_count
    FROM subscriptions
    GROUP BY ipo_id
  ) sub
),
gmp_summary AS (
  SELECT
    COUNT(DISTINCT ipo_id) as ipos_with_gmp,
    COUNT(*) as total_gmp_records,
    AVG(record_count) as avg_records_per_ipo
  FROM (
    SELECT ipo_id, COUNT(*) as record_count
    FROM gmp_records
    GROUP BY ipo_id
  ) gmp
),
duplicate_check AS (
  SELECT
    (SELECT COUNT(*) FROM (
      SELECT ipo_id, timestamp, COUNT(*) FROM subscriptions GROUP BY ipo_id, timestamp HAVING COUNT(*) > 1
    ) dup_subs) as subscription_duplicates,
    (SELECT COUNT(*) FROM (
      SELECT ipo_id, timestamp, COUNT(*) FROM gmp_records GROUP BY ipo_id, timestamp HAVING COUNT(*) > 1
    ) dup_gmp) as gmp_duplicates
),
future_timestamp_check AS (
  SELECT
    (SELECT COUNT(*) FROM subscriptions WHERE timestamp > NOW()) as future_subscriptions,
    (SELECT COUNT(*) FROM gmp_records WHERE timestamp > NOW()) as future_gmp
)
SELECT
  (SELECT ipos_with_subscriptions FROM subscription_summary) as ipos_with_subscriptions,
  (SELECT total_subscription_records FROM subscription_summary) as total_subscription_records,
  ROUND((SELECT avg_records_per_ipo FROM subscription_summary), 2) as avg_subscription_records_per_ipo,

  (SELECT ipos_with_gmp FROM gmp_summary) as ipos_with_gmp,
  (SELECT total_gmp_records FROM gmp_summary) as total_gmp_records,
  ROUND((SELECT avg_records_per_ipo FROM gmp_summary), 2) as avg_gmp_records_per_ipo,

  (SELECT subscription_duplicates FROM duplicate_check) as subscription_duplicate_timestamps,
  (SELECT gmp_duplicates FROM duplicate_check) as gmp_duplicate_timestamps,

  (SELECT future_subscriptions FROM future_timestamp_check) as future_subscription_records,
  (SELECT future_gmp FROM future_timestamp_check) as future_gmp_records,

  CASE
    WHEN (SELECT subscription_duplicates FROM duplicate_check) = 0
      AND (SELECT gmp_duplicates FROM duplicate_check) = 0
      AND (SELECT future_subscriptions FROM future_timestamp_check) = 0
      AND (SELECT future_gmp FROM future_timestamp_check) = 0
    THEN '✓ Time-series data is clean'
    ELSE '⚠ Time-series data has issues - review above queries'
  END as overall_status;

-- =============================================================================
-- END OF TIME-SERIES VALIDATION QUERIES
-- =============================================================================
