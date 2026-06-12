# Phase 1: Data Quality & Scraping Validation

**[← Back to Index](README.md)** | **[Overview](00-TESTING-OVERVIEW.md)** | **[SQL Queries](APPENDIX-B-SQL-QUERIES.md)**

---

## Phase Overview

**Estimated Time:** 3-5 days
**Focus:** Database integrity, scraper health, field coverage, repository pattern validation
**Prerequisites:** VPS database connection verified

**Key Objectives:**
- Validate 16 database tables exist and are populated
- Verify scraper health (100% success rate, 0 consecutive failures)
- Analyze field coverage (Critical: 100%, Important: >90%, Enhanced: >70%)
- Validate Repository Pattern & Cache-Aside implementation (Enhancement #13)
- Test new data enhancements (IPO Scoring, Peer Comparison, Issue Details, etc.)

**Testing Approach:** 4 iterations with auto-improvement loop

---

## ⚠️ MANDATORY PRE-REQUISITE: VPS Database Connection Verified

**Before starting Phase 1, you MUST complete these checks:**

```bash
# 1. Navigate to web directory
cd web

# 2. Verify VPS database connection
node scripts/check-tables-exist.js
# Expected: Connected to: 103.118.16.189:5432/ipodhan
# Expected: All tables show ✓

# 3. Verify data exists in VPS database
node scripts/check-db-data.js
# Expected: Shows actual record counts (NOT "ERROR")

# 4. If either fails → STOP and fix connection (see 00-TESTING-OVERVIEW.md)
```

**✅ Only proceed after seeing:**
- ✅ Connected to VPS server `103.118.16.189:5432/ipodhan`
- ✅ All tables exist
- ✅ Record counts displayed (not errors)

---

## 📚 Architecture References for Phase 1

Before starting Phase 1, review these documents:
- **Scraper Implementation**: `scraper/README.md`
- **Scraping Strategy**: `scraper/docs/SCRAPING_STRATEGY.md`
- **Database Schema**: `packages/shared/src/db/schema.ts`
- **Schema Management**: `docs/16-database/SCHEMA_MANAGEMENT.md`
- **Backend Architecture**: `docs/02-architecture/backend-architecture.md` (for Repository Pattern)
- **Caching Strategy**: `docs/05-caching/CACHING_STRATEGY.md` (for Cache-Aside pattern)

These provide context for data sources, scraper behavior, and expected data structure.

---

## Phase 1 Testing Loop

**Base Loop:** Test ALL → Document → Fix ALL → Re-test → Verify → Gate

### 🔄 ENHANCED LOOP WITH AUTO-IMPROVEMENT:

```
ITERATION N:
1. Execute all tests in current iteration
2. For EACH issue found:
   a. Classify issue type
   b. Perform root cause analysis
   c. Generate related tests (3-5 new tests per issue)
   d. Add to TEST_ISSUES.json with new tests
   e. Update TEST_PROGRESS.md
   f. Add new tests to NEXT iteration
3. Fix all issues
4. ITERATION N+1:
   - Include all new tests generated from issues
   - Re-test fixed issues
   - May discover MORE issues → generates MORE tests
5. Repeat until NO NEW ISSUES found
6. Final validation
7. Gate check
```

---

## ITERATION 1: Initial Scraping + Issue Discovery

### Test 1: Database Schema Verification (VPS PostgreSQL)

**⚠️ CRITICAL: All queries MUST execute against VPS database `103.118.16.189:5432/ipodhan`**

```bash
# Verify you're connected to VPS database (NOT local)
node scripts/check-tables-exist.js
# Output MUST show: Connected to: 103.118.16.189:5432/ipodhan
```

**Check all tables exist per `packages/shared/src/db/schema.ts`:**

Using `psql` or database query tool connected to VPS:
```bash
# Option 1: Use psql directly
PGPASSWORD="<db-password>" psql -h 103.118.16.189 -p 5432 -U postgres -d ipodhan -c "\dt"

# Option 2: Use the provided script (ensures VPS connection)
node scripts/check-tables-exist.js
```

**Expected tables (16 total from schema):**
- Core: ipos, ipo_details, ipo_financials, ipo_reviews, ipo_scores
- Supporting: market_holidays, registrars, documents
- GMP & Subscription: gmp_history, gmp_records, gmp_tracking, subscription_data, subscriptions
- Performance: listing_performance, peer_companies, financial_data
- System: broker_affiliates, scraper_logs

**Verify indexes and foreign keys:**
```sql
-- Run against VPS database
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

**Document any missing tables or indexes in TEST_ISSUES.json**

---

### Test 2: Run All Scrapers

```bash
npm run scrape:historical
npm run scrape:historical:incremental
# Market holidays, reviews, prospectus scrapers
```

---

### Test 3: ✅ ENHANCEMENT #1: Scraper Health Monitoring

```sql
-- Check scraper_logs for SUCCESS status
SELECT source, status, records_processed, records_failed, duration_ms, error_message
FROM scraper_logs
ORDER BY created_at DESC
LIMIT 50;

-- Check pipeline_status health (if table exists)
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

**🔄 AUTO-IMPROVEMENT TRIGGER:**
```
IF any scraper shows status != 'SUCCESS':
  CLASSIFY: Scraper Failure
  ROOT CAUSE: Investigate error_message, error_stack

  GENERATE TESTS:
  - [ ] Test scraper with sample HTML from source
  - [ ] Verify source website is accessible
  - [ ] Check if HTML structure changed (compare with baseline)
  - [ ] Test scraper error handling
  - [ ] Verify scraper logs errors properly
  - [ ] Check rate limiting not causing failures
  - [ ] Test scraper retry logic

  ADD TO: Iteration 2 test suite
  UPDATE: TEST_ISSUES.json with issue #ISS-XXX
```

**Success Criteria:**
- ✅ All scrapers show SUCCESS
- ✅ consecutiveFailures = 0
- ✅ lastSuccessAt within 24 hours
- ✅ recordsProcessed > 0

---

### Test 4: ✅ ENHANCEMENT #2: Fuzzy Matching Quality Tests

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
  NULLIF((SELECT COUNT(*) FROM ipo_reviews), 0) as review_match_rate,
  (SELECT COUNT(*) FROM documents WHERE ipo_id IS NOT NULL) * 100.0 /
  NULLIF((SELECT COUNT(*) FROM documents), 0) as document_match_rate;
```

**⚠️ Reviews Limitation**: No centralized reviews API discovered.
- Reviews are per-IPO embedded content only
- Expect **significantly lower review coverage** (<50% of IPOs may have reviews)
- Adjust fuzzy matching expectations accordingly
- Skip testing for "centralized reviews list" functionality
- Focus testing on per-IPO review display only

**Success Criteria:**
- ✅ >90% of reviews matched to IPOs (adjust based on data availability)
- ✅ >90% of documents matched to IPOs
- ✅ No false positives (wrong IPO matched)
- ✅ Manual verification of 10 sample IPOs

---

### Test 5: ✅ ENHANCEMENT #3: Data Source Change Detection

- Save baseline HTML snapshots from NSE, BSE, Chittorgarh (one-time)
- Before each scrape, validate source structure
- Compare CSS selectors still valid
- Calculate structure similarity percentage
- Alert if <70% similarity

**Baseline Files:**
```
test-results/phase-1/baselines/
├── nse-holiday-calendar-baseline.html
├── bse-holiday-calendar-baseline.html
├── chittorgarh-reviews-baseline.html
├── nse-prospectus-baseline.html
└── bse-prospectus-baseline.html
```

---

### Test 6: ✅ ENHANCEMENT #4: Incremental Scraping Tests

```bash
# Run scrapers twice
npm run scrape:historical
# Note counts
npm run scrape:historical:incremental
# Verify no duplicates
```

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

**Success Criteria:**
- ✅ Zero duplicates
- ✅ updated_at reflects re-scraping
- ✅ No data loss on existing records
- ✅ New records properly inserted
- ✅ Changed records properly updated

---

### Test 7: Data Population Verification

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

## ITERATION 2: Data Quality & Coverage Analysis

### Test 8: Field Coverage Analysis

- For each table, check NULL counts for all fields
- Generate SCRAPING_COVERAGE_REPORT.md
- Calculate coverage percentage per field
- Identify critical gaps (fields with <70% coverage)

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
-- ... repeat for all fields
ORDER BY coverage_percent ASC;
```

*For complete SQL queries, see [APPENDIX-B-SQL-QUERIES.md](APPENDIX-B-SQL-QUERIES.md)*

---

### Test 9: ✅ ENHANCEMENT #5: GMP & Subscription Data Tests

**✅ Implementation Status**: GMP scraper fully operational as of 2025-10-13
- Location: `lib/scrapers/sources/gmp-api-scraper.ts` (501 lines)
- Test Results: 98.5% success rate (64/65 IPOs scraped successfully)
- Status: **Production-ready**, pending database integration
- Data Source: InvestorGain API (`webnodejs.investorgain.com`)

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
```

**Success Criteria:**
- ✅ All OPEN IPOs have GMP data updated within 24 hours
- ✅ Each IPO has GMP from 2+ sources (where available)
- ✅ Time-series data exists (multiple records per IPO)
- ✅ All subscription categories populated for OPEN IPOs
- ✅ API endpoints return accurate, fresh data

---

### Test 10: ✅ ENHANCEMENT #6: Historical Data Completeness Tests

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
```

**Success Criteria:**
- ✅ 100% of LISTED IPOs have listing_performance record
- ✅ All required fields populated
- ✅ Current prices updated within 7 days
- ✅ Historical data spans 2020-2025
- ✅ >95% coverage for each year
- ✅ Both BSE and NSE prices for dual-listed IPOs
- ✅ Calculated metrics are accurate

---

### Test 11: ✅ ENHANCEMENT #7: IPO Scoring System Validation (CRITICAL)

**Table**: `ipo_scores` (12 fields from `packages/shared/src/db/schema.ts`)

```sql
-- Verify ipo_scores table exists and has data
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
```

**Success Criteria:**
- ✅ All OPEN/UPCOMING IPOs have scores
- ✅ Score math correct: fundamental + sentiment + subscription + sector = total
- ✅ Verdict matches score range (BUY: ≥75, HOLD: 50-74, AVOID: <50)
- ✅ Confidence levels are HIGH/MEDIUM/LOW
- ✅ Algorithm version tracked
- ✅ Scores calculated within last 48 hours for OPEN IPOs

---

### Test 12: ✅ ENHANCEMENT #8: Peer Comparison Data Validation (CRITICAL)

**Table**: `peer_companies` (13 fields)

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
```

**Success Criteria:**
- ✅ All IPOs have at least 3 peer companies
- ✅ Peers are in same sector as IPO
- ✅ Financial metrics >80% populated (PE, EPS, ROE, RONW, PB)
- ✅ Listed vs unlisted classification accurate
- ✅ Data updated within last 90 days

---

### Test 13: ✅ ENHANCEMENT #9: Issue Structure Details Validation (CRITICAL)

**Table**: `ipo_details` (16 fields)

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
```

**Success Criteria:**
- ✅ All IPOs have ipo_details records
- ✅ issueType is FRESH/OFS/COMBINATION
- ✅ freshIssue + ofsIssue = issue_size (within ₹1 crore)
- ✅ cutOffPrice populated for OPEN IPOs
- ✅ issueBreakdown JSON has QIB/NII/Retail keys
- ✅ Minimum application amount calculated correctly

---

### Test 14: ✅ ENHANCEMENT #10: Enhanced Financial Metrics Validation (IMPORTANT)

**Table**: `ipo_financials` (vs `financial_data` - need to clarify)

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
```

**Success Criteria:**
- ✅ Clarify: Is ipo_financials canonical or financial_data?
- ✅ >80% of IPOs have financial records
- ✅ Enhanced metrics populated (netWorth, borrowings, ratios)
- ✅ FY1, FY2, FY3 data present
- ✅ Financial progression logical (revenue trends make sense)

---

### Test 15: ✅ ENHANCEMENT #11: Registrar Directory Completeness (IMPORTANT)

**Table**: `registrars`

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
```

**Success Criteria:**
- ✅ All major registrars present (KFin, Link Intime, Bigshare, etc.)
- ✅ All OPEN/UPCOMING IPOs have registrar assigned
- ✅ Contact info >90% complete (name, website, email, phone)
- ✅ Email format validation passes
- ✅ Website URLs are valid

---

### Test 16: ✅ ENHANCEMENT #12: Broker Affiliates & Click Tracking (IMPORTANT - Revenue)

**Tables**: `broker_affiliates`, `affiliate_clicks`

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
```

**Success Criteria:**
- ✅ At least 5 active brokers configured (Zerodha, AngelOne, Groww, Upstox, ICICI)
- ✅ All brokers have valid affiliate URLs
- ✅ Display order is sequential (1, 2, 3, ...)
- ✅ Click tracking table has records
- ✅ Clicks distributed across multiple brokers
- ✅ Recent clicks (within last 7 days) for OPEN IPOs

---

## ITERATION 3: Enhancement #13 - Repository Pattern & Cache-Aside Validation

**⚠️ CRITICAL ARCHITECTURAL VALIDATION**

**Status:** Pending
**Priority:** High
**Estimated Time:** 2-3 hours

### Objective

Validate that all repositories follow the BaseRepository pattern with proper cache-aside implementation. This ensures:
- Consistent data access patterns across the application
- Proper cache-aside pattern implementation (cache HIT/MISS scenarios)
- Cache invalidation after mutations (INSERT/UPDATE/DELETE)
- Graceful degradation when Redis is unavailable
- Query logging for monitoring and debugging

### Prerequisites

1. Development environment running (Next.js dev server)
2. PostgreSQL database accessible
3. Redis server running and accessible
4. Redis CLI available for monitoring
5. Familiarity with cache-aside pattern implementation

### Reference Documents

- `docs/02-architecture/backend-architecture.md` (Repository Pattern section)
- `docs/05-caching/CACHING_STRATEGY.md` (Cache-aside pattern implementation)
- `web/lib/repositories/base-repository.ts` (BaseRepository implementation)
- `web/lib/cache/cache-keys.ts` (Cache key conventions and TTL constants)
- `web/lib/cache/redis-client.ts` (Redis connection management)

### Validation Steps

#### Step 1: Repository Pattern Compliance Check

**Objective:** Verify all repositories extend BaseRepository and follow naming conventions.

**Commands:**
```bash
cd web

# List all repositories
ls -la lib/repositories/

# Check which files extend BaseRepository
grep -r "extends BaseRepository" lib/repositories/

# Check repository constructor signatures
grep -A 5 "constructor" lib/repositories/*.ts

# Verify imports of NodePgDatabase type
grep "NodePgDatabase" lib/repositories/*.ts
```

**Expected Results:**
- All repository files should extend BaseRepository
- All constructors should accept `db: NodePgDatabase<typeof schema>` and `redis: Redis`
- Schema should be imported from `@ipodhan/shared/db/schema`
- At minimum: `ipo-repository.ts`, `subscription-repository.ts`, `gmp-repository.ts`, `financial-repository.ts`

**Success Criteria:**
- [ ] All repository classes extend BaseRepository
- [ ] All repository constructors use proper type signatures
- [ ] Schema imports are from shared package (`@ipodhan/shared/db/schema`)
- [ ] No direct database queries in API routes (should go through repositories)

---

#### Step 2: Cache HIT Scenario Validation

**Objective:** Verify that cached data is served from Redis without hitting the database.

**Setup:**
```bash
# Terminal 1: Start Redis monitor
redis-cli MONITOR

# Terminal 2: Start development server with query logging
cd web
DEBUG=repository:* npm run dev
```

**Test Procedure:**

1. **Clear all caches to start fresh:**
```bash
redis-cli FLUSHDB
```

2. **Make initial request (will be CACHE MISS):**
```bash
# Example: Get IPO by slug
curl http://localhost:3000/api/ipos/xyz-company-ipo
```

3. **Check Redis for cache key creation:**
```bash
redis-cli KEYS "ipo:slug:*"
redis-cli GET "ipo:slug:xyz-company-ipo"
redis-cli TTL "ipo:slug:xyz-company-ipo"
```

4. **Make second request (should be CACHE HIT):**
```bash
curl http://localhost:3000/api/ipos/xyz-company-ipo
```

**Expected Cache Keys:**
```
ipo:slug:xyz-company-ipo (TTL: 900 seconds / 15 minutes)
ipo:list:mainboard-open (TTL: 300 seconds / 5 minutes)
ipo:list:mainboard-upcoming (TTL: 300 seconds / 5 minutes)
subscription:latest:ipo-id-123 (TTL: 180 seconds / 3 minutes)
gmp:latest:ipo-id-123 (TTL: 900 seconds / 15 minutes)
```

**Success Criteria:**
- [ ] First request creates cache key in Redis with correct TTL
- [ ] Second request serves data from cache (no database query)
- [ ] Cache keys follow convention from `cache-keys.ts`
- [ ] TTL values match CacheTTL constants (IPO_DETAIL: 900, IPO_LIST: 300, SUBSCRIPTION: 180, GMP: 900)
- [ ] Response time for cache HIT < 50ms (vs ~100-200ms for database query)

---

#### Step 3: Cache MISS Scenario Validation

**Objective:** Verify proper fallback to database when cache is empty or expired.

**Test Procedure:**

1. **Clear specific cache key:**
```bash
redis-cli DEL "ipo:slug:xyz-company-ipo"
```

2. **Make request (will trigger cache MISS):**
```bash
curl http://localhost:3000/api/ipos/xyz-company-ipo
```

3. **Verify cache population:**
```bash
redis-cli EXISTS "ipo:slug:xyz-company-ipo"
redis-cli GET "ipo:slug:xyz-company-ipo"
```

**Expected Behavior:**
1. Request arrives → Check Redis → Key not found
2. Execute database query → Retrieve data
3. Populate cache → Set TTL
4. Return data to client

**Success Criteria:**
- [ ] Cache MISS triggers database query via executeQuery
- [ ] Database query executes successfully with proper joins
- [ ] Retrieved data is cached with correct TTL
- [ ] Subsequent requests serve from cache (HIT scenario)
- [ ] Query execution time < 100ms (p95 target)
- [ ] Proper error handling if database query fails

---

#### Step 4: Cache Invalidation After Mutations

**Objective:** Verify cache is properly invalidated after INSERT/UPDATE/DELETE operations.

**⚠️ APPROVAL CHECKPOINT:**
Before proceeding with mutation testing, ensure:
- [ ] Testing on development database (NOT production)
- [ ] Backup of test data exists
- [ ] Mutation operations are reversible

**Expected Cache Invalidation Patterns:**

| Operation | Cache Keys Invalidated |
|-----------|------------------------|
| INSERT IPO | `ipo:list:*` (all list caches) |
| UPDATE IPO | `ipo:slug:{slug}`, `ipo:list:*` |
| DELETE IPO | `ipo:slug:{slug}`, `ipo:list:*`, `subscription:latest:{id}`, `gmp:latest:{id}` |
| INSERT Subscription | `subscription:latest:{ipo_id}`, `subscription:history:{ipo_id}` |
| INSERT GMP | `gmp:latest:{ipo_id}`, `gmp:history:{ipo_id}` |

**Success Criteria:**
- [ ] INSERT invalidates list caches
- [ ] UPDATE invalidates detail and list caches
- [ ] DELETE invalidates all related caches
- [ ] Invalidation happens BEFORE returning response (not async)
- [ ] Subsequent requests fetch fresh data from database
- [ ] No stale data served from cache after mutations

---

#### Step 5: Pattern-Based Cache Deletion

**Objective:** Validate pattern-based cache deletion using `deleteCachePattern()` method.

**Test Cases:**

| Pattern | Description | Expected Deletion |
|---------|-------------|-------------------|
| `ipo:*` | All IPO-related caches | All `ipo:slug:*` and `ipo:list:*` keys |
| `ipo:slug:*` | Only IPO detail caches | All individual IPO caches, list caches remain |
| `ipo:list:*` | Only IPO list caches | All list caches, detail caches remain |
| `subscription:latest:*` | All latest subscription caches | All subscription keys |
| `gmp:*` | All GMP caches | Both `gmp:latest:*` and `gmp:history:*` |

**Success Criteria:**
- [ ] Pattern deletion removes all matching keys
- [ ] Non-matching keys remain untouched
- [ ] Pattern deletion is atomic (all-or-nothing)
- [ ] No errors when pattern matches zero keys
- [ ] Pattern deletion logs list of deleted keys (for debugging)

---

#### Step 6: Query Logging Validation

**Objective:** Verify all database queries are logged via `executeQuery()` method with proper context.

**Test Procedure:**

1. **Enable query logging:**
```bash
# Set DEBUG environment variable
export DEBUG=repository:*
cd web
npm run dev
```

2. **Trigger various repository operations:**
```bash
# Read operations
curl http://localhost:3000/api/ipos/xyz-company-ipo
curl http://localhost:3000/api/ipos?category=MAINBOARD
```

**Expected Log Format:**
```
[Repository] executeQuery: findBySlug | context: {"slug":"xyz-company-ipo"} | duration: 45ms
[Repository] executeQuery: findOpen | context: {"category":"MAINBOARD","limit":20} | duration: 78ms
```

**Success Criteria:**
- [ ] 100% of database queries logged via executeQuery
- [ ] Log format is consistent across all repositories
- [ ] Query context provides enough information for debugging
- [ ] Query duration helps identify performance bottlenecks
- [ ] No direct database queries bypass executeQuery (use grep to verify)

---

#### Step 7: Graceful Degradation (Redis Unavailable)

**Objective:** Verify application continues functioning when Redis is down or unreachable.

**⚠️ WARNING:** This test intentionally breaks Redis connection. Only run in development environment.

**Test Procedure:**

**A. Test Connection Timeout Protection**

1. **Stop Redis server:**
```bash
# Windows
net stop Redis

# Linux/Mac
sudo systemctl stop redis
```

2. **Make API requests (should still work, using database):**
```bash
# These should succeed but be slower (no cache)
curl http://localhost:3000/api/ipos/xyz-company-ipo
curl http://localhost:3000/api/ipos?category=MAINBOARD
```

3. **Verify health endpoint reports degraded state:**
```bash
curl http://localhost:3000/api/health
```

**Expected Response:**
```json
{
  "status": "degraded",
  "database": "healthy",
  "redis": "unavailable",
  "message": "Application running without cache"
}
```

**Success Criteria:**
- [ ] Application remains accessible when Redis is down
- [ ] API endpoints return correct data (from database)
- [ ] Response times increase but stay within acceptable range (< 500ms p95)
- [ ] Health endpoint reports "degraded" status (not "error")
- [ ] Connection retry logic works (reconnects when Redis comes back)
- [ ] No unhandled exceptions or crashes
- [ ] User experience is preserved (slightly slower, but functional)
- [ ] Cache operations resume automatically after reconnection

---

### Final Validation Checklist (Enhancement #13)

**Repository Pattern Compliance:**
- [ ] All repositories extend BaseRepository
- [ ] All repositories use NodePgDatabase<typeof schema> type
- [ ] Schema imports are from @ipodhan/shared/db/schema
- [ ] No direct database queries in API routes

**Cache-Aside Pattern Implementation:**
- [ ] Cache HIT reduces database load (verified via executeQuery logs)
- [ ] Cache MISS falls back to database and populates cache
- [ ] Cache TTL values match CacheTTL constants
- [ ] Cache keys follow naming convention from cache-keys.ts

**Cache Invalidation:**
- [ ] INSERT operations invalidate list caches
- [ ] UPDATE operations invalidate detail + list caches
- [ ] DELETE operations invalidate all related caches
- [ ] Pattern-based deletion works correctly (e.g., ipo:*)
- [ ] No stale data served after mutations

**Query Logging:**
- [ ] All database queries logged via executeQuery
- [ ] Log format includes query name, context, and duration
- [ ] Slow queries (>100ms) are identifiable
- [ ] No queries bypass executeQuery (verified via grep)

**Graceful Degradation:**
- [ ] Application works when Redis is unavailable
- [ ] Connection timeout is enforced (5 seconds)
- [ ] Retry logic works (3 attempts with backoff)
- [ ] Health endpoint reports degraded status
- [ ] Performance degradation is acceptable (<500ms p95)
- [ ] Automatic reconnection works when Redis returns

**Performance Targets:**
- [ ] Cache HIT response time: < 50ms
- [ ] Cache MISS response time: < 200ms
- [ ] Redis unavailable (degraded): < 300ms
- [ ] Cache hit rate: > 80% for IPO endpoints
- [ ] Database query performance: p95 < 100ms

---

## ITERATION 4: Fix All Data Gaps & Final Validation

### Fix Scrapers

- Update parsing logic for structure changes
- Improve fuzzy matching algorithms
- Add missing scrapers (GMP, subscriptions, peer companies if needed)
- Fix rate limiting issues
- Re-run all scrapers

### Data Integrity Checks

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

**Apply all auto-generated tests from Iteration 1, 2 & 3 issues**

### Sample Data Verification

- Pick 5 random IPOs (across all statuses: UPCOMING, OPEN, CLOSED, LISTED)
- For each IPO, visit source websites using Playwright headed mode
- Compare field-by-field with our database
- Take screenshots of source pages
- Document any discrepancies
- **Goal: 100% match between source and database**

---

## Phase 1 Success Criteria Checklist

**✅ GATE: Phase 1 Complete - Proceed to Phase 2 ONLY if all criteria met**

- [ ] Schema matches packages/shared/src/db/schema.ts
- [ ] All scrapers SUCCESS in scraper_logs
- [ ] consecutiveFailures = 0 for all scrapers
- [ ] ≥150 IPOs in database (or per your data)
- [ ] 100% critical field coverage
- [ ] >90% important field coverage
- [ ] >70% enhanced field coverage
- [ ] Zero duplicates
- [ ] Foreign keys valid
- [ ] Date logic valid
- [ ] Price logic valid
- [ ] GMP/subscription data fresh for OPEN IPOs
- [ ] Historical data complete for LISTED IPOs
- [ ] Fuzzy matching >90% accuracy
- [ ] Source change detection in place
- [ ] Incremental scraping works without duplicates
- [ ] **Enhancement #13: All repository pattern checks pass**
- [ ] **Enhancement #13: Cache-aside pattern validated**
- [ ] **Enhancement #13: Graceful degradation verified**
- [ ] Dev server running on localhost:3000
- [ ] API endpoints respond
- [ ] SCRAPING_COVERAGE_REPORT.md complete
- [ ] TEST_PROGRESS.md updated
- [ ] TEST_ISSUES.json current
- [ ] Git commit for Phase 1

---

## 📝 GIT CHECKPOINT: Commit Phase 1 Results

**Action Required**: Commit all Phase 1 testing work before proceeding to Phase 2.

```bash
# Commit Phase 1 completion
git add TEST_PROGRESS.md TEST_ISSUES.json SCRAPING_COVERAGE_REPORT.md test-results/
git commit -m "test(phase-1): Complete data quality and scraping validation

✅ All scrapers SUCCESS (0 consecutive failures)
✅ [X] IPOs in database with [Y]% field coverage
✅ GMP/subscription data fresh for OPEN IPOs
✅ Historical data complete for LISTED IPOs
✅ Zero duplicates, all foreign keys valid
✅ Fuzzy matching >90% accuracy
✅ Repository pattern & cache-aside validated (Enhancement #13)

Issues resolved: [count] (see TEST_ISSUES.json)
Coverage: Critical 100%, Important [X]%, Enhanced [Y]%"

git push origin main
```

---

**Next Phase:** → [02-PHASE-2-CORE-PAGES.md](02-PHASE-2-CORE-PAGES.md)
