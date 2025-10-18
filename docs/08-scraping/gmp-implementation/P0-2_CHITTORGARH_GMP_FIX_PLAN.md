# P0-2: Chittorgarh GMP Fix - Detailed Plan

**Issue**: 0 GMP records created despite Chittorgarh processing 303 IPOs successfully

---

## Root Cause Analysis

### Investigation Timeline
1. ✅ Verified scraper logs ARE being captured (P0-4 was false alarm)
2. ✅ Found Chittorgarh scraper processed 303 IPOs (100% success rate)
3. ✅ Discovered GMP data explicitly set to `undefined` in scraper
4. ✅ Located comment: "GMP data NOT available on list API - requires detail page scraping"
5. ✅ Confirmed GMPRepository exists with `create()` method
6. ✅ Found data-persister has NO `createGMPRecord()` function

### Root Causes (3-part problem)
1. **Chittorgarh API Limitation** (`chittorgarh-scraper.ts:8-9`)
   - The list API endpoint doesn't include GMP data
   - Need to scrape individual IPO detail pages

2. **Missing Data Persister Function** (`data-persister.ts`)
   - No `createGMPRecord()` function existed
   - ✅ **FIXED**: Added function (lines 293-332)

3. **No Orchestrator Integration** (`chittorgarh-orchestrator.ts`)
   - Orchestrator doesn't create GMP records even if data is available
   - Needs update to call `createGMPRecord()`

---

## Implementation Plan

### Step 1: ✅ Add createGMPRecord() Function (COMPLETED)
**File**: `scraper/src/services/data-persister.ts`

**Changes Made**:
```typescript
// Added import
import { GMPRepository, GMPRecordInsert } from '@ipodhan/shared';

// Added function (lines 293-332)
export async function createGMPRecord(
  gmpRepository: GMPRepository,
  ipoId: string,
  gmp: number,
  timestamp: Date = new Date()
): Promise<string>
```

**Features**:
- ✅ Retry logic with exponential backoff
- ✅ PostgreSQL error code detection
- ✅ Structured logging (debug + info)
- ✅ Cache invalidation (handled by GMPRepository)
- ✅ Duration tracking

---

### Step 2: Implement Chittorgarh Detail Page GMP Scraping (IN PROGRESS)
**File**: `scraper/src/scrapers/chittorgarh-scraper.ts`

**Current State** (lines 369-373):
```typescript
// NOTE: GMP data NOT available on list API
// Would require scraping individual IPO detail pages
gmp: undefined,
gmpPercentage: undefined,
gmpUpdatedAt: undefined,
```

**Implementation Options**:

#### Option A: Scrape Detail Pages for ALL IPOs (Comprehensive)
**Pros**:
- Complete GMP data for all IPOs
- Historical GMP tracking

**Cons**:
- ~303 additional HTTP requests per scraper run
- Slower execution (40s → 2-5 minutes)
- Higher risk of rate limiting

**Approach**:
1. Extract slug from Company HTML anchor: `<a href="/ipo/slug/id/">Company</a>`
2. Construct detail page URL: `https://chittorgarh.com/ipo/slug/id/`
3. Scrape GMP data from detail page HTML
4. Parse GMP value and update timestamp
5. Return GMP data with IPO record

#### Option B: Scrape Detail Pages for OPEN/UPCOMING Only (Targeted)
**Pros**:
- Faster execution (~10-20 additional requests)
- Focuses on active IPOs where GMP matters
- Lower rate limiting risk

**Cons**:
- No historical GMP for LISTED/CLOSED IPOs
- May need separate backfill job

**Approach**:
1. Filter IPOs by status (`OPEN` or `UPCOMING`)
2. Scrape detail pages only for those IPOs
3. Skip detail page for `LISTED`/`CLOSED` IPOs

#### Option C: Separate GMP-Only Scraper (Modular)
**Pros**:
- Clean separation of concerns
- Can run independently on different schedule
- Won't slow down main IPO data scraper

**Cons**:
- More complex architecture
- Additional orchestrator needed

**Approach**:
1. Create `chittorgarh-gmp-scraper.ts`
2. Fetch IPO list from database (not API)
3. Scrape GMP from detail pages
4. Create GMP records directly

---

### Step 3: Update Chittorgarh Orchestrator
**File**: `scraper/src/scrapers/chittorgarh-orchestrator.ts`

**Required Changes**:
1. Import `GMPRepository` and `createGMPRecord`
2. Initialize `GMPRepository` in orchestrator
3. After upserting IPO, check if GMP data exists
4. If GMP data exists, call `createGMPRecord()`
5. Track GMP records created in scraper result

**Code Example**:
```typescript
// After line 87 (after upsertIPO)
if (validatedIPO.gmp && validatedIPO.gmp > 0) {
  const gmpRepository = new GMPRepository(db, redis);
  await createGMPRecord(
    gmpRepository,
    ipoId,
    validatedIPO.gmp,
    validatedIPO.gmpUpdatedAt || new Date()
  );
  logger.debug({ ipoId, gmp: validatedIPO.gmp }, 'Created GMP record');
}
```

---

## Recommended Approach

**Choice**: **Option B - Scrape Detail Pages for OPEN/UPCOMING Only**

**Reasoning**:
1. **Performance**: Balances data coverage with execution speed
2. **Relevance**: GMP is most valuable for active IPOs
3. **Incremental**: Can add backfill scraper later
4. **Risk**: Lower rate limiting risk

**Implementation Steps**:
1. Add `scrapeChittorgarhGMP()` helper function
2. Call helper only for OPEN/UPCOMING IPOs
3. Parse GMP from detail page HTML
4. Update orchestrator to create GMP records

---

## Chittorgarh Detail Page Structure (Research Needed)

**URL Pattern**: `https://chittorgarh.com/ipo/{slug}/{id}/`

**Example**: `https://chittorgarh.com/ipo/canara-hsbc-life-insurance-company/12345/`

**HTML Selectors to Find** (need manual inspection):
- GMP value container
- GMP update timestamp
- Estimated listing price (optional)
- Expected listing gain % (optional)

---

## Success Criteria

After implementing all steps:

### Database Verification
```sql
-- Should have GMP records for OPEN/UPCOMING IPOs
SELECT COUNT(*) FROM gmp_records; -- Expected: > 0 (currently 0)

-- GMP coverage by status
SELECT
  i.status,
  COUNT(DISTINCT g.ipo_id) as ipos_with_gmp,
  COUNT(*) as total_gmp_records
FROM ipos i
LEFT JOIN gmp_records g ON i.id = g.ipo_id
WHERE i.status IN ('OPEN', 'UPCOMING')
GROUP BY i.status;

-- Expected:
-- OPEN: 20-30 IPOs with GMP (out of 37)
-- UPCOMING: 10-20 IPOs with GMP (out of 28)
```

### Scraper Logs
```sql
-- Scraper should show GMP records created
SELECT source, records_processed, duration_ms, created_at
FROM scraper_logs
WHERE source = 'CHITTORGARH'
ORDER BY created_at DESC
LIMIT 1;

-- Expected: records_processed >= 303 (IPO count)
```

---

## Next Immediate Action

**Inspect Chittorgarh detail page HTML** to determine:
1. Exact URL pattern (slug/id format)
2. GMP value selector
3. GMP update timestamp selector
4. Page structure (static HTML vs React/dynamic)

**Command**:
```bash
# Fetch a sample detail page
curl "https://chittorgarh.com/ipo/canara-hsbc-life-insurance-company/12345/" > sample_detail_page.html

# Or inspect manually in browser
```

Once selectors are identified, implement `scrapeChittorgarhGMP()` function.

---

## Estimated Time

- ✅ Step 1 (createGMPRecord): **DONE** (30 minutes)
- ⏳ Step 2a (Inspect detail page): **15 minutes**
- ⏳ Step 2b (Implement GMP scraping): **1-2 hours**
- ⏳ Step 3 (Update orchestrator): **30 minutes**
- ⏳ Testing & Verification: **30 minutes**

**Total**: 2.5-3.5 hours remaining

---

## Risks & Mitigation

| Risk | Mitigation |
|------|------------|
| Rate limiting from Chittorgarh | Add delay between requests (500ms), respect robots.txt |
| Detail page HTML structure changed | Use multiple fallback selectors, log failures |
| GMP data not available for some IPOs | Skip gracefully, log warning, continue processing |
| Performance degradation | Monitor execution time, set timeout per detail page (5s) |

---

**Status**: Step 1 ✅ Complete, Step 2 ⏳ In Progress
**Next**: Inspect Chittorgarh detail page HTML structure
