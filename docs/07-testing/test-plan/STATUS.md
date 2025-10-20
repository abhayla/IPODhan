# Test Plan Split Status

**Created:** 2025-01-20
**Purpose:** Track the splitting progress of TESTING_PLAN.md into modular phase-based documents

---

## ✅ Completed Files

### Core Structure (3 files)

1. **README.md** - Master index and navigation
   - Phase overview with estimated times
   - Enhancement index (28 enhancements)
   - Progress tracking template
   - Quick navigation tables
   - Common commands reference

2. **00-TESTING-OVERVIEW.md** - Setup and safety protocols
   - Production database safety protocol (approval process)
   - Database connection setup (4 steps)
   - Git workflow (simplified - no test branches)
   - Auto-improvement mechanism
   - Testing loop pattern explanation
   - Common commands (database, application, cache, Playwright)

3. **SPLITTING-GUIDE.md** - Instructions for completing the split
   - Line number mapping for all phases
   - 3 methods: Manual extraction, PowerShell script, Python script
   - Phase file template
   - Appendix creation guidelines
   - Verification checklist

### Appendices (3 files)

4. **APPENDIX-A-ENHANCEMENTS.md** - Enhancement specifications index
   - Complete index of 28 enhancements with line numbers
   - Category grouping (Data Quality, UI, Tools, Categories, Integration)
   - Extraction instructions
   - Quick reference for complex enhancements

5. **APPENDIX-B-SQL-QUERIES.md** - SQL validation queries
   - Data existence checks
   - Field coverage analysis
   - IPO scoring validation
   - Peer comparison validation
   - Repository pattern queries
   - Data consistency queries
   - Performance analysis queries
   - Quick reference commands

6. **APPENDIX-C-ARCHITECTURE-REFS.md** - Architecture document references
   - Document map (11 key documents)
   - Phase-specific references
   - Quick reference tables (cache keys, performance targets, tables)
   - Repository pattern reference code
   - Architecture Decision Records (ADRs)
   - Cross-reference index

### Utilities (1 file)

7. **split-testing-plan.ps1** - PowerShell automation script
   - Automated splitting by section markers
   - Creates all 5 phase files
   - Adds headers and navigation

---

## ⏳ To Be Created (5 Phase Files)

These files need to be extracted from `web/TESTING_PLAN.md`:

### 1. 01-PHASE-1-DATA-QUALITY.md
**Source Lines:** ~530-2650 (2120 lines)
**Markers:** `## PHASE 1: DATA SCRAPING` → `## PHASE 2: CORE PAGES`
**Content:**
- Phase overview and architecture references
- 4 iterations with 13 enhancements
- Data existence checks (tests #1-6)
- Field coverage analysis
- IPO Scoring System validation (Enhancement #7) - 90 lines
- Peer Comparison validation (Enhancement #8) - 70 lines
- Issue Structure Details (Enhancement #9) - 80 lines
- Enhanced Financial Metrics (Enhancement #10) - 60 lines
- Registrar Directory (Enhancement #11) - 50 lines
- Broker Affiliates (Enhancement #12) - 70 lines
- **Repository Pattern & Cache-Aside Validation (Enhancement #13) - 930 lines**
- Scraper health checks
- Success criteria and git checkpoint

**Key Features:**
- Longest phase document due to Enhancement #13
- Contains comprehensive SQL validation queries
- 7-step repository validation procedure
- Cache HIT/MISS testing
- Graceful degradation testing

---

### 2. 02-PHASE-2-CORE-PAGES.md
**Source Lines:** ~2650-3180 (530 lines)
**Markers:** `## PHASE 2: CORE PAGES` → `## PHASE 3: TOOLS & FEATURES`
**Content:**
- Phase overview and architecture references
- Dashboard filter combinations (Enhancement #7) - 60 lines
- IPO detail sections (Enhancements #8-12) - 150 lines
- Search functionality testing - 40 lines
- Historical IPOs page - 30 lines
- Homepage testing - 25 lines
- Error boundary testing (Enhancement #23) - 15 lines
- Mobile responsiveness (Enhancement #26) - 20 lines
- SEO & structured data (Enhancement #18) - 50 lines
- Success criteria and git checkpoint

**Key Features:**
- UI/UX focused testing
- Playwright headed mode instructions
- Mobile viewport testing (375x667)
- Console error validation

---

### 3. 03-PHASE-3-TOOLS-FEATURES.md
**Source Lines:** ~3180-3460 (280 lines)
**Markers:** `## PHASE 3: TOOLS & FEATURES` → `## PHASE 4: CATEGORY PAGES`
**Content:**
- Phase overview
- Lot Calculator (Enhancement #14) - 50 lines
- IPO Compare Tool (Enhancement #15) - 60 lines
- Allotment Checker (Enhancement #16) - 50 lines
- Registrars page - 35 lines
- Market Holidays - 30 lines
- Success criteria and git checkpoint

**Key Features:**
- Calculation accuracy validation
- Form validation testing
- Multi-IPO comparison logic

---

### 4. 04-PHASE-4-CATEGORY-PAGES.md
**Source Lines:** ~3460-3680 (220 lines)
**Markers:** `## PHASE 4: CATEGORY PAGES` → `## PHASE 5: INTEGRATION`
**Content:**
- Phase overview
- Mainboard vs SME Segregation (Enhancement #17) - 120 lines
- 6 Mainboard pages testing - 50 lines
- 6 SME pages testing - 50 lines
- Special categories (OFS, NCD, Rights, FPO) - 40 lines
- Success criteria and git checkpoint

**Key Features:**
- Category filtering validation
- No cross-contamination verification
- Empty state testing

---

### 5. 05-PHASE-5-INTEGRATION.md
**Source Lines:** ~3680-4100+ (1500+ lines)
**Markers:** `## PHASE 5: INTEGRATION` → end of file
**Content:**
- Phase overview and architecture references
- ISR Testing (Enhancement #19) - 40 lines
- **API Endpoint Testing (Enhancement #20) - 650 lines**
  - 23 existing endpoints
  - **12 Missing API Endpoints subsection - 300 lines**
  - Per-endpoint performance targets matrix - 200 lines
- Rating Calculation (Enhancement #21) - 50 lines
- Database Performance (Enhancement #22) - 70 lines
- **Redis Caching & Fault Tolerance (Enhancement #24) - 600 lines**
  - Basic caching tests - 30 lines
  - Fault tolerance scenarios - 570 lines (3 scenarios + automated tests)
- Logging & Monitoring (Enhancement #25) - 40 lines
- User Journey Testing (4 journeys) - 60 lines
- Data Consistency (Enhancement #27) - 50 lines
- Security Tests (Enhancement #28) - 50 lines
- Success criteria and git checkpoint

**Key Features:**
- Longest phase due to comprehensive API and cache testing
- 12 missing API endpoints with detailed test cases
- Performance targets matrix (p95/p99 by endpoint type)
- 3 cache fault tolerance scenarios
- Automated integration test suite (Vitest)

---

## File Size Estimates

| File | Estimated Lines | Status |
|------|----------------|--------|
| README.md | 200 | ✅ Complete |
| 00-TESTING-OVERVIEW.md | 450 | ✅ Complete |
| 01-PHASE-1-DATA-QUALITY.md | 2120 | ⏳ To Create |
| 02-PHASE-2-CORE-PAGES.md | 530 | ⏳ To Create |
| 03-PHASE-3-TOOLS-FEATURES.md | 280 | ⏳ To Create |
| 04-PHASE-4-CATEGORY-PAGES.md | 220 | ⏳ To Create |
| 05-PHASE-5-INTEGRATION.md | 1500+ | ⏳ To Create |
| APPENDIX-A-ENHANCEMENTS.md | 400 | ✅ Complete (index) |
| APPENDIX-B-SQL-QUERIES.md | 500 | ✅ Complete |
| APPENDIX-C-ARCHITECTURE-REFS.md | 450 | ✅ Complete |
| SPLITTING-GUIDE.md | 300 | ✅ Complete |
| **TOTAL** | **~6950** | **50% Complete** |

---

## How to Complete the Split

### Option 1: Automated with PowerShell

```powershell
cd "d:\Abhay\VibeCoding\IPODhan\docs\07-testing\test-plan"
.\split-testing-plan.ps1
```

This will attempt to auto-create all 5 phase files.

### Option 2: Automated with Python

```bash
cd "d:\Abhay\VibeCoding\IPODhan\docs\07-testing\test-plan"
python split_testing_plan.py
```

(Script provided in SPLITTING-GUIDE.md)

### Option 3: Manual Extraction (Most Reliable)

For each phase:
1. Open `web/TESTING_PLAN.md` in VS Code
2. Go to line number (Ctrl+G)
3. Select content from start marker to end marker
4. Copy to new file
5. Add header template
6. Save as `0X-PHASE-X-NAME.md`

**Recommended for:**
- Phase 1 (contains complex Enhancement #13)
- Phase 5 (contains complex Enhancements #20, #24)

---

## Next Steps

1. **Choose splitting method** (automated or manual)
2. **Create Phase 1** (largest, most complex)
3. **Create Phases 2-4** (straightforward)
4. **Create Phase 5** (second largest, complex)
5. **Verify navigation** (test all links work)
6. **Update README.md** if needed
7. **Delete or archive** original `web/TESTING_PLAN.md`

---

## Benefits of Split Structure

✅ **Completed:**
- Easier navigation (README index)
- Clear safety protocols (00-TESTING-OVERVIEW.md)
- Quick SQL reference (APPENDIX-B)
- Architecture cross-references (APPENDIX-C)

🎯 **After Phase Files Created:**
- Phase-specific focus (work on one phase at a time)
- Smaller files (easier to edit, faster to load)
- Better git diffs (changes isolated to specific phases)
- Parallel work (team members can edit different phases)
- Reusable sections (reference appendices from multiple places)

---

## Quality Checklist

After creating phase files, verify:

- [ ] All phase markers correctly identified
- [ ] No content gaps between phases
- [ ] Headers added with navigation links
- [ ] Cross-references to appendices work
- [ ] Git checkpoint sections present
- [ ] Success criteria clearly stated
- [ ] Architecture references included
- [ ] SQL queries extracted to APPENDIX-B (if not already)
- [ ] Enhancements extracted to APPENDIX-A (if not already)

---

## Support

**Questions about splitting?**
- Refer to SPLITTING-GUIDE.md
- Check line numbers in original file
- Use VS Code's "Go to Line" (Ctrl+G)

**Need help with specific sections?**
- Enhancement #13 (Repository Pattern): Lines 1620-2550
- Enhancement #20 (API Endpoints): Lines 3500-3650
- Enhancement #24 (Cache Fault Tolerance): Lines 3715-4020

---

**Last Updated:** 2025-01-20
**Status:** 7/12 files complete (58%)
**Estimated Time to Complete:** 2-3 hours (manual) or 30 minutes (automated)
