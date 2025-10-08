# Phase 2: Application Deployment Guide

**Story:** 8.4b - Production Deployment - Production Server Execution
**Purpose:** Deploy IPODhan web and scraper applications to production VPS
**Target Server:** 103.118.16.189 (Windows Server 2022)
**Estimated Time:** 45-60 minutes

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Transfer Deployment Package](#transfer-deployment-package)
3. [Extract and Setup](#extract-and-setup)
4. [Configure Environment](#configure-environment)
5. [Database Migrations](#database-migrations)
6. [Start Applications with PM2](#start-applications-with-pm2)
7. [Verification](#verification)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Phase 1 Completion Checklist

Verify Phase 1 is complete:
- [ ] Node.js 20 LTS installed
- [ ] PM2 5+ installed and configured
- [ ] PostgreSQL database 'ipodhan' created
- [ ] Redis running with password configured
- [ ] DATABASE_URL and REDIS_URL available
- [ ] Deployment directory exists (C:\inetpub\ipodhan)

### Required Files

From Story 8.4a (Dev Machine Preparation):
- [ ] Deployment package created: `ipodhan-deployment-{timestamp}.zip`
- [ ] Package verified and tested locally
- [ ] .env.production.template available

```powershell
# Verify deployment package exists on dev machine
dir .\ipodhan-deployment-*.zip
```

---

## Transfer Deployment Package

### Option 1: RDP File Transfer (Recommended for Windows)

1. **Connect via RDP** to 103.118.16.189
2. **Copy deployment package** from local machine
3. **Paste** to `C:\Temp\` on VPS

```powershell
# On VPS - Verify file transferred
dir C:\Temp\ipodhan-deployment-*.zip

# Check file size (should be 50-100 MB)
Get-Item C:\Temp\ipodhan-deployment-*.zip | Select-Object Name, @{Name="SizeMB";Expression={[math]::Round($_.Length/1MB,2)}}
```

### Option 2: SCP Transfer (if SSH configured)

```powershell
# On dev machine
scp ipodhan-deployment-*.zip administrator@103.118.16.189:C:/Temp/
```

### Option 3: FTP/SFTP Transfer

Use FileZilla or WinSCP:
1. Connect to 103.118.16.189
2. Upload package to C:\Temp\
3. Verify transfer complete

**Verification:**
```powershell
# Calculate MD5 checksum on dev machine
Get-FileHash .\ipodhan-deployment-*.zip -Algorithm MD5

# Calculate MD5 checksum on VPS
Get-FileHash C:\Temp\ipodhan-deployment-*.zip -Algorithm MD5

# Checksums should match!
```

---

## Extract and Setup

### Step 1: Create Timestamped Deployment Directory

```powershell
# Create timestamped deployment
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$deploymentDir = "C:\inetpub\ipodhan\deployments\deploy-$timestamp"

New-Item -ItemType Directory -Force -Path $deploymentDir

Write-Host "Deployment directory created: $deploymentDir" -ForegroundColor Green
```

### Step 2: Extract Deployment Package

```powershell
# Extract package
$packagePath = Get-Item "C:\Temp\ipodhan-deployment-*.zip" | Select-Object -First 1
Expand-Archive -Path $packagePath.FullName -DestinationPath $deploymentDir -Force

Write-Host "Package extracted successfully" -ForegroundColor Green
```

### Step 3: Verify Extraction

```powershell
# Verify directory structure
Write-Host "`nVerifying extracted files..." -ForegroundColor Yellow

# Check web application
if (Test-Path "$deploymentDir\web\.next") {
    Write-Host "✓ Web app build found" -ForegroundColor Green
} else {
    Write-Host "✗ Web app build MISSING" -ForegroundColor Red
}

# Check scraper
if (Test-Path "$deploymentDir\scraper\dist") {
    Write-Host "✓ Scraper build found" -ForegroundColor Green
} else {
    Write-Host "✗ Scraper build MISSING" -ForegroundColor Red
}

# Check ecosystem config
if (Test-Path "$deploymentDir\ecosystem.config.js") {
    Write-Host "✓ PM2 config found" -ForegroundColor Green
} else {
    Write-Host "✗ PM2 config MISSING" -ForegroundColor Red
}

# Check env template
if (Test-Path "$deploymentDir\.env.production.template") {
    Write-Host "✓ Environment template found" -ForegroundColor Green
} else {
    Write-Host "✗ Environment template MISSING" -ForegroundColor Red
}
```

### Step 4: Install Dependencies

```powershell
# Navigate to deployment directory
cd $deploymentDir

# Install web dependencies
Write-Host "`nInstalling web dependencies..." -ForegroundColor Yellow
cd web
npm ci --production --silent
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Web dependencies installed" -ForegroundColor Green
} else {
    Write-Host "✗ Web dependencies installation FAILED" -ForegroundColor Red
    exit 1
}
cd ..

# Install scraper dependencies
Write-Host "`nInstalling scraper dependencies..." -ForegroundColor Yellow
cd scraper
npm ci --production --silent
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Scraper dependencies installed" -ForegroundColor Green
} else {
    Write-Host "✗ Scraper dependencies installation FAILED" -ForegroundColor Red
    exit 1
}
cd ..

Write-Host "`nAll dependencies installed successfully!" -ForegroundColor Green
```

### Step 5: Create Symlink to Current

```powershell
# Create 'current' symlink pointing to this deployment
$currentLink = "C:\inetpub\ipodhan\current"

# Remove old symlink if exists
if (Test-Path $currentLink) {
    Remove-Item $currentLink -Force
}

# Create new symlink
New-Item -ItemType SymbolicLink -Path $currentLink -Target $deploymentDir

Write-Host "Symlink created: $currentLink -> $deploymentDir" -ForegroundColor Green
```

---

## Configure Environment

### Step 1: Create .env.production File

```powershell
# Navigate to deployment directory
cd C:\inetpub\ipodhan\current

# Copy template to .env.production
Copy-Item .env.production.template .env.production

Write-Host ".env.production file created" -ForegroundColor Green
Write-Host "Now editing file..." -ForegroundColor Yellow
```

### Step 2: Edit .env.production

```powershell
# Open in notepad
notepad .env.production
```

**Fill in the following values:**

```env
# ================================================================
# DATABASE CONFIGURATION
# ================================================================
DATABASE_URL=postgresql://ipodhan_user:YOUR_DB_PASSWORD@localhost:5432/ipodhan

# ================================================================
# REDIS CONFIGURATION
# ================================================================
REDIS_URL=redis://:YOUR_REDIS_PASSWORD@localhost:6379

# ================================================================
# ANALYTICS & MONITORING
# ================================================================
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX

# ================================================================
# SECURITY (Generate random secret)
# ================================================================
NEXTAUTH_SECRET=YOUR_GENERATED_SECRET
```

### Step 3: Generate NEXTAUTH_SECRET

```powershell
# Generate random secret
Add-Type -AssemblyName System.Web
$nextAuthSecret = [System.Web.Security.Membership]::GeneratePassword(32, 8)

Write-Host "`nNEXTAUTH_SECRET for .env.production:" -ForegroundColor Yellow
Write-Host $nextAuthSecret -ForegroundColor Cyan
Write-Host "`nAdd this to .env.production!" -ForegroundColor Red
```

### Step 4: Complete .env.production Configuration

**REQUIRED Variables to Update:**

1. **DATABASE_URL** - From Phase 1 setup
2. **REDIS_URL** - From Phase 1 setup
3. **NEXTAUTH_SECRET** - Generated above
4. **NEXT_PUBLIC_GA_MEASUREMENT_ID** - From Google Analytics

**VERIFY Variables:**

5. **NEXT_PUBLIC_ZERODHA_AFFILIATE_LINK** - Already set in template
6. **NEXT_PUBLIC_ANGELONE_AFFILIATE_LINK** - Already set in template
7. **NODE_ENV=production** - Already set
8. **NEXT_PUBLIC_APP_URL=https://ipodhan.com** - Already set

### Step 5: Verify .env.production

```powershell
# Check for REQUIRED_CHANGE_ME placeholders
$envContent = Get-Content .env.production
$requiredPlaceholders = $envContent | Select-String "REQUIRED_CHANGE_ME"

if ($requiredPlaceholders) {
    Write-Host "⚠ WARNING: Found REQUIRED_CHANGE_ME placeholders!" -ForegroundColor Red
    Write-Host $requiredPlaceholders -ForegroundColor Yellow
    Write-Host "Update all placeholders before continuing!" -ForegroundColor Red
    exit 1
} else {
    Write-Host "✓ No placeholders found - .env.production ready" -ForegroundColor Green
}
```

### Step 6: Set File Permissions

```powershell
# Restrict .env.production to administrators only
$acl = Get-Acl .env.production
$acl.SetAccessRuleProtection($true, $false)

# Remove all permissions
$acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) }

# Add administrator access only
$adminRule = New-Object System.Security.AccessControl.FileSystemAccessRule("BUILTIN\Administrators", "FullControl", "Allow")
$acl.AddAccessRule($adminRule)

# Apply permissions
Set-Acl .env.production $acl

Write-Host "✓ .env.production permissions restricted" -ForegroundColor Green
```

### Step 7: Copy .env.production to Web and Scraper

```powershell
# Copy to web directory
Copy-Item .env.production .\web\.env.production

# Copy to scraper directory
Copy-Item .env.production .\scraper\.env.production

Write-Host "✓ Environment files copied to web and scraper directories" -ForegroundColor Green
```

---

## Database Migrations

### Step 1: Backup Database Before Migration

```powershell
# Create backup
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = "C:\backups\ipodhan\ipodhan-pre-migration-$timestamp.sql"

Write-Host "Creating database backup..." -ForegroundColor Yellow
pg_dump -h localhost -U postgres -d ipodhan > $backupFile

if (Test-Path $backupFile) {
    Write-Host "✓ Backup created: $backupFile" -ForegroundColor Green
} else {
    Write-Host "✗ Backup FAILED - STOP deployment!" -ForegroundColor Red
    exit 1
}
```

### Step 2: Run Drizzle Migrations

```powershell
# Navigate to web directory
cd C:\inetpub\ipodhan\current\web

# Run migrations
Write-Host "`nRunning database migrations..." -ForegroundColor Yellow
npm run db:migrate

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Migrations completed successfully" -ForegroundColor Green
} else {
    Write-Host "✗ Migrations FAILED!" -ForegroundColor Red
    Write-Host "Check logs and consider restoring from backup" -ForegroundColor Red
    exit 1
}
```

### Step 3: Verify Database Schema

```powershell
# Check tables created
Write-Host "`nVerifying database schema..." -ForegroundColor Yellow
psql -h localhost -U ipodhan_user -d ipodhan -c "\dt"

# Expected tables:
# - ipos
# - subscriptions
# - gmp_records
# - sectors
# - registrars
# - market_holidays
# - drizzle migrations table
```

### Step 4: (Optional) Seed Initial Data

```powershell
# If you need to seed initial data
Write-Host "`nSeeding initial data..." -ForegroundColor Yellow
npm run db:seed

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Data seeded successfully" -ForegroundColor Green
} else {
    Write-Host "⚠ Seeding failed or not configured" -ForegroundColor Yellow
}
```

### Step 5: Verify Database Data

```powershell
# Check row counts
Write-Host "`nVerifying database data..." -ForegroundColor Yellow

psql -h localhost -U ipodhan_user -d ipodhan -c "SELECT 'ipos' as table_name, COUNT(*) FROM ipos;"
psql -h localhost -U ipodhan_user -d ipodhan -c "SELECT 'sectors' as table_name, COUNT(*) FROM sectors;"
psql -h localhost -U ipodhan_user -d ipodhan -c "SELECT 'registrars' as table_name, COUNT(*) FROM registrars;"

Write-Host "Database setup complete!" -ForegroundColor Green
```

---

## Start Applications with PM2

### Step 1: Navigate to Deployment Directory

```powershell
cd C:\inetpub\ipodhan\current
```

### Step 2: Stop Existing PM2 Apps (if any)

```powershell
# Stop and delete old apps
Write-Host "Stopping existing PM2 apps..." -ForegroundColor Yellow
pm2 stop all
pm2 delete all
```

### Step 3: Start Apps with PM2

```powershell
# Start both apps using ecosystem config
Write-Host "`nStarting IPODhan applications..." -ForegroundColor Yellow
pm2 start ecosystem.config.js

# Wait for apps to initialize
Start-Sleep -Seconds 10
```

### Step 4: Check PM2 Status

```powershell
# Display PM2 status
Write-Host "`nPM2 Status:" -ForegroundColor Cyan
pm2 status
```

**Expected Output:**
```
┌─────┬──────────────────┬─────────┬─────────┬──────────┬───────┬─────────┐
│ id  │ name             │ mode    │ status  │ ↺        │ cpu   │ memory  │
├─────┼──────────────────┼─────────┼─────────┼──────────┼───────┼─────────┤
│ 0   │ ipodhan-web      │ cluster │ online  │ 0        │ 0%    │ 120MB   │
│ 1   │ ipodhan-web      │ cluster │ online  │ 0        │ 0%    │ 115MB   │
│ 2   │ ipodhan-scraper  │ fork    │ online  │ 0        │ 0%    │ 85MB    │
└─────┴──────────────────┴─────────┴─────────┴──────────┴───────┴─────────┘
```

**Verify:**
- [ ] ipodhan-web: 2 instances
- [ ] ipodhan-web: mode = cluster
- [ ] ipodhan-web: status = online
- [ ] ipodhan-scraper: 1 instance
- [ ] ipodhan-scraper: mode = fork
- [ ] ipodhan-scraper: status = online

### Step 5: View Application Logs

```powershell
# View web app logs
Write-Host "`nWeb App Logs (last 50 lines):" -ForegroundColor Cyan
pm2 logs ipodhan-web --lines 50 --nostream

# View scraper logs
Write-Host "`nScraper Logs (last 50 lines):" -ForegroundColor Cyan
pm2 logs ipodhan-scraper --lines 50 --nostream
```

**Check for:**
- [ ] No ERROR messages
- [ ] "Server started" or similar success messages
- [ ] Database connection successful
- [ ] Redis connection successful

### Step 6: Save PM2 Configuration

```powershell
# Save PM2 process list
pm2 save

Write-Host "`n✓ PM2 configuration saved" -ForegroundColor Green
Write-Host "Apps will auto-restart on system reboot" -ForegroundColor Green
```

### Step 7: Verify PM2 Startup

```powershell
# Verify PM2 startup configuration
pm2 startup

# This should show that startup is already configured
# If not, follow the displayed instructions
```

---

## Verification

### Step 1: Health Check Endpoint

```powershell
# Test health check endpoint
Write-Host "`nTesting health check endpoint..." -ForegroundColor Yellow
$healthResponse = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing

Write-Host "Status Code: $($healthResponse.StatusCode)" -ForegroundColor Cyan
Write-Host "Response Body:" -ForegroundColor Cyan
$healthResponse.Content | ConvertFrom-Json | ConvertTo-Json -Depth 5
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-08T12:34:56.789Z",
  "services": {
    "database": "healthy",
    "redis": "healthy"
  }
}
```

**Verify:**
- [ ] Status code: 200
- [ ] status: "healthy"
- [ ] database: "healthy"
- [ ] redis: "healthy"

### Step 2: Test Homepage

```powershell
# Test homepage loads
Write-Host "`nTesting homepage..." -ForegroundColor Yellow
$homeResponse = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing

Write-Host "Status Code: $($homeResponse.StatusCode)" -ForegroundColor Cyan
if ($homeResponse.StatusCode -eq 200) {
    Write-Host "✓ Homepage loaded successfully" -ForegroundColor Green
} else {
    Write-Host "✗ Homepage failed to load" -ForegroundColor Red
}
```

### Step 3: Test IPO API

```powershell
# Test IPO list API
Write-Host "`nTesting IPO API..." -ForegroundColor Yellow
$ipoResponse = Invoke-WebRequest -Uri "http://localhost:3000/api/ipos" -UseBasicParsing

Write-Host "Status Code: $($ipoResponse.StatusCode)" -ForegroundColor Cyan
if ($ipoResponse.StatusCode -eq 200) {
    Write-Host "✓ IPO API working" -ForegroundColor Green

    # Parse and show count
    $ipoData = $ipoResponse.Content | ConvertFrom-Json
    Write-Host "IPOs returned: $($ipoData.Count)" -ForegroundColor Cyan
} else {
    Write-Host "✗ IPO API failed" -ForegroundColor Red
}
```

### Step 4: Monitor PM2 Resources

```powershell
# Show resource usage
Write-Host "`nPM2 Resource Monitor:" -ForegroundColor Cyan
pm2 monit

# Press Ctrl+C to exit monitor
```

### Step 5: Check Log Files

```powershell
# Check if log files are being created
Write-Host "`nChecking log files..." -ForegroundColor Yellow

$logDir = "C:\inetpub\ipodhan\current\logs"
if (Test-Path $logDir) {
    Get-ChildItem $logDir | Select-Object Name, @{Name="SizeKB";Expression={[math]::Round($_.Length/1KB,2)}}, LastWriteTime
} else {
    Write-Host "⚠ Log directory not found" -ForegroundColor Yellow
}
```

### Complete Verification Script

Save this script as `verify-phase2.ps1`:

```powershell
# ================================================================
# IPODhan Phase 2 Verification Script
# ================================================================

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "IPODhan Phase 2 Deployment Verification" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$passed = 0
$failed = 0

# Test 1: PM2 Status
Write-Host "1. Checking PM2 apps..." -ForegroundColor Yellow
$pm2Status = pm2 jlist | ConvertFrom-Json
$webApp = $pm2Status | Where-Object { $_.name -eq "ipodhan-web" }
$scraperApp = $pm2Status | Where-Object { $_.name -eq "ipodhan-scraper" }

if ($webApp.Count -eq 2 -and $webApp[0].pm2_env.status -eq "online") {
    Write-Host "   ✓ Web app: 2 instances online" -ForegroundColor Green
    $passed++
} else {
    Write-Host "   ✗ Web app: Not running correctly" -ForegroundColor Red
    $failed++
}

if ($scraperApp -and $scraperApp.pm2_env.status -eq "online") {
    Write-Host "   ✓ Scraper: Online" -ForegroundColor Green
    $passed++
} else {
    Write-Host "   ✗ Scraper: Not running correctly" -ForegroundColor Red
    $failed++
}

# Test 2: Health Check
Write-Host "`n2. Checking health endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method Get
    if ($health.status -eq "healthy") {
        Write-Host "   ✓ Health check: Healthy" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   ✗ Health check: Unhealthy" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "   ✗ Health check: Failed to connect" -ForegroundColor Red
    $failed++
}

# Test 3: Homepage
Write-Host "`n3. Checking homepage..." -ForegroundColor Yellow
try {
    $home = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing
    if ($home.StatusCode -eq 200) {
        Write-Host "   ✓ Homepage: Accessible" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   ✗ Homepage: Error $($home.StatusCode)" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "   ✗ Homepage: Failed to load" -ForegroundColor Red
    $failed++
}

# Test 4: API
Write-Host "`n4. Checking API..." -ForegroundColor Yellow
try {
    $api = Invoke-RestMethod -Uri "http://localhost:3000/api/ipos" -Method Get
    Write-Host "   ✓ API: Working (returned $($api.Count) items)" -ForegroundColor Green
    $passed++
} catch {
    Write-Host "   ✗ API: Failed" -ForegroundColor Red
    $failed++
}

# Test 5: Database
Write-Host "`n5. Checking database..." -ForegroundColor Yellow
try {
    $dbTest = psql -h localhost -U ipodhan_user -d ipodhan -c "SELECT 1;" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✓ Database: Connected" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   ✗ Database: Connection failed" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "   ✗ Database: Error" -ForegroundColor Red
    $failed++
}

# Test 6: Redis
Write-Host "`n6. Checking Redis..." -ForegroundColor Yellow
try {
    $redisTest = redis-cli -a $(Get-Content C:\secure\ipodhan-redis-password.txt) ping 2>$null
    if ($redisTest -eq "PONG") {
        Write-Host "   ✓ Redis: Connected" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   ✗ Redis: Connection failed" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "   ✗ Redis: Error" -ForegroundColor Red
    $failed++
}

# Summary
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Verification Results" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Passed: $passed" -ForegroundColor Green
Write-Host "Failed: $failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })

if ($failed -eq 0) {
    Write-Host "`n✓ Phase 2 Complete! Ready for Phase 3" -ForegroundColor Green
} else {
    Write-Host "`n✗ Phase 2 has issues. Fix before proceeding." -ForegroundColor Red
}
```

Run verification:

```powershell
.\verify-phase2.ps1
```

---

## Troubleshooting

### Application Won't Start

**Problem:** PM2 shows app in "errored" status

**Solution:**
```powershell
# Check logs for errors
pm2 logs ipodhan-web --lines 100 --err

# Common issues:
# 1. Missing .env.production
# 2. Wrong DATABASE_URL
# 3. Port 3000 already in use
# 4. Missing dependencies

# Fix and restart
pm2 restart ipodhan-web
```

### Database Connection Errors

**Problem:** "Database connection failed" in logs

**Solution:**
```powershell
# Test database connection manually
psql -h localhost -U ipodhan_user -d ipodhan

# If fails, check:
# 1. DATABASE_URL in .env.production is correct
# 2. PostgreSQL service is running
# 3. User password is correct

# Update .env.production if needed
notepad C:\inetpub\ipodhan\current\web\.env.production

# Restart app
pm2 restart ipodhan-web
```

### Redis Connection Errors

**Problem:** "Redis connection failed" in logs

**Solution:**
```powershell
# Test Redis connection
redis-cli -a YOUR_PASSWORD ping

# If fails, check:
# 1. REDIS_URL in .env.production is correct
# 2. Redis service is running
# 3. Password is correct

# Restart Redis if needed
Restart-Service -Name Redis

# Restart app
pm2 restart ipodhan-web
```

### High Memory Usage

**Problem:** PM2 shows memory >500 MB

**Solution:**
```powershell
# Check memory usage
pm2 monit

# If consistently high:
# 1. Check for memory leaks in logs
# 2. Restart app
pm2 restart ipodhan-web

# If persists, may need to investigate code
```

### Port Already in Use

**Problem:** "Port 3000 is already in use"

**Solution:**
```powershell
# Find process using port 3000
netstat -ano | findstr :3000

# Kill the process (replace <PID> with actual PID)
Stop-Process -Id <PID> -Force

# Restart PM2 app
pm2 restart ipodhan-web
```

---

## Phase 2 Completion Checklist

Before proceeding to Phase 3:

- [ ] Deployment package transferred to VPS
- [ ] Package extracted successfully
- [ ] Dependencies installed (web and scraper)
- [ ] .env.production created and configured
- [ ] No REQUIRED_CHANGE_ME placeholders in .env.production
- [ ] DATABASE_URL configured correctly
- [ ] REDIS_URL configured correctly
- [ ] NEXTAUTH_SECRET generated and set
- [ ] Database backup created
- [ ] Database migrations ran successfully
- [ ] Database schema verified
- [ ] PM2 apps started successfully
- [ ] ipodhan-web: 2 instances, cluster mode, online
- [ ] ipodhan-scraper: 1 instance, fork mode, online
- [ ] PM2 configuration saved
- [ ] Health check endpoint returns 200
- [ ] Health check shows database healthy
- [ ] Health check shows Redis healthy
- [ ] Homepage loads successfully (localhost:3000)
- [ ] IPO API returns data
- [ ] No errors in PM2 logs
- [ ] Verification script passed all tests

**Document deployment details:**
- Deployment timestamp: _______________
- Deployment directory: _______________
- Web app instances: 2
- Scraper instances: 1
- Database migration status: _______________

---

**Phase 2 Complete!**

Next: [Phase 3: Cloudflare Configuration](./phase3-cloudflare-configuration.md)

---

**Document Version:** 1.0
**Last Updated:** 2025-10-08
**Story:** 8.4b - Production Deployment
