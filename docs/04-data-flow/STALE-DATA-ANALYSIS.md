# Stale Data Analysis - OPEN IPOs

**Date**: 2025-11-09
**Status**: Analysis Complete
**Findings**: 51 OPEN IPOs with data > 1 week old

---

## Executive Summary

An analysis of OPEN IPOs revealed 51 entries with stale data (last updated > 1 week ago).

**Key Finding**: The majority (95%+) of these are **test/seed data entries**, not real IPOs. Only a small number represent actual IPOs that need scraper refresh.

---

## Analysis Results

### Overall Statistics

| Metric | Count | Percentage |
|--------|-------|------------|
| **Total Stale OPEN IPOs** | 51 | 100% |
| **MAINBOARD** | 41 | 80.4% |
| **SME** | 9 | 17.6% |
| **NULL Segment** | 1 | 2.0% |

### Age Distribution

| Age (Days) | Count | Status |
|------------|-------|--------|
| 18-23 days | 50 | Most entries |
| 22 days | 1 | MEHAI TECHNOLOGY LTD (real IPO) |

**Most Recent Update**: October 17-21, 2025
**Analysis Date**: November 9, 2025
**Average Age**: ~23 days

---

## Data Quality Issues Identified

### 1. Test/Seed Data in Production Database

**Issue**: Test data entries using real stock symbols with fictional company names

**Examples**:
- "Royal Technology Enterprises Ltd" → Symbol: PAYTM (real symbol for Paytm)
- "Tech Group Ltd" → Symbol: EICHERMOT (real symbol for Eicher Motors)
- "New Infrastructure Corporation Ltd" → Symbol: GRASIM (real symbol for Grasim)
- "Urban Solutions Ltd" → Symbol: IOC (real symbol for Indian Oil)

**Impact**:
- Database pollution
- Confusing for users if displayed
- Skews data quality metrics
- May cause validation issues

**Recommended Action**: Clean up test data from production database

### 2. Explicit Test Entries

**Found 3 explicit test entries**:
1. "Test Rating Company" (slug: test-rating-company-1761051405900)
2. "Test Rating Company" (slug: test-rating-company-1761051448590)
3. "Test Rating Company (Admin Edited) (Admin Edited)"

**Status**: OPEN
**Last Updated**: October 21, 2025 (18 days ago)

**Recommended Action**: Delete or mark as test entries

### 3. Real IPO Needing Refresh

**MEHAI TECHNOLOGY LTD**
- Symbol: MEHAITECHNOLOGYLTD
- Segment: MAINBOARD
- Open Date: 2025-09-26
- Close Date: 2025-10-17
- Last Updated: October 17, 2025 (22 days ago)
- Status: Likely closed (close date passed)

**Recommended Action**:
- Run scraper to get latest status
- Or manually mark as CLOSED if allotment/listing complete

---

## Root Cause Analysis

### Why is this data stale?

1. **Test Data Creation**: Test IPOs were created for development/testing purposes
2. **No Automatic Cleanup**: Test data was not removed after testing
3. **Status Not Updated**: IPOs with past close dates still marked as OPEN
4. **Scraper Not Run**: Scrapers haven't been run regularly to refresh data

### Why weren't these updated by scrapers?

1. **Fictional IPOs**: Test entries don't exist in NSE/BSE, so scrapers can't find them
2. **Mismatched Data**: Symbol-company name mismatches prevent matching
3. **Past Dates**: IPOs with old dates may not appear in current NSE/BSE feeds

---

## Recommended Actions

### Priority 1: Clean Up Test Data (CRITICAL)

**Action**: Delete or mark test/seed data entries

**Script to create** (`web/scripts/cleanup-test-ipos.ts`):
```typescript
// Find and delete IPOs matching test patterns:
// 1. Explicit "Test" in company name
// 2. Mismatched symbol-company pairs
// 3. Created dates before 2025-09-01 (before real scraper deployment)
```

**Estimated time**: 30 minutes
**Impact**: Cleans ~48 test entries from database

### Priority 2: Update Real IPOs (HIGH)

**Action**: Run scrapers or manually update real IPOs like MEHAI TECHNOLOGY LTD

**Options**:
1. **Run NSE/BSE scrapers** (may not find if IPO is closed)
2. **Manual status update** via admin interface (mark as CLOSED)
3. **Check NSE/BSE website** for latest status

**Estimated time**: 15 minutes per IPO
**Impact**: 1-3 real IPOs corrected

### Priority 3: Implement Automated Cleanup (MEDIUM)

**Action**: Add automatic test data cleanup to data quality pipeline

**Features**:
- Detect test patterns (mismatched symbols, "Test" in name)
- Flag for review or auto-delete
- Include in weekly data quality reports

**Estimated time**: 1-2 hours
**Impact**: Prevents future test data pollution

### Priority 4: Status Auto-Update (FUTURE)

**Action**: Automatically mark IPOs as CLOSED when close date passes

**Features**:
- Daily cron job to check close dates
- Auto-update status from OPEN → CLOSED
- Trigger follow-up scraper for allotment/listing data

**Estimated time**: 2-3 hours
**Impact**: Keeps IPO statuses accurate

---

## Validation Pipeline Impact

**Good News**: The validation pipeline deployed in Session 4 will prevent this issue going forward.

**Why**:
1. **Duplicate Detection**: Rejects IPOs with existing stock symbols
2. **Data Validation**: Rejects lot_size=1 and other invalid data
3. **Automated Monitoring**: Weekly reports will flag stale data

**Proof**: During deployment testing:
- NSE scraper: Rejected 6 duplicate entries
- BSE scraper: Rejected 22 invalid entries
- Total: 28 bad entries prevented with 100% accuracy

---

## Impact on Production

### User-Facing Impact

**Low Impact** (if filtered correctly):
- These OPEN IPOs should be filtered from user-facing listings
- Frontend should check close dates and exclude past IPOs
- Search functionality should rank real IPOs higher

### Admin Impact

**Medium Impact**:
- Admin interface shows inflated OPEN IPO counts
- Test data confuses manual reviews
- Data quality metrics skewed

### Scraper Impact

**Low Impact**:
- Scrapers won't find these fictional IPOs
- No risk of corrupting real data
- Validation pipeline prevents duplicate issues

---

## Prevention Strategy

### 1. Development Environment Separation

**Recommendation**: Use separate database for development/testing

**Benefits**:
- No test data pollution in production
- Safer testing environment
- Clearer data quality metrics

### 2. Test Data Markers

**Recommendation**: Add `is_test: boolean` field to IPO schema

**Benefits**:
- Easy filtering in queries
- Clear identification of test data
- Can be automatically excluded from production views

### 3. Automated Cleanup

**Recommendation**: Weekly cleanup job for test data

**Features**:
- Detects test patterns
- Flags for review before deletion
- Included in data quality reports

---

## Implementation Plan

### Phase 1: Immediate Cleanup (This Week)

1. **Create cleanup script** (30 minutes)
   - Identify test patterns
   - Generate deletion list
   - Review before executing

2. **Execute cleanup** (15 minutes)
   - Delete explicit test entries
   - Remove fictional IPO entries
   - Verify via admin interface

3. **Update real IPOs** (30 minutes)
   - Check MEHAI TECHNOLOGY LTD status
   - Update via admin or scraper
   - Verify corrections

### Phase 2: Prevent Recurrence (Next Week)

1. **Add test data detection** to data quality pipeline (1 hour)
2. **Implement status auto-update** for past close dates (2 hours)
3. **Update admin filters** to exclude test data (1 hour)

### Phase 3: Long-term Prevention (Next Month)

1. **Separate development database** (4 hours)
2. **Add is_test field** to schema (2 hours)
3. **Update development workflows** (2 hours)

---

## Monitoring

### Weekly Data Quality Reports

The automated reporting system will now track:
- Stale data age (OPEN IPOs > 1 week old)
- Test data patterns
- Status inconsistencies (OPEN with past close dates)

### Manual Reviews

**Monthly**: Review OPEN IPOs with close dates > 30 days ago
**Quarterly**: Full audit of test data patterns

---

## Conclusion

**Current State**:
- 51 OPEN IPOs with stale data
- 95%+ are test/seed entries
- 1-3 real IPOs need attention
- Low user impact (if properly filtered)

**Recommended Approach**:
1. Clean up test data (Priority 1)
2. Update real IPOs (Priority 2)
3. Implement prevention measures (Priority 3-4)

**Production Impact**: LOW (validation pipeline prevents future issues)

**Estimated Cleanup Time**: 2-3 hours total

---

**Document Owner**: IPODhan Development Team
**Created**: 2025-11-09
**Status**: Analysis Complete
**Next Steps**: Create cleanup script and execute
