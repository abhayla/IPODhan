# Appendix B: SQL Queries Reference

**[← Back to Index](README.md)**

This appendix contains all SQL validation queries used throughout the testing phases.

---

## Quick Index

- [Data Existence Checks](#data-existence-checks)
- [Field Coverage Analysis](#field-coverage-analysis)
- [IPO Scoring Validation](#ipo-scoring-validation)
- [Peer Comparison Validation](#peer-comparison-validation)
- [Repository Pattern Queries](#repository-pattern-queries)
- [Data Consistency Queries](#data-consistency-queries)
- [Performance Analysis Queries](#performance-analysis-queries)
- [Cache Analysis Queries](#cache-analysis-queries)

---

## Data Existence Checks

### Basic Table Record Counts

```sql
-- Check all tables have data
SELECT
  'ipos' as table_name,
  COUNT(*) as record_count,
  MIN(created_at) as oldest_record,
  MAX(created_at) as newest_record
FROM ipos
UNION ALL
SELECT
  'subscriptions' as table_name,
  COUNT(*),
  MIN(created_at),
  MAX(created_at)
FROM subscriptions
UNION ALL
SELECT
  'gmp_records' as table_name,
  COUNT(*),
  MIN(created_at),
  MAX(created_at)
FROM gmp_records
UNION ALL
SELECT
  'financial_data' as table_name,
  COUNT(*),
  MIN(created_at),
  MAX(created_at)
FROM financial_data
ORDER BY table_name;
```

### IPO Status Distribution

```sql
-- Count IPOs by status
SELECT
  status,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM ipos
GROUP BY status
ORDER BY count DESC;
```

### IPO Category Distribution

```sql
-- Count IPOs by category
SELECT
  category,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM ipos
GROUP BY category
ORDER BY count DESC;
```

---

## Field Coverage Analysis

### Critical Fields Completeness

```sql
-- Check critical field coverage
SELECT
  COUNT(*) as total_ipos,
  COUNT(company_name) as has_company_name,
  COUNT(open_date) as has_open_date,
  COUNT(close_date) as has_close_date,
  COUNT(issue_size) as has_issue_size,
  COUNT(price_band_low) as has_price_band_low,
  COUNT(price_band_high) as has_price_band_high,
  COUNT(lot_size) as has_lot_size,
  ROUND(100.0 * COUNT(company_name) / COUNT(*), 2) as company_name_coverage,
  ROUND(100.0 * COUNT(open_date) / COUNT(*), 2) as open_date_coverage,
  ROUND(100.0 * COUNT(close_date) / COUNT(*), 2) as close_date_coverage
FROM ipos;
```

### Important Fields Coverage

```sql
-- Check important field coverage
SELECT
  COUNT(*) as total_ipos,
  COUNT(sector) as has_sector,
  COUNT(lead_managers) as has_lead_managers,
  COUNT(registrar_id) as has_registrar,
  COUNT(listing_date) as has_listing_date,
  ROUND(100.0 * COUNT(sector) / COUNT(*), 2) as sector_coverage,
  ROUND(100.0 * COUNT(lead_managers) / COUNT(*), 2) as lead_managers_coverage,
  ROUND(100.0 * COUNT(registrar_id) / COUNT(*), 2) as registrar_coverage
FROM ipos;
```

### Enhanced Fields Coverage

```sql
-- Check enhanced field coverage (historical fields)
SELECT
  COUNT(*) as total_ipos,
  COUNT(performance_day1) as has_performance_day1,
  COUNT(performance_week1) as has_performance_week1,
  COUNT(performance_month1) as has_performance_month1,
  COUNT(current_price) as has_current_price,
  COUNT(market_cap_current) as has_market_cap,
  ROUND(100.0 * COUNT(performance_day1) / COUNT(*), 2) as day1_coverage,
  ROUND(100.0 * COUNT(performance_week1) / COUNT(*), 2) as week1_coverage,
  ROUND(100.0 * COUNT(current_price) / COUNT(*), 2) as current_price_coverage
FROM ipos
WHERE status = 'LISTED';
```

---

## IPO Scoring Validation

### Score Table Existence and Completeness

```sql
-- Verify ipo_scores table exists and has data
SELECT COUNT(*) as total_scores FROM ipo_scores;

-- Check all OPEN/UPCOMING IPOs have scores
SELECT
  i.company_name,
  i.status,
  CASE WHEN s.id IS NULL THEN 'MISSING SCORE' ELSE 'HAS SCORE' END as score_status
FROM ipos i
LEFT JOIN ipo_scores s ON i.id = s.ipo_id
WHERE i.status IN ('OPEN', 'UPCOMING')
ORDER BY score_status DESC, i.company_name;
```

### Score Mathematics Validation

```sql
-- Validate score mathematics (should sum to 100)
SELECT
  i.company_name,
  s.fundamental_score,
  s.sentiment_score,
  s.subscription_score,
  s.sector_score,
  s.total_score,
  (s.fundamental_score + s.sentiment_score + s.subscription_score + s.sector_score) as calculated_total,
  CASE
    WHEN s.total_score = (s.fundamental_score + s.sentiment_score + s.subscription_score + s.sector_score)
    THEN '✅ CORRECT'
    ELSE '❌ MISMATCH'
  END as validation
FROM ipos i
JOIN ipo_scores s ON i.id = s.ipo_id
WHERE i.status IN ('OPEN', 'UPCOMING');
```

### Score Range Validation

```sql
-- Verify scores are within valid ranges (0-100)
SELECT
  COUNT(*) as total_scores,
  COUNT(CASE WHEN total_score < 0 OR total_score > 100 THEN 1 END) as invalid_total,
  COUNT(CASE WHEN fundamental_score < 0 OR fundamental_score > 40 THEN 1 END) as invalid_fundamental,
  COUNT(CASE WHEN sentiment_score < 0 OR sentiment_score > 30 THEN 1 END) as invalid_sentiment,
  COUNT(CASE WHEN subscription_score < 0 OR subscription_score > 20 THEN 1 END) as invalid_subscription,
  COUNT(CASE WHEN sector_score < 0 OR sector_score > 10 THEN 1 END) as invalid_sector
FROM ipo_scores;
```

---

## Peer Comparison Validation

### Peer Companies Existence

```sql
-- Check peer_companies table has data
SELECT
  i.company_name,
  COUNT(pc.id) as peer_count,
  CASE WHEN COUNT(pc.id) >= 3 THEN '✅ SUFFICIENT' ELSE '⚠️ INSUFFICIENT' END as peer_status
FROM ipos i
LEFT JOIN peer_companies pc ON i.id = pc.ipo_id
WHERE i.status IN ('OPEN', 'UPCOMING')
GROUP BY i.id, i.company_name
ORDER BY peer_count ASC;
```

### Peer Data Completeness

```sql
-- Validate peer comparison data completeness
SELECT
  COUNT(*) as total_peers,
  COUNT(company_name) as has_name,
  COUNT(market_cap) as has_market_cap,
  COUNT(pe_ratio) as has_pe,
  COUNT(revenue) as has_revenue,
  COUNT(profit) as has_profit,
  ROUND(100.0 * COUNT(market_cap) / COUNT(*), 2) as market_cap_coverage,
  ROUND(100.0 * COUNT(pe_ratio) / COUNT(*), 2) as pe_coverage
FROM peer_companies;
```

---

## Repository Pattern Queries

### Cache Key Coverage Analysis

```sql
-- Generate expected cache keys for current data
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
```

### Query Performance Analysis

```sql
-- Check most frequently executed queries (requires pg_stat_statements)
SELECT
    substring(query, 1, 150) AS query_pattern,
    calls,
    mean_exec_time,
    max_exec_time,
    (total_exec_time / calls) AS avg_ms_per_call
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
ORDER BY calls DESC
LIMIT 20;
```

### Index Usage Verification

```sql
-- Verify indexes are properly used
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan AS times_used,
    idx_tup_read AS tuples_read,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
    ROUND(100.0 * idx_scan / NULLIF(seq_scan + idx_scan, 0), 2) AS index_usage_percent
FROM pg_stat_user_indexes
JOIN pg_stat_user_tables USING (schemaname, tablename)
WHERE schemaname = 'public'
AND tablename IN ('ipos', 'subscriptions', 'gmp_records', 'financial_data')
ORDER BY idx_scan DESC;
```

---

## Data Consistency Queries

### Foreign Key Integrity

```sql
-- Check for orphaned foreign keys
SELECT 'ipo_details' as table_name, COUNT(*) as orphaned_count
FROM ipo_details WHERE ipo_id NOT IN (SELECT id FROM ipos)
UNION ALL
SELECT 'ipo_financials', COUNT(*)
FROM ipo_financials WHERE ipo_id NOT IN (SELECT id FROM ipos)
UNION ALL
SELECT 'ipo_reviews', COUNT(*)
FROM ipo_reviews WHERE ipo_id NOT IN (SELECT id FROM ipos)
UNION ALL
SELECT 'documents', COUNT(*)
FROM documents WHERE ipo_id NOT IN (SELECT id FROM ipos);
```

### Duplicate Detection

```sql
-- Check for duplicate slugs
SELECT slug, COUNT(*) as duplicate_count
FROM ipos
GROUP BY slug
HAVING COUNT(*) > 1;

-- Check for duplicate IPO names
SELECT company_name, COUNT(*) as duplicate_count
FROM ipos
GROUP BY company_name
HAVING COUNT(*) > 1;
```

### Date Logic Validation

```sql
-- Verify date logic is valid
SELECT
  company_name,
  open_date,
  close_date,
  listing_date,
  CASE WHEN close_date < open_date THEN '❌ Close before Open' ELSE '✅' END as date_check_1,
  CASE WHEN listing_date < close_date THEN '❌ Listing before Close' ELSE '✅' END as date_check_2
FROM ipos
WHERE
  (close_date < open_date) OR
  (listing_date IS NOT NULL AND listing_date < close_date);
```

### Status Consistency

```sql
-- Verify status matches dates
SELECT
  company_name,
  status,
  open_date,
  close_date,
  listing_date,
  CASE
    WHEN status = 'LISTED' AND listing_date IS NULL THEN '❌ Listed but no listing_date'
    WHEN status = 'UPCOMING' AND open_date < NOW() THEN '❌ Upcoming but open_date passed'
    WHEN status = 'OPEN' AND close_date < NOW() THEN '❌ Open but close_date passed'
    ELSE '✅ Consistent'
  END as consistency_check
FROM ipos
WHERE
  (status = 'LISTED' AND listing_date IS NULL) OR
  (status = 'UPCOMING' AND open_date < NOW()) OR
  (status = 'OPEN' AND close_date < NOW());
```

---

## Performance Analysis Queries

### Slow Query Detection

```sql
-- Identify queries slower than 100ms (requires pg_stat_statements)
SELECT
    substring(query, 1, 100) AS short_query,
    calls,
    mean_exec_time,
    max_exec_time,
    stddev_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 20;
```

### N+1 Query Detection

```sql
-- Identify potential N+1 problems (same query called many times)
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

## Cache Analysis Queries

**Note:** Cache analysis is primarily done via Redis CLI commands, not SQL. However, we can analyze which data should be cached:

### Most Accessed IPOs (Should Be Cached)

```sql
-- IPOs that should have high cache hit rates
-- (This is conceptual - actual access logs would come from application)
SELECT
  slug,
  status,
  category,
  'ipo:slug:' || slug as expected_cache_key
FROM ipos
WHERE status IN ('OPEN', 'UPCOMING')
ORDER BY
  CASE status
    WHEN 'OPEN' THEN 1
    WHEN 'UPCOMING' THEN 2
  END,
  open_date DESC
LIMIT 20;
```

---

## Quick Reference Commands

### Connect to Database

```bash
# From project root
psql -h 103.118.16.189 -U postgres -d ipodhan

# Run specific query file
psql -h 103.118.16.189 -U postgres -d ipodhan -f query.sql

# Run query and output to file
psql -h 103.118.16.189 -U postgres -d ipodhan -c "SELECT * FROM ipos LIMIT 10" > output.txt
```

### Export Query Results

```bash
# Export to CSV
psql -h 103.118.16.189 -U postgres -d ipodhan -c "COPY (SELECT * FROM ipos) TO STDOUT WITH CSV HEADER" > ipos.csv

# Export specific query
psql -h 103.118.16.189 -U postgres -d ipodhan -c "COPY (SELECT company_name, status, open_date FROM ipos WHERE status='OPEN') TO STDOUT WITH CSV HEADER" > open_ipos.csv
```

---

## Using These Queries

**From Phase Documents:**
1. Copy the SQL query
2. Paste into `psql` session or SQL client
3. Analyze results against success criteria
4. Document findings in TEST_PROGRESS.md

**Batch Execution:**
```bash
# Save queries to files, then run:
psql -h 103.118.16.189 -U postgres -d ipodhan -f data-existence.sql
psql -h 103.118.16.189 -U postgres -d ipodhan -f field-coverage.sql
psql -h 103.118.16.189 -U postgres -d ipodhan -f data-consistency.sql
```

---

**To populate more queries:** Extract SQL blocks from `web/TESTING_PLAN.md` and organize by category above.
