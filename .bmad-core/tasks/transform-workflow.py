#!/usr/bin/env python3
"""
Transform automated-dev-qa-sm-workflow-new.md to remove feature branch logic
and add date/time tracking with changelog.
"""

import re
from datetime import datetime

def get_current_timestamp():
    """Get current timestamp in YYYY-MM-DD HH:MM:SS format"""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def transform_workflow(content):
    """Apply all transformations to the workflow content"""

    # 1. Update version and overview to remove feature branch mentions
    content = content.replace("**Version:** 3.3", "**Version:** 4.0")
    content = content.replace("**Version:** 3.2", "**Version:** 4.0")

    # Remove feature branch bullet points from Key Changes
    content = re.sub(
        r'\*\*Key v3\.2 Changes.*?- ✅ Clean merge-only commits to main branch\n\n',
        '**Key v4.0 Changes:**\n'
        '- ✅ All work happens directly on main branch\n'
        '- ✅ Date/time tracking for all workflow stages\n'
        '- ✅ Changelog maintained at all key stages\n'
        '- ✅ Simplified git workflow (no feature branches)\n\n',
        content,
        flags=re.DOTALL
    )

    # 2. Update Step 1 title and remove feature branch setup
    content = re.sub(
        r'### 1\. Story Extraction and Feature Branch Setup',
        '### 1. Story Extraction and Setup',
        content
    )

    # Remove feature branch creation section
    content = re.sub(
        r'2\. \*\*Feature Branch Creation/Verification.*?```\n\n3\. \*\*Branch Isolation Verification:.*?```',
        '2. **Verify Working on Main Branch:**\n'
        '   ```bash\n'
        '   # Verify we are on main branch\n'
        '   git checkout main\n'
        '   git pull origin main\n'
        '   \n'
        '   current_branch=$(git branch --show-current)\n'
        '   if [ "$current_branch" != "main" ]; then\n'
        '     echo "❌ ERROR: Not on main branch!"\n'
        '     exit 1\n'
        '   fi\n'
        '   \n'
        '   echo "✅ Working on main branch"\n'
        '   ```',
        content,
        flags=re.DOTALL
    )

    # Update Step 1 output
    content = re.sub(
        r'\*\*Output:\*\*\n- Story context loaded\n- Acceptance criteria list created\n- Requirements documented\n- \*\*Feature branch created or verified.*?\*\*\n- \*\*Branch isolation confirmed.*?\*\*\n- \*\*Parallel branches acknowledged.*?\*\*',
        '**Output:**\n'
        '- Story context loaded\n'
        '- Acceptance criteria list created\n'
        '- Requirements documented\n'
        '- Working on main branch confirmed\n'
        '- Ready for implementation',
        content,
        flags=re.DOTALL
    )

    # 3. Remove ALL feature branch references in Step 2 (Implementation)
    # Remove feature branch warnings
    content = re.sub(
        r'- ⚠️ \*\*CRITICAL:\*\* Work ONLY on feature branch: feature/story-\{story_id\}.*?\n',
        '',
        content
    )
    content = re.sub(
        r'- ⚠️ \*\*CRITICAL:\*\* Create commits on feature branch during implementation.*?\n',
        '',
        content
    )
    content = re.sub(
        r'- ⚠️ \*\*CRITICAL:\*\* Never switch to main branch during implementation.*?\n',
        '',
        content
    )
    content = re.sub(
        r'- ⚠️ \*\*CRITICAL:\*\* Assume parallel feature branches exist - stay isolated.*?\n',
        '',
        content
    )
    content = re.sub(
        r'- \*\*Commit implementation work to feature branch\*\*.*?\n',
        '- Commit implementation work to main branch regularly\n',
        content
    )
    content = re.sub(
        r'- \*\*Push feature branch to remote regularly\*\*.*?\n',
        '- Push main branch to remote after completing implementation\n',
        content
    )

    # Update Step 2 output
    content = re.sub(
        r'- Feature branch active with all implementation commits\n- Code implemented and committed to feature branch.*?\n- Tests written and committed to feature branch.*?\n- Progress report generated and committed to feature branch.*?\n- Feature branch pushed to remote.*?\n',
        '- Code implemented and committed to main branch\n'
        '- Tests written and committed to main branch\n'
        '- Progress report generated\n'
        '- Changes pushed to main branch\n',
        content
    )

    # 4. Update Step 2.6 to work on main branch and add date tracking
    content = re.sub(
        r'\*\*Branch Context:\*\*\n- ⚠️ \*\*Must be on feature branch: feature/story-\{story_id\}\*\*\n- ⚠️ \*\*This creates a status update commit on feature branch\*\*',
        '**Branch Context:**\n'
        '- ⚠️ **Must be on main branch**\n'
        '- ⚠️ **This creates a status update commit on main**\n'
        '- ⚠️ **Add current date/time to all status fields**',
        content
    )

    # Update git references in Step 2.6
    content = re.sub(
        r'- \*\*Feature Branch:\*\* feature/story-\{story_id\}',
        '- **Main Branch:** main',
        content
    )
    content = re.sub(
        r'feature_branch_commits',
        'main_branch_commits',
        content
    )
    content = re.sub(
        r'"feature_branch": "feature/story-\{story_id\}"',
        '"main_branch": "main"',
        content
    )

    # Update git commands in 2.6.4
    content = re.sub(
        r'# Verify we\'re on feature branch\ncurrent_branch=\$\(git branch --show-current\)\nif \[ "\$current_branch" != "feature/story-\{story_id\}" \]; then\n  echo "❌ ERROR: Must be on feature branch for status update!"\n  exit 1\nfi',
        '# Verify we are on main branch\n'
        'current_branch=$(git branch --show-current)\n'
        'if [ "$current_branch" != "main" ]; then\n'
        '  echo "❌ ERROR: Must be on main branch for status update!"\n'
        '  exit 1\n'
        'fi',
        content
    )

    content = re.sub(
        r'# Push status update to remote\ngit push origin feature/story-\{story_id\}',
        '# Push status update to remote\ngit push origin main',
        content
    )

    # 5. Update Step 3 (Initial Verification)
    content = re.sub(
        r'1\. \*\*Branch Isolation Check.*?\*\*:.*?```\n\n2\. \*\*Feature Branch Validation:\*\*',
        '1. **Main Branch Verification:**\n'
        '   ```bash\n'
        '   # Verify we are still on main branch\n'
        '   current_branch=$(git branch --show-current)\n'
        '   if [ "$current_branch" != "main" ]; then\n'
        '     echo "❌ ERROR: Not on main branch!"\n'
        '     echo "Expected: main"\n'
        '     echo "Actual: $current_branch"\n'
        '     exit 1\n'
        '   fi\n'
        '   \n'
        '   # Verify no uncommitted changes\n'
        '   if ! git diff-index --quiet HEAD --; then\n'
        '     echo "⚠️  WARNING: Uncommitted changes detected"\n'
        '     echo "All implementation should be committed on main branch"\n'
        '   fi\n'
        '   ```\n\n'
        '2. **Implementation Validation:**',
        content,
        flags=re.DOTALL
    )

    # Update validation checks in Step 3
    content = re.sub(
        r'- Verify feature branch exists: `feature/story-\{story_id\}`\n- Confirm implementation commits present on feature branch.*?\n- Review commit history for story-related changes on feature branch.*?\n- \*\*Verify NO commits on main branch\*\*.*?\n',
        '- Confirm implementation commits present on main branch\n'
        '- Review commit history for story-related changes on main branch\n',
        content
    )

    content = re.sub(
        r'- Verify progress report created and committed.*?\n',
        '- Verify progress report created and committed\n',
        content
    )

    content = re.sub(
        r'- ✓ On feature branch \(feature/story-\{story_id\}\).*?\n- ✓ Implementation commits found on feature branch.*?\n- ✓ Main branch untouched.*?\n- ✓ All changes committed to feature branch.*?\n',
        '- ✓ On main branch\n'
        '- ✓ Implementation commits found on main branch\n'
        '- ✓ All changes committed to main\n',
        content
    )

    content = re.sub(
        r'- ✓ Progress report exists and committed.*?\n',
        '- ✓ Progress report exists and committed\n',
        content
    )

    # 6. Update Step 4 (Testing) branch context
    content = re.sub(
        r'\*\*Branch Context \(v3\.2\):\*\*\n- ⚠️ \*\*All tests run on feature branch ONLY\*\*\n- ⚠️ \*\*Never switch to main during testing\*\*\n- ⚠️ \*\*Parallel feature branches may be active - ignore them\*\*',
        '**Branch Context:**\n'
        '- ⚠️ **All tests run on main branch**\n'
        '- ⚠️ **Ensure working directory is clean before testing**',
        content
    )

    # 7. Update Step 5 (Fix Loop) - remove feature branch references
    content = re.sub(
        r'- ⚠️ \*\*CRITICAL:\*\* Work ONLY on feature branch: feature/story-\{story_id\}.*?\n',
        '',
        content
    )
    content = re.sub(
        r'- ⚠️ \*\*CRITICAL:\*\* Commit all fixes to feature branch.*?\n',
        '- Commit all fixes to main branch\n',
        content
    )
    content = re.sub(
        r'- ⚠️ \*\*CRITICAL:\*\* Never switch to main branch.*?\n',
        '',
        content
    )
    content = re.sub(
        r'- \*\*Commit fixes to feature branch after verification\*\*.*?\n',
        '- Commit fixes to main branch after verification\n',
        content
    )

    # 8. Update Step 7 title and remove feature branch references
    content = re.sub(
        r'### 7\. Final Validation on Feature Branch \(UPDATED in v3\.2\)',
        '### 7. Final Validation on Main Branch',
        content
    )

    content = re.sub(
        r'\*\*Branch Context.*?\*\*:\n- ⚠️ \*\*Still on feature branch: feature/story-\{story_id\}\*\*\n- ⚠️ \*\*Do NOT merge yet - validation first\*\*\n\n\*\*Comprehensive Validation on Feature Branch:\*\*',
        '**Branch Context:**\n'
        '- ⚠️ **Working on main branch**\n'
        '- ⚠️ **All validation happens before final commit**\n\n'
        '**Comprehensive Validation on Main Branch:**',
        content
    )

    content = re.sub(
        r'# Verify we\'re still on feature branch\ncurrent_branch=\$\(git branch --show-current\)\nif \[ "\$current_branch" != "feature/story-\{story_id\}" \]; then\n  echo "❌ ERROR: Not on feature branch!"\n  exit 1\nfi',
        '# Verify we are still on main branch\n'
        'current_branch=$(git branch --show-current)\n'
        'if [ "$current_branch" != "main" ]; then\n'
        '  echo "❌ ERROR: Not on main branch!"\n'
        '  exit 1\n'
        'fi',
        content
    )

    content = re.sub(
        r'✅ \*\*Git State \(NEW in v3\.2\)\*\*\n- \[ \] All work committed on feature branch\n- \[ \] Feature branch pushed to remote\n- \[ \] Main branch untouched\n- \[ \] Clean working directory',
        '✅ **Git State**\n'
        '- [ ] All work committed on main branch\n'
        '- [ ] Main branch ready for final commit\n'
        '- [ ] Clean working directory',
        content
    )

    content = re.sub(
        r'- \*\*Feature branch ready for merge\*\*.*?\n',
        '- **Main branch ready for final QA commit**\n',
        content
    )

    # 9. COMPLETELY REPLACE Step 8 (Remove QA commit on feature branch, replace with QA validation commit on main)
    step8_pattern = r'### 8\. QA Validation Commit on Feature Branch.*?---\n\n### 9\. Merge Feature Branch to Main'
    step8_replacement = '''### 8. QA Validation Commit on Main Branch

**CRITICAL:** This step creates the final QA validation commit on main branch with date/time tracking and changelog update.

**Branch Context:**
- ⚠️ **Must be on main branch**
- ⚠️ **This is the commit marking implementation complete**
- ⚠️ **Includes changelog update**

**Timing:**
- ⚠️ **Use CURRENT date and time** for all timestamps
- Format: `YYYY-MM-DD HH:MM:SS` for display timestamps
- Timezone: Use local timezone or UTC (be consistent)

**Actions:**

#### 8.1. Update Story Status to "Ready for QA"

Update story file with current date/time:

```bash
# Verify we are on main branch
current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
  echo "❌ ERROR: Must be on main branch!"
  exit 1
fi

# Update story status with current date/time
# Add to story file:
# Status: Ready for QA
# Implementation Complete: {CURRENT_DATE_TIME in YYYY-MM-DD HH:MM:SS}
```

#### 8.2. Add or Update Changelog Entry

**CRITICAL:** Add changelog entry for implementation completion.

If Changelog section doesn't exist in story file, add it after Status section:

```markdown
## Status
Ready for QA

## Changelog

### {CURRENT_DATE_TIME}
- Status changed to: Ready for QA
- Implementation completed
- All tests passed
- All acceptance criteria met
```

If Changelog exists, prepend new entry:

```markdown
## Changelog

### {CURRENT_DATE_TIME}
- Status changed to: Ready for QA
- Implementation completed
- All tests passed
- All acceptance criteria met

### {PREVIOUS_ENTRY_DATE}
- {Previous entry content}
```

#### 8.3. Create QA Validation Commit

```bash
# Stage all changes including story files with changelog
git add .

# Create QA validation commit
git commit -m "$(cat <<'EOF'
test(story-{story_id}): QA validation passed - Implementation complete

- All acceptance criteria verified
- Test coverage: {coverage}%
- Zero defects found
- Ready for production
- SM approved

Story: {story_id}
QA Status: ✓ Passed
Iterations: {iteration_count}
Completed: {CURRENT_DATE_TIME in YYYY-MM-DD HH:MM:SS}

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

# Push to main
git push origin main
```

**Validation:**
- ✓ QA commit created on main branch
- ✓ Main branch pushed to remote
- ✓ Changelog updated with current date/time
- ✓ Story status reflects completion

**Output:**
- QA validation commit hash
- Main branch fully validated
- Changelog updated with implementation completion
- Ready for final status update

---

### 9. Story Status Update to "Done"'''

    content = re.sub(step8_pattern, step8_replacement, content, flags=re.DOTALL)

    # 10. COMPLETELY REPLACE Step 9 (Remove merge logic, replace with final status update)
    step9_pattern = r'### 9\. Merge Feature Branch to Main.*?---\n\n### 10\. Story Status Update'
    step9_replacement = '''### 9. Story Status Update to "Done"

**CRITICAL:** Update story status to "Done" with date/time tracking and final changelog entry.

**Branch Context:**
- ⚠️ **Must be on main branch**
- ⚠️ **This creates final status update commit**
- ⚠️ **Includes final changelog update**

**Timing:**
- ⚠️ **Use CURRENT date and time** for all timestamps
- Format: `YYYY-MM-DD HH:MM:SS` for display timestamps
- Format: ISO 8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`) for JSON timestamps
- Timezone: Use local timezone or UTC (be consistent)

**Status Update Actions:**

#### 9.1. Update Sprint Plan Status

**File:** `docs/stories/SPRINT-N-PLAN.md`

```bash
# Locate the story entry in sprint plan
story_line=$(grep -n "Story ${story_id}:" docs/stories/SPRINT-*.md | cut -d: -f1)

# Update story status to "Done"
# Common patterns:
# - "Status: Ready for QA" → "Status: Done ✅"
# - "- [~] Story X.Y" → "- [x] Story X.Y"
# - "Story X.Y | Ready for QA" → "Story X.Y | Done"
```

**Status Update Fields:**
```yaml
Status: Done ✅
Completed Date: {CURRENT_DATE in YYYY-MM-DD format}
Completed Time: {CURRENT_TIME in HH:MM:SS format}
QA Status: Passed
SM Approval: Yes
```

#### 9.2. Update Story File with Final Changelog Entry

Add final changelog entry with current date/time:

```markdown
## Changelog

### {CURRENT_DATE_TIME}
- Status changed to: Done ✅
- SM review completed and approved
- Merged to main branch
- All acceptance criteria validated
- Story completed successfully

### {PREVIOUS_ENTRY_DATE}
- Status changed to: Ready for QA
- Implementation completed
- All tests passed
```

#### 9.3. Create Completion Tracking File

**File:** `docs/stories/.completed/story-{story_id}-completion.json`

⚠️ **All timestamps MUST use current date/time**

```json
{
  "story_id": "{story_id}",
  "story_title": "{story_title}",
  "status": "done",
  "timestamps": {
    "started": "{START_TIME in ISO 8601}",
    "implementation_complete": "{IMPLEMENTATION_COMPLETE_TIME in ISO 8601}",
    "qa_passed": "{QA_PASSED_TIME in ISO 8601}",
    "completed": "{CURRENT_DATE_TIME in ISO 8601}"
  },
  "completion_metrics": {
    "task_completion_percent": 100,
    "ac_completion_percent": 100,
    "test_coverage_percent": {coverage},
    "qa_iterations": {iteration_count}
  },
  "approvals": {
    "sm_approved": true,
    "sm_approved_at": "{CURRENT_DATE_TIME in ISO 8601}",
    "qa_passed": true,
    "qa_passed_at": "{QA_PASSED_TIME in ISO 8601}"
  },
  "workflow_version": "4.0",
  "workflow_step": "9.3"
}
```

#### 9.4. Commit Final Status Update

```bash
# Verify we are on main branch
current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
  echo "❌ ERROR: Must be on main branch!"
  exit 1
fi

# Create directory for completion tracking if needed
mkdir -p docs/stories/.completed

# Stage all status update files
git add docs/stories/SPRINT-*.md
git add docs/stories/${story_id}.*.story.md 2>/dev/null || true
git add docs/stories/*${story_id}*.story.md 2>/dev/null || true
git add docs/stories/.completed/story-{story_id}-completion.json

# Create final status update commit
git commit -m "$(cat <<'EOF'
docs(story-{story_id}): Update story status to Done ✅

Story {story_id} - {Story Title}

Status Changes:
- Sprint Plan: Ready for QA → Done ✅
- Story File: Updated with final changelog entry
- Completion Tracking: Created story-{story_id}-completion.json

Completion Summary:
- ✅ All tasks completed (100%)
- ✅ All acceptance criteria validated (100%)
- ✅ All tests passed
- ✅ QA validation passed
- ✅ SM approved

Completed: {CURRENT_DATE_TIME in YYYY-MM-DD HH:MM:SS format}

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

# Push final status update to remote
git push origin main

# Verify push succeeded
if [ $? -eq 0 ]; then
  echo "✅ Story status updated to 'Done ✅' and pushed to remote"
  echo "📊 Sprint plan, story file, and completion tracking updated"
  echo "📅 Completed at: {CURRENT_DATE_TIME}"
else
  echo "❌ ERROR: Failed to push status update"
  exit 1
fi
```

**Validation:**
- ✓ Sprint plan status updated to "Done ✅"
- ✓ Story file updated with final changelog entry
- ✓ Completion tracking JSON created
- ✓ Final status commit created on main
- ✓ Main pushed to remote successfully

**Output:**
- Story officially marked as "Done ✅"
- Completion timestamp recorded in multiple places
- Changelog includes full history of status changes
- Final status update commit hash
- Story workflow complete

---

### 10. Final QA Report Generation'''

    content = re.sub(step9_pattern, step9_replacement, content, flags=re.DOTALL)

    # 11. Update Step 10 title (was "Story Status Update", now "Final QA Report Generation")
    content = re.sub(
        r'### 10\. Story Status Update \(NEW in v3\.3\)',
        '### 10. Final QA Report Generation',
        content
    )

    # Remove the old Step 10 content about status updates (it's now in Step 9)
    # Keep only QA report generation logic

    # 12. Update Step 11 (Scrum Master Review Notification) - was previously scattered, now consolidate
    content = re.sub(
        r'### 11\. QA Report Generation',
        '### 11. Scrum Master Review Notification',
        content
    )

    # 13. Replace all remaining feature branch references with main branch
    content = re.sub(r'feature/story-\{story_id\}', 'main', content)
    content = re.sub(r'feature branch', 'main branch', content)
    content = re.sub(r'Feature branch', 'Main branch', content)
    content = re.sub(r'Feature Branch', 'Main Branch', content)

    # 14. Update version history at end of file
    content = re.sub(
        r'\*\*Version:\*\* 3\.3\n\*\*Last Updated:\*\* 2025-10-16',
        f'**Version:** 4.0\n**Last Updated:** {get_current_timestamp().split()[0]}',
        content
    )

    # Add changelog update notes in version history
    version_history_addition = '''

## Version 4.0 Changes

**Major Changes:**
1. **Removed Feature Branch Workflow:**
   - All work now happens directly on main branch
   - No feature branch creation/merging steps
   - Simplified git workflow for linear development

2. **Added Date/Time Tracking:**
   - Current date/time used throughout workflow
   - Format: YYYY-MM-DD HH:MM:SS
   - Tracked at implementation, QA validation, and completion stages

3. **Added Changelog Tracking:**
   - Changelog section added to all story files
   - Updated at 4 key stages:
     * After implementation complete (Step 8)
     * After SM review (during Step 6)
     * After QA validation (Step 8)
     * After final completion (Step 9)
   - Changelog placed immediately after Status section

4. **Simplified Git Commands:**
   - `git checkout main` - work on main throughout
   - `git add . && git commit` - commit directly to main
   - `git push origin main` - push main regularly
   - No branch creation, switching, or merging

**Breaking Changes:**
- NOT backward compatible with v3.x workflows
- Requires all new stories to use v4.0 workflow
- Existing feature branches should be merged before upgrading

**Migration Guide:**
- Merge all open feature branches to main
- Update workflow references from v3.x to v4.0
- Ensure team understands new main-branch-only approach
'''

    content = content.replace(
        '**Backward Compatible:** Yes (v3.3 is fully compatible with v3.2 workflows)',
        f'**Backward Compatible:** No (v4.0 is NOT compatible with v3.x workflows){version_history_addition}'
    )

    return content

def main():
    input_file = r"D:\Abhay\VibeCoding\IPODhan\.bmad-core\tasks\automated-dev-qa-sm-workflow-new.md"
    output_file = r"D:\Abhay\VibeCoding\IPODhan\.bmad-core\tasks\automated-dev-qa-sm-workflow-new.md"

    print("Reading workflow file...")
    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()

    print("Applying transformations...")
    transformed_content = transform_workflow(content)

    print("Writing updated workflow file...")
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(transformed_content)

    print(f"✅ Transformation complete!")
    print(f"✅ Updated file: {output_file}")
    print(f"✅ Version updated to 4.0")
    print(f"✅ All feature branch logic removed")
    print(f"✅ Date/time tracking added")
    print(f"✅ Changelog tracking added")

if __name__ == '__main__':
    main()
