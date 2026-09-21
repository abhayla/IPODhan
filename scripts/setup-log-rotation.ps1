###############################################################################
# IPODhan - Log Rotation Setup Script (Windows PowerShell)
#
# This script configures PM2 log rotation to prevent disk space issues
#
# Usage:
#   .\scripts\setup-log-rotation.ps1
#
# What it does:
#   1. Installs pm2-logrotate module
#   2. Configures log rotation settings
#   3. Verifies configuration
#   4. Creates log directories
#
###############################################################################

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  IPODhan - PM2 Log Rotation Setup" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# Check if PM2 is installed
try {
    $pm2Version = pm2 --version 2>$null
    Write-Host "PM2 is installed (version $pm2Version)" -ForegroundColor Green
}
catch {
    Write-Host "ERROR: PM2 is not installed" -ForegroundColor Red
    Write-Host "Install PM2 first: npm install -g pm2"
    exit 1
}

# Install pm2-logrotate module
Write-Host ""
Write-Host "Installing pm2-logrotate module..." -ForegroundColor Yellow
pm2 install pm2-logrotate

Write-Host "pm2-logrotate installed" -ForegroundColor Green

# Configure log rotation
Write-Host ""
Write-Host "Configuring log rotation settings..." -ForegroundColor Yellow

# Max size: 10MB per log file
pm2 set pm2-logrotate:max_size 10M
Write-Host "Max log size: 10MB" -ForegroundColor Green

# Retain: Keep last 30 rotated log files
pm2 set pm2-logrotate:retain 30
Write-Host "Retain: 30 files" -ForegroundColor Green

# Compress: Use gzip compression
pm2 set pm2-logrotate:compress true
Write-Host "Compression: enabled" -ForegroundColor Green

# Date format: YYYY-MM-DD
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD
Write-Host "Date format: YYYY-MM-DD" -ForegroundColor Green

# Rotation interval: every day at 00:00
pm2 set pm2-logrotate:rotateInterval "0 0 * * *"
Write-Host "Rotation interval: Daily at midnight" -ForegroundColor Green

# Worker interval
pm2 set pm2-logrotate:workerInterval 30
Write-Host "Worker interval: 30 seconds" -ForegroundColor Green

# Rotate module logs too
pm2 set pm2-logrotate:rotateModule true
Write-Host "Rotate module logs: enabled" -ForegroundColor Green

# Verify configuration
Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  Current Configuration" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
pm2 conf pm2-logrotate

# Create logs directory structure
Write-Host ""
Write-Host "Creating logs directory structure..." -ForegroundColor Yellow

$logsDirs = @(
    "logs",
    "logs\archived",
    "logs\web",
    "logs\scraper"
)

foreach ($dir in $logsDirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
        Write-Host "Created: $dir" -ForegroundColor Green
    }
    else {
        Write-Host "Exists: $dir" -ForegroundColor Gray
    }
}

# Check current log files
Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  Current Log Files" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

if (Test-Path "logs") {
    $logFiles = Get-ChildItem -Path "logs" -File -Recurse 2>$null
    if ($logFiles) {
        $logFiles | Format-Table Name, @{Label = "Size"; Expression = { "{0:N2} MB" -f ($_.Length / 1MB) } }, LastWriteTime -AutoSize
    }
    else {
        Write-Host "No log files yet" -ForegroundColor Gray
    }
}

# Save PM2 configuration
Write-Host ""
Write-Host "Saving PM2 configuration..." -ForegroundColor Yellow
pm2 save
Write-Host "PM2 configuration saved" -ForegroundColor Green

# Summary
Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Log rotation is now configured with the following settings:" -ForegroundColor White
Write-Host ""
Write-Host "  Max Size:        10MB per file" -ForegroundColor Gray
Write-Host "  Retention:       30 rotated files" -ForegroundColor Gray
Write-Host "  Compression:     Enabled (gzip)" -ForegroundColor Gray
Write-Host "  Date Format:     YYYY-MM-DD" -ForegroundColor Gray
Write-Host "  Rotation Time:   Daily at midnight" -ForegroundColor Gray
Write-Host ""
Write-Host "Log files will be stored in:" -ForegroundColor White
Write-Host "  - logs\web-out.log" -ForegroundColor Gray
Write-Host "  - logs\web-error.log" -ForegroundColor Gray
Write-Host "  - logs\scraper-out.log" -ForegroundColor Gray
Write-Host "  - logs\scraper-error.log" -ForegroundColor Gray
Write-Host ""
Write-Host "Rotated files will be named:" -ForegroundColor White
Write-Host "  - web-out__YYYY-MM-DD.log.gz" -ForegroundColor Gray
Write-Host "  - web-error__YYYY-MM-DD.log.gz" -ForegroundColor Gray
Write-Host "  - etc." -ForegroundColor Gray
Write-Host ""
Write-Host "Note: Rotation will occur automatically based on:" -ForegroundColor Yellow
Write-Host "  1. File size reaches 10MB, OR" -ForegroundColor Gray
Write-Host "  2. Daily at midnight (00:00)" -ForegroundColor Gray
Write-Host ""
Write-Host "To view current logs:" -ForegroundColor White
Write-Host "  pm2 logs ipodhan-web" -ForegroundColor Gray
Write-Host "  pm2 logs ipodhan-scraper" -ForegroundColor Gray
Write-Host ""
Write-Host "To verify rotation is working:" -ForegroundColor White
Write-Host "  Get-ChildItem -Path logs -Filter *.gz" -ForegroundColor Gray
Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host ""
