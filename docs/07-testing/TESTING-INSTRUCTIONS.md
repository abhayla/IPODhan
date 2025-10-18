# Comprehensive Testing Instructions with Playwright MCP

## Overview
This document provides step-by-step instructions for performing comprehensive UI/UX testing of the IPODhan application using Playwright MCP in headed mode (browser stays open).

---

## How to Perform Comprehensive Testing

### Step 1: Setup
The browser is already open and navigated to the dashboard. You can follow these instructions to test each screen systematically.

### Step 2: Testing Approach

I recommend using **Playwright MCP** to:
1. **Navigate through all pages** - Visit each of the 15 screens
2. **Take full-page screenshots** - Visual documentation
3. **Test interactive elements** - Click buttons, fill forms, toggle views
4. **Test filters and search** - Verify functionality
5. **Test responsive layouts** - Resize browser to different viewports
6. **Document issues** - Track bugs and UI/UX problems

---

## Quick Testing Script

You can ask me to run this comprehensive test by saying:

**"Run comprehensive tests on all screens"**

This will automatically:
- Visit all 15 pages
- Test interactive elements on each page
- Take screenshots of each page
- Test responsive layouts (mobile, tablet, desktop)
- Document all findings in `test-results.md`
- Create a bug list with severity ratings

---

## Manual Testing Steps (If you want to test yourself)

### Testing Each Screen:

#### 1. **Home Page** (/):
```
Commands to run:
- Navigate to "http://localhost:3000"
- Take screenshot "home-full.png"
- Click "Tools" button
- Take screenshot "home-tools-dropdown.png"
- Click "Browse IPOs" button
- Verify navigation to dashboard
```

#### 2. **Dashboard** (/dashboard):
```
Commands to run:
- Take screenshot "dashboard-default.png"
- Click "List view" button
- Take screenshot "dashboard-list-view.png"
- Test search: Type "BHAIRAV" in search box
- Take screenshot "dashboard-search.png"
- Click Status filter, select "Upcoming"
- Take screenshot "dashboard-upcoming.png"
- Click Category filter, select "SME"
- Take screenshot "dashboard-sme.png"
- Click "Clear Filters" button
- Click "Next" page button
- Take screenshot "dashboard-page-2.png"
```

#### 3. **IPO Detail Page** (/ipos/[slug]):
```
Commands to run:
- Click on first IPO card
- Take screenshot "ipo-detail-overview.png"
- Test tabs if present
- Take screenshot for each tab
- Test "Apply" buttons
- Test "Back" navigation
```

#### 4. **Lot Calculator** (/tools/lot-calculator):
```
Commands to run:
- Navigate to "/tools/lot-calculator"
- Take screenshot "lot-calculator-empty.png"
- Select an IPO from dropdown
- Enter amount "10000"
- Click "Calculate"
- Take screenshot "lot-calculator-result.png"
- Test with invalid input (negative number)
- Take screenshot "lot-calculator-error.png"
```

#### 5. **Compare IPOs** (/tools/compare):
```
Commands to run:
- Navigate to "/tools/compare"
- Take screenshot "compare-empty.png"
- Select IPO 1
- Select IPO 2
- Take screenshot "compare-2-ipos.png"
- Select IPO 3
- Take screenshot "compare-3-ipos.png"
- Click "Clear"
```

#### 6. **Market Holidays** (/market-holidays):
```
Commands to run:
- Navigate to "/market-holidays"
- Take screenshot "market-holidays.png"
- Test year filter if present
- Test search if present
```

#### 7. **Registrars** (/registrars):
```
Commands to run:
- Navigate to "/registrars"
- Take screenshot "registrars.png"
- Test search if present
- Click on a registrar for details
```

#### 8. **History** (/history):
```
Commands to run:
- Navigate to "/history"
- Take screenshot "history.png"
- Test filters
- Test sorting
- Test pagination
```

#### 9-14. **Other Pages** (About, Affiliates, Resources, Privacy, Terms, Disclaimer):
```
For each page:
- Navigate to the page
- Take full-page screenshot
- Test all links
- Check for broken images
- Verify content display
```

#### 15. **Responsive Testing**:
```
For each important screen (Home, Dashboard, IPO Detail, Tools):
- Resize to 375x667 (Mobile)
- Take screenshot "[page]-mobile.png"
- Resize to 768x1024 (Tablet)
- Take screenshot "[page]-tablet.png"
- Resize to 1920x1080 (Desktop)
- Take screenshot "[page]-desktop.png"
```

---

## Automated Testing Commands

### To run comprehensive automated testing, tell me:

1. **"Test all screens automatically"** - I'll visit and test all 15 screens
2. **"Test dashboard functionality"** - Deep dive into dashboard features
3. **"Test all tools pages"** - Test calculator and compare tools
4. **"Test responsive design"** - Test all major screens on 3 viewports
5. **"Generate final test report"** - Create summary with all issues

---

## What I'll Document

For each screen tested, I document:

✅ **Working Features**
- What works correctly
- UI/UX that meets expectations

❌ **Bugs Found**
- Critical: Breaks functionality
- High: Major UX issues
- Medium: Minor UX issues
- Low: Cosmetic issues

⚠️ **Warnings**
- Potential issues
- Accessibility concerns
- Performance concerns

💡 **Suggestions**
- UX improvements
- UI enhancements
- Feature additions

---

## Current Testing Progress

### ✅ Completed:
1. Home page - Basic navigation tested
2. Dashboard - Partial testing (found bug with view toggle)

### 🔄 In Progress:
- Dashboard detailed testing

### ⏳ Pending:
- 13 more screens to test
- Responsive testing
- Final report generation

---

## Test Results Location

All test results are being documented in:
- **`test-results.md`** - Detailed test results with issues
- **`comprehensive-testing-guide.md`** - Testing methodology
- **`.playwright-mcp/`** - All screenshots

---

## How to Continue

**Option 1: Full Automated Testing**
Say: **"Continue comprehensive testing automatically"**

This will:
- Complete dashboard testing
- Move through all remaining screens
- Test responsive layouts
- Generate final report
- Estimated time: 15-20 minutes

**Option 2: Targeted Testing**
Say: **"Test [specific feature]"**
Examples:
- "Test dashboard filters"
- "Test lot calculator with various inputs"
- "Test all navigation links"
- "Test mobile responsiveness"

**Option 3: Fix Issues First**
Say: **"Show me the issues found so far"**
Then we can fix bugs before continuing testing.

---

## Best Practices for Testing

1. **Keep browser open** - Don't close until all testing is done
2. **Test systematically** - Follow the screen order
3. **Document everything** - Screenshots + descriptions
4. **Test edge cases** - Invalid inputs, empty states
5. **Test user flows** - Complete workflows (search → click → view)
6. **Check responsive** - Mobile users are important
7. **Verify links** - All external and internal links work

---

## Next Steps

**Ready to continue? Choose one:**

1. 🚀 **"Run full automated testing"** - I'll test everything
2. 🎯 **"Test [specific page/feature]"** - Focused testing
3. 🐛 **"Show current issues"** - Review bugs found
4. 📊 **"Generate test report"** - Summary of current progress

