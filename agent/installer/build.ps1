# Builds and (optionally) signs the MML Server Agent installer.
#
# Steps:
#   1. Build the self-contained agent exe with pkg.
#   2. Sign the agent exe (Azure Trusted Signing) - optional, recommended.
#   3. Compile the Inno Setup installer, baking in the API URL + enroll token.
#   4. Sign the produced setup.exe (Azure Trusted Signing) - optional.
#
# Secrets are passed in, never hard-coded. Example:
#
#   $env:MML_API_URL      = "https://mml-dashboard-api.<sub>.workers.dev"
#   $env:MML_ENROLL_TOKEN = "<the enroll token you set with wrangler secret>"
#   .\build.ps1 -Version 0.1.0 -Sign
#
# See installer\README.md for prerequisites (pkg, WinSW, Inno Setup, and the
# Azure Trusted Signing setup for signtool).

[CmdletBinding()]
param(
  [string]$Version = "0.1.0",
  [string]$ApiUrl = $env:MML_API_URL,
  [string]$EnrollToken = $env:MML_ENROLL_TOKEN,
  [switch]$Sign,

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
Require-Value $EnrollToken "EnrollToken (MML_ENROLL_TOKEN)"

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
  "/DEnrollToken=$EnrollToken" `
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
