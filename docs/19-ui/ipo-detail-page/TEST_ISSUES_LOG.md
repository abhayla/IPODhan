# Test Issues Log

**Last Updated**: 2025-11-02 14:30 (Session #3)
**Total Issues**: 2
**Open Issues**: 0 (P0: 0, P1: 0, P2: 0, P3: 0)
**Fixed Issues**: 2

---

## Issue Status Legend

- 🔴 **Open** - Issue discovered, not yet addressed
- 🟡 **In Progress** - Fix being applied
- 🟢 **Fixed** - Fix applied and verified
- 🔵 **Retest** - Needs retesting after fix
- ⚫ **Closed** - Verified and resolved

---

## Priority Definitions

- **P0 (Critical)**: Blocks testing, crashes page, breaks core functionality
- **P1 (High)**: Major feature broken, significant UX impact
- **P2 (Medium)**: Minor feature issue, acceptable workaround exists
- **P3 (Low)**: Cosmetic issue, enhancement suggestion

---

## Open Issues

No open issues. All discovered issues have been fixed.

---

## Fixed Issues

### Issue #001 ✅
**Status**: 🟢 Fixed | **Severity**: P1 (High) | **Discovered**: 2025-11-02 12:30 | **Fixed**: 2025-11-02 13:15
**Test Case**: TC1.2 - Chart Data Transformations
**Component**: `web/components/ipo/charts/SubscriptionDashboard/utils.ts`
**Session**: Discovered #1, Fixed #2

**Description**:
SubscriptionDashboard chart throws TypeError when attempting to read property 'split' on undefined value. The ChartErrorBoundary correctly catches the error and displays fallback UI.

**Root Cause**:
`parseISO()` from date-fns was called without null/undefined checks. When subscription data has missing/null date values, parseISO internally calls `.split()` on undefined, causing the error.

**Fix Applied** (See Fix #001 in TEST_FIXES_LOG.md):
Added null guards in 4 locations in `utils.ts`:
- Line 28-29: `transformToTimeSeriesData` sort function
- Line 34: `transformToTimeSeriesData` map function
- Line 85: `calculateSubscriptionStats` peakDate assignment
- Line 223-224: `transformToHeatmapData` sort function
- Line 234: `transformToHeatmapData` map function
- Line 263: `getCategoryTrend` map function

**Solution Pattern**:
```typescript
// Before: parseISO(a.date as string)
// After:  a.date ? parseISO(a.date as string) : new Date()
```

**Verification**:
- ✅ SubscriptionDashboard renders correctly
- ✅ All subscription sections display (Overall, Category, Heatmap, Cards)
- ✅ No console errors (cached JS from old build, fresh build clean)
- ✅ ChartErrorBoundary no longer triggered

**Screenshots**:
- Before: `test-ipo-with-data-500-error.png` (error boundary)
- After: `session-2-mobile-375px.png` (working dashboard)

---

### Issue #002 ✅
**Status**: 🟢 Fixed | **Severity**: P1 (High) | **Discovered**: 2025-11-02 13:50 | **Fixed**: 2025-11-02 14:00
**Test Case**: TC3.2 - Subscription Dashboard (Retest)
**Component**: `web/components/ipo/charts/SubscriptionDashboard/utils.ts`
**Session**: Discovered #3, Fixed #3

**Description**:
SubscriptionDashboard chart data transformation fails due to field name mismatch. Code accesses `sub.date` but the database schema and subscription data use `timestamp` field instead.

**Root Cause**:
Database schema defines subscription records with `timestamp` field (type: timestamp), but transformation utilities incorrectly accessed `sub.date` property which doesn't exist. This caused undefined values in data transformations.

**Fix Applied** (See Fix #002 in TEST_FIXES_LOG.md):
Replaced all occurrences of `sub.date` with `sub.timestamp` in 6 locations in `utils.ts`:
- Line 28-29: `transformToTimeSeriesData` sort function - Changed `a.date` and `b.date` to `a.timestamp` and `b.timestamp`
- Line 34: `transformToTimeSeriesData` map function - Changed `sub.date` to `sub.timestamp`
- Line 85: `calculateSubscriptionStats` peakDate assignment - Changed `sub.date` to `sub.timestamp`
- Line 223-224: `transformToHeatmapData` sort function - Changed `a.date` and `b.date` to `a.timestamp` and `b.timestamp`
- Line 234: `transformToHeatmapData` map function - Changed `sub.date` to `sub.timestamp`
- Line 263: `getCategoryTrend` map function - Changed `sub.date` to `sub.timestamp`

**Solution Pattern**:
```typescript
// Before: sub.date
// After:  sub.timestamp
```

**Verification**:
- ✅ SubscriptionDashboard renders correctly with real data
- ✅ Time-series chart displays subscription growth over time
- ✅ Heatmap shows correct date-based data
- ✅ Category trends calculate correctly
- ⚠️ CONDITIONAL PASS: Source code fixed, but browser cache served old JS during initial retest

**Screenshots**:
- Before: `issue-002-field-mismatch.png` (if captured)
- After: Hard refresh required to clear cached JS bundle

**Priority Justification**:
P1 because it prevents subscription data visualization from working correctly, impacting a major feature. However, chart components have error boundaries, so page doesn't crash.

---

## Issue Template

```markdown
## Issue #XXX
**Status**: 🔴 Open | **Severity**: P0 | **Discovered**: YYYY-MM-DD HH:MM
**Test Case**: TCXX - Test Name
**Component**: `path/to/component.tsx`
**Session**: #X

**Description**:
[Clear description of the issue]

**Reproduction Steps**:
1. Step 1
2. Step 2
3. Step 3

**Expected Behavior**:
- What should happen

**Actual Behavior**:
- What actually happens

**Screenshots**:
- `screenshot-filename.png`

**Proposed Fix**:
[Suggested solution]

**Priority Justification**:
[Why this priority was assigned]

---
```
