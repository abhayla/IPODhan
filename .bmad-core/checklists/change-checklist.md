<!-- Powered by BMAD™ Core -->

# Change Navigation Checklist

**Purpose:** To systematically guide the selected Agent and user through the analysis and planning required when a significant change (pivot, tech issue, missing requirement, failed story) is identified during the BMad workflow.

**Instructions:** Review each item with the user. Mark `[x]` for completed/confirmed, `[N/A]` if not applicable, or add notes for discussion points.

[[LLM: INITIALIZATION INSTRUCTIONS - CHANGE NAVIGATION

Changes during development are inevitable, but how we handle them determines project success or failure.

Before proceeding, understand:

1. This checklist is for SIGNIFICANT changes that affect the project direction
2. Minor adjustments within a story don't require this process
3. The goal is to minimize wasted work while adapting to new realities
4. User buy-in is critical - they must understand and approve changes

Required context:

- The triggering story or issue
- Current project state (completed stories, current epic)
- Access to PRD, architecture, and other key documents
- Understanding of remaining work planned

APPROACH:
This is an interactive process with the user. Work through each section together, discussing implications and options. The user makes final decisions, but provide expert guidance on technical feasibility and impact.

REMEMBER: Changes are opportunities to improve, not failures. Handle them professionally and constructively.]]

---

## 1. Understand the Trigger & Context

[[LLM: Start by fully understanding what went wrong and why. Don't jump to solutions yet. Ask probing questions:

- What exactly happened that triggered this review?
- Is this a one-time issue or symptomatic of a larger problem?
- Could this have been anticipated earlier?
- What assumptions were incorrect?

Be specific and factual, not blame-oriented.]]

- [ ] **Identify Triggering Story:** Clearly identify the story (or stories) that revealed the issue.
- [ ] **Define the Issue:** Articulate the core problem precisely.
  - [ ] Is it a technical limitation/dead-end?
  - [ ] Is it a newly discovered requirement?
  - [ ] Is it a fundamental misunderstanding of existing requirements?
  - [ ] Is it a necessary pivot based on feedback or new information?
  - [ ] Is it a failed/abandoned story needing a new approach?
- [ ] **Assess Initial Impact:** Describe the immediate observed consequences (e.g., blocked progress, incorrect functionality, non-viable tech).
- [ ] **Gather Evidence:** Note any specific logs, error messages, user feedback, or analysis that supports the issue definition.

## 2. Epic Impact Assessment

[[LLM: Changes ripple through the project structure. Systematically evaluate:

1. Can we salvage the current epic with modifications?
2. Do future epics still make sense given this change?
3. Are we creating or eliminating dependencies?
4. Does the epic sequence need reordering?

Think about both immediate and downstream effects.]]

- [ ] **Analyze Current Epic:**
  - [ ] Can the current epic containing the trigger story still be completed?
  - [ ] Does the current epic need modification (story changes, additions, removals)?
  - [ ] Should the current epic be abandoned or fundamentally redefined?
- [ ] **Analyze Future Epics:**
  - [ ] Review all remaining planned epics.
  - [ ] Does the issue require changes to planned stories in future epics?
  - [ ] Does the issue invalidate any future epics?
  - [ ] Does the issue necessitate the creation of entirely new epics?
  - [ ] Should the order/priority of future epics be changed?
- [ ] **Summarize Epic Impact:** Briefly document the overall effect on the project's epic structure and flow.

## 3. Artifact Conflict & Impact Analysis

[[LLM: Documentation drives development in BMad. Check each artifact:

1. Does this change invalidate documented decisions?
2. Are architectural assumptions still valid?
3. Do user flows need rethinking?
4. Are technical constraints different than documented?

Be thorough - missed conflicts cause future problems.]]

- [ ] **Review PRD:**
  - [ ] Does the issue conflict with the core goals or requirements stated in the PRD?
  - [ ] Does the PRD need clarification or updates based on the new understanding?
- [ ] **Review Architecture Document:**
  - [ ] Does the issue conflict with the documented architecture (components, patterns, tech choices)?
  - [ ] Are specific components/diagrams/sections impacted?
  - [ ] Does the technology list need updating?
  - [ ] Do data models or schemas need revision?
  - [ ] Are external API integrations affected?
- [ ] **Review Frontend Spec (if applicable):**
  - [ ] Does the issue conflict with the FE architecture, component library choice, or UI/UX design?
  - [ ] Are specific FE components or user flows impacted?
- [ ] **Review Other Artifacts (if applicable):**
  - [ ] Consider impact on deployment scripts, IaC, monitoring setup, etc.
- [ ] **Summarize Artifact Impact:** List all artifacts requiring updates and the nature of the changes needed.

## 4. Path Forward Evaluation

[[LLM: Present options clearly with pros/cons. For each path:

1. What's the effort required?
2. What work gets thrown away?
3. What risks are we taking?
4. How does this affect timeline?
5. Is this sustainable long-term?

Be honest about trade-offs. There's rarely a perfect solution.]]

- [ ] **Option 1: Direct Adjustment / Integration:**
  - [ ] Can the issue be addressed by modifying/adding future stories within the existing plan?
  - [ ] Define the scope and nature of these adjustments.
  - [ ] Assess feasibility, effort, and risks of this path.
- [ ] **Option 2: Potential Rollback:**
  - [ ] Would reverting completed stories significantly simplify addressing the issue?
  - [ ] Identify specific stories/commits to consider for rollback.
  - [ ] Assess the effort required for rollback.
  - [ ] Assess the impact of rollback (lost work, data implications).
  - [ ] Compare the net benefit/cost vs. Direct Adjustment.
- [ ] **Option 3: PRD MVP Review & Potential Re-scoping:**
  - [ ] Is the original PRD MVP still achievable given the issue and constraints?
  - [ ] Does the MVP scope need reduction (removing features/epics)?
  - [ ] Do the core MVP goals need modification?
  - [ ] Are alternative approaches needed to meet the original MVP intent?
  - [ ] **Extreme Case:** Does the issue necessitate a fundamental replan or potentially a new PRD V2 (to be handled by PM)?
- [ ] **Select Recommended Path:** Based on the evaluation, agree on the most viable path forward.

## 5. Change Documentation & Application

[[LLM: CRITICAL - Apply changes directly to artifact files, NOT separate proposal documents. Ensure:

1. All edits are applied to the actual artifact files (stories, epics, PRD, architecture)
2. Change logs in affected files are updated with version numbers, dates, and descriptions
3. A summary analysis is prepared for user communication (not saved as separate file)
4. The issue is explained in plain language
5. Impacts are quantified where possible
6. The recommended path has clear rationale
7. Next steps are specific and assigned
8. Success criteria for the change are defined

NO separate "Sprint Change Proposal" files should be created. All changes live in the artifact files themselves.]]

(Ensure all agreed-upon changes from previous sections are applied directly to artifact files)

- [ ] **Apply Changes to Artifact Files:** Edit story files, epic files, PRD, architecture docs directly
- [ ] **Update Change Logs:** Add entries to each modified file's change log (date, version, description, author)
- [ ] **Prepare Summary Analysis (for user only):** Include:
  - [ ] **Identified Issue Summary:** Clear, concise problem statement
  - [ ] **Epic Impact Summary:** How epics are affected
  - [ ] **Files Modified:** List of documents changed and what was updated
  - [ ] **Recommended Path Forward:** Chosen solution with rationale
  - [ ] **PRD MVP Impact:** Changes to scope/goals (if any)
  - [ ] **High-Level Action Plan:** Next steps for stories/updates
  - [ ] **Agent Handoff Plan:** Identify roles needed (PM, Arch, Design Arch, PO)

## 6. Final Review & Handoff

[[LLM: Changes require coordination. Before concluding:

1. Is the user fully aligned with the plan?
2. Do all stakeholders understand the impacts?
3. Are handoffs to other agents clear?
4. Is there a rollback plan if the change fails?
5. How will we validate the change worked?

Get explicit approval - implicit agreement causes problems.

FINAL SUMMARY:
After completing the checklist, provide a concise summary to the user:

- What changed and why (list of files modified)
- What was done about it (changes applied directly to artifacts)
- Who needs to do what next
- When we'll know if it worked

Keep it action-oriented and forward-looking. Remember: changes are already applied to files, this is just a recap.]]

- [ ] **Review Checklist:** Confirm all relevant items were discussed.
- [ ] **Verify Changes Applied:** Ensure all edits are in the artifact files with proper change log entries.
- [ ] **User Approval:** Obtain explicit user approval for the changes applied.
- [ ] **Confirm Next Steps:** Reiterate the handoff plan and the next actions to be taken by specific agents.

---
