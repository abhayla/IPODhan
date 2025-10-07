# Cache Invalidation for Historical IPOs API

## Overview

The Historical IPOs API (`GET /api/ipos/history`) implements a cache-aside pattern with Redis caching to optimize performance. This document describes the cache invalidation strategy for maintaining data consistency when IPO data is updated by scrapers or admin operations.

## Cache Configuration

- **Cache Key Pattern**: `ipos:history:{year}:{sector}:{performance}:{sort}:{sortOrder}:{page}:{limit}`
- **TTL**: 86400 seconds (24 hours)
- **Cache Implementation**: Redis with automatic serialization/deserialization

## Cache Key Examples

```
ipos:history:2024:Technology:Positive:listing_gain:desc:1:20
ipos:history:All:All:All:listing_date:desc:1:20
ipos:history:2023:Finance:Negative:subscription:asc:2:10
```

## Cache Invalidation Strategy

### 1. When to Invalidate

Historical IPO cache should be invalidated when:

1. **IPO Status Changes to LISTED**: When a scraper updates an IPO from OPEN/CLOSED to LISTED
2. **Listing Performance Data Added**: When listing_performance table is updated with actual listing results
3. **Listing Date Updated**: When an IPO's listing_date is set or modified
4. **Subscription Data Updated**: When final subscription numbers are recorded
5. **IPO Data Corrections**: When admin manually corrects any historical IPO data

### 2. Invalidation Methods

#### Method 1: Wildcard Pattern Invalidation (Recommended)

Use this method in scraper scripts and admin operations:

```typescript
import { getRedisClient } from '@/lib/cache/redis-client';
import { getHistoricalIPOInvalidationKeys } from '@/lib/cache/cache-keys';

async function invalidateHistoricalIPOCache() {
  const redis = getRedisClient();
  const patterns = getHistoricalIPOInvalidationKeys();

  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
}
```

#### Method 2: IPO Repository Integration

The IPO Repository automatically invalidates historical cache when relevant data changes:

```typescript
// In IPORepository
async update(id: string, data: Partial<IPOInsert>): Promise<IPO> {
  // ... update logic ...

  // Invalidate historical cache if status changed to LISTED
  if (data.status === 'LISTED' || data.listingDate) {
    await this.deleteCachePattern('ipos:history:*');
  }

  return ipo;
}
```

### 3. Scraper Integration Points

#### A. Listing Performance Scraper

When scraping listing day data:

```typescript
// After updating listing_performance table
await ipoRepository.update(ipoId, { status: 'LISTED' });
await redis.del(await redis.keys('ipos:history:*'));
```

#### B. Subscription Data Scraper

When updating final subscription numbers:

```typescript
// After inserting final subscription snapshot
await redis.del(await redis.keys('ipos:history:*'));
```

## Cache Warm-up Strategy

For optimal performance, consider pre-warming the cache for common queries:

```typescript
const commonQueries = [
  { year: '2024' },
  { year: '2023' },
  { performance: 'Positive' },
  { sector: 'Technology' },
  { sort: 'listing_gain', sortOrder: 'desc' },
];

for (const query of commonQueries) {
  await ipoRepository.findHistorical(query);
}
```

## Monitoring Cache Performance

### Cache Hit Rate

Monitor cache effectiveness:

```typescript
// Log cache hits vs misses
const cacheHits = await redis.get('cache:hits:historical-ipos');
const cacheMisses = await redis.get('cache:misses:historical-ipos');
const hitRate = cacheHits / (cacheHits + cacheMisses);
```

### Cache Size

Monitor memory usage:

```bash
redis-cli
> MEMORY USAGE ipos:history:*
> INFO memory
```

## Best Practices

1. **Batch Invalidation**: When updating multiple IPOs, batch invalidate at the end rather than after each update
2. **Selective Invalidation**: For minor updates (like rating changes), consider selective invalidation by year/sector
3. **Off-Peak Invalidation**: Schedule cache invalidation during off-peak hours when possible
4. **Monitoring**: Set up alerts for cache invalidation failures
5. **Fallback**: Always ensure API works even if Redis is unavailable (cache-aside pattern handles this)

## Testing Cache Invalidation

### Unit Test Example

```typescript
it('should invalidate historical cache on IPO status change to LISTED', async () => {
  // Setup: Create cached entry
  await ipoRepository.findHistorical({ year: '2024' });
  const cacheKey = 'ipos:history:2024:All:All:listing_date:desc:1:20';
  expect(await redis.get(cacheKey)).not.toBeNull();

  // Action: Update IPO status
  await ipoRepository.update(ipoId, { status: 'LISTED' });

  // Assert: Cache should be invalidated
  expect(await redis.get(cacheKey)).toBeNull();
});
```

### Integration Test Example

```typescript
it('should serve fresh data after cache invalidation', async () => {
  // First request (cache miss)
  const response1 = await GET(new NextRequest('/api/ipos/history?year=2024'));
  const data1 = await response1.json();

  // Update data and invalidate cache
  await updateIPOListingData(ipoId);
  await invalidateHistoricalIPOCache();

  // Second request (cache miss, fresh data)
  const response2 = await GET(new NextRequest('/api/ipos/history?year=2024'));
  const data2 = await response2.json();

  expect(data2).not.toEqual(data1);
});
```

## Troubleshooting

### Issue: Stale Data After Updates

**Symptom**: API returns old data after scraper updates

**Solution**:
1. Verify cache invalidation is called after DB updates
2. Check Redis connection in scraper scripts
3. Verify wildcard pattern matching works: `redis-cli KEYS "ipos:history:*"`

### Issue: Cache Flooding

**Symptom**: Too many unique cache keys, high memory usage

**Solution**:
1. Limit filter combinations in UI
2. Implement cache key normalization (e.g., sort sectors alphabetically)
3. Set appropriate TTL (24h is usually sufficient)

### Issue: Performance Degradation

**Symptom**: Slow API responses despite caching

**Solution**:
1. Check Redis connection latency
2. Verify cache hit rate (should be >80% in production)
3. Consider implementing cache warm-up on deploy
4. Review query complexity and add database indexes if needed

## Related Documentation

- [Cache Keys Documentation](../../web/lib/cache/cache-keys.ts)
- [Redis Client Configuration](../../web/lib/redis-client.ts)
- [IPO Repository](../../web/lib/repositories/ipo-repository.ts)
- [Story 6.1 Implementation](./story-6.1-historical-ipos-api.md)
