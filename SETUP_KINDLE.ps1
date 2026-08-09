$ErrorActionPreference = 'Stop'
Write-Host 'Installing dependencies...'
npm install
Write-Host 'Cleaning old build...'
npm run clean
Write-Host 'Building Kindle legacy bundle...'
npm run build
Write-Host ''
Write-Host 'Build complete. Start the server with:' -ForegroundColor Green
Write-Host '  npm start'
