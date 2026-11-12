"""Aturan KODE sesudah jawaban AI (pemilik: hakim-ai). KONTRAK.md §5.2. Tidak bergantung pada kepatuhan prompt:
identitas orang → selalu butuh cek manusia; materi referensi belum ada → poin "wajib pakai materi" tidak bisa dinilai;
durasi / hashtag / caption wajib dicek kode; keyakinan < REVIEW_MIN_CONFIDENCE → cek_manusia; reject tanpa bukti / alasan →
cek_manusia; AI menolak / gagal → cek_manusia."""
from __future__ import annotations

from typing import Optional

from .skema import BriefCampaign, CekPoin, KeputusanAI, KodeSerah, MateriVideo, PenilaianFinal, ReferensiCampaign

ATURAN_VERSI = "a1"  # naikkan kalau aturan berubah (ikut hash rubrik)


def cek_kode(brief: BriefCampaign, materi: MateriVideo) -> list[CekPoin]:
    """poin cara_nilai "kode" (durasi vs durasiMin/Max ±1 dtk, hashtag wajib di caption/hashtags, caption wajib) — juga
    dikirim ke AI sebagai fakta"""
    raise NotImplementedError("stub: hakim-ai")


def terapkan_aturan(ai: Optional[KeputusanAI], brief: BriefCampaign, materi: MateriVideo, ref: ReferensiCampaign, cfg,
                    gagal: Optional[KodeSerah] = None, label_alasan: Optional[dict[str, str]] = None) -> PenilaianFinal:
    """gabung checklist AI + kode + paksaan manusia → PenilaianFinal (tanpa pemakaian; diisi hakim)"""
    raise NotImplementedError("stub: hakim-ai")
