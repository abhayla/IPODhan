# Phase 2: Core Pages Testing (Headed Mode)

**[← Back to Index](README.md)** | **[Overview](00-TESTING-OVERVIEW.md)** | **[Phase 1](01-PHASE-1-DATA-QUALITY.md)** | **[Phase 3 →](03-PHASE-3-TOOLS-FEATURES.md)**

---

## Phase Overview

**Estimated Time:** 2-3 days
**Focus:** Homepage, Dashboard, Historical IPOs, IPO Detail pages
**Prerequisites:** Phase 1 complete with all scrapers SUCCESS
**Loop Pattern:** Test ALL → Document → Fix ALL → Re-test → Verify → Gate Check

**Screens Tested:**
- Homepage
- Dashboard (filters, search, pagination)
- Historical IPOs page
- IPO Detail pages (all sections)

---

### 📚 Architecture References for Phase 2

Review these before testing core pages:
- **Backend Architecture**: `docs/02-architecture/backend-architecture.md`
- **API Specification**: `docs/02-architecture/api-specification.md`
- **UI-Database Mapping**: `docs/16-database/screen-table-database-field-mapping.md`

These documents explain the repository pattern, API routes, and how UI screens map to database tables.

---

### ITERATION 1: Test All Core Pages + Issue Discovery

**Playwright Configuration (Headed Mode):**
```javascript
headless: false
slowMo: 300
viewport: { width: 1920, height: 1080 }
devtools: true
```

**15. ✅ ENHANCEMENT #7: Dashboard Filter Combinations**

**Test Individual Filters:**
```
Status Filter:
- Click "OPEN" → Verify only OPEN IPOs shown
- Click "UPCOMING" → Verify only UPCOMING IPOs shown
- Click "CLOSED" → Verify only CLOSED IPOs shown
- Click "LISTED" → Verify only LISTED IPOs shown

Category Filter:
- Select "MAINBOARD" → Verify only MAINBOARD IPOs shown
- Select "SME" → Verify only SME IPOs shown
- Select "ALL" → Verify both categories shown

Sector Filter:
- Select "Technology" → Verify only Tech sector IPOs shown
- Select "Finance" → Verify only Finance sector IPOs shown
- Try each available sector
```

**Test Combined Filters:**
```
Combinations to test:
- Status=OPEN + Category=MAINBOARD
- Status=OPEN + Category=SME
- Status=LISTED + Sector=Technology
- Status=OPEN + Category=MAINBOARD + Sector=Finance
- All 3 filters together (10-15 combinations)

For each combination:
✓ Verify results match ALL applied filters
✓ Check result count is accurate
✓ Verify no IPOs shown that don't match filters
```

**Filter Persistence Test:**
```
Step 1: Apply filters (Status=OPEN, Category=MAINBOARD)
Step 2: Click on an IPO to view details
Step 3: Click browser back button
Step 4: Verify filters still applied
Step 5: Verify same results shown
```

**URL Parameter Verification:**
```
Check URL when filters applied:
- Status filter → ?status=OPEN
- Category filter → ?category=MAINBOARD
- Sector filter → ?sector=Technology
- Search → ?search=reliance
- Combined → ?status=OPEN&category=MAINBOARD&sector=Finance

Test: Copy URL, paste in new tab → Verify same filters applied
```

**Clear Filters Test:**
```
Step 1: Apply multiple filters
Step 2: Click "Clear Filters" button
Step 3: Verify all filters reset to default
Step 4: Verify URL parameters cleared
Step 5: Verify default results shown
```

**Filter Count Accuracy:**
```
For each filter option, verify count badge:
- "OPEN (15)" → Should be exactly 15 OPEN IPOs
- "MAINBOARD (42)" → Should be exactly 42 MAINBOARD IPOs
- "Technology (8)" → Should be exactly 8 Technology sector IPOs

Cross-check with database:
SELECT COUNT(*) FROM ipos WHERE status = 'OPEN';
```

**Empty Results Test:**
```
Apply filter combination with no results:
- Example: Status=OPEN + Sector=NonExistent

Verify:
✓ Empty state component displays
✓ Message: "No IPOs found matching your criteria"
✓ "Clear Filters" button shown
✓ No error thrown
```

**Filter + Search Combination:**
```
Test 1: Apply Status=OPEN, then search "Bajaj"
→ Should show only OPEN IPOs with "Bajaj" in name

Test 2: Search "Reliance", then apply Category=MAINBOARD
→ Should show only MAINBOARD IPOs with "Reliance" in name
```

**Filter + Pagination:**
```
Step 1: Apply Status=OPEN
Step 2: Navigate to page 2
Step 3: Verify Status=OPEN still applied on page 2
Step 4: Verify URL: ?status=OPEN&page=2
```

**🔄 AUTO-IMPROVEMENT TRIGGER:**
```
IF filter returns wrong results:
  CLASSIFY: Frontend Bug - Filter Logic

  ROOT CAUSE: Check API query params, database query

  GENERATE TESTS:
  - [ ] Test this specific filter combination again
  - [ ] Test all other combinations with same filter
  - [ ] Test filter + search combination
  - [ ] Test filter + pagination
  - [ ] Verify URL parameter encoding
  - [ ] Check API response matches displayed results
  - [ ] Test filter persistence across navigation
  - [ ] Verify database query with EXPLAIN ANALYZE

  IF pattern: Multiple filter combinations failing:
    EXPAND: Test ALL filter combinations (exhaustive)

  ADD TO: Iteration 2
```

**16. ✅ ENHANCEMENT #8: Search Functionality**

**Exact Match:**
```
Dashboard page:
Step 1: Enter "Bajaj Housing Finance" in search box
Step 2: Press Enter or click search
Step 3: Verify exact IPO appears in results
Step 4: Check URL: ?search=Bajaj+Housing+Finance
```

**Partial Match:**
```
Test: Search for "Bajaj"
Expected: Shows all IPOs with "Bajaj" in company name
Verify: All results contain "Bajaj"
```

**Case Insensitive:**
```
Test 1: Search "reliance" (lowercase)
Test 2: Search "RELIANCE" (uppercase)
Test 3: Search "Reliance" (mixed case)
Expected: All three return identical results
```

**Special Characters:**
```
Test companies with special characters:
- Search "L&T" → Should find "Larsen & Toubro"
- Search "Larsen & Toubro" → Should find company
- Search "L T" (space) → Should still find company
- Search "Tata-Motors" → Should find "Tata Motors"
```

**Empty Search Results:**
```
Step 1: Search "XYZ NonExistent Company 12345"
Step 2: Verify empty state displays
Step 3: Check message shows search term
Step 4: Verify "Clear search" option available
```

**Search Highlighting:**
```
Step 1: Search "Bajaj"
Step 2: In results, verify "Bajaj" is highlighted
Step 3: Check HighlightedText component used
```

**Search Performance:**
```
Use browser DevTools:
Step 1: Open dashboard
Step 2: Start performance recording
Step 3: Type in search box
Step 4: Press Enter
Step 5: Measure time to first result

Target: <200ms
```

**Search + Filters:**
```
Test: Apply Status=OPEN filter, then search "Tech"
Expected: Only OPEN IPOs with "Tech" in name
Verify: URL: ?status=OPEN&search=Tech
```

**Search Persistence:**
```
Step 1: Search "Reliance"
Step 2: Click on an IPO from results
Step 3: Navigate back
Step 4: Verify "Reliance" still in search box
Step 5: Verify search results still filtered
```

**Edge Cases:**
```
Test unusual inputs:
- Empty string: ""
- Single character: "A"
- Very long string: "A" repeated 500 times
- Numbers only: "123"
- Symbols: "@#$%"
- SQL injection: "'; DROP TABLE ipos; --"
- XSS: "<script>alert('xss')</script>"

Expected: All handled gracefully, no errors
```

**🔄 AUTO-IMPROVEMENT TRIGGER:**
```
IF search doesn't find expected IPO:
  CLASSIFY: Frontend Bug - Search Logic

  ROOT CAUSE: Check search algorithm, database index

  GENERATE TESTS:
  - [ ] Test exact company name search
  - [ ] Test with variations: UPPERCASE, lowercase, Mixed Case
  - [ ] Test with abbreviations
  - [ ] Test with special characters removed
  - [ ] Check database: Does IPO exist with exact name?
  - [ ] Verify trigram index on company_name
  - [ ] Test API search endpoint directly
  - [ ] Check SQL search query (LIKE vs ILIKE vs trigram)
  - [ ] Measure search query performance (EXPLAIN ANALYZE)

  IF search too slow (>500ms):
    GENERATE:
    - [ ] Check database indexes used
    - [ ] Verify index on company_name exists
    - [ ] Consider full-text search (PostgreSQL tsvector)
    - [ ] Add caching for common searches

  ADD TO: Iteration 2 comprehensive search testing
```

**17. ✅ ENHANCEMENT #9: View Toggle (Grid/List)**
```
Test:
- Switch between Grid and List views
- State persists on refresh
- Data consistency between views
- Responsive behavior on mobile
- URL parameter: ?view=grid or ?view=list
```

**18. ✅ ENHANCEMENT #10: Pagination**
```
Test:
- Navigate pages 1, 2, 3, last
- Verify 12 items per page
- Total count accuracy
- URL: ?page=2
- No duplicate items across pages
- Edge cases: <12 IPOs, partial last page
```

**19. ✅ ENHANCEMENT #11: IPO Detail Page - All Sections**

Test EVERY section with real data:

**Company Overview:**
- Company name displays
- Company description
- Sector
- Open/close/listing dates
- Price band (low/high)
- Lot size
- Issue size
- Status badge

**Financial Tables:**
- Revenue FY1, FY2, FY3
- Profit FY1, FY2, FY3
- PE ratio
- PB ratio
- ROE percentage
- ROCE percentage
- Debt to equity
- Industry PE

**GMP Chart:**
- Recharts component renders
- Historical GMP data displays
- X-axis (dates), Y-axis (GMP values)
- Tooltip shows details
- No rendering errors

**Subscription Breakdown:**
- QIB subscription
- NII subscription
- Retail subscription
- Employee subscription (if applicable)
- Visual breakdown (charts/progress bars)
- Subscription times displayed

**Peer Comparison Table:**
- Peer companies listed
- PE ratio for each peer
- EPS, RONW, NAV, PBV
- All metrics aligned correctly

**Documents List:**
- DRHP link (if available)
- RHP link (if available)
- Prospectus link
- Addendum links
- Click each link → verify PDF opens
- Verify exchange badges (NSE/BSE)

**Allotment Checker:**
- Form visible
- PAN input field
- Submit button
- (Test in next phase)

**Affiliate Section:**
- Zerodha button visible
- AngelOne button visible
- Disclaimer text
- (Test tracking in next phase)

**IPO Reviews:**
- Review cards display
- Author name
- Recommendation (Subscribe/Avoid/etc.)
- Published date
- Review content preview
- Link to full review

**⚠️ Reviews Limitation**: No centralized reviews API (see Current Implementation Status).
- Reviews are per-IPO embedded content only
- Expect lower coverage - many IPOs may NOT have reviews
- Absence of reviews is normal, not a bug
- Focus testing on: Do reviews display correctly when present?

**🔄 AUTO-IMPROVEMENT TRIGGER:**
```
IF any section shows "undefined" or null data:
  CLASSIFY: Data Display Issue

  ROOT CAUSE: Missing null checks, incomplete data

  GENERATE TESTS:
  - [ ] Test this IPO specifically with all sections
  - [ ] Check database: Which fields are NULL?
  - [ ] Test component null handling for each field
  - [ ] Verify loading states while data fetches
  - [ ] Test with mock empty data
  - [ ] Add default values or placeholders
  - [ ] Test error boundary catches null errors

  EXPAND TO ALL IPOs:
  - [ ] Test 10 random IPOs for same issue
  - [ ] Query: SELECT COUNT(*) FROM ipos WHERE [field] IS NULL
  - [ ] Generate report: Which fields commonly NULL?
  - [ ] Decide: Should these be required fields?

  IF pattern: Multiple IPOs missing same field:
    → This is a DATA issue, add to Phase 1
    → Re-run scraper for this field

  ADD TO: Iteration 2
```

**20. ✅ ENHANCEMENT #12: SEO & Structured Data**
```
Test:
- Meta tags: title, description, OG tags on all pages
- Validate JSON-LD structured data
- FinancialProduct schema on IPO detail pages
- CollectionPage schema on dashboard
- Canonical URLs
- Test generateMetadata() functions work
```

**21. ✅ ENHANCEMENT #13: Affiliate Tracking**
```
Test:
- Click Zerodha button
- Verify POST to /api/affiliate/track in Network tab
- Check response status 200
- Query affiliate_clicks table for new record
- Verify userSession, source, ipoId fields
- Check Pino logs show tracking event
- Repeat for AngelOne button
```

**🔄 AUTO-IMPROVEMENT TRIGGER:**
```
IF affiliate click not tracked:
  CLASSIFY: Integration Issue

  ROOT CAUSE: Check API call, database insert

  GENERATE TESTS:
  - [ ] Check browser Network tab: Is POST request sent?
  - [ ] Verify request payload correct
  - [ ] Check API response status
  - [ ] Query affiliate_clicks table: Is record there?
  - [ ] Test with different browsers
  - [ ] Check CORS headers
  - [ ] Verify userSession calculation
  - [ ] Test with ad blockers enabled
  - [ ] Check Pino logs for tracking events

  IF API returns error:
    - [ ] Check validation schema (Zod)
    - [ ] Verify enum values match (broker, source)
    - [ ] Test with invalid data to verify validation

  ADD TO: Iteration 2
```

**22. Historical IPOs Page**
```
Test:
- Navigate to /history
- Test filters: year, sector, performance
- Test sort options (date, gain %)
- Verify pagination
- Check data accuracy
- Test search functionality
```

**23. Homepage**
```
Test:
- Hero section loads
- Featured IPOs display
- Navigation works
- All links functional
- No console errors
```

### ITERATION 2: Fix All Frontend Issues

**24. ✅ ENHANCEMENT #23: Error Boundary Testing**
```
Test:
- Trigger errors deliberately (modify data to cause crash)
- Verify dashboard/error.tsx catches errors
- Test /ipos/nonexistent-slug shows not-found.tsx
- Verify dashboard/loading.tsx during fetch
- ErrorBoundary component displays properly
- Error messages user-friendly
```

**25. ✅ ENHANCEMENT #26: Mobile Responsiveness**
```
Test with mobile viewport (375x667):
- Dashboard filters in mobile menu/drawer
- IPO cards stack vertically
- Detail page tabs work on mobile
- Affiliate buttons fit on mobile
- Financial tables scroll horizontally
- GMP chart responsive
- All touch interactions work
- No horizontal overflow
```

### ITERATION 3: Re-test All Core Pages

**Execute all tests from Iteration 1 + auto-generated tests**

### ITERATION 4: Final Verification
- All pages load <3s
- Zero console errors
- All data displays correctly
- All interactions work
- Mobile responsive
- Git commit

**✅ GATE: Phase 2 Complete - Proceed to Phase 3**

---

### 📝 GIT CHECKPOINT: Commit Phase 2 Results

**Action Required**: Commit all Phase 2 testing work before proceeding to Phase 3.

```bash
# Commit Phase 2 completion
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-2/
git commit -m "test(phase-2): Complete core pages testing

✅ Dashboard filters and search functional
✅ IPO detail pages display all sections correctly
✅ Historical IPOs page working
✅ All pages load <3s, zero console errors
✅ Mobile responsive (375x667 viewport)
✅ SEO metadata and structured data validated

Issues resolved: [count] (see TEST_ISSUES.json)
Pages tested: Homepage, Dashboard, Historical, IPO Detail"

git push origin test/story-[number]
```

---

**Next Phase:** → [03-PHASE-3-TOOLS-FEATURES.md](03-PHASE-3-TOOLS-FEATURES.md)
