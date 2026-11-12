"""Rubrik hakim berversi (pemilik: hakim-ai). File: review-worker/rubrik/<versi>.md (statis, tanpa data pribadi).
hash = 12 hex sha256(teks rubrik + aturan.ATURAN_VERSI + JSON skema KeputusanAI). Versi aktif: env REVIEW_RUBRIK (bawaan: terbaru)."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from .skema import Rubrik

RUBRIK_DIR = Path(__file__).resolve().parent.parent / "rubrik"


def muat_rubrik(versi: Optional[str] = None) -> Rubrik:
    raise NotImplementedError("stub: hakim-ai")


def daftar_versi() -> list[str]:
    raise NotImplementedError("stub: hakim-ai")
