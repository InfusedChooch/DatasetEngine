param(
    [switch]$NoReload,
    [int]$Port = 8000,
    [switch]$InCurrentTerminal,
    [switch]$RestartIfRunning
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info {
    param([string]$Message)
    Write-Host "[backend] $Message"
}

function Fail {
    param([string]$Message)
    Write-Error $Message
    exit 1
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

function Get-PortOwnerDetails {
    param([int]$PortToCheck)
    try {
        $conn = Get-NetTCPConnection -LocalPort $PortToCheck -State Listen -ErrorAction Stop | Select-Object -First 1
        if (-not $conn) {
            return $null
        }

        $proc = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $conn.OwningProcess) -ErrorAction SilentlyContinue
        if (-not $proc) {
            return @{
                Pid = [int]$conn.OwningProcess
                Name = "unknown"
                CommandLine = ""
            }
        }

        return @{
            Pid = [int]$conn.OwningProcess
            Name = [string]$proc.Name
            CommandLine = [string]$proc.CommandLine
        }
    }
    catch {
        return $null
    }
}

function Test-BackendHealth {
    param([int]$PortToCheck)
    try {
        $resp = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/" -f $PortToCheck) -TimeoutSec 2 -ErrorAction Stop
        return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500)
    }
    catch {
        return $false
    }
}

function Test-DatasetEngineBackend {
    param([int]$PortToCheck)
    try {
        $resp = Invoke-RestMethod -Method Get -Uri ("http://127.0.0.1:{0}/api/settings" -f $PortToCheck) -TimeoutSec 2 -ErrorAction Stop
        return ($null -ne $resp.storage_path -and $null -ne $resp.datasets_path -and $null -ne $resp.projects_path)
    }
    catch {
        return $false
    }
}

function Stop-ProcessByPidBestEffort {
    param([int]$PidToStop)

    try {
        Stop-Process -Id $PidToStop -Force -ErrorAction Stop
        return $true
    }
    catch {
        # Fallback for cases where process details are inaccessible from CIM.
        & cmd.exe /d /c ("taskkill /PID {0} /F >nul 2>nul" -f $PidToStop)
        return ($LASTEXITCODE -eq 0)
    }
}

function Wait-ForPortRelease {
    param(
        [int]$PortToCheck,
        [int]$TimeoutSeconds = 10
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (-not (Test-PortInUse -PortToCheck $PortToCheck)) {
            return $true
        }
        Start-Sleep -Milliseconds 250
    }
    return $false
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

    if ($NoReload) {
        $argsList += "-NoReload"
    }
    if ($RestartIfRunning) {
        $argsList += "-RestartIfRunning"
    }

    Start-Process -FilePath "powershell.exe" -ArgumentList $argsList -WorkingDirectory $repoRoot | Out-Null
    return
}

if (Test-PortInUse -PortToCheck $Port) {
    $owner = Get-PortOwnerDetails -PortToCheck $Port
    $isLikelyBackend = $false
    $portFreedByRestart = $false
    $isDatasetBackend = Test-DatasetEngineBackend -PortToCheck $Port

    if ($owner -and $owner.CommandLine) {
        if ($owner.CommandLine -match "uvicorn\s+main:app") {
            $isLikelyBackend = $true
        }
    }

    if ($isLikelyBackend -or $isDatasetBackend) {
        if ($RestartIfRunning) {
            if (-not $owner) {
                Fail "Restart requested, but could not resolve the owning PID on port $Port."
            }

            Write-Info "Restart requested. Stopping existing backend PID $($owner.Pid) on port $Port."
            $stopped = Stop-ProcessByPidBestEffort -PidToStop $owner.Pid
            if (-not $stopped) {
                Fail "Failed to stop existing backend PID $($owner.Pid)."
            }

            if (-not (Wait-ForPortRelease -PortToCheck $Port -TimeoutSeconds 10)) {
                Fail "Stopped backend PID $($owner.Pid), but port $Port did not free within timeout."
            }

            $portFreedByRestart = $true
            Write-Info "Previous backend stopped. Continuing with fresh start."
        }
        elseif (Test-BackendHealth -PortToCheck $Port) {
            if ($owner) {
                Write-Info "Backend is already running on http://localhost:$Port (PID $($owner.Pid))."
            }
            else {
                Write-Info "Backend is already running on http://localhost:$Port."
            }
            Write-Info "Swagger docs: http://localhost:$Port/docs"
            exit 0
        }
    }

    if ($portFreedByRestart) {
        # Continue with regular startup path below.
    }
    elseif ($owner) {
        Fail "Port $Port is already in use by PID $($owner.Pid) [$($owner.Name)]. Command: $($owner.CommandLine)"
    }
    else {
        Fail "Port $Port is already in use. Stop the conflicting process, then retry."
    }

}

$backendDir = Join-Path $repoRoot "backend"
$venvPython = Join-Path $backendDir ".venv\Scripts\python.exe"
$setupScript = Join-Path $repoRoot "setup.ps1"

if (-not (Test-Path $venvPython)) {
    if (-not (Test-Path $setupScript)) {
        Fail "Backend venv is missing and setup script not found: $setupScript"
    }
    Write-Info "Backend venv missing. Running setup.ps1 -SkipFrontend"
    & $setupScript -SkipFrontend
    if ($LASTEXITCODE -ne 0) {
        Fail "Backend bootstrap failed."
    }
}

if (-not (Test-Path $venvPython)) {
    Fail "Backend venv python not found after bootstrap: $venvPython"
}

$env:BASE_PATH = (Resolve-Path -LiteralPath $repoRoot).Path
Write-Info "BASE_PATH=$($env:BASE_PATH)"

if (-not (Test-Path $backendDir)) {
    Fail "Backend directory not found: $backendDir"
}

$uvicornArgs = @(
    "-m", "uvicorn",
    "main:app",
    "--host", "127.0.0.1",
    "--port", $Port.ToString()
)

if (-not $NoReload) {
    $uvicornArgs += "--reload"
}

Write-Info "Starting backend on http://localhost:$Port"
Write-Info "Swagger docs: http://localhost:$Port/docs"

Push-Location $backendDir
try {
    & $venvPython @uvicornArgs
    $code = $LASTEXITCODE
}
finally {
    Pop-Location
}

exit $code
