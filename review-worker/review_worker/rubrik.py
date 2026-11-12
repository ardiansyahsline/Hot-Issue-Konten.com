"""Rubrik hakim berversi (pemilik: hakim-ai). File: review-worker/rubrik/<versi>.md (statis, tanpa data pribadi).
hash = 12 hex sha256(teks rubrik + aturan.ATURAN_VERSI + JSON skema KeputusanAI). Versi aktif: env REVIEW_RUBRIK (bawaan: terbaru)."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Optional

from . import log as rlog
from .skema import Rubrik

RUBRIK_DIR = Path(__file__).resolve().parent.parent / "rubrik"
log = rlog.get("rubrik")
_VERSI = re.compile(r"^v(\d+)(?:[._-](\d+))?$", re.I)


def _kunci(v: str) -> tuple[int, int, str]:
    m = _VERSI.match(v)
    return (int(m.group(1)), int(m.group(2) or 0), v) if m else (-1, 0, v)


def daftar_versi() -> list[str]:
    """versi rubrik yang ada (urut lama → baru), mis. ["v1", "v2"]"""
    if not RUBRIK_DIR.is_dir():
        return []
    return sorted((p.stem for p in RUBRIK_DIR.glob("v*.md") if _VERSI.match(p.stem)), key=_kunci)


def baca_teks(path: Path) -> str:
    """teks rubrik dinormalkan (CRLF Windows / BOM / spasi di ujung baris) supaya hash & cache sama di semua laptop"""
    t = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(b.rstrip() for b in t.split("\n")).strip() + "\n"


def hitung_hash(teks: str) -> str:
    from .aturan import ATURAN_VERSI
    from .hakim import skema_keputusan

    bahan = teks + "\n--aturan:" + ATURAN_VERSI + "\n--skema:" + json.dumps(skema_keputusan(), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(bahan.encode("utf-8")).hexdigest()[:12]


def _catatan(teks: str) -> str:
    """baris 'Catatan versi:' di rubrik (untuk review_rubrics.notes)"""
    m = re.search(r"(?im)^\s*(?:>\s*)?catatan versi\s*:\s*(.+)$", teks)
    return m.group(1).strip()[:500] if m else ""


def muat_rubrik(versi: Optional[str] = None) -> Rubrik:
    ada = daftar_versi()
    if not ada:
        raise FileNotFoundError(f"Rubrik tidak ditemukan di {RUBRIK_DIR}. Pastikan folder review-worker/rubrik ikut ter-download (git pull).")
    v = (versi or "").strip().lower()
    if v and not v.startswith("v"):
        v = "v" + v
    if v and v not in ada:
        log.warning("Rubrik %s tidak ada (tersedia: %s) — pakai %s.", v, ", ".join(ada), ada[-1])
        v = ""
    v = v or ada[-1]
    teks = baca_teks(RUBRIK_DIR / f"{v}.md")
    return Rubrik(versi=v, hash=hitung_hash(teks), teks=teks, catatan=_catatan(teks))


def baris_supabase(r: Rubrik) -> dict:
    """baris review_rubrics (upsert on_conflict=version) — dipakai uji.jalankan_uji"""
    return {"version": r.versi, "hash": r.hash, "content": r.teks, "notes": r.catatan or None}
