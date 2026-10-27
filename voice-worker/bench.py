"""
Ukur kecepatan mesin suara Chatterbox di laptop ini (cara lama vs cara baru) — TANPA Supabase / website / internet.
  UKUR-KECEPATAN.bat            (atau: .venv\\Scripts\\python bench.py)
  .venv\\Scripts\\python bench.py --ref "C:\\rekaman saya.wav"   (pakai rekaman referensi sendiri)

Yang diukur (kalimat bahasa Indonesia tetap, ±6–7 detik suara):
  A. cara lama  : model.generate() bawaan Chatterbox, 3 versi dibuat berurutan (apa adanya, termasuk hook yang bocor)
  B. cara baru  : jalur cepat fp32, 1 versi
  C. cara baru  : jalur cepat bf16, 3 versi SEKALIGUS (setelan bawaan worker kalau GPU mendukung bf16)
Hasil: tabel di layar + data/bench-<tanggal>.json + contoh suara data/bench-<cara>.wav untuk didengar.
Referensi suara: rekaman bank suara pertama di data/cache/voices (sudah diunduh worker), atau suara bawaan model (conds.pt).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from studio_worker import config  # noqa: E402

KALIMAT = "Selamat pagi semuanya, hari ini kita belajar cara membuat video pendek yang menarik dengan mudah."
SEEDS = [1234, 9153, 17072]
ST = {"exaggeration": 0.6, "cfg_weight": 0.35, "temperature": 0.8}


def koma(x, d: int = 1) -> str:
    return "-" if x is None else f"{float(x):.{d}f}".replace(".", ",")


def find_ref(cfg, want: str | None) -> Path | None:
    """rekaman referensi: --ref, atau rekaman bersih bank suara pertama yang sudah ada di laptop"""
    if want:
        p = Path(want).expanduser()
        return p if p.exists() else None
    folder = cfg.cache / "voices"
    if not folder.exists():
        return None
    got = sorted(folder.glob("*/clean-*.wav"))
    return got[0] if got else None


def table(rows: list[dict]) -> str:
    """tabel bahasa awam: suara jadi, waktu, kecepatan (detik suara per detik proses), langkah/detik, VRAM puncak"""
    head = ("Cara", "Versi", "Suara/versi", "Waktu", "Kecepatan", "Langkah/dtk", "VRAM puncak")
    lines = [head]
    for r in rows:
        lines.append(
            (
                r["cara"],
                str(r["versi"]),
                f"{koma(r['suara_per_versi'])} dtk",
                f"{koma(r['waktu'])} dtk",
                f"{koma(r['kecepatan'], 2)}× ",
                koma(r.get("langkah_per_dtk")),
                f"{koma(r.get('vram_gb'), 2)} GB" if r.get("vram_gb") is not None else "-",
            )
        )
    w = [max(len(x[i]) for x in lines) for i in range(len(head))]
    out = ["  ".join(c.ljust(w[i]) for i, c in enumerate(x)) for x in lines]
    out.insert(1, "  ".join("-" * n for n in w))
    return "\n".join(out)


def summary_text(rows: list[dict]) -> list[str]:
    by = {r["kode"]: r for r in rows}
    msg = ["Kecepatan = detik suara jadi per detik proses (makin besar makin cepat; 1,0× = secepat bicara)."]
    if "A" in by and "C" in by and by["A"]["kecepatan"] > 0:
        k = by["C"]["kecepatan"] / by["A"]["kecepatan"]
        per_a = by["A"]["waktu"] / max(1, by["A"]["versi"])
        msg.append(
            f"Cara baru C {koma(k)}× lebih cepat dari cara lama A: 3 versi jadi dalam {koma(by['C']['waktu'])} dtk "
            f"(cara lama {koma(by['A']['waktu'])} dtk, ±{koma(per_a)} dtk per versi)."
        )
    if "A" in by and by["A"].get("hook"):
        h = by["A"]["hook"]
        msg.append(f"Cara lama menambah hook tiap panggilan (bocor): {h} — makin lama worker hidup makin lambat. Cara baru: tetap.")
    return msg


def main() -> int:
    ap = argparse.ArgumentParser(description="Ukur kecepatan mesin suara Chatterbox (cara lama vs cara baru)")
    ap.add_argument("--ref", help="rekaman referensi .wav (bawaan: bank suara pertama di data/cache/voices)")
    ap.add_argument("--tanpa-lama", action="store_true", help="lewati cara lama A (lebih singkat)")
    a = ap.parse_args()

    cfg = config.load()
    from studio_worker import log as vlog

    log = vlog.setup(cfg.logs, "bench")
    import numpy as np
    import torch

    from studio_worker import ff
    from studio_worker.engines import EngineDown
    from studio_worker.engines import chatterbox_engine as cbe
    from studio_worker.engines import t3fast

    log.info("=== Ukur kecepatan mesin suara (cara lama vs cara baru) ===")
    try:
        gpu, vram = cbe.check_gpu()
    except EngineDown as e:
        log.error("GPU tidak bisa dipakai: %s", e)
        return 1
    log.info("GPU %s (%.1f GB), PyTorch %s CUDA %s", gpu, vram, torch.__version__, torch.version.cuda)
    want_c = cbe.want_dtype(cfg.tts_dtype if cfg.tts_dtype != "fp32" else "auto")
    cfg.tts_dtype = "fp32"  # dimuat fp32 dulu (A & B), lalu diubah ke bf16 untuk C
    t0 = time.time()
    try:
        eng = cbe.ChatterboxEngine(cfg)
    except EngineDown as e:
        log.error("Mesin Chatterbox tidak bisa dimuat: %s", e)
        return 1
    load_sec = time.time() - t0
    log.info("Muat mesin: %s dtk (%s)", koma(load_sec), getattr(eng.model, "_vw_times", {}))
    t0 = time.time()
    warm = eng.warmup()
    warm_sec = time.time() - t0
    log.info("Pemanasan: %s dtk %s", koma(warm_sec), warm)

    ref = find_ref(cfg, a.ref)
    ex, cw, temp = ST["exaggeration"], ST["cfg_weight"], ST["temperature"]
    if ref is not None:
        log.info("Referensi suara: %s", ref)
        eng._prepare(ref, ex)
        conds = eng.model.conds
    elif eng.builtin is not None:
        log.info("Tidak ada rekaman bank suara di data/cache/voices → pakai suara bawaan model (conds.pt)")
        conds = eng.builtin
        eng.model.conds = conds
        ex = float(conds.t3.emotion_adv.view(-1)[0].item())
    else:
        log.error("Tidak ada referensi suara (data/cache/voices kosong & model tanpa conds.pt). Pakai: bench.py --ref rekaman.wav")
        return 1
    if eng.fast is None:
        log.error("Jalur cepat tidak aktif di mesin ini — lihat log di atas.")
        return 1
    model, fast = eng.model, eng.fast
    kw = dict(exaggeration=ex, cfg_weight=cw, temperature=temp, max_new_tokens=t3fast.max_tokens_for(KALIMAT), **eng._fast_kw)
    rows: list[dict] = []
    out_dir = cfg.data

    def vram_reset():
        torch.cuda.synchronize()
        torch.cuda.reset_peak_memory_stats()

    def vram_peak() -> float:
        torch.cuda.synchronize()
        return torch.cuda.max_memory_allocated() / 1024**3

    def add(kode, cara, ys, wall, steps_per_sec, extra=None):
        durs = [len(y) / eng.sr for y in ys]
        tot = sum(durs)
        r = {
            "kode": kode, "cara": cara, "versi": len(ys), "suara_per_versi": round(tot / max(1, len(ys)), 2), "waktu": round(wall, 2),
            "kecepatan": round(tot / wall, 3) if wall > 0 else 0.0, "langkah_per_dtk": round(steps_per_sec, 1) if steps_per_sec else None,
            "vram_gb": round(vram_peak(), 2), **(extra or {}),
        }
        rows.append(r)
        try:
            ff.write_wav(out_dir / f"bench-{kode}.wav", np.concatenate([np.concatenate([y, np.zeros(eng.sr // 2, np.float32)]) for y in ys]), eng.sr)
        except Exception as e:
            log.warning("contoh suara %s tidak tersimpan: %s", kode, e)
        log.info("%s: %d versi, %s dtk suara/versi dalam %s dtk → %s× (%s langkah/dtk)", cara, len(ys), koma(r["suara_per_versi"]), koma(wall), koma(r["kecepatan"], 2), koma(steps_per_sec))

    # ---------------- A. cara lama: model.generate() bawaan, 3 versi berurutan (hook bocor apa adanya, dibersihkan sesudah tes)
    if not a.tanpa_lama:
        log.info("A. cara lama (model.generate bawaan, 3 versi berurutan)…")
        stamps: list[float] = []
        h = model.t3.speech_head.register_forward_hook(lambda m, i, o: stamps.append(time.perf_counter()))
        ys, hooks, rates = [], [], []
        vram_reset()
        t_all = time.time()
        try:
            with t3fast.no_leak(model.t3):
                for s in SEEDS:
                    stamps.clear()
                    torch.manual_seed(s)
                    torch.cuda.manual_seed_all(s)
                    extra = eng._sampling
                    if eng.mtl:
                        wav = model.generate(KALIMAT, language_id=eng.lang, exaggeration=ex, cfg_weight=cw, temperature=temp, **extra)
                    else:
                        wav = model.generate(KALIMAT, exaggeration=ex, cfg_weight=cw, temperature=temp, **extra)
                    ys.append(cbe.to_mono(wav))
                    hooks.append(t3fast.hook_count(model.t3))
                    if len(stamps) > 2:
                        rates.append((len(stamps) - 1) / (stamps[-1] - stamps[0]))
        finally:
            h.remove()
        add("A", "A. cara lama (3 berurutan)", ys, time.time() - t_all, sum(rates) / len(rates) if rates else None, {"hook": hooks})

    # ---------------- B. cara baru fp32, 1 versi
    log.info("B. cara baru fp32, 1 versi…")
    if fast.name_dtype != "fp32":
        fast.set_dtype("fp32", reload=eng._reload_fp32)
    vram_reset()
    t1 = time.time()
    ys = fast.generate(KALIMAT, 1, SEEDS[:1], conds=conds, **kw)
    add("B", "B. cara baru fp32 (1 versi)", ys, time.time() - t1, fast.last.get("steps_per_sec"), {"t3": dict(fast.last)})

    # ---------------- C. cara baru bf16 (kalau GPU mendukung), 3 versi sekaligus
    if want_c == "bf16":
        fast.set_dtype("bf16")
    log.info("C. cara baru %s, 3 versi sekaligus…", fast.name_dtype)
    vram_reset()
    t1 = time.time()
    ys = fast.generate(KALIMAT, 3, SEEDS, conds=conds, **kw)
    add("C", f"C. cara baru {fast.name_dtype} (3 sekaligus)", ys, time.time() - t1, fast.last.get("steps_per_sec"), {"t3": dict(fast.last)})

    print()
    print(table(rows))
    for m in summary_text(rows):
        print(m)
    stamp = datetime.now().strftime("%Y-%m-%d-%H%M")
    path = cfg.data / f"bench-{stamp}.json"
    data = {
        "waktu": stamp, "gpu": gpu, "vram_gb": round(vram, 1), "torch": torch.__version__, "cuda": torch.version.cuda,
        "kalimat": KALIMAT, "referensi": str(ref) if ref else "conds.pt", "muat_mesin_dtk": round(load_sec, 1),
        "muat_tahap": getattr(model, "_vw_times", {}), "pemanasan": {"dtk": round(warm_sec, 1), **warm}, "hasil": rows,
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"\nData lengkap: {path}")
    print(f"Contoh suara untuk didengar: {out_dir / 'bench-A.wav'} (lama), {out_dir / 'bench-C.wav'} (baru)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
