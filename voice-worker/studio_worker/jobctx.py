"""Konteks bersama job: progres (dikirim di latar, tidak menahan GPU), cek batal, perkiraan sisa waktu, selesai / gagal dengan pesan awam.

Progres: ctx.progress() langsung kembali — patch disimpan, thread pengirim mengirim yang TERBARU (patch yang belum terkirim digabung,
yang baru menang) paling sering tiap 1 dtk. Patch tidak mengenai baris (job sudah bukan 'proses': dibatalkan / dihapus dari website)
→ tanda batal; ctx.progress() / ctx.check_cancel() berikutnya melempar Cancelled di titik aman (antar langkah, bukan di tengah GPU).
Perkiraan sisa: ctx.eta(detik) → pesan progres berikutnya diberi akhiran " · sisa ±40 dtk" / " · sisa ±2 mnt" (dihitung saat dikirim);
website membaca pola itu dan menghitung mundur dari updated_at.
"""
from __future__ import annotations

import math
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any

from . import log as vlog
from .supa import Supa, now_iso

log = vlog.get("job")

# jeda minimal antar kiriman progres ke Supabase (detik)
SEND_GAP = 1.0
# check_cancel() tanpa force: tanya status ke server paling sering tiap sekian detik (kiriman progres yang berhasil = status terkonfirmasi)
CANCEL_CHECK_SEC = 5.0
# thread pengirim berhenti sendiri kalau tidak ada progres selama ini (dinyalakan lagi otomatis saat ada progres)
SENDER_IDLE_SEC = 60.0
# done / fail / requeue: kiriman progres yang sedang di jalan ditunggu maksimal sekian detik
FLUSH_WAIT_SEC = 3.0
# akhiran perkiraan sisa — sama persis dengan pola yang dibaca website (lib/studio): /\s·\s*sisa\s*±\s*(\d+)\s*(dtk|mnt)\s*$/
ETA_RE = re.compile(r"\s·\s*sisa\s*±\s*(\d+)\s*(dtk|mnt)\s*$")


def fmt_left(sec: float) -> str:
    try:
        from .speed import fmt_left as f
    except ImportError:  # speed.py belum ada (cabang lama): format sama
        s = max(0.0, float(sec))
        return f"{max(5, int(math.ceil(s / 5.0)) * 5)} dtk" if s < 60 else f"{int(round(s / 60.0))} mnt"
    return f(sec)


def with_eta(msg: str, left: float | None) -> str:
    """pesan + akhiran " · sisa ±N dtk|mnt" (akhiran lama dibuang dulu); left None → tanpa akhiran"""
    base = ETA_RE.sub("", msg or "").rstrip()
    if left is None or not math.isfinite(float(left)):
        return base
    return f"{base} · sisa ±{fmt_left(left)}"


class JobError(Exception):
    """gagal dengan pesan yang aman & awam untuk ditampilkan di website"""


class Cancelled(Exception):
    """job dibatalkan user (status 'batal') saat sedang dikerjakan"""


@dataclass
class Runtime:
    """isi worker yang dipakai job: config, supabase, mesin suara, ASR"""

    cfg: Any
    supa: Supa
    engines: Any = None
    asr: Any = None
    render_ok: bool = False
    status: dict = field(default_factory=lambda: {"status": "siap", "job": None})
    # catatan kecepatan mesin suara (studio_worker/speed.py): batas waktu per baris, jumlah versi & perkiraan waktu selesai
    speed: Any = None
    # mesin suara utama sudah dimuat + dipanaskan (detak jantung info.warm)
    warm: bool = False
    # pemanasan latar sedang memuat mesin (job yang datang menunggu kunci mesin; waktu muat dicatat oleh pemanasan, bukan job)
    loading: bool = False


def owner_can_use_studio(supa, owner: str | None) -> bool:
    """pemilik job (created_by) masih boleh pakai Studio? sama dengan can_use_studio() di migration-20: admin, atau ada di studio_access.
    RLS hanya mengecek saat job masuk antrian, jadi akses yang dicabut sesudahnya dicek lagi di sini. Job tanpa pemilik (job sistem) tetap jalan."""
    if not owner:
        return True
    if supa.select("studio_access", select="user_id", user_id=f"eq.{owner}", limit="1"):
        return True
    return bool(supa.select("profiles", select="id", id=f"eq.{owner}", role="eq.admin", limit="1"))


class JobCtx:
    def __init__(self, rt: Runtime, table: str, job: dict, min_gap: float = 1.5):
        self.rt = rt
        self.supa = rt.supa
        self.table = table
        self.job = job
        self.id = job["id"]
        self.min_gap = min_gap  # jeda antar kiriman progres = max(SEND_GAP, min_gap)
        self.t0 = time.monotonic()
        self.est0: float | None = None  # perkiraan awal total (detik) — untuk ringkasan log
        self.cache_hits = 0  # baris yang diambil dari cache (ringkasan log job tts)
        self.sent = 0  # jumlah patch progres yang terkirim
        self._cv = threading.Condition()
        self._pending: dict | None = None
        self._thread: threading.Thread | None = None
        self._closed = False
        self._busy = False
        self._last_send = 0.0
        self._cancel: str | None = None
        self._confirmed = time.monotonic()  # baru diklaim = masih 'proses'
        self._eta: tuple[float, float] | None = None  # (detik sisa, waktu diset)
        self._warned = 0.0

    # ------------------------------------------------------------------ kirim ke Supabase
    def _patch(self, patch: dict) -> list[dict]:
        return self.supa.update(self.table, {"id": f"eq.{self.id}", "status": "eq.proses"}, patch)

    def _status_now(self) -> str:
        rows = self.supa.select(self.table, select="status", id=f"eq.{self.id}")
        return rows[0]["status"] if rows else "batal"

    # ------------------------------------------------------------------ progres (non-blocking)
    def progress(self, p: float, msg: str | None = None, force: bool = False) -> None:  # noqa: ARG002 (force: semua kiriman sudah secepatnya)
        """catat progres (0..0,99) + pesan; langsung kembali. Sudah ketahuan batal → Cancelled dilempar di sini (titik aman)."""
        if self._cancel:
            raise Cancelled(self._cancel)
        patch: dict = {"progress": round(max(0.0, min(0.99, float(p))), 3)}
        if msg:
            patch["message"] = msg
        with self._cv:
            if self._closed:
                return
            self._pending = {**self._pending, **patch} if self._pending else patch
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._run, name=f"progres-{str(self.id)[:8]}", daemon=True)
                self._thread.start()
            self._cv.notify_all()

    def eta(self, sec: float | None) -> None:
        """perkiraan sisa waktu job (detik) untuk pesan progres berikutnya; None = tanpa perkiraan"""
        try:
            ok = sec is not None and math.isfinite(float(sec))
        except (TypeError, ValueError):
            ok = False
        self._eta = (max(0.0, float(sec)), time.monotonic()) if ok else None  # type: ignore[arg-type]

    def left(self) -> float | None:
        """sisa perkiraan saat ini (detik), None kalau belum ada"""
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
                wait = max(SEND_GAP, float(self.min_gap or 0)) - (time.monotonic() - self._last_send)
                if wait > 0:
                    self._cv.wait(wait)
                    continue
                patch, self._pending = self._pending, None
                if "message" in patch:
                    patch["message"] = with_eta(patch["message"], self.left())
                self._busy = True
            got: list[dict] | None = None
            try:
                got = self._patch(patch)
                self.sent += 1
            except Exception as e:  # internet putus: tidak menghentikan job, progres berikutnya dicoba lagi
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
            elif got is not None and not self._closed:  # patch tidak mengenai baris: job sudah bukan 'proses'
                try:
                    st = self._status_now()
                except Exception:
                    st = None
                if st != "proses":
                    self._cancel = st or "batal"

    def close(self) -> None:
        """hentikan pengirim progres: patch yang belum terkirim dibuang, kiriman yang sedang jalan ditunggu sebentar"""
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

    # ------------------------------------------------------------------ batal
    def check_cancel(self, force: bool = False) -> None:
        """
        lempar Cancelled kalau job sudah bukan 'proses'. Tanpa force: tanda dari pengirim progres; tanya server hanya kalau status
        belum terkonfirmasi > CANCEL_CHECK_SEC detik (jaringan putus → dianggap belum batal). force=True: selalu tanya server.
        """
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

    # ------------------------------------------------------------------ akhir job
    def done(self, patch: dict, message: str = "Selesai") -> None:
        self.close()
        got = self._patch({"status": "selesai", "progress": 1, "finished_at": now_iso(), "message": message, **patch})
        if not got:
            raise Cancelled("batal")

    def fail(self, message: str) -> None:
        self.close()
        try:
            self._patch({"status": "gagal", "finished_at": now_iso(), "message": message[:500]})
        except Exception as e:  # jaringan putus saat menandai gagal: cukup dicatat
            log.error("Gagal menandai job %s gagal: %s", self.id, e)

    def requeue(self, message: str) -> None:
        self.close()
        try:
            self._patch({"status": "antri", "progress": 0, "worker": None, "started_at": None, "message": message})
        except Exception as e:
            log.error("Gagal mengembalikan job %s ke antrian: %s", self.id, e)
