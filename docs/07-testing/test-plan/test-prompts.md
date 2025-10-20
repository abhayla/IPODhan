# Testing Phase Invocation Prompts

**[← Back to Index](README.md)**

This document contains ready-to-use prompts for invoking each testing phase individually or all phases sequentially.

---

## How to Use These Prompts

### Option 1: Individual Phase Testing
Copy the prompt for the specific phase you want to test and use it with Claude Code or your testing workflow.

### Option 2: Sequential All-Phase Testing
Use the consolidated prompt at the bottom to execute all 5 phases in sequence with checkpoints between phases.

### Important Notes
- All prompts assume you've reviewed [00-TESTING-OVERVIEW.md](00-TESTING-OVERVIEW.md) for safety protocols
- Production database approval process applies to ALL data modifications
- Git checkpoints should be created after each phase completion
- Follow the testing loop: Test → Document → Fix → Re-test

---

## Individual Phase Prompts

### Phase 1: Data Quality & Scraping Validation

```
I need to execute Phase 1 of the IPODhan testing plan: Data Quality & Scraping Validation.

**Phase Document:** docs/07-testing/test-plan/01-PHASE-1-DATA-QUALITY.md

**Objective:**
Validate database integrity, scraper health, and field coverage across all 16 database tables.

**Architecture References to Review:**
- packages/shared/src/db/schema.ts (single source of truth for schema)
- docs/16-database/SCHEMA_MANAGEMENT.md (schema workflow)
- scraper/README.md (scraper architecture)
- docs/16-database/screen-table-database-field-mapping.md (UI-database mapping)

**Database Connection:**
- Host: 103.118.16.189:5432/ipodhan
- CRITICAL: This is LIVE PRODUCTION DATA
- All data modifications require explicit approval

**Phase Overview:**
This phase includes 4 iterations:
1. **Iteration 1**: Basic data existence checks (6 tests)
2. **Iteration 2**: Field coverage analysis (Critical, Important, Enhanced fields)
3. **Iteration 3**: Repository Pattern & Cache-Aside validation (Enhancement #13 - comprehensive 7-step validation)
4. **Iteration 4**: New data enhancements (Scoring, Peers, Issue Details, Financials, Registrar, Broker Affiliates)

**Estimated Time:** 3-5 days

**Testing Approach:**
Follow the testing loop pattern:
1. Read the test specification
2. Execute the test (SQL queries, API calls, repository checks)
3. Document results in TEST_PROGRESS.md
4. If issues found, log in TEST_ISSUES.json
5. Apply fixes if needed
6. Re-test to verify fix
7. Move to next test

**SQL Queries:**
Reference APPENDIX-B-SQL-QUERIES.md for all validation queries.

**Success Criteria:**
- All 16 tables have data
- Critical fields: 100% coverage for OPEN/UPCOMING IPOs
- Important fields: >90% coverage
- All repositories extend BaseRepository with cache-aside pattern
- Cache hit rate >80% for detail/list endpoints
- Repository pattern validation: All 7 steps pass
- All new enhancement tables populated (ipo_scores, peer_companies, etc.)

**Git Checkpoint (after completion):**
```bash
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-1/
git commit -m "test(phase-1): Complete data quality and scraping validation

✅ Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main
```

**Let's begin with Iteration 1, Test #1: Basic IPO table record count.**
```

---

### Phase 2: Core Pages Testing

```
I need to execute Phase 2 of the IPODhan testing plan: Core Pages Testing.

**Phase Document:** docs/07-testing/test-plan/02-PHASE-2-CORE-PAGES.md

**Objective:**
Test all core user-facing pages including dashboard, IPO detail pages, search, historical IPOs, and homepage.

**Prerequisites:**
- Phase 1 must be complete (data quality validated)
- All database tables populated
- Repository pattern validated
- Cache layer functioning

**Architecture References to Review:**
- docs/02-architecture/backend-architecture.md (repository and service patterns)
- docs/02-architecture/api-specification.md (API response formats)
- docs/16-database/screen-table-database-field-mapping.md (UI to database mapping)

**Database Connection:**
- Host: 103.118.16.189:5432/ipodhan
- CRITICAL: This is LIVE PRODUCTION DATA

**Phase Overview:**
Test the following pages:
1. Dashboard with filter combinations (Enhancement #7)
2. IPO Detail page sections (Enhancements #8-12): Overview, Subscription, GMP, Financials, Documents
3. Search functionality
4. Historical IPOs page
5. Homepage
6. Error boundary testing (Enhancement #23)
7. Mobile responsiveness (Enhancement #26)
8. SEO & structured data (Enhancement #18)

**Estimated Time:** 2-3 days

**Testing Tools:**
- Playwright for E2E testing (headed mode for UI verification)
- Browser DevTools for console errors
- Mobile viewport: 375x667 (iPhone SE)
- Desktop viewport: 1920x1080

**Testing Approach:**
1. Start dev server: `npm run dev` in web/ directory
2. Open Playwright in headed mode: `npx playwright test --headed --project=chromium`
3. Verify UI elements render correctly
4. Check console for errors (should be 0 errors)
5. Test filter combinations on dashboard
6. Verify all detail page sections display data
7. Test mobile responsiveness
8. Validate SEO metadata

**Success Criteria:**
- All pages load without errors
- Console errors: 0
- All filter combinations work on dashboard
- IPO detail sections display complete data
- Search returns relevant results
- Mobile layout renders correctly (no horizontal scroll)
- Error boundaries catch and display errors gracefully
- SEO metadata present on all pages

**Git Checkpoint (after completion):**
```bash
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-2/
git commit -m "test(phase-2): Complete core pages testing

✅ Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main
```

**Let's begin by testing the dashboard filter combinations.**
```

---

### Phase 3: Tools & Features Testing

```
I need to execute Phase 3 of the IPODhan testing plan: Tools & Features Testing.

**Phase Document:** docs/07-testing/test-plan/03-PHASE-3-TOOLS-FEATURES.md

**Objective:**
Test all investor tools including Lot Calculator, IPO Compare Tool, Allotment Checker, and utility pages.

**Prerequisites:**
- Phase 1 and Phase 2 must be complete
- Core pages validated
- IPO data available in database

**Architecture References to Review:**
- docs/02-architecture/backend-architecture.md (service layer patterns)
- docs/16-database/screen-table-database-field-mapping.md (tool calculations)

**Database Connection:**
- Host: 103.118.16.189:5432/ipodhan
- CRITICAL: This is LIVE PRODUCTION DATA

**Phase Overview:**
Test the following tools and features:
1. **Lot Calculator** (Enhancement #14): Calculate lots based on investment amount
2. **IPO Compare Tool** (Enhancement #15): Multi-IPO comparison with side-by-side data
3. **Allotment Checker** (Enhancement #16): Form validation and registrar integration
4. **Registrars Page**: List of all registrars with contact details
5. **Market Holidays**: Trading holiday calendar

**Estimated Time:** 1-2 days

**Testing Focus:**
- **Calculation Accuracy**: Lot calculator formula validation
- **Form Validation**: Input sanitization and error messages
- **Multi-IPO Logic**: Compare tool handles 2-5 IPOs correctly
- **Data Display**: All tool outputs show correct data

**Testing Approach:**
1. Start dev server: `npm run dev` in web/ directory
2. Navigate to each tool page
3. Test with various inputs (edge cases, invalid inputs, valid inputs)
4. Verify calculations against manual calculations
5. Test form validation (required fields, input formats)
6. Verify error messages are user-friendly

**Test Cases:**

**Lot Calculator:**
- Test with investment = 15000, price = 100, lot size = 75
  - Expected: floor(15000 / (100 * 75)) = 2 lots
- Test with investment = 0 (should show validation error)
- Test with invalid inputs (negative numbers, non-numeric)

**IPO Compare Tool:**
- Test comparing 2 IPOs (minimum)
- Test comparing 5 IPOs (maximum)
- Test comparing IPOs from different categories (MAINBOARD vs SME)
- Verify all comparison fields display correctly

**Allotment Checker:**
- Test form validation (PAN, application number, DP ID)
- Test registrar selection dropdown
- Verify form submission (mock or actual registrar integration)

**Success Criteria:**
- Lot calculator: 100% accurate calculations
- Compare tool: Handles 2-5 IPOs correctly, side-by-side layout
- Allotment checker: Form validation working, registrar links functional
- Registrars page: All registrars listed with contact details
- Market holidays: Current year holidays displayed

**Git Checkpoint (after completion):**
```bash
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-3/
git commit -m "test(phase-3): Complete tools and features testing

✅ Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main
```

**Let's begin by testing the Lot Calculator with various input scenarios.**
```

---

### Phase 4: Category Pages Testing

```
I need to execute Phase 4 of the IPODhan testing plan: Category Pages Testing.

**Phase Document:** docs/07-testing/test-plan/04-PHASE-4-CATEGORY-PAGES.md

**Objective:**
Validate Mainboard/SME segregation and test all 12 category-specific pages plus special categories.

**Prerequisites:**
- Phase 1, 2, and 3 must be complete
- IPO data exists in both MAINBOARD and SME categories
- Category filtering logic validated

**Architecture References to Review:**
- docs/16-database/screen-table-database-field-mapping.md (category filtering)
- docs/02-architecture/api-specification.md (pagination and filtering)

**Database Connection:**
- Host: 103.118.16.189:5432/ipodhan
- CRITICAL: This is LIVE PRODUCTION DATA

**Phase Overview:**
Test Mainboard/SME segregation across:
1. **6 Mainboard Pages**: Landing, Calendar, Performance, Prospectus, Listings, Reviews
2. **6 SME Pages**: Same structure as Mainboard, separate category filter
3. **Special Categories**: OFS, NCD, Rights, FPO (if data exists)

**Key Validation: No Cross-Contamination** (Enhancement #17)
- Mainboard pages show ONLY category='MAINBOARD' IPOs
- SME pages show ONLY category='SME' IPOs
- No mixing of categories

**Estimated Time:** 1-2 days

**Testing Approach:**
1. Start dev server: `npm run dev` in web/ directory
2. Navigate to each category page
3. Verify category filter is applied in API calls
4. Check that no cross-category data appears
5. Test empty states (categories with no data)
6. Verify pagination works within category

**SQL Validation Queries:**

```sql
-- Verify MAINBOARD IPOs don't appear in SME pages
SELECT company_name, category
FROM ipos
WHERE category != 'MAINBOARD'
AND id IN (SELECT ipo_id FROM [SME_page_query_results]);
-- Should return 0 rows

-- Verify SME IPOs don't appear in MAINBOARD pages
SELECT company_name, category
FROM ipos
WHERE category != 'SME'
AND id IN (SELECT ipo_id FROM [MAINBOARD_page_query_results]);
-- Should return 0 rows
```

**Test Cases:**

**For Each Mainboard Page:**
1. Navigate to page (e.g., /mainboard, /mainboard/calendar)
2. Open browser DevTools > Network tab
3. Verify API call includes `category=MAINBOARD` filter
4. Check response data: all IPOs have `category: 'MAINBOARD'`
5. Count displayed IPOs matches database count for MAINBOARD

**For Each SME Page:**
1. Navigate to page (e.g., /sme, /sme/calendar)
2. Open browser DevTools > Network tab
3. Verify API call includes `category=SME` filter
4. Check response data: all IPOs have `category: 'SME'`
5. Count displayed IPOs matches database count for SME

**Empty State Testing:**
1. Test category with 0 IPOs (e.g., FPO if no data)
2. Verify empty state message displays
3. Verify no errors in console

**Success Criteria:**
- Zero cross-contamination (MAINBOARD pages show only MAINBOARD, SME only SME)
- All 12 pages render correctly
- Category filters applied in all API calls
- Empty states display gracefully
- Pagination respects category boundaries
- Special categories (OFS, NCD, Rights, FPO) display correctly if data exists

**Git Checkpoint (after completion):**
```bash
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-4/
git commit -m "test(phase-4): Complete category pages testing

✅ Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main
```

**Let's begin by testing the Mainboard landing page for category filtering.**
```

---

### Phase 5: Integration & Performance Testing

```
I need to execute Phase 5 of the IPODhan testing plan: Integration & Performance Testing.

**Phase Document:** docs/07-testing/test-plan/05-PHASE-5-INTEGRATION.md

**Objective:**
Comprehensive integration testing including API endpoints, caching, fault tolerance, performance benchmarking, and security.

**Prerequisites:**
- All previous phases (1-4) must be complete
- Full application stack running (Next.js, PostgreSQL, Redis)
- Production-like environment

**Architecture References to Review:**
- docs/05-caching/CACHING_STRATEGY.md (complete caching strategy)
- docs/02-architecture/security-and-performance.md (performance targets)
- docs/02-architecture/backend-architecture.md (repository caching patterns)
- docs/02-architecture/testing-strategy.md (automated testing approach)

**Database Connection:**
- Host: 103.118.16.189:5432/ipodhan
- CRITICAL: This is LIVE PRODUCTION DATA

**Phase Overview:**
This is the longest and most comprehensive phase, including:
1. **ISR Testing** (Enhancement #19): Incremental Static Regeneration validation
2. **API Endpoint Testing** (Enhancement #20): 23 existing + 12 missing endpoints
3. **Rating Calculation** (Enhancement #21): IPO scoring algorithm validation
4. **Database Performance** (Enhancement #22): Query optimization and benchmarking
5. **Redis Caching & Fault Tolerance** (Enhancement #24): 3 failure scenarios + graceful degradation
6. **Logging & Monitoring** (Enhancement #25): Structured logging validation
7. **User Journey Testing**: 4 critical end-to-end user flows
8. **Data Consistency** (Enhancement #27): Cross-table validation
9. **Security Tests** (Enhancement #28): Input validation, SQL injection, XSS prevention

**Estimated Time:** 4-6 days

**Performance Targets (from security-and-performance.md):**
- API Response Time (p95): < 500ms
- API Response Time (p99): < 1000ms
- Single DB Query: < 10ms
- List Queries: < 50ms
- Complex Joins: < 100ms
- Full-Text Search: < 200ms
- Cache Hit Rate: > 80%
- LCP (Largest Contentful Paint): < 2.5s
- FID (First Input Delay): < 100ms

**Testing Tools:**
- Vitest for integration tests
- k6 or Apache Bench for load testing
- Redis CLI for cache inspection
- PostgreSQL EXPLAIN ANALYZE for query performance
- Playwright for E2E user journeys

**Testing Approach:**

**Part 1: API Endpoint Testing**
1. Test all 23 existing endpoints (GET, POST, PUT, DELETE)
2. Identify and implement 12 missing endpoints
3. Validate response formats match API specification
4. Benchmark each endpoint against performance targets
5. Test error handling (404, 500, validation errors)

**Part 2: Cache Fault Tolerance (Critical)**
3 failure scenarios to test:
- **Scenario 1**: Redis unavailable at startup (app should start successfully)
- **Scenario 2**: Redis fails during operation (graceful degradation to database)
- **Scenario 3**: Redis recovers after failure (reconnection and cache repopulation)

**Part 3: Performance Benchmarking**
1. Run load tests with 100 concurrent users
2. Measure p95/p99 response times
3. Monitor cache hit rates
4. Analyze slow queries (> 100ms)
5. Optimize and re-test

**Part 4: User Journey Testing**
Test these 4 critical journeys end-to-end:
1. **Investor Research Journey**: Homepage → Dashboard → IPO Detail → GMP History → Apply
2. **Calculator Journey**: Homepage → Lot Calculator → Calculate → Compare IPOs
3. **Allotment Journey**: Homepage → Allotment Checker → Check Status
4. **Research Journey**: Homepage → Search → Filter by Category → View Details

**Part 5: Security Testing**
1. SQL injection attempts on search inputs
2. XSS attempts on form fields
3. CSRF token validation
4. Rate limiting on API endpoints
5. Input validation (length limits, type checking)

**Success Criteria:**
- All API endpoints respond correctly
- Performance targets met (p95 < 500ms, p99 < 1000ms)
- Cache hit rate > 80% for detail/list endpoints
- App continues functioning when Redis is down
- All 3 fault tolerance scenarios pass
- 4 user journeys complete successfully
- Zero security vulnerabilities found
- Database query performance meets targets
- Logging captures all critical events

**Git Checkpoint (after completion):**
```bash
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-5/
git commit -m "test(phase-5): Complete integration and performance testing

✅ Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main
```

**Let's begin with ISR testing, then move to API endpoint validation.**
```

---

## Consolidated Sequential Prompt

Use this prompt to execute all 5 phases sequentially with checkpoints between phases.

```
I need to execute the complete IPODhan testing plan across all 5 phases sequentially.

**Master Index:** docs/07-testing/test-plan/README.md
**Safety Protocol:** docs/07-testing/test-plan/00-TESTING-OVERVIEW.md

**Total Estimated Time:** 10-16 days

**CRITICAL SAFETY PROTOCOL:**
- Production database: 103.118.16.189:5432/ipodhan (LIVE DATA)
- ALL data modifications require explicit approval before execution
- Show exact operation, explain impact, wait for "APPROVED" response
- Follow testing loop: Test → Document → Fix → Re-test

**Testing Loop Pattern:**
After each test:
1. Execute test (SQL query, API call, UI check)
2. Document result in TEST_PROGRESS.md
3. If issue found, log in TEST_ISSUES.json
4. If fix needed, propose fix and get approval
5. Apply fix and re-test
6. Mark test as PASS/FAIL
7. Move to next test

**Architecture References (read before starting):**
- packages/shared/src/db/schema.ts (database schema - single source of truth)
- docs/02-architecture/backend-architecture.md (repository and service patterns)
- docs/05-caching/CACHING_STRATEGY.md (Redis caching strategy)
- docs/02-architecture/security-and-performance.md (performance targets)
- docs/16-database/SCHEMA_MANAGEMENT.md (schema workflow)
- docs/16-database/screen-table-database-field-mapping.md (UI-database mapping)

**Quick Reference:**
- SQL queries: docs/07-testing/test-plan/APPENDIX-B-SQL-QUERIES.md
- Enhancements: docs/07-testing/test-plan/APPENDIX-A-ENHANCEMENTS.md
- Architecture refs: docs/07-testing/test-plan/APPENDIX-C-ARCHITECTURE-REFS.md

---

## PHASE 1: DATA QUALITY & SCRAPING VALIDATION
**Document:** docs/07-testing/test-plan/01-PHASE-1-DATA-QUALITY.md
**Estimated Time:** 3-5 days
**Focus:** Database integrity, scraper health, field coverage

**Objectives:**
- Validate all 16 database tables have data
- Check field coverage (Critical: 100%, Important: >90%)
- Validate Repository Pattern & Cache-Aside implementation (Enhancement #13)
- Verify new enhancements: Scoring, Peers, Issue Details, Financials, Registrar, Broker Affiliates

**Success Criteria:**
- All tables populated
- Critical fields at 100% coverage for OPEN/UPCOMING IPOs
- All repositories extend BaseRepository
- Cache hit rate >80%
- All 7 repository pattern validation steps pass

**Checkpoint:**
```bash
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-1/
git commit -m "test(phase-1): Complete data quality and scraping validation"
git push origin main
```

**Let's begin Phase 1, Iteration 1, Test #1: Basic IPO table record count.**

---

## PHASE 2: CORE PAGES TESTING
**Document:** docs/07-testing/test-plan/02-PHASE-2-CORE-PAGES.md
**Estimated Time:** 2-3 days
**Focus:** UI pages, dashboard, IPO details, search

**Prerequisites:**
- Phase 1 complete (all tests passed)
- Data quality validated

**Objectives:**
- Test dashboard filter combinations (Enhancement #7)
- Validate IPO detail sections (Enhancements #8-12)
- Test search functionality
- Verify homepage and historical IPOs page
- Mobile responsiveness (Enhancement #26)
- SEO & structured data (Enhancement #18)

**Success Criteria:**
- All pages load without errors
- Console errors: 0
- All filter combinations work
- Mobile layout renders correctly
- SEO metadata present on all pages

**Checkpoint:**
```bash
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-2/
git commit -m "test(phase-2): Complete core pages testing"
git push origin main
```

**Now moving to Phase 2. Let's begin with dashboard filter combinations.**

---

## PHASE 3: TOOLS & FEATURES TESTING
**Document:** docs/07-testing/test-plan/03-PHASE-3-TOOLS-FEATURES.md
**Estimated Time:** 1-2 days
**Focus:** Investor tools, calculators, utilities

**Prerequisites:**
- Phase 1 and 2 complete
- Core pages validated

**Objectives:**
- Test Lot Calculator accuracy (Enhancement #14)
- Validate IPO Compare Tool (Enhancement #15)
- Test Allotment Checker (Enhancement #16)
- Verify Registrars page and Market Holidays

**Success Criteria:**
- Lot calculator: 100% accurate calculations
- Compare tool: Handles 2-5 IPOs correctly
- Allotment checker: Form validation working
- All tool pages functional

**Checkpoint:**
```bash
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-3/
git commit -m "test(phase-3): Complete tools and features testing"
git push origin main
```

**Now moving to Phase 3. Let's test the Lot Calculator first.**

---

## PHASE 4: CATEGORY PAGES TESTING
**Document:** docs/07-testing/test-plan/04-PHASE-4-CATEGORY-PAGES.md
**Estimated Time:** 1-2 days
**Focus:** Mainboard/SME segregation, category filtering

**Prerequisites:**
- Phase 1, 2, and 3 complete
- Category data exists

**Objectives:**
- Validate Mainboard/SME segregation (Enhancement #17)
- Test all 12 category pages (6 Mainboard + 6 SME)
- Verify no cross-contamination
- Test special categories (OFS, NCD, Rights, FPO)

**Success Criteria:**
- Zero cross-contamination between categories
- All 12 pages render correctly
- Category filters applied in all API calls
- Empty states display gracefully

**Checkpoint:**
```bash
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-4/
git commit -m "test(phase-4): Complete category pages testing"
git push origin main
```

**Now moving to Phase 4. Let's verify Mainboard/SME segregation first.**

---

## PHASE 5: INTEGRATION & PERFORMANCE TESTING
**Document:** docs/07-testing/test-plan/05-PHASE-5-INTEGRATION.md
**Estimated Time:** 4-6 days
**Focus:** API endpoints, caching, fault tolerance, performance, security

**Prerequisites:**
- All previous phases (1-4) complete
- Full application stack running

**Objectives:**
- Test 23 existing API endpoints + implement 12 missing (Enhancement #20)
- Validate Redis fault tolerance - 3 failure scenarios (Enhancement #24)
- Benchmark performance against targets (p95 < 500ms, p99 < 1000ms)
- Test 4 critical user journeys
- Security testing (SQL injection, XSS, CSRF)
- Data consistency validation (Enhancement #27)

**Performance Targets:**
- API p95: < 500ms, p99: < 1000ms
- Cache hit rate: > 80%
- DB queries: < 100ms
- LCP: < 2.5s, FID: < 100ms

**Success Criteria:**
- All API endpoints respond correctly
- Performance targets met
- App functions when Redis is down
- All 3 fault tolerance scenarios pass
- 4 user journeys complete successfully
- Zero security vulnerabilities

**Checkpoint:**
```bash
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-5/
git commit -m "test(phase-5): Complete integration and performance testing"
git push origin main
```

**Now moving to Phase 5 (final phase). Let's begin with ISR testing.**

---

## FINAL CHECKPOINT
After all 5 phases complete:

1. **Review Test Progress:**
   - Check TEST_PROGRESS.md for overall summary
   - Verify all phases marked complete
   - Review TEST_ISSUES.json for any remaining issues

2. **Performance Summary:**
   - Document cache hit rates
   - Document API response times (p95/p99)
   - Document database query performance

3. **Final Git Commit:**
```bash
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/
git commit -m "test(all-phases): Complete comprehensive testing plan

All 5 testing phases completed successfully:
- Phase 1: Data Quality & Scraping ✅
- Phase 2: Core Pages Testing ✅
- Phase 3: Tools & Features ✅
- Phase 4: Category Pages ✅
- Phase 5: Integration & Performance ✅

Total Duration: [X days]
Total Tests: [X tests]
Pass Rate: [X%]

✅ Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main
```

4. **Deployment Readiness:**
   - All tests passing
   - Performance targets met
   - Security validated
   - Documentation complete

**Let's begin with Phase 1: Data Quality & Scraping Validation.**
```

---

## Tips for Using These Prompts

1. **Copy the Entire Prompt Block**: Include all context and instructions for best results

2. **Customize as Needed**:
   - Adjust database credentials if testing on different environment
   - Modify git commit messages to match your style
   - Add/remove architecture references based on your needs

3. **Track Progress**:
   - Use TEST_PROGRESS.md to document each test result
   - Use TEST_ISSUES.json to log any issues found
   - Create phase-specific result directories (test-results/phase-1/, etc.)

4. **Approval Workflow**:
   - For production database modifications, always wait for approval
   - Show exact SQL or code before executing
   - Explain impact (tables, rows affected)

5. **Testing Loop**:
   - Don't skip the Test → Document → Fix → Re-test cycle
   - Always re-test after applying fixes
   - Update TEST_PROGRESS.md after each test

6. **Git Checkpoints**:
   - Create checkpoints after each phase completion
   - Don't batch multiple phases into one commit
   - Include meaningful commit messages

---

## Quick Command Reference

```bash
# Start dev server
cd web && npm run dev

# Run integration tests
cd web && npm run test:integration

# Run E2E tests
cd web && npm run test:e2e

# Connect to database
psql -h 103.118.16.189 -U postgres -d ipodhan

# Redis CLI
redis-cli -h 103.118.16.189

# Check running processes
pm2 status

# View logs
pm2 logs ipodhan-web
```

---

**Questions?** Refer to [README.md](README.md) for full testing plan structure or [00-TESTING-OVERVIEW.md](00-TESTING-OVERVIEW.md) for safety protocols.
