@echo off
rem Jalankan Asisten Review (review-worker). Biarkan jendela ini terbuka.
rem Ctrl+C = berhenti sesudah video ini selesai, Ctrl+C lagi = berhenti sekarang.
chcp 65001 >nul
cd /d "%~dp0"
title Asisten Review (Uji) - review-worker
if not exist ".venv\Scripts\python.exe" (
  echo Belum terpasang. Jalankan dulu:  powershell -ExecutionPolicy Bypass -File install.ps1
  pause
  exit /b 1
)
set PYTHONUTF8=1
set PYTHONUNBUFFERED=1

:ulang
".venv\Scripts\python.exe" review.py jalan
set KODE=%ERRORLEVEL%
if "%KODE%"=="0" goto selesai
if "%KODE%"=="2" (
  echo.
  echo Pengaturan belum lengkap. Buka file .env ^(notepad .env^) lalu isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY.
  pause
  exit /b 2
)
echo.
echo Asisten Review berhenti tidak normal (kode %KODE%). Dijalankan ulang dalam 15 detik... (tutup jendela untuk batal)
timeout /t 15 /nobreak >nul
goto ulang

:selesai
echo Asisten Review berhenti.
