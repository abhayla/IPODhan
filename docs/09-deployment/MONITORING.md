# IPODhan Production Monitoring & Alerting

**Version:** 1.0
**Last Updated:** 2025-10-16
**Story:** 8.5 - Monitoring & Alerts
**Environment:** Windows Server 2022 VPS (103.118.16.189)

## Table of Contents

1. [Overview](#overview)
2. [Monitoring Stack](#monitoring-stack)
3. [Health Check Endpoint](#health-check-endpoint)
4. [Uptime Monitoring (UptimeRobot)](#uptime-monitoring-uptimerobot)
5. [Error Tracking (Sentry)](#error-tracking-sentry)
6. [Structured Logging (Pino)](#structured-logging-pino)
7. [Google Analytics 4](#google-analytics-4)
8. [PM2 Monitoring](#pm2-monitoring)
9. [Scraper Monitoring](#scraper-monitoring)
10. [Alerting Rules](#alerting-rules)
11. [Monitoring Dashboard](#monitoring-dashboard)
12. [Incident Response](#incident-response)
13. [Troubleshooting](#troubleshooting)

---

## Overview

IPODhan uses a comprehensive monitoring stack to ensure 99.5%+ uptime and proactive issue detection. This document provides complete guidance for configuring, accessing, and responding to monitoring systems.

### Monitoring Goals

- **Uptime:** Detect site downtime within 5 minutes
- **Performance:** Track Core Web Vitals and API response times
- **Errors:** Capture and alert on application errors
- **Scraper Health:** Monitor data scraping success rate
- **User Behavior:** Understand user engagement and conversion

### Target Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Uptime | 99.5%+ | 3 consecutive failures (15 min) |
| API Response Time (p95) | < 500ms | > 1000ms |
| Error Rate | < 1% | > 5% |
| Scraper Success Rate | > 95% | 3 consecutive failures |
| Memory Usage | < 80% | > 90% |
| CPU Usage | < 70% | > 85% |

---

## Monitoring Stack

### Components

```
┌─────────────────────────────────────────────────────┐
│                 Monitoring Stack                     │
├─────────────────────────────────────────────────────┤
│                                                      │
│  External:                                          │
│  ├─ UptimeRobot         → Site availability        │
│  ├─ Google Analytics 4  → User behavior            │
│  └─ Sentry (optional)   → Error tracking           │
│                                                      │
│  Application:                                       │
│  ├─ Health Endpoint     → /api/health              │
│  ├─ Pino Logger         → Structured logs          │
│  └─ Scraper Logs DB     → scraper_logs table       │
│                                                      │
│  Infrastructure:                                    │
│  ├─ PM2                 → Process metrics          │
│  ├─ PM2 Logs            → Application logs         │
│  └─ Redis Client        → Cache health             │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Architecture Decision

- **External Monitoring:** UptimeRobot for uptime checks (free tier sufficient)
- **Error Tracking:** Sentry recommended but optional (free tier: 5,000 events/month)
- **Analytics:** Google Analytics 4 (free, unlimited)
- **Logging:** Pino for structured JSON logs
- **Process Management:** PM2 with built-in monitoring
- **Scraper Tracking:** Database-backed logging

---

## Health Check Endpoint

### Endpoint Details

**URL:** `https://ipodhan.com/api/health` (or `http://localhost:3000/api/health` in dev)

**Method:** `GET`

**Authentication:** None (public endpoint)

**Implementation:** `web/app/api/health/route.ts`

### Response Format

**Success (200 OK):**

```json
{
  "status": "healthy",
  "timestamp": "2025-10-16T10:30:00.000Z",
  "services": {
    "database": "healthy",
    "redis": "healthy"
  },
  "details": {
    "database": {
      "connected": true,
      "serverTime": "2025-10-16 10:30:00",
      "version": "PostgreSQL 16.3",
      "tables": 16
    },
    "redis": {
      "connected": true,
      "memoryUsed": "2.5M"
    }
  },
  "application": {
    "name": "IPODhan",
    "environment": "production"
  }
}
```

**Unhealthy (503 Service Unavailable):**

```json
{
  "status": "unhealthy",
  "timestamp": "2025-10-16T10:30:00.000Z",
  "services": {
    "database": "unhealthy",
    "redis": "healthy"
  },
  "details": {
    "database": {
      "connected": false,
      "error": "Connection timeout"
    },
    "redis": {
      "connected": true,
      "memoryUsed": "2.5M"
    }
  },
  "application": {
    "name": "IPODhan",
    "environment": "production"
  }
}
```

### Health Checks Performed

1. **Database (PostgreSQL):**
   - Executes `SELECT NOW()` to verify connection
   - Retrieves PostgreSQL version
   - Counts public tables

2. **Redis:**
   - Executes `PING` command
   - Retrieves memory usage
   - Returns "healthy" if PONG received

### Testing Locally

```bash
# Test health endpoint
curl http://localhost:3000/api/health

# Pretty print JSON
curl http://localhost:3000/api/health | jq

# Check status code only
curl -I http://localhost:3000/api/health
```

### Performance Characteristics

- **Response Time:** < 200ms (target)
- **No Caching:** Always fresh status
- **Lightweight:** Simple queries only
- **Non-blocking:** Async operations

---

## Uptime Monitoring (UptimeRobot)

### Setup Instructions

**⚠️ POST-DEPLOYMENT TASK** - Configure after deploying to production VPS.

#### 1. Create UptimeRobot Account

1. Go to https://uptimerobot.com
2. Sign up for free account (50 monitors, 5-minute intervals)
3. Verify email address

#### 2. Add Monitor

**Monitor Configuration:**

```yaml
Monitor Type: HTTP(s)
Friendly Name: IPODhan Production
URL: https://ipodhan.com/api/health
Monitoring Interval: 5 minutes
Monitor Timeout: 30 seconds
Request Method: GET (HEAD)
Expected Status Code: 200
Keyword Check: (optional) "healthy"
```

**Steps:**

1. Click "Add New Monitor"
2. Select "HTTP(s)" as monitor type
3. Enter "IPODhan Production" as friendly name
4. Enter `https://ipodhan.com/api/health` as URL
5. Set monitoring interval to 5 minutes
6. Set timeout to 30 seconds
7. Select "GET (HEAD)" as request method
8. Click "Create Monitor"

#### 3. Configure Alert Contacts

**Email Alert:**

1. Go to "My Settings" → "Alert Contacts"
2. Click "Add Alert Contact"
3. Select "Email"
4. Enter your email address
5. Click "Create Alert Contact"
6. Verify email

**SMS Alert (optional):**

1. Go to "My Settings" → "Alert Contacts"
2. Click "Add Alert Contact"
3. Select "SMS"
4. Enter phone number (requires premium plan)
5. Verify phone number

#### 4. Configure Alert Thresholds

**Notification Settings:**

```yaml
Alert When: Down
Alert Threshold: After 3 consecutive failures (15 minutes)
Re-alert: Every time it goes down
Up Notification: Yes (notify when site comes back up)
```

**Steps:**

1. Edit the monitor
2. Go to "Alert Contacts to Notify"
3. Select email/SMS contacts
4. Set "Alert when" to "Down"
5. Enable "Send notification when monitor goes up"
6. Save settings

#### 5. Test Alert Delivery

**Test by Stopping Application:**

```bash
# SSH to VPS
ssh user@103.118.16.189

# Stop web application
pm2 stop ipodhan-web

# Wait 15 minutes (3 × 5-minute checks)
# Check email for alert

# Restart application
pm2 start ipodhan-web

# Verify "Up" notification received
```

### UptimeRobot Dashboard Access

**URL:** https://uptimerobot.com/dashboard

**Key Metrics:**
- Current status (Up/Down)
- Uptime percentage (7 days, 30 days, 90 days)
- Average response time
- Downtime history
- Alert history

### Alert Response Procedure

**When you receive an UptimeRobot alert:**

1. **Verify the alert:** Go to https://ipodhan.com/api/health in browser
2. **Check PM2 status:** `pm2 status` (see [PM2 Monitoring](#pm2-monitoring))
3. **Check application logs:** `pm2 logs ipodhan-web --lines 100`
4. **Check database:** Verify PostgreSQL is running
5. **Check Redis:** Verify Redis is running
6. **Restart if needed:** `pm2 restart ipodhan-web`
7. **Monitor recovery:** Wait for "Up" notification

---

## Error Tracking (Sentry)

### Live status (verified 2026-08-20, T-222)

**NOT WIRED — owner-blocked on a credential.** The code is fully ready
(`@sentry/nextjs`, `sentry.client.config.ts` / `sentry.server.config.ts` /
`sentry.edge.config.ts`, `web/instrumentation-client.ts`, and the test route
`GET /api/sentry-test` all exist and are DSN-gated), but there is currently no
real DSN anywhere:

- The Windows VPS (`103.118.16.189`, `C:\Apps\IPODhan\current`) was searched
  for every `.env*` file matching `^(NEXT_PUBLIC_SENTRY_DSN|SENTRY_DSN|SENTRY_)`
  and returned **zero matches**. The only observability key present on the box
  is `NEXT_PUBLIC_GA_MEASUREMENT_ID`.
- The served homepage contains **zero** occurrences of `sentry` and one
  GA4/gtag reference — i.e. GA4 genuinely fires; Sentry does not initialise at
  all (it is DSN-gated and silently no-ops with nothing set).
- `D:\Abhay\GLOBAL.env` (the cross-project shared-secret store) has no
  `SENTRY_*` entry.
- The repo's `web/.env.local` and `web/.env.local.bak` contain only a
  **placeholder** DSN (`https://example@o0000000.ingest.sentry.io/0000000`),
  not a real one.

So every error Sentry would have captured in production right now goes
nowhere — the code runs, the exception is caught, and `Sentry.captureException`
silently no-ops because there is no destination configured. This was shipped
as "re-enable Sentry + GA4" (`8b5ae00b`, PR #115) — GA4 half of that claim is
true and verified; the Sentry half is not.

**What the owner must do (cannot be automated or guessed):**

1. Sign in to https://sentry.io (or create an account) and open/create the
   `ipodhan-web` project.
2. Copy its DSN from Project Settings → Client Keys (DSN).
3. Hand the DSN to a session with VPS access, which will set `SENTRY_DSN`
   (server) and `NEXT_PUBLIC_SENTRY_DSN` (client — read by
   `sentry-env.ts`/`instrumentation-client.ts`) in `web/.env.local` on the
   VPS, back up the file first, restart `pm2 restart ipodhan-web`, then hit
   `GET /api/sentry-test?test=error` and confirm the event lands in the
   Sentry project dashboard with a fresh timestamp before calling it done.
   `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` are optional
   (source-map upload only — `next.config.mjs`'s `withSentryConfig`); their
   absence does not block error capture.

**How to re-check this status in one command** (from the VPS, or over the SSH
tunnel): `grep -riE "SENTRY" C:\Apps\IPODhan\current\web\.env.local` — a real
`https://...@o<digits>.ingest.sentry.io/<digits>` value (not `example`/`xxx`/
`0000000`) means it's wired; confirm delivery via `/api/sentry-test?test=error`
and the Sentry dashboard, not just the presence of the env var.

### Option 1: Sentry (Recommended)

**⚠️ OPTIONAL** - Sentry provides powerful error tracking but requires account setup.

#### Prerequisites

- Sentry account (https://sentry.io)
- Sentry project for IPODhan
- Sentry DSN (Data Source Name)

#### Setup Instructions

**1. Create Sentry Account:**

1. Go to https://sentry.io
2. Sign up for free account (5,000 events/month)
3. Verify email

**2. Create Sentry Project:**

1. Click "Create Project"
2. Select "Next.js" as platform
3. Enter "ipodhan" as project name
4. Click "Create Project"
5. Copy the DSN (format: `https://xxx@xxx.ingest.sentry.io/xxx`)

**3. Configure Sentry in IPODhan:**

**Add to `.env.production`:**

```bash
# Sentry Error Tracking
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_AUTH_TOKEN=<your-auth-token>
```

**Note:** Sentry is already installed (`@sentry/nextjs v10.17.0`). Configuration files may already exist:
- `sentry.client.config.ts`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`

**4. Test Error Capture:**

Create a test error in any API route:

```typescript
// Test error (remove after verification)
if (process.env.NODE_ENV === 'development') {
  throw new Error('[Sentry Test] This is a test error');
}
```

**5. Configure Alerts:**

1. Go to Sentry project dashboard
2. Click "Alerts" → "Create Alert"
3. Select "Issues"
4. Set condition: "New issue is created"
5. Add email notification
6. Save alert rule

### Option 2: Alternative (Pino-based Error Logging)

**If not using Sentry, use structured logging:**

**Enhanced error logging in API routes:**

```typescript
import { logger } from '@/lib/logger';

try {
  // Your code
} catch (error) {
  logger.error({
    error: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined,
    path: '/api/your-route',
    method: 'GET',
    timestamp: new Date().toISOString(),
  }, 'API Error');

  // Return error response
}
```

**Monitor errors in PM2 logs:**

```bash
# View error logs
pm2 logs ipodhan-web --err --lines 100

# Search for errors
pm2 logs ipodhan-web --err | grep -i "error"
```

---

## Structured Logging (Pino)

### Logger Configuration

**Location:** `web/lib/logger.ts`

**Pino Version:** v10.0.0 (already installed)

**Configuration:**

```typescript
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  browser: {
    asObject: true,
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
```

### Log Levels

| Level | Priority | Usage |
|-------|----------|-------|
| `debug` | 20 | Detailed debugging information |
| `info` | 30 | General informational messages |
| `warn` | 40 | Warning messages (non-critical issues) |
| `error` | 50 | Error messages (failures, exceptions) |
| `fatal` | 60 | Fatal errors (application crash) |

### Usage Examples

**API Route Logging:**

```typescript
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    logger.info({
      path: '/api/ipos',
      method: 'GET'
    }, 'API request started');

    // Your logic here
    const data = await fetchIPOs();

    const duration = Date.now() - startTime;
    logger.info({
      path: '/api/ipos',
      method: 'GET',
      status: 200,
      duration,
    }, 'API request completed');

    return NextResponse.json({ data });

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error({
      error: error instanceof Error ? error.message : 'Unknown',
      stack: error instanceof Error ? error.stack : undefined,
      path: '/api/ipos',
      method: 'GET',
      duration,
    }, 'API request failed');

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

**Scraper Logging:**

```typescript
import { logger } from '@/lib/logger';

// Start scraper run
logger.info({
  source: 'NSE',
  timestamp: new Date().toISOString(),
}, 'Scraper run started');

try {
  // Scraping logic
  const results = await scrapeNSE();

  logger.info({
    source: 'NSE',
    recordsProcessed: results.length,
    recordsUpdated: results.filter(r => r.updated).length,
    duration: results.duration,
  }, 'Scraper run completed');

} catch (error) {
  logger.error({
    error: error instanceof Error ? error.message : 'Unknown',
    stack: error instanceof Error ? error.stack : undefined,
    source: 'NSE',
  }, 'Scraper run failed');
}
```

### Log Output

**Development (pretty-printed):**

Pino logs are output as simple text in development mode for readability.

**Production (JSON):**

```json
{
  "level": 30,
  "time": "2025-10-16T10:30:00.000Z",
  "pid": 12345,
  "hostname": "ipodhan-vps",
  "path": "/api/ipos",
  "method": "GET",
  "status": 200,
  "duration": 45,
  "msg": "API request completed"
}
```

### Viewing Logs

**PM2 Logs (includes Pino output):**

```bash
# View all logs
pm2 logs ipodhan-web

# View last 100 lines
pm2 logs ipodhan-web --lines 100

# View only errors
pm2 logs ipodhan-web --err

# Follow logs in real-time
pm2 logs ipodhan-web --raw

# Search logs
pm2 logs ipodhan-web | grep "error"
```

**Log Files (PM2 managed):**

```
logs/
├── web-out.log       # Standard output (info, debug)
├── web-error.log     # Error output (error, fatal)
├── scraper-out.log   # Scraper standard output
└── scraper-error.log # Scraper error output
```

### Log Rotation

**PM2 Log Rotation (configured in ecosystem.config.js):**

- **Max Size:** 10MB per log file
- **Retention:** 7 days
- **Compression:** Gzip
- **Automatic:** PM2 handles rotation

**Manual log cleanup (if needed):**

```bash
# Clear all PM2 logs
pm2 flush

# Clear logs for specific app
pm2 flush ipodhan-web
```

---

## Google Analytics 4

### Setup Instructions

**⚠️ POST-DEPLOYMENT TASK** - Configure after deploying to production.

#### 1. Create GA4 Property

1. Go to https://analytics.google.com
2. Sign in with Google account
3. Click "Admin" → "Create Property"
4. Enter "IPODhan" as property name
5. Select timezone: Asia/Kolkata (IST)
6. Select currency: INR (Indian Rupee)
7. Click "Next"
8. Select industry: "Finance"
9. Select business size
10. Click "Create"
11. Accept Terms of Service

#### 2. Set Up Data Stream

1. Select "Web" as platform
2. Enter website URL: `https://ipodhan.com`
3. Enter stream name: "IPODhan Production"
4. Click "Create stream"
5. **Copy Measurement ID** (format: `G-XXXXXXXXXX`)

#### 3. Configure GA4 in IPODhan

**Add to `.env.production`:**

```bash
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

**Add to root layout (`web/app/layout.tsx`):**

```typescript
import { GoogleAnalytics } from '@next/third-parties/google';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}

        {/* Google Analytics 4 */}
        {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
          <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID} />
        )}
      </body>
    </html>
  );
}
```

**Package installed:** `@next/third-parties` v15.5.5

#### 4. Test GA4 Integration

1. Deploy changes to production
2. Visit https://ipodhan.com
3. Go to GA4 dashboard → "Realtime"
4. Verify you see 1 active user (yourself)
5. Navigate to different pages
6. Verify pageviews appear in realtime report

### Core Metrics Tracked (Automatic)

GA4 automatically tracks:

- **Pageviews:** Every page visit
- **Sessions:** User sessions
- **User Engagement:** Time on site, pages per session
- **Core Web Vitals:**
  - LCP (Largest Contentful Paint)
  - FID (First Input Delay)
  - CLS (Cumulative Layout Shift)
- **Traffic Sources:** Referrers, search engines, direct
- **Device Types:** Desktop, mobile, tablet
- **Geographic:** Country, city

### Custom Events (Future Implementation)

**Recommended custom events to implement:**

```typescript
// Example: Track IPO card click
gtag('event', 'ipo_card_click', {
  ipo_name: 'Reliance Retail',
  ipo_status: 'OPEN',
  category: 'MAINBOARD',
});

// Example: Track filter usage
gtag('event', 'filter_used', {
  filter_type: 'status',
  filter_value: 'OPEN',
});

// Example: Track broker affiliate click
gtag('event', 'affiliate_clicked', {
  broker: 'zerodha',
  source: 'ipo_detail',
  ipo_name: 'Reliance Retail',
});

// Example: Track tool usage
gtag('event', 'tool_used', {
  tool_name: 'lot_calculator',
  price: 500,
  quantity: 100,
});
```

### GA4 Dashboard Access

**URL:** https://analytics.google.com

**Key Reports:**

1. **Realtime:** Current active users and pageviews
2. **Acquisition:** Traffic sources and campaigns
3. **Engagement:** Top pages, events, conversions
4. **Retention:** User retention and churn
5. **Demographics:** User age, gender, interests
6. **Tech:** Browser, OS, device types
7. **Pages and Screens:** Most visited pages

### GA4 Data Retention

**Default:** 14 months

**To extend:**

1. Go to "Admin" → "Data Settings" → "Data Retention"
2. Select "14 months" (free tier maximum)
3. Click "Save"

---

## PM2 Monitoring

### PM2 Configuration

**File:** `ecosystem.config.js` (project root)

**Applications Managed:**

1. **ipodhan-web:** Next.js web application (2 instances, cluster mode)
2. **ipodhan-scraper:** IPO scraper service (1 instance, fork mode)

### PM2 Commands

**Status and Monitoring:**

```bash
# View process status
pm2 status

# Real-time monitoring dashboard
pm2 monit

# Detailed process info
pm2 describe ipodhan-web

# List all processes
pm2 list

# Show process metrics
pm2 show ipodhan-web
```

**Process Management:**

```bash
# Start all applications
pm2 start ecosystem.config.js

# Restart specific app
pm2 restart ipodhan-web

# Stop specific app
pm2 stop ipodhan-web

# Reload without downtime (cluster mode only)
pm2 reload ipodhan-web

# Delete process from PM2
pm2 delete ipodhan-web
```

**Log Management:**

```bash
# View all logs
pm2 logs

# View specific app logs
pm2 logs ipodhan-web

# View last 100 lines
pm2 logs ipodhan-web --lines 100

# View only errors
pm2 logs ipodhan-web --err

# Follow logs in real-time
pm2 logs ipodhan-web --raw

# Clear all logs
pm2 flush
```

### PM2 Metrics

**Built-in Metrics (free):**

- **CPU Usage:** Percentage per process
- **Memory Usage:** MB per process
- **Restarts:** Count of automatic restarts
- **Status:** Online, errored, stopped
- **Uptime:** Time since last restart

**View metrics:**

```bash
# Text-based dashboard
pm2 monit

# JSON output
pm2 jlist

# Pretty JSON
pm2 prettylist
```

### PM2 Web Dashboard (Optional)

**Option 1: pm2-server-monit (Free)**

```bash
# Install module
pm2 install pm2-server-monit

# Access dashboard
# http://localhost:3002
```

**Option 2: PM2 Plus (Paid)**

PM2 Plus provides cloud-based monitoring with:
- Web dashboard
- Historical metrics
- Custom alerts
- Team collaboration

**Pricing:** Starts at $16/month for 4 servers

**Not required for IPODhan** - Built-in PM2 monitoring is sufficient.

### Memory Monitoring

**Check memory usage:**

```bash
# PM2 status with memory
pm2 status

# Detailed memory info
pm2 describe ipodhan-web | grep memory
```

**Memory limits (configured in ecosystem.config.js):**

- **ipodhan-web:** 500MB max (auto-restart if exceeded)
- **ipodhan-scraper:** 300MB max (auto-restart if exceeded)

**Memory alert (manual script):**

```bash
# Create monitoring script
cat > check-memory.sh << 'EOF'
#!/bin/bash
THRESHOLD=400  # MB
CURRENT=$(pm2 jlist | jq '.[0].monit.memory / 1024 / 1024')
if (( $(echo "$CURRENT > $THRESHOLD" | bc -l) )); then
  echo "WARNING: Memory usage is ${CURRENT}MB (threshold: ${THRESHOLD}MB)"
  # Add email/SMS notification here
fi
EOF

chmod +x check-memory.sh

# Run manually or add to cron
./check-memory.sh
```

---

## Scraper Monitoring

### Scraper Log Database

**Table:** `scraper_logs`

**Schema:**

```typescript
{
  id: uuid (primary key),
  source: text (NSE | BSE | API_FALLBACK | MONEYCONTROL | CHITTORGARH),
  status: text (SUCCESS | FAILURE | PARTIAL),
  recordsProcessed: integer,
  recordsFailed: integer,
  durationMs: integer,
  errorMessage: text (nullable),
  errorStack: text (nullable),
  createdAt: timestamp
}
```

### ScraperLogRepository

**Location:** `web/lib/repositories/scraper-log-repository.ts`

**Already implemented with methods:**

- `create(log)` - Create new scraper log
- `getRecentLogs(source, hours)` - Get logs from last N hours
- `findAll(filters, pagination)` - Query logs with filters
- `getMetrics(source, startDate, endDate)` - Get aggregated metrics
- `getLastRun(source)` - Get most recent log
- `getLastSuccess(source)` - Get most recent successful run
- `getLastFailure(source)` - Get most recent failure
- `cleanupOldLogs(days)` - Delete old logs

### Monitoring Scraper Health

**Query recent scraper runs:**

```typescript
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ScraperLogRepository } from '@/lib/repositories/scraper-log-repository';

const db = await getDb();
const redis = getRedisClient();
const scraperLogRepo = new ScraperLogRepository(db, redis);

// Get last 24 hours of NSE scraper logs
const logs = await scraperLogRepo.getRecentLogs('NSE', 24);

// Get last successful run
const lastSuccess = await scraperLogRepo.getLastSuccess('NSE');

// Get metrics for last 7 days
const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const endDate = new Date();
const metrics = await scraperLogRepo.getMetrics('NSE', startDate, endDate);

console.log('Scraper Metrics:', {
  successCount: metrics.successCount,
  failureCount: metrics.failureCount,
  successRate: (metrics.successCount / (metrics.successCount + metrics.failureCount) * 100).toFixed(2) + '%',
  avgDuration: metrics.avgDuration + 'ms',
  totalRecords: metrics.totalRecords,
});
```

### Scraper Failure Alert (Manual Script)

**Create alert script (`check-scraper-health.ts`):**

```typescript
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ScraperLogRepository } from '@/lib/repositories/scraper-log-repository';

async function checkScraperHealth() {
  const db = await getDb();
  const redis = getRedisClient();
  const scraperLogRepo = new ScraperLogRepository(db, redis);

  // Get last 3 runs for NSE scraper
  const logs = await scraperLogRepo.getRecentLogs('NSE', 24);
  const last3 = logs.slice(0, 3);

  // Check if all 3 failed
  const allFailed = last3.every(log => log.status === 'FAILURE');

  if (allFailed && last3.length === 3) {
    console.error('ALERT: NSE scraper failed 3 consecutive times');
    // TODO: Send email/SMS notification
    // Example: sendEmail('admin@ipodhan.com', 'NSE Scraper Alert', '...');
  } else {
    console.log('Scraper health check passed');
  }
}

checkScraperHealth();
```

**Run script:**

```bash
cd web
tsx check-scraper-health.ts
```

**Schedule with cron (optional):**

```bash
# Run every 30 minutes
*/30 * * * * cd /path/to/ipodhan/web && tsx check-scraper-health.ts
```

---

## Alerting Rules

### Critical Alerts (Immediate Action Required)

| Alert | Condition | Threshold | Tool | Action |
|-------|-----------|-----------|------|--------|
| Site Down | Health check fails | 3 consecutive (15 min) | UptimeRobot | Email + SMS |
| Error Rate High | Errors per request | > 5% over 10 min | Sentry / Logs | Email |
| Scraper Failed | Consecutive failures | 3 failures | Custom Script | Email |
| Memory High | App memory usage | > 90% | PM2 / Script | Email |
| CPU High | App CPU usage | > 85% | PM2 / Script | Email |

### Warning Alerts (Monitor Closely)

| Alert | Condition | Threshold | Tool | Action |
|-------|-----------|-----------|------|--------|
| Slow Response | API p95 response time | > 1000ms | GA4 / Logs | Monitor |
| Cache Hit Rate Low | Redis cache hits | < 70% | Custom Script | Monitor |
| Database Slow | Query p95 time | > 500ms | Logs | Monitor |
| Disk Space Low | VPS disk usage | > 80% | Manual Check | Monitor |
| Restart Frequency | PM2 restarts | > 5 per hour | PM2 | Monitor |

### Alert Configuration

**UptimeRobot Alerts:**

✅ **Configured:** Site down for 15 minutes → Email alert

**Sentry Alerts (if using):**

1. Go to Sentry project → Alerts
2. Create alert rule:
   - Condition: Error rate > 5%
   - Time window: 10 minutes
   - Action: Email notification

**Custom Script Alerts:**

**Example email notification function:**

```typescript
// Use nodemailer or cloud email service
async function sendAlert(subject: string, message: string) {
  // TODO: Implement email sending
  // Options: Nodemailer, SendGrid, AWS SES, etc.
  console.error(`ALERT: ${subject}\n${message}`);
}
```

---

## Monitoring Dashboard

### Daily Monitoring Checklist

**Every Morning (5 minutes):**

- [ ] Check UptimeRobot dashboard - Site status
- [ ] Check PM2 status - All apps online?
- [ ] Check scraper logs - Recent runs successful?
- [ ] Check error logs - Any critical errors?
- [ ] Check memory usage - Below 80%?

**Commands:**

```bash
# Quick health check
curl https://ipodhan.com/api/health

# PM2 status
pm2 status

# Recent errors
pm2 logs ipodhan-web --err --lines 20

# Memory usage
pm2 list | grep -E "(MB|ipodhan)"
```

### Weekly Monitoring Checklist

**Every Monday (15 minutes):**

- [ ] Review GA4 traffic trends - Week-over-week comparison
- [ ] Check Core Web Vitals - LCP, FID, CLS within targets?
- [ ] Review scraper success rate - Above 95%?
- [ ] Check disk space - `df -h` on VPS
- [ ] Review PM2 restart count - Any abnormal restarts?
- [ ] Check log file sizes - Growing normally?

**Commands:**

```bash
# Disk space
df -h

# Log file sizes
ls -lh logs/

# PM2 restart history
pm2 list
```

### Monthly Monitoring Checklist

**First Day of Month (30 minutes):**

- [ ] Calculate uptime percentage - Target: 99.5%+
- [ ] Review GA4 monthly report - Traffic trends
- [ ] Analyze error patterns - Any recurring issues?
- [ ] Check database size - Growth rate
- [ ] Review scraper performance - Average duration, success rate
- [ ] Update this monitoring document - Any changes needed?

**Commands:**

```bash
# Database size
psql -U postgres -d ipodhan -c "
  SELECT pg_size_pretty(pg_database_size('ipodhan')) as size;
"

# Table sizes
psql -U postgres -d ipodhan -c "
  SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
"
```

---

## Incident Response

### Site Down Incident

**Symptom:** UptimeRobot alert - Site down

**Response Procedure:**

1. **Verify Issue (2 minutes):**
   ```bash
   # Try accessing site in browser
   curl https://ipodhan.com/api/health

   # Check PM2 status
   pm2 status
   ```

2. **Check Application (5 minutes):**
   ```bash
   # View recent logs
   pm2 logs ipodhan-web --lines 100 --err

   # Check if app is running
   pm2 list | grep ipodhan-web
   ```

3. **Restart Application (2 minutes):**
   ```bash
   # Restart web application
   pm2 restart ipodhan-web

   # Wait 30 seconds
   sleep 30

   # Verify health
   curl https://ipodhan.com/api/health
   ```

4. **Check Dependencies (5 minutes):**
   ```bash
   # Check PostgreSQL
   systemctl status postgresql
   # OR: service postgresql status (older systems)

   # Check Redis
   redis-cli ping

   # If either failed, restart them
   systemctl restart postgresql
   systemctl restart redis
   ```

5. **Monitor Recovery (5 minutes):**
   ```bash
   # Follow logs
   pm2 logs ipodhan-web --raw

   # Wait for UptimeRobot "Up" notification
   ```

6. **Document Incident:**
   - Time of alert
   - Root cause
   - Actions taken
   - Time to recovery

### High Error Rate Incident

**Symptom:** Sentry alert or high error count in logs

**Response Procedure:**

1. **Identify Error Pattern (5 minutes):**
   ```bash
   # View recent errors
   pm2 logs ipodhan-web --err --lines 100

   # Count error frequency
   pm2 logs ipodhan-web --err | grep -c "Error"
   ```

2. **Analyze Error Details (10 minutes):**
   - What type of errors? (API, database, Redis, etc.)
   - Which endpoint/route?
   - Consistent pattern or random?
   - Started recently or ongoing?

3. **Check Service Health (5 minutes):**
   ```bash
   # Health check
   curl https://ipodhan.com/api/health

   # Database connection
   psql -U postgres -d ipodhan -c "SELECT 1"

   # Redis connection
   redis-cli ping
   ```

4. **Apply Fix (varies):**
   - If database issue: Restart PostgreSQL
   - If Redis issue: Restart Redis
   - If code issue: Deploy hotfix
   - If external API: Wait for service recovery

5. **Monitor Error Rate (15 minutes):**
   ```bash
   # Follow logs for new errors
   pm2 logs ipodhan-web --err --raw
   ```

6. **Verify Resolution:**
   - Error rate drops below 1%
   - No errors in last 10 minutes
   - Update monitoring dashboard

### Scraper Failure Incident

**Symptom:** Multiple consecutive scraper failures

**Response Procedure:**

1. **Check Scraper Logs (5 minutes):**
   ```bash
   # View scraper logs
   pm2 logs ipodhan-scraper --lines 100

   # Check scraper status
   pm2 describe ipodhan-scraper
   ```

2. **Identify Failure Cause (10 minutes):**
   - Network error? (timeout, connection refused)
   - Parsing error? (HTML structure changed)
   - Rate limiting? (too many requests)
   - Authentication error? (API key expired)

3. **Test Scraper Manually (5 minutes):**
   ```bash
   # Run scraper manually
   cd scraper
   npm run start

   # Check output for errors
   ```

4. **Apply Fix (varies):**
   - If network: Check VPS internet connection
   - If parsing: Update scraper selectors
   - If rate limiting: Reduce scrape frequency
   - If authentication: Update API keys

5. **Restart Scraper (2 minutes):**
   ```bash
   pm2 restart ipodhan-scraper

   # Monitor first run
   pm2 logs ipodhan-scraper --raw
   ```

6. **Verify Success:**
   - Check database for new records
   - Verify scraper_logs table shows SUCCESS

### High Memory Usage Incident

**Symptom:** Memory usage > 90%

**Response Procedure:**

1. **Identify Memory Hog (5 minutes):**
   ```bash
   # PM2 memory usage
   pm2 status

   # System memory
   free -h

   # Top processes
   top -o %MEM
   ```

2. **Restart High-Memory App (2 minutes):**
   ```bash
   pm2 restart ipodhan-web
   # OR
   pm2 restart ipodhan-scraper
   ```

3. **Monitor Memory (10 minutes):**
   ```bash
   # Watch memory in real-time
   watch -n 1 'pm2 status | grep -E "(ipodhan|MB)"'
   ```

4. **If Memory Still High (10 minutes):**
   - Check for memory leaks in code
   - Review recent code changes
   - Check Redis memory usage: `redis-cli info memory`
   - Check database cache: PostgreSQL shared_buffers

5. **Temporary Fix:**
   ```bash
   # Reduce PM2 instances (if needed)
   pm2 scale ipodhan-web 1

   # Wait for memory to stabilize
   ```

6. **Long-term Fix:**
   - Code optimization
   - Increase VPS memory (upgrade plan)
   - Implement memory monitoring script

---

## Troubleshooting

### Health Check Endpoint Returns 503

**Possible Causes:**

1. **Database Connection Failed:**
   ```bash
   # Check PostgreSQL status
   systemctl status postgresql

   # Test connection
   psql -U postgres -d ipodhan -c "SELECT 1"

   # Restart if needed
   systemctl restart postgresql
   ```

2. **Redis Connection Failed:**
   ```bash
   # Check Redis status
   redis-cli ping

   # Restart if needed
   systemctl restart redis
   ```

3. **Network Issue:**
   ```bash
   # Check network connectivity
   ping 8.8.8.8

   # Check DNS
   nslookup google.com
   ```

### PM2 Shows "Errored" Status

**Possible Causes:**

1. **Application Crash:**
   ```bash
   # View error logs
   pm2 logs ipodhan-web --err --lines 50

   # Restart app
   pm2 restart ipodhan-web
   ```

2. **Port Already in Use:**
   ```bash
   # Check port usage
   netstat -tuln | grep 3001

   # Kill process on port (if needed)
   fuser -k 3001/tcp
   ```

3. **Environment Variables Missing:**
   ```bash
   # Check env vars
   pm2 env 0

   # Update ecosystem.config.js if needed
   ```

### Logs Not Appearing

**Possible Causes:**

1. **PM2 Not Capturing Logs:**
   ```bash
   # Restart PM2
   pm2 kill
   pm2 start ecosystem.config.js
   ```

2. **Log Files Full:**
   ```bash
   # Check log file sizes
   ls -lh logs/

   # Clear logs
   pm2 flush
   ```

3. **Logger Not Configured:**
   - Verify Pino logger imported in code
   - Check `web/lib/logger.ts` exists

### Scraper Not Running

**Possible Causes:**

1. **PM2 Cron Not Triggering:**
   ```bash
   # Check PM2 cron config
   pm2 describe ipodhan-scraper | grep cron

   # Manually trigger scraper
   pm2 restart ipodhan-scraper
   ```

2. **Scraper Logic Error:**
   ```bash
   # Run scraper manually
   cd scraper
   npm run start

   # Check output
   ```

3. **Database Connection Issues:**
   - Check DATABASE_URL in `.env`
   - Verify PostgreSQL is running

### GA4 Not Tracking

**Possible Causes:**

1. **Measurement ID Not Set:**
   - Check `NEXT_PUBLIC_GA_MEASUREMENT_ID` in `.env.production`
   - Verify environment variable loaded

2. **GoogleAnalytics Component Not Rendered:**
   - Check `web/app/layout.tsx` includes `<GoogleAnalytics>`
   - Verify `@next/third-parties` installed

3. **Ad Blocker:**
   - Disable ad blocker
   - Test in incognito mode

---

## Additional Resources

### Documentation

- **UptimeRobot Docs:** https://uptimerobot.com/help/
- **Sentry Docs:** https://docs.sentry.io/platforms/javascript/guides/nextjs/
- **GA4 Docs:** https://support.google.com/analytics/answer/9304153
- **Pino Docs:** https://getpino.io/
- **PM2 Docs:** https://pm2.keymetrics.io/docs/usage/quick-start/

### Support Contacts

- **Platform Owner:** [Your Name] - [your-email@example.com]
- **VPS Provider:** [VPS Provider Support]
- **Emergency Contact:** [Emergency Contact]

### Related Documents

- `docs/stories/8.4.production-deployment.story.md` - Production deployment guide
- `ecosystem.config.js` - PM2 configuration
- `web/lib/logger.ts` - Logger configuration
- `web/lib/repositories/scraper-log-repository.ts` - Scraper logging

---

## Changelog

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2025-10-16 | 1.0 | Initial monitoring runbook created | Story 8.5 Implementation |

---

**End of Monitoring & Alerting Runbook**
