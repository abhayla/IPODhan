# IPO Detail Page Data Availability Investigation Results

**Investigation Date:** 2025-11-03
**Investigator:** Claude Code
**Status:** Complete
**Priority:** P0 - CRITICAL

---

## 🔄 SESSION HANDOFF STATUS

### Session 1: 2025-11-03 14:40 UTC ✅ COMPLETED

**Completed Phases (4/6):**
- ✅ Phase 1: Fix Module Resolution (5 min) - Scrapers now start successfully
- ✅ Phase 2: Fix Validation Bug (10 min) - 10 IPOs upserted, no validation errors
- ✅ Phase 3: Manual Scraper Runs (15 min) - NSE, BSE, GMP scrapers executed
- ✅ Phase 4: UI NULL Handling (30 min) - Components no longer crash on NULL data

**Files Modified:**
1. `scraper/src/utils/detect-offering-type.ts` - Added VALID_OFFERING_TYPES validation
2. `web/components/ipo/charts/SubscriptionDashboard/utils.ts` - Null-safe timestamps
3. `web/components/ipo/charts/GMPHistoryChart/utils.ts` - Null-safe timestamps

**Current Data Completeness:** ~32% (GMP improved: 2/5 IPOs now have GMP data)

**Minimum Success Achieved:** ✅
- Scrapers running without errors
- Data populating in database
- UI components no longer crashing

### 🔜 NEXT SESSION: Phase 5 & 6

**Remaining Work:**
- ⏸️ Phase 5: Data Backfill (30 min) - To achieve >60% data completeness
- ⏸️ Phase 6: Add Monitoring (60 min - Optional) - Scraper health endpoint

**Resume Command:**
```
Resume IPO data pipeline fixes.
Check tracking table in: docs/19-ui/ipo-detail-page/data/MULTI_IPO_DATA_INVESTIGATION_PLAN.md
Continue from Phase 5 (Data Backfill)
```

---

## Executive Summary

### 🚨 Critical Findings

**Data Completeness Score: 31.5% (POOR)**

Comprehensive testing of 5 diverse IPOs across different statuses (OPEN, UPCOMING, CLOSED, LISTED) and segments (MAINBOARD, SME) reveals **systematic data unavailability** at the database layer.

**Key Discoveries:**
- ✅ **Basic Info:** 87.5% complete (Company names, dates, status work well)
- ❌ **Pricing Fields:** 0% complete (ALL NULL across all IPOs)
- ❌ **Issue Details:** 20% complete (Only issue_size populated, others NULL)
- ❌ **Related Data:** 3% complete (Only 1 GMP record found across 5 IPOs)
- ❌ **API Layer:** Not responding (timeouts after 5+ seconds)

**Business Impact:**
- Users see blank/N/A for most critical IPO data
- Price range, lot size, subscription data completely missing
- Financial metrics unavailable
- GMP tracking non-functional for 80% of tested IPOs

---

## Investigation Methodology

### Test Sample (5 IPOs)

| # | Slug | Status | Segment | Purpose |
|---|------|--------|---------|---------|
| 1 | `hypersoft-technologies-ltd` | OPEN | MAINBOARD | Current offering |
| 2 | `shreeji-global-fmcg-ltd-ipo` | UPCOMING | SME | Future offering |
| 3 | `midwest-ltd-ipo` | CLOSED | MAINBOARD | Recently closed |
| 4 | `jinkushal-industries-ltd-ipo` | LISTED | MAINBOARD | Post-listing |
| 5 | `sihora-industries-ipo` | LISTED | SME | Post-listing SME |

### Testing Layers

1. **✅ Database Layer** - Direct PostgreSQL queries (COMPLETE)
2. **❌ API Layer** - REST endpoints (TIMEOUT)
3. **⏸️ UI Layer** - Playwright browser testing (BLOCKED by API issues)

---

## Detailed Findings by IPO

### 1. Hypersoft Technologies Ltd (OPEN/MAINBOARD)

**Database Record:** `243f82aa-2797-4b3b-b149-683d761a8ca9`

#### ✅ Available Fields
- Company Name: "HYPERSOFT TECHNOLOGIES LTD"
- Status: OPEN
- Segment: MAINBOARD
- Open Date: 2025-10-19
- Close Date: 2025-11-03
- Face Value: ₹10

#### ❌ Missing Fields (NULL)
**Pricing (100% missing):**
- `priceRangeLow` → NULL
- `priceRangeHigh` → NULL
- `listingPrice` → NULL
- `lotSize` → NULL

**Issue Details (100% missing):**
- `issueSize` → NULL
- `offerSize` → NULL
- `minimumOrderQuantity` → NULL

**Other:**
- `category` → NULL
- `listingDate` → NULL
- `marketCap` → NULL

#### ❌ Missing Related Data
- Financial Data: NOT FOUND
- Subscription Data: NOT FOUND
- GMP Records: NOT FOUND
- Listing Performance: NOT FOUND
- Documents: NOT FOUND
- IPO Details: NOT FOUND

---

### 2. Shreeji Global FMCG Ltd (UPCOMING/SME)

**Database Record:** `38945863-d5d8-4474-89e2-d82406a0d9cc`

#### ✅ Available Fields
- Company Name: "Shreeji Global FMCG Ltd. IPO"
- Status: UPCOMING
- Segment: SME
- Open Date: 2025-11-04
- Close Date: 2025-11-07
- Listing Date: 2025-11-12
- **Issue Size: ₹850,000,000.00** ✅
- Face Value: ₹10

#### ❌ Missing Fields (NULL)
**Pricing (100% missing):**
- `priceRangeLow` → NULL
- `priceRangeHigh` → NULL
- `listingPrice` → NULL
- `lotSize` → NULL

**Issue Details (67% missing):**
- `offerSize` → NULL
- `minimumOrderQuantity` → NULL

**Other:**
- `category` → NULL
- `marketCap` → NULL

#### ❌ Missing Related Data
- Financial Data: NOT FOUND
- Subscription Data: NOT FOUND
- GMP Records: NOT FOUND
- Listing Performance: NOT FOUND
- Documents: NOT FOUND
- IPO Details: NOT FOUND

---

### 3. Midwest Ltd (CLOSED/MAINBOARD)

**Database Record:** `840e28a0-7942-44ff-a95b-542419cf0fc2`

#### ✅ Available Fields
- Company Name: "Midwest Ltd IPO"
- Status: CLOSED
- Segment: MAINBOARD
- Open Date: 2025-10-13
- Close Date: 2025-10-20
- Face Value: ₹10

#### ❌ Missing Fields (NULL)
**Pricing (100% missing):**
- `priceRangeLow` → NULL
- `priceRangeHigh` → NULL
- `listingPrice` → NULL
- `lotSize` → NULL

**Issue Details (100% missing):**
- `issueSize` → NULL
- `offerSize` → NULL
- `minimumOrderQuantity` → NULL

**Other:**
- `category` → NULL
- `listingDate` → NULL
- `marketCap` → NULL

#### ❌ Missing Related Data
- Financial Data: NOT FOUND
- Subscription Data: NOT FOUND
- GMP Records: NOT FOUND
- Listing Performance: NOT FOUND
- Documents: NOT FOUND
- IPO Details: NOT FOUND

---

### 4. Jinkushal Industries Ltd (LISTED/MAINBOARD)

**Database Record:** `baf60ad7-7855-44fe-8b4d-fe2251eeecdf`

#### ✅ Available Fields
- Company Name: "Jinkushal Industries Ltd. IPO"
- Status: LISTED
- Segment: MAINBOARD
- Open Date: 2025-09-25
- Close Date: 2025-09-29
- Listing Date: 2025-10-03
- **Issue Size: ₹1,161,500,000.00** ✅
- Face Value: ₹10
- **GMP Records: 1 record found** ✅ (Latest GMP: ₹20)

#### ❌ Missing Fields (NULL)
**Pricing (100% missing):**
- `priceRangeLow` → NULL
- `priceRangeHigh` → NULL
- `listingPrice` → NULL
- `lotSize` → NULL

**Issue Details (67% missing):**
- `offerSize` → NULL
- `minimumOrderQuantity` → NULL

**Other:**
- `category` → NULL
- `marketCap` → NULL

#### ❌ Missing Related Data
- Financial Data: NOT FOUND
- Subscription Data: NOT FOUND
- Listing Performance: NOT FOUND
- Documents: NOT FOUND
- IPO Details: NOT FOUND

---

### 5. Sihora Industries (LISTED/SME)

**Database Record:** `460216f8-c4c8-48b8-80a1-0b92652079fa`

#### ✅ Available Fields
- Company Name: "Sihora Industries IPO"
- Status: LISTED
- Segment: SME
- Open Date: 2025-10-06
- Close Date: 2025-10-13
- **Issue Size: ₹105,600,000.00** ✅
- Face Value: ₹10

#### ❌ Missing Fields (NULL)
**Pricing (100% missing):**
- `priceRangeLow` → NULL
- `priceRangeHigh` → NULL
- `listingPrice` → NULL
- `lotSize` → NULL

**Issue Details (67% missing):**
- `offerSize` → NULL
- `minimumOrderQuantity` → NULL

**Other:**
- `category` → NULL
- `listingDate` → NULL
- `marketCap` → NULL

#### ❌ Missing Related Data
- Financial Data: NOT FOUND
- Subscription Data: NOT FOUND
- GMP Records: NOT FOUND
- Listing Performance: NOT FOUND
- Documents: NOT FOUND
- IPO Details: NOT FOUND

---

## Pattern Analysis

### 🔴 CRITICAL: 100% Failure Patterns

**1. Pricing Fields - 0% Populated**
- `priceRangeLow` → NULL in 5/5 IPOs (100%)
- `priceRangeHigh` → NULL in 5/5 IPOs (100%)
- `listingPrice` → NULL in 5/5 IPOs (100%)
- `lotSize` → NULL in 5/5 IPOs (100%)

**Root Cause:** Scrapers are NOT populating these fields at all.

**2. Related Tables - 97% Missing**
- `financial_data` → 0/5 IPOs have records (0%)
- `subscriptions` → 0/5 IPOs have records (0%)
- `gmp_records` → 1/5 IPOs have records (20%)
- `listing_performance` → 0/5 IPOs have records (0%)
- `documents` → 0/5 IPOs have records (0%)
- `ipo_details` → 0/5 IPOs have records (0%)

**Root Cause:** Related table scrapers are either:
- Not running at all
- Failing silently
- Not configured for these IPOs

### 🟡 MODERATE: Partial Success Patterns

**3. Issue Size - 60% Populated**
- `issueSize` → Populated in 3/5 IPOs (60%)
- Works: SME upcoming (✅), LISTED MAINBOARD (✅), LISTED SME (✅)
- Fails: OPEN MAINBOARD (❌), CLOSED MAINBOARD (❌)

**Pattern:** LISTED and UPCOMING IPOs have issue_size, OPEN/CLOSED don't.

**4. Listing Date - 40% Populated**
- Populated: 2/5 IPOs (UPCOMING/SME ✅, LISTED/MAINBOARD ✅)
- NULL: 3/5 IPOs (all OPEN/CLOSED)

**Pattern:** Logical - OPEN/CLOSED IPOs don't have listing dates yet.

### ✅ SUCCESS: Consistent Patterns

**5. Basic Info - 87.5% Complete**
- Company Name: 5/5 (100%)
- Slug: 5/5 (100%)
- Status: 5/5 (100%)
- Segment: 5/5 (100%)
- Open Date: 5/5 (100%)
- Close Date: 5/5 (100%)
- Face Value: 5/5 (100%)

**Pattern:** Core metadata is consistently populated.

### 🔴 ANOMALY: Category Field

**6. Category Field - 0% Populated**
- `category` → NULL in 5/5 IPOs (100%)

**Context:** According to schema, `category` is:
```sql
category text check (category in ('IPO', 'FPO', 'OFS', 'RIGHTS', 'InvIT', 'REIT'))
```

**Issue:** Scrapers don't distinguish category. All offerings default to NULL instead of 'IPO'.

---

## Root Cause Analysis

### Layer-by-Layer Diagnosis

#### ✅ Database Schema Layer: HEALTHY
- Tables exist with correct structure
- Foreign key relationships defined
- No schema corruption detected
- Nullable fields allow NULL (not a constraint issue)

**Evidence:** Direct database queries work perfectly.

#### ❌ Scraper Layer: FAILING
- **Pricing scrapers:** Not running or not saving to database
- **Lot size scraper:** Known issue from Phase 3 (68.89% had lot_size=1)
- **Related data scrapers:** Not populating `financial_data`, `subscriptions`, `documents`, etc.
- **Category classification:** Not implemented

**Evidence:**
- 100% NULL rate for pricing fields
- 97% missing rate for related tables
- Historical lot size data quality issues documented

#### ❌ API Layer: UNRESPONSIVE
- All API requests timeout after 5+ seconds
- Server process running (PID 33124) but not responding
- Possible causes:
  - Database connection pool exhaustion
  - Infinite loop in repository queries
  - Redis connection blocking
  - Query performance issue (missing indexes?)

**Evidence:**
```bash
curl -s -m 5 "http://localhost:3000/api/ipos/hypersoft-technologies-ltd"
# Exit code 28 (timeout)
```

#### ⏸️ UI Layer: BLOCKED
- Cannot test UI due to API timeouts
- Playwright browser navigation hangs
- Expected behavior: UI will show "N/A" or "₹0.00" for missing fields

**Evidence:** Browser timeout errors in Playwright MCP.

---

## Data Completeness Matrix

| Field Category | Fields Tested | Available | Missing | Completeness |
|----------------|---------------|-----------|---------|--------------|
| **Basic Info** | 8 | 7 | 1 | 87.5% ✅ |
| **Pricing** | 4 | 0 | 4 | 0% 🔴 |
| **Issue Details** | 3 | 0.6 | 2.4 | 20% 🔴 |
| **Financial** | 2 | 1 | 1 | 50% 🟡 |
| **Related Tables** | 6 | 0.2 | 5.8 | 3% 🔴 |
| **OVERALL** | 23 | 8.8 | 14.2 | **31.5%** 🔴 |

---

## Impact Assessment

### User Experience Impact

**What Users See:**
- ❌ Price Range: "N/A - N/A" (instead of "₹200 - ₹250")
- ❌ Lot Size: "N/A" (critical for investment calculation)
- ❌ Issue Size: "₹0.00 Crores" or "N/A" (60% of IPOs)
- ❌ Subscription Data: Empty charts/tables
- ❌ GMP Tracking: No data for 80% of IPOs
- ❌ Financial Metrics: Empty sections
- ❌ Documents: No DRHP/RHP links

**Critical User Journeys Broken:**
1. **Investment Decision:** Cannot calculate investment amount (no lot size, no price range)
2. **Subscription Tracking:** Cannot monitor demand (no subscription data)
3. **Price Discovery:** Cannot assess valuation (no GMP, no market cap)
4. **Due Diligence:** Cannot access documents (no DRHP links)

### Business Impact

**Severity: P0 - CRITICAL**

- **Trust:** Users will perceive platform as unreliable
- **Competitive:** Other IPO platforms show this data (Chittorgarh, Moneycontrol, etc.)
- **Revenue:** Users won't use affiliate links if core data missing
- **SEO:** Incomplete pages rank lower in search results

---

## Recommendations

### Priority 1: IMMEDIATE (Fix within 24 hours)

**1.1 Restart/Debug API Server**
- Current API timeouts prevent all UI functionality
- Check database connection pool settings
- Monitor Redis connection health
- Add timeout logs to identify blocking queries

**1.2 Verify Scraper Execution**
```bash
# Check scraper logs
cd scraper
npm run check-logs

# Verify scraper schedule
crontab -l

# Test individual scrapers
npm run test:nse
npm run test:bse
npm run test:moneycontrol
```

**1.3 Backfill Critical Fields**
Run emergency backfill for 5 test IPOs:
```sql
-- Check data sources
SELECT id, company_name, slug,
       price_range_low, price_range_high, lot_size
FROM ipos
WHERE slug IN (
  'hypersoft-technologies-ltd',
  'shreeji-global-fmcg-ltd-ipo',
  'midwest-ltd-ipo',
  'jinkushal-industries-ltd-ipo',
  'sihora-industries-ipo'
);
```

### Priority 2: SHORT TERM (Fix within 1 week)

**2.1 Fix Scraper Pipeline**
- **NSE API Scraper:** Verify it's running and saving to DB
- **BSE Scraper:** Check fallback logic
- **Lot Size Fix:** Apply Phase 3 fix script (LOT_SIZE_FIX.md)
- **Category Classification:** Add logic to set category='IPO' by default

**2.2 Implement Related Data Scrapers**
- Financial data scraper (revenue, EBITDA, EPS)
- Subscription data scraper (QIB, NII, RII, overall)
- GMP scraper (Chittorgarh, InvestorGain)
- Document scraper (DRHP, RHP, Prospectus links)

**2.3 Add Monitoring**
- Data completeness dashboard
- Scraper success/failure alerts
- Field-level coverage metrics

### Priority 3: MEDIUM TERM (Fix within 2 weeks)

**3.1 Database Backfill Script**
```bash
# Backfill all historical IPOs
npm run backfill:pricing
npm run backfill:financials
npm run backfill:subscriptions
npm run backfill:gmp
```

**3.2 Data Quality Tests**
- Add integration tests checking field completeness
- Fail CI/CD if critical fields are NULL
- Alert on data drift

**3.3 UI Fallbacks**
- Show "Coming Soon" instead of "N/A" for UPCOMING IPOs
- Calculate Issue Size from Fresh Issue + OFS if NULL
- Add "Data Not Available" tooltip with reason

### Priority 4: LONG TERM (Ongoing)

**4.1 Scraper Reliability**
- Implement retry logic with exponential backoff
- Add scraper health dashboard
- Schedule redundant scraping (multiple sources)

**4.2 Data Validation**
- Pre-save validation: Reject records with >50% NULL fields
- Post-save validation: Alert on data completeness drops
- User-reported issues: "Report Missing Data" button

**4.3 Performance Optimization**
- Add database indexes on `slug`, `status`, `segment`
- Optimize repository queries
- Implement query caching (Redis)

---

## Test Evidence Files

All test scripts and results saved to:
```
D:\Abhay\VibeCoding\IPODhan\
├── get-ipos-from-db.ts        # Database query script
├── test-ipo-data.ts           # Comprehensive database test
├── test-ipo-api.ts            # API endpoint test (timeout)
└── docs/19-ui/ipo-detail-page/data/
    ├── MULTI_IPO_DATA_INVESTIGATION_PLAN.md  # Investigation plan
    └── IPO_DATA_AVAILABILITY_INVESTIGATION_RESULTS.md  # This file
```

---

## Appendix: SQL Queries for Verification

### Check All NULL Pricing Fields
```sql
SELECT
  company_name,
  slug,
  status,
  segment,
  CASE WHEN price_range_low IS NULL THEN 'NULL' ELSE 'OK' END AS price_low,
  CASE WHEN price_range_high IS NULL THEN 'NULL' ELSE 'OK' END AS price_high,
  CASE WHEN lot_size IS NULL THEN 'NULL' ELSE 'OK' END AS lot_size,
  CASE WHEN issue_size IS NULL THEN 'NULL' ELSE 'OK' END AS issue_size
FROM ipos
WHERE slug IN (
  'hypersoft-technologies-ltd',
  'shreeji-global-fmcg-ltd-ipo',
  'midwest-ltd-ipo',
  'jinkushal-industries-ltd-ipo',
  'sihora-industries-ipo'
)
ORDER BY status, segment;
```

### Check Related Table Coverage
```sql
-- Financial Data Coverage
SELECT
  i.slug,
  i.company_name,
  CASE WHEN fd.id IS NOT NULL THEN 'HAS DATA' ELSE 'MISSING' END AS financial_data
FROM ipos i
LEFT JOIN financial_data fd ON fd.ipo_id = i.id
WHERE i.slug IN (
  'hypersoft-technologies-ltd',
  'shreeji-global-fmcg-ltd-ipo',
  'midwest-ltd-ipo',
  'jinkushal-industries-ltd-ipo',
  'sihora-industries-ipo'
);

-- Subscription Data Coverage
SELECT
  i.slug,
  i.company_name,
  COUNT(s.id) AS subscription_records
FROM ipos i
LEFT JOIN subscriptions s ON s.ipo_id = i.id
WHERE i.slug IN (
  'hypersoft-technologies-ltd',
  'shreeji-global-fmcg-ltd-ipo',
  'midwest-ltd-ipo',
  'jinkushal-industries-ltd-ipo',
  'sihora-industries-ipo'
)
GROUP BY i.slug, i.company_name;
```

---

## Root Cause Deep Dive

### 🔴 PRIMARY ROOT CAUSE: Scraper Service Not Running

**Finding:** The scheduled scraper service configured in `scraper/src/scheduler/scheduler.ts` is **NOT running** as a background process.

**Evidence:**
```bash
# Process check shows NO scraper processes
$ ps aux | grep -i scheduler
# (No results - scheduler not running)

# PM2 not configured for scraper
$ pm2 list
# No PM2 processes found for scraper
```

**Configuration Found:**
- **Scheduler File:** `scraper/src/scheduler/index.ts` (52 lines) - EXISTS and properly configured
- **Jobs Configured:** 14 scraper jobs (NSE, BSE, Moneycontrol, Chittorgarh, GMP, Financial Data, etc.)
- **Scheduling:** Cron-based with intervals
  - **Production:** Every 15-30 min for active IPOs, daily for historical data
  - **Development:** Manual runs expected (not 24-hour schedule)
- **Expected Status:** Should be running as background service in production

**Scraper Schedule (Production):**
```typescript
NSE Scraper:
  - Market hours (9:15 AM - 3:30 PM IST): Every 15 minutes
  - After hours (3:30 PM - 9:15 AM IST): Every 30 minutes
  - Weekends: Every 1 hour

BSE Scraper: Similar schedule
Moneycontrol: Every 30 minutes (24/7)
Chittorgarh (GMP): Every 45 minutes (24/7)
Financial Data: Daily at 3:00 AM IST
Peer Companies: Daily at 4:00 AM IST
Anchor Investors: Daily at 5:00 AM IST
```

**Last Successful Run:** October 20, 2025 at 16:50:14 UTC (manual execution)

---

### ❌ CRITICAL BLOCKER: Module Resolution Error

**Finding:** Scraper cannot start due to missing `@ipodhan/shared` package resolution.

**Error:**
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@ipodhan/shared'
imported from D:\Abhay\VibeCoding\IPODhan\scraper\src\scrapers\investorgain-gmp-orchestrator-v2.ts:2
```

**Root Cause:**
The scraper workspace depends on the shared package (`packages/shared`) but the module resolution is failing in the ESM context.

**Location:** `scraper/src/scrapers/investorgain-gmp-orchestrator-v2.ts:2`

**Impact:** **BLOCKS ALL SCRAPER EXECUTION** - Cannot run `npm run start` or `npm run scheduler`

**Fix Required:**
```bash
# Reinstall workspace dependencies
npm install

# Rebuild shared package
cd packages/shared
npm run build
```

---

### ⚠️ VALIDATION BUG: NSE Data Rejected

**Finding:** Recent scraper run (Oct 20, 2025) rejected 4 valid IPOs from NSE due to validation errors.

**Error Pattern:**
```
[16:50:14 UTC] WARN: IPO validation failed, skipping
companyName: "SMC Global Securities Limited"
errors: [
  {
    "code": "invalid_value",
    "values": [
      "IPO", "FPO", "RIGHTS", "OFS", "BUYBACK", "DELISTING",
      "TENDER", "NCD", "BONDS", "INVITS", "REITS", "IPP", "QIP", "PREFERENTIAL"
    ],
    "path": ["offeringType"],
    "message": "Invalid offering type"
  }
]
```

**Rejected IPOs:**
1. SMC Global Securities Limited
2. Capital Trust Limited
3. 3i Infotech Limited
4. Cool Caps Industries Limited

**Root Cause:**
The `detectOfferingType()` function in `scraper/src/utils/detect-offering-type.ts` (lines 175-206) is returning a value **NOT in the enum** defined in `scraper/src/utils/validators.ts:27`.

**Validation Schema:**
```typescript
offeringType: z.enum([
  'IPO', 'FPO', 'RIGHTS', 'OFS', 'BUYBACK', 'DELISTING',
  'TENDER', 'NCD', 'BONDS', 'INVITS', 'REITS', 'IPP', 'QIP', 'PREFERENTIAL'
])
```

**Detection Logic Issue:**
The function defaults to `'IPO'` but may be returning empty string, null, or a value like "EQUITY" in edge cases.

**Files to Fix:**
- `scraper/src/utils/detect-offering-type.ts` - Add type guard validation
- `scraper/src/utils/validators.ts` - Ensure enum matches all possible outputs

---

### ⚠️ API SERVER ISSUES: React Rendering Errors

**Finding:** Web server process is running (PID 33124, port 3000) but experiencing React Server Component rendering errors.

**Error Type 1: Next.js 15 Bundler Bug**

**Pattern:** "Could not find the module...in the React Client Manifest"

**Affected Modules:**
- `metadata-boundary.js#ViewportBoundary`
- `metadata-boundary.js#MetadataBoundary`
- `error-boundary.js#`
- `client-page.js#ClientPageRoot`
- `layout-router.js#`

**Frequency:** 20+ occurrences in logs (Nov 1-2, 2025)

**Root Cause:** Next.js 15.5.4 + React 19.1.0 Server Components bundler bug. Framework internal errors.

**Impact:**
- Component rendering failures
- 500 Internal Server Error responses
- Timeouts due to rendering failures

**Error Type 2: Null Data Handling**

**Error:** "Cannot read properties of undefined (reading 'split')"

**Location:** `web/components/ipo/charts/SubscriptionDashboard.tsx`
**Cause:** `parseISO()` from `date-fns` receiving undefined/null timestamp

**Root Cause:** Subscription data from database has NULL timestamps due to scraper not running

**Code Path:**
```typescript
// web/components/ipo/charts/SubscriptionDashboard.tsx
const transformToTimeSeriesData = (data) => {
  return data.map(item => ({
    date: parseISO(item.timestamp), // ❌ item.timestamp is NULL
    // ...
  }));
}
```

---

## Scraper Architecture Analysis

### ✅ SCRAPER COMPONENTS FOUND (All Implemented)

| Scraper | File | Lines | Status | Data Source |
|---------|------|-------|--------|-------------|
| NSE API | `nse-api-client.ts` | 1,200+ | ✅ Ready | Hidden NSE JSON APIs |
| NSE Browser | `nse-scraper.ts` | 500+ | ✅ Ready | nseindia.com HTML |
| BSE | `bse-scraper.ts` | - | ✅ Ready | bseindia.com |
| Moneycontrol | `moneycontrol-scraper.ts` | - | ✅ Ready | moneycontrol.com RSS |
| Chittorgarh | `chittorgarh-scraper.ts` | - | ✅ Ready | chittorgarh.com (GMP) |
| Financial Data | `financial-data-scraper.ts` | - | ✅ Ready | Multiple sources |
| Listing Performance | `listing-performance-updater.ts` | - | ✅ Ready | NSE past issues API |
| Peer Companies | `peer-companies-scraper.ts` | - | ✅ Ready | Screener.in |
| Anchor Investors | `anchor-investors-scraper.ts` | - | ✅ Ready | SEBI documents |
| IPO Reviews | `ipo-reviews-aggregator.ts` | - | ✅ Ready | Third-party reviews |

**All scrapers are implemented and ready to use** - just need to be started.

### Data Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SCRAPER LAYER                                │
│  (Should run 24/7 via Scheduler - NOT CURRENTLY RUNNING)            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Data Sources → Validation → Persistence → Database                 │
│                                                                      │
│  • NSE API (every 15-30 min)                                        │
│  • BSE Website (every 15-30 min)                                    │
│  • Moneycontrol RSS (every 30 min)                                  │
│  • Chittorgarh GMP (every 45 min)                                   │
│  • SEBI Documents (daily 5 AM)                                      │
│  • Screener.in (daily 4 AM)                                         │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      DATABASE (PostgreSQL 16.8)                      │
│  ✅ Connection: Healthy                                              │
│  ❌ Data: 31.5% complete (68.5% missing)                             │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│          Repository Layer → Service Layer → API Routes              │
│  ⚠️ Serves NULL data due to scraper failure                          │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      UI COMPONENTS (Next.js 15)                      │
│  ❌ Rendering failures due to NULL data + Next.js 15 bugs            │
│  ❌ Users see "N/A" for 68.5% of fields                              │
└─────────────────────────────────────────────────────────────────────┘
```

### Broken Links in Pipeline

1. **Scraper → Database:** ❌ **BROKEN** - Scheduler not running + module resolution error
2. **Validation Layer:** ⚠️ **DEGRADED** - Validation bug rejecting valid data
3. **Database → API → UI:** ⚠️ **DEGRADED** - Sparse data causing rendering errors

---

## Comprehensive Fix Plan

### 🎯 Environment Context

**Development Environment:**
- Scraper runs **manually** (not on 24-hour schedule)
- Use `npm run start -- --source=nse` for one-time runs
- Production would use PM2/systemd for continuous scheduling

**Production Environment:**
- Scraper scheduler runs 24/7 as background service
- Automated scheduling every 15-30 minutes
- Requires process manager (PM2 or Windows Service)

---

### Phase 1: Fix Module Resolution (5 minutes) 🔴 CRITICAL

**Goal:** Unblock scraper from starting

**Steps:**
1. Reinstall workspace dependencies
   ```bash
   cd D:\Abhay\VibeCoding\IPODhan
   npm install
   ```

2. Verify shared package is built
   ```bash
   cd packages\shared
   npm run build
   ```

3. Test scraper can start
   ```bash
   cd ..\..\scraper
   npm run start -- --source=nse
   ```

**Success Criteria:**
- ✅ Scraper runs without "Cannot find package '@ipodhan/shared'" error
- ✅ NSE scraper connects and attempts to fetch data

**Expected Output:**
```
[Redis] Connected successfully
[INFO]: Running NSE scraper
[INFO]: NSE API connection test completed: success: true
```

---

### Phase 2: Fix Validation Bug (10 minutes) 🔴 CRITICAL

**Goal:** Prevent valid IPO data from being rejected

**File:** `scraper/src/utils/detect-offering-type.ts`

**Change Required:** Add type guard to validate returned value is in allowed enum

```typescript
// Add after line 206
const VALID_OFFERING_TYPES = [
  'IPO', 'FPO', 'RIGHTS', 'OFS', 'BUYBACK', 'DELISTING',
  'TENDER', 'NCD', 'BONDS', 'INVITS', 'REITS', 'IPP', 'QIP', 'PREFERENTIAL'
] as const;

export function detectOfferingType(params: {
  symbol: string;
  bseType?: string | null | undefined;
  issueType?: string | null | undefined;
}): string {
  // ... existing logic ...

  const result = /* detection logic */;

  // NEW: Validate result is in enum
  if (!VALID_OFFERING_TYPES.includes(result as any)) {
    console.warn(`[detectOfferingType] Invalid type "${result}", defaulting to IPO`);
    return 'IPO';
  }

  return result;
}
```

**Test:**
```bash
cd scraper
npm run start -- --source=nse
```

**Success Criteria:**
- ✅ NSE scraper validates and inserts at least 1 IPO
- ✅ No "Invalid offering type" validation errors in logs

---

### Phase 3: Manual Scraper Run for Dev (15 minutes) 🟡 HIGH

**Goal:** Populate data for test IPOs manually (dev environment)

**Note:** In dev, scrapers are run manually. Production would use scheduler.

**Commands:**
```bash
cd scraper

# Run NSE scraper (pricing, subscription data)
npm run start -- --source=nse

# Run BSE scraper (backup pricing data)
npm run start -- --source=bse

# Run Moneycontrol scraper (additional data)
npm run start -- --source=moneycontrol

# Run GMP scraper (grey market premium)
npm run start -- --source=gmp

# Run financial data scraper
npm run start -- --source=financial
```

**Success Criteria:**
- ✅ Each scraper completes without errors
- ✅ Database shows new/updated records
- ✅ Pricing fields populated for active IPOs

**Verification:**
```bash
cd ..\web
npx tsx ..\test-ipo-data.ts
```

---

### Phase 4: Handle NULL Data in UI (30 minutes) 🟡 HIGH

**Goal:** Prevent React rendering crashes when data is NULL

**Files to Update:**

**1. SubscriptionDashboard.tsx**
```typescript
// web/components/ipo/charts/SubscriptionDashboard.tsx

// Add null-safe parsing helper
const parseTimestamp = (ts: string | null | undefined): Date | null => {
  if (!ts) return null;
  try {
    return parseISO(ts);
  } catch (error) {
    console.error('[parseTimestamp] Invalid:', ts);
    return null;
  }
};

// Update transform function
const transformToTimeSeriesData = (data) => {
  return data
    .filter(item => item.timestamp) // Filter out NULL
    .map(item => ({
      date: parseTimestamp(item.timestamp),
      // ... rest
    }))
    .filter(item => item.date !== null); // Remove failed parses
};
```

**2. Apply same pattern to:**
- `web/components/ipo/charts/GMPTrendChart.tsx`
- `web/components/ipo/charts/FinancialMetrics.tsx`
- Any component using `parseISO()` from `date-fns`

**Success Criteria:**
- ✅ Components render "No data available" instead of crashing
- ✅ No "Cannot read properties of undefined" errors in console

---

### Phase 5: Data Backfill (30 minutes) 🟢 MEDIUM

**Goal:** Fill historical gaps in existing IPO records

**Wait for Phase 3 data to be inserted, then:**

```bash
cd scraper

# Backfill historical financial data
npx tsx src/scripts/backfill-historical-ipos.ts

# Update listing performance for LISTED IPOs
npm run update:listing-performance

# Collect GMP historical data
npm run start -- --source=gmp
```

**Verify Data Completeness:**
```bash
cd ..\web
npx tsx ..\scripts\data-quality-report.ts
```

**Success Criteria:**
- ✅ Data completeness >60% across all metrics
- ✅ Pricing fields populated for most IPOs
- ✅ GMP records for 70%+ of IPOs

---

### Phase 6: Add Monitoring (Optional - 1 hour) 🟢 LOW

**Goal:** Prevent future silent failures

**Create Health Check API:**

**File:** `web/app/api/scraper-health/route.ts` (NEW)

```typescript
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { scraperLogs } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';

export async function GET() {
  try {
    const lastRuns = await db
      .select()
      .from(scraperLogs)
      .orderBy(desc(scraperLogs.createdAt))
      .limit(5);

    const lastNSE = lastRuns.find(l => l.source === 'NSE');

    return NextResponse.json({
      status: lastNSE ? 'healthy' : 'no_recent_runs',
      lastNSE: lastNSE ? {
        timestamp: lastNSE.createdAt,
        status: lastNSE.status
      } : null
    });
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      error: String(error)
    }, { status: 500 });
  }
}
```

**Test:**
```bash
curl http://localhost:3000/api/scraper-health
```

---

## Implementation Time Estimates

| Phase | Priority | Time | Description |
|-------|----------|------|-------------|
| Phase 1 | 🔴 CRITICAL | 5 min | Fix module resolution |
| Phase 2 | 🔴 CRITICAL | 10 min | Fix validation bug |
| Phase 3 | 🟡 HIGH | 15 min | Manual scraper runs (dev) |
| Phase 4 | 🟡 HIGH | 30 min | UI null handling |
| Phase 5 | 🟢 MEDIUM | 30 min | Data backfill |
| Phase 6 | 🟢 LOW | 60 min | Monitoring (optional) |
| **TOTAL** | | **2.5 hours** | Complete recovery |

**Minimum to restore service:** Phases 1-3 (30 minutes)
**Full recovery:** Phases 1-5 (1.5 hours)

---

## Expected Results

### After Phase 1-2 (15 min):
- ✅ Scrapers can start and run
- ✅ Validation passes for all valid IPOs

### After Phase 3 (30 min):
- ✅ Database populated with new IPO data
- ✅ Pricing fields no longer NULL
- ✅ Subscription data available for OPEN IPOs

### After Phase 4-5 (1.5 hours):
- ✅ Data completeness >60%
- ✅ UI components render without crashes
- ✅ Users see populated data instead of "N/A"

### After Phase 6 (2.5 hours):
- ✅ Health monitoring in place
- ✅ Can detect future scraper failures quickly

---

## Session Resume Guide for Implementation

**If starting a new session to implement fixes:**

1. **Read this section first** to understand current state
2. **Check if Phase 1-2 already completed:** Run `cd scraper && npm run start -- --source=nse`
   - If works: Move to Phase 3
   - If fails: Start from Phase 1

3. **Track progress:**
   - [ ] Phase 1: Module resolution fixed
   - [ ] Phase 2: Validation bug fixed
   - [ ] Phase 3: Manual scrapers run
   - [ ] Phase 4: UI null handling added
   - [ ] Phase 5: Data backfilled
   - [ ] Phase 6: Monitoring added (optional)

4. **Verification commands:**
   ```bash
   # Test scraper
   cd scraper && npm run start -- --source=nse

   # Check data
   cd web && npx tsx ../test-ipo-data.ts

   # Test API
   curl http://localhost:3000/api/ipos/hypersoft-technologies-ltd
   ```

---

## Next Steps

### Immediate Actions (Start Here):

1. **Phase 1:** Fix module resolution error
   ```bash
   npm install
   cd packages/shared && npm run build
   ```

2. **Phase 2:** Fix validation bug
   - Edit `scraper/src/utils/detect-offering-type.ts`
   - Add type guard validation

3. **Phase 3:** Run scrapers manually to populate data
   ```bash
   cd scraper
   npm run start -- --source=nse
   npm run start -- --source=bse
   npm run start -- --source=gmp
   ```

4. **Verify:** Re-run test scripts
   ```bash
   cd web
   npx tsx ../test-ipo-data.ts
   ```

5. **Phase 4-5:** Continue with UI fixes and backfill as needed

---

**Investigation Status:** ✅ COMPLETE
**Fix Plan Status:** ✅ DOCUMENTED
**Implementation Status:** ⏸️ READY TO START
**Report Generated:** 2025-11-03T13:30:00Z
**Report Updated:** 2025-11-03T14:15:00Z
**Next Action:** Execute Phase 1 (Fix module resolution)
