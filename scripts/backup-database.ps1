# Database Backup Script for IPODhan (Windows/PowerShell)
#
# This script creates automated PostgreSQL database backups with:
# - Timestamped backup files
# - Compression to save space
# - Automatic cleanup of old backups
# - Cloud storage upload (optional)
#
# Usage:
#   .\scripts\backup-database.ps1 [-UploadToCloud] [-KeepDays 30] [-Email admin@example.com]
#
# Scheduled Task Setup (Daily at 2 AM):
#   $action = New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument '-File "C:\path\to\backup-database.ps1" -UploadToCloud'
#   $trigger = New-ScheduledTaskTrigger -Daily -At 2am
#   Register-ScheduledTask -Action $action -Trigger $trigger -TaskName "IPODhan Database Backup"

param(
    [switch]$UploadToCloud = $false,
    [int]$KeepDays = 30,
    [string]$Email = ""
)

# ==================== CONFIGURATION ====================

# Load environment variables from .env file
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match '^([^#][^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

$DbName = $env:POSTGRES_DB ?? "ipodhan"
$DbUser = $env:POSTGRES_USER ?? "postgres"
$DbHost = $env:POSTGRES_HOST ?? "localhost"
$DbPort = $env:POSTGRES_PORT ?? "5432"
$DbPassword = $env:POSTGRES_PASSWORD

$BackupDir = $env:BACKUP_DIR ?? ".\backups\database"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupFile = Join-Path $BackupDir "ipodhan_$Timestamp.sql.gz"

$CloudBucket = $env:BACKUP_CLOUD_BUCKET
$CloudProvider = $env:BACKUP_CLOUD_PROVIDER ?? "s3"

# ==================== FUNCTIONS ====================

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] $Message"
}

function Write-Error-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] ERROR: $Message" -ForegroundColor Red
}

function Test-Requirements {
    Write-Log "Checking requirements..."

    # Check pg_dump
    if (-not (Get-Command "pg_dump" -ErrorAction SilentlyContinue)) {
        Write-Error-Log "pg_dump not found. Please install PostgreSQL client tools."
        exit 1
    }

    # Check 7z or gzip
    $hasCompression = (Get-Command "7z" -ErrorAction SilentlyContinue) -or
                      (Get-Command "gzip" -ErrorAction SilentlyContinue)

    if (-not $hasCompression) {
        Write-Error-Log "Compression tool not found. Please install 7-Zip or gzip."
        exit 1
    }

    Write-Log "✓ All requirements met"
}

function New-BackupDirectory {
    if (-not (Test-Path $BackupDir)) {
        Write-Log "Creating backup directory: $BackupDir"
        New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    }
}

function Invoke-Backup {
    Write-Log "Starting database backup..."
    Write-Log "Database: $DbName"
    Write-Log "Backup file: $BackupFile"

    # Set password environment variable
    $env:PGPASSWORD = $DbPassword

    try {
        # Create temp SQL file
        $tempSql = Join-Path $BackupDir "temp_$Timestamp.sql"

        # Perform backup
        pg_dump `
            --host=$DbHost `
            --port=$DbPort `
            --username=$DbUser `
            --dbname=$DbName `
            --format=plain `
            --no-owner `
            --no-acl `
            --clean `
            --if-exists `
            --file=$tempSql

        if ($LASTEXITCODE -ne 0) {
            throw "pg_dump failed with exit code $LASTEXITCODE"
        }

        # Compress the backup
        if (Get-Command "7z" -ErrorAction SilentlyContinue) {
            7z a -tgzip "$BackupFile" "$tempSql" | Out-Null
        } else {
            gzip -c "$tempSql" > "$BackupFile"
        }

        # Remove temp file
        Remove-Item $tempSql -Force

        $BackupSize = (Get-Item $BackupFile).Length / 1MB
        Write-Log "✓ Backup completed successfully"
        Write-Log "  Size: $([math]::Round($BackupSize, 2)) MB"
        Write-Log "  File: $BackupFile"

        return $true
    }
    catch {
        Write-Error-Log "Backup failed: $_"
        return $false
    }
    finally {
        # Clear password
        $env:PGPASSWORD = $null

        # Cleanup temp file if exists
        if (Test-Path $tempSql) {
            Remove-Item $tempSql -Force -ErrorAction SilentlyContinue
        }
    }
}

function Remove-OldBackups {
    Write-Log "Cleaning up backups older than $KeepDays days..."

    $cutoffDate = (Get-Date).AddDays(-$KeepDays)
    $oldBackups = Get-ChildItem -Path $BackupDir -Filter "ipodhan_*.sql.gz" |
                  Where-Object { $_.LastWriteTime -lt $cutoffDate }

    $deletedCount = 0
    foreach ($backup in $oldBackups) {
        Write-Log "  Deleting: $($backup.Name)"
        Remove-Item $backup.FullName -Force
        $deletedCount++
    }

    Write-Log "✓ Cleaned up $deletedCount old backup(s)"
}

function Invoke-CloudUpload {
    if (-not $UploadToCloud) {
        return $true
    }

    if ([string]::IsNullOrEmpty($CloudBucket)) {
        Write-Error-Log "Cloud bucket not configured. Skipping upload."
        return $false
    }

    Write-Log "Uploading backup to cloud storage ($CloudProvider)..."

    try {
        switch ($CloudProvider) {
            "s3" {
                if (-not (Get-Command "aws" -ErrorAction SilentlyContinue)) {
                    throw "AWS CLI not found"
                }
                aws s3 cp "$BackupFile" "s3://$CloudBucket/database-backups/$(Split-Path $BackupFile -Leaf)"
            }
            "gcs" {
                if (-not (Get-Command "gsutil" -ErrorAction SilentlyContinue)) {
                    throw "gsutil not found"
                }
                gsutil cp "$BackupFile" "gs://$CloudBucket/database-backups/$(Split-Path $BackupFile -Leaf)"
            }
            "azure" {
                if (-not (Get-Command "az" -ErrorAction SilentlyContinue)) {
                    throw "Azure CLI not found"
                }
                az storage blob upload `
                    --account-name $CloudBucket `
                    --container-name database-backups `
                    --name "$(Split-Path $BackupFile -Leaf)" `
                    --file "$BackupFile"
            }
            default {
                throw "Unknown cloud provider: $CloudProvider"
            }
        }

        Write-Log "✓ Backup uploaded to cloud storage"
        return $true
    }
    catch {
        Write-Error-Log "Cloud upload failed: $_"
        return $false
    }
}

function Test-BackupIntegrity {
    Write-Log "Verifying backup integrity..."

    try {
        if (Get-Command "7z" -ErrorAction SilentlyContinue) {
            $result = 7z t "$BackupFile" 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Log "✓ Backup file is valid"
                return $true
            }
        } else {
            gzip -t "$BackupFile" 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Log "✓ Backup file is valid"
                return $true
            }
        }

        Write-Error-Log "Backup file is corrupted"
        return $false
    }
    catch {
        Write-Error-Log "Backup verification failed: $_"
        return $false
    }
}

function Show-BackupSummary {
    Write-Log "==================================="
    Write-Log "Backup Summary"
    Write-Log "==================================="
    Write-Log "Timestamp: $Timestamp"
    Write-Log "Backup File: $BackupFile"

    $size = (Get-Item $BackupFile).Length / 1MB
    Write-Log "Backup Size: $([math]::Round($size, 2)) MB"

    Write-Log "Database: $DbName@$DbHost:$DbPort"
    Write-Log "Retention: $KeepDays days"

    if ($UploadToCloud) {
        Write-Log "Cloud Upload: Enabled ($CloudProvider)"
    } else {
        Write-Log "Cloud Upload: Disabled"
    }

    Write-Log "==================================="
}

# ==================== MAIN SCRIPT ====================

Write-Log "=========================================="
Write-Log "IPODhan Database Backup Script (Windows)"
Write-Log "=========================================="

# Check requirements
Test-Requirements

# Create backup directory
New-BackupDirectory

# Perform backup
if (-not (Invoke-Backup)) {
    Write-Error-Log "Backup failed"
    exit 1
}

# Verify backup
if (-not (Test-BackupIntegrity)) {
    Write-Error-Log "Backup verification failed"
    exit 1
}

# Upload to cloud (if enabled)
if (-not (Invoke-CloudUpload)) {
    Write-Error-Log "Cloud upload failed (continuing anyway)"
}

# Cleanup old backups
Remove-OldBackups

# Show summary
Show-BackupSummary

Write-Log "✓ Backup completed successfully"

exit 0
