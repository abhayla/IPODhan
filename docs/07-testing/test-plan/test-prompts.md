# Testing Phase Invocation Prompts

**[← Back to Index](README.md)**

This document contains ready-to-use prompts for invoking each testing phase individually or all phases sequentially.

---

## How to Use These Prompts

### Option 1: Individual Phase Testing
Copy the prompt for the specific phase you want to test and use it with Claude Code or your testing workflow.

### Option 2: Sequential All-Phase Testing
Use the consolidated prompt at the bottom to execute all 5 phases in sequence with checkpoints between phases.

### Option 3: Parallel Sub-Agent Testing (Recommended for Speed)
Each phase prompt now includes directives to spawn sub-agents for parallel execution of independent test categories. This can reduce total testing time by 40-60%.

### Important Notes
- All prompts assume you've reviewed [00-TESTING-OVERVIEW.md](00-TESTING-OVERVIEW.md) for safety protocols
- Production database approval process applies to ALL data modifications
- Git checkpoints should be created after each phase completion
- Follow the testing loop: Test → Document → Fix → Re-test

---

## Sub-Agent Strategy

**When to Spawn Sub-Agents:**
- Test categories are independent (no dependencies between them)
- Different pages/features can be tested in parallel
- Database queries don't conflict (read-only operations)
- Test execution time > 15 minutes for sequential approach

**Benefits:**
- **Time Reduction**: 40-60% faster than sequential testing
- **Parallelization**: Multiple test categories run simultaneously
- **Resource Efficiency**: Each sub-agent focuses on specific domain
- **Clear Separation**: Independent test documentation per category

**How Sub-Agents Work:**
1. Main agent analyzes test phase and identifies independent test categories
2. Spawns sub-agents for each category (e.g., Dashboard, SEO, Mobile)
3. Each sub-agent executes tests and generates documentation
4. Main agent consolidates results and creates git checkpoint
5. Reports aggregated results to user

**Example:**
```
Phase 2 has 6 independent test categories:
- Dashboard Filters (Agent 1)
- IPO Detail Page (Agent 2)
- SEO Validation (Agent 3)
- Homepage (Agent 4)
- Mobile Responsiveness (Agent 5)
- Search Functionality (Agent 6)

Total Time: Sequential = 2-3 days, Parallel = 1-1.5 days
```

**Sub-Agent Naming Convention:**
- `test-phase-{N}-{category}` (e.g., `test-phase-2-dashboard`, `test-phase-2-seo`)

**Sub-Agent Output:**
- Each creates markdown file: `test-results/phase-{N}/{category}-tests.md`
- Main agent consolidates into: `test-results/phase-{N}/PHASE-{N}-SUMMARY.md`

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

**Estimated Time:** 3-5 days sequential, 2-3 days with parallel sub-agents

**🚀 SUB-AGENT SPAWNING STRATEGY (RECOMMENDED):**

**Independent Test Categories (can run in parallel):**
1. **Iteration 1: Basic Data Existence** - Quick validation of all 16 tables
2. **Iteration 2: Field Coverage Analysis** - Critical/Important/Enhanced field analysis
3. **Iteration 3: Repository Pattern Validation** - All 7 validation steps
4. **Iteration 4: Enhancement Data Validation** - New tables (ipo_scores, peer_companies, etc.)

**Spawn Sub-Agents:**
Use the Task tool to spawn 4 parallel sub-agents (subagent_type: "general-purpose"):

**Agent 1: Basic Data Existence (Iteration 1)**
```
Execute Iteration 1 of Phase 1: Basic Data Existence Checks.

Validate all 16 database tables have data using SQL queries from APPENDIX-B-SQL-QUERIES.md.

Tables to validate:
1. ipos (count > 0, expect ~495)
2. subscriptions (time-series data)
3. gmp_records (time-series data)
4. financial_data (1:1 with IPOs)
5. documents (1:many with IPOs)
6. listing_performance (historical data)
7. market_holidays (current year)
8. registrars (master data)
9. peer_companies (peer comparison)
10. broker_affiliates (affiliate links)
11. affiliate_clicks (tracking data)
12. scraper_logs (scraper monitoring)
13. ipo_reviews (analyst reviews)
14. ipo_scores (AI scoring)
15. issue_details (detailed IPO info)
16. financials_enhanced (enhanced metrics)

Execute 6 tests. Document results in test-results/phase-1/iteration-1-basic-data.md

Success Criteria: All 16 tables populated, record counts match expectations.
```

**Agent 2: Field Coverage Analysis (Iteration 2)**
```
Execute Iteration 2 of Phase 1: Field Coverage Analysis.

Analyze field population rates for Critical, Important, and Enhanced fields across all tables.

Critical Fields (Target: 100% for OPEN/UPCOMING IPOs):
- company_name, slug, category, status, open_date, close_date, price_range
- lot_size, issue_size, issue_type

Important Fields (Target: >90%):
- listing_date, exchange, lead_managers, registrar, minimum_investment
- subscription_data, gmp_data

Enhanced Fields (Target: >50%):
- peer_comparison, financial_ratios, scoring_data, analyst_reviews

Execute SQL queries to calculate coverage percentages. Document results in test-results/phase-1/iteration-2-field-coverage.md

Success Criteria: Critical 100%, Important >90%, Enhanced >50%.
```

**Agent 3: Repository Pattern Validation (Iteration 3)**
```
Execute Iteration 3 of Phase 1: Repository Pattern & Cache-Aside Validation (Enhancement #13).

Validate all repositories extend BaseRepository and implement cache-aside pattern correctly.

7-Step Validation Process:
1. Repository inheritance check (all extend BaseRepository)
2. Constructor signature (NodePgDatabase<typeof schema>, Redis)
3. Cache-first retrieval (getFromCache usage)
4. Cache population (setCache after DB query)
5. Cache invalidation (deleteCache/deleteCachePattern on mutations)
6. Query logging (executeQuery for all DB operations)
7. Cache hit rate measurement (>80% target)

Test repositories: IPORepository, SubscriptionRepository, GMPRepository, FinancialRepository.

Document results in test-results/phase-1/iteration-3-repository-validation.md

Success Criteria: All 7 steps pass for all repositories, cache hit rate >80%.
```

**Agent 4: Enhancement Data Validation (Iteration 4)**
```
Execute Iteration 4 of Phase 1: New Data Enhancements Validation.

Validate all new enhancement tables are populated and data quality is high.

Tables to validate:
1. ipo_scores (AI-powered scoring system)
2. peer_companies (peer comparison data)
3. issue_details (detailed IPO information)
4. financials_enhanced (enhanced financial metrics)
5. registrars (master data complete)
6. broker_affiliates (affiliate links configured)

For each table:
- Check record count
- Validate data completeness
- Check foreign key integrity
- Verify data accuracy (spot checks)

Document results in test-results/phase-1/iteration-4-enhancements.md

Success Criteria: All enhancement tables populated, data quality validated, no orphaned records.
```

**Main Agent Responsibilities:**
1. Spawn all 4 sub-agents in parallel using Task tool
2. Monitor sub-agent completion (iterations can run in parallel)
3. Consolidate results into test-results/phase-1/PHASE-1-SUMMARY.md
4. Update TEST_PROGRESS.md with all test results
5. Log any issues in TEST_ISSUES.json
6. Create git checkpoint with all documentation

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
git commit -m "test(phase-1): Complete data quality and scraping validation - [X]/[X] tests PASSING

✅ Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main
```

**IMPORTANT: Spawn 4 parallel sub-agents for 40-60% time reduction.**
**Let's begin by spawning sub-agents for all 4 iterations in parallel.**
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

**Estimated Time:** 2-3 days sequential, 1-1.5 days with parallel sub-agents

**🚀 SUB-AGENT SPAWNING STRATEGY (RECOMMENDED):**

**Independent Test Categories (can run in parallel):**
1. **Dashboard Testing** - Filter combinations, pagination, view toggle, URL state
2. **IPO Detail Page** - All sections, data completeness, affiliate tracking
3. **SEO Validation** - Meta tags, structured data, Open Graph, Twitter Cards
4. **Homepage Testing** - Hero, IPO tables, features, CTAs, navigation
5. **Mobile Responsiveness** - Touch targets, typography, responsive layouts
6. **Search Functionality** - Search queries, filters, pagination

**Spawn Sub-Agents:**
Use the Task tool to spawn 6 parallel sub-agents (subagent_type: "general-purpose"):

**Agent 1: Dashboard Testing**
```
Test dashboard filter combinations for Phase 2 of IPODhan testing.

Test all filter combinations (Status: ALL/OPEN/UPCOMING/CLOSED, Segment: ALL/MAINBOARD/SME), search functionality, pagination, view toggle, and URL state persistence.

Use Playwright in headed mode. Test against production VPS (103.118.16.189).

Create comprehensive documentation: test-results/phase-2/dashboard-filter-tests.md

Success Criteria: 26 tests covering all filter combinations, search, pagination, URL state.
```

**Agent 2: IPO Detail Page**
```
Test IPO detail page for Phase 2 of IPODhan testing.

Verify all sections (Overview, Subscription, GMP, Financials, Documents, Peer Comparison), affiliate button tracking, breadcrumbs, and data completeness.

Use Playwright in headed mode. Test page: /ipo/ambey-laboratories-limited-ipo

Create comprehensive documentation: test-results/phase-2/ipo-detail-page-tests.md

Success Criteria: 15 tests covering all sections, affiliate tracking verified.
```

**Agent 3: SEO Validation**
```
Validate SEO metadata and structured data for Phase 2 of IPODhan testing.

Extract and validate meta tags, Open Graph, Twitter Cards, JSON-LD structured data, canonical URLs. Test both IPO detail page and Dashboard.

Use Playwright to extract metadata. Verify Google Rich Results eligibility.

Create comprehensive documentation: test-results/phase-2/seo-validation-tests.md

Success Criteria: 12 tests covering all SEO aspects, 90%+ compliance score.
```

**Agent 4: Homepage Testing**
```
Test homepage for Phase 2 of IPODhan testing.

Verify hero section, 4 IPO tables (40 listings), 6 feature cards, CTAs, footer, navigation, semantic HTML, and accessibility.

Use Playwright in headed mode. Test URL: https://ipodhan.com/

Create comprehensive documentation: test-results/phase-2/homepage-tests.md

Success Criteria: 10 tests covering all homepage sections, 55+ links verified.
```

**Agent 5: Mobile Responsiveness**
```
Test mobile responsiveness for Phase 2 of IPODhan testing.

Test homepage, dashboard, and IPO detail page at 375x667 viewport (iPhone SE). Verify touch targets (44x44px), typography (16px+), responsive patterns, no horizontal scroll.

Use Playwright with mobile viewport. Verify WCAG 2.1 compliance.

Create comprehensive documentation: test-results/phase-2/mobile-responsiveness-tests.md

Success Criteria: 10 tests covering all pages, WCAG 2.1 touch target compliance.
```

**Agent 6: Search Functionality**
```
Test search functionality for Phase 2 of IPODhan testing.

Test search on dashboard page: company name search, partial match, no results handling, search + filter combinations.

Use Playwright in headed mode. Test various search queries.

Create comprehensive documentation: test-results/phase-2/search-functionality-tests.md

Success Criteria: Search returns relevant results, works with filters, handles edge cases.
```

**Main Agent Responsibilities:**
1. Spawn all 6 sub-agents in parallel using Task tool
2. Monitor sub-agent completion
3. Consolidate results into test-results/phase-2/PHASE-2-SUMMARY.md
4. Create git checkpoint with all test documentation
5. Report aggregated pass/fail statistics

**Testing Tools:**
- Playwright for E2E testing (headed mode for UI verification)
- Browser DevTools for console errors
- Mobile viewport: 375x667 (iPhone SE)
- Desktop viewport: 1920x1080

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
git add test-results/phase-2/*.md web/scripts/*.js
git commit -m "test(phase-2): Complete core pages testing - [X]/[X] tests PASSING

✅ Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main
```

**IMPORTANT: Spawn sub-agents using Task tool for 40-60% time reduction.**
**Let's begin by spawning 6 parallel sub-agents for independent test categories.**
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

**Estimated Time:** 1-2 days sequential, 0.5-1 day with parallel sub-agents

**🚀 SUB-AGENT SPAWNING STRATEGY (RECOMMENDED):**

**Independent Test Categories (can run in parallel):**
1. **Lot Calculator** - Calculation accuracy, edge cases, UI validation
2. **IPO Compare Tool** - Multi-IPO logic, side-by-side comparison
3. **Allotment Checker** - Form validation, registrar integration
4. **Utility Pages** - Registrars page, Market Holidays calendar

**Spawn Sub-Agents:**
Use the Task tool to spawn 4 parallel sub-agents (subagent_type: "general-purpose"):

**Agent 1: Lot Calculator Testing**
```
Test Lot Calculator for Phase 3 of IPODhan testing.

Test calculation accuracy with various inputs:
- Standard: investment=15000, price=100, lot_size=75 → Expected: 2 lots
- Edge cases: investment=0, negative numbers, non-numeric inputs
- Boundary: investment exactly divisible vs remainder
- Large numbers: investment=1000000

Verify formula: lots = floor(investment / (price * lot_size))

Test UI validation, error messages, responsive layout.

Document results in test-results/phase-3/lot-calculator-tests.md

Success Criteria: 100% calculation accuracy, all edge cases handled, user-friendly errors.
```

**Agent 2: IPO Compare Tool Testing**
```
Test IPO Compare Tool for Phase 3 of IPODhan testing.

Test multi-IPO comparison functionality:
- Minimum: Compare 2 IPOs
- Maximum: Compare 5 IPOs
- Mixed categories: MAINBOARD vs SME comparison
- Side-by-side layout verification
- All comparison fields displayed (price, GMP, subscription, financials)

Test UI: responsive layout, clear data presentation, export functionality (if exists).

Document results in test-results/phase-3/ipo-compare-tests.md

Success Criteria: Handles 2-5 IPOs correctly, all fields displayed, responsive layout works.
```

**Agent 3: Allotment Checker Testing**
```
Test Allotment Checker for Phase 3 of IPODhan testing.

Test form validation and registrar integration:
- PAN validation (format: ABCDE1234F)
- Application number validation
- DP ID/Client ID validation
- Registrar selection dropdown (populated from database)
- Form submission (mock or actual registrar API)
- Error handling for invalid inputs

Test accessibility, mobile layout, clear instructions.

Document results in test-results/phase-3/allotment-checker-tests.md

Success Criteria: Form validation working, registrar links functional, user-friendly errors.
```

**Agent 4: Utility Pages Testing**
```
Test utility pages for Phase 3 of IPODhan testing.

Pages to test:
1. Registrars Page:
   - All registrars listed (from registrars table)
   - Contact details (email, phone, website)
   - Search/filter functionality
   - Responsive layout

2. Market Holidays Calendar:
   - Current year holidays displayed
   - Grouped by month
   - Holiday type (NSE, BSE, or both)
   - Responsive calendar view

Document results in test-results/phase-3/utility-pages-tests.md

Success Criteria: All registrars listed, holidays accurate, responsive layouts work.
```

**Main Agent Responsibilities:**
1. Spawn all 4 sub-agents in parallel using Task tool
2. Monitor sub-agent completion
3. Consolidate results into test-results/phase-3/PHASE-3-SUMMARY.md
4. Create git checkpoint with all test documentation
5. Report aggregated pass/fail statistics

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
git commit -m "test(phase-3): Complete tools and features testing - [X]/[X] tests PASSING

✅ Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com)"
git push origin main
```

**IMPORTANT: Spawn 4 parallel sub-agents for 50%+ time reduction.**
**Let's begin by spawning sub-agents for all 4 tool categories in parallel.**
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

**Estimated Time:** 1-2 days sequential, 0.5-1 day with parallel sub-agents

**🚀 SUB-AGENT SPAWNING STRATEGY (RECOMMENDED):**

**Independent Test Categories (can run in parallel):**
1. **Mainboard Pages (6 pages)** - Landing, Calendar, Performance, Prospectus, Listings, Reviews
2. **SME Pages (6 pages)** - Same structure as Mainboard with SME filter
3. **Cross-Contamination Validation** - SQL queries to verify no mixing
4. **Special Categories** - OFS, NCD, Rights, FPO (if data exists)

**Spawn Sub-Agents:**
Use the Task tool to spawn 3 parallel sub-agents (subagent_type: "general-purpose"):

**Agent 1: Mainboard Pages Testing**
```
Test all 6 Mainboard pages for Phase 4 of IPODhan testing.

Pages to test:
1. /mainboard (Landing page)
2. /mainboard/calendar (Mainboard calendar)
3. /mainboard/performance (Listing performance)
4. /mainboard/prospectus (Prospectus documents)
5. /mainboard/listings (All listings)
6. /mainboard/reviews (IPO reviews)

For each page:
- Verify category=MAINBOARD filter applied in API calls
- Confirm all IPOs displayed have category='MAINBOARD'
- Test pagination within Mainboard category
- Verify count matches database count for MAINBOARD
- Test empty states (if applicable)

Use Playwright in headed mode. Verify via Network tab that category filter is present.

Document results in test-results/phase-4/mainboard-pages-tests.md

Success Criteria: All 6 pages show ONLY Mainboard IPOs, no SME cross-contamination.
```

**Agent 2: SME Pages Testing**
```
Test all 6 SME pages for Phase 4 of IPODhan testing.

Pages to test:
1. /sme (Landing page)
2. /sme/calendar (SME calendar)
3. /sme/performance (Listing performance)
4. /sme/prospectus (Prospectus documents)
5. /sme/listings (All listings)
6. /sme/reviews (IPO reviews)

For each page:
- Verify category=SME filter applied in API calls
- Confirm all IPOs displayed have category='SME'
- Test pagination within SME category
- Verify count matches database count for SME
- Test empty states (if applicable)

Use Playwright in headed mode. Verify via Network tab that category filter is present.

Document results in test-results/phase-4/sme-pages-tests.md

Success Criteria: All 6 pages show ONLY SME IPOs, no Mainboard cross-contamination.
```

**Agent 3: Cross-Contamination & Special Categories**
```
Validate cross-contamination prevention and special categories for Phase 4 of IPODhan testing.

Cross-Contamination Validation (SQL queries):
1. Query Mainboard pages for any IPOs with category != 'MAINBOARD' (should return 0 rows)
2. Query SME pages for any IPOs with category != 'SME' (should return 0 rows)
3. Verify API responses: All Mainboard endpoints return only Mainboard IPOs
4. Verify API responses: All SME endpoints return only SME IPOs

Special Categories Testing (if data exists):
1. OFS (Offer for Sale) - /ofs pages
2. NCD (Non-Convertible Debentures) - /ncd pages
3. Rights Issues - /rights pages
4. FPO (Follow-on Public Offering) - /fpo pages

For each special category: Verify filter applied, no cross-contamination, empty states work.

Document results in test-results/phase-4/cross-contamination-validation.md

Success Criteria: Zero cross-contamination, all special categories filtered correctly.
```

**Main Agent Responsibilities:**
1. Spawn all 3 sub-agents in parallel using Task tool
2. Monitor sub-agent completion
3. Consolidate results into test-results/phase-4/PHASE-4-SUMMARY.md
4. Create git checkpoint with all test documentation
5. Report cross-contamination validation results (critical success metric)

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
git commit -m "test(phase-4): Complete category pages testing - [X]/[X] tests PASSING, Zero cross-contamination

✅ Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main
```

**IMPORTANT: Spawn 3 parallel sub-agents for 50%+ time reduction.**
**Let's begin by spawning sub-agents for Mainboard, SME, and validation in parallel.**
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

**Estimated Time:** 4-6 days sequential, 2-3 days with parallel sub-agents

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

**🚀 SUB-AGENT SPAWNING STRATEGY (RECOMMENDED):**

**Independent Test Categories (can run in parallel):**
1. **ISR & API Endpoint Testing** - 23 existing + 12 missing endpoints
2. **Redis Fault Tolerance** - 3 failure scenarios
3. **Performance Benchmarking** - Load testing, query optimization
4. **User Journey Testing** - 4 critical E2E journeys
5. **Security Testing** - SQL injection, XSS, CSRF, rate limiting
6. **Rating Calculation** - IPO scoring algorithm validation
7. **Data Consistency** - Cross-table validation
8. **Logging & Monitoring** - Structured logging validation

**Spawn Sub-Agents:**
Use the Task tool to spawn 8 parallel sub-agents (subagent_type: "general-purpose"):

**Agent 1: ISR & API Endpoint Testing**
```
Execute ISR and API endpoint testing for Phase 5 of IPODhan testing.

Part 1: ISR (Incremental Static Regeneration) Testing (Enhancement #19):
- Test revalidation intervals for static pages
- Verify on-demand revalidation works
- Check stale-while-revalidate behavior

Part 2: API Endpoint Testing (Enhancement #20):
Test 23 existing endpoints:
- GET /api/ipos (list with pagination)
- GET /api/ipos/[slug] (detail)
- GET /api/subscriptions/[ipoId]
- GET /api/gmp/[ipoId]
- [... all 23 endpoints]

Identify and document 12 missing endpoints based on UI-database mapping.

Benchmark each endpoint against performance targets (p95 < 500ms).

Document results in test-results/phase-5/api-endpoint-tests.md

Success Criteria: All endpoints respond correctly, performance targets met, 12 missing endpoints identified.
```

**Agent 2: Redis Fault Tolerance Testing**
```
Execute Redis fault tolerance testing for Phase 5 of IPODhan testing (Enhancement #24 - CRITICAL).

Test 3 failure scenarios:

Scenario 1: Redis Unavailable at Startup
- Stop Redis service
- Start Next.js application
- Verify app starts successfully (graceful degradation)
- Test API endpoints work (fall back to database)

Scenario 2: Redis Fails During Operation
- Start app with Redis running
- Stop Redis mid-operation
- Verify app continues functioning
- Test API endpoints still respond (database fallback)

Scenario 3: Redis Recovers After Failure
- Start Redis again after failure
- Verify reconnection successful
- Test cache repopulation works
- Verify cache hit rate returns to >80%

Document results in test-results/phase-5/redis-fault-tolerance-tests.md

Success Criteria: App functions in all 3 scenarios, graceful degradation working, zero downtime.
```

**Agent 3: Performance Benchmarking**
```
Execute performance benchmarking for Phase 5 of IPODhan testing (Enhancement #22).

Load Testing:
- Use k6 or Apache Bench for 100 concurrent users
- Measure p95/p99 response times
- Target: p95 < 500ms, p99 < 1000ms

Database Query Performance:
- Run EXPLAIN ANALYZE on all critical queries
- Identify slow queries (> 100ms)
- Optimize with indexes, query rewrites
- Re-test after optimization

Cache Performance:
- Measure cache hit rates for all endpoints
- Target: > 80% for detail/list endpoints
- Monitor Redis memory usage
- Test cache warm-up after cold start

Core Web Vitals:
- Measure LCP (target: < 2.5s)
- Measure FID (target: < 100ms)
- Test on mobile and desktop

Document results in test-results/phase-5/performance-benchmarking-tests.md

Success Criteria: All performance targets met, slow queries optimized, cache hit rate > 80%.
```

**Agent 4: User Journey Testing**
```
Execute user journey testing for Phase 5 of IPODhan testing.

Test 4 critical end-to-end journeys using Playwright:

Journey 1: Investor Research Journey
- Homepage → Dashboard → IPO Detail → GMP History → Apply
- Verify all data loads correctly
- Test navigation flow
- Measure total journey time

Journey 2: Calculator Journey
- Homepage → Lot Calculator → Calculate → Compare IPOs
- Test calculator accuracy
- Verify comparison tool
- Test responsive layout

Journey 3: Allotment Journey
- Homepage → Allotment Checker → Check Status
- Test form validation
- Verify registrar selection
- Test allotment status retrieval

Journey 4: Research Journey
- Homepage → Search → Filter by Category → View Details
- Test search functionality
- Verify filter combinations
- Test detail page load

Document results in test-results/phase-5/user-journey-tests.md

Success Criteria: All 4 journeys complete successfully, no errors, smooth navigation.
```

**Agent 5: Security Testing**
```
Execute security testing for Phase 5 of IPODhan testing (Enhancement #28).

SQL Injection Testing:
- Test search inputs with SQL injection payloads
- Test form fields with malicious SQL
- Verify parameterized queries prevent injection

XSS (Cross-Site Scripting) Testing:
- Test form inputs with XSS payloads (<script>alert('XSS')</script>)
- Verify input sanitization
- Test output encoding

CSRF (Cross-Site Request Forgery):
- Test CSRF token validation
- Verify token required for mutations
- Test token expiration

Rate Limiting:
- Test API endpoints with rapid requests
- Verify rate limiting kicks in
- Test rate limit error messages

Input Validation:
- Test length limits (company name, etc.)
- Test type checking (numbers, emails)
- Test special character handling

Document results in test-results/phase-5/security-tests.md

Success Criteria: Zero vulnerabilities found, all attacks blocked, input validation working.
```

**Agent 6: Rating Calculation Testing**
```
Execute rating calculation testing for Phase 5 of IPODhan testing (Enhancement #21).

Test IPO scoring algorithm (ipo_scores table):

Algorithm Components to Test:
1. Financial Score (30%): Revenue, profit, debt-to-equity
2. Subscription Score (25%): Retail, NII, QIB subscription
3. GMP Score (20%): Grey market premium indicator
4. Valuation Score (15%): P/E ratio, price-to-book
5. Management Score (10%): Lead managers, registrar reputation

Test Cases:
- High-quality IPO (all metrics strong) → Expected: 80-100 score
- Medium-quality IPO (mixed metrics) → Expected: 50-79 score
- Low-quality IPO (weak metrics) → Expected: 0-49 score

Verify:
- Score calculation formula correct
- Scores stored in ipo_scores table
- Scores displayed in UI
- Scores updated on data changes

Document results in test-results/phase-5/rating-calculation-tests.md

Success Criteria: Algorithm accurate, scores match expectations, real-time updates working.
```

**Agent 7: Data Consistency Testing**
```
Execute data consistency testing for Phase 5 of IPODhan testing (Enhancement #27).

Cross-Table Validation:

Foreign Key Integrity:
- Verify all ipoId references exist in ipos table
- Check orphaned records (subscriptions, gmp_records without parent IPO)
- Validate registrar references

Data Completeness:
- Check required fields populated (company_name, category, status)
- Verify dates logical (open_date < close_date < listing_date)
- Check numeric fields positive (price_range, lot_size)

Data Accuracy:
- Subscription totals match category breakdown
- GMP records chronological order
- Financial data sums correct (revenue + profit = total)

Duplicate Detection:
- Check for duplicate IPO slugs
- Verify unique constraints enforced
- Check duplicate subscription entries

Document results in test-results/phase-5/data-consistency-tests.md

Success Criteria: Zero orphaned records, all foreign keys valid, no duplicates, data logically consistent.
```

**Agent 8: Logging & Monitoring Testing**
```
Execute logging and monitoring testing for Phase 5 of IPODhan testing (Enhancement #25).

Structured Logging Validation:

Log Levels:
- ERROR: Database errors, API failures, critical issues
- WARN: Cache misses, slow queries, validation warnings
- INFO: API requests, cache hits, successful operations
- DEBUG: Query execution, cache operations

Log Format:
- Timestamp (ISO 8601)
- Log level
- Context (request ID, user session)
- Message
- Metadata (duration, query, error stack)

Test Scenarios:
1. API request logging (all endpoints)
2. Database query logging (with duration)
3. Cache operation logging (hits/misses)
4. Error logging (with stack traces)
5. Performance logging (slow queries > 100ms)

Monitoring:
- Verify logs written to correct files
- Test log rotation (size-based)
- Check log aggregation (if configured)

Document results in test-results/phase-5/logging-monitoring-tests.md

Success Criteria: All critical events logged, structured format correct, monitoring functional.
```

**Main Agent Responsibilities:**
1. Spawn all 8 sub-agents in parallel using Task tool
2. Monitor sub-agent completion (longest phase - most benefit from parallelization)
3. Consolidate results into test-results/phase-5/PHASE-5-SUMMARY.md
4. Create git checkpoint with all test documentation
5. Report performance benchmarks, security findings, and fault tolerance results

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
git commit -m "test(phase-5): Complete integration and performance testing - [X]/[X] tests PASSING

Performance: p95 [X]ms, p99 [X]ms, Cache Hit Rate [X]%
Security: Zero vulnerabilities, all attacks blocked
Fault Tolerance: All 3 Redis scenarios passed

✅ Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com)"
git push origin main
```

**IMPORTANT: Spawn 8 parallel sub-agents for 50-60% time reduction (most complex phase).**
**Let's begin by spawning all 8 sub-agents in parallel for maximum efficiency.**
```

---

## Consolidated Sequential Prompt

Use this prompt to execute all 5 phases sequentially with checkpoints between phases.

```
I need to execute the complete IPODhan testing plan across all 5 phases sequentially.

**Master Index:** docs/07-testing/test-plan/README.md
**Safety Protocol:** docs/07-testing/test-plan/00-TESTING-OVERVIEW.md

**Total Estimated Time:** 10-16 days sequential, 5-8 days with parallel sub-agents (40-60% time reduction)

**🚀 SUB-AGENT ORCHESTRATION STRATEGY (HIGHLY RECOMMENDED):**

**Phase-by-Phase Sub-Agent Count:**
- Phase 1: 4 parallel sub-agents (Iterations 1-4)
- Phase 2: 6 parallel sub-agents (Dashboard, Detail, SEO, Homepage, Mobile, Search)
- Phase 3: 4 parallel sub-agents (Calculator, Compare, Allotment, Utilities)
- Phase 4: 3 parallel sub-agents (Mainboard, SME, Validation)
- Phase 5: 8 parallel sub-agents (API, Redis, Performance, Journeys, Security, Rating, Consistency, Logging)

**Total Sub-Agents: 25** across all 5 phases
**Time Savings: 5-8 days** (40-60% faster than sequential execution)

**Orchestration Pattern:**
1. For each phase, spawn all independent sub-agents in parallel using Task tool
2. Wait for all sub-agents to complete (monitor via task status)
3. Consolidate results into phase summary document
4. Create git checkpoint
5. Move to next phase

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

**IMPORTANT: Spawn 4 parallel sub-agents for Phase 1 (Iterations 1-4).**
**Let's begin by spawning all 4 sub-agents in parallel.**

---

## PHASE 2: CORE PAGES TESTING
**Document:** docs/07-testing/test-plan/02-PHASE-2-CORE-PAGES.md
**Estimated Time:** 2-3 days sequential, 1-1.5 days with 6 parallel sub-agents
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

**Sub-Agent Strategy:**
Spawn 6 parallel sub-agents:
1. Dashboard Testing (filter combinations, pagination)
2. IPO Detail Page (all sections, affiliate tracking)
3. SEO Validation (meta tags, structured data)
4. Homepage Testing (hero, tables, features)
5. Mobile Responsiveness (touch targets, responsive layouts)
6. Search Functionality (search queries, filters)

**Success Criteria:**
- All pages load without errors
- Console errors: 0
- All filter combinations work
- Mobile layout renders correctly
- SEO metadata present on all pages

**Checkpoint:**
```bash
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-2/
git commit -m "test(phase-2): Complete core pages testing - [X]/[X] tests PASSING"
git push origin main
```

**IMPORTANT: Spawn 6 parallel sub-agents for Phase 2 for 40-60% time reduction.**
**Now moving to Phase 2. Let's spawn all 6 sub-agents in parallel.**

---

## PHASE 3: TOOLS & FEATURES TESTING
**Document:** docs/07-testing/test-plan/03-PHASE-3-TOOLS-FEATURES.md
**Estimated Time:** 1-2 days sequential, 0.5-1 day with 4 parallel sub-agents
**Focus:** Investor tools, calculators, utilities

**Prerequisites:**
- Phase 1 and 2 complete
- Core pages validated

**Objectives:**
- Test Lot Calculator accuracy (Enhancement #14)
- Validate IPO Compare Tool (Enhancement #15)
- Test Allotment Checker (Enhancement #16)
- Verify Registrars page and Market Holidays

**Sub-Agent Strategy:**
Spawn 4 parallel sub-agents:
1. Lot Calculator Testing (accuracy, edge cases)
2. IPO Compare Tool Testing (2-5 IPOs, side-by-side)
3. Allotment Checker Testing (form validation, registrar)
4. Utility Pages Testing (registrars, holidays)

**Success Criteria:**
- Lot calculator: 100% accurate calculations
- Compare tool: Handles 2-5 IPOs correctly
- Allotment checker: Form validation working
- All tool pages functional

**Checkpoint:**
```bash
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-3/
git commit -m "test(phase-3): Complete tools and features testing - [X]/[X] tests PASSING"
git push origin main
```

**IMPORTANT: Spawn 4 parallel sub-agents for Phase 3.**
**Now moving to Phase 3. Let's spawn all 4 sub-agents in parallel.**

---

## PHASE 4: CATEGORY PAGES TESTING
**Document:** docs/07-testing/test-plan/04-PHASE-4-CATEGORY-PAGES.md
**Estimated Time:** 1-2 days sequential, 0.5-1 day with 3 parallel sub-agents
**Focus:** Mainboard/SME segregation, category filtering

**Prerequisites:**
- Phase 1, 2, and 3 complete
- Category data exists

**Objectives:**
- Validate Mainboard/SME segregation (Enhancement #17)
- Test all 12 category pages (6 Mainboard + 6 SME)
- Verify no cross-contamination
- Test special categories (OFS, NCD, Rights, FPO)

**Sub-Agent Strategy:**
Spawn 3 parallel sub-agents:
1. Mainboard Pages Testing (all 6 pages)
2. SME Pages Testing (all 6 pages)
3. Cross-Contamination Validation (SQL queries, special categories)

**Success Criteria:**
- Zero cross-contamination between categories
- All 12 pages render correctly
- Category filters applied in all API calls
- Empty states display gracefully

**Checkpoint:**
```bash
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-4/
git commit -m "test(phase-4): Complete category pages testing - Zero cross-contamination"
git push origin main
```

**IMPORTANT: Spawn 3 parallel sub-agents for Phase 4.**
**Now moving to Phase 4. Let's spawn all 3 sub-agents in parallel.**

---

## PHASE 5: INTEGRATION & PERFORMANCE TESTING
**Document:** docs/07-testing/test-plan/05-PHASE-5-INTEGRATION.md
**Estimated Time:** 4-6 days sequential, 2-3 days with 8 parallel sub-agents
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

**Sub-Agent Strategy:**
Spawn 8 parallel sub-agents (most complex phase):
1. ISR & API Endpoint Testing (23 + 12 endpoints)
2. Redis Fault Tolerance Testing (3 scenarios)
3. Performance Benchmarking (load testing, query optimization)
4. User Journey Testing (4 critical journeys)
5. Security Testing (SQL injection, XSS, CSRF, rate limiting)
6. Rating Calculation Testing (IPO scoring algorithm)
7. Data Consistency Testing (cross-table validation)
8. Logging & Monitoring Testing (structured logging)

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
git commit -m "test(phase-5): Complete integration and performance testing - [X]/[X] tests PASSING

Performance: p95 [X]ms, p99 [X]ms, Cache Hit Rate [X]%"
git push origin main
```

**IMPORTANT: Spawn 8 parallel sub-agents for Phase 5 (50-60% time reduction - most complex phase).**
**Now moving to Phase 5 (final phase). Let's spawn all 8 sub-agents in parallel.**

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

**IMPORTANT: Use sub-agent orchestration for 40-60% time reduction across all phases.**
**Let's begin with Phase 1: Data Quality & Scraping Validation by spawning 4 parallel sub-agents.**
```

---

## Sub-Agent Orchestration Summary

**Recommended Approach: Parallel Sub-Agents**

**Total Sub-Agents Across All Phases: 25**
- Phase 1: 4 agents (Iterations 1-4)
- Phase 2: 6 agents (Dashboard, Detail, SEO, Homepage, Mobile, Search)
- Phase 3: 4 agents (Calculator, Compare, Allotment, Utilities)
- Phase 4: 3 agents (Mainboard, SME, Validation)
- Phase 5: 8 agents (API, Redis, Performance, Journeys, Security, Rating, Consistency, Logging)

**Time Savings:**
- Sequential Execution: 10-16 days
- Parallel Sub-Agents: 5-8 days
- **Total Time Saved: 5-8 days (40-60% faster)**

**Benefits:**
1. **Massive Time Reduction**: 40-60% faster completion
2. **Clear Separation**: Each agent has focused responsibility
3. **Independent Execution**: No blocking between test categories
4. **Comprehensive Documentation**: Each agent creates detailed markdown file
5. **Easy Debugging**: Issues isolated to specific test category

**Orchestration Pattern:**
```
For each phase:
  1. Identify independent test categories
  2. Spawn all sub-agents in parallel using Task tool
  3. Monitor sub-agent completion (all can run simultaneously)
  4. Consolidate results into PHASE-X-SUMMARY.md
  5. Create git checkpoint
  6. Move to next phase
```

**Example Task Tool Usage:**
```typescript
// Spawn 6 sub-agents for Phase 2
Task({
  subagent_type: "general-purpose",
  description: "Dashboard Testing",
  prompt: "Test dashboard filter combinations... (full prompt)"
})
// Repeat for all 6 agents in single message (parallel execution)
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
