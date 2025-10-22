# IPODhan Architecture Diagrams

This directory contains comprehensive architecture diagrams for the IPODhan project, generated using GraphViz.

## Diagrams Overview

### 1. System Architecture (`01-system-architecture.png`)
**Overview:** Complete monorepo structure with all components and external systems

**Key Components:**
- **Monorepo Structure:** TypeScript workspace with project references
- **Shared Package:** Single source of truth for DB schema (13 tables) and utilities
- **Web Application:** Next.js 15.5.4 with App Router, React 19, Tailwind CSS 4
- **Scraper Service:** Separate process with NSE, BSE, Moneycontrol, Chittorgarh scrapers
- **External Systems:** PostgreSQL 16, Redis 7.2+, external data sources
- **Deployment:** Windows Server 2022 VPS with PM2

**Data Flow:**
```
External APIs → Scrapers → PostgreSQL
Browser → Web App → Services → Repositories → Cache/DB
```

---

### 2. Database Schema (`02-database-schema.png`)
**Overview:** All 13 tables with relationships and data types

**Tables:**
1. **ipos** (Core) - IPO entity with historical performance fields
2. **subscriptions** (Time-series) - Subscription tracking over time
3. **gmpRecords** (Time-series) - Grey Market Premium data
4. **financialData** (1:1) - Financial metrics and ratios
5. **listingPerformance** (1:1) - Listing day performance
6. **documents** (1:N) - IPO documents (DRHP, RHP, etc.)
7. **ipoReviews** (1:N) - Analyst reviews and ratings
8. **peerCompanies** (1:N) - Peer comparison data
9. **registrars** (Reference) - Registrar information
10. **marketHolidays** (Reference) - Trading holidays
11. **brokerAffiliates** (Affiliate) - Broker affiliate links
12. **affiliateClicks** (Affiliate) - Click tracking
13. **scraperLogs** (Monitoring) - Scraper execution logs

**Key Relationships:**
- IPOs → Subscriptions (1:N)
- IPOs → GMP Records (1:N)
- IPOs → Financial Data (1:1)
- IPOs → Listing Performance (1:1)
- IPOs → Documents (1:N)

**Important Note:**
- `ipos.segment` field is **nullable** to support RIGHTS/InvITs/REITs offerings
- Single source of truth: `packages/shared/src/db/schema.ts`

---

### 3. Data Flow (`03-data-flow.png`)
**Overview:** Complete data flow from scraping to frontend rendering

**Flow Stages:**

1. **Data Acquisition (Scraper Layer)**
   - NSE API → NSE Scraper (IPO list, subscriptions)
   - BSE Website → BSE Scraper (IPO details)
   - Moneycontrol → MC Scraper (financials, documents)
   - Chittorgarh → Chit Scraper (historical GMP)

2. **Data Validation & Transformation**
   - Schema validation
   - Lot size data quality checks
   - Slug generation (canonical utility)
   - Data normalization

3. **Data Storage**
   - PostgreSQL via Drizzle ORM
   - INSERT/UPDATE operations

4. **Data Retrieval (Cache-Aside Pattern)**
   ```
   Repository → Cache Check → Cache HIT: Return
                           → Cache MISS: Query DB → Set Cache → Return
   ```

5. **Service Layer**
   - Landing Page Service (orchestrates multiple repos)
   - IPO Detail Service (aggregates data)
   - Scoring Service (real-time calculation)

6. **API Layer**
   - GET /api/ipos (paginated list)
   - GET /api/ipos/[slug] (with fuzzy fallback)
   - GET /api/subscriptions (time-series)

7. **Frontend**
   - Server Components (SSR)
   - Client Components (CSR)
   - Core Web Vitals < 2.5s

**Cache TTLs:**
- IPO Detail: 15 minutes
- IPO List: 5 minutes
- Subscriptions: 3 minutes (real-time data)
- Static Data: 24 hours

---

### 4. Repository Pattern (`04-repository-pattern.png`)
**Overview:** BaseRepository with cache-aside pattern implementation

**Architecture:**

**BaseRepository (Abstract)**
- `getFromCache<T>(cacheKey, dbQuery, ttl)` - Cache-first retrieval
- `setCache<T>(cacheKey, data, ttl)` - Cache population
- `deleteCache(key | keys[])` - Cache invalidation
- `deleteCachePattern(pattern)` - Pattern-based deletion
- `executeQuery<T>(queryName, query, context)` - Query logging

**Concrete Repositories (extend BaseRepository):**
- IPORepository
- SubscriptionRepository
- GMPRepository
- FinancialRepository

**Example: IPORepository Methods**
- `findBySlug(slug)` - Cache TTL: 15 minutes
- `findAll(filters)` - Cache TTL: 5 minutes
- `findOpen()` - Cache TTL: 3 minutes
- `update(id, data)` - Invalidates related cache keys

**Cache-Aside Flow:**
1. Check cache (getFromCache)
2a. Cache HIT → Return cached data
2b. Cache MISS → Execute DB query
3. Set cache (setCache with TTL)
4. Return data

**Cache Invalidation (on mutations):**
1. Execute mutation (INSERT/UPDATE/DELETE)
2. Delete specific cache key
3. Delete pattern-based keys (`ipo:*`)

**Performance Targets:**
- Cache Hit Ratio: > 80%
- Cache Hit Time: < 50ms
- DB Query Time: < 100ms
- Total p95: < 500ms

**Type Safety:**
- All repositories use `NodePgDatabase<typeof schema>`
- Schema imported from `@ipodhan/shared/db/schema`

---

### 5. Testing Pyramid (`05-testing-pyramid.png`)
**Overview:** Testing strategy with 70% unit, 20% integration, 10% E2E

**Test Layers:**

**E2E Tests (10%) - Playwright**
- Coverage: Critical user journeys
- Speed: Slowest (30-60s per test)
- Browsers: Chromium, Firefox, Edge
- Tests:
  - Mainboard/SME landing pages
  - IPO detail page full flow
  - IPO comparison tool
  - Subscription tracking (real-time)

**Integration Tests (20%) - Vitest**
- Coverage: Real DB/Redis interactions
- Speed: Medium (5-15s)
- Components:
  - API routes with real database
  - Repositories (PostgreSQL + Redis)
  - Cache layer integration
  - Scraper service validation
  - Service layer orchestration
- Infrastructure:
  - Test PostgreSQL database
  - Test Redis instance
  - Seed data with `mockIPO()` helpers

**Unit Tests (70%) - Vitest**
- Coverage: Isolated component testing
- Speed: Fast (<10s for entire suite)
- Components:
  - React components (mocked props)
  - Utilities (slug generation, validation)
  - Service functions (mocked repos)
  - Cache utilities (mocked Redis)
  - Schema validators
  - Data transformers
- Mocking Strategy:
  - `vi.mock('drizzle')` for database
  - `vi.mock('ioredis')` for Redis
  - `vi.mock('fetch')` for external APIs

**Test Commands:**
```bash
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests (requires DB/Redis)
npm run test:e2e           # E2E tests (all browsers)
npm run test               # All tests
npm run test:coverage      # Generate coverage report
```

**Coverage Targets:**
- Overall: 80%+
- Repositories: 90%+
- Services: 85%+
- Utilities: 95%+
- Components: 75%+

**Performance Targets:**
- Unit Tests: < 10 seconds
- Integration Tests: < 30 seconds
- E2E Suite: < 5 minutes
- Full Test Suite: < 6 minutes

---

## Generating Diagrams

All diagrams are generated from DOT files using GraphViz:

```bash
# Install GraphViz (if not already installed)
# Windows: https://graphviz.org/download/
# Add C:\Program Files\Graphviz\bin to PATH

# Generate single diagram
dot -Tpng 01-system-architecture.dot -o 01-system-architecture.png

# Generate all diagrams
for file in *.dot; do
  dot -Tpng "$file" -o "${file%.dot}.png"
done
```

## File Formats

- **`.dot` files:** Source diagrams in GraphViz DOT language (editable)
- **`.png` files:** Generated diagram images (for documentation)

## Updating Diagrams

1. Edit the `.dot` file with your changes
2. Regenerate the PNG: `dot -Tpng filename.dot -o filename.png`
3. Commit both `.dot` and `.png` files to version control

## Color Coding

Diagrams use consistent color schemes:
- **Blue (#90CAF9, #E3F2FD):** Core entities, database
- **Green (#81C784, #C8E6C9):** Web application, services
- **Orange (#FFB74D, #FFE0B2):** Scrapers, external data
- **Purple (#CE93D8, #F3E5F5):** Cache, Redis
- **Pink (#F48FB1):** Reference data
- **Yellow (#FFF59D, #FFF9C4):** External APIs, integration tests
- **Red (#EF5350, #FFCDD2):** E2E tests, critical paths
- **Gray (#B0BEC5):** Monitoring, logging

---

**Generated on:** 2025-10-22
**GraphViz Version:** 14.0.2
**Total Diagrams:** 5
