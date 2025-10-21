#!/bin/bash

################################################################################
# Security Fixes Verification Script
#
# This script validates all security fixes implemented in Phase 5
# Tests security headers, admin authentication, and CORS policy
#
# Usage:
#   chmod +x scripts/verify-security-fixes.sh
#   ./scripts/verify-security-fixes.sh [BASE_URL] [ADMIN_TOKEN]
#
# Examples:
#   ./scripts/verify-security-fixes.sh http://localhost:3009
#   ./scripts/verify-security-fixes.sh https://ipodhan.com <token>
#
################################################################################

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${1:-http://localhost:3009}"
ADMIN_TOKEN="${2}"
PASS_COUNT=0
FAIL_COUNT=0

# Print header
echo "=================================="
echo "Security Fixes Verification Script"
echo "=================================="
echo "Base URL: $BASE_URL"
echo "Date: $(date)"
echo ""

################################################################################
# Helper Functions
################################################################################

pass() {
    echo -e "${GREEN}✓ PASS${NC} - $1"
    ((PASS_COUNT++))
}

fail() {
    echo -e "${RED}✗ FAIL${NC} - $1"
    echo -e "  ${YELLOW}Expected:${NC} $2"
    echo -e "  ${YELLOW}Got:${NC} $3"
    ((FAIL_COUNT++))
}

info() {
    echo -e "${BLUE}ℹ INFO${NC} - $1"
}

section() {
    echo ""
    echo "=================================="
    echo "$1"
    echo "=================================="
}

################################################################################
# Test 1: Security Headers
################################################################################

section "Test 1: Security Headers"

HEADERS=$(curl -s -I "$BASE_URL/" 2>&1)

# Test X-Content-Type-Options
if echo "$HEADERS" | grep -iq "x-content-type-options: nosniff"; then
    pass "X-Content-Type-Options header present"
else
    fail "X-Content-Type-Options header missing" "nosniff" "not found"
fi

# Test X-Frame-Options
if echo "$HEADERS" | grep -iq "x-frame-options: DENY"; then
    pass "X-Frame-Options header present"
else
    fail "X-Frame-Options header missing" "DENY" "not found"
fi

# Test X-XSS-Protection
if echo "$HEADERS" | grep -iq "x-xss-protection: 1; mode=block"; then
    pass "X-XSS-Protection header present"
else
    fail "X-XSS-Protection header missing" "1; mode=block" "not found"
fi

# Test Referrer-Policy
if echo "$HEADERS" | grep -iq "referrer-policy:"; then
    pass "Referrer-Policy header present"
else
    fail "Referrer-Policy header missing" "strict-origin-when-cross-origin" "not found"
fi

# Test Content-Security-Policy
if echo "$HEADERS" | grep -iq "content-security-policy:"; then
    pass "Content-Security-Policy header present"
else
    fail "Content-Security-Policy header missing" "CSP directives" "not found"
fi

# Test Permissions-Policy
if echo "$HEADERS" | grep -iq "permissions-policy:"; then
    pass "Permissions-Policy header present"
else
    fail "Permissions-Policy header missing" "geolocation=(), ..." "not found"
fi

# Test Strict-Transport-Security (only in production)
if echo "$BASE_URL" | grep -iq "https"; then
    if echo "$HEADERS" | grep -iq "strict-transport-security:"; then
        pass "Strict-Transport-Security header present (HTTPS)"
    else
        fail "Strict-Transport-Security header missing (HTTPS)" "max-age=31536000" "not found"
    fi
else
    info "Skipping HSTS check (HTTP only - expected in development)"
fi

################################################################################
# Test 2: Admin Authentication
################################################################################

section "Test 2: Admin Authentication"

# Test 2.1: Access without token (should fail)
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/admin/scraper/logs")
if [ "$RESPONSE" -eq 401 ]; then
    pass "Admin endpoint blocks requests without token (401)"
else
    fail "Admin endpoint authentication" "401 Unauthorized" "HTTP $RESPONSE"
fi

# Test 2.2: Access with invalid token (should fail)
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer invalid_token_12345" \
    "$BASE_URL/api/admin/scraper/logs")
if [ "$RESPONSE" -eq 401 ]; then
    pass "Admin endpoint rejects invalid token (401)"
else
    fail "Admin endpoint token validation" "401 Unauthorized" "HTTP $RESPONSE"
fi

# Test 2.3: Access with valid token (should succeed)
if [ -n "$ADMIN_TOKEN" ]; then
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        "$BASE_URL/api/admin/scraper/logs")
    if [ "$RESPONSE" -eq 200 ]; then
        pass "Admin endpoint accepts valid token (200)"
    else
        fail "Admin endpoint valid token" "200 OK" "HTTP $RESPONSE"
    fi

    # Test 2.4: DB test endpoint with token
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        "$BASE_URL/api/db-test")
    if [ "$RESPONSE" -eq 200 ]; then
        pass "/api/db-test accepts valid token (200)"
    else
        fail "/api/db-test valid token" "200 OK" "HTTP $RESPONSE"
    fi
else
    info "Skipping valid token tests (ADMIN_TOKEN not provided)"
    info "Rerun with: $0 $BASE_URL <ADMIN_TOKEN>"
fi

# Test 2.5: DB test endpoint without token
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/db-test")
if [ "$RESPONSE" -eq 401 ]; then
    pass "/api/db-test blocks requests without token (401)"
else
    fail "/api/db-test authentication" "401 Unauthorized" "HTTP $RESPONSE"
fi

################################################################################
# Test 3: CORS Policy
################################################################################

section "Test 3: CORS Policy"

CORS_HEADERS=$(curl -s -I -X OPTIONS "$BASE_URL/api/ipos" \
    -H "Origin: $BASE_URL" 2>&1)

# Test Access-Control-Allow-Origin
if echo "$CORS_HEADERS" | grep -iq "access-control-allow-origin:"; then
    pass "CORS Access-Control-Allow-Origin header present"
else
    fail "CORS Allow-Origin header missing" "Access-Control-Allow-Origin" "not found"
fi

# Test Access-Control-Allow-Methods
if echo "$CORS_HEADERS" | grep -iq "access-control-allow-methods:"; then
    pass "CORS Access-Control-Allow-Methods header present"
else
    fail "CORS Allow-Methods header missing" "GET, POST, PUT, DELETE, OPTIONS" "not found"
fi

# Test Access-Control-Allow-Headers
if echo "$CORS_HEADERS" | grep -iq "access-control-allow-headers:"; then
    pass "CORS Access-Control-Allow-Headers header present"
else
    fail "CORS Allow-Headers header missing" "Content-Type, Authorization" "not found"
fi

# Test Access-Control-Max-Age
if echo "$CORS_HEADERS" | grep -iq "access-control-max-age:"; then
    pass "CORS Access-Control-Max-Age header present"
else
    fail "CORS Max-Age header missing" "86400" "not found"
fi

################################################################################
# Test 4: Environment Configuration
################################################################################

section "Test 4: Environment Configuration"

# Check if .env.local exists
if [ -f "web/.env.local" ]; then
    pass ".env.local file exists"

    # Check if ADMIN_API_TOKEN is set
    if grep -q "ADMIN_API_TOKEN=" "web/.env.local"; then
        pass "ADMIN_API_TOKEN configured in .env.local"

        # Extract token length
        TOKEN_VALUE=$(grep "ADMIN_API_TOKEN=" "web/.env.local" | cut -d'=' -f2)
        TOKEN_LENGTH=${#TOKEN_VALUE}

        if [ "$TOKEN_LENGTH" -ge 32 ]; then
            pass "ADMIN_API_TOKEN meets minimum length (${TOKEN_LENGTH} chars)"
        else
            fail "ADMIN_API_TOKEN too short" "≥32 chars" "${TOKEN_LENGTH} chars"
        fi
    else
        fail "ADMIN_API_TOKEN not configured" "ADMIN_API_TOKEN=..." "not found"
    fi
else
    fail ".env.local file missing" "web/.env.local exists" "not found"
fi

# Check if .env.example is documented
if [ -f "web/.env.example" ]; then
    pass ".env.example file exists"

    if grep -q "ADMIN_API_TOKEN" "web/.env.example"; then
        pass "ADMIN_API_TOKEN documented in .env.example"
    else
        fail "ADMIN_API_TOKEN not documented" "ADMIN_API_TOKEN in .env.example" "not found"
    fi
else
    fail ".env.example file missing" "web/.env.example exists" "not found"
fi

################################################################################
# Test 5: Middleware Files
################################################################################

section "Test 5: Middleware & Auth Files"

# Check if middleware.ts exists
if [ -f "web/middleware.ts" ]; then
    pass "web/middleware.ts exists"

    # Verify it exports middleware function
    if grep -q "export function middleware" "web/middleware.ts"; then
        pass "Middleware exports middleware function"
    else
        fail "Middleware function missing" "export function middleware" "not found"
    fi

    # Verify it sets security headers
    if grep -q "X-Content-Type-Options" "web/middleware.ts"; then
        pass "Middleware sets X-Content-Type-Options"
    else
        fail "Security header missing" "X-Content-Type-Options in middleware" "not found"
    fi
else
    fail "web/middleware.ts missing" "web/middleware.ts exists" "not found"
fi

# Check if admin-auth.ts exists
if [ -f "web/lib/auth/admin-auth.ts" ]; then
    pass "web/lib/auth/admin-auth.ts exists"

    # Verify it exports requireAdminAuth function
    if grep -q "export async function requireAdminAuth" "web/lib/auth/admin-auth.ts"; then
        pass "Auth utility exports requireAdminAuth function"
    else
        fail "requireAdminAuth function missing" "export async function requireAdminAuth" "not found"
    fi

    # Verify it uses constant-time comparison
    if grep -q "constantTimeCompare" "web/lib/auth/admin-auth.ts"; then
        pass "Auth utility uses constant-time comparison"
    else
        fail "Constant-time comparison missing" "constantTimeCompare function" "not found"
    fi
else
    fail "web/lib/auth/admin-auth.ts missing" "web/lib/auth/admin-auth.ts exists" "not found"
fi

################################################################################
# Test 6: Protected Endpoints
################################################################################

section "Test 6: Protected Endpoints"

# Check if scraper logs endpoint is protected
if [ -f "web/app/api/admin/scraper/logs/route.ts" ]; then
    pass "Admin scraper logs endpoint exists"

    if grep -q "requireAdminAuth" "web/app/api/admin/scraper/logs/route.ts"; then
        pass "Scraper logs endpoint uses requireAdminAuth"
    else
        fail "Scraper logs not protected" "requireAdminAuth() call" "not found"
    fi
else
    fail "Admin scraper logs endpoint missing" "web/app/api/admin/scraper/logs/route.ts" "not found"
fi

# Check if scraper status endpoint is protected
if [ -f "web/app/api/admin/scraper/status/route.ts" ]; then
    pass "Admin scraper status endpoint exists"

    if grep -q "requireAdminAuth" "web/app/api/admin/scraper/status/route.ts"; then
        pass "Scraper status endpoint uses requireAdminAuth"
    else
        fail "Scraper status not protected" "requireAdminAuth() call" "not found"
    fi
else
    fail "Admin scraper status endpoint missing" "web/app/api/admin/scraper/status/route.ts" "not found"
fi

# Check if db-test endpoint is protected
if [ -f "web/app/api/db-test/route.ts" ]; then
    pass "DB test endpoint exists"

    if grep -q "requireAdminAuth" "web/app/api/db-test/route.ts"; then
        pass "DB test endpoint uses requireAdminAuth"
    else
        fail "DB test not protected" "requireAdminAuth() call" "not found"
    fi
else
    fail "DB test endpoint missing" "web/app/api/db-test/route.ts" "not found"
fi

################################################################################
# Test 7: Next.js Configuration
################################################################################

section "Test 7: Next.js Configuration"

if [ -f "web/next.config.ts" ]; then
    pass "next.config.ts exists"

    # Check if CORS is configured
    if grep -q "Access-Control-Allow-Origin" "web/next.config.ts"; then
        pass "CORS configuration present in next.config.ts"
    else
        fail "CORS not configured" "Access-Control-Allow-Origin in next.config.ts" "not found"
    fi

    # Check if API routes have CORS headers
    if grep -q "/api/:path\\*" "web/next.config.ts"; then
        pass "API route pattern configured for CORS"
    else
        fail "API CORS pattern missing" "/api/:path* in next.config.ts" "not found"
    fi
else
    fail "next.config.ts missing" "web/next.config.ts exists" "not found"
fi

################################################################################
# Summary
################################################################################

section "Test Summary"

TOTAL_TESTS=$((PASS_COUNT + FAIL_COUNT))
PASS_PERCENTAGE=$((PASS_COUNT * 100 / TOTAL_TESTS))

echo ""
echo "Total Tests: $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASS_COUNT${NC}"
echo -e "${RED}Failed: $FAIL_COUNT${NC}"
echo "Success Rate: ${PASS_PERCENTAGE}%"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${GREEN}=================================="
    echo "✓ ALL TESTS PASSED"
    echo "==================================${NC}"
    echo ""
    echo "Security fixes are working correctly!"
    echo "The application is ready for production deployment."
    exit 0
else
    echo -e "${RED}=================================="
    echo "✗ SOME TESTS FAILED"
    echo "==================================${NC}"
    echo ""
    echo "Please review the failed tests above and fix the issues."
    echo "Refer to fixes/security-fixes.md for implementation details."
    exit 1
fi
