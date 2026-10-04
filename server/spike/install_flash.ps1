param(
    [string]$Python = (Join-Path $env:USERPROFILE '.codex/vibepod-spike/qwen/Scripts/python.exe'),
    [string]$WheelDirectory = (Join-Path $env:USERPROFILE '.codex/vibepod-spike/wheels')
)

$ErrorActionPreference = 'Stop'
if (!$IsWindows) { throw 'This helper selects Windows wheels only' }
$runtime = & $Python -c 'import json,sys,torch; print(json.dumps({"python":f"cp{sys.version_info.major}{sys.version_info.minor}","torch":".".join(torch.__version__.split(".")[:2]),"cuda":torch.version.cuda}))'
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the candidate runtime' }
$runtime = $runtime | ConvertFrom-Json
if (!$runtime.cuda) { throw 'A CUDA PyTorch build is required' }
$cudaTag = 'cu' + $runtime.cuda.Replace('.', '')
$runtimeTag = [regex]::Escape("+$($cudaTag)torch$($runtime.torch)-$($runtime.python)-$($runtime.python)-win_amd64.whl")
$selectedWheel = $null
for ($page = 1; $page -le 3 -and !$selectedWheel; $page++) {
    $releases = Invoke-RestMethod "https://api.github.com/repos/mjun0812/flash-attention-prebuild-wheels/releases?per_page=100&page=$page"
    $selectedWheel = $releases.assets | Where-Object { $_.name -match '^flash_attn-2\.' -and $_.name -match "$runtimeTag`$" } | Select-Object -First 1
    if (!$releases) { break }
}
if (!$selectedWheel) { throw "No matching FA2 Windows wheel for $cudaTag / torch $($runtime.torch) / $($runtime.python)" }
if ($selectedWheel.digest -notmatch '^sha256:([a-f0-9]{64})$') { throw 'Release asset has no SHA256 digest; refusing an unverified wheel' }
$expectedHash = $Matches[1]
New-Item -ItemType Directory -Path $WheelDirectory -Force | Out-Null
$wheelPath = Join-Path $WheelDirectory $selectedWheel.name
if (!(Test-Path -LiteralPath $wheelPath)) {
    Invoke-WebRequest $selectedWheel.browser_download_url -OutFile $wheelPath
}
$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $wheelPath).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) { throw 'Flash attention wheel SHA256 mismatch' }
& uv pip install --python $Python 'einops==0.8.2'
if ($LASTEXITCODE -ne 0) { throw 'Cannot install einops' }
& uv pip install --python $Python --no-deps $wheelPath
if ($LASTEXITCODE -ne 0) { throw 'Cannot install the matched wheel' }
& $Python -c 'import torch,flash_attn; print("flash-attn",flash_attn.__version__,"torch",torch.__version__,"CUDA",torch.version.cuda)'
if ($LASTEXITCODE -ne 0) { throw 'Matched wheel failed its import check' }
Write-Output "Verified and installed $($selectedWheel.name) from $($selectedWheel.browser_download_url)"
