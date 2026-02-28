param(
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173,
    [switch]$NoReload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info {
    param([string]$Message)
    Write-Host "[dev] $Message"
}

function Fail {
    param([string]$Message)
    Write-Error $Message
    exit 1
}

$repoRoot = $PSScriptRoot
$backendScript = Join-Path $repoRoot "start-backend.ps1"
$frontendScript = Join-Path $repoRoot "start-frontend.ps1"

if (-not (Test-Path $backendScript)) {
    Fail "Missing script: $backendScript"
}
if (-not (Test-Path $frontendScript)) {
    Fail "Missing script: $frontendScript"
}

$backendArgs = @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-File", $backendScript,
    "-InCurrentTerminal",
    "-Port", $BackendPort.ToString()
)
if ($NoReload) {
    $backendArgs += "-NoReload"
}

$frontendArgs = @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-File", $frontendScript,
    "-InCurrentTerminal",
    "-Port", $FrontendPort.ToString()
)

Start-Process -FilePath "powershell.exe" -ArgumentList $backendArgs -WorkingDirectory $repoRoot | Out-Null
Start-Process -FilePath "powershell.exe" -ArgumentList $frontendArgs -WorkingDirectory $repoRoot | Out-Null

Write-Info "Started backend and frontend in external PowerShell windows."
Write-Info "Backend:  http://localhost:$BackendPort"
Write-Info "Frontend: http://localhost:$FrontendPort"
