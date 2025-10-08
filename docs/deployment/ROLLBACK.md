# IPODhan Production Rollback Procedures

**Story:** 8.4a - Production Deployment - Dev Machine Preparation
**Purpose:** Document rollback procedures for production deployment failures
**Audience:** Platform administrators and DevOps team
**Environment:** Windows Server 2022 VPS (103.118.16.189)

---

## Table of Contents

1. [When to Rollback](#when-to-rollback)
2. [Pre-Rollback Checklist](#pre-rollback-checklist)
3. [Application Rollback](#application-rollback)
4. [Database Rollback](#database-rollback)
5. [Cache Rollback](#cache-rollback)
6. [Verification Steps](#verification-steps)
7. [Emergency Contacts](#emergency-contacts)
8. [Post-Rollback Actions](#post-rollback-actions)

---

## When to Rollback

Execute rollback immediately if:

- **Critical functionality broken** - Core features (IPO listing, detail pages) are non-functional
- **Health check fails** - `/api/health` returns 503 for 3+ consecutive checks
- **Error rate >5%** - Sentry reports >5% error rate across requests
- **Memory leak detected** - PM2 shows memory continuously increasing beyond 500MB
- **Database corruption** - Data integrity issues detected
- **Scraper failure** - Scraper fails 3+ consecutive runs
- **User-facing errors** - Multiple user complaints about broken functionality

Do NOT rollback for:
- Minor UI issues that don't affect functionality
- Performance degradation <20%
- Single isolated errors
- Expected warnings in logs

---

## Pre-Rollback Checklist

Before initiating rollback:

- [ ] **Confirm the issue** - Verify the problem is not transient
- [ ] **Document the problem** - Screenshot errors, save logs, note timeline
- [ ] **Check previous deployment** - Ensure previous version is available
- [ ] **Notify stakeholders** - Inform team of rollback decision
- [ ] **Backup current logs** - Save PM2 logs for post-mortem analysis

```powershell
# Backup current logs
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
mkdir "C:\deployments\logs\rollback-$timestamp"
Copy-Item "logs\*.log" "C:\deployments\logs\rollback-$timestamp\"
pm2 logs --lines 500 > "C:\deployments\logs\rollback-$timestamp\pm2-logs.txt"
```

---

## Application Rollback

### Quick Rollback (No Database Changes)

If deployment did NOT include database migrations:

```powershell
# 1. Stop current deployment
pm2 stop all

# 2. Navigate to previous deployment
cd C:\deployments\ipodhan-deployment-{previous-timestamp}

# 3. Start previous version
pm2 start ecosystem.config.js

# 4. Save PM2 state
pm2 save

# 5. Verify rollback
curl http://localhost:3000/api/health
```

**Expected Time:** 2-3 minutes

### Full Rollback (With Code Restore)

If quick rollback fails or previous deployment is corrupted:

```powershell
# 1. Stop all services
pm2 stop all
pm2 delete all

# 2. Navigate to known-good deployment
cd C:\deployments\ipodhan-deployment-{last-known-good}

# 3. Verify deployment integrity
# Check that .next and dist folders exist
dir web\.next
dir scraper\dist

# 4. Start services
pm2 start ecosystem.config.js

# 5. Save PM2 state
pm2 save

# 6. Verify services
pm2 status
```

**Expected Time:** 5-10 minutes

---

## Database Rollback

### Database Migration Rollback

If deployment included database migrations that must be rolled back:

#### Option 1: Restore from Backup (Recommended)

```powershell
# 1. Stop application services
pm2 stop all

# 2. Connect to PostgreSQL
psql -h 103.118.16.189 -U postgres -d ipodhan

# 3. Drop current database (CRITICAL: Ensure backup exists!)
DROP DATABASE ipodhan;

# 4. Recreate database
CREATE DATABASE ipodhan;

# 5. Exit psql
\q

# 6. Restore from backup
psql -h 103.118.16.189 -U postgres -d ipodhan < C:\backups\ipodhan-{timestamp}.sql

# 7. Verify restore
psql -h 103.118.16.189 -U postgres -d ipodhan -c "SELECT COUNT(*) FROM ipos;"

# 8. Start previous application version
cd C:\deployments\ipodhan-deployment-{previous-timestamp}
pm2 start ecosystem.config.js
```

**Expected Time:** 10-20 minutes (depending on database size)

#### Option 2: Manual Migration Rollback (If No Backup)

```powershell
# WARNING: Only use if no backup exists and you understand the schema changes

# 1. Stop application
pm2 stop all

# 2. Navigate to previous deployment
cd C:\deployments\ipodhan-deployment-{previous-timestamp}

# 3. Manually reverse migration SQL
psql -h 103.118.16.189 -U postgres -d ipodhan

# Example: If migration added columns, drop them
# ALTER TABLE ipos DROP COLUMN IF EXISTS new_column;
# If migration created tables, drop them
# DROP TABLE IF EXISTS new_table;

# 4. Verify schema
\d ipos
\q

# 5. Start previous application
pm2 start ecosystem.config.js
```

**Expected Time:** 15-30 minutes (manual SQL required)

### Database Backup Best Practices

**Before ANY deployment with migrations:**

```powershell
# Create timestamped backup
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
pg_dump -h 103.118.16.189 -U postgres -d ipodhan > "C:\backups\ipodhan-$timestamp.sql"

# Verify backup
dir "C:\backups\ipodhan-$timestamp.sql"
```

---

## Cache Rollback

### Redis Cache Invalidation

After application rollback, clear Redis cache to prevent stale data:

```powershell
# Option 1: Flush all cache (recommended for rollback)
redis-cli -h 103.118.16.189 -a <redis-password> FLUSHALL

# Option 2: Flush only IPODhan keys
redis-cli -h 103.118.16.189 -a <redis-password>
> KEYS ipo:*
> DEL ipo:list:* ipo:detail:* ipo:subscription:* ipo:gmp:*
> KEYS sectors:*
> DEL sectors:list
> KEYS registrars:*
> DEL registrars:list
> EXIT
```

**Note:** Cache will be repopulated on first request after rollback.

---

## Verification Steps

After rollback is complete:

### 1. Health Check

```powershell
# Test health endpoint
curl http://localhost:3000/api/health

# Expected response:
# {
#   "status": "healthy",
#   "services": {
#     "database": "healthy",
#     "redis": "healthy"
#   }
# }
```

### 2. PM2 Status

```powershell
pm2 status

# Expected: All apps "online"
# ipodhan-web: 2 instances, cluster mode
# ipodhan-scraper: 1 instance, fork mode
```

### 3. Application Functionality

- [ ] Homepage loads: `http://103.118.16.189:3000`
- [ ] IPO list displays: `http://103.118.16.189:3000/api/ipos`
- [ ] IPO detail works: `http://103.118.16.189:3000/ipos/{any-slug}`
- [ ] Tools functional: `http://103.118.16.189:3000/tools/lot-calculator`

### 4. Monitor Logs

```powershell
# Watch logs for errors
pm2 logs --lines 100

# Should see normal startup messages, no errors
```

### 5. External Monitoring

- Check UptimeRobot status (should turn green within 5 minutes)
- Check Sentry error rate (should drop to <1%)
- Verify Google Analytics tracking (pageviews registering)

---

## Emergency Contacts

**Production Issues:**
- Primary: Platform Administrator (TBD)
- Secondary: DevOps Lead (TBD)

**Database Issues:**
- DBA Contact: (TBD)

**Infrastructure Issues:**
- VPS Provider Support: (TBD)
- VPS IP: 103.118.16.189

**Communication Channels:**
- Emergency Slack: #ipodhan-alerts (TBD)
- Email: ops@ipodhan.com (TBD)

---

## Post-Rollback Actions

### Immediate (Within 1 hour)

1. **Update status page** (if available)
2. **Notify users** (if downtime exceeded 5 minutes)
3. **Save all logs** for analysis
4. **Document timeline** of events

### Short-term (Within 24 hours)

1. **Conduct post-mortem**
   - What went wrong?
   - Why wasn't it caught in testing?
   - Root cause analysis

2. **Create incident report**
   ```markdown
   ## Rollback Incident Report
   - Date: {timestamp}
   - Duration: {downtime}
   - Cause: {root cause}
   - Impact: {user impact}
   - Resolution: {actions taken}
   - Prevention: {future safeguards}
   ```

3. **Update tests** to prevent recurrence

4. **Review deployment checklist** - Add missing checks

### Medium-term (Within 1 week)

1. **Fix root cause** in development
2. **Add monitoring** for the issue type
3. **Update rollback procedures** if gaps found
4. **Train team** on new procedures

---

## Rollback Testing

**Practice rollback procedures quarterly:**

```powershell
# Rollback drill (staging environment)
# 1. Deploy to staging
# 2. Intentionally break deployment
# 3. Execute rollback procedures
# 4. Time the process
# 5. Document any issues

# Goal: Complete rollback in <10 minutes
```

---

## Rollback Decision Matrix

| Issue | Severity | Rollback? | Timeframe |
|-------|----------|-----------|-----------|
| Health check fails | Critical | Yes | Immediate |
| Error rate >5% | Critical | Yes | Within 5 min |
| Memory leak | High | Yes | Within 15 min |
| UI bug (non-blocking) | Low | No | Fix forward |
| Performance degradation <20% | Medium | No | Monitor & fix |
| Scraper fails once | Low | No | Monitor |
| Database connection errors | Critical | Yes | Immediate |
| Single user report | Low | No | Investigate |

---

## Appendix: Common Rollback Scenarios

### Scenario 1: Deployment Breaks IPO Detail Pages

```powershell
# Symptom: /ipos/{slug} returns 500 errors
# Solution: Quick rollback (no DB changes)

pm2 stop all
cd C:\deployments\ipodhan-deployment-{previous}
pm2 start ecosystem.config.js
curl http://localhost:3000/api/health
```

### Scenario 2: Database Migration Corrupts Data

```powershell
# Symptom: Missing data, query errors
# Solution: Restore from backup

pm2 stop all
psql -h 103.118.16.189 -U postgres -c "DROP DATABASE ipodhan;"
psql -h 103.118.16.189 -U postgres -c "CREATE DATABASE ipodhan;"
psql -h 103.118.16.189 -U postgres -d ipodhan < C:\backups\ipodhan-latest.sql
cd C:\deployments\ipodhan-deployment-{previous}
pm2 start ecosystem.config.js
```

### Scenario 3: Memory Leak After Deployment

```powershell
# Symptom: PM2 shows increasing memory, eventual crashes
# Solution: Rollback + clear cache

pm2 stop all
redis-cli -h 103.118.16.189 FLUSHALL
cd C:\deployments\ipodhan-deployment-{previous}
pm2 start ecosystem.config.js
pm2 monit  # Monitor memory usage
```

---

**Last Updated:** 2025-10-08
**Document Version:** 1.0
**Maintained By:** Platform Administrator
