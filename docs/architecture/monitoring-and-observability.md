# Monitoring and Observability

## Monitoring Stack

- **Frontend Monitoring:** Sentry for error tracking, Vercel Analytics for performance
- **Backend Monitoring:** CloudWatch for metrics, Sentry for errors
- **Error Tracking:** Sentry with source maps, error grouping, and alerts
- **Performance Monitoring:** Core Web Vitals tracking, API response time monitoring

## Key Metrics

**Frontend Metrics:**
- Core Web Vitals (LCP < 2.5s, FID < 100ms, CLS < 0.1)
- JavaScript error rate < 0.1%
- API response times p95 < 500ms
- User interaction success rate > 99%

**Backend Metrics:**
- Request rate per endpoint
- Error rate < 1%
- Response time p95 < 200ms
- Database query performance p95 < 50ms
- Queue processing lag < 30s
- WhatsApp delivery rate > 95%
