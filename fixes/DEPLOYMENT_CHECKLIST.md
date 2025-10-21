# IPODhan Log Rotation - Production Deployment Checklist

**Date:** 2025-10-21
**Platform:** Windows Server 2022 VPS (103.118.16.189)
**Deployment Time:** 15-20 minutes

---

## Pre-Deployment Checklist

- [ ] VPS access confirmed (RDP or SSH)
- [ ] PM2 is installed and running
- [ ] IPODhan apps are running in PM2
- [ ] Current log directory exists at `D:\Abhay\VibeCoding\IPODhan\logs`
- [ ] Administrator privileges available

---

## Deployment Steps

### Step 1: Upload Files to VPS (2 minutes)

**Files to upload:**

```
D:\Abhay\VibeCoding\IPODhan\
├── scripts/
│   ├── setup-log-rotation.ps1       # Setup automation script
│   ├── cleanup-old-logs.ps1         # Cleanup script
│   └── check-log-health.ps1         # Health monitoring
├── ecosystem.config.js              # Updated with log rotation comments
└── fixes/
    └── log-rotation-setup.md        # Complete documentation
```

**Upload command (from local to VPS):**

```powershell
# Using SCP (if available)
scp -r scripts/*.ps1 user@103.118.16.189:D:/Abhay/VibeCoding/IPODhan/scripts/
scp ecosystem.config.js user@103.118.16.189:D:/Abhay/VibeCoding/IPODhan/
scp fixes/log-rotation-setup.md user@103.118.16.189:D:/Abhay/VibeCoding/IPODhan/fixes/

# OR manually copy via RDP/FTP
```

---

### Step 2: Run Setup Script (3 minutes)

**Connect to VPS:**
```powershell
# Via RDP or PowerShell Remote
Enter-PSSession -ComputerName 103.118.16.189 -Credential (Get-Credential)
```

**Navigate and execute:**
```powershell
cd D:\Abhay\VibeCoding\IPODhan
.\scripts\setup-log-rotation.ps1
```

**Expected output:**
```
======================================================================
  IPODhan - PM2 Log Rotation Setup
======================================================================

PM2 is installed (version X.X.X)
Installing pm2-logrotate module...
pm2-logrotate installed
Configuring log rotation settings...
Max log size: 10MB
Retain: 30 files
Compression: enabled
...
Setup complete!
```

**Verify installation:**
```bash
pm2 conf pm2-logrotate
```

Expected configuration:
- max_size: 10M
- retain: 30
- compress: true
- dateFormat: YYYY-MM-DD

---

### Step 3: Set Up Scheduled Tasks (5 minutes)

**A. Weekly Log Cleanup Task:**

```powershell
# Create scheduled task - Runs every Sunday at 3 AM
$action = New-ScheduledTaskAction -Execute 'PowerShell.exe' `
  -Argument '-ExecutionPolicy Bypass -File "D:\Abhay\VibeCoding\IPODhan\scripts\cleanup-old-logs.ps1"'

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3am

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" `
  -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName "IPODhan-LogCleanup" `
  -Action $action -Trigger $trigger -Principal $principal `
  -Description "Weekly cleanup of old IPODhan log files (30+ days)"
```

**B. Daily Health Check Task:**

```powershell
# Create scheduled task - Runs every day at 9 AM
$action = New-ScheduledTaskAction -Execute 'PowerShell.exe' `
  -Argument '-ExecutionPolicy Bypass -File "D:\Abhay\VibeCoding\IPODhan\scripts\check-log-health.ps1"'

$trigger = New-ScheduledTaskTrigger -Daily -At 9am

Register-ScheduledTask -TaskName "IPODhan-LogHealthCheck" `
  -Action $action -Trigger $trigger `
  -Description "Daily health check for IPODhan log files"
```

**Verify tasks created:**
```powershell
Get-ScheduledTask | Where-Object { $_.TaskName -like "IPODhan-*" } |
  Format-Table TaskName, State, NextRunTime
```

Expected output:
```
TaskName                  State   NextRunTime
--------                  -----   -----------
IPODhan-LogCleanup       Ready   2025-10-27 03:00:00
IPODhan-LogHealthCheck   Ready   2025-10-22 09:00:00
```

---

### Step 4: Restart PM2 (2 minutes)

```bash
# Reload PM2 with updated configuration
pm2 reload ecosystem.config.js

# Verify all apps are running
pm2 status

# Check logs are being written
pm2 logs ipodhan-web --lines 10
pm2 logs ipodhan-scraper --lines 10

# Save PM2 configuration
pm2 save
```

---

### Step 5: Verify Deployment (3 minutes)

**Test 1: Check PM2 Logrotate**
```bash
pm2 ls
# Should show pm2-logrotate in module list

pm2 conf pm2-logrotate
# Should show correct configuration
```

**Test 2: Run Health Check**
```powershell
.\scripts\check-log-health.ps1
```

Expected exit code: 0 (healthy)

**Test 3: Test Cleanup (Dry Run)**
```powershell
.\scripts\cleanup-old-logs.ps1 -DryRun
```

Should show files that would be cleaned up (if any)

**Test 4: Verify Log Files**
```powershell
Get-ChildItem -Path logs -Filter *.log |
  Format-Table Name, @{Label="Size MB"; Expression={[math]::Round($_.Length/1MB,2)}}, LastWriteTime
```

All log files should be actively written to (recent LastWriteTime)

**Test 5: Verify Scheduled Tasks**
```powershell
# Manually trigger health check (for testing)
Start-ScheduledTask -TaskName "IPODhan-LogHealthCheck"

# Wait a few seconds
Start-Sleep -Seconds 5

# Check task ran successfully
Get-ScheduledTaskInfo -TaskName "IPODhan-LogHealthCheck" |
  Select-Object LastRunTime, LastTaskResult
```

LastTaskResult should be 0 (success)

---

## Post-Deployment Monitoring

### Week 1: Daily Monitoring

**Day 1-3:**
```powershell
# Check log rotation is working
.\scripts\check-log-health.ps1 -Verbose

# Verify logs are being rotated (after midnight)
Get-ChildItem -Path logs -Filter *.gz
```

**Day 7:**
```powershell
# Verify weekly cleanup ran
Get-ScheduledTaskInfo -TaskName "IPODhan-LogCleanup"

# Check total log size
$totalSize = (Get-ChildItem -Path logs -Recurse | Measure-Object -Property Length -Sum).Sum
"{0:N2} MB" -f ($totalSize / 1MB)
```

Target: < 500 MB total

---

### Week 2-4: Weekly Monitoring

**Every Monday:**
```powershell
# Quick health check
.\scripts\check-log-health.ps1

# Review task history
Get-ScheduledTask -TaskName "IPODhan-*" |
  ForEach-Object {
    $info = Get-ScheduledTaskInfo -TaskName $_.TaskName
    [PSCustomObject]@{
      Task = $_.TaskName
      LastRun = $info.LastRunTime
      NextRun = $info.NextRunTime
      Result = $info.LastTaskResult
    }
  } | Format-Table
```

---

### Month 1: Performance Review

**Metrics to track:**

1. **Total log size:**
   ```powershell
   $totalSize = (Get-ChildItem -Path logs -Recurse | Measure-Object -Property Length -Sum).Sum
   "{0:N2} MB" -f ($totalSize / 1MB)
   ```
   Target: < 500 MB

2. **Rotation effectiveness:**
   ```powershell
   # Count rotated files
   (Get-ChildItem -Path logs -Filter *.gz).Count
   ```
   Expected: 60-120 files (2-4 per day × 30 days)

3. **Disk space trends:**
   ```powershell
   Get-PSDrive D | Select-Object Used, Free, @{Label="Used%"; Expression={[math]::Round(($_.Used/($_.Used+$_.Free))*100,1)}}
   ```
   Target: < 80% used

4. **Task reliability:**
   ```powershell
   # Check both tasks ran successfully
   Get-ScheduledTask -TaskName "IPODhan-*" |
     ForEach-Object {
       $info = Get-ScheduledTaskInfo -TaskName $_.TaskName
       if ($info.LastTaskResult -ne 0) {
         Write-Warning "$($_.TaskName) failed with code $($info.LastTaskResult)"
       }
     }
   ```
   Expected: No failures

---

## Rollback Plan

If issues occur, rollback is simple:

### Step 1: Uninstall PM2 Logrotate
```bash
pm2 uninstall pm2-logrotate
pm2 save
```

### Step 2: Remove Scheduled Tasks
```powershell
Unregister-ScheduledTask -TaskName "IPODhan-LogCleanup" -Confirm:$false
Unregister-ScheduledTask -TaskName "IPODhan-LogHealthCheck" -Confirm:$false
```

### Step 3: Revert Ecosystem Config
```bash
# Restore from git
git checkout ecosystem.config.js
pm2 reload ecosystem.config.js
```

Note: This won't delete rotated logs or break anything - logs just won't rotate anymore.

---

## Troubleshooting During Deployment

### Issue: PM2 not found
```bash
# Install PM2 globally
npm install -g pm2

# Verify installation
pm2 --version
```

### Issue: PowerShell execution policy error
```powershell
# Allow script execution (run as Administrator)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine

# OR run with bypass flag
powershell -ExecutionPolicy Bypass -File .\scripts\setup-log-rotation.ps1
```

### Issue: Scheduled task creation fails
```powershell
# Check you're running as Administrator
# Open PowerShell as Administrator, then retry

# Verify Task Scheduler service is running
Get-Service -Name "Schedule" | Start-Service
```

### Issue: PM2 logrotate module fails to install
```bash
# Check npm registry connection
npm config get registry

# Try with verbose logging
pm2 install pm2-logrotate --verbose

# Alternative: Manual install
npm install -g pm2-logrotate
```

---

## Success Criteria

After deployment, verify ALL of these:

- [ ] PM2 logrotate module installed (`pm2 ls` shows it)
- [ ] Configuration set correctly (`pm2 conf pm2-logrotate`)
- [ ] Scheduled tasks created (`Get-ScheduledTask -TaskName "IPODhan-*"`)
- [ ] Health check passes (`.\scripts\check-log-health.ps1` exits with code 0)
- [ ] Log files are being written (recent timestamps)
- [ ] No errors in PM2 logs (`pm2 logs --lines 50`)
- [ ] Disk space is healthy (< 80% used)

---

## Contact Information

**For Support:**
- Review documentation: `fixes/log-rotation-setup.md`
- Check PM2 logs: `pm2 logs pm2-logrotate --lines 100`
- Run health check: `.\scripts\check-log-health.ps1 -Verbose`

**Escalation:**
- Review troubleshooting section in main documentation
- Check Windows Event Viewer for scheduled task failures
- Verify disk space: `Get-PSDrive D`

---

## Deployment Sign-Off

**Deployed by:** _________________
**Date:** _________________
**Time:** _________________

**Verification Results:**

- PM2 Logrotate: [ ] PASS / [ ] FAIL
- Scheduled Tasks: [ ] PASS / [ ] FAIL
- Health Check: [ ] PASS / [ ] FAIL
- Log Rotation: [ ] PASS / [ ] FAIL

**Notes:**
_________________________________________________________________
_________________________________________________________________
_________________________________________________________________

**Status:** [ ] DEPLOYED SUCCESSFULLY / [ ] ISSUES FOUND / [ ] ROLLED BACK

---

**End of Checklist**
