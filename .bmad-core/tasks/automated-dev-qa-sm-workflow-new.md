# Automated Story Implementation and QA Workflow

**Task ID:** automated-dev-qa-sm-workflow
**Version:** 3.0
**Agent:** QA (Quinn) & Dev (James)
**Elicit:** false

## Overview

Complete end-to-end workflow for story implementation and quality assurance with self-healing capabilities and **strict completion enforcement**. This task orchestrates:
1. Story implementation by spawning Dev agent
2. **Story completion validation** (NEW in v3.0)
3. Comprehensive QA testing
4. Automated fix loops when issues are found
5. **Acceptance criteria validation** (NEW in v3.0)
6. Final validation and commit

**Key v3.0 Changes:**
- ✅ Mandatory 100% task completion enforcement
- ✅ Programmatic acceptance criteria validation
- ✅ Test coverage requirements enforced
- ✅ Story splitting decision point added
- ✅ "Partial approval" eliminated from SM review

## Input Parameters

- `story_id`: Story identifier (e.g., "1.3", "2.1")
- `sprint_plan`: Path to sprint plan file (default: `docs/stories/SPRINT-{N}-PLAN.md`)

## Workflow Steps

### 1. Story Extraction

**Actions:**
- Parse story identifier from input parameters
- Read full story details from `docs/stories/SPRINT-N-PLAN.md`
- Extract all acceptance criteria and requirements
- Load story-specific files if they exist

**Output:**
- Story context loaded
- Acceptance criteria list created
- Requirements documented

---

### 2. Story Implementation

**Spawn Dev Agent for Implementation:**

Use the Task tool to spawn Dev agent with prompt:

```
Load and activate dev agent from .claude/commands/BMad/agents/dev.md

Then implement Story {story_id}:

{Full story details including all acceptance criteria}

Requirements:
- Create feature branch: feature/story-{story_id}
- Implement all acceptance criteria
- Write comprehensive tests (unit + E2E)
- Ensure code quality (lint, types, formatting)
- Update documentation as needed
- Create progress report in docs/stories/progress-reports/
- Do NOT commit yet - QA validation required first

Return detailed summary of:
- What was implemented
- Files created/modified
- Tests added
- Any blockers or decisions made
```

**Agent Configuration:**
- Use `general-purpose` subagent type
- Provide complete story context
- Include all acceptance criteria
- Specify branch naming convention
- Reference Dev agent file: `.claude/commands/BMad/agents/dev.md`

**Wait for Implementation:**
- Monitor Dev agent progress
- Review implementation approach
- Validate all requirements addressed

**Output:**
- Feature branch created
- Code implemented
- Tests written
- Progress report generated
- Ready for **MANDATORY** completion validation

---

### 2.5. Story Completion Validation (NEW in v3.0) ⚠️ MANDATORY GATE

**CRITICAL:** This step enforces 100% story completion. Workflow **CANNOT** proceed to testing without full completion.

**Validation Actions:**

1. **Parse Dev Agent Implementation Summary:**
   - Extract completion status for each task
   - Extract completion status for each acceptance criterion
   - Identify any "TODO", "pending", "not implemented", or "partial" markers
   - Count total vs completed items

2. **Calculate Completion Metrics:**
   ```
   Task Completion = (Completed Tasks / Total Tasks) × 100%
   AC Completion = (Fully Implemented AC / Total AC) × 100%
   Overall Completion = MIN(Task Completion, AC Completion)
   ```

3. **Strict Completion Checks:**

   **✅ PASS Criteria (Proceed to Step 3):**
   - Task Completion = 100%
   - AC Completion = 100%
   - Zero "TODO" or "pending" markers in code
   - Zero "partial implementation" indicators
   - Test files exist for ALL new code

   **❌ FAIL Criteria (Halt Workflow):**
   - Task Completion < 100%
   - AC Completion < 100%
   - Any "TODO", "pending", "not implemented" markers found
   - Missing test files
   - Dev agent explicitly states "partial implementation"

4. **On Validation Failure:**

   **HALT WORKFLOW IMMEDIATELY**

   Present user with completion report:
   ```markdown
   ⚠️ STORY IMPLEMENTATION INCOMPLETE

   **Story ID:** {story_id}
   **Overall Completion:** {percentage}%

   **Task Status:**
   - Total Tasks: {total}
   - Completed: {completed}
   - Pending: {pending}
   - Completion: {task_percentage}%

   **Acceptance Criteria Status:**
   - Total AC: {total}
   - Fully Implemented: {completed}
   - Partially Implemented: {partial}
   - Not Started: {not_started}
   - Completion: {ac_percentage}%

   **Issues Found:**
   - {List all incomplete items}
   - {List all TODO markers}
   - {List missing test files}

   **USER DECISION REQUIRED:**

   Choose one of the following options:

   1. CONTINUE IMPLEMENTATION
      - Return to Dev agent with incomplete items list
      - Dev agent will complete all pending work
      - Re-validate when Dev agent returns

   2. SPLIT STORY
      - Create Story {story_id}a: {completed items}
      - Create Story {story_id}b: {pending items}
      - Merge completed work as separate story
      - Schedule pending work for next sprint

   3. ACCEPT AS TECHNICAL DEBT (NOT RECOMMENDED)
      - Merge incomplete story with documented debt
      - Create tracking issue for pending work
      - ⚠️ Only use for low-priority nice-to-haves
      - ⚠️ Never use for core functionality

   Enter choice (1, 2, or 3):
   ```

   **Wait for user input before proceeding.**

5. **Handle User Decision:**

   **Choice 1 - Continue Implementation:**
   - Spawn Dev agent again with incomplete items list
   - Provide specific requirements for each pending item
   - Wait for completion
   - Re-run this validation step (Step 2.5)
   - Enforce iteration limit: Maximum 7 continuation cycles

   **Choice 2 - Split Story:**
   - Generate Story {story_id}a file with completed items
   - Generate Story {story_id}b file with pending items
   - Proceed to Step 3 with Story {story_id}a scope
   - User must manually schedule Story {story_id}b

   **Choice 3 - Accept Technical Debt:**
   - Create technical debt tracking issue
   - Document incomplete items in story file
   - Add "TECHNICAL DEBT" markers to code
   - Generate debt report: `docs/technical-debt/story-{story_id}-debt.md`
   - Proceed to Step 3 with reduced validation requirements

**Output:**
- ✅ Completion validation passed OR user decision executed
- Story scope confirmed (full, split, or with documented debt)
- Ready for initial verification

---

### 3. Initial Verification (UPDATED in v3.0)

**PREREQUISITE:** Step 2.5 completion validation must PASS

**Actions:**
- Verify feature branch exists: `feature/story-{story_id}`
- Confirm implementation commits present
- Review commit history for story-related changes
- **Check 100% task completion** (enforced by Step 2.5)
- **Check 100% AC implementation** (enforced by Step 2.5)
- Verify progress report created
- **Verify test files exist for ALL new code**

**Strict Validation:**
- ✓ On feature branch
- ✓ Implementation commits found
- ✓ **ALL tasks marked complete (100%)**
- ✓ **ALL acceptance criteria implemented (100%)**
- ✓ **Test files exist for all new functionality**
- ✓ Progress report exists
- ✓ **Zero TODO/pending markers** (or documented as tech debt)

---

### 4. Comprehensive Testing (UPDATED in v3.0)

**PREREQUISITE:** Step 3 initial verification must PASS

**Execute all quality checks with MANDATORY coverage requirements:**

#### 4.1 Linting (MANDATORY - Zero Tolerance)
```bash
# Navigate to project app directory (e.g., apps/web for monorepo)
npm run lint
```

**Pass Criteria:**
- ✅ Zero errors
- ✅ Zero warnings (or all warnings documented and approved)
- ❌ ANY lint error = workflow HALT

#### 4.2 Type Checking (MANDATORY - Zero Tolerance)
```bash
# Navigate to project app directory
npx tsc --noEmit
```

**Pass Criteria:**
- ✅ Zero TypeScript errors
- ✅ No implicit 'any' types in new code
- ❌ ANY type error = workflow HALT

#### 4.3 Unit Tests (MANDATORY with Coverage Enforcement)
```bash
# Navigate to project app directory
npm run test:unit -- --coverage
```

**Pass Criteria:**
- ✅ 100% of tests passing
- ✅ **NEW CODE coverage ≥ 80%** (lines, functions, branches)
- ✅ Zero skipped tests (no .skip or .only)
- ❌ ANY test failure = workflow HALT
- ❌ Coverage < 80% = workflow HALT

**Coverage Validation:**
```javascript
// Extract coverage metrics for new/modified files only
const newFilesCoverage = calculateCoverageForNewCode();

if (newFilesCoverage.lines < 80 ||
    newFilesCoverage.functions < 80 ||
    newFilesCoverage.branches < 75) {

  HALT_WORKFLOW({
    reason: "Insufficient test coverage",
    required: { lines: 80, functions: 80, branches: 75 },
    actual: newFilesCoverage,
    action: "Add tests for uncovered code paths"
  });
}
```

#### 4.4 E2E Tests (MANDATORY for UI Changes)
```bash
# Navigate to project app directory
npm run test:e2e
```

**Pass Criteria:**
- ✅ 100% of E2E tests passing
- ✅ All critical user flows tested
- ✅ Zero flaky tests (tests pass consistently)
- ❌ ANY test failure = workflow HALT
- ❌ IF UI changes AND no E2E tests = workflow HALT

**E2E Requirement Check:**
```
IF story includes:
  - New UI components
  - User interaction flows
  - Form submissions
  - Navigation changes
THEN:
  - E2E tests MUST exist
  - All new flows MUST be tested
  - FAIL if E2E tests missing
```

#### 4.5 Build Verification (MANDATORY - Zero Tolerance)
```bash
# Navigate to project app directory
npm run build
```

**Pass Criteria:**
- ✅ Build completes successfully
- ✅ Zero build errors
- ✅ Warnings reviewed and documented
- ❌ Build failure = workflow HALT

#### 4.6 Acceptance Criteria Validation (PROGRAMMATIC - NEW in v3.0)

**CRITICAL:** Programmatic validation of each acceptance criterion

**Validation Process:**

1. **Parse Story Acceptance Criteria:**
   - Extract each AC from story file
   - Create validation checklist
   - Map AC to test files

2. **For Each Acceptance Criterion:**
   ```
   AC {number}: {description}

   ✓ Check 1: Test file exists covering this AC
   ✓ Check 2: Test explicitly validates AC requirement
   ✓ Check 3: Test passes successfully
   ✓ Check 4: Edge cases tested
   ✓ Check 5: Error scenarios tested

   Result: PASS | FAIL
   Evidence: {test file name and line numbers}
   ```

3. **Validation Requirements:**

   **Each AC MUST have:**
   - ✅ At least one test file explicitly covering it
   - ✅ Test description mentions the AC or its requirement
   - ✅ Positive test case (happy path)
   - ✅ Negative test case (error handling)
   - ✅ Edge case coverage

   **Example Validation:**
   ```markdown
   AC1: "User can create a new folder"

   ✓ Test File: apps/web/tests/integration/folder-creation.test.ts
   ✓ Test Case: "should create folder with valid name" (line 45)
   ✓ Positive Test: Creates folder successfully ✅
   ✓ Negative Test: Handles invalid folder name ✅
   ✓ Edge Cases: Max depth, duplicate names ✅

   Status: ✅ VALIDATED
   ```

4. **Validation Failure Handling:**

   **If ANY AC fails validation:**

   ```markdown
   ❌ ACCEPTANCE CRITERIA VALIDATION FAILED

   **Failed AC:** AC{number} - {description}

   **Issues:**
   - ❌ Missing test file for this AC
   - ❌ No positive test case found
   - ❌ Edge cases not covered

   **Required Actions:**
   1. Create test file: {suggested path}
   2. Add positive test case
   3. Add negative test case
   4. Add edge case tests

   **Workflow Status:** HALTED
   **Next Step:** Return to Fix Loop (Step 5)
   ```

   **HALT WORKFLOW** - Return to Step 5 with test requirements

5. **Generate AC Validation Report:**

   **File:** `docs/stories/qa-reports/story-{story_id}-ac-validation.md`

   ```markdown
   # Acceptance Criteria Validation Report

   **Story:** {story_id}
   **Date:** {timestamp}
   **Status:** {PASS|FAIL}

   ## Validation Results

   | AC # | Description | Test File | Status | Evidence |
   |------|-------------|-----------|---------|----------|
   | 1 | ... | .../test.ts:45 | ✅ PASS | All cases covered |
   | 2 | ... | .../test.ts:78 | ✅ PASS | All cases covered |
   | ... |

   ## Coverage Summary

   - Total AC: {total}
   - Validated: {validated}
   - Failed: {failed}
   - Coverage: {percentage}%

   **Final Decision:** {APPROVED | REJECTED}
   ```

**Document Results:**
- Record all test outputs with timestamps
- Capture failure details with stack traces
- Note performance metrics (build time, test duration)
- Identify regressions with git blame
- **Store coverage reports** for historical tracking
- **Generate AC validation report** (mandatory)

---

### 5. Automated Fix Loop (if issues found)

**WHILE (issues exist) DO:**

#### 5.a. Document All Issues

Create issue report with:
- **Description:** Clear explanation of the defect
- **Severity:** Critical | High | Medium | Low
- **Steps to Reproduce:** Exact reproduction steps
- **Expected Behavior:** What should happen
- **Actual Behavior:** What actually happens
- **Affected Files:** List of files involved
- **Test Evidence:** Logs, screenshots, error messages

#### 5.b. Spawn Dev Agent for Fixes

Use the Task tool to spawn Dev agent with prompt:

```
Load and activate dev agent from .claude/commands/BMad/agents/dev.md

Then fix issues in Story {story_id}:

{Detailed issue list from QA findings}

Requirements:
- Fix all listed issues
- Maintain existing functionality
- Update tests if needed
- Run full test suite to verify fixes
- Do NOT commit changes yet

Return detailed summary of:
- What was fixed
- How it was fixed
- Which files were modified
- Test results after fixes
```

**Agent Configuration:**
- Use `general-purpose` subagent type
- Provide complete issue context
- Include all test evidence
- Specify fix requirements
- Reference Dev agent file: `.claude/commands/BMad/agents/dev.md`

#### 5.c. Wait for Dev Agent Completion

- Monitor Dev agent progress
- Review fix implementation
- Validate approach taken

#### 5.d. Re-run Full Test Suite

Execute all tests from Step 4:
- Lint
- Type check
- Unit tests
- E2E tests
- Build
- Acceptance criteria

#### 5.e. Issue Validation

- If new issues found: Add to issue list, go to 5.a
- If all tests pass: Exit loop, proceed to Step 6
- If same issues persist after 7 iterations: HALT and escalate to user

**Loop Tracking:**
- Iteration count
- Issues fixed per iteration
- Issues remaining
- Time per iteration

**END WHILE**

---

### 6. Scrum Master Review (UPDATED in v3.0)

**PREREQUISITE:** ALL tests must pass (Step 4) and ALL AC must be validated

**Spawn Scrum Master Agent for Story Review:**

After all tests pass and ALL acceptance criteria validated, request Scrum Master (Bob) review before merging to main.

Use the Task tool to spawn Scrum Master agent with prompt:

```
Load and activate scrum master agent from .bmad-core/agents/sm.md

Then review Story {story_id} implementation:

**Story Details:**
{Full story details and acceptance criteria}

**Implementation Summary:**
{Dev agent implementation summary}

**QA Test Results:**
{QA test results summary including coverage, all test passes}

**Acceptance Criteria Validation:**
{AC validation report showing 100% coverage}

**Files Changed:**
{List of files created/modified}

**Completion Metrics:**
- Task Completion: 100%
- AC Coverage: 100%
- Test Coverage: {percentage}% (≥80% required)
- All Tests: PASSING

Requirements (v3.0 - STRICT ENFORCEMENT):
- Review implementation against story requirements
- Verify ALL acceptance criteria are FULLY implemented (no partial)
- Verify ALL tasks are marked COMPLETE (no pending)
- Check test coverage meets 80% threshold for new code
- Verify zero TODO/pending markers (unless documented as tech debt)
- Check that implementation aligns with sprint goals
- Validate documentation completeness
- Provide sign-off or request changes

⚠️ CRITICAL v3.0 RULES:
- Do NOT approve partial implementations
- Do NOT create "PARTIAL APPROVAL" status
- Do NOT allow "backend-only" or "UI-pending" merges
- Story is ATOMIC - either 100% complete or not ready

Return detailed review with:
- Approval status (APPROVED / CHANGES REQUIRED / BLOCKED)
- Comments on implementation quality
- Verification that ALL AC are fully implemented
- Any concerns or recommendations
- Sign-off statement if approved

**Valid Approval Statuses (v3.0):**
- APPROVED: Story is 100% complete, all AC met, all tests passing
- CHANGES REQUIRED: Issues found that need fixing
- BLOCKED: Dependencies missing, cannot proceed

**INVALID Status (DO NOT USE):**
- ❌ PARTIAL APPROVAL (not allowed)
- ❌ BACKEND APPROVED (not allowed)
- ❌ APPROVED WITH CONDITIONS (not allowed)
```

**Agent Configuration:**
- Use `general-purpose` subagent type
- Provide complete story context
- Include implementation and QA summaries
- **Include AC validation report** (NEW in v3.0)
- **Include completion metrics** (NEW in v3.0)
- Reference SM agent file: `.bmad-core/agents/sm.md`

**Wait for Review:**
- Monitor SM agent review process
- Validate SM response follows v3.0 rules
- If CHANGES REQUIRED: Document feedback and return to Step 5 (Fix Loop)
- If BLOCKED: Halt workflow and escalate to user
- If APPROVED: Proceed to merge

**Review Decision Validation (NEW in v3.0):**

1. **Check SM Response Format:**
   ```
   IF SM response contains:
     - "PARTIAL APPROVAL"
     - "Backend approved"
     - "Approved with pending work"
     - "UI components pending"
     - "Tests can be added later"
   THEN:
     REJECT SM response
     Re-prompt SM with strict v3.0 rules
     Emphasize: Story must be 100% complete
   ```

2. **Validate Approval Requirements:**

   **For APPROVED status, SM MUST confirm:**
   - ✅ ALL tasks marked complete (100%)
   - ✅ ALL acceptance criteria fully implemented (100%)
   - ✅ Test coverage ≥ 80% for new code
   - ✅ All tests passing (100%)
   - ✅ Zero critical/high severity issues
   - ✅ Zero TODO/pending markers (or documented debt)
   - ✅ Documentation complete

   **If SM approves WITHOUT confirming all above:**
   - Reject approval
   - Request detailed verification of each requirement

3. **Handle Review Decision:**

   **APPROVED:**
   - ✅ Continue to Step 7 (Merge to Main)
   - ✅ Story is atomically complete
   - ✅ Ready for production

   **CHANGES REQUIRED:**
   - Return to Step 5 (Fix Loop)
   - Provide SM feedback to Dev agent
   - Re-run tests after fixes
   - Request SM review again

   **BLOCKED:**
   - HALT workflow
   - Escalate to user
   - Document blockers
   - Story cannot proceed

**Output:**
- ✅ SM review complete with valid status
- ✅ Approval verification passed (if approved)
- ✅ Ready for merge (if approved) or return to fixes

---

### 7. Merge to Main Branch

**After Scrum Master approval:**

```bash
# Ensure on feature branch
git checkout feature/story-{story_id}

# Merge to main
git checkout main
git pull origin main
git merge --no-ff feature/story-{story_id} -m "Merge Story {story_id}: {Story Title}"
```

**Validation:**
- ✓ Main branch updated
- ✓ Feature branch merged
- ✓ No merge conflicts
- ✓ All commits preserved

---

### 8. Final Validation (only when all tests pass)

**Comprehensive Validation:**

✅ **Acceptance Criteria**
- [ ] All criteria from story plan verified
- [ ] Edge cases tested
- [ ] Error scenarios validated

✅ **Test Coverage**
- [ ] Unit test coverage meets threshold (>80%)
- [ ] E2E coverage for critical paths
- [ ] Integration points tested

✅ **Code Quality**
- [ ] Linting passes with 0 errors, 0 warnings
- [ ] Type checking passes
- [ ] Build succeeds
- [ ] No console errors in dev mode

✅ **Documentation**
- [ ] Code comments adequate
- [ ] API documentation updated (if applicable)
- [ ] README updated (if needed)

**Validation Output:**
- Final test summary
- Coverage report
- Quality metrics
- Sign-off checklist

---

### 9. Git Commit (only if zero issues and SM approved)

**Create commit with standardized format:**

```bash
git add .

git commit -m "$(cat <<'EOF'
test(story-{story_id}): QA validation passed

- All acceptance criteria verified
- Test coverage: {coverage}%
- Zero defects found
- Ready for production

Story: {story_id}
QA Status: ✓ Passed
Iterations: {iteration_count}

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

**Push to remote:**

```bash
git push origin main
```

**Sync verification:**
- Confirm push succeeded
- Verify remote is up to date
- Check CI/CD pipeline triggered (if applicable)

---

### 10. QA Report Generation

**Generate comprehensive report:**

**File Location:** `docs/stories/qa-reports/story-{story_id}-qa-report.md`

**Report Structure:**

```markdown
# QA Report: Story {story_id} - {Story Title}

**Story ID:** {story_id}
**QA Date:** {timestamp}
**QA Agent:** Quinn (Automated QA Workflow)
**Status:** ✓ PASSED | ✗ FAILED

## Executive Summary

{High-level summary of QA results}

**Final Result:** {PASSED|FAILED}
**Fix Iterations:** {count}
**Total Test Coverage:** {percentage}%

## Test Results Summary

### Acceptance Criteria Validation

| Criteria | Status | Evidence |
|----------|--------|----------|
| ... | ✅ PASS | ... |

### Test Suite Results

#### Linting
- Status: {PASS|FAIL}
- Errors: {count}
- Warnings: {count}

#### Unit Tests
- Status: {PASS|FAIL}
- Tests Run: {count}
- Passed: {count}
- Failed: {count}
- Duration: {time}

#### E2E Tests
- Status: {PASS|FAIL}
- Tests Run: {count}
- Passed: {count}
- Failed: {count}
- Duration: {time}

#### Build
- Status: {PASS|FAIL}
- Build Time: {time}
- Warnings: {count}

### Code Quality Metrics

- Test Coverage: {percentage}%
- Lint Errors: {count}
- Type Errors: {count}
- Build Errors: {count}

## Issues Found and Fixed

{For each iteration}

### Issue #{n}: {Title}

**Severity:** {Critical|High|Medium|Low}
**Status:** ✅ FIXED | ✗ OPEN

#### Description
{Detailed description}

#### Impact
{Impact analysis}

#### Fix Applied
{What was done to fix}

#### Verification
{How fix was verified}

## Timeline

| Phase | Start Time | End Time | Duration |
|-------|-----------|----------|----------|
| Story Extraction | ... | ... | ... |
| Initial Testing | ... | ... | ... |
| Fix Iteration 1 | ... | ... | ... |
| ... | ... | ... | ... |
| Final Validation | ... | ... | ... |
| **Total QA Time** | | | {duration} |

**Fix Iterations:** {count}

## Recommendations

### Immediate Actions
{List of immediate actions needed}

### Future Improvements
{List of suggested improvements}

### Technical Debt
{Any technical debt identified}

## Sign-off

**QA Agent:** Quinn (Automated)
**Date:** {timestamp}
**Final Status:** {PASSED|FAILED}

**Recommendation:** {APPROVED FOR PRODUCTION | REQUIRES FIXES | BLOCKED}

{Final summary statement}

## Appendix: Test Evidence

### Test Commands Run
{List all commands executed}

### Test Output Samples
{Key output samples}

### Git History
{Relevant git commits}
```

**Report Generation Steps:**
1. Create report directory if needed: `mkdir -p docs/stories/qa-reports`
2. Generate report using template above
3. Fill in all placeholders with actual data
4. Save to designated location
5. Confirm file created successfully

---

## Exit Conditions (UPDATED in v3.0)

The workflow completes successfully when **ALL** of the following are true (**MANDATORY - No Exceptions**):

✓ **Story 100% Complete** (NEW in v3.0)
- **Task Completion: 100%** (not 99%, not "almost done")
- **AC Implementation: 100%** (all criteria FULLY implemented)
- **Zero TODO/pending markers** (unless documented as approved tech debt)
- **Zero "partial implementation" status**
- **Dev agent confirms:** "Story complete" (not "backend complete", not "phase 1 complete")

✓ **All tests passing** (STRICT in v3.0)
- Lint: **0 errors, 0 warnings** (or warnings approved and documented)
- Type check: **0 errors** (no implicit any, no type workarounds)
- Unit tests: **100% passing** (no skipped, no .only, no disabled tests)
- E2E tests: **100% passing** (for UI changes - mandatory)
- Build: **Success** (no errors, warnings documented)
- **Test Coverage: ≥80%** for new code (lines, functions, branches ≥75%)

✓ **All acceptance criteria validated** (NEW in v3.0)
- **Each criterion programmatically validated** (Step 4.6)
- **Test coverage for each AC** (positive, negative, edge cases)
- **AC validation report generated** (docs/stories/qa-reports/)
- **100% AC validation pass rate** (no partial, no "mostly done")
- Edge cases tested for each AC
- Error scenarios verified for each AC

✓ **Zero critical/high severity issues** (STRICT in v3.0)
- **No blocking defects** (severity: critical)
- **No high-priority bugs** (severity: high)
- **All issues resolved** (not deferred, not documented for later)
- **No regressions** (all existing tests still pass)
- **No workarounds** (proper fixes, not hacks)

✓ **Scrum Master approval** (UPDATED in v3.0)
- **Status: APPROVED** (not "PARTIAL APPROVAL", not "APPROVED WITH CONDITIONS")
- **SM confirmed 100% completion** (all requirements verified)
- **SM sign-off documented** (in QA report and review)
- **Zero unresolved concerns** (all feedback addressed)

✓ **Code committed to main branch**
- **Commit created with proper format** (follows convention)
- **Pushed to remote successfully** (no conflicts)
- **Branch synced** (main up to date)
- **Feature branch merged** (using --no-ff)

✓ **QA report generated** (ENHANCED in v3.0)
- **Report file created** (docs/stories/qa-reports/story-{id}-qa-report.md)
- **All sections completed** (no placeholders, no TBDs)
- **Evidence documented** (test outputs, coverage reports, screenshots)
- **AC validation report included** (NEW in v3.0)
- **Completion metrics documented** (100% task, 100% AC)
- **Timeline and metrics recorded** (duration, iterations, coverage)

---

## Workflow Failures (NEW in v3.0)

**The workflow FAILS and HALTS if ANY of the following occur:**

❌ **Incomplete Implementation (Step 2.5)**
- Task completion < 100%
- AC implementation < 100%
- Dev agent reports "partial implementation"
- User refuses all 3 options (continue, split, tech debt)

❌ **Test Failures (Step 4)**
- ANY lint errors
- ANY type errors
- ANY test failures
- Test coverage < 80% for new code
- Missing E2E tests for UI changes
- Build failures

❌ **AC Validation Failures (Step 4.6)**
- ANY AC without test coverage
- ANY AC without positive/negative/edge case tests
- AC validation coverage < 100%

❌ **SM Review Rejection (Step 6)**
- SM status: CHANGES REQUIRED (after 7 fix iterations)
- SM status: BLOCKED (dependencies missing)
- SM attempts "PARTIAL APPROVAL" (rejected by workflow)

❌ **Fix Loop Limit (Step 5)**
- Same issues persist after 7 iterations
- Dev agent unable to fix issues
- Regressions introduced by fixes

**On Workflow Failure:**
1. HALT immediately
2. Generate failure report
3. Document incomplete state
4. Escalate to user
5. Do NOT commit
6. Do NOT merge
7. Preserve all work on feature branch

---

## Error Handling

### Fix Loop Limit Exceeded
**Condition:** Same issues persist after 7 fix iterations
**Action:**
1. Document persistent issues
2. Generate partial QA report
3. HALT workflow
4. Escalate to user with summary:
   - Issues that couldn't be auto-fixed
   - Iterations attempted
   - Recommended next steps

### Dev Agent Failure
**Condition:** Dev agent fails to complete fixes
**Action:**
1. Document agent failure details
2. Preserve issue context
3. HALT workflow
4. Report to user with agent logs

### Test Failures After Fixes
**Condition:** New failures introduced by fixes
**Action:**
1. Add new failures to issue list
2. Continue fix loop (unless limit exceeded)
3. Track regression issues separately

### Git Operations Failure
**Condition:** Commit or push fails
**Action:**
1. Document git error
2. Preserve all changes
3. Generate QA report without commit
4. Report to user for manual resolution

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Test Pass Rate | 100% | All tests passing |
| Fix Iterations | ≤ 7 | Number of dev agent spawns |
| Coverage | ≥ 80% | Unit test coverage |
| Quality Gates | All Pass | Lint, type, build checks |
| Time to Complete | Context-dependent | Total workflow duration |

---

## Usage Example

**As QA Agent (Quinn):**

```bash
# User activates QA agent
/qa

# User requests full story workflow
User: "Implement and test story 1.3"

# Quinn executes this task
*automated-dev-qa-sm-workflow story_id=1.3
```

**Workflow will:**
1. Load Story 1.3 from sprint plan
2. Spawn Dev agent to implement story on feature branch
3. Wait for implementation completion
4. Run all tests on feature branch
5. If issues found: Spawn Dev agent to fix
6. Re-run tests until all pass
7. Spawn Scrum Master (Bob) for story review
8. If SM requests changes: Return to fix loop
9. If SM approves: Merge feature branch to main
10. Commit with QA validation message on main
11. Generate comprehensive QA report
12. Report final status to user

---

## Agent References

**Dev Agent (James - Full Stack Developer):**
- File: `.claude/commands/BMad/agents/dev.md`
- Used for: Story implementation and bug fixes
- Spawned via: Task tool with `general-purpose` subagent type

**QA Agent (Quinn - Test Architect):**
- File: `.claude/commands/BMad/agents/qa.md`
- Used for: Test execution, validation, and orchestration
- Executes: This automated workflow task

**Scrum Master (Bob - Story Review Specialist):**
- File: `.bmad-core/agents/sm.md`
- Used for: Story implementation review and sign-off
- Spawned via: Task tool with `general-purpose` subagent type

---

## Notes

- This task orchestrates implementation, QA, and SM review phases
- QA agent (Quinn) spawns Dev agent (James) for implementation and fixes
- QA agent spawns Scrum Master (Bob) for story review and sign-off
- Dev and SM agent spawning uses the Task tool with `general-purpose` subagent
- All git operations assume proper repository setup
- Test commands should be run from the appropriate project directory (check package.json for available scripts)
- Feature branch workflow: `feature/story-{story_id}` → SM review → merge to `main`
- SM review acts as final gate before merge to main branch
- If SM requests changes, workflow returns to fix loop (Step 5)
- Report generation preserves complete audit trail
- Self-healing loop has safety limit to prevent infinite iterations
- All file modifications are tracked in change log
- Progress reports created during implementation phase
- QA reports created after final validation and SM approval

---

**Task Completion Indicator:**
When this task completes, you will receive:
1. Implementation summary from Dev agent
2. **Completion validation results** (100% confirmation - NEW in v3.0)
3. Final QA status (PASSED/FAILED)
4. **Acceptance criteria validation report** (NEW in v3.0)
5. Scrum Master review and approval status
6. Path to progress report (from implementation)
7. Path to QA report (from testing)
8. Git commit hash (if committed)
9. Summary of fix iterations and issues resolved
10. Feature branch merge status
11. **Test coverage metrics for new code** (NEW in v3.0)

---

## Version 3.0 Changes Summary

### What Was Broken in v2.0

**Problem 1: Dev Agent Could Choose Partial Scope**
- Dev agent autonomously decided to implement only backend (40-50%)
- Workflow had no enforcement mechanism
- Result: Incomplete stories merged to main

**Problem 2: No Completion Enforcement**
- Workflow trusted agent judgment without validation
- No programmatic checks for task completion
- Exit conditions were too flexible
- Result: Stories with 0% test coverage passed

**Problem 3: SM Review Allowed "Partial Approval"**
- SM could create unofficial approval statuses
- "Backend approved, UI pending" was accepted
- Not in original workflow design
- Result: Technical debt accumulated

**Problem 4: No Programmatic AC Validation**
- AC validation was manual only ("Manually verify each...")
- No test coverage requirements per AC
- No automated enforcement
- Result: AC "partially implemented" passed validation

**Problem 5: Exit Conditions Were Flexible**
- "0 new tests = pass" loophole
- No minimum test coverage enforcement
- "All tests passing" didn't mean "tests exist"
- Result: Quality gates bypassed

### What v3.0 Fixes

**Fix 1: Mandatory Completion Gate (Step 2.5)**
- ✅ NEW: Story completion validation before testing
- ✅ Calculates task completion % and AC completion %
- ✅ HALTS workflow if < 100%
- ✅ Presents 3 options: continue, split, or tech debt
- ✅ User must decide before proceeding

**Fix 2: Test Coverage Enforcement (Step 4.3)**
- ✅ MANDATORY: 80% coverage for new code
- ✅ Coverage calculated per file, not overall
- ✅ HALTS workflow if coverage < 80%
- ✅ No loopholes: "0 tests" now fails

**Fix 3: Programmatic AC Validation (Step 4.6)**
- ✅ NEW: Each AC must have test coverage
- ✅ Requires positive, negative, edge case tests
- ✅ Generates AC validation report
- ✅ HALTS if ANY AC lacks tests
- ✅ 100% AC coverage required

**Fix 4: Strict SM Review (Step 6)**
- ✅ Eliminated "PARTIAL APPROVAL" option
- ✅ Only valid statuses: APPROVED, CHANGES REQUIRED, BLOCKED
- ✅ SM must confirm 100% completion
- ✅ Workflow rejects invalid approval attempts
- ✅ SM cannot approve < 100% stories

**Fix 5: Strict Exit Conditions**
- ✅ Explicit: "100% complete" (not "almost done")
- ✅ Zero TODO/pending markers
- ✅ Test coverage ≥80% MANDATORY
- ✅ AC validation 100% required
- ✅ No "partial implementation" allowed

### Workflow Comparison

| Aspect | v2.0 (Broken) | v3.0 (Fixed) |
|--------|---------------|--------------|
| **Completion Check** | None | Step 2.5 - MANDATORY gate |
| **Task Completion** | Trusted agent | Programmatically enforced 100% |
| **AC Validation** | Manual only | Programmatic + test coverage |
| **Test Coverage** | Optional | MANDATORY ≥80% for new code |
| **SM Approval** | Any status | Only APPROVED/CHANGES/BLOCKED |
| **Partial Approval** | Allowed | REJECTED by workflow |
| **Exit Condition** | "Tests pass" | "100% complete + tests + coverage" |
| **Workflow Halt** | Rare | Common (enforces quality) |

### Migration Guide (v2.0 → v3.0)

**If you have v2.0 workflows in progress:**

1. **Partial implementations already merged:**
   - Create Story X.Yb for remaining work
   - Document as technical debt
   - Schedule completion

2. **Stories in development:**
   - Complete 100% before running v3.0 workflow
   - Or use "split story" option at Step 2.5
   - Cannot merge partial anymore

3. **Agent behavior changes:**
   - Dev agents must implement 100% of story
   - No "backend-first" strategies without user approval
   - All code must have tests (80% coverage)
   - SM cannot give partial approval

### Best Practices for v3.0

**For Dev Agents:**
- Implement ENTIRE story before returning
- Write tests DURING implementation (not after)
- Aim for >80% coverage from start
- Mark all tasks complete before finishing

**For QA Agents:**
- Run Step 2.5 completion check FIRST
- Enforce test coverage strictly
- Generate AC validation report
- Reject partial implementations immediately

**For Scrum Masters:**
- Only approve 100% complete stories
- Verify ALL tasks complete
- Check test coverage ≥80%
- Do NOT create custom approval statuses

**For Users:**
- Decide at Step 2.5: continue, split, or tech debt
- Don't expect partial merges
- Plan stories to be completable in one sprint
- Use story splitting when scope is too large

### Known Limitations

**v3.0 Does NOT prevent:**
- Stories that are too large (user must split)
- Technical debt if user chooses option 3
- Dev agents requesting to stop early (user must continue)

**v3.0 DOES prevent:**
- Automatic partial merges
- 0% test coverage stories
- Uncovered acceptance criteria
- "Partial approval" workarounds

### Enforcement Philosophy

**v3.0 Philosophy:**
> "Stories are atomic. Either 100% complete or not ready for main branch."

**v2.0 Philosophy (deprecated):**
> "Trust agent judgment and allow flexible merging."

**Key Change:**
- v2.0: Trusts → v3.0: Verifies
- v2.0: Flexible → v3.0: Strict
- v2.0: Partial OK → v3.0: 100% or fail

---

## Upgrade Notes

**Upgrading from v2.0 to v3.0:**

This workflow document is now v3.0. When running the workflow:
- QA agent will enforce Step 2.5 (completion validation)
- Test coverage MUST be ≥80% for new code
- AC validation MUST show 100% coverage
- SM CANNOT give partial approval

**Backward Compatibility:**
- v3.0 is NOT backward compatible with v2.0 partial merges
- Existing partial stories must be completed or split
- No migration path for "approved with pending work"

**Version:** 3.0
**Last Updated:** 2025-10-07
**Breaking Changes:** Yes (completion enforcement)
**Upgrade Required:** Immediate (no partial merges allowed)
