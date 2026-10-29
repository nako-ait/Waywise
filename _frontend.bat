@echo off
cd /d "%~dp0frontend"
if not exist "node_modules\vite\bin\vite.js" (
    echo [ERROR] frontend\node_modules is missing. Run the launcher first.
    pause
    exit /b 1
)
"%~dp0backend\.venv\Scripts\python.exe" "%~dp0backend\scripts\check_service.py" frontend
if errorlevel 20 (
    pause
    exit /b 1
)
if not errorlevel 10 exit /b 0
echo Frontend starting on http://127.0.0.1:5173 ...
node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173 --strictPort
echo.
echo [Frontend stopped] press any key to close.
pause
