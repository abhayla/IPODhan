# Comprehensive Scraper Testing & Verification Plan (Enhanced)

## Overview
Test the complete scraping pipeline across all data sources, verify data populates all 100+ database fields correctly, validate UI display across multiple screens, and ensure data quality through comprehensive validation rules.

**Version**: 2.0 (Enhanced with 18 gap validations)
**Last Updated**: 2025-01-XX

---

## Understanding of Codebase Implementation

### 1. **Scraper Execution Sequence** (from `scraper/src/index.ts`)
When running `npm run start:all` in scraper directory:
1. **NSE Scraper** → `runNSEScraper()`
2. **BSE Scraper** → `runBSEScraper()`
3. **Moneycontrol Scraper** → `runMoneycontrolScraper()`
4. **Chittorgarh Scraper** → `runChittorgarhScraper()`
5. **IPO Alerts API Fallback** → `runIPOAlertsFallback()`

Sequential execution, aggregating results at the end.

### 2. **Data Handling Logic** (from `scraper/src/services/data-persister.ts`)
- **Strategy**: Upsert (Insert if new, Update if exists)
- **Merge Logic**: For dual-listed IPOs (both NSE & BSE):
  - Merges `listingExchanges` array
  - Keeps existing data if BSE data conflicts with NSE
  - Updates `lastScrapedAt` timestamp
- **Retry Logic**: 3 retry attempts with exponential backoff (50ms → 2000ms)
- **Change Tracking**: Returns `iposInserted`, `iposUpdated`, `iposMerged` counters

### 3. **Conflict Resolution** (from `scraper/src/services/data-merger.ts`)
- **Priority**: NSE(1) > BSE(2) > Moneycontrol(3) > Chittorgarh(4) > API_Fallback(5)
- **Core Fields**: Higher priority sources overwrite
- **Optional Fields**: Lower priority sources supplement missing fields only
- **Supplementary Data**: Source-specific fields (GMP from Chittorgarh, ratings from Moneycontrol) always merged

### 4. **Database Schema** (from `packages/shared/src/db/schema.ts`)
**16 Tables with 100+ Fields:**
1. `ipos` (40+ fields) - Core IPO data + historical performance
2. `subscriptions` (18 fields) - Time-series subscription tracking
3. `gmpRecords` (7 fields) - Time-series GMP data
4. `financialData` (11 fields) - Financial metrics (legacy)
5. `ipoFinancials` (14 fields) - Enhanced financial data
6. `documents` (8 fields) - IPO documents
7. `listingPerformance` (8 fields) - Listing & current prices
8. `marketHolidays` (6 fields) - Trading holidays
9. `registrars` (10 fields) - Registrar directory
10. `peerCompanies` (12 fields) - Peer comparison
11. `brokerAffiliates` (6 fields) - Broker affiliates
12. `affiliateClicks` (5 fields) - Click tracking
13. `scraperLogs` (7 fields) - Scraper monitoring
14. `ipoReviews` (9 fields) - Analyst reviews
15. `ipoScores` (10 fields) - AI scoring system
16. `ipoDetails` (15 fields) - Extended IPO details

---

## Execution Plan

### Phase 0: Database Backup & Preparation (10 minutes)
**Goal**: Create safety net and prepare for testing

**✅ Gap #11: Rollback/Recovery Plan**

1. **Create database backup**
   ```bash
   # PostgreSQL backup
   pg_dump -h localhost -U postgres -d ipodhan > backup_pre_scrape_$(date +%Y%m%d_%H%M%S).sql

   # Verify backup created
   ls -lh backup_pre_scrape_*.sql
   ```

2. **Document current state**
   ```sql
   -- Count IPOs by status
   SELECT status, COUNT(*) as count FROM ipos GROUP BY status;

   -- Count IPOs by category
   SELECT category, COUNT(*) as count FROM ipos GROUP BY category;

   -- Total records
   SELECT
     (SELECT COUNT(*) FROM ipos) as total_ipos,
     (SELECT COUNT(*) FROM subscriptions) as total_subscriptions,
     (SELECT COUNT(*) FROM gmp_records) as total_gmp_records,
     (SELECT COUNT(*) FROM scraper_logs) as total_scraper_logs;
   ```

3. **Save pre-scrape timestamp**
   ```bash
   echo "$(date -Iseconds)" > scrape_start_timestamp.txt
   ```

4. **Verify backup restoration capability** (optional but recommended)
   ```bash
   # Test restore to temporary database
   createdb ipodhan_backup_test
   psql -h localhost -U postgres -d ipodhan_backup_test < backup_pre_scrape_*.sql
   dropdb ipodhan_backup_test
   ```

---

### Phase 1: Pre-Scraping Verification (5 minutes)
**Goal**: Ensure environment is ready

1. **Check database connection**
   ```bash
   curl http://localhost:3000/api/db-test
   ```
   - Expected: `{"status":"ok","database":"connected"}`

2. **Check Redis connection**
   ```bash
   curl http://localhost:3000/api/health
   ```
   - Expected: `{"redis":"connected"}`

3. **Verify web server is running**
   ```bash
   curl -I http://localhost:3000
   ```
   - Expected: HTTP 200 OK

4. **Check scraper environment**
   ```bash
   cd scraper
   test -f .env && echo ".env exists" || echo ".env MISSING"
   grep -q "DATABASE_URL" .env && echo "DATABASE_URL configured" || echo "DATABASE_URL MISSING"
   ```

5. **Verify Node.js dependencies**
   ```bash
   cd scraper
   npm list --depth=0 | grep -E "(puppeteer|cheerio|drizzle-orm)"
   ```

---

### Phase 2: Run All Scrapers Sequentially (15-30 minutes)
**Goal**: Execute complete scraping pipeline with performance tracking

**✅ Gap #15: Performance Metrics**

1. **Navigate to scraper directory**
   ```bash
   cd scraper
   ```

2. **Run all scrapers in sequence with timing**
   ```bash
   # Start timer
   START_TIME=$(date +%s)

   # Run scrapers
   npm run start:all 2>&1 | tee scraper_execution_log.txt

   # End timer
   END_TIME=$(date +%s)
   DURATION=$((END_TIME - START_TIME))
   echo "Total scraping duration: ${DURATION} seconds" | tee -a scraper_execution_log.txt
   ```

3. **Monitor execution logs**
   Track and record for EACH scraper:

   | Scraper | Duration | IPOs Processed | Inserted | Updated | Merged | Subscriptions | Errors | Status |
   |---------|----------|----------------|----------|---------|---------|---------------|--------|--------|
   | NSE | ? | ? | ? | ? | ? | ? | ? | ✅/❌ |
   | BSE | ? | ? | ? | ? | ? | ? | ? | ✅/❌ |
   | Moneycontrol | ? | ? | ? | ? | ? | ? | ? | ✅/❌ |
   | Chittorgarh | ? | ? | ? | ? | ? | ? | ? | ✅/❌ |
   | API Fallback | ? | ? | ? | ? | ? | ? | ? | ✅/❌ |

4. **Record performance metrics**
   - Total execution time
   - Requests per second
   - Network errors/retries
   - Memory usage peaks

5. **Document issues found** (don't fix yet)
   - Scraper failures
   - Data validation errors
   - Network timeouts
   - Missing data warnings
   - HTTP status codes received

---

### Phase 3: Database Field Verification (45-60 minutes)
**Goal**: Comprehensive validation of all database fields and data quality

**✅ Enhanced with Gaps #2, #3, #4, #5, #6, #7, #8, #9, #14**

---

#### 3.1: Sample IPO Selection

```sql
-- Get sample IPOs for testing (20 total)
-- 5 UPCOMING
SELECT id, company_name, slug, status, category
FROM ipos
WHERE status = 'UPCOMING'
ORDER BY open_date
LIMIT 5;

-- 5 OPEN
SELECT id, company_name, slug, status, category
FROM ipos
WHERE status = 'OPEN'
ORDER BY open_date DESC
LIMIT 5;

-- 5 CLOSED
SELECT id, company_name, slug, status, category
FROM ipos
WHERE status = 'CLOSED'
ORDER BY close_date DESC
LIMIT 5;

-- 5 LISTED
SELECT id, company_name, slug, status, category
FROM ipos
WHERE status = 'LISTED'
ORDER BY listing_date DESC
LIMIT 5;
```

---

#### 3.2: Duplicate Detection (Gap #3)

```sql
-- Check for duplicate company names
SELECT company_name, COUNT(*) as duplicate_count, array_agg(id) as ipo_ids
FROM ipos
GROUP BY company_name
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- Check for duplicate slugs
SELECT slug, COUNT(*) as duplicate_count, array_agg(id) as ipo_ids
FROM ipos
GROUP BY slug
HAVING COUNT(*) > 1;

-- Check for potential fuzzy duplicates (similar names)
SELECT i1.id as id1, i1.company_name as name1,
       i2.id as id2, i2.company_name as name2,
       similarity(i1.company_name, i2.company_name) as similarity_score
FROM ipos i1
JOIN ipos i2 ON i1.id < i2.id
WHERE similarity(i1.company_name, i2.company_name) > 0.85
  AND i1.id != i2.id
ORDER BY similarity_score DESC;
```

**Expected**: No duplicates. If found, flag as HIGH severity issue.

---

#### 3.3: Data Quality Validation Rules (Gap #4)

```sql
-- Date ordering validation
SELECT id, company_name, open_date, close_date, allotment_date, listing_date
FROM ipos
WHERE (open_date IS NOT NULL AND close_date IS NOT NULL AND open_date > close_date)
   OR (close_date IS NOT NULL AND allotment_date IS NOT NULL AND close_date > allotment_date)
   OR (allotment_date IS NOT NULL AND listing_date IS NOT NULL AND allotment_date > listing_date);

-- Price range validation
SELECT id, company_name, price_range_min, price_range_max
FROM ipos
WHERE price_range_min > price_range_max
   OR price_range_min <= 0
   OR price_range_max <= 0;

-- Positive value validation
SELECT id, company_name, issue_size, lot_size, face_value
FROM ipos
WHERE (issue_size IS NOT NULL AND issue_size::numeric <= 0)
   OR (lot_size IS NOT NULL AND lot_size <= 0)
   OR (face_value IS NOT NULL AND face_value <= 0);

-- JSONB array validation
SELECT id, company_name, listing_exchanges, lead_managers
FROM ipos
WHERE (listing_exchanges IS NULL OR jsonb_array_length(listing_exchanges) = 0)
   OR (status IN ('OPEN', 'CLOSED', 'LISTED') AND lead_managers IS NULL);

-- Future dates validation
SELECT id, company_name, open_date, close_date, listing_date
FROM ipos
WHERE open_date > CURRENT_DATE + INTERVAL '1 year'
   OR close_date > CURRENT_DATE + INTERVAL '1 year'
   OR (status = 'LISTED' AND listing_date > CURRENT_DATE);

-- Subscription multiples validation
SELECT id, company_name, subscription_retail, subscription_hni, subscription_qib, subscription_total
FROM ipos
WHERE (subscription_retail IS NOT NULL AND subscription_retail::numeric < 0)
   OR (subscription_hni IS NOT NULL AND subscription_hni::numeric < 0)
   OR (subscription_qib IS NOT NULL AND subscription_qib::numeric < 0)
   OR (subscription_total IS NOT NULL AND subscription_total::numeric < 0);
```

**Expected**: All queries return 0 rows. Any row returned is a data quality issue.

---

#### 3.4: Scraper-Specific Field Validation (Gap #9)

**NSE Scraper Responsibility Matrix:**
```sql
-- NSE should populate: subscription data, MAINBOARD IPOs, listing exchanges
SELECT
  id,
  company_name,
  category,
  listing_exchanges,
  CASE WHEN EXISTS (
    SELECT 1 FROM subscriptions WHERE ipo_id = ipos.id
  ) THEN 'YES' ELSE 'NO' END as has_subscription_data
FROM ipos
WHERE category = 'MAINBOARD'
  AND status IN ('OPEN', 'CLOSED')
  AND listing_exchanges @> '["NSE"]'::jsonb;
```

**BSE Scraper Responsibility Matrix:**
```sql
-- BSE should populate: SME IPOs, issue_size, price bands
SELECT
  id,
  company_name,
  category,
  issue_size,
  price_range_min,
  price_range_max
FROM ipos
WHERE category = 'SME'
  AND listing_exchanges @> '["BSE"]'::jsonb
  AND (issue_size IS NULL OR price_range_min IS NULL OR price_range_max IS NULL);
```

**Chittorgarh Scraper Responsibility Matrix:**
```sql
-- Chittorgarh should populate: GMP data
SELECT
  i.id,
  i.company_name,
  i.gmp_price,
  i.gmp_percentage_historical,
  COUNT(g.id) as gmp_record_count
FROM ipos i
LEFT JOIN gmp_records g ON g.ipo_id = i.id
WHERE i.status IN ('OPEN', 'CLOSED', 'LISTED')
GROUP BY i.id, i.company_name, i.gmp_price, i.gmp_percentage_historical
HAVING i.gmp_price IS NULL OR COUNT(g.id) = 0;
```

**Moneycontrol Scraper Responsibility Matrix:**
```sql
-- Moneycontrol should populate: sector, company descriptions
SELECT
  id,
  company_name,
  sector,
  company_description,
  rating
FROM ipos
WHERE sector IS NULL
   OR company_description IS NULL
   OR LENGTH(company_description) < 50;
```

**Expected**: Empty result sets indicate complete coverage. Non-empty = missing data from that scraper.

---

#### 3.5: Field-by-Source Validation (Gap #2) - CRITICAL

**Scraper Field Mapping:**

```sql
-- Create comprehensive field coverage report
WITH scraper_status AS (
  SELECT
    source,
    status,
    records_processed
  FROM scraper_logs
  WHERE created_at > (SELECT scrape_start_time FROM config)
    AND status = 'SUCCESS'
)
SELECT
  'NSE' as scraper,
  COUNT(*) FILTER (WHERE open_date IS NOT NULL) as open_date_count,
  COUNT(*) FILTER (WHERE close_date IS NOT NULL) as close_date_count,
  COUNT(*) FILTER (WHERE price_range_min IS NOT NULL) as price_min_count,
  COUNT(*) FILTER (WHERE price_range_max IS NOT NULL) as price_max_count,
  COUNT(*) FILTER (WHERE lot_size IS NOT NULL) as lot_size_count,
  COUNT(*) FILTER (WHERE sector IS NOT NULL) as sector_count,
  COUNT(*) FILTER (WHERE issue_size IS NOT NULL) as issue_size_count,
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM subscriptions WHERE ipo_id = ipos.id
  )) as subscription_count,
  COUNT(*) as total_ipos
FROM ipos
WHERE category = 'MAINBOARD'
  AND listing_exchanges @> '["NSE"]'::jsonb;

-- Repeat for BSE, Moneycontrol, Chittorgarh
```

**Validation Logic:**
If NSE scraper ran successfully (check `scraper_logs.status = 'SUCCESS' AND source = 'NSE'`):
- THEN all MAINBOARD IPOs with NSE listing MUST have: `open_date`, `close_date`, `price_range_min`, `price_range_max`, `lot_size`
- IF any field is NULL → FLAG as issue: "NSE ran successfully but field X is missing for IPO Y"

---

#### 3.6: Conflict Resolution Priority Verification (Gap #7)

```sql
-- Find dual-listed IPOs (scraped by both NSE and BSE)
WITH dual_listed AS (
  SELECT id, company_name, listing_exchanges, issue_size, sector, last_scraped_at
  FROM ipos
  WHERE listing_exchanges @> '["NSE"]'::jsonb
    AND listing_exchanges @> '["BSE"]'::jsonb
),
scraper_runs AS (
  SELECT source, created_at, status
  FROM scraper_logs
  WHERE status = 'SUCCESS'
    AND source IN ('NSE', 'BSE')
  ORDER BY created_at DESC
  LIMIT 10
)
SELECT
  dl.*,
  (SELECT string_agg(source || ':' || created_at::text, ', ')
   FROM scraper_runs) as scraper_sequence
FROM dual_listed dl;
```

**Manual Verification:**
For 3-5 dual-listed IPOs:
1. Check if NSE ran before BSE or vice versa
2. For conflicting fields (e.g., `issue_size`, `sector`), verify:
   - If NSE value != BSE value, check that NSE value is stored (higher priority)
   - Document any case where lower priority source overwrote higher priority

---

#### 3.7: Time-Series Data Validation (Gap #8)

```sql
-- Check for duplicate subscription timestamps
SELECT
  ipo_id,
  timestamp,
  COUNT(*) as duplicate_count
FROM subscriptions
GROUP BY ipo_id, timestamp
HAVING COUNT(*) > 1;

-- Check for future timestamps
SELECT
  s.id,
  i.company_name,
  s.timestamp,
  i.open_date
FROM subscriptions s
JOIN ipos i ON s.ipo_id = i.id
WHERE s.timestamp > NOW()
   OR (i.open_date IS NOT NULL AND s.timestamp < i.open_date);

-- Check for GMP record duplicates
SELECT
  ipo_id,
  timestamp,
  COUNT(*) as duplicate_count
FROM gmp_records
GROUP BY ipo_id, timestamp
HAVING COUNT(*) > 1;

-- Verify time-series ordering
SELECT
  ipo_id,
  array_agg(timestamp ORDER BY timestamp) as timestamps,
  COUNT(*) as record_count
FROM subscriptions
GROUP BY ipo_id
HAVING COUNT(*) > 1;
```

**Expected**: No duplicates, no future timestamps, no timestamps before IPO open date.

---

#### 3.8: Cache Invalidation Verification (Gap #5)

```bash
# Before checking cache
redis-cli KEYS "ipo:*" | wc -l

# Check if cache was cleared after scraping
redis-cli KEYS "ipo:slug:*" | head -10

# Test if UI fetches fresh data
curl -H "Cache-Control: no-cache" http://localhost:3000/api/ipos/test-ipo-slug

# Verify lastScrapedAt updated
psql -U postgres -d ipodhan -c "
  SELECT company_name, last_scraped_at, updated_at
  FROM ipos
  WHERE last_scraped_at > NOW() - INTERVAL '1 hour'
  ORDER BY last_scraped_at DESC
  LIMIT 10;
"
```

**Expected**:
- Redis keys cleared for updated IPOs
- `last_scraped_at` timestamp recent (within last hour)
- UI displays fresh data

---

#### 3.9: Scraper Error Log Analysis (Gap #14)

```sql
-- Analyze scraper logs by source and status
SELECT
  source,
  status,
  COUNT(*) as run_count,
  AVG(duration_ms) as avg_duration_ms,
  SUM(records_processed) as total_processed,
  SUM(records_failed) as total_failed
FROM scraper_logs
WHERE created_at > NOW() - INTERVAL '2 hours'
GROUP BY source, status
ORDER BY source, status;

-- Get error details
SELECT
  id,
  source,
  status,
  records_processed,
  records_failed,
  error_message,
  created_at
FROM scraper_logs
WHERE status IN ('FAILURE', 'PARTIAL')
  AND created_at > NOW() - INTERVAL '2 hours'
ORDER BY created_at DESC;

-- Identify patterns: same IPO failing across scrapers?
SELECT
  error_message,
  COUNT(*) as occurrence_count,
  array_agg(DISTINCT source) as affected_scrapers
FROM scraper_logs
WHERE status = 'FAILURE'
  AND created_at > NOW() - INTERVAL '2 hours'
GROUP BY error_message
ORDER BY occurrence_count DESC;
```

**Analysis Categories:**
1. **Network errors**: Timeout, connection refused, DNS failure
2. **Data validation errors**: Schema mismatch, invalid JSON, missing required fields
3. **Business logic errors**: Duplicate detection, merge conflicts
4. **External API errors**: Rate limits, API downtime, authentication failures

---

#### 3.10: Core IPO Table Field Verification

```sql
-- Comprehensive field population report
SELECT
  COUNT(*) as total_ipos,
  COUNT(company_name) as has_company_name,
  COUNT(slug) as has_slug,
  COUNT(symbol) as has_symbol,
  COUNT(isin) as has_isin,
  COUNT(category) as has_category,
  COUNT(sector) as has_sector,
  COUNT(status) as has_status,
  COUNT(issue_size) as has_issue_size,
  COUNT(price_range_min) as has_price_min,
  COUNT(price_range_max) as has_price_max,
  COUNT(lot_size) as has_lot_size,
  COUNT(face_value) as has_face_value,
  COUNT(open_date) as has_open_date,
  COUNT(close_date) as has_close_date,
  COUNT(allotment_date) as has_allotment_date,
  COUNT(listing_date) as has_listing_date,
  COUNT(listing_exchanges) as has_listing_exchanges,
  COUNT(registrar) as has_registrar,
  COUNT(lead_managers) as has_lead_managers,
  COUNT(last_scraped_at) as has_last_scraped,
  -- Historical fields
  COUNT(subscription_retail) as has_sub_retail,
  COUNT(subscription_hni) as has_sub_hni,
  COUNT(subscription_qib) as has_sub_qib,
  COUNT(gmp_price) as has_gmp_price,
  COUNT(listing_price_historical) as has_listing_price
FROM ipos;

-- Field population percentage
SELECT
  'company_name' as field,
  ROUND(100.0 * COUNT(company_name) / COUNT(*), 2) as population_pct
FROM ipos
UNION ALL
SELECT 'sector', ROUND(100.0 * COUNT(sector) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'symbol', ROUND(100.0 * COUNT(symbol) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'isin', ROUND(100.0 * COUNT(isin) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'lot_size', ROUND(100.0 * COUNT(lot_size) / COUNT(*), 2) FROM ipos
UNION ALL
SELECT 'registrar', ROUND(100.0 * COUNT(registrar) / COUNT(*), 2) FROM ipos
ORDER BY population_pct DESC;
```

---

#### 3.11: Related Tables Verification

```sql
-- Subscriptions coverage
SELECT
  i.status,
  COUNT(DISTINCT i.id) as ipo_count,
  COUNT(DISTINCT s.ipo_id) as with_subscription_data,
  ROUND(100.0 * COUNT(DISTINCT s.ipo_id) / COUNT(DISTINCT i.id), 2) as coverage_pct
FROM ipos i
LEFT JOIN subscriptions s ON s.ipo_id = i.id
WHERE i.status IN ('OPEN', 'CLOSED')
GROUP BY i.status;

-- GMP records coverage
SELECT
  i.category,
  COUNT(DISTINCT i.id) as ipo_count,
  COUNT(DISTINCT g.ipo_id) as with_gmp_data,
  ROUND(100.0 * COUNT(DISTINCT g.ipo_id) / COUNT(DISTINCT i.id), 2) as coverage_pct
FROM ipos i
LEFT JOIN gmp_records g ON g.ipo_id = i.id
WHERE i.status IN ('OPEN', 'CLOSED', 'LISTED')
GROUP BY i.category;

-- Documents coverage
SELECT
  i.category,
  COUNT(DISTINCT i.id) as ipo_count,
  COUNT(DISTINCT d.ipo_id) as with_documents,
  ROUND(100.0 * COUNT(DISTINCT d.ipo_id) / COUNT(DISTINCT i.id), 2) as coverage_pct
FROM ipos i
LEFT JOIN documents d ON d.ipo_id = i.id
GROUP BY i.category;

-- Listing performance coverage
SELECT
  COUNT(DISTINCT i.id) as listed_ipos,
  COUNT(DISTINCT lp.ipo_id) as with_listing_performance,
  ROUND(100.0 * COUNT(DISTINCT lp.ipo_id) / COUNT(DISTINCT i.id), 2) as coverage_pct
FROM ipos i
LEFT JOIN listing_performance lp ON lp.ipo_id = i.id
WHERE i.status = 'LISTED';
```

---

### Phase 3.5: API Endpoint Testing (15 minutes)
**Goal**: Verify API responses have correct structure and data

**✅ Gap #10: API Endpoint Testing**

#### Test IPO List Endpoint
```bash
# Test IPO list API
curl -s http://localhost:3000/api/ipos | jq '.' > api_test_ipos_list.json

# Verify response structure
cat api_test_ipos_list.json | jq '{
  success: .success,
  data_count: (.data | length),
  has_meta: (.meta != null),
  first_ipo_fields: (.data[0] | keys)
}'
```

**Expected Response Structure:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "companyName": "string",
      "slug": "string",
      "category": "MAINBOARD|SME",
      "status": "OPEN|UPCOMING|CLOSED|LISTED",
      "openDate": "date",
      "closeDate": "date",
      "issueSize": "number",
      "priceRangeMin": "number",
      "priceRangeMax": "number"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "hasNext": true
  }
}
```

#### Test IPO Detail Endpoint
```bash
# Get a sample IPO slug from database
SLUG=$(psql -U postgres -d ipodhan -t -c "SELECT slug FROM ipos LIMIT 1" | xargs)

# Test detail API
curl -s http://localhost:3000/api/ipos/$SLUG | jq '.' > api_test_ipo_detail.json

# Verify nested relationships
cat api_test_ipo_detail.json | jq '{
  has_ipo_data: (.data.ipo != null),
  has_financials: (.data.financials != null),
  has_subscriptions: (.data.subscriptions != null),
  has_documents: (.data.documents != null),
  has_gmp: (.data.gmpRecords != null)
}'
```

#### Test Subscription Endpoint
```bash
# Get IPO with subscriptions
IPO_ID=$(psql -U postgres -d ipodhan -t -c "
  SELECT DISTINCT ipo_id FROM subscriptions LIMIT 1
" | xargs)

# Test subscriptions API
curl -s "http://localhost:3000/api/subscriptions/$IPO_ID" | jq '.'
```

**Expected Fields:**
- `timestamp`, `qibSubscription`, `niiSubscription`, `retailSubscription`, `totalSubscription`

#### Test Filter/Search APIs
```bash
# Test category filter
curl -s "http://localhost:3000/api/ipos?category=MAINBOARD" | jq '.data | length'

# Test status filter
curl -s "http://localhost:3000/api/ipos?status=OPEN" | jq '.data | length'

# Test search
curl -s "http://localhost:3000/api/ipos?search=company" | jq '.data[0].companyName'

# Test pagination
curl -s "http://localhost:3000/api/ipos?page=2&limit=10" | jq '.meta'
```

#### API Response Validation Checklist
- [ ] All endpoints return 200 status
- [ ] Response matches expected JSON schema
- [ ] Required fields are present
- [ ] Data types are correct (string, number, date, boolean)
- [ ] Null handling is consistent
- [ ] Pagination works correctly
- [ ] Filters return correct subset
- [ ] Search returns relevant results
- [ ] Nested relationships load correctly
- [ ] Error responses have proper format (404, 500)

---

### Phase 4: Web UI Verification (60-90 minutes)
**Goal**: Verify data displays correctly across all screens with automated testing

**✅ Enhanced with Gaps #12, #13, #16, #17**

---

#### 4.1: Automated Browser Testing Setup (Gap #16)

```typescript
// playwright-tests/scraper-verification.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Post-Scrape UI Verification', () => {

  // Gap #17: Mobile testing
  test.use({ viewport: { width: 390, height: 844 } }); // iPhone 12 Pro

  test('Homepage displays scraped IPO data', async ({ page }) => {
    await page.goto('http://localhost:3000');

    // Verify IPO cards display
    const ipoCards = page.locator('[data-testid="ipo-card"]');
    await expect(ipoCards).toHaveCount({ min: 1 });

    // Verify data fields present
    await expect(ipoCards.first()).toContainText(/₹/); // Issue size
    await expect(ipoCards.first()).toContainText(/\d{2}\/\d{2}\/\d{4}/); // Dates
  });

  test('Search functionality works with scraped data', async ({ page }) => {
    // Gap #13: Search testing
    await page.goto('http://localhost:3000');

    await page.fill('[data-testid="search-input"]', 'test');
    await page.press('[data-testid="search-input"]', 'Enter');

    await page.waitForSelector('[data-testid="ipo-card"]');
    const results = page.locator('[data-testid="ipo-card"]');
    await expect(results).toHaveCount({ min: 0 }); // Should return results if "test" exists
  });

  test('Filter by status works', async ({ page }) => {
    // Gap #13: Filter testing
    await page.goto('http://localhost:3000/mainboard-ipos');

    await page.click('[data-testid="filter-status"]');
    await page.click('text=OPEN');

    await page.waitForLoadState('networkidle');
    const cards = page.locator('[data-testid="ipo-card"]');

    // All cards should have OPEN status
    const statusBadges = page.locator('[data-testid="status-badge"]:has-text("OPEN")');
    const cardCount = await cards.count();
    const openBadgeCount = await statusBadges.count();

    expect(openBadgeCount).toBe(cardCount);
  });

  test('Data consistency across screens', async ({ page }) => {
    // Gap #12: Cross-screen consistency
    await page.goto('http://localhost:3000');

    // Get IPO data from homepage
    const homepageCard = page.locator('[data-testid="ipo-card"]').first();
    const companyName = await homepageCard.locator('[data-testid="company-name"]').textContent();
    const issueSize = await homepageCard.locator('[data-testid="issue-size"]').textContent();

    // Navigate to detail page
    await homepageCard.click();
    await page.waitForLoadState('networkidle');

    // Verify same data on detail page
    await expect(page.locator('h1')).toContainText(companyName || '');
    await expect(page.locator('[data-testid="issue-size-detail"]')).toContainText(issueSize || '');
  });

  test('Pagination works correctly', async ({ page }) => {
    // Gap #13: Pagination testing
    await page.goto('http://localhost:3000/mainboard-ipos');

    // Check total count
    const totalText = await page.locator('[data-testid="total-count"]').textContent();
    const total = parseInt(totalText?.match(/\d+/)?.[0] || '0');

    // Navigate to page 2
    await page.click('[data-testid="pagination-next"]');
    await page.waitForLoadState('networkidle');

    // Verify URL changed
    expect(page.url()).toContain('page=2');

    // Verify different IPOs displayed
    const page2Cards = page.locator('[data-testid="ipo-card"]');
    await expect(page2Cards).toHaveCount({ min: 1 });
  });

  test('Sort functionality works', async ({ page }) => {
    // Gap #13: Sort testing
    await page.goto('http://localhost:3000/mainboard-ipos');

    // Sort by issue size descending
    await page.click('[data-testid="sort-issue-size"]');
    await page.waitForLoadState('networkidle');

    // Get first two issue sizes
    const sizes = await page.locator('[data-testid="issue-size"]').allTextContents();
    const numericSizes = sizes.map(s => parseFloat(s.replace(/[^0-9.]/g, '')));

    // Verify descending order
    expect(numericSizes[0]).toBeGreaterThanOrEqual(numericSizes[1]);
  });
});
```

**Run automated tests:**
```bash
cd web
npx playwright test playwright-tests/scraper-verification.spec.ts
```

---

#### 4.2: Manual UI Verification Checklist

**A. Homepage (/) - Desktop & Mobile**
- [ ] IPO 2025 List (MAINBOARD) displays with data
- [ ] SME IPO 2025 List displays with data
- [ ] Upcoming Mainboard IPOs section populated
- [ ] Upcoming SME IPOs section populated
- [ ] Data fields visible: companyName, openDate, closeDate
- [ ] Mobile responsive layout works
- [ ] Images/logos load correctly

**B. Category Pages**
- [ ] **Mainboard IPOs** (`/mainboard-ipos`)
  - [ ] Summary metrics show correct counts
  - [ ] Detailed IPO listings table has 8 columns
  - [ ] Data populates all columns
- [ ] **SME IPOs** (`/sme-ipos`)
  - [ ] Summary metrics show correct counts
  - [ ] Detailed IPO listings table has 8 columns
  - [ ] Data populates all columns

**C. Individual IPO Detail Pages** (`/ipos/[slug]`)

Select 3-5 IPOs (1 UPCOMING, 2 OPEN, 1 CLOSED, 1 LISTED) and verify:

**Header Section:**
- [ ] Company name displays correctly
- [ ] Status badge shows correct status (OPEN/UPCOMING/CLOSED/LISTED)
- [ ] Category badge shows MAINBOARD or SME
- [ ] Sector displays
- [ ] IPODhan Rating displays (if available)

**Key Metrics Cards:**
- [ ] Issue Size shows with ₹ symbol
- [ ] Subscription multiple displays (for OPEN IPOs)
- [ ] GMP displays with ± sign
- [ ] GMP percentage displays

**IPO Details Section:**
- [ ] Open Date formatted correctly
- [ ] Close Date formatted correctly
- [ ] Allotment Date displays (if available)
- [ ] Listing Date displays (if available)
- [ ] Price Range shows "₹X - ₹Y"
- [ ] Face Value displays
- [ ] Lot Size displays
- [ ] Listing Exchanges show as badges (NSE/BSE)
- [ ] Registrar name displays
- [ ] Lead Managers show as list

**Listing Performance (LISTED IPOs only):**
- [ ] Issue Price displays
- [ ] Listing Price displays
- [ ] Listing Day Return % shows with color coding
- [ ] Current Price displays
- [ ] Overall Return % shows with color coding

**Financials Tab:**
- [ ] Revenue FY data shows for 3 years
- [ ] Profit FY data shows for 3 years
- [ ] EPS displays
- [ ] P/E Ratio displays
- [ ] ROE % displays
- [ ] Debt to Equity displays
- [ ] Table/chart renders correctly

**Subscription Tab (OPEN IPOs):**
- [ ] Total Subscription shows
- [ ] QIB breakdown displays
- [ ] NII breakdown displays
- [ ] Retail breakdown displays
- [ ] Progress bars render correctly
- [ ] Total Applications count shows
- [ ] Shares Bid count shows

**GMP Tab:**
- [ ] Latest GMP displays prominently
- [ ] Expected Listing Price shows
- [ ] 7-day GMP chart renders
- [ ] Chart has data points
- [ ] GMP Updated At timestamp displays

**Documents Tab:**
- [ ] Document table displays
- [ ] Document Title column populated
- [ ] Document Type shows (DRHP/RHP/PROSPECTUS)
- [ ] File Size displays
- [ ] Upload Date shows
- [ ] Download button/link works

**Company Overview Tab:**
- [ ] Business Model description displays
- [ ] Text is formatted and readable
- [ ] No HTML tags visible

---

**D. Performance Trackers**
- [ ] **Mainboard Performance Tracker** (`/mainboard-ipo-performance-tracker`)
  - [ ] Table displays with data
  - [ ] Listing Date, Issue Price, Listing Price columns populate
  - [ ] Gain/Loss % shows with color coding
  - [ ] Current Price displays
- [ ] **SME Performance Tracker** (`/sme-ipo-performance-tracker`)
  - [ ] Table displays with data
  - [ ] All columns populate correctly

---

**E. Calendar Pages**
- [ ] **Mainboard Calendar** (`/mainboard-ipo-calendar`)
  - [ ] Calendar renders
  - [ ] IPO events display on correct dates
  - [ ] Open date events visible
  - [ ] Close date events visible
  - [ ] Listing date events visible
- [ ] **SME Calendar** (`/sme-ipo-calendar`)
  - [ ] Calendar renders with SME IPO events

---

**F. Listings Pages (19-column tables)**
- [ ] **Mainboard Listings** (`/mainboard-ipo-listings`)
  - [ ] All 19 columns display
  - [ ] Data populates each column
  - [ ] Sort functionality works
  - [ ] Horizontal scroll works (if needed)
- [ ] **SME Listings** (`/sme-ipo-listings`)
  - [ ] All 19 columns display
  - [ ] Data populates correctly
- [ ] **FPO Listings** (`/fpo-listings`)
  - [ ] Table displays with FPO data

---

**G. Other Pages**
- [ ] **Dashboard** (`/dashboard`)
  - [ ] Grid view displays IPO cards
  - [ ] Filters work (category, status)
  - [ ] Search works
  - [ ] Pagination works
- [ ] **Market Holidays** (`/market-holidays`)
  - [ ] Holiday cards display
  - [ ] Dates show correctly
- [ ] **Registrars** (`/registrars`)
  - [ ] Registrar list displays
  - [ ] Contact information shows
- [ ] **Lot Calculator** (`/tools/lot-calculator`)
  - [ ] IPO dropdown populated with scraped IPOs
  - [ ] Calculation works with scraped data
- [ ] **Compare IPOs** (`/tools/compare`)
  - [ ] Can select up to 3 scraped IPOs
  - [ ] Comparison table displays all metrics

---

#### 4.3: Cross-Screen Data Consistency Testing (Gap #12)

**Manual Test Protocol:**

Pick 2-3 IPOs and verify identical data across screens:

**Test IPO #1: [Company Name]**

| Field | Homepage | Category Page | Detail Page | Dashboard | Matches? |
|-------|----------|---------------|-------------|-----------|----------|
| Company Name | ? | ? | ? | ? | ✅/❌ |
| Open Date | ? | ? | ? | ? | ✅/❌ |
| Close Date | ? | ? | ? | ? | ✅/❌ |
| Issue Size | ? | ? | ? | ? | ✅/❌ |
| Price Range | ? | ? | ? | ? | ✅/❌ |
| Status | ? | ? | ? | ? | ✅/❌ |
| Category | ? | ? | ? | ? | ✅/❌ |

**Expected**: All fields match across all screens. Any mismatch = cache/query inconsistency issue.

---

#### 4.4: Mobile/Responsive Testing (Gap #17)

**Test on multiple viewports:**

```bash
# Run Playwright tests on different devices
npx playwright test --project="Mobile Chrome" --project="Mobile Safari"
```

**Manual Mobile Testing:**
- [ ] iPhone 12 Pro (390x844)
  - [ ] Homepage layout adapts
  - [ ] IPO cards stack vertically
  - [ ] Navigation menu works
  - [ ] Touch interactions work
- [ ] iPad Air (820x1180)
  - [ ] Table layouts scroll horizontally
  - [ ] Touch gestures work
- [ ] Android (360x640)
  - [ ] All content accessible
  - [ ] No horizontal overflow

---

#### 4.5: Edge Case Testing (Gap #18)

**Scenario 1: IPO Status Changes During Testing**
- [ ] Navigate to OPEN IPO detail page
- [ ] Manually update status to CLOSED in database
- [ ] Refresh page
- [ ] Verify UI updates correctly

**Scenario 2: Dual-Listed IPO Display**
- [ ] Find IPO with `listing_exchanges: ["NSE", "BSE"]`
- [ ] Verify both exchange badges display
- [ ] Check no data duplication

**Scenario 3: Missing Optional Fields**
- [ ] Find IPO with null `sector`
- [ ] Verify page doesn't crash
- [ ] Check "N/A" or empty state displays

**Scenario 4: Very Long Company Names**
- [ ] Find IPO with 50+ character name
- [ ] Verify text truncates with ellipsis
- [ ] Check tooltip shows full name

**Scenario 5: Zero/Negative Values**
- [ ] Test with IPO having subscription = 0
- [ ] Verify displays "0x" not blank
- [ ] Check no division by zero errors

---

### Phase 5: Comprehensive Issue Documentation (20 minutes)
**Goal**: Create prioritized issue list for fixing

**✅ Enhanced with Gap #14: Error Log Analysis**

#### 5.1: Collect Issues from All Phases

**Template:**
```markdown
## Issue #X: [Brief Description]

**Severity**: Critical / High / Medium / Low
**Category**: Scraper / Database / UI / Performance / Cache / API
**Phase Detected**: Phase X
**Location**: [File path or screen or query]

**Expected Behavior**:
[What should happen]

**Actual Behavior**:
[What actually happens]

**Steps to Reproduce**:
1. Step 1
2. Step 2
3. Step 3

**Root Cause** (if known):
[Technical explanation]

**Recommendation**:
[How to fix - be specific]

**Affected Records**:
- IPO IDs: [list]
- Count: X

**Priority**: P0 / P1 / P2 / P3
```

---

#### 5.2: Issue Categorization

**Critical Issues (P0) - Fix Immediately:**
- Scraper crashes/failures
- Data corruption
- Duplicate IPO records
- Application crashes
- API endpoints returning 500 errors

**High Priority (P1) - Fix Before Production:**
- Missing data for key fields where source has data
- Broken UI components
- Cache not invalidating
- Data quality violations (negative values, wrong dates)
- Conflict resolution not working

**Medium Priority (P2) - Fix This Sprint:**
- Incomplete data for optional fields
- Minor UI issues (formatting, alignment)
- Performance issues (slow queries)
- Missing mobile responsiveness

**Low Priority (P3) - Backlog:**
- Cosmetic issues
- Optimization opportunities
- Nice-to-have features
- Documentation gaps

---

#### 5.3: Generate Issue Summary Report

```sql
-- Create issues summary table
CREATE TEMP TABLE issue_summary AS
SELECT
  'Duplicate IPOs' as issue_type,
  COUNT(*) as count,
  'P0' as priority
FROM (
  SELECT company_name FROM ipos GROUP BY company_name HAVING COUNT(*) > 1
) duplicates

UNION ALL

SELECT
  'Data Quality Violations' as issue_type,
  COUNT(*) as count,
  'P1' as priority
FROM ipos
WHERE (price_range_min > price_range_max)
   OR (open_date > close_date)
   OR (issue_size::numeric <= 0)

UNION ALL

SELECT
  'Missing Critical Fields' as issue_type,
  COUNT(*) as count,
  'P1' as priority
FROM ipos
WHERE status IN ('OPEN', 'CLOSED')
  AND (open_date IS NULL OR close_date IS NULL OR issue_size IS NULL)

UNION ALL

SELECT
  'Scraper Failures' as issue_type,
  COUNT(*) as count,
  'P0' as priority
FROM scraper_logs
WHERE status = 'FAILURE'
  AND created_at > NOW() - INTERVAL '2 hours';

-- Display summary
SELECT * FROM issue_summary ORDER BY priority, count DESC;
```

---

#### 5.4: Performance Analysis Report

```sql
-- Scraper performance metrics
SELECT
  source,
  AVG(duration_ms) as avg_duration_ms,
  MIN(duration_ms) as min_duration_ms,
  MAX(duration_ms) as max_duration_ms,
  AVG(records_processed) as avg_records_processed
FROM scraper_logs
WHERE created_at > NOW() - INTERVAL '2 hours'
GROUP BY source
ORDER BY avg_duration_ms DESC;

-- Database query performance (from pg_stat_statements if enabled)
SELECT
  query,
  calls,
  total_time,
  mean_time,
  max_time
FROM pg_stat_statements
WHERE query LIKE '%ipos%'
ORDER BY mean_time DESC
LIMIT 10;
```

---

#### 5.5: Final Issue Report Document

Create `scraper-test-issues-YYYYMMDD.md`:

```markdown
# Scraper Test Issues Report
**Date**: 2025-XX-XX
**Scraper Run**: All (NSE, BSE, Moneycontrol, Chittorgarh, API Fallback)
**Test Duration**: XX minutes

## Executive Summary
- Total Issues Found: XX
- Critical (P0): X
- High Priority (P1): X
- Medium Priority (P2): X
- Low Priority (P3): X

## Scraper Execution Summary
| Scraper | Status | Duration | IPOs Processed | Inserted | Updated | Errors |
|---------|--------|----------|----------------|----------|---------|--------|
| NSE | ✅/❌ | Xs | X | X | X | X |
| BSE | ✅/❌ | Xs | X | X | X | X |
| Moneycontrol | ✅/❌ | Xs | X | X | X | X |
| Chittorgarh | ✅/❌ | Xs | X | X | X | X |
| API Fallback | ✅/❌ | Xs | X | X | X | X |

## Database Coverage
- Total IPOs: XXX
- With Subscriptions: XX%
- With GMP Data: XX%
- With Documents: XX%
- With Financials: XX%

## Critical Issues (P0)
[List all P0 issues]

## High Priority Issues (P1)
[List all P1 issues]

## Medium Priority Issues (P2)
[List all P2 issues]

## Low Priority Issues (P3)
[List all P3 issues]

## Recommendations
1. [Top recommendation]
2. [Second recommendation]
3. [Third recommendation]

## Next Steps
1. [Action item 1]
2. [Action item 2]
3. [Action item 3]
```

---

### Phase 6: Issue Resolution (Variable Time)
**Goal**: Fix all documented issues systematically

**Note**: This phase executes after user approval of Phase 5 issues.

#### 6.1: Review and Prioritize

1. **Review issue list with user**
   - Go through each P0 and P1 issue
   - Confirm priorities
   - Discuss fix approach

2. **Create fix order**
   - P0 issues first (blockers)
   - P1 issues second (critical for release)
   - P2 issues if time permits
   - P3 issues added to backlog

---

#### 6.2: Fix Issues One by One

**For each issue:**

1. **Diagnose Root Cause**
   - Reproduce the issue
   - Identify exact failure point
   - Understand why it happened

2. **Implement Fix**
   - Code the solution
   - Add tests if missing
   - Update documentation

3. **Test Fix**
   - Unit test the fix
   - Integration test the fix
   - Verify issue is resolved

4. **Re-run Affected Scraper** (if needed)
   ```bash
   cd scraper
   npm run start:nse  # Or whichever scraper needs re-run
   ```

5. **Verify in Database**
   ```sql
   -- Check fix applied correctly
   SELECT * FROM ipos WHERE id = 'affected-ipo-id';
   ```

6. **Verify in UI**
   - Navigate to affected screen
   - Confirm data displays correctly
   - Test any affected features

7. **Mark Issue as Resolved**
   - Update issue status
   - Document the fix
   - Commit changes

---

#### 6.3: Regression Testing

After fixing all P0/P1 issues:

1. **Re-run Phase 2**: Execute all scrapers again
2. **Re-run Phase 3**: Verify database validations pass
3. **Re-run Phase 3.5**: Test APIs still work
4. **Re-run Phase 4**: Verify UI still displays correctly
5. **Confirm zero new issues introduced**

---

#### 6.4: Final Validation

```bash
# Run all automated tests
cd web
npm run test
npm run test:integration
npx playwright test

# Verify no errors
echo "All tests passed!"
```

**Final Checklist:**
- [ ] All P0 issues resolved
- [ ] All P1 issues resolved
- [ ] Automated tests pass
- [ ] Manual smoke test pass
- [ ] No new issues introduced
- [ ] Documentation updated
- [ ] Changes committed to git

---

## Services Required

**Will start automatically if not running**:
- PostgreSQL database (port 5432)
- Redis cache (port 6379)
- Next.js dev server (http://localhost:3000)

**Will run manually**:
- Scraper service (npm run start:all)
- Playwright browsers (npx playwright install)
- Database backup/restore

**Optional**:
- PostgreSQL admin tools (pgAdmin, DBeaver)
- Redis admin tools (Redis Commander)

---

## Expected Outcomes

### Success Criteria
✅ All 5 scrapers execute without crashes
✅ Data populates all applicable database fields (100+ fields across 16 tables)
✅ No critical null fields where source data exists (Gap #2)
✅ No duplicate IPO records (Gap #3)
✅ All data quality validations pass (Gap #4)
✅ Cache invalidation working (Gap #5)
✅ Conflict resolution priority verified (Gap #7)
✅ Time-series data valid (Gap #8)
✅ UI displays data correctly across 26+ screens
✅ API endpoints return correct schemas (Gap #10)
✅ Cross-screen data consistency verified (Gap #12)
✅ Search/filter/sort/pagination working (Gap #13)
✅ Mobile responsive layouts working (Gap #17)
✅ All identified issues documented with severity
✅ Zero data corruption
✅ Performance metrics within acceptable ranges (Gap #15)

### Estimated Timeline
- **Phase 0**: 10 minutes (Database backup)
- **Phase 1**: 5 minutes (Pre-scraping checks)
- **Phase 2**: 15-30 minutes (Run scrapers with metrics)
- **Phase 3**: 45-60 minutes (Comprehensive database verification)
- **Phase 3.5**: 15 minutes (API endpoint testing)
- **Phase 4**: 60-90 minutes (UI verification with automation)
- **Phase 5**: 20 minutes (Issue documentation)
- **Phase 6**: Variable (Issue resolution)
- **Total Initial Test**: ~3-4 hours for comprehensive verification

---

## Validation Gaps Addressed

This enhanced plan addresses all 18 identified gaps:

**Critical Gaps (✅ All Addressed):**
1. ✅ Gap #1: Following codebase logic (scraper counters tracked)
2. ✅ Gap #2: Comprehensive field-by-source validation (Section 3.5)
3. ✅ Gap #3: Duplicate detection (Section 3.2)
4. ✅ Gap #4: Data quality validation rules (Section 3.3)
5. ✅ Gap #5: Cache invalidation verification (Section 3.8)
6. ✅ Gap #6: Specific SQL queries provided (Throughout Phase 3)
7. ✅ Gap #7: Conflict resolution priority verification (Section 3.6)

**Important Gaps (✅ All Addressed):**
8. ✅ Gap #8: Time-series data validation (Section 3.7)
9. ✅ Gap #9: Per-scraper field validation (Section 3.4)
10. ✅ Gap #10: API endpoint testing (Phase 3.5)
11. ✅ Gap #11: Database backup (Phase 0)
12. ✅ Gap #12: Cross-screen data consistency (Section 4.3)
13. ✅ Gap #13: UI feature testing (Section 4.2, 4.1)
14. ✅ Gap #14: Error log analysis (Section 3.9, 5.4)

**Nice-to-Have Gaps (✅ All Addressed):**
15. ✅ Gap #15: Performance metrics tracking (Phase 2, 5.4)
16. ✅ Gap #16: Browser automation (Section 4.1)
17. ✅ Gap #17: Mobile/responsive testing (Section 4.4)
18. ✅ Gap #18: Edge case scenarios (Section 4.5)

---

## Rollback Plan

If critical issues found during testing:

```bash
# Restore from backup
psql -h localhost -U postgres -d ipodhan < backup_pre_scrape_YYYYMMDD_HHMMSS.sql

# Verify restoration
psql -U postgres -d ipodhan -c "SELECT COUNT(*) FROM ipos;"

# Clear Redis cache
redis-cli FLUSHALL

# Restart web server
cd web && npm run dev
```

---

## Appendix: Quick Reference

### Important SQL Queries
```sql
-- Quick health check
SELECT
  (SELECT COUNT(*) FROM ipos) as total_ipos,
  (SELECT COUNT(*) FROM ipos WHERE last_scraped_at > NOW() - INTERVAL '1 hour') as recently_scraped,
  (SELECT COUNT(DISTINCT source) FROM scraper_logs WHERE status = 'SUCCESS' AND created_at > NOW() - INTERVAL '1 hour') as successful_scrapers;

-- Find IPOs with missing data
SELECT id, company_name,
  CASE WHEN open_date IS NULL THEN 'missing open_date' END,
  CASE WHEN close_date IS NULL THEN 'missing close_date' END,
  CASE WHEN issue_size IS NULL THEN 'missing issue_size' END
FROM ipos
WHERE open_date IS NULL OR close_date IS NULL OR issue_size IS NULL;
```

### Important Redis Commands
```bash
# Check cache keys
redis-cli KEYS "ipo:*"

# Clear specific pattern
redis-cli --scan --pattern "ipo:slug:*" | xargs redis-cli DEL

# Monitor cache hits
redis-cli MONITOR
```

### Important Browser URLs
- Homepage: http://localhost:3000
- API Health: http://localhost:3000/api/health
- DB Test: http://localhost:3000/api/db-test
- IPO List API: http://localhost:3000/api/ipos
- Sample Detail: http://localhost:3000/ipos/[any-slug]

---

## Next Steps

1. ✅ Review this enhanced plan
2. ✅ Approve to proceed with execution
3. ⏳ Execute Phase 0-5 systematically
4. ⏳ Review documented issues together
5. ⏳ Prioritize and fix issues in Phase 6
6. ⏳ Final validation and sign-off

**Ready to execute upon approval!**
