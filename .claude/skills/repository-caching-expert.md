# Repository & Caching Expert

**Purpose:** This skill provides expertise in the repository pattern with cache-aside implementation used throughout IPODhan. It covers BaseRepository extension, Redis caching strategies, TTL management, and cache invalidation patterns.

**When to invoke:** Use this skill when creating new repositories, implementing caching logic, debugging cache issues, optimizing data access patterns, or troubleshooting Redis connection problems.

---

## Core Concepts

### Repository Pattern

The repository pattern abstracts data access logic from business logic, providing:
- **Separation of Concerns:** Data access isolated from business logic
- **Testability:** Easy to mock for unit tests
- **Caching Integration:** Automatic cache-aside implementation
- **Query Logging:** Built-in performance tracking
- **Error Handling:** Consistent error handling across all data access

### Cache-Aside Pattern

IPODhan implements the cache-aside (lazy loading) pattern:

1. **Read Request:**
   - Check cache first
   - If found (cache hit): Return cached data
   - If not found (cache miss): Query database → Store in cache → Return data

2. **Write Request:**
   - Update database first
   - Invalidate or update cache
   - Next read will repopulate cache

**Benefits:**
- Cache only what's needed (lazy loading)
- Cache failures don't break the application
- Simple to implement and reason about

---

## BaseRepository Class

All repositories extend `BaseRepository` for automatic caching functionality:

### Location
```
web/lib/repositories/base-repository.ts
```

### Core Methods

#### 1. `getFromCache<T>(cacheKey, dbQuery, ttl)`

Cache-first data retrieval with automatic fallback to database.

**Signature:**
```typescript
protected async getFromCache<T>(
  cacheKey: string,
  dbQuery: () => Promise<T>,
  ttl: number = 900 // 15 minutes default
): Promise<T>
```

**Parameters:**
- `cacheKey`: Structured cache key (see Cache Key Conventions)
- `dbQuery`: Async function that queries the database
- `ttl`: Time-to-live in seconds

**Example:**
```typescript
async findBySlug(slug: string): Promise<IPO | null> {
  const cacheKey = getIPOBySlugKey(slug); // 'ipo:slug:xyz-corp'

  return this.getFromCache(cacheKey, async () => {
    const result = await this.db
      .select()
      .from(ipos)
      .where(eq(ipos.slug, slug))
      .limit(1);

    return result[0] || null;
  }, CacheTTL.IPO_DETAIL); // 900 seconds = 15 minutes
}
```

**Behavior:**
1. Attempts to get data from Redis
2. If found: Parses JSON and returns (35ms avg)
3. If not found or error: Executes `dbQuery` (150ms avg)
4. Stores result in cache with TTL
5. Returns data

**Error Handling:**
- Redis errors are logged but don't break the flow
- Falls back to database gracefully
- Application continues working even if Redis is down

#### 2. `setCache<T>(cacheKey, data, ttl)`

Manually populate cache with data.

**Signature:**
```typescript
protected async setCache<T>(
  cacheKey: string,
  data: T,
  ttl: number = 900
): Promise<void>
```

**Use Case:** After database write operations, populate cache proactively

**Example:**
```typescript
async update(id: string, updates: Partial<IPO>): Promise<IPO> {
  // Update database
  const updated = await this.db
    .update(ipos)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(ipos.id, id))
    .returning();

  // Populate cache with fresh data
  const cacheKey = getIPOByIdKey(id);
  await this.setCache(cacheKey, updated[0], CacheTTL.IPO_DETAIL);

  return updated[0];
}
```

#### 3. `deleteCache(key | keys[])`

Invalidate specific cache keys.

**Signature:**
```typescript
protected async deleteCache(
  keys: string | string[]
): Promise<void>
```

**Example - Single Key:**
```typescript
async delete(id: string): Promise<void> {
  await this.db.delete(ipos).where(eq(ipos.id, id));

  // Invalidate specific IPO cache
  await this.deleteCache(getIPOByIdKey(id));
}
```

**Example - Multiple Keys:**
```typescript
async update(id: string, updates: Partial<IPO>): Promise<IPO> {
  const ipo = await this.findById(id);

  // Update database
  const updated = await this.db.update(ipos)...;

  // Invalidate all related cache keys
  await this.deleteCache([
    getIPOByIdKey(id),
    getIPOBySlugKey(ipo.slug),
    getIPOListKey('all'),
    getIPOListKey(`segment:${ipo.segment}`)
  ]);

  return updated[0];
}
```

#### 4. `deleteCachePattern(pattern)`

Invalidate multiple cache keys matching a pattern.

**Signature:**
```typescript
protected async deleteCachePattern(
  pattern: string
): Promise<void>
```

**Use Case:** Bulk invalidation when data changes affect many cached items

**Example:**
```typescript
async updateSubscription(ipoId: string, data: Subscription): Promise<void> {
  // Update subscription data
  await this.db.insert(subscriptions).values(data);

  // Invalidate all subscription-related caches for this IPO
  await this.deleteCachePattern(`subscription:${ipoId}:*`);

  // Also invalidate IPO list caches (subscription affects IPO cards)
  await this.deleteCachePattern('ipo:list:*');
}
```

**Pattern Syntax:**
- `*` matches any characters
- `?` matches single character
- Examples:
  - `ipo:*` - All IPO-related caches
  - `subscription:abc123:*` - All subscription data for IPO abc123
  - `ipo:list:segment:*` - All segment-filtered IPO lists

#### 5. `executeQuery<T>(queryName, query, context)`

Execute database query with logging and performance tracking.

**Signature:**
```typescript
protected async executeQuery<T>(
  queryName: string,
  query: () => Promise<T>,
  context?: Record<string, any>
): Promise<T>
```

**Example:**
```typescript
async findAll(filters: IPOFilters): Promise<IPO[]> {
  return this.executeQuery(
    'ipo.findAll',
    async () => {
      let query = this.db.select().from(ipos);

      if (filters.segment) {
        query = query.where(eq(ipos.segment, filters.segment));
      }

      return query;
    },
    { filters } // Context for logging
  );
}
```

**Logging Output:**
```json
{
  "level": "info",
  "message": "Query executed: ipo.findAll",
  "duration": 145,
  "context": { "filters": { "segment": "MAINBOARD" } }
}
```

---

## Cache Key Conventions

All cache keys follow a structured pattern for consistency and pattern-based invalidation.

### Location
```
web/lib/cache/cache-keys.ts
```

### Key Structure Pattern

```
{entity}:{operation}:{identifier}[:{variant}]
```

**Components:**
- **entity:** The resource type (ipo, subscription, gmp, financial, etc.)
- **operation:** The query type (slug, id, list, latest, etc.)
- **identifier:** Unique identifier (slug, id, filter string)
- **variant:** Optional variant (category, date range, etc.)

### Key Generator Functions

#### IPO Keys
```typescript
export const getIPOBySlugKey = (slug: string) => `ipo:slug:${slug}`;
// Example: 'ipo:slug:xyz-corp-ipo'

export const getIPOByIdKey = (id: string) => `ipo:id:${id}`;
// Example: 'ipo:id:abc123-def456'

export const getIPOListKey = (filters: string) => `ipo:list:${filters}`;
// Example: 'ipo:list:segment:MAINBOARD:status:OPEN'

export const getIPODetailKey = (slug: string) => `ipo:detail:${slug}`;
// Example: 'ipo:detail:xyz-corp-ipo' (includes all relations)
```

#### Subscription Keys
```typescript
export const getSubscriptionKey = (ipoId: string, category?: string) =>
  category ? `subscription:${ipoId}:${category}` : `subscription:${ipoId}:all`;
// Examples:
// 'subscription:abc123:qib'
// 'subscription:abc123:all'

export const getLatestSubscriptionKey = (ipoId: string) =>
  `subscription:latest:${ipoId}`;
// Example: 'subscription:latest:abc123'
```

#### GMP Keys
```typescript
export const getLatestGMPKey = (ipoId: string) => `gmp:latest:${ipoId}`;
// Example: 'gmp:latest:abc123'

export const getGMPHistoryKey = (ipoId: string) => `gmp:history:${ipoId}`;
// Example: 'gmp:history:abc123'
```

#### Financial Data Keys
```typescript
export const getFinancialDataKey = (ipoId: string) => `financial:${ipoId}`;
// Example: 'financial:abc123'
```

#### Document Keys
```typescript
export const getDocumentsKey = (ipoId: string, type?: string) =>
  type ? `documents:${ipoId}:${type}` : `documents:${ipoId}:all`;
// Examples:
// 'documents:abc123:DRHP'
// 'documents:abc123:all'
```

### Filter String Serialization

For list queries with multiple filters, serialize filters consistently:

```typescript
function serializeFilters(filters: IPOFilters): string {
  const parts: string[] = [];

  if (filters.segment) parts.push(`segment:${filters.segment.join(',')}`);
  if (filters.status) parts.push(`status:${filters.status.join(',')}`);
  if (filters.openDate) parts.push(`openDate:${filters.openDate}`);

  return parts.join(':') || 'all';
}

// Usage
const cacheKey = getIPOListKey(serializeFilters(filters));
// Result: 'ipo:list:segment:MAINBOARD,SME:status:OPEN'
```

---

## TTL Strategies

Time-to-live varies based on data volatility and update frequency.

### TTL Configuration

```typescript
// Location: web/lib/cache/cache-keys.ts

export const CacheTTL = {
  // Real-time data (high volatility)
  SUBSCRIPTION: 180,      // 3 minutes - Updates frequently during IPO open

  // Frequently updated data
  IPO_LIST: 300,          // 5 minutes - List views with filters
  GMP: 900,               // 15 minutes - Grey market changes moderately
  IPO_DETAIL: 900,        // 15 minutes - IPO detail pages

  // Moderately updated data
  FINANCIAL_DATA: 1800,   // 30 minutes - Financials rarely change mid-IPO
  DOCUMENTS: 3600,        // 1 hour - Documents added occasionally

  // Static or rarely updated data
  REGISTRARS: 86400,      // 24 hours - Registrar info rarely changes
  MARKET_HOLIDAYS: 86400, // 24 hours - Holiday calendar is annual
  PEER_DATA: 3600,        // 1 hour - Peer comparisons

  // Listing performance (varies by IPO status)
  LISTING_PERFORMANCE_LISTED: 86400,    // 24 hours - Historical data
  LISTING_PERFORMANCE_UPCOMING: 3600,   // 1 hour - May get updated
};
```

### Dynamic TTL Based on IPO Status

```typescript
function getIPOTTL(ipoStatus: string): number {
  switch (ipoStatus) {
    case 'OPEN':
      return CacheTTL.SUBSCRIPTION; // 3 minutes - High volatility
    case 'CLOSED':
      return CacheTTL.IPO_DETAIL;   // 15 minutes - Moderate updates
    case 'LISTED':
      return CacheTTL.LISTING_PERFORMANCE_LISTED; // 24 hours - Static
    case 'UPCOMING':
    default:
      return CacheTTL.IPO_DETAIL;   // 15 minutes - Occasional updates
  }
}

// Usage in repository
async findBySlug(slug: string): Promise<IPO | null> {
  const ipo = await this.getFromCache(
    getIPOBySlugKey(slug),
    async () => {
      // Database query
    },
    getIPOTTL(ipo?.status || 'UPCOMING')
  );

  return ipo;
}
```

---

## Redis Connection Management

### Singleton Pattern

Redis client uses singleton pattern with retry logic.

**Location:** `web/lib/cache/redis-client.ts`

**Get Client:**
```typescript
import { getRedisClient } from '@/lib/cache/redis-client';

const redis = getRedisClient();
```

**Features:**
- Single instance across application
- Automatic reconnection with exponential backoff
- 3 retry attempts (50ms, 200ms, 2000ms)
- 5-second connection timeout
- Graceful degradation if connection fails

### Connection Retry Strategy

```typescript
const retryStrategy = (times: number) => {
  if (times > 3) return null; // Stop after 3 attempts

  const delay = Math.min(times * 50, 2000);
  return delay;
};

// Retry delays:
// Attempt 1: 50ms
// Attempt 2: 100ms
// Attempt 3: 150ms
// After 3 failures: Give up, app continues without Redis
```

### Health Check

```typescript
import { testRedisConnection } from '@/lib/cache/redis-client';

const isHealthy = await testRedisConnection();
if (!isHealthy) {
  console.warn('Redis unavailable - falling back to database');
}
```

### Graceful Degradation

If Redis is unavailable:
- All `getFromCache()` calls fall back to database
- No cache writes attempted
- Application continues functioning normally
- Logs warning but doesn't throw errors
- Performance impact: ~120ms slower (database query time)

---

## Creating a New Repository

### Step 1: Extend BaseRepository

```typescript
// Location: web/lib/repositories/your-entity-repository.ts

import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Redis } from 'ioredis';
import * as schema from '@ipodhan/shared/db/schema';
import { BaseRepository } from './base-repository';

export class YourEntityRepository extends BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>,
    protected redis: Redis
  ) {
    super(db, redis);
  }

  // Your methods here
}
```

**Key Points:**
- Import schema from `@ipodhan/shared/db/schema` (single source of truth)
- Use `NodePgDatabase<typeof schema>` type for db parameter
- Pass both db and redis to super constructor

### Step 2: Implement Read Methods with Caching

```typescript
async findById(id: string): Promise<YourEntity | null> {
  const cacheKey = getYourEntityByIdKey(id);

  return this.getFromCache(cacheKey, async () => {
    const result = await this.db
      .select()
      .from(yourEntities)
      .where(eq(yourEntities.id, id))
      .limit(1);

    return result[0] || null;
  }, CacheTTL.YOUR_ENTITY);
}

async findAll(filters?: Filters): Promise<YourEntity[]> {
  const cacheKey = getYourEntityListKey(serializeFilters(filters));

  return this.getFromCache(cacheKey, async () => {
    let query = this.db.select().from(yourEntities);

    // Apply filters
    if (filters?.someField) {
      query = query.where(eq(yourEntities.someField, filters.someField));
    }

    return query;
  }, CacheTTL.YOUR_ENTITY_LIST);
}
```

### Step 3: Implement Write Methods with Cache Invalidation

```typescript
async create(data: NewYourEntity): Promise<YourEntity> {
  const result = await this.db
    .insert(yourEntities)
    .values(data)
    .returning();

  // Invalidate list caches (new item added)
  await this.deleteCachePattern('your-entity:list:*');

  // Optionally populate cache for new item
  await this.setCache(
    getYourEntityByIdKey(result[0].id),
    result[0],
    CacheTTL.YOUR_ENTITY
  );

  return result[0];
}

async update(id: string, updates: Partial<YourEntity>): Promise<YourEntity> {
  const result = await this.db
    .update(yourEntities)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(yourEntities.id, id))
    .returning();

  // Invalidate specific item cache
  await this.deleteCache(getYourEntityByIdKey(id));

  // Invalidate list caches (item changed)
  await this.deleteCachePattern('your-entity:list:*');

  return result[0];
}

async delete(id: string): Promise<void> {
  await this.db.delete(yourEntities).where(eq(yourEntities.id, id));

  // Invalidate caches
  await this.deleteCache(getYourEntityByIdKey(id));
  await this.deleteCachePattern('your-entity:list:*');
}
```

### Step 4: Add Cache Key Generators

```typescript
// Location: web/lib/cache/cache-keys.ts

export const getYourEntityByIdKey = (id: string) => `your-entity:id:${id}`;
export const getYourEntityListKey = (filters: string) => `your-entity:list:${filters}`;

// Add TTL
export const CacheTTL = {
  // ... existing TTLs
  YOUR_ENTITY: 900,      // 15 minutes
  YOUR_ENTITY_LIST: 300, // 5 minutes
};
```

### Step 5: Write Tests

```typescript
// Location: web/tests/integration/repositories/your-entity-repository.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestDb, getTestRedis, cleanupTest } from '../test-helpers';
import { YourEntityRepository } from '@/lib/repositories/your-entity-repository';

describe('YourEntityRepository', () => {
  let db;
  let redis;
  let repository;

  beforeAll(async () => {
    db = await getTestDb();
    redis = await getTestRedis();
    repository = new YourEntityRepository(db, redis);
  });

  afterAll(async () => {
    await cleanupTest(db, redis);
  });

  it('should cache findById results', async () => {
    // First call - cache miss
    const entity1 = await repository.findById('test-id');

    // Second call - cache hit (should be faster)
    const start = Date.now();
    const entity2 = await repository.findById('test-id');
    const duration = Date.now() - start;

    expect(entity2).toEqual(entity1);
    expect(duration).toBeLessThan(50); // Cache hit should be <50ms
  });

  it('should invalidate cache on update', async () => {
    // Create and cache
    const entity = await repository.create({ name: 'Test' });
    await repository.findById(entity.id); // Cache it

    // Update
    await repository.update(entity.id, { name: 'Updated' });

    // Verify cache was invalidated (fresh from DB)
    const updated = await repository.findById(entity.id);
    expect(updated.name).toBe('Updated');
  });
});
```

---

## Cache Invalidation Patterns

### Pattern 1: Direct Invalidation

Invalidate specific known keys after mutation.

```typescript
async updateIPO(id: string, updates: Partial<IPO>): Promise<IPO> {
  const ipo = await this.findById(id);

  // Update database
  const updated = await this.db.update(ipos)...;

  // Invalidate exact keys
  await this.deleteCache([
    getIPOByIdKey(id),
    getIPOBySlugKey(ipo.slug),
  ]);

  return updated[0];
}
```

**Use When:** You know exactly which cache keys are affected.

### Pattern 2: Pattern-Based Invalidation

Invalidate all keys matching a pattern.

```typescript
async updateSubscription(ipoId: string): Promise<void> {
  // Update database
  await this.db.insert(subscriptions)...;

  // Invalidate all subscription caches for this IPO
  await this.deleteCachePattern(`subscription:${ipoId}:*`);

  // Also invalidate IPO lists (subscription affects display)
  await this.deleteCachePattern('ipo:list:*');
}
```

**Use When:** Multiple related keys might be affected.

### Pattern 3: Proactive Cache Population

Update cache immediately after mutation instead of invalidating.

```typescript
async updateIPO(id: string, updates: Partial<IPO>): Promise<IPO> {
  // Update database
  const updated = await this.db.update(ipos)...;

  // Proactively update cache with fresh data
  await this.setCache(getIPOByIdKey(id), updated[0], CacheTTL.IPO_DETAIL);
  await this.setCache(getIPOBySlugKey(updated[0].slug), updated[0], CacheTTL.IPO_DETAIL);

  return updated[0];
}
```

**Use When:** You expect the data to be read immediately after write (read-after-write pattern).

### Pattern 4: Lazy Invalidation

Let cache expire naturally, rely on TTL.

```typescript
async addDocument(ipoId: string, doc: Document): Promise<void> {
  // Update database
  await this.db.insert(documents)...;

  // Don't invalidate - documents cache has 1h TTL
  // Will refresh on next read after expiry
}
```

**Use When:** Changes are non-critical and can wait for TTL expiry.

---

## Performance Optimization

### Cache Hit Ratio Monitoring

Target: >80% cache hit rate for IPO detail/list endpoints

```typescript
// Add to repository
private cacheHits = 0;
private cacheMisses = 0;

protected async getFromCache<T>(...): Promise<T> {
  const cached = await this.redis.get(cacheKey);

  if (cached) {
    this.cacheHits++;
    // Return cached data
  } else {
    this.cacheMisses++;
    // Query database
  }

  // Log periodically
  if ((this.cacheHits + this.cacheMisses) % 100 === 0) {
    const hitRate = this.cacheHits / (this.cacheHits + this.cacheMisses);
    console.log(`Cache hit rate: ${(hitRate * 100).toFixed(2)}%`);
  }
}
```

### Query Performance Tracking

```typescript
async findBySlug(slug: string): Promise<IPO | null> {
  const start = Date.now();

  const result = await this.getFromCache(
    getIPOBySlugKey(slug),
    async () => {
      // Database query
    },
    CacheTTL.IPO_DETAIL
  );

  const duration = Date.now() - start;

  if (duration > 100) {
    console.warn(`Slow query: findBySlug(${slug}) took ${duration}ms`);
  }

  return result;
}
```

### Batch Operations

Avoid N+1 queries by batch loading and caching:

```typescript
async findByIds(ids: string[]): Promise<IPO[]> {
  // Try to get from cache first
  const cacheKeys = ids.map(getIPOByIdKey);
  const cached = await this.redis.mget(cacheKeys);

  const results: IPO[] = [];
  const missingIds: string[] = [];

  cached.forEach((item, index) => {
    if (item) {
      results.push(JSON.parse(item));
    } else {
      missingIds.push(ids[index]);
    }
  });

  // Fetch missing from database
  if (missingIds.length > 0) {
    const dbResults = await this.db
      .select()
      .from(ipos)
      .where(inArray(ipos.id, missingIds));

    // Cache the results
    const pipeline = this.redis.pipeline();
    dbResults.forEach(ipo => {
      pipeline.setex(
        getIPOByIdKey(ipo.id),
        CacheTTL.IPO_DETAIL,
        JSON.stringify(ipo)
      );
    });
    await pipeline.exec();

    results.push(...dbResults);
  }

  return results;
}
```

---

## Troubleshooting

### Issue: Cache Not Updating After Write

**Symptoms:** Stale data showing after update

**Causes:**
1. Forgot to invalidate cache after mutation
2. Invalidating wrong cache key
3. Multiple cache keys for same data not all invalidated

**Solution:**
```typescript
// Add comprehensive cache invalidation
async update(id: string, updates: Partial<IPO>): Promise<IPO> {
  const ipo = await this.findById(id); // Get current state

  // Update database
  const updated = await this.db.update(ipos)...;

  // Invalidate ALL related caches
  await this.deleteCache([
    getIPOByIdKey(id),
    getIPOBySlugKey(ipo.slug),
    getIPODetailKey(ipo.slug),
  ]);

  // Also invalidate lists if segment/status changed
  if (updates.segment || updates.status) {
    await this.deleteCachePattern('ipo:list:*');
  }

  return updated[0];
}
```

### Issue: High Memory Usage in Redis

**Symptoms:** Redis memory growing unbounded

**Causes:**
1. TTL not set on some keys
2. Very long TTLs
3. Large objects being cached

**Solution:**
```typescript
// Always set TTL
await this.redis.setex(cacheKey, ttl, JSON.stringify(data));

// NOT this (missing TTL)
await this.redis.set(cacheKey, JSON.stringify(data));

// Check TTL in Redis
// redis-cli> TTL ipo:slug:xyz-corp
// Should return positive number, not -1 (no expiry)
```

### Issue: Cache Hit Rate Too Low (<50%)

**Causes:**
1. TTL too short for data volatility
2. Over-aggressive cache invalidation
3. Unique query parameters preventing cache hits

**Solution:**
```typescript
// Normalize query parameters
function serializeFilters(filters: IPOFilters): string {
  // Sort keys for consistent serialization
  const normalized = {
    segment: filters.segment?.sort(),
    status: filters.status?.sort(),
  };

  return JSON.stringify(normalized);
}

// Increase TTL for stable data
export const CacheTTL = {
  IPO_DETAIL: 1800, // 30 minutes instead of 15
};
```

### Issue: Redis Connection Errors

**Symptoms:** `[Redis] Connection error` in logs

**Causes:**
1. Redis server down
2. Network issues
3. Wrong connection credentials

**Solution:**
Application auto-falls back to database:
```typescript
// No action needed - graceful degradation built-in
// Check logs:
console.log('[Redis] Connection error, falling back to database');

// Verify Redis health
const isHealthy = await testRedisConnection();

// Test Redis manually
// redis-cli -h 103.118.16.189 -p 6379 ping
// Should return: PONG
```

---

## Best Practices

### 1. Always Use Cache Key Generators

✅ **Good:**
```typescript
const cacheKey = getIPOBySlugKey(slug);
```

❌ **Bad:**
```typescript
const cacheKey = `ipo:${slug}`; // Inconsistent, error-prone
```

### 2. Match TTL to Data Volatility

```typescript
// High volatility (changes every few minutes)
SUBSCRIPTION: 180 // 3 minutes

// Low volatility (rarely changes)
REGISTRARS: 86400 // 24 hours
```

### 3. Invalidate Related Caches

```typescript
// When updating IPO, also invalidate:
// - IPO by ID
// - IPO by slug
// - IPO detail (with relations)
// - IPO lists (if segment/status changed)
```

### 4. Use Pattern Invalidation Carefully

```typescript
// Be specific to avoid invalidating too much
await this.deleteCachePattern(`ipo:list:segment:${segment}:*`);

// Not this (invalidates everything)
await this.deleteCachePattern('*');
```

### 5. Test Cache Behavior

```typescript
// Test cache hit
it('should return cached data on second call', async () => {
  await repository.findById('test-id'); // Prime cache

  const start = Date.now();
  await repository.findById('test-id'); // Should be fast
  const duration = Date.now() - start;

  expect(duration).toBeLessThan(50); // <50ms = cache hit
});

// Test cache invalidation
it('should invalidate cache on update', async () => {
  const entity = await repository.create({...});
  await repository.findById(entity.id); // Cache it

  await repository.update(entity.id, {...}); // Should invalidate

  // Next read should get fresh data
  const updated = await repository.findById(entity.id);
  expect(updated.name).toBe('New Name');
});
```

---

## References

- **BaseRepository:** `web/lib/repositories/base-repository.ts`
- **Cache Keys:** `web/lib/cache/cache-keys.ts`
- **Redis Client:** `web/lib/cache/redis-client.ts`
- **Cache Strategy Doc:** `docs/05-caching/CACHING_STRATEGY.md`
- **ioredis Documentation:** https://github.com/redis/ioredis

---

**Note:** This caching pattern is critical for performance. IPODhan targets p95 API response time <500ms, which is achieved through effective caching with >80% hit rate on hot paths.
