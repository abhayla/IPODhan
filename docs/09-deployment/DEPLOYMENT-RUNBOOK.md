# IPODhan Deployment Runbook

**Version:** 1.0
**Last Updated:** October 10, 2025
**Status:** Production Ready (Pending Critical Infrastructure)

---

## Table of Contents

1. [Pre-Launch Checklist](#pre-launch-checklist)
2. [Infrastructure Setup](#infrastructure-setup)
3. [SSL/HTTPS Configuration](#sslhttps-configuration)
4. [Database Setup](#database-setup)
5. [Application Deployment](#application-deployment)
6. [Monitoring & Alerting](#monitoring--alerting)
7. [Backup Strategy](#backup-strategy)
8. [Post-Launch Checklist](#post-launch-checklist)
9. [Troubleshooting](#troubleshooting)
10. [Rollback Procedures](#rollback-procedures)

---

## Pre-Launch Checklist

### Critical (MUST HAVE before launch)

- [ ] **SSL/HTTPS Certificate** configured (Let's Encrypt)
- [ ] **Rate Limiting** middleware enabled on all API routes
- [ ] **Database Backups** automated (daily at 2 AM)
- [ ] **Domain Configuration** completed and DNS propagated
- [ ] **Environment Variables** set correctly on production VPS
- [ ] **PM2** configured for process management and auto-restart
- [ ] **Firewall Rules** configured (ports 80, 443, 22 only)
- [ ] **Database Connection** tested on production
- [ ] **Redis Connection** tested on production
- [ ] **All Tests** passing (unit, integration, E2E)
- [ ] **Build** successful with zero errors

### High Priority (Launch Week)

- [ ] **Monitoring Dashboard** for scraper status
- [ ] **Sentry Error Tracking** configured
- [ ] **Google Analytics** tracking code added
- [ ] **Performance Monitoring** (APM) for API endpoints
- [ ] **Health Check Endpoint** (`/api/health`) functional
- [ ] **Legal Pages** accessible (/privacy, /terms, /disclaimer)
- [ ] **Sitemap** generated and accessible
- [ ] **Robots.txt** configured correctly
- [ ] **Social Media** accounts created
- [ ] **Contact Form** functional

---

## Infrastructure Setup

### VPS Requirements

**Minimum Specifications:**
- **CPU:** 2 cores
- **RAM:** 4 GB
- **Storage:** 40 GB SSD
- **OS:** Ubuntu 22.04 LTS or similar
- **Network:** 100 Mbps

**Current Setup:**
- **Provider:** Windows VPS
- **IP Address:** [To be configured]
- **Domain:** [To be configured]

### Software Stack

```bash
# Node.js 20.x LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PostgreSQL 15.x
sudo apt-get install -y postgresql postgresql-contrib

# Redis 7.x
sudo apt-get install -y redis-server

# Nginx (for reverse proxy)
sudo apt-get install -y nginx

# PM2 (process manager)
sudo npm install -g pm2

# Certbot (for Let's Encrypt SSL)
sudo apt-get install -y certbot python3-certbot-nginx
```

### Firewall Configuration

```bash
# Allow SSH (port 22)
sudo ufw allow 22/tcp

# Allow HTTP (port 80) for Let's Encrypt challenge
sudo ufw allow 80/tcp

# Allow HTTPS (port 443)
sudo ufw allow 443/tcp

# Deny all other incoming traffic
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Enable firewall
sudo ufw enable
```

---

## SSL/HTTPS Configuration

### Option 1: Let's Encrypt with Certbot (Recommended - FREE)

#### Step 1: Install Certbot

```bash
# Install Certbot for Nginx
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-nginx
```

#### Step 2: Obtain SSL Certificate

```bash
# Replace yourdomain.com with your actual domain
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Follow the prompts:
# - Enter email address for renewal notifications
# - Agree to Terms of Service
# - Choose whether to redirect HTTP to HTTPS (recommended: Yes)
```

#### Step 3: Verify Auto-Renewal

```bash
# Test renewal process
sudo certbot renew --dry-run

# Check renewal timer
sudo systemctl status certbot.timer
```

#### Step 4: Configure Nginx

```nginx
# /etc/nginx/sites-available/ipodhan

server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    # SSL Configuration (managed by Certbot)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Proxy to Next.js application
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Static assets caching
    location /_next/static {
        proxy_pass http://localhost:3000;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # Public folder caching
    location /public {
        proxy_pass http://localhost:3000;
        add_header Cache-Control "public, max-age=86400";
    }

    # API rate limiting (Nginx level - backup to application level)
    location /api {
        limit_req zone=api_limit burst=20 nodelay;
        proxy_pass http://localhost:3000;
    }
}

# Rate limit zone definition (add to http block in nginx.conf)
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/m;
```

#### Step 5: Enable and Test Nginx Configuration

```bash
# Test configuration
sudo nginx -t

# Create symlink to enable site
sudo ln -s /etc/nginx/sites-available/ipodhan /etc/nginx/sites-enabled/

# Restart Nginx
sudo systemctl restart nginx

# Check status
sudo systemctl status nginx
```

### Option 2: Cloudflare (Alternative - FREE with CDN)

If using Cloudflare:

1. **Add Domain to Cloudflare:**
   - Sign up at https://cloudflare.com
   - Add your domain
   - Update nameservers at your domain registrar

2. **SSL/TLS Settings:**
   - Go to SSL/TLS tab
   - Set SSL mode to "Full (strict)"
   - Enable "Always Use HTTPS"
   - Enable "Automatic HTTPS Rewrites"

3. **Origin Certificates:**
   - Go to SSL/TLS > Origin Server
   - Create Certificate (15-year validity)
   - Install on VPS:

```bash
# Save certificate
sudo nano /etc/nginx/ssl/cloudflare-origin-cert.pem
# Paste certificate

# Save private key
sudo nano /etc/nginx/ssl/cloudflare-origin-key.pem
# Paste key

# Update Nginx config to use Cloudflare origin certificates
ssl_certificate /etc/nginx/ssl/cloudflare-origin-cert.pem;
ssl_certificate_key /etc/nginx/ssl/cloudflare-origin-key.pem;
```

4. **Firewall Rules:**
   - Only allow Cloudflare IPs to access ports 80/443
   - Download Cloudflare IP list: https://www.cloudflare.com/ips/

---

## Database Setup

### PostgreSQL Configuration

#### Step 1: Create Database and User

```bash
# Switch to postgres user
sudo -u postgres psql

# Create database
CREATE DATABASE ipodhan;

# Create user with password
CREATE USER ipodhan_user WITH ENCRYPTED PASSWORD 'your_secure_password_here';

# Grant privileges
GRANT ALL PRIVILEGES ON DATABASE ipodhan TO ipodhan_user;

# Grant schema privileges
\c ipodhan
GRANT ALL ON SCHEMA public TO ipodhan_user;

# Exit
\q
```

#### Step 2: Configure PostgreSQL for Remote Connections (if needed)

```bash
# Edit postgresql.conf
sudo nano /etc/postgresql/15/main/postgresql.conf

# Change listen_addresses
listen_addresses = 'localhost'  # For local only
# OR
listen_addresses = '*'  # For remote access (less secure)

# Edit pg_hba.conf for authentication
sudo nano /etc/postgresql/15/main/pg_hba.conf

# Add rule (for local access)
local   all             ipodhan_user                            scram-sha-256
host    all             ipodhan_user  127.0.0.1/32             scram-sha-256

# Restart PostgreSQL
sudo systemctl restart postgresql
```

#### Step 3: Run Migrations

```bash
cd /path/to/IPODhan/web
npm run db:push  # Push schema
npm run db:migrate  # Run migrations
npm run db:seed  # Seed initial data
```

### Redis Configuration

```bash
# Edit Redis config
sudo nano /etc/redis/redis.conf

# Set password
requirepass your_redis_password_here

# Bind to localhost only (for security)
bind 127.0.0.1

# Set max memory and eviction policy
maxmemory 1gb
maxmemory-policy allkeys-lru

# Enable persistence (optional)
save 900 1
save 300 10
save 60 10000

# Restart Redis
sudo systemctl restart redis

# Test connection
redis-cli -a your_redis_password_here ping
# Should return: PONG
```

---

## Application Deployment

> **Actual production deploys run via GitHub Actions** (`.github/workflows/deploy.yml`,
> manual `workflow_dispatch` only) — the steps below describe the underlying process the
> workflow automates. See `CLAUDE.md` "Production & Deployment" and
> `.claude/rules/self-hosted-windows-vps-deploy.md` for the CI mechanics.

### Manual dispatch inputs (`workflow_dispatch`)

| Input | Default | Effect |
|---|---|---|
| `skip_tests` | `false` | Emergency path — skips `quality-checks` entirely (no test run anywhere) and deploys straight away. |
| `checks_verified_locally` | `false` | Skips the **hosted** `quality-checks` job (`ubuntu-latest`) but the `deploy` job (self-hosted) re-runs the full lint/typecheck/unit-test suite itself before touching any files — so skipping the hosted job never means skipping tests, only running them somewhere free. Exists because the account's shared private-repo Actions minutes (2000/mo) run out most months, and every `ubuntu-latest` job then fails to *start* — while self-hosted runners (the `deploy` job) are unaffected. Requires `local_verification_evidence`. |
| `local_verification_evidence` | `''` | Required when `checks_verified_locally=true`: a short note on WHAT was verified and WHERE (e.g. local command output summary, or a commit SHA + pass/fail line). Echoed into the job's summary so a later reader can see the evidence — an unexplained skip is a hard failure. |



```bash
# Create application directory
sudo mkdir -p /var/www/ipodhan
sudo chown $USER:$USER /var/www/ipodhan

# Clone repository
cd /var/www/ipodhan
git clone https://github.com/yourusername/IPODhan.git .

# Navigate to web app
cd web
```

### Step 2: Install Dependencies

```bash
# Install Node.js dependencies
npm ci --production

# Install PM2 globally
sudo npm install -g pm2
```

### Step 3: Configure Environment Variables

```bash
# Create .env.production file
nano .env.production
```

```env
# .env.production

# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=ipodhan
POSTGRES_USER=ipodhan_user
POSTGRES_PASSWORD=your_secure_password_here
DATABASE_URL=postgresql://ipodhan_user:your_secure_password_here@localhost:5432/ipodhan

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password_here

# Application
NODE_ENV=production
PORT=3000  # Port for Next.js server (used for server-side API calls)
NEXT_PUBLIC_APP_URL=https://yourdomain.com
# Optional: NEXT_PUBLIC_API_BASE_URL=/api (auto-detected if not set)

# Sentry (Error Tracking)
SENTRY_DSN=your_sentry_dsn_here
SENTRY_ORG=your_org
SENTRY_PROJECT=your_project

# Analytics
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX

# Scraper Configuration
SCRAPER_INTERVAL_MINUTES=30
SCRAPER_MAX_RETRIES=3

# Security
SESSION_SECRET=your_random_session_secret_here
API_RATE_LIMIT_MAX=100
API_RATE_LIMIT_WINDOW_MS=60000

# Backup
BACKUP_DIR=/var/backups/ipodhan
BACKUP_RETENTION_DAYS=30
BACKUP_CLOUD_BUCKET=your-s3-bucket
BACKUP_CLOUD_PROVIDER=s3
```

**💡 Port Configuration Best Practices:**

The application now uses dynamic port detection to eliminate port conflicts:

- **Client-side requests:** Automatically use relative URLs (`/api`) which inherit the browser's current port
- **Server-side requests:** Detect port from `process.env.PORT` environment variable
- **Fallback chain:** `PORT` → `NEXT_PUBLIC_APP_URL` → `VERCEL_URL` → `localhost:3000`

This means:
✅ No hardcoded ports in code
✅ Works on any available port (3000, 3007, etc.)
✅ No configuration needed for local development
✅ Production-ready for any hosting environment

### Step 4: Build Application

```bash
# Build Next.js application
npm run build

# Verify build success
ls -la .next
```

### Step 5: Configure PM2

```bash
# Create PM2 ecosystem file
nano ecosystem.config.js
```

```javascript
// ecosystem.config.js

module.exports = {
  apps: [
    {
      name: 'ipodhan-web',
      script: 'npm',
      args: 'start',
      cwd: '/var/www/ipodhan/web',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      instances: 2,  // Use 2 instances for load balancing
      exec_mode: 'cluster',
      max_memory_restart: '500M',
      error_file: '/var/log/pm2/ipodhan-web-error.log',
      out_file: '/var/log/pm2/ipodhan-web-out.log',
      time: true,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'ipodhan-scrapers',
      script: 'npm',
      args: 'run scraper:all',
      cwd: '/var/www/ipodhan/web',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      error_file: '/var/log/pm2/ipodhan-scrapers-error.log',
      out_file: '/var/log/pm2/ipodhan-scrapers-out.log',
      time: true,
      autorestart: true,
      cron_restart: '*/30 * * * *',  // Restart every 30 minutes
    },
  ],
};
```

### Step 6: Start Application with PM2

```bash
# Start application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Configure PM2 to start on system boot
pm2 startup systemd

# Check status
pm2 status
pm2 logs ipodhan-web
pm2 monit
```

### Step 7: Verify Deployment

```bash
# Test application locally
curl http://localhost:3000

# Test API endpoints
curl http://localhost:3000/api/health

# Check logs
pm2 logs ipodhan-web --lines 50

# Check database connection
curl http://localhost:3000/api/db-test
```

---

## Monitoring & Alerting

### Health Check Endpoint

The application exposes a health check endpoint at `/api/health`:

```bash
# Test health endpoint
curl https://yourdomain.com/api/health

# Expected response:
{
  "status": "healthy",
  "timestamp": "2025-10-10T12:00:00.000Z",
  "version": "1.0.0",
  "services": {
    "database": "connected",
    "redis": "connected"
  }
}
```

### Scraper Status Monitoring

Monitor scraper health at `/api/admin/scraper/status`:

```bash
curl https://yourdomain.com/api/admin/scraper/status

# Expected response:
{
  "nse": {
    "source": "NSE",
    "lastRun": "2025-10-10T11:45:00.000Z",
    "successRate24h": 95.5,
    "consecutiveFailures": 0
  },
  "bse": { ... },
  "apiFallback": { ... },
  "health": "HEALTHY"
}
```

### Uptime Monitoring

Set up external uptime monitoring:

**Recommended Services:**
- **UptimeRobot** (https://uptimerobot.com) - FREE, 5-minute checks
- **Pingdom** (https://pingdom.com) - Commercial
- **StatusCake** (https://statuscake.com) - Free tier available

**Monitor These Endpoints:**
- `https://yourdomain.com` - Homepage (check every 5 min)
- `https://yourdomain.com/api/health` - API health (check every 5 min)
- `https://yourdomain.com/api/admin/scraper/status` - Scrapers (check every 15 min)

### Sentry Error Tracking

Sentry is already integrated. Configure in production:

```bash
# Create Sentry project at https://sentry.io

# Add DSN to .env.production
SENTRY_DSN=https://your_key@sentry.io/your_project_id

# Test Sentry
curl -X POST https://yourdomain.com/api/test-sentry-error
```

### Log Management

```bash
# View PM2 logs
pm2 logs ipodhan-web

# View Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# View PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-15-main.log

# Rotate logs (configure logrotate)
sudo nano /etc/logrotate.d/ipodhan
```

```
/var/log/pm2/*.log {
    daily
    missingok
    rotate 14
    compress
    notifempty
    create 0640 www-data www-data
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

---

## Backup Strategy

### Automated Database Backups

#### Step 1: Test Backup Script

```bash
# Make script executable
chmod +x scripts/backup-database.sh

# Test backup
./scripts/backup-database.sh

# Verify backup created
ls -lh backups/database/
```

#### Step 2: Schedule Daily Backups with Cron

```bash
# Edit crontab
crontab -e

# Add cron job (runs daily at 2 AM)
0 2 * * * /var/www/ipodhan/scripts/backup-database.sh --upload-to-cloud >> /var/log/ipodhan-backup.log 2>&1

# Verify cron job
crontab -l
```

#### Step 3: Configure Cloud Storage (Optional but Recommended)

**For AWS S3:**

```bash
# Install AWS CLI
sudo apt-get install -y awscli

# Configure AWS credentials
aws configure

# Set environment variables
export BACKUP_CLOUD_BUCKET=your-s3-bucket-name
export BACKUP_CLOUD_PROVIDER=s3
```

### Application Code Backups

```bash
# Push to Git repository regularly
git add .
git commit -m "Production deployment $(date +%Y-%m-%d)"
git push origin main

# Create tagged releases
git tag -a v1.0.0 -m "Production release 1.0.0"
git push origin v1.0.0
```

### Full VPS Backup

Consider weekly full VPS snapshots:
- Most VPS providers offer snapshot functionality
- Schedule automated snapshots weekly
- Keep last 4 snapshots (monthly retention)

---

## Post-Launch Checklist

### Day 1 (Launch Day)

- [ ] **Smoke Testing:** Test all critical user flows
- [ ] **Monitor Logs:** Watch PM2, Nginx, and PostgreSQL logs for errors
- [ ] **Check Scrapers:** Verify scrapers are running every 30 minutes
- [ ] **Test SSL:** Verify HTTPS is working, check SSL Labs score (A+ target)
- [ ] **Google Search Console:** Submit sitemap
- [ ] **Social Media:** Announce launch on Twitter, LinkedIn
- [ ] **Analytics:** Verify Google Analytics tracking is working

### Week 1

- [ ] **User Feedback:** Collect early user feedback
- [ ] **Performance:** Monitor API response times (< 500ms target)
- [ ] **Scraper Uptime:** Check scraper success rate (> 95% target)
- [ ] **Error Rate:** Monitor Sentry for unexpected errors (< 0.1% target)
- [ ] **Database Size:** Check database growth rate
- [ ] **Cache Hit Rate:** Monitor Redis cache hit rate (> 70% target)
- [ ] **Backup Verification:** Verify daily backups are running
- [ ] **SEO:** Check Google indexing status

### Month 1

- [ ] **User Acquisition:** Track user growth and retention
- [ ] **Feature Usage:** Analyze which features are most used
- [ ] **Performance Optimization:** Optimize slow endpoints
- [ ] **Content Updates:** Add blog posts and case studies
- [ ] **Marketing:** Increase social media presence
- [ ] **A/B Testing:** Test different UI variations
- [ ] **User Interviews:** Conduct 5+ user interviews

---

## Troubleshooting

### Application Won't Start

```bash
# Check PM2 status
pm2 status

# Check logs for errors
pm2 logs ipodhan-web --err --lines 100

# Common issues:
# 1. Port 3000 already in use
sudo lsof -i :3000
# Kill process if needed

# 2. Environment variables missing
pm2 env ipodhan-web

# 3. Database connection failed
psql -U ipodhan_user -d ipodhan -h localhost -p 5432

# 4. Redis connection failed
redis-cli -a your_redis_password_here ping
```

### SSL Certificate Issues

```bash
# Check certificate status
sudo certbot certificates

# Renew certificate manually
sudo certbot renew --force-renewal

# Test Nginx configuration
sudo nginx -t

# Check SSL Labs score
# Visit: https://www.ssllabs.com/ssltest/
```

### Database Connection Errors

```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Check database logs
sudo tail -f /var/log/postgresql/postgresql-15-main.log

# Test connection
psql -U ipodhan_user -d ipodhan -h localhost -p 5432

# Reset user password if needed
sudo -u postgres psql
ALTER USER ipodhan_user WITH PASSWORD 'new_password';
```

### Scraper Failures

```bash
# Check scraper logs
pm2 logs ipodhan-scrapers

# Check scraper status
curl https://yourdomain.com/api/admin/scraper/status

# Manually trigger scraper
cd /var/www/ipodhan/web
npm run scraper:nse

# Check database for last scraped data
psql -U ipodhan_user -d ipodhan
SELECT company_name, last_scraped_at FROM ipos ORDER BY last_scraped_at DESC LIMIT 10;
```

### High Memory Usage

```bash
# Check PM2 memory usage
pm2 list

# Restart application if needed
pm2 restart ipodhan-web

# Check system resources
free -h
htop

# Optimize PM2 configuration (reduce instances)
# Edit ecosystem.config.js
instances: 1  # Instead of 2

# Restart with new config
pm2 delete ipodhan-web
pm2 start ecosystem.config.js
```

### Slow API Responses

```bash
# Check Redis connection
redis-cli -a your_redis_password_here

# Clear Redis cache if needed
redis-cli -a your_redis_password_here FLUSHDB

# Check database query performance
# Enable slow query logging in PostgreSQL
sudo nano /etc/postgresql/15/main/postgresql.conf
log_min_duration_statement = 1000  # Log queries > 1 second

# Restart PostgreSQL
sudo systemctl restart postgresql

# Check for missing indexes
# Review database schema and add indexes if needed
```

---

## Rollback Procedures

### Quick Rollback (If Deployment Fails)

```bash
# Stop current deployment
pm2 stop ipodhan-web

# Checkout previous stable version
cd /var/www/ipodhan
git checkout v1.0.0  # Replace with last stable tag

# Rebuild
cd web
npm ci
npm run build

# Restart
pm2 restart ipodhan-web
```

### Database Rollback

```bash
# Restore from latest backup
cd /var/www/ipodhan/backups/database

# Find latest backup
ls -lht

# Restore (THIS WILL REPLACE CURRENT DATA!)
gunzip -c latest.sql.gz | psql -U ipodhan_user -d ipodhan

# Verify restoration
psql -U ipodhan_user -d ipodhan
SELECT COUNT(*) FROM ipos;
```

### Full System Restore

```bash
# 1. Restore VPS from snapshot (via provider dashboard)
# 2. Restore database from backup (see above)
# 3. Pull latest stable code from Git
# 4. Rebuild and restart application
```

---

## Support & Escalation

### Support Contacts

- **Technical Lead:** [Name] - [Email]
- **DevOps:** [Name] - [Email]
- **Product Owner:** [Name] - [Email]

### Escalation Matrix

| Severity | Response Time | Escalation |
|----------|---------------|------------|
| **P0 - Critical** (Site down) | 15 minutes | Technical Lead immediately |
| **P1 - High** (Major feature broken) | 1 hour | Technical Lead within 2 hours |
| **P2 - Medium** (Minor issue) | 4 hours | Next business day |
| **P3 - Low** (Enhancement) | 1 week | Backlog review |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2025-10-10 | Initial deployment runbook | Dev Team |

---

## Additional Resources

- **Project Repository:** https://github.com/yourusername/IPODhan
- **Documentation:** https://docs.yourdomain.com
- **Status Page:** https://status.yourdomain.com (to be set up)
- **Monitoring Dashboard:** https://grafana.yourdomain.com (to be set up)

---

**END OF RUNBOOK**
