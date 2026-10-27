"""Klien Supabase mini (REST + Storage) pakai httpx dengan SERVICE ROLE — hanya di laptop, jangan pernah dikirim ke browser.

- tabel: select / insert / upsert / update (PostgREST)
- klaim job atomik: PATCH ...?id=eq.<id>&status=eq.antri + Prefer return=representation → baris kosong = sudah diambil worker lain
- storage bucket privat "studio": upload (upsert) / download
- semua request di-retry saat jaringan putus / server 5xx / 429
- aman dipakai bersama dari beberapa thread (httpx.Client thread-safe, pool koneksi cukup untuk UploadPool + progres + detak):
  UploadPool mengunggah file di latar sementara baris VO berikutnya dibuat
"""
from __future__ import annotations

import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

import httpx

from . import log as vlog

BUCKET = "studio"
log = vlog.get("supa")


class SupaError(Exception):
    def __init__(self, msg: str, status: int | None = None):
        super().__init__(msg)
        self.status = status


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def norm_path(p: str) -> str:
    """path storage relatif bucket: buang "/" & awalan "studio/", tolak ".." """
    p = (p or "").strip().replace("\\", "/").lstrip("/")
    if p.startswith(f"{BUCKET}/"):
        p = p[len(BUCKET) + 1 :]
    if not p or ".." in p.split("/"):
        raise ValueError(f"path storage tidak valid: {p!r}")
    return p


class Supa:
    def __init__(self, url: str, key: str, worker_id: str = "", client: httpx.Client | None = None, retries: int = 5):
        self.url = url.rstrip("/")
        self.worker = worker_id
        self.retries = retries
        # satu Client dipakai bersama oleh thread utama, pengirim progres & UploadPool (httpx.Client thread-safe); koneksi keep-alive
        # dipakai ulang → tiap request tidak perlu jabat tangan TLS baru
        self.http = client or httpx.Client(timeout=httpx.Timeout(60, connect=15), limits=httpx.Limits(max_connections=16, max_keepalive_connections=8))
        self.h = {"apikey": key, "Authorization": f"Bearer {key}"}
        self.sleep: Callable[[float], None] = time.sleep  # bisa dipalsukan saat tes

    # ------------------------------------------------------------------ dasar
    def _req(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        content: bytes | Callable[[], Any] | None = None,
        headers: dict[str, str] | None = None,
        timeout: float | None = None,
        ok404: bool = False,
    ) -> httpx.Response:
        delay = 1.0
        last: Exception | None = None
        for i in range(self.retries):
            body = content() if callable(content) else content
            try:
                r = self.http.request(
                    method,
                    self.url + path,
                    params=params,
                    json=json,
                    content=body,
                    headers={**self.h, **(headers or {})},
                    timeout=timeout if timeout is not None else httpx.USE_CLIENT_DEFAULT,
                )
            except (httpx.InvalidURL, httpx.UnsupportedProtocol, UnicodeError, ValueError) as e:
                # alamat SUPABASE_URL salah format (mis. berisi kunci, bukan alamat) → percuma diulang
                raise SupaError(f"SUPABASE_URL di file .env salah format ({type(e).__name__}). Isi persis seperti: SUPABASE_URL=https://xxxxxxxx.supabase.co") from e
            except httpx.TransportError as e:  # jaringan putus / DNS / timeout
                last = e
            else:
                if r.status_code < 400:
                    return r
                if ok404 and r.status_code in (400, 404):
                    return r
                if r.status_code < 500 and r.status_code != 429:
                    raise SupaError(f"{method} {path} → {r.status_code}: {r.text[:300]}", r.status_code)
                last = SupaError(f"{method} {path} → {r.status_code}: {r.text[:200]}", r.status_code)
            finally:
                close = getattr(body, "close", None)
                if callable(close):
                    close()
            if i < self.retries - 1:
                log.warning("Koneksi ke Supabase bermasalah (%s), coba lagi %.0f dtk…", type(last).__name__, delay)
                self.sleep(delay)
                delay = min(delay * 2, 30)
        raise SupaError(f"Supabase tidak bisa dihubungi: {last}") from last

    # ------------------------------------------------------------------ tabel
    def select(self, table: str, **params: Any) -> list[dict]:
        r = self._req("GET", f"/rest/v1/{table}", params=params)
        return r.json()

    def insert(self, table: str, rows: dict | list[dict], *, on_conflict: str | None = None, merge: bool = False, ignore: bool = False) -> list[dict]:
        prefer = ["return=representation"]
        if merge:
            prefer.append("resolution=merge-duplicates")
        elif ignore:
            prefer.append("resolution=ignore-duplicates")
        params = {"on_conflict": on_conflict} if on_conflict else None
        r = self._req("POST", f"/rest/v1/{table}", params=params, json=rows, headers={"Prefer": ",".join(prefer)})
        return r.json() if r.content else []

    def update(self, table: str, filters: dict[str, str], patch: dict) -> list[dict]:
        """filters gaya PostgREST, mis. {"id": "eq.<id>", "status": "eq.proses"}; balikan = baris yang benar-benar berubah"""
        r = self._req("PATCH", f"/rest/v1/{table}", params=filters, json=patch, headers={"Prefer": "return=representation"})
        return r.json() if r.content else []

    def count(self, table: str, **params: Any) -> int:
        r = self._req("GET", f"/rest/v1/{table}", params={**params, "select": "id", "limit": "1"}, headers={"Prefer": "count=exact", "Range-Unit": "items"})
        rng = r.headers.get("content-range", "")
        try:
            return int(rng.split("/")[-1])
        except ValueError:
            return len(r.json())

    def claim(self, table: str, extra: dict[str, str] | None = None) -> dict | None:
        """ambil 1 job 'antri' paling lama secara atomik (aman walau ada 2 worker)"""
        rows = self.select(table, select="id", status="eq.antri", order="created_at.asc", limit="5", **(extra or {}))
        for row in rows:
            got = self.update(
                table,
                {"id": f"eq.{row['id']}", "status": "eq.antri"},
                {"status": "proses", "worker": self.worker, "started_at": now_iso(), "progress": 0, "message": "Mulai diproses di laptop…"},
            )
            if got:
                return got[0]
        return None

    def heartbeat(self, info: dict) -> None:
        self.insert("studio_workers", {"id": self.worker, "last_seen": now_iso(), "info": info}, on_conflict="id", merge=True)

    # ------------------------------------------------------------------ storage
    def _obj(self, path: str) -> str:
        return f"/storage/v1/object/{BUCKET}/{quote(norm_path(path), safe='/-_.~')}"

    def upload(self, path: str, data: bytes | Path, content_type: str, timeout: float = 600) -> str:
        p = norm_path(path)
        if isinstance(data, Path):
            src = data
            content: bytes | Callable[[], Any] = lambda: open(src, "rb")  # dibuka ulang tiap percobaan
        else:
            content = data
        self._req(
            "POST",
            self._obj(p),
            content=content,
            headers={"Content-Type": content_type, "x-upsert": "true", "Cache-Control": "max-age=3600"},
            timeout=timeout,
        )
        return p

    def download(self, path: str, dest: Path | None = None, timeout: float = 600) -> bytes:
        r = self._req("GET", self._obj(path), timeout=timeout, ok404=True)
        if r.status_code >= 400:
            raise SupaError(f"File tidak ditemukan di penyimpanan: {path}", r.status_code)
        if dest is not None:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(r.content)
        return r.content

    def close(self) -> None:
        self.http.close()


class UploadPool:
    """
    Unggah ke storage di thread latar (paralel, maks `workers` sekaligus) supaya GPU tidak menunggu jaringan:
      pool.submit(path, data, ctype) → Future (hasil = path storage); data boleh bytes / Path / fungsi tanpa argumen yang membalikan
      bytes atau Path (mis. encode mp3 dulu di latar). pool.wait() → tunggu semua, lempar error PERTAMA (urut submit), balikan daftar path.
    `supa` cukup punya upload(path, data, content_type) — klien Supa asli aman dipakai bersama antar thread. Dipakai dengan `with`:
    keluar karena error → unggahan yang belum mulai dibatalkan, yang sedang jalan ditunggu (file sementara jangan dihapus duluan).
    """

    def __init__(self, supa, workers: int = 3):
        self.supa = supa
        self.workers = max(1, int(workers or 1))
        self._ex = ThreadPoolExecutor(max_workers=self.workers, thread_name_prefix="unggah")
        self._futs: list[Future] = []
        self._lock = threading.Lock()

    def _one(self, path: str, data, ctype: str) -> str:
        if callable(data):  # kerja berat (encode mp3) ikut di latar
            data = data()
        got = self.supa.upload(path, data, ctype)
        return got if isinstance(got, str) else path

    def submit(self, path: str, data, ctype: str) -> Future:
        f = self._ex.submit(self._one, path, data, ctype)
        with self._lock:
            self._futs.append(f)
        return f

    def pending(self) -> int:
        with self._lock:
            return sum(1 for f in self._futs if not f.done())

    def check(self) -> None:
        """lempar error unggahan yang SUDAH selesai & gagal (tanpa menunggu yang masih jalan)"""
        with self._lock:
            futs = list(self._futs)
        for f in futs:
            if f.done() and not f.cancelled() and f.exception() is not None:
                raise f.exception()  # type: ignore[misc]

    def wait(self) -> list[str]:
        with self._lock:
            futs = list(self._futs)
        out, first = [], None
        for f in futs:
            try:
                out.append(f.result())
            except Exception as e:  # semua ditunggu dulu (file sementara masih dibaca), baru error pertama dilempar
                first = first or e
        if first is not None:
            raise first
        return out

    def close(self, cancel: bool = False) -> None:
        self._ex.shutdown(wait=True, cancel_futures=cancel)

    def __enter__(self) -> "UploadPool":
        return self

    def __exit__(self, et, ev, tb) -> None:
        self.close(cancel=et is not None)
