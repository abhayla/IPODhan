# Components

The system is composed of the following major logical components across the fullstack application.

## Frontend Application (Next.js App)

**Responsibility:** User-facing web application providing IPO browsing, search, detailed views, and email subscription management.

**Key Interfaces:**
- Server Components: Render IPO listings, detail pages with Tier 1 data (SSR)
- Client Components: Interactive UI (filters, tabs, tooltips, modals)
- API Client Service: Fetch data from Next.js API routes
- State Management: React Context for filters, search state, UI state 🔵 **MVP**

**Technology Stack:** Next.js 15.5.4 App Router, React 19 Server Components, TypeScript, Tailwind CSS 4, React Context

### IPO Detail Page Components (Epic 11) ✅ **Production**

**Responsibility:** Rich, data-driven sections providing comprehensive IPO analysis for investors.

**Implemented Components (8 total):**

1. **PromoterHoldingSection** (Story 11.9)
   - Displays pre/post-IPO promoter shareholding percentages
   - Calculates equity dilution with color-coded indicators
   - Empty state handling for missing data
   - Location: `web/components/ipo/PromoterHoldingSection.tsx`

2. **AnchorInvestorsSection** (Story 11.10)
   - Shows anchor investor allocation data with lock-in periods
   - Individual investor details with subscription amounts
   - Institutional confidence indicators
   - Quality Score: 9.5/10 (54/54 tests passing)
   - Location: `web/components/ipo-detail/AnchorInvestorsSection.tsx`

3. **KPIHighlightSection** (Story 11.11)
   - 6 key financial metrics (Market Cap, ROE, RoNW, P/BV, EPS, P/E)
   - Pre/Post IPO comparisons with change percentages
   - Responsive grid layout (3→2→1 columns)
   - Quality Score: 9.7/10 (Highest - 49+ unit tests, 8+ integration tests)
   - Location: `web/components/ipo-detail/KPIHighlightSection.tsx`

4. **FinancialMetricsSection** (Story 11.12)
   - Enhanced with EBITDA and multi-period view (3 fiscal years)
   - YoY growth calculations and trend indicators
   - Comprehensive financial analysis for investor decision-making
   - Quality Score: 9.2/10 (13/13 acceptance criteria met)
   - Location: `web/components/ipo-detail/FinancialMetricsSection.tsx`

5. **IPOObjectivesSection** (Story 11.13)
   - Displays fund utilization objectives from DRHP
   - JSONB structure for flexible objective data
   - Admin panel integration for data management
   - Quality Score: 9.0/10
   - Location: `web/components/ipo-detail/IPOObjectivesSection.tsx`

6. **CompanyContactSection** (Story 11.14)
   - Company contact information (address, phone, email, website)
   - WCAG 2.1 Level AA accessibility compliant
   - Comprehensive test suite (>70% unit, 6/6 integration, 6/6 E2E)
   - Quality Score: 9.0/10
   - Location: `web/components/ipo-detail/CompanyContactSection.tsx`

7. **CategoryReservationSection** (Story 11.15)
   - Category-wise IPO reservation display
   - Bonus fallback calculation feature
   - Test coverage: >90% (exceeded 80% target)
   - Quality Score: 9.0/10
   - Location: `web/components/ipo-detail/CategoryReservationSection.tsx`

8. **RecommendationSummarySection** (Story 11.16)
   - Broker recommendations summary with aggregated ratings
   - Sentiment analysis (positive/negative split with TrendingUp/Down icons)
   - Top 3 Apply/Avoid reasons extraction using keyword matching
   - Admin moderation panel at `/admin/reviews` for content approval
   - Real-time cache invalidation on moderation actions
   - Quality Score: 9.5/10 (16/16 acceptance criteria, 92% test coverage)
   - Location: `web/components/ipo-detail/RecommendationSummarySection.tsx`

**Epic 11 Metrics:**
- Total Components: 8
- Average Quality Score: 9.21/10 (A - EXCELLENT)
- Acceptance Criteria Met: 91/91 (100%)
- Test Pass Rate: 100%
- Production Status: All deployed and functional

## API Routes (Next.js Backend)

**Responsibility:** RESTful API layer handling IPO data queries, search, subscription data, GMP history, and email subscription endpoints.

**Key Interfaces:**
- `GET /api/ipos` - List IPOs with filters
- `GET /api/ipos/[slug]` - IPO detail
- `GET /api/ipos/[slug]/subscription` - Subscription data
- `POST /api/subscribers` - Email subscription

**Technology Stack:** Next.js API Routes, TypeScript, Drizzle ORM, Redis client, Zod validation

## Repository Layer (Data Access)

**Responsibility:** Abstract database queries and caching logic behind clean interfaces. All repositories extend `BaseRepository` for cache-aside pattern.

**Key Repositories:**
- `IPORepository.findAll(filters)` - Query IPOs with filters/pagination
- `IPORepository.findBySlug(slug)` - Get IPO by slug with relations
- `SubscriptionRepository.findByIPO(ipoId)` - Get subscription history
- `GMPRepository.findByIPO(ipoId, days)` - Get GMP history
- `FinancialDataRepository.findByIPO(ipoId)` - Get financial metrics with EBITDA (Story 11.12)
- `AnchorInvestorRepository` - Anchor investor data with lock-in periods (Story 11.10)
- `ReviewRepository` - IPO reviews with aggregation & moderation (Story 11.16)

**New ReviewRepository Interfaces (Story 11.16):**
- `getReviewSummary(ipoId)` - Aggregates ratings, sentiment, top reasons (cache: 15min)
- `findByIpoId(ipoId, limit)` - Get approved reviews with pagination
- `approveReview(reviewId, adminUser)` - Moderate review to approved state
- `rejectReview(reviewId, adminUser)` - Moderate review to rejected state
- `getPendingReviews()` - Admin: get reviews awaiting moderation

**Repository Pattern:**
- All extend `BaseRepository` (`web/lib/repositories/base-repository.ts`)
- Cache-aside pattern with automatic invalidation
- Type: `NodePgDatabase<typeof schema>` from `@ipodhan/shared/db/schema`
- Performance: <100ms (p95) for queries, <50ms cache hits

**Technology Stack:** Drizzle ORM 0.44.6, ioredis, TypeScript, BaseRepository pattern

## Data Scraper Service (Separate Node.js Process)

**Responsibility:** Automated data collection from NSE/BSE websites and IPO Alerts API.

**Key Interfaces:**
- `scrapeNSE()` - Scrape NSE IPO page
- `scrapeBSE()` - Scrape BSE IPO page
- `fetchIPOAlertsAPI()` - Fallback API
- `updateDatabase()` - Upsert scraped data
- `invalidateCache()` - Clear Redis cache

**Technology Stack:** Node.js, TypeScript, Puppeteer, Node-cron, Axios

## Email Service (Alert System) 🟢 **Phase 2**

**Responsibility:** Send transactional emails for subscription verification and IPO alerts (deferred to Phase 2).

**Key Interfaces:**
- `sendVerificationEmail(email, token)`
- `sendIPOAlert(subscribers, ipo, alertType)`

**Technology Stack:** TBD (Resend/SendGrid/AWS SES), React Email

## Shared Types Package

**Responsibility:** Single source of truth for TypeScript interfaces used across frontend, backend, and scraper.

**Key Interfaces:**
- Data model interfaces (IPO, Subscription, GMPRecord, etc.)
- Enums (IPOStatus, IPOCategory, DocumentType)
- Utility functions (date formatting, currency formatting)

**Technology Stack:** TypeScript, Zod

## Cache Layer (Redis)

**Responsibility:** In-memory caching for frequently accessed data.

**Technology Stack:** Redis 7.2+, ioredis client library

## Database (PostgreSQL)

**Responsibility:** Persistent storage for all IPO data, subscription history, GMP records, financials, documents, and email subscribers.

**Technology Stack:** PostgreSQL 16+, managed via Drizzle ORM migrations

---
