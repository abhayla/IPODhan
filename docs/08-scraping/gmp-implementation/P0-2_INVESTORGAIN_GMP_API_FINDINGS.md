# Investorgain.com GMP API - Discovery & Implementation Plan

**Issue**: Alternative GMP data source after discovering Chittorgarh detail pages use client-side rendering

**Date**: 2025-10-18

---

## API Discovery

### Endpoint
```
https://webnodejs.investorgain.com/cloud/report/data-read/331/{page}/{per_page}/{year}/{year_range}/{filter}/{category}?search=&v={version}
```

### Parameters
- **report_id**: `331` (live-ipo-gmp report)
- **page**: Page number (1-indexed)
- **per_page**: Records per page (10, 50, 100)
- **year**: Current year (e.g., `2025`)
- **year_range**: Fiscal year range (e.g., `2025-26`)
- **filter**: `0` (all) or specific filter
- **category**: `ipo` (mainboard), `sme`, or `all`
- **search**: Search query (empty for all)
- **v**: Cache-busting version (e.g., `07-18`)

### Example Request
```bash
curl "https://webnodejs.investorgain.com/cloud/report/data-read/331/1/100/2025/2025-26/0/ipo?search=&v=07-18" \
  -H "User-Agent: Mozilla/5.0" \
  -H "Referer: https://www.investorgain.com/report/live-ipo-gmp/331/ipo/"
```

---

## Response Structure

### Success Response
```json
{
  "msg": 1,
  "sSearchWhere": "",
  "reportTableData": [
    {
      "~orderby1": 5990,
      "Name": "<a href=\"/gmp/midwest-ipo/1501/\" ...>Midwest IPO</a> ...",
      "GMP": "&#8377;<b>110</b> (10.33%)",
      "~gmp_percent_calc": "10.33",
      "Price": "1065",
      "IPO Size": "451.00 ",
      "Lot": "14",
      "Open": "15-Oct",
      "Close": "17-Oct",
      "BoA Dt": "20-Oct",
      "Listing": "24-Oct",
      "~Srt_Open": "2025-10-15",
      "~Srt_Close": "2025-10-17",
      "~Srt_BoA_Dt": "2025-10-20",
      "~Str_Listing": "2025-10-24",
      "Updated-On": "<small ...><b>18-Oct 7:33</b></small>",
      "Sub": "92.36x",
      "~id": 1501,
      "~ipo_name": "Midwest IPO",
      "~urlrewrite_folder_name": "/gmp/midwest-ipo/1501/",
      "~IPO_Category": "IPO",
      "~Highlight_Row": "color-antiquewhite"
    }
  ]
}
```

### Error Response
```json
{
  "msg": -1,
  "error": "Invalid API Call2025-100-01"
}
```

---

## Key Data Fields

### Essential Fields
| Field | Type | Example | Description |
|-------|------|---------|-------------|
| `~id` | number | `1501` | Investorgain internal ID |
| `~ipo_name` | string | `"Midwest IPO"` | Clean company name |
| `GMP` | HTML string | `"&#8377;<b>110</b> (10.33%)"` | HTML-encoded GMP display |
| `~gmp_percent_calc` | string | `"10.33"` | Numeric GMP percentage |
| `Price` | string | `"1065"` | IPO price in rupees |
| `Updated-On` | HTML string | `"<b>18-Oct 7:33</b>"` | Last GMP update timestamp |

### Date Fields
| Field | Type | Example | Description |
|-------|------|---------|-------------|
| `Open` | string | `"15-Oct"` | Display format (DD-MMM) |
| `Close` | string | `"17-Oct"` | Display format (DD-MMM) |
| `Listing` | string | `"24-Oct"` | Display format (DD-MMM) |
| `~Srt_Open` | string | `"2025-10-15"` | Sortable format (YYYY-MM-DD) |
| `~Srt_Close` | string | `"2025-10-17"` | Sortable format (YYYY-MM-DD) |
| `~Str_Listing` | string | `"2025-10-24"` | Sortable format (YYYY-MM-DD) |

### Additional Fields
- `IPO Size`: Issue size in crores (e.g., `"451.00 "`)
- `Lot`: Lot size (e.g., `"14"`)
- `Sub`: Subscription status (e.g., `"92.36x"`)
- `~urlrewrite_folder_name`: Investorgain URL slug
- `~IPO_Category`: `"IPO"` or `"SME"`

---

## GMP Value Parsing

### HTML-Encoded Formats
1. **Positive GMP**: `"&#8377;<b>110</b> (10.33%)"`
   - Extract: `110`
   - Percentage: `10.33`

2. **Negative GMP**: `"&#8377;<b>-3</b> (-2.22%)"`
   - Extract: `-3`
   - Percentage: `-2.22`

3. **No GMP**: `"&#8377;<b>--</b> (0.00%)"`
   - Extract: `null` or `0`
   - Percentage: `0.00`

### Parsing Strategy
```typescript
function parseGMP(gmpHTML: string): number | null {
  const match = gmpHTML.match(/<b>(-?\d+(?:\.\d+)?)</b>/);
  if (!match || match[1] === '--') return null;
  return parseFloat(match[1]);
}
```

---

## Company Name Matching Challenge

### Issue
Investorgain company names may differ from our database:
- **Investorgain**: `"Midwest IPO"`
- **Our DB**: `"Midwest Gold Limited"`

### Matching Strategy (Priority Order)

1. **Exact Slug Match** (BEST)
   - Extract investorgain slug: `/gmp/midwest-ipo/1501/` → `midwest-ipo`
   - Match to our slug: `midwest-gold-limited-ipo` ❌ (doesn't match)
   - **Problem**: Slug formats differ

2. **Date-Based Match** (RECOMMENDED)
   - Use `~Srt_Open`, `~Srt_Close`, `~Str_Listing` dates
   - Match IPOs with same dates in our database
   - Validate with price range if available
   - **Accuracy**: ~95% (dates are unique per IPO)

3. **Fuzzy Name Match** (FALLBACK)
   - Normalize names: remove "IPO", "Limited", "Ltd", extra spaces
   - Compare: `"midwest"` vs `"midwest gold"`
   - Use Levenshtein distance or substring matching
   - **Accuracy**: ~80% (may have false positives)

### Recommended Approach
**Hybrid matching**:
```typescript
async function matchIPO(investorgainData: any) {
  // 1. Try exact date match
  const dateMatch = await ipoRepository.findByDates({
    openDate: investorgainData['~Srt_Open'],
    closeDate: investorgainData['~Srt_Close'],
  });

  if (dateMatch.length === 1) {
    return dateMatch[0]; // Unique match
  }

  // 2. If multiple matches, use name similarity
  if (dateMatch.length > 1) {
    const bestMatch = findBestNameMatch(
      investorgainData['~ipo_name'],
      dateMatch
    );
    return bestMatch;
  }

  // 3. No match found - log warning
  logger.warn(
    { ipoName: investorgainData['~ipo_name'], dates: ... },
    'No matching IPO found for investorgain GMP data'
  );
  return null;
}
```

---

## Implementation Plan

### Step 1: Create Investorgain GMP Scraper
**File**: `scraper/src/scrapers/investorgain-gmp-scraper.ts`

**Features**:
- Fetch GMP data from investorgain.com API
- Parse HTML-encoded GMP values
- Match IPOs by dates (open_date, close_date)
- Handle pagination (fetch all pages)
- Support both mainboard and SME categories

**Flow**:
1. Fetch IPO list from API (page 1, per_page=100)
2. Check if more pages exist (`reportTableData.length === 100`)
3. For each IPO record:
   - Parse GMP value from HTML
   - Parse update timestamp
   - Match to database IPO by dates
   - If match found, return scraped GMP data

### Step 2: Create Investorgain Orchestrator
**File**: `scraper/src/scrapers/investorgain-orchestrator.ts`

**Features**:
- Initialize IPORepository and GMPRepository
- Call investorgain-gmp-scraper
- For each scraped GMP:
  - Call `createGMPRecord()` with ipoId, gmp, timestamp
- Track success/failure counts
- Log scraper result to `scraper_logs`

### Step 3: Update Scheduler
**File**: `scraper/src/scheduler/index.ts`

**Add cron job**:
```typescript
// Run every 6 hours during market hours
schedule.scheduleJob('0 */6 9-18 * * *', async () => {
  logger.info('Starting investorgain GMP scraper (6-hour interval)');
  await runInvestorgainGMPScraper();
});
```

---

## Expected Results

### Database Impact
After successful implementation:

```sql
-- Expected: 20-50 GMP records for OPEN/UPCOMING IPOs
SELECT COUNT(*) FROM gmp_records; -- Currently: 0

-- GMP coverage by IPO status
SELECT
  i.status,
  COUNT(DISTINCT g.ipo_id) as ipos_with_gmp,
  COUNT(*) as total_gmp_records
FROM ipos i
LEFT JOIN gmp_records g ON i.id = g.ipo_id
WHERE i.status IN ('OPEN', 'UPCOMING')
GROUP BY i.status;

-- Expected output:
-- OPEN: 10-20 IPOs with GMP (out of 37)
-- UPCOMING: 5-15 IPOs with GMP (out of 28)
```

### Scraper Logs
```sql
SELECT source, status, records_processed, duration_ms
FROM scraper_logs
WHERE source = 'INVESTORGAIN_GMP'
ORDER BY created_at DESC
LIMIT 1;

-- Expected: SUCCESS, records_processed: 20-50
```

---

## Advantages Over Chittorgarh Detail Page Scraping

| Aspect | Investorgain API | Chittorgarh Detail Pages |
|--------|------------------|--------------------------|
| **Technology** | REST API (JSON) | Client-side React (browser automation required) |
| **Speed** | ~2-5 seconds for 100 IPOs | ~2-5 minutes for 100 IPOs (Puppeteer) |
| **Reliability** | High (structured data) | Medium (DOM changes break selectors) |
| **Complexity** | Low (simple HTTP requests) | High (browser automation, wait times) |
| **Resource Usage** | Minimal (HTTP client) | High (Chromium instance) |
| **Data Freshness** | Updated every 6 hours | Same as API source |
| **Rate Limiting Risk** | Low (few requests) | Medium (many page loads) |

---

## Next Steps

1. ✅ **Completed**: API discovery and documentation
2. ⏳ **In Progress**: Implement `investorgain-gmp-scraper.ts`
3. ⏳ **Pending**: Implement `investorgain-orchestrator.ts`
4. ⏳ **Pending**: Add scheduler cron job
5. ⏳ **Pending**: Test and verify GMP records creation

---

## Alternative: Chittorgarh Integration Option

**Note**: We can still integrate Chittorgarh data by:
1. Using Chittorgarh list API for IPO metadata (company name, dates, price)
2. Using Investorgain API for GMP data
3. Merging data based on date matching

**Pros**:
- Best of both sources
- Cross-validation of IPO data

**Cons**:
- More complex orchestration
- Need to handle data conflicts

**Recommendation**: Start with Investorgain-only GMP scraper, add Chittorgarh integration later if needed.

---

**Status**: API discovered ✅, Implementation in progress ⏳
**ETA**: 2-3 hours for complete implementation and testing
