"""
Pembersih referensi suara (bank suara):
  1. decode → mono 48 kHz, high-pass ringan
  2. DeepFilterNet3 dengan peredaman ADAPTIF: atten = clamp(28 − SNR rekaman, 6, 18) dB — rekaman bersih cukup dibersihkan ringan
     (pembersihan berlebihan bikin suara "metalik" dan Chatterbox ikut meniru); cadangan: ffmpeg anlmdn (kekuatan ikut adaptif)
  3. potong otomatis ke klip 9–12 dtk (utamakan ±10 dtk) yang PALING HIDUP: dipotong di tengah jeda (tidak memotong kata), banyak bicara,
     tanpa hening panjang / clipping, dan nada naik-turun (variasi semitone, hadiah sampai ±4 st, penalti > 6 st). Chatterbox meniru
     prosodi referensi — potongan datar menghasilkan suara datar. 6 dtk pertama dinilai dobel (T3 Chatterbox hanya memakai 6 dtk
     pertama referensi, S3Gen 10 dtk pertama).
  4. loudness -20 LUFS (pyloudnorm), puncak maks -1 dBTP
  5. skor kualitas: perkiraan SNR → bising rendah / sedang / tinggi + saran rekam ulang (bahasa awam); quality.ver = CLEAN_VER
     (versi pembersih; suara lama dengan versi lebih rendah dibersihkan ulang sekali otomatis sebelum TTS — lihat jobs_clean.outdated)
"""
from __future__ import annotations

import sys
import types
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np

from . import ff, meter, natural
from . import log as vlog

log = vlog.get("bersih")

SR = 48000
REF_LUFS = -20.0
HOP = 0.01  # detik per frame analisis
# versi pembersih (disimpan di quality.ver). 2 = denoise adaptif + pilih potongan paling hidup (dulu: paling datar, atten 18 dB tetap)
CLEAN_VER = 2
# durasi potongan referensi: 9–12 dtk, utamakan ±10 dtk (S3Gen Chatterbox memakai 10 dtk pertama, sisanya hanya untuk embedding suara)
SEG_LO, SEG_HI, SEG_MID, SEG_SOFT = 9.0, 12.0, 10.0, 10.4
# variasi nada: hadiah sampai ±4 semitone, di atas 6 st dianggap teriak / salah deteksi → penalti
ST_GOOD, ST_MAX = 4.0, 6.0
T3_SEC = 6.0  # T3 Chatterbox hanya memakai 6 dtk pertama referensi sebagai contoh gaya bicara
PITCH_HOP = 0.02  # frame analisis nada (detik) untuk seluruh rekaman
_DF: tuple | None = None
_DF_ERR: str | None = None


@dataclass
class CleanResult:
    ok: bool
    quality: dict
    out: Path | None = None
    notes: list[str] = field(default_factory=list)


# ---------------------------------------------------------------- DeepFilterNet
def _shim_torchaudio() -> None:
    """deepfilternet 0.5.6 meng-import torchaudio.backend.common yang hilang di torchaudio baru → sediakan pengganti"""
    try:
        import torchaudio.backend.common  # noqa: F401
    except Exception:
        import torchaudio

        mod = types.ModuleType("torchaudio.backend.common")

        class AudioMetaData:  # cukup untuk anotasi tipe di df.io
            pass

        mod.AudioMetaData = getattr(torchaudio, "AudioMetaData", AudioMetaData)  # type: ignore[attr-defined]
        sys.modules.setdefault("torchaudio.backend", types.ModuleType("torchaudio.backend"))
        sys.modules["torchaudio.backend.common"] = mod


def deepfilter():
    """muat DeepFilterNet3 sekali (model diunduh otomatis dari GitHub saat pertama kali)"""
    global _DF, _DF_ERR
    if _DF is not None or _DF_ERR is not None:
        return _DF
    try:
        _shim_torchaudio()
        from df.enhance import enhance, init_df

        model, state, _ = init_df(log_level="ERROR", log_file=None)
        _DF = (model, state, enhance)
        log.info("DeepFilterNet3 siap.")
    except (Exception, SystemExit) as e:  # paket belum ada / unduh gagal (df memanggil exit(1)!) → pakai cadangan ffmpeg
        _DF_ERR = f"{type(e).__name__}: {e}"
        log.warning("DeepFilterNet tidak bisa dipakai (%s) — pakai pembersih ffmpeg ringan.", _DF_ERR[:200])
    return _DF


def adaptive_atten(snr: float, cap: float = 18.0) -> float:
    """peredaman bising (dB) sesuai kebersihan rekaman: clamp(28 − SNR, 6, cap). SNR 25 dB → 6 dB (ringan), SNR ≤ 10 dB → 18 dB.
    `cap` = DF_ATTEN_DB di .env (bawaan 18)."""
    try:
        snr_f = float(snr)
    except (TypeError, ValueError):
        snr_f = 0.0
    hi = max(6.0, float(cap))
    return round(max(6.0, min(hi, 28.0 - snr_f)), 1)


def denoise(y: np.ndarray, atten_db: float) -> tuple[np.ndarray, str]:
    df = deepfilter()
    if df is not None:
        try:
            import torch

            model, state, enhance = df
            with torch.no_grad():
                out = enhance(model, state, torch.from_numpy(y[None, :].copy()), atten_lim_db=float(atten_db))
            return out.squeeze(0).detach().cpu().numpy().astype(np.float32), "deepfilternet"
        except Exception as e:
            log.warning("DeepFilterNet gagal (%s) — pakai pembersih ffmpeg.", e)
    import tempfile

    try:
        with tempfile.TemporaryDirectory() as td:
            tmp_in = Path(td) / "in.wav"
            ff.write_wav(tmp_in, y, SR, "FLOAT")
            # dengung rendah + bising halus: high-pass sedikit lebih tinggi + non-local means (lembut, tidak robotik)
            # kekuatan ikut peredaman adaptif: 18 dB → s=7 (seperti dulu), 6 dB → s=3 (ringan)
            strength = round(max(3.0, min(7.0, 3.0 + 4.0 * (float(atten_db) - 6.0) / 12.0)), 1)
            out = ff.decode(tmp_in, SR, mono=True, af=f"highpass=f=90,anlmdn=s={strength:g}")
        return out, "ffmpeg-anlmdn"
    except ff.FFError as e:
        log.warning("Pembersih ffmpeg gagal (%s) — audio dipakai apa adanya.", e)
        return y, "tanpa"


# ---------------------------------------------------------------- analisis
def vad(db: np.ndarray) -> tuple[np.ndarray, float, float]:
    """masker bicara per frame + (lantai bising dB, ambang dB)"""
    floor = float(np.percentile(db, 10))
    peak = float(np.percentile(db, 99))
    thr = max(floor + 8.0, peak - 38.0)
    sp = db > thr
    # isi celah bicara pendek (< 80 ms) supaya satu kata tidak terpecah
    gap = 0
    for i in range(len(sp)):
        if sp[i]:
            if 0 < gap < 8 and i - gap - 1 >= 0 and sp[i - gap - 1]:
                sp[i - gap : i] = True
            gap = 0
        else:
            gap += 1
    return sp, floor, thr


def runs(mask: np.ndarray, value: bool) -> list[tuple[int, int]]:
    out, start = [], None
    for i, v in enumerate(mask):
        if v == value and start is None:
            start = i
        elif v != value and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(mask)))
    return out


def snr_db(db: np.ndarray, sp: np.ndarray) -> float:
    if sp.sum() < 10:
        return 0.0
    speech = float(np.median(db[sp]))
    quiet = db[~sp]
    noise = float(np.percentile(quiet, 50)) if quiet.size >= 10 else float(np.percentile(db, 5))
    return round(max(0.0, speech - noise), 1)


def pitch_grid(y: np.ndarray, sr: int, n: int) -> np.ndarray | None:
    """nada (Hz, nan = tidak bersuara) per frame analisis HOP (n frame) — pyin sekali untuk seluruh rekaman. Gagal → None."""
    tr = natural.f0_track(y, sr, hop=PITCH_HOP)
    if tr is None:
        return None
    f0, vf = tr
    f0 = np.where(vf, f0, np.nan)
    # frame energi k mulai di k·HOP (jendela 30 ms) → tengahnya k·HOP + 0,015; frame pyin j berpusat di j·PITCH_HOP
    j = np.clip(np.round((np.arange(n) * HOP + 0.015) / PITCH_HOP).astype(int), 0, len(f0) - 1)
    return f0[j]


def pitch_var(f0: np.ndarray | None, a: int, b: int) -> float | None:
    """variasi nada potongan [a, b) (semitone); 6 dtk pertama dinilai dobel (bagian yang dipakai T3 sebagai contoh gaya bicara)"""
    if f0 is None:
        return None
    st_all = natural.semitone_std(f0[a:b])
    if st_all is None:
        return None
    st6 = natural.semitone_std(f0[a : min(b, a + int(round(T3_SEC / HOP)))])
    return round(0.5 * st_all + 0.5 * (st6 if st6 is not None else st_all), 3)


def pitch_bonus(st: float | None) -> float:
    """hadiah variasi nada: naik sampai ±4 st (+0,8), datar 4–6 st, turun di atas 6 st (teriak / salah deteksi). Tidak terukur → 0."""
    if st is None:
        return 0.0
    return 0.2 * min(float(st), ST_GOOD) - 0.3 * max(0.0, float(st) - ST_MAX)


def pick_segment(y: np.ndarray, sr: int, lo: float = SEG_LO, hi: float = SEG_HI, pad: float = 0.15, f0: np.ndarray | None = None) -> tuple[int, int, dict]:
    """
    pilih klip terbaik [s, e) (sampel). Potong hanya di tengah jeda ≥ 120 ms supaya kata tidak terpotong.
    Nilai: banyak bicara, tanpa jeda panjang / clipping, durasi ±10 dtk, dan nada paling HIDUP (dulu: energi paling stabil = paling
    datar → Chatterbox meniru datarnya). `f0` (nada per frame HOP) boleh diberikan; kosong → dihitung pyin.
    """
    db = meter.frame_db(y, sr, 0.03, HOP)
    sp, floor, thr = vad(db)
    n = len(db)
    h = int(HOP * sr)
    if not sp.any():
        return 0, len(y), {"speech": 0.0}
    if f0 is None:
        f0 = pitch_grid(y, sr, n)
    elif len(f0) != n:
        f0 = np.resize(np.asarray(f0, dtype=np.float64), n)
    pauses = [(a, b) for a, b in runs(sp, False) if (b - a) * HOP >= 0.12]
    cuts = sorted({0, n, *[(a + b) // 2 for a, b in pauses]})
    clip = np.abs(y) >= 0.995

    def span(i0: int, i1: int) -> tuple[int, int] | None:
        idx = np.where(sp[i0:i1])[0]
        if not len(idx):
            return None
        return i0 + int(idx[0]), i0 + int(idx[-1]) + 1

    def score(a: int, b: int) -> float:
        seg = sp[a:b]
        dur = (b - a) * HOP + 2 * pad
        ratio = float(seg.mean())
        longest = max([(e - s) * HOP for s, e in runs(seg, False)] or [0.0])
        nclip = int(clip[a * h : b * h].sum())
        size = abs(dur - SEG_MID) * 0.08 + max(0.0, dur - SEG_SOFT) * 0.25
        return ratio * 2.0 - max(0.0, longest - 0.6) * 1.5 - min(nclip, 50) * 0.02 - size + pitch_bonus(pitch_var(f0, a, b))

    best: tuple[float, int, int] | None = None
    # rentang utama dulu; rekaman yang bicaranya sedikit di bawah 9 dtk (mis. referensi 9 dtk) → 8–12 dtk dulu supaya tetap dapat
    # potongan terpanjang (S3Gen memakai sampai 10 dtk), baru cadangan longgar 6–14 dtk
    passes = list(dict.fromkeys(((lo, hi), (min(lo, 8.0), hi), (min(lo, 6.0), max(hi, 14.0)))))
    for lo_, hi_ in passes:
        for i in range(len(cuts)):
            for j in range(i + 1, len(cuts)):
                sp_ = span(cuts[i], cuts[j])
                if not sp_:
                    continue
                d = (sp_[1] - sp_[0]) * HOP + 2 * pad
                if d < lo_:
                    continue
                if d > hi_:
                    break
                sc = score(*sp_)
                if best is None or sc > best[0]:
                    best = (sc, *sp_)
        if best:
            break
    if best is None:
        whole = span(0, n)
        assert whole is not None
        a, b = whole
        if (b - a) * HOP > hi:  # bicara tanpa jeda: ambil ±10–12 dtk, berhenti di frame paling pelan
            lim = a + int(hi / HOP)
            win = db[a + int(lo / HOP) : lim]
            b = a + int(lo / HOP) + int(np.argmin(win)) if win.size else lim
        best = (0.0, a, b)
    _, a, b = best
    s = max(0, a * h - int(pad * sr))
    e = min(len(y), b * h + int(pad * sr))
    st = pitch_var(f0, a, b)
    return s, e, {"speech": round(float(sp[a:b].mean()), 2), "floor_db": round(floor, 1), "thr_db": round(thr, 1), "st": st}


# ---------------------------------------------------------------- proses utama
def advice(noise: str, dur: float, clipped: bool, quiet: bool, speech_sec: float) -> str:
    tips = []
    if speech_sec < 5:
        tips.append("Rekaman terlalu pendek — rekam minimal 10 detik bicara tanpa banyak jeda.")
    if clipped:
        tips.append("Suara terlalu keras sampai pecah — jauhkan HP/mic sedikit dari mulut.")
    if quiet:
        tips.append("Suara terlalu pelan — dekatkan HP/mic (±15–20 cm dari mulut).")
    if noise == "tinggi":
        tips.append("Suara latar masih bising. Rekam ulang di ruangan tertutup yang sepi (matikan kipas/AC, jauhi jalan).")
    elif noise == "sedang":
        tips.append("Sudah bisa dipakai. Biar lebih jernih, rekam ulang di ruangan yang lebih sepi.")
    if not tips:
        tips.append("Bagus! Rekaman jernih dan siap dipakai.")
    return " ".join(tips)


def process(src: Path, dst: Path, atten_db: float = 18.0, progress: Callable[[float, str], None] | None = None) -> CleanResult:
    """`atten_db` = batas atas peredaman (DF_ATTEN_DB); yang dipakai adaptif: clamp(28 − SNR, 6, atten_db)"""
    def step(p: float, msg: str) -> None:
        if progress:
            progress(p, msg)

    step(0.05, "Membaca rekaman…")
    raw = ff.decode(src, SR, mono=True, af="highpass=f=70", max_sec=120)
    total = len(raw) / SR
    if total < 1.0:
        q = {"noise": "tinggi", "snr_db": 0.0, "lufs": None, "dur": round(total, 2), "saran": "Rekaman kosong atau terlalu pendek — rekam ulang minimal 10 detik."}
        return CleanResult(False, q)
    raw_lufs = meter.lufs(raw, SR)
    raw_db = meter.frame_db(raw, SR, 0.03, HOP)
    raw_sp, _, _ = vad(raw_db)
    snr_raw = snr_db(raw_db, raw_sp)
    clipped = int((np.abs(raw) >= 0.995).sum()) > SR * 0.002

    step(0.25, "Membersihkan bising…")
    atten = adaptive_atten(snr_raw, atten_db)
    den, how = denoise(raw, atten)
    if len(den) != len(raw):
        den = np.pad(den, (0, max(0, len(raw) - len(den))))[: len(raw)]

    step(0.6, "Memilih potongan terbaik…")
    s, e, info = pick_segment(den, SR)
    clip = den[s:e].astype(np.float32)
    fade = min(len(clip) // 4, int(0.01 * SR))
    if fade > 1:
        clip[:fade] *= np.linspace(0, 1, fade, dtype=np.float32)
        clip[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)

    step(0.8, "Menyamakan volume…")
    out, _ = meter.normalize(clip, SR, REF_LUFS, -1.0)
    dur = len(out) / SR
    c_db = meter.frame_db(out, SR, 0.03, HOP)
    c_sp, _, _ = vad(c_db)
    speech_sec = float(c_sp.sum() * HOP)
    seg_raw_db = meter.frame_db(raw[s:e], SR, 0.03, HOP)
    snr_seg = snr_db(seg_raw_db, vad(seg_raw_db)[0])
    snr = round(min(snr_raw, snr_seg) if snr_seg > 0 else snr_raw, 1)
    noise = "rendah" if snr >= 25 else "sedang" if snr >= 15 else "tinggi"
    quiet = raw_lufs < -40
    ok = speech_sec >= 3.0 and snr >= 6.0
    q = {
        "noise": noise,
        "snr_db": snr,
        "snr_clean_db": snr_db(c_db, c_sp),
        "lufs": round(meter.lufs(out, SR), 1),
        "raw_lufs": round(raw_lufs, 1),
        "tp_db": round(meter.true_peak_db(out, SR), 1),
        "dur": round(dur, 2),
        "speech_sec": round(speech_sec, 1),
        "start": round(s / SR, 2),
        "clip": bool(clipped),
        "denoise": how,
        "atten_db": atten,
        "st": info.get("st"),
        "ver": CLEAN_VER,
        "saran": advice(noise, dur, clipped, quiet, speech_sec) if ok else ("Rekaman tidak bisa dipakai: " + advice(noise, dur, clipped, quiet, speech_sec)),
    }
    if not ok:
        return CleanResult(False, q)
    ff.write_wav(dst, out, SR)
    step(0.95, "Selesai dibersihkan")
    log.info("Referensi bersih: %.1f dtk (mulai %.1f dtk), SNR ±%.0f dB (%s), pembersih %s %.0f dB, variasi nada %s st", dur, s / SR, snr, noise, how, atten, info.get("st"))
    return CleanResult(True, q, dst, [f"total rekaman {total:.1f} dtk", str(info)])
