# Responsive Testing Checklist - IPO Details Page

**Date Created**: 2025-11-02
**Phase**: 5 - Polish & Optimization
**Purpose**: Comprehensive responsive design testing across devices

---

## Test Environments

### Desktop Viewports
| Size | Width | Device | Priority |
|------|-------|--------|----------|
| Small Desktop | 1024px | MacBook Air | P0 |
| Standard Desktop | 1280px | Common laptops | P0 |
| Large Desktop | 1920px | External monitors | P1 |
| Ultra-wide | 2560px | Ultra-wide monitors | P2 |

### Tablet Viewports
| Size | Width × Height | Device | Orientation | Priority |
|------|----------------|--------|-------------|----------|
| iPad Mini | 768px × 1024px | iPad Mini | Portrait | P0 |
| iPad | 1024px × 768px | iPad Air | Landscape | P0 |
| iPad Pro | 1366px × 1024px | iPad Pro | Landscape | P1 |
| Android Tablet | 800px × 1280px | Galaxy Tab | Portrait | P1 |

### Mobile Viewports
| Size | Width × Height | Device | Priority |
|------|----------------|--------|----------|
| iPhone SE | 375px × 667px | iPhone SE (2020) | P0 |
| iPhone 12/13 | 390px × 844px | iPhone 12/13 | P0 |
| iPhone 14 Pro Max | 430px × 932px | iPhone 14 Pro Max | P1 |
| Android Small | 360px × 640px | Galaxy S10 | P1 |
| Android Large | 412px × 915px | Pixel 7 | P1 |

---

## Testing Methodology

### Tools
- **Browser DevTools**: Chrome DevTools responsive mode
- **Real Devices**: Physical iPhone, iPad, Android (if available)
- **Lighthouse**: Mobile performance audit
- **Screenshots**: Capture for documentation

### Testing Checklist
Each viewport should be tested for:
- ✅ Layout integrity (no overflow, proper spacing)
- ✅ Touch targets (minimum 44×44px on mobile)
- ✅ Text readability (font sizes appropriate)
- ✅ Chart responsiveness (scales correctly)
- ✅ Navigation accessibility (sticky elements work)
- ✅ Performance (smooth scrolling, no jank)

---

## Component-Level Testing

### 1. IPO Header Section
**Location**: Top of page, above sticky dashboard

#### Desktop (≥1024px)
- [ ] Logo displays correctly (left-aligned)
- [ ] Company name fully visible
- [ ] Status badge positioned correctly
- [ ] "Compare" button visible and accessible
- [ ] Breadcrumb navigation visible
- [ ] No horizontal overflow

#### Tablet (768px - 1023px)
- [ ] Logo scales appropriately
- [ ] Company name wraps if needed
- [ ] Status badge maintains visibility
- [ ] "Compare" button remains accessible
- [ ] Breadcrumb adjusts for narrower space

#### Mobile (<768px)
- [ ] Logo sizes down (40×40px or smaller)
- [ ] Company name wraps gracefully (max 2 lines)
- [ ] Status badge stacks or wraps
- [ ] "Compare" button may hide or show in menu
- [ ] Breadcrumb uses compact format or hides

---

### 2. Sticky Dashboard Layout
**Component**: `StickyDashboardLayout` with timeline and metrics

#### Desktop (≥1024px)
- [ ] Sticky positioning works (follows scroll)
- [ ] Timeline widget fully visible (all 5 milestones)
- [ ] 4 metric cards in 2×2 grid
- [ ] Mini charts (sparklines) display correctly
- [ ] Collapse button visible and functional
- [ ] Z-index stacking correct (above content, below nav)

#### Tablet (768px - 1023px)
- [ ] Sticky still works (top: 0 instead of top: 64px)
- [ ] Timeline compresses appropriately
- [ ] Metrics stack to 2×2 or 1×4 grid
- [ ] Charts scale down but remain readable
- [ ] Collapse button accessible

#### Mobile (<768px)
- [ ] Sticky disabled (inline flow) to save space
- [ ] Timeline collapses to vertical or hidden
- [ ] Metrics stack vertically (1 column)
- [ ] Mini charts hide or simplify
- [ ] Collapse All button accessible
- [ ] Touch targets ≥44×44px

**Expected Behavior**:
```
Desktop:  [Timeline ━━━━━━━━━] [Metric] [Metric]
                              [Metric] [Metric]

Tablet:   [Timeline ━━━━━] [Metric] [Metric]
                          [Metric] [Metric]

Mobile:   [Timeline]
          [Metric]
          [Metric]
          [Metric]
          [Metric]
```

---

### 3. IPO Timeline Widget
**Component**: `IPOTimelineWidget`

#### Desktop
- [ ] Horizontal layout with 5 milestones
- [ ] Progress bar fills correctly
- [ ] Milestone labels fully visible
- [ ] Dates display below milestones
- [ ] Active milestone highlighted
- [ ] Hover states work

#### Tablet
- [ ] Timeline compresses but remains horizontal
- [ ] Milestone labels may abbreviate
- [ ] Dates may hide or show on tap
- [ ] Progress bar visible

#### Mobile
- [ ] Timeline remains horizontal (scroll if needed)
- [ ] OR switches to vertical layout
- [ ] Milestone labels abbreviated or icons only
- [ ] Touch-friendly spacing (≥12px between milestones)
- [ ] Current milestone prominent

---

### 4. Key Metrics Cards (Enhanced)
**Component**: `KeyMetricsCardsEnhanced`

#### Desktop
- [ ] 2×2 grid layout
- [ ] Each card shows: Title, Value, Change%, Sparkline
- [ ] Sparkline charts visible (80-120px wide)
- [ ] Hover effects work
- [ ] Cards have equal height

#### Tablet
- [ ] 2×2 or 1×4 grid (depends on width)
- [ ] Sparklines scale down (60-80px)
- [ ] All data remains visible
- [ ] Touch targets work

#### Mobile
- [ ] Stacks to 1 column
- [ ] Each card full width
- [ ] Sparklines hide or simplify to icons
- [ ] Values and changes prominent
- [ ] Cards have minimum height (80px)

---

### 5. Section Control Bar
**Component**: `SectionControlBar`

#### Desktop (≥1024px)
- [ ] Sticky at top: 64px (below main nav)
- [ ] Section count displayed (e.g., "9 sections")
- [ ] "Expand All" / "Collapse All" button visible
- [ ] Button has hover states
- [ ] Gradient background visible
- [ ] Z-index: 30 (above sections, below modals)

#### Tablet (768px - 1023px)
- [ ] Sticky at top: 0
- [ ] Section count visible
- [ ] Button accessible
- [ ] Touch target ≥44×44px

#### Mobile (<768px)
- [ ] Inline (not sticky) to save viewport space
- [ ] Section count shows
- [ ] Button full width or prominent
- [ ] Touch target ≥48×48px
- [ ] Icon + text or icon only

---

### 6. Collapsible Sections

#### Desktop
- [ ] Smooth expand/collapse (300ms)
- [ ] Chevron icon rotates
- [ ] Hover states on header
- [ ] Content padding appropriate
- [ ] Charts render at full width

#### Tablet
- [ ] Animations work (unless prefers-reduced-motion)
- [ ] Touch-friendly headers (min 44px height)
- [ ] Content adjusts to narrower width
- [ ] Charts scale responsively

#### Mobile
- [ ] Touch targets ≥48×48px
- [ ] Section headers stack properly
- [ ] Content uses full width
- [ ] Charts stack vertically if multi-column
- [ ] Smooth scrolling after expand

---

### 7. Financial Performance Charts
**Component**: `FinancialPerformanceCharts`

#### Desktop
- [ ] 4 sub-components visible:
  1. Revenue Trend Chart (line)
  2. Profit/Loss Chart (area)
  3. EBITDA Chart (composed)
  4. Financial Ratios Grid (4 gauges)
- [ ] Charts side-by-side where appropriate
- [ ] Tooltips appear on hover
- [ ] Legend visible and readable
- [ ] Axes labels visible

#### Tablet
- [ ] Charts stack to 2 columns
- [ ] Ratios grid: 2×2
- [ ] Tooltips work on tap
- [ ] Font sizes scale down appropriately
- [ ] Charts maintain aspect ratio

#### Mobile
- [ ] All charts stack vertically (1 column)
- [ ] Ratios grid: 1×4 or 2×2
- [ ] Charts use full width
- [ ] Tooltips positioned correctly (above/below, not clipped)
- [ ] X-axis labels may rotate or abbreviate
- [ ] Touch targets for interactive elements ≥44px

**Expected Mobile Layout**:
```
[Revenue Chart (full width)]
[Profit Chart (full width)]
[EBITDA Chart (full width)]
[Ratio 1] [Ratio 2]
[Ratio 3] [Ratio 4]
```

---

### 8. Subscription Dashboard
**Component**: `SubscriptionDashboard`

#### Desktop
- [ ] 4 sub-components:
  1. Overall Subscription Chart (area, full width)
  2. Category Breakdown Chart (bar, 60%)
  3. Subscription Heatmap (40%)
  4. Category Cards (3 columns)
- [ ] Charts positioned correctly
- [ ] Category cards in 3-column grid
- [ ] Tooltips show full details

#### Tablet
- [ ] Overall chart full width
- [ ] Category & heatmap stack vertically
- [ ] Cards: 2 columns or 3 columns (depends on width)
- [ ] All data visible

#### Mobile
- [ ] All components stack vertically
- [ ] Category cards: 1 column
- [ ] Charts full width
- [ ] Heatmap cells ≥32×32px (touch-friendly)
- [ ] Tooltips don't clip

---

### 9. Listing Performance Charts
**Component**: `ListingPerformanceCharts`

#### Desktop
- [ ] 3 sub-components:
  1. Stock Price Chart (line, full width)
  2. Listing Gains Chart (bar, 50%)
  3. Sector Comparison Chart (bar, 50%)
- [ ] Side-by-side layout for 2 & 3
- [ ] All visible above fold or scroll

#### Tablet
- [ ] Stock price full width
- [ ] Gains & sector stack vertically
- [ ] Charts scale appropriately

#### Mobile
- [ ] All 3 charts stack vertically
- [ ] Full width for each
- [ ] Bars/columns remain readable (min 24px width)

---

### 10. GMP History Chart
**Component**: `GMPHistoryChart`

#### Desktop
- [ ] Line chart with confidence bands (area)
- [ ] Full width within section
- [ ] 30-day data visible
- [ ] Hover shows exact values
- [ ] Legend visible

#### Tablet
- [ ] Chart scales down
- [ ] X-axis dates may abbreviate
- [ ] Confidence bands visible
- [ ] Tap for tooltips

#### Mobile
- [ ] Chart full width
- [ ] X-axis: rotate labels or show fewer dates
- [ ] Confidence bands simplified or removed
- [ ] Tooltip shows on tap (positioned above)

---

### 11. Demand Graph
**Component**: `DemandGraph`

#### Desktop
- [ ] Histogram showing price buckets
- [ ] Full width
- [ ] Tooltips on hover
- [ ] Legend visible

#### Tablet
- [ ] Scales appropriately
- [ ] Bars remain readable
- [ ] Touch-friendly

#### Mobile
- [ ] Histogram full width
- [ ] Bars ≥16px wide
- [ ] X-axis labels rotated or abbreviated
- [ ] Tap for tooltips

---

## Interaction Testing

### 1. Touch Targets (Mobile/Tablet)
**Minimum Sizes** (Apple HIG, Material Design):
- **Mobile**: 48×48px (iOS), 48dp (Android)
- **Tablet**: 44×44px

**Components to Test**:
- [ ] Section expand/collapse buttons: ≥48×48px
- [ ] "Expand All" button: ≥48×48px
- [ ] Chart legend items: ≥44×44px
- [ ] Navigation links: ≥44×44px
- [ ] "Compare" button: ≥44×44px

### 2. Scrolling Performance
- [ ] Smooth scrolling (60 FPS)
- [ ] Sticky elements don't jump
- [ ] No layout shift during scroll
- [ ] Charts don't re-render unnecessarily
- [ ] Expand/collapse doesn't cause jank

### 3. Animations
- [ ] Collapsible sections: 300ms smooth
- [ ] Staggered "Expand All": 50ms × 9 sections = 450ms total
- [ ] Respects `prefers-reduced-motion`
- [ ] No janky animations on mobile
- [ ] Chevron rotation smooth

---

## Accessibility on Mobile

### 1. Font Sizes
**WCAG AA Requirements**:
- Body text: ≥16px (1rem)
- Small text: ≥14px (0.875rem)
- Chart labels: ≥12px (0.75rem)

**Test**:
- [ ] All text readable at arm's length (~40cm)
- [ ] No text <12px on mobile
- [ ] Headings scale appropriately

### 2. Color Contrast
- [ ] All text: ≥4.5:1 contrast (WCAG AA)
- [ ] Chart colors distinguishable
- [ ] Status badges readable
- [ ] Links visible

### 3. Spacing
- [ ] Touch targets not overlapping
- [ ] Minimum 8px spacing between interactive elements
- [ ] Content padding: ≥16px on mobile

---

## Performance Metrics (Mobile)

### Target Metrics
| Metric | Target | P0 | P1 |
|--------|--------|----|----|
| **LCP** (Largest Contentful Paint) | <2.5s | <3.0s | <4.0s |
| **FID** (First Input Delay) | <100ms | <150ms | <300ms |
| **CLS** (Cumulative Layout Shift) | <0.1 | <0.15 | <0.25 |
| **TTI** (Time to Interactive) | <3.5s | <5.0s | <7.5s |
| **TTFB** (Time to First Byte) | <600ms | <800ms | <1200ms |

### Testing Steps
1. Open Chrome DevTools → Lighthouse
2. Select "Mobile" device
3. Run performance audit
4. Record metrics
5. Compare against targets

### Common Issues & Fixes
| Issue | Cause | Fix |
|-------|-------|-----|
| High LCP | Large charts above fold | Lazy load below-fold charts |
| High FID | Heavy JavaScript | Code splitting, defer non-critical |
| High CLS | Charts rendering late | Reserve space with skeleton |
| Slow TTI | Too many re-renders | Memoize components, optimize state |

---

## Known Responsive Issues (To Fix)

### Current Status (2025-11-02)
- [ ] **Issue 1**: Timeline widget may overflow on small mobile (<360px)
  - **Priority**: P2
  - **Fix**: Use horizontal scroll or vertical layout

- [ ] **Issue 2**: Financial ratios grid (4 gauges) cramped on mobile
  - **Priority**: P1
  - **Fix**: Stack to 2×2 or 1×4

- [ ] **Issue 3**: Subscription heatmap cells too small on mobile
  - **Priority**: P1
  - **Fix**: Minimum cell size 32×32px or hide heatmap

- [ ] **Issue 4**: Chart tooltips may clip on small screens
  - **Priority**: P1
  - **Fix**: Position tooltips dynamically (above/below based on space)

- [ ] **Issue 5**: Sticky dashboard may take too much space on small mobile
  - **Priority**: P0
  - **Fix**: Already implemented (inline on mobile)

---

## Testing Workflow

### Manual Testing (Recommended)
1. **Open page**: Navigate to `/ipos/[any-ipo-slug]`
2. **Open DevTools**: F12 or right-click → Inspect
3. **Toggle device mode**: Ctrl+Shift+M (Windows) or Cmd+Shift+M (Mac)
4. **Select preset**:
   - iPhone SE (375px)
   - iPad (768px)
   - Responsive (custom widths)
5. **Test each component**: Follow checklist above
6. **Take screenshots**: Document issues
7. **Repeat for all viewports**

### Automated Testing (Future)
```typescript
// Example Playwright test
test('IPO detail page responsive on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/ipos/test-ipo-slug');

  // Test sticky dashboard is inline (not sticky)
  const dashboard = page.locator('[data-testid="sticky-dashboard"]');
  await expect(dashboard).toHaveCSS('position', 'static');

  // Test section control bar button is touch-friendly
  const expandButton = page.locator('button:has-text("Expand All")');
  const box = await expandButton.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(48);

  // Test charts stack vertically
  const charts = page.locator('[data-testid="financial-chart"]');
  const count = await charts.count();
  for (let i = 0; i < count - 1; i++) {
    const box1 = await charts.nth(i).boundingBox();
    const box2 = await charts.nth(i + 1).boundingBox();
    expect(box2?.y).toBeGreaterThan(box1?.y + box1?.height);
  }
});
```

---

## Sign-Off Checklist

### Before Marking Complete
- [ ] Tested on ≥3 mobile sizes (iPhone SE, iPhone 12, Android)
- [ ] Tested on ≥2 tablet sizes (iPad portrait, iPad landscape)
- [ ] Tested on ≥2 desktop sizes (1280px, 1920px)
- [ ] All touch targets ≥44×44px on mobile
- [ ] No horizontal overflow on any viewport
- [ ] Charts render correctly on all sizes
- [ ] Sticky elements work as expected
- [ ] Performance metrics within targets (LCP <2.5s mobile)
- [ ] Screenshots captured for documentation
- [ ] Issues logged in tracker or fixed

### Documentation
- [ ] Update IMPLEMENTATION_TRACKER.md with responsive testing status
- [ ] Add screenshots to `docs/19-ui/ipo-detail-page/screenshots/`
- [ ] Document any known issues in Phase 5 report
- [ ] Share findings with team

---

## Resources

### Testing Tools
- **Chrome DevTools**: Device emulation, performance profiling
- **Firefox Responsive Mode**: Alternative device testing
- **Lighthouse**: Performance audits
- **BrowserStack**: Real device testing (paid)
- **Responsively App**: Multi-viewport testing (free)

### Documentation
- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/buttons)
- [Material Design Touch Targets](https://material.io/design/usability/accessibility.html#layout-and-typography)
- [WCAG 2.1 Mobile Accessibility](https://www.w3.org/WAI/standards-guidelines/mobile/)
- [Web.dev Performance](https://web.dev/metrics/)

---

**Checklist Version**: 1.0
**Last Updated**: 2025-11-02
**Author**: Claude Code
**Status**: Ready for testing

---

## Quick Command Reference

### Start Dev Server
```bash
cd web && npm run dev
```

### Run Lighthouse (Mobile)
```bash
npx lighthouse http://localhost:3000/ipos/[slug] \
  --only-categories=performance \
  --emulated-form-factor=mobile \
  --throttling-method=simulate \
  --output=html \
  --output-path=./lighthouse-mobile.html
```

### Take Screenshot (Chrome DevTools)
1. Open DevTools → Device Mode
2. Select device
3. Ctrl+Shift+P → "Capture full size screenshot"

---

**End of Checklist**
