# Quick Deployment Guide - Performance Optimization

**⚡ 5-Minute Deployment** | **Phase 5: API Performance Optimization**

---

## Pre-Deployment Checklist

- [ ] Database backup completed
- [ ] Staging environment tested
- [ ] Team notified
- [ ] Rollback plan ready

---

## Deployment Steps (5 minutes)

### Step 1: Backup Database (1 min)
```bash
pg_dump -h localhost -U postgres ipodhan > backup_$(date +%Y%m%d_%H%M%S).sql
```

---

### Step 2: Apply Migrations (2 min)
```bash
cd web

# Apply both migrations
npm run db:migrate

# Verify
psql -h localhost -U postgres -d ipodhan -c "\d calendar_view"
```

**Expected**: Materialized view with ~30 columns

---

### Step 3: Refresh Materialized View (1 min)
```bash
psql -h localhost -U postgres -d ipodhan -c "SELECT refresh_calendar_view();"

# Verify row count
psql -h localhost -U postgres -d ipodhan -c "SELECT COUNT(*) FROM calendar_view;"
```

**Expected**: Count matches IPOs with non-null dates

---

### Step 4: Deploy Application (1 min)
```bash
cd web
npm run build
pm2 restart ipodhan-web
```

---

### Step 5: Quick Smoke Test (30 sec)
```bash
# Test calendar endpoint
curl http://localhost:3010/api/calendar/materialized/MAINBOARD | jq '.count'

# Test health endpoint
curl http://localhost:3010/api/health | jq '.status'
```

**Expected**: Both return valid JSON

---

## Post-Deployment Monitoring (15 minutes)

### Minute 1-5: Immediate Check
```bash
# Watch logs for errors
pm2 logs ipodhan-web --lines 50

# Test all critical endpoints
curl http://localhost:3010/api/ipos
curl http://localhost:3010/api/calendar/materialized/MAINBOARD
curl http://localhost:3010/api/registrars
```

**Look for**: No 500 errors, all responses < 500ms

---

### Minute 5-15: Performance Validation
```bash
# Run benchmark
time curl -s http://localhost:3010/api/calendar/materialized/MAINBOARD > /dev/null
# Expected: < 400ms

# Check cache hit rate
curl -s http://localhost:3010/api/health | jq '.cache.hitRate'
# Expected: Will be low initially, should increase to 80%+

# Monitor database pool
curl -s http://localhost:3010/api/health | jq '.database'
# Expected: waitingCount = 0
```

---

## Success Criteria

✅ **PASS** if all true:
- [ ] No 500 errors in logs
- [ ] All endpoints responding
- [ ] Calendar endpoint < 400ms
- [ ] Health endpoint shows "healthy"
- [ ] Database pool waitingCount = 0

❌ **FAIL** - Initiate rollback if:
- [ ] Any 500 errors
- [ ] Calendar endpoint > 1000ms
- [ ] Database pool waitingCount > 10
- [ ] Memory usage > 90%

---

## Rollback Procedure (2 minutes)

```bash
# Step 1: Restore database
psql -h localhost -U postgres -d ipodhan < backup_YYYYMMDD_HHMMSS.sql

# Step 2: Revert code
git revert <commit-hash>
npm run build
pm2 restart ipodhan-web

# Step 3: Verify
curl http://localhost:3010/api/health
```

---

## Update Scraper (Optional - Can be done later)

```typescript
// scraper/src/scheduler/index.ts
import { refreshCalendarView, calendarRefreshSchedule } from '../jobs/refresh-calendar';

// Add to scheduler
schedule(calendarRefreshSchedule, refreshCalendarView);
```

**Note**: This can wait until next scraper deployment. Calendar will still work without it, just won't auto-refresh.

---

## Contact

**Issues**: Slack #backend-team
**Docs**: `fixes/performance-optimization.md`
**Testing**: `fixes/TESTING_INSTRUCTIONS.md`

---

## Quick Performance Test

```bash
#!/bin/bash
echo "=== Quick Performance Test ==="

# Test 5 critical endpoints
endpoints=(
  "http://localhost:3010/api/ipos"
  "http://localhost:3010/api/calendar/materialized/MAINBOARD"
  "http://localhost:3010/api/registrars"
  "http://localhost:3010/api/market-holidays"
  "http://localhost:3010/api/health"
)

for url in "${endpoints[@]}"; do
  echo -n "$(basename $url): "
  time curl -s "$url" > /dev/null 2>&1
done

echo "=== Test Complete ==="
```

**Expected**: All < 500ms

---

**Status**: ✅ READY
**Date**: 2025-10-21
**Deployment Time**: ~5 minutes
**Risk**: LOW (rollback available)
