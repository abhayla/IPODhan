# Segment & Offering Type Schema Restructure

**Created:** 2025-10-19
**Status:** Planned
**Priority:** High
**Impact:** Breaking Change

## Problem Statement

### Current Issue
Searching for "3i" on the dashboard shows **two IPO cards** for the same company:
1. **"3i Infotech Limited"** (Symbol: `3IINFOLTDR`) - NSE, 1-day IPO, no price
2. **"3I INFOTECH LTD"** (Symbol: `3IINFOTECHLTD`) - BSE, 20-day IPO, ₹17 price

### Root Cause
The current `category` field mixes two distinct concepts:
```typescript
category: 'MAINBOARD' | 'SME' | 'RIGHTS' | 'NCD' | 'FPO'
```

This conflates:
- **Exchange Segment** (where it's listed): MAINBOARD, SME
- **Offering Type** (what it is): IPO, FPO, RIGHTS, NCD, TENDER, BUYBACK, etc.

The "TDR" suffix in `3IINFOLTDR` indicates this is a **TENDER offer** (likely buyback/delisting), not an IPO. Both entries are categorized as "MAINBOARD" with no way to distinguish them.

## Solution

**Complete schema restructure**: Replace single `category` field with TWO separate fields:

### New Schema Design

```typescript
// Remove old enum
// export const ipoCategoryEnum = pgEnum('ipo_category', ['MAINBOARD', 'SME', 'RIGHTS', 'NCD', 'FPO']);

// Add new enums
export const segmentEnum = pgEnum('segment', [
  'MAINBOARD',
  'SME',
]);

export const offeringTypeEnum = pgEnum('offering_type', [
  // Public Equity Offerings
  'IPO',           // Initial Public Offering
  'FPO',           // Follow-on Public Offering
  'RIGHTS',        // Rights Issue
  'OFS',           // Offer for Sale

  // Private/Institutional Placements
  'IPP',           // Institutional Placement Program
  'QIP',           // Qualified Institutional Placement
  'PREFERENTIAL',  // Preferential Allotment

  // Debt Instruments
  'NCD',           // Non-Convertible Debentures
  'BONDS',         // Corporate Bonds

  // Investment Trusts
  'INVITS',        // Infrastructure Investment Trusts
  'REITS',         // Real Estate Investment Trusts

  // Corporate Actions
  'BUYBACK',       // Share Buyback
  'DELISTING',     // Delisting from Exchange
  'TENDER',        // Tender Offer
]);

// Update ipos table
export const ipos = pgTable('ipos', {
  // ... existing fields ...

  // REMOVE:
  // category: ipoCategoryEnum('category').notNull(),

  // ADD:
  segment: segmentEnum('segment').notNull(),
  offeringType: offeringTypeEnum('offering_type').notNull(),

  // ... rest of fields ...
});
```

## Implementation Plan

### Phase 1: Schema Changes

#### 1.1 Update Schema File
**File:** `packages/shared/src/db/schema.ts`

- Remove `ipoCategoryEnum`
- Add `segmentEnum` (MAINBOARD, SME)
- Add `offeringTypeEnum` (15 values as listed above)
- Replace `category` field with `segment` + `offeringType`

#### 1.2 Create Database Migration
**File:** `web/drizzle/migrations/0015_restructure_category.sql`

```sql
-- Create new enums
CREATE TYPE segment AS ENUM ('MAINBOARD', 'SME');

CREATE TYPE offering_type AS ENUM (
  'IPO', 'FPO', 'RIGHTS', 'OFS',
  'IPP', 'QIP', 'PREFERENTIAL',
  'NCD', 'BONDS',
  'INVITS', 'REITS',
  'BUYBACK', 'DELISTING', 'TENDER'
);

-- Add new columns (nullable temporarily for migration)
ALTER TABLE ipos ADD COLUMN segment segment;
ALTER TABLE ipos ADD COLUMN offering_type offering_type;

-- Migrate data from category to new fields
UPDATE ipos SET
  segment = CASE
    WHEN category = 'MAINBOARD' THEN 'MAINBOARD'::segment
    WHEN category = 'SME' THEN 'SME'::segment
    WHEN category IN ('RIGHTS', 'NCD', 'FPO') THEN 'MAINBOARD'::segment
    ELSE 'MAINBOARD'::segment
  END,
  offering_type = CASE
    WHEN category = 'MAINBOARD' THEN 'IPO'::offering_type
    WHEN category = 'SME' THEN 'IPO'::offering_type
    WHEN category = 'RIGHTS' THEN 'RIGHTS'::offering_type
    WHEN category = 'NCD' THEN 'NCD'::offering_type
    WHEN category = 'FPO' THEN 'FPO'::offering_type
    ELSE 'IPO'::offering_type
  END;

-- Detect TENDER offers from symbol suffix
UPDATE ipos SET offering_type = 'TENDER'::offering_type
WHERE symbol LIKE '%TDR' OR symbol LIKE '%TENDER';

-- Make new columns NOT NULL
ALTER TABLE ipos ALTER COLUMN segment SET NOT NULL;
ALTER TABLE ipos ALTER COLUMN offering_type SET NOT NULL;

-- Add indexes
CREATE INDEX idx_ipos_segment ON ipos(segment);
CREATE INDEX idx_ipos_offering_type ON ipos(offering_type);
CREATE INDEX idx_ipos_segment_offering_type ON ipos(segment, offering_type);

-- Drop old category column and enum
ALTER TABLE ipos DROP COLUMN category;
DROP TYPE ipo_category;
```

### Phase 2: Update TypeScript Code

#### 2.1 Update Repositories
**File:** `web/lib/repositories/ipo-repository.ts`

- Replace `category` parameter with `segment` and `offeringType`
- Update filters in `findAll()` method
- Update cache keys to include both fields

```typescript
// Old
async findAll(filters: { category?: string, ... }) {
  if (category) {
    conditions.push(eq(ipos.category, category));
  }
}

// New
async findAll(filters: { segment?: string, offeringType?: string, ... }) {
  if (segment) {
    if (Array.isArray(segment)) {
      conditions.push(inArray(ipos.segment, segment));
    } else {
      conditions.push(eq(ipos.segment, segment));
    }
  }

  if (offeringType) {
    if (Array.isArray(offeringType)) {
      conditions.push(inArray(ipos.offeringType, offeringType));
    } else {
      conditions.push(eq(ipos.offeringType, offeringType));
    }
  }
}
```

#### 2.2 Update API Routes
**File:** `web/app/api/ipos/route.ts`

- Replace `category` validation with `segment` and `offeringType`
- Update query parameter parsing

```typescript
// Old
const IPOCategorySchema = z.enum(['MAINBOARD', 'SME', 'RIGHTS', 'NCD', 'FPO']);

const QueryParamsSchema = z.object({
  category: z.union([IPOCategorySchema, z.array(IPOCategorySchema)]).optional(),
  // ...
});

// New
const SegmentSchema = z.enum(['MAINBOARD', 'SME']);
const OfferingTypeSchema = z.enum([
  'IPO', 'FPO', 'RIGHTS', 'OFS',
  'IPP', 'QIP', 'PREFERENTIAL',
  'NCD', 'BONDS',
  'INVITS', 'REITS',
  'BUYBACK', 'DELISTING', 'TENDER'
]);

const QueryParamsSchema = z.object({
  segment: z.union([SegmentSchema, z.array(SegmentSchema)]).optional(),
  offeringType: z.union([OfferingTypeSchema, z.array(OfferingTypeSchema)]).optional(),
  // ...
});
```

#### 2.3 Update Services
**Files:** `web/lib/services/*.ts`

Update all service functions that use `category` parameter:
- `mainboard-landing-service.ts`
- `sme-landing-service.ts`
- `ofs-service.ts`
- `rights-service.ts`

```typescript
// Old
const ipos = await ipoRepository.findAll({ category: 'MAINBOARD' });

// New
const ipos = await ipoRepository.findAll({
  segment: 'MAINBOARD',
  offeringType: 'IPO'
});
```

#### 2.4 Update API Client
**File:** `web/lib/api-client.ts`

```typescript
// Old
export interface GetIPOsParams {
  category?: 'MAINBOARD' | 'SME' | 'RIGHTS' | 'NCD' | 'OFS';
  // ...
}

// New
export interface GetIPOsParams {
  segment?: 'MAINBOARD' | 'SME';
  offeringType?: 'IPO' | 'FPO' | 'RIGHTS' | 'OFS' | 'TENDER' | /* ... */;
  // ...
}

// Update getIPOs function
if (params.segment) searchParams.append('segment', params.segment);
if (params.offeringType) searchParams.append('offeringType', params.offeringType);
```

### Phase 3: Update Scrapers

#### 3.1 Create Offering Type Detection Utility
**File:** `scraper/src/utils/detect-offering-type.ts`

```typescript
export function detectOfferingTypeFromSymbol(symbol: string): string {
  if (!symbol) return 'IPO';

  const symbolUpper = symbol.toUpperCase();

  // Detect from suffix
  if (symbolUpper.endsWith('TDR') || symbolUpper.includes('TENDER')) {
    return 'TENDER';
  }

  if (symbolUpper.includes('BUYBACK')) {
    return 'BUYBACK';
  }

  if (symbolUpper.includes('DELISTING')) {
    return 'DELISTING';
  }

  // Default to IPO
  return 'IPO';
}

export function detectSegmentFromExchange(
  listingExchanges: string[]
): string {
  // Logic to determine MAINBOARD vs SME
  // For now, default to MAINBOARD unless explicitly SME
  return 'MAINBOARD';
}
```

#### 3.2 Update NSE Scraper
**File:** `scraper/src/scrapers/nse-scraper.ts`

```typescript
import { detectOfferingTypeFromSymbol, detectSegmentFromExchange } from '../utils/detect-offering-type';

// In scraping logic
const ipoData = {
  // ... existing fields ...
  segment: detectSegmentFromExchange(listingExchanges),
  offeringType: detectOfferingTypeFromSymbol(symbol),
};
```

#### 3.3 Update BSE Scraper
**File:** `scraper/src/scrapers/bse-scraper.ts`

Similar updates to detect segment and offering type from BSE data.

#### 3.4 Update Chittorgarh Scraper
**File:** `scraper/src/scrapers/chittorgarh-*.ts`

Update historical data scraper to set appropriate segment and offering type.

### Phase 4: Update UI Components

#### 4.1 Update Dashboard Filters
**File:** `web/components/dashboard/DashboardFilters.tsx`

Replace single category dropdown with:
- Segment filter (MAINBOARD | SME)
- Offering Type filter (IPO | FPO | etc.)

#### 4.2 Update IPO Cards
**File:** `web/components/dashboard/IPOCard.tsx`

Display both segment and offering type badges:
```tsx
<Badge>{ipo.segment}</Badge>
<Badge variant="secondary">{ipo.offeringType}</Badge>
```

#### 4.3 Default Dashboard Filtering
**File:** `web/app/dashboard/page.tsx`

Default to showing only IPO and FPO offerings:
```typescript
const response = await apiClient.getIPOs({
  status,
  segment,
  offeringType: offeringType || ['IPO', 'FPO'], // Default filter
  // ...
});
```

### Phase 5: Update Tests

#### 5.1 Update Test Fixtures
**Files:** `web/tests/**/*.test.ts`

Update all test data to use new fields:
```typescript
// Old
const mockIPO = {
  category: 'MAINBOARD',
  // ...
};

// New
const mockIPO = {
  segment: 'MAINBOARD',
  offeringType: 'IPO',
  // ...
};
```

#### 5.2 Update Repository Tests
Add tests for new filtering logic with segment + offeringType combinations.

#### 5.3 Update API Tests
Test new query parameters and validation schemas.

## Expected Outcomes

### Before (Current State)
Searching for "3i":
- Shows 2 cards: "3i Infotech Limited" (TENDER) and "3I INFOTECH LTD" (IPO)
- Both categorized as "MAINBOARD"
- No way to filter out TENDER offers

### After (Fixed State)
Searching for "3i":
- Shows 1 card: "3I INFOTECH LTD" (segment=MAINBOARD, offeringType=IPO)
- "3i Infotech Limited" (segment=MAINBOARD, offeringType=TENDER) is hidden by default
- Users can explicitly filter for TENDER offers if needed

## Breaking Changes

⚠️ **This is a breaking change** that affects:

1. **Database Schema**
   - Column rename: `category` → `segment` + `offeringType`
   - Enum changes

2. **API Contracts**
   - Query parameter: `category` → `segment` + `offeringType`
   - Response field changes

3. **UI Components**
   - Filter dropdowns
   - Badge displays
   - URL parameters

4. **Scraper Output**
   - Must set both `segment` and `offeringType`

5. **Test Fixtures**
   - All mock data needs updating

## Migration Safety

### Pre-Migration Checklist
- [ ] Backup production database
- [ ] Test migration on development database
- [ ] Update all code references before deploying migration
- [ ] Run full test suite
- [ ] Test scrapers with new fields

### Deployment Strategy
1. **Code First**: Deploy code changes that support both old and new schema
2. **Migration**: Run database migration
3. **Cleanup**: Remove backward compatibility code

### Rollback Plan
If issues occur:
1. Restore database from backup
2. Revert code changes
3. Investigate issues in development environment

## Timeline Estimate

- **Schema Changes**: 1 hour
- **Database Migration**: 2 hours (including testing)
- **Code Updates**: 6-8 hours
- **Scraper Updates**: 3-4 hours
- **UI Updates**: 2-3 hours
- **Testing**: 4-5 hours
- **Documentation**: 1 hour

**Total Estimated Time**: 19-24 hours (2.5-3 days)

## References

### Related Files
- Schema: `packages/shared/src/db/schema.ts`
- Migration: `web/drizzle/migrations/0015_restructure_category.sql`
- Repository: `web/lib/repositories/ipo-repository.ts`
- API: `web/app/api/ipos/route.ts`
- Scrapers: `scraper/src/scrapers/*.ts`

### Related Issues
- Duplicate "3i Infotech" cards on dashboard
- Cannot filter TENDER/BUYBACK offers from IPO listings
- Confusion between exchange segment and offering type

## Decision Log

**2025-10-19**: Decided to do complete restructure (segment + offeringType) instead of backward-compatible addition. Reasoning:
- Cleaner data model
- Prevents future confusion
- One-time breaking change better than incremental patches
- Aligns with industry standards (segment vs offering type are distinct concepts)
