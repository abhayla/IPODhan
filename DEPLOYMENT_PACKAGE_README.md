# 📦 Production Deployment Package - IPODhan Data Pipeline

**Server:** 103.118.16.189
**For:** Claude Code AI Assistant
**Date:** 2025-10-01
**Version:** 1.0 (Story 1.2)

---

## 📋 Package Contents

This deployment package contains everything needed to deploy the IPODhan Data Pipeline on the production server.

### 📂 Files Included

| File | Purpose | Use By |
|------|---------|--------|
| **SERVER_DEPLOYMENT.md** | Complete deployment guide | Claude Code (Primary) |
| **QUICK_START_SERVER.md** | Quick reference card | Claude Code (Quick ref) |
| **deploy_server.sh** | Automated deployment script | Claude Code (Automated) |
| **ipodhan-pipeline.service** | Systemd service file | System Admin |
| **IMPLEMENTATION_SUMMARY.md** | Technical implementation details | Reference |
| **SETUP_COMPLETION.md** | Local setup status | Reference |

### 📁 Directories to Transfer

```
/opt/ipodhan/                           # Target on server
├── infrastructure/
│   └── database/
│       └── migrations/
│           ├── 001_initial_schema.sql      # Already applied (assumed)
│           └── 002_enhanced_ipo_schema.sql # New migration ⭐
│
├── ipodhan-data-pipeline/              # Main application ⭐
│   ├── scrapers/                       # 5 web scrapers
│   ├── validators/                     # Data validation
│   ├── repositories/                   # Database layer
│   ├── orchestrator/                   # Pipeline orchestration
│   ├── monitoring/                     # Health checks & metrics
│   ├── schemas/                        # Pydantic schemas
│   ├── scripts/                        # Utility scripts
│   ├── tests/                          # Unit tests
│   ├── main.py                         # CLI entry point
│   ├── requirements.txt                # Python dependencies
│   └── .env.example                    # Environment template
│
├── SERVER_DEPLOYMENT.md                # Server deployment guide ⭐
├── QUICK_START_SERVER.md               # Quick reference ⭐
├── deploy_server.sh                    # Deployment script ⭐
├── ipodhan-pipeline.service            # Systemd service file ⭐
├── IMPLEMENTATION_SUMMARY.md           # Implementation details
├── SETUP_COMPLETION.md                 # Setup status
└── README.md                           # Project documentation
```

---

## 🚀 Deployment Methods

### Method 1: Automated Deployment (Recommended)

**For Claude Code on the server:**

```bash
# After files are uploaded to /opt/ipodhan
cd /opt/ipodhan
chmod +x deploy_server.sh
./deploy_server.sh
```

The script will:
1. ✅ Check prerequisites (Python, PostgreSQL, pip)
2. ✅ Create virtual environment
3. ✅ Install Python dependencies
4. ✅ Install Playwright browsers
5. ✅ Configure environment (.env)
6. ✅ Run database migrations
7. ✅ Test the pipeline
8. ✅ Optionally set up systemd service

**Estimated Time:** 10-15 minutes

---

### Method 2: Manual Deployment

**Follow:** `SERVER_DEPLOYMENT.md` - Section "Manual Steps"

**Key Steps:**
```bash
# 1. Setup
cd /opt/ipodhan/ipodhan-data-pipeline
python3 -m venv venv
source venv/bin/activate

# 2. Install
pip install -r requirements.txt
playwright install chromium

# 3. Configure
cp .env.example .env
nano .env  # Update credentials

# 4. Migrate
psql -h localhost -U postgres -d ipodhan -f ../infrastructure/database/migrations/002_enhanced_ipo_schema.sql

# 5. Test
python main.py run-full
python main.py health-check
```

---

## 📤 Transfer Files to Server

### Option A: SCP (Secure Copy)

```bash
# From local Windows machine
scp -r D:\Abhay\VibeCoding\IPODhan user@103.118.16.189:/opt/ipodhan/
```

### Option B: Rsync (Recommended - Faster, Incremental)

```bash
# From local machine (using WSL or Git Bash)
rsync -avz --progress \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  D:\Abhay\VibeCoding\IPODhan/ \
  user@103.118.16.189:/opt/ipodhan/
```

### Option C: Git Clone (If Repository Available)

```bash
# SSH to server first
ssh user@103.118.16.189

# Clone repository
cd /opt
git clone <repository-url> ipodhan
cd ipodhan
```

---

## ✅ Pre-Deployment Checklist

Before starting deployment:

### On Local Machine
- [ ] All files are in `D:\Abhay\VibeCoding\IPODhan\`
- [ ] Migration file `002_enhanced_ipo_schema.sql` exists
- [ ] Python code is complete and tested locally
- [ ] Documentation files are up-to-date

### On Production Server (103.118.16.189)
- [ ] SSH access is available
- [ ] Python 3.11+ is installed
- [ ] PostgreSQL 16 is installed and running
- [ ] Database `ipodhan` exists
- [ ] User `postgres` has proper permissions
- [ ] Directory `/opt/ipodhan` is created (or will be created)
- [ ] Internet access is available (for pip packages)

---

## 🎯 Deployment Steps for Claude Code

### Step 1: Verify File Transfer

```bash
ssh user@103.118.16.189
cd /opt/ipodhan

# Check files are present
ls -la
ls -la ipodhan-data-pipeline/
ls -la infrastructure/database/migrations/
```

### Step 2: Read Deployment Guide

```bash
# Claude Code should read this first
cat SERVER_DEPLOYMENT.md

# Or for quick reference
cat QUICK_START_SERVER.md
```

### Step 3: Run Deployment Script

```bash
# Make executable
chmod +x deploy_server.sh

# Run deployment
./deploy_server.sh

# Follow prompts
# - Update .env file when prompted
# - Enter PostgreSQL password when prompted
# - Choose service setup option (yes/no)
```

### Step 4: Verify Deployment

```bash
cd ipodhan-data-pipeline
source venv/bin/activate

# Run tests
python main.py run-full
python main.py health-check

# Check database
psql -h localhost -U postgres -d ipodhan -c "SELECT COUNT(*) FROM ipos;"
psql -h localhost -U postgres -d ipodhan -c "SELECT COUNT(*) FROM gmp_tracking;"
```

---

## 🔧 Configuration Required

### .env File (MUST UPDATE)

```bash
# Location: /opt/ipodhan/ipodhan-data-pipeline/.env

# ⚠️ REQUIRED: Update these values
DB_PASSWORD=<your_secure_password>      # CHANGE THIS!
SENTRY_DSN=<your_sentry_dsn>           # Optional but recommended

# Review and adjust if needed
DB_HOST=localhost                       # or 103.118.16.189 if remote
DB_POOL_MAX=20                         # Production: higher pool size
LOG_LEVEL=INFO                         # Production: INFO or WARNING
```

---

## 🐧 Running as System Service

### Automatic (via deploy_server.sh)

The deployment script asks if you want to set up the service. Choose 'yes' to:
- Create systemd service file
- Enable service (auto-start on boot)
- Start service immediately

### Manual Service Setup

```bash
# Copy service file
sudo cp /opt/ipodhan/ipodhan-pipeline.service /etc/systemd/system/

# Update user in service file if needed
sudo nano /etc/systemd/system/ipodhan-pipeline.service
# Change User=www-data to your user

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable ipodhan-pipeline
sudo systemctl start ipodhan-pipeline

# Check status
sudo systemctl status ipodhan-pipeline

# View logs
sudo journalctl -u ipodhan-pipeline -f
```

---

## 📊 Post-Deployment Verification

### Database Verification

```bash
psql -h localhost -U postgres -d ipodhan << 'EOF'
-- Check all tables exist
\dt

-- Check new tables from migration 002
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('ipo_details', 'ipo_financials', 'gmp_tracking', 'pipeline_status')
ORDER BY table_name;

-- Verify materialized view
SELECT matviewname FROM pg_matviews WHERE matviewname = 'gmp_current';

-- Check data
SELECT COUNT(*) as ipo_count FROM ipos;
SELECT COUNT(*) as gmp_count FROM gmp_tracking;
SELECT COUNT(*) as details_count FROM ipo_details;
EOF
```

### Pipeline Verification

```bash
cd /opt/ipodhan/ipodhan-data-pipeline
source venv/bin/activate

# Health check
python main.py health-check

# Expected output: All sources showing GREEN status

# Weekly metrics
python main.py metrics

# Test run
python main.py run-full
```

### Service Verification (if configured)

```bash
# Check service is running
sudo systemctl is-active ipodhan-pipeline

# Check for recent errors
sudo journalctl -u ipodhan-pipeline --since "10 minutes ago" --no-pager

# Monitor live
sudo journalctl -u ipodhan-pipeline -f
```

---

## 🚨 Troubleshooting Guide

### Issue: Transfer Failed

```bash
# Check SSH access
ssh user@103.118.16.189 "echo 'Connected'"

# Check disk space on server
ssh user@103.118.16.189 "df -h"

# Create directory if needed
ssh user@103.118.16.189 "sudo mkdir -p /opt/ipodhan"
```

### Issue: Permission Denied

```bash
# Fix ownership
sudo chown -R $USER:$USER /opt/ipodhan

# Fix permissions
chmod +x /opt/ipodhan/deploy_server.sh
chmod -R 755 /opt/ipodhan
```

### Issue: Database Connection Failed

```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Test connection
psql -h localhost -U postgres -d ipodhan -c "SELECT 1;"

# Check .env file
cat /opt/ipodhan/ipodhan-data-pipeline/.env | grep DB_
```

### Issue: Python Dependencies Failed

```bash
# Ensure venv is activated
source /opt/ipodhan/ipodhan-data-pipeline/venv/bin/activate

# Update pip
pip install --upgrade pip

# Reinstall dependencies
pip install -r requirements.txt --force-reinstall
```

---

## 📚 Documentation Reference

| Document | Location | Purpose |
|----------|----------|---------|
| Server Deployment Guide | `SERVER_DEPLOYMENT.md` | Complete deployment instructions |
| Quick Start | `QUICK_START_SERVER.md` | Quick reference for Claude Code |
| Implementation Summary | `IMPLEMENTATION_SUMMARY.md` | Technical details |
| User Documentation | `ipodhan-data-pipeline/README.md` | Usage and maintenance |
| This File | `DEPLOYMENT_PACKAGE_README.md` | Package overview |

---

## ✨ Success Criteria

Deployment is successful when:

✅ All files transferred to server
✅ Python dependencies installed (30+ packages)
✅ Playwright browsers installed
✅ .env file configured with correct credentials
✅ Database migration 002 applied (4 new tables)
✅ `python main.py run-full` executes without errors
✅ `python main.py health-check` shows all GREEN
✅ Data appears in database tables
✅ Service is running (if configured)
✅ Logs show regular scraping activity

---

## 🎯 Next Steps After Deployment

1. **Monitor for 24 hours**
   - Check service status: `sudo systemctl status ipodhan-pipeline`
   - View logs: `sudo journalctl -u ipodhan-pipeline -f`
   - Run health checks: `python main.py health-check`

2. **Configure Monitoring**
   - Set up Sentry for error tracking
   - Configure log rotation
   - Set up disk space alerts

3. **Set Up Backups**
   - Database backups (daily)
   - Configuration backups (.env file)
   - Code backups (git)

4. **Performance Tuning**
   - Adjust scraping intervals if needed
   - Monitor database performance
   - Optimize queries if needed

---

## 📞 Support

If issues arise during deployment:

1. **Check Documentation:**
   - `SERVER_DEPLOYMENT.md` - Troubleshooting section
   - `ipodhan-data-pipeline/README.md` - Common issues

2. **Check Logs:**
   ```bash
   sudo journalctl -u ipodhan-pipeline --since "1 hour ago"
   ```

3. **Run Diagnostics:**
   ```bash
   cd /opt/ipodhan/ipodhan-data-pipeline
   python main.py health-check
   ```

---

## 📈 Monitoring Commands

```bash
# Health check
python main.py health-check

# Weekly metrics
python main.py metrics

# Service status
sudo systemctl status ipodhan-pipeline

# Live logs
sudo journalctl -u ipodhan-pipeline -f

# Database status
psql -h localhost -U postgres -d ipodhan -c "
  SELECT
    'ipos' as table_name, COUNT(*) as count FROM ipos
  UNION ALL
  SELECT 'gmp_tracking', COUNT(*) FROM gmp_tracking
  UNION ALL
  SELECT 'ipo_details', COUNT(*) FROM ipo_details
  UNION ALL
  SELECT 'ipo_financials', COUNT(*) FROM ipo_financials;
"
```

---

**Package Version:** 1.0
**Story:** 1.2 IPO Data Pipeline
**Date:** 2025-10-01
**Status:** ✅ Ready for Production Deployment
**Estimated Deployment Time:** 15-20 minutes
**Target Server:** 103.118.16.189

---

## 🚀 Quick Deploy for Claude Code

```bash
# Ultra-quick deployment (2 commands):
cd /opt/ipodhan
./deploy_server.sh
```

For detailed instructions, see: **SERVER_DEPLOYMENT.md**
