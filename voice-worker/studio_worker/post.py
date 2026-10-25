"""Post-processing VO pakai ffmpeg: rapikan hening berlebih, EQ ringan, de-esser, kompresor ringan, lalu loudness -16 LUFS / TP -1,5."""
from __future__ import annotations

from pathlib import Path

import numpy as np

from . import ff, meter

VO_LUFS = -16.0
VO_TP = -1.5
SR = 48000

# urutan: high-pass 80 Hz → presence kecil (+2 dB di 3,5 kHz) → de-esser → kompresor ringan (-18 dB, 2,5:1)
# → hening > 0,55 dtk dipendekkan jadi 0,35 dtk (jeda alami antar kalimat tetap ada)
CHAIN = ",".join(
    [
        "highpass=f=80",
        "equalizer=f=3500:t=q:w=1.0:g=2",
        "deesser=i=0.4:m=0.5:f=0.5",
        "acompressor=threshold=0.125:ratio=2.5:attack=8:release=140:makeup=1.4",
        "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.06"
        ":stop_periods=-1:stop_duration=0.55:stop_threshold=-50dB:stop_silence=0.35",
    ]
)


def process_vo(src: Path, dst: Path, lufs: float = VO_LUFS, tp: float = VO_TP) -> float:
    """src (wav apa pun) → dst wav 48 kHz mono siap pakai. Balikan durasi (detik)."""
    y = ff.decode(src, SR, mono=True, af=CHAIN)
    if y.size < int(0.05 * SR):  # hasil kosong (hampir semua hening) → pakai versi tanpa silenceremove
        y = ff.decode(src, SR, mono=True, af=CHAIN.rsplit(",silenceremove", 1)[0])
    y = fade(y, SR, 0.005, 0.02)
    y, _ = meter.normalize(y, SR, lufs, tp)
    ff.write_wav(dst, y, SR)
    return len(y) / SR


def fade(y: np.ndarray, sr: int, fin: float = 0.01, fout: float = 0.02) -> np.ndarray:
    y = y.astype(np.float32).copy()
    a, b = min(len(y), int(fin * sr)), min(len(y), int(fout * sr))
    if a > 1:
        y[:a] *= np.linspace(0, 1, a, dtype=np.float32)
    if b > 1:
        y[-b:] *= np.linspace(1, 0, b, dtype=np.float32)
    return y
