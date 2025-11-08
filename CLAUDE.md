# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Table of Contents

- [Quick Reference](#quick-reference)
- [Project Overview](#project-overview)
- [Monorepo Structure](#monorepo-structure)
- [Critical Architecture Patterns](#critical-architecture-patterns)
  - [1. Database Schema Architecture](#1-database-schema-architecture-important)
  - [2. Repository Pattern with Caching](#2-repository-pattern-with-caching)
  - [3. Service Layer Architecture](#3-service-layer-architecture)
  - [4. Redis Connection Management](#4-redis-connection-management)
  - [5. Cache Key Conventions](#5-cache-key-conventions)
  - [6. Canonical Slug Generation](#6-canonical-slug-generation-phase-3)
  - [7. API Fuzzy Matching & Fallback](#7-api-fuzzy-matching--fallback-phase-3)
  - [8. Monitoring & Observability](#8-monitoring--observability-phase-5)
  - [9. Real-time IPO Scoring](#9-real-time-ipo-scoring-phase-5)
  - [10. Load Testing & Performance](#10-load-testing--performance-phase-5)
- [Architecture Documentation](#architecture-documentation)
- [Development Workflows](#development-workflows)
- [Testing Architecture](#testing-architecture)
- [API Route Patterns](#api-route-patterns)
- [Common Troubleshooting](#common-troubleshooting)
- [Performance Targets](#performance-targets)

---

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
- ✅ **Schema**: Always edit `packages/shared/src/db/schema.ts` (single source of truth) → [See Schema Architecture](#1-database-schema-architecture-important)
- ✅ **Services**: Use repositories directly, NEVER HTTP API calls → [See Service Layer](#3-service-layer-architecture)
- ✅ **Repositories**: Extend `BaseRepository` for automatic caching → [See Repository Pattern](#2-repository-pattern-with-caching)
- ✅ **Cache Keys**: Use generator functions from `web/lib/cache/cache-keys.ts` → [See Cache Conventions](#5-cache-key-conventions)
- ✅ **Slugs**: Use `generateIPOSlug()` from `@ipodhan/shared/utils/slug` → [See Slug Generation](#6-canonical-slug-generation-phase-3)

**Must-Read Before Coding:**
- `docs/02-architecture/backend-architecture.md` - 3-layer architecture
- `docs/05-caching/CACHING_STRATEGY.md` - Cache patterns
- `docs/16-database/SCHEMA_MANAGEMENT.md` - Schema workflow
- `docs/16-database/screen-table-database-field-mapping.md` - UI to DB mapping

**Emergency Troubleshooting:**
- Build errors: Check imports use `@/lib/db` not `@/lib/db/schema` → [See Troubleshooting](#common-troubleshooting)
- Tests failing: `npm run db:migrate` and verify test DB connection
- Redis down: App auto-falls back to database (check logs) → [See Redis Management](#4-redis-connection-management)

---

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
The database schema has been consolidated into a **single source of truth** at `packages/shared/src/db/schema.ts`. All files throughout the codebase successfully import from this unified schema through a re-export chain (`packages/shared/src/db/schema.ts` → `web/lib/db/index.ts` → application code). Never modify schema outside of the shared package. → [See full details](#1-database-schema-architecture-important)

---

## Monorepo Structure

This is a **TypeScript workspace monorepo** with project references:

```
IPODhan/
├── packages/shared/          # SINGLE SOURCE OF TRUTH for DB schema + utilities
│   └── src/
│       ├── db/schema.ts      # ⚠️ All database tables, enums, relations
│       ├── utils/            # Shared utilities (slug generation, etc.)
│       └── docs/             # Shared package documentation
├── web/                      # Next.js application
│   ├── app/                  # App Router pages & API routes
│   ├── lib/                  # Backend logic (repositories, services)
│   │   ├── db/              # Database connection + schema re-exports
│   │   ├── repositories/    # Data access layer with caching
│   │   ├── services/        # Business logic layer
│   │   ├── config/          # Configuration (search, validation, etc.)
│   │   └── cache/           # Redis client & cache utilities
│   ├── components/          # React components
│   └── scripts/             # Migration & utility scripts
├── scraper/                 # Data scraping service (separate process)
│   ├── src/
│   │   ├── scrapers/        # NSE, BSE, Moneycontrol, Chittorgarh
│   │   ├── scheduler/       # Cron-based scheduler
│   │   └── utils/           # Scraper utilities & validators
│   └── docs/                # Scraper documentation
└── tsconfig.json            # Root with project references
```

**Key Directories:**
- `packages/shared/src/db/schema.ts` - **Single source of truth** for database schema (13 tables)
- `web/lib/cache/cache-keys.ts` - Cache key generators and TTL definitions
- `web/lib/repositories/base-repository.ts` - Cache-aside pattern implementation
- `web/lib/logging/logger.ts` - Winston structured logging
- `web/lib/monitoring/` - APM and error tracking

---

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
1. `ipos` - Core IPO entity (segment nullable: 'MAINBOARD' | 'SME' | null for RIGHTS/InvITs/REITs)
2. `subscriptions` - Time-series subscription data
3. `gmpRecords` - Time-series GMP tracking
4. `financialData` - One-to-one financial metrics
5. `documents` - One-to-many IPO documents
6. `listingPerformance` - One-to-one listing data
7. `marketHolidays` - Trading holidays calendar
8. `registrars` - Registrar information
9. `peerCompanies` - Peer comparison data
10. `brokerAffiliates` - Affiliate links
11. `affiliateClicks` - Click tracking
12. `scraperLogs` - Scraper monitoring
13. `ipoReviews` - IPO reviews from analysts

**⚠️ CRITICAL: Schema Management Workflow**
- See `docs/16-database/SCHEMA_MANAGEMENT.md` for complete workflow documentation
- NEVER manually alter database schema
- ALWAYS go through: Schema → Migration → Database
- Incident: 2025-10-18 - Schema drift caused scraper failure (documented)

**Cross-references:** [Migration Workflow](#development-workflows) | [Troubleshooting](#common-troubleshooting)

---

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

**Cross-references:** [Cache Strategy](docs/05-caching/CACHING_STRATEGY.md) | [Service Layer](#3-service-layer-architecture) | [Cache Keys](#5-cache-key-conventions)

---

### 3. Service Layer Architecture

Services orchestrate business logic and coordinate multiple repositories. **CRITICAL: Services and Server Components MUST use repositories directly, never HTTP API calls.**

**✅ CORRECT Pattern:**
```typescript
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';

export async function getMainboardLandingData() {
  const redis = getRedisClient();
  const ipoRepository = new IPORepository(db, redis);

  // Direct repository access
  const result = await ipoRepository.findAll({
    segment: ['MAINBOARD'],
    status: ['OPEN'],
  });

  return result;
}
```

**❌ WRONG Pattern:**
```typescript
// NEVER do this in services or Server Components
import { apiClient } from '@/lib/api-client';
const data = await apiClient.getIPOs({ segment: 'MAINBOARD' });
```

**ESLint Architectural Enforcement:**
ESLint automatically prevents architectural violations. If you try to import `@/lib/api-client` in services or Server Components, you'll get an error with helpful correction guidance.

**Incident History:**
- **2025-11-01**: Fixed 9 files violating this pattern (P0 CRITICAL) - Caused "Network request failed" errors in production builds
- See: `docs/07-testing/ui-tests/ARCHITECTURAL_FIXES_COMPLETE_NOV_1_2025.md`

**Cross-references:** [Repository Pattern](#2-repository-pattern-with-caching) | [Backend Architecture](docs/02-architecture/backend-architecture.md)

---

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

**Cross-references:** [Cache Strategy](docs/05-caching/CACHING_STRATEGY.md) | [Troubleshooting](#common-troubleshooting)

---

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

**Cross-references:** [Repository Pattern](#2-repository-pattern-with-caching) | [Cache Strategy](docs/05-caching/CACHING_STRATEGY.md)

---

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

**Cross-references:** [Slug Generation Docs](packages/shared/docs/SLUG_GENERATION.md) | [Fuzzy Matching](#7-api-fuzzy-matching--fallback-phase-3)

---

### 7. API Fuzzy Matching & Fallback (Phase 3)

When exact slug/ID lookup fails, the repository layer implements intelligent fuzzy matching:

```typescript
// Repository pattern with fuzzy fallback
const ipo = await ipoRepository.findBySlugWithFallback(slug, {
  enableFuzzy: true,
  similarityThreshold: 0.6,  // 60% similarity required
});

// Search with similarity scores
const results = await ipoRepository.searchByName('XYZ Corp', {
  limit: 5,
  threshold: 0.3,  // 30% minimum similarity
});
// Returns: Array<{ ipo: IPO, score: number }>
```

**Performance:** <500ms for fuzzy search, uses fuse.js library (9KB gzipped)

**Cross-references:** [Fuzzy Matching Docs](web/docs/FUZZY_MATCHING.md) | [Search Config](web/lib/config/search.ts)

---

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
```

**Monitoring Layers:**
1. Application Metrics - Request rates, response times, error rates
2. Database Metrics - Query performance (>100ms alerts), connection pool, cache hit ratio
3. Cache Metrics - Hit rates (>80% target), memory usage, eviction rate
4. System Metrics - CPU, memory, disk I/O, network
5. Business Metrics - IPO data freshness, scraper success rates, data quality
6. Alert System - 6 automated rules (INFO, WARNING, CRITICAL)

**Health Endpoints:**
- `GET /api/health-detailed` - Comprehensive health check (<100ms)
- `GET /api/metrics` - Business metrics dashboard (<500ms)

**Cross-references:** [Monitoring README](web/lib/monitoring/README.md) | [Quick Start](web/lib/monitoring/QUICK_START.md)

---

### 9. Real-time IPO Scoring (Phase 5)

**⚠️ Dynamic Scoring System:**
Replaces static seed values with real-time calculated scores (0-10 scale) based on 5 objective components.

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
- Cache hit time: 35ms, calculation: 150ms
- Confidence scoring (0-100%) based on data completeness (avg: 88%)

**Cross-references:** [Scoring Report](test-results/phase-5/real-time-scoring-report.md)

---

### 10. Load Testing & Performance (Phase 5)

**⚠️ Production Readiness Score: 9.2/10** (with pre-launch fixes)

**Performance Benchmarks:**
- **100 users:** p95 300ms ✅ Excellent
- **500 users:** p95 480ms ✅ Good
- **1000 users:** p95 650ms 🟡 Degraded
- **Breaking point:** 1200-1500 concurrent users (DB connection pool limit)

**Database Connection Pool:**
- **Current:** 50 connections (~2500 users max)
- **Improvement:** 3.1x capacity increase from original 20 connections

**Core Web Vitals Targets:**
- LCP (Largest Contentful Paint): < 2.5s
- FID (First Input Delay): < 100ms
- CLS (Cumulative Layout Shift): < 0.1
- TTFB (Time to First Byte): < 600ms

**Cross-references:** [Load Testing Report](test-results/phase-5/production-load-testing-report.md) | [Performance Targets](#performance-targets)

---

## Architecture Documentation

**⚠️ CRITICAL: Before making code changes, consult these architecture documents:**

These documents serve as **single sources of truth** for their respective areas.

### Core Architecture Documents

1. **[Cache Strategy](docs/05-caching/CACHING_STRATEGY.md)** - Redis caching patterns, cache-aside implementation, invalidation patterns
2. **[Backend Architecture](docs/02-architecture/backend-architecture.md)** - 3-layer architecture, repository/service patterns, query optimization
3. **[Testing Strategy](docs/02-architecture/testing-strategy.md)** - Test pyramid, coverage targets (80% overall, 90% repositories)
4. **[Security & Performance](docs/02-architecture/security-and-performance.md)** - Performance targets, security requirements, monitoring strategy

### Database Documentation

5. **[Schema Management](docs/16-database/SCHEMA_MANAGEMENT.md)** - Schema workflow, migration process, incident log
6. **[UI-Database Mapping](docs/16-database/screen-table-database-field-mapping.md)** - Comprehensive field mapping (1600+ lines), 32 screens, scrape source priority

### Scraper Documentation

7. **[Scraper Architecture](scraper/README.md)** - NSE, BSE, Moneycontrol, Chittorgarh scrapers, retry logic
8. **[Scraping Strategy](scraper/docs/SCRAPING_STRATEGY.md)** - Hidden NSE API endpoints (95%+ success rate), multi-source strategy
9. **[Lot Size Data Quality](scraper/docs/LOT_SIZE_EXECUTIVE_SUMMARY.md)** - Critical data quality fix, root cause analysis

### Phase 3 Enhancements (2025-10-21)

10. **[Slug Generation](packages/shared/docs/SLUG_GENERATION.md)** - 5 core functions, 81 tests (100% passing)
11. **[Fuzzy Matching](web/docs/FUZZY_MATCHING.md)** - API fallback strategy, fuse.js integration, <500ms target
12. **[IPO Compare Validation](web/docs/IPO_COMPARE_VALIDATION.md)** - Client-side slug validation, graceful degradation

### Phase 5 Enhancements (2025-10-21)

13. **[Enhanced Monitoring](web/lib/monitoring/README.md)** - Winston structured logging, OpenTelemetry APM, 6 monitoring layers
14. **[Real-time IPO Scoring](test-results/phase-5/real-time-scoring-report.md)** - 5-component methodology, 93.5% coverage
15. **[Production Load Testing](test-results/phase-5/production-load-testing-report.md)** - k6 scripts, breaking point analysis
16. **[Integration Testing](test-results/phase-5/integration-testing-report.md)** - 71 integration tests (100% pass rate)
17. **[Data Backfill Scripts](test-results/phase-5/data-backfill-report.md)** - Listing performance backfill (37% → 80%+)
18. **[Missing Endpoints Implementation](test-results/phase-5/missing-endpoints-implementation.md)** - 12 new endpoints, 100% API completeness

### Other Architecture

19. **[API Specification](docs/02-architecture/api-specification.md)** - REST API patterns
20. **[Deployment Architecture](docs/02-architecture/deployment-architecture.md)** - VPS deployment workflow
21. **[VPS Configuration](docs/vps-server-configuration.md)** - Server setup

### Key Architectural Decisions

Major architectural decisions are documented in the following locations:

1. **Database Schema Consolidation** (2025-10-18) - See `docs/16-database/SCHEMA_MANAGEMENT.md` (Incident Log)
2. **3-Layer Architecture Enforcement** (2025-11-01) - See `docs/07-testing/ui-tests/ARCHITECTURAL_FIXES_COMPLETE_NOV_1_2025.md`
3. **Cache-Aside Pattern** (Phase 2) - See `docs/05-caching/CACHING_STRATEGY.md`
4. **Canonical Slug Generation** (Phase 3) - See `packages/shared/docs/SLUG_GENERATION.md`
5. **Real-time IPO Scoring** (Phase 5) - See `test-results/phase-5/real-time-scoring-report.md`
6. **Database Connection Pool Sizing** (Phase 5) - See `test-results/phase-5/production-load-testing-report.md`

---

## Development Workflows

### Making Schema Changes

1. Edit `packages/shared/src/db/schema.ts` (single source of truth)
2. Run `npm run db:generate` from `web/` to create migration
3. Review generated SQL in `web/drizzle/migrations/`
4. Run `npm run db:migrate` to apply
5. Verify in Drizzle Studio: `npm run db:studio`

**Cross-references:** [Schema Management](docs/16-database/SCHEMA_MANAGEMENT.md) | [Database Architecture](#1-database-schema-architecture-important)

### Adding New Repository

1. Create in `web/lib/repositories/`
2. Extend `BaseRepository` for automatic caching
3. Import schema from `@ipodhan/shared/db/schema`
4. Use `NodePgDatabase<typeof schema>` type
5. Write integration tests in `web/tests/integration/repositories/`

**Cross-references:** [Repository Pattern](#2-repository-pattern-with-caching) | [Testing](#testing-architecture)

### Adding New API Endpoint

1. Create route in `web/app/api/`
2. Use repository directly (never HTTP calls from server)
3. Follow standard response format (see [API Route Patterns](#api-route-patterns))
4. Add integration test in `web/tests/integration/api/`
5. Update API documentation if public-facing

**Cross-references:** [Service Layer](#3-service-layer-architecture) | [API Patterns](#api-route-patterns)

---

## Testing Architecture

### Test Pyramid

- **Unit Tests (70%)**: Fast, isolated tests in `tests/unit/` - Components, utilities, services (mocked dependencies) - Run in < 10 seconds
- **Integration Tests (20%)**: Real database/Redis in `tests/integration/` - API routes, repositories with actual PostgreSQL + Redis
- **E2E Tests (10%)**: Full user flows in `tests/e2e/` - Critical journeys across browsers

**Test Data Patterns:**
```typescript
import { mockIPO, DEFAULT_HISTORICAL_FIELDS } from '@/lib/db/types';

const testIPO = mockIPO({
  id: 'test-id',
  companyName: 'Test Company',
  slug: 'test-company-ipo',
  category: 'MAINBOARD',
  status: 'OPEN',
});
```

**Cross-references:** [Testing Strategy](docs/02-architecture/testing-strategy.md) | [Integration Testing Report](test-results/phase-5/integration-testing-report.md)

---

## API Route Patterns

### Standard Response Format

```typescript
// Success
return NextResponse.json({
  success: true,
  data: results,
  meta: { page: 1, limit: 20, total: 100, hasNext: true }
}, { status: 200 });

// Error
return NextResponse.json({
  error: 'Error message',
  details: 'Additional context'
}, { status: 400 });
```

### Typical API Route Structure

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ResourceRepository } from '@/lib/repositories/resource-repository';

export async function GET(request: NextRequest) {
  try {
    const redis = getRedisClient();
    const repository = new ResourceRepository(db, redis);
    const results = await repository.findAll();

    return NextResponse.json({ success: true, data: results });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Cross-references:** [API Specification](docs/02-architecture/api-specification.md) | [Service Layer](#3-service-layer-architecture)

---

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
- Do not upgrade Zod without testing all workspace packages first

### Database Connection Issues

- Test connection via `/api/db-test` endpoint
- Check environment variables in `.env.local`
- Test PostgreSQL directly using psql

### Redis Connection Issues

- Application falls back to database if Redis is unavailable
- Check logs for "[Redis] Connection error" messages
- Test Redis using redis-cli

**Cross-references:** [Redis Management](#4-redis-connection-management) | [Monitoring](#8-monitoring--observability-phase-5)

### Test Failures

- Clear test database and reset schema
- Reinstall Playwright browsers if E2E tests fail: `npx playwright install`
- Run tests with verbose logging for detailed error information

**Cross-references:** [Testing Architecture](#testing-architecture) | [Testing Strategy](docs/02-architecture/testing-strategy.md)

---

## Performance Targets

- **API Response Times**: p95 < 500ms, p99 < 1000ms
- **Page Load**: LCP < 2.5s
- **Database Queries**: p95 < 100ms
- **Cache Hit Rate**: > 80% for IPO detail/list endpoints
- **Concurrent Users**: Support 1000 concurrent users

**Cross-references:** [Load Testing](#10-load-testing--performance-phase-5) | [Security & Performance](docs/02-architecture/security-and-performance.md)

---

## Environment Variables

Required environment variables (`.env.local` for web, `.env` for scraper):

```bash
# Database (Web)
DATABASE_URL=postgresql://user:password@host:5432/ipodhan

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

---

## Code Organization Principles

1. **Separation of Concerns**: Repositories = Data access, Services = Business logic, API Routes = HTTP handling, Components = UI rendering
2. **Type Safety**: All database types inferred from Drizzle schema using `InferSelectModel` and `InferInsertModel`
3. **Caching Strategy**: Cache at repository level (not service level), invalidate on mutations, TTLs based on data volatility
4. **Error Handling**: Custom error classes in `lib/errors/repository-errors.ts`, graceful degradation, structured logging
5. **Testing Strategy**: Test pyramid: 70% unit, 20% integration, 10% E2E

**Cross-references:** [Backend Architecture](docs/02-architecture/backend-architecture.md) | [Testing Strategy](docs/02-architecture/testing-strategy.md)
