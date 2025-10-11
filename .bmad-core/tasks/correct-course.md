<!-- Powered by BMAD™ Core -->

# Correct Course Task

## Purpose

- Guide a structured response to a change trigger using the `.bmad-core/checklists/change-checklist`.
- Analyze the impacts of the change on epics, project artifacts, and the MVP, guided by the checklist's structure.
- Explore potential solutions (e.g., adjust scope, rollback elements, re-scope features) as prompted by the checklist.
- Draft specific, actionable proposed updates to any affected project artifacts (e.g., epics, user stories, PRD sections, architecture document sections) based on the analysis.
- Produce a consolidated "Sprint Change Proposal" document that contains the impact analysis and the clearly drafted proposed edits for user review and approval.
- Ensure a clear handoff path if the nature of the changes necessitates fundamental replanning by other core agents (like PM or Architect).

## Instructions

### 1. Initial Setup & Mode Selection

- **Acknowledge Task & Inputs:**
  - Confirm with the user that the "Correct Course Task" (Change Navigation & Integration) is being initiated.
  - Verify the change trigger and ensure you have the user's initial explanation of the issue and its perceived impact.
  - Confirm access to all relevant project artifacts (e.g., PRD, Epics/Stories, Architecture Documents, UI/UX Specifications) and, critically, the `.bmad-core/checklists/change-checklist`.
- **Establish Interaction Mode:**
  - Ask the user their preferred interaction mode for this task:
    - **"Incrementally (Default & Recommended):** Shall we work through the change-checklist section by section, discussing findings and collaboratively drafting proposed changes for each relevant part before moving to the next? This allows for detailed, step-by-step refinement."
    - **"YOLO Mode (Batch Processing):** Or, would you prefer I conduct a more batched analysis based on the checklist and then present a consolidated set of findings and proposed changes for a broader review? This can be quicker for initial assessment but might require more extensive review of the combined proposals."
  - Once the user chooses, confirm the selected mode and then inform the user: "We will now use the change-checklist to analyze the change and draft proposed updates. I will guide you through the checklist items based on our chosen interaction mode."

### 2. Execute Checklist Analysis (Iteratively or Batched, per Interaction Mode)

- Systematically work through Sections 1-4 of the change-checklist (typically covering Change Context, Epic/Story Impact Analysis, Artifact Conflict Resolution, and Path Evaluation/Recommendation).
- For each checklist item or logical group of items (depending on interaction mode):
  - Present the relevant prompt(s) or considerations from the checklist to the user.
  - Request necessary information and actively analyze the relevant project artifacts (PRD, epics, architecture documents, story history, etc.) to assess the impact.
  - Discuss your findings for each item with the user.
  - Record the status of each checklist item (e.g., `[x] Addressed`, `[N/A]`, `[!] Further Action Needed`) and any pertinent notes or decisions.
  - Collaboratively agree on the "Recommended Path Forward" as prompted by Section 4 of the checklist.

### 3. Draft Proposed Changes (Iteratively or Batched)

- Based on the completed checklist analysis (Sections 1-4) and the agreed "Recommended Path Forward" (excluding scenarios requiring fundamental replans that would necessitate immediate handoff to PM/Architect):
  - Identify the specific project artifacts that require updates (e.g., specific epics, user stories, PRD sections, architecture document components, diagrams).
  - **Draft the proposed changes directly and explicitly for each identified artifact.** Examples include:
    - Revising user story text, acceptance criteria, or priority.
    - Adding, removing, reordering, or splitting user stories within epics.
    - Proposing modified architecture diagram snippets (e.g., providing an updated Mermaid diagram block or a clear textual description of the change to an existing diagram).
    - Updating technology lists, configuration details, or specific sections within the PRD or architecture documents.
    - Drafting new, small supporting artifacts if necessary (e.g., a brief addendum for a specific decision).
  - If in "Incremental Mode," discuss and refine these proposed edits for each artifact or small group of related artifacts with the user as they are drafted.
  - If in "YOLO Mode," compile all drafted edits for presentation in the next step.

### 4. Document Changes and Generate Summary

- **CRITICAL RULE:** Do NOT create separate "Sprint Change Proposal" files. All changes must be documented directly in the affected artifact files.
- For story changes:
  - Apply all edits directly to the story file
  - Document changes in the story's Change Log section with:
    - Date, new version number, description of changes, author
    - Example: `| 2025-10-11 | 1.1 | PO review changes: (1) Fixed task sequencing, (2) Added icon imports | Bob (Scrum Master) |`
- For epic/PRD/architecture changes:
  - Apply edits directly to those files
  - Add version/change log entries if those files have them
- Synthesize a brief summary analysis (for the user only, not as a separate file) that includes:
  - **Analysis Summary:** Concise overview of the issue, impact analysis, and rationale for changes
  - **Changes Applied:** List of which files were edited and what was changed
  - **Verification:** Confirmation that all checklist items were addressed
- Present this summary to the user for final review. The summary is for communication only - all actual changes should already be in the artifact files.

### 5. Finalize & Determine Next Steps

- Obtain explicit user approval for the changes applied to project artifacts.
- Confirm that all changes are documented in the appropriate change logs.
- **Based on the nature of the approved changes:**
  - **If the approved edits sufficiently address the change and are already applied:** State that the "Correct Course Task" is complete. All changes are documented in the artifact files' change logs. Story status can be updated as needed (e.g., from "Draft" to "Ready").
  - **If the analysis indicates a more fundamental replan is needed (e.g., significant scope change, major architectural rework):** Clearly state this conclusion. Advise the user that the next step involves engaging the primary PM or Architect agents, using the summary analysis as context for that deeper replanning effort.

## Output Deliverables

- **Primary:** Updated project artifact files (stories, epics, PRD, architecture docs) with:
  - All changes applied directly to the files
  - Change log entries documenting what changed, when, and why
  - Version numbers incremented appropriately
- **Secondary:** A verbal/textual summary analysis (presented to user, not saved as separate file) containing:
  - Summary of the change-checklist analysis (issue, impact, rationale)
  - List of files modified and changes applied
  - Verification that all checklist items were addressed
- **Implicit:** An annotated change-checklist (or the record of its completion) reflecting the discussions, findings, and decisions made during the process.
