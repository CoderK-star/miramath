@echo off
setlocal

cd /d "%~dp0"

set "HOST=127.0.0.1"
set "PORT=8000"

if exist "..\venv\Scripts\python.exe" (
    set "PYTHON_CMD=..\venv\Scripts\python.exe"
) else (
    set "PYTHON_CMD=python"
)

set "PORT_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /I /C:"%HOST%:%PORT%" ^| findstr /I "LISTENING"') do (
    set "PORT_PID=%%P"
    goto :PORT_CHECK_DONE
)
:PORT_CHECK_DONE

if defined PORT_PID (
    echo [Backend] Port %PORT% is already in use by PID %PORT_PID%.
    choice /C YN /N /M "[Backend] Kill this process and continue? [Y/N]: "
    if errorlevel 2 (
        echo [Backend] Startup canceled. Port %PORT% must be free.
        pause
        exit /b 1
    ) else (
        taskkill /PID %PORT_PID% /F >nul 2>&1
        if errorlevel 1 (
            echo [Backend] Failed to stop PID %PORT_PID%.
            echo [Backend] Close the process manually and retry.
            pause
            exit /b 1
        )
        timeout /t 1 >nul
    )
)

echo [Backend] Starting FastAPI server on http://%HOST%:%PORT%
echo [Backend] Press Ctrl+C to stop.
"%PYTHON_CMD%" -m uvicorn app.main:app --host %HOST% --port %PORT%

if errorlevel 1 (
    echo.
    echo [Backend] Failed to start. Possible causes:
    echo - Python or dependencies are not installed
    echo - Port %PORT% is already in use
    pause
)

endlocal
