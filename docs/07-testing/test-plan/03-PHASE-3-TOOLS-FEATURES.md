# Phase 3: Tools & Features Testing

**[← Back to Index](README.md)** | **[Overview](00-TESTING-OVERVIEW.md)** | **[← Phase 2](02-PHASE-2-CORE-PAGES.md)** | **[Phase 4 →](04-PHASE-4-CATEGORY-PAGES.md)**

---

## Phase Overview

**Estimated Time:** 2-3 days
**Focus:** IPO Calculator, Allotment Checker, Subscription Tracker, GMP Tracker
**Prerequisites:** Phase 2 complete
**Loop Pattern:** Test ALL → Document → Fix ALL → Re-test → Verify → Gate Check

**Screens:** Lot Calculator, IPO Compare, Allotment Checker, Registrars, Market Holidays

---

## ITERATION 1: Test All Tools

### **26. ✅ ENHANCEMENT #14: Lot Calculator**
```
Test:
- Navigate to /tools/lot-calculator
- IPO selection dropdown populated with current IPOs
- Select an IPO
- Enter investment amount
- Verify lot calculation accuracy:
  - Lots = floor(investment / (lotSize * price))
  - Total amount = lots * lotSize * price
- Test edge cases:
  - Minimum investment
  - Maximum lots
  - Fractional amounts
- Test with price band low and high
- Verify all result fields display
- Test responsive on mobile
```

**🔄 AUTO-IMPROVEMENT TRIGGER:**
```
IF calculation wrong:
  CLASSIFY: Logic Error

  ROOT CAUSE: Check calculation formula

  GENERATE TESTS:
  - [ ] Document expected calculation
  - [ ] Test with known values (manual calculation)
  - [ ] Test edge cases: minimum investment, max lots
  - [ ] Test with different price bands
  - [ ] Verify lot size multiplier correct
  - [ ] Check rounding logic
  - [ ] Test with decimal amounts
  - [ ] Add unit tests for calculation function
  - [ ] Compare with competitor calculators

  EXPAND:
  - [ ] Test ALL IPOs with calculator
  - [ ] Verify lotSize field accurate in database
  - [ ] Test minimum investment calculation

  ADD TO: Iteration 2
```

### **27. ✅ ENHANCEMENT #15: IPO Compare Tool**
```
Test:
- Navigate to /tools/compare
- Multi-select 2-5 IPOs
- Click "Compare"
- Verify comparison table displays side-by-side
- Check all metrics compared:
  - Issue size
  - Price band
  - Open/close dates
  - GMP
  - Subscription data
  - Ratings
  - Financial metrics
- Test sort columns
- Test with different IPO combinations
- Verify responsive on mobile
```

### **28. ✅ ENHANCEMENT #16: Allotment Checker**
```
Test:
- On IPO detail page, find Allotment Checker section
- Test form validation:
  - PAN format: 10 characters, alphanumeric
  - Required field validation
- Enter valid PAN
- Click "Check Allotment" button
- Verify loading state appears
- Check results display (if data available)
- Test error handling: invalid PAN format
- Test external link to registrar site (if redirect)
```

### **29. Registrars Page**
```
Test:
- Navigate to /registrars
- Verify registrars list displays
- Check all 12 fields for each registrar:
  - name, shortName
  - email, phone
  - website, allotmentCheckUrl
  - address, logoUrl
  - active status
- Test search/filter (if exists)
- Verify contact info correct
- Click allotmentCheckUrl links → verify they work
- Test responsive layout
```

### **30. Market Holidays**
```
Test:
- Navigate to /market-holidays
- Verify holiday list displays
- Test filters:
  - Exchange filter (NSE/BSE/BOTH)
  - Month filter
- Verify current year + next year holidays shown
- Check date accuracy (compare with official calendars)
- Verify holiday types (Trading, Settlement, Both)
- Check descriptions accurate
- Test responsive layout
```

---

## ITERATION 2-4: Fix, Re-test, Verify

**Apply all auto-generated tests**

**✅ GATE: Phase 3 Complete - Proceed to Phase 4**

---

## 📝 GIT CHECKPOINT: Commit Phase 3 Results

**Action Required**: Commit all Phase 3 testing work before proceeding to Phase 4.

```bash
# Commit Phase 3 completion
git add TEST_PROGRESS.md TEST_ISSUES.json test-results/phase-3/
git commit -m "test(phase-3): Complete tools & features testing

✅ Lot Calculator accurate for all IPOs
✅ IPO Compare tool validated (2-5 IPO comparison)
✅ Allotment Checker form validation working
✅ Registrars page displays all contact info
✅ Market Holidays accurate (NSE/BSE calendars)
✅ All tools responsive on mobile

Issues resolved: [count] (see TEST_ISSUES.json)
Tools tested: Calculator, Compare, Allotment, Registrars, Holidays"

git push origin test/story-[number]
```

---

**Next Phase:** → [04-PHASE-4-CATEGORY-PAGES.md](04-PHASE-4-CATEGORY-PAGES.md)
