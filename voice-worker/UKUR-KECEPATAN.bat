@echo off
rem Ukur kecepatan mesin suara Chatterbox di laptop ini: cara lama vs cara baru (tanpa website / Supabase).
rem Hasil: tabel di layar + data\bench-<tanggal>.json + contoh suara data\bench-A.wav (lama) dan data\bench-C.wav (baru).
chcp 65001 >nul
cd /d "%~dp0"
title Ukur kecepatan mesin suara
if not exist ".venv\Scripts\python.exe" (
  echo Belum terpasang. Jalankan dulu:  powershell -ExecutionPolicy Bypass -File install.ps1
  pause
  exit /b 1
)
set PYTHONUTF8=1
set PYTHONUNBUFFERED=1
echo Matikan dulu worker (jendela voice-worker) supaya GPU tidak dipakai dua program sekaligus.
echo Pengukuran butuh sekitar 2-4 menit.
echo.
".venv\Scripts\python.exe" bench.py %*
echo.
pause
