param(
  [Parameter(Mandatory=$true)]
  [string]$AccountId,
  [Parameter(Mandatory=$true)]
  [string]$ApiToken,
  [string]$Text = "All right... commencing break-in!!"
)

$ErrorActionPreference = 'Stop'
$headers = @{
  Authorization = "Bearer $ApiToken"
  "Content-Type" = "application/json"
}
$systemPrompt = @"
You are a faithful English-to-Vietnamese manga translation engine. Prioritize semantic accuracy over creative localization. Translate clear words, phrasal verbs, and hyphenated compounds using their conventional meaning in context. Do not invent unrelated actions or meanings. Example: "break-in" means "đột nhập" when referring to unauthorized entry; "all right" at the start of an action usually means "được rồi". Use normal Vietnamese capitalization even if the source is ALL CAPS. Preserve punctuation and emotion. Return only the Vietnamese translation, without explanations.
"@
$body = @{
  messages = @(
    @{ role = "system"; content = $systemPrompt },
    @{ role = "user"; content = $Text }
  )
  max_tokens = 1024
  temperature = 0.0
  top_p = 1.0
} | ConvertTo-Json -Depth 8

$model = '@cf/qwen/qwen3-30b-a3b-fp8'
$fallbackModel = '@cf/meta/llama-3.1-8b-instruct-fast'
$url = "https://api.cloudflare.com/client/v4/accounts/$AccountId/ai/run/$model"
Write-Host 'Testing Cloudflare Workers AI manga LLM EN -> VI...' -ForegroundColor Cyan
$response = Invoke-RestMethod -Method Post -Uri $url -Headers $headers -Body $body

if ($response.success -eq $false) {
  Write-Host 'Cloudflare returned an error:' -ForegroundColor Red
  $response | ConvertTo-Json -Depth 8
  exit 1
}

$translated = $null
if ($response.result.response) {
  $translated = [string]$response.result.response
}
elseif ($response.result.choices -and $response.result.choices.Count -gt 0) {
  $translated = [string]$response.result.choices[0].message.content
}
elseif ($response.response) {
  $translated = [string]$response.response
}

if ([string]::IsNullOrWhiteSpace($translated)) {
  Write-Host 'Qwen returned no final assistant text. Testing fallback Llama model...' -ForegroundColor Yellow
  $fallbackUrl = "https://api.cloudflare.com/client/v4/accounts/$AccountId/ai/run/$fallbackModel"
  $fallbackBody = @{
    messages = @(
      @{ role = "system"; content = $systemPrompt },
      @{ role = "user"; content = $Text }
    )
    max_tokens = 512
    temperature = 0.0
    top_p = 1.0
  } | ConvertTo-Json -Depth 8
  $fallbackResponse = Invoke-RestMethod -Method Post -Uri $fallbackUrl -Headers $headers -Body $fallbackBody
  if ($fallbackResponse.result.response) {
    $translated = [string]$fallbackResponse.result.response
  }
  elseif ($fallbackResponse.result.choices -and $fallbackResponse.result.choices.Count -gt 0) {
    $translated = [string]$fallbackResponse.result.choices[0].message.content
  }
  if ([string]::IsNullOrWhiteSpace($translated)) {
    Write-Host 'Both primary and fallback models returned no final assistant text.' -ForegroundColor Red
    Write-Host 'Primary raw response:' -ForegroundColor Yellow
    $response | ConvertTo-Json -Depth 12
    Write-Host 'Fallback raw response:' -ForegroundColor Yellow
    $fallbackResponse | ConvertTo-Json -Depth 12
    exit 1
  }
}

Write-Host 'Success.' -ForegroundColor Green
Write-Host "English: $Text"
Write-Host "Vietnamese: $translated"
