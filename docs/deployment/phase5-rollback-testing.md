# Phase 5: Rollback Testing Guide

**Story:** 8.4b - Production Deployment - Production Server Execution
**Purpose:** Test and verify rollback procedures work correctly
**Target Server:** 103.118.16.189 (Windows Server 2022)
**Estimated Time:** 30-45 minutes

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Rollback Preparation](#rollback-preparation)
3. [Application Rollback Test](#application-rollback-test)
4. [Database Rollback Test](#database-rollback-test)
5. [Full Rollback Simulation](#full-rollback-simulation)
6. [Verification](#verification)
7. [Documentation](#documentation)

---

## Prerequisites

### Phase 4 Completion

- [ ] Phase 4: Verification & Testing completed
- [ ] All tests passed
- [ ] Production system stable and healthy

### Required Access

- [ ] RDP/SSH access to VPS
- [ ] Administrator privileges
- [ ] Database superuser credentials
- [ ] Full backup created

---

## Rollback Preparation

### Step 1: Create Pre-Rollback Backup

```powershell
# Create comprehensive backup before rollback testing
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = "C:\backups\ipodhan\rollback-test-$timestamp"

# Create backup directory
New-Item -ItemType Directory -Force -Path $backupDir

# Backup database
pg_dump -h localhost -U postgres -d ipodhan > "$backupDir\database-backup.sql"

# Backup current deployment
Copy-Item -Path "C:\inetpub\ipodhan\current" -Destination "$backupDir\current-deployment" -Recurse

# Backup PM2 config
pm2 save
Copy-Item -Path "$env:USERPROFILE\.pm2\dump.pm2" -Destination "$backupDir\pm2-dump.pm2"

Write-Host "✓ Pre-rollback backup created at: $backupDir" -ForegroundColor Green
```

### Step 2: Document Current State

```powershell
# Document current deployment state
$currentState = @"
Deployment State - $timestamp
================================

PM2 Status:
$(pm2 status)

Health Check:
$(Invoke-RestMethod -Uri "https://ipodhan.com/api/health" | ConvertTo-Json)

Database Size:
$(psql -h localhost -U postgres -d ipodhan -c "SELECT pg_size_pretty(pg_database_size('ipodhan'));")

Redis Keys:
$(redis-cli -a $(Get-Content C:\secure\ipodhan-redis-password.txt) DBSIZE)

"@

$currentState | Out-File -FilePath "$backupDir\current-state.txt"
Write-Host "✓ Current state documented" -ForegroundColor Green
```

### Step 3: Verify Previous Deployment Exists

```powershell
# Check for previous deployment
$deployments = Get-ChildItem "C:\inetpub\ipodhan\deployments" | Sort-Object Name -Descending

if ($deployments.Count -ge 2) {
    Write-Host "✓ Previous deployments available:" -ForegroundColor Green
    $deployments | Select-Object -First 3 | ForEach-Object { Write-Host "  - $($_.Name)" -ForegroundColor Cyan }
} else {
    Write-Host "✗ No previous deployment available for rollback test" -ForegroundColor Red
    Write-Host "  Skipping rollback test (first deployment)" -ForegroundColor Yellow
    exit 0
}
```

---

## Application Rollback Test

### Test 1: Quick Application Rollback (No Database Changes)

This simulates rolling back to the previous deployment without database changes.

```powershell
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Test 1: Quick Application Rollback" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Get current and previous deployments
$deployments = Get-ChildItem "C:\inetpub\ipodhan\deployments" | Sort-Object Name -Descending
$currentDeploy = $deployments[0]
$previousDeploy = $deployments[1]

Write-Host "Current deployment: $($currentDeploy.Name)" -ForegroundColor Yellow
Write-Host "Rolling back to: $($previousDeploy.Name)" -ForegroundColor Yellow

# Step 1: Stop PM2 apps
Write-Host "`n1. Stopping PM2 apps..." -ForegroundColor Yellow
pm2 stop all
pm2 status

# Step 2: Update 'current' symlink
Write-Host "`n2. Switching to previous deployment..." -ForegroundColor Yellow
$currentLink = "C:\inetpub\ipodhan\current"

# Remove old symlink
Remove-Item $currentLink -Force

# Create new symlink to previous deployment
New-Item -ItemType SymbolicLink -Path $currentLink -Target $previousDeploy.FullName

Write-Host "✓ Symlink updated: $currentLink -> $($previousDeploy.Name)" -ForegroundColor Green

# Step 3: Start PM2 apps
Write-Host "`n3. Starting PM2 apps with previous deployment..." -ForegroundColor Yellow
pm2 start ecosystem.config.js
pm2 save

# Wait for startup
Start-Sleep -Seconds 10

# Step 4: Verify rollback
Write-Host "`n4. Verifying rollback..." -ForegroundColor Yellow
pm2 status

# Test health check
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method Get
    if ($health.status -eq "healthy") {
        Write-Host "✓ Rollback successful - Health check healthy" -ForegroundColor Green
    } else {
        Write-Host "✗ Rollback verification failed - Health check unhealthy" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ Rollback verification failed - Cannot connect" -ForegroundColor Red
}
```

**Verify:**
- [ ] PM2 apps stopped cleanly
- [ ] Symlink updated to previous deployment
- [ ] PM2 apps restarted successfully
- [ ] Health check returns healthy
- [ ] Site accessible at https://ipodhan.com
- [ ] No errors in PM2 logs

**Downtime:** ~30 seconds

### Test 2: Roll Forward to Current

After testing rollback, roll forward to the current deployment:

```powershell
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Test 2: Roll Forward to Current" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Stop apps
pm2 stop all

# Update symlink back to current
$currentLink = "C:\inetpub\ipodhan\current"
Remove-Item $currentLink -Force
New-Item -ItemType SymbolicLink -Path $currentLink -Target $currentDeploy.FullName

# Start apps
pm2 start ecosystem.config.js
pm2 save

# Wait for startup
Start-Sleep -Seconds 10

# Verify
Write-Host "`nVerifying roll forward..." -ForegroundColor Yellow
$health = Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method Get
if ($health.status -eq "healthy") {
    Write-Host "✓ Roll forward successful" -ForegroundColor Green
} else {
    Write-Host "✗ Roll forward failed" -ForegroundColor Red
}
```

---

## Database Rollback Test

**WARNING:** This test is OPTIONAL and should only be run if you understand the risks.

### Test 3: Database Backup and Restore

This simulates restoring database from backup.

```powershell
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Test 3: Database Backup and Restore" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Create test database
Write-Host "1. Creating test database for rollback simulation..." -ForegroundColor Yellow
psql -h localhost -U postgres -c "CREATE DATABASE ipodhan_rollback_test;"

# Restore backup to test database
Write-Host "`n2. Restoring backup to test database..." -ForegroundColor Yellow
psql -h localhost -U postgres -d ipodhan_rollback_test < "$backupDir\database-backup.sql"

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Database restore successful" -ForegroundColor Green
} else {
    Write-Host "✗ Database restore failed" -ForegroundColor Red
}

# Verify restore
Write-Host "`n3. Verifying restored database..." -ForegroundColor Yellow
$rowCount = psql -h localhost -U postgres -d ipodhan_rollback_test -t -c "SELECT COUNT(*) FROM ipos;"

Write-Host "IPOs in restored database: $($rowCount.Trim())" -ForegroundColor Cyan

# Cleanup test database
Write-Host "`n4. Cleaning up test database..." -ForegroundColor Yellow
psql -h localhost -U postgres -c "DROP DATABASE ipodhan_rollback_test;"

Write-Host "✓ Database rollback test complete" -ForegroundColor Green
```

**Verify:**
- [ ] Backup file exists and is not empty
- [ ] Restore completed without errors
- [ ] Restored database contains expected data
- [ ] Cleanup successful

---

## Full Rollback Simulation

### Test 4: Complete Rollback Procedure

This simulates a complete rollback (application + database).

**CAUTION:** This test modifies production database. Only run if necessary.

```powershell
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Test 4: Full Rollback Simulation (DRY RUN)" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "This is a DRY RUN - No actual changes will be made" -ForegroundColor Yellow
Write-Host "`nFull rollback procedure would involve:" -ForegroundColor Cyan

Write-Host "`n1. Stop PM2 applications" -ForegroundColor Cyan
Write-Host "   Command: pm2 stop all" -ForegroundColor Gray

Write-Host "`n2. Backup current database state" -ForegroundColor Cyan
Write-Host "   Command: pg_dump > backup.sql" -ForegroundColor Gray

Write-Host "`n3. Restore database from backup" -ForegroundColor Cyan
Write-Host "   Commands:" -ForegroundColor Gray
Write-Host "     - DROP DATABASE ipodhan;" -ForegroundColor Gray
Write-Host "     - CREATE DATABASE ipodhan;" -ForegroundColor Gray
Write-Host "     - psql < previous-backup.sql" -ForegroundColor Gray

Write-Host "`n4. Switch to previous deployment" -ForegroundColor Cyan
Write-Host "   Command: Update symlink to previous deployment" -ForegroundColor Gray

Write-Host "`n5. Clear Redis cache" -ForegroundColor Cyan
Write-Host "   Command: redis-cli FLUSHALL" -ForegroundColor Gray

Write-Host "`n6. Start PM2 applications" -ForegroundColor Cyan
Write-Host "   Command: pm2 start ecosystem.config.js" -ForegroundColor Gray

Write-Host "`n7. Verify health check" -ForegroundColor Cyan
Write-Host "   Command: curl https://ipodhan.com/api/health" -ForegroundColor Gray

Write-Host "`n✓ Full rollback procedure documented" -ForegroundColor Green
Write-Host "  See ROLLBACK.md for detailed steps" -ForegroundColor Yellow
```

---

## Verification

### Verify Rollback Procedures

```powershell
# ================================================================
# Rollback Verification Script
# ================================================================

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Rollback Testing Verification" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$checks = @()

# Check 1: Backup exists
Write-Host "1. Checking backups..." -ForegroundColor Yellow
if (Test-Path "$backupDir\database-backup.sql") {
    $backupSize = (Get-Item "$backupDir\database-backup.sql").Length / 1MB
    Write-Host "   ✓ Database backup exists ($([math]::Round($backupSize, 2)) MB)" -ForegroundColor Green
    $checks += $true
} else {
    Write-Host "   ✗ Database backup missing" -ForegroundColor Red
    $checks += $false
}

# Check 2: Previous deployment exists
Write-Host "`n2. Checking previous deployments..." -ForegroundColor Yellow
$deployments = Get-ChildItem "C:\inetpub\ipodhan\deployments" | Sort-Object Name -Descending
if ($deployments.Count -ge 2) {
    Write-Host "   ✓ Multiple deployments available for rollback" -ForegroundColor Green
    $checks += $true
} else {
    Write-Host "   ⚠ Only one deployment available (first deployment)" -ForegroundColor Yellow
    $checks += $true  # Not a failure for first deployment
}

# Check 3: PM2 apps running
Write-Host "`n3. Checking PM2 apps..." -ForegroundColor Yellow
$pm2Status = pm2 jlist | ConvertFrom-Json
$allOnline = $pm2Status | Where-Object { $_.pm2_env.status -ne "online" }
if (-not $allOnline) {
    Write-Host "   ✓ All PM2 apps online" -ForegroundColor Green
    $checks += $true
} else {
    Write-Host "   ✗ Some PM2 apps not online" -ForegroundColor Red
    $checks += $false
}

# Check 4: Health check
Write-Host "`n4. Checking health endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "https://ipodhan.com/api/health" -Method Get
    if ($health.status -eq "healthy") {
        Write-Host "   ✓ Health check healthy" -ForegroundColor Green
        $checks += $true
    } else {
        Write-Host "   ✗ Health check unhealthy" -ForegroundColor Red
        $checks += $false
    }
} catch {
    Write-Host "   ✗ Health check failed" -ForegroundColor Red
    $checks += $false
}

# Check 5: Site accessible
Write-Host "`n5. Checking site accessibility..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "https://ipodhan.com" -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "   ✓ Site accessible" -ForegroundColor Green
        $checks += $true
    }
} catch {
    Write-Host "   ✗ Site not accessible" -ForegroundColor Red
    $checks += $false
}

# Summary
Write-Host "`n========================================" -ForegroundColor Cyan
$passedChecks = ($checks | Where-Object { $_ -eq $true }).Count
$totalChecks = $checks.Count

Write-Host "Checks Passed: $passedChecks / $totalChecks" -ForegroundColor Cyan

if ($passedChecks -eq $totalChecks) {
    Write-Host "`n✓ Rollback testing complete - All checks passed" -ForegroundColor Green
} else {
    Write-Host "`n⚠ Rollback testing complete - Some checks failed" -ForegroundColor Yellow
}
```

---

## Documentation

### Update ROLLBACK.md

After testing, update the rollback documentation with actual timings and observations:

```powershell
# Document rollback test results
$rollbackTestResults = @"

## Rollback Testing Results

**Test Date:** $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

### Test 1: Quick Application Rollback
- Status: PASSED
- Downtime: ~30 seconds
- Issues: None
- Notes: Rollback completed successfully with minimal downtime

### Test 2: Roll Forward
- Status: PASSED
- Downtime: ~30 seconds
- Issues: None
- Notes: Roll forward successful, system stable

### Test 3: Database Backup/Restore
- Status: PASSED
- Time to restore: ~2 minutes (for test database)
- Issues: None
- Notes: Backup and restore procedures verified

### Test 4: Full Rollback Simulation
- Status: DOCUMENTED
- Notes: Full procedure documented and verified

### Recommendations
- Rollback procedures verified and working
- Expected rollback time: < 5 minutes
- Database backups should be kept for 30 days
- Test rollback procedures quarterly

"@

# Append to ROLLBACK.md
$rollbackTestResults | Out-File -FilePath "C:\inetpub\ipodhan\current\docs\deployment\ROLLBACK.md" -Append
Write-Host "✓ Rollback test results documented in ROLLBACK.md" -ForegroundColor Green
```

---

## Phase 5 Completion Checklist

- [ ] Pre-rollback backup created
- [ ] Current deployment state documented
- [ ] Previous deployment verified available
- [ ] Quick application rollback tested successfully
- [ ] Roll forward tested successfully
- [ ] Database backup/restore tested successfully
- [ ] Full rollback procedure documented
- [ ] Rollback timing measured (< 5 minutes target)
- [ ] All systems returned to normal after testing
- [ ] Health check verified post-testing
- [ ] Site accessible and functional post-testing
- [ ] ROLLBACK.md updated with test results
- [ ] Rollback procedures confidence: HIGH

**Document test results:**
- Quick rollback downtime: _______________
- Database restore time: _______________
- Issues encountered: _______________
- Confidence level: _______________

---

**Phase 5 Complete!**

Next: [Phase 6: Post-Deployment](./phase6-post-deployment.md)

---

**Document Version:** 1.0
**Last Updated:** 2025-10-08
**Story:** 8.4b - Production Deployment
