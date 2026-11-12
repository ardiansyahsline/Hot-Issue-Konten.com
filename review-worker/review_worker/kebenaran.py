"""Kebenaran akhir untuk uji akurasi (pemilik: hakim-uji). KONTRAK.md §6.1.
Banding dibatalkan → kebalikan keputusan reviewer (hasil banding yang benar); dikuatkan / tanpa banding → keputusan reviewer;
banding menunggu → keputusan reviewer (ditandai)."""
from __future__ import annotations

from typing import Optional

from .skema import Banding, Keputusan, KeputusanManusia

_KEBALIKAN: dict[str, Keputusan] = {"approve": "reject", "reject": "approve"}
_BANDING = ("dibatalkan", "dikuatkan", "menunggu")


def tentukan(km: Optional[KeputusanManusia]) -> tuple[Optional[Keputusan], Optional[Banding]]:
    """(kebenaran akhir, status banding). Tanpa keputusan reviewer → kebenaran None (video tidak masuk penyebut akurasi),
    status banding tetap dikembalikan supaya tercatat."""
    if km is None:
        return None, None
    banding = km.banding if km.banding in _BANDING else None
    kep = km.keputusan if km.keputusan in _KEBALIKAN else None
    if kep is None:
        return None, banding
    if banding == "dibatalkan":  # keputusan reviewer dibatalkan saat banding → hasil banding yang benar
        return _KEBALIKAN[kep], banding
    return kep, banding


def cocok(saran: Optional[str], kebenaran: Optional[str]) -> Optional[bool]:
    """approve/reject vs kebenaran → bool; cek_manusia / tanpa kebenaran → None"""
    if saran not in _KEBALIKAN or kebenaran not in _KEBALIKAN:
        return None
    return saran == kebenaran
