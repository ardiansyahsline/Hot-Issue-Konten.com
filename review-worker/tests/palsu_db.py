"""Tiruan DB replika & Supabase untuk selftest (pemilik: worker-inti). TANPA jaringan / VPN / Postgres.

- ReplikaPalsu(video, campaign, keputusan): antarmuka sama dengan replika.Replika (cek_koneksi, kenali_skema, ambil_video,
  cari_video, ambil_campaign, daftar_alasan, daftar_kandidat_sampel, keputusan_manusia, tunggu_koneksi, tutup).
  `putus=N` → N panggilan pertama melempar ReplikaError (simulasi VPN putus).
- SupaPalsu(): antarmuka sama dengan supa.Supa, data di dict `tabel` + `storage`. Filter gaya PostgREST yang dikenali: eq, neq,
  gt, gte, lt, lte, in.(a,b), is.null / is.true / is.false, not.is.null, cs.{a,b}, like/ilike (* = wildcard); order, limit, select.
  RPC: review_claim_job (prioritas & satu-per-kelas seperti migration-23), review_add_usage, can_use_asisten_review.
Dipakai juga oleh hakim-ai / hakim-uji / worker-media (KONTRAK.md §9).
"""
from __future__ import annotations

import copy
import fnmatch
import itertools
import json
import sys
import threading
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from review_worker.platform import tebak_platform  # noqa: E402
from review_worker.replika import ReplikaError  # noqa: E402
from review_worker.skema import CampaignDB, KandidatSampel, KeputusanManusia, VideoDB, VideoRef  # noqa: E402
from review_worker.supa import SupaError  # noqa: E402

PRIORITAS = ["video", "materi", "sinkron", "uji"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ================================================================== DB replika palsu
class ReplikaPalsu:
    def __init__(self, video: Optional[list[VideoDB]] = None, campaign: Optional[list[CampaignDB]] = None,
                 keputusan: Optional[dict[str, KeputusanManusia]] = None, putus: int = 0):
        self.video = {v.id: v for v in (video or [])}
        self.campaign = {c.id: c for c in (campaign or [])}
        self.keputusan = dict(keputusan or {})
        self.putus = putus  # sisa panggilan yang gagal (VPN putus)
        self.panggilan: list[str] = []  # catatan nama method (untuk tes)
        self.status_db = "belum_dicek"

    def _cek(self, nama: str) -> None:
        self.panggilan.append(nama)
        if self.putus > 0:
            self.putus -= 1
            self.status_db = "tidak_terhubung"
            raise ReplikaError("Database Konten.com tidak bisa dihubungi. VPN sudah tersambung?")
        self.status_db = "ok"

    def cek_koneksi(self) -> Optional[str]:
        try:
            self._cek("cek_koneksi")
        except ReplikaError as e:
            return str(e)
        return None

    def tunggu_koneksi(self, maks_detik: float = 1800, jeda: float = 60, cek_batal=None, saat_tunggu=None) -> None:
        # versi palsu: tanpa tidur — coba sampai tersambung atau jatah habis
        for _ in range(max(1, int(maks_detik // max(jeda, 1)) + 1)):
            if cek_batal:
                cek_batal()
            if self.cek_koneksi() is None:
                return
            if saat_tunggu:
                saat_tunggu(True)
        raise ReplikaError("Database Konten.com tidak bisa dihubungi selama 30 menit. VPN sudah tersambung? Klik Lanjutkan sesudahnya.")

    def kenali_skema(self, nilai: bool = False) -> dict[str, list[str]]:
        self._cek("kenali_skema")
        return {"tracked_videos": list(VideoDB.model_fields), "campaigns": list(CampaignDB.model_fields)}

    def ambil_video(self, video_id: str) -> Optional[VideoDB]:
        self._cek("ambil_video")
        v = self.video.get(str(video_id))
        return v.model_copy(deep=True) if v else None

    def cari_video(self, ref: VideoRef) -> Optional[VideoDB]:
        self._cek("cari_video")
        if ref.jenis == "id":
            v = self.video.get(ref.nilai)
            return v.model_copy(deep=True) if v else None
        for v in self.video.values():
            plat, vid = tebak_platform(v.url)
            if vid == ref.nilai and (ref.platform in (None, plat)):
                return v.model_copy(deep=True)
        return None

    def ambil_campaign(self, campaign_id: str) -> Optional[CampaignDB]:
        self._cek("ambil_campaign")
        c = self.campaign.get(str(campaign_id))
        return c.model_copy(deep=True) if c else None

    def daftar_alasan(self) -> list[tuple[str, int, Optional[str], Optional[str]]]:
        self._cek("daftar_alasan")
        hit: dict[str, list] = {}
        for k in self.keputusan.values():
            if k.keputusan == "reject" and k.alasan_label:
                h = hit.setdefault(k.alasan_label, [0, k.diputuskan, k.diputuskan])
                h[0] += 1
                if k.diputuskan:
                    h[1] = min(filter(None, [h[1], k.diputuskan]))
                    h[2] = max(filter(None, [h[2], k.diputuskan]))
        return sorted(((lb, n, a, b) for lb, (n, a, b) in hit.items()), key=lambda t: -t[1])

    def daftar_kandidat_sampel(self, dari: Optional[str] = None, sampai: Optional[str] = None, batas: int = 20000) -> list[KandidatSampel]:
        self._cek("daftar_kandidat_sampel")
        out = []
        for vid, k in self.keputusan.items():
            if not k.keputusan:
                continue
            tgl = (k.diputuskan or "2026-01-01")[:10]
            if (dari and tgl < dari) or (sampai and tgl > sampai):
                continue
            v = self.video.get(vid)
            out.append(KandidatSampel(video_id=vid, campaign_id=v.campaign_id if v else None, keputusan=k.keputusan,
                                      alasan_label=k.alasan_label, reviewer=k.reviewer, tanggal=tgl))
        return out[:batas]

    def keputusan_manusia(self, video_ids: list[str]) -> dict[str, KeputusanManusia]:
        self._cek("keputusan_manusia")
        return {str(i): self.keputusan[str(i)].model_copy() for i in video_ids if str(i) in self.keputusan}

    def tutup(self) -> None:
        self.panggilan.append("tutup")


# ================================================================== Supabase palsu
def _cocok(nilai: Any, aturan: str) -> bool:
    neg = False
    if aturan.startswith("not."):
        neg, aturan = True, aturan[4:]
    op, _, arg = aturan.partition(".")

    def s(x: Any) -> str:
        if isinstance(x, bool):
            return "true" if x else "false"
        return "" if x is None else str(x)

    if op == "eq":
        hasil = nilai is not None and s(nilai) == arg
    elif op == "neq":
        hasil = s(nilai) != arg
    elif op in ("gt", "gte", "lt", "lte"):
        if nilai is None:
            hasil = False
        else:
            try:
                a, b = float(nilai), float(arg)
            except (TypeError, ValueError):
                a, b = s(nilai), arg  # type: ignore[assignment]
            hasil = {"gt": a > b, "gte": a >= b, "lt": a < b, "lte": a <= b}[op]  # type: ignore[operator]
    elif op == "in":
        isi = [x.strip().strip('"') for x in arg.strip("()").split(",") if x.strip()]
        hasil = s(nilai) in isi
    elif op == "is":
        hasil = {"null": nilai is None, "true": nilai is True, "false": nilai is False}.get(arg, False)
    elif op == "cs":
        isi = [x.strip().strip('"') for x in arg.strip("{}").split(",") if x.strip()]
        hasil = isinstance(nilai, list) and all(x in [s(v) for v in nilai] for x in isi)
    elif op in ("like", "ilike"):
        pola = arg.replace("%", "*")
        hasil = fnmatch.fnmatchcase(s(nilai).lower() if op == "ilike" else s(nilai), pola.lower() if op == "ilike" else pola)
    else:
        raise SupaError(f"filter palsu tidak dikenal: {aturan}", 400)
    return not hasil if neg else hasil


class SupaPalsu:
    """Supabase di memori. `gagal=N` → N request berikutnya melempar SupaError (internet putus). Kunci akses:
    `admin` = set uid admin, `granted` = set uid yang dibuka tab asisten_review."""

    def __init__(self, worker_id: str = "review-palsu"):
        self.worker = worker_id
        self.url = "https://palsu.supabase.co"
        self.tabel: dict[str, list[dict]] = {}
        self.storage: dict[str, tuple[bytes, str]] = {}
        self.admin: set[str] = set()
        self.granted: set[str] = set()
        self.gagal = 0
        # kolom yang "belum ada" per tabel (meniru migration belum dijalankan): insert/update memakainya → error PGRST204
        self.kolom_hilang: dict[str, set[str]] = {}
        self.tanpa_condong = False
        self.tanpa_condong_sejak = 0.0
        self.log: list[tuple[str, str]] = []  # (aksi, tabel/fungsi)
        self._id = itertools.count(1)
        self._lock = threading.RLock()

    # ---------------------------------------------------------------- dasar
    def _req(self, aksi: str, nama: str) -> None:
        self.log.append((aksi, nama))
        if self.gagal > 0:
            self.gagal -= 1
            raise SupaError("Supabase tidak bisa dihubungi: palsu putus")

    def _rows(self, table: str) -> list[dict]:
        return self.tabel.setdefault(table, [])

    @staticmethod
    def _filter(rows: list[dict], filters: dict[str, Any]) -> list[dict]:
        out = rows
        for k, v in filters.items():
            if k in ("select", "order", "limit", "offset", "on_conflict"):
                continue
            out = [r for r in out if _cocok(r.get(k), str(v))]
        return out

    def select(self, table: str, **params: Any) -> list[dict]:
        with self._lock:
            self._req("select", table)
            rows = self._filter(self._rows(table), params)
            order = params.get("order")
            if order:
                for part in reversed(str(order).split(",")):
                    col, _, arah = part.partition(".")
                    rows = sorted(rows, key=lambda r: (r.get(col) is None, r.get(col) if r.get(col) is not None else 0),
                                  reverse=arah.startswith("desc"))
            if params.get("offset"):
                rows = rows[int(params["offset"]):]
            if params.get("limit"):
                rows = rows[: int(params["limit"])]
            sel = params.get("select")
            if sel and sel != "*":
                cols = [c.strip() for c in str(sel).split(",") if c.strip() and "(" not in c]
                rows = [{c: r.get(c) for c in cols} for r in rows]
            return copy.deepcopy(rows)

    def count(self, table: str, **params: Any) -> int:
        return len(self.select(table, **{k: v for k, v in params.items() if k not in ("select", "limit")}))

    def _isi_bawaan(self, table: str, row: dict) -> dict:
        r = dict(row)
        if table in ("review_results", "review_feedback") and "id" not in r:
            r["id"] = next(self._id)
        if table in ("review_jobs", "review_runs", "review_materials") and "id" not in r:
            r["id"] = str(uuid.uuid4())
        if table == "review_jobs":
            r.setdefault("status", "antri")
            r.setdefault("progress", 0)
            r.setdefault("params", {})
            r.setdefault("done", 0)
            r.setdefault("total", 0)
        r.setdefault("created_at", _now())
        r["updated_at"] = _now()
        return r

    def insert(self, table: str, rows: dict | list[dict], *, on_conflict: Optional[str] = None, merge: bool = False,
               ignore: bool = False) -> list[dict]:
        with self._lock:
            self._req("insert", table)
            data = rows if isinstance(rows, list) else [rows]
            self._cek_kolom(table, data)
            tbl = self._rows(table)
            out = []
            keys = [k.strip() for k in on_conflict.split(",")] if on_conflict else None
            for row in data:
                ada = None
                if keys:
                    ada = next((r for r in tbl if all(str(r.get(k)) == str(row.get(k)) for k in keys)), None)
                if ada is not None:
                    if ignore:
                        continue
                    if not merge:
                        raise SupaError(f"duplicate key value violates unique constraint ({table})", 409)
                    ada.update(copy.deepcopy(row))
                    ada["updated_at"] = _now()
                    out.append(copy.deepcopy(ada))
                    continue
                if table == "review_jobs" and row.get("kind") == "uji" and row.get("status", "antri") == "antri":
                    if any(r.get("kind") == "uji" and r.get("status") == "antri" for r in tbl):
                        raise SupaError('duplicate key value violates unique constraint "review_jobs_one_uji_waiting"', 409)
                baru = self._isi_bawaan(table, copy.deepcopy(row))
                tbl.append(baru)
                out.append(copy.deepcopy(baru))
            return out

    def update(self, table: str, filters: dict[str, str], patch: dict) -> list[dict]:
        with self._lock:
            self._req("update", table)
            self._cek_kolom(table, [patch])
            for k in filters:
                if k in (self.kolom_hilang.get(table) or set()):
                    raise SupaError(f"PATCH /rest/v1/{table} → 400: {{\"code\":\"42703\",\"message\":\"column {table}.{k} does not exist\"}}", 400)
            hit = self._filter(self._rows(table), filters)
            if table == "review_jobs" and patch.get("status") == "antri":
                for r in hit:
                    if r.get("kind") == "uji" and any(x is not r and x.get("kind") == "uji" and x.get("status") == "antri"
                                                      for x in self._rows(table)):
                        raise SupaError('duplicate key value violates unique constraint "review_jobs_one_uji_waiting"', 409)
            for r in hit:
                r.update(copy.deepcopy(patch))
                r["updated_at"] = _now()
            return copy.deepcopy(hit)

    def delete(self, table: str, filters: dict[str, str]) -> None:
        with self._lock:
            self._req("delete", table)
            hapus = {id(r) for r in self._filter(self._rows(table), filters)}
            self.tabel[table] = [r for r in self._rows(table) if id(r) not in hapus]

    def rpc(self, fn: str, args: dict) -> Any:
        with self._lock:
            self._req("rpc", fn)
            if fn == "review_claim_job":
                return self._klaim(str(args.get("p_worker") or self.worker), list(args.get("p_kinds") or PRIORITAS))
            if fn == "review_add_usage":
                return self._tambah(args)
            if fn == "can_use_asisten_review":
                uid = str(args.get("uid") or "")
                return uid in self.admin or uid in self.granted
            raise SupaError(f"Could not find the function public.{fn}", 404)

    def _klaim(self, worker: str, kinds: list[str]) -> list[dict]:
        jobs = self._rows("review_jobs")
        kandidat = [j for j in jobs if j.get("status") == "antri" and j.get("kind") in kinds
                    and not any(b.get("status") == "proses" and (b.get("kind") == "uji") == (j.get("kind") == "uji") for b in jobs)]
        kandidat.sort(key=lambda j: (PRIORITAS.index(j["kind"]) if j["kind"] in PRIORITAS else 9, j.get("created_at") or ""))
        if not kandidat:
            return []
        j = kandidat[0]
        j.update(status="proses", worker=worker, started_at=_now(), finished_at=None, progress=0, message="Mulai diproses di laptop…")
        return [copy.deepcopy(j)]

    def _tambah(self, a: dict) -> float:
        day = str(a.get("p_day"))
        rows = self._rows("review_usage_daily")
        r = next((x for x in rows if str(x.get("day")) == day), None)
        if r is None:
            r = {"day": day, "cost_usd": 0.0, "calls": 0, "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0}
            rows.append(r)
        r["cost_usd"] = round(float(r["cost_usd"]) + max(0.0, float(a.get("p_cost") or 0)), 6)
        r["calls"] += max(0, int(a.get("p_calls") or 0))
        r["input_tokens"] += max(0, int(a.get("p_input") or 0))
        r["output_tokens"] += max(0, int(a.get("p_output") or 0))
        r["cache_read_tokens"] += max(0, int(a.get("p_cache_read") or 0))
        r["cache_write_tokens"] += max(0, int(a.get("p_cache_write") or 0))
        return float(r["cost_usd"])

    # ---------------------------------------------------------------- pintasan (sama dengan supa.Supa)
    def klaim_job(self, kinds: Optional[list[str]] = None) -> Optional[dict]:
        rows = self.rpc("review_claim_job", {"p_worker": self.worker, "p_kinds": kinds or PRIORITAS})
        return rows[0] if rows else None

    def detak(self, info: dict) -> None:
        self.insert("review_workers", {"id": self.worker, "last_seen": _now(), "info": info}, on_conflict="id", merge=True)

    def mati(self, info: dict) -> None:
        self.update("review_workers", {"id": f"eq.{self.worker}"}, {"last_seen": "2000-01-01T00:00:00Z", "info": {**info, "status": "mati"}})

    def _cek_kolom(self, table: str, data: list[dict]) -> None:
        hilang = self.kolom_hilang.get(table) or set()
        for r in data:
            for k in r:
                if k in hilang:
                    raise SupaError(f"POST /rest/v1/{table} → 400: {{\"code\":\"PGRST204\",\"details\":null,\"hint\":null,"
                                    f"\"message\":\"Could not find the '{k}' column of '{table}' in the schema cache\"}}", 400)

    def simpan_hasil(self, row: dict) -> dict:
        from review_worker.supa import simpan_tahan_condong

        return simpan_tahan_condong(self, row, lambda r: self.insert("review_results", r, on_conflict="scope,video_id", merge=True))

    def tambah_biaya(self, day: str, cost: float, calls: int, inp: int, out: int, cache_read: int, cache_write: int) -> float:
        return float(self.rpc("review_add_usage", {"p_day": str(day), "p_cost": cost, "p_calls": calls, "p_input": inp, "p_output": out,
                                                    "p_cache_read": cache_read, "p_cache_write": cache_write}))

    def tambah_job(self, kind: str, params: Optional[dict] = None, created_by: Optional[str] = None) -> dict:
        """pintasan tes: masukkan job 'antri' seperti website (params tanpa '@' dicek seperti RLS)"""
        p = params or {}
        if "@" in json.dumps(p):
            raise SupaError("new row violates row-level security policy (params berisi @)", 403)
        return self.insert("review_jobs", {"kind": kind, "params": p, "created_by": created_by})[0]

    # storage
    def upload(self, path: str, data: bytes | Path, content_type: str, timeout: float = 600) -> str:
        self._req("upload", path)
        isi = data.read_bytes() if isinstance(data, Path) else bytes(data)
        self.storage[path.lstrip("/")] = (isi, content_type)
        return path.lstrip("/")

    def download(self, path: str, dest: Optional[Path] = None, timeout: float = 600) -> bytes:
        self._req("download", path)
        if path.lstrip("/") not in self.storage:
            raise SupaError(f"File tidak ditemukan di penyimpanan: {path}", 404)
        isi = self.storage[path.lstrip("/")][0]
        if dest is not None:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(isi)
        return isi

    def remove(self, paths: list[str]) -> None:
        self._req("remove", ",".join(paths))
        for p in paths:
            self.storage.pop(p.lstrip("/"), None)

    def close(self) -> None:
        pass


# ================================================================== data contoh kecil (tanpa data pribadi asli)
def contoh(n_campaign: int = 2, per_campaign: int = 4) -> tuple[list[VideoDB], list[CampaignDB], dict[str, KeputusanManusia]]:
    """data palsu: campaign c-1.., video 1001.. (url fiktif berisi username palsu untuk tes privasi), keputusan selang-seling"""
    vids, camps, kep = [], [], {}
    alasan = ["Konten tidak sesuai brief campaign", "CTA wajib tidak ada", "Followers belum memenuhi syarat"]
    n = 0
    for c in range(1, n_campaign + 1):
        cid = f"c-{c}"
        camps.append(CampaignDB(id=cid, title=f"Film Contoh {c}", brand="Brand Contoh", status="aktif", hashtags=["#filmcontoh"],
                                min_video_duration=10, brief_detail={"elemenWajib": ["Sebut judul film"], "cta": "Ajak nonton di bioskop",
                                                                     "hashtags": ["#filmcontoh"], "durasiMin": 10, "durasiMax": 60}))
        for i in range(per_campaign):
            n += 1
            vid = str(1000 + n)
            vids.append(VideoDB(id=vid, campaign_id=cid, url=f"https://www.tiktok.com/@clipper_palsu{n}/video/{7300000000000000000 + n}",
                                platform="tiktok", platform_video_id=str(7300000000000000000 + n), status="approved" if n % 2 else "rejected",
                                caption=f"Seru banget! #filmcontoh hubungi 0812-3456-7890 @clipper_palsu{n}", hashtags=["#FilmContoh"],
                                hashtag_present=True, bot_score=0.1, current_views=1000 * n, durasi_detik=20.0))
            kep[vid] = KeputusanManusia(video_id=vid, keputusan="approve" if n % 2 else "reject",
                                        alasan_label=None if n % 2 else alasan[n % 3], reviewer=f"R-{n % 3:06d}",
                                        diputuskan=f"2026-10-{(n % 27) + 1:02d}T03:00:00+00:00",
                                        banding="dibatalkan" if n == 4 else None, status_sekarang="approved" if n % 2 else "rejected")
    return vids, camps, kep


def hari_ini() -> str:
    return date.today().isoformat()
