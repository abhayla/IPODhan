# Sprint 5 Plan: Investment Tools & Historical Data

**Sprint Number:** 5
**Sprint Goal:** Deliver investment tools and historical IPO archive to enhance user engagement and decision-making
**Epic:** Epic 5 (Investment Tools) + Epic 6 (Historical Data)
**Duration:** 1 week (Week 7)
**Story Points:** 32 (19 + 13)
**Status:** 📋 PLANNED (0/32 points complete, 0%)

---

## Sprint Progress Summary

**Updated:** 2025-10-07

### Current Status: 📋 PLANNED (Ready to Start)

| Story | Points | Status | Quality | Notes |
|-------|--------|--------|---------|-------|
| 5.1 | 4 | ✅ READY | 9.5/10 | Lot Size Calculator - Story drafted and approved |
| 5.2 | 6 | ✅ READY | 9.5/10 | IPO Comparison Tool - Story drafted and approved |
| 5.3 | 4 | 📋 PLANNED | - | Registrar Directory - To be drafted |
| 5.4 | 4 | 📋 PLANNED | - | Market Holidays - To be drafted |
| 5.5 | 6 | 📋 PLANNED | - | Broker Affiliates - To be drafted |
| 6.1 | 4 | 📋 PLANNED | - | Historical IPOs API - To be drafted |
| 6.2 | 6 | 📋 PLANNED | - | Historical IPOs Page - To be drafted |
| 6.3 | 4 | 📋 PLANNED | - | Listing Performance Display - To be drafted |

**Points Complete:** 0/32 (0%)
**Stories Complete:** 0/8 (0%)
**Quality Average:** TBD
**Target Velocity:** 32 pts/week

### Prerequisites ✅
- ✅ Sprint 4 Complete (IPO Detail Page)
- ✅ Story 3.3 Complete (IPO Card Component - for reuse)
- ✅ Story 4.3 Complete (IPO Detail Page - for embedded calculator)
- ✅ Story 2.3 Complete (Repository Layer)

**All dependencies satisfied - Sprint 5 ready to start!**

### Sprint 5 Goals
1. **Deliver investment tools** - Calculators and comparison features
2. **Build historical archive** - Enable research of past IPO performance
3. **Activate revenue stream** - Broker affiliate integration
4. **Enhance SEO** - Historical data attracts organic traffic
5. **Increase engagement** - Utility tools drive user retention

---

## Sprint Objective

Deliver investment tools and historical IPO archive to:
- Empower users with lot size calculator and IPO comparison
- Provide educational historical data for learning
- Activate broker affiliate revenue stream
- Build utility features (registrar directory, market holidays)
- Establish foundation for long-term user engagement

**Critical Path:** Stories 5.1 + 5.2 (user-facing tools) and 6.1 + 6.2 (historical archive)

---

## Stories in This Sprint

### Epic 5: IPO Investment Tools (19 points)

#### Story 5.1: Lot Size Calculator
**Priority:** High
**Points:** 4
**Status:** ✅ READY (Story created and approved by PO)
**Dependencies:** 4.3 ✅
**File:** `docs/stories/5.1.lot-size-calculator.story.md`

**Description:**
Interactive calculator that computes number of lots, shares, and total investment based on user's investment amount and IPO lot size.

**Acceptance Criteria:**
- Embedded calculator widget on IPO detail page
- Standalone calculator page at `/tools/lot-calculator`
- Input field accepts investment amount (₹ with comma separators)
- Calculator displays: lots, shares, total investment (formatted)
- Real-time calculation (debounced 300ms)
- Pre-filled with IPO data when accessed from detail page
- Dropdown to select any IPO on standalone page
- Validation: Minimum investment = 1 lot
- Error handling for invalid inputs (inline messages)
- Mobile-responsive design

**Technical Requirements:**
- Create `LotCalculator.tsx` shared component
- Client-side calculation (no API needed)
- Zod validation for inputs
- localStorage to remember last used IPO
- Embeds in IPO detail page below key metrics

**Sample Calculation:**
```
Investment Amount: ₹15,000
IPO Price: ₹350
Lot Size: 40 shares

Calculation:
lots = floor(15000 / (350 × 40)) = 1 lot
Total Shares: 1 × 40 = 40 shares
Total Investment: 1 × 40 × 350 = ₹14,000
```

---

#### Story 5.2: IPO Comparison Tool
**Priority:** High
**Points:** 6
**Status:** ✅ READY (Story created and approved by PO)
**Dependencies:** 3.1 ✅, 3.3 ✅
**File:** `docs/stories/5.2.ipo-comparison.story.md`

**Description:**
Side-by-side comparison of 2-3 IPOs to help users evaluate and choose between opportunities.

**Acceptance Criteria:**
- Comparison page at `/tools/compare`
- Select 2-3 IPOs via dropdown (search-enabled)
- Comparison table shows 15+ data points side-by-side:
  - Company name, status, price range, lot size
  - Issue size, open/close dates, subscription, GMP, rating
  - Key financials (revenue, profit), sector, lead managers
- Shareable URL: `/tools/compare?ipos=slug1,slug2,slug3`
- "Clear" and "Add another IPO" buttons
- Entry points from dashboard and detail page
- Desktop: Full table; Mobile: Card-based swipe view
- Error handling: Show message if IPO not found
- Loading states for data fetch
- Mobile-responsive design

**Technical Requirements:**
- Create `app/tools/compare/page.tsx`
- API endpoint: `GET /api/tools/compare?ipos=slug1,slug2`
- Use IPORepository to fetch multiple IPOs
- URL query params for shareability
- localStorage to persist last comparison

---

#### Story 5.3: Registrar Directory
**Priority:** Medium
**Points:** 4
**Status:** 📋 PLANNED
**Dependencies:** None
**File:** To be created

**Description:**
Comprehensive searchable directory of IPO registrars with contact information.

**Acceptance Criteria:**
- Dedicated Registrar Directory page at `/registrars`
- Display registrars in alphabetical order
- Show: name, email, phone, website, allotment link for each
- Search bar filters by registrar name
- Responsive: Table on desktop, cards on mobile
- Database table `registrars` with 10-15 seed entries
- Integration with IPO detail page (linked from allotment checker)
- Clickable website URLs open in new tab
- Loading states and error handling
- Accessible from "Tools" menu in navigation

**Technical Requirements:**
- Create `app/registrars/page.tsx`
- API endpoint: `GET /api/registrars`
- Create `RegistrarRepository` in backend
- Client-side search using Fuse.js
- Static page with ISR (revalidate every 7 days)

**Seed Data (10-15 registrars):**
- Link Intime India, KFin Technologies, Bigshare Services
- Cameo Corporate, Skyline Financial, Beacon Trusteeship
- Mas Services, Alankit Assignments, etc.

---

#### Story 5.4: Market Holidays Calendar
**Priority:** Medium
**Points:** 4
**Status:** 📋 PLANNED
**Dependencies:** None
**File:** To be created

**Description:**
Display NSE/BSE trading holidays to help users plan IPO applications and understand market closures.

**Acceptance Criteria:**
- Market Holidays page at `/market-holidays`
- Display holidays in chronological order (upcoming first)
- Show: date, holiday name, exchange (NSE/BSE/Both), day of week
- Highlight upcoming holidays (next 7 days)
- Filters: Year, Exchange, Upcoming/All toggle
- Database table `market_holidays` with seed data
- Responsive: List view on mobile, table on desktop
- Data seeded from NSE/BSE official calendars
- Accessible from "Tools" menu in navigation
- Loading states and error handling

**Technical Requirements:**
- Create `app/market-holidays/page.tsx`
- Database table: `market_holidays` (date, name, exchange, year)
- API endpoint: `GET /api/market-holidays?year=2025&exchange=NSE`
- Static page with ISR (revalidate every 30 days)
- Manual data entry for MVP (annual update)

**Data Sources:**
- NSE: https://www.nseindia.com/regulations/trading-holidays
- BSE: https://www.bseindia.com/static/about/Market_Holidays.aspx

---

#### Story 5.5: Broker Affiliate Integration
**Priority:** Medium
**Points:** 6
**Status:** 📋 PLANNED
**Dependencies:** 4.3 ✅
**File:** To be created

**Description:**
Integrate affiliate links for Zerodha and AngelOne brokers to enable revenue generation.

**Acceptance Criteria:**
- "Apply for this IPO" section on IPO detail page
- Two broker buttons: Zerodha and AngelOne with logos
- Homepage banner: "Open a free demat account" (dismissible)
- Affiliate links stored in `.env.local`
- Centralized config file: `lib/config/affiliate-links.ts`
- Database table `affiliate_clicks` for tracking
- Google Analytics event tracking for clicks
- Footer disclaimer on every page
- Links open in new tab with proper rel attributes
- Mobile-responsive button layout

**Technical Requirements:**
- Create `BrokerButton.tsx` component
- Create `AffiliateCTA.tsx` component for homepage
- API endpoint: `POST /api/affiliate/track` to log clicks
- Database table: `affiliate_clicks`
- Affiliate links: Zerodha (`https://signup.zerodha.com/?c=ZMPHZC`)
- AngelOne (`https://tinyurl.com/2d98g2qe`)

**Affiliate Link Configuration:**
```typescript
// lib/config/affiliate-links.ts
export const affiliateConfig = {
  brokers: [
    {
      id: 'zerodha',
      name: 'Zerodha',
      link: process.env.ZERODHA_AFFILIATE_LINK || 'https://signup.zerodha.com/?c=ZMPHZC',
      logo: '/logos/zerodha.png',
      cta: 'Apply via Zerodha'
    },
    {
      id: 'angelone',
      name: 'AngelOne',
      link: process.env.ANGELONE_AFFILIATE_LINK || 'https://tinyurl.com/2d98g2qe',
      logo: '/logos/angelone.png',
      cta: 'Apply via Angel One'
    }
  ]
}
```

---

### Epic 6: Historical IPO Performance (13 points)

#### Story 6.1: Historical IPOs API
**Priority:** High
**Points:** 4
**Status:** 📋 PLANNED
**Dependencies:** 2.3 ✅
**File:** To be created

**Description:**
API endpoint to fetch closed IPOs with listing performance data, supporting filters and sorting.

**Acceptance Criteria:**
- API endpoint at `GET /api/ipos/history`
- Support filters: year, sector, performance
- Support sorting: listing_date, listing_gain, subscription
- Pagination with page and limit params
- Returns IPO data with listing performance
- Computed `listingGainPercent` field
- Cache with Redis (24h TTL)
- Error handling with proper status codes
- Response matches defined TypeScript interface
- Unit tests for API logic

**Technical Requirements:**
- Create `app/api/ipos/history/route.ts`
- Use `IPORepository.findHistorical()` method
- Cache results with Redis (TTL: 24 hours)
- TypeScript interfaces for request/response

**Query Parameters:**
- `year`: 2020-2025, All (default: All)
- `sector`: Technology, Finance, Healthcare, etc.
- `performance`: All, Positive, Negative (default: All)
- `sort`: listing_date, listing_gain, subscription (default: listing_date DESC)
- `page`: Page number (default: 1)
- `limit`: Results per page (default: 20)

---

#### Story 6.2: Historical IPOs Page
**Priority:** High
**Points:** 6
**Status:** 📋 PLANNED
**Dependencies:** 3.3 ✅, 6.1 ✅
**File:** To be created

**Description:**
User-facing page displaying historical IPOs in table/card view with filtering, sorting, and search.

**Acceptance Criteria:**
- Historical IPOs page at `/history`
- Desktop: Table view with sortable columns
- Mobile: Card view with reused IPO Card component
- Filters: Year, Sector, Listing Performance
- Search bar filters by company name (debounced)
- Sorting: Listing Date, Listing Gain %, Subscription
- Pagination: 20 IPOs per page
- Results count displayed and updates with filters
- URL query params persist filter state
- Empty state with "Clear filters" button
- SEO: Meta tags and structured data
- Loading states for data fetch
- Mobile-responsive design

**Technical Requirements:**
- Create `app/history/page.tsx`
- Use Story 6.1 API endpoint
- Server-side rendering for initial load (SSG with ISR)
- Client-side filtering and sorting
- URL query params for filter persistence
- React Context for filter state
- Pagination component

**Table Columns (Desktop):**
1. Company Name (clickable)
2. Sector
3. Listing Date
4. Issue Price (₹)
5. Listing Price (₹)
6. Listing Gain % (color-coded)
7. Subscription (overall)
8. Status badge (LISTED)

---

#### Story 6.3: Listing Performance Display
**Priority:** Medium
**Points:** 4
**Status:** 📋 PLANNED
**Dependencies:** 6.2 ✅
**File:** To be created

**Description:**
Enhanced display of listing day performance with color-coded gains, performance badges, and historical context.

**Acceptance Criteria:**
- Listing gain badge on historical IPO cards
- Badge format: `+X.X%` or `-X.X%` with color coding
- Listing Performance section on IPO detail page
- Display: issue price, listing open/high/close, day return
- Color-coded day return (green/red)
- Historical context: Compare against sector average
- Badge: "Above average" or "Below average"
- Only show if `listing_date` is available
- Structured data (JSON-LD) for historical IPO
- Mobile-responsive component design

**Technical Requirements:**
- Create `ListingPerformance.tsx` component
- Calculate listing gain %: `((listingClose - issuePrice) / issuePrice) * 100`
- Fetch sector average from database (precomputed)
- Conditional rendering: Only if `listing_date IS NOT NULL`
- SEO: Structured data for historical IPO entity

**Display Format:**
```
Listing Day Performance
─────────────────────────
Issue Price:     ₹300
Listing Open:    ₹315 (+5%)
Listing High:    ₹350 (+16.7%)
Listing Close:   ₹340 (+13.3%)

Day Return: +13.3% ↑
Tech sector avg: +8.2%
[Above average badge]
```

---

## Sprint Plan - Week Breakdown

### Week 7: Tools & Historical Data (32 points)

**Days 1-2:** Parallel Development (12 points)
- Story 5.3: Registrar Directory (4 points)
- Story 5.4: Market Holidays (4 points)
- Story 6.1: Historical IPOs API (4 points)

**Day 2:** Sequential Development (4 points)
- Story 5.1: Lot Calculator (4 points)

**Days 3-4:** Parallel Development (12 points)
- Story 5.2: IPO Comparison Tool (6 points)
- Story 6.2: Historical IPOs Page (6 points)

**Day 4:** Sequential Development (4 points)
- Story 6.3: Listing Performance Display (4 points)

**Day 5:** Final Development + Testing (6 points)
- Story 5.5: Broker Affiliate Integration (6 points)
- Bug fixes, testing, polish
- E2E test suite for all tools
- Performance optimization

**Week Target:** 32 points complete

**Parallelization Strategy:**
- Epic 5 and Epic 6 have no blocking dependencies
- Day 1: 3 stories in parallel (registrar, holidays, historical API)
- Day 3-4: 2 stories in parallel (comparison, historical page)
- Maximize throughput while maintaining quality

---

## Sprint Metrics

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Story Points | 32 | 0/32 (0%) | 📋 Planned |
| Stories | 8 | 0/8 (0%) | 📋 Planned |
| Velocity | 32 pts/week | TBD | - |
| Test Coverage | >80% | TBD | - |
| Tools Delivered | 5 | 0/5 | - |
| Historical Data | 50+ IPOs | TBD | - |

---

## Technical Requirements

### Frontend Technologies
- Next.js 14.2+ with App Router
- React 18+ with TypeScript 5.3+
- shadcn/ui for UI components
- Tailwind CSS 3.4+ for styling
- Fuse.js for client-side search
- Recharts for listing performance charts (Phase 2)

### API Design
- RESTful API endpoints:
  - `GET /api/tools/compare?ipos=slug1,slug2`
  - `GET /api/registrars`
  - `GET /api/market-holidays?year=2025`
  - `GET /api/ipos/history?year=2024&sector=Technology`
  - `POST /api/affiliate/track`
- Server-side rendering for initial page loads
- Client-side data fetching for interactive features
- Redis caching for frequently accessed data

### Database Schema
- New tables:
  - `registrars` (name, email, phone, website, allotment_url)
  - `market_holidays` (date, holiday_name, exchange, year)
  - `affiliate_clicks` (ipo_id, broker, source, clicked_at, user_session)
- Use existing `ipos` table for historical data (filter `status=LISTED`)

### Performance
- Tool page load: <1.5 seconds
- Calculator response: <100ms
- API response time: <500ms
- Redis caching (TTL: 24h for historical, 5min for tools)

### SEO & Metadata
- Meta tags for all tool pages
- Structured data (JSON-LD) for:
  - Historical IPO entities
  - Registrar organizations
  - Market events (holidays)
- Canonical URLs
- Open Graph tags for social sharing

---

## Dependencies

### Satisfied Dependencies ✅
- ✅ Story 2.3: Repository Layer (IPORepository)
- ✅ Story 3.1: API Client Service
- ✅ Story 3.3: IPO Card Component (for historical page)
- ✅ Story 4.3: IPO Detail Page Assembly (for embedded calculator, affiliates)

### This Sprint Blocks
- None - Sprint 5 is independent

---

## Risk Assessment

### High Priority Risks

1. **Parallelization Complexity**
   - **Risk Level:** Medium
   - **Impact:** Stories may interfere or delay each other
   - **Mitigation:**
     - Clear task assignments (separate developers if possible)
     - Daily stand-ups to sync progress
     - Independent code modules (no shared files)
   - **Contingency:** Serialize stories if conflicts arise

2. **Historical Data Seeding**
   - **Risk Level:** Medium
   - **Impact:** Historical page empty or sparse
   - **Mitigation:**
     - Prepare seed data script early (Day 1)
     - Use web scraping or CSV import
     - Target: 50+ IPOs (2023-2025)
   - **Contingency:** Manual entry of 20-30 IPOs minimum

### Medium Priority Risks

3. **Affiliate Revenue Uncertainty**
   - **Risk Level:** Medium
   - **Impact:** Users may not click affiliate links
   - **Mitigation:**
     - A/B test CTA placements
     - Optimize button design
     - Track click-through rates
   - **Contingency:** Alternative monetization (ads, premium)

4. **Tool Adoption**
   - **Risk Level:** Low
   - **Impact:** Users may not discover or use tools
   - **Mitigation:**
     - Prominent "Tools" menu in navigation
     - Embed calculator in detail page
     - In-app tooltips highlighting features
   - **Contingency:** Promote tools via social media, email

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

### Sprint-Level Definition of Done
- ✅ All 8 stories complete
- ✅ All tools accessible from "Tools" menu
- ✅ Historical page at `/history` with 50+ IPOs
- ✅ Lot calculator embedded in detail page
- ✅ Broker affiliate buttons on detail page
- ✅ Affiliate click tracking functional
- ✅ Database tables seeded (registrars, holidays, historical IPOs)
- ✅ Zero critical bugs
- ✅ Mobile responsive on all tools
- ✅ E2E tests passing
- ✅ PO approval after demo

---

## Success Criteria

Sprint 5 is successful when:

1. **Functionality Complete**
   - All 5 tools delivered and functional
   - Historical archive accessible with 50+ IPOs
   - Affiliate integration live and tracking clicks
   - All tools responsive on mobile

2. **User Experience Validated**
   - Can use lot calculator (embedded + standalone)
   - Can compare 2-3 IPOs side-by-side
   - Can search registrar directory
   - Can view market holidays (2025-2026)
   - Can click affiliate links from detail page
   - Can browse historical IPOs with filters

3. **Performance Targets Met**
   - Tool page load <1.5 seconds
   - Calculator response <100ms
   - Historical page load <2 seconds
   - API response <500ms

4. **Quality Gates Passed**
   - Zero critical bugs
   - >80% test coverage
   - All E2E tests passing
   - Responsive on iPhone/Android

5. **Business Goals Achieved**
   - Revenue stream activated (affiliates)
   - User engagement tools delivered
   - SEO-optimized historical archive
   - Competitive feature parity

---

## Team Notes

**Sprint 5 Importance:** Critical utility features that increase user retention and activate revenue

**Parallelization:** Epic 5 and Epic 6 can run in parallel (no blocking dependencies)

**Velocity Note:** 32 points in 1 week = 32 pts/week (highest velocity yet, possible due to parallel epics)

**Data Preparation:** Historical data seeding must start Day 1 to avoid blocking Story 6.2

**Next Sprint:** Sprint 6 - Buffer & Polish (Week 8)

---

## Dependencies Chart

```
Epic 5 (Tools)                     Epic 6 (Historical)
─────────────                      ─────────────────────
Story 5.3 (Registrar) ──┐         Story 6.1 (API) ──┐
Story 5.4 (Holidays) ────┤                           │
Story 5.1 (Calculator) ──┤                           ├──> Story 6.2 (Page) ──> Story 6.3 (Performance)
Story 5.2 (Comparison) ──┤                           │
Story 5.5 (Affiliates) ──┘                           │

No cross-epic dependencies - full parallelization possible
```

**Critical Path:**
- Epic 5: 5.1 → 5.2 → 5.5 (sequential for detail page integration)
- Epic 6: 6.1 → 6.2 → 6.3 (sequential for historical page)
- Both epics run in parallel

---

## Sprint Retrospective Template

*To be filled after Sprint 5 completion*

### What Went Well
- TBD

### What Could Be Improved
- TBD

### Action Items for Sprint 6
- TBD

---

**Sprint Starts:** Week 7 (After Sprint 4 completion)
**Sprint Ends:** Week 7
**Next Sprint:** Sprint 6 - Buffer & Polish (Week 8)

---

**Status:** 📋 PLANNED - Ready to start after Sprint 4 completion
