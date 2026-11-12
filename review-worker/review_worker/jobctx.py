"""Konteks satu pekerjaan review_jobs (pemilik: worker-inti). Pola voice-worker/studio_worker/jobctx.py: progres dikirim di
latar (≤ 1x/dtk), job sudah bukan 'proses' (dibatalkan di website) → Cancelled di titik aman, pesan awam.
Akhiran perkiraan sisa: " · sisa ±N dtk|mnt" (regex sama dengan website: lib/asistenReview.ts ETA_RE).

Titik aman:
- ctx.check_cancel()  : dibatalkan dari website → Cancelled; laptop diminta berhenti (Ctrl+C sekali) → Berhenti. Dipanggil uji
                        DI ANTARA video.
- ctx.cek_batal()     : hanya Cancelled (TIDAK Berhenti) — teruskan ke pipeline.proses_video(cek_batal=…) supaya Ctrl+C sekali
                        tetap menyelesaikan video yang sedang jalan.
Berhenti adalah turunan KeyboardInterrupt → tidak tertangkap `except Exception`; antrian.tangani mengembalikan job ke antrian
(uji: params {"lanjut_run": <run>} supaya dilanjutkan dari video berikutnya)."""
from __future__ import annotations

import math
import re
import threading
import time
from typing import Any, Optional

from . import log as rlog
from .supa import now_iso

log = rlog.get("job")
TABLE = "review_jobs"
SEND_GAP = 1.0  # jeda minimal antar kiriman progres
CANCEL_CHECK_SEC = 5.0  # check_cancel tanpa force: tanya server paling sering tiap 5 dtk
SENDER_IDLE_SEC = 60.0
FLUSH_WAIT_SEC = 3.0
ETA_RE = re.compile(r"\s·\s*sisa\s*±\s*(\d+)\s*(dtk|mnt)\s*$")


class JobError(Exception):
    """gagal dengan pesan awam yang aman ditampilkan di website"""


class Cancelled(Exception):
    """dibatalkan dari website"""


class Berhenti(KeyboardInterrupt):
    """laptop diminta berhenti (Ctrl+C sekali) — dilempar di titik aman uji; job dikembalikan ke antrian"""


def fmt_left(sec: float) -> str:
    s = max(0.0, float(sec))
    return f"{max(5, int(math.ceil(s / 5.0)) * 5)} dtk" if s < 60 else f"{int(round(s / 60.0))} mnt"


def with_eta(msg: str, left: Optional[float]) -> str:
    base = ETA_RE.sub("", msg or "").rstrip()
    if left is None or not math.isfinite(float(left)):
        return base
    return f"{base} · sisa ±{fmt_left(left)}"


class JobCtx:
    def __init__(self, rt: Any, job: dict):
        self.rt = rt
        self.supa = getattr(rt, "supa", None)
        self.job = job
        self.id: str = job["id"]
        self.kind: str = str(job.get("kind") or "")
        self.run_id: Optional[str] = job.get("run_id")
        self.selesai = False  # done / fail / requeue sudah dipanggil
        self.t0 = time.monotonic()
        self._cv = threading.Condition()
        self._pending: Optional[dict] = None
        self._thread: Optional[threading.Thread] = None
        self._closed = False
        self._busy = False
        self._last_send = 0.0
        self._cancel: Optional[str] = None
        self._confirmed = time.monotonic()
        self._eta: Optional[tuple[float, float]] = None
        self._warned = 0.0

    # ------------------------------------------------------------------ kirim
    def _patch(self, patch: dict) -> list[dict]:
        if self.supa is None:
            return [{"id": self.id}]
        return self.supa.update(TABLE, {"id": f"eq.{self.id}", "status": "eq.proses"}, patch)

    def _status_now(self) -> str:
        if self.supa is None:
            return "proses"
        rows = self.supa.select(TABLE, select="status", id=f"eq.{self.id}")
        return rows[0]["status"] if rows else "batal"

    def progress(self, p: float, msg: Optional[str] = None, *, done: Optional[int] = None, total: Optional[int] = None,
                 run_id: Optional[str] = None) -> None:
        if self._cancel:
            raise Cancelled(self._cancel)
        patch: dict = {"progress": round(max(0.0, min(0.99, float(p))), 3)}
        if msg:
            patch["message"] = str(msg)[:480]
        if done is not None:
            patch["done"] = int(done)
        if total is not None:
            patch["total"] = int(total)
        if run_id:
            self.run_id = str(run_id)
            patch["run_id"] = self.run_id
        with self._cv:
            if self._closed:
                return
            self._pending = {**self._pending, **patch} if self._pending else patch
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._run, name=f"progres-{str(self.id)[:8]}", daemon=True)
                self._thread.start()
            self._cv.notify_all()

    def eta(self, detik_sisa: Optional[float]) -> None:
        try:
            ok = detik_sisa is not None and math.isfinite(float(detik_sisa))
        except (TypeError, ValueError):
            ok = False
        self._eta = (max(0.0, float(detik_sisa)), time.monotonic()) if ok else None  # type: ignore[arg-type]

    def left(self) -> Optional[float]:
        if not self._eta:
            return None
        sec, at = self._eta
        return max(0.0, sec - (time.monotonic() - at))

    def _run(self) -> None:
        while True:
            with self._cv:
                while self._pending is None and not self._closed:
                    if not self._cv.wait(SENDER_IDLE_SEC) and self._pending is None:
                        self._thread = None
                        return
                if self._closed:
                    self._thread = None
                    self._cv.notify_all()
                    return
                wait = SEND_GAP - (time.monotonic() - self._last_send)
                if wait > 0:
                    self._cv.wait(wait)
                    continue
                patch, self._pending = self._pending, None
                if "message" in patch:
                    patch["message"] = with_eta(patch["message"], self.left())
                self._busy = True
            got: Optional[list[dict]] = None
            try:
                got = self._patch(patch)
            except Exception as e:  # internet putus: job tetap jalan, progres berikutnya dicoba lagi
                if time.time() - self._warned > 60:
                    log.warning("Progres job %s belum terkirim (%s) — dicoba lagi otomatis.", self.id, str(e)[:150])
                    self._warned = time.time()
            finally:
                with self._cv:
                    self._busy = False
                    self._last_send = time.monotonic()
                    self._cv.notify_all()
            if got:
                self._confirmed = time.monotonic()
            elif got is not None and not self._closed:  # patch tidak mengenai baris → job sudah bukan 'proses'
                try:
                    st = self._status_now()
                except Exception:
                    st = None
                if st != "proses":
                    self._cancel = st or "batal"

    # ------------------------------------------------------------------ batal / berhenti
    def _berhenti_diminta(self) -> bool:
        stop = getattr(self.rt, "stop", None)
        return bool(stop is not None and stop.is_set())

    def cek_batal(self, force: bool = False) -> None:
        """hanya pembatalan dari website (untuk di DALAM satu video)"""
        if self._cancel:
            raise Cancelled(self._cancel)
        if not force and time.monotonic() - self._confirmed < CANCEL_CHECK_SEC:
            return
        try:
            st = self._status_now()
        except Exception:
            if force:
                raise
            return
        if st != "proses":
            self._cancel = st
            raise Cancelled(st)
        self._confirmed = time.monotonic()

    def check_cancel(self, force: bool = False) -> None:
        """titik aman ANTAR video: Cancelled (batal di website) atau Berhenti (Ctrl+C sekali di laptop)"""
        self.cek_batal(force)
        if self._berhenti_diminta():
            raise Berhenti("laptop diminta berhenti")

    # ------------------------------------------------------------------ akhir job
    def close(self) -> None:
        with self._cv:
            self._closed = True
            self._pending = None
            self._cv.notify_all()
            end = time.monotonic() + FLUSH_WAIT_SEC
            while self._busy:
                left = end - time.monotonic()
                if left <= 0:
                    break
                self._cv.wait(left)

    def done(self, msg: str = "Selesai", **patch: Any) -> None:
        self.close()
        self.selesai = True
        if self.run_id and "run_id" not in patch:
            patch["run_id"] = self.run_id
        got = self._patch({"status": "selesai", "progress": 1, "finished_at": now_iso(), "message": str(msg)[:480], **patch})
        if not got:
            raise Cancelled("batal")

    def fail(self, msg: str) -> None:
        self.close()
        self.selesai = True
        patch: dict = {"status": "gagal", "finished_at": now_iso(), "message": str(msg)[:480]}
        if self.run_id:
            patch["run_id"] = self.run_id
        try:
            self._patch(patch)
        except Exception as e:
            log.error("Gagal menandai job %s gagal: %s", self.id, e)

    def requeue(self, msg: str, params: Optional[dict] = None) -> None:
        """kembali 'antri' (mis. laptop dihentikan Ctrl+C) — params baru boleh (mis. {"lanjut_run": id})"""
        self.close()
        self.selesai = True
        patch: dict = {"status": "antri", "progress": 0, "worker": None, "started_at": None, "message": str(msg)[:480]}
        if params is not None:
            patch["params"] = params
        try:
            self._patch(patch)
        except Exception as e:  # mis. sudah ada uji lain yang menunggu (unik) → tandai gagal, bisa Lanjutkan dari website
            log.warning("Job %s tidak bisa dikembalikan ke antrian (%s).", self.id, str(e)[:150])
            try:
                self._patch({"status": "gagal", "finished_at": now_iso(),
                             "message": "Laptop dihentikan di tengah uji — klik Lanjutkan untuk meneruskan."})
            except Exception:
                pass
