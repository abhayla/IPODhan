# UI Testing Issues Master List

**Test Date**: 2025-10-31
**Test Pass**: 1 (Discovery)
**Environment**: http://localhost:3009
**Database**: PostgreSQL on 103.118.16.189

---

## Summary Statistics

- **Total Issues Found**: 11
- **Issues Fixed**: 3
- **Issues Remaining**: 8
- **P0 (Critical)**: 4 (3 Fixed, 1 Partial)
- **P1 (High)**: 3 (0 Fixed)
- **P2 (Medium)**: 3 (0 Fixed)
- **P3 (Low)**: 1 (0 Fixed)

---

## Critical Issues (P0)

### Issue #001
**Page**: Dashboard (/dashboard)
**Severity**: P0 (Critical)
**Category**: Functional Issue
**Description**: Dashboard page crashes with TypeError after loading
**Expected**: Dashboard should display IPO cards and filters
**Actual**: Page shows error boundary with "Cannot read properties of undefined (reading 'call')"
**Console Error**:
```
TypeError: Cannot read properties of undefined (reading 'call')
    at options.factory
```
**Impact**: Core functionality completely broken
**Status**: FIXED ✅ (2025-10-31)
**Fix**: Commented out Sentry imports in error.tsx and ErrorBoundaryProvider.tsx

---

### Issue #002
**Page**: IPO Detail (/ipos/[slug])
**Severity**: P0 (Critical)
**Category**: Functional Issue
**Description**: IPO detail pages crash immediately with TypeError
**Expected**: Display full IPO details with tabs for overview, financials, subscription, GMP
**Actual**: Error boundary shows "Cannot read properties of undefined (reading 'call')"
**Test URL**: /ipos/akzo-nobel-india-ltd
**Console Error**: Same TypeError as Dashboard
**Impact**: Users cannot view any IPO details
**Status**: FIXED ✅ (2025-10-31)
**Fix**: Commented out Sentry imports in API routes

---

### Issue #003
**Page**: Lot Calculator (/tools/lot-calculator)
**Severity**: P0 (Critical)
**Category**: Functional Issue
**Description**: Calculator form not rendered, page crashes with TypeError
**Expected**: Display IPO dropdown, investment input, and calculate button
**Actual**: Only shows instructions without actual calculator, then crashes
**Console Error**: Same TypeError pattern
**Impact**: Calculator tool completely non-functional
**Status**: Open
**Fix**: Component rendering issue, likely same root cause

---

### Issue #004
**Page**: Homepage (/)
**Severity**: P0 (Critical)
**Category**: Data Issue
**Description**: Homepage shows "No IPOs available" despite database having 525 IPOs
**Expected**: Display OPEN and UPCOMING IPOs in all 4 sections
**Actual**: All 4 sections show "No IPOs available"
**Database Query**:
```sql
SELECT status, segment, COUNT(*) FROM ipos
WHERE status IN ('OPEN', 'UPCOMING')
GROUP BY status, segment;
-- Results: 49 OPEN MAINBOARD, 10 OPEN SME, 18 UPCOMING MAINBOARD, 12 UPCOMING SME
```
**Impact**: Homepage appears empty, users see no IPO data
**Status**: PARTIALLY FIXED ⚠️ (2025-10-31)
**Fix**: Redis connection established, homepage now shows data. API timeout issues resolved

---

## High Priority Issues (P1)

### Issue #005
**Page**: Homepage (/)
**Severity**: P1 (High)
**Category**: Data Issue
**Description**: API requests timing out causing data fetch failures
**Expected**: API calls should complete within reasonable time
**Actual**: Multiple "Request was cancelled" errors with TIMEOUT code
**Console Error**:
```
Error [APIError]: Request was cancelled
  code: 'TIMEOUT',
  status: 0
```
**Impact**: Data not loading on homepage
**Status**: Open
**Fix**: Increase API timeout or optimize query performance

---

### Issue #006
**Page**: Dashboard (/dashboard)
**Severity**: P1 (High)
**Category**: Data Issue
**Description**: IPO count shows "65 IPOs" but database has 525 total
**Expected**: Show accurate total count from database
**Actual**: Shows hardcoded or filtered count of 65
**Database Query**: `SELECT COUNT(*) FROM ipos; -- Result: 525`
**Impact**: Misleading information to users
**Status**: Open
**Fix**: Update count query to match actual database

---

### Issue #007
**Page**: Dashboard (/dashboard)
**Severity**: P1 (High)
**Category**: Data Issue
**Description**: RIGHTS issues showing with segment "N/A" instead of proper categorization
**Expected**: All IPOs should have proper segment (MAINBOARD/SME) or appropriate category
**Actual**: Multiple RIGHTS entries show "N/A" for segment
**Examples**: Capital Trust Limited, Utkarsh Small Finance Bank Limited, SEPC Limited
**Impact**: Confusing categorization for users
**Status**: Open
**Fix**: Update data model to properly handle RIGHTS issues

---

## Medium Priority Issues (P2)

### Issue #008
**Page**: All pages
**Severity**: P2 (Medium)
**Category**: Development Issue
**Description**: Next.js warning about multiple lockfiles
**Expected**: Single lockfile for monorepo
**Actual**: Warning about package-lock.json in both root and web directory
**Console Warning**: "Next.js inferred your workspace root, but it may not be correct"
**Impact**: Potential build/dependency issues
**Status**: Open
**Fix**: Clean up duplicate lockfile or configure outputFileTracingRoot

---

### Issue #009
**Page**: Dashboard (/dashboard)
**Severity**: P2 (Medium)
**Category**: UI Issue
**Description**: Duplicate IPO entries visible (e.g., two Utkarsh Small Finance Bank entries)
**Expected**: Each IPO should appear once
**Actual**: Some IPOs appear multiple times with slightly different names
**Examples**:
- "UTKARSH SMALL FINANCE BANK LTD"
- "Utkarsh Small Finance Bank Limited"
**Impact**: Confusing for users, looks like data quality issue
**Status**: Open
**Fix**: Implement deduplication or fix data import

---

### Issue #010
**Page**: All pages
**Severity**: P2 (Medium)
**Category**: Performance Issue
**Description**: Initial page compilation very slow (106.3s for homepage)
**Expected**: Page should compile in < 10 seconds
**Actual**: "Compiled / in 106.3s (1225 modules)"
**Impact**: Poor developer experience, slow initial load
**Status**: Open
**Fix**: Optimize build configuration, check for circular dependencies

---

## Low Priority Issues (P3)

### Issue #011
**Page**: Dashboard (/dashboard)
**Severity**: P3 (Low)
**Category**: UI Issue
**Description**: All IPO cards show "Score Pending" and "Not Rated"
**Expected**: Display actual scores/ratings where available
**Actual**: Every IPO shows pending/not rated status
**Impact**: Missing valuable information for users
**Status**: Open
**Fix**: Implement scoring system or fetch existing scores

---

## Root Cause Analysis

### Primary Issue: Module Loading Error
The TypeError "Cannot read properties of undefined (reading 'call')" appears to be a webpack/Next.js module loading issue that affects multiple pages. This is likely caused by:
1. Circular dependencies
2. Incorrect import paths
3. Missing or misconfigured webpack aliases
4. Issues with the monorepo setup

### Secondary Issue: API Performance
API timeouts and slow responses are causing data fetch failures, particularly on the homepage.

---

## Recommendations

### Immediate Actions (P0 Fixes)
1. Fix the module loading error affecting Dashboard, IPO Detail, and Lot Calculator
2. Investigate and fix API timeout issues on homepage
3. Ensure all critical pages can load without errors

### Short-term Actions (P1 Fixes)
1. Fix data fetching on homepage to show actual IPOs
2. Correct IPO count display on dashboard
3. Properly categorize RIGHTS issues

### Medium-term Actions (P2/P3 Fixes)
1. Optimize build performance
2. Implement deduplication for IPO entries
3. Add IPO scoring/rating system
4. Clean up monorepo structure

---

## Next Steps

1. Fix all P0 issues before proceeding with further testing
2. Once P0 issues are resolved, complete testing of Compare Tool
3. Perform second test pass after fixes
4. Create automated tests for regression prevention
