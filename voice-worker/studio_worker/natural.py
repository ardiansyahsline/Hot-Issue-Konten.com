"""
Kealamian VO bank suara (supaya tidak terdengar "kayak AI").

Skor kealamian take:
  1. nada: librosa.pyin di 16 kHz (fmin 65, fmax 400 Hz) → simpangan nada (semitone) frame bersuara + rasio bersuara.
     Bicara alami naik-turun ±2–4 semitone; di bawah ±1,8 st terdengar datar/monoton → penalti bertahap (MONO_ST).
  2. UTMOS (opsional): perkiraan MOS 1–5 "seberapa alami" dari tarepan/SpeechMOS (utmos22_strong, MIT, gratis) via torch.hub.
     HANYA dari file lokal (SIAPKAN-MODEL.bat / unduhan latar menaruhnya di data/models/torch-hub) — tidak pernah mengunduh di
     tengah job. Belum diunduh → dilewati (take dipilih dari kejelasan + nada), dicek ulang murah tiap 60 dtk, otomatis dipakai
     begitu unduhan selesai. Dimuat sekali (GPU bila ada), input 16 kHz satu klip per panggilan. Dimatikan lewat NATURAL_MOS=0.
     Gagal muat (torch / file rusak) → dimatikan untuk sesi itu + 1 baris peringatan; take tetap dipilih.
Aturan pilih (choose): kejelasan (skor WER/CER lama, lebih kecil = lebih jelas) tetap utama; take yang kejelasannya dalam +NEAR dari
yang terbaik bersaing di kealamian = MOS − penalti monoton.

Sambungan & jeda (bukan hening digital):
  - trim_take: hening awal/akhir take dibuang TANPA memakan ekor napas / nada turun akhir kalimat (sisa 150 ms + fade 30 ms).
  - room tone: lantai noise dari bagian paling sunyi klip referensi (cadangan: noise pink sangat pelan, ±-62 dBFS setelah VO
    dinormalkan), levelnya mengikuti lantai take di sekitarnya.
  - join: potongan disambung dengan jeda room tone + crossfade equal-power 20 ms; panjang hasil = Σ potongan + Σ jeda (persis).
  - tidy_pauses: jeda antar kalimat di dalam take satu-tarikan dirapikan ke rentang alami (0,25–0,6 dtk; sesudah "…" 0,45–0,7)
    — terlalu pendek ditambah room tone (hanya hening ≥ 120 ms yang jelas jeda; koma ikut dipasangkan tapi tidak pernah
    dipanjangkan), terlalu panjang dipotong di tengah (crossfade).
  - match_levels: potongan yang disambung disamakan level bicaranya (sisa beda ≤ 1,5 dB, koreksi maks ±4 dB).
"""
from __future__ import annotations

import math
import re
import threading
import time
from pathlib import Path

import numpy as np

from . import log as vlog
from . import meter
from . import text as T

log = vlog.get("natural")

SR16 = 16000
FMIN, FMAX = 65.0, 400.0
# simpangan nada di bawah ini mulai terdengar datar; penalti naik bertahap sampai MONO_W saat nada benar-benar rata
MONO_ST = 1.8
MONO_W = 1.0
# take yang kejelasannya dalam +0,06 dari yang terbaik boleh bersaing di kealamian
NEAR = 0.06
# minimal bagian bersuara supaya simpangan nada bisa dinilai: 0,3 dtk (MIN_VOICED = jumlah frame pada hop 10 ms)
MIN_VOICED_SEC = 0.3
MIN_VOICED = 30
MOS_REPO = "tarepan/SpeechMOS:v1.2.0"
MOS_MODEL = "utmos22_strong"
RECHECK_SEC = 60.0  # UTMOS belum diunduh → cek file lagi paling cepat tiap 60 dtk (murah: hanya stat)
MISSING = "belum diunduh"

_lock = threading.RLock()
# off = alasan tidak dipakai; missing = True kalau alasannya file belum ada (boleh dicek ulang), checked = waktu cek terakhir
_mos: dict = {"enabled": True, "hub_dir": None, "pred": None, "dev": "cpu", "off": None, "missing": False, "checked": 0.0, "gen": -1}


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


def semitone_std(f0: np.ndarray, min_n: int = MIN_VOICED) -> float | None:
    """simpangan nada (semitone) frame bersuara terhadap median; 5% paling ekstrem tiap sisi dibuang (lompatan oktaf pyin).
    `min_n` = minimal frame bersuara (bawaan untuk hop 10 ms = 0,3 dtk)"""
    v = np.asarray(f0, dtype=np.float64)
    v = v[np.isfinite(v) & (v > 0)]
    if v.size < min_n:
        return None
    st = 12.0 * np.log2(v / float(np.median(v)))
    lo, hi = np.percentile(st, [5, 95])
    st = st[(st >= lo) & (st <= hi)]
    return round(float(np.std(st)), 3) if st.size >= min_n // 2 else None


def pitch_stats(y: np.ndarray, sr: int, hop: float = 0.02) -> dict:
    """{st: simpangan nada (semitone) | None, voiced: rasio frame bersuara, f0: median Hz | None}.
    hop 20 ms: statistik sama dengan 10 ms tapi ±2× lebih cepat (penting karena tiap take dinilai)."""
    tr = f0_track(y, sr, hop=hop)
    if tr is None:
        return {"st": None, "voiced": 0.0, "f0": None}
    f0, vf = tr
    voiced = f0[vf]
    return {
        "st": semitone_std(voiced, max(8, int(round(MIN_VOICED_SEC / hop)))),  # 0,3 dtk bersuara, berapa pun hop-nya
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
        _mos.update({"enabled": True, "hub_dir": None, "pred": None, "dev": "cpu", "off": None, "missing": False, "checked": 0.0, "gen": -1})


def refresh() -> None:
    """dipanggil models.prepare setelah UTMOS selesai diunduh: lupakan tanda 'tidak dipakai' supaya langsung dicoba lagi"""
    with _lock:
        if _mos["pred"] is None:
            _mos.update({"off": None, "missing": False, "checked": 0.0})


def _disable(why: str) -> None:
    if _mos["off"] is None or _mos["missing"]:
        log.warning("Skor kealamian UTMOS tidak dipakai di sesi ini (%s) — take tetap dipilih dari kejelasan + nada.", why[:200])
    _mos["off"] = why
    _mos["missing"] = False
    _mos["pred"] = None


def _not_downloaded() -> None:
    first = _mos["off"] is None
    _mos.update({"off": MISSING, "missing": True, "checked": time.monotonic(), "pred": None, "gen": _models_gen()})
    if first:  # sekali saja (cek ulang tiap 60 dtk tidak menulis log lagi)
        log.info("Penilai kealamian UTMOS belum diunduh — take dipilih dari kejelasan + nada dulu; otomatis dipakai setelah "
                 "unduhan selesai (SIAPKAN-MODEL.bat / unduhan latar).")


def _models_gen() -> int:
    try:
        from . import models

        return models.ready_gen()
    except Exception:
        return 0


def unload() -> None:
    """lepas model UTMOS dari memori (worker menganggur); dimuat lagi otomatis saat dibutuhkan"""
    with _lock:
        _mos["pred"] = None


def mos_status() -> str:
    if not _mos["enabled"]:
        return "mati (NATURAL_MOS=0)"
    if _mos["off"]:
        if _mos["missing"]:
            return f"tidak dipakai: {MISSING} (jalankan SIAPKAN-MODEL.bat)"
        return f"tidak dipakai: {_mos['off'][:120]}"
    return "siap" if _mos["pred"] is not None else "belum dimuat"


def _no_download(*a, **k):
    raise RuntimeError("UTMOS mencoba mengunduh di tengah job — file model belum lengkap, jalankan SIAPKAN-MODEL.bat")


def _predictor():
    """model UTMOS dari file LOKAL saja; belum ada → None (job tidak pernah menunggu unduhan)"""
    with _lock:
        if not _mos["enabled"]:
            return None
        if _mos["pred"] is not None:
            return _mos["pred"]
        if _mos["off"] is not None:
            if not _mos["missing"]:
                return None  # gagal muat (torch / file rusak) → mati untuk sesi ini
            gen = _models_gen()
            if gen == _mos["gen"] and time.monotonic() - _mos["checked"] < RECHECK_SEC:
                return None  # baru dicek & belum ada unduhan baru
            _mos["gen"] = gen
        hub = _mos["hub_dir"]
        from . import models

        if hub is None or not models.utmos_ready(hub):
            _not_downloaded()
            return None
        repo_dir, _ckpt = models.utmos_paths(hub)
        try:
            import torch

            hubmod = torch.hub
            old_dir = hubmod.get_dir() if hasattr(hubmod, "get_dir") else None
            old_dl = getattr(hubmod, "download_url_to_file", None)
            log.info("Memuat penilai kealamian UTMOS dari file lokal (sekali)…")
            try:
                hubmod.set_dir(str(hub))  # checkpoint dicari di <hub>/checkpoints/
                if old_dl is not None:
                    hubmod.download_url_to_file = _no_download  # jaring pengaman: dilarang mengunduh di job
                model = hubmod.load(str(repo_dir), MOS_MODEL, source="local", trust_repo=True)
            finally:
                if old_dl is not None:
                    hubmod.download_url_to_file = old_dl
                if old_dir is not None:
                    hubmod.set_dir(old_dir)
            dev = "cuda" if torch.cuda.is_available() else "cpu"
            model = model.to(dev).eval()
            _mos.update({"pred": model, "dev": dev, "off": None, "missing": False})
            log.info("UTMOS siap (%s).", dev)
            return model
        except (Exception, SystemExit) as e:
            _disable(f"{type(e).__name__}: {e}")
            return None


def warm() -> bool:
    """muat UTMOS sekarang (mis. saat worker mulai) kalau filenya sudah ada; True = siap"""
    return _predictor() is not None


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


def summary(infos: list[dict]) -> dict:
    """ringkasan kealamian satu baris dari info take terpilih tiap potongan: rata-rata MOS & simpangan nada (berbobot durasi)"""
    def avg(key: str) -> float | None:
        vals = [(float(i[key]), max(0.05, float(i.get("dur") or 0.05))) for i in infos if isinstance(i, dict) and isinstance(i.get(key), (int, float))]
        if not vals:
            return None
        w = sum(b for _, b in vals)
        return round(sum(a * b for a, b in vals) / w, 3)

    st = avg("st")
    return {"mos": avg("mos"), "st": st, "mono": round(mono_penalty(st), 3) if st is not None else None}


# ---------------------------------------------------------------- ujung take
HEAD_PAD = 0.05  # sisa sebelum suara pertama (tarikan napas awal tidak terpotong)
TAIL_PAD = 0.15  # sisa sesudah suara terakhir: ekor napas / nada turun akhir kalimat (±120–180 ms)
TAIL_FADE = 0.03  # fade-out di ujung sisa itu


def _fade_curve(n: int, out: bool) -> np.ndarray:
    t = (np.arange(n, dtype=np.float64) + 0.5) / max(1, n)
    c = np.sin(0.5 * np.pi * t) ** 2  # halus di kedua ujung (raised-cosine)
    return (c[::-1] if out else c).astype(np.float32)


def trim_take(y: np.ndarray, sr: int, thr_db: float = -50.0, head: float = HEAD_PAD, tail: float = TAIL_PAD, fade_out: float = TAIL_FADE) -> np.ndarray:
    """
    buang hening awal/akhir take TANPA memakan ekor kalimat: suara = jendela 20 ms di atas max(thr_db, puncak − 40 dB) (sama dengan
    meter.trim_silence); sisa `head` sebelum suara pertama & `tail` (150 ms) sesudah suara terakhir supaya napas / nada turun akhir
    kalimat utuh, lalu fade-out 30 ms HANYA di bagian sisa itu (bukan di suaranya). Fade-in 5 ms anti-klik.
    """
    y = np.asarray(y, dtype=np.float32)
    if y.ndim > 1:
        y = y.mean(axis=1)
    if y.size == 0:
        return y
    fd = meter.frame_db(y, sr, 0.02, 0.01)
    on = np.where(fd > max(thr_db, float(fd.max()) - 40.0))[0]
    if not len(on):
        return y
    h = max(1, int(0.01 * sr))
    first = int(on[0]) * h
    end_voice = min(len(y), (int(on[-1]) + 2) * h)
    s = max(0, first - int(head * sr))
    e = min(len(y), end_voice + int(tail * sr))
    out = y[s:e].copy()
    a = min(len(out), int(0.005 * sr), max(0, first - s))
    if a > 1:
        out[:a] *= _fade_curve(a, False)
    room = e - end_voice
    b = int(fade_out * sr) if room >= int(fade_out * sr) else max(min(room, len(out)), int(0.005 * sr))
    b = min(b, len(out))
    if b > 1:
        out[-b:] *= _fade_curve(b, True)
    return out


def edge_quiet(y: np.ndarray, sr: int, thr_db: float = -50.0) -> tuple[float, float]:
    """(detik hening di awal, detik hening di akhir) — ambang sama dengan trim_take"""
    if y.size == 0:
        return 0.0, 0.0
    fd = meter.frame_db(y, sr, 0.02, 0.01)
    on = np.where(fd > max(thr_db, float(fd.max()) - 40.0))[0]
    if not len(on):
        return len(y) / sr, 0.0
    h = max(1, int(0.01 * sr))
    return int(on[0]) * h / sr, max(0, len(y) - min(len(y), (int(on[-1]) + 2) * h)) / sr


# ---------------------------------------------------------------- room tone
XFADE = 0.02  # crossfade equal-power sambungan (15–25 ms)
# level room tone relatif terhadap level bicara (persentil 90 energi frame): ikut lantai take di sekitarnya, dijaga di rentang ini
ROOM_REL_LO, ROOM_REL_HI, ROOM_REL = -58.0, -44.0, -52.0
_BEDS: dict[tuple[str, int], np.ndarray | None] = {}


def _ep(n: int) -> tuple[np.ndarray, np.ndarray]:
    """kurva crossfade equal-power (keluar, masuk): cos² + sin² = 1 → daya tetap untuk sinyal yang tidak berkorelasi"""
    t = (np.arange(n, dtype=np.float64) + 0.5) / max(1, n)
    return np.cos(0.5 * np.pi * t).astype(np.float32), np.sin(0.5 * np.pi * t).astype(np.float32)


def _chain(pieces: list[np.ndarray], sr: int, xf: float = 0.01) -> np.ndarray:
    """sambung potongan noise dengan crossfade equal-power pendek"""
    out = np.asarray(pieces[0], dtype=np.float32)
    for p in pieces[1:]:
        p = np.asarray(p, dtype=np.float32)
        x = max(1, min(int(xf * sr), len(out) // 2, len(p) // 2))
        fo, fi = _ep(x)
        out = np.concatenate([out[:-x], out[-x:] * fo + p[:x] * fi, p[x:]])
    return out


def room_bed(y: np.ndarray, sr: int, min_sec: float = 0.25) -> np.ndarray | None:
    """
    room tone dari bagian PALING SUNYI rekaman (jendela 30 ms dalam 4 dB dari lantai persentil 5, minimal 80 ms berturut-turut,
    tepinya dibuang 10 ms). Hening digital (< -100 dBFS, mis. padding nol di ujung file) tidak dihitung. Tidak ada bagian sunyi yang
    layak (lantai < -90 dBFS atau > -30 dBFS, total < min_sec) → None.
    """
    y = np.asarray(y, dtype=np.float32)
    if y.ndim > 1:
        y = y.mean(axis=1)
    fd = meter.frame_db(y, sr, 0.03, 0.01)
    real = fd > -100.0
    if int(real.sum()) < 30:
        return None
    floor = float(np.percentile(fd[real], 5))
    if floor < -90.0 or floor > -30.0:
        return None
    quiet = (fd <= floor + 4.0) & real
    h, w, edge = int(0.01 * sr), int(0.03 * sr), int(0.01 * sr)
    pieces, start = [], None
    for i, q in enumerate(np.append(quiet, False)):
        if q and start is None:
            start = i
        elif not q and start is not None:
            if i - start >= 8:
                s0, e0 = start * h + edge, (i - 1) * h + w - edge
                if e0 - s0 >= int(0.05 * sr):
                    pieces.append(y[s0:e0])
            start = None
    if not pieces or sum(len(p) for p in pieces) < int(min_sec * sr):
        return None
    bed = _chain(pieces, sr)
    bed = (bed - float(bed.mean())).astype(np.float32)
    rms = float(np.sqrt(np.mean(bed.astype(np.float64) ** 2)))
    return bed if rms > 1e-7 else None


def ref_bed(ref: Path | str | None, sr: int) -> np.ndarray | None:
    """room tone dari klip referensi suara (dibaca & dicache sekali per file + sample rate). Gagal apa pun → None (pakai noise pink)."""
    if not ref:
        return None
    key = (str(ref), int(sr))
    if key in _BEDS:
        return _BEDS[key]
    bed = None
    try:
        from . import ff

        y, rsr = ff.read_wav(Path(ref))
        if y.ndim > 1:
            y = y.mean(axis=1)
        bed = room_bed(y, rsr)
        if bed is not None and rsr != sr:
            from scipy.signal import resample_poly

            g = math.gcd(int(rsr), int(sr))
            bed = resample_poly(bed, int(sr) // g, int(rsr) // g).astype(np.float32)
    except Exception as e:
        log.debug("room tone referensi gagal dibaca (%s) — pakai noise pink", e)
        bed = None
    if len(_BEDS) > 32:
        _BEDS.clear()
    _BEDS[key] = bed
    if bed is None:
        log.info("Room tone: referensi tidak punya bagian sunyi yang layak — jeda diisi noise pink sangat pelan.")
    return bed


def pink(n: int, rng: np.random.Generator) -> np.ndarray:
    """noise pink (1/f) RMS 1"""
    if n <= 0:
        return np.zeros(0, np.float32)
    m = max(n, 256)
    spec = np.fft.rfft(rng.standard_normal(m))
    f = np.arange(spec.size, dtype=np.float64)
    f[0] = 1.0
    x = np.fft.irfft(spec / np.sqrt(f), m)[:n]
    x -= x.mean()
    r = float(np.sqrt(np.mean(x**2))) or 1.0
    return (x / r).astype(np.float32)


def room(n: int, sr: int, bed: np.ndarray | None, level_db: float, seed: int = 0) -> np.ndarray:
    """room tone `n` sampel di level RMS `level_db` dBFS: potongan acak dari `bed` disambung crossfade; bed kosong → noise pink"""
    if n <= 0:
        return np.zeros(0, np.float32)
    rng = np.random.default_rng(abs(int(seed)) % (2**32))
    if bed is None or len(bed) < int(0.06 * sr):
        x = pink(n, rng)
    else:
        seg = min(len(bed), int(0.5 * sr))
        pieces, total = [], 0
        while total < n + seg:
            off = int(rng.integers(0, len(bed) - seg + 1))
            pieces.append(bed[off : off + seg])
            total += seg - int(0.01 * sr)
        x = _chain(pieces, sr)[:n]
        r = float(np.sqrt(np.mean(x.astype(np.float64) ** 2))) or 1.0
        x = x / r
    return (x * (10 ** (level_db / 20))).astype(np.float32)


def room_level(sr: int, *ys: np.ndarray) -> float:
    """level room tone (dBFS) untuk sambungan: lantai (persentil 5) take di sekitarnya, dijaga −58…−44 dB di bawah level bicara
    (persentil 90). Take yang hening-digital (lantai < -85 dBFS) → −52 dB di bawah bicara (±-62 dBFS setelah VO dinormalkan)."""
    fds = [meter.frame_db(np.asarray(y, dtype=np.float32), sr, 0.03, 0.01) for y in ys if y is not None and len(y) >= int(0.03 * sr)]
    if not fds:
        return -62.0
    fd = np.concatenate(fds)
    speech = float(np.percentile(fd, 90))
    floor = float(np.percentile(fd, 5))
    lvl = floor if floor > -85.0 else speech + ROOM_REL
    return round(float(min(speech + ROOM_REL_HI, max(speech + ROOM_REL_LO, lvl))), 2)


def splice(a: np.ndarray, b: np.ndarray, gap: float, sr: int, bed: np.ndarray | None = None, seed: int = 0, xf: float = XFADE, level_db: float | None = None) -> np.ndarray:
    """a + room tone `gap` dtk + b. Room tone (gap + 2·xf) tumpang-tindih xf dengan ujung a & awal b (crossfade equal-power),
    jadi panjang hasil = len(a) + gap + len(b) PERSIS (waktu kata tetap bisa dihitung)."""
    a = np.asarray(a, dtype=np.float32)
    b = np.asarray(b, dtype=np.float32)
    if a.size == 0 or b.size == 0:
        return np.concatenate([a, b]) if gap <= 0 else np.concatenate([a, room(int(round(gap * sr)), sr, bed, -62.0 if level_db is None else level_db, seed), b])
    n = int(round(max(0.0, float(gap)) * sr))
    x = max(1, min(int(round(xf * sr)), len(a) // 2 or 1, len(b) // 2 or 1))
    lvl = room_level(sr, a, b) if level_db is None else level_db
    r = room(n + 2 * x, sr, bed, lvl, seed)
    fo, fi = _ep(x)
    return np.concatenate([a[:-x], a[-x:] * fo + r[:x] * fi, r[x : x + n], r[x + n :] * fo + b[:x] * fi, b[x:]]).astype(np.float32)


def cut(y: np.ndarray, i: int, j: int, sr: int, xf: float = 0.01) -> np.ndarray:
    """buang y[i:j] dengan crossfade equal-power `xf` di titik potong (tanpa klik); panjang hasil = len(y) − (j − i) PERSIS"""
    y = np.asarray(y, dtype=np.float32)
    i, j = max(0, int(i)), min(len(y), int(j))
    if j <= i:
        return y
    hx = max(0, min(int(xf * sr / 2), i, len(y) - j))
    if hx < 1:
        return np.concatenate([y[:i], y[j:]])
    fo, fi = _ep(2 * hx)
    return np.concatenate([y[: i - hx], y[i - hx : i + hx] * fo + y[j - hx : j + hx] * fi, y[j + hx :]]).astype(np.float32)


LEVEL_TOL, LEVEL_MAX = 1.5, 4.0  # beda level bicara antar potongan ≤ 1,5 dB dibiarkan (variasi alami); sisanya disamakan, maks ±4 dB


def speech_level(y: np.ndarray, sr: int) -> float | None:
    """level bicara (dBFS): persentil 90 energi frame 30 ms; klip < 0,3 dtk / hening → None"""
    y = np.asarray(y, dtype=np.float32)
    if y.size < int(0.3 * sr):
        return None
    v = float(np.percentile(meter.frame_db(y, sr, 0.03, 0.01), 90))
    return v if v > -70.0 else None


def match_levels(parts: list[np.ndarray], sr: int, tol: float = LEVEL_TOL, max_db: float = LEVEL_MAX) -> list[np.ndarray]:
    """samakan level bicara potongan yang akan disambung (take tiap potongan bisa beda 2–4 dB → lompatan volume di sambungan):
    acuan = median level semua potongan; beda ≤ tol dibiarkan, sisanya dikoreksi maks ±max_db dan tidak sampai clipping."""
    lv = [speech_level(p, sr) if p is not None else None for p in parts]
    ok = [v for v in lv if v is not None]
    if len(ok) < 2:
        return list(parts)
    ref = float(np.median(ok))
    out = []
    for p, v in zip(parts, lv):
        if v is None:
            out.append(p)
            continue
        d = ref - v
        g = math.copysign(min(max_db, max(0.0, abs(d) - tol / 2)), d)  # tiap potongan ≤ tol/2 dari acuan → antar potongan ≤ tol
        if abs(g) < 0.05:
            out.append(p)
            continue
        peak = float(np.max(np.abs(p))) if len(p) else 0.0
        if peak > 0 and g > 0:
            g = min(g, 20 * math.log10(0.98 / peak)) if peak < 0.98 else 0.0
        out.append((np.asarray(p, dtype=np.float32) * np.float32(10 ** (g / 20))).astype(np.float32) if g else p)
    return out


def join(parts: list[np.ndarray], gaps: list[float], sr: int, bed: np.ndarray | None = None, seed: int = 0, xf: float = XFADE) -> np.ndarray:
    """sambung potongan dengan jeda room tone (BUKAN np.zeros) + crossfade equal-power; panjang = Σ potongan + Σ jeda"""
    ps = [np.asarray(p, dtype=np.float32) for p in parts if p is not None and len(p)]
    if not ps:
        return np.zeros(0, np.float32)
    out = ps[0]
    for i, p in enumerate(ps[1:]):
        g = float(gaps[i]) if i < len(gaps) else 0.0
        out = splice(out, p, g, sr, bed, seed * 7919 + i + 1, xf)
    return out


# ---------------------------------------------------------------- jeda alami antar kalimat
PAUSE_LO, PAUSE_HI = 0.25, 0.60
ELLIPSIS_LO, ELLIPSIS_HI = 0.45, 0.70
# jeda kalimat yang boleh dipanjangkan minimal sepanjang ini: jeda kalimat asli Chatterbox hampir selalu ≥ 120 ms, sedangkan sela antar
# kata / penutupan konsonan (k, p, t, c) ≤ 100 ms — memanjangkan yang terakhir = kata terdengar putus di tengah
MIN_GROW = 0.12
GROW_DISTINCT = 1.6  # ...dan minimal 1,6× median sela antar kata di take itu
WORD_GAP = 0.08  # perkiraan sela antar kata bila take tidak punya cukup sela lain untuk dihitung mediannya


def _end(sentence: str) -> str:
    return (sentence or "").rstrip(" \"'”’)]")


def pause_range(sentence: str) -> tuple[float, float]:
    """rentang jeda alami sesudah kalimat: 0,25–0,6 dtk; sesudah "…" 0,45–0,7 dtk"""
    return (ELLIPSIS_LO, ELLIPSIS_HI) if _end(sentence).endswith("…") else (PAUSE_LO, PAUSE_HI)


def natural_pause(sentence: str, rnd) -> float:
    """jeda sasaran sesudah kalimat (di dalam rentang alami, sedikit acak tapi konsisten)"""
    s = _end(sentence)
    if s.endswith("…"):
        return round(rnd.uniform(0.50, 0.65), 3)
    if s.endswith(("?", "!")):
        return round(rnd.uniform(0.32, 0.45), 3)
    if s.endswith((",", ";", ":")):
        return round(rnd.uniform(0.25, 0.30), 3)
    return round(rnd.uniform(0.30, 0.45), 3)


def natural_pauses(sentences: list[str], key: str = "") -> list[float]:
    rnd = T.seeded_rng("jeda-alami", key, *sentences)
    return [natural_pause(s, rnd) for s in sentences[:-1]]


def pause_points(sentences: list[str]) -> list[str]:
    """potongan teks di setiap titik jeda kalimat (. ! ? …), TANPA menggabung potongan 1 kata — "Tenang… sekarang ada caranya."
    → ["Tenang…", "sekarang ada caranya."] supaya jeda menggantung sesudah "…" ikut dijaga. Titik singkatan (dll., Rp.) bukan jeda."""
    t = T._ABBR.sub(lambda m: m.group(1) + T._DOT, " ".join(s.strip() for s in sentences if s and s.strip()))
    return [p.replace(T._DOT, ".") for p in re.split(r"(?<=[.!?…])[\"'”’)\]]*\s+", t) if p.strip()]


def pause_marks(sentences: list[str]) -> list[tuple[str, bool]]:
    """potongan teks di setiap titik jeda kalimat (. ! ? …) DAN koma (, ; :) → [(teks, jeda_kalimat)]. Koma ikut jadi penanda supaya
    jeda koma tidak tertukar dengan jeda kalimat yang hampir tidak berhenti (koma tidak pernah dipanjangkan). "2,5%" bukan koma jeda."""
    out: list[tuple[str, bool]] = []
    for p in pause_points(sentences):
        segs = [x for x in re.split(r"(?<=[,;:])[\"'”’)\]]*\s+", p) if x.strip()]
        out += [(x, i == len(segs) - 1) for i, x in enumerate(segs)]
    return out


def assign_pauses(runs_: list[tuple[float, float]], marks: list[tuple[str, bool]], span: tuple[float, float]) -> dict[int, int]:
    """
    pasangkan titik jeda (sesudah tiap penanda kecuali yang terakhir) ke hening secara MONOTON (urutan teks = urutan waktu) dengan DP
    yang memaksimalkan Σ panjang/(1 + jarak/jendela); posisi perkiraan sebanding jumlah huruf, jendela ±max(0,6 dtk, 15% ucapan).
    Balikan {indeks hening: indeks penanda}. Penanda tanpa hening yang cocok dibiarkan (tidak dipaksa).
    """
    if len(marks) < 2 or not runs_:
        return {}
    sa, sb = span
    lens = [len(t) for t, _ in marks]
    total = sum(lens) + len(marks) - 1
    dur = max(0.1, sb - sa)
    win = max(0.6, 0.15 * dur)
    exp, pos = [], 0
    for i in range(len(marks) - 1):
        pos += lens[i] + (1 if i else 0)
        exp.append(sa + dur * (pos + 0.5) / total)
    M, R = len(exp), len(runs_)

    def sc(i: int, j: int) -> float:
        a, b = runs_[j]
        d = abs((a + b) / 2 - exp[i])
        return -1.0 if d > win else (b - a) / (1.0 + d / win)

    dp = np.zeros((M + 1, R + 1))
    how = np.zeros((M + 1, R + 1), dtype=np.int8)  # 0 lewati penanda, 1 lewati hening, 2 pasangkan
    for i in range(1, M + 1):
        for j in range(R + 1):
            best, h = dp[i - 1][j], 0
            if j and dp[i][j - 1] > best:
                best, h = dp[i][j - 1], 1
            if j:
                v = sc(i - 1, j - 1)
                if v >= 0 and dp[i - 1][j - 1] + v > best + 1e-12:
                    best, h = dp[i - 1][j - 1] + v, 2
            dp[i][j], how[i][j] = best, h
    out: dict[int, int] = {}
    i, j = M, R
    while i > 0:
        h = int(how[i][j])
        if h == 2:
            out[j - 1] = i - 1
            i, j = i - 1, j - 1
        elif h == 1:
            j -= 1
        else:
            i -= 1
    return out


def gap_fill(a: np.ndarray, b: np.ndarray, sr: int, target: float) -> float:
    """room tone yang perlu disisipkan supaya jeda terdengar = target (hening sisa di ujung a & awal b ikut dihitung)"""
    _, tail = edge_quiet(a, sr)
    head, _ = edge_quiet(b, sr)
    return round(max(0.0, float(target) - tail - head), 4)


def quiet_runs(y: np.ndarray, sr: int, min_len: float = 0.05) -> tuple[list[tuple[float, float]], tuple[float, float]]:
    """hening di DALAM ucapan ([(mulai, akhir)] detik, ≥ min_len) + (awal, akhir) ucapan. Ambang sama dengan jobs_tts.find_pauses."""
    fd = meter.frame_db(y, sr, 0.03, 0.01)
    if fd.size < 3:
        return [], (0.0, len(y) / sr)
    sp = fd > max(float(fd.max()) - 40, -55)
    idx = np.where(sp)[0]
    if len(idx) < 2:
        return [], (0.0, len(y) / sr)
    out: list[tuple[float, float]] = []
    run = None
    for j in range(int(idx[0]), int(idx[-1]) + 1):
        if not sp[j]:
            run = j if run is None else run
        elif run is not None:
            a, b = run * 0.01, (j - 1) * 0.01 + 0.03
            if b - a >= min_len - 1e-9:
                out.append((round(a, 4), round(b, 4)))
            run = None
    return out, (int(idx[0]) * 0.01, int(idx[-1]) * 0.01 + 0.03)


def tidy_pauses(y: np.ndarray, sr: int, sentences: list[str], bed: np.ndarray | None = None, seed: int = 0) -> tuple[np.ndarray, dict]:
    """
    Rapikan jeda di dalam take satu-tarikan. Titik jeda kalimat (akhir kalimat & sesudah "…", lihat pause_points) DAN koma dipasangkan
    ke hening secara monoton (assign_pauses), lalu HANYA jeda kalimat yang dijaga di rentang alami (pause_range): terlalu pendek →
    disisipi room tone di tengah jeda, asal memang jelas jeda (≥ 120 ms dan ≥ 1,6× median sela antar kata; bukan sela kata /
    penutupan konsonan); terlalu panjang → tengahnya dipotong (crossfade). Jeda koma tidak pernah dipanjangkan. Hening lain yang lebih
    dari 0,6 dtk (mesin "macet" di tengah kalimat) dipendekkan ke 0,6. Titik jeda tanpa hening yang jelas dibiarkan (salah tempat
    lebih buruk daripada tidak ada). Balikan (audio, {fixed, added, cut}).
    """
    y = np.asarray(y, dtype=np.float32)
    info = {"fixed": 0, "added": 0.0, "cut": 0.0}
    runs_, span = quiet_runs(y, sr)
    if not runs_:
        return y, info
    marks = pause_marks(sentences)
    pairs = assign_pauses(runs_, marks, span)
    targets = {j: (pause_range(marks[m][0]) if marks[m][1] else (0.0, PAUSE_HI)) for j, m in pairs.items()}
    gaps = [b - a for j, (a, b) in enumerate(runs_) if j not in pairs]
    med = float(np.median(gaps)) if len(gaps) >= 2 else WORD_GAP
    grow_min = max(MIN_GROW, GROW_DISTINCT * med)
    edits: list[tuple[float, float, float]] = []
    for j, (a, b) in enumerate(runs_):
        ln = b - a
        lo, hi = targets.get(j, (0.0, PAUSE_HI))
        if lo > 0 and ln < lo - 0.02 and ln >= grow_min:
            edits.append((a, b, lo - ln))
        elif ln > hi + 0.02:
            edits.append((a, b, hi - ln))
    out = y
    lvl = room_level(sr, y) if any(d > 0 for _, _, d in edits) else -62.0
    for k, (a, b, delta) in enumerate(reversed(edits)):
        mid = int(round((a + b) / 2 * sr))
        if delta > 0:
            out = splice(out[:mid], out[mid:], delta, sr, bed, seed * 131 + k, level_db=lvl)
            info["added"] += delta
        else:
            c = int(round(-delta * sr))
            out = cut(out, mid - c // 2, mid - c // 2 + c, sr)
            info["cut"] += -delta
        info["fixed"] += 1
    info["added"] = round(info["added"], 3)
    info["cut"] = round(info["cut"], 3)
    return out, info
