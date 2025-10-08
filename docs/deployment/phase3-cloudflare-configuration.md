# Phase 3: Cloudflare Configuration Guide

**Story:** 8.4b - Production Deployment - Production Server Execution
**Purpose:** Configure Cloudflare DNS, SSL/TLS, caching, and security for ipodhan.com
**Target Domain:** ipodhan.com
**Estimated Time:** 30-45 minutes

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Cloudflare Account Setup](#cloudflare-account-setup)
3. [DNS Configuration](#dns-configuration)
4. [SSL/TLS Configuration](#ssltls-configuration)
5. [Caching Rules](#caching-rules)
6. [Security Settings](#security-settings)
7. [Verification](#verification)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Phase 2 Completion Checklist

Verify Phase 2 is complete:
- [ ] Application deployed to VPS
- [ ] PM2 apps running (ipodhan-web and ipodhan-scraper)
- [ ] Health check endpoint accessible at http://103.118.16.189:3000/api/health
- [ ] Homepage accessible at http://103.118.16.189:3000

### Requirements

- [ ] Cloudflare account (free tier is sufficient)
- [ ] Domain ipodhan.com ownership verified
- [ ] Access to domain registrar for nameserver changes
- [ ] VPS IP address: 103.118.16.189

---

## Cloudflare Account Setup

### Step 1: Create Cloudflare Account (if needed)

1. Visit https://dash.cloudflare.com/sign-up
2. Enter email and create password
3. Verify email address
4. Log in to Cloudflare dashboard

### Step 2: Add Domain to Cloudflare

1. Click "Add a Site" button
2. Enter domain: `ipodhan.com`
3. Click "Add site"
4. Select plan: **Free** (sufficient for MVP)
5. Click "Continue"

### Step 3: Review DNS Records

Cloudflare will scan existing DNS records (if any).

**Expected records:**
- May show existing records from previous DNS provider
- We'll update these in the next section

Click "Continue"

### Step 4: Update Nameservers

Cloudflare will provide two nameservers:

```
Example:
carter.ns.cloudflare.com
quinn.ns.cloudflare.com
```

**Action Required:**

1. **Log in to your domain registrar** (where you purchased ipodhan.com)
2. **Find DNS/Nameserver settings**
3. **Replace existing nameservers** with Cloudflare nameservers
4. **Save changes**

**Common Registrars:**
- GoDaddy: Domain Settings > Nameservers > Change
- Namecheap: Domain List > Manage > Nameservers > Custom DNS
- Google Domains: DNS > Name servers > Use custom name servers

**Note:** Nameserver propagation can take 2-24 hours, but typically completes in 2-6 hours.

### Step 5: Verify Nameserver Update

```powershell
# Check current nameservers
nslookup -type=NS ipodhan.com

# Expected output (after propagation):
# ipodhan.com nameserver = carter.ns.cloudflare.com
# ipodhan.com nameserver = quinn.ns.cloudflare.com
```

Wait for Cloudflare to detect the nameserver change. Cloudflare will email you when the site is active.

---

## DNS Configuration

### Step 1: Navigate to DNS Settings

1. Log in to Cloudflare dashboard
2. Select `ipodhan.com` domain
3. Click "DNS" in left sidebar
4. Click "Records" tab

### Step 2: Create A Record for Root Domain

**Add new record:**

| Field | Value |
|-------|-------|
| Type | A |
| Name | @ |
| IPv4 address | 103.118.16.189 |
| Proxy status | Proxied (orange cloud) |
| TTL | Auto |

**Click "Save"**

**Verification:**
```powershell
# Check A record
nslookup ipodhan.com

# Should eventually resolve to Cloudflare IP (not your VPS IP directly)
```

### Step 3: Create A Record for www Subdomain (Optional)

**Add new record:**

| Field | Value |
|-------|-------|
| Type | A |
| Name | www |
| IPv4 address | 103.118.16.189 |
| Proxy status | Proxied (orange cloud) |
| TTL | Auto |

**Click "Save"**

### Step 4: Create CNAME for API Subdomain (Optional)

If you want a dedicated API subdomain (api.ipodhan.com):

| Field | Value |
|-------|-------|
| Type | CNAME |
| Name | api |
| Target | ipodhan.com |
| Proxy status | Proxied (orange cloud) |
| TTL | Auto |

**Click "Save"**

### Step 5: Verify DNS Propagation

```powershell
# Check DNS propagation
nslookup ipodhan.com
nslookup www.ipodhan.com

# Use online tool for global check
# Visit: https://dnschecker.org
# Enter: ipodhan.com
```

**Wait for DNS to propagate** (5-15 minutes typically, up to 24 hours maximum)

**Verification Checklist:**
- [ ] A record for @ pointing to 103.118.16.189
- [ ] Proxy status: Proxied (orange cloud)
- [ ] www subdomain configured (if desired)
- [ ] DNS resolves globally

---

## SSL/TLS Configuration

### Step 1: Navigate to SSL/TLS Settings

1. In Cloudflare dashboard, select `ipodhan.com`
2. Click "SSL/TLS" in left sidebar
3. Click "Overview" tab

### Step 2: Set Encryption Mode

**Select encryption mode:**

```
Full (strict)
```

**Explanation:**
- **Off** - No HTTPS (insecure, not recommended)
- **Flexible** - HTTPS between users and Cloudflare, HTTP between Cloudflare and VPS (not secure)
- **Full** - HTTPS everywhere, but doesn't validate certificate
- **Full (strict)** - HTTPS everywhere with valid certificate (recommended)

**Since we're using Cloudflare's origin certificate, use "Full (strict)"**

**Click "Save"**

### Step 3: Install Cloudflare Origin Certificate on VPS

Since the app runs on port 3000 behind Cloudflare, and Cloudflare terminates SSL, we don't need to configure SSL on the VPS for production.

**However, for best practice:**

1. Go to SSL/TLS > Origin Server
2. Click "Create Certificate"
3. Use default settings:
   - Private key type: RSA (2048)
   - Certificate Validity: 15 years
   - Hostnames: ipodhan.com, *.ipodhan.com
4. Click "Create"
5. Copy the certificate and private key
6. Save to VPS (if implementing reverse proxy later)

**For MVP: Skip this step since Next.js app runs directly on port 3000 behind Cloudflare**

### Step 4: Enable Always Use HTTPS

1. Go to SSL/TLS > Edge Certificates
2. Find "Always Use HTTPS"
3. Toggle to **On**

**This will automatically redirect all HTTP requests to HTTPS**

### Step 5: Enable HSTS

**HTTP Strict Transport Security (HSTS)** forces browsers to always use HTTPS.

1. Go to SSL/TLS > Edge Certificates
2. Find "HTTP Strict Transport Security (HSTS)"
3. Click "Enable HSTS"

**Configure HSTS settings:**

| Setting | Value |
|---------|-------|
| Enable HSTS | On |
| Max Age Header | 6 months (15768000 seconds) |
| Apply HSTS policy to subdomains | Yes |
| Preload | Yes |
| No-Sniff Header | Yes |

**Click "Next" then "I understand"**

**Warning:** HSTS is a security feature that cannot be easily reversed. Ensure HTTPS is working before enabling!

### Step 6: Enable Automatic HTTPS Rewrites

1. Go to SSL/TLS > Edge Certificates
2. Find "Automatic HTTPS Rewrites"
3. Toggle to **On**

**This will automatically rewrite insecure URLs to HTTPS**

### Step 7: Enable TLS 1.3

1. Go to SSL/TLS > Edge Certificates
2. Find "Minimum TLS Version"
3. Select **TLS 1.2** (for compatibility)
4. Enable **TLS 1.3** toggle

### Step 8: Verify SSL Certificate

Wait 1-5 minutes for certificate provisioning.

```powershell
# Test HTTPS connection (after DNS propagation)
curl https://ipodhan.com/api/health
```

**Verification Checklist:**
- [ ] Encryption mode: Full (strict)
- [ ] Always Use HTTPS: Enabled
- [ ] HSTS: Enabled (Max Age: 6 months)
- [ ] Automatic HTTPS Rewrites: Enabled
- [ ] TLS 1.3: Enabled
- [ ] Certificate provisioned and valid

---

## Caching Rules

### Step 1: Navigate to Caching Configuration

1. In Cloudflare dashboard, select `ipodhan.com`
2. Click "Caching" in left sidebar
3. Click "Configuration" tab

### Step 2: Set Caching Level

**Browser Cache TTL:**
- Select: **Respect Existing Headers**

**Caching Level:**
- Select: **Standard**

**Click "Save"**

### Step 3: Create Page Rules for Static Assets

1. Click "Rules" in left sidebar
2. Click "Page Rules" tab
3. Click "Create Page Rule"

**Rule 1: Cache Static Assets**

| Field | Value |
|-------|-------|
| URL | `*ipodhan.com/_next/static/*` |
| Settings | |
| Cache Level | Cache Everything |
| Edge Cache TTL | 1 month |
| Browser Cache TTL | 1 month |

**Click "Save and Deploy"**

### Step 4: Create Page Rule for API Routes

**Rule 2: API Caching**

| Field | Value |
|-------|-------|
| URL | `*ipodhan.com/api/*` |
| Settings | |
| Cache Level | Standard |
| Browser Cache TTL | 5 minutes |

**Note:** API routes use Cache-Control headers from app, so "Standard" respects those headers.

**Click "Save and Deploy"**

### Step 5: Create Page Rule for IPO Pages

**Rule 3: IPO Pages Caching**

| Field | Value |
|-------|-------|
| URL | `*ipodhan.com/ipos/*` |
| Settings | |
| Cache Level | Cache Everything |
| Edge Cache TTL | 5 minutes |
| Browser Cache TTL | 5 minutes |

**Click "Save and Deploy"**

### Step 6: Enable Auto Minify

1. Go to Speed > Optimization
2. Find "Auto Minify"
3. Enable:
   - [x] JavaScript
   - [x] CSS
   - [x] HTML

**Click "Save"**

### Step 7: Enable Brotli Compression

1. Go to Speed > Optimization
2. Find "Brotli"
3. Toggle to **On**

**Brotli provides better compression than gzip**

### Step 8: Enable Early Hints (Optional)

1. Go to Speed > Optimization
2. Find "Early Hints"
3. Toggle to **On**

**Early Hints sends link headers before the full response**

**Verification Checklist:**
- [ ] Caching level: Standard
- [ ] Page rule for /_next/static/* created
- [ ] Page rule for /api/* created
- [ ] Page rule for /ipos/* created
- [ ] Auto Minify enabled (JS, CSS, HTML)
- [ ] Brotli enabled
- [ ] Early Hints enabled (optional)

---

## Security Settings

### Step 1: Navigate to Security Settings

1. In Cloudflare dashboard, select `ipodhan.com`
2. Click "Security" in left sidebar
3. Click "Settings" tab

### Step 2: Set Security Level

**Security Level:** Medium

**Options:**
- Essentially Off - No challenges
- Low - Challenges only most threatening visitors
- Medium - Challenges both moderate and threatening visitors (recommended)
- High - Challenges all visitors with security score <30
- I'm Under Attack! - Emergency mode

**Select "Medium" for production**

### Step 3: Verify Bot Fight Mode

1. Go to Security > Bots
2. **Bot Fight Mode** should be **On** (default for free plan)

**This helps protect against basic bot traffic**

### Step 4: Configure Firewall Rules (Optional)

For MVP, default Cloudflare protection is sufficient.

**Optional advanced rules:**

1. Go to Security > WAF
2. Click "Create rule"

**Example: Rate Limiting**

| Field | Value |
|-------|-------|
| Rule name | API Rate Limit |
| Field | URI Path |
| Operator | starts with |
| Value | /api |
| Then | Challenge |
| Rate | 100 requests per 10 minutes |

**Click "Deploy"**

### Step 5: Enable DDoS Protection

**DDoS protection is enabled by default** on Cloudflare free plan.

1. Go to Security > DDoS
2. Verify **DDoS Protection** is **On**

### Step 6: Configure Security Headers (Optional)

For enhanced security, add custom headers:

1. Go to Rules > Transform Rules
2. Click "Create rule"
3. Select "Modify Response Header"

**Example headers:**

| Header | Value |
|--------|-------|
| X-Frame-Options | SAMEORIGIN |
| X-Content-Type-Options | nosniff |
| X-XSS-Protection | 1; mode=block |
| Referrer-Policy | strict-origin-when-cross-origin |

**Note:** Next.js may already set these headers. Check to avoid duplicates.

**Verification Checklist:**
- [ ] Security level: Medium
- [ ] Bot Fight Mode: On
- [ ] DDoS protection: On (default)
- [ ] Firewall rules: Configured (if needed)
- [ ] Security headers: Configured (optional)

---

## Verification

### Step 1: Verify DNS Resolution

```powershell
# Check DNS resolves
nslookup ipodhan.com

# Check DNS globally
# Visit: https://dnschecker.org
```

**Expected:** DNS resolves to Cloudflare IP addresses

### Step 2: Verify HTTPS Access

```powershell
# Test HTTPS connection
curl https://ipodhan.com/api/health

# Should return 200 with health check response
```

**Test in browser:**
1. Open https://ipodhan.com
2. Check for green padlock icon
3. Click padlock > Certificate should show "Cloudflare Inc"

### Step 3: Verify HTTP to HTTPS Redirect

```powershell
# Test HTTP redirect
curl -I http://ipodhan.com

# Should return 301 or 308 redirect to https://
```

### Step 4: Verify Caching Headers

```powershell
# Test static asset caching
curl -I https://ipodhan.com/_next/static/chunks/main.js

# Look for headers:
# cf-cache-status: HIT (on second request)
# cache-control: max-age=2592000
```

### Step 5: Verify API Caching

```powershell
# First request
curl -I https://ipodhan.com/api/ipos

# Check headers:
# cf-cache-status: MISS or DYNAMIC

# Second request (within cache TTL)
curl -I https://ipodhan.com/api/ipos

# Check headers:
# cf-cache-status: HIT (if cached)
```

### Step 6: Test SSL Labs

1. Visit: https://www.ssllabs.com/ssltest/
2. Enter: `ipodhan.com`
3. Click "Submit"
4. Wait for test to complete (2-5 minutes)

**Target Grade: A or A+**

**Expected Results:**
- Certificate: Valid, trusted
- Protocol Support: TLS 1.2, TLS 1.3
- Key Exchange: Strong
- Cipher Strength: Strong
- HSTS: Yes

**Screenshot the results for documentation**

### Step 7: Test Complete Site Functionality

**Open browser and test:**

1. **Homepage:** https://ipodhan.com
   - [ ] Loads successfully
   - [ ] HTTPS active (green padlock)
   - [ ] No mixed content warnings

2. **IPO Listing:** https://ipodhan.com/ipos
   - [ ] Loads IPO list
   - [ ] Filters work
   - [ ] Search works

3. **IPO Detail:** https://ipodhan.com/ipos/[any-ipo-slug]
   - [ ] Detail page loads
   - [ ] All data displayed
   - [ ] No errors

4. **Tools:** https://ipodhan.com/tools/lot-calculator
   - [ ] Calculator works
   - [ ] No CORS errors

5. **API:** https://ipodhan.com/api/health
   - [ ] Returns JSON
   - [ ] Shows healthy status

### Complete Verification Script

Save as `verify-phase3.ps1`:

```powershell
# ================================================================
# IPODhan Phase 3 Verification Script
# ================================================================

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "IPODhan Phase 3 Cloudflare Verification" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$domain = "ipodhan.com"
$passed = 0
$failed = 0

# Test 1: DNS Resolution
Write-Host "1. Testing DNS resolution..." -ForegroundColor Yellow
try {
    $dns = Resolve-DnsName $domain -ErrorAction Stop
    Write-Host "   ✓ DNS resolves successfully" -ForegroundColor Green
    $passed++
} catch {
    Write-Host "   ✗ DNS resolution failed" -ForegroundColor Red
    $failed++
}

# Test 2: HTTPS Access
Write-Host "`n2. Testing HTTPS access..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "https://$domain" -UseBasicParsing -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        Write-Host "   ✓ HTTPS site accessible" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   ✗ HTTPS returned status $($response.StatusCode)" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "   ✗ HTTPS access failed: $($_.Exception.Message)" -ForegroundColor Red
    $failed++
}

# Test 3: HTTP to HTTPS Redirect
Write-Host "`n3. Testing HTTP to HTTPS redirect..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://$domain" -MaximumRedirection 0 -ErrorAction SilentlyContinue
    if ($response.StatusCode -in @(301, 302, 307, 308)) {
        Write-Host "   ✓ HTTP redirects to HTTPS" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   ✗ No redirect detected" -ForegroundColor Red
        $failed++
    }
} catch {
    # Redirect causes exception in PowerShell, check if location is HTTPS
    if ($_.Exception.Response.Headers.Location -match "https://") {
        Write-Host "   ✓ HTTP redirects to HTTPS" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   ✗ Redirect check failed" -ForegroundColor Red
        $failed++
    }
}

# Test 4: Health Check
Write-Host "`n4. Testing health check endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "https://$domain/api/health" -Method Get -ErrorAction Stop
    if ($health.status -eq "healthy") {
        Write-Host "   ✓ Health check returns healthy" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   ✗ Health check unhealthy" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "   ✗ Health check failed: $($_.Exception.Message)" -ForegroundColor Red
    $failed++
}

# Test 5: Cloudflare Headers
Write-Host "`n5. Checking Cloudflare headers..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "https://$domain" -UseBasicParsing -ErrorAction Stop
    $cfRay = $response.Headers["CF-Ray"]
    if ($cfRay) {
        Write-Host "   ✓ Cloudflare is active (CF-Ray: $cfRay)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   ✗ Cloudflare headers not found" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "   ✗ Header check failed" -ForegroundColor Red
    $failed++
}

# Test 6: SSL Certificate
Write-Host "`n6. Checking SSL certificate..." -ForegroundColor Yellow
try {
    $request = [System.Net.WebRequest]::Create("https://$domain")
    $request.Method = "HEAD"
    $response = $request.GetResponse()
    $cert = $request.ServicePoint.Certificate
    if ($cert) {
        Write-Host "   ✓ SSL certificate valid" -ForegroundColor Green
        Write-Host "   Issuer: $($cert.Issuer)" -ForegroundColor Cyan
        $passed++
    }
    $response.Close()
} catch {
    Write-Host "   ✗ SSL certificate check failed" -ForegroundColor Red
    $failed++
}

# Test 7: API Endpoint
Write-Host "`n7. Testing API endpoint..." -ForegroundColor Yellow
try {
    $api = Invoke-RestMethod -Uri "https://$domain/api/ipos" -Method Get -ErrorAction Stop
    Write-Host "   ✓ API working (returned $($api.Count) items)" -ForegroundColor Green
    $passed++
} catch {
    Write-Host "   ✗ API test failed" -ForegroundColor Red
    $failed++
}

# Summary
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Verification Results" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Passed: $passed" -ForegroundColor Green
Write-Host "Failed: $failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })

if ($failed -eq 0) {
    Write-Host "`n✓ Phase 3 Complete! Ready for Phase 4" -ForegroundColor Green
    Write-Host "`nNext: Run SSL Labs test at https://www.ssllabs.com/ssltest/" -ForegroundColor Yellow
    Write-Host "Target: A or A+ rating" -ForegroundColor Yellow
} else {
    Write-Host "`n✗ Phase 3 has issues. Fix before proceeding." -ForegroundColor Red
}
```

Run verification:

```powershell
.\verify-phase3.ps1
```

---

## Troubleshooting

### DNS Not Resolving

**Problem:** nslookup returns "Non-existent domain"

**Solution:**
```powershell
# 1. Check nameservers
nslookup -type=NS ipodhan.com

# 2. If not Cloudflare nameservers, wait for propagation
# 3. Check domain registrar settings
# 4. Verify A record exists in Cloudflare DNS
```

### SSL Certificate Not Provisioning

**Problem:** HTTPS shows "Not Secure" or certificate error

**Solution:**
1. Wait 5-10 minutes for certificate provisioning
2. Check SSL/TLS mode is "Full (strict)"
3. Verify proxy status is "Proxied" (orange cloud)
4. Clear browser cache and retry
5. Check Cloudflare SSL/TLS > Edge Certificates status

### Cloudflare Not Caching

**Problem:** cf-cache-status always shows MISS or DYNAMIC

**Solution:**
1. Check page rules are active
2. Verify URL matches page rule pattern
3. Check Cache-Control headers from app
4. Try purging cache: Caching > Configuration > Purge Everything
5. Wait a few minutes and retry

### Site Not Accessible

**Problem:** Cannot connect to https://ipodhan.com

**Solution:**
```powershell
# 1. Check DNS
nslookup ipodhan.com

# 2. Check VPS app is running
curl http://103.118.16.189:3000/api/health

# 3. Check Cloudflare status page
# Visit: https://www.cloudflarestatus.com

# 4. Check firewall on VPS
# Ensure port 80/443 open

# 5. Temporarily pause Cloudflare
# In dashboard: Overview > Pause Cloudflare on Site
# Test direct access: http://103.118.16.189:3000
# If works, issue is Cloudflare config
# If doesn't work, issue is VPS/app
```

### Mixed Content Warnings

**Problem:** Browser shows mixed content warnings

**Solution:**
1. Enable "Automatic HTTPS Rewrites" in SSL/TLS > Edge Certificates
2. Check app code for hard-coded http:// URLs
3. Update URLs to use // (protocol-relative) or https://
4. Clear browser cache

---

## Phase 3 Completion Checklist

Before proceeding to Phase 4:

- [ ] Cloudflare account created
- [ ] Domain ipodhan.com added to Cloudflare
- [ ] Nameservers updated at domain registrar
- [ ] DNS propagated (verified with nslookup)
- [ ] A record for @ pointing to 103.118.16.189
- [ ] Proxy status: Proxied (orange cloud)
- [ ] SSL/TLS mode: Full (strict)
- [ ] Always Use HTTPS: Enabled
- [ ] HSTS: Enabled with 6-month max age
- [ ] Automatic HTTPS Rewrites: Enabled
- [ ] TLS 1.3: Enabled
- [ ] SSL certificate provisioned and valid
- [ ] Page rule for static assets created
- [ ] Page rule for API routes created
- [ ] Page rule for IPO pages created
- [ ] Auto Minify: Enabled (JS, CSS, HTML)
- [ ] Brotli compression: Enabled
- [ ] Security level: Medium
- [ ] Bot Fight Mode: On
- [ ] DDoS protection: On
- [ ] Site accessible at https://ipodhan.com
- [ ] HTTP redirects to HTTPS
- [ ] Cloudflare headers present (CF-Ray)
- [ ] Caching working (cf-cache-status: HIT)
- [ ] SSL Labs test: A or A+ rating
- [ ] Verification script passed all tests

**Document configuration:**
- Cloudflare nameservers: _______________
- DNS propagation time: _______________
- SSL Labs rating: _______________
- Any issues encountered: _______________

---

**Phase 3 Complete!**

Next: [Phase 4: Verification & Testing](./phase4-verification-testing.md)

---

**Document Version:** 1.0
**Last Updated:** 2025-10-08
**Story:** 8.4b - Production Deployment
