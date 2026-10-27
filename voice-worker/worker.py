"""
voice-worker Studio Pro — jalan terus di laptop, mengerjakan antrian dari website SATU per SATU:
  studio_voice_jobs (tts / clean / beats) lalu studio_render_jobs (render MP4).
Jalankan: jalankan.bat (atau `.venv\\Scripts\\python worker.py`). Ctrl+C = berhenti setelah tugas ini, Ctrl+C lagi = berhenti sekarang.
"""
from __future__ import annotations

import json
import os
import platform
import signal
import sys
import threading
import time
from pathlib import Path

# pythonw.exe (Task Scheduler / pasang-otomatis.ps1, tanpa jendela): sys.stdout & sys.stderr = None → progress bar tqdm
# (unduh model HuggingFace, "Sampling" Chatterbox) crash "'NoneType' object has no attribute 'write'".
# Arahkan ke os.devnull & matikan progress bar SEBELUM library berat di-import.
if sys.stdout is None or sys.stderr is None:
    os.environ.setdefault("TQDM_DISABLE", "1")
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent))

from studio_worker import config  # noqa: E402  (harus pertama: batas thread & folder cache)

CFG = config.load()

from studio_worker import log as vlog  # noqa: E402

# log bersih (QUIET_LOG=1): peringatan library yang tidak penting & progress bar disenyapkan SEBELUM torch / transformers /
# chatterbox di-import (semuanya dimuat malas sesudah baris ini). Hanya proses worker — siapkan-model tetap menampilkan progres.
vlog.quiet(bool(getattr(CFG, "quiet_log", True)))

from studio_worker import VERSION, jobs_beats, jobs_clean, jobs_render, jobs_tts, seed  # noqa: E402
from studio_worker.asr import Asr  # noqa: E402
from studio_worker.engines import Engines  # noqa: E402
from studio_worker.jobctx import Cancelled, JobCtx, JobError, Runtime, owner_can_use_studio  # noqa: E402
from studio_worker.supa import Supa, SupaError  # noqa: E402

log = vlog.setup(CFG.logs)
VOICE, RENDER = "studio_voice_jobs", "studio_render_jobs"
RETRIED = "retried.json"  # di folder data: id job yang sudah diulang otomatis sekali
FAIL = {
    "tts": jobs_tts.FAIL_MSG,
    "clean": "Pembersihan rekaman gagal di laptop. Coba lagi sebentar lagi.",
    "beats": "Deteksi ketukan musik gagal di laptop.",
    "render": "Render di laptop gagal — coba render di browser dulu.",
}
REVOKED = "Akses Studio pemilik job sudah dicabut."
stop = threading.Event()
_hits = {"n": 0}
# cek antrian: cepat (1 dtk) selama 60 dtk sesudah job / klaim terakhir (job susulan dari website biasanya datang beruntun),
# lalu POLL_SEC, dan sesudah 30 menit menganggur cukup tiap max(POLL_SEC, 10) dtk
FAST_POLL_SEC, FAST_POLL_FOR = 1.0, 60.0
SLOW_POLL_SEC, SLOW_POLL_AFTER = 10.0, 30 * 60.0
# status unduhan model di latar (detak jantung info.models)
DL: dict = {"active": False, "names": [], "done": {}}


def on_sigint(signum, frame) -> None:  # noqa: ARG001
    _hits["n"] += 1
    if _hits["n"] == 1:
        log.info("Berhenti setelah tugas ini selesai… (tekan Ctrl+C sekali lagi untuk berhenti sekarang)")
        stop.set()
    else:
        raise KeyboardInterrupt


def lower_priority() -> None:
    """prioritas proses di bawah normal supaya bot WAHA tetap lancar"""
    try:
        if os.name == "nt":
            import ctypes

            ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x00004000)
        else:
            os.nice(5)
    except Exception:
        pass


def single_instance(path: Path):
    """cegah 2 worker jalan bersamaan di laptop yang sama (mis. Task Scheduler + dijalankan manual)"""
    f = open(path, "a+")
    try:
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return None
    return f


def gpu_info() -> dict:
    try:
        import torch

        if torch.cuda.is_available():
            p = torch.cuda.get_device_properties(0)
            cap = torch.cuda.get_device_capability(0)
            return {"gpu": torch.cuda.get_device_name(0), "vram_gb": round(p.total_memory / 1024**3, 1), "cuda": torch.version.cuda, "sm": f"{cap[0]}{cap[1]}", "torch": torch.__version__}
        return {"gpu": None, "vram_gb": None, "torch": torch.__version__}
    except Exception as e:
        return {"gpu": None, "vram_gb": None, "torch": f"tidak ada ({type(e).__name__})"}


class Heartbeat(threading.Thread):
    """detak jantung ke studio_workers tiap ±20 dtk (website menganggap worker mati kalau > 60 dtk)"""

    def __init__(self, rt: Runtime, base: dict):
        super().__init__(daemon=True, name="heartbeat")
        self.rt = rt
        self.base = base
        self.supa = Supa(CFG.supabase_url, CFG.service_key, CFG.worker_id, retries=2)
        self.wake = threading.Event()
        self._warned = 0.0

    def info(self) -> dict:
        eng = self.rt.engines
        return {
            **self.base,
            "engine": eng.planned() if eng else None,
            "engines": eng.status() if eng else {},
            "asr": self.rt.asr.device if self.rt.asr and self.rt.asr.model is not None else None,
            "render": bool(self.rt.render_ok),
            "versi": VERSION,
            # kecepatan mesin suara (website memperkirakan lama job yang masih antri), status model, mesin sudah dipanaskan
            "speed": speed_summary(self.rt),
            "models": models_brief(CFG),
            "warm": bool(getattr(self.rt, "warm", False)),
            # GPU yang benar-benar dipakai Chrome render (hasil cek sekali per sesi: NVIDIA / Intel / SwiftShader)
            "render_gpu": jobs_render.render_gpu_info(),
            **self.rt.status,
        }

    def run(self) -> None:
        while not stop.is_set():
            try:
                self.supa.heartbeat(self.info())
            except Exception as e:
                if time.time() - self._warned > 300:
                    log.warning("Detak ke website gagal (%s) — dicoba lagi otomatis.", str(e)[:150])
                    self._warned = time.time()
            self.wake.wait(CFG.heartbeat_sec)
            self.wake.clear()
        try:  # berhenti rapi → langsung tampil "mati" di website (last_seen lama)
            self.supa.update("studio_workers", {"id": f"eq.{CFG.worker_id}"}, {"last_seen": "2000-01-01T00:00:00Z", "info": {**self.info(), "status": "mati"}})
        except Exception:
            pass


def load_retried() -> list[str]:
    """id job yang sudah pernah diulang otomatis (kolom message tidak bisa dipakai: ditimpa claim & progres)"""
    try:
        ids = json.loads((CFG.data / RETRIED).read_text(encoding="utf-8"))
        return [str(x) for x in ids] if isinstance(ids, list) else []
    except (OSError, ValueError):
        return []


def save_retried(ids: list[str]) -> None:
    f = CFG.data / RETRIED
    try:
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(ids[-200:]), encoding="utf-8")  # cukup 200 terakhir
        os.replace(tmp, f)
    except OSError as e:
        log.warning("Catatan job yang sudah diulang tidak bisa disimpan: %s", e)


def recover_stale(rt: Runtime, idle: bool = False) -> None:
    """job 'proses' milik worker ini yang tidak sedang dikerjakan → diulang sekali, kedua kalinya ditandai gagal.
    Saat mulai: sisa sesi sebelumnya (laptop mati / crash). Saat menganggur (idle=True): tanda gagal yang tidak terkirim
    karena internet putus, atau klaim yang balasannya hilang (worker hanya mengerjakan satu job, jadi saat menganggur pasti yatim)."""
    retried = load_retried()
    for table in (VOICE, RENDER):
        try:
            rows = rt.supa.select(table, select="id", status="eq.proses", worker=f"eq.{CFG.worker_id}")
        except SupaError as e:
            log.warning("Cek job tertunda gagal: %s", e)
            continue
        for r in rows:
            rid = str(r["id"])
            again = rid in retried
            if again:
                why = "koneksi laptop terputus" if idle else "laptop berhenti"
                patch = {"status": "gagal", "message": f"Gagal: {why} saat memproses (sudah diulang sekali)."}
            else:
                why = "koneksi laptop pulih" if idle else "laptop menyala lagi"
                patch = {"status": "antri", "progress": 0, "worker": None, "message": f"Diulang otomatis setelah {why}"}
            try:
                got = rt.supa.update(table, {"id": f"eq.{rid}", "status": "eq.proses"}, patch)
            except SupaError as e:
                log.warning("Job tertunda %s belum bisa diubah: %s", rid, e)
                continue
            if got:  # catat sudah diulang (yang sudah gagal dihapus dari catatan)
                retried = [x for x in retried if x != rid] + ([] if again else [rid])
                save_retried(retried)
            log.info("Job tertunda %s → %s", r["id"], patch["status"])


def poll_wait(now: float, last_active: float, poll_sec: float) -> float:
    """jeda cek antrian berikutnya (detik): 1 dtk selama 60 dtk sesudah job / klaim terakhir, lalu POLL_SEC, lalu max(POLL_SEC, 10)
    sesudah 30 menit menganggur (fungsi murni: waktu dari pemanggil)"""
    idle = max(0.0, now - last_active)
    if idle < FAST_POLL_FOR:
        return min(FAST_POLL_SEC, poll_sec)
    if idle < SLOW_POLL_AFTER:
        return poll_sec
    return max(poll_sec, SLOW_POLL_SEC)


# ---------------------------------------------------------------- model & pemanasan (thread latar, tidak menahan antrian)
def models_mod():
    """studio_worker/models.py (unduh & cek model lokal); belum ada di cabang lama → None (semua dianggap siap)"""
    try:
        import importlib

        return importlib.import_module("studio_worker.models")  # lewat sys.modules (tes bisa memasang models palsu)
    except ImportError:
        return None


_MB: dict = {"t": 0.0, "v": None}


def models_brief(cfg, max_age: float = 60.0) -> dict | None:
    """status model untuk detak jantung (info.models), disimpan sebentar (cek file tiap 60 dtk cukup); yang sedang diunduh ditandai"""
    now = time.monotonic()
    if _MB["v"] is None or now - _MB["t"] > max_age:
        m = models_mod()
        v = None
        if m is not None:
            try:
                v = dict(m.status_brief(cfg))
            except Exception as e:  # status model tidak boleh mengganggu detak
                log.debug("status model gagal dibaca: %s", e)
        _MB.update(t=now, v=v)
    v = dict(_MB["v"]) if isinstance(_MB["v"], dict) else None
    if v is not None and DL["active"]:
        for n in DL["names"]:
            if v.get(n) != "siap":
                v[n] = "sedang diunduh"
    return v


def speed_summary(rt: Runtime) -> dict | None:
    sp = getattr(rt, "speed", None)
    try:
        return sp.summary() if sp is not None else None
    except Exception:
        return None


class _LogFn:
    """logger yang juga bisa dipanggil sebagai fungsi: models.prepare(log=…) boleh memakai log("…") atau log.info("…")"""

    def __init__(self, lg):
        self._lg = lg

    def __call__(self, msg, *args) -> None:
        self._lg.info(str(msg), *args)

    def __getattr__(self, k):
        return getattr(self._lg, k)


ABSENT = {
    "chatterbox": "model Chatterbox belum diunduh",
    "pocket": "model pocket-tts belum diunduh",
    "whisper": "model cek ucapan (faster-whisper) belum diunduh",
    "deepfilter": "model DeepFilterNet3 belum diunduh",
    "utmos": "penilai kealamian UTMOS belum diunduh",
}


def set_absent(rt: Runtime, names: list[str], auto: bool) -> None:
    """model yang belum ada di laptop → komponennya dilewati dulu (TIDAK diunduh di tengah job): Chatterbox → pocket-tts / Edge di
    website, faster-whisper → cek audio saja, DeepFilterNet → pembersih ffmpeg, UTMOS → pilih versi dari kejelasan + nada"""
    tail = " — diunduh otomatis di latar" if auto else " — jalankan siapkan-model (lihat README)"
    for n in names:
        why = ABSENT.get(n, f"model {n} belum diunduh") + tail
        # tanda "belum diunduh" (bukan "rusak"): faster-whisper, DeepFilterNet & UTMOS tetap mengecek file lagi tiap 60 dtk / sesudah
        # unduhan selesai, jadi model yang diunduh lewat SIAPKAN-MODEL.bat saat worker hidup juga langsung dipakai
        try:
            now = time.monotonic()
            if n in ("chatterbox", "pocket") and rt.engines is not None and n in CFG.engine_order:
                rt.engines.mark_down(n, why)
            elif n == "whisper" and rt.asr is not None and rt.asr.model is None:
                rt.asr.error = why
                if hasattr(rt.asr, "_missing_at"):
                    rt.asr._missing_at = now
            elif n == "deepfilter":
                from studio_worker import clean

                if getattr(clean, "_DF", None) is None:
                    clean._DF_ERR = why
                    miss = getattr(clean, "_DF_MISSING", None)
                    if isinstance(miss, dict):
                        miss.update(on=True, at=now)
            elif n == "utmos":
                from studio_worker import natural

                off = getattr(natural, "_not_downloaded", None) or getattr(natural, "_disable", None)
                if callable(off):
                    with getattr(natural, "_lock", threading.RLock()):
                        off() if off is getattr(natural, "_not_downloaded", None) else off(why)
        except Exception as e:
            log.debug("tanda %s belum siap gagal: %s", n, e)


def set_ready(rt: Runtime, names: list[str]) -> None:
    """model selesai diunduh → tanda gagal / mati komponennya dihapus supaya dipakai lagi (job berikutnya / pemanasan)"""
    for n in names:
        try:
            if n in ("chatterbox", "pocket") and rt.engines is not None:
                with rt.engines.lock:
                    rt.engines._down.pop(n, None)
            elif n == "whisper" and rt.asr is not None and rt.asr.model is None:
                fn = getattr(rt.asr, "refresh", None)
                if callable(fn):
                    fn()
                rt.asr.error = None
            elif n == "deepfilter":
                from studio_worker import clean

                if getattr(clean, "_DF", None) is None:
                    clean._DF_ERR = None
                    miss = getattr(clean, "_DF_MISSING", None)
                    if isinstance(miss, dict):
                        miss.update(on=False)
            elif n == "utmos":
                from studio_worker import natural

                fn = getattr(natural, "refresh", None)
                if callable(fn):
                    fn()
                elif isinstance(getattr(natural, "_mos", None), dict):
                    with natural._lock:
                        natural._mos["off"] = None
        except Exception as e:
            log.debug("reset %s gagal: %s", n, e)
    _MB["v"] = None  # status model dibaca ulang di detak berikutnya


def _num(d: dict, *keys: str) -> float | None:
    for k in keys:
        v = d.get(k)
        if isinstance(v, (int, float)) and v == v and v > 0:
            return float(v)
    return None


def warm_engine(rt: Runtime, skip: set[str]) -> str | None:
    """muat mesin suara pertama yang bisa (+ pemanasan Engines.warmup bila ada) & catat waktu muat / kecepatannya. Balikan nama mesin."""
    eng = rt.engines
    for name in CFG.engine_order:
        if name in skip or eng.is_down(name):
            continue
        try:
            was = name in eng.loaded()
        except Exception:
            was = False
        t0 = time.monotonic()
        try:
            w = getattr(eng, "warmup", None)
            info = w(name) if callable(w) else None
            if not callable(w):
                eng.get(name)
        except Exception as e:  # EngineDown sudah dicatat pengelola mesin → coba mesin berikutnya
            log.warning("Pemanasan mesin %s gagal: %s", name, str(e)[:200])
            continue
        took = time.monotonic() - t0
        sp = getattr(rt, "speed", None)
        if sp is not None:
            d = info if isinstance(info, dict) else {}
            gen = _num(d, "wall_sec", "gen_sec", "wall")
            audio0, ratio = _num(d, "audio_sec", "audio"), _num(d, "ratio")
            if gen is None and audio0 and ratio:  # mesin cepat: ratio = detik proses per detik suara (n versi sekaligus)
                gen = audio0 * ratio
            load = _num(d, "load_sec", "load")
            if load is None and not was and _num(d, "sec"):  # waktu pemanasan sendiri bukan waktu muat model
                load = max(0.0, took - float(d["sec"]))
            if load is None and not was:
                load = max(0.0, took - (gen or 0.0))
            if load:
                sp.record_load(name, load)
            audio = _num(d, "audio_sec", "audio")
            if audio and gen:
                sp.record(name, audio, gen, int(d.get("takes") or d.get("n") or 1))
        log.info("Mesin %s siap & dipanaskan (%.0f dtk) — job berikutnya tidak perlu menunggu muat model.", name, took)
        return name
    return None


def warm_utmos(rt: Runtime) -> None:
    """penilai kealamian UTMOS dimuat sekali di latar — HANYA kalau filenya sudah ada di laptop (tidak pernah mengunduh di sini)"""
    if not getattr(CFG, "natural_mos", True):
        return
    m = models_mod()
    if m is None:
        return  # cabang lama tanpa models.py: UTMOS dimuat saat pertama dibutuhkan seperti dulu
    try:
        if not m.utmos_ready(CFG):
            return
        from studio_worker import natural

        natural.configure(True, CFG.models / "torch-hub")
        fn = getattr(natural, "preload", None) or getattr(natural, "warm", None) or getattr(natural, "warmup", None)
        if callable(fn):
            fn()
        else:
            natural._predictor()
    except Exception as e:
        log.warning("Penilai kealamian UTMOS belum bisa dimuat (%s) — versi dipilih dari kejelasan + nada.", str(e)[:200])


def warm_up(rt: Runtime, skip: set[str], engines: bool = True) -> None:
    """pemanasan sekali: mesin suara → faster-whisper → UTMOS. Kunci mesin dipegang selama pemanasan: job yang datang menunggu
    (pesannya "Menyiapkan mesin suara…") dan tidak memuat model yang sama dua kali."""
    lock = getattr(rt.engines, "lock", None)
    rt.loading = True
    try:
        if lock is not None:
            lock.acquire()
        try:
            if engines:
                rt.warm = (warm_engine(rt, skip) is not None) or bool(rt.warm)
            if "whisper" not in skip and rt.asr is not None:
                try:
                    _ = rt.asr.available
                except Exception as e:
                    log.warning("faster-whisper belum bisa dimuat: %s", str(e)[:200])
            if "utmos" not in skip:
                warm_utmos(rt)
        finally:
            if lock is not None:
                lock.release()
    finally:
        rt.loading = False


def download_bg(rt: Runtime, hb: "Heartbeat", names: list[str], warm: bool) -> None:
    """unduh model yang kurang (models.prepare: cepat, bisa dilanjutkan) di thread latar; selesai → komponennya dipakai lagi"""
    m = models_mod()
    if m is None:
        return
    DL.update(active=True, names=list(names))
    hb.wake.set()
    t0 = time.time()
    log.info("Model belum lengkap (%s) — diunduh di latar. Job tetap jalan tanpa model itu dulu.", ", ".join(names))
    try:
        got = m.prepare(CFG, names=list(names), log=_LogFn(vlog.get("unduh")))
    except Exception as e:
        log.warning("Unduh model di latar gagal: %s — dicoba lagi saat worker dinyalakan ulang (atau jalankan siapkan-model).", str(e)[:300])
        got = {}
    finally:
        DL["active"] = False
    got = got if isinstance(got, dict) else {}
    ready = [n for n in names if got.get(n) == "siap"]
    DL["done"] = dict(got)
    bad = {n: s for n, s in got.items() if s != "siap"}
    if bad:
        log.warning("Sebagian model belum terunduh: %s", "; ".join(f"{n}: {s}" for n, s in bad.items())[:500])
    if ready:
        log.info("Model siap dipakai (%s) dalam %.0f dtk.", ", ".join(ready), time.time() - t0)
        set_ready(rt, ready)
        if warm:
            warm_up(rt, skip=set(names) - set(ready), engines=any(n in ready for n in ("chatterbox", "pocket")))
    hb.wake.set()


def prepare_bg(rt: Runtime, hb: "Heartbeat") -> list[str]:
    """
    saat worker mulai: cek model lokal (cepat, hanya cek file) → yang belum ada ditandai dilewati SEBELUM job / isi bank suara jalan,
    lalu di thread latar (antrian tetap dicek): unduh yang kurang (AUTO_DOWNLOAD) & pemanasan mesin (PRELOAD). Balikan model yang kurang.
    """
    missing: list[str] = []
    m = models_mod()
    if m is not None:
        try:
            missing = [n for n in m.missing(CFG) if isinstance(n, str)]
        except Exception as e:
            log.warning("Cek model lokal gagal: %s", str(e)[:200])
    auto = bool(getattr(CFG, "auto_download", True))
    if missing:
        set_absent(rt, missing, auto)
        if auto:
            threading.Thread(target=download_bg, args=(rt, hb, missing, bool(CFG.preload)), daemon=True, name="unduh-model").start()
        else:
            log.warning("Model belum diunduh: %s (AUTO_DOWNLOAD=0). Jalankan siapkan-model — sementara komponen itu dilewati.", ", ".join(missing))

    def go() -> None:
        log.info("Menyiapkan mesin suara di latar… (job yang datang menunggu sebentar)")
        warm_up(rt, skip=set(missing))
        hb.wake.set()

    if CFG.preload:
        threading.Thread(target=go, daemon=True, name="pemanasan").start()
    return missing


def keep_absent(rt: Runtime) -> None:
    """mesin yang modelnya MASIH diunduh tetap ditandai belum siap (tanda gagal biasa kedaluwarsa 30 menit, unduhan bisa lebih lama)"""
    if not DL["active"] or rt.engines is None:
        return
    for n in DL["names"]:
        if n in ("chatterbox", "pocket") and n in CFG.engine_order and not rt.engines.is_down(n) and n not in rt.engines.loaded():
            rt.engines.mark_down(n, ABSENT[n] + " — masih diunduh di latar")


def handle(rt: Runtime, hb: Heartbeat, table: str, job: dict) -> None:
    ctx = JobCtx(rt, table, job)
    kind = job.get("kind", "tts") if table == VOICE else "render"
    rt.status = {"status": kind, "job": job["id"]}
    hb.wake.set()
    t0 = time.time()
    log.info("Mulai job %s %s", kind, job["id"])
    try:
        if not owner_can_use_studio(rt.supa, job.get("created_by")):  # akses dicabut admin setelah job masuk antrian
            raise JobError(REVOKED)
        if kind == "tts":
            jobs_tts.run(ctx)
        elif kind == "clean":
            jobs_clean.run(ctx)
        elif kind == "beats":
            jobs_beats.run(ctx)
        elif kind == "render":
            jobs_render.run(ctx)
        else:
            raise JobError(f"Jenis tugas tidak dikenal: {kind}")
        log.info("Job %s %s selesai (%.0f dtk)", kind, job["id"], time.time() - t0)
    except Cancelled:
        log.info("Job %s dibatalkan dari website.", job["id"])
    except JobError as e:
        log.warning("Job %s %s gagal: %s", kind, job["id"], e)
        ctx.fail(str(e))
    except KeyboardInterrupt:
        ctx.requeue("Laptop dihentikan sementara — akan dilanjutkan otomatis")
        raise
    except Exception:
        log.exception("Job %s %s error tak terduga", kind, job["id"])
        ctx.fail(FAIL.get(kind, "Tugas gagal di laptop."))
    finally:
        ctx.close()  # pengirim progres latar berhenti (patch yang belum terkirim dibuang)
        rt.status = {"status": "siap", "job": None}
        hb.wake.set()


def main() -> int:
    missing = CFG.missing()
    if missing:
        log.error("Isi dulu %s di file voice-worker\\.env (contoh: .env.example). Worker berhenti.", ", ".join(missing))
        return 2
    bad = config.url_problem(CFG.supabase_url)
    if bad:
        log.error("%s Buka: notepad .env — lalu jalankan lagi. Worker berhenti.", bad)
        return 2
    lock = single_instance(CFG.data / "worker.lock")
    if lock is None:
        log.error("Worker sudah jalan di laptop ini (cek jendela lain / Task Scheduler). Yang ini berhenti.")
        return 0
    lower_priority()
    signal.signal(signal.SIGINT, on_sigint)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, on_sigint)  # type: ignore[attr-defined]

    log.info("voice-worker %s mulai — id %s, %d thread CPU, data di %s", VERSION, CFG.worker_id, CFG.cpu_threads, CFG.data)
    if getattr(CFG, "preload_old_default", False):
        log.info("PRELOAD=0 di .env adalah bawaan lama → sekarang mesin suara dipanaskan di latar saat mulai (matikan: PRELOAD=mati).")
    rt = Runtime(cfg=CFG, supa=Supa(CFG.supabase_url, CFG.service_key, CFG.worker_id))
    rt.engines = Engines(CFG)
    rt.asr = Asr(CFG)
    try:  # catatan kecepatan mesin suara: batas waktu per baris, jumlah versi, perkiraan selesai (disimpan antar sesi)
        from studio_worker.speed import Speed

        rt.speed = Speed(CFG.data / "speed.json")
    except ImportError:
        rt.speed = None
    rt.render_ok, why = jobs_render.check(CFG)
    log.info("Render MP4 di laptop: %s", "siap" if rt.render_ok else f"tidak aktif ({why})")
    g = gpu_info()
    log.info("GPU: %s", f"{g['gpu']} ({g['vram_gb']} GB, CUDA {g.get('cuda')})" if g.get("gpu") else f"tidak ada — mesin suara pakai CPU ({g.get('torch')})")
    base = {**g, "os": f"{platform.system()} {platform.release()}", "host": platform.node(), "id": CFG.worker_id}
    hb = Heartbeat(rt, base)
    hb.start()

    try:
        recover_stale(rt)
        # cek model lokal, unduh yang kurang & panaskan mesin di LATAR — antrian langsung dicek (job yang datang saat pemanasan
        # menunggu kunci mesin; model yang belum ada dilewati, tidak pernah diunduh di tengah job)
        prepare_bg(rt, hb)
        seed.seed_bank(rt)
        log.info("Menunggu antrian dari website… (Ctrl+C untuk berhenti)")
        last_err = 0.0
        last_check = last_sweep = last_active = time.time()
        while not stop.is_set():
            try:
                job = rt.supa.claim(VOICE)
                table = VOICE
                if job is None and rt.render_ok:
                    job, table = rt.supa.claim(RENDER), RENDER
            except SupaError as e:
                if time.time() - last_err > 60:
                    log.warning("Tidak bisa cek antrian (%s). Internet mati? Dicoba lagi otomatis.", str(e)[:150])
                    last_err = time.time()
                stop.wait(min(60, CFG.poll_sec * 3))
                continue
            if job:
                keep_absent(rt)
                handle(rt, hb, table, job)
                last_active = time.time()
                continue
            if time.time() - last_sweep > 120:  # job 'proses' milik laptop ini padahal sedang menganggur = yatim → diulang / gagal
                recover_stale(rt, idle=True)
                last_sweep = time.time()
            if time.time() - last_check > 600:  # cek ulang kesiapan render & lepas model kalau lama menganggur (IDLE_UNLOAD_MIN)
                rt.render_ok, _ = jobs_render.check(CFG)
                rt.engines.maybe_idle_unload()
                if not rt.engines.loaded():
                    rt.warm = False
                last_check = time.time()
            stop.wait(poll_wait(time.time(), last_active, CFG.poll_sec))
    except KeyboardInterrupt:
        log.info("Dihentikan.")
    finally:
        stop.set()
        hb.wake.set()
        hb.join(timeout=10)
        rt.engines.unload()
        log.info("voice-worker berhenti. Sampai jumpa!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
