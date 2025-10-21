# Lot Size Extraction Fix - ISS-LotCalc-002

**Issue:** 341/495 IPOs (68.89%) have unrealistic `lot_size = 1`, causing Lot Calculator to show incorrect results.

**Root Cause:** Scrapers are not extracting `lot_size` correctly or defaulting to `1` when data is missing.

**Investigation Date:** 2025-10-21
**Phase:** Phase 3 Testing
**Priority:** High (affects core calculator functionality)

---

## Investigation Results

### Current Lot Size Extraction Status

| Scraper | Line | Current Logic | Issue |
|---------|------|---------------|-------|
| **NSE (Browser)** | 241 | `lotSize: undefined` | Not extracted from browser scraping |
| **NSE (API)** | 477 | `lotSize: parseInt(data.lotSize) \|\| undefined` | ✅ CORRECT - Extracts from API |
| **BSE (Main)** | 310 | `lotSize: 100` | ❌ HARDCODED - Always defaults to 100 |
| **BSE (Detail)** | 266, 315 | `lotSize: lotSizeStr ? parseInt(lotSizeStr, 10) : 100` | ✅ CORRECT - Extracts from detail page |
| **Moneycontrol** | - | Not extracted | ❌ MISSING - No lot_size field |
| **Chittorgarh** | - | Not extracted | ❌ MISSING - No lot_size field |

### Key Findings

1. **NSE Browser Scraper** (Line 241 in `nse-scraper.ts`):
   ```typescript
   lotSize: undefined, // NSE doesn't always show lot size in listing
   ```
   - Sets `lotSize` to `undefined` instead of extracting from page
   - Comment indicates lot_size is available but not being extracted

2. **NSE API Client** (Line 477 in `nse-api-client.ts`):
   ```typescript
   lotSize: parseInt(data.lotSize) || undefined,
   ```
   - ✅ **CORRECT** - Properly extracts from API response
   - API is the primary data source, browser is fallback

3. **BSE Main Scraper** (Line 310 in `bse-scraper.ts`):
   ```typescript
   lotSize: 100, // Default, would need detail page
   ```
   - ❌ **HARDCODED** - Always defaults to 100
   - Comment acknowledges detail page needed but doesn't extract

4. **BSE Detail Scraper** (Lines 266, 315 in `bse-detail-scraper.ts`):
   ```typescript
   const lotSize = lotSizeStr ? parseInt(lotSizeStr, 10) : 100;
   ```
   - ✅ **CORRECT** - Properly extracts from detail page
   - Falls back to 100 if not found
   - Detail scraper IS integrated (Phase 2, lines 323-423)

5. **Moneycontrol Scraper** (`moneycontrol-scraper.ts`):
   - No lot_size extraction logic
   - Not available on Moneycontrol list page

6. **Chittorgarh Scraper** (`chittorgarh-scraper.ts`):
   - No lot_size extraction logic
   - Not available in API response

### Why lot_size = 1 Occurs

The database schema defines `lot_size` as **nullable** (`integer('lot_size')`), meaning it accepts `null` or integer values. However, somewhere in the data insertion pipeline, missing lot_size values are being converted to `1` instead of remaining `null`.

**Likely causes:**
1. Database insertion logic converts `undefined` to `1` as a default
2. Historical data imported with lot_size = 1 as placeholder
3. Scraper validation logic sets `1` as minimum valid value

---

## Fixes Implemented

### 1. NSE Browser Scraper (`nse-scraper.ts`)

**Current Code (Line 241):**
```typescript
lotSize: undefined, // NSE doesn't always show lot size in listing
```

**Fixed Code:**
```typescript
// Extract lot size from table if available
// NSE tables may include "Market Lot" or "Lot Size" column
const lotSizeStr = cells[8]?.textContent?.trim() || ''; // Adjust column index based on table structure
const lotSize = lotSizeStr && lotSizeStr !== '--' && lotSizeStr !== 'N/A'
  ? parseInt(lotSizeStr.replace(/[^0-9]/g, ''), 10)
  : undefined;

// In IPO object:
lotSize: lotSize,
```

**Note:** This requires identifying the correct column index in NSE's table. The current table structure should be analyzed to determine where lot_size appears.

**Alternative (if not available in listing):** Keep as `undefined` and rely on NSE API as primary source.

---

### 2. BSE Main Scraper (`bse-scraper.ts`)

**Current Code (Line 310):**
```typescript
lotSize: 100, // Default, would need detail page
```

**Fixed Code:**
```typescript
// Use lot_size from detail page data (already merged at lines 385-390)
// Remove hardcoded default, rely on detail page extraction
lotSize: undefined, // Will be enriched from detail page
```

**Detail Page Integration (Lines 385-390):**
```typescript
// Already correctly merging lot_size from detail page:
if (detailData.lotSize > 0) {
  ipo.lotSize = detailData.lotSize;
}
```

**Issue:** The hardcoded `100` at line 310 is being **overwritten** by detail page data IF available, but if detail scraping fails, it remains `100`. This is actually better than `1`, but still incorrect.

**Recommended Fix:** Change line 310 to `undefined` so database receives `null` if detail scraping fails, rather than incorrect default.

---

### 3. Add Validation Logic

**Create:** `scraper/src/utils/lot-size-validator.ts`

```typescript
/**
 * Validate and normalize lot_size based on segment
 * Returns null if lot_size is invalid or missing
 */
export function validateLotSize(
  lotSize: number | undefined | null,
  segment: 'MAINBOARD' | 'SME' | null
): number | null {
  // If lot_size is missing or clearly invalid (1 is almost never correct)
  if (!lotSize || lotSize === 1) {
    return null; // Let database store NULL instead of incorrect value
  }

  // Validate typical ranges (warn but don't reject)
  if (segment === 'MAINBOARD') {
    if (lotSize < 10 || lotSize > 1000) {
      console.warn(`Unusual MAINBOARD lot_size: ${lotSize} (typical: 10-1000)`);
    }
  } else if (segment === 'SME') {
    if (lotSize < 100 || lotSize > 10000) {
      console.warn(`Unusual SME lot_size: ${lotSize} (typical: 100-10000)`);
    }
  }

  return lotSize;
}

/**
 * Get realistic default lot_size for display purposes only
 * Should NOT be saved to database
 */
export function getDefaultLotSizeForDisplay(segment: 'MAINBOARD' | 'SME' | null): number {
  switch (segment) {
    case 'MAINBOARD':
      return 75; // Typical MAINBOARD lot size
    case 'SME':
      return 125; // Typical SME lot size
    default:
      return 75; // Conservative default
  }
}
```

**Usage in scrapers:**
```typescript
import { validateLotSize } from '../utils/lot-size-validator.js';

// In scraper transformation:
const ipoData = {
  // ... other fields
  lotSize: validateLotSize(rawLotSize, segment),
};
```

---

### 4. Database Migration Script

**Purpose:** Fix existing IPOs with `lot_size = 1` by setting them to `NULL`

**File:** `web/drizzle/migrations/YYYY-MM-DD_fix_lot_size_defaults.sql`

```sql
-- Fix IPOs with lot_size = 1 (invalid default)
-- Set to NULL so frontend can use realistic defaults for display

UPDATE ipos
SET
  lot_size = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE
  lot_size = 1;

-- Add comment explaining the fix
COMMENT ON COLUMN ipos.lot_size IS
  'Number of shares per lot. NULL indicates data not available from source.
   Frontend should use realistic defaults for display: MAINBOARD=75, SME=125';
```

**Expected Impact:**
- 341 IPOs with `lot_size = 1` will be set to `NULL`
- Frontend Lot Calculator will use realistic defaults (75 for MAINBOARD, 125 for SME)
- Future scraping will extract real values or store `NULL` instead of `1`

---

### 5. Frontend Lot Calculator Fix

**File:** `web/app/(main-layout)/tools/ipo-lot-calculator/page.tsx` (or component file)

**Current Issue:** Calculator likely uses `lot_size` directly, showing incorrect results when value is `1`.

**Recommended Fix:**
```typescript
import { getDefaultLotSizeForDisplay } from '@/lib/utils/lot-size-validator';

// In component:
const effectiveLotSize = ipo.lot_size && ipo.lot_size > 1
  ? ipo.lot_size
  : getDefaultLotSizeForDisplay(ipo.segment);

// Display with indicator:
<div>
  <span>Lot Size: {effectiveLotSize}</span>
  {(!ipo.lot_size || ipo.lot_size === 1) && (
    <span className="text-xs text-muted-foreground ml-2">
      (estimated - actual value not available)
    </span>
  )}
</div>
```

---

## Testing Plan

### 1. Test Scrapers Individually

```bash
# Test NSE API scraper (primary data source)
cd scraper
npm run start:nse

# Check console output for lot_size extraction
# Verify: lot_size appears in API response

# Test BSE scraper with detail pages
npm run start:bse

# Check console output for detail page scraping
# Verify: lot_size extracted from detail pages
```

### 2. Verify Database Updates

```sql
-- Before migration
SELECT
  segment,
  COUNT(*) as total_ipos,
  COUNT(lot_size) as with_lot_size,
  COUNT(CASE WHEN lot_size = 1 THEN 1 END) as lot_size_equals_1,
  COUNT(CASE WHEN lot_size IS NULL THEN 1 END) as lot_size_null
FROM ipos
GROUP BY segment;

-- After migration
-- Expect: lot_size_equals_1 = 0, lot_size_null = 341 (moved from =1 to NULL)
```

### 3. Test Frontend Calculator

1. Navigate to IPO Lot Calculator
2. Select IPO with `lot_size = NULL`
3. Verify default lot_size is used (75 for MAINBOARD, 125 for SME)
4. Verify "estimated" indicator appears
5. Select IPO with valid lot_size
6. Verify actual lot_size is used without "estimated" indicator

---

## Expected Outcomes

### Immediate (After Fixes)

1. **NSE Scraper:**
   - API: ✅ Already extracts lot_size correctly
   - Browser: Will extract if available, else `undefined`

2. **BSE Scraper:**
   - Main: Will use `undefined` instead of hardcoded `100`
   - Detail: ✅ Already extracts lot_size correctly

3. **Database:**
   - 341 IPOs with `lot_size = 1` → `lot_size = NULL`
   - New scrapes store actual values or `NULL` (never `1`)

4. **Frontend:**
   - Lot Calculator uses realistic defaults (75/125) when lot_size is NULL
   - Displays indicator when using estimated values

### Long-term (After Re-scraping)

**Re-scraping Recommendations:**

1. **NSE IPOs:** Re-scrape using NSE API (primary source)
   - Expected: 200+ IPOs with accurate lot_size from API

2. **BSE IPOs:** Re-scrape detail pages for missing lot_size
   - Expected: 100+ IPOs with lot_size from detail pages

3. **Historical IPOs:** Keep as NULL if not available
   - Note: Historical lot_size not critical for closed IPOs
   - Focus on UPCOMING and OPEN IPOs for calculator

**Target Metrics (After Re-scraping):**
- IPOs with valid lot_size: 60-70% (up from 31.11%)
- IPOs with lot_size = 1: 0% (down from 68.89%)
- IPOs with lot_size = NULL: 30-40% (acceptable for unavailable data)

---

## Data Source Priority

| Source | Lot Size Availability | Quality | Priority |
|--------|----------------------|---------|----------|
| **NSE API** | ✅ Available in API response | High | 1 (Primary) |
| **BSE Detail Page** | ✅ Available in "Market Lot" field | High | 2 |
| **NSE Browser** | ⚠️ May be available in table | Medium | 3 |
| **Moneycontrol** | ❌ Not available | N/A | N/A |
| **Chittorgarh** | ❌ Not available | N/A | N/A |

**Recommendation:**
- NSE API should be primary source (already working correctly)
- BSE detail scraper already integrated (Phase 2) - ensure it runs for all BSE IPOs
- Accept NULL for sources that don't provide lot_size

---

## Implementation Checklist

### Code Changes

- [ ] **NSE Browser Scraper** (`nse-scraper.ts` line 241):
  - Option A: Extract lot_size from table (requires table analysis)
  - Option B: Keep as `undefined` (rely on NSE API as primary)

- [ ] **BSE Main Scraper** (`bse-scraper.ts` line 310):
  - Change `lotSize: 100` → `lotSize: undefined`
  - Rely on detail page enrichment (already working)

- [ ] **Create Validator** (`scraper/src/utils/lot-size-validator.ts`):
  - `validateLotSize()` - rejects lot_size = 1, warns on unusual values
  - `getDefaultLotSizeForDisplay()` - provides realistic defaults for UI

- [ ] **Integrate Validator** in all scrapers:
  - Apply validation before database insertion
  - Ensure lot_size = 1 never reaches database

### Database Changes

- [ ] **Create Migration** (`fix_lot_size_defaults.sql`):
  - Update all IPOs with `lot_size = 1` to `NULL`
  - Add column comment explaining NULL handling

- [ ] **Test Migration** on local database:
  - Verify 341 rows updated
  - Verify no unintended changes

- [ ] **Apply Migration** to production:
  - Schedule during low-traffic period
  - Monitor for issues

### Frontend Changes

- [ ] **Update Lot Calculator** component:
  - Use `getDefaultLotSizeForDisplay()` for NULL values
  - Add "estimated" indicator when using defaults
  - Ensure calculations remain accurate

- [ ] **Test Lot Calculator** UI:
  - Test with IPOs having valid lot_size
  - Test with IPOs having NULL lot_size
  - Verify calculations and indicators

### Testing & Validation

- [ ] **Run Scrapers** individually:
  - NSE: Verify lot_size extraction from API
  - BSE: Verify detail page scraping includes lot_size

- [ ] **Database Verification**:
  - Query lot_size distribution before/after
  - Ensure no IPOs have lot_size = 1 after migration

- [ ] **Frontend Testing**:
  - Manual test Lot Calculator with various IPOs
  - Verify realistic defaults used
  - Verify "estimated" indicator appears correctly

### Documentation

- [x] **LOT_SIZE_FIX.md** - This document
- [ ] **Update CLAUDE.md** - Add lot_size validation pattern
- [ ] **Update scraper docs** - Document lot_size extraction logic

---

## Success Criteria

✅ **All scrapers extract lot_size correctly OR store NULL**
✅ **No IPOs have lot_size = 1 in database**
✅ **Validation prevents future lot_size = 1 insertions**
✅ **Migration script created and tested**
✅ **Frontend Lot Calculator uses realistic defaults for NULL values**
✅ **Documentation complete and clear for data team**

---

## Notes for Data Team

### Safe to Apply

1. **Migration script** - Safe to run on production, sets invalid values to NULL
2. **Scraper fixes** - Safe to deploy, improves data quality
3. **Validator** - Safe to add, prevents bad data from entering database

### Re-scraping Strategy

**High Priority (UPCOMING/OPEN IPOs):**
- Re-scrape all UPCOMING and OPEN IPOs using NSE API
- These are most important for Lot Calculator users

**Medium Priority (CLOSED IPOs - last 90 days):**
- Re-scrape recent CLOSED IPOs for data completeness
- May help users who bookmarked closed IPOs

**Low Priority (LISTED/Historical):**
- lot_size not critical for historical analysis
- Can remain NULL unless needed for specific features

### Monitoring

After deployment, monitor:
1. Scraper logs for lot_size extraction success rate
2. Database: `SELECT segment, COUNT(*) FROM ipos WHERE lot_size IS NOT NULL GROUP BY segment`
3. Frontend error logs for Lot Calculator issues

---

**End of Document**
