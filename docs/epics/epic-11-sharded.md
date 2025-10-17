# Epic 11: Feature Enhancements & Data Quality Improvements

**Epic ID:** epic-11
**Priority:** P2 - ENHANCEMENT
**Story Points:** TBD
**Timeline:** 2-4 weeks
**Status:** IN PROGRESS
**Dependencies:** Epic 10 (Defect Fixing)

---

## Epic Overview

Feature enhancement epic for implementing new functionality and critical data quality improvements. This epic focuses on value-add features that have infrastructure already in place plus critical database schema fixes discovered during comprehensive scraping tests.

**Key Principle**: Features in this epic have **low implementation risk** because supporting infrastructure (DB schema, APIs, frontend components) is already built and validated.

### Business Value

- **GMP Data** (Story 10.7 ✅): Investors can gauge market demand and expected listing gains
- **Rights/Debt IPO Data** (Story 11.1): Complete coverage for all BSE IPO types (48% gap closure)
- **Data Quality & Schema Fixes** (Story 11.2): Support large-cap IPOs and improve scraper reliability
- **Future Features**: TBD based on product priorities

### User Personas

**Primary:** Retail investors seeking comprehensive IPO information
**Secondary:** Platform administrators maintaining data quality and system health

---

## Stories in This Epic

### Story 10.7: Implement GMP API Scraper
**Priority:** P2 - ENHANCEMENT
**Points:** 5
**Status:** ✅ COMPLETED (2025-10-17 12:40:04)
**File:** `docs/stories/10.7.implement-gmp-api-scraper.md`

**Description:**
Implement Grey Market Premium (GMP) data scraper from Chittorgarh.com API to provide investors with market sentiment indicators.

**Key Features:**
- Chittorgarh.com API integration with retry logic
- Comprehensive validation (12 fields per record)
- Graceful degradation on failures
- 100% test coverage of core functionality

**Acceptance Criteria:** 6/6 DONE
**Tests:** 31/31 passing
**QA Status:** APPROVED FOR STAGING DEPLOYMENT

---

### Story 11.1: Implement Rights/Debt IPO Detail Scraper
**Priority:** P2 - ENHANCEMENT
**Points:** 8
**Status:** 📋 PLANNED
**File:** `docs/stories/11.1.implement-rights-debt-ipo-scraper.md`

**Description:**
Close 48% BSE data gap by implementing scraper for Rights Issues (RI) and Debt Issues (DPI) that lack BSE detail pages.

**Goal:** Improve BSE enrichment from 52% to 80%+ (10-11 of 12 missing IPOs)

**Current Issue:** 12 BSE IPOs (RI/DPI) lack detail data - BSE doesn't provide detail pages

**Approach:** Research alternative data sources (Moneycontrol, Chittorgarh) or implement manual entry interface

**Acceptance Criteria:**
1. [ ] Research and document alternative data sources for Rights/Debt IPOs
2. [ ] Implement at least one alternative scraper (Rights OR Debt)
3. [ ] BSE enrichment improves from 52% to 62%+ (minimum success)
4. [ ] Target: 80%+ overall BSE enrichment
5. [ ] No regressions to existing MAINBOARD/SME scraping
6. [ ] Monitoring updated with RI/DPI tracking

**Prerequisites:**
- ✅ Issue #2 (BSE Detail Page Scraping) COMPLETED
- ✅ BSE scraper operational for MAINBOARD/SME
- ✅ Database schema supports RIGHTS/NCD categories

---

### Story 11.2: Database Schema Fixes & Scraper Reliability Improvements
**Priority:** P0 - CRITICAL (Database) + P1 (Enhancements)
**Points:** 13
**Status:** 📋 NEXT TO BE DRAFTED
**Estimated Effort:** 12-19 hours total
**Source:** Comprehensive scraping test findings (2025-10-17)

**Description:**
Critical database schema fixes to support large-cap IPOs plus scraper enhancements to improve data coverage and reliability. Issues discovered during comprehensive 3-hour scraping test that validated 313 IPOs.

**Business Impact:**
- **Critical Blocker**: 10% of scraped IPOs (31 IPOs) cannot be inserted due to database schema limitation
- **Data Coverage Gaps**: Missing GMP data, limited subscription coverage, incomplete field data
- **User Experience**: Next.js 15 warnings affecting development workflow
- **System Reliability**: Error logging needs improvement for faster issue diagnosis

**Current State:**
- ✅ NSE Scraper: 100% success rate (2/2 IPOs scraped) - FIXED
- ✅ BSE Scraper: Ready for both standard and OTB IPOs - FIXED
- ✅ Data Quality: 95% field coverage, zero integrity issues - VALIDATED
- ✅ API Layer: All 10 tested endpoints functional, 57% faster with caching - VALIDATED
- ⚠️ **31 IPOs failing insertion**: Database numeric overflow on `issue_size` column
- ⚠️ **Zero GMP data**: Chittorgarh scraper doesn't collect GMP (Story 10.7 addresses this)
- ⚠️ **Limited subscription coverage**: Only 5% of OPEN IPOs have subscription data

**Root Cause (Critical Issue):**
```
ERROR: numeric field overflow
DETAIL: A field with precision 12, scale 2 must round to absolute value less than 10^10.

Database Column: issue_size NUMERIC(12,2)
Maximum Value: ₹999.99 crores
Failed Examples:
- Canara HSBC Life Insurance: ₹25,175 crores (25x over limit!)
- Rubicon Research: ₹13,775 crores
- 29 additional large-cap IPOs
```

**Functional Requirements:**

#### FR-21.1: Database Schema Migration (CRITICAL - P0)
**Objective:** Support large-cap IPOs with issue sizes exceeding ₹1,000 crores

**Tasks:**
1. **Create Database Migration:**
   ```sql
   -- Migration: increase-issue-size-limit
   ALTER TABLE ipos
   ALTER COLUMN issue_size TYPE NUMERIC(15, 2);

   -- Rationale: Increases limit from ₹999.99 crores to ₹999,999 crores
   -- Supports IPOs up to ₹9,999.99 billion
   ```

2. **Long-term Recommendations:**
   - Consider storing `issue_size` in crores (divide by 10,000,000) for readability
   - Or use `NUMERIC(18, 2)` for unlimited large IPOs
   - Add CHECK constraint: `issue_size >= 0`

3. **Validation:**
   - Test migration on local database
   - Verify existing data migrates without errors
   - Test insertion of previously-failed IPOs
   - Expected: 31 IPOs successfully insert after migration

**Acceptance Criteria:**
1. [ ] Migration file created: `increase-issue-size-limit`
2. [ ] Migration applied to database successfully
3. [ ] All 31 previously-failed IPOs insert successfully
4. [ ] No regressions to existing 282 IPOs
5. [ ] Database backup created before migration
6. [ ] Rollback procedure documented and tested

**Priority:** 🔴 P0 - CRITICAL
**Estimated Time:** 30 minutes (migration) + 15 minutes (validation) = 45 minutes
**Blocks:** Production deployment of 10% of scraped IPOs

---

#### FR-21.2: Subscription Data Coverage Improvement (P1)
**Objective:** Increase subscription data coverage from 5% to 60%+ for OPEN IPOs

**Current State:**
- Only 2/37 OPEN IPOs have subscription data (5%)
- Root cause: NSE scraper only scraped 2 active IPOs during test
- Impact: Real-time subscription tracking incomplete

**Tasks:**
1. **Increase NSE Scraper Frequency:**
   - Current: Manual execution
   - Recommended: Cron job every 30 min during trading hours (9:15 AM - 3:30 PM IST)
   - Target: 60%+ coverage (all MAINBOARD OPEN IPOs)

2. **Add Category-Specific Subscription Tracking:**
   - Implement QIB/NII/Retail/Total breakdown
   - Currently: Only total subscription captured
   - Benefit: Better investor analysis (which category is oversubscribed)

3. **Monitoring & Alerts:**
   - Set up alerts for scraper failures
   - Monitor subscription data freshness
   - Track coverage percentage

**Acceptance Criteria:**
1. [ ] Cron job scheduled for NSE scraper (every 30 min, 9:15 AM - 3:30 PM IST)
2. [ ] Subscription coverage improves from 5% to 60%+ for OPEN IPOs
3. [ ] Category-specific subscription breakdown captured (QIB/NII/Retail)
4. [ ] Monitoring dashboard shows coverage percentage
5. [ ] Alerts configured for scraper failures

**Priority:** 🟡 P1 - HIGH
**Estimated Time:** 2-3 hours
**Business Value:** Real-time subscription tracking is a core differentiator

---

#### FR-21.3: Missing Field Data Improvements (P1)
**Objective:** Improve optional field coverage from 60% to 80%+

**Current State:**
- Core fields: 100% coverage ✅ (company_name, prices, dates, exchanges)
- Optional fields: 60% coverage (sector, registrar, descriptions)
- Gaps identified:
  - 0% sector coverage
  - 40% missing registrar information
  - 30% missing descriptions

**Tasks:**
1. **Add Sector Field Scraping:**
   - NSE detail pages: Extract from "Industry" section
   - BSE detail pages: Extract from "Sector" field
   - Fallback: Moneycontrol sector classification

2. **Improve Registrar Data:**
   - NSE/BSE detail pages: Extract registrar name and contact
   - Create registrar master table if needed
   - Link IPOs to registrars via foreign key

3. **Description Enhancement:**
   - Extract company description from NSE/BSE detail pages
   - Limit to 500 characters for consistency
   - Sanitize HTML entities and special characters

**Acceptance Criteria:**
1. [ ] Sector field populated for 80%+ of IPOs
2. [ ] Registrar information captured for 80%+ of IPOs
3. [ ] Company descriptions captured for 80%+ of IPOs
4. [ ] No performance degradation (scraping time < 5 min per IPO)
5. [ ] Data validation ensures no corrupt/malformed data

**Priority:** 🟡 P1 - HIGH
**Estimated Time:** 4-6 hours
**Business Value:** Better filtering, search, and decision-making tools

---

#### FR-21.4: Next.js 15 Warnings Resolution (P2)
**Objective:** Fix React Server Component warnings for cleaner development experience

**Current State:**
- Multiple warnings in mainboard-ipos and sme-ipos pages
- `searchParams` should be awaited in async Server Components
- Impact: Cosmetic (development experience), no production issues

**Tasks:**
1. **Update Server Components:**
   - Make page components async
   - Await searchParams before accessing properties
   - Pattern:
     ```typescript
     export default async function Page({ searchParams }: Props) {
       const params = await searchParams;
       const status = params.status || 'ALL';
     }
     ```

2. **Test Affected Pages:**
   - Mainboard IPOs listing
   - SME IPOs listing
   - Verify no regressions in filtering/pagination

**Acceptance Criteria:**
1. [ ] All Next.js 15 warnings resolved
2. [ ] Zero console warnings in development
3. [ ] All pages load correctly
4. [ ] Filtering and pagination work as expected
5. [ ] No performance degradation

**Priority:** 🟠 P2 - MEDIUM
**Estimated Time:** 30-45 minutes
**Business Value:** Developer experience, code quality

---

#### FR-21.5: Error Logging Enhancements (P2)
**Objective:** Surface PostgreSQL constraint errors for faster diagnosis

**Current State:**
- Generic "Failed to create IPO" messages delay diagnosis
- Database constraint violations show `column: undefined, constraint: undefined`
- Required manual database testing to identify numeric overflow

**Tasks:**
1. **Enhance Data Persister Error Logging:**
   - Capture full PostgreSQL error details
   - Log constraint violations with field names
   - Example:
     ```typescript
     logger.error({
       error: error.message,
       constraint: error.constraint,
       column: error.column,
       detail: error.detail,
       hint: error.hint,
       ipoSlug: slug
     }, 'Failed to create IPO - constraint violation');
     ```

2. **Add Validation Before Insert:**
   - Check `issue_size` fits in NUMERIC(15,2)
   - Validate required fields not null
   - Log validation failures with specific field names

3. **Improve Retry Logic:**
   - Skip retry if constraint violation (will always fail)
   - Only retry on transient errors (network, timeout)

**Acceptance Criteria:**
1. [ ] All database errors log full PostgreSQL error details
2. [ ] Constraint violations show field name and constraint name
3. [ ] Validation errors logged before database insert attempt
4. [ ] Retry logic skips constraint violations
5. [ ] Error logs are actionable (no need for manual debugging)

**Priority:** 🟠 P2 - MEDIUM
**Estimated Time:** 2-3 hours
**Business Value:** Faster issue diagnosis, better system observability

---

#### FR-21.6: Landing Page Pagination (P3)
**Objective:** Remove arbitrary limits on landing page IPO counts

**Current State:**
- Some landing pages limit IPOs to 10
- Should show all matching IPOs or implement pagination
- Impact: Users may miss IPOs if >10 in category

**Tasks:**
1. **Review Landing Pages:**
   - Mainboard landing page
   - SME landing page
   - Identify hardcoded limits

2. **Implement Solution:**
   - Option A: Show all IPOs (if count typically <20)
   - Option B: Add pagination (if count >20)
   - Recommended: Show all with "View All" link

3. **Test Edge Cases:**
   - 0 IPOs (empty state)
   - 50+ IPOs (ensure performance)

**Acceptance Criteria:**
1. [ ] All landing pages show all matching IPOs or have pagination
2. [ ] No arbitrary limits (e.g., hardcoded LIMIT 10)
3. [ ] Empty states handled gracefully
4. [ ] Performance acceptable with 50+ IPOs

**Priority:** 🟢 P3 - LOW
**Estimated Time:** 1-2 hours
**Business Value:** Completeness, user trust

---

#### FR-21.7: Slug Collision Detection (P3)
**Objective:** Handle edge cases where multiple IPOs generate same slug

**Current State:**
- Slug generation from company names
- Potential edge case: "ABC Limited IPO" and "ABC Ltd IPO" → same slug
- No known collisions yet

**Tasks:**
1. **Add Slug Uniqueness Validation:**
   - Check if slug exists before insert
   - If exists, append counter: `abc-limited-ipo-2`
   - Log collision for monitoring

2. **Audit Existing Data:**
   - Query for duplicate slugs
   - Fix any existing collisions

3. **Add Database Constraint:**
   - UNIQUE constraint on `slug` column
   - Enforce at database level

**Acceptance Criteria:**
1. [ ] Slug uniqueness validated before insert
2. [ ] Collisions handled with counter suffix
3. [ ] Audit shows zero duplicate slugs
4. [ ] UNIQUE constraint added to database
5. [ ] Collision events logged for monitoring

**Priority:** 🟢 P3 - LOW
**Estimated Time:** 1-2 hours
**Business Value:** Data integrity, edge case handling

---

## Technical Architecture

### Database Migration
```sql
-- Migration: increase-issue-size-limit
ALTER TABLE ipos
ALTER COLUMN issue_size TYPE NUMERIC(15, 2);

-- Validation
SELECT
  COUNT(*) as total_ipos,
  COUNT(CASE WHEN issue_size > 99999999999.99 THEN 1 END) as large_ipos
FROM ipos;
```

### Cron Job Configuration
```cron
# Run NSE scraper every 30 min during trading hours (Mon-Fri, 9:15 AM - 3:30 PM IST)
*/30 9-15 * * 1-5 cd /path/to/scraper && npm run start:nse
```

### Error Logging Pattern
```typescript
try {
  await db.insert(ipos).values(ipoData);
} catch (error) {
  logger.error({
    error: error.message,
    code: error.code,
    constraint: error.constraint,
    column: error.column,
    detail: error.detail,
    hint: error.hint,
    ipoData: { slug: ipoData.slug, issueSize: ipoData.issue_size }
  }, 'IPO insertion failed');

  // Skip retry if constraint violation
  if (error.code === '23505' || error.code === '23502' || error.code === '22003') {
    throw error; // Don't retry
  }
  // Retry for transient errors
  await retryOperation();
}
```

---

## Acceptance Criteria Summary

**Story 11.2 Complete When:**
- [x] **P0 - Database Migration**: All 31 IPOs insert successfully (45 min)
- [ ] **P1 - Subscription Coverage**: 60%+ OPEN IPOs have subscription data (2-3 hours)
- [ ] **P1 - Field Data**: 80%+ sector/registrar/description coverage (4-6 hours)
- [ ] **P2 - Next.js Warnings**: Zero console warnings in development (30-45 min)
- [ ] **P2 - Error Logging**: All errors log full PostgreSQL details (2-3 hours)
- [ ] **P3 - Landing Pages**: All landing pages show all IPOs or have pagination (1-2 hours)
- [ ] **P3 - Slug Collision**: UNIQUE constraint enforced, collisions handled (1-2 hours)

**Total Estimated Time:** 12-19 hours
**Priority Breakdown:** 1 P0 (45 min), 2 P1 (6-9 hours), 2 P2 (2.5-3.75 hours), 2 P3 (2-4 hours)

---

## Dependencies

**This Epic Requires:**
- Epic 10 (Defect Fixing) - COMPLETED
- Comprehensive scraping test findings - COMPLETED (2025-10-17)

**This Epic Blocks:**
- Production deployment of large-cap IPOs (Story 11.2 FR-21.1)
- Real-time subscription tracking feature (Story 11.2 FR-21.2)

---

## Risks & Mitigation

### Risk 1: Database migration fails on production
- **Impact:** Large IPOs cannot be added to production database
- **Mitigation:** Test migration on staging first, create database backup
- **Contingency:** Rollback procedure documented, backup created

### Risk 2: Alternative data sources don't exist for Rights/Debt IPOs
- **Impact:** Cannot close 48% BSE data gap (Story 11.1)
- **Mitigation:** Research multiple sources (Moneycontrol, Chittorgarh, NSE)
- **Contingency:** Implement admin panel for manual data entry (10% improvement still valuable)

### Risk 3: Scraper frequency increase causes rate limiting
- **Impact:** IP blocked by NSE/BSE, scraping fails
- **Mitigation:** Implement exponential backoff, respect robots.txt
- **Contingency:** Reduce frequency to every hour instead of 30 min

---

## Success Metrics

| Metric | Target | Measurement | Priority |
|--------|--------|-------------|----------|
| Large IPO Support | 100% (31/31 IPOs) | Database insertions | P0 |
| Subscription Coverage | 60%+ OPEN IPOs | Scraper monitoring | P1 |
| Field Coverage | 80%+ sector/registrar | Database validation | P1 |
| Development Experience | Zero warnings | Console logs | P2 |
| Error Diagnosis Time | <5 min | Developer feedback | P2 |
| Data Completeness | All IPOs shown | User feedback | P3 |
| Slug Uniqueness | 100% | Database constraint | P3 |

---

## Definition of Done

**Epic 11 Complete When:**
- [x] Story 10.7 (GMP Scraper) - COMPLETED ✅
- [ ] Story 11.1 (Rights/Debt Scraper) - PLANNED 📋
- [ ] Story 11.2 (Schema Fixes & Enhancements) - NEXT TO BE DRAFTED 📋
  - [ ] All 7 functional requirements completed
  - [ ] Database migration applied and validated
  - [ ] 31 large IPOs successfully inserted
  - [ ] Subscription coverage improved to 60%+
  - [ ] Field coverage improved to 80%+
  - [ ] All tests passing
  - [ ] No regressions to existing functionality
  - [ ] Documentation updated
  - [ ] SM and PO sign-off

---

## Related Documentation

### Story 10.7 Documentation
- **Story File**: `docs/stories/10.7.implement-gmp-api-scraper.md`
- **Progress Report**: `docs/stories/progress-reports/story-10.7-progress.md`
- **QA Report**: `docs/stories/qa-reports/story-10.7-qa-report.md`

### Story 11.1 Documentation
- **Story File**: `docs/stories/11.1.implement-rights-debt-ipo-scraper.md`
- **Issue #2 Summary**: `ISSUE-2-FINAL-SUMMARY.md`
- **BSE Action Plan**: `docs/bse-detail-action-plan.md`

### Story 11.2 Documentation (NEW)
- **Executive Summary**: `EXECUTIVE_SUMMARY.md` (scraping test findings)
- **Issue Report**: `scraper_test_issues_20251017.md` (6 issues, 3 P0)
- **Database Validation**: `phase3_database_validation_report.md` (600+ lines)
- **API Testing**: `phase3.5_api_testing_report.md` (800+ lines)
- **Pre-Scrape State**: `pre_scrape_state.md` (baseline)

---

## Notes

### Epic Philosophy
- Features with infrastructure already built (80% done)
- Low implementation risk, high business value
- Balance critical fixes (P0) with enhancements (P1-P3)

### Story 10.7 ✅
- GMP scraper completed and tested
- Awaiting legal/compliance review before production
- All infrastructure validated

### Story 11.1 📋
- BSE Rights/Debt gap (48% of BSE IPOs)
- Alternative data source research required
- Incremental success acceptable (62%+ = win)

### Story 11.2 📋 (NEW)
- **Critical blocker**: Database schema limits large IPOs
- **High value**: Subscription coverage is core differentiator
- **Quality improvements**: Better logging, field coverage, UX fixes
- **Risk assessment**: Low risk (most changes are config/validation)
- **Estimated ROI**: 45 min fixes 10% of data pipeline

---

**Epic Owner**: Scrum Master (Bob)
**Product Owner**: Bob
**Created**: 2025-10-17
**Last Updated**: 2025-10-17 (Story 11.2 Added)
**Status**: 🟢 IN PROGRESS
**Story Count**: 3 (1 Complete, 2 Planned)
**Completion**: 33%

---

## Changelog

### 2025-10-17 - Story 11.2 Added to Sharded Epic
- **Story 11.2** added based on comprehensive scraping test findings
- 7 functional requirements defined (1 P0, 2 P1, 2 P2, 2 P3)
- 12-19 hour estimate across all priorities
- Critical database schema fix identified (45 min, blocks 10% of IPOs)
- Subscription coverage improvement targets set (5% → 60%+)
- Field coverage improvement targets set (60% → 80%+)
- Epic now at 33% completion (1/3 stories complete)
- Epic priority elevated to include P0 critical fix

### 2025-10-17 - Story 11.1 Created
- **Story 11.1** created from Issue #2 findings
- Addresses 48% BSE data gap (12 Rights/Debt IPOs)
- Target: 80%+ BSE enrichment
- Story file: `docs/stories/11.1.implement-rights-debt-ipo-scraper.md`

### 2025-10-17 - Story 10.7 Completed
- **Story 10.7** validated and approved for staging
- All 6 acceptance criteria met
- 31 unit tests passing (100%)
- QA approved, SM approved
- Awaiting compliance review before production

### 2025-10-17 - Epic Created
- Epic 11 created from deferred Story 10.7
- Infrastructure validation confirmed (80% complete)
- Prerequisites documented
