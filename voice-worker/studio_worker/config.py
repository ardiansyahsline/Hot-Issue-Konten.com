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
    # bitrate video saat encode NVENC (NVENC tidak memakai CRF), format Remotion: angka + K/M. 5M ≈ ukuran CRF 18 lama (teaser 60 dtk
    # ±3,4 Mbps): 10M membuat MP4 2–3× lebih besar → video 60 dtk ±77 MB lewat batas upload Supabase gratis 50 MB, >165 dtk lewat MAX_UPLOAD 200 MB
    render_bitrate: str = "5M"
    # --- CEPAT ---
    # transformer Chatterbox: auto (bf16 kalau GPU mendukung) / bf16 / fp32
    tts_dtype: str = "auto"
    # versi (takes) satu potongan dibuat sekaligus dalam satu batch GPU (0 = satu-satu)
    tts_batch: bool = True
    # beam faster-whisper untuk cek tiap take (timestamp kata baris final tetap beam 5)
    asr_beam_takes: int = 1
    # batas waktu membuat versi per potongan = max(LINE_BUDGET_MIN, LINE_BUDGET_PER_SEC × perkiraan detik ucapan)
    line_budget_per_sec: float = 8.0
    line_budget_min: float = 20.0
    # --- UNDUH ---
    # model diunduh di depan (SIAPKAN-MODEL.bat / install.ps1 / latar), TIDAK PERNAH di tengah job
    download_connections: int = 8  # koneksi paralel per file (GitHub ±115 KB/s per koneksi → 8× lebih cepat)
    utmos_urls: tuple[str, ...] = ()  # mirror checkpoint UTMOS (dicoba sebelum GitHub); boleh hf://pemilik/repo/file.pt
    auto_download: bool = True  # model yang kurang diunduh di thread latar saat worker hidup (job tidak menunggu)
    # --- /UNDUH ---
    # --- RENDER-CEPAT ---
    # RENDER_CONCURRENCY=auto (bawaan): tab dihitung dari thread CPU & RAM (render_tabs); angka di .env = dipakai apa adanya
    render_conc_auto: bool = True
    render_conc_info: str = ""  # untuk log "Render: N tab paralel (<info>)"
    # pesan sekali untuk log saat worker mulai: "RENDER_CONCURRENCY=2" bawaan lama di .env ditulis ulang jadi auto (migrate_env)
    env_migrated: str = ""
    env_file: Path | None = None  # .env yang dibaca load() (dipakai migrate_env)
    conc_sysenv: bool = False  # RENDER_CONCURRENCY dari env sistem (bukan .env) → migrasi .env tidak mengubah jumlah tab

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


def load(env_file: Path | None = None, migrate: bool = False) -> Config:
    """migrate=True = langsung migrate_env() (tes). worker.py memanggil migrate_env() sendiri SESUDAH kunci satu-instance."""
    env_file = env_file or ROOT / ".env"
    pre_conc = os.environ.get("RENDER_CONCURRENCY")  # dari env sistem (bukan .env) → tidak disentuh migrasi
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
    # --- UNDUH --- (harus sebelum huggingface_hub di-import: nilainya dibaca sekali saat import)
    os.environ.setdefault("HF_XET_HIGH_PERFORMANCE", "1")  # unduhan Xet (HF) memakai banyak koneksi sekaligus
    os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "60")  # bawaan 10 dtk terlalu pendek untuk internet yang tersendat
    os.environ.setdefault("HF_HUB_ETAG_TIMEOUT", "20")
    # --- /UNDUH ---

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
        render_concurrency=2,  # diisi di bawah (RENDER-CEPAT)
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
        # --- CEPAT ---
        tts_dtype=_env("TTS_DTYPE", "auto").lower() if _env("TTS_DTYPE", "auto").lower() in ("auto", "bf16", "fp32") else "auto",
        tts_batch=_bool("TTS_BATCH", True),
        asr_beam_takes=_int("ASR_BEAM_TAKES", 1, 1, 5),
        line_budget_per_sec=_float("LINE_BUDGET_PER_SEC", 8.0, 1.0, 60.0),
        line_budget_min=_float("LINE_BUDGET_MIN", 20.0, 5.0, 600.0),
        # --- UNDUH ---
        download_connections=_int("DOWNLOAD_CONNECTIONS", 8, 1, 32),
        utmos_urls=tuple(u.strip() for u in re.split(r"[,\s]+", _env("UTMOS_URLS")) if u.strip()),
        auto_download=_bool("AUTO_DOWNLOAD", True),
        # --- /UNDUH ---
    )
    # --- RENDER-GPU ---
    cfg.render_gpu = render_gpu_mode(_env("RENDER_GPU", "auto"))
    cfg.render_bitrate = render_bitrate(_env("RENDER_BITRATE", "5M"))
    # --- RENDER-CEPAT ---
    cfg.env_file, cfg.conc_sysenv = env_file, pre_conc is not None
    set_render_tabs(cfg, _env("RENDER_CONCURRENCY", "auto"))
    if migrate:
        migrate_env(cfg)
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
    """RENDER_BITRATE → format yang diterima Remotion (angka + "K"/"k"/"M"): "10m" / "10 Mbps" / "10" → "10M"; salah → "5M" (bawaan)"""
    m = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*([kKmM])?\s*(?:b|bps|bit/?s)?\s*", raw or "", re.I)
    if not m or float(m.group(1).replace(",", ".")) <= 0:
        return "5M"
    num = m.group(1).replace(",", ".")
    unit = (m.group(2) or "M").upper()
    return f"{num}{unit}"


# --- RENDER-CEPAT ---
# tab Chrome render paralel untuk RENDER_CONCURRENCY=auto (bawaan): separuh thread CPU (sisanya untuk bot WAHA & worker), 2..6,
# lalu dibatasi RAM total: RAM_RESERVE_GB untuk Windows + bot WAHA + mesin suara + Remotion/ffmpeg, tiap tab ±TAB_GB
TABS_MIN, TABS_MAX = 2, 6
# diukur (teaser 1080×1920, Chrome tanpa GPU): tiap tab tambahan ±0,17 GB PSS (2 tab 1,03 GB → 4 tab 1,36 GB). 0,7 GB = cadangan
# untuk timeline berisi video / gambar besar
TAB_GB = 0.7
RAM_RESERVE_GB = 6.0


def total_ram_gb() -> float | None:
    """RAM total (GB) tanpa paket tambahan: Windows GlobalMemoryStatusEx (ctypes), Linux/mac os.sysconf; gagal → None"""
    try:
        if os.name == "nt":
            import ctypes

            class _Mem(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong)] + [
                    (n, ctypes.c_ulonglong) for n in ("total", "avail", "page_t", "page_a", "virt_t", "virt_a", "ext_a")
                ]

            m = _Mem()
            m.dwLength = ctypes.sizeof(_Mem)
            if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m)):
                return None
            return m.total / 1024**3 or None
        return (os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")) / 1024**3 or None
    except (AttributeError, OSError, ValueError, TypeError):
        return None


def render_tabs(cpus: int, ram_gb: float | None) -> int:
    """jumlah tab render untuk auto: min(separuh thread CPU dalam 2..6, tab yang muat di RAM); RAM tak terbaca → CPU saja.
    RAM sangat kecil (< ±7,4 GB) → bisa 1 tab supaya laptop tidak kehabisan memori."""
    n = min(TABS_MAX, max(TABS_MIN, int(cpus or 4) // 2))
    if ram_gb and ram_gb > 0:
        n = min(n, int((ram_gb - RAM_RESERVE_GB) / TAB_GB))
    return max(1, n)


def auto_render_concurrency(cpus: int | None = None, ram_gb: float | None = None) -> int:
    """RENDER_CONCURRENCY=auto → render_tabs() untuk laptop ini (cpus / ram_gb kosong = dibaca dari sistem)"""
    return render_tabs(cpus if cpus is not None else (os.cpu_count() or 4), ram_gb if ram_gb is not None else total_ram_gb())


def _tabs_fixed(raw: str) -> int | None:
    """RENDER_CONCURRENCY dari .env: angka → 1..8 (dihormati); kosong / auto / salah ketik → None (= auto)"""
    v = (raw or "").strip().lower()
    if v in ("", "auto", "otomatis"):
        return None
    try:
        return max(1, min(8, int(float(v.replace(",", ".")))))
    except ValueError:
        return None


def set_render_tabs(cfg: Config, raw: str) -> None:
    """RENDER_CONCURRENCY (raw) → cfg.render_concurrency / render_conc_auto / render_conc_info"""
    fixed = _tabs_fixed(raw)
    if fixed is None:
        cpus, ram = os.cpu_count() or 4, total_ram_gb()
        cfg.render_concurrency = render_tabs(cpus, ram)
        cfg.render_conc_auto = True
        cfg.render_conc_info = f"auto: {cpus} thread, " + (f"{ram:.1f} GB RAM".replace(".", ",") if ram else "RAM tidak terbaca")
    else:
        cfg.render_concurrency, cfg.render_conc_auto, cfg.render_conc_info = fixed, False, f"RENDER_CONCURRENCY={fixed} di .env"


def migrate_env(cfg: Config) -> str:
    """worker.py main() SESUDAH kunci satu-instance (proses kedua yang langsung berhenti tidak menulis .env): .env lama dirapikan
    sekali (migrate_render_concurrency) lalu jumlah tab dihitung ulang (auto) kecuali RENDER_CONCURRENCY dari env sistem.
    Balikan pesan satu baris untuk log ("" = tidak ada yang diubah); juga disimpan di cfg.env_migrated."""
    if cfg.env_file is None:
        return ""
    msg = migrate_render_concurrency(cfg.env_file)
    if not msg:
        return ""
    if not cfg.conc_sysenv:  # "2" tadi dari .env = bawaan lama → auto (juga kalau .env tidak bisa ditulis ulang)
        os.environ["RENDER_CONCURRENCY"] = "auto"
        set_render_tabs(cfg, "auto")
    cfg.env_migrated = f"{msg} → sekarang {cfg.render_concurrency} tab render paralel ({cfg.render_conc_info})."
    return cfg.env_migrated


# migrasi .env lama: "RENDER_CONCURRENCY=2" disalin install.ps1 dari .env.example versi dulu = BAWAAN lama (bukan pilihan pemakai)
_OLD_CONC_COMMENT = "# tab Chrome render paralel: angka 1-8, atau auto = setengah jumlah core CPU (2-4). Bawaan 2"
CONC_COMMENT = "# tab Chrome render paralel: auto (bawaan) = sesuai thread CPU & RAM laptop (2-6), atau angka tetap 1-8"


def migrate_render_concurrency(env_file: Path) -> str:
    """sekali saja: .env yang berisi baris persis "RENDER_CONCURRENCY=2" (satu-satunya baris RENDER_CONCURRENCY) dan belum punya
    komentar baru → baris itu jadi "RENDER_CONCURRENCY=auto" + komentar baru (komentar lama tepat di atasnya diganti; kalau tidak ada,
    komentar baru disisipkan). Sisa file, akhir baris CRLF/LF & BOM tidak berubah. Angka lain / sudah dimigrasi → tidak diubah.
    Balikan pesan untuk log ("" = tidak ada yang diubah)."""
    try:
        raw = env_file.read_bytes()
        bom = raw.startswith(b"\xef\xbb\xbf")
        text = raw[3:].decode("utf-8") if bom else raw.decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return ""
    if CONC_COMMENT in text:
        return ""
    lines = text.splitlines(keepends=True)
    body = [ln.rstrip("\r\n") for ln in lines]
    conc = [i for i, ln in enumerate(body) if re.match(r"\s*RENDER_CONCURRENCY\s*=", ln)]
    if len(conc) != 1 or body[conc[0]].rstrip() != "RENDER_CONCURRENCY=2":
        return ""
    i = conc[0]
    eol = "\r\n" if "\r\n" in text else "\n"
    end = lines[i][len(body[i]):]  # akhir baris itu sendiri ("" kalau baris terakhir tanpa enter)
    new = ["RENDER_CONCURRENCY=auto" + end]
    if i > 0 and body[i - 1].strip() == _OLD_CONC_COMMENT:
        lines[i - 1] = CONC_COMMENT + (lines[i - 1][len(body[i - 1]):] or eol)
    else:
        new.insert(0, CONC_COMMENT + eol)
    lines[i : i + 1] = new
    out = ("\ufeff" if bom else "") + "".join(lines)
    tmp = env_file.with_name(env_file.name + ".baru")
    try:
        tmp.write_bytes(out.encode("utf-8"))
        os.replace(tmp, env_file)
    except OSError as e:
        try:
            tmp.unlink()
        except OSError:
            pass
        return f"RENDER_CONCURRENCY=2 di .env adalah bawaan lama → dipakai auto (file .env tidak bisa ditulis: {e})"
    return "RENDER_CONCURRENCY=2 di .env adalah bawaan lama → diganti jadi RENDER_CONCURRENCY=auto (mau angka tetap? tulis angkanya di .env)"
