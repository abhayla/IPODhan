# Playwright MCP Testing Prompt - IPO Details Page UI/UX Enhancement

**Date Created**: 2025-11-02
**Implementation Coverage**: Phases 1-4 (90% Complete)
**Testing Mode**: Headed (Browser Visible)
**Session Type**: Iterative with Progress Retention

---

## 🎯 Testing Objective

Validate the IPO Details Page UI/UX enhancement implementation using Playwright MCP in headed mode. Execute iterative testing cycles (Test → Record Errors → Fix → Retest) until 100% acceptance criteria is met.

---

## 🔧 Test Data Setup

Before starting testing, ensure comprehensive test data is available:

### Required Test Data Script

```bash
# Navigate to web directory
cd d:\Abhay\VibeCoding\IPODhan\web

# Run test data seed script (creates 3 test IPOs with complete data)
npx tsx scripts/seed-test-data.ts

# Verify test data created
npx tsx scripts/verify-test-data.ts
```

### Test Data Requirements (Minimum)

| Requirement | Quantity | Purpose | Verification Query |
|-------------|----------|---------|-------------------|
| IPO with `status = 'OPEN'` | 1 | Subscription charts | `SELECT * FROM ipos WHERE status = 'OPEN' LIMIT 1;` |
| IPO with `status = 'LISTED'` | 1 | Listing performance | `SELECT * FROM ipos WHERE status = 'LISTED' LIMIT 1;` |
| IPO with financial data | 1 | Financial charts | `SELECT * FROM financial_data WHERE ipo_id = ?;` |
| IPO with GMP records (30+ days) | 1 | GMP trend chart | `SELECT COUNT(*) FROM gmp_records WHERE ipo_id = ? AND created_at >= NOW() - INTERVAL '30 days';` |
| IPO with subscription snapshots (10+) | 1 | Subscription time-series | `SELECT COUNT(*) FROM subscriptions WHERE ipo_id = ?;` |
| IPO with demand graph data | 1 (optional) | Demand distribution | `SELECT * FROM ipo_demand_graph WHERE ipo_id = ?;` |

### Test Data Validation Script

```typescript
// Run before each session
await browser_evaluate({
  function: `async () => {
    const response = await fetch('/api/ipos?status=OPEN&limit=1');
    const data = await response.json();
    return {
      hasOpenIPO: data.data.length > 0,
      slug: data.data[0]?.slug
    };
  }`
});
```

---

## 📋 Pre-Testing Checklist

Before starting the test session, ensure:

### 1. Environment Validation

```bash
# Verify Node.js version (should be 18+ or 20+)
node --version

# Verify npm dependencies installed
cd d:\Abhay\VibeCoding\IPODhan\web
npm list --depth=0 | grep -E "(next|react|recharts|playwright)"

# Check for TypeScript compilation errors
npm run type-check
```

**Expected Results**:
- ✅ Node v18.x or v20.x
- ✅ next@15.5.4, react@19.1.0, recharts@latest
- ✅ No TypeScript errors

### 2. Development Server Running

```bash
cd d:\Abhay\VibeCoding\IPODhan\web
npm run dev
```

**Verification Steps**:
1. Navigate to http://localhost:3000 (should load)
2. Check for compilation errors in terminal
3. Verify at least one IPO detail page exists: http://localhost:3000/ipos/[test-slug]

### 3. Database & Redis Status

**PostgreSQL**:
```bash
# Test connection
psql -U postgres -d ipodhan -c "SELECT COUNT(*) FROM ipos;"
```
Expected: Returns count > 0

**Redis** (optional):
```bash
# Test connection
redis-cli PING
```
Expected: PONG (if Redis running), or app should fallback to DB gracefully

### 4. Browser Installation

```typescript
// Run if browsers not installed
await mcp__playwright__browser_install();

// Verify browser available
await mcp__playwright__browser_navigate({
  url: 'http://localhost:3000'
});
```

**Expected**: Browser opens without errors

### 5. Test Data Verification

Run the test data setup script (see section above) and verify:
- ✅ At least 1 OPEN IPO with subscription data
- ✅ At least 1 LISTED IPO with listing performance
- ✅ Financial data complete (revenue, profit, ratios)
- ✅ GMP records span 30+ days
- ✅ No null/undefined in critical fields

---

## 🧪 Testing Methodology

### Session State Management

**CRITICAL**: All test progress is persisted across sessions using three state files:

1. **`TEST_PROGRESS.md`** - Current status of all test cases (updated after each session)
2. **`TEST_ISSUES_LOG.md`** - All discovered issues with status tracking
3. **`TEST_FIXES_LOG.md`** - All fixes applied with verification status

**State File Locations**: `docs/19-ui/ipo-detail-page/`

### Session Structure

Each testing session follows this workflow:

1. **Initialize Test Session** (READ PREVIOUS STATE)
   ```typescript
   // STEP 1: Read previous session state
   const progressFile = 'docs/19-ui/ipo-detail-page/TEST_PROGRESS.md';
   const issuesFile = 'docs/19-ui/ipo-detail-page/TEST_ISSUES_LOG.md';
   const fixesFile = 'docs/19-ui/ipo-detail-page/TEST_FIXES_LOG.md';

   // Check if state files exist
   // If files exist: Parse and display summary
   // If files don't exist: Create new session (Session #1)
   ```

   **Session Initialization Steps**:
   - **a.** Read `TEST_PROGRESS.md` to determine:
     - Previous session number
     - Overall completion percentage
     - Which test cases passed/failed
     - Which test cases are pending
     - Current blockers
   - **b.** Read `TEST_ISSUES_LOG.md` to identify:
     - Open issues (P0, P1, P2, P3)
     - Issues fixed in previous sessions
     - Issues requiring retest
   - **c.** Read `TEST_FIXES_LOG.md` to understand:
     - What was fixed previously
     - What needs retesting
   - **d.** Display session summary:
     ```
     📊 SESSION CONTINUATION
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     Previous Session: #2
     Overall Progress: 45% (10/22 tests passed)
     Open Issues: 3 (1 P0, 2 P1)
     Last Updated: 2025-11-02 14:30

     📋 NEXT STEPS:
     1. Fix Issue #003 (P0 - Subscription chart not rendering)
     2. Retest TC3.2 after fix
     3. Continue with TC4.1-TC4.3 (Progressive Disclosure tests)

     🎯 SESSION GOAL: Reach 60% completion (13/22 tests)
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     ```
   - **e.** Navigate to IPO detail page in headed mode
   - **f.** Take initial screenshot: `session-{N}-start.png`

2. **Execute Test Suite** (See Acceptance Criteria below)
   - Test each feature systematically
   - Document pass/fail status
   - Capture screenshots of failures
   - Record error details
   - **Update state files in real-time** (after each test)

3. **Document Issues**
   - Update `TEST_ISSUES_LOG.md` with discovered issues
   - Categorize by severity: P0 (Critical), P1 (High), P2 (Medium), P3 (Low)
   - Add reproduction steps and expected vs actual behavior
   - **Assign unique Issue IDs** (e.g., #001, #002, #003)

4. **Fix Issues**
   - Address P0 issues first, then P1, P2, P3
   - Document fixes in `TEST_FIXES_LOG.md`
   - Link each fix to corresponding issue ID
   - **Mark issue status as "🟡 In Progress"** while fixing

5. **Retest**
   - Verify all fixes resolve their respective issues
   - Regression test: Ensure fixes don't break other features
   - Update `TEST_PROGRESS.md` with current status
   - **Mark issue status as "🟢 Fixed"** after verification

6. **Loop Until Complete**
   - Repeat Steps 2-5 until all tests pass
   - Final validation: Run complete test suite end-to-end
   - Generate completion report

7. **End Session** (SAVE STATE)
   ```typescript
   // CRITICAL: Save session state before ending
   // 1. Update TEST_PROGRESS.md with:
   //    - Session number incremented
   //    - Overall completion percentage
   //    - Test case statuses (✅ PASSED, ❌ FAILED, ⏳ IN PROGRESS, ⏸️ PENDING)
   //    - Session notes and next steps
   //
   // 2. Update TEST_ISSUES_LOG.md with:
   //    - New issues discovered
   //    - Issue status updates (Open → In Progress → Fixed)
   //
   // 3. Update TEST_FIXES_LOG.md with:
   //    - Fixes applied in this session
   //    - Retest results
   //
   // 4. Take final screenshot: session-{N}-end.png
   //
   // 5. Generate session summary report
   ```

   **Session End Checklist**:
   - ✅ All state files updated
   - ✅ Session summary generated
   - ✅ Final screenshot captured
   - ✅ Next session goals documented
   - ✅ All files saved to disk

### Post-Fix Verification Protocol

**CRITICAL**: After fixing any issue, follow this protocol to ensure the fix doesn't break other features:

1. **Targeted Retest** (Fix Verification)
   - Rerun the specific test case that failed
   - Verify fix resolves the issue
   - Document pass/fail in `TEST_FIXES_LOG.md`

2. **Local Regression** (Related Features)
   - Test related components/features
   - Example: If fixing chart data transformation, test all chart types
   - Ensure fix doesn't introduce new issues

3. **Quick Smoke Test** (Critical Paths)
   - Navigate to page (no errors)
   - Expand/collapse all sections (animations work)
   - Scroll page (sticky dashboard works)
   - Resize to mobile/desktop (responsive works)
   - Check console for new errors

4. **Database State Check**
   - Verify database queries still work
   - Check API endpoints return expected data
   - Validate no N+1 queries introduced

5. **Update Progress**
   - Mark test case as ✅ PASSED in `TEST_PROGRESS.md`
   - Update pass rate percentage
   - Note any new issues discovered during regression

**Example Post-Fix Verification**:

```typescript
// After fixing Issue #001 (Chart Data Transformation)

// 1. Targeted Retest: TC1.2
await browser_navigate({ url: 'http://localhost:3000/ipos/test-ipo' });
const chartErrors = await browser_console_messages({ onlyErrors: true });
// Expected: No transformation errors

// 2. Local Regression: Test all charts
const allChartsRendered = await browser_evaluate({
  function: `() => {
    const charts = document.querySelectorAll('[data-testid^="chart-"]');
    return charts.length >= 7;
  }`
});
// Expected: true

// 3. Quick Smoke Test
await browser_click({ element: 'Collapse All button', ref: 'button[aria-label*="Collapse"]' });
await browser_wait_for({ time: 1 });
await browser_take_screenshot({ filename: 'post-fix-smoke-test.png' });
// Expected: All sections collapsed, no errors

// 4. Database/API Check
await browser_evaluate({
  function: `async () => {
    const response = await fetch('/api/ipos/test-ipo/financials');
    const data = await response.json();
    return data.success && data.data !== null;
  }`
});
// Expected: true

// 5. Update TEST_PROGRESS.md
// - TC1.2: ✅ PASSED (after Fix #001)
```

---

## ✅ Acceptance Criteria & Test Cases

### Phase 1: Core Infrastructure

#### TC1.1 - Chart Components Rendering
**Feature**: 7 base chart components render correctly

**Test Steps**:
1. Navigate to IPO detail page with financial data
2. Scroll to "Financial Performance Analysis" section
3. Verify each chart renders without errors:
   - LineChart (Revenue Trend)
   - AreaChart (GMP History)
   - BarChart (Category Subscription)
   - PieChart (Subscription Breakdown)
   - ComposedChart (Financial Ratios)
   - Timeline (IPO Timeline Widget)
   - Gauge (if implemented)

**Expected Results**:
- ✅ All charts render visually
- ✅ No console errors related to Recharts
- ✅ Charts display data (not empty states)
- ✅ Responsive container adapts to viewport width

**Validation Method**:
```javascript
// Using browser_evaluate
await browser_evaluate({
  function: `() => {
    const charts = document.querySelectorAll('[data-testid^="chart-"]');
    return {
      count: charts.length,
      hasErrors: !!document.querySelector('.error-boundary')
    };
  }`
});
```

---

#### TC1.2 - Chart Data Transformations
**Feature**: Data transformation utilities work correctly

**Test Steps**:
1. Open browser console (headed mode)
2. Navigate to page with financial data
3. Check for transformation errors in console

**Expected Results**:
- ✅ No "Invalid data format" errors
- ✅ No "undefined" or "null" data point errors
- ✅ All chart data arrays are non-empty

**Validation Method**:
- Use `browser_console_messages` to check for errors
- Filter for keywords: "Invalid", "undefined", "NaN", "transformation"

---

#### TC1.3 - Responsive Chart Containers
**Feature**: Charts resize properly across breakpoints

**Test Steps**:
1. Navigate to IPO detail page
2. Resize browser to mobile width (375px)
3. Resize to tablet width (768px)
4. Resize to desktop width (1440px)

**Expected Results**:
- ✅ Charts resize smoothly without overflow
- ✅ No horizontal scrollbar appears
- ✅ Legends/axes adjust to fit container
- ✅ Touch targets on mobile ≥ 44px

**Validation Method**:
```javascript
// Resize and check
await browser_resize({ width: 375, height: 812 });
await browser_take_screenshot({ filename: 'mobile-charts.png' });
await browser_resize({ width: 768, height: 1024 });
await browser_take_screenshot({ filename: 'tablet-charts.png' });
await browser_resize({ width: 1440, height: 900 });
await browser_take_screenshot({ filename: 'desktop-charts.png' });
```

---

### Phase 2: Sticky Dashboard

#### TC2.1 - IPO Timeline Widget
**Feature**: Timeline displays IPO lifecycle milestones

**Test Steps**:
1. Navigate to IPO detail page
2. Locate IPOTimelineWidget component (top of page)
3. Verify 5 milestones are displayed:
   - Announcement Date
   - Open Date
   - Close Date
   - Allotment Date
   - Listing Date

**Expected Results**:
- ✅ All 5 milestones visible
- ✅ Current stage highlighted (blue/active state)
- ✅ Past stages shown as completed (green checkmark)
- ✅ Future stages shown as pending (gray)
- ✅ Progress bar fills correctly (e.g., 60% if 3/5 complete)
- ✅ Dates display in correct format (DD MMM YYYY)

**Validation Method**:
```javascript
await browser_snapshot();
// Check snapshot for:
// - timeline element present
// - 5 milestone nodes
// - progress bar element
```

---

#### TC2.2 - Key Metrics Cards (Enhanced)
**Feature**: 4 key metric cards with sparklines

**Test Steps**:
1. Verify 4 cards are displayed:
   - Subscription Status (with sparkline)
   - GMP (with trend indicator)
   - Issue Size (with allocation breakdown mini chart)
   - Listing Gains (with price change sparkline)
2. Hover over each card
3. Check for tooltip on sparklines

**Expected Results**:
- ✅ All 4 cards render with correct data
- ✅ Sparklines display mini trends
- ✅ Hover states work (card elevation/shadow)
- ✅ Icons display correctly (TrendingUp, TrendingDown, etc.)
- ✅ Numeric values formatted correctly (e.g., "₹1,234.56 Cr")

**Validation Method**:
- Visual inspection in headed mode
- Take screenshot: `key-metrics-cards.png`
- Hover test: Use `browser_hover` on each card

---

#### TC2.3 - Sticky Dashboard Behavior
**Feature**: Dashboard sticks to top on scroll

**Test Steps**:
1. Navigate to IPO detail page
2. Scroll down 500px
3. Verify sticky behavior on desktop
4. Resize to mobile (375px width)
5. Verify mobile collapse behavior

**Expected Results**:
- ✅ **Desktop**: Dashboard sticks to top with `position: sticky`
- ✅ **Desktop**: Z-index ensures dashboard stays above content
- ✅ **Mobile**: Dashboard collapses to compact mode on scroll
- ✅ **Mobile**: Expand button appears to show full dashboard
- ✅ Smooth scroll behavior when clicking timeline milestones

**Validation Method**:
```javascript
// Scroll test
await browser_evaluate({
  function: `() => {
    window.scrollTo(0, 500);
    const dashboard = document.querySelector('[data-testid="sticky-dashboard"]');
    const rect = dashboard?.getBoundingClientRect();
    return {
      top: rect?.top,
      position: window.getComputedStyle(dashboard).position
    };
  }`
});
```

---

### Phase 3: Main Visualizations

#### TC3.1 - Financial Performance Charts
**Feature**: 4 financial sub-components render correctly

**Test Steps**:
1. Navigate to IPO with financial data
2. Expand "Financial Performance Analysis" section
3. Verify 4 charts:
   - Revenue Trend (Line/Area chart)
   - Profit & Loss (Composed chart with bars + line)
   - EBITDA Trend (Area chart)
   - Financial Ratios Grid (4-up grid layout)

**Expected Results**:
- ✅ All 4 charts render with actual data
- ✅ X-axis shows fiscal years (FY2021, FY2022, etc.)
- ✅ Y-axis shows formatted currency (₹ Cr)
- ✅ Tooltips display on hover with rich formatting
- ✅ Legend shows color coding (Revenue, Profit, Loss, EBITDA)
- ✅ Ratios grid shows 4 metrics: ROE, P/E, Debt-to-Equity, Current Ratio

**Validation Method**:
- Scroll to section using `browser_evaluate`
- Take screenshot: `financial-charts.png`
- Hover over data points to test tooltips

---

#### TC3.2 - Subscription Dashboard
**Feature**: Subscription analytics with 4 sub-components

**Test Steps**:
1. Navigate to IPO with `status = 'OPEN'`
2. Verify subscription data is displayed
3. Check 4 components:
   - Overall Subscription (Time-series area chart)
   - Category Breakdown (Stacked bar chart: QIB, NII, Retail)
   - Subscription Heatmap (Color-coded grid)
   - Subscription Cards (QIB, NII, Retail cards with icons)

**Expected Results**:
- ✅ Time-series shows subscription growth over time
- ✅ Category breakdown shows 3 investor types
- ✅ Heatmap uses color gradient (green = high, red = low)
- ✅ Cards display subscription multiples (e.g., "23.45x")
- ✅ QIB icon: Building2, NII: Users, Retail: User

**Validation Method**:
- Visual inspection
- Screenshot: `subscription-dashboard.png`
- Console check for data loading errors

---

#### TC3.3 - Post-Listing Performance Charts
**Feature**: 3 listing performance sub-components (conditional)

**Test Steps**:
1. Navigate to IPO with `status = 'LISTED'`
2. Verify section appears only for listed IPOs
3. Check 3 charts:
   - Stock Price Chart (Line chart with volume bars)
   - Listing Gains (Bar chart: Offer Price, Listing Price, Current Price)
   - Sector Comparison (Grouped bar chart)

**Expected Results**:
- ✅ Section hidden for non-listed IPOs
- ✅ Stock price chart shows price trend + volume
- ✅ Listing gains show % gains/losses with color coding
- ✅ Sector comparison shows peer performance
- ✅ Data sources cited in footer (e.g., "Data: NSE, BSE")

**Conditional Test**:
- If IPO not listed: Section should not render
- Verify with `browser_snapshot` - check for section absence

---

#### TC3.4 - Demand Distribution Graph
**Feature**: Price bucket demand histogram (conditional)

**Test Steps**:
1. Check if demand data exists in database
2. If yes: Verify DemandGraph renders
3. If no: Verify graceful fallback (section hidden)

**Expected Results**:
- ✅ **With Data**: Bar chart shows demand at different price points
- ✅ **With Data**: X-axis = Price buckets (₹100-₹200, ₹200-₹300, etc.)
- ✅ **With Data**: Y-axis = Number of bids
- ✅ **Without Data**: Section completely hidden (not just empty state)

**Validation Method**:
```javascript
// Check conditional rendering
await browser_evaluate({
  function: `() => {
    const demandSection = document.querySelector('[data-testid="demand-graph"]');
    return {
      rendered: !!demandSection,
      hasData: demandSection?.querySelector('.recharts-bar') !== null
    };
  }`
});
```

---

#### TC3.5 - Enhanced GMP History Chart
**Feature**: 30-day GMP trend with confidence bands

**Test Steps**:
1. Navigate to IPO with GMP records
2. Locate "Grey Market Premium (GMP) Trend" section
3. Expand section (if collapsed)

**Expected Results**:
- ✅ Area chart displays 30-day GMP trend
- ✅ Confidence band shows min-max range (shaded area)
- ✅ Tooltip shows Date, GMP, % Premium
- ✅ Positive GMP = Green area, Negative = Red area
- ✅ Empty state if no GMP data: "No GMP data available"

**Validation Method**:
- Visual check in headed mode
- Screenshot: `gmp-history-chart.png`
- Verify color coding (green/red)

---

### Phase 4: Progressive Disclosure

#### TC4.1 - Collapsible Sections
**Feature**: 9 sections wrapped in CollapsibleSection

**Test Steps**:
1. Navigate to IPO detail page
2. Count collapsible sections
3. Test expand/collapse for each section:
   - Financial Performance Analysis
   - Grey Market Premium (GMP) Trend
   - Post-Listing Performance
   - Demand Analysis
   - Use of Proceeds
   - Company Information
   - Analyst Recommendations
   - Share Allocation
   - Peer Comparison

**Expected Results**:
- ✅ All 9 sections have collapse/expand toggle
- ✅ Click toggle to collapse: Content slides up smoothly (300ms)
- ✅ Click toggle to expand: Content slides down smoothly (300ms)
- ✅ Toggle icon rotates (ChevronDown → ChevronUp)
- ✅ Collapsed sections show summary/preview (if applicable)
- ✅ ARIA attributes present: `aria-expanded`, `aria-controls`

**Validation Method**:
```javascript
// Count sections
await browser_evaluate({
  function: `() => {
    const sections = document.querySelectorAll('[data-collapsible="true"]');
    return sections.length;
  }`
});

// Test collapse/expand
for (let i = 0; i < 9; i++) {
  await browser_click({
    element: `Collapsible section ${i+1} toggle`,
    ref: `button[aria-controls^="collapsible-section-"]`
  });
  await browser_wait_for({ time: 0.5 }); // Wait for animation
  await browser_take_screenshot({ filename: `section-${i+1}-collapsed.png` });
}
```

---

#### TC4.2 - SectionControlBar (Expand/Collapse All)
**Feature**: Global control bar with "Expand All / Collapse All" button

**Test Steps**:
1. Locate SectionControlBar (top of scrollable content area)
2. Verify initial state (e.g., "Collapse All" if all expanded)
3. Click "Collapse All" button
4. Click "Expand All" button
5. Verify section count display (e.g., "9 sections")

**Expected Results**:
- ✅ Control bar sticky positioned on desktop
- ✅ Button text toggles: "Expand All" ↔ "Collapse All"
- ✅ Icon toggles: ChevronsDown ↔ ChevronsUp
- ✅ All 9 sections collapse when "Collapse All" clicked
- ✅ All 9 sections expand when "Expand All" clicked
- ✅ Smooth staggered animation (not all at once)
- ✅ Section count displays correctly: "9 sections"
- ✅ Keyboard accessible (Tab, Enter, Space)

**Validation Method**:
```javascript
// Test Collapse All
await browser_click({
  element: 'Collapse All button',
  ref: 'button[aria-label*="Collapse all sections"]'
});
await browser_wait_for({ time: 1 }); // Wait for staggered animation
await browser_evaluate({
  function: `() => {
    const sections = document.querySelectorAll('[aria-expanded="false"]');
    return sections.length; // Should be 9
  }`
});

// Test Expand All
await browser_click({
  element: 'Expand All button',
  ref: 'button[aria-label*="Expand all sections"]'
});
await browser_wait_for({ time: 1 });
await browser_evaluate({
  function: `() => {
    const sections = document.querySelectorAll('[aria-expanded="true"]');
    return sections.length; // Should be 9
  }`
});
```

---

#### TC4.3 - State Management (useSectionControl Hook)
**Feature**: Controlled state management for all sections

**Test Steps**:
1. Expand all sections
2. Collapse section #3 individually
3. Click "Collapse All"
4. Verify section #3 was already collapsed (no double animation)
5. Click "Expand All"
6. Collapse section #5 individually
7. Refresh page
8. Verify state resets to default

**Expected Results**:
- ✅ Individual section state updates global control bar state
- ✅ Global control bar accurately reflects current state (all/some/none expanded)
- ✅ No duplicate animations or state conflicts
- ✅ State resets on page refresh (unless localStorage implemented)

**Validation Method**:
- Manual testing in headed mode
- Observe button text changes in real-time

---

### Cross-Cutting Concerns

#### TC5.1 - Loading States & Skeletons
**Feature**: Charts display loading skeletons while data fetches

**Test Steps**:
1. Navigate to IPO detail page
2. Throttle network to Slow 3G (DevTools → Network tab)
3. Refresh page
4. Observe loading states before data loads

**Expected Results**:
- ✅ ChartSkeleton components render during data fetch
- ✅ Skeleton matches chart dimensions (height, layout)
- ✅ Smooth transition from skeleton to actual chart
- ✅ No flash of empty content
- ✅ Loading state shown for 200ms minimum (prevents flash)

**Validation Method**:
```typescript
// Throttle network
await browser_evaluate({
  function: `() => {
    // Note: Network throttling via DevTools API
    // For headed mode, manually enable in DevTools
  }`
});

// Navigate and capture loading state
await browser_navigate({ url: 'http://localhost:3000/ipos/test-ipo' });
await browser_wait_for({ time: 0.5 });
await browser_take_screenshot({ filename: 'loading-state-skeletons.png' });

// Verify skeleton elements present
const hasSkeletons = await browser_evaluate({
  function: `() => {
    const skeletons = document.querySelectorAll('[data-testid="chart-skeleton"]');
    return skeletons.length > 0;
  }`
});
```

---

#### TC5.2 - Error States & Boundaries
**Feature**: Error boundaries catch chart failures gracefully

**Test Steps**:
1. Navigate to IPO detail page
2. Open DevTools console
3. Force chart error by corrupting data in memory
4. Verify error boundary displays fallback UI

**Expected Results**:
- ✅ ChartErrorBoundary catches rendering errors
- ✅ Fallback UI shows user-friendly message (not stack trace)
- ✅ "Try Again" button allows retry
- ✅ Other sections continue working (isolated failure)
- ✅ Error logged to console for debugging
- ✅ Error reported to monitoring (Sentry)

**Validation Method**:
```typescript
// Force error in specific chart
await browser_evaluate({
  function: `() => {
    // Simulate data corruption for one chart
    window.__FORCE_CHART_ERROR__ = true;
  }`
});

// Reload page
await browser_navigate({ url: 'http://localhost:3000/ipos/test-ipo' });
await browser_wait_for({ time: 2 });

// Check for error boundary
const hasErrorBoundary = await browser_evaluate({
  function: `() => {
    const errorBoundary = document.querySelector('[data-testid="chart-error-boundary"]');
    const errorMessage = errorBoundary?.textContent;
    return {
      rendered: !!errorBoundary,
      hasTryAgain: errorMessage?.includes('Try Again'),
      userFriendly: !errorMessage?.includes('undefined')
    };
  }`
});

// Screenshot error state
await browser_take_screenshot({ filename: 'error-state-boundary.png' });

// Verify other sections still work
await browser_click({
  element: 'Collapse All button',
  ref: 'button[aria-label*="Collapse"]'
});
await browser_wait_for({ time: 1 });
// Should work despite chart error
```

---

#### TC5.3 - Empty States & Missing Data
**Feature**: Graceful handling when data is unavailable

**Test Steps**:
1. Create test IPO with minimal data (no financials, no GMP, no subscriptions)
2. Navigate to this IPO's detail page
3. Verify empty state messages display

**Expected Results**:
- ✅ **Financial Section**: "No financial data available" message
- ✅ **GMP Section**: "No GMP data available" with explanation
- ✅ **Subscription Section**: Hidden or "IPO not yet open" message
- ✅ **Listing Performance**: Hidden for non-listed IPOs
- ✅ Empty states include helpful text (e.g., "Data will appear once IPO opens")
- ✅ No broken charts or console errors
- ✅ Sections with no data are collapsed by default

**Validation Method**:
```typescript
// Navigate to IPO with minimal data
await browser_navigate({ url: 'http://localhost:3000/ipos/empty-data-test-ipo' });

// Check for empty state messages
const emptyStates = await browser_evaluate({
  function: `() => {
    const financialEmpty = document.querySelector('[data-testid="financial-empty-state"]');
    const gmpEmpty = document.querySelector('[data-testid="gmp-empty-state"]');
    const subscriptionEmpty = document.querySelector('[data-testid="subscription-empty-state"]');

    return {
      financialEmpty: !!financialEmpty && financialEmpty.textContent.includes('No financial data'),
      gmpEmpty: !!gmpEmpty && gmpEmpty.textContent.includes('No GMP data'),
      subscriptionEmpty: !!subscriptionEmpty,
      hasConsoleErrors: false // Check separately
    };
  }`
});

// Screenshot empty states
await browser_take_screenshot({ filename: 'empty-states-full-page.png', fullPage: true });

// Verify sections are collapsed
const collapsedSections = await browser_evaluate({
  function: `() => {
    const sections = document.querySelectorAll('[data-collapsible="true"]');
    const collapsed = Array.from(sections).filter(s =>
      s.getAttribute('aria-expanded') === 'false'
    );
    return {
      total: sections.length,
      collapsed: collapsed.length,
      percentage: (collapsed.length / sections.length) * 100
    };
  }`
});
```

---

#### TC5.4 - API & Network Validation
**Feature**: All API calls succeed and return valid data

**Test Steps**:
1. Navigate to IPO detail page
2. Open DevTools → Network tab (in headed mode)
3. Monitor all XHR/Fetch requests
4. Verify responses

**Expected Results**:
- ✅ All API calls return 200 OK status
- ✅ Response times < 500ms (p95)
- ✅ No 404 or 500 errors
- ✅ Response data matches expected schema
- ✅ No CORS errors
- ✅ Cache headers set correctly (15min for IPO detail)

**Validation Method**:
```typescript
// Use browser network monitoring
const networkRequests = await browser_network_requests();

// Filter for API calls
const apiCalls = networkRequests.filter(req =>
  req.url.includes('/api/ipos/')
);

// Verify all successful
const failedCalls = apiCalls.filter(req => req.status !== 200);

if (failedCalls.length > 0) {
  console.log('❌ Failed API calls:', failedCalls);
  // Document in TEST_ISSUES_LOG.md
}

// Check response times
const slowCalls = apiCalls.filter(req => req.timing.duration > 500);

if (slowCalls.length > 0) {
  console.log('⚠️ Slow API calls (>500ms):', slowCalls);
  // Document as performance issue
}
```

---

#### TC5.5 - Performance Metrics
**Feature**: Page performance within targets

**Test Steps**:
1. Open Chrome DevTools → Performance tab (in headed mode)
2. Record page load
3. Measure key metrics

**Expected Results**:
- ✅ LCP (Largest Contentful Paint) < 2.5s
- ✅ FID (First Input Delay) < 100ms
- ✅ CLS (Cumulative Layout Shift) < 0.1
- ✅ Time to Interactive < 3.5s
- ✅ Bundle size increase < 200KB (check Network tab)

**Validation Method**:
- Use Lighthouse CI (if configured)
- Manual check: DevTools → Lighthouse → Run audit

---

#### TC5.2 - Accessibility (WCAG AA)
**Feature**: WCAG AA compliance

**Test Steps**:
1. Run accessibility audit using DevTools → Lighthouse
2. Test keyboard navigation:
   - Tab through all interactive elements
   - Press Enter/Space on buttons
   - Use arrow keys in charts (if applicable)
3. Test with screen reader (NVDA/JAWS)

**Expected Results**:
- ✅ Lighthouse Accessibility score ≥ 90
- ✅ All interactive elements keyboard accessible
- ✅ Focus indicators visible (blue outline)
- ✅ ARIA labels present on all buttons/controls
- ✅ Chart data accessible to screen readers (alt text/ARIA descriptions)
- ✅ Color contrast ratios ≥ 4.5:1 (text) and ≥ 3:1 (UI components)

**Validation Method**:
```javascript
// Check ARIA attributes
await browser_evaluate({
  function: `() => {
    const buttons = document.querySelectorAll('button');
    const missingAria = Array.from(buttons).filter(btn =>
      !btn.hasAttribute('aria-label') && !btn.textContent.trim()
    );
    return {
      totalButtons: buttons.length,
      missingAriaLabels: missingAria.length
    };
  }`
});
```

---

#### TC5.3 - Responsive Design (Mobile/Tablet/Desktop)
**Feature**: Responsive across all breakpoints

**Test Steps**:
1. Test 3 viewports:
   - Mobile: 375x812 (iPhone SE)
   - Tablet: 768x1024 (iPad)
   - Desktop: 1440x900 (Laptop)
2. Verify each component adapts correctly

**Expected Results**:
- ✅ **Mobile**:
  - Sticky dashboard collapses to compact mode
  - Charts stack vertically (1 column)
  - Touch targets ≥ 44px
  - No horizontal scroll
- ✅ **Tablet**:
  - Charts in 2-column grid
  - Sticky dashboard visible but condensed
- ✅ **Desktop**:
  - Full sticky dashboard
  - Charts in optimal grid (2-3 columns)
  - All features visible without scroll (above-the-fold)

**Validation Method**:
```javascript
// Test each breakpoint
const breakpoints = [
  { width: 375, height: 812, name: 'mobile' },
  { width: 768, height: 1024, name: 'tablet' },
  { width: 1440, height: 900, name: 'desktop' }
];

for (const bp of breakpoints) {
  await browser_resize({ width: bp.width, height: bp.height });
  await browser_wait_for({ time: 0.5 });
  await browser_take_screenshot({
    filename: `responsive-${bp.name}.png`
  });
}
```

---

#### TC5.4 - Error Boundaries & Graceful Degradation
**Feature**: Error handling without breaking page

**Test Steps**:
1. Simulate chart data error (modify data in DevTools)
2. Verify error boundary catches error
3. Check fallback UI displays

**Expected Results**:
- ✅ Error boundary prevents whole page crash
- ✅ Fallback UI shows user-friendly message
- ✅ Other sections continue to work
- ✅ Console logs error details for debugging

**Validation Method**:
```javascript
// Force error in chart component
await browser_evaluate({
  function: `() => {
    // Simulate data corruption
    const chartDiv = document.querySelector('[data-testid="chart-revenue"]');
    if (chartDiv) {
      chartDiv.setAttribute('data-force-error', 'true');
    }
  }`
});

// Check for error boundary
await browser_snapshot();
// Look for error-boundary element or fallback UI
```

---

#### TC5.6 - Browser Console Errors
**Feature**: Zero console errors on production build

**Test Steps**:
1. Open page in headed mode
2. Open DevTools → Console
3. Interact with all features (expand/collapse, hover charts, scroll)
4. Collect all console messages

**Expected Results**:
- ✅ No JavaScript errors (red text)
- ✅ No React warnings (yellow text)
- ✅ No network 404/500 errors
- ✅ Warnings allowed: Development-only warnings (safe to ignore)

**Validation Method**:
```javascript
await browser_console_messages({ onlyErrors: true });
// Review output for critical errors
```

---

#### TC5.7 - Accessibility (WCAG AA)
**Feature**: WCAG AA compliance

**Test Steps**:
1. Run accessibility audit using DevTools → Lighthouse
2. Test keyboard navigation:
   - Tab through all interactive elements
   - Press Enter/Space on buttons
   - Use arrow keys in charts (if applicable)
3. Test with screen reader (NVDA/JAWS)

**Expected Results**:
- ✅ Lighthouse Accessibility score ≥ 90
- ✅ All interactive elements keyboard accessible
- ✅ Focus indicators visible (blue outline)
- ✅ ARIA labels present on all buttons/controls
- ✅ Chart data accessible to screen readers (alt text/ARIA descriptions)
- ✅ Color contrast ratios ≥ 4.5:1 (text) and ≥ 3:1 (UI components)

**Validation Method**:
```javascript
// Check ARIA attributes
await browser_evaluate({
  function: `() => {
    const buttons = document.querySelectorAll('button');
    const missingAria = Array.from(buttons).filter(btn =>
      !btn.hasAttribute('aria-label') && !btn.textContent.trim()
    );
    return {
      totalButtons: buttons.length,
      missingAriaLabels: missingAria.length
    };
  }`
});
```

---

#### TC5.8 - Responsive Design (Mobile/Tablet/Desktop)
**Feature**: Responsive across all breakpoints

**Test Steps**:
1. Test 3 viewports:
   - Mobile: 375x812 (iPhone SE)
   - Tablet: 768x1024 (iPad)
   - Desktop: 1440x900 (Laptop)
2. Verify each component adapts correctly

**Expected Results**:
- ✅ **Mobile**:
  - Sticky dashboard collapses to compact mode
  - Charts stack vertically (1 column)
  - Touch targets ≥ 44px
  - No horizontal scroll
- ✅ **Tablet**:
  - Charts in 2-column grid
  - Sticky dashboard visible but condensed
- ✅ **Desktop**:
  - Full sticky dashboard
  - Charts in optimal grid (2-3 columns)
  - All features visible without scroll (above-the-fold)

**Validation Method**:
```javascript
// Test each breakpoint
const breakpoints = [
  { width: 375, height: 812, name: 'mobile' },
  { width: 768, height: 1024, name: 'tablet' },
  { width: 1440, height: 900, name: 'desktop' }
];

for (const bp of breakpoints) {
  await browser_resize({ width: bp.width, height: bp.height });
  await browser_wait_for({ time: 0.5 });
  await browser_take_screenshot({
    filename: `responsive-${bp.name}.png`
  });
}
```

---

## 🔍 End-of-Session Verification Checklist

**Purpose**: Quick smoke test after all fixes in a session to ensure everything still works

**When to Run**: At the end of each testing session, before updating `TEST_PROGRESS.md`

### Verification Steps:

1. **Page Loads Successfully**
   ```typescript
   await browser_navigate({ url: 'http://localhost:3000/ipos/test-ipo' });
   await browser_wait_for({ time: 2 });

   // Check for fatal errors
   const consoleErrors = await browser_console_messages({ onlyErrors: true });
   const criticalErrors = consoleErrors.filter(e => e.type === 'error');
   // Expected: criticalErrors.length === 0
   ```

2. **All Charts Render**
   ```typescript
   const chartStatus = await browser_evaluate({
     function: `() => {
       const charts = document.querySelectorAll('[data-testid^="chart-"]');
       const errorBoundaries = document.querySelectorAll('[data-testid="chart-error-boundary"]');
       return {
         totalCharts: charts.length,
         errored: errorBoundaries.length,
         healthy: charts.length - errorBoundaries.length
       };
     }`
   });
   // Expected: chartStatus.healthy >= 7
   ```

3. **Sticky Dashboard Works**
   ```typescript
   // Scroll down
   await browser_evaluate({
     function: `() => { window.scrollTo(0, 500); }`
   });
   await browser_wait_for({ time: 0.5 });

   // Check sticky position
   const isSticky = await browser_evaluate({
     function: `() => {
       const dashboard = document.querySelector('[data-testid="sticky-dashboard"]');
       const rect = dashboard?.getBoundingClientRect();
       return rect?.top <= 10; // Should be at top
     }`
   });
   // Expected: isSticky === true
   ```

4. **Expand/Collapse All Works**
   ```typescript
   // Collapse all
   await browser_click({
     element: 'Collapse All button',
     ref: 'button[aria-label*="Collapse"]'
   });
   await browser_wait_for({ time: 1 });

   const allCollapsed = await browser_evaluate({
     function: `() => {
       const sections = document.querySelectorAll('[data-collapsible="true"]');
       return Array.from(sections).every(s =>
         s.getAttribute('aria-expanded') === 'false'
       );
     }`
   });
   // Expected: allCollapsed === true

   // Expand all
   await browser_click({
     element: 'Expand All button',
     ref: 'button[aria-label*="Expand"]'
   });
   await browser_wait_for({ time: 1 });

   const allExpanded = await browser_evaluate({
     function: `() => {
       const sections = document.querySelectorAll('[data-collapsible="true"]');
       return Array.from(sections).every(s =>
         s.getAttribute('aria-expanded') === 'true'
       );
     }`
   });
   // Expected: allExpanded === true
   ```

5. **Responsive Works (Quick Check)**
   ```typescript
   // Mobile
   await browser_resize({ width: 375, height: 812 });
   await browser_wait_for({ time: 0.5 });

   const hasOverflow = await browser_evaluate({
     function: `() => document.body.scrollWidth > window.innerWidth;`
   });
   // Expected: hasOverflow === false

   // Desktop
   await browser_resize({ width: 1440, height: 900 });
   await browser_wait_for({ time: 0.5 });
   ```

6. **API Calls Succeed**
   ```typescript
   const networkRequests = await browser_network_requests();
   const apiCalls = networkRequests.filter(req => req.url.includes('/api/ipos/'));
   const failedCalls = apiCalls.filter(req => req.status !== 200);
   // Expected: failedCalls.length === 0
   ```

7. **No Console Errors**
   ```typescript
   const finalConsoleCheck = await browser_console_messages({ onlyErrors: true });
   const errors = finalConsoleCheck.filter(e =>
     e.type === 'error' && !e.text.includes('React DevTools')
   );
   // Expected: errors.length === 0
   ```

8. **Take Final Screenshot**
   ```typescript
   await browser_take_screenshot({
     filename: `end-of-session-${Date.now()}.png`,
     fullPage: true
   });
   ```

### Checklist Summary

| Check | Pass Criteria | Status |
|-------|--------------|--------|
| Page loads | No fatal errors | ☐ |
| Charts render | ≥7 charts visible | ☐ |
| Sticky dashboard | Stays at top on scroll | ☐ |
| Expand/Collapse All | All sections respond | ☐ |
| Responsive | No horizontal overflow | ☐ |
| API calls | All return 200 | ☐ |
| Console clean | Zero errors | ☐ |
| Screenshot captured | Saved to screenshots/ | ☐ |

**If all ✅ PASS**: Update `TEST_PROGRESS.md` with session results
**If any ❌ FAIL**: Document issue in `TEST_ISSUES_LOG.md` and continue debugging

---

## 🏁 Final Regression Test Suite

**Purpose**: Comprehensive end-to-end verification before marking implementation 100% complete

**When to Run**: After ALL test cases pass and ALL issues resolved

**Duration**: ~30-45 minutes

**Prerequisites**:
- All 22 test cases marked as ✅ PASSED
- Zero P0/P1 issues in `TEST_ISSUES_LOG.md`
- All fixes documented in `TEST_FIXES_LOG.md`

### Full Regression Test Procedure:

#### Part 1: Core Functionality (15 min)

```typescript
// 1. Navigate to test IPO
await browser_navigate({ url: 'http://localhost:3000/ipos/test-ipo' });
await browser_resize({ width: 1440, height: 900 });
await browser_wait_for({ time: 3 });

// 2. Verify all 7 base charts render
const charts = await browser_evaluate({
  function: `() => {
    const lineChart = document.querySelector('[data-testid="chart-revenue"]');
    const areaChart = document.querySelector('[data-testid="chart-gmp"]');
    const barChart = document.querySelector('[data-testid="chart-subscription-category"]');
    const pieChart = document.querySelector('[data-testid="chart-subscription-breakdown"]');
    const composedChart = document.querySelector('[data-testid="chart-financial-ratios"]');
    const timeline = document.querySelector('[data-testid="ipo-timeline"]');

    return {
      lineChart: !!lineChart,
      areaChart: !!areaChart,
      barChart: !!barChart,
      pieChart: !!pieChart,
      composedChart: !!composedChart,
      timeline: !!timeline,
      all: [lineChart, areaChart, barChart, pieChart, composedChart, timeline]
        .every(c => c !== null)
    };
  }`
});
console.log('Charts rendered:', charts.all ? '✅ PASS' : '❌ FAIL');

// 3. Test sticky dashboard
await browser_evaluate({ function: `() => window.scrollTo(0, 500);` });
await browser_wait_for({ time: 1 });
await browser_take_screenshot({ filename: 'regression-sticky-dashboard.png' });

// 4. Test timeline widget
const timeline = await browser_evaluate({
  function: `() => {
    const widget = document.querySelector('[data-testid="ipo-timeline"]');
    const milestones = widget?.querySelectorAll('[data-milestone="true"]');
    return {
      visible: !!widget,
      milestones: milestones?.length || 0
    };
  }`
});
console.log('Timeline widget:', timeline.milestones === 5 ? '✅ PASS' : '❌ FAIL');

// 5. Test key metrics cards
const metricsCards = await browser_evaluate({
  function: `() => {
    const cards = document.querySelectorAll('[data-testid^="metric-card-"]');
    return cards.length;
  }`
});
console.log('Metrics cards:', metricsCards >= 4 ? '✅ PASS' : '❌ FAIL');
```

#### Part 2: Interactive Features (10 min)

```typescript
// 6. Test Collapse All functionality
await browser_click({
  element: 'Collapse All button',
  ref: 'button[aria-label*="Collapse"]'
});
await browser_wait_for({ time: 2 });

const allCollapsed = await browser_evaluate({
  function: `() => {
    const sections = document.querySelectorAll('[data-collapsible="true"]');
    const collapsed = Array.from(sections).filter(s =>
      s.getAttribute('aria-expanded') === 'false'
    );
    return {
      total: sections.length,
      collapsed: collapsed.length,
      success: sections.length === collapsed.length
    };
  }`
});
console.log('Collapse All:', allCollapsed.success ? '✅ PASS' : '❌ FAIL');

await browser_take_screenshot({ filename: 'regression-all-collapsed.png', fullPage: true });

// 7. Test Expand All functionality
await browser_click({
  element: 'Expand All button',
  ref: 'button[aria-label*="Expand"]'
});
await browser_wait_for({ time: 2 });

const allExpanded = await browser_evaluate({
  function: `() => {
    const sections = document.querySelectorAll('[data-collapsible="true"]');
    const expanded = Array.from(sections).filter(s =>
      s.getAttribute('aria-expanded') === 'true'
    );
    return {
      total: sections.length,
      expanded: expanded.length,
      success: sections.length === expanded.length
    };
  }`
});
console.log('Expand All:', allExpanded.success ? '✅ PASS' : '❌ FAIL');

await browser_take_screenshot({ filename: 'regression-all-expanded.png', fullPage: true });

// 8. Test individual section toggle
await browser_click({
  element: 'Financial Performance section toggle',
  ref: 'button[aria-controls*="financial"]'
});
await browser_wait_for({ time: 0.5 });
await browser_click({
  element: 'Financial Performance section toggle',
  ref: 'button[aria-controls*="financial"]'
});
await browser_wait_for({ time: 0.5 });
console.log('Individual section toggle: ✅ PASS (if no errors)');

// 9. Test chart hover tooltips
await browser_evaluate({
  function: `() => {
    const chart = document.querySelector('[data-testid="chart-revenue"]');
    chart?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }`
});
await browser_wait_for({ time: 1 });
await browser_hover({
  element: 'Revenue chart data point',
  ref: '.recharts-line-curve circle:first-child'
});
await browser_wait_for({ time: 0.5 });
await browser_take_screenshot({ filename: 'regression-chart-tooltip.png' });
console.log('Chart tooltips: ✅ PASS (if tooltip visible in screenshot)');
```

#### Part 3: Responsive Testing (10 min)

```typescript
// 10. Test mobile responsive
const mobileBreakpoints = [
  { width: 375, height: 812, name: 'iphone-se' },
  { width: 414, height: 896, name: 'iphone-12' }
];

for (const bp of mobileBreakpoints) {
  await browser_resize({ width: bp.width, height: bp.height });
  await browser_wait_for({ time: 1 });

  const overflow = await browser_evaluate({
    function: `() => document.body.scrollWidth > window.innerWidth;`
  });

  await browser_take_screenshot({
    filename: `regression-mobile-${bp.name}.png`,
    fullPage: true
  });

  console.log(`Mobile ${bp.name}:`, !overflow ? '✅ PASS' : '❌ FAIL (overflow)');
}

// 11. Test tablet responsive
await browser_resize({ width: 768, height: 1024 });
await browser_wait_for({ time: 1 });
await browser_take_screenshot({
  filename: 'regression-tablet-ipad.png',
  fullPage: true
});
console.log('Tablet responsive: ✅ PASS');

// 12. Test desktop responsive
await browser_resize({ width: 1440, height: 900 });
await browser_wait_for({ time: 1 });
await browser_take_screenshot({
  filename: 'regression-desktop-laptop.png',
  fullPage: true
});
console.log('Desktop responsive: ✅ PASS');
```

#### Part 4: Error Handling & Edge Cases (5 min)

```typescript
// 13. Test empty state IPO
await browser_navigate({ url: 'http://localhost:3000/ipos/empty-data-test-ipo' });
await browser_wait_for({ time: 2 });

const emptyStates = await browser_evaluate({
  function: `() => {
    const financialEmpty = document.querySelector('[data-testid="financial-empty-state"]');
    const gmpEmpty = document.querySelector('[data-testid="gmp-empty-state"]');
    return {
      financialEmpty: !!financialEmpty,
      gmpEmpty: !!gmpEmpty
    };
  }`
});

await browser_take_screenshot({ filename: 'regression-empty-states.png', fullPage: true });
console.log('Empty states:', emptyStates.financialEmpty ? '✅ PASS' : '❌ FAIL');

// 14. Test console for errors
const finalConsoleCheck = await browser_console_messages({ onlyErrors: true });
const criticalErrors = finalConsoleCheck.filter(e =>
  e.type === 'error' && !e.text.includes('React DevTools')
);
console.log('Console errors:', criticalErrors.length === 0 ? '✅ PASS' : '❌ FAIL');

// 15. Test API network calls
const networkRequests = await browser_network_requests();
const apiCalls = networkRequests.filter(req => req.url.includes('/api/ipos/'));
const failedCalls = apiCalls.filter(req => req.status !== 200);
console.log('API calls:', failedCalls.length === 0 ? '✅ PASS' : '❌ FAIL');
```

### Final Regression Checklist

| Test Category | Tests | Pass | Fail | Notes |
|---------------|-------|------|------|-------|
| Core Charts | 7 | ☐ | ☐ | |
| Sticky Dashboard | 1 | ☐ | ☐ | |
| Timeline Widget | 1 | ☐ | ☐ | |
| Metrics Cards | 1 | ☐ | ☐ | |
| Collapse/Expand | 3 | ☐ | ☐ | |
| Chart Interactions | 1 | ☐ | ☐ | |
| Mobile Responsive | 2 | ☐ | ☐ | |
| Tablet Responsive | 1 | ☐ | ☐ | |
| Desktop Responsive | 1 | ☐ | ☐ | |
| Empty States | 1 | ☐ | ☐ | |
| Console Errors | 1 | ☐ | ☐ | |
| API Calls | 1 | ☐ | ☐ | |
| **TOTAL** | **22** | **☐** | **☐** | |

**Completion Criteria**:
- ✅ All 22 regression tests PASS
- ✅ Zero console errors
- ✅ Zero API failures
- ✅ All screenshots captured
- ✅ Performance targets met (LCP < 2.5s, FID < 100ms, CLS < 0.1)

**If ALL PASS**: Proceed to Final Sign-off
**If ANY FAIL**: Document issue, fix, rerun regression

---

## 📝 Test Documentation Templates

### TEST_PROGRESS.md

**⚠️ CRITICAL**: This file is the **single source of truth** for session state. It MUST be updated at the end of each session.

```markdown
# Test Progress Tracker

**Last Updated**: YYYY-MM-DD HH:MM
**Current Session**: #X
**Overall Status**: X% Complete (X/22 tests passed)
**Started**: YYYY-MM-DD (Session #1)

---

## 📊 Quick Summary

| Metric | Value |
|--------|-------|
| Total Test Cases | 22 |
| Passed | X |
| Failed | X |
| In Progress | X |
| Pending | X |
| Pass Rate | XX% |
| Open Issues | X (P0: X, P1: X, P2: X, P3: X) |
| Fixed Issues | X |
| Total Sessions | X |
| Time Invested | X hours |

---

## 🗓️ Session History

### Session #X - YYYY-MM-DD HH:MM to HH:MM (Duration: X hours)
**Objective**: [e.g., Fix P0 issues and complete Phase 3 tests]
**Progress**: XX% → YY% (+ZZ%)

**Tests Executed**:
- TC3.2: ❌ → ✅ (fixed after Issue #002)
- TC4.1: ✅ PASSED
- TC4.2: ⏳ IN PROGRESS (50% complete)

**Issues**:
- Fixed: #002 (Subscription chart not rendering)
- New: #004 (Collapse animation timing)

**Next Session Plan**:
1. Complete TC4.2 (Expand/Collapse All)
2. Start TC4.3 (State Management)
3. Target: Reach 65% completion

---

### Session #2 - YYYY-MM-DD HH:MM to HH:MM (Duration: X hours)
**Objective**: [Previous session objective]
**Progress**: XX% → YY% (+ZZ%)
...

---

## 📋 Test Summary by Category

| Category | Total Tests | Passed | Failed | In Progress | Pending | Pass Rate |
|----------|-------------|--------|--------|-------------|---------|-----------|
| Phase 1  | 3           | X      | X      | X           | X       | XX%       |
| Phase 2  | 3           | X      | X      | X           | X       | XX%       |
| Phase 3  | 5           | X      | X      | X           | X       | XX%       |
| Phase 4  | 3           | X      | X      | X           | X       | XX%       |
| Cross-Cutting | 8      | X      | X      | X           | X       | XX%       |
| **TOTAL** | **22**    | **X**  | **X**  | **X**       | **X**   | **XX%**   |

---

## ✅ Detailed Test Results

**Legend**:
- ✅ PASSED - Test completed successfully
- ❌ FAILED - Test failed (see Issue #XXX)
- ⏳ IN PROGRESS - Currently working on this test
- ⏸️ PENDING - Not yet started
- 🔄 RETEST - Needs retesting after fix

### Phase 1: Core Infrastructure (X/3 passed)
- [x] **TC1.1** - Chart Components Rendering ✅ (Session #1)
- [ ] **TC1.2** - Chart Data Transformations ❌ → 🔄 (See Issue #001, fixed in Session #2, needs retest)
- [x] **TC1.3** - Responsive Chart Containers ✅ (Session #1)

### Phase 2: Sticky Dashboard (X/3 passed)
- [x] **TC2.1** - IPO Timeline Widget ✅ (Session #2)
- [x] **TC2.2** - Key Metrics Cards ✅ (Session #2)
- [ ] **TC2.3** - Sticky Dashboard Behavior ⏳ (Session #3 - In Progress)

### Phase 3: Main Visualizations (X/5 passed)
- [x] **TC3.1** - Financial Performance Charts ✅ (Session #2)
- [ ] **TC3.2** - Subscription Dashboard ❌ → ✅ (Fixed Issue #002 in Session #3)
- [ ] **TC3.3** - Post-Listing Performance Charts ⏸️ (Pending)
- [ ] **TC3.4** - Demand Distribution Graph ⏸️ (Pending - conditional test)
- [ ] **TC3.5** - Enhanced GMP History Chart ⏸️ (Pending)

### Phase 4: Progressive Disclosure (X/3 passed)
- [ ] **TC4.1** - Collapsible Sections ⏸️ (Pending)
- [ ] **TC4.2** - SectionControlBar ⏸️ (Pending)
- [ ] **TC4.3** - State Management ⏸️ (Pending)

### Cross-Cutting Concerns (X/8 passed)
- [ ] **TC5.1** - Loading States & Skeletons ⏸️ (Pending)
- [ ] **TC5.2** - Error States & Boundaries ⏸️ (Pending)
- [ ] **TC5.3** - Empty States & Missing Data ⏸️ (Pending)
- [ ] **TC5.4** - API & Network Validation ⏸️ (Pending)
- [ ] **TC5.5** - Performance Metrics ⏸️ (Pending)
- [ ] **TC5.6** - Browser Console Errors ⏸️ (Pending)
- [ ] **TC5.7** - Accessibility (WCAG AA) ⏸️ (Pending)
- [ ] **TC5.8** - Responsive Design ⏸️ (Pending)

---

## 🐛 Current Issues Summary

**Open Issues** (X total):
- **P0 (Critical)**: X issues - [List Issue IDs]
- **P1 (High)**: X issues - [List Issue IDs]
- **P2 (Medium)**: X issues - [List Issue IDs]
- **P3 (Low)**: X issues - [List Issue IDs]

**Recently Fixed** (Session #X):
- Issue #002: Subscription chart not rendering (P0) → 🟢 Fixed & Verified

**Needs Retest** (After fixes):
- TC1.2 - After fixing Issue #001

---

## 🎯 Next Session Plan

**Session #X+1 Goals**:
1. [Primary objective]
2. [Secondary objective]
3. [Stretch goal]

**Target Progress**: XX% → YY% (+ZZ%)
**Estimated Duration**: X hours
**Prerequisites**: [Any blockers or dependencies]

---

## 📝 Session Notes

### Session #X (Current)
- [Notes about this session]
- [Blockers encountered]
- [Decisions made]

### Session #2
- [Previous session notes]
...

---

## 🏁 Completion Checklist

**Required for 100% Completion**:
- [ ] All 22 test cases PASSED
- [ ] Zero P0 issues
- [ ] <2 P1 issues (90% resolved)
- [ ] End-of-Session Verification: 8/8 ✅
- [ ] Final Regression Suite: 22/22 ✅
- [ ] All screenshots captured
- [ ] Final Completion Report generated

**Current Status**: XX% Complete
**Estimated Sessions Remaining**: X
**Estimated Time to Completion**: X hours
```

---

### TEST_ISSUES_LOG.md

```markdown
# Test Issues Log

## Issue #001
**Status**: 🔴 Open | **Severity**: P1 (High) | **Discovered**: YYYY-MM-DD
**Test Case**: TC1.2 - Chart Data Transformations
**Component**: `web/lib/utils/chart-data.ts`

**Description**:
Chart data transformation throws error when financial data has null values.

**Reproduction Steps**:
1. Navigate to IPO with incomplete financial data
2. Open DevTools console
3. Observe error: "Cannot read property 'toFixed' of null"

**Expected Behavior**:
- Transformation should handle null values gracefully
- Chart should display with partial data or empty state

**Actual Behavior**:
- Error thrown in console
- Chart fails to render

**Screenshots**:
- `issue-001-console-error.png`
- `issue-001-chart-missing.png`

**Proposed Fix**:
Add null checks in transformation function:
```typescript
export function transformFinancialData(data: FinancialData[]) {
  return data.map(item => ({
    year: item.fiscalYear,
    revenue: item.revenue?.toFixed(2) ?? 'N/A',
    // ... handle nulls
  }));
}
```

**Priority Justification**:
P1 because it breaks charts but doesn't crash entire page.

---

## Issue #002
**Status**: 🔴 Open | **Severity**: P0 (Critical) | **Discovered**: YYYY-MM-DD
**Test Case**: TC3.2 - Subscription Dashboard
...
```

---

### TEST_FIXES_LOG.md

```markdown
# Test Fixes Log

## Fix #001
**Issue**: #001 - Chart Data Transformations
**Fixed Date**: YYYY-MM-DD HH:MM
**Fixed By**: Claude Code
**Commit**: abc1234 (if committed)

**Changes Made**:
1. Modified `web/lib/utils/chart-data.ts`
   - Added null checks for all numeric fields
   - Added default fallback values ('N/A' or 0)
   - Added TypeScript strict null checking

2. Modified `web/components/ipo/charts/base/LineChart.tsx`
   - Added error boundary
   - Added empty state for invalid data

**Files Modified**:
- `web/lib/utils/chart-data.ts` (lines 45-67)
- `web/components/ipo/charts/base/LineChart.tsx` (lines 120-135)

**Testing**:
- ✅ Verified null values handled gracefully
- ✅ Chart displays with partial data
- ✅ Console errors eliminated
- ✅ Regression test passed (other charts unaffected)

**Retest Results**:
- TC1.2: ✅ PASSED

---

## Fix #002
**Issue**: #002 - Subscription Dashboard Not Rendering
...
```

---

## 🔄 Iterative Testing Workflow

### Session Template

Use this template for each testing session:

```markdown
## Testing Session #X - YYYY-MM-DD

**Objective**: [Describe session goal]
**Duration**: [Start time] - [End time]
**Browser**: Chromium (headed mode)
**Viewport**: 1440x900 (desktop)

### Pre-Session Setup
- [x] Dev server started (http://localhost:3000)
- [x] Database seeded with test data
- [x] Previous issues reviewed
- [x] Browser installed and updated

### Test Execution
1. **Batch 1: Phase 1 Tests (TC1.1 - TC1.3)**
   - TC1.1: ✅ PASSED
   - TC1.2: ❌ FAILED → Issue #001
   - TC1.3: ✅ PASSED

2. **Issue Fixing (Issue #001)**
   - Root cause: Null handling in data transformation
   - Fix applied: See Fix #001
   - Retest: ✅ TC1.2 PASSED

3. **Batch 2: Phase 2 Tests (TC2.1 - TC2.3)**
   - TC2.1: ✅ PASSED
   - TC2.2: ✅ PASSED
   - TC2.3: ⏸️ SKIPPED (time limit)

### Session Summary
- **Tests Run**: 5
- **Tests Passed**: 4
- **Tests Failed**: 1 (fixed)
- **Issues Discovered**: 1
- **Issues Fixed**: 1
- **Overall Progress**: 25% → 45% (+20%)

### Next Session Plan
1. Continue with TC2.3 (Sticky Dashboard Behavior)
2. Complete Phase 3 tests (TC3.1 - TC3.5)
3. Target: Reach 70% test completion

### Screenshots Captured
- `session-1-chart-components.png`
- `session-1-timeline-widget.png`
- `issue-001-console-error.png`
- `fix-001-verification.png`
```

---

## 🎬 Example Playwright MCP Commands

### Initialize Session

```typescript
// 1. Navigate to page in headed mode
await mcp__playwright__browser_navigate({
  url: 'http://localhost:3000/ipos/xyz-corporation-ipo'
});

// 2. Resize to desktop viewport
await mcp__playwright__browser_resize({
  width: 1440,
  height: 900
});

// 3. Take baseline screenshot
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-initial-load.png'
});

// 4. Wait for page to fully load
await mcp__playwright__browser_wait_for({
  time: 2 // 2 seconds
});
```

---

### Test Collapsible Sections

```typescript
// 1. Get page snapshot to see interactive elements
const snapshot = await mcp__playwright__browser_snapshot();

// 2. Click first collapsible section toggle
await mcp__playwright__browser_click({
  element: 'Financial Performance Analysis section toggle',
  ref: 'button[aria-controls="collapsible-section-financial"]'
});

// 3. Wait for animation
await mcp__playwright__browser_wait_for({ time: 0.5 });

// 4. Verify collapsed state
await mcp__playwright__browser_evaluate({
  function: `() => {
    const section = document.querySelector('#collapsible-section-financial');
    return section?.getAttribute('aria-expanded') === 'false';
  }`
});

// 5. Screenshot collapsed state
await mcp__playwright__browser_take_screenshot({
  filename: 'section-financial-collapsed.png'
});
```

---

### Test Expand All / Collapse All

```typescript
// 1. Find Collapse All button
const snapshot = await mcp__playwright__browser_snapshot();

// 2. Click Collapse All
await mcp__playwright__browser_click({
  element: 'Collapse All button',
  ref: 'button[aria-label*="Collapse"]'
});

// 3. Wait for staggered animation (1 second)
await mcp__playwright__browser_wait_for({ time: 1 });

// 4. Verify all sections collapsed
const allCollapsed = await mcp__playwright__browser_evaluate({
  function: `() => {
    const sections = document.querySelectorAll('[data-collapsible="true"]');
    const collapsed = Array.from(sections).filter(s =>
      s.getAttribute('aria-expanded') === 'false'
    );
    return {
      total: sections.length,
      collapsed: collapsed.length,
      allCollapsed: sections.length === collapsed.length
    };
  }`
});

// 5. Take screenshot
await mcp__playwright__browser_take_screenshot({
  filename: 'all-sections-collapsed.png',
  fullPage: true
});

// 6. Click Expand All
await mcp__playwright__browser_click({
  element: 'Expand All button',
  ref: 'button[aria-label*="Expand"]'
});

// 7. Wait and verify
await mcp__playwright__browser_wait_for({ time: 1 });
await mcp__playwright__browser_take_screenshot({
  filename: 'all-sections-expanded.png',
  fullPage: true
});
```

---

### Test Chart Hover Tooltips

```typescript
// 1. Navigate to chart area
await mcp__playwright__browser_evaluate({
  function: `() => {
    const chart = document.querySelector('[data-testid="chart-revenue"]');
    chart?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }`
});

await mcp__playwright__browser_wait_for({ time: 1 });

// 2. Hover over chart data point
await mcp__playwright__browser_hover({
  element: 'Revenue chart first data point',
  ref: '.recharts-line-curve circle:first-child'
});

// 3. Wait for tooltip to appear
await mcp__playwright__browser_wait_for({ time: 0.3 });

// 4. Screenshot tooltip
await mcp__playwright__browser_take_screenshot({
  filename: 'chart-tooltip-revenue.png'
});

// 5. Verify tooltip content
const tooltipData = await mcp__playwright__browser_evaluate({
  function: `() => {
    const tooltip = document.querySelector('.recharts-tooltip-wrapper');
    return {
      visible: tooltip?.style.visibility === 'visible',
      content: tooltip?.textContent
    };
  }`
});
```

---

### Check Console Errors

```typescript
// 1. Get all console messages
const consoleMessages = await mcp__playwright__browser_console_messages({
  onlyErrors: true
});

// 2. Filter critical errors
const criticalErrors = consoleMessages.filter(msg =>
  msg.type === 'error' &&
  !msg.text.includes('React DevTools') // Ignore dev-only warnings
);

// 3. Document errors in TEST_ISSUES_LOG.md
if (criticalErrors.length > 0) {
  console.log('❌ Found console errors:');
  criticalErrors.forEach((err, idx) => {
    console.log(`  ${idx + 1}. ${err.text}`);
  });
}
```

---

### Test Responsive Breakpoints

```typescript
const breakpoints = [
  { width: 375, height: 812, name: 'mobile-iphone-se' },
  { width: 414, height: 896, name: 'mobile-iphone-12' },
  { width: 768, height: 1024, name: 'tablet-ipad' },
  { width: 1024, height: 768, name: 'tablet-landscape' },
  { width: 1440, height: 900, name: 'desktop-laptop' },
  { width: 1920, height: 1080, name: 'desktop-fullhd' }
];

for (const bp of breakpoints) {
  // Resize
  await mcp__playwright__browser_resize({
    width: bp.width,
    height: bp.height
  });

  // Wait for reflow
  await mcp__playwright__browser_wait_for({ time: 0.5 });

  // Screenshot
  await mcp__playwright__browser_take_screenshot({
    filename: `responsive-${bp.name}.png`,
    fullPage: true
  });

  // Check for horizontal scroll (should not exist)
  const hasOverflow = await mcp__playwright__browser_evaluate({
    function: `() => {
      return document.body.scrollWidth > window.innerWidth;
    }`
  });

  if (hasOverflow) {
    console.log(`⚠️ Horizontal overflow detected at ${bp.name}`);
    // Document as Issue
  }
}
```

---

## 🎯 Completion Criteria

### Test Completion

The implementation is considered **100% validated** when:

1. **All 22 Test Cases Pass** (TC1.1 - TC5.8)
   - ✅ Phase 1: 3/3 passed
   - ✅ Phase 2: 3/3 passed
   - ✅ Phase 3: 5/5 passed
   - ✅ Phase 4: 3/3 passed
   - ✅ Cross-Cutting: 8/8 passed

2. **Zero Critical Issues (P0)**
   - All P0 issues resolved and retested

3. **High-Priority Issues Resolved (P1)**
   - At least 90% of P1 issues fixed

4. **Performance Targets Met**
   - LCP < 2.5s
   - FID < 100ms
   - CLS < 0.1
   - Lighthouse Performance score ≥ 90

5. **Accessibility Validated**
   - Lighthouse Accessibility score ≥ 90
   - Keyboard navigation 100% functional
   - ARIA attributes complete

6. **Responsive Validated**
   - All 6 breakpoints tested
   - No horizontal overflow
   - All touch targets ≥ 44px on mobile

7. **Documentation Complete**
   - `TEST_PROGRESS.md` shows 100% completion
   - All issues documented in `TEST_ISSUES_LOG.md`
   - All fixes documented in `TEST_FIXES_LOG.md`
   - Final completion report generated

8. **Final Regression Suite Passed** ✨ NEW
   - End-of-Session Verification Checklist: 8/8 ✅
   - Final Regression Test Suite: 22/22 ✅
   - All screenshots captured and reviewed
   - Zero console errors in final check

---

### Final Sign-off Checklist

**Before marking implementation 100% complete**, verify this checklist:

| Category | Requirement | Status | Notes |
|----------|-------------|--------|-------|
| **Test Cases** | All 22 test cases PASSED | ☐ | See TEST_PROGRESS.md |
| **Issues** | Zero P0 issues open | ☐ | See TEST_ISSUES_LOG.md |
| **Issues** | <2 P1 issues open (90% resolved) | ☐ | See TEST_ISSUES_LOG.md |
| **Performance** | LCP < 2.5s | ☐ | Run Lighthouse |
| **Performance** | FID < 100ms | ☐ | Run Lighthouse |
| **Performance** | CLS < 0.1 | ☐ | Run Lighthouse |
| **Performance** | Lighthouse Performance ≥ 90 | ☐ | Run Lighthouse |
| **Accessibility** | Lighthouse Accessibility ≥ 90 | ☐ | Run Lighthouse |
| **Accessibility** | Keyboard navigation 100% | ☐ | Manual test |
| **Accessibility** | All ARIA labels present | ☐ | Browser evaluate check |
| **Responsive** | Mobile (375px): No overflow | ☐ | Visual test |
| **Responsive** | Tablet (768px): 2-column layout | ☐ | Visual test |
| **Responsive** | Desktop (1440px): Full dashboard | ☐ | Visual test |
| **Responsive** | All touch targets ≥ 44px | ☐ | Mobile test |
| **Loading States** | ChartSkeleton renders | ☐ | TC5.1 |
| **Error States** | ChartErrorBoundary works | ☐ | TC5.2 |
| **Empty States** | Graceful "No data" messages | ☐ | TC5.3 |
| **API** | All endpoints return 200 | ☐ | TC5.4 |
| **Console** | Zero errors (production) | ☐ | TC5.6 |
| **Charts** | All 7 base charts render | ☐ | TC1.1 |
| **Timeline** | 5 milestones display | ☐ | TC2.1 |
| **Metrics Cards** | 4 cards with sparklines | ☐ | TC2.2 |
| **Sticky Dashboard** | Sticks on scroll (desktop) | ☐ | TC2.3 |
| **Financials** | 4 financial sub-charts | ☐ | TC3.1 |
| **Subscription** | 4 subscription sub-charts | ☐ | TC3.2 |
| **Listing** | 3 listing charts (conditional) | ☐ | TC3.3 |
| **Demand Graph** | Price bucket histogram (conditional) | ☐ | TC3.4 |
| **GMP History** | 30-day trend with confidence bands | ☐ | TC3.5 |
| **Collapsible** | 9 sections expand/collapse | ☐ | TC4.1 |
| **Control Bar** | Expand All / Collapse All | ☐ | TC4.2 |
| **State Mgmt** | useSectionControl hook | ☐ | TC4.3 |
| **Regression** | End-of-Session Verification: 8/8 | ☐ | See checklist above |
| **Regression** | Final Regression Suite: 22/22 | ☐ | See regression section |
| **Documentation** | TEST_PROGRESS.md finalized | ☐ | 100% completion |
| **Documentation** | TEST_ISSUES_LOG.md complete | ☐ | All issues documented |
| **Documentation** | TEST_FIXES_LOG.md complete | ☐ | All fixes documented |
| **Documentation** | FINAL_COMPLETION_REPORT.md | ☐ | Report generated |
| **Screenshots** | All test screenshots captured | ☐ | In screenshots/ folder |
| **Code Quality** | No console.log in production code | ☐ | Code review |
| **Code Quality** | No commented-out code | ☐ | Code review |
| **Code Quality** | TypeScript strict mode passing | ☐ | `npm run type-check` |
| **Build** | Production build succeeds | ☐ | `npm run build` |
| **Database** | Test data cleanup script run | ☐ | Optional |

**Total Checklist Items**: 43
**Required to Pass**: 41/43 (95%+)
**Optional**: Database cleanup (1 item)

**Sign-off**:
- ✅ **All Critical Items Passed** (43/43 or 95%+)
- ✅ **Ready for Production Deployment**
- ✅ **Handoff to UAT/Staging**

---

### Final Completion Report Template

```markdown
# Final Test Completion Report - IPO Details Page

**Date**: YYYY-MM-DD
**Total Testing Duration**: X hours across Y sessions
**Implementation Coverage**: Phases 1-4 (100%)
**Test Coverage**: 22/22 test cases (100%)

## Executive Summary

The IPO Details Page UI/UX enhancement implementation has been fully validated through comprehensive Playwright MCP testing in headed mode. All acceptance criteria have been met, and the implementation is ready for production deployment.

## Test Results Summary

| Metric | Result | Target | Status |
|--------|--------|--------|--------|
| Test Cases Passed | 22/22 | 22 | ✅ 100% |
| P0 Issues | 0 | 0 | ✅ |
| P1 Issues | 0 | < 2 | ✅ |
| Performance (LCP) | 2.1s | < 2.5s | ✅ |
| Performance (FID) | 65ms | < 100ms | ✅ |
| Performance (CLS) | 0.05 | < 0.1 | ✅ |
| Accessibility Score | 95 | ≥ 90 | ✅ |
| Responsive Breakpoints | 6/6 | 6 | ✅ |
| Regression Tests | 22/22 | 22 | ✅ 100% |
| End-of-Session Checks | 8/8 | 8 | ✅ 100% |

## Issues Resolved

Total issues discovered: X
- P0 (Critical): X → All resolved ✅
- P1 (High): X → All resolved ✅
- P2 (Medium): X → X resolved, X deferred to backlog
- P3 (Low): X → X resolved, X deferred

## Key Achievements

1. **Chart Infrastructure**: All 7 base chart components render flawlessly
2. **Sticky Dashboard**: Timeline and metrics cards work seamlessly
3. **Main Visualizations**: 5 chart suites display data correctly
4. **Progressive Disclosure**: Expand/Collapse system 100% functional
5. **Performance**: All Core Web Vitals within green zone
6. **Accessibility**: WCAG AA compliant with score of 95

## Recommendations

1. **Phase 5**: Proceed with polish & optimization phase
2. **Production Deployment**: Implementation ready for prod release
3. **Future Enhancements**: Consider adding [list items from P2/P3 backlog]

## Screenshots

- See `docs/19-ui/ipo-detail-page/screenshots/` for all test screenshots

## Sign-off

✅ **Implementation Validated**: Ready for Production
✅ **Documentation Complete**: All logs and reports finalized
✅ **Next Steps**: Deploy to staging environment for UAT

---

**Tested by**: Claude Code + Playwright MCP
**Validated by**: [Human reviewer]
**Date**: YYYY-MM-DD
```

---

## 📂 File Organization

All test-related files should be saved in:

```
docs/19-ui/ipo-detail-page/
├── PLAYWRIGHT_TESTING_PROMPT.md (this file)
├── TEST_PROGRESS.md (updated each session)
├── TEST_ISSUES_LOG.md (all issues)
├── TEST_FIXES_LOG.md (all fixes)
├── FINAL_COMPLETION_REPORT.md (when done)
└── screenshots/
    ├── baseline-initial-load.png
    ├── session-1-chart-components.png
    ├── issue-001-console-error.png
    ├── fix-001-verification.png
    └── ... (all test screenshots)
```

---

## 🚀 Session Prompts

### First Session Prompt (New Testing)

Use this prompt to begin your **first testing session**:

```
I need to start testing the IPO Details Page UI/UX enhancement implementation using Playwright MCP in headed mode.

**Context**:
- Implementation: Phases 1-4 complete (90%)
- Testing Prompt: docs/19-ui/ipo-detail-page/PLAYWRIGHT_TESTING_PROMPT.md
- Test Data: Available at http://localhost:3000/ipos/[slug]

**First Session Goals**:
1. Initialize TEST_PROGRESS.md tracker (Session #1)
2. Run Phase 1 tests (TC1.1 - TC1.3)
3. Run Phase 2 tests (TC2.1 - TC2.3)
4. Document any issues discovered
5. Target: Complete at least 30% of test cases (7/22)

**Please**:
1. Start the Playwright browser in headed mode
2. Navigate to an IPO detail page with complete data
3. Follow the test cases in PLAYWRIGHT_TESTING_PROMPT.md
4. Document results in TEST_PROGRESS.md as we go
5. Create TEST_ISSUES_LOG.md for any failures
6. Create TEST_FIXES_LOG.md for any fixes applied
7. Take screenshots for evidence
8. **At end of session**: Save state files and update progress

Let's begin with TC1.1 - Chart Components Rendering.
```

---

### Session Continuation Prompt (Resuming Testing)

Use this prompt to **continue testing from a previous session**:

```
I need to continue testing the IPO Details Page UI/UX enhancement from my previous session.

**IMPORTANT - Session Continuation**:
1. Read docs/19-ui/ipo-detail-page/TEST_PROGRESS.md to see current status
2. Read docs/19-ui/ipo-detail-page/TEST_ISSUES_LOG.md to see open issues
3. Read docs/19-ui/ipo-detail-page/TEST_FIXES_LOG.md to see what was fixed
4. Display a session summary showing:
   - Previous session number
   - Overall completion percentage
   - Which tests passed/failed/pending
   - Open issues (P0, P1, P2, P3)
   - Next steps from previous session

**This Session Goals** (based on previous session notes):
[Claude will determine goals after reading state files]

**Please**:
1. Start by reading the three state files above
2. Display the session continuation summary
3. Start Playwright browser in headed mode
4. Continue from where we left off
5. Update state files after each test
6. Save state at end of session

Let's continue testing!
```

---

### Quick Session Resume (Same Day Continuation)

Use this prompt if **resuming within a few hours of previous session**:

```
Resume testing from Session #X (same day continuation).

**Quick Context**:
- Previous session: #X (YYYY-MM-DD HH:MM)
- Current progress: XX% (X/22 tests passed)
- Last test: [Test case ID and status]
- Next test: [Test case ID]

**Please**:
1. Verify state files are current (check timestamps)
2. Resume from [Next test case]
3. Continue updating state files in real-time

Ready to continue!
```

---

### Bug Fix Session Prompt

Use this prompt for a **dedicated bug fixing session**:

```
I need to fix bugs/issues discovered in previous testing sessions.

**Bug Fix Session**:
1. Read docs/19-ui/ipo-detail-page/TEST_ISSUES_LOG.md
2. Display all open issues sorted by priority (P0 → P1 → P2 → P3)
3. Start with P0 issues (critical blockers)
4. For each fix:
   - Update issue status to "🟡 In Progress"
   - Apply fix
   - Run targeted retest
   - Run post-fix verification protocol (5 steps)
   - Update issue status to "🟢 Fixed" if verified
   - Document fix in TEST_FIXES_LOG.md
5. Update TEST_PROGRESS.md with retested test cases

**Session Goal**: Fix all P0 issues and at least 50% of P1 issues

Let's start fixing!
```

---

### End-of-Testing Verification Session

Use this prompt when **all 22 tests have passed and ready for final verification**:

```
All 22 test cases have passed! Ready for final verification before 100% completion.

**Final Verification Session**:
1. Run End-of-Session Verification Checklist (8 checks)
2. Run Final Regression Test Suite (30-45 min, 22 tests)
3. Complete Final Sign-off Checklist (43 items)
4. Generate FINAL_COMPLETION_REPORT.md
5. Verify all state files are finalized
6. Capture final screenshots

**Completion Criteria**:
- All 22 test cases: ✅ PASSED
- Zero P0 issues
- <2 P1 issues (90% resolved)
- Performance targets met (LCP < 2.5s, FID < 100ms, CLS < 0.1)
- Accessibility score ≥ 90
- All 6 breakpoints tested

Let's complete the final verification!
```

---

**Document Version**: 2.0
**Created**: 2025-11-02
**Last Updated**: 2025-11-02 (Enhanced with comprehensive verification)
**Maintained By**: Claude Code

## 📋 Version 2.0 Updates

**Major Enhancements:**
1. ✅ **Session State Management** - Complete state persistence across sessions
   - Three state files: TEST_PROGRESS.md, TEST_ISSUES_LOG.md, TEST_FIXES_LOG.md
   - Session initialization reads previous state
   - Real-time state updates during testing
   - Session end saves complete state
   - Session history tracking with duration and objectives
2. ✅ **Test Data Setup** - Added comprehensive test data requirements and validation scripts
3. ✅ **Environment Validation** - Added Node.js, npm, TypeScript verification steps
4. ✅ **Post-Fix Verification Protocol** - 5-step protocol to ensure fixes don't break other features
5. ✅ **Additional Test Cases** - Added 3 critical test cases (TC5.1-5.4):
   - TC5.1: Loading States & Skeletons
   - TC5.2: Error States & Boundaries
   - TC5.3: Empty States & Missing Data
   - TC5.4: API & Network Validation
6. ✅ **End-of-Session Verification Checklist** - 8-step quick smoke test after each session
7. ✅ **Final Regression Test Suite** - Comprehensive 30-45 min end-to-end test (22 tests)
8. ✅ **Final Sign-off Checklist** - 43-item comprehensive checklist before 100% completion
9. ✅ **Session Continuation Prompts** - 5 pre-built prompts for different scenarios:
   - First session prompt
   - Session continuation prompt
   - Quick session resume
   - Bug fix session prompt
   - End-of-testing verification prompt
10. ✅ **Enhanced TEST_PROGRESS.md Template** - Session history, detailed status tracking, next steps

**Test Count Update**: 19 → 22 test cases (+3 critical tests)

**Key Improvements:**
- **State persistence across sessions** - Never lose testing progress
- **Session continuity** - Pick up exactly where you left off
- **Session history tracking** - Complete audit trail of all testing sessions
- Ensures everything works at the end of each session
- Prevents regression after fixes
- Validates loading, error, and empty states
- Comprehensive API/network monitoring
- Final regression ensures nothing is broken before deployment
- **Real-time updates** - State files updated after each test
- **Multiple session types** - Different prompts for different testing scenarios
