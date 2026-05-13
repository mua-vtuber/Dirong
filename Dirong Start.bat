@echo off
setlocal
cd /d "%~dp0"

echo.
echo Dirong Recording + STT Pipeline
echo.

where node > nul 2> nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Please install Node.js 22.12.0 or newer, then run this file again.
  pause
  exit /b 1
)

echo [1/3] Running npm install...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

echo.
echo [2/3] Running TypeScript build...
call npm run build
if errorlevel 1 (
  echo [ERROR] npm run build failed.
  pause
  exit /b 1
)

echo.
echo [3/3] Starting Dirong Recording + STT app...
echo Open the dashboard setup wizard to save Discord, STT, AI, and Notion settings.
echo In Discord, join a voice channel and use: /dirong start after setup is ready.
echo Dashboard default: http://127.0.0.1:3095/
echo In this console, you can type: status, stop, exit
echo.
call npm start

echo.
echo Dirong app exited.
pause
