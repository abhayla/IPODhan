# Agent Spawning Plan for Dashboard Testing & Fixing

## Overview

This document outlines the strategy for spawning agents during dashboard testing and fixing workflow. Agents will be used to automate complex tasks, fix issues, and verify results.

---

## Agent Types & Usage

### 1. General-Purpose Agent

**When to Spawn:**
- Complex bug fixes requiring code analysis
- Refactoring components
- Multi-file changes
- Root cause analysis

**Example Tasks:**
- Fix view toggle blocking issue
- Refactor filter logic
- Update responsive breakpoints
- Optimize component performance

**Spawning Template:**
```
Agent: general-purpose
Task: [Specific task description]
Context:
  - Issue ID: DASH-XXX
  - Files involved: [list of files]
  - Test case reference: TC-XXX
  - Current behavior: [description]
  - Expected behavior: [description]
  - Screenshots: [list]
Instructions:
  1. Analyze the issue
  2. Identify root cause
  3. Implement fix
  4. Test the fix
  5. Provide verification steps
Expected Output:
  - Code changes made
  - Explanation of fix
  - Verification that issue is resolved
```

---

## Specific Agent Tasks for Dashboard Issues

### Task 1: Fix View Toggle Blocking (DASH-001)

```yaml
Agent: general-purpose
Task: Fix List view button being blocked by Tools dropdown overlay
Priority: P1
Context:
  Issue ID: DASH-001
  Severity: Medium
  Test Case: TC-003
  Component: Dashboard view toggle button
  Root Cause: Z-index or click-outside handler issue

  Files to Check:
    - app/dashboard/page.tsx
    - components/Header.tsx (Tools dropdown)
    - components/ui/DropdownMenu.tsx (if using)

  Current Behavior: |
    When Tools dropdown is open in header, clicking List view button
    fails because dropdown overlay intercepts clicks

  Expected Behavior: |
    - List view button should always be clickable
    - OR dropdown should close when clicking outside
    - OR dropdown should have proper z-index layering

Instructions:
  1. Read Header component to understand dropdown implementation
  2. Check if click-outside handler exists
  3. Analyze z-index values for dropdown vs page content
  4. Implement one of these solutions:
     a. Add click-outside handler to close dropdown
     b. Adjust z-index hierarchy
     c. Add backdrop that closes dropdown
     d. Ensure dropdown doesn't overlap interactive elements
  5. Test the fix by:
     - Opening Tools dropdown
     - Clicking List view button
     - Verifying button responds correctly
  6. Ensure no regression in dropdown functionality

Expected Output:
  - Code changes to fix blocking issue
  - Explanation of solution chosen
  - Verification that List view button works
  - Screenshots showing fix working
```

### Task 2: Fix Search Performance (If Found)

```yaml
Agent: general-purpose
Task: Optimize search functionality performance
Priority: P2
Context:
  Issue ID: DASH-XXX (if found during testing)
  Test Case: TC-004
  Component: Dashboard search box

  Files to Check:
    - app/dashboard/page.tsx
    - components/search/SearchBox.tsx (if exists)

  Current Behavior: |
    Search may be slow or cause unnecessary re-renders

  Expected Behavior: |
    - Search should have debounce (300-500ms)
    - Should not cause full page re-render
    - Should show loading state while filtering

Instructions:
  1. Analyze current search implementation
  2. Check if debounce is implemented
  3. Add debounce if missing (use lodash or custom)
  4. Optimize filter logic
  5. Add loading state if needed
  6. Test with various search terms

Expected Output:
  - Optimized search code
  - Performance improvements documented
  - Smooth user experience verified
```

### Task 3: Fix Filter State Management (If Found)

```yaml
Agent: general-purpose
Task: Fix filter state synchronization issues
Priority: P1
Context:
  Issue ID: DASH-XXX (if found)
  Test Cases: TC-005, TC-006, TC-007, TC-008
  Component: Dashboard filters

  Files to Check:
    - app/dashboard/page.tsx
    - hooks/useFilters.ts (if exists)
    - components/filters/*.tsx

  Potential Issues:
    - Filters not syncing with URL params
    - Clear filters not resetting properly
    - Combined filters showing wrong results
    - Filter state lost on navigation

Instructions:
  1. Analyze filter state management
  2. Check URL param synchronization
  3. Verify clear filters logic
  4. Test combined filter scenarios
  5. Ensure state persistence if needed
  6. Add proper TypeScript types

Expected Output:
  - Fixed filter logic
  - URL params properly synced
  - Clear filters working correctly
  - All filter combinations working
```

### Task 4: Fix Pagination Issues (If Found)

```yaml
Agent: general-purpose
Task: Fix pagination navigation and state issues
Priority: P1
Context:
  Issue ID: DASH-XXX (if found)
  Test Cases: TC-010, TC-011, TC-012
  Component: Dashboard pagination

  Files to Check:
    - app/dashboard/page.tsx
    - components/ui/Pagination.tsx

  Potential Issues:
    - Page numbers not updating
    - Data not loading on page change
    - Previous/Next buttons not enabling/disabling
    - Page state lost on filter change

Instructions:
  1. Analyze pagination implementation
  2. Check page state management
  3. Verify data fetching on page change
  4. Test button enable/disable logic
  5. Ensure page resets on filter change
  6. Verify URL param updates

Expected Output:
  - Working pagination
  - Proper button states
  - Smooth page transitions
  - Correct data loading
```

### Task 5: Fix Responsive Layout Issues (If Found)

```yaml
Agent: general-purpose
Task: Fix responsive layout problems on mobile/tablet
Priority: P2
Context:
  Issue ID: DASH-XXX (if found)
  Test Cases: TC-016, TC-017, TC-018
  Component: Dashboard responsive layouts

  Files to Check:
    - app/dashboard/page.tsx
    - CSS/Tailwind classes
    - components/IPOCard.tsx

  Potential Issues:
    - Grid not collapsing on mobile
    - Filters overflowing on small screens
    - Text truncation issues
    - Touch targets too small

Instructions:
  1. Test on 375px, 768px, 1920px widths
  2. Check grid column breakpoints
  3. Verify filter layout on mobile
  4. Ensure touch targets >= 44px
  5. Check text doesn't overflow
  6. Test scroll behavior

Expected Output:
  - Responsive layouts working
  - Proper breakpoint behavior
  - Mobile-friendly interactions
  - No overflow issues
```

---

## Agent Coordination

### Parallel Agent Execution

When multiple independent issues found:
```
Spawn agents in parallel:
- Agent 1: Fix DASH-001 (view toggle)
- Agent 2: Fix DASH-002 (search performance)
- Agent 3: Fix DASH-003 (filter logic)

Each agent works independently, reports back when done.
```

### Sequential Agent Execution

When issues are dependent:
```
Spawn agents sequentially:
1. Agent 1: Fix filter state management (DASH-003)
   Wait for completion...
2. Agent 2: Fix pagination with filters (DASH-004)
   (depends on filter fix)
   Wait for completion...
3. Verify both fixes together
```

---

## Agent Success Criteria

### Before Marking Agent Task Complete:

1. ✅ Code changes implemented
2. ✅ Changes tested manually
3. ✅ Test case re-run passed
4. ✅ No regressions introduced
5. ✅ Screenshots showing fix
6. ✅ Code follows project standards
7. ✅ TypeScript types correct
8. ✅ Comments added explaining fix

---

## Agent Spawning During Testing

### Phase 1: Testing Phase
**No agents spawned** - Focus on test execution and issue discovery

### Phase 2: Issue Documentation Phase
**No agents spawned** - Focus on documenting issues found

### Phase 3: Fixing Phase
**Spawn agents based on issues:**
- Critical issues: Spawn immediately, fix urgently
- High issues: Spawn after critical fixed
- Medium issues: Batch and fix together
- Low issues: Document for later

### Phase 4: Verification Phase
**Possibly spawn test agent** - Re-run test suite

---

## Example Agent Spawning Commands

### Spawn Single Agent
```
"Spawn a general-purpose agent to fix DASH-001 (view toggle blocking issue).
Use the context from dashboard-testing-workflow.md under Task 1."
```

### Spawn Multiple Agents in Parallel
```
"Spawn agents to fix these dashboard issues in parallel:
1. DASH-001 (view toggle) - Agent 1
2. DASH-002 (search performance) - Agent 2
3. DASH-003 (filter logic) - Agent 3

Use task definitions from agent-spawning-plan.md"
```

### Spawn Sequential Agents
```
"Spawn agents to fix dashboard issues sequentially:
1. First fix DASH-003 (filter state)
2. Then fix DASH-004 (pagination with filters)
3. Verify both fixes work together"
```

---

## Agent Output Tracking

### Track Agent Progress:
```
Agent ID: agent-12345
Task: Fix DASH-001
Status: In Progress | Completed | Failed
Started: 10:30:00
Completed: 10:45:00
Duration: 15 minutes

Changes Made:
- File: components/Header.tsx
- Added click-outside handler
- Adjusted z-index values

Verification:
- Test TC-003 re-run: PASSED
- Screenshot: dashboard-view-toggle-fixed.png
- No regressions detected
```

---

## Agent Failure Handling

### If Agent Fails to Fix Issue:

1. **Analyze Failure:**
   - Review agent's output
   - Check error messages
   - Identify blockers

2. **Retry Strategy:**
   - Provide more context
   - Break task into smaller pieces
   - Try different approach

3. **Escalation:**
   - Mark as "Manual Fix Required"
   - Document for human developer
   - Deprioritize if low severity

---

## Post-Agent Verification

After agent completes fix:

1. **Re-run Test Case:**
   ```
   "Re-run TC-003 (List view toggle) and capture new screenshots"
   ```

2. **Regression Testing:**
   ```
   "Run related test cases to ensure no regression:
   - TC-001, TC-002, TC-003"
   ```

3. **Update Issue Status:**
   ```
   DASH-001:
     Status: Fixed -> Verified -> Closed
     Fix Applied: 2025-10-10 10:45:00
     Verified By: Test TC-003 re-run
     Agent: agent-12345
   ```

---

## Ready to Use

This agent spawning plan is ready to execute. When dashboard testing finds issues, use this document to spawn appropriate agents for fixing.

**To start agent-based fixing:**
```
"Use agent-spawning-plan.md to spawn agents for fixing dashboard issues found during testing"
```

