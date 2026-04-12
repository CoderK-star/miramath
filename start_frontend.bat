@echo off
setlocal

cd /d "%~dp0"
if not exist "frontend\start_frontend.bat" (
    echo [Root] frontend\start_frontend.bat が見つかりません。
    exit /b 1
)

call frontend\start_frontend.bat
endlocal
