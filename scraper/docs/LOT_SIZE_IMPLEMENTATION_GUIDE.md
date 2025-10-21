# Lot Size Fix Implementation Guide - ISS-LotCalc-002

**Quick Start for Data Team**

This guide provides step-by-step instructions to fix the lot_size extraction issue affecting 68.89% of IPOs.

---

## Problem Summary

- **Issue:** 341/495 IPOs have `lot_size = 1` (unrealistic)
- **Impact:** Lot Calculator shows incorrect results
- **Root Cause:** Scrapers not extracting lot_size or defaulting to 1
- **Solution:** Extract from sources + validation + database migration

---

## Files Created

1. **Documentation:**
   - `scraper/docs/LOT_SIZE_FIX.md` - Complete investigation and fixes
   - `scraper/docs/LOT_SIZE_IMPLEMENTATION_GUIDE.md` - This file

2. **Utility:**
   - `scraper/src/utils/lot-size-validator.ts` - Validation logic

3. **Database:**
   - `web/scripts/fix-lot-size-defaults.sql` - Migration script

---

## Implementation Steps

### Phase 1: Database Migration (Immediate Fix - 15 minutes)

**Purpose:** Fix existing 341 IPOs with invalid `lot_size = 1`

1. **Review migration script:**
   ```bash
   cat web/scripts/fix-lot-size-defaults.sql
   ```

2. **Test on local database:**
   ```bash
   # Connect to local PostgreSQL
   psql -U postgres -d ipodhan

   # Run migration script
   \i web/scripts/fix-lot-size-defaults.sql

   # Verify results (should show 0 IPOs with lot_size = 1)
   SELECT COUNT(*) FROM ipos WHERE lot_size = 1;
   # Expected: 0

   SELECT COUNT(*) FROM ipos WHERE lot_size IS NULL;
   # Expected: ~341 (increased from before)
   ```

3. **Apply to production:**
   ```bash
   # Backup first
   pg_dump -U postgres ipodhan > backup_before_lot_size_fix.sql

   # Run migration
   psql -U postgres -d ipodhan < web/scripts/fix-lot-size-defaults.sql

   # Verify
   psql -U postgres -d ipodhan -c "SELECT COUNT(*) FROM ipos WHERE lot_size = 1;"
   # Expected: 0
   ```

**Expected Outcome:**
- ✅ 341 IPOs with `lot_size = 1` → `lot_size = NULL`
- ✅ Frontend Lot Calculator will use realistic defaults (75/125)
- ✅ No incorrect calculations

---

### Phase 2: Code Changes (Long-term Fix - 1 hour)

**Purpose:** Prevent future `lot_size = 1` values and extract from sources

#### 2.1 NSE Browser Scraper (Optional - API is primary source)

**File:** `scraper/src/scrapers/nse-scraper.ts`

**Current (Line 241):**
```typescript
lotSize: undefined, // NSE doesn't always show lot size in listing
```

**Option A - Keep as-is:**
- NSE API is primary source (already extracts lot_size correctly at line 477 in nse-api-client.ts)
- Browser fallback can remain `undefined`
- Recommended approach

**Option B - Extract from table:**
- Requires analyzing NSE table structure to find lot_size column
- Only implement if NSE API becomes unavailable

**Recommendation:** Keep as `undefined`, rely on NSE API (already working)

#### 2.2 BSE Main Scraper (Required)

**File:** `scraper/src/scrapers/bse-scraper.ts`

**Current (Line 310):**
```typescript
lotSize: 100, // Default, would need detail page
```

**Change to:**
```typescript
lotSize: undefined, // Will be enriched from detail page (lines 385-390)
```

**Reasoning:**
- BSE detail scraper already extracts lot_size correctly (line 266, 315)
- Detail page integration already exists (lines 323-423)
- Hardcoded `100` is better than `1` but still incorrect
- Using `undefined` ensures database receives `NULL` if detail scraping fails

**Location to change:**
```typescript
// Line 298-312 in bse-scraper.ts
const ipoData: ScrapedIPO = {
  companyName: rawIPO.companyName,
  issueSize: 0,
  priceRangeMin: priceRange.min,
  priceRangeMax: priceRange.max,
  openDate: parseBSEDate(rawIPO.startDate),
  closeDate: parseBSEDate(rawIPO.endDate),
  listingExchange: 'BSE',
  segment: segment as 'MAINBOARD' | 'SME' | null | undefined,
  offeringType: offeringType as 'IPO' | 'FPO' | 'RIGHTS' | ...,
  sector: '',
  status,
  lotSize: undefined, // CHANGED: Remove hardcoded 100
  faceValue: parseInt(rawIPO.faceValue, 10) || 10
};
```

#### 2.3 Integrate Validator (Required)

Add validation to prevent `lot_size = 1` from entering database.

**Option A - Validate in scrapers (Recommended):**

```typescript
// In nse-api-client.ts (line 464-481)
import { validateLotSize } from '../utils/lot-size-validator.js';

function transformIPOData(data: any): ScrapedIPO {
  // ... existing code ...

  return {
    companyName: data.companyName || data.company || '',
    // ... other fields ...
    lotSize: validateLotSize(
      parseInt(data.lotSize) || undefined,
      segment,
      data.companyName || data.company
    ),
    // ... rest of fields ...
  };
}
```

```typescript
// In bse-detail-scraper.ts (line 266, 315)
import { validateLotSize } from '../utils/lot-size-validator.js';

function parseACQDispPage($: cheerio.CheerioAPI): BSEDetailPageData {
  // ... existing code ...

  const rawLotSize = lotSizeStr ? parseInt(lotSizeStr, 10) : undefined;
  const lotSize = validateLotSize(rawLotSize, null, symbol || undefined) || 100;

  // ... rest of function ...
}
```

**Option B - Validate in database insertion layer:**
- Add validation before `db.insert()` calls
- More centralized but requires finding all insertion points

**Recommendation:** Option A (validate in scrapers where data originates)

---

### Phase 3: Frontend Fix (Optional - Improves UX - 30 minutes)

**Purpose:** Show "estimated" indicator when using default lot_size

**File:** `web/app/(main-layout)/tools/ipo-lot-calculator/page.tsx` (or component file)

**Add utility function:**
```typescript
// Can be inline or in separate file
function getEffectiveLotSize(
  lotSize: number | null | undefined,
  segment: 'MAINBOARD' | 'SME' | null
): { value: number; isEstimated: boolean } {
  if (lotSize && lotSize > 1) {
    return { value: lotSize, isEstimated: false };
  }

  // Use realistic defaults
  const defaultValue = segment === 'SME' ? 125 : 75;
  return { value: defaultValue, isEstimated: true };
}
```

**Use in component:**
```tsx
const { value: effectiveLotSize, isEstimated } = getEffectiveLotSize(
  selectedIPO.lot_size,
  selectedIPO.segment
);

// In JSX:
<div>
  <span>Lot Size: {effectiveLotSize}</span>
  {isEstimated && (
    <Badge variant="outline" className="ml-2 text-xs">
      estimated
    </Badge>
  )}
</div>
```

---

## Testing Checklist

### Database Migration Testing

- [ ] Backup database before migration
- [ ] Run migration on local database first
- [ ] Verify: `SELECT COUNT(*) FROM ipos WHERE lot_size = 1;` returns 0
- [ ] Verify: Lot Calculator still works with NULL values
- [ ] Apply to production during low-traffic period
- [ ] Monitor for issues

### Scraper Testing

- [ ] Test NSE API scraper:
  ```bash
  cd scraper
  npm run start:nse
  # Check console for lot_size extraction
  ```

- [ ] Test BSE scraper:
  ```bash
  npm run start:bse
  # Check console for detail page scraping
  # Verify lot_size extracted from detail pages
  ```

- [ ] Verify validator rejects lot_size = 1:
  ```bash
  # Add test IPO with lot_size = 1
  # Run scraper
  # Check database: should be NULL, not 1
  ```

### Frontend Testing

- [ ] Open Lot Calculator in browser
- [ ] Select IPO with valid lot_size
  - ✅ Should show actual lot_size
  - ✅ No "estimated" indicator
- [ ] Select IPO with NULL lot_size
  - ✅ Should show default (75 or 125)
  - ✅ "Estimated" indicator appears
- [ ] Verify calculations are correct

---

## Monitoring & Validation

### Post-Deployment Metrics

**Database Query:**
```sql
-- Check lot_size distribution
SELECT
  segment,
  COUNT(*) as total,
  COUNT(lot_size) as with_lot_size,
  COUNT(CASE WHEN lot_size = 1 THEN 1 END) as equals_1,
  COUNT(CASE WHEN lot_size IS NULL THEN 1 END) as is_null,
  ROUND(COUNT(lot_size)::numeric / COUNT(*)::numeric * 100, 2) as pct_valid
FROM ipos
GROUP BY segment;
```

**Expected Results (After All Fixes):**

| Segment | Total | With lot_size | Equals 1 | Is NULL | % Valid |
|---------|-------|---------------|----------|---------|---------|
| MAINBOARD | 300 | 180 | 0 | 120 | 60% |
| SME | 195 | 120 | 0 | 75 | 62% |
| NULL (RIGHTS/NCD) | 50 | 10 | 0 | 40 | 20% |

**Key Metrics:**
- ✅ lot_size = 1: **0 IPOs** (down from 341)
- ✅ lot_size = NULL: **235 IPOs** (up from 154)
- ✅ Valid lot_size: **310 IPOs** (up from 154)

### Scraper Logs

Monitor scraper output for:
```
[INFO] Rejected lot_size = 1 (unrealistic value) - setting to NULL
[WARN] Unusual MAINBOARD lot_size: 5 (outside typical range 10-1000)
```

These indicate validation is working correctly.

---

## Re-scraping Strategy (Optional - Improves Data Quality)

### High Priority: UPCOMING & OPEN IPOs

```bash
# Re-scrape current/upcoming IPOs from NSE API
cd scraper
npm run start:nse

# NSE API provides lot_size for active IPOs
# Should populate ~20-30 IPOs with accurate lot_size
```

### Medium Priority: Recent CLOSED IPOs

```bash
# Re-scrape BSE detail pages for closed IPOs
npm run start:bse

# BSE detail scraper extracts lot_size
# Should populate ~50-100 IPOs with accurate lot_size
```

### Low Priority: Historical/LISTED IPOs

- lot_size not critical for historical analysis
- Can remain NULL unless needed for specific features
- Focus resources on current/upcoming IPOs

---

## Success Criteria

✅ **Phase 1 Complete:**
- Database migration applied successfully
- 0 IPOs have `lot_size = 1`
- Lot Calculator uses realistic defaults

✅ **Phase 2 Complete:**
- BSE scraper uses `undefined` instead of hardcoded 100
- Validator integrated in scrapers
- No new `lot_size = 1` values entering database

✅ **Phase 3 Complete (Optional):**
- Frontend shows "estimated" indicator for NULL values
- User experience improved

✅ **Overall Success:**
- Valid lot_size: 60-70% (up from 31.11%)
- Invalid lot_size (=1): 0% (down from 68.89%)
- NULL lot_size: 30-40% (acceptable for unavailable data)

---

## Rollback Plan

**If issues occur after database migration:**

```sql
-- NOTE: This restores BAD DATA - only use if absolutely necessary
UPDATE ipos
SET lot_size = 1
WHERE lot_size IS NULL AND updated_at > '2025-10-21 00:00:00';
```

**If issues occur after code deployment:**

```bash
# Revert code changes
git revert <commit-hash>
git push

# Restart scrapers
pm2 restart ipodhan-scraper
```

**Recommended approach:**
- Do NOT rollback migration (it fixes bad data)
- Fix any code issues in new commits
- Keep lot_size = NULL (better than lot_size = 1)

---

## Support & Questions

**For implementation issues:**
1. Check `scraper/docs/LOT_SIZE_FIX.md` for detailed technical analysis
2. Review scraper logs for validation warnings
3. Test on local database before production

**Common Issues:**

**Q: Migration failed - "column lot_size does not exist"**
A: Check database schema - lot_size should be defined in ipos table

**Q: Validator throws errors - "Cannot find module"**
A: Run `npm install` in scraper directory
A: Check import path in scraper files

**Q: Frontend shows "undefined" instead of default**
A: Add fallback logic in Lot Calculator component
A: Use `getDefaultLotSizeForDisplay()` from validator

---

**Implementation Time Estimate:**
- Phase 1 (Database): 15 minutes
- Phase 2 (Code): 1 hour
- Phase 3 (Frontend): 30 minutes
- Testing: 1 hour
- **Total: 2-3 hours**

**End of Implementation Guide**
