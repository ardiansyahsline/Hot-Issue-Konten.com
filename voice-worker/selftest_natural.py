"""
Tes mandiri SUARA NATURAL voice-worker — TANPA GPU / torch / model / internet:
  .venv\\Scripts\\python selftest_natural.py            (semua tes)
  .venv\\Scripts\\python selftest_natural.py tempo nada (hanya tes yang namanya mengandung kata itu)
Yang dites: skor nada (datar vs meliuk) & aturan pilih take, potongan teks satu tarikan, sambungan room tone + crossfade (tanpa hening
digital), ekor kalimat tidak terpotong, jeda antar kalimat dirapikan ke rentang alami, pilih potongan referensi paling hidup,
denoise adaptif, UTMOS gagal / dimatikan / palsu, satu tarikan → cadangan per kalimat, tempo alami dulu baru atempo (mesin palsu),
job lama tanpa max tetap sama, cadangan per kalimat hanya bila jelas lebih baik, level potongan disamakan, takes bawaan 3 + batas
waktu, ringkasan kealamian di hasil job, bersihkan ulang referensi sekali,
signature sampling Chatterbox. Mesin suara, ASR & Supabase dipalsukan.
"""
from __future__ import annotations

import contextlib
import logging
import shutil
import sys
import tempfile
import time
import traceback
import types
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

from studio_worker import config  # noqa: E402

config.apply_thread_limits(2)

import numpy as np  # noqa: E402

from studio_worker import clean, ff, jobs_clean, jobs_tts, meter, natural, post  # noqa: E402
from studio_worker import text as T  # noqa: E402
from studio_worker.engines import chatterbox_engine as cbe  # noqa: E402
from studio_worker.jobctx import JobCtx, Runtime  # noqa: E402

HERE = Path(__file__).resolve().parent
BANK = HERE / "bank-suara"
TMP = Path(tempfile.mkdtemp(prefix="vw-natural-"))
results: list[tuple[str, bool, str]] = []
TESTS: list = []


def test(fn):
    TESTS.append(fn)
    return fn


def run_test(fn) -> None:
    name = fn.__name__.removeprefix("t_").replace("_", " ")
    t0 = time.time()
    natural.reset()
    try:
        info = fn() or ""
        results.append((name, True, f"{info} ({time.time() - t0:.1f} dtk)"))
        print(f"[OK]    {name} {info}")
    except Exception as e:
        results.append((name, False, f"{type(e).__name__}: {e}"))
        print(f"[GAGAL] {name}: {type(e).__name__}: {e}")
        traceback.print_exc()
    finally:
        natural.reset()


def near(a: float, b: float, tol: float, what: str) -> None:
    assert abs(a - b) <= tol, f"{what}: {a:.3f} (harusnya {b}±{tol})"


# ---------------------------------------------------------------- sinyal sintetis
def voiced(dur: float, sr: int, f0, amp: float = 0.3) -> np.ndarray:
    """vokal harmonik dengan kontur nada f0(t) (Hz) + amplop suku kata"""
    t = np.arange(int(dur * sr)) / sr
    f = np.asarray(f0(t), dtype=np.float64) * np.ones_like(t)
    ph = 2 * np.pi * np.cumsum(f) / sr
    env = np.sin(np.pi * t / max(dur, 1e-3)) ** 0.6
    return (sum((amp / k) * np.sin(k * ph) for k in range(1, 7)) * env).astype(np.float32)


def phrase(n_words: int, sr: int, expressive: bool, seed: int = 0, base: float = 125.0) -> np.ndarray:
    """'kata-kata' 0,22–0,3 dtk dengan jeda 50–80 ms. expressive → nada naik-turun ±4 st sepanjang frasa + luncuran di tiap kata;
    datar → nada nyaris tetap (±0,15 st)"""
    rnd = np.random.default_rng(seed)
    parts = []
    for i in range(n_words):
        d = rnd.uniform(0.22, 0.3)
        if expressive:
            c = 4.0 * np.sin(2 * np.pi * (i / max(1, n_words)) * 1.5 + seed)
            glide = rnd.uniform(-1.5, 1.5)
            parts.append(voiced(d, sr, lambda t, c=c, g=glide, d=d: base * 2 ** ((c + g * t / d) / 12)))
        else:
            j = rnd.uniform(-0.15, 0.15)
            parts.append(voiced(d, sr, lambda t, j=j: base * 2 ** (j / 12)))
        parts.append(np.zeros(int(rnd.uniform(0.05, 0.08) * sr), np.float32))
    return np.concatenate(parts)


def zero_runs(y: np.ndarray, sr: int, min_ms: float = 5.0) -> int:
    """jumlah rentetan sampel hening digital (|y| < 1e-7) sepanjang ≥ min_ms"""
    z = np.abs(y) < 1e-7
    n, cur, need = 0, 0, int(min_ms / 1000 * sr)
    for v in z:
        cur = cur + 1 if v else 0
        if cur == need:
            n += 1
    return n


# ---------------------------------------------------------------- palsuan
class Eng:
    """mesin palsu: tiap kalimat → frasa ekspresif; `native_tempo` + durasi ikut cfg_weight (lebih tinggi = lebih cepat)"""

    name = "chatterbox"
    sr = 24000
    label = "Bank suara · Chatterbox (GPU laptop)"
    credit = "tes"

    def __init__(self, native: bool = False, gap: float = 0.35, sleep: float = 0.0):
        self.calls: list[tuple[str, float]] = []
        self.native_tempo = native
        self.gap = gap
        self.sleep = sleep

    def synth(self, text, ref, st, seed):
        self.calls.append((text, float(st.get("cfg_weight", 0.35))))
        if self.sleep:
            time.sleep(self.sleep)
        speed = 1.0 + 1.0 * max(0.0, float(st.get("cfg_weight", 0.35)) - 0.35) if self.native_tempo else 1.0
        sr = int(self.sr * 1.0)
        out = [np.zeros(int(0.1 * sr), np.float32)]
        for i, s in enumerate(T.split_sentences(text) or [text]):
            ph = phrase(max(2, len(s.split())), sr, True, seed + i)
            if speed != 1.0:  # bicara lebih cepat = suku kata lebih pendek (cukup dipotong rata: tes durasi, bukan kualitas)
                idx = np.round(np.arange(0, len(ph), speed)).astype(int)
                ph = ph[idx[idx < len(ph)]]
            out += [ph, np.zeros(int(self.gap * sr), np.float32)]
        out.append(np.zeros(int(0.2 * sr), np.float32))
        return np.concatenate(out)


class Asr:
    """ASR palsu: mode cek (words=False) → `heard(text_dari_wav?)` tidak tersedia, jadi pakai daftar jawaban per panggilan;
    mode kata → teks `line` dibagi rata"""

    device = "palsu"
    model = object()

    def __init__(self, answers=None, line: str = "", available: bool = True):
        self.answers = answers  # callable(n) → teks
        self.line = line
        self.available = available
        self.n = 0

    def transcribe(self, path, words=True):
        y, sr = ff.read_wav(Path(path))
        dur = len(y) / sr
        if not words:
            self.n += 1
            return (self.answers(self.n) if self.answers else ""), []
        ws = self.line.split()
        step = dur / max(1, len(ws))
        return self.line, [(w, i * step + 0.02, (i + 1) * step - 0.02) for i, w in enumerate(ws)]


class Supa:
    """Supabase di memori: tabel + storage (cukup untuk job tts/clean)"""

    def __init__(self):
        self.tables: dict[str, list[dict]] = {}
        self.files: dict[str, bytes] = {}

    def _match(self, row, filters):
        for k, v in filters.items():
            if k in ("select", "order", "limit", "offset"):
                continue
            op, _, val = str(v).partition(".")
            if op == "eq" and str(row.get(k)) != val:
                return False
        return True

    def select(self, table, **params):
        rows = [dict(r) for r in self.tables.get(table, []) if self._match(r, params)]
        return rows[: int(params.get("limit", 1000))]

    def update(self, table, filters, patch):
        out = []
        for r in self.tables.get(table, []):
            if self._match(r, filters):
                r.update(patch)
                out.append(dict(r))
        return out

    def upload(self, path, data, content_type, timeout=0):
        self.files[path] = data.read_bytes() if isinstance(data, Path) else data
        return path

    def download(self, path, dest=None, timeout=0):
        if path not in self.files:
            raise FileNotFoundError(path)
        if dest is not None:
            Path(dest).parent.mkdir(parents=True, exist_ok=True)
            Path(dest).write_bytes(self.files[path])
        return self.files[path]


class Engines:
    def __init__(self, eng):
        self.eng = eng
        self.gets = 0

    def order(self, pref):
        return ["chatterbox"]

    def is_down(self, name):
        return False

    def get(self, name):
        self.gets += 1
        return self.eng

    def mark_down(self, name, reason):
        pass


def cfg_(sub: str, takes: int = 2) -> SimpleNamespace:
    d = TMP / sub
    for s in ("cache", "tmp", "models", "logs"):
        (d / s).mkdir(parents=True, exist_ok=True)
    return SimpleNamespace(cache=d / "cache", tmp=d / "tmp", models=d / "models", logs=d / "logs", data=d, takes=takes, df_atten_db=18.0, worker_id="tes", natural_mos=True)


def bank(ver: int | None = 2) -> tuple[Supa, dict]:
    """suara siap: clean.wav = referensi bank (punya jeda sunyi untuk room tone)"""
    sb = Supa()
    vid = "22222222-2222-2222-2222-222222222222"
    sb.files[f"voices/{vid}/raw.wav"] = (BANK / "suara-alif-energik.wav").read_bytes()
    sb.files[f"voices/{vid}/clean.wav"] = (BANK / "referensi-alif-energik-10dtk.wav").read_bytes()
    q = {"saran": "ok"} if ver is None else {"saran": "ok", "ver": ver}
    v = {"id": vid, "name": "Alif", "consent": True, "raw_path": f"voices/{vid}/raw.wav", "clean_path": f"voices/{vid}/clean.wav", "status": "siap", "quality": q, "updated_at": "t0"}
    sb.tables["studio_voices"] = [v]
    return sb, v


def run_job(sb: Supa, rt: Runtime, jid: str, lines: list[dict], settings: dict | None = None) -> dict:
    vid = sb.tables["studio_voices"][0]["id"]
    job = {"id": jid, "kind": "tts", "voice_id": vid, "engine": "auto", "lines": lines, "settings": settings if settings is not None else {"takes": 1}, "status": "proses"}
    sb.tables.setdefault("studio_voice_jobs", []).append(job)
    jobs_tts.run(JobCtx(rt, "studio_voice_jobs", job, min_gap=0))
    assert job["status"] == "selesai", job.get("message")
    return job


# ---------------------------------------------------------------- tes
@test
def t_nada_datar_vs_meliuk():
    sr = 24000
    flat, live = phrase(14, sr, False, 1), phrase(14, sr, True, 1)
    pf, pl = natural.pitch_stats(flat, sr), natural.pitch_stats(live, sr)
    assert pf["st"] is not None and pl["st"] is not None, (pf, pl)
    assert pf["st"] < 0.6 and 1.8 <= pl["st"] <= 6.0, (pf, pl)
    mf, ml = natural.mono_penalty(pf["st"]), natural.mono_penalty(pl["st"])
    assert mf > 0.6 and ml == 0.0, (mf, ml)
    # bertahap: makin datar makin besar penaltinya
    assert natural.mono_penalty(1.7) < natural.mono_penalty(1.0) < natural.mono_penalty(0.2) <= natural.MONO_W
    assert natural.mono_penalty(None) == 0.0
    # aturan pilih: kejelasan dalam +0,06 → menang yang lebih alami; selisih kejelasan besar → tetap yang lebih jelas
    sc = [{"score": 0.10, "mono": mf, "mos": None}, {"score": 0.14, "mono": ml, "mos": None}]
    assert natural.choose(sc) == 1
    sc2 = [{"score": 0.10, "mono": mf, "mos": None}, {"score": 0.30, "mono": ml, "mos": None}]
    assert natural.choose(sc2) == 0
    # MOS dipakai hanya kalau semua pesaing punya MOS
    sc3 = [{"score": 0.1, "mono": 0, "mos": 3.2}, {"score": 0.12, "mono": 0, "mos": 4.1}, {"score": 0.5, "mono": 0, "mos": None}]
    assert natural.choose(sc3) == 1
    # kecepatan pyin (hop 20 ms) untuk 10 dtk audio
    t0 = time.time()
    natural.pitch_stats(np.tile(live, 4)[: sr * 10], sr)
    took = time.time() - t0
    assert took < 4.0, f"pyin terlalu lambat: {took:.1f} dtk"
    return f"datar ±{pf['st']} st (penalti {mf}), meliuk ±{pl['st']} st (penalti {ml}), pyin 10 dtk {took:.2f} dtk"


@test
def t_potong_teks_satu_tarikan():
    short = "Kamu pernah gak, ngerasa kerjaan numpuk? Tenang… sekarang ada cara yang jauh lebih gampang. Coba deh."
    assert len(short) <= 260 and T.chunk_text(short) == [T.clean_text(short)]
    sents = [f"Ini kalimat nomor {i} yang lumayan panjang supaya totalnya lewat batas satu tarikan." for i in range(1, 9)]
    long = " ".join(sents)
    ch = T.chunk_text(long, 260)
    assert len(ch) >= 2 and all(len(c) <= 260 for c in ch), [len(c) for c in ch]
    assert len(ch) < len(sents), "harus menggabungkan beberapa kalimat per potong, bukan 1 kalimat per potong"
    assert " ".join(ch) == " ".join(T.split_sentences(long)), "isi tidak boleh berubah / hilang"
    for c in ch:  # tiap potong berisi kalimat utuh
        assert all(s in c for s in T.split_sentences(c)) and c.endswith("."), c
    lens = [len(c) for c in ch]
    assert max(lens) - min(lens) <= 90, f"panjang potongan harus serata mungkin: {lens}"
    # kalimat tunggal yang lebih panjang dari batas → dipecah di koma
    huge = ", ".join(["kata kata kata kata kata kata"] * 15) + "."
    assert all(len(c) <= 260 for c in T.chunk_text(huge))
    assert T.chunk_text("") == []
    return f"{len(sents)} kalimat ({len(long)} huruf) → {len(ch)} potong {lens}"


@test
def t_sambungan_room_tone_crossfade():
    sr = 24000
    rnd = np.random.default_rng(3)
    a = np.concatenate([phrase(6, sr, True, 2), (rnd.standard_normal(int(0.15 * sr)) * 10 ** (-70 / 20)).astype(np.float32)])
    b = np.concatenate([(rnd.standard_normal(int(0.05 * sr)) * 10 ** (-70 / 20)).astype(np.float32), phrase(5, sr, True, 5)])
    a, b = natural.trim_take(a, sr), natural.trim_take(b, sr)
    # referensi bank → room tone dari bagian paling sunyi
    bed = natural.ref_bed(BANK / "referensi-alif-energik-10dtk.wav", sr)
    assert bed is not None and len(bed) >= int(0.25 * sr), "room tone referensi harus ketemu"
    for g in (0.0, 0.3, 0.62):
        y = natural.join([a, b], [g], sr, bed, seed=1)
        assert len(y) == len(a) + int(round(g * sr)) + len(b), f"panjang harus persis (jeda {g})"
        j0, j1 = len(a) - int(0.03 * sr), len(a) + int(round(g * sr)) + int(0.03 * sr)
        seg = y[j0:j1]
        assert zero_runs(seg, sr, 2.0) == 0, f"ada hening digital di sambungan (jeda {g})"
        # crossfade mulus: tidak ada lompatan sampel jauh di atas lantai noise di daerah sambungan
        jump = float(np.max(np.abs(np.diff(seg))))
        assert jump < 0.05, f"lompatan sampel {jump:.4f} di sambungan"
    # level room tone di jeda ≈ room_level
    g = 0.5
    y = natural.join([a, b], [g], sr, bed, seed=2)
    mid = y[len(a) + int(0.05 * sr) : len(a) + int((g - 0.05) * sr)]
    lvl = meter.db(float(np.sqrt(np.mean(mid.astype(np.float64) ** 2))))
    want = natural.room_level(sr, a, b)
    near(lvl, want, 3.0, "level room tone")
    # tanpa bed → noise pink sangat pelan, juga tanpa nol digital
    y2 = natural.join([a, b], [0.4], sr, None, seed=3)
    assert zero_runs(y2[len(a) : len(a) + int(0.4 * sr)], sr, 2.0) == 0
    # referensi hening digital → tidak ada room tone (pakai pink)
    assert natural.room_bed(np.zeros(sr * 3, np.float32), sr) is None
    # equal-power: cos² + sin² = 1
    fo, fi = natural._ep(480)
    assert np.allclose(fo**2 + fi**2, 1.0, atol=1e-6)
    return f"room tone {len(bed) / sr:.2f} dtk dari referensi, level jeda {lvl:.1f} dBFS (target {want:.1f}), lompatan maks {jump:.4f}"


@test
def t_ekor_kalimat_tidak_terpotong():
    sr = 24000
    # kalimat diakhiri nada turun + ekor yang meluruh pelan (napas), lalu hening panjang
    body = phrase(5, sr, True, 7)
    t = np.arange(int(0.35 * sr)) / sr
    tail = voiced(0.35, sr, lambda t: 150 * 2 ** (-5 * t / 12)) * np.exp(-t / 0.08).astype(np.float32)
    y = np.concatenate([np.zeros(int(0.3 * sr), np.float32), body, tail, np.zeros(int(0.8 * sr), np.float32)])
    out = natural.trim_take(y, sr)
    fd = meter.frame_db(out, sr, 0.02, 0.01)
    on = np.where(fd > max(-50.0, float(fd.max()) - 40))[0]
    after = len(out) / sr - (on[-1] + 2) * 0.01
    assert 0.12 <= after <= 0.18 + 1e-6, f"sisa sesudah suara terakhir {after:.3f} dtk (harusnya 0,12–0,18)"
    assert abs(float(out[-1])) < 1e-4, "ujung harus di-fade"
    # fade hanya di bagian sisa: energi ekor (sebelum sisa) tidak berkurang
    end_voice = (on[-1] + 2) * int(0.01 * sr)
    old = meter.trim_silence(y, sr, -50, 0.04)
    assert len(out) > len(old), "versi baru harus menyisakan ekor lebih panjang dari 40 ms lama"
    ref = y[np.argmax(np.abs(y) > 0) :][:end_voice]
    near(float(np.sqrt(np.mean(out[:end_voice] ** 2))), float(np.sqrt(np.mean(ref[: len(out[:end_voice])] ** 2))), 0.02, "energi suara utuh")
    head = int(np.argmax(np.abs(out) > 1e-3)) / sr
    assert head <= 0.075, f"sisa awal {head:.3f} dtk"
    return f"sisa ekor {after * 1000:.0f} ms + fade 30 ms (dulu 40 ms), awal {head * 1000:.0f} ms"


@test
def t_rapikan_jeda_antar_kalimat():
    sr = 24000
    rnd = np.random.default_rng(9)

    def rt(sec, n=None):  # lantai noise kecil (seperti keluaran mesin), bukan nol
        return (rnd.standard_normal(int(sec * sr) if n is None else n) * 10 ** (-72 / 20)).astype(np.float32)

    s1, s2, s3 = phrase(7, sr, True, 11), phrase(7, sr, True, 12), phrase(6, sr, True, 13)
    # jeda 1 terlalu pendek (0,1 dtk sesudah "."), jeda 2 terlalu panjang (1,3 dtk sesudah "…"); lantai noise di seluruh take
    y = np.concatenate([rt(0.05), s1, rt(0.10), s2, rt(1.3), s3, rt(0.1)])
    y = y + rt(0, len(y))
    sents = ["Satu dua tiga empat lima enam tujuh.", "Delapan sembilan sepuluh sebelas dua belas tiga belas empat belas…", "Lima belas enam belas tujuh belas delapan belas."]
    bed = natural.ref_bed(BANK / "referensi-alif-energik-10dtk.wav", sr)
    out, info = natural.tidy_pauses(y, sr, sents, bed, seed=1)
    assert info["fixed"] >= 2, info
    near(len(out) / sr, len(y) / sr + info["added"] - info["cut"], 0.002, "panjang = asli + tambah − potong")
    runs_, _ = natural.quiet_runs(out, sr, 0.2)
    longs = sorted(b - a for a, b in runs_)
    assert len(longs) >= 2, runs_
    p1 = [b - a for a, b in runs_ if (b - a) < 0.45]
    p2 = [b - a for a, b in runs_ if (b - a) >= 0.45]
    assert p1 and all(0.23 <= v <= 0.62 for v in p1), f"jeda sesudah '.' harus 0,25–0,6: {runs_}"
    assert p2 and all(0.43 <= v <= 0.72 for v in p2), f"jeda sesudah '…' harus 0,45–0,7: {runs_}"
    # jeda yang ditambah berisi room tone, bukan nol digital
    for a, b in runs_:
        assert zero_runs(out[int(a * sr) : int(b * sr)], sr, 2.0) == 0, "jeda berisi hening digital"
    # batas kalimat tanpa hening sama sekali → tidak disisipi apa pun
    y2 = np.concatenate([s1, s2])
    y2 = y2 + rt(0, len(y2))
    o2, i2 = natural.tidy_pauses(y2, sr, sents[:2], bed)
    assert len(o2) >= len(y2) - 1 and i2["cut"] == 0
    # satu kalimat: hanya hening "macet" > 0,6 dtk yang dipendekkan
    y3 = np.concatenate([s1, rt(1.0), s2])
    o3, i3 = natural.tidy_pauses(y3, sr, ["Satu kalimat saja tanpa titik di tengah"], bed)
    near(i3["cut"], 1.0 - natural.PAUSE_HI, 0.08, "hening macet dipendekkan ke 0,6")
    # "Tenang… sekarang ada caranya." (1 kalimat bagi split_sentences) → jeda menggantung sesudah "…" dipanjangkan ke ≥ 0,45
    w1 = phrase(2, sr, True, 21)
    y4 = np.concatenate([rt(0.05), w1, rt(0.14), phrase(6, sr, True, 22), rt(0.1)])
    y4 = y4 + rt(0, len(y4))
    o4, i4 = natural.tidy_pauses(y4, sr, T.split_sentences("Tenang… sekarang ada caranya buat kamu semua."), bed)
    r4, _ = natural.quiet_runs(o4, sr, 0.2)
    assert i4["added"] > 0.2 and any(0.43 <= (b - a) <= 0.72 for a, b in r4), (i4, r4)
    # semua sela mirip sela antar kata (tidak ada jeda yang jelas sesudah "…") → TIDAK menyisipkan jeda (bisa salah tempat)
    words = [phrase(1, sr, True, 40 + k) for k in range(9)]
    y5 = np.concatenate([rt(0.05), *words[:3], rt(0.3), *words[3:], rt(0.1)])
    y5 = y5 + rt(0, len(y5))
    o5, i5 = natural.tidy_pauses(y5, sr, T.split_sentences("Kerjaan numpuk terus? Tenang… ada cara yang lebih gampang."), bed)
    assert i5["added"] == 0 and len(o5) == len(y5), i5
    # "Tenang… sekarang ada caranya." tanpa jeda asli sesudah "…": hanya 2 sela pendek 70–80 ms (penutupan konsonan "seka|rang")
    # → TIDAK ada yang dipanjangkan (dulu: sela 80 ms jadi 0,45 dtk room tone = kata putus di tengah)
    y6 = np.concatenate([rt(0.05), voiced(0.70, sr, lambda t: 170.0), rt(0.08), voiced(0.55, sr, lambda t: 160.0), rt(0.07), voiced(0.6, sr, lambda t: 150.0), rt(0.15)])
    y6 = y6 + rt(0, len(y6))
    o6, i6 = natural.tidy_pauses(y6, sr, T.split_sentences("Tenang… sekarang ada caranya."), bed)
    assert i6["fixed"] == 0 and len(o6) == len(y6), i6
    # koma dekat "…": mesin hampir tidak berhenti di "…" (hanya sela kata 50–80 ms) tapi berhenti di koma sesudahnya (±0,3 dtk) → jeda
    # koma TIDAK dipanjangkan jadi jeda "…" (dulu: "mulu Tenang,(jeda panjang) sekarang"); "…" berhenti ±0,15–0,18 dtk → "…" yang
    # dipanjangkan. Tiap 'kata' phrase(1) sudah membawa sela 50–80 ms di ujungnya.
    wk = [phrase(1, sr, True, 60 + k) for k in range(8)]  # bos nanya mulu… | Tenang, | sekarang ada caranya.
    rec_at: list[float] = []
    orig_splice = natural.splice

    def spy(a, b, *aa, **kw):
        rec_at.append(len(a) / sr)
        return orig_splice(a, b, *aa, **kw)

    natural.splice = spy
    try:
        for mul_gap, want in ((0.0, False), (0.10, True)):
            rec_at.clear()
            parts7 = [rt(0.05), *wk[:3], rt(mul_gap), wk[3], rt(0.26), *wk[4:], rt(0.1)]
            y7 = np.concatenate(parts7)
            y7 = y7 + rt(0, len(y7))
            t_ell = sum(len(v) for v in parts7[:4]) / sr  # akhir "mulu…"
            t_com = sum(len(v) for v in parts7[:6]) / sr  # akhir "Tenang,"
            _, i7 = natural.tidy_pauses(y7, sr, T.split_sentences("Bos nanya mulu… Tenang, sekarang ada caranya."), bed)
            assert not any(t_com - 0.1 <= m <= t_com + 0.36 for m in rec_at), f"jeda koma dipanjangkan: {rec_at} (koma {t_com:.2f})"
            hit = any(t_ell - 0.1 <= m <= t_ell + mul_gap + 0.1 for m in rec_at)
            assert len(rec_at) == int(want), f"hanya jeda '…' yang boleh dipanjangkan: {rec_at}"
            assert hit == want, f"jeda '…' {mul_gap} dtk: dipanjangkan={hit}, harusnya {want} ({rec_at}, '…' {t_ell:.2f})"
    finally:
        natural.splice = orig_splice
    # penanda: koma ikut, "2,5%" bukan koma jeda
    assert natural.pause_marks(["Harga 2,5% saja, murah…", "Coba."]) == [("Harga 2,5% saja,", False), ("murah…", True), ("Coba.", True)]
    # tahan post-processing ffmpeg (hening ≤ 0,7 dtk tidak dipendekkan silenceremove)
    src = ff.write_wav(TMP / "tidy.wav", out, sr)
    post.process_vo(src, TMP / "tidy-post.wav")
    yp, spr = ff.read_wav(TMP / "tidy-post.wav")
    pp = [round(b - a, 2) for a, b in jobs_tts.find_pauses(yp if yp.ndim == 1 else yp.mean(axis=1), spr)]
    assert any(v >= 0.42 for v in pp), f"jeda '…' hilang setelah post-processing: {pp}"
    return f"jeda {sorted(round(v, 2) for v in longs)} dtk (tambah {info['added']:.2f}, potong {info['cut']:.2f}), setelah post {pp}"


@test
def t_pilih_potongan_referensi_paling_hidup():
    sr = 48000

    def block(expr: bool, seed: int, secs: float) -> np.ndarray:
        ys, tot, k = [], 0.0, 0
        while tot < secs:
            p = phrase(5, sr, expr, seed + k, base=118.0)
            ys += [p, np.zeros(int(0.22 * sr), np.float32)]  # jeda antar frasa (titik potong)
            tot += (len(p) / sr) + 0.22
            k += 1
        return np.concatenate(ys)

    flat, live = block(False, 100, 11.5), block(True, 200, 11.5)
    rec = np.concatenate([np.zeros(int(0.4 * sr), np.float32), flat, np.zeros(int(0.5 * sr), np.float32), live, np.zeros(int(0.5 * sr), np.float32), block(False, 300, 6.0)])
    rec = rec + (np.random.default_rng(1).standard_normal(len(rec)) * 1e-4).astype(np.float32)
    s, e, info = clean.pick_segment(rec, sr)
    live_start = (0.4 * sr + len(flat) + 0.5 * sr) / sr
    dur = (e - s) / sr
    assert s / sr >= live_start - 0.5, f"harus memilih bagian ekspresif (mulai ±{live_start:.1f} dtk), dapat {s / sr:.2f} dtk ({info})"
    assert clean.SEG_LO - 0.6 <= dur <= clean.SEG_HI + 0.4, f"durasi {dur:.2f}"
    assert info.get("st") and info["st"] >= 1.5, info
    # hadiah nada: naik sampai 4 st, turun di atas 6 st (teriak / salah deteksi), tidak terukur = 0
    assert clean.pitch_bonus(4.0) > clean.pitch_bonus(2.0) > clean.pitch_bonus(0.3) and clean.pitch_bonus(9.0) < clean.pitch_bonus(5.0)
    assert clean.pitch_bonus(None) == 0.0
    # referensi bank 9,1 dtk (bicara ±8,6 dtk): tetap dapat potongan terpanjang (lintasan 8–12 dtk), bukan dipotong jadi ±7 dtk
    ten, tsr = ff.read_wav(BANK / "referensi-alif-tenang-10dtk.wav")
    ten48 = ff.decode(BANK / "referensi-alif-tenang-10dtk.wav", sr, mono=True) if tsr != sr else ten
    s2, e2, _ = clean.pick_segment(ten48, sr)
    assert (e2 - s2) / sr >= 8.5, f"referensi tenang dipotong jadi {(e2 - s2) / sr:.2f} dtk"
    return f"pilih {s / sr:.2f}–{e / sr:.2f} dtk ({dur:.1f} dtk), variasi nada ±{info['st']} st"


@test
def t_denoise_adaptif():
    assert clean.adaptive_atten(30) == 6.0 and clean.adaptive_atten(25) == 6.0
    assert clean.adaptive_atten(20) == 8.0 and clean.adaptive_atten(16) == 12.0
    assert clean.adaptive_atten(10) == 18.0 and clean.adaptive_atten(0) == 18.0
    assert clean.adaptive_atten(5, cap=15) == 15.0, "batas atas ikut DF_ATTEN_DB"
    assert clean.adaptive_atten("x") == 18.0 and clean.adaptive_atten(None) == 18.0
    assert clean.CLEAN_VER >= 2
    return "SNR 25→6 dB, 20→8 dB, 16→12 dB, ≤10→18 dB"


def _fake_torch(load):
    class FT:
        def __init__(self, a):
            self.a = np.asarray(a)

        def unsqueeze(self, d):
            return FT(self.a[None])

        def to(self, d):
            return self

        def reshape(self, *sh):
            return FT(self.a.reshape(*sh))

        def __getitem__(self, i):
            return FT(self.a[i])

        def item(self):
            return float(self.a)

    m = types.ModuleType("torch")
    m.hub = SimpleNamespace(load=load, set_dir=lambda d: None)  # type: ignore[attr-defined]
    m.cuda = SimpleNamespace(is_available=lambda: False)  # type: ignore[attr-defined]
    m.from_numpy = lambda a: FT(a)  # type: ignore[attr-defined]
    m.inference_mode = contextlib.nullcontext  # type: ignore[attr-defined]
    m.FT = FT  # type: ignore[attr-defined]
    return m


@contextlib.contextmanager
def _torch(mod):
    old = sys.modules.get("torch")
    sys.modules["torch"] = mod
    try:
        yield
    finally:
        if old is None:
            sys.modules.pop("torch", None)
        else:
            sys.modules["torch"] = old


class _Catch(logging.Handler):
    def __init__(self):
        super().__init__()
        self.msgs: list[str] = []

    def emit(self, record):
        self.msgs.append(record.getMessage())


@test
def t_utmos_gagal_mati_dengan_anggun():
    eng = Eng()
    st = {"exaggeration": 0.6, "cfg_weight": 0.35, "temperature": 0.8, "takes": 2}
    cap = _Catch()
    natural.log.addHandler(cap)
    try:
        # (1) torch tidak ada (venv tes memang tanpa torch) → mati, take tetap dipilih
        natural.configure(True, TMP / "hub")
        y, info = jobs_tts.pick_take(eng, "Halo semuanya ini tes suara.", Path("ref.wav"), st, None, TMP)
        assert y.size and info["mos"] is None and info["take"] in (1, 2), info
        assert natural.mos_status().startswith("tidak dipakai"), natural.mos_status()
        # (2) torch.hub dipaksa error (mis. tanpa internet) → mati sekali, 1 baris peringatan, tidak dicoba terus
        natural.reset()
        cap.msgs.clear()
        calls = []

        def boom(*a, **k):
            calls.append(a)
            raise RuntimeError("tidak ada internet")

        with _torch(_fake_torch(boom)):
            natural.configure(True, TMP / "hub")
            for _ in range(3):
                _, info2 = jobs_tts.pick_take(eng, "Kalimat kedua untuk tes.", Path("ref.wav"), st, None, TMP)
                assert info2["mos"] is None
        assert len(calls) == 1, f"torch.hub.load harus dicoba sekali saja per sesi, dapat {len(calls)}"
        warn = [m for m in cap.msgs if "UTMOS tidak dipakai" in m]
        assert len(warn) == 1, cap.msgs
        assert "RuntimeError" in natural.mos_status()
        # (3) NATURAL_MOS=0 → tidak dimuat sama sekali
        natural.reset()
        with _torch(_fake_torch(lambda *a, **k: (_ for _ in ()).throw(AssertionError("tidak boleh dimuat")))):
            natural.configure(False)
            _, info3 = jobs_tts.pick_take(eng, "Kalimat ketiga.", Path("ref.wav"), st, None, TMP)
        assert info3["mos"] is None and natural.mos_status().startswith("mati")
        # (4) UTMOS palsu tersedia → take dengan MOS tertinggi menang (kejelasan setara), MOS & nada tercatat di info take
        natural.reset()
        mos_seq = iter([3.1, 4.4, 3.6])
        loaded = []

        class Pred:
            def to(self, d):
                return self

            def eval(self):
                return self

            def __call__(self, t, sr):
                assert sr == 16000 and t.a.ndim == 2
                return sys.modules["torch"].FT(np.array([next(mos_seq)]))

        def load(repo, model, **kw):
            loaded.append((repo, model, kw.get("trust_repo")))
            return Pred()

        with _torch(_fake_torch(load)):
            natural.configure(True, TMP / "hub")
            st3 = {**st, "takes": 3}
            _, info4 = jobs_tts.pick_take(eng, "Kalimat keempat yang cukup panjang.", Path("ref.wav"), st3, None, TMP)
        assert loaded == [("tarepan/SpeechMOS:v1.2.0", "utmos22_strong", True)], loaded
        assert info4["take"] == 2 and info4["mos"] == 4.4 and info4.get("st") is not None, info4
        assert len(info4["alt"]) == 2 and all("mos" in a for a in info4["alt"]), info4
    finally:
        natural.log.removeHandler(cap)
    return f"tanpa torch / hub error / dimatikan → take tetap dipilih; UTMOS palsu → versi {info4['take']} (MOS {info4['mos']})"


@test
def t_satu_tarikan_dan_cadangan_per_kalimat():
    sb, v = bank()
    eng = Eng()
    text = "Kerjaan numpuk terus? Tenang… ada cara yang jauh lebih gampang. Coba sekarang juga."
    # (1) ASR mendengar benar → satu tarikan: mesin dipanggil dengan SELURUH baris, jumlah panggilan = takes
    asr = Asr(lambda n: text, line=text)
    rt = Runtime(cfg=cfg_("st1"), supa=sb, engines=Engines(eng), asr=asr)  # type: ignore[arg-type]
    j = run_job(sb, rt, "j-one", [{"id": "a", "scene_id": "a", "text": text, "start": 0.2}], {"takes": 2})
    assert [c[0] for c in eng.calls] == [T.clean_text(text)] * 2, eng.calls
    row = j["result"]["lines"][0]
    assert row["natural"]["mode"] == "satu-tarikan" and row["natural"]["st"] is not None, row["natural"]
    assert [w["w"] for w in row["words"]] == text.split() and row["words"][-1]["e"] <= row["dur"] + 1e-6
    # (2) satu tarikan salah ucap terus (WER > 0,35), per kalimat benar → mode per kalimat dipakai
    eng2 = Eng()
    sents = T.split_sentences(text)

    def heard(n):
        cur = eng2.calls[-1][0]
        return "bla bla salah total sekali" if cur == T.clean_text(text) else cur

    asr2 = Asr(heard, line=text)
    rt2 = Runtime(cfg=cfg_("st2"), supa=sb, engines=Engines(eng2), asr=asr2)  # type: ignore[arg-type]
    j2 = run_job(sb, rt2, "j-fb", [{"id": "b", "scene_id": "b", "text": text, "start": 0.2}], {"takes": 1})
    texts = [c[0] for c in eng2.calls]
    assert texts[0] == T.clean_text(text) and set(sents) <= set(texts), texts
    r2 = j2["result"]["lines"][0]
    assert r2["natural"]["mode"] == "per-kalimat", r2["natural"]
    assert j2["result"]["natural"]["per_kalimat"] == 1
    # (3) teks panjang (> 260 huruf) → beberapa potong berisi kalimat utuh, disambung room tone
    eng3 = Eng()
    longt = " ".join(f"Kalimat ke {i} ini dibuat agak panjang supaya baris melewati batas satu tarikan." for i in range(1, 7))
    rt3 = Runtime(cfg=cfg_("st3"), supa=sb, engines=Engines(eng3), asr=None)  # type: ignore[arg-type]
    j3 = run_job(sb, rt3, "j-long", [{"id": "c", "scene_id": "c", "text": longt, "start": 0}], {"takes": 1})
    chunks = [c[0] for c in eng3.calls]
    assert len(chunks) >= 2 and all(len(c) <= 260 for c in chunks) and " ".join(chunks) == " ".join(T.split_sentences(longt)), chunks
    w3 = j3["result"]["lines"][0]["words"]
    assert [w["w"] for w in w3] == longt.split() and w3[-1]["e"] <= j3["result"]["lines"][0]["dur"] + 1e-6
    # kunci cache naik: v2
    assert jobs_tts.CACHE_V != "tts-v1"
    return f"satu tarikan {len(eng.calls)} panggilan; cadangan per kalimat {len(texts)} panggilan; teks panjang {len(chunks)} potong"


@test
def t_cadangan_per_kalimat_hanya_bila_jelas_lebih_baik():
    """syarat cadangan dari WER terkecil SEMUA versi (bukan versi terpilih) + histeresis memihak satu tarikan"""
    sr = 24000
    text = "Kerjaan numpuk terus? Tenang… ada caranya. Coba sekarang."
    one = phrase(8, sr, True, 70)
    calls: list[str] = []
    o_pick, o_per = jobs_tts.pick_take, jobs_tts.per_sentence

    def run(one_info: dict, per_score: float) -> dict:
        calls.clear()
        jobs_tts.pick_take = lambda *a, **k: (one.copy(), dict(one_info))

        def per(*a, **k):
            calls.append("per")
            return one.copy(), {"score": per_score, "wer": per_score, "dur": 1.0, "mode": "per-kalimat", "parts": [], "mos": None, "st": None}

        jobs_tts.per_sentence = per
        w = TMP / f"cad-{len(calls)}-{per_score}"
        w.mkdir(parents=True, exist_ok=True)
        _, meta = jobs_tts.make_line(Eng(), {"id": "x", "text": text, "spell": None}, BANK / "referensi-alif-energik-10dtk.wav", {"takes": 2}, None, w)
        return meta

    try:
        # versi terpilih WER 0,40 tapi ada versi lain WER 0,30 → TIDAK coba per kalimat
        m1 = run({"score": 0.42, "wer": 0.40, "wer_min": 0.30, "dur": 1.0}, 0.0)
        assert not calls and m1["natural"]["mode"] == "satu-tarikan", (calls, m1["natural"])
        # semua versi jelek, per kalimat hanya sedikit lebih baik (0,40 vs 0,42) → tetap satu tarikan (intonasi utuh)
        m2 = run({"score": 0.42, "wer": 0.40, "wer_min": 0.40, "dur": 1.0}, 0.40)
        assert calls == ["per"] and m2["natural"]["mode"] == "satu-tarikan", (calls, m2["natural"])
        # per kalimat JELAS lebih baik → dipakai
        m3 = run({"score": 0.42, "wer": 0.40, "wer_min": 0.40, "dur": 1.0}, 0.20)
        assert m3["natural"]["mode"] == "per-kalimat", m3["natural"]
    finally:
        jobs_tts.pick_take, jobs_tts.per_sentence = o_pick, o_per
    # level potongan disamakan sebelum disambung: beda 4 dB → sisa ≤ 1,5 dB; beda 1 dB (variasi alami) dibiarkan
    a, b = phrase(6, sr, True, 80), phrase(6, sr, True, 81)
    la = natural.speech_level(a, sr)
    after4 = None
    for diff, keep in ((4.0, False), (1.0, True)):
        b2 = (b * 10 ** (-diff / 20) * 10 ** ((la - natural.speech_level(b, sr)) / 20)).astype(np.float32)
        m = natural.match_levels([a, b2], sr)
        after = abs(natural.speech_level(m[0], sr) - natural.speech_level(m[1], sr))
        if keep:
            assert m[0] is a and m[1] is b2, "beda kecil harus dibiarkan"
        else:
            assert after <= natural.LEVEL_TOL + 0.2, f"sisa beda level {after:.2f} dB"
            after4 = after
    return f"cadangan: WER terkecil + histeresis {natural.NEAR}; level beda 4 dB → {after4:.2f} dB, beda 1 dB dibiarkan"


@test
def t_tempo_alami_dulu_baru_atempo():
    text = "Satu dua tiga empat lima enam tujuh delapan sembilan sepuluh."
    # mesin TANPA tempo asli → perilaku lama: hanya padatkan jeda + atempo, tidak bikin suara ulang
    sb, v = bank()
    e0 = Eng(native=False)
    rt0 = Runtime(cfg=cfg_("e4a"), supa=sb, engines=Engines(e0), asr=None)  # type: ignore[arg-type]
    j0 = run_job(sb, rt0, "e4-0", [{"id": "m", "scene_id": "m", "text": text, "start": 0}])
    d0 = j0["result"]["lines"][0]["dur"]
    sp0 = jobs_tts.speech_end(j0["result"]["lines"][0])
    mx = round(sp0 * 0.78, 3)
    n0 = len(e0.calls)
    j0b = run_job(sb, rt0, "e4-0b", [{"id": "m", "scene_id": "m", "text": text, "start": 0, "max": mx}])
    l0 = j0b["result"]["lines"][0]
    assert len(e0.calls) == n0, "mesin tanpa tempo asli tidak boleh bikin suara ulang"
    assert l0["natural"]["native"] == 0 and l0["speed"] >= 20, l0
    # mesin DENGAN tempo asli (durasi ikut cfg_weight) → dibuat ulang sekali dengan cfg_weight + 0,2, atempo jauh lebih kecil
    sb2, _ = bank()
    e1 = Eng(native=True)
    rt1 = Runtime(cfg=cfg_("e4b"), supa=sb2, engines=Engines(e1), asr=None)  # type: ignore[arg-type]
    j1 = run_job(sb2, rt1, "e4-1", [{"id": "m", "scene_id": "m", "text": text, "start": 0}], {"takes": 1, "cfg_weight": 0.35})
    assert [c[1] for c in e1.calls] == [0.35], "tanpa max: tidak ada pembuatan ulang (job lama tetap sama)"
    l_plain = j1["result"]["lines"][0]
    assert not ({"speed", "tempo", "squeeze"} & set(l_plain)) and l_plain["natural"]["native"] == 0 and l_plain["natural"]["atempo"] == 0, l_plain
    j2 = run_job(sb2, rt1, "e4-2", [{"id": "m", "scene_id": "m", "text": text, "start": 0, "max": mx}], {"takes": 1, "cfg_weight": 0.35})
    l1 = j2["result"]["lines"][0]
    assert [c[1] for c in e1.calls] == [0.35, 0.55], f"harus dibuat ulang sekali dengan cfg 0,55: {e1.calls}"
    assert l1["natural"]["native"] >= 10, l1["natural"]
    assert int(l1.get("speed") or 0) < l0["speed"] - 10, (l1.get("speed"), l0["speed"])
    assert jobs_tts.speech_end(l1) <= mx + 0.02 and [w["w"] for w in l1["words"]] == text.split(), (jobs_tts.speech_end(l1), mx)
    assert j2["result"]["natural"]["native"] == 1
    # versi cepat tersimpan di cache laptop → job berikutnya tidak bikin suara lagi
    calls = len(e1.calls)
    run_job(sb2, rt1, "e4-3", [{"id": "m", "scene_id": "m", "text": text, "start": 0.1, "max": mx}], {"takes": 1, "cfg_weight": 0.35})
    assert len(e1.calls) == calls, "versi tempo cepat harus diambil dari cache"
    # kecepatan eksplisit dari user tetap dihormati (atempo persis, tanpa buat ulang)
    j4 = run_job(sb2, rt1, "e4-4", [{"id": "m", "scene_id": "m", "text": text, "start": 0, "max": mx, "speed": 1.1}], {"takes": 1, "cfg_weight": 0.35})
    l4 = j4["result"]["lines"][0]
    assert len(e1.calls) == calls and l4["tempo"] == 1.1 and l4["natural"]["manual"] and l4["natural"]["native"] == 0, l4
    # cfg sudah ≥ 0,85 → tidak ada ruang menaikkan tempo asli
    w, m = jobs_tts.native_fit(Path("x.wav"), {"dur": 1.0, "words": []}, None, {"cfg_weight": 0.9}, TMP, "z", lambda s: None)
    assert m == {"dur": 1.0, "words": []}
    return f"tanpa tempo asli: +{l0['speed']}% atempo; dengan tempo asli: asli +{l1['natural']['native']}%, atempo +{int(l1.get('speed') or 0)}% (jendela {mx:.2f} dtk, ucapan {sp0:.2f} dtk, dur {d0:.2f})"


@test
def t_takes_bawaan_3_dan_batas_waktu():
    assert jobs_tts.norm_settings({})["takes"] == 3 and jobs_tts.norm_settings(None)["takes"] == 3
    assert jobs_tts.norm_settings({"takes": 1})["takes"] == 1 and jobs_tts.norm_settings({"takes": 9})["takes"] == 4
    # job tanpa settings.takes → TAKES di .env (bawaan config 3) dipakai apa adanya — termasuk 1 untuk laptop lambat
    assert config.load(Path(TMP / "tidak-ada.env")).takes == 3
    sb, v = bank()
    eng = Eng()
    rt = Runtime(cfg=cfg_("tk", takes=3), supa=sb, engines=Engines(eng), asr=None)  # type: ignore[arg-type]
    j = run_job(sb, rt, "tk-1", [{"id": "a", "scene_id": "a", "text": "Halo semuanya, ini tes tiga versi.", "start": 0}], {})
    assert j["result"]["settings"]["takes"] == 3 and len(eng.calls) == 3, (j["result"]["settings"], len(eng.calls))
    eng1 = Eng()
    rt1 = Runtime(cfg=cfg_("tk1", takes=1), supa=sb, engines=Engines(eng1), asr=None)  # type: ignore[arg-type]
    j1 = run_job(sb, rt1, "tk-2", [{"id": "a", "scene_id": "a", "text": "Halo semuanya, ini tes satu versi.", "start": 0}], {})
    assert j1["result"]["settings"]["takes"] == 1 and len(eng1.calls) == 1, (j1["result"]["settings"], len(eng1.calls))
    # batas waktu: mesin lambat → minimal 2 versi, versi berikutnya dilewati kalau melewati batas
    slow = Eng(sleep=0.08)
    orig = jobs_tts.take_budget
    jobs_tts.take_budget = lambda s: 0.2
    try:
        _, info = jobs_tts.pick_take(slow, "Kalimat lambat sekali.", Path("ref.wav"), {"exaggeration": 0.6, "cfg_weight": 0.35, "temperature": 0.8, "takes": 4}, None, TMP)
    finally:
        jobs_tts.take_budget = orig
    assert len(slow.calls) == 2, f"harus berhenti di 2 versi, dapat {len(slow.calls)}"
    assert jobs_tts.take_budget("x" * 145) == max(jobs_tts.TAKE_BUDGET_MIN, jobs_tts.TAKE_BUDGET_PER_SEC * 10)
    return f"bawaan 3 versi; mesin lambat berhenti di {len(slow.calls)} versi; batas 10 dtk ucapan = {jobs_tts.take_budget('x' * 145):.0f} dtk"


@test
def t_ringkasan_kealamian_di_hasil_job():
    sb, v = bank()
    eng = Eng()
    rt = Runtime(cfg=cfg_("sum"), supa=sb, engines=Engines(eng), asr=None)  # type: ignore[arg-type]
    lines = [{"id": "a", "scene_id": "a", "text": "Masih kerja manual?", "start": 0.1}, {"id": "b", "scene_id": "b", "text": "Coba cara baru. Lebih cepat, lebih rapi.", "start": 3.0}]
    j = run_job(sb, rt, "sum-1", lines, {"takes": 2})
    r = j["result"]
    for row in r["lines"]:
        n = row["natural"]
        assert set(n) >= {"mos", "st", "mono", "mode", "native", "atempo"}, n
        assert n["mos"] is None and isinstance(n["st"], float) and n["native"] == 0 and n["atempo"] == 0, n
    s = r["natural"]
    assert s["lines"] == 2 and s["st"] is not None and s["mos"] is None and s["native"] == 0 and s["atempo"] == 0, s
    assert s["mos_status"].startswith("tidak dipakai") or s["mos_status"] == "belum dimuat", s
    return f"baris: {r['lines'][1]['natural']}; job: {s}"


@test
def t_bersihkan_ulang_referensi_sekali():
    jobs_clean._RECLEANED.clear()
    sb, v = bank(ver=None)  # suara lama (pembersih versi 1)
    rt = Runtime(cfg=cfg_("rc"), supa=sb, engines=None, asr=None)  # type: ignore[arg-type]
    old_clean = sb.files[v["clean_path"]]
    assert jobs_clean.outdated(v)
    v2, ref, vhash = jobs_tts.voice_ref(rt, v["id"])
    row = sb.tables["studio_voices"][0]
    assert row["status"] == "siap" and row["quality"].get("ver") == clean.CLEAN_VER, row["quality"]
    assert sb.files[row["clean_path"]] != old_clean, "clean.wav harus diganti hasil pembersih baru"
    assert ref.exists() and ref.read_bytes() == sb.files[row["clean_path"]], "file referensi lokal harus versi baru (tag ikut versi)"
    # panggilan berikutnya: tidak dibersihkan ulang lagi
    before = dict(row)
    jobs_tts.voice_ref(rt, v["id"])
    assert sb.tables["studio_voices"][0]["quality"] == before["quality"]
    # gagal (rekaman mentah hilang) → status & clean lama dikembalikan, ditandai ver_try, tidak dicoba terus
    jobs_clean._RECLEANED.clear()
    sb2, v3 = bank(ver=None)
    del sb2.files[v3["raw_path"]]
    rt2 = Runtime(cfg=cfg_("rc2"), supa=sb2, engines=None, asr=None)  # type: ignore[arg-type]
    _, ref2, _ = jobs_tts.voice_ref(rt2, v3["id"])
    r2 = sb2.tables["studio_voices"][0]
    assert r2["status"] == "siap" and r2["clean_path"] == v3["clean_path"] and r2["quality"].get("ver_try") == clean.CLEAN_VER, r2
    assert r2["quality"].get("saran") == "ok", "quality lama harus dikembalikan"
    assert ref2.read_bytes() == sb2.files[v3["clean_path"]]
    jobs_clean._RECLEANED.clear()  # sesi baru pun tidak mencoba lagi (ver_try tersimpan)
    assert not jobs_clean.outdated(r2)
    return f"versi {clean.CLEAN_VER}: dibersihkan ulang sekali (mulai {row['quality'].get('start')} dtk, nada ±{row['quality'].get('st')} st); gagal → clean lama tetap dipakai"


@test
def t_sampling_chatterbox_sesuai_signature():
    def new_en(text, repetition_penalty=1.2, min_p=0.05, top_p=1.0, audio_prompt_path=None, exaggeration=0.5, cfg_weight=0.5, temperature=0.8):
        pass

    def mtl(text, language_id, audio_prompt_path=None, exaggeration=0.5, cfg_weight=0.5, temperature=0.8, repetition_penalty=2.0, min_p=0.05, top_p=1.0):
        pass

    def old(text, audio_prompt_path=None, exaggeration=0.5, cfg_weight=0.5, temperature=0.8):
        pass

    def kw(text, **kwargs):
        pass

    class M:
        def generate(self, text, *, min_p=0.1, exaggeration=0.5):
            pass

    assert cbe.sampling_kwargs(new_en) == {"min_p": 0.05, "repetition_penalty": 1.2}
    assert cbe.sampling_kwargs(mtl) == {"min_p": 0.05}, "repetition_penalty bawaan yang lebih ketat (2,0) tidak boleh diturunkan"
    assert cbe.sampling_kwargs(old) == {} and cbe.sampling_kwargs(kw) == {}
    assert cbe.sampling_kwargs(M().generate) == {"min_p": 0.05}
    assert cbe.sampling_kwargs(len) in ({}, {"min_p": 0.05}) and cbe.sampling_kwargs(object()) == {}
    assert getattr(cbe.ChatterboxEngine, "native_tempo", False) is True
    return "standar: min_p + rep 1,2 · bawaan rep 2,0: min_p saja · lama / **kwargs: tidak dikirim"


def main() -> int:
    only = [a.lower() for a in sys.argv[1:]]
    for fn in TESTS:
        if not only or any(o in fn.__name__.lower() for o in only):
            run_test(fn)
    ok = sum(1 for r in results if r[1])
    print(f"\n=== {ok}/{len(results)} tes lolos ===")
    for n, good, info in results:
        if not good:
            print(f"  GAGAL: {n} — {info}")
    shutil.rmtree(TMP, ignore_errors=True)
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
