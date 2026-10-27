"""Pembungkus ffmpeg / ffprobe (decode, encode mp3, durasi). Di Windows proses anak jalan tanpa jendela & prioritas rendah."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

IS_WIN = os.name == "nt"
# CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS → tidak muncul jendela hitam & tidak mengganggu bot WAHA
CHILD_FLAGS = (0x08000000 | 0x00004000) if IS_WIN else 0


class FFError(RuntimeError):
    pass


def ffmpeg_bin() -> str:
    return os.environ.get("FFMPEG") or shutil.which("ffmpeg") or "ffmpeg"


def ffprobe_bin() -> str:
    return os.environ.get("FFPROBE") or shutil.which("ffprobe") or "ffprobe"


def available() -> bool:
    try:
        subprocess.run([ffmpeg_bin(), "-version"], capture_output=True, timeout=20, creationflags=CHILD_FLAGS)
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def run(args: list[str], timeout: float = 900, binary: bool = False) -> subprocess.CompletedProcess:
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-y", *args]
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout, creationflags=CHILD_FLAGS)
    except FileNotFoundError as e:
        raise FFError("ffmpeg tidak ditemukan — pasang ffmpeg dulu (lihat README)") from e
    except subprocess.TimeoutExpired as e:
        raise FFError("ffmpeg terlalu lama (timeout)") from e
    if p.returncode != 0:
        tail = p.stderr.decode("utf-8", "replace").strip().splitlines()[-6:]
        raise FFError("ffmpeg gagal: " + " | ".join(tail))
    if not binary:
        p.stdout = p.stdout.decode("utf-8", "replace")
    p.stderr = p.stderr.decode("utf-8", "replace")
    return p


def probe(path: Path) -> dict:
    try:
        p = subprocess.run(
            [ffprobe_bin(), "-v", "error", "-show_entries", "format=duration:stream=codec_type,channels,sample_rate", "-of", "json", str(path)],
            capture_output=True,
            timeout=60,
            creationflags=CHILD_FLAGS,
        )
        return json.loads(p.stdout.decode("utf-8", "replace") or "{}")
    except (OSError, subprocess.SubprocessError, ValueError):
        return {}


def duration(path: Path) -> float:
    try:
        return float(probe(path).get("format", {}).get("duration") or 0)
    except (TypeError, ValueError):
        return 0.0


def has_audio(path: Path) -> bool:
    return any(s.get("codec_type") == "audio" for s in probe(path).get("streams", []))


# wav yang isinya sudah persis seperti yang diminta (sample rate & jumlah kanal sama, tanpa filter) dibaca langsung: sampelnya identik
# dengan hasil ffmpeg (int16/32768 · float apa adanya) tanpa menyalakan proses ffmpeg (±50–100 ms, di Windows lebih lama)
_DIRECT_SUBTYPES = frozenset({"PCM_16", "FLOAT"})


def _direct_wav(path: Path, sr: int, ch: int) -> np.ndarray | None:
    if Path(path).suffix.lower() != ".wav":
        return None
    try:
        info = sf.info(str(path))
        if info.format != "WAV" or info.samplerate != sr or info.channels != ch or info.subtype not in _DIRECT_SUBTYPES:
            return None
        y, _ = sf.read(str(path), dtype="float32", always_2d=ch > 1)
    except Exception:  # bukan wav biasa / rusak → biar ffmpeg yang menangani (dan melaporkan errornya)
        return None
    return np.ascontiguousarray(y, dtype=np.float32)


def decode(path: Path, sr: int = 48000, mono: bool = True, af: str | None = None, max_sec: float | None = None) -> np.ndarray:
    """file audio/video apa pun → float32 (mono: [n], stereo: [n, 2]) pada sample rate `sr`"""
    if not af and not max_sec:
        y = _direct_wav(path, sr, 1 if mono else 2)
        if y is not None:
            return y
    args = ["-i", str(path), "-vn"]
    if max_sec:
        args += ["-t", f"{max_sec:.3f}"]
    if af:
        args += ["-af", af]
    ch = 1 if mono else 2
    args += ["-ac", str(ch), "-ar", str(sr), "-f", "f32le", "-acodec", "pcm_f32le", "-"]
    p = run(args, binary=True)
    y = np.frombuffer(p.stdout, dtype=np.float32).copy()
    return y if mono else y.reshape(-1, 2)


def write_wav(path: Path, y: np.ndarray, sr: int, subtype: str = "PCM_16") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), np.clip(y, -1, 1).astype(np.float32), sr, subtype=subtype)
    return path


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    y, sr = sf.read(str(path), dtype="float32", always_2d=False)
    if y.ndim > 1:
        y = y.mean(axis=1)
    return y.astype(np.float32), int(sr)


def encode_mp3(src: Path, dst: Path, sr: int = 48000, bitrate: str = "192k", mono: bool = False) -> Path:
    dst.parent.mkdir(parents=True, exist_ok=True)
    args = ["-i", str(src), "-vn", "-ar", str(sr)]
    if mono:
        args += ["-ac", "1"]
    args += ["-c:a", "libmp3lame", "-b:a", bitrate, str(dst)]
    run(args)
    return dst
