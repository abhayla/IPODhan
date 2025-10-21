# Monitoring System - Quick Start Guide

Get IPODhan monitoring up and running in 5 minutes.

## Prerequisites

✅ PostgreSQL 16+ running
✅ Redis 7.2+ running
✅ Node.js 20+ installed
✅ Dependencies installed (`npm install`)

## Quick Setup (5 steps)

### 1. Enable PostgreSQL Statistics (1 minute)

```bash
# Connect to PostgreSQL
psql -U postgres -d ipodhan

# Run these commands
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
ALTER SYSTEM SET pg_stat_statements.track = 'all';
SELECT pg_reload_conf();

# Restart PostgreSQL
# Windows: net stop postgresql-x64-16 && net start postgresql-x64-16
# Linux: sudo systemctl restart postgresql
```

### 2. Configure Environment Variables (1 minute)

Create `.env.local` or add to existing:

```env
# Required (defaults work fine)
LOG_LEVEL=info
PROMETHEUS_PORT=9464

# Optional (for alerts)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK
ADMIN_EMAIL=admin@yourdomain.com
```

### 3. Verify Setup (1 minute)

```bash
cd web
npx tsx scripts/verify-monitoring-setup.ts
```

You should see:
```
✅ All critical components verified!
   Warnings are optional and can be configured later.
```

### 4. Start Application (1 minute)

```bash
npm run dev  # Development
# OR
npm run build && npm start  # Production
```

### 5. Test Monitoring (1 minute)

```bash
# Health check
curl http://localhost:3000/api/health-detailed | jq

# Metrics
curl http://localhost:3000/api/metrics | jq

# Prometheus metrics
curl http://localhost:9464/metrics
```

## You're Done! 🎉

Your monitoring system is now running.

---

## Daily Operations

### Check System Health

```bash
# Quick health check
curl http://localhost:3000/api/health | jq .status

# Detailed health
curl http://localhost:3000/api/health-detailed | jq

# Business metrics
curl http://localhost:3000/api/metrics | jq .business
```

### View Logs

```bash
# Real-time application logs
tail -f logs/app-$(date +%Y-%m-%d).log | jq

# Recent errors
tail -20 logs/error-$(date +%Y-%m-%d).log | jq

# Performance metrics
tail -20 logs/performance-$(date +%Y-%m-%d).log | jq
```

### Run Health Checks

```bash
# Database health
npx tsx scripts/db-health-check.ts

# Redis health
npx tsx scripts/monitor-redis.ts
```

---

## Troubleshooting

### Issue: No logs being created

**Solution**:
```bash
# Check if logs directory exists
ls -la logs/

# Create if missing
mkdir -p logs
```

### Issue: Prometheus metrics 404

**Solution**:
```bash
# Check if instrumentation is loaded
grep "Prometheus metrics endpoint ready" logs/app-*.log

# Verify PROMETHEUS_PORT
echo $PROMETHEUS_PORT  # Should be 9464
```

### Issue: High memory warnings

**Solution**:
```bash
# Check current memory
curl http://localhost:3000/api/health-detailed | jq .checks.memory

# Restart if needed
pm2 restart ipodhan-web
```

---

## Alert Setup (Optional)

### Discord Alerts

1. Go to Discord Server Settings > Integrations > Webhooks
2. Create New Webhook
3. Copy Webhook URL
4. Add to `.env.local`:
   ```env
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN
   ```
5. Test:
   ```bash
   curl -X POST -H "Content-Type: application/json" \
     -d '{"content":"Test from IPODhan monitoring"}' \
     $DISCORD_WEBHOOK_URL
   ```

---

## What Gets Monitored?

### Application Metrics ✅
- API response times
- Error rates
- Request volumes

### Database Metrics ✅
- Query performance
- Connection pool usage
- Cache hit ratio
- Slow queries (> 100ms)

### Redis Metrics ✅
- Cache hit rate
- Memory usage
- Eviction rate
- Connection health

### Business Metrics ✅
- IPO counts (by status, segment)
- Scraper success rate
- Data freshness
- Data quality

### System Metrics ✅
- Memory usage
- CPU usage
- Disk space
- Uptime

---

## Key Files

| File | Purpose |
|------|---------|
| `logs/app-*.log` | Application logs |
| `logs/error-*.log` | Error logs |
| `logs/performance-*.log` | Performance metrics |
| `lib/logging/logger.ts` | Logger configuration |
| `lib/monitoring/alerts.ts` | Alert system |
| `scripts/db-health-check.ts` | DB monitoring |
| `scripts/monitor-redis.ts` | Redis monitoring |

---

## Performance Targets

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| API Response | < 500ms (p95) | > 1000ms |
| DB Query | < 100ms (p95) | > 500ms |
| Cache Hit Rate | > 80% | < 60% |
| Memory Usage | < 500MB | > 800MB |

---

## Daily Checklist

- [ ] Check `/api/health` status
- [ ] Review error logs
- [ ] Verify scraper success rate > 90%
- [ ] Check cache hit rate > 80%
- [ ] Monitor memory usage < 500MB

---

## Need More Help?

- **Full Documentation**: `test-results/phase-5/enhanced-monitoring-report.md`
- **Quick Reference**: `web/docs/MONITORING_QUICK_REFERENCE.md`
- **API Guide**: Use `curl http://localhost:3000/api/metrics | jq`

---

**Setup Time**: 5 minutes
**Daily Maintenance**: 5 minutes
**Documentation**: Complete ✅
