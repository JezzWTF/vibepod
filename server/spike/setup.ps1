param(
    [string]$RuntimeRoot = (Join-Path $env:USERPROFILE '.codex/vibepod-spike')
)

$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    foreach ($candidate in @('qwen', 'vibevoice')) {
        $candidateEnv = Join-Path $RuntimeRoot $candidate
        $candidatePython = Join-Path $candidateEnv 'Scripts/python.exe'
        if (!(Test-Path -LiteralPath $candidatePython)) {
            & uv venv --python 3.12.9 $candidateEnv
            if ($LASTEXITCODE -ne 0) { throw "Cannot create $candidate environment" }
        }
        & uv pip install --python $candidatePython 'torch==2.8.0' 'torchaudio==2.8.0' --index-url 'https://download.pytorch.org/whl/cu128'
        if ($LASTEXITCODE -ne 0) { throw "Cannot install CUDA PyTorch for $candidate" }
        # Resolve ordinary dependencies from PyPI, keeping the installed CUDA wheels.
        & uv pip install --python $candidatePython -r "spike/$candidate-lock.txt" 'torch==2.8.0+cu128' 'torchaudio==2.8.0+cu128'
        if ($LASTEXITCODE -ne 0) { throw "Cannot install $candidate dependencies" }
        & $candidatePython -c 'import torch; assert torch.cuda.is_available(); print(torch.__version__, torch.version.cuda, torch.cuda.get_device_name())'
        if ($LASTEXITCODE -ne 0) { throw "CUDA validation failed for $candidate" }
    }
    Write-Output "Environments ready in $RuntimeRoot. Set HF_HOME to a drive with room for both checkpoints."
}
finally {
    Pop-Location
}
