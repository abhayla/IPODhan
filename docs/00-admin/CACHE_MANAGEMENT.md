# Admin Cache Management

**Feature Status:** ✅ Implemented (2025-10-22)
**Location:** Admin Settings > Cache Management
**API Endpoint:** `/api/admin/cache/clear`

## Overview

The Cache Management feature provides admin users with comprehensive tools to monitor and manage the Redis cache infrastructure. This is essential for:

- Ensuring data freshness after manual edits
- Troubleshooting cache-related issues
- Monitoring cache performance and memory usage
- Clearing stale or corrupted cache entries

## Features

### 1. Real-time Cache Statistics

Displays comprehensive cache metrics updated in real-time:

- **Total Keys**: Total number of cached entries across all patterns
- **Memory Usage**: Current Redis memory consumption (human-readable format)
- **Key Breakdown**: Distribution of keys by pattern:
  - `protection:*` - Field protection configurations
  - `ipo:*` - IPO data and lists
  - `subscription:*` - Subscription snapshots
  - `gmp:*` - Grey Market Premium records
  - Other - Miscellaneous cache entries

### 2. Selective Cache Clearing

Three clearing options with confirmation dialogs:

#### Clear Protection Caches
- **Pattern:** `protection:*`
- **Use Case:** After bulk field protection updates
- **Impact:** Minimal - only affects protection lookups
- **Rebuild Time:** <100ms on next protection check

#### Clear IPO Caches
- **Pattern:** `ipo:*`
- **Use Case:** After IPO data corrections or scraper runs
- **Impact:** Moderate - affects IPO listings and detail pages
- **Rebuild Time:** 200-500ms depending on IPO complexity

#### Clear All Caches
- **Pattern:** `*` (all keys)
- **Use Case:** Complete cache reset or troubleshooting
- **Impact:** High - entire application relies on cache rebuild
- **Rebuild Time:** Varies (1-5 seconds for popular pages)

### 3. Safety Features

- **Confirmation Dialogs:** All clear operations require explicit confirmation
- **Key Count Display:** Shows exact number of keys to be deleted
- **Loading States:** Visual feedback during operations
- **Success/Error Notifications:** Toast notifications with operation results
- **Refresh Button:** Manual statistics refresh capability

## API Specification

### GET /api/admin/cache/clear

**Purpose:** Retrieve cache statistics

**Authentication:** Required (Bearer token)

**Response:**
```json
{
  "success": true,
  "data": {
    "totalKeys": 1234,
    "memoryUsage": "12.5M",
    "breakdown": {
      "protection": 45,
      "ipo": 890,
      "subscription": 120,
      "gmp": 150,
      "other": 29
    }
  }
}
```

**Performance:** <50ms (Redis INFO + KEYS commands)

### POST /api/admin/cache/clear

**Purpose:** Clear cache by pattern or all caches

**Authentication:** Required (Bearer token)

**Request Body:**
```json
{
  "pattern": "protection:*",  // Optional: Redis pattern
  "clearAll": false           // Optional: Clear all keys
}
```

**Validation:**
- Either `pattern` OR `clearAll=true` is required
- Cannot specify both simultaneously

**Response:**
```json
{
  "success": true,
  "data": {
    "keysCleared": 45,
    "pattern": "protection:*",
    "sampleKeys": ["protection:field:123", "protection:ipo:456"]
  },
  "message": "Successfully cleared 45 cache keys matching \"protection:*\""
}
```

**Performance:**
- Pattern matching: 50-200ms (depends on key count)
- Bulk deletion: O(n) where n = number of matching keys

## Usage Examples

### Scenario 1: After Manual IPO Edit

**Problem:** Edited an IPO's price band, but old data still shows on frontend

**Solution:**
1. Navigate to Admin Settings > Cache Management
2. Click "Clear IPO Caches"
3. Confirm the operation (shows count of keys to be cleared)
4. Wait for success notification
5. Refresh frontend page - new data appears

**Time:** ~30 seconds total

### Scenario 2: Bulk Protection Status Change

**Problem:** Changed protection status for 20 fields, cache may be stale

**Solution:**
1. Navigate to Admin Settings > Cache Management
2. Click "Clear Protection Caches"
3. Confirm operation
4. Protection changes take immediate effect

**Time:** ~15 seconds total

### Scenario 3: Troubleshooting Cache Issues

**Problem:** Inconsistent data across different pages

**Solution:**
1. Check Cache Statistics - look for unusually high key counts
2. Use "Clear All Caches" as nuclear option
3. Monitor statistics after clear to verify rebuild
4. Test affected pages

**Time:** ~2 minutes total

## Technical Implementation

### Backend (API Route)

**File:** `web/app/api/admin/cache/clear/route.ts`

**Key Features:**
- Uses `getRedisClient()` singleton for connection management
- Pattern matching with `redis.keys(pattern)`
- Bulk deletion with `redis.del(...keys)`
- Error handling with detailed error messages
- Admin authentication via `withAdminAuth` middleware
- Logging of all cache operations with admin identity

**Redis Commands:**
- `DBSIZE` - Total key count
- `INFO memory` - Memory usage statistics
- `KEYS <pattern>` - Pattern matching (Note: O(n) operation)
- `DEL <keys...>` - Bulk deletion

### Frontend (React Component)

**File:** `web/app/admin/settings/page.tsx`

**State Management:**
```typescript
interface CacheStats {
  totalKeys: number;
  memoryUsage: string;
  breakdown: {
    protection: number;
    ipo: number;
    subscription: number;
    gmp: number;
    other: number;
  };
}
```

**UI Components:**
- Statistics dashboard with grid layout
- Action cards for each clear operation
- Modal confirmation dialog
- Toast notifications (auto-dismiss after 5s)
- Loading states for all async operations

**UX Patterns:**
- Optimistic UI updates (refresh stats after clear)
- Disabled states during operations
- Color-coded severity (orange for selective, red for clear all)
- Informational note about cache rebuild

## Performance Considerations

### Cache Statistics Endpoint

- **Target:** <50ms response time
- **Bottleneck:** `KEYS` command on large datasets
- **Optimization:** Consider SCAN command for >10k keys
- **Monitoring:** Log slow statistics queries (>100ms)

### Cache Clear Operations

- **Small Patterns (<100 keys):** <50ms
- **Medium Patterns (100-1000 keys):** 50-200ms
- **Large Patterns (>1000 keys):** 200-500ms
- **Clear All:** Varies with total key count

### Impact on Application

- **Cache Miss Storm:** Clearing large patterns causes temporary DB load spike
- **Mitigation:** Cache rebuilds are async and gradual (per-request)
- **Recovery Time:** <5 seconds for most pages
- **User Impact:** Minimal (slight slowdown on first request)

## Security

### Authentication

- All endpoints require valid admin token
- Token verification via `withAdminAuth` middleware
- Unauthorized requests return 401 status

### Authorization

- Phase 1: Single admin user
- Phase 2: Consider role-based access (read-only vs full admin)
- Audit log: All operations logged with admin identity

### Rate Limiting

- Currently: None implemented
- Recommendation: Limit to 10 cache clear ops per minute per admin
- Protection: Prevents accidental DoS via repeated clear all

## Monitoring & Logging

### Server Logs

All cache operations are logged:

```
[Admin API] Cache stats requested by Admin
[Admin API] Cleared 45 cache keys matching pattern "protection:*" by Admin
[Admin API] Cleared ALL caches (1234 keys) by Admin
```

### Metrics to Track

- Cache clear frequency (daily/weekly)
- Most cleared patterns (indicates data quality issues)
- Average keys cleared per operation
- Time between manual edit and cache clear (workflow efficiency)

### Alerts

Consider alerting on:
- Cache clear operations during peak hours (>1000 keys)
- Repeated cache clears within short time (potential issue)
- Failed cache operations (Redis connectivity)

## Troubleshooting

### "Failed to load cache statistics"

**Cause:** Redis connection issue

**Solution:**
1. Check Redis service status
2. Verify `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` env vars
3. Test connection: `redis-cli ping`
4. Check network connectivity to Redis server

### "Failed to clear cache"

**Cause:** Redis operation timeout or connection lost

**Solution:**
1. Verify Redis is running and accepting connections
2. Check Redis memory limits (may be full)
3. Reduce pattern scope (clear smaller subset)
4. Check Redis logs for errors

### Statistics show 0 keys but data exists

**Cause:** Redis flushed or restarted

**Solution:**
1. This is normal after Redis restart
2. Cache will rebuild automatically on requests
3. No action needed - system self-recovers

### Cache clears but old data still shows

**Cause:** Browser cache or CDN caching

**Solution:**
1. Hard refresh browser (Ctrl+Shift+R)
2. Check if CDN caching is enabled
3. Verify cache was actually cleared (check stats)
4. Clear browser cache

## Future Enhancements

### Phase 2: Advanced Features

1. **Scheduled Cache Clearing**
   - Cron jobs for automatic cache refresh
   - Configuration: daily at 3 AM for stale data

2. **Pattern Builder UI**
   - Interactive pattern builder
   - Preview matching keys before deletion
   - Save custom patterns for reuse

3. **Cache Analytics Dashboard**
   - Hit/miss ratio by pattern
   - Most cached endpoints
   - Cache size trends over time

4. **Granular Permissions**
   - Read-only access for statistics
   - Approval workflow for clear all
   - Role-based pattern restrictions

5. **Cache Warming**
   - Pre-populate cache after clear
   - Warm popular pages proactively
   - Reduce cache miss storm impact

### Phase 3: Production Optimizations

1. **SCAN Instead of KEYS**
   - Non-blocking pattern matching
   - Better performance on large datasets
   - Cursor-based iteration

2. **Batch Processing**
   - Clear keys in batches (1000 at a time)
   - Progress bar for large operations
   - Cancellable operations

3. **Cache Versioning**
   - Version-based cache invalidation
   - Automatic expiration on schema changes
   - Migration-safe cache strategy

## Testing

### Integration Tests

**File:** `web/tests/integration/api/admin-cache.test.ts`

**Coverage:**
- GET endpoint returns statistics
- POST endpoint clears by pattern
- POST endpoint clears all caches
- Request validation
- Authentication checks
- Statistics reflect changes after clear

**Run Tests:**
```bash
cd web
npm run test:integration -- admin-cache
```

### Manual Testing Checklist

- [ ] Load settings page - statistics appear
- [ ] Click "Refresh Stats" - updates successfully
- [ ] Clear protection caches - confirmation appears
- [ ] Confirm clear - success notification shows
- [ ] Statistics update after clear
- [ ] Clear IPO caches - works correctly
- [ ] Clear all caches - shows warning message
- [ ] Confirm clear all - all keys cleared
- [ ] Verify cache rebuilds on next request
- [ ] Test without authentication - 401 error

## References

- **Cache Keys Documentation:** `web/lib/cache/cache-keys.ts`
- **Redis Client:** `web/lib/cache/redis-client.ts`
- **Admin Auth Middleware:** `web/lib/middleware/admin-auth.ts`
- **Caching Strategy:** `docs/05-caching/CACHING_STRATEGY.md`
- **Backend Architecture:** `docs/02-architecture/backend-architecture.md`

## Changelog

### 2025-10-22 - Initial Implementation
- Added GET endpoint for cache statistics
- Added POST endpoint for selective/bulk cache clearing
- Implemented UI in admin settings page
- Added confirmation dialogs and notifications
- Created integration tests
- Documentation completed

---

**Last Updated:** 2025-10-22
**Implemented By:** Admin Panel Development
**Status:** ✅ Production Ready
