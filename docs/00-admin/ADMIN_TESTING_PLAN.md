# Admin UI Comprehensive Testing Plan

**Created:** 2025-11-06
**Status:** Active Testing Plan
**Estimated Duration:** 4-6 hours
**Testing Approach:** Playwright MCP in headed mode with iterative fix loop

---

## Quick Navigation

- [Phase 1: Environment Setup](#phase-1-environment-setup--known-issues-fix-30-min)
- [Phase 2: Playwright Setup](#phase-2-playwright-mcp-testing-setup-15-min)
- [Phase 3: Test Scenarios](#phase-3-comprehensive-testing-loop-2-3-hours)
- [Phase 4: Fix Loop](#phase-4-issue-fix-loop-iterative)
- [Phase 5: Final Validation](#phase-5-final-validation-30-min)
- [Known Issues](#known-issues-from-previous-testing)
- [Test Results](#test-results-log)

---

## Testing Context

### Current System Status (Phase 1-4 Complete)
- **Overall Completion:** ~80% (Phases 1-4 deployed)
- **Production Ready Score:** 95/100
- **Test Pass Rate:** 100% (148 tests passing)
- **Admin Pages:** 5 pages + 9 edit tabs
- **API Endpoints:** 23+ endpoints
- **Protection System:** 100% functional

### Testing Goals
1. ✅ Verify all 5 admin pages functional
2. ✅ Validate all 9 edit tabs working correctly
3. ✅ Confirm protection system (IPO + field-level)
4. ✅ Test DRHP extraction integration (NEW - Week 3)
5. ✅ Validate dynamic admin system (self-extending)
6. ✅ Fix any issues found during testing
7. ✅ Document all results for production readiness

---

## Phase 1: Environment Setup & Known Issues Fix (30 min)

### 1.1 Clean Development Environment (10 min)

**Kill Zombie Processes:**
```bash
# Windows
taskkill /F /IM node.exe
tasklist | findstr node

# Linux/Mac
pkill -f "next-server"
ps aux | grep node
```

**Clear Caches:**
```bash
cd web
rm -rf .next
rm -rf node_modules/.cache
rm -rf .turbo
npm run db:studio  # Check DB connection
```

**Restart Services (if needed):**
- PostgreSQL (port 5432)
- Redis (port 6379)
- Check with `netstat -ano | findstr "3000"` for port conflicts

### 1.2 Fix Critical Known Issues (10 min)

#### Issue #3 - DRHP Integration (P0 - CRITICAL)
**Status:** 🔴 OPEN
**Priority:** P0 - Blocks Week 3 Task 1B
**Impact:** DRHP extraction results viewer completely broken

**Location:** `web/app/admin/edit/[slug]/page.tsx` line ~946

**Current Code:**
```tsx
<ExtractionResultsViewer
  results={extractionResults}
  onCopyToForm={handleCopyToForm}
/>
```

**Fix Required:**
```tsx
<ExtractionResultsViewer
  ipoId={ipo.id}  // ← ADD THIS LINE
  results={extractionResults}
  onCopyToForm={handleCopyToForm}
/>
```

**Verification:**
1. Navigate to any IPO edit page → Financials tab
2. Check if "DRHP Extraction Results" section displays
3. Verify API call succeeds: `GET /api/admin/drhp/ipo/[ipoId]`

#### Issue #5 - Schema Introspector (P1 - PARTIALLY FIXED)
**Status:** ⚠️ Backend fixed, HMR cache blocking browser test
**Workaround:** Test in production build

**If Still Failing:**
```bash
cd web
npm run build
npm start
# Test at http://localhost:3000/admin/dynamic/ipos/list
```

**Root Cause:** Drizzle ORM `getTableConfig` export doesn't exist (fixed with direct property access)

### 1.3 Environment Variables Setup (10 min)

**Check `web/.env.local`:**
```bash
# Required variables
ADMIN_PANEL_ENABLED=true
ADMIN_AUTH_TOKEN=<64-char-hex-token>

# Generate token if missing:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Database
DATABASE_URL=postgresql://user:password@host:5432/ipodhan

# Redis (optional, graceful degradation)
REDIS_HOST=localhost
REDIS_PORT=6379
```

**Verify Database Tables:**
```bash
cd web
npm run db:studio
# Check tables exist:
# - field_protection_metadata
# - admin_settings
# - audit_logs
# - extraction_logs (if Phase 6 started)
```

**Seed Test Data (if needed):**
```bash
npm run seed              # Initial seed
npm run verify:seed       # Verify integrity
```

---

## Phase 2: Playwright MCP Testing Setup (15 min)

### 2.1 Start Development Server

```bash
cd web
npm run dev
# Expected: Server running on http://localhost:3000
# Note: May auto-assign port if 3000 occupied
```

### 2.2 Browser Navigation with Playwright

**Step 1: Open Admin Login**
```
mcp__playwright__browser_navigate
url: http://localhost:3000/admin/login
```

**Step 2: Capture Initial State**
```
mcp__playwright__browser_snapshot
```

**Step 3: Authenticate**
- Input: ADMIN_AUTH_TOKEN from .env.local
- Click "Login" button
- Verify redirect to `/admin` dashboard

**Step 4: Check Auth Persistence**
```
mcp__playwright__browser_evaluate
function: () => localStorage.getItem('admin_token')
```

### 2.3 Test Data Preparation

**Recommended Test IPO:**
- **Slug:** `integration-test-company`
- **ID:** `96836832-849a-45bd-b253-74a454f90053`
- **Status:** UPCOMING
- **Category:** MAINBOARD
- **Reason:** Used in November 5, 2025 tests (verified working)

**Alternative Test IPOs:**
- `emcure-pharmaceuticals-ipo` (has DRHP data)
- `bajaj-housing-finance-ipo` (complete data)
- `ola-electric-ipo` (recent)

---

## Phase 3: Comprehensive Testing Loop (2-3 hours)

### Test Scenario 1: Authentication & Access (15 min)

**Test Cases:**
1. ✅ Login page renders correctly
2. ✅ Valid token authentication succeeds
3. ✅ Invalid token shows error message
4. ✅ Token persists in localStorage
5. ✅ Logout functionality works
6. ✅ Protected routes redirect to login if not authenticated

**Playwright Actions:**
```
1. Navigate to /admin/login
2. Snapshot page
3. Type token in input field
4. Click login button
5. Wait for redirect
6. Verify URL is /admin
7. Check localStorage for 'admin_token'
```

**Expected Results:**
- Login page loads in <2s
- Authentication completes in <500ms
- Dashboard loads after successful auth
- Token stored in localStorage

**Known Issues:**
- None reported for authentication flow

---

### Test Scenario 2: Dashboard (20 min)

**Test Cases:**
1. ✅ IPO list loads (target: 100+ IPOs)
2. ✅ Search functionality works
3. ✅ Filters work (status, category, date range)
4. ✅ Pagination controls functional
5. ✅ Protection status indicators visible
6. ✅ Click IPO → navigates to edit page

**Playwright Actions:**
```
1. Navigate to /admin
2. Snapshot dashboard
3. Count visible IPO cards (should be 10-20 per page)
4. Test search: type "integration" in search box
5. Test filters: select status="UPCOMING"
6. Test pagination: click "Next" button
7. Click first IPO card → verify navigation
```

**Expected Results:**
- Dashboard loads in <3s
- Search filters IPOs in real-time
- Pagination updates list correctly
- Protection indicators show locked IPOs

**Performance Targets:**
- Initial load: <3s
- Search response: <500ms
- Filter application: <500ms
- API call: `GET /api/admin/ipos` <500ms

---

### Test Scenario 3: Edit Page - All 9 Tabs (90 min)

**Test IPO:** `integration-test-company`
**Route:** `/admin/edit/integration-test-company`

#### Tab 1: Basic Info (10 min)

**Test Cases:**
1. ✅ All fields display current values
2. ✅ Edit company name
3. ✅ Edit lot size, price range, dates
4. ✅ Click "Save & Protect" button
5. ✅ Verify success message
6. ✅ Check field automatically protected

**Fields to Test:**
- Company Name (text)
- Status (dropdown: UPCOMING, OPEN, CLOSED, LISTED, WITHDRAWN)
- Lot Size (number)
- Price Range Min/Max (number)
- Open Date, Close Date, Listing Date (date pickers)
- Issue Size (number with ₹ Cr)

**API Calls:**
- `PATCH /api/admin/update-field` (field update)
- `POST /api/admin/protection/fields/[ipoId]` (auto-protect)

**Expected Results:**
- Save completes in <1s
- Success toast appears
- Field protection indicator shows lock icon

#### Tab 2: Financials (15 min)

**Test Cases:**
1. ✅ **NEW: DRHP Extraction Results Viewer displays** (Issue #3 fix validation)
2. ✅ View extracted financial data with confidence scores
3. ✅ Click "Copy to Form" for specific field
4. ✅ Edit revenue, profit, EBITDA
5. ✅ Edit financial ratios (P/E, ROE, EPS)
6. ✅ Save changes with protection

**NEW Feature - DRHP Integration:**
- Section: "DRHP Extraction Results" at top of tab
- Displays: 16 extracted fields with confidence levels
- Actions: "Copy to Form" buttons for each field
- Verification: API call `GET /api/admin/drhp/ipo/[ipoId]` succeeds

**Fields to Test:**
- Revenue FY2022/2023/2024
- Profit FY2022/2023/2024
- EBITDA (if available)
- P/E Ratio, ROE, EPS
- Debt-to-Equity Ratio

**Known Issues:**
- Issue #3: Missing `ipoId` prop (MUST FIX FIRST)
- Emcure profit≠revenue validation bug (Phase 6 fix)

#### Tab 3: Objectives (10 min)

**Test Cases:**
1. ✅ View existing objectives list
2. ✅ Add new objective (description + amount ₹ Cr)
3. ✅ Edit existing objective
4. ✅ Delete objective
5. ✅ Verify total calculation updates

**Actions:**
- Click "Add Objective" button
- Fill form: description, amount, percentage
- Click "Save"
- Verify objective appears in list
- Test edit and delete icons

**Expected Results:**
- CRUD operations work smoothly
- Total amount calculates correctly
- Changes persist after page refresh

#### Tab 4: Subscriptions (10 min)

**Test Cases:**
1. ✅ View subscription snapshots list
2. ✅ Display: Date, Overall, QIB, NII, Retail, sHNI, bHNI, Employee
3. ✅ Edit latest record (if editable)
4. ✅ Verify time-series display

**Data Structure:**
```
Snapshot Date: 2024-11-05
Overall: 2.50x | QIB: 3.20x | NII: 1.80x
Retail: 2.10x | sHNI: 1.50x | bHNI: 2.80x
```

**Expected Results:**
- Historical snapshots load
- Data formatted correctly (2 decimal places)
- Subscription badges colored by status

#### Tab 5: GMP (15 min)

**Test Cases:**
1. ✅ View GMP records list
2. ✅ Add new GMP record (price, premium, source)
3. ✅ Edit existing record (3 editable fields)
4. ✅ Delete GMP record
5. ✅ View historical trend

**NEW Editable Fields (Phase 4):**
- `subject_to_sauda` (boolean)
- `kostak_rate` (number)
- `listing_gains_estimate` (number)

**API Calls:**
- `POST /api/admin/gmp/[ipoId]` (create)
- `PATCH /api/admin/gmp/[ipoId]` (update)
- `DELETE /api/admin/gmp/[ipoId]` (delete)

**Expected Results:**
- CRUD operations complete in <1s
- GMP trend chart displays (if implemented)
- Validation prevents negative values

#### Tab 6: Documents (5 min)

**Test Cases:**
1. ✅ View document list (DRHP, RHP, Prospectus)
2. ✅ Display document type, size, upload date
3. ✅ Test download links (if any)

**Note:** Upload feature not implemented (Phase 6)

**Expected Results:**
- Document list loads
- Download links work (if any documents exist)

#### Tab 7: Listing Performance (10 min)

**Test Cases:**
1. ✅ Edit listing price
2. ✅ Edit listing gains percentage
3. ✅ Edit current price
4. ✅ Verify calculations (gains = (current - issue) / issue * 100)

**Fields:**
- Listing Price (₹)
- Listing Gains (%)
- Current Price (₹)
- Last Updated (timestamp)

#### Tab 8: Peer Companies (10 min)

**Test Cases:**
1. ✅ View peer companies list
2. ✅ Add new peer company
3. ✅ Remove peer company
4. ✅ Verify peer comparison data

**Actions:**
- Click "Add Peer" button
- Search and select company
- Verify peer appears in list
- Test remove functionality

#### Tab 9: Protection (15 min)

**Test Cases:**
1. ✅ View IPO-level lock toggle
2. ✅ Toggle IPO lock ON → verify entire IPO protected
3. ✅ View field-level protection list (10+ fields)
4. ✅ Toggle individual field protection
5. ✅ Bulk protect/unprotect multiple fields
6. ✅ Verify protection indicators in other tabs

**Protection Hierarchy:**
```
IPO Lock (Master) → Blocks ALL fields, ALL scrapers
  └─ Field Lock (Granular) → Blocks specific field only
```

**Fields Available for Protection:**
- companyName
- status
- lotSize
- priceRangeMin, priceRangeMax
- openDate, closeDate, listingDate
- issueSize
- faceValue

**API Calls:**
- `PATCH /api/admin/protection/ipo/[ipoId]` (toggle IPO lock)
- `POST /api/admin/protection/fields/[ipoId]` (add field protection)
- `DELETE /api/admin/protection/fields/[ipoId]` (remove)
- `POST /api/admin/protection/fields/bulk` (bulk operations)

**Expected Results:**
- IPO lock toggle updates in <500ms
- Field protections apply immediately
- Lock icons appear in respective tabs
- Bulk operations process all fields

---

### Test Scenario 4: Notifications Page (15 min)

**Route:** `/admin/notifications`

**Test Cases:**
1. ✅ View blocked scraper updates list
2. ✅ Display: IPO name, scraper source, reason, timestamp
3. ✅ Filter by date range
4. ✅ Filter by scraper (NSE, BSE, Moneycontrol)
5. ✅ Sort by date (newest first)
6. ✅ Pagination controls

**Data Structure:**
```
IPO: XYZ Company
Scraper: NSE Scraper
Reason: IPO locked by admin
Blocked Fields: companyName, lotSize
Timestamp: 2024-11-05 14:30:25
```

**API Call:**
- `GET /api/admin/protection/notifications`

**Expected Results:**
- Notifications load in <2s
- Filters apply correctly
- Shows 7-day retention (older notifications purged)

---

### Test Scenario 5: Settings Page (15 min)

**Route:** `/admin/settings`

**Test Cases:**
1. ✅ View cache statistics
2. ✅ Display: Total keys, memory usage, hit rate
3. ✅ Clear specific cache pattern
4. ✅ Clear all caches
5. ✅ View notification settings (Email/Telegram)
6. ✅ Test notification configuration

**Cache Management:**
- Total Keys: ~100-500 keys
- Memory Usage: ~1-5 MB
- Hit Rate: Target >80% (current: 92%)

**Cache Patterns:**
- `ipo:*` (all IPO caches)
- `subscription:*` (subscription data)
- `gmp:*` (GMP records)
- `demand:*` (demand data)

**API Calls:**
- `POST /api/admin/cache/clear` (clear caches)
- `GET /api/admin/settings/notifications` (get config)
- `POST /api/admin/settings/notifications` (save config)

**Expected Results:**
- Cache statistics accurate
- Clear operations complete in <1s
- Success confirmation displayed

---

### Test Scenario 6: Audit Log (20 min)

**Route:** `/admin/audit`

**Test Cases:**
1. ✅ View audit log entries
2. ✅ Display: Action, user, IP, timestamp, details
3. ✅ Filter by date range
4. ✅ Filter by action type (CREATE, UPDATE, DELETE, LOGIN, LOGOUT, LOCK, UNLOCK, PROTECT)
5. ✅ Search by IPO or field name
6. ✅ Export audit log to CSV
7. ✅ Pagination controls

**Audit Entry Structure:**
```
Action: UPDATE_FIELD
IPO: integration-test-company
Field: companyName
Old Value: "Old Name"
New Value: "New Name"
User: admin
IP: 127.0.0.1 (anonymized)
Timestamp: 2024-11-05 14:30:25
```

**API Calls:**
- `GET /api/admin/audit` (with filters)
- `GET /api/admin/audit/export` (CSV export)

**Expected Results:**
- Audit log loads in <2s
- Filters apply correctly
- CSV export downloads successfully
- All actions from previous tests appear

---

### Test Scenario 7: Dynamic Admin (Self-Extending System) (30 min)

**Route:** `/admin/dynamic/[table]/list`

**Test Cases:**
1. ✅ Navigate to `/admin/dynamic/ipos/list`
2. ✅ Verify auto-generated table list view
3. ✅ Click "Edit" on any record
4. ✅ Verify auto-generated form from schema
5. ✅ Test field editing
6. ✅ Verify protection system works
7. ✅ Test with multiple tables

**Tables to Test:**
- `ipos` (13 core tables total)
- `subscriptions` (time-series data)
- `gmpRecords` (GMP data)
- `financialData` (financial metrics)

**Expected Behavior:**
```
Schema Introspection → Form Generation → CRUD Operations
```

**API Calls:**
- `GET /api/admin/dynamic/[table]/list` (list records)
- `GET /api/admin/dynamic/[table]/[id]` (get single)
- `PATCH /api/admin/dynamic/[table]/[id]` (update)

**Known Issues:**
- Issue #5: HMR cache may block browser (use production build)

**Expected Results:**
- Tables auto-discovered from schema
- Forms auto-generated with correct field types
- All 450+ fields accessible
- Protection applies automatically

---

### Test Scenario 8: DRHP Extraction (NEW - Week 3) (20 min)

**Route:** `/admin/drhp-extraction`

**Test Cases:**
1. ✅ Navigate to DRHP extraction page
2. ✅ View 3 tabs: Extract, History, Bulk Upload
3. ✅ **Extract Tab:** Upload PDF, trigger extraction
4. ✅ **History Tab:** View past extraction results
5. ✅ **Bulk Upload Tab:** Upload multiple PDFs

**Extract Tab Workflow:**
1. Select IPO from dropdown
2. Upload DRHP PDF file
3. Click "Extract Data"
4. View progress indicator
5. View results with confidence scores
6. Review fields: HIGH (copy directly), MEDIUM (needs review), LOW (manual entry)

**Confidence Levels:**
- **HIGH (>80%)**: Auto-fill safe, green indicator
- **MEDIUM (40-80%)**: Needs review, yellow indicator
- **LOW (<40%)**: Manual entry required, red indicator

**API Calls:**
- `POST /api/admin/drhp/extract` (trigger extraction)
- `GET /api/admin/drhp/ipo/[ipoId]` (get results)
- `POST /api/admin/drhp/reprocess/[id]` (reprocess)

**Expected Results:**
- Upload accepts PDF files only
- Extraction completes in 5-10 seconds
- Results display 16 financial fields
- Confidence scoring accurate (94.1% accuracy target)

**Known Issues:**
- Issue #3: Extraction results viewer broken (MUST FIX FIRST)
- Emcure profit≠revenue validation bug

---

### Test Scenario 9: API Endpoints (30 min)

**Test all 23+ admin endpoints with Bearer token**

**Protection APIs:**
```bash
# Get IPO lock status
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/admin/protection/ipo/$IPO_ID

# Toggle IPO lock
curl -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scraperLocked":true}' \
  http://localhost:3000/api/admin/protection/ipo/$IPO_ID

# Get protected fields
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/admin/protection/fields/$IPO_ID

# Add field protection
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fieldName":"companyName","reason":"Manual edit"}' \
  http://localhost:3000/api/admin/protection/fields/$IPO_ID

# Get notifications
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/admin/protection/notifications
```

**Data APIs:**
```bash
# Update field
curl -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"table":"ipos","field":"companyName","value":"New Name","id":"$IPO_ID"}' \
  http://localhost:3000/api/admin/update-field

# List IPOs
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/admin/ipos?page=1&limit=20

# Get single IPO
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/admin/ipos/$IPO_ID
```

**System APIs:**
```bash
# Clear cache
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pattern":"ipo:*"}' \
  http://localhost:3000/api/admin/cache/clear

# Get audit logs
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/admin/audit?startDate=2024-11-01&endDate=2024-11-06"

# Export audit logs
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/admin/audit/export
```

**Expected Results:**
- All endpoints return 200 OK
- Response times <500ms
- Proper error handling (401 for invalid token)
- Audit logging captures all actions

---

### Test Scenario 10: Performance & Error Handling (20 min)

**Performance Targets:**
- Page Load: <3s (LCP < 2.5s)
- API Response: p95 < 500ms, p99 < 1000ms
- Database Query: p95 < 100ms
- Cache Hit: <10ms
- Cache Miss: <100ms

**Test Cases:**
1. ✅ Measure page load times (all 5 pages)
2. ✅ Measure API response times (10 requests each)
3. ✅ Test error states (invalid IPO slug)
4. ✅ Test network errors (disconnect Redis)
5. ✅ Verify graceful degradation
6. ✅ Test concurrent operations

**Error Scenarios:**
- Invalid IPO slug → 404 error page
- Invalid token → redirect to login
- Redis down → app continues (database fallback)
- Database connection lost → error message
- Network timeout → retry with exponential backoff

**Playwright Performance Measurement:**
```
mcp__playwright__browser_evaluate
function: () => performance.timing.loadEventEnd - performance.timing.navigationStart
```

**Expected Results:**
- All pages load in <3s
- APIs respond in <500ms
- Errors handled gracefully
- No console errors
- App continues if Redis fails

---

### Test Scenario 11: Cross-Browser (Optional - 30 min)

**Browsers to Test:**
1. Chrome/Chromium (primary)
2. Firefox
3. Edge
4. Safari (if available)

**Responsive Design:**
- Desktop: 1920x1080
- Tablet: 768x1024
- Mobile: 375x667

**Test Cases:**
1. ✅ Login works in all browsers
2. ✅ Dashboard renders correctly
3. ✅ Edit page tabs functional
4. ✅ Forms work on mobile viewports
5. ✅ Performance acceptable on all devices

**Playwright Browser Config:**
```typescript
const browsers = ['chromium', 'firefox', 'webkit'];
for (const browser of browsers) {
  await test(browser, async () => {
    // Run test scenarios
  });
}
```

---

### Test Scenario 12: Data Integrity (20 min)

**Test Cases:**
1. ✅ Edit field → verify value persists after refresh
2. ✅ Protect field → verify scraper doesn't overwrite
3. ✅ Lock IPO → verify scraper skips entire IPO
4. ✅ Test concurrent edits (two browser tabs)
5. ✅ Verify audit trail completeness
6. ✅ Test data validation rules

**Data Integrity Checks:**
- Protected field values unchanged after scraper run
- Audit log contains all edit actions
- No data loss during page refresh
- Validation prevents invalid data (negative prices, etc.)

**Scraper Integration Test:**
1. Protect field via admin
2. Run scraper manually
3. Check notification log for blocked update
4. Verify field value unchanged

**Expected Results:**
- 100% protection enforcement
- No data overwrites on protected fields
- Complete audit trail
- Validation prevents bad data

---

## Phase 4: Issue Fix Loop (Iterative)

### Fix Workflow

For each issue found during testing:

**1. Identify**
- Capture error with Playwright screenshot
- Record: URL, action, expected vs actual result
- Check browser console for errors
- Check network tab for API failures

**2. Diagnose**
- Read error message and stack trace
- Check server logs (`npm run dev` output)
- Verify database state (Drizzle Studio)
- Check Redis cache (if applicable)

**3. Fix**
- Make minimal code change to resolve
- Follow existing code patterns
- Maintain type safety
- Add validation if needed

**4. Test**
- Re-run specific test scenario
- Verify fix resolves issue
- Check no new console errors

**5. Verify**
- Run related test scenarios
- Ensure fix doesn't break other features
- Check performance not degraded

**6. Document**
- Add issue to test results log
- Note: symptom, root cause, fix applied
- Update known issues section

### Common Issue Patterns

**Pattern 1: Missing API Endpoint**
```
Symptom: 404 Not Found
Diagnosis: Route file missing or not exported correctly
Fix: Create/fix API route in web/app/api/admin/
Test: curl endpoint with Bearer token
```

**Pattern 2: Type Error**
```
Symptom: TypeScript compilation error
Diagnosis: Incorrect type annotation or missing import
Fix: Update types to match Drizzle schema
Test: Check npm run dev output
```

**Pattern 3: Database Query Error**
```
Symptom: 500 Internal Server Error
Diagnosis: Invalid SQL or missing column
Fix: Check schema, update query
Test: Run query in Drizzle Studio
```

**Pattern 4: React Hydration Error**
```
Symptom: Hydration mismatch warning
Diagnosis: Server-rendered HTML differs from client
Fix: Ensure consistent data fetching
Test: Hard refresh page, check console
```

**Pattern 5: Authentication Failure**
```
Symptom: 401 Unauthorized
Diagnosis: Token missing or invalid
Fix: Check token format, middleware
Test: Verify token in localStorage
```

---

## Phase 5: Final Validation (30 min)

### 5.1 Regression Test (15 min)

**Run all 12 test scenarios again:**
1. Authentication ✅
2. Dashboard ✅
3. Edit Page (all 9 tabs) ✅
4. Notifications ✅
5. Settings ✅
6. Audit Log ✅
7. Dynamic Admin ✅
8. DRHP Extraction ✅
9. API Endpoints ✅
10. Performance ✅
11. Cross-Browser ✅
12. Data Integrity ✅

**Verification Checklist:**
- [ ] All fixes are stable
- [ ] No new issues introduced
- [ ] All test scenarios pass
- [ ] No console errors
- [ ] Performance targets met

### 5.2 Production Build Test (10 min)

**Build and test production version:**
```bash
cd web
npm run build
# Should complete without errors

npm start
# Should start on port 3000 (or auto-assigned)
```

**Test in production mode:**
1. Navigate to http://localhost:3000/admin/login
2. Run abbreviated test suite (scenarios 1, 2, 3)
3. Verify all features work
4. Check performance (should be faster than dev)

**Production-Specific Checks:**
- No HMR errors (Issue #5 resolved)
- Optimized bundle size
- Fast page loads (<1s)
- No development warnings

### 5.3 Documentation (5 min)

**Create test results file:**
- Location: `test-results/admin-comprehensive-test-2025-11-06.md`
- Include:
  - Test execution summary
  - All issues found and fixed
  - Performance metrics
  - Screenshots of key features
  - Known limitations
  - Production readiness score

**Update documentation:**
- `UI_VERIFICATION_STATUS.md` (current status)
- `docs/00-admin/DOCUMENTATION_INDEX.md` (add this test plan)
- `docs/00-admin/README.md` (update status)

---

## Known Issues (From Previous Testing)

### Critical (P0)
**Issue #3: DRHP Extraction Integration Broken**
- **Status:** 🔴 OPEN - Must fix in Phase 1
- **Impact:** Week 3 Task 1B feature completely non-functional
- **Location:** `web/app/admin/edit/[slug]/page.tsx` line ~946
- **Fix:** Add `ipoId={ipo.id}` prop to `<ExtractionResultsViewer />`
- **Effort:** 2 minutes (one-line change)

### High Priority (P1)
**Issue #2: Hyundai Motor India IPO Missing**
- **Status:** ⚠️ OPEN - Non-blocking
- **Impact:** Original test target unavailable
- **Workaround:** Use `integration-test-company` instead
- **Fix:** Run NSE scraper or manual entry

**Issue #5: Schema Introspector HMR Cache**
- **Status:** ⚠️ PARTIALLY FIXED
- **Impact:** Backend works, browser cache blocking
- **Workaround:** Test in production build
- **Root Cause:** Drizzle ORM `getTableConfig` export missing
- **Fix Applied:** Direct property access instead

**Issue #6: DRHP History Tab Fails**
- **Status:** ⚠️ DEPENDENT on Issue #5
- **Impact:** History tab may not load
- **Workaround:** Test in production build

### Medium Priority (P2)
**Dev Environment Instability**
- **Status:** ⚠️ ONGOING
- **Impact:** Multiple zombie Node processes
- **Symptoms:** Port conflicts, HMR errors
- **Fix:** Kill all Node processes, clear cache, restart server

### Low Priority (P3)
**Data Completeness**
- 10 IPOs missing pricing data (legitimate nulls - RIGHTS/InvITs/REITs)
- Non-blocking, by design for non-standard offerings

---

## Test Results Log

### Test Execution Summary
- **Start Date:** [To be filled during testing]
- **End Date:** [To be filled]
- **Total Duration:** [To be filled]
- **Tester:** Claude Opus 4.1 + Playwright MCP
- **Environment:** Development (http://localhost:3000)

### Results by Scenario

**Scenario 1: Authentication**
- Status: [PASS/FAIL]
- Duration: [minutes]
- Issues Found: [count]
- Notes: [details]

**Scenario 2: Dashboard**
- Status: [PASS/FAIL]
- Duration: [minutes]
- Issues Found: [count]
- Notes: [details]

**Scenario 3: Edit Page (9 tabs)**
- Status: [PASS/FAIL]
- Duration: [minutes]
- Issues Found: [count]
- Notes: [details]

**Scenario 4: Notifications**
- Status: [PASS/FAIL]
- Duration: [minutes]
- Issues Found: [count]
- Notes: [details]

**Scenario 5: Settings**
- Status: [PASS/FAIL]
- Duration: [minutes]
- Issues Found: [count]
- Notes: [details]

**Scenario 6: Audit Log**
- Status: [PASS/FAIL]
- Duration: [minutes]
- Issues Found: [count]
- Notes: [details]

**Scenario 7: Dynamic Admin**
- Status: [PASS/FAIL]
- Duration: [minutes]
- Issues Found: [count]
- Notes: [details]

**Scenario 8: DRHP Extraction**
- Status: [PASS/FAIL]
- Duration: [minutes]
- Issues Found: [count]
- Notes: [details]

**Scenario 9: API Endpoints**
- Status: [PASS/FAIL]
- Duration: [minutes]
- Issues Found: [count]
- Notes: [details]

**Scenario 10: Performance**
- Status: [PASS/FAIL]
- Duration: [minutes]
- Issues Found: [count]
- Notes: [details]

**Scenario 11: Cross-Browser**
- Status: [PASS/FAIL]
- Duration: [minutes]
- Issues Found: [count]
- Notes: [details]

**Scenario 12: Data Integrity**
- Status: [PASS/FAIL]
- Duration: [minutes]
- Issues Found: [count]
- Notes: [details]

### Issues Found and Fixed

**Issue #1:**
- **Title:** [Issue title]
- **Priority:** [P0/P1/P2/P3]
- **Scenario:** [Which test found it]
- **Symptom:** [What user sees]
- **Root Cause:** [Technical explanation]
- **Fix:** [What was changed]
- **Verification:** [How we confirmed fix]
- **Duration:** [Time to fix]

### Performance Metrics

**Page Load Times:**
- Login: [ms]
- Dashboard: [ms]
- Edit Page: [ms]
- Notifications: [ms]
- Settings: [ms]
- Audit Log: [ms]

**API Response Times:**
- p50: [ms]
- p95: [ms]
- p99: [ms]

**Cache Performance:**
- Hit Rate: [%]
- Memory Usage: [MB]
- Total Keys: [count]

### Production Readiness Score

**Overall Score:** [0-100]

**Category Scores:**
- Functionality: [0-100]
- Performance: [0-100]
- Stability: [0-100]
- Security: [0-100]
- Documentation: [0-100]

**Deployment Recommendation:**
- [ ] ✅ Ready for production
- [ ] ⚠️ Ready with known limitations
- [ ] 🔴 Not ready - critical issues remain

---

## Expected Outcomes

### Success Criteria

✅ **All 5 admin pages functional**
- Login, Dashboard, Edit, Notifications, Settings

✅ **All 9 edit tabs working correctly**
- Basic Info, Financials, Objectives, Subscriptions, GMP, Documents, Listing, Peers, Protection

✅ **Protection system verified**
- IPO-level lock functional
- Field-level protection functional
- Auto-protection on edit working

✅ **Audit logging capturing all actions**
- All edit actions logged
- Filters and export working

✅ **Cache management operational**
- Statistics accurate
- Clear operations working

✅ **DRHP extraction integration working**
- Results viewer displays correctly
- Copy to form functionality works

✅ **Dynamic admin system functional**
- Tables auto-discovered
- Forms auto-generated
- All 450+ fields accessible

✅ **All API endpoints responding correctly**
- 23+ endpoints tested
- Response times <500ms
- Proper authentication

✅ **Performance targets met**
- Page load <3s
- API response <500ms
- Cache hit rate >80%

✅ **No critical errors in console**
- No React errors
- No type errors
- No network errors

### Known Limitations to Accept

⚠️ **HMR issues in development**
- Workaround: Test in production build
- Not blocking for production deployment

⚠️ **Some IPOs may be missing**
- e.g., Hyundai Motor India
- Non-blocking, data completeness issue

⚠️ **Document upload not implemented**
- Phase 6 feature
- Documents view-only for now

⚠️ **360 fields not accessible via traditional UI**
- Only ~90 of 450 fields in main edit tabs
- Dynamic admin provides access to all

---

## Time Estimate

| Phase | Duration | Description |
|-------|----------|-------------|
| **Phase 0** | 2 min | Save this testing plan |
| **Phase 1** | 30 min | Environment setup + fix Issue #3 |
| **Phase 2** | 15 min | Playwright MCP setup |
| **Phase 3** | 2-3 hours | Comprehensive testing (12 scenarios) |
| **Phase 4** | 1-2 hours | Iterative fix loop |
| **Phase 5** | 30 min | Final validation + documentation |
| **Total** | **4-6 hours** | Complete testing + fixes |

---

## Tools & Commands Reference

### Development Commands
```bash
# Start dev server
cd web && npm run dev

# Build production
npm run build

# Start production server
npm start

# Database management
npm run db:migrate
npm run db:studio
npm run seed
npm run verify:seed

# Testing
npx playwright test tests/e2e/admin/
npx playwright test --ui
npx playwright test --headed
```

### Clean Environment
```bash
# Clear cache
rm -rf .next node_modules/.cache .turbo

# Kill zombie processes (Windows)
taskkill /F /IM node.exe
tasklist | findstr node

# Kill zombie processes (Linux/Mac)
pkill -f "next-server"
ps aux | grep node

# Check ports
netstat -ano | findstr "3000"
netstat -ano | findstr "5432"  # PostgreSQL
netstat -ano | findstr "6379"  # Redis
```

### API Testing
```bash
# Set token
export ADMIN_TOKEN="your-token-here"

# Test authentication
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/api/admin/protection/notifications

# Test IPO lock
curl -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scraperLocked":true}' \
  http://localhost:3000/api/admin/protection/ipo/$IPO_ID
```

### Playwright MCP Commands
```
# Navigate
mcp__playwright__browser_navigate
url: http://localhost:3000/admin/login

# Snapshot
mcp__playwright__browser_snapshot

# Click
mcp__playwright__browser_click
element: "Login button"
ref: [element reference]

# Type
mcp__playwright__browser_type
element: "Token input"
text: "your-admin-token"

# Evaluate
mcp__playwright__browser_evaluate
function: () => localStorage.getItem('admin_token')

# Screenshot
mcp__playwright__browser_take_screenshot
filename: "admin-dashboard.png"
```

---

## Related Documentation

- **[COMPLETE_SYSTEM_SUMMARY.md](./COMPLETE_SYSTEM_SUMMARY.md)** - System overview (v2.0.0)
- **[Admin-IPO-Data-Flow.md](./Admin-IPO-Data-Flow.md)** - Gap analysis & Phase 6 plan
- **[E2E_TESTING.md](./E2E_TESTING.md)** - Existing E2E test suite (100+ tests)
- **[QUICK_START_ADMIN_API.md](./QUICK_START_ADMIN_API.md)** - API testing guide
- **[DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md)** - All 37+ admin docs

---

**Status:** ⏳ READY FOR EXECUTION
**Last Updated:** 2025-11-06
**Next Review:** After test execution completion
