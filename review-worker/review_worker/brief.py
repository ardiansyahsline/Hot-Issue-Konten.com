"""Urai alif.campaigns.brief_detail (JSON) → daftar poin brief yang dinilai satu per satu (pemilik: hakim-ai). KONTRAK.md §4.4.
Tahan banting: key hilang, tipe beda (string / array / objek / angka-string), "+Choice" (materialWajibChoice dst.) = cukup salah
satu, customSections, HTML / markdown ringan. Kolom brief_instructions / brief_dos / brief_donts / brief_goal / brief_narrative
TIDAK dipakai. Poin yang butuh mengenali orang tertentu → cara_nilai "manusia" (deteksi_identitas_orang, dipaksa juga di aturan.py)."""
from __future__ import annotations

from .skema import BriefCampaign, CampaignDB


def parse_brief(campaign: CampaignDB) -> BriefCampaign:
    """tidak pernah melempar: brief_detail rusak / kosong → BriefCampaign dengan poin dari kolom cadangan (rules, hashtags,
    min_video_duration) + catatan_parser. Id poin stabil (urutan key tetap: lihat KONTRAK.md §4.4)."""
    raise NotImplementedError("stub: hakim-ai")


def deteksi_identitas_orang(teks: str) -> bool:
    """poin menyangkut mengenali orang tertentu (artis / aktor / pemain / selebriti / tokoh X, "sebelum berjilbab", prostetik,
    "bukan pemain film", nama orang + kata kerja tampil/muncul) → True"""
    raise NotImplementedError("stub: hakim-ai")


def teks_brief_untuk_prompt(brief: BriefCampaign) -> str:
    """blok system kedua (di-cache 1 jam per campaign): deterministik (tanpa waktu / acak), poin berurutan dengan id"""
    raise NotImplementedError("stub: hakim-ai")
