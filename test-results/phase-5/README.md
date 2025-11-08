# Phase 5: Logging & Monitoring Testing

**Enhancement #25 - Logging & Monitoring Validation**

---

## 📁 Files in this Directory

| File | Description | Status |
|------|-------------|--------|
| `logging-monitoring-tests.md` | **Complete test results** (10,000+ lines) | ✅ Complete |
| `logging-monitoring-summary.md` | **Executive summary** with action items | ✅ Complete |
| `setup-log-rotation.sh` | **Bash script** to configure log rotation | ✅ Complete |
| `setup-log-rotation.ps1` | **PowerShell script** for Windows | ✅ Complete |
| `load-test.js` | Load testing script (Artillery) | ✅ Existing |
| `run-load-test.sh` | Load test runner | ✅ Existing |

---

## 🎯 Quick Start

### 1. Read the Results

**Start here:**
```bash
# Executive summary (5 min read)
cat logging-monitoring-summary.md

# Full detailed report (30 min read)
cat logging-monitoring-tests.md
```

### 2. Fix Critical Issues

**CRITICAL - Do this today (15 minutes):**

**Linux/Mac:**
```bash
chmod +x setup-log-rotation.sh
./setup-log-rotation.sh
```

**Windows:**
```powershell
.\setup-log-rotation.ps1
```

**Manual alternative:**
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD
pm2 save
```

### 3. Verify Logging Works

**Test all logging components:**

```bash
# 1. Test logger endpoint
curl http://localhost:3000/api/test-logger

# 2. Test health endpoint
curl http://localhost:3000/api/health | jq

# 3. Test API logging
curl "http://localhost:3000/api/ipos?status=OPEN&segment=MAINBOARD"

# 4. Check logs
pm2 logs ipodhan-web --lines 50
```

---

## 📊 Test Results Summary

### Overall Status: ✅ 85% Implemented

| Component | Status | Priority |
|-----------|--------|----------|
| **Pino Logger** | ✅ Implemented | - |
| **API Logging** | ✅ 90% Coverage | MEDIUM |
| **Cache Logging** | ✅ 100% Coverage | - |
| **Error Logging** | ✅ 95% Coverage | MEDIUM |
| **Log Rotation** | ❌ Missing | 🚨 CRITICAL |
| **Query Logging** | ❌ Not Active | HIGH |
| **Metrics** | ❌ Missing | MEDIUM |
| **Scraper Logs** | ⚠️ Partial | LOW |

---

## 🚨 Critical Action Items

### 1. Configure Log Rotation (15 min) - DO TODAY

**Why:** Without rotation, log files will grow indefinitely and fill disk space.

**Solution:**
```bash
# Run the setup script
./setup-log-rotation.sh   # Linux/Mac
# OR
.\setup-log-rotation.ps1  # Windows
```

**Verify:**
```bash
pm2 conf pm2-logrotate
```

---

### 2. Activate Database Query Logging (2-4 hours) - DO THIS WEEK

**Why:** `BaseRepository.executeQuery()` exists but is NOT used. No query performance visibility.

**Current Code (web/lib/repositories/ipo-repository.ts):**
```typescript
// ❌ Direct query - NO logging
const results = await this.db
  .select()
  .from(ipos)
  .where(eq(ipos.slug, slug))
  .limit(1);
```

**Fixed Code:**
```typescript
// ✅ Wrapped in executeQuery() - automatic logging
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

**Also Add:** Slow query warning (>100ms) in `base-repository.ts`:

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

    // ADD THIS
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

---

### 3. Add Metrics Tracking (2 hours) - DO THIS MONTH

**Why:** No visibility into request volume, error rates, cache performance.

**Create:** `web/lib/metrics/index.ts`

See full implementation in `logging-monitoring-summary.md` section 5.

**Update:** `web/app/api/health/route.ts` to expose metrics:

```typescript
import { metricsStore } from '@/lib/metrics';

// Add to response
{
  status: 'healthy',
  // ... existing fields ...
  metrics: metricsStore.getMetrics()
}
```

**Result:**
```json
{
  "status": "healthy",
  "metrics": {
    "uptime": 3600,
    "total_requests": 12450,
    "error_rate_percent": "0.5",
    "cache_hit_rate_percent": "82.3",
    "avg_response_time_ms": "120"
  }
}
```

---

## 📋 Testing Checklist

Use this to verify logging after fixes:

### API Request Logging
- [ ] Request logged with request ID
- [ ] Response logged with duration
- [ ] Error logged with stack trace
- [ ] Pino logger used (not console.log)

### Cache Logging
- [ ] Cache MISS logged
- [ ] Cache HIT logged
- [ ] Cache SET logged with TTL
- [ ] Cache errors logged

### Database Query Logging (After Fix)
- [ ] Query logged with name
- [ ] Duration tracked
- [ ] Slow queries warned (>100ms)
- [ ] Failed queries logged with error

### Log Rotation
- [ ] PM2 logrotate installed
- [ ] Max size configured (10MB)
- [ ] Retention configured (30 files)
- [ ] Compression enabled
- [ ] Rotated files exist (*.gz)

### Health Check
- [ ] Database status checked
- [ ] Redis status checked
- [ ] Metrics exposed (after fix)
- [ ] Uptime tracked (after fix)

---

## 🔍 Log Analysis Commands

### View Logs

```bash
# Real-time logs
pm2 logs ipodhan-web

# Last 100 lines
pm2 logs ipodhan-web --lines 100

# Specific log file
tail -f logs/web-out.log

# JSON formatted
pm2 logs ipodhan-web --json
```

### Search Logs

```bash
# Find errors
pm2 logs ipodhan-web --lines 1000 | grep '"level":"error"'

# Find slow requests (>500ms)
grep -E '"duration":[5-9][0-9]{2}|"duration":[0-9]{4}' logs/web-out.log

# Find most common errors
pm2 logs ipodhan-web --lines 10000 | \
  grep '"level":"error"' | \
  jq -r '.msg' | \
  sort | uniq -c | sort -rn | head -10
```

### Calculate Metrics

```bash
# Cache hit rate
HITS=$(pm2 logs ipodhan-web --lines 1000 | grep -c '\[Cache\] HIT')
MISSES=$(pm2 logs ipodhan-web --lines 1000 | grep -c '\[Cache\] MISS')
echo "Cache Hit Rate: $(($HITS * 100 / ($HITS + $MISSES)))%"

# Error rate
ERRORS=$(pm2 logs ipodhan-web --lines 1000 | grep -c '"level":"error"')
REQUESTS=$(pm2 logs ipodhan-web --lines 1000 | grep -c 'Processing IPO')
echo "Error Rate: $(($ERRORS * 100 / $REQUESTS))%"
```

---

## 📚 Additional Documentation

### Architecture Documents

- **Caching Strategy:** `docs/05-caching/CACHING_STRATEGY.md`
- **Backend Architecture:** `docs/02-architecture/backend-architecture.md`
- **Testing Strategy:** `docs/02-architecture/testing-strategy.md`

### Code Locations

**Logging:**
- Logger config: `web/lib/logger.ts`
- Base repository: `web/lib/repositories/base-repository.ts`
- Redis client: `web/lib/cache/redis-client.ts`

**API Routes:**
- `/api/health` - Health check endpoint
- `/api/test-logger` - Logger testing endpoint
- `/api/ipos` - IPO list (with logging)
- `/api/ipos/[slug]` - IPO detail (with logging)

**Configuration:**
- PM2 config: `ecosystem.config.js`
- Environment: `.env.local`

---

## 🎓 Learn More

### Pino Logger

- **Documentation:** https://getpino.io
- **Performance:** 30% faster than Winston, 10% faster than Bunyan
- **Size:** 9KB gzipped (vs Winston 40KB)
- **Features:** Structured JSON, child loggers, log levels, formatters

### PM2 Logrotate

- **Documentation:** https://github.com/keymetrics/pm2-logrotate
- **Features:** Size-based rotation, time-based rotation, compression
- **Configuration:** `pm2 conf pm2-logrotate`

### Sentry

- **Documentation:** https://docs.sentry.io/platforms/javascript/guides/nextjs/
- **Package:** @sentry/nextjs v10.17.0
- **Features:** Error tracking, performance monitoring, session replay

---

## 🐛 Troubleshooting

### Logs not appearing

**Problem:** No logs in console or files

**Solution:**
```bash
# Check PM2 status
pm2 status

# Check log files exist
ls -lh logs/

# Check LOG_LEVEL environment variable
echo $LOG_LEVEL

# Set to debug for more logs
export LOG_LEVEL=debug
pm2 restart all
```

### Log rotation not working

**Problem:** Log files growing too large

**Solution:**
```bash
# Check if pm2-logrotate is installed
pm2 list | grep logrotate

# Reinstall if missing
pm2 uninstall pm2-logrotate
pm2 install pm2-logrotate

# Reconfigure
./setup-log-rotation.sh
```

### Database connection failed

**Problem:** Cannot query scraper_logs table

**Solution:**
```bash
# Check connection
psql -h 103.118.16.189 -U postgres -d ipodhan -c "SELECT 1;"

# Check firewall
ping 103.118.16.189

# Check credentials in .env.local
cat .env.local | grep DATABASE
```

---

## 📝 Next Steps

### Immediate (This Week)
1. ✅ Read test results
2. ✅ Configure log rotation
3. ⬜ Activate query logging
4. ⬜ Add slow query warnings

### Short-term (This Month)
5. ⬜ Add metrics tracking
6. ⬜ Standardize API logging
7. ⬜ Configure Sentry properly
8. ⬜ Set up external monitoring

### Long-term (Next Quarter)
9. ⬜ Centralized log aggregation (Loki)
10. ⬜ Monitoring dashboards (Grafana)
11. ⬜ Automated alerting
12. ⬜ Performance profiling

---

## 🤝 Contributing

When adding new features, follow these logging patterns:

### API Routes

```typescript
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const requestId = generateRequestId();
  const startTime = Date.now();
  const requestLogger = logger.child({ requestId });

  try {
    requestLogger.info({ params }, 'Processing request');

    // ... your code ...

    const duration = Date.now() - startTime;
    requestLogger.info({ duration, resultCount }, 'Request successful');

    return NextResponse.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ error, duration }, 'Request failed');
    throw error;
  }
}
```

### Repository Methods

```typescript
async findBySlug(slug: string): Promise<IPO | null> {
  return this.executeQuery(
    'findBySlug',  // Query name for logging
    async () => {
      // Your Drizzle query here
      return this.db.select().from(ipos).where(eq(ipos.slug, slug)).limit(1);
    },
    { slug }  // Context for logging
  );
}
```

---

## 📞 Support

If you need help with logging or monitoring:

1. Check test results: `logging-monitoring-tests.md`
2. Check summary: `logging-monitoring-summary.md`
3. Check architecture docs: `docs/02-architecture/`
4. Review code examples above
5. Ask in team chat

---

**Document Version:** 1.0
**Last Updated:** 2025-10-21
**Test Status:** ✅ Complete (85% passing)
**Next Review:** After implementing action items
