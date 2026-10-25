"""Log ke konsol + file harian voice-worker/data/logs/worker-YYYY-MM-DD.log (disimpan 14 hari)."""
from __future__ import annotations

import logging
import sys
import threading
import time
from datetime import date
from pathlib import Path

FMT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"
_root_name = "vw"


class DailyFileHandler(logging.Handler):
    """tulis ke file sesuai tanggal hari ini; ganti file otomatis lewat tengah malam"""

    def __init__(self, folder: Path, prefix: str = "worker", keep_days: int = 14):
        super().__init__()
        self.folder = folder
        self.prefix = prefix
        self.keep = keep_days
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
        self._prune()

    def _prune(self) -> None:
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
        except Exception:  # log tidak boleh bikin worker crash
            self.handleError(record)

    def close(self) -> None:
        with self._lock:
            if self._fh:
                self._fh.close()
                self._fh = None
        super().close()


def setup(log_dir: Path, prefix: str = "worker", level: int = logging.INFO) -> logging.Logger:
    # konsol Windows sering cp1252 → paksa utf-8 supaya "…" / huruf aneh tidak bikin crash
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except Exception:
            pass
    root = logging.getLogger(_root_name)
    root.setLevel(level)
    root.propagate = False
    for h in list(root.handlers):
        root.removeHandler(h)
    fmt = logging.Formatter(FMT, "%Y-%m-%d %H:%M:%S")
    con = logging.StreamHandler(sys.stdout)
    con.setFormatter(logging.Formatter("%(asctime)s %(message)s", "%H:%M:%S"))
    fh = DailyFileHandler(log_dir, prefix)
    fh.setFormatter(fmt)
    root.addHandler(con)
    root.addHandler(fh)
    # log library yang cerewet cukup level WARNING
    for noisy in ("httpx", "httpcore", "urllib3", "numba", "matplotlib", "faster_whisper", "huggingface_hub", "filelock"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    return root


def get(name: str) -> logging.Logger:
    return logging.getLogger(f"{_root_name}.{name}")
