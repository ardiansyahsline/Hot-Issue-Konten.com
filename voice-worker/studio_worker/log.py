"""Log ke konsol + file harian voice-worker/data/logs/worker-YYYY-MM-DD.log (disimpan 14 hari).

Log bersih (QUIET_LOG=1, bawaan): quiet() dipanggil worker.py PALING AWAL (sebelum torch / transformers / chatterbox di-import)
menyembunyikan peringatan library yang tidak penting — FutureWarning / DeprecationWarning / UserWarning dari torch, torchaudio,
transformers, diffusers, perth (pkg_resources), librosa, DeepFilterNet, dsb.; pesan Chatterbox per kalimat ("EOS token detected",
"Detected 2x repetition", "forcing EOS"); progress bar tqdm / unduhan HuggingFace. Peringatan & error dari kode worker (logger "vw.*")
SELALU tampil. QUIET_LOG=0 = semua tampil lagi (untuk mencari masalah).
"""
from __future__ import annotations

import logging
import os
import re
import sys
import threading
import time
import warnings
from datetime import date
from pathlib import Path

FMT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"
_root_name = "vw"

# ---------------------------------------------------------------- log bersih
# library yang peringatannya (FutureWarning / DeprecationWarning / UserWarning) tidak berguna untuk pemakai worker
QUIET_MODULES = (
    "torch", "torchaudio", "torchvision", "transformers", "diffusers", "perth", "resemble_perth", "pkg_resources", "setuptools",
    "librosa", "audioread", "df", "deepfilternet", "chatterbox", "s3tokenizer", "conformer", "faster_whisper", "ctranslate2",
    "huggingface_hub", "safetensors", "tokenizers", "numba", "pyloudnorm", "pocket_tts", "sentencepiece", "onnxruntime",
)
QUIET_MODULE_RE = r"^(%s)(\.|$)" % "|".join(re.escape(m) for m in QUIET_MODULES)
# peringatan library yang tercatat atas nama pemanggilnya (stacklevel) — dikenali dari isi pesannya
QUIET_MESSAGES = (
    r"weight_norm", r"torch\.nn\.utils", r"pkg_resources", r"torchaudio", r"torchcodec", r"LoRACompatible", r"`?torch\.cuda\.amp",
    r"TypedStorage", r"sdp_kernel", r"attn_implementation", r"past_key_values", r"output_attentions", r"`?resume_download`?",
    r"PySoundFile failed", r"audioread", r"Torch was not compiled with flash attention", r"The attention mask",
)
QUIET_CATEGORIES = (FutureWarning, DeprecationWarning, PendingDeprecationWarning, UserWarning)
# pesan logger library yang muncul tiap kalimat / tiap muat model dan tidak perlu ditindaklanjuti
NOISE = re.compile(
    r"EOS token detected|Detected \d+x repetition|forcing EOS|Reference mel length is not equal|"
    r"is using \w*SdpaAttention|does not support `output_attentions=True`|Setting `pad_token_id`|"
    r"get chunk_masks all false|Audio values outside normalized range|not available - \w+ text processing skipped|"
    r"not available - Chinese segmentation"
)
# logger library yang cukup level ERROR saat log bersih
QUIET_LOGGERS = ("chatterbox", "transformers", "diffusers", "perth", "df", "s3tokenizer", "pocket_tts", "librosa", "numba", "torch._dynamo", "torch._inductor")
_QUIET = {"on": False}


class NoiseFilter(logging.Filter):
    """buang pesan library yang cerewet (NOISE) — pesan logger worker ("vw.*") tidak pernah dibuang"""

    def filter(self, record: logging.LogRecord) -> bool:
        if not _QUIET["on"] or record.name == _root_name or record.name.startswith(_root_name + "."):
            return True
        try:
            msg = record.getMessage()
        except Exception:
            return True
        return not NOISE.search(msg)


def quiet(enabled: bool = True) -> bool:
    """
    nyalakan log bersih untuk PROSES WORKER (dipanggil sekali sebelum library berat di-import; siapkan_model tidak memanggil ini,
    jadi progres unduhannya tetap tampil). enabled=False (QUIET_LOG=0) → tidak ada yang disembunyikan. Balikan status.
    """
    _QUIET["on"] = bool(enabled)
    if not enabled:
        return False
    # progress bar per langkah ("Sampling" Chatterbox, unduhan HF) & verbositas library — harus sebelum library di-import
    for k, v in (
        ("TQDM_DISABLE", "1"),
        ("HF_HUB_DISABLE_PROGRESS_BARS", "1"),
        ("TRANSFORMERS_VERBOSITY", "error"),
        ("DIFFUSERS_VERBOSITY", "error"),
        ("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1"),
    ):
        os.environ.setdefault(k, v)
    for cat in QUIET_CATEGORIES:
        warnings.filterwarnings("ignore", category=cat, module=QUIET_MODULE_RE)
        for pat in QUIET_MESSAGES:
            warnings.filterwarnings("ignore", message=f".*{pat}", category=cat)
    for name in QUIET_LOGGERS:
        logging.getLogger(name).setLevel(logging.ERROR)
    # library yang sudah ter-import lebih dulu (mis. lewat tes) ikut disenyapkan lewat API-nya sendiri
    for mod in ("transformers", "diffusers"):
        m = sys.modules.get(mod)
        try:
            if m is not None:
                m.logging.set_verbosity_error()  # type: ignore[attr-defined]
        except Exception:
            pass
    return True


def is_quiet() -> bool:
    return bool(_QUIET["on"])


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
        if s is None:  # pythonw.exe (Task Scheduler) tidak punya konsol
            continue
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
    noise = NoiseFilter()
    if sys.stdout is not None:
        con = logging.StreamHandler(sys.stdout)
        con.setFormatter(logging.Formatter("%(asctime)s %(message)s", "%H:%M:%S"))
        con.addFilter(noise)
        root.addHandler(con)
    fh = DailyFileHandler(log_dir, prefix)
    fh.setFormatter(fmt)
    fh.addFilter(noise)  # QUIET_LOG=0 → filter ini meloloskan semua
    root.addHandler(fh)
    # peringatan dari library (torch, chatterbox, pocket-tts, …) ikut masuk file log
    lib = logging.getLogger()
    lib.setLevel(logging.WARNING)
    if not any(isinstance(h, DailyFileHandler) for h in lib.handlers):
        lib.addHandler(fh)
    # log library yang cerewet cukup level WARNING
    for noisy in ("httpx", "httpcore", "urllib3", "numba", "matplotlib", "faster_whisper", "huggingface_hub", "filelock"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    return root


def get(name: str) -> logging.Logger:
    return logging.getLogger(f"{_root_name}.{name}")
