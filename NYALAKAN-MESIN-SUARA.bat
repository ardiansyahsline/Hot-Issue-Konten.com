@echo off
rem ==========================================================================================
rem  Klik dua kali untuk menyalakan mesin suara laptop (Studio Pro):
rem    1) ambil update terbaru dari GitHub (git pull)
rem    2) pasang ulang paket mesin suara HANYA kalau isinya berubah
rem    3) nyalakan worker (jendela ini biarkan terbuka)
rem  Boleh ditaruh di folder utama repo ATAU di Desktop.
rem  Kalau repo kamu ada di folder lain, ganti baris "set REPO=" di bawah.
rem ==========================================================================================
chcp 65001 >nul
setlocal EnableExtensions
title Nyalakan mesin suara - Studio Pro

set "REPO="
if exist "%~dp0voice-worker\jalankan.bat" set "REPO=%~dp0"
if not defined REPO if exist "C:\Konten.com\Hot-Issue-Konten.com\voice-worker\jalankan.bat" set "REPO=C:\Konten.com\Hot-Issue-Konten.com\"
rem cari otomatis: <folder>\Hot-Issue-Konten.com di C:\, D:\, folder user, Documents, Desktop (1 tingkat)
if not defined REPO for /d %%D in ("C:\*" "D:\*" "%USERPROFILE%\*" "%USERPROFILE%\Documents\*" "%USERPROFILE%\Desktop\*") do (
  if not defined REPO if exist "%%~D\Hot-Issue-Konten.com\voice-worker\jalankan.bat" set "REPO=%%~D\Hot-Issue-Konten.com\"
  if not defined REPO if /i "%%~nxD"=="Hot-Issue-Konten.com" if exist "%%~D\voice-worker\jalankan.bat" set "REPO=%%~D\"
)
if not defined REPO goto tidakketemu

cd /d "%REPO%"
echo Folder repo: %CD%
echo.

rem ---------------------------------------------------------------- 1. update kode
echo [1/3] Ambil update terbaru dari GitHub...
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
echo [2/3] Cek paket mesin suara...
set "VW=%REPO%voice-worker"
set "SNAP=%VW%\.venv\terpasang"
set "PERLU=0"
if not exist "%VW%\.venv\Scripts\python.exe" set "PERLU=1"
if "%PERLU%"=="1" goto pasang
if not exist "%SNAP%\" goto catat
for %%F in (requirements.txt requirements-gpu.txt install.ps1) do (
  fc /b "%VW%\%%F" "%SNAP%\%%F" >nul 2>nul || set "PERLU=1"
)
if "%PERLU%"=="1" goto pasang
echo     Paket sudah terbaru.
goto nyalakan

:pasang
echo     Ada paket baru / belum terpasang. Memasang (bisa beberapa menit, sekali saja)...
pushd "%VW%"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\install.ps1"
set "KODEPASANG=%ERRORLEVEL%"
popd
if not "%KODEPASANG%"=="0" goto gagalpasang

:catat
if not exist "%SNAP%\" mkdir "%SNAP%" >nul 2>nul
for %%F in (requirements.txt requirements-gpu.txt install.ps1) do copy /y "%VW%\%%F" "%SNAP%\%%F" >nul 2>nul
echo     Paket siap.
goto nyalakan

:gagalpasang
echo.
echo GAGAL memasang paket mesin suara (kode %KODEPASANG%). Baca pesan merah di atas, lalu coba klik lagi.
pause
exit /b 1

rem ---------------------------------------------------------------- 3. nyalakan worker
:nyalakan
echo.
echo [3/3] Menyalakan mesin suara...
echo     Tunggu tulisan "Menunggu antrian dari website" lalu BIARKAN jendela ini terbuka.
echo     Berhenti: tekan Ctrl+C.
echo.
call "%VW%\jalankan.bat"
exit /b %ERRORLEVEL%

:tidakketemu
echo Folder repo Hot-Issue-Konten.com tidak ketemu.
echo Taruh file ini di folder utama repo (sebelah folder voice-worker),
echo atau buka file ini pakai Notepad dan isi baris  set "REPO=..."  dengan lokasi repo kamu.
pause
exit /b 1
