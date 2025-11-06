# Comprehensive Admin Testing Plan - Hyundai Motor India IPO

**Project**: IPODhan Admin System Enhancement (Phase 6 - Week 3)
**Test Target**: Complete regression testing of all admin features
**Test IPO**: Hyundai Motor India (`hyundai-motor-india-ipo`)
**Testing Method**: Playwright MCP in headed mode (visible browser)
**Date Created**: November 5, 2025
**Status**: Ready for Execution

---

## Executive Summary

### Objective
Perform comprehensive regression testing of the entire IPODhan admin system to validate:
1. Traditional IPO edit page (9 tabs)
2. Self-extending dynamic admin (17 tables)
3. DRHP extraction UI (3 tabs)
4. NEW: Extraction integration with edit page (Week 3 Task 1)

### Scope
- **Test Scenarios**: 12 comprehensive tests
- **Test IPO**: Hyundai Motor India (single IPO, full coverage)
- **Test Data**: Use existing database data only (no test data creation)
- **Browser**: Chromium (Playwright MCP, headed mode)
- **Documentation**: ~2000+ line comprehensive report with screenshots

### Approach
1. **Phase 1**: Setup (5 min) - Clean environment, start server
2. **Phase 2**: Execute 12 tests (60-90 min) - Full regression
3. **Phase 3**: Document issues (30 min) - Log all findings
4. **Phase 4**: Batch fix (2-4 hours) - Fix by priority
5. **Phase 5**: Re-test loop (30-60 min per iteration) - Until clean
6. **Phase 6**: Final documentation (1 hour) - Comprehensive report

### Success Criteria
- ✅ All 12 tests PASS
- ✅ Zero Critical/High issues
- ✅ Performance targets met (API < 500ms, page load < 2.5s)
- ✅ Comprehensive report completed
- ✅ Ready for Task 2 (Bulk PDF Upload)

---

## Test Environment

### Technical Stack
- **Frontend**: Next.js 15.5.4, React 19.1.0, TypeScript 5
- **Database**: PostgreSQL 16 with Drizzle ORM 0.44.6
- **Cache**: Redis 7.2+ with ioredis 5.8.0
- **Testing**: Playwright MCP (Chromium, headed mode)
- **Server**: http://localhost:3000 (development)

### Database Schema (17 Tables)
1. `ipos` - Core IPO entities
2. `subscriptions` - Time-series subscription data
3. `gmpRecords` - GMP tracking
4. `financialData` - Financial metrics
5. `documents` - IPO documents
6. `listingPerformance` - Post-listing data
7. `marketHolidays` - Trading holidays
8. `registrars` - Registrar information
9. `peerCompanies` - Peer comparison
10. `brokerAffiliates` - Affiliate links
11. `affiliateClicks` - Click tracking
12. `scraperLogs` - Scraper monitoring
13. `ipoReviews` - Analyst reviews
14. **`extractionLogs`** - DRHP extraction history (NEW - Week 1) ⭐
15. **`fieldProtectionMetadata`** - Field protection (with isPermanent flag - NEW) ⭐
16. `protectedFields` - Protected field records
17. `auditLogs` - System audit trail

### Admin Features (95% Complete)
1. **Traditional Edit Page** (`/admin/edit/[slug]`) - 9 tabs, 1,872 lines
2. **Self-Extending Admin** (`/admin/dynamic/[table]/list`) - 450+ fields, 17 tables
3. **DRHP Extraction UI** (`/admin/drhp-extraction`) - 3 tabs, 900 lines
4. **Extraction Integration** - NEW (Week 3 Task 1) - Financials tab integration

---

## Phase 1: Pre-Testing Setup (5 minutes)

### Objectives
- Clean server environment
- Start fresh Next.js dev server
- Verify server responsiveness
- Confirm test data availability

### Steps

#### 1.1 Server Environment Cleanup
```bash
# Kill all Node.js processes
taskkill /F /IM node.exe /T

# Remove Next.js dev lock file
cd web
rm -f .next/dev/lock

# Clean npm cache (if needed)
npm cache clean --force
```

**Expected Result**: Clean environment, no running processes

---

#### 1.2 Start Development Server
```bash
cd web
npm run dev
```

**Wait for**: `✓ Ready in XXXms` message

**Expected Output**:
```
▲ Next.js 16.0.1 (Turbopack)
- Local:        http://localhost:3000
- Network:      http://192.168.1.7:3000
✓ Ready in ~1500ms
```

---

#### 1.3 Verify Server Health
```bash
# Test basic connectivity
curl http://localhost:3000/api/health

# Verify admin login page
curl http://localhost:3000/admin/login
```

**Expected**: HTTP 200 responses

---

#### 1.4 Test Data Verification

**Query Database** (optional, for reference):
```sql
-- Verify Hyundai Motor India IPO exists
SELECT id, company_name, slug, segment, status
FROM ipos
WHERE slug = 'hyundai-motor-india-ipo';

-- Check related data
SELECT COUNT(*) FROM extraction_logs WHERE ipo_id = (SELECT id FROM ipos WHERE slug = 'hyundai-motor-india-ipo');
SELECT COUNT(*) FROM financial_data WHERE ipo_id = (SELECT id FROM ipos WHERE slug = 'hyundai-motor-india-ipo');
SELECT COUNT(*) FROM subscriptions WHERE ipo_id = (SELECT id FROM ipos WHERE slug = 'hyundai-motor-india-ipo');
SELECT COUNT(*) FROM gmp_records WHERE ipo_id = (SELECT id FROM ipos WHERE slug = 'hyundai-motor-india-ipo');
SELECT COUNT(*) FROM documents WHERE ipo_id = (SELECT id FROM ipos WHERE slug = 'hyundai-motor-india-ipo');
```

**Note**: Tests will adapt to whatever data exists. No test data creation if missing.

---

## Phase 2: Test Execution - Round 1 (60-90 minutes)

### Test Matrix Overview

| # | Test Scenario | Route | Duration | Priority |
|---|---------------|-------|----------|----------|
| 1 | Login & Dashboard | `/admin/login` → `/admin` | 3 min | P0 |
| 2 | Basic Info Tab | `/admin/edit/hyundai-motor-india-ipo` | 5 min | P0 |
| 3 | Financials Tab (NEW) | `/admin/edit/hyundai-motor-india-ipo` | 8 min | P0 |
| 4 | Objectives Tab | `/admin/edit/hyundai-motor-india-ipo` | 5 min | P1 |
| 5 | Subscriptions Tab | `/admin/edit/hyundai-motor-india-ipo` | 4 min | P1 |
| 6 | GMP Tab | `/admin/edit/hyundai-motor-india-ipo` | 4 min | P1 |
| 7 | Documents Tab | `/admin/edit/hyundai-motor-india-ipo` | 4 min | P1 |
| 8 | Protection Tab | `/admin/edit/hyundai-motor-india-ipo` | 6 min | P0 |
| 9 | Dynamic Admin - IPOs | `/admin/dynamic/ipos/list` | 5 min | P0 |
| 10 | Dynamic Admin - Logs | `/admin/dynamic/extractionLogs/list` | 4 min | P1 |
| 11 | DRHP Extraction History | `/admin/drhp-extraction` | 5 min | P1 |
| 12 | DRHP Extraction Review | `/admin/drhp-extraction` | 4 min | P1 |
| **Total** | **12 scenarios** | - | **57 min** | - |

---

### Test Scenario 1: Login & Dashboard Access

**Priority**: P0 (Critical)
**Route**: `/admin/login` → `/admin`
**Duration**: ~3 minutes

#### Test Steps

1. **Navigate to Login Page**
   - Use Playwright MCP: `browser_navigate` to `http://localhost:3000/admin/login`
   - Wait for page load (5s timeout)
   - Take snapshot: Verify login form visible

2. **Enter Credentials**
   - Type username: `admin` (use `browser_type`)
   - Type password: `admin123`
   - Take snapshot: Verify credentials entered

3. **Submit Login**
   - Click login button (use `browser_click`)
   - Wait for navigation (10s timeout)
   - Take snapshot: Verify redirect to dashboard

4. **Verify Dashboard Elements**
   - Check URL: `http://localhost:3000/admin`
   - Verify "Admin Dashboard" heading visible
   - Check "Dynamic Tables" widget present
   - Count table cards (should show 17 tables)
   - Take final snapshot: Dashboard fully loaded

5. **Performance Check**
   - Measure login time (should be < 2s)
   - Check console for errors (expect 0 errors)

#### Pass Criteria
- ✅ Login successful
- ✅ Redirect to `/admin`
- ✅ Dashboard loads completely
- ✅ 17 table cards visible
- ✅ No console errors
- ✅ Login time < 2 seconds

#### Failure Scenarios
- ❌ Login fails (401/403 error)
- ❌ No redirect after login
- ❌ Dashboard blank/not loading
- ❌ Console errors present
- ❌ Performance > 3 seconds

---

### Test Scenario 2: Edit Page - Basic Info Tab

**Priority**: P0 (Critical)
**Route**: `/admin/edit/hyundai-motor-india-ipo`
**Duration**: ~5 minutes

#### Test Steps

1. **Navigate to Edit Page**
   - Navigate to: `http://localhost:3000/admin/edit/hyundai-motor-india-ipo`
   - Wait for page load (5s timeout)
   - Take snapshot: Full page view

2. **Verify Tab Structure**
   - Check "Basic Info" tab is active (default)
   - Verify all 9 tabs visible in navigation
   - Take snapshot: Tab navigation bar

3. **Verify Basic Info Fields**
   - Company Name input: Present and populated
   - Segment dropdown: Present (value: MAINBOARD/SME)
   - Status dropdown: Present (UPCOMING/OPEN/CLOSED/LISTED)
   - Lot Size number input: Present
   - Open Date picker: Present
   - Close Date picker: Present
   - Issue Size input: Present
   - Price Range inputs (min/max): Present
   - Face Value input: Present
   - Registrar dropdown: Present
   - Take snapshot: All fields visible

4. **Test Edit Functionality**
   - Click on Company Name field
   - Append " [TEST]" to company name
   - Click "Save & Protect" button
   - Wait for success message
   - Verify message: "Company Name saved successfully"
   - Take snapshot: Success message

5. **Verify Data Persistence**
   - Refresh page (F5)
   - Check Company Name still has " [TEST]"
   - Take snapshot: Data persisted

6. **Revert Change**
   - Remove " [TEST]" from company name
   - Save again
   - Verify original name restored

#### Pass Criteria
- ✅ All 9 tabs visible
- ✅ Basic Info tab active by default
- ✅ All 10+ fields present and populated
- ✅ Edit functionality works
- ✅ Save & Protect works
- ✅ Success message appears
- ✅ Data persists after refresh
- ✅ No console errors

---

### Test Scenario 3: Edit Page - Financials Tab (NEW Extraction Integration)

**Priority**: P0 (Critical) - **NEW FEATURE**
**Route**: `/admin/edit/hyundai-motor-india-ipo` → Financials tab
**Duration**: ~8 minutes

#### Test Steps

1. **Navigate to Financials Tab**
   - From edit page, click "Financials" tab
   - Wait for tab content (2s timeout)
   - Take snapshot: Tab switched successfully

2. **Verify DRHP Extraction Results Section** (NEW ⭐)
   - Check "DRHP Extraction Results" header visible
   - Verify extraction results viewer component loaded
   - Take snapshot: Extraction viewer visible

3. **Check Extraction Status**
   - Verify status badge present (SUCCESS/PARTIAL/FAILED/PENDING)
   - Check badge color coding:
     - GREEN for SUCCESS
     - YELLOW for PARTIAL
     - RED for FAILED
     - BLUE for IN_PROGRESS
     - GRAY for PENDING
   - Take snapshot: Status badge

4. **Verify Confidence Score Display**
   - Check overall confidence score (e.g., "85% Confidence (HIGH)")
   - Verify confidence level color:
     - GREEN for HIGH (≥80%)
     - YELLOW for MEDIUM (60-79%)
     - RED for LOW (<60%)
   - Check "X / 16 fields" counter
   - Take snapshot: Confidence display

5. **Test Expand Functionality**
   - Click "Expand" button
   - Wait for expansion animation
   - Take snapshot: Expanded view

6. **Verify Extracted Fields Display**
   - Check field grid layout (2 columns)
   - Verify at least 8 fields displayed:
     - Revenue FY2022
     - Revenue FY2023
     - Profit FY2022
     - Profit FY2023
     - Net Worth
     - P/E Ratio
     - ROE
     - Debt to Equity
   - Each field should show:
     - Display name
     - Value with unit (e.g., "28.00 ₹ Cr")
     - Confidence percentage (color-coded)
     - "Copy" button
   - Take snapshot: All fields visible

7. **Test Single Field Copy**
   - Locate "Revenue FY2023" field
   - Note the displayed value
   - Click "Copy" button next to it
   - Verify button changes to "✓ Copied" (2s timeout)
   - Check success message: "Copied revenueFy2023 from extraction"
   - Take snapshot: Copy button changed

8. **Verify Form Field Population**
   - Scroll down to financial form fields
   - Locate "Revenue FY2023" input field
   - Verify it's populated with the extracted value
   - Take snapshot: Form field populated

9. **Test Copy All Fields**
   - Scroll back to extraction viewer
   - Click "Copy All Fields" button (blue button in header)
   - Wait for success message
   - Verify message: "Copied all fields from extraction"
   - Take snapshot: Success message

10. **Verify All Form Fields Populated**
    - Scroll through all financial form fields
    - Check that all available fields are populated:
      - revenueFy2022
      - revenueFy2023
      - profitFy2022
      - profitFy2023
      - netWorth
      - peRatio
      - roe
      - debtToEquity
    - Take snapshot: All fields populated

11. **Check Extraction Metadata**
    - Scroll to extraction metadata footer
    - Verify displays:
      - Method: "pdfplumber" or "pymupdf4llm"
      - Version: "v3.0" or similar
      - Extraction timestamp (e.g., "11/5/2025, 2:30 PM")
    - Take snapshot: Metadata footer

12. **Test Data Issues Display** (if applicable)
    - If data issues present, verify:
      - Yellow warning box visible
      - "⚠️ Data Issues Found:" header
      - List of specific issues
    - Take snapshot: Data issues (if present)

13. **Test Save & Protect**
    - Choose one field (e.g., Revenue FY2023)
    - Click "Save & Protect" button
    - Verify success message
    - Take snapshot: Field saved

#### Pass Criteria
- ✅ Financials tab loads successfully
- ✅ DRHP Extraction Results section visible
- ✅ Status badge displays correctly
- ✅ Confidence score shown with color coding
- ✅ Expand/collapse works
- ✅ All extracted fields display with values
- ✅ Individual field copy works
- ✅ "Copy All Fields" works
- ✅ Form fields populate correctly
- ✅ Metadata footer displays
- ✅ Success messages appear
- ✅ No console errors

#### Critical Checks
- Extraction viewer component loads without errors
- Copy functionality doesn't overwrite protected fields
- Success messages disappear after 3 seconds
- No race conditions in copy operations

---

### Test Scenario 4: Edit Page - Objectives Tab

**Priority**: P1 (High)
**Route**: `/admin/edit/hyundai-motor-india-ipo` → Objectives tab
**Duration**: ~5 minutes

#### Test Steps

1. **Navigate to Objectives Tab**
   - Click "Objectives" tab
   - Wait for content load
   - Take snapshot: Tab content

2. **Check Existing Objectives**
   - If objectives exist:
     - Count number of objectives
     - Verify serial numbers sequential
     - Check description fields populated
     - Verify amount fields (may be null)
   - If no objectives:
     - Verify empty state message
   - Take snapshot: Current state

3. **Test Add Objective** (if allowed)
   - Click "Add Objective" button
   - Fill in:
     - Serial No: Auto-generated or manual
     - Description: "Test Objective - Working Capital"
     - Amount: 100 (₹ Cr)
   - Take snapshot: New objective added

4. **Test Edit Objective**
   - Select existing objective
   - Modify description
   - Change amount
   - Take snapshot: Edited objective

5. **Test Save**
   - Click "Save" button
   - Verify success message
   - Check "Total Allocated" calculation updates
   - Take snapshot: Saved successfully

6. **Test Delete** (if allowed)
   - Click delete button on test objective
   - Confirm deletion
   - Verify objective removed
   - Take snapshot: After deletion

#### Pass Criteria
- ✅ Objectives tab loads
- ✅ Existing objectives display correctly
- ✅ Add objective works
- ✅ Edit objective works
- ✅ Save functionality works
- ✅ Total calculation updates
- ✅ Delete works (if feature exists)

---

### Test Scenario 5: Edit Page - Subscriptions Tab

**Priority**: P1 (High)
**Route**: `/admin/edit/hyundai-motor-india-ipo` → Subscriptions tab
**Duration**: ~4 minutes

#### Test Steps

1. **Navigate to Subscriptions Tab**
   - Click "Subscriptions" tab
   - Wait for content load
   - Take snapshot: Tab content

2. **Check Subscription Data**
   - If subscription data exists:
     - Verify QIB subscription percentage
     - Check NII subscription percentage
     - Check Retail subscription percentage
     - Verify Employee subscription (if applicable)
     - Check HNI subscription
   - Take snapshot: Subscription data

3. **Verify Subscription Breakdown**
   - Check FII subscription
   - Check Domestic Institutional subscription
   - Check Mutual Fund subscription
   - Take snapshot: Breakdown details

4. **Check Time-Series Display**
   - If historical data exists:
     - Verify table/chart shows multiple entries
     - Check timestamps
     - Verify subscription progression
   - Take snapshot: Historical data

5. **Test Add Subscription** (if feature exists)
   - Try to add new subscription record
   - Fill in required fields
   - Save
   - Take snapshot: New subscription

#### Pass Criteria
- ✅ Subscriptions tab loads
- ✅ Subscription data displays (if exists)
- ✅ Breakdown shows correctly
- ✅ Time-series data visible (if exists)
- ✅ Add subscription works (if feature present)

---

### Test Scenario 6: Edit Page - GMP Tab

**Priority**: P1 (High)
**Route**: `/admin/edit/hyundai-motor-india-ipo` → GMP tab
**Duration**: ~4 minutes

#### Test Steps

1. **Navigate to GMP Tab**
   - Click "GMP" tab
   - Wait for content load
   - Take snapshot: Tab content

2. **Check Latest GMP**
   - If GMP data exists:
     - Verify latest GMP price
     - Check GMP percentage
     - Verify expected listing price calculation
     - Check Kostak rate
     - Check Subject rate
   - Take snapshot: Latest GMP

3. **Check Historical GMP**
   - If historical data exists:
     - Verify chart displays
     - Check multiple data points
     - Verify dates/timestamps
   - Take snapshot: GMP chart

4. **Test Add GMP Record** (if feature exists)
   - Click "Add GMP Record"
   - Fill in GMP price
   - Save
   - Take snapshot: New GMP

#### Pass Criteria
- ✅ GMP tab loads
- ✅ Latest GMP displays (if exists)
- ✅ Historical chart visible (if data exists)
- ✅ Add GMP works (if feature present)

---

### Test Scenario 7: Edit Page - Documents Tab

**Priority**: P1 (High)
**Route**: `/admin/edit/hyundai-motor-india-ipo` → Documents tab
**Duration**: ~4 minutes

#### Test Steps

1. **Navigate to Documents Tab**
   - Click "Documents" tab
   - Wait for content load
   - Take snapshot: Tab content

2. **Check Existing Documents**
   - If documents exist:
     - Count number of documents
     - Verify document types (DRHP, RHP, Prospectus, etc.)
     - Check document URLs
     - Verify upload dates
   - Take snapshot: Document list

3. **Test Document Type Dropdown**
   - Click document type dropdown
   - Verify options available:
     - DRHP
     - RHP
     - Prospectus
     - Basis of Allotment
     - Addendum
     - Corrigendum
   - Take snapshot: Dropdown options

4. **Test File Upload Interface**
   - Check file upload button visible
   - Verify drag-and-drop area (if present)
   - Take snapshot: Upload interface

#### Pass Criteria
- ✅ Documents tab loads
- ✅ Existing documents display (if any)
- ✅ Document type dropdown works
- ✅ Upload interface visible

---

### Test Scenario 8: Edit Page - Protection Tab

**Priority**: P0 (Critical)
**Route**: `/admin/edit/hyundai-motor-india-ipo` → Protection tab
**Duration**: ~6 minutes

#### Test Steps

1. **Navigate to Protection Tab**
   - Click "Protection" tab
   - Wait for content load
   - Take snapshot: Tab content

2. **Check IPO Lock Status**
   - Verify "IPO Lock" toggle visible
   - Check current lock status (locked/unlocked)
   - Check lock note field
   - Take snapshot: Lock status

3. **Test IPO Lock Toggle**
   - Click lock toggle
   - Wait for status change
   - Verify success message
   - Take snapshot: Lock status changed

4. **Verify Lock Note**
   - If locked, check lock note displays:
     - "Manually locked via admin panel" or similar
     - Timestamp of lock
   - Take snapshot: Lock note

5. **Check Field Protection Grid**
   - Verify field protection table/grid visible
   - Check columns:
     - Table Name
     - Field Name
     - Is Protected
     - Auto Protected
     - Last Modified
   - Take snapshot: Protection grid

6. **Count Protected Fields**
   - Count number of protected fields listed
   - Verify at least 5 fields shown (if any protection exists)
   - Take snapshot: Protected fields count

7. **Test Field Protection Toggle** (if feature exists)
   - Select a field
   - Toggle protection status
   - Verify success message
   - Take snapshot: Protection toggled

8. **Toggle Lock Back**
   - Return IPO lock to original state
   - Verify toggle works
   - Take snapshot: Original state restored

#### Pass Criteria
- ✅ Protection tab loads
- ✅ IPO lock toggle visible and functional
- ✅ Lock note displays correctly
- ✅ Field protection grid visible
- ✅ Protected fields listed (if any)
- ✅ Toggle functionality works both ways
- ✅ Success messages appear

---

### Test Scenario 9: Dynamic Admin - IPOs List

**Priority**: P0 (Critical)
**Route**: `/admin/dynamic/ipos/list`
**Duration**: ~5 minutes

#### Test Steps

1. **Navigate to Dynamic IPOs List**
   - Navigate to: `http://localhost:3000/admin/dynamic/ipos/list`
   - Wait for page load (5s timeout)
   - Take snapshot: List page loaded

2. **Verify Table Structure**
   - Check table headers visible
   - Verify at least 10 columns displayed
   - Check pagination controls present
   - Take snapshot: Table structure

3. **Check Record Count**
   - Count records displayed (should be 20/page default)
   - Verify total records count displayed
   - Take snapshot: Records displayed

4. **Test Search Functionality**
   - Locate search input box
   - Type "Hyundai"
   - Wait for search results (2s)
   - Verify Hyundai Motor India appears in results
   - Take snapshot: Search results

5. **Test Row Actions**
   - Locate Hyundai row
   - Check action buttons visible:
     - View button
     - Edit button
     - Delete button (may be disabled)
   - Take snapshot: Action buttons

6. **Test View Button**
   - Click "View" on Hyundai row
   - Verify redirect to: `/admin/dynamic/ipos/[id]` or `/admin/edit/hyundai-motor-india-ipo`
   - Take snapshot: Redirected page

7. **Test Pagination** (if more than 20 IPOs)
   - Navigate back to list
   - Click "Next" page button
   - Verify new records load
   - Click "Previous" to return
   - Take snapshot: Pagination works

8. **Test Sort** (if feature exists)
   - Click on column header (e.g., "Company Name")
   - Verify sort order changes (ascending/descending)
   - Take snapshot: Sorted list

#### Pass Criteria
- ✅ List page loads successfully
- ✅ Table displays with data
- ✅ 20 records per page (or configured limit)
- ✅ Search works and finds Hyundai
- ✅ Action buttons present
- ✅ View button redirects correctly
- ✅ Pagination functional (if applicable)
- ✅ Sort works (if feature exists)

---

### Test Scenario 10: Dynamic Admin - Extraction Logs

**Priority**: P1 (High)
**Route**: `/admin/dynamic/extractionLogs/list`
**Duration**: ~4 minutes

#### Test Steps

1. **Navigate to Extraction Logs List**
   - Navigate to: `http://localhost:3000/admin/dynamic/extractionLogs/list`
   - Wait for page load
   - Take snapshot: Extraction logs page

2. **Verify Table Columns**
   - Check columns displayed:
     - Company Name
     - File Name
     - Status
     - Confidence Score
     - Confidence Level
     - Fields Extracted
     - Created At
   - Take snapshot: Table headers

3. **Check for Hyundai Extraction**
   - Search for "Hyundai" in table
   - If found:
     - Note status (SUCCESS/PARTIAL/FAILED)
     - Note confidence score
     - Note fields extracted count
   - Take snapshot: Hyundai extraction

4. **Test Status Filter** (if exists)
   - Filter by status: SUCCESS
   - Verify only SUCCESS extractions shown
   - Take snapshot: Filtered results

5. **Test View Extraction Details**
   - Click on Hyundai extraction row
   - Verify extracted_data (JSON) displays
   - Check all 16 fields visible
   - Take snapshot: Extraction details

#### Pass Criteria
- ✅ Extraction logs list loads
- ✅ Table columns display correctly
- ✅ Hyundai extraction visible (if exists)
- ✅ Status filter works (if feature exists)
- ✅ View details shows JSON data

---

### Test Scenario 11: DRHP Extraction UI - History Tab

**Priority**: P1 (High)
**Route**: `/admin/drhp-extraction` → History tab
**Duration**: ~5 minutes

#### Test Steps

1. **Navigate to DRHP Extraction Page**
   - Navigate to: `http://localhost:3000/admin/drhp-extraction`
   - Wait for page load
   - Take snapshot: DRHP extraction page

2. **Verify Tab Navigation**
   - Check 3 tabs visible:
     - Upload
     - History
     - Review
   - Take snapshot: Tab navigation

3. **Click History Tab**
   - Click "History" tab
   - Wait for content load
   - Take snapshot: History tab content

4. **Verify Extraction History Table**
   - Check table displays with columns:
     - Company Name
     - File Name
     - Status (with color-coded badge)
     - Confidence Score
     - Timestamp
     - Actions
   - Take snapshot: History table

5. **Check for Hyundai Extraction**
   - Locate Hyundai Motor India in history
   - Verify status badge color:
     - Green for SUCCESS
     - Yellow for PARTIAL
     - Red for FAILED
   - Note confidence score
   - Take snapshot: Hyundai in history

6. **Test Search/Filter** (if exists)
   - Search for "Hyundai"
   - Verify results filter
   - Take snapshot: Search results

7. **Test Row Click**
   - Click on Hyundai extraction row
   - Verify details expand or modal opens
   - Take snapshot: Extraction details

#### Pass Criteria
- ✅ DRHP extraction page loads
- ✅ History tab displays correctly
- ✅ History table shows extractions
- ✅ Hyundai extraction visible (if exists)
- ✅ Status badges color-coded
- ✅ Search/filter works (if feature exists)

---

### Test Scenario 12: DRHP Extraction UI - Review Tab

**Priority**: P1 (High)
**Route**: `/admin/drhp-extraction` → Review tab
**Duration**: ~4 minutes

#### Test Steps

1. **Click Review Tab**
   - From DRHP extraction page, click "Review" tab
   - Wait for content load
   - Take snapshot: Review tab content

2. **Select Hyundai Extraction** (if dropdown exists)
   - If extraction dropdown present:
     - Select "Hyundai Motor India"
     - Wait for data load
   - Take snapshot: Hyundai selected

3. **Verify Extracted Fields Display**
   - Check all 16 financial fields displayed:
     - Revenue FY2022/23/24
     - Profit FY2022/23/24
     - Net Worth
     - P/E Ratio
     - EPS
     - ROE
     - Debt to Equity
     - Total Assets
     - Total Borrowings
     - EBITDA
     - Current Ratio
   - Take snapshot: All fields visible

4. **Check Confidence Scores**
   - Verify each field has confidence percentage
   - Check color coding:
     - Green (≥80%)
     - Yellow (60-79%)
     - Red (<60%)
   - Take snapshot: Confidence scores

5. **Verify Field Grouping**
   - Check fields grouped by category:
     - Basic Information
     - Financial Data
     - Dates
     - Status
   - Take snapshot: Field groups

6. **Check Data Issues Section**
   - If data issues present:
     - Verify yellow warning box
     - Check issue list
   - Take snapshot: Data issues (if present)

7. **Test Manual Correction** (if feature exists)
   - Try to edit a field value
   - Verify edit functionality
   - Take snapshot: Field edited

#### Pass Criteria
- ✅ Review tab loads correctly
- ✅ Hyundai extraction selectable
- ✅ All 16 fields display with values
- ✅ Confidence scores visible and color-coded
- ✅ Field grouping logical
- ✅ Data issues display (if present)
- ✅ Manual correction works (if feature exists)

---

## Phase 3: Issue Documentation (30 minutes)

### Objectives
- Document every issue found during testing
- Classify by severity (Critical/High/Medium/Low)
- Capture screenshots of each failure
- Log console errors
- Create comprehensive issue report

### Issue Report Template

For each issue, document:

```markdown
## Issue #X: [Brief Title]

**Test Scenario**: #N - [Test Name]
**Severity**: Critical / High / Medium / Low
**Status**: Open / In Progress / Fixed / Won't Fix

### Description
[Clear description of what went wrong]

### Expected Behavior
[What should have happened]

### Actual Behavior
[What actually happened]

### Steps to Reproduce
1. [Step 1]
2. [Step 2]
3. [Step 3]

### Screenshots
![Issue Screenshot](path/to/screenshot.png)

### Console Errors
```
[Console error output if any]
```

### Environment
- Browser: Chromium
- Route: /path/to/page
- Timestamp: YYYY-MM-DD HH:MM:SS

### Affected Components
- File: `path/to/component.tsx`
- Function: `functionName()`
- Line: XX

### Root Cause Analysis
[Technical explanation of why this occurred]

### Proposed Fix
[How to fix this issue]
```

### Severity Classification

**Critical (P0)** - Must fix before proceeding:
- Application crash/error
- Data loss or corruption
- Security vulnerability
- Core functionality broken (login, edit, save)
- Database errors
- Unable to complete test scenario

**High (P1)** - Should fix in current iteration:
- Major feature impaired
- Workaround exists but difficult
- Affects multiple users/scenarios
- Performance severely degraded (>5s load)
- UI partially broken

**Medium (P2)** - Fix in next iteration:
- Minor feature issue
- Easy workaround available
- Affects limited scenarios
- UI display issue
- Performance moderately degraded (2-5s load)

**Low (P3)** - Nice to have:
- Cosmetic issue
- Documentation error
- Minor UX improvement
- No functional impact

---

## Phase 4: Batch Fix (2-4 hours)

### Objectives
- Fix all issues in priority order
- Document each fix with code changes
- Test fix locally before moving to next
- Track fix time per issue

### Fix Strategy

#### 4.1 Priority-Based Fixing

```
1. Fix ALL Critical (P0) issues first
   ├─ Application crashes
   ├─ Core functionality broken
   └─ Data integrity issues

2. Fix ALL High (P1) issues
   ├─ Major features impaired
   └─ Significant UX problems

3. Fix Medium (P2) issues (if time permits)
   ├─ Minor features
   └─ Display issues

4. Document Low (P3) issues for future
   └─ Create backlog items
```

#### 4.2 Fix Workflow

For each issue:

1. **Analyze Root Cause**
   - Review error messages
   - Check console logs
   - Inspect component code
   - Identify exact cause

2. **Develop Fix**
   - Make minimal code changes
   - Follow existing patterns
   - Maintain code quality
   - Add comments if needed

3. **Test Fix Locally**
   - Restart dev server (if needed)
   - Navigate to affected page
   - Verify fix works
   - Check for side effects

4. **Document Fix**
   - File(s) modified
   - Code diff (before/after)
   - Explanation of change
   - Test verification

#### 4.3 Fix Documentation Template

```markdown
## Fix #X: [Issue Title]

**Issue ID**: #X
**Severity**: Critical / High / Medium / Low
**Time to Fix**: XX minutes

### Root Cause
[Technical explanation of why issue occurred]

### Solution
[What was changed and why]

### Files Modified
1. `path/to/file1.tsx` - [Brief description]
2. `path/to/file2.ts` - [Brief description]

### Code Changes

**File**: `web/components/admin/ExtractionResultsViewer.tsx`

**Before**:
```typescript
const handleCopyField = (fieldName: string, value: any) => {
  onCopyField(fieldName, value); // Missing null check
};
```

**After**:
```typescript
const handleCopyField = (fieldName: string, value: any) => {
  if (onCopyField && value !== null && value !== undefined) {
    onCopyField(fieldName, value);
  }
};
```

**Explanation**: Added null check to prevent errors when value is null/undefined.

### Test Verification
- ✅ Tested with null value - no error
- ✅ Tested with valid value - copy works
- ✅ No console errors
- ✅ Success message displays

### Impact
- Affected users: All admins using copy feature
- Regression risk: Low (added defensive check)
- Related issues: None
```

---

## Phase 5: Re-Test Loop (30-60 minutes per iteration)

### Objectives
- Re-run all 12 test scenarios
- Verify fixes worked
- Identify any new issues or regressions
- Continue loop until all tests pass

### Re-Test Strategy

#### 5.1 Full Regression Re-Test

After batch fixes complete:

1. **Restart Environment**
   - Kill dev server
   - Clear .next cache
   - Restart fresh server
   - Clear browser cache (if needed)

2. **Run All 12 Tests Again**
   - Execute in same sequence
   - Use same test data (Hyundai)
   - Document results: PASS/FAIL per test
   - Take new screenshots

3. **Compare Results**
   - Test #1: ✅ PASS (was ❌ FAIL - Issue #3 fixed)
   - Test #2: ✅ PASS (no change)
   - Test #3: ✅ PASS (was ❌ FAIL - Issue #1 fixed)
   - ... etc

#### 5.2 Regression Check

For each test that now passes, verify:
- Fix worked as expected
- No new side effects
- Performance acceptable
- No new console errors

#### 5.3 Iteration Decision

After re-test:

**If all tests PASS**:
- ✅ Exit re-test loop
- ✅ Proceed to Phase 6 (Documentation)

**If any tests FAIL**:
- Document new/remaining issues
- Classify by severity
- Return to Phase 4 (Fix)
- Repeat Phase 5 (Re-test)

**Maximum Iterations**: 3 re-test loops
- After 3 iterations, escalate remaining issues
- Document blockers
- Get user input on next steps

---

## Phase 6: Final Documentation (1 hour)

### Objectives
- Create comprehensive test report (~2000+ lines)
- Include all test results, issues, fixes
- Provide screenshots and metrics
- Generate executive summary
- Sign-off for production readiness

### Report Structure

#### 6.1 Create Main Test Report

**File**: `docs/00-admin/COMPREHENSIVE_ADMIN_TEST_REPORT.md`

```markdown
# Comprehensive Admin Test Report - Hyundai Motor India IPO

**Project**: IPODhan Admin System Enhancement (Phase 6)
**Test Date**: November 5, 2025
**Tester**: [Name]
**Environment**: Local Development (localhost:3000)
**Browser**: Chromium (Playwright MCP, headed mode)
**Test IPO**: Hyundai Motor India (`hyundai-motor-india-ipo`)
**Duration**: X hours Y minutes
**Status**: ✅ ALL TESTS PASSED / ⚠️ MINOR ISSUES / ❌ CRITICAL ISSUES

---

## Executive Summary

### Test Overview
- **Total Test Scenarios**: 12
- **Tests Passed**: X / 12 (XX%)
- **Tests Failed**: X / 12 (XX%)
- **Issues Found**: XX total
  - Critical (P0): X
  - High (P1): X
  - Medium (P2): X
  - Low (P3): X
- **Issues Fixed**: XX total
- **Test Iterations**: X rounds

### Key Findings
- [Finding 1]
- [Finding 2]
- [Finding 3]

### Recommendations
- [Recommendation 1]
- [Recommendation 2]

### Production Readiness
**Status**: Ready / Not Ready for Task 2 (Bulk PDF Upload)
**Confidence Level**: High / Medium / Low

---

## Test Environment

### Technical Stack
[Environment details]

### Test Data
[Test IPO details, data availability]

---

## Test Results (Detailed)

### Test Scenario 1: Login & Dashboard
**Route**: `/admin/login` → `/admin`
**Status**: ✅ PASS / ❌ FAIL
**Duration**: X minutes
**Iteration**: Round 1 / Round 2 / Round 3

#### Test Steps
[Detailed steps with results]

#### Screenshots
![Login Page](screenshots/test1-1-login.png)
![Dashboard](screenshots/test1-2-dashboard.png)

#### Issues Found
- None / [Issue #X]

#### Performance Metrics
- Login time: X.XX seconds (target: < 2s)
- Dashboard load: X.XX seconds (target: < 2.5s)
- API response: X ms (target: < 500ms)

---

[Repeat for all 12 tests]

---

## Issues Log (Comprehensive)

### Critical Issues (P0)

#### Issue #1: [Title]
[Full issue details with fix]

---

### High Priority Issues (P1)

#### Issue #2: [Title]
[Full issue details with fix]

---

[Continue for all issues]

---

## Fixes Applied (Detailed)

### Fix #1: [Issue Title]
[Full fix documentation with code diffs]

---

[Continue for all fixes]

---

## Performance Metrics

### API Response Times
| Endpoint | Target | Actual | Status |
|----------|--------|--------|--------|
| GET /api/admin/drhp/ipo/{id} | < 500ms | XXX ms | ✅ / ❌ |
| ... | ... | ... | ... |

### Page Load Times
| Route | Target | Actual | Status |
|-------|--------|--------|--------|
| /admin/login | < 2s | X.XX s | ✅ / ❌ |
| /admin/edit/hyundai-motor-india-ipo | < 2.5s | X.XX s | ✅ / ❌ |
| ... | ... | ... | ... |

### Tab Switch Times
| Tab | Target | Actual | Status |
|-----|--------|--------|--------|
| Basic Info → Financials | < 500ms | XXX ms | ✅ / ❌ |
| ... | ... | ... | ... |

---

## Screenshots Gallery

### Test 1: Login & Dashboard
[Gallery of screenshots]

### Test 2: Basic Info Tab
[Gallery of screenshots]

[Continue for all tests]

---

## Browser Console Log

### Errors Found
```
[Console error output]
```

### Warnings
```
[Console warning output]
```

---

## Recommendations

### For Production Deployment
- [ ] All critical tests pass
- [ ] API performance meets targets
- [ ] No console errors
- [ ] Browser compatibility verified

### For Future Enhancements
1. [Enhancement 1]
2. [Enhancement 2]
3. [Enhancement 3]

---

## Sign-off

**Tested By**: _____________________
**Date**: _____________________
**Approved By**: _____________________
**Date**: _____________________

**Status**: ✅ APPROVED FOR TASK 2 / ⏸️ ON HOLD / ❌ BLOCKED

---

**Next Steps**:
- If approved: Proceed to Task 2 (Bulk PDF Upload)
- If on hold: Address outstanding issues
- If blocked: Escalate critical blockers
```

#### 6.2 Update Related Documents

1. **TASK_1_EXTRACTION_INTEGRATION_COMPLETE.md**
   - Update with test results
   - Add "Tested: ✅ 12 scenarios passed"
   - Link to comprehensive report

2. **ADMIN_ENHANCEMENT_COMPLETE.md**
   - Update Phase 6 status: 95% → 97%
   - Add test completion date
   - Update metrics

3. **EXTRACTION_INTEGRATION_TEST_RESULTS.md**
   - Fill in all test results
   - Update status from PENDING to COMPLETE
   - Add final metrics

---

## Tools & Technologies

### Playwright MCP Tools Used
- `mcp__playwright__browser_navigate` - Navigate to URLs
- `mcp__playwright__browser_click` - Click buttons/links
- `mcp__playwright__browser_type` - Fill input fields
- `mcp__playwright__browser_snapshot` - Capture UI state
- `mcp__playwright__browser_take_screenshot` - Save screenshots
- `mcp__playwright__browser_evaluate` - Run JavaScript
- `mcp__playwright__browser_wait_for` - Wait for elements/text
- `mcp__playwright__browser_console_messages` - Get console logs

### Files Referenced
- `web/app/admin/edit/[slug]/page.tsx` (1,872 lines)
- `web/app/admin/drhp-extraction/page.tsx` (900 lines)
- `web/components/admin/ExtractionResultsViewer.tsx` (400 lines)
- `web/app/api/admin/drhp/ipo/[ipoId]/route.ts` (60 lines)
- `packages/shared/src/db/schema.ts` (17 tables)

### Documentation Created
- `COMPREHENSIVE_ADMIN_TEST_REPORT.md` (~2000+ lines)
- `ADMIN_TEST_ISSUES_LOG.md` (varies by issue count)
- Screenshots folder: `docs/00-admin/test-screenshots/`

---

## Success Metrics

### Quantitative Metrics
- ✅ Test Pass Rate: 100% (12/12 tests)
- ✅ Issue Fix Rate: 100% (all critical/high fixed)
- ✅ Performance: All targets met
- ✅ Zero console errors
- ✅ Documentation: Complete (2000+ lines)

### Qualitative Metrics
- ✅ User experience smooth
- ✅ No blocking issues
- ✅ Production-ready quality
- ✅ Comprehensive coverage

---

## Estimated Timeline

| Phase | Estimated | Notes |
|-------|-----------|-------|
| Phase 1: Setup | 5 min | Clean env, start server |
| Phase 2: Testing Round 1 | 60-90 min | All 12 tests |
| Phase 3: Issue Documentation | 30 min | Log findings |
| Phase 4: Batch Fixes | 2-4 hours | Varies by issue count |
| Phase 5: Re-Test Loop | 30-60 min | Per iteration (1-3 iterations) |
| Phase 6: Documentation | 1 hour | Final report |
| **Total** | **5-7 hours** | Full cycle |

**Assumptions**:
- 10-20 issues found in Round 1
- 2 re-test iterations needed
- No major blockers
- Test data available for Hyundai

---

## Risk Assessment

### High Risks
- **Server instability**: Dev server crashes during testing
  - Mitigation: Restart server, clean cache
- **Missing test data**: Hyundai IPO lacks data
  - Mitigation: Skip tests gracefully, document gaps
- **Playwright MCP issues**: Connection problems
  - Mitigation: Retry, restart browser, check network

### Medium Risks
- **Performance degradation**: Tests exceed time targets
  - Mitigation: Document, optimize in Phase 4
- **New issues found**: Re-test reveals regressions
  - Mitigation: Additional fix iterations
- **Time overrun**: Testing takes longer than estimated
  - Mitigation: Prioritize critical tests, defer low-priority

### Low Risks
- **Documentation incomplete**: Report missing details
  - Mitigation: Fill in gaps during Phase 6
- **Screenshot quality**: Images unclear
  - Mitigation: Retake screenshots

---

## Appendix

### A. Test Checklist

Use this checklist during testing:

- [ ] Phase 1: Setup complete
- [ ] Test 1: Login & Dashboard - PASS/FAIL
- [ ] Test 2: Basic Info Tab - PASS/FAIL
- [ ] Test 3: Financials Tab - PASS/FAIL
- [ ] Test 4: Objectives Tab - PASS/FAIL
- [ ] Test 5: Subscriptions Tab - PASS/FAIL
- [ ] Test 6: GMP Tab - PASS/FAIL
- [ ] Test 7: Documents Tab - PASS/FAIL
- [ ] Test 8: Protection Tab - PASS/FAIL
- [ ] Test 9: Dynamic Admin IPOs - PASS/FAIL
- [ ] Test 10: Dynamic Admin Logs - PASS/FAIL
- [ ] Test 11: DRHP Extraction History - PASS/FAIL
- [ ] Test 12: DRHP Extraction Review - PASS/FAIL
- [ ] Phase 3: Issues documented
- [ ] Phase 4: Fixes applied
- [ ] Phase 5: Re-test complete
- [ ] Phase 6: Report written

### B. Keyboard Shortcuts (Playwright)

- F5: Refresh page
- F12: Open DevTools (for manual inspection)
- Ctrl+Shift+C: Inspect element
- Ctrl+Shift+J: Open console

### C. Common Playwright MCP Commands

```typescript
// Navigate
await mcp__playwright__browser_navigate({ url: "http://localhost:3000/admin" });

// Click
await mcp__playwright__browser_click({ element: "Login button", ref: "button[type='submit']" });

// Type
await mcp__playwright__browser_type({ element: "Username field", ref: "input[name='username']", text: "admin" });

// Snapshot
await mcp__playwright__browser_snapshot({});

// Screenshot
await mcp__playwright__browser_take_screenshot({ filename: "test1-login.png" });

// Wait
await mcp__playwright__browser_wait_for({ text: "Dashboard" });

// Evaluate
await mcp__playwright__browser_evaluate({ function: "() => document.title" });
```

---

**Plan Status**: Ready for Execution
**Created**: November 5, 2025
**Approved**: November 5, 2025
**Next Action**: Begin Phase 1 - Pre-Testing Setup

---

**End of Comprehensive Testing Plan**
