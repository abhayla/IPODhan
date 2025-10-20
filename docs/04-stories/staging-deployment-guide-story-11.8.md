# Staging Deployment Guide - Story 11.8 (Category Restructuring)

**Date:** 2025-10-19
**Stories:** 11.8a (Production Code), 11.8b (Test Fixtures)
**Commits:** 1ff1e77, d41c39b
**Migration:** 0015_restructure_category_to_segment_offering_type.sql
**Type:** Breaking Change (Database Schema)

---

## ⚠️ CRITICAL: Breaking Change Deployment

This is a **P0 CRITICAL** breaking change that modifies the database schema. Follow this guide exactly.

**What's Changing:**
- Database: `category` column → `segment` + `offeringType` columns
- API: Query parameter `category` → `segment` + `offeringType`
- UI: Category filter → Segment filter + Offering Type multi-select

**Impact:**
- **Database migration required** (downtime: ~1-2 minutes)
- **Code deployment required** (must deploy together with migration)
- **Cache invalidation required** (Redis cache keys changed)
- **No backward compatibility** (clean break for long-term clarity)

---

## Pre-Deployment Checklist

### 1. Code Review ✅
- [x] Story 11.8a reviewed and approved
- [x] Story 11.8b reviewed and approved
- [x] Breaking changes documented
- [x] Migration script reviewed

### 2. Testing Verification ✅
- [x] Development smoke tests passed
- [x] TypeScript compilation: 0 errors
- [x] Build succeeds
- [x] Manual browser tests completed
- [x] API endpoints tested

### 3. Stakeholder Communication
- [ ] Notify stakeholders of breaking change
- [ ] Schedule deployment window (if needed)
- [ ] Prepare rollback communication plan

### 4. Backup Plan ✅
- [x] Rollback script prepared
- [x] Database backup procedure documented
- [x] Git revert commit identified

---

## Staging Deployment Steps

### Step 1: Backup Staging Database (CRITICAL)

```bash
# SSH into staging server
ssh user@staging-server

# Create timestamped backup
pg_dump -h staging-db-host -U postgres -d ipodhan > \
  /backups/ipodhan_pre_story_11.8_$(date +%Y%m%d_%H%M%S).sql

# Verify backup created
ls -lh /backups/ipodhan_pre_story_11.8_*.sql

# Test backup integrity
pg_restore --list /backups/ipodhan_pre_story_11.8_*.sql | head -20

# Archive backup to S3 (if applicable)
aws s3 cp /backups/ipodhan_pre_story_11.8_*.sql \
  s3://ipodhan-backups/staging/
```

**Verification:**
- ✅ Backup file exists and has size > 0 MB
- ✅ Backup can be listed (not corrupted)
- ✅ Backup archived to remote storage

---

### Step 2: Pull Latest Code

```bash
# Navigate to application directory
cd /var/www/ipodhan

# Backup current code
tar -czf /backups/ipodhan_code_pre_story_11.8.tar.gz .

# Pull latest code from main branch
git fetch origin
git checkout main
git pull origin main

# Verify commits present
git log --oneline -5
# Should show:
# d41c39b test(story-11.8b): Complete test fixture updates
# 1ff1e77 feat(story-11.8a): Restructure category field

# Install dependencies (if package.json changed)
cd web
npm ci --production
```

**Verification:**
- ✅ Code backup created
- ✅ Latest commits pulled (1ff1e77 and d41c39b)
- ✅ Dependencies installed

---

### Step 3: Stop Application (Maintenance Mode)

```bash
# Put application in maintenance mode (if using PM2)
pm2 stop ipodhan-web

# Or use maintenance page
ln -sf /var/www/maintenance/index.html /var/www/ipodhan/web/public/maintenance.html

# Verify application stopped
curl http://staging.ipodhan.com/api/health
# Should return: Connection refused or Maintenance mode
```

**Verification:**
- ✅ Application stopped
- ✅ Maintenance page visible (if applicable)

---

### Step 4: Apply Database Migration (CRITICAL)

```bash
# Navigate to web directory
cd /var/www/ipodhan/web

# Apply migration
npm run db:migrate

# Expected output:
# Applying migration: 0015_restructure_category_to_segment_offering_type
# ✓ Migration applied successfully

# Verify migration applied
psql -h staging-db-host -U postgres -d ipodhan -c "\d ipos"
# Should show:
# - segment column (NOT NULL)
# - offering_type column (NOT NULL)
# - NO category column

# Verify data migration
psql -h staging-db-host -U postgres -d ipodhan -c "
  SELECT segment, offering_type, COUNT(*) as count
  FROM ipos
  GROUP BY segment, offering_type
  ORDER BY segment, offering_type;
"

# Expected results:
# segment    | offering_type | count
# -----------|---------------|-------
# MAINBOARD  | IPO           | 219
# MAINBOARD  | NCD           | 3
# MAINBOARD  | TENDER        | 1
# SME        | IPO           | 272
```

**Verification:**
- ✅ Migration file applied
- ✅ Old category column removed
- ✅ New segment and offering_type columns exist
- ✅ All 495 IPOs have valid values (no nulls)
- ✅ TENDER detection working (1 TENDER offer)
- ✅ Indexes created

**If Migration Fails:**
1. **DO NOT PROCEED** - Stop immediately
2. Restore from backup (see Rollback Plan below)
3. Investigate error in development
4. Fix issue and restart deployment

---

### Step 5: Clear Redis Cache (CRITICAL)

```bash
# Connect to Redis
redis-cli -h staging-redis-host -p 6379

# Flush cache (or selectively delete IPO cache keys)
FLUSHDB

# Or selective deletion (safer):
KEYS ipo:*
# For each key, run:
DEL ipo:list:* ipo:slug:* ipo:detail:*

# Exit Redis
exit
```

**Verification:**
- ✅ Cache cleared
- ✅ No stale cache entries with old category field

---

### Step 6: Build Application

```bash
# Navigate to web directory
cd /var/www/ipodhan/web

# Build application
npm run build

# Expected output:
# ✓ Compiled successfully in ~12s
# Route (app)  Size   First Load JS
# ├ ○ /        ...
# ...

# Verify build succeeded
ls -lh .next/
# Should show .next directory with build artifacts
```

**Verification:**
- ✅ Build completes successfully
- ✅ No TypeScript errors
- ✅ .next directory created

**If Build Fails:**
- Check error message
- Verify all dependencies installed
- Check for environment variable issues
- Rollback if necessary

---

### Step 7: Start Application

```bash
# Start application with PM2
pm2 start ecosystem.config.js

# Or manually
npm run start

# Verify application started
pm2 status
# Should show: ipodhan-web | online

# Check logs for errors
pm2 logs ipodhan-web --lines 50
# Should NOT show errors

# Verify application responding
curl http://staging.ipodhan.com/api/health
# Should return: {"status": "ok"}
```

**Verification:**
- ✅ Application started
- ✅ No errors in logs
- ✅ Health check passing

---

### Step 8: Smoke Tests (CRITICAL)

Run these tests to verify deployment:

#### Test 1: Homepage Loads
```bash
curl -I http://staging.ipodhan.com/
# Expected: HTTP 200 OK
```

#### Test 2: Dashboard Loads
```bash
curl -I http://staging.ipodhan.com/dashboard
# Expected: HTTP 200 OK
```

#### Test 3: API - Filter by Segment
```bash
curl "http://staging.ipodhan.com/api/ipos?segment=MAINBOARD" | jq '.data | length'
# Expected: 222 (219 IPO + 3 NCD + 1 TENDER - but default filter hides TENDER)
```

#### Test 4: API - Filter by Offering Type
```bash
curl "http://staging.ipodhan.com/api/ipos?offeringType=IPO" | jq '.data | length'
# Expected: 491 (219 MAINBOARD + 272 SME)
```

#### Test 5: API - Combined Filters
```bash
curl "http://staging.ipodhan.com/api/ipos?segment=MAINBOARD&offeringType=IPO" | jq '.data | length'
# Expected: 219
```

#### Test 6: "3i Infotech" Bug Fix (CRITICAL)
```bash
# Check database
psql -h staging-db-host -U postgres -d ipodhan -c "
  SELECT company_name, symbol, segment, offering_type
  FROM ipos
  WHERE company_name ILIKE '%3i infotech%';
"
# Expected: 2 rows
# - 3I INFOTECH LTD | 3IINFOTECHLTD | MAINBOARD | IPO
# - 3i Infotech Limited | 3IINFOLTDR | MAINBOARD | TENDER

# Check API with default filter
curl "http://staging.ipodhan.com/api/ipos?search=3i" | jq '.data | length'
# Expected: 1 (only IPO, TENDER hidden by default)

# Check API with TENDER filter
curl "http://staging.ipodhan.com/api/ipos?search=3i&offeringType=TENDER" | jq '.data | length'
# Expected: 1 (the TENDER offer)
```

**Browser Tests (Manual):**
1. Navigate to http://staging.ipodhan.com/dashboard
2. Search for "3i"
3. **Verify: Only 1 IPO card appears** (not 2)
4. Verify segment and offering type badges display correctly
5. Select "Tender" in offering type filter
6. **Verify: Now 1 TENDER card appears**

---

### Step 9: Monitor Application

```bash
# Monitor logs for 5 minutes
pm2 logs ipodhan-web --lines 100

# Watch for errors:
# - Database connection errors
# - TypeScript/runtime errors
# - API errors
# - Redis connection errors

# Monitor server resources
htop
# Check CPU, memory usage

# Monitor database connections
psql -h staging-db-host -U postgres -d ipodhan -c "
  SELECT count(*) FROM pg_stat_activity WHERE datname = 'ipodhan';
"
# Should be normal range (10-50 connections)
```

**Verification:**
- ✅ No errors in logs
- ✅ Server resources normal
- ✅ Database connections normal
- ✅ Application stable

---

## Post-Deployment Verification

### Full Regression Test Suite

Run these tests to ensure no regressions:

1. **IPO Listings:**
   - [ ] Mainboard IPOs page loads
   - [ ] SME IPOs page loads
   - [ ] Rights Issues page loads
   - [ ] OFS page loads
   - [ ] NCD page loads

2. **Filters:**
   - [ ] Segment filter works
   - [ ] Offering Type multi-select works
   - [ ] Status filter works
   - [ ] Sector filter works
   - [ ] Search works

3. **IPO Detail Pages:**
   - [ ] IPO detail page loads
   - [ ] Segment badge displays
   - [ ] Offering Type badge displays
   - [ ] All data displays correctly

4. **API Endpoints:**
   - [ ] GET /api/ipos (all filters)
   - [ ] GET /api/ipos/[slug]
   - [ ] GET /api/ipos/listings
   - [ ] GET /api/tools/lot-calculator

5. **Performance:**
   - [ ] Page load time <2s
   - [ ] API response time <500ms
   - [ ] No memory leaks
   - [ ] Cache hit rate >80%

---

## Rollback Plan

If deployment fails or critical issues found:

### Option 1: Rollback Code Only (Minor Issues)

```bash
# Revert to previous commit
cd /var/www/ipodhan
git revert d41c39b --no-commit
git revert 1ff1e77 --no-commit
git commit -m "Rollback Story 11.8 deployment"

# Rebuild
cd web
npm run build

# Restart
pm2 restart ipodhan-web
```

### Option 2: Rollback Database + Code (Major Issues)

```bash
# Stop application
pm2 stop ipodhan-web

# Restore database from backup
psql -h staging-db-host -U postgres -d ipodhan < \
  /backups/ipodhan_pre_story_11.8_YYYYMMDD_HHMMSS.sql

# Verify restoration
psql -h staging-db-host -U postgres -d ipodhan -c "\d ipos"
# Should show category column (old schema)

# Revert code
cd /var/www/ipodhan
git revert d41c39b --no-commit
git revert 1ff1e77 --no-commit
git commit -m "Rollback Story 11.8 deployment"

# Rebuild
cd web
npm run build

# Clear cache
redis-cli -h staging-redis-host FLUSHDB

# Restart
pm2 start ipodhan-web

# Verify application healthy
curl http://staging.ipodhan.com/api/health
```

**Rollback Time:** ~5-10 minutes

---

## Communication Plan

### Pre-Deployment Announcement

**To:** Development Team, QA Team, Stakeholders
**Subject:** Staging Deployment - Story 11.8 (Category Restructuring)

> Hi team,
>
> We're deploying Story 11.8 (Category Restructuring) to staging on [DATE] at [TIME].
>
> **What's changing:**
> - Database schema: category → segment + offeringType
> - UI filters: New segment and offering type filters
> - Bug fix: "3i Infotech" duplicate issue resolved
>
> **Expected downtime:** 2-3 minutes
>
> **Testing needed:**
> - Verify "3i Infotech" shows only 1 card
> - Test new filters work correctly
> - Regression test all IPO pages
>
> **Rollback plan:** Available if issues occur
>
> Thanks!

### Post-Deployment Announcement

**To:** Development Team, QA Team, Stakeholders
**Subject:** Staging Deployment Complete - Story 11.8

> Hi team,
>
> Story 11.8 has been successfully deployed to staging.
>
> **Deployment summary:**
> ✅ Database migration applied (495 IPOs migrated)
> ✅ Code deployed (commits 1ff1e77, d41c39b)
> ✅ Smoke tests passed
> ✅ Application healthy
>
> **Testing:**
> Staging URL: http://staging.ipodhan.com
> Please test and report any issues.
>
> **Next steps:**
> - QA validation
> - Production deployment (pending approval)
>
> Thanks!

---

## Production Deployment Notes

### Differences from Staging

1. **Higher Traffic:** Production has 10x traffic vs staging
2. **Database Size:** Production database ~10x larger
3. **Cache Warmup:** May need to warm cache after clearing
4. **Monitoring:** Set up alerts for errors/performance

### Additional Checks for Production

1. **Load Testing:** Verify performance under load
2. **Cache Strategy:** Pre-warm cache before deploying
3. **Gradual Rollout:** Consider blue-green deployment
4. **Extended Monitoring:** Monitor for 24 hours post-deployment

---

## Troubleshooting

### Issue 1: Migration Fails

**Symptom:** Migration script errors out

**Solutions:**
1. Check database connection
2. Verify database user has ALTER TABLE permissions
3. Check for locked tables
4. Review migration SQL for syntax errors
5. Rollback and investigate in development

### Issue 2: Application Won't Start

**Symptom:** PM2 shows app as "errored"

**Solutions:**
1. Check logs: `pm2 logs ipodhan-web`
2. Verify environment variables set
3. Check database connection
4. Check Redis connection
5. Verify build completed successfully

### Issue 3: TypeScript Errors

**Symptom:** Build fails with TypeScript errors

**Solutions:**
1. Verify latest code pulled
2. Check node_modules installed correctly
3. Run `npx tsc --noEmit` to see errors
4. Rollback if errors persist

### Issue 4: "3i Infotech" Still Shows 2 Cards

**Symptom:** Bug fix not working in UI

**Solutions:**
1. Verify database migration applied
2. Check default filter in frontend code
3. Clear browser cache
4. Check API response: `curl "http://staging.ipodhan.com/api/ipos?search=3i"`
5. Verify Redis cache cleared

---

## Success Criteria

Deployment is successful if:

- [ ] Application starts without errors
- [ ] Database migration applied successfully
- [ ] All 495 IPOs have segment and offeringType values
- [ ] Health check endpoint returns 200 OK
- [ ] Smoke tests pass (all 6 tests)
- [ ] "3i Infotech" shows only 1 card in UI
- [ ] New filters work correctly
- [ ] No regression issues found
- [ ] Application performance normal
- [ ] Logs show no errors for 15 minutes

---

## Deployment Timeline

**Total Time:** ~20-30 minutes

1. Backup database: 5 minutes
2. Pull code and install deps: 3 minutes
3. Stop application: 1 minute
4. Apply migration: 2 minutes
5. Clear cache: 1 minute
6. Build application: 12 minutes
7. Start application: 1 minute
8. Smoke tests: 5 minutes
9. Monitoring: 10 minutes (ongoing)

**Downtime:** 2-3 minutes (during migration + restart)

---

**Deployment Guide Version:** 1.0
**Created:** 2025-10-19
**Stories:** 11.8a, 11.8b
**Status:** Ready for Staging Deployment

**Prepared by:** Claude Code (Automated Dev-QA Workflow)
