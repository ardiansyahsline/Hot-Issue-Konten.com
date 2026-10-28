"""
voice-worker Studio Pro — jalan terus di laptop, mengerjakan antrian dari website SATU per SATU:
  studio_voice_jobs (tts / clean / beats) lalu studio_render_jobs (render MP4).
Jalankan: jalankan.bat (atau `.venv\\Scripts\\python worker.py`). Ctrl+C = berhenti setelah tugas ini, Ctrl+C lagi = berhenti sekarang.
"""
from __future__ import annotations

import atexit
import json
import os
import platform
import re
import signal
import subprocess
import sys
import threading
import time
from collections import deque
from pathlib import Path

# pythonw.exe (Task Scheduler / pasang-otomatis.ps1, tanpa jendela): sys.stdout & sys.stderr = None → progress bar tqdm
# (unduh model HuggingFace, "Sampling" Chatterbox) crash "'NoneType' object has no attribute 'write'".
# Arahkan ke os.devnull & matikan progress bar SEBELUM library berat di-import.
NO_CONSOLE = sys.stdout is None or sys.stderr is None  # tanpa jendela konsol → proses anak unduhan juga tanpa jendela
if NO_CONSOLE:
    os.environ.setdefault("TQDM_DISABLE", "1")
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent))

from studio_worker import config  # noqa: E402  (harus pertama: batas thread & folder cache)

# .env lama (RENDER_CONCURRENCY=2 bawaan lama → auto) dirapikan di main() SESUDAH kunci satu-instance; di-import tes → .env tidak disentuh
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
# unduhan model di latar (detak jantung info.models / info.loading): `names` = yang BELUM selesai (urut), `now` = yang sedang diunduh
# proses anak, `pct` = persen terakhir dari baris progresnya, `proc` = proses anak itu (dihentikan saat worker berhenti)
DL: dict = {"active": False, "names": [], "done": {}, "now": None, "pct": {}, "proc": None}
DL_LOG_SEC = 15.0  # baris progres unduhan latar di log worker paling sering tiap 15 dtk
SIAPKAN = Path(__file__).resolve().parent / "siapkan_model.py"
ENGINE_NAMES = ("chatterbox", "pocket")
# "sedang membuat suara": dipegang handle() selama job berjalan — pemanasan sesudah unduhan latar menunggu job selesai dulu
BUSY = threading.Event()
# pemanasan sedang MEMUAT / memanaskan mesin suara (bagian mesin saja, bukan whisper / UTMOS) → detak info.loading
WARMING = threading.Event()


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
            # kecepatan mesin suara (website memperkirakan lama job yang masih antri), status model, keadaan NYATA mesin suara:
            # warm = mesin yang akan dipakai job berikutnya sudah dimuat; loading = mesin suara sedang disiapkan (dimuat /
            # dipanaskan di latar, atau modelnya masih diunduh di latar) — website: "menyiapkan…" hanya kalau loading
            "speed": speed_summary(self.rt),
            "models": models_brief(CFG),
            "warm": engine_warm(self.rt),
            "loading": engine_loading(self.rt),
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
        for n in list(DL["names"]):
            if v.get(n) != "siap":  # yang sedang diunduh proses anak: persennya (dari baris progres); yang menunggu giliran: "sedang diunduh"
                pct = DL["pct"].get(n) if n == DL["now"] else None
                v[n] = f"mengunduh {pct}%" if pct is not None else "sedang diunduh"
    return v


def engine_warm(rt: Runtime) -> bool:
    """keadaan NYATA untuk detak info.warm: mesin suara yang akan dipakai job berikutnya (planned) sudah dimuat — juga kalau yang
    memuatnya job sendiri (PRELOAD=mati / sesudah lepas model menganggur), bukan hanya pemanasan latar"""
    eng = rt.engines
    if eng is None:
        return False
    try:
        p = eng.planned()
        return bool(p) and p in eng.loaded()
    except Exception:  # pengelola mesin lama / palsu
        return bool(getattr(rt, "warm", False))


def engine_loading(rt: Runtime) -> bool:
    """detak info.loading: mesin suara sedang disiapkan — pemanasan latar sedang memuat / memanaskan mesin, atau model mesin
    suara (chatterbox / pocket di ENGINE_ORDER) masih diunduh di latar. Unduhan UTMOS / whisper / DeepFilterNet saja = False"""
    if WARMING.is_set():
        return True
    order = list(getattr(CFG, "engine_order", []) or [])
    return bool(DL["active"]) and any(n in ENGINE_NAMES and n in order for n in list(DL["names"]))


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


def _loaded(eng, name: str) -> bool:
    try:
        return name in eng.loaded()
    except Exception:
        return False


def warm_engine(rt: Runtime, skip: set[str], only: set[str] | None = None) -> str | None:
    """
    muat + panaskan mesin suara yang akan dipakai job berikutnya (urutan ENGINE_ORDER, lewati yang mati / `skip`) & catat waktu muat /
    kecepatannya — HANYA kalau mesin itu BELUM dimuat. Mesin yang sudah dimuat bisa sedang dipakai job (membuat suara berjalan di
    luar kunci mesin), jadi memanaskannya lagi dari thread lain = dua generate bersamaan di objek & GPU yang sama (race). Pemanggil
    (warm_up) memegang kunci mesin, jadi cek "sudah dimuat" + muatnya tidak bisa diselip job (job memuat lewat Engines.get yang
    memakai kunci yang sama). `only` = hanya kalau mesin berikutnya termasuk di sini (mis. yang baru selesai diunduh di latar).
    Balikan nama mesin yang sudah dimuat, atau None.
    """
    eng = rt.engines
    for name in CFG.engine_order:
        if name in skip or eng.is_down(name):
            continue
        if _loaded(eng, name):
            return name  # sudah dimuat (oleh job / pemanasan sebelumnya) → TIDAK dipanaskan ulang
        if only is not None and name not in only:
            return None  # mesin berikutnya bukan yang baru diunduh → biarkan (dimuat saat job pertama / pemanasan lain)
        t0 = time.monotonic()
        WARMING.set()
        try:
            w = getattr(eng, "warmup", None)
            info = w(name) if callable(w) else None
            if not callable(w):
                eng.get(name)
        except Exception as e:  # EngineDown sudah dicatat pengelola mesin → coba mesin berikutnya
            log.warning("Pemanasan mesin %s gagal: %s", name, str(e)[:200])
            continue
        finally:
            WARMING.clear()
        took = time.monotonic() - t0
        sp = getattr(rt, "speed", None)
        if sp is not None:
            d = info if isinstance(info, dict) else {}
            gen = _num(d, "wall_sec", "gen_sec", "wall")
            audio0, ratio = _num(d, "audio_sec", "audio"), _num(d, "ratio")
            if gen is None and audio0 and ratio:  # mesin cepat: ratio = detik proses per detik suara (n versi sekaligus)
                gen = audio0 * ratio
            load = _num(d, "load_sec", "load")
            if load is None and _num(d, "sec"):  # waktu pemanasan sendiri bukan waktu muat model
                load = max(0.0, took - float(d["sec"]))
            if load is None:
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


def warm_up(rt: Runtime, skip: set[str], engines: bool = True, only: set[str] | None = None, extras: tuple[str, ...] = ("whisper", "utmos")) -> None:
    """pemanasan sekali: mesin suara (warm_engine: hanya yang belum dimuat) → faster-whisper → UTMOS (`extras`). Kunci mesin
    dipegang selama pemanasan: job yang datang menunggu (pesannya "Menyiapkan mesin suara…") dan tidak memuat model yang sama dua kali."""
    lock = getattr(rt.engines, "lock", None)
    _loading(rt, +1)
    try:
        if lock is not None:
            lock.acquire()
        try:
            if engines:
                rt.warm = (warm_engine(rt, skip, only) is not None) or bool(rt.warm)
            if "whisper" in extras and "whisper" not in skip and rt.asr is not None:
                try:
                    _ = rt.asr.available
                except Exception as e:
                    log.warning("faster-whisper belum bisa dimuat: %s", str(e)[:200])
            if "utmos" in extras and "utmos" not in skip:
                warm_utmos(rt)
        finally:
            if lock is not None:
                lock.release()
    finally:
        _loading(rt, -1)


_LOADING_LOCK = threading.Lock()


def _loading(rt: Runtime, delta: int) -> None:
    """rt.loading = ada pemanasan yang sedang jalan / menunggu kunci mesin (bisa lebih dari satu: pemanasan awal + sesudah unduhan
    latar) — dihitung, supaya yang selesai duluan tidak mematikan tandanya selagi yang lain masih jalan"""
    with _LOADING_LOCK:
        n = max(0, int(getattr(rt, "_loading_n", 0) or 0) + delta)
        rt._loading_n = n  # type: ignore[attr-defined]
        rt.loading = n > 0


def warm_after_download(rt: Runtime, hb: "Heartbeat", name: str) -> None:
    """
    model `name` baru selesai diunduh di latar → mesinnya dipanaskan / whisper & UTMOS dimuat, TAPI tidak pernah di tengah job:
    menunggu kunci "sedang membuat suara" (BUSY, dipegang handle) lepas dulu. Mesin yang sudah dimuat tidak pernah dipanaskan ulang
    (warm_engine), dan hanya mesin yang baru diunduh itu yang boleh dimuat (`only`).
    """
    while BUSY.is_set() and not stop.is_set():
        stop.wait(0.5)
    if stop.is_set():
        return
    pending = set(DL["names"]) if DL["active"] else set()
    try:
        if name in ENGINE_NAMES:
            warm_up(rt, skip=pending, engines=True, only={name}, extras=())
        elif name in ("whisper", "utmos"):
            warm_up(rt, skip=set(), engines=False, extras=(name,))
    except Exception as e:  # thread latar tidak boleh menjatuhkan worker
        log.warning("Pemanasan %s sesudah diunduh gagal: %s", name, str(e)[:200])
    hb.wake.set()


# ---------------------------------------------------------------- unduhan latar di PROSES ANAK (bisa dihentikan kapan saja)
# Thread unduhan huggingface_hub (hf_xet / ThreadPoolExecutor) tidak bisa dihentikan dari thread lain dan menahan proses keluar
# sampai seluruh snapshot selesai → unduhan latar dijalankan `siapkan_model.py --latar --hanya <nama>` per model; worker berhenti →
# proses anak (sepohon) dihentikan, bagian yang sudah terunduh (.incomplete / .part) dilanjutkan lain kali.
_TS = re.compile(r"^\d{1,2}:\d{2}:\d{2}\s+")  # jam di awal baris log proses anak (log worker punya jam sendiri)
_PCT = re.compile(r"\s(\d{1,3})%")  # baris progres unduhan: "UTMOS  42% · 165/392 MB · …"
_JOB: dict = {"h": None}  # Windows: Job Object "ikut mati" untuk proses anak


def dl_cmd(name: str) -> list[str]:
    """perintah proses anak yang mengunduh SATU model (tes boleh mengganti fungsi ini)"""
    exe = Path(sys.executable)
    if exe.name.lower() == "pythonw.exe" and exe.with_name("python.exe").is_file():
        exe = exe.with_name("python.exe")  # pythonw tanpa stdout; jendelanya tetap disembunyikan (CREATE_NO_WINDOW)
    return [str(exe), "-u", str(SIAPKAN), "--latar", "--hanya", name]


def _kill_on_close(p: subprocess.Popen) -> None:
    """Windows: proses anak ikut mati kalau worker mati mendadak (jendela ditutup paksa / Task Scheduler stop / crash) — Job Object
    KILL_ON_JOB_CLOSE (pegangannya ditutup Windows saat worker mati). Gagal → tidak apa-apa (worker tetap menghentikannya saat
    berhenti normal)."""
    if os.name != "nt":
        return
    try:
        import ctypes
        from ctypes import wintypes

        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateJobObjectW.restype = wintypes.HANDLE
        k32.CreateJobObjectW.argtypes = (ctypes.c_void_p, wintypes.LPCWSTR)
        k32.SetInformationJobObject.argtypes = (wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD)
        k32.AssignProcessToJobObject.argtypes = (wintypes.HANDLE, wintypes.HANDLE)
        k32.CloseHandle.argtypes = (wintypes.HANDLE,)
        if _JOB["h"] is None:

            class Basic(ctypes.Structure):
                _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64), ("LimitFlags", wintypes.DWORD),
                            ("MinimumWorkingSetSize", ctypes.c_size_t), ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                            ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

            class Io(ctypes.Structure):
                _fields_ = [(f, ctypes.c_uint64) for f in ("ReadOps", "WriteOps", "OtherOps", "ReadBytes", "WriteBytes", "OtherBytes")]

            class Ext(ctypes.Structure):
                _fields_ = [("BasicLimitInformation", Basic), ("IoInfo", Io), ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                            ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

            h = k32.CreateJobObjectW(None, None)
            if not h:
                return
            info = Ext()
            info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not k32.SetInformationJobObject(h, 9, ctypes.byref(info), ctypes.sizeof(info)):  # JobObjectExtendedLimitInformation
                k32.CloseHandle(h)
                return
            _JOB["h"] = h
        k32.AssignProcessToJobObject(_JOB["h"], int(p._handle))  # type: ignore[attr-defined]
    except Exception as e:
        log.debug("Job Object proses unduh tidak dipasang: %s", e)


def spawn_download(name: str) -> subprocess.Popen:
    """jalankan proses anak pengunduh SATU model: keluarannya lewat pipa (dibaca _ChildLog), grup proses sendiri (Ctrl+C di jendela
    worker tidak ikut ke sana — worker yang menghentikannya), tanpa jendela kalau worker sendiri tanpa konsol"""
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8", "TQDM_DISABLE": "1", "HF_HUB_DISABLE_PROGRESS_BARS": "1"}
    kw: dict = dict(stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=str(SIAPKAN.parent), env=env,
                    text=True, encoding="utf-8", errors="replace", bufsize=1)
    if os.name == "nt":
        kw["creationflags"] = 0x00000200 | (0x08000000 if NO_CONSOLE else 0)  # CREATE_NEW_PROCESS_GROUP (+ CREATE_NO_WINDOW)
    else:
        kw["start_new_session"] = True  # grup proses sendiri → dihentikan sepohon lewat killpg; Ctrl+C terminal tidak ikut
    p = subprocess.Popen(dl_cmd(name), **kw)
    _kill_on_close(p)
    return p


def kill_tree(p: subprocess.Popen, wait: float = 5.0) -> None:
    """hentikan proses anak BESERTA turunannya (Windows: taskkill /T /F, cadangan TerminateProcess; Linux/mac: sinyal ke grup
    prosesnya, SIGTERM lalu SIGKILL)"""
    if p.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, creationflags=0x08000000)
        else:
            os.killpg(p.pid, signal.SIGTERM)
    except Exception:
        pass
    try:
        p.wait(timeout=wait)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        if os.name != "nt":
            os.killpg(p.pid, signal.SIGKILL)
        p.kill()
    except Exception:
        pass
    try:
        p.wait(timeout=wait)
    except Exception:
        pass


def stop_downloads() -> None:
    """worker berhenti → proses anak unduhan yang masih jalan dihentikan (dipanggil main() & atexit)"""
    p = DL.get("proc")
    if p is not None:
        kill_tree(p)


atexit.register(stop_downloads)


class _ChildLog:
    """keluaran proses anak → log worker, ringkas: baris progres (ada persennya) paling sering tiap DL_LOG_SEC dtk (yang terbaru
    ditahan lalu ditulis saat jatahnya tiba — flush_due dipanggil berkala), baris lain (mulai / selesai / gagal) langsung;
    "@@hasil {json}" disimpan sebagai hasil; persen terakhir → DL["pct"] (detak info.models)"""

    def __init__(self, name: str, lg):
        self.name, self.lg = name, lg
        self.result: dict | None = None
        self.tail: deque[str] = deque(maxlen=5)
        self.t_prog = -1e18
        self.pending: str | None = None
        self.lock = threading.Lock()

    def feed(self, raw: str) -> None:
        line = raw.rstrip("\r\n")
        if not line.strip():
            return
        if line.startswith("@@hasil "):
            try:
                r = json.loads(line[len("@@hasil "):])
                self.result = r if isinstance(r, dict) else None
            except ValueError:
                pass
            return
        msg = _TS.sub("", line).strip()
        self.tail.append(msg)
        m = _PCT.search(" " + msg)
        if m:
            DL["pct"][self.name] = max(0, min(100, int(m.group(1))))
            with self.lock:
                self.pending = msg
            self.flush_due()
            return
        with self.lock:
            self.pending = None  # baris progres yang tertahan sudah basi (mis. baris "selesai" datang)
        self.lg.info(msg[:400])

    def flush_due(self) -> None:
        """tulis baris progres yang tertahan kalau sudah ≥ DL_LOG_SEC dtk sejak baris progres terakhir di log worker"""
        with self.lock:
            msg, now = self.pending, time.monotonic()
            if msg is None or now - self.t_prog < DL_LOG_SEC:
                return
            self.pending, self.t_prog = None, now
        self.lg.info(msg[:400])

    def pump(self, stream) -> None:
        try:
            for raw in stream:
                self.feed(raw)
        except (OSError, ValueError):
            pass  # pipa ditutup (proses anak dihentikan)


def download_one(name: str, lg) -> str:
    """unduh SATU model lewat proses anak; balikan "siap" / "gagal: …". Worker berhenti (stop) → proses anak dihentikan sepohon."""
    try:
        p = spawn_download(name)
    except OSError as e:
        return f"gagal: proses unduh tidak bisa dijalankan ({str(e)[:150]})"
    DL["proc"] = p
    cl = _ChildLog(name, lg)
    rd = threading.Thread(target=cl.pump, args=(p.stdout,), daemon=True, name=f"unduh-{name}-log")
    rd.start()
    try:
        while p.poll() is None:
            cl.flush_due()
            if stop.wait(0.5) and p.poll() is None:
                lg.info("Worker berhenti → unduhan %s dihentikan (dilanjutkan saat worker menyala lagi)." % name)
                kill_tree(p)
                break
    finally:
        DL["proc"] = None
    rd.join(timeout=5)
    try:
        p.stdout.close()  # type: ignore[union-attr]
    except Exception:
        pass
    res = (cl.result or {}).get(name)
    if isinstance(res, str):
        return res
    if stop.is_set():
        return "gagal: dihentikan (dilanjutkan lain kali)"
    why = cl.tail[-1][:150] if cl.tail else ""
    return f"gagal: proses unduh berhenti (kode {p.returncode})" + (f" — {why}" if why else "")


def download_bg(rt: Runtime, hb: "Heartbeat", names: list[str], warm: bool) -> None:
    """
    unduh model yang kurang di latar, SATU PER SATU di proses anak (bisa dihentikan, bisa dilanjutkan). Tiap model yang selesai
    LANGSUNG dipakai (set_ready) dan — kalau PRELOAD — mesinnya dipanaskan sesudah job yang sedang jalan selesai; tidak menunggu
    model lain (UTMOS dari GitHub bisa lama sekali).
    """
    m = models_mod()
    if m is None:
        return
    lg = _LogFn(vlog.get("unduh"))
    DL.update(active=True, names=list(names), now=None, pct={}, done={})
    hb.wake.set()
    t0 = time.time()
    log.info("Model belum lengkap (%s) — diunduh di latar satu per satu. Job tetap jalan tanpa model itu dulu.", ", ".join(names))
    try:
        for n in list(names):
            if stop.is_set():
                break
            DL["now"] = n
            hb.wake.set()
            t1 = time.time()
            try:
                res = download_one(n, lg)
            except Exception as e:  # thread latar tidak boleh menjatuhkan worker
                res = f"gagal: {str(e)[:200]}"
            DL["done"][n] = res
            DL["pct"].pop(n, None)
            DL["now"] = None
            DL["names"] = [x for x in DL["names"] if x != n]
            note = getattr(m, "note_result", None)
            if callable(note):  # status_brief / ready_gen di proses ini ikut tahu (filenya ditulis proses anak)
                try:
                    note(n, res)
                except Exception as e:
                    log.debug("catat hasil %s gagal: %s", n, e)
            if res == "siap":
                log.info("Model %s siap dipakai (%.0f dtk).", n, time.time() - t1)
                set_ready(rt, [n])
                if warm and n in (*ENGINE_NAMES, "whisper", "utmos"):
                    threading.Thread(target=warm_after_download, args=(rt, hb, n), daemon=True, name=f"pemanasan-{n}").start()
            elif not stop.is_set():
                log.warning("Model %s belum terunduh: %s — dicoba lagi saat worker dinyalakan ulang (atau jalankan SIAPKAN-MODEL.bat).", n, res[:300])
            _MB["v"] = None  # status model dibaca ulang di detak berikutnya
            hb.wake.set()
    finally:
        DL.update(active=False, now=None)
        _MB["v"] = None
    ok = [n for n, r in DL["done"].items() if r == "siap"]
    if len(names) > 1 and not stop.is_set():
        log.info("Unduhan latar selesai dalam %.0f dtk: %d dari %d model siap.", time.time() - t0, len(ok), len(names))
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
    BUSY.set()  # "sedang membuat suara": pemanasan sesudah unduhan latar menunggu job ini selesai (tidak berebut GPU / mesin)
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
        BUSY.clear()
        hb.wake.set()


def main() -> int:
    if getattr(CFG, "env_note", ""):  # .env ANSI / UTF-16: tetap dibaca, pemakai diberi tahu cara menyimpannya sebagai UTF-8
        log.warning("%s", CFG.env_note)
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
    migrated = config.migrate_env(CFG)  # hanya worker yang memegang kunci: .env ditulis sekali & tercatat di log-nya
    lower_priority()
    signal.signal(signal.SIGINT, on_sigint)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, on_sigint)  # type: ignore[attr-defined]

    log.info("voice-worker %s mulai — id %s, %d thread CPU, data di %s", VERSION, CFG.worker_id, CFG.cpu_threads, CFG.data)
    if getattr(CFG, "preload_old_default", False):
        log.info("PRELOAD=0 di .env adalah bawaan lama → sekarang mesin suara dipanaskan di latar saat mulai (matikan: PRELOAD=mati).")
    if migrated:
        log.info("%s", migrated)
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
    if rt.render_ok:  # cache komposisi render disiapkan di latar → render pertama tidak menunggu `remotion bundle`
        jobs_render.prebuild(CFG)
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
                if rt.render_ok:  # kode berubah (git pull tanpa restart) → cache komposisi baru disiapkan di latar
                    jobs_render.prebuild(CFG)
                rt.engines.maybe_idle_unload()
                if not rt.engines.loaded():
                    rt.warm = False
                last_check = time.time()
            stop.wait(poll_wait(time.time(), last_active, CFG.poll_sec))
    except KeyboardInterrupt:
        log.info("Dihentikan.")
    finally:
        stop.set()
        stop_downloads()  # proses anak unduhan latar dihentikan (dilanjutkan saat worker menyala lagi)
        jobs_render.stop_prebuild()  # bangun cache komposisi di latar dihentikan (dibangun lagi saat worker menyala)
        hb.wake.set()
        hb.join(timeout=10)
        rt.engines.unload()
        log.info("voice-worker berhenti. Sampai jumpa!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
