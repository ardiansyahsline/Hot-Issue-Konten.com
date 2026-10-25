"""Isi bank suara bawaan dari voice-worker/bank-suara/ saat worker pertama jalan (suara Alif, sudah ada izin pemiliknya)."""
from __future__ import annotations

import re
import uuid
from pathlib import Path

from . import log as vlog
from .config import ROOT
from .jobctx import JobError, Runtime

log = vlog.get("seed")

BANK = ROOT / "bank-suara"
SEEDS = [
    {"seed_key": "alif-energik", "name": "Alif - Energik", "style": "energik, semangat", "file": "referensi-alif-energik-10dtk.wav"},
    {"seed_key": "alif-tenang", "name": "Alif - Tenang", "style": "tenang, jelas", "file": "referensi-alif-tenang-10dtk.wav"},
]


def transcripts(readme: Path = BANK / "README.md") -> dict[str, str]:
    """ambil transkrip dari README bank: - **<nama file tanpa .wav>:** "…" """
    out: dict[str, str] = {}
    try:
        txt = readme.read_text(encoding="utf-8")
    except OSError:
        return out
    for m in re.finditer(r"^\s*-\s*\*\*([\w.-]+?)(?:\.wav)?:\*\*\s*[\"“](.+?)[\"”]\s*$", txt, re.M):
        out[m.group(1)] = m.group(2).strip()
    return out


def seed_bank(rt: Runtime) -> None:
    from .jobs_clean import clean_voice

    tr = transcripts()
    for s in SEEDS:
        try:
            rows = rt.supa.select("studio_voices", seed_key=f"eq.{s['seed_key']}", select="*")
            if not rows:
                f = BANK / s["file"]
                if not f.exists():
                    log.warning("File bank suara tidak ada: %s", f)
                    continue
                vid = str(uuid.uuid4())
                raw_path = rt.supa.upload(f"voices/{vid}/raw.wav", f, "audio/wav")
                row = {
                    "id": vid,
                    "owner": None,
                    "name": s["name"],
                    "style": s["style"],
                    "transcript": tr.get(Path(s["file"]).stem),
                    "consent": True,  # pemilik suara (Alif) sudah setuju, lihat bank-suara/README.md
                    "raw_path": raw_path,
                    "status": "baru",
                    "seed_key": s["seed_key"],
                }
                rt.supa.insert("studio_voices", row, on_conflict="seed_key", ignore=True)
                rows = rt.supa.select("studio_voices", seed_key=f"eq.{s['seed_key']}", select="*")
                log.info("Bank suara: \"%s\" ditambahkan.", s["name"])
            v = rows[0] if rows else None
            if v and (not v.get("clean_path") or v.get("status") in ("baru", "gagal")):
                log.info("Bank suara: membersihkan \"%s\"…", v["name"])
                clean_voice(rt, v)
        except JobError as e:
            log.warning("Bank suara \"%s\" belum siap: %s", s["name"], e)
        except Exception as e:  # jangan sampai worker gagal start gara-gara seed
            log.warning("Isi bank suara \"%s\" gagal: %s", s["name"], e)
