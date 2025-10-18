# IPODhan Production Deployment Documentation

**Story:** 8.4b - Production Deployment - Production Server Execution
**Target:** Windows VPS 103.118.16.189
**Domain:** https://ipodhan.com
**Status:** Ready for Execution

---

## Overview

This directory contains comprehensive deployment documentation for deploying IPODhan to production. The deployment is organized into 6 phases, each with detailed guides, scripts, and verification procedures.

**Total Documentation:** 5,249 lines across 8 files

---

## Quick Start

### For Platform Administrators

Follow these guides in order:

1. **[Phase 1: VPS Environment Setup](./phase1-vps-environment-setup.md)** (60-90 min)
   - Install Node.js 20 LTS
   - Install and configure PM2
   - Setup PostgreSQL database
   - Configure Redis cache
   - Verify environment

2. **[Phase 2: Application Deployment](./phase2-application-deployment.md)** (45-60 min)
   - Transfer deployment package
   - Install dependencies
   - Configure environment variables
   - Run database migrations
   - Start PM2 applications

3. **[Phase 3: Cloudflare Configuration](./phase3-cloudflare-configuration.md)** (30-45 min)
   - Configure DNS
   - Setup SSL/TLS (A+ rating)
   - Configure caching rules
   - Setup security settings

4. **[Phase 4: Verification & Testing](./phase4-verification-testing.md)** (45-60 min)
   - Test site accessibility
   - Verify PM2 apps
   - Test scraper execution
   - Verify database and Redis
   - Test Cloudflare caching
   - Run SSL Labs test
   - Performance testing

5. **[Phase 5: Rollback Testing](./phase5-rollback-testing.md)** (30-45 min)
   - Test rollback procedures
   - Verify rollback speed
   - Document results

6. **[Phase 6: Post-Deployment](./phase6-post-deployment.md)** (30-45 min)
   - Final acceptance criteria verification
   - Setup monitoring
   - Update documentation
   - Stakeholder notification

**Total Estimated Time:** 4-6 hours

---

## File Index

### Deployment Phase Guides

| File | Lines | Purpose | Time |
|------|-------|---------|------|
| [phase1-vps-environment-setup.md](./phase1-vps-environment-setup.md) | 813 | VPS infrastructure setup | 60-90 min |
| [phase2-application-deployment.md](./phase2-application-deployment.md) | 875 | Deploy web app and scraper | 45-60 min |
| [phase3-cloudflare-configuration.md](./phase3-cloudflare-configuration.md) | 868 | DNS, SSL, caching, security | 30-45 min |
| [phase4-verification-testing.md](./phase4-verification-testing.md) | 1,014 | Comprehensive testing | 45-60 min |
| [phase5-rollback-testing.md](./phase5-rollback-testing.md) | 486 | Rollback procedures | 30-45 min |
| [phase6-post-deployment.md](./phase6-post-deployment.md) | 735 | Post-deployment tasks | 30-45 min |

### Supporting Documentation

| File | Lines | Purpose |
|------|-------|---------|
| [ROLLBACK.md](./ROLLBACK.md) | 416 | Emergency rollback procedures |
| [DEPLOYMENT-CHECKLIST.md](./DEPLOYMENT-CHECKLIST.md) | 553 | Complete deployment checklist |

### Scripts

| File | Lines | Purpose |
|------|-------|---------|
| [../scripts/setup-production-database.ps1](../scripts/setup-production-database.ps1) | 458 | Automated database setup |

**Total:** 5,249 lines of deployment documentation

---

## Prerequisites from Story 8.4a

These files were created in Story 8.4a and are required for deployment:

- `ecosystem.config.js` - PM2 configuration
- `.env.production.template` - Environment variables template
- `scripts/create-deployment-package.ps1` - Package creation script (Windows)
- Health check endpoint: `web/app/api/health/route.ts`

---

## Deployment Workflow

```
┌─────────────────────────────────────────────────────────────┐
│                     DEPLOYMENT WORKFLOW                      │
└─────────────────────────────────────────────────────────────┘

PHASE 1: VPS ENVIRONMENT SETUP
┌──────────────────────────────────────┐
│ • Node.js 20 LTS                     │
│ • PM2 + Windows Service              │
│ • PostgreSQL Database                │
│ • Redis Cache                        │
│ • Environment Verification           │
└──────────────────────────────────────┘
                  ↓
PHASE 2: APPLICATION DEPLOYMENT
┌──────────────────────────────────────┐
│ • Transfer Package                   │
│ • Extract & Install Dependencies     │
│ • Configure .env.production          │
│ • Run Migrations                     │
│ • Start PM2 Apps                     │
└──────────────────────────────────────┘
                  ↓
PHASE 3: CLOUDFLARE CONFIGURATION
┌──────────────────────────────────────┐
│ • DNS Setup                          │
│ • SSL/TLS (A+ rating)                │
│ • Caching Rules                      │
│ • Security Settings                  │
└──────────────────────────────────────┘
                  ↓
PHASE 4: VERIFICATION & TESTING
┌──────────────────────────────────────┐
│ • Site Accessibility                 │
│ • PM2 Apps Verification              │
│ • Database & Redis Tests             │
│ • Caching Verification               │
│ • SSL Labs Test                      │
│ • Performance Tests                  │
└──────────────────────────────────────┘
                  ↓
PHASE 5: ROLLBACK TESTING
┌──────────────────────────────────────┐
│ • Backup Creation                    │
│ • Rollback Test                      │
│ • Roll Forward Test                  │
│ • Verification                       │
└──────────────────────────────────────┘
                  ↓
PHASE 6: POST-DEPLOYMENT
┌──────────────────────────────────────┐
│ • Acceptance Criteria Check          │
│ • Monitoring Setup                   │
│ • Documentation Update               │
│ • Stakeholder Notification           │
└──────────────────────────────────────┘
                  ↓
        ✅ PRODUCTION LIVE!
           https://ipodhan.com
```

---

## Key Features

### Automated Scripts

Each phase includes PowerShell scripts for:
- Automated installation and configuration
- Secure password generation
- Comprehensive verification
- Error detection and reporting

### Verification at Every Phase

Every phase includes:
- Step-by-step verification checklist
- Automated verification scripts
- Expected outputs documented
- Troubleshooting guides

### Safety First

- Complete backup procedures before every major step
- Tested rollback procedures (< 5 minutes)
- Database backups automated
- Multiple deployment retention

### Security Best Practices

- Secure password generation (32 characters)
- File permission restrictions
- Secrets not in Git (verified)
- HTTPS enforced with HSTS
- SSL Labs A+ rating target
- Security headers configured

---

## Acceptance Criteria

All 10 acceptance criteria from Story 8.4b are addressed:

1. ✅ Site accessible at https://ipodhan.com with valid SSL (A+ rating)
2. ✅ PM2 running both apps (web: 2 cluster, scraper: 1 fork)
3. ✅ Scraper executing on schedule (daily 3 AM)
4. ✅ Database and Redis connected and healthy
5. ✅ Cloudflare caching active and verified
6. ✅ Environment variables secured (not in Git)
7. ✅ Auto-restart on crash enabled
8. ✅ Log rotation enabled (10MB max, 7 days)
9. ✅ Health check endpoint responding
10. ✅ Rollback procedure tested

---

## Target Environment

### VPS Specifications
- **IP Address:** 103.118.16.189
- **OS:** Windows Server 2022
- **Domain:** ipodhan.com

### Software Requirements
- Node.js 20 LTS
- npm 10+
- PM2 5+
- PostgreSQL 16+ (SHARED server)
- Redis 7.2+

### Network Requirements
- Cloudflare account
- Domain ownership: ipodhan.com
- Firewall ports: 80, 443, 3000, 5432, 6379

---

## Important Notes

### Shared PostgreSQL Server

This deployment uses a **SHARED PostgreSQL server**. The database setup:
- Creates a NEW database named 'ipodhan'
- Does NOT modify existing databases
- Creates dedicated user 'ipodhan_user'
- Configures connection pooling (max 20 connections)

See: [Phase 1 - PostgreSQL Database Setup](./phase1-vps-environment-setup.md#postgresql-database-setup)

### Windows-Specific

All documentation and scripts are **Windows Server 2022 specific**:
- PowerShell scripts (.ps1)
- Windows service configuration
- Windows file paths (C:\inetpub\ipodhan)
- Windows permissions (ACL)

### Deployment Strategy

- **Symlink-based deployments** for fast rollback
- **Timestamped deployment directories** for history
- **Zero-downtime deployment** (PM2 cluster mode)
- **Multiple deployment retention** for safety

---

## Troubleshooting

Each phase guide includes comprehensive troubleshooting sections:

- **Phase 1:** Node.js, PM2, PostgreSQL, Redis issues
- **Phase 2:** Application startup, database connection, environment config issues
- **Phase 3:** DNS, SSL, Cloudflare issues
- **Phase 4:** Testing failures, performance issues
- **Phase 5:** Rollback issues
- **Phase 6:** Monitoring issues

Common issues and solutions documented for each phase.

---

## After Deployment

### Immediate (24 hours)
1. Monitor PM2 logs hourly
2. Verify scraper runs at 3 AM
3. Run SSL Labs test (target: A+)
4. Run Lighthouse performance test

### Short-term (1 week)
1. **Story 8.5:** Setup monitoring and alerts
2. Configure automated backups
3. Gather user feedback

### Long-term (1 month+)
1. Performance optimization
2. Quarterly rollback testing
3. Documentation updates

---

## Support

### Documentation
- **Deployment Guides:** This directory
- **Rollback Procedures:** [ROLLBACK.md](./ROLLBACK.md)
- **Operations Runbook:** (Created in Phase 6)

### Emergency Contacts
- Platform Administrator: [To be filled]
- Database Administrator: [To be filled]
- VPS Provider Support: [To be filled]

### Health Check
- **Endpoint:** https://ipodhan.com/api/health
- **Expected:** `{"status":"healthy","services":{"database":"healthy","redis":"healthy"}}`

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-10-08 | Initial deployment documentation created (Story 8.4b) |

---

## Related Stories

- **Story 8.4a:** Production Deployment - Dev Machine Preparation (COMPLETED)
- **Story 8.4b:** Production Deployment - Production Server Execution (THIS STORY)
- **Story 8.5:** Monitoring & Alerts (NEXT)

---

## License

This documentation is part of the IPODhan project and is proprietary.

---

**Ready to deploy? Start with [Phase 1: VPS Environment Setup](./phase1-vps-environment-setup.md)**

**Questions? Review the [Deployment Checklist](./DEPLOYMENT-CHECKLIST.md) first.**

---

**Last Updated:** 2025-10-08
**Story:** 8.4b - Production Deployment - Production Server Execution
