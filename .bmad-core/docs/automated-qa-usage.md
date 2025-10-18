# Automated QA Workflow - Usage Guide

## Overview

The Automated QA Workflow provides comprehensive testing with self-healing capabilities. When issues are found, it automatically spawns the Dev agent to fix them, then re-runs tests until everything passes.

## Quick Start

### 1. Activate QA Agent

```bash
/qa
```

### 2. Run Automated QA for a Story

```bash
*auto-qa 1.3
```

This will:
- ✅ Load Story 1.3 from sprint plan
- ✅ Run all tests (lint, unit, e2e, build)
- ✅ If issues found: Auto-spawn Dev agent to fix
- ✅ Re-test until all pass
- ✅ Commit with QA validation
- ✅ Generate comprehensive QA report

## What the Workflow Does

### Step-by-Step Process

1. **Story Extraction**
   - Reads story from `docs/stories/SPRINT-N-PLAN.md`
   - Loads all acceptance criteria
   - Prepares test context

2. **Initial Verification**
   - Verifies on main branch
   - Checks story was merged
   - Reviews commit history

3. **Comprehensive Testing**
   - Linting (`npm run lint`)
   - Type checking (`tsc --noEmit`)
   - Unit tests (`npm run test:unit`)
   - E2E tests (`npm run test:e2e`)
   - Build verification (`npm run build`)
   - Acceptance criteria validation

4. **Automated Fix Loop** (if issues found)
   ```
   WHILE (issues exist):
     a. Document all issues with:
        - Description & severity
        - Steps to reproduce
        - Expected vs actual behavior
        - Affected files

     b. Spawn Dev Agent:
        "Fix issues in Story X.Y:
        [Detailed issue list]

        Requirements:
        - Fix all issues
        - Maintain functionality
        - Update tests
        - Do NOT commit"

     c. Wait for Dev Agent completion

     d. Re-run full test suite

     e. If new issues: add to list, continue
        If all pass: exit loop
   ```

5. **Final Validation**
   - ✅ All acceptance criteria met
   - ✅ Test coverage ≥ 80%
   - ✅ Code quality standards
   - ✅ Documentation complete

6. **Git Commit** (only if zero issues)
   ```bash
   test(story-X.Y): QA validation passed

   - All acceptance criteria verified
   - Test coverage: XX%
   - Zero defects found
   - Ready for production

   Story: X.Y
   QA Status: ✓ Passed
   Iterations: N
   ```

7. **QA Report Generation**
   - Saved to: `docs/06-qa-reports/sprint-reports/story-X.Y-qa-report.md`
   - Includes: test results, coverage, iterations, timeline

## Exit Conditions

Workflow completes when ALL true:
- ✅ All tests passing
- ✅ All acceptance criteria met
- ✅ Zero critical/high severity issues
- ✅ Code committed to main branch
- ✅ QA report generated

## Error Handling

### Fix Loop Limit Exceeded
- **Trigger:** Same issues after 3 iterations
- **Action:** HALT, escalate to user with details

### Dev Agent Failure
- **Trigger:** Dev agent fails to complete
- **Action:** HALT, report with agent logs

### New Failures After Fixes
- **Trigger:** Fixes introduce new issues
- **Action:** Add to issue list, continue (unless limit hit)

### Git Operations Failure
- **Trigger:** Commit/push fails
- **Action:** Generate report, preserve changes, manual resolution

## Example Usage

### Test Story 1.3

```bash
# Activate QA agent
/qa

# User is greeted by Quinn
# Quinn shows available commands

# Run automated QA
*auto-qa 1.3
```

**Expected Output:**
```
🧪 Starting Automated QA Workflow for Story 1.3...

1. ✅ Story Extraction Complete
   - Loaded from docs/stories/SPRINT-1-PLAN.md
   - Found 4 acceptance criteria

2. ✅ Initial Verification Complete
   - On main branch
   - Story commits found: 2979c23, 9e3550f

3. 🔍 Running Comprehensive Tests...
   - Lint: ✅ PASSED
   - Type Check: ✅ PASSED
   - Unit Tests: ✅ 3/3 PASSED
   - E2E Tests: ⚠️ 2/9 FAILED
   - Build: ✅ PASSED

4. 🔧 Issues Found - Starting Fix Loop (Iteration 1)

   Issue #1: Homepage navigation test fails
   - Severity: High
   - Steps: Navigate to /, click nav link
   - Expected: Route change
   - Actual: 404 error

   📤 Spawning Dev Agent with fix request...

   ⏳ Waiting for Dev Agent completion...

   ✅ Dev Agent completed fixes
   - Fixed routing in app/page.tsx
   - Updated navigation component

   🔄 Re-running test suite...
   - Lint: ✅ PASSED
   - Unit Tests: ✅ 3/3 PASSED
   - E2E Tests: ✅ 9/9 PASSED
   - Build: ✅ PASSED

5. ✅ Final Validation Complete
   - All acceptance criteria: ✅ VERIFIED
   - Test coverage: 87%
   - Code quality: ✅ PASSED

6. 📝 Creating Git Commit...
   ✅ Commit created: abc1234
   ✅ Pushed to origin/main

7. 📊 QA Report Generated
   - Path: docs/06-qa-reports/sprint-reports/story-1.3-qa-report.md

✅ AUTOMATED QA COMPLETE
- Status: PASSED
- Fix Iterations: 1
- Total Time: 3m 47s
- Recommendation: APPROVED FOR PRODUCTION
```

## Advanced Usage

### Custom Story Location

If story is in a different file:

```bash
*auto-qa 2.1 sprint_plan=docs/stories/SPRINT-2-PLAN.md
```

### Skip Specific Tests (Not Recommended)

The workflow runs all tests by design. If you need custom testing:

```bash
# Use standard QA review instead
*review 1.3
```

## Integration with BMAD Agents

### QA Agent (Quinn)
- **Role:** Executes automated QA workflow
- **Commands:** `*auto-qa {story}`
- **File:** `.claude/commands/BMad/agents/qa.md`

### Dev Agent (James)
- **Role:** Auto-spawned to fix issues
- **Triggered:** When QA finds defects
- **File:** `.claude/commands/BMad/agents/dev.md`

### Task File
- **Location:** `.bmad-core/tasks/automated-qa-workflow.md`
- **Type:** Executable workflow
- **Loaded:** When `*auto-qa` command runs

## Success Metrics

| Metric | Target | Measured By |
|--------|--------|-------------|
| Test Pass Rate | 100% | All tests green |
| Fix Iterations | ≤ 3 | Dev agent spawns |
| Coverage | ≥ 80% | Unit test coverage |
| Quality Gates | All Pass | Lint, type, build |
| Time | Context-dependent | Total duration |

## Troubleshooting

### Workflow Won't Start
- **Check:** QA agent activated (`/qa`)
- **Check:** Story exists in sprint plan
- **Check:** On main branch

### Fix Loop Never Exits
- **Reason:** Same issues after 3 iterations
- **Solution:** Workflow will HALT and escalate
- **Next Steps:** Manual review required

### Dev Agent Doesn't Fix Issues
- **Check:** Dev agent logs in workflow output
- **Check:** Issue description clarity
- **Solution:** Workflow will HALT, preserve context

### Report Not Generated
- **Check:** `docs/06-qa-reports/sprint-reports/` exists
- **Check:** File permissions
- **Fallback:** Workflow outputs report content to console

## Best Practices

1. **Always run on main branch** - Ensures story is merged
2. **Review QA report** - Even when passing, check for insights
3. **Monitor fix iterations** - High count indicates complexity
4. **Trust the automation** - But verify critical paths manually
5. **Use for regression** - Run after any related changes

## Files Created/Modified

### Created by Workflow
- `docs/06-qa-reports/sprint-reports/story-{X.Y}-qa-report.md` - QA report

### Modified by Workflow
- Source files (via Dev agent fixes)
- Test files (via Dev agent)
- Git commit history (QA validation commit)

### Never Modified
- Story plan files (read-only)
- Configuration files (unless fix requires)
- Other stories (isolated)

## Command Reference

### QA Agent Commands

```bash
*help              # Show all commands
*auto-qa {story}   # Run automated QA workflow
*review {story}    # Manual QA review
*gate {story}      # Quality gate decision
*test-design       # Create test scenarios
*trace {story}     # Requirements traceability
*risk-profile      # Risk assessment
*nfr-assess        # Non-functional requirements
*exit              # Exit QA agent
```

## Related Documentation

- Dev Agent: `.claude/commands/BMad/agents/dev.md`
- QA Agent: `.claude/commands/BMad/agents/qa.md`
- Task File: `.bmad-core/tasks/automated-qa-workflow.md`
- Sprint Plans: `docs/stories/SPRINT-*-PLAN.md`
- QA Reports: `docs/06-qa-reports/sprint-reports/`

---

**Version:** 1.0
**Last Updated:** 2025-10-05
**Maintained By:** BMAD Framework
