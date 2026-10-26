"""
Skor kealamian take (supaya VO tidak terdengar "kayak AI"):
  1. nada: librosa.pyin di 16 kHz (fmin 65, fmax 400 Hz) → simpangan nada (semitone) frame bersuara + rasio bersuara.
     Bicara alami naik-turun ±2–4 semitone; di bawah ±1,8 st terdengar datar/monoton → penalti bertahap (MONO_ST).
  2. UTMOS (opsional): perkiraan MOS 1–5 "seberapa alami" dari tarepan/SpeechMOS (utmos22_strong, MIT, gratis) via torch.hub.
     Dimuat malas sekali (GPU bila ada), input 16 kHz satu klip per panggilan. Dimatikan lewat NATURAL_MOS=0 di .env.
     Gagal apa pun (tanpa internet / torch / error) → dimatikan untuk sesi itu + 1 baris peringatan; take tetap dipilih.
Aturan pilih (choose): kejelasan (skor WER/CER lama, lebih kecil = lebih jelas) tetap utama; take yang kejelasannya dalam +NEAR dari
yang terbaik bersaing di kealamian = MOS − penalti monoton.
"""
from __future__ import annotations

import math
import socket
import threading
from pathlib import Path

import numpy as np

from . import log as vlog

log = vlog.get("natural")

SR16 = 16000
FMIN, FMAX = 65.0, 400.0
# simpangan nada di bawah ini mulai terdengar datar; penalti naik bertahap sampai MONO_W saat nada benar-benar rata
MONO_ST = 1.8
MONO_W = 1.0
# take yang kejelasannya dalam +0,06 dari yang terbaik boleh bersaing di kealamian
NEAR = 0.06
# minimal frame bersuara supaya simpangan nada bisa dinilai (±0,3 dtk)
MIN_VOICED = 30
MOS_REPO = "tarepan/SpeechMOS:v1.2.0"
MOS_MODEL = "utmos22_strong"

_lock = threading.RLock()
_mos: dict = {"enabled": True, "hub_dir": None, "pred": None, "dev": "cpu", "off": None}


# ---------------------------------------------------------------- nada
def to16k(y: np.ndarray, sr: int) -> np.ndarray:
    y = np.asarray(y, dtype=np.float32)
    if y.ndim > 1:
        y = y.mean(axis=1)
    if sr == SR16 or y.size == 0:
        return y
    from scipy.signal import resample_poly

    g = math.gcd(int(sr), SR16)
    return resample_poly(y, SR16 // g, int(sr) // g).astype(np.float32)


def f0_track(y: np.ndarray, sr: int, hop: float = 0.01, resolution: float = 0.2) -> tuple[np.ndarray, np.ndarray] | None:
    """f0 (Hz, nan = tidak bersuara) & flag bersuara per frame `hop` detik (librosa.pyin di 16 kHz). Gagal / terlalu pendek → None.
    resolution 0,2 semitone: cukup untuk statistik simpangan nada & ±4× lebih cepat dari bawaan 0,1."""
    x = to16k(y, sr)
    if x.size < int(0.25 * SR16) or not np.isfinite(x).all() or float(np.max(np.abs(x))) < 1e-4:
        return None
    try:
        import librosa

        f0, vf, _ = librosa.pyin(x, fmin=FMIN, fmax=FMAX, sr=SR16, frame_length=1024, hop_length=max(1, int(round(hop * SR16))), resolution=resolution)
    except Exception as e:  # librosa tidak ada / error numerik → nada tidak dinilai (bukan alasan gagal)
        log.debug("pyin gagal: %s", e)
        return None
    f0 = np.asarray(f0, dtype=np.float64)
    vf = np.asarray(vf, dtype=bool) & np.isfinite(f0)
    return f0, vf


def semitone_std(f0: np.ndarray) -> float | None:
    """simpangan nada (semitone) frame bersuara terhadap median; 5% paling ekstrem tiap sisi dibuang (lompatan oktaf pyin)"""
    v = np.asarray(f0, dtype=np.float64)
    v = v[np.isfinite(v) & (v > 0)]
    if v.size < MIN_VOICED:
        return None
    st = 12.0 * np.log2(v / float(np.median(v)))
    lo, hi = np.percentile(st, [5, 95])
    st = st[(st >= lo) & (st <= hi)]
    return round(float(np.std(st)), 3) if st.size >= MIN_VOICED // 2 else None


def pitch_stats(y: np.ndarray, sr: int) -> dict:
    """{st: simpangan nada (semitone) | None, voiced: rasio frame bersuara, f0: median Hz | None}"""
    tr = f0_track(y, sr)
    if tr is None:
        return {"st": None, "voiced": 0.0, "f0": None}
    f0, vf = tr
    voiced = f0[vf]
    return {
        "st": semitone_std(voiced),
        "voiced": round(float(vf.mean()) if vf.size else 0.0, 3),
        "f0": round(float(np.median(voiced)), 1) if voiced.size else None,
    }


def mono_penalty(st: float | None) -> float:
    """0 bila nada cukup hidup (≥ MONO_ST); naik bertahap (linear) sampai MONO_W saat nada rata. Tidak bisa dinilai → 0."""
    if st is None:
        return 0.0
    return round(MONO_W * max(0.0, min(1.0, (MONO_ST - float(st)) / MONO_ST)), 4)


# ---------------------------------------------------------------- UTMOS (opsional)
def configure(enabled: bool = True, hub_dir: Path | None = None) -> None:
    """dipanggil tiap job tts dari config (NATURAL_MOS, folder model). Kalau sudah gagal di sesi ini → tetap mati."""
    with _lock:
        _mos["enabled"] = bool(enabled)
        if hub_dir is not None:
            _mos["hub_dir"] = Path(hub_dir)


def reset() -> None:
    """lupakan model & status gagal (untuk tes)"""
    with _lock:
        _mos.update({"enabled": True, "hub_dir": None, "pred": None, "dev": "cpu", "off": None})


def _disable(why: str) -> None:
    if _mos["off"] is None:
        log.warning("Skor kealamian UTMOS tidak dipakai di sesi ini (%s) — take tetap dipilih dari kejelasan + nada.", why[:200])
    _mos["off"] = why
    _mos["pred"] = None


def mos_status() -> str:
    if not _mos["enabled"]:
        return "mati (NATURAL_MOS=0)"
    if _mos["off"]:
        return f"tidak dipakai: {_mos['off'][:120]}"
    return "siap" if _mos["pred"] is not None else "belum dimuat"


def _predictor():
    with _lock:
        if not _mos["enabled"] or _mos["off"] is not None:
            return None
        if _mos["pred"] is not None:
            return _mos["pred"]
        old = socket.getdefaulttimeout()
        try:
            import torch

            if _mos["hub_dir"] is not None:
                Path(_mos["hub_dir"]).mkdir(parents=True, exist_ok=True)
                torch.hub.set_dir(str(_mos["hub_dir"]))
            log.info("Memuat penilai kealamian UTMOS (sekali; pertama kali mengunduh ±410 MB dari GitHub)…")
            socket.setdefaulttimeout(60)  # unduhan macet tidak boleh menggantung job selamanya
            model = torch.hub.load(MOS_REPO, MOS_MODEL, trust_repo=True, verbose=False, skip_validation=True)
            dev = "cuda" if torch.cuda.is_available() else "cpu"
            model = model.to(dev).eval()
            _mos["pred"], _mos["dev"] = model, dev
            log.info("UTMOS siap (%s).", dev)
            return model
        except (Exception, SystemExit) as e:
            _disable(f"{type(e).__name__}: {e}")
            return None
        finally:
            socket.setdefaulttimeout(old)


def mos(y: np.ndarray, sr: int) -> float | None:
    """perkiraan MOS 1–5 (lebih besar = lebih alami) satu klip; tidak tersedia / gagal → None (dan dimatikan untuk sesi ini)"""
    pred = _predictor()
    if pred is None:
        return None
    x = to16k(y, sr)
    if x.size < int(0.3 * SR16):
        return None
    try:
        import torch

        with torch.inference_mode():
            t = torch.from_numpy(np.ascontiguousarray(x, dtype=np.float32)).unsqueeze(0)
            if _mos["dev"] != "cpu":
                t = t.to(_mos["dev"])
            out = pred(t, SR16)
            v = float(out.reshape(-1)[0].item()) if hasattr(out, "reshape") else float(out)
        return round(v, 3) if math.isfinite(v) else None
    except Exception as e:
        _disable(f"{type(e).__name__}: {e}")
        return None


# ---------------------------------------------------------------- gabungan
def naturalness(y: np.ndarray, sr: int, use_mos: bool = True) -> dict:
    """info kealamian satu take: {st, voiced, mono, mos} (mos None bila tidak dipakai / tidak tersedia)"""
    p = pitch_stats(y, sr)
    return {"st": p["st"], "voiced": p["voiced"], "mono": mono_penalty(p["st"]), "mos": mos(y, sr) if use_mos else None}


def nat_value(sc: dict, with_mos: bool) -> float:
    return (float(sc["mos"]) if with_mos else 0.0) - float(sc.get("mono") or 0.0)


def choose(scores: list[dict], near: float = NEAR) -> int:
    """indeks take terpilih. Kejelasan (`score`, lebih kecil = lebih jelas) utama; yang dalam +near dari terbaik bersaing di
    kealamian (MOS − penalti monoton; MOS hanya dipakai kalau semua pesaing punya MOS). Seri → yang lebih jelas."""
    if not scores:
        raise ValueError("tidak ada take")
    best = min(float(s["score"]) for s in scores)
    pool = [i for i, s in enumerate(scores) if float(s["score"]) <= best + near + 1e-9]
    with_mos = all(scores[i].get("mos") is not None for i in pool)
    return max(pool, key=lambda i: (round(nat_value(scores[i], with_mos), 4), -float(scores[i]["score"]), -i))
