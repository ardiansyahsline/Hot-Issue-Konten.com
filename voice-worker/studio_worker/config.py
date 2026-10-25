"""Pengaturan worker dari voice-worker/.env (contoh lengkap: .env.example).

Dipanggil PALING AWAL (sebelum numpy/torch di-import) supaya batas thread CPU & folder cache model berlaku.
"""
from __future__ import annotations

import os
import socket
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # folder voice-worker
REPO = ROOT.parent  # root repo website


def _env(name: str, d: str = "") -> str:
    return (os.environ.get(name) or d).strip()


def _int(name: str, d: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(float(_env(name, str(d))))))
    except ValueError:
        return d


def _float(name: str, d: float, lo: float, hi: float) -> float:
    try:
        return max(lo, min(hi, float(_env(name, str(d)).replace(",", "."))))
    except ValueError:
        return d


def _bool(name: str, d: bool) -> bool:
    v = _env(name).lower()
    return d if not v else v in ("1", "true", "ya", "yes", "on")


@dataclass
class Config:
    supabase_url: str
    service_key: str
    worker_id: str
    repo: Path
    data: Path
    engine_order: list[str]
    chatterbox_repo: str
    chatterbox_base_repo: str
    chatterbox_dir: str
    chatterbox_lang: str
    pocket_repo: str
    pocket_config: str
    hf_token: str
    whisper_model: str
    whisper_device: str
    cpu_threads: int
    poll_sec: float
    heartbeat_sec: float
    render: bool
    render_concurrency: int
    render_timeout_min: int
    df_atten_db: float
    takes: int
    preload: bool
    idle_unload_min: int
    freesound_key: str
    sfx_dir: str

    @property
    def cache(self) -> Path:
        return self.data / "cache"

    @property
    def logs(self) -> Path:
        return self.data / "logs"

    @property
    def tmp(self) -> Path:
        return self.data / "tmp"

    @property
    def models(self) -> Path:
        return self.data / "models"

    def missing(self) -> list[str]:
        out = []
        if not self.supabase_url:
            out.append("SUPABASE_URL")
        if not self.service_key:
            out.append("SUPABASE_SERVICE_ROLE_KEY")
        return out

    def ensure_dirs(self) -> None:
        for d in (self.cache, self.logs, self.tmp, self.models):
            d.mkdir(parents=True, exist_ok=True)


def apply_thread_limits(n: int) -> None:
    """batasi thread CPU (laptop juga dipakai bot WAHA) — harus sebelum numpy/torch di-import"""
    for k in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "NUMBA_NUM_THREADS"):
        os.environ[k] = str(n)
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def load(env_file: Path | None = None) -> Config:
    try:
        from dotenv import load_dotenv

        load_dotenv(env_file or ROOT / ".env", override=False)
    except ImportError:  # python-dotenv belum terpasang: pakai env sistem saja
        pass

    data = Path(_env("DATA_DIR") or ROOT / "data").expanduser().resolve()
    threads = _int("CPU_THREADS", max(2, min(4, (os.cpu_count() or 4) // 2)), 1, 64)
    apply_thread_limits(threads)
    # cache model HuggingFace di voice-worker/data/hf (gampang dicek & dihapus)
    os.environ.setdefault("HF_HOME", str(data / "hf"))
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    hf_token = _env("HF_TOKEN")
    if hf_token:
        os.environ.setdefault("HF_TOKEN", hf_token)

    order = [e.strip().lower() for e in _env("ENGINE_ORDER", "chatterbox,pocket").split(",")]
    order = [e for e in order if e in ("chatterbox", "pocket")] or ["chatterbox", "pocket"]

    cfg = Config(
        supabase_url=(_env("SUPABASE_URL") or _env("NEXT_PUBLIC_SUPABASE_URL")).rstrip("/"),
        service_key=_env("SUPABASE_SERVICE_ROLE_KEY"),
        worker_id=_env("WORKER_ID") or f"laptop-{socket.gethostname().lower()}"[:60],
        repo=Path(_env("REPO_DIR") or REPO).expanduser().resolve(),
        data=data,
        engine_order=order,
        chatterbox_repo=_env("CHATTERBOX_REPO", "grandhigh/Chatterbox-TTS-Indonesian"),
        chatterbox_base_repo=_env("CHATTERBOX_BASE_REPO", "ResembleAI/chatterbox"),
        chatterbox_dir=_env("CHATTERBOX_DIR"),
        chatterbox_lang=_env("CHATTERBOX_LANG", "id"),
        pocket_repo=_env("POCKET_REPO", "tryzz889/pocket-tts-indonesian"),
        pocket_config=_env("POCKET_CONFIG"),
        hf_token=hf_token,
        whisper_model=_env("WHISPER_MODEL", "small"),
        whisper_device=_env("WHISPER_DEVICE", "auto").lower(),
        cpu_threads=threads,
        poll_sec=_float("POLL_SEC", 5, 1, 120),
        heartbeat_sec=_float("HEARTBEAT_SEC", 20, 5, 300),
        render=_bool("RENDER_ENABLED", True),
        render_concurrency=_int("RENDER_CONCURRENCY", 2, 1, 8),
        render_timeout_min=_int("RENDER_TIMEOUT_MIN", 40, 5, 240),
        df_atten_db=_float("DF_ATTEN_DB", 18, 6, 30),
        takes=_int("TAKES", 2, 1, 4),
        preload=_bool("PRELOAD", False),
        idle_unload_min=_int("IDLE_UNLOAD_MIN", 0, 0, 1440),
        freesound_key=_env("FREESOUND_API_KEY"),
        sfx_dir=_env("SFX_DIR", r"C:\Konten.com\STUDIO-FX"),
    )
    cfg.ensure_dirs()
    return cfg
