"""Kebenaran akhir untuk uji akurasi (pemilik: hakim-uji). KONTRAK.md §6.1.
Banding dibatalkan → kebalikan keputusan reviewer (hasil banding yang benar); dikuatkan / tanpa banding → keputusan reviewer;
banding menunggu → keputusan reviewer (ditandai)."""
from __future__ import annotations

from typing import Optional

from .skema import Banding, Keputusan, KeputusanManusia


def tentukan(km: Optional[KeputusanManusia]) -> tuple[Optional[Keputusan], Optional[Banding]]:
    raise NotImplementedError("stub: hakim-uji")


def cocok(saran: Optional[str], kebenaran: Optional[str]) -> Optional[bool]:
    """approve/reject vs kebenaran → bool; cek_manusia / tanpa kebenaran → None"""
    raise NotImplementedError("stub: hakim-uji")
