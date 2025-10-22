# Cache Management Quick Start Guide

## For Admins

### How to Clear Cache After Data Edits

1. **Login to Admin Panel**
   - Navigate to `/admin/login`
   - Enter your admin token

2. **Go to Settings**
   - Click "Settings" in admin navigation
   - Scroll to "Cache Management" section

3. **Choose Clear Operation**

   **After editing a single IPO:**
   - Click "Clear IPO Caches" button
   - Confirm in popup (shows how many keys will be deleted)
   - Wait for green success message

   **After changing protection settings:**
   - Click "Clear Protection Caches" button
   - Confirm and wait for completion

   **For complete cache reset:**
   - Click "Clear All Caches" button
   - Read warning message carefully
   - Confirm only if necessary

4. **Verify Results**
   - Check statistics refresh automatically
   - Visit affected pages to see new data
   - Hard refresh browser if needed (Ctrl+Shift+R)

### When to Clear Cache

✅ **DO clear cache when:**
- You manually edited IPO data
- You changed field protection settings
- Old data persists after scraper run
- Troubleshooting data inconsistencies

❌ **DON'T clear cache when:**
- Scraper is currently running (wait for completion)
- During peak traffic hours (unless urgent)
- Without confirming the pattern/scope
- Repeatedly (wait for rebuild between clears)

### Best Practices

1. **Start Specific:** Try pattern-based clear before "Clear All"
2. **Monitor Impact:** Check statistics before and after
3. **Peak Hours:** Avoid large clears during 9 AM - 9 PM IST
4. **Document Reason:** Note why you cleared cache (for audit)
5. **Verify Result:** Always check frontend after clear

## For Developers

### API Usage

#### Get Cache Statistics
```bash
curl -X GET http://localhost:3000/api/admin/cache/clear \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

#### Clear Specific Pattern
```bash
curl -X POST http://localhost:3000/api/admin/cache/clear \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pattern": "ipo:*"
  }'
```

#### Clear All Caches
```bash
curl -X POST http://localhost:3000/api/admin/cache/clear \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clearAll": true
  }'
```

### Programmatic Cache Clear

```typescript
import { getRedisClient } from '@/lib/cache/redis-client';

const redis = getRedisClient();

// Clear specific pattern
const keys = await redis.keys('ipo:*');
if (keys.length > 0) {
  await redis.del(...keys);
}

// Clear single key
await redis.del('ipo:slug:xyz-corporation-ipo');
```

### Cache Invalidation After Mutations

```typescript
// After updating IPO
import { deleteCachePattern } from '@/lib/repositories/base-repository';

// In your repository method:
async updateIPO(id: string, data: Partial<IPO>) {
  // Update database
  await this.db.update(ipos).set(data).where(eq(ipos.id, id));

  // Invalidate caches
  await this.deleteCachePattern(`ipo:*`);
  await this.deleteCache(`ipo:id:${id}`);
}
```

## Cache Patterns Reference

| Pattern | Description | Typical Count | TTL |
|---------|-------------|---------------|-----|
| `protection:*` | Field protection configs | 50-200 | 1 hour |
| `ipo:*` | IPO data and lists | 500-2000 | 15 min |
| `subscription:*` | Subscription snapshots | 100-500 | 3 min |
| `gmp:*` | GMP records | 200-800 | 10 min |
| `score:*` | IPO scores | 100-300 | 15 min |
| `peers:*` | Peer companies | 50-200 | 1 hour |

## Troubleshooting

### Problem: Statistics not loading

**Quick Fix:**
```bash
# Check Redis is running
redis-cli ping
# Should return: PONG

# If Redis is down, start it:
sudo systemctl start redis
# or
redis-server
```

### Problem: Clear operation fails

**Debug Steps:**
1. Check Redis connection: `redis-cli ping`
2. Check Redis memory: `redis-cli info memory`
3. Check Redis logs: `tail -f /var/log/redis/redis-server.log`
4. Verify admin token is correct

### Problem: Cache clears but data unchanged

**Likely Causes:**
1. Browser cache - Hard refresh (Ctrl+Shift+R)
2. CDN cache - Wait 5-10 minutes or purge CDN
3. Database not updated - Verify DB change succeeded
4. Wrong pattern - Check which keys were cleared

## Quick Commands

```bash
# Check all IPO cache keys
redis-cli --scan --pattern "ipo:*" | wc -l

# Delete protection caches manually
redis-cli --scan --pattern "protection:*" | xargs redis-cli del

# Get memory usage
redis-cli info memory | grep used_memory_human

# Monitor cache operations in real-time
redis-cli monitor

# Count keys by pattern
redis-cli --scan --pattern "ipo:*" --count 1000 | wc -l
```

## Support

- **Documentation:** `docs/00-admin/CACHE_MANAGEMENT.md`
- **Issues:** Contact backend team
- **Monitoring:** Check `/api/health-detailed` for cache health
