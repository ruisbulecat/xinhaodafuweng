@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if not "%~1"=="" (
  set "PORT=%~1"
) else (
  set "PORT=8765"
)

echo.
echo  信奥大富翁 - 局域网联机启动器
echo  端口: %PORT%
echo.

where node >nul 2>nul
if not errorlevel 1 (
  echo  [1/2] 检测到 Node.js，使用 Node 服务器...
  node server.js
  goto :done
)

echo  [1/2] 未检测到 Node.js，使用 Windows 自带 PowerShell 服务器...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"

:done
echo.
echo  服务器已停止。按任意键关闭窗口。
pause >nul
