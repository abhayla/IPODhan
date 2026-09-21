###############################################################################
# IPODhan - Log Cleanup Script (Windows PowerShell)
#
# This script removes old log files to free up disk space
#
# Usage:
#   .\scripts\cleanup-old-logs.ps1 [-DaysToKeep 30] [-DryRun]
#
# Parameters:
#   -DaysToKeep : Number of days to retain logs (default: 30)
#   -DryRun     : Show what would be deleted without actually deleting
#
# Examples:
#   .\scripts\cleanup-old-logs.ps1
#   .\scripts\cleanup-old-logs.ps1 -DaysToKeep 60
#   .\scripts\cleanup-old-logs.ps1 -DryRun
#
###############################################################################

param(
    [int]$DaysToKeep = 30,
    [switch]$DryRun = $false
)

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  IPODhan - Log Cleanup Utility" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

if ($DryRun) {
    Write-Host "DRY RUN MODE - No files will be deleted" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "Retention policy: Keep logs from last $DaysToKeep days" -ForegroundColor White
Write-Host ""

# Define log directories
$logDirectories = @(
    ".\logs",
    ".\web\logs",
    ".\scraper\logs"
)

# Calculate cutoff date
$cutoffDate = (Get-Date).AddDays(-$DaysToKeep)
Write-Host "Cutoff date: $($cutoffDate.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Gray
Write-Host ""

$totalFilesFound = 0
$totalFilesDeleted = 0
$totalSpaceFreed = 0

foreach ($logDir in $logDirectories) {
    if (-not (Test-Path $logDir)) {
        Write-Host "Directory not found: $logDir" -ForegroundColor Gray
        continue
    }

    Write-Host "Processing: $logDir" -ForegroundColor Cyan
    Write-Host "----------------------------------------------------------------------"

    # Find old log files (including rotated .gz files)
    $oldFiles = Get-ChildItem -Path $logDir -Recurse -File | Where-Object {
        ($_.Extension -eq ".log" -or $_.Extension -eq ".gz") -and
        $_.LastWriteTime -lt $cutoffDate
    }

    if ($oldFiles) {
        foreach ($file in $oldFiles) {
            $totalFilesFound++
            $fileSize = $file.Length
            $age = (Get-Date) - $file.LastWriteTime

            $sizeStr = if ($fileSize -gt 1MB) { "{0:N2} MB" -f ($fileSize / 1MB) } else { "{0:N2} KB" -f ($fileSize / 1KB) }

            if ($DryRun) {
                Write-Host "  [DRY RUN] Would delete: $($file.Name) (Size: $sizeStr, Age: $($age.Days) days)" -ForegroundColor Yellow
            }
            else {
                try {
                    Remove-Item -Path $file.FullName -Force
                    Write-Host "  Deleted: $($file.Name) (Size: $sizeStr, Age: $($age.Days) days)" -ForegroundColor Green
                    $totalFilesDeleted++
                    $totalSpaceFreed += $fileSize
                }
                catch {
                    Write-Host "  ERROR deleting $($file.Name): $_" -ForegroundColor Red
                }
            }
        }
    }
    else {
        Write-Host "  No old files found" -ForegroundColor Gray
    }

    Write-Host ""
}

# Summary
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  Cleanup Summary" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

if ($DryRun) {
    Write-Host "Files that would be deleted: $totalFilesFound" -ForegroundColor Yellow
    if ($totalFilesFound -gt 0) {
        $totalSpaceWouldFree = $oldFiles | Measure-Object -Property Length -Sum
        $spaceStr = if ($totalSpaceWouldFree.Sum -gt 1MB) {
            "{0:N2} MB" -f ($totalSpaceWouldFree.Sum / 1MB)
        }
        else {
            "{0:N2} KB" -f ($totalSpaceWouldFree.Sum / 1KB)
        }
        Write-Host "Space that would be freed: $spaceStr" -ForegroundColor Yellow
    }
}
else {
    Write-Host "Files found: $totalFilesFound" -ForegroundColor White
    Write-Host "Files deleted: $totalFilesDeleted" -ForegroundColor Green

    if ($totalSpaceFreed -gt 0) {
        $spaceStr = if ($totalSpaceFreed -gt 1MB) {
            "{0:N2} MB" -f ($totalSpaceFreed / 1MB)
        }
        else {
            "{0:N2} KB" -f ($totalSpaceFreed / 1KB)
        }
        Write-Host "Space freed: $spaceStr" -ForegroundColor Green
    }

    if ($totalFilesFound -ne $totalFilesDeleted) {
        $failed = $totalFilesFound - $totalFilesDeleted
        Write-Host "Failed deletions: $failed" -ForegroundColor Red
    }
}

Write-Host ""

# Current disk space
try {
    $drive = Get-PSDrive D -ErrorAction SilentlyContinue
    if ($drive) {
        $freeSpaceGB = [math]::Round($drive.Free / 1GB, 2)
        $totalSpaceGB = [math]::Round(($drive.Used + $drive.Free) / 1GB, 2)
        $usedPercent = [math]::Round(($drive.Used / ($drive.Used + $drive.Free)) * 100, 1)

        Write-Host "Current Disk Space (D:)" -ForegroundColor White
        Write-Host "  Total: $totalSpaceGB GB" -ForegroundColor Gray
        Write-Host "  Free: $freeSpaceGB GB" -ForegroundColor Gray
        Write-Host "  Used: $usedPercent%" -ForegroundColor $(if ($usedPercent -gt 80) { "Red" } elseif ($usedPercent -gt 70) { "Yellow" } else { "Green" })
        Write-Host ""
    }
}
catch {
    # Ignore if can't get disk space
}

if ($DryRun) {
    Write-Host "To actually delete files, run without -DryRun flag" -ForegroundColor Yellow
}
else {
    Write-Host "Cleanup complete!" -ForegroundColor Green
}

Write-Host ""
