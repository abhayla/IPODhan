# Scraper Test Issues Report

**Date**: 2025-10-18
**Scraper Run**: All (NSE, BSE, Moneycontrol, Chittorgarh, API Fallback)
**Test Duration**: ~30 minutes
**Tester**: Automated Verification System

---

## Executive Summary

**Overall Status**: PARTIAL SUCCESS - Critical data coverage gaps detected

**Total Issues Found**: 12
- **Critical (P0)**: 3 - GMP scraping failure, Subscription data missing, BSE scraper high failure rate
- **High Priority (P1)**: 4 - Financial data, Documents, Registrar linkage, Fuzzy duplicates
- **Medium Priority (P2)**: 3 - Price range validation, Listing performance gaps, Scraper error patterns
- **Low Priority (P3)**: 2 - API fallback unused, Scraper logs metrics

**Key Metrics**:
- Total Scrapers Run: 5/5 (100%)
- Scrapers with Issues: 3/5 (60%)
- Database Records Created: +6 IPOs
- Data Coverage: **CRITICAL GAPS IDENTIFIED**

---

## Scraper Execution Summary

| Scraper | Status | IPOs Processed | Inserted | Updated | Failed | Success Rate | Notes |
|---------|--------|----------------|----------|---------|--------|--------------|-------|
| **NSE** | ✅ SUCCESS | 2 | 0 | 2 | 0 | 100% | Clean execution |
| **BSE** | ⚠️ PARTIAL | 12 | 0 | 12 | 11 | 8.3% | **HIGH FAILURE RATE** |
| **Moneycontrol** | ✅ SUCCESS | 7 | 1 | 6 | 0 | 100% | Clean execution |
| **Chittorgarh** | ⚠️ PARTIAL | 303 | 5 | 298 | 2 | 99.3% | Minor failures |
| **API Fallback** | ❌ UNUSED | 0 | 0 | 0 | 0 | N/A | **NEVER TRIGGERED** |
| **TOTAL** | ⚠️ PARTIAL | **324** | **6** | **318** | **13** | 96.0% | See issues below |

---

## Database State Changes

### Record Counts (Before → After)

| Table | Before | After | Change | Status |
|-------|--------|-------|--------|--------|
| **ipos** | 484 | 490 | +6 | ✅ Growing |
| **subscriptions** | 5 | 5 | **0** | ❌ CRITICAL |
| **gmp_records** | 0 | 0 | **0** | ❌ CRITICAL |
| **financial_data** | N/A | N/A | **0** | ❌ CRITICAL |
| **documents** | N/A | N/A | **0** | ❌ CRITICAL |
| **listing_performance** | N/A | N/A | Partial | ⚠️ Incomplete |
| **scraper_logs** | 157 | 160 | +3 | ✅ Normal |

### Data Coverage Analysis

| Metric | Current State | Expected | Coverage % | Status |
|--------|--------------|----------|------------|--------|
| **Subscription Data** | 2/456 IPOs | 37 OPEN IPOs | 5.41% | ❌ CRITICAL |
| **GMP Data** | 0/456 IPOs | ~200 IPOs | 0% | ❌ CRITICAL |
| **Financial Data** | 0/456 IPOs | ~400 IPOs | 0% | ❌ CRITICAL |
| **Documents** | 0/456 IPOs | ~300 IPOs | 0% | ❌ CRITICAL |
| **Listing Performance** | 77/384 LISTED | 384 LISTED | 20.05% | ⚠️ PARTIAL |
| **Registrar Links** | 0/456 IPOs | ~400 IPOs | 0% | ❌ CRITICAL |

---

## Data Quality Issues

### Duplicates Detection

**Fuzzy Duplicates Found**: 3 IPOs (similarity > 0.85)
- Status: ⚠️ MEDIUM - Potential duplicate companies with slightly different names
- Recommendation: Manual review required to determine if legitimate variations or true duplicates

### Price Range Validation

**Fixed-Price IPOs**: 20 IPOs with `price_range_min == price_range_max`
- Status: ✅ VALID - Common for fixed-price offerings (especially SME IPOs)
- No action required

---

## Critical Issues (P0) - MUST FIX IMMEDIATELY

### Issue #1: GMP Scraping Complete Failure

**Severity**: CRITICAL (P0)
**Category**: Scraper / Data Coverage
**Phase Detected**: Database Verification
**Location**: `scraper/src/scrapers/chittorgarh-gmp-scraper.ts` (or equivalent)

**Expected Behavior**:
- Chittorgarh scraper should populate `gmp_records` table with historical GMP data
- Should update `ipos.gmp_price` and `ipos.gmp_percentage_historical` fields
- Expected coverage: ~200+ IPOs with active GMP tracking

**Actual Behavior**:
- `gmp_records` table is completely empty (0 records)
- No GMP data in `ipos` table
- 0% coverage across all IPOs

**Steps to Reproduce**:
1. Check `gmp_records` table: `SELECT COUNT(*) FROM gmp_records;` → Returns 0
2. Check `ipos.gmp_price`: `SELECT COUNT(gmp_price) FROM ipos WHERE gmp_price IS NOT NULL;` → Returns 0
3. Verify Chittorgarh scraper ran: Logs show 303 processed, 298 updated, 2 failed

**Root Cause**:
One or more of the following:
1. **Scraper not implemented**: GMP scraper module may not exist or not be called
2. **Selector mismatch**: HTML structure on Chittorgarh website changed
3. **Data persister issue**: GMP data extracted but not saved to database
4. **Table relationship issue**: Foreign key constraint preventing inserts

**Recommendation**:
```bash
# Step 1: Verify GMP scraper exists and is called
cd scraper
grep -r "gmpRecords" src/  # Check if GMP persisting logic exists
grep -r "chittorgarh" src/index.ts  # Verify Chittorgarh scraper runs

# Step 2: Run Chittorgarh scraper in debug mode
DEBUG=scraper:* npm run start:chittorgarh 2>&1 | tee gmp_debug.log

# Step 3: Inspect extracted data before persistence
# Add console.log in data-persister.ts to log GMP data structure

# Step 4: Verify database schema
psql -d ipodhan -c "\d gmp_records"  # Check table structure
psql -d ipodhan -c "SELECT * FROM scraper_logs WHERE source = 'CHITTORGARH' ORDER BY created_at DESC LIMIT 1;"
```

**Fix Priority**: **IMMEDIATE** - GMP is a critical differentiator feature

**Affected Records**: All 456 IPOs (0% coverage)

---

### Issue #2: Subscription Data Not Updating

**Severity**: CRITICAL (P0)
**Category**: Scraper / Data Persistence
**Phase Detected**: Database Verification
**Location**: `scraper/src/scrapers/nse-scraper.ts` → `data-persister.ts`

**Expected Behavior**:
- NSE scraper should update `subscriptions` table in real-time for OPEN IPOs
- Coverage should be 100% for all OPEN IPOs (37 IPOs currently OPEN)
- Time-series data should accumulate with each scraper run

**Actual Behavior**:
- `subscriptions` table unchanged (5 records before, 5 records after)
- Only 2/456 IPOs (0.44%) have subscription data
- Only 2/37 OPEN IPOs (5.41%) have subscription data
- **NSE processed 2 IPOs but no subscription inserts detected**

**Steps to Reproduce**:
1. Count OPEN IPOs: `SELECT COUNT(*) FROM ipos WHERE status = 'OPEN';` → Returns 37
2. Count subscriptions: `SELECT COUNT(DISTINCT ipo_id) FROM subscriptions;` → Returns 2
3. Check recent subscriptions: `SELECT * FROM subscriptions ORDER BY timestamp DESC LIMIT 10;`
4. NSE scraper shows: Processed=2, Updated=2, Failed=0 (but no subscription inserts)

**Root Cause Analysis**:

**Hypothesis 1: Subscription Data Not Being Extracted**
```javascript
// Check if NSE scraper extracts subscription fields
// File: scraper/src/scrapers/nse-scraper.ts
// Look for: qib_subscription, nii_subscription, retail_subscription parsing
```

**Hypothesis 2: Data Persister Not Saving Subscription Records**
```javascript
// File: scraper/src/services/data-persister.ts
// Check if function saveSubscription() exists and is called
// Verify transaction scope includes subscription inserts
```

**Hypothesis 3: IPO Status Filtering Issue**
```javascript
// NSE might only scrape MAINBOARD IPOs
// Check if status='OPEN' filter is applied correctly
```

**Recommendation**:

**Immediate Fix Steps**:
```bash
# 1. Enable debug logging for NSE scraper
cd scraper
DEBUG=nse:* npm run start:nse

# 2. Check extracted data structure
# Add logging in nse-scraper.ts before persisting:
console.log('Extracted IPO data:', JSON.stringify(ipoData, null, 2));

# 3. Verify data-persister logic
# File: scraper/src/services/data-persister.ts
# Add logging:
console.log('Saving subscription data:', subscriptionData);

# 4. Manual test subscription insert
psql -d ipodhan -c "
INSERT INTO subscriptions (ipo_id, timestamp, qib_subscription, nii_subscription, retail_subscription, total_subscription)
VALUES (
  (SELECT id FROM ipos WHERE status = 'OPEN' LIMIT 1),
  NOW(),
  1.5,
  2.3,
  0.8,
  1.4
);
"
# If this works, issue is in scraper, not database
```

**Code Fix Required**:
1. Ensure NSE scraper extracts subscription data from HTML/API
2. Update `data-persister.ts` to insert subscription records
3. Add time-series tracking (don't overwrite, append with timestamp)

**Fix Priority**: **IMMEDIATE** - Subscription tracking is a core real-time feature

**Affected Records**: 35/37 OPEN IPOs missing subscription data (94.6% gap)

---

### Issue #3: BSE Scraper High Failure Rate

**Severity**: CRITICAL (P0)
**Category**: Scraper Reliability
**Phase Detected**: Scraper Execution
**Location**: `scraper/src/scrapers/bse-scraper.ts`

**Expected Behavior**:
- BSE scraper should have success rate > 90%
- Failed records should be rare exceptions (network issues, invalid data)
- Processed=12, Failed should be 0-1 maximum

**Actual Behavior**:
- **Processed: 12**
- **Failed: 11**
- **Success Rate: 8.3%** (1 out of 12 succeeded)
- 91.7% failure rate is unacceptable

**Steps to Reproduce**:
1. Run BSE scraper: `npm run start:bse`
2. Observe console output showing failures
3. Check `scraper_logs` table for error messages
4. Likely seeing repeated errors for 11 IPOs

**Root Cause** (Likely Scenarios):

**Scenario 1: Website Structure Changed**
- BSE website HTML/selectors changed
- Scraper selectors no longer match elements
- Returns null/undefined causing validation failures

**Scenario 2: Anti-Scraping Measures**
- BSE implemented rate limiting
- CAPTCHA detection blocking requests
- IP blocking after first request

**Scenario 3: Data Validation Errors**
- Extracted data fails schema validation
- Required fields missing in HTML
- Type conversion errors (string to number)

**Recommendation**:

**Diagnostic Steps**:
```bash
# 1. Inspect scraper error logs
psql -d ipodhan -c "
SELECT error_message, records_failed, created_at
FROM scraper_logs
WHERE source = 'BSE'
ORDER BY created_at DESC
LIMIT 5;
"

# 2. Run BSE scraper with full debug logging
cd scraper
DEBUG=* npm run start:bse 2>&1 | tee bse_debug_log.txt

# 3. Save raw HTML for inspection
# Add to bse-scraper.ts:
# const fs = require('fs');
# fs.writeFileSync('bse_page_sample.html', htmlContent);

# 4. Test single IPO extraction
# Create test script: scraper/src/scripts/test-bse-single.ts
```

**Fix Strategy**:

**If Selectors Changed**:
```javascript
// Update selectors in bse-scraper.ts
// Old: const issueSize = $('.table-row .issue-size').text();
// New: Inspect current HTML, update selector
```

**If Rate Limited**:
```javascript
// Add delays between requests
await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
// Add User-Agent rotation
// Implement exponential backoff
```

**If Data Validation**:
```javascript
// Make fields optional during extraction
// Add try-catch around each field
// Log exact validation error message
```

**Fix Priority**: **IMMEDIATE** - 91.7% failure rate blocks SME IPO data collection

**Affected Records**: 11 BSE-listed IPOs failed to update

---

## High Priority Issues (P1) - FIX BEFORE PRODUCTION

### Issue #4: Financial Data 0% Coverage

**Severity**: HIGH (P1)
**Category**: Data Coverage / Scraper Gap
**Phase Detected**: Database Verification
**Location**: Multiple scrapers (Moneycontrol, BSE, NSE)

**Expected Behavior**:
- `financial_data` or `ipo_financials` table should have 80%+ coverage
- Moneycontrol scraper should extract revenue, profit, EPS, P/E ratio
- BSE/NSE should provide face value, issue size (already working)

**Actual Behavior**:
- 0% coverage for detailed financial metrics
- Revenue, Profit, EPS, ROE, Debt-to-Equity all missing
- UI "Financials" tab will be empty for all IPOs

**Root Cause**:
1. **Scraper not implemented**: Financial data extraction may not be coded
2. **Table not in use**: Schema has `financial_data` and `ipo_financials` tables but no inserts

**Recommendation**:
```bash
# 1. Verify financial data scraper exists
cd scraper
grep -r "financialData\|ipoFinancials" src/

# 2. Check Moneycontrol scraper extracts financials
grep -r "revenue\|profit\|eps" src/scrapers/moneycontrol-scraper.ts

# 3. If not implemented, add financial extraction to Moneycontrol scraper
# Target fields: revenue, profit, eps, pe_ratio, roe, debt_to_equity

# 4. Update data-persister.ts to save financial records
```

**Fix Priority**: P1 - Required for IPO detail page completeness

**Affected Records**: All 456 IPOs (0% coverage)

---

### Issue #5: Documents Table Empty

**Severity**: HIGH (P1)
**Category**: Data Coverage / Scraper Gap
**Phase Detected**: Database Verification
**Location**: `scraper/src/scrapers/` (document scraper missing)

**Expected Behavior**:
- `documents` table should contain DRHP, RHP, Prospectus PDFs
- Expected coverage: ~60% (300 IPOs with at least 1 document)
- Documents available from NSE/BSE/SEBI websites

**Actual Behavior**:
- `documents` table is empty (0 records)
- No document links saved for any IPO
- UI "Documents" tab will show "No documents available"

**Root Cause**:
- **Document scraper not implemented yet**
- NSE/BSE scrapers not extracting document URLs
- No document download/storage logic

**Recommendation**:
```javascript
// Implement document scraper
// File: scraper/src/scrapers/document-scraper.ts

export async function scrapeDocuments(ipoId: string, ipoName: string) {
  // 1. Fetch documents from NSE: https://www.nseindia.com/market-data/sme-ipo
  // 2. Fetch documents from BSE: https://www.bseindia.com/corporates/Forth_Coming.aspx
  // 3. Parse document links (DRHP, RHP, Prospectus)
  // 4. Save to documents table with metadata (file_size, upload_date)

  await db.insert(documents).values({
    ipo_id: ipoId,
    title: 'Draft Red Herring Prospectus',
    document_type: 'DRHP',
    file_url: documentUrl,
    file_size: '2.5 MB',
    uploaded_at: new Date()
  });
}
```

**Fix Priority**: P1 - Important for investor research (documents are regulatory requirement)

**Affected Records**: All 456 IPOs (0% coverage)

---

### Issue #6: Registrar Linkage Missing

**Severity**: HIGH (P1)
**Category**: Data Relationship / Scraper Gap
**Phase Detected**: Database Verification
**Location**: `scraper/src/scrapers/` (registrar linkage not implemented)

**Expected Behavior**:
- `ipos.registrar` field should link to `registrars.id`
- 4 registrars exist in database
- Expected: ~400 IPOs should have registrar linkage (87% coverage)

**Actual Behavior**:
- 0 IPOs linked to any registrar
- `ipos.registrar` field is NULL for all records
- `registrars` table exists with 4 entries but unused

**Root Cause**:
- Scraper extracts registrar **name** but doesn't match to `registrars.id`
- No registrar lookup/matching logic in data-persister

**Recommendation**:
```javascript
// File: scraper/src/services/data-persister.ts

async function linkRegistrar(registrarName: string): Promise<string | null> {
  if (!registrarName) return null;

  // Fuzzy match registrar name to existing registrars
  const registrar = await db.query.registrars.findFirst({
    where: (registrars, { ilike }) =>
      ilike(registrars.name, `%${registrarName}%`)
  });

  return registrar?.id || null;
}

// When saving IPO:
const registrarId = await linkRegistrar(scrapedData.registrar);
await db.insert(ipos).values({
  ...ipoData,
  registrar: registrarId  // Save ID, not name
});
```

**Query to Test Fix**:
```sql
-- After fix, should return ~400 IPOs
SELECT COUNT(*) FROM ipos WHERE registrar IS NOT NULL;

-- Verify distribution
SELECT r.name, COUNT(i.id) as ipo_count
FROM registrars r
LEFT JOIN ipos i ON i.registrar = r.id
GROUP BY r.id, r.name;
```

**Fix Priority**: P1 - Registrar contact info is important for investors

**Affected Records**: All 456 IPOs (0% coverage)

---

### Issue #7: Fuzzy Duplicate IPOs Detected

**Severity**: HIGH (P1)
**Category**: Data Quality
**Phase Detected**: Database Verification (Duplicate Detection)
**Location**: Database `ipos` table

**Expected Behavior**:
- Each company should have only 1 IPO record
- No duplicate IPOs with similarity > 0.85

**Actual Behavior**:
- 3 fuzzy duplicates found (company names with similarity > 0.85)
- Likely cases:
  - Same company, different name formats (e.g., "ABC Ltd" vs "ABC Limited")
  - Typos in company name
  - Legitimate different companies with similar names

**Steps to Reproduce**:
```sql
-- Detect fuzzy duplicates
SELECT i1.id as id1, i1.company_name as name1,
       i2.id as id2, i2.company_name as name2,
       similarity(i1.company_name, i2.company_name) as similarity_score
FROM ipos i1
JOIN ipos i2 ON i1.id < i2.id
WHERE similarity(i1.company_name, i2.company_name) > 0.85
  AND i1.id != i2.id
ORDER BY similarity_score DESC;
```

**Root Cause**:
- Different scrapers use different company name formats
- No name normalization during scraping
- No duplicate detection before insert

**Recommendation**:

**Manual Review Required**:
```bash
# 1. Export duplicate pairs for manual review
psql -d ipodhan -c "..." > duplicate_pairs.csv

# 2. For each pair, determine:
#    - Same company? → Merge records (keep one, delete other)
#    - Different companies? → Keep both, mark as false positive

# 3. If merging needed:
psql -d ipodhan -c "
-- Merge subscriptions, GMP, documents to canonical IPO ID
UPDATE subscriptions SET ipo_id = 'canonical_id' WHERE ipo_id = 'duplicate_id';
UPDATE gmp_records SET ipo_id = 'canonical_id' WHERE ipo_id = 'duplicate_id';
-- Delete duplicate
DELETE FROM ipos WHERE id = 'duplicate_id';
"
```

**Preventive Fix**:
```javascript
// File: scraper/src/services/data-persister.ts

function normalizeCompanyName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')  // Collapse multiple spaces
    .replace(/\bLtd\.?$/i, 'Limited')  // Standardize "Ltd" to "Limited"
    .replace(/\bPvt\.?$/i, 'Private')  // Standardize "Pvt" to "Private"
    .toUpperCase();  // Case insensitive comparison
}

// Before insert, check for duplicates
const normalized = normalizeCompanyName(companyName);
const existing = await db.query.ipos.findFirst({
  where: (ipos, { sql }) =>
    sql`similarity(UPPER(company_name), ${normalized}) > 0.9`
});

if (existing) {
  // Merge logic instead of insert
}
```

**Fix Priority**: P1 - Data integrity issue, affects analytics and UI

**Affected Records**: 3 duplicate pairs (6 records total)

---

## Medium Priority Issues (P2) - FIX THIS SPRINT

### Issue #8: Price Range Validation - Fixed-Price IPOs

**Severity**: MEDIUM (P2)
**Category**: Data Validation (False Positive)
**Phase Detected**: Database Verification
**Location**: Database `ipos` table

**Expected Behavior**:
- Book-built IPOs have price range (e.g., ₹100-₹120)
- Fixed-price IPOs have single price (price_min == price_max)

**Actual Behavior**:
- 20 IPOs with `price_range_min == price_range_max`
- **This is VALID for fixed-price offerings** (common in SME IPOs)

**Root Cause**:
- Not an issue - this is expected behavior
- Fixed-price IPOs are legitimate

**Recommendation**:
- ✅ **No fix required**
- Update validation query to exclude fixed-price check:

```sql
-- Updated validation (exclude false positives)
SELECT id, company_name, price_range_min, price_range_max
FROM ipos
WHERE price_range_min > price_range_max  -- Only flag if min > max
   OR price_range_min <= 0
   OR price_range_max <= 0;
```

**Fix Priority**: P2 - Documentation update, no code fix needed

**Affected Records**: 0 (false positive resolved)

---

### Issue #9: Listing Performance Coverage at 20%

**Severity**: MEDIUM (P2)
**Category**: Data Coverage
**Phase Detected**: Database Verification
**Location**: `listing_performance` table

**Expected Behavior**:
- 100% of LISTED IPOs should have listing performance data
- 384 LISTED IPOs → 384 records in `listing_performance`

**Actual Behavior**:
- Only 77/384 LISTED IPOs have listing performance (20.05%)
- 307 LISTED IPOs missing listing price, current price, returns

**Root Cause**:
- Historical data: Scrapers only capture NEW listings
- Old IPOs listed before scraper deployment have no data
- No backfill script for historical listings

**Recommendation**:

**Option 1: Backfill Historical Data**
```javascript
// Create script: scraper/src/scripts/backfill-listing-performance.ts

import { db } from '@ipodhan/shared/db';
import { ipos, listingPerformance } from '@ipodhan/shared/db/schema';
import { eq, isNull } from 'drizzle-orm';

async function backfillListingPerformance() {
  // Get all LISTED IPOs without listing_performance
  const listedIPOs = await db.query.ipos.findMany({
    where: eq(ipos.status, 'LISTED'),
    with: {
      listingPerformance: true
    }
  });

  const missingPerformance = listedIPOs.filter(ipo => !ipo.listingPerformance);

  for (const ipo of missingPerformance) {
    // Scrape listing data from NSE/BSE historical data
    const listingData = await fetchHistoricalListingData(ipo.symbol, ipo.listing_date);

    await db.insert(listingPerformance).values({
      ipo_id: ipo.id,
      listing_price: listingData.listingPrice,
      current_price: listingData.currentPrice,
      listing_day_return_percentage: listingData.listingReturn,
      overall_return_percentage: listingData.overallReturn
    });
  }
}
```

**Option 2: Mark as Historical (No Data)**
- Add `is_historical` flag to `listing_performance`
- Display "Historical IPO - Data Not Available" in UI

**Fix Priority**: P2 - Improves data completeness but not critical

**Affected Records**: 307/384 LISTED IPOs missing performance data (79.95%)

---

### Issue #10: Scraper Error Patterns Not Logged

**Severity**: MEDIUM (P2)
**Category**: Monitoring / Observability
**Phase Detected**: Scraper Logs Analysis
**Location**: `scraper_logs` table, scraper error handling

**Expected Behavior**:
- `scraper_logs.error_message` should contain detailed error context
- Errors should be categorized (network, validation, parsing, etc.)
- Error patterns should be identifiable for debugging

**Actual Behavior**:
- Limited error context in logs
- BSE scraper shows 11 failures but error details unclear
- No categorization of error types

**Root Cause**:
- Error logging in scrapers is minimal
- Errors caught generically without context
- No structured error logging

**Recommendation**:

```javascript
// File: scraper/src/scrapers/base-scraper.ts

enum ErrorCategory {
  NETWORK = 'NETWORK',
  PARSING = 'PARSING',
  VALIDATION = 'VALIDATION',
  DATABASE = 'DATABASE',
  UNKNOWN = 'UNKNOWN'
}

function categorizeError(error: Error): ErrorCategory {
  if (error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
    return ErrorCategory.NETWORK;
  }
  if (error.message.includes('selector') || error.message.includes('parse')) {
    return ErrorCategory.PARSING;
  }
  if (error.message.includes('validation') || error.message.includes('required')) {
    return ErrorCategory.VALIDATION;
  }
  if (error.message.includes('database') || error.message.includes('constraint')) {
    return ErrorCategory.DATABASE;
  }
  return ErrorCategory.UNKNOWN;
}

async function logScraperError(source: string, error: Error, context: any) {
  await db.insert(scraperLogs).values({
    source,
    status: 'FAILURE',
    error_message: error.message,
    error_category: categorizeError(error),  // New field
    error_stack: error.stack,                // New field
    error_context: JSON.stringify(context),  // New field (IPO ID, URL, etc.)
    records_failed: 1
  });
}
```

**Enhanced Error Logging**:
```javascript
try {
  const data = await scrapeIPO(url);
} catch (error) {
  await logScraperError('BSE', error, {
    url,
    ipoId: currentIPOId,
    step: 'data_extraction'
  });
}
```

**Fix Priority**: P2 - Improves debugging and monitoring

**Affected Records**: N/A (operational improvement)

---

## Low Priority Issues (P3) - BACKLOG

### Issue #11: API Fallback Never Triggered

**Severity**: LOW (P3)
**Category**: Scraper / Backup Strategy
**Phase Detected**: Scraper Execution Summary
**Location**: `scraper/src/scrapers/api-fallback.ts`

**Expected Behavior**:
- API Fallback scraper should trigger when primary scrapers fail
- Should attempt to fetch missing data from alternative APIs
- Should log attempted recovery

**Actual Behavior**:
- API Fallback processed 0 IPOs
- Never triggered during test run
- Processed=0, Inserted=0, Updated=0, Failed=0

**Root Cause**:
1. **Not implemented**: Fallback logic may not be coded
2. **Trigger conditions not met**: Scrapers didn't fail catastrophically
3. **Manual trigger only**: Requires explicit invocation

**Recommendation**:

**Verify Implementation**:
```bash
cd scraper
cat src/scrapers/api-fallback.ts  # Check if file exists

# Check if fallback is triggered automatically
grep -r "runIPOAlertsFallback\|api-fallback" src/index.ts
```

**Implement Auto-Trigger**:
```javascript
// File: scraper/src/index.ts

async function runAllScrapers() {
  const results = {
    nse: await runNSEScraper(),
    bse: await runBSEScraper(),
    moneycontrol: await runMoneycontrolScraper(),
    chittorgarh: await runChittorgarhScraper()
  };

  // Trigger fallback if any scraper failed significantly
  const totalProcessed = results.nse.processed + results.bse.processed;
  const totalFailed = results.nse.failed + results.bse.failed;
  const failureRate = totalFailed / totalProcessed;

  if (failureRate > 0.2) {  // > 20% failure rate
    console.log('High failure rate detected, triggering API fallback...');
    await runIPOAlertsFallback();
  }
}
```

**Fix Priority**: P3 - Nice to have, not critical (primary scrapers working)

**Affected Records**: N/A (operational improvement)

---

### Issue #12: Scraper Logs Missing Performance Metrics

**Severity**: LOW (P3)
**Category**: Monitoring
**Phase Detected**: Database Verification
**Location**: `scraper_logs` table schema

**Expected Behavior**:
- `scraper_logs` should include `duration_ms` field
- Should track avg/min/max processing time per IPO
- Should track memory usage peaks

**Actual Behavior**:
- Only 3 scraper_logs entries added (+3)
- No performance metrics visible in query results
- Cannot analyze scraper performance trends

**Root Cause**:
- `duration_ms` field may not be populated
- No instrumentation for performance tracking

**Recommendation**:

```javascript
// File: scraper/src/scrapers/base-scraper.ts

async function runScraper(source: string, scrapeFunction: Function) {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;

  try {
    const results = await scrapeFunction();
    const endTime = Date.now();
    const endMemory = process.memoryUsage().heapUsed;

    await db.insert(scraperLogs).values({
      source,
      status: 'SUCCESS',
      duration_ms: endTime - startTime,
      memory_used_mb: (endMemory - startMemory) / 1024 / 1024,
      records_processed: results.processed,
      records_failed: results.failed
    });
  } catch (error) {
    // Error logging
  }
}
```

**Performance Dashboard Query**:
```sql
-- Analyze scraper performance
SELECT
  source,
  AVG(duration_ms) as avg_duration_ms,
  MIN(duration_ms) as min_duration_ms,
  MAX(duration_ms) as max_duration_ms,
  AVG(records_processed::float / duration_ms * 1000) as avg_records_per_sec
FROM scraper_logs
WHERE created_at > NOW() - INTERVAL '7 days'
  AND status = 'SUCCESS'
GROUP BY source
ORDER BY avg_duration_ms DESC;
```

**Fix Priority**: P3 - Nice to have for monitoring and optimization

**Affected Records**: N/A (operational improvement)

---

## Recommendations

### Immediate Actions (Next 24 Hours)

1. **Fix P0 Issues First**:
   - **GMP Scraping**: Debug Chittorgarh GMP extraction, verify data-persister logic
   - **Subscription Updates**: Add real-time subscription tracking to NSE scraper
   - **BSE Reliability**: Debug 91.7% failure rate, update selectors or add retry logic

2. **Quick Wins**:
   - Run manual subscription insert test to verify database schema
   - Export BSE error logs to identify exact failure pattern
   - Save raw HTML from Chittorgarh to verify GMP data availability

### Short-Term Fixes (This Week)

3. **P1 Data Coverage**:
   - Implement financial data extraction in Moneycontrol scraper
   - Add document scraper for DRHP/RHP/Prospectus PDFs
   - Add registrar linkage logic in data-persister

4. **Data Quality**:
   - Manually review and merge 3 fuzzy duplicate pairs
   - Implement company name normalization to prevent future duplicates

### Medium-Term Improvements (This Sprint)

5. **P2 Enhancements**:
   - Create backfill script for 307 missing listing performance records
   - Enhance error logging with categorization and context
   - Update validation queries to exclude false positives (fixed-price IPOs)

6. **Monitoring**:
   - Add performance metrics to scraper_logs (duration, memory)
   - Create dashboard for scraper health monitoring
   - Set up alerts for failure rates > 10%

### Long-Term Optimizations (Backlog)

7. **P3 Features**:
   - Implement automatic API fallback trigger
   - Add scraper performance analytics
   - Create automated duplicate detection job

---

## Next Steps

### Phase 1: Critical Issue Resolution (P0)

**Owner**: Development Team
**Timeline**: 24-48 hours
**Tasks**:

1. **GMP Scraping Fix**:
   ```bash
   cd scraper
   # Debug Chittorgarh scraper
   DEBUG=* npm run start:chittorgarh > gmp_debug.log 2>&1

   # Verify extracted data
   grep -A 10 "GMP" gmp_debug.log

   # Test database insert manually
   node -e "require('./dist/scripts/test-gmp-insert.js')"
   ```

2. **Subscription Tracking Fix**:
   ```bash
   # Add logging to NSE scraper
   cd scraper/src/scrapers
   # Edit nse-scraper.ts - add console.log for subscription data

   # Run NSE scraper
   npm run start:nse

   # Verify subscriptions table updated
   psql -d ipodhan -c "SELECT COUNT(*) FROM subscriptions WHERE timestamp > NOW() - INTERVAL '1 hour';"
   ```

3. **BSE Scraper Debugging**:
   ```bash
   # Save current BSE page HTML
   curl "https://www.bseindia.com/..." > bse_current.html

   # Compare with expected structure
   diff bse_current.html bse_expected.html

   # Update selectors in bse-scraper.ts
   # Add 2-second delay between requests
   ```

**Success Criteria**:
- [ ] GMP records table has > 0 records
- [ ] Subscriptions table grows with each NSE run
- [ ] BSE success rate > 80%

---

### Phase 2: High Priority Fixes (P1)

**Owner**: Development Team
**Timeline**: 3-5 days
**Tasks**:

1. Implement financial data scraper (Moneycontrol)
2. Implement document scraper (NSE/BSE/SEBI)
3. Add registrar linkage logic
4. Review and merge duplicate IPOs (manual review required)

**Success Criteria**:
- [ ] Financial data coverage > 60%
- [ ] Document coverage > 40%
- [ ] Registrar linkage coverage > 80%
- [ ] 0 duplicate IPOs remaining

---

### Phase 3: Validation & Monitoring (P2/P3)

**Owner**: QA Team
**Timeline**: 1 week
**Tasks**:

1. Create backfill script for listing performance
2. Enhance scraper error logging
3. Add performance metrics tracking
4. Set up monitoring dashboard

**Success Criteria**:
- [ ] Listing performance coverage > 80%
- [ ] All errors have category and context
- [ ] Performance metrics tracked for all scrapers
- [ ] Monitoring dashboard deployed

---

## Test Validation Queries

Run these queries to verify fixes:

```sql
-- Verify GMP data populated
SELECT
  COUNT(DISTINCT ipo_id) as ipos_with_gmp,
  COUNT(*) as total_gmp_records,
  MIN(timestamp) as oldest_record,
  MAX(timestamp) as newest_record
FROM gmp_records;
-- Expected: > 100 IPOs, > 500 records

-- Verify subscription data updating
SELECT
  COUNT(DISTINCT ipo_id) as ipos_with_subscriptions,
  COUNT(*) as total_subscription_records,
  MAX(timestamp) as latest_update
FROM subscriptions;
-- Expected: > 30 IPOs (all OPEN), latest_update within last hour

-- Verify BSE scraper success
SELECT
  source,
  status,
  records_processed,
  records_failed,
  ROUND(100.0 * records_failed / NULLIF(records_processed, 0), 2) as failure_rate_pct
FROM scraper_logs
WHERE source = 'BSE'
ORDER BY created_at DESC
LIMIT 1;
-- Expected: failure_rate_pct < 20%

-- Verify financial data coverage
SELECT
  COUNT(DISTINCT ipo_id) as ipos_with_financials,
  ROUND(100.0 * COUNT(DISTINCT ipo_id) / (SELECT COUNT(*) FROM ipos), 2) as coverage_pct
FROM financial_data;  -- or ipo_financials
-- Expected: > 60%

-- Verify document coverage
SELECT
  COUNT(DISTINCT ipo_id) as ipos_with_documents,
  ROUND(100.0 * COUNT(DISTINCT ipo_id) / (SELECT COUNT(*) FROM ipos), 2) as coverage_pct
FROM documents;
-- Expected: > 40%

-- Verify registrar linkage
SELECT
  r.name as registrar_name,
  COUNT(i.id) as ipo_count
FROM registrars r
LEFT JOIN ipos i ON i.registrar = r.id
GROUP BY r.id, r.name
ORDER BY ipo_count DESC;
-- Expected: Each registrar should have > 50 IPOs

-- Verify no duplicates
SELECT COUNT(*) as duplicate_count
FROM (
  SELECT company_name, COUNT(*) as dup_count
  FROM ipos
  GROUP BY company_name
  HAVING COUNT(*) > 1
) dups;
-- Expected: 0
```

---

## Appendix: Scraper Health Checklist

Use this checklist after each fix:

### GMP Scraper Health
- [ ] `gmp_records` table row count > 0
- [ ] Latest GMP timestamp within last 24 hours
- [ ] At least 50% of OPEN IPOs have GMP data
- [ ] No errors in `scraper_logs` for Chittorgarh source

### Subscription Scraper Health
- [ ] `subscriptions` table growing with each NSE run
- [ ] All OPEN IPOs have at least 1 subscription record
- [ ] Subscription timestamps are recent (< 1 hour old)
- [ ] No NULL values in qib/nii/retail/total fields

### BSE Scraper Health
- [ ] Success rate > 80% (failure rate < 20%)
- [ ] All SME IPOs have data from BSE
- [ ] Error messages are actionable (not generic)
- [ ] No timeouts or network errors

### Overall Data Quality
- [ ] No duplicate company names
- [ ] No invalid price ranges (min > max)
- [ ] No future dates (listing_date > TODAY)
- [ ] All critical fields populated for OPEN/CLOSED IPOs

---

## Summary

**Critical Path to Production**:
1. Fix P0 issues (GMP, Subscriptions, BSE reliability) → **48 hours**
2. Fix P1 issues (Financials, Documents, Registrars, Duplicates) → **5 days**
3. Validation and monitoring (P2/P3) → **1 week**

**Total Timeline**: ~2 weeks to production-ready state

**Success Metrics**:
- All scrapers > 90% success rate
- GMP coverage > 50%
- Subscription coverage 100% for OPEN IPOs
- Financial data coverage > 60%
- Document coverage > 40%
- 0 duplicate IPOs

---

**Report Generated**: 2025-10-18
**Next Review**: After P0 fixes completed (in 48 hours)
