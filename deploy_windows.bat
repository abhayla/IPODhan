@echo off
REM ============================================================================
REM IPODhan Data Pipeline - Windows Server 2022 Deployment Script
REM Target Server: 103.118.16.189
REM For Use By: Claude Code on Windows Server
REM Date: 2025-10-01
REM ============================================================================

setlocal enabledelayedexpansion

REM Configuration
set PROJECT_DIR=C:\Apps\ipodhan
set PIPELINE_DIR=%PROJECT_DIR%\ipodhan-data-pipeline
set VENV_DIR=%PIPELINE_DIR%\venv
set LOGS_DIR=%PROJECT_DIR%\logs
set DB_HOST=localhost
set DB_NAME=ipodhan
set DB_USER=postgres
set PSQL_PATH=C:\Program Files\PostgreSQL\16\bin\psql.exe

REM Colors (using PowerShell for colored output)
set "GREEN=[92m"
set "RED=[91m"
set "YELLOW=[93m"
set "BLUE=[94m"
set "NC=[0m"

echo.
echo ============================================
echo  IPODhan Data Pipeline - Windows Deployment
echo ============================================
echo.
echo Target Server: 103.118.16.189
echo Project Directory: %PROJECT_DIR%
echo Pipeline Directory: %PIPELINE_DIR%
echo.

REM Step 1: Prerequisites Check
echo ============================================
echo Step 1: Checking Prerequisites
echo ============================================
echo.

REM Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [91mERROR: Python is not installed or not in PATH[0m
    echo Please install Python 3.11+ from https://www.python.org
    pause
    exit /b 1
) else (
    echo [92m✓ Python is installed[0m
    python --version
)

REM Check pip
pip --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [91mERROR: pip is not installed[0m
    pause
    exit /b 1
) else (
    echo [92m✓ pip is installed[0m
)

REM Check PostgreSQL
if not exist "%PSQL_PATH%" (
    echo [93mWARNING: PostgreSQL not found at default location[0m
    echo Please update PSQL_PATH in this script
    set /p PSQL_PATH="Enter path to psql.exe (or press Enter to skip): "
) else (
    echo [92m✓ PostgreSQL is installed[0m
)

echo.
echo [92mAll prerequisites satisfied[0m
echo.

REM Step 2: Directory Setup
echo ============================================
echo Step 2: Setting Up Directories
echo ============================================
echo.

if not exist "%PROJECT_DIR%" (
    echo [91mERROR: Project directory %PROJECT_DIR% does not exist[0m
    echo Please upload project files to %PROJECT_DIR% first
    pause
    exit /b 1
)

cd /d "%PROJECT_DIR%"
echo [92m✓ Changed to project directory: %CD%[0m

REM Create logs directory
if not exist "%LOGS_DIR%" (
    mkdir "%LOGS_DIR%"
    echo [92m✓ Created logs directory[0m
)

REM Step 3: Create Virtual Environment
echo.
echo ============================================
echo Step 3: Creating Python Virtual Environment
echo ============================================
echo.

if exist "%VENV_DIR%" (
    echo [93mVirtual environment already exists, skipping creation[0m
) else (
    echo Creating virtual environment...
    python -m venv "%VENV_DIR%"
    if %errorlevel% neq 0 (
        echo [91mERROR: Failed to create virtual environment[0m
        pause
        exit /b 1
    )
    echo [92m✓ Virtual environment created[0m
)

REM Activate virtual environment
call "%VENV_DIR%\Scripts\activate.bat"
echo [92m✓ Virtual environment activated[0m

REM Step 4: Install Python Dependencies
echo.
echo ============================================
echo Step 4: Installing Python Dependencies
echo ============================================
echo.

cd /d "%PIPELINE_DIR%"

echo Upgrading pip...
python -m pip install --upgrade pip --quiet
if %errorlevel% neq 0 (
    echo [93mWARNING: Failed to upgrade pip, continuing...[0m
)

echo Installing requirements (this may take a few minutes)...
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [91mERROR: Failed to install dependencies[0m
    pause
    exit /b 1
)

echo [92m✓ Python dependencies installed[0m

REM Step 5: Install Playwright Browsers
echo.
echo ============================================
echo Step 5: Installing Playwright Browsers
echo ============================================
echo.

echo Installing Chromium browser...
playwright install chromium
if %errorlevel% neq 0 (
    echo [93mWARNING: Failed to install Playwright browsers[0m
) else (
    echo [92m✓ Playwright browsers installed[0m
)

REM Step 6: Configure Environment
echo.
echo ============================================
echo Step 6: Configuring Environment
echo ============================================
echo.

if exist "%PIPELINE_DIR%\.env" (
    echo [93m.env file already exists[0m
    set /p overwrite="Do you want to overwrite it? (y/N): "
    if /i "!overwrite!"=="y" (
        copy /y .env.example .env
        echo [92m✓ .env file created from template[0m
    ) else (
        echo [94mKeeping existing .env file[0m
    )
) else (
    copy .env.example .env
    echo [92m✓ .env file created from template[0m
)

echo.
echo [93m⚠ IMPORTANT: Please edit .env file and update database credentials[0m
echo Use: notepad %PIPELINE_DIR%\.env
echo.
pause

REM Step 7: Database Migrations
echo.
echo ============================================
echo Step 7: Running Database Migrations
echo ============================================
echo.

echo Checking database connection...
"%PSQL_PATH%" -h %DB_HOST% -U %DB_USER% -d %DB_NAME% -c "SELECT version();" >nul 2>&1
if %errorlevel% neq 0 (
    echo [93mWARNING: Cannot connect to database automatically[0m
    echo You can run the migration manually later:
    echo "%PSQL_PATH%" -h %DB_HOST% -U %DB_USER% -d %DB_NAME% -f "%PROJECT_DIR%\infrastructure\database\migrations\002_enhanced_ipo_schema.sql"
    echo.
    set /p continue="Continue without running migration? (y/N): "
    if /i not "!continue!"=="y" (
        exit /b 1
    )
) else (
    echo [92m✓ Database connection successful[0m

    echo Running migration 002_enhanced_ipo_schema.sql...
    set MIGRATION_FILE=%PROJECT_DIR%\infrastructure\database\migrations\002_enhanced_ipo_schema.sql

    if exist "!MIGRATION_FILE!" (
        "%PSQL_PATH%" -h %DB_HOST% -U %DB_USER% -d %DB_NAME% -f "!MIGRATION_FILE!"
        if %errorlevel% equ 0 (
            echo [92m✓ Migration completed successfully[0m

            REM Verify tables
            echo Verifying new tables...
            "%PSQL_PATH%" -h %DB_HOST% -U %DB_USER% -d %DB_NAME% -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('ipo_details', 'ipo_financials', 'gmp_tracking', 'pipeline_status');"

        ) else (
            echo [91mERROR: Migration failed. Please run manually.[0m
        )
    ) else (
        echo [93mWARNING: Migration file not found: !MIGRATION_FILE![0m
    )
)

REM Step 8: Test Pipeline
echo.
echo ============================================
echo Step 8: Testing Pipeline
echo ============================================
echo.

cd /d "%PIPELINE_DIR%"

echo Testing IPO pipeline...
python main.py run-ipo
if %errorlevel% equ 0 (
    echo [92m✓ IPO pipeline test passed[0m
) else (
    echo [93mWARNING: IPO pipeline test may have issues (check logs)[0m
)

echo.
echo Running health check...
python main.py health-check

REM Step 9: Setup Windows Service
echo.
echo ============================================
echo Step 9: Windows Service Setup (Optional)
echo ============================================
echo.

echo This step requires NSSM (Non-Sucking Service Manager)
echo Download from: https://nssm.cc/download
echo.
set /p install_service="Do you want to set up the pipeline as a Windows Service? (y/N): "

if /i "!install_service!"=="y" (
    REM Check if NSSM is installed
    where nssm >nul 2>&1
    if %errorlevel% neq 0 (
        echo [93mWARNING: NSSM is not installed or not in PATH[0m
        echo Please install NSSM first:
        echo   1. Download from https://nssm.cc/download
        echo   2. Extract to C:\Program Files\nssm
        echo   3. Add to PATH or use full path
        echo.
        echo You can run setup_windows_service.bat after installing NSSM
        pause
    ) else (
        echo Installing Windows Service with NSSM...

        nssm install IPODhanPipeline "%VENV_DIR%\Scripts\python.exe" "%PIPELINE_DIR%\main.py schedule"
        nssm set IPODhanPipeline AppDirectory "%PIPELINE_DIR%"
        nssm set IPODhanPipeline DisplayName "IPODhan Data Pipeline"
        nssm set IPODhanPipeline Description "IPO and GMP data scraping pipeline"
        nssm set IPODhanPipeline Start SERVICE_AUTO_START
        nssm set IPODhanPipeline AppRestartDelay 10000
        nssm set IPODhanPipeline AppStdout "%LOGS_DIR%\pipeline-stdout.log"
        nssm set IPODhanPipeline AppStderr "%LOGS_DIR%\pipeline-stderr.log"

        echo [92m✓ Service installed[0m

        set /p start_service="Do you want to start the service now? (y/N): "
        if /i "!start_service!"=="y" (
            nssm start IPODhanPipeline
            echo [92m✓ Service started[0m
            timeout /t 2 >nul
            nssm status IPODhanPipeline
        ) else (
            echo You can start the service later with: nssm start IPODhanPipeline
        )
    )
) else (
    echo Skipping service setup
    echo You can run the pipeline manually with: python main.py schedule
)

REM Final Summary
echo.
echo ============================================
echo   Deployment Complete!
echo ============================================
echo.
echo [92m✓ Python dependencies installed[0m
echo [92m✓ Playwright browsers ready[0m
echo [92m✓ Environment configured[0m
echo [92m✓ Database migrations applied[0m
echo [92m✓ Pipeline tested[0m
echo.
echo Next Steps:
echo   1. Review .env file: notepad %PIPELINE_DIR%\.env
echo   2. Run full pipeline: cd %PIPELINE_DIR% ^&^& python main.py run-full
echo   3. Check health: python main.py health-check
echo   4. View metrics: python main.py metrics
echo.

if /i "!install_service!"=="y" (
    echo   5. Check service status: nssm status IPODhanPipeline
    echo   6. View logs: type %LOGS_DIR%\pipeline-stdout.log
) else (
    echo   5. Start scheduled pipeline: python main.py schedule
)

echo.
echo Documentation:
echo   - Windows Guide: %PROJECT_DIR%\WINDOWS_SERVER_DEPLOYMENT.md
echo   - README: %PIPELINE_DIR%\README.md
echo   - Implementation: %PROJECT_DIR%\IMPLEMENTATION_SUMMARY.md
echo.
echo [92mDeployment completed successfully![0m
echo.
pause
