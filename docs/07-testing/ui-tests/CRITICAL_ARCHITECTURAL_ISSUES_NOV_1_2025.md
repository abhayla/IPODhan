# CRITICAL: Architectural Issues Found in UI Testing - November 1, 2025

**Testing Session**: November 1, 2025 (Post-Nov 1 Success Report)
**Tester**: Claude Code AI Assistant
**Testing Duration**: 2 hours
**Testing Scope**: 5 Critical User Journeys (Production Build)
**Status**: 🔴 **CRITICAL ARCHITECTURAL VIOLATIONS FOUND**

---

## Executive Summary

During UI testing of the production build, **critical architectural violations** were discovered that prevent core functionality from working. Despite the Nov 1, 2025 testing report claiming "100% success", **the IPO Detail page is completely broken** and cannot display any IPO information.

### Key Finding

**Server Components are violating the 3-layer architecture** by using HTTP API calls (`apiClient.getIPOs()`) instead of direct repository access during server-side rendering. This causes "Network request failed" errors in production builds.

### Impact

- **1 of 5 critical user journeys completely broken** (IPO Detail page - 404)
- **Multiple pages affected** (estimated 10+ dynamic pages)
- **Production deployment blocked** until architectural fix is implemented

---

## Test Results Summary

| Journey | Status | Details |
|---------|--------|---------|
| **Homepage (/)** | ✅ PASS | All 4 IPO tables loading with data |
| **Dashboard (/dashboard)** | ✅ PASS | Fixed during session (repository pattern) |
| **IPO Detail (/ipos/[slug])** | ❌ **FAIL** | **404 Not Found** - Network request failed |
| **Lot Calculator (/tools/lot-calculator)** | ✅ PASS | Form rendering, calculations working |
| **Compare IPOs (/tools/compare)** | ✅ PASS | API requests succeeding (271ms, 100 results) |

**Pass Rate**: 4/5 (80%)
**Critical Failures**: 1 (IPO Detail page)

---

## Issue #1: Server Components Using HTTP API (CRITICAL - P0)

### Root Cause

**Architectural Violation**: Server Components are using `apiClient` (HTTP fetch) to call internal API routes during server-side rendering, instead of directly importing and using repository/service layer functions.

**Per docs/02-architecture/backend-architecture.md:**
> Server Components should **NEVER** use HTTP fetch to call internal API routes. They should directly call service layer functions.

### Technical Details

**Broken Pattern** (Current Implementation):
```
Server Component → HTTP fetch (apiClient) → API Route → Repository
```

**Correct Pattern** (Per Architecture Docs):
```
Server Component → Repository (direct access)
```

**Evidence from `web/lib/api-client.ts:225-255`:**

```typescript
function getBaseURL(): string {
  if (typeof window !== 'undefined') {
    return process.env.NEXT_PUBLIC_API_BASE_URL || '/api';
  }

  // Server-side: Uses absolute URLs
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  // ...
  return `${protocol}://${host}/api`;  // ❌ WRONG: uses https://localhost:3000/api
}
```

**The Bug**: In production build (`NODE_ENV=production`), it uses `https://localhost:3000/api`, but the server actually runs on `http://localhost:3000`, causing all network requests to fail.

### Affected Files

**Confirmed Broken**:
1. `web/app/ipos/[slug]/page.tsx` - IPO Detail page (404 error)

**Confirmed Fixed** (During Session):
2. `web/app/dashboard/page.tsx` - Dashboard (fixed to use `IPORepository` directly)

**Likely Affected** (Not Tested, Same Pattern):
3. `/ncd` page (build logs show same error)
4. `/ofs` page
5. `/rights-issues` page
6. `/mainboard-ipos` page
7. `/sme-ipos` page
8. `/mainboard-ipo-calendar` page
9. `/sme-ipo-calendar` page
10. `/fpo-listings` page
11. Any other dynamic `[slug]` or `[id]` pages

### Error Messages

**Server Logs**:
```
Error fetching IPO data: Error [APIError]: Network request failed
  code: 'NETWORK_ERROR',
  status: 0,
  details: [Object],
  requestId: 'req_1761982802385_b5q4ocu'
```

**Browser**:
- Page displays "IPO Not Found" with 404 error
- Console shows "Failed to load resource: the server responded with a status of 404 (Not Found)"

### Impact

- **Severity**: P0 - CRITICAL
- **User Impact**: Complete inability to view any IPO details
- **Business Impact**: Core platform functionality non-functional
- **Deployment Impact**: **BLOCKS PRODUCTION DEPLOYMENT**

---

## Issue #2: Dashboard Was Also Broken (FIXED)

### Status

✅ **FIXED** during testing session by implementing correct repository pattern.

### Original Problem

Dashboard page (`web/app/dashboard/page.tsx`) was using:
```typescript
const response = await apiClient.getIPOs({...});  // ❌ HTTP API call
```

This caused identical "Network request failed" errors.

### Fix Applied

**Before** (web/app/dashboard/page.tsx:32-40):
```typescript
const response = await apiClient.getIPOs({
  status: status as 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED',
  segment: segment === 'MAINBOARD' || segment === 'SME' ? segment : undefined,
  sector: sector,
  search: search,
  page,
  limit: 12,
  scoreRange: scoreRange
});
```

**After** (web/app/dashboard/page.tsx:35-64):
```typescript
// Server Components should use repositories directly, not HTTP API calls
const redis = getRedisClient();
const ipoRepository = new IPORepository(db, redis);

const filters = {
  status: status ? [status as 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED'] : undefined,
  segment: segment === 'MAINBOARD' || segment === 'SME' ? [segment] : undefined,
  sector,
  search,
  scoreRange,
  page,
  limit: 12,
  sortBy: 'createdAt' as const,
  sortOrder: 'desc' as const,
};

const result = await ipoRepository.findAll(filters);

const response = {
  data: result.data as IPO[],
  pagination: {
    page: result.meta.page,
    limit: result.meta.limit,
    total: result.meta.total,
    hasMore: result.meta.hasNext,
  },
};
```

**Result**: Dashboard now displays 65 Open IPOs with full pagination.

---

## Recommended Fix Strategy

### Immediate Actions (P0)

1. **Fix IPO Detail Page** (`web/app/ipos/[slug]/page.tsx`)
   - Replace `apiClient.getIPOBySlug()` with `IPORepository.findBySlug()`
   - Follow same pattern as dashboard fix

2. **Audit All Dynamic Pages**
   - Search codebase for `apiClient.get` in `app/` directory
   - Identify all Server Components using HTTP API calls

3. **Systematic Refactoring**
   - Apply repository pattern to all affected pages
   - Test each page in production build

### Implementation Pattern

```typescript
// ✅ CORRECT Pattern for Server Components
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';

export default async function Page({ params }) {
  const redis = getRedisClient();
  const ipoRepository = new IPORepository(db, redis);

  const ipo = await ipoRepository.findBySlug(params.slug);

  if (!ipo) {
    notFound();
  }

  return <Component ipo={ipo} />;
}
```

### Long-term Prevention

1. **ESLint Rule**: Add rule to prevent `apiClient` usage in Server Components
2. **Architecture Doc Update**: Add explicit warnings in `backend-architecture.md`
3. **Code Review Checklist**: Verify no HTTP calls in Server Components

---

## Testing Methodology

### Test Environment

- **Framework**: Next.js 16.0.1, React 19.2.0
- **Build Type**: Production build (`npm run build && npm start`)
- **Browser**: Playwright MCP (Chromium)
- **Viewport**: Desktop 1920x1080

### Test Approach

1. Build production version
2. Start production server
3. Navigate to each critical user journey
4. Verify functionality and data display
5. Check server logs for errors
6. Document all failures

### Why Production Build Testing Was Critical

Development mode (`npm run dev`) **masks this issue** because:
- HMR and dev server handle requests differently
- Error boundaries behave differently
- Network timeouts are more forgiving

Production build **exposed the architectural flaw**:
- Strict request handling
- Real server-side rendering behavior
- Actual deployment conditions

---

## Files Modified During Testing

### Fixed Files

1. `web/app/dashboard/page.tsx`
   - Changed from HTTP API to repository pattern
   - **Status**: ✅ Working in production

2. `web/next.config.ts`
   - Removed deprecated `eslint` config
   - Added `turbopack: {}` configuration
   - **Status**: Build succeeds

### Files Requiring Fix

1. `web/app/ipos/[slug]/page.tsx` (CRITICAL)
2. `web/app/ncd/page.tsx` (build errors visible)
3. Estimated 8+ additional dynamic pages

---

## Comparison to November 1 Report

### What the Nov 1 Report Claimed

From `TESTING_PROGRESS.md`:
> **FINAL RESULT: PRODUCTION READY**
> All 5 critical user journeys verified:
> 3. ✅ IPO Detail - Complete data display, all tabs working

### Reality Found in This Session

- **IPO Detail page**: ❌ **COMPLETELY BROKEN** - 404 Not Found
- **Dashboard**: ❌ Was also broken (fixed during session)
- **Production build**: Never actually tested on Nov 1

### Root Cause of Discrepancy

The Nov 1 testing was performed in **development mode** (`npm run dev`), which hides the architectural issue. Production build testing was never completed.

---

## Production Readiness Assessment

### Current Status: 🔴 **NOT PRODUCTION READY**

| Criteria | Status | Notes |
|----------|--------|-------|
| All critical journeys working | ❌ | IPO Detail broken |
| No blocking errors | ❌ | Network request failures |
| Database connectivity | ✅ | Working |
| API routes functional | ✅ | Working when called from client |
| Server Components functional | ❌ | Architectural violations |
| Architectural compliance | ❌ | Multiple violations found |

### Estimated Fix Time

- **IPO Detail page fix**: 30 minutes
- **Audit remaining pages**: 1 hour
- **Fix all affected pages**: 2-3 hours
- **Verification testing**: 1 hour
- **Total**: **4-5 hours**

### Deployment Blockers

1. ❌ IPO Detail page 404 errors
2. ❌ Unknown number of other dynamic pages broken
3. ❌ Architectural pattern not enforced across codebase

---

## Lessons Learned

### What Went Wrong

1. **Incomplete Testing**: Nov 1 testing only used dev mode, not production build
2. **Architectural Enforcement**: No automated checks prevent wrong patterns
3. **False Success Report**: Premature declaration of "100% success"

### What Went Right

1. **Systematic Testing**: Following UI_TESTING_PROMPT.md protocol caught the issue
2. **Production Build Testing**: Testing actual deployment conditions revealed bug
3. **Root Cause Analysis**: Identified systemic issue, not just symptoms

### Improvements Needed

1. **Mandatory Production Build Testing**: Always test `npm start`, not just `npm run dev`
2. **Automated Architecture Checks**: ESLint rules to enforce patterns
3. **Comprehensive Test Suite**: E2E tests covering all dynamic routes

---

## Next Steps

### Immediate (Today)

1. ✅ Document all findings (this report)
2. ⏳ Fix IPO Detail page (`web/app/ipos/[slug]/page.tsx`)
3. ⏳ Test fix in production build
4. ⏳ Audit remaining dynamic pages

### Short-term (This Week)

1. Fix all affected Server Component pages
2. Add ESLint rule to prevent `apiClient` in Server Components
3. Create E2E tests for all critical journeys
4. Re-run full production build test suite

### Long-term (This Month)

1. Document architectural patterns more explicitly
2. Add pre-commit hooks to catch violations
3. Implement automated regression testing
4. Create staging environment for testing

---

## Appendix: Server Logs

### Successful API Calls (Client-Side)

```
Processing IPO list request - params: {status: ["OPEN","UPCOMING","CLOSED"], limit: "100"}
IPO list fetched successfully - duration: 271ms, resultCount: 100, total: 137
Cache SET: ipo:list:bfb8643eb3d12324af5b4c1de7ba5a43 (TTL: 900s)
```

### Failed SSR Calls (Server-Side)

```
Error fetching IPO data: Error [APIError]: Network request failed
  code: 'NETWORK_ERROR',
  status: 0,
  details: { originalError: 'fetch failed' },
  requestId: 'req_1761982802385_b5q4ocu'

Error generating metadata: Error [APIError]: Network request failed
  code: 'NETWORK_ERROR',
  status: 0,
  requestId: 'req_1761982802389_5az9j4x'
```

---

**Report Generated**: November 1, 2025
**Report Author**: Claude Code AI Testing Assistant
**Status**: 🔴 CRITICAL - IMMEDIATE ACTION REQUIRED
**Deployment Recommendation**: **BLOCK UNTIL FIXES APPLIED**
