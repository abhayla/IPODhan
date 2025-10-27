# Monitoring and Observability

**Single Source of Truth for Production Monitoring**
**Phase 5 Implementation**: Comprehensive observability system with 6 monitoring layers
**Status**: ✅ **Production-Ready** (Deployed 2025-10-21)

---

## Architecture Overview

IPODhan implements a **6-layer monitoring architecture** providing complete production observability:

```
┌─────────────────────────────────────────────────────┐
│  1. Application Metrics (Request/Response/Errors)   │
├─────────────────────────────────────────────────────┤
│  2. Database Metrics (Queries/Connections/Pool)     │
├─────────────────────────────────────────────────────┤
│  3. Cache Metrics (Hit Rate/Memory/Evictions)       │
├─────────────────────────────────────────────────────┤
│  4. System Metrics (CPU/Memory/Disk/Network)        │
├─────────────────────────────────────────────────────┤
│  5. Business Metrics (IPO Data/Scraper/Quality)     │
├─────────────────────────────────────────────────────┤
│  6. Alert System (6 automated rules: INFO/WARN/CRIT)│
└─────────────────────────────────────────────────────┘
```

---

## Monitoring Stack (Phase 5)

### Structured Logging - Winston 3.11+

**Purpose**: JSON-structured logs with daily rotation and automatic cleanup

**Key Features**:
- **JSON Format**: Structured logs for easy parsing and analysis
- **Daily Rotation**: Automatic file rotation at midnight with compression
- **Multi-Transport**: Console (dev), File (production), Error file (critical)
- **Retention Policy**: 14d app logs, 30d error logs, 7d performance logs
- **Performance**: <5ms overhead per log entry

**Log Files**:
```
logs/
├── app-%DATE%.log          # Application logs (14 days)
├── error-%DATE%.log        # Error logs (30 days)
└── performance-%DATE%.log  # Performance logs (7 days)
```

**Implementation**: `web/lib/logging/logger.ts`

```typescript
import { logger, logPerformance, logError } from '@/lib/logging/logger';

// Performance logging
logPerformance('db.findBySlug', duration, { table: 'ipos', slug });

// Error logging with context
logError(error, { endpoint: '/api/ipos', method: 'GET', userId: 'user-123' });

// Info logging
logger.info('IPO scraped successfully', { ipoId, companyName });
```

**Log Levels**:
- `error`: Critical errors requiring immediate attention
- `warn`: Warning conditions that should be reviewed
- `info`: Informational messages (default in production)
- `debug`: Debug information (development only)

### Application Performance Monitoring - OpenTelemetry + Sentry

**Purpose**: Real-time performance monitoring and error tracking

**Key Features**:
- **Request Tracing**: End-to-end request tracking with distributed tracing
- **Performance Metrics**: Response times, throughput, error rates
- **Error Capture**: Automatic error capture with stack traces and context
- **User Context**: Track errors by user, session, and environment
- **Release Tracking**: Version-based error monitoring

**Implementation**: `web/lib/monitoring/sentry-utils.ts`

```typescript
import { trackPerformance, captureAPIError } from '@/lib/monitoring/sentry-utils';

// Performance tracking
const result = await trackPerformance(
  'api-ipos-get',
  async () => await repository.findAll(),
  { endpoint: '/api/ipos', filters: 'status=OPEN' }
);

// Error capture with context
captureAPIError(error, {
  endpoint: '/api/ipos',
  method: 'GET',
  statusCode: 500,
  query: request.query
});
```

**Sentry Integration**:
- **Error Tracking**: Automatic capture of unhandled exceptions
- **Performance Monitoring**: Track API response times and database queries
- **Release Health**: Monitor error rates per deployment
- **Source Maps**: Uploaded for accurate stack traces
- **Environment Separation**: dev/staging/production environments

### Frontend Monitoring - Google Analytics 4

**Purpose**: User behavior tracking and Core Web Vitals monitoring

**Key Metrics**:
- **Core Web Vitals**: LCP, FID, CLS, TTFB
- **User Interactions**: Page views, button clicks, form submissions
- **Custom Events**: IPO views, searches, comparisons
- **User Demographics**: Location, device, browser

**Implementation**: `web/app/layout.tsx` with gtag.js

### Backend Monitoring - PM2 + Custom Scripts

**Purpose**: Process health monitoring and system metrics

**PM2 Features**:
- **Process Management**: Auto-restart on crashes
- **CPU/Memory Monitoring**: Real-time resource usage
- **Log Management**: Centralized log aggregation
- **Cluster Mode**: Multi-process load balancing

**Custom Monitoring Scripts**:
1. **Database Health**: `scripts/db-health-check.ts` (runs every 5 minutes)
2. **Redis Health**: `scripts/monitor-redis.ts` (runs every 2 minutes)
3. **DB Performance**: `scripts/monitor-db-performance.sql` (12 comprehensive queries)

---

## Monitoring Layers (Detailed)

### Layer 1: Application Metrics

**What We Monitor**:
- **Request Rate**: Requests per second (RPS)
- **Response Times**: p50, p95, p99 latencies
- **Error Rates**: 4xx and 5xx error percentages
- **Status Codes**: Distribution of HTTP status codes
- **Endpoint Usage**: Most/least used API endpoints

**Performance Targets**:
| Metric | Target (p95) | Alert Threshold |
|--------|--------------|-----------------|
| API Response Time | <500ms | >1000ms |
| Database Query | <100ms | >500ms |
| Cache Hit Time | <50ms | >200ms |

**Tools**: OpenTelemetry + Sentry APM

### Layer 2: Database Metrics

**What We Monitor**:
- **Query Performance**: Slow queries (>100ms)
- **Connection Pool**: Active, idle, waiting connections
- **Cache Hit Ratio**: PostgreSQL query cache efficiency
- **Table Sizes**: Database growth trends
- **Index Usage**: Index efficiency and missing indexes

**Health Check Script** (`scripts/db-health-check.ts`):
```bash
# Run manually
npx tsx scripts/db-health-check.ts

# Automated (cron)
*/5 * * * * npx tsx /path/to/scripts/db-health-check.ts >> /var/log/db-health.log
```

**Monitoring Queries** (`scripts/monitor-db-performance.sql`):
1. Active connections count
2. Long-running queries (>1s)
3. Cache hit ratio (target: >90%)
4. Table sizes and bloat
5. Index usage statistics
6. Locks and blocking queries
7. Replication lag (if applicable)
8. Database size and growth
9. Vacuum activity
10. Deadlocks
11. Sequential scans (inefficient queries)
12. Idle connections

**Performance Targets**:
| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Connection Pool Usage | <80% | >90% |
| Cache Hit Ratio | >90% | <80% |
| Query Duration (p95) | <100ms | >500ms |
| Long-Running Queries | 0 | >3 concurrent |

**Tools**: Custom monitoring scripts + Sentry DB integration

### Layer 3: Cache Metrics

**What We Monitor**:
- **Hit Rate**: Percentage of cache hits vs misses
- **Memory Usage**: Redis memory consumption
- **Eviction Rate**: Keys evicted due to memory pressure
- **Key Count**: Total keys in cache
- **Command Stats**: Most used Redis commands

**Redis Monitoring Script** (`scripts/monitor-redis.ts`):
```bash
# Run manually
npx tsx scripts/monitor-redis.ts

# Automated (cron)
*/2 * * * * npx tsx /path/to/scripts/monitor-redis.ts >> /var/log/redis-monitor.log
```

**Performance Targets**:
| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Cache Hit Rate | >80% | <60% |
| Memory Usage | <80% | >90% |
| Eviction Rate | <100/min | >1000/min |
| Response Time | <5ms | >50ms |

**Tools**: Redis INFO + ioredis client metrics

### Layer 4: System Metrics

**What We Monitor**:
- **CPU Usage**: Per-core and overall utilization
- **Memory Usage**: Used, free, cached memory
- **Disk I/O**: Read/write IOPS and throughput
- **Network I/O**: Bandwidth usage and packet loss
- **Process Count**: Running processes and threads

**Performance Targets**:
| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| CPU Usage | <60% | >80% |
| Memory Usage | <70% | >85% |
| Disk I/O Wait | <10% | >25% |
| Network Latency | <50ms | >200ms |

**Tools**: PM2 system metrics + OS monitoring

### Layer 5: Business Metrics

**What We Monitor**:
- **IPO Data Freshness**: Last scraper run timestamp
- **Stale IPOs**: IPOs not updated in >24 hours
- **Scraper Success Rate**: Percentage of successful scrapes
- **Data Quality**: Missing fields, invalid data
- **Subscription Rates**: Active vs stale subscriptions
- **GMP Updates**: Frequency and coverage

**Health Endpoint**: `GET /api/metrics`

**Response Example**:
```json
{
  "dataFreshness": {
    "lastScraperRun": "2025-10-27T10:30:00Z",
    "staleIPOs": 3,
    "oldestUpdate": "2025-10-26T08:00:00Z"
  },
  "dataQuality": {
    "totalIPOs": 45,
    "missingFinancials": 5,
    "missingGMP": 8
  },
  "scraperHealth": {
    "successRate": 95.2,
    "lastFailure": "2025-10-26T14:23:00Z",
    "consecutiveFailures": 0
  }
}
```

**Performance Targets**:
| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Data Freshness | <6 hours | >24 hours |
| Scraper Success Rate | >90% | <80% |
| Missing Financials | <10% | >20% |

**Tools**: Custom business logic + metrics service

### Layer 6: Alert System

**Alert Rules** (6 automated):

| Level | Condition | Notification | Response Time |
|-------|-----------|--------------|---------------|
| **INFO** | Cache hit rate <80% | Log only | Review weekly |
| **WARNING** | API p95 >1s | Log + Email | Review daily |
| **WARNING** | Stale IPOs >10 | Log + Email | Review daily |
| **CRITICAL** | API error rate >5% | Email + SMS | Immediate |
| **CRITICAL** | Database down | Email + SMS + PagerDuty | Immediate |
| **CRITICAL** | Redis down | Email + SMS | Immediate |

**Alert Channels**:
- **Email**: Critical and warning alerts
- **Sentry**: Automatic error grouping and alerting
- **Logs**: All alerts logged to `logs/alert-%DATE%.log`
- **PM2**: Process crash notifications

---

## Health Check Endpoints

### Basic Health Check

**Endpoint**: `GET /api/health`

**Purpose**: Quick liveness check for uptime monitoring

**Response** (< 100ms):
```json
{
  "status": "healthy",
  "timestamp": "2025-10-27T10:30:00Z"
}
```

**Usage**: UptimeRobot checks every 5 minutes

### Detailed Health Check

**Endpoint**: `GET /api/health-detailed`

**Purpose**: Comprehensive service health with dependency checks

**Response** (< 500ms):
```json
{
  "status": "healthy",
  "timestamp": "2025-10-27T10:30:00Z",
  "services": {
    "database": {
      "status": "healthy",
      "latency": 12,
      "connections": 15,
      "poolSize": 50
    },
    "redis": {
      "status": "healthy",
      "latency": 3,
      "memory": "45MB",
      "hitRate": 87.3
    },
    "scraper": {
      "status": "healthy",
      "lastRun": "2025-10-27T08:00:00Z",
      "successRate": 95.2
    }
  },
  "performance": {
    "uptime": 432000,
    "memoryUsage": "512MB",
    "cpuUsage": 35.2
  }
}
```

**Usage**: Admin dashboard, detailed monitoring

### Business Metrics Endpoint

**Endpoint**: `GET /api/metrics`

**Purpose**: Business intelligence and data quality metrics

**Response** (< 500ms):
```json
{
  "dataFreshness": { ... },
  "dataQuality": { ... },
  "scraperHealth": { ... },
  "apiMetrics": {
    "requestsToday": 12543,
    "averageResponseTime": 245,
    "errorRate": 0.8
  }
}
```

---

## Monitoring Commands

### Winston Logs

```bash
# View real-time application logs
tail -f logs/app-2025-10-27.log | jq '.'

# View error logs only
tail -f logs/error-2025-10-27.log | jq '.'

# Search logs for specific keyword
grep "IPO scraped" logs/app-2025-10-27.log | jq '.'

# View performance logs
tail -f logs/performance-2025-10-27.log | jq '.query'
```

### PM2 Monitoring

```bash
# View PM2 dashboard
pm2 monit

# View process list
pm2 list

# View logs for specific process
pm2 logs ipodhan-web
pm2 logs ipodhan-scraper

# View real-time metrics
pm2 show ipodhan-web

# Restart processes
pm2 restart all
```

### Database Monitoring

```bash
# Run health check
npx tsx scripts/db-health-check.ts

# Run performance analysis
psql -U postgres -d ipodhan -f scripts/monitor-db-performance.sql

# View active connections
psql -U postgres -d ipodhan -c "SELECT count(*) FROM pg_stat_activity;"

# View slow queries
psql -U postgres -d ipodhan -c "SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"
```

### Redis Monitoring

```bash
# Run Redis health check
npx tsx scripts/monitor-redis.ts

# Redis CLI monitoring
redis-cli INFO stats
redis-cli INFO memory
redis-cli INFO keyspace

# Monitor cache hit rate
redis-cli INFO stats | grep keyspace_hits
```

---

## Performance Benchmarks (Phase 5)

**Load Testing Results** (k6):
- **100 users**: p95 300ms ✅ Excellent
- **500 users**: p95 480ms ✅ Good
- **1000 users**: p95 650ms 🟡 Degraded
- **Breaking point**: 1200-1500 concurrent users

**Core Web Vitals** (Lighthouse):
- **LCP**: < 2.5s (target met)
- **FID**: < 100ms (target met)
- **CLS**: < 0.1 (target met)
- **TTFB**: < 600ms (target met)

**Database Performance**:
- Connection pool: 50 connections (increased from 20)
- Query p95: <100ms for all critical queries
- Cache hit rate: >85% for IPO detail/list

**Production Readiness Score**: **9.2/10**

---

## Related Documentation

- **Winston Setup**: `web/lib/monitoring/README.md`
- **Quick Start Guide**: `web/lib/monitoring/QUICK_START.md`
- **Load Testing Report**: `test-results/phase-5/production-load-testing-report.md`
- **Real-time Scoring**: `test-results/phase-5/real-time-scoring-report.md`
- **Integration Testing**: `test-results/phase-5/integration-testing-report.md`

---

**Last Updated**: 2025-10-27 (Phase 5 completion)
**Maintained By**: DevOps + Backend team
**Review Frequency**: Monthly or after major deployments
**Status**: ✅ **Production-Ready** - All 6 monitoring layers deployed and functional

---
