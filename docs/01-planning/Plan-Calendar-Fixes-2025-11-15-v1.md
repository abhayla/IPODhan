# Plan: Mainboard IPO Calendar Fixes

**Date**: 2025-11-15
**Version**: v1
**Status**: 🔴 AWAITING IMPLEMENTATION
**Priority**: P0 CRITICAL - Production Blocker
**Estimated Time**: 1.75 hours
**Last Verified**: 2025-11-15 (via user screenshots)

---

## Executive Summary

The Mainboard IPO Calendar at `/mainboard-ipo-calendar` has **critical UX and architectural issues** preventing production deployment. User-provided screenshots (Nov Month Issue-1 through Issue-5.png) reveal the calendar is displaying **614 events in November 2025** without any event limiting, resulting in unusable 500-800px tall cells and both desktop/mobile views rendering simultaneously.

---

## Current State (Verified via Screenshots)

### What's Broken ❌

1. **Both Views Rendering Simultaneously**
   - Desktop 7-column grid visible
   - Mobile vertical list visible
   - Both show on same page causing duplicate dates
   - Responsive behavior completely broken

2. **No Event Limiting**
   - All 614 events in November 2025 fully expanded
   - No "+X more" buttons visible
   - No expand/collapse functionality
   - Each calendar cell shows 10-20+ events

3. **Unusable Cell Heights**
   - Calendar cells are 500-800px tall
   - Impossible to scan visually
   - Requires excessive scrolling
   - User experience is catastrophic

4. **Event Grouping Not Working**
   - Events show in flat lists, not grouped sections
   - No section headers like "OPENING TODAY (3)"
   - No priority-based organization

### What's Working ✅

1. **Event Data**
   - 614 events in November 2025 is correct count
   - IPO names and dates appear accurate
   - Color coding by event type works
   - Links to detail pages functional

2. **Calendar Structure**
   - Month navigation works
   - Date headers display correctly
   - Basic calendar grid renders

---

## Root Cause Analysis

### Issue 1: CSS Module Never Integrated

**Problem**: File `MainboardIPOCalendarGrid.module.css` exists but is NEVER imported or used.

**Evidence**:
```typescript
// Current Code (WRONG):
<div style={{ display: 'none' }} className="lg:!block">  // Desktop grid
<div style={{ display: 'block' }} className="lg:!hidden space-y-3">  // Mobile list
```

**Impact**: Inline styles don't work properly, both views render at once.

---

### Issue 2: Event Limiting Not Implemented

**Problem**: No code exists to limit events per group to 3 and show "+X more" button.

**Evidence from screenshots**:
- Days showing 10-20+ events all expanded
- No "+X more" buttons anywhere
- No CalendarEventGroup component being used

**Impact**: November 2025 (614 events) is completely unusable.

---

### Issue 3: Event Grouping Not Rendering

**Problem**: Events not organized into priority sections (CLOSING TODAY, OPENING TODAY, etc.)

**Evidence**: Screenshots show flat lists, not grouped sections with headers.

**Impact**: Users can't prioritize urgent events (IPOs closing soon).

---

## Implementation Plan

### Task 1: Fix Responsive Display (P0 - 15 minutes)

**File**: `web/components/calendar/MainboardIPOCalendarGrid.tsx`

**Step 1.1**: Import CSS Module (line ~1)
```typescript
import styles from './MainboardIPOCalendarGrid.module.css';
```

**Step 1.2**: Replace Desktop Grid Inline Styles (line ~178)
```typescript
// BEFORE:
<div style={{ display: 'none' }} className="lg:!block">

// AFTER:
<div className={styles['calendar-desktop-grid']}>
```

**Step 1.3**: Replace Mobile List Inline Styles (line ~215)
```typescript
// BEFORE:
<div style={{ display: 'block' }} className="lg:!hidden space-y-3">

// AFTER:
<div className={`${styles['calendar-mobile-list']} space-y-3`}>
```

**Step 1.4**: Verify CSS Module Content
File `web/components/calendar/MainboardIPOCalendarGrid.module.css` should contain:
```css
.calendar-desktop-grid {
  display: none;
}

.calendar-mobile-list {
  display: block;
}

@media (min-width: 1024px) {
  .calendar-desktop-grid {
    display: block !important;
  }
  .calendar-mobile-list {
    display: none !important;
  }
}
```

**Testing**:
- [ ] At 375px: Only mobile list visible, desktop grid hidden
- [ ] At 1440px: Only desktop grid visible, mobile list hidden
- [ ] No duplicate dates at any breakpoint

---

### Task 2: Implement Event Limiting (P0 - 45 minutes)

**Problem**: Need to cap events at 3 per group with "+X more" expand button.

**Step 2.1**: Create CalendarEventGroup Component

**File**: `web/components/calendar/CalendarEventGroup.tsx` (NEW)

```typescript
'use client';

import { useState } from 'react';
import { CalendarEvent } from '@/lib/services/mainboard-calendar-service';
import Link from 'next/link';

interface CalendarEventGroupProps {
  groupType: string;
  events: CalendarEvent[];
  maxEvents?: number;
  size?: 'compact' | 'normal';
}

export function CalendarEventGroup({
  groupType,
  events,
  maxEvents = 3,
  size = 'normal'
}: CalendarEventGroupProps) {
  const [expanded, setExpanded] = useState(false);

  const displayEvents = expanded ? events : events.slice(0, maxEvents);
  const hasMore = events.length > maxEvents;

  const getEventColor = (type: string) => {
    const colors: Record<string, string> = {
      'OPENING_TODAY': 'text-green-600',
      'CLOSING_TODAY': 'text-red-600',
      'OPEN_FOR_APPLICATION': 'text-blue-600',
      'LISTING': 'text-amber-600',
      'ALLOTMENT': 'text-blue-600',
      'BASIS_OF_ALLOTMENT': 'text-indigo-600',
      'REFUND': 'text-purple-600',
      'CREDIT_OF_SHARES': 'text-teal-600',
      'HOLIDAY': 'text-gray-500',
    };
    return colors[type] || 'text-gray-700';
  };

  return (
    <div className="mb-3">
      {/* Section Header */}
      <div className="font-semibold text-xs text-gray-600 uppercase mb-1">
        {groupType} ({events.length})
      </div>

      {/* Events */}
      <div className={`space-y-1 pl-2 border-l-2 border-gray-300`}>
        {displayEvents.map((event, idx) => (
          <div key={`${event.ipoId}-${idx}`} className={size === 'compact' ? 'text-xs' : 'text-sm'}>
            <Link
              href={`/ipo/${event.slug}`}
              className={`hover:underline ${getEventColor(event.type)}`}
            >
              {event.companyName}
            </Link>
          </div>
        ))}
      </div>

      {/* Expand/Collapse Button */}
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-blue-600 hover:text-blue-800 mt-1 pl-2"
        >
          {expanded
            ? '▲ Show less'
            : `▼ +${events.length - maxEvents} more`
          }
        </button>
      )}
    </div>
  );
}
```

**Step 2.2**: Update MainboardIPOCalendarGrid to Use CalendarEventGroup

**File**: `web/components/calendar/MainboardIPOCalendarGrid.tsx`

Add import:
```typescript
import { CalendarEventGroup } from './CalendarEventGroup';
```

Replace event rendering in calendar cells (~line 180-200):
```typescript
// BEFORE: Flat list of events
{dateEvents.events.map((event) => (
  <div key={event.ipoId}>...</div>
))}

// AFTER: Grouped events with limiting
{dateEvents.eventGroups.map((group) => (
  <CalendarEventGroup
    key={group.type}
    groupType={group.label}
    events={group.events}
    maxEvents={3}
    size="compact"
  />
))}
```

**Step 2.3**: Verify Service Layer Has eventGroups

**File**: `web/lib/services/mainboard-calendar-service.ts`

Ensure `CalendarDateEvents` interface includes:
```typescript
export interface CalendarDateEvents {
  date: Date;
  dateString: string;
  events: CalendarEvent[];
  eventGroups: EventGroup[];  // This must exist
  hasMultipleEvents: boolean;
  isHoliday: boolean;
}
```

**Testing**:
- [ ] Each event group shows max 3 events by default
- [ ] "+X more" button appears when events > 3
- [ ] Clicking button expands to show all events
- [ ] Clicking "Show less" collapses back to 3
- [ ] November 2025 cell heights reduced to ~150-200px

---

### Task 3: Verify Event Grouping Logic (P1 - 30 minutes)

**File**: `web/lib/services/mainboard-calendar-service.ts`

**Step 3.1**: Verify `groupEventsByType()` function exists
```typescript
function groupEventsByType(events: CalendarEvent[]): EventGroup[] {
  // Groups events by type (OPENING_TODAY, CLOSING_TODAY, etc.)
  // Returns array sorted by priority (1-9)
}
```

**Step 3.2**: Verify `getEventTypePriority()` exists
```typescript
function getEventTypePriority(type: CalendarEventType): number {
  // Returns 1-9 (1 = highest priority)
  // CLOSING_TODAY: 1
  // OPENING_TODAY: 2
  // OPEN_FOR_APPLICATION: 3
  // etc.
}
```

**Step 3.3**: Verify `createCalendarDateEvents()` populates eventGroups
```typescript
eventGroups: groupEventsByType(dayEvents),  // Must exist
```

**Testing**:
- [ ] Event groups appear in priority order (CLOSING_TODAY first)
- [ ] Section headers show correct labels ("OPENING TODAY", not "OPENING_TODAY")
- [ ] Events within groups sorted by close date urgency

---

### Task 4: Database Verification (P2 - 15 minutes)

Verify November 2025 data is correct:

```sql
-- Count total Mainboard IPOs in 2025
SELECT COUNT(*) as mainboard_2025_count
FROM ipos
WHERE segment = 'MAINBOARD'
  AND offering_type = 'IPO'
  AND (
    EXTRACT(YEAR FROM open_date) = 2025
    OR EXTRACT(YEAR FROM close_date) = 2025
    OR EXTRACT(YEAR FROM listing_date) = 2025
    OR EXTRACT(YEAR FROM allotment_date) = 2025
  );

-- Count IPOs with November 2025 events
SELECT COUNT(*) as november_events_count
FROM ipos
WHERE segment = 'MAINBOARD'
  AND offering_type = 'IPO'
  AND (
    (EXTRACT(YEAR FROM open_date) = 2025 AND EXTRACT(MONTH FROM open_date) = 11)
    OR (EXTRACT(YEAR FROM close_date) = 2025 AND EXTRACT(MONTH FROM close_date) = 11)
    OR (EXTRACT(YEAR FROM listing_date) = 2025 AND EXTRACT(MONTH FROM listing_date) = 11)
    OR (EXTRACT(YEAR FROM allotment_date) = 2025 AND EXTRACT(MONTH FROM allotment_date) = 11)
  );
```

**Expected Results**:
- ~51 total Mainboard IPOs in 2025
- ~50 IPOs with November 2025 events
- 614 total events calculation:
  - 50 IPOs × 7 avg days (continuous OPEN_FOR_APPLICATION) = 350 events
  - 50 IPOs × 5 milestones (open, close, allotment, listing, etc.) = 250 events
  - 14 market holidays = 14 events
  - **Total ≈ 614 events**

---

## Testing Checklist

### After Task 1 (Responsive Display):
- [ ] Desktop (1440px): Only grid visible, no mobile list
- [ ] Mobile (375px): Only list visible, no desktop grid
- [ ] Tablet (768px): Only list visible
- [ ] Breakpoint (1024px): Clean transition
- [ ] No duplicate dates at any screen size
- [ ] No inline `style` attributes in calendar containers

### After Task 2 (Event Limiting):
- [ ] November 2025 cells show max 3 events per group
- [ ] "+X more" buttons appear when needed
- [ ] Expand/collapse functionality works smoothly
- [ ] Cell heights reduced to ~150-200px (collapsed)
- [ ] Full event access when expanded
- [ ] 80+ expandable sections across November

### After Task 3 (Event Grouping):
- [ ] Events organized in priority sections
- [ ] Section headers display correctly (e.g., "CLOSING TODAY (2)")
- [ ] CLOSING_TODAY appears first (highest priority)
- [ ] Events sorted by close date within groups
- [ ] Visual separators (border-left) between groups

### After Task 4 (Database Verification):
- [ ] 614 events count explained and verified
- [ ] Sample IPOs exist in database
- [ ] Date calculations are correct
- [ ] No missing or duplicate events

---

## Files to Modify

### Task 1: Responsive Display
1. `web/components/calendar/MainboardIPOCalendarGrid.tsx` (3 line changes)
   - Add CSS module import
   - Replace desktop grid inline styles (line ~178)
   - Replace mobile list inline styles (line ~215)

### Task 2: Event Limiting
1. `web/components/calendar/CalendarEventGroup.tsx` (NEW file - create)
2. `web/components/calendar/MainboardIPOCalendarGrid.tsx` (update event rendering)

### Task 3: Event Grouping
1. `web/lib/services/mainboard-calendar-service.ts` (verify functions exist)

### Task 4: Database Verification
1. No files modified (SQL queries only)

---

## Success Metrics

### Before Fix:
- ❌ 614 events all expanded
- ❌ Both desktop and mobile views rendering
- ❌ Cell heights 500-800px
- ❌ Calendar completely unusable
- ❌ No event limiting or grouping

### After Fix:
- ✅ 614 events preserved (complete data)
- ✅ Only 1 view renders (correct responsive)
- ✅ Cell heights ~150-200px (collapsed)
- ✅ Calendar scannable and usable
- ✅ 80+ expandable sections for user control
- ✅ Events grouped by priority
- ✅ "+X more" buttons for progressive disclosure

---

## Timeline

**Task 1**: 15 minutes (CSS module integration)
**Task 2**: 45 minutes (Event limiting component)
**Task 3**: 30 minutes (Verify grouping logic)
**Task 4**: 15 minutes (Database verification)

**Total Estimated Time**: **1.75 hours**

**Production Deployment**: Ready after all 4 tasks complete

---

## Related Documentation

- **Calendar Service**: `web/lib/services/mainboard-calendar-service.ts`
- **Repository Pattern**: `docs/02-architecture/backend-architecture.md`
- **Caching Strategy**: `docs/05-caching/CACHING_STRATEGY.md`

---

## Notes for Implementation

1. **CSS Module**: File already exists, just needs to be imported and used
2. **CalendarEventGroup**: New component needed, follow React best practices
3. **Event Grouping**: Service layer should already have this logic, verify it's being used
4. **Database Verification**: Read-only queries, safe to run anytime

---

**Last Updated**: 2025-11-15
**Status**: 🔴 AWAITING IMPLEMENTATION
**Estimated Completion**: 1.75 hours
**Production Blocker**: YES - Calendar unusable in current state
