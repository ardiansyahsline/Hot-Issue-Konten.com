"""faster-whisper bahasa Indonesia + timestamp (pemilik: worker-media). Dimuat malas di rt.cache["asr"]; dijalankan di dalam
rt.gpu.pegang("asr"). Model bisa memakai cache unduhan voice-worker (REVIEW_WHISPER_CACHE).

GPU dicoba dulu (int8_float16 → float16), gagal (DLL CUDA / kernel sm_120) → CPU int8. Model dicari dulu di cache lokal
(REVIEW_WHISPER_CACHE → voice-worker/data/models/whisper → data/models/whisper); belum ada → diunduh SEKALI ke
data/models/whisper (±1,6 GB untuk large-v3-turbo). Teks hasil dibersihkan privasi.bersihkan_teks (nama akun / no HP yang
diucapkan tidak ikut ke AI). Halusinasi khas Whisper di bagian musik ("terima kasih telah menonton", "subtitle by …") dibuang."""
from __future__ import annotations

import gc
import os
import re
import threading
from pathlib import Path
from typing import Iterable, Optional

from .. import privasi
from ..log import get
from ..skema import SegmenTranskrip, Transkrip

log = get("asr")
MAKS_TEKS = 4000  # karakter teks_penuh (±1K token) — cukup untuk video pendek
_HALU = re.compile(
    r"^(terima kasih (telah|sudah|atas) (menonton|menyaksikan)|thanks for watching|subtitle[sd]? (by|oleh)|"
    r"sub(title)? indo|diterjemahkan oleh|terjemahan oleh|amara\.org|jangan lupa (like|subscribe)|"
    r"silakan (like|subscribe)|tonton (juga )?video lain)", re.I)


def _win_cuda_dll_paths() -> None:
    """ctranslate2 di Windows butuh cublas/cudnn: pinjam DLL yang ikut terpasang bersama PyTorch cu128 (pola voice-worker)"""
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


def folder_model(cfg) -> list[Path]:
    """urutan folder cache model yang dicoba (yang pertama berisi model dipakai; unduhan baru → yang terakhir)"""
    root = Path(getattr(cfg, "root", Path(__file__).resolve().parents[2]))
    calon = []
    if getattr(cfg, "whisper_cache", None):
        calon.append(Path(cfg.whisper_cache))
    calon.append(root.parent / "voice-worker" / "data" / "models" / "whisper")
    calon.append(Path(getattr(cfg, "data", root / "data")) / "models" / "whisper")
    return calon


def bersihkan_segmen(segmen: Iterable, boleh: Iterable[str] = ()) -> list[SegmenTranskrip]:
    """segmen faster-whisper → SegmenTranskrip bersih (tanpa halusinasi & data pribadi)"""
    out: list[SegmenTranskrip] = []
    boleh = list(boleh)
    for s in segmen:
        teks = (getattr(s, "text", "") or "").strip()
        if not teks:
            continue
        nsp = float(getattr(s, "no_speech_prob", 0.0) or 0.0)
        alp = float(getattr(s, "avg_logprob", 0.0) or 0.0)
        if nsp > 0.6 and alp < -0.8:
            continue  # kemungkinan besar bukan ucapan (musik / bising)
        if _HALU.search(teks):
            continue
        teks = bersihkan(teks, boleh)
        if not teks or (out and out[-1].teks == teks and len(teks) < 40):  # pengulangan khas halusinasi
            continue
        out.append(SegmenTranskrip(mulai=round(float(s.start), 2), selesai=round(float(s.end), 2), teks=teks))
    return out


def bersihkan(teks: str, boleh: Iterable[str] = (), maks: Optional[int] = None) -> str:
    """privasi.bersihkan_teks (@handle → [akun], email, no HP, link), tapi tag wajib campaign (mis. @akunbrand di brief) tetap utuh"""
    return privasi.bersihkan_teks(teks, maks, izinkan=list(boleh))


class ASR:
    def __init__(self, cfg):
        self.cfg = cfg
        self.model = None
        self.device: Optional[str] = None
        self.error: Optional[str] = None
        self.lock = threading.Lock()

    @property
    def nama_model(self) -> str:
        return str(getattr(self.cfg, "whisper_model", "large-v3-turbo") or "large-v3-turbo")

    def _muat(self) -> None:
        if self.model is not None:
            return
        try:
            from faster_whisper import WhisperModel
        except Exception as e:  # noqa: BLE001
            self.error = f"faster-whisper tidak terpasang ({type(e).__name__})"
            raise RuntimeError(self.error) from e
        want = str(getattr(self.cfg, "whisper_device", "auto") or "auto")
        ct = str(getattr(self.cfg, "whisper_compute", "int8_float16") or "int8_float16")
        tries = [("cpu", "int8")] if want == "cpu" else [("cuda", ct), ("cuda", "float16"), ("cpu", "int8")]
        if want == "cuda":
            tries = tries[:2]
        if any(d == "cuda" for d, _ in tries):
            _win_cuda_dll_paths()
        folders = folder_model(self.cfg)
        errs = []
        for lokal in (True, False):  # cache lokal dulu; belum ada → unduh sekali ke folder terakhir
            for folder in (folders if lokal else folders[-1:]):
                if lokal and not folder.exists():
                    continue
                if not lokal:
                    folder.mkdir(parents=True, exist_ok=True)
                    log.info("model whisper %s belum ada → diunduh sekali (bisa beberapa menit)", self.nama_model)
                for dev, c in tries:
                    try:
                        m = WhisperModel(self.nama_model, device=dev, compute_type=c, download_root=str(folder),
                                         local_files_only=lokal, cpu_threads=max(1, (os.cpu_count() or 4) // 2))
                        import numpy as np

                        list(m.transcribe(np.zeros(16000, dtype=np.float32), language="id")[0])  # error CUDA muncul di sini
                        self.model, self.device, self.error = m, dev, None
                        log.info("faster-whisper %s siap di %s (%s)", self.nama_model, dev, c)
                        return
                    except Exception as e:  # noqa: BLE001
                        errs.append(f"{dev}/{c}: {type(e).__name__}: {str(e)[:120]}")
                        if lokal and ("local" in str(e).lower() or "not found" in str(e).lower() or "snapshot" in str(e).lower()):
                            break  # model tidak ada di folder ini — perangkat lain tidak akan membantu
        self.error = " | ".join(errs)[-500:] or "model whisper tidak bisa dimuat"
        raise RuntimeError(self.error)

    def transkrip(self, audio: Path, boleh: Iterable[str] = ()) -> Transkrip:
        """audio = WAV 16 kHz mono. boleh = tag wajib campaign yang tidak ikut disamarkan."""
        with self.lock:
            self._muat()
            for percobaan in range(2):
                try:
                    segs, _info = self.model.transcribe(  # type: ignore[union-attr]
                        str(audio), language="id", task="transcribe", beam_size=5, vad_filter=True,
                        vad_parameters={"min_silence_duration_ms": 500}, condition_on_previous_text=False,
                        word_timestamps=False, temperature=0.0)
                    segmen = bersihkan_segmen(list(segs), boleh)
                    break
                except Exception as e:  # noqa: BLE001
                    if percobaan or self.device == "cpu":
                        raise
                    log.warning("ASR GPU error (%s) → pindah ke CPU", type(e).__name__)  # mis. VRAM habis
                    self.tutup()
                    self.cfg = _salin_cfg_cpu(self.cfg)
                    self._muat()
        penuh = " ".join(s.teks for s in segmen).strip()
        if len(penuh) > MAKS_TEKS:
            penuh = penuh[: MAKS_TEKS - 1].rstrip() + "…"
        return Transkrip(bahasa="id", segmen=segmen, teks_penuh=penuh, model=self.nama_model)

    def tutup(self) -> None:
        """lepas model (VRAM 8 GB dipakai bergantian dengan voice-worker)"""
        m, self.model, self.device = self.model, None, None
        if m is None:
            return
        del m
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass


def _salin_cfg_cpu(cfg):
    import copy

    c = copy.copy(cfg)
    try:
        c.whisper_device = "cpu"
    except Exception:
        pass
    return c


def dapatkan(rt) -> ASR:
    """satu objek ASR per worker (rt.cache["asr"])"""
    a = rt.cache.get("asr")
    if a is None:
        a = rt.cache["asr"] = ASR(rt.cfg)
    return a
