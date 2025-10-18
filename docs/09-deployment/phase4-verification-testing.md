# Phase 4: Verification & Testing Guide

**Story:** 8.4b - Production Deployment - Production Server Execution
**Purpose:** Comprehensive verification and testing of production deployment
**Target Domain:** https://ipodhan.com
**Estimated Time:** 45-60 minutes

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Site Accessibility Testing](#site-accessibility-testing)
3. [PM2 Apps Verification](#pm2-apps-verification)
4. [Scraper Execution Verification](#scraper-execution-verification)
5. [Database & Redis Connectivity](#database--redis-connectivity)
6. [Cloudflare Caching Verification](#cloudflare-caching-verification)
7. [SSL Certificate Testing](#ssl-certificate-testing)
8. [Performance Testing](#performance-testing)
9. [Security Testing](#security-testing)
10. [Functional Testing](#functional-testing)
11. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Previous Phases Completion

Verify all previous phases are complete:
- [ ] Phase 1: VPS Environment Setup ✓
- [ ] Phase 2: Application Deployment ✓
- [ ] Phase 3: Cloudflare Configuration ✓

### Testing Tools

Ensure you have access to:
- [ ] PowerShell on VPS (for server-side tests)
- [ ] Web browser (Chrome, Firefox, or Edge)
- [ ] PowerShell on local machine (for client-side tests)
- [ ] Mobile device (for responsive testing)

---

## Site Accessibility Testing

### Test 1: Homepage Accessibility

```powershell
# Test from VPS
Write-Host "Testing homepage from VPS..." -ForegroundColor Yellow
$response = Invoke-WebRequest -Uri "https://ipodhan.com" -UseBasicParsing
Write-Host "Status: $($response.StatusCode)" -ForegroundColor Cyan

# Check content
if ($response.Content -match "IPODhan") {
    Write-Host "✓ Homepage content verified" -ForegroundColor Green
} else {
    Write-Host "✗ Homepage content missing" -ForegroundColor Red
}
```

**Manual Browser Test:**
1. Open https://ipodhan.com in browser
2. Verify:
   - [ ] Page loads within 3 seconds
   - [ ] Green padlock (HTTPS) visible
   - [ ] No console errors (F12 Developer Tools)
   - [ ] Images load correctly
   - [ ] Navigation menu works

### Test 2: IPO Listing Page

```powershell
# Test IPO listing page
Write-Host "`nTesting IPO listing page..." -ForegroundColor Yellow
$response = Invoke-WebRequest -Uri "https://ipodhan.com/ipos" -UseBasicParsing
Write-Host "Status: $($response.StatusCode)" -ForegroundColor Cyan
```

**Manual Browser Test:**
1. Navigate to https://ipodhan.com/ipos
2. Verify:
   - [ ] IPO list displays
   - [ ] Filters work (Status, Type, etc.)
   - [ ] Search functionality works
   - [ ] Pagination works (if applicable)
   - [ ] No loading errors

### Test 3: IPO Detail Page

**Manual Browser Test:**
1. Click any IPO from listing page
2. Verify URL format: https://ipodhan.com/ipos/{slug}
3. Verify:
   - [ ] IPO details load
   - [ ] All sections visible (Details, Financials, Timeline, etc.)
   - [ ] GMP data displays (if available)
   - [ ] Subscription data displays (if available)
   - [ ] Social share buttons work

### Test 4: Tools Pages

**Test Lot Calculator:**
```powershell
Write-Host "`nTesting lot calculator..." -ForegroundColor Yellow
$response = Invoke-WebRequest -Uri "https://ipodhan.com/tools/lot-calculator" -UseBasicParsing
Write-Host "Status: $($response.StatusCode)" -ForegroundColor Cyan
```

**Manual Browser Test:**
1. Navigate to https://ipodhan.com/tools/lot-calculator
2. Enter test values (e.g., price: 100, lots: 5, lot size: 150)
3. Verify calculation is correct

**Test IPO Comparison:**
1. Navigate to https://ipodhan.com/tools/compare
2. Select 2-3 IPOs
3. Verify comparison table displays correctly

**Test Registrar Directory:**
1. Navigate to https://ipodhan.com/tools/registrars
2. Verify registrar list displays
3. Test search functionality

**Test Market Holidays:**
1. Navigate to https://ipodhan.com/tools/holidays
2. Verify holiday calendar displays
3. Verify current year shows by default

### Test 5: Cross-Browser Testing

Test on multiple browsers:
- [ ] **Chrome** - Latest version
- [ ] **Firefox** - Latest version
- [ ] **Edge** - Latest version
- [ ] **Safari** - Latest version (if available)

**Test checklist for each browser:**
- [ ] Homepage loads
- [ ] IPO listing works
- [ ] IPO detail page works
- [ ] Tools work
- [ ] No console errors

### Test 6: Mobile Responsive Testing

**Test on mobile devices or browser dev tools:**

```
Chrome DevTools: F12 > Toggle device toolbar
Test devices:
- iPhone 12 Pro (390x844)
- Pixel 5 (393x851)
- iPad Air (820x1180)
```

**Verify:**
- [ ] Navigation menu collapses to hamburger
- [ ] Content fits screen width
- [ ] Buttons are tappable
- [ ] No horizontal scrolling
- [ ] Font sizes readable

---

## PM2 Apps Verification

### Test 1: Check PM2 Status

```powershell
# SSH/RDP to VPS
cd C:\inetpub\ipodhan\current

# Check PM2 status
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
- [ ] ipodhan-web: status = online
- [ ] ipodhan-scraper: 1 instance
- [ ] ipodhan-scraper: status = online
- [ ] Restart count (↺) is low (< 5)
- [ ] Memory usage < 500MB for web, < 300MB for scraper

### Test 2: Check PM2 Logs

```powershell
# View web app logs (last 100 lines)
pm2 logs ipodhan-web --lines 100 --nostream

# View scraper logs
pm2 logs ipodhan-scraper --lines 100 --nostream
```

**Verify:**
- [ ] No ERROR level messages
- [ ] No FATAL level messages
- [ ] Database connection successful
- [ ] Redis connection successful
- [ ] Server startup messages present

### Test 3: Test Auto-Restart

```powershell
# Test auto-restart by intentionally restarting app
pm2 restart ipodhan-web

# Wait a few seconds
Start-Sleep -Seconds 5

# Check status
pm2 status

# Verify app came back online
# Verify site still accessible: https://ipodhan.com
```

**Verify:**
- [ ] App restarted successfully
- [ ] Status shows "online"
- [ ] Site accessible immediately after restart
- [ ] No downtime experienced

### Test 4: Test Crash Recovery

```powershell
# Simulate crash by stopping app
pm2 stop ipodhan-web

# Wait a few seconds
Start-Sleep -Seconds 10

# Check if PM2 auto-restarted it
pm2 status

# If autorestart is working, app should be back online
# If not, manually restart
pm2 start ipodhan-web
```

**Verify:**
- [ ] App auto-restarted (or manually restarted)
- [ ] Status shows "online"
- [ ] Health check returns 200

### Test 5: Monitor Resource Usage

```powershell
# Monitor real-time resource usage
pm2 monit

# Let it run for 5 minutes
# Press Ctrl+C to exit
```

**Verify:**
- [ ] CPU usage < 50% sustained
- [ ] Memory usage stable (not continuously increasing)
- [ ] No restart loops
- [ ] Response times reasonable

### Test 6: Verify Log Rotation

```powershell
# Check log rotation configuration
pm2 conf pm2-logrotate

# Check log files
Get-ChildItem C:\inetpub\ipodhan\current\logs -Recurse | Select-Object Name, @{Name="SizeMB";Expression={[math]::Round($_.Length/1MB,2)}}, LastWriteTime
```

**Verify:**
- [ ] max_size: 10M
- [ ] retain: 7
- [ ] compress: true
- [ ] Log files exist in logs/ directory
- [ ] No single log file > 10 MB

---

## Scraper Execution Verification

### Test 1: Manual Scraper Trigger

```powershell
# Manually trigger scraper
cd C:\inetpub\ipodhan\current

pm2 restart ipodhan-scraper

# Monitor logs in real-time
pm2 logs ipodhan-scraper --lines 0
```

**Watch for:**
- [ ] "Scraper started" message
- [ ] NSE scraping messages
- [ ] BSE scraping messages
- [ ] Database insert/update messages
- [ ] "Scraper completed successfully" message
- [ ] No errors

### Test 2: Verify Scraper Schedule

```powershell
# Check PM2 configuration
pm2 show ipodhan-scraper
```

**Verify:**
- [ ] cron_restart: `0 3 * * *` (daily at 3 AM)
- [ ] Script runs at scheduled time

**Note:** Since cron runs at 3 AM, you'll need to verify this the next day or temporarily change the cron schedule for testing.

### Test 3: Check Database for Updated Data

```powershell
# Connect to database
psql -h localhost -U ipodhan_user -d ipodhan

# Check recent IPO data
SELECT name, open_date, close_date, updated_at
FROM ipos
ORDER BY updated_at DESC
LIMIT 10;

# Check recent subscription data
SELECT ipo_id, category, times_subscribed, updated_at
FROM subscriptions
ORDER BY updated_at DESC
LIMIT 10;

# Check recent GMP data
SELECT ipo_id, gmp_date, gmp_price, updated_at
FROM gmp_records
ORDER BY updated_at DESC
LIMIT 10;

# Exit
\q
```

**Verify:**
- [ ] IPO data exists
- [ ] `updated_at` timestamps are recent (within last 24 hours)
- [ ] Subscription data populated
- [ ] GMP data populated (if available)

### Test 4: Verify Cache Invalidation After Scraper

```powershell
# Check Redis cache before scraper run
redis-cli -a $(Get-Content C:\secure\ipodhan-redis-password.txt) KEYS "ipo:*"

# Run scraper
pm2 restart ipodhan-scraper

# Wait for scraper to complete (check logs)
Start-Sleep -Seconds 60

# Check if cache was invalidated/updated
redis-cli -a $(Get-Content C:\secure\ipodhan-redis-password.txt) KEYS "ipo:*"
```

**Verify:**
- [ ] Cache keys exist
- [ ] Cache is invalidated or updated after scraper run
- [ ] New data appears on website after scraper run

---

## Database & Redis Connectivity

### Test 1: Health Check Endpoint

```powershell
# Test health check
$health = Invoke-RestMethod -Uri "https://ipodhan.com/api/health" -Method Get
$health | ConvertTo-Json -Depth 5
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-08T12:34:56.789Z",
  "services": {
    "database": "healthy",
    "redis": "healthy"
  },
  "uptime": 123456
}
```

**Verify:**
- [ ] status: "healthy"
- [ ] database: "healthy"
- [ ] redis: "healthy"
- [ ] Response time < 200ms

### Test 2: Database Query Test

```powershell
# Test database via API
$ipos = Invoke-RestMethod -Uri "https://ipodhan.com/api/ipos" -Method Get

Write-Host "IPOs returned: $($ipos.Count)" -ForegroundColor Cyan
```

**Verify:**
- [ ] API returns data from database
- [ ] Response time < 500ms
- [ ] Data is current and accurate

### Test 3: Redis Caching Test

```powershell
# First request (cache MISS)
$start1 = Get-Date
$response1 = Invoke-WebRequest -Uri "https://ipodhan.com/api/ipos" -UseBasicParsing
$duration1 = (Get-Date) - $start1

# Second request (cache HIT)
$start2 = Get-Date
$response2 = Invoke-WebRequest -Uri "https://ipodhan.com/api/ipos" -UseBasicParsing
$duration2 = (Get-Date) - $start2

Write-Host "First request: $($duration1.TotalMilliseconds) ms" -ForegroundColor Cyan
Write-Host "Second request: $($duration2.TotalMilliseconds) ms" -ForegroundColor Cyan

if ($duration2.TotalMilliseconds -lt $duration1.TotalMilliseconds) {
    Write-Host "✓ Caching is working (second request faster)" -ForegroundColor Green
} else {
    Write-Host "⚠ Caching may not be working optimally" -ForegroundColor Yellow
}
```

### Test 4: Redis Cache Keys

```powershell
# On VPS, check Redis cache keys
redis-cli -a $(Get-Content C:\secure\ipodhan-redis-password.txt) KEYS "*"

# Expected keys:
# - ipo:list:*
# - ipo:detail:*
# - sectors:list
# - registrars:list
# - market-holidays:*
```

**Verify:**
- [ ] Cache keys exist
- [ ] Keys follow expected naming pattern
- [ ] TTLs are set correctly

### Test 5: Database Connection Pool

```powershell
# Check database connections
psql -h localhost -U postgres -d ipodhan -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'ipodhan';"
```

**Verify:**
- [ ] Active connections < 20 (configured max)
- [ ] No idle connections in transaction

---

## Cloudflare Caching Verification

### Test 1: Static Assets Caching

```powershell
# Test static asset (first request)
$headers1 = Invoke-WebRequest -Uri "https://ipodhan.com/_next/static/chunks/main.js" -Method Head
Write-Host "CF-Cache-Status: $($headers1.Headers['CF-Cache-Status'])" -ForegroundColor Cyan
Write-Host "Cache-Control: $($headers1.Headers['Cache-Control'])" -ForegroundColor Cyan

# Wait a moment
Start-Sleep -Seconds 2

# Test again (second request - should be HIT)
$headers2 = Invoke-WebRequest -Uri "https://ipodhan.com/_next/static/chunks/main.js" -Method Head
Write-Host "CF-Cache-Status: $($headers2.Headers['CF-Cache-Status'])" -ForegroundColor Cyan
```

**Verify:**
- [ ] First request: cf-cache-status = MISS or DYNAMIC
- [ ] Second request: cf-cache-status = HIT
- [ ] cache-control header present
- [ ] Edge Cache TTL = 1 month

### Test 2: API Caching Behavior

```powershell
# Test API endpoint headers
$apiHeaders = Invoke-WebRequest -Uri "https://ipodhan.com/api/ipos" -Method Head
Write-Host "CF-Cache-Status: $($apiHeaders.Headers['CF-Cache-Status'])" -ForegroundColor Cyan
Write-Host "Cache-Control: $($apiHeaders.Headers['Cache-Control'])" -ForegroundColor Cyan
```

**Verify:**
- [ ] cf-cache-status = DYNAMIC or HIT (depending on cache-control)
- [ ] Respects app's cache-control headers

### Test 3: Purge Cache Test

**In Cloudflare Dashboard:**
1. Go to Caching > Configuration
2. Click "Purge Everything"
3. Confirm purge

**Test cache rebuild:**
```powershell
# Request should be MISS after purge
$response = Invoke-WebRequest -Uri "https://ipodhan.com" -Method Head
Write-Host "CF-Cache-Status after purge: $($response.Headers['CF-Cache-Status'])" -ForegroundColor Cyan
```

**Verify:**
- [ ] Cache status changes to MISS after purge
- [ ] Cache rebuilds on subsequent requests

### Test 4: Verify Compression

```powershell
# Check if Brotli compression is active
$response = Invoke-WebRequest -Uri "https://ipodhan.com" -Method Head
Write-Host "Content-Encoding: $($response.Headers['Content-Encoding'])" -ForegroundColor Cyan
```

**Verify:**
- [ ] content-encoding: br (Brotli) or gzip
- [ ] Response size is compressed

---

## SSL Certificate Testing

### Test 1: SSL Labs Test

1. Visit: https://www.ssllabs.com/ssltest/
2. Enter: `ipodhan.com`
3. Click "Submit"
4. Wait 2-5 minutes for test to complete

**Target Grade: A or A+**

**Screenshot the results**

**Verify:**
- [ ] Overall Rating: A or A+
- [ ] Certificate: Valid, not expired
- [ ] Certificate Chain: Complete
- [ ] Protocol Support: TLS 1.2, TLS 1.3
- [ ] Cipher Suites: Strong, no weak ciphers
- [ ] Forward Secrecy: Yes
- [ ] HSTS: Yes (max-age >= 15768000)
- [ ] HTTP -> HTTPS redirect: Yes

### Test 2: Certificate Details

```powershell
# Check certificate issuer
$request = [System.Net.WebRequest]::Create("https://ipodhan.com")
$request.Method = "HEAD"
$response = $request.GetResponse()
$cert = $request.ServicePoint.Certificate

Write-Host "Issuer: $($cert.Issuer)" -ForegroundColor Cyan
Write-Host "Subject: $($cert.Subject)" -ForegroundColor Cyan
Write-Host "Valid From: $($cert.GetEffectiveDateString())" -ForegroundColor Cyan
Write-Host "Valid To: $($cert.GetExpirationDateString())" -ForegroundColor Cyan

$response.Close()
```

**Verify:**
- [ ] Issuer: Cloudflare
- [ ] Subject: ipodhan.com
- [ ] Certificate not expired
- [ ] Valid for at least 3 months

### Test 3: HSTS Header

```powershell
# Check HSTS header
$response = Invoke-WebRequest -Uri "https://ipodhan.com" -Method Head
Write-Host "Strict-Transport-Security: $($response.Headers['Strict-Transport-Security'])" -ForegroundColor Cyan
```

**Verify:**
- [ ] Header present
- [ ] max-age >= 15768000 (6 months)
- [ ] includeSubDomains present
- [ ] preload present

### Test 4: Mixed Content Check

**Manual Browser Test:**
1. Open https://ipodhan.com
2. Open Developer Tools (F12)
3. Go to Console tab
4. Look for mixed content warnings

**Verify:**
- [ ] No mixed content warnings
- [ ] All resources loaded via HTTPS
- [ ] No insecure requests

---

## Performance Testing

### Test 1: Lighthouse Test

**Chrome DevTools:**
1. Open https://ipodhan.com
2. F12 > Lighthouse tab
3. Select:
   - Mode: Navigation
   - Device: Desktop
   - Categories: Performance, Best Practices, SEO, Accessibility
4. Click "Analyze page load"

**Target Scores:**
- Performance: > 90
- Best Practices: > 90
- SEO: > 90
- Accessibility: > 90

**Verify Core Web Vitals:**
- [ ] LCP (Largest Contentful Paint): < 2.5s
- [ ] FID (First Input Delay): < 100ms
- [ ] CLS (Cumulative Layout Shift): < 0.1

### Test 2: API Response Times

```powershell
# Test multiple API endpoints
$endpoints = @(
    "https://ipodhan.com/api/health",
    "https://ipodhan.com/api/ipos",
    "https://ipodhan.com/api/sectors",
    "https://ipodhan.com/api/registrars"
)

foreach ($endpoint in $endpoints) {
    $start = Get-Date
    $response = Invoke-WebRequest -Uri $endpoint -UseBasicParsing
    $duration = (Get-Date) - $start

    Write-Host "$endpoint : $($duration.TotalMilliseconds) ms" -ForegroundColor Cyan
}
```

**Target Response Times:**
- [ ] /api/health: < 200ms
- [ ] /api/ipos: < 500ms (uncached), < 100ms (cached)
- [ ] /api/sectors: < 300ms
- [ ] /api/registrars: < 300ms

### Test 3: Load Time Test

```powershell
# Measure full page load time
Measure-Command {
    Invoke-WebRequest -Uri "https://ipodhan.com" -UseBasicParsing
}
```

**Target:**
- [ ] Homepage load: < 2 seconds
- [ ] IPO listing: < 2.5 seconds
- [ ] IPO detail: < 2.5 seconds

---

## Security Testing

### Test 1: Security Headers

```powershell
# Check security headers
$response = Invoke-WebRequest -Uri "https://ipodhan.com" -Method Head

Write-Host "Security Headers:" -ForegroundColor Yellow
Write-Host "X-Frame-Options: $($response.Headers['X-Frame-Options'])" -ForegroundColor Cyan
Write-Host "X-Content-Type-Options: $($response.Headers['X-Content-Type-Options'])" -ForegroundColor Cyan
Write-Host "X-XSS-Protection: $($response.Headers['X-XSS-Protection'])" -ForegroundColor Cyan
Write-Host "Strict-Transport-Security: $($response.Headers['Strict-Transport-Security'])" -ForegroundColor Cyan
```

**Verify:**
- [ ] X-Frame-Options: DENY or SAMEORIGIN
- [ ] X-Content-Type-Options: nosniff
- [ ] Strict-Transport-Security: present with long max-age

### Test 2: Exposed Secrets Test

```powershell
# Test .env files are not accessible
try {
    $response = Invoke-WebRequest -Uri "https://ipodhan.com/.env" -UseBasicParsing
    Write-Host "✗ .env file is accessible!" -ForegroundColor Red
} catch {
    Write-Host "✓ .env file is not accessible" -ForegroundColor Green
}

# Test .env.production is not accessible
try {
    $response = Invoke-WebRequest -Uri "https://ipodhan.com/.env.production" -UseBasicParsing
    Write-Host "✗ .env.production file is accessible!" -ForegroundColor Red
} catch {
    Write-Host "✓ .env.production file is not accessible" -ForegroundColor Green
}
```

### Test 3: SQL Injection Test

```powershell
# Test basic SQL injection protection on search
$sqlInjection = "'; DROP TABLE ipos; --"
$encodedPayload = [System.Web.HttpUtility]::UrlEncode($sqlInjection)

try {
    $response = Invoke-RestMethod -Uri "https://ipodhan.com/api/ipos?search=$encodedPayload" -Method Get
    Write-Host "✓ API handled SQL injection attempt safely" -ForegroundColor Green
} catch {
    Write-Host "API returned error (expected for malformed input)" -ForegroundColor Yellow
}
```

**Verify:**
- [ ] API returns safe response or error
- [ ] No database errors exposed
- [ ] Database still intact

---

## Functional Testing

### Complete Functional Test Suite

Save as `functional-tests.ps1`:

```powershell
# ================================================================
# IPODhan Functional Test Suite
# ================================================================

$domain = "https://ipodhan.com"
$passed = 0
$failed = 0
$warnings = 0

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "IPODhan Functional Test Suite" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Test 1: Homepage
Write-Host "1. Testing Homepage..." -ForegroundColor Yellow
try {
    $home = Invoke-WebRequest -Uri "$domain" -UseBasicParsing
    if ($home.StatusCode -eq 200 -and $home.Content -match "IPODhan") {
        Write-Host "   ✓ Homepage loads successfully" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   ✗ Homepage content verification failed" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "   ✗ Homepage failed: $($_.Exception.Message)" -ForegroundColor Red
    $failed++
}

# Test 2: IPO Listing
Write-Host "`n2. Testing IPO Listing..." -ForegroundColor Yellow
try {
    $ipos = Invoke-RestMethod -Uri "$domain/api/ipos" -Method Get
    if ($ipos.Count -gt 0) {
        Write-Host "   ✓ IPO API returns data ($($ipos.Count) items)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   ⚠ IPO API returns no data" -ForegroundColor Yellow
        $warnings++
    }
} catch {
    Write-Host "   ✗ IPO API failed" -ForegroundColor Red
    $failed++
}

# Test 3: Health Check
Write-Host "`n3. Testing Health Check..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$domain/api/health" -Method Get
    if ($health.status -eq "healthy" -and $health.services.database -eq "healthy" -and $health.services.redis -eq "healthy") {
        Write-Host "   ✓ Health check: All services healthy" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   ✗ Health check: Some services unhealthy" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "   ✗ Health check failed" -ForegroundColor Red
    $failed++
}

# Test 4: Sectors API
Write-Host "`n4. Testing Sectors API..." -ForegroundColor Yellow
try {
    $sectors = Invoke-RestMethod -Uri "$domain/api/sectors" -Method Get
    if ($sectors.Count -gt 0) {
        Write-Host "   ✓ Sectors API returns data ($($sectors.Count) items)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   ⚠ Sectors API returns no data" -ForegroundColor Yellow
        $warnings++
    }
} catch {
    Write-Host "   ✗ Sectors API failed" -ForegroundColor Red
    $failed++
}

# Test 5: Registrars API
Write-Host "`n5. Testing Registrars API..." -ForegroundColor Yellow
try {
    $registrars = Invoke-RestMethod -Uri "$domain/api/registrars" -Method Get
    if ($registrars.Count -gt 0) {
        Write-Host "   ✓ Registrars API returns data ($($registrars.Count) items)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   ⚠ Registrars API returns no data" -ForegroundColor Yellow
        $warnings++
    }
} catch {
    Write-Host "   ✗ Registrars API failed" -ForegroundColor Red
    $failed++
}

# Test 6: Market Holidays API
Write-Host "`n6. Testing Market Holidays API..." -ForegroundColor Yellow
try {
    $holidays = Invoke-RestMethod -Uri "$domain/api/market-holidays" -Method Get
    if ($holidays.Count -gt 0) {
        Write-Host "   ✓ Market Holidays API returns data ($($holidays.Count) items)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   ⚠ Market Holidays API returns no data" -ForegroundColor Yellow
        $warnings++
    }
} catch {
    Write-Host "   ✗ Market Holidays API failed" -ForegroundColor Red
    $failed++
}

# Test 7: HTTPS Redirect
Write-Host "`n7. Testing HTTP to HTTPS Redirect..." -ForegroundColor Yellow
try {
    $httpResponse = Invoke-WebRequest -Uri "http://ipodhan.com" -MaximumRedirection 0 -ErrorAction SilentlyContinue
    if ($httpResponse.StatusCode -in @(301, 302, 307, 308)) {
        Write-Host "   ✓ HTTP redirects to HTTPS" -ForegroundColor Green
        $passed++
    }
} catch {
    if ($_.Exception.Response.ResponseUri.Scheme -eq "https") {
        Write-Host "   ✓ HTTP redirects to HTTPS" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   ✗ HTTP redirect failed" -ForegroundColor Red
        $failed++
    }
}

# Test 8: Cloudflare Active
Write-Host "`n8. Testing Cloudflare Integration..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$domain" -UseBasicParsing
    $cfRay = $response.Headers["CF-Ray"]
    if ($cfRay) {
        Write-Host "   ✓ Cloudflare is active (CF-Ray: $cfRay)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   ⚠ Cloudflare headers not found" -ForegroundColor Yellow
        $warnings++
    }
} catch {
    Write-Host "   ✗ Cloudflare check failed" -ForegroundColor Red
    $failed++
}

# Summary
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Test Results Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Passed: $passed" -ForegroundColor Green
Write-Host "Failed: $failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host "Warnings: $warnings" -ForegroundColor Yellow

if ($failed -eq 0 -and $warnings -eq 0) {
    Write-Host "`n✓ All tests passed! Phase 4 complete." -ForegroundColor Green
} elseif ($failed -eq 0) {
    Write-Host "`n⚠ All critical tests passed with warnings." -ForegroundColor Yellow
} else {
    Write-Host "`n✗ Some tests failed. Review and fix issues." -ForegroundColor Red
}
```

Run the test suite:

```powershell
.\functional-tests.ps1
```

---

## Troubleshooting

### Site Not Loading

**Problem:** Site returns 502 or 503 errors

**Solution:**
1. Check PM2 apps are running: `pm2 status`
2. Check PM2 logs for errors: `pm2 logs`
3. Verify database connection: `psql -h localhost -U ipodhan_user -d ipodhan`
4. Verify Redis connection: `redis-cli ping`
5. Restart apps if needed: `pm2 restart all`

### Slow Response Times

**Problem:** API responses > 1 second

**Solution:**
1. Check Redis caching is working
2. Check database query performance
3. Monitor PM2 resource usage: `pm2 monit`
4. Check Cloudflare caching headers
5. Review slow query logs

### SSL Certificate Issues

**Problem:** Browser shows "Not Secure" warning

**Solution:**
1. Wait 5-10 minutes for certificate provisioning
2. Check SSL/TLS mode: Full (strict)
3. Verify DNS is proxied (orange cloud)
4. Clear browser cache
5. Check Cloudflare SSL/TLS status

---

## Phase 4 Completion Checklist

- [ ] Homepage accessible and loads within 3 seconds
- [ ] IPO listing page works correctly
- [ ] IPO detail pages display all information
- [ ] All tools pages functional
- [ ] Cross-browser testing passed (Chrome, Firefox, Edge)
- [ ] Mobile responsive testing passed
- [ ] PM2 apps running with status "online"
- [ ] PM2 restart count low (< 5)
- [ ] PM2 logs show no errors
- [ ] Auto-restart verified
- [ ] Log rotation working
- [ ] Scraper executed successfully
- [ ] Database updated with recent data
- [ ] Health check returns healthy for all services
- [ ] Database queries return correct data
- [ ] Redis caching verified (second request faster)
- [ ] Cloudflare caching headers present (cf-cache-status)
- [ ] Static assets cached (cache status: HIT)
- [ ] SSL Labs test: A or A+ rating
- [ ] HSTS header present
- [ ] No mixed content warnings
- [ ] Lighthouse performance score > 90
- [ ] API response times < 500ms
- [ ] Security headers present
- [ ] No secrets exposed (.env files)
- [ ] Functional test suite passed all tests

**Document test results:**
- SSL Labs rating: _______________
- Lighthouse performance score: _______________
- API average response time: _______________
- Any issues encountered: _______________

---

**Phase 4 Complete!**

Next: [Phase 5: Rollback Testing](./phase5-rollback-testing.md)

---

**Document Version:** 1.0
**Last Updated:** 2025-10-08
**Story:** 8.4b - Production Deployment
