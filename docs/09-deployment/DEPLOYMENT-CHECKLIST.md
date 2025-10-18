# IPODhan Production Deployment Checklist

**Story:** 8.4a - Production Deployment - Dev Machine Preparation
**Purpose:** Comprehensive checklist for deploying IPODhan to production VPS
**Target Environment:** Windows Server 2022 VPS (103.118.16.189)
**Deployment Type:** Story 8.4b - Production VPS Deployment

---

## Overview

This checklist ensures all critical steps are completed before, during, and after production deployment. Mark each item as complete before proceeding to the next section.

**Estimated Total Time:** 2-3 hours for first deployment, 30-60 minutes for subsequent deployments

---

## Section 1: Pre-Deployment (Dev Machine)

### Code Quality Checks

- [ ] All unit tests pass (`npm run test:unit` in web/)
- [ ] All integration tests pass (`npm run test:integration` in web/)
- [ ] All E2E tests pass (`npm run test:e2e` in web/)
- [ ] ESLint reports no errors (`npm run lint` in web/)
- [ ] TypeScript compiles without errors
- [ ] No console.log or debugger statements in production code
- [ ] All environment variables documented in `.env.production.template`

### Build Verification

- [ ] Web application builds successfully (`npm run build` in web/)
- [ ] Scraper builds successfully (`npm run build` in scraper/)
- [ ] No critical warnings during build process
- [ ] Build artifacts verified (.next/ and dist/ folders exist)

### Version Control

- [ ] All changes committed to Git
- [ ] Feature branch merged to main
- [ ] Git tags created for release (e.g., `v1.0.0`)
- [ ] No uncommitted changes in working directory
- [ ] `.env.production` confirmed in .gitignore

### Documentation

- [ ] README.md deployment section updated
- [ ] ROLLBACK.md reviewed and up-to-date
- [ ] DEPLOYMENT-CHECKLIST.md (this file) reviewed
- [ ] Architecture diagrams reflect current deployment
- [ ] API documentation up-to-date

### Deployment Package

- [ ] Deployment package created (`.\scripts\create-deployment-package.ps1`)
- [ ] Package size reasonable (<100 MB)
- [ ] Package contains all required files:
  - [ ] web/.next/ (built Next.js app)
  - [ ] scraper/dist/ (built scraper)
  - [ ] ecosystem.config.js
  - [ ] .env.production.template
  - [ ] DEPLOY.md
- [ ] Package integrity verified (can extract without errors)

### Database Preparation

- [ ] Database migrations tested locally
- [ ] Migration scripts documented
- [ ] Rollback migrations prepared (if applicable)
- [ ] Database backup strategy confirmed
- [ ] Data seeding scripts tested (if needed)

### Communication

- [ ] Deployment scheduled (maintenance window if needed)
- [ ] Stakeholders notified of deployment time
- [ ] Rollback plan communicated to team
- [ ] Emergency contacts list updated

---

## Section 2: VPS Pre-Deployment Setup

### Access Verification

- [ ] RDP access to VPS confirmed (103.118.16.189)
- [ ] Admin credentials verified
- [ ] SSH access configured (if using SCP for transfer)
- [ ] Firewall rules reviewed

### Environment Setup

- [ ] Node.js 20 LTS installed
  ```powershell
  node --version  # Should show v20.x.x
  ```
- [ ] npm 10+ installed
  ```powershell
  npm --version  # Should show 10.x.x
  ```
- [ ] PM2 installed globally
  ```powershell
  pm2 --version  # Should show 5.x.x
  ```
- [ ] Git installed (if pulling from repo)
- [ ] Deployment directory created (`C:\deployments\`)

### Database Setup

- [ ] PostgreSQL 16+ running
  ```powershell
  psql --version  # Should show 16.x
  ```
- [ ] Database "ipodhan" exists
  ```powershell
  psql -h localhost -U postgres -l | Select-String ipodhan
  ```
- [ ] Database user has correct permissions
- [ ] Database accessible from localhost
- [ ] Database backup created before deployment
  ```powershell
  pg_dump -h localhost -U postgres -d ipodhan > "C:\backups\ipodhan-$(Get-Date -Format yyyyMMdd-HHmmss).sql"
  ```

### Redis Setup

- [ ] Redis 7.2+ running
  ```powershell
  redis-cli --version  # Should show 7.x
  ```
- [ ] Redis accessible from localhost
  ```powershell
  redis-cli ping  # Should return PONG
  ```
- [ ] Redis password configured (if required)
- [ ] Redis persistence enabled (RDB or AOF)

### Networking

- [ ] Port 3000 available for web application
  ```powershell
  Test-NetConnection -ComputerName localhost -Port 3000
  ```
- [ ] Port 5432 accessible for PostgreSQL
- [ ] Port 6379 accessible for Redis
- [ ] Firewall rules allow required ports
- [ ] DNS configured (if using domain name)

### Monitoring Setup

- [ ] Log directories created
  ```powershell
  mkdir C:\deployments\logs
  ```
- [ ] Disk space sufficient (>10 GB free)
  ```powershell
  Get-PSDrive C | Select-Object Free
  ```
- [ ] UptimeRobot account setup (optional for MVP)
- [ ] Sentry DSN obtained (optional for MVP)

---

## Section 3: Deployment Execution

### File Transfer

- [ ] Deployment package transferred to VPS
  - Via RDP: Copy/paste file
  - Via SCP: `scp ipodhan-deployment-*.zip user@103.118.16.189:C:\deployments\`
- [ ] Package integrity verified (MD5/SHA256 checksum)
- [ ] Package extracted successfully
  ```powershell
  Expand-Archive ipodhan-deployment-*.zip
  ```

### Dependency Installation

- [ ] Navigate to deployment directory
  ```powershell
  cd C:\deployments\ipodhan-deployment-*
  ```
- [ ] Install web dependencies
  ```powershell
  cd web
  npm ci --production
  cd ..
  ```
- [ ] Install scraper dependencies
  ```powershell
  cd scraper
  npm ci --production
  cd ..
  ```
- [ ] No installation errors reported
- [ ] node_modules/ directories created

### Environment Configuration

- [ ] Copy .env.production.template to .env.production
  ```powershell
  Copy-Item .env.production.template .env.production
  ```
- [ ] Edit .env.production with production values
  ```powershell
  notepad .env.production
  ```
- [ ] All REQUIRED variables filled in:
  - [ ] DATABASE_HOST=103.118.16.189
  - [ ] DATABASE_PASSWORD=<set-production-password>
  - [ ] REDIS_HOST=103.118.16.189
  - [ ] REDIS_PASSWORD=<set-redis-password>
  - [ ] NEXT_PUBLIC_GA_MEASUREMENT_ID=<google-analytics-id>
  - [ ] NEXT_PUBLIC_ZERODHA_AFFILIATE_LINK=<affiliate-link>
  - [ ] NEXT_PUBLIC_ANGELONE_AFFILIATE_LINK=<affiliate-link>
- [ ] No placeholder values (REQUIRED_CHANGE_ME) remaining
- [ ] File permissions restrict .env.production to admin only

### Database Migration

- [ ] Database backup verified before migration
- [ ] Run migrations (if any)
  ```powershell
  cd web
  npm run db:migrate
  cd ..
  ```
- [ ] Verify migrations applied
  ```powershell
  psql -h localhost -U postgres -d ipodhan -c "\d ipos"
  ```
- [ ] No migration errors

### Cache Preparation

- [ ] Clear Redis cache (fresh start)
  ```powershell
  redis-cli FLUSHALL
  ```
- [ ] Verify cache cleared
  ```powershell
  redis-cli DBSIZE  # Should return 0
  ```

### PM2 Deployment

- [ ] Review ecosystem.config.js
- [ ] Start services with PM2
  ```powershell
  pm2 start ecosystem.config.js
  ```
- [ ] Verify both apps started
  ```powershell
  pm2 status
  ```
- [ ] Expected output:
  ```
  ipodhan-web (2 instances, cluster mode)
  ipodhan-scraper (1 instance, fork mode)
  ```
- [ ] Save PM2 process list
  ```powershell
  pm2 save
  ```
- [ ] Configure PM2 to start on boot
  ```powershell
  pm2 startup
  # Follow on-screen instructions
  ```

---

## Section 4: Post-Deployment Verification

### Health Checks

- [ ] Health endpoint responds
  ```powershell
  curl http://localhost:3000/api/health
  ```
- [ ] Health check returns 200 status
- [ ] Database status: "healthy"
- [ ] Redis status: "healthy"
- [ ] No error messages in response

### Application Functionality

- [ ] Homepage loads (`http://localhost:3000`)
  ```powershell
  curl http://localhost:3000 | Select-String "IPODhan"
  ```
- [ ] IPO list API works (`/api/ipos`)
  ```powershell
  curl http://localhost:3000/api/ipos
  ```
- [ ] IPO detail page works (`/ipos/{slug}`)
- [ ] Tools work (`/tools/lot-calculator`, `/tools/compare`)
- [ ] Market holidays API works (`/api/market-holidays`)
- [ ] Sectors API works (`/api/sectors`)
- [ ] Registrars API works (`/api/registrars`)

### PM2 Process Health

- [ ] All processes show "online" status
  ```powershell
  pm2 status
  ```
- [ ] No restart loops (restart count stable)
- [ ] Memory usage within limits (<500M for web, <300M for scraper)
  ```powershell
  pm2 monit
  ```
- [ ] CPU usage reasonable (<50% sustained)

### Log Verification

- [ ] PM2 logs accessible
  ```powershell
  pm2 logs --lines 50
  ```
- [ ] No critical errors in logs
- [ ] Application startup messages present
- [ ] Database connection successful in logs
- [ ] Redis connection successful in logs

### External Access

- [ ] Application accessible from external network
  ```
  http://103.118.16.189:3000
  ```
- [ ] Health check accessible externally
  ```
  http://103.118.16.189:3000/api/health
  ```
- [ ] No CORS errors for API calls
- [ ] Static assets load correctly

### Performance Checks

- [ ] Homepage loads in <2 seconds
- [ ] API responses in <500ms
- [ ] No 500 errors in first 100 requests
- [ ] Cache warming successful (check Redis keys)
  ```powershell
  redis-cli KEYS *
  ```

### Security Verification

- [ ] Environment variables not exposed in client bundle
- [ ] Database credentials secure
- [ ] Redis password set (if required)
- [ ] PM2 logs not world-readable
- [ ] Firewall configured correctly
- [ ] HTTPS configured (if domain available)

---

## Section 5: Monitoring Setup

### PM2 Monitoring

- [ ] PM2 process list saved
  ```powershell
  pm2 save
  ```
- [ ] PM2 startup script installed
- [ ] PM2 resurrect tested (reboot VPS and verify auto-start)

### External Monitoring

- [ ] UptimeRobot monitor configured (optional)
  - URL: `http://103.118.16.189:3000/api/health`
  - Interval: 5 minutes
  - Alert: Email on 3 failures
- [ ] Sentry error tracking configured (optional)
  - DSN added to .env.production
  - Test error sent to verify integration

### Log Rotation

- [ ] PM2 log rotation configured
  ```powershell
  pm2 install pm2-logrotate
  pm2 set pm2-logrotate:max_size 10M
  pm2 set pm2-logrotate:retain 30
  ```
- [ ] Database backup cron job scheduled (daily)
- [ ] Log cleanup script scheduled (weekly)

---

## Section 6: Post-Deployment Actions

### Documentation

- [ ] Deployment timestamp recorded
- [ ] Deployment notes created
  ```markdown
  Deployment: 2025-10-08 16:00 UTC
  Version: v1.0.0
  Duration: 45 minutes
  Issues: None
  Rollback: Not required
  ```
- [ ] Update deployment history log
- [ ] Screenshots of successful deployment saved

### Communication

- [ ] Stakeholders notified of successful deployment
- [ ] Deployment completion announced
- [ ] Known issues documented (if any)
- [ ] Next deployment scheduled (if applicable)

### Monitoring

- [ ] Monitor logs for first hour post-deployment
  ```powershell
  pm2 logs --lines 100
  ```
- [ ] Check error rate in Sentry (if configured)
- [ ] Verify UptimeRobot status (if configured)
- [ ] Monitor memory usage trends
  ```powershell
  pm2 monit
  ```

### Testing

- [ ] Smoke tests executed
  - Create/read IPO
  - Filter IPOs
  - Use lot calculator
  - View market holidays
- [ ] User acceptance testing (if applicable)
- [ ] Load testing (optional for MVP)

### Backup

- [ ] Post-deployment database backup created
  ```powershell
  pg_dump -h localhost -U postgres -d ipodhan > "C:\backups\ipodhan-post-deploy-$(Get-Date -Format yyyyMMdd-HHmmss).sql"
  ```
- [ ] Deployment package archived
  ```powershell
  Move-Item ipodhan-deployment-*.zip C:\deployments\archive\
  ```
- [ ] Configuration files backed up

---

## Section 7: Rollback Preparation

### Rollback Readiness

- [ ] Previous deployment available for rollback
- [ ] Rollback procedure tested in staging
- [ ] Database backup verified and restorable
- [ ] Rollback decision criteria documented
- [ ] Emergency contacts list accessible

### Rollback Plan

- [ ] If critical issues arise within 1 hour:
  - [ ] Execute quick rollback (see ROLLBACK.md)
  - [ ] Restore database from pre-deployment backup
  - [ ] Clear Redis cache
  - [ ] Verify health check
- [ ] Rollback window: First 24 hours post-deployment

---

## Section 8: Sign-Off

### Deployment Team

- [ ] **Developer:** Code deployed successfully (Name: ___________, Date: _______)
- [ ] **QA:** Functionality verified (Name: ___________, Date: _______)
- [ ] **DevOps:** Infrastructure ready (Name: ___________, Date: _______)
- [ ] **Platform Admin:** Deployment approved (Name: ___________, Date: _______)

### Final Verification

- [ ] All checklist items completed
- [ ] No critical issues outstanding
- [ ] Monitoring active and functional
- [ ] Rollback plan ready
- [ ] Team confident in deployment

---

## Appendix: Quick Reference Commands

### Deployment

```powershell
# Transfer deployment package
scp ipodhan-deployment-*.zip user@103.118.16.189:C:\deployments\

# Extract package
Expand-Archive ipodhan-deployment-*.zip

# Install dependencies
cd web && npm ci --production && cd ..
cd scraper && npm ci --production && cd ..

# Configure environment
Copy-Item .env.production.template .env.production
notepad .env.production

# Start services
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Verification

```powershell
# Health check
curl http://localhost:3000/api/health

# PM2 status
pm2 status
pm2 logs --lines 50
pm2 monit

# Database connection
psql -h localhost -U postgres -d ipodhan -c "SELECT version();"

# Redis connection
redis-cli ping
```

### Rollback

```powershell
# Quick rollback
pm2 stop all
cd C:\deployments\ipodhan-deployment-{previous}
pm2 start ecosystem.config.js
pm2 save
curl http://localhost:3000/api/health
```

---

**Checklist Version:** 1.0
**Last Updated:** 2025-10-08
**Next Review:** Before Story 8.4b deployment
