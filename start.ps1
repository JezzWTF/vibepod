$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    node scripts/dev.mjs @args
    exit $LASTEXITCODE
} finally { Pop-Location }
