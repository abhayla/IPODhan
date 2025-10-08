# ================================================================
# IPODhan Deployment Package Creation Script (PowerShell)
# ================================================================
# Story: 8.4a - Production Deployment - Dev Machine Preparation
#
# Purpose: Creates a deployment-ready package for production Windows VPS
# Usage: .\scripts\create-deployment-package.ps1
# Output: ipodhan-deployment-{timestamp}.zip
# ================================================================

param(
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"

# Configuration
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$packageName = "ipodhan-deployment-$timestamp"
$tempDir = ".deployment-temp\$packageName"
$outputFile = "$packageName.zip"

function Write-Step {
    param([string]$Message)
    Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
}

Write-Host "`n================================================" -ForegroundColor Green
Write-Host "IPODhan Deployment Package Creator (Windows)" -ForegroundColor Green
Write-Host "================================================`n" -ForegroundColor Green

try {
    # Step 1: Clean previous builds
    Write-Step "[1/8] Cleaning previous builds..."
    Remove-Item -Path "web\.next", "web\dist", "scraper\dist", ".deployment-temp", "*.zip" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Success "Cleanup complete"

    # Step 2: Install web dependencies
    Write-Step "[2/8] Installing web dependencies..."
    Set-Location web
    npm ci --production=false
    Set-Location ..
    Write-Success "Web dependencies installed"

    # Step 3: Build Next.js web app
    Write-Step "[3/8] Building Next.js web application..."
    Set-Location web
    npm run build
    Set-Location ..
    Write-Success "Web build complete"

    # Step 4: Install scraper dependencies
    Write-Step "[4/8] Installing scraper dependencies..."
    Set-Location scraper
    npm ci --production=false
    Set-Location ..
    Write-Success "Scraper dependencies installed"

    # Step 5: Build scraper
    Write-Step "[5/8] Building scraper service..."
    Set-Location scraper
    npm run build
    Set-Location ..
    Write-Success "Scraper build complete"

    # Step 6: Create deployment directory structure
    Write-Step "[6/8] Creating deployment package structure..."
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    # Copy web application
    New-Item -ItemType Directory -Path "$tempDir\web" -Force | Out-Null
    Copy-Item -Path "web\.next" -Destination "$tempDir\web\" -Recurse
    Copy-Item -Path "web\package.json" -Destination "$tempDir\web\"
    Copy-Item -Path "web\package-lock.json" -Destination "$tempDir\web\"
    if (Test-Path "web\public") {
        Copy-Item -Path "web\public" -Destination "$tempDir\web\" -Recurse
    }

    # Copy scraper application
    New-Item -ItemType Directory -Path "$tempDir\scraper" -Force | Out-Null
    Copy-Item -Path "scraper\dist" -Destination "$tempDir\scraper\" -Recurse
    Copy-Item -Path "scraper\package.json" -Destination "$tempDir\scraper\"
    Copy-Item -Path "scraper\package-lock.json" -Destination "$tempDir\scraper\"

    # Copy PM2 ecosystem config
    Copy-Item -Path "ecosystem.config.js" -Destination "$tempDir\"

    # Copy environment template
    Copy-Item -Path ".env.production.template" -Destination "$tempDir\"

    # Copy database migrations (if they exist)
    if (Test-Path "database\migrations") {
        New-Item -ItemType Directory -Path "$tempDir\database" -Force | Out-Null
        Copy-Item -Path "database\migrations" -Destination "$tempDir\database\" -Recurse
    }

    # Copy deployment documentation
    New-Item -ItemType Directory -Path "$tempDir\docs" -Force | Out-Null
    if (Test-Path "docs\deployment\DEPLOYMENT-CHECKLIST.md") {
        Copy-Item -Path "docs\deployment\DEPLOYMENT-CHECKLIST.md" -Destination "$tempDir\docs\"
    }
    if (Test-Path "docs\deployment\ROLLBACK.md") {
        Copy-Item -Path "docs\deployment\ROLLBACK.md" -Destination "$tempDir\docs\"
    }

    # Create deployment README
    $deployReadme = @"
# IPODhan Deployment Package

## Quick Start (Windows VPS)

1. Extract this package on the VPS:
   - Right-click ipodhan-deployment-*.zip
   - Select "Extract All..."
   - Or use PowerShell: Expand-Archive ipodhan-deployment-*.zip

2. Install production dependencies:
   ``````powershell
   cd web
   npm ci --production
   cd ..
   cd scraper
   npm ci --production
   cd ..
   ``````

3. Configure environment:
   ``````powershell
   Copy-Item .env.production.template .env.production
   # Edit .env.production with production values using notepad
   notepad .env.production
   ``````

4. Start with PM2:
   ``````powershell
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ``````

5. Verify deployment:
   ``````powershell
   curl http://localhost:3000/api/health
   # Or in browser: http://103.118.16.189:3000/api/health
   ``````

## Documentation

- docs\DEPLOYMENT-CHECKLIST.md: Complete deployment checklist
- docs\ROLLBACK.md: Rollback procedures
- .env.production.template: Environment variable template

## Monitoring

``````powershell
# View logs
pm2 logs

# Monitor processes
pm2 monit

# Check status
pm2 status
``````

## Support

For issues, refer to docs/deployment/ in the main repository.
"@
    Set-Content -Path "$tempDir\DEPLOY.md" -Value $deployReadme
    Write-Success "Package structure created"

    # Step 7: Create archive
    Write-Step "[7/8] Creating deployment archive..."
    Compress-Archive -Path "$tempDir" -DestinationPath $outputFile -Force
    Write-Success "Archive created: $outputFile"

    # Step 8: Cleanup
    Write-Step "[8/8] Cleaning up temporary files..."
    Remove-Item -Path ".deployment-temp" -Recurse -Force
    Write-Success "Cleanup complete"

    # Display package info
    $packageSize = (Get-Item $outputFile).Length / 1MB
    Write-Host "`n================================================" -ForegroundColor Green
    Write-Host "Deployment Package Created Successfully!" -ForegroundColor Green
    Write-Host "================================================`n" -ForegroundColor Green
    Write-Host "Package: " -NoNewline
    Write-Host "$outputFile" -ForegroundColor Green
    Write-Host "Size: " -NoNewline
    Write-Host "$([math]::Round($packageSize, 2)) MB" -ForegroundColor Green
    Write-Host "`nNext Steps:" -ForegroundColor Yellow
    Write-Host "1. Transfer to VPS using RDP or SCP"
    Write-Host "2. Extract and follow DEPLOY.md instructions"
    Write-Host "3. Verify health: http://103.118.16.189:3000/api/health"
    Write-Host "`nReady for deployment!" -ForegroundColor Green

} catch {
    Write-Error "Deployment package creation failed: $_"
    Set-Location $PSScriptRoot\..
    exit 1
}
