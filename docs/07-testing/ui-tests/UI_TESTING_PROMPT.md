# UI Testing Execution Prompt for IPODhan

## Testing Context
You are performing comprehensive UI testing for the IPODhan application using Playwright MCP. The application is running on http://localhost:3000 and the database is accessible for validation.

## Your Mission
Execute a thorough UI testing process focusing on **critical user journeys** with **database validation** to ensure data correctness and completeness. Complete **2 full test passes** - initial discovery and verification after fixes. **Continue testing in a loop until all issues are fixed and verified.**

## Model Usage
- **Planning Phase**: Use Opus model for analysis and planning
- **Implementation Phase**: Use Sonnet model for execution and fixes

## Testing Requirements

### 1. Scope - Critical User Journeys Only
- **Homepage (/)** - Navigation, tools dropdown, featured IPOs
- **Dashboard (/dashboard)** - Filters, search, pagination, IPO cards
- **IPO Detail (/ipos/[slug])** - All tabs, complete data display
- **Lot Calculator (/tools/lot-calculator)** - Calculations, validations
- **Compare IPOs (/tools/compare)** - Multi-IPO comparison

### 2. Testing Approach
- **Phase 1**: Manual testing with Playwright MCP (headed mode, desktop viewport only)
- **Phase 2**: Document all issues found (do NOT fix immediately)
- **Phase 3**: Batch fix all documented issues
- **Phase 4**: Verification pass (2nd test cycle)
- **Phase 5**: Create automated Playwright test scripts

### 3. Data Validation Method (CRITICAL FOCUS)
- Use **snapshots only** (`browser_snapshot`) for data extraction
- **Compare against database records** for every page tested
- Verify field-by-field data accuracy and completeness
- Check for:
  - Empty/missing fields that should have data
  - Data type mismatches (strings vs numbers)
  - Incorrect formatting (dates, currency, percentages)
  - Truncated or cut-off text
  - Relationship integrity (related data consistency)
  - Counts and totals matching database aggregates

**Data Completeness means:**
- Every database field with data should appear on screen where expected
- No placeholder text like "N/A" when real data exists
- All financial metrics populated (revenue, P/E, EPS, etc.)
- All subscription data showing (QIB, NII, Retail percentages)
- All dates properly formatted and displayed
- All related entities linked (registrar, peer companies, etc.)

### 4. Issue Categories to Find
- **Functional issues** - Broken features, errors, console errors
- **UI/Visual issues** - Layout, styling, alignment problems
- **UX issues** - Usability, navigation, unclear feedback
- **Accessibility issues** - WCAG compliance, keyboard navigation
- **Data issues** - Missing, incorrect, or incomplete data

### 5. Documentation Structure
Create in `docs/07-testing/ui-tests/`:
- **TESTING_PROGRESS.md** - Master progress tracker with checkboxes
- **TESTING_SUMMARY.md** - Executive summary
- **issues/ISSUES_MASTER_LIST.md** - All issues found
- **test-results/[page-name]-test.md** - Detailed findings per page
- **automated-tests/critical-journeys.spec.ts** - Final test scripts

## Execution Instructions

### Starting Each Session

1. **Check current progress:**
```bash
# Read the progress tracker to see where we left off
cat docs/07-testing/ui-tests/TESTING_PROGRESS.md
```

2. **Open Playwright MCP browser:**
```javascript
// Navigate to application
browser_navigate(url: "http://localhost:3000")
```

3. **Continue from last checkpoint** marked in TESTING_PROGRESS.md

### For Each Page Tested

1. **Navigate to the page**
2. **Take accessibility snapshot:**
```javascript
browser_snapshot()
```

3. **Extract data from snapshot** and identify all displayed fields

4. **Query database for validation:**
```sql
-- Example for IPO Detail page
SELECT * FROM ipos WHERE slug = 'company-name-ipo';
SELECT * FROM subscriptions WHERE ipo_id = ?;
SELECT * FROM gmp_records WHERE ipo_id = ?;
-- etc. for all related tables
```

5. **Compare and document:**
- List all fields shown on screen
- List corresponding database values
- Mark any mismatches or missing data
- Note any UI/UX issues observed

6. **Update progress tracker** with checkbox for this page

### Issue Documentation Format

In `ISSUES_MASTER_LIST.md`:
```markdown
## Issue #001
**Page**: Dashboard
**Severity**: P1 (High)
**Category**: Data Issue
**Description**: IPO count shows 22 but database has 525 records
**Expected**: Display correct count from database
**Actual**: Hardcoded or filtered incorrectly
**Database Query**: SELECT COUNT(*) FROM ipos WHERE status = 'OPEN'
**Fix**: Update dashboard query to match all records
```

### Progress Tracking Format

In `TESTING_PROGRESS.md`:
```markdown
# UI Testing Progress - Session 3
**Date**: 2025-10-31
**Time**: 14:30 UTC

## Test Pass 1: Discovery
### Homepage (/)
- [x] Navigation menu works
- [x] Tools dropdown has 4 items
- [x] Featured IPOs display
- [x] Data matches database
- [ ] Footer links work

### Dashboard (/dashboard)
- [ ] Grid view displays
- [ ] Filter by status
- [ ] Filter by category
- [ ] Search works
- [ ] Pagination works
- [ ] IPO count accurate
- [ ] All cards have data

**Issues Found So Far**: 12
**Next Task**: Complete Dashboard testing
```

### Database Validation Queries

**Homepage validation:**
```sql
-- Check featured IPOs
SELECT companyName, status, openDate, closeDate, issueSize
FROM ipos
WHERE status IN ('OPEN', 'UPCOMING')
ORDER BY openDate DESC LIMIT 5;
```

**Dashboard validation:**
```sql
-- Verify displayed IPOs match filters
SELECT COUNT(*) as total FROM ipos WHERE status = ? AND category = ?;
SELECT * FROM ipos WHERE status = ? AND category = ?
ORDER BY openDate DESC LIMIT 12 OFFSET ?;
```

**IPO Detail validation:**
```sql
-- Get complete IPO data
SELECT i.*,
       s.subscriptionRetail, s.subscriptionNII, s.subscriptionQIB,
       g.estimatedGmp, g.gmpPercentage,
       f.revenue, f.profit, f.eps, f.pe,
       ls.listingGain, ls.currentPrice
FROM ipos i
LEFT JOIN subscriptions s ON i.id = s.ipoId
LEFT JOIN gmpRecords g ON i.id = g.ipoId
LEFT JOIN financialData f ON i.id = f.ipoId
LEFT JOIN listingPerformance ls ON i.id = ls.ipoId
WHERE i.slug = ?;
```

## Testing Loop Process

**The testing continues in a loop until fully complete:**

1. **Test Pass 1**: Find and document ALL issues (functional, UI, UX, accessibility, data)
2. **Fix Phase**: Batch fix all documented issues
3. **Test Pass 2**: Verify all fixes work and find any new issues
4. **If issues remain**: Fix and test again
5. **Continue loop** until Test Pass 2 shows zero P0/P1 issues

## Completion Criteria

Testing is **"fully complete without any issues"** when:
1. ✅ Two full test passes completed (initial + verification)
2. ✅ All critical user journeys tested thoroughly
3. ✅ All P0/P1 issues fixed and verified working
4. ✅ Database validation shows 100% data accuracy and completeness
5. ✅ No console errors on any tested pages
6. ✅ Automated test scripts created and passing
7. ✅ All documentation complete and accurate
8. ✅ Second test pass finds no new critical issues

## Important Notes

1. **Do NOT fix issues during Test Pass 1** - only document them (batch fix after)
2. **Use TESTING_PROGRESS.md** to maintain continuity across sessions
3. **Focus on data completeness** - every field should have appropriate data from database
4. **Compare everything against database** - don't trust UI alone, verify field-by-field
5. **Test desktop viewport only** (1920x1080) - no responsive testing needed
6. **Use snapshots ONLY, not screenshots** for faster data extraction and validation
7. **Update progress after EVERY page** to avoid losing work across context windows
8. **Testing loop continues** until 2 full passes complete with all issues fixed
9. **Cross-context continuity is critical** - always read progress file at session start

## Session Handoff

Before ending any session:
1. Update TESTING_PROGRESS.md with current status
2. Commit all documentation files
3. Note the exact test step to resume from
4. Document any blocking issues that need resolution

## Final Deliverables

1. **TESTING_SUMMARY.md** - Executive overview with metrics
2. **TESTING_PROGRESS.md** - Complete progress record
3. **Per-page test reports** - Detailed findings
4. **ISSUES_MASTER_LIST.md** - All issues with fix status
5. **critical-journeys.spec.ts** - Automated Playwright tests
6. **Database validation queries** - SQL used for verification

---

## Quick Start Commands

```bash
# Start testing
cd /d D:\Abhay\VibeCoding\IPODhan
npm run dev  # Ensure app is running

# Check previous progress
cat docs/07-testing/ui-tests/TESTING_PROGRESS.md

# Begin Playwright MCP testing
browser_navigate(url: "http://localhost:3000")
browser_snapshot()

# Query database for validation
psql -h 103.118.16.189 -U postgres -d ipodhan -c "SELECT * FROM ipos LIMIT 5;"
```

---

## Key Requirements Summary (From Planning Session)

1. **Testing Type**: Manual testing first, then create automated tests
2. **Scope**: Critical user journeys only (not all 40 pages)
3. **Fix Workflow**: Document all issues first, then batch fix (not immediate fixes)
4. **Issue Focus**: ALL types - functional, UI/visual, UX, accessibility
5. **Viewport**: Desktop only (1920x1080), no responsive testing
6. **Documentation**: Master summary + detailed page files structure
7. **Completion**: 2 full test passes (initial + verification)
8. **Data Capture**: Snapshots only (no screenshots) for speed and data extraction
9. **Validation**: Compare against database records (most rigorous approach)
10. **Continuity**: Master progress tracker file for cross-context work

**Remember**: Quality over speed. It's better to thoroughly test fewer pages than to rush through many pages superficially. **Focus on data accuracy and completeness above all else.**