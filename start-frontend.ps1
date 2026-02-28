param(
    [int]$Port = 5173,
    [switch]$InCurrentTerminal
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info {
    param([string]$Message)
    Write-Host "[frontend] $Message"
}

function Fail {
    param([string]$Message)
    Write-Error $Message
    exit 1
}

function Test-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-PortInUse {
    param([int]$PortToCheck)
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $PortToCheck)
        $listener.Start()
        $listener.Stop()
        return $false
    }
    catch {
        if ($listener -ne $null) {
            try { $listener.Stop() } catch { }
        }
        return $true
    }
}

$repoRoot = $PSScriptRoot
$scriptPath = $PSCommandPath

if (-not $InCurrentTerminal -and $env:TERM_PROGRAM -eq "vscode") {
    $argsList = @(
        "-NoExit",
        "-ExecutionPolicy", "Bypass",
        "-File", $scriptPath,
        "-InCurrentTerminal",
        "-Port", $Port.ToString()
    )

    Start-Process -FilePath "powershell.exe" -ArgumentList $argsList -WorkingDirectory $repoRoot | Out-Null
    return
}

if (Test-PortInUse -PortToCheck $Port) {
    Fail "Port $Port is already in use. Stop the conflicting process, then retry."
}

$frontendDir = Join-Path $repoRoot "frontend"
$nodeModulesDir = Join-Path $frontendDir "node_modules"
$setupScript = Join-Path $repoRoot "setup.ps1"

if (-not (Test-Path $frontendDir)) {
    Fail "Frontend directory not found: $frontendDir"
}

if (-not (Test-Command "node")) {
    Fail "Node.js is not installed or not on PATH. Install Node.js LTS first."
}
if (-not (Test-Command "npm")) {
    Fail "npm is not installed or not on PATH. Install Node.js LTS first."
}

if (-not (Test-Path $nodeModulesDir)) {
    if (-not (Test-Path $setupScript)) {
        Fail "Frontend dependencies are missing and setup script not found: $setupScript"
    }
    Write-Info "node_modules missing. Running setup.ps1 -SkipBackend"
    & $setupScript -SkipBackend
    if ($LASTEXITCODE -ne 0) {
        Fail "Frontend bootstrap failed."
    }
}

Write-Info "Starting frontend on http://localhost:$Port"

Push-Location $frontendDir
try {
    & npm run dev -- --host 127.0.0.1 --port $Port
    $code = $LASTEXITCODE
}
finally {
    Pop-Location
}

exit $code
