# Phase 4: Category Pages Testing

**[← Back to Index](README.md)** | **[Overview](00-TESTING-OVERVIEW.md)** | **[← Phase 3](03-PHASE-3-TOOLS-FEATURES.md)** | **[Phase 5 →](05-PHASE-5-INTEGRATION.md)**

---

## Phase Overview

**Estimated Time:** 1-2 days
**Focus:** Mainboard, SME, Closed IPOs, Listed IPOs, Rights Issues pages
**Prerequisites:** Phase 3 complete
**Test Mode:** Headed Mode (visual browser testing)

**Loop Pattern:** Test ALL → Document → Fix ALL → Re-test → Verify → Gate Check

---

## ITERATION 1: Test All Category Pages

### 31. ✅ ENHANCEMENT #17: Mainboard vs SME Segregation

**Mainboard Pages:**
```
Test each:
- /mainboard-ipos (landing)
- /mainboard-ipo-calendar
- /mainboard-ipo-performance-tracker
- /mainboard-ipo-prospectus
- /mainboard-ipo-listings
- /mainboard-ipo-reviews

For each page:
✓ Verify only MAINBOARD category IPOs shown
✓ Count accuracy on landing page
✓ No SME IPOs mixed in
✓ Filters work correctly
✓ Navigation works
```

**SME Pages:**
```
Test each:
- /sme-ipos (landing)
- /sme-ipo-calendar
- /sme-ipo-performance-tracker
- /sme-ipo-prospectus
- /sme-ipo-listings
- /sme-ipo-reviews

For each page:
✓ Verify only SME category IPOs shown
✓ Count accuracy
✓ No MAINBOARD IPOs mixed in
✓ Filters work correctly
```

**API Endpoints:**
```
Test:
- GET /api/prospectus/mainboard → only MAINBOARD
- GET /api/prospectus/sme → only SME
- GET /api/reviews/mainboard → only MAINBOARD
- GET /api/reviews/sme → only SME
```

### 32. ✅ ENHANCEMENT #18: Special Categories

**Test each category page:**
```
- /ofs (Offer for Sale)
- /ncd (Non-Convertible Debentures)
- /rights-issues
- /fpo-listings (Follow-on Public Offering)
```

**For each page:**
```
✓ Page loads without errors
✓ Check if data exists for this category
✓ If data exists: verify correct category shown
✓ If no data: verify proper empty state message
✓ Check schema supports category (ipos.category enum)
✓ Verify category filter works on dashboard
```

**Schema Check:**
```sql
-- Verify categories in schema
SELECT DISTINCT category FROM ipos;
-- Should include: MAINBOARD, SME, RIGHTS, NCD, FPO

-- Check if OFS is missing from schema
-- If so, add to packages/shared/src/db/schema.ts
-- Follow migration workflow: db:generate → review SQL → db:migrate
```

### 33. All Category Landing Pages (14 pages total)

```
Test:
- Data displays correctly
- Filters work (if applicable)
- Search functions (if applicable)
- Navigation to detail pages works
- Empty states for no data
- Pagination works
- Mobile responsive
```

---

## ITERATION 2-4: Fix, Re-test, Verify

Follow the standard loop pattern:
1. **ITERATION 2**: Fix all issues found in Iteration 1
2. **ITERATION 3**: Re-test all fixes
3. **ITERATION 4**: Verify all category pages work correctly

---

## ✅ GATE: Phase 4 Complete - Proceed to Phase 5

**Completion Criteria:**
- [ ] All 12 Mainboard/SME pages tested
- [ ] All 4 special category pages tested
- [ ] API endpoints filter correctly by category
- [ ] Empty states verified for categories with no data
- [ ] All issues documented in TEST_ISSUES.json
- [ ] All critical bugs fixed

---

## 📝 GIT CHECKPOINT: Commit Phase 4 Results

**Action Required**: Commit all Phase 4 testing work before proceeding to Phase 5.

```bash
# Commit Phase 4 completion
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-4/
git commit -m "test(phase-4): Complete category pages testing

✅ Mainboard vs SME segregation verified (12 pages)
✅ All category pages display correct data
✅ Special categories tested (OFS, NCD, Rights, FPO)
✅ API endpoints filter by category correctly
✅ Empty states for categories with no data
✅ All 14 category landing pages functional

Issues resolved: [count] (see TEST_ISSUES.json)
Pages tested: MAINBOARD (6), SME (6), Special categories (4)"

git push origin test/story-[number]
```

---

**Next Phase:** → [05-PHASE-5-INTEGRATION.md](05-PHASE-5-INTEGRATION.md)
