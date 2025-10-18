# Frontend Architecture

## Component Organization

```
web/src/
├── app/                           # Next.js App Router
│   ├── layout.tsx                 # Root layout
│   ├── page.tsx                   # Homepage
│   ├── ipos/[slug]/page.tsx       # IPO detail (SSR)
│   └── api/                       # API Routes
├── components/
│   ├── ui/                        # shadcn/ui components
│   ├── ipo/                       # IPO-specific components
│   ├── layout/                    # Header, footer, navigation
│   └── shared/                    # Loading, errors, tooltips
├── lib/
│   ├── api-client.ts              # Frontend API client
│   ├── repositories/              # Data access layer
│   ├── services/                  # Business logic
│   └── db/                        # Database client + schema
├── contexts/                      # React Context state management
└── hooks/                         # Custom React hooks
```

## State Management Architecture

**Client State (React Context):**
- Filter preferences (status, category, sector, sort)
- Search query
- UI state (mobile menu open/closed)

**Server State (React Server Components):**
- IPO data fetched server-side, passed as props

**URL State:**
- Filter params synced to URL query string for shareable links

## Routing Architecture

**File-based routing with App Router:**
- `/` → Homepage (current IPOs)
- `/ipos` → All IPOs with filters
- `/ipos/[slug]` → IPO detail (SSR)
- `/upcoming` → Upcoming IPOs
- `/closed` → Closed/Listed IPOs
- `/sme` → SME IPOs
- `/mainboard-ipos` → Mainboard IPOs Landing Page (Story 9.15)
- `/search` → Search results
- `/subscribe` → Email subscription

## Frontend Services Layer

**API Client (`lib/api-client.ts`):**
- `getIPOs(params)` - List IPOs with filters
- `getIPOBySlug(slug)` - Get IPO detail
- `getSubscription(slug, latest)` - Get subscription data
- `getGMP(slug, days)` - Get GMP history
- `searchIPOs(query, limit)` - Search by company name
- `subscribeEmail(email, preferences)` - Subscribe to alerts

**Error Handling:**
- Type-safe `APIError` class with status codes
- Automatic error boundary integration
- User-friendly error messages

## Landing Pages Architecture (Story 9.15)

**Mainboard IPOs Landing Page (`/mainboard-ipos`):**
- **Purpose:** Comprehensive hub for all Mainboard IPO information
- **Components:**
  - `MainboardSummaryMetrics` - 6 metric cards (total, gains, losses, upcoming, AOT metrics)
  - `MainboardContentSections` - 6 content sections (current, upcoming, listed, reviews, performance, subscriptions)
  - `MainboardNavigationCards` - 4 navigation cards to dedicated pages
  - `MainboardDetailedTableClient` - Detailed IPO table with filters
- **Service Layer:** `mainboard-landing-service.ts`
  - 9 data fetching functions with Redis caching (5-min TTL)
  - Filters: category=MAINBOARD throughout
  - Functions: metrics, current, upcoming, listed, reviews, performance, subscriptions, detailed list
- **State Management:**
  - URL query params: year, companySearch (shareable, bookmarkable)
  - Server-side data fetching with ISR (5-min revalidation)
  - Client-side UI state for minimize/maximize toggle
- **Caching Strategy:**
  - Redis cache with 5-minute TTL for all data
  - Cache keys: `mainboard:landing:*`
  - ISR with 5-minute revalidation at page level
- **Responsive Design:**
  - Summary metrics: 1 col (mobile) → 2 cols (tablet) → 3 cols (desktop)
  - Content sections: 1 col (mobile) → 2 cols (tablet) → 3 cols (desktop)
  - Navigation cards: 1 col (mobile) → 2 cols (tablet) → 4 cols (desktop)
  - Detailed table: cards (mobile) → full table (desktop)
- **Testing:**
  - Unit tests: Service layer (>90% coverage), Components (>80% coverage)
  - Integration tests: Page rendering with mock data
  - E2E tests: Complete user workflows (navigation, filters, interactions)

---
