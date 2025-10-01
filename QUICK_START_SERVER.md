# 🚀 QUICK START - For Claude Code on Server 103.118.16.189

**Quick deployment guide for Claude Code AI assistant on production server**

---

## ⚡ Super Quick Start (2 Commands)

```bash
cd /opt/ipodhan
./deploy_server.sh
```

That's it! The script handles everything automatically.

---

## 📋 Prerequisites (Verify First)

```bash
# Check Python
python3 --version  # Should be 3.11+

# Check PostgreSQL
psql --version     # Should be 16+

# Check database exists
psql -h localhost -U postgres -l | grep ipodhan
```

---

## 🎯 Manual Deployment (If Script Fails)

### 1. Setup Virtual Environment
```bash
cd /opt/ipodhan/ipodhan-data-pipeline
python3 -m venv venv
source venv/bin/activate
```

### 2. Install Dependencies
```bash
pip install --upgrade pip
pip install -r requirements.txt
playwright install chromium
```

### 3. Configure Environment
```bash
cp .env.example .env
nano .env  # Update DB_PASSWORD and other settings
```

### 4. Run Database Migration
```bash
cd /opt/ipodhan/infrastructure/database/migrations
psql -h localhost -U postgres -d ipodhan -f 002_enhanced_ipo_schema.sql
```

### 5. Test Pipeline
```bash
cd /opt/ipodhan/ipodhan-data-pipeline
source venv/bin/activate
python main.py run-full
python main.py health-check
```

---

## 🔧 Common Commands

```bash
# Activate environment
cd /opt/ipodhan/ipodhan-data-pipeline
source venv/bin/activate

# Run pipeline once
python main.py run-full

# Check health
python main.py health-check

# Start scheduled pipeline (runs continuously)
python main.py schedule

# View help
python main.py help
```

---

## 🐧 Setup as Service

```bash
# Copy service file
sudo cp /opt/ipodhan/ipodhan-pipeline.service /etc/systemd/system/

# Or run the script which creates it:
./deploy_server.sh  # Choose 'yes' for service setup

# Start service
sudo systemctl start ipodhan-pipeline

# Check status
sudo systemctl status ipodhan-pipeline

# View logs
sudo journalctl -u ipodhan-pipeline -f
```

---

## ✅ Verification Checklist

```bash
# 1. Check tables exist
psql -h localhost -U postgres -d ipodhan -c "\dt" | grep -E "(ipo_details|ipo_financials|gmp_tracking|pipeline_status)"

# 2. Run test
cd /opt/ipodhan/ipodhan-data-pipeline && source venv/bin/activate
python main.py run-full

# 3. Check health
python main.py health-check

# 4. Verify data
psql -h localhost -U postgres -d ipodhan -c "SELECT COUNT(*) FROM ipos;"
```

---

## 🚨 Troubleshooting

### Database Connection Error
```bash
# Test connection
psql -h localhost -U postgres -d ipodhan -c "SELECT 1;"

# Check .env file
cat /opt/ipodhan/ipodhan-data-pipeline/.env | grep DB_
```

### Module Not Found
```bash
# Ensure venv is activated
source /opt/ipodhan/ipodhan-data-pipeline/venv/bin/activate

# Reinstall
pip install -r requirements.txt
```

### Permission Denied
```bash
# Fix ownership
sudo chown -R $USER:$USER /opt/ipodhan

# Fix permissions
chmod +x /opt/ipodhan/deploy_server.sh
```

---

## 📚 Full Documentation

For detailed information, see:
- **SERVER_DEPLOYMENT.md** - Complete deployment guide
- **README.md** - User documentation
- **IMPLEMENTATION_SUMMARY.md** - Technical details

---

## 🎯 Success Indicators

You're done when:
- ✅ `python main.py health-check` shows all GREEN
- ✅ Database has 4 new tables
- ✅ No errors in test run
- ✅ Service is running (if configured)

---

**Last Updated:** 2025-10-01
**For:** Claude Code on Production Server 103.118.16.189
