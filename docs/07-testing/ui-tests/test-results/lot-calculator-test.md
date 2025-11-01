# Lot Calculator Test Results

**Page URL**: http://localhost:3000/tools/lot-calculator
**Test Date**: Not Started
**Test Pass**: 1
**Tester**: -
**Duration**: -

---

## Test Summary

| Metric | Result |
|--------|--------|
| **Overall Status** | ⏳ Not Started |
| **Test Cases Executed** | 0/20 |
| **Calculations Verified** | 0 |
| **Issues Found** | 0 |
| **Data Validation** | Not Tested |

---

## Snapshot Data

### Page Snapshot
```
[Snapshot data will be captured here using browser_snapshot()]
```

### Visible Elements
- [ ] IPO Selection Dropdown
- [ ] Investment Amount Input
- [ ] Price Selection (Min/Max/Custom)
- [ ] Custom Price Input
- [ ] Calculate Button
- [ ] Clear/Reset Button
- [ ] Results Display Area

---

## Database Validation

### Query: IPO List with Lot Details
```sql
SELECT
  id,
  companyName,
  slug,
  priceMin,
  priceMax,
  lotSize,
  minInvestment,
  category,
  status
FROM ipos
WHERE status IN ('OPEN', 'UPCOMING')
ORDER BY openDate DESC;
```

**Database Results**:
```
[List of IPOs with lot details]
```

**Dropdown Options**:
```
[List of IPOs in calculator dropdown]
```

**Validation**:
- [ ] All eligible IPOs in dropdown
- [ ] Correct price ranges displayed
- [ ] Lot sizes accurate
- [ ] Categories shown correctly

---

## Functional Test Cases

### Test Case 1: Basic Calculation (Min Price)
**IPO**: [Select first IPO]
**Input Amount**: ₹10,000
**Price Selection**: Minimum
**Expected Calculation**:
```
Lots = Floor(10,000 / (Min Price × Lot Size))
Total Amount = Lots × Min Price × Lot Size
```
**Actual Result**: -
**Status**: ⏳

### Test Case 2: Basic Calculation (Max Price)
**IPO**: [Same IPO]
**Input Amount**: ₹10,000
**Price Selection**: Maximum
**Expected Calculation**:
```
Lots = Floor(10,000 / (Max Price × Lot Size))
Total Amount = Lots × Max Price × Lot Size
```
**Actual Result**: -
**Status**: ⏳

### Test Case 3: Custom Price Calculation
**IPO**: [Same IPO]
**Input Amount**: ₹50,000
**Custom Price**: [Mid-point of range]
**Expected Result**: -
**Actual Result**: -
**Status**: ⏳

### Test Case 4: Large Investment
**IPO**: [Select IPO]
**Input Amount**: ₹10,00,000
**Price Selection**: Maximum
**Expected Result**: -
**Actual Result**: -
**Status**: ⏳

### Test Case 5: Minimum Investment
**IPO**: [Select IPO]
**Input Amount**: [Exactly min investment]
**Price Selection**: Minimum
**Expected Result**: Exactly 1 lot
**Actual Result**: -
**Status**: ⏳

---

## Validation Test Cases

### Negative Input Tests
| Test | Input | Expected | Actual | Pass |
|------|-------|----------|--------|------|
| Negative Amount | -1000 | Error message | - | ⏳ |
| Zero Amount | 0 | Error message | - | ⏳ |
| Non-numeric | "abc" | Input rejected | - | ⏳ |
| Decimal | 1000.50 | Handled correctly | - | ⏳ |
| Very Large | 99999999999 | Handled/Limited | - | ⏳ |

### Custom Price Validation
| Test | Input | Expected | Actual | Pass |
|------|-------|----------|--------|------|
| Below Min | [Min - 1] | Error/Adjusted | - | ⏳ |
| Above Max | [Max + 1] | Error/Adjusted | - | ⏳ |
| Negative | -100 | Rejected | - | ⏳ |
| Zero | 0 | Rejected | - | ⏳ |

### Edge Cases
| Test | Scenario | Expected | Actual | Pass |
|------|----------|----------|--------|------|
| Exact Lot Amount | Investment = exact lot cost | 1 lot exactly | - | ⏳ |
| Just Below Lot | Investment = lot cost - 1 | 0 lots | - | ⏳ |
| Multiple Lots | Investment for exactly 5 lots | 5 lots | - | ⏳ |
| Max Application | Test HNI limit | Shows limit | - | ⏳ |

---

## UI/UX Testing

### Input Field Behavior
- [ ] Amount field accepts numbers only
- [ ] Formatting applied (commas for thousands)
- [ ] Clear button resets all fields
- [ ] Tab order logical
- [ ] Enter key triggers calculation

### Dropdown Behavior
- [ ] Search/filter works
- [ ] Shows IPO details (price, lot)
- [ ] Sorted logically
- [ ] Selection updates price fields

### Price Selection
- [ ] Radio buttons work
- [ ] Custom price enables input
- [ ] Min/Max disable custom input
- [ ] Values update on IPO change

### Results Display
- [ ] Shows number of lots
- [ ] Shows total investment
- [ ] Shows per lot cost
- [ ] Formatting correct (₹ symbol, commas)
- [ ] Clear message for zero lots

---

## Calculation Accuracy Matrix

| IPO | Investment | Price Type | Expected Lots | Actual Lots | Match |
|-----|------------|------------|---------------|-------------|-------|
| - | 10,000 | Min | - | - | ⏳ |
| - | 10,000 | Max | - | - | ⏳ |
| - | 25,000 | Custom | - | - | ⏳ |
| - | 100,000 | Min | - | - | ⏳ |
| - | 100,000 | Max | - | - | ⏳ |

---

## Performance Metrics

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Page Load Time | < 1s | - | Not Measured |
| Calculation Time | < 100ms | - | Not Measured |
| Dropdown Load | < 500ms | - | Not Measured |

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

## Manual Calculation Verification

### Example 1
```
IPO: [Name]
Price Range: ₹[Min] - ₹[Max]
Lot Size: [Size]
Investment: ₹[Amount]

Manual Calculation:
Cost per lot at min = ₹[Min] × [Lot Size] = ₹[Result]
Number of lots = [Investment] ÷ [Cost per lot] = [Lots]
Total Investment = [Lots] × [Cost per lot] = ₹[Total]

Calculator Result:
Lots: [Calculator Lots]
Total: ₹[Calculator Total]

Match: Yes/No
```

---

## Console Output
```
[Console logs/errors will be captured here]
```

---

## Accessibility Check

- [ ] All inputs keyboard accessible
- [ ] Labels properly associated
- [ ] Error messages announced
- [ ] Results announced to screen readers
- [ ] Focus management correct

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
- **Calculations Verified**: No
- **Ready for Pass 2**: No

---

**Next Steps**: Execute all test cases and verify calculations