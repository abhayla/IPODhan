# Performance Optimization Testing Instructions

**Date**: 2025-10-21
**Related**: `fixes/performance-optimization.md`

---

## Pre-Deployment Testing

### 1. Apply Database Migrations

```bash
cd web

# Review migrations
cat drizzle/migrations/0001_add_calendar_materialized_view.sql
cat drizzle/migrations/0002_add_performance_indexes.sql

# Apply to database
npm run db:migrate

# Verify materialized view
psql -h localhost -U postgres -d ipodhan -c "\d calendar_view"

# Expected: Table structure with ~30 columns

# Verify indexes
psql -h localhost -U postgres -d ipodhan -c "\di" | grep idx_

# Expected: 46 new indexes
```

---

### 2. Initial View Refresh

```bash
# Populate materialized view
psql -h localhost -U postgres -d ipodhan -c "SELECT refresh_calendar_view();"

# Verify data
psql -h localhost -U postgres -d ipodhan -c "SELECT COUNT(*) FROM calendar_view;"

# Expected: Count should match IPOs with dates
```

---

### 3. Test New Calendar Endpoint

```bash
# Start development server
cd web
npm run dev

# Test cold cache (first request)
time curl -s http://localhost:3010/api/calendar/materialized/MAINBOARD > /dev/null

# Expected: ~400ms or less

# Test warm cache (second request)
time curl -s http://localhost:3010/api/calendar/materialized/MAINBOARD > /dev/null

# Expected: ~50ms or less

# Test with JSON output
curl http://localhost:3010/api/calendar/materialized/MAINBOARD | jq '.count'

# Expected: Number of mainboard IPOs
```

---

### 4. Test Cache Hit Rate

```bash
# Test multiple requests to same endpoint
for i in {1..10}; do
  curl -s http://localhost:3010/api/calendar/materialized/MAINBOARD > /dev/null
done

# Check cache logs
# Expected: Should see "[API Cache] HIT" messages after first request
```

---

### 5. Test Calendar Refresh Job

```bash
cd scraper

# Build if needed
npm run build

# Run manual refresh
node dist/jobs/refresh-calendar.js

# Expected output:
# [Cron] Starting calendar materialized view refresh...
# [Cron] Invalidating calendar cache...
# [Cron] ✓ Calendar view refreshed successfully in 3421ms
```

---

### 6. Performance Benchmark (All Endpoints)

```bash
# Create benchmark script
cat > benchmark.sh << 'EOF'
#!/bin/bash

echo "=== API Performance Benchmark ==="
echo ""

# Function to test endpoint
test_endpoint() {
  local url=$1
  local name=$2
  echo -n "Testing $name... "
  local start=$(date +%s%3N)
  curl -s "$url" > /dev/null
  local end=$(date +%s%3N)
  local duration=$((end - start))
  echo "${duration}ms"
}

# Test critical endpoints
test_endpoint "http://localhost:3010/api/ipos" "IPO List"
test_endpoint "http://localhost:3010/api/ipos?status=OPEN" "Open IPOs"
test_endpoint "http://localhost:3010/api/calendar/materialized/MAINBOARD" "Calendar (Mainboard)"
test_endpoint "http://localhost:3010/api/calendar/materialized/SME" "Calendar (SME)"
test_endpoint "http://localhost:3010/api/registrars" "Registrars"
test_endpoint "http://localhost:3010/api/market-holidays" "Market Holidays"
test_endpoint "http://localhost:3010/api/sectors" "Sectors"

echo ""
echo "=== Benchmark Complete ==="
EOF

chmod +x benchmark.sh
./benchmark.sh

# Expected: All endpoints < 500ms
```

---

### 7. Load Testing (Optional)

```bash
# Install Apache Bench if not already installed
# Windows: Download from Apache Lounge
# Linux: sudo apt-get install apache2-utils

# Test calendar endpoint
ab -n 100 -c 10 http://localhost:3010/api/calendar/materialized/MAINBOARD

# Expected results:
# - Requests per second: > 2.5 (cold cache)
# - Time per request: < 400ms (mean)
# - Failed requests: 0

# Test with warm cache
ab -n 100 -c 10 http://localhost:3010/api/calendar/materialized/MAINBOARD

# Expected results:
# - Requests per second: > 20
# - Time per request: < 50ms (mean)
```

---

## Success Criteria

### Performance Targets
- [ ] Calendar endpoint (cold cache): < 400ms
- [ ] Calendar endpoint (warm cache): < 50ms
- [ ] All other endpoints: < 500ms p95
- [ ] Zero timeout errors
- [ ] Zero 500 errors

### Cache Metrics
- [ ] Cache hit rate: > 80% after warm-up
- [ ] Redis response time: < 10ms
- [ ] Cache invalidation working (verify logs)

### Database Metrics
- [ ] Materialized view refresh: < 5 seconds
- [ ] View refresh completes without errors
- [ ] Index usage confirmed (check EXPLAIN ANALYZE)

### Infrastructure
- [ ] Connection pool healthy (no queued requests)
- [ ] No query timeouts
- [ ] No database deadlocks

---

## Troubleshooting

### Issue: Materialized view not found

```bash
# Check if view exists
psql -h localhost -U postgres -d ipodhan -c "\dv"

# If missing, run migration again
cd web
npm run db:migrate
```

---

### Issue: Calendar endpoint still slow

```bash
# Check if using materialized view
# Look for "calendar_view" in query plan
psql -h localhost -U postgres -d ipodhan -c "
  EXPLAIN ANALYZE
  SELECT * FROM calendar_view
  WHERE segment = 'MAINBOARD'
  LIMIT 10;
"

# Expected: "Seq Scan on calendar_view" (not JOIN operations)
```

---

### Issue: Cache not working

```bash
# Check Redis connection
curl http://localhost:3010/api/test-redis

# Expected: { "status": "success" }

# Check Redis manually
redis-cli
> GET calendar:mainboard:all

# If empty, cache hasn't been populated yet
```

---

### Issue: High database load

```bash
# Check slow queries
psql -h localhost -U postgres -d ipodhan -c "
  SELECT query, calls, mean_exec_time, max_exec_time
  FROM pg_stat_statements
  WHERE mean_exec_time > 100
  ORDER BY mean_exec_time DESC
  LIMIT 10;
"

# Look for queries > 500ms
```

---

## Rollback Procedures

### Rollback Materialized View

```sql
-- Drop materialized view
DROP MATERIALIZED VIEW IF EXISTS calendar_view CASCADE;
DROP FUNCTION IF EXISTS refresh_calendar_view();

-- Revert to old endpoint
-- Update frontend to use /api/calendar/[category] instead of /api/calendar/materialized/[category]
```

---

### Rollback Indexes

```sql
-- Find and drop performance indexes
DROP INDEX IF EXISTS idx_ipos_status_segment;
DROP INDEX IF EXISTS idx_calendar_view_dates;
-- ... (repeat for all new indexes)
```

---

## Production Deployment Checklist

- [ ] All tests passing locally
- [ ] Migrations reviewed by DBA
- [ ] Backup database before migration
- [ ] Test on staging environment first
- [ ] Monitor error logs during deployment
- [ ] Rollback plan ready
- [ ] Team notified of deployment window

---

## Monitoring After Deployment

### Check Health Endpoint

```bash
# Every 5 minutes for first hour
watch -n 300 'curl -s http://localhost:3010/api/health | jq'

# Look for:
# - cache.hitRate > 80%
# - database.waitingCount < 5
```

---

### Monitor Application Logs

```bash
# Watch for cache hits/misses
pm2 logs ipodhan-web | grep "API Cache"

# Watch for database pool events
pm2 logs ipodhan-web | grep "DB Pool"

# Watch for errors
pm2 logs ipodhan-web --err
```

---

### Monitor Database

```bash
# Check materialized view refresh
psql -h localhost -U postgres -d ipodhan -c "
  SELECT last_refresh
  FROM pg_stat_user_tables
  WHERE relname = 'calendar_view';
"

# Should update every hour

# Check index usage
psql -h localhost -U postgres -d ipodhan -c "
  SELECT schemaname, tablename, indexname, idx_scan
  FROM pg_stat_user_indexes
  WHERE idx_scan > 0
  ORDER BY idx_scan DESC
  LIMIT 20;
"

# New indexes should show usage
```

---

## Contact & Support

**Issues**: Create GitHub issue with tag `performance`
**Urgent**: Contact backend team
**Documentation**: `fixes/performance-optimization.md`

---

**Last Updated**: 2025-10-21
