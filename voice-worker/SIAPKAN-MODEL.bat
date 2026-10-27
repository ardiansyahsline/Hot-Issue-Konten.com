@echo off
rem ==========================================================================================
rem  Klik dua kali untuk MENYIAPKAN (mengunduh) model mesin suara sekali di depan:
rem    Chatterbox (suara utama), faster-whisper (cek ucapan), DeepFilterNet3 (pembersih),
rem    UTMOS (penilai kealamian, opsional) dan pocket-tts (cadangan CPU).
rem  Unduhan cepat (banyak koneksi sekaligus) dan BISA DILANJUTKAN: kalau internet putus atau
rem  jendela ini ditutup, klik lagi - bagian yang sudah terunduh tidak diulang.
rem  Pilihan (boleh ditulis sesudah nama file di Command Prompt):
rem    --cek           status saja        --cepat        hanya yang belum ada
rem    --tanpa-utmos   lewati UTMOS       --koneksi 16   koneksi per file (bawaan 8)
rem ==========================================================================================
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title Siapkan model mesin suara - Studio Pro
if not exist ".venv\Scripts\python.exe" (
  echo Mesin suara belum terpasang. Jalankan dulu:  powershell -ExecutionPolicy Bypass -File install.ps1
  pause
  exit /b 1
)
set PYTHONUTF8=1
set PYTHONUNBUFFERED=1
".venv\Scripts\python.exe" siapkan_model.py %*
set "KODE=%ERRORLEVEL%"
echo.
if "%KODE%"=="0" (
  echo Selesai. Jendela ini boleh ditutup.
) else if "%KODE%"=="130" (
  echo Dihentikan. Klik SIAPKAN-MODEL.bat lagi untuk melanjutkan unduhan.
) else (
  echo Belum semua model siap - cek internet lalu klik SIAPKAN-MODEL.bat lagi, unduhan dilanjutkan.
)
pause
exit /b %KODE%
