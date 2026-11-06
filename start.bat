@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ========================================
echo  FaceMe 本機一鍵啟動  v2026-11-06c
echo ========================================
echo.
echo  資料夾: %CD%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [錯誤] 找不到 Node.js。此工具不是「完全免安裝」：需要先安裝 Node.js LTS。
  echo.
  echo 請安裝官方 LTS 後，再雙擊本 start.bat。
  echo 下載頁: https://nodejs.org/
  echo.
  choice /C YN /M "是否現在開啟 Node.js 官方下載頁"
  if errorlevel 2 goto :FAIL_NODE
  if errorlevel 1 start "" "https://nodejs.org/"
  :FAIL_NODE
  echo.
  echo 視窗將暫停，方便閱讀訊息。
  pause
  exit /b 1
)

echo 使用 Node:
node -v
echo.

REM Prefer Node launcher (no PowerShell ExecutionPolicy / no Bypass).
node "%~dp0scripts\windows-launcher.js"
set "ERR=%ERRORLEVEL%"
if not "%ERR%"=="0" (
  echo.
  echo [結束] 啟動失敗，代碼 %ERR%。上方訊息請保留以便排查。
  pause
  exit /b %ERR%
)

echo.
echo 若瀏覽器未自動開啟，請手動前往: http://127.0.0.1:8443/?local=1
echo 關閉此視窗不會立刻停止已在背景執行的服務；請到工作管理員結束 node.exe，或關閉啟動該服務的視窗。
pause
endlocal
exit /b 0
