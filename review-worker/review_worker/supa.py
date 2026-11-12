"""Klien Supabase CS Tracker (REST + Storage) dengan SERVICE ROLE — hanya di laptop (pemilik: worker-inti).
Pola sama dengan voice-worker/studio_worker/supa.py (httpx, retry 5xx/429/putus), bucket "asisten-review" (privat).
Tabel & RPC: KONTRAK.md §1. Supabase tidak terjangkau → SupaError (pemanggil memutuskan: tunggu / simpan lokal).
httpx.Client aman dipakai bersama antar thread (detak jantung, pengirim progres, thread utama)."""
from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import quote

import httpx

from . import log as rlog

BUCKET = "asisten-review"
PRIORITAS = ["video", "materi", "sinkron", "uji"]
log = rlog.get("supa")
# pesan awam kalau tabel / fungsi migration-23 belum ada (PostgREST 404 / PGRST202 / PGRST205 / 42P01)
BELUM_MIGRASI = "Tabel Asisten Review belum ada di Supabase. Jalankan supabase/migration-23-asisten-review.sql di SQL Editor dulu."


class SupaError(Exception):
    def __init__(self, msg: str, status: Optional[int] = None):
        super().__init__(msg)
        self.status = status


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def norm_path(p: str) -> str:
    """path storage relatif bucket: buang "/" & awalan "asisten-review/", tolak ".." """
    p = (p or "").strip().replace("\\", "/").lstrip("/")
    if p.startswith(f"{BUCKET}/"):
        p = p[len(BUCKET) + 1:]
    if not p or ".." in p.split("/"):
        raise ValueError("path storage tidak valid")
    return p


def _belum_migrasi(status: int, teks: str) -> bool:
    return status in (404,) or any(k in teks for k in ("PGRST202", "PGRST205", "42P01", "42883", "schema cache"))


class Supa:
    def __init__(self, url: str, key: str, worker_id: str = "", retries: int = 5, client: Optional[httpx.Client] = None):
        self.url = (url or "").rstrip("/")
        self.worker = worker_id
        self.retries = max(1, retries)
        self.http = client or httpx.Client(timeout=httpx.Timeout(60, connect=15), limits=httpx.Limits(max_connections=12, max_keepalive_connections=6))
        self._h = {"apikey": key, "Authorization": f"Bearer {key}"}
        self.sleep: Callable[[float], None] = time.sleep  # dipalsukan saat tes

    def __repr__(self) -> str:  # kunci tidak pernah tercetak
        return f"Supa(url={self.url!r}, worker={self.worker!r})"

    # ------------------------------------------------------------------ dasar
    def _req(self, method: str, path: str, *, params: Optional[dict] = None, json: Any = None,
             content: bytes | Callable[[], Any] | None = None, headers: Optional[dict] = None, timeout: Optional[float] = None,
             ok404: bool = False) -> httpx.Response:
        delay, last = 1.0, None
        for i in range(self.retries):
            body = content() if callable(content) else content
            try:
                r = self.http.request(method, self.url + path, params=params, json=json, content=body,
                                      headers={**self._h, **(headers or {})},
                                      timeout=timeout if timeout is not None else httpx.USE_CLIENT_DEFAULT)
            except (httpx.InvalidURL, httpx.UnsupportedProtocol, UnicodeError, ValueError) as e:
                raise SupaError(f"SUPABASE_URL di file .env salah format ({type(e).__name__}). Isi persis seperti: "
                                "SUPABASE_URL=https://xxxxxxxx.supabase.co") from e
            except httpx.TransportError as e:  # jaringan putus / DNS / timeout
                last = e
            else:
                if r.status_code < 400:
                    return r
                if ok404 and r.status_code in (400, 404):
                    return r
                teks = r.text[:300]
                if r.status_code == 401 or (r.status_code == 403 and "JWT" in teks):
                    raise SupaError("Kunci SUPABASE_SERVICE_ROLE_KEY di .env ditolak Supabase (salah / kedaluwarsa). Salin lagi dari "
                                    "Supabase → Project Settings → API → service_role.", r.status_code)
                if r.status_code < 500 and r.status_code != 429:
                    if _belum_migrasi(r.status_code, teks) and "/storage/" not in path:
                        raise SupaError(f"{BELUM_MIGRASI} ({method} {path.split('?')[0]} → {r.status_code})", r.status_code)
                    raise SupaError(f"{method} {path.split('?')[0]} → {r.status_code}: {teks}", r.status_code)
                last = SupaError(f"{method} {path.split('?')[0]} → {r.status_code}: {teks[:200]}", r.status_code)
            finally:
                close = getattr(body, "close", None)
                if callable(close):
                    close()
            if i < self.retries - 1:
                log.warning("Koneksi ke Supabase bermasalah (%s), coba lagi %.0f dtk…", type(last).__name__, delay)
                self.sleep(delay)
                delay = min(delay * 2, 30)
        raise SupaError(f"Supabase tidak bisa dihubungi: {last}") from last

    # ------------------------------------------------------------------ tabel (gaya PostgREST)
    def select(self, table: str, **params: Any) -> list[dict]:
        return self._req("GET", f"/rest/v1/{table}", params=params).json()

    def count(self, table: str, **params: Any) -> int:
        r = self._req("GET", f"/rest/v1/{table}", params={**params, "select": params.get("select", "id"), "limit": "1"},
                      headers={"Prefer": "count=exact"})
        try:
            return int(r.headers.get("content-range", "").split("/")[-1])
        except ValueError:
            return len(r.json())

    def insert(self, table: str, rows: dict | list[dict], *, on_conflict: Optional[str] = None, merge: bool = False,
               ignore: bool = False) -> list[dict]:
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

    def delete(self, table: str, filters: dict[str, str]) -> None:
        if not filters:
            raise ValueError("delete tanpa filter ditolak")
        self._req("DELETE", f"/rest/v1/{table}", params=filters)

    def rpc(self, fn: str, args: dict) -> Any:
        r = self._req("POST", f"/rest/v1/rpc/{fn}", json=args)
        return r.json() if r.content else None

    # ------------------------------------------------------------------ pintasan yang dipakai modul lain
    def klaim_job(self, kinds: Optional[list[str]] = None) -> Optional[dict]:
        """rpc review_claim_job(p_worker, p_kinds) → baris review_jobs atau None"""
        rows = self.rpc("review_claim_job", {"p_worker": self.worker, "p_kinds": list(kinds or PRIORITAS)})
        if isinstance(rows, dict):
            return rows if rows.get("id") else None
        return rows[0] if rows else None

    def detak(self, info: dict) -> None:
        """upsert review_workers {id, last_seen, info} (format info: KONTRAK.md §1.6)"""
        self.insert("review_workers", {"id": self.worker, "last_seen": now_iso(), "info": info}, on_conflict="id", merge=True)

    def mati(self, info: dict) -> None:
        """berhenti rapi → website langsung menampilkan "mati" (penanda tahun 2000, pola studio_workers)"""
        self.update("review_workers", {"id": f"eq.{self.worker}"}, {"last_seen": "2000-01-01T00:00:00Z", "info": {**info, "status": "mati"}})

    def simpan_hasil(self, row: dict) -> dict:
        """upsert review_results on_conflict=scope,video_id (merge) → baris tersimpan (dengan id)"""
        got = self.insert("review_results", row, on_conflict="scope,video_id", merge=True)
        return got[0] if got else {}

    def tambah_biaya(self, day: str, cost: float, calls: int, inp: int, out: int, cache_read: int, cache_write: int) -> float:
        """rpc review_add_usage → total biaya USD hari itu"""
        v = self.rpc("review_add_usage", {"p_day": str(day), "p_cost": round(float(cost), 6), "p_calls": int(calls), "p_input": int(inp),
                                          "p_output": int(out), "p_cache_read": int(cache_read), "p_cache_write": int(cache_write)})
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    # ------------------------------------------------------------------ storage bucket asisten-review
    def _obj(self, path: str) -> str:
        return f"/storage/v1/object/{BUCKET}/{quote(norm_path(path), safe='/-_.~')}"

    def upload(self, path: str, data: bytes | Path, content_type: str, timeout: float = 600) -> str:
        p = norm_path(path)
        if isinstance(data, Path):
            src = data
            content: bytes | Callable[[], Any] = lambda: open(src, "rb")  # dibuka ulang tiap percobaan
        else:
            content = data
        self._req("POST", self._obj(p), content=content, headers={"Content-Type": content_type, "x-upsert": "true",
                                                                   "Cache-Control": "max-age=3600"}, timeout=timeout)
        return p

    def download(self, path: str, dest: Optional[Path] = None, timeout: float = 600) -> bytes:
        r = self._req("GET", self._obj(path), timeout=timeout, ok404=True)
        if r.status_code >= 400:
            raise SupaError(f"File tidak ditemukan di penyimpanan: {norm_path(path)}", r.status_code)
        if dest is not None:
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_name(dest.name + ".part")
            tmp.write_bytes(r.content)
            tmp.replace(dest)
        return r.content

    def remove(self, paths: list[str]) -> None:
        ps = [norm_path(p) for p in paths if p]
        if ps:
            self._req("DELETE", f"/storage/v1/object/{BUCKET}", json={"prefixes": ps})

    def close(self) -> None:
        self.http.close()
