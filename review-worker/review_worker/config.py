"""Pengaturan dari review-worker/.env (pemilik: worker-inti). Nama env persis: KONTRAK.md §3.3.

Kunci (SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, GOOGLE_DRIVE_API_KEY) hanya di .env laptop; ANTHROPIC_API_KEY TIDAK disalin ke
Cfg (SDK anthropic membacanya sendiri dari environment) — Cfg cuma tahu ada / tidak. Password DB replika TIDAK pernah dibaca:
libpq memakai PGHOST/PGPORT/PGDATABASE/PGUSER/PGSSLMODE + %APPDATA%\\postgresql\\pgpass.conf sendiri.
"""
from __future__ import annotations

import io
import os
import re
import secrets
import socket
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent  # folder review-worker/
REPO = ROOT.parent  # root repo website
# env PG* yang boleh diisi di .env (password TIDAK termasuk — PGPASSWORD di .env dibuang dengan peringatan)
PG_ENV = ("PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGSSLMODE")
_INVISIBLE = "﻿​‌‍⁠ "


def _env(name: str, d: str = "") -> str:
    return "".join(ch for ch in (os.environ.get(name) or "") if ch not in _INVISIBLE).strip().strip("'\"").strip() or d


def _int(name: str, d: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(float(_env(name, str(d)).replace(",", ".")))))
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


def clean_supabase_url(raw: str) -> str:
    """rapikan SUPABASE_URL yang ditempel manual (pola voice-worker): kutip, karakter tak terlihat, [teks](url), <url>, tanpa https://"""
    s = "".join(ch for ch in (raw or "") if ch not in _INVISIBLE).strip().strip("'\"").strip()
    s = re.sub(r"^(NEXT_PUBLIC_)?SUPABASE_URL\s*=\s*", "", s, flags=re.I)
    m = re.search(r"\]\((https?://[^)\s]+)\)", s)
    if m:
        s = m.group(1)
    s = s.strip("<>[]() ").rstrip("/")
    if s and not re.match(r"^https?://", s, re.I):
        s = "https://" + s.lstrip("/")
    return s


def url_problem(url: str) -> Optional[str]:
    """None kalau SUPABASE_URL terlihat benar; selain itu pesan awam"""
    if not url:
        return None
    if not re.match(r"^https?://[A-Za-z0-9.-]+(:\d+)?(/.*)?$", url):
        return f"SUPABASE_URL tidak valid. Isi persis seperti: SUPABASE_URL=https://xxxxxxxx.supabase.co"
    low = url.lower()
    if low.startswith("https://eyj") or low.startswith("https://sb_"):
        return "SUPABASE_URL berisi kunci, bukan alamat. Sepertinya baris SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY tertukar."
    return None


def read_env_text(env_file: Path) -> tuple[Optional[str], str]:
    """isi .env apa pun cara menyimpannya (UTF-8 ± BOM, UTF-16 ber-BOM, cadangan ANSI cp1252) → (teks, nama encoding bukan UTF-8)"""
    try:
        raw = env_file.read_bytes()
    except OSError:
        return None, ""
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            return raw.decode("utf-16"), "UTF-16"
        except UnicodeDecodeError:
            pass
    try:
        return raw.decode("utf-8-sig"), ""
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace"), "ANSI"


@dataclass
class Cfg:
    root: Path = ROOT
    data: Path = ROOT / "data"
    tmp: Path = ROOT / "data" / "tmp"  # video sementara (dihapus sesudah tiap video)
    logs: Path = ROOT / "data" / "logs"
    laporan: Path = ROOT / "data" / "laporan"
    materi: Path = ROOT / "data" / "materi"  # cache materi referensi per campaign + sidik jari
    kolom_file: Path = ROOT / "kolom.toml"
    supabase_url: str = ""
    service_key: str = field(default="", repr=False)
    worker_id: str = ""
    anthropic_key_ada: bool = False
    model: str = "claude-haiku-5-5"
    effort: str = "medium"
    daily_budget_usd: float = 2.0
    min_confidence: int = 70
    kurs_idr: float = 18000.0
    video_per_hari: int = 2000
    dl_rate: str = "4M"
    dl_max_mb: int = 200
    dl_jeda_detik: float = 3.0
    frames_min: int = 6
    frames_max: int = 10
    frame_sisi: int = 768
    whisper_model: str = "large-v3-turbo"
    whisper_device: str = "auto"
    whisper_compute: str = "int8_float16"
    whisper_cache: Optional[Path] = None
    ocr: str = "easyocr"
    musik: str = "panako"
    demucs: bool = False
    java: str = ""
    panako_jar: str = ""
    gdrive_api_key_ada: bool = False
    materi_max_mb: int = 300
    pseudonym_salt: str = field(default="", repr=False)
    heartbeat_sec: float = 20.0
    poll_sec: float = 5.0
    # --- tambahan worker-inti (opsional untuk modul lain)
    rubrik: str = ""  # REVIEW_RUBRIK (kosong = versi terbaru di rubrik/)
    sample_hari: int = 120  # rentang sampel uji bawaan: 120 hari terakhir …
    sample_jeda_hari: int = 2  # … sampai 2 hari lalu (banding sempat selesai)
    replika_tunggu_menit: int = 30  # VPN putus saat uji → coba lagi tiap 60 dtk selama ini
    idle_lepas_menit: int = 10  # model ASR/OCR dilepas sesudah menganggur selama ini (VRAM 8 GB)
    env_file: Optional[Path] = None
    env_note: str = ""  # .env bukan UTF-8 / berisi PGPASSWORD → ditulis sekali ke log
    pg_dari_env: dict = field(default_factory=dict)  # nama env PG* → asal ("windows" / ".env"); NILAI tidak disimpan

    def missing(self) -> list[str]:
        """env wajib yang masih kosong (untuk mode antrian: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)"""
        out = []
        if not self.supabase_url:
            out.append("SUPABASE_URL")
        if not self.service_key:
            out.append("SUPABASE_SERVICE_ROLE_KEY")
        return out

    def ada_supabase(self) -> bool:
        return not self.missing() and url_problem(self.supabase_url) is None

    def ensure_dirs(self) -> None:
        for d in (self.data, self.tmp, self.logs, self.laporan, self.materi):
            d.mkdir(parents=True, exist_ok=True)


def _salt(data: Path) -> str:
    """REVIEW_PSEUDONYM_SALT, kosong → dibuat sekali di data/salt.txt (pseudonim reviewer stabil antar sesi di laptop ini)"""
    s = _env("REVIEW_PSEUDONYM_SALT")
    if s:
        return s
    f = data / "salt.txt"
    try:
        old = f.read_text(encoding="utf-8").strip()
        if len(old) >= 16:
            return old
    except OSError:
        pass
    s = secrets.token_hex(16)
    try:
        f.write_text(s + "\n", encoding="utf-8")
    except OSError:
        pass
    return s


def _whisper_cache() -> Optional[Path]:
    """REVIEW_WHISPER_CACHE, kosong → pakai ulang cache HuggingFace voice-worker (model whisper sudah terunduh di sana)"""
    v = _env("REVIEW_WHISPER_CACHE")
    if v:
        return Path(v).expanduser()
    vw = REPO / "voice-worker" / "data" / "hf" / "hub"
    return vw if vw.is_dir() else None


def _pilih(name: str, d: str, boleh: tuple[str, ...]) -> str:
    v = _env(name, d).lower()
    return v if v in boleh else d


def load(env_file: Optional[Path] = None) -> Cfg:
    """baca .env (UTF-8 / UTF-8 BOM / UTF-16 / ANSI seperti voice-worker), buat folder data/, isi worker_id
    ("review-<nama laptop>") dan pseudonym_salt (REVIEW_PSEUDONYM_SALT; kosong → dibuat sekali, disimpan data/salt.txt)."""
    env_file = env_file or ROOT / ".env"
    asal_pg = {k: "windows" for k in PG_ENV if os.environ.get(k)}  # env sistem menang atas .env (override=False)
    text, enc = read_env_text(env_file)
    notes = []
    if text is not None:
        try:
            from dotenv import dotenv_values

            vals = dotenv_values(stream=io.StringIO(text))
        except ImportError:  # python-dotenv belum terpasang → pembaca sederhana KEY=VALUE
            vals = {}
            for line in text.splitlines():
                m = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
                if m and not line.lstrip().startswith("#"):
                    vals[m.group(1)] = m.group(2).split(" #")[0].strip().strip("'\"")
        if vals.get("PGPASSWORD"):
            notes.append("PGPASSWORD di .env DIABAIKAN — password DB hanya boleh di %APPDATA%\\postgresql\\pgpass.conf.")
        for k, v in vals.items():
            if k == "PGPASSWORD" or v is None or str(v).strip() == "":
                continue
            if k not in os.environ:
                os.environ[k] = str(v)
                if k in PG_ENV:
                    asal_pg[k] = ".env"
    if enc:
        notes.append(f"File .env tersimpan sebagai {enc}, bukan UTF-8 — tetap dibaca. Supaya aman: Notepad → Simpan Sebagai → Encoding UTF-8.")

    data = Path(_env("REVIEW_DATA_DIR") or ROOT / "data").expanduser().resolve()
    data.mkdir(parents=True, exist_ok=True)
    # cache HuggingFace sendiri (model OCR / whisper kalau cache voice-worker tidak ada); harus sebelum huggingface_hub di-import
    os.environ.setdefault("HF_HOME", str(data / "hf"))
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    effort = _pilih("REVIEW_EFFORT", "medium", ("low", "medium", "high", "xhigh", "max"))
    cfg = Cfg(
        root=ROOT,
        data=data,
        tmp=data / "tmp",
        logs=data / "logs",
        laporan=data / "laporan",
        materi=data / "materi",
        kolom_file=Path(_env("REVIEW_KOLOM") or ROOT / "kolom.toml").expanduser(),
        supabase_url=clean_supabase_url(_env("SUPABASE_URL") or _env("NEXT_PUBLIC_SUPABASE_URL")),
        service_key=_env("SUPABASE_SERVICE_ROLE_KEY"),
        worker_id=(_env("REVIEW_WORKER_ID") or f"review-{socket.gethostname().lower()}")[:60],
        anthropic_key_ada=bool(_env("ANTHROPIC_API_KEY")),
        model=_env("REVIEW_MODEL", "claude-haiku-5-5"),
        effort=effort,
        daily_budget_usd=_float("REVIEW_DAILY_BUDGET_USD", 2.0, 0.0, 1000.0),
        min_confidence=_int("REVIEW_MIN_CONFIDENCE", 70, 0, 100),
        kurs_idr=_float("REVIEW_KURS_IDR", 18000.0, 1.0, 1_000_000.0),
        video_per_hari=_int("REVIEW_VIDEO_PER_HARI", 2000, 1, 1_000_000),
        dl_rate=_env("REVIEW_DL_RATE", "4M"),
        dl_max_mb=_int("REVIEW_DL_MAX_MB", 200, 5, 4000),
        dl_jeda_detik=_float("REVIEW_DL_JEDA", 3.0, 0.0, 600.0),
        whisper_model=_env("REVIEW_WHISPER_MODEL", "large-v3-turbo"),
        whisper_device=_pilih("REVIEW_WHISPER_DEVICE", "auto", ("auto", "cuda", "cpu")),
        whisper_compute=_env("REVIEW_WHISPER_COMPUTE", "int8_float16"),
        whisper_cache=_whisper_cache(),
        ocr=_pilih("REVIEW_OCR", "easyocr", ("easyocr", "mati")),
        musik=_pilih("REVIEW_MUSIK", "panako", ("panako", "olaf", "chroma", "mati")),
        demucs=_bool("REVIEW_DEMUCS", False),
        java=_env("REVIEW_JAVA"),
        panako_jar=_env("REVIEW_PANAKO_JAR"),
        gdrive_api_key_ada=bool(_env("GOOGLE_DRIVE_API_KEY")),
        materi_max_mb=_int("REVIEW_MATERI_MAX_MB", 300, 10, 5000),
        pseudonym_salt=_salt(data),
        heartbeat_sec=_float("REVIEW_HEARTBEAT_SEC", 20.0, 5.0, 300.0),
        poll_sec=_float("REVIEW_POLL_SEC", 5.0, 1.0, 120.0),
        rubrik=_env("REVIEW_RUBRIK"),
        sample_hari=_int("REVIEW_SAMPEL_HARI", 120, 7, 3650),
        sample_jeda_hari=_int("REVIEW_SAMPEL_JEDA_HARI", 2, 0, 60),
        env_file=env_file,
        env_note=" ".join(notes),
        pg_dari_env=asal_pg,
    )
    cfg.ensure_dirs()
    return cfg
