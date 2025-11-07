# Admin Consolidation Testing Prompt

**Purpose**: Comprehensive testing of admin interface consolidation implementation
**Testing Tool**: Playwright MCP (headed mode)
**Approach**: Test → Fix → Retest loop until all tests pass
**Status Tracking**: Updated after each session for cross-session reference

---

## Test Execution Status

**Current Status**: 🟡 TESTING IN PROGRESS
**Last Updated**: 2025-11-07
**Session**: 1

### Overall Progress

| Category | Total Tests | Passed | Failed | Status |
|----------|-------------|--------|--------|--------|
| Phase 1: Dynamic Admin Enhancement | 12 | 0 | 0 | ⏳ Pending |
| Phase 2: Navigation & UX | 8 | 0 | 0 | ⏳ Pending |
| Phase 3: Dashboard Links | 6 | 0 | 0 | ⏳ Pending |
| Validation Rules | 10 | 0 | 0 | ⏳ Pending |
| Field Coverage | 5 | 0 | 0 | ⏳ Pending |
| **TOTAL** | **41** | **0** | **0** | ⏳ **0% Complete** |

---

## Prerequisites

Before starting tests:

1. ✅ **Development server running**: `npm run dev` (port 3000)
2. ✅ **Database seeded**: At least 3-5 test IPOs with varied data
3. ✅ **Admin access**: Login credentials available
4. ✅ **Playwright available**: MCP server ready
5. ✅ **Browser**: Chrome/Chromium for headed mode

---

## Test Suite 1: Phase 1 - Dynamic Admin Enhancement (12 Tests)

### 1.1 Field Protection UI (4 tests)

**Status**: ⏳ Not Started | **Priority**: P0 Critical

#### Test 1.1.1: Field Protection Toggle Visible
**Requirement**: Protection toggle (🔒) visible for editable fields

**Steps**:
```
1. Navigate to admin dashboard: http://localhost:3000/admin
2. Click "Edit" on first IPO
3. Verify URL: /admin/dynamic/ipos/{id}
4. Look for editable fields (e.g., lotSize, priceRangeMin)
5. Verify lock icon (🔒) visible next to each editable field
```

**Expected**:
- ✅ Lock icon present for editable fields
- ✅ Icon color: Yellow (#EAB308) by default
- ✅ Tooltip appears on hover: "Protect field from scraper"

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 1.1.2: Field Protection Toggle Functionality
**Requirement**: Clicking lock toggles field protection state

**Steps**:
```
1. Continue from Test 1.1.1
2. Click lock icon next to "lotSize" field
3. Verify field background changes to yellow (#FEF3C7)
4. Verify lock icon becomes solid/filled
5. Save changes
6. Refresh page
7. Verify field still shows as protected (yellow background)
```

**Expected**:
- ✅ Field background turns yellow when protected
- ✅ Lock icon changes visual state
- ✅ Protection persists after save and refresh

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 1.1.3: Field Protection API Integration
**Requirement**: Protection saved to `fieldProtection` table

**Steps**:
```
1. Protect "priceRangeMin" field (click lock)
2. Save changes
3. Open browser DevTools > Network tab
4. Look for POST/PUT request to protection endpoint
5. Verify request body contains:
   - tableName: "ipos"
   - fieldName: "priceRangeMin"
   - ipoId: {current IPO ID}
```

**Expected**:
- ✅ API call made to save protection
- ✅ Response status: 200 or 201
- ✅ Response confirms protection saved

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 1.1.4: Unprotect Field
**Requirement**: Clicking lock again removes protection

**Steps**:
```
1. Continue from protected field
2. Click lock icon again (unprotect)
3. Verify field background returns to white
4. Verify lock icon returns to outline/unfilled state
5. Save changes
6. Verify unprotection persists
```

**Expected**:
- ✅ Background returns to white
- ✅ Lock icon changes to unfilled
- ✅ Unprotection persists after save

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

### 1.2 DRHP Extraction Viewer (4 tests)

**Status**: ⏳ Not Started | **Priority**: P1 Important

#### Test 1.2.1: Extraction Viewer Visible on Financial Data Page
**Requirement**: DRHP extraction viewer shows on financial data edit page

**Steps**:
```
1. From IPO edit page, click "Related Data" dropdown
2. Select "Financial Data"
3. Verify URL: /admin/dynamic/financialData/{id}
4. Look for "DRHP Extraction Results" section (right side or bottom)
5. Verify section contains extraction data if available
```

**Expected**:
- ✅ "DRHP Extraction Results" section visible
- ✅ Positioned in right sidebar or below form
- ✅ Shows extraction data if PDF processed
- ✅ Shows "No extraction available" if no PDF

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 1.2.2: Copy Individual Field from Extraction
**Requirement**: Click copy icon to copy field to form

**Steps**:
```
1. Continue from Test 1.2.1 (financial data page)
2. If extraction available, find "revenueFy2024" in extraction
3. Click copy icon next to value
4. Verify value copied to "revenueFy2024" input field
5. Verify input field highlights briefly (confirmation)
```

**Expected**:
- ✅ Value copied to correct input field
- ✅ Visual confirmation (flash/highlight)
- ✅ Value formatted correctly (number format)

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 1.2.3: Copy All Fields from Extraction
**Requirement**: "Copy All" button copies all extraction fields

**Steps**:
```
1. Continue from Test 1.2.1
2. Look for "Copy All" button in extraction viewer
3. Click "Copy All"
4. Verify all extracted values populate form fields:
   - revenueFy2024, revenueFy2023, revenueFy2022
   - profitFy2024, profitFy2023, profitFy2022
   - peRatio, roe, debtToEquity, eps, netWorth
5. Verify confirmation message: "X fields copied"
```

**Expected**:
- ✅ All extraction fields copied to form
- ✅ No fields overwritten if already protected
- ✅ Confirmation message shows count
- ✅ Form marked as modified (Save button enabled)

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 1.2.4: Save After Extraction Copy
**Requirement**: Copied values save successfully

**Steps**:
```
1. Continue from Test 1.2.3 (after Copy All)
2. Click "Save" button
3. Wait for save confirmation
4. Refresh page
5. Verify all copied values persisted
```

**Expected**:
- ✅ Save successful (status 200)
- ✅ Confirmation message displayed
- ✅ Values persist after refresh
- ✅ No validation errors

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

### 1.3 Objectives Editor Route (4 tests)

**Status**: ⏳ Not Started | **Priority**: P1 Important

#### Test 1.3.1: Objectives Editor Navigation
**Requirement**: Access objectives editor from IPO edit page

**Steps**:
```
1. Navigate to IPO edit page: /admin/dynamic/ipos/{id}
2. Click "Related Data" dropdown
3. Look for "Edit Objectives" option
4. Click "Edit Objectives"
5. Verify URL: /admin/dynamic/ipos/{id}/objectives
```

**Expected**:
- ✅ "Edit Objectives" option in dropdown
- ✅ Navigates to objectives route
- ✅ IPO Context Banner visible at top
- ✅ Objectives editor component loaded

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 1.3.2: Objectives Editor UI
**Requirement**: Rich text editor for objectives

**Steps**:
```
1. Continue from Test 1.3.1 (objectives page)
2. Verify editor interface:
   - Rich text editor (not plain textarea)
   - Formatting toolbar (Bold, Italic, Bullets, etc.)
   - Character counter (max 2000)
3. Verify current objectives loaded (if exist)
```

**Expected**:
- ✅ Rich text editor visible
- ✅ Toolbar with formatting options
- ✅ Character counter displayed
- ✅ Existing objectives pre-loaded

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 1.3.3: Edit and Save Objectives
**Requirement**: Edit objectives and save changes

**Steps**:
```
1. Continue from Test 1.3.2
2. Clear existing text
3. Type new objectives:
   "• Debt repayment (₹500 crores)
    • Working capital expansion
    • R&D investment"
4. Apply bold formatting to amounts
5. Click "Save" button
6. Wait for save confirmation
```

**Expected**:
- ✅ Text edits reflect in editor
- ✅ Formatting applied (bold works)
- ✅ Save successful
- ✅ Confirmation message displayed

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 1.3.4: Objectives Persistence
**Requirement**: Saved objectives persist

**Steps**:
```
1. Continue from Test 1.3.3 (after save)
2. Navigate away: click breadcrumb to IPO list
3. Return to same IPO: click Edit
4. Navigate back to objectives: Related Data > Edit Objectives
5. Verify saved objectives displayed with formatting
```

**Expected**:
- ✅ Saved text persists
- ✅ Formatting preserved (bold, bullets)
- ✅ Character count accurate
- ✅ No data loss

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

## Test Suite 2: Phase 2 - Navigation & UX (8 Tests)

### 2.1 IPO Context Banner (3 tests)

**Status**: ⏳ Not Started | **Priority**: P0 Critical

#### Test 2.1.1: Context Banner Visible
**Requirement**: Blue banner shows company info on all dynamic admin pages

**Steps**:
```
1. Navigate to IPO edit page: /admin/dynamic/ipos/{id}
2. Verify blue banner at top of page
3. Verify banner contains:
   - Company name
   - IPO status badge (UPCOMING/OPEN/CLOSED/LISTED)
   - Related Data dropdown
4. Navigate to financial data page
5. Verify same banner present
```

**Expected**:
- ✅ Banner visible on all dynamic admin pages
- ✅ Background color: Blue (#3B82F6 or similar)
- ✅ Company name displayed
- ✅ Status badge with correct color
- ✅ Banner consistent across all related pages

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 2.1.2: Status Badge Colors
**Requirement**: Status badges use correct colors

**Steps**:
```
1. Find IPO with status "OPEN"
2. Navigate to edit page
3. Verify status badge color: Green or Blue
4. Find IPO with status "CLOSED"
5. Verify status badge color: Gray
6. Find IPO with status "LISTED"
7. Verify status badge color: Green
```

**Expected**:
- ✅ UPCOMING: Yellow/Orange (#F59E0B)
- ✅ OPEN: Green/Blue (#10B981 or #3B82F6)
- ✅ CLOSED: Gray (#6B7280)
- ✅ LISTED: Green (#10B981)

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 2.1.3: Related Data Dropdown
**Requirement**: Dropdown shows all related tables

**Steps**:
```
1. Continue from IPO edit page
2. Click "Related Data" dropdown in context banner
3. Verify dropdown shows all options:
   - Financial Data
   - Subscriptions
   - GMP Records
   - Documents
   - Listing Performance
   - Anchor Investors
   - Reviews
   - Peer Companies
   - Edit Objectives
4. Click "Financial Data"
5. Verify navigation to /admin/dynamic/financialData/{id}
```

**Expected**:
- ✅ Dropdown shows all 9 options
- ✅ Options alphabetically sorted (or logical order)
- ✅ Clicking option navigates to correct page
- ✅ Dropdown closes after selection

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

### 2.2 Breadcrumb Navigation (3 tests)

**Status**: ⏳ Not Started | **Priority**: P1 Important

#### Test 2.2.1: Breadcrumb Structure
**Requirement**: Breadcrumbs show path: Admin > Table > Record

**Steps**:
```
1. Navigate to admin dashboard: /admin
2. Click Edit on any IPO
3. Verify breadcrumbs at top:
   "Admin > IPOs > {Company Name}"
4. Navigate to financial data
5. Verify breadcrumbs update:
   "Admin > IPOs > {Company Name} > Financial Data"
```

**Expected**:
- ✅ Breadcrumbs visible below header
- ✅ Format: Admin > IPOs > {Company} > [Table]
- ✅ Company name shown (not ID)
- ✅ Current page in breadcrumb trail

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 2.2.2: Breadcrumb Click Navigation
**Requirement**: Clicking breadcrumb navigates back

**Steps**:
```
1. Continue from Test 2.2.1 (on financial data page)
2. Click "Admin" in breadcrumbs
3. Verify navigation to /admin (dashboard)
4. Navigate back to IPO edit > financial data
5. Click "{Company Name}" in breadcrumbs
6. Verify navigation to /admin/dynamic/ipos/{id}
```

**Expected**:
- ✅ "Admin" click → dashboard
- ✅ "IPOs" click → IPO list or back
- ✅ Company name click → IPO edit page
- ✅ Current page not clickable

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 2.2.3: Breadcrumb Consistency
**Requirement**: Breadcrumbs consistent across all pages

**Steps**:
```
1. Visit multiple related pages:
   - IPO edit
   - Financial data
   - Subscriptions
   - GMP records
   - Objectives editor
2. Verify breadcrumbs present on all pages
3. Verify company name consistent
4. Verify navigation works from all pages
```

**Expected**:
- ✅ Breadcrumbs on all dynamic admin pages
- ✅ Consistent styling and format
- ✅ Navigation works from any page
- ✅ No missing breadcrumbs

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

### 2.3 Related Data Quick Links (2 tests)

**Status**: ⏳ Not Started | **Priority**: P2 Nice-to-have

#### Test 2.3.1: Quick Links in Sidebar
**Requirement**: Related data links in sidebar or card

**Steps**:
```
1. Navigate to IPO edit page
2. Look for "Related Data" section (sidebar or card)
3. Verify quick links displayed:
   - Financial Data (with icon)
   - Subscriptions (with icon)
   - GMP Records (with icon)
   - Documents (with icon)
4. Click "Financial Data" link
5. Verify navigation
```

**Expected**:
- ✅ Related data section visible
- ✅ All related tables linked
- ✅ Icons or badges next to links
- ✅ Hover state on links
- ✅ Clicking navigates correctly

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 2.3.2: Record Count Badges
**Requirement**: Show count of related records

**Steps**:
```
1. Continue from IPO edit page
2. Look for record count badges next to links:
   - Subscriptions (3) <- example
   - GMP Records (5) <- example
   - Documents (2) <- example
3. Verify counts match actual data
```

**Expected**:
- ✅ Count badges visible
- ✅ Counts accurate
- ✅ Badge styling: rounded, gray background
- ✅ Zero counts shown as (0)

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

## Test Suite 3: Phase 3 - Dashboard Links (6 Tests)

**Status**: ⏳ Not Started | **Priority**: P0 Critical

### 3.1 Primary Edit Button (2 tests)

#### Test 3.1.1: Edit Button Links to Dynamic Admin
**Requirement**: Primary "Edit" button goes to Dynamic Admin

**Steps**:
```
1. Navigate to admin dashboard: /admin
2. Locate first IPO in list
3. Look for "Edit" button (primary, blue)
4. Click "Edit"
5. Verify URL: /admin/dynamic/ipos/{id}
6. Verify NOT: /admin/edit/{slug}
```

**Expected**:
- ✅ "Edit" button visible
- ✅ Button color: Blue (#3B82F6)
- ✅ Navigates to /admin/dynamic/ipos/{id}
- ✅ NOT /admin/edit/{slug}

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 3.1.2: Edit Button Styling
**Requirement**: Primary button stands out

**Steps**:
```
1. Continue from dashboard
2. Verify "Edit" button styling:
   - Background: Blue
   - Text: White
   - Size: Medium/Large
   - Hover effect: Darker blue
3. Compare to legacy link (should be less prominent)
```

**Expected**:
- ✅ Button clearly primary action
- ✅ Color contrast meets accessibility
- ✅ Hover state visible
- ✅ Focus state for keyboard nav

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

### 3.2 Legacy Link (2 tests)

#### Test 3.2.1: Legacy Link Present
**Requirement**: Legacy link to Traditional Admin during transition

**Steps**:
```
1. Continue from dashboard
2. Look for "(Legacy)" link next to "Edit" button
3. Verify styling:
   - Color: Gray (#6B7280)
   - Size: Small (xs or sm)
   - Text: "(Legacy)"
4. Hover over link, verify tooltip (if present)
```

**Expected**:
- ✅ "(Legacy)" link visible
- ✅ Styled less prominently than Edit button
- ✅ Gray color
- ✅ Smaller font size
- ✅ Optional tooltip explaining transition

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 3.2.2: Legacy Link Navigation
**Requirement**: Legacy link goes to Traditional Admin

**Steps**:
```
1. Continue from dashboard
2. Click "(Legacy)" link
3. Verify URL: /admin/edit/{slug}
4. Verify Traditional Admin page loads
5. Verify yellow migration banner visible
```

**Expected**:
- ✅ Navigates to /admin/edit/{slug}
- ✅ Traditional Admin loads
- ✅ Yellow migration banner present
- ✅ Link to Dynamic Admin in banner

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

### 3.3 Info Banner (2 tests)

#### Test 3.3.1: Dashboard Info Banner
**Requirement**: Blue info banner at top of dashboard

**Steps**:
```
1. Navigate to admin dashboard: /admin
2. Look for blue info banner at very top
3. Verify banner message mentions:
   - Admin interface consolidation
   - Dynamic Admin is now primary
   - Legacy link available during transition
4. Verify close button (X) present
```

**Expected**:
- ✅ Banner visible at top
- ✅ Background: Blue (#DBEAFE or #EFF6FF)
- ✅ Message clear and concise
- ✅ Close button functional
- ✅ Banner dismissible (stays dismissed in session)

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 3.3.2: Migration Banner in Traditional Admin
**Requirement**: Yellow warning banner in Traditional Admin

**Steps**:
```
1. Navigate to Traditional Admin: /admin/edit/{slug}
2. Verify yellow banner at top
3. Verify banner message:
   - "This interface is being phased out"
   - Link to Dynamic Admin
   - Explanation of transition
4. Click link to Dynamic Admin
5. Verify navigation works
```

**Expected**:
- ✅ Yellow banner visible (#FEF3C7 or #FDE68A)
- ✅ Warning message clear
- ✅ Link to Dynamic Admin present
- ✅ Link navigates to correct IPO in Dynamic Admin
- ✅ Banner not dismissible (always shows)

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

## Test Suite 4: Validation Rules (10 Tests)

**Status**: ⏳ Not Started | **Priority**: P0 Critical

### 4.1 IPO Field Validations (4 tests)

#### Test 4.1.1: Lot Size Validation
**Requirement**: Lot size must be positive integer

**Steps**:
```
1. Navigate to IPO edit page
2. Find "lotSize" field
3. Test invalid values:
   a. Enter 0 → should show error
   b. Enter -5 → should show error
   c. Enter 10.5 → should show error (decimals not allowed)
4. Test valid value:
   a. Enter 100 → should accept
5. Verify error messages clear and helpful
```

**Expected**:
- ❌ lotSize = 0: Error "Lot size must be at least 1 share"
- ❌ lotSize = -5: Error "Lot size must be at least 1 share"
- ❌ lotSize = 10.5: Error "Lot size must be a whole number"
- ✅ lotSize = 100: Accepted
- ✅ Warning if lotSize = 1: "Lot size of 1 is unusual"

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 4.1.2: Price Range Validation
**Requirement**: priceRangeMin <= priceRangeMax

**Steps**:
```
1. Continue from IPO edit page
2. Test invalid scenarios:
   a. priceRangeMin = 500, priceRangeMax = 400 → error
   b. priceRangeMin = -100 → error
   c. priceRangeMax = 0 → error
3. Test valid scenario:
   a. priceRangeMin = 300, priceRangeMax = 400 → accept
4. Verify cross-field validation works
```

**Expected**:
- ❌ min > max: Error "Price minimum cannot exceed maximum"
- ❌ Negative values: Error "Price must be greater than ₹0"
- ✅ min <= max: Accepted
- ✅ Real-time validation (updates as you type)

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 4.1.3: Issue Size Validation
**Requirement**: Issue size must be positive

**Steps**:
```
1. Continue from IPO edit page
2. Find "issueSize" field
3. Test invalid values:
   a. Enter 0 → error
   b. Enter -1000 → error
4. Test edge cases:
   a. Enter 5 → warning (below ₹10 crores)
   b. Enter 150000 → warning (exceeds ₹1 lakh crores)
5. Test valid value:
   a. Enter 1000 → accept
```

**Expected**:
- ❌ issueSize <= 0: Error "Issue size must be greater than ₹0 crores"
- ⚠️ issueSize < 10: Warning "Issue size below ₹10 crores is unusually small"
- ⚠️ issueSize > 100000: Warning "Issue size exceeds ₹1 lakh crores"
- ✅ issueSize = 1000: Accepted

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 4.1.4: Date Range Validation
**Requirement**: openDate < closeDate

**Steps**:
```
1. Continue from IPO edit page
2. Test invalid scenarios:
   a. openDate = 2025-01-10, closeDate = 2025-01-05 → error
   b. openDate = closeDate → error
3. Test valid scenario:
   a. openDate = 2025-01-01, closeDate = 2025-01-10 → accept
4. Verify cross-field validation
```

**Expected**:
- ❌ openDate >= closeDate: Error "Open date must be before close date"
- ✅ openDate < closeDate: Accepted
- ✅ Error shows on correct field

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

### 4.2 Financial Data Validations (3 tests)

#### Test 4.2.1: P/E Ratio Validation
**Requirement**: P/E ratio 0-1000 range

**Steps**:
```
1. Navigate to financial data page
2. Find "peRatio" field
3. Test invalid values:
   a. Enter -5 → error
   b. Enter 1500 → error
4. Test edge case:
   a. Enter 600 → warning (unusually high)
5. Test valid:
   a. Enter 25 → accept
```

**Expected**:
- ❌ peRatio < 0: Error "P/E ratio cannot be negative"
- ❌ peRatio > 1000: Error "P/E ratio exceeds 1000 (maximum allowed)"
- ⚠️ peRatio > 500: Warning "P/E ratio exceeds 500. Unusually high"
- ✅ peRatio = 25: Accepted

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 4.2.2: ROE Validation
**Requirement**: ROE -100% to 100% range

**Steps**:
```
1. Continue from financial data page
2. Find "roe" field
3. Test invalid values:
   a. Enter -150 → error
   b. Enter 150 → error
4. Test edge case:
   a. Enter -60 → warning (very negative)
5. Test valid:
   a. Enter 15 → accept
   b. Enter -10 → accept (loss is valid)
```

**Expected**:
- ❌ roe < -100: Error "ROE cannot be less than -100%"
- ❌ roe > 100: Error "ROE cannot exceed 100%"
- ⚠️ roe < -50: Warning "Negative ROE below -50% is concerning"
- ✅ roe = 15: Accepted
- ✅ roe = -10: Accepted (losses allowed)

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 4.2.3: Net Worth Validation
**Requirement**: Net worth must be positive for IPO eligibility

**Steps**:
```
1. Continue from financial data page
2. Find "netWorth" field
3. Test invalid values:
   a. Enter 0 → error
   b. Enter -5000 → error
4. Test valid:
   a. Enter 10000 → accept
```

**Expected**:
- ❌ netWorth <= 0: Error "Net worth must be positive for IPO listing eligibility"
- ✅ netWorth > 0: Accepted

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

### 4.3 Subscription Validations (1 test)

#### Test 4.3.1: Subscription Values Non-Negative
**Requirement**: All subscription values >= 0

**Steps**:
```
1. Navigate to subscriptions page
2. Test fields:
   - totalSubscription
   - qibSubscription
   - niiSubscription
   - retailSubscription
3. Enter -1 in each → verify error
4. Enter 0 in each → verify accepted
5. Enter 5.5 in each → verify accepted
```

**Expected**:
- ❌ value < 0: Error "[Category] subscription cannot be negative"
- ✅ value = 0: Accepted
- ✅ value >= 0: Accepted

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

### 4.4 GMP Validations (2 tests)

#### Test 4.4.1: GMP Price Validation
**Requirement**: GMP price >= 0

**Steps**:
```
1. Navigate to GMP records page
2. Find "gmpPrice" field
3. Test invalid:
   a. Enter -50 → error
4. Test warning:
   a. Enter 15000 → warning (very high)
5. Test valid:
   a. Enter 150 → accept
```

**Expected**:
- ❌ gmpPrice < 0: Error "GMP price cannot be negative"
- ⚠️ gmpPrice > 10000: Warning "GMP price exceeds ₹10,000"
- ✅ gmpPrice >= 0: Accepted

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 4.4.2: GMP Percentage Validation
**Requirement**: GMP percentage -100% to 1000% range

**Steps**:
```
1. Continue from GMP records page
2. Find "gmpPercentage" field
3. Test invalid:
   a. Enter -150 → error
4. Test warning:
   a. Enter 1500 → warning (extremely high)
5. Test valid:
   a. Enter 50 → accept
   b. Enter -50 → accept (negative GMP valid)
```

**Expected**:
- ❌ gmpPercentage < -100: Error "GMP percentage cannot be less than -100% (complete loss)"
- ⚠️ gmpPercentage > 1000: Warning "GMP percentage exceeds 1000%. Extremely rare"
- ✅ -100 <= gmpPercentage <= 1000: Accepted

**Actual**: _[To be filled during testing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

## Test Suite 5: Field Coverage (5 Tests)

**Status**: ⏳ Not Started | **Priority**: P1 Important

### 5.1 100% Field Coverage Verification

#### Test 5.1.1: IPOs Table Field Coverage
**Requirement**: All IPO table fields accessible

**Steps**:
```
1. Navigate to IPO edit page
2. Open database schema: packages/shared/src/db/schema.ts
3. Find "ipos" table definition
4. Count total fields in schema
5. Verify all fields present in Dynamic Admin form
6. Check for missing fields
```

**Expected**:
- ✅ All schema fields visible in form
- ✅ System fields read-only (id, createdAt, updatedAt)
- ✅ Business fields editable
- ✅ No missing fields

**Actual**: _[To be filled during testing]_

**Schema Field Count**: _[To be filled]_
**Form Field Count**: _[To be filled]_
**Missing Fields**: _[List any missing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 5.1.2: Financial Data Field Coverage
**Requirement**: All financial data fields accessible

**Steps**:
```
1. Navigate to financial data page
2. Check schema: packages/shared/src/db/schema.ts
3. Find "financialData" table
4. Verify all fields present:
   - Revenue fields (FY2022, FY2023, FY2024)
   - Profit fields (FY2022, FY2023, FY2024)
   - Ratios (peRatio, roe, debtToEquity)
   - Other metrics (eps, netWorth, marketCap)
5. Count fields in schema vs form
```

**Expected**:
- ✅ All financial fields accessible
- ✅ Fields grouped logically (revenues, profits, ratios)
- ✅ No missing fields

**Actual**: _[To be filled during testing]_

**Schema Field Count**: _[To be filled]_
**Form Field Count**: _[To be filled]_
**Missing Fields**: _[List any missing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 5.1.3: Subscriptions Field Coverage
**Requirement**: All subscription fields accessible

**Steps**:
```
1. Navigate to subscriptions page
2. Check schema for "subscriptions" table
3. Verify all fields present:
   - Category subscriptions (QIB, NII, Retail, Employee)
   - Sub-categories (if any)
   - Totals (totalApplications, totalSharesBid, sharesOffered)
4. Verify field count matches
```

**Expected**:
- ✅ All subscription fields accessible
- ✅ Including sub-category fields (15+ fields)
- ✅ No missing fields

**Actual**: _[To be filled during testing]_

**Schema Field Count**: _[To be filled]_
**Form Field Count**: _[To be filled]_
**Missing Fields**: _[List any missing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 5.1.4: GMP Records Field Coverage
**Requirement**: All GMP fields accessible

**Steps**:
```
1. Navigate to GMP records page
2. Check schema for "gmpRecords" table
3. Verify all fields present:
   - gmpPrice
   - gmpPercentage
   - estimatedListingPrice
   - subject
   - source
   - recordedAt
4. Verify field count matches
```

**Expected**:
- ✅ All GMP fields accessible
- ✅ Date/time fields formatted correctly
- ✅ No missing fields

**Actual**: _[To be filled during testing]_

**Schema Field Count**: _[To be filled]_
**Form Field Count**: _[To be filled]_
**Missing Fields**: _[List any missing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

#### Test 5.1.5: Documents Field Coverage
**Requirement**: All document fields accessible

**Steps**:
```
1. Navigate to documents page
2. Check schema for "documents" table
3. Verify all fields present:
   - title
   - url
   - type
   - uploadedAt
4. Verify CRUD operations available
```

**Expected**:
- ✅ All document fields accessible
- ✅ Add new document button present
- ✅ Edit/delete operations available
- ✅ File upload or URL input functional

**Actual**: _[To be filled during testing]_

**Schema Field Count**: _[To be filled]_
**Form Field Count**: _[To be filled]_
**Missing Fields**: _[List any missing]_

**Status**: ⏳ Not Tested
**Issue ID**: _[If failed]_

---

## Issue Tracking

### Issues Found During Testing

| Issue ID | Test ID | Severity | Description | Status | Fixed In |
|----------|---------|----------|-------------|--------|----------|
| _[To be filled]_ | _[To be filled]_ | _[To be filled]_ | _[To be filled]_ | _[To be filled]_ | _[To be filled]_ |

**Severity Levels**:
- P0 Critical: Blocker, must fix immediately
- P1 Important: Should fix before completion
- P2 Nice-to-have: Can defer to future sprint

---

## Test Execution Instructions

### Prerequisites Check

Before starting, verify:
```bash
# 1. Start development server
cd web
npm run dev

# 2. Verify server running
curl http://localhost:3000/admin

# 3. Check database has test data
psql -d ipodhan -c "SELECT COUNT(*) FROM ipos;"
```

### Running Tests with Playwright MCP

**Setup**:
1. Open Claude Code with MCP enabled
2. Ensure Playwright MCP server configured
3. Set browser to headed mode (see browser UI)

**Test Execution Loop**:
```
For each test:
  1. Run test steps using Playwright MCP
  2. If test passes:
     - Mark status: ✅ Passed
     - Update progress table
     - Move to next test
  3. If test fails:
     - Mark status: ❌ Failed
     - Create issue ID
     - Document actual vs expected
     - Investigate root cause
     - Fix issue
     - Re-run test
     - Repeat until pass
  4. Update this document after each test
  5. Commit changes with message: "test: [Test ID] - [Pass/Fail]"
```

**Playwright MCP Commands**:
```typescript
// Navigate to page
mcp__playwright__browser_navigate({ url: "http://localhost:3000/admin" })

// Take snapshot (accessibility tree)
mcp__playwright__browser_snapshot()

// Click element
mcp__playwright__browser_click({ element: "Edit button", ref: "[ref]" })

// Type text
mcp__playwright__browser_type({ element: "lotSize input", ref: "[ref]", text: "100" })

// Take screenshot
mcp__playwright__browser_take_screenshot({ filename: "test-1.1.1.png" })
```

### Session Management

**At Start of Session**:
1. Review "Test Execution Status" section
2. Note last completed test
3. Continue from next pending test

**During Session**:
1. Update test statuses in real-time
2. Document issues immediately
3. Take screenshots for failures
4. Keep "Overall Progress" table current

**At End of Session**:
1. Update "Last Updated" timestamp
2. Increment "Session" number
3. Save document
4. Commit with message: "test: Session X complete - Y/41 tests passed"

---

## Success Criteria

**Test Suite Complete When**:
- ✅ All 41 tests executed
- ✅ All tests passing (green)
- ✅ All P0/P1 issues fixed
- ✅ Documentation updated
- ✅ Screenshots captured for key features
- ✅ Overall progress: 100%

**Quality Gate**:
- Pass rate: >= 95% (40/41 tests)
- P0 issues: 0
- P1 issues: <= 2 (documented as acceptable)

---

## Notes for Testers

### Best Practices

1. **Use Headed Mode**: Always run Playwright in headed mode to see what's happening
2. **Take Screenshots**: Capture before/after states for visual comparison
3. **Clear Cache**: Clear browser cache between test suites to avoid state issues
4. **Fresh Data**: Use fresh test data for each run (re-seed if needed)
5. **Document Clearly**: Write detailed "Actual" results for failures

### Common Issues

1. **Element not found**: Update selector/ref if UI changed
2. **Timing issues**: Add waits for dynamic content
3. **State dependencies**: Reset state between tests
4. **Browser caching**: Clear cache if seeing stale data

### Tips

- Test in order (Suite 1 → 2 → 3 → 4 → 5)
- Fix P0 issues before continuing
- Re-test fixed issues immediately
- Update progress table frequently
- Commit often (per test or small groups)

---

**Document Version**: 1.0
**Last Updated**: 2025-11-07
**Total Tests**: 41
**Status**: Ready for execution ⏳

---

## Quick Links

- **Consolidation Plan**: `docs/00-admin/Plan - Consolidate Admin Interface to Eliminate Duplicate Fields.md`
- **Phase 4 Plan**: `docs/00-admin/Phase 4 - Traditional Admin Removal Plan.md`
- **Admin User Guide**: `docs/admin-user-guide.md`
- **Validation Rules**: `web/lib/admin/dynamic-validation-rules.ts`
- **Validation Tests**: `web/tests/unit/lib/admin/dynamic-validation-rules.test.ts`

---

**End of Testing Prompt**

🎯 Ready to start testing? Begin with Test Suite 1, Test 1.1.1!
