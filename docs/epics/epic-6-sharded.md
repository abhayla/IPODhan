# Epic 6: Historical IPO Performance

**Epic ID:** epic-6
**Priority:** Medium
**Story Points:** 13
**Timeline:** Week 7 (parallel with Epic 5)
**Status:** 📋 PLANNED
**Dependencies:** Epic 3 (IPO Listing - IPO Card Component reuse)

---

## Epic Overview

Build historical IPO archive allowing users to research past IPO performance, learn from historical trends, and compare current IPOs against similar past opportunities.

### Business Value

- **Educational Value:** Help users learn from past IPO performance
- **Decision Support:** Enable comparison of current IPOs with historical data
- **SEO Opportunity:** Historical data attracts organic search traffic
- **User Engagement:** Increases session duration and return visits

### User Personas

**Primary:** Rahul (active investor) - researches historical trends before applying
**Secondary:** Priya (newcomer) - learns from past IPO outcomes

---

## Stories in This Epic

### Story 6.1: Historical IPOs API
**Priority:** High
**Points:** 4
**Status:** 📋 PLANNED
**File:** To be created

**Description:**
API endpoint to fetch closed IPOs with listing performance data, supporting filters and sorting.

**Functional Requirements (FR-3):**

**API Endpoint:**
- Route: `GET /api/ipos/history`
- Query Parameters:
  - `year`: 2020, 2021, 2022, 2023, 2024, 2025, All (default: All)
  - `sector`: Technology, Finance, Healthcare, etc. (default: All)
  - `performance`: All, Positive, Negative (default: All)
  - `sort`: listing_date, listing_gain, subscription (default: listing_date DESC)
  - `page`: Page number (default: 1)
  - `limit`: Results per page (default: 20)

**Response Format:**
```json
{
  "data": {
    "ipos": [
      {
        "id": "uuid",
        "companyName": "Tech Corp",
        "slug": "tech-corp-ipo",
        "status": "LISTED",
        "issuePrice": 300,
        "listingDate": "2024-12-15",
        "listingOpen": 315,
        "listingHigh": 350,
        "listingClose": 340,
        "listingGainPercent": 13.33,
        "subscriptionOverall": 25.5,
        "sector": "Technology",
        "year": 2024
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 150,
      "totalPages": 8
    }
  }
}
```

**Database Requirements:**
- Use existing `ipos` table with `status=LISTED`
- Filter on `listing_date IS NOT NULL`
- Required fields:
  - `issue_price`, `listing_date`, `listing_open`, `listing_high`, `listing_close`
  - `subscription_overall`, `subscription_qib`, `subscription_nii`, `subscription_rii`
  - `sector`, YEAR(`listing_date`)
- Computed field: `listing_gain_percent = ((listing_close - issue_price) / issue_price) * 100`

**Technical Implementation:**
- Create `app/api/ipos/history/route.ts`
- Use `IPORepository.findHistorical()` method
- Cache results with Redis (TTL: 24 hours)
- Proper error handling (400 for invalid params, 500 for server errors)
- TypeScript interfaces for request/response

**Acceptance Criteria:**
1. ✅ API endpoint at `GET /api/ipos/history`
2. ✅ Support filters: year, sector, performance
3. ✅ Support sorting: listing_date, listing_gain, subscription
4. ✅ Pagination with page and limit params
5. ✅ Returns IPO data with listing performance
6. ✅ Computed `listingGainPercent` field
7. ✅ Cache with Redis (24h TTL)
8. ✅ Error handling with proper status codes
9. ✅ Response matches defined TypeScript interface
10. ✅ Unit tests for API logic

---

### Story 6.2: Historical IPOs Page
**Priority:** High
**Points:** 6
**Status:** 📋 PLANNED
**File:** To be created

**Description:**
User-facing page displaying historical IPOs in table/card view with filtering, sorting, and search.

**Functional Requirements (FR-3):**

**Page Route:**
- Route: `/history`
- SEO: Title "IPO History - Past IPO Performance | IPODhan"
- Meta description: "Research historical IPO performance in India. View listing gains, subscription data, and learn from past IPO trends."

**Display Format:**

**Table View (Desktop):**
- Columns:
  1. Company Name (clickable to detail page)
  2. Sector
  3. Listing Date
  4. Issue Price (₹)
  5. Listing Price (₹)
  6. Listing Gain % (color-coded: green if positive, red if negative)
  7. Subscription (overall, e.g., "25.5x")
  8. Status badge (LISTED)
- Sortable columns: Listing Date, Listing Gain %, Subscription
- Pagination: 20 IPOs per page (with page numbers)

**Card View (Mobile):**
- Reuse `IPOCard` component from Story 3.3
- Show listing gain % badge prominently
- Color-coded border: green for gains, red for losses
- Swipe/scroll for pagination

**Filters (Left Sidebar on Desktop, Modal on Mobile):**
- **Year:** Checkboxes for 2020, 2021, 2022, 2023, 2024, 2025, All
- **Sector:** Dropdown or checkboxes (Technology, Finance, Healthcare, Consumer, Industrial, Pharma, etc.)
- **Listing Performance:** Radio buttons (All, Positive Gains, Negative Losses)
- **"Clear Filters" button** visible when filters active

**Search Bar:**
- Global search bar at top
- Search by company name
- Debounced (500ms)
- Shows filtered results in table/card view

**Results Count:**
- Display: "Showing 150 IPOs" or "Showing 42 IPOs (filtered)"
- Updates dynamically with filter changes

**Empty State:**
- Message: "No historical IPOs found matching your criteria"
- "Clear filters" button

**Technical Implementation:**
- Create `app/history/page.tsx`
- Use Story 6.1 API endpoint
- Server-side rendering for initial load (SSG with ISR)
- Client-side filtering and sorting for better UX
- URL query params for filter persistence: `/history?year=2024&sector=Technology&performance=positive`
- Use React Context for filter state management
- Pagination component with page numbers

**Acceptance Criteria:**
1. ✅ Historical IPOs page at `/history`
2. ✅ Desktop: Table view with sortable columns
3. ✅ Mobile: Card view with reused IPO Card component
4. ✅ Filters: Year, Sector, Listing Performance
5. ✅ Search bar filters by company name (debounced)
6. ✅ Sorting: Listing Date, Listing Gain %, Subscription
7. ✅ Pagination: 20 IPOs per page
8. ✅ Results count displayed and updates with filters
9. ✅ URL query params persist filter state
10. ✅ Empty state with "Clear filters" button
11. ✅ SEO: Meta tags and structured data
12. ✅ Loading states for data fetch
13. ✅ Mobile-responsive design

---

### Story 6.3: Listing Performance Display
**Priority:** Medium
**Points:** 4
**Status:** 📋 PLANNED
**File:** To be created

**Description:**
Enhanced display of listing day performance with color-coded gains, performance badges, and historical context.

**Functional Requirements:**

**Listing Gain Badge:**
- Display on historical IPO cards and detail pages
- Format: `+13.3%` (green) or `-5.2%` (red)
- Font size: Prominent (18px on card, 24px on detail page)
- Background: Light green (gains) or light red (losses)
- Icon: ↑ (gains) or ↓ (losses)

**Listing Performance Section (Detail Page):**
- Section title: "Listing Day Performance"
- Display:
  - Issue Price: ₹300
  - Listing Open: ₹315 (+5%)
  - Listing High: ₹350 (+16.7%)
  - Listing Close: ₹340 (+13.3%)
  - Day Return: **+13.3%** (color-coded, prominent)
- Intraday chart (Phase 2): Line chart showing price movement on listing day

**Historical Context:**
- Compare against sector average listing gain
- Display: "Tech sector average listing gain: +8.2%"
- Badge: "Above average" or "Below average"

**Phase 2 Features (Deferred):**
- Current market price (if <1 year old)
- Current return % vs issue price
- Performance chart (listing day to current)

**Technical Implementation:**
- Create `ListingPerformance.tsx` component
- Props: issuePrice, listingOpen, listingHigh, listingClose
- Calculate listing gain %: `((listingClose - issuePrice) / issuePrice) * 100`
- Fetch sector average from database (precomputed or cached)
- Conditional rendering: Only show if `listing_date IS NOT NULL`

**SEO Enhancement:**
- Structured data (JSON-LD) for historical IPO entity
- Include listing performance in schema

**Acceptance Criteria:**
1. ✅ Listing gain badge on historical IPO cards
2. ✅ Badge format: `+X.X%` or `-X.X%` with color coding
3. ✅ Listing Performance section on IPO detail page
4. ✅ Display: issue price, listing open/high/close, day return
5. ✅ Color-coded day return (green/red)
6. ✅ Historical context: Compare against sector average
7. ✅ Badge: "Above average" or "Below average"
8. ✅ Only show if `listing_date` is available
9. ✅ Structured data (JSON-LD) for historical IPO
10. ✅ Mobile-responsive component design

---

## Epic Dependencies

### Blocking Dependencies (Must Complete First)
- ✅ Story 3.3: IPO Card Component - Reuse for historical IPO display
- ✅ Story 2.3: Repository Layer - IPORepository for data access

### Downstream Impact (This Epic Blocks)
- None - Epic 6 is independent

---

## Epic Success Criteria

Epic 6 is successful when:

1. **Functionality Complete:**
   - ✅ Historical IPOs API functional with filters and sorting
   - ✅ Historical IPOs page accessible at `/history`
   - ✅ Listing performance displayed on cards and detail pages
   - ✅ Filters and search working correctly

2. **User Experience:**
   - ✅ Page load <2 seconds
   - ✅ Smooth filtering (no page reload)
   - ✅ Responsive on mobile, tablet, desktop
   - ✅ Intuitive navigation from main menu

3. **Data Quality:**
   - ✅ At least 50 historical IPOs seeded in database
   - ✅ Listing data accurate (price, gain %)
   - ✅ Sector averages precomputed

4. **SEO & Discoverability:**
   - ✅ Meta tags optimized for "IPO history" keywords
   - ✅ Structured data (JSON-LD) for historical IPOs
   - ✅ Page indexed by search engines

5. **Business Goals:**
   - ✅ Educational resource for users
   - ✅ Increased session duration
   - ✅ Organic search traffic to historical pages

---

## Technical Architecture

### Frontend Components
- `app/history/page.tsx` - Historical IPOs page
- `ListingPerformance.tsx` - Listing day performance display
- `HistoricalFilters.tsx` - Filter sidebar component
- Reuse: `IPOCard.tsx` from Story 3.3

### API Routes
- `GET /api/ipos/history` - Fetch historical IPOs with filters

### Database Tables
- Use existing `ipos` table (filter `status=LISTED`)
- Optional: `sector_averages` table for precomputed sector metrics

### Configuration
- Cache TTL: 24 hours for historical data (changes infrequently)
- Pagination: 20 IPOs per page

---

## Testing Requirements

### Unit Tests
- Listing gain % calculation (various inputs)
- Historical IPO filtering logic
- Sorting logic (listing date, gain %, subscription)

### Integration Tests
- Historical IPOs API with filters
- Pagination logic
- Search functionality

### E2E Tests
1. **Historical Research Journey:**
   - Navigate to `/history` → See list of historical IPOs
   - Apply filters (year=2024, sector=Technology) → See filtered results
   - Click on IPO → View detail page with listing performance

2. **Search Journey:**
   - Navigate to `/history` → Search "Tech Corp" → See results
   - Click on result → View detail page

3. **Sorting Journey:**
   - Navigate to `/history` → Sort by "Listing Gain %" DESC → See highest gains first

### Performance Tests
- Page load time: <2s with 50+ historical IPOs
- Filter response time: <300ms
- API response time: <500ms

---

## Risk Management

### Medium Priority Risks

1. **Historical Data Availability:**
   - **Risk:** Limited historical IPO data for MVP
   - **Impact:** Empty or sparse historical page
   - **Mitigation:**
     - Seed database with last 2-3 years of IPOs (manual entry or web scraping)
     - Start with 50+ IPOs for MVP
   - **Contingency:** Focus on recent IPOs (2023-2025), expand later

2. **Sector Average Calculation:**
   - **Risk:** Insufficient data to compute sector averages
   - **Impact:** Cannot show "above/below average" context
   - **Mitigation:**
     - Precompute sector averages during seed data import
     - Set minimum threshold: 5 IPOs per sector
   - **Contingency:** Hide sector average if insufficient data

### Low Priority Risks

3. **Page Performance with Large Datasets:**
   - **Risk:** Slow page load with 200+ historical IPOs
   - **Impact:** Poor UX, high bounce rate
   - **Mitigation:**
     - Server-side pagination
     - Redis caching (24h TTL)
     - Lazy load images
   - **Contingency:** Reduce pagination to 10 IPOs per page

---

## Definition of Done

Each story must meet:
- ✅ All acceptance criteria passed
- ✅ Unit tests written (>80% coverage)
- ✅ Integration tests for API routes
- ✅ E2E tests for critical user journeys
- ✅ TypeScript compilation clean
- ✅ Linting passes (0 errors, 0 warnings)
- ✅ Responsive design tested (mobile, tablet, desktop)
- ✅ Accessibility standards met (ARIA, keyboard navigation)
- ✅ Code reviewed
- ✅ Documentation updated

### Epic-Level Definition of Done
- ✅ All 3 stories complete
- ✅ Historical page accessible from navigation
- ✅ At least 50 historical IPOs seeded
- ✅ Filters, sorting, and search functional
- ✅ Zero critical bugs
- ✅ Mobile responsive
- ✅ SEO optimized
- ✅ PO approval after demo

---

## Sprint Planning

**Sprint 5 Assignment:** Week 7 (parallel with Epic 5)

**Day-by-Day Breakdown:**

**Day 1-2 (parallel with Epic 5 Stories 5.3, 5.4):**
- Story 6.1: Historical IPOs API (4 points)

**Day 2-3 (parallel with Epic 5 Stories 5.1, 5.2):**
- Story 6.2: Historical IPOs Page (6 points)

**Day 3 (parallel with Epic 5 Story 5.2):**
- Story 6.3: Listing Performance Display (4 points)

**Note:** Epic 6 runs in parallel with Epic 5. Total Week 7: 19 (Epic 5) + 13 (Epic 6) = 32 points

---

## Data Seeding Requirements

To complete Epic 6, seed historical IPO data:

**Minimum Data (MVP):**
- 50 IPOs from 2023-2025 (recent history)
- Include: company name, sector, issue price, listing date, listing prices, subscription data
- At least 5 IPOs per major sector (Technology, Finance, Healthcare, Consumer)

**Data Sources:**
- Manual entry from Chittorgarh, Moneycontrol, or InvestorGain
- Web scraping (Phase 2 automation)
- CSV import script

**Seed Script:**
- Create `scripts/seed-historical-ipos.ts`
- Load data from CSV or JSON
- Insert into `ipos` table with `status=LISTED`
- Compute sector averages and cache

---

## Epic Retrospective Template

*To be filled after Epic 6 completion*

### What Went Well
- TBD

### What Could Be Improved
- TBD

### Action Items for Epic 7
- TBD

---

**Epic Status:** 📋 PLANNED - Ready to start in parallel with Epic 5
**Next Epic:** Epic 7 - Data Pipeline (27 points, Weeks 9-10)
