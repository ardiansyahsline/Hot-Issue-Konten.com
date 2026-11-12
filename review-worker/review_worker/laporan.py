"""Laporan HTML bahasa awam untuk diajukan ke official Konten.com (pemilik: hakim-uji). KONTRAK.md §6.3.
Satu file, CSS inline, grafik SVG inline, TANPA JavaScript, tanpa gambar frame, tanpa data pribadi (video ditulis "Video #<id>").
Disimpan data/laporan/<run_id>.html + bucket asisten-review laporan/<run_id>.html."""
from __future__ import annotations

from typing import Optional


def buat_laporan(run: dict, metrik: dict, baris: list[dict], pembanding: Optional[dict] = None) -> str:
    """pembanding = {"run": run_lama, "metrik": metrik_lama} untuk tabel "rubrik lama vs baru" """
    raise NotImplementedError("stub: hakim-uji")


def simpan_laporan(rt, run_id: str) -> str:
    """ambil run + hasil dari Supabase, hitung ulang metrik, tulis file + upload; balikan path storage"""
    raise NotImplementedError("stub: hakim-uji")
