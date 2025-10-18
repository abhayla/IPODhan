# Production Tasks for VPS - Post-Deployment

**Target Environment**: Windows Server 2022 VPS (103.118.16.189)
**Domain**: https://ipodhan.com
**Date**: October 18, 2025
**Status**: 🔄 In Progress

---

## Overview

This document tracks production tasks that need to be executed on the VPS after initial deployment. These tasks are essential for maintaining automated operations and ensuring the platform runs smoothly.

---

## Task 4: Configure Scheduled Cron Jobs for Production

**Priority**: 🔴 **HIGH**
**Status**: 🔄 **PENDING**
**Related Stories**: 11.3 (NSE Subscription Data Fix), 11.4 (Historical IPO Backfill)
**Estimated Time**: 30-45 minutes

---

### Task Description

Configure automated scraper execution using PM2 cron scheduler or Windows Task Scheduler to ensure IPO data is updated regularly without manual intervention.

---

### Prerequisites

✅ **Completed Requirements**:
1. ✅ NSE scraper tested and working (100% success rate)
2. ✅ Database schema synchronized (Migration 0013 applied)
3. ✅ Redis cache operational
4. ✅ PM2 process manager installed and configured
5. ✅ Scraper deployed to production environment

**Verification Commands**:
```powershell
# Verify scraper is deployed
cd C:\inetpub\ipodhan\current\scraper
npm list

# Verify PM2 is running
pm2 status

# Test scraper manually
cd C:\inetpub\ipodhan\current\scraper
npm start
```

---

### Implementation Options

#### Option 1: PM2 Cron (Recommended)

**Advantages**:
- Native PM2 integration
- Automatic restart on failure
- Built-in logging
- Easy monitoring via `pm2 status`
- No separate Windows Task Scheduler needed

**Configuration**:

Update `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    // ... existing web app config ...

    // NSE Scraper - Scheduled Execution
    {
      name: 'ipodhan-scraper-nse',
      script: 'scraper/src/index.ts',
      cwd: '/d/inetpub/ipodhan/current',
      interpreter: 'node',
      interpreter_args: '--loader tsx/esm',
      instances: 1,
      exec_mode: 'fork',
      cron_restart: '0 3,15 * * *', // Run at 3 AM and 3 PM daily
      autorestart: false, // Don't auto-restart (cron handles scheduling)
      max_memory_restart: '500M',
      env_production: {
        NODE_ENV: 'production',
        DATABASE_URL: process.env.DATABASE_URL,
        REDIS_URL: process.env.REDIS_URL
      },
      error_file: './logs/scraper-nse-error.log',
      out_file: './logs/scraper-nse-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_log_size: '10M',
      log_retention: 7
    },

    // BSE Scraper - Scheduled Execution
    {
      name: 'ipodhan-scraper-bse',
      script: 'scraper/src/index.ts',
      cwd: '/d/inetpub/ipodhan/current',
      interpreter: 'node',
      interpreter_args: '--loader tsx/esm',
      args: '--source bse',
      instances: 1,
      exec_mode: 'fork',
      cron_restart: '0 4,16 * * *', // Run at 4 AM and 4 PM daily (offset from NSE)
      autorestart: false,
      max_memory_restart: '500M',
      env_production: {
        NODE_ENV: 'production',
        DATABASE_URL: process.env.DATABASE_URL,
        REDIS_URL: process.env.REDIS_URL
      },
      error_file: './logs/scraper-bse-error.log',
      out_file: './logs/scraper-bse-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_log_size: '10M',
      log_retention: 7
    },

    // Moneycontrol Scraper - Scheduled Execution
    {
      name: 'ipodhan-scraper-moneycontrol',
      script: 'scraper/src/index.ts',
      cwd: '/d/inetpub/ipodhan/current',
      interpreter: 'node',
      interpreter_args: '--loader tsx/esm',
      args: '--source moneycontrol',
      instances: 1,
      exec_mode: 'fork',
      cron_restart: '0 5,17 * * *', // Run at 5 AM and 5 PM daily
      autorestart: false,
      max_memory_restart: '500M',
      env_production: {
        NODE_ENV: 'production',
        DATABASE_URL: process.env.DATABASE_URL,
        REDIS_URL: process.env.REDIS_URL
      },
      error_file: './logs/scraper-moneycontrol-error.log',
      out_file: './logs/scraper-moneycontrol-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_log_size: '10M',
      log_retention: 7
    }
  ]
};
```

**Deployment Steps**:

```powershell
# 1. Connect to VPS
ssh admin@103.118.16.189

# 2. Navigate to deployment directory
cd C:\inetpub\ipodhan\current

# 3. Backup current PM2 config
Copy-Item ecosystem.config.js ecosystem.config.js.backup

# 4. Update ecosystem.config.js with scraper cron jobs
notepad ecosystem.config.js
# (Paste the updated configuration above)

# 5. Reload PM2 configuration
pm2 reload ecosystem.config.js --update-env

# 6. Save PM2 configuration
pm2 save

# 7. Verify scrapers are scheduled
pm2 status
pm2 list

# 8. Check scraper logs
pm2 logs ipodhan-scraper-nse --lines 50
```

---

#### Option 2: Windows Task Scheduler

**Advantages**:
- Native Windows integration
- More reliable on Windows Server
- Better OS-level scheduling
- Separate from PM2

**Configuration**:

Create PowerShell script: `C:\inetpub\ipodhan\scripts\run-scrapers.ps1`

```powershell
# run-scrapers.ps1
# Automated scraper execution script

$ErrorActionPreference = "Stop"
$scriptDir = "C:\inetpub\ipodhan\current"
$logDir = "C:\inetpub\ipodhan\logs\scrapers"

# Ensure log directory exists
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$logFile = "$logDir\scraper-run_$timestamp.log"

function Write-Log {
    param($Message)
    $logMessage = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
    Write-Output $logMessage
    Add-Content -Path $logFile -Value $logMessage
}

try {
    Write-Log "Starting scraper execution"

    # Run NSE scraper
    Write-Log "Running NSE scraper..."
    cd "$scriptDir\scraper"
    npm start 2>&1 | Tee-Object -Append -FilePath $logFile

    if ($LASTEXITCODE -eq 0) {
        Write-Log "NSE scraper completed successfully"
    } else {
        Write-Log "ERROR: NSE scraper failed with exit code $LASTEXITCODE"
    }

    # Run BSE scraper (offset by 1 hour)
    Write-Log "Running BSE scraper..."
    npm run start:bse 2>&1 | Tee-Object -Append -FilePath $logFile

    if ($LASTEXITCODE -eq 0) {
        Write-Log "BSE scraper completed successfully"
    } else {
        Write-Log "ERROR: BSE scraper failed with exit code $LASTEXITCODE"
    }

    # Run Moneycontrol scraper (offset by 2 hours)
    Write-Log "Running Moneycontrol scraper..."
    npm run start:moneycontrol 2>&1 | Tee-Object -Append -FilePath $logFile

    if ($LASTEXITCODE -eq 0) {
        Write-Log "Moneycontrol scraper completed successfully"
    } else {
        Write-Log "ERROR: Moneycontrol scraper failed with exit code $LASTEXITCODE"
    }

    Write-Log "All scrapers completed"

} catch {
    Write-Log "FATAL ERROR: $($_.Exception.Message)"
    exit 1
}

# Cleanup old logs (keep last 7 days)
Get-ChildItem -Path $logDir -Filter "scraper-run_*.log" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
    Remove-Item -Force

Write-Log "Log cleanup completed"
```

**Create Windows Task**:

```powershell
# Create scheduled task for daily scraper runs

$taskName = "IPODhan-Scrapers-Daily"
$scriptPath = "C:\inetpub\ipodhan\scripts\run-scrapers.ps1"

# Create action
$action = New-ScheduledTaskAction `
    -Execute "PowerShell.exe" `
    -Argument "-ExecutionPolicy Bypass -NoProfile -File `"$scriptPath`""

# Create trigger (daily at 3 AM)
$trigger = New-ScheduledTaskTrigger -Daily -At 3:00AM

# Create settings
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5)

# Create principal (run as SYSTEM)
$principal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest

# Register task
Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Daily execution of IPODhan data scrapers (NSE, BSE, Moneycontrol)"

Write-Output "Scheduled task created: $taskName"
Write-Output "Next run time: 3:00 AM daily"
```

**Verify Task**:

```powershell
# Verify scheduled task is created
Get-ScheduledTask -TaskName "IPODhan-Scrapers-Daily"

# Check next run time
Get-ScheduledTask -TaskName "IPODhan-Scrapers-Daily" | Get-ScheduledTaskInfo

# Test manual execution
Start-ScheduledTask -TaskName "IPODhan-Scrapers-Daily"

# Check execution history
Get-ScheduledTask -TaskName "IPODhan-Scrapers-Daily" | Get-ScheduledTaskInfo |
    Select-Object TaskName, LastRunTime, LastTaskResult, NextRunTime
```

---

### Recommended Schedule

| Scraper | Time (IST) | Time (UTC) | Frequency | Notes |
|---------|-----------|------------|-----------|-------|
| **NSE** | 3:00 AM | 9:30 PM (prev day) | Daily | Before market opens (9:15 AM) |
| **BSE** | 4:00 AM | 10:30 PM (prev day) | Daily | 1 hour offset from NSE |
| **Moneycontrol** | 5:00 AM | 11:30 PM (prev day) | Daily | 2 hour offset from NSE |
| **GMP (Chittorgarh)** | 6:00 AM | 12:30 AM | Daily | GMP updates overnight |

**Additional Runs (Optional)**:
- Afternoon refresh: 3:00 PM IST (during market hours)
- Evening update: 6:00 PM IST (after market close)

**Rationale**:
- Early morning runs ensure fresh data before market opens
- Offset schedules prevent database contention
- Allows time for data processing before user traffic

---

### Verification Steps

After configuring scheduled jobs:

#### 1. Immediate Verification

```powershell
# For PM2 Cron
pm2 status
pm2 logs ipodhan-scraper-nse --lines 20

# For Windows Task Scheduler
Get-ScheduledTask -TaskName "IPODhan-Scrapers-Daily"
```

#### 2. Test Manual Execution

```powershell
# For PM2 Cron
pm2 restart ipodhan-scraper-nse

# For Windows Task Scheduler
Start-ScheduledTask -TaskName "IPODhan-Scrapers-Daily"
```

#### 3. Wait for Scheduled Run

```powershell
# Check scraper_logs table for automatic runs
psql -h localhost -U postgres -d ipodhan -c "
SELECT
  source,
  status,
  ipos_processed,
  ipos_updated,
  to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') as run_time
FROM scraper_logs
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 10;
"
```

#### 4. Verify Log Files

```powershell
# For PM2 Cron
Get-Content C:\inetpub\ipodhan\current\logs\scraper-nse-out.log -Tail 50

# For Windows Task Scheduler
Get-Content C:\inetpub\ipodhan\logs\scrapers\scraper-run_*.log -Tail 50 | Sort-Object
```

---

### Monitoring & Alerts

#### Daily Health Checks

Create monitoring script: `C:\inetpub\ipodhan\scripts\check-scraper-health.ps1`

```powershell
# check-scraper-health.ps1
# Verify scrapers ran successfully in last 24 hours

$connectionString = $env:DATABASE_URL

$query = @"
SELECT
  source,
  status,
  ipos_processed,
  ipos_failed,
  error_count,
  created_at
FROM scraper_logs
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
"@

$results = psql -h localhost -U postgres -d ipodhan -t -c $query

if ($results -match "FAILED" -or $results -match "ERROR") {
    Write-Warning "⚠️ Scraper failures detected in last 24 hours!"
    Write-Output $results

    # Send alert (email, Slack, etc.)
    # TODO: Implement alerting

    exit 1
} else {
    Write-Output "✅ All scrapers healthy in last 24 hours"
    Write-Output $results
    exit 0
}
```

#### Schedule Health Check

```powershell
# Create daily health check task (runs at 10 AM)
$taskName = "IPODhan-Scraper-Health-Check"
$scriptPath = "C:\inetpub\ipodhan\scripts\check-scraper-health.ps1"

$action = New-ScheduledTaskAction `
    -Execute "PowerShell.exe" `
    -Argument "-ExecutionPolicy Bypass -NoProfile -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -Daily -At 10:00AM

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Description "Daily health check for IPODhan scrapers"
```

---

### Rollback Plan

If scheduled jobs cause issues:

#### PM2 Cron Rollback

```powershell
# 1. Stop scraper jobs
pm2 stop ipodhan-scraper-nse
pm2 stop ipodhan-scraper-bse
pm2 stop ipodhan-scraper-moneycontrol

# 2. Restore previous config
Copy-Item ecosystem.config.js.backup ecosystem.config.js

# 3. Reload PM2
pm2 reload ecosystem.config.js

# 4. Save state
pm2 save
```

#### Windows Task Scheduler Rollback

```powershell
# Remove scheduled task
Unregister-ScheduledTask -TaskName "IPODhan-Scrapers-Daily" -Confirm:$false

# Verify removal
Get-ScheduledTask | Where-Object { $_.TaskName -like "*IPODhan*" }
```

---

### Success Criteria

✅ **Task Complete When**:

1. ✅ Scrapers run automatically at scheduled times
2. ✅ `scraper_logs` table shows SUCCESS entries daily
3. ✅ IPO data in database is updated daily
4. ✅ No manual intervention required for 7 consecutive days
5. ✅ Logs show 100% success rate (or failures are handled gracefully)
6. ✅ Health check script reports no issues

---

### Next Steps After Completion

1. **Monitor for 7 days** - Ensure scrapers run reliably
2. **Story 11.4** - Implement historical IPO backfill
3. **Story 8.5** - Setup comprehensive monitoring and alerts
4. **Document in runbook** - Add to operations documentation

---

### Related Documentation

- **NSE Scraper Test Results**: `docs/01-planning/session-2025-10-18-nse-scraping-story-11.3.md`
- **Schema Management**: `docs/16-database/SCHEMA_MANAGEMENT.md`
- **NSE API Documentation**: `docs/16-database/NSE_API_UPDATE_SUMMARY.md`
- **Deployment Phase 2**: `docs/09-deployment/phase2-application-deployment.md`
- **Monitoring Guide**: `docs/09-deployment/MONITORING.md`

---

## Other Production Tasks

### Task 1: Database Backup Configuration ✅ COMPLETE
- Status: Configured in Phase 1
- Schedule: Daily at 2 AM
- Retention: 7 days
- Location: `C:\inetpub\ipodhan\backups\database`

### Task 2: Log Rotation ✅ COMPLETE
- Status: Configured in PM2
- Max Size: 10 MB per log file
- Retention: 7 days
- Location: `C:\inetpub\ipodhan\current\logs`

### Task 3: SSL Certificate Renewal 🔄 PENDING
- Status: Not yet due
- Provider: Cloudflare (auto-renew)
- Next Check: 2025-12-18
- Verification: https://www.ssllabs.com/ssltest/

### Task 5: Monitoring & Alerts Setup 🔄 PENDING
- Status: Story 8.5 (not started)
- Tools: PM2 Plus, UptimeRobot, LogTail
- Priority: HIGH
- Target: Setup within 2 weeks of deployment

---

## Task Completion Checklist

- [ ] Task 4: Configure Scheduled Cron Jobs
  - [ ] Choose implementation (PM2 Cron vs Windows Task Scheduler)
  - [ ] Update configuration files
  - [ ] Deploy to production VPS
  - [ ] Test manual execution
  - [ ] Verify scheduled execution (wait 24 hours)
  - [ ] Monitor logs for 7 days
  - [ ] Setup health check script
  - [ ] Document in operations runbook
  - [ ] Mark task as complete

---

**Last Updated**: October 18, 2025
**Next Review**: After Task 4 completion
**Owner**: Platform Administrator
