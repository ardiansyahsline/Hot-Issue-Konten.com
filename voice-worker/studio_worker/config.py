"""Pengaturan worker dari voice-worker/.env (contoh lengkap: .env.example).

Dipanggil PALING AWAL (sebelum numpy/torch di-import) supaya batas thread CPU & folder cache model berlaku.
"""
from __future__ import annotations

import os
import re
import socket
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # folder voice-worker
REPO = ROOT.parent  # root repo website


def _env(name: str, d: str = "") -> str:
    return (os.environ.get(name) or d).strip()


_INVISIBLE = "\ufeff\u200b\u200c\u200d\u2060\u00a0"


def clean_supabase_url(raw: str) -> str:
    """rapikan SUPABASE_URL yang ditempel manual: buang spasi/kutip/karakter tak terlihat, format link markdown
    `[teks](url)` / `<url>`, lalu tambah https:// kalau lupa. Kosong tetap kosong (dilaporkan oleh missing())."""
    s = "".join(ch for ch in (raw or "") if ch not in _INVISIBLE).strip().strip("'\"").strip()
    s = re.sub(r"^(NEXT_PUBLIC_)?SUPABASE_URL\s*=\s*", "", s, flags=re.I)  # nama variabel tertulis dua kali
    m = re.search(r"\]\((https?://[^)\s]+)\)", s)  # [https://x.supabase.co](https://x.supabase.co)
    if m:
        s = m.group(1)
    s = s.strip("<>[]() ").rstrip("/")
    if s and not re.match(r"^https?://", s, re.I):
        s = "https://" + s.lstrip("/")
    return s


def url_problem(url: str) -> str | None:
    """None kalau SUPABASE_URL terlihat benar; selain itu pesan bahasa awam untuk ditampilkan saat start"""
    if not url:
        return None
    if not re.match(r"^https?://[A-Za-z0-9.-]+(:\d+)?(/.*)?$", url):
        return f"SUPABASE_URL tidak valid ({url[:60]!r}). Isi persis seperti: SUPABASE_URL=https://xxxxxxxx.supabase.co"
    if url.lower().startswith("https://eyj") or url.lower().startswith("https://sb_"):
        return "SUPABASE_URL berisi kunci, bukan alamat. Sepertinya baris SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY tertukar."
    host = re.sub(r"^https?://", "", url, flags=re.I).split("/")[0].split(":")[0]
    labels = host.split(".")
    if len(host) > 253 or any(not lb or len(lb) > 63 for lb in labels) or "http" in host.lower():
        return f"SUPABASE_URL tidak valid ({url[:60]!r}…). Isi persis seperti: SUPABASE_URL=https://xxxxxxxx.supabase.co (satu alamat saja, tanpa kunci)"
    return None


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
    render_browser: str
    df_atten_db: float
    takes: int
    preload: bool
    idle_unload_min: int
    freesound_key: str
    sfx_dir: str
    # skor kealamian UTMOS saat memilih take (NATURAL_MOS=0 → hanya kejelasan + nada)
    natural_mos: bool = True
    # --- RUNTIME --- (alur worker: unggah paralel, log bersih)
    # jumlah unggahan ke Supabase Storage yang jalan bersamaan (mp3 per baris diunggah sementara baris berikutnya dibuat)
    upload_workers: int = 3
    # 1 = sembunyikan peringatan library yang tidak penting (FutureWarning torch, "forcing EOS" Chatterbox, progress bar);
    # 0 = semua tampil (untuk mencari masalah)
    quiet_log: bool = True
    # "PRELOAD=0" dari .env lama (nilai bawaan dulu) diabaikan → dicatat di log saat worker mulai
    preload_old_default: bool = False
    # --- RENDER-GPU ---
    # render MP4 di GPU NVIDIA: auto (ada NVIDIA → Chrome render ke NVIDIA + --gl=angle + encode NVENC) | nvidia (paksa) | off (seperti dulu)
    render_gpu: str = "auto"
    # bitrate video saat encode NVENC (NVENC tidak memakai CRF), format Remotion: angka + K/M
    render_bitrate: str = "10M"

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


# --- RUNTIME ---
# .env lama = salinan .env.example versi dulu: "PRELOAD=0" persis di bawah komentar bawaannya adalah NILAI BAWAAN LAMA (bukan pilihan
# pemakai) → dianggap kosong supaya bawaan baru berlaku (1 = mesin dipanaskan di latar saat worker mulai, job pertama tidak menunggu
# muat model ±30 dtk). Yang memang ingin mematikan: ubah jadi PRELOAD=mati (atau hapus komentar bawaan di atasnya).
_OLD_PRELOAD = "# muat model suara saat worker mulai (1) atau saat job pertama (0)\nPRELOAD=0"


def _preload(env_file: Path) -> tuple[bool, bool]:
    """(PRELOAD, True kalau "PRELOAD=0" bawaan .env lama diabaikan)"""
    if _env("PRELOAD") == "0":
        try:
            txt = env_file.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
        except OSError:
            txt = ""
        if _OLD_PRELOAD in txt:
            return True, True
    return _bool("PRELOAD", True), False


def load(env_file: Path | None = None) -> Config:
    env_file = env_file or ROOT / ".env"
    try:
        from dotenv import load_dotenv

        load_dotenv(env_file, override=False)
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

    preload, preload_old = _preload(env_file)
    order = [e.strip().lower() for e in _env("ENGINE_ORDER", "chatterbox,pocket").split(",")]
    order = [e for e in order if e in ("chatterbox", "pocket")] or ["chatterbox", "pocket"]

    cfg = Config(
        supabase_url=clean_supabase_url(_env("SUPABASE_URL") or _env("NEXT_PUBLIC_SUPABASE_URL")),
        service_key="".join(ch for ch in _env("SUPABASE_SERVICE_ROLE_KEY") if ch not in _INVISIBLE).strip().strip("'\"").strip(),
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
        render_browser=_env("REMOTION_BROWSER"),
        df_atten_db=_float("DF_ATTEN_DB", 18, 6, 30),
        takes=_int("TAKES", 3, 1, 4),
        preload=preload,
        idle_unload_min=_int("IDLE_UNLOAD_MIN", 0, 0, 1440),
        freesound_key=_env("FREESOUND_API_KEY"),
        sfx_dir=_env("SFX_DIR", r"C:\Konten.com\STUDIO-FX"),
        natural_mos=_bool("NATURAL_MOS", True),
        # --- RUNTIME ---
        upload_workers=_int("UPLOAD_WORKERS", 3, 1, 8),
        quiet_log=_bool("QUIET_LOG", True),
        preload_old_default=preload_old,
    )
    # --- RENDER-GPU ---
    cfg.render_gpu = render_gpu_mode(_env("RENDER_GPU", "auto"))
    cfg.render_bitrate = render_bitrate(_env("RENDER_BITRATE", "10M"))
    if _env("RENDER_CONCURRENCY").lower() == "auto":  # _int() di atas memberi 2 untuk "auto" → diganti sesuai jumlah core
        cfg.render_concurrency = auto_render_concurrency()
    cfg.ensure_dirs()
    return cfg


# --- RENDER-GPU ---
def render_gpu_mode(raw: str) -> str:
    """RENDER_GPU → "auto" | "nvidia" | "off" (salah ketik → auto)"""
    v = (raw or "").strip().lower()
    if v in ("off", "0", "mati", "false", "no", "tidak", "cpu"):
        return "off"
    if v in ("nvidia", "paksa", "force", "nvenc"):
        return "nvidia"
    return "auto"


def render_bitrate(raw: str) -> str:
    """RENDER_BITRATE → format yang diterima Remotion (angka + "K"/"k"/"M"): "10m" / "10 Mbps" / "10" → "10M"; salah → "10M" """
    m = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*([kKmM])?\s*(?:b|bps|bit/?s)?\s*", raw or "", re.I)
    if not m or float(m.group(1).replace(",", ".")) <= 0:
        return "10M"
    num = m.group(1).replace(",", ".")
    unit = (m.group(2) or "M").upper()
    return f"{num}{unit}"


def auto_render_concurrency(cpus: int | None = None) -> int:
    """RENDER_CONCURRENCY=auto → tab Chrome render paralel = setengah core CPU, 2..4 (laptop juga dipakai bot WAHA)"""
    n = cpus if cpus is not None else (os.cpu_count() or 4)
    return min(4, max(2, n // 2))
