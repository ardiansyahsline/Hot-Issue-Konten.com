"""
Cari & tambah SFX dari Freesound — HANYA lisensi CC0 (bebas tanpa atribusi). Butuh FREESOUND_API_KEY di .env.

  .venv\\Scripts\\python freesound_cc0.py "whoosh"
  .venv\\Scripts\\python freesound_cc0.py "coin" --jumlah 3 --kategori koin
  .venv\\Scripts\\python freesound_cc0.py "impact" --coba        (lihat daftar saja)

Disimpan ke studio/sfx/fs-<id>.mp3 + baris studio_sfx (source freesound, license CC0, credit nama pengunggah).
"""
from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from studio_worker import config  # noqa: E402

CFG = config.load()

import httpx  # noqa: E402

from studio_worker import log as vlog  # noqa: E402
from studio_worker import sfxlib  # noqa: E402
from studio_worker.supa import Supa  # noqa: E402

API = "https://freesound.org/apiv2/search/text/"
CC0 = 'license:"Creative Commons 0"'


def search(key: str, q: str, n: int, max_dur: float) -> list[dict]:
    r = httpx.get(
        API,
        params={
            "query": q,
            "filter": f"{CC0} duration:[0.1 TO {max_dur}]",
            "fields": "id,name,username,license,previews,duration,tags,url",
            "page_size": str(min(max(n * 2, 5), 50)),
            "sort": "score",
            "token": key,
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json().get("results", [])


def main() -> int:
    ap = argparse.ArgumentParser(description="Tambah SFX Freesound (CC0 saja)")
    ap.add_argument("query", help='kata kunci, mis. "whoosh"')
    ap.add_argument("--jumlah", type=int, default=5)
    ap.add_argument("--maks-durasi", type=float, default=12)
    ap.add_argument("--kategori", default="")
    ap.add_argument("--coba", "--dry-run", dest="dry", action="store_true")
    a = ap.parse_args()
    log = vlog.setup(CFG.logs, "freesound")
    if not CFG.freesound_key:
        log.error("FREESOUND_API_KEY belum diisi di voice-worker\\.env (daftar gratis di freesound.org/apiv2/apply).")
        return 2
    if not a.dry and CFG.missing():
        log.error("Isi dulu %s di voice-worker\\.env.", ", ".join(CFG.missing()))
        return 2
    try:
        res = search(CFG.freesound_key, a.query, a.jumlah, a.maks_durasi)
    except httpx.HTTPError as e:
        log.error("Freesound tidak bisa dihubungi: %s", e)
        return 1
    supa = None if a.dry else Supa(CFG.supabase_url, CFG.service_key, CFG.worker_id)
    taken = sfxlib.existing_ids(supa, CFG.repo) if supa else set()
    added = 0
    with tempfile.TemporaryDirectory() as td:
        for s in res:
            if added >= a.jumlah:
                break
            if "publicdomain/zero" not in str(s.get("license", "")):  # cek ulang: hanya CC0
                continue
            sid = f"fs-{s['id']}"
            if sid in taken:
                log.info("Lewati %s (sudah ada)", sid)
                continue
            url = (s.get("previews") or {}).get("preview-hq-mp3")
            if not url:
                continue
            log.info("%s  %-40s %.1f dtk  oleh %s", sid, str(s.get("name"))[:40], float(s.get("duration") or 0), s.get("username"))
            if a.dry:
                added += 1
                continue
            try:
                raw = Path(td) / f"{sid}-src.mp3"
                with httpx.stream("GET", url, timeout=60, follow_redirects=True) as r:
                    r.raise_for_status()
                    with open(raw, "wb") as fh:
                        for ch in r.iter_bytes():
                            fh.write(ch)
                mp3 = sfxlib.convert_mp3(raw, Path(td) / f"{sid}.mp3")
                meta0 = sfxlib.analyze(mp3)
                cat, tags = sfxlib.guess(str(s.get("name") or ""), [a.query, *[str(t) for t in (s.get("tags") or [])[:5]]], meta0["dur"])
                cat = a.kategori or cat
                meta = sfxlib.analyze(mp3, cat)
                credit = f"{s.get('username')} (freesound.org, CC0) {s.get('url') or ''}".strip()
                assert supa is not None
                sfxlib.upload(supa, sid, mp3, meta, cat, tags, "freesound", "CC0", credit)
                taken.add(sid)
                added += 1
                log.info("  → ditambahkan sebagai %s (%s, %.1f LUFS, hit %.2f)", sid, cat, meta["lufs"], meta["hit"])
            except Exception as e:
                log.warning("  gagal: %s", e)
    log.info("Selesai: %d SFX %s.", added, "ditemukan" if a.dry else "ditambahkan")
    return 0


if __name__ == "__main__":
    sys.exit(main())
