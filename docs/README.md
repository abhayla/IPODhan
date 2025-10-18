# IPODhan Documentation

Welcome to the IPODhan project documentation. This directory contains all project planning, architecture, stories, testing, and operational documentation.

## 📚 Documentation Structure

The documentation is organized into 14 numbered categories following the software development lifecycle:

### 01-planning/ - Project Planning & Requirements
Core planning documents and product requirements.

- **PRD.md** - Product Requirements Document
- **brief.md** - Project brief
- **EXECUTIVE_SUMMARY.md** - Executive summary of project status
- **REVISED-IMPLEMENTATION-ROADMAP.md** - Updated implementation roadmap
- **DEVELOPMENT-HANDOFF.md** - Development handoff documentation
- **rating-methodology.md** - IPO rating methodology
- **screen-table-database-field-mapping.md** - Comprehensive UI to database field mapping

### 02-architecture/ - Architecture Documentation
Complete technical architecture specifications.

- **index.md** - Architecture documentation index
- **introduction.md** - Architecture overview
- **high-level-architecture.md** - System architecture
- **frontend-architecture.md** - Frontend architecture
- **backend-architecture.md** - Backend architecture
- **database-schema.md** - Database schema documentation
- **front-end-spec.md** - Frontend specifications
- Plus 13 more architecture documents (API spec, components, deployment, security, etc.)

### 03-epics/ - Epic Specifications
High-level epic definitions for major features.

- **epic-1-foundation.md** - Foundation epic
- **epic-2-data-layer.md** - Data layer epic
- **epic-3-ipo-listing.md** - IPO listing pages
- **epic-4-ipo-detail.md** - IPO detail pages
- **epic-5-ipo-tools.md** - IPO tools and calculators
- **epic-6-historical-data.md** - Historical data
- **epic-7-data-pipeline.md** - Data pipeline and scraping
- **epic-8-production-readiness.md** - Production deployment
- Plus sharded epic documents

### 04-stories/ - User Stories
Detailed user stories and implementation specifications.

- **README.md** - Story index and conventions
- **PO-APPROVAL.md** - Product owner approval documentation
- **DEPENDENCY-MATRIX.md** - Story dependency matrix
- **SPRINT-1-ASSIGNMENT.md** - Sprint 1 assignments
- **SPRINT-2-PLAN.md** - Sprint 2 planning
- **STORY-TEMPLATE.yaml** - Story template
- **STORY-INDEX.md** - Story index
- All story files (1.1 through 11.2)
- Implementation summaries and validation reports
- **.completed/**, **.drafts/**, **.implemented/** - Story workflow folders

### 05-progress-reports/ - Development Progress
Progress reports for stories and sprints.

- Story progress reports (story-1.6, story-2.1, story-2.2, story-2.3, story-3.1, 2.4)

### 06-qa-reports/ - Quality Assurance Reports
Organized QA reports by category.

#### sprint-reports/
- **story-1.1-qa-report.md** through **story-3.1-qa-report.md** - Sprint-level QA reports (11 reports)

#### epic-reports/
- **epic-7-verification-report-2025-10-09.md**
- **epic-7-complete-verification-2025-10-09.md**
- **epic-7-vps-final-verification-2025-10-09.md**
- **epic-7-vps-testing-issues-2025-10-09.md**
- **EPIC-7-VERIFICATION-COMPLETE.md**

#### comprehensive-reports/
- **comprehensive-qa-report-2025-01-10.md**
- **final-qa-report-2025-01-10-session2.md**
- **FINAL-COMPREHENSIVE-TEST-REPORT.md**
- **FINAL-DASHBOARD-TESTING-REPORT.md**
- **COMPREHENSIVE-TEST-EXECUTION-REPORT.md**
- **COMPREHENSIVE-FUNCTIONAL-TEST-REPORT.md**
- **COMPREHENSIVE-DASHBOARD-TEST-REPORT.md**

#### ui-specific/
- **QA-IPO-Details-Page-Test-Report.md**
- **dashboard-test-results-final.md**
- **dashboard-test-execution-report-v1.1.md**
- **test-results.md**

### 07-testing/ - Testing Documentation
Testing guides, learning logs, and test execution documentation.

- **TESTING.md** - Main testing documentation
- **TESTING-INSTRUCTIONS.md** - Testing instructions
- **comprehensive-testing-guide.md** - Comprehensive testing guide
- **TESTING-FIXES-APPLIED.md** - Testing fixes applied
- **TESTING-COMPLETION-SUMMARY.md** - Testing completion summary
- **TESTING-CONTINUATION-REPORT.md** - Testing continuation report

#### ui-tests/
- **tools-menu-test-report.md**
- **dashboard-testing-workflow.md**
- **DASHBOARD-TEST-V1.1-LEARNING-LOG.md**
- **DASHBOARD-TEST-LEARNING-LOG.md**

### 08-scraping/ - Data Scraping Documentation
Scraping plans, execution phases, and GMP implementation.

- **comprehensive-scraping-plan.md** - Overall scraping strategy
- **COMPREHENSIVE-SCRAPING-VERIFICATION-REPORT.md** - Scraping verification
- **SCRAPER-FIX-SUMMARY-2025-10-17.md** - Scraper fixes applied
- **scraper_test_issues_20251017.md** - Scraper test issues

#### phases/
- **phase0-pre-scrape-state.md** - Pre-scraping state
- **phase1-pre-scraping-verification.md** - Pre-scraping verification
- **phase1_verification_results.md**
- **phase2-scraper-execution-summary.md** - Scraper execution
- **phase2_scraper_execution_summary.md**
- **phase3-database-verification-report.md** - Database verification
- **phase3_database_validation_report.md**
- **phase3_database_verification_results.md**
- **phase3.5-api-endpoint-testing.md** - API endpoint testing
- **phase3.5_api_testing_report.md**
- **phase4-web-ui-verification-summary.md** - UI verification
- **PHASE6_EXECUTION_PLAN.md** - Phase 6 execution plan

#### gmp-implementation/
- **P0-2_CHITTORGARH_GMP_FIX_PLAN.md** - Chittorgarh GMP fix plan
- **P0-2_INVESTORGAIN_GMP_API_FINDINGS.md** - InvestorGain API findings
- **P0-2_GMP_IMPLEMENTATION_SUMMARY.md** - GMP implementation summary

### 09-deployment/ - Deployment Documentation
Production deployment guides and procedures.

- **README.md** - Deployment documentation index
- **DEPLOYMENT-CHECKLIST.md** - Pre-deployment checklist
- **DEPLOYMENT-RUNBOOK.md** - Deployment runbook
- **ROLLBACK.md** - Rollback procedures
- **phase1-vps-environment-setup.md** - VPS setup
- **phase2-application-deployment.md** - Application deployment
- **phase3-cloudflare-configuration.md** - Cloudflare setup
- **phase4-verification-testing.md** - Post-deployment verification
- **phase5-rollback-testing.md** - Rollback testing
- **phase6-post-deployment.md** - Post-deployment tasks

### 10-issues/ - Issue Tracking & Fixes
Issue tracking, architectural fixes, and resolution summaries.

- **ISSUES-TRACKER.md** - Master issue tracker
- **ISSUE-2-FINAL-SUMMARY.md** - Issue #2 resolution summary
- **ARCHITECTURAL-FIXES-REPORT.md** - Architectural fixes report
- **EPIC-7-IMPLEMENTATION-STATUS-REPORT.md** - Epic 7 implementation status
- **STORY-7.9-PROGRESS-REPORT.md** - Story 7.9 progress
- **RECONCILIATION_SUMMARY.md** - Data reconciliation summary

### 11-reviews/ - Code & Epic Reviews
Implementation reviews and summaries.

- **implementation-summary-epics-1-7.md** - Epics 1-7 implementation summary
- **epics-1-7-review.md** - Epics 1-7 review

### 12-performance/ - Performance Optimization
Performance baselines and optimization reports.

- **performance-baseline.md** - Performance baseline measurements
- **performance-optimization-report.md** - Performance optimization report

### 13-components/ - Component Documentation
Reusable component specifications and usage patterns.

- **TABLE-COMPONENT-USAGE-PATTERNS.md** - Table component usage patterns
- **TABLE-COMPONENT-USAGE-MAP.md** - Table component usage map
- **DATATABLE-USAGE-EXAMPLES.md** - DataTable usage examples
- **REUSABLE-COMPONENTS-REQUIREMENTS.md** - Reusable components requirements

### 14-prd/ - PRD Sharded Documents
Sharded PRD documents for specific epics.

- **epic-4-sharded.md** - Epic 4 sharded PRD

### 99-archive/ - Archived Documentation
Deprecated or superseded documentation files.

- **pre_scrape_state.md** - Old pre-scrape state (superseded by phase0)
- **architecture.md** - Old architecture doc (superseded by 02-architecture/)
- **REMAINING-TASKS-VPS.md** - Completed VPS tasks

---

## 🔍 Quick Navigation

### For New Developers
1. Start with **01-planning/PRD.md** - Understand the product vision
2. Read **02-architecture/index.md** - Understand the technical architecture
3. Review **04-stories/README.md** - Understand the story workflow
4. Check **CLAUDE.md** (root directory) - Claude Code development guide

### For Product Owners
1. **01-planning/EXECUTIVE_SUMMARY.md** - Current project status
2. **04-stories/PO-APPROVAL.md** - Story approval process
3. **11-reviews/** - Epic implementation reviews
4. **06-qa-reports/comprehensive-reports/** - Latest QA status

### For QA Engineers
1. **07-testing/TESTING.md** - Main testing documentation
2. **07-testing/comprehensive-testing-guide.md** - Complete testing guide
3. **06-qa-reports/** - All QA reports by category
4. **04-stories/** - Story acceptance criteria

### For DevOps
1. **09-deployment/** - Complete deployment guides
2. **02-architecture/deployment-architecture.md** - Deployment architecture
3. **09-deployment/ROLLBACK.md** - Rollback procedures
4. **09-deployment/DEPLOYMENT-CHECKLIST.md** - Pre-deployment checklist

### For Data Engineers
1. **08-scraping/** - Data scraping documentation
2. **16-database/database-schema.md** - Database schema
3. **16-database/screen-table-database-field-mapping.md** - UI to DB mapping
4. **03-epics/epic-7-data-pipeline.md** - Data pipeline epic

---

## 📖 Documentation Conventions

### File Naming
- **Numbered stories**: `X.Y.story-name.story.md` (e.g., 1.1.next-js-setup.story.md)
- **QA reports**: `story-X.Y-qa-report.md` (e.g., story-1.1-qa-report.md)
- **Progress reports**: `story-X.Y-progress.md` or `X.Y-progress-report.md`
- **Epic files**: `epic-X-name.md` (e.g., epic-1-foundation.md)

### Folder Prefixes
Folders are numbered to follow the software development lifecycle:
- **01-planning** → **02-architecture** → **03-epics** → **04-stories** → **05-progress-reports** → **06-qa-reports** → **07-testing** → **08-scraping** → **09-deployment** → **10-issues** → **11-reviews** → **12-performance** → **13-components** → **14-prd** → **99-archive**

### Document Status
- **DRAFT** - Work in progress
- **REVIEW** - Pending review
- **APPROVED** - Approved by Product Owner
- **IMPLEMENTED** - Implementation complete
- **VERIFIED** - QA verified
- **ARCHIVED** - Deprecated/superseded

---

## 🔗 Related Documentation

- **Root README.md** - Project overview and setup instructions
- **Root CLAUDE.md** - Claude Code development guide
- **web/README.md** - Web application specific documentation
- **scraper/README.md** - Scraper service specific documentation
- **web/TESTING_PLAN.md** - Web testing plan
- **web/SCRAPING_COVERAGE_REPORT.md** - Scraping coverage report

---

## 📝 Contributing to Documentation

When adding new documentation:

1. **Choose the right category** - Place docs in the appropriate numbered folder
2. **Follow naming conventions** - Use consistent file naming
3. **Update this README** - Add links to new significant documents
4. **Cross-reference** - Link related documents
5. **Archive old versions** - Move superseded docs to 99-archive/

---

**Last Updated**: October 18, 2025
**Total Documents**: 100+ files organized across 14 categories
