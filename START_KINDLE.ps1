$ErrorActionPreference = 'Stop'
if (-not (Test-Path 'dist\server.cjs')) {
  Write-Host 'dist not found. Run .\SETUP_KINDLE.ps1 first.' -ForegroundColor Yellow
  exit 1
}
npm start
