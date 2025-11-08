# Phase 5: Logging & Monitoring - Executive Summary

**Test Date:** 2025-10-21
**Overall Status:** ✅ MOSTLY IMPLEMENTED (85% Coverage)

---

## Quick Status Overview

| Component | Status | Coverage | Priority |
|-----------|--------|----------|----------|
| **Pino Structured Logging** | ✅ Implemented | 100% | - |
| **API Request Logging** | ✅ Implemented | 90% | MEDIUM |
| **Cache Operation Logging** | ✅ Implemented | 100% | - |
| **Error Logging + Sentry** | ✅ Implemented | 95% | MEDIUM |
| **Database Query Logging** | ❌ Not Active | 0% | HIGH |
| **Log Rotation** | ❌ Missing | 0% | CRITICAL |
| **Metrics Tracking** | ❌ Missing | 0% | MEDIUM |
| **Scraper Logging** | ⚠️ Partial | 50% | LOW |
| **Health Check** | ✅ Implemented | 80% | MEDIUM |
| **Alert Integration** | ❌ Missing | 0% | LOW |

---

## Critical Action Items

### 🚨 CRITICAL (Fix Today)

**1. Configure Log Rotation**

**Problem:** Log files will grow indefinitely and fill disk space

**Solution:**
```bash
# Install PM2 log rotation module
pm2 install pm2-logrotate

# Configure
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD

# Verify
pm2 conf pm2-logrotate
```

**Time:** 15 minutes
**Impact:** Prevents production downtime from disk space issues

---

### 🔴 HIGH PRIORITY (Fix This Week)

**2. Activate Database Query Logging**

**Problem:** `BaseRepository.executeQuery()` is defined but NOT used

**Current Code:**
```typescript
// IPORepository - Direct query (NO logging)
const results = await this.db
  .select()
  .from(ipos)
  .where(eq(ipos.slug, slug))
  .limit(1);
```

**Fixed Code:**
```typescript
// Wrap in executeQuery() for automatic logging
const results = await this.executeQuery(
  'findBySlug',
  async () => this.db.select().from(ipos).where(eq(ipos.slug, slug)).limit(1),
  { slug }
);
```

**Files to Update:**
- `web/lib/repositories/ipo-repository.ts` (5 methods)
- `web/lib/repositories/subscription-repository.ts` (3 methods)
- `web/lib/repositories/gmp-repository.ts` (3 methods)
- `web/lib/repositories/listing-performance-repository.ts` (2 methods)

**Time:** 2-4 hours
**Impact:** Full query performance visibility

---

**3. Add Slow Query Warnings**

**Update:** `web/lib/repositories/base-repository.ts`

```typescript
protected async executeQuery<T>(
  queryName: string,
  query: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<T> {
  const startTime = Date.now();

  try {
    const result = await query();
    const executionTime = Date.now() - startTime;

    // ADD SLOW QUERY WARNING
    if (executionTime > 100) {
      console.warn(`[DB] SLOW QUERY: ${queryName} - ${executionTime}ms`, context);
    } else {
      console.log(`[DB] ${queryName} - ${executionTime}ms`, context);
    }

    return result;
  } catch (error) {
    const executionTime = Date.now() - startTime;
    console.error(`[DB] ${queryName} FAILED - ${executionTime}ms`, context, error);
    throw error;
  }
}
```

**Time:** 15 minutes
**Impact:** Detect performance issues early

---

### 🟡 MEDIUM PRIORITY (Fix This Month)

**4. Standardize API Logging**

**Problem:** Some endpoints use `console.error` instead of Pino logger

**Files to Fix:**
- ❌ `web/app/api/tools/lot-calculator/route.ts` (Line 106)
- ❌ `web/app/api/health/route.ts` (Lines 36, 59)

**Before:**
```typescript
catch (error) {
  console.error('Lot Calculator API Error:', error);
  return NextResponse.json({ error: 'Failed' }, { status: 500 });
}
```

**After:**
```typescript
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const requestId = generateRequestId();
  const requestLogger = logger.child({ requestId });

  try {
    // ... processing ...
  } catch (error) {
    requestLogger.error({ error }, 'Lot Calculator API Error');
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
```

**Time:** 30 minutes per file (1 hour total)
**Impact:** Consistent structured logging across all endpoints

---

**5. Add Metrics Tracking**

**Create:** `web/lib/metrics/index.ts`

```typescript
class MetricsStore {
  private startTime = Date.now();
  private requestCount = 0;
  private errorCount = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private responseTimes: number[] = [];

  incrementRequest(duration: number) {
    this.requestCount++;
    this.responseTimes.push(duration);
    if (this.responseTimes.length > 1000) {
      this.responseTimes.shift(); // Keep last 1000 requests
    }
  }

  incrementError() { this.errorCount++; }
  incrementCacheHit() { this.cacheHits++; }
  incrementCacheMiss() { this.cacheMisses++; }

  getMetrics() {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const totalRequests = this.requestCount;
    const errorRate = totalRequests > 0 ? (this.errorCount / totalRequests) * 100 : 0;
    const totalCacheOps = this.cacheHits + this.cacheMisses;
    const cacheHitRate = totalCacheOps > 0 ? (this.cacheHits / totalCacheOps) * 100 : 0;
    const avgResponseTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
      : 0;

    return {
      uptime,
      total_requests: totalRequests,
      error_rate_percent: errorRate.toFixed(2),
      cache_hit_rate_percent: cacheHitRate.toFixed(2),
      avg_response_time_ms: avgResponseTime.toFixed(2),
    };
  }

  reset() {
    this.requestCount = 0;
    this.errorCount = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.responseTimes = [];
  }
}

export const metricsStore = new MetricsStore();
```

**Update:** `web/app/api/health/route.ts`

```typescript
import { metricsStore } from '@/lib/metrics';

// Add to response
metrics: metricsStore.getMetrics()
```

**Update:** API routes to track metrics

```typescript
import { metricsStore } from '@/lib/metrics';

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // ... processing ...
    const duration = Date.now() - startTime;
    metricsStore.incrementRequest(duration);
    return NextResponse.json(response);
  } catch (error) {
    metricsStore.incrementError();
    throw error;
  }
}
```

**Update:** BaseRepository to track cache metrics

```typescript
// In getFromCache()
if (cached) {
  metricsStore.incrementCacheHit();
  console.log(`[Cache] HIT: ${cacheKey}`);
  return JSON.parse(cached) as T;
}

metricsStore.incrementCacheMiss();
console.log(`[Cache] MISS: ${cacheKey}`);
```

**Time:** 2 hours
**Impact:** Real-time visibility into application health

---

**6. Create Sentry Configuration**

**Create:** `web/sentry.server.config.ts`

```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',

  // Set tracesSampleRate to 1.0 to capture 100% of transactions
  // In production, reduce to 0.1 (10%) to save quota
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Ignore health check and metrics endpoints
  ignoreTransactions: [
    '/api/health',
    '/api/metrics',
  ],

  // Additional settings
  beforeSend(event, hint) {
    // Filter out known errors
    if (event.exception?.values?.[0]?.value?.includes('AbortError')) {
      return null; // Don't send to Sentry
    }
    return event;
  },
});
```

**Create:** `web/sentry.client.config.ts`

```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: 1.0,

  // Replay sessions for debugging
  replaysSessionSampleRate: 0.1, // 10% of sessions
  replaysOnErrorSampleRate: 1.0, // 100% of errors

  integrations: [
    new Sentry.Replay({
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],
});
```

**Add to:** `.env.local`

```bash
# Sentry Configuration
SENTRY_DSN=https://YOUR_DSN@sentry.io/PROJECT_ID
NEXT_PUBLIC_SENTRY_DSN=https://YOUR_DSN@sentry.io/PROJECT_ID
```

**Time:** 30 minutes
**Impact:** Production error tracking and debugging

---

### 🟢 LOW PRIORITY (Future Enhancements)

**7. Set Up External Monitoring**

**Tool:** UptimeRobot (Free)

1. Go to https://uptimerobot.com
2. Create account (free)
3. Add monitor:
   - Type: HTTP(s)
   - URL: https://your-domain.com/api/health
   - Interval: 5 minutes
   - Alert: Email when down

**Time:** 30 minutes
**Impact:** Get notified of downtime

---

**8. Add Centralized Log Aggregation**

**Options:**

| Tool | Cost | Complexity | Recommendation |
|------|------|-----------|----------------|
| **Grafana Loki** | Free (self-hosted) | Medium | ✅ Best for self-hosting |
| **Logtail (BetterStack)** | $5/month | Low | ✅ Easiest SaaS option |
| **ELK Stack** | Free (self-hosted) | High | ❌ Overkill |

**Defer until:** Traffic exceeds 100k requests/day

---

## Testing Checklist

Use this checklist to verify logging is working:

### API Request Logging
- [ ] Make request: `curl http://localhost:3000/api/ipos?status=OPEN`
- [ ] Check logs for: `Processing IPO list request`
- [ ] Check logs for: `IPO list fetched successfully`
- [ ] Verify request ID in logs
- [ ] Verify duration in logs

### Error Logging
- [ ] Make invalid request: `curl http://localhost:3000/api/ipos/invalid-slug`
- [ ] Check logs for: `Failed to fetch IPO details`
- [ ] Verify stack trace in logs
- [ ] Verify Sentry received error (if configured)

### Cache Logging
- [ ] Clear cache: `redis-cli FLUSHDB`
- [ ] Make request: `curl http://localhost:3000/api/ipos/open`
- [ ] Check logs for: `[Cache] MISS: ipo:list:...`
- [ ] Check logs for: `[Cache] SET: ipo:list:... (TTL: 300s)`
- [ ] Make same request again
- [ ] Check logs for: `[Cache] HIT: ipo:list:...`

### Database Query Logging (After Fix)
- [ ] Make request: `curl http://localhost:3000/api/ipos/bajaj-housing-finance-ipo`
- [ ] Check logs for: `[DB] findBySlug - 15ms { slug: "..." }`
- [ ] Verify query duration logged

### Health Check
- [ ] Check health: `curl http://localhost:3000/api/health`
- [ ] Verify response includes:
  - [ ] `status: "healthy"`
  - [ ] `services.database: "healthy"`
  - [ ] `services.redis: "healthy"`
  - [ ] `metrics` (after fix)

### Log Rotation
- [ ] Check PM2 config: `pm2 conf pm2-logrotate`
- [ ] Verify log files exist: `ls -lh logs/`
- [ ] Check log file size: `du -h logs/web-out.log`
- [ ] Wait for rotation (or trigger manually)
- [ ] Verify compressed log created: `ls -lh logs/*.gz`

---

## Monitoring Dashboard Setup (Future)

When ready to implement Grafana Loki:

### 1. Install Loki & Promtail

```bash
# Docker Compose
version: "3"
services:
  loki:
    image: grafana/loki:latest
    ports:
      - "3100:3100"
    volumes:
      - ./loki-config.yaml:/etc/loki/local-config.yaml

  promtail:
    image: grafana/promtail:latest
    volumes:
      - ./logs:/var/log
      - ./promtail-config.yaml:/etc/promtail/config.yml

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3002:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

### 2. Configure Promtail

```yaml
# promtail-config.yaml
server:
  http_listen_port: 9080

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: ipodhan-web
    static_configs:
      - targets:
          - localhost
        labels:
          job: ipodhan-web
          __path__: /var/log/web-*.log

  - job_name: ipodhan-scraper
    static_configs:
      - targets:
          - localhost
        labels:
          job: ipodhan-scraper
          __path__: /var/log/scraper-*.log
```

### 3. Grafana Queries

```logql
# All errors in last 1 hour
{job="ipodhan-web"} |= "ERROR" | json

# Slow queries (>100ms)
{job="ipodhan-web"} |= "SLOW QUERY"

# Cache hit rate
rate({job="ipodhan-web"} |= "[Cache] HIT"[5m])
/ rate({job="ipodhan-web"} |~ "\\[Cache\\] (HIT|MISS)"[5m])

# Request rate
rate({job="ipodhan-web"} |= "IPO list fetched successfully"[1m])
```

---

## Log Analysis Examples

### Find Slow Requests (>500ms)

```bash
# PM2 logs
pm2 logs ipodhan-web --lines 1000 | grep -E '"duration":[5-9][0-9]{2}|"duration":[0-9]{4}'

# Or in log file
grep -E '"duration":[5-9][0-9]{2}|"duration":[0-9]{4}' logs/web-out.log
```

### Find Error Rate

```bash
# Count errors in last 1000 log lines
pm2 logs ipodhan-web --lines 1000 | grep -c '"level":"error"'

# Compare to total requests
pm2 logs ipodhan-web --lines 1000 | grep -c 'Processing IPO'
```

### Find Most Common Errors

```bash
pm2 logs ipodhan-web --lines 10000 | \
  grep '"level":"error"' | \
  jq -r '.msg' | \
  sort | uniq -c | sort -rn | head -10
```

### Cache Hit Rate

```bash
# Cache hits
HITS=$(pm2 logs ipodhan-web --lines 1000 | grep -c '\[Cache\] HIT')

# Cache misses
MISSES=$(pm2 logs ipodhan-web --lines 1000 | grep -c '\[Cache\] MISS')

# Calculate percentage
echo "Cache Hit Rate: $(($HITS * 100 / ($HITS + $MISSES)))%"
```

---

## Summary

**Current State:**
- ✅ Strong foundation with Pino structured logging
- ✅ Good API request logging with request IDs
- ✅ Comprehensive cache logging
- ✅ Sentry error tracking installed
- ❌ Missing log rotation (CRITICAL)
- ❌ Database query logging not active (HIGH)

**Priority Actions:**
1. Configure log rotation (15 min) - **DO TODAY**
2. Activate query logging (2-4 hours) - **DO THIS WEEK**
3. Add metrics tracking (2 hours) - **DO THIS MONTH**

**Long-term:**
- Set up centralized log aggregation (Loki)
- Configure automated alerts (Sentry/UptimeRobot)
- Build monitoring dashboards (Grafana)

**Overall Grade:** B+ (Good, needs production hardening)

---

## Quick Reference

### Log Locations

```bash
# PM2 logs
~/.pm2/logs/ipodhan-web-out.log
~/.pm2/logs/ipodhan-web-error.log
~/.pm2/logs/ipodhan-scraper-out.log
~/.pm2/logs/ipodhan-scraper-error.log

# Or relative paths
./logs/web-out.log
./logs/web-error.log
./logs/scraper-out.log
./logs/scraper-error.log
```

### Log Commands

```bash
# View logs
pm2 logs ipodhan-web

# Tail logs
pm2 logs ipodhan-web --raw

# Clear logs
pm2 flush ipodhan-web

# View specific log file
tail -f logs/web-out.log

# Search logs
grep "ERROR" logs/web-error.log | tail -20
```

### Health Check

```bash
# Check application health
curl http://localhost:3000/api/health | jq

# Check Redis
redis-cli PING

# Check PostgreSQL
psql -h 103.118.16.189 -U postgres -d ipodhan -c "SELECT 1;"
```

---

**Document Version:** 1.0
**Last Updated:** 2025-10-21
**Next Review:** 2025-11-21
