# ISS-013 Investigation Report
## Mainboard IPOs Hub - Alleged SME Data Contamination

**Issue ID**: ISS-013
**Reported Severity**: CRITICAL
**Investigation Date**: 2025-10-20
**Investigator**: Claude Code Dev Agent
**Status After Investigation**: ⚠️ **LIKELY FALSE POSITIVE**

---

## Executive Summary

After comprehensive code review and API testing, **no evidence of SME data contamination was found in the codebase**. All filtering mechanisms are correctly implemented and functioning as designed. The reported issue may stem from:
1. Stale Redis cache from before segment filtering was implemented
2. Test methodology searching for "SME" text in navigation headers (not actual IPO data)
3. Timing issue during initial feature deployment

**Recommendation**: Clear Redis cache, re-test with focused methodology, and reclassify issue.

---

## Investigation Methodology

### 1. Code Architecture Review

**Components Analyzed**:
- ✅ Database schema (`packages/shared/src/db/schema.ts`)
- ✅ API route (`web/app/api/ipos/route.ts`)
- ✅ Repository layer (`web/lib/repositories/ipo-repository.ts`)
- ✅ Service layer (`web/lib/services/mainboard-landing-service.ts`)
- ✅ Page component (`web/app/mainboard-ipos/page.tsx`)

### 2. Live API Testing

**Test 1: Mainboard IPOs Endpoint**
```bash
$ curl "http://localhost:3010/api/ipos?segment=MAINBOARD&offeringType=IPO&limit=5"
```

**Result**: ✅ **PASS**
- All returned IPOs have `"segment":"MAINBOARD"`
- Sample: ONIX SOLAR ENERGY LTD, Cool Caps Industries Limited
- No SME IPOs found in response

**Test 2: SME IPOs Endpoint**
```bash
$ curl "http://localhost:3010/api/ipos?segment=SME&limit=5"
```

**Result**: ✅ **PASS**
- All returned IPOs have `"segment":"SME"`
- Sample: Shipwaves Online Ltd., Riddhi Display Equipments Ltd.
- Filtering correctly isolates SME IPOs

---

## Code Analysis Findings

### Database Schema (✅ CORRECT)

**File**: `packages/shared/src/db/schema.ts:125`

```typescript
segment: segmentEnum('segment').notNull(), // Exchange segment (MAINBOARD | SME)
```

- **Column Name**: `segment` (maps to `segment` in VPS database)
- **Type**: Enum with values `['MAINBOARD', 'SME']`
- **Indexed**: Yes (`idx_ipos_segment`)
- **Status**: Correctly defined

### API Route Filtering (✅ CORRECT)

**File**: `web/app/api/ipos/route.ts:282-305`

```typescript
const filters: {
  status?: string[];
  segment?: string[];  // ← Segment filter included
  offeringType?: string[];
  // ...
} = {
  status: validatedParams.status,
  segment: validatedParams.segment,  // ← Passed to repository
  offeringType: validatedParams.offeringType,
  // ...
};

const result = await ipoRepository.findAll(filters);
```

- **Validation**: Zod schema validates `segment` as `['MAINBOARD', 'SME']`
- **Array Support**: Handles both single and multiple segment values
- **Passing**: Correctly passes segment filter to repository
- **Status**: Correctly implemented

### Repository Layer Filtering (✅ CORRECT)

**File**: `web/lib/repositories/ipo-repository.ts:97-103`

```typescript
if (segment) {
  if (Array.isArray(segment)) {
    conditions.push(inArray(ipos.segment, segment as (typeof segmentEnum.enumValues)[number][]));
  } else {
    conditions.push(eq(ipos.segment, segment as (typeof segmentEnum.enumValues)[number]));
  }
}
```

- **Single Value**: Uses `eq(ipos.segment, 'MAINBOARD')` for exact match
- **Multiple Values**: Uses `inArray(ipos.segment, ['MAINBOARD'])` for multiple
- **Type Safety**: Cast to enum values for type checking
- **Status**: Correctly implemented

### Service Layer Calls (✅ CORRECT)

**File**: `web/lib/services/mainboard-landing-service.ts:142, 200, 227, 254, 305, 358, 397`

All service functions call API with correct filters:

```typescript
// Summary metrics
const response = await getIPOs({ segment: 'MAINBOARD', offeringType: 'IPO', limit: 1000 });

// Current IPOs
const response = await getIPOs({
  segment: 'MAINBOARD',
  offeringType: 'IPO',
  status: 'OPEN',
  limit: CONTENT_LIMIT,
});

// Similar for upcoming, listed, performance, subscription, detailed list
```

- **Segment Filter**: Every query specifies `segment: 'MAINBOARD'`
- **Offering Type Filter**: All queries also filter by `offeringType: 'IPO'`
- **Consistency**: All 7 service functions use consistent filtering
- **Status**: Correctly implemented

---

## Possible Root Causes of False Positive

### 1. **Navigation Header Text** (Most Likely)

The mainboard-ipos page includes navigation dropdown:

```html
<div class="group relative">
  <a href="/sme-ipos">
    <span>SME IPOs</span>  <!-- This text would be found by simple search -->
  </a>
</div>
```

**Impact**: Text search for "SME" would match navigation elements, not IPO data.

### 2. **Stale Redis Cache**

If the test was run immediately after deploying segment filtering:
- Cache may have contained pre-migration data
- Cache TTL: 5 minutes (300 seconds)
- Cache keys: `mainboard:landing:*`

**Impact**: First page load might show cached unfiltered data.

### 3. **Test Timing**

Screenshot timestamp: `2025-10-19T17-32-45-239Z`
If this was during deployment/migration:
- Database migration in progress
- API restarting mid-request
- Cache invalidation incomplete

**Impact**: Transient issue during deployment.

---

## Verification Steps Performed

1. ✅ **Code Review**: All filtering code verified correct
2. ✅ **API Testing**: Live endpoints return only correct segment
3. ✅ **Schema Validation**: Database column correctly defined and indexed
4. ✅ **Service Flow**: End-to-end data flow traces correctly through all layers
5. ⏳ **Cache Clearing**: Could not test (redis-cli not available in dev environment)
6. ⏳ **Page Render Test**: Could not complete (server stopped for investigation)

---

## Recommendations

### Immediate Actions (1-2 hours)

1. **Clear Redis Cache**:
   ```bash
   redis-cli -h <redis-host> -p 6379 FLUSHDB
   # Or programmatically:
   # node -e "const Redis = require('ioredis'); const r = new Redis(); r.flushdb();"
   ```

2. **Re-test with Focused Methodology**:
   - Navigate to `/mainboard-ipos`
   - Search page content for actual IPO data, NOT navigation text
   - Specifically check the 6 content sections:
     - Current IPOs
     - Upcoming IPOs
     - Recently Listed IPOs
     - Performance Highlights
     - Subscription Status
     - Detailed Table
   - Verify each IPO card shows `segment: MAINBOARD` in the data

3. **Use Browser DevTools**:
   ```javascript
   // In browser console, check actual data:
   fetch('/api/ipos?segment=MAINBOARD&offeringType=IPO&status=OPEN&limit=10')
     .then(r => r.json())
     .then(d => {
       const smeIpos = d.data.filter(ipo => ipo.segment === 'SME');
       console.log('SME contamination count:', smeIpos.length);
       console.log('SME IPOs:', smeIpos);
     });
   ```

### Medium-Term Actions (1-2 days)

1. **Add Automated Test**:
   ```typescript
   // tests/e2e/mainboard-ipos.spec.ts
   test('Mainboard page shows only MAINBOARD IPOs', async ({ page }) => {
     await page.goto('/mainboard-ipos');
     await page.waitForLoadState('networkidle');

     // Get all IPO cards data
     const ipoData = await page.evaluate(() => {
       // Extract IPO data from page
       const cards = document.querySelectorAll('[data-ipo-id]');
       return Array.from(cards).map(card => ({
         id: card.getAttribute('data-ipo-id'),
         segment: card.getAttribute('data-segment'),
       }));
     });

     // Verify NO SME IPOs
     const smeCount = ipoData.filter(ipo => ipo.segment === 'SME').length;
     expect(smeCount).toBe(0);
   });
   ```

2. **Add Server-Side Assertion**:
   ```typescript
   // In mainboard-landing-service.ts, add runtime check:
   export async function getMainboardCurrentIPOs(): Promise<IPO[]> {
     return getCachedOrFetch(CACHE_KEYS.CURRENT_IPOS, async () => {
       const response = await getIPOs({ segment: 'MAINBOARD', offeringType: 'IPO', status: 'OPEN', limit: CONTENT_LIMIT });

       // Runtime assertion (development only)
       if (process.env.NODE_ENV === 'development') {
         const smeContamination = response.data.filter(ipo => ipo.segment === 'SME');
         if (smeContamination.length > 0) {
           console.error('🚨 SME DATA CONTAMINATION DETECTED:', smeContamination);
           throw new Error(`ISS-013: ${smeContamination.length} SME IPOs found in Mainboard response`);
         }
       }

       return response.data.sort(/* ... */);
     });
   }
   ```

3. **Enhance Test Documentation**:
   - Document exact steps to reproduce
   - Specify what constitutes "SME text found" (data vs. navigation)
   - Include screenshots showing actual IPO cards, not just page search

---

## Conclusion

**Current Status**: ✅ **No Code Defects Found**

All filtering mechanisms are correctly implemented:
- ✅ Database schema defines segment column correctly
- ✅ API route validates and passes segment filter
- ✅ Repository layer filters by segment using Drizzle ORM
- ✅ Service layer consistently applies MAINBOARD filter
- ✅ Live API testing confirms only MAINBOARD IPOs returned

**Likely Cause of Issue**: False positive from:
1. Text search finding "SME" in navigation headers (not IPO data)
2. Stale Redis cache (pre-migration data)
3. Deployment timing (test during migration)

**Recommended Action**:
1. Clear Redis cache
2. Re-test with focused methodology (exclude navigation text)
3. If no SME IPOs found in actual content sections, close ISS-013 as false positive
4. If SME IPOs ARE found, provide specific examples (company names, IDs) for targeted debugging

**Estimated Resolution Time**: 30 minutes (cache clear + retest)

---

## Investigation Evidence

### API Response Samples

**Mainboard Query Response**:
```json
{
  "data": [
    {
      "id": "0d22054c-8f3a-4b8c-b346-e599d1096c26",
      "companyName": "ONIX SOLAR ENERGY LTD",
      "segment": "MAINBOARD",  // ← Correct
      "offeringType": "IPO",
      "status": "UPCOMING"
    },
    {
      "id": "0c52ceac-6490-424e-8fdb-8241f4c4dc7a",
      "companyName": "Cool Caps Industries Limited",
      "segment": "MAINBOARD",  // ← Correct
      "offeringType": "IPO",
      "status": "OPEN"
    }
  ]
}
```

**SME Query Response**:
```json
{
  "data": [
    {
      "id": "6369939e-e0c6-453b-bca3-e2e85ade4d80",
      "companyName": "Shipwaves Online Ltd. IPO",
      "segment": "SME",  // ← Correctly separated
      "offeringType": "IPO",
      "status": "UPCOMING"
    },
    {
      "id": "cc01d0b9-f627-4043-8414-c6f5cf53291c",
      "companyName": "Riddhi Display Equipments Ltd. IPO",
      "segment": "SME",  // ← Correctly separated
      "offeringType": "IPO",
      "status": "UPCOMING"
    }
  ]
}
```

### Code Trace Path

```
Page Load → mainboard-ipos/page.tsx
  ↓
Service → getMainboardCurrentIPOs()
  ↓
API Client → getIPOs({ segment: 'MAINBOARD', offeringType: 'IPO', status: 'OPEN', limit: 6 })
  ↓
API Route → GET /api/ipos?segment=MAINBOARD&offeringType=IPO&status=OPEN&limit=6
  ↓
Repository → findAll({ segment: ['MAINBOARD'], offeringType: ['IPO'], status: ['OPEN'], limit: 6 })
  ↓
Database Query → SELECT * FROM ipos WHERE segment = 'MAINBOARD' AND offering_type = 'IPO' AND status = 'OPEN' LIMIT 6
  ↓
Result → All IPOs have segment='MAINBOARD' ✅
```

---

**Report Generated**: 2025-10-20
**Next Steps**: Cache clearance and focused re-testing required before issue can be closed
