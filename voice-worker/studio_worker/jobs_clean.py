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


# suara yang sudah dicoba dibersihkan ulang di sesi ini (berhasil / gagal) — jangan diulang tiap job
_RECLEANED: set[str] = set()


def clean_ver(voice: dict) -> int:
    """versi pembersih yang menghasilkan clean_path suara ini (quality.ver; suara lama tanpa ver = 1)"""
    q = voice.get("quality") if isinstance(voice.get("quality"), dict) else {}
    try:
        return int(q.get("ver") or 1)
    except (TypeError, ValueError):
        return 1


def outdated(voice: dict) -> bool:
    """suara siap tapi dibersihkan versi pembersih lama (mis. potongan paling datar + denoise 18 dB tetap) dan rekaman mentah masih
    ada → perlu dibersihkan ulang sekali. Yang sudah pernah dicoba & gagal (quality.ver_try) tidak diulang."""
    q = voice.get("quality") if isinstance(voice.get("quality"), dict) else {}
    try:
        tried = int(q.get("ver_try") or 0)
    except (TypeError, ValueError):
        tried = 0
    return (
        voice.get("status") == "siap"
        and bool(voice.get("clean_path"))
        and bool(voice.get("raw_path"))
        and clean_ver(voice) < clean.CLEAN_VER
        and tried < clean.CLEAN_VER
        and str(voice.get("id")) not in _RECLEANED
    )


def reclean(rt: Runtime, voice: dict, progress: Callable[[float, str], None] | None = None) -> dict:
    """bersihkan ulang SEKALI dengan pembersih versi sekarang. Gagal apa pun → hasil bersih lama tetap dipakai (status & quality
    dikembalikan, ditandai ver_try supaya tidak dicoba terus), tanpa error ke job."""
    vid = str(voice.get("id"))
    _RECLEANED.add(vid)
    log.info("Suara %s (%s): dibersihkan ulang dengan pembersih versi %d (potongan paling hidup, denoise adaptif)…", voice.get("name"), vid, clean.CLEAN_VER)
    try:
        return clean_voice(rt, voice, progress)
    except Exception as e:
        log.warning("Bersihkan ulang suara %s gagal (%s) — tetap pakai rekaman bersih lama.", vid, e)
        q = {**(voice.get("quality") if isinstance(voice.get("quality"), dict) else {}), "ver_try": clean.CLEAN_VER}
        try:
            rows = rt.supa.update("studio_voices", {"id": f"eq.{vid}"}, {"status": "siap", "clean_path": voice.get("clean_path"), "quality": q})
        except Exception as e2:
            log.warning("Status suara %s tidak bisa dikembalikan (%s).", vid, e2)
            rows = []
        return rows[0] if rows else {**voice, "quality": q}


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
