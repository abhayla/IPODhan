# Appendix B: SQL Queries Reference

**[← Back to Index](README.md)**

---

## Overview

This appendix contains all 36 SQL queries extracted from the comprehensive testing plan. These queries are organized by testing phase and can be used for:

- Data validation during testing
- Database health checks
- Coverage analysis
- Performance monitoring
- Production data integrity verification

**⚠️ IMPORTANT**: All queries should be executed against the VPS production database at `103.118.16.189:5432/ipodhan` unless explicitly noted otherwise.

---

## Quick Index

- [Schema Verification (3 queries)](#schema-verification)
- [Scraper Health & Monitoring (2 queries)](#scraper-health-monitoring)
- [Field Coverage Analysis (15 queries)](#field-coverage-analysis)
- [GMP & Subscription Queries (8 queries)](#gmp-subscription-queries)
- [Historical Data Validation (2 queries)](#historical-data-validation)
- [Scoring & Peer Comparison (3 queries)](#scoring-peer-comparison)
- [Repository Pattern Validation (1 queries)](#repository-pattern-validation)
- [Safety & Approval (2 queries)](#safety-approval)

---

## Schema Verification

**Total Queries**: 3

### Query 1: Verify Indexes and Foreign Keys

**Source**: TESTING_PLAN.md (lines 620-625)

**Context**:
**Verify indexes and foreign keys:**

```sql
-- Run against VPS database
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

---

### Query 2: Performance Comparison Queries

**Source**: TESTING_PLAN.md (lines 2209-2251)

**Context**:
**SQL Queries for Performance Comparison:**

```sql
-- Measure query performance WITHOUT cache (Redis down)
EXPLAIN ANALYZE
SELECT
    ipos.*,
    fd.revenue,
    fd.profit,
    lp.listing_price
FROM ipos
LEFT JOIN financial_data fd ON ipos.id = fd.ipo_id
LEFT JOIN listing_performance lp ON ipos.id = lp.ipo_id
WHERE ipos.slug = 'xyz-company-ipo';

-- Expected execution time without cache: 80-150ms
-- Expected execution time with cache HIT: 5-20ms

-- Check if indexes are being used (critical when cache is down)
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE tablename IN ('ipos', 'subscriptions', 'gmp_records')
ORDER BY idx_scan DESC;

-- Verify indexes exist for common queries
SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN ('ipos', 'subscriptions', 'gmp_records')
ORDER BY tablename, indexname;

-- Expected indexes:
-- ipos_slug_idx (slug) → For findBySlug queries
-- ipos_status_category_idx (status, category) → For filtered lists
-- subscriptions_ipo_id_idx (ipo_id) → For subscription lookups
-- gmp_records_ipo_id_idx (ipo_id) → For GMP lookups
```

---

### Query 3: Schema Validation

**Source**: TESTING_PLAN.md (lines 3411-3418)

**Context**:
**Schema Check:**

```sql
-- Verify categories in schema
SELECT DISTINCT category FROM ipos;
-- Should include: MAINBOARD, SME, RIGHTS, NCD, FPO

-- Check if OFS is missing from schema
-- If so, add to packages/shared/src/db/schema.ts
-- Follow migration workflow: db:generate → review SQL → db:migrate
```

---

## Scraper Health & Monitoring

**Total Queries**: 2

### Query 1: Scraper Health Monitoring

**Source**: TESTING_PLAN.md (lines 638-655)

**Context**:
**3. ✅ ENHANCEMENT #1: Scraper Health Monitoring**

```sql
-- Check scraper_logs for SUCCESS status
SELECT source, status, records_processed, records_failed, duration_ms, error_message
FROM scraper_logs
ORDER BY created_at DESC
LIMIT 50;

-- Check pipeline_status health
SELECT source, pipeline_type, status, last_success_at, consecutive_failures,
       records_processed, execution_time_ms
FROM pipeline_status
ORDER BY last_run_at DESC;

-- Flag stale data (>48 hours)
SELECT source, last_success_at,
       EXTRACT(EPOCH FROM (NOW() - last_success_at))/3600 as hours_since_success
FROM pipeline_status
WHERE last_success_at < NOW() - INTERVAL '48 hours';
```

---

### Query 2: Data Population Verification

**Source**: TESTING_PLAN.md (lines 854-867)

**Context**:
**7. Data Population Verification**

```sql
-- Count all tables
SELECT 'ipos' as table, COUNT(*) as count FROM ipos
UNION ALL SELECT 'ipo_details', COUNT(*) FROM ipo_details
UNION ALL SELECT 'ipo_financials', COUNT(*) FROM ipo_financials
UNION ALL SELECT 'ipo_reviews', COUNT(*) FROM ipo_reviews
UNION ALL SELECT 'market_holidays', COUNT(*) FROM market_holidays
UNION ALL SELECT 'documents', COUNT(*) FROM documents
UNION ALL SELECT 'listing_performance', COUNT(*) FROM listing_performance
UNION ALL SELECT 'gmp_tracking', COUNT(*) FROM gmp_tracking
UNION ALL SELECT 'subscriptions', COUNT(*) FROM subscriptions
UNION ALL SELECT 'peer_companies', COUNT(*) FROM peer_companies
UNION ALL SELECT 'registrars', COUNT(*) FROM registrars
UNION ALL SELECT 'scraper_logs', COUNT(*) FROM scraper_logs;
```

---

## Field Coverage Analysis

**Total Queries**: 15

### Query 1: Best Practices for Production Testing

**Source**: TESTING_PLAN.md (lines 174-178)

**Context**:
### Best Practices for Production Testing

```sql
BEGIN;
   -- Your approved mutation
   -- Verify result
   ROLLBACK;  -- Test with rollback first, then commit only if explicitly approved
```

---

### Query 2: Fuzzy Matching Quality Tests

**Source**: TESTING_PLAN.md (lines 684-700)

**Context**:
**4. ✅ ENHANCEMENT #2: Fuzzy Matching Quality Tests**

```sql
-- Check unmatched reviews
SELECT review_title, author, category
FROM ipo_reviews
WHERE ipo_id IS NULL;

-- Check unmatched documents
SELECT title, exchange, type
FROM documents
WHERE ipo_id IS NULL;

-- Match rate calculation
SELECT
  (SELECT COUNT(*) FROM ipo_reviews WHERE ipo_id IS NOT NULL) * 100.0 /
  (SELECT COUNT(*) FROM ipo_reviews) as review_match_rate,
  (SELECT COUNT(*) FROM documents WHERE ipo_id IS NOT NULL) * 100.0 /
  (SELECT COUNT(*) FROM documents) as document_match_rate;
```

---

### Query 3: Verify no duplicates

**Source**: TESTING_PLAN.md (lines 787-817)

**Context**:
# Verify no duplicates

```sql
-- Check for duplicate IPOs
SELECT slug, COUNT(*)
FROM ipos
GROUP BY slug
HAVING COUNT(*) > 1;

-- Check for duplicate reviews
SELECT ipo_id, review_title, COUNT(*)
FROM ipo_reviews
GROUP BY ipo_id, review_title
HAVING COUNT(*) > 1;

-- Check for duplicate documents
SELECT url, COUNT(*)
FROM documents
GROUP BY url
HAVING COUNT(*) > 1;

-- Check for duplicate market holidays
SELECT date, exchange, description, COUNT(*)
FROM market_holidays
GROUP BY date, exchange, description
HAVING COUNT(*) > 1;

-- Verify updated_at timestamps changed
SELECT id, company_name, updated_at
FROM ipos
WHERE id = 'sample-ipo-id';
-- Run scraper
-- Re-query and compare updated_at
```

---

### Query 4: Field Coverage Analysis

**Source**: TESTING_PLAN.md (lines 878-895)

**Context**:
**8. Field Coverage Analysis**

```sql
-- Example for ipos table (31 fields)
SELECT
  'companyName' as field,
  COUNT(*) as total,
  COUNT(company_name) as populated,
  ROUND(100.0 * COUNT(company_name) / COUNT(*), 2) as coverage_percent
FROM ipos
UNION ALL
SELECT 'issueSize', COUNT(*), COUNT(issue_size),
  ROUND(100.0 * COUNT(issue_size) / COUNT(*), 2)
FROM ipos
UNION ALL
SELECT 'sector', COUNT(*), COUNT(sector),
  ROUND(100.0 * COUNT(sector) / COUNT(*), 2)
FROM ipos
-- ... repeat for all 31 fields
ORDER BY coverage_percent ASC;
```

---

### Query 5: IPO Details Validation

**Source**: TESTING_PLAN.md (lines 1351-1422)

**Context**:
**Success Criteria:**

```sql
-- Verify ipo_details table exists
SELECT COUNT(*) FROM ipo_details;

-- Check all IPOs have details
SELECT
  i.company_name,
  CASE WHEN d.id IS NULL THEN '❌ MISSING' ELSE '✅ HAS DETAILS' END as details_status
FROM ipos i
LEFT JOIN ipo_details d ON i.id = d.ipo_id
WHERE i.status IN ('OPEN', 'UPCOMING', 'CLOSED')
ORDER BY details_status DESC;

-- Validate issueType field
SELECT
  issue_type,
  COUNT(*) as count
FROM ipo_details
GROUP BY issue_type
ORDER BY count DESC;
-- Should include: FRESH, OFS, COMBINATION

-- Verify freshIssue + ofsIssue = issue_size
SELECT
  i.company_name,
  i.issue_size,
  d.fresh_issue,
  d.ofs_issue,
  (d.fresh_issue + d.ofs_issue) as calculated_total,
  CASE
    WHEN ABS(i.issue_size - (d.fresh_issue + d.ofs_issue)) < 1
    THEN '✅ MATCH'
    ELSE '❌ MISMATCH'
  END as validation
FROM ipos i
JOIN ipo_details d ON i.id = d.ipo_id
WHERE d.fresh_issue IS NOT NULL AND d.ofs_issue IS NOT NULL;

-- Test cutOffPrice field for retail investors
SELECT
  i.company_name,
  d.cut_off_price,
  i.price_band_lower,
  i.price_band_upper
FROM ipos i
JOIN ipo_details d ON i.id = d.ipo_id
WHERE i.status = 'OPEN'
ORDER BY i.company_name;

-- Validate issueBreakdown JSON structure
SELECT
  i.company_name,
  d.issue_breakdown::jsonb ? 'qib' as has_qib,
  d.issue_breakdown::jsonb ? 'nii' as has_nii,
  d.issue_breakdown::jsonb ? 'retail' as has_retail,
  d.issue_breakdown::jsonb ? 'employee' as has_employee,
  d.issue_breakdown::jsonb ? 'shareholder' as has_shareholder
FROM ipos i
JOIN ipo_details d ON i.id = d.ipo_id
WHERE d.issue_breakdown IS NOT NULL
LIMIT 10;

-- Check minimum application size
SELECT
  i.company_name,
  d.minimum_application_shares,
  d.minimum_application_amount,
  i.price_band_lower,
  (d.minimum_application_shares * i.price_band_lower) as calculated_min_amount
FROM ipos i
JOIN ipo_details d ON i.id = d.ipo_id
WHERE d.minimum_application_shares IS NOT NULL;
```

---

### Query 6: Financial Metrics Validation

**Source**: TESTING_PLAN.md (lines 1437-1485)

**Context**:
**Success Criteria:**

```sql
-- Check which financial table is being used
SELECT
  'ipo_financials' as table_name,
  COUNT(*) as record_count
FROM ipo_financials
UNION ALL
SELECT
  'financial_data',
  COUNT(*)
FROM financial_data;

-- Compare data overlap
SELECT
  i.company_name,
  CASE WHEN if1.id IS NOT NULL THEN '✅' ELSE '❌' END as has_ipo_financials,
  CASE WHEN fd.id IS NOT NULL THEN '✅' ELSE '❌' END as has_financial_data
FROM ipos i
LEFT JOIN ipo_financials if1 ON i.id = if1.ipo_id
LEFT JOIN financial_data fd ON i.id = fd.ipo_id
WHERE i.status IN ('OPEN', 'UPCOMING');

-- Check enhanced metrics in ipoFinancials
SELECT
  COUNT(*) as total,
  COUNT(net_worth) as has_net_worth,
  COUNT(total_borrowings) as has_borrowings,
  COUNT(reserves) as has_reserves,
  COUNT(debt_equity_ratio) as has_debt_equity,
  COUNT(current_ratio) as has_current_ratio,
  COUNT(roe) as has_roe,
  COUNT(roce) as has_roce,
  COUNT(ronw) as has_ronw
FROM ipo_financials;

-- Validate FY1, FY2, FY3 progression
SELECT
  i.company_name,
  if1.fy1_revenue,
  if1.fy2_revenue,
  if1.fy3_revenue,
  CASE
    WHEN if1.fy3_revenue >= if1.fy2_revenue AND if1.fy2_revenue >= if1.fy1_revenue
    THEN '✅ GROWING'
    ELSE '⚠️ DECLINING'
  END as trend
FROM ipos i
JOIN ipo_financials if1 ON i.id = if1.ipo_id
WHERE if1.fy1_revenue IS NOT NULL AND if1.fy2_revenue IS NOT NULL AND if1.fy3_revenue IS NOT NULL;
```

---

### Query 7: Issue Structure Validation

**Source**: TESTING_PLAN.md (lines 1499-1538)

**Context**:
**Success Criteria:**

```sql
-- Check registrar data completeness
SELECT
  COUNT(*) as total_registrars,
  COUNT(name) as has_name,
  COUNT(website) as has_website,
  COUNT(email) as has_email,
  COUNT(phone) as has_phone,
  COUNT(address) as has_address
FROM registrars;

-- Verify all IPOs have registrar assigned
SELECT
  i.company_name,
  CASE WHEN r.id IS NOT NULL THEN '✅ ' || r.name ELSE '❌ NO REGISTRAR' END as registrar_status
FROM ipos i
LEFT JOIN registrars r ON i.registrar_id = r.id
WHERE i.status IN ('OPEN', 'UPCOMING')
ORDER BY registrar_status;

-- Check registrar usage distribution
SELECT
  r.name,
  COUNT(i.id) as ipo_count
FROM registrars r
LEFT JOIN ipos i ON r.id = i.registrar_id
GROUP BY r.name
ORDER BY ipo_count DESC;

-- Validate contact information format
SELECT
  name,
  email,
  CASE
    WHEN email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$' THEN '✅ VALID'
    ELSE '❌ INVALID'
  END as email_validation,
  phone,
  website
FROM registrars;
```

---

### Query 8: Enhanced Financial Metrics

**Source**: TESTING_PLAN.md (lines 1552-1608)

**Context**:
**Success Criteria:**

```sql
-- Verify broker affiliates configured
SELECT
  broker_name,
  is_active,
  display_order,
  affiliate_url,
  commission_rate
FROM broker_affiliates
ORDER BY display_order;

-- Check active brokers
SELECT
  is_active,
  COUNT(*) as broker_count
FROM broker_affiliates
GROUP BY is_active;

-- Validate affiliate click tracking
SELECT
  COUNT(*) as total_clicks,
  COUNT(DISTINCT ipo_id) as ipos_with_clicks,
  COUNT(DISTINCT broker_id) as brokers_with_clicks,
  MIN(clicked_at) as first_click,
  MAX(clicked_at) as last_click
FROM affiliate_clicks;

-- Click distribution by broker
SELECT
  ba.broker_name,
  COUNT(ac.id) as click_count,
  MIN(ac.clicked_at) as first_click,
  MAX(ac.clicked_at) as last_click
FROM broker_affiliates ba
LEFT JOIN affiliate_clicks ac ON ba.id = ac.broker_id
GROUP BY ba.broker_name
ORDER BY click_count DESC;

-- Click distribution by IPO
SELECT
  i.company_name,
  i.status,
  COUNT(ac.id) as click_count
FROM ipos i
LEFT JOIN affiliate_clicks ac ON i.id = ac.ipo_id
WHERE i.status IN ('OPEN', 'UPCOMING')
GROUP BY i.company_name, i.status
ORDER BY click_count DESC;

-- Referral source analysis
SELECT
  referral_source,
  COUNT(*) as click_count
FROM affiliate_clicks
WHERE referral_source IS NOT NULL
GROUP BY referral_source
ORDER BY click_count DESC;
```

---

### Query 9: IPO Financial Data Validation

**Source**: TESTING_PLAN.md (lines 1684-1685)

**Context**:
**SQL Validation:**

```sql
-- Not applicable for this step (code-level validation)
```

---

### Query 10: Issue Type Validation

**Source**: TESTING_PLAN.md (lines 1741-1754)

**Context**:
**SQL Queries for Validation:**

```sql
-- Check database query logs (if PostgreSQL query logging is enabled)
-- These queries should NOT appear on cache HIT
SELECT
    query,
    calls,
    total_exec_time,
    mean_exec_time
FROM pg_stat_statements
WHERE query LIKE '%ipos%'
ORDER BY calls DESC;

-- Alternative: Check repository executeQuery logs in application
-- (This is logged by BaseRepository.executeQuery method)
```

---

### Query 11: Registrar Data Completeness

**Source**: TESTING_PLAN.md (lines 1874-1881)

**Context**:
**SQL Verification:**

```sql
-- Verify insertion
SELECT id, company_name, slug, status, created_at
FROM ipos
WHERE slug = 'test-company-ipo';

-- Check if cache invalidation triggered any cleanup
-- (Look for DELETE operations in application logs)
```

---

### Query 12: Broker Affiliates Configuration

**Source**: TESTING_PLAN.md (lines 1903-1916)

**Context**:
**SQL Verification:**

```sql
-- Verify update
SELECT slug, status, updated_at
FROM ipos
WHERE slug = 'test-company-ipo';

-- Check update timestamp changed
SELECT
    slug,
    status,
    updated_at,
    updated_at > (NOW() - INTERVAL '1 minute') AS recently_updated
FROM ipos
WHERE slug = 'test-company-ipo';
```

---

### Query 13: Cache Key Coverage Analysis

**Source**: TESTING_PLAN.md (lines 2308-2341)

**Context**:
**Query 2: Cache Key Coverage Analysis**

```sql
-- Generate expected cache keys for current data
-- This helps verify cache coverage vs. actual data

WITH ipo_cache_keys AS (
    SELECT
        'ipo:slug:' || slug AS cache_key,
        'detail' AS cache_type,
        900 AS expected_ttl_seconds,
        status,
        category
    FROM ipos
    WHERE status IN ('OPEN', 'UPCOMING', 'CLOSED')
),
ipo_list_keys AS (
    SELECT
        'ipo:list:' || category || '-' || status AS cache_key,
        'list' AS cache_type,
        300 AS expected_ttl_seconds,
        status,
        category
    FROM (
        SELECT DISTINCT category, status
        FROM ipos
        WHERE status IN ('OPEN', 'UPCOMING')
    ) combinations
)
SELECT * FROM ipo_cache_keys
UNION ALL
SELECT * FROM ipo_list_keys
ORDER BY cache_type, cache_key;

-- Total expected cache keys: ~50-100 (depending on active IPOs)
-- Compare with actual Redis keys: redis-cli DBSIZE
```

---

### Query 14: Data Integrity Checks

**Source**: TESTING_PLAN.md (lines 2558-2576)

**Context**:
**12. Data Integrity Checks**

```sql
-- Foreign key integrity
SELECT COUNT(*) FROM ipo_details WHERE ipo_id NOT IN (SELECT id FROM ipos);
SELECT COUNT(*) FROM ipo_reviews WHERE ipo_id NOT IN (SELECT id FROM ipos);
SELECT COUNT(*) FROM documents WHERE ipo_id NOT IN (SELECT id FROM ipos);

-- Duplicate slugs
SELECT slug, COUNT(*) FROM ipos GROUP BY slug HAVING COUNT(*) > 1;

-- Date logic
SELECT * FROM ipos WHERE close_date < open_date;
SELECT * FROM ipos WHERE status = 'LISTED' AND listing_date IS NULL;

-- Price logic
SELECT * FROM ipos WHERE price_band_high < price_band_low;

-- Data quality
SELECT * FROM ipos WHERE lot_size <= 0;
SELECT * FROM ipos WHERE issue_size <= 0;
```

---

### Query 15: Data Consistency Validation

**Source**: TESTING_PLAN.md (lines 4078-4100)

**Context**:
**41. ✅ ENHANCEMENT #27: Data Consistency**

```sql
-- No orphaned foreign keys
SELECT COUNT(*) FROM ipo_details WHERE ipo_id NOT IN (SELECT id FROM ipos);
SELECT COUNT(*) FROM ipo_financials WHERE ipo_id NOT IN (SELECT id FROM ipos);
SELECT COUNT(*) FROM ipo_reviews WHERE ipo_id NOT IN (SELECT id FROM ipos);

-- Slug uniqueness
SELECT slug, COUNT(*) FROM ipos GROUP BY slug HAVING COUNT(*) > 1;

-- Date logic valid
SELECT * FROM ipos WHERE close_date < open_date;
SELECT * FROM ipos WHERE listing_date IS NOT NULL AND listing_date < close_date;

-- Status consistency
SELECT * FROM ipos WHERE status = 'LISTED' AND listing_date IS NULL;
SELECT * FROM ipos WHERE status = 'UPCOMING' AND open_date < NOW();
SELECT * FROM ipos WHERE status = 'OPEN' AND close_date < NOW();

-- Category consistency
SELECT i.company_name, i.category, r.category
FROM ipos i
JOIN ipo_reviews r ON i.id = r.ipo_id
WHERE i.category != r.category;
```

---

## GMP & Subscription Queries

**Total Queries**: 8

### Query 1: GMP & Subscription Data Tests

**Source**: TESTING_PLAN.md (lines 917-991)

**Context**:
**9. ✅ ENHANCEMENT #5: GMP & Subscription Data Tests**

```sql
-- GMP freshness for OPEN IPOs
SELECT
  company_name,
  status,
  gmp,
  gmp_percentage,
  gmp_updated_at,
  EXTRACT(EPOCH FROM (NOW() - gmp_updated_at))/3600 as hours_since_update
FROM ipos
WHERE status IN ('OPEN', 'UPCOMING')
ORDER BY gmp_updated_at DESC;

-- Flag stale GMP (>24 hours old)
SELECT company_name, status, gmp_updated_at
FROM ipos
WHERE status IN ('OPEN', 'UPCOMING')
AND gmp_updated_at < NOW() - INTERVAL '24 hours';

-- Multi-source GMP verification
SELECT
  i.company_name,
  array_agg(DISTINCT gt.source) as sources,
  COUNT(DISTINCT gt.source) as source_count,
  AVG(gt.gmp_amount) as avg_gmp,
  MAX(gt.recorded_at) as latest_update
FROM ipos i
JOIN gmp_tracking gt ON i.id = gt.ipo_id
WHERE i.status IN ('OPEN', 'UPCOMING')
GROUP BY i.company_name
ORDER BY latest_update DESC;

-- GMP history tracking
SELECT
  i.company_name,
  COUNT(gh.id) as gmp_records,
  MIN(gh.recorded_at) as first_record,
  MAX(gh.recorded_at) as latest_record,
  MAX(gh.gmp_value) as peak_gmp
FROM ipos i
LEFT JOIN gmp_history gh ON i.id = gh.ipo_id
WHERE i.status IN ('OPEN', 'UPCOMING')
GROUP BY i.company_name;

-- Subscription time-series
SELECT
  i.company_name,
  i.status,
  COUNT(s.id) as subscription_records,
  MIN(s.timestamp) as first_snapshot,
  MAX(s.timestamp) as latest_snapshot,
  MAX(s.total_subscription) as peak_subscription
FROM ipos i
LEFT JOIN subscriptions s ON i.id = s.ipo_id
WHERE i.status IN ('OPEN', 'CLOSED')
GROUP BY i.company_name, i.status
ORDER BY latest_snapshot DESC;

-- Subscription categories completeness
SELECT
  i.company_name,
  s.qib_subscription,
  s.nii_subscription,
  s.retail_subscription,
  s.employee_subscription,
  s.total_subscription,
  s.timestamp
FROM ipos i
JOIN subscriptions s ON i.id = s.ipo_id
WHERE i.status = 'OPEN'
AND s.timestamp = (
  SELECT MAX(timestamp)
  FROM subscriptions
  WHERE ipo_id = i.id
);
```

---

### Query 2: GMP Freshness Verification

**Source**: TESTING_PLAN.md (lines 1932-1944)

**Context**:
**SQL Verification:**

```sql
-- Verify deletion
SELECT COUNT(*)
FROM ipos
WHERE slug = 'test-company-ipo';
-- Expected: 0

-- Check related data cleanup (cascade deletes)
SELECT
    (SELECT COUNT(*) FROM subscriptions WHERE ipo_id = 'deleted-ipo-id') AS subscription_count,
    (SELECT COUNT(*) FROM gmp_records WHERE ipo_id = 'deleted-ipo-id') AS gmp_count,
    (SELECT COUNT(*) FROM financial_data WHERE ipo_id = 'deleted-ipo-id') AS financial_count;
-- All should be 0 if cascade deletes are configured
```

---

### Query 3: Subscription Monitoring Queries

**Source**: TESTING_PLAN.md (lines 2076-2106)

**Context**:
**SQL Queries for Monitoring:**

```sql
-- If PostgreSQL query logging is enabled in postgresql.conf:
-- log_statement = 'all' or log_min_duration_statement = 0

-- Query to check slow queries (if pg_stat_statements extension is installed)
SELECT
    substring(query, 1, 100) AS short_query,
    calls,
    total_exec_time,
    mean_exec_time,
    max_exec_time,
    stddev_exec_time
FROM pg_stat_statements
WHERE query LIKE '%ipos%' OR query LIKE '%subscriptions%'
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Expected metrics:
-- mean_exec_time < 100ms (p95 target)
-- max_exec_time < 500ms (outliers)
-- No queries with calls > 1000 in short time (N+1 query problem)

-- Query to identify N+1 problems (same query called many times)
SELECT
    query,
    calls,
    total_exec_time / calls AS avg_time_per_call,
    calls > 100 AS potential_n_plus_1_issue
FROM pg_stat_statements
WHERE calls > 100
ORDER BY calls DESC;
```

---

### Query 4: Repository Pattern Compliance

**Source**: TESTING_PLAN.md (lines 2285-2304)

**Context**:
**Query 1: Repository Pattern Compliance (Database-Level)**

```sql
-- While repositories are code-level, we can check data access patterns
-- by examining query logs or pg_stat_statements

-- Check most frequently executed queries (should align with repository methods)
SELECT
    substring(query, 1, 150) AS query_pattern,
    calls,
    total_exec_time,
    mean_exec_time,
    (total_exec_time / calls) AS avg_ms_per_call
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
ORDER BY calls DESC
LIMIT 20;

-- Expected patterns matching repository methods:
-- SELECT ... FROM ipos WHERE slug = $1 (findBySlug)
-- SELECT ... FROM ipos WHERE status = $1 AND category = $2 (findOpen)
-- SELECT ... FROM subscriptions WHERE ipo_id = $1 ORDER BY timestamp DESC LIMIT 1 (findLatest)
```

---

### Query 5: Performance Baseline Analysis

**Source**: TESTING_PLAN.md (lines 2345-2396)

**Context**:
**Query 3: Performance Baseline (With vs. Without Cache)**

```sql
-- Create performance comparison report
-- Run this query multiple times: with cache HIT, with cache MISS

EXPLAIN (ANALYZE, BUFFERS)
SELECT
    i.id,
    i.company_name,
    i.slug,
    i.category,
    i.status,
    i.open_date,
    i.close_date,
    fd.revenue,
    fd.profit,
    fd.roce,
    fd.roe,
    lp.listing_price,
    lp.listing_gain_percent,
    (SELECT json_agg(json_build_object(
        'timestamp', s.timestamp,
        'qib_times', s.qib_times,
        'nii_times', s.nii_times,
        'retail_times', s.retail_times,
        'total_times', s.total_times
    ))
    FROM (
        SELECT * FROM subscriptions
        WHERE ipo_id = i.id
        ORDER BY timestamp DESC
        LIMIT 10
    ) s
    ) AS recent_subscriptions,
    (SELECT json_build_object(
        'price', g.price,
        'premium', g.premium,
        'timestamp', g.timestamp
    )
    FROM gmp_records g
    WHERE g.ipo_id = i.id
    ORDER BY g.timestamp DESC
    LIMIT 1
    ) AS latest_gmp
FROM ipos i
LEFT JOIN financial_data fd ON i.id = fd.ipo_id
LEFT JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.slug = 'xyz-company-ipo';

-- Execution time targets:
-- With cache HIT: < 50ms (cache retrieval + JSON parsing)
-- With cache MISS: < 200ms (database query + joins + cache population)
-- Without Redis (degraded): < 300ms (database only, acceptable degradation)
```

---

### Query 6: Cache Invalidation Audit Trail

**Source**: TESTING_PLAN.md (lines 2400-2431)

**Context**:
**Query 4: Cache Invalidation Audit Trail**

```sql
-- Track mutation operations that should trigger cache invalidation
-- This requires application-level logging or audit table

-- Conceptual audit table structure (not in current schema):
/*
CREATE TABLE cache_invalidation_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation VARCHAR(10) NOT NULL, -- INSERT, UPDATE, DELETE
    table_name VARCHAR(50) NOT NULL,
    entity_id VARCHAR(255),
    cache_keys_invalidated TEXT[], -- Array of invalidated keys
    invalidated_at TIMESTAMP DEFAULT NOW()
);
*/

-- Example query for validation (if audit table exists):
SELECT
    operation,
    table_name,
    entity_id,
    array_length(cache_keys_invalidated, 1) AS num_keys_invalidated,
    cache_keys_invalidated,
    invalidated_at
FROM cache_invalidation_log
WHERE invalidated_at > NOW() - INTERVAL '1 hour'
ORDER BY invalidated_at DESC;

-- Expected patterns:
-- UPDATE ipos → ['ipo:slug:xyz-ipo', 'ipo:list:*']
-- INSERT subscriptions → ['subscription:latest:ipo-123', 'subscription:history:ipo-123']
-- DELETE ipos → ['ipo:slug:xyz-ipo', 'ipo:list:*', 'subscription:*:ipo-123', 'gmp:*:ipo-123']
```

---

### Query 7: Index Usage Verification

**Source**: TESTING_PLAN.md (lines 2435-2460)

**Context**:
**Query 5: Index Usage Verification (Critical for Cache MISS Performance)**

```sql
-- Verify indexes are properly used when cache is unavailable
-- This ensures acceptable performance during Redis downtime

SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan AS times_used,
    idx_tup_read AS tuples_read,
    idx_tup_fetch AS tuples_fetched,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
    ROUND(100.0 * idx_scan / NULLIF(seq_scan + idx_scan, 0), 2) AS index_usage_percent
FROM pg_stat_user_indexes
JOIN pg_stat_user_tables USING (schemaname, tablename)
WHERE schemaname = 'public'
AND tablename IN ('ipos', 'subscriptions', 'gmp_records', 'financial_data', 'listing_performance')
ORDER BY idx_scan DESC;

-- Expected high-usage indexes:
-- ipos_slug_idx → 90%+ usage (primary lookup method)
-- ipos_status_category_idx → 80%+ usage (list filtering)
-- subscriptions_ipo_id_idx → 95%+ usage (foreign key lookups)
-- gmp_records_ipo_id_idx → 95%+ usage (foreign key lookups)

-- If index usage < 50%, investigate query patterns
```

---

### Query 8: Both should return HTTP 200 OK (data updated in database)

**Source**: TESTING_PLAN.md (lines 3880-3889)

**Context**:
# Both should return HTTP 200 OK (data updated in database)

```sql
-- Connect to database
psql -h localhost -U postgres -d ipodhan

-- Check subscription was saved
SELECT ipo_id, retail_times, nii_times, qib_times, updated_at
FROM subscriptions
WHERE ipo_id = 'test-ipo-123'
ORDER BY updated_at DESC
LIMIT 1;
```

---

## Historical Data Validation

**Total Queries**: 2

### Query 1: Historical Data Completeness Tests

**Source**: TESTING_PLAN.md (lines 1033-1136)

**Context**:
**10. ✅ ENHANCEMENT #6: Historical Data Completeness Tests**

```sql
-- Check all LISTED IPOs have listing_performance
SELECT
  i.id,
  i.company_name,
  i.listing_date,
  i.status,
  CASE WHEN lp.id IS NOT NULL THEN 'Has Data' ELSE 'MISSING' END as performance_status
FROM ipos i
LEFT JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.status = 'LISTED'
ORDER BY i.listing_date DESC;

-- Count missing records
SELECT COUNT(*) as listed_ipos_without_performance
FROM ipos i
LEFT JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.status = 'LISTED' AND lp.id IS NULL;

-- Check required fields populated
SELECT
  i.company_name,
  lp.listing_price,
  lp.issue_price,
  lp.listing_gain_percent,
  lp.current_price,
  lp.last_updated
FROM ipos i
JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.status = 'LISTED'
AND (
  lp.listing_price IS NULL OR
  lp.issue_price IS NULL OR
  lp.listing_gain_percent IS NULL
);

-- Current price freshness
SELECT
  i.company_name,
  i.listing_date,
  lp.current_price,
  lp.current_price_bse,
  lp.current_price_nse,
  lp.last_updated,
  EXTRACT(DAY FROM (NOW() - lp.last_updated)) as days_since_update
FROM ipos i
JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.status = 'LISTED'
AND lp.last_updated < NOW() - INTERVAL '7 days'
ORDER BY lp.last_updated ASC;

-- Multi-year coverage
SELECT
  EXTRACT(YEAR FROM listing_date) as year,
  COUNT(*) as total_listings,
  COUNT(lp.id) as with_performance_data,
  ROUND(100.0 * COUNT(lp.id) / COUNT(*), 2) as coverage_percent
FROM ipos i
LEFT JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.status = 'LISTED'
GROUP BY EXTRACT(YEAR FROM listing_date)
ORDER BY year DESC;

-- BSE vs NSE price comparison
SELECT
  i.company_name,
  i.exchange,
  lp.current_price_bse,
  lp.current_price_nse,
  CASE
    WHEN lp.current_price_bse IS NULL THEN 'BSE Missing'
    WHEN lp.current_price_nse IS NULL THEN 'NSE Missing'
    ELSE 'Both Present'
  END as price_status
FROM ipos i
JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.status = 'LISTED'
AND i.exchange = 'BOTH'
ORDER BY i.listing_date DESC;

-- Category coverage
SELECT
  i.category,
  COUNT(*) as total_listed,
  COUNT(lp.id) as with_performance,
  ROUND(100.0 * COUNT(lp.id) / COUNT(*), 2) as coverage_percent
FROM ipos i
LEFT JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.status = 'LISTED'
GROUP BY i.category;

-- Performance metrics validation
SELECT
  i.company_name,
  lp.listing_price,
  lp.issue_price,
  lp.listing_gain_percent,
  ROUND(((lp.listing_price - lp.issue_price)::numeric / lp.issue_price * 100), 2) as calculated_gain_percent,
  ABS(lp.listing_gain_percent - ROUND(((lp.listing_price - lp.issue_price)::numeric / lp.issue_price * 100), 2)) as difference
FROM ipos i
JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.status = 'LISTED'
AND ABS(lp.listing_gain_percent - ROUND(((lp.listing_price - lp.issue_price)::numeric / lp.issue_price * 100), 2)) > 0.1
ORDER BY difference DESC;
```

---

### Query 2: Database Fallback Performance

**Source**: TESTING_PLAN.md (lines 1798-1821)

**Context**:
**SQL Queries for Database Fallback:**

```sql
-- Verify the actual database query executed on cache MISS
-- This should match the query in IPORepository.findBySlug()
SELECT
    ipos.*,
    financialData.revenue,
    financialData.profit,
    financialData.roce,
    financialData.roe,
    listingPerformance.listing_price,
    listingPerformance.listing_gain_percent
FROM ipos
LEFT JOIN financial_data AS financialData
    ON ipos.id = financialData.ipo_id
LEFT JOIN listing_performance AS listingPerformance
    ON ipos.id = listingPerformance.ipo_id
WHERE ipos.slug = 'xyz-company-ipo'
LIMIT 1;

-- Check query execution time
EXPLAIN ANALYZE
SELECT ipos.* FROM ipos WHERE slug = 'xyz-company-ipo';
-- Expected: Index Scan on ipos_slug_idx (if index exists)
-- Execution time should be < 10ms
```

---

## Scoring & Peer Comparison

**Total Queries**: 3

### Query 1: IPO Scoring System Validation

**Source**: TESTING_PLAN.md (lines 1182-1259)

**Context**:
**Success Criteria:**

```sql
-- Verify ipoScores table exists and has data
SELECT COUNT(*) FROM ipo_scores;

-- Check all OPEN/UPCOMING IPOs have scores
SELECT
  i.company_name,
  i.status,
  CASE WHEN s.id IS NULL THEN 'MISSING SCORE' ELSE 'HAS SCORE' END as score_status
FROM ipos i
LEFT JOIN ipo_scores s ON i.id = s.ipo_id
WHERE i.status IN ('OPEN', 'UPCOMING')
ORDER BY score_status DESC, i.company_name;

-- Validate score mathematics (should sum to 100)
SELECT
  company_name,
  fundamental_score,
  sentiment_score,
  subscription_score,
  sector_score,
  total_score,
  (fundamental_score + sentiment_score + subscription_score + sector_score) as calculated_total,
  CASE
    WHEN total_score = (fundamental_score + sentiment_score + subscription_score + sector_score)
    THEN '✅ CORRECT'
    ELSE '❌ MISMATCH'
  END as validation
FROM ipos i
JOIN ipo_scores s ON i.id = s.ipo_id
WHERE i.status IN ('OPEN', 'UPCOMING');

-- Verify verdict matches score ranges
SELECT
  company_name,
  total_score,
  verdict,
  CASE
    WHEN total_score >= 75 AND verdict = 'BUY' THEN '✅ CORRECT'
    WHEN total_score >= 50 AND total_score < 75 AND verdict = 'HOLD' THEN '✅ CORRECT'
    WHEN total_score < 50 AND verdict = 'AVOID' THEN '✅ CORRECT'
    ELSE '❌ INCORRECT'
  END as verdict_validation
FROM ipos i
JOIN ipo_scores s ON i.id = s.ipo_id
WHERE i.status IN ('OPEN', 'UPCOMING');

-- Check confidence levels are consistent
SELECT
  confidence,
  COUNT(*) as count,
  AVG(total_score) as avg_score,
  MIN(total_score) as min_score,
  MAX(total_score) as max_score
FROM ipo_scores
GROUP BY confidence
ORDER BY avg_score DESC;

-- Validate algorithm version tracking
SELECT
  algorithm_version,
  COUNT(*) as ipo_count,
  MIN(calculated_at) as first_calculation,
  MAX(calculated_at) as last_calculation
FROM ipo_scores
GROUP BY algorithm_version
ORDER BY algorithm_version DESC;

-- Check score freshness (should be recent for OPEN IPOs)
SELECT
  i.company_name,
  i.status,
  s.calculated_at,
  EXTRACT(EPOCH FROM (NOW() - s.calculated_at))/3600 as hours_since_calculation
FROM ipos i
JOIN ipo_scores s ON i.id = s.ipo_id
WHERE i.status = 'OPEN'
ORDER BY s.calculated_at ASC;
```

---

### Query 2: Peer Comparison Validation

**Source**: TESTING_PLAN.md (lines 1274-1337)

**Context**:
**Success Criteria:**

```sql
-- Verify peer_companies table exists
SELECT COUNT(*) FROM peer_companies;

-- Check all IPOs have peer companies assigned
SELECT
  i.company_name,
  i.sector,
  COUNT(pc.id) as peer_count
FROM ipos i
LEFT JOIN peer_companies pc ON i.id = pc.ipo_id
WHERE i.status IN ('OPEN', 'UPCOMING', 'CLOSED')
GROUP BY i.company_name, i.sector
HAVING COUNT(pc.id) = 0
ORDER BY i.company_name;

-- Validate peers are in same sector
SELECT
  i.company_name as ipo_name,
  i.sector as ipo_sector,
  pc.company_name as peer_name,
  pc.sector as peer_sector,
  CASE WHEN i.sector = pc.sector THEN '✅ MATCH' ELSE '❌ MISMATCH' END as sector_validation
FROM ipos i
JOIN peer_companies pc ON i.id = pc.ipo_id;

-- Test financial metrics completeness
SELECT
  'PE Ratio' as metric,
  COUNT(*) as total,
  COUNT(pe_ratio) as populated,
  ROUND(100.0 * COUNT(pe_ratio) / COUNT(*), 2) as coverage_percent
FROM peer_companies
UNION ALL
SELECT 'EPS', COUNT(*), COUNT(eps), ROUND(100.0 * COUNT(eps) / COUNT(*), 2)
FROM peer_companies
UNION ALL
SELECT 'ROE', COUNT(*), COUNT(roe), ROUND(100.0 * COUNT(roe) / COUNT(*), 2)
FROM peer_companies
UNION ALL
SELECT 'RONW', COUNT(*), COUNT(ronw), ROUND(100.0 * COUNT(ronw) / COUNT(*), 2)
FROM peer_companies
UNION ALL
SELECT 'PB Ratio', COUNT(*), COUNT(pbv_ratio), ROUND(100.0 * COUNT(pbv_ratio) / COUNT(*), 2)
FROM peer_companies
ORDER BY coverage_percent ASC;

-- Verify listed vs unlisted classification
SELECT
  is_listed,
  COUNT(*) as count,
  AVG(pe_ratio) as avg_pe,
  AVG(roe) as avg_roe
FROM peer_companies
GROUP BY is_listed;

-- Check data freshness
SELECT
  pc.company_name,
  pc.updated_at,
  EXTRACT(EPOCH FROM (NOW() - pc.updated_at))/86400 as days_since_update
FROM peer_companies pc
WHERE pc.updated_at < NOW() - INTERVAL '90 days'
ORDER BY pc.updated_at ASC;
```

---

### Query 3: Sector-Based Peer Validation

**Source**: TESTING_PLAN.md (lines 3642-3660)

**Context**:
**Test:**

```sql
-- Verify ipo_scores table populated
SELECT COUNT(*) FROM ipo_scores;

-- Check score ranges
SELECT
  MIN(total_score), MAX(total_score),
  MIN(fundamental_score), MAX(fundamental_score),
  MIN(sentiment_score), MAX(sentiment_score),
  MIN(subscription_score), MAX(subscription_score),
  MIN(sector_score), MAX(sector_score)
FROM ipo_scores;

-- Verify constraints (totalScore 0-100, etc.)
SELECT * FROM ipo_scores
WHERE total_score < 0 OR total_score > 100;

-- Check score_history tracks changes
SELECT COUNT(*) FROM score_history;
```

---

## Repository Pattern Validation

**Total Queries**: 1

### Query 1: Cache Pattern Identification

**Source**: TESTING_PLAN.md (lines 2002-2018)

**Context**:
**SQL Query to Identify Cache Patterns:**

```sql
-- Query to generate cache keys that should exist
-- (This is conceptual - cache keys are in Redis, not database)
SELECT
    'ipo:slug:' || slug AS cache_key,
    'Expected TTL: 900 seconds' AS ttl_info,
    status,
    category
FROM ipos
WHERE status IN ('OPEN', 'UPCOMING')
ORDER BY open_date;

-- Expected patterns:
-- ipo:slug:* → Individual IPO detail pages
-- ipo:list:* → Filtered IPO lists
-- subscription:latest:* → Latest subscription data
-- gmp:latest:* → Latest GMP data
```

---

## Safety & Approval

**Total Queries**: 2

### Query 1: Data Update Approval Process

**Source**: TESTING_PLAN.md (lines 129-136)

**Context**:
### Data Update Approval Process

```sql
-- ❌ Do NOT run without approval:
INSERT INTO ...
UPDATE ... SET ...
DELETE FROM ... WHERE ...
TRUNCATE ...
DROP ...
ALTER TABLE ...
```

---

### Query 2: Strictly FORBIDDEN (Even with Approval)

**Source**: TESTING_PLAN.md (lines 157-163)

**Context**:
### Strictly FORBIDDEN (Even with Approval)

```sql
-- ❌ ABSOLUTELY NEVER run these commands:
TRUNCATE any_table;                    -- Deletes all data
DROP TABLE any_table;                  -- Destroys table
DELETE FROM any_table;                 -- Without WHERE = deletes all
UPDATE any_table SET ...;              -- Without WHERE = updates all
ALTER TABLE any_table ...;             -- Schema changes on production
```

---

## Usage Notes

### Database Connection

**Before running any queries**, verify VPS database connection:

```bash
# Check connection
node scripts/check-tables-exist.js

# Expected output:
# Connected to: 103.118.16.189:5432/ipodhan
```

### Running Queries

**Option 1: Using psql**
```bash
PGPASSWORD="Papa3Monu@1234" psql -h 103.118.16.189 -p 5432 -U postgres -d ipodhan -f query.sql
```

**Option 2: Using database tool**
- Connect to: `103.118.16.189:5432/ipodhan`
- Username: `postgres`
- Password: `Papa3Monu@1234`

### Safety Guidelines

🔴 **PRODUCTION DATABASE** - All queries execute against live data

**Safe Operations** (no approval needed):
- ✅ SELECT queries (read-only)
- ✅ COUNT, SUM, AVG aggregations
- ✅ Table structure queries (`\dt`, `\d tablename`)

**Operations REQUIRING APPROVAL**:
- 🔒 INSERT, UPDATE, DELETE
- 🔒 TRUNCATE, DROP
- 🔒 ALTER TABLE
- 🔒 CREATE/DROP INDEX

**Best Practices**:
1. Test queries on smaller datasets first (add `LIMIT` clause)
2. Use `EXPLAIN ANALYZE` for performance analysis
3. Avoid long-running queries during peak hours
4. Monitor query execution time
5. Use transactions for any write operations

### Query Performance Targets

- Simple SELECT: < 100ms
- Aggregations: < 500ms
- Complex JOINs: < 1000ms
- Full table scans: Avoid if possible

---

**Generated**: 2025-10-20T13:26:30.594Z
**Source**: web/TESTING_PLAN.md
**Total Queries**: 36
