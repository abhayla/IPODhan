# IPODhan UI Testing - Master Trigger Prompt

> **Purpose**: Copy-paste prompts to trigger comprehensive UI testing sessions with integrated defect management
> **Last Updated**: 2025-11-13
> **Version**: 1.0

---

## 🎯 Master Testing Trigger

### Full Session Trigger (Copy-Paste Ready)

```
Execute comprehensive UI testing for IPODhan application following industry-standard defect management practices.

## Session Configuration
- Testing Type: [Choose: Emergency Fix | Regression | Component | Full Suite]
- Priority Focus: [Choose: P0 Critical | P1 Major | P2 Minor | All]
- Tool: Playwright MCP (headed mode - 90%), Chrome DevTools MCP (10%)

## Execution Steps

### Phase 1: Environment Setup (5 min)
1. Start development server: cd web && npm run dev (Turbopack - port 3010)
2. Verify server running on http://localhost:3010
3. Check database and Redis connections
4. Review current TODO.md for active issues

**Note**: Turbopack auto-selects next available port. Check terminal output for actual port.

### Phase 2: Current State Assessment (15 min)
1. Navigate to critical pages (Homepage, Dashboard, IPO Detail)
2. Capture console errors: mcp__playwright__browser_console_messages({ onlyErrors: true })
3. Take baseline screenshots for each page
4. Document any immediate P0/P1 issues found

### Phase 3: Defect Investigation & Documentation (30-60 min)
1. For each issue found:
   - Create defect report using docs/10-issues/templates/defect-template.md
   - Assign severity (P0-P3) based on guidelines
   - Capture evidence (screenshots, console logs, network tab)
   - Document in docs/07-testing/defect-reports/
2. Update docs/10-issues/TODO.md with new issues
3. Link related issues using #ISS-XXX and DEF-YYYY-XXX format

### Phase 4: Fix Verification (if fixes available) (30-60 min)
1. Apply fixes to identified issues
2. Execute 3-phase verification:
   - Phase 1: Bug Verification (30 min) - Re-run failed test case
   - Phase 2: Regression Testing (2 hours) - Test related functionality
   - Phase 3: Integration Testing (4 hours) - Test user journeys
3. Update defect status in tracking (NEW → ASSIGNED → OPEN → FIXED → VERIFIED → CLOSED)
4. Document verification results in defect report

### Phase 5: Testing Documentation (15-30 min)
1. Update TESTING_STATUS_TRACKER.md with session results
2. Update defect metrics dashboard
3. Move completed items from TODO.md to CHANGELOG.md
4. Commit all documentation changes with descriptive message

## Commands Reference

### Navigation & Capture
- Navigate: mcp__playwright__browser_navigate(url)
- Screenshot: mcp__playwright__browser_take_screenshot({ fullPage: true })
- Snapshot: mcp__playwright__browser_snapshot()
- Console: mcp__playwright__browser_console_messages({ onlyErrors: true })

### Interactions
- Click: mcp__playwright__browser_click({ element, ref })
- Type: mcp__playwright__browser_type({ element, ref, text })
- Wait: mcp__playwright__browser_wait_for({ text })
- Hover: mcp__playwright__browser_hover({ element, ref })

## Defect Tracking

### Severity Guidelines
- P0 - Critical: System crash, data loss, complete feature failure (Fix in 24h)
- P1 - Major: Core feature broken, workaround exists (Fix in 48-72h)
- P2 - Minor: Non-core features affected, UX degraded (Fix in current sprint)
- P3 - Trivial: Cosmetic issues only (Fix when time allows)

### Lifecycle States
NEW → ASSIGNED → OPEN → FIXED → PENDING RETEST → RETEST → VERIFIED → CLOSED
(If fix fails: → REOPENED → back to ASSIGNED)

### Documentation Locations
- TODO.md: docs/10-issues/TODO.md
- BACKLOG.md: docs/10-issues/BACKLOG.md
- Templates: docs/10-issues/templates/
- Defect Reports: docs/07-testing/defect-reports/
- Status Tracker: docs/07-testing/TESTING_STATUS_TRACKER.md
- Quick Start: docs/07-testing/defect-management/QUICK_START.md

## Success Criteria
✅ All P0 defects identified and documented
✅ Screenshots captured for all issues
✅ Defect reports created with full details
✅ Testing status tracker updated
✅ Metrics dashboard updated
✅ TODO.md reflects current state

BEGIN TESTING SESSION NOW
```

---

## 🚀 Quick Trigger Prompts

### 1. Emergency P0 Fix (Template - No Active P0 Issues)

```
EMERGENCY: Fix P0 critical issue in IPODhan application.

Target: [DEF-YYYY-XXX] - [Issue description]

✅ **EXAMPLE (Session 6 - Nov 13, 2025)**: DEF-2025-001 RESOLVED
   - Issue: React 19 + Next.js 15 incompatibility
   - Solution: Upgraded React 18 → 19, migrated to Turbopack
   - Result: All 3 core pages functional, development environment stable

Steps for New P0 Issues:
1. Investigate current state of affected component/page
2. Identify root cause (use console logs, network tab, snapshots)
3. Apply fix following industry best practices
4. Test all 3 critical pages (Homepage, Dashboard, IPO Detail)
5. Capture screenshots showing working state
6. Update defect status from NEW → FIXED
7. Execute 3-phase verification
8. Update TODO.md marking related issues as completed

Use Playwright MCP in headed mode. Document all findings with screenshots.
```

### 2. Full Regression Suite

```
Execute full regression testing suite for IPODhan.

Scope: All critical pages and components
Duration: 4-6 hours
Tool: Playwright MCP (headed mode)

Test Plan:
1. Homepage (/)
   - Hero section, IPO listings, features, footer
   - Test all navigation links
   - Verify data loading from cache/DB

2. Dashboard (/dashboard)
   - Filters, search, grid/list toggle
   - Test all filter combinations
   - Verify IPO cards rendering

3. IPO Detail (/ipos/[slug])
   - All tabs, timeline, company info
   - Test navigation, scoring, financials
   - Verify all data sections load

4. Mainboard IPOs (/mainboard-ipos)
   - Listing table, filters, sorting

5. SME IPOs (/sme-ipos)
   - Listing table, filters, sorting

For each defect found:
- Create report using template
- Add to TODO.md with P0-P3 priority
- Capture screenshots + console logs
- Update TESTING_STATUS_TRACKER.md

Report final metrics:
- Total defects found (by priority)
- Pages tested
- Tests passed/failed
- Screenshots captured
```

### 3. Component-Specific Testing

```
Test interactive components on Dashboard and IPO Detail pages.

Focus Areas:
1. Lot Calculator widget
2. IPO comparison tool
3. Chart interactions (hover, tooltips, legends)
4. Table sorting and pagination
5. Dropdown filters (Status, Segment, Type, Sector, Score)
6. Search functionality with autocomplete
7. Mobile navigation menu
8. Grid/List view toggle

For each component:
1. Navigate to page
2. Test all interactions
3. Capture screenshots of normal and error states
4. Document any defects with:
   - Component name
   - Expected behavior
   - Actual behavior
   - Steps to reproduce
   - Evidence (screenshots + console logs)

Create defect reports for all issues found.
Update TODO.md with component-specific issues.
```

### 4. Visual Regression Baseline

```
Create visual regression baseline screenshots for all critical pages.

Viewports to test:
- Mobile: 375px width
- Tablet: 768px width
- Desktop: 1920px width

Pages to capture:
1. Homepage (/)
2. Dashboard (/dashboard) - default view
3. Dashboard (/dashboard) - with filters applied
4. IPO Detail (/ipos/manufacturing-associates)
5. IPO Detail (/ipos/reliance-power-ipo)
6. Mainboard IPOs (/mainboard-ipos)
7. SME IPOs (/sme-ipos)

For each page + viewport combination:
1. Navigate to page
2. Resize browser: mcp__playwright__browser_resize({ width, height })
3. Wait for content to load
4. Capture full-page screenshot with descriptive filename
   Example: baseline-homepage-mobile-375px.png

Create baseline directory: docs/07-testing/baselines/
Total screenshots: 21 (7 pages × 3 viewports)

Document any visual issues found immediately.
```

### 5. Accessibility Audit

```
Execute WCAG 2.1 AA accessibility audit for IPODhan.

Tool: Playwright MCP + accessibility snapshots

Pages to audit:
1. Homepage (/)
2. Dashboard (/dashboard)
3. IPO Detail (/ipos/[slug])

For each page:
1. Navigate to page
2. Capture accessibility snapshot: mcp__playwright__browser_snapshot()
3. Check for violations:
   - Missing ARIA labels
   - Incorrect heading hierarchy
   - Missing alt text on images
   - Insufficient color contrast
   - Keyboard navigation issues
   - Focus indicators missing

4. Test keyboard navigation:
   - Tab through all interactive elements
   - Verify focus indicators visible
   - Test Enter/Space on buttons
   - Test Escape on modals

5. Document violations in defect reports
   - Create DEF-2025-XXX for each violation
   - Assign P1 or P2 priority (accessibility is important)
   - Include screenshots showing issue

Report summary:
- Total violations found
- By WCAG criterion
- By severity
- Recommendations for fixes
```

### 6. Performance Testing

```
Test application performance and measure Core Web Vitals.

Tool: Playwright MCP + Chrome DevTools

Metrics to measure:
1. LCP (Largest Contentful Paint) - Target: <2.5s
2. FID (First Input Delay) - Target: <100ms
3. CLS (Cumulative Layout Shift) - Target: <0.1
4. TTFB (Time to First Byte) - Target: <600ms

Pages to test:
1. Homepage (/)
2. Dashboard (/dashboard)
3. IPO Detail (/ipos/[slug])

For each page:
1. Clear cache
2. Navigate to page
3. Measure load time
4. Check console for performance warnings
5. Capture network waterfall
6. Document slow resources (>500ms)

Create performance report:
- LCP for each page
- Slowest API calls
- Largest bundles
- Recommendations for optimization

If any page fails targets, create P2 defect.
```

### 7. Cross-Browser Testing

```
Test IPODhan across multiple browsers.

Browsers to test:
- Chrome 120 (primary)
- Firefox 115
- Edge 119
- Safari 17 (if available)

Critical user journeys:
1. Homepage → Dashboard → IPO Detail
2. Search for IPO
3. Apply filters on Dashboard
4. View all tabs on IPO Detail
5. Navigate using mobile menu

For each browser:
1. Test all journeys
2. Capture screenshots of any visual differences
3. Document browser-specific issues
4. Note performance differences

Create matrix:
| Feature | Chrome | Firefox | Edge | Safari |
|---------|--------|---------|------|--------|
| Homepage | ✅ | ? | ? | ? |
| Dashboard | ✅ | ? | ? | ? |
...

Document any browser-specific defects with DEF-2025-XXX.
```

---

## 📋 Testing Session Template

Use this template when starting a new testing session:

```
# Testing Session [NUMBER]
Date: YYYY-MM-DD
Duration: [Estimated]
Tester: [Name]
Focus: [What you're testing]

## Pre-Session Checklist
- [ ] Dev server running (npm run dev)
- [ ] Database connected
- [ ] Redis connected
- [ ] Playwright MCP available
- [ ] Reviewed current TODO.md
- [ ] Reviewed open defects

## Session Goals
1. [Goal 1]
2. [Goal 2]
3. [Goal 3]

## Testing Approach
[Brief description of approach]

## Issues Found
(Update as you find issues)

## Blockers
(Update if you encounter blockers)

## Next Steps
(Update at end of session)

## Session Notes
(Add observations, learnings, etc.)
```

---

## 🎓 Best Practices

### Before Testing
1. ✅ Review current TODO.md for active issues
2. ✅ Check TESTING_STATUS_TRACKER.md for session history
3. ✅ Clear browser cache for fresh testing
4. ✅ Verify all services running (dev server, DB, Redis)

### During Testing
1. ✅ Use headed mode for visual verification
2. ✅ Capture screenshots liberally
3. ✅ Document findings in real-time
4. ✅ Update TODO.md as you discover issues
5. ✅ Create defect reports immediately (don't batch)

### After Testing
1. ✅ Update TESTING_STATUS_TRACKER.md with session summary
2. ✅ Move completed issues from TODO.md to CHANGELOG.md
3. ✅ Export issues to CSV (npm run export-issues)
4. ✅ Commit all documentation changes
5. ✅ Plan next session focus

---

## 📞 Quick Reference

### Documentation Links
- [TODO.md](../10-issues/TODO.md) - Daily tasks
- [BACKLOG.md](../10-issues/BACKLOG.md) - Future work
- [Status Tracker](./TESTING_STATUS_TRACKER.md) - Session history
- [Quick Start](./defect-management/QUICK_START.md) - Commands reference

### Templates
- [Defect Template](../10-issues/templates/defect-template.md)
- [Issue Template](../10-issues/templates/issue-template.md)
- [Feature Template](../10-issues/templates/feature-template.md)

### Commands
```bash
# Start testing
cd web && npm run dev

# Export issues
npm run export-issues

# Run E2E tests (when available)
npm run test:e2e

# Database studio
npm run db:studio
```

---

**Version**: 1.0
**Last Updated**: 2025-11-13
**Maintained By**: IPODhan Development Team
