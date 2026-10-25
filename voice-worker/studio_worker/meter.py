"""Ukur & atur level audio: LUFS (pyloudnorm), true peak (oversampling 4x), energi per frame, limiter sederhana."""
from __future__ import annotations

import numpy as np
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import resample_poly

SILENT_LUFS = -70.0


def db(x: float) -> float:
    return float(20 * np.log10(max(float(x), 1e-9)))


def lufs(y: np.ndarray, sr: int) -> float:
    """integrated loudness (ITU-R BS.1770). Klip < 0,4 dtk diulang supaya bisa diukur."""
    import pyloudnorm as pyln

    if y.size == 0:
        return SILENT_LUFS
    x = y.astype(np.float64)
    n = len(x)
    if n < int(0.45 * sr):
        x = np.tile(x, int(np.ceil(0.45 * sr / max(n, 1))) + 1) if x.ndim == 1 else np.tile(x, (int(np.ceil(0.45 * sr / max(n, 1))) + 1, 1))
    v = pyln.Meter(sr).integrated_loudness(x)
    return float(v) if np.isfinite(v) else SILENT_LUFS


def true_peak_db(y: np.ndarray, sr: int) -> float:
    if y.size == 0:
        return -120.0
    # oversampling 4x per kanal → perkiraan puncak di antara sampel
    chans = [y] if y.ndim == 1 else [y[:, c] for c in range(y.shape[1])]
    return max(db(np.max(np.abs(resample_poly(c.astype(np.float64), 4, 1)))) for c in chans)


def frame_db(y: np.ndarray, sr: int, win: float = 0.03, hop: float = 0.01) -> np.ndarray:
    """energi RMS (dBFS) per frame"""
    if y.ndim > 1:
        y = y.mean(axis=1)
    w = max(1, int(win * sr))
    h = max(1, int(hop * sr))
    if len(y) < w:
        return np.array([db(np.sqrt(np.mean(y**2)) if y.size else 0)])
    n = 1 + (len(y) - w) // h
    idx = np.arange(w)[None, :] + h * np.arange(n)[:, None]
    fr = y[idx]
    return 20 * np.log10(np.sqrt(np.mean(fr**2, axis=1)) + 1e-9)


def gain(y: np.ndarray, gain_db: float) -> np.ndarray:
    return (y * (10 ** (gain_db / 20))).astype(np.float32)


def limit(y: np.ndarray, sr: int, ceiling_db: float = -1.5, look_ms: float = 5.0) -> np.ndarray:
    """peak limiter ringan (look-ahead) supaya puncak tidak lewat `ceiling_db`"""
    if y.size == 0:
        return y
    thr = 10 ** (ceiling_db / 20)
    a = np.abs(y) if y.ndim == 1 else np.abs(y).max(axis=1)
    if a.max() <= thr:
        return y.astype(np.float32)
    g = np.minimum(1.0, thr / np.maximum(a, 1e-9))
    w = max(1, int(sr * look_ms / 1000))
    g = minimum_filter1d(g, size=2 * w + 1)
    g = uniform_filter1d(g, size=w)
    out = y * (g if y.ndim == 1 else g[:, None])
    return np.clip(out, -thr, thr).astype(np.float32)


def normalize(y: np.ndarray, sr: int, target_lufs: float, tp_max: float | None = None) -> tuple[np.ndarray, float]:
    """samakan loudness ke target (+ batasi true peak). Balikan (audio, lufs_awal)."""
    cur = lufs(y, sr)
    if cur <= SILENT_LUFS + 1:
        return y.astype(np.float32), cur
    out = gain(y, target_lufs - cur)
    if tp_max is not None:
        out = limit(out, sr, tp_max - 0.4)
        tp = true_peak_db(out, sr)
        if tp > tp_max:
            out = gain(out, tp_max - tp - 0.05)
    return out, cur


def trim_silence(y: np.ndarray, sr: int, thr_db: float = -45.0, pad: float = 0.04) -> np.ndarray:
    """buang hening di awal/akhir (sisakan `pad` detik)"""
    if y.size == 0:
        return y
    fd = frame_db(y, sr, 0.02, 0.01)
    peak = float(fd.max())
    on = np.where(fd > max(thr_db, peak - 40))[0]
    if not len(on):
        return y
    h = int(0.01 * sr)
    s = max(0, on[0] * h - int(pad * sr))
    e = min(len(y), (on[-1] + 2) * h + int(pad * sr))
    return y[s:e]
