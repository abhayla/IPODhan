# Epic 10: Defect Fixing

**Epic ID**: EPIC-10
**Status**: 🟡 IN PROGRESS (67% Complete - 4/6 stories done)
**Priority**: P0 - BLOCKER
**Created**: 2025-10-13
**Updated**: 2025-10-17
**Source**: Phase 1 Testing - Iteration 1 Discovery

---

## Epic Overview

Comprehensive defect fixing initiative discovered during Phase 1 testing of the IPODhan application. This epic addresses critical infrastructure failures, Next.js 15 migration issues, and data integrity problems that are blocking production deployment.

---

## Business Impact

### Critical Issues Blocking Production (Updated 2025-10-17)
- ~~**Redis Infrastructure Failure** (ISS-001)~~: ✅ **RESOLVED** (2025-10-16) - Redis installed and operational
- ~~**Broken Listing Pages** (ISS-002, ISS-004)~~: ✅ **RESOLVED** - Next.js 15 components already properly configured
- **Documentation Mismatch** (ISS-003): Testing plan references non-existent GMP scraper - ⏳ **OPEN** (fast fix: update docs, 2 hours)
- **Missing IPO Data** (ISS-005): Financials, subscriptions not populated - ⚠️ **PARTIALLY RESOLVED** (need schema fix + seed data, 4-8 hours)
- ~~**Calendar API Limits** (ISS-006)~~: ✅ **RESOLVED** (2025-10-16) - Dedicated calendar endpoint implemented

### Impact Assessment (Updated 2025-10-17)
- **User Experience**: 🟢 GOOD - All critical pages working (listings, calendars)
- **Performance**: 🟢 GOOD - Redis caching operational, rate limiting functional
- **Data Completeness**: 🟡 PARTIAL - Subscription data present, financials missing (needs seed/scraper)
- **Production Readiness**: 🟡 NEAR READY - 4 of 6 critical issues resolved, 2 remaining (6-10 hours estimated)

---

## Success Criteria

### Phase 1 Exit Criteria (Must Pass to Close Epic)
- [ ] All CRITICAL issues fixed (3 issues)
- [ ] All MAJOR issues fixed (2 issues)
- [ ] Redis operational and tested
- [ ] All listing pages functional
- [ ] Documentation matches implementation
- [ ] 30 auto-generated tests executed and passing
- [ ] No new critical issues discovered for 2 consecutive test iterations

---

## Stories in Epic

### ✅ COMPLETED Stories (4/6)
1. **Story 10.1**: Fix Redis Connection Failure (ISS-001) - Status: ✅ **Done** (2025-10-16)
2. **Story 10.2**: Fix Next.js 15 Async SearchParams (ISS-002) - Status: ✅ **Done** (Already Fixed)
3. **Story 10.4**: Fix Next.js Component Errors (ISS-004) - Status: ✅ **Done** (Already Fixed)
4. **Story 10.6**: Fix API Limit Validation for Calendar Pages (ISS-006) - Status: ✅ **Done** (2025-10-16)

### ⏳ IN PROGRESS Stories (2/6)
5. **Story 10.3**: Resolve GMP Scraper Documentation Gap (ISS-003) - Status: 📝 **Draft** (P0-CRITICAL, 2 hours)
6. **Story 10.5**: Populate Missing IPO Data (ISS-005) - Status: ⚠️ **Partially Complete** (P1-MAJOR, 4-8 hours)

### ❌ REJECTED Stories (1)
7. **Story 10.7**: Implement GMP API Scraper - Status: ❌ **Rejected by PO** (moved to Epic 11)

---

## Testing Strategy

### Auto-Improvement Mechanism Active
Each defect has generated 3-6 related tests (30 total tests) that must pass before epic closure:
- **Infrastructure Tests**: 5 (Redis installation, connectivity, functionality)
- **Frontend Tests**: 9 (SearchParams, components, patterns)
- **Data Tests**: 11 (Database queries, scraper execution, relationships)
- **Integration Tests**: 5 (API limits, pagination, graceful degradation)

### Iteration Plan
- **Iteration 1**: ✅ Discovery (6 issues found)
- **Iteration 2**: ⏳ Fix CRITICAL blockers
- **Iteration 3**: ⏳ Fix MAJOR issues + run all tests
- **Iteration 4**: ⏳ Validation & regression testing
- **Convergence**: Target zero new critical/major issues for 2 iterations

---

## Product Owner Review (2025-10-14)

### Review Process
Product Owner (Bob) conducted comprehensive review of Stories 10.6 and 10.7 against business value, technical feasibility, priority alignment, and epic fit criteria.

### Story 10.6: Fix API Limit Validation - ✅ APPROVED WITH CHANGES

**Review Outcome**: ✅ **APPROVED - Ready for Development**

**Business Value**: 7/10 - Moderate to high. Calendar pages are important for investment planning.

**Priority Adjustment**:
- **Before**: 🟡 P2 - MINOR
- **After**: 🟠 P1 - MAJOR
- **Rationale**: 400 errors on calendar pages are not "minor" - this is a broken feature with significant user impact

**Changes Applied**:
1. ✅ Priority upgraded from P2-MINOR to P1-MAJOR
2. ✅ Success metrics added (load time < 3s, support 2000 IPOs)
3. ✅ AC-2 enhanced with scalability requirements
4. ✅ AC-3 clarified with decision-maker specification
5. ✅ Task 10 added for production readiness validation
6. ✅ Change log updated to v1.1

**Technical Approach**: Option 1 (Dedicated calendar endpoint) recommended - clean separation, no limits, better caching

**Status**: Ready for development (estimated 2-3 hours)

**Story File**: `docs/stories/10.6.fix-api-limit-validation.md` (v1.1)

---

### Story 10.7: Implement GMP API Scraper - ❌ REJECTED

**Review Outcome**: ❌ **REJECTED - Major Issues, Needs Rework**

**Business Value**: 8/10 - GMP data is highly valuable for investors, BUT...

**Epic Alignment Issue**:
- Epic 10 is "Defect Fixing"
- ISS-003 was: "Testing plan references non-existent GMP scraper"
- Proper fix: Update TESTING_PLAN.md (2 hours)
- Story 10.7 proposes: Build entire scraper (8-15 hours)
- **This is scope creep** - new feature work masquerading as defect fix

**Critical Blockers**:
1. 🔴 **Data Source Not Validated**: Story says "research GMP data source" but can't commit to implementation without knowing if it's scrapable
2. 🔴 **Legal Compliance Missing**: No ToS review, robots.txt compliance, or legal sign-off on web scraping
3. 🟠 **Epic Misalignment**: This is NEW FEATURE work, not defect fixing

**PO Recommendation**:
- ✅ Remove Story 10.7 from Epic 10
- ✅ Create revised Story 10.3: Update TESTING_PLAN.md to remove GMP references (fast fix)
- ✅ Move GMP scraper to **Epic 11: Feature Enhancements** after completing:
  - Data source validation (Task 0)
  - Legal compliance review
  - Competitive analysis
  - Business case approval

**Required Changes Before Re-submission** (if ever added back to Epic 10):
1. Complete Task 0: Validate GMP data source (URL, scrapability, legal compliance)
2. Obtain legal sign-off on scraping approach
3. Add AC-7: Frontend graceful degradation for missing GMP
4. Add AC-8: Scraping schedule definition (frequency, triggers)
5. Add monitoring and maintenance tasks
6. Justify why this belongs in "Defect Fixing" epic

**Story File**: `docs/stories/10.7.implement-gmp-api-scraper.md` (remains as Draft, not approved)

---

### PO Review Summary

| Story | Original Priority | Final Priority | PO Decision | Effort | Status |
|-------|------------------|----------------|-------------|--------|--------|
| 10.6  | P2-MINOR        | P1-MAJOR       | ✅ Approved w/ changes | 2-3h | Ready for dev |
| 10.7  | P1-MAJOR        | N/A (rejected) | ❌ Rejected | 8-15h | Move to Epic 11 |

**Epic Impact**:
- Epic 10 now focuses on true defect fixes (Stories 10.1-10.6)
- Estimated completion time: **12-20 hours** (vs 20-35 hours with Story 10.7)
- Faster path to production deployment
- GMP feature properly scoped for future epic with adequate planning

**Next Actions**:
1. ✅ Story 10.6 changes applied (v1.1)
2. ⏳ Create revised Story 10.3: Update TESTING_PLAN.md (2-hour fast fix for ISS-003)
3. ⏳ Create Epic 11: Feature Enhancements (for GMP scraper after proper research)

---

## Dependencies

### External Dependencies
- Redis server installation/configuration
- Next.js 15 migration documentation
- Historical scraper execution

### Internal Dependencies
- Database schema (verified ✅)
- Existing scrapers (5 found, functional)
- Test infrastructure (Vitest, Playwright)

---

## Technical Debt Created

### Identified Technical Debt
1. **Documentation Drift**: TESTING_PLAN.md references non-existent GMP scraper
2. **Infrastructure Monitoring**: No health checks for Redis, no startup validation
3. **Next.js Migration**: Incomplete upgrade to Next.js 15 patterns
4. **Data Monitoring**: No alerts for missing critical data relationships

### Recommended Follow-up Epics
- **Epic 11**: Infrastructure Health Monitoring
- **Epic 12**: Next.js 15 Migration Completion
- **Epic 13**: Data Completeness Monitoring

---

## Timeline

### Estimated Duration (Updated Post-PO Review)
- **Story 10.1** (Redis): 1-2 hours ⏳ Draft
- **Story 10.2** (SearchParams): ✅ 0 hours (Already Fixed - except SME calendar which is now fixed)
- **Story 10.3** (Documentation): 1-2 hours ⏳ Draft (Revised to update TESTING_PLAN.md)
- **Story 10.4** (Components): ✅ 0 hours (Already Fixed - verified)
- **Story 10.5** (Data): 3-6 hours ⏳ Draft (depends on scraper execution)
- **Story 10.6** (API Limits): 2-3 hours ✅ Approved by PO (upgraded to P1-MAJOR)
- ~~**Story 10.7** (GMP Scraper): 8-15 hours~~ ❌ Rejected - Moved to Epic 11

**Total Estimated**: 12-20 hours (originally 10-19 hours, adjusted for Story 10.6 changes)
**Actual Completed**: ~2 hours (ISS-002 SME calendar fix, ISS-004 verification)

### Milestones
- [x] **Discovery Complete**: 2025-10-13 ✅
- [x] **PO Review Complete**: 2025-10-14 ✅ (Stories 10.6 approved, 10.7 rejected)
- [x] **Quick Wins Completed**: 2025-10-14 ✅ (ISS-002 SME fix, ISS-004 verified)
- [x] **Redis Infrastructure Fixed**: 2025-10-16 ✅ (Story 10.1)
- [x] **Calendar API Fixed**: 2025-10-16 ✅ (Story 10.6)
- [x] **Component Validation Complete**: 2025-10-16 ✅ (Stories 10.2, 10.4)
- [ ] **Documentation Fixed**: Target 2025-10-17 (Story 10.3 - 2 hours)
- [ ] **Data Population Complete**: Target 2025-10-17 (Story 10.5 - 4-8 hours)
- [ ] **All Tests Passing**: Target 2025-10-17
- [ ] **Epic Closed**: Target 2025-10-18

---

## Stakeholders

- **Product Owner (Bob)**: ✅ Completed review 2025-10-14. Requires production deployment unblocked
- **Scrum Master (Bob)**: Managing epic progress, story creation, PO review coordination
- **QA Team**: Needs stable environment for testing
- **Development Team**: Blocked on Redis (10.1), data population (10.5). Can proceed with 10.6 (approved)
- **DevOps**: Responsible for Redis infrastructure

---

## Related Documentation

- **Testing Report**: `web/TEST_PROGRESS.md`
- **Issue Tracker**: `web/TEST_ISSUES.json`
- **Scraping Report**: `web/SCRAPING_COVERAGE_REPORT.md`
- **Architecture**: `docs/architecture/tech-stack.md`

---

## Notes

- This epic emerged from systematic testing using auto-improvement mechanism
- Each issue triggered automatic generation of 3-6 related tests
- Pattern: Documentation-implementation mismatches suggest need for better verification
- Redis failure was silent - application continued without proper error handling
- Next.js 15 migration was incomplete, causing cascading failures
- **PO Review Outcome (2025-10-14)**: Story 10.6 approved with priority upgrade, Story 10.7 rejected and moved to Epic 11
- **Scope Refinement**: Epic 10 now focuses on true defect fixes (12-20 hours) vs original plan with feature work (20-35 hours)
- **Quick Wins**: ISS-002 (SME calendar) and ISS-004 (component errors) already resolved during investigation

---

**Epic Owner**: Scrum Master (Bob)
**Product Owner**: Bob (Review completed 2025-10-14)
**Last Updated**: 2025-10-17
**Status**: 🟡 ACTIVE - IN PROGRESS (4 of 6 stories completed, 2 remaining: 10.3 + 10.5)
**Completion**: 67% (4/6 stories done)
