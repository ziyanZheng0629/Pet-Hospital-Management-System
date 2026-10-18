@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo 请先安装 Node.js 22.13 或更新版本。
 pause
 exit /b 1
)
echo zzy 正在启动。浏览器访问 http://127.0.0.1:4318
echo 保持此窗口打开。按 Ctrl+C 停止服务。
node server.js
pause
