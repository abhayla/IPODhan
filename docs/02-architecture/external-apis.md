# External APIs

## NSE India APIs (Primary Data Source)

### Status: ✅ PRODUCTION READY
**Last Updated**: October 28, 2025
**Coverage**: 1,272+ IPOs (4 current + 1,268 historical)
**Success Rate**: 100%

### Overview

National Stock Exchange (NSE) of India provides comprehensive IPO data through both official APIs and web scraping. NSE is the **primary authoritative source** for MAINBOARD, SME, and NCD offerings.

### Authentication & Session Management

**Cookie-Based Authentication**: NSE APIs require browser-like session cookies obtained through multi-stage page visits:

| Stage | URL | Cookies Obtained | Count |
|-------|-----|-----------------|-------|
| 1. Homepage | `https://www.nseindia.com/` | AKA_A2, _abck, ak_bmsc, bm_mi, bm_sz | 5 |
| 2. Market Data | `/market-data/pre-open-market-cm-and-emerge-market` | + nsit, nseappid | 7 |
| 3. Past Issues | `/market-data/past-issue-public` | + bm_sv | 8 |

**Session Lifecycle**:
- Cookies expire after ~30 minutes
- Automatic refresh on 401/403 errors
- Retry logic: 3 attempts with exponential backoff (1s → 2s → 4s)

**Implementation**: `scraper/src/scrapers/nse-api-client.ts` (~950 lines)

---

### API Endpoint 1: Current/Upcoming IPOs

#### `/api/all-upcoming-issues`

**Purpose**: Fetch all upcoming and recently closed IPOs
**Method**: GET
**Base URL**: `https://www.nseindia.com`
**Authentication**: 5 cookies (Stage 1)
**Response Time**: ~7 seconds per scrape

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

**Data Coverage**: 4-10 active IPOs at any time
**Update Frequency**: Every 15 minutes (during market hours)
**Data Points**: 25+ fields per IPO

---

### API Endpoint 2: Live Subscription Data (Priority)

#### `/api/ipo-current-issue`

**Purpose**: ⭐ **PRIMARY ENDPOINT** for currently active IPOs with real-time subscription data
**Method**: GET
**Authentication**: 7 cookies (Stage 1 + 2)
**Unique Feature**: Real-time subscription numbers not available elsewhere

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

**Unique Data Extracted**:
- ✅ Real-time subscription numbers (Retail, HNI, QIB, Total)
- ✅ Live status updates
- ✅ Highest accuracy for current issues

**Performance**: < 10 seconds per request
**Critical Use Case**: Powers live IPO dashboards and subscription tracking

---

### API Endpoint 3: IPO Detail Data

#### `/api/ipo-detail?symbol={SYMBOL}`

**Purpose**: Detailed information for specific IPO
**Method**: GET
**Usage**: Secondary data enrichment
**Authentication**: 7 cookies (Stage 1 + 2)

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

**Response Time**: < 5 seconds per symbol

---

### API Endpoint 4: Historical IPOs

#### `/api/public-past-issues`

**Purpose**: Complete historical IPO database from NSE
**Method**: GET
**Authentication**: 8 cookies (Stage 1 + 2 + 3)
**Coverage**: 1,268 historical IPOs (multi-year)

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

**🔧 API Format Change (Oct 2025)**:
- **Old Format**: Direct array `[{ company, ... }]`
- **New Format**: Wrapped object `{ data: [{ company, ... }] }`
- **Fix Applied**: Backward-compatible parser handles both formats
- **Status**: ✅ Fixed in commit `67d1a81` (Oct 18, 2025)

**Security Type Distribution**:
| Type | Description | Count | Percentage |
|------|-------------|-------|------------|
| EQ | Equity/Mainboard IPOs | 390 | 30.8% |
| SME | SME Platform IPOs | 703 | 55.4% |
| IV | InvIT/REIT | 175 | 13.8% |
| DEBT | Debt Securities | - | - |
| BE | Book Entry Securities | - | - |

**Data Quality Metrics**:
- Company Names: 100% (1,268/1,268)
- Symbols: 100% (1,268/1,268)
- Issue Prices: 98.5% (1,249/1,268)
- Listing Dates: 100% (1,268/1,268)
- Price Ranges: 100% (1,268/1,268)

**Performance**: ~2.6 seconds per fetch
**Update Frequency**: Weekly (historical data rarely changes)

---

### Segment Detection Enhancement (Story 11.x)

**Problem Identified**: NSE APIs don't return segment field (MAINBOARD/SME) for all IPOs
**Solution**: Web scraping enhancement

#### Endpoint 5: Security Type Web Scraper

**URL Pattern**: `https://www.nseindia.com/market-data/public-issue-detail?symbol={SYMBOL}`
**Method**: HTML parsing via Puppeteer
**Purpose**: Detect segment (MAINBOARD/SME) when API doesn't provide it
**Implementation**: `scraper/src/scrapers/nse-security-type-scraper.ts` (262 lines)

**Process**:
1. Parse API response for IPO data
2. If `segment` is NULL, trigger web scraper
3. Fetch IPO detail page with session cookies
4. Extract "Security Type" from HTML table
5. Map to segment: "Equity" → MAINBOARD, "SME" → SME

**Performance**:
- Rate Limiting: 1 second per request
- Success Rate: 95%+ (tested Oct 2025)
- Batch Processing: Queues NULL segments for scraping
- Graceful Degradation: Falls back to manual categorization if web scraping fails

**Status**: ✅ COMPLETE (Oct 28, 2025)
- Database Completeness: 100% (505 IPOs, 0 NULL segments)
- 12 IPOs fixed (3 MAINBOARD, 2 SME, 7 RIGHTS)
- Backfill script available: `web/scripts/backfill-null-segments.ts`

---

### Field Mapping: NSE → IPODhan Schema

#### Current IPO Fields

| NSE Field | IPODhan Field | Type | Required | Notes |
|-----------|--------------|------|----------|-------|
| `companyName` | `company_name` | varchar(255) | ✅ | Company name |
| `symbol` | `symbol` | varchar(20) | ❌ | Nullable for upcoming |
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

#### Subscription Fields (Current IPOs Only)

| NSE Field | IPODhan Field | Type | Format |
|-----------|--------------|------|--------|
| `retail` | `subscription_retail` | numeric(10,2) | "2.50x" → 2.50 |
| `hni` | `subscription_hni` | numeric(10,2) | "15.30x" → 15.30 |
| `qib` | `subscription_qib` | numeric(10,2) | "45.20x" → 45.20 |
| `total` | `subscription_total` | numeric(10,2) | "20.80x" → 20.80 |

#### Category Mapping

| NSE `securityType` | IPODhan `segment` | Notes |
|-------------------|------------------|-------|
| `EQ` | `MAINBOARD` | Equity mainboard |
| `SME` | `SME` | SME platform |
| `IV` | `MAINBOARD` | InvIT/REIT mapped to mainboard |
| `DEBT` | `NCD` | Debt securities |
| `BE` | `MAINBOARD` | Book entry |
| `null` (RIGHTS) | `null` | RIGHTS offerings (correct) |

---

### Error Handling & Resilience

| Error Type | HTTP Code | Handling Strategy | Recovery |
|------------|-----------|------------------|----------|
| Authentication Failure | 401/403 | Refresh cookies, retry (max 3) | Auto-recovery |
| Network Timeout | - | Exponential backoff (1s → 2s → 4s) | Auto-recovery |
| Invalid Data Format | - | Log error, skip record, continue | Manual review |
| API Format Change | - | Backward-compatible parser | Auto-handled |
| Rate Limiting | 429 | Wait and retry after cooldown | Auto-recovery |

**Monitoring**: All errors logged to `scraper_logs` table with:
- Source: 'NSE'
- Status: 'SUCCESS' | 'FAILURE' | 'PARTIAL'
- Records processed/failed
- Duration (ms)
- Error message & stack trace

---

### Integration Notes

**Primary Use**: NSE APIs are the **authoritative source** for all IPO data. Other sources (BSE, IPO Alerts API) are supplementary.

**Scraping Schedule** (Production):
- **Current IPOs**: Every 15 minutes (market hours 9AM-5PM)
- **Current IPOs**: Every 30 minutes (after hours)
- **Historical IPOs**: Weekly (Sunday midnight)

**Implementation Files**:
- `scraper/src/scrapers/nse-api-client.ts` (950 lines) - API communication
- `scraper/src/scrapers/nse-scraper-orchestrator.ts` (400 lines) - Orchestration
- `scraper/src/scrapers/nse-security-type-scraper.ts` (262 lines) - Segment detection
- `scraper/src/utils/transform-nse-ipo.ts` (200 lines) - Data transformation
- `scraper/src/utils/match-ipo.ts` (250 lines) - IPO matching logic

**Performance Targets**:
- Current IPO scrape: < 10 seconds
- Historical scrape: < 5 seconds
- Segment detection: < 2 seconds per IPO
- Overall success rate: > 95%

**Documentation**:
- Complete NSE scraping guide: `docs/08-scraping/NSE-Scraping-Complete-Scope.md` (800 lines)
- Segment detection fix: `docs/08-scraping/SEGMENT_DETECTION_COMPLETE.md` (290 lines)
- Test results: `docs/08-scraping/COMPREHENSIVE_SCRAPING_TEST_RESULTS.md`

---

## BSE India Website (Web Scraping)

- **Purpose:** Primary source for BSE-listed IPOs and SME IPO coverage
- **Base URL:** `https://www.bseindia.com/`
- **Key Endpoints:**
  - `/publicissue.html` - IPO listings with subscription status

**Integration Notes:** BSE critical for SME IPO coverage. Uses Puppeteer for JavaScript-rendered content (ASP.NET postbacks). Handles dual-listed IPOs (merges NSE + BSE data). See `scraper/README.md` for detailed BSE implementation.

---

## IPO Alerts API (Fallback Source)

- **Purpose:** Fallback/supplementary data source when NSE/BSE scrapers fail
- **Documentation:** https://api.ipoalerts.in/docs
- **Base URL:** `https://api.ipoalerts.in`
- **Rate Limits:** 100 requests/hour (enforced with in-memory tracking)
- **Key Endpoints:**
  - `GET /ipos?status=open` - Fetch currently open IPOs
  - `GET /ipos?status=upcoming` - Fetch upcoming IPOs
  - `GET /ipos/{id}` - Get detailed IPO information

**Integration Notes:**
- Use as **tertiary source** ONLY; NSE/BSE data is authoritative
- Automatic fallback after 3 consecutive NSE/BSE failures
- DO NOT overwrite existing NSE/BSE data (log discrepancies only)
- Manual execution: `npm run start:fallback`
- Implementation: `scraper/src/scrapers/ipo-alerts-fallback-orchestrator.ts`
- See `scraper/README.md` section "IPO Alerts API Fallback (Story 7.3)" for details

## Resend API

- **Purpose:** Transactional email delivery
- **Documentation:** https://resend.com/docs
- **Base URL:** `https://api.resend.com`
- **Authentication:** API key (header: `Authorization: Bearer <key>`)
- **Rate Limits:** Free tier: 3,000 emails/month, 100 emails/day

**Integration Notes:** Use React Email for templating. Non-blocking error handling. Monitor bounce rate and spam complaints.

## Google Analytics 4 (GA4)

- **Purpose:** Web analytics, user behavior tracking
- **Documentation:** https://developers.google.com/analytics/devguides/collection/ga4
- **Authentication:** Measurement ID

**Integration Notes:** Track pageviews, events (IPO card clicks, tab switches), custom dimensions (IPO status, category, sector). Implement cookie consent banner for GDPR compliance.

---
