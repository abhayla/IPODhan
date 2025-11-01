# Compare IPOs Tool Test Results

**Page URL**: http://localhost:3000/tools/compare
**Test Date**: Not Started
**Test Pass**: 1
**Tester**: -
**Duration**: -

---

## Test Summary

| Metric | Result |
|--------|--------|
| **Overall Status** | ⏳ Not Started |
| **Test Cases Executed** | 0/15 |
| **IPO Combinations Tested** | 0 |
| **Data Validation** | Not Tested |
| **Issues Found** | 0 |

---

## Snapshot Data

### Page Snapshot
```
[Snapshot data will be captured here using browser_snapshot()]
```

### Visible Elements
- [ ] IPO Selection Dropdown 1
- [ ] IPO Selection Dropdown 2
- [ ] IPO Selection Dropdown 3
- [ ] Add IPO Button
- [ ] Remove IPO Buttons
- [ ] Clear All Button
- [ ] Comparison Table
- [ ] Table Headers

---

## Database Validation

### Query: IPO Comparison Data
```sql
SELECT
  i.id,
  i.companyName,
  i.slug,
  i.category,
  i.status,
  i.issueSize,
  i.priceMin,
  i.priceMax,
  i.lotSize,
  i.openDate,
  i.closeDate,
  i.listingDate,
  s.subscriptionTotal,
  s.subscriptionRetail,
  s.subscriptionQIB,
  s.subscriptionNII,
  g.estimatedGmp,
  g.gmpPercentage,
  f.revenue,
  f.profit,
  f.pe,
  f.eps
FROM ipos i
LEFT JOIN subscriptions s ON i.id = s.ipoId
LEFT JOIN gmpRecords g ON i.id = g.ipoId
LEFT JOIN financialData f ON i.id = f.ipoId
WHERE i.slug IN (?, ?, ?);
```

---

## Test Scenarios

### Scenario 1: Compare 2 IPOs
**IPO 1**: [Select Mainboard IPO]
**IPO 2**: [Select SME IPO]

#### Data Comparison
| Field | IPO 1 (DB) | IPO 1 (UI) | IPO 2 (DB) | IPO 2 (UI) | Match |
|-------|------------|------------|------------|------------|-------|
| Company Name | - | - | - | - | ⏳ |
| Category | - | - | - | - | ⏳ |
| Issue Size | - | - | - | - | ⏳ |
| Price Band | - | - | - | - | ⏳ |
| Lot Size | - | - | - | - | ⏳ |
| Open Date | - | - | - | - | ⏳ |
| Close Date | - | - | - | - | ⏳ |
| Subscription | - | - | - | - | ⏳ |
| GMP | - | - | - | - | ⏳ |
| Revenue | - | - | - | - | ⏳ |
| P/E Ratio | - | - | - | - | ⏳ |

**Issues Found**: -

### Scenario 2: Compare 3 IPOs
**IPO 1**: [Mainboard IPO]
**IPO 2**: [Another Mainboard]
**IPO 3**: [SME IPO]

**Comparison Table Validation**:
- [ ] All three columns display
- [ ] Data aligns correctly
- [ ] No overflow issues
- [ ] Scroll works if needed

**Issues Found**: -

### Scenario 3: Add and Remove
**Test Steps**:
1. Select 2 IPOs
2. Add third IPO
3. Remove middle IPO
4. Verify layout adjusts

**Results**:
- [ ] Add button works
- [ ] Remove button works
- [ ] Layout adjusts properly
- [ ] Data remains accurate

**Issues Found**: -

### Scenario 4: Clear All
**Test Steps**:
1. Select 3 IPOs
2. Click Clear All
3. Verify reset state

**Results**:
- [ ] All selections cleared
- [ ] Table disappears
- [ ] Can select new IPOs
- [ ] No data persistence

**Issues Found**: -

---

## Functional Testing

### Dropdown Functionality
- [ ] All IPOs available in dropdowns
- [ ] Search/filter works in dropdown
- [ ] Can't select same IPO twice
- [ ] Selected IPO disabled in other dropdowns
- [ ] Dropdown shows IPO details

### Button Functionality
- [ ] Add IPO button enables when slot available
- [ ] Remove buttons work for each IPO
- [ ] Clear All removes everything
- [ ] Buttons have proper states (enabled/disabled)

### Table Display
- [ ] Headers display correctly
- [ ] All comparison fields present
- [ ] Data aligns in columns
- [ ] Horizontal scroll if needed
- [ ] Sticky headers when scrolling

### Data Completeness
- [ ] All fields have data where available
- [ ] Empty fields show appropriate placeholder
- [ ] Formatting consistent across IPOs
- [ ] Units displayed (₹, %, etc.)

---

## Comparison Field Validation

### Fields That Must Match Database
| Field | Priority | Format | Notes |
|-------|----------|--------|-------|
| Company Name | P0 | Text | Exact match |
| Issue Size | P0 | ₹ Cr | Formatted number |
| Price Band | P0 | ₹X - ₹Y | Range format |
| Dates | P0 | DD-MM-YYYY | Consistent format |
| Subscription % | P1 | XX.XX% | 2 decimal places |
| GMP | P1 | ₹X (Y%) | Amount and percentage |
| Financial Metrics | P1 | Various | Proper units |
| Category | P0 | Badge | Mainboard/SME/etc |
| Status | P0 | Badge | Open/Closed/etc |

---

## Edge Cases

### Test Matrix
| Test Case | Expected Result | Actual Result | Pass |
|-----------|-----------------|---------------|------|
| Compare IPO with itself (blocked) | Not allowed | - | ⏳ |
| Compare all SME IPOs | Works correctly | - | ⏳ |
| Compare with no financial data | Shows N/A | - | ⏳ |
| Compare upcoming vs listed | All data shows | - | ⏳ |
| Very long company names | Handles gracefully | - | ⏳ |

---

## Performance Metrics

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Page Load Time | < 1s | - | Not Measured |
| IPO Data Load | < 500ms | - | Not Measured |
| Dropdown Population | < 300ms | - | Not Measured |
| Table Render | < 200ms | - | Not Measured |

---

## UI/Visual Testing

### Layout Issues
- [ ] Columns align properly
- [ ] No text truncation
- [ ] Proper spacing between elements
- [ ] Responsive at 1920x1080
- [ ] No horizontal overflow

### Visual Consistency
- [ ] Font sizes consistent
- [ ] Colors match design
- [ ] Badges display correctly
- [ ] Icons if any load
- [ ] Borders/dividers visible

---

## Issues Found

### Critical (P0)
None

### High (P1)
None

### Medium (P2)
None

### Low (P3)
None

---

## Accessibility Testing

- [ ] Keyboard navigation works
- [ ] Dropdowns keyboard accessible
- [ ] Table readable by screen readers
- [ ] Focus indicators visible
- [ ] Color contrast sufficient
- [ ] ARIA labels present

---

## Console Output
```
[Console logs/errors will be captured here]
```

---

## Test Evidence

### Comparison Screenshots
1. 2 IPO Comparison: [Reference]
2. 3 IPO Comparison: [Reference]
3. Edge Cases: [Reference]

### API Calls
- IPO data fetch:
- Response times:
- Failed requests:

---

## Notes & Observations

```
[Any additional notes during testing]
```

---

## Recommendations

1. [Recommendations will be added after testing]
2.
3.

---

## Sign-off

- **Test Completed**: No
- **All Scenarios Tested**: No
- **Ready for Pass 2**: No

---

**Next Steps**: Execute all test scenarios and validate data