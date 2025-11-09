# Automated Data Quality Reporting - Setup Guide

**Last Updated:** 2025-11-09
**Status:** Ready for Production Deployment
**Platform:** Windows Server 2022

---

## Overview

This guide provides step-by-step instructions to set up automated weekly data quality reports with email notifications for CRITICAL issues.

**Schedule:** Every Sunday at 2:00 AM
**Report Location:** `docs/04-data-flow/data-quality-reports/YYYY-MM-DD.md`
**Email Alerts:** Sent only for CRITICAL issues (configurable)

---

## Components

### 1. PowerShell Script
**File:** `web/scripts/run-data-quality-report.ps1`
- Runs the data quality report
- Parses report for CRITICAL issues
- Sends email notifications
- Maintains execution logs

### 2. Windows Task Scheduler Configuration
**File:** `web/scripts/task-scheduler-data-quality.xml`
- Pre-configured weekly schedule (Sunday 2:00 AM)
- Can be imported directly into Task Scheduler
- Automatically runs PowerShell script

### 3. Data Quality Report Script
**File:** `web/scripts/data-quality-report.ts`
- Checks 10+ data quality rules
- Generates markdown reports
- Tracks issues by severity (CRITICAL, HIGH, MEDIUM, LOW)

---

## Setup Instructions

### Step 1: Configure Environment Variables

Create or update `.env.local` in the `web/` directory with email configuration:

```env
# Email Configuration (Optional - for notifications)
DATA_QUALITY_EMAIL_TO=admin@yourcompany.com
DATA_QUALITY_EMAIL_FROM=ipodhan@yourcompany.com
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_USE_SSL=true

# Optional: Send summary emails even when no CRITICAL issues found
SEND_CLEAN_REPORTS=false
```

**Notes:**
- For Gmail: Use an App Password, not your regular password
- For Office 365: Use smtp.office365.com port 587
- If email is not configured, reports will still be generated (email notifications disabled)

### Step 2: Test Manual Execution

**Test without email:**
```powershell
cd D:\Abhay\VibeCoding\IPODhan\web
.\scripts\run-data-quality-report.ps1
```

**Test with email:**
```powershell
cd D:\Abhay\VibeCoding\IPODhan\web
.\scripts\run-data-quality-report.ps1 -SendEmail
```

**Verify:**
1. Report generated in `docs/04-data-flow/data-quality-reports/YYYY-MM-DD.md`
2. Log file created in `logs/data-quality/report-YYYY-MM-DD.log`
3. Email received (if CRITICAL issues exist)

### Step 3: Import Windows Task Scheduler Task

#### Option A: Using Task Scheduler GUI

1. Open **Task Scheduler** (taskschd.msc)
2. Click **Action** → **Import Task...**
3. Navigate to `D:\Abhay\VibeCoding\IPODhan\web\scripts\task-scheduler-data-quality.xml`
4. Click **Open**
5. Review settings:
   - **Name:** IPODhan\Weekly Data Quality Report
   - **Trigger:** Every Sunday at 2:00 AM
   - **Action:** PowerShell script execution
6. **Important:** Update the user account if needed (default: current user)
7. Click **OK** to save

#### Option B: Using PowerShell (Administrator)

```powershell
# Run as Administrator
Register-ScheduledTask -Xml (Get-Content 'D:\Abhay\VibeCoding\IPODhan\web\scripts\task-scheduler-data-quality.xml' | Out-String) -TaskName "IPODhan Weekly Data Quality Report" -TaskPath "\IPODhan\"
```

### Step 4: Test Scheduled Task

**Run manually to verify:**
```powershell
# Run as Administrator
Start-ScheduledTask -TaskName "\IPODhan\Weekly Data Quality Report"
```

**Check task history:**
1. Open Task Scheduler
2. Navigate to **IPODhan** → **Weekly Data Quality Report**
3. Click **History** tab
4. Verify last run status = Success (0x0)

### Step 5: Verify Logs

Check execution logs:
```powershell
# View latest log
Get-Content D:\Abhay\VibeCoding\IPODhan\web\logs\data-quality\report-$(Get-Date -Format 'yyyy-MM-dd').log
```

---

## Configuration Options

### Email Notification Settings

#### Send email only for CRITICAL issues (recommended):
```powershell
.\scripts\run-data-quality-report.ps1 -SendEmail
```

#### Send summary emails even when clean:
```env
# In .env.local
SEND_CLEAN_REPORTS=true
```

### Custom Email Recipients

```powershell
.\scripts\run-data-quality-report.ps1 `
  -SendEmail `
  -EmailTo "team@yourcompany.com" `
  -EmailFrom "noreply@ipodhan.com" `
  -SmtpServer "smtp.yourserver.com"
```

### Change Schedule

Edit `task-scheduler-data-quality.xml` and re-import:

**Daily at 3:00 AM:**
```xml
<CalendarTrigger>
  <StartBoundary>2025-11-10T03:00:00</StartBoundary>
  <Enabled>true</Enabled>
  <ScheduleByDay>
    <DaysInterval>1</DaysInterval>
  </ScheduleByDay>
</CalendarTrigger>
```

**Every Monday and Friday at 9:00 AM:**
```xml
<CalendarTrigger>
  <StartBoundary>2025-11-10T09:00:00</StartBoundary>
  <Enabled>true</Enabled>
  <ScheduleByWeek>
    <DaysOfWeek>
      <Monday />
      <Friday />
    </DaysOfWeek>
    <WeeksInterval>1</WeeksInterval>
  </ScheduleByWeek>
</CalendarTrigger>
```

---

## Monitoring & Maintenance

### View Recent Reports

```powershell
# List all reports (newest first)
Get-ChildItem D:\Abhay\VibeCoding\IPODhan\web\docs\04-data-flow\data-quality-reports\ -Filter "*.md" | Sort-Object LastWriteTime -Descending | Select-Object -First 10
```

### View Execution Logs

```powershell
# View today's log
Get-Content D:\Abhay\VibeCoding\IPODhan\web\logs\data-quality\report-$(Get-Date -Format 'yyyy-MM-dd').log

# View all logs from last 7 days
Get-ChildItem D:\Abhay\VibeCoding\IPODhan\web\logs\data-quality\ | Where-Object LastWriteTime -gt (Get-Date).AddDays(-7)
```

### Log Rotation

Logs are stored daily. Implement cleanup:

```powershell
# Delete logs older than 30 days
Get-ChildItem D:\Abhay\VibeCoding\IPODhan\web\logs\data-quality\ -Filter "*.log" | Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) | Remove-Item
```

Add this to a monthly scheduled task if needed.

---

## Troubleshooting

### Issue: Email not sending

**Check:**
1. Environment variables configured in `.env.local`
2. SMTP credentials valid
3. Firewall allows outbound port 587
4. Script run with `-SendEmail` flag

**Test SMTP connection:**
```powershell
Test-NetConnection -ComputerName smtp.gmail.com -Port 587
```

### Issue: Report not generated

**Check:**
1. Database connection working (verify DATABASE_URL in .env.local)
2. npm dependencies installed (`npm install` in web/)
3. TypeScript compilation successful

**Run script manually:**
```powershell
cd D:\Abhay\VibeCoding\IPODhan\web
npm run data-quality-report
```

### Issue: Scheduled task not running

**Check:**
1. Task Scheduler service running: `Get-Service -Name Schedule`
2. Task enabled in Task Scheduler GUI
3. User account has permissions
4. "Run whether user is logged on or not" checked

**View task last run result:**
```powershell
Get-ScheduledTask -TaskName "IPODhan Weekly Data Quality Report" | Get-ScheduledTaskInfo
```

### Issue: PowerShell execution policy error

**Fix:**
```powershell
# Run as Administrator
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine
```

Or use bypass in Task Scheduler action:
```
powershell.exe -ExecutionPolicy Bypass -File "path\to\script.ps1"
```

---

## Email Templates

### CRITICAL Issue Alert

**Subject:** [IPODhan] 🚨 CRITICAL Data Quality Issues Detected

**Body:**
- Date and time
- Issue counts by severity
- Report file location
- Call to action

### Clean Report Summary (Optional)

**Subject:** [IPODhan] ✅ Weekly Data Quality Report - No Critical Issues

**Body:**
- Date and time
- Issue summary (0 CRITICAL)
- Report file location

---

## Security Considerations

1. **SMTP Credentials:**
   - Store in .env.local (not committed to git)
   - Use app-specific passwords (not account passwords)
   - Rotate credentials quarterly

2. **Task Scheduler:**
   - Run with least privilege user
   - Enable "Run only when user is logged on" for testing
   - Use "Run whether user is logged on or not" for production

3. **Log Files:**
   - Implement log rotation (30-day retention)
   - Ensure logs don't contain sensitive data
   - Restrict file permissions to administrators only

---

## Integration with Monitoring Tools

### Send to Slack

Add Slack webhook to PowerShell script:

```powershell
$slackWebhook = $env:SLACK_WEBHOOK_URL
$payload = @{
    text = "🚨 CRITICAL Data Quality Issues: $criticalCount"
    channel = "#ipodhan-alerts"
} | ConvertTo-Json

Invoke-RestMethod -Uri $slackWebhook -Method Post -Body $payload -ContentType 'application/json'
```

### Send to Microsoft Teams

```powershell
$teamsWebhook = $env:TEAMS_WEBHOOK_URL
$payload = @{
    text = "🚨 CRITICAL Data Quality Issues Detected"
    title = "IPODhan Data Quality Alert"
} | ConvertTo-Json

Invoke-RestMethod -Uri $teamsWebhook -Method Post -Body $payload -ContentType 'application/json'
```

---

## Production Checklist

- [ ] Environment variables configured (.env.local)
- [ ] Email SMTP settings tested
- [ ] Manual script execution successful
- [ ] Report generation verified
- [ ] Email notifications received (test with -SendEmail)
- [ ] Task Scheduler task imported
- [ ] Scheduled task tested manually
- [ ] Task history shows success
- [ ] Logs directory created (logs/data-quality/)
- [ ] Log rotation configured (optional)
- [ ] Team notified of automation schedule
- [ ] Escalation process defined for CRITICAL issues

---

## Support & Documentation

**Primary Documentation:**
- `docs/04-data-flow/DATA-QUALITY-CURRENT-STATUS.md` - Overall data quality status
- `docs/04-data-flow/DATA-QUALITY-SESSION-SUMMARY.md` - Session 4 implementation details

**Scripts:**
- `web/scripts/data-quality-report.ts` - Report generation script
- `web/scripts/run-data-quality-report.ps1` - Automation wrapper
- `web/scripts/task-scheduler-data-quality.xml` - Task Scheduler configuration

**Logs:**
- `web/logs/data-quality/report-YYYY-MM-DD.log` - Execution logs

**Contact:**
- Development Team: IPODhan Development Team
- Escalation: admin@yourcompany.com

---

**Document Owner:** IPODhan Development Team
**Created:** 2025-11-09
**Last Updated:** 2025-11-09
**Status:** Ready for Production
