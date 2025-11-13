# IPODhan UI Testing Quick Start Guide

> **Last Updated**: 2025-11-13
> **Purpose**: Quick reference for running UI tests with Playwright MCP and managing defects

---

## 🚀 Quick Testing Commands

### 1. Emergency Regression Fix (Template - No Active P0 Issues)
```
✅ **RESOLVED (Session 6 - Nov 13, 2025)**: DEF-2025-001 webpack regression
   - Issue: React 19 + Next.js 15 incompatibility causing webpack errors
   - Solution: Upgraded React 18 → 19, migrated to Turbopack
   - Result: All 3 core pages functional, development environment stable

For New P0 Issues:
Fix [DEF-YYYY-XXX] critical issue. Test Homepage, Dashboard, and IPO Detail pages using Playwright MCP in headed mode. Update TODO.md and defect report with findings.
```

### 2. Full UI Testing Suite
```
Execute comprehensive UI testing for IPODhan. Test all critical pages (Homepage, Dashboard, IPO Detail, Mainboard, SME). Document defects in docs/10-issues/ using templates. Update TODO.md with P0-P3 priorities.
```

### 3. Component Testing
```
Test interactive components on Dashboard and IPO Detail pages using Playwright MCP. Focus on Lot Calculator, filters, charts, and tables. Create defect reports for any issues found with screenshots.
```

### 4. Visual Regression Testing
```
Capture baseline screenshots for Homepage, Dashboard, and IPO Detail at mobile (375px), tablet (768px), and desktop (1920px) viewports. Compare with previous baselines and document visual defects.
```

### 5. Defect Verification
```
Verify fixes for all P0 and P1 defects using 3-phase verification process (bug verification, regression testing, integration testing). Update defect status in tracking and document verification results.
```

---

## 📋 Complete Testing Workflow

### Step 1: Environment Setup (5 min)

**Start Development Server**:
```bash
cd web
npm run dev  # Turbopack - auto-selects port (usually 3010)
```

**Verify Services**:
- Development server: http://localhost:3010 (Turbopack auto-selects port - check terminal)
- PostgreSQL: Check connection
- Redis: Check connection

**Note**: Turbopack (Next.js 15's official bundler) provides:
- 96% faster Fast Refresh (103-149ms vs webpack's ~4s)
- 100% stable HMR (no more webpack errors)
- Production-ready React 19 compatibility

### Step 2: Run Tests with Playwright MCP

**Basic Navigation**:
```javascript
// Navigate to page (check terminal for actual port)
await mcp__playwright__browser_navigate('http://localhost:3010')

// Wait for content to load
await mcp__playwright__browser_wait_for({ text: 'Latest IPOs' })
```

**Capture State**:
```javascript
// Get accessibility snapshot (BETTER than screenshot)
await mcp__playwright__browser_snapshot()

// Take full page screenshot
await mcp__playwright__browser_take_screenshot({
  filename: 'homepage-baseline.png',
  fullPage: true
})
```

**Check Errors**:
```javascript
// Get console errors only
await mcp__playwright__browser_console_messages({ onlyErrors: true })
```

**Test Interactions**:
```javascript
// Click element
await mcp__playwright__browser_click({
  element: 'Dashboard Filter Button',
  ref: 'css=button[aria-label="Filter"]'
})

// Type in input
await mcp__playwright__browser_type({
  element: 'Search Input',
  ref: 'css=input[type="search"]',
  text: 'Reliance'
})
```

### Step 3: Document Issues

**If Issue Found**:
1. Create defect report from template:
   ```bash
   cp docs/10-issues/templates/defect-template.md \
      docs/07-testing/defect-reports/DEF-2025-XXX.md
   ```

2. Fill in all sections:
   - Classification (Severity P0-P3)
   - Environment details
   - Steps to reproduce
   - Expected vs actual
   - Evidence (screenshots, console logs)

3. Add to TODO.md:
   ```markdown
   - [ ] **#ISS-XXX**: Fix [issue name]
     - **Component**: [Component name]
     - **Assignee**: TBD
     - **Effort**: Xh
     - **Due**: YYYY-MM-DD
     - **Related**: DEF-2025-XXX
   ```

### Step 4: Track Progress

**Update Status**:
- Mark tasks as in_progress when starting
- Mark tasks as completed when done
- Update TESTING_STATUS_TRACKER.md after session

**Export for Reporting**:
```bash
npm run export-issues
# Creates docs/10-issues/exports/issues-export.csv
```

---

## 🎯 Defect Severity Guidelines

### P0 - Critical (Fix in 24h)
- System crash or data loss
- Complete feature non-functional
- All users affected
- **Example**: Homepage showing blank page

### P1 - Major (Fix in 48-72h)
- Core feature broken with workaround
- Significant user impact
- **Example**: Dashboard filters not working

### P2 - Minor (Fix in current sprint)
- Non-core features affected
- UX degraded but functional
- **Example**: Slow table sorting

### P3 - Trivial (Fix when time allows)
- Cosmetic issues only
- No functional impact
- **Example**: Icon alignment off by 2px

---

## 📊 Testing Checklist

### Critical Pages (Must Test)
- [ ] **Homepage** (`/`)
  - Hero section
  - IPO listings (4 tables)
  - Features section
  - Footer

- [ ] **Dashboard** (`/dashboard`)
  - Filters (Status, Segment, Type, Sector, Score)
  - Search functionality
  - Grid/List view toggle
  - IPO cards rendering
  - Pagination

- [ ] **IPO Detail** (`/ipos/[slug]`)
  - Company header with rating
  - Timeline (5 stages)
  - All tabs (Overview, Financials, Subscription, etc.)
  - Sidebar details
  - IPODhan Score breakdown

- [ ] **Mainboard IPOs** (`/mainboard-ipos`)
  - Listing table
  - Filters
  - Sorting

- [ ] **SME IPOs** (`/sme-ipos`)
  - Listing table
  - Filters
  - Sorting

### Interactive Components (Must Test)
- [ ] Lot Calculator widget
- [ ] IPO comparison tool
- [ ] Chart interactions (hover, tooltips)
- [ ] Table sorting
- [ ] Dropdown filters
- [ ] Mobile navigation menu
- [ ] Search autocomplete

### Cross-Browser Testing
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Edge (latest)
- [ ] Safari (if available)

### Responsive Testing
- [ ] Mobile (375px width)
- [ ] Tablet (768px width)
- [ ] Desktop (1920px width)

---

## 🔧 Common Playwright MCP Commands

### Navigation & Waiting
```javascript
// Navigate
mcp__playwright__browser_navigate(url)

// Wait for text
mcp__playwright__browser_wait_for({ text: 'Content' })

// Wait for time
mcp__playwright__browser_wait_for({ time: 2 })
```

### Capturing State
```javascript
// Accessibility snapshot (shows structure)
mcp__playwright__browser_snapshot()

// Screenshot (visual)
mcp__playwright__browser_take_screenshot({
  filename: 'page-name.png',
  fullPage: true,
  type: 'png'
})

// Element screenshot
mcp__playwright__browser_take_screenshot({
  element: 'Dashboard',
  ref: 'css=#dashboard',
  filename: 'dashboard-only.png'
})
```

### Error Monitoring
```javascript
// All console messages
mcp__playwright__browser_console_messages()

// Errors only
mcp__playwright__browser_console_messages({ onlyErrors: true })

// Network requests
mcp__playwright__browser_network_requests()
```

### Interactions
```javascript
// Click
mcp__playwright__browser_click({
  element: 'Submit Button',
  ref: 'css=button[type="submit"]'
})

// Double click
mcp__playwright__browser_click({
  element: 'Card',
  ref: 'css=.ipo-card',
  doubleClick: true
})

// Type
mcp__playwright__browser_type({
  element: 'Search',
  ref: 'css=input[type="search"]',
  text: 'Reliance',
  submit: true  // Press Enter after
})

// Select option
mcp__playwright__browser_select_option({
  element: 'Status Filter',
  ref: 'css=select[name="status"]',
  values: ['OPEN']
})

// Hover
mcp__playwright__browser_hover({
  element: 'Tooltip Trigger',
  ref: 'css=.tooltip-trigger'
})
```

### Tab Management
```javascript
// List tabs
mcp__playwright__browser_tabs({ action: 'list' })

// New tab
mcp__playwright__browser_tabs({ action: 'new' })

// Close tab
mcp__playwright__browser_tabs({ action: 'close', index: 1 })

// Switch tab
mcp__playwright__browser_tabs({ action: 'select', index: 0 })
```

---

## 📁 File Locations

### Issue Tracking
- **TODO.md**: `docs/10-issues/TODO.md`
- **BACKLOG.md**: `docs/10-issues/BACKLOG.md`
- **Templates**: `docs/10-issues/templates/`
- **Exports**: `docs/10-issues/exports/`

### Testing Documentation
- **Status Tracker**: `docs/07-testing/TESTING_STATUS_TRACKER.md`
- **Workflows**: `docs/07-testing/PLAYWRIGHT_MCP_WORKFLOWS.md`
- **Quick Start**: `docs/07-testing/defect-management/QUICK_START.md` (this file)

### Defect Reports
- **Reports**: `docs/07-testing/defect-reports/`
- **Example**: `docs/07-testing/defect-reports/DEF-2025-001.md`

---

## 🚨 Emergency Procedures

### If Application Won't Load
1. Check dev server is running: `npm run dev`
2. Check console for errors
3. Verify DATABASE_URL and REDIS_HOST in .env.local
4. Try clean rebuild: `rm -rf .next && npm run dev`
5. Document as P0 defect if issue persists

### If Test Hangs
1. Stop Playwright MCP browser
2. Restart dev server
3. Clear `.next` cache
4. Try again with fresh session

### If Screenshot Tool Fails
1. Verify Playwright MCP is connected
2. Check browser is in headed mode
3. Try `browser_snapshot` instead of screenshot
4. Document issue and continue with console logging

---

## 💡 Tips & Best Practices

### Testing Tips
1. **Always use headed mode** - Visual verification is critical
2. **Start with snapshot** - Better than screenshot for debugging
3. **Wait for content** - Don't assume instant load
4. **Capture evidence** - Screenshots + console logs + network
5. **Test happy path first** - Then edge cases

### Defect Documentation Tips
1. **Be specific** - "Button doesn't work" → "Submit button on lot calculator doesn't respond to click"
2. **Include context** - Browser, OS, viewport, data state
3. **Reproducible steps** - Anyone should be able to reproduce
4. **Evidence required** - Screenshots are mandatory
5. **Link related issues** - Use #ISS-XXX and DEF-YYYY-XXX

### Time Management
- **Quick test**: 15-30 min (1-2 pages, smoke test)
- **Component test**: 1-2 hours (focused testing)
- **Full regression**: 4-6 hours (all pages, all scenarios)
- **Visual baseline**: 2-3 hours (screenshots at 3 viewports)

---

## 📞 Support & Resources

### Documentation
- [Main Testing Plan](../COMPREHENSIVE_UI_TESTING_PLAN.md)
- [Playwright MCP Workflows](../PLAYWRIGHT_MCP_WORKFLOWS.md)
- [Project Architecture](../../CLAUDE.md)
- [Testing Strategy](../../02-architecture/testing-strategy.md)

### Tools
- **Playwright MCP**: https://github.com/executeautomation/playwright-mcp-server
- **Chrome DevTools Protocol**: https://chromedevtools.github.io/devtools-protocol/
- **Next.js Debugging**: https://nextjs.org/docs/advanced-features/debugging

### Quick Commands Reference
```bash
# Start dev server
npm run dev

# Run tests (when available)
npm run test:e2e

# Export issues
npm run export-issues

# Database studio
npm run db:studio

# Check logs
tail -f logs/app.log
```

---

**Last Updated**: 2025-11-13
**Version**: 1.0
**Maintained By**: IPODhan Development Team
