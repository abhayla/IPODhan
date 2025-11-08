# IPODhan Operations Runbook
## Data Flow Architecture - Phase 3.4 Edition

**Document Version**: 1.0
**Last Updated**: 2025-11-08
**Target Audience**: On-call Engineers, SRE, DevOps
**Escalation Contact**: Lead Developer / Product Owner

---

## 📖 TABLE OF CONTENTS

1. [Quick Reference](#quick-reference)
2. [System Architecture Overview](#system-architecture-overview)
3. [Common Issues & Solutions](#common-issues--solutions)
4. [Emergency Procedures](#emergency-procedures)
5. [Monitoring Dashboards](#monitoring-dashboards)
6. [Useful Commands](#useful-commands)
7. [Escalation Matrix](#escalation-matrix)
8. [Change Log](#change-log)

---

## 🚀 QUICK REFERENCE

### Critical Systems

| Component | Location | Process Manager | Logs Location | Health Check |
|-----------|----------|----------------|---------------|--------------|
| **Web App** | `/path/to/ipodhan/web` | PM2: `ipodhan-web` | `logs/app-*.log` | `curl http://localhost:3000/api/health` |
| **Scraper** | `/path/to/ipodhan/scraper` | PM2: `ipodhan-scheduler` | `logs/scraper-*.log` | `pm2 status ipodhan-scheduler` |
| **Database** | PostgreSQL 16 | systemd | `/var/log/postgresql/` | `psql -c "SELECT 1;"` |
| **Cache** | Redis 7.2+ | systemd | `/var/log/redis/` | `redis-cli PING` |

### Emergency Contacts

| Role | Name | Contact | Availability |
|------|------|---------|--------------|
| **Lead Developer** | TBD | TBD | 24/7 (PagerDuty) |
| **DevOps Lead** | TBD | TBD | 24/7 (PagerDuty) |
| **DBA** | TBD | TBD | Business hours + On-call rotation |
| **Product Owner** | TBD | TBD | Business hours |

### Quick Commands

```bash
# System Status
pm2 status
pm2 logs --lines 50
systemctl status postgresql
systemctl status redis

# Restart Services
pm2 restart ipodhan-web
pm2 restart ipodhan-scheduler

# Database Health
psql -U postgres -d ipodhan -c "SELECT COUNT(*) FROM ipos;"
psql -U postgres -d ipodhan -c "SELECT COUNT(*) FROM pg_stat_activity;"

# Cache Health
redis-cli INFO stats
redis-cli KEYS "*" | wc -l
```

---

## 🏗️ SYSTEM ARCHITECTURE OVERVIEW

### Data Flow (5 Layers)

```
┌─────────────────────────────────────────────┐
│  1. DETECTION LAYER                          │
│     - SEBI Monitor (T-60 days)               │
│     - NSE/BSE Exchange APIs (Hourly)         │
│     - GMP Scrapers (Daily)                   │
└─────────────────┬───────────────────────────┘
                  ↓
┌─────────────────────────────────────────────┐
│  2. EXTRACTION LAYER                         │
│     - DRHP Extractor (Python Bridge)         │
│     - NSE/BSE Scrapers (Puppeteer)           │
│     - Moneycontrol/Chittorgarh Scrapers      │
└─────────────────┬───────────────────────────┘
                  ↓
┌─────────────────────────────────────────────┐
│  3. CONSOLIDATION LAYER                      │
│     - Normalization Engine                   │
│     - Conflict Detection                     │
│     - Priority Resolution (ADMIN>DRHP>NSE)   │
│     - Field Protection                       │
└─────────────────┬───────────────────────────┘
                  ↓
┌─────────────────────────────────────────────┐
│  4. PERSISTENCE LAYER                        │
│     - Database Writer (Drizzle ORM)          │
│     - Cache Invalidator (Redis)              │
│     - Distributed Locking (Race Prevention)  │
└─────────────────┬───────────────────────────┘
                  ↓
┌─────────────────────────────────────────────┐
│  5. MONITORING LAYER                         │
│     - Admin Dashboard (/admin/conflicts,     │
│       /admin/metrics, /admin/manual-review)  │
│     - Winston Logs (JSON, daily rotation)    │
│     - Sentry APM (Performance, Errors)       │
└─────────────────────────────────────────────┘
```

### Key Feature Flags

```bash
# Core Features (should be 'true' in production)
ENABLE_SOURCE_TRACKING=true
ENABLE_CONFLICT_DETECTION=true
ENABLE_DATA_CONSOLIDATION=true
ENABLE_DRHP_EXTRACTION=true

# Rollout Percentages (should be '100' in production)
SOURCE_TRACKING_PERCENTAGE=100
CONFLICT_DETECTION_PERCENTAGE=100
CONSOLIDATION_PERCENTAGE=100
```

---

## 🛠️ COMMON ISSUES & SOLUTIONS

### Issue 1: Scraper Failures (NSE/BSE Down)

**Symptoms**:
- PM2 logs show "NSE scraper failed"
- Error: "ECONNREFUSED" or "Timeout"
- `/admin/metrics` shows detection count = 0 for >6 hours

**Root Cause**:
- NSE/BSE website temporarily down or blocked IP
- Network connectivity issues
- Page structure changed (rare but possible)

**Solution**:
```bash
# 1. Check if NSE/BSE websites are accessible
curl -I https://www.nseindia.com
curl -I https://www.bseindia.com

# 2. If websites are up but scraper fails, check logs
pm2 logs ipodhan-scheduler | grep -i "nse scraper"

# 3. Restart scraper to retry
pm2 restart ipodhan-scheduler

# 4. If still failing after 3 attempts, switch to fallback source
# Edit .env and temporarily disable problematic scraper:
cd /path/to/ipodhan/scraper
nano .env
# Add: ENABLED_SCRAPERS=BSE,MONEYCONTROL  # Exclude NSE temporarily

pm2 restart ipodhan-scheduler

# 5. Monitor for 1 hour. If NSE comes back, re-enable:
# Remove ENABLED_SCRAPERS override
pm2 restart ipodhan-scheduler
```

**Escalation Criteria**:
- If NSE/BSE down for >12 hours → Alert Lead Developer
- If scraper consistently fails after site structure change → Alert Lead Developer (urgent fix needed)

---

### Issue 2: DRHP Extraction Timeout

**Symptoms**:
- PM2 logs show "DRHP extraction timeout after 30s"
- `/admin/metrics` shows DRHP failures >5
- Documents table has many `extraction_status = 'FAILED'`

**Root Cause**:
- PDF file too large (>50MB)
- Python script hung or crashed
- Complex PDF structure (scanned images, poor OCR)

**Solution**:
```bash
# 1. Check failed extractions
psql -U postgres -d ipodhan -c "
  SELECT id, ipo_id, url, extraction_error
  FROM documents
  WHERE extraction_status = 'FAILED'
  ORDER BY extracted_at DESC
  LIMIT 10;
"

# 2. Check Python process status
ps aux | grep extraction_v3.py
# If hung, kill: kill -9 <PID>

# 3. Retry extraction for specific IPO manually
cd /path/to/ipodhan/pdf-parser-test
python3 extraction_v3.py \
  --pdf /path/to/drhp.pdf \
  --ipo-id <ipo_id_from_query> \
  --output-format json

# 4. If extraction succeeds manually, issue was transient. Mark for retry:
psql -U postgres -d ipodhan -c "
  UPDATE documents
  SET extraction_status = 'PENDING', retry_count = retry_count + 1
  WHERE id = '<document_id>';
"

# 5. If extraction fails manually, queue for manual review:
psql -U postgres -d ipodhan -c "
  UPDATE documents
  SET extraction_status = 'MANUAL_REVIEW'
  WHERE id = '<document_id>';
"
# Notify data team via Slack/Email to manually extract data
```

**Escalation Criteria**:
- If >10 DRHPs fail in 24 hours → Alert Data Team Lead
- If Python script consistently crashes → Alert Lead Developer

---

### Issue 3: Redis Connection Loss

**Symptoms**:
- PM2 logs show "[Redis] Connection error"
- Application continues functioning (falls back to database)
- API response times increase (cache misses)

**Root Cause**:
- Redis server crashed or restarted
- Network connectivity issues
- Redis max memory exceeded

**Solution**:
```bash
# 1. Check Redis status
systemctl status redis
# OR (if standalone):
ps aux | grep redis-server

# 2. If Redis is down, restart it
systemctl restart redis
# OR:
redis-server /etc/redis/redis.conf &

# 3. Verify Redis connection
redis-cli PING
# Expected: PONG

# 4. Check Redis memory usage
redis-cli INFO memory | grep used_memory_human
# If >90% of maxmemory, clear cache:
redis-cli FLUSHDB

# 5. Restart web application to reconnect to Redis
pm2 restart ipodhan-web

# 6. Verify cache working
redis-cli KEYS "*" | wc -l
# Should start populating as requests come in
```

**Escalation Criteria**:
- If Redis crashes repeatedly (>3 times in 24h) → Alert DevOps Lead
- If Redis memory grows unbounded → Alert DevOps Lead (memory leak possible)

---

### Issue 4: Database Connection Pool Exhausted

**Symptoms**:
- PM2 logs show "Connection pool timeout"
- Error: "remaining connection slots are reserved"
- API requests hang or timeout
- `/admin/metrics` shows >45 active connections

**Root Cause**:
- Too many concurrent requests
- Connection leaks (not released after query)
- Long-running queries blocking pool

**Solution**:
```bash
# 1. Check active connections
psql -U postgres -d ipodhan -c "
  SELECT COUNT(*), state
  FROM pg_stat_activity
  WHERE datname = 'ipodhan'
  GROUP BY state;
"
# Expected: <40 active connections

# 2. Identify long-running queries
psql -U postgres -d ipodhan -c "
  SELECT pid, now() - pg_stat_activity.query_start AS duration, query
  FROM pg_stat_activity
  WHERE state = 'active' AND now() - pg_stat_activity.query_start > interval '30 seconds'
  ORDER BY duration DESC;
"

# 3. Kill long-running queries if safe (backup/reporting queries only):
# DO NOT kill scraper or production queries without Lead Dev approval
psql -U postgres -d ipodhan -c "SELECT pg_terminate_backend(<PID>);"

# 4. Restart web application to reset connection pool
pm2 restart ipodhan-web

# 5. If pool exhaustion persists, increase pool size (emergency fix):
cd /path/to/ipodhan/web
nano .env.local
# Add: DATABASE_POOL_SIZE=60  # Increase from 50 to 60
pm2 restart ipodhan-web

# 6. Monitor for 30 minutes
watch -n 10 'psql -U postgres -d ipodhan -c "SELECT COUNT(*) FROM pg_stat_activity WHERE datname = '\''ipodhan'\'';"'
```

**Escalation Criteria**:
- If connection pool exhaustion persists >1 hour → Alert DBA + Lead Developer
- If identified query is production-critical and blocking → Immediate escalation to Lead Developer

---

### Issue 5: Conflict Dashboard Not Loading

**Symptoms**:
- `/admin/conflicts` returns 500 error or blank page
- Error in logs: "Cannot read property 'field_sources' of undefined"
- Conflicts table accessible via SQL but not via UI

**Root Cause**:
- Database query timeout (too many conflicts)
- JSONB `field_sources` column malformed for some IPOs
- React component crash

**Solution**:
```bash
# 1. Check if conflicts table accessible
psql -U postgres -d ipodhan -c "SELECT COUNT(*) FROM data_conflicts;"
# If this works, table is fine

# 2. Check for malformed field_sources
psql -U postgres -d ipodhan -c "
  SELECT id, field_sources
  FROM ipos
  WHERE field_sources IS NOT NULL
  AND field_sources::text !~ '^\{.*\}$'
  LIMIT 10;
"
# If rows returned, JSONB is malformed. Fix:
psql -U postgres -d ipodhan -c "
  UPDATE ipos
  SET field_sources = '{}'::JSONB
  WHERE field_sources IS NOT NULL
  AND field_sources::text !~ '^\{.*\}$';
"

# 3. Check conflict dashboard API endpoint
curl http://localhost:3000/api/admin/conflicts?limit=10
# If this fails, issue is backend. Check logs:
pm2 logs ipodhan-web | grep "/api/admin/conflicts"

# 4. If API works but UI doesn't, clear browser cache or restart web app
pm2 restart ipodhan-web

# 5. If issue persists, temporarily reduce conflict list limit:
# Edit API route to force smaller limit (emergency fix):
cd /path/to/ipodhan/web/app/api/admin/conflicts
nano route.ts
# Change: const limit = Math.min(parseInt(limitParam) || 50, 100);
# To:     const limit = Math.min(parseInt(limitParam) || 10, 20);  # Smaller default
pm2 restart ipodhan-web
```

**Escalation Criteria**:
- If dashboard completely unusable >2 hours → Alert Lead Developer
- If JSONB corruption affects >10% of IPOs → Alert DBA + Lead Developer (data integrity issue)

---

### Issue 6: High Conflict Rate (>5%)

**Symptoms**:
- `/admin/metrics` shows conflict rate >5%
- Hundreds of CRITICAL conflicts in dashboard
- Alert: "CRITICAL conflicts >10"

**Root Cause**:
- Scraper sources providing wildly different data (indicates scraper bug or source data quality issue)
- Field priority matrix not working correctly
- Data normalization failing (e.g., "500 Cr" not matching "5000000000")

**Solution**:
```bash
# 1. Identify which fields have most conflicts
psql -U postgres -d ipodhan -c "
  SELECT field_name, COUNT(*) as conflict_count
  FROM data_conflicts
  WHERE resolved_at IS NULL
  GROUP BY field_name
  ORDER BY conflict_count DESC
  LIMIT 10;
"

# 2. Check specific field conflicts for pattern
psql -U postgres -d ipodhan -c "
  SELECT
    dc.ipo_id,
    i.company_name,
    dc.field_name,
    dc.source1, dc.value1,
    dc.source2, dc.value2
  FROM data_conflicts dc
  JOIN ipos i ON dc.ipo_id = i.id
  WHERE dc.field_name = '<top_conflict_field>'
  AND dc.resolved_at IS NULL
  LIMIT 20;
"

# 3. If values are equivalent but mismatched format (e.g., "500" vs "500.00"):
# This is a normalization bug. Enable auto-resolve for equivalence:
# Navigate to /admin/conflicts dashboard
# Click "Auto-Resolve" > "Dry Run" to preview
# If safe, click "Resolve" to automatically resolve equivalent conflicts

# 4. If values are genuinely different:
# Investigate which source is correct:
# - Check NSE official website manually
# - Compare with DRHP PDF if available
# - Check BSE for validation
# Then bulk-resolve favoring correct source in dashboard

# 5. If issue is scraper bug (e.g., NSE returning wrong data):
# Disable problematic scraper temporarily:
cd /path/to/ipodhan/scraper
nano .env
# Add: ENABLED_SCRAPERS=BSE,DRHP  # Exclude NSE
pm2 restart ipodhan-scheduler
# Alert Lead Developer to fix scraper
```

**Escalation Criteria**:
- If conflict rate >10% → Immediate escalation to Lead Developer (critical bug)
- If conflicts for financial data (revenue, profit) → Alert Data Team Lead (manual verification needed)

---

### Issue 7: Duplicate IPOs Created

**Symptoms**:
- Database query shows multiple IPOs with same company name
- Alert: "Duplicate IPOs detected"
- Users report seeing same IPO listed twice

**Root Cause**:
- Distributed lock failure (race condition)
- Slug generation inconsistency
- Different scrapers detecting same IPO with slight name variation

**Solution**:
```bash
# 1. Identify duplicates
psql -U postgres -d ipodhan -c "
  SELECT company_name, slug, COUNT(*) as count, array_agg(id) as ipo_ids
  FROM ipos
  GROUP BY company_name, slug
  HAVING COUNT(*) > 1
  ORDER BY count DESC;
"

# 2. For each duplicate set, determine which is canonical:
# - Check created_at timestamps (earliest is usually correct)
# - Check data completeness (IPO with more fields is canonical)
# - Check source (DRHP > NSE > BSE)

psql -U postgres -d ipodhan -c "
  SELECT id, company_name, created_at, status, source
  FROM ipos
  WHERE id IN ('<id1>', '<id2>')  -- From duplicate set
  ORDER BY created_at ASC;
"

# 3. Merge duplicates (manual process):
# A. Update foreign key references to point to canonical IPO
psql -U postgres -d ipodhan -c "
  UPDATE subscriptions SET ipo_id = '<canonical_id>' WHERE ipo_id = '<duplicate_id>';
  UPDATE gmp_records SET ipo_id = '<canonical_id>' WHERE ipo_id = '<duplicate_id>';
  UPDATE documents SET ipo_id = '<canonical_id>' WHERE ipo_id = '<duplicate_id>';
  UPDATE financial_data SET ipo_id = '<canonical_id>' WHERE ipo_id = '<duplicate_id>';
  -- Repeat for all related tables
"

# B. Delete duplicate IPO
psql -U postgres -d ipodhan -c "
  DELETE FROM ipos WHERE id = '<duplicate_id>';
"

# 4. Clear cache to remove duplicate from listings
redis-cli FLUSHDB

# 5. Investigate root cause:
# Check scraper logs for lock failures
pm2 logs ipodhan-scheduler | grep "lock timeout" | tail -50

# If lock timeouts found, this is a Redis issue. See Issue #3.
```

**Escalation Criteria**:
- If >1 duplicate created per week → Immediate escalation to Lead Developer (critical bug)
- If merge operation affects >100 records → Alert DBA before proceeding (data integrity risk)

**⚠️ IMPORTANT**: Duplicate IPO cleanup must be done carefully. Always backup database before bulk operations.

---

## 🚨 EMERGENCY PROCEDURES

### Emergency 1: Complete System Outage

**Situation**: Web application down, users cannot access site

**Triage Steps** (2 minutes):
```bash
# 1. Check web application status
pm2 status ipodhan-web
# If status = stopped or errored, proceed to restart

# 2. Check logs for crash reason
pm2 logs ipodhan-web --err --lines 100

# 3. Restart web application
pm2 restart ipodhan-web

# 4. Verify health
curl http://localhost:3000/api/health
```

**If restart fails**:
```bash
# 1. Check database connectivity
psql -U postgres -d ipodhan -c "SELECT 1;"
# If fails: systemctl restart postgresql

# 2. Check Redis connectivity
redis-cli PING
# If fails: systemctl restart redis

# 3. Try starting web app manually to see detailed error:
cd /path/to/ipodhan/web
npm run start 2>&1 | tee /tmp/startup-error.log
# Review /tmp/startup-error.log for root cause

# 4. If port conflict (port 3000 already in use):
lsof -i :3000
kill -9 <PID_from_above>
pm2 restart ipodhan-web
```

**Escalation**: If system doesn't recover in 15 minutes → Page Lead Developer (CRITICAL)

---

### Emergency 2: Data Corruption Detected

**Situation**: Database query returns nonsensical data (e.g., negative issue size, future dates for closed IPOs)

**Immediate Actions**:
```bash
# 1. STOP ALL SCRAPERS IMMEDIATELY
pm2 stop ipodhan-scheduler

# 2. Take database snapshot
pg_dump -U postgres -d ipodhan -F c -f /tmp/emergency_backup_$(date +%Y%m%d_%H%M%S).dump

# 3. Identify extent of corruption
psql -U postgres -d ipodhan -c "
  SELECT COUNT(*) FROM ipos WHERE issue_size < 0;
  SELECT COUNT(*) FROM ipos WHERE close_date > NOW();
  SELECT COUNT(*) FROM ipos WHERE open_date > close_date;
"

# 4. If corruption affects <10 IPOs:
# Manually fix affected records via /admin dashboard or SQL
# DO NOT RESTART SCRAPERS until root cause identified

# 5. If corruption affects >10 IPOs:
# DO NOT ATTEMPT TO FIX
# Immediately page Lead Developer + DBA
# Preserve /tmp/emergency_backup_* file
# Preserve all logs: tar -czf /tmp/logs_$(date +%Y%m%d_%H%M%S).tar.gz logs/
```

**Escalation**: Immediate page to Lead Developer + DBA (CRITICAL - P0 incident)

**DO NOT**:
- Do not restart scrapers until approved by Lead Developer
- Do not attempt bulk UPDATE operations without DBA approval
- Do not delete any data

---

### Emergency 3: Mass Scraper Failures (All Sources Down)

**Situation**: NSE, BSE, Moneycontrol all failing simultaneously for >6 hours

**Workaround - Manual Data Entry Workflow**:

1. **Activate Manual Review Queue**:
   ```bash
   # Flag all pending IPOs for manual review
   psql -U postgres -d ipodhan -c "
     UPDATE ipos
     SET status = 'MANUAL_REVIEW_REQUIRED'
     WHERE status = 'OPEN'
     AND updated_at < NOW() - INTERVAL '6 hours';
   "
   ```

2. **Notify Data Team**:
   - Send Slack message to #data-team: "All scrapers down. Manual entry required for active IPOs."
   - List affected IPOs: `psql -U postgres -d ipodhan -c "SELECT company_name FROM ipos WHERE status = 'MANUAL_REVIEW_REQUIRED';"`

3. **Manual Data Entry Process**:
   - Data team accesses `/admin/edit/<slug>` for each IPO
   - Manually copy data from NSE/BSE websites
   - Mark fields as "ADMIN" source (highest priority, prevents scraper overwrite)

4. **Monitor for Scraper Recovery**:
   ```bash
   # Check every hour
   curl -I https://www.nseindia.com  # Should return 200 OK when back
   ```

5. **Resume Normal Operations**:
   ```bash
   # When scrapers recover:
   pm2 restart ipodhan-scheduler
   # Monitor for 30 minutes to ensure stability
   ```

**Escalation**: If scrapers down >24 hours → Alert Product Owner (business impact assessment needed)

---

## 📊 MONITORING DASHBOARDS

### Dashboard 1: Admin Metrics Dashboard

**URL**: `https://ipodhan.com/admin/metrics`

**Purpose**: Real-time pipeline health monitoring

**Key Metrics**:
- **Quick Stats** (Top row):
  - IPOs detected (last 24h) - Expected: 1-5
  - Conflicts detected - Expected: <2% of total IPOs
  - DRHPs extracted - Expected: 80%+ of detected IPOs
  - System health - Expected: HEALTHY (green)

- **Detection Metrics**:
  - Average detection latency - Expected: <6 hours
  - Source breakdown - Expected: NSE + BSE coverage

- **Consolidation Metrics**:
  - Conflict rate - Expected: <2%
  - Average latency - Expected: <500ms (p95)
  - Lock timeouts - Expected: 0

- **DRHP Metrics**:
  - Average extraction confidence - Expected: >90%
  - Extraction failures - Expected: <5 per day
  - Queued for manual review - Expected: <3

- **Data Quality Metrics**:
  - Field completeness - Expected: >80%
  - Source tracking coverage - Expected: >95%

**Check Frequency**: Daily (morning) + when alerted

**Auto-refresh**: Toggle ON for live monitoring (5-minute intervals)

---

### Dashboard 2: Conflict Resolution Dashboard

**URL**: `https://ipodhan.com/admin/conflicts`

**Purpose**: Review and resolve data conflicts

**Key Sections**:
- **Statistics** (Top cards):
  - Total conflicts - Monitor trend (should be stable or decreasing)
  - CRITICAL conflicts - Expected: 0-5 (alert if >10)
  - WARNING conflicts - Expected: <20
  - INFO conflicts - Expected: <50

- **Conflict List**:
  - Filters: Severity, IPO, Field name
  - Color codes: Red (CRITICAL), Yellow (WARNING), Blue (INFO)
  - Actions: Resolve single, Bulk resolve, Auto-resolve

**Check Frequency**: When alerted (CRITICAL conflicts >10) or daily if conflicts >20

**Workflow**:
1. Filter by CRITICAL severity first
2. Review conflicting values (source1 vs source2)
3. Decide correct source (check NSE/BSE official sites if unsure)
4. Resolve conflict or bulk-resolve if pattern identified

---

### Dashboard 3: Manual Review Queue

**URL**: `https://ipodhan.com/admin/manual-review` (if implemented)

**Purpose**: Review DRHPs with low extraction confidence (<70%)

**Key Sections**:
- Pending reviews - DRHPs awaiting manual verification
- In progress - Currently being reviewed by data team
- Completed - Successfully reviewed and approved

**Check Frequency**: Daily if queue >5 items

**Workflow**:
1. Click DRHP document to view PDF
2. Manually verify extracted financial data
3. Correct any errors in admin form
4. Mark as "Reviewed" to approve

---

### Dashboard 4: Sentry APM

**URL**: `https://sentry.io/<your-org>/ipodhan` (if configured)

**Purpose**: Error tracking and performance monitoring

**Key Metrics**:
- Error rate - Expected: <10 errors/hour
- p95 response time - Expected: <500ms
- Transaction volume - Monitor for sudden spikes/drops

**Check Frequency**: When alerted (error rate spike) or weekly

---

### Dashboard 5: Winston Logs

**Location**: `logs/` directory

**Files**:
- `app-YYYY-MM-DD.log` - General application logs (14-day retention)
- `error-YYYY-MM-DD.log` - Error logs only (30-day retention)
- `performance-YYYY-MM-DD.log` - Performance metrics (7-day retention)

**Useful Queries**:
```bash
# Tail live logs
tail -f logs/app-$(date +%Y-%m-%d).log

# Search for errors in last hour
grep -i error logs/app-$(date +%Y-%m-%d).log | tail -50

# Check consolidation latency
grep "consolidation latency" logs/performance-$(date +%Y-%m-%d).log | tail -20

# Check DRHP extraction success rate
grep "DRHP extraction" logs/app-$(date +%Y-%m-%d).log | grep -c "SUCCESS"
grep "DRHP extraction" logs/app-$(date +%Y-%m-%d).log | grep -c "FAILED"
```

**Check Frequency**: As needed when troubleshooting issues

---

## 🔧 USEFUL COMMANDS

### Database Queries

```bash
# Count IPOs by status
psql -U postgres -d ipodhan -c "
  SELECT status, COUNT(*) FROM ipos GROUP BY status ORDER BY count DESC;
"

# Check recent conflicts (last 24h)
psql -U postgres -d ipodhan -c "
  SELECT
    dc.field_name,
    i.company_name,
    dc.source1, dc.source2,
    dc.severity,
    dc.detected_at
  FROM data_conflicts dc
  JOIN ipos i ON dc.ipo_id = i.id
  WHERE dc.detected_at > NOW() - INTERVAL '24 hours'
  AND dc.resolved_at IS NULL
  ORDER BY dc.severity DESC, dc.detected_at DESC
  LIMIT 20;
"

# Check DRHP extraction status breakdown
psql -U postgres -d ipodhan -c "
  SELECT extraction_status, COUNT(*) as count
  FROM documents
  WHERE type = 'DRHP'
  GROUP BY extraction_status
  ORDER BY count DESC;
"

# Find IPOs missing financial data
psql -U postgres -d ipodhan -c "
  SELECT i.company_name, i.status, i.created_at
  FROM ipos i
  LEFT JOIN financial_data fd ON i.id = fd.ipo_id
  WHERE fd.id IS NULL
  AND i.status IN ('OPEN', 'CLOSED', 'LISTED')
  ORDER BY i.created_at DESC
  LIMIT 20;
"

# Check source tracking coverage
psql -U postgres -d ipodhan -c "
  SELECT
    (SELECT COUNT(*) FROM field_sources) as tracked_fields,
    (SELECT COUNT(*) FROM ipos) as total_ipos,
    ROUND((SELECT COUNT(*) FROM field_sources)::numeric / (SELECT COUNT(*) FROM ipos), 2) as avg_tracked_per_ipo
  ;
"

# Database health metrics
psql -U postgres -d ipodhan -c "
  SELECT
    (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = 'ipodhan') as active_connections,
    (SELECT pg_database_size('ipodhan') / 1024 / 1024) as db_size_mb,
    (SELECT COUNT(*) FROM ipos) as total_ipos,
    (SELECT COUNT(*) FROM data_conflicts WHERE resolved_at IS NULL) as unresolved_conflicts
  ;
"
```

### PM2 Process Management

```bash
# View all processes
pm2 list

# View logs (all processes)
pm2 logs

# View logs for specific process
pm2 logs ipodhan-web
pm2 logs ipodhan-scheduler

# Restart process
pm2 restart ipodhan-web
pm2 restart ipodhan-scheduler

# Stop process
pm2 stop ipodhan-web

# Start process
pm2 start ipodhan-web

# Delete process (removes from PM2 list)
pm2 delete ipodhan-web

# Monitor resources in real-time
pm2 monit

# Show process metadata
pm2 describe ipodhan-web
```

### Redis Commands

```bash
# Connect to Redis CLI
redis-cli

# Ping Redis
redis-cli PING

# Get Redis info
redis-cli INFO

# Get memory usage
redis-cli INFO memory | grep used_memory_human

# Count keys
redis-cli KEYS "*" | wc -l

# View all keys (use with caution in production)
redis-cli KEYS "*"

# View keys matching pattern
redis-cli KEYS "ipo:*"
redis-cli KEYS "conflict:*"

# Get specific key value
redis-cli GET "ipo:slug:xyz-corporation"

# Delete specific key
redis-cli DEL "ipo:slug:xyz-corporation"

# Delete all keys matching pattern (DANGEROUS)
redis-cli --scan --pattern "ipo:list:*" | xargs redis-cli DEL

# Flush entire database (VERY DANGEROUS - production data loss)
redis-cli FLUSHDB  # Use only in emergencies or with approval

# Monitor Redis commands in real-time
redis-cli MONITOR
```

### System Health Checks

```bash
# Check disk space
df -h

# Check memory usage
free -h

# Check CPU usage
top -bn1 | head -20

# Check network connectivity
ping -c 3 google.com
curl -I https://www.nseindia.com

# Check PostgreSQL status
systemctl status postgresql
# OR
pg_isready -h localhost -p 5432

# Check Redis status
systemctl status redis
# OR
redis-cli PING

# Check process resource usage
ps aux | grep node  # Web app + scraper
ps aux | grep postgres
ps aux | grep redis
```

### Log Management

```bash
# Tail live application log
tail -f logs/app-$(date +%Y-%m-%d).log

# Search for errors in last hour
grep -i error logs/app-$(date +%Y-%m-%d).log | tail -50

# Search across all log files
grep -r "specific error message" logs/

# Count errors by type
grep -i error logs/app-$(date +%Y-%m-%d).log | cut -d' ' -f5 | sort | uniq -c | sort -rn

# Archive old logs (manual cleanup if needed)
tar -czf logs_archive_$(date +%Y%m%d).tar.gz logs/*.log
# Then delete old logs older than retention period

# Monitor log file size
du -sh logs/
ls -lh logs/ | tail -10
```

---

## 📞 ESCALATION MATRIX

### Escalation Levels

| Level | Severity | Response Time | Contact |
|-------|----------|--------------|---------|
| **L0** | INFO | Best effort | Self-resolve using runbook |
| **L1** | LOW | <4 hours | DevOps on-call |
| **L2** | MEDIUM | <2 hours | DevOps Lead + Lead Developer (email) |
| **L3** | HIGH | <30 minutes | Lead Developer (phone/Slack) |
| **L4** | CRITICAL | <15 minutes | Lead Developer + Product Owner (PagerDuty) |

### Escalation Triggers

**L1 (LOW - <4 hours)**:
- Single scraper failure (<6 hours downtime)
- Redis disconnection (app functioning normally)
- <5 DRHP extraction failures per day
- Conflict rate 2-5%

**L2 (MEDIUM - <2 hours)**:
- Multiple scraper failures (>2 sources down)
- Redis down >2 hours
- Database connection pool at 80%+ utilization
- Conflict rate 5-10%
- Admin dashboard slow (>2s load time)

**L3 (HIGH - <30 minutes)**:
- Web application down (users affected)
- All scrapers down >6 hours
- Database connection pool exhausted
- Conflict rate >10%
- CRITICAL conflicts >10
- Data corruption suspected (affecting <10 records)

**L4 (CRITICAL - <15 minutes)**:
- Complete system outage (web + database)
- Data corruption confirmed (affecting >10 records)
- Security breach detected
- Duplicate IPOs created >5 per day
- Financial data incorrect (regulatory risk)

### Escalation Procedure

1. **Attempt Self-Resolution** (5-10 minutes):
   - Use this runbook to diagnose and fix
   - Document actions taken in incident log

2. **Escalate if Unresolved**:
   - Slack message to appropriate channel (#dev-alerts for L2+, #critical-alerts for L4)
   - Include:
     - Issue description
     - Actions already taken
     - Current impact (users affected, data at risk, etc.)
     - Relevant logs/screenshots

3. **Create Incident Ticket** (for L2+):
   - Use incident management system (Jira/Linear/PagerDuty)
   - Link to Slack thread
   - Update as investigation progresses

4. **Post-Incident Review** (for L3+):
   - Schedule review meeting within 48 hours
   - Document root cause, impact, resolution
   - Create action items for prevention

---

## 📝 CHANGE LOG

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2025-11-08 | 1.0 | Initial runbook creation for Phase 3.4 | Claude (AI System) |

---

**END OF OPERATIONS RUNBOOK**

*For questions or suggestions to improve this runbook, contact: [Lead Developer Email]*
