# ISS-027: IPO Compare Slug Resolution Inconsistency

**Issue ID:** ISS-027
**Severity:** MEDIUM
**Priority:** P2
**Component:** IPO Compare Tool
**Affected Feature:** IPO selection dropdown
**Discovered:** Phase 3 Testing (2025-10-21)

---

## Problem Statement

The IPO Compare tool's dropdown shows some IPOs that return 404 errors when selected for comparison. This indicates a mismatch between the IPO slugs displayed in the dropdown and the actual slugs stored in the database.

**Example:**
- Dropdown shows: "Supreme Infrastructure Ltd"
- Generated slug (assumed): "supreme-infrastructure-ltd" or "supreme-infrastructure-ltd-ipo"
- Actual slug in database: **Unknown** (needs verification)
- Result: 404 error when user selects this IPO

---

## Impact Assessment

**User Impact:** MEDIUM
- Users see IPOs in the dropdown but can't compare them (404 error)
- Confusing UX - appears as a bug to users
- Reduces trust in the platform

**Frequency:** MEDIUM
- Affects specific IPOs with slug mismatches
- Not all IPOs affected (most work correctly)
- Estimated: 5-10% of IPOs based on testing

**Workaround:**
- Users can try other IPOs that have matching slugs
- No workaround for affected IPOs

---

## Root Cause Analysis

### Suspected Causes

1. **Inconsistent Slug Generation:**
   - Scrapers may generate slugs differently than the frontend expects
   - Different slug generation algorithms in scraper vs frontend

2. **Special Characters Handling:**
   - Company names with special characters (Ltd., Pvt., &, etc.)
   - Different handling of spaces, punctuation
   - Unicode/ASCII conversion issues

3. **Slug Format Variations:**
   - Some slugs may have "-ipo" suffix, others don't
   - Inconsistent use of company legal entity types (Ltd/Limited/LTD)

4. **Data Migration Issues:**
   - Historical data may have different slug formats
   - Recent IPOs vs old IPOs may use different conventions

---

## Investigation Steps

### Step 1: Identify Affected IPOs

Query to find IPOs that might have slug mismatches:

```sql
-- Check for IPOs with special characters in company name
SELECT
  id,
  company_name,
  slug,
  LENGTH(slug) as slug_length,
  CASE
    WHEN slug LIKE '%-ipo' THEN 'Has -ipo suffix'
    ELSE 'No -ipo suffix'
  END as slug_format
FROM ipos
WHERE
  company_name LIKE '%Ltd.%'
  OR company_name LIKE '%&%'
  OR company_name LIKE '%.%'
  OR company_name LIKE '%  %' -- double spaces
ORDER BY company_name
LIMIT 50;
```

### Step 2: Verify Slug Generation Logic

**Locations to check:**
1. **Scraper slug generation:**
   - `scraper/src/utils/slug-generator.ts` (if exists)
   - `scraper/src/scrapers/*/index.ts` (check each scraper)

2. **Frontend slug generation:**
   - `web/lib/utils/slug.ts` (if exists)
   - `web/app/tools/compare/page.tsx` (dropdown logic)

3. **API slug handling:**
   - `web/app/api/tools/compare/route.ts` (slug query)
   - `web/lib/repositories/ipo-repository.ts` (`findBySlug` method)

### Step 3: Test Slug Matching

```typescript
// Test script to verify slug matching
import { db } from '@/lib/db';
import { ipos } from '@ipodhan/shared/db/schema';

// Function to generate slug (copy from frontend)
function generateSlug(companyName: string): string {
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Check for mismatches
const allIPOs = await db.select().from(ipos);
const mismatches = allIPOs.filter(ipo => {
  const expectedSlug = generateSlug(ipo.companyName);
  return expectedSlug !== ipo.slug;
});

console.log(`Found ${mismatches.length} slug mismatches`);
mismatches.forEach(ipo => {
  console.log(`${ipo.companyName}:`);
  console.log(`  Expected: ${generateSlug(ipo.companyName)}`);
  console.log(`  Actual:   ${ipo.slug}`);
});
```

---

## Recommended Solutions

### Solution 1: Fix Slug Generation Logic (RECOMMENDED)

**Priority:** HIGH
**Effort:** 2-4 hours
**Impact:** Fixes root cause

**Steps:**
1. Define a canonical slug generation function in `packages/shared/src/utils/slug.ts`
2. Update all scrapers to use this function
3. Re-generate slugs for affected IPOs
4. Add database constraint to ensure slug uniqueness

**Example implementation:**
```typescript
// packages/shared/src/utils/slug.ts
export function generateIPOSlug(companyName: string): string {
  return companyName
    .toLowerCase()
    .trim()
    .replace(/\s+ltd\.?/i, '-ltd')     // Normalize Ltd/Ltd.
    .replace(/\s+pvt\.?/i, '-pvt')     // Normalize Pvt/Pvt.
    .replace(/\s+limited/i, '-limited') // Normalize Limited
    .replace(/&/g, 'and')               // Replace & with and
    .replace(/[^a-z0-9]+/g, '-')        // Replace non-alphanumeric
    .replace(/^-+|-+$/g, '')            // Trim hyphens
    .replace(/-+/g, '-');               // Collapse multiple hyphens
}
```

### Solution 2: Add Dropdown Validation

**Priority:** MEDIUM
**Effort:** 1-2 hours
**Impact:** Prevents user-facing errors

**Steps:**
1. Before showing IPO in dropdown, verify slug exists in database
2. Filter out IPOs with invalid slugs
3. Log mismatched IPOs for investigation

**Example implementation:**
```typescript
// In compare page: Filter IPOs before display
const validIPOs = allIPOs.filter(async (ipo) => {
  try {
    await fetch(`/api/ipos/${ipo.slug}`);
    return true;
  } catch (error) {
    console.warn(`IPO slug mismatch: ${ipo.companyName} (${ipo.slug})`);
    return false;
  }
});
```

### Solution 3: Add API Fallback

**Priority:** LOW
**Effort:** 2-3 hours
**Impact:** Improves UX for affected IPOs

**Steps:**
1. If slug lookup fails, try fuzzy matching on company name
2. Return 404 with suggestions if multiple matches
3. Log slug mismatches for data team

**Example:**
```typescript
// In IPO repository
async findBySlug(slug: string): Promise<IPO | null> {
  // Try exact match first
  let ipo = await this.db.query.ipos.findFirst({
    where: eq(ipos.slug, slug)
  });

  // If not found, try fuzzy match on company name
  if (!ipo) {
    const searchTerm = slug.replace(/-/g, ' ');
    ipo = await this.db.query.ipos.findFirst({
      where: ilike(ipos.companyName, `%${searchTerm}%`)
    });

    if (ipo) {
      logger.warn(`Slug mismatch: searched for "${slug}", found "${ipo.slug}"`);
    }
  }

  return ipo;
}
```

---

## Testing Plan

### Test Cases

1. **Test slug generation consistency:**
   - Generate slugs for 100 random IPOs
   - Verify all slugs are unique
   - Verify all slugs match database

2. **Test special character handling:**
   - IPOs with "Ltd.", "Pvt.", "Limited"
   - IPOs with "&" in name
   - IPOs with numbers
   - IPOs with unicode characters

3. **Test dropdown filtering:**
   - Verify only valid IPOs shown
   - Verify 404 IPOs are filtered out
   - Check console logs for warnings

4. **Test API error handling:**
   - Send invalid slug to API
   - Verify 404 response
   - Verify error message is user-friendly

### Success Criteria

- ✅ Zero slug mismatches in database
- ✅ All IPOs in dropdown have valid slugs
- ✅ API returns 404 only for truly non-existent IPOs
- ✅ No user-facing errors during comparison

---

## Timeline & Ownership

**Estimated Fix Time:** 4-8 hours
**Priority:** P2 (Medium)
**Blocking:** No (workaround exists)

**Recommended Approach:**
1. **Immediate (< 1 hour):** Add dropdown validation (Solution 2)
2. **Short-term (< 1 week):** Fix slug generation logic (Solution 1)
3. **Long-term (next sprint):** Add API fallback (Solution 3)

**Assignee:** Data/Scraper Team + Frontend Team
**Related Issues:** ISS-LotCalc-002 (data quality)

---

## Current Status

**Status:** INVESTIGATING
**Last Updated:** 2025-10-21
**Blocked By:** None
**Blocking:** None (non-critical)

**Next Actions:**
1. Run SQL query to identify affected IPOs
2. Check scraper slug generation code
3. Implement dropdown validation (quick fix)
4. Schedule slug regeneration for next sprint

---

## References

- **Test Report:** `test-results/phase-3/ipo-compare-tests.md`
- **Phase 3 Summary:** `test-results/phase-3/PHASE-3-SUMMARY.md`
- **API Route:** `web/app/api/tools/compare/route.ts`
- **Compare Page:** `web/app/tools/compare/page.tsx`
- **IPO Repository:** `web/lib/repositories/ipo-repository.ts`

---

**Generated:** 2025-10-21
**Test Phase:** Phase 3 - Tools & Features Testing
**Test Lead:** Claude Code
