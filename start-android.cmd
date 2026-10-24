@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.12 或以上版本，再运行此脚本。
  pause
  popd
  exit /b 1
)
node scripts\start-android.mjs %*
set "launch_result=%errorlevel%"
if not "%launch_result%"=="0" pause
popd
exit /b %launch_result%
