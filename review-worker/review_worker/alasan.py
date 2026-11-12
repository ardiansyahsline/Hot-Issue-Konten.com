"""Alasan reject resmi (pemilik: hakim-ai). Kode tetap (skema.KodeAlasan) ↔ label persis dari audit_log (review_reasons).
Label baru yang tidak dikenal → kode ditebak dari kata kunci, cadangan "lainnya"."""
from __future__ import annotations

import re
import threading
from typing import Optional

from . import log as rlog
from .skema import KodeAlasan

log = rlog.get("alasan")

KODE_LABEL_BAWAAN: dict[str, str] = {
    "tidak_sesuai_brief": "Konten tidak sesuai brief campaign",
    "cta_tidak_ada": "CTA wajib tidak ada",
    "followers_kurang": "Followers belum memenuhi syarat",
    "engagement_bot": "Engagement mencurigakan / bot",
    "link_bio_tidak_ada": "Link di bio belum ada",
    "duplikat": "Video duplikat / sudah disubmit",
    "tidak_bisa_diakses": "Video tidak bisa diakses",
    "lainnya": "Lainnya",
}
# alasan yang TIDAK bisa dilihat dari isi video (dilaporkan terpisah di laporan: "di luar jangkauan AI"; AI tidak boleh reject
# dengan kode ini — rubrik §6 + aturan.py). engagement_bot butuh data sistem; tidak_bisa_diakses = kondisi saat reviewer membuka
# (video yang kini bisa diunduh tetap dinilai, tapi tidak menghukum akurasi)
DI_LUAR_VIDEO: frozenset[str] = frozenset({"followers_kurang", "link_bio_tidak_ada", "duplikat", "engagement_bot",
                                           "tidak_bisa_diakses"})
KODE_SAH: frozenset[str] = frozenset(KODE_LABEL_BAWAAN)

# urutan PENTING: yang lebih khusus dulu ("Link video rusak" → tidak bisa diakses, bukan link bio)
_KATA: list[tuple[str, re.Pattern]] = [
    ("tidak_bisa_diakses", re.compile(r"akses|private|privat|dihapus|terhapus|tidak tersedia|tidak bisa dibuka|tak bisa dibuka|"
                                      r"rusak|error|tidak ditemukan|not found|unavailable|takedown|di-?takedown", re.I)),
    ("duplikat", re.compile(r"duplikat|duplicate|sudah (?:di)?submit|sudah pernah|sudah dikirim|double|dobel|repost|re-?upload", re.I)),
    ("followers_kurang", re.compile(r"follower|pengikut", re.I)),
    ("engagement_bot", re.compile(r"\bbot\b|engagement|mencurigakan|view(?:s)? palsu|fake|palsu|beli view|inject|curang|kecurangan",
                                  re.I)),
    ("link_bio_tidak_ada", re.compile(r"\bbio\b|link\s*(?:di\s*)?bio|linktree|tautan bio|link profil", re.I)),
    ("cta_tidak_ada", re.compile(r"\bcta\b|call\s*to\s*action|ajakan", re.I)),
    ("tidak_sesuai_brief", re.compile(r"brief|sesuai|relevan|materi|durasi|hashtag|caption|instruksi|ketentuan|aturan|syarat|"
                                      r"kualitas|footage|lagu|musik|sound|watermark|konten", re.I)),
    ("lainnya", re.compile(r"lain", re.I)),
]

_lock = threading.Lock()
_LABEL_KODE: dict[str, str] = {}  # label (dinormalkan) → kode, hasil sinkron / muat_daftar terakhir


def _norm(s: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _tebak(label: str) -> KodeAlasan:
    for kode, pola in _KATA:
        if pola.search(label):
            return kode  # type: ignore[return-value]
    return "lainnya"


def kode_untuk_label(label: Optional[str]) -> Optional[KodeAlasan]:
    if label is None or not str(label).strip():
        return None
    n = _norm(label)
    with _lock:
        k = _LABEL_KODE.get(n)
    if k in KODE_SAH:
        return k  # type: ignore[return-value]
    for kode, lab in KODE_LABEL_BAWAAN.items():
        if _norm(lab) == n:
            return kode  # type: ignore[return-value]
    if n in KODE_SAH:  # sudah berupa kode
        return n  # type: ignore[return-value]
    return _tebak(n)


def label_untuk_kode(kode: Optional[str], daftar: Optional[dict[str, str]] = None) -> Optional[str]:
    """daftar = {kode: label paling sering dipakai} dari review_reasons; cadangan KODE_LABEL_BAWAAN"""
    if not kode:
        return None
    if daftar and daftar.get(kode):
        return daftar[kode]
    return KODE_LABEL_BAWAAN.get(kode)


def sinkron(supa, daftar: list[tuple[str, int, Optional[str], Optional[str]]]) -> int:
    """upsert review_reasons (label, code, uses, first_seen, last_seen) — data hasil replika.daftar_alasan"""
    rows: dict[str, dict] = {}
    for item in daftar or []:
        try:
            label, n, pertama, terakhir = item
        except (TypeError, ValueError):
            continue
        label = re.sub(r"\s+", " ", str(label or "")).strip()[:160]
        if not label:
            continue
        r = rows.get(label)
        if r:  # label sama (beda spasi) → jumlahkan
            r["uses"] += int(n or 0)
            continue
        rows[label] = {"label": label, "code": kode_untuk_label(label) or "lainnya", "uses": int(n or 0), "official": True,
                       "first_seen": pertama, "last_seen": terakhir}
    if not rows:
        return 0
    daftar_rows = list(rows.values())
    for i in range(0, len(daftar_rows), 100):
        supa.insert("review_reasons", daftar_rows[i:i + 100], on_conflict="label", merge=True)
    with _lock:
        for r in daftar_rows:
            _LABEL_KODE[_norm(r["label"])] = r["code"]
    per_kode: dict[str, int] = {}
    for r in daftar_rows:
        per_kode[r["code"]] = per_kode.get(r["code"], 0) + 1
    log.info("Sinkron alasan resmi: %d label (%s).", len(daftar_rows), ", ".join(f"{k} {v}" for k, v in sorted(per_kode.items())))
    return len(daftar_rows)


def muat_daftar(supa) -> dict[str, str]:
    """{kode: label resmi paling sering} dari review_reasons (gagal → KODE_LABEL_BAWAAN)"""
    hasil = dict(KODE_LABEL_BAWAAN)
    if supa is None:
        return hasil
    try:
        rows = supa.select("review_reasons", select="label,code,uses", order="uses.desc", limit="1000") or []
    except Exception as e:
        log.info("Daftar alasan resmi belum bisa dibaca (%s) — pakai label bawaan.", str(e)[:100])
        return hasil
    terbaik: dict[str, tuple[int, str]] = {}
    with _lock:
        for r in rows:
            label, kode = str(r.get("label") or "").strip(), str(r.get("code") or "")
            if not label or kode not in KODE_SAH:
                continue
            _LABEL_KODE[_norm(label)] = kode
            n = int(r.get("uses") or 0)
            if kode not in terbaik or n > terbaik[kode][0]:
                terbaik[kode] = (n, label)
    for kode, (_n, label) in terbaik.items():
        hasil[kode] = label
    return hasil
