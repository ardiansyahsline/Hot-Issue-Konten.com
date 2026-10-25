"""Konteks bersama job: progres (dibatasi frekuensinya), cek batal, selesai / gagal dengan pesan bahasa awam."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from . import log as vlog
from .supa import Supa, now_iso

log = vlog.get("job")


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


class JobCtx:
    def __init__(self, rt: Runtime, table: str, job: dict, min_gap: float = 1.5):
        self.rt = rt
        self.supa = rt.supa
        self.table = table
        self.job = job
        self.id = job["id"]
        self.min_gap = min_gap
        self._last = 0.0
        self._last_p = -1.0

    def _patch(self, patch: dict) -> list[dict]:
        return self.supa.update(self.table, {"id": f"eq.{self.id}", "status": "eq.proses"}, patch)

    def progress(self, p: float, msg: str | None = None, force: bool = False) -> None:
        p = max(0.0, min(0.99, float(p)))
        now = time.time()
        if not force and now - self._last < self.min_gap and abs(p - self._last_p) < 0.2:
            return
        patch: dict = {"progress": round(p, 3)}
        if msg:
            patch["message"] = msg
        if not self._patch(patch):
            self.check_cancel(force=True)
        self._last, self._last_p = now, p

    def check_cancel(self, force: bool = False) -> None:
        rows = self.supa.select(self.table, select="status", id=f"eq.{self.id}")
        st = rows[0]["status"] if rows else "batal"
        if st != "proses":
            raise Cancelled(st)

    def done(self, patch: dict, message: str = "Selesai") -> None:
        got = self._patch({"status": "selesai", "progress": 1, "finished_at": now_iso(), "message": message, **patch})
        if not got:
            raise Cancelled("batal")

    def fail(self, message: str) -> None:
        try:
            self._patch({"status": "gagal", "finished_at": now_iso(), "message": message[:500]})
        except Exception as e:  # jaringan putus saat menandai gagal: cukup dicatat
            log.error("Gagal menandai job %s gagal: %s", self.id, e)

    def requeue(self, message: str) -> None:
        try:
            self._patch({"status": "antri", "progress": 0, "worker": None, "started_at": None, "message": message})
        except Exception as e:
            log.error("Gagal mengembalikan job %s ke antrian: %s", self.id, e)
