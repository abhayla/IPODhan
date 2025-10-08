# IPODhan Functional Test Suite

$domain = "https://ipodhan.com"
$passed = 0
$failed = 0
$warnings = 0

Write-Host "`n========================================"  -ForegroundColor Cyan
Write-Host "IPODhan Functional Test Suite" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Test 1: Homepage
Write-Host "1. Testing Homepage..." -ForegroundColor Yellow
try {
    $homePage = Invoke-WebRequest -Uri "$domain" -UseBasicParsing -TimeoutSec 10
    if ($homePage.StatusCode -eq 200 -and $homePage.Content -match "FIRE Karo") {
        Write-Host "   [PASS] Homepage loads successfully" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   [FAIL] Homepage content verification failed" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "   [FAIL] Homepage failed: $($_.Exception.Message)" -ForegroundColor Red
    $failed++
}

# Test 2: Health Check
Write-Host "`n2. Testing Health Check..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$domain/api/health" -Method Get -TimeoutSec 10
    if ($health.status -eq "healthy" -and $health.checks.database -eq "connected") {
        Write-Host "   [PASS] Health check: All services healthy" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   [FAIL] Health check: Some services unhealthy" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "   [FAIL] Health check failed" -ForegroundColor Red
    $failed++
}

# Test 3: Cloudflare Active
Write-Host "`n3. Testing Cloudflare Integration..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$domain" -UseBasicParsing -TimeoutSec 10
    $cfRay = $response.Headers["CF-Ray"]
    if ($cfRay) {
        Write-Host "   [PASS] Cloudflare is active (CF-Ray: $cfRay)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   [WARN] Cloudflare headers not found" -ForegroundColor Yellow
        $warnings++
    }
} catch {
    Write-Host "   [FAIL] Cloudflare check failed" -ForegroundColor Red
    $failed++
}

# Test 4: Security Headers
Write-Host "`n4. Testing Security Headers..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$domain" -UseBasicParsing -TimeoutSec 10
    $hasHSTS = $response.Headers["Strict-Transport-Security"] -ne $null

    if ($hasHSTS) {
        Write-Host "   [PASS] Security headers present" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   [WARN] Some security headers missing" -ForegroundColor Yellow
        $warnings++
    }
} catch {
    Write-Host "   [FAIL] Security headers check failed" -ForegroundColor Red
    $failed++
}

# Test 5: .env Files Not Accessible
Write-Host "`n5. Testing Secrets Protection..." -ForegroundColor Yellow
try {
    $envResponse = Invoke-WebRequest -Uri "$domain/.env" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    Write-Host "   [FAIL] .env file is accessible!" -ForegroundColor Red
    $failed++
} catch {
    Write-Host "   [PASS] .env file is not accessible" -ForegroundColor Green
    $passed++
}

# Test 6: PM2 Apps Running
Write-Host "`n6. Testing PM2 Apps Status..." -ForegroundColor Yellow
try {
    $pm2Status = pm2 jlist | ConvertFrom-Json
    $webApps = $pm2Status | Where-Object { $_.name -eq "ipodhan-web" }
    $scraperApp = $pm2Status | Where-Object { $_.name -eq "ipodhan-scraper" }

    $webOnline = ($webApps | Where-Object { $_.pm2_env.status -eq "online" }).Count
    $scraperOnline = ($scraperApp | Where-Object { $_.pm2_env.status -eq "online" }).Count

    if ($webOnline -ge 1 -and $scraperOnline -eq 1) {
        Write-Host "   [PASS] PM2 apps online ($webOnline web, $scraperOnline scraper)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   [FAIL] Some PM2 apps offline (web: $webOnline, scraper: $scraperOnline)" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "   [FAIL] PM2 status check failed: $($_.Exception.Message)" -ForegroundColor Red
    $failed++
}

# Test 7: Response Time
Write-Host "`n7. Testing Response Time..." -ForegroundColor Yellow
try {
    $start = Get-Date
    $response = Invoke-WebRequest -Uri "$domain/api/health" -UseBasicParsing -TimeoutSec 10
    $duration = ((Get-Date) - $start).TotalMilliseconds

    if ($duration -lt 500) {
        Write-Host "   [PASS] Response time: $([math]::Round($duration, 0)) ms" -ForegroundColor Green
        $passed++
    } elseif ($duration -lt 1000) {
        Write-Host "   [WARN] Response time acceptable: $([math]::Round($duration, 0)) ms" -ForegroundColor Yellow
        $warnings++
        $passed++
    } else {
        Write-Host "   [FAIL] Response time too slow: $([math]::Round($duration, 0)) ms" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "   [FAIL] Response time test failed" -ForegroundColor Red
    $failed++
}

# Test 8: Local Port 3001
Write-Host "`n8. Testing Local Port 3001..." -ForegroundColor Yellow
try {
    $local = Invoke-WebRequest -Uri "http://localhost:3001" -UseBasicParsing -TimeoutSec 5
    if ($local.StatusCode -eq 200) {
        Write-Host "   [PASS] Port 3001 responding" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "   [FAIL] Port 3001 not responding correctly" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "   [FAIL] Port 3001 test failed" -ForegroundColor Red
    $failed++
}

# Summary
Write-Host "`n========================================"  -ForegroundColor Cyan
Write-Host "Test Results Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Passed:   $passed / 8" -ForegroundColor Green
Write-Host "Failed:   $failed / 8" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host "Warnings: $warnings" -ForegroundColor Yellow

if ($failed -eq 0) {
    Write-Host "`n[SUCCESS] All critical tests passed! Phase 4 verification successful." -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n[FAILURE] Some tests failed. Review and fix issues." -ForegroundColor Red
    exit 1
}
