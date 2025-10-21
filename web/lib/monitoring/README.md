# Monitoring & Observability

IPODhan uses a comprehensive monitoring stack combining Sentry, OpenTelemetry, Winston logging, and custom alerts.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    IPODhan Application                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Sentry     │  │ OpenTelemetry│  │   Winston    │      │
│  │   (Errors)   │  │  (Metrics)   │  │   (Logs)     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                  │                  │              │
│         ▼                  ▼                  ▼              │
│  ┌──────────────────────────────────────────────────┐       │
│  │           Unified Monitoring Interface            │       │
│  │         (sentry-utils.ts + alerts.ts)             │       │
│  └──────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌──────────────────────────────────────────┐
        │  External Monitoring Services             │
        ├──────────────────────────────────────────┤
        │  • Sentry Dashboard (errors, performance) │
        │  • Prometheus (metrics)                   │
        │  • Discord Webhooks (alerts)              │
        └──────────────────────────────────────────┘
```

## Components

### 1. Sentry (Error Tracking & Performance)

**Purpose:** Real-time error tracking, performance monitoring, and release tracking

**Features:**
- Error capture with stack traces
- Performance monitoring (transactions, spans)
- Session replay
- Release tracking
- User context
- Breadcrumbs for debugging

**Files:**
- `sentry.client.config.ts` - Client-side configuration
- `sentry.server.config.ts` - Server-side configuration
- `sentry.edge.config.ts` - Edge runtime configuration
- `lib/monitoring/sentry-utils.ts` - Custom utilities

**Usage:**
```typescript
import { captureAPIError, trackPerformance } from '@/lib/monitoring/sentry-utils';

// Capture API errors
try {
  // ... API logic
} catch (error) {
  captureAPIError(error as Error, {
    endpoint: '/api/ipos',
    method: 'GET',
    statusCode: 500
  });
}

// Track performance
const result = await trackPerformance(
  'fetch-ipo-data',
  async () => {
    return await ipoRepository.findBySlug(slug);
  },
  { category: 'database' }
);
```

### 2. OpenTelemetry (Metrics & Tracing)

**Purpose:** Automatic instrumentation for HTTP, database, and Redis operations

**Features:**
- Automatic HTTP request tracking
- PostgreSQL query instrumentation
- Redis operation tracking
- Prometheus metrics export

**Files:**
- `lib/monitoring/instrumentation.ts`

**Metrics Endpoint:**
- `http://localhost:9464/metrics` (Prometheus format)

### 3. Winston (Structured Logging)

**Purpose:** Application logging with log levels, rotation, and structured output

**Features:**
- Multiple log levels (error, warn, info, debug)
- Daily log rotation
- JSON format for production
- Pretty-print for development

**Files:**
- `lib/logger.ts` (assumed)

### 4. Alert System

**Purpose:** Proactive notifications for critical events

**Features:**
- Multi-channel alerts (Discord, Email)
- Severity-based routing
- Threshold monitoring
- Custom alert rules

**Files:**
- `lib/monitoring/alerts.ts`

**Alert Levels:**
- INFO: Informational events
- WARNING: Non-critical issues (Discord notification)
- CRITICAL: Urgent issues (Discord + Email)

## Integration Guide

### API Routes

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { captureAPIError, trackPerformance, addBreadcrumb } from '@/lib/monitoring/sentry-utils';

export async function GET(request: NextRequest) {
  const requestId = generateRequestId();

  try {
    // Add breadcrumb
    addBreadcrumb('API request received', {
      endpoint: '/api/ipos',
      method: 'GET',
      requestId,
    });

    // Track performance
    const result = await trackPerformance(
      'api-ipos-get',
      async () => {
        return await fetchData();
      },
      { endpoint: '/api/ipos' }
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    // Capture error with context
    captureAPIError(error as Error, {
      endpoint: '/api/ipos',
      method: 'GET',
      statusCode: 500,
      requestId,
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### Repository Layer

```typescript
import { captureDatabaseError } from '@/lib/monitoring/sentry-utils';

export class IPORepository extends BaseRepository {
  async findBySlug(slug: string): Promise<IPO | null> {
    try {
      const result = await this.executeQuery(
        'findBySlug',
        db.select().from(ipos).where(eq(ipos.slug, slug)),
        { slug }
      );
      return result[0] || null;
    } catch (error) {
      captureDatabaseError(error as Error, {
        query: 'findBySlug',
        table: 'ipos',
        operation: 'select',
      });
      throw error;
    }
  }
}
```

### Cache Layer

```typescript
import { captureCacheError } from '@/lib/monitoring/sentry-utils';

export async function getCachedData(key: string): Promise<any> {
  try {
    const data = await redis.get(key);
    return data;
  } catch (error) {
    captureCacheError(error as Error, {
      operation: 'get',
      key,
    });
    // Graceful fallback
    return null;
  }
}
```

## Configuration

### Environment Variables

```bash
# Sentry
NEXT_PUBLIC_SENTRY_DSN=https://xxxxx@o####.ingest.sentry.io/######
SENTRY_AUTH_TOKEN=your_auth_token
SENTRY_ORG=ipodhan
SENTRY_PROJECT=ipodhan-web

# OpenTelemetry
PROMETHEUS_PORT=9464

# Alerts
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
ADMIN_EMAIL=admin@ipodhan.com
```

### Sample Rates

**Development:**
- Traces: 100% (all transactions)
- Errors: 100% (all errors)
- Session Replay: 10% (10% of sessions)

**Production:**
- Traces: 30% (to stay within quota)
- Errors: 100% (all errors)
- Session Replay: 10% (10% of sessions)
- Replay on Error: 100% (all error sessions)

## Monitoring Dashboards

### Sentry Dashboard

- **URL:** https://sentry.io/organizations/[your-org]/issues/
- **Metrics:**
  - Error rate
  - Transaction throughput
  - p95/p99 response times
  - User sessions
  - Release tracking

### Prometheus Metrics

- **URL:** http://localhost:9464/metrics
- **Metrics:**
  - HTTP request duration
  - Database query duration
  - Redis operation count
  - Active connections
  - Memory usage

### Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Database response time | >500ms | >1000ms |
| Cache hit rate | <80% | <60% |
| Error rate | >1% | >5% |
| Memory usage | >800MB | >1GB |
| Disk usage | >85% | >95% |

## Testing

### Manual Testing

```bash
# Test Sentry integration
curl http://localhost:3000/api/sentry-test?test=all

# Test specific feature
curl http://localhost:3000/api/sentry-test?test=error
curl http://localhost:3000/api/sentry-test?test=performance
```

### Viewing Metrics

```bash
# Prometheus metrics
curl http://localhost:9464/metrics

# Check logs
tail -f logs/combined.log
tail -f logs/error.log
```

## Best Practices

1. **Error Capture:**
   - Always include context (endpoint, method, status code)
   - Filter non-critical errors (Redis connection warnings)
   - Use proper error levels (error vs warning)

2. **Performance Tracking:**
   - Track critical operations only (database queries, API calls)
   - Use descriptive operation names
   - Include relevant tags for filtering

3. **Breadcrumbs:**
   - Add breadcrumbs for user actions
   - Include relevant data for debugging
   - Use appropriate log levels

4. **User Context:**
   - Set user context for authenticated requests
   - Clear context on logout
   - Include relevant user metadata

5. **Metrics:**
   - Report custom business metrics
   - Use proper units (millisecond, byte, none)
   - Include tags for segmentation

## Troubleshooting

### Sentry Events Not Appearing

1. Check DSN is set: `echo $NEXT_PUBLIC_SENTRY_DSN`
2. Verify Sentry is initialized: Visit `/api/sentry-test`
3. Check event filters in Sentry config
4. Ensure sample rate is not 0

### High Event Volume

1. Reduce sample rate in production (0.1-0.3)
2. Add more event filters
3. Filter non-critical errors
4. Use transaction sampling

### Performance Issues

1. Enable only necessary integrations
2. Use proper sample rates
3. Filter health check endpoints
4. Limit breadcrumb count

## Migration Notes

### From Basic Sentry to Full Integration

1. Replace direct `Sentry.captureException()` with `captureAPIError()`
2. Wrap critical operations with `trackPerformance()`
3. Add breadcrumbs for debugging context
4. Set user context where applicable
5. Use error-specific capture functions

### Example Migration

**Before:**
```typescript
try {
  // ... logic
} catch (error) {
  Sentry.captureException(error);
  throw error;
}
```

**After:**
```typescript
try {
  // ... logic
} catch (error) {
  captureAPIError(error as Error, {
    endpoint: '/api/ipos',
    method: 'GET',
    statusCode: 500,
    requestId,
  });
  throw error;
}
```

## Support

For issues or questions:
1. Check Sentry documentation: https://docs.sentry.io/platforms/javascript/guides/nextjs/
2. Review test endpoint: `/api/sentry-test`
3. Check Sentry dashboard for error details
