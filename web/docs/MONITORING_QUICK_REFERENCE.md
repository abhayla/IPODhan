# Monitoring Quick Reference Guide

Quick reference for monitoring the IPODhan production application.

## Quick Health Check

```bash
# Check application health
curl http://localhost:3000/api/health | jq

# Detailed health check
curl http://localhost:3000/api/health-detailed | jq

# Business metrics
curl http://localhost:3000/api/metrics | jq

# Full metrics (includes DB + Redis details)
curl http://localhost:3000/api/metrics?detailed=true | jq

# Prometheus metrics
curl http://localhost:9464/metrics
```

## Log Files

```bash
# Real-time application logs
tail -f logs/app-$(date +%Y-%m-%d).log | jq

# Real-time error logs
tail -f logs/error-$(date +%Y-%m-%d).log | jq

# Performance logs
tail -f logs/performance-$(date +%Y-%m-%d).log | jq

# Search for errors
grep -h "error" logs/error-*.log | jq -r .message | sort | uniq -c

# Find slow queries
grep "db\." logs/performance-*.log | jq -s 'sort_by(.duration) | reverse | .[0:10]'

# Cache hit rate
grep "Cache operation" logs/app-*.log | grep "HIT\|MISS" | awk '{print $NF}' | sort | uniq -c
```

## Manual Monitoring Scripts

```bash
# Database health check
tsx scripts/db-health-check.ts

# Redis health check
tsx scripts/monitor-redis.ts

# SQL performance queries
psql -U postgres -d ipodhan -f scripts/monitor-db-performance.sql
```

## Common Queries

### Database Slow Queries
```sql
SELECT
  SUBSTRING(query, 1, 100) as query,
  calls,
  ROUND(mean_exec_time::numeric, 2) as mean_ms
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 10;
```

### Connection Pool Status
```sql
SELECT
  numbackends as active_connections,
  ROUND((blks_hit::float / NULLIF(blks_hit + blks_read, 0) * 100)::numeric, 2) as cache_hit_ratio
FROM pg_stat_database
WHERE datname = current_database();
```

### Redis Stats
```bash
redis-cli info stats | grep -E "keyspace_hits|keyspace_misses|evicted_keys"
```

## Alert Thresholds

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| Database Response Time | > 100ms | > 500ms | Optimize queries |
| Cache Hit Rate | < 80% | < 60% | Review cache strategy |
| Connection Pool | > 15/20 | > 18/20 | Check for leaks |
| Memory Usage | > 500MB | > 800MB | Restart or optimize |
| Scraper Failures | > 3/24h | > 5/24h | Check scraper logs |
| Redis Evictions | > 50 | > 100 | Increase memory |

## Environment Variables

```env
# Monitoring
LOG_LEVEL=info
PROMETHEUS_PORT=9464
APP_VERSION=1.0.0

# Alerts
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
ADMIN_EMAIL=admin@ipodhan.com
```

## Grafana Dashboards (Optional)

### Prometheus Data Source
- URL: http://localhost:9464
- Scrape interval: 10s

### Recommended Dashboards
- Node Exporter Full (ID: 1860)
- PostgreSQL Database (ID: 9628)
- Redis (ID: 763)

## Troubleshooting

### Logs Not Rotating
1. Check `logs/` directory exists
2. Verify file permissions
3. Review `logger.ts` settings

### Prometheus Metrics 404
1. Check `instrumentation.ts` loaded
2. Verify `PROMETHEUS_PORT` env var
3. Check logs for startup message

### Alerts Not Sending
1. Verify `DISCORD_WEBHOOK_URL` set
2. Test webhook manually
3. Check application error logs

### High Memory Usage
1. Check metrics endpoint for details
2. Review slow queries
3. Consider restarting application
4. Increase memory limits if needed

## Performance Targets

| Metric | Target | Max |
|--------|--------|-----|
| API Response (p95) | < 200ms | < 500ms |
| DB Query (p95) | < 50ms | < 100ms |
| Cache Hit Rate | > 90% | > 80% |
| Redis Response | < 10ms | < 50ms |
| Memory Usage | < 500MB | < 800MB |

## Daily Checklist

- [ ] Check `/api/health` status
- [ ] Review error logs for patterns
- [ ] Check scraper success rate
- [ ] Verify cache hit rate > 80%
- [ ] Monitor database connection pool
- [ ] Review memory usage trends

## Weekly Checklist

- [ ] Analyze slow queries and optimize
- [ ] Review unused indexes
- [ ] Check table bloat
- [ ] Analyze log patterns
- [ ] Review alert frequency
- [ ] Update performance baselines

## Monthly Checklist

- [ ] Capacity planning review
- [ ] Archive old logs
- [ ] Update Grafana dashboards
- [ ] Review and tune alert thresholds
- [ ] Performance regression testing
- [ ] Update monitoring documentation
