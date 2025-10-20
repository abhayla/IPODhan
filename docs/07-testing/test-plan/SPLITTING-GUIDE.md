# How to Split TESTING_PLAN.md

This guide explains how to complete the split of `web/TESTING_PLAN.md` into the phase-based structure.

## Current Status

✅ **Created:**
- README.md (master index with navigation)
- 00-TESTING-OVERVIEW.md (safety protocol, git workflow, setup)

⏳ **To Create:**
- 01-PHASE-1-DATA-QUALITY.md
- 02-PHASE-2-CORE-PAGES.md
- 03-PHASE-3-TOOLS-FEATURES.md
- 04-PHASE-4-CATEGORY-PAGES.md
- 05-PHASE-5-INTEGRATION.md
- APPENDIX-A-ENHANCEMENTS.md
- APPENDIX-B-SQL-QUERIES.md
- APPENDIX-C-ARCHITECTURE-REFS.md

---

## Line Number Mapping

From `web/TESTING_PLAN.md` (4100+ lines):

| Target File | Source Lines | Markers |
|-------------|--------------|---------|
| 01-PHASE-1 | ~530-2650 | `## PHASE 1` → `## PHASE 2` |
| 02-PHASE-2 | ~2650-3180 | `## PHASE 2` → `## PHASE 3` |
| 03-PHASE-3 | ~3180-3460 | `## PHASE 3` → `## PHASE 4` |
| 04-PHASE-4 | ~3460-3680 | `## PHASE 4` → `## PHASE 5` |
| 05-PHASE-5 | ~3680-4100+ | `## PHASE 5` → end |

---

## Method 1: Manual Extraction (Recommended)

### Step 1: Open Source File
```bash
# Open in VS Code
code d:\Abhay\VibeCoding\IPODhan\web\TESTING_PLAN.md
```

### Step 2: Find Phase Markers
Use Ctrl+F to find:
- `## PHASE 1: DATA SCRAPING` (line ~530)
- `## PHASE 2: CORE PAGES` (line ~2650)
- `## PHASE 3: TOOLS &` (line ~3180)
- `## PHASE 4: CATEGORY` (line ~3460)
- `## PHASE 5: INTEGRATION` (line ~3680)

### Step 3: Copy Content
For each phase:
1. Select from phase header to next phase header
2. Copy content (Ctrl+C)
3. Create new file: `0X-PHASE-X-NAME.md`
4. Add header template (see below)
5. Paste content
6. Save

---

## Method 2: PowerShell Script

### Using the Provided Script

```powershell
cd "d:\Abhay\VibeCoding\IPODhan\docs\07-testing\test-plan"
.\split-testing-plan.ps1
```

This will attempt to auto-split based on section markers.

---

## Method 3: Python Script (Alternative)

```python
# save as split_testing_plan.py
import re

source_file = r"d:\Abhay\VibeCoding\IPODhan\web\TESTING_PLAN.md"
output_dir = r"d:\Abhay\VibeCoding\IPODhan\docs\07-testing\test-plan"

with open(source_file, 'r', encoding='utf-8') as f:
    content = f.read()

# Define phase boundaries
phases = {
    "01-PHASE-1-DATA-QUALITY.md": ("## PHASE 1: DATA SCRAPING", "## PHASE 2: CORE PAGES"),
    "02-PHASE-2-CORE-PAGES.md": ("## PHASE 2: CORE PAGES", "## PHASE 3: TOOLS & FEATURES"),
    "03-PHASE-3-TOOLS-FEATURES.md": ("## PHASE 3: TOOLS & FEATURES", "## PHASE 4: CATEGORY PAGES"),
    "04-PHASE-4-CATEGORY-PAGES.md": ("## PHASE 4: CATEGORY PAGES", "## PHASE 5: INTEGRATION"),
    "05-PHASE-5-INTEGRATION.md": ("## PHASE 5: INTEGRATION", "---\n\n**END OF TESTING PLAN**")
}

for filename, (start_marker, end_marker) in phases.items():
    start_pos = content.find(start_marker)
    end_pos = content.find(end_marker)

    if start_pos != -1 and end_pos != -1:
        phase_content = content[start_pos:end_pos]

        # Add header
        header = f"""# {filename.replace('.md', '').replace('0', '').replace('-', ' ').title()}

**[← Back to Index](README.md)** | **[Overview](00-TESTING-OVERVIEW.md)**

---

"""

        full_content = header + phase_content

        # Write file
        output_path = f"{output_dir}/{filename}"
        with open(output_path, 'w', encoding='utf-8') as out:
            out.write(full_content)

        print(f"✓ Created {filename}")

print("\nSplit complete!")
```

Run with:
```bash
python split_testing_plan.py
```

---

## Phase File Template

Each phase file should have this header:

```markdown
# Phase X: [Name]

**[← Back to Index](README.md)** | **[Overview](00-TESTING-OVERVIEW.md)**

---

## Phase Overview

**Estimated Time:** X-Y days
**Focus:** [Main focus area]
**Prerequisites:** [What must be done before this phase]

---

## Architecture References

Review these before starting:
- [Relevant architecture doc 1]
- [Relevant architecture doc 2]

---

[PHASE CONTENT FROM TESTING_PLAN.MD]

---

## Success Criteria

[Phase-specific success criteria]

---

## Git Checkpoint

```bash
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-X/
git commit -m "test(phase-X): [Summary]"
git push origin main
```

---

**Next Phase:** → [0Y-PHASE-Y-NAME.md](0Y-PHASE-Y-NAME.md)
```

---

## Creating Appendix Files

### APPENDIX-A-ENHANCEMENTS.md

Extract all enhancement sections (`## Enhancement #X`) from the original file and organize by enhancement number.

Template:
```markdown
# Appendix A: Enhancement Specifications

**[← Back to Index](README.md)**

---

## Enhancement Index

| # | Name | Phase | Location |
|---|------|-------|----------|
| #1 | Open IPOs Page | Phase 1 | [Link](#enhancement-1) |
| #2 | Upcoming IPOs | Phase 1 | [Link](#enhancement-2) |
| ... | ... | ... | ... |

---

## Enhancement #1: Open IPOs Page

[Full specification from original file]

---

## Enhancement #2: Upcoming IPOs Page

[Full specification from original file]

...
```

### APPENDIX-B-SQL-QUERIES.md

Extract all SQL query blocks and organize by purpose.

Template:
```markdown
# Appendix B: SQL Queries Reference

**[← Back to Index](README.md)**

---

## Quick Index

- [Data Existence Checks](#data-existence)
- [Field Coverage Analysis](#field-coverage)
- [Performance Queries](#performance)
- [Validation Queries](#validation)

---

## Data Existence Checks

```sql
[All data existence queries]
```

---

## Field Coverage Analysis

```sql
[All field coverage queries]
```

...
```

### APPENDIX-C-ARCHITECTURE-REFS.md

Create reference guide to architecture documents.

Template:
```markdown
# Appendix C: Architecture References

**[← Back to Index](README.md)**

---

## Document Map

| Document | Purpose | Key Sections |
|----------|---------|--------------|
| backend-architecture.md | Repository pattern, service layer | Repository Pattern, Cache-Aside |
| caching-strategy.md | Redis caching patterns | Cache Keys, TTL, Invalidation |
| ... | ... | ... |

---

## Phase-Specific References

### Phase 1: Data Quality
- Schema: `packages/shared/src/db/schema.ts`
- Scrapers: `scraper/README.md`
- Schema Management: `docs/16-database/SCHEMA_MANAGEMENT.md`

### Phase 2: Core Pages
- Backend: `docs/02-architecture/backend-architecture.md`
- API Spec: `docs/02-architecture/api-specification.md`

...
```

---

## Verification Checklist

After splitting:

- [ ] All 8 files created (5 phases + 3 appendices)
- [ ] README.md navigation links work
- [ ] Cross-references between files work
- [ ] Each phase has header with navigation
- [ ] Git checkpoint sections present
- [ ] Success criteria clearly stated
- [ ] Architecture references included

---

## Quick Split Commands

```bash
# Create all phase files at once (Linux/Mac)
cd "d:\Abhay\VibeCoding\IPODhan\web"

# Phase 1
sed -n '/## PHASE 1: DATA SCRAPING/,/## PHASE 2: CORE PAGES/p' TESTING_PLAN.md > ../docs/07-testing/test-plan/01-PHASE-1-DATA-QUALITY.md

# Phase 2
sed -n '/## PHASE 2: CORE PAGES/,/## PHASE 3: TOOLS & FEATURES/p' TESTING_PLAN.md > ../docs/07-testing/test-plan/02-PHASE-2-CORE-PAGES.md

# Phase 3
sed -n '/## PHASE 3: TOOLS & FEATURES/,/## PHASE 4: CATEGORY PAGES/p' TESTING_PLAN.md > ../docs/07-testing/test-plan/03-PHASE-3-TOOLS-FEATURES.md

# Phase 4
sed -n '/## PHASE 4: CATEGORY PAGES/,/## PHASE 5: INTEGRATION/p' TESTING_PLAN.md > ../docs/07-testing/test-plan/04-PHASE-4-CATEGORY-PAGES.md

# Phase 5
sed -n '/## PHASE 5: INTEGRATION/,$p' TESTING_PLAN.md > ../docs/07-testing/test-plan/05-PHASE-5-INTEGRATION.md
```

---

## Support

If you need help:
1. Check line numbers in original TESTING_PLAN.md
2. Use VS Code's "Go to Line" (Ctrl+G)
3. Verify section markers with Ctrl+F

**Questions?** Open an issue or ask Claude for assistance with specific sections.
