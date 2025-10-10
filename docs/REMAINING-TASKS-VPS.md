# Remaining Tasks - VPS Server Implementation

**Date Created:** October 10, 2025
**Status:** Ready for VPS Deployment
**Prerequisites:** All Dev environment tasks completed ✅

---

## Overview

This document outlines the remaining tasks from the Epic 1-7 review that must be completed on the VPS server. All code-level implementation has been completed in the Dev environment and is ready for deployment.

**Total Remaining Tasks:** 5
- Infrastructure/VPS Tasks: 3
- Feature Development Tasks: 2

---

## Critical Priority Tasks (Complete First)

### 1. Configure Domain and SSL/HTTPS ⚡ CRITICAL

**Priority:** CRITICAL (P0)
**Estimated Time:** 1-2 hours
**Status:** ⏳ NOT STARTED
**Location:** Production VPS

#### Prerequisites
- Domain name purchased and DNS configured
- VPS IP address configured
- Nginx installed on VPS

#### Implementation Steps

**Step 1: Configure Domain DNS**
```
1. Log into domain registrar (e.g., GoDaddy, Namecheap, etc.)
2. Add A record:
   - Type: A
   - Name: @ (or your domain)
   - Value: [YOUR_VPS_IP_ADDRESS]
   - TTL: 3600

3. Add A record for www subdomain:
   - Type: A
   - Name: www
   - Value: [YOUR_VPS_IP_ADDRESS]
   - TTL: 3600

4. Wait for DNS propagation (can take 1-48 hours, usually < 1 hour)
5. Verify DNS: ping yourdomain.com
```

**Step 2: Install Certbot (If not already installed)**
```bash
# SSH into VPS
ssh user@your-vps-ip

# Update packages
sudo apt-get update

# Install Certbot for Nginx
sudo apt-get install -y certbot python3-certbot-nginx
```

**Step 3: Obtain SSL Certificate**
```bash
# Replace yourdomain.com with your actual domain
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Follow prompts:
# 1. Enter email address for renewal notifications
# 2. Agree to Terms of Service (Y)
# 3. Share email with EFF (optional - Y or N)
# 4. Redirect HTTP to HTTPS? (2 - Yes, recommended)
```

**Step 4: Verify SSL Certificate**
```bash
# Check certificate
sudo certbot certificates

# Test renewal (dry run)
sudo certbot renew --dry-run

# Check auto-renewal timer
sudo systemctl status certbot.timer
```

**Step 5: Configure Nginx**

The Nginx configuration is documented in `docs/DEPLOYMENT-RUNBOOK.md` section "SSL/HTTPS Configuration".

Key configuration file: `/etc/nginx/sites-available/ipodhan`

```bash
# Test Nginx configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx

# Check status
sudo systemctl status nginx
```

**Step 6: Update Environment Variables**
```bash
cd /var/www/ipodhan/web
nano .env.production

# Update URL and port
NEXT_PUBLIC_APP_URL=https://yourdomain.com
PORT=3000

# Note: The application uses dynamic port detection
# - Client-side: Uses relative URLs (/api) automatically
# - Server-side: Detects port from PORT environment variable
# No need to set NEXT_PUBLIC_API_BASE_URL unless using custom configuration
```

**Step 7: Verify SSL Grade**
- Visit https://www.ssllabs.com/ssltest/
- Enter your domain
- Target: A+ rating

#### Testing Checklist
- [ ] Domain resolves to VPS IP
- [ ] HTTPS is working (green padlock in browser)
- [ ] HTTP redirects to HTTPS automatically
- [ ] www and non-www both work
- [ ] SSL Labs score is A or A+
- [ ] Certificate auto-renewal is configured
- [ ] Application loads correctly over HTTPS

#### Troubleshooting
- **DNS not resolving:** Check DNS propagation status at https://dnschecker.org
- **Certbot fails:** Ensure ports 80 and 443 are open in firewall
- **Nginx config error:** Run `sudo nginx -t` to identify syntax errors
- **Certificate not renewing:** Check timer with `sudo systemctl status certbot.timer`

---

### 2. Set Up Automated Database Backups ⚡ HIGH

**Priority:** HIGH (P1)
**Estimated Time:** 1 hour
**Status:** ⏳ NOT STARTED (Script ready, needs deployment)
**Location:** Production VPS

#### Prerequisites
- PostgreSQL database running on VPS
- Backup scripts created (✅ completed in Dev)
- Cloud storage credentials (AWS CLI, gsutil, or Azure CLI) - OPTIONAL

#### Implementation Steps

**Step 1: Copy Backup Script to VPS**
```bash
# On your local machine
scp scripts/backup-database.sh user@your-vps-ip:/var/www/ipodhan/scripts/

# SSH into VPS
ssh user@your-vps-ip

# Make script executable
chmod +x /var/www/ipodhan/scripts/backup-database.sh
```

**Step 2: Configure Environment Variables**
```bash
# Edit .env file on VPS
cd /var/www/ipodhan
nano .env

# Add backup configuration
POSTGRES_DB=ipodhan
POSTGRES_USER=ipodhan_user
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_PASSWORD=your_production_db_password

BACKUP_DIR=/var/backups/ipodhan/database
BACKUP_RETENTION_DAYS=30

# Optional: Cloud storage configuration
BACKUP_CLOUD_BUCKET=your-s3-bucket-name
BACKUP_CLOUD_PROVIDER=s3  # or gcs, azure
BACKUP_NOTIFY_EMAIL=admin@yourdomain.com

# Note: PORT variable is also used by the API client for server-side requests
PORT=3000
```

**Step 3: Create Backup Directory**
```bash
sudo mkdir -p /var/backups/ipodhan/database
sudo chown $USER:$USER /var/backups/ipodhan/database
```

**Step 4: Test Backup Script Manually**
```bash
cd /var/www/ipodhan

# Test backup without cloud upload
./scripts/backup-database.sh

# Verify backup created
ls -lh /var/backups/ipodhan/database/

# Test backup with cloud upload (if configured)
./scripts/backup-database.sh --upload-to-cloud

# Verify backup integrity
gzip -t /var/backups/ipodhan/database/latest.sql.gz
```

**Step 5: Test Restoration (IMPORTANT)**
```bash
# Create test database
sudo -u postgres psql
CREATE DATABASE ipodhan_test;
\q

# Restore backup to test database
gunzip -c /var/backups/ipodhan/database/latest.sql.gz | \
  sudo -u postgres psql -d ipodhan_test

# Verify restoration
sudo -u postgres psql -d ipodhan_test -c "SELECT COUNT(*) FROM ipos;"

# Drop test database
sudo -u postgres psql -c "DROP DATABASE ipodhan_test;"
```

**Step 6: Configure Automated Backups with Cron**
```bash
# Edit crontab
crontab -e

# Add cron job (daily at 2 AM with cloud upload)
0 2 * * * /var/www/ipodhan/scripts/backup-database.sh --upload-to-cloud >> /var/log/ipodhan-backup.log 2>&1

# Save and exit

# Verify cron job
crontab -l
```

**Step 7: Configure Cloud Storage (OPTIONAL but RECOMMENDED)**

**For AWS S3:**
```bash
# Install AWS CLI
sudo apt-get install -y awscli

# Configure AWS credentials
aws configure
# Enter: Access Key ID, Secret Access Key, Region, Output format

# Test S3 upload
aws s3 ls s3://your-bucket-name/
```

**For Google Cloud Storage:**
```bash
# Install gsutil
curl https://sdk.cloud.google.com | bash
exec -l $SHELL

# Initialize gcloud
gcloud init

# Test GCS access
gsutil ls gs://your-bucket-name/
```

**For Azure Blob Storage:**
```bash
# Install Azure CLI
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

# Login to Azure
az login

# Test access
az storage blob list --account-name your-storage-account --container-name backups
```

#### Testing Checklist
- [ ] Backup script executes successfully
- [ ] Backup file is created and compressed
- [ ] Backup integrity verified (gzip -t)
- [ ] Restoration test successful
- [ ] Old backups are cleaned up (after retention period)
- [ ] Cloud upload works (if configured)
- [ ] Cron job configured correctly
- [ ] First automated backup completes successfully

#### Monitoring
```bash
# Check backup logs
tail -f /var/log/ipodhan-backup.log

# List recent backups
ls -lht /var/backups/ipodhan/database/ | head -10

# Check cron job execution
grep CRON /var/log/syslog | grep backup-database
```

---

## High Priority Tasks (Complete Week 1)

### 3. Set Up Monitoring Dashboard for Scraper Status 📊

**Priority:** HIGH (P1)
**Estimated Time:** 4 hours
**Status:** ⏳ NOT STARTED
**Location:** Can be developed locally, deployed to VPS

#### Prerequisites
- Scraper status API already exists: `/api/admin/scraper/status` ✅
- Redis metrics being tracked ✅

#### Implementation Plan

**Create Admin Dashboard Page:**
```
File: web/app/admin/scrapers/page.tsx

Features to implement:
1. Real-time scraper status display
2. Health indicators (HEALTHY, DEGRADED, CRITICAL)
3. Success rate charts (24h, 7d, 30d trends)
4. Last run timestamps
5. Consecutive failures counter
6. Records processed in last 24h
7. Auto-refresh every 30 seconds
```

**Component Structure:**
```
/admin
  /scrapers
    page.tsx (Main dashboard)
    /components
      ScraperStatusCard.tsx (Status card for each scraper)
      ScraperHealthChart.tsx (Success rate chart)
      ScraperMetrics.tsx (Metrics display)
      RefreshButton.tsx (Manual refresh)
```

**Implementation Steps:**

1. **Create Admin Layout:**
```bash
mkdir -p web/app/admin/scrapers/components
```

2. **Implement Main Dashboard Page:**
   - Fetch data from `/api/admin/scraper/status`
   - Display status cards for NSE, BSE, API Fallback
   - Add auto-refresh with polling
   - Add manual refresh button

3. **Create Status Cards:**
   - Visual health indicators (green/yellow/red)
   - Display last run time
   - Show success rate
   - Display consecutive failures

4. **Add Charts (Optional but Recommended):**
   - Use recharts or chart.js
   - Show success rate trends
   - Line chart for 24h/7d/30d

5. **Add Authentication (IMPORTANT):**
   - Protect `/admin/*` routes
   - Add simple password protection or API key
   - Environment variable: `ADMIN_PASSWORD`

6. **Deploy to VPS:**
```bash
git add .
git commit -m "feat: Add scraper monitoring dashboard"
git push
cd /var/www/ipodhan && git pull
cd web && npm run build
pm2 restart ipodhan-web
```

#### Testing
- [ ] Dashboard loads at `/admin/scrapers`
- [ ] Status cards display correctly
- [ ] Health indicators work (test with failing scraper)
- [ ] Auto-refresh works (30 second interval)
- [ ] Charts display (if implemented)
- [ ] Admin authentication works

---

### 4. Add Performance Monitoring (APM) 📈

**Priority:** HIGH (P1)
**Estimated Time:** 3 hours
**Status:** ⏳ NOT STARTED
**Location:** VPS Configuration

#### Prerequisites
- Sentry already configured for error tracking ✅
- API endpoints operational ✅

#### Recommended Solution: Sentry Performance Monitoring

**Why Sentry Performance:**
- Already using Sentry for error tracking
- Free tier: 10K transactions/month
- Easy integration with existing setup
- Automatic API endpoint tracking
- Database query monitoring

#### Implementation Steps

**Step 1: Enable Sentry Performance in Code**

Edit `web/sentry.client.config.ts`:
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Enable performance monitoring
  tracesSampleRate: 1.0, // 100% in dev, reduce to 0.1 (10%) in production

  // Enable profiling
  profilesSampleRate: 1.0,

  integrations: [
    new Sentry.BrowserTracing({
      tracePropagationTargets: ["localhost", /^https:\/\/yourdomain\.com/],
    }),
  ],
});
```

Edit `web/sentry.server.config.ts`:
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1, // 10% sampling in production
  profilesSampleRate: 1.0,
});
```

**Step 2: Add Custom Transaction Tracking**

For critical API routes, add custom transactions:
```typescript
// Example: In API route
import * as Sentry from '@sentry/nextjs';

export async function GET(request: NextRequest) {
  const transaction = Sentry.startTransaction({
    op: "http.server",
    name: "GET /api/ipos",
  });

  try {
    // Your API logic
    const span = transaction.startChild({
      op: "db.query",
      description: "Fetch IPOs from database",
    });

    const result = await fetchIPOs();
    span.finish();

    transaction.setStatus("ok");
    return NextResponse.json(result);
  } catch (error) {
    transaction.setStatus("internal_error");
    throw error;
  } finally {
    transaction.finish();
  }
}
```

**Step 3: Enable in Sentry Dashboard**
1. Log into Sentry.io
2. Go to Project Settings
3. Enable Performance Monitoring
4. Set up alerts for slow transactions (> 500ms)

**Step 4: Deploy and Monitor**
```bash
# Update environment variables on VPS
cd /var/www/ipodhan/web
nano .env.production

# Add Sentry Performance config
SENTRY_TRACES_SAMPLE_RATE=0.1  # 10% sampling

# Rebuild and restart
npm run build
pm2 restart ipodhan-web
```

#### Alternative: Custom Prometheus + Grafana

If you prefer open-source, self-hosted solution:

**Step 1: Install Prometheus**
```bash
# Install Prometheus
wget https://github.com/prometheus/prometheus/releases/download/v2.45.0/prometheus-2.45.0.linux-amd64.tar.gz
tar xvfz prometheus-*.tar.gz
sudo mv prometheus-2.45.0.linux-amd64 /opt/prometheus

# Create systemd service
sudo nano /etc/systemd/system/prometheus.service
```

**Step 2: Install Grafana**
```bash
sudo apt-get install -y software-properties-common
sudo add-apt-repository "deb https://packages.grafana.com/oss/deb stable main"
wget -q -O - https://packages.grafana.com/gpg.key | sudo apt-key add -
sudo apt-get update
sudo apt-get install grafana
sudo systemctl enable grafana-server
sudo systemctl start grafana-server
```

**Step 3: Add Metrics to Application**
Use `prom-client` npm package to expose metrics endpoint.

#### Testing
- [ ] Performance tracking enabled in Sentry
- [ ] API endpoints showing response times
- [ ] Slow transaction alerts configured (> 500ms)
- [ ] Database query performance visible
- [ ] Graphs showing p50, p75, p95, p99 latencies

---

## Medium Priority Tasks (Complete Month 1)

### 5. Create User Feedback Mechanism 💬

**Priority:** MEDIUM (P2)
**Estimated Time:** 4 hours
**Status:** ⏳ NOT STARTED
**Location:** Feature development (Dev + VPS)

#### Implementation Plan

**Features to Build:**
1. Contact form page at `/contact`
2. Floating feedback widget (bottom-right corner)
3. API endpoint to store feedback
4. Admin page to view feedback
5. Email notifications

**Step 1: Create Database Schema**
```sql
-- Add to database schema
CREATE TABLE feedback (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  page_url VARCHAR(500),
  user_agent TEXT,
  status VARCHAR(20) DEFAULT 'new', -- new, read, replied, archived
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_feedback_status ON feedback(status);
CREATE INDEX idx_feedback_created_at ON feedback(created_at);
```

**Step 2: Create API Endpoint**
```
File: web/app/api/feedback/route.ts

POST /api/feedback
- Accepts: name, email, message, page_url
- Validates input
- Stores in database
- Sends email notification
- Returns success/error
```

**Step 3: Create Contact Page**
```
File: web/app/contact/page.tsx

- Contact form with validation
- Fields: Name, Email, Message
- CAPTCHA (optional but recommended)
- Success/error messages
```

**Step 4: Create Feedback Widget**
```
File: web/components/shared/FeedbackWidget.tsx

- Floating button (bottom-right)
- Opens modal with form
- Quick feedback submission
- Add to RootLayout
```

**Step 5: Create Admin Feedback Page**
```
File: web/app/admin/feedback/page.tsx

- List all feedback
- Filter by status
- Mark as read/replied
- Reply button (opens email client)
```

**Step 6: Email Notifications**
Use existing email service or add nodemailer:
```bash
npm install nodemailer
```

#### Testing
- [ ] Contact form submits successfully
- [ ] Feedback widget works from any page
- [ ] Email notification received
- [ ] Admin page shows feedback
- [ ] Status updates work

---

### 6. Generate OpenAPI/Swagger Documentation 📚

**Priority:** MEDIUM (P2)
**Estimated Time:** 6 hours
**Status:** ⏳ NOT STARTED
**Location:** Feature development (Dev + VPS)

#### Implementation Plan

Use `next-swagger-doc` to auto-generate OpenAPI spec from API routes.

**Step 1: Install Dependencies**
```bash
cd web
npm install next-swagger-doc swagger-ui-react
npm install -D @types/swagger-ui-react
```

**Step 2: Create Swagger Configuration**
```
File: web/lib/swagger/config.ts

Configure:
- API title, version, description
- Server URLs
- Security schemes
- Tag definitions
```

**Step 3: Add JSDoc Comments to API Routes**

Example for `/api/ipos/route.ts`:
```typescript
/**
 * @swagger
 * /api/ipos:
 *   get:
 *     summary: Get list of IPOs
 *     description: Returns paginated, filtered, and sorted IPO listings
 *     tags:
 *       - IPOs
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [UPCOMING, OPEN, CLOSED, LISTED]
 *         description: Filter by IPO status
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/IPO'
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 */
export async function GET(request: NextRequest) {
  // ...
}
```

**Step 4: Generate OpenAPI Spec**
```bash
# Add script to package.json
"swagger": "next-swagger-doc -i ./app/api -o ./public/swagger.json"

# Generate
npm run swagger
```

**Step 5: Create Swagger UI Page**
```
File: web/app/api/docs/page.tsx

- Display Swagger UI
- Load generated swagger.json
- Make interactive
```

**Step 6: Deploy**
```bash
git add .
git commit -m "docs: Add OpenAPI/Swagger documentation"
git push
# Deploy to VPS
```

#### Testing
- [ ] Swagger UI loads at `/api/docs`
- [ ] All API endpoints documented
- [ ] "Try it out" functionality works
- [ ] Schema definitions are correct
- [ ] Authentication documented (if applicable)

---

## Deployment Checklist

Before starting VPS tasks, ensure:

- [ ] All code changes committed to git
- [ ] Dev environment tests passing
- [ ] Environment variables documented
- [ ] Backup of current production state (if any)
- [ ] Deployment runbook reviewed

**Recommended Order:**
1. Configure Domain & SSL (CRITICAL - do first)
2. Set Up Database Backups (HIGH - prevents data loss)
3. Deploy code changes to VPS
4. Set Up Monitoring Dashboard (HIGH - visibility)
5. Enable Performance Monitoring (HIGH - optimization)
6. Create Feedback Mechanism (MEDIUM - user engagement)
7. Generate API Documentation (MEDIUM - developer experience)

---

## Post-Implementation Verification

After completing all tasks:

### System Health Check
```bash
# Check application status
pm2 status

# Check Nginx
sudo systemctl status nginx

# Check SSL
sudo certbot certificates

# Check database backups
ls -lh /var/backups/ipodhan/database/

# Check cron jobs
crontab -l

# Check logs
pm2 logs ipodhan-web --lines 50
```

### Monitoring Verification
- [ ] Scraper dashboard accessible and updating
- [ ] Sentry receiving performance data
- [ ] API response times < 500ms (p95)
- [ ] Email notifications working
- [ ] Backup cron job running daily

### Security Verification
- [ ] HTTPS enforced (HTTP redirects)
- [ ] SSL Labs score A or A+
- [ ] Rate limiting active on all API routes
- [ ] Admin routes protected
- [ ] Firewall rules configured correctly

---

## Support & Resources

**Documentation:**
- Main deployment runbook: `docs/DEPLOYMENT-RUNBOOK.md`
- Implementation summary: `docs/reviews/implementation-summary-epics-1-7.md`

**Code References:**
- Rate limiting middleware: `web/lib/middleware/rate-limiter.ts`
- Backup scripts: `scripts/backup-database.sh`, `scripts/backup-database.ps1`
- Scraper status API: `web/app/api/admin/scraper/status/route.ts`

**Troubleshooting:**
- See `docs/DEPLOYMENT-RUNBOOK.md` section "Troubleshooting"
- Check PM2 logs: `pm2 logs`
- Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`
- Check database logs: `sudo tail -f /var/log/postgresql/postgresql-15-main.log`

---

## Notes

- All scripts and configurations have been tested in Dev environment
- Environment-specific values (domain, passwords, API keys) must be configured on VPS
- Estimated total time: 15-20 hours for all remaining tasks
- Critical tasks (SSL, backups) should be completed before public launch
- Medium priority tasks can be completed post-launch

---

**Last Updated:** October 10, 2025
**Status:** Ready for VPS Implementation
**Completed By:** Dev Team
**To Be Completed By:** VPS Administrator / DevOps

---

**END OF DOCUMENT**
