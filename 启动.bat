@echo off
setlocal
cd /d "%~dp0"
title 路书编译师 TripCompiler 启动器

echo ==========================================================
echo   路书编译师 TripCompiler  —— 一键启动
echo   后端 http://127.0.0.1:8000    前端 http://127.0.0.1:5173
echo ==========================================================
echo.

echo [1/3] 检查 Python 虚拟环境...
if not exist "backend\.venv\Scripts\python.exe" (
    echo       首次运行：创建 backend\.venv ...
    python -m venv backend\.venv
)

"backend\.venv\Scripts\python.exe" -c "import fastapi" >nul 2>nul
if errorlevel 1 (
    echo       安装后端依赖（首次需要几分钟，请耐心等待）...
    python -m pip --python "backend\.venv\Scripts\python.exe" install -r backend\requirements.txt
    if errorlevel 1 (
        echo       [提示] 有依赖没装成功。若只是 ortools 失败可以忽略：
        echo              项目会自动降级为纯 Python 求解器，功能不受影响。
    )
) else (
    echo       后端依赖已就绪。
)

echo.
echo [2/3] 检查前端依赖...
if not exist "frontend\node_modules\vite\bin\vite.js" (
    echo       首次运行：安装前端依赖（需要几分钟）...
    pushd frontend
    if exist node_modules rmdir /s /q node_modules
    call npm install
    popd
) else (
    echo       前端依赖已就绪。
)

echo.
echo [3/3] 启动服务...
start "TripCompiler 后端 :8000" cmd /k "%~dp0_backend.bat"
ping 127.0.0.1 -n 5 >nul
start "TripCompiler 前端 :5173" cmd /k "%~dp0_frontend.bat"
ping 127.0.0.1 -n 7 >nul
start "" http://127.0.0.1:5173

echo.
echo 已在浏览器打开 http://127.0.0.1:5173
echo 关闭那两个黑色命令行窗口就等于停止服务。
echo.
pause