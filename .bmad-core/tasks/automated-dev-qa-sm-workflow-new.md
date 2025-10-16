# Automated Story Implementation and QA Workflow

**Task ID:** automated-dev-qa-sm-workflow
**Version:** 3.3
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

**Key v3.2 Changes (NEW - Git Branch Isolation):**
- ✅ Mandatory feature branch creation and isolation
- ✅ All commits happen on feature branch only
- ✅ QA validation commit on feature branch before merge
- ✅ Parallel story work fully supported
- ✅ Clean merge-only commits to main branch

**Previous v3.0 Changes:**
- ✅ Mandatory 100% task completion enforcement
- ✅ Programmatic acceptance criteria validation
- ✅ Test coverage requirements enforced
- ✅ Story splitting decision point added
- ✅ "Partial approval" eliminated from SM review

## Input Parameters

- `story_id`: Story identifier (e.g., "1.3", "2.1")
- `sprint_plan`: Path to sprint plan file (default: `docs/stories/SPRINT-{N}-PLAN.md`)

## Workflow Steps

### 1. Story Extraction and Feature Branch Setup

**Actions:**

1. **Parse Story Details:**
   - Parse story identifier from input parameters
   - Read full story details from `docs/stories/SPRINT-N-PLAN.md`
   - Extract all acceptance criteria and requirements
   - Load story-specific files if they exist

2. **Feature Branch Creation/Verification (NEW in v3.2):**
   ```bash
   # Check if feature branch already exists
   git fetch origin
   git branch -a | grep "feature/story-{story_id}"

   if [ $? -eq 0 ]; then
     # Branch exists - checkout and update
     git checkout feature/story-{story_id}
     git pull origin feature/story-{story_id}
     echo "✅ Switched to existing feature branch"
   else
     # Create new feature branch from latest main
     git checkout main
     git pull origin main
     git checkout -b feature/story-{story_id}
     git push -u origin feature/story-{story_id}
     echo "✅ Created new feature branch: feature/story-{story_id}"
   fi
   ```

3. **Branch Isolation Verification:**
   ```bash
   # Verify we're on the correct feature branch
   current_branch=$(git branch --show-current)
   if [ "$current_branch" != "feature/story-{story_id}" ]; then
     echo "❌ ERROR: Not on feature branch!"
     exit 1
   fi

   # Confirm parallel branches exist (informational only)
   echo "📋 Active feature branches:"
   git branch -a | grep "feature/" | grep -v "feature/story-{story_id}"
   echo "⚠️  Note: Other feature branches are active. Stay isolated to your branch."
   ```

**Output:**
- Story context loaded
- Acceptance criteria list created
- Requirements documented
- **Feature branch created or verified (NEW in v3.2)**
- **Branch isolation confirmed (NEW in v3.2)**
- **Parallel branches acknowledged (NEW in v3.2)**

---

### 2. Story Implementation

**Pre-Implementation Component Check:**

Before spawning Dev agent, check if story involves table components:

```javascript
// Extract story details
const storyDetails = extractStoryDetails(story_id);
const involvesTable = checkIfInvolvesTable(storyDetails);

if (involvesTable) {
  // Load DataTable architecture and requirements
  loadComponentRequirements([
    'docs/components/REUSABLE-COMPONENTS-REQUIREMENTS.md',
    'docs/components/DATATABLE-USAGE-EXAMPLES.md',
    'docs/components/TABLE-COMPONENT-USAGE-PATTERNS.md'
  ]);
}
```

**Detect Table Requirements:**
- Story mentions: "table", "listing", "grid", "data display", "performance tracker", "reviews", "prospectus"
- Epic 9 stories (9.1-9.17)
- Any page with tabular data presentation

**Spawn Dev Agent for Implementation:**

Use the Task tool to spawn Dev agent with prompt:

```
Load and activate dev agent from .claude/commands/BMad/agents/dev.md

Then implement Story {story_id}:

{Full story details including all acceptance criteria}

**COMPONENT ARCHITECTURE REQUIREMENTS (CRITICAL):**

{IF story involves table components, include this section:}

⚠️ MANDATORY: Use Enhanced DataTable Component

**Component Location:** web/components/shared/DataTable.tsx

**Architecture Decision (Approved 2025-10-11):**
- Use ONE enhanced DataTable component for ALL table use cases
- Features are opt-in via props (enableColumnSearch, enableYearFilter, enablePagination, enableMinimizeToggle)
- DO NOT create new table components - use existing DataTable with appropriate props

**Required Reading Before Implementation:**
1. Component Architecture: docs/components/REUSABLE-COMPONENTS-REQUIREMENTS.md
2. Usage Examples: docs/components/DATATABLE-USAGE-EXAMPLES.md
3. Usage Patterns: docs/components/TABLE-COMPONENT-USAGE-PATTERNS.md

**Feature Matrix Reference:**
Based on your story type, enable ONLY these features:
- Home page tables (Stories 9.1-9.3): Sorting only
- Landing page sections (Stories 9.15-9.16): Sorting only
- Landing page detailed table (Stories 9.15-9.16): Sorting + Column Search + Year Filter + Minimize Toggle
- IPO Listings (Story 9.17): Sorting + Year Filter + Pagination
- Performance Tracker (Stories 9.7a, 9.11): Sorting + Year Filter + Pagination
- Prospectus (Stories 9.8a, 9.12): Sorting + Column Search + Year Filter + Pagination
- Reviews (Stories 9.10a, 9.14): Sorting + Column Search + Year Filter + Pagination
- Rights/OFS/NCD (Stories 9.4-9.6): Sorting + Column Search + Year Filter + Pagination

**Validation Checklist:**
- [ ] Used existing DataTable component (not created new component)
- [ ] Enabled ONLY approved features per story type
- [ ] Followed usage examples from documentation
- [ ] Defined proper column configurations
- [ ] Implemented render functions for custom cells
- [ ] Used renderFunctions utilities for formatting (date, currency, percentage)
- [ ] Configured feature props correctly (yearFilterConfig, paginationConfig, etc.)

{END IF table component section}

**General Requirements:**
- ⚠️ **CRITICAL:** Work ONLY on feature branch: feature/story-{story_id} (v3.2)
- ⚠️ **CRITICAL:** Create commits on feature branch during implementation (v3.2)
- ⚠️ **CRITICAL:** Never switch to main branch during implementation (v3.2)
- ⚠️ **CRITICAL:** Assume parallel feature branches exist - stay isolated (v3.2)
- Implement all acceptance criteria (100% - no partial implementations)
- Write comprehensive tests (unit + E2E)
  - Unit test coverage ≥80% for new code
  - E2E tests for all UI interactions
  - Test all optional features enabled for tables
- Ensure code quality (lint, types, formatting)
- Update documentation as needed
- Create progress report in docs/stories/progress-reports/
- **Commit implementation work to feature branch** (v3.2 - changed from "Do NOT commit")
- **Push feature branch to remote regularly** (v3.2 - NEW)

Return detailed summary of:
- What was implemented (with component usage details if tables involved)
- Files created/modified
- DataTable feature configuration used (if applicable)
- Tests added (including component feature tests)
- Any blockers or decisions made
- Component architecture compliance confirmation
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
- Feature branch active with all implementation commits
- Code implemented and committed to feature branch (v3.2)
- Tests written and committed to feature branch (v3.2)
- Progress report generated and committed to feature branch (v3.2)
- Feature branch pushed to remote (v3.2)
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

### 3. Initial Verification (UPDATED in v3.2)

**PREREQUISITE:** Step 2.5 completion validation must PASS

**Actions:**

1. **Branch Isolation Check (NEW in v3.2):**
   ```bash
   # Verify we're still on feature branch
   current_branch=$(git branch --show-current)
   if [ "$current_branch" != "feature/story-{story_id}" ]; then
     echo "❌ ERROR: Switched branches during workflow!"
     echo "Expected: feature/story-{story_id}"
     echo "Actual: $current_branch"
     exit 1
   fi

   # Verify no uncommitted changes
   if ! git diff-index --quiet HEAD --; then
     echo "⚠️  WARNING: Uncommitted changes detected"
     echo "All implementation should be committed on feature branch"
   fi
   ```

2. **Feature Branch Validation:**
   - Verify feature branch exists: `feature/story-{story_id}`
   - Confirm implementation commits present on feature branch (v3.2)
   - Review commit history for story-related changes on feature branch (v3.2)
   - **Verify NO commits on main branch** (v3.2 - NEW)
   - **Check 100% task completion** (enforced by Step 2.5)
   - **Check 100% AC implementation** (enforced by Step 2.5)
   - Verify progress report created and committed (v3.2)
   - **Verify test files exist for ALL new code**

**Strict Validation:**
- ✓ On feature branch (feature/story-{story_id}) (v3.2 - enforced)
- ✓ Implementation commits found on feature branch (v3.2)
- ✓ Main branch untouched (v3.2 - NEW)
- ✓ All changes committed to feature branch (v3.2 - NEW)
- ✓ **ALL tasks marked complete (100%)**
- ✓ **ALL acceptance criteria implemented (100%)**
- ✓ **Test files exist for all new functionality**
- ✓ Progress report exists and committed (v3.2)
- ✓ **Zero TODO/pending markers** (or documented as tech debt)

---

### 4. Comprehensive Testing (UPDATED in v3.2)

**PREREQUISITE:** Step 3 initial verification must PASS

**Branch Context (v3.2):**
- ⚠️ **All tests run on feature branch ONLY**
- ⚠️ **Never switch to main during testing**
- ⚠️ **Parallel feature branches may be active - ignore them**

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

#### 4.6 Component Architecture Validation (NEW - For Table Components)

**CRITICAL:** Validate proper DataTable component usage

**ONLY IF story involves table components:**

**Validation Checks:**

1. **Component Usage Validation:**
   ```bash
   # Check that DataTable component is imported
   grep -r "from '@/components/shared/DataTable'" web/

   # Check that NO new table components were created
   find web/components -name "*Table*.tsx" -newer feature_branch_start
   ```

   **Pass Criteria:**
   - ✅ DataTable imported from web/components/shared/DataTable.tsx
   - ✅ No new custom table components created (except Calendar components for Stories 9.9a, 9.13)
   - ❌ Creating new table components = workflow HALT

2. **Feature Configuration Validation:**

   Parse component usage and verify correct features enabled:

   ```typescript
   // Extract DataTable usage from code
   const tableUsages = extractDataTableUsages(changedFiles);

   for (const usage of tableUsages) {
     const storyType = determineStoryType(story_id);
     const expectedFeatures = getExpectedFeatures(storyType);
     const actualFeatures = usage.enabledFeatures;

     // Validate features match approved matrix
     validateFeaturesMatch(expectedFeatures, actualFeatures);
   }
   ```

   **Feature Matrix Validation:**
   ```markdown
   Story Type: {detected type}
   Expected Features: {list from approved matrix}
   Actual Features: {list from code}

   Validation:
   - [ ] enableColumnSearch matches requirement
   - [ ] enableYearFilter matches requirement
   - [ ] enablePagination matches requirement
   - [ ] enableMinimizeToggle matches requirement
   - [ ] No unapproved features enabled

   Result: PASS | FAIL
   ```

3. **Render Functions Usage:**

   Check that common render functions are used for formatting:

   ```bash
   # Check for renderFunctions usage
   grep -r "renderFunctions\." web/app/ web/components/

   # Check for manual date/currency formatting (anti-pattern)
   grep -r "toLocaleString\|Intl.NumberFormat" web/app/ web/components/ --exclude="*DataTable.tsx"
   ```

   **Pass Criteria:**
   - ✅ Uses renderFunctions.date() for dates
   - ✅ Uses renderFunctions.currency() for currency
   - ✅ Uses renderFunctions.percentWithColor() for percentages
   - ✅ Uses renderFunctions.number() for numbers
   - ❌ Manual formatting in table columns = workflow WARN (not HALT, but document)

4. **Props Configuration Validation:**

   Verify required configuration objects are provided:

   ```typescript
   // If enableYearFilter=true, yearFilterConfig must be provided
   if (usage.enableYearFilter && !usage.yearFilterConfig) {
     FAIL("yearFilterConfig missing but enableYearFilter=true");
   }

   // If enablePagination=true, paginationConfig must be provided
   if (usage.enablePagination && !usage.paginationConfig) {
     FAIL("paginationConfig missing but enablePagination=true");
   }

   // If enableColumnSearch=true, columnSearchConfig recommended
   if (usage.enableColumnSearch && !usage.columnSearchConfig) {
     WARN("columnSearchConfig recommended for enableColumnSearch=true");
   }
   ```

5. **Column Definition Validation:**

   Check that column definitions follow best practices:

   ```typescript
   for (const column of usage.columns) {
     // Check required fields
     if (!column.key || !column.header) {
       FAIL("Column missing required key or header");
     }

     // Check searchable columns have render functions
     if (column.searchable && !column.render) {
       WARN("Searchable column should have render function");
     }

     // Check alignment for numeric columns
     if (isNumericColumn(column) && column.align !== 'right') {
       WARN("Numeric columns should have align='right'");
     }
   }
   ```

6. **Generate Component Validation Report:**

   **File:** `docs/stories/qa-reports/story-{story_id}-component-validation.md`

   ```markdown
   # Component Architecture Validation Report

   **Story:** {story_id}
   **Date:** {timestamp}
   **Component Type:** DataTable
   **Status:** {PASS|FAIL}

   ## Component Usage

   | File | Component | Features Enabled | Status |
   |------|-----------|------------------|--------|
   | .../page.tsx | DataTable | Sorting, Pagination | ✅ VALID |
   | ... |

   ## Feature Validation

   **Story Type:** {detected type}
   **Expected Configuration:** {from matrix}
   **Actual Configuration:** {from code}

   ✅ Feature configuration matches approved matrix

   ## Render Functions Usage

   - ✅ Uses renderFunctions.date() for dates
   - ✅ Uses renderFunctions.currency() for currency
   - ✅ Uses renderFunctions.percentWithColor() for percentages

   ## Issues Found

   {List any violations or warnings}

   ## Final Decision

   **Status:** {APPROVED | REJECTED}
   **Reason:** {explanation}
   ```

**On Component Validation Failure:**

```markdown
❌ COMPONENT ARCHITECTURE VIOLATION

**Issue:** {description}

**Expected:**
{What should have been done}

**Actual:**
{What was done}

**Fix Required:**
1. {Action 1}
2. {Action 2}

**Workflow Status:** HALTED
**Next Step:** Return to Fix Loop (Step 5)
```

**HALT WORKFLOW** - Return to Step 5 with component fix requirements

---

#### 4.7 Acceptance Criteria Validation (PROGRAMMATIC - NEW in v3.0)

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
- **Generate component validation report** (if table components involved)
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
- ⚠️ **CRITICAL:** Work ONLY on feature branch: feature/story-{story_id} (v3.2)
- ⚠️ **CRITICAL:** Commit all fixes to feature branch (v3.2)
- ⚠️ **CRITICAL:** Never switch to main branch (v3.2)
- Fix all listed issues
- Maintain existing functionality
- Update tests if needed
- Run full test suite to verify fixes
- **Commit fixes to feature branch after verification** (v3.2 - changed from "Do NOT commit")

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

### 7. Final Validation on Feature Branch (UPDATED in v3.2)

**PREREQUISITE:** SM approval received (Step 6)

**Branch Context (v3.2):**
- ⚠️ **Still on feature branch: feature/story-{story_id}**
- ⚠️ **Do NOT merge yet - validation first**

**Comprehensive Validation on Feature Branch:**

```bash
# Verify we're still on feature branch
current_branch=$(git branch --show-current)
if [ "$current_branch" != "feature/story-{story_id}" ]; then
  echo "❌ ERROR: Not on feature branch!"
  exit 1
fi
```

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

✅ **Git State (NEW in v3.2)**
- [ ] All work committed on feature branch
- [ ] Feature branch pushed to remote
- [ ] Main branch untouched
- [ ] Clean working directory

**Validation Output:**
- Final test summary
- Coverage report
- Quality metrics
- Sign-off checklist
- **Feature branch ready for merge** (v3.2)

---

### 8. QA Validation Commit on Feature Branch (NEW in v3.2)

**CRITICAL:** This step creates the final QA validation commit on the feature branch BEFORE merging.

**Branch Context:**
- ⚠️ **Must be on feature branch: feature/story-{story_id}**
- ⚠️ **This is the LAST commit before merge**
- ⚠️ **Do NOT commit on main**

**Create QA validation commit on feature branch:**

```bash
# Verify we're on feature branch
current_branch=$(git branch --show-current)
if [ "$current_branch" != "feature/story-{story_id}" ]; then
  echo "❌ ERROR: Must be on feature branch!"
  exit 1
fi

# Stage any remaining changes (QA reports, etc.)
git add .

# Create QA validation commit
git commit -m "$(cat <<'EOF'
test(story-{story_id}): QA validation passed

- All acceptance criteria verified
- Test coverage: {coverage}%
- Zero defects found
- Ready for production
- SM approved

Story: {story_id}
QA Status: ✓ Passed
Iterations: {iteration_count}

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

# Push feature branch with QA validation
git push origin feature/story-{story_id}
```

**Validation:**
- ✓ QA commit created on feature branch
- ✓ Feature branch pushed to remote
- ✓ All commits preserved on feature branch
- ✓ Main branch still untouched
- ✓ Feature branch contains complete history

**Output:**
- QA validation commit hash
- Feature branch fully validated and ready to merge
- Complete feature history on branch

---

### 9. Merge Feature Branch to Main (UPDATED in v3.2)

**PREREQUISITE:** QA validation commit created on feature branch (Step 8)

**Branch Context:**
- ⚠️ **Starting on feature branch: feature/story-{story_id}**
- ⚠️ **Will merge to main and create merge commit ONLY**
- ⚠️ **No new commits on main - only merge commit**

**Merge Steps:**

```bash
# Step 1: Verify we're on feature branch with QA commit
current_branch=$(git branch --show-current)
if [ "$current_branch" != "feature/story-{story_id}" ]; then
  echo "❌ ERROR: Must start merge from feature branch!"
  exit 1
fi

# Step 2: Verify feature branch has QA validation commit
if ! git log -1 --pretty=%B | grep -q "QA validation passed"; then
  echo "❌ ERROR: QA validation commit not found!"
  echo "Expected last commit to contain 'QA validation passed'"
  exit 1
fi

# Step 3: Fetch latest main and check for conflicts
git fetch origin main
git checkout main
git pull origin main

# Step 4: Check for potential merge conflicts BEFORE merging
echo "🔍 Checking for merge conflicts..."
if git merge-tree $(git merge-base main feature/story-{story_id}) main feature/story-{story_id} | grep -q "^[<=>]"; then
  echo "⚠️  WARNING: Merge conflicts detected!"
  echo "Resolve conflicts before proceeding"
  exit 1
fi

# Step 5: Merge feature branch with no-fast-forward (creates merge commit)
git merge --no-ff feature/story-{story_id} -m "$(cat <<'EOF'
Merge feature/story-{story_id}: {Story Title}

Story {story_id} - Complete Implementation

✅ All acceptance criteria met
✅ Test coverage: {coverage}%
✅ All tests passing
✅ QA validation passed
✅ SM approved
✅ Zero defects

Feature branch: feature/story-{story_id}
QA Iterations: {iteration_count}

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

# Step 6: Push main with the merge commit
git push origin main

# Step 7: Verify merge succeeded
if [ $? -eq 0 ]; then
  echo "✅ Successfully merged feature/story-{story_id} to main"
  echo "📦 Merge commit created on main"
  echo "🚀 Main branch pushed to remote"
else
  echo "❌ ERROR: Failed to push to main"
  exit 1
fi
```

**Validation:**
- ✓ Merged from feature branch to main
- ✓ Merge commit created (--no-ff ensures this)
- ✓ All feature commits preserved in history
- ✓ Main branch updated with merge commit only
- ✓ Feature branch commits visible in git log
- ✓ No direct commits on main (only merge commit)
- ✓ Main pushed to remote successfully

**Git History After Merge (v3.2):**
```
main branch:
└── Merge commit: "Merge feature/story-{story_id}: {Story Title}"
    ↑
    └─── feature/story-{story_id} branch:
         ├── commit: Initial implementation
         ├── commit: Add tests
         ├── commit: Fix QA issues
         └── commit: QA validation passed ✅
```

**Sync Verification:**
- Confirm merge succeeded
- Verify main pushed to remote
- Check CI/CD pipeline triggered (if applicable)
- Confirm feature branch history preserved

---

### 10. Story Status Update (NEW in v3.3)

**CRITICAL:** Update story status and metadata to reflect completion.

**Branch Context:**
- ⚠️ **Must be on main branch** (just merged from feature branch)
- ⚠️ **This creates a status update commit on main**
- ⚠️ **Final step before QA report generation**

**Status Update Actions:**

#### 10.1. Update Sprint Plan Status

**File:** `docs/stories/SPRINT-N-PLAN.md`

```bash
# Locate the story entry in sprint plan
story_line=$(grep -n "Story ${story_id}:" docs/stories/SPRINT-*.md | cut -d: -f1)

# Update story status from "In Progress" to "Done"
# Update format depends on sprint plan structure
# Common patterns:
# - "Status: In Progress" → "Status: Done"
# - "- [ ] Story X.Y" → "- [x] Story X.Y"
# - "Story X.Y | In Progress" → "Story X.Y | Done"
```

**Status Update Fields:**
```yaml
Status: Done
Completed Date: {YYYY-MM-DD}
QA Status: Passed
SM Approval: Yes
Merged Commit: {merge_commit_hash}
Test Coverage: {coverage}%
QA Iterations: {iteration_count}
```

**Example Update:**

Before:
```markdown
### Story 5.6: Enhanced Subscription Data Display
**Status:** In Progress
**Assigned To:** Dev Team
**Priority:** High
```

After:
```markdown
### Story 5.6: Enhanced Subscription Data Display
**Status:** Done ✅
**Assigned To:** Dev Team
**Priority:** High
**Completed:** 2025-01-15
**QA Status:** Passed
**SM Approval:** Approved
**Test Coverage:** 87%
**QA Iterations:** 2
**Merge Commit:** abc1234
```

#### 10.2. Update Individual Story File (if exists)

**File:** `docs/stories/{story_id}.*.story.md`

Check if individual story file exists:
```bash
# Find story file
story_file=$(find docs/stories -name "${story_id}.*.story.md" -o -name "story-${story_id}.md")

if [ -n "$story_file" ]; then
  echo "📝 Found individual story file: $story_file"
  # Update status in story file
fi
```

**Add Completion Metadata Section:**

```markdown
---

## Implementation Complete ✅

**Completion Date:** {YYYY-MM-DD HH:MM:SS}
**QA Status:** Passed
**SM Approval:** Approved by Bob (Scrum Master)
**Test Coverage:** {coverage}%
**QA Iterations:** {iteration_count}

### Git References
- **Feature Branch:** feature/story-{story_id}
- **Merge Commit:** {merge_commit_hash}
- **Commits Count:** {commit_count}

### Quality Metrics
- **Lint Errors:** 0
- **Type Errors:** 0
- **Unit Tests:** {unit_test_count} passing
- **E2E Tests:** {e2e_test_count} passing
- **Build Status:** Success

### Acceptance Criteria Status
{For each AC:}
- ✅ AC{number}: {description} - Fully implemented and tested

### Reports Generated
- Progress Report: `docs/stories/progress-reports/story-{story_id}-progress.md`
- QA Report: `docs/stories/qa-reports/story-{story_id}-qa-report.md`
- Component Validation: `docs/stories/qa-reports/story-{story_id}-component-validation.md` (if applicable)
- AC Validation: `docs/stories/qa-reports/story-{story_id}-ac-validation.md`

### Timeline
- **Started:** {start_timestamp}
- **Implementation Complete:** {dev_complete_timestamp}
- **QA Complete:** {qa_complete_timestamp}
- **SM Approved:** {sm_approval_timestamp}
- **Merged to Main:** {merge_timestamp}
- **Total Duration:** {duration}

---
```

#### 10.3. Create Story Completion Tracking File

**File:** `docs/stories/.completed/story-{story_id}-completion.json`

Create machine-readable completion metadata:

```json
{
  "story_id": "{story_id}",
  "story_title": "{story_title}",
  "completion_status": "done",
  "timestamps": {
    "started": "{iso_timestamp}",
    "implementation_complete": "{iso_timestamp}",
    "qa_complete": "{iso_timestamp}",
    "sm_approved": "{iso_timestamp}",
    "merged_to_main": "{iso_timestamp}",
    "status_updated": "{iso_timestamp}"
  },
  "quality_metrics": {
    "test_coverage_percent": {coverage},
    "qa_iterations": {iteration_count},
    "lint_errors": 0,
    "type_errors": 0,
    "unit_tests_passing": {unit_test_count},
    "e2e_tests_passing": {e2e_test_count},
    "build_status": "success"
  },
  "git_references": {
    "feature_branch": "feature/story-{story_id}",
    "merge_commit": "{merge_commit_hash}",
    "commit_count": {commit_count}
  },
  "acceptance_criteria": {
    "total": {total_ac},
    "completed": {completed_ac},
    "completion_percent": 100
  },
  "approvals": {
    "qa_approved": true,
    "qa_agent": "Quinn",
    "sm_approved": true,
    "sm_agent": "Bob"
  },
  "reports": {
    "progress_report": "docs/stories/progress-reports/story-{story_id}-progress.md",
    "qa_report": "docs/stories/qa-reports/story-{story_id}-qa-report.md",
    "component_validation": "docs/stories/qa-reports/story-{story_id}-component-validation.md",
    "ac_validation": "docs/stories/qa-reports/story-{story_id}-ac-validation.md"
  },
  "workflow_version": "3.3"
}
```

#### 10.4. Update Sprint Progress Dashboard (if exists)

**File:** `docs/stories/SPRINT-{N}-DASHBOARD.md` (create if doesn't exist)

Update sprint-level metrics:

```markdown
# Sprint {N} Dashboard

**Last Updated:** {timestamp}

## Sprint Progress

- **Total Stories:** {total}
- **Completed:** {completed} ✅
- **In Progress:** {in_progress}
- **Not Started:** {not_started}
- **Completion Rate:** {percentage}%

## Recently Completed Stories

- ✅ Story {story_id}: {story_title} - Completed {date}
  - Test Coverage: {coverage}%
  - QA Iterations: {iteration_count}
  - Duration: {duration}

{List other completed stories...}

## Quality Metrics

| Metric | Average | Target | Status |
|--------|---------|--------|--------|
| Test Coverage | {avg}% | 80% | {PASS/FAIL} |
| QA Iterations | {avg} | ≤3 | {PASS/FAIL} |
| Time to Complete | {avg} hrs | TBD | - |
```

#### 10.5. Commit Status Updates to Main

**Create status update commit on main:**

```bash
# Verify we're on main branch
current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
  echo "❌ ERROR: Must be on main branch for status update!"
  exit 1
fi

# Create directory for completion tracking if needed
mkdir -p docs/stories/.completed

# Stage all status update files
git add docs/stories/SPRINT-*.md
git add docs/stories/${story_id}.*.story.md 2>/dev/null || true
git add docs/stories/.completed/story-{story_id}-completion.json
git add docs/stories/SPRINT-*-DASHBOARD.md 2>/dev/null || true

# Create status update commit
git commit -m "$(cat <<'EOF'
docs(story-{story_id}): Update story status to Done

Story {story_id} - {Story Title}

Status Changes:
- Sprint Plan: In Progress → Done ✅
- Story File: Added completion metadata
- Completion Tracking: Created story-{story_id}-completion.json
- Sprint Dashboard: Updated progress metrics

Completion Summary:
- ✅ All acceptance criteria met (100%)
- ✅ Test coverage: {coverage}%
- ✅ QA validation: Passed ({iteration_count} iterations)
- ✅ SM approval: Approved
- ✅ Merged: {merge_commit_hash}

Reports:
- Progress: docs/stories/progress-reports/story-{story_id}-progress.md
- QA: docs/stories/qa-reports/story-{story_id}-qa-report.md
- Component: docs/stories/qa-reports/story-{story_id}-component-validation.md
- AC Validation: docs/stories/qa-reports/story-{story_id}-ac-validation.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

# Push status update to remote
git push origin main

# Verify push succeeded
if [ $? -eq 0 ]; then
  echo "✅ Story status updated and pushed to remote"
  echo "📊 Sprint plan, story file, and completion tracking updated"
else
  echo "❌ ERROR: Failed to push status update"
  exit 1
fi
```

**Validation:**
- ✓ Sprint plan status updated to "Done"
- ✓ Individual story file updated (if exists)
- ✓ Completion tracking JSON created
- ✓ Sprint dashboard updated (if exists)
- ✓ Status update committed to main
- ✓ Main pushed to remote successfully

**Output:**
- Story status officially marked as complete
- All tracking metadata updated
- Sprint progress metrics current
- Status update commit hash

---

### 11. QA Report Generation

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

## Exit Conditions (UPDATED in v3.3)

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
- **Each criterion programmatically validated** (Step 4.7)
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

✓ **Code committed and merged properly** (UPDATED in v3.3)
- **All implementation commits on feature branch** (v3.2 - NEW)
- **QA validation commit on feature branch** (v3.2 - NEW)
- **Feature branch merged to main with --no-ff** (v3.2 - enforced)
- **Only merge commit on main** (v3.2 - NEW)
- **Main pushed to remote successfully** (no conflicts)
- **Branch synced** (main up to date)
- **Feature branch history preserved** (v3.2 - NEW)

✓ **Conflict Resolution Completed** (NEW in v3.3 - if conflicts occurred)
- **Conflicts detected and resolved:** Step 9.1 procedures followed
- **Resolution method documented:** Manual, rebase, or user decision
- **Post-resolution validation passed:** Tests pass after conflict resolution
- **Merge completed successfully:** No remaining conflicts on main
- **Conflict resolution noted in merge commit** (if applicable)

✓ **Feature Branch Managed Properly** (NEW in v3.3)
- **30-day retention tag created:** Tag includes deletion date marker
- **Branch not immediately deleted:** Preserved for 30 days post-merge
- **Retention marker pushed to remote:** Tag available for cleanup automation
- **Cleanup script available:** `.bmad-core/scripts/cleanup-merged-branches.sh` exists

✓ **Story status updated** (NEW in v3.3)
- **Sprint plan status:** Updated to "Done" (docs/stories/SPRINT-N-PLAN.md)
- **Individual story file:** Completion metadata added (if file exists)
- **Completion tracking:** JSON file created (docs/stories/.completed/story-{id}-completion.json)
- **Sprint dashboard:** Progress metrics updated (if dashboard exists)
- **Status update committed:** Commit created on main branch
- **Status update pushed:** Remote repository updated
- **All tracking current:** No outdated status information

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

**Workflow will (v3.3 - Updated with Status Tracking):**
1. Load Story 1.3 from sprint plan and create/verify feature branch
2. Spawn Dev agent to implement story on feature branch (with commits)
3. Wait for implementation completion on feature branch
4. Run all tests on feature branch
5. If issues found: Spawn Dev agent to fix on feature branch (with commits)
6. Re-run tests until all pass
7. Spawn Scrum Master (Bob) for story review
8. If SM requests changes: Return to fix loop on feature branch
9. If SM approves: Create QA validation commit on feature branch
10. Merge feature branch to main (creates merge commit only)
11. Update story status in sprint plan, story file, and completion tracking (NEW in v3.3)
12. Generate comprehensive QA report
13. Report final status to user

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
- **Feature branch workflow (v3.2):** `feature/story-{story_id}` (all commits) → QA commit → merge to `main` (merge commit only)
- **Branch isolation (v3.2):** All work stays on feature branch until merge; main only receives merge commits
- **Parallel development (v3.2):** Multiple feature branches can coexist; each story isolated to its branch
- SM review acts as final gate before QA commit and merge to main branch
- If SM requests changes, workflow returns to fix loop (Step 5) on feature branch
- Report generation preserves complete audit trail
- Self-healing loop has safety limit to prevent infinite iterations
- All file modifications are tracked in change log and committed to feature branch
- Progress reports created during implementation phase on feature branch
- QA reports created after final validation and SM approval on feature branch

---

**Task Completion Indicator:**
When this task completes, you will receive:
1. Implementation summary from Dev agent
2. **Completion validation results** (100% confirmation - NEW in v3.0)
3. Final QA status (PASSED/FAILED)
4. **Acceptance criteria validation report** (NEW in v3.0)
5. Scrum Master review and approval status
6. Path to progress report (from implementation on feature branch)
7. Path to QA report (from testing on feature branch)
8. **QA validation commit hash on feature branch** (v3.2 - NEW)
9. **Merge commit hash on main branch** (v3.2 - NEW)
10. **Status update commit hash on main branch** (v3.3 - NEW)
11. **Sprint plan update confirmation** (v3.3 - NEW)
12. **Story file update confirmation** (v3.3 - NEW)
13. **Completion tracking JSON path** (v3.3 - NEW)
14. **Sprint dashboard update confirmation** (v3.3 - NEW)
15. Summary of fix iterations and issues resolved
16. Feature branch merge status
17. **Test coverage metrics for new code** (NEW in v3.0)
18. **Feature branch name and commit count** (v3.2 - NEW)

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

**Version:** 3.1
**Last Updated:** 2025-10-11
**Breaking Changes:** Yes (completion enforcement + component architecture enforcement)
**Upgrade Required:** Immediate (no partial merges allowed)

---

## Version 3.1 Changes (Component Architecture Enforcement)

### What's New in v3.1

**Added: Component Architecture Validation (Step 4.6)**

v3.1 adds mandatory validation of component architecture decisions to ensure consistency and prevent duplicate implementations.

**Problem Solved:**
- Dev agents might create custom table components instead of using enhanced DataTable
- Inconsistent feature usage across similar table implementations
- Missing or incorrect prop configurations
- Not following approved component architecture decisions

**Solution:**
- Pre-implementation component check detects table requirements
- Dev agent receives explicit DataTable usage instructions
- Component architecture validation step (4.6) before AC validation
- Feature matrix verification against approved configurations
- Render functions usage validation
- Props configuration validation
- Component validation report generation

### Component Architecture Requirements

**For Epic 9 Stories (Table Components):**

When implementing Epic 9 stories (9.1-9.17) or ANY story involving tabular data:

1. **MUST use enhanced DataTable component**
   - Location: `web/components/shared/DataTable.tsx`
   - No custom table components allowed (except Calendar for 9.9a, 9.13)

2. **MUST follow approved feature matrix**
   - Only enable features approved for specific story type
   - Feature matrix documented in: `docs/components/REUSABLE-COMPONENTS-REQUIREMENTS.md`

3. **MUST use common render functions**
   - `renderFunctions.date()` for dates
   - `renderFunctions.currency()` for currency
   - `renderFunctions.percentWithColor()` for percentages
   - `renderFunctions.number()` for numbers

4. **MUST provide required configuration objects**
   - `yearFilterConfig` when `enableYearFilter=true`
   - `paginationConfig` when `enablePagination=true`
   - `columnSearchConfig` when `enableColumnSearch=true`

5. **MUST follow column definition best practices**
   - Required fields: `key`, `header`
   - Numeric columns: `align='right'`
   - Searchable columns: should have `render` function

### Component Validation Workflow

**Step 2: Pre-Implementation Check**
```
Story Extracted → Check if involves tables → Load component docs → Include in Dev prompt
```

**Step 4.6: Component Architecture Validation**
```
If table components:
  → Check DataTable usage
  → Validate feature configuration
  → Verify render functions
  → Check props configuration
  → Validate column definitions
  → Generate validation report
  → HALT if violations found
```

**Step 5: Fix Loop (if violations)**
```
Component violations → Dev agent fixes → Re-validate → Continue or HALT
```

### Feature Matrix Reference (Epic 9)

| Story | Type | Sorting | Search | Year | Pagination | Minimize |
|-------|------|---------|--------|------|------------|----------|
| 9.1-9.3 | Home tables | ✅ | ❌ | ❌ | ❌ | ❌ |
| 9.15-9.16 | Landing sections | ✅ | ❌ | ❌ | ❌ | ❌ |
| 9.15-9.16 | Landing detailed | ✅ | ✅ | ✅ | ❌ | ✅ |
| 9.17 | IPO Listings | ✅ | ❌ | ✅ | ✅ | ❌ |
| 9.7a, 9.11 | Performance | ✅ | ❌ | ✅ | ✅ | ❌ |
| 9.8a, 9.12 | Prospectus | ✅ | ✅ | ✅ | ✅ | ❌ |
| 9.10a, 9.14 | Reviews | ✅ | ✅ | ✅ | ✅ | ❌ |
| 9.4-9.6 | Rights/OFS/NCD | ✅ | ✅ | ✅ | ✅ | ❌ |

### Required Documentation Files

**Component Architecture:**
1. `docs/components/REUSABLE-COMPONENTS-REQUIREMENTS.md` - Component specs and architecture decision
2. `docs/components/DATATABLE-USAGE-EXAMPLES.md` - Practical usage examples for all scenarios
3. `docs/components/TABLE-COMPONENT-USAGE-PATTERNS.md` - Pattern guidance for different layouts

**Implementation Reference:**
- `web/components/shared/DataTable.tsx` - Enhanced component implementation

**Generated Reports:**
- `docs/stories/qa-reports/story-{id}-component-validation.md` - Component validation results

### Exit Conditions Updated (v3.1)

**Added to exit conditions:**

✓ **Component Architecture Compliance** (NEW in v3.1)
- **For table components:** DataTable component used (no custom tables)
- **Feature configuration:** Matches approved matrix for story type
- **Render functions:** Common utilities used for formatting
- **Props configuration:** Required configs provided for enabled features
- **Column definitions:** Follow best practices (key, header, alignment)
- **Component validation report:** Generated and PASS status

### Workflow Failures Updated (v3.1)

**Added failure condition:**

❌ **Component Architecture Violations (Step 4.6)**
- Custom table components created (not using DataTable)
- Features enabled not matching approved matrix
- Missing required configuration objects
- Column definitions missing required fields

### Upgrade Notes (v3.0 → v3.1)

**Changes for Epic 9 Implementation:**

1. **Dev agents MUST:**
   - Read component documentation before implementing
   - Use DataTable component (no custom tables)
   - Follow approved feature matrix
   - Use common render functions
   - Provide required configuration objects

2. **QA agents MUST:**
   - Run component architecture validation (Step 4.6)
   - Generate component validation report
   - HALT workflow on component violations
   - Verify feature configuration matches matrix

3. **SM agents MUST:**
   - Review component validation report
   - Confirm component architecture compliance
   - Reject approvals with component violations

**Backward Compatibility:**
- v3.1 is backward compatible with v3.0 for non-table stories
- Epic 9 stories REQUIRE v3.1 component validation
- Existing table implementations should be audited

### Best Practices for v3.1

**For Epic 9 Implementation:**

1. **Always start with documentation:**
   ```bash
   # Read these files before implementing any Epic 9 story
   docs/components/REUSABLE-COMPONENTS-REQUIREMENTS.md
   docs/components/DATATABLE-USAGE-EXAMPLES.md
   docs/components/TABLE-COMPONENT-USAGE-PATTERNS.md
   ```

2. **Use the feature matrix:**
   - Find your story type in the matrix
   - Enable ONLY the features listed for that type
   - Don't enable extra features "just in case"

3. **Copy from examples:**
   - DATATABLE-USAGE-EXAMPLES.md has examples for all Epic 9 scenarios
   - Copy the example closest to your story
   - Modify the columns and data, keep the feature configuration

4. **Test component features:**
   - Test sorting on all sortable columns
   - Test column search on all searchable columns (if enabled)
   - Test year filter with different years (if enabled)
   - Test pagination navigation (if enabled)
   - Test minimize/maximize toggle (if enabled)

### Migration Guide (v3.0 → v3.1)

**If implementing Epic 9 stories:**

1. **Update workflow file:**
   - Replace automated-dev-qa-sm-workflow-new.md with v3.1
   - Includes component architecture validation

2. **Read component documentation:**
   - Required reading before any Epic 9 implementation
   - Ensures compliance from the start

3. **Run component validation:**
   - New Step 4.6 runs automatically for table components
   - Generates validation report

**If using v3.0 workflow:**
- Non-Epic-9 stories: Continue using v3.0 (no changes needed)
- Epic 9 stories: MUST upgrade to v3.1 for component validation
- Mixed sprint: Use v3.1 for all stories (backward compatible)

---

---

## Version 3.2 Changes (Git Branch Isolation & Parallel Development)

### What's New in v3.2

**Added: Complete Feature Branch Isolation**

v3.2 fundamentally changes the git workflow to enforce proper feature branch isolation and support parallel story development.

**Problem Solved:**
- Commits were happening on main after merge (v3.1 and earlier)
- No clear separation between implementation and merge commits
- Parallel story work could interfere with each other
- No explicit feature branch creation/verification step
- Difficult to track complete feature history

**Solution:**
- **Step 1:** Mandatory feature branch creation/verification
- **Steps 2-6:** All work (implementation, testing, fixes) on feature branch with commits
- **Step 7:** Final validation on feature branch
- **Step 8:** QA validation commit on feature branch (NEW step)
- **Step 9:** Merge to main with merge commit ONLY (no new work commits on main)
- Branch isolation checks throughout workflow
- Parallel branch awareness

### Git Workflow Changes (v3.1 → v3.2)

**v3.1 Git Flow (OLD - Problematic):**
```
1. Create feature branch
2. Implement on feature branch (no commits mentioned)
3-6. Tests and fixes (no git guidance)
7. Merge feature → main
8. Final validation on main
9. Commit QA validation on main ❌ WRONG
10. Push main
```

**v3.2 Git Flow (NEW - Best Practice):**
```
1. Create/verify feature branch + isolation check ✅
2. Implement on feature branch + commit regularly ✅
3-6. Tests and fixes on feature branch + commit fixes ✅
7. Final validation on feature branch ✅
8. QA validation commit on feature branch ✅
9. Merge feature → main (merge commit only) ✅
10. Push main ✅
```

### Key Differences

| Aspect | v3.1 (OLD) | v3.2 (NEW) |
|--------|------------|------------|
| **Branch Creation** | Mentioned, not enforced | Step 1 - enforced with verification |
| **Implementation Commits** | "Do NOT commit" | Commit on feature branch during work |
| **Fix Commits** | "Do NOT commit" | Commit fixes on feature branch |
| **QA Validation Commit** | On main after merge ❌ | On feature branch before merge ✅ |
| **Main Branch** | Receives work commits | Receives merge commit ONLY |
| **Parallel Development** | Not addressed | Explicitly supported |
| **Branch Isolation** | Not enforced | Checked at multiple steps |
| **Git History** | Mixed commits on main | Clean: all work on feature, merges on main |

### Step-by-Step Changes

**Step 1 - Story Extraction (NEW in v3.2):**
- Added: Feature branch creation/verification script
- Added: Branch isolation verification
- Added: Parallel branch awareness check

**Step 2 - Story Implementation (UPDATED in v3.2):**
- Changed: "Do NOT commit" → "Commit implementation work to feature branch"
- Added: "Push feature branch to remote regularly"
- Added: CRITICAL warnings about branch isolation
- Added: Assumption that parallel branches exist

**Step 3 - Initial Verification (UPDATED in v3.2):**
- Added: Branch isolation check script
- Added: Verify NO commits on main branch
- Added: Verify all changes committed to feature branch
- Changed: Validation now checks feature branch commits specifically

**Step 4 - Comprehensive Testing (UPDATED in v3.2):**
- Added: Branch context warnings (tests run on feature branch only)
- Added: Parallel branch isolation reminders

**Step 5 - Automated Fix Loop (UPDATED in v3.2):**
- Changed: "Do NOT commit" → "Commit fixes to feature branch after verification"
- Added: CRITICAL warnings about staying on feature branch

**Step 6 - Scrum Master Review (No changes in v3.2):**
- Same as v3.1

**Step 7 - Final Validation (MOVED from Step 8, UPDATED in v3.2):**
- Moved from after merge to before merge
- Now happens on feature branch
- Added: Branch isolation checks
- Added: Git state validation

**Step 8 - QA Validation Commit (NEW in v3.2):**
- **Completely new step**
- Creates QA validation commit on feature branch
- Last commit before merge
- Contains final QA sign-off
- Pushed to remote before merge

**Step 9 - Merge to Main (COMPLETELY REWRITTEN in v3.2):**
- Changed: From "commit on main after merge" to "merge only"
- Added: Comprehensive merge script with conflict detection
- Added: Verification that QA commit exists on feature branch
- Added: Merge commit message includes all validation info
- Main branch now receives only merge commit (no work commits)

**Step 10 - QA Report Generation (No structural changes):**
- Same as v3.1

### Branch Isolation Philosophy

**v3.2 Philosophy:**
> "Feature branches contain all work commits. Main branch receives only merge commits of validated features."

**v3.1 Philosophy (deprecated):**
> "Feature branches for development. Main can receive direct commits after merge."

**Why This Matters:**
- **Clean History:** Main branch history shows only complete features
- **Easy Rollback:** Revert merge commit to remove entire feature
- **Parallel Work:** Multiple teams can work simultaneously without interference
- **CI/CD Friendly:** Feature branches can be tested independently
- **Code Review:** Complete feature history available on one branch

### Parallel Development Support

**v3.2 explicitly supports parallel story development:**

```
Repository State During Sprint:
├── main (protected - merge commits only)
├── feature/story-9.9a (Team A working)
├── feature/story-9.10a (Team B working)
├── feature/story-9.11 (Team C working)
└── feature/story-9.12 (Team D working)

Each team:
- Works independently on their feature branch
- Commits regularly to their branch
- Tests on their branch
- Merges to main when QA approved
- Never interferes with other teams
```

**Isolation Guarantees:**
1. Each story has its own feature branch
2. All commits stay on feature branch until merge
3. Merge conflicts detected before merge
4. Main branch always deployable (only receives validated features)
5. Other feature branches never touched by your workflow

### Exit Conditions Updated (v3.2)

**Added to exit conditions:**

✓ **Proper Git Workflow** (NEW in v3.2)
- **Feature branch created/verified:** feature/story-{story_id} exists
- **All implementation commits on feature branch:** No work commits on main
- **QA validation commit on feature branch:** Final commit before merge
- **Merge commit on main:** Single merge commit that brings in feature
- **Feature branch history preserved:** All commits visible in git log
- **Main branch clean:** Only merge commits, no direct work commits
- **Parallel branches unaffected:** Other feature branches untouched

### Workflow Failures Updated (v3.2)

**Added failure conditions:**

❌ **Git Branch Violations (Multiple Steps)**
- Workflow not on feature branch when expected
- Commits made directly on main branch
- Feature branch not created/verified (Step 1)
- QA validation commit missing on feature branch (Step 9)
- Merge conflicts detected (Step 9)

### Migration Guide (v3.1 → v3.2)

**If you have v3.1 workflows in progress:**

1. **Stories currently in development:**
   - If no commits yet: Start with v3.2 (proper branch creation)
   - If commits exist: Continue on v3.1, upgrade for next story
   - **Do NOT retrofit v3.2 to in-progress v3.1 stories**

2. **Commit history differences:**
   - v3.1: Work commits might be on main
   - v3.2: Work commits only on feature branches
   - This is normal - no action needed for old stories

3. **New stories (use v3.2):**
   ```bash
   # Workflow automatically handles:
   - Feature branch creation/verification (Step 1)
   - Commits on feature branch (Steps 2-6)
   - QA commit on feature branch (Step 8)
   - Merge to main (Step 9)
   ```

4. **Parallel development:**
   - v3.2 fully supports multiple teams working simultaneously
   - Each story isolated to its feature branch
   - No interference between stories
   - Main branch stays clean and deployable

### Best Practices for v3.2

**For Dev Agents:**
- Always commit your work on feature branch (don't wait for QA)
- Commit frequently with meaningful messages
- Never switch to main branch during implementation
- Assume other feature branches exist - stay isolated
- Push feature branch regularly for backup

**For QA Agents:**
- Verify feature branch exists (Step 1)
- Run all tests on feature branch (Step 4)
- Create QA validation commit on feature branch (Step 8)
- Merge to main only after QA commit (Step 9)
- Never commit directly on main

**For All Agents:**
- Feature branch = all work commits
- Main branch = merge commits only
- Parallel stories = ignore other branches
- Clean history = easier debugging and rollback

### Upgrade Requirements

**Immediate Upgrade Required:**
- All new stories MUST use v3.2 workflow
- v3.2 is NOT backward compatible with v3.1 git workflow
- Running v3.1 workflow will create commits on main (anti-pattern)

**Backward Compatibility:**
- Story implementation logic: 100% compatible
- QA testing logic: 100% compatible
- SM review logic: 100% compatible
- Git workflow: NOT compatible (fundamentally different)

### Verification Commands

**Check if story followed v3.2 workflow:**

```bash
# 1. Check feature branch exists
git branch -a | grep "feature/story-{story_id}"

# 2. Count commits on feature branch
git log main..feature/story-{story_id} --oneline | wc -l
# Should show multiple commits (implementation + QA)

# 3. Check last commit on feature branch is QA validation
git log feature/story-{story_id} -1 --pretty=%B | grep "QA validation passed"

# 4. Check main only has merge commit
git log main -1 --pretty=%B | grep "Merge feature/story-{story_id}"

# 5. Verify no direct commits on main for this story
git log main --all --grep="story-{story_id}" --oneline | grep -v "Merge"
# Should return nothing or only merge commits
```

**Expected Output (v3.2 Compliant):**
```
✅ Feature branch exists: feature/story-9.9a
✅ Feature branch has 12 commits
✅ Last feature commit: "test(story-9.9a): QA validation passed"
✅ Main has merge commit: "Merge feature/story-9.9a: ..."
✅ No direct work commits on main for story-9.9a
```

---

**Version:** 3.3
**Last Updated:** 2025-10-16
**Breaking Changes:** No (additive changes to v3.2 - fully backward compatible)
**Upgrade Required:** Optional (recommended for improved conflict handling and branch management)
**Backward Compatible:** Yes (v3.3 is fully compatible with v3.2 workflows)
