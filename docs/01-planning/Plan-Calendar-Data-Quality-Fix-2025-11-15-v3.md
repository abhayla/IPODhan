# Plan: Calendar Data Quality Fix - Fresh Verification

**Date**: 2025-11-15
**Version**: v3
**Status**: 🔴 AWAITING IMPLEMENTATION
**Priority**: P0 CRITICAL - Data Quality Investigation Required
**Estimated Time**: 2-3 hours (comprehensive fix with validation)
**Last Verified**: 2025-11-15 18:00 (via database queries + codebase analysis)

---

## Changes from v1 & v2

**v1 Plan Status**: ❌ INVALID
- Assumed CSS modules not integrated → INCORRECT
- Assumed event limiting not implemented → INCORRECT
- Assumed event grouping broken → INCORRECT
- **Conclusion**: UI code is working correctly

**v2 Plan Status**: 🟡 PARTIALLY VALID
- ✅ Correctly identified issue as DATA QUALITY not code bugs
- ✅ Correctly diagnosed unrealistic timeline dates as root cause
- ❓ **DISCREPANCY**: v2 claims 27 IPOs with bad dates, but fresh database query (2025-11-15 18:00) found **ZERO problematic records**

**v3 Fresh Investigation** (This Plan):
- Comprehensive codebase analysis completed
- Database queries run against current state
- **Key Finding**: Zero problematic records found (needs explanation)
- **Possible Scenarios**:
  1. Issue was already fixed (manually or via script)
  2. Issue exists but query criteria incorrect
  3. Database is different environment (dev vs staging vs production)
  4. Test data was cleared (see Plan-Delete-Test-Data-2025-11-15-v1.md)

**v3 Focus**:
1. Verify current state comprehensively
2. Understand why v2's diagnosis differs from current findings
3. Implement preventative measures (validation constraints)
4. Ensure seed script generates valid data
5. Add monitoring to prevent future issues

---

## Executive Summary

The Mainboard IPO Calendar at `/mainboard-ipo-calendar` reportedly shows **628 events in November 2025** causing unusable tall cells (400-600px). Previous investigation (Plan v2) identified the root cause as **unrealistic timeline dates** (27 IPOs with dates 8-12 months after close date). However, fresh database queries (2025-11-15 18:00) found **ZERO problematic records matching v2's criteria**.

**Critical Question**: Has the issue already been resolved, or does it still exist in a different form?

**This Plan**: Conduct comprehensive verification, understand the discrepancy, and implement preventative measures (database constraints + seed script fixes) regardless of current state to prevent future occurrences.

---

## Current State (Verified via Multiple Sources)

### What's Working ✅

**1. UI Implementation (Verified via Code Analysis)**

All calendar components are correctly implemented:

| Component | Status | Evidence |
|-----------|--------|----------|
| CSS Modules Integration | ✅ Working | `import styles from './MainboardIPOCalendarGrid.module.css'` (line 21) |
| Responsive Display | ✅ Working | Desktop grid hidden on mobile, mobile list hidden on desktop via CSS modules |
| Event Grouping | ✅ Working | `CalendarEventGroup` component exists and is used (line 115-124) |
| Event Limiting | ✅ Working | `maxEvents={3}` with "+X more" buttons implemented |
| Expand/Collapse | ✅ Working | Client-side state management via `useState` |
| Event Type Priority | ✅ Working | `getEventTypePriority()` function exists (service layer) |
| Group Headers | ✅ Working | Section headers like "CLOSING TODAY (3)" display correctly |

**Evidence from MainboardIPOCalendarGrid.tsx**:
```typescript
// Line 115-124 (Event Rendering)
{dateEvents.eventGroups.map((group) => (
  <CalendarEventGroup
    key={group.type}
    groupType={group.label}
    events={group.events}
    maxEvents={3}  // ✅ Event limiting implemented
    size="compact"
  />
))}
```

**2. Service Layer Architecture (Verified via Code Analysis)**

```typescript
// mainboard-calendar-service.ts
- extractIPOEvents(): ✅ Creates continuous application period events (Story 15.1)
- groupEventsByType(): ✅ Organizes events by type with priority (line 317-348)
- getEventTypePriority(): ✅ Returns 1-9 priority (line 235-248)
- searchCalendarEvents(): ✅ Filters events by company name
```

**3. Calendar Data Flow (Verified via Architecture Analysis)**

```
PostgreSQL (ipos + ipo_details tables)
  ↓
IPORepository.findAllWithDetails() [filtered by segment + date range]
  ↓
mainboard-calendar-service.ts [extracts 8 event types per IPO]
  ↓
MainboardIPOCalendarPage (Server Component)
  ↓
MainboardIPOCalendarGrid (Server - renders grid/list)
  ↓
CalendarEventGroup (Client - expand/collapse interaction)
```

All layers verified correct - no architectural violations.

### What's Unknown / Needs Verification ❓

**1. Current Event Count**

**Plan v2 Claim**: 628 events in November 2025
**Current Verification Needed**:
- Query database for November 2025 event count
- Check if 628 events still exist
- Verify if user is seeing this in browser

**2. Problematic Timeline Dates**

**Plan v2 Claim**: 27 IPOs with timeline dates 8-12 months after close date
**Fresh Query Result** (2025-11-15 18:00):
```sql
SELECT COUNT(*) -- Result: 0 records
FROM ipos i
LEFT JOIN ipo_details id ON i.id = id.ipo_id
WHERE i.segment = 'MAINBOARD'
  AND i.close_date IS NOT NULL
  AND (
    (id.basis_of_allotment_date - i.close_date > 30)
    OR (id.initiation_of_refunds_date - i.close_date > 30)
    OR (id.credit_of_shares_date - i.close_date > 30)
  );
```

**Discrepancy**: Zero problematic records found. Why?

**Possible Explanations**:
1. ✅ Issue was already fixed (manually or via previous script)
2. ✅ Test data was deleted (see Plan-Delete-Test-Data-2025-11-15-v1.md)
3. ❌ Query criteria incorrect (need different date comparison logic)
4. ❌ Different database environment (dev vs staging vs production)

**3. Seed Script Current State**

**Need to Verify**:
- Does seed script generate sequential realistic dates? (claimed fixed in v2)
- Or does it still generate random dates?
- Check lines 840-847 in `web/scripts/seed-database.ts`

### What's Broken or Missing ❌

**1. No Database Validation Constraints**

**Current Schema** (`packages/shared/src/db/schema.ts`):
```typescript
export const ipoDetails = pgTable('ipo_details', {
  basisOfAllotmentDate: date('basis_of_allotment_date', { mode: 'date' }),
  initiationOfRefundsDate: date('initiation_of_refunds_date', { mode: 'date' }),
  creditOfSharesDate: date('credit_of_shares_date', { mode: 'date' }),
  // ❌ NO CHECK CONSTRAINTS to enforce:
  //    - Must be >= close_date
  //    - Must be <= close_date + 30 days
});
```

**Impact**: Future data entry (manual or scraper) could create invalid dates again.

**2. No Data Quality Monitoring**

**Missing**:
- No alerts when event count exceeds threshold (e.g., >300 events/month)
- No validation when saving IPO timeline dates
- No automated checks for data quality issues

**3. No Documented Timeline Date Business Rules**

**Missing Documentation**:
- What are the expected gaps between milestone dates?
- What's the maximum allowed gap?
- How should scrapers/manual entry validate dates?

---

## Root Cause Analysis

### Root Cause 1: Lack of Database Constraints (Confirmed)

**Problem**: Schema allows impossible timeline dates with no validation.

**Evidence**:
- `ipoDetails` table has NO CHECK constraints on timeline dates
- Database accepts any date value, regardless of temporal logic
- No validation that dates are >= close_date
- No validation that dates are <= close_date + 30 days

**Impact**:
- **Past**: May have allowed bad data to be inserted (if v2's finding was accurate)
- **Present**: Zero protection against future bad data
- **Future**: Seed script, scrapers, or manual entry could recreate the issue

**Why This is Critical**: Even if current data is clean, the issue WILL recur without constraints.

---

### Root Cause 2: Seed Script May Generate Random Dates (Needs Verification)

**Problem**: Plan v2 claimed seed script generates random dates. Need to verify current state.

**Investigation Needed**:
1. Read `web/scripts/seed-database.ts` lines 840-847
2. Check if date generation uses:
   - ❌ `faker.date.future()` (random)
   - ✅ `closeDate + 2/4/6 days` (sequential)

**Evidence**: TBD (need to read seed script)

**Impact If Random**:
- Every `npm run seed` creates new invalid test data
- Issue keeps recurring in development
- Calendar testing becomes unreliable

---

### Root Cause 3: No Automated Data Quality Checks (Confirmed)

**Problem**: No monitoring or validation for data quality issues.

**Missing Systems**:
- No script to check for timeline date violations
- No alerts when event count is abnormally high
- No validation before saving IPO records
- No data quality dashboard

**Impact**:
- Issues go undetected until users report problems
- No early warning system
- Reactive fixes instead of proactive prevention

---

## Implementation Plan

### Task 1: Comprehensive Current State Verification (30 minutes)

**Purpose**: Understand discrepancy between v2 findings and current database state.

**Step 1.1**: Count November 2025 Events
```sql
-- Count total events in November 2025
SELECT COUNT(*) as total_events
FROM (
  -- Opening events
  SELECT i.id, i.open_date as event_date, 'OPENING' as event_type
  FROM ipos i
  WHERE i.segment = 'MAINBOARD'
    AND i.open_date >= '2025-11-01' AND i.open_date <= '2025-11-30'

  UNION ALL

  -- Closing events
  SELECT i.id, i.close_date as event_date, 'CLOSING' as event_type
  FROM ipos i
  WHERE i.segment = 'MAINBOARD'
    AND i.close_date >= '2025-11-01' AND i.close_date <= '2025-11-30'

  UNION ALL

  -- Continuous application events (every day between open and close)
  SELECT i.id,
         generate_series(i.open_date, i.close_date, '1 day'::interval)::date as event_date,
         'OPEN_FOR_APPLICATION' as event_type
  FROM ipos i
  WHERE i.segment = 'MAINBOARD'
    AND i.open_date IS NOT NULL
    AND i.close_date IS NOT NULL
    AND (
      (i.open_date <= '2025-11-30' AND i.close_date >= '2025-11-01')
    )

  UNION ALL

  -- Timeline events
  SELECT i.id, id.basis_of_allotment_date as event_date, 'BASIS_OF_ALLOTMENT' as event_type
  FROM ipos i
  JOIN ipo_details id ON i.id = id.ipo_id
  WHERE i.segment = 'MAINBOARD'
    AND id.basis_of_allotment_date >= '2025-11-01'
    AND id.basis_of_allotment_date <= '2025-11-30'

  -- Add similar unions for other timeline dates...
) as all_events;
```

**Expected Result**:
- If 628 events: Issue still exists, proceed with cleanup
- If ~136 events: Issue already fixed, proceed with preventative measures only
- If 0-20 events: Test data may have been deleted, check Plan-Delete-Test-Data status

**Step 1.2**: Verify Timeline Date Quality
```sql
-- Find ALL IPOs with timeline dates > 30 days after close
SELECT
    i.company_name,
    i.close_date,
    id.basis_of_allotment_date,
    (id.basis_of_allotment_date - i.close_date) as basis_gap_days,
    id.initiation_of_refunds_date,
    (id.initiation_of_refunds_date - i.close_date) as refunds_gap_days,
    id.credit_of_shares_date,
    (id.credit_of_shares_date - i.close_date) as credit_gap_days,
    i.data_source
FROM ipos i
LEFT JOIN ipo_details id ON i.id = id.ipo_id
WHERE i.segment = 'MAINBOARD'
  AND i.close_date IS NOT NULL
  AND (
    (id.basis_of_allotment_date IS NOT NULL AND (id.basis_of_allotment_date - i.close_date) > 30)
    OR (id.initiation_of_refunds_date IS NOT NULL AND (id.initiation_of_refunds_date - i.close_date) > 30)
    OR (id.credit_of_shares_date IS NOT NULL AND (id.credit_of_shares_date - i.close_date) > 30)
  )
ORDER BY (id.basis_of_allotment_date - i.close_date) DESC NULLS LAST;
```

**Expected Results**:
- If > 0 records: Issue exists, proceed with cleanup
- If 0 records: Issue already resolved, document when/how it was fixed

**Step 1.3**: Check Seed Script Current State
```bash
# Read seed script date generation logic
grep -A 10 "basisOfAllotmentDate" web/scripts/seed-database.ts
```

**Testing**:
- [ ] November 2025 event count determined
- [ ] Timeline date quality verified
- [ ] Seed script logic reviewed
- [ ] Discrepancy between v2 and current state explained

**Files to Read**:
- `web/scripts/seed-database.ts` (lines 800-900)

**Documentation Created**:
- `docs/01-planning/Verification-Results-2025-11-15.md` (findings summary)

---

### Task 2: Create Data Cleanup Script (30 minutes) - CONDITIONAL

**Condition**: ONLY if Step 1.2 finds problematic records

**File**: `web/scripts/fix-timeline-dates.ts` (NEW)

**Purpose**: Fix any IPOs with timeline dates > 30 days after close_date

**Implementation**:
```typescript
import { db } from '@/lib/db';
import { ipos, ipoDetails } from '@ipodhan/shared/db/schema';
import { eq, and, sql } from 'drizzle-orm';

interface CleanupOptions {
  dryRun?: boolean;
}

async function fixTimelineDates(options: CleanupOptions = {}) {
  console.log('🔍 Scanning for problematic timeline dates...\n');

  // Find records where timeline dates are > 30 days after close_date
  const problematic = await db
    .select({
      ipoId: ipos.id,
      companyName: ipos.companyName,
      closeDate: ipos.closeDate,
      basisDate: ipoDetails.basisOfAllotmentDate,
      refundDate: ipoDetails.initiationOfRefundsDate,
      creditDate: ipoDetails.creditOfSharesDate,
    })
    .from(ipos)
    .leftJoin(ipoDetails, eq(ipoDetails.ipoId, ipos.id))
    .where(
      and(
        sql`${ipos.segment} = 'MAINBOARD'`,
        sql`${ipos.closeDate} IS NOT NULL`,
        sql`(
          (${ipoDetails.basisOfAllotmentDate} IS NOT NULL AND ${ipoDetails.basisOfAllotmentDate} - ${ipos.closeDate} > 30)
          OR (${ipoDetails.initiationOfRefundsDate} IS NOT NULL AND ${ipoDetails.initiationOfRefundsDate} - ${ipos.closeDate} > 30)
          OR (${ipoDetails.creditOfSharesDate} IS NOT NULL AND ${ipoDetails.creditOfSharesDate} - ${ipos.closeDate} > 30)
        )`
      )
    );

  console.log(`Found ${problematic.length} IPOs with invalid timeline dates\n`);

  if (problematic.length === 0) {
    console.log('✅ No problematic records found. Database is clean!');
    return;
  }

  // Display problematic records
  console.table(
    problematic.map(r => ({
      Company: r.companyName,
      CloseDate: r.closeDate,
      BasisGap: r.basisDate && r.closeDate
        ? `${Math.floor((r.basisDate.getTime() - r.closeDate.getTime()) / (1000 * 60 * 60 * 24))} days`
        : 'N/A',
      RefundGap: r.refundDate && r.closeDate
        ? `${Math.floor((r.refundDate.getTime() - r.closeDate.getTime()) / (1000 * 60 * 60 * 24))} days`
        : 'N/A',
    }))
  );

  if (options.dryRun) {
    console.log('\n🔸 DRY RUN MODE - No changes will be made');
    console.log('   Run without --dry-run flag to apply fixes');
    return;
  }

  console.log('\n⚠️  About to fix timeline dates:');
  console.log('   - Basis of Allotment: close_date + 2 days');
  console.log('   - Initiation of Refunds: close_date + 4 days');
  console.log('   - Credit of Shares: close_date + 6 days\n');

  // Fix each record
  let fixed = 0;
  for (const record of problematic) {
    if (!record.closeDate) continue;

    const closeDate = new Date(record.closeDate);

    const newBasisDate = new Date(closeDate);
    newBasisDate.setDate(newBasisDate.getDate() + 2);

    const newRefundDate = new Date(closeDate);
    newRefundDate.setDate(newRefundDate.getDate() + 4);

    const newCreditDate = new Date(closeDate);
    newCreditDate.setDate(newCreditDate.getDate() + 6);

    await db
      .update(ipoDetails)
      .set({
        basisOfAllotmentDate: newBasisDate,
        initiationOfRefundsDate: newRefundDate,
        creditOfSharesDate: newCreditDate,
      })
      .where(eq(ipoDetails.ipoId, record.ipoId));

    fixed++;
    console.log(`✓ Fixed: ${record.companyName}`);
  }

  console.log(`\n✅ Fixed ${fixed} IPO records`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

fixTimelineDates({ dryRun })
  .then(() => {
    console.log('\n✨ Cleanup complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error during cleanup:', error);
    process.exit(1);
  });
```

**Step 2.2**: Add npm script
```json
// web/package.json
{
  "scripts": {
    "fix-timeline-dates": "tsx scripts/fix-timeline-dates.ts",
    "fix-timeline-dates:dry-run": "tsx scripts/fix-timeline-dates.ts --dry-run"
  }
}
```

**Testing**:
- [ ] Dry run identifies correct number of records
- [ ] Dry run doesn't modify database
- [ ] Full run fixes all problematic records
- [ ] Verify no records remain with gaps > 30 days

**Files Created**:
- `web/scripts/fix-timeline-dates.ts`

**Files Modified**:
- `web/package.json` (add scripts)

---

### Task 3: Add Database Validation Constraints (45 minutes)

**Purpose**: Prevent future invalid timeline dates at database level

**File**: `packages/shared/src/db/schema.ts`

**Step 3.1**: Add CHECK constraints to ipoDetails table

**Location**: After ipoDetails table definition (around line 250-300)

```typescript
export const ipoDetails = pgTable('ipo_details', {
  id: text('id').primaryKey(),
  ipoId: text('ipo_id').notNull().references(() => ipos.id, { onDelete: 'cascade' }),

  // ... existing fields ...

  basisOfAllotmentDate: date('basis_of_allotment_date', { mode: 'date' }),
  initiationOfRefundsDate: date('initiation_of_refunds_date', { mode: 'date' }),
  creditOfSharesDate: date('credit_of_shares_date', { mode: 'date' }),

  // ... other fields ...
}, (table) => {
  return {
    // ✅ NEW: Timeline Date Validation Constraints

    // Basis of Allotment must be >= close_date and <= close_date + 30 days
    basisAfterCloseCheck: check(
      'basis_after_close',
      sql`
        basis_of_allotment_date IS NULL OR
        basis_of_allotment_date >= (
          SELECT close_date FROM ${ipos} WHERE id = ${table.ipoId}
        )
      `
    ),

    basisWithin30DaysCheck: check(
      'basis_within_30_days',
      sql`
        basis_of_allotment_date IS NULL OR
        basis_of_allotment_date <= (
          SELECT close_date FROM ${ipos} WHERE id = ${table.ipoId}
        ) + INTERVAL '30 days'
      `
    ),

    // Refund Initiation must be >= close_date and <= close_date + 30 days
    refundAfterCloseCheck: check(
      'refund_after_close',
      sql`
        initiation_of_refunds_date IS NULL OR
        initiation_of_refunds_date >= (
          SELECT close_date FROM ${ipos} WHERE id = ${table.ipoId}
        )
      `
    ),

    refundWithin30DaysCheck: check(
      'refund_within_30_days',
      sql`
        initiation_of_refunds_date IS NULL OR
        initiation_of_refunds_date <= (
          SELECT close_date FROM ${ipos} WHERE id = ${table.ipoId}
        ) + INTERVAL '30 days'
      `
    ),

    // Credit of Shares must be >= close_date and <= close_date + 30 days
    creditAfterCloseCheck: check(
      'credit_after_close',
      sql`
        credit_of_shares_date IS NULL OR
        credit_of_shares_date >= (
          SELECT close_date FROM ${ipos} WHERE id = ${table.ipoId}
        )
      `
    ),

    creditWithin30DaysCheck: check(
      'credit_within_30_days',
      sql`
        credit_of_shares_date IS NULL OR
        credit_of_shares_date <= (
          SELECT close_date FROM ${ipos} WHERE id = ${table.ipoId}
        ) + INTERVAL '30 days'
      `
    ),
  };
});
```

**Step 3.2**: Generate migration
```bash
cd web
npm run db:generate
```

**Step 3.3**: Review generated SQL
- Check `web/drizzle/migrations/XXXX_add_timeline_constraints.sql`
- Verify constraint names match what we expect
- Ensure constraints allow NULL values

**Step 3.4**: Apply migration
```bash
npm run db:migrate
```

**Testing**:
- [ ] Migration applies successfully without errors
- [ ] Attempt to insert record with invalid date (should fail with constraint violation)
- [ ] Attempt to insert record with valid date (should succeed)
- [ ] Attempt to insert record with NULL timeline dates (should succeed)
- [ ] Verify all 6 constraints exist in database schema

**Test Cases**:
```typescript
// SHOULD FAIL: basis_of_allotment_date before close_date
await db.insert(ipoDetails).values({
  ipoId: testIpoId,
  basisOfAllotmentDate: new Date('2025-11-10'), // close_date is 2025-11-15
});

// SHOULD FAIL: basis_of_allotment_date > 30 days after close_date
await db.insert(ipoDetails).values({
  ipoId: testIpoId,
  basisOfAllotmentDate: new Date('2025-12-20'), // close_date is 2025-11-15 (35 days gap)
});

// SHOULD SUCCEED: Valid dates within range
await db.insert(ipoDetails).values({
  ipoId: testIpoId,
  basisOfAllotmentDate: new Date('2025-11-17'), // close_date + 2 days ✅
  initiationOfRefundsDate: new Date('2025-11-19'), // close_date + 4 days ✅
  creditOfSharesDate: new Date('2025-11-21'), // close_date + 6 days ✅
});

// SHOULD SUCCEED: NULL values allowed
await db.insert(ipoDetails).values({
  ipoId: testIpoId,
  basisOfAllotmentDate: null,
  initiationOfRefundsDate: null,
  creditOfSharesDate: null,
});
```

**Files Modified**:
- `packages/shared/src/db/schema.ts` (add constraints)

**Files Created**:
- `web/drizzle/migrations/XXXX_add_timeline_constraints.sql` (generated)

---

### Task 4: Verify and Fix Seed Script (20 minutes)

**Purpose**: Ensure seed script generates realistic sequential dates

**File**: `web/scripts/seed-database.ts`

**Step 4.1**: Read current date generation logic

Check lines 800-900 for how timeline dates are generated.

**Expected Good Pattern** (from Plan v2):
```typescript
// Lines 840-847 (allegedly already fixed)
basisOfAllotmentDate: ipo.status === 'LISTED' || ipo.status === 'CLOSED'
  ? addDaysToDate(ipo.closeDate, 2) // 2 days after close ✅
  : null,

initiationOfRefundsDate: ipo.status === 'LISTED' || ipo.status === 'CLOSED'
  ? addDaysToDate(ipo.closeDate, 4) // 4 days after close ✅
  : null,

creditOfSharesDate: ipo.status === 'LISTED'
  ? addDaysToDate(ipo.closeDate, 6) // 6 days after close ✅
  : null,
```

**Bad Pattern** (if found, needs fixing):
```typescript
// ❌ Random dates without temporal logic
basisOfAllotmentDate: faker.date.future(),
initiationOfRefundsDate: faker.date.future(),
creditOfSharesDate: faker.date.future(),
```

**Step 4.2**: If bad pattern found, replace with sequential logic

Use the "Expected Good Pattern" above with proper date helper function:

```typescript
function addDaysToDate(date: Date | null, days: number): Date | null {
  if (!date) return null;
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
```

**Step 4.3**: Add validation checks before insert

```typescript
// Before inserting ipoDetails, validate timeline dates
if (ipoDetails.basisOfAllotmentDate && ipo.closeDate) {
  const gapDays = Math.floor(
    (ipoDetails.basisOfAllotmentDate.getTime() - ipo.closeDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (gapDays < 0 || gapDays > 30) {
    console.warn(`⚠️ Invalid basis date for ${ipo.companyName}: ${gapDays} days after close`);
  }
}
```

**Step 4.4**: Add warning at top of seed script

```typescript
console.warn(`
╔═══════════════════════════════════════════════════════════════╗
║                 ⚠️  TEST DATA GENERATION  ⚠️                  ║
╚═══════════════════════════════════════════════════════════════╝

This script generates FICTIONAL test data for development only.

✅ Timeline dates follow realistic business logic:
   • Basis of Allotment: close_date + 2 days
   • Initiation of Refunds: close_date + 4 days
   • Credit of Shares: close_date + 6 days
   • All dates within 30-day window

⚠️  For production, use ONLY:
   • NSE_SCRAPER / BSE_SCRAPER
   • MANUAL_ENTRY (verified data)
`);
```

**Testing**:
- [ ] Seed script generates dates with correct temporal logic
- [ ] All timeline dates are within 30 days of close_date
- [ ] Dates are in logical sequence (close → basis → refund → credit → listing)
- [ ] No constraint violations when inserting seed data
- [ ] Run `npm run seed:force` and verify with Drizzle Studio

**Files Modified**:
- `web/scripts/seed-database.ts` (if fixes needed)

---

### Task 5: Clear Cache and Verify Calendar (15 minutes)

**Purpose**: Test that calendar displays correctly with clean data

**Step 5.1**: Clear Redis cache
```bash
cd web
npm run clear-calendar-cache
```

**Step 5.2**: Restart dev server
```bash
npm run dev
```

**Step 5.3**: Navigate to calendar
- URL: `http://localhost:3000/mainboard-ipo-calendar`
- Navigate to November 2025

**Step 5.4**: Verify Metrics

**Expected State** (based on Step 1 verification):
- If data was fixed: ~136 events, cells 150-250px tall
- If data already clean: Varies based on real production data
- If test data deleted: May be empty or sparse

**Verification Checklist**:
- [ ] Event count is realistic (not 628)
- [ ] Cell heights are scannable (~150-250px, not 400-600px)
- [ ] Event grouping visible with section headers
- [ ] Event limiting working (max 3 per group by default)
- [ ] "+X more" buttons present and functional
- [ ] Expand/collapse works smoothly
- [ ] No fictional company names (if test data was deleted)
- [ ] No JavaScript errors in browser console

**Step 5.5**: Test multiple months
- Check October 2025
- Check December 2025
- Check January 2026
- Verify data distribution makes sense

**Testing**:
- [ ] Calendar loads without errors
- [ ] Event counts are realistic across all months
- [ ] UI is usable and scannable
- [ ] Performance is acceptable (<500ms load time)

---

## Testing Checklist

### Pre-Implementation Verification (Task 1):
- [ ] November 2025 event count determined (actual vs expected 628)
- [ ] Timeline date quality verified (actual vs expected 27 problematic IPOs)
- [ ] Seed script date generation logic reviewed
- [ ] Discrepancy between v2 and current state documented
- [ ] Verification results saved to `docs/01-planning/Verification-Results-2025-11-15.md`

### Data Cleanup (Task 2) - IF NEEDED:
- [ ] Dry run correctly identifies all problematic records
- [ ] Dry run doesn't modify database
- [ ] Full run fixes all records with gaps > 30 days
- [ ] Re-verify query shows 0 problematic records after fix
- [ ] November event count drops to expected ~136 (if was 628)

### Database Constraints (Task 3):
- [ ] Migration generates successfully (no SQL errors)
- [ ] Migration applies successfully to database
- [ ] All 6 CHECK constraints created:
  - [ ] `basis_after_close`
  - [ ] `basis_within_30_days`
  - [ ] `refund_after_close`
  - [ ] `refund_within_30_days`
  - [ ] `credit_after_close`
  - [ ] `credit_within_30_days`
- [ ] Constraint blocks invalid date (before close_date) ✅
- [ ] Constraint blocks invalid date (> 30 days after close_date) ✅
- [ ] Constraint allows valid date (close_date + 2-30 days) ✅
- [ ] Constraint allows NULL values ✅

### Seed Script (Task 4):
- [ ] Date generation logic reviewed (is it sequential or random?)
- [ ] If random: Fixed to use sequential logic
- [ ] If sequential: Verified correct implementation
- [ ] Warning message added to script output
- [ ] Validation checks added before insert
- [ ] Test run: `npm run seed:force` completes without constraint violations
- [ ] Sample IPO records inspected in Drizzle Studio show realistic dates

### Calendar Verification (Task 5):
- [ ] Redis cache cleared successfully
- [ ] Calendar loads without errors
- [ ] November 2025: Realistic event count (not 628)
- [ ] Cell heights reasonable (~150-250px)
- [ ] Event grouping visible with headers
- [ ] Event limiting working (max 3 per group)
- [ ] "+X more" buttons functional
- [ ] Multi-month navigation works correctly
- [ ] No browser console errors

---

## Success Metrics

### Before Fix (Expected Based on v2):
- ❌ **Event Count**: 628 events in November 2025
- ❌ **Problematic IPOs**: 27 IPOs with timeline dates 8-12 months in future
- ❌ **Cell Height**: 400-600px (unusable)
- ❌ **Database Constraints**: None (no validation)
- ❌ **Seed Script**: May generate random or invalid dates
- ❌ **Data Quality Monitoring**: None

### After Fix (Target State):
- ✅ **Event Count**: ~136 events in November 2025 (realistic)
- ✅ **Problematic IPOs**: 0 IPOs with invalid timeline dates
- ✅ **Cell Height**: ~150-250px (scannable and usable)
- ✅ **Database Constraints**: 6 CHECK constraints enforcing temporal logic
- ✅ **Seed Script**: Generates sequential realistic dates (close_date + 2/4/6 days)
- ✅ **Data Quality Monitoring**: Script available to check data quality

### Performance Targets:
- Calendar page load: < 500ms (unchanged - no performance regression)
- Database query time: < 100ms (unchanged - query is already optimized)
- Calendar cell render: < 50ms per cell (may improve due to fewer events)
- Migration apply time: < 5 seconds (one-time operation)

---

## Files to Create

### New Scripts:
1. **`web/scripts/fix-timeline-dates.ts`** - Data cleanup script with dry-run mode (CONDITIONAL - only if needed)

### New Documentation:
1. **`docs/01-planning/Verification-Results-2025-11-15.md`** - Current state verification findings
2. **`docs/16-database/TIMELINE_DATE_BUSINESS_RULES.md`** - Document expected date relationships

### New Migrations:
1. **`web/drizzle/migrations/XXXX_add_timeline_constraints.sql`** - Generated migration file

---

## Files to Modify

### Schema:
1. **`packages/shared/src/db/schema.ts`** - Add 6 CHECK constraints to ipoDetails table

### Scripts:
1. **`web/scripts/seed-database.ts`** - Verify/fix date generation logic, add warnings (CONDITIONAL)
2. **`web/package.json`** - Add cleanup script (if created)

### Files NOT Modified (Already Correct):
- ✅ `web/components/calendar/MainboardIPOCalendarGrid.tsx` - CSS modules integrated, event grouping works
- ✅ `web/components/calendar/CalendarEventGroup.tsx` - Event limiting implemented
- ✅ `web/components/calendar/MainboardIPOCalendarGrid.module.css` - Responsive behavior correct
- ✅ `web/lib/services/mainboard-calendar-service.ts` - Business logic is sound
- ✅ `web/lib/services/mainboard-calendar-types.ts` - Type definitions correct

---

## Timeline

**Task 1**: 30 minutes (Comprehensive current state verification)
**Task 2**: 30 minutes (Create cleanup script - CONDITIONAL if needed)
**Task 3**: 45 minutes (Add database CHECK constraints + migration)
**Task 4**: 20 minutes (Verify/fix seed script date generation)
**Task 5**: 15 minutes (Clear cache and verify calendar display)

**Total Estimated Time**:
- **Maximum**: 2 hours 20 minutes (if cleanup needed)
- **Minimum**: 1 hour 50 minutes (if data already clean, skip Task 2)

---

## Risk Assessment

### Low Risk ✅
- **Verification queries**: Read-only, no data modifications
- **Dry run mode**: Can test cleanup script safely
- **Database constraints**: Applied after data cleanup, won't block existing valid data
- **Seed script fixes**: Only affects future test data generation

### Medium Risk ⚠️
- **CHECK constraints**: Could fail if existing data violates constraints
  - **Mitigation**: Run cleanup script BEFORE adding constraints
- **Migration rollback**: CHECK constraints may be complex to remove
  - **Mitigation**: Document constraint names for easy DROP if needed

### Mitigation Strategies:
1. **Always verify first** (Task 1) before making changes
2. **Use dry-run mode** for cleanup script
3. **Clean data BEFORE** adding constraints
4. **Test constraints** on sample data before production
5. **Document all changes** for easy rollback

---

## Production Deployment Considerations

### Before Deploying to Production:
- [ ] Verify production database doesn't have similar data quality issues
- [ ] Create production database backup (CRITICAL!)
- [ ] Run cleanup script in dry-run mode first
- [ ] Review which records would be modified
- [ ] Apply cleanup script if needed
- [ ] Apply migration to add constraints
- [ ] Monitor application logs for constraint violations
- [ ] Add data quality monitoring dashboard

### Post-Deployment Monitoring:
- [ ] Set up alert if monthly event count > 300 (threshold for investigation)
- [ ] Monitor constraint violations in database logs
- [ ] Track calendar page performance metrics
- [ ] User feedback on calendar usability

---

## Related Documentation

### Previous Plans:
- **v1**: `docs/01-planning/Plan-Calendar-Fixes-2025-11-15-v1.md` (INVALID - UI assumptions wrong)
- **v2**: `docs/01-planning/Plan-Calendar-Fixes-2025-11-15-v2.md` (Data quality focus - needs verification)
- **Delete Test Data**: `docs/01-planning/Plan-Delete-Test-Data-2025-11-15-v1.md` (Separate concern)

### Architecture Documentation:
- **Calendar Service**: `web/lib/services/mainboard-calendar-service.ts`
- **Schema Management**: `docs/16-database/SCHEMA_MANAGEMENT.md`
- **Backend Architecture**: `docs/02-architecture/backend-architecture.md`
- **Caching Strategy**: `docs/05-caching/CACHING_STRATEGY.md`

### Feature Documentation:
- **Story 15.1**: Continuous application period events
- **Story 15.4**: Event grouping and limiting
- **Story 4.12**: Extended timeline events

---

## Lessons Learned from v1 & v2

### From v1:
- ❌ **Never assume code is broken without verification**
- ✅ **Always read actual implementation before planning fixes**
- ✅ **Screenshots can be misleading - verify in codebase**

### From v2:
- ✅ **Correct diagnosis**: Identified data quality as root cause (not code)
- ✅ **Good investigation**: Checked database for problematic records
- ❓ **Verification gap**: Current state differs from v2 findings (0 vs 27 records)
- 📚 **Lesson**: Always re-verify before implementing, especially if time has passed

### From v3 (This Plan):
- ✅ **Comprehensive verification first** before any changes
- ✅ **Preventative measures** (constraints) even if issue is already fixed
- ✅ **Documentation** of verification process and findings
- ✅ **Conditional execution** based on actual state, not assumptions

---

## Next Actions

1. **Immediate**: Execute Task 1 (Comprehensive Verification) to understand current state
2. **Then**: Based on verification results, decide which tasks are needed:
   - If problematic records found: Execute all tasks (1-5)
   - If no problematic records: Execute Tasks 3-5 only (preventative measures)
3. **Finally**: Document findings in `Verification-Results-2025-11-15.md`

---

**Last Updated**: 2025-11-15 18:30
**Status**: 🔴 AWAITING IMPLEMENTATION
**Next Step**: Execute Task 1 - Comprehensive Current State Verification
**Estimated Completion**: 2025-11-15 20:30 (if all tasks needed) or 2025-11-15 20:00 (if cleanup not needed)

