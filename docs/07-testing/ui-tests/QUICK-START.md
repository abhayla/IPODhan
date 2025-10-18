# Quick Start: Dashboard Testing & Fixing Workflow

## 🚀 Execute Complete Workflow (One Command)

```
"Execute dashboard testing workflow from docs/ui-test/dashboard-testing-workflow.md,
spawn agents to fix issues found, verify fixes, and generate final report"
```

---

## 📋 Step-by-Step Execution

### Step 1: Run All Dashboard Tests (15-20 min)
```
"Execute all 18 dashboard test cases from dashboard-testing-workflow.md.
Take screenshots for each test and document issues found."
```

**What Happens:**
- Browser navigates through dashboard features
- 18 test cases executed automatically
- Screenshots saved to `.playwright-mcp/dashboard/`
- Issues documented with severity ratings

---

### Step 2: Review Issues Found (2 min)
```
"Show me all issues found during dashboard testing, organized by severity"
```

**Output:**
- List of Critical issues (P0)
- List of High severity issues (P1)
- List of Medium severity issues (P2)
- List of Low severity issues (P3)

---

### Step 3: Fix Critical & High Issues (30-60 min)
```
"Spawn agents to fix all critical and high severity dashboard issues.
Use agent-spawning-plan.md for task definitions."
```

**What Happens:**
- Agents spawned for each critical/high issue
- Code changes implemented
- Initial verification performed
- Fix status reported

---

### Step 4: Verify All Fixes (10-15 min)
```
"Re-run test cases for all fixed issues and verify they are resolved.
Run regression tests to ensure no new issues introduced."
```

**What Happens:**
- Failed test cases re-executed
- Before/after screenshots compared
- Regression suite run
- Verification status updated

---

### Step 5: Generate Final Report (2 min)
```
"Generate final dashboard testing report with test results, issues found,
fixes applied, and verification status. Save to docs/ui-test/dashboard-final-report.md"
```

**Output:**
- Executive summary
- Test coverage metrics
- Issues found and fixed
- Screenshots gallery
- Recommendations

---

## 🎯 Individual Test Commands

### Test Specific Features

**Test View Toggle:**
```
"Run TC-002 and TC-003 from dashboard workflow (Grid/List view toggle)"
```

**Test Search:**
```
"Run TC-004 from dashboard workflow (Search functionality with various inputs)"
```

**Test Filters:**
```
"Run TC-005, TC-006, TC-007, TC-008 from dashboard workflow (All filter tests)"
```

**Test Pagination:**
```
"Run TC-010, TC-011, TC-012 from dashboard workflow (Pagination tests)"
```

**Test Responsive:**
```
"Run TC-016, TC-017, TC-018 from dashboard workflow (Mobile, Tablet, Desktop)"
```

---

## 🐛 Fix Specific Issues

### Known Issue: View Toggle Blocked (DASH-001)
```
"Spawn agent to fix DASH-001 using Task 1 from agent-spawning-plan.md"
```

### Custom Issue Fix
```
"Spawn agent to fix [issue description]. Files: [files], Test Case: [TC-XXX]"
```

---

## 📊 Status Checks

### Check Testing Progress
```
"Show current dashboard testing progress and status"
```

### Check Agent Status
```
"Show status of all agents working on dashboard issues"
```

### Check Verification Status
```
"Show verification status for all fixed issues"
```

---

## 🎨 Screenshot Commands

### Take Dashboard Screenshots
```
"Take full-page screenshot of dashboard in current state"
```

### Take Responsive Screenshots
```
"Take screenshots of dashboard at 375px, 768px, and 1920px widths"
```

### Compare Before/After
```
"Show before and after screenshots for [feature/fix]"
```

---

## ⚡ Quick Actions

### Retry Failed Test
```
"Re-run test case TC-XXX with new screenshots"
```

### Fix and Verify
```
"Fix issue DASH-XXX and immediately verify with test case TC-XXX"
```

### Skip to Report
```
"Generate report with current test results and known issues"
```

---

## 📁 File Locations

**Workflow Definition:**
`docs/ui-test/dashboard-testing-workflow.md`

**Agent Plans:**
`docs/ui-test/agent-spawning-plan.md`

**Test Results (Generated):**
`docs/ui-test/dashboard-test-results.md`

**Issues Log (Generated):**
`docs/ui-test/dashboard-issues.md`

**Final Report (Generated):**
`docs/ui-test/dashboard-final-report.md`

**Screenshots:**
`.playwright-mcp/dashboard/`

---

## ✅ Success Indicators

### Testing Phase Complete:
- ✅ 18/18 test cases executed
- ✅ All screenshots captured
- ✅ All issues documented

### Fixing Phase Complete:
- ✅ 0 Critical issues remaining
- ✅ 0 High issues remaining
- ✅ Agents completed tasks

### Verification Phase Complete:
- ✅ All fixes verified
- ✅ No regressions found
- ✅ All test cases passing

### Workflow Complete:
- ✅ Final report generated
- ✅ All documentation updated
- ✅ Ready for production

---

## 🚨 If Something Goes Wrong

### Test Fails to Run
```
"Check browser status and app server, restart if needed"
```

### Agent Fails
```
"Show agent error logs and retry with more context"
```

### Can't Verify Fix
```
"Take new screenshot and compare manually with [before-screenshot]"
```

### Browser Closed Accidentally
```
"Reopen browser and navigate to dashboard, resume testing from TC-XXX"
```

---

## 💡 Pro Tips

1. **Keep browser visible** - Watch tests execute in real-time
2. **Check screenshots** - Visual verification is powerful
3. **Fix P0/P1 first** - Critical issues block everything
4. **Run regression** - After fixes, test related features
5. **Document edge cases** - Found during testing, add as test cases

---

## 🎯 Current Status

✅ **Workflow Created** - 18 test cases defined
✅ **Agent Plan Ready** - 5 fix strategies defined
✅ **Browser Open** - At dashboard page
✅ **Ready to Execute** - All prerequisites met

---

## 🚀 START NOW

**Copy and paste this command:**

```
Execute dashboard testing workflow from docs/ui-test/dashboard-testing-workflow.md
```

**Estimated completion time:** 60-100 minutes

**What you'll get:**
- Comprehensive test coverage
- All issues documented
- Critical issues fixed
- Professional test report

---

**Questions? Check:**
- Full workflow: `dashboard-testing-workflow.md`
- Agent plans: `agent-spawning-plan.md`
- Directory info: `README.md`
