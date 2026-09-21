###############################################################################
# IPODhan - Log Health Check Script (Windows PowerShell)
#
# This script monitors log files and alerts on potential issues
#
# Usage:
#   .\scripts\check-log-health.ps1 [-AlertThresholdMB 100] [-Verbose]
#
# Parameters:
#   -AlertThresholdMB : Alert if individual log file exceeds this size (default: 100MB)
#   -Verbose          : Show detailed information
#
# Examples:
#   .\scripts\check-log-health.ps1
#   .\scripts\check-log-health.ps1 -AlertThresholdMB 50
#   .\scripts\check-log-health.ps1 -Verbose
#
# Exit Codes:
#   0 = All healthy
#   1 = Warnings found
#   2 = Critical issues found
#
###############################################################################

param(
    [int]$AlertThresholdMB = 100,
    [switch]$Verbose = $false
)

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  IPODhan - Log Health Check" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host ""

$exitCode = 0
$warnings = @()
$criticalIssues = @()

# Define log directories and files
$logLocations = @(
    @{Path = ".\logs\web-out.log"; Type = "Web Output"; MaxSize = $AlertThresholdMB },
    @{Path = ".\logs\web-error.log"; Type = "Web Error"; MaxSize = $AlertThresholdMB },
    @{Path = ".\logs\scraper-out.log"; Type = "Scraper Output"; MaxSize = $AlertThresholdMB },
    @{Path = ".\logs\scraper-error.log"; Type = "Scraper Error"; MaxSize = $AlertThresholdMB }
)

# Check individual log files
Write-Host "Individual Log Files" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------------"

foreach ($log in $logLocations) {
    if (Test-Path $log.Path) {
        $file = Get-Item $log.Path
        $sizeMB = [math]::Round($file.Length / 1MB, 2)
        $age = (Get-Date) - $file.LastWriteTime

        # Status indicator
        $status = "OK"
        $color = "Green"

        if ($sizeMB -gt $log.MaxSize) {
            $status = "CRITICAL"
            $color = "Red"
            $criticalIssues += "$($log.Type): File size $sizeMB MB exceeds threshold $($log.MaxSize) MB"
            $exitCode = 2
        }
        elseif ($sizeMB -gt ($log.MaxSize * 0.7)) {
            $status = "WARNING"
            $color = "Yellow"
            $warnings += "$($log.Type): File size $sizeMB MB approaching threshold"
            if ($exitCode -eq 0) { $exitCode = 1 }
        }

        # Check if file is being written to (modified in last hour)
        $stale = ""
        if ($age.TotalHours -gt 1 -and $log.Type -notlike "*Error*") {
            $stale = " (Stale: $([math]::Round($age.TotalHours, 1))h)"
            $warnings += "$($log.Type): No writes in last $([math]::Round($age.TotalHours, 1)) hours"
            if ($exitCode -eq 0) { $exitCode = 1 }
        }

        Write-Host "  [$status] $($log.Type): $sizeMB MB$stale" -ForegroundColor $color

        if ($Verbose) {
            Write-Host "    Path: $($log.Path)" -ForegroundColor Gray
            Write-Host "    Last Modified: $($file.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Gray
        }
    }
    else {
        Write-Host "  [MISSING] $($log.Type): File not found" -ForegroundColor Yellow
        $warnings += "$($log.Type): Log file not found at $($log.Path)"
        if ($exitCode -eq 0) { $exitCode = 1 }
    }
}

Write-Host ""

# Check total log directory size
Write-Host "Log Directory Summary" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------------"

$logDirs = @(".\logs", ".\web\logs", ".\scraper\logs")
$totalSize = 0
$totalFiles = 0

foreach ($dir in $logDirs) {
    if (Test-Path $dir) {
        $files = Get-ChildItem -Path $dir -File -Recurse -ErrorAction SilentlyContinue
        if ($files) {
            $dirSize = ($files | Measure-Object -Property Length -Sum).Sum
            $fileCount = $files.Count
            $totalSize += $dirSize
            $totalFiles += $fileCount

            $sizeMB = [math]::Round($dirSize / 1MB, 2)

            $status = if ($sizeMB -gt 1000) { "CRITICAL"; "Red" } elseif ($sizeMB -gt 500) { "WARNING"; "Yellow" } else { "OK"; "Green" }

            Write-Host "  $dir" -ForegroundColor White
            Write-Host "    Files: $fileCount" -ForegroundColor Gray
            Write-Host "    Size: $sizeMB MB [$($status[0])]" -ForegroundColor $status[1]

            if ($status[0] -eq "CRITICAL") {
                $criticalIssues += "Directory $dir size $sizeMB MB exceeds 1GB"
                $exitCode = 2
            }
            elseif ($status[0] -eq "WARNING") {
                $warnings += "Directory $dir size $sizeMB MB approaching 1GB"
                if ($exitCode -eq 0) { $exitCode = 1 }
            }
        }
        else {
            Write-Host "  $dir" -ForegroundColor White
            Write-Host "    Files: 0" -ForegroundColor Gray
        }
    }
}

Write-Host ""
Write-Host "  Total log files: $totalFiles" -ForegroundColor White
Write-Host "  Total size: $([math]::Round($totalSize / 1MB, 2)) MB" -ForegroundColor White

if ($totalSize -gt 1GB) {
    Write-Host "  WARNING: Total log size exceeds 1GB!" -ForegroundColor Red
}

Write-Host ""

# Check for rotated logs
Write-Host "Rotated Logs (.gz files)" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------------"

$rotatedFiles = Get-ChildItem -Path ".\logs" -Filter "*.gz" -Recurse -ErrorAction SilentlyContinue

if ($rotatedFiles) {
    $rotatedCount = $rotatedFiles.Count
    $rotatedSize = ($rotatedFiles | Measure-Object -Property Length -Sum).Sum
    $rotatedSizeMB = [math]::Round($rotatedSize / 1MB, 2)

    Write-Host "  Rotated files: $rotatedCount" -ForegroundColor Green
    Write-Host "  Compressed size: $rotatedSizeMB MB" -ForegroundColor Green

    if ($Verbose) {
        Write-Host ""
        Write-Host "  Recent rotated logs:" -ForegroundColor Gray
        $rotatedFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 5 | ForEach-Object {
            $sizeMB = [math]::Round($_.Length / 1MB, 2)
            Write-Host "    - $($_.Name) ($sizeMB MB, $($_.LastWriteTime.ToString('yyyy-MM-dd')))" -ForegroundColor Gray
        }
    }
}
else {
    Write-Host "  No rotated logs found" -ForegroundColor Yellow
    Write-Host "  This may indicate log rotation is not working" -ForegroundColor Yellow
    $warnings += "No rotated (.gz) log files found - rotation may not be configured"
    if ($exitCode -eq 0) { $exitCode = 1 }
}

Write-Host ""

# Check PM2 log rotation configuration
Write-Host "PM2 Log Rotation Status" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------------"

try {
    $pm2Conf = pm2 conf 2>&1 | Select-String "pm2-logrotate"

    if ($pm2Conf) {
        Write-Host "  PM2 logrotate module: Installed" -ForegroundColor Green

        if ($Verbose) {
            # Try to get specific settings
            $maxSize = pm2 get pm2-logrotate:max_size 2>$null
            $retain = pm2 get pm2-logrotate:retain 2>$null
            $compress = pm2 get pm2-logrotate:compress 2>$null

            if ($maxSize) { Write-Host "    Max size: $maxSize" -ForegroundColor Gray }
            if ($retain) { Write-Host "    Retain: $retain" -ForegroundColor Gray }
            if ($compress) { Write-Host "    Compress: $compress" -ForegroundColor Gray }
        }
    }
    else {
        Write-Host "  PM2 logrotate module: Not installed" -ForegroundColor Red
        $criticalIssues += "PM2 logrotate module not installed - logs will not rotate automatically"
        $exitCode = 2
    }
}
catch {
    Write-Host "  PM2: Not found or not running" -ForegroundColor Yellow
    $warnings += "PM2 not found - cannot check log rotation status"
    if ($exitCode -eq 0) { $exitCode = 1 }
}

Write-Host ""

# Check disk space
Write-Host "Disk Space Status" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------------"

try {
    $drive = Get-PSDrive D -ErrorAction SilentlyContinue

    if ($drive) {
        $freeSpaceGB = [math]::Round($drive.Free / 1GB, 2)
        $totalSpaceGB = [math]::Round(($drive.Used + $drive.Free) / 1GB, 2)
        $usedPercent = [math]::Round(($drive.Used / ($drive.Used + $drive.Free)) * 100, 1)

        Write-Host "  Drive: D:" -ForegroundColor White
        Write-Host "    Total: $totalSpaceGB GB" -ForegroundColor Gray
        Write-Host "    Free: $freeSpaceGB GB" -ForegroundColor Gray

        $diskStatus = if ($usedPercent -gt 90) {
            $criticalIssues += "Disk space critical: $usedPercent% used, only $freeSpaceGB GB free"
            $exitCode = 2
            "CRITICAL"; "Red"
        }
        elseif ($usedPercent -gt 80) {
            $warnings += "Disk space warning: $usedPercent% used"
            if ($exitCode -eq 0) { $exitCode = 1 }
            "WARNING"; "Yellow"
        }
        else {
            "OK"; "Green"
        }

        Write-Host "    Used: $usedPercent% [$($diskStatus[0])]" -ForegroundColor $diskStatus[1]
    }
}
catch {
    Write-Host "  Could not determine disk space" -ForegroundColor Yellow
}

Write-Host ""

# Summary
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  Health Check Summary" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

if ($criticalIssues.Count -eq 0 -and $warnings.Count -eq 0) {
    Write-Host "  STATUS: HEALTHY" -ForegroundColor Green
    Write-Host "  All log files are within acceptable limits" -ForegroundColor Green
}
else {
    if ($criticalIssues.Count -gt 0) {
        Write-Host "  STATUS: CRITICAL" -ForegroundColor Red
        Write-Host ""
        Write-Host "  Critical Issues ($($criticalIssues.Count)):" -ForegroundColor Red
        foreach ($issue in $criticalIssues) {
            Write-Host "    - $issue" -ForegroundColor Red
        }
    }

    if ($warnings.Count -gt 0) {
        Write-Host ""
        Write-Host "  Warnings ($($warnings.Count)):" -ForegroundColor Yellow
        foreach ($warning in $warnings) {
            Write-Host "    - $warning" -ForegroundColor Yellow
        }
    }
}

Write-Host ""

# Recommendations
if ($criticalIssues.Count -gt 0 -or $warnings.Count -gt 0) {
    Write-Host "Recommendations:" -ForegroundColor Cyan
    Write-Host ""

    if ($exitCode -eq 2) {
        Write-Host "  1. Run log cleanup immediately:" -ForegroundColor Yellow
        Write-Host "     .\scripts\cleanup-old-logs.ps1" -ForegroundColor Gray
        Write-Host ""
    }

    if ($rotatedFiles.Count -eq 0) {
        Write-Host "  2. Set up PM2 log rotation:" -ForegroundColor Yellow
        Write-Host "     .\scripts\setup-log-rotation.ps1" -ForegroundColor Gray
        Write-Host ""
    }

    Write-Host "  3. Monitor logs regularly with this script" -ForegroundColor Yellow
    Write-Host "     Run weekly: .\scripts\check-log-health.ps1" -ForegroundColor Gray
    Write-Host ""
}

Write-Host "Exit code: $exitCode" -ForegroundColor $(if ($exitCode -eq 0) { "Green" } elseif ($exitCode -eq 1) { "Yellow" } else { "Red" })
Write-Host ""

exit $exitCode
