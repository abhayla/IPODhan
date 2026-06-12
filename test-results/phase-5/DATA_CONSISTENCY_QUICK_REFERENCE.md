# Data Consistency Testing - Quick Reference

**Test Date:** 2025-10-21
**Database:** Production (103.118.16.189:5432/ipodhan)
**Total IPOs:** 495
**Overall Grade:** B+ (87/100)

---

## Executive Summary (30-Second Read)

✅ **Perfect structural integrity** - Zero orphaned records, no duplicates, valid relationships
❌ **Critical data gaps** - 99.6% missing price bands, 97% missing subscription data
🔴 **Status workflow broken** - 29 IPOs need immediate status update
⚠️ **Low data coverage** - 80% of LISTED IPOs missing listing performance

---

## Test Results Summary

| Category | Score | Status |
|----------|-------|--------|
| Foreign Key Integrity | 100% (8/8) | ✅ PERFECT |
| Required Fields | 100% (6/6) | ✅ PERFECT |
| Date Logic | 100% | ✅ PERFECT |
| Duplicate Prevention | 100% (3/3) | ✅ PERFECT |
| Status Consistency | 94.1% | ⚠️ 29 outdated |
| Data Coverage - Core | 40% | ⚠️ NEEDS WORK |
| Data Coverage - Extended | 15% | ❌ CRITICAL |

---

## Critical Issues (Fix This Week)

### 1. Status Workflow Broken 🔴 HIGH
**Problem:** 29 IPOs with outdated status
- 6 UPCOMING → should be OPEN (open_date passed)
- 23 OPEN → should be CLOSED (close_date passed)

**Impact:** User confusion, broken UX, incorrect subscription tracking

**Fix:**
```bash
# Create status updater cron job
scraper/src/scheduler/status-updater.ts
# Run daily to auto-update based on dates
```

**Effort:** 2-4 hours
**Priority:** 🔴 CRITICAL - Fix TODAY

---

### 2. Price Band Data Missing 🔴 CRITICAL
**Problem:** 493/495 IPOs (99.6%) missing price_band_low/high

**Impact:** Investors cannot see IPO price ranges

**Fix:**
```bash
# Update NSE scraper
scraper/src/scrapers/nse-scraper.ts
# Add backfill script
web/scripts/backfill-price-bands.ts
```

**Effort:** 4-6 hours
**Priority:** 🔴 CRITICAL

---

### 3. Subscription Data Gap 🔴 HIGH
**Problem:** 37/38 OPEN IPOs (97.4%) without subscription data

**Coverage:** Only 2 IPOs (0.4%) have subscription records

**Impact:** Cannot show real-time subscription status

**Fix:** Verify scraper is running and collecting subscription data

**Effort:** 2-3 hours investigation
**Priority:** 🔴 HIGH

---

### 4. Listing Performance Gap ⚠️ HIGH
**Problem:** 311/388 LISTED IPOs (80.15%) missing listing_performance

**Impact:** Post-listing analysis unavailable for most IPOs

**Fix:** Create backfill script for historical listing data

**Effort:** 6-8 hours
**Priority:** ⚠️ HIGH

---

## Data Coverage Quick Stats

```
Excellent (>90%):
  ✅ Core IPO fields: 100%
  ✅ Lot sizes: 100%
  ✅ Peer companies: 99.8%

Poor (<20%):
  ❌ Price bands: 0.4%
  ❌ Subscription data: 0.4%
  ❌ Financial data: 0%
  ❌ Documents: 0%
  ⚠️ GMP records: 2.63%
  ⚠️ IPO reviews: 10.1%
  ⚠️ Listing performance: 19.85%
```

---

## What's Working Well ✅

1. **Perfect Referential Integrity**
   - Zero orphaned records across ALL tables
   - All foreign keys valid

2. **Data Quality**
   - No duplicate slugs
   - No duplicate entries
   - All date sequences logical
   - All numeric fields valid (no negatives)

3. **Required Fields**
   - 100% populated: company_name, slug, segment, status, dates

4. **Peer Company Data**
   - 99.8% coverage (494/495 IPOs)
   - 1,482 peer company records

---

## Immediate Action Items (Priority Order)

### Today
1. ✅ Create status updater cron job (2-4 hours)
   - Fix 29 IPOs immediately
   - Prevent future status drift

### This Week
2. ✅ Update NSE scraper for price bands (4-6 hours)
   - Capture price_band_low/high fields
   - Run backfill for existing IPOs

3. ✅ Investigate subscription scraper (2-3 hours)
   - Why are only 2 IPOs getting subscription data?
   - Fix and re-run for all OPEN IPOs

### This Month
4. ✅ Backfill listing performance (6-8 hours)
   - 311 LISTED IPOs need data
   - Scrape from BSE/NSE historical APIs

5. ✅ Implement financial data scraper (8-12 hours)
   - Parse DRHP documents
   - Populate financial_data table

6. ✅ Enhance GMP collection (4-6 hours)
   - Verify Chittorgarh scraper
   - Increase scraping frequency

---

## Database Statistics

```
Total IPOs: 495
├── Status Distribution:
│   ├── UPCOMING: 31 (6.3%)
│   ├── OPEN: 38 (7.7%)
│   ├── CLOSED: 38 (7.7%)
│   └── LISTED: 388 (78.3%)
│
├── Segment Distribution:
│   ├── MAINBOARD: 223 (45.1%)
│   └── SME: 272 (54.9%)
│
└── Data Coverage:
    ├── With subscriptions: 2 (0.4%)
    ├── With GMP: 13 (2.63%)
    ├── With reviews: 50 (10.1%)
    ├── With listing perf: 77 (19.85%)
    ├── With financials: 0 (0%)
    └── With documents: 0 (0%)
```

---

## Files to Create/Update

### New Files (Create)
```bash
scraper/src/scheduler/status-updater.ts       # CRITICAL
web/scripts/backfill-price-bands.ts           # CRITICAL
scraper/src/scrapers/historical-data-scraper.ts  # HIGH
scraper/src/scrapers/financial-data-scraper.ts   # MEDIUM
```

### Existing Files (Update)
```bash
scraper/src/scrapers/nse-scraper.ts           # Add price band capture
scraper/src/scheduler/index.ts                # Add status updater to cron
```

---

## SQL Quick Checks

### Check Status Issues
```sql
-- UPCOMING IPOs that should be OPEN
SELECT company_name, open_date
FROM ipos
WHERE status = 'UPCOMING' AND open_date < NOW();
-- Result: 6 IPOs

-- OPEN IPOs that should be CLOSED
SELECT company_name, close_date
FROM ipos
WHERE status = 'OPEN' AND close_date < NOW();
-- Result: 23 IPOs
```

### Check Data Coverage
```sql
-- Subscription coverage
SELECT
  COUNT(DISTINCT s.ipo_id) AS with_subscriptions,
  (SELECT COUNT(*) FROM ipos) AS total,
  ROUND(100.0 * COUNT(DISTINCT s.ipo_id) / (SELECT COUNT(*) FROM ipos), 2) AS percentage
FROM subscriptions s;
-- Result: 2 IPOs (0.4%)

-- Listing performance coverage
SELECT
  COUNT(*) AS with_listing_data,
  (SELECT COUNT(*) FROM ipos WHERE status = 'LISTED') AS total_listed,
  ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM ipos WHERE status = 'LISTED'), 2) AS percentage
FROM listing_performance;
-- Result: 77 IPOs (19.85%)
```

---

## Success Criteria

**When to consider data consistency "EXCELLENT" (A+ grade):**
- ✅ Foreign key integrity: 100% (ACHIEVED)
- ✅ Required fields: 100% (ACHIEVED)
- ❌ Status consistency: >99% (Currently 94.1%)
- ❌ Price band coverage: >95% (Currently 0.4%)
- ❌ Subscription coverage: >80% (Currently 0.4%)
- ❌ Listing performance: >90% (Currently 19.85%)
- ❌ Financial data: >70% (Currently 0%)

**Target:** Achieve A+ (95+) within 1 month

---

## Quick Commands

### Connect to Database
```bash
PGPASSWORD="<db-password>" psql -h 103.118.16.189 -U postgres -d ipodhan
```

### Check Table Counts
```sql
SELECT
  (SELECT COUNT(*) FROM ipos) AS total_ipos,
  (SELECT COUNT(*) FROM subscriptions) AS subscriptions,
  (SELECT COUNT(*) FROM gmp_records) AS gmp_records,
  (SELECT COUNT(*) FROM listing_performance) AS listing_performance,
  (SELECT COUNT(*) FROM financial_data) AS financial_data,
  (SELECT COUNT(*) FROM ipo_reviews) AS reviews,
  (SELECT COUNT(*) FROM peer_companies) AS peer_companies;
```

### Find Stale IPOs
```sql
-- All outdated statuses
SELECT company_name, status, open_date, close_date
FROM ipos
WHERE (status = 'UPCOMING' AND open_date < NOW())
   OR (status = 'OPEN' AND close_date < NOW())
ORDER BY close_date DESC;
```

---

## Full Report

For complete details, see: `test-results/phase-5/data-consistency-tests.md`

**Report Sections:**
1. Foreign Key Integrity (8 tests)
2. Data Completeness (6 tests)
3. Data Accuracy (8 tests)
4. Duplicate Detection (3 tests)
5. Cross-Table Validation (1 test)
6. Missing Data Analysis
7. Recommendations by Priority
8. SQL Test Queries

**Total Pages:** 17 pages
**Test Cases:** 24 total
**Passing:** 20/24 (83.3%)
**Warnings:** 4

---

**Last Updated:** 2025-10-21 17:20
**Next Review:** After implementing status updater (Week 1)
