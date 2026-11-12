"""Unduh video pakai yt-dlp (pemilik: worker-media): batas laju (REVIEW_DL_RATE), batas ukuran (REVIEW_DL_MAX_MB),
≤ 720p, tanpa cookies / login, tanpa playlist, jeda antar unduhan (REVIEW_DL_JEDA). Link TIDAK pernah ditulis ke log.

yt-dlp dijalankan sebagai PROSES ANAK (`python -m yt_dlp`), bukan di dalam proses worker: bisa dihentikan paksa kalau macet
(batas waktu) / Ctrl+C, dan `--ignore-config` memastikan config/cookies yt-dlp milik user di laptop tidak ikut terbaca.
stderr yt-dlp memuat link + username → tidak pernah dilog / disimpan; hanya dipetakan ke kategori pesan awam."""
from __future__ import annotations

import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

from ..log import get
from .ff import CHILD_FLAGS, ada_video, ffmpeg_bin

log = get("unduh")
EKSTENSI_VIDEO = (".mp4", ".webm", ".mkv", ".mov", ".m4v")
FORMAT = "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b"
_jeda_lock = threading.Lock()
_terakhir = 0.0  # time.monotonic() unduhan terakhir selesai (jeda antar video, sopan ke platform)


class TidakBisaDiakses(Exception):
    """video dihapus / private / butuh login / terlalu besar — pesan awam (dipetakan ke "Video tidak bisa diakses")"""


# (pola stderr yt-dlp, pesan awam) — urutan penting: yang paling spesifik dulu
_POLA = [
    (r"larger than max-filesize|File is larger", "Video tidak bisa diakses: ukuran file melebihi batas unduh."),
    (r"[Pp]rivate|only available for registered|[Ll]ogin required|log in|[Ss]ign in|cookies|rate-limit reached|not comfortable",
     "Video tidak bisa diakses: private / butuh login platform."),
    (r"removed|deleted|no longer available|does not exist|[Nn]ot [Ff]ound|HTTP Error 404|HTTP Error 410|unavailable|"
     r"[Vv]ideo not available|This post is",
     "Video tidak bisa diakses: sudah dihapus / tidak tersedia."),
    (r"geo|not available in your country|region", "Video tidak bisa diakses: dibatasi wilayah."),
    (r"Unsupported URL|is not a valid URL|No video formats|Requested format is not available",
     "Video tidak bisa diakses: link tidak dikenali / bukan video."),
    (r"HTTP Error 403|Forbidden", "Video tidak bisa diakses: ditolak platform (403)."),
    (r"HTTP Error 429|Too Many Requests", "Video tidak bisa diakses: platform membatasi unduhan (terlalu sering) — coba lagi nanti."),
    (r"timed out|Connection|Network|getaddrinfo|Temporary failure|SSL|reset by peer",
     "Video tidak bisa diakses: koneksi internet bermasalah."),
]


def _pesan_awam(stderr: str) -> str:
    for pola, pesan in _POLA:
        if re.search(pola, stderr):
            return pesan
    return "Video tidak bisa diakses (gagal diunduh)."


def _kategori(pesan: str) -> str:
    """potongan pesan setelah ':' — untuk log (tanpa link)"""
    return pesan.split(":", 1)[-1].strip() if ":" in pesan else pesan


def _jeda(cfg) -> None:
    global _terakhir
    with _jeda_lock:
        sisa = float(getattr(cfg, "dl_jeda_detik", 3.0) or 0) - (time.monotonic() - _terakhir)
    if sisa > 0:
        time.sleep(min(sisa, 30.0))


def _selesai() -> None:
    global _terakhir
    with _jeda_lock:
        _terakhir = time.monotonic()


def _rate_bytes(rate: str) -> float:
    """'4M' → 4·1024² byte/dtk (untuk perkiraan batas waktu)"""
    m = re.fullmatch(r"\s*([\d.]+)\s*([KkMmGg]?)\s*[Bb]?\s*", str(rate or ""))
    if not m:
        return 4 * 1024 * 1024
    mult = {"": 1, "k": 1024, "m": 1024 ** 2, "g": 1024 ** 3}[m.group(2).lower()]
    return max(64 * 1024, float(m.group(1)) * mult)


def perintah(url: str, folder: Path, cfg) -> list[str]:
    """argumen yt-dlp (dipisah supaya bisa dites tanpa jaringan)"""
    args = [sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-cookies-from-browser", "--no-playlist",
            "--no-cache-dir", "--no-mtime", "--no-part", "--quiet", "--no-warnings", "--no-progress", "--newline",
            "--restrict-filenames", "-f", FORMAT, "--merge-output-format", "mp4",
            "--retries", "2", "--fragment-retries", "2", "--socket-timeout", "30",
            "--limit-rate", str(getattr(cfg, "dl_rate", "4M") or "4M"),
            "--max-filesize", f"{int(getattr(cfg, 'dl_max_mb', 200) or 200)}M",
            "--match-filter", "!is_live & !was_live",
            "-o", str(folder / "video.%(ext)s")]
    ff = ffmpeg_bin()
    if os.path.sep in ff or (os.altsep and os.altsep in ff):
        args += ["--ffmpeg-location", ff]
    if os.environ.get("REVIEW_DL_COOKIES"):  # KEPUTUSAN USER (bawaan kosong): file cookies akun khusus, tidak pernah di repo
        args += ["--cookies", os.environ["REVIEW_DL_COOKIES"]]
    return args + ["--", url]


def _cari_hasil(folder: Path) -> Path | None:
    kandidat = [p for p in folder.glob("video.*") if p.suffix.lower() in EKSTENSI_VIDEO and p.stat().st_size > 0]
    return max(kandidat, key=lambda p: p.stat().st_size) if kandidat else None


def unduh_video(url: str, folder: Path, cfg) -> Path:
    if not url or not re.match(r"https?://", str(url).strip(), re.I):
        raise TidakBisaDiakses("Video tidak bisa diakses: link video tidak ada di data Konten.com.")
    folder.mkdir(parents=True, exist_ok=True)
    maks_mb = int(getattr(cfg, "dl_max_mb", 200) or 200)
    batas_waktu = float(getattr(cfg, "dl_timeout", 0) or 0) or max(180.0, maks_mb * 1024 * 1024 / _rate_bytes(getattr(cfg, "dl_rate", "4M")) * 1.5 + 90)
    _jeda(cfg)
    mulai = time.monotonic()
    try:
        p = subprocess.Popen(perintah(url.strip(), folder, cfg), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             stdin=subprocess.DEVNULL, cwd=str(folder), creationflags=CHILD_FLAGS)
        try:
            out, err = p.communicate(timeout=batas_waktu)
        except subprocess.TimeoutExpired:
            p.kill()
            p.communicate()
            raise TidakBisaDiakses("Video tidak bisa diakses: unduhan terlalu lama (macet / koneksi lambat).")
        except BaseException:  # Ctrl+C / dibatalkan → jangan tinggalkan yt-dlp jalan sendiri
            p.kill()
            raise
    except OSError as e:
        raise TidakBisaDiakses("Video tidak bisa diakses: yt-dlp tidak bisa dijalankan.") from e
    finally:
        _selesai()
    teks = (err or b"").decode("utf-8", "replace") + (out or b"").decode("utf-8", "replace")
    hasil = _cari_hasil(folder)
    if p.returncode != 0 or hasil is None:
        for sisa in folder.glob("video.*"):  # potongan setengah jadi
            try:
                sisa.unlink()
            except OSError:
                pass
        pesan = _pesan_awam(teks) if teks.strip() else "Video tidak bisa diakses (gagal diunduh)."
        if p.returncode == 0 and hasil is None and not teks.strip():
            pesan = "Video tidak bisa diakses: ukuran file melebihi batas unduh / tidak ada format yang cocok."
        log.info("unduh gagal (%s) setelah %.1f dtk", _kategori(pesan), time.monotonic() - mulai)
        raise TidakBisaDiakses(pesan)
    if hasil.stat().st_size > maks_mb * 1024 * 1024 * 1.05:
        hasil.unlink(missing_ok=True)
        raise TidakBisaDiakses("Video tidak bisa diakses: ukuran file melebihi batas unduh.")
    if not ada_video(hasil):
        hasil.unlink(missing_ok=True)
        raise TidakBisaDiakses("Video tidak bisa diakses: file yang terunduh bukan video.")
    log.info("unduh ok %.1f MB dalam %.1f dtk", hasil.stat().st_size / 1e6, time.monotonic() - mulai)
    return hasil
