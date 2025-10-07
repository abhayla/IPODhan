# Sprint 4 Plan: IPO Detail & Analysis

**Sprint Number:** 4
**Sprint Goal:** Build comprehensive IPO detail page with rating system and social features
**Epic:** Epic 4 - IPO Detail & Analysis
**Duration:** 2 weeks (33 points split across Weeks 5-6)
**Story Points:** 33
**Status:** 📋 PLANNED (0/33 points complete, 0%)

---

## Sprint Progress Summary

**Updated:** 2025-10-07

### Current Status: 📋 PLANNED (Ready to Start)

| Story | Points | Status | Quality | Notes |
|-------|--------|--------|---------|-------|
| 4.1 | 5 | 📋 PLANNED | - | GET /api/ipos/[slug] Route |
| 4.2 | 8 | 📋 PLANNED | - | Detail Page Components |
| 4.3 | 8 | 📋 PLANNED | - | IPO Detail Page Assembly |
| 4.4 | 5 | 📋 PLANNED | - | Rating System Implementation |
| 4.5 | 2 | 📋 PLANNED | - | Social Share Integration |
| 4.6 | 5 | 📋 PLANNED | - | Allotment Status Checker |

**Points Complete:** 0/33 (0%)
**Stories Complete:** 0/6 (0%)
**Quality Average:** TBD
**Target Velocity:** 16.5 pts/week

### Prerequisites ✅
- ✅ Sprint 3 Complete (IPO Listing & Discovery)
- ✅ Story 2.3 Complete (Repository Layer)
- ✅ Story 3.1 Complete (API Client)
- ✅ Story 1.4 Complete (shadcn/ui)

**All dependencies satisfied - Sprint 4 ready to start!**

### Sprint 4 Goals
1. **Implement IPO detail page** - Core feature for user investment decisions
2. **Build rating algorithm** - Help users evaluate IPO quality
3. **Add social sharing** - Enable viral growth
4. **Create allotment checker** - Post-IPO utility feature
5. **Achieve <2s page load** - Performance and SEO critical

---

## Sprint Objective

Deliver the comprehensive IPO detail page - the **core decision-making hub** where users:
- View complete IPO information (financials, subscriptions, GMP, documents)
- See algorithmic rating (1-5 stars) with rationale
- Compare IPO to peers
- Share IPO details on social media
- Check allotment status after IPO closes

**Critical Path:** Story 4.3 (IPO Detail Page Assembly) - Second most important page after dashboard

---

## Stories in This Sprint

### Story 4.1: GET /api/ipos/[slug] Route
**Priority:** Critical
**Points:** 5
**Status:** 📋 PLANNED
**Dependencies:** 2.3 ✅
**File:** `docs/stories/4.1.api-ipos-slug-route.story.md`

**Description:**
Create Next.js API route to fetch complete IPO details by slug, including all related data (financials, subscriptions, GMP history, documents, peers).

**Acceptance Criteria:**
- GET /api/ipos/[slug] endpoint implemented
- Returns full IPO object with relations
- Includes latest subscription data
- Includes 7-day GMP history
- Includes financial data (3-year trends)
- Includes peer comparison data
- Includes documents (DRHP, RHP, Prospectus)
- Includes registrar information
- Proper error handling (404 for invalid slug)
- Response time <500ms with caching
- API documented with TypeScript types

**Technical Requirements:**
- Uses IPORepository.findBySlug() from Story 2.3
- Server-side data fetching (Next.js Server Component support)
- Redis caching for frequently accessed IPOs
- Proper error responses with status codes

**Sample Response:**
```json
{
  "data": {
    "ipo": {
      "id": "uuid",
      "companyName": "Tech Corp",
      "slug": "tech-corp-ipo",
      "status": "OPEN",
      "priceRange": { "min": 300, "max": 350 },
      "openDate": "2025-01-15",
      "closeDate": "2025-01-17",
      "lotSize": 40,
      "issueSize": 1200,
      "sector": "Technology"
    },
    "financial": {
      "revenue": [100, 150, 200],
      "profit": [20, 35, 50],
      "years": [2022, 2023, 2024]
    },
    "latestSubscription": {
      "totalSubscription": 2.5,
      "retailSubscription": 3.2,
      "niiSubscription": 2.1,
      "qibSubscription": 1.8
    },
    "gmpHistory": [
      { "date": "2025-01-15", "gmp": 45, "price": 325 }
    ],
    "documents": [
      { "type": "DRHP", "url": "...", "size": "2.5MB" }
    ],
    "peers": [
      { "name": "Competitor A", "pe": 25, "marketCap": 5000 }
    ],
    "registrar": {
      "name": "Link Intime",
      "website": "https://linkintime.co.in"
    }
  }
}
```

---

### Story 4.2: Detail Page Components
**Priority:** Critical
**Points:** 8
**Status:** 📋 PLANNED
**Dependencies:** 1.4 ✅
**File:** `docs/stories/4.2.detail-page-components.story.md`

**Description:**
Build reusable React components for IPO detail page sections using shadcn/ui and Tailwind CSS.

**Acceptance Criteria:**
- IPOHeader component (company name, logo, status, rating)
- KeyMetricsCards component (issue size, subscription, GMP)
- InfoSection component (dates, price range, lot size)
- SubscriptionBreakdown component (QIB, NII, Retail bars)
- GMPChart component (7-day trend using Recharts)
- FinancialTable component (3-year revenue/profit)
- PeerComparisonTable component
- DocumentList component (DRHP, RHP downloads)
- CompanyOverview component (business, risk factors)
- RatingDisplay component (stars + rationale)
- ShareButtons component (WhatsApp, Twitter, Copy)
- AllotmentCheckerCard component
- All components responsive (mobile-first)
- All components use TypeScript interfaces
- Loading skeleton variants for all components
- Storybook stories for each component (optional)

**Component List:**
1. `IPOHeader.tsx` - Hero section with company info
2. `KeyMetricsCards.tsx` - 3-card grid (issue size, subscription, GMP)
3. `InfoSection.tsx` - Key details (dates, price, lot)
4. `SubscriptionBreakdown.tsx` - Horizontal bars with percentages
5. `GMPChart.tsx` - Line chart (Recharts library)
6. `FinancialTable.tsx` - Revenue, profit, margins table
7. `PeerComparisonTable.tsx` - Competitor comparison
8. `DocumentList.tsx` - Downloadable documents
9. `CompanyOverview.tsx` - Business model, risk factors
10. `RatingDisplay.tsx` - Star rating + explanation
11. `ShareButtons.tsx` - Social sharing buttons
12. `AllotmentCheckerCard.tsx` - Link to registrar

**Technical Requirements:**
- shadcn/ui components (Card, Table, Tabs, Badge)
- Recharts for GMP chart visualization
- Lucide React icons for UI elements
- Responsive design (mobile, tablet, desktop)
- Accessible (ARIA labels, keyboard navigation)

---

### Story 4.3: IPO Detail Page Assembly
**Priority:** Critical
**Points:** 8
**Status:** 📋 PLANNED
**Dependencies:** 3.1 ✅, 4.1, 4.2
**File:** `docs/stories/4.3.ipo-detail-page.story.md`

**Description:**
Assemble all components into main IPO detail page with progressive loading, SSR for above-fold content, and client-side tabs.

**Acceptance Criteria:**
- Detail page at `/ipos/[slug]` route
- Server-side rendering for Tier 1 data (above fold)
- Client-side tabs for Tier 2 data (Overview, Financials, Subscription, GMP, Documents)
- Progressive loading: Tier 1 → Tier 2
- URL updates on tab switch (e.g., `/ipos/tech-corp?tab=financials`)
- Breadcrumbs navigation (Home > IPOs > Company Name)
- 404 page for invalid slugs
- SEO metadata (title, description, Open Graph)
- Structured data (JSON-LD for IPO entity)
- Loading states for all async data
- Error boundaries for component failures
- Mobile-responsive layout
- Page load <2 seconds (Lighthouse >90)
- Smooth tab transitions (<500ms)

**Page Structure:**
```
┌─────────────────────────────────────┐
│ Breadcrumbs: Home > IPOs > Company  │ (Tier 1 - SSR)
│                                     │
│ IPOHeader                           │
│ KeyMetricsCards (3 cards)           │
│ InfoSection                         │
├─────────────────────────────────────┤
│ [Overview] [Financials] [Subscr...] │ (Tier 2 - CSR)
│                                     │
│ Tab Content (lazy loaded)           │
│ - Overview: CompanyOverview         │
│ - Financials: FinancialTable        │
│ - Subscription: SubscriptionBreakdown│
│ - GMP: GMPChart                     │
│ - Documents: DocumentList           │
├─────────────────────────────────────┤
│ AllotmentCheckerCard                │
│ ShareButtons                        │
└─────────────────────────────────────┘
```

**Technical Requirements:**
- Next.js App Router with dynamic routes
- generateStaticParams() for popular IPOs
- Server Component for initial data fetch
- Client Components for interactive tabs
- SWR or TanStack Query for client-side data
- Error handling with error.tsx
- Loading states with loading.tsx

---

### Story 4.4: Rating System Implementation
**Priority:** High
**Points:** 5
**Status:** 📋 PLANNED
**Dependencies:** 4.3
**File:** `docs/stories/4.4.rating-system.story.md`

**Description:**
Implement algorithmic rating system (1-5 stars) based on subscription, promoter holding, financials, GMP, and peer comparison.

**Acceptance Criteria:**
- Rating algorithm implemented (5 factors)
- Factor weights: Subscription (30%), Promoter (20%), Financials (20%), GMP (15%), Peer P/E (15%)
- Output: 1-5 stars (0.5 increments)
- Rationale text generated (explains rating)
- Rating displayed on detail page
- Rating badge on IPO cards (dashboard)
- Admin override capability (future)
- Rating only shown if sufficient data available
- Rating updated when IPO data changes
- Unit tests for algorithm edge cases
- Documentation of methodology

**Rating Algorithm:**
```typescript
interface RatingFactors {
  subscription: number;    // 0-100 (subscription × 10)
  promoterHolding: number; // 0-100 (holding percentage)
  financialGrowth: number; // 0-100 (YoY growth)
  gmp: number;            // 0-100 (GMP % of price)
  peerPE: number;         // 0-100 (relative to peers)
}

Rating = (
  (subscription × 0.30) +
  (promoterHolding × 0.20) +
  (financialGrowth × 0.20) +
  (gmp × 0.15) +
  (peerPE × 0.15)
) / 20  // Normalize to 1-5 scale

Output: { rating: 4.5, rationale: "Strong subscription..." }
```

**Technical Requirements:**
- Rating calculation service/utility
- Database column for storing computed rating
- Recalculation trigger on data updates
- Cache rating results (recalc daily)
- Graceful handling of missing data

---

### Story 4.5: Social Share Integration
**Priority:** Medium
**Points:** 2
**Status:** 📋 PLANNED
**Dependencies:** 4.3
**File:** `docs/stories/4.5.social-share.story.md`

**Description:**
Add social sharing functionality (WhatsApp, Twitter, Copy Link) to IPO detail page for viral growth.

**Acceptance Criteria:**
- ShareButtons component with 3 options:
  - WhatsApp (mobile deep link)
  - Twitter (pre-filled tweet)
  - Copy Link (clipboard API)
- Share text includes: Company name, rating, key metrics
- Mobile-optimized (native share on supported devices)
- Copy confirmation toast notification
- Share tracking (analytics event)
- Open Graph tags for rich previews
- Twitter Card metadata
- Share URL includes UTM parameters
- Responsive button layout

**Share Text Template:**
```
Check out {Company Name} IPO on IPODhan!
Rating: ★★★★☆ 4.2/5
Price: ₹{min}-{max}
Subscription: {subscription}x
{url}
```

**Technical Requirements:**
- Web Share API for native sharing (mobile)
- Fallback to custom share for desktop
- Clipboard API for copy link
- UTM parameters: utm_source=share&utm_medium={platform}
- Toast notification on successful copy
- Analytics tracking for share events

---

### Story 4.6: Allotment Status Checker
**Priority:** High
**Points:** 5
**Status:** 📋 PLANNED
**Dependencies:** 4.3
**File:** `docs/stories/4.6.allotment-checker.story.md`

**Description:**
Create allotment status checker that redirects users to registrar website to check IPO allotment results.

**Acceptance Criteria:**
- AllotmentCheckerCard component on detail page
- Input field for PAN number (validation)
- "Check Status" button
- Redirect to registrar website with PAN parameter
- Only visible for CLOSED or LISTED IPOs
- Registrar information stored in database
- Support for major registrars (Link Intime, KFin, etc.)
- Mobile-responsive form
- PAN format validation (AAAAA9999A)
- Privacy notice (PAN not stored)
- Error handling for missing registrar data
- Analytics tracking for checker usage

**Supported Registrars:**
- Link Intime India
- KFin Technologies
- Bigshare Services
- Cameo Corporate Services
- Skyline Financial Services

**Technical Requirements:**
- PAN validation regex: `^[A-Z]{5}[0-9]{4}[A-Z]$`
- Registrar URL templates in database
- Query parameter mapping for each registrar
- External link with target="_blank" rel="noopener"
- Form validation with error messages
- Loading state during redirect

**Example Flow:**
1. User enters PAN: ABCDE1234F
2. Clicks "Check Status"
3. System validates PAN format
4. Opens registrar URL: `https://linkintime.co.in/ipo-allotment?pan=ABCDE1234F&ipo={slug}`
5. User checks status on registrar site

---

## Sprint Plan - Week Breakdown

### Week 1: API & Core Components (18 points)

**Days 1-2:** Story 4.1 - GET /api/ipos/[slug] Route (5 points)
- Critical path: Must complete first
- Implement API route with all data relations
- Add caching and error handling
- Write unit tests

**Days 3-5:** Story 4.2 - Detail Page Components (8 points)
- Build 12 reusable components
- Create loading skeletons
- Responsive design for all components
- Write unit tests for each component

**Weekend Buffer:** Story 4.3 - Start IPO Detail Page Assembly (5 of 8 points)
- Create page route and layout
- Implement SSR for Tier 1 data
- Start tab implementation

**Week 1 Target:** 13-18 points complete

---

### Week 2: Page Assembly & Features (15 points)

**Days 6-7:** Story 4.3 - Complete IPO Detail Page Assembly (remaining 3 points)
- Finish tab implementation
- Add SEO metadata and structured data
- Performance optimization (<2s load)
- Write E2E tests

**Days 8-9:** Story 4.4 - Rating System Implementation (5 points)
- Implement rating algorithm
- Generate rationale text
- Integrate into detail page and IPO cards
- Write unit tests for edge cases

**Day 10:** Story 4.5 - Social Share Integration (2 points)
- Add ShareButtons component
- Implement Web Share API with fallbacks
- Add Open Graph tags
- Test on mobile devices

**Day 10:** Story 4.6 - Allotment Status Checker (5 points)
- Build AllotmentCheckerCard
- PAN validation
- Registrar URL mapping
- Test redirect flows

**Week 2 Target:** 15 points complete

**Sprint Total:** 33 points (over 2 weeks)

---

## Sprint Metrics

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Story Points | 33 | 0/33 (0%) | 📋 Planned |
| Stories | 6 | 0/6 (0%) | 📋 Planned |
| Velocity | 16.5 pts/week | TBD | - |
| Test Coverage | >80% | TBD | - |
| Page Load Time | <2s | TBD | - |
| Lighthouse Performance | >90 | TBD | - |
| Lighthouse SEO | >95 | TBD | - |

---

## Technical Requirements

### Frontend Technologies
- Next.js 14.2+ with App Router (dynamic routes)
- React 18+ with TypeScript 5.3+
- shadcn/ui for UI components
- Tailwind CSS 3.4+ for styling
- Recharts for GMP chart visualization
- Lucide React for icons

### API Design
- RESTful API endpoint: GET /api/ipos/[slug]
- Server-side rendering for initial page load
- Client-side data fetching for tabs
- Redis caching for frequently accessed IPOs
- Response time target: <500ms

### Performance
- SSR for above-fold content (Tier 1)
- Client-side lazy loading for tabs (Tier 2)
- Code splitting for tab components
- Image optimization (Next.js Image)
- Font optimization (Next.js Font)
- Target: Lighthouse >90 (Performance), >95 (SEO)

### SEO & Metadata
- Dynamic meta tags (title, description)
- Open Graph tags for social sharing
- Twitter Card metadata
- Structured data (JSON-LD for IPO entity)
- Canonical URLs
- Breadcrumb schema

---

## Dependencies

### Satisfied Dependencies ✅
- ✅ Story 1.4: shadcn/ui Component Library
- ✅ Story 2.3: Repository Layer (IPORepository)
- ✅ Story 3.1: API Client Service
- ✅ Sprint 3 Complete: Dashboard, Filters, Search, Loading States

### External Dependencies
- **Recharts** (for GMP chart) - Need to install: `npm install recharts`
- **Web Share API** (browser support varies) - Fallback required
- **Clipboard API** (modern browsers) - Fallback for older browsers

### This Sprint Blocks
- Epic 5: Story 5.2 (Lot Size Calculator) - Will be embedded in detail page
- Epic 6: Historical IPO data display

---

## Risk Assessment

### High Priority Risks

1. **Page Complexity → Slow Load Time**
   - **Risk Level:** High
   - **Impact:** User frustration, poor SEO, high bounce rate
   - **Mitigation:**
     - Progressive loading (Tier 1 SSR, Tier 2 lazy)
     - Code splitting for tab components
     - Redis caching for API responses
     - Image optimization with Next.js Image
   - **Contingency:** Remove non-essential sections (peer comparison optional)

2. **Rating Algorithm Controversy**
   - **Risk Level:** Medium
   - **Impact:** User trust issues, legal concerns
   - **Mitigation:**
     - Clear methodology disclosure on page
     - Disclaimer: "Algorithmic rating, not investment advice"
     - Admin override capability
     - Hide rating if insufficient data
   - **Contingency:** Make rating completely optional, show only on request

3. **API Response Time**
   - **Risk Level:** Medium
   - **Impact:** Slow page load, poor user experience
   - **Mitigation:**
     - Redis caching (TTL: 5 minutes for hot IPOs)
     - Database query optimization
     - Parallel data fetching where possible
   - **Contingency:** Reduce data returned, fetch some data client-side

### Medium Priority Risks

4. **Mobile Performance**
   - **Risk Level:** Medium
   - **Impact:** Poor mobile UX (70% of traffic)
   - **Mitigation:**
     - Mobile-first design
     - Reduce component complexity on mobile
     - Test on real devices (not just emulators)
   - **Contingency:** Simplified mobile layout

5. **Social Share Preview Issues**
   - **Risk Level:** Low
   - **Impact:** Poor share aesthetics, reduced viral growth
   - **Mitigation:**
     - Test Open Graph tags with Facebook debugger
     - Test Twitter Cards with Twitter validator
     - Ensure images load correctly
   - **Contingency:** Use generic preview image

---

## Definition of Done

Each story must meet:
- ✅ All acceptance criteria passed
- ✅ Unit tests written (>80% coverage)
- ✅ E2E tests for critical paths
- ✅ TypeScript compilation clean
- ✅ Linting passes (0 errors, 0 warnings)
- ✅ Responsive design tested (mobile, tablet, desktop)
- ✅ Accessibility standards met (ARIA, keyboard navigation)
- ✅ Code reviewed
- ✅ Documentation updated

### Sprint-Level Definition of Done
- ✅ Detail page accessible at /ipos/[slug]
- ✅ All PRD sections implemented and visible
- ✅ Rating displays for IPOs with sufficient data
- ✅ Social sharing works (tested on mobile)
- ✅ Allotment checker redirects to registrar
- ✅ Lighthouse: Performance >90, SEO >95
- ✅ Structured data (JSON-LD) for IPO entity
- ✅ E2E test: Navigate from dashboard, view all tabs, share link
- ✅ PO approval after demo

---

## Success Criteria

Sprint 4 is successful when:

1. **Functionality Complete**
   - IPO detail page live at /ipos/[slug]
   - All 6 stories implemented
   - Rating system functional
   - Social sharing working
   - Allotment checker operational

2. **Performance Targets Met**
   - Page load <2 seconds
   - Tab switch <500ms
   - Lighthouse Performance >90
   - Lighthouse SEO >95

3. **Quality Gates Passed**
   - Zero critical bugs
   - >80% test coverage
   - All E2E tests passing
   - Mobile responsive on iPhone/Android

4. **User Experience Validated**
   - Can navigate from dashboard to detail page
   - Can view all tabs without errors
   - Can share IPO link on WhatsApp
   - Can check allotment status
   - Page loads fast on 3G network

5. **Business Goals Achieved**
   - Second most important page delivered
   - SEO-optimized for organic traffic
   - Social sharing enables viral growth
   - Foundation for broker affiliate CTAs (future)

---

## Team Notes

**Epic 4 Importance:** Core revenue-generating page - where users make investment decisions and click broker affiliate links

**Critical Path:** Story 4.3 (IPO Detail Page Assembly) - Most complex page in entire app

**Velocity Note:** 33 points over 2 weeks = 16.5 pts/week (slightly below Sprint 3's 17 pts/week, but acceptable given page complexity)

**Next Epic:** Epic 5 - IPO Investment Tools (Lot Calculator, GMP Tracker) - 18 points, 1 week

---

## Dependencies Chart

```
Story 4.1 (API Route) ──┐
                        ├──> Story 4.3 (Page Assembly) ──┐
Story 4.2 (Components) ─┘                                 │
                                                          ├──> Story 4.4 (Rating)
                                                          │
                                                          ├──> Story 4.5 (Social Share)
                                                          │
                                                          └──> Story 4.6 (Allotment)
```

**Critical Path:** 4.1 → 4.2 → 4.3 (21 points, must complete in sequence)
**Parallel Path:** 4.4, 4.5, 4.6 (12 points, can run in parallel after 4.3)

---

## Sprint Retrospective Template

*To be filled after Sprint 4 completion*

### What Went Well
- TBD

### What Could Be Improved
- TBD

### Action Items for Sprint 5
- TBD

---

**Sprint Starts:** Week 5 (After Sprint 3 completion)
**Sprint Ends:** Week 6
**Next Sprint:** Sprint 5 - Epic 5 (IPO Investment Tools) - 18 points

---

**Status:** 📋 PLANNED - Ready to start Story 4.1
