$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    $env:UV_PROJECT_ENVIRONMENT = if ($env:VIBEPOD_VENV) { $env:VIBEPOD_VENV } else { Join-Path $env:LOCALAPPDATA 'VibePod\venv' }
    uv sync --frozen
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
    $port = if ($env:VIBEPOD_PORT) { $env:VIBEPOD_PORT } else { '8000' }
    uv run --no-sync uvicorn tts_server:app --host 127.0.0.1 --port $port
    if ($LASTEXITCODE -ne 0) { throw 'Server exited with an error' }
} finally { Pop-Location }
