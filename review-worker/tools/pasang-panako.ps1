# Pasang Panako (pencocok musik) untuk review-worker di Windows. Dipanggil install.ps1, atau sendiri dari folder review-worker:
#   powershell -ExecutionPolicy Bypass -File .\tools\pasang-panako.ps1
# Opsi:
#   -Paksa   bangun ulang walau panako.jar sudah ada
#
# Yang dilakukan (semua di folder review-worker\tools, TANPA hak admin, tidak menyentuh sistem):
#   1. Java: pakai JDK 11+ yang sudah ada (javac di PATH), kalau tidak ada unduh Eclipse Temurin JDK 21 (zip portable,
#      +-190 MB) ke tools\jdk dan cocokkan SHA-256 dari API Adoptium.
#   2. Kode sumber Panako 2.1 (AGPL-3.0), TarsosDSP (GPL-3.0) dan JGaborator (AGPL-3.0) diambil lewat git pada commit
#      yang dikunci di bawah (repo resmi github.com/JorenSix).
#   3. Pustaka pendukung dari Maven Central (SHA-1 dicek): reflections, slf4j, lmdbjava (+ jnr/asm).
#   4. Dikompilasi dengan javac (Java 11) jadi tools\panako\panako.jar + pembantu tools\panako\drv\PanakoSekali.class.
# Kenapa tidak "gradlew shadowJar" seperti README Panako: Gradle 7.2 di repo Panako tidak jalan di Java 21, dan repo
# Maven TarsosDSP (mvn.0110.be) kadang tidak bisa dihubungi. Hasilnya sama: Panako tidak diubah sama sekali.
# Lisensi: Panako/JGaborator AGPL-3.0, TarsosDSP GPL-3.0 - dipakai internal di laptop ini saja (tidak dibagikan / tidak
# dilayankan ke pihak luar), jadi tidak ada kewajiban tambahan. JAR TIDAK di-commit (tools\panako di .gitignore).
# Gagal di langkah mana pun = review-worker tetap jalan; cek musik memakai cara cadangan (chroma).
param([switch]$Paksa)

# "Continue": di PowerShell 5.1 baris stderr program (javac "Note:", git) TIDAK boleh menghentikan skrip; kode keluar dicek manual
$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"   # Invoke-WebRequest jauh lebih cepat tanpa bilah progres
$tools = $PSScriptRoot
$rw = Split-Path -Parent $tools
$out = Join-Path $tools "panako"
$src = Join-Path $out "src"
$jarOut = Join-Path $out "panako.jar"

function Info($t) { Write-Host "    $t" }
function Awas($t) { Write-Host "    PERHATIAN: $t" -ForegroundColor Yellow }
function Gagal($t) { Write-Host ""; Write-Host "GAGAL (Panako): $t" -ForegroundColor Red; Write-Host "    Cek musik tetap jalan memakai cara cadangan (chroma)."; exit 1 }

# commit yang dikunci (dicek 12 Nov 2026)
$REPO = @(
    @{ nama = "Panako";     url = "https://github.com/JorenSix/Panako";     commit = "f1248f7a35a06af449f02f7df33c4cfdc1aeedc1"; java = @("src\main\java") },
    @{ nama = "TarsosDSP";  url = "https://github.com/JorenSix/TarsosDSP";  commit = "41476b268b8b34664d3e43997fb05c95cec29e3d"; java = @("core\src\main\java", "jvm\src\main\java") },
    @{ nama = "JGaborator"; url = "https://github.com/JorenSix/JGaborator"; commit = "196ecb11d622987ec1894e400b31080f978b8cae"; java = @("src\main\java"); res = "src\main\resources" }
)
$MAVEN = "https://repo.maven.apache.org/maven2"
$DEPS = @(
    @("org/ow2/asm/asm/9.7.1/asm-9.7.1.jar", "f0ed132a49244b042cd0e15702ab9f2ce3cc8436"),
    @("org/ow2/asm/asm-analysis/9.7.1/asm-analysis-9.7.1.jar", "f97a3b319f0ed6a8cd944dc79060d3912a28985f"),
    @("org/ow2/asm/asm-commons/9.7.1/asm-commons-9.7.1.jar", "406c6a2225cfe1819f102a161e54cc16a5c24f75"),
    @("org/ow2/asm/asm-tree/9.7.1/asm-tree-9.7.1.jar", "3a53139787663b139de76b627fca0084ab60d32c"),
    @("org/ow2/asm/asm-util/9.7.1/asm-util-9.7.1.jar", "9e23359b598ec6b74b23e53110dd5c577adf2243"),
    @("org/javassist/javassist/3.28.0-GA/javassist-3.28.0-GA.jar", "9a958811a88381bb159cc2f5ed79c34a45c4af7a"),
    @("com/github/jnr/jffi/1.3.13/jffi-1.3.13.jar", "861b79314b8cef27f506c007edb78bf1ad0df77c"),
    @("com/github/jnr/jffi/1.3.13/jffi-1.3.13-native.jar", "15e41e9c8f02b384bf138ab7f2778b441bfa5df3"),
    @("com/github/jnr/jnr-a64asm/1.0.0/jnr-a64asm-1.0.0.jar", "0a1cb8dbe71b5a6a0288043c3ba3ca64545be165"),
    @("com/github/jnr/jnr-constants/0.10.4/jnr-constants-0.10.4.jar", "09f6f23763bf40ea7b56391791f574174914430a"),
    @("com/github/jnr/jnr-ffi/2.2.17/jnr-ffi-2.2.17.jar", "3b3a375fb3509a2d2014687d5e8d6b3881a3614e"),
    @("com/github/jnr/jnr-x86asm/1.0.2/jnr-x86asm-1.0.2.jar", "006936bbd6c5b235665d87bd450f5e13b52d4b48"),
    @("com/google/code/findbugs/jsr305/3.0.2/jsr305-3.0.2.jar", "25ea2e8b0c338a877313bd4672d3fe056ea78f0d"),
    @("org/lmdbjava/lmdbjava/0.9.1/lmdbjava-0.9.1.jar", "df36afd172b8b0836f6a862e249d1ba555c5c2b7"),
    @("org/reflections/reflections/0.10.2/reflections-0.10.2.jar", "b638d7ca0e0fe0146b60a0e7ba232ad852a73b31"),
    @("org/slf4j/slf4j-api/1.7.32/slf4j-api-1.7.32.jar", "cdcff33940d9f2de763bc41ea05a0be5941176c3"),
    @("org/slf4j/slf4j-simple/1.7.36/slf4j-simple-1.7.36.jar", "a41f9cfe6faafb2eb83a1c7dd2d0dfd844e2a936")
)

function Unduh($url, $dest, $sha1) {
    for ($i = 1; $i -le 3; $i++) {
        try {
            Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -TimeoutSec 300 -ErrorAction Stop
            if (-not $sha1) { return }
            $h = (Get-FileHash -Algorithm SHA1 -Path $dest).Hash.ToLower()
            if ($h -eq $sha1) { return }
            Awas "SHA-1 tidak cocok untuk $(Split-Path -Leaf $dest) (percobaan $i)"
        } catch { Awas "unduh gagal (percobaan $i): $($_.Exception.Message)" }
        Start-Sleep -Seconds 3
    }
    Gagal "tidak bisa mengunduh $(Split-Path -Leaf $dest)"
}

# ---------------------------------------------------------------- 0. sudah terpasang?
$drvClass = Join-Path $out "drv\PanakoSekali.class"
if ((Test-Path $jarOut) -and (Test-Path $drvClass) -and -not $Paksa) {
    Info "Panako sudah terpasang ($jarOut). Pakai -Paksa untuk membangun ulang."
    exit 0
}

# ---------------------------------------------------------------- 1. Java (JDK 11+)
Write-Host "==> Panako 1/4: Java (JDK)" -ForegroundColor Cyan
$jdkDir = Join-Path $tools "jdk"
$javac = $null
$lokal = Get-ChildItem -Path $jdkDir -Filter javac.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($lokal) { $javac = $lokal.FullName }
if (-not $javac) {
    $sys = Get-Command javac -ErrorAction SilentlyContinue
    if ($sys) {
        $v = (cmd /c "`"$($sys.Source)`" -version 2>&1" | Out-String)
        if ($v -match "javac (\d+)") { if ([int]$Matches[1] -ge 11) { $javac = $sys.Source } }
    }
}
if (-not $javac) {
    Info "JDK belum ada -> unduh Eclipse Temurin JDK 21 (zip portable, +-190 MB) ke tools\jdk ..."
    try {
        $meta = Invoke-RestMethod -ErrorAction Stop -UseBasicParsing -TimeoutSec 60 -Uri "https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse"
        $pkg = ($meta | Where-Object { $_.binary.package.name -like "*.zip" } | Select-Object -First 1).binary.package
    } catch { Gagal "API Adoptium tidak bisa dihubungi: $($_.Exception.Message)" }
    if (-not $pkg) { Gagal "paket Temurin 21 untuk Windows x64 tidak ditemukan" }
    $zip = Join-Path $env:TEMP $pkg.name
    for ($i = 1; $i -le 3; $i++) {
        try { Invoke-WebRequest -Uri $pkg.link -OutFile $zip -UseBasicParsing -TimeoutSec 1800 -ErrorAction Stop } catch { Awas "unduh JDK gagal (percobaan $i)" }
        if ((Test-Path $zip) -and ((Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower() -eq $pkg.checksum.ToLower())) { break }
        if ($i -eq 3) { Gagal "unduhan JDK rusak (SHA-256 tidak cocok)" }
    }
    New-Item -ItemType Directory -Force -Path $jdkDir | Out-Null
    try { Expand-Archive -Path $zip -DestinationPath $jdkDir -Force -ErrorAction Stop } catch { Gagal "ekstrak JDK gagal: $($_.Exception.Message)" }
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    $lokal = Get-ChildItem -Path $jdkDir -Filter javac.exe -Recurse | Select-Object -First 1
    if (-not $lokal) { Gagal "javac tidak ditemukan sesudah JDK diekstrak" }
    $javac = $lokal.FullName
}
$binJdk = Split-Path -Parent $javac
$jarExe = Join-Path $binJdk "jar.exe"
$javaExe = Join-Path $binJdk "java.exe"
Info "JDK: $binJdk"

# ---------------------------------------------------------------- 2. kode sumber (git, commit dikunci)
Write-Host "==> Panako 2/4: kode sumber Panako + TarsosDSP + JGaborator" -ForegroundColor Cyan
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Gagal "git tidak ditemukan (dipakai juga oleh NYALAKAN-ASISTEN-REVIEW.bat)" }
New-Item -ItemType Directory -Force -Path $src | Out-Null
foreach ($r in $REPO) {
    $d = Join-Path $src $r.nama
    if (-not (Test-Path (Join-Path $d ".git"))) {
        git init -q $d; if ($LASTEXITCODE -ne 0) { Gagal "git init $($r.nama)" }
        git -C $d remote add origin $r.url
    }
    $now = (cmd /c "git -C `"$d`" rev-parse HEAD 2>nul")
    if ($now -ne $r.commit) {
        Info "ambil $($r.nama) @ $($r.commit.Substring(0, 10))"
        git -C $d fetch -q --depth 1 origin $r.commit; if ($LASTEXITCODE -ne 0) { Gagal "git fetch $($r.nama) gagal (internet?)" }
        git -C $d -c advice.detachedHead=false checkout -q -f FETCH_HEAD; if ($LASTEXITCODE -ne 0) { Gagal "git checkout $($r.nama)" }
    }
}

# ---------------------------------------------------------------- 3. pustaka Maven Central
Write-Host "==> Panako 3/4: pustaka pendukung (Maven Central)" -ForegroundColor Cyan
$depsDir = Join-Path $out "deps"
New-Item -ItemType Directory -Force -Path $depsDir | Out-Null
foreach ($d in $DEPS) {
    $f = Join-Path $depsDir (Split-Path -Leaf $d[0])
    if ((Test-Path $f) -and ((Get-FileHash -Algorithm SHA1 -Path $f).Hash.ToLower() -eq $d[1])) { continue }
    Unduh "$MAVEN/$($d[0])" $f $d[1]
}

# ---------------------------------------------------------------- 4. kompilasi -> panako.jar + pembantu
Write-Host "==> Panako 4/4: kompilasi (javac, Java 11)" -ForegroundColor Cyan
$kelas = Join-Path $out "kelas"
if (Test-Path $kelas) { Remove-Item $kelas -Recurse -Force }
New-Item -ItemType Directory -Force -Path $kelas | Out-Null
$daftar = Join-Path $out "sumber.txt"
$files = @()
foreach ($r in $REPO) {
    foreach ($j in $r.java) {
        $files += Get-ChildItem -Path (Join-Path (Join-Path $src $r.nama) $j) -Filter *.java -Recurse | Where-Object { $_.Name -ne "module-info.java" } | ForEach-Object { '"' + ($_.FullName -replace '\\', '/') + '"' }
    }
}
[System.IO.File]::WriteAllLines($daftar, $files)
$cp = (Get-ChildItem -Path $depsDir -Filter *.jar | ForEach-Object { $_.FullName }) -join ";"
& $javac -nowarn -encoding UTF-8 --release 11 -d $kelas -cp $cp "@$daftar"
if ($LASTEXITCODE -ne 0) { Gagal "kompilasi Panako gagal" }
foreach ($r in $REPO) {
    if ($r.res) { Copy-Item -Path (Join-Path (Join-Path (Join-Path $src $r.nama) $r.res) "*") -Destination $kelas -Recurse -Force }
}
Push-Location $kelas
try {
    foreach ($j in Get-ChildItem -Path $depsDir -Filter *.jar) { & $jarExe xf $j.FullName; if ($LASTEXITCODE -ne 0) { Gagal "ekstrak $($j.Name)" } }
} finally { Pop-Location }
Remove-Item -Path (Join-Path $kelas "module-info.class") -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path (Join-Path $kelas "META-INF") -Include *.SF, *.RSA, *.DSA -Recurse -ErrorAction SilentlyContinue | Remove-Item -Force
$man = Join-Path $out "manifest.txt"
[System.IO.File]::WriteAllText($man, "Main-Class: be.panako.cli.Panako`r`n")
if (Test-Path $jarOut) { Remove-Item $jarOut -Force }
& $jarExe cfm $jarOut $man -C $kelas .; if ($LASTEXITCODE -ne 0) { Gagal "membuat panako.jar" }
Remove-Item $kelas -Recurse -Force -ErrorAction SilentlyContinue

$drv = Join-Path $out "drv"
New-Item -ItemType Directory -Force -Path $drv | Out-Null
& $javac -nowarn --release 11 -cp $jarOut -d $drv (Join-Path $tools "PanakoSekali.java"); if ($LASTEXITCODE -ne 0) { Gagal "kompilasi PanakoSekali" }
$cek = (& $javaExe -cp "$jarOut;$drv" PanakoSekali STRATEGY=PANAKO | Out-String)
if ($cek -notmatch "SIAP") { Gagal "uji jalan Panako gagal" }
Info "Panako siap: $jarOut"
Info "Uji kecocokan sungguhan dijalankan oleh 'review cek' (bagian musik)."
exit 0
