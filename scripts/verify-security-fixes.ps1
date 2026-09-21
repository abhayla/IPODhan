################################################################################
# Security Fixes Verification Script (PowerShell)
#
# This script validates all security fixes implemented in Phase 5
# Tests security headers, admin authentication, and CORS policy
#
# Usage:
#   .\scripts\verify-security-fixes.ps1 [-BaseUrl <url>] [-AdminToken <token>]
#
# Examples:
#   .\scripts\verify-security-fixes.ps1
#   .\scripts\verify-security-fixes.ps1 -BaseUrl "http://localhost:3009"
#   .\scripts\verify-security-fixes.ps1 -BaseUrl "https://ipodhan.com" -AdminToken "your_token"
#
################################################################################

param(
    [string]$BaseUrl = "http://localhost:3009",
    [string]$AdminToken = ""
)

# Colors for output
$script:PassCount = 0
$script:FailCount = 0

function Write-Pass {
    param([string]$Message)
    Write-Host "✓ PASS - $Message" -ForegroundColor Green
    $script:PassCount++
}

function Write-Fail {
    param([string]$Message, [string]$Expected, [string]$Got)
    Write-Host "✗ FAIL - $Message" -ForegroundColor Red
    Write-Host "  Expected: $Expected" -ForegroundColor Yellow
    Write-Host "  Got: $Got" -ForegroundColor Yellow
    $script:FailCount++
}

function Write-Info {
    param([string]$Message)
    Write-Host "ℹ INFO - $Message" -ForegroundColor Cyan
}

function Write-Section {
    param([string]$Title)
    Write-Host "`n=================================="
    Write-Host $Title
    Write-Host "==================================`n"
}

# Print header
Write-Host "=================================="
Write-Host "Security Fixes Verification Script"
Write-Host "=================================="
Write-Host "Base URL: $BaseUrl"
Write-Host "Date: $(Get-Date)"
Write-Host ""

################################################################################
# Test 1: Security Headers
################################################################################

Write-Section "Test 1: Security Headers"

try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/" -Method Head -UseBasicParsing -ErrorAction Stop
    $headers = $response.Headers

    # Test X-Content-Type-Options
    if ($headers.'X-Content-Type-Options' -eq 'nosniff') {
        Write-Pass "X-Content-Type-Options header present"
    } else {
        Write-Fail "X-Content-Type-Options header missing" "nosniff" "not found"
    }

    # Test X-Frame-Options
    if ($headers.'X-Frame-Options' -eq 'DENY') {
        Write-Pass "X-Frame-Options header present"
    } else {
        Write-Fail "X-Frame-Options header missing" "DENY" "not found"
    }

    # Test X-XSS-Protection
    if ($headers.'X-XSS-Protection' -match '1; mode=block') {
        Write-Pass "X-XSS-Protection header present"
    } else {
        Write-Fail "X-XSS-Protection header missing" "1; mode=block" "not found"
    }

    # Test Referrer-Policy
    if ($headers.ContainsKey('Referrer-Policy')) {
        Write-Pass "Referrer-Policy header present"
    } else {
        Write-Fail "Referrer-Policy header missing" "strict-origin-when-cross-origin" "not found"
    }

    # Test Content-Security-Policy
    if ($headers.ContainsKey('Content-Security-Policy')) {
        Write-Pass "Content-Security-Policy header present"
    } else {
        Write-Fail "Content-Security-Policy header missing" "CSP directives" "not found"
    }

    # Test Permissions-Policy
    if ($headers.ContainsKey('Permissions-Policy')) {
        Write-Pass "Permissions-Policy header present"
    } else {
        Write-Fail "Permissions-Policy header missing" "geolocation=(), ..." "not found"
    }

    # Test Strict-Transport-Security (only in production)
    if ($BaseUrl -match '^https') {
        if ($headers.ContainsKey('Strict-Transport-Security')) {
            Write-Pass "Strict-Transport-Security header present (HTTPS)"
        } else {
            Write-Fail "Strict-Transport-Security header missing (HTTPS)" "max-age=31536000" "not found"
        }
    } else {
        Write-Info "Skipping HSTS check (HTTP only - expected in development)"
    }
} catch {
    Write-Host "Error fetching headers: $_" -ForegroundColor Red
}

################################################################################
# Test 2: Admin Authentication
################################################################################

Write-Section "Test 2: Admin Authentication"

# Test 2.1: Access without token (should fail)
try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/admin/scraper/logs" -Method Get -UseBasicParsing -ErrorAction Stop
    Write-Fail "Admin endpoint authentication" "401 Unauthorized" "HTTP $($response.StatusCode)"
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Pass "Admin endpoint blocks requests without token (401)"
    } else {
        Write-Fail "Admin endpoint authentication" "401 Unauthorized" "HTTP $($_.Exception.Response.StatusCode)"
    }
}

# Test 2.2: Access with invalid token (should fail)
try {
    $headers = @{
        'Authorization' = 'Bearer invalid_token_12345'
    }
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/admin/scraper/logs" -Method Get -Headers $headers -UseBasicParsing -ErrorAction Stop
    Write-Fail "Admin endpoint token validation" "401 Unauthorized" "HTTP $($response.StatusCode)"
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Pass "Admin endpoint rejects invalid token (401)"
    } else {
        Write-Fail "Admin endpoint token validation" "401 Unauthorized" "HTTP $($_.Exception.Response.StatusCode)"
    }
}

# Test 2.3: Access with valid token (should succeed)
if ($AdminToken) {
    try {
        $headers = @{
            'Authorization' = "Bearer $AdminToken"
        }
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/admin/scraper/logs" -Method Get -Headers $headers -UseBasicParsing -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            Write-Pass "Admin endpoint accepts valid token (200)"
        } else {
            Write-Fail "Admin endpoint valid token" "200 OK" "HTTP $($response.StatusCode)"
        }
    } catch {
        Write-Fail "Admin endpoint valid token" "200 OK" "HTTP $($_.Exception.Response.StatusCode)"
    }

    # Test 2.4: DB test endpoint with token
    try {
        $headers = @{
            'Authorization' = "Bearer $AdminToken"
        }
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/db-test" -Method Get -Headers $headers -UseBasicParsing -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            Write-Pass "/api/db-test accepts valid token (200)"
        } else {
            Write-Fail "/api/db-test valid token" "200 OK" "HTTP $($response.StatusCode)"
        }
    } catch {
        Write-Fail "/api/db-test valid token" "200 OK" "HTTP $($_.Exception.Response.StatusCode)"
    }
} else {
    Write-Info "Skipping valid token tests (AdminToken not provided)"
    Write-Info "Rerun with: .\scripts\verify-security-fixes.ps1 -BaseUrl '$BaseUrl' -AdminToken '<token>'"
}

# Test 2.5: DB test endpoint without token
try {
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/db-test" -Method Get -UseBasicParsing -ErrorAction Stop
    Write-Fail "/api/db-test authentication" "401 Unauthorized" "HTTP $($response.StatusCode)"
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Pass "/api/db-test blocks requests without token (401)"
    } else {
        Write-Fail "/api/db-test authentication" "401 Unauthorized" "HTTP $($_.Exception.Response.StatusCode)"
    }
}

################################################################################
# Test 3: CORS Policy
################################################################################

Write-Section "Test 3: CORS Policy"

try {
    $headers = @{
        'Origin' = $BaseUrl
    }
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/ipos" -Method Options -Headers $headers -UseBasicParsing -ErrorAction Stop
    $corsHeaders = $response.Headers

    # Test Access-Control-Allow-Origin
    if ($corsHeaders.ContainsKey('Access-Control-Allow-Origin')) {
        Write-Pass "CORS Access-Control-Allow-Origin header present"
    } else {
        Write-Fail "CORS Allow-Origin header missing" "Access-Control-Allow-Origin" "not found"
    }

    # Test Access-Control-Allow-Methods
    if ($corsHeaders.ContainsKey('Access-Control-Allow-Methods')) {
        Write-Pass "CORS Access-Control-Allow-Methods header present"
    } else {
        Write-Fail "CORS Allow-Methods header missing" "GET, POST, PUT, DELETE, OPTIONS" "not found"
    }

    # Test Access-Control-Allow-Headers
    if ($corsHeaders.ContainsKey('Access-Control-Allow-Headers')) {
        Write-Pass "CORS Access-Control-Allow-Headers header present"
    } else {
        Write-Fail "CORS Allow-Headers header missing" "Content-Type, Authorization" "not found"
    }

    # Test Access-Control-Max-Age
    if ($corsHeaders.ContainsKey('Access-Control-Max-Age')) {
        Write-Pass "CORS Access-Control-Max-Age header present"
    } else {
        Write-Fail "CORS Max-Age header missing" "86400" "not found"
    }
} catch {
    Write-Host "Error testing CORS: $_" -ForegroundColor Red
}

################################################################################
# Test 4: Environment Configuration
################################################################################

Write-Section "Test 4: Environment Configuration"

# Check if .env.local exists
if (Test-Path "web\.env.local") {
    Write-Pass ".env.local file exists"

    # Check if ADMIN_API_TOKEN is set
    $envContent = Get-Content "web\.env.local" -Raw
    if ($envContent -match 'ADMIN_API_TOKEN=') {
        Write-Pass "ADMIN_API_TOKEN configured in .env.local"

        # Extract token length
        $tokenLine = ($envContent -split "`n" | Where-Object { $_ -match '^ADMIN_API_TOKEN=' })[0]
        $tokenValue = ($tokenLine -split '=')[1].Trim()
        $tokenLength = $tokenValue.Length

        if ($tokenLength -ge 32) {
            Write-Pass "ADMIN_API_TOKEN meets minimum length ($tokenLength chars)"
        } else {
            Write-Fail "ADMIN_API_TOKEN too short" "≥32 chars" "$tokenLength chars"
        }
    } else {
        Write-Fail "ADMIN_API_TOKEN not configured" "ADMIN_API_TOKEN=..." "not found"
    }
} else {
    Write-Fail ".env.local file missing" "web\.env.local exists" "not found"
}

# Check if .env.example is documented
if (Test-Path "web\.env.example") {
    Write-Pass ".env.example file exists"

    $envExample = Get-Content "web\.env.example" -Raw
    if ($envExample -match 'ADMIN_API_TOKEN') {
        Write-Pass "ADMIN_API_TOKEN documented in .env.example"
    } else {
        Write-Fail "ADMIN_API_TOKEN not documented" "ADMIN_API_TOKEN in .env.example" "not found"
    }
} else {
    Write-Fail ".env.example file missing" "web\.env.example exists" "not found"
}

################################################################################
# Test 5: Middleware Files
################################################################################

Write-Section "Test 5: Middleware & Auth Files"

# Check if middleware.ts exists
if (Test-Path "web\middleware.ts") {
    Write-Pass "web\middleware.ts exists"

    $middlewareContent = Get-Content "web\middleware.ts" -Raw

    # Verify it exports middleware function
    if ($middlewareContent -match 'export function middleware') {
        Write-Pass "Middleware exports middleware function"
    } else {
        Write-Fail "Middleware function missing" "export function middleware" "not found"
    }

    # Verify it sets security headers
    if ($middlewareContent -match 'X-Content-Type-Options') {
        Write-Pass "Middleware sets X-Content-Type-Options"
    } else {
        Write-Fail "Security header missing" "X-Content-Type-Options in middleware" "not found"
    }
} else {
    Write-Fail "web\middleware.ts missing" "web\middleware.ts exists" "not found"
}

# Check if admin-auth.ts exists
if (Test-Path "web\lib\auth\admin-auth.ts") {
    Write-Pass "web\lib\auth\admin-auth.ts exists"

    $authContent = Get-Content "web\lib\auth\admin-auth.ts" -Raw

    # Verify it exports requireAdminAuth function
    if ($authContent -match 'export async function requireAdminAuth') {
        Write-Pass "Auth utility exports requireAdminAuth function"
    } else {
        Write-Fail "requireAdminAuth function missing" "export async function requireAdminAuth" "not found"
    }

    # Verify it uses constant-time comparison
    if ($authContent -match 'constantTimeCompare') {
        Write-Pass "Auth utility uses constant-time comparison"
    } else {
        Write-Fail "Constant-time comparison missing" "constantTimeCompare function" "not found"
    }
} else {
    Write-Fail "web\lib\auth\admin-auth.ts missing" "web\lib\auth\admin-auth.ts exists" "not found"
}

################################################################################
# Test 6: Protected Endpoints
################################################################################

Write-Section "Test 6: Protected Endpoints"

# Check if scraper logs endpoint is protected
if (Test-Path "web\app\api\admin\scraper\logs\route.ts") {
    Write-Pass "Admin scraper logs endpoint exists"

    $logsContent = Get-Content "web\app\api\admin\scraper\logs\route.ts" -Raw
    if ($logsContent -match 'requireAdminAuth') {
        Write-Pass "Scraper logs endpoint uses requireAdminAuth"
    } else {
        Write-Fail "Scraper logs not protected" "requireAdminAuth() call" "not found"
    }
} else {
    Write-Fail "Admin scraper logs endpoint missing" "web\app\api\admin\scraper\logs\route.ts" "not found"
}

# Check if scraper status endpoint is protected
if (Test-Path "web\app\api\admin\scraper\status\route.ts") {
    Write-Pass "Admin scraper status endpoint exists"

    $statusContent = Get-Content "web\app\api\admin\scraper\status\route.ts" -Raw
    if ($statusContent -match 'requireAdminAuth') {
        Write-Pass "Scraper status endpoint uses requireAdminAuth"
    } else {
        Write-Fail "Scraper status not protected" "requireAdminAuth() call" "not found"
    }
} else {
    Write-Fail "Admin scraper status endpoint missing" "web\app\api\admin\scraper\status\route.ts" "not found"
}

# Check if db-test endpoint is protected
if (Test-Path "web\app\api\db-test\route.ts") {
    Write-Pass "DB test endpoint exists"

    $dbTestContent = Get-Content "web\app\api\db-test\route.ts" -Raw
    if ($dbTestContent -match 'requireAdminAuth') {
        Write-Pass "DB test endpoint uses requireAdminAuth"
    } else {
        Write-Fail "DB test not protected" "requireAdminAuth() call" "not found"
    }
} else {
    Write-Fail "DB test endpoint missing" "web\app\api\db-test\route.ts" "not found"
}

################################################################################
# Test 7: Next.js Configuration
################################################################################

Write-Section "Test 7: Next.js Configuration"

if (Test-Path "web\next.config.ts") {
    Write-Pass "next.config.ts exists"

    $configContent = Get-Content "web\next.config.ts" -Raw

    # Check if CORS is configured
    if ($configContent -match 'Access-Control-Allow-Origin') {
        Write-Pass "CORS configuration present in next.config.ts"
    } else {
        Write-Fail "CORS not configured" "Access-Control-Allow-Origin in next.config.ts" "not found"
    }

    # Check if API routes have CORS headers
    if ($configContent -match '/api/:path\*') {
        Write-Pass "API route pattern configured for CORS"
    } else {
        Write-Fail "API CORS pattern missing" "/api/:path* in next.config.ts" "not found"
    }
} else {
    Write-Fail "next.config.ts missing" "web\next.config.ts exists" "not found"
}

################################################################################
# Summary
################################################################################

Write-Section "Test Summary"

$totalTests = $script:PassCount + $script:FailCount
$passPercentage = [math]::Round(($script:PassCount / $totalTests) * 100, 2)

Write-Host ""
Write-Host "Total Tests: $totalTests"
Write-Host "Passed: $($script:PassCount)" -ForegroundColor Green
Write-Host "Failed: $($script:FailCount)" -ForegroundColor Red
Write-Host "Success Rate: $passPercentage%"
Write-Host ""

if ($script:FailCount -eq 0) {
    Write-Host "==================================" -ForegroundColor Green
    Write-Host "ALL TESTS PASSED" -ForegroundColor Green
    Write-Host "==================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Security fixes are working correctly!"
    Write-Host "The application is ready for production deployment."
    exit 0
} else {
    Write-Host "==================================" -ForegroundColor Red
    Write-Host "X SOME TESTS FAILED" -ForegroundColor Red
    Write-Host "==================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please review the failed tests above and fix the issues."
    Write-Host "Refer to documentation for implementation details."
    exit 1
}
