# Redis Caching Strategy

**Single Source of Truth for Cache Architecture**
**Location**: `web/lib/cache/` implementation files

---

## 🎯 Cache Architecture Principles

1. **Cache-Aside Pattern** (implemented in BaseRepository)
2. **Graceful Degradation** (app works without Redis)
3. **Consistent Key Naming** (entity:operation:identifier)
4. **TTL-Based Expiration** (no manual cleanup needed)
5. **Pattern-Based Invalidation** (bulk cache clearing)

---

## 📁 Implementation Files (Reference Only)

**CRITICAL**: All cache implementation lives in these files. Never duplicate logic.

- `web/lib/cache/redis-client.ts` - Connection singleton with retry strategy
- `web/lib/cache/cache-keys.ts` - **All cache key generation functions**
- `web/lib/repositories/base-repository.ts` - Cache-aside pattern implementation

---

## 🔑 Cache Key Conventions

**Pattern**: `{entity}:{operation}:{identifier}[:{variant}]`

### Key Generation Functions (from cache-keys.ts)

| Function | Pattern | Example | Use Case |
|----------|---------|---------|----------|
| `getIPOBySlugKey(slug)` | `ipo:slug:{slug}` | `ipo:slug:lgeindia-ipo` | Single IPO lookup |
| `getIPOListKey(filters)` | `ipo:list:{md5hash}` | `ipo:list:a3d2f1...` | Filtered IPO lists |
| `getLatestSubscriptionKey(id)` | `subscription:latest:{id}` | `subscription:latest:uuid-123` | Latest snapshot |
| `getGMPHistoryKey(id, days)` | `gmp:history:{id}:{days}` | `gmp:history:uuid-123:7` | Historical data |
| `getDemandGraphKey(id, exchange?)` | `demand:graph:{id}:{exchange}` | `demand:graph:uuid-123:NSE` | Price-wise demand (NEW Oct 2025) |
| `getDemandSnapshotKey(id)` | `demand:snapshot:{id}` | `demand:snapshot:uuid-123` | Latest demand snapshot (NEW Oct 2025) |

**Key Design Rules:**
1. Use MD5 hash for complex filter objects
2. Include variant suffix for different views (`:7days`, `:all`)
3. Never hardcode keys - always use generator functions
4. Wildcards (`*`) only in invalidation patterns

---

## ⏱️ TTL (Time-To-Live) Strategy

**From**: `web/lib/cache/cache-keys.ts:CacheTTL`

| Data Type | TTL | Rationale | Invalidation Trigger |
|-----------|-----|-----------|---------------------|
| IPO List | 900s (15min) | Frequently changing | Scraper update |
| IPO Detail | 900s (15min) | Moderate changes | Scraper update |
| Subscription Latest | 300s (5min) | Real-time during bidding | Every scraper run |
| Demand Graph | 300s (5min) | Volatile during IPO | Every 30min scraper run (NEW Oct 2025) |
| Demand Snapshot | 300s (5min) | Real-time stats | Demand graph update (NEW Oct 2025) |
| GMP Latest | 600s (10min) | Manual updates | Manual GMP entry |
| Historical IPOs | 86400s (24h) | Static data | Listing performance update |
| Financials | 1800s (30min) | Rarely changes | Manual correction |
| Documents | 3600s (1h) | Static after upload | Document upload |

**TTL Selection Criteria:**
- **< 5 min**: Real-time data (subscriptions during open IPO)
- **5-15 min**: Frequently updated (IPO lists, details)
- **30-60 min**: Moderate update frequency (financials, broker links)
- **> 1 hour**: Static data (documents, historical performance)

---

## 🔄 Cache-Aside Pattern Implementation

**From**: `web/lib/repositories/base-repository.ts`

### Pattern Flow

```typescript
async getFromCache<T>(cacheKey, dbQuery, ttl) {
  1. Try Redis GET with 2s timeout
     ├─ HIT → Parse JSON and return
     └─ MISS/ERROR → Continue to database

  2. Execute database query

  3. Non-blocking cache SET with 2s timeout
     └─ Background process (don't wait)

  4. Return database result
}
```

### Implementation Methods (BaseRepository)

| Method | Purpose | Parameters | Behavior |
|--------|---------|------------|----------|
| `getFromCache<T>()` | Cache-first retrieval | `cacheKey, dbQuery, ttl` | 2s timeout on Redis ops |
| `setCache<T>()` | Populate cache | `cacheKey, data, ttl` | Throws CacheError on fail |
| `deleteCache()` | Remove keys | `key \| keys[]` | Logs errors, doesn't throw |
| `deleteCachePattern()` | Pattern removal | `pattern` (with `*`) | Uses `KEYS` + `DEL` |
| `invalidateCache()` | Bulk invalidation | `keys[], patterns[]` | Combines exact + pattern |

### Timeout Protection

**Critical**: All Redis operations have 2-second timeout protection to prevent hanging:

```typescript
// GET with timeout
const cacheTimeout = new Promise<null>((_, reject) =>
  setTimeout(() => reject(new Error('Redis get timeout')), 2000)
);
const cached = await Promise.race([redis.get(key), cacheTimeout]);

// SET with timeout (non-blocking)
setCacheWithTimeout().catch(error => console.error(error));
```

---

## 🗑️ Cache Invalidation Patterns

### Invalidation Functions (from cache-keys.ts)

```typescript
// Pattern-based invalidation for bulk operations
getIPOInvalidationKeys(ipoId, slug?) → [
  'ipo:id:{ipoId}',
  'ipo:list:*',        // All filtered lists
  'ipo:search:*',      // All searches
  'ipo:slug:{slug}'    // If slug provided
]

getSubscriptionInvalidationKeys(ipoId) → [
  'subscription:latest:{ipoId}',
  'subscription:history:{ipoId}:*'
]

getDemandGraphInvalidationKeys(ipoId) → [  // NEW Oct 2025
  'demand:graph:{ipoId}:*',     // All exchange variants
  'demand:snapshot:{ipoId}'      // Latest snapshot
]

getHistoricalIPOInvalidationKeys() → [
  'ipos:history:*'     // All historical filters
]
```

### When to Invalidate

| Event | Invalidate | Implementation Location |
|-------|-----------|------------------------|
| Scraper updates IPO | `ipo:list:*`, `ipo:id:{id}` | `scraper/src/index.ts` |
| Subscription snapshot | `subscription:latest:{id}`, `subscription:history:{id}:*` | After DB insert |
| GMP manual entry | `gmp:latest:{id}`, `gmp:history:{id}:*` | Admin API route |
| Listing performance | `ipos:history:*`, `listing:{id}` | Historical scraper |

---

## 🔌 Redis Connection Management

**From**: `web/lib/cache/redis-client.ts`

### Singleton Pattern

```typescript
let redisClient: Redis | null = null;

function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({ /* config */ });
  }
  return redisClient;
}
```

### Configuration

```typescript
{
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,

  // Retry Strategy
  retryStrategy: (times) => {
    if (times > 3) return null;  // Stop after 3 attempts
    return Math.min(times * 50, 2000);  // 50ms → 2000ms exponential
  },

  maxRetriesPerRequest: 3,
  connectTimeout: 5000,  // 5s connection timeout
  lazyConnect: false,    // Connect immediately
}
```

### Connection Events

| Event | Handler | Purpose |
|-------|---------|---------|
| `error` | Log error | Connection issues |
| `connect` | Log success | Initial connection |
| `ready` | Log ready | Accept commands |
| `close` | Log closed | Graceful shutdown |
| `reconnecting` | Log attempt | Retry notification |

### Graceful Degradation

**CRITICAL**: Application continues functioning if Redis fails.

```typescript
try {
  const cached = await redis.get(key);
  // Use cached data
} catch (error) {
  console.error('[Cache] Error:', error);
  // Fall back to database - NO THROW
}
```

---

## 🏗️ Repository Integration

### Example: IPORepository

```typescript
class IPORepository extends BaseRepository {
  async findBySlug(slug: string): Promise<IPO | null> {
    const cacheKey = getIPOBySlugKey(slug);  // Generate key

    return this.getFromCache(
      cacheKey,
      async () => {
        // Database query
        const result = await this.db.select().from(ipos)
          .where(eq(ipos.slug, slug));
        return result[0] || null;
      },
      CacheTTL.IPO_DETAIL  // 900 seconds
    );
  }

  async upsert(data: IPOInsert): Promise<void> {
    // 1. Update database
    await this.db.insert(ipos).values(data)
      .onConflictDoUpdate({ ... });

    // 2. Invalidate cache
    await this.invalidateCache(
      getIPOInvalidationKeys(data.id, data.slug)
    );
  }
}
```

---

## 📊 Cache Performance Monitoring

### Metrics to Track

1. **Hit Rate**: `(cache hits / total requests) * 100`
   - Target: > 80% for IPO detail/list endpoints

2. **Response Time**:
   - Cache HIT: < 10ms
   - Cache MISS: < 100ms (DB query)

3. **Memory Usage**: Monitor Redis memory
   - Alert at 80% capacity

4. **Connection Health**:
   - Track reconnection events
   - Alert on 3+ consecutive failures

### Logging Pattern

```typescript
console.log(`[Cache] HIT: ${cacheKey}`);
console.log(`[Cache] MISS: ${cacheKey}`);
console.log(`[Cache] SET: ${cacheKey} (TTL: ${ttl}s)`);
console.log(`[Cache] DEL: ${key}`);
console.log(`[Cache] DEL_PATTERN: ${pattern} (${count} keys)`);
console.error(`[Cache] Error:`, error);
```

---

## 🚨 Common Pitfalls & Solutions

### ❌ Pitfall 1: Hardcoded Cache Keys
```typescript
// WRONG
const cached = await redis.get('ipo:slug:xyz');

// CORRECT
const cached = await redis.get(getIPOBySlugKey('xyz'));
```

### ❌ Pitfall 2: Missing Invalidation After Updates
```typescript
// WRONG
await db.insert(ipos).values(data);
// Cache now stale!

// CORRECT
await db.insert(ipos).values(data);
await this.invalidateCache(getIPOInvalidationKeys(data.id));
```

### ❌ Pitfall 3: Blocking on Cache Operations
```typescript
// WRONG (app hangs if Redis down)
await redis.set(key, value);

// CORRECT (non-blocking with timeout)
setCacheWithTimeout().catch(err => console.error(err));
```

---

## 🛠️ ESLint Rules for Enforcement

**To be added**: `.eslintrc.js` rules

```javascript
// Enforce: Always use cache key generators
'no-restricted-syntax': [
  'error',
  {
    selector: 'CallExpression[callee.property.name=/^(get|set|del)$/]',
    message: 'Use cache key generator functions from cache-keys.ts'
  }
]
```

---

## 📚 Related Documentation

- Database Schema: `docs/16-database/SCHEMA_MANAGEMENT.md`
- Repository Patterns: `docs/02-architecture/backend-architecture.md`
- Performance Targets: `docs/02-architecture/security-and-performance.md`

---

**Last Updated**: 2025-10-20
**Maintained By**: Backend team
**Review Frequency**: Quarterly or on Redis upgrade
