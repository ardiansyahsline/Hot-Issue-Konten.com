"""Selftest bagian INTI review-worker (pemilik: worker-inti) — TANPA GPU, VPN, DB replika asli, kunci API, internet.
  .venv\\Scripts\\python tests\\selftest_inti.py            (semua tes)
  .venv\\Scripts\\python tests\\selftest_inti.py privasi    (hanya tes yang namanya mengandung kata itu)
Modul pembangun lain (media/*, hakim, brief, uji, …) DITIRU di sini supaya tes ini hanya menguji bagian inti.
Tes DB replika ASLI (psycopg + Postgres): pakai Postgres lokal kalau ada — env REVIEW_TES_PGHOST (+ REVIEW_TES_PGPORT,
REVIEW_TES_PGUSER), bawaan socket /tmp/pgs23 port 55433 (alat uji migration-23); tidak ada → tes itu dilewati (dicatat).
"""
from __future__ import annotations

import contextlib
import hashlib
import http.server
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
REPO = ROOT.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
TMP = Path(tempfile.mkdtemp(prefix="rw-selftest-inti-"))
os.environ["REVIEW_DATA_DIR"] = str(TMP / "data")
os.environ["HOTISSUE_GPU_DIR"] = str(TMP / "gpu")
for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"):
    os.environ.pop(k, None)

import httpx  # noqa: E402

from review_worker import antrian, config, gpu_bersama, jobctx, kolom, pipeline, platform, privasi, replika, runtime, supa  # noqa: E402
from review_worker import log as rlog  # noqa: E402
from review_worker.skema import (BriefCampaign, CekPoin, HasilMusik, KeputusanManusia, MateriVideo, MetaVideo, PemakaianAI,  # noqa: E402
                                 PenilaianFinal, PoinBrief, ReferensiCampaign, VideoRef)
from palsu_db import ReplikaPalsu, SupaPalsu, contoh  # noqa: E402

CFG = config.load(TMP / "tidak-ada.env")
rlog.setup(CFG.logs)
results: list[tuple[str, bool, str]] = []
TESTS: list = []
PY = sys.executable


def test(fn):
    TESTS.append(fn)
    return fn


def run_test(fn) -> None:
    name = fn.__name__.removeprefix("t_").replace("_", " ")
    t0 = time.time()
    try:
        info = fn() or ""
        results.append((name, True, info))
        print(f"[OK]    {name} {info} ({time.time() - t0:.1f} dtk)")
    except Exception as e:
        results.append((name, False, f"{type(e).__name__}: {e}"))
        print(f"[GAGAL] {name}: {type(e).__name__}: {e}")
        traceback.print_exc()


def wait_until(cond, timeout: float = 8.0, step: float = 0.02) -> bool:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(step)
    return bool(cond())


@contextlib.contextmanager
def tambal(*pasangan):
    """ganti atribut modul sementara: tambal((modul, "nama", nilai), ...)"""
    lama = [(m, n, getattr(m, n, None), hasattr(m, n)) for m, n, _ in pasangan]
    for m, n, v in pasangan:
        setattr(m, n, v)
    try:
        yield
    finally:
        for m, n, v, ada in lama:
            if ada:
                setattr(m, n, v)
            else:
                delattr(m, n)


# ================================================================== tiruan modul pembangun lain
class HakimPalsu:
    def __init__(self, mode: str = "approve"):
        self.mode = mode
        self.dipanggil: list = []

    def nilai(self, brief, materi, ref):
        self.dipanggil.append((brief.campaign_id, materi.video_id, materi.model_dump_json()))
        if self.mode == "habis":
            from review_worker.biaya import AnggaranHabis

            raise AnggaranHabis("Batas biaya harian $2 tercapai — klik Lanjutkan besok.")
        cek = [CekPoin(poin_id="p01", kategori="cta", teks="Ajak nonton", wajib=True, hasil="lolos",
                       bukti="transkrip 00:03: 'nonton di bioskop' — dari @clipper_palsu1 0812-3456-7890", bukti_detik=[3.0])]
        return PenilaianFinal(saran="approve" if self.mode == "approve" else "reject", keyakinan=150, checklist=cek,
                              alasan_kode=None if self.mode == "approve" else "cta_tidak_ada", alasan_spesifik="CTA ada di detik 3.",
                              ringkasan="Sesuai brief.", serah=[],
                              pemakaian=PemakaianAI(input=900, output=700, cache_read=2000, cache_write_1h=0, biaya_usd=0.0013,
                                                    model="claude-haiku-5-5", effort="medium", detik=1.5),
                              rubrik_versi="v1", rubrik_hash="abcdef123456")


def materi_palsu(rt, video, brief, ref, kerja, cek_batal=None, mode="ok"):
    (kerja / "video.mp4").write_bytes(b"x" * 100)  # file sementara: harus terhapus sesudahnya
    materi_palsu.folder = kerja
    if mode == "error":
        raise RuntimeError("ffmpeg mati")
    if mode == "batal":
        from review_worker.jobctx import Cancelled

        raise Cancelled("batal")
    return MateriVideo(video_id=video.id, campaign_id=video.campaign_id, status="ok",
                       musik=HasilMusik(status="tidak_ada_referensi", mesin="chroma"),
                       meta=MetaVideo(platform=video.platform, durasi_detik=20.0, caption=privasi.bersihkan_teks(video.caption),
                                      hashtags=video.hashtags, hashtag_present=True, bot_score=0.1),
                       waktu_tahap={"unduh": 1.0, "frame": 0.5})


def brief_palsu(c):
    return BriefCampaign(campaign_id=c.id, judul=c.title, brand=c.brand, durasi_min=10, durasi_max=60, hash="h1",
                         poin=[PoinBrief(id="p01", kategori="cta", teks="Ajak nonton di bioskop", kode_alasan="cta_tidak_ada")])


def tentukan_palsu(km):
    if km is None or km.keputusan is None:
        return None, None
    if km.banding == "dibatalkan":
        return ("approve" if km.keputusan == "reject" else "reject"), "dibatalkan"
    return km.keputusan, km.banding


def cocok_palsu(saran, truth):
    return None if saran not in ("approve", "reject") or truth is None else saran == truth


def sinkron_palsu(sp, daftar):
    for label, n, a, b in daftar:
        sp.insert("review_reasons", {"label": label, "code": "lainnya", "uses": n, "first_seen": a, "last_seen": b}, on_conflict="label",
                  merge=True)
    return len(daftar)


@contextlib.contextmanager
def dunia_palsu(mode_materi: str = "ok"):
    """semua modul pembangun lain diganti tiruan (dipulihkan sesudahnya)"""
    from review_worker import alasan, brief, kebenaran
    from review_worker.media import materi as m_materi
    from review_worker.media import musik as m_musik
    from review_worker.media import susun

    with tambal((susun, "buat_materi_video", lambda *a, **k: materi_palsu(*a, mode=mode_materi, **k)),
                (brief, "parse_brief", brief_palsu),
                (m_materi, "referensi_campaign", lambda rt, cid: ReferensiCampaign(campaign_id=cid, status="ada")),
                (m_materi, "proses_upload_manual", lambda rt, cid=None: 0),
                (m_materi, "siapkan_materi_campaign", lambda rt, c, b, paksa=False, progres=None:
                 ReferensiCampaign(campaign_id=c.id, status="belum_ada", pesan="Folder Google Drive private.")),
                (m_musik, "cek_mesin", lambda cfg: ("chroma", "tiruan")),
                (kebenaran, "tentukan", tentukan_palsu), (kebenaran, "cocok", cocok_palsu),
                (alasan, "kode_untuk_label", lambda lb: "cta_tidak_ada" if lb and "CTA" in lb else ("lainnya" if lb else None)),
                (alasan, "sinkron", sinkron_palsu), (alasan, "muat_daftar", lambda sp: {})):
        yield


def rt_palsu(mode_hakim: str = "approve", n_campaign: int = 2, per: int = 3):
    v, c, k = contoh(n_campaign, per)
    sp = SupaPalsu(CFG.worker_id)
    rt = runtime.Runtime(cfg=CFG, supa=sp, replika=ReplikaPalsu(v, c, k), gpu=gpu_bersama.KunciGPU("review-worker", TMP / "gpu"))
    rt.hakim = HakimPalsu(mode_hakim)
    return rt, sp


def tanpa_pribadi(teks: str) -> None:
    for pola in ("clipper_palsu", "tiktok.com/@", "0812-3456-7890", "@clipper"):
        assert pola not in teks, f"data pribadi bocor: {pola}"


# ================================================================== config
def _jalan_config(env_text: bytes | None, extra: dict | None = None) -> dict:
    d = Path(tempfile.mkdtemp(dir=TMP))
    if env_text is not None:
        (d / ".env").write_bytes(env_text)
    kode = ("import sys, json, os; sys.path.insert(0, %r)\nfrom review_worker import config\nc = config.load(__import__('pathlib').Path(%r))\n"
            "print(json.dumps({'url': c.supabase_url, 'miss': c.missing(), 'key': bool(c.service_key), 'ai': c.anthropic_key_ada,"
            "'budget': c.daily_budget_usd, 'effort': c.effort, 'note': c.env_note, 'pg': c.pg_dari_env, 'salt': c.pseudonym_salt,"
            "'wid': c.worker_id, 'repr': repr(c), 'pgpass_env': os.environ.get('PGPASSWORD'), 'ocr': c.ocr, 'conf': c.min_confidence}))"
            % (str(ROOT), str(d / ".env")))
    env = {k: v for k, v in os.environ.items() if not k.startswith(("PG", "SUPABASE", "ANTHROPIC", "REVIEW_"))}
    env.update({"REVIEW_DATA_DIR": str(d / "data")}, **(extra or {}))
    out = subprocess.run([PY, "-c", kode], capture_output=True, text=True, env=env, timeout=60)
    assert out.returncode == 0, out.stderr[-800:]
    return json.loads(out.stdout.strip().splitlines()[-1])


@test
def t_config_env_utf8_bom_utf16_ansi_dan_pgpassword_diabaikan():
    isi = ("SUPABASE_URL=xxxx.supabase.co/\nSUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi.rahasia.kunci\nANTHROPIC_API_KEY=sk-ant-uji123456789\n"
           "REVIEW_DAILY_BUDGET_USD=1,5\nREVIEW_EFFORT=ngawur\nPGHOST=db.lokal\nPGPASSWORD=jangan\nREVIEW_OCR=mati\n# komentar é\n"
           "REVIEW_MIN_CONFIDENCE=250\n")
    for nama, raw in (("utf8", isi.encode()), ("bom", b"\xef\xbb\xbf" + isi.encode()), ("utf16", isi.encode("utf-16")),
                      ("ansi", isi.encode("cp1252"))):
        r = _jalan_config(raw)
        assert r["url"] == "https://xxxx.supabase.co" and not r["miss"] and r["key"] and r["ai"], (nama, r)
        assert r["budget"] == 1.5 and r["effort"] == "medium" and r["ocr"] == "mati" and r["conf"] == 100, (nama, r)
        assert r["pgpass_env"] is None and "PGPASSWORD" in r["note"], (nama, r)
        assert r["pg"].get("PGHOST") == ".env", r
        assert "rahasia" not in r["repr"] and "sk-ant" not in r["repr"], "kunci tercetak di repr Cfg"
        assert r["wid"].startswith("review-")
    assert "UTF-16" in _jalan_config(isi.encode("utf-16"))["note"]
    # env Windows menang atas .env, salt stabil antar pemanggilan (data/salt.txt)
    r = _jalan_config(b"PGHOST=dari-env-file\n", {"PGHOST": "dari-windows"})
    assert r["pg"]["PGHOST"] == "windows"
    kosong = _jalan_config(None)
    assert kosong["miss"] == ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] and not kosong["ai"] and len(kosong["salt"]) >= 16
    return "4 encoding .env terbaca, PGPASSWORD dibuang, kunci tidak tercetak"


@test
def t_env_example_lengkap_sesuai_kontrak():
    teks = (ROOT / ".env.example").read_text(encoding="utf-8")
    nama_env = set(re.findall(r"^([A-Z_][A-Z0-9_]*)=", teks, re.M))
    kontrak = {"SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "REVIEW_MODEL", "REVIEW_EFFORT", "REVIEW_DAILY_BUDGET_USD",
               "REVIEW_MIN_CONFIDENCE", "REVIEW_RUBRIK", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGSSLMODE", "REVIEW_DL_RATE",
               "REVIEW_DL_MAX_MB", "REVIEW_DL_JEDA", "REVIEW_WHISPER_MODEL", "REVIEW_WHISPER_CACHE", "REVIEW_OCR", "REVIEW_MUSIK",
               "REVIEW_DEMUCS", "REVIEW_JAVA", "REVIEW_PANAKO_JAR", "GOOGLE_DRIVE_API_KEY", "REVIEW_MATERI_MAX_MB", "REVIEW_KURS_IDR",
               "REVIEW_VIDEO_PER_HARI", "REVIEW_PSEUDONYM_SALT", "HOTISSUE_GPU_DIR"}
    assert not kontrak - nama_env, f"kurang di .env.example: {kontrak - nama_env}"
    assert "PGPASSWORD" not in nama_env
    for baris in teks.splitlines():  # semua nilai contoh kosong / bawaan, tanpa kunci
        if "=" in baris and not baris.startswith("#"):
            nilai = baris.split("=", 1)[1]
            assert not re.search(r"eyJ|sk-ant|AIza|sb_secret", nilai), baris
    dipakai = set(re.findall(r'_(?:env|int|float|bool|pilih)\("([A-Z_]+)"', (ROOT / "review_worker" / "config.py").read_text(encoding="utf-8")))
    return f"{len(nama_env)} env, {len(dipakai)} dibaca config.py"


# ================================================================== privasi & platform & log
@test
def t_privasi_bersihkan_teks():
    kasus = {
        "Hubungi 0812-3456-7890 ya": "[telepon]", "WA +62 812 3456 7890": "[telepon]", "nomor 6281234567890": "[telepon]",
        "email budi.s@gmail.com": "[email]", "cek https://bit.ly/abc?x=1": "[tautan]", "link bit.ly/xyz": "[tautan]",
        "www.tiktok.com/@budi": "[tautan]", "follow @budi_clip.id!": "[akun]",
        "link di bio linktr.ee/budi": "[tautan]", "youtu.be/abc123": "[tautan]", "beacons.ai/budi": "[tautan]",
        "linkin.bio/budi": "[tautan]", "taplink.cc/budi": "[tautan]",
    }
    for masuk, harus in kasus.items():
        keluar = privasi.bersihkan_teks(masuk)
        assert harus in keluar and not privasi.ada_data_pribadi(keluar), (masuk, keluar)
    tetap = "Tayang 12 Desember 2026 #FilmX harga Rp 50.000 durasi 60 dtk, rating 8.5/10"
    assert privasi.bersihkan_teks(tetap) == tetap, privasi.bersihkan_teks(tetap)
    assert privasi.bersihkan_teks("tag @BrandResmi dan @orang", izinkan=["@brandresmi"]) == "tag @BrandResmi dan [akun]"
    assert privasi.bersihkan_teks("a  \n\n\n\n b @x @y", maks=8).endswith("…") and len(privasi.bersihkan_teks("x" * 50, maks=10)) == 10
    assert privasi.bersihkan_teks("@a @b @c lalu") == "[akun] lalu"
    # teks dari video (nama_akun=True): username tanpa '@' juga dibuang, akun brand (izinkan) & kata biasa tetap
    v = lambda t, **k: privasi.bersihkan_teks(t, nama_akun=True, **k)  # noqa: E731
    assert v("follow ig budisantoso99 ya") == "follow ig [akun] ya" and v("cek tiktok: rina.ayu sekarang") == "cek tiktok: [akun] sekarang"
    assert v("rina_1998 keren") == "[akun] keren" and v("ig filmxofficial", izinkan=["@filmxofficial"]) == "ig filmxofficial"
    assert v(tetap) == tetap and v("video tiktok ini viral, IG Story TAYANG 12 DESEMBER") == "video tiktok ini viral, IG Story TAYANG 12 DESEMBER"
    assert privasi.bersihkan_teks("follow ig budisantoso99") == "follow ig budisantoso99"  # teks brief/log: tidak diubah
    assert privasi.kandidat_akun("follow ig filmxofficial & @filmx_official") == ["filmxofficial"]
    assert privasi.bersihkan_teks(None) == "" and privasi.ada_data_pribadi("[akun] [telepon]") is False
    assert privasi.bersihkan_hashtag(["#FilmX", "konten", "@user", "bit.ly/a", "#Seru #seru", None]) == ["#filmx", "#konten", "#seru"]
    a, b = privasi.pseudonim("staff-1", "garam"), privasi.pseudonim("staff-1", "garam")
    assert a == b and re.fullmatch(r"R-[0-9a-f]{6}", a) and a != privasi.pseudonim("staff-1", "lain") and privasi.pseudonim(None, "g") is None
    return f"{len(kasus)} pola dibuang, hashtag & tanggal tetap"


@test
def t_platform_sama_dengan_parseVideoRef_website():
    kasus = [
        ("https://www.tiktok.com/@user.name/video/7301234567890123456?is_from_webapp=1", ("tiktok", "7301234567890123456")),
        ("https://m.tiktok.com/v/7301234567890123456", ("tiktok", None)), ("https://vm.tiktok.com/ZSabc12/", ("tiktok", None)),
        ("https://www.instagram.com/reel/Cx_ab-12/?igsh=xx", ("instagram", "Cx_ab-12")),
        ("https://www.instagram.com/budi/reel/Cx12/", ("instagram", "Cx12")), ("instagram.com/p/AbC/", ("instagram", "AbC")),
        ("https://youtu.be/dQw4w9WgXcQ?si=1", ("youtube", "dQw4w9WgXcQ")), ("https://youtube.com/shorts/abcDEF12345", ("youtube", "abcDEF12345")),
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3", ("youtube", "dQw4w9WgXcQ")), ("https://example.com/x", ("lainnya", None)),
    ]
    for url, harus in kasus:
        assert platform.tebak_platform(url) == harus, (url, platform.tebak_platform(url))
    assert platform.link_publik("tiktok", "123") == "https://www.tiktok.com/embed/v2/123"
    assert platform.link_publik("instagram", "Cx1") == "https://www.instagram.com/reel/Cx1/" and platform.link_publik("youtube", "a") == "https://youtu.be/a"
    assert platform.link_publik("tiktok", "a/b") is None and platform.link_publik("lainnya", "1") is None
    r = platform.ref_dari_teks
    assert r("4821").model_dump() == {"jenis": "id", "nilai": "4821", "platform": None}
    assert r("7301234567890123456").platform == "tiktok" and r("ABCDEFAB-1111-2222-3333-444455556666").nilai.islower()
    assert r("https://www.tiktok.com/@u/video/7301234567890123456").nilai == "7301234567890123456" and r("halo") is None
    for u, _ in kasus:  # username tidak pernah kembali
        ref = r(u)
        assert ref is None or "@" not in ref.model_dump_json()
    return f"{len(kasus)} link"


@test
def t_log_menyamarkan_kunci_dan_data_pribadi():
    lg = rlog.get("tes")
    try:
        raise ValueError("gagal unduh https://www.tiktok.com/@budi/video/1 kunci sk-ant-api03-abcdefghijklmnop")
    except ValueError:
        lg.exception("Video %s: email %s, Bearer %s", "48213", "budi@x.com", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.abcdefgh")
    lg.info("no HP 0812-3456-7890 dan @clipper.fiktif, password=rahasia123")
    for h in logging.getLogger("review").handlers:
        h.flush()
    teks = "".join(f.read_text(encoding="utf-8") for f in CFG.logs.glob("review-*.log"))
    for bocor in ("budi@x.com", "sk-ant-api03", "eyJhbGciOiJIUzI1NiJ9", "0812-3456-7890", "@clipper.fiktif", "rahasia123", "tiktok.com/@budi"):
        assert bocor not in teks, f"bocor di log: {bocor}"
    assert "Video 48213" in teks and "[rahasia]" in teks and "\n    raise ValueError" in teks.replace("\r", ""), "traceback rusak"
    return "kunci, email, HP, @handle, link disamarkan; indentasi traceback tetap"


# ================================================================== kolom.toml
@test
def t_kolom_toml_validasi_dan_sesuaikan():
    k = kolom.muat(ROOT / "kolom.toml")
    assert k.schema == "alif" and k.nama("videos") == "tracked_videos" and k.col("videos", "url") == "video_url"
    assert k.col("videos", "tidak_ada", wajib=False) is None and k.val("audit_reject") == ["video_reject"]
    try:
        k.col("videos", "tidak_ada")
        raise AssertionError("harus KolomError")
    except kolom.KolomError as e:
        assert "kolom.toml" in str(e)
    skema = {"tracked_videos": ["id", "campaign_id", "url_video", "status", "caption"], "campaigns": ["id", "brief_detail"],
             "audit_log": ["action", "details", "created_at", "target_id", "user_id"]}
    masalah = k.validasi(skema)
    teks = " | ".join(masalah)
    assert "tracked_videos.video_url tidak ada" in teks and "url_video" in teks, teks  # saran nama mirip
    assert any(m.startswith("(opsional)") and "appeals" in m for m in masalah)
    try:
        kolom.muat(ROOT / "kolom.toml").sesuaikan(skema)
        raise AssertionError("kolom wajib hilang harus KolomError")
    except kolom.KolomError as e:
        assert "video_url" in str(e) and "kenali-skema" in str(e)
    skema["tracked_videos"].append("video_url")
    k2 = kolom.muat(ROOT / "kolom.toml")
    k2.sesuaikan(skema)
    assert k2.col("videos", "bot_score", wajib=False) is None and not k2.ada("appeals") and k2.ada("videos")
    assert any("bot_score" in m for m in k2.validasi(skema)), "validasi harus tetap melihat pemetaan asli"
    rusak = TMP / "rusak.toml"
    rusak.write_text('schema = "alif\n[tabel', encoding="utf-8")
    for p in (rusak, TMP / "tidak-ada.toml"):
        try:
            kolom.muat(p)
            raise AssertionError("harus KolomError")
        except kolom.KolomError:
            pass
    toml = (ROOT / "kolom.toml").read_text(encoding="utf-8").lower()
    for pribadi in ("username", "email", "phone", "full_name", "notes"):
        assert not re.search(rf'^\s*\w+\s*=\s*"[^"]*{pribadi}', toml, re.M), f"kolom pribadi dipetakan: {pribadi}"
    return f"{len(masalah)} masalah terdeteksi + saran nama mirip"


@test
def t_replika_hanya_select():
    ok = ['SELECT "a" FROM "alif"."t" WHERE "updated_at" > %s', "WITH x AS (SELECT 1) SELECT * FROM x",
          "SELECT 'insert into' AS teks", 'SELECT "delete" FROM t;', "  -- komentar\n select 1"]
    tolak = ["INSERT INTO t VALUES (1)", "SELECT 1; DELETE FROM t", "WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x",
             "UPDATE t SET a=1", "SELECT * FROM t FOR UPDATE", "COPY t TO '/tmp/x'", "select set_config('a','b',false); drop table t",
             "/* */ DROP TABLE t", "SELECT 1; SET ROLE admin"]
    for q in ok:
        replika._cek_sql(q)
    for q in tolak:
        try:
            replika._cek_sql(q)
            raise AssertionError(f"lolos padahal harus ditolak: {q}")
        except replika.ReplikaError:
            pass
    return f"{len(ok)} diterima, {len(tolak)} ditolak"


def _pg():
    """(host, port, user) Postgres lokal untuk tes DB replika asli, atau None"""
    host = os.environ.get("REVIEW_TES_PGHOST") or ("/tmp/pgs23" if Path("/tmp/pgs23/.s.PGSQL.55433").exists() else "")
    if not host or not shutil.which("psql"):
        return None
    return host, os.environ.get("REVIEW_TES_PGPORT", "55433"), os.environ.get("REVIEW_TES_PGUSER", "postgres")


@test
def t_replika_asli_psycopg_read_only_dan_query_minimal():
    pg = _pg()
    if pg is None:
        return "DILEWATI: Postgres lokal tidak ada (set REVIEW_TES_PGHOST)"
    host, port, user = pg
    base = ["psql", "-h", host, "-p", port, "-U", user, "-q", "-v", "ON_ERROR_STOP=1"]
    subprocess.run(base + ["-c", "drop database if exists replika_palsu_tes", "-c", "create database replika_palsu_tes"], check=True,
                   capture_output=True)
    subprocess.run(base + ["-d", "replika_palsu_tes", "-f", str(HERE / "data" / "alif-palsu.sql")], check=True, capture_output=True)
    os.environ.update(PGHOST=host, PGPORT=port, PGUSER=user, PGDATABASE="replika_palsu_tes")
    try:
        r = replika.Replika(CFG, kolom.muat(ROOT / "kolom.toml"))
        sql_dikirim: list[str] = []
        asli = r._q_raw

        def rekam(q, p=None):
            sql_dikirim.append(q.as_string(r._conn) if hasattr(q, "as_string") else str(q))
            return asli(q, p)

        r._q_raw = rekam  # type: ignore[method-assign]
        assert r.cek_koneksi() is None and r.status_db == "ok"
        conn = r._conn
        with conn.cursor() as cur:  # lapisan sesi: read-only, timeout, nama aplikasi
            cur.execute("SHOW transaction_read_only")
            assert list(cur.fetchone().values())[0] == "on"
            cur.execute("SHOW statement_timeout")
            assert list(cur.fetchone().values())[0] == "30s"
            cur.execute("SELECT application_name FROM pg_stat_activity WHERE pid = pg_backend_pid()")
            assert list(cur.fetchone().values())[0] == "cs-tracker-review-worker"
        import psycopg

        for tulis in ("INSERT INTO alif.staff (id) VALUES (gen_random_uuid())", "DELETE FROM alif.appeals",
                      "UPDATE alif.tracked_videos SET status = 'x'", "CREATE TABLE alif.x (a int)"):
            try:
                with conn.cursor() as cur:
                    cur.execute(tulis)
                raise AssertionError(f"tulis lolos: {tulis}")
            except psycopg.errors.ReadOnlySqlTransaction:
                pass
        v = r.ambil_video("5001")
        assert v and v.platform == "tiktok" and v.platform_video_id == "7300000000000000001" and v.hashtags == ["#filmsatu", "#seru"]
        assert "tiktok.com/@" not in repr(v) and v.durasi_detik == 13.0, "url (berisi username) tidak boleh tercetak"
        assert r.ambil_video("bukan-angka") is None and r.ambil_video("999999") is None
        assert r.cari_video(VideoRef(jenis="platform", platform="tiktok", nilai="7300000000000000003")).id == "5003"
        assert r.cari_video(VideoRef(jenis="platform", platform="instagram", nilai="CxFiktif5")).id == "5005"
        assert r.cari_video(VideoRef(jenis="platform", platform="tiktok", nilai="730000000000000000")) is None, "potongan id tidak boleh cocok"
        assert r.cari_video(VideoRef(jenis="platform", platform="tiktok", nilai="x_%")) is None
        c = r.ambil_campaign(v.campaign_id)
        assert c and isinstance(c.brief_detail, dict) and c.brief_detail["durasiMax"] == "60" and c.min_video_duration == 15
        alasan = r.daftar_alasan()
        assert {a[0] for a in alasan} == {"Konten tidak sesuai brief campaign", "CTA wajib tidak ada", "Followers belum memenuhi syarat"}
        ks = r.daftar_kandidat_sampel()
        assert len(ks) == 26 and all(k.reviewer and k.reviewer.startswith("R-") for k in ks)
        assert {k.keputusan for k in ks} == {"approve", "reject"} and all(k.alasan_label is None for k in ks if k.keputusan == "approve")
        assert len(r.daftar_kandidat_sampel(batas=5)) == 5
        km = r.keputusan_manusia(["5004", "5008", "5012", "5016", "5007", "999"])
        assert km["5004"].keputusan == "approve", "keputusan TERAKHIR yang dipakai"
        assert (km["5008"].banding, km["5012"].banding, km["5016"].banding) == ("dibatalkan", "dikuatkan", "menunggu")
        assert km["5007"].keputusan is None and km["5007"].status_sekarang == "pending" and "999" not in km
        r.kenali_skema(nilai=True)
        sk = json.loads((CFG.data / "skema.json").read_text(encoding="utf-8"))
        assert "tracked_videos" in sk["tabel"] and "nilai_unik" in sk
        teks_sk = json.dumps(sk)
        assert "clipper.fiktif" not in teks_sk and "Nama Reviewer" not in teks_sk, "kenali-skema membaca isi baris pribadi"
        semua = "\n".join(sql_dikirim).lower()
        for pribadi in ('"username"', '"clipper_email"', '"clipper_phone"', '"full_name"', "notes", '"email"', '"owner_email"', '"note"'):
            assert pribadi not in semua, f"query membaca kolom pribadi {pribadi}"
        assert all(re.match(r"^\s*(select|with)\b", q, re.I) for q in sql_dikirim)
        r.tutup()
        # VPN putus: host salah → pesan awam, tunggu_koneksi menyerah sesudah batas
        os.environ["PGHOST"] = "/tmp/tidak-ada-socket"
        r2 = replika.Replika(CFG, kolom.muat(ROOT / "kolom.toml"))
        r2.sleep = lambda s: None
        assert "VPN" in (r2.cek_koneksi() or "") and r2.status_db == "tidak_terhubung"
        try:
            r2.tunggu_koneksi(maks_detik=0, jeda=1)
            raise AssertionError("harus ReplikaError")
        except replika.ReplikaError as e:
            assert "VPN" in str(e)
        os.environ.pop("PGHOST")
        assert "PGHOST" in (replika.Replika(CFG, kolom.muat(ROOT / "kolom.toml")).cek_koneksi() or "")
        return f"{len(sql_dikirim)} query SELECT, tulis ditolak sesi, tanpa kolom pribadi"
    finally:
        for k in ("PGHOST", "PGPORT", "PGUSER", "PGDATABASE"):
            os.environ.pop(k, None)
        subprocess.run(base + ["-c", "drop database if exists replika_palsu_tes"], capture_output=True)


# ================================================================== Supabase
@test
def t_supa_retry_pesan_awam_dan_bentuk_request():
    seen: list[httpx.Request] = []
    gagal = {"n": 2}

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        p = req.url.path
        if p.endswith("/rpc/review_claim_job"):
            if gagal["n"] > 0:
                gagal["n"] -= 1
                return httpx.Response(503, text="sibuk")
            return httpx.Response(200, json=[{"id": "j1", "kind": "video"}])
        if p.endswith("/rpc/review_add_usage"):
            return httpx.Response(200, json=0.42)
        if p.endswith("/review_results"):
            return httpx.Response(201, json=[{"id": 7, **json.loads(req.content)}])
        if p.endswith("/review_workers") and req.method == "POST":
            return httpx.Response(201, json=[])
        if p.endswith("/review_runs"):
            return httpx.Response(404, json={"code": "PGRST205", "message": "Could not find the table"})
        if p.endswith("/review_jobs"):
            return httpx.Response(401, json={"message": "JWT expired"})
        if "/storage/v1/object/asisten-review/" in p:
            return httpx.Response(200, content=b"isi") if req.method == "GET" else httpx.Response(200, json={"Key": p})
        return httpx.Response(500)

    s = supa.Supa("https://x.supabase.co", "kunci-rahasia", "review-tes", client=httpx.Client(transport=httpx.MockTransport(handler)))
    s.sleep = lambda d: None
    assert "kunci-rahasia" not in repr(s)
    assert s.klaim_job(["video"])["id"] == "j1" and len([r for r in seen if "claim" in r.url.path]) == 3
    body = json.loads([r for r in seen if "claim" in r.url.path][-1].content)
    assert body == {"p_worker": "review-tes", "p_kinds": ["video"]}
    assert s.tambah_biaya("2026-11-12", 0.0013, 1, 10, 20, 30, 40) == 0.42
    row = s.simpan_hasil({"scope": "run:x", "video_id": "1"})
    req = [r for r in seen if r.url.path.endswith("/review_results")][-1]
    assert row["id"] == 7 and req.url.params["on_conflict"] == "scope,video_id" and "merge-duplicates" in req.headers["prefer"]
    s.detak({"status": "siap"})
    try:
        s.select("review_runs")
        raise AssertionError("harus SupaError")
    except supa.SupaError as e:
        assert "migration-23" in str(e)
    try:
        s.select("review_jobs")
        raise AssertionError("harus SupaError")
    except supa.SupaError as e:
        assert "SERVICE_ROLE_KEY" in str(e) and e.status == 401
    assert s.upload("asisten-review/laporan/a.html", b"<html>", "text/html") == "laporan/a.html"
    assert s.download("laporan/a.html", TMP / "dl" / "a.html") == b"isi" and (TMP / "dl" / "a.html").read_bytes() == b"isi"
    for buruk in ("../x", "", "materi/../../etc"):
        try:
            supa.norm_path(buruk)
            raise AssertionError(f"path {buruk!r} harus ditolak")
        except ValueError:
            pass
    putus = supa.Supa("https://x.supabase.co", "k", client=httpx.Client(transport=httpx.MockTransport(lambda r: (_ for _ in ()).throw(httpx.ConnectError("x")))),
                      retries=2)
    putus.sleep = lambda d: None
    try:
        putus.select("review_jobs")
        raise AssertionError("harus SupaError")
    except supa.SupaError as e:
        assert "tidak bisa dihubungi" in str(e)
    return "retry 503, migration belum ada & kunci salah → pesan awam"


# ================================================================== JobCtx
@test
def t_jobctx_progres_batal_berhenti_dan_requeue():
    rt, sp = rt_palsu()
    job = sp.tambah_job("uji", {"jumlah": 50})
    job = sp.klaim_job()
    ctx = jobctx.JobCtx(rt, job)
    ctx.eta(95)
    ctx.progress(0.5, "Video 1/2", done=1, total=2, run_id="11111111-2222-4333-8444-555555555555")
    assert wait_until(lambda: sp.tabel["review_jobs"][0]["done"] == 1)
    r = sp.tabel["review_jobs"][0]
    assert r["progress"] == 0.5 and r["total"] == 2 and r["run_id"].startswith("1111") and jobctx.ETA_RE.search(r["message"])
    assert r["message"].endswith("sisa ±2 mnt"), r["message"]
    # Ctrl+C sekali: check_cancel → Berhenti, cek_batal TIDAK (video berjalan diselesaikan)
    rt.stop.set()
    ctx.cek_batal(force=True)
    try:
        ctx.check_cancel()
        raise AssertionError("harus Berhenti")
    except jobctx.Berhenti:
        pass
    assert issubclass(jobctx.Berhenti, KeyboardInterrupt) and not issubclass(jobctx.Berhenti, Exception)
    rt.stop.clear()
    ctx.requeue("Laptop dihentikan", params={"lanjut_run": ctx.run_id})
    r = sp.tabel["review_jobs"][0]
    assert r["status"] == "antri" and r["params"] == {"lanjut_run": "11111111-2222-4333-8444-555555555555"} and r["worker"] is None
    # batal dari website → Cancelled di titik aman
    job = sp.klaim_job()
    ctx = jobctx.JobCtx(rt, job)
    sp.tabel["review_jobs"][0]["status"] = "batal"
    ctx.progress(0.1, "x")
    assert wait_until(lambda: ctx._cancel == "batal")
    for f in (ctx.check_cancel, lambda: ctx.progress(0.2), ctx.cek_batal):
        try:
            f()
            raise AssertionError("harus Cancelled")
        except jobctx.Cancelled:
            pass
    ctx.close()
    # requeue uji saat sudah ada uji lain menunggu (unik) → gagal dengan pesan Lanjutkan
    sp.tabel["review_jobs"][0]["status"] = "proses"
    sp.tambah_job("uji", {"jumlah": 500})
    ctx = jobctx.JobCtx(rt, sp.tabel["review_jobs"][0])
    ctx.requeue("x", params={"lanjut_run": "a"})
    assert sp.tabel["review_jobs"][0]["status"] == "gagal" and "Lanjutkan" in sp.tabel["review_jobs"][0]["message"]
    return "progres + ETA, Berhenti vs Cancelled, requeue lanjut_run"


# ================================================================== kunci GPU bersama
PEMEGANG = r"""
import sys, time; sys.path.insert(0, sys.argv[1])
from studio_worker import gpu_bersama as g
mode, lama = sys.argv[2], float(sys.argv[3])
if mode == "pegang":
    with g.KunciGPU("voice-worker").pegang("tts", prioritas=True, tunggu_maks=30) as ok:
        print("DAPAT", ok, flush=True); time.sleep(lama)
else:  # minta: tunggu kunci yang sedang dipegang review-worker (prioritas)
    with g.KunciGPU("voice-worker").pegang("tts", prioritas=True, tunggu_maks=lama) as ok:
        print("DAPAT", ok, flush=True); time.sleep(0.5)
"""


@test
def t_gpu_bersama_salinan_identik_dan_antar_proses():
    a = (ROOT / "review_worker" / "gpu_bersama.py").read_bytes()
    b = (REPO / "voice-worker" / "studio_worker" / "gpu_bersama.py").read_bytes()
    assert hashlib.sha256(a).hexdigest() == hashlib.sha256(b).hexdigest(), "salinan voice-worker berbeda"
    assert b"from ." not in a and b"import review_worker" not in a, "modul harus berdiri sendiri"
    folder = TMP / "gpu-proses"
    env = {**os.environ, "HOTISSUE_GPU_DIR": str(folder)}
    k = gpu_bersama.KunciGPU("review-worker", folder)
    # 1) voice-worker memegang kunci 1,5 dtk → review-worker menunggu lalu dapat
    p = subprocess.Popen([PY, "-c", PEMEGANG, str(REPO / "voice-worker"), "pegang", "1.5"], env=env, stdout=subprocess.PIPE, text=True)
    assert p.stdout.readline().strip() == "DAPAT True"
    assert k.pemegang()["nama"] == "voice-worker"
    t0 = time.monotonic()
    with k.pegang("asr", tunggu_maks=20) as ok:
        tunggu = time.monotonic() - t0
        assert ok and tunggu > 0.7, tunggu
        assert k.pemegang()["nama"] == "review-worker"
        # bersarang di thread yang sama tidak macet
        with k.pegang("ocr", tunggu_maks=1) as ok2:
            assert ok2
    p.wait(10)
    # 2) review-worker memegang, voice-worker datang (prioritas) → gpu.minta muncul → review-worker mengalah di tahap berikutnya
    with k.pegang("asr") as ok:
        q = subprocess.Popen([PY, "-c", PEMEGANG, str(REPO / "voice-worker"), "minta", "30"], env=env, stdout=subprocess.PIPE, text=True)
        assert wait_until(k.ada_yang_minta, 10), "gpu.minta tidak muncul"
        time.sleep(0.3)
    assert q.stdout.readline().strip() == "DAPAT True"
    t0 = time.monotonic()
    with k.pegang("ocr", tunggu_maks=20) as ok:
        assert ok and k.mengalah == 1 and not k.menunggu
    q.wait(10)
    assert not k.ada_yang_minta() and not (folder / "gpu.minta").exists()
    # 3) tunggu_maks habis → jalan tanpa kunci (False), tidak macet
    p = subprocess.Popen([PY, "-c", PEMEGANG, str(REPO / "voice-worker"), "pegang", "3"], env=env, stdout=subprocess.PIPE, text=True)
    assert p.stdout.readline().strip() == "DAPAT True"
    with k.pegang("asr", tunggu_maks=0.6) as ok:
        assert ok is False
    p.wait(10)
    # 4) folder tidak bisa dipakai → jalan tanpa kunci; error di dalam blok tetap diteruskan; cek_batal diteruskan
    berkas = TMP / "bukan-folder"
    berkas.write_text("x")
    with gpu_bersama.KunciGPU("review-worker", berkas / "gpu").pegang("asr") as ok:
        assert ok is False
    try:
        with k.pegang("asr"):
            raise KeyError("dari dalam")
    except KeyError:
        pass
    p = subprocess.Popen([PY, "-c", PEMEGANG, str(REPO / "voice-worker"), "pegang", "2"], env=env, stdout=subprocess.PIPE, text=True)
    assert p.stdout.readline().strip() == "DAPAT True"

    def batal():
        raise jobctx.Cancelled("batal")

    try:
        with k.pegang("asr", cek_batal=batal):
            raise AssertionError("tidak boleh masuk")
    except jobctx.Cancelled:
        pass
    p.wait(10)
    with k.pegang("asr", tunggu_maks=2) as ok:  # kunci tidak tertinggal sesudah error / batal
        assert ok
    return f"menunggu {tunggu:.1f} dtk, voice-worker didahulukan, tunggu_maks & error aman"


@test
def t_voice_worker_handle_memakai_kunci_tanpa_bisa_gagal():
    src = (REPO / "voice-worker" / "worker.py").read_text(encoding="utf-8")
    assert "with _gpu(kind, ctx):" in src and "contextlib.nullcontext(False)" in src and 'prioritas=True, tunggu_maks=300' in src
    kepala = "def _gpu(kind: str, ctx: JobCtx | None = None):"
    blok = kepala + src.split(kepala)[1].split("def handle(")[0]
    assert "except Exception" in blok and "cek_batal=" in blok
    # jalankan _gpu() ASLI: kunci dipegang thread lain → batal dari website tetap terbaca + pesan progres "Menunggu GPU" sekali
    import types

    class Batal(Exception):
        pass

    class Ctx:
        def __init__(self):
            self.pesan, self.cek = [], 0

        def progress(self, p, msg=None):
            self.pesan.append(msg)

        def check_cancel(self):
            self.cek += 1
            if self.cek == 3:
                raise ConnectionError("jaringan putus")  # error lain → diabaikan, tetap menunggu
            if self.cek >= 5:
                raise Batal("batal")

    ns: dict = {"contextlib": contextlib, "Cancelled": Batal, "JobCtx": object}
    exec(compile("from __future__ import annotations\n" + blok, "worker._gpu", "exec"), ns)  # noqa: S102
    folder = TMP / "gpu-voice"
    lama_env, lama_mod = os.environ.get("HOTISSUE_GPU_DIR"), sys.modules.get("studio_worker")
    os.environ["HOTISSUE_GPU_DIR"] = str(folder)
    sys.modules["studio_worker"] = types.SimpleNamespace(gpu_bersama=gpu_bersama)
    pegang, lepas = threading.Event(), threading.Event()

    def review():
        with gpu_bersama.KunciGPU("review-worker", folder).pegang("asr"):
            pegang.set()
            lepas.wait(10)

    th = threading.Thread(target=review, daemon=True)
    th.start()
    try:
        assert pegang.wait(5)
        ctx = Ctx()
        t0 = time.monotonic()
        try:
            with ns["_gpu"]("tts", ctx):
                raise AssertionError("tidak boleh dapat kunci yang dipegang thread lain")
        except Batal:
            pass
        dt = time.monotonic() - t0
        assert dt < 10 and ctx.cek >= 5, (dt, ctx.cek)
        assert ctx.pesan == ["Menunggu GPU dipakai Asisten Review…"], ctx.pesan
        lepas.set()
        th.join(5)
        with ns["_gpu"]("tts", None) as ok:  # tanpa ctx (pemanggil lama) → tetap jalan
            assert ok is True
    finally:
        lepas.set()
        th.join(5)
        if lama_env is None:
            os.environ.pop("HOTISSUE_GPU_DIR", None)
        else:
            os.environ["HOTISSUE_GPU_DIR"] = lama_env
        if lama_mod is None:
            sys.modules.pop("studio_worker", None)
        else:
            sys.modules["studio_worker"] = lama_mod
    return f"handle() dibungkus, impor gagal → nullcontext; batal terbaca saat menunggu GPU ({dt:.1f} dtk), pesan progres sekali"


# ================================================================== pipeline & antrian
@test
def t_pipeline_video_tersimpan_tanpa_data_pribadi_dan_tmp_dihapus():
    rt, sp = rt_palsu()
    with dunia_palsu():
        h = pipeline.proses_video(rt, "1001", scope="run:r1", run_id="r1")
    assert h.pipeline_status == "ok" and h.suggestion == "approve" and h.confidence == 100, "keyakinan dijepit 0..100"
    assert h.human_decision == "approve" and h.final_truth == "approve" and h.match is True and h.reviewer and h.reviewer.startswith("R-")
    assert h.campaign_title == "Film Contoh 1" and h.platform_video_id == "7300000000000000001" and h.cost_usd == 0.0013
    assert h.tokens["cache_read"] == 2000 and h.stage_sec["hakim"] == 1.5 and h.process_sec is not None and h.meta["n_frame"] == 0
    assert not materi_palsu.folder.exists(), "folder sementara tidak dihapus"
    rows = sp.tabel["review_results"]
    assert len(rows) == 1 and rows[0]["scope"] == "run:r1" and rows[0]["video_id"] == "1001"
    tanpa_pribadi(json.dumps(rows))
    camp = sp.tabel["review_campaigns"][0]
    assert camp["campaign_id"] == "c-1" and camp["brief_points"][0]["id"] == "p01" and camp["duration_max"] == 60 and "materi_status" not in camp
    # ke AI: materi tanpa url / username / no HP
    tanpa_pribadi(rt.hakim.dipanggil[0][2])
    # brief di-cache: video kedua campaign sama tidak membaca campaign lagi
    n_camp = rt.replika.panggilan.count("ambil_campaign")
    with dunia_palsu():
        pipeline.proses_video(rt, "1002", scope="run:r1")
    assert rt.replika.panggilan.count("ambil_campaign") == n_camp
    # banding dibatalkan: kebenaran akhir = kebalikan reviewer
    with dunia_palsu():
        h4 = pipeline.proses_video(rt, "1004", scope="run:r1")
    assert h4.human_decision == "reject" and h4.appeal == "dibatalkan" and h4.final_truth == "approve"
    return "hasil = HasilVideo, tmp dihapus, cache brief, banding"


@test
def t_pipeline_error_vpn_batal_dan_lokal():
    rt, sp = rt_palsu()
    with dunia_palsu(mode_materi="error"):
        h = pipeline.proses_video(rt, "1001", scope="run:r1")
    assert h.pipeline_status == "gagal" and h.suggestion == "cek_manusia" and "RuntimeError" in h.error and h.human_decision == "approve"
    assert not materi_palsu.folder.exists()
    with dunia_palsu(mode_materi="batal"):
        try:
            pipeline.proses_video(rt, "1002", scope="run:r1")
            raise AssertionError("Cancelled harus diteruskan")
        except jobctx.Cancelled:
            pass
    assert not materi_palsu.folder.exists(), "folder sementara tertinggal saat batal"
    with dunia_palsu():
        h = pipeline.proses_video(rt, "999", scope="run:r1")
    assert h.pipeline_status == "gagal" and "tidak ditemukan" in h.error
    # VPN putus 2x → pipeline menunggu (tunggu_koneksi) lalu lanjut
    rt.replika.putus = 2
    with dunia_palsu():
        h = pipeline.proses_video(rt, "1003", scope="run:r1")
    assert h.pipeline_status == "ok"
    # VPN putus terus → ReplikaError diteruskan (uji bisa Lanjutkan)
    rt.replika.putus = 10_000
    rt.cfg.replika_tunggu_menit = 0
    try:
        with dunia_palsu():
            pipeline.proses_video(rt, "1005", scope="run:r1")
        raise AssertionError("ReplikaError harus diteruskan")
    except replika.ReplikaError:
        pass
    finally:
        rt.cfg.replika_tunggu_menit = 30
        rt.replika.putus = 0
    # AnggaranHabis diteruskan
    rt.hakim = HakimPalsu("habis")
    from review_worker.biaya import AnggaranHabis

    try:
        with dunia_palsu():
            pipeline.proses_video(rt, "1001", scope="run:r1")
        raise AssertionError("AnggaranHabis harus diteruskan")
    except AnggaranHabis:
        pass
    # tanpa Supabase / Supabase putus → data/hasil-lokal.jsonl
    lokal = CFG.data / "hasil-lokal.jsonl"
    lokal.unlink(missing_ok=True)
    rt.hakim, rt.supa = HakimPalsu(), None
    with dunia_palsu():
        pipeline.proses_video(rt, "1001", scope="job:cli-1")
    rt.supa = sp
    sp.gagal = 10
    with dunia_palsu():
        pipeline.proses_video(rt, "1002", scope="job:cli-1")
    sp.gagal = 0
    baris = [json.loads(x) for x in lokal.read_text(encoding="utf-8").splitlines()]
    assert [b["video_id"] for b in baris] == ["1001", "1002"]
    tanpa_pribadi(lokal.read_text(encoding="utf-8"))
    # sisa folder sementara lama dibersihkan saat mulai
    lama = CFG.tmp / "lama"
    lama.mkdir(parents=True, exist_ok=True)
    os.utime(lama, (time.time() - 7 * 3600, time.time() - 7 * 3600))
    assert pipeline.bersihkan_tmp(CFG) >= 1 and not lama.exists()
    return "error → gagal + keputusan tetap dicatat, VPN ditunggu, biaya/batal diteruskan, simpan lokal"


@test
def t_antrian_video_materi_sinkron_akses_dan_prioritas():
    rt, sp = rt_palsu()
    sp.admin.add("admin-1")
    sp.granted.add("user-1")
    with dunia_palsu():
        sp.tambah_job("uji", {"jumlah": 50}, created_by="admin-1")
        jv = sp.tambah_job("video", {"ref": {"jenis": "platform", "platform": "tiktok", "nilai": "7300000000000000002"}}, created_by="user-1")
        job = sp.klaim_job()
        assert job["id"] == jv["id"], "video harus didahulukan dari uji"
        assert sp.klaim_job(["video", "materi", "sinkron"]) is None
        antrian.tangani(rt, job)
        r = next(x for x in sp.tabel["review_jobs"] if x["id"] == jv["id"])
        assert r["status"] == "selesai" and "Approve" in r["message"] and r["done"] == 1, r
        hasil = sp.tabel["review_results"][-1]
        assert hasil["scope"] == f"job:{jv['id']}" and hasil["job_id"] == jv["id"] and hasil["video_id"] == "1002"
        # tidak ditemukan
        j2 = sp.tambah_job("video", {"ref": {"jenis": "id", "nilai": "424242"}}, created_by="user-1")
        antrian.tangani(rt, sp.klaim_job(["video"]))
        assert next(x for x in sp.tabel["review_jobs"] if x["id"] == j2["id"])["message"] == "Video tidak ditemukan di database Konten.com."
        # akses dicabut sesudah antri
        j3 = sp.tambah_job("video", {"ref": {"jenis": "id", "nilai": "1001"}}, created_by="user-2")
        antrian.tangani(rt, sp.klaim_job(["video"]))
        r3 = next(x for x in sp.tabel["review_jobs"] if x["id"] == j3["id"])
        assert r3["status"] == "gagal" and r3["message"] == antrian.DICABUT
        # params rusak
        j4 = sp.tambah_job("video", {"ref": {"jenis": "aneh"}}, created_by="admin-1")
        antrian.tangani(rt, sp.klaim_job(["video"]))
        assert "tidak valid" in next(x for x in sp.tabel["review_jobs"] if x["id"] == j4["id"])["message"]
        # materi
        j5 = sp.tambah_job("materi", {"campaign_id": "c-2", "paksa": True}, created_by="admin-1")
        antrian.tangani(rt, sp.klaim_job(["materi"]))
        r5 = next(x for x in sp.tabel["review_jobs"] if x["id"] == j5["id"])
        assert r5["status"] == "selesai" and "Materi belum ada" in r5["message"] and "private" in r5["message"]
        # sinkron alasan
        j6 = sp.tambah_job("sinkron", {})
        antrian.tangani(rt, sp.klaim_job(["sinkron"]))
        assert next(x for x in sp.tabel["review_jobs"] if x["id"] == j6["id"])["status"] == "selesai" and sp.tabel["review_reasons"]
        # batas biaya habis → job gagal + status detak berhenti_biaya
        rt.hakim = HakimPalsu("habis")
        j7 = sp.tambah_job("video", {"ref": {"jenis": "id", "nilai": "1003"}}, created_by="admin-1")
        antrian.tangani(rt, sp.klaim_job(["video"]))
        r7 = next(x for x in sp.tabel["review_jobs"] if x["id"] == j7["id"])
        assert r7["status"] == "gagal" and "Batas biaya" in r7["message"] and rt.info_detak()["status"] == "berhenti_biaya"
    tanpa_pribadi(json.dumps(sp.tabel))
    return "prioritas video > uji, akses dicek ulang, biaya habis"


@test
def t_antrian_uji_menyelipkan_video_dan_berhenti_lanjut_run():
    from review_worker import uji

    rt, sp = rt_palsu()
    catatan = {}

    def jalankan_uji_palsu(rt_, ctx, *, jumlah=None, lanjut_run=None, ulang_run=None, label=None, seed=None):
        run = lanjut_run or "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        catatan.setdefault("panggil", []).append({"jumlah": jumlah, "lanjut": lanjut_run})
        for i, vid in enumerate(["1001", "1002", "1003"]):
            ctx.check_cancel()
            pipeline.proses_video(rt_, vid, scope=f"run:{run}", run_id=run, cek_batal=ctx.cek_batal)
            ctx.progress((i + 1) / 3, f"Video {i + 1}/3", done=i + 1, total=3, run_id=run)
            if i == 0:  # website menempel 1 video saat uji berjalan
                sp.tambah_job("video", {"ref": {"jenis": "id", "nilai": "1004"}})
            catatan["selip"] = catatan.get("selip", 0) + rt_.selipkan()
            if catatan.get("stop_di") == i:
                rt_.stop.set()
        return run

    with dunia_palsu(), tambal((uji, "jalankan_uji", jalankan_uji_palsu)):
        ju = sp.tambah_job("uji", {"jumlah": 50})
        antrian.tangani(rt, sp.klaim_job())
        r = next(x for x in sp.tabel["review_jobs"] if x["id"] == ju["id"])
        assert r["status"] == "selesai" and r["run_id"] == "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", r
        assert catatan["selip"] == 1 and catatan["panggil"][0] == {"jumlah": 50, "lanjut": None}
        jv = next(x for x in sp.tabel["review_jobs"] if x["kind"] == "video")
        assert jv["status"] == "selesai" and rt.status["status"] == "siap"
        # Ctrl+C sekali di tengah uji → job kembali antri dengan lanjut_run, video yang jalan diselesaikan
        catatan["stop_di"] = 1
        ju2 = sp.tambah_job("uji", {"jumlah": 500})
        antrian.tangani(rt, sp.klaim_job())
        r2 = next(x for x in sp.tabel["review_jobs"] if x["id"] == ju2["id"])
        assert r2["status"] == "antri" and r2["params"] == {"lanjut_run": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"}, r2
        n_hasil = len([x for x in sp.tabel["review_results"] if x["scope"].startswith("run:")])
        assert n_hasil == 3, n_hasil  # 1001, 1002 (+1001 ulang) → video ke-2 selesai sebelum berhenti
        rt.stop.clear()
        catatan.pop("stop_di")
        antrian.tangani(rt, sp.klaim_job())
        assert catatan["panggil"][-1] == {"jumlah": None, "lanjut": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"}
        assert next(x for x in sp.tabel["review_jobs"] if x["id"] == ju2["id"])["status"] == "selesai"
        # params uji rusak
        ju3 = sp.tambah_job("uji", {"jumlah": "banyak"})
        antrian.tangani(rt, sp.klaim_job())
        assert "tidak valid" in next(x for x in sp.tabel["review_jobs"] if x["id"] == ju3["id"])["message"]
    return "video diselipkan di sela uji, Ctrl+C → lanjut_run"


@test
def t_antrian_recover_stale_sekali_lalu_gagal():
    rt, sp = rt_palsu()
    (CFG.data / antrian.RETRIED).unlink(missing_ok=True)
    sp.insert("review_jobs", {"id": "j-video", "kind": "video", "status": "proses", "worker": CFG.worker_id, "params": {}})
    sp.insert("review_jobs", {"id": "j-uji", "kind": "uji", "status": "proses", "worker": CFG.worker_id, "params": {"jumlah": 500},
                              "run_id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"})
    sp.insert("review_jobs", {"id": "j-lain", "kind": "video", "status": "proses", "worker": "review-laptop-lain", "params": {}})
    assert antrian.recover_stale(rt) == 2
    st = {r["id"]: r for r in sp.tabel["review_jobs"]}
    assert st["j-video"]["status"] == "antri" and st["j-uji"]["params"] == {"lanjut_run": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"}
    assert st["j-lain"]["status"] == "proses"
    for j in ("j-video", "j-uji"):
        st[j].update(status="proses", worker=CFG.worker_id)
    antrian.recover_stale(rt, idle=True)
    assert st["j-video"]["status"] == "gagal" and "Lanjutkan" in st["j-uji"]["message"]
    return "diulang sekali, kedua kali gagal, laptop lain tidak disentuh"


@test
def t_jalan_detak_jantung_antrian_dan_berhenti_rapi():
    rt, sp = rt_palsu()
    rt.cfg.heartbeat_sec = 0.2
    hasil = {}
    with dunia_palsu(), tambal((supa, "Supa", lambda *a, **k: sp)):
        rt.cfg.supabase_url, rt.cfg.service_key = "https://x.supabase.co", "k"
        try:
            sp.tambah_job("video", {"ref": {"jenis": "id", "nilai": "1001"}})
            t = threading.Thread(target=lambda: hasil.setdefault("kode", antrian.jalan(rt)), daemon=True)
            t.start()
            assert wait_until(lambda: sp.tabel["review_jobs"][0]["status"] == "selesai", 15), sp.tabel["review_jobs"][0]
            assert wait_until(lambda: bool(sp.tabel.get("review_workers")), 5)
            info = sp.tabel["review_workers"][0]["info"]
            for k in ("status", "job", "versi", "gpu", "db", "ai", "musik", "ocr", "budget", "rubric_version"):
                assert k in info, f"info detak kurang {k}"
            assert info["ai"] == "kunci_kosong" and info["musik"] == "chroma" and info["budget"]["batas"] == CFG.daily_budget_usd
            assert "host" not in json.dumps(info).lower()
            # laptop kedua di folder data yang sama ditolak (satu instance)
            assert antrian.jalan(rt) == 0
            rt.stop.set()
            t.join(15)
            assert hasil["kode"] == 0 and sp.tabel["review_workers"][0]["last_seen"].startswith("2000") and \
                sp.tabel["review_workers"][0]["info"]["status"] == "mati"
        finally:
            rt.cfg.supabase_url, rt.cfg.service_key, rt.cfg.heartbeat_sec = "", "", 20.0
            rt.stop.clear()
    rt2 = runtime.Runtime(cfg=CFG, supa=None, replika=ReplikaPalsu(), gpu=None)
    assert antrian.jalan(rt2) == 2, "tanpa Supabase → kode 2"
    return "detak format §1.6, satu instance, mati saat berhenti"


# ================================================================== CLI & berkas Windows
@test
def t_cli_kode_keluar():
    env = {k: v for k, v in os.environ.items() if not k.startswith(("PG", "SUPABASE", "ANTHROPIC"))}
    env.update(REVIEW_DATA_DIR=str(TMP / "cli-data"), PYTHONIOENCODING="utf-8")
    run = lambda *a: subprocess.run([PY, str(ROOT / "review.py"), *a], capture_output=True, text=True, env=env, timeout=120, cwd=str(TMP))  # noqa: E731
    h = run("--help")
    assert h.returncode == 0 and "kenali-skema" in h.stdout
    assert run("jalan").returncode == 2
    c = run("cek")
    assert c.returncode == 1 and "PGHOST" in c.stdout and "KOSONG" in c.stdout, c.stdout[-1500:] + c.stderr[-1500:]
    u = run("uji")
    assert u.returncode == 2
    v = run("video", "halo")
    assert v.returncode == 1 and "tidak dikenali" in v.stdout
    k = run("kenali-skema")
    assert k.returncode == 1 and "PGHOST" in k.stdout, k.stdout + k.stderr
    pg = _pg()
    if pg:  # cek + kenali-skema betulan ke DB palsu
        base = ["psql", "-h", pg[0], "-p", pg[1], "-U", pg[2], "-q"]
        subprocess.run(base + ["-c", "drop database if exists replika_palsu_cli", "-c", "create database replika_palsu_cli"], capture_output=True)
        subprocess.run(base + ["-d", "replika_palsu_cli", "-f", str(HERE / "data" / "alif-palsu.sql")], capture_output=True, check=True)
        env.update(PGHOST=pg[0], PGPORT=pg[1], PGUSER=pg[2], PGDATABASE="replika_palsu_cli")
        k = run("kenali-skema", "--nilai")
        assert k.returncode == 0 and "tracked_videos: ADA" in k.stdout, k.stdout + k.stderr
        c = run("cek")
        assert "read-only terverifikasi" in c.stdout, c.stdout
        subprocess.run(base + ["-c", "drop database if exists replika_palsu_cli"], capture_output=True)
    return "help 0, pengaturan kurang 2, gagal 1" + (" + DB palsu" if pg else "")


@test
def t_berkas_windows_crlf_ascii_dan_tanpa_rahasia():
    berkas = [REPO / "NYALAKAN-ASISTEN-REVIEW.bat", ROOT / "jalankan.bat", ROOT / "install.ps1"]
    for f in berkas:
        raw = f.read_bytes()
        assert raw.isascii(), f"{f.name} bukan ASCII"
        assert b"\r\n" in raw and b"\n" not in raw.replace(b"\r\n", b""), f"{f.name} bukan CRLF"
    bat = (REPO / "NYALAKAN-ASISTEN-REVIEW.bat").read_text(encoding="ascii")
    for kata in ("git pull --ff-only", "install.ps1", "review.py cek", "jalankan.bat", "requirements.txt"):
        assert kata in bat, kata
    ps1 = (ROOT / "install.ps1").read_text(encoding="ascii")
    for kata in ("gdown", "uv", "cu128", "requirements.txt", "Temurin", "pasang-panako.ps1", "easyocr"):
        assert kata.lower() in ps1.lower(), kata
    req = (ROOT / "requirements.txt").read_text(encoding="utf-8")
    for p in ("anthropic==2.8.0", "psycopg[binary]==3.3.8", "yt-dlp==2026.10.26", "scenedetect==0.7.3", "faster-whisper==1.2.1", "gdown==6.5.1"):
        assert p in req, p
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    for kata in ("pgpass.conf", "gdown", "Java", "Panako", "EasyOCR", "uji 50", "500", "laporan", "kenali-skema", "VPN"):
        assert kata.lower() in readme.lower(), f"README kurang: {kata}"
    gi = (ROOT / ".gitignore").read_text(encoding="utf-8")
    assert ".env" in gi and "data/" in gi
    return "3 berkas CRLF+ASCII, requirements terkunci, README lengkap"


def main() -> int:
    only = [a.lower() for a in sys.argv[1:]]
    for fn in TESTS:
        if not only or any(o in fn.__name__.lower() for o in only):
            run_test(fn)
    ok = sum(1 for r in results if r[1])
    print(f"\n=== {ok}/{len(results)} tes lolos ===")
    for n, good, info in results:
        if not good:
            print(f"  GAGAL: {n} — {info}")
        elif "DILEWATI" in info:
            print(f"  {n}: {info}")
    logging.shutdown()
    shutil.rmtree(TMP, ignore_errors=True)
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
