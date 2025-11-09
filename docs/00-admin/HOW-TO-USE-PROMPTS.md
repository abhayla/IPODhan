# How to Use Reusable Implementation Prompts

## Purpose
This guide explains how to use the reusable prompt documents for consistent implementation across multiple sessions.

---

## Quick Start

### Starting a New Session

**Step 1: Load the Prompt**
```bash
# Open the specific prompt document
code docs/00-admin/PROMPT-Day-3-4-Dynamic-Admin-Enhancement.md
```

**Step 2: Tell Claude to Execute It**
```
Execute the implementation in: docs/00-admin/PROMPT-Day-3-4-Dynamic-Admin-Enhancement.md

Start with the pre-implementation checklist and proceed with the next incomplete task.
```

**Step 3: Claude Will:**
1. ✅ Read the prompt document
2. ✅ Check implementation status (what's done, what's pending)
3. ✅ Run pre-implementation checklist
4. ✅ Read required reference documents
5. ✅ Create TodoWrite tracking for tasks
6. ✅ Begin implementation of next task
7. ✅ Update the prompt document with progress

---

## Prompt Structure

Every reusable prompt follows this standard structure:

### 1. **Status Section** 🟢🟡🔴
Shows what's completed, in progress, or not started
- Helps you quickly see where you are
- Updated after each session

### 2. **Tasks Section** 📋
Detailed breakdown of implementation tasks
- Clear requirements
- Code examples
- Reference documentation
- Decision-making guidelines

### 3. **Pre-Implementation Checklist** ☑️
Ensures proper setup before coding
- Files to read
- Architecture verification
- Dependency checks
- Environment validation

### 4. **Reference Documents** 📚
Critical documents to read
- Architecture docs
- Database schema
- Existing implementations
- Standards and conventions

### 5. **Success Criteria** 🎯
Clear completion criteria
- Task-level criteria
- Quality criteria
- Performance targets

### 6. **Implementation Instructions** 🚀
Step-by-step execution guide
- How to make decisions
- Testing procedures
- Documentation updates

### 7. **Session Continuity** 🔄
Handoff notes between sessions
- What was completed
- What's next
- Blockers encountered
- Implementation notes

---

## Best Practices

### ✅ DO:
1. **Always read the full prompt** before starting
2. **Check implementation status** first
3. **Complete pre-implementation checklist** every time
4. **Update status** after each task completion
5. **Document decisions** in the prompt
6. **Use TodoWrite** to track progress
7. **Commit work** with clear messages

### ❌ DON'T:
1. Skip the pre-implementation checklist
2. Start coding without reading reference docs
3. Forget to update implementation status
4. Make decisions without documenting them
5. Leave sessions without updating handoff notes

---

## Example Workflow

### Session 1: Setup & Task 3.1
```
Me: Execute docs/00-admin/PROMPT-Day-3-4-Dynamic-Admin-Enhancement.md

Claude:
1. Reads prompt document
2. Sees Task 3.1 is next (Field Label Mapping)
3. Runs pre-implementation checklist
4. Reads reference docs
5. Creates TodoWrite for Task 3.1 subtasks
6. Implements field-labels.ts
7. Tests implementation
8. Updates prompt status: Task 3.1 ✅ COMPLETE
9. Commits work

End of session: Task 3.1 complete, ready for Task 3.2
```

### Session 2: Continue with Task 3.2
```
Me: Continue with docs/00-admin/PROMPT-Day-3-4-Dynamic-Admin-Enhancement.md

Claude:
1. Reads prompt document
2. Sees Task 3.1 ✅ COMPLETE
3. Sees Task 3.2 🟡 IN PROGRESS
4. Runs pre-implementation checklist
5. Implements DynamicFormGenerator enhancements
6. Tests changes
7. Updates prompt status: Task 3.2 ✅ COMPLETE
8. Commits work

End of session: Tasks 3.1, 3.2 complete, ready for Task 3.3
```

---

## Decision Making

The prompts include decision-making guidance so Claude doesn't need to ask you repeatedly:

### Built-in Decisions:
- **Naming conventions**: Use SEBI/NSE standards
- **Styling**: Follow existing Tailwind patterns
- **Validation**: Warnings = yellow, Errors = red
- **Units**: ₹ prefix, % suffix
- **Tooltips**: Include regulatory references

### When to Ask:
Only ask the user when:
- Major architectural change needed
- Multiple valid approaches exist
- Business logic is ambiguous
- Breaking changes required

---

## Updating Prompts

As implementation progresses, update these sections:

### 1. Implementation Status
```markdown
### ✅ COMPLETED
- [x] Task 3.1: Field Label Mapping System
  - Created web/lib/admin/field-labels.ts (450 lines)
  - Mapped all 13 tables with user-friendly labels
  - Added tooltips for 120+ complex fields
```

### 2. Session Continuity
```markdown
**Session 2025-11-09 14:30**:
- Completed: Task 3.1 (Field Label Mapping)
- Next: Task 3.2 (Enhance DynamicFormGenerator)
- Blockers: None
- Notes: Used NSE terminology for lot size, added unit support
```

### 3. Implementation Notes
```markdown
### Decisions Made
- 2025-11-09: Chose NSE terminology over BSE for lot size
  - Reason: NSE is primary market, more familiar to users
  - Impact: "Lot Size" instead of "Market Lot"
```

---

## Creating New Prompts

When creating a new reusable prompt:

1. **Copy template structure** from existing prompts
2. **Define clear status tracking** (✅🟡⚪)
3. **Break into discrete tasks** (Day 3, Day 4, etc.)
4. **Include code examples** for each task
5. **List reference documents** to read
6. **Define success criteria** clearly
7. **Add decision-making guidelines**
8. **Test with one session** before finalizing

---

## Available Prompts

### Admin Consolidation
- `PROMPT-Day-3-4-Dynamic-Admin-Enhancement.md` - Field labels, validation UI, tooltips

### Coming Soon
- `PROMPT-Data-Flow-Architecture.md` - DRHP integration (Phase 2)
- `PROMPT-UX-Transformation.md` - Premium UI redesign (Phase 3)

---

**End of Guide**

**Last Updated**: 2025-11-09
**Maintained By**: Development Team
