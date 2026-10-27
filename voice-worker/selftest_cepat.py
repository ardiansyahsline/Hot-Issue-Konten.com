"""
Tes mandiri MESIN SUARA CEPAT (jalur cepat Chatterbox t3fast + pemilih versi sekaligus) — tanpa GPU / internet:
  .venv\\Scripts\\python selftest_cepat.py              (semua tes; tes berat butuh torch + chatterbox-tts, ±10–20 mnt di CPU)
  .venv\\Scripts\\python selftest_cepat.py --ringan     (hanya tes ringan tanpa torch)
  .venv\\Scripts\\python selftest_cepat.py --tanpa-ukur (lewati pengukuran kecepatan)
  .venv\\Scripts\\python selftest_cepat.py batch hook   (hanya tes yang namanya mengandung kata itu)

Tes ringan (tanpa torch): batas waktu dari panjang kalimat, rencana jumlah versi dari catatan kecepatan, pick_take versi sekaligus
(format info take sama), batch tambahan kalau semua salah ucap, kompatibel mesin lama, make_line meneruskan speed/cfg, ASR dari
array + beam kecil, Engines.warmup, pemuat model tidak mengunduh di tengah job, TTS_DTYPE=auto bf16 hanya di GPU bf16 asli (sm ≥ 80),
whisper dimuat sekali walau dipanggil bersamaan dari banyak thread, baris kembar dalam satu job memakai cache baris sebelumnya.
Tes berat (torch + chatterbox, bobot ACAK di CPU, model T3 asli 520M parameter): token jalur cepat IDENTIK dengan T3.inference
bawaan (benih sama), SDPA + 3 layer eager (mask kausal prefill dibuktikan), batch n versi = n kali 1 versi, hook tidak menumpuk,
bf16 + NaN → NonFinite, EOS & batas token, pengecek keselarasan per versi = AlignmentStreamAnalyzer bawaan, logika mesin
(VRAM penuh → belah batch, NaN → fp32, error → cara bawaan), cara bawaan tetap jalan saat transformer bf16 (T3 asli kecil),
belah batch / ulang fp32 di luar except (memori percobaan gagal sudah lepas), ganti dtype atomik, ukur langkah/dtk (angka CPU,
bukan GPU laptop).
"""
from __future__ import annotations

import gc
import logging
import os
import shutil
import sys
import tempfile
import time
import traceback
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("TQDM_DISABLE", "1")  # progress bar bawaan T3.inference
sys.path.insert(0, str(Path(__file__).resolve().parent))

from studio_worker import config  # noqa: E402

config.apply_thread_limits(max(2, min(4, os.cpu_count() or 2)))

import numpy as np  # noqa: E402

from studio_worker import jobs_tts, natural  # noqa: E402
from studio_worker import speed as speedmod  # noqa: E402
from studio_worker.engines import Engines, t3fast  # noqa: E402

HERE = Path(__file__).resolve().parent
BANK = HERE / "bank-suara"
TMP = Path(tempfile.mkdtemp(prefix="vw-cepat-"))
results: list[tuple[str, bool, str]] = []
TESTS: list = []
MEASURE: dict = {}
ARGS = [a for a in sys.argv[1:]]
LIGHT_ONLY = "--ringan" in ARGS
NO_MEASURE = "--tanpa-ukur" in ARGS
ONLY = [a.lower() for a in ARGS if not a.startswith("--")]

try:  # tes berat hanya kalau torch + chatterbox ada (venv laptop / venv tes)
    import torch  # noqa: E402

    from chatterbox.models.t3 import T3  # noqa: E402
    from chatterbox.models.t3.modules.cond_enc import T3Cond  # noqa: E402
    from chatterbox.models.t3.modules.t3_config import T3Config  # noqa: E402

    HAVE_TORCH = True
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
except Exception as _e:  # noqa: BLE001
    HAVE_TORCH = False
    WHY_NO_TORCH = f"{type(_e).__name__}: {_e}"

logging.getLogger("vw").setLevel(logging.INFO)  # pesan info jobs_tts ditangkap tes (tanpa dicetak)
for _n in ("chatterbox", "transformers", "chatterbox.models.t3.t3", "chatterbox.models.t3.inference.alignment_stream_analyzer"):
    logging.getLogger(_n).setLevel(logging.ERROR)


def test(fn):
    fn.heavy = False
    TESTS.append(fn)
    return fn


def heavy(fn):
    fn.heavy = True
    TESTS.append(fn)
    return fn


def run_test(fn) -> None:
    name = fn.__name__.removeprefix("t_").replace("_", " ")
    if fn.heavy and (LIGHT_ONLY or not HAVE_TORCH):
        why = "--ringan" if LIGHT_ONLY else WHY_NO_TORCH
        print(f"[LEWAT] {name} (butuh torch + chatterbox-tts: {why[:80]})")
        return
    t0 = time.time()
    natural.reset()
    natural.configure(False)  # UTMOS tidak dipakai di tes ini (tanpa internet)
    try:
        info = fn() or ""
        results.append((name, True, f"{info} ({time.time() - t0:.1f} dtk)"))
        print(f"[OK]    {name} {info} ({time.time() - t0:.1f} dtk)", flush=True)
    except Exception as e:
        results.append((name, False, f"{type(e).__name__}: {e}"))
        print(f"[GAGAL] {name}: {type(e).__name__}: {e}", flush=True)
        traceback.print_exc()
    finally:
        natural.reset()


class _Catch(logging.Handler):
    def __init__(self):
        super().__init__()
        self.msgs: list[str] = []

    def emit(self, record):
        self.msgs.append(record.getMessage())


# ---------------------------------------------------------------- palsu (tanpa torch)
def speechy(text: str, sr: int = 24000, seed: int = 0) -> np.ndarray:
    """sinyal mirip ucapan sepanjang perkiraan teks (±14,5 huruf/dtk): suku kata harmonik + jeda pendek"""
    rnd = np.random.default_rng(seed)
    total = max(0.6, len(text) / 14.5)
    parts, t_acc = [], 0.0
    while t_acc < total:
        d = rnd.uniform(0.18, 0.3)
        t = np.arange(int(d * sr)) / sr
        f0 = rnd.uniform(110, 160)
        env = np.sin(np.pi * t / d) ** 0.7
        parts.append((sum((0.3 / k) * np.sin(2 * np.pi * f0 * k * t) for k in range(1, 6)) * env).astype(np.float32))
        g = rnd.uniform(0.04, 0.08)
        parts.append(np.zeros(int(g * sr), np.float32))
        t_acc += d + g
    pad = np.zeros(int(0.1 * sr), np.float32)
    return np.concatenate([pad, *parts, pad])


class BatchEng:
    """mesin palsu dengan synth_batch (seperti Chatterbox baru)"""

    name = "chatterbox"
    sr = 24000
    label = "palsu"
    credit = None
    native_tempo = False

    def __init__(self, cfg=None, sleep: float = 0.0):
        self.cfg = cfg
        self.sleep = sleep
        self.batches: list[tuple[str, list[int]]] = []
        self.singles: list[int] = []

    def synth_batch(self, text, ref, st, seeds, max_sec=None):
        self.batches.append((text, list(seeds)))
        if self.sleep:
            time.sleep(self.sleep)
        return [speechy(text, self.sr, s % 1000) for s in seeds]

    def synth(self, text, ref, st, seed):
        self.singles.append(seed)
        if self.sleep:
            time.sleep(self.sleep)
        return speechy(text, self.sr, seed % 1000)


class SeqEng:
    """mesin lama tanpa synth_batch (seperti pocket-tts)"""

    name = "pocket"
    sr = 24000
    label = "palsu"
    credit = None

    def __init__(self):
        self.calls: list[int] = []

    def synth(self, text, ref, st, seed):
        self.calls.append(seed)
        return speechy(text, self.sr, seed % 1000)


class AsrNew:
    """ASR baru: transcribe(src, words, beam) — src boleh np.ndarray 16 kHz"""

    available = True
    device = "palsu"

    def __init__(self, answer):
        self.answer = answer  # callable(n) → teks
        self.n = 0
        self.got: list[tuple[str, int | None, bool, int]] = []

    def transcribe(self, src, words=True, beam=None):
        self.n += 1
        kind = "array" if isinstance(src, np.ndarray) else "path"
        self.got.append((kind, beam, words, int(getattr(src, "size", 0))))
        return self.answer(self.n), []


class AsrOld:
    """ASR lama: transcribe(path, words) — harus tetap jalan (baca wav dari path)"""

    available = True
    device = "palsu"

    def __init__(self, answer):
        self.answer = answer
        self.n = 0

    def transcribe(self, path, words=True):
        from studio_worker import ff

        ff.read_wav(Path(path))
        self.n += 1
        return self.answer(self.n), []


ST = {"exaggeration": 0.6, "cfg_weight": 0.35, "temperature": 0.8, "takes": 3}
SENT = "Kerjaan numpuk terus tiap hari? Tenang, ada cara yang jauh lebih gampang buat kamu."  # ±85 huruf ≈ 5,9 dtk
INFO_KEYS = {"take", "score", "wer", "heard", "dur", "wer_min", "alt", "mos", "st"}


def slow_speed(ratio: float) -> speedmod.Speed:
    sp = speedmod.Speed(TMP / f"speed-{ratio}-{time.time_ns()}.json")
    for _ in range(3):
        for eng in ("chatterbox", "pocket"):
            sp.record(eng, 6.0, 6.0 * ratio, 1)
    return sp


# ---------------------------------------------------------------- tes ringan
@test
def t_batas_waktu_dari_panjang_kalimat():
    assert jobs_tts.line_budget("x" * 145) == 80.0, jobs_tts.line_budget("x" * 145)  # 10 dtk × 8
    assert jobs_tts.line_budget("x" * 20) == 20.0  # minimal 20 dtk (dulu 45 dtk tetap)
    assert jobs_tts.take_budget("x" * 145) == max(jobs_tts.TAKE_BUDGET_MIN, jobs_tts.TAKE_BUDGET_PER_SEC * 10)
    cfg = SimpleNamespace(line_budget_min=30.0, line_budget_per_sec=5.0)
    assert jobs_tts.line_budget("x" * 145, cfg) == 50.0 and jobs_tts.line_budget("x" * 20, cfg) == 30.0
    # batas token suara dari panjang teks: ceil(25 × min(40, 2,5 × perkiraan + 3)), perkiraan min 4 dtk
    assert t3fast.max_tokens_for("x" * 14) == 325, t3fast.max_tokens_for("x" * 14)
    assert t3fast.max_tokens_for("x" * 145) == 700
    assert t3fast.max_tokens_for("x" * 2000) == 1000
    assert t3fast.max_tokens_for("x" * 145, max_sec=5) == 125
    # .env bawaan
    c = config.load(Path(TMP / "tidak-ada.env"))
    assert (c.tts_dtype, c.tts_batch, c.asr_beam_takes, c.line_budget_per_sec, c.line_budget_min) == ("auto", True, 1, 8.0, 20.0)
    return "kalimat 10 dtk → 80 dtk (dulu 80), 1,4 dtk → 20 dtk (dulu 45); token 13 dtk / 28 dtk / maks 40 dtk"


@test
def t_rencana_jumlah_versi_dari_kecepatan():
    b = jobs_tts.line_budget(SENT)
    cap = _Catch()
    jobs_tts.log.addHandler(cap)
    try:
        assert jobs_tts.plan_takes("chatterbox", SENT, 3, b, None, True) == 3  # tanpa catatan → apa adanya
        fresh = speedmod.Speed(TMP / "kosong.json")  # belum diukur → perkiraan PRIOR (4 dtk/dtk, batch +25%/versi)
        assert jobs_tts.plan_takes("chatterbox", SENT, 3, b, fresh, True) == 3
        mid = slow_speed(6.0)  # 3 sekaligus ≈ 5,9 × 6 × 1,5 = 53 dtk > 47 → 2 versi (44 dtk)
        assert jobs_tts.plan_takes("chatterbox", SENT, 3, b, mid, True) == 2, (b, mid.estimate("chatterbox", len(SENT), 3))
        slow = slow_speed(12.0)
        assert jobs_tts.plan_takes("chatterbox", SENT, 3, b, slow, True) == 1  # minimal 1
        assert jobs_tts.plan_takes("chatterbox", SENT, 3, b, mid, False) == 1  # satu-satu: 2 × 35 dtk > 47
        assert jobs_tts.plan_takes("chatterbox", SENT, 1, b, slow, True) == 1
    finally:
        jobs_tts.log.removeHandler(cap)
    why = [m for m in cap.msgs if "laptop:" in m]
    assert len(why) == 3 and "bukan 3" in why[0], cap.msgs
    return f"batas {b:.0f} dtk: belum diukur 3 · laptop 6×→2 · 12×→1 · log: {why[0].strip()!r}"


@test
def t_pick_take_versi_sekaligus_format_sama():
    cfg = SimpleNamespace(tts_batch=True, asr_beam_takes=1, line_budget_min=20.0, line_budget_per_sec=8.0)
    eng = BatchEng(cfg)
    asr = AsrNew(lambda n: "kerjaan numpuk terus tiap hari tenang ada cara yang jauh lebih gampang buat kamu" if n % 2 == 0 else "kerjaan numpuk terus")
    sp = speedmod.Speed(TMP / "sp-batch.json")
    ticks: list[int] = []
    cap = _Catch()
    jobs_tts.log.addHandler(cap)
    try:
        y, info = jobs_tts.pick_take(eng, SENT, Path("ref.wav"), ST, asr, TMP, ticks.append, speed=sp)
    finally:
        jobs_tts.log.removeHandler(cap)
    assert len(eng.batches) == 1 and not eng.singles, (eng.batches, eng.singles)
    assert eng.batches[0][1] == [jobs_tts.take_seed(SENT, k) for k in range(3)], eng.batches
    assert ticks == [0, 1, 2], ticks
    assert info["take"] == 2 and info["wer"] == 0, info  # versi genap terdengar benar
    assert INFO_KEYS <= set(info), set(info)
    assert [a["take"] for a in info["alt"]] == [1, 3] and all(set(a) == {"take", "score", "wer", "mos", "st"} for a in info["alt"])
    assert all(k == "array" and b == 1 and not w for k, b, w, _ in asr.got), asr.got  # dari array, beam kecil, tanpa timestamp
    assert sp.measured("chatterbox") and "3" in sp.data["chatterbox"]["r"], sp.data
    line = [m for m in cap.msgs if "versi sekaligus" in m]
    assert line and "dtk suara dalam" in line[0] and "," in line[0], cap.msgs
    # format info sama persis dengan jalur satu-satu (mesin lama)
    seq = SeqEng()
    asr2 = AsrOld(lambda n: "kerjaan numpuk terus tiap hari tenang ada cara yang jauh lebih gampang buat kamu" if n % 2 == 0 else "kerjaan numpuk terus")
    _, info2 = jobs_tts.pick_take(seq, SENT, Path("ref.wav"), ST, asr2, TMP)
    assert set(info) == set(info2) and info2["take"] == 2 and len(seq.calls) == 3, (set(info) ^ set(info2), info2)
    # benih baris (🎧 Coba ejaan) ikut, beam dari .env
    eng2 = BatchEng(SimpleNamespace(tts_batch=True, asr_beam_takes=2))
    a3 = AsrNew(lambda n: "x")
    jobs_tts.pick_take(eng2, SENT, Path("ref.wav"), {**ST, "takes": 2}, a3, TMP, seed=777)
    assert eng2.batches[0][1] == [jobs_tts.take_seed(SENT, 0, 777), jobs_tts.take_seed(SENT, 1, 777)]
    assert {b for _, b, _, _ in a3.got} == {2}
    return f"1 panggilan 3 versi → pilih versi {info['take']}; log {line[0].strip()!r}"


@test
def t_pick_take_batch_tambahan_kalau_semua_jelek():
    cfg = SimpleNamespace(tts_batch=True, asr_beam_takes=1)
    eng = BatchEng(cfg)
    asr = AsrNew(lambda n: "bla bla salah total")
    _, info = jobs_tts.pick_take(eng, SENT, Path("ref.wav"), ST, asr, TMP)
    assert [len(s) for _, s in eng.batches] == [3, 2], eng.batches  # satu batch tambahan maks 2 versi
    assert eng.batches[1][1] == [jobs_tts.take_seed(SENT, k) for k in (3, 4)]
    assert len(info["alt"]) == 4 and asr.n == 5
    # waktu tidak cukup (laptop sangat lambat menurut catatan) → tidak ada batch tambahan, alasan dicatat
    eng2 = BatchEng(cfg)
    cap = _Catch()
    jobs_tts.log.addHandler(cap)
    try:
        jobs_tts.pick_take(eng2, SENT, Path("ref.wav"), ST, AsrNew(lambda n: "salah"), TMP, speed=slow_speed(30.0))
    finally:
        jobs_tts.log.removeHandler(cap)
    assert [len(s) for _, s in eng2.batches] == [1], eng2.batches
    assert any("tidak muat" in m for m in cap.msgs), cap.msgs
    # tanpa ASR / mode coba ejaan → tidak ada tambahan
    eng3 = BatchEng(cfg)
    jobs_tts.pick_take(eng3, SENT, Path("ref.wav"), ST, None, TMP)
    eng4 = BatchEng(cfg)
    _, i4 = jobs_tts.pick_take(eng4, SENT, Path("ref.wav"), {**ST, "takes": 1, "trial": True}, AsrNew(lambda n: "salah"), TMP)
    assert [len(s) for _, s in eng3.batches] == [3] and [len(s) for _, s in eng4.batches] == [1] and "alt" not in i4
    return "semua salah → 3 + 2 versi; laptop lambat → 1 versi tanpa tambahan; coba ejaan → 1 versi"


@test
def t_pick_take_kompatibel_mesin_lama():
    # mesin tanpa synth_batch + catatan lambat → versi direncanakan (1), tetap satu-satu
    seq = SeqEng()
    jobs_tts.pick_take(seq, SENT, Path("ref.wav"), ST, None, TMP, speed=slow_speed(30.0))
    assert len(seq.calls) == 1, seq.calls
    # tanpa speed → perilaku lama (3 versi)
    seq2 = SeqEng()
    jobs_tts.pick_take(seq2, SENT, Path("ref.wav"), ST, None, TMP)
    assert len(seq2.calls) == 3
    # TTS_BATCH=0 → mesin baru pun satu-satu
    eng = BatchEng(SimpleNamespace(tts_batch=False))
    jobs_tts.pick_take(eng, SENT, Path("ref.wav"), ST, None, TMP)
    assert not eng.batches and len(eng.singles) == 3
    # mesin lambat satu-satu: minimal 2 versi lalu berhenti (batas waktu lama tetap)
    slow = BatchEng(SimpleNamespace(tts_batch=False, line_budget_min=0.2, line_budget_per_sec=0.001), sleep=0.08)
    jobs_tts.pick_take(slow, "Kalimat lambat.", Path("ref.wav"), {**ST, "takes": 4}, None, TMP)
    assert len(slow.singles) == 2, slow.singles
    return "mesin lama + lambat → 1 versi; tanpa speed → 3; TTS_BATCH=0 → satu-satu; lambat → berhenti di 2"


@test
def t_make_line_meneruskan_speed_dan_cfg():
    ref = BANK / "referensi-alif-energik-10dtk.wav"
    assert ref.exists(), ref
    cfg = SimpleNamespace(tts_batch=True, asr_beam_takes=3)
    eng = BatchEng(cfg)
    text = "Halo semuanya, ini tes suara cepat."
    asr = AsrNew(lambda n: "halo semuanya ini tes suara cepat")
    sp = speedmod.Speed(TMP / "sp-line.json")
    w = TMP / "line1"
    w.mkdir(parents=True, exist_ok=True)
    _, meta = jobs_tts.make_line(eng, {"id": "a", "text": text, "spell": None}, ref, {**ST, "takes": 2}, asr, w, speed=sp, cfg=cfg)
    assert len(eng.batches) == 1 and len(eng.batches[0][1]) == 2 and sp.measured("chatterbox")
    assert {b for k, b, words, _ in asr.got if not words} == {3}, asr.got
    assert meta["takes"][0]["take"] in (1, 2) and meta["dur"] > 0.5
    # pemanggil lama (tanpa speed / cfg) tetap jalan
    eng2 = BatchEng()
    w2 = TMP / "line2"
    w2.mkdir(parents=True, exist_ok=True)
    _, meta2 = jobs_tts.make_line(eng2, {"id": "b", "text": text, "spell": None}, ref, {**ST, "takes": 2}, None, w2)
    assert len(eng2.batches) == 1 and meta2["dur"] > 0.5
    return f"1 batch 2 versi, beam 3, catatan kecepatan {sp.summary()['engines']['chatterbox']['ratio']}"


@test
def t_asr_dari_array_dan_beam():
    from studio_worker.asr import Asr

    calls = []

    class W:
        def transcribe(self, audio, **kw):
            calls.append((type(audio).__name__, kw))
            seg = SimpleNamespace(text=" halo ", words=[SimpleNamespace(word=" halo", start=0.1, end=0.4)] if kw.get("word_timestamps") else None)
            return iter([seg]), None

    a = Asr(SimpleNamespace(whisper_device="cpu"))
    a.model, a.device, a.error = W(), "cpu", None
    t, ws = a.transcribe(np.zeros(16000, np.float32), words=False, beam=1)
    assert t == "halo" and ws == []
    t2, ws2 = a.transcribe(TMP / "x.wav", words=True)
    assert ws2 == [("halo", 0.1, 0.4)]
    (k1, kw1), (k2, kw2) = calls
    assert k1 == "ndarray" and kw1["beam_size"] == 1 and kw1["without_timestamps"] and not kw1["word_timestamps"], calls[0]
    assert k2 == "str" and kw2["beam_size"] == 5 and kw2["word_timestamps"] and not kw2["without_timestamps"], calls[1]
    return "cek take: array 16 kHz, beam 1, tanpa timestamp · baris final: path, beam 5, timestamp kata"


@test
def t_engines_warmup():
    class E:
        name, sr, label, credit = "chatterbox", 24000, "x", None

        def __init__(self):
            self.n = 0

        def warmup(self):
            self.n += 1
            return {"sec": 1.2, "ratio": 0.8}

        def close(self):
            pass

    class P:
        name, sr, label, credit = "pocket", 24000, "x", None

        def close(self):
            pass

    es = Engines(SimpleNamespace(engine_order=["chatterbox", "pocket"]))
    e, p = E(), P()
    es._eng = {"chatterbox": e, "pocket": p}
    assert es.warmup("chatterbox") == {"sec": 1.2, "ratio": 0.8} and e.n == 1
    assert es.warmup("pocket") == {}

    class Bad(E):
        def warmup(self):
            raise RuntimeError("boom")

    es._eng["chatterbox"] = Bad()
    r = es.warmup("chatterbox")
    assert "boom" in r.get("error", "") and not es.is_down("chatterbox")
    return "warmup dipanggil sekali; mesin tanpa warmup → {}; gagal → tidak dianggap rusak"


@test
def t_pemuat_tidak_mengunduh_di_tengah_job():
    from studio_worker.engines import EngineDown
    from studio_worker.engines import chatterbox_engine as cbe

    try:
        import huggingface_hub  # noqa: F401
    except Exception:
        return "huggingface_hub tidak terpasang → dilewati"
    cfg = SimpleNamespace(chatterbox_dir="", chatterbox_repo="contoh/tidak-ada-di-laptop-xyz", chatterbox_base_repo="contoh/dasar", hf_token="")
    t0 = time.time()
    try:
        cbe.resolve_files(cfg, allow_download=False)
        raise AssertionError("harusnya EngineDown")
    except EngineDown as e:
        assert str(e) == cbe.MISSING_MSG, e
    dt = time.time() - t0
    assert dt < 5, f"cek lokal harus instan (tanpa jaringan), {dt:.1f} dtk"
    # folder lokal lengkap → dipakai tanpa jaringan
    d = TMP / "cbdir"
    d.mkdir(exist_ok=True)
    for n in ("ve.safetensors", "t3_cfg.safetensors", "s3gen.safetensors", "tokenizer.json", "conds.pt"):
        (d / n).write_bytes(b"x")
    f, mode, src = cbe.resolve_files(SimpleNamespace(chatterbox_dir=str(d), chatterbox_repo="x/y", chatterbox_base_repo="x/z", hf_token=""))
    assert mode == "lengkap" and f["t3"].name == "t3_cfg.safetensors" and f["conds"].name == "conds.pt"
    return f"model tidak ada → '{cbe.MISSING_MSG}' dalam {dt:.2f} dtk; CHATTERBOX_DIR lengkap → {mode}"


@test
def t_ukur_kecepatan_tabel_dan_referensi():
    import bench

    rows = [
        {"kode": "A", "cara": "A. cara lama (3 berurutan)", "versi": 3, "suara_per_versi": 6.5, "waktu": 96.0, "kecepatan": 0.203, "langkah_per_dtk": 12.0, "vram_gb": 3.1, "hook": [9, 12, 15]},
        {"kode": "C", "cara": "C. cara baru bf16 (3 sekaligus)", "versi": 3, "suara_per_versi": 6.4, "waktu": 12.0, "kecepatan": 1.6, "langkah_per_dtk": 48.0, "vram_gb": 2.4},
    ]
    t = bench.table(rows)
    assert "0,20×" in t and "96,0 dtk" in t and "3,10 GB" in t and t.count("\n") == 3, t
    msg = " ".join(bench.summary_text(rows))
    assert "7,9× lebih cepat" in msg and "[9, 12, 15]" in msg, msg
    cfg = SimpleNamespace(cache=TMP / "bc")
    assert bench.find_ref(cfg, None) is None
    v = TMP / "bc" / "voices" / "abc"
    v.mkdir(parents=True)
    (v / "clean-1234.wav").write_bytes(b"x")
    assert bench.find_ref(cfg, None) == v / "clean-1234.wav" and bench.find_ref(cfg, str(TMP / "tidak-ada.wav")) is None
    assert 90 <= len(bench.KALIMAT) <= 105  # ±6–7 dtk ucapan
    return "tabel: " + t.splitlines()[2].strip()[:70]


class _CudaPatch:
    """torch.cuda palsu untuk want_dtype: torch asli ditambal sementara; tanpa torch (venv ringan) → modul torch palsu sementara"""

    def __init__(self, avail: bool, cap=(12, 0), emu: bool = True, native: bool = True, old_api: bool = False):
        def is_bf16_supported(*a, **k):
            if old_api and (a or k):
                raise TypeError("is_bf16_supported() takes 0 positional arguments")
            return native if not k.get("including_emulation", True) else (native or emu)

        self.attrs = {"is_available": lambda: avail, "get_device_capability": lambda *a: cap, "is_bf16_supported": is_bf16_supported}

    def __enter__(self):
        import types

        self.fake = "torch" not in sys.modules and not HAVE_TORCH
        if self.fake:
            sys.modules["torch"] = types.ModuleType("torch")
            sys.modules["torch"].cuda = SimpleNamespace()  # type: ignore[attr-defined]
        import torch as _t

        self.old = {k: getattr(_t.cuda, k, None) for k in self.attrs}
        for k, v in self.attrs.items():
            setattr(_t.cuda, k, v)
        return self

    def __exit__(self, *a):
        import torch as _t

        for k, v in self.old.items():
            setattr(_t.cuda, k, v)
        if self.fake:
            sys.modules.pop("torch", None)


@test
def t_dtype_auto_bf16_hanya_kalau_gpu_asli():
    from studio_worker.engines import chatterbox_engine as cbe

    got = {}
    cases = {
        "RTX 5050 sm_120": dict(avail=True, cap=(12, 0)),
        "RTX 3060 sm_86": dict(avail=True, cap=(8, 6)),
        "RTX 2060 sm_75 (bf16 emulasi)": dict(avail=True, cap=(7, 5), native=False, emu=True),
        "GTX 1650 sm_75 torch lama": dict(avail=True, cap=(7, 5), native=False, emu=True, old_api=True),
        "tanpa GPU": dict(avail=False),
        "sm_80 torch lama": dict(avail=True, cap=(8, 0), old_api=True),
    }
    for name, kw in cases.items():
        with _CudaPatch(**kw):
            got[name] = (cbe.want_dtype("auto"), cbe.want_dtype("bf16"), cbe.want_dtype("fp32"), cbe.want_dtype(None))
    assert got["RTX 5050 sm_120"] == ("bf16", "bf16", "fp32", "bf16"), got
    assert got["RTX 3060 sm_86"] == ("bf16", "bf16", "fp32", "bf16"), got
    # torch 2.8: is_bf16_supported() = True juga untuk emulasi di sm < 80 → tetap fp32 (bf16 tiruan lebih lambat)
    assert got["RTX 2060 sm_75 (bf16 emulasi)"] == ("fp32", "fp32", "fp32", "fp32"), got
    assert got["GTX 1650 sm_75 torch lama"] == ("fp32", "fp32", "fp32", "fp32"), got
    assert got["tanpa GPU"] == ("fp32", "fp32", "fp32", "fp32"), got
    assert got["sm_80 torch lama"][0] == "bf16", got
    return "; ".join(f"{k}: {v[0]}" for k, v in got.items())


@test
def t_asr_pemuatan_aman_antar_thread():
    """available dipanggil bersamaan (pemanasan latar + job + transcribe) → WhisperModel dimuat SEKALI, tanpa deadlock"""
    import threading
    import types

    from studio_worker import asr as asrmod
    from studio_worker import models as vmodels

    made: list[str] = []
    gate = threading.Event()

    class WM:
        def __init__(self, name, device, **kw):
            made.append(device)
            gate.wait(2.0)  # muat model lama: thread lain pasti datang saat ini masih berjalan
            time.sleep(0.05)

        def transcribe(self, audio, **kw):
            seg = SimpleNamespace(text=" halo ", words=None)
            return iter([seg]), None

    fake_fw = types.ModuleType("faster_whisper")
    fake_fw.WhisperModel = WM  # type: ignore[attr-defined]
    old_fw = sys.modules.get("faster_whisper")
    old = {k: getattr(vmodels, k, None) for k in ("whisper_ready", "whisper_dir")}
    sys.modules["faster_whisper"] = fake_fw
    vmodels.whisper_ready = lambda cfg: True  # type: ignore[assignment]
    vmodels.whisper_dir = lambda cfg: TMP / "whisper"  # type: ignore[assignment]
    try:
        a = asrmod.Asr(SimpleNamespace(whisper_device="cpu", whisper_model="small", cpu_threads=2))
        res: list = []
        errs: list = []

        def avail():
            try:
                res.append(a.available)
            except Exception as e:  # noqa: BLE001
                errs.append(e)

        def trans():
            try:
                res.append(a.transcribe(np.zeros(1600, np.float32), words=False, beam=1)[0])
            except Exception as e:  # noqa: BLE001
                errs.append(e)

        ths = [threading.Thread(target=avail) for _ in range(4)] + [threading.Thread(target=trans)]
        for t in ths:
            t.start()
        time.sleep(0.2)
        gate.set()
        for t in ths:
            t.join(10)
        alive = [t for t in ths if t.is_alive()]
        assert not alive, "deadlock: thread masih menunggu kunci"
        assert not errs, errs
        assert made == ["cpu"], f"WhisperModel dimuat {len(made)}× bersamaan: {made}"
        assert sorted(map(str, res)) == sorted(["True"] * 4 + ["halo"]), res
        # GPU error saat transcribe → pindah CPU (tetap lewat kunci muat, tanpa deadlock)
        a.device = "cuda"

        class Broken:
            def transcribe(self, audio, **kw):
                raise RuntimeError("CUDA error palsu")

        a.model = Broken()
        made.clear()
        t2 = threading.Thread(target=trans)
        t2.start()
        t2.join(10)
        assert not t2.is_alive() and made == ["cpu"] and a.device == "cpu", (made, a.device, errs)
    finally:
        if old_fw is None:
            sys.modules.pop("faster_whisper", None)
        else:
            sys.modules["faster_whisper"] = old_fw
        for k, v in old.items():
            setattr(vmodels, k, v)
    return "5 thread bersamaan → WhisperModel dimuat 1×; GPU error → CPU tanpa deadlock"


class _MiniSupa:
    """Supabase palsu secukupnya untuk synth_job (progres + unggah)"""

    def __init__(self):
        self.files: dict[str, bytes] = {}
        self.patches: list[dict] = []

    def update(self, table, filters, patch):
        self.patches.append(dict(patch))
        return [{"id": filters.get("id")}]

    def select(self, table, **kw):
        return [{"status": "proses"}]

    def upload(self, path, data, content_type, timeout=0):
        self.files[path] = data.read_bytes() if isinstance(data, Path) else data
        return path


class _OneEngine:
    def __init__(self, eng):
        self.eng = eng
        self.lock = __import__("threading").RLock()

    def get(self, name):
        return self.eng

    def loaded(self):
        return [self.eng.name]


@test
def t_job_baris_kembar_pakai_cache_baris_sebelumnya():
    """2 baris berteks sama dalam SATU job: baris ke-2 memakai cache baris ke-1 (dulu dibuat ulang = GPU 2×)"""
    from studio_worker.jobctx import JobCtx, Runtime

    ref = BANK / "referensi-alif-energik-10dtk.wav"
    teks = "Follow untuk info lainnya setiap hari."

    def go(sub, raw_lines):
        d = TMP / sub
        cfg = SimpleNamespace(cache=d / "cache", tmp=d / "tmp", upload_workers=2, worker_id="tes", tts_batch=True, natural_mos=False)
        cfg.tmp.mkdir(parents=True, exist_ok=True)
        eng = BatchEng(cfg)
        sb = _MiniSupa()
        rt = Runtime(cfg=cfg, supa=sb, engines=_OneEngine(eng), asr=None, speed=speedmod.Speed(None))  # type: ignore[arg-type]
        ctx = JobCtx(rt, "studio_voice_jobs", {"id": f"job-{sub}"}, min_gap=0)
        try:
            res = jobs_tts.synth_job(ctx, "chatterbox", jobs_tts.parse_lines(raw_lines), {"id": "v1", "name": "Tes"}, ref, "vh", jobs_tts.norm_settings({"takes": 2}))
        finally:
            ctx.close()
        return eng, res, ctx, sb

    eng1, res1, _, _ = go("satu", [{"id": "a", "scene_id": "s1", "text": teks}])
    eng2, res2, ctx2, sb2 = go("kembar", [{"id": "a", "scene_id": "s1", "text": teks}, {"id": "b", "scene_id": "s2", "text": teks, "start": 5}])
    assert len(eng1.batches) == 1, eng1.batches
    assert len(eng2.batches) == len(eng1.batches), f"baris kembar dibuat ulang: {len(eng2.batches)} batch (harusnya {len(eng1.batches)})"
    a, b = res2["lines"]
    assert a["dur"] == b["dur"] and a["words"] == b["words"] and b["start"] == 5.0, (a, b)
    assert {"vo/job-kembar/a.mp3", "vo/job-kembar/b.mp3"} <= set(sb2.files), list(sb2.files)
    return f"2 baris kembar → {len(eng2.batches)} batch GPU (baris ke-2 dari cache), perkiraan awal {ctx2.est0} dtk"


# ---------------------------------------------------------------- tes berat: model T3 acak
_M: dict = {}
SAMP = dict(temperature=0.8, repetition_penalty=2.0, min_p=0.05, top_p=1.0)


def model(kind: str = "mtl"):
    """satu model T3 acak per proses (±2 GB RAM); ganti jenis → yang lama dilepas dulu"""
    if kind in _M:
        return _M[kind]
    for k in list(_M):
        try:
            _M[k].fast.remove()
        except Exception:
            pass
        _M.pop(k)
    gc.collect()
    torch.manual_seed(0)
    t0 = time.time()
    t3 = T3(T3Config.multilingual() if kind == "mtl" else T3Config(704)).eval()
    m = SimpleNamespace(t3=t3, build=round(time.time() - t0, 1))
    m.fast = t3fast.Fast(m, attn="eager")
    _M[kind] = m
    return m


def cond(seed: int = 1):
    g = torch.Generator().manual_seed(seed)
    return T3Cond(
        speaker_emb=torch.randn(1, 256, generator=g),
        cond_prompt_speech_tokens=torch.randint(0, 6561, (1, 150), generator=g),
        emotion_adv=0.5 * torch.ones(1, 1, 1),
    )


def text_tokens(n: int, seed: int, vocab: int = 2400):
    g = torch.Generator().manual_seed(seed)
    t = torch.randint(256, vocab, (1, n), generator=g)
    t[:, 0] = 255
    t[:, -1] = 0
    return t


def upstream(t3, text, seed: int, max_new: int, cfg_weight: float = 0.5, leak: bool = False):
    torch.manual_seed(seed)
    tt = torch.cat([text, text]) if cfg_weight > 0 else text
    if leak:
        return t3.inference(t3_cond=cond(), text_tokens=tt, max_new_tokens=max_new, cfg_weight=cfg_weight, **SAMP)[0]
    with t3fast.no_leak(t3):
        return t3.inference(t3_cond=cond(), text_tokens=tt, max_new_tokens=max_new, cfg_weight=cfg_weight, **SAMP)[0]


def fast_tokens(f, text, n: int, seeds, max_new: int, cfg_weight: float = 0.5):
    return f.speech_tokens(cond(), text, n, seeds, cfg_weight=cfg_weight, max_new_tokens=max_new, **SAMP)


@heavy
def t_pengecek_keselarasan_sama_dengan_bawaan():
    """Align (port per versi) vs AlignmentStreamAnalyzer bawaan pada aliran attention sintetis (tanpa model)"""
    from torch import nn

    from chatterbox.models.t3.inference.alignment_stream_analyzer import AlignmentStreamAnalyzer

    rnd = np.random.default_rng(5)
    V, EOS = 12, 11
    stats = {"tekan": 0, "paksa": 0, "langkah": 0}
    reasons = set()
    for scen in range(120):
        S = int(rnd.integers(6, 40))  # bawaan error (max atas tensor kosong) untuk teks ≤ 5 token — dites terpisah di bawah
        i0 = int(rnd.integers(5, 30))
        j0 = i0 + S
        dummy = SimpleNamespace(layers=[SimpleNamespace(self_attn=nn.Module()) for _ in range(14)], config=SimpleNamespace(output_attentions=False, _attn_implementation="sdpa"))
        up = AlignmentStreamAnalyzer(dummy, None, text_tokens_slice=(i0, j0), alignment_layer_idx=9, eos_idx=EOS)
        mine = t3fast.Align(S)
        mode = scen % 4  # 0 normal, 1 ekor panjang, 2 mengulang teks, 3 token kembar
        T0 = j0 + 2
        pos = 0.0
        last_tok = 6561
        for step in range(int(rnd.integers(20, 90))):
            q = T0 if step == 0 else 1  # prefill: peta penuh (T0 × T0); sesudahnya 1 baris per langkah
            L = T0 + step
            maps = []
            for _h in range(3):
                a = rnd.random((q, L)).astype(np.float32) ** 4
                if mode == 1 and step > S:
                    a[:, j0 - 2 : j0] += 6.0  # menempel di token terakhir
                elif mode == 2 and step > S + 3:
                    a[:, i0 : i0 + 2] += 6.0  # balik ke awal teks
                else:
                    c = i0 + min(S - 1, int(pos))
                    a[:, c] += 4.0
                a = a / a.sum(axis=1, keepdims=True)
                maps.append(torch.from_numpy(a))
            pos += rnd.uniform(0.3, 1.2)
            up.last_aligned_attns = maps
            if mode == 3 and step > 4 and rnd.random() < 0.3:
                tok = last_tok
            else:
                tok = int(rnd.integers(0, 6561))
            ul = up.step(torch.zeros(1, V), next_token=last_tok)
            stacked = torch.stack(maps).mean(dim=0)
            chunk = (stacked[j0:, i0:j0] if step == 0 else stacked[:, i0:j0]).numpy()
            sup, frc = mine.step(chunk, last_tok)
            u_force = bool(ul[0, EOS] == 2**15)
            u_sup = bool(ul[0, EOS] == -(2**15)) and not u_force
            assert u_force == frc and (u_sup == sup or frc), (scen, step, u_force, frc, u_sup, sup)
            assert int(mine.text_position) == int(up.text_position) and mine.complete == bool(up.complete) and mine.started == up.started, (scen, step)
            stats["tekan"] += sup
            stats["paksa"] += frc
            stats["langkah"] += 1
            if mine.forced:
                reasons.add(mine.forced)
            last_tok = tok
            if frc:
                break
    assert reasons >= {"long_tail", "alignment_repetition", "token_repetition"}, reasons
    small = t3fast.Align(4)  # teks sangat pendek: tidak error (bawaan: RuntimeError)
    for step in range(30):
        small.step(rnd.random((2 if step == 0 else 1, 4)).astype(np.float32), 5)
    return f"120 aliran, {stats['langkah']} langkah: keputusan tekan/paksa EOS sama ({stats['tekan']} tekan, {stats['paksa']} paksa: {sorted(reasons)})"


@heavy
def t_token_identik_dengan_bawaan_multilingual():
    m = model("mtl")
    f = m.fast
    f.attn = "eager"  # semua layer eager seperti bawaan
    out = []
    for n_tok, seed in ((24, 101), (48, 202), (90, 303)):
        text = text_tokens(n_tok, seed)
        up = upstream(m.t3, text, seed, 72)
        fa = fast_tokens(f, text, 1, [seed], 72)[0]
        assert torch.equal(up, fa), (n_tok, seed, up.tolist()[:20], fa.tolist()[:20])
        out.append(f"{n_tok} tok/{len(up)} langkah{' (paksa EOS: ' + str(f.last['forced'][0]) + ')' if f.last['forced'][0] else ''}")
    long_runs = sum(1 for s in out if int(s.split("/")[1].split()[0]) >= 60)
    assert long_runs >= 2, out
    MEASURE["build_mtl"] = m.build
    return "identik: " + "; ".join(out) + f" · T3 acak dibangun {m.build} dtk"


@heavy
def t_sdpa_tiga_layer_eager_dan_mask_kausal():
    m = model("mtl")
    f, tf = m.fast, m.t3.tfmr
    # (1) layer keselarasan punya config eager sendiri, layer lain sdpa (config global)
    assert tf.config._attn_implementation == "sdpa"
    assert all(tf.layers[layer].self_attn.config._attn_implementation == "eager" for layer, _ in t3fast.LLAMA_ALIGNED_HEADS)
    assert tf.layers[0].self_attn.config is tf.config
    # (2) bukti bahaya: prefill dengan mask sdpa (None) → layer eager TIDAK kausal
    got: list = []
    h = tf.layers[9].self_attn.register_forward_hook(lambda mod, a, o: got.append(o[1]))
    try:
        with torch.inference_mode():
            tf(inputs_embeds=torch.randn(1, 30, 1024), use_cache=True)
        leak_above = float(torch.triu(got[0][0], diagonal=1).abs().max())
        got.clear()
        # (3) jalur cepat: prefill dengan config eager → mask 4D kausal
        f.attn = "sdpa"
        fast_tokens(f, text_tokens(40, 7), 1, [7], 3)
        pre = got[0]
        causal_above = float(torch.triu(pre[0], diagonal=1).abs().max())
    finally:
        h.remove()
    assert leak_above > 1e-3, leak_above
    assert causal_above == 0.0 and pre.shape[-1] == pre.shape[-2], (causal_above, pre.shape)
    # (4) logits sdpa vs eager dekat, token sama di langkah awal
    logs: dict = {"eager": [], "sdpa": []}
    for mode in ("eager", "sdpa"):
        f.attn = mode
        hh = m.t3.speech_head.register_forward_hook(lambda mod, a, o, mode=mode: logs[mode].append(o.detach().clone()))
        try:
            toks = fast_tokens(f, text_tokens(48, 202), 1, [202], 72)[0]
        finally:
            hh.remove()
        logs[mode + "_tok"] = toks
    k = min(len(logs["eager"]), len(logs["sdpa"]), 20)
    diff = max(float((a - b).abs().max()) for a, b in zip(logs["eager"][:k], logs["sdpa"][:k]))
    scale = float(logs["eager"][0].abs().max())
    te, ts = logs["eager_tok"], logs["sdpa_tok"]
    same = int(next((i for i in range(min(len(te), len(ts))) if te[i] != ts[i]), min(len(te), len(ts))))
    assert diff < 1e-3 * max(1.0, scale), (diff, scale)
    assert same >= 20, same
    MEASURE["sdpa_vs_eager_logit_diff"] = diff
    return f"tanpa perbaikan: attention di atas diagonal {leak_above:.3f} (tidak kausal); jalur cepat: 0 · logits sdpa vs eager beda maks {diff:.2e} (skala {scale:.1f}) · token sama {same}/{min(len(te), len(ts))} langkah"


@heavy
def t_batch_n_versi_sama_dengan_satu_satu():
    m = model("mtl")
    f = m.fast
    f.attn = "sdpa"
    text = text_tokens(40, 11)
    seeds = [21, 22, 23]
    singles = [fast_tokens(f, text, 1, [s], 60)[0] for s in seeds]
    batch = fast_tokens(f, text, 3, seeds, 60)
    aligns = f.last_aligns
    res = []
    for s, a, b in zip(seeds, singles, batch):
        n = min(len(a), len(b))
        first = next((i for i in range(n) if a[i] != b[i]), None)
        res.append((s, len(a), len(b), first))
    assert all(r[3] is None and r[1] == r[2] for r in res), res
    # pengecek keselarasan per versi berdiri sendiri (objek & riwayat token beda)
    assert len({id(a) for a in aligns}) == 3 and len({tuple(a.generated_tokens) for a in aligns}) == 3
    return "3 versi sekaligus = 3× satu-satu (token identik, panjang " + ", ".join(f"{r[1]}" for r in res) + "); pengecek per versi terpisah"


@heavy
def t_hook_tidak_menumpuk():
    m = model("mtl")
    f, t3 = m.fast, m.t3
    f.attn = "sdpa"
    text = text_tokens(30, 3)
    upstream(t3, text, 4, 3)  # hook perekam transformers (sekali per model) sudah terpasang sebelum dihitung
    base = t3fast.hook_count(t3)
    for i in range(5):
        fast_tokens(f, text, 2 if i % 2 else 1, [i, i + 1], 6)
    after_fast = t3fast.hook_count(t3)
    upstream(t3, text, 5, 6)
    upstream(t3, text, 6, 6)
    after_up = t3fast.hook_count(t3)
    cfg = t3.tfmr.config
    assert base == after_fast == after_up, (base, after_fast, after_up)
    assert cfg._attn_implementation == "sdpa" and not cfg.output_attentions
    assert all(t3.tfmr.layers[layer].self_attn.config._attn_implementation == "eager" for layer, _ in t3fast.LLAMA_ALIGNED_HEADS)
    # bawaan TANPA pembungkus: +3 hook tiap panggilan (bukti kebocoran), lalu dibersihkan
    with t3fast.no_leak(t3):
        counts = []
        for s in range(3):
            upstream(t3, text, s, 4, leak=True)
            counts.append(t3fast.hook_count(t3))
    assert counts[1] - counts[0] == 3 and counts[2] - counts[1] == 3, counts
    assert t3fast.hook_count(t3) == base and cfg._attn_implementation == "sdpa"
    # remove() melepas hook & config; install() memasang lagi tepat sekali
    f.remove()
    assert t3fast.hook_count(t3) == base - 3 and t3.tfmr.layers[12].self_attn.config is cfg
    f.install()
    f.install()
    assert t3fast.hook_count(t3) == base
    return f"hook {base} → sesudah 5× cepat {after_fast} → sesudah 2× bawaan dibungkus {after_up}; bawaan polos {counts} (+3/panggilan)"


@heavy
def t_bf16_dan_nan():
    m = model("mtl")
    f, tf = m.fast, m.t3.tfmr
    f.attn = "sdpa"
    text = text_tokens(30, 9)
    ref = fast_tokens(f, text, 1, [7], 12)[0]
    saved = {k: v.detach().clone() for k, v in tf.state_dict().items()}
    try:
        assert f.set_dtype("bf16") == "bf16"
        assert next(tf.parameters()).dtype == torch.bfloat16 and tf.rotary_emb.inv_freq.dtype == torch.float32
        assert m.t3.speech_head.weight.dtype == torch.float32 and m.t3.speech_emb.weight.dtype == torch.float32
        toks = fast_tokens(f, text, 2, [7, 8], 12)
        assert all(len(t) > 0 and int(t.min()) >= 0 and int(t.max()) < 8194 for t in toks), toks
        bf_same = int(next((i for i in range(min(len(ref), len(toks[0]))) if ref[i] != toks[0][i]), min(len(ref), len(toks[0]))))
        # logits rusak → NonFinite (tidak ada crash / assert di multinomial)
        hh = m.t3.speech_head.register_forward_hook(lambda mod, a, o: o * float("nan"))
        try:
            fast_tokens(f, text, 2, [1, 2], 6)
            raise AssertionError("harusnya NonFinite")
        except t3fast.NonFinite:
            pass
        finally:
            hh.remove()
        assert tf.config._attn_implementation == "sdpa"
        # kembali ke fp32 dari bobot asli → token persis seperti sebelum bf16
        assert f.set_dtype("fp32", reload=lambda: saved) == "fp32"
        again = fast_tokens(f, text, 1, [7], 12)[0]
        assert torch.equal(again, ref), (again.tolist(), ref.tolist())
    finally:
        if f.name_dtype != "fp32":
            f.set_dtype("fp32", reload=lambda: saved)
        saved.clear()
        gc.collect()
    return f"bf16 jalan (token valid, {bf_same}/{len(ref)} token awal sama dengan fp32); NaN → NonFinite; kembali fp32 → identik"


@heavy
def t_ukur_kecepatan_cpu():
    if NO_MEASURE:
        return "dilewati (--tanpa-ukur)"
    m = model("mtl")
    f, t3 = m.fast, m.t3
    text = text_tokens(40, 13)
    N = 40
    rows = {}
    with t3fast.no_leak(t3):  # bawaan polos: hook bocor menumpuk tiap panggilan
        up = []
        for i in range(5):
            t0 = time.perf_counter()
            tk = upstream(t3, text, 31, N, leak=True)
            up.append((len(tk) / (time.perf_counter() - t0), t3fast.hook_count(t3)))
    rows["bawaan panggilan ke-1"] = round(up[0][0], 2)
    rows["bawaan panggilan ke-5"] = round(up[4][0], 2)

    def best(mode: str, n: int) -> float:
        f.attn = mode
        vals = []
        for _ in range(2):
            fast_tokens(f, text, n, list(range(31, 31 + n)), N)
            vals.append(f.last["steps"] / f.last["sec"])
        return round(max(vals), 2)

    rows["cepat eager 1 versi"] = best("eager", 1)
    rows["cepat sdpa 1 versi"] = best("sdpa", 1)
    rows["cepat sdpa 3 versi sekaligus"] = best("sdpa", 3)
    MEASURE["cpu_langkah_per_dtk"] = rows
    MEASURE["cpu_hook_bawaan"] = [h for _, h in up]
    b3 = rows["cepat sdpa 3 versi sekaligus"]
    return (
        f"langkah/dtk CPU: bawaan ke-1 {rows['bawaan panggilan ke-1']}, ke-5 {rows['bawaan panggilan ke-5']} (hook {up[0][1]}→{up[4][1]}); "
        f"cepat eager {rows['cepat eager 1 versi']}, sdpa {rows['cepat sdpa 1 versi']}, 3 versi {b3} (= {b3 * 3:.1f} versi-langkah/dtk)"
    )


@heavy
def t_logika_mesin_belah_batch_nan_cadangan():
    from torch import nn

    from studio_worker.engines import chatterbox_engine as cbe

    class FakeFast:
        def __init__(self, mode):
            self.mode = mode
            self.calls: list[int] = []
            self.name_dtype = "bf16"
            self.analyzer = True
            self.last = {"steps_per_sec": 9.0}
            self.dtype_calls: list = []
            self.removed = False

        def generate(self, text, n, seeds, **kw):
            self.calls.append(n)
            if self.mode == "oom" and n > 1:
                raise torch.cuda.OutOfMemoryError("CUDA out of memory (palsu)")
            if self.mode == "nan" and self.name_dtype == "bf16":
                raise t3fast.NonFinite("nan")
            if self.mode == "err":
                raise RuntimeError("rusak")
            return [np.full(24000, s / 1000.0, np.float32) for s in seeds]

        def set_dtype(self, want, reload=None):
            self.dtype_calls.append((want, reload is not None))
            self.name_dtype = want
            return want

        def remove(self):
            self.removed = True

    class FakeModel:
        sr = 24000

        def __init__(self):
            self.t3 = nn.Module()
            self.t3.tfmr = nn.Linear(2, 2)
            self.t3.tfmr.config = SimpleNamespace(_attn_implementation="sdpa", output_attentions=False)
            self.gen: list = []
            self.watermarker = SimpleNamespace(apply_watermark=lambda y, sample_rate: y)

        def prepare_conditionals(self, ref, exaggeration):
            pass

        def generate(self, text, **kw):
            self.gen.append(kw)
            return torch.zeros(1, 12000)

    def make(mode):
        e = object.__new__(cbe.ChatterboxEngine)
        e.cfg = SimpleNamespace(takes=3, tts_batch=True)
        e.model, e.sr, e.mtl, e.lang = FakeModel(), 24000, True, "id"
        e._ref, e._sampling, e._fast_kw = None, {"min_p": 0.05}, {"min_p": 0.05, "repetition_penalty": 2.0, "top_p": 1.0}
        e.batch, e._max_batch, e._fast_fail, e.builtin = True, 6, 0, None
        e.fast = FakeFast(mode)
        e._reload_fp32 = lambda: {}
        return e

    st = {"exaggeration": 0.6, "cfg_weight": 0.35, "temperature": 0.8}
    e = make("oom")
    ys = e.synth_batch("halo", Path("r.wav"), st, [1, 2, 3])
    assert [round(float(y[0]) * 1000) for y in ys] == [1, 2, 3] and e.fast.calls == [3, 1, 2, 1, 1] and e._max_batch == 1, (e.fast.calls, e._max_batch)
    assert len(e.synth_batch("halo", Path("r.wav"), st, [4, 5])) == 2 and e.fast.calls[-2:] == [1, 1]  # batas batch diingat
    e2 = make("nan")
    ys2 = e2.synth_batch("halo", Path("r.wav"), st, [1, 2])
    assert len(ys2) == 2 and e2.fast.dtype_calls == [("fp32", True)] and e2.fast.calls == [2, 2]
    e3 = make("err")
    for _ in range(3):
        y3 = e3.synth_batch("halo", Path("r.wav"), st, [9])
        assert len(y3) == 1 and y3[0].size == 12000
    assert e3.fast is None and len(e3.model.gen) == 3 and e3.model.gen[0]["language_id"] == "id" and e3.model.gen[0]["min_p"] == 0.05
    assert make("ok").synth("halo", Path("r.wav"), st, 7)[0] == np.float32(0.007)
    w = make("ok").warmup()
    assert w["skip"] == "tanpa conds.pt" and "sec" in w
    e5 = make("ok")
    e5.builtin = SimpleNamespace(t3=SimpleNamespace(emotion_adv=torch.full((1, 1, 1), 0.5)))
    w5 = e5.warmup()
    assert w5["n"] == 3 and w5["ratio"] is not None and e5.fast.calls == [1, 3], (w5, e5.fast.calls)
    assert cbe.want_dtype("auto") in ("bf16", "fp32") and cbe.want_dtype("fp32") == "fp32"

    def mtl_gen(text, language_id, audio_prompt_path=None, exaggeration=0.5, cfg_weight=0.5, temperature=0.8, repetition_penalty=2.0, min_p=0.05, top_p=1.0):
        pass

    def en_gen(text, repetition_penalty=1.2, min_p=0.05, top_p=1.0, audio_prompt_path=None, exaggeration=0.5, cfg_weight=0.5, temperature=0.8):
        pass

    assert cbe.fast_sampling(mtl_gen) == {"min_p": 0.05, "repetition_penalty": 2.0, "top_p": 1.0}
    assert cbe.fast_sampling(en_gen) == {"min_p": 0.05, "repetition_penalty": 1.2, "top_p": 1.0}
    return "VRAM penuh → 3 → 1+2 → 1+1+1 (lalu diingat); NaN bf16 → fp32 dari file & ulang; error 3× → cara bawaan lalu jalur cepat dimatikan; warmup 1 + 3 versi"


class _ToFails:
    """Tensor.to gagal (VRAM penuh palsu) mulai panggilan ke-`at` — untuk menguji ganti dtype di tengah jalan"""

    def __init__(self, at: int):
        self.at, self.n = at, 0

    def __enter__(self):
        self.orig = torch.Tensor.to
        me = self

        def to(t, *a, **k):
            me.n += 1
            if me.n >= me.at:
                raise torch.cuda.OutOfMemoryError("CUDA out of memory (palsu, saat ganti dtype)")
            return me.orig(t, *a, **k)

        torch.Tensor.to = to  # type: ignore[method-assign]
        return self

    def __exit__(self, *a):
        torch.Tensor.to = self.orig  # type: ignore[method-assign]


@heavy
def t_cadangan_bawaan_jalan_saat_bf16():
    """T3 multilingual ASLI versi kecil (14 layer) + transformer bf16: jalur cepat error → cara bawaan (model.generate → T3.inference)
    tetap menghasilkan suara karena transformer dikembalikan ke fp32 (bobot asli) dulu; dulu: RuntimeError dtype → EngineFailed"""
    import types

    from chatterbox.models.t3 import llama_configs as LC
    from chatterbox.models.t3 import t3 as t3mod
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS, Conditionals

    from studio_worker.engines import chatterbox_engine as cbe

    LC.LLAMA_CONFIGS.setdefault("Llama_tes14", dict(LC.LLAMA_520M_CONFIG_DICT, num_hidden_layers=14, intermediate_size=256))
    hp = T3Config.multilingual()
    hp.llama_config_name = "Llama_tes14"
    torch.manual_seed(0)
    t3 = t3mod.T3(hp).eval()
    tf = t3.tfmr
    saved = {k: v.detach().clone() for k, v in tf.state_dict().items()}  # = isi file t3 (bobot asli fp32)

    def own_hooks() -> int:  # hook selain perekam keluaran milik transformers (dipasang sekali oleh cara bawaan, memang dibiarkan)
        return sum(1 for mod in t3.modules() for h in mod._forward_hooks.values() if not t3fast._is_hf_capture(h))

    base_hooks = own_hooks()
    cfg0 = [tf.layers[i].self_attn.config for i in (9, 12, 13)]

    class Tok:
        def text_to_tokens(self, text, language_id=None):
            return torch.randint(1, 2400, (1, 12), generator=torch.Generator().manual_seed(len(text)), dtype=torch.int32)

    class S3:
        def __init__(self):
            self.n = 0

        def inference(self, speech_tokens, ref_dict):
            self.n += 1
            return torch.zeros(1, 2400), None

    m = object.__new__(ChatterboxMultilingualTTS)
    m.sr, m.t3, m.s3gen, m.ve, m.tokenizer, m.device = 24000, t3, S3(), None, Tok(), "cpu"
    wm: list[int] = []
    m.watermarker = types.SimpleNamespace(apply_watermark=lambda y, sample_rate: (wm.append(len(y)), y)[1])
    m.conds = Conditionals(T3Cond(speaker_emb=torch.randn(1, 256), cond_prompt_speech_tokens=torch.randint(0, 6561, (1, 150)), emotion_adv=0.6 * torch.ones(1, 1, 1)), {})
    m.prepare_conditionals = lambda ref, exaggeration=0.5: None
    # cara bawaan selalu 1000 langkah (±2 mnt di CPU untuk T3 kecil) → dibatasi 6 langkah; T3.inference & dtype-nya tetap asli
    orig_inf = t3.inference

    def short_inference(*a, **k):
        k["max_new_tokens"] = 6
        return orig_inf(*a, **k)

    t3.inference = short_inference

    def make(dtype):
        e = object.__new__(cbe.ChatterboxEngine)
        e.cfg = SimpleNamespace(takes=1, tts_batch=True)
        e.model, e.sr, e.mtl, e.lang = m, 24000, True, "ms"
        e._ref, e._sampling, e._fast_kw = None, cbe.sampling_kwargs(m.generate), cbe.fast_sampling(m.generate)
        e.batch, e._max_batch, e._fast_fail, e.builtin = True, 6, 0, None
        e.fast = t3fast.Fast(m, language_id="ms", dtype=dtype)
        e.reloads = 0

        def reload():
            e.reloads += 1
            return {k: v.clone() for k, v in saved.items()}

        e._reload_fp32 = reload

        def boom(*a, **k):
            raise RuntimeError("contoh error jalur cepat (mis. CUBLAS_STATUS_ALLOC_FAILED)")

        e.fast.generate = boom
        return e

    st = {"exaggeration": 0.6, "cfg_weight": 0.35, "temperature": 0.8}
    try:
        e = make("bf16")
        assert t3fast.param_dtype(tf) == torch.bfloat16 and e.fast.name_dtype == "bf16"
        ys = e.synth_batch("halo apa kabar semuanya", Path("r.wav"), st, [1])
        assert len(ys) == 1 and ys[0].size == 2400 and m.s3gen.n == 1 and wm == [2400], (len(ys), m.s3gen.n, wm)
        assert e._fast_fail == 1 and e.fast is not None and e.fast.name_dtype == "fp32" and e.reloads == 1
        assert all(p.dtype == torch.float32 for p in tf.parameters())
        assert all(torch.equal(tf.state_dict()[k], saved[k]) for k in saved), "kembali fp32 harus memakai bobot asli (tanpa pembulatan bf16)"
        # gagal 3× berturut-turut → jalur cepat dimatikan (hook & config dilepas), cara bawaan tetap jalan di fp32
        for _ in range(2):
            assert len(e.synth_batch("halo lagi", Path("r.wav"), st, [2])) == 1
        assert e.fast is None and e._fast_fail == 3 and e.reloads == 1 and own_hooks() == base_hooks
        assert [tf.layers[i].self_attn.config for i in (9, 12, 13)] == cfg0
        # jalur cepat sudah mati tapi transformer masih bf16 (mis. dimatikan sebelum perbaikan ini) → tetap dikembalikan ke fp32
        t3fast.convert_params(tf, torch.bfloat16)
        assert len(e.synth_batch("halo ketiga", Path("r.wav"), st, [3])) == 1
        assert t3fast.param_dtype(tf) == torch.float32 and e.reloads == 2
        # cabang gagal 3× langsung dari bf16 (tanpa cadangan sebelumnya yang sudah mengembalikan fp32)
        e2 = make("bf16")
        e2._fast_fail = 2
        assert len(e2.synth_batch("halo keempat", Path("r.wav"), st, [4])) == 1
        assert e2.fast is None and t3fast.param_dtype(tf) == torch.float32 and own_hooks() == base_hooks
        # Fast gagal pindah ke bf16 saat dibuat (VRAM penuh) → hook & config eager tidak ditinggal terpasang, bobot tetap fp32
        with _ToFails(at=4):
            try:
                t3fast.Fast(m, language_id="ms", dtype="bf16")
                raise AssertionError("harusnya OutOfMemoryError")
            except torch.cuda.OutOfMemoryError:
                pass
        assert own_hooks() == base_hooks and [tf.layers[i].self_attn.config for i in (9, 12, 13)] == cfg0
        assert all(p.dtype == torch.float32 for p in tf.parameters())
    finally:
        del t3.inference
        for x in ("e", "e2"):
            f = locals().get(x)
            if f is not None and getattr(f, "fast", None) is not None:
                f.fast.remove()
        saved.clear()
        gc.collect()
    return f"bf16 + jalur cepat error → cara bawaan menghasilkan suara (transformer fp32 dari bobot asli); gagal 3× → dimatikan, hook {base_hooks} kembali; Fast gagal bf16 → tanpa sisa hook"


@heavy
def t_belah_batch_di_luar_except_dan_ganti_dtype_atomik():
    """
    VRAM palsu (blok memori yang hanya lepas kalau tidak ada yang memegang): percobaan yang gagal tidak boleh menahan memori saat
    batch dibelah / diulang fp32. Ganti dtype gagal di tengah → parameter tetap utuh (tidak campuran bf16 + fp32).
    """
    import weakref

    from torch import nn

    from studio_worker.engines import chatterbox_engine as cbe

    live = weakref.WeakSet()

    class Blk:
        pass

    class VramFast:
        """batch n butuh n blok; blok dipegang variabel lokal `past` (seperti cache KV di Fast.speech_tokens)"""

        analyzer, last = True, {}

        def __init__(self, budget, nan_bf16=False):
            self.budget, self.nan_bf16, self.log, self.name_dtype = budget, nan_bf16, [], "bf16" if nan_bf16 else "fp32"
            self.live_at_set: list[int] = []

        def generate(self, text, n, seeds, **kw):
            past = []
            for _ in range(n):
                if len(live) + 1 > self.budget:
                    self.log.append((n, "OOM"))
                    raise torch.cuda.OutOfMemoryError("CUDA out of memory (palsu)")
                b = Blk()
                live.add(b)
                past.append(b)
            if self.nan_bf16 and self.name_dtype == "bf16":
                self.log.append((n, "NaN"))
                raise t3fast.NonFinite("nan")
            self.log.append((n, "ok"))
            return [np.zeros(2400, np.float32) for _ in seeds]

        def set_dtype(self, want, reload=None):
            self.live_at_set.append(len(live))
            self.name_dtype = want
            return want

        def remove(self):
            pass

    def make(fast, takes):
        e = object.__new__(cbe.ChatterboxEngine)
        e.cfg = SimpleNamespace(takes=takes, tts_batch=True)
        e.model = SimpleNamespace(prepare_conditionals=lambda *a, **k: None, t3=None)
        e.sr, e.mtl, e.lang, e._ref, e._sampling, e._fast_kw = 24000, True, "id", None, {}, {}
        e.batch, e._max_batch, e._fast_fail, e.builtin, e.fast = True, 6, 0, None, fast
        e._reload_fp32 = lambda: {}
        return e

    st = {"exaggeration": 0.6, "cfg_weight": 0.35, "temperature": 0.8}
    # 4 versi, VRAM muat 3: dulu [(4,OOM),(2,OOM),(1,OOM),1,1,1,1] dan batas batch 1 untuk sisa sesi
    e = make(VramFast(budget=3), 4)
    assert len(e.synth_batch("halo", Path("r.wav"), st, [1, 2, 3, 4])) == 4
    first = list(e.fast.log)
    e.fast.log.clear()
    assert len(e.synth_batch("potongan dua", Path("r.wav"), st, [1, 2, 3, 4])) == 4
    assert first == [(4, "OOM"), (2, "ok"), (2, "ok")] and e._max_batch == 2 and e.fast.log == [(2, "ok"), (2, "ok")], (first, e._max_batch, e.fast.log)
    # NaN di bf16: pindah fp32 + ulang dijalankan sesudah memori percobaan bf16 lepas
    e2 = make(VramFast(budget=3, nan_bf16=True), 3)
    assert len(e2.synth_batch("halo", Path("r.wav"), st, [1, 2, 3])) == 3
    assert e2.fast.log == [(3, "NaN"), (3, "ok")] and e2.fast.live_at_set == [0], (e2.fast.log, e2.fast.live_at_set)
    # Fast.set_dtype atomik: OOM di tengah konversi → semua parameter & dtype tetap seperti semula, forward tetap jalan
    f = object.__new__(t3fast.Fast)
    f.torch, f.log, f.dtype = torch, None, torch.float32
    f.tf = nn.Sequential(nn.Linear(8, 8), nn.ReLU(), nn.Linear(8, 8), nn.Linear(8, 4))
    orig = {k: v.clone() for k, v in f.tf.state_dict().items()}
    with _ToFails(at=3):
        try:
            f.set_dtype("bf16")
            raise AssertionError("harusnya OutOfMemoryError")
        except torch.cuda.OutOfMemoryError:
            pass
    assert f.name_dtype == "fp32" and {p.dtype for p in f.tf.parameters()} == {torch.float32}
    assert all(torch.equal(f.tf.state_dict()[k], orig[k]) for k in orig)
    assert f.set_dtype("bf16") == "bf16" and {p.dtype for p in f.tf.parameters()} == {torch.bfloat16}
    with _ToFails(at=2):
        try:
            f.set_dtype("fp32", reload=lambda: orig)
            raise AssertionError("harusnya OutOfMemoryError")
        except torch.cuda.OutOfMemoryError:
            pass
    assert f.name_dtype == "bf16" and {p.dtype for p in f.tf.parameters()} == {torch.bfloat16}
    f.tf(torch.zeros(2, 8, dtype=torch.bfloat16))  # tidak campuran → forward jalan
    # kembali fp32: bobot asli dari reload; reload gagal → tetap fp32 (bobot bf16 diperbesar), tanpa error
    assert f.set_dtype("fp32", reload=lambda: orig) == "fp32" and all(torch.equal(f.tf.state_dict()[k], orig[k]) for k in orig)
    f.set_dtype("bf16")

    def bad_reload():
        raise OSError("file t3 tidak terbaca")

    assert f.set_dtype("fp32", reload=bad_reload) == "fp32" and {p.dtype for p in f.tf.parameters()} == {torch.float32}
    return f"4 versi di VRAM muat 3 → {first}, batas batch {e._max_batch}; NaN bf16 → fp32 saat memori bebas; set_dtype gagal → utuh"


@heavy
def t_ujung_ke_ujung_teks_sampai_suara_bertanda_air():
    """model multilingual lengkap (T3 + S3Gen + VoiceEncoder acak, tokenizer huruf sintetis) di CPU: teks → token teks sama persis
    dengan generate() bawaan, 2 versi suara jadi, watermark Perth dipasang tiap versi, mesin synth_batch memakai jalur cepat"""
    from chatterbox import mtl_tts
    from chatterbox.models.s3gen import S3Gen
    from chatterbox.models.tokenizers import tokenizer as tkmod
    from chatterbox.models.voice_encoder import VoiceEncoder
    from tokenizers import Regex, Tokenizer, models, pre_tokenizers

    from studio_worker.engines import chatterbox_engine as cbe

    m = model("mtl")
    specials = ["[START]", "[STOP]", "[UNK]", "[SPACE]", "[PAD]", "[SEP]", "[CLS]", "[MASK]", "[id]"]
    vocab = {t: i for i, t in enumerate(specials + list("abcdefghijklmnopqrstuvwxyz0123456789.,!?-'\""))}
    tk = Tokenizer(models.WordLevel(vocab, unk_token="[UNK]"))
    tk.pre_tokenizer = pre_tokenizers.Split(Regex("."), behavior="isolated")
    tk.add_special_tokens(specials)
    tdir = TMP / "tok"
    tdir.mkdir(exist_ok=True)
    tk.save(str(tdir / "grapheme_mtl_tes.json"))
    # tokenizer multilingual dibuat TANPA jaringan (bawaan: hf_hub_download tabel Cangjie tiap start)
    seen = []
    orig_dl = tkmod.hf_hub_download

    def no_net(*a, **k):
        seen.append(k.get("local_files_only"))
        if not k.get("local_files_only"):
            raise AssertionError("tokenizer mencoba internet")
        return orig_dl(*a, **k)

    tkmod.hf_hub_download = no_net
    try:
        tok = cbe.mtl_tokenizer(tdir / "grapheme_mtl_tes.json")
    finally:
        tkmod.hf_hub_download = orig_dl
    assert seen == [True], seen
    t0 = time.time()
    s3, ve = S3Gen().eval(), VoiceEncoder().eval()
    full = mtl_tts.ChatterboxMultilingualTTS(m.t3, s3, ve, tok, "cpu")
    build = time.time() - t0
    full.prepare_conditionals(str(BANK / "referensi-alif-energik-10dtk.wav"), exaggeration=0.6)
    wm_calls = []
    wm = full.watermarker.apply_watermark
    full.watermarker.apply_watermark = lambda y, sample_rate: (wm_calls.append(len(y)), wm(y, sample_rate=sample_rate))[1]
    m.fast.remove()
    f = t3fast.Fast(full, language_id="id", attn="eager")
    added = "id" not in mtl_tts.SUPPORTED_LANGUAGES
    mtl_tts.SUPPORTED_LANGUAGES.setdefault("id", "Indonesian")
    text = "selamat pagi, ini tes suara cepat… ayo!"
    try:
        # token teks yang masuk T3: bawaan (generate → T3.inference, dicegat) vs jalur cepat
        got_up = {}

        def fake_inference(**kw):
            got_up.update(kw)
            return torch.tensor([[11, 12, 13, 14, 15, 16, 17, 18, 6562]])

        full.t3.inference = fake_inference
        up_wav = full.generate(text, language_id="id", exaggeration=0.6, cfg_weight=0.5)
        del full.t3.inference
        assert up_wav.shape[-1] > 0
        got_fast = {}
        orig_st = f.speech_tokens

        def spy(t3_cond, text_tokens, *a, **k):
            got_fast["tt"], got_fast["cond"] = text_tokens.clone(), t3_cond
            return orig_st(t3_cond, text_tokens, *a, **k)

        f.speech_tokens = spy
        wm_calls.clear()
        ys = f.generate(text, 2, [5, 6], exaggeration=0.6, cfg_weight=0.5, max_new_tokens=20, **SAMP)
        del f.speech_tokens
        assert torch.equal(got_up["text_tokens"][0:1].long(), got_fast["tt"]), (got_up["text_tokens"][0].tolist(), got_fast["tt"].tolist())
        assert got_fast["cond"] is full.conds.t3
        assert len(ys) == 2 and all(y.dtype == np.float32 and y.ndim == 1 and y.size > 0 for y in ys)
        assert len(wm_calls) == 2, wm_calls  # tiap versi diberi watermark
        exp_len = [round(len(y) / full.sr, 2) for y in ys]
        assert all(0.2 < s < 1.2 for s in exp_len), exp_len  # 20 token ≈ 0,8 dtk
        assert not np.allclose(ys[0][: min(map(len, ys))], ys[1][: min(map(len, ys))]), "benih beda harus beda suara"
        # exaggeration berubah → T3Cond baru seperti bawaan
        f.generate(text, 1, [7], exaggeration=0.9, cfg_weight=0.5, max_new_tokens=8, **SAMP)
        assert abs(float(full.conds.t3.emotion_adv.view(-1)[0]) - 0.9) < 1e-6
        # mesin: synth_batch → jalur cepat sungguhan (prepare_conditionals + T3 cepat + S3Gen + watermark)
        e = object.__new__(cbe.ChatterboxEngine)
        e.cfg = SimpleNamespace(takes=2, tts_batch=True)
        e.model, e.sr, e.mtl, e.lang, e._ref = full, full.sr, True, "id", None
        e._sampling, e._fast_kw = {"min_p": 0.05}, cbe.fast_sampling(full.generate)
        e.batch, e._max_batch, e._fast_fail, e.builtin, e.fast = True, 6, 0, None, f
        wm_calls.clear()
        out = e.synth_batch(text, BANK / "referensi-alif-energik-10dtk.wav", {"exaggeration": 0.6, "cfg_weight": 0.35, "temperature": 0.8}, [1, 2], max_sec=0.5)
        assert len(out) == 2 and len(wm_calls) == 2 and e._fast_fail == 0 and f.last["n"] == 2 and f.last["max_new"] == 50, f.last
        assert e._fast_kw == {"min_p": 0.05, "repetition_penalty": 2.0, "top_p": 1.0}
    finally:
        if added:
            mtl_tts.SUPPORTED_LANGUAGES.pop("id", None)
        f.remove()
        m.fast.install()
        full.t3 = None
        del s3, ve, full
        gc.collect()
    return f"token teks sama dengan generate() bawaan ({got_fast['tt'].shape[1]} token), 2 versi {exp_len} dtk + watermark, S3Gen/VE acak dibangun {build:.0f} dtk; synth_batch memakai jalur cepat"


@heavy
def t_model_standar_identik_eos_dan_batas_token():
    m = model("en")  # model mtl dilepas dulu (hemat RAM)
    f = m.fast
    f.attn = "sdpa"
    assert not f.analyzer and t3fast.hook_count(m.t3) == 0  # tanpa pengecek → tanpa hook
    text = text_tokens(40, 17, vocab=704)
    for seed in (41, 42):
        up = upstream(m.t3, text, seed, 64)
        fa = fast_tokens(f, text, 1, [seed], 64)[0]
        assert torch.equal(up, fa), (seed, up.tolist()[:16], fa.tolist()[:16])
    n_up = len(up)
    # batas token: tanpa EOS semua versi berhenti tepat di max_new_tokens
    out = fast_tokens(f, text, 3, [1, 2, 3], 30)
    assert [len(t) for t in out] == [30, 30, 30] and f.last["eos"] == [False] * 3 and f.last["steps"] == 30
    # EOS di versi ke-2 mulai langkah 7 → versi itu berhenti (7 token + EOS), versi lain jalan terus
    calls = {"n": 0}
    EOS = m.t3.hp.stop_speech_token

    def bias(rows):
        def hook(mod, a, o):
            c = calls["n"]
            calls["n"] += 1
            if c >= 7:
                o = o.clone()
                o[rows, EOS] += 1e4
            return o

        return hook

    hh = m.t3.speech_head.register_forward_hook(bias([1, 4]))  # baris cond & uncond versi ke-2 (urutan [c×3, u×3])
    try:
        out2 = fast_tokens(f, text, 3, [1, 2, 3], 30)
    finally:
        hh.remove()
    assert [len(t) for t in out2] == [30, 8, 30] and int(out2[1][-1]) == EOS and f.last["eos"] == [False, True, False], ([len(t) for t in out2], f.last)
    assert torch.equal(out2[0], out[0]) and torch.equal(out2[2], out[2])  # versi lain tidak terpengaruh
    # semua EOS → loop berhenti lebih awal
    calls["n"] = 0
    hh = m.t3.speech_head.register_forward_hook(bias([0, 1, 2, 3, 4, 5]))
    try:
        out3 = fast_tokens(f, text, 3, [1, 2, 3], 30)
    finally:
        hh.remove()
    assert [len(t) for t in out3] == [8, 8, 8] and f.last["steps"] == 8, ([len(t) for t in out3], f.last)
    # pembersih token = drop_invalid_tokens bawaan (+ hanya token < 6561)
    from chatterbox.models.s3tokenizer import drop_invalid_tokens

    for seq in ([5, 6, 7, 6562], [9, 6561, 3, 4, 6562], [1, 2, 3], [6561, 8, 6562, 9]):
        x = torch.tensor(seq)
        assert f.clean(x) == [v for v in drop_invalid_tokens(x).tolist() if v < 6561], seq
    MEASURE["build_en"] = m.build
    return f"standar (704, tanpa pengecek): identik {n_up} langkah · batas 30 token · EOS versi-2 di langkah 8 (lainnya tetap) · semua EOS → berhenti di 8"


def main() -> int:
    t0 = time.time()
    for fn in TESTS:
        if not ONLY or any(o in fn.__name__.lower() for o in ONLY):
            run_test(fn)
    ok = sum(1 for r in results if r[1])
    print(f"\n=== {ok}/{len(results)} tes lolos ({time.time() - t0:.0f} dtk) ===")
    if not HAVE_TORCH:
        print(f"(tes berat dilewati: {WHY_NO_TORCH[:120]})")
    if MEASURE:
        print("Ukuran:", MEASURE)
    for n, good, info in results:
        if not good:
            print(f"  GAGAL: {n} — {info}")
    shutil.rmtree(TMP, ignore_errors=True)
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
