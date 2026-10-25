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

sys.path.insert(0, str(Path(__file__).resolve().parent))

from studio_worker import config  # noqa: E402  (harus pertama: batas thread & folder cache)

CFG = config.load()

from studio_worker import VERSION, jobs_beats, jobs_clean, jobs_render, jobs_tts, seed  # noqa: E402
from studio_worker import log as vlog  # noqa: E402
from studio_worker.asr import Asr  # noqa: E402
from studio_worker.engines import Engines  # noqa: E402
from studio_worker.jobctx import Cancelled, JobCtx, JobError, Runtime  # noqa: E402
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
stop = threading.Event()
_hits = {"n": 0}


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


def handle(rt: Runtime, hb: Heartbeat, table: str, job: dict) -> None:
    ctx = JobCtx(rt, table, job)
    kind = job.get("kind", "tts") if table == VOICE else "render"
    rt.status = {"status": kind, "job": job["id"]}
    hb.wake.set()
    t0 = time.time()
    log.info("Mulai job %s %s", kind, job["id"])
    try:
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
        rt.status = {"status": "siap", "job": None}
        hb.wake.set()


def main() -> int:
    missing = CFG.missing()
    if missing:
        log.error("Isi dulu %s di file voice-worker\\.env (contoh: .env.example). Worker berhenti.", ", ".join(missing))
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
    rt = Runtime(cfg=CFG, supa=Supa(CFG.supabase_url, CFG.service_key, CFG.worker_id))
    rt.engines = Engines(CFG)
    rt.asr = Asr(CFG)
    rt.render_ok, why = jobs_render.check(CFG)
    log.info("Render MP4 di laptop: %s", "siap" if rt.render_ok else f"tidak aktif ({why})")
    g = gpu_info()
    log.info("GPU: %s", f"{g['gpu']} ({g['vram_gb']} GB, CUDA {g.get('cuda')})" if g.get("gpu") else f"tidak ada — mesin suara pakai CPU ({g.get('torch')})")
    base = {**g, "os": f"{platform.system()} {platform.release()}", "host": platform.node(), "id": CFG.worker_id}
    hb = Heartbeat(rt, base)
    hb.start()

    try:
        recover_stale(rt)
        seed.seed_bank(rt)
        if CFG.preload:
            for name in CFG.engine_order:
                try:
                    rt.engines.get(name)
                    break
                except Exception:
                    continue
            _ = rt.asr.available
        log.info("Menunggu antrian dari website… (Ctrl+C untuk berhenti)")
        last_err = 0.0
        last_check = last_sweep = time.time()
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
                handle(rt, hb, table, job)
                continue
            if time.time() - last_sweep > 120:  # job 'proses' milik laptop ini padahal sedang menganggur = yatim → diulang / gagal
                recover_stale(rt, idle=True)
                last_sweep = time.time()
            if time.time() - last_check > 600:  # cek ulang kesiapan render & lepas model kalau lama menganggur
                rt.render_ok, _ = jobs_render.check(CFG)
                rt.engines.maybe_idle_unload()
                last_check = time.time()
            stop.wait(CFG.poll_sec)
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
