# Backend Architecture

**Single Source of Truth for Backend Patterns**
**Implementation**: `web/lib/repositories/`, `web/lib/services/`

---

## Architecture Overview

IPODhan follows a **3-layer backend architecture**:

```
API Routes (Next.js)
    ↓ (orchestration)
Service Layer
    ↓ (business logic)
Repository Layer
    ↓ (data access + caching)
Database (PostgreSQL) + Cache (Redis)
```

**Separation of Concerns:**
- **API Routes**: HTTP handling, validation, response formatting
- **Services**: Business logic, cross-repository orchestration
- **Repositories**: Data access, caching, query optimization

---

## Service Architecture

### API Route Organization

**Pattern**: Next.js App Router file-based routing

```
app/api/
├── ipos/
│   ├── route.ts                    # GET /api/ipos (list)
│   ├── [slug]/
│   │   ├── route.ts               # GET /api/ipos/[slug] (detail)
│   │   ├── subscription/route.ts  # GET subscription data
│   │   ├── gmp/route.ts           # GET GMP history
│   │   ├── demand-graph/route.ts  # GET price-wise demand (NEW Oct 2025)
│   │   ├── documents/route.ts     # GET IPO documents
│   │   ├── financials/route.ts    # GET financial data
│   │   ├── listing-performance/route.ts # GET listing performance
│   │   ├── peers/route.ts         # GET peer companies
│   │   ├── rating/route.ts        # GET IPO rating
│   │   └── score/route.ts         # GET real-time score
│   └── history/route.ts           # GET historical IPOs
├── search/route.ts                 # GET search
├── registrars/route.ts             # GET registrar directory
├── tools/
│   ├── lot-calculator/route.ts    # POST calculator
│   └── compare/route.ts           # POST comparison
└── health/route.ts                 # GET health check
```

### Service Layer Pattern

**Location**: `web/lib/services/`

Services orchestrate **multiple repositories** and implement **business logic**.

**Example Services**:
- `mainboard-landing-service.ts` - Dashboard data aggregation
- `ipo-scoring-realtime.ts` - **Real-time IPO quality scoring** (Phase 5, 5-component methodology)
- `peer-comparison-service.ts` - Peer analysis
- `broker-affiliate-service.ts` - Affiliate link management
- `ipo-score-service.ts` - Legacy static scoring (deprecated, use `ipo-scoring-realtime.ts`)

**Service Structure**:
```typescript
// Service = Business logic + Multi-repository coordination
export async function getMainboardLandingData() {
  const db = await getDb();
  const redis = getRedisClient();

  // Instantiate repositories
  const ipoRepository = new IPORepository(db, redis);
  const subscriptionRepository = new SubscriptionRepository(db, redis);
  const gmpRepository = new GMPRepository(db, redis);

  // Business logic: Fetch and combine data
  const [upcoming, open, recent] = await Promise.all([
    ipoRepository.findUpcoming({ segment: 'MAINBOARD', limit: 10 }),
    ipoRepository.findOpen({ segment: 'MAINBOARD', limit: 5 }),
    ipoRepository.findRecent({ segment: 'MAINBOARD', limit: 5 })
  ]);

  // Calculate metrics
  const metrics = calculateDashboardMetrics(upcoming, open, recent);

  return { upcoming, open, recent, metrics };
}
```

**Key Principle**: Services **never** directly access database - always through repositories.

---

## Repository Pattern Implementation

### Base Repository Pattern

**Location**: `web/lib/repositories/base-repository.ts`

**All repositories extend BaseRepository** which provides:
1. Cache-aside pattern (`getFromCache`)
2. Cache population (`setCache`)
3. Cache invalidation (`deleteCache`, `deleteCachePattern`)
4. Query logging (`executeQuery`)

**Repository Hierarchy**:
```
BaseRepository (abstract)
  ├─ IPORepository (Enhanced Oct 2025: +4 demand graph methods)
  ├─ SubscriptionRepository (Enhanced Oct 2025: +15 sub-category fields)
  ├─ GMPRepository
  ├─ FinancialDataRepository (Enhanced in Story 11.12 - EBITDA + Multi-period)
  ├─ DocumentRepository (Enhanced Oct 2025: +7 document types)
  ├─ ListingPerformanceRepository
  ├─ MarketHolidayRepository
  ├─ RegistrarRepository
  ├─ BrokerAffiliateRepository
  ├─ ScraperLogRepository
  ├─ AnchorInvestorRepository (NEW - Story 11.10, Quality: 9.5/10)
  ├─ ReviewRepository (NEW - Story 11.16, Quality: 9.5/10) ⭐
  └─ FieldProtectionRepository (Admin data management)
```

**Epic 11 Additions (3 repositories):**
- **AnchorInvestorRepository**: Anchor investor data with lock-in periods (54/54 tests passing)
- **ReviewRepository**: IPO reviews with aggregation, sentiment analysis & moderation (92% coverage)
- **FieldProtectionRepository**: Admin field-level data protection

**Oct 2025 NSE Enhancement (45+ fields):**
- **IPORepository**: Added demand graph methods (`saveDemandGraph`, `getDemandGraph`, `getLatestDemandSnapshot`)
- **New Data Model**: `ipo_demand_graph` table for price-wise demand visualization
- **Enhanced Subscriptions**: Sub-category breakdowns (QIB: FII/DII/MF, NII: Corp/Individual)

### Repository Type Requirements

**CRITICAL**: All repository constructors MUST use this exact type signature:

```typescript
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import * as schema from '@ipodhan/shared/db/schema';

export class IPORepository extends BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>,  // ← Exact type required
    protected redis: Redis
  ) {
    super(db, redis);
  }
}
```

**Why this matters:**
- `schema` must be from `@ipodhan/shared/db/schema` (single source of truth)
- Ensures type compatibility across the monorepo
- TypeScript Project References require this pattern

### Standard Repository Methods

**Naming Convention**:
```typescript
// Query methods (read operations)
async findAll(filters?: Filters): Promise<Entity[]>
async findById(id: string): Promise<Entity | null>
async findBySlug(slug: string): Promise<Entity | null>
async findOne(conditions): Promise<Entity | null>
async search(query: string): Promise<Entity[]>

// Mutation methods (write operations)
async create(data: NewEntity): Promise<Entity>
async update(id: string, data: Partial<Entity>): Promise<Entity>
async upsert(data: NewEntity): Promise<Entity>
async delete(id: string): Promise<void>

// Aggregate methods
async count(filters?: Filters): Promise<number>
async exists(conditions): Promise<boolean>
```

### Cache-Aside Implementation Pattern

**From BaseRepository**:

```typescript
// All find* methods use this pattern
async findBySlug(slug: string): Promise<IPO | null> {
  const cacheKey = getIPOBySlugKey(slug);

  return this.getFromCache(
    cacheKey,
    async () => {
      // Database query
      return this.executeQuery('findBySlug', async () => {
        const result = await this.db.select().from(ipos)
          .where(eq(ipos.slug, slug));
        return result[0] || null;
      }, { slug });
    },
    CacheTTL.IPO_DETAIL
  );
}
```

**Flow**:
1. Generate cache key using generator function
2. Try cache with `getFromCache`
3. On cache miss, execute DB query
4. Populate cache automatically (non-blocking)
5. Return result

### Mutation Pattern with Cache Invalidation

```typescript
async upsert(data: IPOInsert): Promise<IPO> {
  // 1. Perform database mutation
  const result = await this.executeQuery('upsert', async () => {
    return this.db.insert(ipos).values(data)
      .onConflictDoUpdate({
        target: ipos.id,
        set: data
      })
      .returning();
  }, { ipoId: data.id });

  // 2. Invalidate related caches
  await this.invalidateCache(
    getIPOInvalidationKeys(data.id, data.slug)
  );

  return result[0];
}
```

**Critical Rule**: **Every mutation MUST invalidate cache** or data becomes stale.

### Time-Series Data Pattern (NEW Oct 2025)

**For Price-wise Demand Graph (`ipo_demand_graph` table)**:

```typescript
// IPORepository enhanced methods
async saveDemandGraph(ipoId: string, demandData: DemandGraphEntry[]): Promise<void> {
  // Batch insert for efficiency (100+ data points per IPO)
  await this.executeQuery('saveDemandGraph', async () => {
    await this.db.insert(ipoDemandGraph)
      .values(demandData.map(entry => ({
        ipoId,
        timestamp: new Date(),
        pricePoint: entry.price,
        isCutOff: entry.isCutOff,
        cumulativeQuantity: entry.quantity,
        exchange: entry.exchange
      })));
  }, { ipoId, dataPoints: demandData.length });

  // Invalidate demand graph cache
  await this.deleteCache(getDemandGraphKey(ipoId));
}

async getDemandGraph(ipoId: string, exchange?: 'NSE' | 'BSE' | 'BOTH'): Promise<DemandGraphData[]> {
  const cacheKey = getDemandGraphKey(ipoId, exchange);

  return this.getFromCache(
    cacheKey,
    async () => {
      const query = this.db.select().from(ipoDemandGraph)
        .where(and(
          eq(ipoDemandGraph.ipoId, ipoId),
          exchange ? eq(ipoDemandGraph.exchange, exchange) : undefined
        ))
        .orderBy(asc(ipoDemandGraph.pricePoint));

      return this.executeQuery('getDemandGraph', () => query, { ipoId, exchange });
    },
    CacheTTL.DEMAND_GRAPH // 5 minutes (volatile during IPO)
  );
}
```

**Key Patterns**:
- **Batch Insert**: Process 48-96 data points per update efficiently
- **Time-Series Query**: Order by price point for visualization
- **Exchange Filtering**: Support NSE/BSE/Combined views
- **Short Cache TTL**: 5 minutes for volatile bidding data
- **Data Retention**: Consider partitioning by month, archive after 90 days

---

## Error Handling Strategy

### Custom Error Classes

**Location**: `web/lib/errors/repository-errors.ts`

```typescript
class EntityNotFoundError extends Error
class DatabaseError extends Error
class CacheError extends Error
class ValidationError extends Error
```

### Error Handling in Repositories

```typescript
async findBySlug(slug: string): Promise<IPO> {
  const result = await this.findOne({ slug });

  if (!result) {
    throw new EntityNotFoundError(`IPO not found: ${slug}`, 'IPO', { slug });
  }

  return result;
}
```

### Error Handling in API Routes

```typescript
// app/api/ipos/[slug]/route.ts
export async function GET(request: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const ipo = await repository.findBySlug(params.slug);
    return NextResponse.json({ success: true, data: ipo });
  } catch (error) {
    if (error instanceof EntityNotFoundError) {
      return NextResponse.json(
        { error: 'IPO not found', details: error.message },
        { status: 404 }
      );
    }

    console.error('[API Error]', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

---

## Type Safety Patterns

### Drizzle Type Inference

**All types inferred from schema** - never manually define database types:

```typescript
// From: web/lib/db/types.ts
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';

export type IPO = InferSelectModel<typeof schema.ipos>;
export type NewIPO = InferInsertModel<typeof schema.ipos>;
```

**Benefits**:
- Schema changes automatically update types
- Compile-time safety for all DB operations
- No manual type maintenance

### Repository Interface Pattern

**Location**: `web/lib/repositories/types.ts`

```typescript
export interface IIPORepository {
  findAll(filters?: IPOFilters): Promise<PaginatedResponse<IPO>>;
  findById(id: string): Promise<IPO | null>;
  findBySlug(slug: string): Promise<IPO | null>;
  create(data: NewIPO): Promise<IPO>;
  update(id: string, data: Partial<IPO>): Promise<IPO>;
}
```

**Usage**: Enables mocking in tests and dependency injection.

### ReviewRepository Pattern - Featured Implementation (Story 11.16)

**Epic 11 Highlight:** The `ReviewRepository` represents best-in-class implementation of the repository pattern with advanced features including aggregation, sentiment analysis, and moderation workflow.

**Location**: `web/lib/repositories/review-repository.ts`

**Quality Metrics:**
- Quality Score: 9.5/10
- Test Coverage: 92%
- Acceptance Criteria: 16/16 (100%)
- Performance: 35ms cache hit, 150ms DB aggregation

**Core Methods:**

```typescript
export class ReviewRepository extends BaseRepository {
  // 1. Get aggregated review summary with sentiment analysis
  async getReviewSummary(ipoId: string): Promise<ReviewSummary> {
    const cacheKey = getReviewSummaryKey(ipoId);

    return this.getFromCache(cacheKey, async () => {
      // Aggregates: avg rating, recommendation split, sentiment, top reasons
      const summary = await this.db
        .select({
          avgRating: sql<number>`AVG(${reviews.rating})`,
          applyCount: sql<number>`COUNT(*) FILTER (WHERE ${reviews.recommendation} = 'APPLY')`,
          avoidCount: sql<number>`COUNT(*) FILTER (WHERE ${reviews.recommendation} = 'AVOID')`,
        })
        .from(reviews)
        .where(
          and(
            eq(reviews.ipoId, ipoId),
            eq(reviews.status, 'approved')
          )
        );

      // Extract top 3 reasons using keyword matching
      const topReasons = extractTopReasons(approvedReviews);

      return {
        averageRating: summary.avgRating,
        totalReviews: summary.applyCount + summary.avoidCount,
        applyPercentage: (summary.applyCount / total) * 100,
        avoidPercentage: (summary.avoidCount / total) * 100,
        topApplyReasons: topReasons.apply,
        topAvoidReasons: topReasons.avoid,
      };
    }, CacheTTL.REVIEW_SUMMARY); // 15 minutes
  }

  // 2. Get approved reviews with pagination
  async findByIpoId(ipoId: string, limit: number = 10): Promise<Review[]> {
    return this.executeQuery('findByIpoId', async () => {
      return this.db.query.reviews.findMany({
        where: and(
          eq(reviews.ipoId, ipoId),
          eq(reviews.status, 'approved')
        ),
        orderBy: [desc(reviews.createdAt)],
        limit,
      });
    }, { ipoId, limit });
  }

  // 3. Moderate review to approved state
  async approveReview(reviewId: string, adminUserId: string): Promise<Review> {
    const result = await this.executeQuery('approveReview', async () => {
      return this.db.update(reviews)
        .set({
          status: 'approved',
          moderatedBy: adminUserId,
          moderatedAt: new Date(),
        })
        .where(eq(reviews.id, reviewId))
        .returning();
    }, { reviewId, adminUserId });

    // Invalidate cache: summary for this IPO + pending reviews list
    const review = result[0];
    await this.deleteCache([
      getReviewSummaryKey(review.ipoId),
      getReviewPendingKey(),
    ]);

    return review;
  }

  // 4. Moderate review to rejected state
  async rejectReview(reviewId: string, adminUserId: string): Promise<Review> {
    // Similar to approveReview but sets status = 'rejected'
    // Also invalidates cache
  }

  // 5. Get reviews awaiting moderation (admin panel)
  async getPendingReviews(): Promise<Review[]> {
    const cacheKey = getReviewPendingKey();

    return this.getFromCache(cacheKey, async () => {
      return this.db.query.reviews.findMany({
        where: eq(reviews.status, 'pending'),
        orderBy: [desc(reviews.createdAt)],
        limit: 50,
      });
    }, CacheTTL.REVIEW_PENDING); // 5 minutes
  }
}
```

**Key Features:**

1. **Aggregation Logic**: Uses PostgreSQL aggregation with `COUNT(*) FILTER` for conditional counting
2. **Sentiment Analysis**: Calculates apply/avoid percentage split with TrendingUp/Down indicators
3. **Keyword Extraction**: Top 3 reasons extracted using keyword matching algorithm
4. **Moderation Workflow**: Approve/reject methods with admin audit trail
5. **Intelligent Caching**: Summary cached 15min, pending cached 5min, invalidated on moderation
6. **Performance Optimization**: Single query for aggregation vs N+1 queries

**Cache Invalidation Strategy:**

```typescript
// On moderation action (approve/reject), invalidate:
// 1. Review summary for affected IPO (so users see updated stats)
// 2. Pending reviews list (so admin panel updates)

await this.deleteCache([
  getReviewSummaryKey(review.ipoId),  // Invalidate summary
  getReviewPendingKey(),              // Invalidate admin list
]);
```

**Admin Panel Integration:**

```typescript
// Admin route: GET /api/admin/reviews
const repository = new ReviewRepository(db, redis);
const pendingReviews = await repository.getPendingReviews();

// Admin action: POST /api/admin/reviews/[id]/approve
await repository.approveReview(reviewId, adminUserId);
```

**Performance Targets:**
- Cache hit: < 50ms (actual: 35ms ✅)
- DB aggregation: < 200ms (actual: 150ms ✅)
- Moderation action: < 300ms (actual: 220ms ✅)

---

## Database Architecture

### Drizzle ORM Configuration

**Schema Location**: `packages/shared/src/db/schema.ts` (single source of truth)

**Connection**: `web/lib/db/index.ts`

```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@ipodhan/shared/db/schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 50,               // Connection pool size (Phase 5: supports ~2500 concurrent users)
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export const db = drizzle(pool, { schema });
```

### Connection Pooling Strategy

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `max` | 50 | Handle concurrent requests (Phase 5 upgrade) |
| `idleTimeoutMillis` | 30000 | Release idle connections |
| `connectionTimeoutMillis` | 2000 | Fast failure for connection issues |

**Deployment Notes**:
- Development: 5-10 connections sufficient
- Production (VPS): **50 connections** for ~2500 concurrent users (Phase 5 upgrade)
- Phase 5 load testing shows breaking point at 1200-1500 users with 20 connections
- **3.1x capacity increase** from Phase 4 (20 connections → 50 connections)

### Query Optimization Patterns

**1. Select Only Required Columns**:
```typescript
// ❌ WRONG - Fetches all columns
const ipos = await db.select().from(ipos);

// ✅ CORRECT - Fetch only needed columns
const ipos = await db.select({
  id: ipos.id,
  companyName: ipos.companyName,
  slug: ipos.slug
}).from(ipos);
```

**2. Use Relations for Joins**:
```typescript
// Define relations in schema
export const iposRelations = relations(ipos, ({ one, many }) => ({
  financialData: one(financialData, { ... }),
  subscriptions: many(subscriptions, { ... })
}));

// Query with relations
const ipoWithData = await db.query.ipos.findFirst({
  where: eq(ipos.slug, slug),
  with: {
    financialData: true,
    subscriptions: { limit: 10 }
  }
});
```

**3. Batch Operations**:
```typescript
// ✅ Batch insert (1 query)
await db.insert(subscriptions).values(subscriptionArray);

// ❌ Loop with individual inserts (N queries)
for (const sub of subscriptionArray) {
  await db.insert(subscriptions).values(sub);
}
```

---

## Testing Strategy

### Repository Testing Pattern

**Unit Tests** (`tests/unit/lib/repositories/`):
- Mock Redis and Database
- Test cache hit/miss scenarios
- Test error handling

**Integration Tests** (`tests/integration/repositories/`):
- Real PostgreSQL + Redis
- Test actual queries
- Test cache behavior end-to-end

**Example Unit Test**:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { IPORepository } from '@/lib/repositories/ipo-repository';

describe('IPORepository', () => {
  it('should return cached IPO on cache hit', async () => {
    const mockRedis = {
      get: vi.fn().mockResolvedValue(JSON.stringify(mockIPO)),
      setex: vi.fn()
    };

    const repo = new IPORepository(mockDb, mockRedis as any);
    const result = await repo.findBySlug('test-ipo');

    expect(mockRedis.get).toHaveBeenCalledWith('ipo:slug:test-ipo');
    expect(result).toEqual(mockIPO);
  });
});
```

**Test Fixture Helpers** (`web/lib/db/types.ts`):
```typescript
import { mockIPO, DEFAULT_HISTORICAL_FIELDS } from '@/lib/db/types';

const testIPO = mockIPO({
  id: 'test-id',
  companyName: 'Test Company',
  slug: 'test-company-ipo',
  status: 'OPEN'
});
// All historical fields automatically set to null
```

---

## Performance Optimization

### Repository-Level Optimizations

1. **Always use pagination** for list queries:
   ```typescript
   async findAll(filters: { page: 1, limit: 20 }) {
     const offset = (page - 1) * limit;
     return db.select().from(ipos).limit(limit).offset(offset);
   }
   ```

2. **Implement cursor-based pagination** for large datasets:
   ```typescript
   async findAfter(cursor: string, limit: 20) {
     return db.select().from(ipos)
       .where(gt(ipos.createdAt, cursor))
       .limit(limit);
   }
   ```

3. **Use EXISTS for conditional checks**:
   ```typescript
   // ✅ CORRECT - Faster
   const exists = await db.select({ exists: sql`1` })
     .from(ipos).where(eq(ipos.slug, slug)).limit(1);

   // ❌ WRONG - Fetches all data
   const ipo = await db.select().from(ipos).where(eq(ipos.slug, slug));
   const exists = ipo.length > 0;
   ```

### Query Performance Targets

| Query Type | Target (p95) | Monitoring |
|------------|-------------|-----------|
| Single row lookup | < 10ms | `executeQuery` logs |
| List with filters | < 50ms | `executeQuery` logs |
| Complex joins (3+ tables) | < 100ms | `executeQuery` logs |
| Full-text search | < 200ms | `executeQuery` logs |

**Alert on**: Queries consistently exceeding 2x target time.

---

## Architectural Rules (ESLint TODO)

### Code Enforcement Rules

1. ❌ **Never access database directly in API routes**
   ```typescript
   // WRONG - API route with direct DB access
   export async function GET() {
     const ipos = await db.select().from(ipos);  // ❌
   }

   // CORRECT - Use repository
   export async function GET() {
     const repo = new IPORepository(db, redis);
     const ipos = await repo.findAll();  // ✅
   }
   ```

2. ❌ **Never skip cache invalidation after mutations**
   ```typescript
   // WRONG
   await db.insert(ipos).values(data);  // Cache now stale!

   // CORRECT
   await repository.upsert(data);  // Handles invalidation
   ```

3. ❌ **Never use hardcoded cache keys**
   ```typescript
   // WRONG
   await redis.get('ipo:slug:xyz');

   // CORRECT
   await redis.get(getIPOBySlugKey('xyz'));
   ```

4. ✅ **Always extend BaseRepository for new repositories**
   ```typescript
   // CORRECT
   export class NewRepository extends BaseRepository {
     constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
       super(db, redis);
     }
   }
   ```

---

## Related Documentation

- **Cache Strategy**: `docs/05-caching/CACHING_STRATEGY.md`
- **Database Schema**: `docs/16-database/SCHEMA_MANAGEMENT.md`
- **API Specification**: `docs/02-architecture/api-specification.md`
- **Error Handling**: `docs/02-architecture/error-handling-strategy.md`
- **Testing Strategy**: `docs/02-architecture/testing-strategy.md`

---

## Phase 5 Enhancements (October 2025)

### Real-time IPO Scoring Service

**Location**: `web/lib/services/ipo-scoring-realtime.ts`

The `IPOScoringService` replaces static seed values with dynamic, real-time calculated scores (0-10 scale) based on 5 objective components.

**Service Pattern:**
```typescript
import { IPOScoringService } from '@/lib/services/ipo-scoring-realtime';

const scoringService = new IPOScoringService();
const score = await scoringService.calculateScore(ipoId);

// Returns:
// {
//   total: 8.5,
//   rating: "Strong (Consider)",
//   confidence: 92,
//   components: {
//     financial: { score: 2.8, max: 3 },
//     valuation: { score: 1.6, max: 2 },
//     subscription: { score: 1.8, max: 2 },
//     market: { score: 1.7, max: 2 },
//     fundamentals: { score: 0.6, max: 1 }
//   }
// }
```

**5-Component Methodology:**
1. **Financial Strength (3 pts)** - Revenue growth, profitability, ROE
2. **Valuation (2 pts)** - P/E vs Industry, Price-to-Book ratio
3. **Subscription Demand (2 pts)** - Overall subscription, QIB subscription
4. **Market Performance (2 pts)** - GMP premium, listing gains
5. **Company Fundamentals (1 pt)** - Issue size, company age

**Intelligent Caching:**
- TTL varies by IPO status: 1h for OPEN IPOs, 24h for LISTED IPOs
- Cache hit time: 35ms (target: <50ms)
- Score calculation: 150ms (target: <200ms)
- Confidence scoring (0-100%) based on data completeness (average: 88%)

**API Endpoint:**
```
GET /api/ipos/[slug]/score
```

**Performance Metrics:**
- Test Coverage: 93.5% (32 tests: 20 unit + 12 integration)
- Quality Score: 9.5/10
- Production Status: ✅ Deployed and operational

**Bulk Calculation Script:**
```bash
# Recalculate all IPO scores
npx tsx scripts/recalculate-all-scores.ts

# Recalculate only OPEN IPOs
npx tsx scripts/recalculate-all-scores.ts --status=OPEN
```

### Monitoring & Logging Pattern (Phase 5)

**Structured Logging with Winston:**

```typescript
import { logger, logPerformance, logError } from '@/lib/logging/logger';

// Performance logging in repositories
async findBySlug(slug: string): Promise<IPO | null> {
  const startTime = Date.now();

  const result = await this.executeQuery('findBySlug', async () => {
    // Query execution
  }, { slug });

  const duration = Date.now() - startTime;
  logPerformance('db.findBySlug', duration, { table: 'ipos', slug });

  return result;
}

// Error logging with context
catch (error) {
  logError(error, {
    endpoint: '/api/ipos',
    method: 'GET',
    repository: 'IPORepository'
  });
  throw error;
}
```

**Application Performance Monitoring (Sentry):**

```typescript
import { trackPerformance, captureAPIError } from '@/lib/monitoring/sentry-utils';

// Service-level performance tracking
export async function getMainboardLandingData() {
  return trackPerformance(
    'service-mainboard-landing',
    async () => {
      // Business logic
      const data = await fetchDashboardData();
      return data;
    },
    { segment: 'MAINBOARD' }
  );
}

// API error capture
export async function GET(request: NextRequest) {
  try {
    const data = await service.getData();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    captureAPIError(error, {
      endpoint: '/api/ipos',
      method: 'GET',
      statusCode: 500
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
```

**Logging Features:**
- JSON structured logs with daily rotation (14d app, 30d error, 7d performance)
- Three transport types: Console (dev), File (production), Error file (critical)
- Automatic log cleanup and compression
- <5ms overhead per request

**Monitoring Documentation:** See `web/lib/monitoring/README.md` for complete guide.

---

**Last Updated**: 2025-10-30
**Maintained By**: Backend team & Winston (Architect)
**Review Frequency**: After major refactors or pattern changes
