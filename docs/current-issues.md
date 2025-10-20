# Current Issues - IPODhan

**Last Updated**: 2025-10-20
**Database**: `103.118.16.189:5432/ipodhan`
**Status**: 3 Open Data Pipeline Issues

---

## 🔴 OPEN ISSUES

### ISS-001: Missing Listing Performance Data ✅ RESOLVED

**Severity**: MAJOR
**Discovered**: 2025-10-19 (Phase 1, Step 3)
**Resolved**: 2025-10-20
**Status**: ✅ RESOLVED
**Type**: Data Pipeline Issue

**Description**:
Only 19.85% (77/388) of LISTED IPOs had listing performance data. 311 IPOs (80.15%) were missing from the `listing_performance` table despite having `status='LISTED'` in the `ipos` table.

**Impact (Before Fix)**:
- IPO detail pages showed "Performance data not available" for 80% of listed IPOs
- Performance tracker missing most IPO data
- Historical performance trends incomplete
- Investors could not see listing gains/losses for most IPOs
- Current price tracking unavailable for 311 listed IPOs

**Root Cause Identified**:
- Backfill script (`backfill-historical-ipos.ts`) was one-time operation, NOT recurring
- NSE historical data only matched ~20% of IPOs (symbol-based matching)
- No ongoing scraper to fetch current prices from NSE/BSE
- No scheduler job to keep prices updated

**Solution Implemented**:
1. ✅ Created `listing-performance-updater.ts` scraper
   - Processes ALL 388 LISTED IPOs (not just matched ones)
   - Fetches current prices from NSE & BSE APIs
   - Uses NSE historical data for initial listing prices
   - Calculates current gain percentages dynamically
   - Upserts to listing_performance (creates 311 missing records)

2. ✅ Added scheduler job for periodic updates
   - Market hours (9 AM-5 PM Mon-Fri): Every 30 minutes
   - After hours: Every 2 hours
   - Weekends: Every 4 hours

3. ✅ Updated scheduler configuration
   - Modified `scraper/src/scheduler/config.ts`
   - Modified `scraper/src/scheduler/scheduler.ts`
   - Added `update:listing-performance` npm script

**Files Created**:
- `scraper/src/scrapers/listing-performance-updater.ts`
- `scraper/src/scheduler/jobs/listing-performance-update.ts`
- `docs/17-issues/ISS-001-root-cause-analysis.md`

**Files Modified**:
- `scraper/src/scheduler/config.ts`
- `scraper/src/scheduler/scheduler.ts`
- `scraper/package.json`

**Testing**:
```bash
# Manual test
cd scraper
npm run update:listing-performance
```

**Expected Results (After Fix)**:
- Coverage: 388/388 (100%)
- Current prices updated every 30 min during market hours
- All LISTED IPOs have listing_performance records

**Deployment**:
- Scraper ready for manual execution
- Scheduler job pending production deployment

**Priority**: ✅ RESOLVED

**Documentation**: See `docs/17-issues/ISS-001-root-cause-analysis.md` for complete analysis

---

### ISS-002: Missing GMP Data for OPEN IPOs

**Severity**: MAJOR
**Discovered**: 2025-10-19 (Phase 1, Step 3)
**Status**: 🔴 OPEN
**Type**: Data Pipeline Issue

**Description**:
0% (0/38) of OPEN IPOs have Grey Market Premium (GMP) data. The `gmp_tracking`, `gmp_records`, and `gmp_history` tables are completely empty, despite 38 IPOs being in OPEN status.

**Impact**:
- GMP feature completely non-functional for current IPOs
- Investors cannot see grey market premium (critical investment indicator)
- GMP charts/trends cannot be displayed
- GMP-based recommendations unavailable

**Expected Behavior**:
- 90%+ of OPEN IPOs should have GMP data
- `ipos.gmp` field populated for OPEN IPOs
- `gmp_tracking` table has recent entries (< 24 hours old)
- `gmp_history` table has time-series GMP data
- GMP updated at least once daily

**Actual Behavior**:
- 0/38 (0%) OPEN IPOs have GMP data
- `ipos.gmp` field is NULL for all OPEN IPOs
- `gmp_tracking` table: 0 records (completely empty)
- `gmp_records` table: 0 records (completely empty)
- `gmp_history` table: 0 records (completely empty)
- `ipos.gmp_updated_at` is NULL for all IPOs

**Root Cause**:
- GMP scraper not running, OR
- GMP scraper configured but failing silently, OR
- GMP data sources (InvestorGain, IPOWatch, Chittorgarh) inaccessible

**Related Tables**:
- `gmp_tracking` (0 records - should have real-time GMP data)
- `gmp_records` (0 records - should have historical GMP records)
- `gmp_history` (0 records - should have time-series data)
- `ipos.gmp` field (NULL for all 38 OPEN IPOs)

**Pipeline Status**:
From scraper health check:
- `INVESTORGAIN (GMP_DATA)`: Last success Oct 1, 2025 (19+ days ago)
- `IPOWATCH (GMP_DATA)`: Last success Oct 1, 2025 (19+ days ago)
- `CHITTORGARH (GMP_DATA)`: Last success Oct 1, 2025 (19+ days ago)

All GMP pipelines are stale (>48 hours).

**SQL Verification**:
```sql
-- Check OPEN IPOs without GMP
SELECT
  company_name,
  status,
  open_date,
  close_date,
  gmp,
  gmp_updated_at
FROM ipos
WHERE status = 'OPEN';
-- All 38 rows have gmp = NULL

-- Check gmp_tracking table
SELECT COUNT(*) FROM gmp_tracking;
-- Result: 0

-- Check last GMP scraper execution
SELECT source, status, last_success_at
FROM pipeline_status
WHERE pipeline_type = 'GMP_DATA';
-- All show last_success_at = Oct 1, 2025 (stale)
```

**Recommended Actions**:
1. **Immediate**: Test GMP feature UI handles missing data gracefully
2. **Immediate**: Verify GMP scraper exists and configuration
3. **Short-term**: Run GMP scraper manually: `npm run scrape:gmp` (if exists)
4. **Short-term**: Check GMP data source APIs are accessible
5. **Long-term**: Set up hourly GMP scraper job for OPEN IPOs
6. **Long-term**: Add alerts for GMP data staleness >24 hours

**Priority**: 🔴 HIGH (GMP is a critical feature for IPO investors)

---

### ISS-003: Multiple Empty Supporting Tables

**Severity**: MAJOR
**Discovered**: 2025-10-19 (Phase 1, Step 3)
**Status**: 🔴 OPEN
**Type**: Data Pipeline Issue

**Description**:
Multiple supporting tables are completely empty (0 records) despite IPO data being present. These tables are critical for enhanced IPO information and investment decisions.

**Empty Tables Identified** (0 records each):
1. **`documents`** - IPO prospectus, RHP, DRHP files (0/495 IPOs have documents)
2. **`ipo_reviews`** - Expert IPO reviews and ratings (0 reviews)
3. **`peer_companies`** - Peer comparison data (0 peer mappings)
4. **`ipo_scores`** - AI-generated IPO scores (0/495 IPOs scored)
5. **`market_holidays`** - NSE/BSE holiday calendar (0 holidays)
6. **`gmp_tracking`** - Real-time GMP tracking (see ISS-002)
7. **`gmp_records`** - Historical GMP records (see ISS-002)
8. **`gmp_history`** - GMP time-series data (see ISS-002)

**Impact**:
- **Documents**: No prospectus links available on IPO detail pages
- **Reviews**: Expert review section completely empty
- **Peer Companies**: Cannot compare IPOs with industry peers
- **IPO Scores**: AI-powered scoring system non-functional
- **Market Holidays**: Cannot display trading holidays or adjust IPO dates
- **GMP**: See ISS-002 for detailed GMP impact

**Expected Behavior**:
- `documents`: 50%+ of IPOs should have at least 1 document link
- `ipo_reviews`: 10%+ of IPOs should have expert reviews
- `peer_companies`: 30%+ of IPOs should have peer mappings
- `ipo_scores`: 100% of IPOs should have AI-generated scores
- `market_holidays`: Calendar populated for current/next year

**Actual Behavior**:
All tables completely empty (0 records)

**Root Causes** (by table):
1. **documents**: Scraper not implemented OR document URLs not being collected
2. **ipo_reviews**: Manual entry required OR review scraper not running
3. **peer_companies**: Manual configuration OR automated peer detection not implemented
4. **ipo_scores**: AI scoring pipeline not set up OR not executed
5. **market_holidays**: Static data not seeded OR scraper not running
6. **GMP tables**: See ISS-002

**SQL Verification**:
```sql
-- Check all empty tables
SELECT
  'documents' as table_name, COUNT(*) as record_count FROM documents
UNION ALL SELECT 'ipo_reviews', COUNT(*) FROM ipo_reviews
UNION ALL SELECT 'peer_companies', COUNT(*) FROM peer_companies
UNION ALL SELECT 'ipo_scores', COUNT(*) FROM ipo_scores
UNION ALL SELECT 'market_holidays', COUNT(*) FROM market_holidays
UNION ALL SELECT 'gmp_tracking', COUNT(*) FROM gmp_tracking
UNION ALL SELECT 'gmp_records', COUNT(*) FROM gmp_records
UNION ALL SELECT 'gmp_history', COUNT(*) FROM gmp_history;
-- All return 0
```

**Recommended Actions by Table**:

**documents**:
1. Verify document scraper exists in `scraper/src/scrapers/`
2. Test NSE/BSE document URL collection
3. Run document scraper manually
4. Set up daily scraper job

**ipo_reviews**:
1. Determine if manual entry or scraper-based
2. Create seed data for top 20 IPOs
3. Set up review collection pipeline

**peer_companies**:
1. Create peer mapping logic (by sector/market cap)
2. Populate initial peer data for major IPOs
3. Automate peer detection

**ipo_scores**:
1. Verify AI scoring pipeline exists
2. Run scoring job for all IPOs
3. Set up daily re-scoring

**market_holidays**:
1. Seed NSE/BSE holiday calendar
2. Create scraper for official holiday announcements
3. Update calendar annually

**Priority**: 🟠 MEDIUM-HIGH (affects multiple features)

---

### ISS-026: Category Hub Pages - Status Filter Doesn't Initialize from URL Parameters

**Severity**: MINOR
**Discovered**: 2025-10-20 (During ISS-015 Fix Implementation)
**Status**: 🟡 OPEN
**Type**: Frontend Issue

**Description**:
The status filter on both Mainboard and SME IPOs hub pages doesn't read the initial status from URL parameters on page load. When users share or bookmark a URL like `/mainboard-ipos?status=OPEN`, the page loads but shows "All" status instead of the filtered view.

**Impact**:
- Shared URLs don't maintain status filter state
- Bookmarked filtered views don't work as expected
- Browser back/forward navigation loses filter context
- Poor user experience when sharing specific filtered views
- SEO impact - search engines may index wrong filtered states

**Expected Behavior**:
1. Navigate to `/mainboard-ipos?status=OPEN`
2. Page should initialize with status filter set to "OPEN"
3. Table should show only OPEN IPOs
4. "OPEN" button should be highlighted
5. Record count should reflect filtered data

**Actual Behavior**:
1. Navigate to `/mainboard-ipos?status=OPEN`
2. Page initializes with status filter set to "ALL" (default)
3. Table shows all IPOs regardless of URL parameter
4. "All" button is highlighted
5. Record count shows total IPOs

**Root Cause**:
Status filter state is initialized with hardcoded default value:
```typescript
const [statusFilter, setStatusFilter] = useState<string>('ALL');
```

It never reads from `searchParams` on mount, only updates URL when filter changes.

**Affected Files**:
- `web/app/mainboard-ipos/MainboardDetailedTableClient.tsx` (line 141)
- `web/app/sme-ipos/SMEDetailedTableClient.tsx` (line 142)

**Recommended Fix**:
Initialize status filter from URL parameters with fallback to 'ALL':

```typescript
const searchParams = useSearchParams();
const [statusFilter, setStatusFilter] = useState<string>(
  searchParams.get('status') || 'ALL'
);

// Or use useEffect for better Next.js compatibility
useEffect(() => {
  const urlStatus = searchParams.get('status');
  if (urlStatus) {
    setStatusFilter(urlStatus);
  }
}, [searchParams]);
```

**Verification Steps**:
1. Navigate to `/mainboard-ipos?status=OPEN`
2. Verify "OPEN" button is highlighted on load
3. Verify table shows only OPEN IPOs
4. Verify record count reflects filtered data
5. Test with all status values: UPCOMING, OPEN, CLOSED, LISTED
6. Test that changing filter updates URL correctly
7. Test browser back/forward maintains filter state

**Additional Considerations**:
- Should validate URL parameter against allowed status values
- Should handle invalid status values gracefully (fallback to 'ALL')
- Consider same fix for year filter initialization
- Consider centralized URL parameter management pattern

**Priority**: 🟡 MEDIUM (Affects shareable URLs and navigation UX)

---

## 📊 SUMMARY

**Total Open Issues**: 4
**Severity Breakdown**:
- 🔴 HIGH: 2 issues (ISS-001, ISS-002)
- 🟠 MEDIUM-HIGH: 1 issue (ISS-003)
- 🟡 MEDIUM: 1 issue (ISS-026)

**Issue Types**:
- Data Pipeline Issues: 3 (ISS-001, ISS-002, ISS-003)
- Frontend Issues: 1 (ISS-026)

**Next Steps**:
1. Investigate scraper status in `scraper/` directory
2. Test existing scrapers manually
3. Identify missing scrapers and create them
4. Set up scheduled jobs for continuous data updates
5. Add monitoring/alerting for data pipeline health
