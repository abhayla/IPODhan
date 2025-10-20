# ISS-023 Resolution Summary

**Status**: ALREADY RESOLVED (False Positive)
**Resolution Commit**: 1ff1e77
**Investigation Date**: 2025-10-20

---

## Quick Summary

ISS-023 reported that calendar pages were failing due to API limit validation mismatch (requesting 500 IPOs but API max is 100). This issue was **already resolved** in commit 1ff1e77 (Story 11.8a) before this investigation began.

## What Was Fixed

### Before (Original Implementation)
```typescript
// mainboard-calendar-service.ts (BROKEN)
const iposResponse = await apiClient.getIPOs({
  category: CATEGORY_MAINBOARD,
  limit: 500, // EXCEEDS API MAX OF 100 ❌
});
const ipos = iposResponse.data;

// sme-calendar-service.ts (BROKEN)
const ipoResponse = await apiClient.getIPOs({
  category: 'SME',
  limit: 1000, // EXCEEDS API MAX OF 100 ❌
});
const smeIPOs = ipoResponse.data;
```

**Problem**: Both services requested more items than API allows → 400 validation error

### After (Current Implementation)
```typescript
// mainboard-calendar-service.ts (FIXED)
const iposResponse = await apiClient.getCalendarIPOs({
  category: CATEGORY_MAINBOARD,
  // NO LIMIT ✅
});
const ipos = iposResponse.ipos;

// sme-calendar-service.ts (FIXED)
const ipoResponse = await apiClient.getCalendarIPOs({
  category: 'SME',
  // NO LIMIT ✅
});
const smeIPOs = ipoResponse.ipos;
```

**Solution**:
1. Use dedicated `/api/calendar/{category}` endpoint (no limit validation)
2. Remove limit parameter entirely
3. Fetch ALL IPOs for category without pagination

## Verification

### Code Verification
```bash
# No limit parameters in calendar services
$ grep -r "limit:" web/lib/services/*calendar*.ts
(No results) ✅

# Both services use getCalendarIPOs()
$ grep "getCalendarIPOs" web/lib/services/*calendar*.ts
web/lib/services/sme-calendar-service.ts:150
web/lib/services/mainboard-calendar-service.ts:292 ✅
```

### Git Verification
```bash
$ git log --oneline -- web/lib/services/mainboard-calendar-service.ts
1ff1e77 feat(story-11.8a): Restructure category field into segment + offeringType ✅
35457a3 feat(story-4.12): Implement extended timeline dates for IPO tracking
7f011a2 feat(story-9.9a): Add Mainboard IPO Calendar page

$ git merge-base HEAD 1ff1e77
1ff1e77c1ab80c437db22f0ef70413b88f107348 ✅
(Fix is in current branch)
```

## API Architecture

### General List Endpoint (With Limits)
- **Endpoint**: `GET /api/ipos`
- **Max Limit**: 100 items
- **Use Case**: Landing pages, search results, filtered lists
- **Validation**: `z.coerce.number().int().min(1).max(100).default(20)`

### Calendar Endpoint (No Limits)
- **Endpoint**: `GET /api/calendar/{category}`
- **Max Limit**: None (fetches ALL)
- **Use Case**: Calendar views, analytics
- **Implementation**: Calls `ipoRepository.findAllWithDetails()` with no limit

## Recommendation

**Action**: Close ISS-023 as RESOLVED/DUPLICATE

**Reasoning**:
1. Issue was valid at initial implementation
2. Already fixed in commit 1ff1e77 (Story 11.8a)
3. Current codebase has no limit validation errors
4. Both calendar pages work correctly

**Status Update Required**:
- Mark ISS-023 as RESOLVED in `current-issues.md`
- Document resolution commit: 1ff1e77
- Resolution date: Prior to 2025-10-20

## New Issue Discovered

During investigation, found **similar issue in landing services**:

**Files Affected**:
- `web/lib/services/mainboard-landing-service.ts` (lines 142, 399)
- `web/lib/services/sme-landing-service.ts` (lines 143, 406)

**Problem**: Landing services request 1000 IPOs but API max is 100

**Recommendation**: Create ISS-024 for landing services limit mismatch

---

## Files in This Investigation

1. `ISS-023-INVESTIGATION-REPORT.md` - Full technical analysis (2800+ lines)
2. `ISS-023-RESOLUTION-SUMMARY.md` - This file (executive summary)

**For Complete Details**: See ISS-023-INVESTIGATION-REPORT.md
