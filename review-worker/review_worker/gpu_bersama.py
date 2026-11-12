"""Kunci GPU bersama antar proses di laptop yang sama (pemilik: worker-inti). SALINAN IDENTIK ada di
voice-worker/studio_worker/gpu_bersama.py (tes membandingkan isi kedua file). KONTRAK.md §3.6.

Protokol (hanya file, tanpa paket baru, tanpa impor dari paket worker — modul ini berdiri sendiri):
- folder: env HOTISSUE_GPU_DIR, bawaan Windows %LOCALAPPDATA%\\HotIssueKonten\\gpu, lainnya ~/.cache/hotissue-konten/gpu
- gpu.lock  : kunci eksklusif 1 byte (msvcrt.locking LK_NBLCK / fcntl.flock LOCK_EX|LOCK_NB), dicoba ulang tiap 0,5 dtk
- gpu.minta : penanda "voice-worker sedang menunggu" (isi: pid + waktu, diperbarui tiap 30 dtk selama menunggu; > 2 mnt tanpa
              pembaruan = basi). Selama ada & segar, review-worker TIDAK mengambil kunci baru (mengalah di antara tahap), jadi
              job suara dari website didahulukan.
- gpu.pemilik: info pemegang kunci (nama, pid, alasan, sejak) untuk log / detak jantung.
voice-worker memegang kunci selama satu job (prioritas=True, tunggu_maks 300 dtk lalu jalan saja); review-worker memegang
kunci per TAHAP GPU (ASR / OCR / Demucs), bukan per video. Error apa pun di modul ini → jalan tanpa kunci (tidak pernah
menggagalkan job). Pemakaian bersarang di thread yang sama (tahap di dalam tahap) tidak mengunci dua kali."""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator, Optional

log = logging.getLogger("gpu_bersama")
JEDA = 0.5  # detik antar percobaan mengunci
MINTA_SEGAR = 120.0  # gpu.minta lebih tua dari ini = basi (penulisnya mati / berhenti)
MINTA_PERBARUI = 30.0
# kunci yang dipegang proses ini: path → {"n": kedalaman, "fh": file, "thread": id thread}
_DIPEGANG: dict[str, dict] = {}
_LOCK = threading.Lock()


def folder_kunci() -> Path:
    env = (os.environ.get("HOTISSUE_GPU_DIR") or "").strip()
    if env:
        p = Path(env).expanduser()
    elif os.name == "nt":
        p = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")) / "HotIssueKonten" / "gpu"
    else:
        p = Path.home() / ".cache" / "hotissue-konten" / "gpu"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _kunci_os(fh) -> bool:
    try:
        if os.name == "nt":
            import msvcrt

            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False


def _lepas_os(fh) -> None:
    try:
        if os.name == "nt":
            import msvcrt

            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
    except OSError:
        pass


def _tulis_json(path: Path, isi: dict) -> None:
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(isi), encoding="utf-8")
    os.replace(tmp, path)


def _baca_json(path: Path) -> Optional[dict]:
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else None
    except (OSError, ValueError):
        return None


def _hapus_milik_sendiri(path: Path) -> None:
    d = _baca_json(path)
    if d is not None and d.get("pid") == os.getpid():
        try:
            path.unlink()
        except OSError:
            pass


class KunciGPU:
    def __init__(self, nama: str, folder: Optional[Path] = None):
        self.nama = nama
        self.folder = Path(folder) if folder else None
        self.menunggu = False  # sedang menunggu kunci (detak jantung: "menunggu_gpu")
        self.mengalah = 0  # berapa kali BERTURUT-TURUT harus menunggu proses lain (review-worker: > 2 → lepas model)

    def _dir(self) -> Path:
        if self.folder is None:
            self.folder = folder_kunci()
        self.folder.mkdir(parents=True, exist_ok=True)
        return self.folder

    @contextmanager
    def pegang(self, alasan: str, *, prioritas: bool = False, tunggu_maks: Optional[float] = None,
               cek_batal: Optional[Callable[[], None]] = None) -> Iterator[bool]:
        """yield True = kunci didapat; False = jalan tanpa kunci (tunggu_maks habis / error). prioritas=True menulis gpu.minta
        selama menunggu. cek_batal dipanggil tiap putaran tunggu (boleh melempar Cancelled)."""
        kunci = self._ambil(alasan, prioritas, tunggu_maks, cek_batal)
        try:
            yield kunci is not None
        finally:
            if kunci is not None:
                self._lepas(kunci)

    # ------------------------------------------------------------------ dalam
    def _ambil(self, alasan: str, prioritas: bool, tunggu_maks: Optional[float], cek_batal) -> Optional[str]:
        try:
            d = self._dir()
            path = d / "gpu.lock"
            key = str(path)
            with _LOCK:
                ent = _DIPEGANG.get(key)
                if ent is not None and ent["thread"] == threading.get_ident():  # bersarang di thread yang sama
                    ent["n"] += 1
                    return key
            fh = open(path, "a+b")
            if path.stat().st_size == 0:
                fh.write(b"0")
                fh.flush()
        except Exception as e:  # folder tidak bisa ditulis dsb. → jalan tanpa kunci
            log.warning("Kunci GPU bersama tidak bisa dipakai (%s) — jalan tanpa kunci.", e)
            return None
        t0 = time.monotonic()
        minta = d / "gpu.minta"
        minta_tulis = 0.0
        mengalah = False
        try:
            while True:
                if cek_batal is not None:
                    cek_batal()
                try:
                    lawan_minta = (not prioritas) and self.ada_yang_minta()
                    if not lawan_minta:
                        with _LOCK:
                            dipakai_thread_lain = key in _DIPEGANG
                        if not dipakai_thread_lain and _kunci_os(fh):
                            with _LOCK:
                                _DIPEGANG[key] = {"n": 1, "fh": fh, "thread": threading.get_ident()}
                            try:
                                _tulis_json(d / "gpu.pemilik", {"nama": self.nama, "pid": os.getpid(), "alasan": alasan, "sejak": time.time()})
                            except OSError:
                                pass
                            if prioritas:
                                _hapus_milik_sendiri(minta)
                            self.mengalah = self.mengalah + 1 if mengalah else 0
                            self.menunggu = False
                            if time.monotonic() - t0 > 2:
                                log.info("GPU didapat untuk %s sesudah menunggu %.0f dtk.", alasan, time.monotonic() - t0)
                            return key
                    if prioritas and time.monotonic() - minta_tulis > MINTA_PERBARUI:
                        try:  # Windows: file sedang dibaca proses lain → coba lagi di putaran berikutnya
                            _tulis_json(minta, {"nama": self.nama, "pid": os.getpid(), "alasan": alasan, "sejak": time.time()})
                            minta_tulis = time.monotonic()
                        except OSError:
                            pass
                except Exception as e:  # file kunci bermasalah → jalan tanpa kunci
                    log.warning("Kunci GPU bersama error (%s) — jalan tanpa kunci.", e)
                    self._batal(fh, minta, prioritas)
                    return None
                self.menunggu = True
                mengalah = True  # harus menunggu (proses lain memegang / meminta GPU)
                if tunggu_maks is not None and time.monotonic() - t0 >= tunggu_maks:
                    p = self.pemegang() or {}
                    log.warning("GPU masih dipakai %s sesudah %.0f dtk — %s jalan tanpa menunggu lagi.", p.get("nama", "proses lain"),
                                time.monotonic() - t0, alasan)
                    self._batal(fh, minta, prioritas)
                    return None
                time.sleep(JEDA)
        except BaseException:
            self._batal(fh, minta, prioritas)
            raise

    def _batal(self, fh, minta: Path, prioritas: bool) -> None:
        self.menunggu = False
        try:
            fh.close()
        except Exception:
            pass
        if prioritas:
            _hapus_milik_sendiri(minta)

    def _lepas(self, key: str) -> None:
        with _LOCK:
            ent = _DIPEGANG.get(key)
            if ent is None:
                return
            ent["n"] -= 1
            if ent["n"] > 0:
                return
            _DIPEGANG.pop(key, None)
        try:
            _hapus_milik_sendiri(Path(key).with_name("gpu.pemilik"))
            _lepas_os(ent["fh"])
        finally:
            try:
                ent["fh"].close()
            except Exception:
                pass

    # ------------------------------------------------------------------ info
    def ada_yang_minta(self) -> bool:
        """voice-worker sedang menunggu GPU (gpu.minta segar)?"""
        try:
            f = self._dir() / "gpu.minta"
            if not f.exists() or time.time() - f.stat().st_mtime > MINTA_SEGAR:
                return False
            d = _baca_json(f)
            return d is None or d.get("pid") != os.getpid()
        except Exception:
            return False

    def pemegang(self) -> Optional[dict]:
        try:
            return _baca_json(self._dir() / "gpu.pemilik")
        except Exception:
            return None


@contextmanager
def pegang(nama: str, alasan: str, **kw) -> Iterator[bool]:
    """pintasan untuk voice-worker: `with gpu_bersama.pegang("voice-worker", "tts", prioritas=True, tunggu_maks=300): ...`"""
    with KunciGPU(nama).pegang(alasan, **kw) as ok:
        yield ok
