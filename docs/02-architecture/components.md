# Components

The system is composed of the following major logical components across the fullstack application.

## Frontend Application (Next.js App)

**Responsibility:** User-facing web application providing IPO browsing, search, detailed views, and email subscription management.

**Key Interfaces:**
- Server Components: Render IPO listings, detail pages with Tier 1 data (SSR)
- Client Components: Interactive UI (filters, tabs, tooltips, modals)
- API Client Service: Fetch data from Next.js API routes
- State Management: React Context for filters, search state, UI state 🔵 **MVP**

**Technology Stack:** Next.js 14 App Router, React Server Components, TypeScript, Tailwind CSS, React Context

## API Routes (Next.js Backend)

**Responsibility:** RESTful API layer handling IPO data queries, search, subscription data, GMP history, and email subscription endpoints.

**Key Interfaces:**
- `GET /api/ipos` - List IPOs with filters
- `GET /api/ipos/[slug]` - IPO detail
- `GET /api/ipos/[slug]/subscription` - Subscription data
- `POST /api/subscribers` - Email subscription

**Technology Stack:** Next.js API Routes, TypeScript, Drizzle ORM, Redis client, Zod validation

## Repository Layer (Data Access)

**Responsibility:** Abstract database queries and caching logic behind clean interfaces.

**Key Interfaces:**
- `IPORepository.findAll(filters)` - Query IPOs with filters/pagination
- `IPORepository.findBySlug(slug)` - Get IPO by slug with relations
- `SubscriptionRepository.findByIPO(ipoId)` - Get subscription history
- `GMPRepository.findByIPO(ipoId, days)` - Get GMP history

**Technology Stack:** Drizzle ORM, Redis, TypeScript interfaces

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
