param(
  [string]$HookUrl = $env:RENDER_LEAD_HELPER_DEPLOY_HOOK,
  [string]$Ref = "",
  [switch]$CurrentCommit
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($HookUrl)) {
  $envFile = Join-Path $PSScriptRoot "..\.env.local"
  if (Test-Path -LiteralPath $envFile) {
    $hookLine = Get-Content -LiteralPath $envFile |
      Where-Object { $_ -match '^\s*RENDER_LEAD_HELPER_DEPLOY_HOOK\s*=' } |
      Select-Object -First 1

    if ($hookLine) {
      $HookUrl = ($hookLine -replace '^\s*RENDER_LEAD_HELPER_DEPLOY_HOOK\s*=\s*', '').Trim().Trim('"').Trim("'")
    }
  }
}

if ([string]::IsNullOrWhiteSpace($HookUrl)) {
  throw "Missing Render deploy hook. Set RENDER_LEAD_HELPER_DEPLOY_HOOK in .env.local, set it in the local environment, or pass -HookUrl."
}

if ($CurrentCommit -and [string]::IsNullOrWhiteSpace($Ref)) {
  $Ref = (git rev-parse HEAD).Trim()
}

$deployUrl = $HookUrl

if (-not [string]::IsNullOrWhiteSpace($Ref)) {
  $separator = if ($deployUrl.Contains("?")) { "&" } else { "?" }
  $deployUrl = "${deployUrl}${separator}ref=$([System.Uri]::EscapeDataString($Ref))"
}

Write-Host "Triggering Render deploy for Lead Helper..."
if (-not [string]::IsNullOrWhiteSpace($Ref)) {
  Write-Host "Ref: $Ref"
}

$response = Invoke-WebRequest -Method Post -Uri $deployUrl -UseBasicParsing

if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
  throw "Render deploy hook returned HTTP $($response.StatusCode)."
}

Write-Host "Render deploy accepted. HTTP $($response.StatusCode)."
