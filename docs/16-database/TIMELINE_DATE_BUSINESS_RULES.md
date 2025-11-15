# IPO Timeline Date Business Rules

**Single Source of Truth for Timeline Date Validation**
**Location**: Application-level validation (not database constraints)
**Implementation**: `web/lib/validation/timeline-dates.ts`

---

## Overview

IPO timeline dates must follow real-world business logic. Since PostgreSQL CHECK constraints cannot reference other tables, validation is enforced at the **application level** in repositories, services, and data entry scripts.

---

## Core Business Rules

### Rule 1: Timeline Dates Must Follow close_date

All timeline dates must occur AFTER or ON the `close_date`:

| Timeline Date | Constraint | Standard Gap | Maximum Gap |
|---------------|------------|--------------|-------------|
| `basis_of_allotment_date` | >= `close_date` | +2 days | +30 days |
| `initiation_of_refunds_date` | >= `close_date` | +4 days | +30 days |
| `credit_of_shares_date` | >= `close_date` | +6 days | +30 days |
| `listing_date` | >= `close_date` | +10-14 days | No strict limit |

**Rationale**: Timeline milestones cannot occur before the IPO closes for subscription.

---

### Rule 2: Maximum 30-Day Window

Timeline dates (basis, refunds, credit) must be within **30 days** of `close_date`:

```
close_date <= timeline_date <= close_date + 30 days
```

**Rationale**: SEBI regulations require timely allotment and refunds. Gaps exceeding 30 days indicate data quality issues.

---

### Rule 3: Standard Timeline Sequence

Real-world IPO timeline follows this sequence:

```
Day 0:   IPO Opens (open_date)
Day 3-10: IPO Closes (close_date)

Post-Close Milestones:
  Day +2:  Basis of Allotment finalized (basis_of_allotment_date)
  Day +4:  Initiation of Refunds (initiation_of_refunds_date)
  Day +6:  Credit of Shares to Demat accounts (credit_of_shares_date)
  Day +10-14: Listing on exchange (listing_date)

Total Timeline: 2-3 weeks from close to listing
```

**Standard Gaps** (recommended):
- Basis of Allotment: `close_date + 2 days`
- Initiation of Refunds: `close_date + 4 days`
- Credit of Shares: `close_date + 6 days`

**Deviations are allowed** but generate warnings during validation.

---

### Rule 4: NULL Values Are Allowed

Timeline dates can be NULL when:
- IPO is UPCOMING (status = 'UPCOMING')
- IPO is OPEN (status = 'OPEN')
- Data not yet available from scraper

Only populate timeline dates when actual dates are known/published.

---

### Rule 5: Sequential Logic (Advisory)

Timeline dates should follow logical sequence:

```
close_date <= basis_of_allotment_date <= initiation_of_refunds_date <= credit_of_shares_date <= listing_date
```

**Validation Level**: Warning (not error)
**Rationale**: Rare cases may have different sequences, but typically follows this order.

---

## Validation Implementation

### Application-Level Validation

**File**: `web/lib/validation/timeline-dates.ts`

**Function**: `validateTimelineDates(dates)`

**Usage**:
```typescript
import { validateTimelineDates } from '@/lib/validation/timeline-dates';

const result = validateTimelineDates({
  closeDate: new Date('2025-11-15'),
  basisOfAllotmentDate: new Date('2025-11-17'), // +2 days ✅
  initiationOfRefundsDate: new Date('2025-11-19'), // +4 days ✅
  creditOfSharesDate: new Date('2025-11-21'), // +6 days ✅
});

if (!result.isValid) {
  console.error('Validation errors:', result.errors);
  // Reject data entry or log warning
}

if (result.warnings.length > 0) {
  console.warn('Validation warnings:', result.warnings);
  // Log for review but allow save
}
```

**Validation Levels**:
- **Errors**: MUST be fixed before saving (violates hard constraints)
- **Warnings**: Log for review but allow save (deviates from standard timeline)

---

### Seed Script Implementation

**File**: `web/scripts/seed-database.ts`

**Lines**: 840-848

**Implementation**:
```typescript
basisOfAllotmentDate: ipo.status === 'LISTED' || ipo.status === 'CLOSED'
  ? addDaysToDate(ipo.closeDate, 2) // Standard +2 days
  : null,

initiationOfRefundsDate: ipo.status === 'LISTED' || ipo.status === 'CLOSED'
  ? addDaysToDate(ipo.closeDate, 4) // Standard +4 days
  : null,

creditOfSharesDate: ipo.status === 'LISTED'
  ? addDaysToDate(ipo.closeDate, 6) // Standard +6 days
  : null,
```

**Status**: ✅ Correctly implemented (verified 2025-11-15)

---

### Repository Integration

**Repositories should validate before save**:

```typescript
// Example: IPORepository or IPODetailsRepository
async upsertIPODetails(data: IPODetailsInsert): Promise<IPODetails> {
  // 1. Get close_date from parent IPO record
  const ipo = await this.db.query.ipos.findFirst({
    where: eq(ipos.id, data.ipoId)
  });

  if (!ipo) {
    throw new Error(`IPO not found: ${data.ipoId}`);
  }

  // 2. Validate timeline dates
  const validation = validateTimelineDates({
    closeDate: ipo.closeDate,
    basisOfAllotmentDate: data.basisOfAllotmentDate,
    initiationOfRefundsDate: data.initiationOfRefundsDate,
    creditOfSharesDate: data.creditOfSharesDate,
  });

  // 3. Log errors/warnings
  if (!validation.isValid) {
    console.error('[Timeline Validation]', validation.errors);
    throw new ValidationError('Invalid timeline dates', validation.errors);
  }

  if (validation.warnings.length > 0) {
    console.warn('[Timeline Validation]', validation.warnings);
  }

  // 4. Proceed with database insert/update
  const result = await this.db.insert(ipoDetails)
    .values(data)
    .returning();

  return result[0];
}
```

---

### Scraper Integration

**Scrapers should validate scraped data**:

```typescript
// Example: NSE Scraper or BSE Scraper
async scrapeIPOTimeline(ipoId: string) {
  const scrapedData = await fetchFromNSE(ipoId);

  // Validate before saving
  const validation = validateTimelineDates({
    closeDate: scrapedData.closeDate,
    basisOfAllotmentDate: scrapedData.basisDate,
    initiationOfRefundsDate: scrapedData.refundDate,
    creditOfSharesDate: scrapedData.creditDate,
  });

  if (!validation.isValid) {
    // Log data quality issue
    console.error(`[Scraper] Invalid timeline dates for ${ipoId}:`, validation.errors);

    // Option A: Skip this IPO and continue
    return null;

    // Option B: Save with NULL timeline dates and flag for manual review
    scrapedData.basisDate = null;
    scrapedData.refundDate = null;
    scrapedData.creditDate = null;
    scrapedData.requiresManualReview = true;
  }

  // Save validated data
  await saveIPODetails(scrapedData);
}
```

---

## Why No Database Constraints?

### PostgreSQL Limitation

**Problem**: Timeline dates are in `ipo_details` table, but `close_date` is in `ipos` table.

**PostgreSQL Rule**: CHECK constraints **cannot contain subqueries** or reference other tables.

**Attempted Constraint** (WOULD NOT WORK):
```sql
-- ❌ This is NOT SUPPORTED by PostgreSQL
ALTER TABLE ipo_details
ADD CONSTRAINT basis_after_close CHECK (
  basis_of_allotment_date IS NULL OR
  basis_of_allotment_date >= (
    SELECT close_date FROM ipos WHERE id = ipo_id  -- ❌ Subquery not allowed
  )
);
```

**Error**: `ERROR: cannot use subquery in check constraint`

### Alternative: Triggers

**Option**: Use PostgreSQL triggers for cross-table validation.

**Decision**: **Not implemented** (yet) due to:
- Added complexity
- Application-level validation is sufficient
- Easier to test and maintain
- Better error messages

**Future Consideration**: If data quality issues persist despite application validation, triggers can be added.

---

## Data Quality Monitoring

### Recommended Checks

**Daily/Weekly Monitoring Script**:
```sql
-- Find IPOs with timeline dates > 30 days after close
SELECT
  i.company_name,
  i.close_date,
  id.basis_of_allotment_date,
  (id.basis_of_allotment_date - i.close_date) as basis_gap_days,
  id.initiation_of_refunds_date,
  (id.initiation_of_refunds_date - i.close_date) as refunds_gap_days,
  id.credit_of_shares_date,
  (id.credit_of_shares_date - i.close_date) as credit_gap_days
FROM ipos i
LEFT JOIN ipo_details id ON i.id = id.ipo_id
WHERE i.segment = 'MAINBOARD'
  AND i.close_date IS NOT NULL
  AND (
    (id.basis_of_allotment_date IS NOT NULL AND (id.basis_of_allotment_date - i.close_date) > 30)
    OR (id.initiation_of_refunds_date IS NOT NULL AND (id.initiation_of_refunds_date - i.close_date) > 30)
    OR (id.credit_of_shares_date IS NOT NULL AND (id.credit_of_shares_date - i.close_date) > 30)
  )
ORDER BY (id.basis_of_allotment_date - i.close_date) DESC;
```

**Expected Result**: 0 rows

**If rows found**: Data quality issue - investigate scraper or manual entry

---

## Testing

### Unit Tests

**File**: `web/tests/unit/lib/validation/timeline-dates.test.ts`

**Test Cases**:
1. ✅ Valid dates (close + 2/4/6 days) → isValid: true, no errors
2. ✅ NULL timeline dates → isValid: true (allowed)
3. ❌ Basis date before close date → isValid: false, error
4. ❌ Basis date > 30 days after close → isValid: false, error
5. ⚠️ Basis date is 10 days after close → isValid: true, warning
6. ⚠️ Refund date before basis date → isValid: true, warning
7. ✅ Listing date > 30 days after close → isValid: true, warning (allowed for listing)

### Integration Tests

**File**: `web/tests/integration/repositories/ipo-details-repository.test.ts`

**Test Cases**:
1. Attempt to save IPO details with invalid timeline dates → throws ValidationError
2. Attempt to save IPO details with valid timeline dates → succeeds
3. Attempt to save IPO details with NULL timeline dates → succeeds

---

## Historical Context

### Incident: 2025-11-15

**Problem**: Calendar showing 628 events instead of ~136 events in November 2025

**Root Cause**: 27 IPOs had timeline dates set 8-12 months after close_date (impossible in real world)

**Example**:
- Company: "National Corporation Ltd"
- Close Date: 2024-11-19
- Basis of Allotment: **2025-11-13** (360 days later!) ❌
- Initiation of Refunds: **2025-11-12** (359 days later!) ❌

**Impact**: Calendar service correctly generated events for every day between dates, creating hundreds of spurious events.

**Resolution**:
1. Test data was deleted (Plan-Delete-Test-Data-2025-11-15-v1.md)
2. Seed script was verified/fixed to generate sequential dates (already correct)
3. Application-level validation created (this document + `timeline-dates.ts`)

### Lessons Learned

1. **Test data must mirror production reality** - Random dates break assumptions
2. **Database constraints have limitations** - PostgreSQL cannot validate across tables
3. **Application validation is essential** - Validate at multiple layers (seed script, repositories, scrapers)
4. **Monitor data quality** - Regular checks catch issues early

---

## Related Documentation

- **Validation Implementation**: `web/lib/validation/timeline-dates.ts`
- **Seed Script**: `web/scripts/seed-database.ts` (lines 840-848)
- **Database Schema**: `packages/shared/src/db/schema.ts` (ipoDetails table, lines 827-829)
- **Calendar Service**: `web/lib/services/mainboard-calendar-service.ts` (uses timeline dates)
- **Plan v2**: `docs/01-planning/Plan-Calendar-Fixes-2025-11-15-v2.md` (identified root cause)
- **Plan v3**: `docs/01-planning/Plan-Calendar-Data-Quality-Fix-2025-11-15-v3.md` (verification + prevention)

---

**Last Updated**: 2025-11-15 19:00
**Maintained By**: Backend Team
**Review Frequency**: Quarterly or after data quality incidents
