@echo off
setlocal

cd /d "%~dp0"
if not exist "backend\start_backend.bat" (
    echo [Root] backend\start_backend.bat が見つかりません。
    exit /b 1
)

call backend\start_backend.bat
endlocal
