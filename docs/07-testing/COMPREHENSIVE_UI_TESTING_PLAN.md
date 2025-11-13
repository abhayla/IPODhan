# Comprehensive UI Testing Plan - IPODhan

**Created**: 2025-11-12
**Status**: Planning Phase
**Timeline**: 11 weeks
**Owner**: QA Team

---

## 📊 Executive Summary

This document outlines a comprehensive UI testing strategy for the IPODhan application. Based on detailed analysis of the current testing infrastructure, this plan addresses critical gaps while building on the strong existing foundation of 63 E2E tests, 71 integration tests, and 69 component tests.

### Key Findings
- **Strong Foundation**: Mature testing infrastructure with Playwright, Vitest, and React Testing Library
- **Critical Gaps**: Component coverage at 29%, zero visual regression testing, minimal accessibility coverage
- **~~Known Issues~~**: ✅ **FIXED** - Production-blocking hydration failures on Dashboard and IPO Detail pages (Session 2 - Nov 12, 2025)
- **Priority**: Focus on visual regression, accessibility, and console error investigation (Task 1.3)

### 🎯 **NEW: Playwright MCP Integration Strategy**

**Testing Approach - Enhanced with Playwright MCP in Headed Mode:**

- **60% Playwright MCP (Headed Mode)**: Interactive UI verification, visual testing, manual exploration
- **30% Native Playwright (Automated)**: CI/CD pipeline, regression tests, cross-browser automation
- **10% Chrome DevTools MCP**: Performance profiling, memory analysis, optimization

**Key Benefits of Playwright MCP Headed Mode:**
- ✅ **Visual Verification**: See actual UI changes in real-time during testing
- ✅ **Interactive Debugging**: Claude-assisted exploration of UI states
- ✅ **Rapid Validation**: Quick manual checks during development
- ✅ **Screenshot Documentation**: Capture visual evidence of bugs/features
- ✅ **Accessibility Snapshot**: Use `browser_snapshot` for better accessibility inspection than screenshots

---

## 1. Current State Analysis

### 1.1 Existing Testing Infrastructure

#### ✅ **Test Framework (Excellent)**
- **Playwright 1.55.1**: 7 browser targets configured (Chromium, Firefox, Edge, WebKit, Mobile Chrome/Safari, iPad)
- **Vitest 3.2.4**: Unit/integration testing with 80% coverage targets (90% for repositories)
- **React Testing Library 16.3.0**: Component testing (React 19 compatible)
- **Test Pyramid**: 70% unit, 20% integration, 10% E2E (as per strategy)

#### ✅ **E2E Test Coverage (63 test files)**

**Comprehensive Coverage Includes:**
- **Admin Pages** (6 files): Login, IPO edit, audit log, cache management, DRHP extraction, dynamic admin
- **Affiliate Features** (2 files): Broker affiliates, integration tracking
- **Core User Journeys** (48 files):
  - Homepage, dashboard, filters, search
  - IPO detail pages with all tabs (Info, Financials, Subscription, GMP, Documents, Reviews)
  - Historical IPOs, listings, performance trackers
  - Mainboard/SME specific pages (calendar, prospectus, reviews)
  - Specialty pages (NCD, OFS, Rights Issues)
  - Tools (lot calculator, compare IPOs, allotment checker)
  - Market holidays (comprehensive tests)
- **UX Transformation Tests** (5 phases):
  - Phase 1: Visual Identity
  - Phase 2: Data Intelligence
  - Phase 3: Real-time Experience
  - Phase 4: Mobile Excellence
  - Phase 5: Personalization
- **User Journey Tests** (4 comprehensive journeys):
  - Journey 1: Investor research flow
  - Journey 2: Calculator usage
  - Journey 3: Allotment checking
  - Journey 4: Comprehensive research flow

#### ✅ **Component Unit Tests (69 tests)**

**Tested Components:**
- Affiliate components (CTAs, buttons)
- Dashboard components (filters, search bar)
- History components (tables, pagination, search)
- Home components (IPO tables)
- IPO detail components (30+ tests for cards, metrics, charts, sections)
- Filter components (category, sector, status, clear filters)

#### ✅ **Integration Tests (71 tests)**

**Coverage:**
- API routes (IPOs, subscriptions, GMP, health, reviews, registrars)
- Repository layer with real PostgreSQL + Redis
- Data flow (scraper → DB → API → UI)
- Cache invalidation patterns
- Admin protection middleware
- Fuzzy name matching
- Historical migration

### 1.2 Technology Stack Considerations

#### **Frontend Technologies**
- **Next.js 14.2.15** with App Router (LTS - downgraded from 15.5.4 to fix hydration issues)
- **React 18.3.1** (stable - downgraded from 19.1.0 to fix production blockers)
- **TypeScript 5** (strict mode enabled)
- **Tailwind CSS 4** (latest)
- **Radix UI**: Accessible component primitives
- **Note**: Version downgrades implemented in Session 2 (2025-11-12) to resolve P0 IPO Detail page crashes
- **Recharts 3.2.1**: Data visualization library

#### **Testing Technologies**
- **Playwright**: Cross-browser E2E testing
- **Vitest**: Fast unit/integration testing
- **@testing-library/react 16.3.0**: React 19 compatible
- **@vitest/coverage-v8**: Code coverage reporting

### 1.3 Known Issues (Production Blockers)

✅ **Recently Fixed (Session 2 - 2025-11-12):**

1. **~~Webpack Module Loading Error~~** ✅ **FIXED**
   - **Affects**: Dashboard page, IPO Detail page
   - **Impact**: Production crashes
   - **First Reported**: November 1, 2025
   - **Status**: ✅ **RESOLVED** - Downgraded Next.js 16.0.1 → 14.2.15 LTS
   - **Fix Date**: November 12, 2025 (Session 2)

2. **~~React 19 Hydration Failures~~** ✅ **FIXED**
   - **Affects**: Dashboard, IPO Detail pages
   - **Symptoms**: Client/server HTML mismatch
   - **Status**: ✅ **RESOLVED** - Downgraded React 19.1.0 → 18.3.1 stable
   - **Fix Date**: November 12, 2025 (Session 2)
   - **Note**: React 19 experimental was root cause

⚠️ **Active Issues:**

3. **Homepage Console Errors**
   - **Count**: 22 errors logged
   - **Impact**: Unknown (page appears functional)
   - **Priority**: P1 - Next task (Task 1.3)
   - **Status**: Pending investigation

---

## 2. Component & Page Inventory

### 2.1 Component Analysis

**Total Components**: 239 `.tsx` files

#### **Component Categories:**

1. **Admin** - Dynamic tables, forms, edit interfaces
2. **Affiliate** - CTAs, broker buttons, click tracking
3. **Calendar** - IPO timelines, date pickers
4. **Dashboard** - Filters, search, IPO grids, content cards ⚠️ Known issues
5. **Filters** - Category, sector, status, search
6. **History** - Tables, pagination, search
7. **Home** - Hero sections, IPO tables, featured content
8. **Intelligence** - Data insights, analytics displays
9. **IPO** (50+ components):
   - Cards: Standard, enhanced, skeleton loaders
   - Charts: GMP, subscription, demand, financial performance
   - Metrics: Key metrics, KPI highlights, score displays
   - Sections: Anchor investors, issue structure, subscription views
   - Widgets: Timeline, score badges, tooltips
10. **IPO Detail** (13 components):
    - Category reservation
    - Company contact
    - Financial metrics (enhanced)
    - KPI highlights
    - Objectives
    - Recommendation summary
    - UPI deadline timer
11. **Layout** - Header, footer, navigation, breadcrumbs
12. **Listings** - Mainboard and SME specific
13. **Live** - Real-time updates, WebSocket components
14. **Mainboard/SME** - Segment-specific pages
15. **Market Holidays** - Calendar, list views
16. **Mobile** - Bottom navigation, mobile-specific UI
17. **Performance** - Trackers, metrics displays
18. **Prospectus** - Document viewers
19. **PWA** - Offline support, install prompts
20. **Shared/UI** - Primitives and reusable components:
    - DataTable, EmptyState, ErrorBoundary
    - LoadingSpinner, IPOGridSkeleton
    - Radix UI wrappers: accordion, alert, badge, button, card, checkbox, dialog, input, label, pagination, radio-group, select
    - Chart components: skeleton, error boundary

#### **Test Coverage Gap Analysis:**

| Category | Total Files | Tested | Coverage | Priority |
|----------|------------|--------|----------|----------|
| IPO Components | 50+ | ~15 | 30% | P1 - Critical |
| Charts | 38+ | ~5 | 13% | P0 - Data display |
| Mobile | 8+ | 2 | 25% | P1 - UX critical |
| Admin | 15+ | 0 | 0% | P2 - Internal tool |
| Intelligence | 5+ | 0 | 0% | P2 - New feature |
| Live/Real-time | 6+ | 0 | 0% | P1 - Core feature |
| PWA | 4+ | 0 | 0% | P2 - Enhancement |
| UI Primitives | 30+ | ~10 | 33% | P1 - Foundation |

**Overall Component Coverage: 29% (69 tests / 239 components)**

### 2.2 Page Analysis

**Total Pages**: 49 `page.tsx` files

#### **Pages with E2E Tests** (39/49 = 80%)
✅ Homepage, Dashboard, IPO Detail, History, All Mainboard pages, All SME pages, Tools, Market holidays, Admin pages, Affiliate pages, Registrars, Specialty pages

#### **Pages WITHOUT E2E Tests** (10/49 = 20%)

**Static/Content Pages:**
- `/about` - About page
- `/disclaimer` - Disclaimer
- `/privacy` - Privacy policy
- `/terms` - Terms of service
- `/resources` - Resources page

**Feature Pages:**
- `/fpo-listings` - FPO listings page

**Test Pages:**
- `/test/*` - Various test pages
- `/test-calculator` - Calculator testing
- `/components-test` - Component testing page

**Admin Pages (Missing):**
- `/admin/anchor-investors` - Anchor investors management
- `/admin/conflicts` - Data conflict resolution
- `/admin/metrics` - System metrics dashboard
- `/admin/notifications` - Notification management
- `/admin/settings` - Admin settings
- `/admin/dynamic/ipos/[id]/objectives` - IPO objectives editor

**Page Coverage: 80% (39/49 pages tested)**

---

## 3. Testing Gaps & Priorities

### 3.1 🔴 CRITICAL GAPS (P0 - Production Blockers)

#### **Gap 1: Known Hydration Issues**
- **Severity**: P0 - Production breaking
- **Affected Pages**: Dashboard, IPO Detail
- **Root Cause**: Webpack module loading + React 19 hydration
- **Impact**: Complete page crashes
- **Tests Needed**:
  - Server/client HTML consistency validation
  - Hydration error detection tests
  - React 19 compatibility regression tests
- **Estimated Effort**: 2 days

#### **Gap 2: Visual Regression Testing**
- **Current Coverage**: 0%
- **Impact**: UI changes break layouts without detection
- **Risk**: Silent visual bugs in production
- **Tests Needed**:
  - 50+ baseline screenshots across key pages
  - Visual diff on every PR
  - Responsive layout validation
- **Tools**: Playwright screenshot comparison (free) or Percy/Chromatic (paid)
- **Estimated Effort**: 2 days setup + 50 test cases

#### **Gap 3: Accessibility Testing**
- **Current Coverage**: ~15% (10/63 E2E files mention accessibility)
- **Compliance Target**: WCAG 2.1 Level AA
- **Impact**: Legal compliance, user exclusion
- **Tests Needed**:
  - Automated axe-core scans on all pages
  - Keyboard navigation tests
  - Screen reader compatibility
  - Color contrast validation
  - Focus management
- **Estimated Effort**: 1 day setup + 100+ assertions

#### **Gap 4: Chart Component Testing**
- **Current Coverage**: ~13% (5/38+ chart files)
- **Impact**: Critical data visualization untested
- **Risk**: Incorrect financial data display
- **Charts to Test**:
  - Financial performance charts (revenue, profit, ROE)
  - GMP history charts
  - Subscription dashboard (QIB, NII, Retail breakdown)
  - Demand graph (price-wise demand)
  - Listing performance charts
  - Peer comparison charts
- **Test Scenarios**:
  - Data accuracy (match database values)
  - Empty state handling (no data)
  - Loading states
  - Error states
  - Responsive behavior
  - Interactive tooltips/legends
- **Estimated Effort**: 3 days (38+ components × 6 test scenarios each)

#### **Gap 5: Mobile-Specific Features**
- **Current Coverage**: ~20% (UX Phase 4 tests)
- **Impact**: Mobile UX failures (majority of users)
- **Features to Test**:
  - Bottom navigation (5 tabs, 44px touch targets, active states)
  - Swipe gestures (cards, navigation)
  - Pull-to-refresh
  - PWA features (offline, install, service worker)
  - Mobile viewport responsiveness
  - Touch target sizes
- **Estimated Effort**: 2 days

### 3.2 🟡 HIGH PRIORITY GAPS (P1 - Launch Blockers)

#### **Gap 6: Real-Time Features**
- **Current Coverage**: 0%
- **Features**: Live subscription updates, WebSocket connections
- **Impact**: Real-time data reliability unknown
- **Tests Needed**:
  - WebSocket connection handling
  - Live data refresh validation
  - Subscription counter updates
  - Fallback when WebSocket unavailable
- **Estimated Effort**: 2 days

#### **Gap 7: Database-to-UI Data Validation**
- **Current Coverage**: Partial (no systematic validation)
- **Impact**: Data completeness unknown
- **Example**: Nov 1, 2025 testing found data quality issues
- **Tests Needed**:
  - Field-by-field validation for IPO details (50+ fields)
  - Financial metrics accuracy (revenue, profit, ROE, P/E, etc.)
  - Subscription data completeness (all sub-categories)
  - GMP historical accuracy
  - Document links validity
  - Listing performance data
- **Pattern**:
  ```typescript
  test('IPO Detail displays complete data', async ({ page }) => {
    const dbData = await queryDatabase('SELECT * FROM ipos WHERE slug = ?', slug);
    await page.goto(`/ipos/${slug}`);
    const snapshot = await page.locator('main').textContent();

    // Validate 50+ fields
    expect(snapshot).toContain(dbData.companyName);
    expect(snapshot).toContain(formatCurrency(dbData.priceMin));
    // ... 48 more assertions
  });
  ```
- **Estimated Effort**: 3 days

#### **Gap 8: Error Boundaries & Error States**
- **Current Coverage**: Minimal
- **Impact**: Poor error UX
- **Tests Needed**:
  - Component error boundaries
  - Page-level error handling
  - API failure states
  - Network timeout handling
  - Redis connection failures
  - Database connection failures
- **Estimated Effort**: 2 days

#### **Gap 9: Performance Testing**
- **Current Coverage**: Limited (Phase 5 load testing exists)
- **Current Performance**: LCP 2.8-3.2s (target: <2.5s)
- **Tests Needed**:
  - Lighthouse CI expansion (all pages)
  - Core Web Vitals monitoring:
    - LCP (Largest Contentful Paint): <2.5s
    - FID (First Input Delay): <100ms
    - CLS (Cumulative Layout Shift): <0.1
  - Bundle size checks
  - Image optimization validation
  - Time to Interactive (TTI)
- **Estimated Effort**: 2 days

### 3.3 🟢 MEDIUM PRIORITY GAPS (P2 - Post-Launch)

#### **Gap 10: Cross-Browser Compatibility**
- **Current**: Tests run primarily on Chromium
- **Configured**: 7 browsers (Chromium, Firefox, Edge, WebKit, Mobile Chrome/Safari, iPad)
- **Tests Needed**: Run full suite on all browsers
- **Estimated Effort**: 1 day

#### **Gap 11: Component Library Coverage**
- **Current**: 29% (69/239 components)
- **Target**: 80%+
- **Untested Categories**:
  - Admin components (15+ files)
  - Intelligence components (5+ files)
  - Live components (6+ files)
  - Most chart components (33+ files)
  - PWA components (4+ files)
- **Estimated Effort**: 5 days (170+ components)

#### **Gap 12: SEO Validation**
- **Current**: 1 test file (Phase 2)
- **Tests Needed**:
  - Meta tags on all pages
  - Structured data (JSON-LD)
  - Open Graph tags
  - Sitemap generation
  - Canonical URLs
- **Estimated Effort**: 1 day

---

## 4. Comprehensive Testing Plan (11 Weeks)

### **Phase 1: Critical Bug Fixes & Stabilization (Week 1)**

**Objective**: Fix production-blocking issues and establish stability baseline

**🎯 Testing Approach: Playwright MCP Headed Mode (Primary)**

#### **Tasks:**

**1. Fix Webpack Module Loading Error (2 days) - Using Playwright MCP**

**Step 1: Reproduce Issues Visually**
```javascript
// Use Playwright MCP to navigate and observe crashes
await mcp__playwright__browser_navigate('http://localhost:3000/dashboard');
await mcp__playwright__browser_console_messages({ onlyErrors: true });
await mcp__playwright__browser_take_screenshot({
  filename: 'dashboard-crash-before-fix.png'
});
```

**Step 2: Interactive Debugging**
- Navigate to Dashboard page in headed mode
- Observe webpack error in real browser
- Check browser console for detailed error stack
- Take screenshots of error states
- Document exact reproduction steps

**Step 3: Verify Fixes**
- After implementing fix, re-test with Playwright MCP
- Visual confirmation that pages load correctly
- Screenshot comparison (before/after)
- Console log verification (zero errors)

**2. Resolve React 19 Hydration Issues (2 days) - Using Playwright MCP**

**Step 1: Hydration Mismatch Detection**
```javascript
// Navigate and capture hydration errors
await mcp__playwright__browser_navigate('http://localhost:3000/ipos/example-ipo');
const consoleErrors = await mcp__playwright__browser_console_messages({ onlyErrors: true });

// Take accessibility snapshot (better than screenshot for hydration issues)
const snapshot = await mcp__playwright__browser_snapshot();

// Visual verification in headed mode
await mcp__playwright__browser_take_screenshot({
  filename: 'ipo-detail-hydration-check.png',
  fullPage: true
});
```

**Step 2: Test Across Next.js Versions**
- Test with Next.js 15.5.4 (current)
- Test with Next.js 14.2.15 (fallback)
- Visual comparison in headed mode
- Document differences

**Step 3: Implement Error Boundaries**
- Add hydration error boundaries
- Test with Playwright MCP in headed mode
- Verify graceful fallback UI appears

**3. Homepage Console Error Investigation (1 day) - Using Playwright MCP**

```javascript
// Document all console errors
await mcp__playwright__browser_navigate('http://localhost:3000');
const allLogs = await mcp__playwright__browser_console_messages();

// Verify functionality despite errors
await mcp__playwright__browser_snapshot(); // Check UI renders correctly
await mcp__playwright__browser_click({ element: 'Mainboard IPOs Tab' });
await mcp__playwright__browser_wait_for({ text: 'Mainboard IPO Listings' });

// Screenshot for documentation
await mcp__playwright__browser_take_screenshot({
  filename: 'homepage-with-console-errors.png'
});
```

#### **Deliverables:**
- [ ] Bug fix documentation with before/after screenshots
- [ ] Regression tests (native Playwright for CI/CD)
- [ ] Hydration validation test suite (10+ tests)
- [ ] Visual evidence of all fixes (screenshots)
- [ ] Updated error tracking document

#### **Success Criteria:**
- ✅ Dashboard page loads without crashes (verified visually in headed mode)
- ✅ IPO Detail page loads without crashes (verified visually in headed mode)
- ✅ Zero hydration errors in console (verified with `browser_console_messages`)
- ✅ All existing tests still pass (automated regression suite)
- ✅ Visual screenshots documenting fixes

#### **Playwright MCP vs Native Playwright in Phase 1:**

| Task | Playwright MCP (Headed) | Native Playwright (Automated) |
|------|------------------------|-------------------------------|
| **Bug Reproduction** | ✅ Primary (visual confirmation) | ⚠️ Secondary (CI verification) |
| **Interactive Debugging** | ✅ Primary (Claude-assisted) | ❌ Not applicable |
| **Fix Verification** | ✅ Primary (visual verification) | ⚠️ Secondary (regression tests) |
| **Screenshot Documentation** | ✅ Primary (bug reports) | ❌ Not needed |
| **Console Log Analysis** | ✅ Primary (`browser_console_messages`) | ⚠️ Secondary (automated checks) |
| **CI/CD Regression Tests** | ❌ Not applicable | ✅ Primary (automated suite) |

---

### **Phase 2: Visual Regression & Accessibility Foundation (Week 2)**

**Objective**: Establish automated visual and accessibility testing

**🎯 Testing Approach: Playwright MCP Headed Mode (Primary) for Visual Verification**

#### **2.1 Visual Regression Setup** (2 days) - **Using Playwright MCP**

**Interactive Baseline Creation Workflow:**

**Step 1: Homepage States (Playwright MCP Headed Mode)**
```javascript
// State 1: Default homepage
await mcp__playwright__browser_navigate('http://localhost:3000');
await mcp__playwright__browser_wait_for({ text: 'Latest IPOs' });
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-homepage-default.png',
  fullPage: true
});

// State 2: Mainboard section
await mcp__playwright__browser_click({ element: 'Mainboard Tab' });
await mcp__playwright__browser_wait_for({ text: 'Mainboard IPO Listings' });
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-homepage-mainboard.png',
  fullPage: true
});

// State 3: SME section
await mcp__playwright__browser_click({ element: 'SME Tab' });
await mcp__playwright__browser_wait_for({ text: 'SME IPO Listings' });
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-homepage-sme.png',
  fullPage: true
});
```

**Step 2: Dashboard States (Visual Verification)**
```javascript
// State 1: Empty dashboard
await mcp__playwright__browser_navigate('http://localhost:3000/dashboard?empty=true');
await mcp__playwright__browser_snapshot(); // Better for accessibility + structure
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-dashboard-empty.png'
});

// State 2: Loading state (observe in headed mode)
await mcp__playwright__browser_navigate('http://localhost:3000/dashboard');
// Visual observation of loading skeleton
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-dashboard-loading.png'
});

// State 3: Filtered view
await mcp__playwright__browser_click({ element: 'Filter by Sector' });
await mcp__playwright__browser_select_option({
  element: 'Sector Dropdown',
  values: ['Technology']
});
await mcp__playwright__browser_wait_for({ text: 'Technology IPOs' });
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-dashboard-filtered.png'
});

// State 4: Paginated view
await mcp__playwright__browser_click({ element: 'Next Page' });
await mcp__playwright__browser_wait_for({ text: 'Page 2' });
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-dashboard-page2.png'
});

// State 5: Error state (simulate network error)
// Observe error UI in headed mode
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-dashboard-error.png'
});
```

**Step 3: IPO Detail Page - All Tabs (24 screenshots)**
```javascript
// Navigate to IPO detail
await mcp__playwright__browser_navigate('http://localhost:3000/ipos/example-ipo');

// Tab 1: Info (3 states: loading, loaded, error)
await mcp__playwright__browser_click({ element: 'Info Tab' });
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-ipo-detail-info-loaded.png',
  fullPage: true
});

// Tab 2: Financials
await mcp__playwright__browser_click({ element: 'Financials Tab' });
await mcp__playwright__browser_wait_for({ text: 'Financial Performance' });
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-ipo-detail-financials.png',
  fullPage: true
});

// Tab 3: Subscription
await mcp__playwright__browser_click({ element: 'Subscription Tab' });
await mcp__playwright__browser_wait_for({ text: 'Subscription Status' });
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-ipo-detail-subscription.png',
  fullPage: true
});

// Repeat for remaining 5 tabs...
// (GMP, Documents, Reviews, Timeline, Analysis)
```

**Step 4: Mobile Layouts (Headed Mode with Resize)**
```javascript
// Resize to mobile viewport
await mcp__playwright__browser_resize({ width: 375, height: 667 }); // iPhone SE

// Homepage mobile
await mcp__playwright__browser_navigate('http://localhost:3000');
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-mobile-homepage.png',
  fullPage: true
});

// Dashboard mobile
await mcp__playwright__browser_navigate('http://localhost:3000/dashboard');
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-mobile-dashboard.png',
  fullPage: true
});

// IPO Detail mobile
await mcp__playwright__browser_navigate('http://localhost:3000/ipos/example-ipo');
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-mobile-ipo-detail.png',
  fullPage: true
});
```

**Step 5: Admin Interfaces**
```javascript
// Resize back to desktop
await mcp__playwright__browser_resize({ width: 1920, height: 1080 });

// Admin login
await mcp__playwright__browser_navigate('http://localhost:3000/admin/login');
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-admin-login.png'
});

// Admin dashboard (after login)
await mcp__playwright__browser_fill_form({
  fields: [
    { name: 'Email', type: 'textbox', value: 'admin@ipodhan.com' },
    { name: 'Password', type: 'textbox', value: 'password' }
  ]
});
await mcp__playwright__browser_click({ element: 'Login Button' });
await mcp__playwright__browser_wait_for({ text: 'Admin Dashboard' });
await mcp__playwright__browser_take_screenshot({
  filename: 'baseline-admin-dashboard.png',
  fullPage: true
});
```

**Total Baselines**: 50+ screenshots captured interactively with visual verification

**Advantages of Playwright MCP Headed Mode:**
- ✅ **Real-time Observation**: See exactly what you're capturing
- ✅ **Interactive Adjustments**: Tweak states before capturing
- ✅ **Visual Confirmation**: Ensure baseline is correct before committing
- ✅ **Claude Assistance**: AI-guided exploration of UI states
- ✅ **Debugging**: Immediately see if something doesn't load correctly

**Deliverables:**
- [ ] 50+ baseline screenshots captured via Playwright MCP
- [ ] Visual regression test suite (native Playwright for CI/CD)
- [ ] Screenshot comparison workflow documented
- [ ] Baseline update process (re-run MCP commands)

#### **2.2 Accessibility Testing Setup** (2-3 days)

**Tasks:**
1. Install axe-core Playwright plugin
2. Add accessibility checks to all 63 existing E2E tests
3. Create dedicated accessibility test suite:
   - Automated WCAG 2.1 Level AA scans
   - Keyboard navigation tests (Tab, Enter, Escape, Arrow keys)
   - Focus management validation
   - Screen reader compatibility (ARIA labels)
   - Color contrast checks
   - Form label associations
4. Generate accessibility compliance report
5. Document WCAG violations by priority

**Deliverables:**
- [ ] Accessibility test suite (100+ assertions)
- [ ] WCAG 2.1 AA compliance report
- [ ] Violation prioritization list
- [ ] Accessibility testing guide

#### **Success Criteria:**
- All pages scanned for accessibility
- Keyboard navigation works on all pages
- WCAG violations documented and prioritized
- Visual regression catches layout changes

---

### **Phase 3: Component Testing Sprint - Part 1 (Week 3)**

**Objective**: Test critical data display components

#### **3.1 Chart Component Testing** (3 days)

**Priority 1 - Financial Charts:**
- [ ] Financial performance chart (revenue, profit, ROE trends)
- [ ] Multi-period financial comparison
- [ ] Peer comparison charts
- [ ] Listing performance chart
- [ ] Return on investment chart

**Priority 2 - IPO Charts:**
- [ ] GMP history chart (time-series)
- [ ] Subscription dashboard (category breakdown)
- [ ] Demand graph (price-wise demand)
- [ ] Application tracking chart
- [ ] QIB/NII/Retail subscription charts

**Test Pattern (6 scenarios per chart):**
```typescript
describe('ChartComponent', () => {
  it('should render with valid data', () => {});
  it('should handle empty data gracefully', () => {});
  it('should display loading state', () => {});
  it('should display error state', () => {});
  it('should be responsive (mobile/tablet/desktop)', () => {});
  it('should match visual snapshot', () => {});
});
```

**Estimated Tests**: 38 charts × 6 scenarios = 228 tests

#### **3.2 IPO Metrics Components** (2 days)

**Components to Test:**
- [ ] KeyMetricsCards / KeyMetricsCardsEnhanced
- [ ] KPIHighlightSection
- [ ] AdvancedGMPMetrics
- [ ] EnhancedSubscriptionView
- [ ] IPOScoreDisplay
- [ ] RecommendationSummary

**Deliverables:**
- [ ] 228+ chart component tests
- [ ] 36+ metrics component tests
- [ ] Visual snapshots for all components
- [ ] Test coverage report (target: 80%+)

---

### **Phase 4: Component Testing Sprint - Part 2 (Week 4)**

**Objective**: Test interactive and mobile components

#### **4.1 Mobile Components** (2 days)

**Components:**
- [ ] BottomNavigation (5 tabs, active states)
- [ ] MobileSwipeableCard
- [ ] MobileDashboardGrid
- [ ] MobileFilters
- [ ] MobileSearchBar

**Test Scenarios:**
- Touch target sizes (minimum 44px)
- Swipe gestures
- Pull-to-refresh
- Active state highlighting
- Responsive behavior

#### **4.2 Live/Real-time Components** (1 day)

**Components:**
- [ ] LiveSubscriptionCounter
- [ ] RealTimeUpdateIndicator
- [ ] WebSocketStatus
- [ ] LiveIPOCard
- [ ] SubscriptionTicker

**Test Scenarios:**
- WebSocket connection handling
- Data update rendering
- Fallback to polling
- Connection error states

#### **4.3 PWA Components** (1 day)

**Components:**
- [ ] OfflineIndicator
- [ ] InstallPrompt
- [ ] ServiceWorkerStatus
- [ ] CacheFallback

#### **4.4 Data Table Components** (1 day)

**Components:**
- [ ] DataTable (shared)
- [ ] HistoricalIPOTable
- [ ] MainboardListingsTable
- [ ] SMEListingsTable
- [ ] PaginationControls

**Deliverables:**
- [ ] 50+ mobile component tests
- [ ] 30+ live component tests
- [ ] 20+ PWA component tests
- [ ] 25+ data table tests

---

### **Phase 5: Data Validation & Integration Testing (Week 5)**

**Objective**: Ensure database-to-UI data accuracy

#### **5.1 IPO Detail Data Validation** (2 days)

**Create DB query helpers for E2E tests:**
```typescript
// Helper: Query DB and validate UI
async function validateIPODetailData(slug: string) {
  const dbData = await db.query.ipos.findFirst({
    where: eq(ipos.slug, slug),
    with: {
      financialData: true,
      subscriptions: true,
      gmpRecords: true,
      listingPerformance: true
    }
  });

  await page.goto(`/ipos/${slug}`);

  // Validate 50+ fields
  await validateField('Company Name', dbData.companyName);
  await validateField('Price Range', `${dbData.priceMin}-${dbData.priceMax}`);
  // ... 48 more validations
}
```

**Data to Validate:**
- [ ] IPO basic info (30 fields)
- [ ] Financial data (20 fields)
- [ ] Subscription data (15 fields)
- [ ] GMP history (10 fields)
- [ ] Listing performance (10 fields)
- [ ] Documents (links, titles, types)

#### **5.2 API Contract Testing** (2 days)

**Endpoints to Test:**
- [ ] GET /api/ipos (list with filters)
- [ ] GET /api/ipos/[slug] (detail)
- [ ] GET /api/ipos/[slug]/subscription
- [ ] GET /api/ipos/[slug]/gmp
- [ ] GET /api/ipos/[slug]/financials
- [ ] GET /api/ipos/[slug]/documents
- [ ] GET /api/ipos/[slug]/score

**Test Scenarios:**
- Response format validation (Zod schemas)
- Error responses (404, 500)
- Pagination logic
- Filter combinations
- Cache headers

#### **5.3 Search & Fuzzy Matching** (1 day)

**Tests:**
- [ ] Exact slug match
- [ ] Fuzzy name matching (60% threshold)
- [ ] Search suggestions
- [ ] No results fallback

**Deliverables:**
- [ ] 50+ data validation tests
- [ ] 30+ API contract tests
- [ ] 10+ search/fuzzy matching tests
- [ ] Data accuracy report

---

### **Phase 6: Performance & Load Testing (Week 6)**

**Objective**: Optimize performance and validate under load

#### **6.1 Core Web Vitals Testing** (2 days)

**Expand Lighthouse CI:**
```javascript
// lighthouse.config.js
module.exports = {
  ci: {
    collect: {
      url: [
        'http://localhost:3000/',
        'http://localhost:3000/dashboard',
        'http://localhost:3000/ipos/example-ipo',
        // ... all 49 pages
      ],
      numberOfRuns: 3,
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.85 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'first-input-delay': ['error', { maxNumericValue: 100 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
      },
    },
  },
};
```

**Pages to Test:**
- All 49 pages
- 3 runs per page
- Desktop + Mobile

**Metrics:**
- LCP target: <2.5s (current: 2.8-3.2s)
- FID target: <100ms
- CLS target: <0.1 (current: 0.03-0.08 ✅)
- TTI target: <3.5s
- Performance score: >85

#### **6.2 Load Testing** (2 days)

**Use existing k6 scripts** (`web/tests/load/`):
```bash
# API load test
k6 run web/tests/load/api-load-test.js

# Stress test
k6 run web/tests/load/stress-test.js
```

**Test Scenarios:**
- 100 concurrent users (baseline)
- 500 concurrent users (expected peak)
- 1000 concurrent users (stress test)
- 1500+ concurrent users (breaking point)

**Validate:**
- Database connection pool (50 connections)
- Redis cache performance
- API response times (p95 <500ms, p99 <1000ms)

#### **6.3 Bundle Size & Optimization** (1 day)

**Tools:**
```bash
npm run build
npx @next/bundle-analyzer
```

**Checks:**
- Main bundle size <200KB (gzipped)
- Route-based code splitting
- Image optimization (WebP, lazy loading)
- Font optimization

**Deliverables:**
- [ ] Lighthouse reports for all 49 pages
- [ ] Load testing results
- [ ] Bundle analysis report
- [ ] Performance optimization recommendations

---

### **Phase 7: Cross-Browser & Mobile Testing (Week 7)**

**Objective**: Validate on all platforms

#### **7.1 Cross-Browser Testing** (3 days)

**Run full E2E suite on all 7 browsers:**
```bash
# Chromium (baseline)
npx playwright test --project=chromium

# Firefox
npx playwright test --project=firefox

# WebKit (Safari)
npx playwright test --project=webkit

# Edge
npx playwright test --project=edge

# Mobile Chrome
npx playwright test --project=mobile-chrome

# Mobile Safari
npx playwright test --project=mobile-safari

# iPad
npx playwright test --project=ipad
```

**Expected Results:**
- Document browser-specific failures
- Create compatibility matrix
- Prioritize critical browser issues

#### **7.2 Mobile-Specific Feature Testing** (2 days)

**Test Touch Interactions:**
- [ ] Swipe gestures (left/right navigation)
- [ ] Pinch-to-zoom (disabled for app-like feel?)
- [ ] Long-press menus
- [ ] Pull-to-refresh
- [ ] Touch target sizes (minimum 44px)

**Test Mobile Viewports:**
- [ ] 320px width (iPhone SE)
- [ ] 375px width (iPhone 12)
- [ ] 414px width (iPhone 12 Pro Max)
- [ ] 768px width (iPad)

**Test PWA Features:**
- [ ] Service worker registration
- [ ] Offline functionality
- [ ] Install prompt behavior
- [ ] App manifest validation
- [ ] Add to Home Screen

**Deliverables:**
- [ ] Cross-browser compatibility matrix
- [ ] Mobile testing report
- [ ] Browser-specific bug list
- [ ] PWA functionality validation

---

### **Phase 8: Missing Page Coverage & User Journeys (Week 8)**

**Objective**: Achieve 95%+ page coverage

#### **8.1 Static/Content Pages** (1 day)

**Create E2E tests for:**
- [ ] /about - About page
- [ ] /disclaimer - Disclaimer
- [ ] /privacy - Privacy policy
- [ ] /terms - Terms of service
- [ ] /resources - Resources page

**Test Scenarios:**
- Page loads successfully
- Content renders correctly
- Links work
- SEO meta tags present

#### **8.2 Missing Admin Pages** (2 days)

**Create E2E tests for:**
- [ ] /admin/anchor-investors - Anchor investors management
- [ ] /admin/conflicts - Data conflict resolution
- [ ] /admin/metrics - System metrics dashboard
- [ ] /admin/notifications - Notification management
- [ ] /admin/settings - Admin settings
- [ ] /admin/dynamic/ipos/[id]/objectives - IPO objectives editor

**Test Scenarios:**
- Authentication required
- CRUD operations
- Data validation
- Admin audit trail

#### **8.3 New User Journeys** (2 days)

**Journey 5: Mobile-First User**
```typescript
test('Mobile user browses and applies to IPO', async ({ page }) => {
  // 1. Navigate with bottom nav
  // 2. Swipe through IPO cards
  // 3. View IPO details
  // 4. Use lot calculator
  // 5. Check subscription status
});
```

**Journey 6: IPO Comparison Flow**
```typescript
test('Investor compares 3 IPOs side-by-side', async ({ page }) => {
  // 1. Browse IPO list
  // 2. Select 2-3 IPOs for comparison
  // 3. View comparison table
  // 4. Analyze differences
  // 5. Export/share comparison
});
```

**Journey 7: Live Subscription Tracking**
```typescript
test('Investor monitors live subscription updates', async ({ page }) => {
  // 1. Navigate to open IPO
  // 2. View real-time subscription counter
  // 3. Check QIB/NII breakdown
  // 4. Monitor demand graph updates
});
```

**Journey 8: Performance Analysis**
```typescript
test('Investor analyzes historical performance', async ({ page }) => {
  // 1. Navigate to history page
  // 2. Filter by year/sector
  // 3. View listing gains
  // 4. Compare to peers
  // 5. Analyze trends
});
```

**Journey 9: Admin Content Management**
```typescript
test('Admin edits IPO data with field protection', async ({ page }) => {
  // 1. Login to admin
  // 2. Navigate to IPO edit
  // 3. Protect critical fields
  // 4. Update data
  // 5. Verify audit log
});
```

**Journey 10: Search & Discovery**
```typescript
test('User discovers IPO using search', async ({ page }) => {
  // 1. Use global search
  // 2. Fuzzy match "XYZ Corp" → "XYZ Corporation Ltd"
  // 3. View suggestions
  // 4. Navigate to IPO detail
});
```

**Deliverables:**
- [ ] 10+ new E2E test files (static pages)
- [ ] 6+ new E2E test files (admin pages)
- [ ] 6 new user journey tests (5 scenarios each = 30 tests)
- [ ] Page coverage: 95%+ (47/49 pages)

---

### **Phase 9: Error Handling & Edge Cases (Week 9)**

**Objective**: Ensure graceful degradation and error handling

#### **9.1 Error Boundary Testing** (2 days)

**Component-Level Error Boundaries:**
```typescript
test('Component error boundary catches render errors', async () => {
  // 1. Force component error (invalid prop)
  // 2. Verify error boundary displays fallback UI
  // 3. Verify error logged to Sentry
  // 4. Verify rest of page still functional
});
```

**Test Scenarios:**
- [ ] Chart rendering errors
- [ ] Data fetching errors
- [ ] Image loading errors
- [ ] Third-party script failures

**Page-Level Error Boundaries:**
- [ ] 404 Not Found page
- [ ] 500 Internal Server Error page
- [ ] Network timeout page
- [ ] Maintenance mode page

#### **9.2 API Failure States** (2 days)

**Test Scenarios:**
```typescript
test('API timeout shows retry option', async ({ page }) => {
  // Mock slow API response
  await page.route('**/api/ipos/*', route =>
    route.abort('timedout')
  );

  await page.goto('/ipos/example-ipo');

  // Verify error message displayed
  await expect(page.locator('[data-testid="error-message"]'))
    .toContainText('Unable to load data');

  // Verify retry button present
  await expect(page.locator('[data-testid="retry-button"]'))
    .toBeVisible();
});
```

**Failure Types:**
- [ ] Network timeouts
- [ ] 500 Internal Server Error
- [ ] 404 Not Found
- [ ] 401 Unauthorized
- [ ] Rate limiting (429)

#### **9.3 Edge Case Testing** (1 day)

**Data Edge Cases:**
- [ ] Empty states (no IPOs, no data)
- [ ] Very long company names (200+ chars)
- [ ] Special characters in names (®, ™, &, etc.)
- [ ] Currency edge cases (₹0, ₹999,999,999,999)
- [ ] Date edge cases (leap years, timezones, DST)
- [ ] Percentage edge cases (0%, 100%, 1000%+)

**UI Edge Cases:**
- [ ] Very large datasets (100+ items)
- [ ] Pagination at limits (page 1, last page)
- [ ] Filters with zero results
- [ ] Search with no matches

#### **9.4 Redis/Database Failure Handling** (1 day)

**Test Scenarios:**
```typescript
test('App continues when Redis unavailable', async ({ page }) => {
  // 1. Simulate Redis connection failure
  // 2. Navigate to dashboard
  // 3. Verify data loads from database
  // 4. Verify console shows fallback message
  // 5. Verify no user-facing errors
});
```

**Deliverables:**
- [ ] 20+ error boundary tests
- [ ] 25+ API failure state tests
- [ ] 15+ edge case tests
- [ ] 5+ infrastructure failure tests
- [ ] Error handling documentation

---

### **Phase 10: CI/CD Integration & Automation (Week 10)**

**Objective**: Fully automate test execution in pipeline

#### **10.1 GitHub Actions Workflow** (2 days)

**Create comprehensive test workflow:**

```yaml
# .github/workflows/tests.yml
name: Comprehensive Testing

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run test:unit
      - uses: codecov/codecov-action@v3

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
      redis:
        image: redis:7
    steps:
      - run: npm run test:integration

  e2e-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        browser: [chromium, firefox, webkit]
    steps:
      - run: npx playwright test --project=${{ matrix.browser }}

  visual-regression:
    runs-on: ubuntu-latest
    steps:
      - run: npx playwright test --grep @visual
      - uses: percy/exec-action@v0.3.1

  accessibility:
    runs-on: ubuntu-latest
    steps:
      - run: npx playwright test --grep @a11y

  performance:
    runs-on: ubuntu-latest
    steps:
      - run: npm run build
      - run: npm run lighthouse:ci
```

**Test Triggers:**
- **On every commit**: Unit tests
- **On PR**: Unit + Integration + E2E (Chromium) + Accessibility
- **On main merge**: Full suite (all browsers) + Visual regression + Performance
- **Nightly**: Load testing + Cross-browser full suite

#### **10.2 Test Reporting** (2 days)

**Configure test reporters:**

```typescript
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['html', { outputFolder: 'test-results/html' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['github'], // GitHub Actions annotations
  ],
});
```

**Integrate with:**
- [ ] Codecov (coverage reporting)
- [ ] Percy/Chromatic (visual diffs)
- [ ] Slack notifications (test failures)
- [ ] Email notifications (critical failures)

#### **10.3 Test Quality Gates** (1 day)

**Enforce quality standards:**
```yaml
# Block PR merge if:
- Unit test coverage < 80%
- Integration test coverage < 70%
- E2E tests fail
- Accessibility score < 95%
- Performance score < 85%
- Visual regressions detected (without approval)
```

**Deliverables:**
- [ ] GitHub Actions workflows configured
- [ ] Test reporting integrated
- [ ] Quality gates enforced
- [ ] Notification system configured
- [ ] CI/CD documentation

---

### **Phase 11: Documentation & Maintenance (Week 11)**

**Objective**: Document testing practices and establish maintenance

#### **11.1 Testing Documentation** (2 days)

**Create/Update Documentation:**
- [ ] **UI Testing Handbook** (this document)
  - Testing philosophy
  - Test pyramid strategy
  - Test patterns and conventions
  - Best practices

- [ ] **Test Writing Guide**
  - How to write component tests
  - How to write E2E tests
  - How to write accessibility tests
  - How to update visual baselines

- [ ] **Test Data Management**
  - Test fixtures and factories
  - Database seeding for tests
  - Mock data generators

- [ ] **CI/CD Testing Guide**
  - Pipeline overview
  - How to debug failed tests
  - How to update workflows

#### **11.2 Test Patterns Documentation** (1 day)

**Document common patterns:**

```typescript
// Pattern 1: Component with data fetching
describe('DataFetchingComponent', () => {
  it('should display loading state', () => {});
  it('should display data when loaded', () => {});
  it('should display error state on failure', () => {});
  it('should retry on user action', () => {});
});

// Pattern 2: Form component
describe('FormComponent', () => {
  it('should validate required fields', () => {});
  it('should show inline errors', () => {});
  it('should submit valid data', () => {});
  it('should disable submit during submission', () => {});
});

// Pattern 3: Chart component
describe('ChartComponent', () => {
  it('should render with valid data', () => {});
  it('should handle empty data', () => {});
  it('should be responsive', () => {});
  it('should match visual snapshot', () => {});
});
```

#### **11.3 Maintenance Procedures** (1 day)

**Weekly Tasks:**
- [ ] Review test pass rate (target: >98%)
- [ ] Identify and fix flaky tests (target: <2% flaky rate)
- [ ] Update test data as production schema changes
- [ ] Review test execution time (target: <30 min full suite)

**Monthly Tasks:**
- [ ] Review test coverage trends
- [ ] Update visual regression baselines
- [ ] Audit accessibility compliance
- [ ] Review and refactor slow tests

**Quarterly Tasks:**
- [ ] Update testing dependencies
- [ ] Review and update testing strategy
- [ ] Conduct testing retrospective
- [ ] Update testing documentation

#### **11.4 Known Issues & Workarounds** (1 day)

**Document:**
- [ ] Flaky tests and mitigation strategies
- [ ] Browser-specific quirks
- [ ] Test data dependencies
- [ ] Environment-specific issues
- [ ] React 19 hydration workarounds

**Deliverables:**
- [ ] UI Testing Handbook (comprehensive guide)
- [ ] Test Writing Guide (patterns and examples)
- [ ] Test Data Management Guide
- [ ] CI/CD Testing Guide
- [ ] Maintenance procedures documented
- [ ] Known issues registry

---

## 5. Test Metrics & Success Criteria

### 5.1 Coverage Targets

| Test Type | Current | Target | Priority | Timeline |
|-----------|---------|--------|----------|----------|
| **Component Coverage** | 29% | 80%+ | P1 | Weeks 3-4 |
| **Repository Coverage** | ~90% | 90% | ✅ Met | - |
| **E2E Page Coverage** | 80% | 95%+ | P1 | Week 8 |
| **Visual Regression** | 0% | 100% key pages | P0 | Week 2 |
| **Accessibility** | ~15% | 100% | P0 | Week 2 |
| **Mobile Testing** | ~20% | 80%+ | P1 | Weeks 4, 7 |
| **Cross-Browser** | Chromium only | All 7 browsers | P2 | Week 7 |
| **API Contract Tests** | Partial | 100% endpoints | P1 | Week 5 |
| **Error Handling** | Minimal | 80%+ | P1 | Week 9 |
| **Performance Tests** | Limited | All 49 pages | P1 | Week 6 |

### 5.2 Quality Metrics

| Metric | Target | How to Measure | Current Status |
|--------|--------|----------------|----------------|
| **Test Pass Rate** | >98% | CI/CD pipeline | Unknown |
| **Flaky Test Rate** | <2% | Track re-run failures | Unknown |
| **Test Execution Time** | <30 min (full suite) | Playwright reporter | Unknown |
| **Bug Detection Rate** | >90% before production | Bug tracking | Unknown |
| **WCAG Compliance** | Level AA (100%) | axe-core scans | Untested |
| **Performance (LCP)** | <2.5s | Lighthouse CI | 2.8-3.2s ⚠️ |
| **Performance (FID)** | <100ms | Lighthouse CI | ✅ Met |
| **Performance (CLS)** | <0.1 | Lighthouse CI | 0.03-0.08 ✅ |
| **Code Coverage** | 80%+ overall | Vitest coverage | Unknown |
| **Visual Regression** | 0 unreviewed diffs | Percy/Playwright | N/A (not setup) |

### 5.3 Success Criteria by Phase

#### **Phase 1 Success (Week 1):**
- ✅ Dashboard page loads without crashes
- ✅ IPO Detail page loads without crashes
- ✅ Zero hydration errors in console
- ✅ All existing tests pass

#### **Phase 2 Success (Week 2):**
- ✅ 50+ visual regression baselines created
- ✅ All pages scanned for accessibility
- ✅ WCAG violations documented

#### **Phases 3-4 Success (Weeks 3-4):**
- ✅ Component coverage increased to 80%+
- ✅ All chart components tested
- ✅ Mobile components tested

#### **Phase 5 Success (Week 5):**
- ✅ Database-to-UI validation tests created
- ✅ All API endpoints have contract tests

#### **Phase 6 Success (Week 6):**
- ✅ LCP improved to <2.5s
- ✅ Load testing completed (1000 users)

#### **Phase 7 Success (Week 7):**
- ✅ Tests pass on all 7 browsers
- ✅ Browser compatibility matrix created

#### **Phase 8 Success (Week 8):**
- ✅ Page coverage reaches 95%+
- ✅ 6 new user journeys tested

#### **Phase 9 Success (Week 9):**
- ✅ Error handling tests created
- ✅ Edge cases documented and tested

#### **Phase 10 Success (Week 10):**
- ✅ CI/CD pipeline fully automated
- ✅ Quality gates enforced

#### **Phase 11 Success (Week 11):**
- ✅ All documentation complete
- ✅ Maintenance procedures established

### 5.4 Long-Term Success (6 months)

**Operational Metrics:**
- Test pass rate maintained >98%
- Flaky test rate maintained <2%
- >90% of bugs caught before production
- WCAG Level AA compliance maintained
- Performance budgets enforced
- Zero production-blocking bugs released

**Team Metrics:**
- Average time to write test: <30 min per component
- Average time to debug test failure: <15 min
- Test execution time: <30 min (full suite)
- Developer confidence in test suite: >90%

---

## 6. Tooling & Infrastructure

### 6.1 Current Tools (Keep)

✅ **Playwright 1.55.1**
- Cross-browser E2E testing
- 7 browser configurations
- Screenshot comparison support
- Trace viewer for debugging

✅ **Vitest 3.2.4**
- Fast unit/integration testing
- Hot module reload
- Coverage reporting with v8

✅ **React Testing Library 16.3.0**
- Component testing
- React 19 compatible
- Accessibility-focused queries

✅ **@vitest/coverage-v8**
- Code coverage reporting
- Istanbul-compatible

### 6.2 Tools to Add

#### **Visual Regression**

**Option 1: Playwright Native Screenshots (Recommended for Phase 2)**
- **Pros**: Free, built-in, full control
- **Cons**: Manual baseline management, slower feedback
- **Cost**: $0

**Option 2: Percy (Consider for Phase 10)**
- **Pros**: SaaS, automatic baselines, visual review UI
- **Cons**: Paid service
- **Cost**: $249/month (startup plan)

**Option 3: Chromatic**
- **Pros**: Storybook integration, great for component libraries
- **Cons**: Requires Storybook setup
- **Cost**: $149/month (startup plan)

**Recommendation**: Start with Playwright screenshots (free), evaluate Percy/Chromatic if budget allows in Phase 10.

#### **Accessibility**

✅ **axe-core** (Add in Phase 2)
- Industry standard
- Playwright plugin available
- WCAG 2.1 Level AA testing
- **Cost**: Free (open source)

✅ **@axe-core/playwright**
- Official Playwright integration
- Automated scans
- **Cost**: Free

✅ **Pa11y** (Optional)
- CLI tool for CI/CD
- HTML reports
- **Cost**: Free

#### **Performance**

✅ **@lhci/cli** (Already installed, expand usage)
- Lighthouse CI integration
- GitHub Action available
- Performance budgets
- **Cost**: Free

✅ **web-vitals** (Add to production)
- Real User Monitoring (RUM)
- Core Web Vitals tracking
- **Cost**: Free (library)

✅ **@next/bundle-analyzer** (Already installed)
- Webpack bundle analysis
- Tree-shaking validation
- **Cost**: Free

#### **Data Validation**

**Custom DB Query Helpers** (Create in Phase 5)
- Drizzle ORM integration
- Test data factories
- **Cost**: Free (custom code)

✅ **Zod** (Already using)
- Schema validation
- API contract testing
- **Cost**: Free

#### **Load Testing**

✅ **k6** (Already setup in Phase 5)
- Open-source load testing
- JavaScript-based tests
- Cloud option available
- **Cost**: Free (open source) or $49+/month (cloud)

#### **Test Reporting**

✅ **Playwright HTML Reporter** (Built-in)
- Visual test reports
- Trace viewer
- **Cost**: Free

✅ **Codecov** (Recommended)
- Coverage tracking over time
- PR comments
- **Cost**: Free for open source

**Slack/Email Notifications** (Add in Phase 10)
- CI/CD integration
- Critical failure alerts
- **Cost**: Free (using existing Slack workspace)

### 6.3 Infrastructure Requirements

#### **CI/CD (GitHub Actions)**
- **Minutes Required**: ~500 minutes/day (estimated)
- **Current Plan**: Free tier (2000 minutes/month)
- **Recommendation**: Upgrade to Team plan ($4/user/month) for 3000 minutes/month
- **Cost**: ~$16/month for 4 users

#### **Test Databases**
- **PostgreSQL**: Spin up in CI using Docker
- **Redis**: Spin up in CI using Docker
- **Cost**: $0 (CI containers)

#### **Browser Testing**
- **Playwright Browsers**: Auto-installed in CI
- **Cost**: $0

### 6.4 Total Budget Estimate

| Item | Cost | Required |
|------|------|----------|
| GitHub Actions (Team plan) | $16/month | ✅ Yes |
| Percy/Chromatic | $149-249/month | ⚠️ Optional |
| k6 Cloud | $49/month | ⚠️ Optional |
| Codecov | Free | ✅ Yes |
| All other tools | Free | ✅ Yes |
| **Total (Minimum)** | **$16/month** | - |
| **Total (Recommended)** | **$214/month** | - |

---

## 7. Risk Assessment

### 7.1 High-Risk Areas

| Risk | Impact | Likelihood | Mitigation Strategy | Priority |
|------|--------|------------|---------------------|----------|
| **Hydration failures** | Production outage | High | Fix in Phase 1, add regression tests | P0 |
| **Data inaccuracy** | User distrust | Medium | Database validation tests (Phase 5) | P1 |
| **Performance degradation** | Poor UX, high bounce rate | Medium | Performance monitoring (Phase 6) | P1 |
| **Accessibility violations** | Legal compliance, user exclusion | Medium | Automated a11y tests (Phase 2) | P0 |
| **Mobile UX failures** | High bounce rate (mobile = 60%+ traffic) | Medium | Mobile testing (Phases 4, 7) | P1 |
| **Browser incompatibility** | Reduced reach | Low | Cross-browser testing (Phase 7) | P2 |
| **Test maintenance burden** | Flaky tests, low confidence | Medium | Documentation + procedures (Phase 11) | P1 |
| **CI/CD pipeline failures** | Blocked deployments | Low | Quality gates + monitoring (Phase 10) | P2 |

### 7.2 Risk Mitigation Timeline

**Week 1 (P0 Risks):**
- ✅ Hydration failures fixed
- ✅ Production stability restored

**Week 2 (P0 Risks):**
- ✅ Accessibility violations identified
- ✅ Visual regression system established

**Weeks 3-6 (P1 Risks):**
- ✅ Data accuracy validated
- ✅ Performance optimized
- ✅ Mobile UX tested

**Weeks 7-11 (P2 Risks):**
- ✅ Cross-browser compatibility ensured
- ✅ Test maintenance procedures established

---

## 8. Team & Resources

### 8.1 Team Requirements

**Core Team (11 weeks):**
- **1 Senior QA Engineer** (Full-time)
  - Lead testing strategy
  - Write complex E2E tests
  - Manage CI/CD pipeline
  - Mentor junior team members

- **1 Frontend Developer** (50% allocation)
  - Write component tests
  - Fix accessibility issues
  - Optimize performance
  - Review test pull requests

- **1 DevOps Engineer** (25% allocation)
  - Configure CI/CD pipelines
  - Setup test infrastructure
  - Monitor test performance
  - Optimize test execution time

**Optional Support:**
- **1 Junior QA Engineer** (Part-time, Weeks 3-8)
  - Write unit tests
  - Execute manual tests
  - Document test cases

### 8.2 Time Allocation by Phase

| Phase | QA Engineer | Frontend Dev | DevOps | Total Hours |
|-------|-------------|--------------|--------|-------------|
| Phase 1 | 40h | 8h | 4h | 52h |
| Phase 2 | 40h | 16h | 8h | 64h |
| Phase 3 | 40h | 20h | 0h | 60h |
| Phase 4 | 40h | 20h | 0h | 60h |
| Phase 5 | 40h | 16h | 4h | 60h |
| Phase 6 | 40h | 8h | 8h | 56h |
| Phase 7 | 40h | 12h | 4h | 56h |
| Phase 8 | 40h | 8h | 0h | 48h |
| Phase 9 | 40h | 12h | 0h | 52h |
| Phase 10 | 32h | 4h | 12h | 48h |
| Phase 11 | 40h | 4h | 0h | 44h |
| **Total** | **432h** | **128h** | **40h** | **600h** |

### 8.3 Training Needs

**Week 0 (Pre-project):**
- [ ] Playwright training (2 days)
- [ ] React Testing Library training (1 day)
- [ ] Accessibility testing training (1 day)
- [ ] Performance testing training (1 day)

**Ongoing:**
- Weekly team sync (30 min)
- Bi-weekly testing retrospective (1h)
- Monthly testing workshop (2h)

---

## 9. Immediate Action Items (Next 2 Weeks)

### Week 1: Critical Stabilization

#### **Day 1-2: Fix Hydration Issues**
- [ ] Debug webpack module loading error
- [ ] Investigate Dashboard page crash
- [ ] Investigate IPO Detail page crash
- [ ] Test with Next.js 15.5.4 and 14.2.15
- [ ] Implement fix and create regression tests

**Owner**: Frontend Developer + Senior QA
**Deliverable**: Working Dashboard and IPO Detail pages

#### **Day 3: Hydration Validation Tests**
- [ ] Create hydration validation test suite
- [ ] Add server/client HTML consistency checks
- [ ] Document hydration best practices

**Owner**: Senior QA
**Deliverable**: 10+ hydration validation tests

#### **Day 4: Homepage Console Errors**
- [ ] Document all 22 console errors
- [ ] Assess impact on functionality
- [ ] Prioritize fixes
- [ ] Create tracking issues

**Owner**: Frontend Developer
**Deliverable**: Error analysis document

#### **Day 5: Regression Testing**
- [ ] Run full test suite
- [ ] Verify all fixes
- [ ] Update documentation

**Owner**: Senior QA
**Deliverable**: Week 1 report

---

### Week 2: Visual & Accessibility Foundation

#### **Day 6-7: Visual Regression Setup**
- [ ] Install Playwright screenshot comparison
- [ ] Create directory structure for baselines
- [ ] Create 25 critical page baselines:
  - Homepage (3 variants)
  - Dashboard (5 states)
  - IPO Detail (8 tabs)
  - Tools (2 pages)
  - Mobile (5 pages)
  - Admin (2 pages)
- [ ] Document baseline update workflow

**Owner**: Senior QA
**Deliverable**: 25 visual regression baselines

#### **Day 8: Visual Regression CI Integration**
- [ ] Add visual tests to GitHub Actions
- [ ] Configure failure thresholds
- [ ] Test workflow

**Owner**: DevOps Engineer
**Deliverable**: Visual regression CI workflow

#### **Day 9-10: Accessibility Setup**
- [ ] Install axe-core Playwright plugin
- [ ] Add accessibility checks to 20 existing E2E tests (sample)
- [ ] Run automated scans on all 49 pages
- [ ] Generate WCAG violations report
- [ ] Prioritize fixes

**Owner**: Senior QA + Frontend Developer
**Deliverable**: Accessibility audit report

---

## 10. Progress Tracking

### 10.1 Weekly Reporting

**Template:**
```markdown
## Week X Testing Progress Report

**Date**: YYYY-MM-DD
**Phase**: Phase X - [Name]

### Completed This Week
- [ ] Task 1 (estimated: Xh, actual: Xh)
- [ ] Task 2

### In Progress
- [ ] Task 3 (50% complete)

### Blocked/Issues
- Issue 1: [Description, owner, mitigation]

### Metrics
- Tests added: X
- Tests passing: X/X (XX%)
- Coverage increase: +X%
- Bugs found: X (P0: X, P1: X, P2: X)

### Next Week Plan
- [ ] Task 4
- [ ] Task 5

### Risks/Concerns
- [Any emerging risks]
```

### 10.2 Dashboard Metrics

**Track Weekly:**
- Total tests: X
- Tests passing: X (XX%)
- Tests failing: X (XX%)
- Flaky tests: X (XX%)
- Coverage: XX%
- Test execution time: XX min
- Bugs found: X (by priority)

---

## 11. Appendix

### 11.1 Test File Organization

```
web/
├── tests/
│   ├── unit/
│   │   ├── components/
│   │   │   ├── admin/
│   │   │   ├── affiliate/
│   │   │   ├── dashboard/
│   │   │   ├── ipo/
│   │   │   ├── mobile/
│   │   │   └── shared/
│   │   ├── lib/
│   │   └── utils/
│   ├── integration/
│   │   ├── api/
│   │   ├── repositories/
│   │   └── services/
│   ├── e2e/
│   │   ├── admin/
│   │   ├── journeys/
│   │   ├── pages/
│   │   ├── tools/
│   │   ├── ux-phases/
│   │   └── visual/
│   ├── load/
│   │   ├── api-load-test.js
│   │   └── stress-test.js
│   ├── accessibility/
│   │   ├── wcag-aa.spec.ts
│   │   └── keyboard-nav.spec.ts
│   └── fixtures/
│       ├── test-data.ts
│       └── mock-api.ts
└── playwright.config.ts
```

### 11.2 Naming Conventions

**Test Files:**
- Unit: `component-name.test.tsx`
- Integration: `feature-name.integration.test.ts`
- E2E: `page-name.spec.ts`
- Visual: `page-name.visual.spec.ts`
- Accessibility: `page-name.a11y.spec.ts`

**Test Descriptions:**
```typescript
// ✅ Good: Descriptive, specific
test('should display error message when API returns 500', async () => {});

// ❌ Bad: Vague
test('error handling', async () => {});
```

### 11.3 Test Data Strategy

**Use Factories:**
```typescript
// fixtures/ipo-factory.ts
export function createMockIPO(overrides?: Partial<IPO>): IPO {
  return {
    id: faker.string.uuid(),
    companyName: faker.company.name(),
    slug: faker.helpers.slugify(faker.company.name()),
    status: 'OPEN',
    segment: 'MAINBOARD',
    priceMin: 100,
    priceMax: 120,
    ...overrides,
  };
}
```

**Use Realistic Data:**
- Company names should be realistic
- Price ranges should be valid
- Dates should be logical (open < close)

**Clean Up After Tests:**
```typescript
afterEach(async () => {
  await db.delete(ipos).where(eq(ipos.id, testIPO.id));
});
```

### 11.4 Common Test Patterns

**Pattern 1: Testing with Loading States**
```typescript
test('displays loading state while fetching', async ({ page }) => {
  await page.route('**/api/ipos', route => route.fulfill({
    status: 200,
    body: JSON.stringify({ data: [] }),
    delay: 2000, // 2 second delay
  }));

  await page.goto('/dashboard');

  // Verify loading state
  await expect(page.locator('[data-testid="loading"]')).toBeVisible();

  // Wait for data to load
  await page.waitForResponse('**/api/ipos');

  // Verify loading state gone
  await expect(page.locator('[data-testid="loading"]')).not.toBeVisible();
});
```

**Pattern 2: Testing Error States**
```typescript
test('displays error when API fails', async ({ page }) => {
  await page.route('**/api/ipos', route => route.fulfill({
    status: 500,
    body: JSON.stringify({ error: 'Internal server error' }),
  }));

  await page.goto('/dashboard');

  await expect(page.locator('[data-testid="error-message"]'))
    .toContainText('Unable to load data');
});
```

**Pattern 3: Testing Accessibility**
```typescript
import { injectAxe, checkA11y } from 'axe-playwright';

test('page is accessible', async ({ page }) => {
  await page.goto('/dashboard');
  await injectAxe(page);
  await checkA11y(page, null, {
    detailedReport: true,
    detailedReportOptions: { html: true },
  });
});
```

### 11.5 Debugging Failed Tests

**Playwright Trace Viewer:**
```bash
# Run test with trace
npx playwright test --trace on

# Open trace viewer
npx playwright show-trace trace.zip
```

**Screenshots on Failure:**
```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
```

**Debug Mode:**
```bash
# Run in debug mode
npx playwright test --debug

# Run specific test
npx playwright test dashboard.spec.ts --debug
```

---

## 12. Conclusion

This comprehensive UI testing plan transforms IPODhan from a project with solid foundations (63 E2E tests, 71 integration tests) into a production-ready application with **industry-leading test coverage** across all dimensions:

### Key Achievements by End of Plan:
- ✅ **80%+ component coverage** (from 29%)
- ✅ **95%+ page coverage** (from 80%)
- ✅ **100% visual regression coverage** for key pages
- ✅ **100% accessibility compliance** (WCAG 2.1 AA)
- ✅ **Cross-browser validated** (7 browsers)
- ✅ **Performance optimized** (LCP <2.5s)
- ✅ **Fully automated CI/CD** testing pipeline

### Immediate Focus (Weeks 1-2):
1. **Fix production-blocking hydration issues** (Week 1)
2. **Establish visual regression baseline** (Week 2)
3. **Run comprehensive accessibility audit** (Week 2)

### ROI & Impact:
- **Reduce production bugs** by 90%+
- **Increase developer confidence** in deployments
- **Ensure accessibility compliance** (legal protection)
- **Improve performance** (better SEO, lower bounce rate)
- **Enable rapid iteration** with confidence

**Next Step**: Obtain stakeholder approval and begin Phase 1 immediately.

---

**Document Version**: 1.0
**Last Updated**: 2025-11-12
**Maintained By**: QA Team Lead
**Review Frequency**: Weekly during implementation, monthly after completion
