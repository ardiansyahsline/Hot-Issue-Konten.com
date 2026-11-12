"""ffmpeg / ffprobe kecil (pemilik: worker-media). Pola voice-worker/studio_worker/ff.py: di Windows proses anak tanpa jendela &
prioritas rendah. Path file TIDAK ditulis ke pesan error (bisa memuat id video) — cukup ekor stderr ffmpeg yang sudah dipotong."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

IS_WIN = os.name == "nt"
# CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS → tidak muncul jendela hitam & tidak mengganggu aplikasi lain
CHILD_FLAGS = (0x08000000 | 0x00004000) if IS_WIN else 0


class FFError(RuntimeError):
    pass


def ffmpeg_bin() -> str:
    return os.environ.get("FFMPEG") or shutil.which("ffmpeg") or "ffmpeg"


def ffprobe_bin() -> str:
    return os.environ.get("FFPROBE") or shutil.which("ffprobe") or "ffprobe"


def tersedia() -> bool:
    try:
        subprocess.run([ffmpeg_bin(), "-version"], capture_output=True, timeout=20, creationflags=CHILD_FLAGS)
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def run(args: list[str], timeout: float = 600) -> subprocess.CompletedProcess:
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-loglevel", "error", "-y", *args]
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout, creationflags=CHILD_FLAGS)
    except FileNotFoundError as e:
        raise FFError("ffmpeg tidak ditemukan — pasang ffmpeg dulu (lihat README)") from e
    except subprocess.TimeoutExpired as e:
        raise FFError("ffmpeg terlalu lama (timeout)") from e
    if p.returncode != 0:
        tail = p.stderr.decode("utf-8", "replace").strip().splitlines()[-3:]
        raise FFError("ffmpeg gagal: " + " | ".join(t[-160:] for t in tail))
    return p


def probe(path: Path) -> dict:
    """format + stream (codec_type, width, height, duration) — {} kalau gagal"""
    try:
        p = subprocess.run(
            [ffprobe_bin(), "-v", "error", "-show_entries",
             "format=duration,size:stream=codec_type,width,height,duration:stream_tags=rotate:stream_side_data=rotation",
             "-of", "json", str(path)],
            capture_output=True, timeout=60, creationflags=CHILD_FLAGS)
        return json.loads(p.stdout.decode("utf-8", "replace") or "{}")
    except (OSError, subprocess.SubprocessError, ValueError):
        return {}


def durasi(path: Path) -> float:
    info = probe(path)
    try:
        d = float(info.get("format", {}).get("duration") or 0)
    except (TypeError, ValueError):
        d = 0.0
    if d <= 0:  # sebagian webm tidak punya durasi format → ambil dari stream
        for s in info.get("streams", []):
            try:
                d = max(d, float(s.get("duration") or 0))
            except (TypeError, ValueError):
                pass
    return round(d, 3)


def ada_audio(path: Path) -> bool:
    return any(s.get("codec_type") == "audio" for s in probe(path).get("streams", []))


def ada_video(path: Path) -> bool:
    return any(s.get("codec_type") == "video" for s in probe(path).get("streams", []))


def resolusi(path: Path) -> Optional[str]:
    """'1080x1920' (sudah memperhitungkan rotasi ponsel 90°/270°) atau None"""
    for s in probe(path).get("streams", []):
        if s.get("codec_type") != "video" or not s.get("width"):
            continue
        w, h = int(s["width"]), int(s.get("height") or 0)
        rot = 0
        try:
            rot = int(float((s.get("tags") or {}).get("rotate") or 0))
            for sd in s.get("side_data_list") or []:
                rot = int(float(sd.get("rotation", rot)))
        except (TypeError, ValueError):
            pass
        if abs(rot) % 180 == 90:
            w, h = h, w
        return f"{w}x{h}"
    return None


def ambil_audio(video: Path, keluar: Path, sr: int = 16000, maks_detik: Optional[float] = None) -> Path:
    """WAV mono 16 kHz (untuk ASR & Panako)"""
    keluar.parent.mkdir(parents=True, exist_ok=True)
    args = ["-i", str(video), "-vn", "-ac", "1", "-ar", str(sr), "-sample_fmt", "s16"]
    if maks_detik:
        args += ["-t", f"{maks_detik:.3f}"]
    run(args + [str(keluar)])
    if not keluar.exists() or keluar.stat().st_size < 1000:
        raise FFError("audio kosong")
    return keluar


def potong(video: Path, keluar: Path, mulai: float, lama: float, tinggi_maks: int = 540, crf: int = 30) -> Path:
    """potongan MP4 kecil (H.264 + AAC) untuk materi trailer: ≤ tinggi_maks px, cukup untuk sidik jari & dilihat reviewer"""
    keluar.parent.mkdir(parents=True, exist_ok=True)
    run(["-ss", f"{max(0.0, mulai):.3f}", "-i", str(video), "-t", f"{max(0.5, lama):.3f}",
         "-vf", f"scale=-2:'min({tinggi_maks},ih)':flags=bicubic", "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf),
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", str(keluar)], timeout=900)
    return keluar


def frame_jpeg(video: Path, detik: float, keluar: Path, sisi: int = 768) -> Path:
    """satu frame di detik tertentu → JPEG sisi terpanjang ≤ sisi (cadangan kalau OpenCV gagal membaca)"""
    keluar.parent.mkdir(parents=True, exist_ok=True)
    run(["-ss", f"{max(0.0, detik):.3f}", "-i", str(video), "-frames:v", "1",
         "-vf", f"scale='if(gt(iw,ih),min({sisi},iw),-2)':'if(gt(iw,ih),-2,min({sisi},ih))'", "-q:v", "3", str(keluar)])
    if not keluar.exists():
        raise FFError("frame tidak terbaca")
    return keluar
