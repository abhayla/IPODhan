# Sentry Quick Start Guide

**5-Minute Setup & Integration Guide**

---

## Setup (First Time)

### 1. Create Sentry Account

```bash
# Visit Sentry
https://sentry.io/signup/

# Create organization: "ipodhan"
# Create project: "ipodhan-web" (Next.js)
```

### 2. Configure Environment

```bash
# Update web/.env.local
NEXT_PUBLIC_SENTRY_DSN=https://xxxxx@o####.ingest.sentry.io/######
SENTRY_AUTH_TOKEN=your_auth_token_here
SENTRY_ORG=ipodhan
SENTRY_PROJECT=ipodhan-web
```

### 3. Test Integration

```bash
# Start dev server
cd web
npm run dev

# Test endpoint
curl http://localhost:3000/api/sentry-test?test=all

# Check Sentry dashboard
https://sentry.io/organizations/ipodhan/issues/
```

---

## Usage in Code

### API Routes

```typescript
import { captureAPIError, trackPerformance, addBreadcrumb } from '@/lib/monitoring/sentry-utils';

export async function GET(request: NextRequest) {
  const requestId = generateRequestId();

  try {
    // Add context breadcrumb
    addBreadcrumb('Fetching IPO data', { requestId });

    // Track performance
    const data = await trackPerformance(
      'fetch-ipo-list',
      async () => {
        return await ipoRepository.findAll(filters);
      },
      { endpoint: '/api/ipos' }
    );

    return NextResponse.json({ data });
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

### Repositories

```typescript
import { captureDatabaseError, addBreadcrumb } from '@/lib/monitoring/sentry-utils';

export class IPORepository extends BaseRepository {
  async findBySlug(slug: string): Promise<IPO | null> {
    try {
      const result = await this.executeQuery(
        'findBySlug',
        db.select().from(ipos).where(eq(ipos.slug, slug)),
        { slug }
      );

      if (!result[0]) {
        addBreadcrumb('IPO not found', { slug }, 'warning');
      }

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

### Cache Operations

```typescript
import { captureCacheError, addBreadcrumb } from '@/lib/monitoring/sentry-utils';

async function getCached<T>(key: string): Promise<T | null> {
  try {
    const data = await redis.get(key);

    if (data) {
      addBreadcrumb('Cache hit', { key }, 'debug');
    } else {
      addBreadcrumb('Cache miss', { key }, 'debug');
    }

    return data ? JSON.parse(data) : null;
  } catch (error) {
    captureCacheError(error as Error, {
      operation: 'get',
      key,
    });
    return null; // Graceful fallback
  }
}
```

---

## Common Utilities

### Error Capture

```typescript
// API errors
captureAPIError(error, {
  endpoint: '/api/endpoint',
  method: 'GET',
  statusCode: 500,
  requestId: 'req-123',
});

// Database errors
captureDatabaseError(error, {
  query: 'findById',
  table: 'ipos',
  operation: 'select',
});

// Cache errors
captureCacheError(error, {
  operation: 'get',
  key: 'ipo:slug:xyz',
});

// Scraper errors
captureScraperError(error, {
  scraper: 'nse',
  url: 'https://www.nseindia.com/...',
  retryCount: 3,
});
```

### Performance Tracking

```typescript
// Async operations
const result = await trackPerformance(
  'operation-name',
  async () => {
    return await doSomething();
  },
  { category: 'database', operation: 'query' }
);

// Sync operations
const result = trackSyncPerformance(
  'calculation',
  () => {
    return calculateSomething();
  },
  { category: 'compute' }
);
```

### Breadcrumbs

```typescript
// Info breadcrumb
addBreadcrumb('User action', { action: 'view_ipo' }, 'info');

// Debug breadcrumb
addBreadcrumb('Database query', { table: 'ipos' }, 'debug');

// Warning breadcrumb
addBreadcrumb('Slow query detected', { duration: 520 }, 'warning');

// Error breadcrumb
addBreadcrumb('Validation failed', { errors: [...] }, 'error');
```

### User Context

```typescript
// Set user context
setUserContext('user-123', 'user@example.com', {
  plan: 'premium',
  registeredAt: '2024-01-01',
});

// Clear on logout
clearUserContext();
```

---

## Testing

### Test Endpoint

```bash
# Test all features
curl http://localhost:3000/api/sentry-test?test=all

# Test specific feature
curl http://localhost:3000/api/sentry-test?test=error
curl http://localhost:3000/api/sentry-test?test=performance
curl http://localhost:3000/api/sentry-test?test=breadcrumbs

# Test POST
curl -X POST http://localhost:3000/api/sentry-test \
  -H "Content-Type: application/json" \
  -d '{"testData": "hello"}'
```

### Verify in Dashboard

1. Visit: https://sentry.io/organizations/ipodhan/issues/
2. Check for test events
3. Verify breadcrumbs are attached
4. Check performance transactions

---

## Production Checklist

Before deploying to production:

- [ ] Sentry DSN configured in production `.env`
- [ ] Auth token set for source map uploads
- [ ] Sample rate set to 0.3 (30%)
- [ ] Error filters reviewed
- [ ] Alerts configured (error rate, performance)
- [ ] Discord webhook connected
- [ ] Test error capture in production
- [ ] Verify source maps uploaded

---

## Troubleshooting

### Events Not Showing in Sentry

1. Check DSN: `echo $NEXT_PUBLIC_SENTRY_DSN`
2. Verify initialization: Visit `/api/sentry-test`
3. Check network tab for failed requests
4. Ensure event not filtered by `beforeSend()`

### Source Maps Missing

1. Verify auth token is set
2. Check build logs for "Uploading source maps"
3. Ensure `NODE_ENV=production` during build
4. Verify release matches in Sentry dashboard

### High Event Volume

1. Reduce sample rate to 0.1-0.2
2. Add more error filters
3. Filter health check endpoints
4. Check for error loops

---

## Resources

- **Full Setup Report:** `test-results/pre-launch/sentry-setup-report.md`
- **Monitoring Guide:** `web/lib/monitoring/README.md`
- **Test Endpoint:** `/api/sentry-test`
- **Sentry Docs:** https://docs.sentry.io/platforms/javascript/guides/nextjs/

---

**Last Updated:** 2025-10-21
