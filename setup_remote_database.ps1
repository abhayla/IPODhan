# ============================================================================
# Setup Remote PostgreSQL Database Access on Windows Server 2022
# ============================================================================
# Purpose: Configure PostgreSQL 16 to accept remote connections from local machine
# Target Server: 103.118.16.189 (Windows Server 2022)
# ============================================================================

Write-Host ""
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host " PostgreSQL Remote Access Configuration for Windows Server 2022" -ForegroundColor Cyan
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""

# Set PostgreSQL path
$PG_DIR = "C:\Program Files\PostgreSQL\16"
$PG_DATA = "$PG_DIR\data"
$PG_BIN = "$PG_DIR\bin"

# ============================================================================
# Step 1: Verify PostgreSQL is installed
# ============================================================================
Write-Host "[Step 1] Verifying PostgreSQL installation..." -ForegroundColor Yellow

if (-not (Test-Path "$PG_BIN\psql.exe")) {
    Write-Host "[ERROR] PostgreSQL 16 not found at: $PG_DIR" -ForegroundColor Red
    Write-Host "Please install PostgreSQL 16 or update PG_DIR variable" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] PostgreSQL found at: $PG_DIR" -ForegroundColor Green
Write-Host ""

# ============================================================================
# Step 2: Check if PostgreSQL service is running
# ============================================================================
Write-Host "[Step 2] Checking PostgreSQL service status..." -ForegroundColor Yellow

$service = Get-Service -Name "postgresql-x64-16" -ErrorAction SilentlyContinue
if ($service -eq $null) {
    Write-Host "[ERROR] PostgreSQL service 'postgresql-x64-16' not found" -ForegroundColor Red
    exit 1
}

if ($service.Status -ne "Running") {
    Write-Host "[WARNING] PostgreSQL service is not running" -ForegroundColor Yellow
    Write-Host "Starting PostgreSQL service..." -ForegroundColor Yellow
    Start-Service -Name "postgresql-x64-16"
    Start-Sleep -Seconds 5
    Write-Host "[OK] PostgreSQL service started" -ForegroundColor Green
} else {
    Write-Host "[OK] PostgreSQL service is running" -ForegroundColor Green
}
Write-Host ""

# ============================================================================
# Step 3: Backup current configuration files
# ============================================================================
Write-Host "[Step 3] Backing up configuration files..." -ForegroundColor Yellow

$backupDir = "$PG_DATA\backups"
if (-not (Test-Path $backupDir)) {
    New-Item -Path $backupDir -ItemType Directory -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item "$PG_DATA\postgresql.conf" "$backupDir\postgresql.conf.backup.$timestamp" -Force
Copy-Item "$PG_DATA\pg_hba.conf" "$backupDir\pg_hba.conf.backup.$timestamp" -Force

Write-Host "[OK] Configuration files backed up to: $backupDir" -ForegroundColor Green
Write-Host ""

# ============================================================================
# Step 4: Configure postgresql.conf for remote connections
# ============================================================================
Write-Host "[Step 4] Configuring postgresql.conf for remote access..." -ForegroundColor Yellow
Write-Host ""

# Check if already configured
$postgresqlConf = Get-Content "$PG_DATA\postgresql.conf"
$listenConfigured = $postgresqlConf | Where-Object { $_ -match "^listen_addresses\s*=\s*'\*'" }

if ($listenConfigured) {
    Write-Host "[OK] listen_addresses already set to '*'" -ForegroundColor Green
} else {
    Write-Host "Updating listen_addresses to accept all connections..." -ForegroundColor Yellow

    # Comment out existing listen_addresses
    $postgresqlConf = $postgresqlConf | ForEach-Object {
        if ($_ -match "^listen_addresses") {
            "#$_"
        } else {
            $_
        }
    }

    # Add new listen_addresses at the end
    $postgresqlConf += ""
    $postgresqlConf += "# Remote access configuration - Added by setup script"
    $postgresqlConf += "listen_addresses = '*'"

    Set-Content -Path "$PG_DATA\postgresql.conf" -Value $postgresqlConf
    Write-Host "[OK] listen_addresses set to '*'" -ForegroundColor Green
}
Write-Host ""

# ============================================================================
# Step 5: Configure pg_hba.conf for remote authentication
# ============================================================================
Write-Host "[Step 5] Configuring pg_hba.conf for remote authentication..." -ForegroundColor Yellow
Write-Host ""

$pgHbaConf = Get-Content "$PG_DATA\pg_hba.conf"
$remoteAccessConfigured = $pgHbaConf | Where-Object { $_ -match "# Remote access for IPODhan" }

if ($remoteAccessConfigured) {
    Write-Host "[OK] Remote access rules already configured" -ForegroundColor Green
} else {
    Write-Host "Adding remote access rules..." -ForegroundColor Yellow

    $pgHbaConf += ""
    $pgHbaConf += "# Remote access for IPODhan"
    $pgHbaConf += "host    ipodhan         postgres        0.0.0.0/0               scram-sha-256"
    $pgHbaConf += "host    all             postgres        0.0.0.0/0               scram-sha-256"

    Set-Content -Path "$PG_DATA\pg_hba.conf" -Value $pgHbaConf
    Write-Host "[OK] Remote access rules added" -ForegroundColor Green
}
Write-Host ""

# ============================================================================
# Step 6: Configure Windows Firewall
# ============================================================================
Write-Host "[Step 6] Configuring Windows Firewall..." -ForegroundColor Yellow
Write-Host ""

$firewallRule = Get-NetFirewallRule -DisplayName "PostgreSQL" -ErrorAction SilentlyContinue

if ($firewallRule) {
    Write-Host "[OK] Firewall rule 'PostgreSQL' already exists" -ForegroundColor Green
} else {
    Write-Host "Creating firewall rule to allow PostgreSQL port 5432..." -ForegroundColor Yellow
    New-NetFirewallRule -DisplayName "PostgreSQL" -Direction Inbound -Protocol TCP -LocalPort 5432 -Action Allow | Out-Null
    Write-Host "[OK] Firewall rule created successfully" -ForegroundColor Green
}
Write-Host ""

# ============================================================================
# Step 7: Verify database 'ipodhan' exists
# ============================================================================
Write-Host "[Step 7] Verifying database 'ipodhan' exists..." -ForegroundColor Yellow
Write-Host ""

$env:PGPASSWORD = Read-Host "Enter PostgreSQL 'postgres' user password" -AsSecureString
$PGPASSWORD_Plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($env:PGPASSWORD))

$databases = & "$PG_BIN\psql.exe" -U postgres -l -t 2>&1 | Select-String "ipodhan"

if (-not $databases) {
    Write-Host "[WARNING] Database 'ipodhan' not found" -ForegroundColor Yellow
    Write-Host "Creating database 'ipodhan'..." -ForegroundColor Yellow

    $env:PGPASSWORD = $PGPASSWORD_Plain
    & "$PG_BIN\psql.exe" -U postgres -c "CREATE DATABASE ipodhan;" 2>&1

    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Database 'ipodhan' created" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Failed to create database" -ForegroundColor Red
    }
} else {
    Write-Host "[OK] Database 'ipodhan' exists" -ForegroundColor Green
}
Write-Host ""

# ============================================================================
# Step 8: Run database migration (Story 1.2)
# ============================================================================
Write-Host "[Step 8] Running database migration for Story 1.2..." -ForegroundColor Yellow
Write-Host ""

$migrationFile = Join-Path $PSScriptRoot "infrastructure\database\migrations\002_enhanced_ipo_schema.sql"

if (-not (Test-Path $migrationFile)) {
    Write-Host "[WARNING] Migration file not found: $migrationFile" -ForegroundColor Yellow
    Write-Host "Please ensure the migration file exists before running" -ForegroundColor Yellow
    Write-Host "Migration will need to be run manually later" -ForegroundColor Yellow
} else {
    Write-Host "Running migration: 002_enhanced_ipo_schema.sql" -ForegroundColor Yellow
    Write-Host ""

    $env:PGPASSWORD = $PGPASSWORD_Plain
    & "$PG_BIN\psql.exe" -U postgres -d ipodhan -f $migrationFile 2>&1

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "[OK] Database migration completed successfully" -ForegroundColor Green
        Write-Host ""
        Write-Host "Verifying new tables..." -ForegroundColor Yellow

        $env:PGPASSWORD = $PGPASSWORD_Plain
        & "$PG_BIN\psql.exe" -U postgres -d ipodhan -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('ipo_details', 'ipo_financials', 'gmp_tracking', 'pipeline_status') ORDER BY table_name;" 2>&1
    } else {
        Write-Host ""
        Write-Host "[ERROR] Database migration failed" -ForegroundColor Red
        Write-Host "Please check the error messages above" -ForegroundColor Red
    }
}
Write-Host ""

# ============================================================================
# Step 9: Restart PostgreSQL service
# ============================================================================
Write-Host "[Step 9] Restarting PostgreSQL service to apply changes..." -ForegroundColor Yellow
Write-Host ""

Restart-Service -Name "postgresql-x64-16" -Force
Start-Sleep -Seconds 5

$service = Get-Service -Name "postgresql-x64-16"
if ($service.Status -eq "Running") {
    Write-Host "[OK] PostgreSQL service restarted successfully" -ForegroundColor Green
} else {
    Write-Host "[ERROR] PostgreSQL service failed to restart" -ForegroundColor Red
}
Write-Host ""

# Clear password from environment
Remove-Variable -Name PGPASSWORD_Plain -ErrorAction SilentlyContinue
$env:PGPASSWORD = $null

# ============================================================================
# Step 10: Display connection information
# ============================================================================
Write-Host ""
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host " Configuration Complete!" -ForegroundColor Cyan
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "PostgreSQL is now configured for remote connections." -ForegroundColor Green
Write-Host ""
Write-Host "Connection Details:" -ForegroundColor Yellow
Write-Host "-------------------"
Write-Host "Host:     103.118.16.189"
Write-Host "Port:     5432"
Write-Host "Database: ipodhan"
Write-Host "User:     postgres"
Write-Host "Password: [You will need to enter this when connecting]"
Write-Host ""
Write-Host "Connection String for Local Machine:" -ForegroundColor Yellow
Write-Host "-----------------------------------"
Write-Host "postgresql://postgres:PASSWORD@103.118.16.189:5432/ipodhan"
Write-Host ""
Write-Host "Test Connection from Local Machine:" -ForegroundColor Yellow
Write-Host "-----------------------------------"
Write-Host "psql -h 103.118.16.189 -U postgres -d ipodhan"
Write-Host ""
Write-Host "Update your local .env file with:" -ForegroundColor Yellow
Write-Host "---------------------------------"
Write-Host "DB_HOST=103.118.16.189"
Write-Host "DB_PORT=5432"
Write-Host "DB_NAME=ipodhan"
Write-Host "DB_USER=postgres"
Write-Host "DB_PASSWORD=your_password_here"
Write-Host ""
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host " Next Steps:" -ForegroundColor Cyan
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Test connection from your local machine:"
Write-Host "   psql -h 103.118.16.189 -U postgres -d ipodhan"
Write-Host ""
Write-Host "2. Update local .env file with remote database connection details"
Write-Host ""
Write-Host "3. Run pipeline locally:"
Write-Host "   python main.py run-full"
Write-Host ""
Write-Host "4. Monitor health:"
Write-Host "   python main.py health-check"
Write-Host ""
Write-Host "============================================================================" -ForegroundColor Cyan
Write-Host ""
