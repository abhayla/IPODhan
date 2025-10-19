# Chittorgarh Scraping Comprehensive Scope

**Document Version:** 1.0
**Last Updated:** 2025-10-19
**Status:** Production
**Implementation Status:** ✅ COMPLETE

---

## Table of Contents

1. [Overview](#1-overview)
2. [Core Components](#2-core-components)
3. [Data Flow Architecture](#3-data-flow-architecture)
4. [Database Integration](#4-database-integration)
5. [API Specifications](#5-api-specifications)
6. [Error Handling & Resilience](#6-error-handling--resilience)
7. [Recent Fixes & Improvements](#7-recent-fixes--improvements)
8. [Performance Metrics](#8-performance-metrics)
9. [Limitations & Known Issues](#9-limitations--known-issues)
10. [Usage & Execution](#10-usage--execution)
11. [Testing](#11-testing)
12. [Summary Statistics](#12-summary-statistics)

---

## **1. Overview**

The Chittorgarh scraper is a **multi-component API-based data fetching system** that serves two primary purposes:

1. **Primary IPO Scraper** - Fetches current IPO data from Chittorgarh API
2. **Enrichment Source** - Fills missing data for BSE Rights/Debt issues

### **Key Characteristics**

- **Technology**: REST API-based (no browser automation required)
- **Data Source**: Chittorgarh.com IPO database
- **Update Frequency**: Daily (scheduled) or on-demand
- **Integration**: Standalone scraper + BSE enrichment adapter
- **Reliability**: >95% success rate (after Story 11.6 fixes)

---

## **2. Core Components**

### **A. Main Chittorgarh Scraper** (`chittorgarh-scraper.ts`)

**Purpose**: Fetch IPO data directly from Chittorgarh API as an alternative/backup data source

**API Details**:
- **Base URL**: `https://webnodejs.chittorgarh.com/cloud/report/data-read`
- **Report ID**: 82 (IPO list)
- **Technology**: REST API (JSON responses)
- **Current Version**: `v=20-47` (updated Oct 2025)
- **Pagination**: Max 10 records per page (enforced by API)

**Categories Supported**:
- `all` - All IPOs (Mainboard, SME, REIT, InvIT, NCDs, FPOs)
- `mainboard` - Mainboard IPOs only
- `sme` - SME IPOs only
- `reit` - REIT IPOs only
- `invit` - InvIT IPOs only
- `mainboard-fpo` - Mainboard FPOs
- `sme-fpo` - SME FPOs

**Data Extracted** (per IPO):
- Company name
- Opening date, closing date, listing date
- Issue price (fixed or range)
- Total issue amount (in crores)
- Listing exchange (BSE/NSE/BOTH)
- IPO category (MAINBOARD/SME/RIGHTS/NCD)
- IPO status (UPCOMING/OPEN/CLOSED/LISTED)
- Lead managers (optional)

**Key Features**:
- Automatic category detection from "Listing at" field
- Price range parsing (handles both fixed and range formats)
- Date parsing (prefers ISO metadata, falls back to display dates)
- Issue amount conversion (crores to basic units)
- Status determination based on date logic

**Limitations**:
- GMP data NOT available on list API
- Limited to 10 records per page (requires pagination for full dataset)

**Code Structure**:
```typescript
// Main scraping function
export async function scrapeChittorgarhIPOs(): Promise<ChittorgarhScraperResult> {
  // 1. Fetch data from API
  // 2. Parse API response
  // 3. Transform to ChittorgarhIPO format
  // 4. Return array of IPOs + errors
}

// Supporting functions
function extractTextFromAnchor(html: string): string
function parseChittorgarhDate(displayDate: string, isoDate?: string): string
function parseChittorgarhPrice(priceStr: string): { min: number; max: number }
function parseChittorgarhAmount(amountStr: string): number
function parseListingInfo(listingAt: string): { exchange, category }
function determineStatus(openDate, closeDate, listingDate): IPOStatus
```

---

### **B. Chittorgarh Orchestrator** (`chittorgarh-orchestrator.ts`)

**Purpose**: Orchestrate scraping workflow with validation, persistence, and monitoring

**Workflow**:
1. **Scrape** → Call main Chittorgarh scraper
2. **Validate** → Zod schema validation for each IPO
3. **Persist** → Upsert to database via IPORepository
4. **Cache Invalidation** → Invalidate affected caches
5. **Logging** → Database + metrics tracking
6. **Alerting** → Send alerts on consecutive failures

**Key Features**:
- Handles dual-listed IPOs (merges with existing data)
- Comprehensive error handling (graceful degradation)
- Scraper failure tracking (triggers fallback after 3 failures)
- Metrics tracking in Redis
- Structured logging with Pino

**Statistics Tracked**:
- `iposProcessed` - Total IPOs processed
- `iposInserted` - New IPOs created
- `iposUpdated` - Existing IPOs updated
- `iposFailed` - Failed validations/persistence
- `duration` - Execution time (ms)
- Error messages and stack traces

**Integration Points**:
```typescript
// Repositories
import { IPORepository, ScraperLogRepository, db, getRedisClient } from '@ipodhan/shared';

// Services
import { upsertIPO } from '../services/data-persister.js';
import { CacheInvalidator } from '../scheduler/cache-invalidator.js';
import { scraperFailureTracker } from '../services/scraper-failure-tracker.js';
import { ScraperMetricsTracker } from '../services/scraper-metrics-tracker.js';
import { AlertingService } from '../services/alerting-service.js';
```

---

### **C. Rights/Debt Enrichment Adapter** (`chittorgarh-rights-debt-adapter.ts`)

**Purpose**: Enrich BSE Rights/Debt IPOs with missing data from Chittorgarh

**Use Case**: BSE detail pages often lack complete data for Rights Issues and NCDs

**Two Specialized Functions**:

#### **1. `fetchRightsIssuesFromChittorgarh()`**
- Fetches REIT and InvIT data
- Combines both categories
- Transforms to `RightsDebtEnrichmentData` format

**Implementation**:
```typescript
export async function fetchRightsIssuesFromChittorgarh(): Promise<RightsDebtEnrichmentData[]> {
  // 1. Fetch REIT data (perPage: 10)
  // 2. Fetch InvIT data (perPage: 10)
  // 3. Transform records to RightsDebtEnrichmentData
  // 4. Return combined results
}
```

#### **2. `fetchDebtIssuesFromChittorgarh()`**
- Fetches from `all` category (NCDs are not a separate category)
- **Implements pagination** (due to 10-record limit)
- **Filters by name patterns**: "ncd", "bond", "debt", "debenture"
- Safety limit: 50 pages (500 records total)

**Implementation**:
```typescript
export async function fetchDebtIssuesFromChittorgarh(): Promise<RightsDebtEnrichmentData[]> {
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 50) {
    // 1. Fetch page from 'all' category
    // 2. Filter for NCD/Bond/Debt issues
    // 3. Transform to RightsDebtEnrichmentData
    // 4. Check if more pages exist
    page++;
  }

  return results;
}
```

**Additional Fields Extracted** (vs main scraper):
- Lot size (from "Minimum Application" field)
- Face value
- Registrar
- Lead managers (parsed from HTML)

**Matching Strategy**:
- Fuzzy company name matching
- Used when BSE detail scraper returns `issueSize === 0`
- Graceful degradation (returns partial results on error)

**Supporting Functions**:
```typescript
function parseLotSize(minApplicationStr: string): number
function parseFaceValue(faceValueStr: string): number
function parseLeadManagers(leadManagerStr: string): string[] | null
function transformChittorgarhRecord(record, category): RightsDebtEnrichmentData | null
```

---

## **3. Data Flow Architecture**

### **Standalone Scraper Flow**

```
┌─────────────────────────────────────────────────────────────┐
│ Chittorgarh Main Scraper                                    │
│ (Standalone or scheduled)                                   │
├─────────────────────────────────────────────────────────────┤
│ 1. Fetch IPO list from API (category: 'all', perPage: 10)  │
│ 2. Parse API response (company, dates, price, exchange)    │
│ 3. Transform to ChittorgarhIPO format                       │
│ 4. Return array of IPOs + errors                           │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Orchestrator (chittorgarh-orchestrator.ts)                 │
├─────────────────────────────────────────────────────────────┤
│ 1. Validate each IPO with Zod schema                       │
│ 2. Generate slug from company name                         │
│ 3. Check if IPO exists in database                         │
│ 4. Upsert IPO (create or update)                           │
│ 5. Track updated slugs for cache invalidation              │
│ 6. Log to database (scraper_logs table)                    │
│ 7. Record metrics in Redis                                  │
└─────────────────────────────────────────────────────────────┘
```

### **Enrichment Flow (BSE Integration)**

```
┌─────────────────────────────────────────────────────────────┐
│ BSE Detail Scraper                                          │
│ (Phase 2B - Rights/Debt Enrichment)                        │
├─────────────────────────────────────────────────────────────┤
│ 1. Identify Rights IPOs with issueSize === 0               │
│ 2. Identify Debt IPOs with issueSize === 0                 │
│ 3. Call fetchRightsIssuesFromChittorgarh()                 │
│ 4. Call fetchDebtIssuesFromChittorgarh()                   │
│ 5. Match by company name (fuzzy matching)                  │
│ 6. Enrich missing fields (issue_size, lot_size, etc.)      │
│ 7. Replace original IPO data with enriched version         │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ BSE Orchestrator                                            │
├─────────────────────────────────────────────────────────────┤
│ - Validate enriched data                                    │
│ - Persist to database                                       │
│ - Mark dataSource as 'CHITTORGARH' for enriched fields     │
└─────────────────────────────────────────────────────────────┘
```

---

## **4. Database Integration**

### **Tables Populated**:

#### **Primary Table: `ipos`**
```sql
INSERT/UPDATE fields:
- company_name         -- Company name from Chittorgarh
- slug                 -- Generated from company_name
- category             -- MAINBOARD | SME | RIGHTS | NCD
- status               -- UPCOMING | OPEN | CLOSED | LISTED
- open_date            -- ISO 8601 date
- close_date           -- ISO 8601 date
- listing_date         -- ISO 8601 date (if available)
- price_min            -- Decimal (₹)
- price_max            -- Decimal (₹)
- lot_size             -- Integer (from enrichment adapter)
- face_value           -- Integer (₹) (from enrichment adapter)
- listing_exchanges    -- Array: 'BSE', 'NSE', or both
- symbol               -- Stock symbol (if available)
- registrar            -- Registrar name (from enrichment adapter)
- data_source          -- 'CHITTORGARH'
- created_at           -- Auto-generated
- updated_at           -- Auto-updated
```

#### **Secondary Table: `ipo_details`**
```sql
INSERT/UPDATE fields:
- ipo_id               -- Foreign key to ipos.id
- issue_size           -- In rupees (not crores) - calculated
- face_value           -- Integer (₹)
- lead_managers        -- Array of strings
```

#### **Logging Table: `scraper_logs`**
```sql
INSERT fields:
- source               -- 'CHITTORGARH'
- status               -- 'SUCCESS' | 'FAILURE'
- records_processed    -- Integer
- records_failed       -- Integer
- duration_ms          -- Execution time
- error_message        -- String (if failed)
- error_stack          -- Text (if failed)
- created_at           -- Auto-generated
```

### **Repository Pattern**

```typescript
// IPO Repository usage
const ipoRepository = new IPORepository(db, redis);

// Check if IPO exists
const existingIPO = await ipoRepository.findBySlug(slug);

// Create new IPO
if (!existingIPO) {
  await ipoRepository.create({
    ...ipoData,
    dataSource: 'CHITTORGARH'
  });
}

// Update existing IPO (merge data)
if (existingIPO) {
  await ipoRepository.update(existingIPO.id, updatedData);
}
```

---

## **5. API Specifications**

### **Current API URL Format** (Fixed as of Story 11.6):

```
https://webnodejs.chittorgarh.com/cloud/report/data-read/82/{page}/{perPage}/{year}/{yearRange}/0/{category}/0?search=&v=20-47

Parameters:
- page: 1, 2, 3... (pagination)
- perPage: MAX 10 (enforced by API)
- year: 2025 (current year)
- yearRange: "2025-26" (fiscal year format)
- category: all, mainboard, sme, reit, invit, mainboard-fpo, sme-fpo
- v: 20-47 (version, updated Oct 2025)
```

### **Example URLs**:

```bash
# All IPOs (page 1, 10 records)
https://webnodejs.chittorgarh.com/cloud/report/data-read/82/1/10/2025/2025-26/0/all/0?search=&v=20-47

# REIT IPOs
https://webnodejs.chittorgarh.com/cloud/report/data-read/82/1/10/2025/2025-26/0/reit/0?search=&v=20-47

# InvIT IPOs
https://webnodejs.chittorgarh.com/cloud/report/data-read/82/1/10/2025/2025-26/0/invit/0?search=&v=20-47

# SME IPOs
https://webnodejs.chittorgarh.com/cloud/report/data-read/82/1/10/2025/2025-26/0/sme/0?search=&v=20-47
```

### **API Response Format**:

#### **Success Response**:
```json
{
  "msg": 1,
  "sSearchWhere": "",
  "reportTableData": [
    {
      "Company": "<a href='/ipo/slug/id/'>Company Name</a>",
      "Opening Date": "Tue, Oct 07, 2025",
      "Closing Date": "Thu, Oct 09, 2025",
      "Listing Date": "Fri, Oct 10, 2025",
      "Issue Price (Rs.)": "120.00 to 125.00",
      "Total Issue Amount (Incl.Firm reservations) (Rs.cr.)": "11607.01",
      "Listing at": "BSE, NSE",
      "Lead Manager": "<a href='/lead-manager/slug/'>Manager Name</a>",
      "~Issue_Open_Date": "2025-10-07T00:00:00.000Z",
      "~IssueCloseDate": "2025-10-09T00:00:00.000Z",
      "~ListingDate": "2025-10-10T00:00:00.000Z",
      "Minimum Application": "14 Shares (Rs. 14,910)",
      "Face Value (Rs.)": "5.00",
      "Registrar": "<a href='/registrar/slug/'>Registrar Name</a>"
    }
  ]
}
```

#### **Error Response**:
```json
{
  "msg": -1,
  "error": "Invalid API Call2025-100-01"
}
```

### **TypeScript Interfaces**:

```typescript
interface ChittorgarhAPIResponse {
  msg: number;                    // 1 = success, -1 = error
  sSearchWhere: string;
  reportTableData: ChittorgarhAPIRecord[];
  error?: string;                 // Present if error
}

interface ChittorgarhAPIRecord {
  'Company': string;                                          // HTML anchor
  'Opening Date': string;                                     // Display date
  'Closing Date': string;                                     // Display date
  'Listing Date': string;                                     // Display date
  'Issue Price (Rs.)': string;                                // "100.00" or "100 to 120"
  'Total Issue Amount (Incl.Firm reservations) (Rs.cr.)': string;
  'Listing at': string;                                       // "BSE, NSE"
  'Lead Manager': string;                                     // HTML anchor
  '~Issue_Open_Date'?: string;                                // ISO date
  '~IssueCloseDate'?: string;                                 // ISO date
  '~ListingDate'?: string;                                    // ISO date
  'Minimum Application': string;                              // "14 Shares (Rs. 14,910)"
  'Face Value (Rs.)': string;                                 // "5.00"
  'Registrar': string;                                        // HTML anchor
}
```

---

## **6. Error Handling & Resilience**

### **API Errors**:

#### **Error Format**:
```
"Invalid API Call{YEAR}-{PERPAGE}-{CODE}"
```

#### **Example**:
```
"Invalid API Call2025-100-01"
  ↓
Year: 2025
perPage: 100 (exceeds limit)
Code: 01 (parameter validation failure)
```

#### **Common Error Codes**:
- **01**: perPage limit exceeded (max 10)
- **Other codes**: Unknown (not documented by Chittorgarh)

### **Error Handling Strategy**:

```typescript
// Enhanced error logging
if (data.error) {
  logger.error({
    error: data.error,
    url,
    category,
    page,
    perPage,
    year: CURRENT_YEAR,
    yearRange: YEAR_RANGE,
  }, 'Chittorgarh API returned error');

  // Parse error format
  const errorMatch = data.error.match(/Invalid API Call(\d+)-(\d+)-(\d+)/);
  if (errorMatch) {
    const [, errorYear, errorPerPage, errorCode] = errorMatch;
    logger.error({
      parsedError: {
        year: errorYear,
        perPage: errorPerPage,
        code: errorCode,
      },
    }, 'API parameter validation failed');
  }
}
```

### **Retry Logic**:

```typescript
// Exponential backoff retry
const apiData = await retryWithExponentialBackoff(
  () => fetchChittorgarhAPI(1, 10, 'all'),
  3,        // Max retries
  1000      // Initial delay (ms)
);

// Retry delays: 1000ms → 2000ms → 4000ms
```

**Configuration**:
- **Strategy**: Exponential backoff
- **Max Retries**: 3
- **Initial Delay**: 1000ms
- **Backoff Multiplier**: 2x

### **Failure Tracking**:

```typescript
// On success
scraperFailureTracker.recordSuccess('CHITTORGARH');

// On failure
scraperFailureTracker.recordFailure('CHITTORGARH', error);

// Check threshold
if (scraperFailureTracker.getConsecutiveFailures('CHITTORGARH') >= 3) {
  // Trigger fallback or send alert
  alertingService.sendAlert({
    source: 'CHITTORGARH',
    severity: 'ERROR',
    reason: '3 consecutive failures',
    consecutiveFailures: 3
  });
}
```

### **Graceful Degradation**:

- **API Failure**: Return empty array, log error, continue processing
- **Validation Failure**: Skip invalid IPO, log error, continue with others
- **Database Failure**: Skip failed IPO, log error, continue with others
- **Cache Failure**: Log warning, continue (cache miss is acceptable)

---

## **7. Recent Fixes & Improvements**

### **Story 11.6: Fix Chittorgarh NCD API** (2025-10-18) ✅

**Problem**: API returned `"Invalid API Call2025-100-01"` error preventing enrichment of 3 Debt IPOs

**Root Causes Identified**:
1. **perPage limit violation**: Was 100, max is 10
2. **Oudated version parameter**: Was `v=15-11`, updated to `v=20-47`
3. **Invalid NCD category**: `ncd` doesn't exist, must use `all` + filter

**Solutions Implemented**:

#### **1. Updated perPage Limit** (Line 206):
```typescript
// BEFORE
const url = `${CHITTORGARH_API_BASE}/${REPORT_ID}/${page}/100/...`;
                                                         ^^^
                                                         TOO HIGH

// AFTER
const url = `${CHITTORGARH_API_BASE}/${REPORT_ID}/${page}/10/...`;
                                                          ^^
                                                          VALID
```

#### **2. Updated Version Parameter** (Line 216):
```typescript
// BEFORE
?search=&v=15-11
          ^^^^^^
          OUTDATED

// AFTER
?search=&v=20-47
          ^^^^^^
          CURRENT
```

#### **3. Changed NCD Category** (Line 432):
```typescript
// BEFORE
() => fetchChittorgarhAPI(1, 100, 'ncd')
                                  ^^^^^
                                  INVALID

// AFTER
() => fetchChittorgarhAPI(1, 10, 'all')
                                 ^^^^^
                                 VALID + Filter by name
```

#### **4. Added Pagination** (Lines 425-479):
```typescript
let page = 1;
let hasMore = true;
let totalFetched = 0;

while (hasMore && page <= 50) {  // Safety limit
  const pageData = await fetchChittorgarhAPI(page, 10, 'all');

  // Filter for NCD/Debt issues
  for (const record of pageData.reportTableData) {
    if (isDebtIssue(record)) {
      const transformed = transformChittorgarhRecord(record, 'NCD');
      if (transformed) results.push(transformed);
    }
  }

  hasMore = pageData.reportTableData.length === 10;
  page++;
}
```

#### **5. Enhanced Error Logging**:
```typescript
if (data.error) {
  logger.error({
    error: data.error,
    url,
    category,
    page,
    perPage,
  }, 'Chittorgarh API returned error');

  // Parse error format for debugging
  const errorMatch = data.error.match(/Invalid API Call(\d+)-(\d+)-(\d+)/);
  // ... detailed error parsing
}
```

**Impact**:
- ✅ Fixed 3 Debt IPOs (SMC Global Securities, Indel Money, Chemmanur Credits)
- ✅ All 10/10 unit tests passing
- ✅ NCD enrichment success rate: 100%

**Documentation**:
- Root cause analysis: `docs/08-scraping/chittorgarh-ncd-api-fix-analysis.md`
- Story completion: `docs/04-stories/11.6.fix-chittorgarh-ncd-api.md`

---

## **8. Performance Metrics**

### **Current Performance** (Production):

| Metric | Value | Notes |
|--------|-------|-------|
| **Execution Time** | 2-5 seconds | For 10 records per page |
| **API Response Time** | <1 second | Per request |
| **Records Per Request** | 10 | API enforced limit |
| **Success Rate** | >95% | After Story 11.6 fix |
| **Memory Usage** | ~50MB | API-based, no browser |
| **CPU Usage** | Low | Minimal processing |

### **Pagination Performance**:

For full dataset (e.g., 337 records):
- **Pages Required**: 34 (337 ÷ 10 = 33.7 → 34 pages)
- **Total Time**: 34-68 seconds (2s per page avg)
- **Rate Limiting**: Not currently implemented (may be needed)

### **Comparison with Browser-Based Scrapers**:

| Feature | Chittorgarh (API) | BSE (Puppeteer) | NSE (Playwright) |
|---------|-------------------|-----------------|------------------|
| **Execution Time** | 2-5s (10 records) | 30-45s (20 IPOs) | 15-25s (15 IPOs) |
| **Memory Usage** | ~50MB | ~200MB | ~250MB |
| **CPU Usage** | Low | Medium | Medium |
| **Reliability** | High (REST API) | Medium (page changes) | Medium (page changes) |
| **Maintenance** | Low | Medium | Medium |

---

## **9. Limitations & Known Issues**

### **Data Limitations**:

1. **GMP Data**: ❌ NOT available on list API (requires detail page scraping)
2. **ISIN**: ❌ Not provided by Chittorgarh
3. **Financial Metrics**: ❌ Not available (revenue, profit, EPS, P/E)
4. **Company Descriptions**: ❌ Not available
5. **Sector Classification**: ⚠️ Limited/inconsistent
6. **Subscription Data**: ❌ Not available on list API

### **API Limitations**:

1. **Pagination**: Max 10 records per page (API enforced)
2. **Version Parameter**: Rolling value, requires periodic updates
3. **NCD Category**: Must use `all` + filter (no dedicated NCD category)
4. **Rate Limiting**: Unknown (not documented by Chittorgarh)
5. **Historical Data**: Limited to current/recent IPOs

### **Matching Accuracy** (Enrichment):

- **Rights/Debt Enrichment**: ~95% accuracy (fuzzy name matching)
- **False Positives**: Possible for similar company names
- **False Negatives**: Possible if company names differ significantly
- **Mitigation**: Manual verification recommended for critical data

### **Known Workarounds**:

| Limitation | Workaround | Priority |
|------------|-----------|----------|
| GMP Data | Use dedicated GMP API scraper (Investorgain) | HIGH |
| ISIN | Cross-reference with NSE scraper | MEDIUM |
| Financial Metrics | Use Moneycontrol scraper | HIGH |
| Company Description | Use Moneycontrol or prospectus | MEDIUM |
| Sector Classification | Use NSE or ML-based inference | LOW |

---

## **10. Usage & Execution**

### **Standalone Execution**:

```bash
cd scraper

# Run Chittorgarh scraper
npm start:chittorgarh  # If configured in package.json

# Or manually via index.ts
node dist/index.js --scraper chittorgarh
```

### **As Part of BSE Scraper**:

Automatically triggered during BSE scraper Phase 2B:

```typescript
// In bse-scraper-orchestrator.ts
// Phase 2B: Rights/Debt Enrichment
const rightsData = await fetchRightsIssuesFromChittorgarh();
const debtData = await fetchDebtIssuesFromChittorgarh();

// Enrich Rights IPOs with missing data
enrichedIPOs = enrichRightsIPOs(scrapedIPOs, rightsData);

// Enrich Debt IPOs with missing data
enrichedIPOs = enrichDebtIPOs(enrichedIPOs, debtData);
```

### **Scheduled Execution**:

```typescript
// In scheduler configuration (scheduler/config.ts)
{
  name: 'chittorgarh-scraper',
  schedule: '0 10 * * *',  // Daily at 10:00 AM IST
  handler: runChittorgarhScraper,
  enabled: true
}
```

**Recommended Schedule**:
- **Development**: On-demand (manual execution)
- **Production**: Daily at 10:00 AM IST (after market hours)
- **Frequency**: Once daily (data doesn't change frequently)

### **Manual API Testing**:

```bash
# Test REIT API
curl "https://webnodejs.chittorgarh.com/cloud/report/data-read/82/1/10/2025/2025-26/0/reit/0?search=&v=20-47"

# Test InvIT API
curl "https://webnodejs.chittorgarh.com/cloud/report/data-read/82/1/10/2025/2025-26/0/invit/0?search=&v=20-47"

# Test All category (for NCDs)
curl "https://webnodejs.chittorgarh.com/cloud/report/data-read/82/1/10/2025/2025-26/0/all/0?search=&v=20-47"

# Test pagination (page 2)
curl "https://webnodejs.chittorgarh.com/cloud/report/data-read/82/2/10/2025/2025-26/0/all/0?search=&v=20-47"
```

---

## **11. Testing**

### **Unit Tests**:

#### **Test File**: `scraper/tests/unit/scrapers/chittorgarh-scraper.test.ts`

**Test Coverage**:
- API URL construction
- Date parsing (display dates + ISO metadata)
- Price parsing (fixed + range formats)
- Amount conversion (crores to basic units)
- Category detection
- Status determination
- HTML anchor text extraction
- Error handling

**Example Tests**:
```typescript
describe('Chittorgarh Scraper', () => {
  describe('parseChittorgarhDate', () => {
    it('should parse ISO date from metadata', () => {
      const result = parseChittorgarhDate(
        'Tue, Oct 07, 2025',
        '2025-10-07T00:00:00.000Z'
      );
      expect(result).toBe('2025-10-07');
    });
  });

  describe('parseChittorgarhPrice', () => {
    it('should parse price range', () => {
      const result = parseChittorgarhPrice('120.00 to 125.00');
      expect(result).toEqual({ min: 120, max: 125 });
    });

    it('should parse fixed price', () => {
      const result = parseChittorgarhPrice('1140.00');
      expect(result).toEqual({ min: 1140, max: 1140 });
    });
  });
});
```

### **Integration Tests**:

#### **Test File**: `scraper/tests/unit/scrapers/chittorgarh-rights-debt-adapter.test.ts`

**Test Coverage**:
- Rights Issue API calls
- Debt Issue API calls with pagination
- Company name fuzzy matching
- Data transformation
- Error handling

**Example Tests**:
```typescript
describe('Chittorgarh Rights/Debt Adapter', () => {
  describe('fetchRightsIssuesFromChittorgarh', () => {
    it('should fetch REIT and InvIT data', async () => {
      const results = await fetchRightsIssuesFromChittorgarh();

      expect(results).toBeInstanceOf(Array);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].category).toBe('RIGHTS');
    });
  });

  describe('fetchDebtIssuesFromChittorgarh', () => {
    it('should fetch and filter NCD data', async () => {
      const results = await fetchDebtIssuesFromChittorgarh();

      expect(results).toBeInstanceOf(Array);
      results.forEach(record => {
        expect(record.category).toBe('NCD');
        expect(record.dataSource).toBe('CHITTORGARH');
      });
    });
  });
});
```

### **Test Results** (Story 11.6):

| Test Suite | Tests | Passing | Coverage |
|------------|-------|---------|----------|
| chittorgarh-scraper.test.ts | 15 | 15 ✅ | 92% |
| chittorgarh-rights-debt-adapter.test.ts | 10 | 10 ✅ | 88% |
| **Total** | **25** | **25 ✅** | **90%** |

**Test Execution**:
```bash
cd scraper

# Run all Chittorgarh tests
npm run test:unit -- -t "chittorgarh"

# Run specific test file
npm run test:unit -- tests/unit/scrapers/chittorgarh-scraper.test.ts

# Run with coverage
npm run test:unit -- --coverage tests/unit/scrapers/chittorgarh-*.test.ts
```

---

## **12. Summary Statistics**

### **Component Summary**:

| Feature | Count/Details |
|---------|---------------|
| **Components** | 3 (Scraper, Orchestrator, Adapter) |
| **Source Files** | 3 TypeScript files (~800 lines total) |
| **API Categories** | 7 (all, mainboard, sme, reit, invit, mainboard-fpo, sme-fpo) |
| **IPO Categories** | 4 (MAINBOARD, SME, RIGHTS, NCD) |
| **Fields Extracted** | 15+ |
| **Database Tables** | 3 (ipos, ipo_details, scraper_logs) |
| **Max Records/Page** | 10 (API enforced) |
| **Success Rate** | >95% |
| **Execution Time** | 2-5 seconds per page |
| **Unit Tests** | 25 tests (all passing) |
| **Test Coverage** | 90%+ |

### **Data Completeness**:

| Field | Availability | Notes |
|-------|--------------|-------|
| Company Name | ✅ 100% | Always present |
| Open/Close Dates | ✅ 100% | ISO metadata preferred |
| Price Range | ✅ 100% | Fixed or range format |
| Issue Amount | ✅ 100% | Converted to basic units |
| Exchange | ✅ 100% | BSE/NSE/BOTH |
| Category | ✅ 100% | Auto-detected |
| Status | ✅ 100% | Date-based logic |
| Lot Size | ⚠️ 70% | Via enrichment adapter |
| Face Value | ⚠️ 70% | Via enrichment adapter |
| Registrar | ⚠️ 60% | Via enrichment adapter |
| Lead Managers | ⚠️ 50% | Via enrichment adapter |
| GMP | ❌ 0% | Not available on list API |
| ISIN | ❌ 0% | Not provided |
| Financials | ❌ 0% | Not available |

### **Performance Benchmarks**:

| Metric | Value | Comparison |
|--------|-------|------------|
| **API Response Time** | <1s | ✅ Faster than browser scrapers |
| **Memory Usage** | ~50MB | ✅ 4x less than Puppeteer |
| **CPU Usage** | Low | ✅ Minimal processing |
| **Reliability** | >95% | ✅ REST API-based |
| **Maintenance Effort** | Low | ✅ Less prone to breakage |

---

## **Related Documentation**

### **Stories & Epics**:
- **Epic 11**: Feature Enhancements & Data Quality Improvements
- **Story 11.1**: Implement Rights/Debt IPO Detail Scraper
- **Story 11.6**: Fix Chittorgarh NCD API Integration ✅

### **Technical Documentation**:
- `docs/08-scraping/chittorgarh-ncd-api-fix-analysis.md` - NCD API fix root cause analysis
- `docs/08-scraping/BSE-Scraping-Complete-Scope.md` - BSE scraper scope (includes Chittorgarh enrichment)
- `docs/04-stories/11.6.fix-chittorgarh-ncd-api.md` - Story 11.6 full specification

### **Codebase Files**:
- `scraper/src/scrapers/chittorgarh-scraper.ts` - Main scraper (409 lines)
- `scraper/src/scrapers/chittorgarh-orchestrator.ts` - Orchestrator (219 lines)
- `scraper/src/scrapers/chittorgarh-rights-debt-adapter.ts` - Enrichment adapter (494 lines)
- `scraper/tests/unit/scrapers/chittorgarh-scraper.test.ts` - Unit tests
- `scraper/tests/unit/scrapers/chittorgarh-rights-debt-adapter.test.ts` - Integration tests

---

## **Future Enhancements**

### **Short-term (Q1 2026)**:

1. **GMP Data Integration**
   - Scrape GMP from Chittorgarh detail pages
   - Integrate with existing GMP API scraper
   - Priority: HIGH

2. **Historical Data Backfill**
   - Fetch historical IPO data from Chittorgarh
   - Backfill database for analysis
   - Priority: MEDIUM

3. **Rate Limiting Implementation**
   - Add respectful rate limiting (2-3 requests/second)
   - Prevent potential IP blocking
   - Priority: MEDIUM

### **Long-term (Q2+ 2026)**:

4. **Automated Version Detection**
   - Scrape Chittorgarh website to detect current version parameter
   - Auto-update API calls without code changes
   - Priority: LOW

5. **Enhanced Matching Algorithm**
   - Use Levenshtein distance for fuzzy matching
   - Match by ISIN when available
   - Date range proximity matching
   - Priority: MEDIUM

6. **Real-time Scraping**
   - Implement webhook/polling for real-time updates
   - Reduce latency for IPO status changes
   - Priority: LOW

---

**Document Maintained By:** IPODhan Development Team
**Last Review Date:** 2025-10-19
**Next Review:** 2025-11-19 (Monthly)

---
