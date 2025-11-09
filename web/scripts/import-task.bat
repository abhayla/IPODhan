@echo off
REM Import Data Quality Report Task to Windows Task Scheduler

echo Importing task to Windows Task Scheduler...

schtasks /Create /TN "IPODhan\Weekly Data Quality Report" /XML "%~dp0task-scheduler-data-quality.xml" /F

if %ERRORLEVEL% EQU 0 (
    echo.
    echo SUCCESS: Task imported successfully!
    echo.
    echo Task Name: IPODhan\Weekly Data Quality Report
    echo Schedule: Every Sunday at 2:00 AM
    echo.
    echo To view the task:
    echo   taskschd.msc
    echo.
    echo To run the task manually:
    echo   schtasks /Run /TN "IPODhan\Weekly Data Quality Report"
    echo.
) else (
    echo.
    echo ERROR: Failed to import task (Error code: %ERRORLEVEL%)
    echo.
    echo Common issues:
    echo   - Run this script as Administrator
    echo   - Check that task-scheduler-data-quality.xml exists
    echo   - Verify file permissions
    echo.
)

pause
