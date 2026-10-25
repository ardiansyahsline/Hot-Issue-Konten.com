"""
Cek kesiapan laptop: GPU + PyTorch (RTX 50xx / sm_120 butuh CUDA 12.8+), tes 1 kalimat Chatterbox di GPU.
Kalau Chatterbox gagal → tes pocket-tts di CPU dan tulis peringatan "pindah ke pocket-tts".
Juga cek ffmpeg, faster-whisper, DeepFilterNet, Node + Remotion (render).

  .venv\\Scripts\\python cek_gpu.py            (cek lengkap + tes suara)
  .venv\\Scripts\\python cek_gpu.py --cepat    (tanpa tes suara)
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from studio_worker import config  # noqa: E402

CFG = config.load()

from studio_worker import ff, jobs_render  # noqa: E402
from studio_worker import log as vlog  # noqa: E402

log = vlog.setup(CFG.logs, "cek-gpu")
REF = Path(__file__).resolve().parent / "bank-suara" / "referensi-alif-energik-10dtk.wav"
KALIMAT = "Halo semuanya! Ini tes suara dari laptop, semoga jernih dan enak didengar."
hasil: list[tuple[str, bool, str]] = []


def catat(nama: str, ok: bool, ket: str) -> None:
    hasil.append((nama, ok, ket))
    (log.info if ok else log.warning)("[%s] %s — %s", "OK" if ok else "GAGAL", nama, ket)


def cek_torch() -> bool:
    try:
        import torch
    except Exception as e:
        catat("PyTorch", False, f"belum terpasang ({e}) — jalankan install.ps1")
        return False
    if not torch.cuda.is_available():
        catat("GPU", False, f"PyTorch {torch.__version__} tidak melihat GPU (driver NVIDIA? torch versi CPU?)")
        return False
    name = torch.cuda.get_device_name(0)
    cap = torch.cuda.get_device_capability(0)
    vram = torch.cuda.get_device_properties(0).total_memory / 1024**3
    cuda = torch.version.cuda or "?"
    catat("GPU", True, f"{name}, {vram:.1f} GB VRAM, sm_{cap[0]}{cap[1]}, PyTorch {torch.__version__} (CUDA {cuda})")
    try:
        major, minor = (int(x) for x in cuda.split(".")[:2])
    except ValueError:
        major, minor = 0, 0
    if cap[0] >= 12 and (major, minor) < (12, 8):
        catat("PyTorch CUDA", False, f"GPU sm_{cap[0]}{cap[1]} (RTX 50xx) butuh build cu128 atau lebih baru, terpasang CUDA {cuda}. Jalankan ulang install.ps1")
        return False
    try:
        x = torch.randn(1024, 1024, device="cuda")
        t = time.time()
        for _ in range(20):
            x = x @ x
            x = x / x.norm()
        torch.cuda.synchronize()
        catat("Tes hitung GPU", True, f"{(time.time() - t) * 1000:.0f} ms")
    except Exception as e:
        catat("Tes hitung GPU", False, f"{e}")
        return False
    return True


def tes_mesin(nama: str) -> bool:
    from studio_worker.engines import Engines

    eng = Engines(CFG)
    try:
        t = time.time()
        e = eng.get(nama)
        muat = time.time() - t
        t = time.time()
        y = e.synth(KALIMAT, REF, {"exaggeration": 0.6, "cfg_weight": 0.35, "temperature": 0.8}, 1234)
        dt = time.time() - t
        dur = len(y) / e.sr
        out = CFG.data / f"tes-{nama}.wav"
        ff.write_wav(out, y, e.sr)
        catat(f"Mesin suara {nama}", dur > 0.5, f"muat {muat:.0f} dtk, {dur:.1f} dtk audio dalam {dt:.1f} dtk (x{dur / max(dt, 0.01):.1f} realtime) → dengarkan {out}")
        if e.credit:
            log.info("Kredit: %s", e.credit)
        return dur > 0.5
    except Exception as ex:
        catat(f"Mesin suara {nama}", False, str(ex)[:400])
        return False
    finally:
        eng.unload()


def cek_lain() -> None:
    catat("ffmpeg", ff.available(), "ada" if ff.available() else "tidak ditemukan — pasang ffmpeg & tambahkan ke PATH (lihat README)")
    try:
        import faster_whisper

        catat("faster-whisper", True, faster_whisper.__version__)
    except Exception as e:
        catat("faster-whisper", False, str(e)[:200])
    try:
        from studio_worker.clean import _shim_torchaudio

        _shim_torchaudio()
        import df.enhance  # noqa: F401

        catat("DeepFilterNet", True, "terpasang (model diunduh otomatis saat pertama dipakai)")
    except (Exception, SystemExit) as e:
        catat("DeepFilterNet", False, f"{e} — pembersih memakai ffmpeg sebagai cadangan")
    ok, why = jobs_render.check(CFG)
    catat("Render MP4 (Node + Remotion)", ok, why)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cepat", action="store_true", help="tanpa tes suara")
    a = ap.parse_args()
    log.info("=== Cek laptop untuk voice-worker ===")
    gpu_ok = cek_torch()
    cek_lain()
    if not a.cepat:
        cb = gpu_ok and tes_mesin("chatterbox")
        if not cb:
            log.warning("PERINGATAN: Chatterbox (GPU) belum bisa dipakai → pindah ke pocket-tts (CPU). Suara tetap jalan, hanya lebih lambat & kualitas sedikit di bawah.")
            tes_mesin("pocket")
    gagal = [h for h in hasil if not h[1]]
    log.info("=== Ringkasan: %d OK, %d perlu dicek ===", len(hasil) - len(gagal), len(gagal))
    for n, ok, ket in hasil:
        log.info("  %-30s %s", n, "OK" if ok else "GAGAL — " + ket[:160])
    return 0 if not gagal else 1


if __name__ == "__main__":
    sys.exit(main())
