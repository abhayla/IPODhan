# Phase 1: VPS Environment Setup Guide

**Story:** 8.4b - Production Deployment - Production Server Execution
**Purpose:** Complete guide for setting up the Windows VPS environment
**Target Server:** 103.118.16.189 (Windows Server 2022)
**Estimated Time:** 60-90 minutes

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Node.js Installation](#nodejs-installation)
3. [PM2 Installation & Configuration](#pm2-installation--configuration)
4. [PostgreSQL Database Setup](#postgresql-database-setup)
5. [Redis Cache Setup](#redis-cache-setup)
6. [Environment Verification](#environment-verification)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Access
- [ ] RDP access to VPS at 103.118.16.189
- [ ] Administrator privileges on Windows Server
- [ ] PostgreSQL superuser credentials (postgres user)
- [ ] Internet connection for downloading packages

### Pre-Installation Checklist
- [ ] VPS has at least 10 GB free disk space
- [ ] Windows Server 2022 is up to date
- [ ] Firewall rules documented
- [ ] Previous services backed up (if any)

```powershell
# Verify disk space
Get-PSDrive C | Select-Object Used, Free, @{Name="FreeGB";Expression={[math]::Round($_.Free/1GB,2)}}

# Check Windows version
systeminfo | findstr /B /C:"OS Name" /C:"OS Version"
```

**Expected Output:**
```
Free disk space: >10 GB
OS: Windows Server 2022
```

---

## Node.js Installation

### Step 1: Download Node.js 20 LTS

1. Open PowerShell as Administrator
2. Download Node.js installer:

```powershell
# Create downloads directory
$downloadDir = "C:\Temp\NodeJS"
New-Item -ItemType Directory -Force -Path $downloadDir

# Download Node.js 20 LTS (Windows 64-bit)
$nodeUrl = "https://nodejs.org/dist/v20.10.0/node-v20.10.0-x64.msi"
$nodeInstaller = "$downloadDir\nodejs-installer.msi"

# Download using PowerShell
Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeInstaller

Write-Host "Node.js installer downloaded to: $nodeInstaller" -ForegroundColor Green
```

### Step 2: Install Node.js

```powershell
# Run installer silently
Start-Process msiexec.exe -Wait -ArgumentList "/i `"$nodeInstaller`" /quiet /norestart ADDLOCAL=ALL"

Write-Host "Node.js installation complete" -ForegroundColor Green
```

**Manual Installation Alternative:**
1. Download from https://nodejs.org/en/download/
2. Run the MSI installer
3. Accept all defaults
4. Restart PowerShell after installation

### Step 3: Verify Installation

```powershell
# Close and reopen PowerShell to refresh PATH
# Verify Node.js version
node --version

# Verify npm version
npm --version
```

**Expected Output:**
```
v20.10.0 (or later v20.x.x)
10.2.3 (or later v10.x.x)
```

### Step 4: Configure npm

```powershell
# Set npm global directory (optional, improves permissions)
npm config set prefix "$env:APPDATA\npm"

# Verify npm configuration
npm config list
```

**Verification Checklist:**
- [ ] Node.js version shows v20.x.x
- [ ] npm version shows v10.x.x or higher
- [ ] `node -e "console.log('Hello')"` outputs "Hello"
- [ ] npm global directory configured

---

## PM2 Installation & Configuration

### Step 1: Install PM2 Globally

```powershell
# Install PM2
npm install -g pm2@latest

# Verify installation
pm2 --version
```

**Expected Output:**
```
5.3.0 (or later)
```

### Step 2: Configure PM2 Startup

```powershell
# Configure PM2 to start on Windows boot
pm2 startup

# This will output a command to run
# Execute the command shown in the output
```

**Expected Output:**
```
[PM2] You have to run this command as administrator:
pm2 startup windows
```

Run the command as shown in the output.

### Step 3: Install PM2 Windows Service

```powershell
# Install PM2 as Windows service
npm install -g pm2-windows-service

# Configure service
pm2-service-install
```

**Service Configuration Prompts:**
- Service name: `PM2`
- PM2 executable: (accept default)
- Service start type: `Automatic`

### Step 4: Create Logs Directory

```powershell
# Create deployment directory
$deployDir = "C:\inetpub\ipodhan"
New-Item -ItemType Directory -Force -Path $deployDir

# Create logs directory
New-Item -ItemType Directory -Force -Path "$deployDir\logs"

Write-Host "Deployment directories created at: $deployDir" -ForegroundColor Green
```

### Step 5: Install PM2 Log Rotation

```powershell
# Install pm2-logrotate module
pm2 install pm2-logrotate

# Configure log rotation
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat "YYYY-MM-DD_HH-mm-ss"

# Verify configuration
pm2 conf pm2-logrotate
```

**Expected Configuration:**
```
max_size: 10M (rotate when log reaches 10 MB)
retain: 7 (keep 7 rotated files)
compress: true (gzip old logs)
```

**Verification Checklist:**
- [ ] PM2 version shows 5.x.x
- [ ] PM2 startup configured
- [ ] PM2 Windows service installed
- [ ] Logs directory created
- [ ] Log rotation configured

---

## PostgreSQL Database Setup

**IMPORTANT:** This is a SHARED PostgreSQL server. Multiple applications use this database server. We will create a NEW database for IPODhan.

### Step 1: Verify PostgreSQL Installation

```powershell
# Check PostgreSQL version
psql --version

# Check PostgreSQL service status
Get-Service -Name postgresql*
```

**Expected Output:**
```
psql (PostgreSQL) 16.x
Status: Running
```

### Step 2: Generate Secure Database Password

```powershell
# Generate random 32-character password
Add-Type -AssemblyName System.Web
$dbPassword = [System.Web.Security.Membership]::GeneratePassword(32, 8)

Write-Host "Generated Database Password: $dbPassword" -ForegroundColor Yellow
Write-Host "SAVE THIS PASSWORD - You'll need it for .env.production" -ForegroundColor Red

# Save to secure file
$dbPassword | Out-File -FilePath "C:\secure\ipodhan-db-password.txt" -Encoding UTF8
```

**ACTION REQUIRED:** Copy the generated password to a secure location!

### Step 3: Create IPODhan Database

```powershell
# Connect to PostgreSQL as postgres user
# You'll be prompted for the postgres password
psql -h localhost -U postgres -c "CREATE DATABASE ipodhan;"

# Verify database created
psql -h localhost -U postgres -l | Select-String "ipodhan"
```

**Expected Output:**
```
ipodhan | postgres | UTF8 | ...
```

### Step 4: Create Database User

```powershell
# Create dedicated user for IPODhan
# Replace <PASSWORD> with the generated password
$createUserSQL = @"
CREATE USER ipodhan_user WITH PASSWORD '$dbPassword';
GRANT ALL PRIVILEGES ON DATABASE ipodhan TO ipodhan_user;
"@

# Execute SQL
$createUserSQL | psql -h localhost -U postgres -d ipodhan

Write-Host "Database user 'ipodhan_user' created successfully" -ForegroundColor Green
```

### Step 5: Grant Schema Permissions

```powershell
# Connect to ipodhan database and grant schema permissions
$grantSchemaSQL = @"
GRANT ALL PRIVILEGES ON SCHEMA public TO ipodhan_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ipodhan_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ipodhan_user;
"@

# Execute SQL
$grantSchemaSQL | psql -h localhost -U postgres -d ipodhan

Write-Host "Schema permissions granted" -ForegroundColor Green
```

### Step 6: Test Database Connection

```powershell
# Test connection with new user
# You'll be prompted for ipodhan_user password
psql -h localhost -U ipodhan_user -d ipodhan -c "SELECT version();"
```

**Expected Output:**
```
PostgreSQL 16.x on x86_64-pc-windows...
```

### Step 7: Configure Connection Pooling

PostgreSQL is already configured with pooling. Verify settings:

```powershell
# Check max connections
psql -h localhost -U postgres -c "SHOW max_connections;"

# Expected: 100 or more (shared server)
```

**Note:** IPODhan app will use max 20 connections as configured in ecosystem.config.js.

### Step 8: Create Backup Script

```powershell
# Create backup directory
$backupDir = "C:\backups\ipodhan"
New-Item -ItemType Directory -Force -Path $backupDir

# Create backup script
$backupScript = @'
# IPODhan Database Backup Script
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = "C:\backups\ipodhan\ipodhan-$timestamp.sql"

# Run pg_dump
pg_dump -h localhost -U postgres -d ipodhan > $backupFile

# Verify backup created
if (Test-Path $backupFile) {
    Write-Host "Backup created successfully: $backupFile" -ForegroundColor Green
} else {
    Write-Host "Backup FAILED!" -ForegroundColor Red
}

# Cleanup old backups (keep last 30 days)
Get-ChildItem -Path "C:\backups\ipodhan" -Filter "*.sql" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item
'@

# Save backup script
$backupScript | Out-File -FilePath "$backupDir\backup-database.ps1" -Encoding UTF8

Write-Host "Backup script created at: $backupDir\backup-database.ps1" -ForegroundColor Green
```

### Step 9: Create DATABASE_URL for .env.production

```powershell
# Generate DATABASE_URL
$databaseUrl = "postgresql://ipodhan_user:$dbPassword@localhost:5432/ipodhan"

Write-Host "`nDATABASE_URL for .env.production:" -ForegroundColor Yellow
Write-Host $databaseUrl -ForegroundColor Cyan
Write-Host "`nSave this for Phase 2!" -ForegroundColor Red
```

**Verification Checklist:**
- [ ] PostgreSQL 16+ running
- [ ] Database 'ipodhan' created
- [ ] User 'ipodhan_user' created with secure password
- [ ] Database connection tested successfully
- [ ] Backup script created
- [ ] DATABASE_URL saved for later use

---

## Redis Cache Setup

### Step 1: Verify Redis Installation

```powershell
# Check Redis version
redis-cli --version

# Check Redis service status
Get-Service -Name Redis*
```

**Expected Output:**
```
redis-cli 7.2.x
Status: Running
```

### Step 2: Generate Secure Redis Password

```powershell
# Generate random 32-character password
Add-Type -AssemblyName System.Web
$redisPassword = [System.Web.Security.Membership]::GeneratePassword(32, 8)

Write-Host "Generated Redis Password: $redisPassword" -ForegroundColor Yellow
Write-Host "SAVE THIS PASSWORD - You'll need it for .env.production" -ForegroundColor Red

# Save to secure file
$redisPassword | Out-File -FilePath "C:\secure\ipodhan-redis-password.txt" -Encoding UTF8
```

**ACTION REQUIRED:** Copy the generated password to a secure location!

### Step 3: Configure Redis

```powershell
# Locate Redis configuration file
# Common locations:
# - C:\Program Files\Redis\redis.windows.conf
# - C:\Redis\redis.windows.conf

$redisConfPath = "C:\Program Files\Redis\redis.windows-service.conf"

# Backup original config
Copy-Item $redisConfPath "$redisConfPath.backup"

# Update Redis configuration
$redisConfig = Get-Content $redisConfPath

# Set password
$redisConfig = $redisConfig -replace "# requirepass.*", "requirepass $redisPassword"

# Set maxmemory to 256MB
$redisConfig = $redisConfig -replace "# maxmemory.*", "maxmemory 256mb"

# Set eviction policy to allkeys-lru
$redisConfig = $redisConfig -replace "# maxmemory-policy.*", "maxmemory-policy allkeys-lru"

# Save updated config
$redisConfig | Out-File -FilePath $redisConfPath -Encoding UTF8

Write-Host "Redis configuration updated" -ForegroundColor Green
```

### Step 4: Restart Redis Service

```powershell
# Restart Redis to apply configuration
Restart-Service -Name Redis

# Wait for service to start
Start-Sleep -Seconds 5

# Verify service is running
Get-Service -Name Redis
```

**Expected Output:**
```
Status: Running
```

### Step 5: Test Redis Connection

```powershell
# Test connection with password
redis-cli -a $redisPassword ping
```

**Expected Output:**
```
PONG
```

### Step 6: Test Redis Operations

```powershell
# Set a test key
redis-cli -a $redisPassword SET test "IPODhan Setup"

# Get the test key
redis-cli -a $redisPassword GET test

# Delete test key
redis-cli -a $redisPassword DEL test
```

**Expected Output:**
```
IPODhan Setup
```

### Step 7: Configure Windows Service

```powershell
# Set Redis service to start automatically
Set-Service -Name Redis -StartupType Automatic

# Verify service configuration
Get-Service -Name Redis | Select-Object Name, Status, StartType
```

**Expected Output:**
```
Name: Redis
Status: Running
StartType: Automatic
```

### Step 8: Create REDIS_URL for .env.production

```powershell
# Generate REDIS_URL
$redisUrl = "redis://:$redisPassword@localhost:6379"

Write-Host "`nREDIS_URL for .env.production:" -ForegroundColor Yellow
Write-Host $redisUrl -ForegroundColor Cyan
Write-Host "`nSave this for Phase 2!" -ForegroundColor Red
```

**Verification Checklist:**
- [ ] Redis 7.2+ running
- [ ] Redis password configured
- [ ] Maxmemory set to 256MB
- [ ] Eviction policy set to allkeys-lru
- [ ] Redis connection tested successfully
- [ ] Windows service set to auto-start
- [ ] REDIS_URL saved for later use

---

## Environment Verification

### Complete Verification Script

```powershell
# ================================================================
# IPODhan Phase 1 Verification Script
# ================================================================

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "IPODhan Phase 1 Environment Verification" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Check Node.js
Write-Host "1. Checking Node.js..." -ForegroundColor Yellow
$nodeVersion = node --version
if ($nodeVersion -match "v20") {
    Write-Host "   ✓ Node.js: $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "   ✗ Node.js: Expected v20.x.x, found $nodeVersion" -ForegroundColor Red
}

# Check npm
Write-Host "`n2. Checking npm..." -ForegroundColor Yellow
$npmVersion = npm --version
if ($npmVersion -ge "10.0.0") {
    Write-Host "   ✓ npm: $npmVersion" -ForegroundColor Green
} else {
    Write-Host "   ✗ npm: Expected v10+, found $npmVersion" -ForegroundColor Red
}

# Check PM2
Write-Host "`n3. Checking PM2..." -ForegroundColor Yellow
$pm2Version = pm2 --version
if ($pm2Version -ge "5.0.0") {
    Write-Host "   ✓ PM2: $pm2Version" -ForegroundColor Green
} else {
    Write-Host "   ✗ PM2: Expected v5+, found $pm2Version" -ForegroundColor Red
}

# Check PM2 log rotation
Write-Host "`n4. Checking PM2 log rotation..." -ForegroundColor Yellow
$logrotate = pm2 conf pm2-logrotate 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✓ PM2 log rotation: Installed" -ForegroundColor Green
} else {
    Write-Host "   ✗ PM2 log rotation: Not installed" -ForegroundColor Red
}

# Check PostgreSQL
Write-Host "`n5. Checking PostgreSQL..." -ForegroundColor Yellow
$pgVersion = psql --version
if ($pgVersion -match "16") {
    Write-Host "   ✓ PostgreSQL: $pgVersion" -ForegroundColor Green
} else {
    Write-Host "   ⚠ PostgreSQL: Expected v16+, found $pgVersion" -ForegroundColor Yellow
}

# Check PostgreSQL service
$pgService = Get-Service -Name postgresql* -ErrorAction SilentlyContinue
if ($pgService.Status -eq "Running") {
    Write-Host "   ✓ PostgreSQL service: Running" -ForegroundColor Green
} else {
    Write-Host "   ✗ PostgreSQL service: Not running" -ForegroundColor Red
}

# Check ipodhan database
Write-Host "`n6. Checking ipodhan database..." -ForegroundColor Yellow
$dbCheck = psql -h localhost -U postgres -l 2>$null | Select-String "ipodhan"
if ($dbCheck) {
    Write-Host "   ✓ Database 'ipodhan': Exists" -ForegroundColor Green
} else {
    Write-Host "   ✗ Database 'ipodhan': Not found" -ForegroundColor Red
}

# Check Redis
Write-Host "`n7. Checking Redis..." -ForegroundColor Yellow
$redisVersion = redis-cli --version
if ($redisVersion -match "7") {
    Write-Host "   ✓ Redis: $redisVersion" -ForegroundColor Green
} else {
    Write-Host "   ⚠ Redis: Expected v7+, found $redisVersion" -ForegroundColor Yellow
}

# Check Redis service
$redisService = Get-Service -Name Redis* -ErrorAction SilentlyContinue
if ($redisService.Status -eq "Running") {
    Write-Host "   ✓ Redis service: Running" -ForegroundColor Green
} else {
    Write-Host "   ✗ Redis service: Not running" -ForegroundColor Red
}

# Check deployment directory
Write-Host "`n8. Checking deployment directory..." -ForegroundColor Yellow
if (Test-Path "C:\inetpub\ipodhan") {
    Write-Host "   ✓ Directory: C:\inetpub\ipodhan exists" -ForegroundColor Green
} else {
    Write-Host "   ✗ Directory: C:\inetpub\ipodhan not found" -ForegroundColor Red
}

# Check logs directory
if (Test-Path "C:\inetpub\ipodhan\logs") {
    Write-Host "   ✓ Logs directory: C:\inetpub\ipodhan\logs exists" -ForegroundColor Green
} else {
    Write-Host "   ✗ Logs directory: C:\inetpub\ipodhan\logs not found" -ForegroundColor Red
}

# Check disk space
Write-Host "`n9. Checking disk space..." -ForegroundColor Yellow
$disk = Get-PSDrive C
$freeGB = [math]::Round($disk.Free / 1GB, 2)
if ($freeGB -ge 10) {
    Write-Host "   ✓ Free space: $freeGB GB" -ForegroundColor Green
} else {
    Write-Host "   ⚠ Free space: $freeGB GB (recommend >10 GB)" -ForegroundColor Yellow
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Phase 1 Verification Complete!" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Next Step: Proceed to Phase 2 - Application Deployment`n" -ForegroundColor Green
```

Save this script and run it:

```powershell
# Save and run verification script
.\verify-phase1.ps1
```

**Expected Result:** All checks should show green checkmarks (✓)

---

## Troubleshooting

### Node.js Issues

**Problem:** `node` command not found after installation

**Solution:**
```powershell
# Restart PowerShell
# If still not found, add to PATH manually
$env:Path += ";C:\Program Files\nodejs\"

# Verify
node --version
```

**Problem:** npm permissions errors

**Solution:**
```powershell
# Set npm global directory to user location
npm config set prefix "$env:APPDATA\npm"

# Add to PATH
$env:Path += ";$env:APPDATA\npm"
```

### PM2 Issues

**Problem:** PM2 service won't start on boot

**Solution:**
```powershell
# Reinstall PM2 Windows service
pm2-service-uninstall
pm2-service-install

# Verify service
Get-Service -Name PM2
```

**Problem:** PM2 commands hang or timeout

**Solution:**
```powershell
# Kill PM2 daemon
pm2 kill

# Restart PM2
pm2 resurrect
```

### PostgreSQL Issues

**Problem:** Cannot connect to PostgreSQL

**Solution:**
```powershell
# Check if service is running
Get-Service -Name postgresql*

# Start if stopped
Start-Service -Name postgresql*

# Test connection
psql -h localhost -U postgres -c "SELECT 1;"
```

**Problem:** Permission denied creating database

**Solution:**
- Ensure you're running as postgres superuser
- Check pg_hba.conf allows local connections
- Restart PostgreSQL service after config changes

### Redis Issues

**Problem:** Redis authentication fails

**Solution:**
```powershell
# Check if password is set
redis-cli CONFIG GET requirepass

# If password incorrect, update redis.conf and restart
Restart-Service -Name Redis
```

**Problem:** Redis memory errors

**Solution:**
```powershell
# Check current memory usage
redis-cli INFO memory

# Clear cache if needed
redis-cli FLUSHALL
```

---

## Phase 1 Completion Checklist

Before proceeding to Phase 2, verify:

- [ ] Node.js 20 LTS installed and verified
- [ ] npm 10+ installed and configured
- [ ] PM2 5+ installed globally
- [ ] PM2 Windows service configured
- [ ] PM2 log rotation installed and configured
- [ ] PostgreSQL 16+ running
- [ ] Database 'ipodhan' created
- [ ] Database user 'ipodhan_user' created with secure password
- [ ] DATABASE_URL saved securely
- [ ] Redis 7.2+ running
- [ ] Redis password configured
- [ ] Redis maxmemory set to 256MB
- [ ] REDIS_URL saved securely
- [ ] Deployment directory created (C:\inetpub\ipodhan)
- [ ] Logs directory created
- [ ] Verification script passed all checks
- [ ] Disk space >10 GB free

**Document your credentials:**
- Database password: _______________
- Redis password: _______________
- DATABASE_URL: _______________
- REDIS_URL: _______________

**Save these credentials in a secure password manager!**

---

**Phase 1 Complete!**

Next: [Phase 2: Application Deployment](./phase2-application-deployment.md)

---

**Document Version:** 1.0
**Last Updated:** 2025-10-08
**Story:** 8.4b - Production Deployment
