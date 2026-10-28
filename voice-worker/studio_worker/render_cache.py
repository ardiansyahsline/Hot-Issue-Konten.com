"""
Cache bundle Remotion untuk render MP4 di laptop: `remotion bundle` (±6 dtk dengan cache webpack hangat, ±40 dtk dingin) cukup SEKALI
per versi kode, bukan tiap job.

- Kunci = sha1 isi kode yang di-bundle (remotion/, components/, lib/, remotion.config.mjs, package.json, package-lock.json,
  tsconfig.json) + versi @remotion/cli, @remotion/bundler, @remotion/renderer & remotion di node_modules + isi
  node_modules/.package-lock.json (ditulis ulang npm tiap npm ci / npm i: paket lain yang ikut di-bundle — react, mediabunny,
  @fontsource… — diperbarui install.ps1 sesudah git pull → kunci baru) + daftar/ukuran/mtime aset bawaan (assets/audio/sfx,
  assets/audio/music) + isi logo preset (public/konten-logo.png, public/brand/*). Kode / paket / aset berubah → kunci baru →
  dibangun ulang otomatis.
- Cache = <tmp>/bundle-cache/<kunci>/bundle: dibangun di folder sementara lalu di-rename (atomik), 2 terbaru disimpan.
  manifest.json mencatat ukuran + mtime semua file → cache yang rusak / tersentuh dibuang & dibangun ulang.
- Per job: isi cache di-HARDLINK ke <work>/bundle (os.link: instan, tanpa ruang disk; NTFS/ext4) — gagal (FAT32/exFAT, beda drive,
  batas link) → disalin biasa. File job (public/st/…) ditulis sebagai file BARU di folder job. JANGAN menulis ke file hasil hardlink:
  isinya sama dengan file cache (satu file, dua nama) → cache ikut berubah.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Callable, Iterator

from . import log as vlog
from .jobctx import Cancelled

log = vlog.get("render")

VER = "1"  # naikkan kalau isi / cara membangun cache berubah (cache lama otomatis tidak dipakai)
CODE_DIRS = ("remotion", "components", "lib")
CODE_FILES = ("remotion.config.mjs", "package.json", "package-lock.json", "tsconfig.json")
PKGS = ("@remotion/cli", "@remotion/bundler", "@remotion/renderer", "remotion")
SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".next", ".turbo"}
ASSET_DIRS = ("sfx", "music")
KEEP = 2  # cache yang disimpan (yang terbaru dipakai)
STALE_BUILD_SEC = 6 * 3600  # folder bangun sementara sisa worker yang mati di tengah jalan → dihapus
MANIFEST, USED = "manifest.json", "dipakai"

# satu bangun / salin cache sekaligus (job & bangun latar saat worker menyala); job menunggu sambil tetap bisa dibatalkan
_lock = threading.Lock()
# sha1 isi per file kode: dihitung ulang hanya kalau ukuran / mtime file itu berubah (kunci tetap berdasarkan ISI, tapi tiap job
# cukup stat ±230 file — di Windows membuka file bisa lambat karena dipindai antivirus)
_memo: dict[str, tuple[int, int, str]] = {}
RENAME_TRIES = 20  # Windows: folder baru kadang masih dipegang antivirus / pengindeks sebentar → rename dicoba ulang


def root(tmp: Path) -> Path:
    return Path(tmp) / "bundle-cache"


# ---------------------------------------------------------------- kunci
def _walk_sorted(base: Path) -> Iterator[Path]:
    for d, dirs, files in os.walk(base):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not x.startswith("."))
        for f in sorted(files):
            yield Path(d) / f


def _version(repo: Path, pkg: str) -> str:
    try:
        return str(json.loads((repo / "node_modules" / pkg / "package.json").read_text(encoding="utf-8")).get("version") or "?")
    except (OSError, ValueError):
        return "-"


def cache_key(repo: Path, safe_file: re.Pattern, logos: tuple[str, ...]) -> str:
    """sha1 semua yang menentukan isi bundle (lihat docstring modul). Baca ±4 MB kode: puluhan milidetik."""
    repo = Path(repo)
    h = hashlib.sha1(f"bundle-cache {VER}\n{repo.resolve()}\n".encode("utf-8"))

    def add(rel: str, p: Path) -> None:
        try:
            st = p.stat()
            m = _memo.get(str(p))
            if m and m[0] == st.st_size and m[1] == st.st_mtime_ns:
                digest = m[2]
            else:
                data = p.read_bytes()
                digest = hashlib.sha1(data).hexdigest()
                _memo[str(p)] = (len(data), st.st_mtime_ns, digest)
        except OSError:
            h.update(f"X {rel}\n".encode("utf-8"))
            return
        h.update(f"F {rel} {st.st_size} {digest}\n".encode("utf-8"))

    for d in CODE_DIRS:
        base = repo / d
        if not base.is_dir():
            h.update(f"D- {d}\n".encode("utf-8"))
            continue
        for p in _walk_sorted(base):
            add(p.relative_to(repo).as_posix(), p)
    for f in CODE_FILES:
        add(f, repo / f)
    for pkg in PKGS:
        h.update(f"P {pkg} {_version(repo, pkg)}\n".encode("utf-8"))
    # pohon node_modules yang terpasang (npm menulisnya ulang tiap install; isinya sama kalau paketnya sama → tidak bangun ulang)
    add("node_modules/.package-lock.json", repo / "node_modules" / ".package-lock.json")
    for d in ASSET_DIRS:
        base = repo / "assets" / "audio" / d
        try:
            items = sorted(base.iterdir())
        except OSError:
            items = []
        for f in items:
            if f.is_file() and safe_file.match(f.name):
                st = f.stat()
                h.update(f"A {d}/{f.name} {st.st_size} {st.st_mtime_ns}\n".encode("utf-8"))
    brand = repo / "public" / "brand"
    extra = sorted(p.relative_to(repo / "public").as_posix() for p in brand.iterdir() if p.is_file()) if brand.is_dir() else []
    for rel in sorted(set(logos) | set(extra)):
        add(f"public/{rel}", repo / "public" / rel)
    return h.hexdigest()[:20]


# ---------------------------------------------------------------- isi cache
def snapshot(d: Path) -> dict[str, list[int]]:
    """{path relatif: [ukuran, mtime_ns]} semua file. os.stat per file (bukan DirEntry.stat: di Windows data direktori untuk file
    ber-hardlink bisa basi). mtime dipakai bersama semua nama hardlink → tulisan lewat folder job ketahuan di sini."""
    out: dict[str, list[int]] = {}
    for dp, _dirs, files in os.walk(d):
        for f in files:
            p = Path(dp) / f
            st = os.stat(p)
            out[p.relative_to(d).as_posix()] = [st.st_size, st.st_mtime_ns]
    return out


def intact(entry: Path, key: str) -> bool:
    """cache <entry> utuh: manifest cocok dengan kunci & semua file masih ada dengan ukuran + mtime yang sama"""
    try:
        man = json.loads((entry / MANIFEST).read_text(encoding="utf-8"))
        if man.get("key") != key or not (entry / "bundle" / "index.html").is_file():
            return False
        return snapshot(entry / "bundle") == man.get("files")
    except (OSError, ValueError, AttributeError):
        return False


def _rmtree(p: Path) -> None:
    shutil.rmtree(p, ignore_errors=True)


def drop(tmp: Path, key: str) -> None:
    """buang cache kunci ini (rusak / render gagal karena bundle)"""
    _rmtree(root(tmp) / key)


def prune(tmp: Path, keep: int = KEEP) -> None:
    """simpan `keep` cache yang paling baru dipakai; folder bangun sementara yang basi (worker mati di tengah bangun) dihapus"""
    r = root(tmp)
    try:
        items = [p for p in r.iterdir() if p.is_dir()]
    except OSError:
        return
    done = []
    for p in items:
        if p.name.startswith(".baru-"):
            try:
                if time.time() - p.stat().st_mtime > STALE_BUILD_SEC:
                    _rmtree(p)
            except OSError:
                pass
            continue
        try:
            used = (p / USED).stat().st_mtime
        except OSError:
            used = 0.0
        done.append((used, p))
    for _used, p in sorted(done, reverse=True)[keep:]:
        _rmtree(p)


def _touch(entry: Path) -> None:
    try:
        (entry / USED).write_text(str(time.time()), encoding="utf-8")  # file penanda di luar bundle (tidak pernah di-hardlink)
    except OSError:
        pass


@contextlib.contextmanager
def hold(should_stop: Callable[[], bool] = lambda: False) -> Iterator[None]:
    """kunci cache (satu bangun / salin sekaligus). Menunggu bangun latar sambil tetap bisa dibatalkan dari website."""
    while not _lock.acquire(timeout=0.5):
        if should_stop():
            raise Cancelled("batal")
    try:
        yield
    finally:
        _lock.release()


def busy() -> bool:
    return _lock.locked()


def _replace_dir(src: Path, dst: Path) -> bool:
    """rename folder (atomik); Windows: folder yang baru ditulis kadang masih dipegang antivirus → dicoba ulang ±6 dtk"""
    for i in range(RENAME_TRIES):
        try:
            os.replace(src, dst)
            return True
        except OSError:
            if i == RENAME_TRIES - 1:
                return False
            time.sleep(0.3)
    return False


def _own_leftovers(r: Path) -> None:
    """folder bangun sementara milik proses ini yang tertinggal (rename gagal → dipakai sekali saja) dibuang; aman karena hold()"""
    try:
        for p in r.iterdir():
            if p.name.startswith(".baru-") and f"-{os.getpid()}-" in p.name:
                _rmtree(p)
    except OSError:
        pass


def ensure(tmp: Path, key_fn: Callable[[], str], build: Callable[[Path], None]) -> tuple[Path, str, bool]:
    """folder bundle cache yang utuh untuk kode sekarang; belum ada / rusak → `build(<folder bundle sementara>)` lalu di-rename.
    Panggil di dalam hold(). Balikan (folder bundle, kunci, True kalau baru dibangun). Kode berubah DI TENGAH bangun (git pull) →
    dibangun sekali lagi supaya isi cache cocok dengan kuncinya. Rename tetap gagal (Windows, folder dipegang program lain) → hasil
    bangun dipakai untuk job ini saja (tidak disimpan; dibuang saat ensure() berikutnya)."""
    r = root(tmp)
    _own_leftovers(r)
    key = key_fn()
    entry = r / key
    if intact(entry, key):
        _touch(entry)
        return entry / "bundle", key, False
    if entry.exists():
        log.warning("Cache komposisi render %s rusak / tidak lengkap — dibangun ulang.", key[:8])
        _rmtree(entry)
    for attempt in range(2):
        r.mkdir(parents=True, exist_ok=True)
        work = r / f".baru-{key[:8]}-{os.getpid()}-{uuid.uuid4().hex[:6]}"
        try:
            build(work / "bundle")
            files = snapshot(work / "bundle")
            (work / MANIFEST).write_text(json.dumps({"key": key, "built": time.time(), "files": files}), encoding="utf-8")
            after = key_fn()
            if after != key and attempt == 0:
                log.info("Kode berubah saat komposisi render disiapkan — disiapkan sekali lagi.")
                _rmtree(work)
                key, entry = after, r / after
                continue
            if entry.exists():  # proses lain sudah selesai duluan
                if intact(entry, key):
                    _rmtree(work)
                    _touch(entry)
                    return entry / "bundle", key, True
                _rmtree(entry)
            if not _replace_dir(work, entry):
                log.warning("Cache komposisi render tidak bisa disimpan (folder dipegang program lain) — dipakai untuk video ini saja.")
                keep = work
                work = r / ".tidak-ada"
                prune(tmp)  # sisa sekali-pakai worker sebelumnya (PID lain) yang > STALE_BUILD_SEC ikut dibuang; `keep` masih baru → aman
                return keep / "bundle", key, True
            _touch(entry)
            prune(tmp)
            return entry / "bundle", key, True
        finally:
            if work.exists():
                _rmtree(work)
    raise RuntimeError("tidak sampai")  # pragma: no cover


def _leftover(s: Path, d: Path) -> str:
    """d sudah ada (sisa folder job lama yang tidak terhapus: file dipegang program lain). "sama" = d sudah hardlink ke file cache s
    (dipakai apa adanya; dulu shutil.copy2 melempar SameFileError → job gagal). "hapus" = file lain, sudah dihapus → di-link / disalin
    seperti biasa. "timpa" = file lain yang tidak bisa dihapus → ditimpa salinan s (seperti dulu; kalau itu hardlink ke cache versi
    lain, cache itu ketahuan rusak oleh intact() — ukuran / mtime berubah — lalu dibangun ulang)."""
    try:
        if os.path.samefile(s, d):
            return "sama"
    except OSError:
        pass
    try:
        os.unlink(d)
        return "hapus"
    except OSError:
        return "timpa"


def link_tree(src: Path, dst: Path) -> tuple[int, int]:
    """isi folder cache → dst: hardlink per file (instan, tanpa ruang disk); hardlink gagal (FAT32/exFAT, beda drive, batas 1023
    link NTFS) → salin biasa. dst sisa job lama (rmtree tidak tuntas) → file yang sudah ada dicek dulu (_leftover).
    Balikan (jumlah hardlink, jumlah salinan)."""
    linked = copied = 0
    can_link = True
    dirty = dst.exists()  # biasanya False (get_bundle menghapus dst dulu) → tanpa cek tambahan per file
    for dp, _dirs, files in os.walk(src):
        rel = Path(dp).relative_to(src)
        (dst / rel).mkdir(parents=True, exist_ok=True)
        for f in files:
            s, d = Path(dp) / f, dst / rel / f
            left = _leftover(s, d) if dirty and os.path.lexists(d) else ""
            if left == "sama":
                linked += 1
                continue
            if left == "timpa":  # os.link pasti gagal (nama sudah ada) → langsung salin, cara link untuk file lain tidak berubah
                shutil.copy2(s, d)
                copied += 1
                continue
            if can_link:
                try:
                    os.link(s, d)
                    linked += 1
                    continue
                except OSError:
                    can_link = linked > 0  # gagal di file pertama = sistem file tidak mendukung → langsung salin sisanya
            shutil.copy2(s, d)
            copied += 1
    return linked, copied


def merge_new(src: Path, dst: Path) -> int:
    """file job (folder public job) → folder public bundle: hanya file yang BELUM ada (file cache ber-hardlink tidak pernah ditimpa).
    Hardlink (gagal → salin); aslinya tetap di folder job supaya bisa dipasang lagi kalau bundle dibangun ulang. Balikan jumlah file."""
    n = 0
    if not src.is_dir():
        return 0
    for dp, _dirs, files in os.walk(src):
        rel = Path(dp).relative_to(src)
        for f in files:
            d = dst / rel / f
            if d.exists():
                continue
            d.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.link(Path(dp) / f, d)
            except OSError:
                shutil.copyfile(Path(dp) / f, d)
            n += 1
    return n
