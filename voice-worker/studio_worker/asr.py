"""Cek ucapan dengan faster-whisper (bahasa Indonesia): teks hasil dengar + timestamp per kata.

GPU dicoba dulu (float16); kalau gagal (DLL CUDA / kernel sm_120 belum didukung) otomatis pindah ke CPU int8.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path

from . import log as vlog

log = vlog.get("asr")


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
        self.lock = threading.Lock()

    @property
    def available(self) -> bool:
        if self.model is None and self.error is None:
            self._load()
        return self.model is not None

    def _load(self, force_cpu: bool = False) -> None:
        try:
            from faster_whisper import WhisperModel
        except Exception as e:
            self.error = f"faster-whisper tidak terpasang: {e}"
            log.warning("%s — pemilihan take pakai cek audio saja, timestamp kata diperkirakan.", self.error)
            return
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
                    download_root=str(self.cfg.models / "whisper"),
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

    def transcribe(self, path: Path, words: bool = True) -> tuple[str, list[tuple[str, float, float]]]:
        """balikan (teks, [(kata, mulai, selesai)])"""
        with self.lock:
            if not self.available:
                raise RuntimeError(self.error or "ASR tidak tersedia")
            for attempt in range(2):
                try:
                    segs, _ = self.model.transcribe(  # type: ignore[union-attr]
                        str(path),
                        language="id",
                        beam_size=5,
                        word_timestamps=words,
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
                    self.model = None
                    self._load(force_cpu=True)
                    if self.model is None:
                        raise
            raise RuntimeError("ASR gagal")

    def close(self) -> None:
        self.model = None
