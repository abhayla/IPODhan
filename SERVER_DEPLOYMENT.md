# SERVER DEPLOYMENT GUIDE - IPODhan Data Pipeline

**Target Server:** 103.118.16.189 (Production)
**For Use By:** Claude Code on Production Server
**Date:** 2025-10-01
**Story:** 1.2 IPO Data Pipeline

---

## 🎯 Quick Start for Claude Code

This guide allows Claude Code on the production server to deploy and run the IPO Data Pipeline with minimal manual intervention.

---

## 📋 Prerequisites Check

Before starting, verify:
- [ ] Python 3.11+ installed
- [ ] PostgreSQL 16 installed and running
- [ ] Database `ipodhan` exists
- [ ] User `postgres` has access
- [ ] Git installed (optional, for cloning)

---

## 🚀 Deployment Steps (For Claude Code)

### Step 1: Transfer Files to Server

**Files needed on server:**
```
/opt/ipodhan/                           # or /home/user/ipodhan/
├── infrastructure/
│   └── database/
│       └── migrations/
│           ├── 001_initial_schema.sql
│           └── 002_enhanced_ipo_schema.sql
├── ipodhan-data-pipeline/
│   ├── scrapers/
│   ├── validators/
│   ├── repositories/
│   ├── orchestrator/
│   ├── monitoring/
│   ├── schemas/
│   ├── scripts/
│   ├── tests/
│   ├── main.py
│   ├── requirements.txt
│   └── .env.example
├── SERVER_DEPLOYMENT.md (this file)
└── deploy_server.sh (deployment script)
```

**Transfer Command (from local machine):**
```bash
# Option A: Using SCP
scp -r D:\Abhay\VibeCoding\IPODhan user@103.118.16.189:/opt/ipodhan/

# Option B: Using rsync (recommended)
rsync -avz --exclude='node_modules' --exclude='.git' \
  D:\Abhay\VibeCoding\IPODhan/ user@103.118.16.189:/opt/ipodhan/

# Option C: Git clone (if repository is available)
ssh user@103.118.16.189
cd /opt
git clone <repository-url> ipodhan
```

---

### Step 2: Run Automated Deployment Script

**On the server, as Claude Code, run:**

```bash
cd /opt/ipodhan
chmod +x deploy_server.sh
./deploy_server.sh
```

This script will:
1. ✅ Check system prerequisites
2. ✅ Install Python dependencies
3. ✅ Configure environment variables
4. ✅ Run database migrations
5. ✅ Test the pipeline
6. ✅ Set up systemd service (optional)

---

### Step 3: Manual Steps (If Automated Script Fails)

#### 3.1: Install Python Dependencies

```bash
cd /opt/ipodhan/ipodhan-data-pipeline

# Create virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Install Playwright browsers
playwright install chromium
```

#### 3.2: Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit configuration
nano .env

# Update these values:
DB_HOST=localhost              # or 103.118.16.189
DB_PORT=5432
DB_NAME=ipodhan
DB_USER=postgres
DB_PASSWORD=<your-password>    # ⚠️ Update this!
SENTRY_DSN=<your-sentry-dsn>   # Optional
```

#### 3.3: Run Database Migrations

```bash
# Navigate to migrations directory
cd /opt/ipodhan/infrastructure/database/migrations

# Run migration 002 (001 should already be applied)
psql -h localhost -U postgres -d ipodhan -f 002_enhanced_ipo_schema.sql

# Verify migration
psql -h localhost -U postgres -d ipodhan -c "
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name IN ('ipo_details', 'ipo_financials', 'gmp_tracking', 'pipeline_status')
  ORDER BY table_name;
"

# Should return 4 rows
```

#### 3.4: Test the Pipeline

```bash
cd /opt/ipodhan/ipodhan-data-pipeline

# Activate virtual environment (if using)
source venv/bin/activate

# Test IPO pipeline
python main.py run-ipo

# Test GMP pipeline
python main.py run-gmp

# Test full pipeline
python main.py run-full

# Check health
python main.py health-check
```

---

## 🔧 Production Configuration

### Environment Variables (.env)

```bash
# Production Settings
ENVIRONMENT=production

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ipodhan
DB_USER=postgres
DB_PASSWORD=<SECURE_PASSWORD>  # ⚠️ Use strong password
DB_POOL_MIN=2
DB_POOL_MAX=20                  # Increased for production

# Sentry Error Tracking
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id

# Scraping Configuration
SCRAPE_TIMEOUT=30
SCRAPE_RETRY_COUNT=3
MARKET_HOURS_START=09:00
MARKET_HOURS_END=17:00

# Scheduling (production rates)
IPO_SCRAPE_INTERVAL=15          # Every 15 minutes
GMP_SCRAPE_INTERVAL_MARKET=30   # Every 30 minutes during market hours
GMP_SCRAPE_INTERVAL_OFFHOURS=60 # Every 60 minutes off-hours

# Logging
LOG_LEVEL=INFO                  # Use WARNING or ERROR for production
```

---

## 🐧 Set Up as System Service (Linux)

### Create Systemd Service

```bash
# Create service file
sudo nano /etc/systemd/system/ipodhan-pipeline.service
```

**Service Configuration:**
```ini
[Unit]
Description=IPODhan Data Pipeline Service
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/ipodhan/ipodhan-data-pipeline
Environment="PATH=/opt/ipodhan/ipodhan-data-pipeline/venv/bin"
ExecStart=/opt/ipodhan/ipodhan-data-pipeline/venv/bin/python main.py schedule
Restart=always
RestartSec=10

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ipodhan-pipeline

[Install]
WantedBy=multi-user.target
```

**Enable and Start Service:**
```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service (start on boot)
sudo systemctl enable ipodhan-pipeline

# Start service
sudo systemctl start ipodhan-pipeline

# Check status
sudo systemctl status ipodhan-pipeline

# View logs
sudo journalctl -u ipodhan-pipeline -f
```

**Service Management:**
```bash
# Stop service
sudo systemctl stop ipodhan-pipeline

# Restart service
sudo systemctl restart ipodhan-pipeline

# Disable service
sudo systemctl disable ipodhan-pipeline
```

---

## 📊 Monitoring & Maintenance

### Health Check (Run Periodically)

```bash
cd /opt/ipodhan/ipodhan-data-pipeline
source venv/bin/activate
python main.py health-check
```

**Expected Output:**
```
Health check completed: 5 sources monitored
Source: NSE             Status: SUCCESS    Freshness: GREEN
Source: BSE             Status: SUCCESS    Freshness: GREEN
Source: IPOWATCH        Status: SUCCESS    Freshness: GREEN
Source: INVESTORGAIN    Status: SUCCESS    Freshness: GREEN
Source: CHITTORGARH     Status: SUCCESS    Freshness: GREEN
No alerts triggered
```

### Weekly Metrics Report

```bash
python main.py metrics
```

### View Logs

```bash
# If using systemd
sudo journalctl -u ipodhan-pipeline -f

# If running manually, logs go to stdout
# Redirect to file:
python main.py schedule >> /var/log/ipodhan-pipeline.log 2>&1
```

---

## 🔒 Security Checklist

### Before Going Live:

- [ ] Change default PostgreSQL password
- [ ] Use strong password in `.env` file
- [ ] Set `.env` file permissions: `chmod 600 .env`
- [ ] Configure Sentry for error tracking
- [ ] Set up firewall rules (allow only necessary ports)
- [ ] Enable SSL/TLS for database connections (if remote)
- [ ] Regular backups configured
- [ ] Log rotation configured
- [ ] Monitor disk space usage

### Firewall Configuration

```bash
# Allow SSH (if not already)
sudo ufw allow 22/tcp

# Allow PostgreSQL (only if needed externally)
# sudo ufw allow 5432/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

---

## 🚨 Troubleshooting

### Issue: "Module not found" errors

```bash
# Ensure virtual environment is activated
source /opt/ipodhan/ipodhan-data-pipeline/venv/bin/activate

# Reinstall dependencies
pip install -r requirements.txt
```

### Issue: Database connection failed

```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Test connection
psql -h localhost -U postgres -d ipodhan -c "SELECT version();"

# Check credentials in .env
cat .env | grep DB_
```

### Issue: Playwright browser errors

```bash
# Reinstall browsers
playwright install chromium

# Check browser installation
playwright install --help
```

### Issue: Permission denied errors

```bash
# Fix ownership
sudo chown -R www-data:www-data /opt/ipodhan

# Fix permissions
chmod +x /opt/ipodhan/ipodhan-data-pipeline/main.py
```

### Issue: Scraping timeouts

```bash
# Increase timeout in .env
SCRAPE_TIMEOUT=60

# Check internet connectivity
curl -I https://www.nseindia.com
curl -I https://www.bseindia.com
```

---

## 📝 Verification Checklist

After deployment, verify:

### Database
```bash
# Check tables exist
psql -h localhost -U postgres -d ipodhan -c "\dt"

# Check new tables from migration 002
psql -h localhost -U postgres -d ipodhan -c "
  SELECT table_name FROM information_schema.tables
  WHERE table_name IN ('ipo_details', 'ipo_financials', 'gmp_tracking', 'pipeline_status');
"
```

### Pipeline
```bash
cd /opt/ipodhan/ipodhan-data-pipeline
source venv/bin/activate

# Run test
python main.py run-full

# Check health
python main.py health-check

# View data
psql -h localhost -U postgres -d ipodhan -c "SELECT COUNT(*) FROM ipos;"
psql -h localhost -U postgres -d ipodhan -c "SELECT COUNT(*) FROM gmp_tracking;"
```

### Service (if using systemd)
```bash
# Check service is running
sudo systemctl is-active ipodhan-pipeline

# Check for errors
sudo journalctl -u ipodhan-pipeline --since "10 minutes ago"
```

---

## 📁 File Permissions

```bash
# Set correct ownership
sudo chown -R www-data:www-data /opt/ipodhan

# Set directory permissions
find /opt/ipodhan -type d -exec chmod 755 {} \;

# Set file permissions
find /opt/ipodhan -type f -exec chmod 644 {} \;

# Make scripts executable
chmod +x /opt/ipodhan/deploy_server.sh
chmod +x /opt/ipodhan/ipodhan-data-pipeline/main.py
chmod +x /opt/ipodhan/ipodhan-data-pipeline/scripts/*.py

# Secure .env file
chmod 600 /opt/ipodhan/ipodhan-data-pipeline/.env
```

---

## 🔄 Update/Redeploy

To update the pipeline:

```bash
# Stop service
sudo systemctl stop ipodhan-pipeline

# Pull latest code (if using git)
cd /opt/ipodhan
git pull origin main

# Or upload new files via SCP/rsync

# Install new dependencies (if any)
cd ipodhan-data-pipeline
source venv/bin/activate
pip install -r requirements.txt

# Run new migrations (if any)
cd ../infrastructure/database/migrations
psql -h localhost -U postgres -d ipodhan -f 003_new_migration.sql

# Restart service
sudo systemctl start ipodhan-pipeline

# Verify
sudo systemctl status ipodhan-pipeline
```

---

## 📞 Support Commands

```bash
# View all available commands
cd /opt/ipodhan/ipodhan-data-pipeline
python main.py help

# Manual run (one-time)
python main.py run-full

# Check pipeline status
python main.py health-check

# Generate weekly report
python main.py metrics

# Start scheduled pipeline (foreground)
python main.py schedule
```

---

## 🎯 Success Criteria

Deployment is successful when:

- ✅ All Python dependencies installed
- ✅ Database migrations completed (4 new tables)
- ✅ `.env` file configured with correct credentials
- ✅ `python main.py run-full` executes without errors
- ✅ `python main.py health-check` shows GREEN status
- ✅ Data appears in database tables
- ✅ Service runs automatically (if configured)
- ✅ Logs show regular scraping activity

---

## 📚 Additional Resources

- **README:** `/opt/ipodhan/ipodhan-data-pipeline/README.md`
- **Implementation Details:** `/opt/ipodhan/IMPLEMENTATION_SUMMARY.md`
- **Migration File:** `/opt/ipodhan/infrastructure/database/migrations/002_enhanced_ipo_schema.sql`
- **Main Entry Point:** `/opt/ipodhan/ipodhan-data-pipeline/main.py`

---

## 🤖 For Claude Code

**Quick Command Sequence:**
```bash
cd /opt/ipodhan
./deploy_server.sh

# Or manually:
cd ipodhan-data-pipeline
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install chromium
cp .env.example .env
# Edit .env with correct credentials
cd ../infrastructure/database/migrations
psql -h localhost -U postgres -d ipodhan -f 002_enhanced_ipo_schema.sql
cd ../../ipodhan-data-pipeline
python main.py run-full
python main.py health-check
```

---

**Deployment Status:** Ready for Production
**Estimated Time:** 15-20 minutes
**Last Updated:** 2025-10-01
**Support:** Refer to README.md and IMPLEMENTATION_SUMMARY.md
