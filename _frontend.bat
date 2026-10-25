@echo off
cd /d "%~dp0frontend"
if not exist "node_modules\vite\bin\vite.js" (
    echo [ERROR] frontend\node_modules is missing. Run the launcher first.
    pause
    exit /b 1
)
echo Frontend starting on http://127.0.0.1:5173 ...
node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173
echo.
echo [Frontend stopped] press any key to close.
pause