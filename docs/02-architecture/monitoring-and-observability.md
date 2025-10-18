# Monitoring and Observability

## Monitoring Stack

- **Frontend Monitoring:** Google Analytics 4 (Core Web Vitals, user behavior)
- **Backend Monitoring:** PM2 metrics (CPU, memory, restarts)
- **Error Tracking:** Sentry (errors, performance tracing)
- **Uptime Monitoring:** UptimeRobot (checks `/api/health` every 5 min)
- **Logs:** Pino structured logging to files

## Key Metrics

**Frontend:**
- Core Web Vitals (LCP, FID, CLS)
- JavaScript errors
- API response times
- User interactions

**Backend:**
- Request rate
- Error rate (5xx)
- Response time (p50, p95, p99)
- Database query performance
- Cache hit rate
- Scraper success rate

**Business:**
- Email subscriptions created
- IPO detail page views
- Search queries
- Filter usage

## Health Check Endpoint

`GET /api/health` returns:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-05T10:30:00Z",
  "services": {
    "database": "healthy",
    "redis": "healthy"
  }
}
```

## Alerting

**Critical Alerts:**
- API health check fails (3 consecutive)
- Error rate >5%
- Scraper fails 3+ consecutive runs
- Memory usage >90%

**Notification Channels:**
- Email for critical alerts
- Sentry for error issues
- PM2 logs for scraper failures

---
