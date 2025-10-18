# Epic 4: IPO Detail & Analysis

## Epic Goal

Build comprehensive IPO detail page with rating system and social features to serve as the core decision-making hub where users can view complete IPO information (financials, subscriptions, GMP, documents), see algorithmic rating with rationale, compare IPO to peers, share IPO details on social media, and check allotment status after IPO closes. This is the second most important page after the dashboard and the primary revenue-generating page where users make investment decisions and will eventually click broker affiliate links.

## Stories

### Story 4.1: GET /api/ipos/[slug] Route

**As a** developer building the IPO detail page,
**I want** a backend API endpoint that fetches complete IPO details by slug,
**so that** the detail page can display all necessary IPO information including financials, subscriptions, GMP history, documents, peers, and registrar data.

#### Acceptance Criteria

1. GET /api/ipos/[slug] endpoint implemented
2. Returns full IPO object with relations
3. Includes latest subscription data
4. Includes 7-day GMP history
5. Includes financial data (3-year trends)
6. Includes peer comparison data
7. Includes documents (DRHP, RHP, Prospectus)
8. Includes registrar information
9. Proper error handling (404 for invalid slug)
10. Response time <500ms with caching
11. API documented with TypeScript types

---

### Story 4.2: Detail Page Components

**As a** frontend developer building the IPO detail page,
**I want** reusable React components for each section of the detail page,
**so that** I can assemble the page efficiently with consistent UI and responsive design.

#### Acceptance Criteria

1. IPOHeader component (company name, logo, status, rating)
2. KeyMetricsCards component (issue size, subscription, GMP)
3. InfoSection component (dates, price range, lot size)
4. SubscriptionBreakdown component (QIB, NII, Retail bars)
5. GMPChart component (7-day trend using Recharts)
6. FinancialTable component (3-year revenue/profit)
7. PeerComparisonTable component
8. DocumentList component (DRHP, RHP downloads)
9. CompanyOverview component (business, risk factors)
10. RatingDisplay component (stars + rationale)
11. ShareButtons component (WhatsApp, Twitter, Copy)
12. AllotmentCheckerCard component
13. All components responsive (mobile-first)
14. All components use TypeScript interfaces
15. Loading skeleton variants for all components
16. Storybook stories for each component (optional)

---

### Story 4.3: IPO Detail Page Assembly

**As a** user researching IPOs,
**I want** a comprehensive detail page that loads quickly and displays all IPO information in an organized manner,
**so that** I can make informed investment decisions based on complete data.

#### Acceptance Criteria

1. Detail page at `/ipos/[slug]` route
2. Server-side rendering for Tier 1 data (above fold)
3. Client-side tabs for Tier 2 data (Overview, Financials, Subscription, GMP, Documents)
4. Progressive loading: Tier 1 → Tier 2
5. URL updates on tab switch (e.g., `/ipos/tech-corp?tab=financials`)
6. Breadcrumbs navigation (Home > IPOs > Company Name)
7. 404 page for invalid slugs
8. SEO metadata (title, description, Open Graph)
9. Structured data (JSON-LD for IPO entity)
10. Loading states for all async data
11. Error boundaries for component failures
12. Mobile-responsive layout
13. Page load <2 seconds (Lighthouse >90)
14. Smooth tab transitions (<500ms)

---

### Story 4.4: Rating System Implementation

**As a** user evaluating IPO investment opportunities,
**I want** an algorithmic rating (1-5 stars) based on subscription, promoter holding, financials, GMP, and peer comparison,
**so that** I can quickly assess IPO quality and make better investment decisions.

#### Acceptance Criteria

1. Rating algorithm implemented (5 factors)
2. Factor weights: Subscription (30%), Promoter (20%), Financials (20%), GMP (15%), Peer P/E (15%)
3. Output: 1-5 stars (0.5 increments)
4. Rationale text generated (explains rating)
5. Rating displayed on detail page
6. Rating badge on IPO cards (dashboard)
7. Admin override capability (future)
8. Rating only shown if sufficient data available
9. Rating updated when IPO data changes
10. Unit tests for algorithm edge cases
11. Documentation of methodology

---

### Story 4.5: Social Share Integration

**As a** user who wants to share IPO information with others,
**I want** social sharing functionality for WhatsApp, Twitter, and copy link,
**so that** I can easily spread the word about interesting IPOs.

#### Acceptance Criteria

1. ShareButtons component with 3 options (WhatsApp, Twitter, Copy Link)
2. Share text includes: Company name, rating, key metrics
3. Mobile-optimized (native share on supported devices)
4. Copy confirmation toast notification
5. Share tracking (analytics event)
6. Open Graph tags for rich previews
7. Twitter Card metadata
8. Share URL includes UTM parameters
9. Responsive button layout

---

### Story 4.6: Allotment Status Checker

**As a** user who applied for an IPO,
**I want** an allotment status checker that redirects me to the registrar website,
**so that** I can quickly check if I received IPO shares.

#### Acceptance Criteria

1. AllotmentCheckerCard component on detail page
2. Input field for PAN number (validation)
3. "Check Status" button
4. Redirect to registrar website with PAN parameter
5. Only visible for CLOSED or LISTED IPOs
6. Registrar information stored in database
7. Support for major registrars (Link Intime, KFin, etc.)
8. Mobile-responsive form
9. PAN format validation (AAAAA9999A)
10. Privacy notice (PAN not stored)
11. Error handling for missing registrar data
12. Analytics tracking for checker usage

---

## Technical Notes

### Dependencies
- Story 4.3 depends on: 4.1, 4.2
- Stories 4.4, 4.5, 4.6 depend on: 4.3

### Performance Targets
- Page load: <2 seconds
- API response: <500ms
- Tab transitions: <500ms
- Lighthouse Performance: >90
- Lighthouse SEO: >95

### External Libraries
- Recharts (for GMP chart visualization)
- Web Share API (browser-dependent, requires fallback)
- Clipboard API (modern browsers)

### Story Points
- Story 4.1: 5 points
- Story 4.2: 8 points
- Story 4.3: 8 points
- Story 4.4: 5 points
- Story 4.5: 2 points
- Story 4.6: 5 points
- **Total: 33 points**

---

**Epic Status:** Ready for Story Creation
**Sprint:** Sprint 4 (Weeks 5-6)
**Business Value:** High - Core revenue-generating feature
