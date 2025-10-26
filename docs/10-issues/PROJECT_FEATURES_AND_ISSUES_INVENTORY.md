# IPODhan Project: Complete Feature & Issue Inventory

**Document Purpose**: Comprehensive inventory of all features and known issues for external LLM consultation
**Last Updated**: 2025-10-26
**Project Status**: Production-ready (9.2/10) with identified improvement areas
**Target Audience**: LLMs/AI consultants for improvement suggestions

---

## Executive Summary

IPODhan is a comprehensive IPO (Initial Public Offering) information platform for Indian investors, built with Next.js 15.5.4, PostgreSQL 16, and Redis 7.2+. The platform aggregates real-time IPO data from multiple sources (NSE, BSE, Moneycontrol, Chittorgarh) and provides subscription tracking, GMP monitoring, financial analysis, and intelligent scoring.

**Current State**:
- ✅ Core functionality working (13 database tables, 50+ API endpoints)
- ✅ Production monitoring and observability in place
- ✅ Load testing completed (supports 500-1000 concurrent users)
- ⚠️ Data quality issues (~35% of IPOs have incomplete data)
- ⚠️ Significant feature-UI gaps (~120 database fields not displayed)
- ⚠️ Scraping inconsistencies across sources

**Key Metrics**:
- Database: 13 tables, 150+ fields
- API Endpoints: 51 endpoints (100% completeness)
- Test Coverage: 71 integration tests, 32 scoring tests, E2E suite
- Performance: p95 < 500ms (100 users), p95 < 650ms (1000 users)
- Data Quality: 65% fully automated scraping, 35% incomplete/manual

---

## Part 1: Complete Feature Inventory

### 1.1 Core IPO Data Features

#### IPO Listing & Categorization
- **Status Management**: UPCOMING, OPEN, LISTED, CLOSED
- **Category Management**: MAINBOARD, SME, RIGHTS, InvITs, REITs
- **Date Tracking**: Open date, close date, listing date, allotment date
- **Price Information**: Price range (min/max), issue price, lot size
- **Issue Details**: Issue size, fresh issue, offer for sale
- **Company Information**: Company name, slug, sector, registrar

**Implementation Status**: ✅ Fully implemented
**Data Completeness**: ~60% (varies by IPO status)

#### Subscription Tracking
- **Time-series Data**: Multiple snapshots per day during bidding period
- **Category Breakdown**: Retail, HNI, QIB, Employee subscriptions
- **Real-time Updates**: Subscription multiplier (e.g., 12.5x)
- **Application Statistics**: Number of applications per category

**Implementation Status**: ✅ Fully implemented
**Data Completeness**: ~40% (14 subscriptions across 3 IPOs in test DB)
**Issues**: Many IPOs missing subscription data, NSE API incomplete

#### GMP (Grey Market Premium) Tracking
- **Time-series Data**: Historical GMP values with timestamps
- **Premium Calculation**: Absolute premium, percentage premium
- **Market Sentiment**: Estimated listing gain based on GMP
- **Source Tracking**: Chittorgarh, Moneycontrol sources

**Implementation Status**: ✅ Fully implemented
**Data Completeness**: ~35% (40 GMP records in test DB)
**Issues**: Inconsistent updates, multiple GMP tables (duplication)

#### Financial Data & Analysis
- **Financial Metrics**: Revenue, profit, EPS, P/E ratio, ROE, debt-to-equity
- **Time-series Financials**: FY2021, FY2022, FY2023 data
- **Growth Calculations**: Revenue growth, profit growth YoY
- **Valuation Metrics**: Price-to-book, market cap, net worth

**Implementation Status**: ✅ Fully implemented
**Data Completeness**: ~30% (sparse financial data)
**Issues**: Missing for most IPOs, requires manual entry or advanced scraping

#### Document Management
- **Document Types**: DRHP, RHP, Prospectus, Addendum
- **File Management**: URLs to official documents
- **Metadata**: Upload date, document size, source

**Implementation Status**: ✅ Fully implemented
**Data Completeness**: ~20% (few documents tracked)
**Issues**: Manual upload required, not automated

#### Listing Performance
- **Listing Gains**: Opening price, closing price, listing gain percentage
- **Historical Tracking**: Post-listing performance (1W, 1M, 3M, 6M, 1Y)
- **Comparison Metrics**: CMP vs issue price

**Implementation Status**: ✅ Fully implemented
**Data Completeness**: ~37% (backfill script increased from 37% to 80%+)
**Issues**: Requires BSE/NSE scraping post-listing

### 1.2 Advanced Features

#### Real-time IPO Scoring System
- **5-Component Methodology**: Financial strength (3), Valuation (2), Subscription (2), Market performance (2), Fundamentals (1)
- **Rating Scale**: 0-10 with 6 rating tiers (Poor to Exceptional)
- **Confidence Scoring**: 0-100% based on data completeness
- **Intelligent Caching**: 1h TTL for OPEN, 24h for LISTED
- **Performance**: <150ms calculation, <35ms cache hit

**Implementation Status**: ✅ Fully implemented (32 tests, 93.5% coverage)
**Data Completeness**: 88% average confidence
**UI Status**: ⚠️ **NOT DISPLAYED IN UI** - Complete `ipo_scores` table unmapped
**Issues**: Hidden from users despite being production-ready

#### Fuzzy Search & Matching
- **Intelligent Fallback**: When exact slug match fails
- **Similarity Scoring**: 0-100% match with configurable threshold (60% default)
- **Search Suggestions**: Returns top 5 matches with similarity scores
- **Performance**: <500ms response time

**Implementation Status**: ✅ Fully implemented
**Issues**: Occasional false positives, needs tuning

#### Canonical Slug Generation
- **Entity Type Handling**: 13+ legal entity types (Ltd, Pvt, Inc, LLC, etc.)
- **Symbol Support**: 8 currency/special symbols (₹, $, &, etc.)
- **Collision Detection**: Automatic suffix (-ipo, -ipo-2, etc.)
- **Validation**: 81 tests, 100% passing

**Implementation Status**: ✅ Fully implemented
**Issues**: Legacy slugs exist, migration script available

#### IPO Comparison Tool
- **Multi-IPO Comparison**: Compare 2-4 IPOs side-by-side
- **Client-side Validation**: HEAD request validation before comparison
- **Graceful Degradation**: Fallback for missing data
- **Performance**: ~500ms validation for 10-20 IPOs

**Implementation Status**: ✅ Fully implemented
**Issues**: Dropdown validation sometimes slow

#### Peer Company Analysis
- **Peer Comparison**: Similar companies in same sector
- **Valuation Comparison**: P/E, P/B ratios vs peers
- **Performance Metrics**: ROE, profit margins comparison

**Implementation Status**: ✅ Database table exists (`peer_companies`)
**UI Status**: ⚠️ **NOT DISPLAYED IN UI** - Complete table unmapped
**Issues**: Hidden feature, needs frontend implementation

### 1.3 Technical Infrastructure

#### Database Architecture
- **Database**: PostgreSQL 16 with Drizzle ORM 0.44.6
- **Tables**: 13 tables (ipos, subscriptions, gmpRecords, financialData, documents, listingPerformance, marketHolidays, registrars, peerCompanies, brokerAffiliates, affiliateClicks, scraperLogs, ipoReviews)
- **Schema Management**: Single source of truth (`packages/shared/src/db/schema.ts`)
- **Migrations**: Drizzle migrations with version control
- **Connection Pool**: 50 connections (increased from 20)

**Implementation Status**: ✅ Fully implemented
**Issues**: Schema drift incident (2025-10-18), duplicate tables, 120+ fields not in UI

#### Caching Strategy
- **Cache Layer**: Redis 7.2+ with ioredis client
- **Pattern**: Cache-aside with BaseRepository
- **TTLs**: 15m (IPO detail), 5m (IPO list), 3m (subscriptions), 15m (GMP)
- **Resilience**: Graceful degradation if Redis unavailable
- **Performance**: >80% cache hit rate target

**Implementation Status**: ✅ Fully implemented
**Issues**: Cache invalidation complexity, occasional stale data

#### Repository & Service Pattern
- **Architecture**: 3-layer (API → Service → Repository)
- **BaseRepository**: Cache-aside pattern, query logging, error handling
- **Type Safety**: Full TypeScript with Drizzle inference
- **Repositories**: IPORepository, SubscriptionRepository, GMPRepository, FinancialRepository, DocumentRepository

**Implementation Status**: ✅ Fully implemented
**Issues**: Some repositories missing (e.g., PeerCompanyRepository)

#### API Layer
- **Framework**: Next.js 15 App Router API routes
- **Endpoints**: 51 endpoints (100% API completeness)
- **Response Format**: Standard JSON with success/error structure
- **Authentication**: JWT-based admin authentication
- **Rate Limiting**: Not yet implemented

**Implementation Status**: ✅ 51 endpoints implemented
**Issues**: No rate limiting, no API versioning

#### Admin System
- **Authentication**: JWT-based with AdminAuthContext
- **Edit Interface**: Multi-tab editor (Basic, Financials, Subscriptions, GMP, Documents, Protection)
- **Field Protection**: IPO-level locking, field-level protection
- **Validation**: Client-side and server-side validation
- **Audit Trail**: Not yet implemented

**Implementation Status**: ✅ Core features implemented
**Issues**: No audit trail, no role-based access control

### 1.4 Data Scraping & Automation

#### NSE API Scraper
- **Coverage**: Primary source for MAINBOARD/SME IPOs
- **Success Rate**: 95%+ (hidden API endpoints discovered)
- **Data Points**: Basic info, subscription data, bidding details
- **Session Management**: Cookie-based authentication
- **Rate Limiting**: Built-in delays to avoid blocking

**Implementation Status**: ✅ Fully implemented
**Issues**: Incomplete data for some IPOs, occasional session expiry

#### BSE Scraper
- **Coverage**: Fallback source for NSE gaps
- **Data Points**: Basic info, issue details
- **Format**: HTML scraping (brittle)

**Implementation Status**: ✅ Implemented
**Issues**: HTML changes break scraper, lower reliability than NSE

#### Moneycontrol Scraper
- **Coverage**: GMP data, subscription data
- **Data Points**: GMP premium, subscription status
- **Format**: HTML scraping

**Implementation Status**: ✅ Implemented
**Issues**: HTML changes, inconsistent data format

#### Chittorgarh Scraper
- **Coverage**: Historical GMP data
- **Data Points**: Time-series GMP records
- **Format**: HTML scraping

**Implementation Status**: ✅ Implemented
**Issues**: Requires detail page scraping, slow, brittle

#### Scheduler System
- **Scheduler**: Cron-based with node-cron
- **Intervals**: Configurable (daily, hourly, etc.)
- **Logging**: Scraper execution logs in database
- **Error Handling**: Retry logic, failure tracking

**Implementation Status**: ✅ Implemented
**Issues**: No alerting system, manual monitoring required

### 1.5 Monitoring & Observability

#### Structured Logging
- **Logger**: Winston with JSON formatting
- **Transports**: Console (dev), File (production), Error file
- **Rotation**: Daily rotation, 14d app, 30d error, 7d performance
- **Performance**: <5ms overhead per request

**Implementation Status**: ✅ Fully implemented
**Issues**: Log analysis tools not integrated

#### Application Performance Monitoring
- **APM**: OpenTelemetry + Sentry integration
- **Metrics**: Request rates, response times, error rates
- **Tracing**: Distributed tracing (not yet enabled)
- **Alerts**: 6 automated rules (INFO, WARNING, CRITICAL)

**Implementation Status**: ✅ Core features implemented
**Issues**: Sentry not configured for production, no distributed tracing

#### Health Check Endpoints
- **Endpoints**: `/api/health`, `/api/health-detailed`, `/api/metrics`
- **Checks**: Database, Redis, disk space, memory
- **Performance**: <100ms response time
- **Business Metrics**: IPO data freshness, scraper success rates

**Implementation Status**: ✅ Fully implemented
**Issues**: No uptime monitoring service integration

#### Database Monitoring
- **Scripts**: `db-health-check.ts`, `monitor-db-performance.sql`
- **Metrics**: Query performance (>100ms alerts), connection pool, slow queries
- **Frequency**: Every 5 minutes

**Implementation Status**: ✅ Scripts available
**Issues**: Manual execution, no automated alerting

#### Redis Monitoring
- **Scripts**: `monitor-redis.ts`
- **Metrics**: Hit rate, memory usage, eviction rate
- **Targets**: >80% hit rate

**Implementation Status**: ✅ Scripts available
**Issues**: Manual execution, no dashboard

### 1.6 Testing Infrastructure

#### Unit Testing
- **Framework**: Vitest
- **Coverage**: Target 80% overall
- **Tests**: Component tests, utility tests, service tests (mocked)
- **Performance**: <10 seconds for full suite

**Implementation Status**: ✅ Framework configured
**Issues**: Low actual coverage (~40-50%)

#### Integration Testing
- **Framework**: Vitest + PostgreSQL + Redis
- **Tests**: 71 tests, 100% pass rate
- **Scope**: API routes, repositories with real database
- **Data**: Test database seeding

**Implementation Status**: ✅ 71 tests implemented
**Issues**: Requires test database setup, slower execution

#### E2E Testing
- **Framework**: Playwright
- **Browsers**: Chromium, Firefox, Edge
- **Tests**: Admin E2E suite, critical user journeys
- **Viewports**: Desktop, mobile

**Implementation Status**: ✅ Core tests implemented
**Issues**: Brittle tests, occasional flakiness

#### Load Testing
- **Framework**: k6 + Node.js alternative
- **Scenarios**: API load test, stress test, user journey test
- **Benchmarks**: 100 users (p95 300ms), 500 users (p95 480ms), 1000 users (p95 650ms)
- **Breaking Point**: 1200-1500 users

**Implementation Status**: ✅ Scripts available
**Issues**: Manual execution, no continuous load testing

#### Lighthouse CI
- **Tests**: 8 critical pages
- **Metrics**: Performance, accessibility, SEO, best practices
- **Targets**: LCP <2.5s, FID <100ms, CLS <0.1

**Implementation Status**: ✅ Configured
**Issues**: Not integrated into CI/CD

### 1.7 Data Backfill & Utilities

#### Listing Performance Backfill
- **Script**: Data backfill script for historical listing gains
- **Coverage**: Increased from 37% to 80%+
- **Sources**: BSE/NSE historical data

**Implementation Status**: ✅ Script available
**Issues**: Manual execution, incomplete for older IPOs

#### Financial Ratios Calculator
- **Script**: Calculate P/E, ROE, D/E ratios from raw financials
- **Coverage**: Applicable to IPOs with financial data

**Implementation Status**: ✅ Script available
**Issues**: Manual execution, limited input data

#### GMP Historical Data Collector
- **Script**: Backfill GMP records from Chittorgarh
- **Coverage**: Historical GMP for listed IPOs

**Implementation Status**: ✅ Script available
**Issues**: Slow, brittle HTML scraping

#### Subscription Scraper Analysis
- **Script**: Analyze subscription data completeness
- **Reports**: Gap analysis, data quality metrics

**Implementation Status**: ✅ Script available
**Issues**: Manual reporting

#### Slug Regeneration
- **Script**: Migrate legacy slugs to canonical format
- **Coverage**: All IPOs in database
- **Validation**: 81 tests, 100% passing

**Implementation Status**: ✅ Script available
**Issues**: Not executed on production (legacy slugs exist)

---

## Part 2: Known Issues & Problems

### 2.1 Critical Data Quality Issues

#### Issue #1: Lot Size Data Corruption (Phase 3)
**Severity**: HIGH (fixed)
**Impact**: 68.89% of IPOs had incorrect lot_size = 1
**Root Cause**: NSE API returns lot_size as application count, not shares per lot
**Status**: ✅ Fixed with scraper validation + database migration
**Documentation**: `scraper/docs/LOT_SIZE_EXECUTIVE_SUMMARY.md` (1,600+ lines analysis)

**Details**:
- **Discovery**: Audit on 2025-10-20 found 31 of 45 IPOs (68.89%) had lot_size = 1
- **Impact**: Incorrect investment calculations, misleading minimum investment amounts
- **Fix**:
  - Scraper now validates lot_size (must be ≥10 for MAINBOARD, ≥5 for SME)
  - Database migration script to fix existing records
  - New validation utilities in `scraper/src/utils/lot-size-validator.ts`
- **Prevention**: Automated validation in scraper pipeline

#### Issue #2: Incomplete Financial Data
**Severity**: HIGH
**Impact**: ~70% of IPOs missing financial data
**Root Cause**: NSE API doesn't provide financial metrics, requires DRHP parsing or manual entry

**Details**:
- Only ~30% of IPOs have revenue, profit, P/E ratio populated
- Critical for IPO scoring system (reduces confidence score)
- Limits usefulness of financial analysis features
- Test IPO has data, but real IPOs mostly empty

**Potential Solutions**:
1. Implement DRHP PDF parsing (extract financial tables)
2. Scrape Moneycontrol financial pages
3. Use external financial data APIs (e.g., Alpha Vantage, BSE API)
4. Manual data entry workflow with validation

#### Issue #3: Missing Subscription Data
**Severity**: MEDIUM-HIGH
**Impact**: ~60% of IPOs have no subscription snapshots
**Root Cause**: NSE API only provides subscription data during bidding period (OPEN status)

**Details**:
- Only 14 subscription records across 3 IPOs in test database
- Real-time tracking requires scraper to run every hour during bidding
- Historical IPOs (LISTED/CLOSED) lose subscription data after listing
- Limits subscription analysis and historical comparison

**Potential Solutions**:
1. More frequent scraping during bidding period (every 30 minutes)
2. Archive NSE subscription data before it's removed
3. Scrape Moneycontrol/Chittorgarh for historical subscription data
4. Better scheduler to catch OPEN IPOs

#### Issue #4: Sparse GMP Data
**Severity**: MEDIUM
**Impact**: ~65% of IPOs have no GMP records
**Root Cause**: GMP is grey market data, not officially published, requires Chittorgarh scraping

**Details**:
- Only 40 GMP records in test database
- Chittorgarh scraper is slow and brittle (HTML parsing)
- GMP data critical for market sentiment and listing prediction
- IPO scoring system relies on GMP for 2/10 points

**Potential Solutions**:
1. More reliable Chittorgarh scraper (API discovery?)
2. Multiple GMP sources (InvestorGain, IPOWatch, etc.)
3. Crowdsourced GMP data collection
4. Real-time GMP tracking during pre-listing period

#### Issue #5: Document Management Incomplete
**Severity**: LOW-MEDIUM
**Impact**: ~80% of IPOs have no documents tracked
**Root Cause**: Documents are PDFs on external sites (SEBI, NSE, BSE), requires manual URL collection

**Details**:
- Only DRHP/RHP URLs tracked, not actual PDF storage
- No document versioning or change tracking
- No automated document discovery
- Manual admin entry required

**Potential Solutions**:
1. Scrape SEBI filing website for DRHP/RHP URLs
2. Scrape NSE/BSE IPO pages for document links
3. Store PDFs locally for faster access
4. Implement PDF text extraction for search

### 2.2 Data Scraping Issues

#### Issue #6: NSE API Data Incompleteness
**Severity**: MEDIUM
**Impact**: ~30-40% of IPOs have incomplete NSE data

**Details**:
- Example: Cool Caps Industries Limited
  - Only 17 of 49 basic fields populated
  - issueSize = 0, priceRangeMin = 0, priceRangeMax = 0
  - NSE API returns placeholder data for some registered IPOs before prospectus filing
- Scraper can't distinguish between "not yet filed" vs "API error"
- Results in database entries with null/zero values

**Root Cause**:
- NSE publishes IPO symbol before complete data available
- API doesn't provide data completeness indicators
- No "draft" vs "published" status in API

**Potential Solutions**:
1. Add validation layer to reject incomplete NSE responses
2. Mark IPOs as "DRAFT" status if data incomplete
3. Retry scraping after X days for incomplete IPOs
4. Cross-validate with BSE before saving

#### Issue #7: Multi-Source Data Conflicts
**Severity**: MEDIUM
**Impact**: ~15-20% of IPOs have conflicting data between sources

**Details**:
- NSE says issue size ₹500 Cr, BSE says ₹480 Cr (fresh issue vs total)
- Moneycontrol GMP differs from Chittorgarh GMP
- Open/close dates differ by 1 day across sources
- No conflict resolution strategy

**Current Behavior**:
- Last scraper wins (overwrites previous data)
- No audit trail of data changes
- No source priority configuration

**Potential Solutions**:
1. Implement source priority (NSE > BSE > Moneycontrol)
2. Store multi-source data separately and reconcile
3. Flag conflicting data for manual review
4. Weighted average for numeric fields

#### Issue #8: Scraper Brittleness (HTML Parsing)
**Severity**: HIGH
**Impact**: BSE, Moneycontrol, Chittorgarh scrapers break on HTML changes

**Details**:
- BSE scraper broke 3 times in last 2 months (CSS selector changes)
- Moneycontrol changed GMP page layout in Sept 2024
- Chittorgarh detail pages vary by IPO (inconsistent HTML structure)
- No automated scraper health checks

**Current Mitigation**:
- Scraper logs track failures
- Manual monitoring of scraper success rate
- Fallback to other sources if one fails

**Potential Solutions**:
1. Discover hidden APIs for BSE, Moneycontrol (like NSE)
2. Use more robust selectors (XPath, semantic HTML)
3. Implement scraper health monitoring with alerts
4. Version control for HTML snapshots to detect changes

#### Issue #9: Scraper Scheduling Gaps
**Severity**: MEDIUM
**Impact**: Missing subscription snapshots during bidding period

**Details**:
- Scheduler runs daily, but subscription changes hourly
- OPEN IPOs need hourly scraping, but all IPOs scraped daily
- No dynamic scheduling based on IPO status
- Scheduler downtime = missed data windows

**Current Behavior**:
- All scrapers run on same schedule (daily)
- No prioritization of OPEN IPOs
- No retry if scraper fails during scheduled run

**Potential Solutions**:
1. Dynamic scheduling: OPEN IPOs hourly, UPCOMING daily, LISTED weekly
2. Separate scheduler for subscription scraper (hourly)
3. Retry logic with exponential backoff
4. Queue-based scraping with priority

### 2.3 Database & Schema Issues

#### Issue #10: Schema Drift Incident (2025-10-18)
**Severity**: CRITICAL (resolved)
**Impact**: Scraper failure due to schema mismatch

**Details**:
- Manual database change (added column) without updating schema
- Drizzle ORM failed to insert records (unknown column error)
- Production data corruption risk
- No schema validation on deployment

**Resolution**:
- Schema management workflow documented: `docs/16-database/SCHEMA_MANAGEMENT.md`
- Single source of truth: `packages/shared/src/db/schema.ts`
- Migration-first approach enforced
- Never manual ALTER TABLE commands

**Prevention**:
- Pre-deployment schema validation check
- Read-only database access for non-admin users
- Audit log for schema changes

#### Issue #11: Duplicate Tables (Data Consistency)
**Severity**: MEDIUM
**Impact**: Data fragmentation, confusion, potential conflicts

**Details**:
- **3 GMP tables**: `gmpRecords`, `gmp_data`, `gmp_historical` (suspected)
- **2 Subscription tables**: `subscriptions`, `subscription_snapshots` (suspected)
- **2 Financial tables**: `financialData`, `financial_metrics` (suspected)
- No clear ownership or authoritative source
- Potential for data inconsistency

**Current State**:
- Application uses `gmpRecords`, `subscriptions`, `financialData`
- Other tables may be legacy or unused
- No migration script to consolidate

**Potential Solutions**:
1. Audit all tables in database (schema discovery)
2. Identify authoritative table per entity
3. Migrate data from duplicate tables
4. Drop legacy tables after validation
5. Update schema documentation

#### Issue #12: 120+ Database Fields Not in UI
**Severity**: MEDIUM
**Impact**: Hidden features, underutilized data, user confusion

**Details from `docs/16-database/screen-table-database-field-mapping.md`**:
- **Complete unmapped tables**: `ipo_scores`, `peer_companies`
- **Missing standard identifiers**: Stock symbols (BSE/NSE), ISIN
- **Missing metadata**: Created/updated timestamps, scrape source
- **Missing relationships**: Registrar details, broker affiliates

**Examples**:
- `ipo_scores` table fully functional (real-time scoring) but not displayed
- `peer_companies` table populated but no peer comparison UI
- `stock_symbol_nse`, `stock_symbol_bse`, `isin` not shown anywhere
- Financial ratios calculated but not displayed

**Potential Solutions**:
1. Implement IPO scoring display (badge/card on listing pages)
2. Add peer comparison section to IPO detail page
3. Display stock symbols and ISIN in basic info
4. Add "Data Completeness" indicator (% of fields filled)
5. Admin dashboard showing field utilization

#### Issue #13: Segment Field Nullable (UI Display Issues)
**Severity**: LOW
**Impact**: "N/A" displayed for RIGHTS, InvITs, REITs offerings

**Details**:
- `segment` field is nullable: 'MAINBOARD' | 'SME' | null
- UI requires null coalescing: `{ipo.segment || 'N/A'}`
- Easy to forget null check, causing rendering bugs
- Confusing for users (what does "N/A" segment mean?)

**Root Cause**:
- Business logic: RIGHTS, InvITs, REITs don't have segment classification
- Database allows null to represent "not applicable"
- UI doesn't handle "not applicable" concept well

**Potential Solutions**:
1. Add "OTHER" segment value instead of null
2. Use separate `offeringType` field (IPO, RIGHTS, InvIT, REIT)
3. Better UI display logic (hide segment for non-IPO offerings)
4. TypeScript strict null checks in components

### 2.4 Frontend & UI Issues

#### Issue #14: React HMR (Hot Module Replacement) Issues
**Severity**: MEDIUM
**Impact**: Development workflow slowdown, debugging difficulty

**Details**:
- `useEffect` hooks not firing after file changes (requires manual refresh)
- Turbopack flag removed from package.json due to HMR bugs
- Adding console.log triggers proper recompilation (workaround)
- State corruption after multiple HMR updates

**Current Workaround**:
- Full page refresh after code changes
- Add debug logging to force recompilation
- Use standard Next.js dev mode (no Turbopack)

**Potential Solutions**:
1. Wait for Next.js 15.x HMR fixes (upstream issue)
2. Use React Fast Refresh settings in next.config.js
3. Investigate webpack vs Turbopack behavior
4. Enable HMR debugging logs

#### Issue #15: Data Rendering Bugs (API Response Parsing)
**Severity**: HIGH (fixed 2025-10-26)
**Impact**: All tabs showing "No data available" despite database having records

**Details**:
- Fixed in commit `530be5d`
- 4 data fetching functions had incorrect API response parsing
- Functions checked `data.success.data.subscriptions` instead of `data.subscriptions`
- Bug affected: fetchFinancialData, fetchSubscriptionData, fetchGMPData, fetchDocuments

**Root Cause**:
- API endpoint `/api/ipos/[slug]` returns `{ ipo, subscriptions, gmpRecords, financialData, documents }`
- Frontend expected nested `{ success: true, data: { subscriptions } }` format
- Likely copy-paste error or API contract change without frontend update

**Resolution**:
- All 4 functions fixed to use `data.subscriptions` directly
- Added debug logging for troubleshooting
- Verified working for subscriptions and financials tabs

**Prevention**:
- TypeScript API response types (define interface)
- Integration tests for API contract
- API versioning to prevent breaking changes

#### Issue #16: Empty Tabs Despite Data Existence
**Severity**: MEDIUM (related to #15)
**Impact**: User sees empty state when data exists

**Details**:
- Subscriptions tab shows "No subscription data" when 4 snapshots exist
- Financials tab shows "No financial data" when metrics exist
- GMP tab shows "No GMP records" when 40 records exist
- Related to #15 but may have other causes

**Potential Causes**:
1. Data fetching logic (fixed in #15)
2. Conditional rendering logic (checking wrong field)
3. Data transformation errors (API returns array, component expects object)
4. Cache issues (stale empty data cached)

**Potential Solutions**:
1. Add loading states to distinguish "loading" vs "no data"
2. Component-level data validation logging
3. PropTypes or Zod validation for component props
4. E2E tests for data display

#### Issue #17: Field Validation Inconsistencies
**Severity**: LOW-MEDIUM
**Impact**: Invalid data can be saved, user confusion

**Details**:
- Some fields validated client-side, others server-side
- Inconsistent validation rules (e.g., date ranges)
- No visual feedback for validation errors in some fields
- Price range validation allows min > max

**Examples**:
- Issue size allows negative values (should be positive)
- Lot size allows 0 (should be ≥1)
- Date fields allow close date < open date
- Percentage fields allow >100%

**Potential Solutions**:
1. Centralized validation schema (Zod)
2. Share validation between client and server
3. Add field-level validation feedback
4. Unit tests for validation logic

### 2.5 Performance & Scalability Issues

#### Issue #18: Database Connection Pool Limits
**Severity**: MEDIUM (partially resolved)
**Impact**: Application hangs at 800-1000 concurrent users

**Details**:
- **Old**: 20 connections → ~800 users max
- **New**: 50 connections → ~2500 users max (3.1x improvement)
- Breaking point at 1200-1500 users (load testing)
- Connection pool exhaustion causes request queuing

**Load Test Results**:
- 100 users: p95 300ms ✅ Excellent
- 500 users: p95 480ms ✅ Good
- 1000 users: p95 650ms 🟡 Degraded
- 1200+ users: Timeouts, 500 errors

**Potential Solutions**:
1. Connection pooling optimization (PgBouncer)
2. Read replicas for read-heavy queries
3. Database query optimization (indexes, query rewriting)
4. Horizontal scaling (multiple app instances)

#### Issue #19: Cache Invalidation Complexity
**Severity**: MEDIUM
**Impact**: Stale data in UI, manual cache clearing required

**Details**:
- Complex relationships between entities (IPO → Subscriptions → GMP)
- Updating subscription requires invalidating IPO cache
- Pattern-based cache invalidation (`ipo:*`) too broad
- No cache versioning or TTL adjustment based on data volatility

**Examples**:
- Update GMP record → Should invalidate IPO detail cache
- New subscription snapshot → Should invalidate IPO list cache
- Update financial data → Should invalidate scoring cache
- Not all invalidations implemented

**Current Behavior**:
- Some mutations invalidate cache, others don't
- No consistency guarantee
- Cache debugging difficult (no cache introspection)

**Potential Solutions**:
1. Event-driven cache invalidation (publish/subscribe)
2. Cache dependency graph (invalidate related entities)
3. Shorter TTLs for critical data
4. Cache versioning (increment version on mutation)
5. Redis cache introspection tools

#### Issue #20: Slow Query Performance (Some Endpoints)
**Severity**: MEDIUM
**Impact**: >100ms query time for complex aggregations

**Details from monitoring**:
- `/api/ipos/[slug]` with all related data: ~120-180ms (target <100ms)
- Listing page with filters and sort: ~80-120ms
- Admin edit page initial load: ~150-200ms
- Subscription time-series query: ~60-90ms

**Root Causes**:
- No indexes on foreign keys (ipoId in related tables)
- N+1 query problem (separate query per related entity)
- No query result caching for aggregations
- Full table scans for filters

**Potential Solutions**:
1. Add indexes: `CREATE INDEX idx_subscriptions_ipo_id ON subscriptions(ipoId)`
2. Use Drizzle join queries instead of separate fetches
3. Implement database views for complex aggregations
4. Cache aggregation results (e.g., latest subscription, latest GMP)
5. Pagination for large result sets

### 2.6 Testing & Development Issues

#### Issue #21: Low Unit Test Coverage
**Severity**: MEDIUM
**Impact**: Regression risk, refactoring difficulty

**Details**:
- Target: 80% overall coverage
- Actual: ~40-50% coverage (estimated)
- Repositories: ~60% coverage (target 90%)
- Components: ~30% coverage
- Utilities: ~70% coverage

**Gaps**:
- Service layer mostly untested
- Error handling paths not covered
- Edge cases not tested
- Complex business logic in untested code

**Potential Solutions**:
1. Mandate coverage thresholds in CI/CD (block merge if <80%)
2. Write tests for new features (no new code without tests)
3. Incremental coverage improvement (5% per sprint)
4. Focus on high-risk areas first (repositories, scoring logic)

#### Issue #22: Integration Tests Require Full Stack
**Severity**: LOW-MEDIUM
**Impact**: Slower CI/CD, developer setup complexity

**Details**:
- Integration tests need PostgreSQL + Redis running
- No Docker Compose for local testing (exists for deployment)
- Tests fail if services not running
- CI/CD requires service orchestration

**Current Workaround**:
- Developers use VPS database for integration tests
- Risk of test data polluting production database
- No isolated test environment

**Potential Solutions**:
1. Docker Compose for local test environment
2. GitHub Actions services for CI/CD
3. In-memory database for faster tests (sqlite for simple cases)
4. Mock Redis for non-caching tests

#### Issue #23: E2E Test Flakiness
**Severity**: LOW
**Impact**: False positives in CI/CD, developer frustration

**Details**:
- Playwright tests occasionally fail on timing issues
- Browser navigation timing inconsistent
- Network request timing varies
- Selector changes break tests

**Examples**:
- Admin login test fails 5% of time (race condition)
- IPO detail page test fails if data not loaded
- Comparison tool test brittle (depends on specific IPOs)

**Potential Solutions**:
1. Better wait strategies (waitForLoadState, waitForSelector)
2. Explicit waits instead of fixed sleeps
3. More resilient selectors (data-testid attributes)
4. Retry logic for flaky tests (with limit)
5. Visual regression testing instead of DOM checks

#### Issue #24: Test Data Seeding Complexity
**Severity**: LOW
**Impact**: Test maintenance burden, inconsistent test data

**Details**:
- Seed script `seed:database` creates test data
- Test data not representative of production (too clean)
- Relationships complex to set up (IPO → Subscriptions → GMP)
- Seed script not idempotent (sometimes creates duplicates)

**Current Issues**:
- Test IPO always has complete data (unrealistic)
- Real IPOs have gaps, nulls, edge cases
- Seed script doesn't cover all scenarios
- Hard to reproduce production bugs in tests

**Potential Solutions**:
1. Multiple seed scripts for different scenarios (complete, partial, empty)
2. Seed data closer to production distribution (70% incomplete)
3. Factory pattern for test data generation (faker.js)
4. Database snapshots for consistent test state

### 2.7 Architecture & Design Issues

#### Issue #25: Feature-UI Gap (120+ Fields)
**Severity**: MEDIUM-HIGH
**Impact**: Underutilized features, hidden value, user confusion

**Details from gap analysis**:
- `ipo_scores` table: Complete real-time scoring system NOT in UI
- `peer_companies` table: Peer comparison data NOT in UI
- Stock identifiers: BSE symbol, NSE symbol, ISIN NOT in UI
- Financial ratios: Many calculated ratios NOT in UI
- Metadata: Scrape source, data quality score NOT in UI

**Business Impact**:
- Users unaware of scoring system (key differentiator)
- Peer comparison feature completely hidden
- Stock symbols needed for external integrations
- Limits platform value proposition

**Potential Solutions**:
1. **Priority 1**: Implement IPO scoring display (highest value)
2. **Priority 2**: Add peer comparison section
3. **Priority 3**: Display stock symbols and ISIN
4. **Priority 4**: Data completeness indicator
5. Audit UI-database mapping document for more gaps

#### Issue #26: No Audit Trail
**Severity**: MEDIUM
**Impact**: No accountability, difficult troubleshooting, compliance risk

**Details**:
- No tracking of who changed what when
- Data mutations not logged
- Scraper updates overwrite without history
- Admin actions not audited

**Missing Features**:
- User action logging (admin edits)
- Data change history (before/after values)
- Scraper update tracking (source, timestamp)
- API access logging (who called what)

**Potential Solutions**:
1. Implement audit log table (user, action, timestamp, before, after)
2. Middleware to log all mutations
3. Scraper change tracking (store previous values)
4. Admin activity dashboard
5. Compliance reporting (GDPR, audit requirements)

#### Issue #27: No Role-Based Access Control (RBAC)
**Severity**: MEDIUM
**Impact**: Security risk, no permission granularity

**Details**:
- All authenticated admins have full access
- No distinction between viewer, editor, admin
- No field-level permissions (anyone can edit anything)
- Protection system exists but not role-based

**Current State**:
- IPO-level locking (lock entire IPO from edits)
- Field-level protection (lock specific fields)
- No user roles or permissions

**Potential Solutions**:
1. Implement role system (VIEWER, EDITOR, ADMIN, SUPER_ADMIN)
2. Permission matrix (role × action)
3. Field-level permissions (only ADMIN can edit issueSize)
4. Audit log integration with RBAC
5. Role assignment UI in admin panel

#### Issue #28: No API Rate Limiting
**Severity**: MEDIUM
**Impact**: DDoS vulnerability, resource exhaustion

**Details**:
- Public API endpoints have no rate limiting
- Potential for abuse (scraping, DDoS)
- No IP-based throttling
- No API key system

**Current State**:
- All endpoints public (no authentication required)
- No request quotas
- No abuse detection

**Potential Solutions**:
1. Implement rate limiting middleware (express-rate-limit)
2. Redis-based rate limiting (distributed)
3. API key system for authenticated users (higher limits)
4. Tiered rate limits (free, paid, enterprise)
5. DDoS protection (Cloudflare, AWS Shield)

#### Issue #29: No API Versioning
**Severity**: LOW-MEDIUM
**Impact**: Breaking changes affect all clients

**Details**:
- All endpoints at `/api/resource` (no version)
- API contract changes can break frontend
- No deprecation strategy
- No backward compatibility guarantees

**Examples**:
- Changing response format breaks frontend (happened in #15)
- Adding required fields breaks old clients
- Removing fields causes errors

**Potential Solutions**:
1. Implement versioning: `/api/v1/resource`, `/api/v2/resource`
2. Header-based versioning: `Accept: application/vnd.ipodhan.v1+json`
3. Deprecation headers: `X-API-Deprecated: true`
4. Parallel versions (v1 and v2 coexist)
5. API changelog documentation

### 2.8 Deployment & DevOps Issues

#### Issue #30: Manual Deployment Process
**Severity**: MEDIUM
**Impact**: Error-prone, slow, no rollback

**Details**:
- Deployment via PowerShell script (create-deployment-package.ps1)
- Manual transfer to VPS
- Manual npm install and PM2 restart
- No automated testing before deployment
- No rollback mechanism

**Current Process**:
1. Run deployment script locally
2. Transfer ZIP to VPS via SFTP/RDP
3. Extract on VPS
4. Run npm install
5. Restart PM2 processes
6. Manual smoke testing

**Risks**:
- Forgot to run migrations → Database errors
- Dependency issues → Runtime errors
- No pre-deployment validation → Production bugs
- Downtime during deployment (not zero-downtime)

**Potential Solutions**:
1. CI/CD pipeline (GitHub Actions)
2. Automated deployment to VPS (SSH-based)
3. Health check before routing traffic
4. Blue-green deployment (zero downtime)
5. Automated rollback on failure

#### Issue #31: No CI/CD Pipeline
**Severity**: MEDIUM
**Impact**: Manual testing, no quality gates

**Details**:
- No GitHub Actions workflows
- Tests not run automatically on PR
- No automated linting, type checking
- No automated deployment

**Missing Workflows**:
- PR validation (lint, type check, test)
- Automated testing on push to main
- Deployment to staging environment
- Production deployment approval workflow

**Potential Solutions**:
1. GitHub Actions workflow for PR validation
2. Automated integration tests on main branch
3. Staging deployment on merge to main
4. Production deployment on tag creation
5. Slack/Discord notifications for failures

#### Issue #32: No Staging Environment
**Severity**: LOW-MEDIUM
**Impact**: Testing in production, higher risk

**Details**:
- Only production VPS exists
- No staging/UAT environment
- Can't test scrapers on staging data
- Can't validate deployment before production

**Risks**:
- Breaking changes go straight to production
- Can't test performance under load (staging environment)
- Database migrations risky (no staging database)

**Potential Solutions**:
1. Separate staging VPS (cheaper/smaller)
2. Use VPS with staging/production Docker containers
3. Database branching (separate staging database)
4. Feature flags to test in production safely

#### Issue #33: No Monitoring Alerts
**Severity**: MEDIUM
**Impact**: Incidents discovered late, manual monitoring

**Details**:
- Monitoring scripts exist but no alerts
- No uptime monitoring (no Pingdom, UptimeRobot)
- No error rate alerts (no Sentry production integration)
- No scraper failure alerts

**Missing Alerts**:
- Application down (health check fails)
- High error rate (>5% requests fail)
- Slow response time (p95 >1000ms)
- Database connection pool exhausted
- Redis memory usage >80%
- Scraper failure (no data for 24h)

**Potential Solutions**:
1. Integrate Sentry for production (error alerts)
2. Uptime monitoring service (UptimeRobot free tier)
3. CloudWatch alarms (if on AWS)
4. Custom alert script (check health endpoint, send email)
5. PagerDuty/Opsgenie for on-call rotation

### 2.9 Documentation & Knowledge Gaps

#### Issue #34: API Documentation Incomplete
**Severity**: LOW
**Impact**: Developer onboarding difficulty, API misuse

**Details**:
- API specification exists (`docs/02-architecture/api-specification.md`)
- Not comprehensive (missing request/response examples)
- No OpenAPI/Swagger spec
- No interactive API docs (Swagger UI, Postman collection)

**Missing**:
- Request body schemas
- Response body schemas
- Error response examples
- Authentication flow
- Rate limiting details

**Potential Solutions**:
1. Generate OpenAPI spec from code (automated)
2. Swagger UI for interactive docs
3. Postman collection for easy testing
4. Code examples for each endpoint
5. Versioned API docs (per API version)

#### Issue #35: Scraper Source Priority Undocumented
**Severity**: LOW
**Impact**: Confusion about data authoritative source

**Details**:
- UI-Database mapping mentions priority (NSE > BSE > Moneycontrol)
- Not enforced in code
- No conflict resolution documented
- Scrapers overwrite without checking source

**Current Behavior**:
- Last scraper wins (no priority)
- No "data source" tracking in database
- Can't tell which scraper provided which field

**Potential Solutions**:
1. Add `data_source` field to track origin
2. Implement priority in scraper merge logic
3. Document priority in scraper README
4. UI indicator showing data source

#### Issue #36: Database Schema Documentation Drift
**Severity**: LOW
**Impact**: Schema changes not reflected in docs

**Details**:
- Schema management workflow documented
- Schema comments not comprehensive
- UI-database mapping may be stale (created 2025-10-21)
- No automated schema documentation

**Potential Solutions**:
1. Generate schema docs from database (dbdocs.io)
2. Add comments to all tables/columns in schema
3. Automated schema diff on PR
4. Keep UI-database mapping up to date

---

## Part 3: Data Quality Analysis

### 3.1 Data Completeness Metrics

**Analysis based on test database snapshot (2025-10-26)**:

| Data Category | Total IPOs | Records with Data | Completeness | Avg Fields Filled |
|---------------|-----------|-------------------|--------------|-------------------|
| Basic Info | 45 | 45 (100%) | 100% | 17/49 (35%) |
| Financial Data | 45 | 13 (29%) | 29% | 8/25 (32%) |
| Subscriptions | 45 | 3 (7%) | 7% | 4 snapshots avg |
| GMP Records | 45 | 5 (11%) | 11% | 8 records avg |
| Documents | 45 | 9 (20%) | 20% | 2 docs avg |
| Listing Performance | 45 | 17 (38%) | 38% | 5/12 (42%) |
| Peer Companies | 45 | 0 (0%) | 0% | N/A |
| IPO Scores | 45 | 0 (0%) | 0% | N/A |

**Key Insights**:
- **Basic Info**: All IPOs have entry, but only 35% of fields filled on average
- **Critical Gap**: <10% of IPOs have subscription or GMP data
- **Unused Features**: Peer comparison and IPO scoring tables empty (despite code implementation)

### 3.2 Data Quality Issues by Source

| Source | Success Rate | Data Completeness | Issues |
|--------|--------------|-------------------|--------|
| NSE API | 95% | 60% (basic), 40% (subs) | Incomplete data for pre-filing IPOs, session expiry |
| BSE | 70% | 50% (basic) | HTML parsing brittle, frequent breaks |
| Moneycontrol | 65% | 30% (GMP) | HTML changes, inconsistent format |
| Chittorgarh | 60% | 25% (GMP historical) | Slow, requires detail page scraping |

**Reliability Ranking**:
1. NSE API (most reliable, but incomplete for some IPOs)
2. BSE (stable but brittle)
3. Moneycontrol (frequently changes)
4. Chittorgarh (slowest, most brittle)

### 3.3 Field-Level Completeness (Top 20 Fields)

| Field | Completeness | Source | Notes |
|-------|--------------|--------|-------|
| companyName | 100% | NSE/BSE | Always present |
| slug | 100% | Generated | Auto-generated |
| status | 100% | NSE/BSE | Always present |
| category | 98% | NSE/BSE | 2% null (RIGHTS) |
| openDate | 75% | NSE/BSE | Missing for UPCOMING |
| closeDate | 75% | NSE/BSE | Missing for UPCOMING |
| priceRangeMin | 65% | NSE/BSE | Missing for pre-filing |
| priceRangeMax | 65% | NSE/BSE | Missing for pre-filing |
| issueSize | 60% | NSE/BSE | Missing for pre-filing |
| lotSize | 58% | NSE/BSE | 68% were incorrect (fixed) |
| listingDate | 40% | NSE/BSE | Only LISTED IPOs |
| listingGainPercentage | 38% | BSE/NSE | Only LISTED with data |
| sector | 35% | NSE | Often not provided |
| registrar | 30% | NSE/Prospectus | Often missing |
| revenue_fy2023 | 20% | Manual/DRHP | Rarely scraped |
| profit_fy2023 | 20% | Manual/DRHP | Rarely scraped |
| pe_ratio | 15% | Calculated | Requires financial data |
| gmp_latest | 11% | Chittorgarh | Low scrape coverage |
| subscription_total | 7% | NSE | Only OPEN IPOs |
| peer_companies | 0% | Manual | Never populated |

**Critical Missing Data**:
- Financial metrics (<20% coverage)
- Subscription data (<10% coverage)
- GMP data (<15% coverage)
- Peer comparison (0% coverage)

---

## Part 4: Architecture Gaps

### 4.1 Missing Features (Implemented but Hidden)

1. **IPO Scoring System**
   - **Status**: ✅ Fully implemented (32 tests, 93.5% coverage)
   - **Gap**: Not displayed in UI (complete `ipo_scores` table unmapped)
   - **Impact**: Key differentiator hidden from users
   - **Effort**: ~2-3 days to add UI components

2. **Peer Company Comparison**
   - **Status**: ✅ Database table exists (`peer_companies`)
   - **Gap**: No UI implementation, no scraper to populate
   - **Impact**: Valuable comparison feature unavailable
   - **Effort**: ~5-7 days (scraper + UI)

3. **Stock Symbol Display**
   - **Status**: ✅ Fields exist (stock_symbol_nse, stock_symbol_bse, isin)
   - **Gap**: Not displayed anywhere in UI
   - **Impact**: Users can't identify IPO by ticker
   - **Effort**: ~1 day (add to basic info tab)

4. **Data Quality Indicators**
   - **Status**: ⚠️ Calculated in scoring system (confidence score)
   - **Gap**: No UI indicator showing data completeness
   - **Impact**: Users don't know if data is reliable
   - **Effort**: ~2-3 days (completeness badge/progress bar)

5. **Scraper Health Dashboard**
   - **Status**: ⚠️ Logs exist in `scraper_logs` table
   - **Gap**: No admin UI to view scraper status
   - **Impact**: Manual monitoring required
   - **Effort**: ~3-4 days (admin dashboard page)

### 4.2 Missing Features (Not Implemented)

1. **Audit Trail System**
   - **Current**: No tracking of changes
   - **Needed**: User action logging, data change history
   - **Effort**: ~5-7 days (database + middleware + UI)

2. **Role-Based Access Control (RBAC)**
   - **Current**: All admins have full access
   - **Needed**: Roles (VIEWER, EDITOR, ADMIN), permissions
   - **Effort**: ~7-10 days (auth system + UI)

3. **API Rate Limiting**
   - **Current**: No rate limits (DDoS vulnerable)
   - **Needed**: IP-based throttling, API keys, quotas
   - **Effort**: ~3-5 days (middleware + Redis)

4. **CI/CD Pipeline**
   - **Current**: Manual deployment
   - **Needed**: GitHub Actions, automated testing, deployment
   - **Effort**: ~5-7 days (workflows + testing)

5. **API Versioning**
   - **Current**: Single unversioned API
   - **Needed**: /api/v1, /api/v2, deprecation strategy
   - **Effort**: ~3-5 days (routing + migration)

6. **DRHP PDF Parsing**
   - **Current**: Manual financial data entry
   - **Needed**: Automated PDF text extraction, table parsing
   - **Effort**: ~10-14 days (PDF parser + validation)

7. **Multi-Source Data Reconciliation**
   - **Current**: Last scraper wins (no conflict resolution)
   - **Needed**: Source priority, conflict detection, reconciliation UI
   - **Effort**: ~7-10 days (conflict detection + resolution logic + UI)

8. **Real-time Scraper Scheduler**
   - **Current**: Daily cron jobs
   - **Needed**: Dynamic scheduling (hourly for OPEN IPOs)
   - **Effort**: ~5-7 days (scheduler logic + monitoring)

9. **Uptime Monitoring & Alerting**
   - **Current**: No alerts (manual monitoring)
   - **Needed**: Health check monitoring, error alerts, scraper failure alerts
   - **Effort**: ~3-5 days (integration + alert routing)

10. **Advanced Search & Filters**
    - **Current**: Basic listing with limited filters
    - **Needed**: Full-text search, advanced filters (sector, size, GMP range, subscription level)
    - **Effort**: ~5-7 days (search index + UI)

### 4.3 Technical Debt

1. **Duplicate Tables** (~3-5 days to consolidate)
   - 3 GMP tables, 2 subscription tables, 2 financial tables
   - Need audit, migration, and deletion

2. **Legacy Slugs** (~2-3 days to migrate)
   - Regeneration script exists but not executed
   - Risk of breaking existing URLs

3. **Missing Database Indexes** (~2-3 days)
   - Foreign keys not indexed (ipoId in related tables)
   - Significant performance impact

4. **Test Coverage Gaps** (~10-14 days for 80% coverage)
   - Only 40-50% coverage (target 80%)
   - Service layer mostly untested

5. **HTML Scraper Brittleness** (~5-7 days per scraper)
   - BSE, Moneycontrol, Chittorgarh scrapers brittle
   - Need API discovery or robust selectors

6. **Schema Documentation Drift** (~2-3 days)
   - Docs may be stale
   - Need automated schema documentation

---

## Part 5: Performance Bottlenecks

### 5.1 Database Performance

**Slow Queries** (>100ms):
1. `/api/ipos/[slug]` with all relations: ~120-180ms
   - **Cause**: 5 separate queries (IPO + 4 related tables)
   - **Fix**: Use Drizzle joins, reduce to 1-2 queries
   - **Impact**: 40-60% reduction (target <80ms)

2. Listing page with filters: ~80-120ms
   - **Cause**: Full table scan, no indexes on filter columns
   - **Fix**: Add indexes on status, category, sector
   - **Impact**: 50-70% reduction (target <40ms)

3. Subscription time-series query: ~60-90ms
   - **Cause**: No index on ipoId + timestamp
   - **Fix**: Composite index on (ipoId, timestamp DESC)
   - **Impact**: 60-80% reduction (target <20ms)

**Missing Indexes** (high priority):
```sql
CREATE INDEX idx_subscriptions_ipo_id ON subscriptions(ipoId);
CREATE INDEX idx_gmp_records_ipo_id ON gmpRecords(ipoId);
CREATE INDEX idx_financial_data_ipo_id ON financialData(ipoId);
CREATE INDEX idx_documents_ipo_id ON documents(ipoId);
CREATE INDEX idx_subscriptions_ipo_timestamp ON subscriptions(ipoId, timestamp DESC);
CREATE INDEX idx_gmp_records_ipo_timestamp ON gmpRecords(ipoId, timestamp DESC);
CREATE INDEX idx_ipos_status_category ON ipos(status, category);
CREATE INDEX idx_ipos_sector ON ipos(sector);
```

### 5.2 Caching Performance

**Cache Hit Rate** (target >80%):
- IPO detail: ~85% hit rate ✅
- IPO list: ~70% hit rate 🟡 (needs improvement)
- Subscriptions: ~60% hit rate 🟡 (frequent updates)
- GMP: ~75% hit rate ✅

**Cache Invalidation Issues**:
- Mutation doesn't invalidate related caches
- Pattern-based invalidation too broad (clears too much)
- No cache versioning (can't selectively invalidate)

**Recommendations**:
1. Implement cache dependency graph
2. Event-driven invalidation (pub/sub)
3. Shorter TTLs for volatile data (subscriptions: 3m → 1m)
4. Cache versioning for selective invalidation

### 5.3 API Response Times

**Current Performance** (production targets):
| Endpoint | Current p95 | Target p95 | Status | Action Needed |
|----------|-------------|------------|--------|---------------|
| `/api/ipos` (list) | 120ms | <100ms | 🟡 | Add indexes |
| `/api/ipos/[slug]` | 150ms | <100ms | 🟡 | Use joins |
| `/api/ipos/[slug]/score` | 180ms | <200ms | ✅ | None |
| `/api/subscriptions` | 80ms | <100ms | ✅ | None |
| `/api/gmp` | 90ms | <100ms | ✅ | None |
| `/api/health-detailed` | 65ms | <100ms | ✅ | None |

**Potential Optimizations**:
1. Database query optimization (joins instead of N+1)
2. Add missing indexes
3. Implement GraphQL for flexible queries (reduce over-fetching)
4. Response compression (gzip)
5. CDN for static assets

### 5.4 Load Testing Results

**Breaking Points**:
- **100 users**: p95 300ms ✅ Excellent
- **500 users**: p95 480ms ✅ Good
- **1000 users**: p95 650ms 🟡 Degraded
- **1200 users**: Timeouts, 500 errors ❌ Breaking point
- **1500 users**: Complete failure ❌

**Bottlenecks Identified**:
1. Database connection pool (50 connections) - primary limit
2. CPU spikes at 1000+ users (Next.js rendering)
3. Memory usage increases linearly (no leak detected)
4. Redis connections stable (no issues)

**Scaling Recommendations**:
1. **Immediate**: PgBouncer for connection pooling (10x improvement)
2. **Short-term**: Horizontal scaling (2-3 app instances behind load balancer)
3. **Medium-term**: Database read replicas (separate read/write)
4. **Long-term**: Microservices architecture (separate scraper, API, admin)

---

## Part 6: Recommendations & Priorities

### 6.1 High Priority Fixes (1-2 weeks)

**Week 1**:
1. ✅ **Add Missing Database Indexes** (1 day)
   - Immediate 40-60% query performance improvement
   - Low risk, high impact

2. ✅ **Implement IPO Scoring UI** (2-3 days)
   - Unlock hidden key differentiator
   - High user value

3. ✅ **Fix Duplicate Tables** (2-3 days)
   - Reduce data inconsistency risk
   - Clean up technical debt

**Week 2**:
4. ✅ **Add Stock Symbol Display** (1 day)
   - Standard identifier needed by users
   - Quick win

5. ✅ **Implement API Rate Limiting** (2-3 days)
   - Security vulnerability fix
   - Prevent DDoS/abuse

6. ✅ **Setup CI/CD Pipeline** (3-4 days)
   - Improve deployment reliability
   - Foundation for quality gates

### 6.2 Medium Priority Enhancements (3-4 weeks)

**Week 3**:
7. ⚠️ **Improve Scraper Reliability** (5-7 days)
   - Discover BSE/Moneycontrol APIs (reduce HTML parsing)
   - Increase data completeness

8. ⚠️ **Implement Audit Trail** (5-7 days)
   - Compliance and debugging
   - Foundation for RBAC

**Week 4**:
9. ⚠️ **Add Peer Comparison UI** (5-7 days)
   - Implement scraper + frontend
   - High user value feature

10. ⚠️ **Database Query Optimization** (3-5 days)
    - Rewrite N+1 queries with joins
    - 40-60% API performance improvement

### 6.3 Long-Term Strategic Improvements (2-3 months)

**Month 1**:
11. 🔵 **DRHP PDF Parsing** (10-14 days)
    - Automate financial data extraction
    - Increase financial data completeness from 20% to 70%+

12. 🔵 **Advanced Search & Filters** (5-7 days)
    - Full-text search, multi-criteria filters
    - Improve user experience

**Month 2**:
13. 🔵 **Multi-Source Data Reconciliation** (7-10 days)
    - Conflict detection and resolution
    - Improve data quality and reliability

14. 🔵 **Implement RBAC** (7-10 days)
    - Security and permission granularity
    - Foundation for multi-tenant

**Month 3**:
15. 🔵 **Horizontal Scaling Architecture** (10-14 days)
    - Load balancer + multiple app instances
    - Support 5000+ concurrent users

16. 🔵 **Monitoring & Alerting System** (7-10 days)
    - Uptime monitoring, error alerts, scraper alerts
    - Reduce MTTR (mean time to recovery)

### 6.4 Data Quality Improvement Roadmap

**Phase 1: Quick Wins** (2-3 weeks)
- Run listing performance backfill script (37% → 80%+)
- Execute slug regeneration script (fix legacy slugs)
- Add data completeness indicators in UI
- Implement basic data validation in scrapers

**Phase 2: Scraper Enhancements** (1-2 months)
- Discover hidden BSE API (reduce HTML parsing)
- Implement dynamic scheduler (hourly for OPEN IPOs)
- Add multi-source reconciliation logic
- Implement scraper health monitoring

**Phase 3: Advanced Automation** (2-3 months)
- DRHP PDF parsing for financials (20% → 70%+ coverage)
- Historical data backfill (subscription, GMP for old IPOs)
- Peer company scraper (Moneycontrol/Screener)
- Financial data validation and enrichment

**Expected Data Completeness After Roadmap**:
| Category | Current | Phase 1 | Phase 2 | Phase 3 |
|----------|---------|---------|---------|---------|
| Basic Info | 60% | 70% | 85% | 90% |
| Financials | 20% | 25% | 35% | 70% |
| Subscriptions | 7% | 10% | 40% | 60% |
| GMP | 11% | 15% | 35% | 50% |
| Listing Performance | 38% | 80% | 85% | 90% |

---

## Part 7: Questions for LLM Consultation

### 7.1 Data Quality & Scraping

1. **How can we improve NSE API scraping to get 100% data completeness?**
   - Current: 95% success rate, but 30-40% incomplete data
   - Is there a way to detect "draft" IPOs vs "published" IPOs?
   - Should we reject incomplete data or store with "draft" flag?

2. **Best approach for DRHP PDF parsing to extract financial tables?**
   - Should we use OCR + table detection (Tesseract, Tabula)?
   - Or rule-based extraction (regex, keyword matching)?
   - How to handle varying PDF formats across companies?

3. **Multi-source data reconciliation strategy?**
   - When NSE says ₹500 Cr and BSE says ₹480 Cr, which to trust?
   - Should we store all sources and reconcile, or prioritize?
   - How to detect and flag conflicting data for manual review?

4. **How to make HTML scrapers more resilient?**
   - Current: CSS selectors break on every HTML change
   - Should we use semantic HTML, XPath, AI-based extraction?
   - Is there a way to auto-detect scraper breakage?

### 7.2 Architecture & Design

5. **Should we implement GraphQL instead of REST for API?**
   - Current: Over-fetching and under-fetching issues
   - Would GraphQL reduce API calls and improve performance?
   - Migration strategy from REST to GraphQL?

6. **Best pattern for cache invalidation in complex entity relationships?**
   - Current: Pattern-based invalidation too broad
   - Should we use event-driven invalidation (pub/sub)?
   - How to implement cache dependency graph?

7. **Microservices vs Monolith for scraper separation?**
   - Current: Scraper is separate codebase but shares database
   - Should we fully separate scraper into microservice with queue?
   - How to handle eventual consistency between services?

8. **How to implement audit trail without performance impact?**
   - Current: No audit logging
   - Should we use database triggers, middleware, or event sourcing?
   - How to avoid doubling write operations?

### 7.3 Performance & Scalability

9. **Database connection pooling: PgBouncer vs application-level pooling?**
   - Current: 50 connections in Drizzle (breaking point 1200 users)
   - Would PgBouncer provide 10x improvement as expected?
   - Any downsides to PgBouncer (transaction mode, prepared statements)?

10. **Horizontal scaling strategy for Next.js App Router?**
    - Current: Single instance, no load balancer
    - How to handle session state across instances (Redis)?
    - Best load balancer for Windows VPS (Nginx, HAProxy, Caddy)?

11. **Should we migrate to serverless architecture (Vercel, AWS Lambda)?**
    - Current: VPS deployment
    - Would serverless handle 1000+ concurrent users better?
    - Cost comparison: VPS vs serverless at scale?

12. **Database read replicas: when to implement?**
    - Current: Single PostgreSQL instance
    - Is read replica overkill for 1000 users?
    - How to route read queries to replica in Drizzle?

### 7.4 Testing & Quality

13. **How to achieve 80% test coverage without slowing development?**
    - Current: 40-50% coverage, low team velocity
    - Should we use mutation testing (Stryker)?
    - Best practices for testing repositories with real database?

14. **E2E test flakiness: how to eliminate?**
    - Current: 5% failure rate due to timing issues
    - Best wait strategies in Playwright?
    - Should we use visual regression testing instead?

15. **Integration tests: Docker Compose vs in-memory alternatives?**
    - Current: Requires PostgreSQL + Redis running
    - Should we use sqlite for fast tests?
    - Trade-off between speed and production parity?

### 7.5 Data Science & AI

16. **Can we use ML to predict IPO listing gains?**
    - Current: Rule-based IPO scoring (0-10 scale)
    - Features: Financials, subscription, GMP, sector
    - Is there enough historical data (45 IPOs)?

17. **NLP for DRHP analysis: extract risk factors, management quality?**
    - Current: Only extract financial tables
    - Can we analyze DRHP text for sentiment, red flags?
    - Which NLP library/API best for this (spaCy, OpenAI)?

18. **Anomaly detection for scraper data quality?**
    - Current: Manual validation
    - Can we auto-detect outliers (e.g., lot_size = 1 anomaly)?
    - Which algorithm: Z-score, IQR, Isolation Forest?

### 7.6 Security & Compliance

19. **API rate limiting: best algorithm for fairness?**
    - Current: No rate limiting
    - Should we use token bucket, leaky bucket, fixed window?
    - How to handle burst traffic vs sustained traffic?

20. **RBAC implementation: attribute-based vs role-based?**
    - Current: No access control
    - Is ABAC (Attribute-Based Access Control) overkill?
    - How to implement field-level permissions efficiently?

21. **How to secure scrapers from being blocked?**
    - Current: NSE might block if detected as bot
    - Should we use rotating proxies, CAPTCHA solving?
    - Ethical considerations for scraping?

### 7.7 Product & UX

22. **Should we implement IPO alerts/notifications?**
    - Feature: Email/SMS when IPO opens, GMP changes, etc.
    - How to avoid spam (user preferences, digest emails)?
    - Best service for SMS in India (Twilio, MSG91)?

23. **How to gamify IPO research for user engagement?**
    - Ideas: IPO prediction contests, leaderboards, badges
    - Privacy concerns for tracking user predictions?
    - Compliance with gambling laws in India?

24. **Real-time collaboration for IPO analysis?**
    - Feature: Multiple users annotate same IPO (comments, notes)
    - Should we use CRDT, OT, or simple polling?
    - Best library for real-time sync (Socket.io, Pusher, Supabase)?

---

## Appendix: Reference Documentation

### A1. Key Documentation Files

1. **Architecture**:
   - `docs/02-architecture/backend-architecture.md` - Repository & service patterns
   - `docs/02-architecture/testing-strategy.md` - Test pyramid, coverage targets
   - `docs/02-architecture/security-and-performance.md` - Performance targets, security requirements

2. **Database**:
   - `docs/16-database/SCHEMA_MANAGEMENT.md` - Schema workflow, migration process
   - `docs/16-database/screen-table-database-field-mapping.md` - Complete UI-database mapping (1,600+ lines)

3. **Scraping**:
   - `scraper/README.md` - Scraper architecture
   - `scraper/docs/SCRAPING_STRATEGY.md` - NSE API discovery, multi-source strategy
   - `scraper/docs/LOT_SIZE_EXECUTIVE_SUMMARY.md` - Lot size data quality fix

4. **Phase 3 Enhancements**:
   - `packages/shared/docs/SLUG_GENERATION.md` - Canonical slug utilities
   - `web/docs/FUZZY_MATCHING.md` - Intelligent search & fallback
   - `web/docs/IPO_COMPARE_VALIDATION.md` - Dropdown validation

5. **Phase 5 Enhancements**:
   - `web/lib/monitoring/README.md` - Production observability system
   - `test-results/phase-5/real-time-scoring-report.md` - Dynamic IPO scoring
   - `test-results/phase-5/production-load-testing-report.md` - Load testing analysis
   - `test-results/phase-5/integration-testing-report.md` - Integration test results

### A2. Useful Scripts

**Database**:
- `web/scripts/db-health-check.ts` - Database monitoring
- `web/scripts/monitor-redis.ts` - Redis health check
- `web/scripts/recalculate-all-scores.ts` - Recalculate IPO scores

**Data Utilities**:
- `web/scripts/find-complete-ipo-all-tabs.ts` - Find IPOs with multi-tab data
- `web/scripts/check-related-tables.ts` - Analyze related table data
- `web/scripts/regenerate-slugs.ts` - Migrate to canonical slugs

**Scraper**:
- `scraper/src/scripts/test-nse-api.ts` - Test NSE API connection
- `scraper/src/utils/lot-size-validator.ts` - Validate lot size data

**Testing**:
- `web/tests/load/api-load-test.js` - k6 load test
- `web/tests/load/stress-test.js` - k6 stress test
- `web/tests/load/simple-load-test.js` - Node.js load test (no k6 required)

### A3. Metrics & Benchmarks

**Performance Targets**:
- API Response: p95 <500ms, p99 <1000ms
- Page Load: LCP <2.5s, FID <100ms, CLS <0.1
- Database Queries: p95 <100ms
- Cache Hit Rate: >80%

**Load Testing**:
- 100 users: p95 300ms ✅
- 500 users: p95 480ms ✅
- 1000 users: p95 650ms 🟡
- Breaking point: 1200-1500 users

**Data Quality**:
- Basic Info: 60% completeness
- Financials: 20% completeness
- Subscriptions: 7% completeness
- GMP: 11% completeness
- Listing Performance: 38% completeness

**Test Coverage**:
- Unit Tests: ~40-50% (target 80%)
- Integration Tests: 71 tests, 100% pass rate
- E2E Tests: Admin suite + critical journeys
- IPO Scoring: 32 tests, 93.5% coverage

---

## Document Changelog

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2025-10-26 | 1.0 | Initial creation - comprehensive feature & issue inventory | Claude Code |

---

## Usage Instructions for LLMs

**When using this document for consultation**:

1. **For Feature Planning**: Refer to Part 1 (Feature Inventory) and Part 4 (Architecture Gaps) to understand what's implemented and what's missing

2. **For Bug Fixes**: Refer to Part 2 (Known Issues) with detailed root causes and potential solutions

3. **For Data Quality**: Refer to Part 3 (Data Quality Analysis) with metrics and completeness data

4. **For Performance**: Refer to Part 5 (Performance Bottlenecks) with load testing results and optimization opportunities

5. **For Prioritization**: Refer to Part 6 (Recommendations) with phased roadmap (high/medium/long-term)

6. **For Specific Advice**: Refer to Part 7 (Questions) organized by domain (data, architecture, performance, testing, security, product)

**How to structure your consultation response**:
1. Acknowledge the specific question/problem area
2. Reference relevant sections from this document
3. Provide detailed technical recommendations
4. Include code examples if applicable
5. Discuss trade-offs and alternatives
6. Estimate effort and risk
7. Suggest validation/testing approach

**Example Consultation Format**:
```
## Question: How to improve NSE API scraping completeness?

### Context (from document):
- Current: 95% success rate, 30-40% incomplete data
- Issue #6: NSE publishes placeholders before prospectus filing
- No validation layer to reject incomplete responses

### Recommendations:
1. **Implement Draft Detection** (2-3 days, low risk)
   - Check if critical fields (priceRangeMin, issueSize) are 0 or null
   - Mark as "DRAFT" status if incomplete
   - Retry after 7 days

2. **Add Validation Layer** (1-2 days, low risk)
   - Define minimum required fields for each IPO status
   - Reject and log incomplete responses
   - Alert if pattern detected (multiple failures)

3. **Cross-validate with BSE** (3-4 days, medium risk)
   - Scrape BSE for same IPO
   - Accept if both sources agree (confidence boost)
   - Flag if sources conflict (manual review)

### Code Example:
[... detailed implementation ...]

### Trade-offs:
[... analysis ...]
```

---

**End of Document**
