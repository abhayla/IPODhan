@echo off
REM ============================================================================
REM Setup Remote PostgreSQL Database Access on Windows Server 2022
REM ============================================================================
REM Purpose: Configure PostgreSQL 16 to accept remote connections from local machine
REM Target Server: 103.118.16.189 (Windows Server 2022)
REM ============================================================================

echo.
echo ============================================================================
echo  PostgreSQL Remote Access Configuration for Windows Server 2022
echo ============================================================================
echo.

REM Set PostgreSQL path
set PG_DIR=C:\Program Files\PostgreSQL\16
set PG_DATA=%PG_DIR%\data
set PG_BIN=%PG_DIR%\bin

REM ============================================================================
REM Step 1: Verify PostgreSQL is installed
REM ============================================================================
echo [Step 1] Verifying PostgreSQL installation...
if not exist "%PG_BIN%\psql.exe" (
    echo [ERROR] PostgreSQL 16 not found at: %PG_DIR%
    echo Please install PostgreSQL 16 or update PG_DIR variable
    pause
    exit /b 1
)
echo [OK] PostgreSQL found at: %PG_DIR%
echo.

REM ============================================================================
REM Step 2: Check if PostgreSQL service is running
REM ============================================================================
echo [Step 2] Checking PostgreSQL service status...
sc query postgresql-x64-16 | find "RUNNING" >nul
if %errorlevel% neq 0 (
    echo [WARNING] PostgreSQL service is not running
    echo Starting PostgreSQL service...
    net start postgresql-x64-16
    timeout /t 5 >nul
) else (
    echo [OK] PostgreSQL service is running
)
echo.

REM ============================================================================
REM Step 3: Backup current configuration files
REM ============================================================================
echo [Step 3] Backing up configuration files...
if not exist "%PG_DATA%\backups" mkdir "%PG_DATA%\backups"
copy "%PG_DATA%\postgresql.conf" "%PG_DATA%\backups\postgresql.conf.backup.%date:~-4,4%%date:~-10,2%%date:~-7,2%" >nul
copy "%PG_DATA%\pg_hba.conf" "%PG_DATA%\backups\pg_hba.conf.backup.%date:~-4,4%%date:~-10,2%%date:~-7,2%" >nul
echo [OK] Configuration files backed up to: %PG_DATA%\backups
echo.

REM ============================================================================
REM Step 4: Configure postgresql.conf for remote connections
REM ============================================================================
echo [Step 4] Configuring postgresql.conf for remote access...
echo.
echo Current setting:
findstr /C:"listen_addresses" "%PG_DATA%\postgresql.conf" | findstr /V "^#"

REM Check if already configured
findstr /C:"listen_addresses = '*'" "%PG_DATA%\postgresql.conf" >nul
if %errorlevel% equ 0 (
    echo [OK] listen_addresses already set to '*'
) else (
    echo.
    echo Updating listen_addresses to accept all connections...

    REM Comment out existing listen_addresses
    powershell -Command "(Get-Content '%PG_DATA%\postgresql.conf') -replace '^listen_addresses', '#listen_addresses' | Set-Content '%PG_DATA%\postgresql.conf'"

    REM Add new listen_addresses at the end
    echo listen_addresses = '*' >> "%PG_DATA%\postgresql.conf"
    echo [OK] listen_addresses set to '*'
)
echo.

REM ============================================================================
REM Step 5: Configure pg_hba.conf for remote authentication
REM ============================================================================
echo [Step 5] Configuring pg_hba.conf for remote authentication...
echo.

REM Check if remote access rule already exists
findstr /C:"# Remote access for IPODhan" "%PG_DATA%\pg_hba.conf" >nul
if %errorlevel% equ 0 (
    echo [OK] Remote access rules already configured
) else (
    echo Adding remote access rules...
    echo. >> "%PG_DATA%\pg_hba.conf"
    echo # Remote access for IPODhan >> "%PG_DATA%\pg_hba.conf"
    echo host    ipodhan         postgres        0.0.0.0/0               scram-sha-256 >> "%PG_DATA%\pg_hba.conf"
    echo host    all             postgres        0.0.0.0/0               scram-sha-256 >> "%PG_DATA%\pg_hba.conf"
    echo [OK] Remote access rules added
)
echo.

REM ============================================================================
REM Step 6: Configure Windows Firewall
REM ============================================================================
echo [Step 6] Configuring Windows Firewall...
echo.

REM Check if firewall rule exists
netsh advfirewall firewall show rule name="PostgreSQL" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Firewall rule 'PostgreSQL' already exists
    echo Current rule:
    netsh advfirewall firewall show rule name="PostgreSQL"
) else (
    echo Creating firewall rule to allow PostgreSQL port 5432...
    netsh advfirewall firewall add rule name="PostgreSQL" dir=in action=allow protocol=TCP localport=5432
    echo [OK] Firewall rule created successfully
)
echo.

REM ============================================================================
REM Step 7: Verify database 'ipodhan' exists
REM ============================================================================
echo [Step 7] Verifying database 'ipodhan' exists...
echo.
"%PG_BIN%\psql.exe" -U postgres -l | findstr "ipodhan" >nul
if %errorlevel% neq 0 (
    echo [WARNING] Database 'ipodhan' not found
    echo Creating database 'ipodhan'...
    "%PG_BIN%\psql.exe" -U postgres -c "CREATE DATABASE ipodhan;"
    echo [OK] Database 'ipodhan' created
) else (
    echo [OK] Database 'ipodhan' exists
)
echo.

REM ============================================================================
REM Step 8: Run database migration (Story 1.2)
REM ============================================================================
echo [Step 8] Running database migration for Story 1.2...
echo.

set MIGRATION_FILE=%~dp0infrastructure\database\migrations\002_enhanced_ipo_schema.sql

if not exist "%MIGRATION_FILE%" (
    echo [WARNING] Migration file not found: %MIGRATION_FILE%
    echo Please ensure the migration file exists before running
    echo Migration will need to be run manually later
) else (
    echo Running migration: 002_enhanced_ipo_schema.sql
    echo.
    "%PG_BIN%\psql.exe" -U postgres -d ipodhan -f "%MIGRATION_FILE%"

    if %errorlevel% equ 0 (
        echo.
        echo [OK] Database migration completed successfully
        echo.
        echo Verifying new tables...
        "%PG_BIN%\psql.exe" -U postgres -d ipodhan -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('ipo_details', 'ipo_financials', 'gmp_tracking', 'pipeline_status') ORDER BY table_name;"
    ) else (
        echo.
        echo [ERROR] Database migration failed
        echo Please check the error messages above
    )
)
echo.

REM ============================================================================
REM Step 9: Restart PostgreSQL service
REM ============================================================================
echo [Step 9] Restarting PostgreSQL service to apply changes...
echo.
net stop postgresql-x64-16
timeout /t 3 >nul
net start postgresql-x64-16
timeout /t 5 >nul
echo [OK] PostgreSQL service restarted
echo.

REM ============================================================================
REM Step 10: Display connection information
REM ============================================================================
echo.
echo ============================================================================
echo  Configuration Complete!
echo ============================================================================
echo.
echo PostgreSQL is now configured for remote connections.
echo.
echo Connection Details:
echo -------------------
echo Host:     103.118.16.189
echo Port:     5432
echo Database: ipodhan
echo User:     postgres
echo Password: [You will need to enter this when connecting]
echo.
echo Connection String for Local Machine:
echo -----------------------------------
echo postgresql://postgres:PASSWORD@103.118.16.189:5432/ipodhan
echo.
echo Test Connection from Local Machine:
echo -----------------------------------
echo psql -h 103.118.16.189 -U postgres -d ipodhan
echo.
echo Update your local .env file with:
echo ---------------------------------
echo DB_HOST=103.118.16.189
echo DB_PORT=5432
echo DB_NAME=ipodhan
echo DB_USER=postgres
echo DB_PASSWORD=your_password_here
echo.
echo ============================================================================
echo  Next Steps:
echo ============================================================================
echo.
echo 1. Test connection from your local machine:
echo    psql -h 103.118.16.189 -U postgres -d ipodhan
echo.
echo 2. Update local .env file with remote database connection details
echo.
echo 3. Run pipeline locally:
echo    python main.py run-full
echo.
echo 4. Monitor health:
echo    python main.py health-check
echo.
echo ============================================================================

pause
