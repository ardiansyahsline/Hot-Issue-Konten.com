# Pasang review-worker (Asisten Review Video, MODE UJI) di Windows. Jalankan dari folder review-worker:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
# Opsi:
#   -CpuSaja      laptop tanpa GPU NVIDIA (torch CPU; suara & OCR jauh lebih lambat)
#   -TanpaJava    jangan pasang Java Temurin 21 portable + Panako (musik dicek dengan cara cadangan "chroma")
# .venv SENDIRI di review-worker\.venv (tidak berbagi dengan voice-worker -> tidak saling merusak). Butuh +-6 GB disk.
# Aman dijalankan ulang (mis. setelah git pull). Tidak ada password / kunci yang ditulis skrip ini.
param([switch]$CpuSaja, [switch]$TanpaJava)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Langkah($t) { Write-Host ""; Write-Host "==> $t" -ForegroundColor Cyan }
function Info($t) { Write-Host "    $t" }
function Awas($t) { Write-Host "    PERHATIAN: $t" -ForegroundColor Yellow }
function Gagal($t) { Write-Host ""; Write-Host "GAGAL: $t" -ForegroundColor Red; exit 1 }
function Cek($t) { if ($LASTEXITCODE -ne 0) { Gagal $t } }

# ---------------------------------------------------------------- 1. uv (pengelola Python)
Langkah "1/9 Cek uv"
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Info "uv belum ada, memasang..."
    powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { Gagal "uv tidak bisa dipasang. Pasang manual dari https://docs.astral.sh/uv/ lalu ulangi." }
}
Info (uv --version)

# ---------------------------------------------------------------- 2. ffmpeg (sudah ada kalau mesin suara terpasang)
Langkah "2/9 Cek ffmpeg"
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Awas "ffmpeg belum ada. Mencoba memasang lewat winget (Gyan.FFmpeg)..."
    try { winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements } catch { }
    Awas "Setelah selesai, TUTUP lalu buka lagi PowerShell supaya ffmpeg terbaca, lalu jalankan install.ps1 sekali lagi."
} else {
    Info ((ffmpeg -hide_banner -version | Select-Object -First 1))
}

# ---------------------------------------------------------------- 3. Python 3.11 + .venv sendiri
Langkah "3/9 Siapkan Python 3.11 (.venv review-worker)"
uv python install 3.11; Cek "Python 3.11 gagal dipasang"
if (-not (Test-Path ".venv\Scripts\python.exe")) { uv venv --python 3.11 .venv; Cek "gagal membuat .venv" }
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
Info (& $py --version)

# ---------------------------------------------------------------- 4. PyTorch (untuk EasyOCR + Demucs opsional)
if ($CpuSaja) {
    Langkah "4/9 PyTorch 2.8 (CPU)"
    uv pip install --python $py torch==2.8.0 torchvision==0.23.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cpu; Cek "PyTorch gagal dipasang"
} else {
    Langkah "4/9 PyTorch 2.8 CUDA 12.8 (cu128 - wajib untuk RTX 50xx / Blackwell sm_120)"
    uv pip install --python $py torch==2.8.0 torchvision==0.23.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128; Cek "PyTorch cu128 gagal dipasang"
}

# ---------------------------------------------------------------- 5. paket dasar
Langkah "5/9 Paket dasar (anthropic, psycopg, yt-dlp, PySceneDetect, faster-whisper, gdown, ...)"
uv pip install --python $py -r requirements.txt; Cek "paket dasar gagal dipasang"

# ---------------------------------------------------------------- 6. OCR (EasyOCR) + paket GPU
Langkah "6/9 OCR teks layar (EasyOCR) + paket GPU"
if (Test-Path "requirements-gpu.txt") {
    uv pip install --python $py -r requirements-gpu.txt; Cek "paket OCR / GPU gagal dipasang"
} else {
    uv pip install --python $py easyocr==1.7.2; Cek "EasyOCR gagal dipasang"
}
# pastikan torch tidak tertimpa versi lain oleh langkah di atas
$tv = (& $py -c "import torch;print(torch.__version__)").Trim()
Info "torch $tv"
if ((-not $CpuSaja) -and ($tv -notmatch "cu12[89]|cu13")) {
    Awas "torch bukan build CUDA 12.8 - pasang ulang..."
    uv pip install --python $py --reinstall-package torch --reinstall-package torchvision --reinstall-package torchaudio torch==2.8.0 torchvision==0.23.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128; Cek "PyTorch cu128 gagal dipasang ulang"
}
& $py -c "import gdown, yt_dlp, scenedetect, faster_whisper, psycopg, anthropic; print('    gdown', gdown.__version__, '| yt-dlp', yt_dlp.version.__version__, '| anthropic', anthropic.__version__)"
Cek "paket dasar belum lengkap (gdown / yt-dlp / psycopg / anthropic)"

# ---------------------------------------------------------------- 7-8. Java + Panako (pencocok musik campaign)
# tools\pasang-panako.ps1 memasang Java (Temurin 21 portable di tools\jdk, SHA-256 dicek) lalu membangun Panako di laptop
# (JAR TIDAK disimpan di GitHub). Gagal = tidak apa-apa: musik dicek dengan cara cadangan (chroma).
Langkah "7/9 Java (Temurin 21 portable, tanpa hak admin)"
$jdk = Join-Path $PSScriptRoot "tools\jdk"
$java = $null
if (Test-Path "$jdk\bin\java.exe") {
    $java = "$jdk\bin\java.exe"
} elseif (Get-Command java -ErrorAction SilentlyContinue) {
    $java = (Get-Command java).Source
}
if ($TanpaJava) {
    Info "dilewati (-TanpaJava). Musik dicek dengan cara cadangan (chroma)."
} elseif ($java) {
    Info "Java sudah ada: $java"
} elseif (Test-Path "tools\pasang-panako.ps1") {
    Info "Java dipasang bersama Panako di langkah berikutnya."
} else {
    Info "Memasang Java Temurin 21 (Eclipse Adoptium, gratis) portable ke tools\jdk - +-190 MB..."
    try {
        $zip = Join-Path $env:TEMP "temurin21-jdk.zip"
        $tmp = Join-Path $PSScriptRoot "tools\jdk-unduh"
        Invoke-WebRequest -UseBasicParsing -Uri "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk" -OutFile $zip
        if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
        Expand-Archive -Path $zip -DestinationPath $tmp -Force
        $isi = Get-ChildItem $tmp -Directory | Select-Object -First 1
        if (Test-Path $jdk) { Remove-Item -Recurse -Force $jdk }
        Move-Item $isi.FullName $jdk
        Remove-Item -Recurse -Force $tmp
        Remove-Item -Force $zip
        $java = "$jdk\bin\java.exe"
        $ErrorActionPreference = "Continue"  # java -version menulis ke stderr (PowerShell 5.1 + Stop = dianggap error)
        Info ("" + (& $java -version 2>&1 | Select-Object -First 1))
        $ErrorActionPreference = "Stop"
    } catch {
        $ErrorActionPreference = "Stop"
        Awas "Java gagal dipasang ($($_.Exception.Message)). Musik tetap dicek dengan cara cadangan (chroma). Coba lagi nanti."
        $java = $null
    }
}

Langkah "8/9 Panako (sidik jari audio)"
if ($TanpaJava) {
    Info "dilewati. Musik dicek dengan cara cadangan (chroma)."
} elseif (Test-Path "tools\pasang-panako.ps1") {
    try {
        & powershell -NoProfile -ExecutionPolicy Bypass -File ".\tools\pasang-panako.ps1"
        if ($LASTEXITCODE -ne 0) { Awas "Panako belum terpasang (kode $LASTEXITCODE). Musik dicek dengan cara cadangan dulu." }
    } catch {
        Awas "Panako belum terpasang ($($_.Exception.Message)). Musik dicek dengan cara cadangan dulu."
    }
} else {
    Awas "tools\pasang-panako.ps1 belum ada di versi ini - musik dicek dengan cara cadangan (chroma)."
}

# ---------------------------------------------------------------- 9. .env + cek
Langkah "9/9 Pengaturan & cek"
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Awas "File .env dibuat. Isi SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY:  notepad .env"
}
$env:PYTHONUTF8 = "1"
& $py review.py cek
if ($LASTEXITCODE -ne 0) { Awas "Ada yang belum beres (baris GAGAL di atas) - instal tetap SELESAI. Baca README.md bagian 'Kalau ada masalah'." }

Write-Host ""
Write-Host "Selesai dipasang." -ForegroundColor Green
Write-Host "  1) Isi .env (kalau belum):            notepad .env"
Write-Host "  2) Sambungkan VPN, lalu cek:          .venv\Scripts\python review.py cek"
Write-Host "  3) Kenali kolom DB (sekali):          .venv\Scripts\python review.py kenali-skema"
Write-Host "  4) Nyalakan:                          klik NYALAKAN-ASISTEN-REVIEW.bat (atau jalankan.bat)"
# instal selesai = kode 0 (hasil cek tidak ikut menggagalkan NYALAKAN-ASISTEN-REVIEW.bat)
exit 0
