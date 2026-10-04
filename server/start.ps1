# Compatibility entry point: use the configured environment and supervisor.
& (Join-Path (Split-Path $PSScriptRoot -Parent) 'start.ps1') @args
exit $LASTEXITCODE
