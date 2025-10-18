# Epic 6: Historical IPO Database

**Duration:** Week 7
**Goal:** Access closed IPOs and listing performance data
**Business Value:** Learn from historical trends, SEO content
**Status:** Pending

---

## Overview

This epic implements the historical IPO database (FR-3) allowing users to research past IPOs, analyze listing performance, and learn from trends. This is a key differentiator and SEO driver.

## Success Criteria

- ✅ Users can browse all historical IPOs (2020-2024)
- ✅ Filtering by year, sector, performance
- ✅ Listing performance data visible (gains %)
- ✅ SEO optimized pages for each historical IPO
- ✅ Fast loading with pagination

## Stories

| ID | Story | Priority | Points | Status | Dependencies |
|----|-------|----------|--------|--------|--------------|
| 6.1 | Historical IPOs API | High | 3 | Pending | 2.3 |
| 6.2 | History Page with Filters | High | 5 | Pending | 6.1, 3.3 |
| 6.3 | Listing Performance Tracking | Medium | 5 | Pending | 6.1 |

**Total Points:** 13
**Estimated Duration:** 0.5 weeks (parallel with Epic 5)

---

## User Journey (Rahul - Primary Persona)

1. Rahul navigates to "History" from header
2. Sees grid of closed IPOs from 2020-2024
3. Filters to "2024" + "Technology" sector
4. Sorts by "Listing Gain %" descending
5. Sees Zomato IPO at top (+60% listing gain)
6. Clicks to view full historical detail
7. Reads performance analysis and learns

---

## Page Details (FR-3)

### History Page (/history)
**Layout:**
- Filter bar: Year, Sector, Performance (Profit/Loss/All)
- Sort options: Listing Date, Listing Gain %, Subscription
- Pagination: 20 IPOs per page
- Card/Table view toggle

**Data Displayed:**
- Company name
- Listing date
- Issue price
- Listing price (open, high, close)
- Listing gain % (color coded: green/red)
- Subscription (QIB, NII, Retail, Overall)

### Performance Tracking (Story 6.3)
- Current price (if listed <1 year ago) - Phase 2
- Current return % vs issue price - Phase 2
- Historical chart (listing day to current) - Phase 2

---

## Technical Details

### API Endpoint
```
GET /api/ipos/history

Query Params:
  - year: 2020|2021|2022|2023|2024|all
  - sector: string
  - performance: profit|loss|all
  - sort: listingDate|listingGain|subscription
  - page: number
  - limit: number (default 20)

Response:
{
  data: HistoricalIPO[],
  pagination: { page, limit, total, hasNext },
  stats: { avgListingGain, totalIPOs }
}
```

### SEO Strategy
- Each historical IPO gets static page: `/ipos/{slug}`
- Meta title: "{Company} IPO - Listing Performance & Analysis"
- Structured data: JSON-LD for historical event
- Internal linking to related IPOs (same sector)

---

## Dependencies

**This Epic Requires:**
- Epic 2: Story 2.3 (IPORepository, ListingPerformanceRepository)
- Epic 3: Story 3.3 (IPO Card reused for history)

**This Epic Blocks:**
- None (standalone feature)

---

## Definition of Done

- [ ] History page accessible at /history
- [ ] Filters and sorting functional
- [ ] Pagination working (tested with 100+ IPOs)
- [ ] Listing performance data accurate
- [ ] SEO optimized (meta tags, structured data)
- [ ] Responsive on mobile
- [ ] Performance: Page load <2s
