@echo off
rem ==========================================================================================
rem  Klik dua kali untuk menyalakan ASISTEN REVIEW VIDEO (mode uji) di laptop:
rem    1) ambil update terbaru dari GitHub (git pull)
rem    2) pasang ulang paket review-worker HANYA kalau isinya berubah (install.ps1)
rem    3) cek pengaturan: .env, VPN + DB Konten.com (read-only), Supabase, kunci AI, GPU, ffmpeg, Java/Panako, OCR
rem       - ada yang belum beres pun mesin tetap dinyalakan (pesan jelas di layar)
rem    4) nyalakan mesin (jendela ini biarkan terbuka). Mesin suara (NYALAKAN-MESIN-SUARA.bat) boleh jalan bersamaan:
rem       GPU dipakai bergantian otomatis, mesin suara didahulukan.
rem  Boleh ditaruh di folder utama repo ATAU di Desktop.
rem  Kalau repo kamu ada di folder lain, ganti baris "set REPO=" di bawah.
rem ==========================================================================================
chcp 65001 >nul
setlocal EnableExtensions
title Nyalakan Asisten Review (Uji)

set "REPO="
if exist "%~dp0review-worker\jalankan.bat" set "REPO=%~dp0"
if not defined REPO if exist "C:\Konten.com\Hot-Issue-Konten.com\review-worker\jalankan.bat" set "REPO=C:\Konten.com\Hot-Issue-Konten.com\"
rem cari otomatis: <folder>\Hot-Issue-Konten.com di C:\, D:\, folder user, Documents, Desktop (1 tingkat)
if not defined REPO for /d %%D in ("C:\*" "D:\*" "%USERPROFILE%\*" "%USERPROFILE%\Documents\*" "%USERPROFILE%\Desktop\*") do (
  if not defined REPO if exist "%%~D\Hot-Issue-Konten.com\review-worker\jalankan.bat" set "REPO=%%~D\Hot-Issue-Konten.com\"
  if not defined REPO if /i "%%~nxD"=="Hot-Issue-Konten.com" if exist "%%~D\review-worker\jalankan.bat" set "REPO=%%~D\"
)
if not defined REPO goto tidakketemu

cd /d "%REPO%"
echo Folder repo: %CD%
echo.

rem ---------------------------------------------------------------- 1. update kode
echo [1/4] Ambil update terbaru dari GitHub...
where git >nul 2>nul
if errorlevel 1 goto tanpagit
git pull --ff-only
if errorlevel 1 goto gagalpull
goto cekpasang

:tanpagit
echo     git tidak ditemukan, update dilewati. Mesin dinyalakan pakai versi yang ada.
goto cekpasang

:gagalpull
echo.
echo     Update gagal - biasanya karena ada file yang diubah sendiri di laptop, atau internet putus.
echo     Mesin tetap dinyalakan pakai versi yang ada sekarang.
echo.

rem ---------------------------------------------------------------- 2. pasang ulang kalau perlu
:cekpasang
echo.
echo [2/4] Cek paket Asisten Review...
set "RW=%REPO%review-worker"
set "SNAP=%RW%\.venv\terpasang"
set "PERLU=0"
if not exist "%RW%\.venv\Scripts\python.exe" set "PERLU=1"
if "%PERLU%"=="1" goto pasang
if not exist "%SNAP%\" goto catat
for %%F in (requirements.txt requirements-gpu.txt install.ps1) do (
  if exist "%RW%\%%F" (
    fc /b "%RW%\%%F" "%SNAP%\%%F" >nul 2>nul || set "PERLU=1"
  )
)
if "%PERLU%"=="1" goto pasang
echo     Paket sudah terbaru.
goto cek

:pasang
echo     Ada paket baru / belum terpasang. Memasang (pertama kali bisa 10-20 menit, sekali saja)...
pushd "%RW%"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\install.ps1"
set "KODEPASANG=%ERRORLEVEL%"
popd
if not "%KODEPASANG%"=="0" goto gagalpasang

:catat
if not exist "%SNAP%\" mkdir "%SNAP%" >nul 2>nul
for %%F in (requirements.txt requirements-gpu.txt install.ps1) do if exist "%RW%\%%F" copy /y "%RW%\%%F" "%SNAP%\%%F" >nul 2>nul
echo     Paket siap.
goto cek

:gagalpasang
echo.
echo GAGAL memasang paket Asisten Review (kode %KODEPASANG%). Baca pesan merah di atas, lalu coba klik lagi.
pause
exit /b 1

rem ---------------------------------------------------------------- 3. cek pengaturan (tanpa biaya AI)
:cek
echo.
echo [3/4] Cek pengaturan (VPN + DB Konten.com, Supabase, kunci AI, GPU, Java/Panako, OCR)...
pushd "%RW%"
set PYTHONUTF8=1
set PYTHONUNBUFFERED=1
".venv\Scripts\python.exe" review.py cek
set "KODECEK=%ERRORLEVEL%"
popd
if not "%KODECEK%"=="0" echo     Ada yang belum beres - lihat baris GAGAL di atas. Mesin tetap dinyalakan; bagian itu ditandai di website.

rem ---------------------------------------------------------------- 4. nyalakan
echo.
echo [4/4] Menyalakan Asisten Review...
echo     Tunggu tulisan "Menunggu antrian dari website" lalu BIARKAN jendela ini terbuka.
echo     Berhenti: tekan Ctrl+C (sekali = sesudah video ini, dua kali = sekarang).
echo.
call "%RW%\jalankan.bat"
exit /b %ERRORLEVEL%

:tidakketemu
echo Folder repo Hot-Issue-Konten.com tidak ketemu.
echo Taruh file ini di folder utama repo (sebelah folder review-worker),
echo atau buka file ini pakai Notepad dan isi baris  set "REPO=..."  dengan lokasi repo kamu.
pause
exit /b 1
