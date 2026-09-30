@echo off
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo Preparing the Shiji desktop runtime...
  set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
  node "node_modules\electron\install.js"
  if errorlevel 1 (
    echo Runtime setup failed. Check the network connection and retry.
    pause
    exit /b 1
  )
)

echo Starting Shiji...
call npm run dev

if errorlevel 1 (
  echo Shiji did not start correctly. Keep this window open for diagnostics.
  pause
)
