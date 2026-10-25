# Pasang voice-worker di Windows. Jalankan dari folder voice-worker:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
# Opsi:
#   -CpuSaja      laptop tanpa GPU NVIDIA (pakai pocket-tts CPU saja)
#   -TanpaRender  lewati pemasangan Remotion (render MP4 di laptop)
# Aman dijalankan ulang (mis. setelah git pull).
param([switch]$CpuSaja, [switch]$TanpaRender)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
$repo = Split-Path -Parent $PSScriptRoot

function Langkah($t) { Write-Host ""; Write-Host "==> $t" -ForegroundColor Cyan }
function Info($t) { Write-Host "    $t" }
function Awas($t) { Write-Host "    PERHATIAN: $t" -ForegroundColor Yellow }
function Gagal($t) { Write-Host ""; Write-Host "GAGAL: $t" -ForegroundColor Red; exit 1 }
function Cek($t) { if ($LASTEXITCODE -ne 0) { Gagal $t } }

# ---------------------------------------------------------------- 1. uv (pengelola Python)
Langkah "1/8 Cek uv"
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Info "uv belum ada, memasang..."
    powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { Gagal "uv tidak bisa dipasang. Pasang manual dari https://docs.astral.sh/uv/ lalu ulangi." }
}
Info (uv --version)

# ---------------------------------------------------------------- 2. ffmpeg
Langkah "2/8 Cek ffmpeg"
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Awas "ffmpeg belum ada. Mencoba memasang lewat winget (Gyan.FFmpeg)..."
    try { winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements } catch { }
    Awas "Setelah selesai, TUTUP lalu buka lagi PowerShell supaya ffmpeg terbaca, lalu jalankan install.ps1 sekali lagi."
} else {
    Info ((ffmpeg -hide_banner -version | Select-Object -First 1))
}

# ---------------------------------------------------------------- 3. Python 3.11 + .venv
Langkah "3/8 Siapkan Python 3.11 (.venv)"
uv python install 3.11; Cek "Python 3.11 gagal dipasang"
if (-not (Test-Path ".venv\Scripts\python.exe")) { uv venv --python 3.11 .venv; Cek "gagal membuat .venv" }
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
Info (& $py --version)

# ---------------------------------------------------------------- 4. PyTorch
if ($CpuSaja) {
    Langkah "4/8 PyTorch 2.8 (CPU)"
    uv pip install --python $py torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cpu; Cek "PyTorch gagal dipasang"
} else {
    Langkah "4/8 PyTorch 2.8 CUDA 12.8 (cu128 - wajib untuk RTX 50xx / Blackwell sm_120)"
    uv pip install --python $py torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128; Cek "PyTorch cu128 gagal dipasang"
}

# ---------------------------------------------------------------- 5. paket dasar
Langkah "5/8 Paket dasar (numpy, librosa, faster-whisper, httpx, ...)"
uv pip install --python $py -r requirements.txt; Cek "paket dasar gagal dipasang"

# ---------------------------------------------------------------- 6. mesin suara
Langkah "6/8 Mesin suara: Chatterbox (--no-deps), pocket-tts, DeepFilterNet"
# chatterbox-tts mengunci torch 2.6 (belum kenal RTX 50xx) -> dipasang tanpa dependensi, lalu dependensinya satu per satu
uv pip install --python $py --no-deps chatterbox-tts==0.1.7 s3tokenizer==0.3.0 deepfilternet==0.5.6; Cek "chatterbox/deepfilternet gagal dipasang"
uv pip install --python $py -r requirements-gpu.txt; Cek "dependensi mesin suara gagal dipasang"

# pastikan torch tidak tertimpa versi lain oleh langkah di atas
$tv = (& $py -c "import torch;print(torch.__version__)").Trim()
Info "torch $tv"
if ((-not $CpuSaja) -and ($tv -notmatch "cu12[89]|cu13")) {
    Awas "torch bukan build CUDA 12.8 - pasang ulang..."
    uv pip install --python $py --reinstall-package torch --reinstall-package torchaudio torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128; Cek "PyTorch cu128 gagal dipasang ulang"
}

# ---------------------------------------------------------------- 7. Remotion (render MP4)
Langkah "7/8 Remotion CLI untuk render MP4 di laptop"
if ($TanpaRender) {
    Info "dilewati (-TanpaRender)"
} elseif (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Awas "Node.js belum ada - render MP4 di laptop tidak aktif. Pasang Node.js 20 LTS (https://nodejs.org) lalu jalankan install.ps1 lagi."
} else {
    Info ("node " + (node --version))
    Push-Location $repo
    try {
        if (-not (Test-Path "node_modules\remotion")) {
            Info "npm ci (paket website, sekali saja - agak lama)..."
            npm ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { Awas "npm ci gagal - render MP4 belum bisa dipakai" }
        }
        # --no-save: tidak mengubah package.json / package-lock.json repo
        npm i --no-save --no-audit --no-fund "@remotion/cli@4.0.535"
        if ($LASTEXITCODE -ne 0) { Awas "@remotion/cli gagal dipasang - render MP4 belum bisa dipakai" }
    } finally { Pop-Location }
}

# ---------------------------------------------------------------- 8. .env + cek
Langkah "8/8 Pengaturan & cek"
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Awas "File .env dibuat. Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY:  notepad .env"
}
& $py cek_gpu.py --cepat

Write-Host ""
Write-Host "Selesai dipasang." -ForegroundColor Green
Write-Host "  1) Isi .env (kalau belum):          notepad .env"
Write-Host "  2) Tes suara di GPU:                .venv\Scripts\python cek_gpu.py"
Write-Host "  3) Jalankan worker:                 jalankan.bat"
Write-Host "  4) Nyala otomatis saat laptop hidup: powershell -ExecutionPolicy Bypass -File .\pasang-otomatis.ps1"
