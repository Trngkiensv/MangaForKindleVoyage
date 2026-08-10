param(
  [Parameter(Mandatory=$true)]
  [string]$OcrSpaceApiKey,
  [Parameter(Mandatory=$true)]
  [string]$CloudflareAccountId,
  [Parameter(Mandatory=$true)]
  [string]$CloudflareApiToken,
  [int]$PrefetchAhead = 2
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path 'dist\server.cjs')) {
  Write-Host 'dist not found. Run .\SETUP_KINDLE.ps1 first.' -ForegroundColor Yellow
  exit 1
}

$env:MANGA_PROVIDER = 'weebcentral'
$env:OCR_SPACE_API_KEY = $OcrSpaceApiKey
$env:CLOUDFLARE_ACCOUNT_ID = $CloudflareAccountId
$env:CLOUDFLARE_API_TOKEN = $CloudflareApiToken
$env:CLOUDFLARE_MANGA_LLM_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8'
$env:CLOUDFLARE_FALLBACK_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast'
$env:CLOUDFLARE_MAX_TOKENS = '3072'
$env:MANGA_TRANSLATION = 'true'
$env:TRANSLATION_PREFETCH_AHEAD = [string][Math]::Max(0, [Math]::Min(2, $PrefetchAhead))
$env:TRANSLATION_ALLOW_FALLBACK = "false"

Write-Host 'Starting Kindle server with OCR.Space + Cloudflare manga LLM EN -> VI translation...' -ForegroundColor Green
Write-Host "Cloudflare account: $CloudflareAccountId"
Write-Host "Prefetch ahead: $($env:TRANSLATION_PREFETCH_AHEAD)"
Write-Host 'API tokens are kept only in this PowerShell process and are not sent to Kindle.'
npm start
