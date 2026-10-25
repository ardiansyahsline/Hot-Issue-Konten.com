"""
Tambah SFX dari folder lokal (Sonniss GDC 2026 Game Audio Bundle) ke Studio.

  .venv\\Scripts\\python tambah_sfx.py                         (folder bawaan: C:\\Konten.com\\STUDIO-FX atau SFX_DIR di .env)
  .venv\\Scripts\\python tambah_sfx.py "D:\\SFX\\Whoosh" --maks 20
  .venv\\Scripts\\python tambah_sfx.py --juga-json             (juga tambahkan ke assets/audio/sfx/sfx.json di repo)
  .venv\\Scripts\\python tambah_sfx.py --coba                  (lihat dulu hasil tebakan, tanpa upload)

Tiap file: konversi mp3 48 kHz 192 kbps → ukur LUFS / true peak / durasi / hit → tebak kategori & tag dari nama file/folder
→ upload studio/sfx/<id>.mp3 + baris studio_sfx (source sonniss). File yang sudah pernah diimpor dilewati (data/sfx-impor.json).
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from studio_worker import config  # noqa: E402

CFG = config.load()

from studio_worker import log as vlog  # noqa: E402
from studio_worker import sfxlib  # noqa: E402
from studio_worker.supa import Supa  # noqa: E402

AUDIO = {".wav", ".mp3", ".flac", ".ogg", ".aif", ".aiff", ".m4a"}
LICENSE = "Sonniss GDC 2026 Game Audio Bundle - royalty-free, tanpa atribusi; jangan didistribusikan ulang sebagai file mentah"


def main() -> int:
    ap = argparse.ArgumentParser(description="Tambah SFX lokal (Sonniss) ke Studio")
    ap.add_argument("folder", nargs="?", default=CFG.sfx_dir, help="folder SFX (bawaan: SFX_DIR di .env / C:\\Konten.com\\STUDIO-FX)")
    ap.add_argument("--juga-json", action="store_true", help="juga tambahkan ke assets/audio/sfx/sfx.json + salin mp3 ke repo")
    ap.add_argument("--maks", type=int, default=0, help="maksimal jumlah file baru (0 = semua)")
    ap.add_argument("--coba", "--dry-run", dest="dry", action="store_true", help="hanya tampilkan tebakan, tanpa upload")
    ap.add_argument("--ulang", action="store_true", help="impor ulang file yang sudah pernah diimpor")
    ap.add_argument("--tanpa-upload", action="store_true", help="tidak upload ke Supabase (pakai bersama --juga-json)")
    ap.add_argument("--kategori", default="", help="paksa kategori untuk semua file (mis. whoosh)")
    a = ap.parse_args()
    log = vlog.setup(CFG.logs, "tambah-sfx")

    root = Path(a.folder).expanduser()
    if not root.is_dir():
        log.error("Folder tidak ditemukan: %s", root)
        return 2
    upload = not (a.dry or a.tanpa_upload)
    if upload and CFG.missing():
        log.error("Isi dulu %s di voice-worker\\.env (atau pakai --coba / --tanpa-upload).", ", ".join(CFG.missing()))
        return 2
    supa = Supa(CFG.supabase_url, CFG.service_key, CFG.worker_id) if upload else None
    manifest_f = CFG.data / "sfx-impor.json"
    manifest: dict = json.loads(manifest_f.read_text(encoding="utf-8")) if manifest_f.exists() else {}
    taken = sfxlib.existing_ids(supa, CFG.repo)

    files = sorted(p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in AUDIO)
    log.info("Ketemu %d file audio di %s", len(files), root)
    added = skipped = failed = 0
    with tempfile.TemporaryDirectory() as td:
        for f in files:
            if a.maks and added >= a.maks:
                break
            st = f.stat()
            key = f"{f.resolve()}|{st.st_size}|{int(st.st_mtime)}"
            if key in manifest and not a.ulang:
                skipped += 1
                continue
            try:
                mp3 = sfxlib.convert_mp3(f, Path(td) / "x.mp3")
                folders = [p.name for p in f.relative_to(root).parents if p.name][:3]
                meta0 = sfxlib.analyze(mp3)
                cat, tags = sfxlib.guess(f.stem, folders, meta0["dur"])
                cat = a.kategori or cat
                meta = sfxlib.analyze(mp3, cat)
                sid = manifest.get(key) if a.ulang and key in manifest else sfxlib.unique_id(f"{cat}-{f.stem}" if cat not in f.stem.lower() else f.stem, taken)
                pack = folders[-1] if folders else root.name
                log.info("%-40s → %-28s %-9s %5.2f dtk %6.1f LUFS tp %5.1f hit %.2f  tag: %s", f.name[:40], sid, cat, meta["dur"], meta["lufs"], meta["tp"], meta["hit"], ", ".join(tags))
                if a.dry:
                    added += 1
                    continue
                if supa is not None:
                    sfxlib.upload(supa, sid, mp3, meta, cat, tags, "sonniss", LICENSE, pack)
                if a.juga_json:
                    sfxlib.append_json(
                        CFG.repo,
                        {
                            "id": sid,
                            "file": f"{sid}.mp3",
                            "kategori": cat,
                            "tags": tags,
                            "durasi_detik": meta["dur"],
                            "lufs": meta["lufs"],
                            "true_peak_db": meta["tp"],
                            "dipakai_untuk": sfxlib.USE_FOR.get(cat, ""),
                            "sumber_pack": pack,
                            "file_asli": f.name,
                            "lisensi": LICENSE,
                        },
                        mp3,
                    )
                manifest[key] = sid
                manifest_f.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
                added += 1
            except Exception as e:
                failed += 1
                log.warning("Lewati %s: %s", f.name, e)
    log.info("Selesai: %d %s, %d dilewati (sudah ada), %d gagal.", added, "dicek" if a.dry else "ditambahkan", skipped, failed)
    if a.juga_json and added and not a.dry:
        log.info("sfx.json berubah → jangan lupa commit assets/audio/sfx (dan perbarui lib/studio/sfxMeta.ts kalau mau jadi SFX bawaan).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
