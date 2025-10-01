# 🪟 WINDOWS SERVER 2022 DEPLOYMENT GUIDE - IPODhan Data Pipeline

**Target Server:** 103.118.16.189 (Windows Server 2022)
**For Use By:** Claude Code on Production Server
**Date:** 2025-10-01
**Story:** 1.2 IPO Data Pipeline

---

## 🎯 Quick Start for Claude Code on Windows Server

This guide allows Claude Code on Windows Server 2022 to deploy and run the IPO Data Pipeline.

---

## 📋 Prerequisites Check

Before starting, verify on Windows Server:
- [ ] Python 3.11+ installed (`python --version`)
- [ ] PostgreSQL 16 installed and running
- [ ] Database `ipodhan` exists
- [ ] User `postgres` has access
- [ ] Git installed (optional)
- [ ] Administrator access (for installing Windows Service)

---

## 🚀 Deployment Steps (For Claude Code)

### Step 1: Transfer Files to Windows Server

**Target Location on Windows Server:**
```
C:\inetpub\ipodhan\                    # Recommended for IIS integration
OR
C:\Apps\ipodhan\                       # Alternative
OR
D:\ipodhan\                            # If you have D: drive
```

**Transfer Methods:**

**Option A: Remote Desktop + Copy-Paste**
1. RDP to 103.118.16.189
2. Copy entire `D:\Abhay\VibeCoding\IPODhan\` folder
3. Paste to `C:\Apps\ipodhan\`

**Option B: Using PowerShell Remoting**
```powershell
# From your local Windows machine
$session = New-PSSession -ComputerName 103.118.16.189
Copy-Item -Path "D:\Abhay\VibeCoding\IPODhan\*" -Destination "C:\Apps\ipodhan\" -ToSession $session -Recurse
```

**Option C: Using Git**
```cmd
REM On the server
cd C:\Apps
git clone <repository-url> ipodhan
```

---

### Step 2: Run Automated Deployment Script

**On Windows Server, open PowerShell as Administrator:**

```powershell
cd C:\Apps\ipodhan
.\deploy_windows.bat
```

This script will:
1. ✅ Check system prerequisites (Python, PostgreSQL)
2. ✅ Create Python virtual environment
3. ✅ Install Python dependencies
4. ✅ Install Playwright browsers
5. ✅ Configure environment variables (.env)
6. ✅ Run database migrations
7. ✅ Test the pipeline
8. ✅ Set up Windows Service with NSSM

---

### Step 3: Manual Steps (If Automated Script Fails)

#### 3.1: Install Python Dependencies

```cmd
cd C:\Apps\ipodhan\ipodhan-data-pipeline

REM Create virtual environment
python -m venv venv

REM Activate virtual environment
venv\Scripts\activate.bat

REM Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

REM Install Playwright browsers
playwright install chromium
```

#### 3.2: Configure Environment

```cmd
REM Copy environment template
copy .env.example .env

REM Edit configuration
notepad .env

REM Update these values:
REM DB_HOST=localhost
REM DB_PORT=5432
REM DB_NAME=ipodhan
REM DB_USER=postgres
REM DB_PASSWORD=<your-password>
```

#### 3.3: Run Database Migrations

```cmd
REM Navigate to migrations directory
cd C:\Apps\ipodhan\infrastructure\database\migrations

REM Run migration (you'll be prompted for password)
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -h localhost -U postgres -d ipodhan -f 002_enhanced_ipo_schema.sql

REM Verify migration
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -h localhost -U postgres -d ipodhan -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('ipo_details', 'ipo_financials', 'gmp_tracking', 'pipeline_status') ORDER BY table_name;"
```

#### 3.4: Test the Pipeline

```cmd
cd C:\Apps\ipodhan\ipodhan-data-pipeline

REM Activate virtual environment
venv\Scripts\activate.bat

REM Test IPO pipeline
python main.py run-ipo

REM Test GMP pipeline
python main.py run-gmp

REM Test full pipeline
python main.py run-full

REM Check health
python main.py health-check
```

---

## 🔧 Windows Production Configuration

### Environment Variables (.env)

```ini
# Production Settings
ENVIRONMENT=production

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ipodhan
DB_USER=postgres
DB_PASSWORD=<SECURE_PASSWORD>
DB_POOL_MIN=2
DB_POOL_MAX=20

# Sentry Error Tracking
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id

# Scraping Configuration
SCRAPE_TIMEOUT=30
SCRAPE_RETRY_COUNT=3
MARKET_HOURS_START=09:00
MARKET_HOURS_END=17:00

# Scheduling
IPO_SCRAPE_INTERVAL=15
GMP_SCRAPE_INTERVAL_MARKET=30
GMP_SCRAPE_INTERVAL_OFFHOURS=60

# Logging
LOG_LEVEL=INFO
```

---

## 🪟 Set Up as Windows Service (Using NSSM)

### What is NSSM?

**NSSM** = Non-Sucking Service Manager
- Free tool to run any program as a Windows Service
- Auto-starts on Windows boot
- Restarts automatically on failure
- Manages logs

### Install NSSM

**Option A: Download from Website**
1. Download from: https://nssm.cc/download
2. Extract to `C:\Program Files\nssm\`
3. Add to PATH or use full path

**Option B: Using Chocolatey**
```powershell
# Run as Administrator
choco install nssm
```

**Option C: Using Winget**
```powershell
winget install nssm
```

### Create Windows Service

**Open PowerShell as Administrator:**

```powershell
# Navigate to NSSM directory (if not in PATH)
cd "C:\Program Files\nssm\win64"

# Install service
.\nssm.exe install IPODhanPipeline "C:\Apps\ipodhan\ipodhan-data-pipeline\venv\Scripts\python.exe" "C:\Apps\ipodhan\ipodhan-data-pipeline\main.py schedule"

# Set working directory
.\nssm.exe set IPODhanPipeline AppDirectory "C:\Apps\ipodhan\ipodhan-data-pipeline"

# Set display name and description
.\nssm.exe set IPODhanPipeline DisplayName "IPODhan Data Pipeline"
.\nssm.exe set IPODhanPipeline Description "IPO and GMP data scraping pipeline"

# Set startup type to Automatic
.\nssm.exe set IPODhanPipeline Start SERVICE_AUTO_START

# Set restart policy (restart on failure)
.\nssm.exe set IPODhanPipeline AppRestartDelay 10000

# Configure logging
.\nssm.exe set IPODhanPipeline AppStdout "C:\Apps\ipodhan\logs\pipeline-stdout.log"
.\nssm.exe set IPODhanPipeline AppStderr "C:\Apps\ipodhan\logs\pipeline-stderr.log"

# Start the service
.\nssm.exe start IPODhanPipeline
```

### Service Management Commands

```powershell
# Check service status
Get-Service IPODhanPipeline

# Start service
Start-Service IPODhanPipeline

# Stop service
Stop-Service IPODhanPipeline

# Restart service
Restart-Service IPODhanPipeline

# View service details
.\nssm.exe status IPODhanPipeline

# Remove service (if needed)
.\nssm.exe remove IPODhanPipeline confirm
```

### Alternative: Windows Task Scheduler

If you don't want to use NSSM, use Task Scheduler:

**Create Scheduled Task:**

```powershell
# Create task to run at startup
$action = New-ScheduledTaskAction -Execute "C:\Apps\ipodhan\ipodhan-data-pipeline\venv\Scripts\python.exe" -Argument "C:\Apps\ipodhan\ipodhan-data-pipeline\main.py schedule" -WorkingDirectory "C:\Apps\ipodhan\ipodhan-data-pipeline"

$trigger = New-ScheduledTaskTrigger -AtStartup

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName "IPODhanPipeline" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "IPO Data Pipeline Service"

# Start the task
Start-ScheduledTask -TaskName "IPODhanPipeline"
```

---

## 📊 Monitoring & Maintenance

### View Logs

**If using NSSM:**
```powershell
# View stdout log
Get-Content "C:\Apps\ipodhan\logs\pipeline-stdout.log" -Tail 50 -Wait

# View stderr log
Get-Content "C:\Apps\ipodhan\logs\pipeline-stderr.log" -Tail 50 -Wait
```

**If running manually:**
```cmd
cd C:\Apps\ipodhan\ipodhan-data-pipeline
venv\Scripts\activate.bat
python main.py schedule > logs\pipeline.log 2>&1
```

### Health Check

```powershell
cd C:\Apps\ipodhan\ipodhan-data-pipeline
.\venv\Scripts\activate.bat
python main.py health-check
```

### Weekly Metrics

```powershell
python main.py metrics
```

### Windows Event Viewer

Service events are logged to Windows Event Viewer:
1. Open Event Viewer (`eventvwr.msc`)
2. Navigate to: **Windows Logs → Application**
3. Filter by Source: **IPODhanPipeline**

---

## 🔒 Windows Security Configuration

### Firewall Rules

```powershell
# Allow PostgreSQL (if remote access needed)
New-NetFirewallRule -DisplayName "PostgreSQL" -Direction Inbound -Protocol TCP -LocalPort 5432 -Action Allow

# Check if Windows Firewall is enabled
Get-NetFirewallProfile | Select-Object Name, Enabled
```

### File Permissions

```powershell
# Set appropriate permissions on application directory
icacls "C:\Apps\ipodhan" /grant "NETWORK SERVICE:(OI)(CI)F" /T

# Secure .env file (read-only for service account)
icacls "C:\Apps\ipodhan\ipodhan-data-pipeline\.env" /inheritance:r /grant:r "SYSTEM:F" /grant:r "Administrators:F"
```

### User Account

**Best Practice:** Run service as dedicated user (not SYSTEM)

```powershell
# Create dedicated service account
net user ipodhan_service <SecurePassword> /add /fullname:"IPODhan Service Account" /passwordchg:no

# Grant user rights
net localgroup Users ipodhan_service /add

# Update NSSM to use this account
nssm set IPODhanPipeline ObjectName ".\ipodhan_service" "password"
```

---

## 🚨 Troubleshooting (Windows-Specific)

### Issue: Python not found

```powershell
# Check Python installation
python --version

# If not found, check Python path
where python

# Add Python to PATH if needed
$env:Path += ";C:\Users\<user>\AppData\Local\Programs\Python\Python311"
```

### Issue: Module not found

```cmd
REM Ensure virtual environment is activated
cd C:\Apps\ipodhan\ipodhan-data-pipeline
venv\Scripts\activate.bat

REM Reinstall dependencies
pip install -r requirements.txt
```

### Issue: Database connection failed

```cmd
REM Check PostgreSQL service
sc query postgresql-x64-16

REM Start PostgreSQL if stopped
net start postgresql-x64-16

REM Test connection
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -h localhost -U postgres -d ipodhan -c "SELECT 1;"
```

### Issue: Service won't start

```powershell
# Check service status
Get-Service IPODhanPipeline | Select-Object *

# Check NSSM logs
Get-Content "C:\Apps\ipodhan\logs\pipeline-stderr.log"

# Test command manually
cd C:\Apps\ipodhan\ipodhan-data-pipeline
.\venv\Scripts\python.exe main.py schedule
```

### Issue: Permission denied

```powershell
# Run PowerShell as Administrator
# Check file ownership
Get-Acl "C:\Apps\ipodhan" | Format-List

# Fix permissions
icacls "C:\Apps\ipodhan" /grant "Everyone:(OI)(CI)F" /T
```

---

## 📁 Windows Directory Structure

```
C:\Apps\ipodhan\                        # Application root
├── infrastructure\
│   └── database\
│       └── migrations\
│           ├── 001_initial_schema.sql
│           └── 002_enhanced_ipo_schema.sql
│
├── ipodhan-data-pipeline\              # Main Python application
│   ├── venv\                          # Virtual environment
│   ├── scrapers\
│   ├── validators\
│   ├── repositories\
│   ├── orchestrator\
│   ├── monitoring\
│   ├── schemas\
│   ├── scripts\
│   ├── tests\
│   ├── main.py
│   ├── requirements.txt
│   └── .env                           # Configuration
│
├── logs\                              # Application logs
│   ├── pipeline-stdout.log
│   └── pipeline-stderr.log
│
├── WINDOWS_SERVER_DEPLOYMENT.md       # This file
├── deploy_windows.bat                 # Deployment script
└── setup_windows_service.bat          # Service setup script
```

---

## 📝 Verification Checklist

### Database Verification

```cmd
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -h localhost -U postgres -d ipodhan -c "SELECT table_name FROM information_schema.tables WHERE table_name IN ('ipo_details', 'ipo_financials', 'gmp_tracking', 'pipeline_status');"
```

Should return 4 rows.

### Pipeline Verification

```cmd
cd C:\Apps\ipodhan\ipodhan-data-pipeline
venv\Scripts\activate.bat
python main.py run-full
python main.py health-check
```

### Service Verification

```powershell
# Check if service is running
Get-Service IPODhanPipeline | Where-Object {$_.Status -eq 'Running'}

# Check logs for errors
Get-Content "C:\Apps\ipodhan\logs\pipeline-stderr.log" -Tail 20
```

---

## 🔄 Update/Redeploy

To update the pipeline on Windows:

```powershell
# Stop service
Stop-Service IPODhanPipeline

# Update code (via RDP, Git, or PowerShell copy)
cd C:\Apps\ipodhan
git pull origin main

# OR copy new files
Copy-Item -Path "\\local-machine\share\IPODhan\*" -Destination "C:\Apps\ipodhan\" -Recurse -Force

# Update dependencies
cd ipodhan-data-pipeline
.\venv\Scripts\activate.bat
pip install -r requirements.txt

# Run new migrations (if any)
cd ..\infrastructure\database\migrations
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -h localhost -U postgres -d ipodhan -f 003_new_migration.sql

# Restart service
Start-Service IPODhanPipeline

# Verify
Get-Service IPODhanPipeline
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
- ✅ Windows Service is running
- ✅ Service auto-starts on Windows reboot
- ✅ Logs show regular scraping activity

---

## 📞 Windows-Specific Support Commands

```powershell
# System information
systeminfo | findstr /C:"OS Name" /C:"OS Version"

# Check Python version
python --version

# Check PostgreSQL service
Get-Service | Where-Object {$_.Name -like "*postgres*"}

# Check disk space
Get-PSDrive C | Select-Object Used,Free

# View running Python processes
Get-Process python

# Check network connectivity
Test-NetConnection -ComputerName www.nseindia.com -Port 443
```

---

## 🤖 For Claude Code on Windows Server

**Quick Command Sequence (PowerShell):**
```powershell
cd C:\Apps\ipodhan
.\deploy_windows.bat

# Or manually:
cd ipodhan-data-pipeline
python -m venv venv
.\venv\Scripts\activate.bat
pip install -r requirements.txt
playwright install chromium
copy .env.example .env
# Edit .env
cd ..\infrastructure\database\migrations
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -h localhost -U postgres -d ipodhan -f 002_enhanced_ipo_schema.sql
cd ..\..\ipodhan-data-pipeline
python main.py run-full
python main.py health-check
```

---

**Deployment Status:** Ready for Windows Server 2022
**Estimated Time:** 15-20 minutes
**Last Updated:** 2025-10-01
**Platform:** Windows Server 2022 (103.118.16.189)
