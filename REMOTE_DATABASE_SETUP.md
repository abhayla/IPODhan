# 🔌 Remote Database Setup Guide

**Purpose:** Configure PostgreSQL on Windows Server 2022 to accept remote connections from your local development machine.

**Target Server:** 103.118.16.189 (Windows Server 2022)
**Local Machine:** Your current Windows machine
**Database:** PostgreSQL 16

---

## 🎯 Architecture Overview

```
Local Machine (Dev)                    Windows Server (103.118.16.189)
┌─────────────────────┐               ┌─────────────────────┐
│                     │               │                     │
│  IPODhan Pipeline   │               │  PostgreSQL 16      │
│  - Scrapers         │──────────────▶│  - Database: ipodhan│
│  - Validators       │   Port 5432   │  - Tables & Data    │
│  - Tests            │               │                     │
│                     │               │                     │
└─────────────────────┘               └─────────────────────┘
```

**Benefits:**
- ✅ Develop and test locally without server deployment
- ✅ Use production database for realistic testing
- ✅ No need to RDP into server for every test
- ✅ Faster iteration cycles

---

## 📋 On Windows Server (103.118.16.189)

### Quick Setup (Automated)

**Step 1:** RDP or use Claude Code on server to clone the repository:
```cmd
cd C:\Apps
git clone https://github.com/abhayla/IPODhan.git ipodhan
cd ipodhan
```

**Step 2:** Run the automated setup script:
```cmd
setup_remote_database.bat
```

This script will automatically:
1. ✅ Verify PostgreSQL 16 is installed and running
2. ✅ Backup existing configuration files
3. ✅ Configure `postgresql.conf` to accept remote connections
4. ✅ Configure `pg_hba.conf` for password authentication
5. ✅ Open Windows Firewall port 5432
6. ✅ Create database `ipodhan` (if not exists)
7. ✅ Run database migration (002_enhanced_ipo_schema.sql)
8. ✅ Restart PostgreSQL service

---

### Manual Setup (Alternative)

If you prefer manual configuration:

#### 1. Configure PostgreSQL for Remote Access

Edit `C:\Program Files\PostgreSQL\16\data\postgresql.conf`:
```ini
# Find this line:
#listen_addresses = 'localhost'

# Change to:
listen_addresses = '*'
```

#### 2. Configure Authentication

Edit `C:\Program Files\PostgreSQL\16\data\pg_hba.conf`:

Add these lines at the end:
```
# Remote access for IPODhan
host    ipodhan         postgres        0.0.0.0/0               scram-sha-256
host    all             postgres        0.0.0.0/0               scram-sha-256
```

#### 3. Open Windows Firewall

```powershell
# Open PowerShell as Administrator
New-NetFirewallRule -DisplayName "PostgreSQL" -Direction Inbound -Protocol TCP -LocalPort 5432 -Action Allow
```

Or using Command Prompt:
```cmd
netsh advfirewall firewall add rule name="PostgreSQL" dir=in action=allow protocol=TCP localport=5432
```

#### 4. Create Database (if not exists)

```cmd
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE ipodhan;"
```

#### 5. Run Migration

```cmd
cd C:\Apps\ipodhan\infrastructure\database\migrations
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d ipodhan -f 002_enhanced_ipo_schema.sql
```

#### 6. Restart PostgreSQL

```cmd
net stop postgresql-x64-16
net start postgresql-x64-16
```

---

## 💻 On Local Machine (Your Development Machine)

### Step 1: Test Connection

```cmd
# Using psql (if installed)
psql -h 103.118.16.189 -U postgres -d ipodhan

# Using Python
python -c "import psycopg2; conn = psycopg2.connect('host=103.118.16.189 dbname=ipodhan user=postgres password=YOUR_PASSWORD'); print('✅ Connected!'); conn.close()"
```

### Step 2: Update Local .env File

Edit `D:\Abhay\VibeCoding\IPODhan\ipodhan-data-pipeline\.env`:

```ini
# Remote Database Configuration
DB_HOST=103.118.16.189
DB_PORT=5432
DB_NAME=ipodhan
DB_USER=postgres
DB_PASSWORD=your_postgres_password_here

# Connection Pool Settings
DB_POOL_MIN=1
DB_POOL_MAX=10

# Pipeline Configuration
IPO_SCRAPE_INTERVAL=15
GMP_SCRAPE_INTERVAL_MARKET=30
GMP_SCRAPE_INTERVAL_OFFHOURS=60

# Market Hours (IST)
MARKET_HOURS_START=09:00
MARKET_HOURS_END=17:00

# Logging
LOG_LEVEL=INFO
```

### Step 3: Verify Virtual Environment

```cmd
cd D:\Abhay\VibeCoding\IPODhan\ipodhan-data-pipeline

# Activate virtual environment
venv\Scripts\activate.bat

# Verify dependencies are installed
pip list | findstr psycopg2
pip list | findstr pydantic
```

### Step 4: Test Remote Database Connection

```cmd
# Test with Python
python -c "from repositories.db_config import get_db_connection; conn = get_db_connection(); print('✅ Database connection successful'); conn.close()"

# Or run health check
python main.py health-check
```

**Expected Output:**
```
✅ Database Connection: OK
✅ Tables Verified: ipos, ipo_details, ipo_financials, gmp_tracking, pipeline_status
```

### Step 5: Run Pipeline Locally

```cmd
# Run full pipeline once
python main.py run-full

# Run only IPO scraping
python main.py run-ipo

# Run only GMP scraping
python main.py run-gmp

# Check metrics
python main.py metrics
```

### Step 6: Run Tests

```cmd
# Run all tests
pytest tests/ -v

# Run specific test modules
pytest tests/unit/test_validators.py -v
pytest tests/unit/test_normalizer.py -v

# Run with coverage
pytest tests/ --cov=. --cov-report=html
```

---

## 🔍 Verification Checklist

### On Server (103.118.16.189)

- [ ] PostgreSQL service is running
  ```cmd
  sc query postgresql-x64-16
  ```

- [ ] Port 5432 is open in firewall
  ```cmd
  netsh advfirewall firewall show rule name="PostgreSQL"
  ```

- [ ] Database `ipodhan` exists
  ```cmd
  "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -l | findstr ipodhan
  ```

- [ ] Migration completed successfully (4 new tables)
  ```cmd
  "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d ipodhan -c "\dt"
  ```

### On Local Machine

- [ ] Can connect to remote database
  ```cmd
  psql -h 103.118.16.189 -U postgres -d ipodhan -c "SELECT 1;"
  ```

- [ ] Virtual environment activated
  ```cmd
  venv\Scripts\activate.bat
  ```

- [ ] `.env` file configured with remote DB
  ```cmd
  type .env | findstr DB_HOST
  ```

- [ ] Health check passes
  ```cmd
  python main.py health-check
  ```

- [ ] Can run scrapers locally
  ```cmd
  python main.py run-ipo
  ```

---

## 🚨 Troubleshooting

### Issue: Connection Timeout

**Problem:** `psql: could not connect to server: Connection timed out`

**Solutions:**
1. Verify PostgreSQL service is running on server
2. Check Windows Firewall rule is active
3. Verify server IP address (103.118.16.189)
4. Check if server has external firewall/security group blocking port 5432

### Issue: Authentication Failed

**Problem:** `FATAL: password authentication failed for user "postgres"`

**Solutions:**
1. Verify password is correct
2. Check `pg_hba.conf` has correct authentication method (`scram-sha-256`)
3. Ensure PostgreSQL service was restarted after config changes

### Issue: Database Not Found

**Problem:** `FATAL: database "ipodhan" does not exist`

**Solution:**
```cmd
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE ipodhan;"
```

### Issue: Tables Not Found

**Problem:** `relation "ipo_details" does not exist`

**Solution:** Run migration manually on server:
```cmd
cd C:\Apps\ipodhan\infrastructure\database\migrations
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d ipodhan -f 002_enhanced_ipo_schema.sql
```

### Issue: Module Not Found (Local)

**Problem:** `ModuleNotFoundError: No module named 'psycopg2'`

**Solution:**
```cmd
cd D:\Abhay\VibeCoding\IPODhan\ipodhan-data-pipeline
venv\Scripts\activate.bat
pip install -r requirements.txt
```

---

## 🔒 Security Recommendations

### Production Security (Important!)

The current setup allows connections from any IP (`0.0.0.0/0`). For production:

#### 1. Restrict Access to Specific IPs

Edit `C:\Program Files\PostgreSQL\16\data\pg_hba.conf`:
```
# Replace 0.0.0.0/0 with your local machine IP
host    ipodhan         postgres        YOUR_LOCAL_IP/32        scram-sha-256
```

#### 2. Use Strong Password

```cmd
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "ALTER USER postgres PASSWORD 'YourStrongP@ssw0rd123!';"
```

#### 3. Create Dedicated Database User

```cmd
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d ipodhan -c "CREATE USER ipodhan_app WITH PASSWORD 'AppUserPassword123!';"
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d ipodhan -c "GRANT ALL PRIVILEGES ON DATABASE ipodhan TO ipodhan_app;"
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d ipodhan -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO ipodhan_app;"
```

Then update local `.env`:
```ini
DB_USER=ipodhan_app
DB_PASSWORD=AppUserPassword123!
```

#### 4. Enable SSL (Optional)

For encrypted connections, configure SSL in PostgreSQL and use:
```ini
DB_SSLMODE=require
```

---

## 📊 Database Schema Reference

After migration, these tables will be available:

### Existing Tables (Story 1.1)
- `ipos` - Basic IPO information

### New Tables (Story 1.2)
- `ipo_details` - Extended IPO details (ISIN, lead managers, dates)
- `ipo_financials` - Financial metrics (revenue, profit, ratios)
- `gmp_tracking` - Grey Market Premium with confidence scores
- `pipeline_status` - Scraper health and monitoring

### Materialized View
- `gmp_current` - Aggregated current GMP data from all sources

---

## 🎯 Development Workflow

```
┌─────────────────────────────────────────────────────┐
│ 1. Write/modify code on local machine               │
│    - Update scrapers, validators, repositories      │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│ 2. Test locally with remote database                │
│    python main.py run-full                          │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│ 3. Run unit tests                                   │
│    pytest tests/ -v                                 │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│ 4. Verify data in database                          │
│    psql -h 103.118.16.189 -U postgres -d ipodhan   │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│ 5. Commit changes to git                            │
│    git add . && git commit && git push              │
└─────────────────────────────────────────────────────┘
```

---

## 📞 Quick Commands Reference

### Server Commands
```cmd
# Check PostgreSQL status
sc query postgresql-x64-16

# Start/stop PostgreSQL
net start postgresql-x64-16
net stop postgresql-x64-16

# View firewall rules
netsh advfirewall firewall show rule name="PostgreSQL"

# Connect to database
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d ipodhan
```

### Local Commands
```cmd
# Test connection
psql -h 103.118.16.189 -U postgres -d ipodhan

# Activate environment
cd D:\Abhay\VibeCoding\IPODhan\ipodhan-data-pipeline
venv\Scripts\activate.bat

# Run pipeline
python main.py run-full
python main.py health-check
python main.py metrics

# Run tests
pytest tests/ -v
```

---

**Status:** Ready for Remote Database Configuration
**Last Updated:** 2025-10-01
