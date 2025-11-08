# PROMPT: Implement Data Flow Architecture Testing Plan - Complete Execution
## Multi-Session Testing Workflow with Progress Tracking

**LAST UPDATED**: 2025-11-08 19:50:00 (Session findings incorporated)

---

## 🔄 SESSION STARTUP PROTOCOL

**IMPORTANT**: This prompt is designed for **multi-session execution**. Before starting any testing, you MUST check the current status and resume from where the previous session left off.

### Step 0: Status Check & Resume (ALWAYS DO THIS FIRST)

**NEW**: Check for session documentation files first:
```bash
# Quick resume (30-second orientation)
cat test-results/data-flow-architecture/QUICK_RESUME.md

# Comprehensive status (detailed overview)
cat test-results/data-flow-architecture/SESSION_STATUS.md

# Architectural findings (technical discoveries)
cat test-results/data-flow-architecture/ARCHITECTURAL_FINDINGS.md
```

If these files exist, they contain the most up-to-date session state. If not, perform this status check:

1. **Check for existing test files**:
   ```bash
   ls -la web/tests/integration/data-flow/
   ```
   - If directory exists → Tests have been started
   - If directory is empty → Starting fresh

2. **Check for test results**:
   ```bash
   ls -la test-results/data-flow-architecture/
   ```
   - Look for dated subdirectories (YYYY-MM-DD format)
   - Latest directory = last test session

3. **Read test execution logs**:
   ```bash
   # Check if there's a progress log
   cat test-results/data-flow-architecture/progress.log 2>/dev/null || echo "No progress log found"
   ```

4. **Check git status**:
   ```bash
   git status
   git log --oneline -5
   ```
   - Look for commits like "test(data-flow): Category X tests"
   - Check for uncommitted test files

5. **Review TodoWrite list** (if exists):
   - Check how many tasks are completed
   - Identify current in_progress task
   - Determine next pending task

6. **Query test database** (optional but recommended):
   ```bash
   cd web
   npm run test:integration 2>&1 | head -20
   ```
   - Check if tests can run
   - Look for any existing test data

### Step 0.5: Determine Starting Point

Based on status check, determine where to start:

**Scenario A: Fresh Start (No Tests Exist)**
- Create TodoWrite task list (all 9 categories)
- Start with Category 1, Test 1.1
- Create `test-results/data-flow-architecture/[today]/` directory
- Create `progress.log` file

**Scenario B: Tests In Progress**
- Load existing TodoWrite list
- Find last completed test
- Resume with next pending test
- Continue logging to existing `progress.log`

**Scenario C: Tests Complete, Fixes Needed**
- Review failed tests from last session
- Identify which fix category (A-E) applies
- Implement fixes from Remediation Plan
- Re-run failed tests

**Scenario D: All Tests Passing**
- Verify all 9 categories complete
- Run final validation suite
- Prepare production rollout documentation
- Mark testing phase as COMPLETE

### Step 0.6: Session Initialization

After determining starting point:

1. **Create/Update TodoWrite**:
   - Load existing list OR create new
   - Mark current task as `in_progress`
   - Update activeForm to show current action

2. **Create session log entry**:
   ```bash
   echo "[$(date)] Session started - Resuming from: [Task Name]" >> test-results/data-flow-architecture/progress.log
   ```

3. **Announce starting point**:
   ```
   📋 Testing Status Check Complete

   ✅ Tests Completed: X/27
   🔄 Current Category: Category N
   🎯 Next Test: Test N.N - [Name]
   📊 Overall Progress: XX%

   Starting test execution...
   ```

---

## 🎯 MISSION

Implement the **complete Data Flow Architecture Testing Plan** for the IPODhan project. Execute all test categories (1-9), identify issues, apply fixes from the remediation plan, and achieve 100% test pass rate. This is a critical production readiness task - do not stop until all tests pass and the system is validated for production deployment.

**Multi-Session Nature**: This testing effort spans multiple work sessions. Each session should:
- Check current status
- Resume from last completed test
- Update progress tracking
- Save session results
- Prepare for next session

---

## 📚 PROJECT CONTEXT

**Project**: IPODhan - Comprehensive IPO information platform for Indian investors
- **Tech Stack**: Next.js 15.5, React 19, TypeScript 5, PostgreSQL 16, Redis 7.2+, Drizzle ORM
- **Current Phase**: Data Flow Architecture Fix - Phase 0-5 implementation complete
- **Testing Status**: Check status first (see Step 0 above)

**What Has Been Completed**:
- ✅ Data Consolidation Service (100% rollout - Phase 4)
- ✅ Field Priority Matrix (field-specific source rankings)
- ✅ Normalization Engine (currency, date, name parsing)
- ✅ Database tables: `field_sources`, `data_conflicts`, `field_protection`
- ✅ Feature flags for gradual rollout
- ✅ Testing plan documented (20+ test scenarios)
- ✅ Issue remediation plan documented (5 fix categories)

**What Needs Testing** (check status to see what's done):
- ❓ Real data baseline (495 existing IPOs)
- ❓ Edge cases (lot_size=1, fuzzy matching, null segments, price conflicts)
- ❓ Race conditions (concurrent scraper updates)
- ❓ Field priority matrix validation (DRHP > NSE, Chittorgarh for GMP, BSE for lot_size)
- ❓ Admin protection (scraper overwrites blocked)
- ❓ Normalization (currency formats, company names)
- ❓ Shadow mode (zero DB writes)
- ❓ Performance (1000 concurrent updates, p95 < 500ms)
- ❓ End-to-end integration (NSE → BSE → Database)

---

## 📖 REQUIRED READING - STUDY THESE DOCUMENTS FIRST

### Primary Documents (MUST READ):
1. **Testing Plan**: `d:\Abhay\VibeCoding\IPODhan\docs\08-scraping\Plan-Data-Flow-Architecture-Fix Implementation-testing.md`
   - 9 test categories with 20+ scenarios
   - All using REAL production data (no dummy data)
   - Success criteria and execution timeline

2. **Issue Remediation Plan**: `d:\Abhay\VibeCoding\IPODhan\docs\08-scraping\Plan-Data-Flow-Architecture-Fix Implementation-issue-remediation.md`
   - 5 fix categories (A-E: Normalization, Priority, Conflict, Deduplication, Admin UI)
   - Step-by-step fix procedures with code examples
   - Emergency protocols for P0/P1/P2 failures

3. **Implementation Plan**: `d:\Abhay\VibeCoding\IPODhan\docs\08-scraping\Plan-Data-Flow-Architecture-Fix Implementation.md`
   - Overall architecture and data flow
   - 184-hour implementation plan (already completed)
   - Component specifications

### Architecture References:
4. **Backend Architecture**: `docs/02-architecture/backend-architecture.md`
   - 3-layer architecture (API → Service → Repository)
   - BaseRepository pattern with cache-aside

5. **Caching Strategy**: `docs/05-caching/CACHING_STRATEGY.md`
   - Cache key conventions, TTL strategy
   - Invalidation patterns

6. **Database Schema**: `packages/shared/src/db/schema.ts`
   - 22 tables including Phase 0 tracking tables
   - field_sources, data_conflicts, field_protection

7. **CLAUDE.md**: Project guidelines and development workflow

---

## ⚠️ KNOWN ISSUES & WORKAROUNDS (Critical - Read Before Coding)

### Issue #1: Manual Field Protection Creation (Category 5.1)

**Problem**: Admin-edited fields do NOT automatically create field protection records.

**Root Cause**: `DataConsolidationService` has no integration with `FieldProtectionRepository`

**Impact**: Tests expecting automatic protection will fail

**Workaround Pattern**:
```typescript
// After admin edit, manually create protection
await consolidationService.consolidateIPOData({
  source: 'ADMIN',
  incomingData: { fieldName: value },
  // ...
});

// ⚠️ Required: Manually create field protection
await fieldProtectionRepo.upsert({
  ipoId: testIPO[0].id,
  tableName: 'ipos',
  fieldName: 'fieldName',
  isProtected: true,
  autoProtected: false,
  manuallyEditedBy: 'admin-test',
  editNote: 'Test admin edit',
});
```

**Future Enhancement**: Auto-create protection when `source === 'ADMIN'` (see ARCHITECTURAL_FINDINGS.md)

### Issue #2: DataConsolidationService Dependency Injection

**Problem**: Service requires repositories as constructor parameters

**Correct Initialization**:
```typescript
import { DataConsolidationService } from '../../../../scraper/src/services/data-consolidation-service';
import { FieldSourcesRepository } from '@/lib/repositories/field-sources-repository';
import { DataConflictsRepository } from '@/lib/repositories/data-conflicts-repository';
import { FieldProtectionRepository } from '@/lib/repositories/field-protection-repository';
import { getRedisClient } from '@/lib/cache/redis-client';

// In beforeAll()
const redis = getRedisClient();
const fieldSourcesRepo = new FieldSourcesRepository(db, redis);
const dataConflictsRepo = new DataConflictsRepository(db, redis);
const fieldProtectionRepo = new FieldProtectionRepository(db, redis); // For admin tests
consolidationService = new DataConsolidationService(fieldSourcesRepo, dataConflictsRepo);
```

**Wrong** (will throw "Cannot read properties of undefined"):
```typescript
consolidationService = new DataConsolidationService(); // ❌ No parameters
```

### Issue #3: LEGACY Schema Enum Value (RESOLVED)

**Problem**: Test documentation referenced `LEGACY` as valid scraper_source enum value

**Resolution**:
- Updated test comments to use `API_FALLBACK` (actual enum value)
- Database verified clean (no LEGACY records exist)
- Valid enum values: ADMIN, DRHP, NSE, BSE, API_FALLBACK, MONEYCONTROL, CHITTORGARH

**If you see this error**: `invalid input value for enum scraper_source: "LEGACY"`
- Check for hardcoded 'LEGACY' strings in test code
- Use 'API_FALLBACK' instead for historical/unknown sources

---

## 🚀 EXECUTION INSTRUCTIONS

### Phase 1: Environment Setup & Preparation (First Session Only)

**Skip this if resuming from previous session**

1. **Read all primary documents** (Testing Plan, Remediation Plan, Implementation Plan)
2. **Verify environment setup**:
   ```bash
   # Check database connection
   cd web
   npm run db:studio  # Should open Drizzle Studio on port 4983

   # Check Redis connection
   redis-cli ping  # Should return PONG

   # Check test database exists
   psql -d ipodhan_test -c "SELECT 1"
   ```

3. **Review current implementation status**:
   - Read `scraper/src/services/data-consolidation-service.ts`
   - Read `scraper/src/config/field-priority-matrix.ts`
   - Read `scraper/src/services/normalization-engine.ts`
   - Read `scraper/src/services/data-persister.ts`

4. **Create test execution tracking**:
   ```bash
   # Create results directory
   mkdir -p test-results/data-flow-architecture/$(date +%Y-%m-%d)

   # Create progress log
   touch test-results/data-flow-architecture/progress.log
   echo "[$(date)] Testing started - Fresh execution" >> test-results/data-flow-architecture/progress.log
   ```

5. **Create initial TodoWrite task list**:
   - Use TodoWrite tool to create comprehensive task list
   - 9 categories × 2-3 tests each = ~27 tasks
   - Mark all as pending initially

---

### Phase 2: Test Implementation (Multi-Session Execution)

**Execute tests in this order** (from Testing Plan document):

#### Week 1: Foundation Tests
- **Day 1-2**: Category 1 - Real Data Baseline Tests
  - Test 1.1: Historical Data Migration Validation
  - Test 1.2: Real Scraper Output Integration
  - **File location**: `web/tests/integration/data-flow/historical-migration.test.ts`
  - **File location**: `web/tests/integration/data-flow/live-scraper-integration.test.ts`

- **Day 3**: Category 2 - Edge Cases from Production
  - Test 2.1: Lot Size = 1 Rejection
  - Test 2.2: Fuzzy Name Matching
  - Test 2.3: Null Segment Handling
  - Test 2.4: Price Band Conflicts
  - **File location**: `web/tests/integration/data-flow/lot-size-validation.test.ts` (etc.)

- **Day 4**: Category 6 - Normalization Tests
  - Test 6.1: Currency Format Variations
  - Test 6.2: Company Name Normalization
  - **File location**: `web/tests/integration/data-flow/currency-normalization.test.ts` (etc.)

- **Day 5**: Results Analysis
  - Review all test failures
  - Categorize by fix type (A-E from Remediation Plan)
  - Document findings

#### Week 2: Core Logic Tests
- **Day 6-7**: Category 4 - Field Priority Matrix Validation
  - Test 4.1: DRHP Wins for Financial Data
  - Test 4.2: Chittorgarh Wins for GMP
  - Test 4.3: BSE Wins for Lot Size
  - **File location**: `web/tests/integration/data-flow/drhp-financial-priority.test.ts` (etc.)

- **Day 8**: Category 5 - Admin Protection Tests
  - Test 5.1: Admin Override Protection
  - **File location**: `web/tests/integration/data-flow/admin-protection.test.ts`

- **Day 9**: Category 7 - Shadow Mode Testing
  - Test 7.1: Shadow Mode Logging (No Database Writes)
  - **File location**: `web/tests/integration/data-flow/shadow-mode.test.ts`

- **Day 10**: Results Analysis & Fix Implementation

#### Week 3: Performance & Integration Tests
- **Day 11-12**: Category 3 - Race Condition Tests
  - Test 3.1: Simultaneous Scraper Updates
  - Test 3.2: Duplicate Prevention Under Load
  - **File location**: `web/tests/integration/data-flow/race-condition-updates.test.ts` (etc.)

- **Day 13**: Category 8 - Performance Tests
  - Test 8.1: 1000 Concurrent Updates
  - **File location**: `web/tests/integration/data-flow/performance-load.test.ts`

- **Day 14**: Category 9 - End-to-End Integration
  - Test 9.1: Complete Pipeline (Detection → Consolidation → UI)
  - **File location**: `web/tests/integration/data-flow/e2e-pipeline.test.ts`

- **Day 15**: Final Results & Documentation

---

### Phase 3: Issue Remediation (As Needed)

**When a test fails**:

1. **Identify the category** (A-E from Remediation Plan):
   - **Category A**: Normalization issue (currency, dates, names)
   - **Category B**: Priority matrix issue (wrong source winning)
   - **Category C**: Conflict resolution logic issue
   - **Category D**: Deduplication issue (duplicate IPOs)
   - **Category E**: Admin UI issue (missing dashboard)

2. **Apply the fix** from Remediation Plan:
   - Follow step-by-step procedure
   - Implement code changes
   - Write/update tests
   - Verify fix works

3. **Re-run the test**:
   - Ensure test now passes
   - Check for regressions
   - Update TodoWrite progress

4. **Document the fix**:
   ```bash
   echo "[$(date)] Fixed Test N.N - [Issue] - Applied Category X fix" >> test-results/data-flow-architecture/progress.log
   ```

5. **Commit the fix**:
   ```bash
   git add .
   git commit -m "fix(data-flow): Test N.N - [Brief description]"
   ```

---

### Phase 4: Validation & Deployment (Week 4)

- **Day 16-17**: Shadow Mode on Production (10% traffic)
- **Day 18-19**: Shadow Mode on Production (50% traffic)
- **Day 20**: Full Production Rollout Decision

---

## 🎯 DECISION-MAKING AUTHORITY

You are **empowered to make decisions** when:

### ✅ Make These Decisions Independently:

1. **File Organization**:
   - Test file naming conventions
   - Directory structure within `web/tests/integration/data-flow/`
   - Helper function locations

2. **Test Data Selection**:
   - Which specific IPOs to use from production (pick representative samples)
   - How many test cases per scenario (aim for 3-5 edge cases each)
   - Mock data structure (follow existing patterns)

3. **Implementation Details**:
   - Variable naming
   - Code formatting (use existing ESLint config)
   - Comment verbosity (prefer clear over terse)

4. **Fix Strategies**:
   - Choose between multiple valid approaches
   - Optimization techniques (follow performance targets)
   - Error handling patterns (use existing repository errors)

5. **Test Utilities**:
   - Helper functions for test setup/teardown
   - Fixture generation utilities
   - Mock data factories

6. **Session Management**:
   - When to end a session (save progress, commit code)
   - How many tests to complete in one session
   - When to take breaks for long-running tests

### Industry Standards to Follow:

1. **Testing Best Practices**:
   - AAA pattern (Arrange, Act, Assert)
   - One assertion per test (when possible)
   - Descriptive test names (`test('should reject lot_size=1 as invalid')`)
   - Use `beforeAll`, `afterAll` for setup/teardown
   - Clean up test data after each test

2. **TypeScript Best Practices**:
   - Strict type checking (no `any` unless necessary)
   - Explicit return types for functions
   - Use enums for constants
   - Leverage type inference where clear

3. **Database Testing**:
   - Use transactions for test isolation (when possible)
   - Clean up in reverse order of creation
   - Use realistic data volumes (100-1000 records)
   - Test both success and failure paths

4. **Performance Testing**:
   - Use percentiles (p50, p95, p99) not averages
   - Warm up before measuring
   - Run multiple iterations
   - Document baseline metrics

5. **Multi-Session Work**:
   - Commit after each completed test category
   - Update progress log before ending session
   - Save TodoWrite state
   - Document any blockers or open questions

### 🚫 Do NOT Decide Independently:

These require explicit confirmation (ask user):

1. **Production data deletion** (use test database only)
2. **Schema changes** (follow migration workflow)
3. **Breaking API changes**
4. **Major architecture deviations** from plans
5. **Skipping entire test categories** (must have documented reason)
6. **Changing test success criteria** (defined in Testing Plan)

---

## ✅ SUCCESS CRITERIA

### Must Achieve (P0):
- [ ] All Category 1 tests pass (Real Data Baseline)
- [ ] All Category 2 tests pass (Edge Cases)
- [ ] All Category 3 tests pass (Race Conditions)
- [ ] All Category 4 tests pass (Field Priority)
- [ ] All Category 5 tests pass (Admin Protection)
- [ ] All Category 6 tests pass (Normalization)
- [ ] All Category 7 tests pass (Shadow Mode)
- [ ] Category 8 performance targets met (p95 < 500ms)
- [ ] Category 9 E2E pipeline works end-to-end

### Data Quality Targets:
- [ ] Zero duplicate IPOs created under load
- [ ] Conflict rate < 2% on real production data
- [ ] Field priority matrix respected 100% of time
- [ ] Admin-protected fields never overwritten by scrapers
- [ ] lot_size=1 rejected 100% of time
- [ ] Fuzzy matching accuracy > 99%

### Performance Targets:
- [ ] p95 latency < 500ms for 1000 concurrent updates
- [ ] Average latency < 200ms
- [ ] Total test suite runtime < 5 minutes
- [ ] Zero connection pool exhaustion
- [ ] Redis failover works (app continues if Redis down)

### Code Quality:
- [ ] All tests have descriptive names
- [ ] Test coverage added for new code
- [ ] No ESLint errors
- [ ] No TypeScript errors
- [ ] All helper functions documented

---

## 🎨 WORKING STYLE

### Test-Driven Approach:
1. **Red**: Write failing test first
2. **Green**: Implement minimum code to pass
3. **Refactor**: Clean up and optimize
4. **Repeat**: Next test

### Incremental Progress:
- Implement 1 test category at a time
- Fix issues immediately when found
- Don't accumulate technical debt
- Update TodoWrite after each test

### Multi-Session Continuity:
- **End of Session**:
  ```bash
  # Update progress log
  echo "[$(date)] Session ended - Completed: [Test Names]" >> test-results/data-flow-architecture/progress.log

  # Commit progress
  git add .
  git commit -m "test(data-flow): Session progress - Category N tests"

  # Update TodoWrite
  # Mark completed tasks
  # Save for next session
  ```

- **Start of Next Session**:
  - Run Step 0 (Status Check)
  - Resume from last `in_progress` or next `pending` task
  - Continue seamlessly

### Communication:
- **After each test category**: Summarize results (X passed, Y failed)
- **When a test fails**: Explain what failed and which fix category applies
- **After applying a fix**: Confirm test now passes
- **Every 5 tests**: Provide overall progress update
- **End of session**: Summary of what was completed, what's next

### Quality Over Speed:
- Prefer correct over fast
- Write clear tests over clever tests
- Document non-obvious decisions
- Fix root causes, not symptoms

---

## 📊 PROGRESS TRACKING

### TodoWrite Structure:

**UPDATED**: Category 5.1 has 3 test cases in single file, split into subtasks for better tracking

```
Testing Plan Execution - Data Flow Architecture
├─ [Status] Category 1: Real Data Baseline Tests (X/2 complete)
│   ├─ [Status] Test 1.1: Historical Data Migration Validation
│   └─ [Status] Test 1.2: Real Scraper Output Integration
├─ [Status] Category 2: Edge Cases from Production (X/4 complete)
│   ├─ [Status] Test 2.1: Lot Size = 1 Rejection
│   ├─ [Status] Test 2.2: Fuzzy Name Matching
│   ├─ [Status] Test 2.3: Null Segment Handling
│   └─ [Status] Test 2.4: Price Band Conflicts
├─ [Status] Category 3: Race Condition Tests (X/2 complete)
│   ├─ [Status] Test 3.1: Simultaneous Scraper Updates
│   └─ [Status] Test 3.2: Duplicate Prevention Under Load
├─ [Status] Category 4: Field Priority Matrix (X/3 complete)
│   ├─ [Status] Test 4.1: DRHP Wins for Financial Data
│   ├─ [Status] Test 4.2: Chittorgarh Wins for GMP
│   └─ [Status] Test 4.3: BSE Wins for Lot Size
├─ [Status] Category 5: Admin Protection (X/3 complete) ⚠️ 3 test cases in 1 file
│   ├─ [Status] Test 5.1.1: Admin-protected field rejects scraper updates
│   ├─ [Status] Test 5.1.2: Admin can update own protected field
│   └─ [Status] Test 5.1.3: Multiple scrapers all blocked by admin protection
├─ [Status] Category 6: Normalization Tests (X/2 complete)
│   ├─ [Status] Test 6.1: Currency Format Variations
│   └─ [Status] Test 6.2: Company Name Normalization
├─ [Status] Category 7: Shadow Mode (X/1 complete)
│   └─ [Status] Test 7.1: Shadow Mode Logging
├─ [Status] Category 8: Performance Tests (X/1 complete)
│   └─ [Status] Test 8.1: 1000 Concurrent Updates
└─ [Status] Category 9: E2E Integration (X/1 complete)
    └─ [Status] Test 9.1: Complete Pipeline

Overall Progress: X/17 tests (XX%) - Note: Category 5.1 split into 3 subtasks
```

### Progress Log Format:

```bash
# test-results/data-flow-architecture/progress.log

[2025-11-08 10:00:00] Testing started - Fresh execution
[2025-11-08 10:30:00] Category 1, Test 1.1 - PASS - Historical migration validated
[2025-11-08 11:00:00] Category 1, Test 1.2 - FAIL - NSE API connection timeout
[2025-11-08 11:15:00] Fixed Test 1.2 - Added retry logic - Applied Category C fix
[2025-11-08 11:20:00] Category 1, Test 1.2 - PASS (after fix)
[2025-11-08 12:00:00] Session ended - Completed: Category 1 (2/2 tests)
[2025-11-08 14:00:00] Session started - Resuming from: Category 2, Test 2.1
...
```

---

## 🚦 GETTING STARTED - FIRST SESSION

### Immediate First Steps (First Session Only):

1. **Read Testing Plan document** (30 minutes):
   ```
   Read: d:\Abhay\VibeCoding\IPODhan\docs\08-scraping\Plan-Data-Flow-Architecture-Fix Implementation-testing.md
   ```

2. **Read Remediation Plan** (20 minutes):
   ```
   Read: d:\Abhay\VibeCoding\IPODhan\docs\08-scraping\Plan-Data-Flow-Architecture-Fix Implementation-issue-remediation.md
   ```

3. **Create TodoWrite task list** (10 minutes):
   - All 9 categories
   - All individual tests
   - Mark all as pending

4. **Verify test database setup** (5 minutes):
   ```bash
   cd web
   npm run test:integration  # Should connect to test DB
   ```

5. **Create results directory**:
   ```bash
   mkdir -p test-results/data-flow-architecture/$(date +%Y-%m-%d)
   touch test-results/data-flow-architecture/progress.log
   ```

6. **Start with Category 1, Test 1.1** (first real test):
   ```bash
   # Create test file
   mkdir -p web/tests/integration/data-flow
   touch web/tests/integration/data-flow/historical-migration.test.ts

   # Implement test following Testing Plan document
   # Run test
   npm run test:integration -- historical-migration.test.ts
   ```

7. **If test fails**: Consult Remediation Plan for fix strategy

8. **If test passes**: Mark as complete in TodoWrite, move to next test

---

## 🚦 GETTING STARTED - RESUMING SESSION

### Immediate First Steps (Resuming from Previous Session):

1. **Run Status Check** (Step 0 above - 5 minutes):
   ```bash
   # Check existing tests
   ls -la web/tests/integration/data-flow/

   # Check results
   ls -la test-results/data-flow-architecture/

   # Read progress log
   tail -20 test-results/data-flow-architecture/progress.log
   ```

2. **Load TodoWrite** (2 minutes):
   - Review existing task list
   - Find last completed task
   - Identify next pending task

3. **Announce resumption point**:
   ```
   📋 Resuming Data Flow Testing

   ✅ Completed: X/27 tests
   🔄 Last Test: Test N.N - [Name] - [PASS/FAIL]
   🎯 Next Test: Test M.M - [Name]
   📊 Progress: XX%

   Resuming testing...
   ```

4. **Continue from next pending test**:
   - If last test FAILED: Re-run after reviewing fix
   - If last test PASSED: Move to next test in sequence
   - Update TodoWrite as you go

5. **Log session start**:
   ```bash
   echo "[$(date)] Session started - Resuming from: Test M.M" >> test-results/data-flow-architecture/progress.log
   ```

---

## 🎯 YOUR MISSION STARTS NOW

**Goal**: Achieve 100% test pass rate across all 9 categories

**Resources**: All documentation provided above

**Authority**: Make implementation decisions following industry standards

**Constraint**: Use REAL production data only (no dummy data)

**Success**: All tests green, production ready for deployment

**Multi-Session**: Resume from where you left off, maintain continuity

---

## 🔄 SESSION WORKFLOW SUMMARY

### Every Session Start:
1. ✅ Run Step 0: Status Check
2. ✅ Load TodoWrite or create if first session
3. ✅ Announce starting point
4. ✅ Log session start
5. ✅ Resume testing

### During Session:
1. ✅ Implement tests following Testing Plan
2. ✅ Fix issues using Remediation Plan
3. ✅ Update TodoWrite after each test
4. ✅ Log progress to progress.log
5. ✅ Commit after each category

### Every Session End:
1. ✅ Update progress log with session summary
2. ✅ Commit all changes
3. ✅ Update TodoWrite (save state)
4. ✅ Document any blockers
5. ✅ Note next task for next session

---

## 📝 FINAL NOTES

- **This is production-critical work**: Every test must pass, every fix must be verified
- **Multi-session by design**: Testing will span multiple work sessions - that's expected
- **Progress is saved**: TodoWrite + progress.log + git commits ensure continuity
- **Quality over speed**: Prefer doing it right over doing it fast
- **Real data only**: No dummy data, no shortcuts
- **Document everything**: Future you (or others) will thank you

---

**Remember**: You are building the foundation for production deployment. Every test that passes brings us closer to a reliable, high-quality data pipeline.

**Let's begin!** 🚀

**First action**: Run Step 0 (Status Check) to determine where to start.

---

## 📝 SESSION LEARNINGS & BEST PRACTICES (Added 2025-11-08)

### Lesson #1: Always Check Session Documentation First

Before starting work, check for these files (in order of priority):
1. `test-results/data-flow-architecture/QUICK_RESUME.md` - 30-second orientation
2. `test-results/data-flow-architecture/SESSION_STATUS.md` - Comprehensive status
3. `test-results/data-flow-architecture/ARCHITECTURAL_FINDINGS.md` - Technical discoveries
4. `test-results/data-flow-architecture/progress.log` - Timestamped event log

These files are maintained across sessions and contain:
- Exact line numbers for pending work
- Code patterns to copy/paste
- Known issues and workarounds
- Time estimates for remaining work
- Session metrics and efficiency tracking

### Lesson #2: Create Session Documentation Proactively

At the end of EVERY session (or after completing a category), update:

**Progress Log**:
```bash
echo "[$(date)] Category X.X - STATUS - Description" >> test-results/data-flow-architecture/progress.log
```

**Session Status** (if major progress):
- Update `SESSION_STATUS.md` with current state
- Include specific line numbers for pending work
- Document any blockers or findings
- Update time estimates

**Architectural Findings** (if discoveries made):
- Document unexpected behaviors
- Provide root cause analysis
- Suggest workarounds and solutions
- Estimate effort for fixes

### Lesson #3: Test File Import Patterns

**DataConsolidationService** (lives in scraper package):
```typescript
import { DataConsolidationService } from '../../../../scraper/src/services/data-consolidation-service';
```

**Repository imports** (web package):
```typescript
import { FieldSourcesRepository } from '@/lib/repositories/field-sources-repository';
import { DataConflictsRepository } from '@/lib/repositories/data-conflicts-repository';
import { FieldProtectionRepository } from '@/lib/repositories/field-protection-repository';
```

**Always initialize with dependencies**:
```typescript
beforeAll(() => {
  const redis = getRedisClient();
  const fieldSourcesRepo = new FieldSourcesRepository(db, redis);
  const dataConflictsRepo = new DataConflictsRepository(db, redis);
  const fieldProtectionRepo = new FieldProtectionRepository(db, redis);
  consolidationService = new DataConsolidationService(fieldSourcesRepo, dataConflictsRepo);
});
```

### Lesson #4: Admin Protection Test Pattern

When testing admin protection (Category 5.1), ALWAYS:

1. Create test IPO
2. Admin edits field via consolidation service
3. **⚠️ Manually create field protection** (not automatic)
4. Verify protection exists
5. Attempt scraper overwrite
6. Verify blocked with conflict logged

**Copy this pattern**:
```typescript
// Step 1: Admin edit
await consolidationService.consolidateIPOData({
  ipoId: testIPO[0].id,
  tableName: 'ipos',
  incomingData: { fieldName: adminValue },
  source: 'ADMIN',
  existingData: testIPO[0],
  shadowMode: false,
});

// Step 2: Manually protect (required workaround)
await fieldProtectionRepo.upsert({
  ipoId: testIPO[0].id,
  tableName: 'ipos',
  fieldName: 'fieldName',
  isProtected: true,
  autoProtected: false,
  manuallyEditedBy: 'admin-test',
  editNote: 'Test admin edit',
});

// Step 3: Verify protection
const protection = await db.select()
  .from(fieldProtectionMetadata)
  .where(and(
    eq(fieldProtectionMetadata.ipoId, testIPO[0].id),
    eq(fieldProtectionMetadata.fieldName, 'fieldName')
  ));
expect(protection.length).toBeGreaterThan(0);

// Step 4: Scraper attempts overwrite
const scraperResult = await consolidationService.consolidateIPOData({
  ipoId: testIPO[0].id,
  tableName: 'ipos',
  incomingData: { fieldName: scraperValue },
  source: 'NSE',
  existingData: { ...testIPO[0], fieldName: adminValue },
  shadowMode: false,
});

// Step 5: Verify blocked
expect(scraperResult.conflicts.length).toBeGreaterThan(0);
expect(scraperResult.conflicts[0].reason).toBe('PROTECTED');
```

### Lesson #5: Time Estimates Per Category

Based on actual session data:

| Category | Estimated Time | Notes |
|----------|---------------|-------|
| 1.1-1.2 | 15 min each | Simple validation tests |
| 2.1-2.4 | 10-15 min each | Edge case tests, straightforward |
| 3.1-3.2 | 15-20 min each | Concurrency tests, need careful setup |
| 4.1-4.3 | 15-25 min each | Priority matrix tests, may need fixes |
| 5.1 | 30-45 min | **3 test cases**, manual protection pattern |
| 6.1-6.2 | 15 min each | Normalization tests, create new |
| 7.1 | 20 min | Shadow mode test, create new |
| 8.1 | 30 min | Performance test, load testing |
| 9.1 | 30 min | E2E test, full pipeline |

**Total**: 4-5 hours for fresh start, 2-3 hours if resuming mid-way

### Lesson #6: Common Failure Patterns & Fixes

**Pattern**: `Cannot read properties of undefined (reading 'findByIPOId')`
- **Cause**: Missing repository dependency injection
- **Fix**: Add repository initialization in `beforeAll()`

**Pattern**: `expected 0 to be greater than 0` (field protection tests)
- **Cause**: Field protection not created automatically
- **Fix**: Add manual `fieldProtectionRepo.upsert()` call

**Pattern**: `invalid input value for enum scraper_source: "LEGACY"`
- **Cause**: Using non-existent enum value
- **Fix**: Use 'API_FALLBACK' instead of 'LEGACY'

**Pattern**: Test passes locally but fails in CI
- **Cause**: Database state not cleaned between tests
- **Fix**: Ensure `afterAll()` cleanup deletes all test data

### Lesson #7: Efficiency Tips

**Parallel Test Creation**: If creating multiple test files, create test scaffolds first, then implement:
```bash
# Create all skeletons at once
touch web/tests/integration/data-flow/currency-normalization.integration.test.ts
touch web/tests/integration/data-flow/company-name-normalization.integration.test.ts
# ... etc

# Then implement one by one, testing as you go
```

**Copy-Paste from Passing Tests**: Use `drhp-financial-priority.integration.test.ts` as template:
- Has correct import patterns
- Has correct dependency injection
- Has proper cleanup
- Has good test structure

**Run Single Test During Development**:
```bash
npm run test:integration -- filename.test.ts
```

**Check Redis/DB State**:
```bash
# Check field sources
npx tsx scripts/check-field-sources.ts

# Open database GUI
npm run db:studio
```

---

## 🎯 UPDATED SUCCESS METRICS

### Test Count Correction
- **Original estimate**: 27 tests (incorrect)
- **Actual count**: 17 tests
  - Category 1: 2 tests
  - Category 2: 4 tests
  - Category 3: 2 tests
  - Category 4: 3 tests
  - Category 5: 1 test file (3 test cases - split in TodoWrite for tracking)
  - Category 6: 2 tests
  - Category 7: 1 test
  - Category 8: 1 test
  - Category 9: 1 test

### Updated Progress Calculation
```
Progress % = (Completed Tests / 17) × 100
Example: 11 completed = 64.7%
```

### Session-End Checklist

Before ending a session, ensure:
- [ ] TodoWrite updated with current status
- [ ] Progress log updated with timestamp
- [ ] SESSION_STATUS.md updated (if major milestone)
- [ ] QUICK_RESUME.md updated with next steps
- [ ] Any architectural findings documented in ARCHITECTURAL_FINDINGS.md
- [ ] All test files committed to git (if passing)
- [ ] Time estimate updated for remaining work

---

**Document Version**: 2.0
**Last Updated**: 2025-11-08 19:50:00
**Updated By**: Claude (Sonnet 4.5) based on Nov 8 session findings
**Changes**: Added Known Issues section, Session Learnings, updated TodoWrite structure, test count correction
