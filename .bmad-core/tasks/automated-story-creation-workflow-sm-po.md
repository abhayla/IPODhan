# Automated Story Creation and Validation Workflow

**Task ID:** automated-story-creation-workflow
**Version:** 1.0
**Agent:** Product Owner (Sarah) or Scrum Master (Bob)
**Elicit:** false

## Overview

Complete end-to-end workflow for story creation and validation. This task orchestrates:
1. Story drafting by spawning Scrum Master agent
2. Story validation by spawning Product Owner agent
3. Story correction and approval by spawning Scrum Master agent
4. Final documentation and readiness confirmation

## Input Parameters

- `epic_path`: Path to sharded epic file (e.g., `docs/epics/epic-1-sharded.md`)
- `architecture_path`: Path to architecture documentation (e.g., `docs/architecture/system-design.md`)
- `destination_path`: Path where the story will be saved (default: `docs/04-stories/`)

## Workflow Steps

### 1. Story Context Preparation

**Actions:**
- Verify sharded epic file exists at `epic_path`
- Verify architecture documentation exists at `architecture_path`
- Confirm destination directory exists
- Load project configuration from `.bmad-core/core-config.yaml`

**Output:**
- Epic context loaded
- Architecture guidelines available
- Destination confirmed
- Ready for story drafting

---

### 2. Story Drafting (Scrum Master Agent)

**Spawn Scrum Master Agent for Story Creation:**

Use the Task tool to spawn Scrum Master agent with prompt:

```
Load and activate scrum master agent from D:\Abhay\VibeCoding\IPODhan\.bmad-core\agents\sm.md

Then execute command: *draft

Context:
- Sharded Epic: {epic_path}
- Architecture Docs: {architecture_path}
- Destination: {destination_path}

Requirements:
- Draft next story from sharded epic and architecture
- Follow create-next-story.md task workflow
- Ensure story has clear acceptance criteria
- Include technical implementation details
- Create detailed user story that AI developers can implement without confusion
- Save story to destination path
- Do NOT approve or implement the story yet

Return:
- Path to created story file
- Story ID
- Story title
- Summary of acceptance criteria
- Any questions or clarifications needed
```

**Agent Configuration:**
- Use `general-purpose` subagent type
- Provide complete epic and architecture context
- Reference SM agent file: `D:\Abhay\VibeCoding\IPODhan\.bmad-core\agents\sm.md`
- Command: `*draft` (Drafts Next Story from Sharded Epic + Architecture)

**Wait for Story Drafting:**
- Monitor SM agent progress
- Review story structure
- Capture story file path for next step

**Output:**
- Story file created at destination
- Story follows template structure
- All required sections populated
- Ready for PO validation

---

### 3. Story Validation (Product Owner Agent)

**Spawn Product Owner Agent for Story Review:**

After story is drafted, spawn Product Owner (Sarah) for validation.

Use the Task tool to spawn Product Owner agent with prompt:

```
Load and activate product owner agent from D:\Abhay\VibeCoding\IPODhan\.bmad-core\agents\po.md

Then execute command: *validate-story-draft {story_file_path}

Context:
- Story File: {story_file_path}
- Epic Reference: {epic_path}
- Architecture Reference: {architecture_path}

Requirements:
- Validate story draft for quality and completeness
- Follow validate-next-story.md task workflow
- Check alignment with epic and architecture
- Verify acceptance criteria are clear and testable
- Ensure story is actionable for developers
- Check for missing details or ambiguities
- Provide detailed review comments

Return:
- Validation status (APPROVED / CHANGES REQUIRED)
- Detailed review comments
- List of issues found (if any)
- Suggestions for improvement
- Sign-off statement if approved
```

**Agent Configuration:**
- Use `general-purpose` subagent type
- Provide story file path from Step 2
- Include epic and architecture references
- Reference PO agent file: `D:\Abhay\VibeCoding\IPODhan\.bmad-core\agents\po.md`
- Command: `*validate-story-draft` (Validate Story Draft)

**Wait for Validation:**
- Monitor PO agent review process
- Capture validation feedback
- Determine next action based on validation result

**Validation Decision:**
- **APPROVED** → Skip to Step 5 (Final Documentation)
- **CHANGES REQUIRED** → Continue to Step 4 (Story Correction)

**Output:**
- Validation report with detailed feedback
- List of required changes (if any)
- Approval status

---

### 4. Story Correction and Approval (Scrum Master Agent)

**Only execute if PO validation status is CHANGES REQUIRED**

**Spawn Scrum Master Agent for Story Updates:**

Use the Task tool to spawn Scrum Master agent with prompt:

```
Load and activate scrum master agent from D:\Abhay\VibeCoding\IPODhan\.bmad-core\agents\sm.md

Then execute command: *correct-course

Context:
- Story File: {story_file_path}
- PO Review Comments: {po_validation_feedback}
- Required Changes: {list_of_issues}

Requirements:
- Update story based on PO review comments
- Follow correct-course.md task workflow
- Address all issues identified in validation
- Maintain story structure and clarity
- Ensure all PO feedback is incorporated
- Update story file with corrections
- Finalize and approve the story

Return:
- Updated story file path
- Summary of changes made
- Confirmation that all PO feedback addressed
- Final approval status
```

**Agent Configuration:**
- Use `general-purpose` subagent type
- Provide PO validation feedback
- Include list of required changes
- Reference SM agent file: `D:\Abhay\VibeCoding\IPODhan\.bmad-core\agents\sm.md`
- Command: `*correct-course` (Update PO review comments and Approve story)

**Wait for Corrections:**
- Monitor SM agent correction process
- Review updated story
- Verify all PO feedback addressed

**Output:**
- Story file updated with corrections
- All PO review comments addressed
- Story approved and ready for implementation

---

### 5. Final Documentation

**Update Sprint Plan:**

If story is part of a sprint plan, update the sprint plan file to include the new story.

**Actions:**
- Locate relevant sprint plan file (e.g., `docs/04-stories/SPRINT-N-PLAN.md`)
- Add story to sprint backlog
- Update story status to "Ready"
- Link to story file

**Story Status Update:**

Update the story file with final metadata:

```yaml
status: Ready
created_date: {timestamp}
approved_by: Sarah (Product Owner)
approved_date: {timestamp}
workflow: automated-story-creation-workflow
```

**Validation:**
- ✓ Story file finalized
- ✓ Sprint plan updated (if applicable)
- ✓ Story status set to "Ready"
- ✓ All approvals documented

---

### 6. Git Commit (Optional - if requested)

**Only execute if user requests automatic commit**

**Create commit with standardized format:**

```bash
git add {story_file_path}

git commit -m "$(cat <<'EOF'
docs(story): Add new story {story_id} - {story_title}

- Story drafted by Scrum Master (Bob)
- Validated by Product Owner (Sarah)
- All acceptance criteria defined
- Ready for implementation

Story: {story_id}
Status: Ready
Workflow: automated-story-creation-workflow

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

**Push to remote (if requested):**

```bash
git push origin main
```

---

### 7. Workflow Summary Report

**Generate workflow completion report:**

**Report Structure:**

```markdown
# Story Creation Workflow Report

**Story ID:** {story_id}
**Story Title:** {story_title}
**Created Date:** {timestamp}
**Workflow Status:** ✓ COMPLETED

## Workflow Execution Summary

### Step 1: Story Drafting
- **Agent:** Bob (Scrum Master)
- **Command:** *draft
- **Status:** ✓ Completed
- **Story File:** {story_file_path}

### Step 2: Story Validation
- **Agent:** Sarah (Product Owner)
- **Command:** *validate-story-draft
- **Status:** {APPROVED / CHANGES REQUIRED}
- **Review Comments:** {summary}

### Step 3: Story Correction (if needed)
- **Agent:** Bob (Scrum Master)
- **Command:** *correct-course
- **Status:** {COMPLETED / SKIPPED}
- **Changes Made:** {summary}

### Step 4: Final Documentation
- **Story Status:** Ready
- **Sprint Plan Updated:** {YES / NO}
- **Git Committed:** {YES / NO}

## Story Details

**File Location:** {story_file_path}
**Epic Reference:** {epic_path}
**Architecture Reference:** {architecture_path}

## Acceptance Criteria Summary

{List of acceptance criteria from story}

## Next Steps

✅ Story is ready for implementation
- Dev agent can be spawned to implement this story
- Use automated-dev-qa-sm-workflow for implementation and testing

## Agent Collaboration

**Scrum Master (Bob):**
- Drafted initial story from epic and architecture
- {Updated story based on PO feedback (if applicable)}

**Product Owner (Sarah):**
- Validated story for quality and completeness
- {Provided feedback for improvements (if applicable)}

---

**Workflow Completed Successfully**
Story {story_id} is ready for sprint planning and implementation.
```

**Report Generation Steps:**
1. Generate report using template above
2. Fill in all placeholders with actual workflow data
3. Display report to user
4. Optionally save to `docs/04-stories/workflow-reports/story-{story_id}-creation-report.md`

---

## Exit Conditions

The workflow completes successfully when ALL of the following are true:

✓ **Story drafted successfully**
- Story file created by Scrum Master
- All required sections populated
- Follows story template structure

✓ **Story validated by Product Owner**
- PO review completed
- All feedback addressed (if changes required)
- Final approval obtained

✓ **Story approved and finalized**
- Story status set to "Ready"
- All documentation complete
- Story ready for implementation

✓ **Workflow report generated**
- Summary report created
- All steps documented
- Next steps identified

---

## Error Handling

### Scrum Master Agent Failure (Drafting)
**Condition:** SM agent fails to create story
**Action:**
1. Document agent failure details
2. HALT workflow
3. Report to user with error logs
4. Suggest manual story creation

### Product Owner Agent Failure (Validation)
**Condition:** PO agent fails to complete validation
**Action:**
1. Document agent failure details
2. HALT workflow
3. Report to user with available feedback
4. Suggest manual validation

### Scrum Master Agent Failure (Correction)
**Condition:** SM agent fails to apply corrections
**Action:**
1. Document agent failure details
2. Preserve PO feedback
3. HALT workflow
4. Report to user for manual correction

### Missing Context Files
**Condition:** Epic or architecture files not found
**Action:**
1. Report missing file paths
2. Request user to provide correct paths
3. HALT workflow until files available

### Story File Conflicts
**Condition:** Story file already exists at destination
**Action:**
1. Report file conflict
2. Ask user for resolution (overwrite/rename/cancel)
3. Proceed based on user decision

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Story Completion | 100% | Story drafted, validated, approved |
| PO Approval Rate | First pass preferred | Number of correction iterations |
| Agent Success Rate | 100% | All agents complete tasks |
| Documentation Quality | Complete | All sections filled |
| Time to Ready | Context-dependent | Total workflow duration |

---

## Usage Example

**As Product Owner (Sarah):**

```bash
# User activates PO agent
/po

# User requests story creation workflow
User: "Create the next story from epic-1-sharded.md"

# Sarah executes this task
*automated-story-creation-workflow epic_path=docs/epics/epic-1-sharded.md architecture_path=docs/architecture/system-design.md
```

**As Scrum Master (Bob):**

```bash
# User activates SM agent
/sm

# User requests story creation workflow
User: "Draft and validate a new story"

# Bob executes this task
*automated-story-creation-workflow epic_path=docs/epics/epic-2-sharded.md
```

**Workflow will:**
1. Spawn Scrum Master (Bob) to draft story
2. Wait for story creation completion
3. Spawn Product Owner (Sarah) to validate story
4. Wait for validation completion
5. If changes required: Spawn Scrum Master (Bob) to apply corrections
6. Finalize story and set status to "Ready"
7. Generate workflow summary report
8. Report completion to user

---

## Agent References

**Scrum Master Agent (Bob - Story Preparation Specialist):**
- File: `D:\Abhay\VibeCoding\IPODhan\.bmad-core\agents\sm.md`
- Used for: Story drafting and corrections
- Commands: `*draft`, `*correct-course`
- Spawned via: Task tool with `general-purpose` subagent type

**Product Owner Agent (Sarah - Quality & Validation Specialist):**
- File: `D:\Abhay\VibeCoding\IPODhan\.bmad-core\agents\po.md`
- Used for: Story validation and quality assurance
- Commands: `*validate-story-draft`
- Spawned via: Task tool with `general-purpose` subagent type

---

## Notes

- This task orchestrates story creation, validation, and approval phases
- Either PO or SM agent can initiate this workflow
- SM agent (Bob) is spawned for drafting and corrections
- PO agent (Sarah) is spawned for validation
- Agent spawning uses the Task tool with `general-purpose` subagent
- Workflow supports iterative correction loop if PO requests changes
- All story operations assume proper project structure
- Story files follow YAML template structure defined in `story-tmpl.yaml`
- Workflow is designed for AI-assisted story creation pipeline
- Can be integrated into larger sprint planning workflows
- Supports both automated and manual git operations
- Report generation preserves complete audit trail
- Story status progression: Draft → Validated → Ready

---

**Task Completion Indicator:**
When this task completes, you will receive:
1. Story file path and ID
2. PO validation status
3. Summary of acceptance criteria
4. Workflow execution report
5. Story readiness confirmation
6. Next steps recommendation (ready for dev implementation)
7. Git commit hash (if auto-commit enabled)
