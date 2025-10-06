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

---
