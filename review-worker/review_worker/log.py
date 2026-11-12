"""Log ke layar + data/logs/review-YYYY-MM-DD.log (pemilik: worker-inti). FilterPrivasi menyamarkan email, no HP, @handle,
link http(s) dan kunci (sk-ant-…, eyJ… JWT) di SEMUA baris log sebelum ditulis.

Filter dipasang di HANDLER (bukan logger) → pesan library (httpx, yt-dlp, psycopg) ikut disaring. Traceback juga disaring
(FormatterPrivasi menyaring teks akhir). File log disimpan 14 hari.
"""
from __future__ import annotations

import logging
import re
import sys
import threading
import time
import warnings
from datetime import date
from pathlib import Path

ROOT_NAME = "review"
FMT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"

# kunci / token: Anthropic, Supabase (JWT eyJ…, sb_secret_…), Google API key (AIza…), Bearer …, password=…
_KUNCI = re.compile(
    r"sk-ant-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?|sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}"
    r"|AIza[0-9A-Za-z_-]{20,}|(?i:bearer)\s+[A-Za-z0-9._-]{12,}|(?i:(?:password|passwd|pwd|apikey|api_key)\s*[=:]\s*)\S+"
)


def saring(teks: str) -> str:
    """teks log → tanpa kunci & data pribadi (email, no HP, @handle, link)"""
    from .privasi import samarkan  # impor malas: privasi tidak butuh log

    if not teks:
        return teks
    return samarkan(_KUNCI.sub("[rahasia]", teks))  # tanpa merapikan spasi → indentasi traceback tetap


class FilterPrivasi(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:  # noqa: D401
        try:
            msg = record.getMessage()
        except Exception:
            return True
        record.msg = saring(msg)
        record.args = None
        return True


class FormatterPrivasi(logging.Formatter):
    """teks akhir (termasuk traceback) disaring lagi — exception bisa memuat link / kunci"""

    def format(self, record: logging.LogRecord) -> str:
        return saring(super().format(record))


class FileHarian(logging.Handler):
    """tulis ke data/logs/review-<tanggal>.log; ganti file lewat tengah malam; hapus file > 14 hari"""

    def __init__(self, folder: Path, prefix: str = "review", keep_days: int = 14):
        super().__init__()
        self.folder, self.prefix, self.keep = folder, prefix, keep_days
        self._day: str | None = None
        self._fh = None
        self._lock = threading.RLock()
        folder.mkdir(parents=True, exist_ok=True)

    def _open(self) -> None:
        day = date.today().isoformat()
        if day == self._day and self._fh:
            return
        if self._fh:
            self._fh.close()
        self._day = day
        self._fh = open(self.folder / f"{self.prefix}-{day}.log", "a", encoding="utf-8")
        cutoff = time.time() - self.keep * 86400
        for f in self.folder.glob(f"{self.prefix}-*.log"):
            try:
                if f.stat().st_mtime < cutoff:
                    f.unlink()
            except OSError:
                pass

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
            with self._lock:
                self._open()
                assert self._fh is not None
                self._fh.write(msg + "\n")
                self._fh.flush()
        except Exception:
            self.handleError(record)

    def close(self) -> None:
        with self._lock:
            if self._fh:
                self._fh.close()
                self._fh = None
        super().close()


def setup(logs: Path, level: int = logging.INFO) -> logging.Logger:
    for s in (sys.stdout, sys.stderr):  # konsol Windows cp1252 → paksa utf-8
        if s is None:
            continue
        try:
            s.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except Exception:
            pass
    filt = FilterPrivasi()
    root = logging.getLogger(ROOT_NAME)
    root.setLevel(level)
    root.propagate = False
    for h in list(root.handlers):
        root.removeHandler(h)
    if sys.stdout is not None:
        con = logging.StreamHandler(sys.stdout)
        con.setFormatter(FormatterPrivasi("%(asctime)s %(message)s", "%H:%M:%S"))
        con.addFilter(filt)
        root.addHandler(con)
    fh = FileHarian(logs)
    fh.setFormatter(FormatterPrivasi(FMT, "%Y-%m-%d %H:%M:%S"))
    fh.addFilter(filt)
    root.addHandler(fh)
    # peringatan library ikut ke file (tersaring); library cerewet cukup WARNING
    lib = logging.getLogger()
    lib.setLevel(logging.WARNING)
    if not any(isinstance(h, FileHarian) for h in lib.handlers):
        lib.addHandler(fh)
    for noisy in ("httpx", "httpcore", "urllib3", "numba", "matplotlib", "faster_whisper", "huggingface_hub", "filelock",
                  "psycopg", "anthropic", "PIL", "easyocr", "yt_dlp", "gdown"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    for cat in (FutureWarning, DeprecationWarning, UserWarning):
        warnings.filterwarnings("ignore", category=cat, module=r"^(torch|torchaudio|torchvision|librosa|easyocr|ctranslate2|numba)(\.|$)")
    return root


def get(name: str) -> logging.Logger:
    """logger anak "review.<name>" (aman dipanggil sebelum setup)"""
    return logging.getLogger(f"{ROOT_NAME}.{name}")
