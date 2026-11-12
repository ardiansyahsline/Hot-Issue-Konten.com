"""Akses DB replika Konten.com — HANYA BACA (pemilik: worker-inti). KONTRAK.md §3.5.

Koneksi: psycopg 3, conninfo kosong (libpq membaca PGHOST/PGPORT/PGDATABASE/PGUSER/PGSSLMODE + pgpass.conf sendiri),
options "-c default_transaction_read_only=on -c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000",
application_name "cs-tracker-review-worker", conn.read_only = True. Semua SQL dibangun dengan psycopg.sql (Identifier dari
kolom.toml) dan dicek diawali SELECT / WITH sebelum dieksekusi. Kolom yang diambil = yang perlu saja (tanpa nama / email /
no HP / username clipper). Id staff hanya dipakai untuk pseudonim, lalu dibuang.

Lapisan read-only: (1) sesi default_transaction_read_only=on + diverifikasi SHOW transaction_read_only, (2) conn.read_only,
(3) _cek_sql: hanya satu pernyataan SELECT / WITH tanpa kata kerja tulis (di luar tanda kutip), (4) akun DB replika sendiri
memang read-only. Sesudah tersambung, information_schema dibaca sekali (nama kolom + tipe, TANPA isi baris) → kolom.sesuaikan.
"""
from __future__ import annotations

import json
import os
import re
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from . import log as rlog
from .kolom import Kolom, KolomError
from .platform import tebak_platform
from .privasi import bersihkan_hashtag, bersihkan_teks, pseudonim
from .skema import CampaignDB, KandidatSampel, KeputusanManusia, VideoDB, VideoRef

log = rlog.get("replika")
WIB = timezone(timedelta(hours=7))
OPTIONS = "-c default_transaction_read_only=on -c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000"
APP_NAME = "cs-tracker-review-worker"
CHUNK = 500
PESAN_VPN = "Database Konten.com tidak bisa dihubungi. VPN sudah tersambung?"
_TULIS = re.compile(r"\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do|vacuum|lock|refresh|"
                    r"reindex|cluster|comment|listen|notify|prepare|execute|set|reset|discard|begin|commit|rollback)\b", re.I)
_ID_ANGKA = re.compile(r"^\d{1,19}$")
_ID_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_TIPE_ANGKA = ("smallint", "integer", "bigint", "numeric")


class ReplikaError(Exception):
    """DB replika tidak bisa dihubungi / query gagal — pesan awam (mis. "VPN belum tersambung?")"""


def _cek_sql(teks: str) -> None:
    """tolak apa pun selain SATU pernyataan SELECT / WITH tanpa kata kerja tulis (isi tanda kutip diabaikan)"""
    tanpa_kutip = re.sub(r"'(?:[^']|'')*'", "''", re.sub(r'"(?:[^"]|"")*"', '""', teks or ""))
    tanpa_kutip = re.sub(r"--[^\n]*|/\*.*?\*/", " ", tanpa_kutip, flags=re.S).strip()
    if not re.match(r"^(select|with)\b", tanpa_kutip, re.I):
        raise ReplikaError("Perintah ke DB Konten.com ditolak (hanya boleh membaca).")
    if ";" in tanpa_kutip.rstrip(";"):
        raise ReplikaError("Perintah ke DB Konten.com ditolak (lebih dari satu pernyataan).")
    m = _TULIS.search(tanpa_kutip)
    if m:
        raise ReplikaError(f"Perintah ke DB Konten.com ditolak (kata '{m.group(1).upper()}' tidak boleh — hanya membaca).")


def _pesan_koneksi(e: Exception) -> str:
    t = str(e).lower()
    if "password authentication failed" in t or "authentication failed" in t:
        return "Login DB Konten.com ditolak. Cek baris akun di %APPDATA%\\postgresql\\pgpass.conf (host, port, database, user harus sama)."
    if "no password supplied" in t or "fe_sendauth" in t:
        return "Password DB Konten.com tidak ditemukan. Isi %APPDATA%\\postgresql\\pgpass.conf (bukan .env)."
    if "ssl" in t and ("required" in t or "unsupported" in t):
        return "DB Konten.com meminta SSL. Isi PGSSLMODE=require (env Windows atau .env)."
    if "does not exist" in t and "database" in t:
        return "Nama database (PGDATABASE) salah. Cek env Windows / .env."
    return PESAN_VPN


def _iso(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).isoformat(timespec="seconds")
    if isinstance(v, date):
        return v.isoformat()
    return str(v)


def _tgl_wib(v: Any) -> str:
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).astimezone(WIB).date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    try:
        return _tgl_wib(datetime.fromisoformat(str(v).replace("Z", "+00:00")))
    except ValueError:
        return str(v)[:10]


def _daftar(v: Any) -> list[str]:
    """kolom hashtag bisa array / jsonb / teks dipisah spasi-koma / JSON teks → list teks"""
    if v is None:
        return []
    if isinstance(v, (list, tuple)):
        return [str(x) for x in v if x is not None and not isinstance(x, (dict, list))]
    if isinstance(v, dict):
        return [str(x) for x in v.values() if isinstance(x, str)]
    s = str(v).strip()
    if s.startswith(("[", "{")):
        try:
            return _daftar(json.loads(s))
        except ValueError:
            pass
    return [x for x in re.split(r"[\s,]+", s) if x]


def _angka(v: Any) -> Optional[float]:
    try:
        return None if v is None or v == "" else float(v)
    except (TypeError, ValueError):
        return None


def _bool(v: Any) -> Optional[bool]:
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() in ("1", "true", "t", "ya", "yes", "y")


def _json(v: Any) -> Any:
    if isinstance(v, (bytes, bytearray)):
        v = v.decode("utf-8", "replace")
    if isinstance(v, str):
        s = v.strip()
        if s.startswith(("{", "[")):
            try:
                return json.loads(s)
            except ValueError:
                return v
    return v


class Replika:
    def __init__(self, cfg, kolom: Kolom):
        self.cfg = cfg
        self.kolom = kolom
        self._conn = None
        self._tipe: dict[str, dict[str, str]] = {}  # nama tabel asli → {kolom: data_type}
        self.status_db = "belum_dicek"  # detak jantung: ok / tidak_terhubung / belum_dicek
        self.sleep: Callable[[float], None] = time.sleep
        self._banding_asing: set[str] = set()
        self._banding_target_diingatkan = False
        self._memuat = False
        self._tanpa_validasi = False  # kenali-skema: jalan walau pemetaan salah
        self.rentang: tuple[Optional[str], Optional[str]] = (None, None)  # CLI --dari/--sampai (bawaan sampel uji)

    # ------------------------------------------------------------------ koneksi
    def _sambung(self):
        c = self._conn
        if c is None or c.closed or getattr(c, "broken", False):
            c = self._buka()
        if not self._tipe and not self._memuat and not self._tanpa_validasi:
            self._memuat = True  # _muat_tipe memakai _q_raw → _sambung lagi (tanpa rekursi)
            try:
                self._muat_tipe()
            finally:
                self._memuat = False
        return c

    def _buka(self):
        self._conn = None
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError:
            raise ReplikaError("Paket psycopg belum terpasang. Jalankan install.ps1 lagi.") from None
        if not (os.environ.get("PGHOST") or os.environ.get("PGSERVICE")):
            self.status_db = "tidak_terhubung"
            raise ReplikaError("Alamat DB Konten.com (PGHOST) belum di-set. Isi env Windows PGHOST/PGPORT/PGDATABASE/PGUSER "
                               "(atau di .env), password di pgpass.conf.")
        try:
            conn = psycopg.connect("", options=OPTIONS, application_name=APP_NAME, connect_timeout=10, autocommit=True,
                                   row_factory=dict_row)
        except psycopg.Error as e:
            self.status_db = "tidak_terhubung"
            raise ReplikaError(_pesan_koneksi(e)) from None
        try:
            conn.read_only = True
            with conn.cursor() as cur:
                cur.execute("SHOW transaction_read_only")
                ro = (cur.fetchone() or {}).get("transaction_read_only")
            if str(ro).lower() != "on":
                raise ReplikaError("Sesi DB Konten.com TIDAK read-only — dihentikan demi keamanan. Hubungi admin DB.")
        except BaseException:
            conn.close()
            self.status_db = "tidak_terhubung"
            raise
        self._conn = conn
        self.status_db = "ok"
        return conn

    def _muat_tipe(self) -> None:
        """nama kolom + tipe untuk tabel di kolom.toml (information_schema, tanpa isi baris) → kolom.sesuaikan"""
        rows = self._q_raw("SELECT table_name, column_name, data_type FROM information_schema.columns "
                           "WHERE table_schema = %s AND table_name = ANY(%s)",
                           (self.kolom.schema, list(set(self.kolom.tabel.values()))))
        tipe: dict[str, dict[str, str]] = {}
        for r in rows:
            tipe.setdefault(r["table_name"], {})[r["column_name"]] = str(r["data_type"]).lower()
        self.kolom.sesuaikan({t: list(c) for t, c in tipe.items()})
        self._tipe = tipe
        for c in self.kolom.catatan:
            log.info("Pemetaan kolom: %s", c)

    def _q_raw(self, query: Any, params: Any = None) -> list[dict]:
        import psycopg

        for coba in (1, 2):
            conn = self._sambung()
            teks = query.as_string(conn) if hasattr(query, "as_string") else str(query)
            _cek_sql(teks)
            try:
                with conn.cursor() as cur:
                    cur.execute(query, params)
                    return list(cur.fetchall()) if cur.description else []
            except psycopg.errors.QueryCanceled:
                raise ReplikaError("Permintaan ke DB Konten.com terlalu lama (> 30 dtk) dan dihentikan. Coba lagi nanti.") from None
            except (psycopg.errors.UndefinedColumn, psycopg.errors.UndefinedTable) as e:
                raise KolomError(f"DB Konten.com: {str(e).splitlines()[0][:160]}. Jalankan: review kenali-skema, lalu sesuaikan kolom.toml") from None
            except psycopg.errors.ReadOnlySqlTransaction:
                raise ReplikaError("Perintah tulis ditolak DB (sesi read-only) — tidak ada yang diubah.") from None
            except psycopg.OperationalError:
                self.tutup()
                if coba == 2:
                    self.status_db = "tidak_terhubung"
                    raise ReplikaError(PESAN_VPN) from None
            except psycopg.Error as e:
                raise ReplikaError(f"Permintaan ke DB Konten.com gagal ({type(e).__name__}).") from None
        raise ReplikaError(PESAN_VPN)  # pragma: no cover

    def cek_koneksi(self) -> Optional[str]:
        """None = tersambung (read-only terverifikasi lewat SHOW transaction_read_only); selain itu pesan awam"""
        try:
            self._sambung()
            self._q_raw("SELECT 1 AS ok")
            return None
        except (ReplikaError, KolomError) as e:
            return str(e)

    def tunggu_koneksi(self, maks_detik: float = 1800, jeda: float = 60, cek_batal: Optional[Callable[[], None]] = None,
                       saat_tunggu: Optional[Callable[[bool], None]] = None) -> None:
        """VPN putus: coba sambung lagi tiap `jeda` dtk sampai `maks_detik`; lalu ReplikaError (uji bisa Lanjutkan)"""
        t0 = time.monotonic()
        while True:
            self.tutup()
            if self.cek_koneksi() is None:
                if saat_tunggu:
                    saat_tunggu(False)
                return
            if time.monotonic() - t0 >= maks_detik:
                if saat_tunggu:
                    saat_tunggu(False)
                raise ReplikaError(f"Database Konten.com tidak bisa dihubungi selama {int(maks_detik // 60)} menit. VPN sudah tersambung? "
                                   "Klik Lanjutkan sesudah VPN nyambung.")
            if saat_tunggu:
                saat_tunggu(True)
            log.warning("%s Dicoba lagi %d dtk lagi…", PESAN_VPN, int(jeda))
            sisa = jeda
            while sisa > 0:
                if cek_batal:
                    cek_batal()
                self.sleep(min(5.0, sisa))
                sisa -= 5.0

    # ------------------------------------------------------------------ pembangun SQL
    def _sql(self):
        from psycopg import sql

        return sql

    def _id_col(self, t: str, c: str):
        return self._sql().Identifier(self.kolom.col(t, c))

    def _tipe_kolom(self, t: str, c: str) -> str:
        nama = self.kolom.col(t, c, wajib=False)
        return (self._tipe.get(self.kolom.nama(t)) or {}).get(nama or "", "text")

    def _param_id(self, t: str, c: str, ids: list[str]) -> tuple[Any, list]:
        """(fragmen "%s::<tipe>[]", id yang bentuknya cocok dengan tipe kolom) — index kolom tetap terpakai"""
        sql = self._sql()
        tp = self._tipe_kolom(t, c)
        if tp in _TIPE_ANGKA:
            bersih = [int(i) for i in ids if _ID_ANGKA.match(str(i))]
            return sql.SQL("%s::numeric[]" if tp == "numeric" else "%s::bigint[]"), bersih
        if tp == "uuid":
            return sql.SQL("%s::uuid[]"), [str(i).lower() for i in ids if _ID_UUID.match(str(i))]
        return sql.SQL("%s::text[]"), [str(i) for i in ids]

    def _pilih(self, t: str, keys: list[str], alias: str = "") -> Any:
        """SELECT list "kolom" AS "kunci" untuk kunci yang dipetakan (yang tidak ada dilewati); id → ::text"""
        sql = self._sql()
        bagian = []
        for k in keys:
            nama = self.kolom.col(t, k, wajib=False)
            if not nama:
                continue
            ref = sql.Identifier(alias, nama) if alias else sql.Identifier(nama)
            if k in ("id", "campaign_id", "video_id", "target_id", "user_id"):
                bagian.append(sql.SQL("{}::text AS {}").format(ref, sql.Identifier(k)))
            else:
                bagian.append(sql.SQL("{} AS {}").format(ref, sql.Identifier(k)))
        return sql.SQL(", ").join(bagian)

    def _alasan_expr(self) -> Any:
        sql = self._sql()
        d = self._id_col("audit", "details")
        tp = self._tipe_kolom("audit", "details")
        if tp in ("json", "jsonb"):
            return sql.SQL("({}->>'reason')").format(d)
        # teks berisi JSON: hanya dicoba kalau diawali "{" (cast ke jsonb)
        return sql.SQL("(CASE WHEN {d}::text ~ '^\\s*\\{{' THEN ({d}::jsonb->>'reason') END)").format(d=d)

    def _aksi(self, *jenis: str) -> list[str]:
        out: list[str] = []
        for j in jenis:
            out += self.kolom.val(j)
        return out

    # ------------------------------------------------------------------ video & campaign
    VIDEO_KOLOM = ["id", "campaign_id", "url", "platform", "platform_video_id", "status", "caption", "hashtags", "hashtag_present",
                   "bot_score", "current_views", "duration", "created_at"]

    def _video(self, r: dict) -> VideoDB:
        url = r.get("url")
        plat, vid = tebak_platform(url)
        p_kolom = str(r.get("platform") or "").strip().lower()
        if p_kolom in ("tiktok", "instagram", "youtube"):
            plat = p_kolom
        pvid = str(r["platform_video_id"]) if r.get("platform_video_id") and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", str(r["platform_video_id"])) else vid
        views = _angka(r.get("current_views"))
        return VideoDB(id=str(r["id"]), campaign_id=str(r["campaign_id"]) if r.get("campaign_id") is not None else None,
                       url=str(url) if url else None, platform=plat, platform_video_id=pvid,
                       status=str(r["status"]) if r.get("status") is not None else None,
                       caption=str(r["caption"]) if r.get("caption") is not None else None,
                       hashtags=bersihkan_hashtag(_daftar(r.get("hashtags"))), hashtag_present=_bool(r.get("hashtag_present")),
                       bot_score=_angka(r.get("bot_score")), current_views=int(views) if views is not None else None,
                       durasi_detik=_angka(r.get("duration")), dibuat=_iso(r.get("created_at")))

    def ambil_video(self, video_id: str) -> Optional[VideoDB]:
        sql = self._sql()
        frag, ids = self._param_id("videos", "id", [str(video_id)])
        if not ids:
            return None
        q = sql.SQL("SELECT {cols} FROM {t} WHERE {id} = ANY({p}) LIMIT 1").format(
            cols=self._pilih("videos", self.VIDEO_KOLOM), t=self.kolom.tbl("videos"), id=self._id_col("videos", "id"), p=frag)
        rows = self._q_raw(q, (ids,))
        return self._video(rows[0]) if rows else None

    def cari_video(self, ref: VideoRef) -> Optional[VideoDB]:
        """jenis id → by id; jenis platform → kolom url berisi id platform (LIKE '%<id>%' dengan id hanya [A-Za-z0-9_-])"""
        if ref.jenis == "id":
            return self.ambil_video(ref.nilai)
        nilai = str(ref.nilai or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{3,64}", nilai):
            return None
        sql = self._sql()
        cocok: list[VideoDB] = []
        pv = self.kolom.col("videos", "platform_video_id", wajib=False)
        if pv:  # kolom id platform tersendiri (kalau ada) — lebih cepat dari LIKE
            q = sql.SQL("SELECT {cols} FROM {t} WHERE {pv}::text = %s LIMIT 5").format(
                cols=self._pilih("videos", self.VIDEO_KOLOM), t=self.kolom.tbl("videos"), pv=sql.Identifier(pv))
            cocok = [self._video(r) for r in self._q_raw(q, (nilai,))]
        if not cocok:
            pola = "%" + nilai.replace("\\", "\\\\").replace("_", "\\_").replace("%", "\\%") + "%"
            q = sql.SQL("SELECT {cols} FROM {t} WHERE {url} LIKE %s ESCAPE '\\' ORDER BY {id} DESC LIMIT 20").format(
                cols=self._pilih("videos", self.VIDEO_KOLOM), t=self.kolom.tbl("videos"), url=self._id_col("videos", "url"),
                id=self._id_col("videos", "id"))
            cocok = [self._video(r) for r in self._q_raw(q, (pola,))]
        for v in cocok:  # pastikan id platform persis sama (bukan potongan id lain)
            if v.platform_video_id == nilai and (ref.platform in (None, "lainnya") or v.platform == ref.platform):
                return v
        return None

    CAMPAIGN_KOLOM = ["id", "title", "brand", "status", "rules", "hashtags", "min_video_duration", "brief_detail", "source_video_url"]

    def ambil_campaign(self, campaign_id: str) -> Optional[CampaignDB]:
        sql = self._sql()
        frag, ids = self._param_id("campaigns", "id", [str(campaign_id)])
        if not ids:
            return None
        q = sql.SQL("SELECT {cols} FROM {t} WHERE {id} = ANY({p}) LIMIT 1").format(
            cols=self._pilih("campaigns", self.CAMPAIGN_KOLOM), t=self.kolom.tbl("campaigns"), id=self._id_col("campaigns", "id"), p=frag)
        rows = self._q_raw(q, (ids,))
        if not rows:
            return None
        r = rows[0]
        rules = _json(r.get("rules"))
        return CampaignDB(id=str(r["id"]), title=r.get("title"), brand=str(r["brand"]) if r.get("brand") is not None else None,
                          status=str(r["status"]) if r.get("status") is not None else None,
                          rules=rules if isinstance(rules, str) or rules is None else json.dumps(rules, ensure_ascii=False, sort_keys=True),
                          hashtags=bersihkan_hashtag(_daftar(r.get("hashtags"))), min_video_duration=_angka(r.get("min_video_duration")),
                          brief_detail=_json(r.get("brief_detail")),
                          source_video_url=str(r["source_video_url"]) if r.get("source_video_url") else None)

    # ------------------------------------------------------------------ keputusan reviewer
    def daftar_alasan(self) -> list[tuple[str, int, Optional[str], Optional[str]]]:
        """alasan reject unik dari audit_log (action video_reject, details->>'reason') → [(label, jumlah, pertama ISO, terakhir ISO)].
        details.notes TIDAK diambil (catatan bebas bisa memuat data pribadi)."""
        sql = self._sql()
        q = sql.SQL("SELECT {r} AS label, count(*) AS n, min({c}) AS pertama, max({c}) AS terakhir FROM {t} "
                    "WHERE lower({a}::text) = ANY(%s) AND {r} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 300").format(
            r=self._alasan_expr(), c=self._id_col("audit", "created_at"), t=self.kolom.tbl("audit"), a=self._id_col("audit", "action"))
        out = []
        for row in self._q_raw(q, (self._aksi("audit_reject"),)):
            label = bersihkan_teks(row.get("label"), 160)
            if label:
                out.append((label, int(row.get("n") or 0), _iso(row.get("pertama")), _iso(row.get("terakhir"))))
        return out

    def _keputusan_audit(self, where: Any, params: tuple, acak_batas: Optional[int] = None) -> list[dict]:
        """keputusan TERAKHIR per video dari audit_log (DISTINCT ON target)"""
        sql = self._sql()
        user = self.kolom.col("audit", "user_id", wajib=False)
        inner = sql.SQL("SELECT DISTINCT ON ({tg}) {tg}::text AS vid, lower({a}::text) AS aksi, {r} AS alasan, {u} AS uid, {c} AS ts "
                        "FROM {t} WHERE lower({a}::text) = ANY(%s) AND {tg} IS NOT NULL AND {w} ORDER BY {tg}, {c} DESC").format(
            tg=self._id_col("audit", "target_id"), a=self._id_col("audit", "action"), r=self._alasan_expr(),
            u=sql.SQL("{}::text").format(sql.Identifier(user)) if user else sql.SQL("NULL::text"),
            c=self._id_col("audit", "created_at"), t=self.kolom.tbl("audit"), w=where)
        aksi = self._aksi("audit_approve", "audit_reject")
        if acak_batas:
            q = sql.SQL("SELECT * FROM ({}) d ORDER BY random() LIMIT %s").format(inner)
            return self._q_raw(q, (aksi, *params, int(acak_batas)))
        return self._q_raw(inner, (aksi, *params))

    def _arti_aksi(self, aksi: Optional[str]) -> Optional[str]:
        a = (aksi or "").lower()
        if a in self.kolom.val("audit_approve"):
            return "approve"
        if a in self.kolom.val("audit_reject"):
            return "reject"
        return None

    def _arti_status(self, st: Any) -> Optional[str]:
        s = str(st or "").strip().lower()
        if s in self.kolom.val("status_approve"):
            return "approve"
        if s in self.kolom.val("status_reject"):
            return "reject"
        return None

    def _arti_banding(self, st: Any) -> Optional[str]:
        s = str(st or "").strip().lower()
        for kunci, arti in (("banding_dibatalkan", "dibatalkan"), ("banding_dikuatkan", "dikuatkan"), ("banding_menunggu", "menunggu")):
            if s in self.kolom.val(kunci):
                return arti
        if s and s not in self._banding_asing:
            self._banding_asing.add(s)
            log.warning("Status banding '%s' belum dikenal di kolom.toml [nilai] — dianggap tanpa banding.", s[:30])
        return None

    def _campaign_video(self, ids: list[str]) -> dict[str, dict]:
        """{video_id: {campaign_id, status}} untuk daftar id (dipecah per 500)"""
        sql = self._sql()
        out: dict[str, dict] = {}
        for i in range(0, len(ids), CHUNK):
            frag, bersih = self._param_id("videos", "id", ids[i:i + CHUNK])
            if not bersih:
                continue
            q = sql.SQL("SELECT {cols} FROM {t} WHERE {id} = ANY({p})").format(
                cols=self._pilih("videos", ["id", "campaign_id", "status"]), t=self.kolom.tbl("videos"), id=self._id_col("videos", "id"),
                p=frag)
            for r in self._q_raw(q, (bersih,)):
                out[str(r["id"])] = r
        return out

    def _rentang(self, dari: Optional[str], sampai: Optional[str]) -> tuple[datetime, datetime]:
        hari_ini = datetime.now(WIB).date()
        dari, sampai = dari or self.rentang[0], sampai or self.rentang[1]
        d0 = date.fromisoformat(dari) if dari else hari_ini - timedelta(days=int(getattr(self.cfg, "sample_hari", 120)))
        d1 = date.fromisoformat(sampai) if sampai else hari_ini - timedelta(days=int(getattr(self.cfg, "sample_jeda_hari", 2)))
        return datetime(d0.year, d0.month, d0.day, tzinfo=WIB), datetime(d1.year, d1.month, d1.day, tzinfo=WIB) + timedelta(days=1)

    def daftar_kandidat_sampel(self, dari: Optional[str] = None, sampai: Optional[str] = None, batas: int = 20000) -> list[KandidatSampel]:
        """video yang SUDAH diputuskan reviewer (approve / reject) dalam rentang tanggal (bawaan: 120 hari terakhir s/d 2 hari lalu),
        acak di DB (ORDER BY random() LIMIT batas). Pemilihan seimbang dilakukan uji.pilih_sampel."""
        sql = self._sql()
        t0, t1 = self._rentang(dari, sampai)
        c = self._id_col("audit", "created_at")
        rows = self._keputusan_audit(sql.SQL("{c} >= %s AND {c} < %s").format(c=c), (t0, t1), acak_batas=batas)
        salt = getattr(self.cfg, "pseudonym_salt", "")
        out: list[KandidatSampel] = []
        if rows:
            vids = self._campaign_video([str(r["vid"]) for r in rows])
            for r in rows:
                kep = self._arti_aksi(r.get("aksi"))
                v = vids.get(str(r["vid"]))
                if not kep or v is None:  # audit untuk video yang tidak ada lagi → dilewati
                    continue
                out.append(KandidatSampel(video_id=str(r["vid"]), campaign_id=str(v["campaign_id"]) if v.get("campaign_id") else None,
                                          keputusan=kep, alasan_label=bersihkan_teks(r.get("alasan"), 160) or None if kep == "reject" else None,
                                          reviewer=pseudonim(r.get("uid"), salt), tanggal=_tgl_wib(r.get("ts"))))
            return out
        # cadangan: audit kosong → status tracked_videos (tanpa reviewer)
        log.warning("audit_log tidak berisi keputusan di rentang itu — sampel diambil dari status video (tanpa reviewer).")
        created = self.kolom.col("videos", "created_at", wajib=False)
        st = self._id_col("videos", "status")
        where = sql.SQL("lower({s}::text) = ANY(%s)").format(s=st)
        params: list = [self._aksi("status_approve", "status_reject")]
        if created:
            where = sql.SQL("{w} AND {c} >= %s AND {c} < %s").format(w=where, c=sql.Identifier(created))
            params += [t0, t1]
        q = sql.SQL("SELECT {cols} FROM {t} WHERE {w} ORDER BY random() LIMIT %s").format(
            cols=self._pilih("videos", ["id", "campaign_id", "status", "created_at"]), t=self.kolom.tbl("videos"), w=where)
        for r in self._q_raw(q, (*params, int(batas))):
            kep = self._arti_status(r.get("status"))
            if kep:
                out.append(KandidatSampel(video_id=str(r["id"]), campaign_id=str(r["campaign_id"]) if r.get("campaign_id") else None,
                                          keputusan=kep, tanggal=_tgl_wib(r.get("created_at")) if r.get("created_at") else t0.date().isoformat()))
        return out

    def keputusan_manusia(self, video_ids: list[str]) -> dict[str, KeputusanManusia]:
        """keputusan reviewer terakhir (audit_log video_approve / video_reject, cadangan: status tracked_videos), alasan label,
        reviewer pseudonim, hasil banding (appeals) — per video id. Maks 500 id per panggilan (dipecah di dalam)."""
        sql = self._sql()
        ids = list(dict.fromkeys(str(i) for i in video_ids if i is not None))
        salt = getattr(self.cfg, "pseudonym_salt", "")
        out: dict[str, KeputusanManusia] = {}
        for i in range(0, len(ids), CHUNK):
            bagian = ids[i:i + CHUNK]
            frag, bersih = self._param_id("audit", "target_id", bagian)
            audit = {}
            if bersih:
                w = sql.SQL("{tg} = ANY({p})").format(tg=self._id_col("audit", "target_id"), p=frag)
                audit = {str(r["vid"]): r for r in self._keputusan_audit(w, (bersih,))}
            vids = self._campaign_video(bagian)
            banding: dict[str, Optional[str]] = {}
            banding_selesai: dict[str, Optional[str]] = {}
            if self.kolom.ada("appeals"):
                fa, ba = self._param_id("appeals", "video_id", bagian)
                if ba:
                    vcol, scol = self._id_col("appeals", "video_id"), self._id_col("appeals", "status")
                    cre = self.kolom.col("appeals", "created_at", wajib=False)
                    order = sql.SQL(", {} DESC NULLS LAST").format(sql.Identifier(cre)) if cre else sql.SQL("")
                    # appeals dihubungkan lewat target_type + target_id: saring jenis target kalau [nilai] banding_target diisi
                    tt, target = self.kolom.col("appeals", "target_type", wajib=False), self.kolom.val("banding_target")
                    saring, p_saring = sql.SQL(""), ()
                    if tt and target:
                        saring, p_saring = sql.SQL(" AND lower({}::text) = ANY(%s)").format(sql.Identifier(tt)), (target,)
                    elif tt:
                        # banding_target belum diisi: baris yang target_type-nya berbau "video" didahulukan (supaya banding payout /
                        # flag yang lebih baru tidak menutupi banding penolakan video); kebenaran.tentukan juga tidak membalik approve
                        order = sql.SQL(", (lower({}::text) LIKE '%%video%%') DESC NULLS LAST").format(sql.Identifier(tt)) + order
                        if not self._banding_target_diingatkan:
                            self._banding_target_diingatkan = True
                            log.warning("kolom.toml [nilai] banding_target masih kosong — semua jenis banding (appeals.target_type) "
                                        "ikut dibaca. Jalankan `review kenali-skema --nilai`, lalu isi banding_target dengan nilai "
                                        "target_type untuk banding video (mis. [\"tracked_video\"]).")
                    # waktu banding diputuskan → kebenaran tidak membalik keputusan yang dicatat SESUDAH banding (cegah balik dua kali)
                    waktu = [sql.SQL("{}").format(sql.Identifier(c)) for c in
                             (self.kolom.col("appeals", "resolved_at", wajib=False), self.kolom.col("appeals", "decided_at", wajib=False)) if c]
                    selesai = (sql.SQL("COALESCE({})").format(sql.SQL(", ").join(waktu)) if len(waktu) > 1 else waktu[0]) if waktu \
                        else sql.SQL("NULL::timestamptz")
                    q = sql.SQL("SELECT DISTINCT ON ({v}) {v}::text AS vid, {s}::text AS st, {w} AS selesai FROM {t} WHERE {v} = ANY({p}){f} "
                                "ORDER BY {v}{o}").format(v=vcol, s=scol, w=selesai, t=self.kolom.tbl("appeals"), p=fa, f=saring, o=order)
                    for r in self._q_raw(q, (ba, *p_saring)):
                        banding[str(r["vid"])] = self._arti_banding(r.get("st"))
                        if r.get("selesai") is not None:
                            banding_selesai[str(r["vid"])] = _iso(r.get("selesai"))
            for vid in bagian:
                a, v = audit.get(vid), vids.get(vid)
                if a is None and v is None:
                    continue
                kep = self._arti_aksi(a.get("aksi")) if a else None
                st_now = str(v["status"]) if v and v.get("status") is not None else None
                if kep is None:
                    kep = self._arti_status(st_now)
                out[vid] = KeputusanManusia(
                    video_id=vid, keputusan=kep, alasan_label=(bersihkan_teks(a.get("alasan"), 160) or None) if a and kep == "reject" else None,
                    reviewer=pseudonim(a.get("uid"), salt) if a else None, diputuskan=_iso(a.get("ts")) if a else None,
                    banding=banding.get(vid), banding_selesai=banding_selesai.get(vid) if banding.get(vid) else None,
                    status_sekarang=st_now)
        return out

    # ------------------------------------------------------------------ kenali skema
    def kenali_skema(self, nilai: bool = False) -> dict[str, list[str]]:
        """information_schema.columns untuk schema alif (tabel di kolom.toml) → {tabel: [kolom]}; tulis data/skema.json,
        cetak masalah pemetaan + saran kolom yang namanya mirip. TANPA membaca isi baris.
        nilai=True (opsi --nilai): juga daftar NILAI UNIK kolom status/aksi (+ jumlah) dan nama key brief_detail — bukan data pribadi,
        untuk mengisi kolom.toml [nilai]."""
        self._tanpa_validasi = True  # harus jalan walau pemetaan salah (tanpa kolom.sesuaikan)
        try:
            return self._kenali(nilai)
        finally:
            self._tanpa_validasi = False
            self._tipe = {}  # query berikutnya memuat ulang tipe & menyesuaikan pemetaan

    def _kenali(self, nilai: bool) -> dict[str, list[str]]:
        rows = self._q_raw("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = %s "
                           "ORDER BY table_name, ordinal_position", (self.kolom.schema,))
        tabel: dict[str, list[dict]] = {}
        for r in rows:
            tabel.setdefault(r["table_name"], []).append({"kolom": r["column_name"], "tipe": r["data_type"]})
        skema = {t: [c["kolom"] for c in cols] for t, cols in tabel.items()}
        masalah = self.kolom.validasi(skema)
        hasil: dict[str, Any] = {"schema": self.kolom.schema, "dibuat": datetime.now(WIB).isoformat(timespec="seconds"),
                                 "tabel": tabel, "masalah_pemetaan": masalah}
        if nilai:
            hasil["nilai_unik"] = self._nilai_unik(skema)
        f = Path(self.cfg.data) / "skema.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(hasil, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Schema {self.kolom.schema}: {len(tabel)} tabel. Daftar kolom ditulis ke {f}")
        for t, nama in self.kolom.tabel.items():
            print(f"  [{t}] {nama}: " + ("ADA (" + str(len(skema[nama])) + " kolom)" if nama in skema else "TIDAK ADA"))
        if masalah:
            print("Pemetaan kolom.toml yang perlu dicek:")
            for m in masalah:
                print("  - " + m)
        else:
            print("Pemetaan kolom.toml cocok semua.")
        if nilai:
            for k, v in hasil["nilai_unik"].items():
                print(f"  nilai {k}: " + ", ".join(f"{x['nilai']} ({x['n']})" for x in v[:15]))
        return skema

    def cek_pemetaan(self) -> list[str]:
        """masalah pemetaan kolom.toml vs information_schema (tanpa menulis file / isi baris) — untuk `review cek`"""
        self._tanpa_validasi = True
        try:
            rows = self._q_raw("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = %s",
                               (self.kolom.schema,))
        finally:
            self._tanpa_validasi = False
        skema: dict[str, list[str]] = {}
        for r in rows:
            skema.setdefault(r["table_name"], []).append(r["column_name"])
        return self.kolom.validasi(skema)

    def _nilai_unik(self, skema: dict[str, list[str]]) -> dict[str, list[dict]]:
        sql = self._sql()
        out: dict[str, list[dict]] = {}
        target = [("videos", "status"), ("audit", "action"), ("appeals", "status"), ("appeals", "target_type"), ("appeals", "appeal_type")]
        for t, c in target:
            nama_t = self.kolom.tabel.get(t)
            nama_c = (self.kolom.kolom.get(t) or {}).get(c)
            if not nama_t or not nama_c or nama_c not in skema.get(nama_t, []):
                continue
            where = sql.SQL("")
            cre = (self.kolom.kolom.get(t) or {}).get("created_at")
            if cre and cre in skema.get(nama_t, []):  # tabel besar: cukup 90 hari terakhir
                where = sql.SQL(" WHERE {} > now() - interval '90 days'").format(sql.Identifier(cre))
            q = sql.SQL("SELECT left({c}::text, 40) AS nilai, count(*) AS n FROM {t}{w} GROUP BY 1 ORDER BY 2 DESC LIMIT 30").format(
                c=sql.Identifier(nama_c), t=sql.Identifier(self.kolom.schema, nama_t), w=where)
            try:
                out[f"{nama_t}.{nama_c}"] = [{"nilai": bersihkan_teks(r["nilai"], 40), "n": int(r["n"])} for r in self._q_raw(q)]
            except ReplikaError as e:
                out[f"{nama_t}.{nama_c}"] = [{"nilai": f"(gagal: {e})", "n": 0}]
        nama_t = self.kolom.tabel.get("campaigns")
        bd = (self.kolom.kolom.get("campaigns") or {}).get("brief_detail")
        if nama_t and bd and bd in skema.get(nama_t, []):
            q = sql.SQL("SELECT k AS nilai, count(*) AS n FROM {t}, LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof({c}::jsonb) = 'object' "
                        "THEN {c}::jsonb ELSE '{{}}'::jsonb END) AS k GROUP BY 1 ORDER BY 2 DESC LIMIT 60").format(
                t=sql.Identifier(self.kolom.schema, nama_t), c=sql.Identifier(bd))
            try:
                out[f"{nama_t}.{bd} (key)"] = [{"nilai": str(r["nilai"])[:40], "n": int(r["n"])} for r in self._q_raw(q)]
            except ReplikaError as e:
                out[f"{nama_t}.{bd} (key)"] = [{"nilai": f"(gagal: {e})", "n": 0}]
        return out

    def tutup(self) -> None:
        c, self._conn = self._conn, None
        if c is not None:
            try:
                c.close()
            except Exception:
                pass
