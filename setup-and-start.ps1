# FaceMe local launcher helper (optional). Prefer double-clicking start.bat.
# Does NOT change ExecutionPolicy and does NOT use -ExecutionPolicy Bypass.
# If this .ps1 was extracted from a ZIP, Windows may block it (Mark of the Web):
#   Right-click the ZIP or this file -> Properties -> check Unblock -> OK
#   Or use start.bat instead (recommended; bat+Node path needs no PowerShell policy).
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '[錯誤] 找不到 Node.js。請先安裝官方 LTS: https://nodejs.org/' -ForegroundColor Red
  Start-Process 'https://nodejs.org/'
  exit 1
}
& node (Join-Path $PSScriptRoot 'scripts\windows-launcher.js')
exit $LASTEXITCODE
