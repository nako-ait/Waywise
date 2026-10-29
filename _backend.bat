@echo off
cd /d "%~dp0backend"
if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] backend\.venv is missing. Run the launcher first.
    pause
    exit /b 1
)
.venv\Scripts\python.exe scripts\check_service.py backend
if errorlevel 20 (
    pause
    exit /b 1
)
if not errorlevel 10 exit /b 0
echo Backend starting on http://127.0.0.1:8000 ...
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
echo.
echo [Backend stopped] press any key to close.
pause
