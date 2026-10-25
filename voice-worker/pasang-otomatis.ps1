# Nyalakan voice-worker otomatis setiap laptop hidup / login (Task Scheduler), tanpa jendela.
#   powershell -ExecutionPolicy Bypass -File .\pasang-otomatis.ps1          pasang
#   powershell -ExecutionPolicy Bypass -File .\pasang-otomatis.ps1 -Hapus   hapus
# Log tetap ditulis ke voice-worker\data\logs\worker-<tanggal>.log
param([switch]$Hapus)

$ErrorActionPreference = "Stop"
$nama = "Konten Studio voice-worker"

if ($Hapus) {
    Stop-ScheduledTask -TaskName $nama -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $nama -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Tugas otomatis '$nama' dihapus." -ForegroundColor Green
    exit 0
}

$dir = $PSScriptRoot
$pyw = Join-Path $dir ".venv\Scripts\pythonw.exe"
if (-not (Test-Path $pyw)) { Write-Host "Belum terpasang. Jalankan install.ps1 dulu." -ForegroundColor Red; exit 1 }
if (-not (Test-Path (Join-Path $dir ".env"))) { Write-Host "File .env belum ada. Jalankan install.ps1 lalu isi .env dulu." -ForegroundColor Red; exit 1 }

$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute $pyw -Argument "worker.py" -WorkingDirectory $dir
# 1) saat login (tunggu 1 menit supaya internet & bot WAHA siap dulu)
$t1 = New-ScheduledTaskTrigger -AtLogOn -User $user
$t1.Delay = "PT1M"
# 2) cek tiap 10 menit: kalau worker mati, dinyalakan lagi (kalau masih jalan, diabaikan)
$t2 = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(2)) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $nama -Action $action -Trigger @($t1, $t2) -Settings $settings -Principal $principal `
    -Description "Mesin suara & render Studio Pro (Konten.com). Folder: $dir" -Force | Out-Null
Start-ScheduledTask -TaskName $nama

Write-Host ""
Write-Host "Beres! voice-worker akan menyala otomatis setiap login dan dicek ulang tiap 10 menit." -ForegroundColor Green
Write-Host "  Cek status : buka Task Scheduler > Task Scheduler Library > '$nama'"
Write-Host "  Lihat log  : $dir\data\logs\"
Write-Host "  Matikan    : powershell -ExecutionPolicy Bypass -File .\pasang-otomatis.ps1 -Hapus"
