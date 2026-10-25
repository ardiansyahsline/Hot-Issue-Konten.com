"""
Helper mixing (dipakai VO lengkap & render):
- place_clips: taruh klip di detik tertentu di atas hening (VO lengkap full.mp3)
- duck_curve: musik turun saat VO bicara (volume envelope dengan attack/release halus)
- limit_loud_sfx: maks 2 SFX keras berbunyi berdekatan
- fade, mix_tracks (VO + musik + SFX) dan loudnorm_2pass (ffmpeg, -14 LUFS / TP -1 dBTP, video di-copy)
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np

from . import ff, meter

SR = 48000
FINAL_LUFS = -14.0
FINAL_TP = -1.0
DUCK_DB = -8.0  # sama dengan DUCK_DB di lib/studio/timeline.ts
LOUD_CATS = {"boom", "braam", "bass-drop", "impact", "riser", "transisi", "glitch"}


def fade(y: np.ndarray, sr: int, fin: float = 0.0, fout: float = 0.0) -> np.ndarray:
    y = y.astype(np.float32).copy()
    a, b = min(len(y), int(fin * sr)), min(len(y), int(fout * sr))
    if a > 1:
        ramp = np.linspace(0, 1, a, dtype=np.float32)
        y[:a] *= ramp if y.ndim == 1 else ramp[:, None]
    if b > 1:
        ramp = np.linspace(1, 0, b, dtype=np.float32)
        y[-b:] *= ramp if y.ndim == 1 else ramp[:, None]
    return y


def place_clips(clips: list[tuple[np.ndarray, float]], sr: int = SR, tail: float = 0.5, ceiling_db: float = -1.0) -> np.ndarray:
    """clips = [(audio mono, detik mulai)] → satu track; panjang = akhir klip terakhir + `tail` dtk"""
    if not clips:
        return np.zeros(int(tail * sr), dtype=np.float32)
    end = max(start + len(y) / sr for y, start in clips) + tail
    out = np.zeros(int(np.ceil(end * sr)), dtype=np.float32)
    for y, start in clips:
        s = max(0, int(round(start * sr)))
        out[s : s + len(y)] += y[: len(out) - s]
    return meter.limit(out, sr, ceiling_db)


def speech_spans(clips: list[tuple[float, float]], gap: float = 0.25) -> list[tuple[float, float]]:
    """gabungkan rentang VO (mulai, selesai) yang jedanya pendek"""
    out: list[list[float]] = []
    for s, e in sorted(clips):
        if out and s - out[-1][1] <= gap:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return [(a, b) for a, b in out]


def duck_curve(spans: list[tuple[float, float]], total: float, sr: int = SR, duck_db: float = DUCK_DB, attack: float = 0.08, release: float = 0.35) -> np.ndarray:
    """kurva gain linear musik: turun `duck_db` saat VO, naik lagi pelan setelahnya"""
    n = int(np.ceil(total * sr))
    target = np.ones(n, dtype=np.float32)
    low = 10 ** (duck_db / 20)
    for s, e in spans:
        target[max(0, int((s - attack) * sr)) : min(n, int(e * sr))] = low
    # haluskan: turun cepat (attack), naik pelan (release) — one-pole per blok 10 ms supaya cepat
    blk = max(1, int(0.01 * sr))
    coarse = target[::blk].copy()
    a_up = np.exp(-blk / (release * sr))
    a_dn = np.exp(-blk / (attack * sr))
    g = np.empty_like(coarse)
    cur = coarse[0] if len(coarse) else 1.0
    for i, t in enumerate(coarse):
        a = a_dn if t < cur else a_up
        cur = a * cur + (1 - a) * t
        g[i] = cur
    return np.interp(np.arange(n), np.arange(len(g)) * blk, g).astype(np.float32)


def limit_loud_sfx(cues: list[dict], window: float = 0.25, max_loud: int = 2) -> list[dict]:
    """cues [{t, cat, lufs?}] → buang SFX keras ke-3 dst. yang pukulannya berdekatan (±window dtk)"""
    kept: list[dict] = []
    loud_t: list[float] = []
    for c in sorted(cues, key=lambda c: c["t"]):
        loud = c.get("cat") in LOUD_CATS or float(c.get("lufs", -30)) > -14
        if loud:
            if sum(1 for t in loud_t if abs(t - c["t"]) < window) >= max_loud:
                continue
            loud_t.append(c["t"])
        kept.append(c)
    return kept


def mix_tracks(vo: list[tuple[np.ndarray, float]], music: np.ndarray | None, sfx: list[tuple[np.ndarray, float, float]], total: float, sr: int = SR, music_db: float = -18.0) -> np.ndarray:
    """VO + musik (di-ducking) + SFX (audio, detik, gain dB) → stereo float32 belum dinormalisasi"""
    n = int(np.ceil(total * sr))
    out = np.zeros((n, 2), dtype=np.float32)
    spans = []
    for y, s in vo:
        i = int(s * sr)
        seg = y[: max(0, n - i)]
        out[i : i + len(seg)] += seg[:, None]
        spans.append((s, s + len(y) / sr))
    if music is not None and music.size:
        m = music if music.ndim == 2 else np.repeat(music[:, None], 2, axis=1)
        m = fade(m[:n], sr, 0.5, 1.5)
        cur_db = meter.lufs(m, sr)
        g = 10 ** ((music_db - cur_db) / 20) if cur_db > meter.SILENT_LUFS + 1 else 1.0
        curve = duck_curve(speech_spans(spans), total, sr)[: len(m)]
        out[: len(m)] += m * g * curve[:, None]
    for y, s, gdb in sfx:
        i = max(0, int(s * sr))
        a = y if y.ndim == 2 else np.repeat(y[:, None], 2, axis=1)
        a = fade(a, sr, 0.003, 0.05)[: max(0, n - i)]
        out[i : i + len(a)] += a * (10 ** (gdb / 20))
    return out


def _loudnorm_measure(src: Path, lufs: float, tp: float, lra: float) -> dict | None:
    p = ff.run(["-i", str(src), "-vn", "-af", f"loudnorm=I={lufs}:TP={tp}:LRA={lra}:print_format=json", "-f", "null", "-"])
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", p.stderr, re.S)
    if not m:
        return None
    d = json.loads(m.group(0))
    try:
        if float(d["input_i"]) <= -70:  # hening total
            return None
    except (KeyError, ValueError):
        return None
    return d


def loudnorm_2pass(src: Path, dst: Path, lufs: float = FINAL_LUFS, tp: float = FINAL_TP, lra: float = 11.0, video: bool = False, audio_codec: str = "aac", bitrate: str = "192k") -> dict:
    """normalisasi loudness 2 tahap (linear). video=True → stream video di-copy apa adanya"""
    d = _loudnorm_measure(src, lufs, tp, lra)
    args = ["-i", str(src)]
    if d:
        af = (
            f"loudnorm=I={lufs}:TP={tp}:LRA={lra}:measured_I={d['input_i']}:measured_TP={d['input_tp']}"
            f":measured_LRA={d['input_lra']}:measured_thresh={d['input_thresh']}:offset={d['target_offset']}:linear=true"
        )
        args += ["-af", af, "-ar", str(SR)]
    if video:
        args += ["-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy", "-movflags", "+faststart"]
    args += ["-c:a", audio_codec, "-b:a", bitrate, str(dst)]
    ff.run(args, timeout=1800)
    return {"measured": d, "lufs": lufs, "tp": tp}
