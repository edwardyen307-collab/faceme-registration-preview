# Optional helper. Prefer double-clicking start.bat.
# Does NOT change ExecutionPolicy and does NOT use -ExecutionPolicy Bypass.
# If blocked after ZIP extract: right-click this file or the ZIP -> Properties -> Unblock.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'scripts\windows-launcher.js'))) {
  Write-Host '[ERROR] scripts\windows-launcher.js missing. Unzip the full project.' -ForegroundColor Red
  exit 1
}
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '[ERROR] Node.js not found. Install LTS: https://nodejs.org/' -ForegroundColor Red
  Start-Process 'https://nodejs.org/'
  exit 1
}
& node (Join-Path $PSScriptRoot 'scripts\windows-launcher.js')
exit $LASTEXITCODE
