[CmdletBinding()]
param([switch]$InstallTools, [switch]$SkipModels)
$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
Push-Location $repoRoot
try {
    if ($InstallTools) {
        if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
            throw 'Install Microsoft App Installer from the Microsoft Store, then run setup again.'
        }
        foreach ($toolPackage in @(@('git', 'Git.Git'), @('node', 'OpenJS.NodeJS.LTS'), @('uv', 'Astral-sh.uv'), @('ffmpeg', 'Gyan.FFmpeg'))) {
            if (Get-Command $toolPackage[0] -ErrorAction SilentlyContinue) { continue }
            winget install --id $toolPackage[1] --exact --source winget
            if ($LASTEXITCODE -ne 0) { throw "Could not install $($toolPackage[1]). See winget output; reopen the terminal if already installed." }
        }
        $env:Path = $env:Path + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    }
    foreach ($tool in @('node', 'npm', 'uv', 'ffmpeg', 'ffprobe', 'nvidia-smi')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Missing $tool. See docs/windows-development.md; reopen the terminal after installing tools." }
    }
    node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw 'Node.js 22 or newer is required.' }
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        npm install --global pnpm@10.33.2
        if ($LASTEXITCODE -ne 0) { throw 'pnpm installation failed.' }
    }
    $pnpmVersion = (pnpm --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $pnpmVersion -ne '10.33.2') { throw 'pnpm 10.33.2 is required. Run npm install --global pnpm@10.33.2, then rerun setup.' }
    $previous = if (Test-Path -LiteralPath '.vibepod/config.json') { Get-Content -Raw -LiteralPath '.vibepod/config.json' | ConvertFrom-Json } else { $null }
    function Resolve-SetupPath($override, $saved, $fallback) {
        $value = if ($override) { $override } elseif ($saved) { $saved } else { $fallback }
        $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($value)
    }
    $localRoot = Join-Path $env:LOCALAPPDATA 'VibePod'
    $repoHash = (node -e "console.log(require('crypto').createHash('sha256').update(process.cwd().toLowerCase()).digest('hex').slice(0,12))").Trim()
    $savedVenv = if ($previous.python) { Split-Path (Split-Path $previous.python -Parent) -Parent } else { $null }
    $venv = Resolve-SetupPath $env:VIBEPOD_VENV $savedVenv (Join-Path $localRoot "environments\$repoHash")
    $env:UV_PROJECT_ENVIRONMENT = $venv
    $env:UV_LINK_MODE = 'copy'
    $cache = Resolve-SetupPath $env:HF_HOME $previous.hfHome (Join-Path $localRoot 'huggingface')
    $base = Resolve-SetupPath $env:VIBEPOD_MODEL_PATH $previous.modelPath (Join-Path $localRoot 'models\qwen-base')
    $design = Resolve-SetupPath $env:VIBEPOD_DESIGN_MODEL_PATH $previous.designModelPath (Join-Path $localRoot 'models\qwen-design')
    $env:HF_HOME = $cache
    $backendPort = if ($null -ne $previous.backendPort) { $previous.backendPort } else { 8000 }
    $webPort = if ($null -ne $previous.webPort) { $previous.webPort } else { 3000 }
    foreach ($port in @($backendPort, $webPort)) {
        if (($port -isnot [int] -and $port -isnot [long]) -or $port -lt 1024 -or $port -gt 65535) { throw 'Configured ports must be integers between 1024 and 65535.' }
    }
    if ($backendPort -eq $webPort) { throw 'Configured web and backend ports must differ.' }
    Write-Host '[setup] Installing locked frontend dependencies'
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
    Push-Location server
    try {
        Write-Host '[setup] Installing Python 3.12.9 and locked CUDA dependencies'
        uv python install 3.12.9
        if ($LASTEXITCODE -ne 0) { throw 'Python installation failed.' }
        uv sync --frozen --python 3.12.9
        if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }
        & (Join-Path $venv 'Scripts\python.exe') doctor.py
        if ($LASTEXITCODE -ne 0) { throw 'GPU/export readiness check failed.' }
        if (-not $SkipModels) {
            foreach ($model in @(@('Base', $base, 'fd4b254389122332181a7c3db7f27e918eec64e3'), @('VoiceDesign', $design, '5ecdb67327fd37bb2e042aab12ff7391903235d3'))) {
                Write-Host "[setup] Downloading/verifying $($model[0]) checkpoint"
                & (Join-Path $venv 'Scripts\python.exe') download_model.py "Qwen/Qwen3-TTS-12Hz-1.7B-$($model[0])" $model[1] --revision $model[2]
                if ($LASTEXITCODE -ne 0) { throw "Model setup failed: $($model[0]). Rerun to resume." }
            }
        }
    } finally { Pop-Location }
    $config = @{
        python = (Join-Path $venv 'Scripts\python.exe'); modelPath = $base; designModelPath = $design
        hfHome = $cache; backendPort = $backendPort; webPort = $webPort
        lockHash = (node -e "const fs=require('fs'),c=require('crypto');console.log(c.createHash('sha256').update(fs.readFileSync('server/uv.lock')).update(fs.readFileSync('pnpm-lock.yaml')).digest('hex'))").Trim()
    }
    New-Item -ItemType Directory -Path '.vibepod' -Force | Out-Null
    $config | ConvertTo-Json | Set-Content -LiteralPath '.vibepod\config.json' -Encoding UTF8
    Write-Host '[setup] Ready. Run pnpm dev. Use pnpm run doctor to check this installation.'
    if ($SkipModels) { Write-Warning 'Model prefetch skipped. First use can download the checkpoints; rerun setup without -SkipModels for offline readiness.' }
} finally { Pop-Location }
