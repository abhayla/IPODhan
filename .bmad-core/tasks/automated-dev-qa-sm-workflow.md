# Automated Story Implementation and QA Workflow

**Task ID:** automated-dev-qa-sm-workflow
**Version:** 2.0
**Agent:** QA (Quinn) & Dev (James)
**Elicit:** false

## Overview

Complete end-to-end workflow for story implementation and quality assurance with self-healing capabilities. This task orchestrates:
1. Story implementation by spawning Dev agent
2. Comprehensive QA testing
3. Automated fix loops when issues are found
4. Final validation and commit

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
Load and activate dev agent from D:\Abhay\VibeCoding\IPODhan\.claude\commands\BMad\agents\dev.md

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
- Reference Dev agent file: `D:\Abhay\VibeCoding\IPODhan\.claude\commands\BMad\agents\dev.md`

**Wait for Implementation:**
- Monitor Dev agent progress
- Review implementation approach
- Validate all requirements addressed

**Output:**
- Feature branch created
- Code implemented
- Tests written
- Progress report generated
- Ready for QA validation

---

### 3. Initial Verification

**Actions:**
- Verify feature branch exists: `feature/story-{story_id}`
- Confirm implementation commits present
- Review commit history for story-related changes
- Check implementation against acceptance criteria
- Verify progress report created

**Validation:**
- ✓ On feature branch
- ✓ Implementation commits found
- ✓ Code changes align with story requirements
- ✓ Progress report exists

---

### 4. Comprehensive Testing

**Execute all quality checks:**

#### 4.1 Linting
```bash
cd web && npm run lint
```

#### 4.2 Type Checking
```bash
cd web && npx tsc --noEmit
```

#### 4.3 Unit Tests
```bash
cd web && npm run test:unit
```

#### 4.4 E2E Tests
```bash
cd web && npm run test:e2e
```

#### 4.5 Build Verification
```bash
cd web && npm run build
```

#### 4.6 Acceptance Criteria Validation
- Manually verify each acceptance criterion from story
- Test edge cases specific to story requirements
- Verify error handling scenarios

**Document Results:**
- Record all test outputs
- Capture failure details
- Note performance metrics
- Identify regressions

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
Load and activate dev agent from D:\Abhay\VibeCoding\IPODhan\.claude\commands\BMad\agents\dev.md

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
- Reference Dev agent file: `D:\Abhay\VibeCoding\IPODhan\.claude\commands\BMad\agents\dev.md`

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
- If same issues persist after 3 iterations: HALT and escalate to user

**Loop Tracking:**
- Iteration count
- Issues fixed per iteration
- Issues remaining
- Time per iteration

**END WHILE**

---

### 6. Scrum Master Review

**Spawn Scrum Master Agent for Story Review:**

After all tests pass, request Scrum Master (Bob) review before merging to main.

Use the Task tool to spawn Scrum Master agent with prompt:

```
Load and activate scrum master agent from D:\Abhay\VibeCoding\IPODhan\.bmad-core\agents\sm.md

Then review Story {story_id} implementation:

**Story Details:**
{Full story details and acceptance criteria}

**Implementation Summary:**
{Dev agent implementation summary}

**QA Test Results:**
{QA test results summary including coverage, all test passes}

**Files Changed:**
{List of files created/modified}

Requirements:
- Review implementation against story requirements
- Verify all acceptance criteria are met
- Check that implementation aligns with sprint goals
- Validate documentation completeness
- Provide sign-off or request changes

Return detailed review with:
- Approval status (APPROVED / CHANGES REQUIRED)
- Comments on implementation quality
- Any concerns or recommendations
- Sign-off statement if approved
```

**Agent Configuration:**
- Use `general-purpose` subagent type
- Provide complete story context
- Include implementation and QA summaries
- Reference SM agent file: `D:\Abhay\VibeCoding\IPODhan\.bmad-core\agents\sm.md`

**Wait for Review:**
- Monitor SM agent review process
- If CHANGES REQUIRED: Document feedback and return to Step 5 (Fix Loop)
- If APPROVED: Proceed to merge

**Review Decision:**
- **APPROVED** → Continue to Step 7 (Merge to Main)
- **CHANGES REQUIRED** → Return to Step 5 with SM feedback as new issues

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

**File Location:** `docs/06-qa-reports/sprint-reports/story-{story_id}-qa-report.md`

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

## Exit Conditions

The workflow completes successfully when ALL of the following are true:

✓ **All tests passing**
- Lint: 0 errors, 0 warnings
- Type check: 0 errors
- Unit tests: 100% passing
- E2E tests: 100% passing
- Build: Success

✓ **All acceptance criteria met**
- Each criterion from story validated
- Edge cases tested
- Error scenarios verified

✓ **Zero critical/high severity issues**
- No blocking defects
- No high-priority bugs
- All issues resolved

✓ **Code committed to main branch**
- Commit created with proper format
- Pushed to remote successfully
- Branch synced

✓ **QA report generated**
- Report file created
- All sections completed
- Evidence documented

---

## Error Handling

### Fix Loop Limit Exceeded
**Condition:** Same issues persist after 3 fix iterations
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
| Fix Iterations | ≤ 3 | Number of dev agent spawns |
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
- File: `D:\Abhay\VibeCoding\IPODhan\.claude\commands\BMad\agents\dev.md`
- Used for: Story implementation and bug fixes
- Spawned via: Task tool with `general-purpose` subagent type

**QA Agent (Quinn - Test Architect):**
- File: `D:\Abhay\VibeCoding\IPODhan\.claude\commands\BMad\agents\qa.md`
- Used for: Test execution, validation, and orchestration
- Executes: This automated workflow task

**Scrum Master (Bob - Story Review Specialist):**
- File: `D:\Abhay\VibeCoding\IPODhan\.bmad-core\agents\sm.md`
- Used for: Story implementation review and sign-off
- Spawned via: Task tool with `general-purpose` subagent type

---

## Notes

- This task orchestrates implementation, QA, and SM review phases
- QA agent (Quinn) spawns Dev agent (James) for implementation and fixes
- QA agent spawns Scrum Master (Bob) for story review and sign-off
- Dev and SM agent spawning uses the Task tool with `general-purpose` subagent
- All git operations assume proper repository setup
- Test commands assume Next.js project structure in `web/` directory
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
2. Final QA status (PASSED/FAILED)
3. Scrum Master review and approval status
4. Path to progress report (from implementation)
5. Path to QA report (from testing)
6. Git commit hash (if committed)
7. Summary of fix iterations and issues resolved
8. Feature branch merge status
