# Performance & Monitoring Expert

**Purpose:** This skill provides expertise in performance optimization, monitoring, observability, and production readiness for IPODhan. It covers performance targets, APM setup, logging strategies, and load testing.

**When to invoke:** Use this skill when optimizing performance, setting up monitoring, analyzing bottlenecks, preparing for production, or debugging performance issues.

---

## Performance Targets

IPODhan has strict performance requirements to ensure good user experience.

### API Response Times

**Target:** p95 < 500ms, p99 < 1000ms

```
p50 (median):     < 200ms   ✅ Excellent
p75:              < 300ms   ✅ Good
p95:              < 500ms   ⚠️ Maximum acceptable
p99:              < 1000ms  ⚠️ Maximum acceptable
```

**Measurement:**
- Use Sentry APM for production
- Local testing with `console.time()` / `console.timeEnd()`
- Load testing with k6

### Database Query Performance

**Target:** p95 < 100ms

```
Simple queries (by ID):     < 20ms    ✅ Excellent
Indexed queries (by slug):  < 50ms    ✅ Good
List queries (filtered):    < 100ms   ⚠️ Maximum
Complex joins:              < 150ms   🟡 Needs optimization
```

**46 Strategic Indexes** in schema ensure query performance.

### Cache Performance

**Target:** >80% hit rate on hot paths

```
Cache Hit:        < 35ms     ✅ Fast
Cache Miss:       < 150ms    (DB query time)
Cache Write:      < 10ms     ✅ Fast
```

**Hot Paths:**
- IPO detail pages (by slug)
- IPO list pages (filtered)
- Subscription data (real-time)
- GMP data (frequently updated)

### Core Web Vitals

**Target for SEO and UX:**

```
LCP (Largest Contentful Paint):  < 2.5s   ✅ Good
FID (First Input Delay):          < 100ms  ✅ Good
CLS (Cumulative Layout Shift):    < 0.1    ✅ Good
TTFB (Time to First Byte):        < 600ms  ✅ Good
```

**Measured with:**
- Lighthouse CI in GitHub Actions
- Real User Monitoring (RUM) in production
- Chrome DevTools Performance tab

### Load Testing Benchmarks

**Tested with k6, production-like environment:**

```
100 concurrent users:    p95 300ms   ✅ Excellent
500 concurrent users:    p95 480ms   ✅ Good
1000 concurrent users:   p95 650ms   🟡 Degraded
1200-1500 users:         Breaking point (DB connection pool limit)
```

**Database Connection Pool:**
- **Current:** 50 connections
- **Capacity:** ~2500 concurrent users (theoretical max)
- **Improvement:** 3.1x capacity vs original 20 connections

---

## APM Stack (Application Performance Monitoring)

### Sentry Configuration

**Location:** `web/lib/monitoring/sentry-utils.ts`

**Setup:**
```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1, // 10% of transactions

  // Performance monitoring
  integrations: [
    new Sentry.BrowserTracing({
      tracePropagationTargets: ['localhost', 'ipodhan.com'],
    }),
  ],

  // Filter sensitive data
  beforeSend(event) {
    // Remove sensitive headers
    if (event.request) {
      delete event.request.cookies;
      delete event.request.headers?.authorization;
    }
    return event;
  },
});
```

**Tracking Performance:**
```typescript
import { trackPerformance } from '@/lib/monitoring/sentry-utils';

// Wrap async operations
const result = await trackPerformance(
  'api-ipos-get',
  async () => {
    return await ipoRepository.findAll();
  },
  { endpoint: '/api/ipos', segment: 'MAINBOARD' }
);
```

**Capturing Errors:**
```typescript
import { captureAPIError } from '@/lib/monitoring/sentry-utils';

try {
  await riskyOperation();
} catch (error) {
  captureAPIError(error, {
    endpoint: '/api/ipos',
    method: 'GET',
    params: { segment: 'MAINBOARD' }
  });

  throw error; // Re-throw after capturing
}
```

### OpenTelemetry Integration

**Location:** `web/lib/monitoring/instrumentation.ts`

**Auto-instrumentation:**
```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

const sdk = new NodeSDK({
  // Automatic instrumentation for HTTP, DB, Redis
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        enabled: true,
      },
      '@opentelemetry/instrumentation-pg': {
        enabled: true,
      },
      '@opentelemetry/instrumentation-redis': {
        enabled: true,
      },
    }),
  ],

  // Export metrics to Prometheus
  metricReader: new PrometheusExporter({
    port: 9464, // Prometheus scrapes this port
  }),
});

sdk.start();
```

**Metrics Exposed:**
- HTTP request duration
- HTTP request rate
- Database query duration
- Redis operation duration
- Connection pool stats

**Prometheus Endpoint:** `http://localhost:9464/metrics`

---

## Structured Logging with Winston

**Location:** `web/lib/logging/logger.ts`

### Log Levels

```typescript
import { logger } from '@/lib/logging/logger';

// ERROR - Errors requiring immediate attention
logger.error('Failed to fetch IPO', { slug, error: error.message });

// WARN - Potential issues, degraded performance
logger.warn('Cache miss rate high', { hitRate: 0.65 });

// INFO - Important events, business logic
logger.info('IPO created', { ipoId, companyName });

// DEBUG - Detailed debugging info (dev only)
logger.debug('Query executed', { query, duration: 145 });
```

### Log Rotation

**Configuration:**
```typescript
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    // Console (always)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),

    // Application logs (14 day retention)
    new DailyRotateFile({
      filename: 'logs/application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      level: 'info',
    }),

    // Error logs (30 day retention)
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error',
    }),

    // Performance logs (7 day retention)
    new DailyRotateFile({
      filename: 'logs/performance-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '7d',
      level: 'info',
    }),
  ],
});
```

**Log File Locations:**
```
web/logs/
├── application-2025-01-15.log
├── error-2025-01-15.log
└── performance-2025-01-15.log
```

### Performance Logging

```typescript
import { logPerformance } from '@/lib/logging/logger';

const start = Date.now();

// ... operation ...

const duration = Date.now() - start;

logPerformance('db.findBySlug', duration, {
  table: 'ipos',
  slug: 'xyz-corp-ipo',
  cacheHit: false
});
```

**Log Output:**
```json
{
  "level": "info",
  "message": "Performance: db.findBySlug",
  "duration": 145,
  "context": {
    "table": "ipos",
    "slug": "xyz-corp-ipo",
    "cacheHit": false
  },
  "timestamp": "2025-01-15T10:30:45.123Z"
}
```

---

## 6 Monitoring Layers

IPODhan implements comprehensive monitoring across 6 layers:

### Layer 1: Application Metrics

**Metrics:**
- Request rate (requests/second)
- Response time (p50, p95, p99)
- Error rate (%)
- Success rate (%)
- Active requests (gauge)

**Tools:**
- Sentry APM (transactions)
- OpenTelemetry HTTP instrumentation
- Custom middleware for timing

**Alerts:**
- Error rate >5% (WARNING)
- Error rate >10% (CRITICAL)
- p95 response time >500ms (WARNING)
- p99 response time >1000ms (CRITICAL)

### Layer 2: Database Metrics

**Metrics:**
- Query duration (p50, p95, p99)
- Query count per minute
- Connection pool usage
- Cache hit ratio
- Slow queries (>100ms)

**Tools:**
- OpenTelemetry pg instrumentation
- PostgreSQL pg_stat_statements
- Custom query logging in BaseRepository

**Alerts:**
- >10 slow queries in 5 minutes (WARNING)
- Connection pool >80% (WARNING)
- Connection pool >95% (CRITICAL)
- Cache hit rate <70% (WARNING)

### Layer 3: Cache Metrics

**Metrics:**
- Cache hit rate (%)
- Cache miss rate (%)
- Cache write rate
- Cache eviction rate
- Redis memory usage

**Tools:**
- OpenTelemetry redis instrumentation
- Redis INFO command
- Custom tracking in BaseRepository

**Alerts:**
- Hit rate <80% (WARNING)
- Hit rate <60% (CRITICAL)
- Memory usage >80% (WARNING)
- Memory usage >90% (CRITICAL)

### Layer 4: System Metrics

**Metrics:**
- CPU usage (%)
- Memory usage (%)
- Disk I/O (read/write MB/s)
- Network I/O (MB/s)
- Disk space available

**Tools:**
- Windows Performance Monitor (VPS)
- PM2 monitoring (`pm2 monit`)
- Node.js process metrics

**Alerts:**
- CPU >80% for 5 minutes (WARNING)
- Memory >85% (WARNING)
- Disk space <10% (CRITICAL)

### Layer 5: Business Metrics

**Metrics:**
- Active IPOs count
- IPO status distribution (OPEN, CLOSED, LISTED)
- Data freshness (last scrape time)
- Scraper success rate (%)
- User engagement (page views, time on site)

**Tools:**
- Custom dashboard (`/api/metrics`)
- Scraper logs (`scraperLogs` table)
- Google Analytics

**Alerts:**
- No scraper run in 6 hours (WARNING)
- Scraper failure rate >20% (CRITICAL)
- Data freshness >12 hours (WARNING)

### Layer 6: Alert System

**Alert Levels:**

```typescript
enum AlertLevel {
  INFO = 'INFO',         // Informational, no action needed
  WARNING = 'WARNING',   // Attention needed, not urgent
  CRITICAL = 'CRITICAL', // Immediate action required
}
```

**Alert Channels:**
- Email (for CRITICAL alerts)
- Slack webhook (all alerts)
- Logs (all alerts)

**Example Alert:**
```typescript
import { sendAlert } from '@/lib/monitoring/alerts';

if (errorRate > 0.1) {
  await sendAlert({
    level: AlertLevel.CRITICAL,
    title: 'High Error Rate Detected',
    message: `Error rate is ${(errorRate * 100).toFixed(2)}% (threshold: 10%)`,
    context: {
      endpoint: '/api/ipos',
      errorCount: 150,
      totalRequests: 1500,
      timestamp: new Date()
    }
  });
}
```

---

## Health Check Endpoints

### Basic Health Check

**Endpoint:** `GET /api/health`

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:45.123Z",
  "uptime": 3600,
  "version": "1.0.0"
}
```

**Use Case:** Load balancer health check

### Detailed Health Check

**Endpoint:** `GET /api/health-detailed`

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:45.123Z",
  "services": {
    "database": {
      "status": "healthy",
      "responseTime": 12,
      "connections": 5,
      "maxConnections": 50
    },
    "redis": {
      "status": "healthy",
      "responseTime": 3,
      "memoryUsage": 45.2,
      "maxMemory": 100
    },
    "scraper": {
      "status": "healthy",
      "lastRun": "2025-01-15T09:00:00.000Z",
      "successRate": 95.5
    }
  }
}
```

**Use Case:** Monitoring dashboard, debugging

### Metrics Dashboard

**Endpoint:** `GET /api/metrics`

**Response:**
```json
{
  "application": {
    "requestRate": 125.5,
    "errorRate": 0.02,
    "avgResponseTime": 245,
    "p95ResponseTime": 480
  },
  "database": {
    "queryCount": 1250,
    "avgQueryTime": 45,
    "slowQueries": 3,
    "cacheHitRate": 0.85
  },
  "business": {
    "activeIPOs": 12,
    "openIPOs": 3,
    "todayListings": 2,
    "dataFreshness": 1800
  }
}
```

**Use Case:** Business monitoring, capacity planning

---

## Query Optimization

### Index Strategy

**46 indexes in schema** covering:
- Primary keys (automatic)
- Foreign keys (explicit, for JOINs)
- Frequently filtered columns (status, segment)
- Unique lookup columns (slug, isinNumber)
- Compound indexes for common filters

**Example:**
```typescript
export const ipos = pgTable('ipos', {
  // columns...
}, (table) => ({
  // Single-column indexes
  slugIdx: index('ipo_slug_idx').on(table.slug),
  statusIdx: index('ipo_status_idx').on(table.status),
  segmentIdx: index('ipo_segment_idx').on(table.segment),

  // Compound indexes for common queries
  segmentStatusIdx: index('ipo_segment_status_idx')
    .on(table.segment, table.status),

  // Partial index (only OPEN IPOs)
  openIposIdx: index('ipo_open_status_idx')
    .on(table.status)
    .where(sql`status = 'OPEN'`),
}));
```

### Query Analysis

**Use EXPLAIN ANALYZE:**
```sql
EXPLAIN ANALYZE
SELECT * FROM ipos
WHERE segment = 'MAINBOARD'
  AND status = 'OPEN'
ORDER BY open_date DESC
LIMIT 20;
```

**Look for:**
- `Seq Scan` (bad, no index used)
- `Index Scan` (good, using index)
- `cost=X..Y` (lower is better)
- `rows=N` (actual vs estimated)

**Slow Query Threshold:** >100ms

### N+1 Query Prevention

**❌ Bad (N+1 queries):**
```typescript
const ipos = await db.select().from(ipos).where(...);

for (const ipo of ipos) {
  // N queries (one per IPO)
  const subscriptions = await db.select()
    .from(subscriptions)
    .where(eq(subscriptions.ipoId, ipo.id));
}
```

**✅ Good (1 query with JOIN):**
```typescript
const iposWithSubscriptions = await db.select()
  .from(ipos)
  .leftJoin(subscriptions, eq(subscriptions.ipoId, ipos.id))
  .where(...);
```

---

## Load Testing with k6

**Location:** `web/tests/load/`

### Basic Load Test

```javascript
// load-test-basic.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 50 },   // Ramp up to 50 users
    { duration: '3m', target: 50 },   // Stay at 50 users
    { duration: '1m', target: 100 },  // Ramp up to 100 users
    { duration: '3m', target: 100 },  // Stay at 100 users
    { duration: '1m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests < 500ms
    http_req_failed: ['rate<0.05'],    // <5% failures
  },
};

export default function () {
  // Test homepage
  const home = http.get('http://localhost:3000/');
  check(home, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);

  // Test IPO list
  const ipos = http.get('http://localhost:3000/api/ipos?segment=MAINBOARD');
  check(ipos, {
    'status is 200': (r) => r.status === 200,
    'has data': (r) => JSON.parse(r.body).data.length > 0,
  });

  sleep(1);
}
```

**Run:**
```bash
k6 run tests/load/load-test-basic.js
```

### Spike Test

```javascript
export const options = {
  stages: [
    { duration: '10s', target: 500 },  // Sudden spike
    { duration: '1m', target: 500 },   // Hold
    { duration: '10s', target: 0 },    // Drop
  ],
};
```

### Stress Test (Find Breaking Point)

```javascript
export const options = {
  stages: [
    { duration: '2m', target: 500 },
    { duration: '2m', target: 1000 },
    { duration: '2m', target: 1500 },
    { duration: '2m', target: 2000 },
    { duration: '2m', target: 2500 },
  ],
};
```

**Breaking Point:** ~1200-1500 users (DB connection pool limit)

---

## Performance Optimization Checklist

### Database

- [ ] Indexes on all foreign keys
- [ ] Indexes on frequently filtered columns
- [ ] Compound indexes for common filter combinations
- [ ] Query duration monitored (<100ms target)
- [ ] N+1 queries eliminated
- [ ] Connection pool sized correctly (50 connections)

### Caching

- [ ] Cache-aside pattern implemented
- [ ] TTLs match data volatility
- [ ] Cache hit rate >80%
- [ ] Cache invalidation on mutations
- [ ] Graceful degradation if Redis down

### API Routes

- [ ] p95 response time <500ms
- [ ] Error rate <5%
- [ ] Proper error handling
- [ ] Request/response logging
- [ ] Rate limiting configured

### Frontend

- [ ] Server Components for static content
- [ ] Client Components only when necessary
- [ ] Image optimization (next/image)
- [ ] Code splitting (dynamic imports)
- [ ] LCP <2.5s
- [ ] FID <100ms
- [ ] CLS <0.1

### Monitoring

- [ ] Sentry APM configured
- [ ] OpenTelemetry instrumentation
- [ ] Winston logging with rotation
- [ ] Health check endpoints
- [ ] Alerts configured
- [ ] Metrics dashboard

---

## Production Readiness Checklist

**Score: 9.2/10** (with pre-launch fixes)

### Infrastructure

- [x] Database connection pool sized (50 connections)
- [x] Redis configured with retry logic
- [x] PM2 process manager setup
- [x] Log rotation configured
- [x] Health check endpoints

### Performance

- [x] p95 API response <500ms (tested)
- [x] Cache hit rate >80% (measured)
- [x] Load tested to 1000 users
- [x] Database queries optimized
- [x] No N+1 queries

### Monitoring

- [x] Sentry APM integrated
- [x] OpenTelemetry metrics
- [x] Winston structured logging
- [x] Alert system configured
- [x] Metrics dashboard

### Security

- [x] Environment variables secured
- [x] SQL injection prevention (parameterized)
- [x] XSS prevention (React escaping)
- [ ] Rate limiting (TODO: implement)
- [ ] HTTPS enforced (TODO: configure)

### Reliability

- [x] Error handling in all layers
- [x] Graceful degradation (Redis fallback)
- [x] Retry logic for external services
- [x] Transaction rollback on failure
- [x] Data validation (Zod schemas)

---

## References

- **Monitoring README:** `web/lib/monitoring/README.md`
- **Quick Start:** `web/lib/monitoring/QUICK_START.md`
- **Load Testing Report:** `test-results/phase-5/production-load-testing-report.md`
- **Integration Tests:** `test-results/phase-5/integration-testing-report.md`
- **Sentry Docs:** https://docs.sentry.io/
- **k6 Docs:** https://k6.io/docs/

---

**Note:** Performance monitoring is critical for production readiness. IPODhan targets enterprise-grade performance with <500ms API responses, >80% cache hit rates, and support for 1000+ concurrent users.
