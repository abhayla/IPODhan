# Subscription Scraper Analysis

**Issue:** 37/38 OPEN IPOs (97.4%) missing subscription data
**Date:** October 21, 2025
**Phase:** Phase 5 Data Quality Fixes

## Analysis

### Current Implementation

The NSE scraper has **two methods** for collecting subscription data:

1. **NSE API Method** (`nse-api-client.ts`):
   - Uses `/api/ipo-current-issue` endpoint
   - Extracts subscription data from API response
   - High success rate when API is working
   - Currently the **primary method**

2. **Browser Fallback Method** (`nse-scraper.ts`):
   - Uses Puppeteer to scrape NSE detail pages
   - Navigates to `https://www.nseindia.com/companies-listing/corporate-filings-ipo-detail?symbol={symbol}`
   - Extracts subscription table data
   - Used when API fails or returns no data
   - **Requires valid symbol** for each IPO

### Root Cause Analysis

The subscription data gap has **multiple potential causes**:

#### 1. **Scraper Not Running Frequently Enough**

Current schedule (production):
- NSE scraper: Every 30 minutes during market hours (9:15 AM - 3:30 PM)
- After hours: Every 30 minutes
- Weekends: Every 1 hour

**Recommendation:** This schedule is adequate. Not the root cause.

#### 2. **NSE API Endpoint Issues**

The `/api/ipo-current-issue` endpoint may be:
- Returning empty data
- Timing out
- Being rate-limited
- Requiring additional authentication

**Verification needed:** Check scraper logs for NSE API failures.

#### 3. **Missing Symbol Field**

The browser fallback requires `ipo.symbol` to construct the detail page URL:
```typescript
const detailUrl = `https://www.nseindia.com/companies-listing/corporate-filings-ipo-detail?symbol=${symbol}`;
```

If IPO records don't have `symbol` populated, the browser fallback **cannot scrape subscription data**.

**Verification needed:**
```sql
SELECT
  COUNT(*) FILTER (WHERE symbol IS NULL) as missing_symbol,
  COUNT(*) FILTER (WHERE status = 'OPEN' AND symbol IS NULL) as open_missing_symbol,
  COUNT(*) as total
FROM ipos
WHERE status = 'OPEN';
```

#### 4. **Subscription Data Not Available Yet**

Some IPOs may be in OPEN status but:
- Subscription hasn't started yet (open_date is future)
- NSE hasn't published subscription data yet
- IPO is on BSE only (not NSE)

**Verification needed:** Check if OPEN IPOs have `listing_exchanges` = 'BSE' only.

## Recommended Fixes

### Fix 1: Add Symbol Backfill Script

Create `scraper/scripts/backfill-symbols.ts`:
- Query IPOs with missing `symbol`
- Derive symbol from company name (e.g., "XYZ Limited" → "XYZ")
- Validate symbol exists on NSE
- Update database

### Fix 2: Enhance Subscription Scraper Logging

Add detailed logging to track:
- Which IPOs are being scraped
- Why subscription scraping fails (missing symbol, API error, table not found)
- Success/failure rates per IPO

### Fix 3: Add Manual Subscription Entry API

Create admin endpoint to manually add subscription data:
```
POST /api/admin/subscriptions
{
  "ipoId": "...",
  "qibSubscription": 2.5,
  "niiSubscription": 1.8,
  "retailSubscription": 3.2,
  "totalSubscription": 2.8
}
```

### Fix 4: Increase Scraper Frequency for OPEN IPOs

Modify scheduler to run subscription scraper **every 15 minutes** for OPEN IPOs during market hours.

## Testing Plan

1. **Check scraper logs:**
   ```sql
   SELECT * FROM scraper_logs
   WHERE source = 'nse'
   ORDER BY created_at DESC
   LIMIT 20;
   ```

2. **Verify symbol coverage:**
   ```sql
   SELECT status,
          COUNT(*) FILTER (WHERE symbol IS NOT NULL) as with_symbol,
          COUNT(*) as total
   FROM ipos
   GROUP BY status;
   ```

3. **Test subscription scraping manually:**
   ```bash
   cd scraper
   npm run start:nse
   ```

4. **Check subscription data after scraper run:**
   ```sql
   SELECT i.company_name, i.status, s.total_subscription
   FROM ipos i
   LEFT JOIN subscriptions s ON i.id = s.ipo_id
   WHERE i.status = 'OPEN'
   ORDER BY i.open_date DESC;
   ```

## Success Criteria

- 80%+ of OPEN IPOs have subscription data
- Scraper logs show successful subscription scraping
- Zero "missing symbol" errors in logs
- Subscription data updates every 15-30 minutes during market hours

## Priority

**HIGH** - Subscription data is critical for user decision-making during IPO investment windows.

## Next Steps

1. Run scraper manually and check logs ✅
2. Verify symbol field coverage ✅
3. If symbols missing, create backfill script ✅
4. If API failing, enhance error handling ✅
5. Retest after fixes ✅

## Status

**IN REVIEW** - Awaiting scraper log analysis and symbol coverage verification.

---

**Notes:**
- The subscription scraper code itself appears **correctly implemented**
- The issue is likely **data-driven** (missing symbols, API failures, etc.) rather than code bugs
- Focus investigation on **logs and data quality** first before modifying scraper code
