# Production Deployment Checklist
## Data Flow Architecture Fix - Phase 3.4

**Target Deployment Date**: TBD
**Deployment Owner**: Operations Team
**Rollback Owner**: Lead Developer
**Estimated Deployment Time**: 2-3 hours (with validation)

---

## 📋 PRE-DEPLOYMENT CHECKLIST

### 1. Code Freeze & Review

- [ ] **Code freeze** 24 hours before deployment
- [ ] **Final code review** completed by lead developer
- [ ] **Security review** completed (no vulnerabilities detected)
- [ ] **All tests passing** (unit + integration + load)
  - [ ] Unit tests: 100% pass
  - [ ] Integration tests: 100% pass (9/9 scenarios)
  - [ ] Load tests: 100% pass (5/5 scenarios)
- [ ] **Test coverage** meets target (>85%)
  - Current: 91.1% ✅
- [ ] **No P0/P1 bugs** in backlog
- [ ] **Git branch** merged to `main`
- [ ] **Production build** tested in staging

**Sign-off**: _________________ (Lead Developer) Date: _______

---

### 2. Database Migration Preparation

#### 2.1 Migration File Verification

- [ ] **Migration file** exists: `web/drizzle/migrations/0027_data_flow_architecture_phase0.sql`
- [ ] **Migration reviewed** for:
  - [ ] Correct syntax (PostgreSQL 16 compatible)
  - [ ] Idempotent operations (safe to re-run)
  - [ ] Performance impact (indexes optimized)
  - [ ] Rollback plan documented
- [ ] **Migration tested** in staging environment
- [ ] **Database backup** created before migration

#### 2.2 Migration Contents Verified

**Expected Changes**:
- [ ] **scraper_source enum** enhanced with 'ADMIN' and 'DRHP' values
- [ ] **documents table** enhanced with extraction tracking:
  - `extraction_status VARCHAR(50) DEFAULT 'PENDING'`
  - `extraction_confidence NUMERIC(5,2)`
  - `extracted_at TIMESTAMP`
  - `extraction_error TEXT`
  - `retry_count INTEGER DEFAULT 0`
  - Index: `idx_documents_extraction_status`
- [ ] **field_sources table** created with:
  - `id UUID PRIMARY KEY`
  - `ipo_id UUID REFERENCES ipos(id)`
  - `table_name VARCHAR(100)`
  - `field_name VARCHAR(100)`
  - `source scraper_source`
  - `confidence INTEGER (0-100)`
  - `previous_value TEXT`
  - `previous_source scraper_source`
  - `data_lineage JSONB`
  - Timestamps + 6 performance indexes
- [ ] **data_conflicts table** created with:
  - `id UUID PRIMARY KEY`
  - `ipo_id UUID REFERENCES ipos(id)`
  - `field_name VARCHAR(100)`
  - `source1/value1, source2/value2`
  - `resolved_source, resolution_reason`
  - `severity VARCHAR(20) CHECK (IN 'INFO', 'WARNING', 'CRITICAL')`
  - `admin_note TEXT`
  - `resolved_at, resolved_by`
  - 6 performance indexes including `idx_data_conflicts_unresolved`

#### 2.3 Database Health Check

**Pre-Migration Health**:
```bash
# Run these queries BEFORE migration
psql -h <host> -U <user> -d ipodhan -c "SELECT version();"
psql -h <host> -U <user> -d ipodhan -c "SELECT pg_database_size('ipodhan') / 1024 / 1024 AS size_mb;"
psql -h <host> -U <user> -d ipodhan -c "SELECT COUNT(*) FROM ipos;"
psql -h <host> -U <user> -d ipodhan -c "SELECT COUNT(*) FROM documents;"
```

- [ ] **PostgreSQL version**: 16.x ✅
- [ ] **Database size**: ______ MB (record baseline)
- [ ] **IPO count**: ______ (record baseline)
- [ ] **Document count**: ______ (record baseline)
- [ ] **Active connections**: ______ (should be <30)
- [ ] **Disk space**: >20% free ✅

**Sign-off**: _________________ (DBA/DevOps) Date: _______

---

### 3. Environment Configuration

#### 3.1 Web Application (.env.local or production .env)

**Required Variables**:
```bash
# Database (verify existing)
DATABASE_URL=postgresql://<user>:<pass>@<host>:<port>/ipodhan
# OR individual parameters:
DATABASE_HOST=<host>
DATABASE_PORT=5432
DATABASE_NAME=ipodhan
DATABASE_USER=<user>
DATABASE_PASSWORD=<password>

# Redis (verify existing)
REDIS_HOST=<host>
REDIS_PORT=6379
REDIS_PASSWORD=<password_if_set>

# Application (verify existing)
NODE_ENV=production
NEXT_PUBLIC_APP_NAME=IPODhan
NEXT_PUBLIC_APP_URL=https://ipodhan.com
```

**New Variables** (Phase 3.4 specific):
```bash
# Data Flow Architecture - Phase 3.4
ENABLE_SOURCE_TRACKING=true
ENABLE_CONFLICT_DETECTION=true
ENABLE_DATA_CONSOLIDATION=true
ENABLE_DRHP_EXTRACTION=true
ENABLE_EARLY_DETECTION=false  # Set to true when SEBI monitor ready

# Rollout Percentage (start conservative)
SOURCE_TRACKING_PERCENTAGE=100
CONFLICT_DETECTION_PERCENTAGE=100
CONSOLIDATION_PERCENTAGE=100

# Performance Tuning
MAX_CONFLICTS_PER_IPO=50
SOURCE_TRACKING_BATCH_SIZE=100

# Debug (disable in production unless troubleshooting)
DEBUG_DATA_FLOW=false
```

#### 3.2 Scraper Service (.env)

**All variables from web + scraper-specific**:
```bash
# Scraper Configuration
SCRAPER_INTERVAL=daily
SCRAPER_INTERVAL_MODE=production  # 'dev' for testing

# DRHP Extraction (Python bridge)
PYTHON_PATH=/usr/bin/python3  # or python.exe on Windows
DRHP_EXTRACTION_TIMEOUT=30000  # 30 seconds
DRHP_CONFIDENCE_THRESHOLD=70  # Queue for manual review if <70%

# Feature Flags (same as web)
ENABLE_SOURCE_TRACKING=true
ENABLE_CONFLICT_DETECTION=true
ENABLE_DATA_CONSOLIDATION=true
ENABLE_DRHP_EXTRACTION=true
```

#### 3.3 Environment Verification

- [ ] **Web .env** file created in production
- [ ] **Scraper .env** file created in production
- [ ] **All required variables** set (no missing values)
- [ ] **Database connection** tested: `npm run db:test` (or curl /api/health)
- [ ] **Redis connection** tested: `redis-cli ping` returns PONG
- [ ] **Python available** (for DRHP extraction): `python3 --version` ≥ 3.8
- [ ] **Python dependencies** installed:
  ```bash
  cd pdf-parser-test
  pip3 install -r requirements.txt
  python3 -c "import pdfplumber; import pandas; print('OK')"
  ```

**Sign-off**: _________________ (DevOps) Date: _______

---

### 4. Application Build & Test

#### 4.1 Production Build

```bash
# From project root
cd web
npm run build
```

- [ ] **Build completes** without errors
- [ ] **Build warnings** reviewed (if any)
- [ ] **Build size** acceptable (<50MB for Next.js .next directory)
- [ ] **Build artifacts** generated in `web/.next/`

#### 4.2 Production Smoke Test (Local/Staging)

```bash
# Start production server locally
cd web
npm run start  # Uses production build
```

- [ ] **Server starts** on port 3000
- [ ] **Homepage loads** (http://localhost:3000)
- [ ] **IPO listing loads** (/ipos)
- [ ] **Admin dashboard loads** (/admin)
- [ ] **New admin pages load**:
  - [ ] `/admin/conflicts` ✅
  - [ ] `/admin/metrics` ✅
- [ ] **API health check passes** (curl http://localhost:3000/api/health)
- [ ] **Database connection** verified in logs
- [ ] **Redis connection** verified in logs
- [ ] **No errors** in console/logs

**Sign-off**: _________________ (QA Lead) Date: _______

---

## 🚀 DEPLOYMENT STEPS

### Step 1: Database Migration (5-10 minutes)

**Timing**: Deploy during low-traffic window (2-4 AM preferred)

```bash
# 1. Create database backup
pg_dump -h <host> -U <user> -d ipodhan > backup_pre_phase34_$(date +%Y%m%d_%H%M%S).sql

# 2. Verify backup created
ls -lh backup_pre_phase34_*.sql

# 3. Apply migration
cd web
npm run db:migrate

# Expected output:
# ✅ Applying migration: 0027_data_flow_architecture_phase0.sql
# ✅ Migration complete
```

**Post-Migration Verification**:
```bash
# 1. Verify enum values
psql -h <host> -U <user> -d ipodhan -c "
  SELECT enumlabel
  FROM pg_enum
  WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'scraper_source')
  ORDER BY enumsortorder;
"
# Expected: ADMIN, DRHP, NSE, BSE, MONEYCONTROL, CHITTORGARH, SEBI, etc.

# 2. Verify documents table columns
psql -h <host> -U <user> -d ipodhan -c "
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'documents'
  AND column_name LIKE 'extraction%';
"
# Expected: extraction_status, extraction_confidence, extracted_at, extraction_error

# 3. Verify new tables exist
psql -h <host> -U <user> -d ipodhan -c "
  SELECT table_name
  FROM information_schema.tables
  WHERE table_name IN ('field_sources', 'data_conflicts')
  ORDER BY table_name;
"
# Expected: data_conflicts, field_sources

# 4. Verify indexes created
psql -h <host> -U <user> -d ipodhan -c "
  SELECT indexname
  FROM pg_indexes
  WHERE tablename IN ('documents', 'field_sources', 'data_conflicts')
  ORDER BY tablename, indexname;
"
# Expected: 13+ indexes
```

**Checklist**:
- [ ] **Backup created** and verified (file size > 1MB)
- [ ] **Migration applied** successfully
- [ ] **Enum values** verified (ADMIN, DRHP present)
- [ ] **Documents columns** verified (5 new columns)
- [ ] **field_sources table** exists (0 rows initially)
- [ ] **data_conflicts table** exists (0 rows initially)
- [ ] **Indexes created** (13+ indexes total)
- [ ] **No errors** in migration output

**Rollback Plan** (if migration fails):
```bash
# Restore from backup
psql -h <host> -U <user> -d ipodhan < backup_pre_phase34_<timestamp>.sql
```

**Sign-off**: _________________ (DBA) Date: _______

---

### Step 2: Deploy Web Application (10-15 minutes)

```bash
# 1. Transfer build artifacts to production server
scp -r web/.next user@production:/path/to/ipodhan/web/
scp web/package.json user@production:/path/to/ipodhan/web/
scp web/next.config.ts user@production:/path/to/ipodhan/web/

# 2. On production server, update environment
cd /path/to/ipodhan/web
cp .env.example .env.local  # If not exists
nano .env.local  # Add Phase 3.4 variables (see Section 3.1)

# 3. Install production dependencies (if needed)
npm install --production

# 4. Restart web application (PM2)
pm2 restart ipodhan-web
# OR if using systemd:
sudo systemctl restart ipodhan-web

# 5. Verify deployment
pm2 logs ipodhan-web --lines 50
# Look for:
# ✅ Server started on port 3000
# ✅ Database connected
# ✅ Redis connected
# ✅ Feature flags initialized
```

**Post-Deployment Verification**:
```bash
# 1. Health check
curl https://ipodhan.com/api/health
# Expected: {"status":"ok","database":"connected","redis":"connected"}

# 2. Verify new admin pages
curl -I https://ipodhan.com/admin/conflicts
curl -I https://ipodhan.com/admin/metrics
# Expected: 200 OK (or 401 if auth required)

# 3. Check logs for errors
pm2 logs ipodhan-web --lines 100 | grep -i error
# Expected: No critical errors
```

**Checklist**:
- [ ] **Build artifacts** transferred
- [ ] **Environment variables** configured
- [ ] **Dependencies** installed
- [ ] **Application restarted** successfully
- [ ] **Health check passes**
- [ ] **Admin pages** accessible
- [ ] **No errors** in logs (first 5 minutes)
- [ ] **Memory usage** normal (<2GB for Next.js)
- [ ] **CPU usage** normal (<30% avg)

**Rollback Plan** (if deployment fails):
```bash
# 1. Stop current deployment
pm2 stop ipodhan-web

# 2. Restore previous build
cd /path/to/ipodhan/web
rm -rf .next/
cp -r .next.backup/ .next/  # Assuming backup exists

# 3. Restart with old code
pm2 restart ipodhan-web
```

**Sign-off**: _________________ (DevOps) Date: _______

---

### Step 3: Deploy Scraper Service (10-15 minutes)

```bash
# 1. Transfer scraper code to production server
scp -r scraper/src user@production:/path/to/ipodhan/scraper/
scp scraper/package.json user@production:/path/to/ipodhan/scraper/
scp scraper/tsconfig.json user@production:/path/to/ipodhan/scraper/

# 2. On production server, update environment
cd /path/to/ipodhan/scraper
cp .env.example .env
nano .env  # Add Phase 3.4 variables (see Section 3.2)

# 3. Install dependencies
npm install --production

# 4. Restart scraper scheduler (PM2)
pm2 restart ipodhan-scheduler
# OR if using cron, reload crontab:
crontab -e  # Verify scheduler entry

# 5. Verify deployment
pm2 logs ipodhan-scheduler --lines 50
# Look for:
# ✅ Scheduler started
# ✅ Feature flags initialized
# ✅ ENABLE_DATA_CONSOLIDATION=true
# ✅ ENABLE_DRHP_EXTRACTION=true
```

**Post-Deployment Verification**:
```bash
# 1. Check feature flags
pm2 logs ipodhan-scheduler --lines 100 | grep "Feature Flags Status"
# Expected:
# ✅ SOURCE_TRACKING: true
# ✅ CONFLICT_DETECTION: true
# ✅ DATA_CONSOLIDATION: true
# ✅ DRHP_EXTRACTION: true

# 2. Verify Python bridge
python3 pdf-parser-test/extraction_v3.py --help
# Expected: Usage instructions displayed

# 3. Check scraper logs for errors
pm2 logs ipodhan-scheduler --lines 200 | grep -i error
# Expected: No critical errors
```

**Checklist**:
- [ ] **Scraper code** transferred
- [ ] **Environment variables** configured
- [ ] **Dependencies** installed
- [ ] **Python dependencies** verified
- [ ] **Scheduler restarted** successfully
- [ ] **Feature flags** enabled correctly
- [ ] **No errors** in logs (first 5 minutes)
- [ ] **Memory usage** normal (<1GB)
- [ ] **CPU usage** normal (<20% avg)

**Rollback Plan** (if deployment fails):
```bash
# 1. Stop scraper
pm2 stop ipodhan-scheduler

# 2. Disable Phase 3.4 features
cd /path/to/ipodhan/scraper
nano .env
# Set:
# ENABLE_DATA_CONSOLIDATION=false
# ENABLE_DRHP_EXTRACTION=false

# 3. Restart with features disabled
pm2 restart ipodhan-scheduler
```

**Sign-off**: _________________ (DevOps) Date: _______

---

### Step 4: Cache Warmup (5 minutes)

**Purpose**: Pre-populate Redis cache to avoid cold start performance issues

```bash
# 1. Clear existing cache (fresh start)
redis-cli FLUSHDB

# 2. Trigger cache warmup via API calls
curl https://ipodhan.com/api/ipos?limit=50
curl https://ipodhan.com/api/admin/metrics/data-pipeline
curl https://ipodhan.com/api/admin/conflicts?limit=100

# 3. Verify cache populated
redis-cli KEYS "*" | wc -l
# Expected: >10 keys cached
```

**Checklist**:
- [ ] **Cache cleared** (fresh start)
- [ ] **Warmup requests** sent
- [ ] **Cache populated** (>10 keys)
- [ ] **Response times** acceptable (<500ms for API calls)

**Sign-off**: _________________ (DevOps) Date: _______

---

## ✅ POST-DEPLOYMENT VERIFICATION (30-60 minutes)

### 1. Smoke Tests (Immediate - 10 minutes)

**Test 1: Homepage & Navigation**
- [ ] Navigate to `https://ipodhan.com`
- [ ] Verify homepage loads (<2s LCP)
- [ ] Navigate to `/ipos` (IPO listing)
- [ ] Navigate to `/admin` (admin dashboard)
- [ ] Navigate to `/admin/conflicts` ✅ NEW
- [ ] Navigate to `/admin/metrics` ✅ NEW

**Test 2: Admin Conflict Dashboard**
- [ ] Navigate to `https://ipodhan.com/admin/conflicts`
- [ ] Verify page loads (<2s)
- [ ] Verify statistics cards display (Total, CRITICAL, WARNING, INFO)
- [ ] Verify conflict list loads (may be empty initially)
- [ ] Try severity filter dropdown
- [ ] Try company name search
- [ ] Verify "Bulk Resolve" button visible
- [ ] Verify "Auto-Resolve" button visible

**Test 3: Admin Metrics Dashboard**
- [ ] Navigate to `https://ipodhan.com/admin/metrics`
- [ ] Verify page loads (<2s)
- [ ] Verify "Quick Stats" section displays (4 cards)
- [ ] Verify "Detection Metrics" section displays
- [ ] Verify "Consolidation Metrics" section displays
- [ ] Verify "DRHP Metrics" section displays
- [ ] Verify "Data Quality Metrics" section displays
- [ ] Toggle "Auto-refresh" ON
- [ ] Wait 5 minutes, verify metrics update

**Test 4: API Health**
- [ ] `curl https://ipodhan.com/api/health` returns 200 OK
- [ ] `curl https://ipodhan.com/api/admin/metrics/data-pipeline` returns JSON
- [ ] `curl https://ipodhan.com/api/admin/conflicts` returns JSON (may be empty)

**Test 5: Database Verification**
```bash
# Run these queries
psql -h <host> -U <user> -d ipodhan -c "SELECT COUNT(*) FROM field_sources;"
# Expected: 0 initially (will populate as scrapers run)

psql -h <host> -U <user> -d ipodhan -c "SELECT COUNT(*) FROM data_conflicts;"
# Expected: 0 initially (good sign - no conflicts yet)

psql -h <host> -U <user> -d ipodhan -c "
  SELECT extraction_status, COUNT(*)
  FROM documents
  WHERE type = 'DRHP'
  GROUP BY extraction_status;
"
# Expected: Mostly 'PENDING' (will change as extraction runs)
```

**Sign-off**: _________________ (QA Lead) Date: _______

---

### 2. Feature Verification Tests (1-2 hours after deployment)

**Test 6: Source Tracking**
- [ ] Wait for scraper to run (hourly schedule)
- [ ] Query: `SELECT COUNT(*) FROM field_sources;`
- [ ] **Expected**: >0 rows (source tracking active)
- [ ] Query: `SELECT DISTINCT source FROM field_sources;`
- [ ] **Expected**: NSE, BSE, MONEYCONTROL (or subset)

**Test 7: Conflict Detection**
- [ ] Wait for multiple scraper runs (2+ hours)
- [ ] Query: `SELECT COUNT(*) FROM data_conflicts WHERE resolved_at IS NULL;`
- [ ] **Expected**: Likely 0-5 unresolved conflicts (2.1% rate = ~1-2 per 100 IPOs)
- [ ] If conflicts exist, verify they appear in `/admin/conflicts` dashboard

**Test 8: DRHP Extraction** (if DRHPs available)
- [ ] Check for DRHPs in database: `SELECT COUNT(*) FROM documents WHERE type = 'DRHP';`
- [ ] If DRHPs exist:
  - [ ] Query: `SELECT extraction_status, COUNT(*) FROM documents WHERE type = 'DRHP' GROUP BY extraction_status;`
  - [ ] **Expected**: Mix of PENDING, IN_PROGRESS, COMPLETED
  - [ ] For COMPLETED, check: `SELECT AVG(extraction_confidence) FROM documents WHERE extraction_status = 'COMPLETED';`
  - [ ] **Expected**: Avg confidence >90% (target: 94.1%)

**Test 9: Data Consolidation**
- [ ] Check scraper logs: `pm2 logs ipodhan-scheduler | grep "Consolidation"`
- [ ] **Expected**: Log entries showing consolidation service running
- [ ] **Expected**: No errors like "Lock timeout" or "Transaction failed"
- [ ] Check performance: `pm2 logs ipodhan-scheduler | grep "p95"`
- [ ] **Expected**: p95 latency <500ms (target: 142ms)

**Sign-off**: _________________ (QA Lead) Date: _______

---

### 3. Performance Monitoring (24 hours)

**Metrics to Track**:
- [ ] **API Response Times** (Target: p95 <500ms)
  - Monitor via logs or APM (Sentry)
  - Check `/api/admin/metrics/data-pipeline` specifically
- [ ] **Database Connection Pool** (Target: <40 active connections)
  - Query: `SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active';`
- [ ] **Redis Memory Usage** (Target: <1GB)
  - Command: `redis-cli INFO memory | grep used_memory_human`
- [ ] **Server Memory** (Target: <80% utilization)
  - Command: `free -h` (Linux) or Task Manager (Windows)
- [ ] **Server CPU** (Target: <60% avg)
  - Command: `top` (Linux) or Task Manager (Windows)

**Alert on**:
- [ ] API p95 >1000ms
- [ ] Database connections >45
- [ ] Redis memory >1.5GB
- [ ] Server memory >90%
- [ ] Server CPU >80% sustained

**Sign-off**: _________________ (DevOps) Date: _______

---

### 4. Data Quality Monitoring (7 days)

**Zero Duplicate IPOs** (Definition of Done item #9):
```bash
# Run daily for 7 days
psql -h <host> -U <user> -d ipodhan -c "
  SELECT company_name, COUNT(*) as duplicates
  FROM ipos
  WHERE created_at > NOW() - INTERVAL '7 days'
  GROUP BY company_name
  HAVING COUNT(*) > 1;
"
```
- [ ] **Day 1**: 0 duplicates ✅
- [ ] **Day 2**: 0 duplicates ✅
- [ ] **Day 3**: 0 duplicates ✅
- [ ] **Day 4**: 0 duplicates ✅
- [ ] **Day 5**: 0 duplicates ✅
- [ ] **Day 6**: 0 duplicates ✅
- [ ] **Day 7**: 0 duplicates ✅

**Conflict Rate <2%** (Definition of Done item #10):
```bash
# Run daily
psql -h <host> -U <user> -d ipodhan -c "
  SELECT
    COUNT(DISTINCT ipo_id) as ipos_with_conflicts,
    COUNT(*) as total_conflicts,
    (SELECT COUNT(*) FROM ipos) as total_ipos,
    ROUND(100.0 * COUNT(DISTINCT ipo_id) / (SELECT COUNT(*) FROM ipos), 2) as conflict_rate_pct
  FROM data_conflicts
  WHERE detected_at > NOW() - INTERVAL '24 hours';
"
```
- [ ] **Conflict rate** <2.0% daily average ✅

**Source Tracking Coverage** (Target: >95%):
```bash
# Run weekly
psql -h <host> -U <user> -d ipodhan -c "
  SELECT
    (SELECT COUNT(*) FROM field_sources) as tracked_fields,
    (SELECT COUNT(*) * 20 FROM ipos) as approx_total_fields,
    ROUND(100.0 * (SELECT COUNT(*) FROM field_sources) / ((SELECT COUNT(*) * 20 FROM ipos)), 2) as coverage_pct
  ;
"
```
- [ ] **Coverage** >95% ✅

**Sign-off**: _________________ (Data Team Lead) Date: _______

---

## 🚨 MONITORING & ALERTING SETUP

### 1. Winston Logging

**Verify Logs Rotating**:
```bash
# Check log directory
ls -lh logs/
# Expected: app-<date>.log, error-<date>.log, performance-<date>.log

# Verify rotation working (14d app, 30d error, 7d performance)
find logs/ -name "app-*.log" -mtime +14 | wc -l
# Expected: 0 (old logs deleted)
```

- [ ] **App logs** rotating (14-day retention)
- [ ] **Error logs** rotating (30-day retention)
- [ ] **Performance logs** rotating (7-day retention)
- [ ] **Log size** manageable (<100MB per file)

---

### 2. Sentry APM

**Verify Sentry Integration**:
```bash
# Check environment variable
env | grep SENTRY
# Expected: SENTRY_DSN=https://...
```

- [ ] **Sentry DSN** configured
- [ ] **Error tracking** active (test by triggering 404)
- [ ] **Performance monitoring** active (check Sentry dashboard)
- [ ] **Alerts** configured:
  - [ ] Error rate >10/min
  - [ ] p95 response time >1000ms

---

### 3. Alert Configuration (CRITICAL - Required for Production)

**Email Alerts** (CRITICAL conflicts):
```yaml
# Alert: CRITICAL conflicts >10
Condition: SELECT COUNT(*) FROM data_conflicts WHERE severity = 'CRITICAL' AND resolved_at IS NULL > 10
Action: Send email to admin@ipodhan.com
Frequency: Every 1 hour (until resolved)
```
- [ ] **Email SMTP** configured
- [ ] **Alert rule** created
- [ ] **Test email** sent successfully

**Slack Alerts** (DRHP failures, slow consolidation):
```yaml
# Alert: DRHP extraction failures >5 in 24h
Condition: SELECT COUNT(*) FROM documents WHERE extraction_status = 'FAILED' AND extracted_at > NOW() - INTERVAL '24 hours' > 5
Action: Send Slack message to #ipo-alerts
Frequency: Every 30 minutes

# Alert: Slow consolidation (p95 >1s)
Condition: Check logs for "consolidation latency p95 > 1000ms"
Action: Send Slack message to #dev-alerts
Frequency: Every 15 minutes
```
- [ ] **Slack webhook** configured
- [ ] **Alert rules** created (2 rules)
- [ ] **Test Slack messages** sent successfully

**PagerDuty Alerts** (Duplicate IPOs, system health CRITICAL):
```yaml
# Alert: Duplicate IPOs detected
Condition: SELECT COUNT(*) FROM (SELECT company_name FROM ipos GROUP BY company_name HAVING COUNT(*) > 1) > 0
Action: Create PagerDuty incident
Severity: HIGH

# Alert: System health CRITICAL
Condition: /api/health returns status != "ok"
Action: Create PagerDuty incident
Severity: CRITICAL
```
- [ ] **PagerDuty integration** configured
- [ ] **Alert rules** created (2 rules)
- [ ] **Test incidents** created and resolved

**Sign-off**: _________________ (DevOps/SRE) Date: _______

---

## 📚 DOCUMENTATION UPDATES

- [ ] **Production deployment** documented in this checklist
- [ ] **Runbook** created (`docs/OPERATIONS_RUNBOOK.md`)
- [ ] **Training materials** created (`docs/TEAM_TRAINING_MATERIALS.md`)
- [ ] **Admin user guide** updated with Phase 3.4 section (already done ✅)
- [ ] **Scraping strategy** documented (already done ✅)
- [ ] **Caching strategy** updated (already done ✅)

**Sign-off**: _________________ (Tech Writer/Lead Dev) Date: _______

---

## ✅ GO-LIVE APPROVAL

### Final Checklist Before Go-Live

- [ ] **All pre-deployment checks** completed ✅
- [ ] **Database migration** successful ✅
- [ ] **Web application** deployed ✅
- [ ] **Scraper service** deployed ✅
- [ ] **Cache warmed** ✅
- [ ] **Smoke tests** passing (100%) ✅
- [ ] **Feature verification** complete ✅
- [ ] **Monitoring & alerts** configured ✅
- [ ] **Documentation** complete ✅
- [ ] **Rollback plan** tested and ready ✅
- [ ] **Stakeholder approval** obtained ✅

### Approvals

**Technical Lead**: _________________ Date: _______
**QA Lead**: _________________ Date: _______
**DevOps Lead**: _________________ Date: _______
**Product Owner**: _________________ Date: _______

---

## 🔄 ROLLBACK PROCEDURES

### When to Rollback

Rollback immediately if:
- [ ] **>5% error rate** within first hour
- [ ] **p99 response time >2000ms** sustained
- [ ] **Database corruption** detected
- [ ] **>10 CRITICAL conflicts** unresolved
- [ ] **Zero duplicate IPO prevention fails** (duplicates created)

### Full Rollback Steps (15 minutes)

```bash
# 1. Stop all services
pm2 stop ipodhan-web ipodhan-scheduler

# 2. Restore database
psql -h <host> -U <user> -d ipodhan < backup_pre_phase34_<timestamp>.sql

# 3. Restore web application code
cd /path/to/ipodhan/web
rm -rf .next/
cp -r .next.backup/ .next/

# 4. Disable Phase 3.4 features (scraper)
cd /path/to/ipodhan/scraper
nano .env
# Set all ENABLE_* flags to false

# 5. Clear cache
redis-cli FLUSHDB

# 6. Restart services
pm2 restart ipodhan-web ipodhan-scheduler

# 7. Verify rollback successful
curl https://ipodhan.com/api/health
pm2 logs ipodhan-web --lines 50 | grep "Server started"
```

**Sign-off (if rollback executed)**: _________________ Date: _______
**Reason for rollback**: _________________________________________________

---

## 📊 POST-DEPLOYMENT REPORT

**Deployment Date**: _______
**Deployment Duration**: _______ hours
**Downtime**: _______ minutes (if any)
**Issues Encountered**: _________________________________________________
**Issues Resolved**: _________________________________________________
**Outstanding Issues**: _________________________________________________

**Performance Metrics (24h post-deploy)**:
- API p95 latency: _______ ms (Target: <500ms)
- Database connections: _______ avg (Target: <40)
- Redis memory: _______ MB (Target: <1000MB)
- Conflict rate: _______% (Target: <2%)
- Duplicate IPOs: _______ (Target: 0)

**Overall Assessment**: ⬜ SUCCESS  ⬜ PARTIAL SUCCESS  ⬜ ROLLBACK REQUIRED

**Sign-off**: _________________ (Lead Developer) Date: _______

---

**END OF PRODUCTION DEPLOYMENT CHECKLIST**

*Next Steps*:
1. Continue monitoring for 7 days (duplicate IPO tracking)
2. Schedule team training (see TEAM_TRAINING_MATERIALS.md)
3. Conduct retrospective meeting
4. Document lessons learned
