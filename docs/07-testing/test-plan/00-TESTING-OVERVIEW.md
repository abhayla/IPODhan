# Testing Overview & Setup

**Document Type:** Manual Quality Assurance Testing Plan
**Purpose:** Guide manual exploratory testing and data validation
**Relationship:** Complements 100+ automated tests (unit, integration, E2E)

---

## Table of Contents

1. [Document Purpose](#document-purpose)
2. [Production Database Safety Protocol](#production-database-safety-protocol)
3. [Database Connection Setup](#database-connection-setup)
4. [Git Workflow](#git-workflow)
5. [Auto-Improvement Mechanism](#auto-improvement-mechanism)
6. [Testing Loop Pattern](#testing-loop-pattern)
7. [Common Commands](#common-commands)

---

## Document Purpose

### What This Plan Covers

**Manual Testing Focus:**
- ✅ Data quality validation from scrapers (Phase 1)
- ✅ Exploratory testing beyond automation (Phases 2-4)
- ✅ Integration scenarios validation (Phase 5)
- ✅ Visual regression and UI polish
- ✅ Production data integrity verification

**Relationship to Automated Tests:**
- IPODhan has 100+ automated tests in `tests/` directory:
  - **Unit tests (Vitest)**: 50+ files - Components, utilities, repository logic
  - **Integration tests (Vitest)**: 20+ files - API routes, database operations
  - **E2E tests (Playwright)**: 40+ files - Automated browser testing

**This manual testing plan:**
- Complements (does NOT replace) automated tests
- Focuses on areas automation cannot easily cover
- Validates production data quality and UX/UI polish

**Automated Testing Documentation:** See `docs/02-architecture/testing-strategy.md`

---

## Production Database Safety Protocol

### 🔴 CRITICAL: Testing Against LIVE PRODUCTION DATA

**VPS Database:** `103.118.16.189:5432/ipodhan` contains real production data.

**Testing Approach:** Testing will be performed directly on the existing production database **without creating backups**. All data modifications require **explicit approval** before execution.

---

### Testing Safety Rules by Phase

| Phase | Operations Allowed | Operations REQUIRE APPROVAL |
|-------|-------------------|----------------------------|
| **Phase 1** | ✅ SELECT queries (read-only) | 🔒 Any INSERT/UPDATE/DELETE |
| **Phase 2** | ✅ Page loads, SELECT queries | 🔒 Any data modifications |
| **Phase 3** | ✅ Tools (calculations), SELECT | 🔒 Any database writes |
| **Phase 4** | ✅ Category pages, SELECT | 🔒 Any mutations |
| **Phase 5** | ✅ GET APIs, SELECT queries | 🔒 Any writes (including tracking) |

---

### Data Update Approval Process

**🔒 For ANY data modification operation:**

1. **STOP and ask for approval** before executing
2. **Show the exact operation** (SQL query or code)
3. **Explain the impact** (which tables, how many rows affected)
4. **Wait for explicit "APPROVED" response**
5. **Only then proceed** with the operation

**Examples requiring approval:**
```sql
-- ❌ Do NOT run without approval:
INSERT INTO ...
UPDATE ... SET ...
DELETE FROM ... WHERE ...
TRUNCATE ...
DROP ...
ALTER TABLE ...
```

**Approval Request Format:**
```
🔒 DATA UPDATE APPROVAL REQUEST

Operation: INSERT INTO affiliate_clicks (...)
Impact: 1 row insertion in affiliate_clicks table
Reason: Testing affiliate tracking functionality
Rollback: Can delete by id after test

SQL:
INSERT INTO affiliate_clicks (ipo_id, broker_id, clicked_at)
VALUES ('test-ipo-id', 'zerodha', NOW());

Awaiting approval to proceed...
```

---

### Strictly FORBIDDEN (Even with Approval)

```sql
-- ❌ ABSOLUTELY NEVER run these commands:
TRUNCATE any_table;                    -- Deletes all data
DROP TABLE any_table;                  -- Destroys table
DELETE FROM any_table;                 -- Without WHERE = deletes all
UPDATE any_table SET ...;              -- Without WHERE = updates all
ALTER TABLE any_table ...;             -- Schema changes on production
```

---

### Best Practices for Production Testing

1. **Off-Peak Hours**: Test when users are least active (late night/early morning)
2. **Monitor Impact**: Watch for slow production queries during testing
3. **Connection Limits**: Use max 2-3 database connections
4. **Read-Only Focus**: 95% of testing should be SELECT queries
5. **Approval First**: Always request approval before any write operation
6. **Transaction Rollback**: If mutation approved, always use transactions:
   ```sql
   BEGIN;
   -- Your approved mutation
   -- Verify result
   ROLLBACK;  -- Test with rollback first, then commit only if explicitly approved
   ```
7. **Manual Rollback**: If data issues occur, manually reverse changes using DELETE/UPDATE with specific WHERE clauses

---

### Proceed Only If

- ✅ You understand the risks of testing on production
- ✅ You will request approval for ANY data modifications
- ✅ You will use transactions for all approved write operations
- ✅ You can manually rollback changes if needed

---

## Database Connection Setup

### Step 1: Verify Environment Variables

**Check `web/.env.local` has VPS database credentials:**

```bash
# VPS PostgreSQL Database (PRODUCTION DATA)
DATABASE_URL=postgresql://postgres:***REMOVED-CREDENTIAL***@103.118.16.189:5432/ipodhan

# Individual fields (for scripts that parse separately)
DATABASE_HOST=103.118.16.189
DATABASE_PORT=5432
DATABASE_NAME=ipodhan
DATABASE_USER=postgres
DATABASE_PASSWORD=***REMOVED-CREDENTIAL***  # Note: @ symbol NOT URL-encoded here
```

**⚠️ CRITICAL:**
- `DATABASE_URL` must have URL-encoded password (`%40` for `@`)
- `DATABASE_PASSWORD` field must have raw password (with `@` not encoded)
- These must point to VPS server at `103.118.16.189`

---

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

---

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

---

### Step 4: Only After Connection Verified

✅ Once you see successful connection and data counts → Proceed to testing phases
❌ If connection fails → STOP and fix database connection first

---

## Git Workflow

### Overview

Testing will be performed on the **current branch** (typically `main`). No separate test or feature branches will be created.

### Testing Workflow

```
Current Branch (e.g., main)
  → Run all 5 testing phases
  → Document findings in TEST_PROGRESS.md, TEST_ISSUES.json
  → Fix issues as they arise
  → Commit after each phase completion
```

---

### Testing on Current Branch

**Approach**: All testing will be performed on your current working branch (typically `main`).

**Verify Current Branch:**
```bash
# Check what branch you're currently on
git branch
# Example output: * main

# Ensure branch is up to date
git pull origin main

# Check status
git status
```

**Notes:**
- ✅ Testing happens directly on your current branch (no test branch creation)
- ✅ Commit testing documentation and fixes as you go
- ✅ All changes stay on the current branch

---

### During Testing: Commit Checkpoints

**Concept**: Commit your testing progress regularly to maintain a clear audit trail and enable rollback if needed.

**What to Commit:**
```
✅ Test results (JSON files, reports, screenshots)
✅ Bug fixes (code changes to fix issues found during testing)
✅ Documentation updates (TEST_PROGRESS.md, TEST_ISSUES.json)
✅ Test script modifications (new tests generated by auto-improvement)
✅ Configuration changes (database fixes, environment updates)
✅ Schema updates (if needed during testing)
✅ All tracking files (SCRAPING_COVERAGE_REPORT.md, etc.)
```

**Commit Frequency:**
```
After Phase 1 completes → Commit
After Phase 2 completes → Commit
After Phase 3 completes → Commit
After Phase 4 completes → Commit
After Phase 5 completes → Commit
After fixing critical bugs → Commit
After test script improvements → Commit
```

**Commit Message Format:**
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

**Commands for Each Phase:**
```bash
# After completing a testing phase:
git add .
git commit -m "test(phase-[N]): [Summary of what was tested and fixed]"
git push origin main
```

**Example Workflow:**
```bash
# Phase 1 completed
git add TEST_PROGRESS.md TEST_ISSUES.json SCRAPING_COVERAGE_REPORT.md
git commit -m "test(phase-1): Complete data validation - 150 IPOs, 95% field coverage"
git push origin main

# Bug fixes during Phase 2
git add lib/scrapers/sources/gmp-api-scraper.ts scripts/test-gmp-scraper.ts
git commit -m "test(phase-2): Fix GMP scraper - handle empty date strings"
git push origin main
```

---

### Testing Completion Criteria

**Required Criteria** (ALL must be ✅):
```
✅ All 5 test phases completed
✅ Zero blocking issues (P0/P1 bugs resolved)
✅ Self-improvement cycle converged (0 new issues for 2+ iterations)
✅ All test results documented and committed
✅ TEST_PROGRESS.md updated with final status
✅ TEST_ISSUES.json shows all issues resolved
✅ SCRAPING_COVERAGE_REPORT.md complete
✅ CONVERGENCE_REPORT.md generated
✅ All changes committed and pushed to current branch
```

**Verification Commands:**
```bash
# Check for uncommitted changes
git status

# Review recent commits
git log --oneline -10

# Verify all tracking files present
ls -la TEST_PROGRESS.md TEST_ISSUES.json SCRAPING_COVERAGE_REPORT.md CONVERGENCE_REPORT.md
```

---

## Auto-Improvement Mechanism

### Core Principle

**Test → Find Issue → Add Related Tests → Fix → Verify → Update Plan**

---

### Feedback Loop System

**When ANY issue is found during testing:**

#### 1. Issue Classification (Automatic)

Classify issue into:
- Data Quality Issue
- Scraper Failure
- Frontend Bug
- API Error
- Performance Problem
- Edge Case Discovery
- Missing Validation

#### 2. Root Cause Analysis (Mandatory)

For each issue, ask:
- What caused this?
- What similar issues might exist?
- What tests would have caught this earlier?
- What related functionality should be tested?

#### 3. Auto-Generate Related Tests (Dynamic)

Based on issue type, automatically add new tests:

**Example:**
```
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

#### 4. Pattern Detection (Learning)

Track issue patterns:
- If 3+ similar issues found → Add comprehensive test suite for that area
- If same scraper fails 2+ times → Add pre-flight validation
- If multiple null data issues → Add schema validation layer
- If performance issues on multiple pages → Add performance budget

#### 5. Update TEST_PROGRESS.md (After each discovery)

```markdown
## Issues Found & Tests Added

### Issue #ISS-001: GMP data missing for 5 OPEN IPOs
**Root Cause**: GMP scraper failed silently
**Tests Added**:
- ✅ Check all OPEN IPOs for GMP data
- ✅ Verify GMP scraper ran in last 24h
- ✅ Check GMP API endpoint availability
**Status**: Fixed - all 5 IPOs now have GMP data
```

---

## Testing Loop Pattern

### Standard Pattern for All Phases

```
ITERATION 1: Test ALL → Document Issues
  ↓
ITERATION 2: Fix ALL Issues → Auto-Generate Related Tests
  ↓
ITERATION 3: Re-test ALL (original + new tests)
  ↓
ITERATION 4: Final Verification → Gate Check
  ↓
IF GATE CHECK PASSES → Proceed to Next Phase
IF GATE CHECK FAILS → Return to ITERATION 2
```

---

### Loop Pattern Explanation

**ITERATION 1: Discovery**
- Execute all planned tests
- Document every issue found
- Don't fix anything yet (just document)
- Goal: Complete inventory of issues

**ITERATION 2: Resolution**
- Fix all documented issues
- For each issue: Auto-generate related tests
- Run auto-generated tests
- Document new issues found
- Goal: Fix + expand test coverage

**ITERATION 3: Verification**
- Re-run all original tests (verify fixes)
- Run all auto-generated tests
- Ensure no regressions introduced
- Goal: Confirm all issues resolved

**ITERATION 4: Convergence Check**
- Execute final comprehensive test suite
- Verify success criteria met
- Check convergence (0 new issues)
- Goal: Ready for next phase

---

### Convergence Criteria

**Definition**: Testing phase has "converged" when:
1. All original tests pass
2. All auto-generated tests pass
3. No new issues found in last 2 iterations
4. All success criteria met

**Example:**
```
Iteration 1: Found 10 issues
Iteration 2: Fixed 10 issues, generated 15 new tests, found 3 new issues
Iteration 3: Fixed 3 issues, generated 5 new tests, found 0 new issues
Iteration 4: Re-ran all tests, found 0 new issues → CONVERGED ✅
```

---

## Common Commands

### Database Testing

```bash
# Connect to production database (READ-ONLY recommended)
psql -h 103.118.16.189 -U postgres -d ipodhan

# Run field coverage analysis
psql -h 103.118.16.189 -U postgres -d ipodhan -f scripts/field-coverage.sql

# Check scraper health
psql -h 103.118.16.189 -U postgres -d ipodhan -c "SELECT * FROM scraper_logs ORDER BY start_time DESC LIMIT 5;"

# Count records per table
psql -h 103.118.16.189 -U postgres -d ipodhan -c "\dt+" | tail -n +4 | awk '{print $1}' | while read table; do echo -n "$table: "; psql -h 103.118.16.189 -U postgres -d ipodhan -t -c "SELECT COUNT(*) FROM $table"; done
```

---

### Application Testing

```bash
# Start dev server
cd web
npm run dev

# Run automated tests
npm run test              # All tests
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests (requires PostgreSQL + Redis)
npm run test:e2e          # E2E tests (Playwright)
npm run test:coverage     # Generate coverage report

# Database operations
npm run db:studio         # Open Drizzle Studio
npm run db:generate       # Generate migration from schema changes
npm run db:migrate        # Apply migrations
npm run verify:seed       # Verify seed data integrity
```

---

### Cache Testing

```bash
# Monitor Redis
redis-cli MONITOR

# Check cache keys
redis-cli KEYS "ipo:*"

# Test Redis connection
redis-cli PING

# Check cache hit rate
redis-cli INFO stats | grep keyspace

# Clear cache for testing
redis-cli FLUSHDB  # ⚠️ Use with caution
```

---

### Playwright Testing (Headed Mode)

```bash
# Run E2E tests in headed mode (browser visible)
cd web
npx playwright test --headed --project=chromium

# Run specific test file
npx playwright test tests/e2e/dashboard.spec.ts --headed

# Run with slowMo for debugging
npx playwright test --headed --slow-mo=300

# Open Playwright UI
npx playwright test --ui
```

---

## Implementation Status Notes

**Recent Updates** (as of 2025-10-13):

- ✅ **GMP API Scraper**: Fully implemented and tested (ISS-001, ISS-010)
  - Location: `lib/scrapers/sources/gmp-api-scraper.ts`
  - Test Results: 98.5% success rate (64/65 IPOs)
  - Status: Production-ready, pending database integration

- ⚠️ **Reviews**: No centralized API found - expect per-IPO only
  - Investigation: Completed via Playwright network monitoring
  - Finding: Reviews are embedded in individual IPO pages
  - Impact: Adjust test expectations for review coverage (<50% IPOs may have reviews)

- ℹ️ **BSE Prospectus API**: Discovered but deprioritized
  - APIs Found: `api.bseindia.com` with 3 IPO endpoints
  - Decision: Focus on higher-value data sources first

**❓ Feature Status - Verify Before Testing:**
- Allotment Checker functionality
- Lot Calculator implementation
- IPO Compare tool
- Rating calculation system
- Reviews display (per-IPO only, not centralized list)

---

## Next Steps

**After reading this overview:**

1. ✅ Verify database connection (Step 2 above)
2. ✅ Understand approval process for data modifications
3. ✅ Familiarize yourself with git workflow
4. → **Begin Phase 1**: [01-PHASE-1-DATA-QUALITY.md](01-PHASE-1-DATA-QUALITY.md)

---

**Questions?** Refer to:
- [README.md](README.md) - Master index
- [APPENDIX-C-ARCHITECTURE-REFS.md](APPENDIX-C-ARCHITECTURE-REFS.md) - Architecture docs
- Architecture docs in `docs/02-architecture/`
