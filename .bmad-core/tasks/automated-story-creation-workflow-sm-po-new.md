# Automated Story Creation and Validation Workflow

**Task ID:** automated-story-creation-workflow
**Version:** 2.0
**Agent:** Product Owner (Sarah) or Scrum Master (Bob)
**Elicit:** false

## Overview

Complete end-to-end workflow for story creation and validation with **date/time tracking** and **main branch workflow**. This task orchestrates:
1. Story drafting by spawning Scrum Master agent
2. Story validation by spawning Product Owner agent
3. Story correction and approval by spawning Scrum Master agent (with iteration limits)
4. Final documentation with timestamps and changelog
5. Commits to main branch at each stage
6. Machine-readable tracking metadata

**Key v2.0 Changes:**
- ✅ All work happens directly on main branch
- ✅ Date/time tracking for all workflow stages
- ✅ Changelog maintained at all key stages
- ✅ Commits created after each major step
- ✅ JSON tracking files for automation
- ✅ Maximum 3 PO-SM correction iterations
- ✅ Simplified git workflow (no delayed commits)

## Input Parameters

- `epic_path`: Path to sharded epic file (e.g., `docs/epics/epic-1-sharded.md`)
- `architecture_path`: Path to architecture documentation (e.g., `docs/architecture/system-design.md`)
- `destination_path`: Path where the story will be saved (default: `docs/stories/`)

## Workflow Steps

### 1. Story Context Preparation

**Actions:**

1. **Verify Working on Main Branch:**
   ```bash
   # Verify we are on main branch
   git checkout main
   git pull origin main

   current_branch=$(git branch --show-current)
   if [ "$current_branch" != "main" ]; then
     echo "❌ ERROR: Not on main branch!"
     exit 1
   fi

   echo "✅ Working on main branch"
   ```

2. **Verify Context Files:**
   - Verify sharded epic file exists at `epic_path`
   - Verify architecture documentation exists at `architecture_path`
   - Confirm destination directory exists
   - Load project configuration from `.bmad-core/core-config.yaml`

3. **Create Tracking Directory:**
   ```bash
   # Create directory for story creation tracking if needed
   mkdir -p docs/stories/.drafts
   ```

4. **Record Workflow Start Time:**
   - Capture current date/time in ISO 8601 format
   - Store in workflow context for all subsequent timestamps
   - Format: `YYYY-MM-DDTHH:mm:ss.sssZ`

**Output:**
- ✅ On main branch confirmed
- ✅ Epic context loaded
- ✅ Architecture guidelines available
- ✅ Destination confirmed
- ✅ Tracking directory created
- ✅ Workflow start time recorded
- Ready for story drafting

---

### 2. Story Drafting (Scrum Master Agent)

**PREREQUISITE:** Step 1 complete, on main branch

**Timing:**
- ⚠️ **Capture drafting start time** when SM agent begins work
- ⚠️ **Capture drafting complete time** when SM agent finishes

**Spawn Scrum Master Agent for Story Creation:**

Use the Task tool to spawn Scrum Master agent with prompt:

```
Load and activate scrum master agent from .bmad-core/agents/sm.md

Then execute command: *draft

Context:
- Sharded Epic: {epic_path}
- Architecture Docs: {architecture_path}
- Destination: {destination_path}
- Workflow Version: 2.0
- Working on Main Branch: main

Requirements:
- Draft next story from sharded epic and architecture
- Follow create-next-story.md task workflow
- Ensure story has clear acceptance criteria
- Include technical implementation details
- Create detailed user story that AI developers can implement without confusion
- Save story to destination path
- Initialize story with metadata and changelog
- Do NOT approve or implement the story yet

Story File Requirements (NEW in v2.0):
- Include metadata section with creation timestamp
- Initialize changelog section with creation entry
- Set initial status to "Draft"
- Include workflow version: 2.0

Return:
- Path to created story file
- Story ID
- Story title
- Summary of acceptance criteria
- Creation timestamp
- Any questions or clarifications needed
```

**Agent Configuration:**
- Use `general-purpose` subagent type
- Provide complete epic and architecture context
- Reference SM agent file: `.bmad-core/agents/sm.md`
- Command: `*draft` (Drafts Next Story from Sharded Epic + Architecture)

**Wait for Story Drafting:**
- Monitor SM agent progress
- Review story structure
- Capture story file path for next step
- Verify changelog initialized
- Verify metadata includes timestamps

**Post-Drafting Validation:**
```bash
# Verify story file exists
if [ ! -f "{story_file_path}" ]; then
  echo "❌ ERROR: Story file not created!"
  exit 1
fi

# Verify changelog section exists
if ! grep -q "## Changelog" "{story_file_path}"; then
  echo "❌ ERROR: Changelog section missing!"
  exit 1
fi

# Verify metadata section exists
if ! grep -q "created_date:" "{story_file_path}"; then
  echo "❌ ERROR: Metadata missing creation timestamp!"
  exit 1
fi

echo "✅ Story file validated"
```

**Output:**
- ✅ Story file created at destination
- ✅ Story follows template structure
- ✅ All required sections populated
- ✅ Changelog initialized with creation entry
- ✅ Metadata includes creation timestamp
- ✅ Initial status set to "Draft"
- Ready for draft commit (Step 2.5)

---

### 2.5. Create Story Draft Commit on Main Branch

**CRITICAL:** Commit story draft to main branch with date/time tracking and changelog.

**Branch Context:**
- ⚠️ **Must be on main branch**
- ⚠️ **This creates the initial story draft commit**
- ⚠️ **Includes JSON tracking metadata**

**Timing:**
- ⚠️ **Use CURRENT date and time** for all timestamps in this step
- Format: `YYYY-MM-DD HH:MM:SS` for display timestamps
- Format: ISO 8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`) for JSON timestamps

**Actions:**

#### 2.5.1. Create Draft Tracking File

**File:** `docs/stories/.drafts/story-{story_id}-creation.json`

⚠️ **All timestamps MUST use current date/time in ISO 8601 format**

```json
{
  "story_id": "{story_id}",
  "story_title": "{story_title}",
  "creation_status": "drafted",
  "validation_status": "pending",
  "timestamps": {
    "workflow_started": "{WORKFLOW_START_TIME in ISO 8601}",
    "drafting_started": "{DRAFTING_START_TIME in ISO 8601}",
    "drafting_completed": "{CURRENT_DATE_TIME in ISO 8601}",
    "next_phase": "po_validation"
  },
  "creation_context": {
    "epic_path": "{epic_path}",
    "architecture_path": "{architecture_path}",
    "destination_path": "{destination_path}"
  },
  "agents": {
    "drafted_by": "Bob (Scrum Master)",
    "drafted_via": "sm.md *draft command"
  },
  "workflow_version": "2.0",
  "workflow_step": "2.5"
}
```

#### 2.5.2. Verify Story File Changelog

Ensure story file has changelog entry with creation timestamp:

```markdown
## Changelog

### {CURRENT_DATE_TIME in YYYY-MM-DD HH:MM:SS}
- Story drafted by Bob (Scrum Master)
- Status: Draft
- Initial version created from epic and architecture
- Awaiting Product Owner validation
```

#### 2.5.3. Commit Story Draft to Main Branch

```bash
# Verify we are on main branch
current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
  echo "❌ ERROR: Must be on main branch!"
  exit 1
fi

# Stage story file and tracking metadata
git add {story_file_path}
git add docs/stories/.drafts/story-{story_id}-creation.json

# Create story draft commit
git commit -m "$(cat <<'EOF'
docs(story-{story_id}): Create story draft

Story {story_id} - {Story Title}

Story Creation Summary:
- ✅ Story drafted by Bob (Scrum Master)
- ✅ Acceptance criteria defined
- ✅ Technical details included
- ✅ Changelog initialized
- ⏳ Awaiting PO validation

Epic Reference: {epic_path}
Architecture Reference: {architecture_path}

Next Steps:
- Product Owner validation (Step 3)
- Corrections if needed (Step 4)
- Finalization to Ready status

Drafted: {CURRENT_DATE_TIME in YYYY-MM-DD HH:MM:SS}

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

# Push to main
git push origin main

# Verify push succeeded
if [ $? -eq 0 ]; then
  echo "✅ Story draft committed and pushed to main branch"
  echo "📄 Story file: {story_file_path}"
  echo "📊 Tracking: docs/stories/.drafts/story-{story_id}-creation.json"
else
  echo "❌ ERROR: Failed to push story draft"
  exit 1
fi
```

**Validation:**
- ✓ Story file committed to main branch
- ✓ Draft tracking JSON created and committed
- ✓ Changelog includes creation entry
- ✓ Main branch pushed to remote successfully

**Output:**
- Story draft commit hash
- Story officially tracked in main branch
- Changelog initialized with draft entry
- Draft tracking metadata created
- Ready for PO validation (Step 3)

---

### 3. Story Validation (Product Owner Agent)

**PREREQUISITE:** Step 2.5 complete, story draft committed to main branch

**Timing:**
- ⚠️ **Capture validation start time** when PO agent begins review
- ⚠️ **Capture validation complete time** when PO agent finishes

**Spawn Product Owner Agent for Story Review:**

After story is drafted, spawn Product Owner (Sarah) for validation.

Use the Task tool to spawn Product Owner agent with prompt:

```
Load and activate product owner agent from .bmad-core/agents/po.md

Then execute command: *validate-story-draft {story_file_path}

Context:
- Story File: {story_file_path}
- Epic Reference: {epic_path}
- Architecture Reference: {architecture_path}
- Workflow Version: 2.0
- Working on Main Branch: main

Requirements:
- Validate story draft for quality and completeness
- Follow validate-next-story.md task workflow
- Check alignment with epic and architecture
- Verify acceptance criteria are clear and testable
- Ensure story is actionable for developers
- Check for missing details or ambiguities
- Provide detailed review comments
- Include validation timestamp in review

Return:
- Validation status (APPROVED / CHANGES REQUIRED)
- Detailed review comments
- List of issues found (if any)
- Suggestions for improvement
- Validation timestamp
- Sign-off statement if approved
```

**Agent Configuration:**
- Use `general-purpose` subagent type
- Provide story file path from Step 2
- Include epic and architecture references
- Reference PO agent file: `.bmad-core/agents/po.md`
- Command: `*validate-story-draft` (Validate Story Draft)

**Wait for Validation:**
- Monitor PO agent review process
- Capture validation feedback
- Capture validation timestamp
- Determine next action based on validation result

**Post-Validation Actions:**

1. **Update Story File Changelog:**
   ```markdown
   ## Changelog

   ### {CURRENT_DATE_TIME in YYYY-MM-DD HH:MM:SS}
   - Story validated by Sarah (Product Owner)
   - Validation Status: {APPROVED | CHANGES REQUIRED}
   - {If approved: "Ready for finalization"}
   - {If changes required: "Corrections needed - see review comments"}

   ### {PREVIOUS_ENTRY_DATE}
   - Story drafted by Bob (Scrum Master)
   - Status: Draft
   ```

2. **Update Draft Tracking JSON:**
   Update `docs/stories/.drafts/story-{story_id}-creation.json`:
   ```json
   {
     "validation_status": "{approved | changes_required}",
     "timestamps": {
       ...existing timestamps...,
       "validation_started": "{VALIDATION_START_TIME in ISO 8601}",
       "validation_completed": "{CURRENT_DATE_TIME in ISO 8601}",
       "next_phase": "{finalization | sm_corrections}"
     },
     "validation": {
       "validated_by": "Sarah (Product Owner)",
       "validated_via": "po.md *validate-story-draft command",
       "status": "{APPROVED | CHANGES REQUIRED}",
       "issues_count": {issues_count},
       "validated_at": "{CURRENT_DATE_TIME in ISO 8601}"
     },
     "workflow_step": "3"
   }
   ```

**Validation Decision:**
- **APPROVED** → Continue to Step 3.5, then skip to Step 5 (Final Documentation)
- **CHANGES REQUIRED** → Continue to Step 3.5, then to Step 4 (Story Correction)

**Output:**
- ✅ Validation report with detailed feedback
- ✅ List of required changes (if any)
- ✅ Approval status
- ✅ Story changelog updated with validation result
- ✅ Tracking JSON updated with validation timestamp
- Ready for validation commit (Step 3.5)

---

### 3.5. Create Validation Commit on Main Branch

**CRITICAL:** Commit validation results to main branch with changelog and tracking updates.

**Branch Context:**
- ⚠️ **Must be on main branch**
- ⚠️ **This creates the validation result commit**

**Timing:**
- ⚠️ **Use CURRENT date and time** for all timestamps

**Actions:**

#### 3.5.1. Commit Validation Results

```bash
# Verify we are on main branch
current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
  echo "❌ ERROR: Must be on main branch!"
  exit 1
fi

# Stage story file with updated changelog and tracking JSON
git add {story_file_path}
git add docs/stories/.drafts/story-{story_id}-creation.json

# Create validation commit with appropriate message
if [ "{validation_status}" == "APPROVED" ]; then
  git commit -m "$(cat <<'EOF'
docs(story-{story_id}): PO validation passed ✅

Story {story_id} - {Story Title}

Validation Summary:
- ✅ Story validated by Sarah (Product Owner)
- ✅ All acceptance criteria clear and testable
- ✅ Story aligned with epic and architecture
- ✅ Ready for finalization

Validation Completed: {CURRENT_DATE_TIME in YYYY-MM-DD HH:MM:SS}

Next Steps:
- Final Documentation (Step 5)
- Set status to Ready (Step 6)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
  )"
else
  git commit -m "$(cat <<'EOF'
docs(story-{story_id}): PO validation - changes required

Story {story_id} - {Story Title}

Validation Summary:
- ⚠️ Story reviewed by Sarah (Product Owner)
- ⚠️ Changes required before approval
- ⚠️ Issues identified: {issues_count}

Review Comments:
{summary_of_review_comments}

Validation Completed: {CURRENT_DATE_TIME in YYYY-MM-DD HH:MM:SS}

Next Steps:
- SM Corrections (Step 4)
- Re-validation after corrections

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
  )"
fi

# Push to main
git push origin main

# Verify push succeeded
if [ $? -eq 0 ]; then
  echo "✅ Validation results committed and pushed to main branch"
  echo "📄 Story file: {story_file_path}"
  echo "📊 Tracking: docs/stories/.drafts/story-{story_id}-creation.json"
  echo "✓ Validation Status: {validation_status}"
else
  echo "❌ ERROR: Failed to push validation results"
  exit 1
fi
```

**Validation:**
- ✓ Story file with updated changelog committed
- ✓ Tracking JSON with validation data committed
- ✓ Main branch pushed to remote successfully

**Output:**
- Validation commit hash
- Validation results tracked in main branch
- Changelog includes validation entry

**Next Steps:**
- **If APPROVED:** Proceed to Step 5 (Final Documentation)
- **If CHANGES REQUIRED:** Proceed to Step 4 (Story Correction)

---

### 4. Story Correction and Approval (Scrum Master Agent)

**Only execute if PO validation status is CHANGES REQUIRED**

**PREREQUISITE:** Step 3.5 complete, validation results committed to main branch

**Iteration Tracking:**
- ⚠️ **Maximum 3 PO-SM correction iterations**
- Track iteration count in workflow context
- HALT workflow if max iterations exceeded

**Timing:**
- ⚠️ **Capture correction start time** when SM agent begins corrections
- ⚠️ **Capture correction complete time** when SM agent finishes

**Spawn Scrum Master Agent for Story Updates:**

Use the Task tool to spawn Scrum Master agent with prompt:

```
Load and activate scrum master agent from .bmad-core/agents/sm.md

Then execute command: *correct-course

Context:
- Story File: {story_file_path}
- PO Review Comments: {po_validation_feedback}
- Required Changes: {list_of_issues}
- Workflow Version: 2.0
- Working on Main Branch: main
- Correction Iteration: {iteration_count} of 3

Requirements:
- Update story based on PO review comments
- Follow correct-course.md task workflow
- Address all issues identified in validation
- Maintain story structure and clarity
- Ensure all PO feedback is incorporated
- Update story file with corrections
- Update changelog with correction entry
- Finalize and approve the story

Return:
- Updated story file path
- Summary of changes made
- Confirmation that all PO feedback addressed
- Correction timestamp
- Final approval status
```

**Agent Configuration:**
- Use `general-purpose` subagent type
- Provide PO validation feedback
- Include list of required changes
- Reference SM agent file: `.bmad-core/agents/sm.md`
- Command: `*correct-course` (Update PO review comments and Approve story)

**Wait for Corrections:**
- Monitor SM agent correction process
- Review updated story
- Verify all PO feedback addressed
- Capture correction timestamp

**Post-Correction Actions:**

1. **Update Story File Changelog:**
   ```markdown
   ## Changelog

   ### {CURRENT_DATE_TIME in YYYY-MM-DD HH:MM:SS}
   - Story corrected by Bob (Scrum Master)
   - Iteration: {iteration_count} of 3
   - All PO feedback addressed
   - Ready for re-validation or finalization

   ### {PREVIOUS_ENTRY_DATE}
   - Story validated by Sarah (Product Owner)
   - Validation Status: CHANGES REQUIRED
   ```

2. **Update Draft Tracking JSON:**
   Update `docs/stories/.drafts/story-{story_id}-creation.json`:
   ```json
   {
     "timestamps": {
       ...existing timestamps...,
       "correction_started": "{CORRECTION_START_TIME in ISO 8601}",
       "correction_completed": "{CURRENT_DATE_TIME in ISO 8601}",
       "next_phase": "finalization"
     },
     "corrections": {
       "iteration_count": {iteration_count},
       "max_iterations": 3,
       "corrected_by": "Bob (Scrum Master)",
       "corrected_via": "sm.md *correct-course command",
       "issues_addressed": {issues_count},
       "corrected_at": "{CURRENT_DATE_TIME in ISO 8601}"
     },
     "workflow_step": "4"
   }
   ```

**Iteration Check:**
```bash
if [ {iteration_count} -ge 3 ]; then
  echo "⚠️ WARNING: Maximum correction iterations reached (3)"
  echo "⚠️ Consider splitting story or manual review"
fi
```

**Output:**
- ✅ Story file updated with corrections
- ✅ All PO review comments addressed
- ✅ Changelog updated with correction entry
- ✅ Tracking JSON updated with correction data
- ✅ Iteration count tracked
- Ready for correction commit (Step 4.5)

---

### 4.5. Create Correction Commit on Main Branch

**CRITICAL:** Commit corrections to main branch with changelog and tracking updates.

**Branch Context:**
- ⚠️ **Must be on main branch**
- ⚠️ **This creates the correction commit**

**Timing:**
- ⚠️ **Use CURRENT date and time** for all timestamps

**Actions:**

#### 4.5.1. Commit Corrections

```bash
# Verify we are on main branch
current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
  echo "❌ ERROR: Must be on main branch!"
  exit 1
fi

# Stage story file with corrections and tracking JSON
git add {story_file_path}
git add docs/stories/.drafts/story-{story_id}-creation.json

# Create correction commit
git commit -m "$(cat <<'EOF'
docs(story-{story_id}): Apply PO review corrections

Story {story_id} - {Story Title}

Correction Summary:
- ✅ Corrected by Bob (Scrum Master)
- ✅ Iteration: {iteration_count} of 3
- ✅ All PO feedback addressed
- ✅ Issues fixed: {issues_addressed_count}

Changes Made:
{summary_of_corrections}

Corrected: {CURRENT_DATE_TIME in YYYY-MM-DD HH:MM:SS}

Next Steps:
- Final Documentation (Step 5)
- Set status to Ready (Step 6)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

# Push to main
git push origin main

# Verify push succeeded
if [ $? -eq 0 ]; then
  echo "✅ Corrections committed and pushed to main branch"
  echo "📄 Story file: {story_file_path}"
  echo "📊 Tracking: docs/stories/.drafts/story-{story_id}-creation.json"
  echo "✓ Iteration: {iteration_count} of 3"
else
  echo "❌ ERROR: Failed to push corrections"
  exit 1
fi
```

**Validation:**
- ✓ Story file with corrections committed
- ✓ Tracking JSON with correction data committed
- ✓ Main branch pushed to remote successfully

**Output:**
- Correction commit hash
- Corrections tracked in main branch
- Changelog includes correction entry
- Ready for final documentation (Step 5)

---

### 5. Final Documentation

**PREREQUISITE:** Validation approved (Step 3) or corrections applied (Step 4)

**Branch Context:**
- ⚠️ **Must be on main branch**

**Timing:**
- ⚠️ **Use CURRENT date and time** for all timestamps in metadata updates

**Update Sprint Plan:**

If story is part of a sprint plan, update the sprint plan file to include the new story.

**Actions:**
1. **Locate relevant sprint plan file** (e.g., `docs/stories/SPRINT-N-PLAN.md`)
2. **Add story to sprint backlog** with metadata
3. **Update story status to "Ready"**
4. **Link to story file**

**Sprint Plan Entry Format:**
```markdown
### Story {story_id}: {Story Title}
**Status:** Ready
**Created:** {CURRENT_DATE in YYYY-MM-DD}
**Created By:** Automated Story Creation Workflow v2.0
**Approved By:** Sarah (Product Owner)
**Approved:** {CURRENT_DATE in YYYY-MM-DD}
**File:** {story_file_path}
**Epic:** {epic_path}
```

**Story Status Update:**

Update the story file with final metadata:

```yaml
status: Ready
created_date: {CURRENT_DATE_TIME in YYYY-MM-DD HH:MM:SS}
approved_by: Sarah (Product Owner)
approved_date: {CURRENT_DATE_TIME in YYYY-MM-DD HH:MM:SS}
workflow: automated-story-creation-workflow
workflow_version: 2.0
sm_agent: Bob
po_agent: Sarah
validation_iterations: {iteration_count}
```

**Final Changelog Entry:**
```markdown
## Changelog

### {CURRENT_DATE_TIME in YYYY-MM-DD HH:MM:SS}
- Story status set to: Ready
- Final documentation completed
- Sprint plan updated
- Ready for implementation

### {PREVIOUS_ENTRIES...}
```

**Validation:**
- ✓ Story file finalized with complete metadata
- ✓ Sprint plan updated (if applicable)
- ✓ Story status set to "Ready"
- ✓ All approvals documented
- ✓ Changelog includes final status update
- Ready for Ready status commit (Step 6)

---

### 6. Story Status Update to "Ready"

**CRITICAL:** Commit final status update to main branch with complete tracking.

**Branch Context:**
- ⚠️ **Must be on main branch**
- ⚠️ **This creates the final "Ready" status commit**

**Timing:**
- ⚠️ **Use CURRENT date and time** for all timestamps

**Actions:**

#### 6.1. Create Final Tracking File

**File:** `docs/stories/.drafts/story-{story_id}-ready.json`

⚠️ **All timestamps MUST use current date/time in ISO 8601 format**

```json
{
  "story_id": "{story_id}",
  "story_title": "{story_title}",
  "status": "ready",
  "timestamps": {
    "workflow_started": "{WORKFLOW_START_TIME in ISO 8601}",
    "drafting_completed": "{DRAFTING_COMPLETE_TIME in ISO 8601}",
    "validation_completed": "{VALIDATION_COMPLETE_TIME in ISO 8601}",
    "correction_completed": "{CORRECTION_COMPLETE_TIME in ISO 8601 or null}",
    "ready_status_set": "{CURRENT_DATE_TIME in ISO 8601}",
    "total_duration_minutes": {duration_in_minutes}
  },
  "workflow_metrics": {
    "validation_iterations": {iteration_count},
    "correction_iterations": {correction_count},
    "total_commits": {commit_count}
  },
  "approvals": {
    "sm_drafted": true,
    "po_approved": true,
    "sm_corrected": {true | false}
  },
  "files": {
    "story_file": "{story_file_path}",
    "epic_reference": "{epic_path}",
    "architecture_reference": "{architecture_path}",
    "sprint_plan": "{sprint_plan_path or null}"
  },
  "workflow_version": "2.0",
  "workflow_step": "6"
}
```

#### 6.2. Commit Final Status

```bash
# Verify we are on main branch
current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
  echo "❌ ERROR: Must be on main branch!"
  exit 1
fi

# Stage all final files
git add {story_file_path}
git add docs/stories/SPRINT-*.md 2>/dev/null || true
git add docs/stories/.drafts/story-{story_id}-ready.json

# Create final status commit
git commit -m "$(cat <<'EOF'
docs(story-{story_id}): Set story status to Ready ✅

Story {story_id} - {Story Title}

Status: Ready for Implementation

Workflow Summary:
- ✅ Story drafted by Bob (Scrum Master)
- ✅ Story validated by Sarah (Product Owner)
- ✅ {Corrections applied: {correction_count} iteration(s)}
- ✅ Sprint plan updated
- ✅ All metadata finalized

Metrics:
- Validation Iterations: {iteration_count}
- Total Duration: {duration_minutes} minutes
- Total Commits: {commit_count}

Next Steps:
- Assign to Dev Agent for implementation
- Use automated-dev-qa-sm-workflow for development
- Story ready for sprint planning

Ready: {CURRENT_DATE_TIME in YYYY-MM-DD HH:MM:SS}

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

# Push to main
git push origin main

# Verify push succeeded
if [ $? -eq 0 ]; then
  echo "✅ Story status set to 'Ready' and pushed to main branch"
  echo "📄 Story file: {story_file_path}"
  echo "📊 Final tracking: docs/stories/.drafts/story-{story_id}-ready.json"
  echo "📅 Ready at: {CURRENT_DATE_TIME}"
else
  echo "❌ ERROR: Failed to push final status"
  exit 1
fi
```

**Validation:**
- ✓ Story file with Ready status committed
- ✓ Sprint plan updated and committed (if applicable)
- ✓ Final tracking JSON created and committed
- ✓ Main branch pushed to remote successfully

**Output:**
- Final status commit hash
- Story officially marked as "Ready" on main branch
- Complete tracking metadata available
- Workflow timeline documented
- Ready for workflow summary (Step 7)

---

### 7. Workflow Summary Report

**Generate comprehensive workflow completion report:**

**Report Structure:**

```markdown
# Story Creation Workflow Report

**Story ID:** {story_id}
**Story Title:** {story_title}
**Workflow Version:** 2.0
**Status:** ✓ COMPLETED

## Timeline

| Phase | Start | End | Duration |
|-------|-------|-----|----------|
| Workflow Started | {workflow_start} | - | - |
| Story Drafting | {draft_start} | {draft_end} | {draft_duration} |
| PO Validation | {validation_start} | {validation_end} | {validation_duration} |
| SM Corrections | {correction_start or N/A} | {correction_end or N/A} | {correction_duration or N/A} |
| Finalization | {finalization_start} | {finalization_end} | {finalization_duration} |
| **Total Duration** | - | - | **{total_duration} minutes** |

## Workflow Execution Summary

### Step 1: Story Context Preparation
- **Status:** ✓ Completed
- **Branch:** main
- **Tracking Directory:** docs/stories/.drafts/

### Step 2: Story Drafting
- **Agent:** Bob (Scrum Master)
- **Command:** *draft
- **Status:** ✓ Completed
- **Story File:** {story_file_path}
- **Commit Hash:** {draft_commit_hash}
- **Timestamp:** {draft_timestamp}

### Step 3: Story Validation
- **Agent:** Sarah (Product Owner)
- **Command:** *validate-story-draft
- **Status:** {APPROVED / CHANGES REQUIRED}
- **Issues Found:** {issues_count or 0}
- **Commit Hash:** {validation_commit_hash}
- **Timestamp:** {validation_timestamp}

### Step 4: Story Correction (if needed)
- **Agent:** Bob (Scrum Master)
- **Command:** *correct-course
- **Status:** {COMPLETED / SKIPPED}
- **Iterations:** {iteration_count} of 3
- **Issues Addressed:** {issues_addressed_count or 0}
- **Commit Hash:** {correction_commit_hash or N/A}
- **Timestamp:** {correction_timestamp or N/A}

### Step 5: Final Documentation
- **Story Status:** Ready
- **Sprint Plan Updated:** {YES / NO}
- **Metadata Finalized:** YES
- **Changelog Complete:** YES

### Step 6: Ready Status Set
- **Final Status:** Ready ✅
- **Commit Hash:** {ready_commit_hash}
- **Timestamp:** {ready_timestamp}

## Story Details

**File Location:** {story_file_path}
**Epic Reference:** {epic_path}
**Architecture Reference:** {architecture_path}
**Sprint Plan:** {sprint_plan_path or N/A}

## Acceptance Criteria Summary

{List of acceptance criteria from story}

## Git Commit History

1. **Draft Commit:** {draft_commit_hash}
   - Message: "docs(story-{story_id}): Create story draft"
   - Timestamp: {draft_timestamp}

2. **Validation Commit:** {validation_commit_hash}
   - Message: "docs(story-{story_id}): PO validation {passed/changes required}"
   - Timestamp: {validation_timestamp}

3. **Correction Commit:** {correction_commit_hash or N/A}
   - Message: "docs(story-{story_id}): Apply PO review corrections"
   - Timestamp: {correction_timestamp or N/A}

4. **Ready Commit:** {ready_commit_hash}
   - Message: "docs(story-{story_id}): Set story status to Ready"
   - Timestamp: {ready_timestamp}

**Total Commits:** {total_commit_count}

## Workflow Metrics

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Validation Iterations | {iteration_count} | ≤ 1 | {PASS/WARN} |
| Correction Iterations | {correction_count} | ≤ 1 | {PASS/WARN} |
| Total Duration | {duration} min | < 60 min | {PASS/WARN} |
| Story Completeness | 100% | 100% | PASS |
| Changelog Maintained | YES | YES | PASS |

## Next Steps

✅ Story is ready for implementation
- Assign story to development team
- Dev agent can implement this story
- Use automated-dev-qa-sm-workflow for implementation and testing

## Agent Collaboration

**Scrum Master (Bob):**
- Drafted initial story from epic and architecture
- {Updated story based on PO feedback ({correction_count} iteration(s))}
- Ensured all technical details included

**Product Owner (Sarah):**
- Validated story for quality and completeness
- {Provided feedback for improvements ({issues_count} issues identified)}
- Approved final story version

## Tracking Files

- **Draft Tracking:** docs/stories/.drafts/story-{story_id}-creation.json
- **Final Tracking:** docs/stories/.drafts/story-{story_id}-ready.json

---

**Workflow Completed Successfully** ✅

Story {story_id} is ready for sprint planning and implementation.

**All changes committed to main branch.**
```

**Report Generation Steps:**
1. Generate report using template above
2. Fill in all placeholders with actual workflow data
3. Display report to user
4. Save to `docs/stories/workflow-reports/story-{story_id}-creation-report.md`

**Final Output:**
- ✅ Comprehensive workflow report generated
- ✅ All timestamps and metrics documented
- ✅ Git commit history included
- ✅ Next steps clearly identified
- ✅ Story ready for implementation

---

## Exit Conditions

The workflow completes successfully when ALL of the following are true:

✓ **Story drafted successfully**
- Story file created by Scrum Master
- All required sections populated
- Follows story template structure
- Committed to main branch

✓ **Story validated by Product Owner**
- PO review completed
- All feedback addressed (if changes required)
- Final approval obtained
- Validation results committed to main branch

✓ **Story approved and finalized**
- Story status set to "Ready"
- All documentation complete
- Sprint plan updated (if applicable)
- Final status committed to main branch

✓ **Changelog maintained**
- All workflow stages documented
- Timestamps included for each stage
- Complete audit trail available

✓ **Tracking metadata created**
- Draft tracking JSON created
- Final tracking JSON created
- All commits pushed to main branch

✓ **Workflow report generated**
- Summary report created
- All steps documented
- Metrics calculated
- Next steps identified

---

## Error Handling

### Scrum Master Agent Failure (Drafting)
**Condition:** SM agent fails to create story
**Action:**
1. Document agent failure details with timestamp
2. HALT workflow
3. Report to user with error logs
4. Suggest manual story creation
5. Log failure to tracking JSON

### Product Owner Agent Failure (Validation)
**Condition:** PO agent fails to complete validation
**Action:**
1. Document agent failure details with timestamp
2. HALT workflow
3. Report to user with available feedback
4. Suggest manual validation
5. Log failure to tracking JSON

### Scrum Master Agent Failure (Correction)
**Condition:** SM agent fails to apply corrections
**Action:**
1. Document agent failure details with timestamp
2. Preserve PO feedback
3. HALT workflow
4. Report to user for manual correction
5. Log failure to tracking JSON

### Maximum Iterations Exceeded
**Condition:** PO-SM correction cycle exceeds 3 iterations
**Action:**
1. HALT workflow
2. Generate detailed iteration report
3. Suggest story splitting or manual review
4. Document in tracking JSON
5. Provide recommendations to user

### Missing Context Files
**Condition:** Epic or architecture files not found
**Action:**
1. Report missing file paths
2. Request user to provide correct paths
3. HALT workflow until files available
4. Log error with timestamp

### Story File Conflicts
**Condition:** Story file already exists at destination
**Action:**
1. Report file conflict
2. Ask user for resolution (overwrite/rename/cancel)
3. Proceed based on user decision
4. Log resolution in tracking JSON

### Git Push Failures
**Condition:** Push to main branch fails
**Action:**
1. Report git error details
2. HALT workflow
3. Suggest manual git troubleshooting
4. Preserve all local changes
5. Log failure with timestamp

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Story Completion | 100% | Story drafted, validated, approved, committed |
| PO Approval Rate | First pass preferred | Number of validation iterations ≤ 1 |
| Correction Iterations | ≤ 1 | Number of SM correction cycles |
| Agent Success Rate | 100% | All agents complete tasks successfully |
| Documentation Quality | Complete | All sections filled, changelog maintained |
| Time to Ready | < 60 minutes | Total workflow duration |
| Git Commits | All pushed | All commits on main branch |
| Tracking Completeness | 100% | All JSON tracking files created |

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
1. Verify on main branch and pull latest
2. Spawn Scrum Master (Bob) to draft story
3. Commit draft to main branch (Step 2.5)
4. Spawn Product Owner (Sarah) to validate story
5. Commit validation results to main branch (Step 3.5)
6. If changes required: Spawn Scrum Master (Bob) to apply corrections
7. If corrections applied: Commit corrections to main branch (Step 4.5)
8. Finalize story and update sprint plan
9. Commit final Ready status to main branch (Step 6)
10. Generate comprehensive workflow summary report
11. Report completion to user

**All work tracked on main branch with timestamps and changelog.**

---

## Agent References

**Scrum Master Agent (Bob - Story Preparation Specialist):**
- File: `.bmad-core/agents/sm.md`
- Used for: Story drafting and corrections
- Commands: `*draft`, `*correct-course`
- Spawned via: Task tool with `general-purpose` subagent type

**Product Owner Agent (Sarah - Quality & Validation Specialist):**
- File: `.bmad-core/agents/po.md`
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
- Workflow supports iterative correction loop (max 3 iterations)
- All story operations happen on main branch
- Complete audit trail maintained via changelog and tracking JSON
- All commits pushed to main branch immediately
- Story files follow YAML template structure defined in `story-tmpl.yaml`
- Workflow is designed for AI-assisted story creation pipeline
- Can be integrated into larger sprint planning workflows
- Report generation preserves complete audit trail with timestamps
- Story status progression: Draft → Validated → {Corrected} → Ready
- No feature branches required - simplified git workflow
- Date/time tracking at every stage for full accountability

---

**Task Completion Indicator:**

When this task completes, you will receive:
1. Story file path and ID
2. PO validation status
3. Summary of acceptance criteria
4. Complete workflow execution report with timestamps
5. Git commit history on main branch
6. Story readiness confirmation
7. Next steps recommendation (ready for dev implementation)
8. All tracking metadata in JSON format

**Note:** All story work committed to main branch at each stage. No delayed commits or feature branches required.
