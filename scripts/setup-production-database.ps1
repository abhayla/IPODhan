# ================================================================
# IPODhan Production Database Setup Script
# ================================================================
# Story: 8.4b - Production Deployment - Production Server Execution
# Purpose: Automated database setup for shared PostgreSQL server
# Target: Windows Server 2022 VPS (103.118.16.189)
#
# IMPORTANT: This is for a SHARED PostgreSQL server
# This script creates a NEW database named 'ipodhan'
# ================================================================

param(
    [Parameter(Mandatory=$false)]
    [string]$PostgresPassword,

    [Parameter(Mandatory=$false)]
    [switch]$DryRun,

    [Parameter(Mandatory=$false)]
    [switch]$SkipPasswordGeneration
)

# ================================================================
# Configuration
# ================================================================

$ErrorActionPreference = "Stop"
$WarningPreference = "Continue"

$DB_NAME = "ipodhan"
$DB_USER = "ipodhan_user"
$DB_HOST = "localhost"
$DB_PORT = 5432

# ================================================================
# Functions
# ================================================================

function Write-Header {
    param([string]$Message)
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host $Message -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan
}

function Write-Step {
    param([string]$Message)
    Write-Host "`n$Message" -ForegroundColor Yellow
}

function Write-Success {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
}

function Write-Info {
    param([string]$Message)
    Write-Host "→ $Message" -ForegroundColor Cyan
}

function Generate-SecurePassword {
    param([int]$Length = 32)

    Add-Type -AssemblyName System.Web
    $password = [System.Web.Security.Membership]::GeneratePassword($Length, 8)

    # Ensure password doesn't contain problematic characters for shell
    $password = $password -replace '[\\`"$]', ''

    return $password
}

function Test-PostgreSQLConnection {
    param(
        [string]$Host,
        [string]$User,
        [string]$Password
    )

    $env:PGPASSWORD = $Password
    $result = psql -h $Host -U $User -c "SELECT 1;" 2>$null
    $env:PGPASSWORD = $null

    return $LASTEXITCODE -eq 0
}

function Test-DatabaseExists {
    param(
        [string]$Host,
        [string]$User,
        [string]$Password,
        [string]$DatabaseName
    )

    $env:PGPASSWORD = $Password
    $result = psql -h $Host -U $User -l 2>$null | Select-String $DatabaseName
    $env:PGPASSWORD = $null

    return $null -ne $result
}

# ================================================================
# Main Script
# ================================================================

Write-Header "IPODhan Production Database Setup"

# Check if dry run
if ($DryRun) {
    Write-Host "⚠ DRY RUN MODE - No changes will be made" -ForegroundColor Yellow
}

# ================================================================
# Step 1: Prerequisites Check
# ================================================================

Write-Step "Step 1: Checking Prerequisites"

# Check if psql is available
try {
    $psqlVersion = psql --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Success "PostgreSQL client installed: $psqlVersion"
    } else {
        throw "psql not found"
    }
} catch {
    Write-Error "PostgreSQL client (psql) not found in PATH"
    Write-Info "Install PostgreSQL or add psql to PATH"
    exit 1
}

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
    Write-Success "Running as Administrator"
} else {
    Write-Error "This script must be run as Administrator"
    exit 1
}

# Create secure directory if doesn't exist
$secureDir = "C:\secure"
if (-not (Test-Path $secureDir)) {
    New-Item -ItemType Directory -Path $secureDir -Force | Out-Null
    Write-Success "Created secure directory: $secureDir"
} else {
    Write-Success "Secure directory exists: $secureDir"
}

# ================================================================
# Step 2: PostgreSQL Connection Test
# ================================================================

Write-Step "Step 2: Testing PostgreSQL Connection"

# Get postgres password if not provided
if (-not $PostgresPassword) {
    $PostgresPassword = Read-Host -Prompt "Enter PostgreSQL 'postgres' user password" -AsSecureString
    $PostgresPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($PostgresPassword))
}

# Test connection
Write-Info "Testing connection to PostgreSQL as 'postgres' user..."
if (Test-PostgreSQLConnection -Host $DB_HOST -User "postgres" -Password $PostgresPassword) {
    Write-Success "Successfully connected to PostgreSQL"
} else {
    Write-Error "Failed to connect to PostgreSQL"
    Write-Info "Verify PostgreSQL is running and password is correct"
    exit 1
}

# ================================================================
# Step 3: Check if Database Already Exists
# ================================================================

Write-Step "Step 3: Checking Existing Database"

if (Test-DatabaseExists -Host $DB_HOST -User "postgres" -Password $PostgresPassword -DatabaseName $DB_NAME) {
    Write-Error "Database '$DB_NAME' already exists!"
    Write-Info "This script creates a NEW database. If you want to recreate:"
    Write-Info "  1. Backup existing database: pg_dump -U postgres -d $DB_NAME > backup.sql"
    Write-Info "  2. Drop existing database: DROP DATABASE $DB_NAME;"
    Write-Info "  3. Run this script again"

    $continue = Read-Host -Prompt "`nDo you want to continue with existing database? (yes/no)"
    if ($continue -ne "yes") {
        Write-Info "Exiting without changes"
        exit 0
    }

    Write-Info "Continuing with existing database..."
} else {
    Write-Success "Database '$DB_NAME' does not exist - will create"
}

# ================================================================
# Step 4: Generate Database User Password
# ================================================================

Write-Step "Step 4: Generating Database User Password"

if ($SkipPasswordGeneration) {
    Write-Info "Skipping password generation (using existing password)"
    $dbPassword = Read-Host -Prompt "Enter password for database user '$DB_USER'" -AsSecureString
    $dbPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbPassword))
} else {
    $dbPassword = Generate-SecurePassword -Length 32
    Write-Success "Generated secure password (32 characters)"
    Write-Info "Password will be saved to: $secureDir\ipodhan-db-password.txt"
}

# Save password to secure file
if (-not $DryRun) {
    $dbPassword | Out-File -FilePath "$secureDir\ipodhan-db-password.txt" -Encoding UTF8 -Force

    # Set restrictive permissions
    $acl = Get-Acl "$secureDir\ipodhan-db-password.txt"
    $acl.SetAccessRuleProtection($true, $false)
    $acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) | Out-Null }
    $adminRule = New-Object System.Security.AccessControl.FileSystemAccessRule("BUILTIN\Administrators", "FullControl", "Allow")
    $acl.AddAccessRule($adminRule)
    Set-Acl "$secureDir\ipodhan-db-password.txt" $acl

    Write-Success "Password saved securely"
} else {
    Write-Info "DRY RUN: Would save password to file"
}

# ================================================================
# Step 5: Create Database
# ================================================================

Write-Step "Step 5: Creating Database"

if (-not (Test-DatabaseExists -Host $DB_HOST -User "postgres" -Password $PostgresPassword -DatabaseName $DB_NAME)) {
    if ($DryRun) {
        Write-Info "DRY RUN: Would execute: CREATE DATABASE $DB_NAME;"
    } else {
        $env:PGPASSWORD = $PostgresPassword
        psql -h $DB_HOST -U postgres -c "CREATE DATABASE $DB_NAME;" 2>&1 | Out-Null
        $env:PGPASSWORD = $null

        if ($LASTEXITCODE -eq 0) {
            Write-Success "Database '$DB_NAME' created successfully"
        } else {
            Write-Error "Failed to create database"
            exit 1
        }
    }
} else {
    Write-Info "Database '$DB_NAME' already exists - skipping creation"
}

# ================================================================
# Step 6: Create Database User
# ================================================================

Write-Step "Step 6: Creating Database User"

$createUserSQL = @"
DO
\$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_user WHERE usename = '$DB_USER') THEN
        CREATE USER $DB_USER WITH PASSWORD '$dbPassword';
    END IF;
END
\$\$;

GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
"@

if ($DryRun) {
    Write-Info "DRY RUN: Would create user '$DB_USER' and grant privileges"
    Write-Info "SQL Preview:"
    Write-Host $createUserSQL -ForegroundColor Gray
} else {
    $env:PGPASSWORD = $PostgresPassword
    $createUserSQL | psql -h $DB_HOST -U postgres -d $DB_NAME 2>&1 | Out-Null
    $env:PGPASSWORD = $null

    if ($LASTEXITCODE -eq 0) {
        Write-Success "User '$DB_USER' created and privileges granted"
    } else {
        Write-Error "Failed to create user or grant privileges"
        exit 1
    }
}

# ================================================================
# Step 7: Grant Schema Permissions
# ================================================================

Write-Step "Step 7: Granting Schema Permissions"

$grantSchemaSQL = @"
GRANT ALL PRIVILEGES ON SCHEMA public TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO $DB_USER;
"@

if ($DryRun) {
    Write-Info "DRY RUN: Would grant schema permissions"
    Write-Info "SQL Preview:"
    Write-Host $grantSchemaSQL -ForegroundColor Gray
} else {
    $env:PGPASSWORD = $PostgresPassword
    $grantSchemaSQL | psql -h $DB_HOST -U postgres -d $DB_NAME 2>&1 | Out-Null
    $env:PGPASSWORD = $null

    if ($LASTEXITCODE -eq 0) {
        Write-Success "Schema permissions granted"
    } else {
        Write-Error "Failed to grant schema permissions"
        exit 1
    }
}

# ================================================================
# Step 8: Test User Connection
# ================================================================

Write-Step "Step 8: Testing User Connection"

if ($DryRun) {
    Write-Info "DRY RUN: Would test connection as '$DB_USER'"
} else {
    Write-Info "Testing connection as '$DB_USER'..."
    if (Test-PostgreSQLConnection -Host $DB_HOST -User $DB_USER -Password $dbPassword) {
        Write-Success "Successfully connected as '$DB_USER'"
    } else {
        Write-Error "Failed to connect as '$DB_USER'"
        Write-Info "Verify user was created correctly"
        exit 1
    }
}

# ================================================================
# Step 9: Generate DATABASE_URL
# ================================================================

Write-Step "Step 9: Generating DATABASE_URL"

$DATABASE_URL = "postgresql://${DB_USER}:${dbPassword}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

if ($DryRun) {
    Write-Info "DRY RUN: Would generate DATABASE_URL"
} else {
    $DATABASE_URL | Out-File -FilePath "$secureDir\ipodhan-database-url.txt" -Encoding UTF8 -Force

    # Set restrictive permissions
    $acl = Get-Acl "$secureDir\ipodhan-database-url.txt"
    $acl.SetAccessRuleProtection($true, $false)
    $acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) | Out-Null }
    $adminRule = New-Object System.Security.AccessControl.FileSystemAccessRule("BUILTIN\Administrators", "FullControl", "Allow")
    $acl.AddAccessRule($adminRule)
    Set-Acl "$secureDir\ipodhan-database-url.txt" $acl

    Write-Success "DATABASE_URL saved to: $secureDir\ipodhan-database-url.txt"
}

# ================================================================
# Step 10: Create Backup Script
# ================================================================

Write-Step "Step 10: Creating Backup Script"

$backupDir = "C:\backups\ipodhan"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    Write-Success "Created backup directory: $backupDir"
}

$backupScript = @"
# IPODhan Database Backup Script
# Auto-generated by setup-production-database.ps1

`$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
`$backupFile = "C:\backups\ipodhan\ipodhan-`$timestamp.sql"

Write-Host "Creating database backup..." -ForegroundColor Yellow

# Run pg_dump
pg_dump -h $DB_HOST -U postgres -d $DB_NAME > `$backupFile

# Verify backup created
if (Test-Path `$backupFile) {
    `$sizeМB = [math]::Round((Get-Item `$backupFile).Length / 1MB, 2)
    Write-Host "✓ Backup created successfully: `$backupFile (`$sizeMB MB)" -ForegroundColor Green
} else {
    Write-Host "✗ Backup FAILED!" -ForegroundColor Red
    exit 1
}

# Cleanup old backups (keep last 30 days)
Write-Host "Cleaning up old backups..." -ForegroundColor Yellow
Get-ChildItem -Path "C:\backups\ipodhan" -Filter "*.sql" |
    Where-Object { `$_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    ForEach-Object {
        Write-Host "  Removing old backup: `$(`$_.Name)" -ForegroundColor Gray
        Remove-Item `$_.FullName
    }

Write-Host "✓ Backup process complete" -ForegroundColor Green
"@

if ($DryRun) {
    Write-Info "DRY RUN: Would create backup script"
} else {
    $backupScript | Out-File -FilePath "$backupDir\backup-database.ps1" -Encoding UTF8 -Force
    Write-Success "Backup script created: $backupDir\backup-database.ps1"
}

# ================================================================
# Summary
# ================================================================

Write-Header "Database Setup Complete!"

if (-not $DryRun) {
    Write-Host "Database Configuration:" -ForegroundColor Cyan
    Write-Host "  Database Name: $DB_NAME" -ForegroundColor White
    Write-Host "  Database User: $DB_USER" -ForegroundColor White
    Write-Host "  Database Host: $DB_HOST" -ForegroundColor White
    Write-Host "  Database Port: $DB_PORT" -ForegroundColor White

    Write-Host "`nGenerated Files:" -ForegroundColor Cyan
    Write-Host "  Password: $secureDir\ipodhan-db-password.txt" -ForegroundColor White
    Write-Host "  DATABASE_URL: $secureDir\ipodhan-database-url.txt" -ForegroundColor White
    Write-Host "  Backup Script: $backupDir\backup-database.ps1" -ForegroundColor White

    Write-Host "`nDATABASE_URL for .env.production:" -ForegroundColor Yellow
    Write-Host $DATABASE_URL -ForegroundColor Cyan

    Write-Host "`nIMPORTANT:" -ForegroundColor Red
    Write-Host "  1. Save DATABASE_URL to .env.production" -ForegroundColor White
    Write-Host "  2. Keep password file secure (already restricted)" -ForegroundColor White
    Write-Host "  3. Test database connection before proceeding" -ForegroundColor White
    Write-Host "  4. Schedule regular backups using backup-database.ps1" -ForegroundColor White

    Write-Host "`nNext Steps:" -ForegroundColor Cyan
    Write-Host "  1. Update .env.production with DATABASE_URL" -ForegroundColor White
    Write-Host "  2. Run database migrations: npm run db:migrate (in web directory)" -ForegroundColor White
    Write-Host "  3. Verify tables created: psql -U $DB_USER -d $DB_NAME -c '\dt'" -ForegroundColor White
    Write-Host "  4. Proceed to Phase 2: Application Deployment" -ForegroundColor White
} else {
    Write-Host "DRY RUN COMPLETE - No changes were made" -ForegroundColor Yellow
    Write-Host "Run without -DryRun parameter to execute setup" -ForegroundColor Cyan
}

Write-Host ""
