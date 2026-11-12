"""Loop antrian dari website (pemilik: worker-inti): detak jantung review_workers tiap 20 dtk, klaim review_claim_job,
satu pekerjaan sekaligus, job yatim milik laptop ini diulang sekali (pola voice-worker recover_stale), Ctrl+C = berhenti sesudah
video ini. Pembagian kerja per jenis: KONTRAK.md §3.4."""
from __future__ import annotations

import json
import os
import re
import signal
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from . import VERSION
from . import log as rlog
from . import pipeline
from .config import url_problem
from .jobctx import Berhenti, Cancelled, JobCtx, JobError
from .kolom import KolomError
from .replika import ReplikaError
from .skema import VideoRef
from .supa import SupaError, now_iso

log = rlog.get("antrian")
WIB = timezone(timedelta(hours=7))
DICABUT = "Akses Asisten Review pemilik pekerjaan ini sudah dicabut admin."
GAGAL_UMUM = "Pekerjaan gagal di laptop. Lihat log laptop (data\\logs) untuk detailnya."
RETRIED = "retried.json"
FAST_POLL_SEC, FAST_POLL_FOR = 1.0, 60.0
SLOW_POLL_SEC, SLOW_POLL_AFTER = 10.0, 30 * 60.0
SARAN_LABEL = {"approve": "Approve", "reject": "Reject", "cek_manusia": "Butuh cek manusia"}
MATERI_LABEL = {"ada": "Materi siap (lagu & visual)", "sebagian": "Materi sebagian siap", "belum_ada": "Materi belum ada",
                "gagal": "Materi gagal disiapkan", "proses": "Materi sedang diproses", "belum_dicek": "Materi belum dicek"}
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_hits = {"n": 0}


# ------------------------------------------------------------------ akses pemilik job
def pemilik_boleh(supa, uid: Optional[str]) -> bool:
    """pemilik job (created_by) masih boleh pakai Asisten Review? = can_use_asisten_review(): admin, atau dibuka admin
    (user_tab_blocks.granted). RLS hanya mengecek saat job masuk antrian → dicek ulang di sini. Job tanpa pemilik (CLI) boleh."""
    if not uid or supa is None:
        return True
    try:
        v = supa.rpc("can_use_asisten_review", {"uid": uid})
        if isinstance(v, bool):
            return v
    except SupaError:
        pass  # service role tidak diberi EXECUTE → cek manual dengan tabel yang sama
    try:
        if supa.select("profiles", select="id", id=f"eq.{uid}", role="eq.admin", limit="1"):
            return True
        return bool(supa.select("user_tab_blocks", select="user_id", user_id=f"eq.{uid}", granted="cs.{asisten_review}", limit="1"))
    except SupaError as e:
        log.warning("Akses pemilik job belum bisa dicek (%s) — dilanjutkan.", str(e)[:120])
        return True


# ------------------------------------------------------------------ satu pekerjaan
def _hari_wib() -> str:
    return datetime.now(WIB).date().isoformat()


def _uji(rt, ctx: JobCtx, params: dict) -> None:
    from . import uji

    jumlah = params.get("jumlah")
    lanjut, ulang = params.get("lanjut_run"), params.get("ulang_run")
    for v in (lanjut, ulang):
        if v is not None and not _UUID.match(str(v)):
            raise JobError("Nomor run uji tidak valid.")
    if not lanjut and not ulang:
        try:
            jumlah = int(jumlah)
        except (TypeError, ValueError):
            raise JobError("Jumlah video uji tidak valid (pilih 50 atau 500).") from None
        if not 1 <= jumlah <= 2000:
            raise JobError("Jumlah video uji harus 1–2000.")
    label = str(params["label"])[:80] if params.get("label") else None
    seed = params.get("seed") if isinstance(params.get("seed"), int) else None
    if lanjut:
        ctx.run_id = str(lanjut)
    ctx.progress(0.01, "Menyiapkan uji akurasi…")
    run_id = uji.jalankan_uji(rt, ctx, jumlah=None if (lanjut or ulang) else jumlah, lanjut_run=lanjut, ulang_run=ulang, label=label,
                              seed=seed)
    if run_id:
        ctx.run_id = str(run_id)
    if not ctx.selesai:
        ctx.done("Uji selesai. Buka Ringkasan untuk melihat hasilnya.")


def _video(rt, ctx: JobCtx, params: dict) -> None:
    try:
        ref = VideoRef.model_validate(params.get("ref") or {})
    except Exception:
        raise JobError("Rujukan video tidak valid. Tempel ID video Konten.com atau link video.") from None
    ctx.progress(0.02, "Mencari video di database Konten.com…", total=1)
    video = pipeline.dengan_replika(rt, lambda: rt.replika.cari_video(ref), ctx.cek_batal)
    if video is None:
        raise JobError("Video tidak ditemukan di database Konten.com.")
    hasil = pipeline.proses_video(rt, video.id, scope=f"job:{ctx.id}", job_id=ctx.id, cek_batal=ctx.cek_batal, video=video,
                                  progres=lambda p, m: ctx.progress(p, m))
    if hasil.pipeline_status != "ok":
        msg = f"Selesai: {hasil.error or 'video tidak bisa diproses'} — butuh cek manusia."
    else:
        msg = f"Selesai — saran AI: {SARAN_LABEL.get(hasil.suggestion or '', '-')}" + (
            f" (yakin {hasil.confidence})" if hasil.confidence is not None else "")
    ctx.done(msg, done=1, total=1)


def _materi(rt, ctx: JobCtx, params: dict) -> None:
    from .media import materi

    cid = str(params.get("campaign_id") or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", cid):
        raise JobError("Campaign tidak valid.")
    ctx.progress(0.03, "Membaca brief campaign…")
    try:
        campaign, brief = pipeline.brief_campaign(rt, cid)
    except LookupError as e:
        raise JobError(str(e)) from None
    rt.cache.setdefault("ref", {}).pop(cid, None)
    ctx.progress(0.08, "Menyiapkan materi referensi…")
    ref = materi.siapkan_materi_campaign(rt, campaign, brief, paksa=bool(params.get("paksa")), progres=lambda p, m: ctx.progress(p, m))
    try:
        materi.proses_upload_manual(rt, cid)
    except (Cancelled, KeyboardInterrupt):
        raise
    except Exception as e:
        log.warning("Sidik jari upload manual campaign %s gagal: %s", cid, str(e)[:150])
    rt.cache.setdefault("ref", {}).pop(cid, None)
    ctx.done(f"{MATERI_LABEL.get(ref.status, ref.status)}" + (f" — {ref.pesan}" if ref.pesan else ""))


def tangani(rt, job: dict) -> None:
    """uji → uji.jalankan_uji (hakim-uji); video → pipeline.proses_video (scope job:<id>); materi → media.materi.siapkan_materi_campaign
    (worker-media); sinkron → sinkron_alasan. Owner job dicek ulang (can_use_asisten_review) sebelum mulai."""
    ctx = JobCtx(rt, job)
    kind = str(job.get("kind") or "")
    params = job.get("params") if isinstance(job.get("params"), dict) else {}
    simpan_status, simpan_job = dict(rt.status), rt.job
    rt.job, rt.status = ctx, {"status": kind, "job": job["id"]}
    _bangunkan(rt)
    AnggaranHabis = pipeline._anggaran_habis()
    t0 = time.time()
    log.info("Mulai pekerjaan %s %s", kind, str(job["id"])[:8])
    biaya_habis = False
    try:
        if not pemilik_boleh(rt.supa, job.get("created_by")):
            raise JobError(DICABUT)
        if kind == "uji":
            _uji(rt, ctx, params)
        elif kind == "video":
            _video(rt, ctx, params)
        elif kind == "materi":
            _materi(rt, ctx, params)
        elif kind == "sinkron":
            n = sinkron_alasan(rt)
            ctx.done(f"{n} alasan reject resmi disinkron dari Konten.com.", done=n, total=n)
        else:
            raise JobError("Jenis pekerjaan tidak dikenal.")
        log.info("Pekerjaan %s %s selesai (%.0f dtk)", kind, str(job["id"])[:8], time.time() - t0)
    except Cancelled:
        log.info("Pekerjaan %s dibatalkan dari website.", str(job["id"])[:8])
    except Berhenti:
        if not ctx.selesai:
            baru = {"lanjut_run": ctx.run_id} if kind == "uji" and ctx.run_id else params
            ctx.requeue("Laptop dihentikan sementara — dilanjutkan otomatis saat menyala lagi.", params=baru)
        log.info("Pekerjaan %s dikembalikan ke antrian (laptop berhenti).", str(job["id"])[:8])
    except KeyboardInterrupt:
        if not ctx.selesai:
            baru = {"lanjut_run": ctx.run_id} if kind == "uji" and ctx.run_id else params
            ctx.requeue("Laptop dihentikan sementara — dilanjutkan otomatis saat menyala lagi.", params=baru)
        raise
    except AnggaranHabis as e:
        biaya_habis = True
        rt.cache["biaya_habis_hari"] = _hari_wib()
        log.warning("Batas biaya harian tercapai: %s", e)
        if not ctx.selesai:
            ctx.fail(str(e) or f"Batas biaya harian ${rt.cfg.daily_budget_usd:g} tercapai — klik Lanjutkan besok.")
    except (JobError, KolomError, ReplikaError) as e:
        log.warning("Pekerjaan %s %s gagal: %s", kind, str(job["id"])[:8], e)
        if not ctx.selesai:
            ctx.fail(str(e))
    except SupaError as e:
        log.warning("Pekerjaan %s %s gagal (Supabase): %s", kind, str(job["id"])[:8], e)
        if not ctx.selesai:
            ctx.fail("Koneksi laptop ke website terputus di tengah pekerjaan. Coba lagi.")
    except Exception:
        log.exception("Pekerjaan %s %s error tak terduga", kind, str(job["id"])[:8])
        if not ctx.selesai:
            ctx.fail(GAGAL_UMUM)
    finally:
        ctx.close()
        rt.job = simpan_job
        rt.status = {"status": "berhenti_biaya", "job": None} if biaya_habis else simpan_status
        _bangunkan(rt)


def sinkron_alasan(rt) -> int:
    """replika.daftar_alasan → alasan.sinkron (hakim-ai) → jumlah label"""
    from . import alasan

    daftar = pipeline.dengan_replika(rt, rt.replika.daftar_alasan)
    if rt.supa is None:
        for label, n, _a, _b in daftar:
            print(f"  {n:>6}  {label}")
        return len(daftar)
    return int(alasan.sinkron(rt.supa, daftar) or 0)


# ------------------------------------------------------------------ detak jantung
class Detak(threading.Thread):
    """review_workers tiap ±20 dtk (website menganggap laptop mati kalau > 60 dtk)"""

    def __init__(self, rt, supa_detak):
        super().__init__(daemon=True, name="detak")
        self.rt = rt
        self.supa = supa_detak
        self.wake = threading.Event()
        self.berhenti = threading.Event()
        self._warned = 0.0

    def run(self) -> None:
        while not self.berhenti.is_set():
            try:
                self.supa.detak(self.rt.info_detak())
            except Exception as e:
                if time.time() - self._warned > 300:
                    log.warning("Detak ke website gagal (%s) — dicoba lagi otomatis.", str(e)[:150])
                    self._warned = time.time()
            self.wake.wait(self.rt.cfg.heartbeat_sec)
            self.wake.clear()
        try:  # berhenti rapi → website langsung menampilkan "mati"
            self.supa.mati(self.rt.info_detak())
        except Exception:
            pass


def _bangunkan(rt) -> None:
    hb = rt.cache.get("_detak")
    if hb is not None:
        hb.wake.set()


# ------------------------------------------------------------------ job yatim
def _muat_retried(rt) -> list[str]:
    try:
        ids = json.loads((rt.cfg.data / RETRIED).read_text(encoding="utf-8"))
        return [str(x) for x in ids] if isinstance(ids, list) else []
    except (OSError, ValueError):
        return []


def _simpan_retried(rt, ids: list[str]) -> None:
    f = rt.cfg.data / RETRIED
    try:
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(ids[-200:]), encoding="utf-8")
        os.replace(tmp, f)
    except OSError as e:
        log.warning("Catatan job yang sudah diulang tidak bisa disimpan: %s", e)


def recover_stale(rt, idle: bool = False) -> int:
    """job 'proses' milik laptop ini yang tidak sedang dikerjakan → diulang sekali (uji: lanjut dari run-nya), kedua kali gagal"""
    try:
        rows = rt.supa.select("review_jobs", select="id,kind,params,run_id", status="eq.proses", worker=f"eq.{rt.cfg.worker_id}")
    except SupaError as e:
        log.warning("Cek pekerjaan tertunda gagal: %s", e)
        return 0
    sekarang = getattr(rt.job, "id", None)
    retried, n = _muat_retried(rt), 0
    for r in rows:
        rid = str(r["id"])
        if rid == sekarang:
            continue
        again = rid in retried
        if again:
            why = "koneksi laptop terputus" if idle else "laptop berhenti"
            patch = {"status": "gagal", "finished_at": now_iso(), "message": f"Gagal: {why} saat memproses (sudah diulang sekali)."
                     + (" Klik Lanjutkan untuk meneruskan uji." if r.get("kind") == "uji" else "")}
        else:
            why = "koneksi laptop pulih" if idle else "laptop menyala lagi"
            patch = {"status": "antri", "progress": 0, "worker": None, "started_at": None, "message": f"Diulang otomatis setelah {why}"}
            if r.get("kind") == "uji" and r.get("run_id"):
                patch["params"] = {"lanjut_run": str(r["run_id"])}
        try:
            got = rt.supa.update("review_jobs", {"id": f"eq.{rid}", "status": "eq.proses"}, patch)
        except SupaError as e:  # mis. sudah ada uji lain menunggu (unik) → tandai gagal, bisa Lanjutkan
            log.warning("Pekerjaan tertunda %s belum bisa diubah (%s).", rid[:8], str(e)[:100])
            try:
                got = rt.supa.update("review_jobs", {"id": f"eq.{rid}", "status": "eq.proses"},
                                     {"status": "gagal", "finished_at": now_iso(), "message": "Laptop berhenti di tengah uji — klik Lanjutkan."})
            except SupaError:
                continue
            again = True
        if got:
            retried = [x for x in retried if x != rid] + ([] if again else [rid])
            _simpan_retried(rt, retried)
            n += 1
            log.info("Pekerjaan tertunda %s → %s", rid[:8], got[0].get("status"))
    return n


# ------------------------------------------------------------------ proses
def poll_wait(now: float, last_active: float, poll_sec: float) -> float:
    idle = max(0.0, now - last_active)
    if idle < FAST_POLL_FOR:
        return min(FAST_POLL_SEC, poll_sec)
    if idle < SLOW_POLL_AFTER:
        return poll_sec
    return max(poll_sec, SLOW_POLL_SEC)


def lower_priority() -> None:
    """prioritas proses di bawah normal (BELOW_NORMAL) supaya bot WAHA & voice-worker tetap lancar"""
    try:
        if os.name == "nt":
            import ctypes

            ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x00004000)
        else:
            os.nice(5)
    except Exception:
        pass


def single_instance(path):
    """cegah 2 review-worker jalan bersamaan di laptop yang sama"""
    f = open(path, "a+")
    try:
        if os.name == "nt":
            import msvcrt

            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close()
        return None
    return f


def pasang_sinyal(rt) -> None:
    """Ctrl+C sekali = berhenti sesudah video / pekerjaan ini; dua kali = berhenti sekarang"""
    _hits["n"] = 0

    def on_sigint(signum, frame) -> None:  # noqa: ARG001
        _hits["n"] += 1
        if _hits["n"] == 1:
            log.info("Berhenti sesudah video ini selesai… (tekan Ctrl+C sekali lagi untuk berhenti sekarang)")
            rt.stop.set()
        else:
            raise KeyboardInterrupt

    try:
        signal.signal(signal.SIGINT, on_sigint)
        if hasattr(signal, "SIGBREAK"):
            signal.signal(signal.SIGBREAK, on_sigint)  # type: ignore[attr-defined]
    except ValueError:  # bukan thread utama (tes)
        pass


def _menganggur(rt, last: dict, last_active: float) -> None:
    """kerja kecil saat tidak ada antrian: sidik jari upload manual, job yatim, lepas model GPU, status biaya"""
    now = time.time()
    if now - last.get("materi", 0) > 60:
        last["materi"] = now
        try:
            from .media import materi

            n = materi.proses_upload_manual(rt)
            if n:
                log.info("%d materi upload manual selesai disidik.", n)
        except NotImplementedError:
            pass
        except Exception as e:
            log.warning("Sidik jari upload manual gagal: %s", str(e)[:150])
    if now - last.get("yatim", 0) > 120:
        last["yatim"] = now
        recover_stale(rt, idle=True)
    if time.monotonic() - rt.terakhir_gpu > rt.cfg.idle_lepas_menit * 60:
        rt.lepas_model(f"menganggur {rt.cfg.idle_lepas_menit} mnt")
        rt.terakhir_gpu = time.monotonic()
    habis = rt.cache.get("biaya_habis_hari")
    rt.status = {"status": "berhenti_biaya" if habis == _hari_wib() else "siap", "job": None}


def jalan(rt) -> int:
    """mode `review jalan`: kode keluar 0 normal, 2 pengaturan kurang"""
    from .supa import Supa

    cfg = rt.cfg
    if cfg.missing() or rt.supa is None:
        log.error("Isi dulu %s di file review-worker\\.env (contoh: .env.example). Asisten Review berhenti.",
                  ", ".join(cfg.missing()) or "SUPABASE_URL")
        return 2
    bad = url_problem(cfg.supabase_url)
    if bad:
        log.error("%s Buka: notepad .env — lalu jalankan lagi.", bad)
        return 2
    kunci = single_instance(cfg.data / "worker.lock")
    if kunci is None:
        log.error("Asisten Review sudah jalan di laptop ini (cek jendela lain). Yang ini berhenti.")
        return 0
    lower_priority()
    pasang_sinyal(rt)
    log.info("review-worker %s mulai — id %s, model %s (effort %s), batas biaya $%g/hari", VERSION, cfg.worker_id, cfg.model, cfg.effort,
             cfg.daily_budget_usd)
    if cfg.env_note:
        log.warning("%s", cfg.env_note)
    if not cfg.anthropic_key_ada:
        log.warning("ANTHROPIC_API_KEY kosong — AI mati, semua hasil jadi 'butuh cek manusia'. Isi di .env lalu nyalakan ulang.")
    pipeline.bersihkan_tmp(cfg)
    db = rt.replika.cek_koneksi()
    log.info("DB Konten.com: %s", "tersambung (read-only)" if db is None else db)
    hb = Detak(rt, Supa(cfg.supabase_url, cfg.service_key, cfg.worker_id, retries=2))
    rt.cache["_detak"] = hb
    hb.start()
    try:
        recover_stale(rt)
        log.info("Menunggu antrian dari website (tab Asisten Review)… Ctrl+C untuk berhenti.")
        last_err, last_active, last = 0.0, time.time(), {"materi": 0.0, "yatim": time.time()}
        while not rt.stop.is_set():
            try:
                job = rt.supa.klaim_job()
            except SupaError as e:
                if time.time() - last_err > 60:
                    log.warning("Tidak bisa cek antrian (%s). Internet mati? Dicoba lagi otomatis.", str(e)[:150])
                    last_err = time.time()
                rt.stop.wait(min(60.0, cfg.poll_sec * 3))
                continue
            if job:
                tangani(rt, job)
                last_active = time.time()
                continue
            _menganggur(rt, last, last_active)
            rt.stop.wait(poll_wait(time.time(), last_active, cfg.poll_sec))
    except KeyboardInterrupt:
        log.info("Dihentikan.")
    finally:
        rt.stop.set()
        hb.berhenti.set()
        hb.wake.set()
        hb.join(timeout=10)
        rt.lepas_model()
        try:
            rt.replika.tutup()
        except Exception:
            pass
        try:
            kunci.close()
        except Exception:
            pass
        log.info("review-worker berhenti. Sampai jumpa!")
    return 0
