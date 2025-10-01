@echo off
REM Database Migration Script for Windows
REM Run this script to apply database migrations

echo ============================================
echo IPODhan Database Migration Script
echo ============================================
echo.

REM Set PostgreSQL path (adjust if needed)
set PSQL_PATH="C:\Program Files\PostgreSQL\16\bin\psql.exe"

echo Step 1: Testing database connection...
%PSQL_PATH% -h localhost -U postgres -d ipodhan -c "SELECT version();"

if errorlevel 1 (
    echo ERROR: Could not connect to database
    echo Please ensure PostgreSQL is running and credentials are correct
    pause
    exit /b 1
)

echo.
echo Step 2: Running migration 002_enhanced_ipo_schema.sql...
echo.

%PSQL_PATH% -h localhost -U postgres -d ipodhan -f ..\infrastructure\database\migrations\002_enhanced_ipo_schema.sql

if errorlevel 1 (
    echo ERROR: Migration failed
    pause
    exit /b 1
)

echo.
echo ============================================
echo Migration completed successfully!
echo ============================================
echo.
echo Verifying new tables...
%PSQL_PATH% -h localhost -U postgres -d ipodhan -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('ipo_details', 'ipo_financials', 'gmp_tracking', 'pipeline_status') ORDER BY table_name;"

echo.
echo Verifying materialized view...
%PSQL_PATH% -h localhost -U postgres -d ipodhan -c "SELECT matviewname FROM pg_matviews WHERE matviewname = 'gmp_current';"

echo.
echo ============================================
echo All done! Press any key to exit...
pause
