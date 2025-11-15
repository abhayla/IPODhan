# Plan: Mainboard IPO Calendar Fixes - Data Quality Edition

**Date**: 2025-11-15
**Version**: v2
**Status**: 🟡 IN PROGRESS
**Priority**: P0 CRITICAL - Production Blocker
**Estimated Time**: 1.5 hours
**Last Verified**: 2025-11-15 (via database analysis + screenshots)

---

## Changes from v1

**v1 Plan Status**: ❌ INVALID - Based on incorrect assumptions

**Key Findings**:
- v1 assumed CSS modules weren't integrated → **INCORRECT**: CSS modules ARE integrated (line 21 of MainboardIPOCalendarGrid.tsx)
- v1 assumed events weren't grouped → **INCORRECT**: CalendarEventGroup component EXISTS and is being used
- v1 assumed event limiting wasn't implemented → **INCORRECT**: "+X more" buttons ARE working
- v1 focused on UI/component fixes → **INCORRECT**: UI code is working correctly

**v2 Root Cause Discovery**:
- Investigated codebase: All UI components are correctly implemented
- Analyzed database: Found 628 events instead of expected ~136 events
- Root cause: **Unrealistic test data** - 27 IPOs from Nov 2024-Mar 2025 have timeline dates set to November 2025 (12 months in future)

**v2 Focus**: Data quality fixes (database cleanup + validation constraints)

---

## Executive Summary

The Mainboard IPO Calendar displays **628 events in November 2025** causing unusable tall cells (400-600px). Investigation revealed this is **NOT a code bug** but a **data quality issue**. The calendar service correctly shows all events for IPOs with any date in November 2025, but test data contains 27 IPOs from past months with impossible timeline dates (Basis of Allotment, Refund dates) set 12 months in the future. This violates real-world IPO timelines where all milestones complete within 2-3 weeks.

**Solution**: Clean up test data, add database validation constraints, fix seed script.

---

## Current State (Verified via Code + Database Analysis)

### What's Working ✅

**1. UI Components (All Correctly Implemented)**
- CSS modules integrated: `import styles from './MainboardIPOCalendarGrid.module.css'` (line 21)
- Responsive display working: Desktop grid hidden on mobile, mobile list hidden on desktop
- Event grouping implemented: Uses `CalendarEventGroup` component with group headers
- Event limiting working: Shows max 3 events per group with "+X more" buttons
- Expand/collapse functionality: Client-side state management working

**Evidence**:
```typescript
// web/components/calendar/MainboardIPOCalendarGrid.tsx (line 115-124)
{dateEvents.eventGroups.map((group) => (
  <CalendarEventGroup
    key={group.type}
    groupType={group.label}
    events={group.events}
    maxEvents={3}  // ✅ Event limiting IS implemented
    size="compact"
  />
))}
```

**2. Service Layer (Correctly Designed)**
- `groupEventsByType()` exists and works (mainboard-calendar-service.ts:317-348)
- `getEventTypePriority()` exists and works (mainboard-calendar-service.ts:235-248)
- `eventGroups` property exists in CalendarDateEvents interface

**3. Calendar Data Fetching**
- Repository query correctly fetches IPOs with ANY date in November 2025
- This is architecturally correct - service should show all relevant events

### What's Broken ❌

**1. Unrealistic Event Count**
- **Actual**: 628 events in November 2025
- **Expected**: ~136 events (15 legitimate IPOs × ~9 events each)
- **Discrepancy**: 492 extra events (362% inflation)
- **Impact**: Calendar cells are 400-600px tall, unusable for users

**2. Invalid Database Records**
- 27 IPOs from Nov 2024, Dec 2024, Jan-Mar 2025 have:
  - `basis_of_allotment_date` set to November 2025
  - `initiation_of_refunds_date` set to November 2025
  - `credit_of_shares_date` set to November 2025
- These dates are 8-12 months AFTER the IPO closed
- Real-world IPO timeline: All milestones complete within 2-3 weeks

**3. No Data Validation**
- Database has no CHECK constraints on timeline dates
- Seed script generates random dates without temporal logic
- No data quality monitoring

**Evidence from Screenshots**:
- Screenshot 4: November 7, 2025 shows 14 different event groups
- Screenshot 6: "628 events in November 2025" displayed at bottom
- Screenshot 5: Single day has 8+ event group types (OPENING, CLOSING, OPEN FOR APPLICATION, BASIS OF ALLOTMENT, REFUND, CREDIT OF SHARES, etc.)

---

## Root Cause Analysis

### Root Cause 1: Invalid Timeline Dates in ipo_details Table

**Problem**: IPOs from past months have timeline dates set to November 2025

**Sample Problematic Records** (from database analysis):

| Company Name | Close Date | Basis of Allotment | Initiation of Refunds | Gap (Days) |
|--------------|------------|--------------------|-----------------------|------------|
| National Corporation Ltd | 2024-11-19 | **2025-11-13** | **2025-11-12** | **~360 days** ⚠️ |
| Royal Industries Ltd | 2024-11-19 | **2025-11-12** | **2025-11-12** | **~360 days** ⚠️ |
| Integrated Financial Services | 2024-12-11 | **2025-11-10** | **2025-11-11** | **~335 days** ⚠️ |
| Apex Solutions Ltd | 2025-01-14 | **2025-11-11** | **2025-11-13** | **~300 days** ⚠️ |

**Real-World IPO Timeline** (for comparison):
```
Day 0: IPO Opens
Day 3-10: IPO Closes
Day +2: Basis of Allotment finalized
Day +4: Initiation of Refunds
Day +6: Credit of Shares to Demat
Day +10-14: Listing on exchange

Maximum gap: 2-3 weeks (NOT 12 months!)
```

**Impact**:
- 27 IPOs × ~9-15 events each = 243-405 extra events
- Calendar service correctly includes these events (any IPO with date in Nov 2025)
- UI becomes unusable due to event count

---

### Root Cause 2: No Database Validation Constraints

**Problem**: Database schema allows impossible timeline dates

**Current Schema** (packages/shared/src/db/schema.ts):
```typescript
export const ipoDetails = pgTable('ipo_details', {
  // ...
  basisOfAllotmentDate: date('basis_of_allotment_date', { mode: 'date' }),
  initiationOfRefundsDate: date('initiation_of_refunds_date', { mode: 'date' }),
  creditOfSharesDate: date('credit_of_shares_date', { mode: 'date' }),
  // ❌ NO CHECK CONSTRAINTS
});
```

**Missing Constraints**:
1. Timeline dates must be >= close_date
2. Timeline dates must be <= close_date + 30 days
3. Dates must be in logical sequence

**Impact**: Seed script and manual data entry can create invalid records

---

### Root Cause 3: Seed Script Generates Random Dates

**Problem**: `web/scripts/seed.ts` doesn't enforce temporal relationships

**Current Behavior** (suspected):
- Generates random dates for each field independently
- No validation that timeline dates come AFTER close_date
- No validation that dates are within realistic range

**Impact**: Every test data regeneration creates more invalid records

---

## Implementation Plan

### Task 1: Create Database Cleanup Script (30 minutes)

**File**: `web/scripts/fix-timeline-dates.ts` (NEW)

**Step 1.1**: Create script structure
```typescript
import { db } from '@/lib/db';
import { ipos, ipoDetails } from '@ipodhan/shared/db/schema';
import { eq, isNotNull, sql } from 'drizzle-orm';

async function fixTimelineDates() {
  console.log('Starting timeline date cleanup...');

  // Find problematic records
  const problematicRecords = await db
    .select()
    .from(ipoDetails)
    .innerJoin(ipos, eq(ipoDetails.ipoId, ipos.id))
    .where(/* timeline dates > close_date + 30 days */);

  console.log(`Found ${problematicRecords.length} records to fix`);

  // Update each record with realistic dates
  // ...
}
```

**Step 1.2**: Implement date recalculation logic
```typescript
// For each problematic record:
const closeDate = record.ipos.closeDate;
if (!closeDate) continue;

const basisOfAllotment = new Date(closeDate);
basisOfAllotment.setDate(basisOfAllotment.getDate() + 2);

const refundDate = new Date(closeDate);
refundDate.setDate(refundDate.getDate() + 4);

const creditDate = new Date(closeDate);
creditDate.setDate(creditDate.getDate() + 6);

await db.update(ipoDetails)
  .set({
    basisOfAllotmentDate: basisOfAllotment,
    initiationOfRefundsDate: refundDate,
    creditOfSharesDate: creditDate,
  })
  .where(eq(ipoDetails.ipoId, record.ipos.id));
```

**Step 1.3**: Add npm script in package.json
```json
"scripts": {
  "fix-timeline-dates": "tsx scripts/fix-timeline-dates.ts"
}
```

**Testing**:
- [ ] Run script: `npm run fix-timeline-dates`
- [ ] Verify ~27 records updated
- [ ] Check November 2025 event count drops to ~136

**Files Modified**:
- `web/scripts/fix-timeline-dates.ts` (NEW)
- `web/package.json` (add script)

---

### Task 2: Add Database Validation Constraints (45 minutes)

**File**: `packages/shared/src/db/schema.ts`

**Step 2.1**: Add CHECK constraints to ipoDetails table

**Location**: After `ipoDetails` table definition (around line 250)

```typescript
export const ipoDetails = pgTable('ipo_details', {
  id: text('id').primaryKey(),
  ipoId: text('ipo_id').notNull().references(() => ipos.id, { onDelete: 'cascade' }),

  // ... existing fields ...

  basisOfAllotmentDate: date('basis_of_allotment_date', { mode: 'date' }),
  initiationOfRefundsDate: date('initiation_of_refunds_date', { mode: 'date' }),
  creditOfSharesDate: date('credit_of_shares_date', { mode: 'date' }),

  // ... other fields ...
}, (table) => ({
  // ✅ ADD THESE CONSTRAINTS:

  // Basis of Allotment must be after close date and within 30 days
  basisOfAllotmentValidation: check(
    'basis_of_allotment_after_close',
    sql`
      basis_of_allotment_date IS NULL OR
      basis_of_allotment_date >= (SELECT close_date FROM ipos WHERE id = ipo_id)
    `
  ),
  basisOfAllotmentRangeValidation: check(
    'basis_of_allotment_within_30_days',
    sql`
      basis_of_allotment_date IS NULL OR
      basis_of_allotment_date <= (SELECT close_date FROM ipos WHERE id = ipo_id) + INTERVAL '30 days'
    `
  ),

  // Refund initiation must be after close date and within 30 days
  refundValidation: check(
    'refund_after_close',
    sql`
      initiation_of_refunds_date IS NULL OR
      initiation_of_refunds_date >= (SELECT close_date FROM ipos WHERE id = ipo_id)
    `
  ),
  refundRangeValidation: check(
    'refund_within_30_days',
    sql`
      initiation_of_refunds_date IS NULL OR
      initiation_of_refunds_date <= (SELECT close_date FROM ipos WHERE id = ipo_id) + INTERVAL '30 days'
    `
  ),

  // Credit of shares must be after close date and within 30 days
  creditValidation: check(
    'credit_after_close',
    sql`
      credit_of_shares_date IS NULL OR
      credit_of_shares_date >= (SELECT close_date FROM ipos WHERE id = ipo_id)
    `
  ),
  creditRangeValidation: check(
    'credit_within_30_days',
    sql`
      credit_of_shares_date IS NULL OR
      credit_of_shares_date <= (SELECT close_date FROM ipos WHERE id = ipo_id) + INTERVAL '30 days'
    `
  ),
}));
```

**Step 2.2**: Generate migration
```bash
cd web
npm run db:generate
```

**Step 2.3**: Review generated SQL in `web/drizzle/migrations/`

**Step 2.4**: Apply migration
```bash
npm run db:migrate
```

**Testing**:
- [ ] Try to insert record with invalid timeline date - should fail
- [ ] Try to insert record with valid timeline date - should succeed
- [ ] Verify constraints show in database schema

**Files Modified**:
- `packages/shared/src/db/schema.ts` (add constraints)
- `web/drizzle/migrations/XXXX_add_timeline_validation.sql` (generated)

---

### Task 3: Fix Seed Script Date Generation (15 minutes)

**File**: `web/scripts/seed.ts`

**Step 3.1**: Locate date generation logic

Find where `ipoDetails` records are created (search for "ipoDetails" or "basis_of_allotment")

**Step 3.2**: Replace with sequential date logic

**BEFORE** (suspected):
```typescript
// Random dates without validation
basisOfAllotmentDate: faker.date.future(),
initiationOfRefundsDate: faker.date.future(),
creditOfSharesDate: faker.date.future(),
```

**AFTER**:
```typescript
// Calculate dates sequentially based on close_date
const closeDate = ipo.closeDate; // From parent IPO record

// Basis of Allotment: Always 2 days after close
const basisOfAllotment = closeDate ? new Date(closeDate) : null;
if (basisOfAllotment) {
  basisOfAllotment.setDate(basisOfAllotment.getDate() + 2);
}

// Refund Initiation: Always 4 days after close
const refundDate = closeDate ? new Date(closeDate) : null;
if (refundDate) {
  refundDate.setDate(refundDate.getDate() + 4);
}

// Credit of Shares: Always 6 days after close
const creditDate = closeDate ? new Date(closeDate) : null;
if (creditDate) {
  creditDate.setDate(creditDate.getDate() + 6);
}

// Use in ipoDetails creation:
basisOfAllotmentDate: basisOfAllotment,
initiationOfRefundsDate: refundDate,
creditOfSharesDate: creditDate,
```

**Step 3.3**: Also fix other date relationships

Ensure:
- `closeDate` = `openDate` + 3-10 days (random)
- `allotmentDate` = `closeDate` + 5-7 days (random)
- `listingDate` = `closeDate` + 10-14 days (random)
- All timeline dates within 30 days of `closeDate`

**Testing**:
- [ ] Run `npm run seed:force`
- [ ] Check 10 sample IPO records in Drizzle Studio
- [ ] Verify all timeline dates are within 30 days of close_date
- [ ] Verify dates are in logical sequence

**Files Modified**:
- `web/scripts/seed.ts` (fix date generation)

---

### Task 4: Verify Calendar Display (10 minutes)

**Step 4.1**: Run cleanup and reseed
```bash
cd web
npm run fix-timeline-dates
npm run seed:force  # Optional: Regenerate all test data
```

**Step 4.2**: Clear cache
```bash
# Clear Redis cache for calendar data
redis-cli FLUSHDB
```

**Step 4.3**: Navigate to calendar
- URL: `http://localhost:3000/mainboard-ipo-calendar`
- Click to November 2025

**Step 4.4**: Verify metrics
- [ ] Event count at bottom: ~136 events (not 628)
- [ ] Cell heights: ~150-250px (not 400-600px)
- [ ] Busiest day (Nov 7-14): Max 6-8 event groups per day
- [ ] Each group shows max 3 events with "+X more" buttons
- [ ] Expand/collapse works smoothly

**Step 4.5**: Check Drizzle Studio
```bash
npm run db:studio
```
- [ ] Open `ipo_details` table
- [ ] Sort by `basis_of_allotment_date`
- [ ] Verify no dates are >30 days after close_date

---

## Testing Checklist

### Database Cleanup (Task 1)
- [ ] Script identifies ~27 problematic records
- [ ] Script updates records with realistic dates
- [ ] No errors during update
- [ ] November 2025 event count drops from 628 to ~136

### Validation Constraints (Task 2)
- [ ] Migration applies successfully
- [ ] Constraint prevents `basis_of_allotment_date` > close_date + 30 days
- [ ] Constraint allows valid dates (close_date + 2 days)
- [ ] Constraint allows NULL values
- [ ] Same validation for refund and credit dates

### Seed Script (Task 3)
- [ ] Reseed generates realistic dates
- [ ] All timeline dates within 30 days of close_date
- [ ] Dates in logical sequence (close → basis → refund → credit → listing)
- [ ] No constraint violations during seed

### Calendar Display (Task 4)
- [ ] November 2025 shows ~15 IPOs
- [ ] Event count: ~136 events total
- [ ] Cell heights reasonable (~150-250px)
- [ ] Event grouping visible with headers
- [ ] Event limiting working (max 3 per group)
- [ ] "+X more" buttons present and functional

---

## Success Metrics

### Before Fix (Current State)
- ❌ **Event Count**: 628 events in November 2025
- ❌ **IPOs Displayed**: 42 IPOs (15 legitimate + 27 with invalid dates)
- ❌ **Cell Height**: 400-600px (unusable)
- ❌ **Data Quality**: 27 IPOs with timeline dates 8-12 months in future
- ❌ **Database Constraints**: None (no validation)
- ❌ **Seed Script**: Generates random dates without temporal logic

### After Fix (Target State)
- ✅ **Event Count**: ~136 events in November 2025 (realistic)
- ✅ **IPOs Displayed**: 15 legitimate IPOs only
- ✅ **Cell Height**: ~150-250px (scannable and usable)
- ✅ **Data Quality**: All timeline dates within 30 days of close_date
- ✅ **Database Constraints**: 6 CHECK constraints enforcing temporal logic
- ✅ **Seed Script**: Generates sequential, realistic dates

### Performance Targets
- Calendar load time: < 500ms (unchanged - no performance issues)
- Database query time: < 100ms (unchanged - query is efficient)
- Calendar cell render: < 50ms per cell (improved due to fewer events)

---

## Files to Modify

### New Files
1. `web/scripts/fix-timeline-dates.ts` - Database cleanup script

### Modified Files
1. `packages/shared/src/db/schema.ts` - Add CHECK constraints to ipoDetails table
2. `web/scripts/seed.ts` - Fix date generation logic
3. `web/package.json` - Add cleanup script
4. `web/drizzle/migrations/XXXX_add_timeline_validation.sql` - Generated migration

### Files NOT Modified (Already Correct)
- `web/components/calendar/MainboardIPOCalendarGrid.tsx` ✅
- `web/components/calendar/CalendarEventGroup.tsx` ✅
- `web/components/calendar/MainboardIPOCalendarGrid.module.css` ✅
- `web/lib/services/mainboard-calendar-service.ts` ✅
- `web/lib/services/mainboard-calendar-types.ts` ✅

---

## Timeline

**Task 1**: 30 minutes (Database cleanup script + execution)
**Task 2**: 45 minutes (Schema constraints + migration)
**Task 3**: 15 minutes (Fix seed script)
**Task 4**: 10 minutes (Verification)

**Total Estimated Time**: **1.5 hours**

---

## Risk Assessment

### Low Risk ✅
- **Data cleanup**: Read-only investigation confirmed the issue
- **Constraints**: Applied after cleanup, won't affect existing valid data
- **Seed script**: Only affects future test data generation

### Medium Risk ⚠️
- **Production deployment**: Real production data may have similar issues
- **Migration rollback**: CHECK constraints can be complex to remove

### Mitigation Strategies
1. **Test cleanup script on staging first** - Verify record count matches expectation
2. **Backup database before migration** - Easy rollback if constraints fail
3. **Add data quality monitoring** - Alert if event count > threshold
4. **Document constraint names** - Easy to drop if needed for rollback

---

## Production Deployment Checklist

Before deploying to production:
- [ ] Run cleanup script on production database (backup first!)
- [ ] Verify production event counts are realistic
- [ ] Apply migration to add constraints
- [ ] Monitor error logs for constraint violations
- [ ] Add data quality dashboard to detect future issues
- [ ] Document timeline date business rules for manual entry

---

## Related Documentation

- **v1 Plan**: `docs/01-planning/Plan-Calendar-Fixes-2025-11-15-v1.md` (superseded - assumed UI bugs)
- **Calendar Service**: `web/lib/services/mainboard-calendar-service.ts`
- **Schema Management**: `docs/16-database/SCHEMA_MANAGEMENT.md`
- **Seed Script**: `web/scripts/seed.ts`
- **Database Architecture**: `docs/02-architecture/backend-architecture.md`

---

## Lessons Learned

### Investigation Process
1. ✅ **Verified codebase first** - Discovered UI components were already correct
2. ✅ **Analyzed screenshots** - Saw event grouping WAS working
3. ✅ **Checked database** - Found root cause in test data
4. ✅ **Traced data flow** - Repository → Service → UI (all correct)

### Key Insight
**The planning process revealed a critical mistake**: Assuming code bugs without verifying current implementation. The real issue was hidden in test data quality, not in application code.

### Best Practices Reinforced
- Always verify current state before planning fixes
- Check database data quality, not just code
- Test data should mirror production realism
- Add validation constraints to prevent bad data

---

**Last Updated**: 2025-11-15 16:45
**Status**: 🟡 IN PROGRESS
**Next Action**: Create cleanup script (Task 1)
**Estimated Completion**: 2025-11-15 18:15
