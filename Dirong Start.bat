@echo off
setlocal
cd /d "%~dp0"

echo.
echo Dirong Phase 1 RecordingProducer MVP
echo.

where node > nul 2> nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Please install Node.js 22.12.0 or newer, then run this file again.
  pause
  exit /b 1
)

if not exist ".env" (
  echo [SETUP] .env file was not found.
  echo Copy .env.example to .env, then fill Discord token and IDs.
  echo.
  echo Required values:
  echo - DISCORD_BOT_TOKEN
  echo - DISCORD_CLIENT_ID
  echo - DISCORD_GUILD_ID
  echo.
  echo Phase 1 does not require DISCORD_VOICE_CHANNEL_ID.
  echo Use /dirong start while you are in a Discord voice channel.
  echo.
  pause
  exit /b 1
)

echo [1/4] Running npm install...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

echo.
echo [2/4] Running TypeScript build...
call npm run build
if errorlevel 1 (
  echo [ERROR] npm run build failed.
  pause
  exit /b 1
)

echo.
echo [3/4] Running Phase 1 doctor...
call npm run phase1:doctor
if errorlevel 1 (
  echo [ERROR] phase1 doctor failed.
  pause
  exit /b 1
)

echo.
echo [4/4] Starting Dirong Phase 1 app...
echo In Discord, join a voice channel and use: /dirong start
echo Dashboard default: http://127.0.0.1:3095/
echo In this console, you can type: status, stop, exit
echo.
call npm run phase1:start

echo.
echo Dirong Phase 1 app exited.
pause
