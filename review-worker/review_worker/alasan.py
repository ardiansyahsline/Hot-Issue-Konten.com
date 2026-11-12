"""Alasan reject resmi (pemilik: hakim-ai). Kode tetap (skema.KodeAlasan) ↔ label persis dari audit_log (review_reasons).
Label baru yang tidak dikenal → kode ditebak dari kata kunci, cadangan "lainnya"."""
from __future__ import annotations

from typing import Optional

from .skema import KodeAlasan

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
# alasan yang TIDAK bisa dilihat dari isi video (dilaporkan terpisah di laporan: "di luar jangkauan AI")
DI_LUAR_VIDEO: frozenset[str] = frozenset({"followers_kurang", "link_bio_tidak_ada", "duplikat"})


def kode_untuk_label(label: Optional[str]) -> Optional[KodeAlasan]:
    raise NotImplementedError("stub: hakim-ai")


def label_untuk_kode(kode: Optional[str], daftar: Optional[dict[str, str]] = None) -> Optional[str]:
    """daftar = {kode: label paling sering dipakai} dari review_reasons; cadangan KODE_LABEL_BAWAAN"""
    raise NotImplementedError("stub: hakim-ai")


def sinkron(supa, daftar: list[tuple[str, int, Optional[str], Optional[str]]]) -> int:
    """upsert review_reasons (label, code, uses, first_seen, last_seen) — data hasil replika.daftar_alasan"""
    raise NotImplementedError("stub: hakim-ai")


def muat_daftar(supa) -> dict[str, str]:
    """{kode: label resmi paling sering} dari review_reasons (gagal → KODE_LABEL_BAWAAN)"""
    raise NotImplementedError("stub: hakim-ai")
