# IPO Detail Page Test Results

**Test Date**: Not Started
**Test Pass**: 1
**Tester**: -
**Duration**: -

---

## Test IPOs

### IPO 1: Bhairav Enterprises Limited
**URL**: http://localhost:3000/ipos/bhairav-enterprises-limited
**Category**: Mainboard
**Status**: -

### IPO 2: CDG Petchem Ltd
**URL**: http://localhost:3000/ipos/cdg-petchem-ltd
**Category**: -
**Status**: -

### IPO 3: Healthy Life Agritec Ltd (SME)
**URL**: http://localhost:3000/ipos/healthy-life-agritec-ltd
**Category**: SME
**Status**: -

---

## Test Summary

| Metric | IPO 1 | IPO 2 | IPO 3 |
|--------|-------|-------|-------|
| **Page Loads** | ⏳ | ⏳ | ⏳ |
| **Data Complete** | ⏳ | ⏳ | ⏳ |
| **Tabs Work** | ⏳ | ⏳ | ⏳ |
| **Issues Found** | 0 | 0 | 0 |

---

## Database Validation Queries

### Complete IPO Data Query
```sql
SELECT
  i.*,
  s.subscriptionRetail, s.subscriptionNII, s.subscriptionQIB, s.subscriptionTotal,
  g.estimatedGmp, g.gmpPercentage, g.lastUpdated as gmp_updated,
  f.revenue, f.profit, f.netWorth, f.eps, f.pe, f.roe,
  ls.listingGain, ls.currentPrice, ls.listingDate,
  r.registrarName, r.registrarWebsite, r.registrarEmail
FROM ipos i
LEFT JOIN subscriptions s ON i.id = s.ipoId
LEFT JOIN gmpRecords g ON i.id = g.ipoId
LEFT JOIN financialData f ON i.id = f.ipoId
LEFT JOIN listingPerformance ls ON i.id = ls.ipoId
LEFT JOIN registrars r ON i.registrarId = r.id
WHERE i.slug = ?;
```

### Related Data Queries
```sql
-- Peer Companies
SELECT * FROM peerCompanies WHERE ipoId = ?;

-- Documents
SELECT * FROM documents WHERE ipoId = ?;

-- Reviews
SELECT * FROM ipoReviews WHERE ipoId = ?;
```

---

## IPO 1: Bhairav Enterprises Limited

### Snapshot Data
```
[Snapshot will be captured here]
```

### Header Section Validation
| Field | Database Value | UI Display | Match |
|-------|---------------|------------|-------|
| Company Name | - | - | ⏳ |
| Status | - | - | ⏳ |
| Category | - | - | ⏳ |
| Issue Size | - | - | ⏳ |
| Price Band | - | - | ⏳ |
| Open Date | - | - | ⏳ |
| Close Date | - | - | ⏳ |
| Listing Date | - | - | ⏳ |

### Overview Tab
| Field | Present | Accurate | Notes |
|-------|---------|----------|-------|
| Company Description | ⏳ | ⏳ | - |
| Lot Size | ⏳ | ⏳ | - |
| Min Investment | ⏳ | ⏳ | - |
| Issue Type | ⏳ | ⏳ | - |
| Face Value | ⏳ | ⏳ | - |
| Registrar | ⏳ | ⏳ | - |
| Lead Manager | ⏳ | ⏳ | - |

### Financial Tab
| Metric | Database | UI | Match |
|--------|----------|-----|-------|
| Revenue | - | - | ⏳ |
| Profit | - | - | ⏳ |
| Net Worth | - | - | ⏳ |
| EPS | - | - | ⏳ |
| P/E Ratio | - | - | ⏳ |
| ROE | - | - | ⏳ |

### Subscription Tab
| Category | Database | UI | Match |
|----------|----------|-----|-------|
| QIB | - | - | ⏳ |
| NII | - | - | ⏳ |
| Retail | - | - | ⏳ |
| Total | - | - | ⏳ |
| Updated Time | - | - | ⏳ |

### GMP Tab
| Field | Database | UI | Match |
|-------|----------|-----|-------|
| Current GMP | - | - | ⏳ |
| GMP % | - | - | ⏳ |
| Expected Listing | - | - | ⏳ |
| Last Updated | - | - | ⏳ |

### Issues Found
```
[List issues specific to this IPO]
```

---

## IPO 2: CDG Petchem Ltd

### Snapshot Data
```
[Snapshot will be captured here]
```

### Data Validation
[Similar structure as IPO 1]

### Issues Found
```
[List issues specific to this IPO]
```

---

## IPO 3: Healthy Life Agritec Ltd (SME)

### Snapshot Data
```
[Snapshot will be captured here]
```

### Data Validation
[Similar structure as IPO 1]

### SME-Specific Fields
| Field | Present | Notes |
|-------|---------|-------|
| SME Badge | ⏳ | - |
| SME Platform | ⏳ | - |
| Min Lot Size | ⏳ | - |

### Issues Found
```
[List issues specific to this IPO]
```

---

## Common Functionality Tests

### Tab Navigation
- [ ] Overview tab loads
- [ ] Financial tab loads
- [ ] Subscription tab loads
- [ ] GMP tab loads
- [ ] All tabs have content
- [ ] Tab switching smooth

### Interactive Elements
- [ ] Apply Now buttons work
- [ ] External links open
- [ ] Back button works
- [ ] Share functionality works
- [ ] Print functionality works

### Related Sections
- [ ] Peer Companies display
- [ ] Documents/Links section
- [ ] Related IPOs show
- [ ] Reviews section (if any)

---

## Data Completeness Summary

### Critical Missing Fields
```
[List any critical data that's missing across all IPOs]
```

### Data Accuracy Issues
```
[List any data mismatches found]
```

### Formatting Issues
```
[List any formatting problems]
```

---

## Performance Metrics

| Metric | Target | IPO 1 | IPO 2 | IPO 3 |
|--------|--------|-------|-------|-------|
| Page Load | < 2s | - | - | - |
| Tab Switch | < 200ms | - | - | - |
| Data Render | < 500ms | - | - | - |

---

## Accessibility Check

- [ ] All tabs keyboard accessible
- [ ] Focus indicators visible
- [ ] Screen reader friendly
- [ ] Color contrast adequate
- [ ] Links have descriptive text

---

## Issues Summary

### Critical (P0)
None

### High (P1)
None

### Medium (P2)
None

### Low (P3)
None

---

## Console Output
```
[Console logs/errors from all three IPO pages]
```

---

## Recommendations

1. [Recommendations based on testing]
2.
3.

---

## Sign-off

- **Test Completed**: No
- **All IPOs Tested**: No
- **Ready for Pass 2**: No

---

**Next Steps**: Test all three IPOs and document findings