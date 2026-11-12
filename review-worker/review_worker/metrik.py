"""Ringkasan akurasi + biaya satu run (pemilik: hakim-uji). Format = review_runs.metrics (KONTRAK.md §6.2) — dibaca website."""
from __future__ import annotations


def hitung_metrik(baris: list[dict], cfg) -> dict:
    """baris = review_results satu run (dict dari Supabase / HasilVideo.baris_supabase())"""
    raise NotImplementedError("stub: hakim-uji")
