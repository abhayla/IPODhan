# Staging Deployment Guide - Story 1.3

**Service:** IPO Scoring Algorithm
**Version:** 1.0.0
**Target Environment:** Staging
**Date:** 2025-10-02

---

## 📋 Pre-Deployment Checklist

### Prerequisites Verification

- [ ] **Approvals Complete**
  - [ ] Product Owner approved
  - [ ] Tech Lead approved
  - [x] QA Lead approved (Quinn - 2025-10-02)
  - [ ] DevOps/SRE approved

- [ ] **Infrastructure Ready**
  - [ ] Staging server provisioned
  - [ ] PostgreSQL 14+ database available
  - [ ] Redis instance running
  - [ ] Network/firewall configured
  - [ ] SSL certificates installed (if needed)

- [ ] **Code Ready**
  - [x] All tests passing (48/48 - 100%)
  - [ ] Code merged to `main` branch
  - [ ] Version tagged (v1.0.0)
  - [ ] Release notes prepared

- [ ] **Documentation Ready**
  - [x] API documentation (Swagger/ReDoc)
  - [x] Environment variables documented
  - [x] Database migrations ready
  - [x] Deployment runbook (this document)

---

## 🏗️ Infrastructure Setup

### 1. Server Requirements

**Minimum Specs:**
- **OS:** Ubuntu 20.04 LTS or later
- **CPU:** 2 vCPUs
- **RAM:** 4 GB
- **Disk:** 20 GB SSD
- **Network:** 1 Gbps

**Recommended for Staging:**
- **OS:** Ubuntu 22.04 LTS
- **CPU:** 4 vCPUs
- **RAM:** 8 GB
- **Disk:** 50 GB SSD

### 2. Database Setup

**PostgreSQL Configuration:**

```bash
# Install PostgreSQL 14+
sudo apt update
sudo apt install -y postgresql-14 postgresql-contrib-14

# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql << EOF
CREATE DATABASE ipodhan_staging;
CREATE USER ipodhan_staging WITH ENCRYPTED PASSWORD '<SECURE_PASSWORD>';
GRANT ALL PRIVILEGES ON DATABASE ipodhan_staging TO ipodhan_staging;
\q
EOF
```

**Verify Connection:**
```bash
psql -h localhost -U ipodhan_staging -d ipodhan_staging -c "SELECT version();"
```

### 3. Redis Setup

**Install and Configure:**

```bash
# Install Redis
sudo apt install -y redis-server

# Configure Redis
sudo nano /etc/redis/redis.conf
# Set: maxmemory 512mb
# Set: maxmemory-policy allkeys-lru

# Start Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Verify
redis-cli ping
# Should return: PONG
```

---

## 📦 Application Deployment

### Step 1: Clone Repository

```bash
# Create application directory
sudo mkdir -p /opt/ipodhan
sudo chown $USER:$USER /opt/ipodhan
cd /opt/ipodhan

# Clone repository
git clone https://github.com/your-org/ipodhan.git .
git checkout v1.0.0  # Or specific release tag

# Navigate to scoring engine
cd ipodhan-score-engine
```

### Step 2: Python Environment Setup

```bash
# Install Python 3.11+ (if not installed)
sudo apt install -y python3.11 python3.11-venv python3-pip

# Create virtual environment
python3.11 -m venv .venv

# Activate virtual environment
source .venv/bin/activate

# Upgrade pip
pip install --upgrade pip

# Install dependencies
pip install -r requirements.txt

# Install Playwright browsers
playwright install chromium
```

### Step 3: Environment Configuration

**Create `.env` file:**

```bash
# Copy example and edit
cp .env.example .env
nano .env
```

**Required Environment Variables:**

```bash
# Database Configuration (REQUIRED)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ipodhan_staging
DB_USER=ipodhan_staging
DB_PASSWORD=<SECURE_PASSWORD>

# Redis Configuration (REQUIRED)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=  # Leave empty if no password
REDIS_DB=0

# API Configuration
API_HOST=0.0.0.0
API_PORT=8001
API_KEY=<GENERATE_SECURE_API_KEY>  # Use: openssl rand -hex 32

# Pipeline Configuration (Optional)
IPO_SCRAPE_INTERVAL=15
GMP_SCRAPE_INTERVAL_MARKET=30
GMP_SCRAPE_INTERVAL_OFFMARKET=120
MARKET_HOURS_START=09:00
MARKET_HOURS_END=17:00

# Caching (Optional)
SCORE_CACHE_TTL=3600  # 1 hour

# Environment
ENVIRONMENT=staging
LOG_LEVEL=INFO

# Monitoring (Optional)
SENTRY_DSN=<YOUR_SENTRY_DSN>
```

**Generate Secure API Key:**
```bash
openssl rand -hex 32
# Example output: a3f5b8c2d9e1f4a7b6c3d8e2f5a9b4c7d1e6f3a8b5c2d9e4f7a1b8c3d6e9f2a5
```

### Step 4: Database Migration

```bash
# Navigate to migrations directory
cd ../infrastructure/database/migrations

# Apply migrations in order
psql -h localhost -U ipodhan_staging -d ipodhan_staging -f 001_create_ipos_table.sql
psql -h localhost -U ipodhan_staging -d ipodhan_staging -f 002_create_gmp_table.sql
psql -h localhost -U ipodhan_staging -d ipodhan_staging -f 003_add_pipeline_status.sql

# Verify tables created
psql -h localhost -U ipodhan_staging -d ipodhan_staging -c "\dt"
```

**Expected Output:**
```
 Schema |       Name        | Type  |       Owner
--------+-------------------+-------+-------------------
 public | ipo_details       | table | ipodhan_staging
 public | gmp_history       | table | ipodhan_staging
 public | score_history     | table | ipodhan_staging
 public | score_performance | table | ipodhan_staging
 public | ab_experiments    | table | ipodhan_staging
 public | pipeline_status   | table | ipodhan_staging
```

**Verify Materialized View:**
```bash
psql -h localhost -U ipodhan_staging -d ipodhan_staging -c "\dm"
# Should show: current_ipo_scores
```

### Step 5: Run Tests (Pre-Deployment Validation)

```bash
# Return to scoring engine directory
cd /opt/ipodhan/ipodhan-score-engine

# Activate virtual environment (if not active)
source .venv/bin/activate

# Run integration tests
pytest tests/integration/ -v

# Expected: 48/48 tests passing
```

**If tests fail:**
- Check database connection (.env settings)
- Verify Redis is running
- Ensure migrations completed successfully
- Check logs for specific errors

---

## 🚀 Application Start

### Option 1: Manual Start (for testing)

```bash
# Activate virtual environment
source .venv/bin/activate

# Start API server
cd /opt/ipodhan/ipodhan-score-engine
uvicorn api.main:app --host 0.0.0.0 --port 8001 --reload

# In another terminal, start pipeline (optional for staging)
cd /opt/ipodhan/ipodhan-data-pipeline
python main.py schedule
```

### Option 2: Systemd Service (recommended)

**Create API service:**

```bash
sudo nano /etc/systemd/system/ipodhan-api.service
```

**Service file content:**
```ini
[Unit]
Description=IPODhan Scoring API
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=ipodhan
Group=ipodhan
WorkingDirectory=/opt/ipodhan/ipodhan-score-engine
Environment="PATH=/opt/ipodhan/ipodhan-score-engine/.venv/bin"
EnvironmentFile=/opt/ipodhan/ipodhan-score-engine/.env
ExecStart=/opt/ipodhan/ipodhan-score-engine/.venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8001
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Create pipeline service (optional):**

```bash
sudo nano /etc/systemd/system/ipodhan-pipeline.service
```

**Service file content:**
```ini
[Unit]
Description=IPODhan Data Pipeline
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=ipodhan
Group=ipodhan
WorkingDirectory=/opt/ipodhan/ipodhan-data-pipeline
Environment="PATH=/opt/ipodhan/ipodhan-data-pipeline/.venv/bin"
EnvironmentFile=/opt/ipodhan/ipodhan-data-pipeline/.env
ExecStart=/opt/ipodhan/ipodhan-data-pipeline/.venv/bin/python main.py schedule
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```

**Enable and start services:**

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable services
sudo systemctl enable ipodhan-api
sudo systemctl enable ipodhan-pipeline  # Optional

# Start services
sudo systemctl start ipodhan-api
sudo systemctl start ipodhan-pipeline  # Optional

# Check status
sudo systemctl status ipodhan-api
sudo systemctl status ipodhan-pipeline  # Optional
```

---

## ✅ Post-Deployment Validation

### Step 1: Health Check

```bash
# API health check
curl http://localhost:8001/
# Expected: {"service": "IPODhan Score Engine", "status": "running", ...}

# Check Redis connection in response
# Should show: "redis": "connected"
```

### Step 2: API Endpoint Testing

**Test GET endpoints:**

```bash
# Get API documentation
curl http://localhost:8001/api/docs
# Should return Swagger UI HTML

# Test accuracy endpoint
curl http://localhost:8001/api/scores/accuracy
# Expected: {"overall_accuracy": 0.0, "message": "Accuracy tracking not yet implemented", ...}
```

**Test with real IPO ID (if data exists):**

```bash
# Get a real IPO ID from database
IPO_ID=$(psql -h localhost -U ipodhan_staging -d ipodhan_staging -t -c "SELECT id FROM ipo_details LIMIT 1;")

# Test score endpoint (might return 404 if no scores yet - that's OK)
curl http://localhost:8001/api/scores/$IPO_ID
```

**Test protected endpoint (requires API key):**

```bash
# Get API key from .env
API_KEY=$(grep API_KEY /opt/ipodhan/ipodhan-score-engine/.env | cut -d '=' -f2)

# Test recalculate endpoint
curl -X POST http://localhost:8001/api/scores/$IPO_ID/recalculate \
  -H "X-API-Key: $API_KEY"
```

### Step 3: Database Connectivity

```bash
# Check database connections
psql -h localhost -U ipodhan_staging -d ipodhan_staging -c \
  "SELECT COUNT(*) FROM ipo_details;"

# Check materialized view
psql -h localhost -U ipodhan_staging -d ipodhan_staging -c \
  "SELECT COUNT(*) FROM current_ipo_scores;"
```

### Step 4: Redis Connectivity

```bash
# Check Redis connection
redis-cli ping
# Expected: PONG

# Check cache keys (after some API calls)
redis-cli KEYS "score:*"
```

### Step 5: Logs Review

```bash
# View API logs
sudo journalctl -u ipodhan-api -n 50 --no-pager

# View pipeline logs (if running)
sudo journalctl -u ipodhan-pipeline -n 50 --no-pager

# Check for errors
sudo journalctl -u ipodhan-api -p err --no-pager
```

---

## 📊 Monitoring Setup

### 1. Log Aggregation

**Configure log rotation:**

```bash
sudo nano /etc/logrotate.d/ipodhan
```

**Content:**
```
/var/log/ipodhan/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 ipodhan ipodhan
    sharedscripts
    postrotate
        systemctl reload ipodhan-api >/dev/null 2>&1 || true
    endscript
}
```

### 2. Basic Monitoring Script

**Create monitoring script:**

```bash
nano /opt/ipodhan/scripts/health-check.sh
```

**Script content:**
```bash
#!/bin/bash

# Health check script for IPODhan staging

API_URL="http://localhost:8001"
ALERT_EMAIL="ops@ipodhan.com"

# Check API health
HEALTH=$(curl -s "$API_URL/" | jq -r '.status')

if [ "$HEALTH" != "running" ]; then
    echo "API health check failed!" | mail -s "IPODhan Staging Alert" $ALERT_EMAIL
    exit 1
fi

# Check database
DB_CHECK=$(psql -h localhost -U ipodhan_staging -d ipodhan_staging -t -c "SELECT 1;" 2>&1)
if [ "$?" -ne 0 ]; then
    echo "Database check failed!" | mail -s "IPODhan Staging Alert" $ALERT_EMAIL
    exit 1
fi

# Check Redis
REDIS_CHECK=$(redis-cli ping)
if [ "$REDIS_CHECK" != "PONG" ]; then
    echo "Redis check failed!" | mail -s "IPODhan Staging Alert" $ALERT_EMAIL
    exit 1
fi

echo "All health checks passed at $(date)"
```

**Make executable and schedule:**
```bash
chmod +x /opt/ipodhan/scripts/health-check.sh

# Add to crontab (run every 5 minutes)
crontab -e
# Add: */5 * * * * /opt/ipodhan/scripts/health-check.sh >> /var/log/ipodhan/health-check.log 2>&1
```

### 3. Performance Monitoring

**Install monitoring tools (optional):**

```bash
# Install htop for system monitoring
sudo apt install -y htop

# Install pg_top for PostgreSQL monitoring
sudo apt install -y pg-top

# Monitor system resources
htop

# Monitor PostgreSQL
pg_top -h localhost -U ipodhan_staging -d ipodhan_staging
```

---

## 🧪 Staging Validation Checklist (24-48 hours)

### Day 1 Validation

- [ ] **API Availability**
  - [ ] Health endpoint responding (/)
  - [ ] API documentation accessible (/api/docs)
  - [ ] All endpoints returning expected status codes

- [ ] **Database Performance**
  - [ ] Connection pool not exhausted
  - [ ] Query response times <100ms
  - [ ] No connection errors in logs

- [ ] **Redis Caching**
  - [ ] Cache hit rate >80%
  - [ ] No connection failures
  - [ ] Memory usage acceptable

- [ ] **Error Monitoring**
  - [ ] Error rate <0.1%
  - [ ] No critical errors in logs
  - [ ] Exception handling working

### Day 2 Validation

- [ ] **Load Testing**
  - [ ] 10 concurrent requests handled
  - [ ] Response time P95 <200ms
  - [ ] No database deadlocks

- [ ] **Data Integrity**
  - [ ] Score calculations accurate
  - [ ] Materialized view refreshing
  - [ ] A/B test assignments deterministic

- [ ] **Operational Readiness**
  - [ ] Logs accessible and readable
  - [ ] Monitoring alerts working
  - [ ] Backup/restore tested

---

## 🔄 Rollback Procedure

### Quick Rollback (If issues found)

**Step 1: Stop services**
```bash
sudo systemctl stop ipodhan-api
sudo systemctl stop ipodhan-pipeline  # If running
```

**Step 2: Restore previous version**
```bash
cd /opt/ipodhan
git checkout <PREVIOUS_VERSION_TAG>

# Reactivate virtual environment
cd ipodhan-score-engine
source .venv/bin/activate

# Restart services
sudo systemctl start ipodhan-api
```

**Step 3: Verify rollback**
```bash
# Check health
curl http://localhost:8001/

# Verify version
curl http://localhost:8001/ | jq '.version'
```

**Step 4: Database rollback (if schema changed)**
```bash
# Restore database backup
pg_restore -h localhost -U ipodhan_staging -d ipodhan_staging /path/to/backup.dump
```

---

## 📝 Deployment Checklist Summary

### Pre-Deployment
- [ ] All approvals obtained
- [ ] Infrastructure provisioned
- [ ] Database and Redis configured
- [ ] Code tagged and ready

### Deployment
- [ ] Repository cloned
- [ ] Dependencies installed
- [ ] Environment configured (.env)
- [ ] Database migrations applied
- [ ] Tests passing (48/48)
- [ ] Services started

### Post-Deployment
- [ ] Health checks passing
- [ ] API endpoints responding
- [ ] Database connectivity confirmed
- [ ] Redis caching working
- [ ] Logs reviewed
- [ ] Monitoring configured

### Validation (24-48 hours)
- [ ] Day 1 checklist complete
- [ ] Day 2 checklist complete
- [ ] Performance metrics met
- [ ] No critical issues
- [ ] Ready for production

---

## 🆘 Troubleshooting

### Common Issues

**Issue: Database connection refused**
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Check .env settings
grep DB_ /opt/ipodhan/ipodhan-score-engine/.env

# Test connection manually
psql -h localhost -U ipodhan_staging -d ipodhan_staging
```

**Issue: Redis connection failed**
```bash
# Check Redis is running
sudo systemctl status redis-server

# Test connection
redis-cli ping

# Check Redis logs
sudo journalctl -u redis-server -n 50
```

**Issue: API not starting**
```bash
# Check logs
sudo journalctl -u ipodhan-api -n 100

# Test manually
cd /opt/ipodhan/ipodhan-score-engine
source .venv/bin/activate
uvicorn api.main:app --host 0.0.0.0 --port 8001
```

**Issue: Tests failing**
```bash
# Run tests with verbose output
pytest tests/integration/ -v -s

# Check specific test
pytest tests/integration/test_score_api.py::TestScoreAPI::test_health_check -v
```

---

## 📞 Support Contacts

**Technical Issues:**
- Tech Lead: [Name] - [Email]
- DevOps: [Name] - [Email]

**Business/Product:**
- Product Owner: [Name] - [Email]

**Emergency:**
- On-Call: [Phone]

---

**Document Version:** 1.0
**Last Updated:** 2025-10-02
**Next Review:** After staging validation complete
