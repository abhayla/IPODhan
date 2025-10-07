# Epic 5: IPO Investment Tools

**Epic ID:** epic-5
**Priority:** High
**Story Points:** 19
**Timeline:** Week 7 (1 week)
**Status:** 📋 PLANNED
**Dependencies:** Epic 4 (IPO Detail Page)

---

## Epic Overview

Build investment tools to help users make better IPO decisions: lot size calculator, IPO comparison tool, registrar directory, market holidays calendar, and broker affiliate integration.

### Business Value

- **User Empowerment:** Enable users to calculate investments and compare IPOs side-by-side
- **Utility & Engagement:** Provide essential tools that increase user retention
- **Revenue Generation:** Broker affiliate integration drives monetization
- **Trust Building:** Registrar directory and market holidays demonstrate comprehensive support

### User Personas

**Primary:** Priya (newcomer investor) - needs calculators and comparison tools
**Secondary:** Rahul (active investor) - uses tools for quick analysis

---

## Stories in This Epic

### Story 5.1: Lot Size Calculator
**Priority:** High
**Points:** 4
**Status:** ✅ READY (Story created and approved)
**File:** `docs/stories/5.1.lot-size-calculator.story.md`

**Description:**
Interactive calculator that computes number of lots, shares, and total investment based on user's investment amount and IPO lot size.

**Functional Requirements (FR-10):**

**Embedded Widget on Detail Page:**
- Embedded calculator widget on IPO detail page
- Pre-filled with current IPO data (lot size, price range)
- Input field: Investment amount (₹ with comma separators)
- Real-time calculation (debounced 300ms)
- Output display:
  - Number of lots (integer)
  - Total shares (formatted with commas)
  - Total investment amount (rounded to lot size)
- Calculation formula: `lots = floor(investmentAmount / (lotSize * pricePerShare))`
- Validation: Minimum investment = 1 lot
- Error handling: Invalid inputs show inline messages
- Mobile-responsive design

**Standalone Page:**
- Route: `/tools/lot-calculator`
- Dropdown to select any OPEN or UPCOMING IPO
- Same calculation logic as embedded widget
- Results update on IPO selection
- Share URL with pre-selected IPO: `/tools/lot-calculator?ipo=tech-corp-ipo`

**Technical Implementation:**
- Create `LotCalculator.tsx` shared component
- API endpoint: `POST /api/tools/lot-calculator`
- Client-side calculation (no API needed for MVP)
- Zod validation for inputs
- localStorage to remember last used IPO (standalone page)

**Acceptance Criteria:**
1. ✅ Embedded calculator widget on IPO detail page
2. ✅ Standalone calculator page at `/tools/lot-calculator`
3. ✅ Input field accepts investment amount (₹ with comma separators)
4. ✅ Calculator displays: lots, shares, total investment
5. ✅ Real-time calculation (debounced 300ms)
6. ✅ Pre-filled with IPO data when accessed from detail page
7. ✅ Dropdown to select any IPO on standalone page
8. ✅ Validation: Minimum investment = 1 lot
9. ✅ Error handling for invalid inputs
10. ✅ Mobile-responsive design

---

### Story 5.2: IPO Comparison Tool
**Priority:** High
**Points:** 6
**Status:** ✅ READY (Story created and approved)
**File:** `docs/stories/5.2.ipo-comparison.story.md`

**Description:**
Side-by-side comparison of 2-3 IPOs to help users evaluate and choose between opportunities.

**Functional Requirements (FR-11):**

**Comparison Page:**
- Route: `/tools/compare`
- Select 2-3 IPOs via dropdown (search-enabled)
- Comparison table shows side-by-side:
  - Company name, logo, status badge
  - Price range (min-max)
  - Lot size
  - Issue size (₹ crore)
  - Open date → Close date
  - Subscription status (if OPEN or CLOSED)
  - GMP (if available)
  - Rating (if calculated)
  - Key financials (revenue, profit - last year)
  - Sector
  - Lead managers
  - Exchange listing
- Shareable URL: `/tools/compare?ipos=slug1,slug2,slug3`
- "Clear" button to reset selection
- "Add another IPO" button (max 3)

**Comparison Entry Points:**
- Dashboard: "Compare" button on each IPO card
- Detail page: "Compare with other IPOs" button
- Navigation: "Tools" → "Compare IPOs"

**Responsive Design:**
- Desktop: Full table with horizontal scroll
- Tablet: Collapsible columns with key metrics visible
- Mobile: Card-based view (swipe between IPOs)

**Technical Implementation:**
- Create `IPOComparison.tsx` page component
- API endpoint: `GET /api/tools/compare?ipos=slug1,slug2`
- Use IPORepository to fetch multiple IPOs
- State management: React Context or component state
- URL query params for shareability
- localStorage to persist last comparison

**Acceptance Criteria:**
1. ✅ Comparison page at `/tools/compare`
2. ✅ Select 2-3 IPOs via dropdown (search-enabled)
3. ✅ Comparison table shows 15+ data points side-by-side
4. ✅ Shareable URL with IPO slugs in query params
5. ✅ "Clear" and "Add another IPO" buttons
6. ✅ Entry points from dashboard and detail page
7. ✅ Desktop: Full table; Mobile: Card-based swipe view
8. ✅ Error handling: Show message if IPO not found
9. ✅ Loading states for data fetch
10. ✅ Mobile-responsive design

---

### Story 5.3: Registrar Directory
**Priority:** Medium
**Points:** 4
**Status:** 📋 PLANNED
**File:** To be created

**Description:**
Comprehensive searchable directory of IPO registrars with contact information.

**Functional Requirements (FR-9):**

**Registrar Directory Page:**
- Route: `/registrars`
- Display registrars in alphabetical order
- Show for each registrar:
  - Registrar name (full and short name)
  - Contact email (e.g., `rubicon.ipo@linkintime.co.in`)
  - Phone number (if available)
  - Website URL (clickable, opens in new tab)
  - IPO allotment page link
  - Logo (if available)
- Search bar (filters by registrar name)
- Responsive: Table on desktop, cards on mobile

**Registrar Information Storage:**
- Database table: `registrars`
- Fields: name, short_name, email, phone, website, allotment_url, logo_url
- Seed data with 10-15 major registrars:
  - Link Intime India
  - KFin Technologies
  - Bigshare Services
  - Cameo Corporate Services
  - Skyline Financial Services
  - Beacon Trusteeship
  - Mas Services
  - Alankit Assignments
  - Integrated Registry Management Services
  - Purva Sharegistry

**Integration with Detail Page:**
- Link from allotment checker (Story 4.6)
- "View all registrars" link redirects to directory
- Detail page shows registrar info from `ipos.registrar_id` FK

**Technical Implementation:**
- Create `app/registrars/page.tsx`
- API endpoint: `GET /api/registrars`
- Create `RegistrarRepository` in backend
- Client-side search using Fuse.js for fuzzy matching
- Static page with ISR (revalidate every 7 days)

**Acceptance Criteria:**
1. ✅ Dedicated Registrar Directory page at `/registrars`
2. ✅ Display registrars in alphabetical order
3. ✅ Show: name, email, phone, website, allotment link for each
4. ✅ Search bar filters by registrar name
5. ✅ Responsive: Table on desktop, cards on mobile
6. ✅ Database table `registrars` with 10-15 seed entries
7. ✅ Integration with IPO detail page (linked from allotment checker)
8. ✅ Clickable website URLs open in new tab
9. ✅ Loading states and error handling
10. ✅ Accessible from "Tools" menu in navigation

---

### Story 5.4: Market Holidays Calendar
**Priority:** Medium
**Points:** 4
**Status:** 📋 PLANNED
**File:** To be created

**Description:**
Display NSE/BSE trading holidays to help users plan IPO applications and understand market closures affecting IPO timelines.

**Functional Requirements (FR-8):**

**Market Holidays Page:**
- Route: `/market-holidays`
- Display holidays in chronological order (upcoming first)
- Show for each holiday:
  - Date (DD MMM YYYY format, e.g., "26 Jan 2025")
  - Holiday name (e.g., "Republic Day", "Diwali")
  - Exchange(s) affected: NSE, BSE, or Both
  - Day of week (e.g., "Monday")
- Highlight upcoming holidays (next 7 days) with visual badge
- Past holidays shown in muted color

**Filters:**
- Year: 2024, 2025, 2026 (default: current year)
- Exchange: All, NSE Only, BSE Only
- Upcoming / All toggle

**Calendar View (Phase 2):**
- Month/year calendar view
- Color-coded markers on holiday dates
- Click on date shows holiday details

**Technical Implementation:**
- Create `app/market-holidays/page.tsx`
- Database table: `market_holidays`
- Fields: date, holiday_name, exchange (NSE/BSE/BOTH), year
- Seed data from official NSE/BSE calendars (manual entry for MVP)
- API endpoint: `GET /api/market-holidays?year=2025&exchange=NSE`
- Static page with ISR (revalidate every 30 days)

**Data Source:**
- Official NSE holiday calendar: https://www.nseindia.com/regulations/trading-holidays
- Official BSE holiday calendar: https://www.bseindia.com/static/about/Market_Holidays.aspx
- Manual data entry acceptable for MVP
- Updated annually

**Acceptance Criteria:**
1. ✅ Market Holidays page at `/market-holidays`
2. ✅ Display holidays in chronological order (upcoming first)
3. ✅ Show: date, holiday name, exchange, day of week
4. ✅ Highlight upcoming holidays (next 7 days)
5. ✅ Filters: Year, Exchange, Upcoming/All toggle
6. ✅ Database table `market_holidays` with seed data
7. ✅ Responsive: List view on mobile, table on desktop
8. ✅ Data seeded from NSE/BSE official calendars
9. ✅ Accessible from "Tools" menu in navigation
10. ✅ Loading states and error handling

---

### Story 5.5: Broker Affiliate Integration
**Priority:** Medium
**Points:** 6
**Status:** 📋 PLANNED
**File:** To be created

**Description:**
Integrate affiliate links for Zerodha and AngelOne brokers to enable revenue generation while helping users apply for IPOs.

**Functional Requirements (FR-6):**

**Affiliate Link Placement:**

1. **IPO Detail Page - Primary CTA:**
   - "Apply for this IPO" section below key details
   - Two broker buttons displayed:
     ```
     ┌─────────────────────────────────────────────┐
     │ Apply for this IPO                          │
     ├─────────────────────────────────────────────┤
     │ [Zerodha Logo] Apply via Zerodha       [→]  │
     │ [AngelOne Logo] Apply via AngelOne     [→]  │
     └─────────────────────────────────────────────┘
     ```
   - Buttons styled prominently but not overly aggressive
   - Affiliate links tagged with IPODhan referral codes

2. **Homepage/Dashboard:**
   - Small banner/card: "New to IPO investing? Open a free demat account"
   - Links to Zerodha and AngelOne with brief value props
   - Dismissible (hide for 7 days if user closes)

**Affiliate Link Configuration:**
- **Zerodha:** `https://signup.zerodha.com/?c=ZMPHZC`
- **AngelOne:** `https://tinyurl.com/2d98g2qe`
- Stored in `.env.local` as environment variables
- Centralized config file: `lib/config/affiliate-links.ts`

**Tracking & Analytics:**
- Log all affiliate link clicks to database (`affiliate_clicks` table)
- Track: IPO ID, broker name, click timestamp, user session (anonymized)
- Google Analytics event: `affiliate_click` with broker parameter
- Admin dashboard to view click-through rates (Phase 2)

**Disclosure & Transparency:**
- Footer disclaimer on every page:
  - "IPODhan may earn a commission if you open an account through our affiliate links. This does not affect the information we provide."
- Comply with advertising guidelines

**Technical Implementation:**
- Create `BrokerButton.tsx` component
- Create `AffiliateCTA.tsx` component for homepage banner
- API endpoint: `POST /api/affiliate/track` to log clicks
- Database table: `affiliate_clicks` with fields:
  - id, ipo_id, broker (zerodha/angelone), source (detail_page/homepage), clicked_at, user_session
- Affiliate links open in new tab (`target="_blank" rel="noopener"`)
- Use Next.js Link component with onClick tracking event

**Acceptance Criteria:**
1. ✅ "Apply for this IPO" section on IPO detail page
2. ✅ Two broker buttons: Zerodha and AngelOne with logos
3. ✅ Homepage banner: "Open a free demat account" (dismissible)
4. ✅ Affiliate links stored in `.env.local`
5. ✅ Centralized config file: `lib/config/affiliate-links.ts`
6. ✅ Database table `affiliate_clicks` for tracking
7. ✅ Google Analytics event tracking for clicks
8. ✅ Footer disclaimer on every page
9. ✅ Links open in new tab with proper rel attributes
10. ✅ Mobile-responsive button layout

---

## Epic Dependencies

### Blocking Dependencies (Must Complete First)
- ✅ Story 4.3: IPO Detail Page Assembly - For embedding lot calculator
- ✅ Story 3.3: IPO Card Component - For dashboard comparison entry points

### Downstream Impact (This Epic Blocks)
- None - Epic 5 is independent and doesn't block other epics

---

## Epic Success Criteria

Epic 5 is successful when:

1. **Functionality Complete:**
   - ✅ Lot calculator functional (embedded + standalone)
   - ✅ IPO comparison tool allows 2-3 IPO comparison
   - ✅ Registrar directory accessible with search
   - ✅ Market holidays calendar displays NSE/BSE holidays
   - ✅ Broker affiliate buttons on detail page and homepage

2. **User Experience:**
   - ✅ All tools mobile-responsive
   - ✅ Real-time calculations (no lag)
   - ✅ Shareable URLs for comparison tool
   - ✅ Intuitive navigation from main menu

3. **Data Quality:**
   - ✅ 10-15 registrars seeded in database
   - ✅ 2025-2026 market holidays seeded
   - ✅ Affiliate links properly configured

4. **Analytics & Tracking:**
   - ✅ Affiliate click tracking functional
   - ✅ Google Analytics events firing
   - ✅ Admin can view click data (basic queries)

5. **Business Goals:**
   - ✅ Revenue stream activated (affiliate integration)
   - ✅ User engagement tools live
   - ✅ Competitive feature parity achieved

---

## Technical Architecture

### Frontend Components
- `LotCalculator.tsx` - Shared calculator widget
- `IPOComparison.tsx` - Comparison page
- `RegistrarCard.tsx` - Registrar display component
- `MarketHolidaysList.tsx` - Holidays list component
- `BrokerButton.tsx` - Affiliate CTA button
- `AffiliateCTA.tsx` - Homepage affiliate banner

### API Routes
- `POST /api/tools/lot-calculator` - Calculate lots (optional, client-side for MVP)
- `GET /api/tools/compare?ipos=slug1,slug2` - Fetch comparison data
- `GET /api/registrars` - Fetch registrar directory
- `GET /api/market-holidays?year=2025` - Fetch holidays
- `POST /api/affiliate/track` - Log affiliate clicks

### Database Tables
- `registrars` - Registrar information
- `market_holidays` - NSE/BSE holidays
- `affiliate_clicks` - Click tracking

### Configuration Files
- `lib/config/affiliate-links.ts` - Centralized affiliate config
- `.env.local` - Environment variables for affiliate links

---

## Testing Requirements

### Unit Tests
- Lot calculator calculation logic (various inputs)
- IPO comparison data fetching and display
- Registrar search filtering
- Affiliate link tracking

### Integration Tests
- Lot calculator API endpoint (if server-side)
- Comparison tool with multiple IPO slugs
- Registrar directory API
- Market holidays API

### E2E Tests
1. **Lot Calculator Journey:**
   - Navigate to detail page → Use embedded calculator → See results
   - Navigate to `/tools/lot-calculator` → Select IPO → Calculate → Share URL

2. **Comparison Tool Journey:**
   - Navigate to dashboard → Click "Compare" on 2 IPOs → View comparison
   - Share comparison URL → Open in new browser → See same comparison

3. **Affiliate Click Journey:**
   - Navigate to detail page → Click "Apply via Zerodha" → New tab opens → Click tracked

### Performance Tests
- Calculator response time: <100ms
- Comparison page load: <1.5s
- Affiliate click tracking: <200ms

---

## Risk Management

### Medium Priority Risks

1. **Affiliate Conversion Uncertainty:**
   - **Risk:** Users may not click affiliate links
   - **Impact:** No revenue generation
   - **Mitigation:**
     - A/B test CTA placements
     - Optimize button copy and design
     - Track click-through rates
   - **Contingency:** Explore alternative monetization (ads, premium features)

2. **Registrar Data Staleness:**
   - **Risk:** Registrar contact info changes
   - **Impact:** Users get wrong information
   - **Mitigation:**
     - Manual annual review process
     - User feedback form to report outdated info
   - **Contingency:** Display "Last updated: [Date]" disclaimer

3. **Market Holidays Data Maintenance:**
   - **Risk:** Holidays data becomes outdated
   - **Impact:** Users plan incorrectly
   - **Mitigation:**
     - Annual data refresh process (December)
     - Admin interface to update holidays (Phase 2)
   - **Contingency:** Link to official NSE/BSE calendars as fallback

### Low Priority Risks

4. **Comparison Tool Performance:**
   - **Risk:** Comparing 3 IPOs may be slow
   - **Impact:** Poor UX, user frustration
   - **Mitigation:**
     - Cache comparison results (5 min TTL)
     - Optimize database queries
   - **Contingency:** Reduce to 2 IPO comparison max

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
- ✅ All 5 stories complete
- ✅ All tools accessible from "Tools" menu
- ✅ Affiliate tracking functional
- ✅ Database tables seeded with initial data
- ✅ Zero critical bugs
- ✅ Mobile responsive on all tools
- ✅ PO approval after demo

---

## Sprint Planning

**Sprint 5 Assignment:** Week 7 (19 points)

**Day-by-Day Breakdown:**

**Day 1 (4 hours):**
- Story 5.3: Registrar Directory (4 points)
- Story 5.4: Market Holidays (4 points)

**Day 2 (4 hours):**
- Story 5.1: Lot Calculator (4 points)

**Day 3 (6 hours):**
- Story 5.2: IPO Comparison Tool (6 points)

**Day 4 (6 hours):**
- Story 5.5: Broker Affiliate Integration (6 points)

**Day 5 (buffer):**
- Bug fixes, testing, polish
- E2E test suite for all tools
- Performance optimization

**Note:** Stories 5.3 and 5.4 can run in parallel (no dependencies)

---

## Epic Retrospective Template

*To be filled after Epic 5 completion*

### What Went Well
- TBD

### What Could Be Improved
- TBD

### Action Items for Epic 6
- TBD

---

**Epic Status:** 📋 PLANNED - Ready to start after Epic 4 complete
**Next Epic:** Epic 6 - Historical IPO Performance (13 points, Week 7 parallel)
