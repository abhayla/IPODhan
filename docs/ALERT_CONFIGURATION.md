# Alert Configuration Guide - Phase 3.4

**Document Version**: 1.0
**Last Updated**: 2025-11-08
**Status**: Production Ready

---

## Overview

The IPODhan production monitoring system uses a **multi-tier alert strategy** to ensure data quality and system health. This guide provides complete setup instructions for email, Slack, and optional PagerDuty alerts.

### Alert Philosophy

Every alert follows three principles:
1. **What's Wrong**: Clear, specific problem description
2. **Why It Matters**: Business impact explanation
3. **What To Do**: Actionable next steps with direct links

### Alert Tiers

| Tier | Channel | Use Case | Example |
|------|---------|----------|---------|
| **P0 - CRITICAL** | Email + PagerDuty | Immediate action required | Duplicate IPOs, System failures |
| **P1 - HIGH** | Email | Requires attention within hours | >10 CRITICAL data conflicts |
| **P2 - MEDIUM** | Slack | Operational awareness | DRHP extraction failures, Performance degradation |
| **P3 - LOW** | Slack (daily digest) | Trends and patterns | Elevated conflict rate |

---

## Quick Start

**Time to Setup**: 15-20 minutes

1. **Email Alerts** (5 min) - [Jump to Section](#email-alerts-setup)
2. **Slack Alerts** (10 min) - [Jump to Section](#slack-alerts-setup)
3. **Test Alerts** (5 min) - [Jump to Section](#testing-alerts)

---

## Email Alerts Setup

### Purpose
Email alerts are sent for **CRITICAL** events requiring immediate attention:
- ✅ >10 CRITICAL data conflicts
- ✅ Duplicate IPO detection (deduplication failure)

### Option 1: Gmail (Recommended for Development/Small Teams)

**Step 1: Generate App Password**
1. Go to: https://myaccount.google.com/apppasswords
2. Enable 2-factor authentication (required)
3. Select "Mail" as app, "Other" as device
4. Copy the generated 16-character password

**Step 2: Configure Environment Variables**

Add to `web/.env.local`:

```bash
# Email Alerts
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=xxxx-xxxx-xxxx-xxxx  # App password from Step 1
SMTP_FROM=alerts@ipodhan.com  # Can be different from SMTP_USER
ADMIN_EMAIL=admin@yourcompany.com  # Where to send alerts
```

**Limitations**:
- 500 emails/day limit
- May be flagged as spam if sending too frequently
- Not ideal for high-volume production use

---

### Option 2: SendGrid (Recommended for Production)

**Why SendGrid**:
- ✅ 100 emails/day free tier (sufficient for most needs)
- ✅ Better deliverability (won't be marked as spam)
- ✅ Email analytics and tracking
- ✅ Industry standard for transactional emails

**Step 1: Create SendGrid Account**
1. Go to: https://sendgrid.com/free
2. Sign up for free account (no credit card required)
3. Verify email address
4. Complete sender identity verification

**Step 2: Create API Key**
1. Navigate to: Settings → API Keys
2. Click "Create API Key"
3. Name: "IPODhan Production Alerts"
4. Permission: "Mail Send" (Full Access)
5. Copy API key (shown only once!)

**Step 3: Configure Environment Variables**

```bash
# Email Alerts - SendGrid
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey  # Literally the word "apikey"
SMTP_PASSWORD=SG.xxxxxxxxxxxxxxxxxx  # API key from Step 2
SMTP_FROM=alerts@ipodhan.com  # Must be verified sender
ADMIN_EMAIL=admin@yourcompany.com
```

**Important**: `SMTP_FROM` email must be a verified sender in SendGrid:
- Go to: Settings → Sender Authentication → Verify Single Sender
- Add `alerts@ipodhan.com` (or your domain)
- Verify ownership via email

---

### Option 3: AWS SES (For AWS-Based Deployments)

**When to Use**: If your application is deployed on AWS infrastructure.

**Step 1: Setup AWS SES**
1. Go to AWS SES Console: https://console.aws.amazon.com/ses
2. Verify email identity (or domain for production)
3. Request production access (free tier: 62,000 emails/month)

**Step 2: Create SMTP Credentials**
1. In SES Console: Account Dashboard → SMTP Settings
2. Click "Create My SMTP Credentials"
3. Download credentials CSV

**Step 3: Configure Environment Variables**

```bash
# Email Alerts - AWS SES
SMTP_HOST=email-smtp.us-east-1.amazonaws.com  # Change region as needed
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=AKIA...  # From downloaded CSV
SMTP_PASSWORD=xxxx...  # From downloaded CSV
SMTP_FROM=alerts@ipodhan.com
ADMIN_EMAIL=admin@yourcompany.com
```

---

### Email Alert Triggers

| Alert | Threshold | Frequency | Priority |
|-------|-----------|-----------|----------|
| CRITICAL Conflicts | >10 unresolved | Once when crossed, then hourly | P1 |
| Duplicate IPOs | >0 detected | Immediately | P0 |

### Email Alert Format

**Subject Line**: Clear urgency indicator
- 🚨 CRITICAL: 15 Data Conflicts Require Immediate Attention
- 🔴 CRITICAL: Duplicate IPO Detection Failure

**Body**: HTML formatted with:
- **What's Wrong**: Metric and count
- **Why This Matters**: Impact explanation with bullet points
- **What To Do**: Numbered action steps
- **Action Button**: Direct link to admin dashboard
- **Alert Details**: Timestamp, threshold, environment

---

## Slack Alerts Setup

### Purpose
Slack alerts provide **operational awareness** for:
- ✅ DRHP extraction failures (>5 in 24h)
- ✅ Slow data consolidation (p95 latency >1000ms)
- ✅ High conflict rate (>5%)

### Step 1: Create Slack Webhook

1. **Go to Slack API**:
   https://api.slack.com/messaging/webhooks

2. **Create New Webhook**:
   - Click "Create New App" (or select existing app)
   - Choose "From scratch"
   - App Name: "IPODhan Alerts"
   - Workspace: Select your workspace

3. **Add Incoming Webhook**:
   - Under "Features", select "Incoming Webhooks"
   - Toggle "Activate Incoming Webhooks" to ON
   - Click "Add New Webhook to Workspace"

4. **Select Channel**:
   - Choose or create channel: `#ipodhan-alerts` or `#production-alerts`
   - Click "Allow"

5. **Copy Webhook URL**:
   - Format: `https://hooks.slack.com/services/T00000000/B00000000/XXXX`
   - Click "Copy" button

### Step 2: Configure Environment Variables

Add to `web/.env.local`:

```bash
# Slack Alerts
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX
```

### Slack Alert Triggers

| Alert | Threshold | Frequency | Priority |
|-------|-----------|-----------|----------|
| DRHP Extraction Failures | >5 in 24h | Every 30 min while exceeded | P2 |
| Slow Consolidation | p95 >1000ms | Every 30 min while exceeded | P2 |
| High Conflict Rate | >5% | Daily digest | P3 |

### Slack Alert Format

Uses **Slack Blocks API** for rich formatting:
- 📋 **Header**: Emoji + alert type
- 📊 **Metrics**: Key performance indicators in grid layout
- 💡 **Explanation**: Why this matters + possible causes
- 🔘 **Action Buttons**: Direct links to dashboards
- ⏰ **Context**: Timestamp, threshold, environment

**Example Alert**:
```
🔴 DRHP Extraction Alert

8 DRHP extraction failures detected in the last 24 hours.

Why this matters: DRHP extraction provides critical financial data. Failures mean incomplete IPO information for users.

Total Failures: 8        Download Errors: 2
Timeout Errors: 3        Extraction Errors: 3

What to do:
1. Check manual review queue
2. Verify Python extraction service running
3. Check disk space and file permissions
4. Review scraper logs for patterns

[View Metrics Dashboard] [Review Queue]

⏰ 2025-11-08T07:30:00.000Z | Threshold: 5 failures | Environment: production
```

---

## PagerDuty Alerts Setup (Optional)

### Purpose
PagerDuty provides **24/7 on-call alerting** for:
- ✅ Duplicate IPO detection (P0)
- ✅ System health CRITICAL failures

**Note**: Optional for initial deployment. Email + Slack cover most use cases. Add PagerDuty when you need:
- 24/7 on-call rotation
- SMS/Phone call escalation
- Incident management workflow

### Setup Instructions

1. **Create PagerDuty Account**: https://www.pagerduty.com/
2. **Create Service**:
   - Go to: Services → Service Directory → New Service
   - Name: "IPODhan Production"
   - Integration: "Events API V2"
   - Escalation Policy: Create or select existing
3. **Copy Integration Key**: Save the Integration Key
4. **Configure Environment**:
   ```bash
   PAGERDUTY_INTEGRATION_KEY=your_integration_key_here
   ```

---

## Testing Alerts

### Prerequisites
- Web application running: `npm run dev` (from `web/`)
- Environment variables configured (see above)

### Test Email Alerts

```bash
# From web/ directory
npx tsx scripts/test-email-alert.ts
```

**Expected Output**:
```
🧪 Email Alert System Test
============================================================

📋 Step 1: Testing Email Configuration...
   ✅ Test email sent to admin@yourcompany.com. Check inbox to verify delivery.

📧 Step 2: Testing CRITICAL Conflict Alert...
   Simulating 15 critical conflicts (threshold: 10)
   ✅ Alert sent successfully
   📬 Check your inbox for the critical conflict alert

📧 Step 3: Testing Duplicate IPO Alert...
   Simulating 2 duplicate IPOs detected
   ✅ Alert sent successfully
   📬 Check your inbox for the duplicate IPO alert

🔕 Step 4: Testing Threshold Logic (should NOT send)...
   Simulating 5 critical conflicts (below threshold of 10)
   ✅ Correctly skipped alert

============================================================
📊 Test Summary:
   Configuration: ✅ PASS
   Critical Conflict Alert: ✅ SENT
   Duplicate IPO Alert: ✅ SENT
   Threshold Logic: ✅ PASS

✅ ALL TESTS PASSED

🎉 Email alert system is fully operational!
   Next step: Configure alerts in monitoring API
============================================================
```

**Check your inbox** for 3 test emails:
1. Email Alert System Test
2. CRITICAL Conflict Alert
3. Duplicate IPO Alert

---

### Test Slack Alerts

```bash
# From web/ directory
npx tsx scripts/test-slack-alert.ts
```

**Expected Output**:
```
🧪 Slack Alert System Test
============================================================

📋 Step 1: Testing Slack Configuration...
   ✅ Test message sent to Slack channel. Check your workspace to verify delivery.

✋ Please check your Slack channel for the test message.
   Continuing in 3 seconds...

📢 Step 2: Testing DRHP Failure Alert...
   Simulating 8 DRHP failures (threshold: 5)
   ✅ Alert sent successfully
   💬 Check your Slack channel for the DRHP failure alert

📢 Step 3: Testing Slow Consolidation Alert...
   Simulating p95 latency of 1200ms (threshold: 1000ms)
   ✅ Alert sent successfully
   💬 Check your Slack channel for the performance alert

📢 Step 4: Testing High Conflict Rate Alert...
   Simulating 6.5% conflict rate (threshold: 5%)
   ✅ Alert sent successfully
   💬 Check your Slack channel for the conflict rate alert

🔕 Step 5: Testing Threshold Logic (should NOT send)...
   Simulating 3 DRHP failures (below threshold of 5)
   ✅ Correctly skipped alert

============================================================
📊 Test Summary:
   Configuration: ✅ PASS
   DRHP Failure Alert: ✅ SENT
   Slow Consolidation Alert: ✅ SENT
   High Conflict Rate Alert: ✅ SENT
   Threshold Logic: ✅ PASS

✅ ALL TESTS PASSED

🎉 Slack alert system is fully operational!
   Next step: Configure alerts in monitoring API
============================================================
```

**Check your Slack channel** for 4 test messages:
1. Slack Alert System Test
2. DRHP Extraction Alert
3. Performance Degradation Alert
4. Data Quality Alert

---

## Integrating Alerts with Monitoring API

Once alerts are tested, integrate them into the production monitoring endpoint.

### Location
`web/app/api/admin/metrics/data-pipeline/route.ts`

### Integration Points

**1. Import Alert Functions**:
```typescript
import {sendCriticalConflictAlert, sendDuplicateIPOAlert} from '@/lib/alerts/email-alerts';
import {sendDRHPFailureAlert, sendSlowConsolidationAlert, sendHighConflictRateAlert} from '@/lib/alerts/slack-alerts';
```

**2. Add Alert Logic** (after calculating metrics):
```typescript
// Email: CRITICAL conflicts
const criticalConflicts = conflicts.filter(c => c.severity === 'CRITICAL').length;
if (criticalConflicts > 10) {
  await sendCriticalConflictAlert(criticalConflicts).catch(err =>
    logger.error('[Monitoring] Email alert failed', { error: err })
  );
}

// Slack: DRHP failures
const drhpFailures = documents.filter(d => d.extraction_status === 'FAILED').length;
if (drhpFailures > 5) {
  await sendDRHPFailureAlert(drhpFailures, {
    last24Hours: drhpFailures,
    timeoutErrors: documents.filter(d => d.extraction_error?.includes('timeout')).length,
    downloadErrors: documents.filter(d => d.extraction_error?.includes('download')).length,
    extractionErrors: drhpFailures
  }).catch(err =>
    logger.error('[Monitoring] Slack alert failed', { error: err })
  );
}

// Slack: Slow consolidation
if (consolidationMetrics.p95Latency > 1000) {
  await sendSlowConsolidationAlert(consolidationMetrics.p95Latency, {
    avgLatency: consolidationMetrics.avgLatency,
    p99Latency: consolidationMetrics.p99Latency,
    slowestOperation: 'normalization',
    operationsLast1h: consolidationMetrics.processedLast1h
  }).catch(err =>
    logger.error('[Monitoring] Slack alert failed', { error: err })
  );
}
```

**3. Error Handling**:
- Always use `.catch()` to prevent alert failures from breaking the API
- Log all alert attempts (success and failure)
- Alerts are best-effort - monitoring API should never fail due to alerts

---

## Production Deployment Checklist

### Before Deploying to Production

- [ ] **Email Configuration**
  - [ ] SMTP credentials configured in production `.env`
  - [ ] `SMTP_FROM` email verified with provider
  - [ ] `ADMIN_EMAIL` is monitored 24/7 (or rotation list)
  - [ ] Test email sent and received successfully

- [ ] **Slack Configuration**
  - [ ] Webhook URL configured in production `.env`
  - [ ] Alert channel created (e.g., `#production-alerts`)
  - [ ] Channel members include on-call team
  - [ ] Test message sent and received successfully

- [ ] **Alert Integration**
  - [ ] Monitoring API updated with alert calls
  - [ ] Error handling implemented (`.catch()` on all alerts)
  - [ ] Alert thresholds reviewed and approved

- [ ] **Testing**
  - [ ] Both test scripts run successfully
  - [ ] Alerts appear in correct channels
  - [ ] Action buttons link to correct dashboards
  - [ ] Threshold logic verified (no alerts below threshold)

- [ ] **Documentation**
  - [ ] Operations team trained on alert response procedures
  - [ ] Runbook updated with alert troubleshooting steps
  - [ ] On-call rotation configured (if using PagerDuty)

---

## Alert Response Procedures

When you receive an alert, follow these steps:

### CRITICAL Conflicts Alert (Email)

**Severity**: P1 - HIGH
**Response Time**: 4 hours

1. **Acknowledge**: Open alert email, click "Resolve Conflicts Now"
2. **Assess**: Review conflict dashboard to understand severity distribution
3. **Prioritize**: Sort by severity (CRITICAL first), then by field importance
4. **Resolve**:
   - Single resolution: For low-volume, high-impact conflicts
   - Bulk resolution: For pattern-based conflicts (e.g., same field across IPOs)
   - Auto-resolve: ONLY if conflict pattern is well-understood (use dry-run first)
5. **Document**: Add admin notes explaining resolution reasoning
6. **Monitor**: Check conflict count after 1 hour to ensure it doesn't spike again

**Escalation**: If conflict rate remains >10 CRITICAL after 4 hours, escalate to data engineering team.

---

### Duplicate IPO Alert (Email)

**Severity**: P0 - CRITICAL
**Response Time**: IMMEDIATE

1. **Acknowledge**: This indicates a **fundamental system failure**
2. **STOP SCRAPERS**: Immediately pause all scrapers to prevent more duplicates
   ```bash
   pm2 stop scraper-nse scraper-bse
   ```
3. **Investigate**:
   - Check Redis connectivity (distributed locking depends on Redis)
   - Review scraper logs for race conditions
   - Verify database connection pool not exhausted
4. **Identify Duplicates**:
   ```sql
   SELECT company_name, COUNT(*) as count
   FROM ipos
   WHERE created_at > NOW() - INTERVAL '24 hours'
   GROUP BY company_name
   HAVING COUNT(*) > 1;
   ```
5. **Manual Merge**: Merge duplicate entries after confirming root cause
6. **Fix Root Cause**: Before restarting scrapers
7. **Resume**: Restart scrapers only after root cause fixed

**Escalation**: If duplicates continue after restart, **STOP ALL SCRAPERS** and escalate to engineering immediately.

---

### DRHP Extraction Failures Alert (Slack)

**Severity**: P2 - MEDIUM
**Response Time**: 2 hours

1. **Review Queue**: Click "Review Queue" button in Slack alert
2. **Check Patterns**:
   - Same IPO failing repeatedly? → Corrupt PDF or network issue
   - All IPOs failing? → Python extraction service down
   - Timeouts only? → Increase timeout threshold
3. **Common Fixes**:
   - Restart Python extraction service
   - Check disk space: `df -h`
   - Verify file permissions on upload directory
   - Clear temp directory if full
4. **Manual Review**: For persistent failures, mark documents for manual review
5. **Monitor**: Track failure rate for 1 hour to ensure fix worked

---

### Slow Consolidation Alert (Slack)

**Severity**: P2 - MEDIUM
**Response Time**: 2 hours

1. **Check Metrics**: Click "View Performance Metrics" in alert
2. **Diagnose**:
   - Database pool exhausted? → Check active connections
   - Redis slow/unavailable? → Test Redis connectivity
   - High concurrent load? → Check scraper schedule
3. **Quick Fixes**:
   - Restart Redis if slow
   - Scale database connections (if needed and safe)
   - Temporarily reduce scraper concurrency
4. **Monitor**: Track p95 latency for 30 minutes

---

## Troubleshooting

### Email Alerts Not Sending

**Symptom**: Test script shows success but no emails received.

**Diagnosis**:
1. Check spam folder
2. Verify `SMTP_FROM` matches verified sender (SendGrid/SES)
3. Check SMTP credentials are correct
4. Review Winston logs for SMTP errors:
   ```bash
   tail -f web/logs/error.log | grep "Email Alert"
   ```

**Fix**:
- Gmail: Ensure app password is correct, not regular password
- SendGrid: Verify sender identity in SendGrid console
- SES: Check production access approved (not sandbox mode)

---

### Slack Alerts Not Appearing

**Symptom**: Test script succeeds but no Slack messages.

**Diagnosis**:
1. Verify webhook URL format (starts with `https://hooks.slack.com/services/`)
2. Check webhook not revoked (test in Slack API console)
3. Verify channel exists and webhook has access

**Fix**:
1. Regenerate webhook URL
2. Ensure webhook added to correct workspace
3. Check channel permissions (webhook app must have access)

---

### Too Many Alerts (Alert Fatigue)

**Symptom**: Alert channel becoming noisy, team ignoring alerts.

**Fix**:
1. **Increase Thresholds** (in `.env`):
   ```bash
   ALERT_CRITICAL_CONFLICTS_THRESHOLD=20  # Was 10
   ALERT_DRHP_FAILURES_THRESHOLD=10  # Was 5
   ```
2. **Adjust Frequency**: Modify alert code to send daily digests instead of real-time
3. **Add Snooze Logic**: Implement alert suppression for resolved issues
4. **Review Patterns**: If same alert triggers daily, fix root cause instead of alerting

---

## Advanced Configuration

### Custom Alert Thresholds

Override default thresholds in `.env.local`:

```bash
# Default thresholds (if not set)
ALERT_CRITICAL_CONFLICTS_THRESHOLD=10
ALERT_DRHP_FAILURES_THRESHOLD=5
ALERT_CONFLICT_RATE_THRESHOLD=5.0  # Percentage
ALERT_SLOW_CONSOLIDATION_THRESHOLD=1000  # Milliseconds
```

### Alert Frequency Limits

Prevent alert spam by implementing rate limiting:

```typescript
// Example: Only send email once per hour
const lastAlertTime = await redis.get('alert:critical-conflicts:last-sent');
const hourAgo = Date.now() - 3600000;

if (!lastAlertTime || parseInt(lastAlertTime) < hourAgo) {
  await sendCriticalConflictAlert(conflictCount);
  await redis.set('alert:critical-conflicts:last-sent', Date.now().toString());
}
```

---

## Monitoring Alert Health

### Check Alert Delivery

View alert logs in Winston:

```bash
# Email alert logs
tail -f web/logs/app.log | grep "Email Alert"

# Slack alert logs
tail -f web/logs/app.log | grep "Slack Alert"
```

### Alert Metrics

Track alert effectiveness:
- **Alert Volume**: How many alerts sent per day?
- **False Positive Rate**: Alerts that didn't require action
- **Response Time**: Time from alert to resolution
- **Alert Fatigue**: Alerts ignored or dismissed without action

---

## FAQ

### Q: Can I send alerts to multiple email addresses?

**A**: Yes. Set `ADMIN_EMAIL` as comma-separated list:
```bash
ADMIN_EMAIL=admin1@company.com,admin2@company.com,oncall@company.com
```

Then update email alert code to split and send to all:
```typescript
const recipients = config.to.split(',');
// Send to all recipients
```

---

### Q: Can I use different Slack channels for different alert types?

**A**: Yes. Create multiple webhooks:
```bash
SLACK_WEBHOOK_CRITICAL=https://hooks.slack.com/services/T00/B00/critical
SLACK_WEBHOOK_PERFORMANCE=https://hooks.slack.com/services/T00/B00/performance
```

Update alert functions to use appropriate webhook.

---

### Q: How do I disable alerts temporarily?

**A**: Comment out webhook URL in `.env.local`:
```bash
# SLACK_WEBHOOK_URL=https://hooks.slack.com/...
```

Alert functions will gracefully degrade to logging only.

---

### Q: What's the cost of these alert providers?

| Provider | Free Tier | Paid Plan | Notes |
|----------|-----------|-----------|-------|
| Gmail | 500 emails/day | N/A | Not recommended for production |
| SendGrid | 100 emails/day | $15/mo (40k emails) | Best for production |
| AWS SES | 62,000/mo | $0.10 per 1000 | Great if on AWS |
| Slack | Unlimited webhooks | N/A | Free forever |
| PagerDuty | 14-day trial | $19/user/mo | Only if 24/7 oncall needed |

**Recommendation**: Start with SendGrid (free tier) + Slack (free). Add PagerDuty only if you need SMS/phone escalation.

---

## Conclusion

Your alert system is now configured and production-ready. Remember:

✅ **Test Regularly**: Run test scripts monthly to verify deliverability
✅ **Monitor Effectiveness**: Track alert-to-resolution times
✅ **Iterate Thresholds**: Adjust based on actual system behavior
✅ **Prevent Fatigue**: Quality > quantity - only alert on actionable issues

For troubleshooting and incident response, see: `docs/OPERATIONS_RUNBOOK.md`

---

**Document Status**: ✅ Complete
**Next Step**: Integrate alerts into monitoring API and deploy to production
**Support**: For questions, contact DevOps team or create issue in repository
