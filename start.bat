@echo off
setlocal EnableExtensions
set "ERR=0"
cd /d "%~dp0" || (
  echo [ERROR] Cannot open script folder. Unzip the ZIP fully first.
  set "ERR=1"
  goto HOLD
)

if not exist "runtime" mkdir "runtime" 2>nul
echo %DATE% %TIME% boot dir=%CD%>> "runtime\bat-boot.log"

echo.
echo ========================================
echo  FaceMe local start  v2026-11-09l
echo ========================================
echo  Folder: %CD%
echo.

if not exist "%~dp0package.json" (
  echo [ERROR] package.json missing. You must unzip the full project folder.
  echo         Do not run start.bat from inside a partial extract.
  set "ERR=1"
  goto HOLD
)

if not exist "%~dp0scripts\windows-launcher.js" (
  echo [ERROR] scripts\windows-launcher.js missing. Unzip the full project.
  set "ERR=1"
  goto HOLD
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install official LTS from:
  echo         https://nodejs.org/
  echo         This app is NOT install-free. No silent install will run.
  start "" "https://nodejs.org/"
  set "ERR=1"
  goto HOLD
)

echo Node:
node -v
echo.

node -e "var m=+String(process.versions.node||'0').split('.')[0]; if(!(m>=18)){console.error('[ERROR] Node too old: need >= 18'); process.exit(2)}"
if errorlevel 1 (
  echo [ERROR] Node.js too old. Please install current LTS ^>= 18.
  start "" "https://nodejs.org/"
  set "ERR=1"
  goto HOLD
)

echo Starting launcher...
node "%~dp0scripts\windows-launcher.js"
set "ERR=%ERRORLEVEL%"
if not "%ERR%"=="0" (
  echo.
  echo [ERROR] Launcher failed, code %ERR%.
  echo         Read messages above and runtime\launcher.log if present.
)

:HOLD
echo.
if not "%ERR%"=="0" (
  echo Window stays open so you can read the error. Log: runtime\bat-boot.log
) else (
  echo Done. Local URL: http://127.0.0.1:8443/?local=1
)
echo Press any key to close this window.
pause >nul
endlocal & exit /b %ERR%
