"""
Tes mandiri voice-worker TANPA GPU / model / internet (bisa dijalankan di laptop mana pun setelah install):
  .venv\\Scripts\\python selftest.py            (semua tes)
  .venv\\Scripts\\python selftest.py tts render (hanya tes yang namanya mengandung kata itu)
Yang dites: pemecah kalimat & jeda, angka→kata & WER, pemetaan timestamp kata, post-processing ffmpeg, normalisasi LUFS,
pemilih take (ASR dipalsukan), builder full.mp3 + SRT, ketukan musik, pembersih referensi, klaim job (HTTP dipalsukan), cek akses pemilik job,
alur job tts / clean / beats lengkap (Supabase & mesin suara dipalsukan), penulisan ulang URL render, mixing & loudnorm 2 tahap,
tebakan kategori SFX, pendeteksi isi repo model.
"""
from __future__ import annotations

import base64
import json
import re
import shutil
import struct
import sys
import tempfile
import time
import traceback
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

from studio_worker import config  # noqa: E402

config.apply_thread_limits(2)

import httpx  # noqa: E402
import numpy as np  # noqa: E402

from studio_worker import beats, clean, ff, jobs_beats, jobs_clean, jobs_render, jobs_tts, meter, mix, post, seed, sfxlib  # noqa: E402
from studio_worker import text as T  # noqa: E402
from studio_worker.engines import chatterbox_engine as cbe  # noqa: E402
from studio_worker.jobctx import JobCtx, JobError, Runtime, owner_can_use_studio  # noqa: E402
from studio_worker.supa import Supa  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
BANK = HERE / "bank-suara"
SFX = REPO / "assets" / "audio" / "sfx"
TMP = Path(tempfile.mkdtemp(prefix="vw-selftest-"))
results: list[tuple[str, bool, str]] = []


TESTS: list = []


def test(fn):
    TESTS.append(fn)
    return fn


def run_test(fn) -> None:
    name = fn.__name__.removeprefix("t_").replace("_", " ")
    t0 = time.time()
    try:
        info = fn() or ""
        results.append((name, True, f"{info} ({time.time() - t0:.1f} dtk)"))
        print(f"[OK]    {name} {info}")
    except Exception as e:
        results.append((name, False, f"{type(e).__name__}: {e}"))
        print(f"[GAGAL] {name}: {type(e).__name__}: {e}")
        traceback.print_exc()


def near(a: float, b: float, tol: float, what: str) -> None:
    assert abs(a - b) <= tol, f"{what}: {a:.3f} (harusnya {b}±{tol})"


# ---------------------------------------------------------------- palsuan
def speechish(words: int, sr: int = 24000, seed_: int = 0) -> np.ndarray:
    """sinyal mirip ucapan: tiap 'kata' = nada harmonik dengan amplop, dipisah jeda pendek"""
    rnd = np.random.default_rng(seed_)
    parts = []
    for _ in range(words):
        d = rnd.uniform(0.18, 0.32)
        t = np.arange(int(d * sr)) / sr
        f0 = rnd.uniform(110, 160)
        env = np.sin(np.pi * t / d) ** 0.7
        y = sum((0.3 / k) * np.sin(2 * np.pi * f0 * k * t) for k in range(1, 6)) * env
        parts += [y.astype(np.float32), np.zeros(int(rnd.uniform(0.05, 0.09) * sr), np.float32)]
    return np.concatenate(parts)


class FakeEngine:
    name = "chatterbox"
    sr = 24000
    label = "Bank suara · Chatterbox (GPU laptop)"
    credit = "tes"

    def __init__(self):
        self.calls = 0

    def synth(self, text, ref, st, seed):
        self.calls += 1
        return np.concatenate([np.zeros(2400, np.float32), speechish(len(text.split()), self.sr, seed), np.zeros(4800, np.float32)])


class FakeAsr:
    """take ganjil 'salah dengar', take genap benar; mode kata → kata ejaan dibagi rata"""

    available = True
    device = "palsu"
    model = object()

    def __init__(self, expected: dict[str, str] | None = None):
        self.n = 0
        self.expected = expected or {}

    def transcribe(self, path, words=True):
        y, sr = ff.read_wav(Path(path))
        dur = len(y) / sr
        if not words:
            self.n += 1
            txt = self.expected.get("_cur", "")
            return (txt if self.n % 2 == 0 else "bla bla salah total"), []
        txt = self.expected.get("_line", "")
        ws = txt.split()
        step = dur / max(1, len(ws))
        return txt, [(w, i * step + 0.02, (i + 1) * step - 0.02) for i, w in enumerate(ws)]


class FakeSupa:
    """Supabase di memori: tabel + storage"""

    def __init__(self):
        self.tables: dict[str, list[dict]] = {}
        self.files: dict[str, bytes] = {}
        self.worker = "tes"

    def _match(self, row, filters):
        for k, v in filters.items():
            if k in ("select", "order", "limit", "offset", "on_conflict"):
                continue
            op, _, val = str(v).partition(".")
            if op == "eq" and str(row.get(k)) != val:
                return False
        return True

    def select(self, table, **params):
        rows = [dict(r) for r in self.tables.get(table, []) if self._match(r, params)]
        lim = int(params.get("limit", 1000))
        return rows[:lim]

    def insert(self, table, rows, on_conflict=None, merge=False, ignore=False):
        rows = rows if isinstance(rows, list) else [rows]
        t = self.tables.setdefault(table, [])
        out = []
        for r in rows:
            key = on_conflict or "id"
            ex = next((x for x in t if key in r and x.get(key) == r.get(key)), None)
            if ex is not None:
                if merge:
                    ex.update(r)
                    out.append(dict(ex))
                continue
            t.append(dict(r))
            out.append(dict(r))
        return out

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
        b = self.files[path]
        if dest is not None:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(b)
        return b

    def heartbeat(self, info):
        pass


def fake_cfg() -> SimpleNamespace:
    d = TMP / "data"
    for s in ("cache", "tmp", "models", "logs"):
        (d / s).mkdir(parents=True, exist_ok=True)
    return SimpleNamespace(
        cache=d / "cache", tmp=d / "tmp", models=d / "models", logs=d / "logs", data=d, repo=REPO, takes=2, df_atten_db=18.0,
        worker_id="tes", engine_order=["chatterbox", "pocket"], render=True,
    )


class FakeEngines:
    def __init__(self, eng):
        self.eng = eng

    def order(self, pref):
        return ["chatterbox", "pocket"]

    def is_down(self, name):
        return False

    def get(self, name):
        return self.eng

    def mark_down(self, name, reason):
        pass


# ---------------------------------------------------------------- tes
@test
def t_pecah_kalimat_dan_jeda():
    s = 'Halo semuanya! Kamu pernah gak, ngerasa kerjaan numpuk, tapi waktunya cuma sedikit? Tenang… sekarang ada cara yang jauh lebih gampang. Hubungi dll. ya.'
    out = T.split_sentences(s)
    assert out[0] == "Halo semuanya!", out
    assert out[2].startswith("Tenang… sekarang"), out  # 1 kata digabung ke kalimat berikutnya
    assert out[-1].endswith("dll. ya."), out  # singkatan tidak memecah kalimat
    long = " ".join(["kata"] * 120) + ", " + " ".join(["lagi"] * 30) + "."
    assert all(len(x) <= 220 for x in T.split_sentences(long))
    p = T.pauses(["Satu.", "Dua…", "Tiga?", "Empat."], "k")
    assert 0.18 <= p[0] <= 0.4 and p[1] >= 0.45 and 0.28 <= p[2] <= 0.4, p
    assert T.pauses(["A b.", "C d."], "x") == T.pauses(["A b.", "C d."], "x"), "jeda harus konsisten (cache)"
    return f"{len(out)} kalimat, jeda {p}"


@test
def t_angka_wer_cer():
    assert T.norm_words("Emas naik 2,5%") == ["emas", "naik", "dua", "koma", "lima", "persen"]
    assert " ".join(T.norm_words("Rp 16.800")) == "rp enam belas ribu delapan ratus"
    assert T.terbilang(1_250_000) == "satu juta dua ratus lima puluh ribu"
    assert T.terbilang(111) == "seratus sebelas"
    assert T.wer("Harga emas naik 2,5 persen", "harga emas naik dua koma lima persen") == 0
    w = T.wer("kerjaan numpuk banget", "kerjaan menumpuk banget")
    near(w, 1 / 3, 0.01, "WER")
    assert T.cer("abc", "abc") == 0
    # bunyi luncur ejaan mesin suara (sowal / diya / Indonesiya) vs tulisan ASR (soal / dia / Indonesia) → tidak dianggap salah ucap
    assert T.wer("Sowal duwit, diya biyar siyap. Suwara Indonesiya!", "soal duit dia biar siap suara Indonesia") == 0
    assert T.cer("buwat kuwat mediya", "buat kuat media") == 0
    # beda bunyi sungguhan tetap dihitung; huruf w/y di awal / antar konsonan tidak disentuh
    assert T.wer("sowal", "su ul") >= 1.0 and T.wer("wayang yakin", "ayang akin") == 1.0
    assert T.wer("pantai pulau survei", "pantai pulau survei") == 0


@test
def t_timestamp_kata_ke_teks_asli():
    text = "Harga emas naik 2,5% hari ini."
    spell_words = "harga emas naik dua koma lima persen hari ini".split()
    hyp = [(w, 0.1 + i * 0.3, 0.1 + i * 0.3 + 0.25) for i, w in enumerate(spell_words)]
    ws = T.align_words(text, hyp, 3.0)
    assert [w["w"] for w in ws] == text.split()
    num = ws[3]
    near(num["s"], 0.1 + 3 * 0.3, 0.01, "mulai '2,5%'")
    near(num["e"], 0.1 + 6 * 0.3 + 0.25, 0.01, "akhir '2,5%'")
    assert all(ws[i]["s"] <= ws[i + 1]["s"] for i in range(len(ws) - 1)), "harus urut"
    # ejaan beda total (CS Tracker → si es trekker) tetap dapat waktu di antara tetangganya
    ws2 = T.align_words("Kenalin CS Tracker sekarang", [("kenalin", 0.0, 0.4), ("si", 0.45, 0.6), ("es", 0.6, 0.75), ("trekker", 0.8, 1.2), ("sekarang", 1.3, 1.8)], 2.0)
    assert ws2[1]["s"] >= 0.4 and ws2[2]["e"] <= 1.31, ws2
    est = T.estimate_words("satu dua tiga", 1.5)
    assert len(est) == 3 and est[-1]["e"] <= 1.5
    return f"'2,5%' → {num['s']:.2f}–{num['e']:.2f} dtk"


@test
def t_post_processing_ffmpeg():
    sr = 24000
    y = np.concatenate([np.zeros(int(0.5 * sr), np.float32), speechish(6, sr) * 0.1, np.zeros(int(1.6 * sr), np.float32), speechish(5, sr, 3) * 0.1, np.zeros(int(0.4 * sr), np.float32)])
    src = ff.write_wav(TMP / "vo-raw.wav", y, sr)
    dur = post.process_vo(src, TMP / "vo.wav")
    o, osr = ff.read_wav(TMP / "vo.wav")
    assert osr == 48000
    near(meter.lufs(o, osr), -16, 0.6, "LUFS VO")
    tp = meter.true_peak_db(o, osr)
    assert tp <= -1.3, f"true peak {tp:.2f}"
    assert dur < len(y) / sr - 1.0, f"hening panjang harus dipendekkan ({len(y) / sr:.2f} → {dur:.2f})"
    return f"{len(y) / sr:.2f} → {dur:.2f} dtk, {meter.lufs(o, osr):.1f} LUFS, TP {tp:.1f}"


@test
def t_normalisasi_lufs():
    sr = 48000
    rnd = np.random.default_rng(1)
    y = (rnd.standard_normal(sr * 3) * 0.05).astype(np.float32)
    for target, tp in ((-20, -1.0), (-14, -1.0), (-16, -1.5)):
        o, _ = meter.normalize(y, sr, target, tp)
        near(meter.lufs(o, sr), target, 0.7, f"LUFS {target}")
        assert meter.true_peak_db(o, sr) <= tp + 0.05
    short = speechish(1, sr)[: int(0.2 * sr)]
    assert meter.lufs(short, sr) > -70, "klip pendek tetap bisa diukur"


@test
def t_pemilih_take_asr_palsu():
    eng = FakeEngine()
    sent = "Halo semuanya ini tes suara"
    asr = FakeAsr({"_cur": sent})
    st = {"exaggeration": 0.6, "cfg_weight": 0.35, "temperature": 0.8, "takes": 2}
    y, info = jobs_tts.pick_take(eng, sent, Path("ref.wav"), st, asr, TMP)
    assert info["take"] == 2 and info["wer"] == 0, info
    asr2 = FakeAsr({"_cur": "jelek"})  # semua salah → coba versi tambahan (maks takes+2)
    _, info2 = jobs_tts.pick_take(eng, sent, Path("ref.wav"), st, asr2, TMP)
    assert asr2.n == 4, f"harus 4 versi, dapat {asr2.n}"
    sc = jobs_tts.score_take(np.zeros(100, np.float32), 24000, "kalimat panjang sekali yang tidak mungkin sependek ini", None)
    assert sc["score"] > 0.3, sc
    return f"pilih versi {info['take']}"


@test
def t_full_mp3_dan_srt():
    sr = 48000
    a, b = speechish(4, sr), speechish(6, sr, 2)
    full = mix.place_clips([(a, 0.15), (b, 3.0)], sr, tail=0.5)
    near(len(full) / sr, 3.0 + len(b) / sr + 0.5, 0.01, "panjang full")
    assert np.abs(full[: int(0.14 * sr)]).max() == 0, "sebelum start harus hening"
    words = [{"w": w, "s": i * 0.3, "e": i * 0.3 + 0.25} for i, w in enumerate("Halo semua, ini tes subtitle yang cukup panjang ya.".split())]
    srt = T.to_srt(T.group_cues(words, 3.0))
    blocks = srt.strip().split("\n\n")
    assert re.match(r"1\n00:00:03,000 --> 00:00:03,\d{3}\nHalo semua,", blocks[0]), blocks[0]
    assert all(len(b.split("\n")[2].split()) <= 6 for b in blocks)
    return f"{len(blocks)} potongan subtitle"


@test
def t_ketukan_musik():
    sr = 22050
    y = np.zeros(sr * 8, np.float32)
    for k in range(16):  # klik tiap 0,5 dtk = 120 BPM
        i = int(k * 0.5 * sr)
        y[i : i + 400] += np.hanning(400).astype(np.float32) * np.sin(2 * np.pi * 1000 * np.arange(400) / sr).astype(np.float32)
    p = ff.write_wav(TMP / "klik.wav", y, sr)
    r = beats.analyze(p)
    assert r["bpm"] and abs(r["bpm"] - 120) < 3, r["bpm"]
    assert len(r["beats"]) >= 10
    f = SFX / "trailer-pulse-sedang.mp3"
    r2 = beats.analyze(f) if f.exists() else {"bpm": None, "beats": [], "dur": 0}
    assert r2["dur"] > 5 if f.exists() else True
    return f"klik {r['bpm']} BPM; trailer-pulse-sedang {r2['bpm']} BPM, {len(r2['beats'])} ketukan, {r2.get('lufs')} LUFS"


@test
def t_sumber_musik_beats():
    k, p = jobs_beats.resolve_src("asset:music/musik-teaser.mp3", REPO)
    assert k == "asset" and p.endswith("musik-teaser.mp3")
    assert jobs_beats.resolve_src("/api/studio/asset/music/a.mp3", REPO)[0] == "asset"
    assert jobs_beats.resolve_src("/api/studio/file?p=uploads%2Fu1%2Fmusic%2Fa.mp3", REPO) == ("storage", "uploads/u1/music/a.mp3")
    for bad in ("asset:music/../x.mp3", "asset:etc/passwd", "uploads/../x"):
        try:
            jobs_beats.resolve_src(bad, REPO)
            raise AssertionError(f"harus ditolak: {bad}")
        except JobError:
            pass


@test
def t_pembersih_referensi():
    f = BANK / "suara-alif-tenang.wav"
    r = clean.process(f, TMP / "clean.wav", 18)
    q = r.quality
    assert r.ok, q
    assert 7.5 <= q["dur"] <= 10.6, q["dur"]
    near(q["lufs"], -20, 0.5, "LUFS referensi")
    assert q["noise"] in ("rendah", "sedang", "tinggi") and q["saran"]
    # rekaman kosong → gagal dengan saran
    ff.write_wav(TMP / "kosong.wav", np.zeros(48000 * 4, np.float32), 48000)
    r2 = clean.process(TMP / "kosong.wav", TMP / "kosong-clean.wav", 18)
    assert not r2.ok and r2.quality["saran"], r2.quality
    return f"{q['dur']} dtk mulai {q['start']} dtk, SNR {q['snr_db']} dB ({q['noise']}), pembersih {q['denoise']}"


@test
def t_klaim_job_http_palsu():
    calls = []
    state = {"n503": 1}

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        q = dict(req.url.params)
        if req.method == "GET":
            if state["n503"]:
                state["n503"] -= 1
                return httpx.Response(503, text="sibuk")
            return httpx.Response(200, json=[{"id": "a"}, {"id": "b"}])
        if req.method == "PATCH":
            assert q.get("status") == "eq.antri", q
            assert "return=representation" in req.headers.get("prefer", "")
            body = json.loads(req.content)
            assert body["status"] == "proses" and body["worker"] == "laptop-tes"
            if q["id"] == "eq.a":
                return httpx.Response(200, json=[])  # sudah diambil worker lain
            return httpx.Response(200, json=[{"id": "b", "status": "proses"}])
        return httpx.Response(404)

    s = Supa("https://x.supabase.co", "kunci", "laptop-tes", client=httpx.Client(transport=httpx.MockTransport(handler)))
    s.sleep = lambda _t: None
    job = s.claim("studio_voice_jobs")
    assert job and job["id"] == "b", job
    assert calls[0].headers["apikey"] == "kunci" and calls[0].headers["authorization"] == "Bearer kunci"
    assert len([c for c in calls if c.method == "GET"]) == 2, "harus retry setelah 503"
    # upload storage: POST + x-upsert
    up = []
    s2 = Supa("https://x.supabase.co", "k", "w", client=httpx.Client(transport=httpx.MockTransport(lambda r: (up.append(r), httpx.Response(200, json={"Key": "x"}))[1])))
    s2.upload("vo/j1/l 1.mp3", b"abc", "audio/mpeg")
    assert up[0].url.raw_path == b"/storage/v1/object/studio/vo/j1/l%201.mp3" and up[0].headers["x-upsert"] == "true", up[0].url
    return f"{len(calls)} request"


@test
def t_akses_studio_pemilik_job():
    sb = FakeSupa()
    sb.tables["profiles"] = [{"id": "adm", "role": "admin"}, {"id": "u1", "role": "user"}, {"id": "u2", "role": "user"}]
    sb.tables["studio_access"] = [{"user_id": "u1"}]
    assert owner_can_use_studio(sb, "adm") and owner_can_use_studio(sb, "u1"), "admin & user di studio_access boleh"
    assert not owner_can_use_studio(sb, "u2"), "akses dicabut (tidak ada di studio_access) → tidak boleh"
    assert owner_can_use_studio(sb, None), "job sistem tanpa created_by tetap jalan"
    return "admin / studio_access / dicabut / job sistem"


def _save(sb: FakeSupa, path: str) -> str:
    p = TMP / path.replace("/", "_")
    p.write_bytes(sb.files[path])
    return str(p)


def _bank_supa() -> tuple[FakeSupa, dict]:
    sb = FakeSupa()
    vid = "11111111-1111-1111-1111-111111111111"
    sb.files[f"voices/{vid}/raw.wav"] = (BANK / "referensi-alif-energik-10dtk.wav").read_bytes()
    v = {"id": vid, "name": "Alif - Energik", "consent": True, "raw_path": f"voices/{vid}/raw.wav", "clean_path": None, "status": "baru", "seed_key": "alif-energik", "updated_at": "t0"}
    sb.tables["studio_voices"] = [v]
    return sb, v


@test
def t_job_clean_lengkap():
    sb, v = _bank_supa()
    rt = Runtime(cfg=fake_cfg(), supa=sb)  # type: ignore[arg-type]
    job = {"id": "job-clean", "kind": "clean", "voice_id": v["id"], "status": "proses"}
    sb.tables["studio_voice_jobs"] = [job]
    jobs_clean.run(JobCtx(rt, "studio_voice_jobs", job, min_gap=0))
    row = sb.tables["studio_voices"][0]
    assert row["status"] == "siap" and row["clean_path"] == f"voices/{v['id']}/clean.wav", row
    assert row["clean_path"] in sb.files and job["status"] == "selesai", job
    # tanpa izin → ditolak
    sb.tables["studio_voices"][0]["consent"] = False
    try:
        jobs_clean.clean_voice(rt, sb.tables["studio_voices"][0])
        raise AssertionError("suara tanpa izin harus ditolak")
    except JobError:
        pass
    return row["quality"]["saran"]


@test
def t_job_tts_lengkap():
    sb, v = _bank_supa()
    cfg = fake_cfg()
    eng = FakeEngine()
    asr = FakeAsr()
    rt = Runtime(cfg=cfg, supa=sb, engines=FakeEngines(eng), asr=asr)  # type: ignore[arg-type]
    lines = [
        {"id": "s1", "scene_id": "s1", "text": "Masih kerja manual?", "spell": None, "start": 0.15},
        {"id": "s2", "scene_id": "s2", "text": "Emas naik 2,5% hari ini. Tenang… ada caranya.", "spell": "Emas naik dua koma lima persen hari ini. Tenang… ada caranya.", "start": 2.65},
    ]

    class Asr2(FakeAsr):
        def transcribe(self, path, words=True):
            if not words:
                self.n += 1
                return "salah" if self.n % 2 else self.cur, []
            return super().transcribe(path, words)

    a2 = Asr2({"_line": "emas naik dua koma lima persen hari ini tenang ada caranya"})
    a2.cur = ""
    orig = jobs_tts.pick_take

    def pick(engine, sentence, ref, st, asr_, tmp, on_take=None):
        a2.cur = sentence
        return orig(engine, sentence, ref, st, asr_, tmp, on_take)

    jobs_tts.pick_take = pick
    rt.asr = a2
    try:
        return _tts_flow(sb, v, rt, eng, lines)
    finally:
        jobs_tts.pick_take = orig


def _tts_flow(sb: FakeSupa, v: dict, rt: Runtime, eng: FakeEngine, lines: list[dict]) -> str:
    job = {"id": "job-tts", "kind": "tts", "voice_id": v["id"], "engine": "auto", "lines": lines, "settings": {"exaggeration": 0.65, "cfg_weight": 0.35, "takes": 2}, "status": "proses"}
    sb.tables["studio_voice_jobs"] = [job]
    jobs_tts.run(JobCtx(rt, "studio_voice_jobs", job, min_gap=0))
    assert job["status"] == "selesai", job.get("message")
    r = job["result"]
    assert set(["lines", "full_path", "srt_path"]) <= set(r), r.keys()
    assert [x["path"] for x in r["lines"]] == ["vo/job-tts/s1.mp3", "vo/job-tts/s2.mp3"]
    assert r["full_path"] == "vo/job-tts/full.mp3" and r["srt_path"] == "vo/job-tts/full.srt"
    for p in (r["full_path"], r["srt_path"], *[x["path"] for x in r["lines"]]):
        assert p in sb.files and len(sb.files[p]) > 50, p
    l2 = r["lines"][1]
    assert [w["w"] for w in l2["words"]] == lines[1]["text"].split(), "subtitle harus pakai teks asli"
    assert all(set(w) == {"w", "s", "e"} for w in l2["words"])
    full = ff.duration(Path(_save(sb, r["full_path"])))
    near(full, 2.65 + l2["dur"] + 0.5, 0.15, "panjang full.mp3")
    srt = sb.files[r["srt_path"]].decode()
    assert "2,5%" in srt and "00:00:02," in srt, srt[:200]
    assert job["engine_used"] == "chatterbox" and job["cache_key"]
    n_calls = eng.calls
    # job kedua dengan naskah sama → pakai cache (tanpa membuat suara lagi)
    job2 = {**job, "id": "job-tts-2", "status": "proses", "result": None}
    sb.tables["studio_voice_jobs"].append(job2)
    jobs_tts.run(JobCtx(rt, "studio_voice_jobs", sb.tables["studio_voice_jobs"][-1], min_gap=0))
    j2 = sb.tables["studio_voice_jobs"][-1]
    assert j2["status"] == "selesai" and j2["result"]["full_path"] == r["full_path"] and eng.calls == n_calls
    # satu baris berubah → baris lain diambil dari cache laptop
    job3 = {**job, "id": "job-tts-3", "status": "proses", "result": None, "lines": [lines[0], {**lines[1], "text": "Teks baru.", "spell": None}]}
    sb.tables["studio_voice_jobs"].append(job3)
    jobs_tts.run(JobCtx(rt, "studio_voice_jobs", sb.tables["studio_voice_jobs"][-1], min_gap=0))
    assert sb.tables["studio_voice_jobs"][-1]["status"] == "selesai"
    new_calls = eng.calls - n_calls
    assert new_calls == 2, f"hanya baris baru yang dibuat ulang (2 versi), dapat {new_calls}"
    # suara tanpa izin → gagal dengan pesan awam
    sb.tables["studio_voices"][0]["consent"] = False
    try:
        jobs_tts.voice_ref(rt, v["id"])
        raise AssertionError("harus ditolak")
    except JobError as e:
        assert "izin" in str(e)
    return f"{len(r['lines'])} baris, full {full:.2f} dtk, {eng.calls} panggilan mesin"



def _f0(y: np.ndarray, sr: int) -> float:
    """frekuensi dominan (Hz) bagian tengah sinyal — untuk cek nada tidak berubah setelah dipercepat"""
    mid = y[len(y) // 4 : len(y) * 3 // 4]
    spec = np.abs(np.fft.rfft(mid * np.hanning(len(mid))))
    return float(np.fft.rfftfreq(len(mid), 1 / sr)[int(np.argmax(spec))])


@test
def t_percepat_vo_jendela_teaser():
    sr = 48000
    # nada harmonik 200 Hz 3 dtk (mirip vokal panjang), kata-kata sampai 2,88 dtk → ucapan 3,0 dtk
    t = np.arange(int(3.0 * sr)) / sr
    y = (sum((0.25 / k) * np.sin(2 * np.pi * 200 * k * t) for k in range(1, 5)) * 0.8).astype(np.float32)
    src = ff.write_wav(TMP / "fit-src.wav", y, sr)
    words = [{"w": f"k{i}", "s": round(i * 0.48, 3), "e": round(i * 0.48 + 0.4, 3)} for i in range(6)]  # e terakhir 2,8
    meta = {"dur": 3.0, "words": words}
    near(jobs_tts.speech_end(meta), 2.92, 1e-6, "ucapan = kata terakhir + 0,12")
    # tanpa max / sudah muat → apa adanya
    assert jobs_tts.fit_to_max(src, meta, None, TMP, "a") == (src, meta)
    assert jobs_tts.fit_to_max(src, meta, 2.95, TMP, "b") == (src, meta)
    # hening di ujung tidak dihitung: kata selesai 2,0 dtk dari file 3,0 dtk, jendela 2,3 → tidak dipercepat
    quiet = {"dur": 3.0, "words": [{"w": "a", "s": 0.1, "e": 1.0}, {"w": "b", "s": 1.1, "e": 2.0}]}
    assert jobs_tts.fit_to_max(src, quiet, 2.3, TMP, "c")[1] is quiet
    # jendela 2,6 → kata terakhir 2,8 harus selesai di 2,6 − 0,12 → faktor 2,8/2,48 = 1,129: durasi & kata terskala, nada tetap ±2%
    w2, m2 = jobs_tts.fit_to_max(src, meta, 2.6, TMP, "d")
    f = 2.8 / 2.48
    y2, sr2 = ff.read_wav(w2)
    near(m2["dur"], 3.0 / f, 0.03, "durasi setelah dipercepat")
    near(len(y2) / sr2, m2["dur"], 0.002, "dur meta = panjang file")
    assert m2["speed"] == 13 and m2["fit"] and m2["max"] == 2.6, m2
    assert jobs_tts.speech_end(m2) <= 2.6 + 0.01, jobs_tts.speech_end(m2)
    k = m2["dur"] / 3.0
    for a, b in zip(meta["words"], m2["words"]):
        near(b["s"], a["s"] * k, 0.002, f"awal kata {a['w']}")
        near(b["e"], a["e"] * k, 0.002, f"akhir kata {a['w']}")
    f0a, f0b = _f0(y, sr), _f0(y2, sr2)
    assert abs(f0b - f0a) / f0a < 0.02, f"nada berubah: {f0a:.1f} → {f0b:.1f} Hz"
    # jendela jauh lebih pendek → mentok 1,3× (30%), jujur: belum muat
    w3, m3 = jobs_tts.fit_to_max(src, meta, 1.8, TMP, "e")
    near(m3["dur"], 3.0 / 1.3, 0.03, "durasi maks 1,3×")
    assert m3["speed"] == 30 and m3["fit"] is False, m3
    near(_f0(ff.read_wav(w3)[0], sr), f0a, f0a * 0.02, "nada di 1,3×")
    # parse_lines: max ikut dibaca; job lama tanpa max → None, kunci job sama seperti sebelum ada max
    ls = jobs_tts.parse_lines([{"id": "a", "scene_id": "a", "text": "Halo.", "start": 0.3, "max": "2,5"}, {"id": "b", "scene_id": "b", "text": "Hai.", "start": 3}])
    assert ls[0]["max"] == 2.5 and ls[1]["max"] is None, ls
    st = jobs_tts.norm_settings({})
    old_key = jobs_tts._sha([jobs_tts.CACHE_V, "chatterbox", "v", st, [[x["id"], x["scene_id"], x["text"], x["spell"] or "", x["start"]] for x in ls[1:]]])
    assert jobs_tts.job_key("chatterbox", "v", ls[1:], st) == old_key, "kunci job tanpa max harus sama dengan versi lama"
    assert jobs_tts.job_key("chatterbox", "v", ls, st) != jobs_tts.job_key("chatterbox", "v", [{**ls[0], "max": 2.0}, ls[1]], st), "kunci job ikut max"
    return f"3,0 dtk → {m2['dur']:.2f} dtk (+{m2['speed']}%), nada {f0a:.0f}→{f0b:.0f} Hz, mentok 30% → {m3['dur']:.2f} dtk"


def _sentences_wav(name: str, parts: list[float], gap: float, sr: int = 48000) -> tuple[Path, dict, np.ndarray]:
    """'kalimat' = nada harmonik 200 Hz sepanjang parts[i] detik, dipisah hening `gap` detik; tiap kalimat 2 kata"""
    ys, words, t0 = [], [], 0.0
    for i, d in enumerate(parts):
        t = np.arange(int(d * sr)) / sr
        ys.append((sum((0.25 / k) * np.sin(2 * np.pi * 200 * k * t) for k in range(1, 5)) * 0.8).astype(np.float32))
        words += [{"w": f"k{i}a", "s": round(t0 + 0.02, 3), "e": round(t0 + d / 2, 3)}, {"w": f"k{i}b", "s": round(t0 + d / 2, 3), "e": round(t0 + d - 0.02, 3)}]
        t0 += d
        if i < len(parts) - 1:
            ys.append(np.zeros(int(gap * sr), np.float32))
            t0 += gap
    ys.append(np.zeros(int(0.1 * sr), np.float32))
    y = np.concatenate(ys)
    return ff.write_wav(TMP / name, y, sr), {"dur": round(len(y) / sr, 3), "words": words}, y


@test
def t_padatkan_jeda_sebelum_percepat():
    sr = 48000
    # 3 kalimat 1,0 dtk dengan jeda 0,5 dtk (seperti sesudah "…") → ucapan = 3 + 2·0,5 − 0,02 + 0,12 = 4,1 dtk
    src, meta, y = _sentences_wav("sq-src.wav", [1.0, 1.0, 1.0], 0.5)
    sp = jobs_tts.speech_end(meta)
    near(sp, 4.1, 1e-6, "ucapan awal")
    ps = jobs_tts.find_pauses(y, sr)
    assert len(ps) == 2 and all(abs((b - a) - 0.5) <= 0.03 for a, b in ps), ps
    # suara tanpa jeda (nada utuh) → tidak ada jeda yang bisa dipadatkan
    t = np.arange(int(2.0 * sr)) / sr
    assert jobs_tts.find_pauses((0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), sr) == []
    # (1) jendela 3,7 → cukup jeda dipadatkan 0,4 dtk (0,2 per jeda), suara TIDAK dipercepat
    w1, m1 = jobs_tts.fit_to_max(src, meta, 3.7, TMP, "sq1")
    assert "speed" not in m1 and m1["fit"] is True and m1["max"] == 3.7, m1
    near(m1["squeeze"], 0.4, 0.01, "detik jeda dibuang")
    near(jobs_tts.speech_end(m1), 3.7, 0.015, "ucapan setelah dipadatkan")
    y1, _ = ff.read_wav(w1)
    near(len(y1) / sr, meta["dur"] - 0.4, 0.01, "panjang file setelah dipadatkan")
    near(m1["dur"], len(y1) / sr, 0.002, "dur meta = panjang file")
    # kata kalimat 1 tetap, kalimat 2 maju 0,2 dtk, kalimat 3 maju 0,4 dtk
    for k, shift in ((0, 0.0), (2, 0.2), (4, 0.4)):
        near(m1["words"][k]["s"], meta["words"][k]["s"] - shift, 0.012, f"kata {k} digeser")
    ps1 = jobs_tts.find_pauses(y1[:, 0] if y1.ndim > 1 else y1, sr)
    assert len(ps1) == 2 and all((b - a) >= jobs_tts.PAUSE_MIN - 0.02 for a, b in ps1), f"jeda tersisa min 0,12: {ps1}"
    # (2) jendela 3,0 → jeda dipadatkan maksimal dulu (sisa 0,12 per jeda) baru sisanya dipercepat
    w2, m2 = jobs_tts.fit_to_max(src, meta, 3.0, TMP, "sq2")
    near(m2["squeeze"], 2 * (0.5 - jobs_tts.PAUSE_MIN), 0.04, "jeda dipadatkan maksimal")
    only_tempo = 3.98 / (3.0 - 0.12)  # tanpa pemadatan: kata terakhir 3,98 harus selesai di 2,88
    assert 0 < m2["speed"] < round((only_tempo - 1) * 100), (m2["speed"], only_tempo)
    assert m2["fit"] and jobs_tts.speech_end(m2) <= 3.0 + 0.01, (m2["fit"], jobs_tts.speech_end(m2))
    near(_f0(ff.read_wav(w2)[0], sr), 200, 4, "nada tetap")
    # (3) speed eksplisit: atempo persis, max diabaikan, jeda tidak dipadatkan
    w3, m3 = jobs_tts.apply_speed(src, meta, 1.2, TMP, "sp1")
    near(m3["dur"], meta["dur"] / 1.2, 0.03, "durasi 1,2×")
    assert m3["tempo"] == 1.2 and m3["speed"] == 20 and "squeeze" not in m3, m3
    w4, m4 = jobs_tts.apply_speed(src, meta, 0.85, TMP, "sp2")
    near(m4["dur"], meta["dur"] / 0.85, 0.03, "durasi 0,85×")
    assert m4["speed"] == -15 and m4["tempo"] == 0.85, m4
    assert jobs_tts.apply_speed(src, meta, 1.0, TMP, "sp3") == (src, {**meta, "tempo": 1.0})
    # parse_lines & kunci job: speed ikut kalau ada, job lama tanpa speed kuncinya tetap
    ls = jobs_tts.parse_lines([{"id": "a", "scene_id": "a", "text": "Halo.", "start": 0, "speed": "1,1"}, {"id": "b", "scene_id": "b", "text": "Hai.", "start": 3}, {"id": "c", "scene_id": "c", "text": "Yo.", "speed": 9}])
    assert ls[0]["speed"] == 1.1 and ls[1]["speed"] is None and ls[2]["speed"] == jobs_tts.SPEED_MAX, ls
    st = jobs_tts.norm_settings({})
    old_key = jobs_tts._sha([jobs_tts.CACHE_V, "chatterbox", "v", st, [[x["id"], x["scene_id"], x["text"], x["spell"] or "", x["start"]] for x in ls[1:2]]])
    assert jobs_tts.job_key("chatterbox", "v", ls[1:2], st) == old_key, "kunci job tanpa speed harus sama dengan versi lama"
    assert jobs_tts.job_key("chatterbox", "v", ls[:1], st) != jobs_tts.job_key("chatterbox", "v", [{**ls[0], "speed": 1.2}], st)
    return f"jendela 3,7: jeda −{m1['squeeze']:.2f} dtk tanpa percepat; jendela 3,0: jeda −{m2['squeeze']:.2f} + {m2['speed']}%; 1,2× → {m3['dur']:.2f} dtk"


@test
def t_job_tts_speed_eksplisit():
    sb, v = _bank_supa()
    eng = FakeEngine()
    rt = Runtime(cfg=fake_cfg(), supa=sb, engines=FakeEngines(eng), asr=FakeAsr({"_line": "satu dua tiga empat lima enam"}))  # type: ignore[arg-type]
    text = "Satu dua tiga empat lima enam."
    base = {"kind": "tts", "voice_id": v["id"], "engine": "auto", "settings": {"takes": 1}, "status": "proses"}
    job = {**base, "id": "job-sp-0", "lines": [{"id": "x", "scene_id": "x", "text": text, "spell": None, "start": 0.2}]}
    sb.tables["studio_voice_jobs"] = [job]
    jobs_tts.run(JobCtx(rt, "studio_voice_jobs", job, min_gap=0))
    l0 = job["result"]["lines"][0]
    assert job["status"] == "selesai" and not ({"speed", "tempo", "squeeze"} & set(l0)), l0
    # kecepatan 1,25× (max diberi tapi diabaikan) → suara mentah dari cache, durasi /1,25
    job2 = {**base, "id": "job-sp-1", "lines": [{"id": "x", "scene_id": "x", "text": text, "spell": None, "start": 0.2, "speed": 1.25, "max": 0.5}]}
    sb.tables["studio_voice_jobs"].append(job2)
    calls = eng.calls
    jobs_tts.run(JobCtx(rt, "studio_voice_jobs", job2, min_gap=0))
    l1 = job2["result"]["lines"][0]
    assert job2["status"] == "selesai" and eng.calls == calls, "suara mentah dari cache laptop"
    assert l1["tempo"] == 1.25 and l1["speed"] == 25 and "squeeze" not in l1, l1
    near(l1["dur"], l0["dur"] / 1.25, 0.04, "durasi 1,25×")
    assert [w["w"] for w in l1["words"]] == text.split() and l1["words"][-1]["e"] <= l1["dur"] + 1e-6
    assert job2["cache_key"] != job["cache_key"]
    return f"{l0['dur']:.2f} dtk → {l1['dur']:.2f} dtk (1,25×)"


@test
def t_job_tts_coba_ejaan_seed():
    """🎧 Coba ejaan: satu job, kalimat sama dengan beberapa ejaan, takes 1, benih sama untuk semua kandidat; job lama tanpa seed tetap sama"""
    sb, v = _bank_supa()

    class SeedEngine(FakeEngine):
        def __init__(self):
            super().__init__()
            self.seeds: list[tuple[str, int]] = []

        def synth(self, text, ref, st, seed):
            self.seeds.append((text, seed))
            return super().synth(text, ref, st, seed)

    eng = SeedEngine()
    # ASR palsu sering "salah dengar" → job biasa membuat versi tambahan; job coba ejaan tetap 1 versi per kandidat
    rt = Runtime(cfg=fake_cfg(), supa=sb, engines=FakeEngines(eng), asr=FakeAsr({"_line": "kerja bareng tim"}))  # type: ignore[arg-type]
    text = "Kerja bareng tim."
    cands = ["Kerja bareng tim.", "Kerja barêng tim.", "Kerja barəng tim.", "Kerja bar'ng tim."]
    lines = [{"id": f"coba-{k + 1}", "scene_id": "s1", "text": text, "spell": None if c == text else c, "start": 0, "seed": 4242} for k, c in enumerate(cands)]
    st = {"exaggeration": 0.5, "cfg_weight": 0.5, "temperature": 0.8, "takes": 1, "purpose": "coba-ejaan", "word": "bareng"}
    job = {"id": "job-coba", "kind": "tts", "voice_id": v["id"], "engine": "auto", "lines": lines, "settings": st, "status": "proses"}
    sb.tables["studio_voice_jobs"] = [job]
    jobs_tts.run(JobCtx(rt, "studio_voice_jobs", job, min_gap=0))
    assert job["status"] == "selesai", job.get("message")
    got = job["result"]["lines"]
    assert [x["id"] for x in got] == ["coba-1", "coba-2", "coba-3", "coba-4"] and all(x["scene_id"] == "s1" for x in got), got
    assert [w["w"] for w in got[1]["words"]] == text.split(), "subtitle tetap teks asli"
    said = [t for t, _ in eng.seeds]
    assert said[:4] == cands and len(eng.seeds) == 4, eng.seeds
    assert {sd for _, sd in eng.seeds} == {4242}, f"benih sama untuk semua kandidat: {eng.seeds}"
    assert jobs_tts.is_trial(st) and not jobs_tts.is_trial({"takes": 1}) and not jobs_tts.is_trial(None)
    # tanpa seed (job lama) → benih dari teks: tiap ejaan beda benih, kunci cache baris & job tidak berubah dari dulu
    ln_old = jobs_tts.parse_lines([{**lines[1], "seed": None}])[0]
    assert ln_old["seed"] is None and jobs_tts.take_seed("Kerja barêng tim.", 0) != jobs_tts.take_seed("Kerja barəng tim.", 0)
    assert jobs_tts.take_seed("apa saja", 1, 4242) == (4242 + 7919) % (2**31 - 1)
    stn = jobs_tts.norm_settings(st)
    assert "purpose" not in stn and stn["takes"] == 1, stn
    old_key = jobs_tts._sha([jobs_tts.CACHE_V, "chatterbox", "v", ln_old["text"], ln_old["spell"] or "", stn])
    assert jobs_tts.line_key("chatterbox", "v", ln_old, stn) == old_key, "kunci baris lama tetap"
    ln_new = jobs_tts.parse_lines([lines[1]])[0]
    assert ln_new["seed"] == 4242 and jobs_tts.line_key("chatterbox", "v", ln_new, stn) != old_key
    assert jobs_tts.job_key("chatterbox", "v", [ln_old], stn) != jobs_tts.job_key("chatterbox", "v", [ln_new], stn)
    # seed aneh diabaikan (job tetap jalan)
    bad = jobs_tts.parse_lines([{**lines[0], "seed": "x"}, {**lines[1], "id": "b", "seed": -5}, {**lines[2], "id": "c", "seed": True}, {**lines[3], "id": "d", "seed": 2**40}])
    assert [b["seed"] for b in bad] == [None, None, None, None], bad
    return f"{len(got)} ejaan dalam 1 job, benih {eng.seeds[0][1]} untuk semua"


@test
def t_job_tts_max_jendela():
    sb, v = _bank_supa()
    eng = FakeEngine()
    rt = Runtime(cfg=fake_cfg(), supa=sb, engines=FakeEngines(eng), asr=FakeAsr({"_line": "satu dua tiga empat lima enam tujuh delapan"}))  # type: ignore[arg-type]
    text = "Satu dua tiga empat lima enam tujuh delapan."
    lines = [{"id": "m1", "scene_id": "m1", "text": text, "spell": None, "start": 0.3}, {"id": "m2", "scene_id": "m2", "text": text, "spell": None, "start": 9.0}]
    base = {"kind": "tts", "voice_id": v["id"], "engine": "auto", "settings": {"takes": 1}, "status": "proses"}
    job = {**base, "id": "job-max-0", "lines": lines}
    sb.tables["studio_voice_jobs"] = [job]
    jobs_tts.run(JobCtx(rt, "studio_voice_jobs", job, min_gap=0))
    assert job["status"] == "selesai", job.get("message")
    d0 = job["result"]["lines"][0]["dur"]
    assert "speed" not in job["result"]["lines"][0], "tanpa max tidak dipercepat"
    # baris 1 diberi jendela 85% dari ucapannya → dipercepat ±18%, baris 2 jendela longgar → apa adanya
    mx = round(d0 * 0.85, 3)
    job2 = {**base, "id": "job-max-1", "lines": [{**lines[0], "max": mx}, {**lines[1], "max": d0 + 1}]}
    sb.tables["studio_voice_jobs"].append(job2)
    calls = eng.calls
    jobs_tts.run(JobCtx(rt, "studio_voice_jobs", job2, min_gap=0))
    assert job2["status"] == "selesai", job2.get("message")
    assert eng.calls == calls, "suara mentah diambil dari cache laptop (max tidak memicu bikin suara ulang)"
    assert job2["cache_key"] != job["cache_key"], "kunci job ikut max"
    l1, l2 = job2["result"]["lines"]
    assert 15 <= l1["speed"] <= 19 and "speed" not in l2, (l1.get("speed"), l2.get("speed"))
    assert l1["dur"] <= mx + 0.01 and abs(l2["dur"] - d0) < 1e-6, (l1["dur"], mx, l2["dur"], d0)
    assert l1["words"][-1]["e"] <= l1["dur"] + 1e-6 and [w["w"] for w in l1["words"]] == text.split()
    near(ff.duration(Path(_save(sb, l1["path"]))), l1["dur"], 0.08, "mp3 baris dipercepat")
    return f"{d0:.2f} dtk → {l1['dur']:.2f} dtk (+{l1['speed']}%) di jendela {mx:.2f} dtk"


@test
def t_semua_mesin_gagal_pesan_cadangan():
    from studio_worker.engines import EngineDown

    sb, v = _bank_supa()

    class Down:
        def order(self, pref):
            return ["chatterbox", "pocket"]

        def is_down(self, n):
            return False

        def get(self, n):
            raise EngineDown("tidak ada GPU")

        def mark_down(self, n, r):
            pass

    rt = Runtime(cfg=fake_cfg(), supa=sb, engines=Down(), asr=None)  # type: ignore[arg-type]
    job = {"id": "job-x", "kind": "tts", "voice_id": v["id"], "lines": [{"id": "a", "scene_id": "a", "text": "Halo semua.", "start": 0}], "settings": {}, "status": "proses"}
    sb.tables["studio_voice_jobs"] = [job]
    try:
        jobs_tts.run(JobCtx(rt, "studio_voice_jobs", job, min_gap=0))
        raise AssertionError("harus gagal")
    except JobError as e:
        assert str(e) == "Mesin suara laptop gagal — website otomatis pakai cadangan Edge-TTS", e


@test
def t_tulis_ulang_url_render():
    pub = TMP / "render" / "public"
    fetched = []

    def fetch(p, dst):
        fetched.append(p)
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(b"isi")

    mp3 = base64.b64encode(b"ID3 palsu").decode()
    tl = {
        "music": {"src": "/api/studio/asset/sfx/trailer-pulse-sedang.mp3"},
        "brand": {"logo": "/api/studio/file?p=uploads%2Fu1%2Flogo%20baru.png"},
        "scenes": [{"layout": {"src": "/api/studio/file?p=uploads/u1/klip.mp4"}, "bg": {"media": "/api/studio/file?p=uploads%2Fu1%2Flogo%20baru.png"}}],
        "vo": {"lines": [{"src": f"data:audio/mpeg;base64,{mp3}"}, {"src": "/api/studio/file?p=vo/j1/s1.mp3"}], "full": "/api/studio/file?p=../rahasia"},
        "teks": "/api/studio/asset/sfx/../../.env",
    }
    out, missing = jobs_render.rewrite_timeline(tl, pub, REPO, fetch)
    assert out["music"]["src"] == "/public/sfx/trailer-pulse-sedang.mp3" and (pub / "sfx" / "trailer-pulse-sedang.mp3").exists()
    assert re.fullmatch(r"/public/st/[0-9a-f]{16}\.png", out["brand"]["logo"]), out["brand"]
    assert out["scenes"][0]["bg"]["media"] == out["brand"]["logo"] and fetched.count("uploads/u1/logo baru.png") == 1
    assert out["scenes"][0]["layout"]["src"].endswith(".mp4")
    assert re.fullmatch(r"/public/st/[0-9a-f]{16}\.mp3", out["vo"]["lines"][0]["src"])
    assert out["vo"]["full"] == "/api/studio/file?p=../rahasia" and out["teks"] == tl["teks"], "path aneh tidak boleh disentuh"
    for v in (out["music"]["src"], out["brand"]["logo"], out["vo"]["lines"][0]["src"]):
        assert re.fullmatch(r"/public/[\w./-]+", v) and ".." not in v  # lolos safeMediaSrc() di timeline.ts
    assert jobs_render.copy_assets(REPO, pub) >= 39 and (pub / "sfx" / "ui-pop.mp3").exists()
    sb = FakeSupa()
    sb.tables["studio_sfx"] = [
        {"id": "fs-123", "path": "sfx/fs-123.mp3", "cat": "whoosh", "tags": ["whoosh"], "dur": 1.2, "lufs": -18, "tp": -2, "hit": 0.1, "peak": 0.2, "use_for": "tes"},
        {"id": "fs-0", "path": "sfx/fs-0.mp3", "cat": "impact", "tags": [], "dur": 2, "lufs": -20, "tp": 0, "hit": 0, "peak": 0, "use_for": None},  # Freesound: tp 0
    ]
    sb.files["sfx/fs-123.mp3"] = sb.files["sfx/fs-0.mp3"] = b"mp3"
    ex = jobs_render.extra_sfx(sb, {"scenes": [{"sfx": [{"id": "fs-123", "at": 0}, {"id": "ui-pop", "at": 1}]}]}, pub, REPO)
    assert len(ex) == 1 and ex[0]["id"] == "fs-123" and re.fullmatch(r"/public/st/[0-9a-f]{16}\.mp3", ex[0]["src"]), ex
    ex0 = jobs_render.extra_sfx(sb, {"scenes": [{"sfx": [{"id": "fs-0", "at": 0}]}]}, pub, REPO)
    assert len(ex0) == 1 and ex0[0]["tp"] == 0.0 and ex0[0]["lufs"] == -20.0, "tp 0 (puncak skala penuh) jangan jadi -3"
    # logo brand bawaan: alamat tetap, file disalin ke <public>/brand/; kalau file repo tidak ada → logo dibuang
    pub2 = TMP / "render" / "public-logo"
    out2, miss2 = jobs_render.rewrite_timeline({"brand": {"logo": "/konten-logo.png"}, "scenes": [{"layout": {"src": "/brand/tws-logo.svg"}}]}, pub2, REPO, fetch)
    assert out2["brand"]["logo"] == "/konten-logo.png" and out2["scenes"][0]["layout"]["src"] == "/brand/tws-logo.svg" and not miss2, (out2, miss2)
    assert (pub2 / "brand" / "konten-logo.png").exists() and (pub2 / "brand" / "tws-logo.svg").exists()
    out3, miss3 = jobs_render.rewrite_timeline({"brand": {"logo": "/konten-logo.png"}, "scenes": []}, TMP / "render" / "public-x", TMP, fetch)
    assert out3["brand"]["logo"] is None and miss3 == ["/konten-logo.png"], (out3, miss3)
    assert (pub / "brand" / "konten-logo.png").exists() and (pub / "brand" / "tws-logo.svg").exists(), "copy_assets juga menyalin logo bawaan"
    # musik user hilang: proyek biasa → trailer bed cadangan, proyek teaser (sengaja tanpa musik latar) → tanpa musik
    def fetch404(p: str, dst: Path) -> None:
        raise RuntimeError("404")

    lagu = "/api/studio/file?p=uploads/u1/musik.mp3"
    out4, _ = jobs_render.rewrite_timeline({"music": {"src": lagu}, "scenes": [{"layout": {"kind": "title"}}]}, TMP / "render" / "public-m1", REPO, fetch404)
    out5, _ = jobs_render.rewrite_timeline({"music": {"src": lagu}, "scenes": [{"layout": {"kind": "teaser", "shot": "hook"}}]}, TMP / "render" / "public-m2", REPO, fetch404)
    assert out4["music"]["src"] == "bed" and out5["music"]["src"] == "none", (out4["music"], out5["music"])
    bundle = TMP / "render" / "bundle"
    n = jobs_render.stage_builtin_assets(REPO, bundle)
    assert n >= 40 and (bundle / "api" / "studio" / "asset" / "sfx" / "ui-pop.mp3").exists()
    assert jobs_render.parse_progress("Rendering frames ━━━━━━━━━━ 120/300") == ("render", 0.4)
    assert jobs_render.parse_progress("Encoding video   ━━━━ 30/300")[0] == "encode"
    assert jobs_render.parse_progress("Bundling 55%") == ("bundle", 0.55)
    assert jobs_render.parse_progress("Rendered 300/300, time remaining: 0s") == ("render", 1.0)
    return f"{len(fetched)} file storage diunduh, {n} aset disalin ke bundle"


@test
def t_mixing_ducking_loudnorm():
    sr = 48000
    g = mix.duck_curve([(1.0, 2.0)], 4.0, sr)
    near(20 * np.log10(g[int(1.6 * sr)]), mix.DUCK_DB, 0.5, "ducking saat VO")
    near(float(g[int(0.2 * sr)]), 1.0, 0.01, "musik normal sebelum VO")
    assert g[int(3.9 * sr)] > 0.95, "musik naik lagi setelah VO"
    kept = mix.limit_loud_sfx([{"t": 1.0, "cat": "boom"}, {"t": 1.1, "cat": "impact"}, {"t": 1.15, "cat": "braam"}, {"t": 1.12, "cat": "ui"}])
    assert [c["cat"] for c in kept] == ["boom", "impact", "ui"], kept
    music = (np.random.default_rng(2).standard_normal((sr * 4, 2)) * 0.1).astype(np.float32)
    out = mix.mix_tracks([(speechish(6, sr), 1.0)], music, [(speechish(1, sr), 0.5, -6)], 4.0, sr)
    assert out.shape == (sr * 4, 2)
    wav = ff.write_wav(TMP / "mix.wav", out, sr)
    vid = TMP / "tes.mp4"
    try:
        ff.run(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=4", "-i", str(wav), "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(vid)])
        vcodec = "h264"
    except ff.FFError:
        ff.run(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=4", "-i", str(wav), "-shortest", "-c:v", "mpeg4", "-c:a", "aac", str(vid)])
        vcodec = "mpeg4"
    final = TMP / "tes-final.mp4"
    mix.loudnorm_2pass(vid, final, video=True)
    y = ff.decode(final, sr, mono=False)
    near(meter.lufs(y, sr), -14, 1.0, "LUFS akhir")
    assert meter.true_peak_db(y, sr) <= -0.5
    pr = ff.probe(final)
    assert any(s.get("codec_type") == "video" for s in pr.get("streams", []))
    return f"video {vcodec} di-copy, {meter.lufs(y, sr):.1f} LUFS, TP {meter.true_peak_db(y, sr):.1f}"


@test
def t_tebak_kategori_sfx():
    cases = {
        ("Whoosh Fast Pass 03", ()): "whoosh",
        ("CINEMATIC_BOOM_Low_01", ()): "boom",
        ("Braam Dark Horn", ()): "braam",
        ("Riser Tension Build 8s", ()): "riser",
        ("Button Click Soft", ("UI Pack",)): "ui",
        ("Coin Drop Pickup", ()): "koin",
        ("Paper Page Turn", ()): "foley",
        ("Room Tone Office", ()): "ambience",
        ("Glitch Data Error", ()): "glitch",
        ("Magic Sparkle Chime", ()): "magic",
        ("Bass Drop Heavy", ()): "bass-drop",
        ("Impact Hit Metal", ()): "impact",
    }
    for (name, folders), want in cases.items():
        got, tags = sfxlib.guess(name, list(folders), 2.0)
        assert got == want, f"{name}: {got} (harus {want})"
        assert tags and all(re.fullmatch(r"[a-z0-9-]+", t) for t in tags), tags
    assert sfxlib.guess("xyz", [], 20)[0] == "ambience" and sfxlib.guess("xyz", [], 0.5)[0] == "ui"
    taken = {"whoosh-a"}
    assert sfxlib.unique_id("Whoosh A", taken) == "whoosh-a-2" and sfxlib.ID_RE.match(sfxlib.unique_id("Ünïcødé Ŝound!!", taken))
    f = SFX / "impact-chord.mp3"
    if f.exists():
        m = sfxlib.analyze(f, "impact")
        ref = next(x for x in json.loads((SFX / "sfx.json").read_text(encoding="utf-8")) if x["id"] == "impact-chord")
        near(m["lufs"], ref["lufs"], 1.5, "LUFS impact-chord vs sfx.json")
        near(m["dur"], ref["durasi_detik"], 0.1, "durasi impact-chord")
        return f"impact-chord: {m}"


@test
def t_transkrip_bank_suara():
    tr = seed.transcripts()
    assert len(tr) >= 2 and tr["referensi-alif-energik-10dtk"].startswith("Halo semuanya!"), tr.keys()
    assert {s["seed_key"] for s in seed.SEEDS} == {"alif-energik", "alif-tenang"}
    assert all((BANK / s["file"]).exists() for s in seed.SEEDS)


@test
def t_deteksi_isi_repo_model():
    def fake_st(p: Path, keys: list[str]) -> None:
        h = json.dumps({k: {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]} for k in keys}).encode()
        p.write_bytes(struct.pack("<Q", len(h)) + h + b"\0\0\0\0")

    a = TMP / "repoA"
    a.mkdir()
    for n in ("ve.safetensors", "s3gen.safetensors"):
        fake_st(a / n, ["x.weight"])
    fake_st(a / "t3_cfg.safetensors", ["text_emb.weight"])
    (a / "tokenizer.json").write_text("{}")
    f = cbe.scan(a)
    assert f["t3"].name == "t3_cfg.safetensors" and f["ve"] and f["s3gen"] and f["tok"] and not f["mtl"]
    b = TMP / "repoB"
    b.mkdir()
    fake_st(b / "model_indonesia.safetensors", ["t3.tfmr.layers.0.mlp.weight", "t3.text_emb.weight", "t3.speech_head.weight"])
    fake_st(b / "lain.safetensors", ["foo.bar"])
    f = cbe.scan(b)
    assert f["t3"] and f["t3"].name == "model_indonesia.safetensors" and not f["ve"], f
    c = TMP / "repoC"
    c.mkdir()
    fake_st(c / "t3_mtl23ls_v2.safetensors", ["text_emb.weight"])
    (c / "grapheme_mtl_merged_expanded_v1.json").write_text("{}")
    assert cbe.scan(c)["mtl"]
    try:
        import yaml  # noqa: F401

        from studio_worker.engines import pocket_engine as pe

        tpl = TMP / "tpl.yaml"
        tpl.write_text("weights_path: hf://kyutai/x/model.safetensors\nflow_lm:\n  lookup_table:\n    n_bins: 4000\n    tokenizer: tokenizers\n    tokenizer_path: hf://x/tok.json\nmimi:\n  dtype: float32\n")
        w = TMP / "pk.safetensors"
        fake_st(w, ["flow_lm.conditioner.embed.weight", "mimi.x"])
        h = json.loads(w.read_bytes()[8:-4])
        h["flow_lm.conditioner.embed.weight"]["shape"] = [5001, 1024]
        hb = json.dumps(h).encode()
        w.write_bytes(struct.pack("<Q", len(hb)) + hb + b"\0\0\0\0")
        out = pe.build_yaml(tpl, w, None, TMP)
        d = yaml.safe_load(out.read_text())
        assert d["weights_path"] == str(w) and d["flow_lm"]["lookup_table"]["n_bins"] == 5000, d
        return "chatterbox: standar / hanya-t3 / multilingual; pocket: config dirakit"
    except ImportError:
        return "chatterbox: standar / hanya-t3 / multilingual (pyyaml tidak ada → tes pocket dilewati)"


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
