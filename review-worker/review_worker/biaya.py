"""Harga Claude Haiku 5.5 + batas biaya harian (pemilik: hakim-ai). KONTRAK.md §5.5.
Harga per 1 juta token (prompt ≤ 100K): input $0,10 · output $0,50 · baca cache 0,1× · tulis cache 5 mnt 1,25× · 1 jam 2×.
Prompt > 100K token: $0,50 / $2,50 (pengali sama). Hari = tanggal WIB (Asia/Jakarta)."""
from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any, Optional

from .skema import PemakaianAI

HARGA = {"input": 0.10, "output": 0.50, "baca_cache": 0.1, "tulis_5m": 1.25, "tulis_1h": 2.0, "batas_prompt": 100_000, "pengali_panjang": 5.0}


class AnggaranHabis(Exception):
    """batas REVIEW_DAILY_BUDGET_USD hari ini tercapai — pesan awam"""


def hitung_biaya(usage: Any, model: str, effort: str, detik: float = 0.0, stop_reason: Optional[str] = None,
                 request_id: Optional[str] = None) -> PemakaianAI:
    """usage = response.usage SDK (input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
    cache_creation.ephemeral_1h_input_tokens / ephemeral_5m_input_tokens; field hilang = 0)"""
    raise NotImplementedError("stub: hakim-ai")


class Budget:
    def __init__(self, cfg, supa, data_dir: Path):
        self.cfg = cfg
        self.supa = supa

    def hari_ini(self) -> date:
        raise NotImplementedError("stub: hakim-ai")

    def terpakai(self) -> float:
        """USD hari ini (Supabase review_usage_daily; Supabase putus → data/biaya-harian.json)"""
        raise NotImplementedError("stub: hakim-ai")

    def cek(self, perkiraan_usd: float = 0.004) -> None:
        """terpakai + perkiraan > batas → AnggaranHabis (dicek SEBELUM tiap panggilan AI)"""
        raise NotImplementedError("stub: hakim-ai")

    def catat(self, p: PemakaianAI) -> float:
        """tambah ke Supabase (rpc review_add_usage) + file lokal; balikan total hari ini"""
        raise NotImplementedError("stub: hakim-ai")
