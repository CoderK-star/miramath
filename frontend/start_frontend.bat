@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
    echo [Frontend] npm was not found. Please install Node.js first.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [Frontend] node_modules not found. Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [Frontend] npm install failed.
        pause
        exit /b 1
    )
)

echo [Frontend] Starting Next.js dev server on http://localhost:3000
echo [Frontend] Press Ctrl+C to stop.
call npm run dev

if errorlevel 1 (
    echo.
    echo [Frontend] Failed to start.
    pause
)

endlocal
