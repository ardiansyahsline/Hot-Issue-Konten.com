"""Cek ucapan dengan faster-whisper (bahasa Indonesia): teks hasil dengar + timestamp per kata.

GPU dicoba dulu (float16); kalau gagal (DLL CUDA / kernel sm_120 belum didukung) otomatis pindah ke CPU int8.
Model hanya dimuat dari file LOKAL (local_files_only) — unduhannya lewat SIAPKAN-MODEL.bat / unduhan latar, tidak pernah di job.
Belum diunduh → "model whisper belum diunduh" (take dipilih dari cek audio saja), dicek ulang tiap 60 dtk.
"""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path

from . import log as vlog

log = vlog.get("asr")
MISSING = "model whisper belum diunduh"
RECHECK_SEC = 60.0


def _win_cuda_dll_paths() -> None:
    """ctranslate2 di Windows butuh cublas/cudnn: pinjam DLL yang ikut terpasang bersama PyTorch cu128"""
    if os.name != "nt":
        return
    try:
        import torch

        lib = Path(torch.__file__).parent / "lib"
        if lib.exists():
            os.add_dll_directory(str(lib))  # type: ignore[attr-defined]
            os.environ["PATH"] = f"{lib}{os.pathsep}{os.environ.get('PATH', '')}"
    except Exception:
        pass


class Asr:
    def __init__(self, cfg):
        self.cfg = cfg
        self.model = None
        self.device: str | None = None
        self.error: str | None = None
        self.lock = threading.Lock()  # satu transcribe sekaligus
        # pemuatan model (available / pindah ke CPU): satu thread saja — pemanasan latar & job bisa memanggil available bersamaan,
        # tanpa kunci ini WhisperModel dimuat dua kali sekaligus (VRAM ganda). Kunci terpisah dari self.lock: transcribe memanggil
        # available sambil memegang self.lock (urutan selalu self.lock → _load_lock, tidak pernah sebaliknya → tidak deadlock)
        self._load_lock = threading.RLock()
        self._missing_at: float | None = None  # waktu cek terakhir saat model belum diunduh
        self._gen = -1

    def _recheck_due(self) -> bool:
        """model belum diunduh: boleh cek lagi kalau sudah 60 dtk atau ada unduhan model yang baru selesai"""
        if self._missing_at is None:
            return False
        try:
            from . import models

            gen = models.ready_gen()
        except Exception:
            gen = self._gen
        if gen != self._gen or time.monotonic() - self._missing_at >= RECHECK_SEC:
            self._gen = gen
            return True
        return False

    @property
    def available(self) -> bool:
        if self.model is None:
            with self._load_lock:  # dicek ulang di dalam kunci: thread lain mungkin baru selesai memuat
                if self.model is None and (self.error is None or self._recheck_due()):
                    self._load()
        return self.model is not None

    def refresh(self) -> None:
        """setelah model whisper selesai diunduh di latar: coba muat lagi di pemakaian berikutnya"""
        if self.model is None and self._missing_at is not None:
            self.error, self._missing_at = None, None

    def _load(self, force_cpu: bool = False) -> None:
        with self._load_lock:
            self._load_locked(force_cpu)

    def _load_locked(self, force_cpu: bool = False) -> None:
        try:
            from faster_whisper import WhisperModel
        except Exception as e:
            self.error = f"faster-whisper tidak terpasang: {e}"
            log.warning("%s — pemilihan take pakai cek audio saja, timestamp kata diperkirakan.", self.error)
            return
        from . import models

        if not models.whisper_ready(self.cfg):  # cek file saja — tidak pernah mengunduh di tengah job
            if self._missing_at is None:
                log.warning("%s — pemilihan take pakai cek audio saja dulu; otomatis dipakai setelah unduhan selesai "
                            "(SIAPKAN-MODEL.bat / unduhan latar).", MISSING.capitalize())
            self.error, self._missing_at, self._gen = MISSING, time.monotonic(), models.ready_gen()
            return
        self._missing_at = None
        want = "cpu" if force_cpu else self.cfg.whisper_device
        tries = [("cpu", "int8")] if want == "cpu" else [("cuda", "float16"), ("cpu", "int8")] if want == "auto" else [("cuda", "float16")]
        if any(d == "cuda" for d, _ in tries):
            _win_cuda_dll_paths()
        errs = []
        for dev, ct in tries:
            try:
                m = WhisperModel(
                    self.cfg.whisper_model,
                    device=dev,
                    compute_type=ct,
                    cpu_threads=self.cfg.cpu_threads,
                    download_root=str(models.whisper_dir(self.cfg)),
                    local_files_only=True,
                )
                import numpy as np

                list(m.transcribe(np.zeros(16000, dtype=np.float32), language="id")[0])  # tes kecil: error CUDA muncul di sini
                self.model, self.device, self.error = m, dev, None
                log.info("faster-whisper %s siap di %s (%s).", self.cfg.whisper_model, dev, ct)
                return
            except Exception as e:
                errs.append(f"{dev}: {e}")
                log.warning("faster-whisper di %s gagal: %s", dev, str(e)[:200])
        self.error = " | ".join(errs)[:500]

    def transcribe(self, src, words: bool = True, beam: int | None = None) -> tuple[str, list[tuple[str, float, float]]]:
        """
        balikan (teks, [(kata, mulai, selesai)]). `src` = path file audio ATAU np.ndarray float32 mono 16 kHz (tanpa tulis/baca
        file). beam bawaan 5 (timestamp kata baris final); cek take cukup beam kecil (ASR_BEAM_TAKES, bawaan 1). words=False →
        tanpa timestamp sama sekali (lebih cepat).
        """
        beam = 5 if beam is None else max(1, int(beam))
        if isinstance(src, (str, Path)):
            audio = str(src)
        else:
            import numpy as np

            audio = np.ascontiguousarray(np.asarray(src, dtype=np.float32).reshape(-1))
        with self.lock:
            if not self.available:
                raise RuntimeError(self.error or "ASR tidak tersedia")
            for attempt in range(2):
                try:
                    segs, _ = self.model.transcribe(  # type: ignore[union-attr]
                        audio,
                        language="id",
                        beam_size=beam,
                        word_timestamps=words,
                        without_timestamps=not words,
                        vad_filter=False,
                        condition_on_previous_text=False,
                        temperature=0.0,
                    )
                    text, ws = [], []
                    for s in segs:
                        text.append(s.text.strip())
                        for w in s.words or []:
                            ws.append((w.word.strip(), float(w.start), float(w.end)))
                    return " ".join(text).strip(), ws
                except Exception as e:
                    if attempt or self.device == "cpu":
                        raise
                    log.warning("faster-whisper GPU error (%s) — pindah ke CPU.", str(e)[:200])
                    with self._load_lock:  # thread lain (available) tidak memuat versi GPU lagi di sela-sela
                        self.model = None
                        self._load(force_cpu=True)
                    if self.model is None:
                        raise
            raise RuntimeError("ASR gagal")

    def close(self) -> None:
        self.model = None
