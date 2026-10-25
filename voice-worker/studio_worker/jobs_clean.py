"""Job kind 'clean': bersihkan rekaman bank suara → voices/<id>/clean.wav + studio_voices (clean_path, quality, status siap/gagal)."""
from __future__ import annotations

import shutil
from pathlib import Path
from typing import Callable

from . import clean
from . import log as vlog
from .jobctx import JobCtx, JobError, Runtime

log = vlog.get("clean")


def clean_voice(rt: Runtime, voice: dict, progress: Callable[[float, str], None] | None = None) -> dict:
    """proses satu suara (dipakai job clean, seed bank, dan otomatis sebelum TTS). Balikan baris studio_voices terbaru."""
    if not voice.get("consent"):
        raise JobError("Suara ini belum ada izin pemiliknya — tidak bisa diproses.")
    vid = voice["id"]
    rt.supa.update("studio_voices", {"id": f"eq.{vid}"}, {"status": "diproses"})
    work = rt.cfg.tmp / f"clean-{vid}"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)
    try:
        raw_path = voice.get("raw_path") or ""
        src = work / ("raw" + (Path(raw_path).suffix or ".wav"))
        try:
            rt.supa.download(raw_path, src)
        except Exception as e:
            rt.supa.update("studio_voices", {"id": f"eq.{vid}"}, {"status": "gagal", "quality": {"saran": "File rekaman tidak ditemukan. Upload ulang rekamannya."}})
            raise JobError("File rekaman tidak ditemukan. Upload ulang rekamannya.") from e
        try:
            res = clean.process(src, work / "clean.wav", rt.cfg.df_atten_db, progress)
        except Exception as e:
            log.exception("Pembersih gagal untuk suara %s", vid)
            rt.supa.update("studio_voices", {"id": f"eq.{vid}"}, {"status": "gagal", "quality": {"saran": "Rekaman tidak bisa dibaca. Coba upload format lain (wav/mp3/m4a)."}})
            raise JobError("Rekaman tidak bisa dibaca. Coba upload format lain (wav/mp3/m4a).") from e
        if not res.ok or res.out is None:
            rt.supa.update("studio_voices", {"id": f"eq.{vid}"}, {"status": "gagal", "quality": res.quality})
            raise JobError(res.quality.get("saran") or "Rekaman kurang jelas, coba rekam ulang.")
        clean_path = rt.supa.upload(f"voices/{vid}/clean.wav", res.out, "audio/wav")
        rows = rt.supa.update("studio_voices", {"id": f"eq.{vid}"}, {"clean_path": clean_path, "quality": res.quality, "status": "siap"})
        log.info("Suara %s (%s) siap: %s", voice.get("name"), vid, res.quality.get("saran"))
        return rows[0] if rows else {**voice, "clean_path": clean_path, "quality": res.quality, "status": "siap"}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def run(ctx: JobCtx) -> None:
    vid = ctx.job.get("voice_id")
    if not vid:
        raise JobError("Suara yang mau dibersihkan belum dipilih.")
    rows = ctx.supa.select("studio_voices", id=f"eq.{vid}", select="*")
    if not rows:
        raise JobError("Suara tidak ditemukan di bank suara.")
    v = clean_voice(ctx.rt, rows[0], lambda p, m: ctx.progress(p, m))
    q = v.get("quality") or {}
    ctx.done({"result": {"clean_path": v.get("clean_path"), "quality": q}, "engine_used": q.get("denoise")}, q.get("saran") or "Rekaman sudah dibersihkan")
