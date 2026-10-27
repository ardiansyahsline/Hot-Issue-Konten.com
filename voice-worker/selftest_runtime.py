"""
Tes mandiri ALUR WORKER (tanpa GPU / model / internet — Supabase, mesin suara, model & jam dipalsukan):
  .venv\\Scripts\\python selftest_runtime.py            (semua tes)
  .venv\\Scripts\\python selftest_runtime.py polling    (hanya tes yang namanya mengandung kata itu)
Yang dites: pengirim progres latar (tidak menahan job, menggabung, jeda min), jalur batal, format perkiraan sisa (· sisa ±N),
unggah paralel + error, jadwal cek antrian (jam palsu), isi detak jantung, unduh model & pemanasan di latar, job tts dengan ETA +
unggah paralel + ringkasan log, perkiraan sisa render, decode wav langsung (sampel identik), filter log bersih.
"""
from __future__ import annotations

import http.server
import importlib
import io
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import types
import warnings
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
TMP = Path(tempfile.mkdtemp(prefix="vw-selftest-rt-"))
# worker.py dibaca sebagai modul: data & log ke folder sementara, log bersih TIDAK dinyalakan otomatis (dites sendiri di bawah)
os.environ["DATA_DIR"] = str(TMP / "data")
os.environ["QUIET_LOG"] = "0"

from studio_worker import config  # noqa: E402

config.apply_thread_limits(2)

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

from studio_worker import ff, jobctx, jobs_render, jobs_tts  # noqa: E402
from studio_worker import log as vlog  # noqa: E402
from studio_worker import text as T  # noqa: E402
from studio_worker.jobctx import Cancelled, JobCtx, Runtime  # noqa: E402
from studio_worker.speed import Speed  # noqa: E402
from studio_worker.supa import Supa, UploadPool  # noqa: E402

BANK = HERE / "bank-suara"
results: list[tuple[str, bool, str]] = []
TESTS: list = []
# website (lib/studio) membaca akhiran perkiraan sisa dengan pola ini — HARUS cocok persis
WEB_ETA = re.compile(r"\s·\s*sisa\s*±\s*(\d+)\s*(dtk|mnt)\s*$")


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


def wait_until(cond, timeout: float = 5.0, step: float = 0.01) -> bool:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(step)
    return bool(cond())


class Fast:
    """jeda pengirim progres dipersingkat selama tes (aslinya 1 dtk)"""

    def __init__(self, gap: float = 0.15, cancel: float | None = None):
        self.gap, self.cancel = gap, cancel

    def __enter__(self):
        self.old = (jobctx.SEND_GAP, jobctx.CANCEL_CHECK_SEC)
        jobctx.SEND_GAP = self.gap
        if self.cancel is not None:
            jobctx.CANCEL_CHECK_SEC = self.cancel
        return self

    def __exit__(self, *a):
        jobctx.SEND_GAP, jobctx.CANCEL_CHECK_SEC = self.old


# ---------------------------------------------------------------- palsuan
class MemSupa:
    """Supabase di memori (tabel + storage), thread-safe; tiap request bisa diperlambat (`lag` detik) seperti internet laptop"""

    def __init__(self, lag: float = 0.0, up_lag: float = 0.0):
        self.tables: dict[str, list[dict]] = {}
        self.files: dict[str, bytes] = {}
        self.lag, self.up_lag = lag, up_lag
        self.lock = threading.Lock()
        self.patches: list[tuple[float, dict]] = []  # (waktu, patch) ke tabel job
        self.uploads: list[tuple[float, float, str]] = []  # (mulai, selesai, path)
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
        if self.lag:
            time.sleep(self.lag)
        with self.lock:
            rows = [dict(r) for r in self.tables.get(table, []) if self._match(r, params)]
        return rows[: int(params.get("limit", 1000))]

    def update(self, table, filters, patch):
        if self.lag:
            time.sleep(self.lag)
        out = []
        with self.lock:
            for r in self.tables.get(table, []):
                if self._match(r, filters):
                    r.update(patch)
                    out.append(dict(r))
            if table.endswith("_jobs"):
                self.patches.append((time.monotonic(), dict(patch)))
        return out

    def insert(self, table, rows, **kw):
        return []

    def upload(self, path, data, content_type, timeout=0):
        t0 = time.monotonic()
        if self.up_lag:
            time.sleep(self.up_lag)
        b = data.read_bytes() if isinstance(data, Path) else data
        with self.lock:
            self.files[path] = b
            self.uploads.append((t0, time.monotonic(), path))
        return path

    def download(self, path, dest=None, timeout=0):
        b = self.files[path]
        if dest is not None:
            Path(dest).parent.mkdir(parents=True, exist_ok=True)
            Path(dest).write_bytes(b)
        return b


def job_row(supa: MemSupa, jid: str = "j1", table: str = "studio_voice_jobs", **kw) -> dict:
    row = {"id": jid, "status": "proses", "progress": 0, "message": "", **kw}
    supa.tables.setdefault(table, []).append(row)
    return row


def rt_of(supa, **kw) -> Runtime:
    return Runtime(cfg=kw.pop("cfg", SimpleNamespace()), supa=supa, **kw)  # type: ignore[arg-type]


def speechish(words: int, sr: int = 24000, seed_: int = 0) -> np.ndarray:
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


class SlowEngine:
    name = "chatterbox"
    sr = 24000
    label = "Bank suara · Chatterbox (GPU laptop)"
    credit = None

    def __init__(self, sleep: float = 0.0):
        self.sleep = sleep
        self.calls = 0
        self.times: list[tuple[float, float, str]] = []

    def synth(self, text, ref, st, seed):
        self.calls += 1
        t0 = time.monotonic()
        if self.sleep:
            time.sleep(self.sleep)
        y = np.concatenate([np.zeros(2400, np.float32), speechish(max(2, len(text.split())), self.sr, seed), np.zeros(4800, np.float32)])
        self.times.append((t0, time.monotonic(), text))
        return y


class FakeEngines:
    def __init__(self, eng, load_sec: float = 0.0):
        self.eng = eng
        self.lock = threading.RLock()
        self._loaded: list[str] = []
        self._down: dict = {}
        self.load_sec = load_sec
        self.gets = 0

    def order(self, pref):
        return ["chatterbox"]

    def is_down(self, name):
        return name in self._down

    def loaded(self):
        return list(self._loaded)

    def get(self, name):
        with self.lock:
            self.gets += 1
            if name not in self._loaded:
                time.sleep(self.load_sec)
                self._loaded.append(name)
            return self.eng

    def mark_down(self, name, reason):
        self._down[name] = (time.time(), reason)

    def planned(self):
        return "chatterbox"

    def status(self):
        return {"loaded": self.loaded(), "down": {k: v[1] for k, v in self._down.items()}}


def cfg_tts(sub: str, **kw) -> SimpleNamespace:
    d = TMP / sub
    for s in ("cache", "tmp", "models", "logs"):
        (d / s).mkdir(parents=True, exist_ok=True)
    return SimpleNamespace(cache=d / "cache", tmp=d / "tmp", models=d / "models", logs=d / "logs", data=d, takes=2, df_atten_db=18.0, worker_id="tes", natural_mos=False, upload_workers=3, **kw)


def bank(supa: MemSupa) -> dict:
    vid = "33333333-3333-3333-3333-333333333333"
    supa.files[f"voices/{vid}/clean.wav"] = (BANK / "referensi-alif-energik-10dtk.wav").read_bytes()
    v = {"id": vid, "name": "Alif", "consent": True, "clean_path": f"voices/{vid}/clean.wav", "status": "siap", "quality": {"saran": "ok", "ver": 2}, "updated_at": "t0"}
    supa.tables["studio_voices"] = [v]
    return v


_worker = None


def worker_mod():
    """worker.py sebagai modul (CFG dari env tes: DATA_DIR sementara, tanpa .env)"""
    global _worker
    if _worker is None:
        _worker = importlib.import_module("worker")
    return _worker


# ---------------------------------------------------------------- tes
@test
def t_progres_tidak_menahan_dan_digabung():
    sb = MemSupa(lag=0.25)  # tiap request ke Supabase 0,25 dtk (internet laptop)
    row = job_row(sb)
    with Fast(gap=0.2):
        ctx = JobCtx(rt_of(sb), "studio_voice_jobs", row, min_gap=0)
        t0 = time.perf_counter()
        for i in range(60):
            ctx.progress(i / 100, f"Membuat suara kalimat {i}…")
        spent = time.perf_counter() - t0
        assert spent < 0.05, f"progress() menahan job {spent:.3f} dtk (harusnya langsung kembali)"
        assert wait_until(lambda: row["progress"] == 0.59 and ctx._pending is None and not ctx._busy, 5), (row, ctx._pending)
        sends = [p for _, p in sb.patches]
        assert 1 <= len(sends) <= 4, f"60 progres harus digabung jadi sedikit kiriman, dapat {len(sends)}"
        assert sends[-1] == {"progress": 0.59, "message": "Membuat suara kalimat 59…"}, sends[-1]
        ts = [t for t, _ in sb.patches]
        gaps = [b - a for a, b in zip(ts, ts[1:])]
        assert all(g >= 0.2 - 0.02 for g in gaps), f"jeda antar kiriman < jeda minimal: {gaps}"
        # patch tanpa pesan baru tidak menghapus pesan lama (digabung, yang baru menang per kolom)
        ctx.progress(0.7, "A")
        ctx.progress(0.71)
        assert wait_until(lambda: row["progress"] == 0.71 and not ctx._busy and ctx._pending is None, 5)
        assert row["message"] == "A", row
        ctx.done({"result": {"ok": 1}}, "Selesai")
    assert row["status"] == "selesai" and row["message"] == "Selesai"
    return f"60 progres: {spent * 1000:.1f} ms di thread job, {len(sends)} kiriman (lag 0,25 dtk/request)"


@test
def t_selesai_membuang_progres_yang_tertunda():
    sb = MemSupa(lag=0.2)
    row = job_row(sb)
    with Fast(gap=0.5):
        ctx = JobCtx(rt_of(sb), "studio_voice_jobs", row, min_gap=0)
        ctx.progress(0.1, "satu")  # langsung dikirim (sedang di jalan saat done dipanggil)
        time.sleep(0.05)
        ctx.progress(0.5, "dua")  # masih menunggu jeda → harus dibuang oleh done()
        ctx.done({"result": {"x": 1}}, "Selesai")
        n = len(sb.patches)
        time.sleep(0.8)
    assert len(sb.patches) == n, "tidak boleh ada kiriman progres sesudah done()"
    assert row["status"] == "selesai" and row["progress"] == 1 and row["message"] == "Selesai", row
    assert not any(p.get("message") == "dua" for _, p in sb.patches), sb.patches
    assert ctx._thread is None or not ctx._thread.is_alive()
    # fail / requeue juga menghentikan pengirim dulu
    row2 = job_row(sb, "j2")
    with Fast(gap=0.5):
        c2 = JobCtx(rt_of(sb), "studio_voice_jobs", row2, min_gap=0)
        c2.progress(0.2, "x")
        c2.progress(0.3, "y")
        c2.fail("Gagal: tes")
    assert row2["status"] == "gagal" and row2["message"] == "Gagal: tes", row2
    return "done/fail: pengirim berhenti, patch tertunda dibuang, status akhir benar"


@test
def t_jalur_batal():
    sb = MemSupa()
    row = job_row(sb)
    with Fast(gap=0.05, cancel=0.2):
        ctx = JobCtx(rt_of(sb), "studio_voice_jobs", row, min_gap=0)
        ctx.progress(0.1, "jalan")
        assert wait_until(lambda: row["progress"] == 0.1)
        ctx.check_cancel()  # masih proses
        row["status"] = "batal"  # dibatalkan dari website
        ctx.progress(0.2, "lanjut")  # kiriman ini tidak mengenai baris → tanda batal
        assert wait_until(lambda: ctx._cancel is not None, 3), "pengirim harus menandai batal"
        for fn in (lambda: ctx.check_cancel(), lambda: ctx.progress(0.3, "x")):
            try:
                fn()
                raise AssertionError("harus Cancelled")
            except Cancelled as e:
                assert str(e) == "batal", e
        try:
            ctx.done({}, "Selesai")
            raise AssertionError("done() pada job batal harus Cancelled")
        except Cancelled:
            pass
        assert row["status"] == "batal"
        # tanpa progres: check_cancel bertanya ke server kalau status belum terkonfirmasi > CANCEL_CHECK_SEC
        row3 = job_row(sb, "j3")
        c3 = JobCtx(rt_of(sb), "studio_voice_jobs", row3, min_gap=0)
        c3.check_cancel()
        row3["status"] = "batal"
        c3.check_cancel()  # baru saja terkonfirmasi → tidak bertanya (hemat request antar baris)
        time.sleep(0.25)
        try:
            c3.check_cancel()
            raise AssertionError("harus Cancelled sesudah bertanya ke server")
        except Cancelled:
            pass
        # jaringan putus saat cek (tanpa force) → dianggap belum batal; force=True → error diteruskan
        row4 = job_row(sb, "j4")
        c4 = JobCtx(rt_of(sb), "studio_voice_jobs", row4, min_gap=0)

        def boom(*a, **k):
            raise ConnectionError("internet putus")

        c4.supa = SimpleNamespace(select=boom, update=boom)
        time.sleep(0.25)
        c4.check_cancel()
        try:
            c4.check_cancel(force=True)
            raise AssertionError("force harus meneruskan error")
        except ConnectionError:
            pass
    return "patch kosong → batal di titik aman; done() pada job batal → Cancelled; jaringan putus ≠ batal"


@test
def t_format_perkiraan_sisa():
    w = jobctx.with_eta
    cases = {
        (37, "Membuat suara kalimat 2 dari 5…"): "Membuat suara kalimat 2 dari 5… · sisa ±40 dtk",
        (3, "x"): "x · sisa ±5 dtk",
        (59.9, "x"): "x · sisa ±60 dtk",
        (130, "Merender gambar… 40%"): "Merender gambar… 40% · sisa ±2 mnt",
        (600, "x"): "x · sisa ±10 mnt",
    }
    for (sec, msg), want in cases.items():
        got = w(msg, sec)
        assert got == want, (sec, msg, got)
        m = WEB_ETA.search(got)
        assert m and m.group(2) in ("dtk", "mnt"), got
        assert WEB_ETA.sub("", got) == msg, "pola website harus membuang akhiran persis"
    assert w("x · sisa ±40 dtk", 130) == "x · sisa ±2 mnt", "akhiran lama diganti, bukan ditumpuk"
    assert w("x · sisa ±40 dtk", None) == "x"
    assert "·" in w("a", 1) and "·" in w("a", 1)
    # ETA dihitung saat DIKIRIM (dikurangi waktu sejak eta() dipasang)
    sb = MemSupa()
    row = job_row(sb)
    with Fast(gap=0.05):
        ctx = JobCtx(rt_of(sb), "studio_voice_jobs", row, min_gap=0)
        ctx.eta(100)
        ctx._eta = (100.0, time.monotonic() - 45)  # 45 dtk lalu
        ctx.progress(0.3, "Membuat suara kalimat 1 dari 3…")
        assert wait_until(lambda: "sisa" in (row.get("message") or ""))
        assert row["message"] == "Membuat suara kalimat 1 dari 3… · sisa ±55 dtk", row["message"]
        ctx.eta(None)
        ctx.progress(0.4, "Tanpa perkiraan")
        assert wait_until(lambda: row.get("message") == "Tanpa perkiraan")
        ctx.close()
    # perkiraan sisa render: linear sesudah ≥ 10%
    assert jobs_render.render_left(30, 0.05) is None
    near = jobs_render.render_left(30, 0.25)
    assert near is not None and abs(near - 90) < 1e-6, near
    assert jobs_render.render_left(100, 1.0) == 0.0
    return "37→'±40 dtk', 130→'±2 mnt', cocok pola website; ETA dikurangi waktu berjalan; render linear ≥10%"


@test
def t_unggah_paralel_dan_error():
    sb = MemSupa(up_lag=0.3)
    t0 = time.perf_counter()
    with UploadPool(sb, workers=3) as pool:
        for i in range(6):
            pool.submit(f"vo/j/{i}.mp3", f"isi{i}".encode(), "audio/mpeg")
        enc = []
        pool.submit("vo/j/full.mp3", lambda: (enc.append(threading.current_thread().name), b"full")[1], "audio/mpeg")
        got = pool.wait()
    wall = time.perf_counter() - t0
    assert got == [f"vo/j/{i}.mp3" for i in range(6)] + ["vo/j/full.mp3"], got
    assert sb.files["vo/j/full.mp3"] == b"full" and enc and enc[0].startswith("unggah"), "data callable dijalankan di thread unggah"
    assert wall < 1.3, f"7 unggahan × 0,3 dtk dengan 3 sekaligus harus ±0,9 dtk, dapat {wall:.2f}"
    # error: semua ditunggu dulu, error PERTAMA (urut submit) dilempar; check() melempar tanpa menunggu yang masih jalan

    class Bad(MemSupa):
        def upload(self, path, data, content_type, timeout=0):
            if "rusak" in path:
                raise RuntimeError(f"gagal {path}")
            return super().upload(path, data, content_type)

    sb2 = Bad(up_lag=0.2)
    pool = UploadPool(sb2, workers=2)
    pool.submit("a/rusak1.mp3", b"x", "audio/mpeg")
    pool.submit("a/ok.mp3", b"x", "audio/mpeg")
    pool.submit("a/rusak2.mp3", b"x", "audio/mpeg")
    assert wait_until(lambda: pool.pending() <= 1, 3)
    try:
        pool.check()
        raise AssertionError("check() harus melempar error unggahan yang sudah gagal")
    except RuntimeError as e:
        assert "rusak1" in str(e)
    try:
        pool.wait()
        raise AssertionError("wait() harus melempar")
    except RuntimeError as e:
        assert "rusak1" in str(e), e
    assert "a/ok.mp3" in sb2.files and "a/rusak2.mp3" not in sb2.files
    pool.close()
    return f"7 unggahan 0,3 dtk paralel 3 → {wall:.2f} dtk (berurutan ±2,1 dtk); error pertama dilempar"


class _Store(http.server.BaseHTTPRequestHandler):
    got: dict = {}
    lock = threading.Lock()
    conns: set = set()

    def do_POST(self):  # noqa: N802
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n)
        time.sleep(0.15)
        with self.lock:
            self.got[self.path] = body
            self.conns.add(self.client_address)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, *a):
        pass


@test
def t_klien_supabase_asli_aman_antar_thread():
    for k in ("NO_PROXY", "no_proxy"):  # server lokal: jangan lewat proxy sistem
        os.environ[k] = ",".join(x for x in (os.environ.get(k), "127.0.0.1", "localhost") if x)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Store)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    try:
        url = f"http://127.0.0.1:{srv.server_address[1]}"
        cli = Supa(url, "kunci-tes", "tes")
        files = {}
        for i in range(8):
            f = TMP / f"up{i}.mp3"
            f.write_bytes(os.urandom(2000 + i))
            files[f"vo/j/{i}.mp3"] = f
        t0 = time.perf_counter()
        with UploadPool(cli, workers=4) as pool:
            for p, f in files.items():
                pool.submit(p, f, "audio/mpeg")
            pool.wait()
        wall = time.perf_counter() - t0
        for p, f in files.items():
            assert _Store.got[f"/storage/v1/object/studio/{p}"] == f.read_bytes(), p
        cli.close()
    finally:
        srv.shutdown()
    assert wall < 8 * 0.15 * 0.75, f"unggahan lewat klien asli harus paralel ({wall:.2f} dtk)"
    return f"8 unggahan lewat satu httpx.Client dari 4 thread: isi utuh, {wall:.2f} dtk (berurutan ≥1,2 dtk), {len(_Store.conns)} koneksi"


@test
def t_jadwal_cek_antrian_jam_palsu():
    w = worker_mod()
    pw = w.poll_wait
    t = 1_000_000.0
    assert pw(t, t, 5) == 1.0 and pw(t + 59.9, t, 5) == 1.0, "1 dtk selama 60 dtk sesudah job / klaim"
    assert pw(t + 60, t, 5) == 5 and pw(t + 1799, t, 5) == 5, "lalu POLL_SEC"
    assert pw(t + 1800, t, 5) == 10 and pw(t + 86400, t, 5) == 10, "sesudah 30 menit menganggur → 10 dtk"
    assert pw(t + 1800, t, 20) == 20, "POLL_SEC > 10 tetap dipakai"
    assert pw(t + 10, t, 1) == 1.0
    assert pw(t - 5, t, 5) == 1.0, "jam mundur tidak bikin jeda aneh"
    # simulasi menganggur sesudah satu job: jumlah cek antrian (tiap cek = 1–2 request ke Supabase)
    def count(sec: float) -> int:
        now, n = t, 0
        while now < t + sec:
            now += pw(now, t, 5)
            n += 1
        return n

    n1, n8 = count(3600), count(8 * 3600)
    assert n1 < 3600 / 5 and n8 < 8 * 3600 / 5, (n1, n8)
    return f"1 dtk → POLL_SEC → 10 dtk; menganggur 1 jam: {n1} cek (dulu 720), 8 jam: {n8} (dulu 5760); job susulan terambil ≤1 dtk"


class FakeModels(types.ModuleType):
    """studio_worker.models palsu (kontrak agen UNDUH)"""

    def __init__(self, missing: list[str], delay: float = 0.3, fail: tuple[str, ...] = ()):
        super().__init__("studio_worker.models")
        self._missing = list(missing)
        self.delay = delay
        self.fail = fail
        self.prepared: list = []
        self.logged: list[str] = []

    def missing(self, cfg):
        return list(self._missing)

    def prepare(self, cfg, names=None, log=None):
        names = list(names or self._missing)
        if log is not None:
            log("mulai unduh %d model" % len(names))
            log.info("info juga bisa")
        time.sleep(self.delay)
        self.prepared.append(names)
        out = {n: ("gagal: tes" if n in self.fail else "siap") for n in names}
        self._missing = [n for n in self._missing if out.get(n) != "siap"]
        return out

    def status_brief(self, cfg):
        return {n: ("belum diunduh" if n in self._missing else "siap") for n in ("chatterbox", "whisper", "deepfilter", "utmos")}

    def utmos_ready(self, cfg):
        return "utmos" not in self._missing


class WarmEngines(FakeEngines):
    def __init__(self, eng, load_sec=0.3):
        super().__init__(eng, load_sec)
        self.warmed: list[str] = []

    def warmup(self, name):
        t0 = time.monotonic()
        self.get(name)
        self.warmed.append(name)
        return {"load_sec": round(time.monotonic() - t0, 3), "audio_sec": 2.0, "wall_sec": 1.0, "takes": 3}


class FakeAsr:
    def __init__(self):
        self.model = None
        self.error = None
        self.device = None
        self.loads = 0
        self.lock = threading.Lock()

    @property
    def available(self):
        if self.model is None and self.error is None:
            self.loads += 1
            time.sleep(0.05)
            self.model, self.device = object(), "palsu"
        return self.model is not None


@test
def t_unduh_dan_pemanasan_di_latar():
    w = worker_mod()
    from studio_worker import clean, natural

    fm = FakeModels(["whisper", "deepfilter", "utmos"], delay=0.4)
    sys.modules["studio_worker.models"] = fm
    old = (w.CFG.preload, w.CFG.engine_order, getattr(w.CFG, "natural_mos", True))
    old_auto = getattr(w.CFG, "auto_download", None)
    natural.reset()
    clean_old = (clean._DF, clean._DF_ERR)
    utmos_loads: list[int] = []
    natural.preload = lambda: utmos_loads.append(1)  # type: ignore[attr-defined]  (UTMOS asli butuh torch)
    try:
        w.CFG.preload, w.CFG.engine_order = True, ["chatterbox", "pocket"]
        sp = Speed(TMP / "speed-rt.json")
        rt = Runtime(cfg=w.CFG, supa=MemSupa(), engines=WarmEngines(SlowEngine(), load_sec=0.3), asr=FakeAsr(), speed=sp)  # type: ignore[arg-type]
        hb = SimpleNamespace(wake=threading.Event())
        t0 = time.perf_counter()
        missing = w.prepare_bg(rt, hb)
        spent = time.perf_counter() - t0
        assert spent < 0.15, f"persiapan tidak boleh menahan antrian ({spent:.2f} dtk)"
        assert missing == ["whisper", "deepfilter", "utmos"], missing
        # yang belum diunduh langsung dilewati (job yang datang tidak menunggu / tidak mengunduh)
        assert rt.asr.error and "belum diunduh" in rt.asr.error, rt.asr.error
        assert clean._DF_ERR and "belum diunduh" in clean._DF_ERR
        assert natural.mos_status().startswith("tidak dipakai"), natural.mos_status()
        assert wait_until(lambda: w.DL["active"], 2)
        info_dl = w.models_brief(w.CFG, max_age=0)
        assert info_dl["whisper"] == "sedang diunduh" and info_dl["chatterbox"] == "siap", info_dl
        # job yang datang saat pemanasan menunggu kunci mesin (bukan memuat model kedua kali)
        assert wait_until(lambda: rt.loading, 2)
        time.sleep(0.02)
        tj = time.perf_counter()
        rt.engines.get("chatterbox")
        waited = time.perf_counter() - tj
        assert rt.engines.gets >= 2 and rt.engines.loaded() == ["chatterbox"]
        assert wait_until(lambda: rt.warm and not w.DL["active"] and rt.asr.model is not None, 5), (rt.warm, w.DL, rt.asr.error)
        assert rt.engines.warmed[0] == "chatterbox"
        assert sp.load_sec("chatterbox") and sp.measured("chatterbox"), sp.data
        assert abs(sp.ratio("chatterbox", 3) - 0.5) < 1e-6, sp.data
        # selesai unduh → tanda dihapus, komponen dipakai lagi
        assert fm.prepared == [["whisper", "deepfilter", "utmos"]]
        assert rt.asr.error is None and rt.asr.loads == 1
        assert clean._DF_ERR is None
        assert natural._mos["off"] is None, natural._mos
        assert wait_until(lambda: utmos_loads == [1], 3), "UTMOS dimuat sekali sesudah filenya ada"
        assert w.models_brief(w.CFG, max_age=0)["utmos"] == "siap"
        # mesin yang modelnya belum ada → ditandai mati (website pakai cadangan), lalu hidup lagi setelah unduhan selesai
        w.CFG.engine_order = ["chatterbox"]
        fm2 = FakeModels(["chatterbox"], delay=0.3)
        sys.modules["studio_worker.models"] = fm2
        rt2 = Runtime(cfg=w.CFG, supa=MemSupa(), engines=WarmEngines(SlowEngine(), load_sec=0.05), asr=FakeAsr(), speed=Speed(None))  # type: ignore[arg-type]
        w.prepare_bg(rt2, hb)
        assert rt2.engines.is_down("chatterbox"), rt2.engines.status()
        assert wait_until(lambda: not w.DL["active"] and rt2.engines.loaded() == ["chatterbox"], 5), rt2.engines.status()
        assert not rt2.engines.is_down("chatterbox") and rt2.warm
        # AUTO_DOWNLOAD=0 → tidak mengunduh, hanya dilewati
        fm3 = FakeModels(["utmos"], delay=0.1)
        sys.modules["studio_worker.models"] = fm3
        w.CFG.auto_download = False
        natural.reset()
        w.CFG.preload = False
        rt3 = Runtime(cfg=w.CFG, supa=MemSupa(), engines=WarmEngines(SlowEngine()), asr=FakeAsr(), speed=None)  # type: ignore[arg-type]
        w.prepare_bg(rt3, hb)
        time.sleep(0.3)
        assert fm3.prepared == [] and natural.mos_status().startswith("tidak dipakai") and rt3.engines.loaded() == []
    finally:
        sys.modules.pop("studio_worker.models", None)
        w.CFG.preload, w.CFG.engine_order, w.CFG.natural_mos = old
        if old_auto is None:
            w.CFG.__dict__.pop("auto_download", None)
        else:
            w.CFG.auto_download = old_auto
        del natural.preload
        clean._DF, clean._DF_ERR = clean_old
        natural.reset()
        w._MB["v"] = None
    return f"persiapan {spent * 1000:.0f} ms di thread utama; job menunggu kunci mesin {waited:.2f} dtk; unduh selesai → ASR/DF/UTMOS aktif lagi"


@test
def t_isi_detak_jantung():
    w = worker_mod()
    sp = Speed(TMP / "speed-hb.json")
    sp.record("chatterbox", 6.5, 13.0, 3)
    sp.record_load("chatterbox", 21.0)
    rt = Runtime(cfg=w.CFG, supa=MemSupa(), engines=FakeEngines(SlowEngine()), asr=FakeAsr(), speed=sp, warm=True)  # type: ignore[arg-type]
    hb = w.Heartbeat(rt, {"id": "tes", "gpu": None})
    info = hb.info()
    assert info["warm"] is True and info["speed"]["engines"]["chatterbox"]["ratio"]["3"] == 2.0, info["speed"]
    assert info["speed"]["engines"]["chatterbox"]["load"] == 21.0 and info["speed"]["chars_per_sec"] == 14.5
    assert info["models"] is None, "tanpa models.py → None (website menganggap tidak diketahui)"
    assert info["status"] == "siap" and info["engine"] == "chatterbox"
    sys.modules["studio_worker.models"] = FakeModels(["utmos"])
    try:
        w._MB["v"] = None
        info2 = hb.info()
        assert info2["models"] == {"chatterbox": "siap", "whisper": "siap", "deepfilter": "siap", "utmos": "belum diunduh"}, info2["models"]
    finally:
        sys.modules.pop("studio_worker.models", None)
        w._MB["v"] = None
    import json

    json.dumps(info2)  # harus bisa dikirim sebagai JSON
    hb.supa.close()
    return f"speed {info['speed']['engines']['chatterbox']['ratio']}, models {info2['models']}, warm {info['warm']}"


def _tts_job(sb, v, jid, lines, takes=2):
    job = {"id": jid, "kind": "tts", "voice_id": v["id"], "engine": "auto", "lines": lines, "settings": {"takes": takes}, "status": "proses"}
    sb.tables.setdefault("studio_voice_jobs", []).append(job)
    return job


class _Cap(logging.Handler):
    def __init__(self):
        super().__init__()
        self.msgs: list[str] = []

    def emit(self, record):
        self.msgs.append(record.getMessage())


@test
def t_job_tts_perkiraan_sisa_dan_unggah_paralel():
    sb = MemSupa(lag=0.05, up_lag=0.25)
    v = bank(sb)
    eng = SlowEngine(sleep=0.15)
    sp = Speed(TMP / "speed-tts.json")
    rt = Runtime(cfg=cfg_tts("tts1"), supa=sb, engines=FakeEngines(eng, load_sec=0.4), asr=None, speed=sp)  # type: ignore[arg-type]
    lines = [{"id": f"s{i}", "scene_id": f"s{i}", "text": t, "start": None} for i, t in enumerate(["Masih kerja manual setiap hari?", "Tenang, ada cara yang jauh lebih gampang.", "Coba sekarang juga."], 1)]
    job = _tts_job(sb, v, "job-eta", lines)
    cap = _Cap()
    jobs_tts.log.addHandler(cap)
    try:
        with Fast(gap=0.1):
            ctx = JobCtx(rt, "studio_voice_jobs", job, min_gap=0)
            t0 = time.perf_counter()
            jobs_tts.run(ctx)
            wall = time.perf_counter() - t0
    finally:
        jobs_tts.log.removeHandler(cap)
    assert job["status"] == "selesai", job.get("message")
    r = job["result"]
    assert [x["path"] for x in r["lines"]] == [f"vo/job-eta/s{i}.mp3" for i in (1, 2, 3)]
    for p in (r["full_path"], r["srt_path"], *[x["path"] for x in r["lines"]]):
        assert p in sb.files and len(sb.files[p]) > 50, p
    msgs = [p.get("message") for _, p in sb.patches if p.get("message")]
    with_eta = [m for m in msgs if WEB_ETA.search(m)]
    assert with_eta, msgs
    assert any(m.startswith("Membuat suara kalimat") and WEB_ETA.search(m) for m in msgs), msgs
    assert msgs[-1].startswith("Suara selesai dibuat") and not WEB_ETA.search(msgs[-1]), msgs[-1]
    # perkiraan awal masuk akal: muat mesin belum diukur (35 dtk bawaan) + 3 baris; sesudah job kecepatan & waktu muat tercatat
    assert ctx.est0 and ctx.est0 > 35, ctx.est0
    assert sp.measured("chatterbox") and sp.load_sec("chatterbox"), sp.data
    summ = [m for m in cap.msgs if m.startswith("Job selesai:")]
    assert summ and re.match(r"Job selesai: 3 kalimat, \d+ dtk suara, \d+ dtk proses \(perkiraan awal \d+ dtk\)$", summ[0]), summ or cap.msgs[-5:]
    # unggahan mp3 baris 1 berjalan BERSAMAAN dengan mesin membuat baris 2 (dulu: mesin menunggu unggahan selesai)
    ups = {p: (a, b) for a, b, p in sb.uploads}
    a1, b1 = ups["vo/job-eta/s1.mp3"]
    l2 = [(x, y) for x, y, t in eng.times if t.startswith("Tenang")]
    assert l2 and any(max(a1, x) < min(b1, y) for x, y in l2), (a1, b1, l2)
    fa, fb = ups["vo/job-eta/full.mp3"], ups["vo/job-eta/full.srt"]
    assert fa[0] < fb[1] and fb[0] < fa[1], "full.mp3 & srt diunggah bersamaan"
    # job kedua (semua baris dari cache): perkiraan kecil, tanpa muat mesin
    job2 = _tts_job(sb, v, "job-eta-2", lines[:2] + [{**lines[2], "start": 9.0}])
    with Fast(gap=0.1):
        ctx2 = JobCtx(rt, "studio_voice_jobs", job2, min_gap=0)
        jobs_tts.run(ctx2)
    assert job2["status"] == "selesai" and ctx2.cache_hits == 3 and ctx2.est0 < 10, (ctx2.cache_hits, ctx2.est0)
    return f"3 baris: {wall:.2f} dtk, perkiraan awal {ctx.est0:.0f} dtk, {len(with_eta)} pesan ber-ETA ('{with_eta[0]}'); {summ[0]}"


@test
def t_make_line_baru_dapat_speed():
    """make_line versi mesin cepat menerima speed= → dikirim; kecepatan tidak dicatat dobel oleh synth_job"""
    sb = MemSupa()
    v = bank(sb)
    eng = SlowEngine()
    sp = Speed(None)
    rt = Runtime(cfg=cfg_tts("tts2"), supa=sb, engines=FakeEngines(eng), asr=None, speed=sp)  # type: ignore[arg-type]
    orig = jobs_tts.make_line
    seen = []

    def make_line(engine, ln, ref, st, asr, work, on_step=None, speed=None):
        seen.append(speed)
        return orig(engine, ln, ref, st, asr, work, on_step)

    jobs_tts.make_line = make_line
    try:
        job = _tts_job(sb, v, "job-sp", [{"id": "a", "scene_id": "a", "text": "Satu dua tiga empat.", "start": 0}])
        jobs_tts.run(JobCtx(rt, "studio_voice_jobs", job, min_gap=0))
    finally:
        jobs_tts.make_line = orig
    assert job["status"] == "selesai" and seen == [sp], seen
    assert not sp.measured("chatterbox"), "make_line baru yang mencatat kecepatan — synth_job tidak boleh mencatat dobel"
    return "speed=rt.speed terkirim ke make_line baru; make_line lama tetap dipanggil tanpa speed"


@test
def t_job_tts_batal_antar_baris():
    sb = MemSupa()
    v = bank(sb)
    eng = SlowEngine(sleep=0.05)
    rt = Runtime(cfg=cfg_tts("tts3"), supa=sb, engines=FakeEngines(eng), asr=None, speed=Speed(None))  # type: ignore[arg-type]
    lines = [{"id": f"b{i}", "scene_id": "x", "text": f"Kalimat nomor {i} untuk tes batal.", "start": None} for i in range(1, 6)]
    job = _tts_job(sb, v, "job-batal", lines, takes=1)
    orig = jobs_tts.make_line
    n = [0]

    def make_line(*a, **k):
        k.pop("speed", None)  # make_line lama tidak menerima speed
        n[0] += 1
        if n[0] == 2:
            job["status"] = "batal"  # dibatalkan dari website saat baris ke-2 dibuat
        return orig(*a, **k)

    jobs_tts.make_line = make_line
    ctx = JobCtx(rt, "studio_voice_jobs", job, min_gap=0)
    try:
        with Fast(gap=0.02, cancel=0.0):
            try:
                jobs_tts.run(ctx)
                raise AssertionError("harus Cancelled")
            except Cancelled:
                pass
    finally:
        jobs_tts.make_line = orig
        ctx.close()
    assert n[0] <= 3, f"berhenti di batas baris berikutnya, dibuat {n[0]} dari 5"
    assert not (rt.cfg.tmp / "tts-job-batal").exists(), "folder kerja dibersihkan"
    assert job["status"] == "batal"
    return f"dibatalkan saat baris 2 → berhenti sesudah {n[0]} baris dari 5"


@test
def t_decode_wav_langsung_identik():
    rnd = np.random.default_rng(3)
    out = []
    for sub, ch in (("PCM_16", 1), ("PCM_16", 2), ("FLOAT", 1)):
        y = (rnd.standard_normal((48000 * 2, ch)) * 0.2).clip(-1, 1).astype(np.float32)
        f = TMP / f"d-{sub}-{ch}.wav"
        sf.write(str(f), y if ch > 1 else y[:, 0], 48000, subtype=sub)
        a = ff.decode(f, 48000, mono=ch == 1)
        p = ff.run(["-i", str(f), "-vn", "-ac", str(ch), "-ar", "48000", "-f", "f32le", "-acodec", "pcm_f32le", "-"], binary=True)
        b = np.frombuffer(p.stdout, dtype=np.float32)
        b = b if ch == 1 else b.reshape(-1, 2)
        assert a.shape == b.shape and np.array_equal(a, b), (sub, ch, a.shape, b.shape)
        out.append(f"{sub}/{ch}ch")
    f24 = TMP / "d24.wav"
    sf.write(str(f24), (rnd.standard_normal(24000) * 0.1).astype(np.float32), 24000, subtype="PCM_16")
    assert ff._direct_wav(f24, 48000, 1) is None, "beda sample rate → tetap ffmpeg (resample)"
    assert ff._direct_wav(TMP / "d-PCM_16-2.wav", 48000, 1) is None, "stereo diminta mono → tetap ffmpeg (downmix)"
    assert ff.decode(f24, 48000).shape == (48000,)
    return "sampel identik dengan ffmpeg: " + ", ".join(out)


_QUIET_SCRIPT = r"""
import logging, os, sys, warnings
sys.path.insert(0, sys.argv[1])
from studio_worker import log as vlog
on = sys.argv[2] == "1"
vlog.quiet(on)
log = vlog.setup(__import__("pathlib").Path(sys.argv[3]))
def warn(msg, cat, mod, fn="x.py"):
    warnings.warn_explicit(msg, cat, fn, 1, module=mod, registry={})
warn("torch.nn.utils.weight_norm is deprecated", FutureWarning, "torch.nn.utils.weight_norm")
warn("pkg_resources is deprecated as an API", UserWarning, "perth.perth_net")
warn("LoRACompatibleLinear is deprecated", FutureWarning, "chatterbox.models.s3gen.matcha.transformer")
warn("In 2.9, torchaudio.load will use torchcodec", UserWarning, "studio_worker.clean")
warn("PySoundFile failed. Trying audioread instead.", UserWarning, "librosa.core.audio")
warn("set_audio_backend has been deprecated", DeprecationWarning, "df.io")
warn("PENTING-KODE-KITA", UserWarning, "studio_worker.jobs_tts")
logging.getLogger("chatterbox.models.t3.inference.alignment_stream_analyzer").warning("forcing EOS token, long_tail=True")
logging.getLogger("chatterbox.models.t3.inference.alignment_stream_analyzer").warning("\U0001F6A8 Detected 2x repetition of token 42")
logging.getLogger("chatterbox.models.t3.t3").warning("✅ EOS token detected! Stopping generation at step 120")
logging.warning("Reference mel length is not equal to 2 * reference token length.")
logging.getLogger("transformers.models.llama").warning("LlamaModel is using LlamaSdpaAttention, but ... does not support `output_attentions=True`")
logging.getLogger("chatterbox.models.s3gen.flow").error("PENTING-ERROR-LIBRARY")
log.warning("PENTING-PERINGATAN-WORKER: forcing EOS token kata ini tetap tampil karena dari worker")
vlog.get("tts").error("PENTING-ERROR-WORKER")
print("ENV", os.environ.get("TQDM_DISABLE"), os.environ.get("HF_HUB_DISABLE_PROGRESS_BARS"), os.environ.get("TRANSFORMERS_VERBOSITY"))
"""


@test
def t_log_bersih_yang_disenyapkan_vs_tetap():
    script = TMP / "quiet_probe.py"
    script.write_text(_QUIET_SCRIPT, encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if k not in ("TQDM_DISABLE", "HF_HUB_DISABLE_PROGRESS_BARS", "TRANSFORMERS_VERBOSITY", "PYTHONWARNINGS")}
    outs = {}
    for on in ("1", "0"):
        logs = TMP / f"qlog{on}"
        p = subprocess.run([sys.executable, str(script), str(HERE), on, str(logs)], capture_output=True, text=True, env=env, timeout=120, encoding="utf-8")
        assert p.returncode == 0, p.stderr[-2000:]
        filelog = "".join(f.read_text(encoding="utf-8") for f in logs.glob("*.log"))
        outs[on] = (p.stdout + p.stderr + filelog, p.stdout)
    quiet, loud = outs["1"][0], outs["0"][0]
    noisy = ["weight_norm", "pkg_resources", "LoRACompatibleLinear", "torchcodec", "PySoundFile", "set_audio_backend", "Detected 2x repetition", "EOS token detected", "Reference mel length", "SdpaAttention"]
    for s in noisy:
        assert s not in quiet, f"QUIET_LOG=1 masih menampilkan: {s}"
    assert "forcing EOS token, long_tail" not in quiet
    for s in ("PENTING-KODE-KITA", "PENTING-ERROR-LIBRARY", "PENTING-PERINGATAN-WORKER", "PENTING-ERROR-WORKER"):
        assert s in quiet, f"QUIET_LOG=1 menyembunyikan yang penting: {s}"
    assert "ENV 1 1 error" in outs["1"][1], outs["1"][1]
    # QUIET_LOG=0: semua tampil lagi & progress bar tidak dimatikan
    for s in ["weight_norm", "pkg_resources", "forcing EOS token, long_tail", "Detected 2x repetition", "Reference mel length", "PENTING-KODE-KITA"]:
        assert s in loud, f"QUIET_LOG=0 harus menampilkan: {s}"
    assert "ENV None None None" in outs["0"][1], outs["0"][1]
    hidden = sum(1 for s in noisy if s in loud)
    return f"QUIET_LOG=1: {len(noisy)} pesan library disenyapkan, 4 pesan penting tetap; QUIET_LOG=0: {hidden} tampil lagi; TQDM/HF progress hanya mati di worker"


@test
def t_preload_bawaan_dan_env_lama():
    cases = {
        "lama (salinan .env.example dulu)": ("# muat model suara saat worker mulai (1) atau saat job pertama (0)\r\nPRELOAD=0\r\n", (True, True)),
        "PRELOAD=0 sendiri": ("# saya matikan\nPRELOAD=0\n", (False, False)),
        "PRELOAD=mati": ("# muat model suara saat worker mulai (1) atau saat job pertama (0)\nPRELOAD=mati\n", (False, False)),
        "kosong → bawaan 1": ("POLL_SEC=5\n", (True, False)),
    }
    got = {}
    keep = {k: os.environ.get(k) for k in ("PRELOAD", "UPLOAD_WORKERS", "QUIET_LOG")}
    try:
        for name, (txt, want) in cases.items():
            for k in keep:
                os.environ.pop(k, None)
            f = TMP / f"env-{len(got)}.env"
            f.write_text(txt + "UPLOAD_WORKERS=5\n", encoding="utf-8")
            c = config.load(f)
            got[name] = (c.preload, c.preload_old_default)
            assert got[name] == want, (name, got[name], want)
            assert c.upload_workers == 5 and c.quiet_log is True
    finally:
        for k, v in keep.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    # mesin yang modelnya MASIH diunduh tetap ditandai belum siap walau tanda gagal lama kedaluwarsa
    w = worker_mod()
    rt = Runtime(cfg=w.CFG, supa=MemSupa(), engines=FakeEngines(SlowEngine()))  # type: ignore[arg-type]
    w.DL.update(active=True, names=["chatterbox"])
    try:
        w.keep_absent(rt)
        assert rt.engines.is_down("chatterbox") and "masih diunduh" in rt.engines._down["chatterbox"][1]
    finally:
        w.DL.update(active=False, names=[])
    return "; ".join(f"{k}: PRELOAD={'1' if v[0] else '0'}" for k, v in got.items())


@test
def t_worker_menyenyapkan_sebelum_library_diimport():
    """worker.py memanggil vlog.quiet() sebelum modul job (dan torch/transformers) di-import"""
    src = (HERE / "worker.py").read_text(encoding="utf-8")
    q = src.index("vlog.quiet(")
    for mod in ("from studio_worker import VERSION", "from studio_worker.engines import", "from studio_worker.asr import"):
        assert src.index(mod) > q, mod
    assert src.index("CFG = config.load()") < q
    assert not re.search(r"^\s*import torch", src[:q], re.M)
    return "quiet() dipanggil tepat sesudah config.load()"


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
