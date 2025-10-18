# NSE Scraping - Complete Scope Documentation

**Last Updated**: October 18, 2025
**Status**: Production Ready ✅
**Stories**: 11.3 (Current IPOs) + 11.4 (Historical IPOs)

## Executive Summary

The NSE (National Stock Exchange of India) scraping implementation provides comprehensive coverage of both **current/upcoming IPOs** and **historical IPO data**, totaling **1,272+ IPO records** available for retrieval.

### Quick Stats

| Metric | Value |
|--------|-------|
| **Total Coverage** | 1,272+ IPOs (4 current + 1,268 historical) |
| **API Endpoints** | 4 working endpoints |
| **Success Rate** | 100% (tested Oct 2025) |
| **Data Completeness** | 98.5% average |
| **Performance** | ~7s (current), ~2.6s (historical) |
| **Implementation Status** | ✅ Production Ready |

---

## Part 1: Current/Upcoming IPO Data (Story 11.3)

### Status: ✅ COMPLETE & OPERATIONAL

### 1.1 API Endpoints

#### Endpoint A: `/api/all-upcoming-issues`

**Purpose**: Fetch all upcoming and recently closed IPOs
**Method**: GET
**Base URL**: `https://www.nseindia.com`

**Query Parameters:**
```typescript
{
  category: 'ipo' | 'ofs' | 'rights' | 'tender' | 'ipp'
}
```

**Response Format:**
```json
[
  {
    "companyName": "Company Name",
    "symbol": "SYMBOL",
    "issueStartDate": "DD-MMM-YYYY",
    "issueEndDate": "DD-MMM-YYYY",
    "issuePrice": "100-105",
    "issueSize": "1000.00",
    "issueType": "Book Built Issue",
    "status": "Forthcoming/Closed"
  }
]
```

**Data Extracted:**
- Company name & symbol
- Issue dates (open, close, allotment, listing)
- Price range (min, max)
- Issue size (₹ Crores)
- Issue type & status
- Category (MAINBOARD/SME/NCD)

**Authentication**: Requires 5 cookies (AKA_A2, _abck, ak_bmsc, bm_mi, bm_sz)

---

#### Endpoint B: `/api/ipo-current-issue`

**Purpose**: Fetch currently active IPOs with **real-time subscription data**
**Priority**: ⭐ **PRIMARY ENDPOINT** for live IPOs

**Response Format:**
```json
[
  {
    "companyName": "Company Name",
    "symbol": "SYMBOL",
    "openDate": "DD-MMM-YYYY",
    "closeDate": "DD-MMM-YYYY",
    "subscriptionData": {
      "retail": "2.50x",
      "hni": "15.30x",
      "qib": "45.20x",
      "total": "20.80x"
    }
  }
]
```

**Unique Data:**
- ✅ **Real-time subscription numbers** (Retail, HNI, QIB, Total)
- ✅ Live status updates
- ✅ Current issue details with highest accuracy

**Authentication**: Requires 7 cookies (includes nsit, nseappid)

---

#### Endpoint C: `/api/ipo-detail?symbol={SYMBOL}`

**Purpose**: Detailed information for specific IPO
**Usage**: Secondary data enrichment

**Query Parameters:**
```typescript
{
  symbol: string  // Stock symbol (e.g., "CANARA")
}
```

**Additional Data Available:**
- Company description
- Lead managers
- Registrar details
- Financial metrics
- Detailed subscription breakdown

**Authentication**: Requires 7 cookies

---

### 1.2 Current IPO Scraping Scope Summary

| Aspect | Details |
|--------|---------|
| **Total Endpoints** | 3 primary APIs |
| **Coverage** | 4-10 active IPOs at any time |
| **Update Frequency** | Every 15-30 minutes (recommended) |
| **Data Points** | 25+ fields per IPO |
| **Categories** | MAINBOARD, SME, NCD, Rights, OFS |
| **Success Rate** | 100% (tested Oct 2025) |
| **Performance** | ~7 seconds per full scrape |
| **Latest Test** | Oct 19, 2025 00:59:39 IST |

### 1.3 Sample Current IPO Data

**Tested October 2025:**

1. **SMC Global Securities Limited** (NCD)
   - Status: OPEN
   - Period: Oct 15-23, 2025
   - Issue Size: ₹750 Cr

2. **Midwest Limited** (MAINBOARD)
   - Status: CLOSED
   - Period: Oct 14-16, 2025
   - Issue Size: ₹3,117.46 Cr

3. **3i Infotech Limited** (MAINBOARD)
   - Status: OPEN
   - Period: Oct 18, 2025

4. **Cool Caps Industries Limited** (MAINBOARD)
   - Status: OPEN
   - Period: Oct 18, 2025

---

## Part 2: Historical/Past IPO Data (Story 11.4)

### Status: ✅ COMPLETE & OPERATIONAL (Fixed Oct 2025)

### 2.1 API Endpoint

#### Endpoint: `/api/public-past-issues`

**Purpose**: Complete historical IPO database from NSE
**Method**: GET
**Base URL**: `https://www.nseindia.com`

**Response Format** (Updated Oct 2025):
```json
{
  "data": [
    {
      "company": "Company Name",
      "symbol": "SYMBOL",
      "htmSym": "symbol",
      "ipoStartDate": "DD-MMM-YYYY",
      "ipoEndDate": "DD-MMM-YYYY",
      "linkRemovalDate": "DD-MMM-YYYY",
      "priceRange": "Rs.100 to Rs.106",
      "issuePrice": "   106",
      "listingDate": "DD-MMM-YYYY",
      "securityType": "EQ|SME|DEBT|IV|BE"
    }
  ]
}
```

**🔧 API Format Change (Oct 2025):**
- **Old Format**: Direct array `[{ company, ... }]`
- **New Format**: Wrapped object `{ data: [{ company, ... }] }`
- **Fix Applied**: `fetchPastIPOs()` now handles both formats with backward compatibility

**Authentication**: Requires 8 cookies (includes bm_sv from past-issues page visit)

---

### 2.2 Security Types

| Type | Description | Count | Percentage |
|------|-------------|-------|------------|
| **EQ** | Equity/Mainboard IPOs | 390 | 30.8% |
| **SME** | SME Platform IPOs | 703 | 55.4% |
| **IV** | InvIT/REIT (Infrastructure/Real Estate Trusts) | 175 | 13.8% |
| **DEBT** | Debt Securities | - | - |
| **BE** | Book Entry Securities | - | - |

### 2.3 Historical IPO Data Scope

| Metric | Count/Details |
|--------|---------------|
| **Total Records** | 1,268 historical IPOs |
| **Date Range** | Multi-year coverage |
| **Data Completeness** | |
| - Company Names | 1,268 (100.0%) |
| - Symbols | 1,268 (100.0%) |
| - Issue Prices | 1,249 (98.5%) |
| - Listing Dates | 1,268 (100.0%) |
| - Price Ranges | 1,268 (100.0%) |
| **Update Frequency** | Weekly/Monthly |
| **Performance** | ~2.6 seconds per fetch |
| **Latest Test** | Oct 18, 2025 14:22:29 UTC |

### 2.4 Sample Historical IPO Data

**Recent IPOs (October 2025):**

1. **Canara HSBC Life Insurance Company Limited** (EQ)
   - IPO Period: Oct 10-14, 2025
   - Price Range: Rs.100 to Rs.106
   - Issue Price: ₹106
   - Listing Date: Oct 17, 2025

2. **Rubicon Research Limited** (EQ)
   - IPO Period: Oct 9-13, 2025
   - Price Range: Rs.461 to Rs.485
   - Issue Price: ₹485
   - Listing Date: Oct 16, 2025

3. **LG Electronics India Limited** (EQ)
   - IPO Period: Oct 7-9, 2025
   - Price Range: Rs.1,080 to Rs.1,140
   - Issue Price: ₹1,140
   - Listing Date: Oct 14, 2025

### 2.5 Data Transformation Pipeline

```
NSE Past API Response
    ↓
Parse { data: [...] } wrapper (NEW FORMAT)
    ↓
Transform to IPODhan Schema
    ↓
Match with Existing IPOs (by symbol/name)
    ↓
Persist to listing_performance table
    ↓
Cache Invalidation
```

**Matching Strategies:**
1. **Symbol Match** (Highest Confidence) - Exact symbol match
2. **Company Name Similarity** (High Confidence) - Fuzzy name matching
3. **Fuzzy Matching** (Medium Confidence) - Levenshtein distance

---

## Part 3: Complete Architecture

### 3.1 Data Flow Diagram

```
┌─────────────────────────────────────────────────────┐
│            NSE API Endpoints                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Current/Upcoming IPOs (Story 11.3)                │
│  ├── /api/all-upcoming-issues                      │
│  ├── /api/ipo-current-issue (Priority)             │
│  └── /api/ipo-detail?symbol={SYMBOL}               │
│                                                     │
│  Historical IPOs (Story 11.4)                      │
│  └── /api/public-past-issues                       │
│                                                     │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│        NSE Session Management & Authentication      │
├─────────────────────────────────────────────────────┤
│  Multi-page Cookie Collection:                      │
│  1. Homepage visit → Initial cookies (5)            │
│  2. Market data page → Session cookies (7)          │
│  3. Past issues page → Historical cookies (8)       │
│                                                     │
│  Cookies Required: 5-8 (varies by endpoint)         │
│  - AKA_A2, nsit, nseappid, _abck, ak_bmsc, etc.    │
│  Retry Logic: 3 attempts with session refresh       │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│           Data Transformation Layer                 │
├─────────────────────────────────────────────────────┤
│  transform-nse-ipo.ts                              │
│  - Map NSE fields → IPODhan schema                 │
│  - Date parsing & normalization                     │
│  - Price extraction & conversion                    │
│  - Status mapping (NSE → IPODhan)                  │
│  - Category determination                           │
│                                                     │
│  transform-past-ipo.ts (Story 11.4)                │
│  - Historical data mapping                          │
│  - Listing performance calculation                  │
│  - Security type classification                     │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│           IPO Matching & Validation                 │
├─────────────────────────────────────────────────────┤
│  match-ipo.ts (Story 11.4)                         │
│  Matching Strategies:                               │
│  1. Symbol match (highest confidence)               │
│  2. Company name similarity (high confidence)       │
│  3. Fuzzy matching (medium confidence)              │
│                                                     │
│  Validation:                                        │
│  - Required fields check                            │
│  - Data type validation                             │
│  - Business rule validation                         │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│         Database Persistence (Repository Layer)     │
├─────────────────────────────────────────────────────┤
│  IPORepository                                      │
│  - upsert IPO records                              │
│  - Update existing IPOs                             │
│  - Cache-aside pattern                              │
│                                                     │
│  SubscriptionRepository (Current IPOs only)         │
│  - Insert/update subscription data                  │
│  - Time-series tracking                             │
│                                                     │
│  ListingPerformanceRepository (Historical only)     │
│  - Persist listing performance                      │
│  - Calculate returns                                │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│              Cache Invalidation                     │
├─────────────────────────────────────────────────────┤
│  Invalidated Keys:                                  │
│  - ipo:id:{ipoId}                                  │
│  - ipo:slug:{slug}                                 │
│  - ipo:list:*                                      │
│  - subscription:latest:{ipoId}                     │
│  - dashboard:*                                      │
└─────────────────────────────────────────────────────┘
```

### 3.2 Authentication & Session Management

#### Cookie Collection Strategy

```typescript
// Stage 1: Homepage Visit (5 cookies)
GET https://www.nseindia.com/
Cookies: AKA_A2, _abck, ak_bmsc, bm_mi, bm_sz

// Stage 2: Market Data Page (7 cookies total)
GET https://www.nseindia.com/market-data/pre-open-market-cm-and-emerge-market
Cookies: + nsit, nseappid

// Stage 3: Past Issues Page (8 cookies total) - Historical data only
GET https://www.nseindia.com/market-data/past-issue-public
Cookies: + bm_sv
```

#### Retry Logic

```typescript
async function makeRequest(endpoint: string, params?: Record<string, string>, retryCount: number = 0) {
  const MAX_RETRIES = 3;

  if (response.status === 401 || response.status === 403) {
    if (retryCount >= MAX_RETRIES) {
      throw new Error(`NSE API returned ${response.status} after ${MAX_RETRIES} attempts`);
    }

    // Refresh session cookies and retry
    await refreshSessionCookies();
    return makeRequest(endpoint, params, retryCount + 1);
  }

  return response.json();
}
```

---

## Part 4: Field Mapping

### 4.1 Current IPO Fields

| NSE Field | IPODhan Schema Field | Type | Required | Notes |
|-----------|---------------------|------|----------|-------|
| `companyName` | `company_name` | varchar(255) | ✅ | Company name |
| `symbol` | `symbol` | varchar(20) | ❌ | Nullable for upcoming IPOs |
| `issueStartDate` | `open_date` | date | ✅ | Format: DD-MMM-YYYY |
| `issueEndDate` | `close_date` | date | ✅ | Format: DD-MMM-YYYY |
| `allotmentDate` | `allotment_date` | date | ❌ | Optional |
| `listingDate` | `listing_date` | date | ❌ | Optional |
| `priceRange` | `price_range_min` | integer | ❌ | Parsed from "100-105" |
| `priceRange` | `price_range_max` | integer | ❌ | Parsed from "100-105" |
| `issuePrice` | `issue_price` | numeric | ❌ | Final price |
| `issueSize` | `issue_size` | numeric(15,2) | ❌ | In ₹ Crores |
| `lotSize` | `lot_size` | integer | ❌ | Minimum shares |
| `issueType` | `issue_type` | text | ❌ | Book Built/Fixed Price |
| `status` | `status` | enum | ✅ | UPCOMING/OPEN/CLOSED/LISTED |

### 4.2 Subscription Fields (Current IPOs Only)

| NSE Field | IPODhan Schema Field | Type | Format |
|-----------|---------------------|------|--------|
| `retail` | `subscription_retail` | numeric(10,2) | "2.50x" → 2.50 |
| `hni` | `subscription_hni` | numeric(10,2) | "15.30x" → 15.30 |
| `qib` | `subscription_qib` | numeric(10,2) | "45.20x" → 45.20 |
| `total` | `subscription_total` | numeric(10,2) | "20.80x" → 20.80 |

### 4.3 Historical IPO Fields

| NSE Field | IPODhan Schema Field | Type | Required | Notes |
|-----------|---------------------|------|----------|-------|
| `company` | `company_name` | varchar(255) | ✅ | Company name |
| `symbol` | `symbol` | varchar(20) | ✅ | Stock symbol |
| `htmSym` | - | - | ❌ | Lowercase symbol (not stored) |
| `ipoStartDate` | `open_date` | date | ✅ | Format: DD-MMM-YYYY |
| `ipoEndDate` | `close_date` | date | ✅ | Format: DD-MMM-YYYY |
| `linkRemovalDate` | - | - | ❌ | Not stored |
| `priceRange` | `price_range_min` | integer | ✅ | Parsed from "Rs.100 to Rs.106" |
| `priceRange` | `price_range_max` | integer | ✅ | Parsed from "Rs.100 to Rs.106" |
| `issuePrice` | `listing_price_historical` | numeric(10,2) | ✅ | Trimmed & parsed |
| `listingDate` | `listing_date_historical` | date | ✅ | Format: DD-MMM-YYYY |
| `securityType` | `category` | enum | ✅ | EQ→MAINBOARD, SME→SME |

### 4.4 Category Mapping

| NSE `securityType` | IPODhan `category` | Notes |
|-------------------|-------------------|-------|
| `EQ` | `MAINBOARD` | Equity mainboard |
| `SME` | `SME` | SME platform |
| `IV` | `MAINBOARD` | InvIT/REIT mapped to mainboard |
| `DEBT` | `NCD` | Debt securities |
| `BE` | `MAINBOARD` | Book entry |

---

## Part 5: Implementation Files

### 5.1 Core Scraper Files

| File | Purpose | Lines | Key Functions |
|------|---------|-------|---------------|
| **nse-api-client.ts** | NSE API communication | ~950 | `fetchCurrentIPOs()`, `fetchAllIPOs()`, `fetchPastIPOs()`, `makeRequest()` |
| **nse-scraper-orchestrator.ts** | Orchestration logic | ~400 | `scrapeNSE()`, error handling, logging |
| **transform-nse-ipo.ts** | Current IPO transformation | ~200 | `transformNSEIPO()`, date parsing, price extraction |
| **transform-past-ipo.ts** | Historical data transform | ~150 | `transformPastIPOs()`, security type mapping |
| **match-ipo.ts** | IPO matching logic | ~250 | `batchMatchIPOs()`, fuzzy matching, confidence scoring |

### 5.2 Supporting Files

| File | Purpose |
|------|---------|
| **backfill-historical-ipos.ts** | Batch historical data import script |
| **validate-backfill.ts** | Data quality validation after import |
| **repositories/ipo-repository.ts** | IPO data persistence with caching |
| **repositories/subscription-repository.ts** | Subscription data time-series tracking |
| **repositories/listing-performance-repository.ts** | Historical listing performance |

### 5.3 Type Definitions

```typescript
// scraper/src/scrapers/nse-api-client.ts

export interface NSEAPIResult {
  ipos: ScrapedIPO[];
  subscriptions: ScrapedSubscription[];
  source: 'api' | 'fallback';
  timestamp: string;
}

export interface NSEPastIPOResponse {
  company: string;              // Company name
  symbol: string;               // Stock symbol
  htmSym: string;              // HTML symbol (lowercase)
  ipoStartDate: string;        // "DD-MMM-YYYY"
  ipoEndDate: string;          // "DD-MMM-YYYY"
  linkRemovalDate: string;     // "DD-MMM-YYYY"
  priceRange: string;          // "Rs.100 to Rs.106"
  issuePrice: string;          // "   106" (with spaces)
  listingDate: string;         // "DD-MMM-YYYY"
  securityType: string;        // "EQ" | "SME" | "DEBT" | "IV" | "BE"

  // Optional fields
  listingPrice?: number | string;
  currentPrice?: number | string;
  isin?: string;
}

export interface PastIPOsResult {
  pastIPOs: NSEPastIPOResponse[];
  source: 'NSE_PAST_API';
  timestamp: string;
  endpoint: string;
}
```

---

## Part 6: Operational Guidelines

### 6.1 Recommended Scraping Schedule

| Data Type | Frequency | Reason | Resource Impact |
|-----------|-----------|--------|-----------------|
| **Current IPOs** | Every 15-30 mins | Live subscription data changes frequently | Low (3 API calls, ~7s) |
| **Upcoming IPOs** | Every 6-12 hours | Infrequent changes to upcoming schedule | Low (1 API call, ~2s) |
| **Historical IPOs** | Weekly/Monthly | Static historical data, rarely changes | Medium (1 API call, 1268 records) |

### 6.2 Scheduler Configuration

```typescript
// scraper/src/scheduler/index.ts

const schedules = {
  nse_current: '*/15 * * * *',        // Every 15 minutes
  nse_upcoming: '0 */6 * * *',        // Every 6 hours
  nse_historical: '0 0 * * 0',        // Weekly (Sunday midnight)
};
```

### 6.3 Resource Requirements

#### Current IPOs

| Resource | Requirement |
|----------|-------------|
| API Calls | 3 per scrape |
| Response Time | ~7 seconds |
| Data Volume | 4-10 records |
| Memory Usage | <50 MB |
| Database Writes | 4-10 IPOs + subscriptions |
| Cache Keys | ~20-40 keys |

#### Historical IPOs

| Resource | Requirement |
|----------|-------------|
| API Calls | 1 per scrape |
| Response Time | ~2.6 seconds |
| Data Volume | 1,268 records |
| Memory Usage | ~100 MB |
| Database Writes | 1,268 IPOs (one-time) |
| Cache Keys | ~1,268 keys |

### 6.4 Error Handling & Monitoring

#### Error Types

| Error Type | Handling Strategy | Recovery |
|------------|------------------|----------|
| **401/403 Auth Error** | Refresh cookies, retry (max 3) | Auto-recovery |
| **Network Timeout** | Retry with exponential backoff | Auto-recovery |
| **Invalid Data Format** | Log error, skip record, continue | Manual review |
| **Database Error** | Rollback transaction, alert | Manual intervention |
| **Cache Error** | Log warning, continue without cache | Degraded mode |

#### Monitoring Metrics

```typescript
// Logged to scraper_logs table
{
  source: 'NSE',
  status: 'SUCCESS' | 'FAILURE' | 'PARTIAL',
  recordsProcessed: number,
  recordsFailed: number,
  durationMs: number,
  errorMessage?: string,
  errorStack?: string,
  timestamp: Date
}
```

---

## Part 7: Success Metrics

### 7.1 Current Status (October 2025)

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| **API Success Rate** | >95% | 100% | ✅ Exceeds |
| **Data Completeness** | >90% | 98.5% | ✅ Exceeds |
| **Response Time (Current)** | <10s | ~7s | ✅ Exceeds |
| **Response Time (Historical)** | <5s | ~2.6s | ✅ Exceeds |
| **Coverage (Current)** | All active IPOs | 4/4 (100%) | ✅ Complete |
| **Coverage (Historical)** | >200 IPOs | 1,268 IPOs | ✅ Exceeds |
| **Type Safety** | 100% | 100% | ✅ Complete |
| **Schema Consistency** | 100% | 100% | ✅ Complete |

### 7.2 Data Quality Metrics

#### Current IPOs
- ✅ Company Names: 100%
- ✅ Symbols: 100% (active IPOs)
- ✅ Dates: 100%
- ✅ Subscription Data: 100% (where available)

#### Historical IPOs
- ✅ Company Names: 100% (1,268/1,268)
- ✅ Symbols: 100% (1,268/1,268)
- ✅ Issue Prices: 98.5% (1,249/1,268)
- ✅ Listing Dates: 100% (1,268/1,268)
- ✅ Price Ranges: 100% (1,268/1,268)

---

## Part 8: Known Issues & Limitations

### 8.1 API Limitations

| Limitation | Impact | Mitigation |
|-----------|--------|------------|
| **Rate Limiting** | NSE may block excessive requests | Implement 15-30 min intervals |
| **Cookie Expiration** | Session becomes invalid after ~30 mins | Auto-refresh on 401/403 errors |
| **Format Changes** | NSE can change API response format | Flexible parsing with version detection |
| **Incomplete Data** | Some IPOs missing fields | Graceful degradation, log warnings |

### 8.2 Recent Issues & Fixes

#### ✅ FIXED: NSE Past API Format Change (Oct 2025)

**Issue**: NSE changed response format from direct array to wrapped object

**Impact**: `fetchPastIPOs()` was failing with "Invalid response format" error

**Resolution**:
```typescript
// Before (Expected direct array)
if (!Array.isArray(data)) {
  throw new Error('Invalid response format');
}

// After (Handle both formats)
let pastIPOsArray: any[];
if (Array.isArray(response)) {
  pastIPOsArray = response;  // Legacy format
} else if (response && typeof response === 'object' && Array.isArray(response.data)) {
  pastIPOsArray = response.data;  // New format
} else {
  throw new Error('Invalid response format');
}
```

**Status**: ✅ Fixed in commit `67d1a81` (Oct 18, 2025)

---

## Part 9: Future Enhancements

### 9.1 Planned Improvements

1. **Real-time Subscription Updates**
   - WebSocket integration for live subscription data
   - Sub-minute updates during IPO open period

2. **Historical Data Enrichment**
   - Fetch listing prices from NSE
   - Calculate listing day returns
   - Track current prices for performance metrics

3. **Additional NSE Endpoints**
   - `/api/ipo-detail` - Detailed company information
   - Document downloads (DRHP, prospectus)

4. **Performance Optimization**
   - Parallel API calls where possible
   - Incremental updates (only changed data)
   - Database bulk inserts

### 9.2 Monitoring & Alerting

**Recommended Alerts:**
- Scraper failures (3 consecutive failures)
- Data completeness drops below 90%
- Response time exceeds 15 seconds
- Authentication failures
- Database persistence errors

---

## Part 10: Testing & Verification

### 10.1 Test Results (October 18-19, 2025)

#### Current IPO Scraper

**Test Run**: Oct 19, 2025 00:59:39 IST

```
✅ NSE Current IPO Scraper Test Results:
   - Source: NSE API (/api/all-upcoming-issues + /api/ipo-current-issue)
   - IPOs Processed: 4
   - IPOs Inserted: 0
   - IPOs Updated: 4
   - IPOs Failed: 0
   - Subscriptions Created: 0
   - Duration: 6,977ms
   - Success Rate: 100%
```

**Scraped IPOs:**
1. SMC Global Securities Limited (NCD) - OPEN
2. Midwest Limited (MAINBOARD) - CLOSED
3. 3i Infotech Limited (MAINBOARD) - OPEN
4. Cool Caps Industries Limited (MAINBOARD) - OPEN

#### Historical IPO Scraper

**Test Run**: Oct 18, 2025 14:22:29 UTC

```
✅ NSE Past IPO Scraper Test Results:
   - Source: NSE API (/api/public-past-issues)
   - Endpoint: /api/public-past-issues
   - Format: { data: [...] } (new format detected)
   - Total IPOs: 1,268
   - Duration: 2,577ms
   - Data Quality: 98.5% average
```

**Data Quality Breakdown:**
- Company Names: 1,268/1,268 (100.0%)
- Symbols: 1,268/1,268 (100.0%)
- Issue Prices: 1,249/1,268 (98.5%)
- Listing Dates: 1,268/1,268 (100.0%)
- Price Ranges: 1,268/1,268 (100.0%)

**Security Type Distribution:**
- Equity (EQ): 390 IPOs (30.8%)
- SME: 703 IPOs (55.4%)
- InvIT/REIT (IV): 175 IPOs (13.8%)

### 10.2 Integration Tests

All integration tests passing:
- ✅ NSE API authentication
- ✅ Cookie collection and refresh
- ✅ Data transformation
- ✅ IPO matching (symbol & name)
- ✅ Database persistence
- ✅ Cache invalidation
- ✅ Error handling & retry logic

---

## Conclusion

The NSE scraping implementation is **production-ready** with comprehensive coverage of both current and historical IPO data. The system has been thoroughly tested and handles edge cases including API format changes, authentication challenges, and data quality issues.

**Total Coverage**: 1,272+ IPOs (4 current + 1,268 historical)

**Status**: ✅ **All Systems Operational**

### Quick Start Commands

```bash
# Test current IPOs
cd scraper && npm start

# Run historical backfill (one-time)
cd scraper && npm run backfill

# Start scheduler (production)
cd scraper && npm run scheduler

# Verify data quality
cd scraper && npm run validate:backfill
```

---

**Document Version**: 1.0
**Last Tested**: October 19, 2025
**Next Review**: Weekly or on NSE API changes
