"""Hakim AI = Claude Haiku 5.5 lewat Anthropic API langsung (SDK resmi `anthropic`) (pemilik: hakim-ai). KONTRAK.md §5.1.
Kunci: env ANTHROPIC_API_KEY (dibaca SDK). Kunci kosong → nilai() mengembalikan cek_manusia + serah "ai_gagal" (tanpa crash).
Susunan prompt (urutan WAJIB, untuk cache): system[0] = rubrik (cache_control ephemeral ttl 1h), system[1] = brief campaign
(cache 1h), messages[0].user = frame (gambar base64 JPEG + label "Frame N · detik T") lalu satu blok teks JSON materi.
Keluaran: output_config.format json_schema dari skema.KeputusanAI (+ effort REVIEW_EFFORT, bawaan medium). Tanpa temperature,
tanpa prefill, tanpa fallbacks. stop_reason "refusal" / "max_tokens" / JSON tidak valid → cek_manusia. Usage (cache_read /
cache_creation) dicatat ke log + PemakaianAI."""
from __future__ import annotations

from typing import Any, Optional

from .skema import BriefCampaign, MateriVideo, PenilaianFinal, ReferensiCampaign, Rubrik


class Hakim:
    def __init__(self, cfg, budget, rubrik: Rubrik, client: Optional[Any] = None, label_alasan: Optional[dict[str, str]] = None):
        """client = anthropic.Anthropic() (dibuat malas) atau tiruan untuk tes (bentuk respons sama dengan SDK)"""
        self.cfg = cfg
        self.budget = budget
        self.rubrik = rubrik

    def bangun_permintaan(self, brief: BriefCampaign, materi: MateriVideo, ref: ReferensiCampaign) -> dict:
        """kwargs messages.create (model, max_tokens, system, messages, output_config) — deterministik, bisa dites tanpa API"""
        raise NotImplementedError("stub: hakim-ai")

    def nilai(self, brief: BriefCampaign, materi: MateriVideo, ref: ReferensiCampaign) -> PenilaianFinal:
        """budget.cek() → panggil API (retry SDK bawaan) → validasi → aturan.terapkan_aturan → budget.catat().
        AnggaranHabis DITERUSKAN. materi.status bukan "ok" → tanpa panggilan AI (cek_manusia)."""
        raise NotImplementedError("stub: hakim-ai")
