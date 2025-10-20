# IPODhan Self-Improving Comprehensive Testing Plan

## ⚠️ CRITICAL: VPS DATABASE CONNECTION PRE-REQUISITES

**BEFORE STARTING ANY TESTING PHASE**, you MUST verify VPS database connection.

### Step 1: Verify Environment Variables

**Check `web/.env.local` has VPS database credentials:**
```bash
# VPS PostgreSQL Database (PRODUCTION DATA)
DATABASE_URL=postgresql://postgres:Papa3Monu%401234@103.118.16.189:5432/ipodhan

# Individual fields (for scripts that parse separately)
DATABASE_HOST=103.118.16.189
DATABASE_PORT=5432
DATABASE_NAME=ipodhan
DATABASE_USER=postgres
DATABASE_PASSWORD=Papa3Monu@1234  # Note: @ symbol NOT URL-encoded here
```

**⚠️ CRITICAL**:
- `DATABASE_URL` must have URL-encoded password (`%40` for `@`)
- `DATABASE_PASSWORD` field must have raw password (with `@` not encoded)
- These must point to VPS server at `103.118.16.189`

### Step 2: Test Database Connection

**Before ANY testing phase, run:**
```bash
cd web
node scripts/check-tables-exist.js
```

**Expected Output:**
```
🔍 Checking database tables...
Connected to: 103.118.16.189:5432/ipodhan
✓ ipos exists
✓ ipo_details exists
✓ ipo_financials exists
[... all tables should show ✓]
```

**If you see errors:**
- `undefined:undefined/undefined` → DATABASE_URL not loaded
- `SASL: SCRAM-SERVER-FIRST-MESSAGE` → Password encoding issue
- `Connection timeout` → VPS server not reachable

**Fix:**
1. Verify `.env.local` exists in `web/` directory (NOT root)
2. Check password encoding (URL vs raw)
3. Restart dev server: `npm run dev`
4. Test connection again

### Step 3: Verify Data Exists

```bash
cd web
node scripts/check-db-data.js
```

**Expected Output:**
```
📊 Checking database data...
ipos: X records
subscriptions: Y records
gmp_records: Z records
[... should show actual counts, NOT "ERROR"]
```

### Step 4: Only After Connection Verified

✅ Once you see successful connection and data counts → Proceed to testing phases
❌ If connection fails → STOP and fix database connection first

---

## Current Implementation Status

**Recent Implementation Updates** (as of 2025-10-13):
- ✅ **GMP API Scraper**: Fully implemented and tested (ISS-001, ISS-010)
  - Location: `lib/scrapers/sources/gmp-api-scraper.ts`
  - Test Results: 98.5% success rate (64/65 IPOs)
  - Status: Production-ready, pending database integration
  - Average GMP value: ₹52.43, Average GMP percentage: 30.45%

- ⚠️ **Reviews**: No centralized API found - expect per-IPO only
  - Investigation: Completed via Playwright network monitoring
  - Finding: Reviews are embedded in individual IPO pages (not a centralized list endpoint)
  - Recommendation: Per-IPO scraping only or deprioritize feature
  - Impact: Adjust test expectations for review coverage (<50% IPOs may have reviews)

- ℹ️ **BSE Prospectus API**: Discovered but deprioritized (see BSE_API_DISCOVERY.md)
  - APIs Found: `api.bseindia.com` with 3 IPO endpoints
  - Prospectus Access: No JSON API (uses ASP.NET postbacks for PDFs)
  - Priority: LOW-MEDIUM (80% data overlap with Chittorgarh)
  - Decision: Focus on higher-value data sources first

**❓ Feature Status - Verify Before Testing:**
- Allotment Checker functionality
- Lot Calculator implementation
- IPO Compare tool
- Rating calculation system
- Reviews display (per-IPO only, not centralized list)

---

## 🔀 GIT WORKFLOW & VERSION CONTROL

### Overview

This testing plan follows a **QA Gated Workflow** where all testing activities occur on a dedicated test branch, separate from the feature branch. This ensures proper isolation, traceability, and quality control before merging to production.

### Workflow Pattern

```
main (production)
  └─> feature/story-[number] (development completed here, kept alive)
       └─> test/story-[number] (QA testing branch - all testing happens here)
            └─> After all tests pass + approval → merge to main
                 └─> Cleanup: delete both feature and test branches
```

---

### Prerequisites: Create Test Branch

**Concept**: Before starting any testing phase, create a dedicated test branch from the completed feature branch. This separates QA activities from development and provides a clean testing environment.

**Scenario 1: You have a feature branch and need to create a test branch**
```bash
# Step 1: Verify you're on main branch
git checkout main
git pull origin main

# Step 2: Checkout the feature branch
git checkout feature/story-[number]

# Step 3: Create test branch from feature branch
git checkout -b test/story-[number]

# Step 4: Push test branch to remote
git push -u origin test/story-[number]
```

**Scenario 2: No feature branch exists, create test branch from main**
```bash
# Only if testing main branch directly
git checkout main
git checkout -b test/story-[number]
git push -u origin test/story-[number]
```

**Scenario 3: You're ALREADY on a test branch (YOUR CURRENT SITUATION)**
```bash
# Check current branch
git branch
# Output shows: * test/comprehensive-testing

# You're good to go! Just ensure:
# 1. Branch is up to date
git pull origin test/comprehensive-testing

# 2. Verify you're on the test branch
git status
# Output should show: On branch test/comprehensive-testing

# 3. Start testing from Phase 1 (after VPS database connection verified)
```

**Important Notes for Scenario 3:**
- ✅ You can proceed with testing immediately (after database connection verified)
- ✅ There might not be a separate feature branch - that's OK
- ✅ The test branch may have been created directly from main
- ✅ All testing work continues on this `test/comprehensive-testing` branch
- ✅ After all phases complete, this test branch will merge to `main`
- ✅ No feature branch cleanup needed (since it doesn't exist)

**Example**:
```bash
# Testing story 7.10 (GMP Scraper)
git checkout feature/story-7.10
git checkout -b test/story-7.10
git push -u origin test/story-7.10
```

**Branch Naming Convention**:
- Format: `test/story-[number]-[short-description]`
- Examples:
  - `test/story-7.10-gmp-scraper`
  - `test/story-8.5-reviews-api`
  - `test/phase-1-data-validation`

**Important Notes**:
- ✅ Keep feature branch alive (do not delete it yet)
- ✅ All testing work happens on the test branch
- ✅ Commit frequently after each phase/iteration
- ✅ Test branch will be merged to main after QA approval

---

### During Testing: Commit Checkpoints

**Concept**: Commit your testing progress regularly to maintain a clear audit trail and enable rollback if needed. Each commit should represent a completed testing milestone.

**What to Commit**:
```
✅ Test results (JSON files, reports, screenshots)
✅ Bug fixes (code changes to fix issues found during testing)
✅ Documentation updates (TEST_PROGRESS.md, TEST_ISSUES.json)
✅ Test script modifications (new tests generated by auto-improvement)
✅ Configuration changes (database fixes, environment updates)
✅ Schema updates (if needed during testing)
✅ All tracking files (SCRAPING_COVERAGE_REPORT.md, etc.)
```

**Commit Frequency**:
```
After Phase 1 completes → Commit
After Phase 2 completes → Commit
After Phase 3 completes → Commit
After Phase 4 completes → Commit
After Phase 5 completes → Commit
After fixing critical bugs → Commit
After test script improvements → Commit
```

**Commit Message Format**:
```bash
# Format: test([phase]): [description]

# Examples:
git commit -m "test(phase-1): Complete data scraping validation - 64/65 IPOs passing"
git commit -m "test(phase-1): Fix GMP scraper null date handling - all tests passing"
git commit -m "test(phase-2): Complete core pages testing - zero console errors"
git commit -m "test(phase-3): Validate all tools - lot calculator, compare, allotment"
git commit -m "test(phase-4): Complete category pages - mainboard/SME segregation verified"
git commit -m "test(phase-5): Performance optimization - all APIs <500ms"
git commit -m "test(final): All 5 phases complete - production ready"
```

**Commands for Each Phase**:
```bash
# After completing a testing phase:
git add .
git commit -m "test(phase-[N]): [Summary of what was tested and fixed]"
git push origin test/story-[number]
```

**Example Workflow**:
```bash
# Phase 1 completed
git add TEST_PROGRESS.md TEST_ISSUES.json SCRAPING_COVERAGE_REPORT.md
git commit -m "test(phase-1): Complete data validation - 150 IPOs, 95% field coverage"
git push origin test/story-7.10

# Bug fixes during Phase 2
git add lib/scrapers/sources/gmp-api-scraper.ts scripts/test-gmp-scraper.ts
git commit -m "test(phase-1): Fix GMP scraper - handle empty date strings"
git push origin test/story-7.10
```

---

### Merge Criteria Checklist

**Concept**: Before merging the test branch to main, ensure all quality gates have been passed. This prevents buggy code from reaching production.

**Required Criteria** (ALL must be ✅):
```
✅ All 5 test phases completed
✅ Zero blocking issues (P0/P1 bugs resolved)
✅ Self-improvement cycle converged (0 new issues for 2+ iterations)
✅ All test results documented and committed
✅ All generated tests passing
✅ TEST_PROGRESS.md updated with final status
✅ TEST_ISSUES.json shows all issues resolved
✅ SCRAPING_COVERAGE_REPORT.md complete
✅ CONVERGENCE_REPORT.md generated
✅ QA approval/sign-off obtained
✅ Code review by lead developer (if required)
✅ All automated CI tests passing (if applicable)
```

**Verification Commands**:
```bash
# Check for uncommitted changes
git status

# Review all commits on test branch
git log --oneline main..test/story-[number]

# Verify no merge conflicts with main
git fetch origin main
git merge origin/main --no-commit --no-ff
# If conflicts, resolve them first
git merge --abort  # Abort and fix conflicts properly

# Verify all tracking files present
ls -la TEST_PROGRESS.md TEST_ISSUES.json SCRAPING_COVERAGE_REPORT.md

# Check test branch is ahead of main
git rev-list --count main..test/story-[number]
# Should show number of commits ahead
```

---

### Final Merge to Main

**Concept**: After all merge criteria are met and approval is obtained, merge the test branch to main using a non-fast-forward merge to preserve the complete testing history.

**Commands**:
```bash
# Step 1: Ensure test branch is up to date
git checkout test/story-[number]
git pull origin test/story-[number]

# Step 2: Fetch latest main
git fetch origin main

# Step 3: Merge main into test branch first (resolve conflicts on test branch)
git merge origin/main
# Resolve any conflicts if they occur
git add .
git commit -m "test(merge): Resolve conflicts with main"
git push origin test/story-[number]

# Step 4: Switch to main branch
git checkout main
git pull origin main

# Step 5: Merge test branch to main (--no-ff preserves history)
git merge test/story-[number] --no-ff -m "test: Merge story-[number] - [Feature description]

All 5 testing phases completed successfully:
- Phase 1: Data scraping & validation (150 IPOs, 95% coverage)
- Phase 2: Core pages testing (zero errors)
- Phase 3: Tools & features validation
- Phase 4: Category pages verification
- Phase 5: Integration & performance testing

QA Approved by: [Name]
Test branch: test/story-[number]
Issues resolved: [count] (see TEST_ISSUES.json)
Convergence achieved: 0 new issues in final 2 iterations

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# Step 6: Push main to remote
git push origin main
```

**Example**:
```bash
# Merging story 7.10 (GMP Scraper)
git checkout test/story-7.10
git pull origin test/story-7.10
git fetch origin main
git merge origin/main

git checkout main
git pull origin main
git merge test/story-7.10 --no-ff -m "test: Merge story-7.10 - GMP API Scraper Implementation

All 5 testing phases completed successfully:
- Phase 1: 64/65 IPOs scraped, 98.5% success rate
- Phase 2: Dashboard, detail pages, filters all functional
- Phase 3: Lot calculator, compare tool validated
- Phase 4: Mainboard/SME segregation verified
- Phase 5: API response times <500ms, zero security issues

QA Approved by: QA Team
Test branch: test/story-7.10
Issues resolved: 8 (see TEST_ISSUES.json)
Convergence achieved: 0 new issues in final 2 iterations

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

git push origin main
```

---

### Post-Merge Cleanup

**Concept**: After successful merge to main, clean up the test branch (and feature branch if it exists) to keep the repository tidy and prevent confusion.

**Commands**:
```bash
# Step 1: Delete local test branch
git branch -d test/comprehensive-testing  # Or your test branch name

# Step 2: Delete remote test branch
git push origin --delete test/comprehensive-testing

# Step 3: Check if feature branch exists
git branch -a | grep feature/

# Step 4: Delete local feature branch (ONLY if it exists)
# If you see a feature branch from Step 3:
git branch -d feature/story-[number]

# Step 5: Delete remote feature branch (ONLY if it exists)
# If you see a remote feature branch from Step 3:
git push origin --delete feature/story-[number]

# Step 6: Verify cleanup
git branch -a
# Should NOT show deleted branches
```

**For your current situation (test/comprehensive-testing):**
```bash
# Since you likely don't have a feature branch, just delete the test branch:
git branch -d test/comprehensive-testing
git push origin --delete test/comprehensive-testing

# Verify
git branch -a  # Should only show main and other active branches
```

**Example**:
```bash
# Cleanup after merging story 7.10
git branch -d test/story-7.10
git push origin --delete test/story-7.10
git branch -d feature/story-7.10
git push origin --delete feature/story-7.10

# Verify
git branch -a  # Should only show main and other active branches
```

**Branch Retention Policy**:
- ✅ Delete test branch after merge (no longer needed)
- ✅ Delete feature branch after merge (development complete)
- ✅ Keep main branch (production)
- ✅ Keep active development/test branches (ongoing work)

---

### Git Workflow Summary

| Step | Action | Branch | Command |
|------|--------|--------|---------|
| 1 | Create test branch | `test/story-X` | `git checkout -b test/story-X` |
| 2 | Push to remote | `test/story-X` | `git push -u origin test/story-X` |
| 3 | Test Phase 1 | `test/story-X` | Run tests, fix issues |
| 4 | Commit Phase 1 | `test/story-X` | `git commit -m "test(phase-1): ..."` |
| 5 | Test Phases 2-5 | `test/story-X` | Repeat test → commit cycle |
| 6 | Final commit | `test/story-X` | `git commit -m "test(final): ..."` |
| 7 | Merge to main | `main` | `git merge test/story-X --no-ff` |
| 8 | Push main | `main` | `git push origin main` |
| 9 | Cleanup branches | - | Delete test and feature branches |

---

### Important Git Guidelines

**DO**:
- ✅ Create test branch from feature branch (or main if no feature branch)
- ✅ Commit after each phase completion
- ✅ Use descriptive commit messages with `test(phase-N):` prefix
- ✅ Keep feature branch alive until final merge
- ✅ Use `--no-ff` when merging to main (preserves history)
- ✅ Include test results and issue count in merge commit message
- ✅ Clean up branches after successful merge

**DON'T**:
- ❌ Don't delete feature branch before testing complete
- ❌ Don't commit without completing a full phase or milestone
- ❌ Don't merge to main without QA approval
- ❌ Don't force push (`git push --force`) unless absolutely necessary
- ❌ Don't skip merge criteria verification
- ❌ Don't merge with unresolved conflicts
- ❌ Don't leave orphaned branches after merge

---

### Troubleshooting

**Problem**: Merge conflicts when merging to main
```bash
# Solution: Resolve conflicts on test branch first
git checkout test/story-X
git merge origin/main
# Resolve conflicts in editor
git add .
git commit -m "test(merge): Resolve conflicts with main"
git push origin test/story-X
# Now merge to main
```

**Problem**: Accidentally committed to feature branch instead of test branch
```bash
# Solution: Cherry-pick commits to test branch
git checkout test/story-X
git cherry-pick <commit-hash>
git push origin test/story-X
```

**Problem**: Need to revert a test commit
```bash
# Solution: Use git revert (safer than reset)
git revert <commit-hash>
git push origin test/story-X
```

**Problem**: Test branch diverged too much from main
```bash
# Solution: Rebase test branch on main
git checkout test/story-X
git fetch origin main
git rebase origin/main
# Resolve conflicts
git push origin test/story-X --force-with-lease
```

---

## 🔄 AUTO-IMPROVEMENT MECHANISM

### Core Principle: **Test → Find Issue → Add Related Tests → Fix → Verify → Update Plan**

---

## FEEDBACK LOOP SYSTEM

### When ANY issue is found during testing:

**1. Issue Classification** (Automatic)
```
Classify issue into:
- Data Quality Issue
- Scraper Failure
- Frontend Bug
- API Error
- Performance Problem
- Edge Case Discovery
- Missing Validation
```

**2. Root Cause Analysis** (Mandatory)
```
For each issue, ask:
- What caused this?
- What similar issues might exist?
- What tests would have caught this earlier?
- What related functionality should be tested?
```

**3. Auto-Generate Related Tests** (Dynamic)
```
Based on issue type, automatically add new tests:

IF issue = "GMP data missing for IPO X":
  ADD TEST: Check all OPEN IPOs for GMP data
  ADD TEST: Verify GMP scraper ran in last 24h
  ADD TEST: Check GMP API endpoint for all OPEN IPOs
  ADD TEST: Verify gmp_updated_at timestamps
  ADD TEST: Check gmp_tracking table has recent records

IF issue = "Search returns wrong results":
  ADD TEST: Test search with similar queries
  ADD TEST: Test search with special characters
  ADD TEST: Verify database index on search fields
  ADD TEST: Check search ranking algorithm
  ADD TEST: Test search with partial matches

IF issue = "Page crashes on missing data":
  ADD TEST: Test all pages with empty database
  ADD TEST: Verify null checks on all optional fields
  ADD TEST: Test error boundaries on all pages
  ADD TEST: Check loading states handle missing data
```

**4. Pattern Detection** (Learning)
```
Track issue patterns:
- If 3+ similar issues found → Add comprehensive test suite for that area
- If same scraper fails 2+ times → Add pre-flight validation
- If multiple null data issues → Add schema validation layer
- If performance issues on multiple pages → Add performance budget
```

**5. Update TEST_PROGRESS.md** (After each discovery)
```markdown
## Issues Found & Tests Added

### Issue #ISS-001: GMP data missing for 5 OPEN IPOs
**Root Cause**: GMP scraper failed silently
**Tests Added**:
- [ ] GMP scraper health check before each run
- [ ] Alert system for missing GMP data
- [ ] Verify GMP API returns data for all OPEN IPOs
- [ ] Check gmp_updated_at not older than 24h
**Status**: Tests added to Phase 1, Iteration 3
```

---

## CROSS-SESSION TRACKING FILES

**Created during testing:**
- `TEST_PROGRESS.md` - Main progress tracker
- `TEST_ISSUES.json` - All issues with status
- `SESSION_HANDOFF.md` - End-of-session summary
- `SCRAPING_COVERAGE_REPORT.md` - Field-by-field data coverage
- `TEST_METRICS.md` - Dashboard metrics
- `test-results/` - Logs, screenshots, reports per phase
- **Schema Reference**: `drizzle/migrations/schema.ts` (update if changes needed)

**Session Restoration:** Read TEST_PROGRESS.md → SESSION_HANDOFF.md → TEST_ISSUES.json → Resume

---

## PHASE 1: DATA SCRAPING & VALIDATION (CRITICAL)

**⚠️ MANDATORY PRE-REQUISITE: VPS Database Connection Verified**

**Before starting Phase 1, you MUST complete these checks:**
```bash
# 1. Navigate to web directory
cd web

# 2. Verify VPS database connection
node scripts/check-tables-exist.js
# Expected: Connected to: 103.118.16.189:5432/ipodhan
# Expected: All tables show ✓

# 3. Verify data exists in VPS database
node scripts/check-db-data.js
# Expected: Shows actual record counts (NOT "ERROR")

# 4. If either fails → STOP and fix connection (see VPS DATABASE CONNECTION PRE-REQUISITES above)
```

**✅ Only proceed after seeing:**
- ✅ Connected to VPS server `103.118.16.189:5432/ipodhan`
- ✅ All tables exist
- ✅ Record counts displayed (not errors)

---

**Base Loop:** Test ALL → Document → Fix ALL → Re-test → Verify → Gate

### 🔄 ENHANCED LOOP WITH AUTO-IMPROVEMENT:

```
ITERATION N:
1. Execute all tests in current iteration
2. For EACH issue found:
   a. Classify issue type
   b. Perform root cause analysis
   c. Generate related tests (3-5 new tests per issue)
   d. Add to TEST_ISSUES.json with new tests
   e. Update TEST_PROGRESS.md
   f. Add new tests to NEXT iteration
3. Fix all issues
4. ITERATION N+1:
   - Include all new tests generated from issues
   - Re-test fixed issues
   - May discover MORE issues → generates MORE tests
5. Repeat until NO NEW ISSUES found
6. Final validation
7. Gate check
```

### ITERATION 1: Initial Scraping + Issue Discovery

**1. Database Schema Verification (VPS PostgreSQL)**

**⚠️ CRITICAL: All queries MUST execute against VPS database `103.118.16.189:5432/ipodhan`**

```bash
# Verify you're connected to VPS database (NOT local)
node scripts/check-tables-exist.js
# Output MUST show: Connected to: 103.118.16.189:5432/ipodhan
```

**Check all tables exist per `drizzle/migrations/schema.ts`:**

Using `psql` or database query tool connected to VPS:
```bash
# Option 1: Use psql directly
PGPASSWORD="Papa3Monu@1234" psql -h 103.118.16.189 -p 5432 -U postgres -d ipodhan -c "\dt"

# Option 2: Use the provided script (ensures VPS connection)
node scripts/check-tables-exist.js
```

**Expected tables (from schema):**
- Core: ipos, ipo_details, ipo_financials, ipo_reviews, ipo_scores
- Supporting: market_holidays, registrars, documents
- GMP & Subscription: gmp_history, gmp_records, gmp_tracking, subscription_data, subscriptions
- Performance: listing_performance, peer_companies, financial_data
- System: broker_affiliates, scraper_logs, pipeline_status

**Verify indexes and foreign keys:**
```sql
-- Run against VPS database
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

**Document any missing tables or indexes**

**2. Run All Scrapers**
```bash
npm run scrape:historical
npm run scrape:historical:incremental
# Market holidays, reviews, prospectus scrapers
```

**3. ✅ ENHANCEMENT #1: Scraper Health Monitoring**
```sql
-- Check scraper_logs for SUCCESS status
SELECT source, status, records_processed, records_failed, duration_ms, error_message
FROM scraper_logs
ORDER BY created_at DESC
LIMIT 50;

-- Check pipeline_status health
SELECT source, pipeline_type, status, last_success_at, consecutive_failures,
       records_processed, execution_time_ms
FROM pipeline_status
ORDER BY last_run_at DESC;

-- Flag stale data (>48 hours)
SELECT source, last_success_at,
       EXTRACT(EPOCH FROM (NOW() - last_success_at))/3600 as hours_since_success
FROM pipeline_status
WHERE last_success_at < NOW() - INTERVAL '48 hours';
```

**🔄 AUTO-IMPROVEMENT TRIGGER:**
```
IF any scraper shows status != 'SUCCESS':
  CLASSIFY: Scraper Failure
  ROOT CAUSE: Investigate error_message, error_stack

  GENERATE TESTS:
  - [ ] Test scraper with sample HTML from source
  - [ ] Verify source website is accessible
  - [ ] Check if HTML structure changed (compare with baseline)
  - [ ] Test scraper error handling
  - [ ] Verify scraper logs errors properly
  - [ ] Check rate limiting not causing failures
  - [ ] Test scraper retry logic

  ADD TO: Iteration 2 test suite
  UPDATE: TEST_ISSUES.json with issue #ISS-XXX
```

**Success Criteria:**
- ✅ All scrapers show SUCCESS
- ✅ consecutiveFailures = 0
- ✅ lastSuccessAt within 24 hours
- ✅ recordsProcessed > 0

**4. ✅ ENHANCEMENT #2: Fuzzy Matching Quality Tests**
```sql
-- Check unmatched reviews
SELECT review_title, author, category
FROM ipo_reviews
WHERE ipo_id IS NULL;

-- Check unmatched documents
SELECT title, exchange, type
FROM documents
WHERE ipo_id IS NULL;

-- Match rate calculation
SELECT
  (SELECT COUNT(*) FROM ipo_reviews WHERE ipo_id IS NOT NULL) * 100.0 /
  (SELECT COUNT(*) FROM ipo_reviews) as review_match_rate,
  (SELECT COUNT(*) FROM documents WHERE ipo_id IS NOT NULL) * 100.0 /
  (SELECT COUNT(*) FROM documents) as document_match_rate;
```

**⚠️ Reviews Limitation**: No centralized reviews API discovered (see Current Implementation Status above).
- Reviews are per-IPO embedded content only
- Expect **significantly lower review coverage** (<50% of IPOs may have reviews)
- Adjust fuzzy matching expectations accordingly
- Skip testing for "centralized reviews list" functionality
- Focus testing on per-IPO review display only

**🔄 AUTO-IMPROVEMENT TRIGGER:**
```
IF unmatched_reviews > 10% of total:
  CLASSIFY: Data Quality Issue
  ROOT CAUSE: Fuzzy matching threshold or logic issue

  GENERATE TESTS:
  - [ ] Test fuzzy match with exact unmatched names
  - [ ] Lower similarity threshold from 85% to 80% and retest
  - [ ] Check for company name variations in database
  - [ ] Test with manual name mapping for common variations
  - [ ] Verify levenshtein distance calculation
  - [ ] Add logging for match confidence scores
  - [ ] Create manual match override mechanism

  ANALYZE UNMATCHED:
  - Query: SELECT review_title FROM ipo_reviews WHERE ipo_id IS NULL;
  - For each: Search ipos table for similar names
  - Document: Why didn't it match? (typo, abbreviation, different format)

  ADD TO: Iteration 2 test suite
```

**Success Criteria:**
- ✅ >90% of reviews matched to IPOs
- ✅ >90% of documents matched to IPOs
- ✅ No false positives (wrong IPO matched)
- ✅ Manual verification of 10 sample IPOs

**5. ✅ ENHANCEMENT #3: Data Source Change Detection**
- Save baseline HTML snapshots from NSE, BSE, Chittorgarh (one-time)
- Before each scrape, validate source structure
- Compare CSS selectors still valid
- Calculate structure similarity percentage
- Alert if <70% similarity

**🔄 AUTO-IMPROVEMENT TRIGGER:**
```
IF source structure similarity < 70%:
  CLASSIFY: Scraper Failure - Source Changed

  IMMEDIATE ACTION:
  - PAUSE all affected scrapers
  - Take screenshot of changed source in headed mode
  - Compare with baseline screenshot
  - Document what changed (table structure, CSS classes, etc.)

  GENERATE TESTS:
  - [ ] Manual verification: Can we still parse data?
  - [ ] Update CSS selectors in scraper
  - [ ] Test new selectors with live data
  - [ ] Update baseline snapshot
  - [ ] Add more robust selectors (multiple fallback selectors)
  - [ ] Verify all data fields still extractable

  ADD TO: Immediate fixing, then Iteration 2 validation
```

**Baseline Files:**
```
test-results/phase-1/baselines/
├── nse-holiday-calendar-baseline.html
├── bse-holiday-calendar-baseline.html
├── chittorgarh-reviews-baseline.html
├── nse-prospectus-baseline.html
└── bse-prospectus-baseline.html
```

**6. ✅ ENHANCEMENT #4: Incremental Scraping Tests**
```bash
# Run scrapers twice
npm run scrape:historical
# Note counts
npm run scrape:historical:incremental
# Verify no duplicates
```

```sql
-- Check for duplicate IPOs
SELECT slug, COUNT(*)
FROM ipos
GROUP BY slug
HAVING COUNT(*) > 1;

-- Check for duplicate reviews
SELECT ipo_id, review_title, COUNT(*)
FROM ipo_reviews
GROUP BY ipo_id, review_title
HAVING COUNT(*) > 1;

-- Check for duplicate documents
SELECT url, COUNT(*)
FROM documents
GROUP BY url
HAVING COUNT(*) > 1;

-- Check for duplicate market holidays
SELECT date, exchange, description, COUNT(*)
FROM market_holidays
GROUP BY date, exchange, description
HAVING COUNT(*) > 1;

-- Verify updated_at timestamps changed
SELECT id, company_name, updated_at
FROM ipos
WHERE id = 'sample-ipo-id';
-- Run scraper
-- Re-query and compare updated_at
```

**🔄 AUTO-IMPROVEMENT TRIGGER:**
```
IF duplicates found:
  CLASSIFY: Data Quality Issue - Duplicate Records

  ROOT CAUSE: Upsert logic not working correctly

  GENERATE TESTS:
  - [ ] Review upsert logic in scraper code
  - [ ] Check unique constraints in database schema
  - [ ] Test: Does slug uniqueness constraint exist?
  - [ ] Test: Run scraper 3 times, verify still no duplicates
  - [ ] Check updated_at timestamp changes on re-scrape
  - [ ] Verify which fields are updated vs preserved
  - [ ] Test conflict resolution (what happens if data differs?)
  - [ ] Add database triggers to prevent duplicates

  INVESTIGATE DUPLICATES:
  - Query: SELECT * FROM ipos WHERE slug IN (SELECT slug FROM ipos GROUP BY slug HAVING COUNT(*) > 1);
  - Document: Which fields differ between duplicates?
  - Decide: Which record to keep? (most recent? most complete?)

  FIX: De-duplicate database, fix upsert logic
  ADD TO: Iteration 2 validation
```

**Success Criteria:**
- ✅ Zero duplicates
- ✅ updated_at reflects re-scraping
- ✅ No data loss on existing records
- ✅ New records properly inserted
- ✅ Changed records properly updated

**7. Data Population Verification**
```sql
-- Count all tables
SELECT 'ipos' as table, COUNT(*) as count FROM ipos
UNION ALL SELECT 'ipo_details', COUNT(*) FROM ipo_details
UNION ALL SELECT 'ipo_financials', COUNT(*) FROM ipo_financials
UNION ALL SELECT 'ipo_reviews', COUNT(*) FROM ipo_reviews
UNION ALL SELECT 'market_holidays', COUNT(*) FROM market_holidays
UNION ALL SELECT 'documents', COUNT(*) FROM documents
UNION ALL SELECT 'listing_performance', COUNT(*) FROM listing_performance
UNION ALL SELECT 'gmp_tracking', COUNT(*) FROM gmp_tracking
UNION ALL SELECT 'subscriptions', COUNT(*) FROM subscriptions
UNION ALL SELECT 'peer_companies', COUNT(*) FROM peer_companies
UNION ALL SELECT 'registrars', COUNT(*) FROM registrars
UNION ALL SELECT 'scraper_logs', COUNT(*) FROM scraper_logs;
```

### ITERATION 2: Data Quality & Coverage Analysis

**8. Field Coverage Analysis**
- For each table, check NULL counts for all fields
- Generate SCRAPING_COVERAGE_REPORT.md
- Calculate coverage percentage per field
- Identify critical gaps (fields with <70% coverage)

```sql
-- Example for ipos table (31 fields)
SELECT
  'companyName' as field,
  COUNT(*) as total,
  COUNT(company_name) as populated,
  ROUND(100.0 * COUNT(company_name) / COUNT(*), 2) as coverage_percent
FROM ipos
UNION ALL
SELECT 'issueSize', COUNT(*), COUNT(issue_size),
  ROUND(100.0 * COUNT(issue_size) / COUNT(*), 2)
FROM ipos
UNION ALL
SELECT 'sector', COUNT(*), COUNT(sector),
  ROUND(100.0 * COUNT(sector) / COUNT(*), 2)
FROM ipos
-- ... repeat for all 31 fields
ORDER BY coverage_percent ASC;
```

**9. ✅ ENHANCEMENT #5: GMP & Subscription Data Tests**

**✅ Implementation Status**: GMP scraper fully operational as of 2025-10-13
- Location: `lib/scrapers/sources/gmp-api-scraper.ts` (501 lines)
- Test Results: 98.5% success rate (64/65 IPOs scraped successfully)
- Status: **Production-ready**, pending database integration with `DATABASE_URL`
- Data Source: InvestorGain API (`webnodejs.investorgain.com`)
- Features Implemented:
  - HTML entity decoding for currency symbols (₹)
  - Fuzzy matching with 85% Levenshtein threshold
  - Safe parsing for nullable dates and string numeric fields
  - Comprehensive Zod validation schemas
  - API pagination handling (10 records per page limit)
- Performance: Average scraping time ~4.5 seconds for 64 IPOs
- Test Scripts Available:
  - `scripts/test-gmp-scraper.ts` - Full integration test
  - `scripts/check-gmp-data-types.ts` - Data type validation
  - `scripts/debug-gmp-api-response.ts` - API response debugging

```sql
-- GMP freshness for OPEN IPOs
SELECT
  company_name,
  status,
  gmp,
  gmp_percentage,
  gmp_updated_at,
  EXTRACT(EPOCH FROM (NOW() - gmp_updated_at))/3600 as hours_since_update
FROM ipos
WHERE status IN ('OPEN', 'UPCOMING')
ORDER BY gmp_updated_at DESC;

-- Flag stale GMP (>24 hours old)
SELECT company_name, status, gmp_updated_at
FROM ipos
WHERE status IN ('OPEN', 'UPCOMING')
AND gmp_updated_at < NOW() - INTERVAL '24 hours';

-- Multi-source GMP verification
SELECT
  i.company_name,
  array_agg(DISTINCT gt.source) as sources,
  COUNT(DISTINCT gt.source) as source_count,
  AVG(gt.gmp_amount) as avg_gmp,
  MAX(gt.recorded_at) as latest_update
FROM ipos i
JOIN gmp_tracking gt ON i.id = gt.ipo_id
WHERE i.status IN ('OPEN', 'UPCOMING')
GROUP BY i.company_name
ORDER BY latest_update DESC;

-- GMP history tracking
SELECT
  i.company_name,
  COUNT(gh.id) as gmp_records,
  MIN(gh.recorded_at) as first_record,
  MAX(gh.recorded_at) as latest_record,
  MAX(gh.gmp_value) as peak_gmp
FROM ipos i
LEFT JOIN gmp_history gh ON i.id = gh.ipo_id
WHERE i.status IN ('OPEN', 'UPCOMING')
GROUP BY i.company_name;

-- Subscription time-series
SELECT
  i.company_name,
  i.status,
  COUNT(s.id) as subscription_records,
  MIN(s.timestamp) as first_snapshot,
  MAX(s.timestamp) as latest_snapshot,
  MAX(s.total_subscription) as peak_subscription
FROM ipos i
LEFT JOIN subscriptions s ON i.id = s.ipo_id
WHERE i.status IN ('OPEN', 'CLOSED')
GROUP BY i.company_name, i.status
ORDER BY latest_snapshot DESC;

-- Subscription categories completeness
SELECT
  i.company_name,
  s.qib_subscription,
  s.nii_subscription,
  s.retail_subscription,
  s.employee_subscription,
  s.total_subscription,
  s.timestamp
FROM ipos i
JOIN subscriptions s ON i.id = s.ipo_id
WHERE i.status = 'OPEN'
AND s.timestamp = (
  SELECT MAX(timestamp)
  FROM subscriptions
  WHERE ipo_id = i.id
);
```

**Test API Endpoints:**
- `GET /api/ipos/[slug]/gmp/latest`
- `GET /api/ipos/[slug]/subscriptions/latest`

**🔄 AUTO-IMPROVEMENT TRIGGER:**
```
IF any OPEN IPO has gmp IS NULL:
  CLASSIFY: Data Quality Issue - Missing Critical Data

  ROOT CAUSE: GMP scraper not running or failing

  GENERATE TESTS:
  - [ ] Check scraper_logs for GMP scraper execution
  - [ ] Test GMP scraper independently for missing IPOs
  - [ ] Verify GMP sources (IPOWatch, InvestorGain, Chittorgarh) are accessible
  - [ ] Check if GMP data exists on source websites for these IPOs
  - [ ] Test gmp_tracking table has records for these IPOs
  - [ ] Verify materialized view gmp_current is refreshed
  - [ ] Test GMP API endpoint returns data
  - [ ] Add alert for missing GMP on OPEN IPOs

  EXPAND TESTING:
  - [ ] Test ALL OPEN IPOs for GMP data
  - [ ] Check GMP freshness (<24 hours) for ALL
  - [ ] Verify multi-source GMP for ALL
  - [ ] Test GMP chart rendering with real data

  ADD TO: Iteration 2 comprehensive GMP testing
```

**Success Criteria:**
- ✅ All OPEN IPOs have GMP data updated within 24 hours
- ✅ Each IPO has GMP from 2+ sources (where available)
- ✅ Time-series data exists (multiple records per IPO)
- ✅ All subscription categories populated for OPEN IPOs
- ✅ API endpoints return accurate, fresh data

**10. ✅ ENHANCEMENT #6: Historical Data Completeness Tests**

```sql
-- Check all LISTED IPOs have listing_performance
SELECT
  i.id,
  i.company_name,
  i.listing_date,
  i.status,
  CASE WHEN lp.id IS NOT NULL THEN 'Has Data' ELSE 'MISSING' END as performance_status
FROM ipos i
LEFT JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.status = 'LISTED'
ORDER BY i.listing_date DESC;

-- Count missing records
SELECT COUNT(*) as listed_ipos_without_performance
FROM ipos i
LEFT JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.status = 'LISTED' AND lp.id IS NULL;

-- Check required fields populated
SELECT
  i.company_name,
  lp.listing_price,
  lp.issue_price,
  lp.listing_gain_percent,
  lp.current_price,
  lp.last_updated
FROM ipos i
JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.status = 'LISTED'
AND (
  lp.listing_price IS NULL OR
  lp.issue_price IS NULL OR
  lp.listing_gain_percent IS NULL
);

-- Current price freshness
SELECT
  i.company_name,
  i.listing_date,
  lp.current_price,
  lp.current_price_bse,
  lp.current_price_nse,
  lp.last_updated,
  EXTRACT(DAY FROM (NOW() - lp.last_updated)) as days_since_update
FROM ipos i
JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.status = 'LISTED'
AND lp.last_updated < NOW() - INTERVAL '7 days'
ORDER BY lp.last_updated ASC;

-- Multi-year coverage
SELECT
  EXTRACT(YEAR FROM listing_date) as year,
  COUNT(*) as total_listings,
  COUNT(lp.id) as with_performance_data,
  ROUND(100.0 * COUNT(lp.id) / COUNT(*), 2) as coverage_percent
FROM ipos i
LEFT JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.status = 'LISTED'
GROUP BY EXTRACT(YEAR FROM listing_date)
ORDER BY year DESC;

-- BSE vs NSE price comparison
SELECT
  i.company_name,
  i.exchange,
  lp.current_price_bse,
  lp.current_price_nse,
  CASE
    WHEN lp.current_price_bse IS NULL THEN 'BSE Missing'
    WHEN lp.current_price_nse IS NULL THEN 'NSE Missing'
    ELSE 'Both Present'
  END as price_status
FROM ipos i
JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.status = 'LISTED'
AND i.exchange = 'BOTH'
ORDER BY i.listing_date DESC;

-- Category coverage
SELECT
  i.category,
  COUNT(*) as total_listed,
  COUNT(lp.id) as with_performance,
  ROUND(100.0 * COUNT(lp.id) / COUNT(*), 2) as coverage_percent
FROM ipos i
LEFT JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.status = 'LISTED'
GROUP BY i.category;

-- Performance metrics validation
SELECT
  i.company_name,
  lp.listing_price,
  lp.issue_price,
  lp.listing_gain_percent,
  ROUND(((lp.listing_price - lp.issue_price)::numeric / lp.issue_price * 100), 2) as calculated_gain_percent,
  ABS(lp.listing_gain_percent - ROUND(((lp.listing_price - lp.issue_price)::numeric / lp.issue_price * 100), 2)) as difference
FROM ipos i
JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.status = 'LISTED'
AND ABS(lp.listing_gain_percent - ROUND(((lp.listing_price - lp.issue_price)::numeric / lp.issue_price * 100), 2)) > 0.1
ORDER BY difference DESC;
```

**Test API:**
- `GET /api/ipos/history` - with filters, pagination, sorting

**🔄 AUTO-IMPROVEMENT TRIGGER:**
```
IF any LISTED IPO missing listing_performance:
  CLASSIFY: Data Quality Issue - Incomplete Historical Data

  ROOT CAUSE: Historical scraper incomplete or failing

  GENERATE TESTS:
  - [ ] List all LISTED IPOs without performance data
  - [ ] Check if data exists on source (Chittorgarh, NSE, BSE)
  - [ ] Test historical scraper specifically for missing IPOs
  - [ ] Verify listing_date is populated for these IPOs
  - [ ] Check if these are recent listings (< 7 days old - may not have current price)
  - [ ] Verify listingPrice and issuePrice fields
  - [ ] Test calculation of listingGainPercent
  - [ ] Add validation: LISTED status requires listing_performance record

  PATTERN DETECTION:
  - Are missing records all from same year?
  - Are missing records all same category (MAINBOARD/SME)?
  - Are missing records all same sector?
  → If pattern found, investigate scraper logic for that pattern

  FIX: Run targeted scraping for missing IPOs
  ADD TO: Iteration 2 validation + comprehensive historical checks
```

**Success Criteria:**
- ✅ 100% of LISTED IPOs have listing_performance record
- ✅ All required fields populated
- ✅ Current prices updated within 7 days
- ✅ Historical data spans 2020-2025
- ✅ >95% coverage for each year
- ✅ Both BSE and NSE prices for dual-listed IPOs
- ✅ Calculated metrics are accurate

### ITERATION 3: Fix All Data Gaps

**11. Fix Scrapers**
- Update parsing logic for structure changes
- Improve fuzzy matching algorithms
- Add missing scrapers (GMP, subscriptions, peer companies if needed)
- Fix rate limiting issues
- Re-run all scrapers

**12. Data Integrity Checks**
```sql
-- Foreign key integrity
SELECT COUNT(*) FROM ipo_details WHERE ipo_id NOT IN (SELECT id FROM ipos);
SELECT COUNT(*) FROM ipo_reviews WHERE ipo_id NOT IN (SELECT id FROM ipos);
SELECT COUNT(*) FROM documents WHERE ipo_id NOT IN (SELECT id FROM ipos);

-- Duplicate slugs
SELECT slug, COUNT(*) FROM ipos GROUP BY slug HAVING COUNT(*) > 1;

-- Date logic
SELECT * FROM ipos WHERE close_date < open_date;
SELECT * FROM ipos WHERE status = 'LISTED' AND listing_date IS NULL;

-- Price logic
SELECT * FROM ipos WHERE price_band_high < price_band_low;

-- Data quality
SELECT * FROM ipos WHERE lot_size <= 0;
SELECT * FROM ipos WHERE issue_size <= 0;
```

**Apply all auto-generated tests from Iteration 1 & 2 issues**

### ITERATION 4: Final Phase 1 Validation

**13. Sample Data Verification**
- Pick 5 random IPOs (across all statuses: UPCOMING, OPEN, CLOSED, LISTED)
- For each IPO, visit source websites using Playwright headed mode
- Compare field-by-field with our database
- Take screenshots of source pages
- Document any discrepancies
- **Goal: 100% match between source and database**

**14. Success Criteria Checklist**
- ✅ Schema matches drizzle/migrations/schema.ts
- ✅ All scrapers SUCCESS in scraper_logs
- ✅ consecutiveFailures = 0 for all scrapers
- ✅ ≥150 IPOs in database (or per your data)
- ✅ 100% critical field coverage
- ✅ >90% important field coverage
- ✅ >70% enhanced field coverage
- ✅ Zero duplicates
- ✅ Foreign keys valid
- ✅ Date logic valid
- ✅ Price logic valid
- ✅ GMP/subscription data fresh for OPEN IPOs
- ✅ Historical data complete for LISTED IPOs
- ✅ Fuzzy matching >90% accuracy
- ✅ Source change detection in place
- ✅ Incremental scraping works without duplicates
- ✅ Dev server running on localhost:3000
- ✅ API endpoints respond
- ✅ SCRAPING_COVERAGE_REPORT.md complete
- ✅ TEST_PROGRESS.md updated
- ✅ TEST_ISSUES.json current
- ✅ Git commit for Phase 1

**✅ GATE: Phase 1 Complete - Proceed to Phase 2**

---

### 📝 GIT CHECKPOINT: Commit Phase 1 Results

**Action Required**: Commit all Phase 1 testing work before proceeding to Phase 2.

```bash
# Commit Phase 1 completion
git add TEST_PROGRESS.md TEST_ISSUES.json SCRAPING_COVERAGE_REPORT.md test-results/
git commit -m "test(phase-1): Complete data scraping validation

✅ All scrapers SUCCESS (0 consecutive failures)
✅ [X] IPOs in database with [Y]% field coverage
✅ GMP/subscription data fresh for OPEN IPOs
✅ Historical data complete for LISTED IPOs
✅ Zero duplicates, all foreign keys valid
✅ Fuzzy matching >90% accuracy

Issues resolved: [count] (see TEST_ISSUES.json)
Coverage: Critical 100%, Important [X]%, Enhanced [Y]%"

git push origin test/story-[number]
```

---

## PHASE 2: CORE PAGES TESTING (HEADED MODE)

**Loop Pattern:** Test ALL → Document → Fix ALL → Re-test → Verify → Gate Check

**Screens:** Homepage, Dashboard, Historical IPOs, IPO Detail

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

## PHASE 3: TOOLS & FEATURES TESTING (HEADED MODE)

**Loop Pattern:** Test ALL → Document → Fix ALL → Re-test → Verify → Gate Check

**Screens:** Lot Calculator, IPO Compare, Allotment Checker, Registrars, Market Holidays

### ITERATION 1: Test All Tools

**26. ✅ ENHANCEMENT #14: Lot Calculator**
```
Test:
- Navigate to /tools/lot-calculator
- IPO selection dropdown populated with current IPOs
- Select an IPO
- Enter investment amount
- Verify lot calculation accuracy:
  - Lots = floor(investment / (lotSize * price))
  - Total amount = lots * lotSize * price
- Test edge cases:
  - Minimum investment
  - Maximum lots
  - Fractional amounts
- Test with price band low and high
- Verify all result fields display
- Test responsive on mobile
```

**🔄 AUTO-IMPROVEMENT TRIGGER:**
```
IF calculation wrong:
  CLASSIFY: Logic Error

  ROOT CAUSE: Check calculation formula

  GENERATE TESTS:
  - [ ] Document expected calculation
  - [ ] Test with known values (manual calculation)
  - [ ] Test edge cases: minimum investment, max lots
  - [ ] Test with different price bands
  - [ ] Verify lot size multiplier correct
  - [ ] Check rounding logic
  - [ ] Test with decimal amounts
  - [ ] Add unit tests for calculation function
  - [ ] Compare with competitor calculators

  EXPAND:
  - [ ] Test ALL IPOs with calculator
  - [ ] Verify lotSize field accurate in database
  - [ ] Test minimum investment calculation

  ADD TO: Iteration 2
```

**27. ✅ ENHANCEMENT #15: IPO Compare Tool**
```
Test:
- Navigate to /tools/compare
- Multi-select 2-5 IPOs
- Click "Compare"
- Verify comparison table displays side-by-side
- Check all metrics compared:
  - Issue size
  - Price band
  - Open/close dates
  - GMP
  - Subscription data
  - Ratings
  - Financial metrics
- Test sort columns
- Test with different IPO combinations
- Verify responsive on mobile
```

**28. ✅ ENHANCEMENT #16: Allotment Checker**
```
Test:
- On IPO detail page, find Allotment Checker section
- Test form validation:
  - PAN format: 10 characters, alphanumeric
  - Required field validation
- Enter valid PAN
- Click "Check Allotment" button
- Verify loading state appears
- Check results display (if data available)
- Test error handling: invalid PAN format
- Test external link to registrar site (if redirect)
```

**29. Registrars Page**
```
Test:
- Navigate to /registrars
- Verify registrars list displays
- Check all 12 fields for each registrar:
  - name, shortName
  - email, phone
  - website, allotmentCheckUrl
  - address, logoUrl
  - active status
- Test search/filter (if exists)
- Verify contact info correct
- Click allotmentCheckUrl links → verify they work
- Test responsive layout
```

**30. Market Holidays**
```
Test:
- Navigate to /market-holidays
- Verify holiday list displays
- Test filters:
  - Exchange filter (NSE/BSE/BOTH)
  - Month filter
- Verify current year + next year holidays shown
- Check date accuracy (compare with official calendars)
- Verify holiday types (Trading, Settlement, Both)
- Check descriptions accurate
- Test responsive layout
```

### ITERATION 2-4: Fix, Re-test, Verify

**Apply all auto-generated tests**

**✅ GATE: Phase 3 Complete - Proceed to Phase 4**

---

### 📝 GIT CHECKPOINT: Commit Phase 3 Results

**Action Required**: Commit all Phase 3 testing work before proceeding to Phase 4.

```bash
# Commit Phase 3 completion
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-3/
git commit -m "test(phase-3): Complete tools & features testing

✅ Lot Calculator accurate for all IPOs
✅ IPO Compare tool validated (2-5 IPO comparison)
✅ Allotment Checker form validation working
✅ Registrars page displays all contact info
✅ Market Holidays accurate (NSE/BSE calendars)
✅ All tools responsive on mobile

Issues resolved: [count] (see TEST_ISSUES.json)
Tools tested: Calculator, Compare, Allotment, Registrars, Holidays"

git push origin test/story-[number]
```

---

## PHASE 4: CATEGORY PAGES TESTING (HEADED MODE)

**Loop Pattern:** Test ALL → Document → Fix ALL → Re-test → Verify → Gate Check

### ITERATION 1: Test All Category Pages

**31. ✅ ENHANCEMENT #17: Mainboard vs SME Segregation**

**Mainboard Pages:**
```
Test each:
- /mainboard-ipos (landing)
- /mainboard-ipo-calendar
- /mainboard-ipo-performance-tracker
- /mainboard-ipo-prospectus
- /mainboard-ipo-listings
- /mainboard-ipo-reviews

For each page:
✓ Verify only MAINBOARD category IPOs shown
✓ Count accuracy on landing page
✓ No SME IPOs mixed in
✓ Filters work correctly
✓ Navigation works
```

**SME Pages:**
```
Test each:
- /sme-ipos (landing)
- /sme-ipo-calendar
- /sme-ipo-performance-tracker
- /sme-ipo-prospectus
- /sme-ipo-listings
- /sme-ipo-reviews

For each page:
✓ Verify only SME category IPOs shown
✓ Count accuracy
✓ No MAINBOARD IPOs mixed in
✓ Filters work correctly
```

**API Endpoints:**
```
Test:
- GET /api/prospectus/mainboard → only MAINBOARD
- GET /api/prospectus/sme → only SME
- GET /api/reviews/mainboard → only MAINBOARD
- GET /api/reviews/sme → only SME
```

**32. ✅ ENHANCEMENT #18: Special Categories**

**Test each category page:**
```
- /ofs (Offer for Sale)
- /ncd (Non-Convertible Debentures)
- /rights-issues
- /fpo-listings (Follow-on Public Offering)
```

**For each page:**
```
✓ Page loads without errors
✓ Check if data exists for this category
✓ If data exists: verify correct category shown
✓ If no data: verify proper empty state message
✓ Check schema supports category (ipos.category enum)
✓ Verify category filter works on dashboard
```

**Schema Check:**
```sql
-- Verify categories in schema
SELECT DISTINCT category FROM ipos;
-- Should include: MAINBOARD, SME, RIGHTS, NCD, FPO

-- Check if OFS is missing from schema
-- If so, add to drizzle/migrations/schema.ts
```

**33. All Category Landing Pages (14 pages total)**
```
Test:
- Data displays correctly
- Filters work (if applicable)
- Search functions (if applicable)
- Navigation to detail pages works
- Empty states for no data
- Pagination works
- Mobile responsive
```

### ITERATION 2-4: Fix, Re-test, Verify

**✅ GATE: Phase 4 Complete - Proceed to Phase 5**

---

### 📝 GIT CHECKPOINT: Commit Phase 4 Results

**Action Required**: Commit all Phase 4 testing work before proceeding to Phase 5.

```bash
# Commit Phase 4 completion
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-4/
git commit -m "test(phase-4): Complete category pages testing

✅ Mainboard vs SME segregation verified (12 pages)
✅ All category pages display correct data
✅ Special categories tested (OFS, NCD, Rights, FPO)
✅ API endpoints filter by category correctly
✅ Empty states for categories with no data
✅ All 14 category landing pages functional

Issues resolved: [count] (see TEST_ISSUES.json)
Pages tested: MAINBOARD (6), SME (6), Special categories (4)"

git push origin test/story-[number]
```

---

## PHASE 5: INTEGRATION & PERFORMANCE TESTING

**Loop Pattern:** Test ALL → Document → Fix ALL → Re-test → Verify → Gate Check

### ITERATION 1: Test All Integrations

**34. ✅ ENHANCEMENT #19: ISR Testing**
```
Test Incremental Static Regeneration:
- Dashboard has revalidate = 3600 (1 hour)
- Historical page revalidates every hour

Test:
1. Load dashboard → note load time
2. Refresh within 1 hour → should be cached (faster)
3. Wait 1 hour → refresh → should regenerate (slower first time)
4. Measure performance gain: cached vs fresh

When new IPO added:
- Verify ISR revalidates correctly
- Check cached version serves until revalidation
```

**35. ✅ ENHANCEMENT #20: API Endpoint Testing**

**Test ALL 23 API routes:**
```
For EACH endpoint:
1. Test with valid parameters
2. Check response status: 200
3. Verify response schema matches expected
4. Validate data accuracy
5. Test with invalid parameters → proper error codes
6. Measure response time <500ms
7. Test error handling (404, 500)
8. Check CORS headers if needed
```

**Endpoints to test:**
- GET /api/ipos (with filters: status, category, sector, search, page)
- GET /api/ipos/[slug]
- GET /api/ipos/[slug]/gmp/latest
- GET /api/ipos/[slug]/subscriptions/latest
- GET /api/ipos/[slug]/rating
- GET /api/ipos/history (with filters: year, sector, performance, sort, page)
- GET /api/ipos/listings
- GET /api/registrars
- GET /api/market-holidays
- GET /api/sectors
- GET /api/tools/lot-calculator
- GET /api/tools/compare
- POST /api/affiliate/track
- GET /api/admin/scraper/logs (if admin exists)
- GET /api/admin/scraper/status (if admin exists)
- GET /api/health
- GET /api/prospectus/mainboard
- GET /api/prospectus/sme
- GET /api/reviews/mainboard
- GET /api/reviews/sme
- GET /api/db-test
- GET /api/test-redis

**🔄 AUTO-IMPROVEMENT TRIGGER:**
```
IF any API returns 500 error:
  CLASSIFY: Backend Error

  ROOT CAUSE: Check server logs, error stack

  GENERATE TESTS:
  - [ ] Test this API with various inputs
  - [ ] Test with invalid query parameters
  - [ ] Test with missing required parameters
  - [ ] Test with SQL injection attempts
  - [ ] Verify error handling returns proper status codes
  - [ ] Check error message is helpful
  - [ ] Verify no sensitive data in error response
  - [ ] Test API with empty database
  - [ ] Load test: 100 concurrent requests

  IF API slow (>1000ms):
    - [ ] Profile API execution time
    - [ ] Check database query performance
    - [ ] Identify slow queries (pg_stat_statements)
    - [ ] Add database indexes if needed
    - [ ] Consider caching
    - [ ] Add response time monitoring

  ADD TO: Iteration 2
```

**36. ✅ ENHANCEMENT #21: Rating Calculation**
```bash
npm run calculate-ratings
```

**Test:**
```sql
-- Verify ipo_scores table populated
SELECT COUNT(*) FROM ipo_scores;

-- Check score ranges
SELECT
  MIN(total_score), MAX(total_score),
  MIN(fundamental_score), MAX(fundamental_score),
  MIN(sentiment_score), MAX(sentiment_score),
  MIN(subscription_score), MAX(subscription_score),
  MIN(sector_score), MAX(sector_score)
FROM ipo_scores;

-- Verify constraints (totalScore 0-100, etc.)
SELECT * FROM ipo_scores
WHERE total_score < 0 OR total_score > 100;

-- Check score_history tracks changes
SELECT COUNT(*) FROM score_history;
```

**On IPO detail pages:**
- Verify rating badge displays
- Check rating matches database
- Verify ratingOverride flag works

**37. ✅ ENHANCEMENT #22: Database Performance**
```
Test:
- Log all queries during page loads
- Identify queries >100ms
- Run EXPLAIN ANALYZE on slow queries
- Check if indexes are used
- Monitor connection pool
- Identify N+1 queries

For slow queries:
- Add missing indexes
- Optimize query logic
- Consider caching

Test materialized views:
- Verify gmp_current refreshes correctly
- Verify current_ipo_scores refreshes correctly
```

**🔄 AUTO-IMPROVEMENT TRIGGER:**
```
IF any query >100ms:
  CLASSIFY: Performance Issue

  ROOT CAUSE: Missing index, inefficient query

  GENERATE TESTS:
  - [ ] Run EXPLAIN ANALYZE on slow query
  - [ ] Check if indexes are used
  - [ ] Identify missing indexes
  - [ ] Test query with proposed index
  - [ ] Verify query plan improves
  - [ ] Measure before/after performance
  - [ ] Add index to schema.ts
  - [ ] Run db:push to apply

  EXPAND:
  - [ ] Profile ALL API endpoints for query performance
  - [ ] Generate slow query report
  - [ ] Optimize top 10 slowest queries

  ADD TO: Iteration 2 performance optimization
```

**38. ✅ ENHANCEMENT #24: Redis Caching** (if enabled)
```
Test:
- Make API call → note response time
- Repeat same API call → should be faster (cached)
- Check cache hit/miss in logs
- Test cache invalidation when data updates
- Test /api/test-redis endpoint
- Verify TTL (time-to-live) works correctly
```

**39. ✅ ENHANCEMENT #25: Logging & Monitoring**
```
Test:
- Verify Pino logs are structured (JSON format)
- Test log levels: INFO, WARN, ERROR
- Trigger error → verify Sentry receives it (if configured)
- Check scraper_logs table populated correctly
- Verify pipeline_status tracks scraper health
- Check log rotation (if configured)
```

**40. User Journey Testing**

**Journey 1: Browse → Filter → Details → Allotment**
```
Step 1: Navigate to dashboard
Step 2: Apply Status=OPEN filter
Step 3: Click on an IPO
Step 4: View IPO details
Step 5: Check allotment checker
Step 6: Use browser back button
Step 7: Verify filter still applied
```

**Journey 2: Search → Details → Documents**
```
Step 1: Search for specific IPO
Step 2: Click on IPO from search results
Step 3: Navigate to Documents section
Step 4: Click on prospectus link
Step 5: Verify PDF opens
```

**Journey 3: Calculator → Compare → Details**
```
Step 1: Use lot calculator for IPO A
Step 2: Navigate to compare tool
Step 3: Select IPO A and IPO B
Step 4: Compare side-by-side
Step 5: Click on IPO A to view details
```

**Journey 4: Historical → Filter → Details**
```
Step 1: Navigate to /history
Step 2: Apply year filter (2024)
Step 3: Apply sector filter (Technology)
Step 4: Click on an IPO
Step 5: View listing performance
```

**Test:**
- Browser back/forward buttons work
- Navigation state preserved
- No data loss across pages
- Smooth transitions

**41. ✅ ENHANCEMENT #27: Data Consistency**
```sql
-- No orphaned foreign keys
SELECT COUNT(*) FROM ipo_details WHERE ipo_id NOT IN (SELECT id FROM ipos);
SELECT COUNT(*) FROM ipo_financials WHERE ipo_id NOT IN (SELECT id FROM ipos);
SELECT COUNT(*) FROM ipo_reviews WHERE ipo_id NOT IN (SELECT id FROM ipos);

-- Slug uniqueness
SELECT slug, COUNT(*) FROM ipos GROUP BY slug HAVING COUNT(*) > 1;

-- Date logic valid
SELECT * FROM ipos WHERE close_date < open_date;
SELECT * FROM ipos WHERE listing_date IS NOT NULL AND listing_date < close_date;

-- Status consistency
SELECT * FROM ipos WHERE status = 'LISTED' AND listing_date IS NULL;
SELECT * FROM ipos WHERE status = 'UPCOMING' AND open_date < NOW();
SELECT * FROM ipos WHERE status = 'OPEN' AND close_date < NOW();

-- Category consistency
SELECT i.company_name, i.category, r.category
FROM ipos i
JOIN ipo_reviews r ON i.id = r.ipo_id
WHERE i.category != r.category;
```

**42. ✅ ENHANCEMENT #28: Security Tests (Basic)**
```
Test:
- SQL injection in search fields:
  - Input: "'; DROP TABLE ipos; --"
  - Expected: No error, no data loss

- XSS in search:
  - Input: "<script>alert('xss')</script>"
  - Expected: Escaped, no script execution

- API authentication (if admin APIs exist):
  - Test /api/admin/* without auth
  - Expected: 401 or 403

- CSRF on affiliate tracking:
  - Verify CORS headers present
  - Test from different origin

- Sensitive data:
  - Check no database credentials in client code
  - Verify .env not exposed
  - Check API responses don't leak sensitive info
```

**43. ✅ ENHANCEMENT #29: Broker-Specific Tests**
```
Test:
- Click Zerodha button
  → Verify opens correct Zerodha affiliate URL
  → Check URL format correct

- Click AngelOne button
  → Verify opens correct AngelOne affiliate URL

- Verify correct broker name in affiliate_clicks table
- Check display order (displayOrder field)
- Verify only active brokers shown (active=true)
- Test affiliate section responsive on mobile
```

**44. ✅ ENHANCEMENT #30: Document Validation**
```
Test:
- Select 10 random IPOs with documents
- For each document:
  - Click document link
  - Verify PDF opens in new tab
  - Check URL is valid (not 404)
  - Verify file actually downloads/displays

SQL checks:
- Check documents.url is valid
- Verify fileSize populated
- Check all document types present:
  SELECT DISTINCT type FROM documents;
  -- Should include: DRHP, RHP, PROSPECTUS, ADDENDUM

- Verify exchange mapping:
  SELECT exchange, COUNT(*) FROM documents GROUP BY exchange;
  -- NSE, BSE should both have documents
```

**45. Run Existing Test Suites**
```bash
# E2E tests in headed mode
npm run test:e2e:headed

# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# All tests
npm run test:all

# Verify all pass
```

### ITERATION 2-4: Fix, Re-test, Verify

**Apply all auto-generated tests from issues found**

**✅ GATE: Phase 5 Complete - Production Ready**

---

### 📝 GIT CHECKPOINT: Commit Phase 5 Results

**Action Required**: Commit all Phase 5 testing work. This is the **FINAL COMMIT** before merging to main.

```bash
# Final commit - Phase 5 completion
git add TEST_PROGRESS.md TEST_ISSUES.json CONVERGENCE_REPORT.md test-results/phase-5/
git commit -m "test(phase-5): Complete integration & performance testing

✅ All 23 API endpoints tested and responding <500ms
✅ ISR caching working correctly (1-hour revalidation)
✅ Database performance optimized (all queries <100ms)
✅ Redis caching functional (if enabled)
✅ User journeys validated (4 complete workflows)
✅ Security tests passed (SQL injection, XSS, auth)
✅ Affiliate tracking 100% accurate
✅ All existing test suites passing

Issues resolved: [count] (see TEST_ISSUES.json)
Performance: API <500ms, Pages <3s, Queries <100ms
Security: No vulnerabilities found"

git push origin test/story-[number]
```

**Next Step**: Proceed to [Final Merge to Main](#final-merge-to-main) section for merge criteria verification and production deployment.

---

## AUTO-IMPROVEMENT TRACKING

### TEST_ISSUES.json Structure
```json
{
  "lastUpdated": "2025-10-13T15:30:00Z",
  "totalIssues": 27,
  "issuesFixed": 27,
  "issuesInProgress": 0,
  "testsCoverage": {
    "initial": 45,
    "generated": 42,
    "total": 87
  },
  "issues": [
    {
      "id": "ISS-001",
      "phase": "Phase 1",
      "iteration": "Iteration 1",
      "severity": "CRITICAL",
      "description": "GMP data missing for 5 OPEN IPOs",
      "rootCause": "GMP scraper failed silently for certain sources",
      "status": "FIXED",
      "testsGenerated": [
        "Verify GMP scraper health check",
        "Test GMP multi-source coverage",
        "Add alert for missing GMP data",
        "Test GMP API endpoint for all OPEN IPOs",
        "Verify gmp_updated_at timestamps"
      ],
      "testsStatus": {
        "passed": 5,
        "failed": 0,
        "pending": 0
      },
      "relatedIssues": ["ISS-007", "ISS-012"],
      "fixedIn": "Iteration 2",
      "verifiedIn": "Iteration 3",
      "preventionAdded": "Pre-flight GMP source check before scraping"
    }
  ],
  "patterns": [
    {
      "pattern": "Missing GMP data",
      "occurrences": 3,
      "rootCause": "Scraper source reliability",
      "solution": "Add fallback sources + health monitoring",
      "prevention": "Pre-flight source check before scraping",
      "testSuiteAdded": "GMP Comprehensive Test Suite (8 tests)"
    }
  ]
}
```

### CONVERGENCE REPORT

**Generated at end of each iteration:**

```markdown
# Testing Convergence Report - Iteration 5

## Issue Discovery Rate
- Iteration 1: 15 issues found → 23 tests generated
- Iteration 2: 8 issues found → 12 tests generated
- Iteration 3: 3 issues found → 5 tests generated
- Iteration 4: 1 issue found → 2 tests generated
- Iteration 5: 0 issues found → 0 tests generated ✅

## Coverage Growth
- Initial test cases: 45
- Auto-generated tests: 42
- Total test cases: 87
- Coverage improvement: +93%

## Issue Resolution
- Total issues found: 27
- Issues fixed: 27
- Issues remaining: 0
- Fix rate: 100% ✅

## Pattern Learning
1. Missing GMP data (3 occurrences) → Solved with multi-source + monitoring
2. Fuzzy matching failures (5 occurrences) → Solved with threshold tuning + manual overrides
3. Null data displays (8 occurrences) → Solved with comprehensive null checks + defaults
4. Slow queries (4 occurrences) → Solved with database indexes
5. Filter combinations (3 occurrences) → Solved with exhaustive combination testing

## Recommendation
✅ **CONVERGENCE ACHIEVED** - Ready for next phase
- No new issues in last iteration
- All generated tests passing
- Patterns identified and solved
- Prevention measures in place
```

---

## SUCCESS CRITERIA (AUTO-ADJUSTING)

**Initial Criteria:**
- ✅ All scrapers SUCCESS
- ✅ >90% field coverage
- ✅ Zero duplicates

**Enhanced Criteria (Added During Testing):**
- ✅ GMP data <24h old for all OPEN IPOs (added after ISS-001)
- ✅ All LISTED IPOs have listing_performance (added after ISS-006)
- ✅ Search performance <200ms (added after ISS-003)
- ✅ Fuzzy match rate >95% (adjusted from 90% after ISS-002)
- ✅ All null data has default values (added after ISS-011)
- ✅ API response times <500ms (added after ISS-015)
- ✅ All filter combinations work (added after ISS-018)
- ✅ Database indexes optimized (added after ISS-022)
- ✅ Mobile responsive on all pages (added after ISS-024)
- ✅ Affiliate tracking 100% accurate (added after ISS-026)

---

## EXECUTION STRATEGY

### Agents
- **Agent 1**: Orchestrator (TodoWrite, progress tracking, convergence monitoring)
- **Agent 2**: Data pipeline (scrapers, database, Phase 1)
- **Agent 3**: Frontend testing (Playwright headed, Phase 2-4)
- **Agent 4**: Debugging (root cause analysis, pattern detection)
- **Agent 5**: Code fixes & schema updates

### Playwright Config (Headed Mode)
```javascript
headless: false
slowMo: 300
viewport: { width: 1920, height: 1080 }
devtools: true
```

### Progress Tracking
- TodoWrite maintains current phase/iteration
- All findings → TEST_PROGRESS.md (auto-updated after each issue)
- Issues → TEST_ISSUES.json (auto-populated with generated tests)
- Patterns → Tracked and documented
- Session handoff at end
- Git commit after each phase

### Schema Management
- Always reference `drizzle/migrations/schema.ts`
- Update THIS file if schema changes needed
- Document changes in TEST_PROGRESS.md
- Run `npm run db:push` after changes

---

## FINAL DELIVERABLES

✅ **Phase 1**: Maximum data coverage, field-by-field verification, all gaps documented
✅ **Phase 2-4**: All screens functional, data displays correctly
✅ **Phase 5**: All integrations work, performance optimized
✅ **Documentation**:
- TEST_PROGRESS.md (with all auto-generated test results)
- TEST_ISSUES.json (with patterns and prevention measures)
- SESSION_HANDOFF.md
- SCRAPING_COVERAGE_REPORT.md
- CONVERGENCE_REPORT.md
✅ **Schema**: Updated drizzle/migrations/schema.ts (if changes made)
✅ **Git**: Commits for each phase completion
✅ **Result**: Zero critical errors, self-improving test suite, production-ready application

---

## KEY PRINCIPLE

**Every bug is a gap in testing. Fill that gap immediately.**

When you find 1 bug → Create 5 related tests → Prevent 10 similar bugs

This plan evolves as testing progresses, becoming more comprehensive with each discovered issue. The test suite learns from failures and continuously improves its coverage.

---

## 🚀 TESTING COMPLETE - READY FOR PRODUCTION

### Congratulations! All 5 Phases Complete

You've successfully completed the comprehensive self-improving testing plan. Before merging to production, follow the steps below to ensure a smooth deployment.

---

### Step 1: Final Verification Checklist

Before proceeding with the merge, verify ALL criteria are met:

**Phase Completion**:
- ✅ Phase 1: Data scraping & validation complete
- ✅ Phase 2: Core pages testing complete
- ✅ Phase 3: Tools & features testing complete
- ✅ Phase 4: Category pages testing complete
- ✅ Phase 5: Integration & performance testing complete

**Documentation**:
- ✅ TEST_PROGRESS.md updated with final status
- ✅ TEST_ISSUES.json shows all issues resolved (0 in_progress)
- ✅ CONVERGENCE_REPORT.md generated (0 new issues in final iterations)
- ✅ SCRAPING_COVERAGE_REPORT.md complete
- ✅ SESSION_HANDOFF.md created (if session ended mid-testing)

**Git Commits**:
- ✅ Phase 1 results committed
- ✅ Phase 2 results committed
- ✅ Phase 3 results committed
- ✅ Phase 4 results committed
- ✅ Phase 5 results committed (final commit)
- ✅ All commits pushed to test branch

**Quality Gates**:
- ✅ Zero blocking issues (P0/P1 bugs resolved)
- ✅ Self-improvement converged (0 new issues for 2+ iterations)
- ✅ All generated tests passing
- ✅ QA approval obtained

---

### Step 2: Review Merge Criteria

Refer back to the [Merge Criteria Checklist](#merge-criteria-checklist) section in the Git Workflow above and run all verification commands:

```bash
# Check for uncommitted changes
git status

# Review all commits on test branch
git log --oneline main..test/story-[number]

# Verify no merge conflicts with main
git fetch origin main
git merge origin/main --no-commit --no-ff
git merge --abort  # If no conflicts, abort and proceed

# Verify all tracking files present
ls -la TEST_PROGRESS.md TEST_ISSUES.json CONVERGENCE_REPORT.md SCRAPING_COVERAGE_REPORT.md

# Check test branch is ahead of main
git rev-list --count main..test/story-[number]
```

---

### Step 3: Obtain Final Approval

**Required Approvals**:
1. ✅ QA Sign-off (you, as the tester)
2. ✅ Code Review (if required by your team)
3. ✅ Lead Developer Approval (if required)
4. ✅ Product Owner Sign-off (if required)

**Approval Checklist**:
- [ ] All test phases passed
- [ ] No critical bugs remain
- [ ] Performance targets met (API <500ms, Pages <3s)
- [ ] Security validated (no SQL injection, XSS, etc.)
- [ ] Mobile responsive verified
- [ ] Documentation complete

---

### Step 4: Merge to Main

Once all approvals are obtained, proceed with the merge. Follow the detailed instructions in the [Final Merge to Main](#final-merge-to-main) section of the Git Workflow.

**Quick Reference**:
```bash
# Ensure test branch is up to date
git checkout test/story-[number]
git pull origin test/story-[number]

# Merge main into test branch first (resolve conflicts if needed)
git fetch origin main
git merge origin/main
# If conflicts exist, resolve them, commit, and push

# Switch to main and merge
git checkout main
git pull origin main

# Merge with --no-ff to preserve history
git merge test/story-[number] --no-ff -m "test: Merge story-[number] - [Feature description]

All 5 testing phases completed successfully:
- Phase 1: Data scraping & validation ([X] IPOs, [Y]% coverage)
- Phase 2: Core pages testing (zero errors)
- Phase 3: Tools & features validation
- Phase 4: Category pages verification
- Phase 5: Integration & performance testing

QA Approved by: [Your Name]
Test branch: test/story-[number]
Issues resolved: [count] (see TEST_ISSUES.json)
Convergence achieved: 0 new issues in final 2 iterations

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# Push to production
git push origin main
```

---

### Step 5: Post-Merge Cleanup

After successful merge, clean up branches to keep the repository tidy. Follow the instructions in the [Post-Merge Cleanup](#post-merge-cleanup) section of the Git Workflow.

**Quick Reference**:
```bash
# Delete local branches
git branch -d test/story-[number]
git branch -d feature/story-[number]  # If it exists

# Delete remote branches
git push origin --delete test/story-[number]
git push origin --delete feature/story-[number]  # If it exists

# Verify cleanup
git branch -a  # Should NOT show deleted branches
```

---

### Step 6: Production Verification

After merging to main, verify the deployment:

1. **Monitor Deployment**:
   - Check CI/CD pipeline status
   - Verify build succeeded
   - Confirm deployment to production environment

2. **Smoke Tests**:
   - Visit production site
   - Test core functionality:
     - Homepage loads
     - Dashboard displays IPOs
     - IPO detail page works
     - Search functionality operational
   - Check for console errors (should be zero)

3. **Monitor Metrics**:
   - Check error tracking (Sentry, if configured)
   - Monitor API response times
   - Verify database queries performing well
   - Watch for any unusual traffic patterns

4. **Rollback Plan** (if issues arise):
   ```bash
   # If critical issues found, revert the merge
   git revert -m 1 <merge-commit-hash>
   git push origin main
   ```

---

### Step 7: Post-Production Activities

1. **Update Documentation**:
   - Mark testing as complete in project tracker
   - Archive test results for future reference
   - Update team knowledge base if needed

2. **Team Communication**:
   - Notify team of successful deployment
   - Share TEST_PROGRESS.md and CONVERGENCE_REPORT.md
   - Highlight any important findings or patterns discovered

3. **Continuous Improvement**:
   - Review testing process for improvements
   - Document lessons learned
   - Update testing plan template if needed

---

## 🎉 SUCCESS METRICS

After completing this testing plan, you will have achieved:

✅ **Comprehensive Coverage**:
- 5 test phases executed
- 45+ initial test cases
- 40+ auto-generated tests (typical)
- 85+ total test coverage

✅ **High Quality**:
- 0 blocking issues in production
- <500ms API response times
- <3s page load times
- <100ms database queries
- Zero security vulnerabilities

✅ **Complete Documentation**:
- TEST_PROGRESS.md with full testing history
- TEST_ISSUES.json with all issues and resolutions
- CONVERGENCE_REPORT.md showing testing evolution
- SCRAPING_COVERAGE_REPORT.md with data quality metrics

✅ **Production Ready**:
- Self-improving test suite
- Pattern-based prevention measures
- Clear audit trail via git commits
- Reproducible testing process

---

## 📚 Reference Quick Links

**Git Workflow Sections**:
- [Prerequisites: Create Test Branch](#prerequisites-create-test-branch)
- [During Testing: Commit Checkpoints](#during-testing-commit-checkpoints)
- [Merge Criteria Checklist](#merge-criteria-checklist)
- [Final Merge to Main](#final-merge-to-main)
- [Post-Merge Cleanup](#post-merge-cleanup)

**Testing Phases**:
- [Phase 1: Data Scraping & Validation](#phase-1-data-scraping--validation-critical)
- [Phase 2: Core Pages Testing](#phase-2-core-pages-testing-headed-mode)
- [Phase 3: Tools & Features Testing](#phase-3-tools--features-testing-headed-mode)
- [Phase 4: Category Pages Testing](#phase-4-category-pages-testing-headed-mode)
- [Phase 5: Integration & Performance Testing](#phase-5-integration--performance-testing)

**Commit Checkpoints**:
- [Phase 1 Git Checkpoint](#-git-checkpoint-commit-phase-1-results)
- [Phase 2 Git Checkpoint](#-git-checkpoint-commit-phase-2-results-1)
- [Phase 3 Git Checkpoint](#-git-checkpoint-commit-phase-3-results)
- [Phase 4 Git Checkpoint](#-git-checkpoint-commit-phase-4-results)
- [Phase 5 Git Checkpoint](#-git-checkpoint-commit-phase-5-results)

---

## ✨ Final Words

This testing plan represents a **self-improving, comprehensive approach** to quality assurance. By following this methodology, you've not only validated the current implementation but also built a robust testing framework that will continue to evolve and improve with each testing cycle.

**Key Takeaways**:
1. Every issue discovered generated 3-5 related tests
2. Pattern detection prevented similar issues
3. Continuous iteration achieved convergence (0 new issues)
4. Complete git history provides full audit trail
5. Production deployment is backed by thorough validation

**Thank you for your thorough testing!** 🚀

The application is now production-ready with confidence.
