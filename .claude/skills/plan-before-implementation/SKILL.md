---
name: plan-before-implementation
description: Create formal versioned planning documents before implementation with verification, task breakdowns, and success metrics
---

# Plan Before Implementation

**Purpose:** Ensure comprehensive planning documentation before executing implementation by creating formal planning documents in the docs/01-planning/ directory with clear versioning, verification, and task breakdowns.

**When to invoke:** Use this skill when in plan mode analyzing what needs to be done, identifying problems requiring multi-step solutions, planning feature implementations or bug fixes, analyzing architecture changes, or before making significant code changes.

---

## Overview

This skill defines the practice of creating formal planning documents when analyzing implementation work. The goal is to maintain clear, version-controlled plans that document what needs to be done before starting actual implementation.

**Skill Type**: Development Practice
**Created**: 2025-11-15

---

## Key Scenarios

- User enables plan mode and asks to verify/analyze current state
- Identifying problems that require multi-step solutions
- Planning feature implementations or bug fixes
- Analyzing architecture changes or refactoring needs
- Before making significant code changes

---

## Plan Document Guidelines

### 1. Location
All planning documents MUST be saved in:
```
d:\Abhay\VibeCoding\IPODhan\docs\01-planning\
```

### 2. Naming Convention
```
Plan-[Feature-Name]-[YYYY-MM-DD]-v1.md
```

**Format Rules**:
- Start with `Plan-` prefix
- Use descriptive feature/task name (kebab-case)
- Include date in YYYY-MM-DD format
- Append version number starting with `-v1`
- Examples:
  - `Plan-Calendar-Fixes-2025-11-15-v1.md`
  - `Plan-API-Performance-2025-11-16-v1.md`
  - `Plan-Database-Migration-2025-11-17-v2.md`

### 3. Versioning Strategy
- **Always create NEW plans** - Never overwrite existing plans
- Increment version number for same feature/date: `-v1`, `-v2`, `-v3`
- Keep old versions for historical reference
- Each version represents a refinement or update to the plan

### 4. When to Create New Version
Create a new version when:
- User provides new information that changes the plan significantly
- New screenshots/evidence reveals different problems
- Initial plan was based on incorrect assumptions
- Scope changes after reviewing existing plan

---

## Plan Document Structure

### Required Sections

1. **Header Block**
```markdown
# Plan: [Feature/Task Name]

**Date**: YYYY-MM-DD
**Version**: vX
**Status**: 🔴 AWAITING IMPLEMENTATION | 🟡 IN PROGRESS | ✅ COMPLETE
**Priority**: P0 CRITICAL | P1 HIGH | P2 MEDIUM | P3 LOW
**Estimated Time**: X hours
```

2. **Executive Summary**
- 2-3 sentences describing what needs to be done
- Why this work is needed
- What problem it solves

3. **Current State (Verified)**
- **What's Broken** ❌ - List actual issues found
- **What's Working** ✅ - List what doesn't need fixing
- **Evidence** - Screenshots, logs, test results that prove the state

4. **Root Cause Analysis**
- Identify WHY each problem exists
- Provide evidence (code snippets, file analysis)
- Explain impact of each root cause

5. **Implementation Plan**
- **Task-based breakdown** - Numbered tasks with clear steps
- **Time estimates** - Per task and total
- **File changes** - Which files will be modified/created
- **Dependencies** - What must be done first

6. **Testing Checklist**
- Specific test cases to verify each task
- Acceptance criteria
- How to verify the fix works

7. **Success Metrics**
- **Before State** - Metrics showing current broken state
- **After State** - Target metrics after implementation

---

## Best Practices

### Do ✅
- **Verify before documenting** - Use screenshots, logs, code analysis
- **Be specific** - Exact file paths, line numbers, function names
- **Include code examples** - Show current vs proposed code
- **Estimate realistically** - Break down time per task
- **Update status** - Mark plan as IN PROGRESS or COMPLETE when appropriate
- **Create new version if plan changes** - Don't overwrite, version up

### Don't ❌
- **Never make false claims** - Don't say "✅ COMPLETE" unless verified
- **Don't guess** - If uncertain, investigate first
- **Don't overwrite old plans** - Always create new version
- **Don't skip verification** - Always check current state before planning
- **Don't mix historical content** - Keep plans focused on current work only

---

## Example Workflow

1. **User requests planning** → Enable plan mode
2. **Analyze current state** → Read files, check screenshots, verify issues
3. **Create plan document**:
   - Determine feature name: "Calendar-Fixes"
   - Get current date: "2025-11-15"
   - Check for existing plans: Found `Plan-Calendar-Fixes-2025-11-15-v1.md`
   - Create new version: `Plan-Calendar-Fixes-2025-11-15-v2.md`
4. **Document findings** → Use required sections structure
5. **Present to user** → Exit plan mode with plan summary
6. **User approves** → Begin implementation, mark plan as IN PROGRESS

---

## Integration with Plan Mode

When in plan mode:
1. Research and verify current state
2. Create planning document in `docs/01-planning/`
3. Present plan via ExitPlanMode tool
4. Wait for user approval
5. Mark plan document status as IN PROGRESS before implementing

---

## File Organization

```
docs/
├── 01-planning/           ← All planning documents here
│   ├── Plan-Calendar-Fixes-2025-11-15-v1.md
│   ├── Plan-Calendar-Fixes-2025-11-15-v2.md
│   ├── Plan-API-Refactor-2025-11-16-v1.md
│   └── ...
├── 02-architecture/       ← Architecture docs (not plans)
├── 05-caching/           ← Caching docs (not plans)
├── 15-calendar/          ← Feature-specific docs (not plans)
└── ...
```

**Rule**: Plans ALWAYS go to `01-planning`, everything else stays in topic folders.

---

## Success Criteria

A good plan document:
- ✅ Has clear, verifiable current state
- ✅ Identifies root causes with evidence
- ✅ Breaks work into specific tasks
- ✅ Includes realistic time estimates
- ✅ Has testable acceptance criteria
- ✅ Shows before/after success metrics
- ✅ Can be followed by any developer
- ✅ Contains no false claims or speculation

---

## Common Pitfalls to Avoid

1. **Documentation drift** - Claiming something is done when it isn't
2. **Overwriting plans** - Losing historical context
3. **Vague tasks** - "Fix the calendar" instead of specific steps
4. **No verification** - Planning without checking current state
5. **Missing estimates** - Not breaking down time per task
6. **No success criteria** - Can't verify when work is complete

---

**Last Updated**: 2025-11-15
**Skill Status**: Active
**Related Skills**: None (foundational skill)
