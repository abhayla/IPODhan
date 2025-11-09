# Automated Data Quality Reports - Quick Start

**Status:** ✅ Ready for Production
**Platform:** Windows Server 2022
**Schedule:** Every Sunday at 2:00 AM

---

## Quick Setup (5 Minutes)

### Option 1: Interactive Setup (Recommended)

```powershell
cd D:\Abhay\VibeCoding\IPODhan\web
.\scripts\setup-automated-reports.ps1
```

Follow the interactive prompts to configure email and import the task.

### Option 2: Manual Setup

**1. Test report generation:**
```powershell
cd D:\Abhay\VibeCoding\IPODhan\web
npm run data-quality-report
```

**2. Import Task Scheduler task:**
- Open **Task Scheduler** (taskschd.msc)
- Click **Action** → **Import Task...**
- Select `D:\Abhay\VibeCoding\IPODhan\web\scripts\task-scheduler-data-quality.xml`
- Click **OK**

**3. Test the automation:**
```powershell
cd D:\Abhay\VibeCoding\IPODhan\web
.\scripts\run-data-quality-report.ps1
```

---

## Files Created

| File | Purpose |
|------|---------|
| `run-data-quality-report.ps1` | Main automation script with email notifications |
| `task-scheduler-data-quality.xml` | Windows Task Scheduler configuration |
| `setup-automated-reports.ps1` | Interactive setup wizard |
| `../docs/04-data-flow/AUTOMATED-REPORTING-SETUP.md` | Complete documentation |

---

## What It Does

1. **Runs weekly data quality report** (every Sunday 2:00 AM)
2. **Checks 10+ data quality rules:**
   - lot_size validation (SEBI compliance)
   - Missing critical fields
   - Unusual data patterns
   - SEBI price band compliance
   - Data freshness
   - Field source distribution

3. **Sends email alerts** for CRITICAL issues only
4. **Maintains logs** in `logs/data-quality/`
5. **Generates markdown reports** in `docs/04-data-flow/data-quality-reports/`

---

## Email Configuration (Optional)

Edit `.env.local`:

```env
DATA_QUALITY_EMAIL_TO=admin@yourcompany.com
DATA_QUALITY_EMAIL_FROM=ipodhan@yourcompany.com
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_USE_SSL=true
```

**Note:** If email is not configured, reports will still be generated (no alerts sent).

---

## Testing

### Test without email:
```powershell
.\scripts\run-data-quality-report.ps1
```

### Test with email:
```powershell
.\scripts\run-data-quality-report.ps1 -SendEmail
```

### Test scheduled task:
```powershell
Start-ScheduledTask -TaskName "\IPODhan\Weekly Data Quality Report"
```

---

## Monitoring

### View latest report:
```powershell
cd D:\Abhay\VibeCoding\IPODhan\web
Get-Content docs\04-data-flow\data-quality-reports\$(Get-Date -Format 'yyyy-MM-dd').md
```

### View execution log:
```powershell
Get-Content logs\data-quality\report-$(Get-Date -Format 'yyyy-MM-dd').log
```

### View task history:
1. Open Task Scheduler
2. Navigate to **IPODhan** → **Weekly Data Quality Report**
3. Click **History** tab

---

## Troubleshooting

### Report not generated?
- Check database connection in `.env.local`
- Run manually: `npm run data-quality-report`

### Email not sending?
- Verify SMTP credentials in `.env.local`
- Test: `.\scripts\run-data-quality-report.ps1 -SendEmail`
- Check firewall allows port 587

### Task not running?
- Verify Task Scheduler service is running
- Check task is enabled
- Review task history for errors

---

## Full Documentation

For complete setup instructions, configuration options, and troubleshooting:

📖 **[AUTOMATED-REPORTING-SETUP.md](../docs/04-data-flow/AUTOMATED-REPORTING-SETUP.md)**

---

## Support

- **Documentation:** `docs/04-data-flow/AUTOMATED-REPORTING-SETUP.md`
- **Status:** `docs/04-data-flow/DATA-QUALITY-CURRENT-STATUS.md`
- **Logs:** `web/logs/data-quality/`

---

**Created:** 2025-11-09
**Status:** ✅ Production Ready
