# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

**Most Common Commands:**
```bash
# Development
npm run dev                    # Start Next.js dev server (port 3000)
npm run dev:scraper            # Start scraper in dev mode

# Testing
npm run test:unit              # Fast unit tests (<10s)
npm run test:integration       # Integration tests (requires DB + Redis)
npm run test:e2e               # E2E tests with Playwright

# Database
npm run db:migrate             # Apply migrations (from web/)
npm run db:studio              # Open Drizzle Studio GUI (port 4983)
npm run seed                   # Seed database with sample data

# Code Quality
npm run lint                   # Run ESLint
npm run build                  # Build for production
```

**Critical Architecture Rules:**
- ✅ **Schema**: Always edit `packages/shared/src/db/schema.ts` (single source of truth)
- ✅ **Services**: Use repositories directly, NEVER HTTP API calls
- ✅ **Repositories**: Extend `BaseRepository` for automatic caching
- ✅ **Cache Keys**: Use generator functions from `web/lib/cache/cache-keys.ts`
- ✅ **Slugs**: Use `generateIPOSlug()` from `@ipodhan/shared/utils/slug`

**Must-Read Before Coding:**
- `docs/02-architecture/backend-architecture.md` - 3-layer architecture
- `docs/05-caching/CACHING_STRATEGY.md` - Cache patterns
- `docs/16-database/SCHEMA_MANAGEMENT.md` - Schema workflow
- `docs/16-database/screen-table-database-field-mapping.md` - UI to DB mapping

**Emergency Troubleshooting:**
- Build errors: Check imports use `@/lib/db` not `@/lib/db/schema`
- Tests failing: `npm run db:migrate` and verify test DB connection
- Redis down: App auto-falls back to database (check logs)

---

## Quick Start (New Developers)

### First Time Setup
```bash
# 1. Install dependencies (monorepo root)
npm install

# 2. Setup environment (web)
cd web
cp .env.production.template .env.local
# Edit .env.local with your local database credentials

# 3. Run database migrations
npm run db:migrate

# 4. Seed database with sample data
npm run seed

# 5. Start development server
npm run dev
# Visit http://localhost:3000
```

### Common Development Commands

**Web Application (from root):**
```bash
npm run dev                    # Start Next.js dev server (port 3000)
npm run build                  # Build for production
npm run start                  # Start production server
npm run lint                   # Run ESLint
```

**Testing (from web/):**
```bash
npm run test                   # Run all tests (unit + integration)
npm run test:unit              # Unit tests only (fast, <10s)
npm run test:unit:watch        # Unit tests in watch mode
npm run test:integration       # Integration tests (requires DB + Redis)
npm run test:coverage          # Generate coverage report
npm run test:e2e               # E2E tests with Playwright
npm run test:e2e:headed        # E2E with browser UI
npm run test:e2e:debug         # E2E with debugger
npm run test:all               # Lint + Unit + Integration + E2E
```

**Database Management (from web/):**
```bash
npm run db:generate            # Generate migration from schema changes
npm run db:migrate             # Apply pending migrations
npm run db:push                # Push schema directly (dev only)
npm run db:studio              # Open Drizzle Studio GUI (port 4983)
npm run seed                   # Seed database with sample data
npm run seed:force             # Re-seed (truncates existing data)
npm run verify:seed            # Verify seed data integrity
```

**Scraper Service (from root):**
```bash
npm run dev:scraper            # Start scraper in dev mode
npm run scraper:nse            # Run NSE scraper

# From scraper/ directory:
npm run start                  # Run default scraper (NSE)
npm run start:bse              # BSE scraper only
npm run start:moneycontrol     # Moneycontrol scraper only
npm run start:chittorgarh      # Chittorgarh scraper only
npm run start:gmp              # GMP scraper only
npm run start:all              # Run all scrapers sequentially
npm run scheduler              # Start cron scheduler (3 AM daily)
npm run backfill               # Backfill historical IPO data
npm run backfill:dry           # Dry run (no DB writes)
```

**Workspace Commands:**
```bash
# Run command in specific workspace
npm run dev --workspace=web
npm run test --workspace=scraper
npm run build --workspace=packages/shared
```

**PDF Parser (Python, Optional):**
```bash
# For DRHP financial data extraction (experimental)
cd pdf-parser-test
python extraction_v3.py    # Extract financial data from DRHP markdown
python test_extraction.py  # Run validation tests

# See pdf-parser-test/README.md for Python dependencies and setup
```

**Running Single Tests:**
```bash
# From web/ directory
npm run test:unit -- path/to/test.test.ts           # Run specific test file
npm run test:unit:watch -- path/to/test.test.ts     # Watch single test
npm run test:e2e -- --grep "test name"              # Run E2E test by name
```

**Debugging:**
```bash
# Debug Next.js server
NODE_OPTIONS='--inspect' npm run dev

# Debug tests
npm run test:unit:watch    # Use Vitest UI
npm run test:e2e:debug     # Playwright inspector

# Check database state
npm run db:studio          # Visual database browser

# Monitor logs
pm2 logs                   # Production logs (VPS only)
```

### Development Workflow

**Making Schema Changes:**
1. Edit `packages/shared/src/db/schema.ts` (single source of truth)
2. Run `npm run db:generate` from `web/` to create migration
3. Review generated SQL in `web/drizzle/migrations/`
4. Run `npm run db:migrate` to apply
5. Verify in Drizzle Studio: `npm run db:studio`

**Adding New Repository:**
1. Create in `web/lib/repositories/`
2. Extend `BaseRepository` for automatic caching
3. Import schema from `@ipodhan/shared/db/schema`
4. Use `NodePgDatabase<typeof schema>` type
5. Write integration tests in `web/tests/integration/repositories/`

**Adding New API Endpoint:**
1. Create route in `web/app/api/`
2. Use repository directly (never HTTP calls from server)
3. Follow standard response format (see API Route Patterns below)
4. Add integration test in `web/tests/integration/api/`
5. Update API documentation if public-facing

### Key Files & Directories

**Critical Configuration Files:**
- `packages/shared/src/db/schema.ts` - **Single source of truth** for database schema (13 tables)
- `web/lib/cache/cache-keys.ts` - Cache key generators and TTL definitions
- `web/lib/config/search.ts` - Fuzzy search configuration
- `web/eslint.config.mjs` - ESLint rules including architectural enforcement
- `ecosystem.config.js` - PM2 configuration for production deployment

**Core Backend Logic:**
- `web/lib/repositories/` - Data access layer (extends BaseRepository)
- `web/lib/repositories/base-repository.ts` - Cache-aside pattern implementation
- `web/lib/services/` - Business logic layer (orchestrates repositories)
- `web/lib/db/index.ts` - Database connection and schema re-exports
- `web/lib/cache/redis-client.ts` - Redis singleton with fault tolerance

**Monitoring & Logging:**
- `web/lib/logging/logger.ts` - Winston structured logging
- `web/lib/monitoring/sentry-utils.ts` - APM and error tracking
- `web/scripts/db-health-check.ts` - Database monitoring script
- `web/scripts/monitor-redis.ts` - Redis monitoring script

**Scrapers (Data Collection):**
- `scraper/src/scrapers/nse-scraper.ts` - NSE official API (primary source, 95%+ success)
- `scraper/src/scrapers/bse-scraper.ts` - BSE scraper (secondary source)
- `scraper/src/scrapers/moneycontrol-scraper.ts` - Moneycontrol fallback
- `scraper/src/scrapers/chittorgarh-scraper.ts` - GMP data source
- `scraper/src/scheduler/index.ts` - Cron scheduler (runs daily at 3 AM)

**PDF Parser (Experimental):**
- `pdf-parser-test/` - DRHP (Draft Red Herring Prospectus) PDF parser
  - Python-based financial data extraction (94.1% accuracy)
  - See `pdf-parser-test/README.md` for complete documentation

**Testing:**
- `web/tests/unit/` - Unit tests (70% of test pyramid)
- `web/tests/integration/` - Integration tests with real DB/Redis (20%)
- `web/tests/e2e/` - Playwright E2E tests (10%)
- `web/vitest.config.ts` - Vitest configuration for unit tests
- `web/playwright.config.ts` - Playwright configuration

**Documentation (Must Read Before Coding):**
- `docs/02-architecture/backend-architecture.md` - 3-layer architecture
- `docs/05-caching/CACHING_STRATEGY.md` - Cache patterns and TTLs
- `docs/16-database/SCHEMA_MANAGEMENT.md` - Schema change workflow
- `docs/16-database/screen-table-database-field-mapping.md` - UI to DB mapping (1600+ lines)
- `test-results/phase-5/` - Phase 5 reports (monitoring, scoring, load testing)

## Project Overview

IPODhan is a comprehensive IPO (Initial Public Offering) information platform for Indian investors. The platform provides real-time IPO data, subscription tracking, GMP (Grey Market Premium) information, financial analysis, and investor tools.

**Tech Stack:**
- Frontend: Next.js 15.5.4 (App Router), React 19.1.0, TypeScript 5, Tailwind CSS 4
- Database: PostgreSQL 16 with Drizzle ORM 0.44.6
- Cache: Redis 7.2+ with ioredis 5.8.0
- Deployment: Windows Server 2022 VPS
- Testing: Vitest 3.2.4 (unit/integration), Playwright 1.55.1 (E2E)
- Monitoring: Winston 3.18.3 (logging), Sentry 10.17+ (APM), OpenTelemetry 2.1+
- Monorepo: npm workspaces with TypeScript Project References

**⚠️ IMPORTANT - Database Schema Architecture:**
The database schema has been consolidated into a **single source of truth** at `packages/shared/src/db/schema.ts`. All files throughout the codebase successfully import from this unified schema through a re-export chain (`packages/shared/src/db/schema.ts` → `web/lib/db/index.ts` → application code). Never modify schema outside of the shared package.

## Monorepo Structure

This is a **TypeScript workspace monorepo** with project references:

```
IPODhan/
├── packages/shared/          # SINGLE SOURCE OF TRUTH for DB schema + utilities
│   └── src/
│       ├── db/schema.ts      # ⚠️ All database tables, enums, relations
│       ├── utils/            # Shared utilities (slug generation, etc.)
│       ├── docs/             # Shared package documentation
│       └── index.ts
├── web/                      # Next.js application
│   ├── app/                  # App Router pages & API routes
│   ├── lib/                  # Backend logic (repositories, services)
│   │   ├── db/              # Database connection + schema re-exports
│   │   ├── repositories/    # Data access layer with caching
│   │   ├── services/        # Business logic layer
│   │   ├── config/          # Configuration (search, validation, etc.)
│   │   └── cache/           # Redis client & cache utilities
│   ├── components/          # React components
│   ├── docs/                # Web-specific documentation
│   └── scripts/             # Migration & utility scripts
├── scraper/                 # Data scraping service (separate process)
│   ├── src/
│   │   ├── scrapers/        # NSE, BSE, Moneycontrol, Chittorgarh
│   │   ├── scheduler/       # Cron-based scheduler
│   │   └── utils/           # Scraper utilities & validators
│   └── docs/                # Scraper documentation
└── tsconfig.json            # Root with project references
```

## Critical Architecture Patterns

### 1. Database Schema Architecture (IMPORTANT)

**⚠️ Single Source of Truth:**
- All database schema is defined in `packages/shared/src/db/schema.ts`
- This file contains 13 tables, all enums, and Drizzle relations
- **DO NOT modify** `web/lib/db/schema.ts` (it no longer exists - deleted)
- Schema is re-exported through `web/lib/db/index.ts` for compatibility

**Import Pattern:**
```typescript
// ✅ Correct: Import from @/lib/db (re-exports from shared)
import { ipos, ipoStatusEnum } from '@/lib/db';

// ✅ Correct: Direct import from shared (for repositories)
import * as schema from '@ipodhan/shared/db/schema';

// ❌ Wrong: This file doesn't exist anymore
import { ipos } from '@/lib/db/schema';
```

**Database Tables (13 total):**
1. `ipos` - Core IPO entity with historical performance fields
   - **IMPORTANT**: `segment` field is nullable ('MAINBOARD' | 'SME' | null) to support RIGHTS/InvITs/REITs offerings
   - Always use null coalescing in UI display: `{ipo.segment || 'N/A'}`
2. `subscriptions` - Time-series subscription data
3. `gmpRecords` - Time-series GMP tracking
4. `financialData` - One-to-one financial metrics
5. `documents` - One-to-many IPO documents
6. `listingPerformance` - One-to-one listing data
7. `marketHolidays` - Trading holidays calendar
8. `registrars` - Registrar information
9. `peerCompanies` - Peer comparison data (✅ UI implemented 2025-10-20)
10. `brokerAffiliates` - Affiliate links
11. `affiliateClicks` - Click tracking
12. `scraperLogs` - Scraper monitoring
13. `ipoReviews` - IPO reviews from analysts

**⚠️ CRITICAL: Schema Management Workflow**
- See `docs/16-database/SCHEMA_MANAGEMENT.md` for complete workflow documentation
- NEVER manually alter database schema
- ALWAYS go through: Schema → Migration → Database
- Incident: 2025-10-18 - Schema drift caused scraper failure (documented)

### 2. Repository Pattern with Caching

All repositories extend `BaseRepository` which implements the **cache-aside pattern**:

```typescript
// BaseRepository provides:
// - getFromCache<T>(cacheKey, dbQuery, ttl) - Cache-first retrieval
// - setCache<T>(cacheKey, data, ttl) - Cache population
// - deleteCache(key | keys[]) - Cache invalidation
// - deleteCachePattern(pattern) - Pattern-based invalidation
// - executeQuery<T>(queryName, query, context) - Query logging

// Example: IPORepository extends BaseRepository
export class IPORepository extends BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>,
    protected redis: Redis
  ) {
    super(db, redis);
  }

  async findBySlug(slug: string): Promise<IPO | null> {
    const cacheKey = getIPOBySlugKey(slug);
    return this.getFromCache(cacheKey, async () => {
      // Database query here
    }, CacheTTL.IPO_DETAIL); // 15 minutes
  }
}
```

**Repository Type Requirements:**
- All repository constructors MUST use `NodePgDatabase<typeof schema>` where `schema` is imported from `@ipodhan/shared/db/schema`
- This ensures type compatibility with the shared schema

### 3. Service Layer Architecture

Services orchestrate business logic and coordinate multiple repositories:

```typescript
// Pattern: Services compose repositories
export async function getMainboardLandingData() {
  const db = await getDb();
  const redis = getRedisClient();

  const ipoRepository = new IPORepository(db, redis);
  const subscriptionRepository = new SubscriptionRepository(db, redis);

  // Business logic combining multiple data sources
  const upcomingIPOs = await ipoRepository.findUpcoming({ category: 'MAINBOARD' });
  const openIPOs = await ipoRepository.findOpen({ category: 'MAINBOARD' });

  return { upcomingIPOs, openIPOs };
}
```

**⚠️ CRITICAL: Services and Server Components MUST use repositories directly**

Services and Server Components should NEVER make HTTP API calls. This violates the 3-layer architecture and fails in production builds.

```typescript
// ❌ WRONG: HTTP API calls from server-side code
import { apiClient } from '@/lib/api-client';
const data = await apiClient.getIPOs({ segment: 'MAINBOARD' });

// ✅ CORRECT: Direct repository access
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';

const redis = getRedisClient();
const ipoRepository = new IPORepository(db, redis);
const result = await ipoRepository.findAll({
  segment: ['MAINBOARD'],
  status: ['OPEN'],
  limit: 10,
  sortBy: 'openDate',
  sortOrder: 'desc',
  page: 1,
});
```

**ESLint Architectural Enforcement:**

ESLint automatically prevents architectural violations. If you try to import `@/lib/api-client` in services or Server Components, you'll get:

```
❌ ARCHITECTURAL VIOLATION: Services and Server Components must NOT use HTTP API calls.

✅ CORRECT PATTERN (3-layer architecture):
   Server Component/Service → Repository → Database

❌ WRONG PATTERN:
   Server Component/Service → HTTP → API Route → Repository
```

**Incident History:**
- **2025-11-01**: Fixed 9 files violating this pattern (P0 CRITICAL)
- Caused "Network request failed" errors in production builds
- IPO detail page was completely broken (404)
- See: `docs/07-testing/ui-tests/ARCHITECTURAL_FIXES_COMPLETE_NOV_1_2025.md`

### 4. Redis Connection Management

**⚠️ Connection Resilience:**
- Redis client uses singleton pattern with retry strategy
- Max 3 retries with exponential backoff (50ms → 2000ms)
- 5-second connection timeout
- **Application continues functioning if Redis is unavailable** (falls back to database)

```typescript
// Get Redis client (handles connection internally)
const redis = getRedisClient();

// Test connection (for health checks)
const isHealthy = await testRedisConnection();
```

### 5. Cache Key Conventions

Cache keys are defined in `web/lib/cache/cache-keys.ts`:

```typescript
// Pattern: entity:identifier[:variant]
export const getIPOBySlugKey = (slug: string) => `ipo:slug:${slug}`;
export const getIPOListKey = (filters: string) => `ipo:list:${filters}`;
export const getLatestGMPKey = (ipoId: string) => `gmp:latest:${ipoId}`;

// TTLs (in seconds)
export const CacheTTL = {
  IPO_DETAIL: 900,        // 15 minutes
  IPO_LIST: 300,          // 5 minutes
  SUBSCRIPTION: 180,      // 3 minutes
  GMP: 900,               // 15 minutes
  STATIC_DATA: 86400,     // 24 hours
};
```

### 6. Canonical Slug Generation (Phase 3)

All slug generation uses the canonical utility in `packages/shared/src/utils/slug.ts`:

```typescript
import { generateIPOSlug, validateSlug, generateUniqueSlug } from '@ipodhan/shared/utils/slug';

// Generate canonical slug
const slug = generateIPOSlug('XYZ Corporation Ltd');
// Returns: 'xyz-corporation-ltd'

// Validate slug format
const isValid = validateSlug(slug);

// Generate unique slug (checks against existing slugs)
const uniqueSlug = generateUniqueSlug('XYZ Corporation', existingSlugs);
// Returns: 'xyz-corporation-ipo' or 'xyz-corporation-ipo-2' if collision
```

**Key Features:**
- Handles 13+ legal entity types (Ltd, Limited, Pvt, Inc, LLC, etc.)
- Supports 8 currency/special symbols (₹, $, &, etc.)
- Enforces maximum length (100 chars default)
- Guarantees uniqueness with collision detection
- 100% test coverage (81 tests passing)

**IMPORTANT:** All scrapers and frontend components MUST use `generateIPOSlug()` - never create custom slug logic.

### 7. API Fuzzy Matching & Fallback (Phase 3)

When exact slug/ID lookup fails, the repository layer implements intelligent fuzzy matching:

```typescript
// Repository pattern with fuzzy fallback
const ipo = await ipoRepository.findBySlugWithFallback(slug, {
  enableFuzzy: true,
  similarityThreshold: 0.6,  // 60% similarity required
});

// Returns exact match if found, otherwise best fuzzy match, or null

// Search with similarity scores
const results = await ipoRepository.searchByName('XYZ Corp', {
  limit: 5,
  threshold: 0.3,  // 30% minimum similarity
});
// Returns: Array<{ ipo: IPO, score: number }>
```

**Configuration:** Centralized in `web/lib/config/search.ts`

**API 404 Response Pattern:**
```json
{
  "error": "IPO not found",
  "suggestions": [
    {
      "companyName": "XYZ Corporation",
      "slug": "xyz-corporation-ipo",
      "similarity": 87
    }
  ]
}
```

**Performance:** <500ms for fuzzy search, uses fuse.js library (9KB gzipped)

### 8. Monitoring & Observability (Phase 5)

**⚠️ Production Monitoring Stack:**
The platform implements comprehensive monitoring across 6 layers for production observability.

**Structured Logging (Winston):**
```typescript
import { logger, logPerformance, logError } from '@/lib/logging/logger';

// Performance logging
logPerformance('db.findBySlug', duration, { table: 'ipos', slug });

// Error logging with context
logError(error, { endpoint: '/api/ipos', method: 'GET' });
```

**Features:**
- JSON structured logs with daily rotation (14d app, 30d error, 7d performance)
- Three transport types: Console (dev), File (production), Error file (critical)
- Automatic log cleanup and compression
- <5ms overhead per request

**Application Performance Monitoring (OpenTelemetry + Sentry):**
```typescript
import { trackPerformance, captureAPIError } from '@/lib/monitoring/sentry-utils';

// Performance tracking
const result = await trackPerformance(
  'api-ipos-get',
  async () => await repository.findAll(),
  { endpoint: '/api/ipos' }
);

// Error capture with context
captureAPIError(error, {
  endpoint: '/api/ipos',
  method: 'GET',
  statusCode: 500
});
```

**Monitoring Layers:**
1. **Application Metrics** - Request rates, response times, error rates
2. **Database Metrics** - Query performance (>100ms alerts), connection pool, cache hit ratio
3. **Cache Metrics** - Hit rates (>80% target), memory usage, eviction rate
4. **System Metrics** - CPU, memory, disk I/O, network
5. **Business Metrics** - IPO data freshness, scraper success rates, data quality
6. **Alert System** - 6 automated rules (INFO, WARNING, CRITICAL)

**Monitoring Scripts:**
- `scripts/db-health-check.ts` - Database monitoring every 5 minutes
- `scripts/monitor-redis.ts` - Redis health every 2 minutes
- `scripts/monitor-db-performance.sql` - 12 comprehensive SQL queries

**Health Endpoints:**
- `GET /api/health-detailed` - Comprehensive health check (<100ms)
- `GET /api/metrics` - Business metrics dashboard (<500ms)

**Documentation:** See `web/lib/monitoring/README.md` for complete monitoring guide

### 9. Real-time IPO Scoring (Phase 5)

**⚠️ Dynamic Scoring System:**
Replaces static seed values with real-time calculated scores (0-10 scale) based on 5 objective components.

**Scoring Service:**
```typescript
import { IPOScoringService } from '@/lib/services/ipo-scoring-realtime';

const scoringService = new IPOScoringService();
const score = await scoringService.calculateScore(ipoId);
// Returns: { total: 8.5, rating: "Strong (Consider)", confidence: 92, components: {...} }
```

**5-Component Methodology:**
1. **Financial Strength (3 pts)** - Revenue growth, profitability, ROE
2. **Valuation (2 pts)** - P/E vs Industry, Price-to-Book
3. **Subscription Demand (2 pts)** - Overall subscription, QIB subscription
4. **Market Performance (2 pts)** - GMP premium, listing gains
5. **Company Fundamentals (1 pt)** - Issue size, company age

**Rating Scale:**
- 9.0-10.0: Exceptional (Invest) ⭐⭐⭐⭐⭐
- 7.5-8.9: Strong (Consider) ⭐⭐⭐⭐
- 6.0-7.4: Good (Moderate) ⭐⭐⭐
- 4.5-5.9: Average (Neutral) ⭐⭐
- 3.0-4.4: Below Average (Caution) ⭐
- 0.0-2.9: Poor (Avoid)

**Intelligent Caching:**
- TTL varies by IPO status: 1h for OPEN, 24h for LISTED
- Cache hit time: 35ms (performance target: <50ms)
- Score calculation: 150ms (performance target: <200ms)
- Confidence scoring (0-100%) based on data completeness (avg: 88%)

**API Endpoint:**
```typescript
// GET /api/ipos/[slug]/score
// Returns comprehensive score breakdown with component analysis
```

**Bulk Calculation:** Available via utility scripts in `web/scripts/`

**Testing:** 32 tests (20 unit + 12 integration), 93.5% coverage, all passing

**Documentation:** See `test-results/phase-5/real-time-scoring-report.md` for complete methodology

### 10. Load Testing & Performance (Phase 5)

**⚠️ Production Readiness Score: 9.2/10** (with pre-launch fixes)

**Load Testing Scripts:** Available in `web/tests/load/` directory (k6 and Node.js implementations)

**Performance Benchmarks:**
- **100 users:** p95 300ms ✅ Excellent
- **500 users:** p95 480ms ✅ Good
- **1000 users:** p95 650ms 🟡 Degraded
- **Breaking point:** 1200-1500 concurrent users (DB connection pool limit)

**Database Connection Pool:**
- **Old:** 20 connections (~800 users max)
- **New:** 50 connections (~2500 users max)
- **Improvement:** 3.1x user capacity increase

**Core Web Vitals Targets:**
- LCP (Largest Contentful Paint): < 2.5s
- FID (First Input Delay): < 100ms
- CLS (Cumulative Layout Shift): < 0.1
- TTFB (Time to First Byte): < 600ms

**Lighthouse CI:** Configured to test 8 critical pages for performance, accessibility, SEO

**Documentation:** See `test-results/phase-5/production-load-testing-report.md` for complete analysis

## Architecture Documentation

**⚠️ CRITICAL: Before making code changes, consult these architecture documents:**

These documents serve as **single sources of truth** for their respective areas. Always reference them before modifying code to ensure architectural consistency.

### Core Architecture Documents

1. **[Cache Strategy](docs/05-caching/CACHING_STRATEGY.md)** - Redis caching patterns
   - Cache-aside pattern implementation
   - Cache key conventions and TTL strategy
   - Invalidation patterns and graceful degradation
   - Performance targets and monitoring

2. **[Backend Architecture](docs/02-architecture/backend-architecture.md)** - Repository and service patterns
   - 3-layer architecture (API → Service → Repository)
   - BaseRepository pattern with cache-aside
   - Repository type requirements and naming conventions
   - Service layer orchestration patterns
   - Query optimization and performance targets

3. **[Testing Strategy](docs/02-architecture/testing-strategy.md)** - Complete testing pyramid
   - Test organization and naming conventions
   - Unit, integration, and E2E testing patterns
   - Coverage targets (80% overall, 90% repositories)
   - Test fixture patterns and database seeding
   - Performance targets per test type

4. **[Security & Performance](docs/02-architecture/security-and-performance.md)** - Measurable targets
   - API response time targets (p95 < 500ms, p99 < 1000ms)
   - Core Web Vitals targets (LCP < 2.5s, FID < 100ms)
   - Database query performance by type
   - Security requirements (infrastructure, application, API)
   - Monitoring & observability strategy

### Database Documentation

5. **[Schema Management](docs/16-database/SCHEMA_MANAGEMENT.md)** - Database schema workflow
   - Single source of truth: `packages/shared/src/db/schema.ts`
   - Migration workflow (Schema → Migration → Database)
   - Schema drift prevention and incident log

6. **[UI-Database Mapping](docs/16-database/screen-table-database-field-mapping.md)** - Comprehensive field mapping
   - 32 screens mapped to database tables
   - Scrape source priority and data flow
   - Gap analysis and unmapped features

### Scraper Documentation

7. **[Scraper Architecture](scraper/README.md)** - Scraper implementation
   - NSE, BSE, Moneycontrol, Chittorgarh scrapers
   - Retry logic and rate limiting
   - Failure tracking and fallback strategies

8. **[Scraping Strategy](scraper/docs/SCRAPING_STRATEGY.md)** - NSE API discovery
   - Hidden NSE API endpoints (95%+ success rate)
   - Multi-source scraping strategy
   - Error handling and monitoring

9. **[Lot Size Data Quality](scraper/docs/LOT_SIZE_EXECUTIVE_SUMMARY.md)** - Critical data quality fix (Phase 3)
   - Root cause: 68.89% of IPOs had lot_size = 1
   - Scraper fixes and validation utilities
   - Database migration and fix strategy
   - See also: LOT_SIZE_FIX.md (1,600+ lines technical analysis)

### Phase 3 Enhancements (2025-10-21)

10. **[Slug Generation](packages/shared/docs/SLUG_GENERATION.md)** - Canonical slug utilities
    - Single source of truth for slug generation
    - 5 core functions with 81 tests (100% passing)
    - Prevents slug inconsistency issues
    - Migration script: `web/scripts/regenerate-slugs.ts`

11. **[Fuzzy Matching](web/docs/FUZZY_MATCHING.md)** - Intelligent search & fallback
    - API fallback strategy when exact match fails
    - fuse.js integration with similarity scoring
    - Configuration and performance tuning
    - <500ms response time target

12. **[IPO Compare Validation](web/docs/IPO_COMPARE_VALIDATION.md)** - Dropdown validation
    - Client-side slug validation with HEAD requests
    - Prevents 404 errors in IPO comparison tool
    - Graceful degradation and caching strategy
    - ~500ms validation time for 10-20 IPOs

### Phase 5 Enhancements (2025-10-21)

13. **[Enhanced Monitoring](web/lib/monitoring/README.md)** - Production observability system
    - Winston structured logging (JSON, daily rotation)
    - OpenTelemetry APM + Sentry performance tracking
    - 6 monitoring layers (app, DB, cache, system, business, alerts)
    - Quick Start: `web/lib/monitoring/QUICK_START.md`

14. **[Real-time IPO Scoring](test-results/phase-5/real-time-scoring-report.md)** - Dynamic quality scores
    - 5-component methodology (0-10 scale)
    - 32 tests, 93.5% coverage, all passing
    - Intelligent caching (1h OPEN, 24h LISTED)
    - Performance: 150ms calculation, 35ms cache hit

15. **[Production Load Testing](test-results/phase-5/production-load-testing-report.md)** - Performance analysis
    - k6 load test scripts (API, stress, user journey)
    - Lighthouse CI for Core Web Vitals
    - Breaking point analysis (1200-1500 users)
    - Production readiness: 9.2/10

16. **[Integration Testing](test-results/phase-5/integration-testing-report.md)** - Comprehensive testing
    - 71 integration tests (100% pass rate)
    - Redis fault tolerance validated
    - Cache invalidation verified
    - Connection pool stress tested (200+ concurrent)

17. **[Data Backfill Scripts](test-results/phase-5/data-backfill-report.md)** - Data completeness tools
    - Listing performance backfill (37% → 80%+)
    - Financial ratios calculator
    - GMP historical data collector
    - Subscription scraper analysis

18. **[Missing Endpoints Implementation](test-results/phase-5/missing-endpoints-implementation.md)** - API completeness
    - 12 new endpoints (9 new + 3 verified)
    - 100% API completeness achieved
    - 45 integration tests, 100% pass rate

### Other Architecture

19. **[API Specification](docs/02-architecture/api-specification.md)** - REST API patterns
20. **[Deployment Architecture](docs/02-architecture/deployment-architecture.md)** - VPS deployment
21. **[VPS Configuration](docs/vps-server-configuration.md)** - Server setup

### Architecture Decision Records (ADRs)

**⚠️ NOTE:** This project does not currently use formal Architecture Decision Records (ADRs).

However, major architectural decisions are documented in the following locations:

**Key Architectural Decisions Documented:**
1. **Database Schema Consolidation** (2025-10-18)
   - Location: `docs/16-database/SCHEMA_MANAGEMENT.md` (Incident Log section)
   - Decision: Consolidate all schema to `packages/shared/src/db/schema.ts`
   - Rationale: Prevent schema drift and ensure single source of truth

2. **3-Layer Architecture Enforcement** (2025-11-01)
   - Location: `docs/07-testing/ui-tests/ARCHITECTURAL_FIXES_COMPLETE_NOV_1_2025.md`
   - Decision: Enforce repository pattern via ESLint rules
   - Rationale: Prevent HTTP calls in services/server components (caused production bugs)

3. **Cache-Aside Pattern** (Phase 2)
   - Location: `docs/05-caching/CACHING_STRATEGY.md`
   - Decision: Implement caching at repository level using BaseRepository
   - Rationale: Consistent caching behavior with graceful degradation

4. **Canonical Slug Generation** (Phase 3)
   - Location: `packages/shared/docs/SLUG_GENERATION.md`
   - Decision: Centralize slug generation in shared package
   - Rationale: Prevent slug inconsistencies across scrapers and UI

5. **Real-time IPO Scoring** (Phase 5)
   - Location: `test-results/phase-5/real-time-scoring-report.md`
   - Decision: Replace static scores with dynamic 5-component calculation
   - Rationale: Provide objective, data-driven IPO quality assessment

6. **Database Connection Pool Sizing** (Phase 5)
   - Location: `test-results/phase-5/production-load-testing-report.md`
   - Decision: Increase pool from 20 to 50 connections
   - Rationale: Support 1000+ concurrent users (load testing showed bottleneck)

**Future ADRs:**
If the project adopts formal ADRs, they should be stored in `docs/adr/` using the format:
- `NNNN-title.md` (e.g., `0001-use-drizzle-orm.md`)
- Template: [MADR](https://adr.github.io/madr/)

### Architectural Rules Enforcement

**✅ IMPLEMENTED: ESLint rules** in `web/eslint.config.mjs`:

**1. No HTTP API Calls in Services/Server Components** (ENFORCED)
- Prevents import of `@/lib/api-client` in `lib/services/**` and `app/**` (except `app/api/**`)
- Ensures 3-layer architecture: Component/Service → Repository → Database
- Helpful error message with correct pattern example
- **Incident**: 2025-11-01 - Caught 2 additional violations after initial fixes

**TODO: Additional rules to implement**:
- Never hardcode cache keys (use generator functions)
- Never skip cache invalidation after mutations
- Always extend BaseRepository for new repositories

---

## Testing Architecture

### Test Pyramid

- **Unit Tests (70%)**: Fast, isolated tests in `tests/unit/`
  - Components, utilities, services (mocked dependencies)
  - Run in < 10 seconds

- **Integration Tests (20%)**: Real database/Redis in `tests/integration/`
  - API routes, repositories with actual PostgreSQL + Redis
  - Requires test database running

- **E2E Tests (10%)**: Full user flows in `tests/e2e/`
  - Critical journeys across browsers (Chromium, Firefox, Edge)
  - Mobile viewports tested

### Running Integration Tests

Integration tests require PostgreSQL and Redis. Scripts available in `package.json`.

### Test Data Patterns

```typescript
// Use mockIPO helper for test fixtures (includes historical fields)
import { mockIPO, DEFAULT_HISTORICAL_FIELDS } from '@/lib/db/types';

const testIPO = mockIPO({
  id: 'test-id',
  companyName: 'Test Company',
  slug: 'test-company-ipo',
  category: 'MAINBOARD',
  status: 'OPEN',
  // Historical fields are automatically set to null via DEFAULT_HISTORICAL_FIELDS
});
```

## Migration Workflow

### Creating a Migration

1. **Modify schema** in `packages/shared/src/db/schema.ts`
2. **Generate migration** using Drizzle Kit
3. **Review generated SQL** in `web/drizzle/migrations/`
4. **Apply migration** using Drizzle Kit
5. **Verify** using Drizzle Studio and seed verification scripts

### Migration Best Practices

- Always review generated SQL before applying
- Test migrations on local database first
- Use descriptive migration names
- Include both up and down operations
- Document breaking changes in migration comments

## API Route Patterns

### Standard Response Format

```typescript
// Success
return NextResponse.json({
  success: true,
  data: results,
  meta: {
    page: 1,
    limit: 20,
    total: 100,
    hasNext: true
  }
}, { status: 200 });

// Error
return NextResponse.json({
  error: 'Error message',
  details: 'Additional context'
}, { status: 400 });
```

### Typical API Route Structure

```typescript
// app/api/resource/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ResourceRepository } from '@/lib/repositories/resource-repository';

export async function GET(request: NextRequest) {
  try {
    const redis = getRedisClient();
    const repository = new ResourceRepository(db, redis);

    const results = await repository.findAll();

    return NextResponse.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

## Environment Variables

Required environment variables (`.env.local` for web, `.env` for scraper):

```bash
# Database (Web)
DATABASE_URL=postgresql://user:password@host:5432/ipodhan
# OR use individual parameters:
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=ipodhan
DATABASE_USER=postgres
DATABASE_PASSWORD=your_password

# Redis (Web)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=optional

# Application (Web)
NODE_ENV=development
NEXT_PUBLIC_APP_NAME=IPODhan
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Analytics (Production)
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX

# Scraper (separate .env file in scraper/)
DATABASE_URL=same_as_web
REDIS_URL=same_as_web
SCRAPER_INTERVAL=daily
```

## Deployment

See `docs/02-architecture/deployment-architecture.md` for complete deployment workflow including:
- Production build creation
- VPS transfer and setup
- PM2 process management
- Health monitoring
- Rollback procedures

## Common Troubleshooting

### Build Errors

**"Module not found: Can't resolve './schema'"**
- Schema has been consolidated to `packages/shared/src/db/schema.ts`
- Update imports to use `@/lib/db` (not `@/lib/db/schema`)

**"Type 'NodePgDatabase<typeof schema>' is not assignable"**
- Repository constructors must import schema from `@ipodhan/shared/db/schema`
- Update type annotation: `NodePgDatabase<typeof schema>` where schema is from shared

**Zod version conflicts**
- Zod is pinned to `^4.1.11` via npm overrides (see root `package.json`)
- This ensures compatibility across all workspace packages
- Do not upgrade Zod without testing all workspace packages first

### Database Connection Issues

- Test connection via `/api/db-test` endpoint
- Check environment variables in `.env.local`
- Test PostgreSQL directly using psql

### Redis Connection Issues

- Application falls back to database if Redis is unavailable
- Check logs for "[Redis] Connection error" messages
- Test Redis using redis-cli

### Test Failures

- Clear test database and reset schema
- Reinstall Playwright browsers if E2E tests fail
- Run tests with verbose logging for detailed error information

## UI-Database Field Mapping

**⚠️ CRITICAL REFERENCE: `docs/16-database/screen-table-database-field-mapping.md`**

This comprehensive document (1600+ lines) maps every UI screen to database tables and scrape sources. It's essential for:

**What's in the document:**
- **32 screens mapped** (26 data-driven + 6 static)
- **9 core database tables** with 100+ fields
- **Scrape source priority** (NSE → BSE → Moneycontrol → Chittorgarh → API Fallback)
- **Gap analysis** showing ~120 database fields not yet displayed in UI
- **Critical unmapped features**: IPO scoring system (`ipo_scores` table), peer comparison data, enhanced financial metrics

**Key findings:**
1. **Major feature gaps**: Complete AI-powered IPO scoring system exists in database but hidden from UI
2. **Duplicate tables**: 3 GMP tables, 2 subscription tables, 2 financial tables need reconciliation
3. **Field usage**: `company_name` used in 16 screens, `open_date`/`close_date` in 12 screens each
4. **Automation coverage**: 65% fully automated scraping, 20% calculated, 15% manual entry

**When to consult this document:**
- Adding new UI screens or features
- Modifying database schema
- Understanding data flow from scrapers to UI
- Implementing scraper for new data sources
- Troubleshooting missing data in UI

**Priority recommendations from gap analysis:**
1. Implement IPO scoring UI (complete `ipo_scores` table unmapped)
2. Add peer comparison section (`peer_companies` table unmapped)
3. Display stock symbols and ISIN (standard identifiers missing)
4. Consolidate duplicate tables for data consistency

## Code Organization Principles

1. **Separation of Concerns**:
   - Repositories = Data access
   - Services = Business logic
   - API Routes = HTTP handling
   - Components = UI rendering

2. **Type Safety**:
   - All database types inferred from Drizzle schema
   - Use `InferSelectModel` and `InferInsertModel` from Drizzle

3. **Caching Strategy**:
   - Cache at repository level (not service level)
   - Invalidate on mutations
   - TTLs based on data volatility

4. **Error Handling**:
   - Custom error classes in `lib/errors/repository-errors.ts`
   - Graceful degradation (app works without Redis)
   - Structured logging with context

5. **Testing Strategy**:
   - Test pyramid: 70% unit, 20% integration, 10% E2E
   - Mock external dependencies in unit tests
   - Use real database in integration tests
   - Test critical user journeys in E2E

## Performance Targets

- **API Response Times**: p95 < 500ms, p99 < 1000ms
- **Page Load**: LCP < 2.5s
- **Database Queries**: p95 < 100ms
- **Cache Hit Rate**: > 80% for IPO detail/list endpoints
- **Concurrent Users**: Support 1000 concurrent users