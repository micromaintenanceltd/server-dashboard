# Builds and (optionally) signs the MML Server Agent installer.
#
# Steps:
#   1. Build the self-contained agent exe with pkg.
#   2. Sign the agent exe (Azure Trusted Signing) - optional, recommended.
#   3. Compile the Inno Setup installer, baking in the API URL + enroll token.
#   4. Sign the produced setup.exe (Azure Trusted Signing) - optional.
#
# Only the (non-secret) API URL is baked in. The enrolment token is NOT baked
# any more - the technician types it during installation. Example:
#
#   $env:MML_API_URL = "https://mml-dashboard-api.<sub>.workers.dev"
#   .\build.ps1 -Version 0.1.0 -Sign
#
# See installer\README.md for prerequisites (pkg, WinSW, Inno Setup, and the
# Azure Trusted Signing setup for signtool).

[CmdletBinding()]
param(
  [string]$Version = "0.1.0",
  [string]$ApiUrl = $env:MML_API_URL,
  [switch]$Sign,

  # Publish the built installer so servers can auto-update:
  #   - creates a GitHub Release (tag v<Version>) with the setup.exe attached,
  #   - registers the version + SHA-256 + download URL with the dashboard as
  #     PENDING (an admin then approves it on the Admin page before rollout).
  # Requires: the GitHub CLI (`gh`) signed in, and the dashboard RELEASE_TOKEN.
  [switch]$Publish,
  [string]$Repo = "micromaintenanceltd/server-dashboard",
  [string]$ReleaseToken = $env:MML_RELEASE_TOKEN,

  # Azure Trusted Signing parameters (only needed with -Sign). These match the
  # values in your Trusted Signing account.
  [string]$SignToolPath = "signtool.exe",
  [string]$AtsDlib = $env:MML_ATS_DLIB,          # path to Azure.CodeSigning.Dlib.dll
  [string]$AtsMetadata = $env:MML_ATS_METADATA   # path to the ATS metadata json
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$agentRoot = Split-Path -Parent $here

function Require-Value($value, $name) {
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$name is required. Set it as a parameter or environment variable."
  }
}

Require-Value $ApiUrl "ApiUrl (MML_API_URL)"
# NOTE: the enrolment token is no longer baked in. The technician types it
# during installation, so it never lives in the installer .exe.

$agentExe = Join-Path $agentRoot "dist\mml-agent.exe"
$winsw = Join-Path $here "vendor\mml-agent-service.exe"

# --- 1. Build the agent exe -------------------------------------------------
Write-Host "==> Building agent exe with pkg..." -ForegroundColor Cyan
Push-Location $agentRoot
try {
  npm run build:exe
} finally {
  Pop-Location
}
if (-not (Test-Path $agentExe)) { throw "Agent exe not found at $agentExe" }

if (-not (Test-Path $winsw)) {
  throw "WinSW binary not found at $winsw. See installer\README.md to add it."
}

# --- Signing helper ---------------------------------------------------------
function Invoke-AtsSign($file) {
  Require-Value $AtsDlib "AtsDlib (MML_ATS_DLIB)"
  Require-Value $AtsMetadata "AtsMetadata (MML_ATS_METADATA)"
  Write-Host "==> Signing $file with Azure Trusted Signing..." -ForegroundColor Cyan
  & $SignToolPath sign `
    /v /debug /fd SHA256 /tr "http://timestamp.acs.microsoft.com" /td SHA256 `
    /dlib "$AtsDlib" /dmdf "$AtsMetadata" `
    "$file"
  if ($LASTEXITCODE -ne 0) { throw "signtool failed for $file" }
}

# --- 2. Sign the agent exe (optional) --------------------------------------
if ($Sign) { Invoke-AtsSign $agentExe }

# --- 3. Compile the installer ----------------------------------------------
Write-Host "==> Compiling Inno Setup installer..." -ForegroundColor Cyan
$iscc = (Get-Command "iscc.exe" -ErrorAction SilentlyContinue).Source
if (-not $iscc) {
  # Common install locations (machine scope and winget user scope).
  $candidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
  )
  $iscc = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $iscc) { throw "ISCC.exe (Inno Setup 6) not found. Install it or add it to PATH." }
}

& $iscc `
  "/DApiUrl=$ApiUrl" `
  "/DAppVersion=$Version" `
  (Join-Path $here "mml-agent.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compile failed." }

$setupExe = Join-Path $here "Output\mml-agent-setup-$Version.exe"
if (-not (Test-Path $setupExe)) { throw "Installer not produced at $setupExe" }

# --- 4. Sign the installer (optional) --------------------------------------
if ($Sign) { Invoke-AtsSign $setupExe }

Write-Host ""
Write-Host "Done. Installer: $setupExe" -ForegroundColor Green
if (-not $Sign) {
  Write-Host "NOTE: built UNSIGNED. Re-run with -Sign once Trusted Signing is configured." -ForegroundColor Yellow
}

# --- 5. Publish for auto-update (optional) ----------------------------------
if ($Publish) {
  Require-Value $ReleaseToken "ReleaseToken (MML_RELEASE_TOKEN)"

  $gh = (Get-Command "gh.exe" -ErrorAction SilentlyContinue).Source
  if (-not $gh) { throw "GitHub CLI (gh) not found. Install it and run 'gh auth login'." }

  # SHA-256 of the exact file we are publishing - the dashboard records this and
  # every agent verifies it before installing.
  $sha = (Get-FileHash -Algorithm SHA256 -Path $setupExe).Hash.ToLower()
  Write-Host "==> SHA-256: $sha" -ForegroundColor Cyan

  $tag = "v$Version"
  $assetName = "mml-agent-setup-$Version.exe"

  # Create the release if it doesn't exist, then (re)upload the asset.
  & $gh release view $tag --repo $Repo *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "==> Creating GitHub release $tag..." -ForegroundColor Cyan
    & $gh release create $tag "$setupExe#$assetName" --repo $Repo `
      --title "MML Server Agent $Version" `
      --notes "Automated release of the MML Server Agent $Version. SHA-256: $sha"
    if ($LASTEXITCODE -ne 0) { throw "gh release create failed." }
  } else {
    Write-Host "==> Release $tag exists; uploading asset (clobber)..." -ForegroundColor Cyan
    & $gh release upload $tag "$setupExe#$assetName" --repo $Repo --clobber
    if ($LASTEXITCODE -ne 0) { throw "gh release upload failed." }
  }

  $downloadUrl = "https://github.com/$Repo/releases/download/$tag/$assetName"

  # Register with the dashboard as PENDING (enabled stays off until an admin
  # approves it on the Admin page).
  $body = @{ version = $Version; downloadUrl = $downloadUrl; sha256 = $sha } | ConvertTo-Json
  $publishUrl = ($ApiUrl.TrimEnd('/')) + "/api/agent/release"
  Write-Host "==> Registering release with the dashboard..." -ForegroundColor Cyan
  try {
    $resp = Invoke-RestMethod -Method Post -Uri $publishUrl -Body $body `
      -ContentType "application/json" `
      -Headers @{ Authorization = "Bearer $ReleaseToken" }
    Write-Host ""
    Write-Host "Published v$Version. It is PENDING approval." -ForegroundColor Green
    Write-Host "Approve it on the dashboard Admin page (Agent updates) to roll it out." -ForegroundColor Green
  } catch {
    throw "Failed to register release with the dashboard: $($_.Exception.Message)"
  }
}
