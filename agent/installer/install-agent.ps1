# MML Server Agent - test/service installer (PowerShell).
#
# Installs the packaged agent as a Windows service on a server, without needing
# Inno Setup or a signed installer. Use this to test on a server now; the signed
# Inno Setup installer (mml-agent.iss) is the production distribution.
#
# Run from an ELEVATED (Administrator) PowerShell, from the folder that contains
# mml-agent.exe, mml-agent-service.exe (WinSW), and mml-agent-service.xml:
#
#   .\install-agent.ps1 -ApiUrl "https://mml-dashboard-api.<sub>.workers.dev" `
#                       -EnrollToken "<enroll token>" -Company "Acme Ltd" `
#                       [-Location "Leeds HQ"] [-Port 8000]
#
# Any missing required value is prompted for. To remove:
#   .\install-agent.ps1 -Uninstall

[CmdletBinding()]
param(
  [string]$ApiUrl,
  [string]$EnrollToken,
  [string]$Company,
  [string]$Location = "",
  [int]$Port = 8000,
  [string]$InstallDir = "$env:ProgramFiles\MML\Server Agent",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServiceId = "MMLServerAgent"
$svcExe = Join-Path $InstallDir "mml-agent-service.exe"

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    throw "Run this from an elevated (Administrator) PowerShell."
  }
}

# --- Uninstall path ---------------------------------------------------------
if ($Uninstall) {
  Assert-Admin
  # Deregister from the dashboard first (removes this server's record).
  $agentExe = Join-Path $InstallDir "mml-agent.exe"
  if (Test-Path $agentExe) {
    Write-Host "Deregistering from the dashboard..."
    & $agentExe deregister 2>$null
  }
  if (Test-Path $svcExe) {
    Write-Host "Stopping and removing service..."
    & $svcExe stop 2>$null
    & $svcExe uninstall 2>$null
    Start-Sleep -Seconds 2
  }
  if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
  Write-Host "Uninstalled MML Server Agent."
  return
}

# --- Install path -----------------------------------------------------------
Assert-Admin

if (-not $ApiUrl)      { $ApiUrl = Read-Host "Dashboard API URL (https://mml-dashboard-api.<sub>.workers.dev)" }
if (-not $EnrollToken) { $EnrollToken = Read-Host "Enrollment token" }
if (-not $Company)     { $Company = Read-Host "Company / client name" }
if (-not $ApiUrl -or -not $EnrollToken -or -not $Company) { throw "ApiUrl, EnrollToken and Company are required." }

# Required payload files must sit next to this script.
$required = @("mml-agent.exe", "mml-agent-service.exe", "mml-agent-service.xml")
foreach ($f in $required) {
  if (-not (Test-Path (Join-Path $here $f))) {
    throw "Missing '$f' next to this script. See the note in this folder about adding WinSW as mml-agent-service.exe."
  }
}

Write-Host "Installing to $InstallDir ..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Copy payload (include the WinSW .exe.config if present, needed by some builds).
Copy-Item (Join-Path $here "mml-agent.exe") $InstallDir -Force
Copy-Item (Join-Path $here "mml-agent-service.exe") $InstallDir -Force
Copy-Item (Join-Path $here "mml-agent-service.xml") $InstallDir -Force
$winswCfg = Join-Path $here "mml-agent-service.exe.config"
if (Test-Path $winswCfg) { Copy-Item $winswCfg $InstallDir -Force }

# Enroll: creates the dashboard record and writes config.json next to the exe.
$agent = Join-Path $InstallDir "mml-agent.exe"
Write-Host "Enrolling with the dashboard..."
$enrollArgs = @("enroll", "--company", $Company, "--api-url", $ApiUrl, "--enroll-token", $EnrollToken)
if ($Location) { $enrollArgs += @("--location", $Location) }
& $agent @enrollArgs
if ($LASTEXITCODE -ne 0) { throw "Enrollment failed (see output above). Nothing installed as a service." }

# Optional: set the local settings-page port if not the default.
if ($Port -ne 8000) {
  $cfgPath = Join-Path $InstallDir "config.json"
  $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
  if (-not $cfg.settings) { $cfg | Add-Member -NotePropertyName settings -NotePropertyValue (@{ enabled = $true; port = $Port }) }
  else { $cfg.settings.port = $Port }
  ($cfg | ConvertTo-Json -Depth 20) | Set-Content -Path $cfgPath -Encoding UTF8
}

# Install and start the Windows service via WinSW.
Write-Host "Installing the Windows service..."
& $svcExe install
& $svcExe start
Start-Sleep -Seconds 2

$svc = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
Write-Host ""
if ($svc -and $svc.Status -eq "Running") {
  Write-Host "Done. Service '$ServiceId' is Running." -ForegroundColor Green
} else {
  Write-Host "Service installed but status is '$($svc.Status)'. Check logs in $InstallDir\logs." -ForegroundColor Yellow
}
Write-Host "Local settings page: http://127.0.0.1:$Port"
Write-Host "The server should appear on the dashboard within a minute."
