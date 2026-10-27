"""
Siapkan (unduh) model mesin suara SEKALI di depan — supaya job VO tidak pernah menunggu unduhan di tengah jalan.

  SIAPKAN-MODEL.bat                  cek semua + unduh yang kurang + lengkapi unduhan yang setengah jadi
  SIAPKAN-MODEL.bat --cek            status saja (kode keluar 1 kalau model wajib belum ada)
  SIAPKAN-MODEL.bat --cepat          hanya unduh yang belum ada (tanpa cek ulang ke internet) — dipakai NYALAKAN-MESIN-SUARA.bat
  SIAPKAN-MODEL.bat --tanpa-utmos    lewati penilai kealamian UTMOS (392 MB, opsional)
  --hanya whisper,utmos              hanya model tertentu
  --koneksi 8                        jumlah koneksi paralel per file (bawaan DOWNLOAD_CONNECTIONS di .env)

Unduhan cepat & bisa dilanjutkan: banyak koneksi sekaligus, lanjut dari bagian terakhir kalau internet putus / jendela ditutup,
cek ukuran & isi file. Ctrl+C aman — jalankan lagi untuk melanjutkan. Tidak butuh SUPABASE_URL (boleh sebelum .env diisi).
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from studio_worker import config  # noqa: E402  (pertama: batas thread & folder cache HF)

CFG = config.load()

from studio_worker import log as vlog  # noqa: E402
from studio_worker import models  # noqa: E402
from studio_worker import unduh  # noqa: E402

log = vlog.setup(CFG.logs, prefix="siapkan")
say = vlog.get("siapkan").info


def _size(st: dict) -> str:
    if st["ready"] and st["bytes"]:
        return unduh.fmt_size(st["bytes"]).replace("/", "")
    return f"±{st['est_mb']} MB" if st["need"] else "-"


def _label(name: str) -> str:
    if name == "whisper":
        return f"cek ucapan (faster-whisper {CFG.whisper_model})"
    return models.INFO[name][0]


def table(cfg, skip: set[str]) -> tuple[list[str], dict]:
    st = models.status(cfg)
    req = set(models.required(cfg))
    rows = [f"Model suara di laptop ini (folder data: {cfg.data})", f"  {'model':<11} {'untuk':<40} {'status':<22} ukuran"]
    for n in models.NAMES:
        s = st[n]
        if not s["need"]:
            stat = "tidak dipakai"
        elif n in skip:
            stat = "dilewati"
        elif s["ready"]:
            stat = "siap"
        else:
            stat = ("BELUM ADA (wajib)" if n in req else "belum diunduh") if s["why"] in ("belum diunduh", "siap") else s["why"][:40]
        rows.append(f"  {n:<11} {_label(n)[:40]:<40} {stat:<22} {_size(s)}")
    return rows, st


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Siapkan (unduh) model mesin suara voice-worker")
    ap.add_argument("--cek", action="store_true", help="status saja, tidak mengunduh (kode keluar 1 kalau model wajib belum ada)")
    ap.add_argument("--cepat", action="store_true", help="hanya unduh yang belum ada, tanpa cek ulang model yang sudah ada")
    ap.add_argument("--tanpa-utmos", action="store_true", help="lewati UTMOS (penilai kealamian, opsional)")
    ap.add_argument("--hanya", default="", help="daftar model dipisah koma, mis. whisper,utmos")
    ap.add_argument("--koneksi", type=int, default=0, help="koneksi paralel per file (bawaan DOWNLOAD_CONNECTIONS)")
    a = ap.parse_args(argv)

    if a.koneksi:
        CFG.download_connections = max(1, min(32, a.koneksi))
    skip = {"utmos"} if a.tanpa_utmos else set()
    names = [n for n in models.relevant(CFG) if n not in skip]
    if a.hanya:
        want = [x.strip().lower() for x in a.hanya.split(",") if x.strip()]
        bad = [x for x in want if x not in models.NAMES]
        if bad:
            print(f"Nama model tidak dikenal: {', '.join(bad)} (pilihan: {', '.join(models.NAMES)})")
            return 2
        names = [n for n in models.NAMES if n in want]

    rows, st = table(CFG, skip)
    for r in rows:
        print(r)
    req = models.required(CFG)
    if a.cek:
        kurang = [n for n in req if not st[n]["ready"]]
        if kurang:
            print(f"\nModel wajib belum ada: {', '.join(kurang)} — jalankan SIAPKAN-MODEL.bat")
            return 1
        print("\nModel wajib sudah siap.")
        return 0

    todo = [n for n in names if not st[n]["ready"]] if a.cepat else names
    if not todo:
        print("\nSemua model sudah siap.")
        return 0
    print("")
    say(f"Menyiapkan: {', '.join(todo)} ({CFG.download_connections} koneksi per file). Ctrl+C aman — jalankan lagi untuk melanjutkan.")
    t0 = time.monotonic()
    try:
        res = models.prepare(CFG, todo, say, verify=not a.cepat)
    except KeyboardInterrupt:
        print("\nDihentikan. Bagian yang sudah terunduh disimpan — jalankan SIAPKAN-MODEL.bat lagi untuk melanjutkan.")
        return 130
    print("")
    for r in table(CFG, skip)[0]:
        print(r)
    gagal = {n: v for n, v in res.items() if v != "siap"}
    print(f"\nSelesai dalam {unduh.fmt_eta(time.monotonic() - t0)}.")
    for n, v in gagal.items():
        print(f"  {n}: {v}")
    kurang = [n for n in req if not models.is_ready(CFG, n)]
    if kurang:
        print(f"Model wajib belum siap: {', '.join(kurang)}. Cek internet lalu jalankan SIAPKAN-MODEL.bat lagi (unduhan dilanjutkan).")
        return 1
    if gagal:
        print("Model opsional yang gagal akan dicoba lagi otomatis saat mesin suara menyala (job tetap jalan tanpa itu).")
    else:
        print("Semua model siap. Nyalakan mesin suara: NYALAKAN-MESIN-SUARA.bat")
    return 0


if __name__ == "__main__":
    sys.exit(main())
