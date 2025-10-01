@echo off
REM ============================================================================
REM IPODhan Data Pipeline - Windows Service Setup Script
REM Uses NSSM (Non-Sucking Service Manager)
REM Target Server: 103.118.16.189 (Windows Server 2022)
REM ============================================================================

setlocal

REM Configuration - MODIFY THESE IF NEEDED
set PROJECT_DIR=C:\Apps\ipodhan
set PIPELINE_DIR=%PROJECT_DIR%\ipodhan-data-pipeline
set VENV_DIR=%PIPELINE_DIR%\venv
set LOGS_DIR=%PROJECT_DIR%\logs
set SERVICE_NAME=IPODhanPipeline

echo.
echo ============================================
echo  IPODhan Windows Service Setup
echo ============================================
echo.

REM Check if running as Administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [91mERROR: This script must be run as Administrator[0m
    echo Right-click and select "Run as Administrator"
    pause
    exit /b 1
)

echo [92m✓ Running as Administrator[0m

REM Check if NSSM is installed
where nssm >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [91mERROR: NSSM is not installed or not in PATH[0m
    echo.
    echo Please install NSSM first:
    echo   1. Download from: https://nssm.cc/download
    echo   2. Extract to: C:\Program Files\nssm
    echo   3. Add to PATH: C:\Program Files\nssm\win64
    echo.
    echo OR install via Chocolatey: choco install nssm
    echo.
    pause
    exit /b 1
)

echo [92m✓ NSSM is installed[0m

REM Check if directories exist
if not exist "%PIPELINE_DIR%" (
    echo [91mERROR: Pipeline directory not found: %PIPELINE_DIR%[0m
    echo Please run deploy_windows.bat first
    pause
    exit /b 1
)

if not exist "%VENV_DIR%" (
    echo [91mERROR: Virtual environment not found: %VENV_DIR%[0m
    echo Please run deploy_windows.bat first
    pause
    exit /b 1
)

echo [92m✓ Application directories found[0m

REM Create logs directory if it doesn't exist
if not exist "%LOGS_DIR%" (
    mkdir "%LOGS_DIR%"
    echo [92m✓ Created logs directory[0m
)

REM Check if service already exists
sc query "%SERVICE_NAME%" >nul 2>&1
if %errorlevel% equ 0 (
    echo.
    echo [93mWARNING: Service '%SERVICE_NAME%' already exists[0m
    set /p remove="Do you want to remove and recreate it? (y/N): "
    if /i "!remove!"=="y" (
        echo Stopping service...
        nssm stop "%SERVICE_NAME%"
        timeout /t 2 >nul
        echo Removing service...
        nssm remove "%SERVICE_NAME%" confirm
        timeout /t 2 >nul
        echo [92m✓ Existing service removed[0m
    ) else (
        echo Service setup cancelled
        pause
        exit /b 0
    )
)

REM Install service
echo.
echo ============================================
echo  Installing Windows Service
echo ============================================
echo.

echo Installing service '%SERVICE_NAME%'...
nssm install "%SERVICE_NAME%" "%VENV_DIR%\Scripts\python.exe" "%PIPELINE_DIR%\main.py schedule"
if %errorlevel% neq 0 (
    echo [91mERROR: Failed to install service[0m
    pause
    exit /b 1
)
echo [92m✓ Service installed[0m

echo Setting service parameters...

REM Set working directory
nssm set "%SERVICE_NAME%" AppDirectory "%PIPELINE_DIR%"
echo [92m✓ Working directory set[0m

REM Set display name and description
nssm set "%SERVICE_NAME%" DisplayName "IPODhan Data Pipeline"
nssm set "%SERVICE_NAME%" Description "Automated IPO and GMP data scraping pipeline for IPODhan platform"
echo [92m✓ Display name and description set[0m

REM Set startup type
nssm set "%SERVICE_NAME%" Start SERVICE_AUTO_START
echo [92m✓ Startup type set to Automatic[0m

REM Set restart policy
nssm set "%SERVICE_NAME%" AppRestartDelay 10000
nssm set "%SERVICE_NAME%" AppThrottle 1500
echo [92m✓ Restart policy configured (restart after 10 seconds)[0m

REM Configure logging
nssm set "%SERVICE_NAME%" AppStdout "%LOGS_DIR%\pipeline-stdout.log"
nssm set "%SERVICE_NAME%" AppStderr "%LOGS_DIR%\pipeline-stderr.log"
nssm set "%SERVICE_NAME%" AppRotateFiles 1
nssm set "%SERVICE_NAME%" AppRotateOnline 1
nssm set "%SERVICE_NAME%" AppRotateBytes 10485760
echo [92m✓ Logging configured (logs in %LOGS_DIR%)[0m

REM Set environment variables (if needed)
REM nssm set "%SERVICE_NAME%" AppEnvironmentExtra "PYTHONUNBUFFERED=1"

echo.
echo ============================================
echo  Service Configuration Complete
echo ============================================
echo.

REM Display service info
echo Service Name: %SERVICE_NAME%
echo Display Name: IPODhan Data Pipeline
echo Executable: %VENV_DIR%\Scripts\python.exe
echo Arguments: %PIPELINE_DIR%\main.py schedule
echo Working Directory: %PIPELINE_DIR%
echo Logs: %LOGS_DIR%
echo.

REM Ask to start service
set /p start_service="Do you want to start the service now? (y/N): "
if /i "%start_service%"=="y" (
    echo.
    echo Starting service...
    nssm start "%SERVICE_NAME%"
    if %errorlevel% equ 0 (
        echo [92m✓ Service started successfully[0m
        echo.
        echo Waiting for service to initialize...
        timeout /t 3 >nul
        echo.
        echo Service Status:
        nssm status "%SERVICE_NAME%"
        sc query "%SERVICE_NAME%"
    ) else (
        echo [91mERROR: Failed to start service[0m
        echo Check logs: %LOGS_DIR%\pipeline-stderr.log
    )
) else (
    echo.
    echo Service installed but not started
    echo To start manually: nssm start %SERVICE_NAME%
)

echo.
echo ============================================
echo  Service Management Commands
echo ============================================
echo.
echo Start service:      nssm start %SERVICE_NAME%
echo Stop service:       nssm stop %SERVICE_NAME%
echo Restart service:    nssm restart %SERVICE_NAME%
echo Service status:     nssm status %SERVICE_NAME%
echo Edit service:       nssm edit %SERVICE_NAME%
echo Remove service:     nssm remove %SERVICE_NAME%
echo.
echo Windows commands:
echo Service status:     sc query %SERVICE_NAME%
echo Start service:      net start %SERVICE_NAME%
echo Stop service:       net stop %SERVICE_NAME%
echo.
echo View logs:
echo   type %LOGS_DIR%\pipeline-stdout.log
echo   type %LOGS_DIR%\pipeline-stderr.log
echo.
echo View live logs (PowerShell):
echo   Get-Content %LOGS_DIR%\pipeline-stdout.log -Wait -Tail 50
echo.
echo ============================================
echo  Setup Complete!
echo ============================================
echo.
pause
