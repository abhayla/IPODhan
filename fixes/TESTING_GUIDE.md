# Security Fixes Testing Guide

This document provides step-by-step instructions to verify all security fixes implemented in Phase 5.

---

## Prerequisites

- Development server running on http://localhost:3009 (or your configured port)
- `curl` command available (Git Bash on Windows, native on Linux/Mac)
- ADMIN_API_TOKEN from `.env.local` file

---

## Test 1: Security Headers

**Objective:** Verify all 6 security headers are present on every response

### Command:
```bash
curl -I http://localhost:3009/
```

### Expected Output:
```
HTTP/1.1 200 OK
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://www.google-analytics.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
permissions-policy: geolocation=(), microphone=(), camera=(), payment=()
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
x-frame-options: DENY
x-xss-protection: 1; mode=block
```

### Verification Checklist:
- [ ] X-Content-Type-Options: nosniff
- [ ] X-Frame-Options: DENY
- [ ] X-XSS-Protection: 1; mode=block
- [ ] Referrer-Policy: strict-origin-when-cross-origin
- [ ] Content-Security-Policy: (present with multiple directives)
- [ ] Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=()

**Note:** Strict-Transport-Security header only appears in production (HTTPS)

---

## Test 2: Admin Authentication - No Token

**Objective:** Verify admin endpoints reject requests without authentication

### Test 2.1: Scraper Logs Endpoint
```bash
curl -s http://localhost:3009/api/admin/scraper/logs
```

**Expected Output:**
```json
{
  "error": "Unauthorized",
  "message": "Admin authentication required. Include \"Authorization: Bearer <token>\" header.",
  "timestamp": "2025-10-21T12:29:39.878Z"
}
```

### Test 2.2: Scraper Status Endpoint
```bash
curl -s http://localhost:3009/api/admin/scraper/status
```

**Expected:** Same 401 Unauthorized response

### Test 2.3: DB Test Endpoint
```bash
curl -s http://localhost:3009/api/db-test
```

**Expected:** Same 401 Unauthorized response

### Verification Checklist:
- [ ] /api/admin/scraper/logs returns 401
- [ ] /api/admin/scraper/status returns 401
- [ ] /api/db-test returns 401
- [ ] Error message includes "Admin authentication required"

---

## Test 3: Admin Authentication - Invalid Token

**Objective:** Verify admin endpoints reject invalid tokens

### Command:
```bash
curl -s -H "Authorization: Bearer invalid_token_12345" http://localhost:3009/api/admin/scraper/logs
```

**Expected Output:**
```json
{
  "error": "Unauthorized",
  "message": "Invalid admin token",
  "timestamp": "2025-10-21T12:30:32.531Z"
}
```

### Verification Checklist:
- [ ] Returns 401 Unauthorized
- [ ] Error message: "Invalid admin token"
- [ ] Includes timestamp

---

## Test 4: Admin Authentication - Valid Token

**Objective:** Verify admin endpoints accept valid tokens

**Get Token:**
1. Open `web/.env.local`
2. Copy the value of `ADMIN_API_TOKEN`
3. Use in commands below (replace `<YOUR_TOKEN>`)

### Test 4.1: Scraper Logs Endpoint
```bash
curl -s -H "Authorization: Bearer <YOUR_TOKEN>" "http://localhost:3009/api/admin/scraper/logs?limit=2"
```

**Expected Output:**
```json
{
  "data": [
    {
      "id": "...",
      "source": "NSE",
      "status": "SUCCESS",
      "recordsProcessed": 0,
      "recordsFailed": 1,
      "durationMs": 469
    }
  ],
  "meta": {
    "page": 1,
    "limit": 2,
    "total": 214,
    "totalPages": 107,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### Test 4.2: Scraper Status Endpoint
```bash
curl -s -H "Authorization: Bearer <YOUR_TOKEN>" http://localhost:3009/api/admin/scraper/status
```

**Expected:** JSON response with NSE, BSE, API_FALLBACK status

### Test 4.3: DB Test Endpoint
```bash
curl -s -H "Authorization: Bearer <YOUR_TOKEN>" http://localhost:3009/api/db-test
```

**Expected Output:**
```json
{
  "success": true,
  "message": "Database connection successful",
  "version": "PostgreSQL 16.8, compiled by Visual C++ build 1942, 64-bit",
  "timestamp": "2025-10-21T12:30:09.280Z"
}
```

### Verification Checklist:
- [ ] /api/admin/scraper/logs returns 200 with data
- [ ] /api/admin/scraper/status returns 200 with health data
- [ ] /api/db-test returns 200 with PostgreSQL version
- [ ] All responses include valid JSON data

---

## Test 5: CORS Policy

**Objective:** Verify CORS headers are present on API endpoints

### Command:
```bash
curl -I -X OPTIONS http://localhost:3009/api/ipos -H "Origin: http://localhost:3009"
```

**Expected Output:**
```
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://localhost:3000
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Max-Age: 86400
```

### Verification Checklist:
- [ ] Access-Control-Allow-Origin: http://localhost:3000 (or NEXT_PUBLIC_APP_URL)
- [ ] Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
- [ ] Access-Control-Allow-Headers: Content-Type, Authorization
- [ ] Access-Control-Max-Age: 86400 (24 hours)

---

## Test 6: Environment Configuration

**Objective:** Verify environment variables are correctly configured

### Check .env.local
```bash
cat web/.env.local | grep ADMIN_API_TOKEN
```

**Expected Output:**
```
ADMIN_API_TOKEN=9e39a8265e82538657781f4815a74f6e893aac0f151e281135cb681fbd40cacd
```

### Verification Checklist:
- [ ] ADMIN_API_TOKEN exists in .env.local
- [ ] Token is ≥32 characters (64 recommended)
- [ ] Token is hexadecimal (0-9, a-f)

### Check .env.example
```bash
cat web/.env.example | grep ADMIN_API_TOKEN
```

**Expected:** Documentation section with token generation instructions

### Verification Checklist:
- [ ] ADMIN_API_TOKEN documented in .env.example
- [ ] Includes generation command
- [ ] Includes usage instructions

---

## Test 7: Middleware Files

**Objective:** Verify security middleware and auth utilities exist

### Check Middleware
```bash
ls -la web/middleware.ts
```

**Expected:** File exists (~86 lines)

### Check Auth Utility
```bash
ls -la web/lib/auth/admin-auth.ts
```

**Expected:** File exists (~165 lines)

### Verification Checklist:
- [ ] web/middleware.ts exists
- [ ] web/lib/auth/admin-auth.ts exists
- [ ] Both files have recent modification dates

---

## Test 8: Protected Endpoints

**Objective:** Verify all admin endpoints have authentication checks

### Check Scraper Logs Route
```bash
grep -n "requireAdminAuth" web/app/api/admin/scraper/logs/route.ts
```

**Expected:** Line number with `requireAdminAuth()` call

### Check Scraper Status Route
```bash
grep -n "requireAdminAuth" web/app/api/admin/scraper/status/route.ts
```

**Expected:** Line number with `requireAdminAuth()` call

### Check DB Test Route
```bash
grep -n "requireAdminAuth" web/app/api/db-test/route.ts
```

**Expected:** Line number with `requireAdminAuth()` call

### Verification Checklist:
- [ ] All 3 admin endpoints import requireAdminAuth
- [ ] All 3 admin endpoints call requireAdminAuth() at start of GET handler
- [ ] JSDoc comments document authentication requirement

---

## Test 9: Next.js Configuration

**Objective:** Verify CORS configuration in Next.js config

### Check Configuration
```bash
grep -A 15 "CORS for API endpoints" web/next.config.ts
```

**Expected Output:**
```typescript
// CORS for API endpoints
{
  source: '/api/:path*',
  headers: [
    {
      key: 'Access-Control-Allow-Origin',
      value: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    },
    {
      key: 'Access-Control-Allow-Methods',
      value: 'GET, POST, PUT, DELETE, OPTIONS',
    },
    {
      key: 'Access-Control-Allow-Headers',
      value: 'Content-Type, Authorization',
    },
    {
      key: 'Access-Control-Max-Age',
      value: '86400',
    },
  ],
}
```

### Verification Checklist:
- [ ] CORS configuration exists in next.config.ts
- [ ] Pattern: /api/:path*
- [ ] All 4 CORS headers configured
- [ ] Origin uses NEXT_PUBLIC_APP_URL environment variable

---

## Test Summary

**Total Tests:** 9 test categories
**Total Checks:** 40+ individual verification points

### Success Criteria:
- ✅ All security headers present
- ✅ Admin endpoints require authentication
- ✅ Invalid tokens rejected
- ✅ Valid tokens accepted
- ✅ CORS configured correctly
- ✅ Environment variables set
- ✅ All files created/modified

### Security Grade:
- **Before:** B+ (Good)
- **After:** A (Excellent)

---

## Troubleshooting

### Issue: Security headers not present
**Solution:** Restart Next.js dev server
```bash
cd web && npm run dev
```

### Issue: 401 Unauthorized with valid token
**Solution:** Check token in .env.local matches token in request
```bash
grep ADMIN_API_TOKEN web/.env.local
```

### Issue: CORS headers not present
**Solution:** Verify request is to /api/* endpoint
```bash
curl -I http://localhost:3009/api/ipos
```

### Issue: Development server not starting
**Solution:** Check if port is already in use
```bash
netstat -ano | findstr :3009
```

---

## Production Deployment Checklist

Before deploying to production:

- [ ] Generate new ADMIN_API_TOKEN (don't reuse development token)
- [ ] Set NEXT_PUBLIC_APP_URL to production domain
- [ ] Verify security headers on production
- [ ] Test admin authentication on production
- [ ] Verify CORS policy on production
- [ ] Set up monitoring for authentication failures
- [ ] Document token in secure location (password manager)
- [ ] Train team on admin access procedures

**Token Generation (Production):**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save output to production `.env` file:
```bash
ADMIN_API_TOKEN=<generated_token>
NEXT_PUBLIC_APP_URL=https://ipodhan.com
```

---

## Quick Test Script

For rapid testing, run all tests in sequence:

```bash
#!/bin/bash
# Quick security test (Linux/Mac/Git Bash)

BASE_URL="http://localhost:3009"
TOKEN="your_token_here"

echo "Testing security headers..."
curl -I "$BASE_URL/" | grep -E "x-frame-options|x-content-type-options"

echo -e "\nTesting admin auth (no token)..."
curl -s "$BASE_URL/api/admin/scraper/logs" | grep "Unauthorized"

echo -e "\nTesting admin auth (valid token)..."
curl -s -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/admin/scraper/logs?limit=1" | grep "data"

echo -e "\nTesting CORS..."
curl -I -X OPTIONS "$BASE_URL/api/ipos" | grep "Access-Control"

echo -e "\nAll tests complete!"
```

---

**For detailed implementation information, see:** `fixes/security-fixes.md`
**For automated testing, see:** `scripts/verify-security-fixes.sh` (Linux/Mac) or `scripts/verify-security-fixes.ps1` (Windows)
