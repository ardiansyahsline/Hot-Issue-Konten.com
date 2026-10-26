"""Pengelola mesin suara: urutan otomatis (Chatterbox GPU → pocket-tts CPU), model dimuat SEKALI lalu dipakai ulang."""
from __future__ import annotations

import gc
import json
import struct
import threading
import time
from pathlib import Path
from typing import Protocol

import numpy as np

from .. import log as vlog

log = vlog.get("mesin")

DOWN_RETRY_SEC = 30 * 60  # mesin yang gagal dimuat dicoba lagi setelah 30 menit


class EngineDown(Exception):
    """mesin tidak bisa dimuat (paket / GPU / bobot model bermasalah)"""


class EngineFailed(Exception):
    """mesin sudah dimuat tapi gagal membuat suara (mis. VRAM habis)"""


class Engine(Protocol):
    name: str
    sr: int
    label: str
    credit: str | None

    def synth(self, text: str, ref: Path, st: dict, seed: int) -> np.ndarray: ...

    def close(self) -> None: ...


def safetensors_header(path: Path) -> dict:
    """baca header safetensors (nama + bentuk tensor) tanpa torch"""
    with open(path, "rb") as f:
        n = struct.unpack("<Q", f.read(8))[0]
        if n <= 0 or n > 100_000_000:
            raise ValueError("bukan file safetensors")
        h = json.loads(f.read(n).decode("utf-8"))
    h.pop("__metadata__", None)
    return h


def to_mono(a) -> np.ndarray:
    """tensor / array keluaran model → float32 mono 1D"""
    if hasattr(a, "detach"):
        a = a.detach().float().cpu().numpy()
    a = np.asarray(a, dtype=np.float32)
    a = np.squeeze(a)
    if a.ndim == 2:
        a = a.mean(axis=0 if a.shape[0] < a.shape[1] else 1)
    return np.nan_to_num(a.reshape(-1)).astype(np.float32)


class Engines:
    def __init__(self, cfg):
        self.cfg = cfg
        self._eng: dict[str, Engine] = {}
        self._down: dict[str, tuple[float, str]] = {}
        self.lock = threading.RLock()
        self.last_used = time.time()

    def order(self, pref: str | None) -> list[str]:
        if pref == "pocket":
            return ["pocket"]
        if pref == "chatterbox":  # tetap boleh jatuh ke pocket supaya job tidak gagal
            return ["chatterbox", "pocket"]
        return list(self.cfg.engine_order)

    def is_down(self, name: str) -> bool:
        d = self._down.get(name)
        return bool(d and time.time() - d[0] < DOWN_RETRY_SEC)

    def down_reason(self, name: str) -> str | None:
        d = self._down.get(name)
        return d[1] if d else None

    def loaded(self) -> list[str]:
        return list(self._eng)

    def planned(self) -> str | None:
        """mesin yang akan dipakai job berikutnya (untuk status di website)"""
        for n in self.cfg.engine_order:
            if n in self._eng or not self.is_down(n):
                return n
        return None

    def get(self, name: str) -> Engine:
        with self.lock:
            self.last_used = time.time()
            if name in self._eng:
                return self._eng[name]
            if self.is_down(name):
                raise EngineDown(self.down_reason(name) or "mesin sedang tidak tersedia")
            t0 = time.time()
            log.info("Memuat mesin suara %s… (sekali saja, lalu dipakai ulang)", name)
            try:
                if name == "chatterbox":
                    from .chatterbox_engine import ChatterboxEngine

                    eng: Engine = ChatterboxEngine(self.cfg)
                elif name == "pocket":
                    from .pocket_engine import PocketEngine

                    eng = PocketEngine(self.cfg)
                else:
                    raise EngineDown(f"mesin tidak dikenal: {name}")
            except EngineDown as e:
                self._mark(name, str(e))
                raise
            except Exception as e:  # import gagal, CUDA error, dsb.
                self._mark(name, f"{type(e).__name__}: {e}")
                raise EngineDown(f"{type(e).__name__}: {e}") from e
            self._down.pop(name, None)
            self._eng[name] = eng
            log.info("Mesin %s siap (%.0f dtk).", name, time.time() - t0)
            if eng.credit:
                log.info("Kredit: %s", eng.credit)
            return eng

    def _mark(self, name: str, reason: str) -> None:
        self._down[name] = (time.time(), reason[:500])
        log.warning("Mesin %s tidak bisa dipakai: %s", name, reason[:500])
        if name == "chatterbox":
            log.warning("→ pindah ke pocket-tts (CPU) untuk sementara.")

    def mark_down(self, name: str, reason: str) -> None:
        with self.lock:
            self.unload(name)
            self._mark(name, reason)

    def unload(self, name: str | None = None) -> None:
        with self.lock:
            names = [name] if name else list(self._eng)
            for n in names:
                eng = self._eng.pop(n, None)
                if eng is None:
                    continue
                try:
                    eng.close()
                except Exception:
                    pass
                log.info("Mesin %s dilepas dari memori.", n)
            if name is None:  # lepas semua (menganggur) → penilai kealamian UTMOS ikut dilepas, dimuat lagi saat dibutuhkan
                try:
                    from .. import natural

                    natural.unload()
                except Exception:
                    pass
            gc.collect()
            try:
                import torch

                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass

    def maybe_idle_unload(self) -> None:
        mins = self.cfg.idle_unload_min
        if mins and self._eng and time.time() - self.last_used > mins * 60:
            log.info("Tidak ada pekerjaan %d menit — lepas model supaya VRAM/RAM lega.", mins)
            self.unload()

    def status(self) -> dict:
        return {"loaded": self.loaded(), "down": {n: r for n, (t, r) in self._down.items() if time.time() - t < DOWN_RETRY_SEC}}
