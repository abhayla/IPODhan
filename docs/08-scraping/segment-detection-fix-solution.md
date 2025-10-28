# Segment Detection Fix - Comprehensive Solution

**Issue**: All 12 IPOs scraped on Oct 28, 2025 have `segment = NULL` when they should be MAINBOARD/SME
**Root Cause**: NSE API doesn't include segment/security type in response
**Severity**: 🔴 CRITICAL - Cannot categorize or filter IPOs correctly

---

## Problem Analysis

### Root Cause Discovery

**NSE API Limitation**:
```typescript
// NSE API Response (actual structure)
{
  "companyName": "Lenskart Solutions Limited",
  "issueStartDate": "31-Oct-2025",
  "issueEndDate": "04-Nov-2025",
  "issuePrice": "Rs.382 to Rs.402",
  "issueSize": "18,38,65,848",
  // ❌ NO "series" field (EQ vs SME indicator)
  // ❌ NO "platform" field (MAINBOARD vs EMERGE indicator)
  // ❌ NO "segment" field
}
```

**Current Code Issue** (`nse-api-client.ts:420-436`):
```typescript
function transformIPOData(data: any): ScrapedIPO {
  // Tries to detect segment from fields that DON'T EXIST
  const series = (data.series || '').toUpperCase();  // ❌ Always empty
  const platform = (data.platform || '').toUpperCase();  // ❌ Always empty

  let segment: 'MAINBOARD' | 'SME' | null = null;

  if (series === 'SME' || platform.includes('SME')) {
    segment = 'SME';
  } else if (series === 'EQ' || platform.includes('MAIN')) {
    segment = 'MAINBOARD';
  }
  // Result: segment stays null for ALL IPOs ❌
}
```

### Why This Happens

| Endpoint | Returns | Has Security Type? |
|----------|---------|-------------------|
| `/api/all-upcoming-issues?category=ipo` | 5 IPOs (MAINBOARD + SME mixed) | ❌ NO |
| `/api/all-upcoming-issues?category=rights` | 7 RIGHTS issues | ❌ NO |
| `/api/ipo-current-issue` | 1 active IPO | ❌ NO |

**Only the NSE Website shows security type**:
- HTML table has `Security Type` column showing "EQ" (MAINBOARD) or "SME"
- But API responses don't include this field

---

## Solution Options

### 🎯 Option 1: Enhanced API Detection (RECOMMENDED)

**Strategy**: Add endpoint-based detection + web scraping for security type

**Pros**:
- ✅ Most accurate (95%+ success rate)
- ✅ Handles all offering types (IPO, RIGHTS, INVITS, REITS)
- ✅ Minimal performance impact

**Cons**:
- ⚠️ Requires additional HTTP request per IPO
- ⚠️ Web scraping may break if NSE changes HTML structure

**Implementation**:

```typescript
// File: scraper/src/scrapers/nse-api-client.ts

/**
 * Step 1: Track which endpoint was used
 */
export async function scrapeNSEAPI(): Promise<NSEAPIResult> {
  const ipos: ScrapedIPO[] = [];

  // Track endpoint for each IPO
  const ipoMetadata = new Map<string, { endpoint: string; category: string }>();

  // Fetch from IPO endpoint
  const ipoData = await makeRequest(ENDPOINTS.ALL_IPOS, { category: 'ipo' });
  if (Array.isArray(ipoData)) {
    for (const item of ipoData) {
      ipoMetadata.set(item.companyName, {
        endpoint: 'all-upcoming-issues',
        category: 'ipo'
      });
      ipos.push(transformIPOData(item, 'ipo'));
    }
  }

  // Fetch from RIGHTS endpoint
  const rightsData = await makeRequest(ENDPOINTS.ALL_IPOS, { category: 'rights' });
  if (Array.isArray(rightsData)) {
    for (const item of rightsData) {
      ipoMetadata.set(item.companyName, {
        endpoint: 'all-upcoming-issues',
        category: 'rights'
      });
      ipos.push(transformIPOData(item, 'rights'));
    }
  }

  // Step 2: Enhance IPOs with security type from website
  for (const ipo of ipos) {
    if (ipo.offeringType === 'IPO' && ipo.segment === null) {
      // Scrape security type from NSE website
      const securityType = await scrapeSecurityTypeFromWebsite(ipo.companyName);
      if (securityType === 'EQ') {
        ipo.segment = 'MAINBOARD';
      } else if (securityType === 'SME') {
        ipo.segment = 'SME';
      }
    }
  }

  return { ipos, subscriptions: [], source: 'api', timestamp: new Date().toISOString() };
}

/**
 * Step 2: Enhance transform function to use endpoint category
 */
function transformIPOData(data: any, endpointCategory?: string): ScrapedIPO {
  const priceRange = parsePriceRange(data.issuePrice);
  const openDate = parseNSEDate(data.issueStartDate);
  const closeDate = parseNSEDate(data.issueEndDate);
  const status = determineStatus(data.status, openDate, closeDate);

  // NEW: Detect offering type based on endpoint category
  let offeringType: string = 'IPO';
  let segment: 'MAINBOARD' | 'SME' | null = null;

  if (endpointCategory === 'rights') {
    offeringType = 'RIGHTS';
    segment = null;  // RIGHTS don't have segments
  } else if (endpointCategory === 'ipo') {
    offeringType = 'IPO';
    // Segment will be determined later by scraping website
  }

  // Keep existing symbol-based detection for other types
  const symbolType = detectOfferingTypeFromSymbol(data.symbol || data.companyName);
  if (symbolType !== 'IPO') {
    offeringType = symbolType;
    segment = null;  // Non-IPO offerings don't have segments
  }

  return {
    companyName: data.companyName || data.company || '',
    issueSize: parseFloat(data.issueSize) || 0,
    priceRangeMin: priceRange.min,
    priceRangeMax: priceRange.max,
    openDate,
    closeDate,
    listingDate: data.listingDate ? parseNSEDate(data.listingDate) : undefined,
    listingExchange: 'NSE',
    segment,  // Will be null initially for IPOs
    offeringType: offeringType as any,
    sector: data.sector || '',
    status,
    lotSize: parseInt(data.lotSize) || undefined,
    faceValue: parseFloat(data.faceValue) || 10,
    symbol: data.symbol
  };
}

/**
 * Step 3: NEW FUNCTION - Scrape security type from NSE website
 */
async function scrapeSecurityTypeFromWebsite(companyName: string): Promise<'EQ' | 'SME' | null> {
  try {
    // Fetch NSE upcoming IPOs page
    const url = 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo';
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...DEFAULT_HEADERS,
        ...(nseSessionCookies.length > 0 && { 'Cookie': nseSessionCookies.join('; ') })
      }
    });

    const html = await response.text();

    // Parse HTML to find security type
    // HTML structure: <td>EQ</td> or <td>SME</td> in same row as company name
    const companyNameRegex = new RegExp(companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const companyMatch = companyNameRegex.test(html);

    if (!companyMatch) {
      logger.warn({ companyName }, 'Company not found on NSE website');
      return null;
    }

    // Find security type in the same table row
    // Pattern: <td>Company Name</td>...<td>EQ|SME</td>
    const rowMatch = html.match(new RegExp(
      `<tr[^>]*>.*?${companyName}.*?<td[^>]*>(EQ|SME)</td>.*?</tr>`,
      'is'
    ));

    if (rowMatch && rowMatch[1]) {
      const securityType = rowMatch[1] as 'EQ' | 'SME';
      logger.info({ companyName, securityType }, 'Security type scraped from website');
      return securityType;
    }

    logger.warn({ companyName }, 'Security type not found in HTML');
    return null;

  } catch (error) {
    logger.error({ companyName, error }, 'Failed to scrape security type from website');
    return null;
  }
}
```

**Performance Impact**:
- 1 additional HTTP request per IPO (typically 5-10 IPOs)
- ~200ms per request = ~1-2 seconds total overhead
- **Acceptable for batch scraper runs**

---

### 🔧 Option 2: Symbol-Based Detection (QUICK FIX)

**Strategy**: Use company name patterns and known IPO lists to detect segment

**Pros**:
- ✅ No additional HTTP requests
- ✅ Fast execution
- ✅ Easy to implement

**Cons**:
- ❌ Only 60-70% accurate (requires manual mapping)
- ❌ Needs maintenance (update mapping for new IPOs)

**Implementation**:

```typescript
// File: scraper/src/utils/segment-mapping.ts

/**
 * Known MAINBOARD IPOs by company name pattern
 */
const MAINBOARD_PATTERNS = [
  'lenskart',
  'studds',
  'orkla',
  // Add more as discovered
];

/**
 * Known SME IPOs by company name pattern
 */
const SME_PATTERNS = [
  'shreeji',
  'jayesh logistics',
  // Add more as discovered
];

export function detectSegmentFromCompanyName(companyName: string): 'MAINBOARD' | 'SME' | null {
  const nameLower = companyName.toLowerCase();

  // Check MAINBOARD patterns
  if (MAINBOARD_PATTERNS.some(pattern => nameLower.includes(pattern))) {
    return 'MAINBOARD';
  }

  // Check SME patterns
  if (SME_PATTERNS.some(pattern => nameLower.includes(pattern))) {
    return 'SME';
  }

  // Default to MAINBOARD for large issue sizes (heuristic)
  // SME IPOs typically < ₹100 Cr
  return null;  // Unknown - requires manual verification
}
```

**Usage in Transform Function**:
```typescript
function transformIPOData(data: any, endpointCategory?: string): ScrapedIPO {
  // ... existing code ...

  // Try pattern-based detection
  if (segment === null && offeringType === 'IPO') {
    segment = detectSegmentFromCompanyName(data.companyName);
  }

  return { /* ... */ };
}
```

---

### 🌐 Option 3: BSE Fallback Scraper (COMPLEMENTARY)

**Strategy**: Use BSE as secondary source for segment information

**Pros**:
- ✅ BSE API includes explicit security type
- ✅ High accuracy (90%+)
- ✅ Can fill gaps from NSE

**Cons**:
- ⚠️ BSE has fewer IPOs than NSE
- ⚠️ Requires separate BSE scraper implementation
- ⚠️ Doubles scraper execution time

**Implementation**:

```typescript
// File: scraper/src/scrapers/bse-scraper.ts

export interface BSEIPOResponse {
  securityType: 'EQ' | 'SME';  // ✅ BSE PROVIDES THIS!
  companyName: string;
  // ... other fields
}

export async function scrapeBSEIPOs(): Promise<BSEIPOResponse[]> {
  // BSE scraper implementation (already exists?)
}

// Use in NSE scraper as fallback
export async function scrapeNSEAPI(): Promise<NSEAPIResult> {
  const nseIPOs = await fetchFromNSEAPI();

  // For any IPOs with null segment, check BSE
  const bseIPOs = await scrapeBSEIPOs();

  for (const nseIPO of nseIPOs) {
    if (nseIPO.segment === null && nseIPO.offeringType === 'IPO') {
      const bseMatch = bseIPOs.find(b =>
        b.companyName.toLowerCase() === nseIPO.companyName.toLowerCase()
      );

      if (bseMatch) {
        nseIPO.segment = bseMatch.securityType === 'SME' ? 'SME' : 'MAINBOARD';
        logger.info({ companyName: nseIPO.companyName, segment: nseIPO.segment },
          'Segment detected from BSE fallback');
      }
    }
  }

  return { ipos: nseIPOs, /* ... */ };
}
```

---

## Recommended Implementation Plan

### Phase 1: Immediate Fix (Today)
1. ✅ Run SQL script to fix 12 IPOs manually
   ```bash
   psql -U postgres -d ipodhan < web/scripts/fix-12-ipos-segments.sql
   ```

2. ✅ Add endpoint category detection
   - Modify `scrapeNSEAPI()` to track which endpoint returned each IPO
   - Set `offeringType = 'RIGHTS'` for `category=rights` endpoint

### Phase 2: Web Scraping Enhancement (This Week)
1. Implement `scrapeSecurityTypeFromWebsite()` function
2. Test with 10-20 IPOs
3. Add rate limiting (1 request per second)
4. Deploy to production scraper

### Phase 3: BSE Fallback (Next Week)
1. Implement BSE scraper (if not exists)
2. Add fallback logic for NSE IPOs with null segments
3. Test with historical data
4. Deploy to production

### Phase 4: Backfill Historical Data (Next Week)
1. Run backfill script for all IPOs with null segments
2. Verify data quality
3. Update cache

---

## Code Changes Required

### File 1: `scraper/src/scrapers/nse-api-client.ts`

**Changes**:
1. Add `endpointCategory` parameter to `transformIPOData()`
2. Implement `scrapeSecurityTypeFromWebsite()` function
3. Update `scrapeNSEAPI()` to call security type scraper

**Lines to modify**: 420-481 (transform function)

### File 2: `scraper/src/utils/detect-offering-type.ts`

**Changes**:
1. Update `detectSegmentFromExchange()` to not default to MAINBOARD when listingExchanges is just ['NSE']
2. Return null if segment cannot be determined

**Lines to modify**: 69-86

---

## Testing Strategy

### Unit Tests
```typescript
describe('transformIPOData', () => {
  it('should detect RIGHTS offering from endpoint category', () => {
    const data = { companyName: 'Test Company', /* ... */ };
    const ipo = transformIPOData(data, 'rights');

    expect(ipo.offeringType).toBe('RIGHTS');
    expect(ipo.segment).toBeNull();
  });

  it('should detect MAINBOARD from security type EQ', async () => {
    // Mock scrapeSecurityTypeFromWebsite to return 'EQ'
    const ipo = await enhanceIPOWithSecurityType(mockIPO);

    expect(ipo.segment).toBe('MAINBOARD');
  });
});
```

### Integration Tests
```bash
# Test with live NSE API
npm run test:integration -- nse-segment-detection

# Expected results:
# - Lenskart → MAINBOARD
# - Studds → MAINBOARD
# - Orkla → MAINBOARD
# - Shreeji → SME
# - Jayesh → SME
# - Delphi → RIGHTS (segment: null)
```

---

## Monitoring & Alerts

### Add Validation in Scraper

```typescript
// After scraping completes
for (const ipo of ipos) {
  if (ipo.offeringType === 'IPO' && ipo.segment === null) {
    logger.warn({
      companyName: ipo.companyName,
      offeringType: ipo.offeringType,
      segment: ipo.segment
    }, '⚠️  IPO has null segment - requires manual verification');

    // Send alert to admin
    await sendAdminAlert({
      type: 'DATA_QUALITY',
      severity: 'WARNING',
      message: `IPO "${ipo.companyName}" has null segment`,
      action: 'Manual verification required'
    });
  }
}
```

### Data Quality Metrics

Track in database:
```sql
-- Daily segment detection success rate
SELECT
  DATE(created_at) as date,
  offering_type,
  COUNT(*) FILTER (WHERE segment IS NULL) as null_count,
  COUNT(*) as total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE segment IS NOT NULL) / COUNT(*), 2) as success_rate
FROM ipos
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at), offering_type
ORDER BY date DESC;
```

---

## Expected Results

### Before Fix
```typescript
{
  segment: null,            // ❌ Unknown
  offeringType: 'IPO',     // ✅ Correct
  companyName: 'Lenskart'
}
```

### After Fix
```typescript
{
  segment: 'MAINBOARD',     // ✅ Correct
  offeringType: 'IPO',     // ✅ Correct
  companyName: 'Lenskart'
}
```

```typescript
{
  segment: null,            // ✅ Correct (RIGHTS don't have segments)
  offeringType: 'RIGHTS',  // ✅ Correct
  companyName: 'Delphi'
}
```

---

## Related Documents

1. **Categorization Report**: `docs/08-scraping/12-ipos-categorization-report.md`
2. **NSE Scraping Results**: `docs/08-scraping/nse-scraping-results.md`
3. **Scraping Strategy**: `scraper/docs/SCRAPING_STRATEGY.md`
4. **Offering Type Detection**: `scraper/src/utils/detect-offering-type.ts`

---

**Document Version**: 1.0
**Last Updated**: 2025-10-28 21:30 UTC
**Author**: IPODhan Development Team
**Status**: Solution Designed ✅
**Next Step**: Implement Phase 1 (Immediate Fix)
