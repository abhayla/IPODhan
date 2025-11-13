# Testing Session Prompt Template

**Purpose**: Copy and paste this prompt to start a new testing session with full context
**Usage**: Give this prompt to Claude Code at the start of each testing session

---

## 🎯 Testing Session Prompt

```
I want to continue UI testing for the IPODhan application using Playwright MCP in headed mode.

CONTEXT:
- Project: IPODhan (Indian IPO information platform)
- Tech Stack: Next.js 14.2.15 (LTS), React 18.3.1 (stable), TypeScript 5, Tailwind CSS 4
- Testing Approach: 60% Playwright MCP (headed mode), 30% Native Playwright, 10% Chrome DevTools MCP
- Current Status: Located in docs/07-testing/TESTING_STATUS_TRACKER.md
- Latest Session: Task 1.1 (IPO Detail Page Crash) - FIXED, Task 1.2 (React 19 Hydration) - DEPRIORITIZED
- Next Task: Task 1.3 (Homepage Console Errors - 22 errors, P1 priority)

DOCUMENTATION TO REFERENCE:
1. Testing Plan: docs/07-testing/COMPREHENSIVE_UI_TESTING_PLAN.md
2. MCP Workflows: docs/07-testing/PLAYWRIGHT_MCP_WORKFLOWS.md
3. Status Tracker: docs/07-testing/TESTING_STATUS_TRACKER.md
4. Strategy Summary: docs/07-testing/TESTING_STRATEGY_UPDATE_SUMMARY.md

TESTING SERVER:
- Development server running at: http://localhost:3000
- Check background bash processes for server status

REQUIREMENTS:
1. Read the current status from TESTING_STATUS_TRACKER.md
2. Continue from where we left off
3. Use Playwright MCP in headed mode for visual verification
4. Update TESTING_STATUS_TRACKER.md in real-time as we progress
5. Document findings with screenshots
6. Follow the workflows in PLAYWRIGHT_MCP_WORKFLOWS.md

TASK:
[Specify what you want to test, or ask Claude to suggest next steps based on status tracker]

Examples:
- "Start Phase 1: Investigate Dashboard crash"
- "Continue Phase 2: Create visual regression baselines"
- "Test the IPO Detail page for all tabs"
- "Verify mobile responsiveness on homepage"
- "What should we test next based on current progress?"
```

---

## 📋 Quick Prompts for Common Tasks

### Start New Phase
```
Read docs/07-testing/TESTING_STATUS_TRACKER.md and start [Phase X: Name] from the comprehensive testing plan. Use Playwright MCP in headed mode and update the status tracker as we progress.
```

### Continue Previous Work
```
Read docs/07-testing/TESTING_STATUS_TRACKER.md and continue testing from where we left off. Use Playwright MCP in headed mode.
```

### Bug Investigation
```
Use Playwright MCP in headed mode to investigate the [bug/issue description]. Navigate to [URL], capture console errors, take screenshots, and document findings in TESTING_STATUS_TRACKER.md.
```

### Visual Regression Baseline
```
Create visual regression baselines for [page name] using Playwright MCP. Follow the workflow in PLAYWRIGHT_MCP_WORKFLOWS.md section "Visual Regression Testing Pattern". Save screenshots and update TESTING_STATUS_TRACKER.md.
```

### Mobile Testing
```
Test [page name] on mobile viewports (375px, 768px, 1920px) using Playwright MCP. Resize browser, capture screenshots for each viewport, and update TESTING_STATUS_TRACKER.md.
```

### Accessibility Check
```
Verify accessibility of [page name] using Playwright MCP browser_snapshot. Check ARIA labels, keyboard navigation, and document findings in TESTING_STATUS_TRACKER.md.
```

---

## 🎓 Session Workflow

### 1. Start Session
```
1. Give Claude the main prompt above
2. Claude reads TESTING_STATUS_TRACKER.md
3. Claude suggests next steps or continues previous work
```

### 2. During Session
```
1. Claude uses Playwright MCP for testing
2. Claude updates TESTING_STATUS_TRACKER.md after each task
3. Claude creates screenshots in web/test-results/screenshots/
4. Claude documents findings in real-time
```

### 3. End Session
```
1. Claude summarizes what was accomplished
2. Claude updates TESTING_STATUS_TRACKER.md with final status
3. Claude suggests next session priorities
4. All progress is saved for next session
```

---

## 📊 Status Tracking Commands

### Check Current Status
```
Read docs/07-testing/TESTING_STATUS_TRACKER.md and summarize current testing progress.
```

### Update Status
```
Update docs/07-testing/TESTING_STATUS_TRACKER.md to mark [task/phase] as [status]. Add notes: [your notes].
```

### Generate Progress Report
```
Generate a progress report based on docs/07-testing/TESTING_STATUS_TRACKER.md. Show completed tasks, in-progress items, and blockers.
```

---

## 🚀 Quick Start Examples

### Example 1: First Time Testing
```
I want to start UI testing for IPODhan. Read docs/07-testing/TESTING_STATUS_TRACKER.md to see current status, then begin Phase 1: Bug Fixes using Playwright MCP in headed mode. Follow docs/07-testing/COMPREHENSIVE_UI_TESTING_PLAN.md and update the status tracker as we progress.
```

### Example 2: Continue from Previous Session (Current State)
```
Continue IPODhan UI testing from Session 2.

COMPLETED IN PREVIOUS SESSION:
- ✅ Task 1.1: Fixed IPO Detail Page crash (Next.js 14.2.15 + React 18.3.1)
- ✅ Task 1.2: Deprioritized (React 19 no longer used)

NEXT TASK:
- Task 1.3: Homepage Console Error Investigation (22 errors - P1 priority)

Read docs/07-testing/TESTING_STATUS_TRACKER.md to see full status, then proceed with Task 1.3 using Playwright MCP in headed mode. Update status tracker in real-time.
```

### Example 3: Specific Feature Testing
```
Test the Dashboard page (/dashboard) using Playwright MCP:
1. Navigate to page
2. Check for console errors
3. Test filters and search
4. Create visual regression baseline
5. Test mobile responsiveness
6. Document findings in TESTING_STATUS_TRACKER.md
Reference: docs/07-testing/PLAYWRIGHT_MCP_WORKFLOWS.md
```

---

## 🎯 Session Goals Template

For each session, define clear goals:

```
SESSION GOALS:
- [ ] Task 1: [Description]
- [ ] Task 2: [Description]
- [ ] Task 3: [Description]

SUCCESS CRITERIA:
- All tasks completed
- Screenshots captured
- Status tracker updated
- No blocking issues

DOCUMENTATION:
- Update: docs/07-testing/TESTING_STATUS_TRACKER.md
- Screenshots: web/test-results/screenshots/
- Findings: Documented in status tracker
```

---

## 💡 Tips for Effective Sessions

### 1. Always Start with Status Check
```
Read docs/07-testing/TESTING_STATUS_TRACKER.md first
```

### 2. Use Headed Mode for Visual Verification
```
Playwright MCP runs in headed mode by default - you'll see the browser
```

### 3. Take Screenshots Liberally
```
Document everything visually - screenshots are proof of testing
```

### 4. Update Status in Real-Time
```
Don't wait until end of session - update after each task
```

### 5. Document Blockers Immediately
```
If you find a blocking issue, document it in status tracker right away
```

---

## 🔧 Recent Fixes & Current State (Session 2 - 2025-11-12)

### ✅ Fixed Issues
**Task 1.1: IPO Detail Page Crash (P0 - Production Blocker)**
- **Root Cause**: Next.js 16.0.1 (canary) + React 19.1.0 (experimental) compatibility issues
- **Error**: "Module factory not available. It might have been deleted in an HMR update"
- **Fix Implemented**: Downgraded to stable LTS versions
  - Next.js: 16.0.1 → 14.2.15 (LTS)
  - React: 19.1.0 → 18.3.1 (stable)
  - React-DOM: 19.1.0 → 18.3.1 (stable)
  - @types/react: 19 → 18
  - eslint-config-next: 15.5.4 → 14.2.15
- **Configuration**: Converted next.config.ts → next.config.mjs (Next.js 14 format)
- **Result**: ✅ All IPO Detail pages now fully functional
- **Testing**: Verified Exicom, Unimech, Western Carriers IPO detail pages working perfectly

### 📊 Current Application State
- **Server**: Running on http://localhost:3000 (Next.js 14.2.15 dev mode)
- **Status**: All critical pages functional
- **Known Non-Blocking Issues**:
  - Webpack ErrorBoundary hydration warnings in console (dev-mode only, non-blocking)
  - PWA manifest icon 404 errors (existing P2 issue, not a regression)

### 🎯 Next Session Priority
**Task 1.3: Homepage Console Error Investigation**
- **Priority**: P1 (High)
- **Reported Issues**: 22 console errors on homepage
- **Action Required**: Use Playwright MCP to investigate, categorize, and document all console errors
- **Success Criteria**:
  - All errors cataloged with screenshots
  - Errors prioritized (P0/P1/P2)
  - Actionable fixes identified
  - Status tracker updated

### 💡 Testing Server Setup
The dev server should already be running. Check background bash processes:
```bash
# One of these servers should be active:
# - Bash 7ebebf: cd web && rm -rf .next && npm run dev
# - Or check for other running dev servers
```

If server is not running, start it:
```bash
cd web && npm run dev
```

---

**Last Updated**: 2025-11-12 (Session 2)
**Related Files**:
- [Testing Status Tracker](./TESTING_STATUS_TRACKER.md) - Live progress tracking
- [Comprehensive Testing Plan](./COMPREHENSIVE_UI_TESTING_PLAN.md) - Full 11-week plan
- [Playwright MCP Workflows](./PLAYWRIGHT_MCP_WORKFLOWS.md) - Command reference
- [Testing Strategy Summary](./TESTING_STRATEGY_UPDATE_SUMMARY.md) - What changed
