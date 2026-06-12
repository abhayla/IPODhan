@echo off
set PGPASSWORD=%DB_PASSWORD%
set PG_BIN=C:\Program Files\PostgreSQL\16\bin

echo [Step 7] Verifying database 'ipodhan' exists...
"%PG_BIN%\psql.exe" -U postgres -l | findstr "ipodhan"
if %errorlevel% neq 0 (
    echo [WARNING] Database 'ipodhan' not found
    echo Creating database 'ipodhan'...
    "%PG_BIN%\psql.exe" -U postgres -c "CREATE DATABASE ipodhan;"
    echo [OK] Database 'ipodhan' created
) else (
    echo [OK] Database 'ipodhan' exists
)
echo.

echo [Step 8] Running database migration...
set MIGRATION_FILE=C:\Apps\IPODhan\infrastructure\database\migrations\002_enhanced_ipo_schema.sql
if exist "%MIGRATION_FILE%" (
    "%PG_BIN%\psql.exe" -U postgres -d ipodhan -f "%MIGRATION_FILE%"
    echo [OK] Migration completed
) else (
    echo [WARNING] Migration file not found
)
echo.

echo [Step 9] Restarting PostgreSQL service...
net stop postgresql-x64-16
timeout /t 3
net start postgresql-x64-16
echo [OK] Service restarted
echo.
echo Setup complete!
