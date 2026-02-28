param(
    [switch]$SkipBackend,
    [switch]$SkipFrontend,
    [switch]$ForceReinstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info {
    param([string]$Message)
    Write-Host "[setup] $Message"
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

function Get-PythonRunner {
    if (Test-Command "py") {
        $py311Available = $false
        # Run the probe through cmd.exe so py.exe failures do not surface
        # as PowerShell-native errors under different PS versions/settings.
        & cmd.exe /d /c "py -3.11 -c ""import sys; print(sys.version)"" 1>nul 2>nul"
        $py311Available = ($LASTEXITCODE -eq 0)

        if ($py311Available) {
            return @{
                Exe = "py"
                PrefixArgs = @("-3.11")
                Label = "py -3.11"
            }
        }
    }

    if (Test-Command "python") {
        $version = (& python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
        if ($LASTEXITCODE -ne 0) {
            Fail "Found 'python' but could not read its version."
        }

        if ($version -ne "3.11") {
            Write-Warning "Python 3.11 was not found via 'py -3.11'. Falling back to python $version."
        }

        return @{
            Exe = "python"
            PrefixArgs = @()
            Label = "python"
        }
    }

    Fail "No Python interpreter found. Install Python 3.11+ and ensure 'py' or 'python' is available."
    return $null
}

function Setup-Backend {
    param(
        [string]$RepoRoot,
        [switch]$Force
    )

    $backendDir = Join-Path $RepoRoot "backend"
    $requirementsPath = Join-Path $backendDir "requirements.txt"
    $venvDir = Join-Path $backendDir ".venv"
    $venvPython = Join-Path $venvDir "Scripts\python.exe"

    if (-not (Test-Path $requirementsPath)) {
        Fail "Missing backend requirements file: $requirementsPath"
    }

    $runner = Get-PythonRunner
    Write-Info "Using backend interpreter: $($runner.Label)"

    if ($Force -and (Test-Path $venvDir)) {
        Write-Info "Force reinstall enabled: removing existing backend venv."
        Remove-Item -Recurse -Force $venvDir
    }

    if (-not (Test-Path $venvPython)) {
        Write-Info "Creating backend virtual environment at $venvDir"
        & $runner.Exe @($runner.PrefixArgs + @("-m", "venv", $venvDir))
        if ($LASTEXITCODE -ne 0) {
            Fail "Failed to create backend virtual environment."
        }
    }

    Write-Info "Upgrading backend packaging tools (pip/setuptools/wheel)"
    & $venvPython -m pip install --upgrade pip setuptools wheel
    if ($LASTEXITCODE -ne 0) {
        Fail "Failed to upgrade backend packaging tools."
    }

    if ($Force) {
        Write-Info "Installing backend dependencies (force reinstall)"
        & $venvPython -m pip install --upgrade --force-reinstall -r $requirementsPath
    }
    else {
        Write-Info "Installing backend dependencies"
        & $venvPython -m pip install -r $requirementsPath
    }

    if ($LASTEXITCODE -ne 0) {
        Fail "Failed to install backend dependencies."
    }
}

function Setup-Frontend {
    param(
        [string]$RepoRoot,
        [switch]$Force
    )

    $frontendDir = Join-Path $RepoRoot "frontend"
    $packageJsonPath = Join-Path $frontendDir "package.json"
    $lockPath = Join-Path $frontendDir "package-lock.json"
    $nodeModulesDir = Join-Path $frontendDir "node_modules"

    if (-not (Test-Path $packageJsonPath)) {
        Fail "Missing frontend package.json: $packageJsonPath"
    }

    if (-not (Test-Command "node")) {
        Fail "Node.js is not installed or not on PATH. Install Node.js LTS first."
    }
    if (-not (Test-Command "npm")) {
        Fail "npm is not installed or not on PATH. Install Node.js LTS first."
    }

    Push-Location $frontendDir
    try {
        if ($Force -and (Test-Path $nodeModulesDir)) {
            Write-Info "Force reinstall enabled: removing frontend node_modules."
            Remove-Item -Recurse -Force $nodeModulesDir
        }

        if (Test-Path $lockPath) {
            Write-Info "Installing frontend dependencies with npm ci"
            & npm ci
            if ($LASTEXITCODE -ne 0) {
                Write-Warning "npm ci failed. Falling back to npm install."
                & npm install
            }
        }
        else {
            Write-Info "package-lock.json not found. Installing with npm install."
            & npm install
        }

        if ($LASTEXITCODE -ne 0) {
            Fail "Failed to install frontend dependencies."
        }
    }
    finally {
        Pop-Location
    }
}

$repoRoot = $PSScriptRoot

if (-not $SkipBackend) {
    Setup-Backend -RepoRoot $repoRoot -Force:$ForceReinstall
}

if (-not $SkipFrontend) {
    Setup-Frontend -RepoRoot $repoRoot -Force:$ForceReinstall
}

Write-Info "Setup completed successfully."
