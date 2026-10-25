"""Deteksi BPM & ketukan musik (librosa beat_track + onset) untuk menempel potongan video ke ketukan."""
from __future__ import annotations

from pathlib import Path

import numpy as np

from . import ff, meter

SR = 22050


def _fold_bpm(bpm: float) -> float:
    """BPM setengah / dua kali lipat dirapikan ke rentang wajar 70–180"""
    if bpm <= 0:
        return 0.0
    while bpm < 70:
        bpm *= 2
    while bpm > 180:
        bpm /= 2
    return bpm


def analyze(path: Path, max_sec: float = 600) -> dict:
    import librosa

    y = ff.decode(path, SR, mono=True, max_sec=max_sec)
    dur = len(y) / SR
    if dur < 0.5:
        return {"bpm": None, "beats": [], "onsets": [], "lufs": None, "dur": round(dur, 3)}
    full = ff.decode(path, 48000, mono=False, max_sec=max_sec)
    loud = meter.lufs(full, 48000)
    env = librosa.onset.onset_strength(y=y, sr=SR)
    tempo, beat_t = librosa.beat.beat_track(onset_envelope=env, sr=SR, units="time", trim=False)
    raw_bpm = float(np.atleast_1d(tempo)[0]) if np.size(tempo) else 0.0
    beats = [round(float(t), 3) for t in np.atleast_1d(beat_t)]
    # cukup percaya BPM kalau ada ≥ 4 ketukan yang jaraknya konsisten
    bpm = None
    if len(beats) >= 4:
        iv = np.diff(beats)
        med = float(np.median(iv))
        if med > 0 and float(np.mean(np.abs(iv - med) < 0.08 * med)) >= 0.6:
            bpm = round(_fold_bpm(60.0 / med if raw_bpm <= 0 else raw_bpm), 1)
    if bpm is None and raw_bpm > 0 and len(beats) >= 4:
        bpm = round(_fold_bpm(raw_bpm), 1)
    on = librosa.onset.onset_detect(onset_envelope=env, sr=SR, units="time", backtrack=False)
    strength = env[librosa.time_to_frames(on, sr=SR)] if len(on) else np.array([])
    onsets = [round(float(t), 3) for t in np.atleast_1d(on)][:2000]
    # onset terkuat (dipakai untuk "drop" / impact)
    strong = [onsets[i] for i in np.argsort(-strength)[:8]] if len(onsets) else []
    return {
        "bpm": bpm,
        "beats": beats[:2000],
        "onsets": onsets,
        "strong": sorted(strong),
        "lufs": round(loud, 1) if loud > meter.SILENT_LUFS + 1 else None,
        "dur": round(dur, 3),
    }
