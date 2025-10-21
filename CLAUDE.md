# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IPODhan is a comprehensive IPO (Initial Public Offering) information platform for Indian investors. The platform provides real-time IPO data, subscription tracking, GMP (Grey Market Premium) information, financial analysis, and investor tools.

**Tech Stack:**
- Frontend: Next.js 15.5.4 (App Router), React 19, TypeScript, Tailwind CSS 4
- Database: PostgreSQL 16 with Drizzle ORM 0.44.6
- Cache: Redis 7.2+ with ioredis
- Deployment: Windows Server 2022 VPS
- Testing: Vitest (unit/integration), Playwright (E2E)
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

### Other Architecture

13. **[API Specification](docs/02-architecture/api-specification.md)** - REST API patterns
14. **[Deployment Architecture](docs/02-architecture/deployment-architecture.md)** - VPS deployment
15. **[VPS Configuration](docs/vps-server-configuration.md)** - Server setup

### Architectural Rules Enforcement

**TODO: ESLint rules** to be added in `.eslintrc.js`:
- Never hardcode cache keys (use generator functions)
- Never skip cache invalidation after mutations
- Always extend BaseRepository for new repositories
- Never access database directly in API routes

---

## Common Development Commands

### Web Application (Next.js)

```bash
cd web

# Development
npm run dev                    # Start dev server with Turbopack

# Building
npm run build                  # Production build (use --turbopack flag)
npm start                      # Start production server

# Database Operations
npm run db:generate            # Generate migration from schema changes
npm run db:migrate             # Apply migrations to database
npm run db:push                # Push schema directly (dev only)
npm run db:studio              # Open Drizzle Studio GUI

# Seeding
npm run seed:database          # Seed with test data (idempotent)
npm run seed:force             # Force re-seed (truncates first)
npm run verify:seed            # Verify seed data integrity

# Testing
npm run test                   # Run all tests (unit + integration)
npm run test:unit              # Unit tests only
npm run test:unit:watch        # Watch mode
npm run test:integration       # Integration tests (needs PostgreSQL + Redis)
npm run test:e2e               # E2E tests (Playwright)
npm run test:coverage          # Generate coverage report

# Specific test file
npm run test:unit -- path/to/file.test.ts

# Specific test name pattern
npm run test:unit -- -t "IPORepository"

# E2E by browser
npm run test:e2e:chromium
npm run test:e2e:firefox
npm run test:e2e:edge
```

### Scraper Service

```bash
cd scraper

# Run scrapers
npm start                      # Default: NSE scraper
npm run start:bse              # BSE scraper
npm run start:moneycontrol     # Moneycontrol scraper
npm run start:chittorgarh      # Chittorgarh historical data
npm run start:all              # All scrapers sequentially

# Scheduler (production)
npm run scheduler              # Start cron scheduler
npm run scheduler:dev          # Watch mode
npm run scheduler:test         # Test mode with shorter intervals
```

### TypeScript Compilation

```bash
# Build shared package declarations (required before web build)
npx tsc --build packages/shared

# Check types without emitting
npx tsc --noEmit
```

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

Integration tests require PostgreSQL and Redis:

```bash
# Option 1: Use VPS database (configured in .env.local)
npm run test:integration

# Option 2: Local with Docker
docker-compose -f docker-compose.test.yml up -d
npm run test:integration
docker-compose -f docker-compose.test.yml down
```

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
2. **Generate migration**:
   ```bash
   cd web
   npm run db:generate
   ```
3. **Review generated SQL** in `web/drizzle/migrations/`
4. **Apply migration**:
   ```bash
   npm run db:migrate
   ```
5. **Verify**:
   ```bash
   npm run db:studio  # Visual inspection
   npm run verify:seed # Test data integrity
   ```

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

### Production Build & Deployment

```bash
# Create deployment package
./scripts/create-deployment-package.ps1  # Windows
./scripts/create-deployment-package.sh   # Linux/Mac

# Transfer to VPS and extract

# Install dependencies (production only)
cd web && npm ci --production

# Start with PM2 (process manager)
pm2 start ecosystem.config.js
pm2 save
pm2 status
```

### PM2 Process Management

```bash
# Monitor logs
pm2 logs
pm2 logs ipodhan-web
pm2 logs ipodhan-scraper

# Restart services
pm2 restart all
pm2 restart ipodhan-web

# Health check
curl http://localhost:3000/api/health
```

## Common Troubleshooting

### Build Errors

**"Module not found: Can't resolve './schema'"**
- Schema has been consolidated to `packages/shared/src/db/schema.ts`
- Update imports to use `@/lib/db` (not `@/lib/db/schema`)

**"Type 'NodePgDatabase<typeof schema>' is not assignable"**
- Repository constructors must import schema from `@ipodhan/shared/db/schema`
- Update type annotation: `NodePgDatabase<typeof schema>` where schema is from shared

### Database Connection Issues

```bash
# Test connection
curl http://localhost:3000/api/db-test

# Check environment variables
echo $DATABASE_URL

# Test PostgreSQL directly
psql -h localhost -U postgres -d ipodhan
```

### Redis Connection Issues

```bash
# Test Redis
redis-cli ping

# Application falls back to database if Redis is unavailable
# Check logs for "[Redis] Connection error" messages
```

### Test Failures

```bash
# Clear test database
psql -h localhost -U postgres -d ipodhan_test -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# Reinstall Playwright browsers
npx playwright install --with-deps

# Run tests with verbose logging
DEBUG=* npm run test:integration
```

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
