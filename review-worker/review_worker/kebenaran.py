"""Kebenaran akhir untuk uji akurasi (pemilik: hakim-uji). KONTRAK.md §6.1.
Banding dibatalkan → kebalikan keputusan reviewer (hasil banding yang benar); dikuatkan / tanpa banding → keputusan reviewer;
banding menunggu → keputusan reviewer (ditandai).
Keputusan reviewer = aksi audit TERAKHIR. Kalau aksi itu dicatat SESUDAH banding selesai (waktu banding tersedia), aksi itu sudah
hasil banding → TIDAK dibalik lagi (cegah balik dua kali). Waktu banding belum dikirim replika → dibalik seperti bawaan, kasus yang
mencurigakan (status video sekarang sama dengan keputusan terakhir) dicatat di log."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from . import log as rlog
from .skema import Banding, Keputusan, KeputusanManusia

log = rlog.get("kebenaran")
_KEBALIKAN: dict[str, Keputusan] = {"approve": "reject", "reject": "approve"}
_BANDING = ("dibatalkan", "dikuatkan", "menunggu")
# hanya untuk peringatan log (pemetaan sebenarnya di kolom.toml [nilai], dipakai replika)
_STATUS = {"approve": {"approved", "approve", "accepted"}, "reject": {"rejected", "reject", "declined"}}
_WAKTU_BANDING = ("banding_selesai", "banding_waktu")  # field opsional (belum ada di skema) — dipakai otomatis kalau ditambah
ambigu = 0  # jumlah kasus mencurigakan sejak worker menyala


def _waktu(x: Any) -> Optional[datetime]:
    if not x:
        return None
    try:
        t = x if isinstance(x, datetime) else datetime.fromisoformat(str(x).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else None


def _sesudah_banding(km: KeputusanManusia) -> bool:
    """keputusan terakhir dicatat sesudah banding selesai (butuh waktu banding dari replika)"""
    tb = next((_waktu(getattr(km, f, None)) for f in _WAKTU_BANDING if getattr(km, f, None)), None)
    tk = _waktu(km.diputuskan)
    return bool(tb and tk and tk > tb)


def tentukan(km: Optional[KeputusanManusia]) -> tuple[Optional[Keputusan], Optional[Banding]]:
    """(kebenaran akhir, status banding). Tanpa keputusan reviewer → kebenaran None (video tidak masuk penyebut akurasi),
    status banding tetap dikembalikan supaya tercatat."""
    global ambigu
    if km is None:
        return None, None
    banding = km.banding if km.banding in _BANDING else None
    kep = km.keputusan if km.keputusan in _KEBALIKAN else None
    if kep is None:
        return None, banding
    if banding == "dibatalkan":  # keputusan reviewer dibatalkan saat banding → hasil banding yang benar
        if _sesudah_banding(km):
            return kep, banding  # keputusan terakhir = keputusan sesudah banding (sudah hasil banding)
        if str(km.status_sekarang or "").strip().lower() in _STATUS[kep]:
            ambigu += 1
            log.warning("Video %s: banding dibatalkan, tapi status video sekarang masih '%s' (sama dengan keputusan terakhir) — "
                        "kebenaran tetap dibalik; bisa keliru kalau reviewer mencatat ulang keputusan sesudah banding (kasus ke-%d).",
                        km.video_id, kep, ambigu)
        return _KEBALIKAN[kep], banding
    return kep, banding


def cocok(saran: Optional[str], kebenaran: Optional[str]) -> Optional[bool]:
    """approve/reject vs kebenaran → bool; cek_manusia / tanpa kebenaran → None"""
    if saran not in _KEBALIKAN or kebenaran not in _KEBALIKAN:
        return None
    return saran == kebenaran
