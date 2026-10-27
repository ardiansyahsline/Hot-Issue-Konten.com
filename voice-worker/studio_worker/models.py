"""
Model yang dipakai worker — dicek & diunduh DI DEPAN (SIAPKAN-MODEL.bat / install.ps1 / thread latar), TIDAK PERNAH di tengah job.

Dulu tiap model diunduh saat pertama kali dipakai = di tengah job VO (UTMOS 392 MB dari GitHub ±115 KB/s → job tertahan ±1 jam).
Sekarang:
  - runtime hanya mencari file LOKAL (hf_local / *_ready / deepfilter_dir). Belum ada → komponen itu dilewati dulu (UTMOS → take
    dipilih dari ASR + nada; DeepFilterNet → pembersih ffmpeg; whisper → cek audio saja; chatterbox → mesin cadangan) dan worker
    mengunduhnya di latar lewat PROSES ANAK `siapkan_model.py --latar --hanya <nama>` per model (tidak menahan job & bisa
    dihentikan kapan saja — thread unduhan huggingface_hub tidak bisa dihentikan dari thread lain), lalu note_result().
  - prepare() mengunduh yang kurang: HuggingFace lewat snapshot_download (max_workers = DOWNLOAD_CONNECTIONS, Xet mode cepat,
    timeout 60 dtk, diulang 3×), file GitHub (UTMOS, DeepFilterNet3) lewat unduh.fetch (multi-koneksi, bisa dilanjutkan, cek isi).
    Mirror UTMOS (UTMOS_URLS, boleh hf://pemilik/repo/file.pt) dicoba sebelum GitHub.

Letak file (harus sama dengan yang dicari library-nya):
  - chatterbox / pocket : cache HuggingFace (HF_HOME = data/hf → data/hf/hub/models--…)
  - whisper            : data/models/whisper/models--Systran--faster-whisper-<ukuran> (WhisperModel(download_root=…))
  - deepfilter         : appdirs user_cache_dir("DeepFilterNet")/DeepFilterNet3 (folder bawaan df.enhance.maybe_download_model)
  - utmos              : data/models/torch-hub/tarepan_SpeechMOS_v1.2.0 (kode, nama folder ala torch.hub)
                         + data/models/torch-hub/checkpoints/utmos22_strong_step7459_v1.pt (load_state_dict_from_url)
"""
from __future__ import annotations

import fnmatch
import json
import os
import re
import shutil
import sys
import threading
import time
import zipfile
from pathlib import Path
from typing import Callable

from . import log as vlog
from . import unduh

log = vlog.get("model")

NAMES = ("chatterbox", "whisper", "deepfilter", "utmos", "pocket")
# untuk tabel SIAPKAN-MODEL: (keterangan, perkiraan ukuran MB)
INFO = {
    "chatterbox": ("mesin suara utama (GPU)", 3100),
    "whisper": ("cek ucapan (faster-whisper)", 480),
    "deepfilter": ("pembersih rekaman (DeepFilterNet3)", 9),
    "utmos": ("penilai kealamian (UTMOS, opsional)", 392),
    "pocket": ("mesin cadangan CPU (pocket-tts)", 500),
}
RECHECK_SEC = 60.0  # komponen "belum diunduh" dicek ulang (murah, hanya cek file) tiap 60 dtk
HF_TRIES = 3
HF_WAIT = 5.0  # jeda dasar antar percobaan unduh HF (5, 10 dtk)

UTMOS_REPO = "tarepan/SpeechMOS:v1.2.0"
UTMOS_ENTRY = "utmos22_strong"
UTMOS_FOLDER = "tarepan_SpeechMOS_v1.2.0"  # nama folder buatan torch.hub: <pemilik>_<repo>_<tag>
UTMOS_CKPT = "utmos22_strong_step7459_v1.pt"
# ukuran & sha256 checkpoint asli (diukur dari GitHub Releases tarepan/SpeechMOS v1.0.0, isinya state dict UTMOS22 strong
# 102,8 jt parameter). Mirror mana pun harus menghasilkan file yang persis sama — beda ukuran langsung ditolak sebelum diunduh.
UTMOS_SIZE = 411179119
UTMOS_SHA256 = "38aa51ab79e2a4e09a1449758a4b37e9cbb2e8235a49662a732d33a9ba1e9bff"
UTMOS_GITHUB = "https://github.com/tarepan/SpeechMOS/releases/download/v1.0.0/utmos22_strong_step7459_v1.pt"
UTMOS_REPO_URLS = [
    "https://github.com/tarepan/SpeechMOS/zipball/v1.2.0",
    "https://codeload.github.com/tarepan/SpeechMOS/zip/refs/tags/v1.2.0",
]
DF_NAME = "DeepFilterNet3"
DF_URLS = ["https://github.com/Rikorose/DeepFilterNet/raw/main/models/DeepFilterNet3.zip"]
# sama dengan faster_whisper.utils._MODELS / download_model(allow_patterns) versi 1.2.1 (salinan supaya cek status tidak perlu
# meng-import faster_whisper + ctranslate2 yang berat)
WHISPER_REPOS = {
    "tiny.en": "Systran/faster-whisper-tiny.en", "tiny": "Systran/faster-whisper-tiny",
    "base.en": "Systran/faster-whisper-base.en", "base": "Systran/faster-whisper-base",
    "small.en": "Systran/faster-whisper-small.en", "small": "Systran/faster-whisper-small",
    "medium.en": "Systran/faster-whisper-medium.en", "medium": "Systran/faster-whisper-medium",
    "large-v1": "Systran/faster-whisper-large-v1", "large-v2": "Systran/faster-whisper-large-v2",
    "large-v3": "Systran/faster-whisper-large-v3", "large": "Systran/faster-whisper-large-v3",
    "distil-large-v2": "Systran/faster-distil-whisper-large-v2", "distil-medium.en": "Systran/faster-distil-whisper-medium.en",
    "distil-small.en": "Systran/faster-distil-whisper-small.en", "distil-large-v3": "Systran/faster-distil-whisper-large-v3",
    "distil-large-v3.5": "distil-whisper/distil-large-v3.5-ct2",
    "large-v3-turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo", "turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
}
WHISPER_FILES = ["config.json", "preprocessor_config.json", "model.bin", "tokenizer.json", "vocabulary.*"]
CANGJIE = ("ResembleAI/chatterbox", "Cangjie5_TC.json")  # dibaca tokenizer multilingual Chatterbox (hf_hub_download)

_PREP_LOCK = threading.Lock()
_state: dict = {"active": None, "pct": {}, "fail": {}, "gen": 0, "bg": None, "every": 2.0}


# ---------------------------------------------------------------- bantu
def _say(log_fn: Callable[[str], None] | None) -> Callable[[str], None]:
    return log_fn if log_fn is not None else log.info


def _short(e: BaseException, n: int = 200) -> str:
    s = str(e).strip().splitlines()[0] if str(e).strip() else type(e).__name__
    return s[:n]


def _match(rel: str, patterns) -> bool:
    if not patterns:
        return True
    pats = [patterns] if isinstance(patterns, str) else list(patterns)
    return any(fnmatch.fnmatch(rel, p) for p in pats)


def _has_match(folder: Path, patterns) -> bool:
    try:
        for p in folder.rglob("*"):
            if p.is_file() and not p.name.endswith(".incomplete") and _match(p.relative_to(folder).as_posix(), patterns):
                return True
    except OSError:
        return False
    return False


def dir_bytes(path: Path | None) -> int | None:
    """ukuran isi folder/file (symlink HF diikuti)"""
    if path is None:
        return None
    p = Path(path)
    try:
        if p.is_file():
            return p.stat().st_size
        return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())
    except OSError:
        return None


def hf_cache_dir() -> Path:
    """folder cache HuggingFace yang dipakai snapshot_download tanpa cache_dir (HF_HUB_CACHE / HF_HOME/hub)"""
    if os.environ.get("HF_HUB_CACHE"):
        return Path(os.environ["HF_HUB_CACHE"]).expanduser()
    home = os.environ.get("HF_HOME") or str(Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "huggingface")
    return Path(home).expanduser() / "hub"


def _storage(repo: str, cache_dir: Path | None) -> Path:
    return (Path(cache_dir) if cache_dir else hf_cache_dir()) / ("models--" + repo.replace("/", "--"))


def _hf_local_manual(repo: str, patterns, cache_dir: Path | None) -> Path | None:
    """cari snapshot di cache tanpa huggingface_hub (venv tes ringan): refs/main → snapshots/<commit>"""
    st = _storage(repo, cache_dir)
    snaps = st / "snapshots"
    try:
        ref = (st / "refs" / "main").read_text(encoding="utf-8").strip()
        cand = [snaps / ref]
    except OSError:
        cand = sorted((p for p in snaps.iterdir() if p.is_dir()), key=lambda p: p.stat().st_mtime, reverse=True) if snaps.is_dir() else []
    for c in cand:
        if c.is_dir() and _has_match(c, patterns):
            return c
    return None


def hf_local(repo: str, patterns=None, token: str | None = None, *, cache_dir: Path | str | None = None) -> Path | None:
    """snapshot model HuggingFace yang SUDAH ada di laptop (local_files_only=True), atau None. TIDAK PERNAH mengunduh / menyentuh
    jaringan. `cache_dir` = folder cache lain (mis. data/models/whisper untuk faster-whisper)."""
    if not repo:
        return None
    cd = Path(cache_dir) if cache_dir else None
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        return _hf_local_manual(repo, patterns, cd)
    try:
        p = Path(snapshot_download(repo_id=repo, allow_patterns=patterns, local_files_only=True, token=token or None, cache_dir=str(cd) if cd else None))
    except Exception:
        return None
    return p if p.is_dir() and _has_match(p, patterns) else None


def hf_file_local(repo: str, filename: str, revision: str | None = None, token: str | None = None, *, cache_dir: Path | str | None = None) -> Path | None:
    """satu file HuggingFace yang sudah ada di cache, atau None — murni cek file. Sengaja TIDAK memakai
    hf_hub_download(local_files_only=True): di huggingface_hub 1.3x fungsi itu tetap menyusun header HTTP dan mendeteksi agen
    lewat jaringan (terbukti di selftest_unduh)."""
    cd = Path(cache_dir) if cache_dir else None
    try:
        from huggingface_hub import try_to_load_from_cache
    except ImportError:
        try_to_load_from_cache = None
    if try_to_load_from_cache is not None:
        try:
            r = try_to_load_from_cache(repo_id=repo, filename=filename, cache_dir=str(cd) if cd else None, revision=revision)
        except Exception:
            r = None
        return Path(r) if isinstance(r, str) and os.path.isfile(r) else None
    st = _storage(repo, cd)
    rev = revision or "main"
    if not re.fullmatch(r"[0-9a-f]{40}", rev):
        try:
            rev = (st / "refs" / rev).read_text(encoding="utf-8").strip()
        except OSError:
            return None
    p = st / "snapshots" / rev / filename
    return p if p.is_file() else None


def ready_gen() -> int:
    """naik tiap kali prepare berhasil menyiapkan model → komponen yang 'belum diunduh' boleh langsung cek ulang"""
    return int(_state["gen"])


# ---------------------------------------------------------------- chatterbox
def chatterbox_files(cfg) -> tuple[dict | None, str]:
    """
    komponen Chatterbox yang SUDAH lokal (tanpa jaringan): (dict hasil chatterbox_engine.scan + 'src', 'base', 'mode', alasan).
    Repo hanya-t3 → ve/s3gen/tokenizer diambil dari model dasar CHATTERBOX_BASE_REPO (kalau sudah diunduh). None = belum lengkap.
    """
    from .engines.chatterbox_engine import BASE_EN, BASE_MTL, PATTERNS, scan

    token = getattr(cfg, "hf_token", "") or None
    cdir = getattr(cfg, "chatterbox_dir", "") or ""
    if cdir:
        src = Path(cdir).expanduser()
        if not src.exists():
            return None, f"CHATTERBOX_DIR tidak ada: {src}"
    else:
        src = hf_local(cfg.chatterbox_repo, PATTERNS, token)
        if src is None:
            return None, "belum diunduh"
    f = scan(src)
    if not f["t3"]:
        return None, "bobot t3 belum ada (unduhan belum lengkap?)"
    f.update(src=src, base=None, mode="lengkap")
    if not (f["ve"] and f["s3gen"] and f["tok"]):
        base_repo = getattr(cfg, "chatterbox_base_repo", "") or "ResembleAI/chatterbox"
        b = hf_local(base_repo, BASE_MTL if f["mtl"] else BASE_EN, token)
        if b is None:
            return None, f"model dasar {base_repo} belum diunduh"
        bs = scan(b)
        for k in ("ve", "s3gen", "tok"):
            f[k] = f[k] or bs[k]
        f["conds"] = f["conds"] or bs.get("conds")
        if not (f["ve"] and f["s3gen"] and f["tok"]):
            return None, "komponen model dasar Chatterbox belum lengkap"
        f.update(base=b, mode="hanya-t3")
    return f, "siap"


def _prep_chatterbox(cfg, say, conns, stop, verify) -> str:
    from .engines.chatterbox_engine import BASE_EN, BASE_MTL, PATTERNS, scan

    if getattr(cfg, "chatterbox_dir", ""):
        f, why = chatterbox_files(cfg)
        return "siap" if f else f"gagal: {why}"
    token = getattr(cfg, "hf_token", "") or None
    src = _hf_get(cfg.chatterbox_repo, PATTERNS, token, label="Chatterbox", say=say, conns=conns, name="chatterbox")
    f = scan(src)
    if f["t3"] and not (f["ve"] and f["s3gen"] and f["tok"]):
        base = getattr(cfg, "chatterbox_base_repo", "") or "ResembleAI/chatterbox"
        say(f"Chatterbox: repo {cfg.chatterbox_repo} hanya berisi bobot t3 → unduh komponen lain dari {base}")
        _hf_get(base, BASE_MTL if f["mtl"] else BASE_EN, token, label="Chatterbox dasar", say=say, conns=conns, name="chatterbox")
    elif f["mtl"]:  # tokenizer multilingual membaca Cangjie5_TC.json dari repo dasar — disiapkan sekalian (kecil)
        try:
            from huggingface_hub import hf_hub_download

            hf_hub_download(repo_id=CANGJIE[0], filename=CANGJIE[1], token=token)
        except Exception as e:
            say(f"Chatterbox: {CANGJIE[1]} tidak terunduh ({_short(e, 120)}) — tidak wajib")
    f2, why = chatterbox_files(cfg)
    return "siap" if f2 else f"gagal: {why}"


# ---------------------------------------------------------------- whisper
def whisper_repo(cfg) -> str | None:
    """repo HF model faster-whisper dari WHISPER_MODEL (None kalau WHISPER_MODEL berupa folder lokal)"""
    m = (getattr(cfg, "whisper_model", "") or "small").strip()
    if os.path.isdir(m):
        return None
    if re.match(r".*/.*", m):
        return m
    if m in WHISPER_REPOS:
        return WHISPER_REPOS[m]
    try:  # nama baru yang belum ada di salinan daftar
        from faster_whisper.utils import _MODELS  # type: ignore[attr-defined]

        return _MODELS.get(m)
    except Exception:
        return None


def whisper_dir(cfg) -> Path:
    return Path(cfg.models) / "whisper"


def _whisper_complete(folder: Path) -> bool:
    return (folder / "model.bin").is_file() and (folder / "config.json").is_file() and (
        (folder / "tokenizer.json").is_file() or any(folder.glob("vocabulary.*"))
    )


def whisper_local(cfg) -> Path | None:
    """folder model faster-whisper yang sudah lengkap di laptop (persis yang dicari WhisperModel(download_root=…,
    local_files_only=True)), atau None"""
    m = (getattr(cfg, "whisper_model", "") or "small").strip()
    if os.path.isdir(m):
        return Path(m) if _whisper_complete(Path(m)) else None
    repo = whisper_repo(cfg)
    if not repo:
        return None
    p = hf_local(repo, WHISPER_FILES, getattr(cfg, "hf_token", "") or None, cache_dir=whisper_dir(cfg))
    return p if p is not None and _whisper_complete(p) else None


def whisper_ready(cfg) -> bool:
    return whisper_local(cfg) is not None


def _prep_whisper(cfg, say, conns, stop, verify) -> str:
    m = (getattr(cfg, "whisper_model", "") or "small").strip()
    if os.path.isdir(m):
        return "siap" if whisper_ready(cfg) else f"gagal: folder {m} tidak berisi model.bin/config.json"
    repo = whisper_repo(cfg)
    if not repo:
        return f"gagal: WHISPER_MODEL={m} tidak dikenal (tiny/base/small/medium/large-v3/…)"
    _hf_get(repo, WHISPER_FILES, getattr(cfg, "hf_token", "") or None, cache_dir=whisper_dir(cfg), label=f"Whisper {m}", say=say, conns=conns, name="whisper")
    return "siap" if whisper_ready(cfg) else "gagal: file model whisper belum lengkap"


# ---------------------------------------------------------------- DeepFilterNet3
def df_root() -> Path:
    """folder cache DeepFilterNet (sama dengan df.utils.get_cache_dir → appdirs user_cache_dir("DeepFilterNet"))"""
    try:
        from appdirs import user_cache_dir

        return Path(user_cache_dir("DeepFilterNet"))
    except ImportError:
        pass
    if os.name == "nt":  # rumus appdirs (appauthor = appname, opinion=True)
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / "DeepFilterNet" / "DeepFilterNet" / "Cache"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "DeepFilterNet"
    return Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "DeepFilterNet"


def _df_complete(d: Path) -> bool:
    ck = d / "checkpoints"
    return (d / "config.ini").is_file() and ck.is_dir() and any(p.is_file() and ".ckpt" in p.name for p in ck.iterdir())


def deepfilter_dir() -> Path | None:
    """folder model DeepFilterNet3 lokal kalau lengkap (config.ini + checkpoints/*.ckpt*), selain itu None"""
    d = df_root() / DF_NAME
    try:
        return d if _df_complete(d) else None
    except OSError:
        return None


def _extract(zip_path: Path, into: Path, marker: str) -> Path:
    """ekstrak zip ke folder sementara `into`, balikan folder yang berisi `marker` (zip GitHub punya 1 folder teratas)"""
    if into.exists():
        shutil.rmtree(into, ignore_errors=True)
    into.mkdir(parents=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(into)  # zipfile membuang path absolut / "..", jadi aman
    if (into / marker).exists():
        return into
    for d in sorted(p for p in into.iterdir() if p.is_dir()):
        if (d / marker).exists():
            return d
    raise unduh.DownloadError(f"isi zip tidak berisi {marker}")


def _swap_in(src: Path, final: Path) -> None:
    """pindahkan folder hasil ekstrak ke nama akhir (rename di disk yang sama = atomik)"""
    if final.exists():
        shutil.rmtree(final, ignore_errors=True)
    final.parent.mkdir(parents=True, exist_ok=True)
    os.replace(src, final)


def _prep_deepfilter(cfg, say, conns, stop, verify) -> str:
    if deepfilter_dir() is not None:
        return "siap"
    root = df_root()
    root.mkdir(parents=True, exist_ok=True)
    z = root / f"{DF_NAME}.zip"
    unduh.fetch(DF_URLS, z, connections=conns, label="DeepFilterNet3", log=say, check=unduh.zip_ok, stop=stop, every=_state["every"])
    tmp = root / f".{DF_NAME}.baru"
    try:
        src = _extract(z, tmp, "config.ini")
        _swap_in(src, root / DF_NAME)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        try:
            z.unlink()
        except OSError:
            pass
    return "siap" if deepfilter_dir() is not None else "gagal: isi model DeepFilterNet3 tidak lengkap"


# ---------------------------------------------------------------- UTMOS
def _hub(cfg_or_hub) -> Path:
    if isinstance(cfg_or_hub, (str, Path)):
        return Path(cfg_or_hub)
    return Path(cfg_or_hub.models) / "torch-hub"


def utmos_github_url(repo_dir: Path | None) -> str:
    """URL checkpoint yang tertulis di hubconf.py repo SpeechMOS (cadangan: alamat yang diketahui)"""
    try:
        txt = (Path(repo_dir) / "hubconf.py").read_text(encoding="utf-8", errors="replace") if repo_dir else ""
    except OSError:
        txt = ""
    m = re.search(r"https?://[^\s'\"]+\.pt\b", txt)
    return m.group(0) if m else UTMOS_GITHUB


def utmos_paths(cfg_or_hub) -> tuple[Path, Path]:
    """(folder kode SpeechMOS ala torch.hub, file checkpoint di <hub>/checkpoints/) — cfg atau folder hub langsung"""
    hub = _hub(cfg_or_hub)
    repo_dir = hub / UTMOS_FOLDER
    name = os.path.basename(utmos_github_url(repo_dir).split("?")[0]) or UTMOS_CKPT
    return repo_dir, hub / "checkpoints" / name


def utmos_ready(cfg_or_hub) -> bool:
    repo_dir, ckpt = utmos_paths(cfg_or_hub)
    try:
        return (repo_dir / "hubconf.py").is_file() and ckpt.is_file() and ckpt.stat().st_size > 0
    except OSError:
        return False


def hf_url(u: str) -> tuple[str, dict]:
    """hf://pemilik/repo/jalur/file.pt[@revisi] → URL resolve HuggingFace (+ header token kalau HF_TOKEN diisi)"""
    if not u.startswith("hf://"):
        return u, {}
    rest = u[5:]
    rev = "main"
    if "@" in rest:
        rest, rev = rest.rsplit("@", 1)
    parts = rest.split("/")
    if len(parts) < 3:
        raise ValueError(f"alamat {u} harus hf://pemilik/repo/file")
    ep = (os.environ.get("HF_ENDPOINT") or "https://huggingface.co").rstrip("/")
    tok = os.environ.get("HF_TOKEN") or ""
    return f"{ep}/{parts[0]}/{parts[1]}/resolve/{rev}/{'/'.join(parts[2:])}", ({"Authorization": f"Bearer {tok}"} if tok else {})


def _prep_utmos(cfg, say, conns, stop, verify) -> str:
    hub = _hub(cfg)
    hub.mkdir(parents=True, exist_ok=True)
    repo_dir, _ = utmos_paths(hub)
    if not (repo_dir / "hubconf.py").is_file():
        z = hub / "SpeechMOS-v1.2.0.zip"
        unduh.fetch(UTMOS_REPO_URLS, z, connections=conns, label="UTMOS (kode)", log=say, check=unduh.zip_ok, stop=stop, every=_state["every"])
        tmp = hub / ".SpeechMOS.baru"
        try:
            _swap_in(_extract(z, tmp, "hubconf.py"), repo_dir)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
            try:
                z.unlink()
            except OSError:
                pass
    repo_dir, ckpt = utmos_paths(hub)
    known = ckpt.name == UTMOS_CKPT  # file resmi → ukuran & sha256 dicek
    size, sha = (UTMOS_SIZE, UTMOS_SHA256) if known else (None, None)
    if ckpt.is_file() and verify:
        bad = unduh.torch_ckpt_ok(ckpt)
        if not bad and known and (ckpt.stat().st_size != size or unduh.sha256_file(ckpt) != sha):
            bad = "ukuran / sha256 tidak cocok"
        if bad:
            say(f"UTMOS: file lama rusak ({bad}) → diunduh ulang")
            ckpt.unlink()
    if ckpt.is_file():
        return "siap"
    urls = [*getattr(cfg, "utmos_urls", ()), utmos_github_url(repo_dir)]
    errs = []
    for u in dict.fromkeys(urls):  # urut: mirror dulu, GitHub terakhir (duplikat dibuang)
        try:
            url, hdr = hf_url(u)
        except ValueError as e:
            errs.append(str(e))
            continue
        try:
            unduh.fetch(url, ckpt, size=size, sha256=sha, connections=conns, label="UTMOS", log=say, headers=hdr, check=unduh.torch_ckpt_ok, stop=stop, every=_state["every"])
            return "siap" if utmos_ready(hub) else "gagal: file UTMOS tidak lengkap"
        except unduh.DownloadCancelled:
            raise
        except unduh.DownloadError as e:
            errs.append(f"{unduh._host(url)}: {_short(e, 160)}")
            if u != urls[-1]:
                say(f"UTMOS: sumber {unduh._host(url)} gagal → coba sumber berikutnya")
    return "gagal: " + "; ".join(errs)[:300]


# ---------------------------------------------------------------- pocket-tts
def _pocket_marker(cfg) -> Path:
    return Path(cfg.models) / "pocket" / "siap.json"


def pocket_ready(cfg) -> bool:
    """snapshot repo + file hf:// yang dirujuk config pocket sudah disiapkan prepare (dicatat di data/models/pocket/siap.json)"""
    try:
        m = json.loads(_pocket_marker(cfg).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    src = getattr(cfg, "pocket_config", "") or getattr(cfg, "pocket_repo", "")
    if m.get("src") != src:
        return False
    return all(Path(p).exists() for p in m.get("files", [])) and bool(m.get("files"))


def _prep_pocket(cfg, say, conns, stop, verify) -> str:
    from .engines import pocket_engine as pe

    token = getattr(cfg, "hf_token", "") or None
    out_dir = Path(cfg.models) / "pocket"
    out_dir.mkdir(parents=True, exist_ok=True)
    ymls: list[Path] = []
    files: list[str] = []
    if getattr(cfg, "pocket_config", ""):
        y = pe.fetch_ref(cfg.pocket_config, token) if "://" in cfg.pocket_config else Path(cfg.pocket_config)
        ymls.append(Path(y))
        files.append(str(y))
    else:
        snap = _hf_get(cfg.pocket_repo, pe.PATTERNS, token, label="pocket-tts", say=say, conns=conns, name="pocket")
        files.append(str(snap))
        try:
            from pocket_tts.utils.config import CONFIGS_DIR

            ymls = [y for _, y in pe.candidates(snap, Path(CONFIGS_DIR), out_dir)]
        except ImportError as e:
            return f"gagal: paket pocket-tts belum terpasang ({e})"
    ok_any, errs, tried = False, [], set()
    for y in ymls:
        for ref in pe.refs_of(y):
            if ref in tried:
                continue
            tried.add(ref)
            try:
                files.append(str(pe.fetch_ref(ref, token)))
            except Exception as e:  # mis. repo bergerbang (butuh login HF) — config lain mungkin tetap bisa
                errs.append(f"{ref.split('@')[0][-60:]}: {_short(e, 80)}")
        ok_any = ok_any or not pe.localize_yaml(y, out_dir)[1]
    if errs:
        say("pocket-tts: sebagian file tidak terunduh (tidak semua wajib): " + " | ".join(errs[:3]))
    if not ok_any:
        return "gagal: " + ("; ".join(errs)[:300] or "config pocket-tts tidak ditemukan")
    m = {"src": getattr(cfg, "pocket_config", "") or cfg.pocket_repo, "files": sorted(set(files)), "at": int(time.time())}
    tmp = _pocket_marker(cfg).with_suffix(".tmp")
    tmp.write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, _pocket_marker(cfg))
    return "siap"


# ---------------------------------------------------------------- unduhan HuggingFace (dengan baris progres)
class _FolderMeter(threading.Thread):
    """progres unduhan HF dari bertambahnya isi folder cache (berlaku untuk semua versi huggingface_hub, unduhan http maupun Xet)"""

    def __init__(self, folder: Path, label: str, need: int | None, say, name: str | None):
        super().__init__(daemon=True, name="unduh-hf-progres")
        self.folder, self.say, self.key = folder, say, name
        self.base = self.bytes()
        self.meter = unduh.Meter(label, need, self._emit)
        self.halt = threading.Event()

    def bytes(self) -> int:
        n = 0
        try:
            for root, _dirs, fs in os.walk(self.folder):
                for f in fs:
                    p = os.path.join(root, f)
                    try:
                        if not os.path.islink(p):  # Linux: snapshot = symlink ke blob (jangan dihitung dua kali)
                            n += os.path.getsize(p)
                    except OSError:
                        pass
        except OSError:
            pass
        return n

    def _emit(self, line: str) -> None:
        m = re.search(r"\s(\d+)%", line)
        if m and self.key:
            _state["pct"][self.key] = int(m.group(1))
        self.say(line)

    def run(self) -> None:
        while not self.halt.wait(float(_state["every"])):
            done = max(0, self.bytes() - self.base)
            if done or self.meter.total:
                self.meter.tick(done, force=True)

    def stop(self) -> None:
        self.halt.set()


def _snap_dir(repo: str, cache_dir: Path | None, commit: str | None) -> Path | None:
    """folder snapshot revisi `commit` di cache (tanpa commit: revisi refs/main) — hanya menyusun jalur, tidak menyentuh jaringan"""
    st = _storage(repo, cache_dir)
    rev = (commit or "").strip()
    if not rev:
        try:
            rev = (st / "refs" / "main").read_text(encoding="utf-8").strip()
        except OSError:
            return None
    return st / "snapshots" / rev if rev else None


def _hf_need(repo: str, patterns, token, cache_dir) -> int | None:
    """
    jumlah byte yang masih perlu diunduh (perkiraan; untuk progres saja): file yang lolos pola tapi BELUM ada di folder snapshot
    revisi terbaru. Dicek langsung per file — BUKAN lewat hf_local(repo, None): snapshot_download(local_files_only, tanpa pola)
    menuntut SEMUA file repo ada (README, .gitattributes, … yang memang tidak pernah diunduh), jadi model yang sudah lengkap pun
    dulu terhitung "mengunduh ±3 GB" + baris progres 0% palsu.
    """
    try:
        from huggingface_hub import HfApi
        from huggingface_hub.utils import filter_repo_objects

        info = HfApi().model_info(repo, files_metadata=True, token=token or None)
        sibs = list(filter_repo_objects(items=list(info.siblings or []), allow_patterns=patterns, key=lambda s: s.rfilename))
        snap = _snap_dir(repo, cache_dir, getattr(info, "sha", None))
        need = 0
        for s in sibs:
            if snap is not None and (snap / s.rfilename).is_file():
                continue
            need += int(getattr(s, "size", 0) or 0)
        return need
    except Exception:
        return None


def _interruptible(fn, *a, **kw):
    """
    jalankan fn di thread daemon & tunggu dengan join bertimeout: Ctrl+C sampai di thread utama dalam ±0,2 dtk (juga di Windows,
    tempat menunggu kunci tanpa batas waktu tidak bisa diinterupsi) — dulu Ctrl+C di SIAPKAN-MODEL baru terasa setelah file yang
    sedang diunduh huggingface_hub selesai. Unduhan yang sedang jalan dibiarkan; siapkan_model lalu keluar seketika (os._exit) dan
    HuggingFace melanjutkan file .incomplete lain kali.
    """
    box: dict = {}

    def run() -> None:
        try:
            box["v"] = fn(*a, **kw)
        except BaseException as e:  # noqa: BLE001  (diteruskan ke pemanggil apa adanya)
            box["e"] = e

    t = threading.Thread(target=run, daemon=True, name="unduh-hf")
    t.start()
    while t.is_alive():
        t.join(0.2)
    if "e" in box:
        raise box["e"]
    return box.get("v")


def _hf_get(repo: str, patterns, token, *, label: str, say, conns: int, cache_dir: Path | None = None, name: str | None = None) -> Path:
    """snapshot_download dengan banyak koneksi (max_workers), diulang 3× dengan jeda; balikan folder snapshot"""
    from huggingface_hub import snapshot_download

    try:
        from huggingface_hub.utils import disable_progress_bars

        disable_progress_bars()  # bar tqdm HF diganti baris progres kita (log bersih)
    except Exception:
        pass
    need = _hf_need(repo, patterns, token, cache_dir)
    if need == 0:
        p = hf_local(repo, patterns, token, cache_dir=cache_dir)
        if p is not None:
            return p
    if need:
        say(f"{label}: mengunduh ±{unduh.fmt_size(need)} dari HuggingFace ({repo}, {conns} koneksi)…")
    else:
        say(f"{label}: mengecek / mengunduh {repo} dari HuggingFace…")
    mon = _FolderMeter(_storage(repo, cache_dir), label, need or None, say, name)
    mon.start()
    t0 = time.monotonic()
    try:
        for attempt in range(1, HF_TRIES + 1):
            try:
                p = Path(_interruptible(snapshot_download, repo_id=repo, allow_patterns=patterns, token=token or None, cache_dir=str(cache_dir) if cache_dir else None, max_workers=max(1, conns)))
                break
            except KeyboardInterrupt:
                raise
            except Exception as e:
                fatal = type(e).__name__ in ("RepositoryNotFoundError", "GatedRepoError", "RevisionNotFoundError")
                if attempt >= HF_TRIES or fatal:
                    local = hf_local(repo, patterns, token, cache_dir=cache_dir) if need is None and not fatal else None
                    if local is not None:  # HF tidak bisa dihubungi tapi salinan lokal ada → pakai itu
                        say(f"{label}: HuggingFace tidak bisa dihubungi ({_short(e, 100)}) — pakai salinan yang sudah ada di laptop")
                        p = local
                        break
                    raise
                wait = HF_WAIT * attempt
                say(f"{label}: unduhan terputus ({_short(e, 140)}) — dilanjutkan lagi dalam {wait:g} dtk ({attempt}/{HF_TRIES})")
                time.sleep(wait)
    finally:
        mon.stop()
    got = max(0, mon.bytes() - mon.base)
    if got > 1024 * 1024:
        dt = max(0.001, time.monotonic() - t0)
        say(f"{label}  selesai · {unduh.fmt_size(got)} dalam {unduh.fmt_eta(dt)} ({unduh.fmt_rate(got / dt)})")
    return p


# ---------------------------------------------------------------- status
def relevant(cfg) -> list[str]:
    """model yang dipakai dengan pengaturan sekarang (urut penting)"""
    order = list(getattr(cfg, "engine_order", ["chatterbox", "pocket"]) or [])
    out = []
    if "chatterbox" in order:
        out.append("chatterbox")
    out += ["whisper", "deepfilter"]
    if getattr(cfg, "natural_mos", True):
        out.append("utmos")
    if "pocket" in order:
        out.append("pocket")
    return out


def required(cfg) -> list[str]:
    """wajib supaya worker berguna: mesin suara utama (urutan pertama ENGINE_ORDER) + cek ucapan"""
    order = list(getattr(cfg, "engine_order", ["chatterbox"]) or ["chatterbox"])
    return [order[0], "whisper"]


def _check(cfg, name: str) -> tuple[bool, str, Path | None]:
    try:
        if name == "chatterbox":
            f, why = chatterbox_files(cfg)
            return (f is not None, why, f["src"] if f else None)
        if name == "whisper":
            p = whisper_local(cfg)
            return (p is not None, "siap" if p else "belum diunduh", p)
        if name == "deepfilter":
            p = deepfilter_dir()
            return (p is not None, "siap" if p else "belum diunduh", p)
        if name == "utmos":
            ok = utmos_ready(cfg)
            return (ok, "siap" if ok else "belum diunduh", utmos_paths(cfg)[1] if ok else None)
        if name == "pocket":
            ok = pocket_ready(cfg)
            snap = hf_local(cfg.pocket_repo, None, getattr(cfg, "hf_token", "") or None) if ok and not getattr(cfg, "pocket_config", "") else None
            return (ok, "siap" if ok else "belum diunduh", snap)
    except Exception as e:  # cek status tidak boleh bikin worker error
        return (False, f"tidak bisa dicek: {_short(e, 120)}", None)
    return (False, "tidak dikenal", None)


def is_ready(cfg, name: str) -> bool:
    return _check(cfg, name)[0]


def status(cfg) -> dict[str, dict]:
    """status lengkap per model (untuk tabel SIAPKAN-MODEL): {nama: {ready, why, path, bytes, need, info, est_mb}}"""
    out = {}
    rel = relevant(cfg)
    for n in NAMES:
        ok, why, path = _check(cfg, n) if n in rel else (False, "tidak dipakai", None)
        out[n] = {"ready": ok, "why": why, "path": str(path) if path else None, "bytes": dir_bytes(path) if ok and path else None,
                  "need": n in rel, "info": INFO[n][0], "est_mb": INFO[n][1]}
    return out


def status_brief(cfg) -> dict[str, str]:
    """ringkas & cepat (hanya cek file) untuk detak jantung: {"chatterbox": "siap", "utmos": "belum diunduh", …}"""
    out = {}
    for n in relevant(cfg):
        ok, why, _ = _check(cfg, n)
        if ok:
            out[n] = "siap"
        elif _state["active"] == n:
            pct = _state["pct"].get(n)
            out[n] = f"mengunduh {pct}%" if pct is not None else "mengunduh"
        elif n in _state["fail"]:
            out[n] = f"gagal unduh: {_state['fail'][n][:80]}"
        else:
            out[n] = why if why != "siap" else "belum diunduh"
    if not getattr(cfg, "natural_mos", True):
        out["utmos"] = "mati"
    return out


def missing(cfg) -> list[str]:
    """nama model yang belum ada lokal, urut penting: chatterbox, whisper, deepfilter, utmos, pocket (hanya yang dipakai)"""
    return [n for n in relevant(cfg) if not is_ready(cfg, n)]


def downloading() -> str | None:
    return _state["active"]


# ---------------------------------------------------------------- siapkan
_PREP = {"chatterbox": _prep_chatterbox, "whisper": _prep_whisper, "deepfilter": _prep_deepfilter, "utmos": _prep_utmos, "pocket": _prep_pocket}
_REFRESH = {"utmos": "natural", "deepfilter": "clean"}


def _refresh(name: str) -> None:
    """komponen yang tadinya 'belum diunduh' di proses ini langsung dipakai lagi (tanpa menunggu cek ulang 60 dtk)"""
    mod = sys.modules.get(f"{__package__}.{_REFRESH.get(name, '')}") if name in _REFRESH else None
    fn = getattr(mod, "refresh", None) if mod else None
    if callable(fn):
        try:
            fn()
        except Exception:
            pass


def prepare(cfg, names: list[str] | None = None, log: Callable[[str], None] | None = None, *, stop: threading.Event | None = None, verify: bool = False, every: float = 2.0) -> dict[str, str]:
    """
    Unduh model yang belum ada (names=None → semua yang kurang, urut penting). Balikan {nama: "siap" | "gagal: …"}.
    verify=True: model yang sudah ada ikut dicek ulang (snapshot HF dilengkapi, checkpoint UTMOS dicek CRC-nya).
    Aman dipanggil dari thread latar (satu prepare berjalan pada satu waktu; pemanggil kedua menunggu). Ctrl+C →
    KeyboardInterrupt diteruskan (bagian yang sudah terunduh disimpan, lanjut lain kali). `every` = jarak baris progres (dtk).
    """
    say = _say(log)
    conns = int(getattr(cfg, "download_connections", 8) or 8)
    out: dict[str, str] = {}
    with _PREP_LOCK:
        _state["every"] = max(0.5, float(every))
        want = [n for n in (names if names is not None else missing(cfg)) if n in _PREP]
        for n in want:
            if stop is not None and stop.is_set():
                out[n] = "gagal: dihentikan"
                continue
            if not verify and is_ready(cfg, n):
                out[n] = "siap"
                continue
            _state["active"] = n
            _state["pct"].pop(n, None)
            t0 = time.monotonic()
            try:
                res = _PREP[n](cfg, say, conns, stop, verify)
            except KeyboardInterrupt:
                _state["active"] = None
                raise
            except unduh.DownloadCancelled:
                res = "gagal: dihentikan (dilanjutkan lain kali)"
            except Exception as e:
                res = f"gagal: {_short(e)}"
            finally:
                _state["active"] = None
            out[n] = res
            note_result(n, res)
            if res == "siap":
                if time.monotonic() - t0 > 1:
                    say(f"Model {n} siap.")
            else:
                say(f"Model {n} belum siap — {res}")
    return out


def note_result(name: str, res: str) -> None:
    """
    catat hasil menyiapkan satu model di proses INI: "siap" → komponen yang tadinya 'belum diunduh' langsung cek ulang (ready_gen naik
    + refresh); "gagal: …" → status_brief menulis "gagal unduh: …". Dipakai prepare() sendiri dan worker yang mengunduh lewat proses
    anak (siapkan_model.py --latar): filenya ditulis proses lain, jadi proses worker perlu diberi tahu.
    """
    if res == "siap":
        _state["fail"].pop(name, None)
        _state["gen"] += 1
        _refresh(name)
    else:
        _state["fail"][name] = str(res).removeprefix("gagal: ")


def start_background(cfg, names: list[str] | None = None, log: Callable[[str], None] | None = None, on_done: Callable[[dict], None] | None = None, stop: threading.Event | None = None) -> threading.Thread | None:
    """jalankan prepare() di thread latar (job tidak menunggu; baris progres tiap 15 dtk supaya log worker tidak penuh).
    Sudah ada yang berjalan → None. `stop` diset → berhenti di antara model / unduhan GitHub (unduhan HuggingFace yang sedang
    berjalan TIDAK bisa dihentikan dari thread — karena itu worker sendiri memakai proses anak siapkan_model.py --latar)."""
    t = _state.get("bg")
    if t is not None and t.is_alive():
        return None

    def run() -> None:
        try:
            res = prepare(cfg, names, log, stop=stop, every=15.0)
        except Exception as e:  # thread latar tidak boleh menjatuhkan worker
            res = {"_": f"gagal: {_short(e)}"}
        if on_done:
            try:
                on_done(res)
            except Exception:
                pass

    t = threading.Thread(target=run, daemon=True, name="unduh-model")
    _state["bg"] = t
    t.start()
    return t
