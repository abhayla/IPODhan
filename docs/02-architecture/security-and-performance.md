# Security and Performance

**Performance Targets & Security Requirements**

---

## Performance Targets

### API Response Times

**From**: CLAUDE.md requirements

| Metric | Target | Monitoring Method |
|--------|--------|-------------------|
| p95 response time | < 500ms | Application logs |
| p99 response time | < 1000ms | Application logs |
| API error rate | < 0.1% | Error tracking |

**Breakdown by Endpoint Type**:

| Endpoint Type | p95 Target | p99 Target |
|--------------|-----------|-----------|
| IPO List (cached) | < 100ms | < 200ms |
| IPO Detail (cached) | < 150ms | < 300ms |
| Search | < 300ms | < 600ms |
| Historical Data | < 400ms | < 800ms |
| Comparison Tool | < 500ms | < 1000ms |

### Page Load Performance

**Core Web Vitals Targets**:

| Metric | Target | Measurement |
|--------|--------|-------------|
| LCP (Largest Contentful Paint) | < 2.5s | 75th percentile |
| FID (First Input Delay) | < 100ms | 75th percentile |
| CLS (Cumulative Layout Shift) | < 0.1 | 75th percentile |
| TTFB (Time to First Byte) | < 600ms | Server response |

### Database Query Performance

**From**: BaseRepository query logging

| Query Type | Target (p95) | Alert Threshold |
|------------|-------------|-----------------|
| Single row lookup | < 10ms | > 50ms |
| List with filters | < 50ms | > 150ms |
| Complex joins (3+ tables) | < 100ms | > 300ms |
| Full-text search | < 200ms | > 500ms |
| Aggregations | < 150ms | > 400ms |

**Monitoring**: All queries logged via `BaseRepository.executeQuery()`

### Cache Performance

**Redis Targets**:

| Metric | Target | Implementation |
|--------|--------|----------------|
| Cache hit rate | > 80% | For IPO detail/list endpoints |
| Cache GET latency | < 5ms | p95 |
| Cache SET latency | < 10ms | p95 |
| Memory usage | < 80% capacity | Alert threshold |

**From**: `web/lib/cache/` implementations

### Concurrency Targets

| Metric | Target | Infrastructure |
|--------|--------|----------------|
| Concurrent users | 1000 | VPS with 20 DB connections |
| Requests per second | 100 | Nginx + Next.js |
| Database connections | 20 pool size | PostgreSQL |
| Redis connections | 1 (singleton) | ioredis client |

---

## Performance Optimization Strategies

### 1. Caching Strategy

**Implementation**: `docs/05-caching/CACHING_STRATEGY.md`

- Redis cache-aside pattern for all queries
- TTL-based expiration (5min - 24h depending on volatility)
- Pattern-based invalidation on data updates
- Graceful degradation (app works without Redis)

### 2. Database Optimization

**Connection Pooling**:
```typescript
// web/lib/db/index.ts
const pool = new Pool({
  max: 20,                    // 20 connections for 1000 concurrent users
  idleTimeoutMillis: 30000,   // Release idle connections
  connectionTimeoutMillis: 2000  // Fast failure
});
```

**Query Optimization**:
- Select only required columns
- Use indexes for filtered columns
- Batch operations (bulk insert/update)
- Pagination for all list queries
- Eager loading with Drizzle relations

**Indexes**: See `docs/16-database/screen-table-database-field-mapping.md`

### 3. Next.js Optimization

**Static Generation**:
- Homepage: ISR with 5min revalidation
- Static pages: Generated at build time
- Dynamic pages: Server-side with caching

**Image Optimization**:
- Next.js Image component for all images
- WebP format with fallbacks
- Lazy loading below fold
- Responsive srcset

**Code Splitting**:
- Dynamic imports for heavy components
- Route-based splitting (automatic)
- Lazy load charts/visualizations

### 4. Scraper Performance

**Rate Limiting**:
- NSE API: 1 request per 2 seconds
- BSE scraper: 1 request per 3 seconds
- Moneycontrol: 1 request per 2 seconds
- IPO Alerts API: 100 requests/hour

**Execution**:
- Sequential scraper execution (avoid rate limit blocks)
- Retry with exponential backoff (1s, 2s, 4s)
- Timeout protection (30s per scraper)

---

## Security Requirements

### Infrastructure Security

**VPS Configuration**:
- SSH key-only authentication (no password)
- Firewall: Only ports 80, 443, 22 open
- Fail2ban for brute force protection
- Automatic security updates

**Database Security**:
- PostgreSQL accessible only from localhost
- Strong password (32+ characters)
- SSL/TLS for remote connections
- Regular automated backups

**Redis Security**:
- Password authentication required
- Bind to localhost only
- No FLUSHALL command in production
- Separate instance per environment

### Application Security

**Environment Variables**:
```bash
# Never commit to version control
DATABASE_URL=postgresql://...
REDIS_PASSWORD=...
IPO_ALERTS_API_KEY=...
```

**Secrets Management**:
- `.env.local` for local development (gitignored)
- Environment variables in VPS
- Separate keys per environment (dev/staging/prod)

**Input Validation**:
- Zod schemas for all API inputs
- SQL injection protection (Drizzle ORM parameterized queries)
- XSS protection (React automatic escaping)
- CSRF tokens for mutations (Next.js built-in)

### API Security

**Rate Limiting** (TODO - Phase 2):

| Endpoint | Limit | Window |
|----------|-------|--------|
| Search | 10 req/min | Per IP |
| Email subscription | 5 req/hour | Per IP |
| Other endpoints | 100 req/min | Per IP |

**Headers**:
```typescript
// app/api/*/route.ts
headers: {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
}
```

**CORS**:
- Allow only production domain
- No wildcard origins
- Credentials not allowed for public APIs

### Data Privacy

**PII Handling** (Phase 2 - Email subscriptions):
- Hash email addresses before storage
- GDPR-compliant unsubscribe mechanism
- No third-party analytics tracking without consent
- Data retention policy (delete after 2 years inactive)

**Logging**:
- Never log sensitive data (passwords, API keys)
- Sanitize error messages (no stack traces to users)
- Structured logging for audit trails

---

## Monitoring & Observability

### Application Monitoring

**Metrics to Track**:
1. **Response Times**: p50, p95, p99 per endpoint
2. **Error Rate**: 4xx, 5xx responses
3. **Cache Performance**: Hit rate, latency
4. **Database**: Query times, connection pool usage
5. **Scraper Health**: Success rate, execution time

**Logging Stack**:
- Console logs (structured JSON in production)
- Pino logger for performance
- PM2 log rotation
- Centralized logging (TODO - Phase 2)

### Database Monitoring

**PostgreSQL Metrics**:
```sql
-- Active connections
SELECT count(*) FROM pg_stat_activity;

-- Slow queries (> 100ms)
SELECT query, mean_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC;

-- Cache hit ratio (target > 95%)
SELECT sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) AS cache_hit_ratio
FROM pg_statio_user_tables;
```

### Redis Monitoring

```bash
# Memory usage
redis-cli INFO memory

# Hit rate
redis-cli INFO stats | grep keyspace_hits

# Slow commands (> 10ms)
redis-cli SLOWLOG GET 10
```

### Health Check Endpoint

**Implementation**: `app/api/health/route.ts`

```typescript
GET /api/health
{
  "status": "healthy",
  "timestamp": "2025-01-20T10:30:00Z",
  "services": {
    "database": "healthy",  // pg pool.query test
    "redis": "healthy",     // redis.ping() test
    "scraper": "healthy"    // check last run timestamp
  },
  "metrics": {
    "uptime": 3600,
    "requests_last_minute": 45
  }
}
```

**Monitoring Schedule**:
- Internal health check: Every 30 seconds
- External uptime monitoring: Every 1 minute (UptimeRobot)
- Alert on 3 consecutive failures

---

## Performance Budgets

### Bundle Size Targets

| Asset Type | Budget | Current | Status |
|------------|--------|---------|--------|
| Initial JS | < 200kb | TBD | Monitor |
| Initial CSS | < 50kb | TBD | Monitor |
| Total page weight | < 1MB | TBD | Monitor |

### Runtime Budgets

| Operation | Budget | Enforcement |
|-----------|--------|-------------|
| Component render | < 16ms | React Profiler |
| API route handler | < 500ms | Logging |
| Database query | < 100ms | `executeQuery` logs |
| Cache operation | < 10ms | Timeout protection |

---

## Scalability Considerations

### Current Architecture (1000 concurrent users)

**Bottlenecks**:
1. Database connections (20 pool limit)
2. Single VPS server
3. No CDN for static assets

### Scaling Strategy (5000+ users)

**Horizontal Scaling**:
1. Add load balancer (Nginx)
2. Multiple Next.js instances (PM2 cluster mode)
3. Database read replicas
4. Redis cluster
5. CDN for static assets (Cloudflare)

**Vertical Scaling**:
1. Upgrade VPS (CPU + RAM)
2. Increase DB connection pool
3. Optimize slow queries (materialized views)

**Monitoring Triggers**:
- Alert at 80% connection pool usage
- Alert at 70% CPU usage sustained > 5min
- Alert at 80% memory usage

---

## Security Incident Response

### Incident Classification

| Severity | Response Time | Examples |
|----------|---------------|----------|
| Critical | < 1 hour | Data breach, service down |
| High | < 4 hours | API abuse, DDoS |
| Medium | < 24 hours | Suspicious activity |
| Low | < 1 week | Minor vulnerability |

### Response Playbook

1. **Detect**: Monitoring alerts, user reports
2. **Contain**: Block malicious IPs, disable affected features
3. **Investigate**: Check logs, identify root cause
4. **Remediate**: Deploy fix, verify resolution
5. **Document**: Post-mortem, update runbook

---

## Related Documentation

- **Cache Strategy**: `docs/05-caching/CACHING_STRATEGY.md`
- **Backend Architecture**: `docs/02-architecture/backend-architecture.md`
- **Deployment**: `docs/02-architecture/deployment-architecture.md`
- **VPS Configuration**: `docs/vps-server-configuration.md`

---

**Last Updated**: 2025-10-20
**Maintained By**: DevOps + Security team
**Review Frequency**: Quarterly security audit + after incidents
