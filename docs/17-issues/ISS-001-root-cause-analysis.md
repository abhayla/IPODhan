# ISS-001: Missing Listing Performance Data - Root Cause Analysis

## Issue Summary

**Problem:** Only 77 out of 388 LISTED IPOs (19.85%) have listing performance data in the database.

**Impact:**
- 311 IPOs (80.15%) missing from `listing_performance` table
- IPO detail pages show "Performance data not available" for 80% of listed IPOs
- Performance tracker missing most IPO data
- Historical performance trends incomplete
- Current price tracking unavailable for 311 listed IPOs

**Priority:** HIGH - Affects core user-facing features

## Root Cause Analysis

### Investigation Findings

1. **Existing Backfill Script (Story 11.4)**
   - Location: `scraper/src/scripts/backfill-historical-ipos.ts`
   - Purpose: One-time backfill of historical listing performance from NSE past IPOs API
   - Status: ✅ Working correctly
   - Coverage: Successfully created 77 listing_performance records for IPOs with matching NSE historical data

2. **Gap Identified: No Ongoing Price Updates**
   - **Primary Issue:** The backfill script is a one-time operation, NOT a recurring scraper
   - The script runs manually via `npm run backfill` and does not update current prices
   - No scheduler job exists to keep current prices up-to-date
   - Listing_performance records become stale without price updates

3. **Data Source Analysis**
   - NSE `/api/public-past-issues` endpoint: Provides historical listing prices but NOT current prices
   - Match rate: ~20% (77/388) - only IPOs with exact symbol matches got listing_performance records
   - 311 IPOs unmatched due to:
     - Missing NSE symbols (some IPOs only have BSE data)
     - Symbol changes after listing
     - Company name mismatches (fuzzy matching has 70% threshold)
     - IPOs listed only on BSE SME platform (not in NSE historical data)

4. **Architecture Gap**
   - ✅ Repository layer exists: `ListingPerformanceRepository` with upsert support
   - ✅ Database schema supports current prices: `current_price_bse`, `current_price_nse` fields
   - ❌ No scraper exists to fetch current prices from exchanges
   - ❌ No scheduler job to periodically update prices
   - ❌ No fallback mechanism for BSE-only IPOs

## Solution Design

### 1. Create Listing Performance Updater Scraper

**Purpose:** Fetch and update current prices for ALL LISTED IPOs (not just matched ones)

**Key Features:**
- Processes all 388 LISTED IPOs from database (not just 77 matched)
- Fetches current prices from:
  - NSE API: `/api/quote-equity?symbol={SYMBOL}`
  - BSE API: Stock quote endpoint with scrip code
- Uses NSE historical data for initial listing price (if missing)
- Calculates current gain percentage dynamically
- Upserts to `listing_performance` table (creates new records for 311 missing IPOs)
- Implements rate limiting (100ms delay between requests)

**Data Flow:**
```
Database (LISTED IPOs)
  ↓
Fetch current prices (NSE/BSE APIs)
  ↓
Fetch historical data (NSE past issues API) - for initial listing prices
  ↓
Calculate gains (listing gain %, current gain %)
  ↓
Upsert to listing_performance table
  ↓
Invalidate cache
```

### 2. Add Scheduler Job

**Schedule:**
- Market Hours (9 AM - 5 PM Mon-Fri): Every 30 minutes
- After Hours (5 PM - 9 AM Mon-Fri): Every 2 hours
- Weekends: Every 4 hours

**Rationale:**
- Frequent updates during trading hours for real-time prices
- Reduced API calls during off-hours to minimize load
- Complete coverage of all 388 LISTED IPOs

### 3. Implementation Details

**Files Created:**
1. `scraper/src/scrapers/listing-performance-updater.ts` - Main updater scraper
2. `scraper/src/scheduler/jobs/listing-performance-update.ts` - Scheduler job wrapper

**Files Modified:**
1. `scraper/src/scheduler/config.ts` - Added `listingPerformanceUpdate` job config
2. `scraper/src/scheduler/scheduler.ts` - Registered new scheduler job
3. `scraper/package.json` - Added `update:listing-performance` script

**Database Changes:** None required (schema already supports all fields)

**API Endpoints Used:**
- NSE Quote API: `https://www.nseindia.com/api/quote-equity?symbol={SYMBOL}`
- BSE Quote API: `https://api.bseindia.com/BseIndiaAPI/api/StockReachGraph/w?scripcode={CODE}`
- NSE Past Issues: `https://www.nseindia.com/api/public-past-issues` (for initial listing prices)

## Testing Strategy

### Manual Testing
```bash
# Test updater manually
cd scraper
npm run update:listing-performance
```

### Expected Results
- Total LISTED IPOs: 388
- New Records Created: ~311 (missing records)
- Records Updated: ~77 (existing records with new prices)
- Coverage: 100% (388/388)

### Validation Queries
```sql
-- Check coverage improvement
SELECT
  (SELECT COUNT(*) FROM ipos WHERE status='LISTED') as total_listed,
  (SELECT COUNT(*) FROM listing_performance) as total_with_performance,
  ROUND(
    (SELECT COUNT(*) FROM listing_performance)::numeric /
    (SELECT COUNT(*) FROM ipos WHERE status='LISTED')::numeric * 100,
    2
  ) as coverage_percent;

-- Verify current prices populated
SELECT COUNT(*)
FROM listing_performance
WHERE current_price_nse IS NOT NULL OR current_price_bse IS NOT NULL;

-- Check recent updates
SELECT symbol, company_name, current_price_nse, current_price_bse, updated_at
FROM listing_performance
ORDER BY updated_at DESC
LIMIT 10;
```

## Deployment Plan

### Phase 1: Manual Backfill (Immediate)
1. Run updater manually to create 311 missing records
2. Verify database coverage reaches 100%
3. Monitor logs for errors

### Phase 2: Enable Scheduler (Next Deployment)
1. Deploy updated scheduler configuration
2. Enable `listingPerformanceUpdate` job in production
3. Monitor job execution and API rate limits
4. Track data freshness metrics

### Phase 3: Monitoring (Ongoing)
1. Alert if failure rate > 10%
2. Track API response times
3. Monitor database update frequency
4. Validate price data accuracy

## Lessons Learned

1. **One-time vs Recurring Operations:**
   - Backfill scripts are NOT substitutes for ongoing data updates
   - Always design for continuous data freshness

2. **Data Source Coverage:**
   - NSE historical data only covers ~20% of IPOs
   - Need multi-source strategy (NSE + BSE + fallbacks)
   - Symbol matching has inherent limitations

3. **Scheduler Design:**
   - Time-based scheduling needed for market data
   - Different frequencies for market hours vs off-hours
   - Rate limiting crucial for exchange APIs

4. **Testing Gap:**
   - Need automated tests for data coverage metrics
   - Integration tests should validate all 388 IPOs processed
   - Monitor coverage trends over time

## Metrics & Success Criteria

**Before Fix:**
- Coverage: 77/388 (19.85%)
- Missing Records: 311 (80.15%)
- Current Price Availability: 0% (all records stale)

**After Fix (Target):**
- Coverage: 388/388 (100%)
- Missing Records: 0 (0%)
- Current Price Availability: >95% (real-time updates)
- Update Frequency: Every 30 min during market hours

**Success Metrics:**
- ✅ All LISTED IPOs have listing_performance records
- ✅ Current prices updated within 30 minutes during market hours
- ✅ Failure rate < 10%
- ✅ No user-visible "Performance data not available" messages

## Related Documentation

- Database Schema: `packages/shared/src/db/schema.ts` (lines 400-427)
- NSE API Client: `scraper/src/scrapers/nse-api-client.ts`
- Backfill Script: `scraper/src/scripts/backfill-historical-ipos.ts`
- Repository Pattern: `packages/shared/src/repositories/listing-performance-repository.ts`

## Timeline

- **Issue Discovered:** 2025-10-20
- **Root Cause Identified:** 2025-10-20
- **Solution Implemented:** 2025-10-20
- **Manual Testing:** 2025-10-20
- **Scheduler Enabled:** Pending deployment
- **Full Resolution:** Pending 24-hour validation

## Author

Claude Code (Anthropic AI Assistant)
Issue: ISS-001
Date: 2025-10-20
