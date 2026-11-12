"""Selftest bagian HAKIM AI review-worker (pemilik: hakim-ai) — TANPA internet, kunci API, GPU, VPN, DB replika.
  .venv\\Scripts\\python tests\\selftest_hakim.py            (semua tes)
  .venv\\Scripts\\python tests\\selftest_hakim.py brief      (hanya tes yang namanya mengandung kata itu)
Yang diuji: parser brief_detail (tests/data/brief-*.json), deteksi identitas orang, aturan kode (§5.2), biaya & batas harian,
alasan resmi, rubrik (hash, minimum prefix cache), susunan permintaan Claude (urutan cache rubrik → brief → materi, tanpa
temperature/prefill/fallbacks), penanganan refusal / max_tokens / JSON rusak / error SDK, dan SDK anthropic ASLI lewat
transport tiruan (permintaan benar-benar diserialisasi SDK, respons diurai SDK).
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import shutil
import sys
import tempfile
import traceback
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
TMP = Path(tempfile.mkdtemp(prefix="rw-selftest-hakim-"))
os.environ["REVIEW_DATA_DIR"] = str(TMP / "data")
for k in ("ANTHROPIC_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "REVIEW_RUBRIK", "REVIEW_EFFORT", "REVIEW_MODEL"):
    os.environ.pop(k, None)

from review_worker import alasan, aturan, biaya, brief, hakim, privasi, rubrik  # noqa: E402
from review_worker.skema import (CampaignDB, HasilMusik, KeputusanAI, MateriVideo,  # noqa: E402
                                 PemakaianAI, ReferensiCampaign)

import palsu_anthropic as pa  # noqa: E402
import palsu_media as pm  # noqa: E402

DATA = HERE / "data"
results: list[tuple[str, bool, str]] = []
TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def run_test(fn) -> None:
    try:
        info = fn() or ""
        results.append((fn.__name__, True, str(info)))
        print(f"  ok   {fn.__name__}{(' — ' + str(info)) if info else ''}")
    except Exception as e:  # noqa: BLE001
        results.append((fn.__name__, False, f"{type(e).__name__}: {e}"))
        print(f"  GAGAL {fn.__name__}: {type(e).__name__}: {e}")
        traceback.print_exc()


class Cfg:
    """pengganti config.Cfg (field yang dipakai hakim / aturan / budget)"""

    def __init__(self, **kw):
        self.model = "claude-haiku-5-5"
        self.effort = "medium"
        self.min_confidence = 70
        self.daily_budget_usd = 2.0
        self.anthropic_key_ada = False
        self.data = TMP / "data"
        self.__dict__.update(kw)


def brief_dari(nama: str, cid: str = "c-77", **kw):
    d = json.loads((DATA / f"brief-{nama}.json").read_text(encoding="utf-8"))
    return brief.parse_brief(CampaignDB(id=cid, title="FILM X — Campaign Desember", brand="Studio X", brief_detail=d, **kw))


def poin(b, kategori: str):
    return [p for p in b.poin if p.kategori == kategori]


def ai_semua(b, hasil: str = "lolos", saran: str = "approve", keyakinan: int = 88, alasan_kode=None, kecuali: dict | None = None,
             condong="auto", keyakinan_condong=None) -> dict:
    """jawaban AI tiruan: semua poin DINILAI AI = hasil (kecuali {poin_id: (hasil, bukti)}). condong "auto" = sama dengan saran
    (cek_manusia → approve) dengan keyakinan sama; condong None = jawaban format lama (tanpa field condong)."""
    kecuali = kecuali or {}
    cl = []
    for p in b.poin:
        if p.cara_nilai != "ai":
            continue
        h, bk = kecuali.get(p.id, (hasil, f"frame 2 (detik 3.4): bukti untuk {p.id}"))
        cl.append({"poin_id": p.id, "hasil": h, "bukti": bk, "bukti_frame": [2], "bukti_detik": [3.4]})
    out = {"checklist": cl, "saran": saran, "alasan_kode": alasan_kode, "alasan_spesifik": "Kalimat spesifik dari AI.",
           "keyakinan": keyakinan, "ringkasan": "Ringkasan AI."}
    if condong is not None:
        out["condong"] = (saran if saran in ("approve", "reject") else "approve") if condong == "auto" else condong
        out["keyakinan_condong"] = keyakinan if keyakinan_condong is None else keyakinan_condong
    return out


def materi_ok(durasi: float = 24.6, caption: str = "Wajib nonton! FILM X tayang 12 Desember di bioskop. Tag @filmx_official #filmx #konten",
              hashtags=("#filmx", "#konten"), varian: str = "lengkap") -> MateriVideo:
    m = pm.materi_contoh("48213", varian, folder=TMP / f"frames-{varian}")
    meta = m.meta.model_copy(update={"durasi_detik": durasi, "caption": caption, "hashtags": list(hashtags)})
    return m.model_copy(update={"meta": meta})


def ref_ada(lagu=True, poster=True, trailer=False) -> ReferensiCampaign:
    r = pm.referensi_contoh("c-77", lagu=lagu, poster=poster)
    if trailer:
        from review_worker.skema import MateriRef
        r.materi.append(MateriRef(id="t1", jenis="trailer", nama="trailer.mp4", path_lokal="x", status="siap"))
    return r


def rubrik_aktif():
    return rubrik.muat_rubrik()


def hakim_palsu(jawaban, cfg=None, budget=None, label=None):
    k = pa.KlienPalsu(jawaban)
    h = hakim.Hakim(cfg or Cfg(), budget, rubrik_aktif(), client=k, label_alasan=label)
    h.sleep = lambda s: None
    return h, k


# ================================================================== brief
@test
def brief_film_lengkap():
    b = brief_dari("film")
    kat = [p.kategori for p in b.poin]
    assert kat[0] == "elemen_wajib" and kat[2] == "material_wajib" and kat[3] == "footage_wajib", kat
    assert [p.id for p in b.poin] == [f"p{i:02d}" for i in range(1, len(b.poin) + 1)]
    assert b.durasi_min == 15 and b.durasi_max == 60, (b.durasi_min, b.durasi_max)
    assert b.hashtag_wajib == ["#filmx", "#konten"], b.hashtag_wajib
    assert b.caption_wajib and "12 Desember" in b.caption_wajib and "@filmx_official" in b.caption_wajib
    assert b.materi_links == ["https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz?usp=sharing"]
    fw = poin(b, "footage_wajib")[0]
    assert fw.pilihan == ["Potongan trailer resmi", "Poster resmi FILM X"] and fw.butuh_materi and fw.sumber == "footageWajibChoice"
    mw = poin(b, "material_wajib")[0]
    assert mw.butuh_materi and brief.jenis_materi_poin(mw) == {"lagu"}, brief.jenis_materi_poin(mw)
    assert poin(b, "cta")[0].kode_alasan == "cta_tidak_ada"
    assert all(p.cara_nilai == "kode" for p in b.poin if p.kategori in ("durasi", "hashtag", "caption_wajib"))
    assert all(p.cara_nilai == "data_akun" for p in b.poin if p.kategori in ("followers", "niche_akun"))
    assert "1.000" in poin(b, "followers")[0].teks
    assert all(not p.wajib and p.cara_nilai == "info" for p in b.poin if p.kategori in ("boleh", "footage_opsional"))
    assert [p.teks for p in poin(b, "dilarang")][:2] == ["Dilarang: Spoiler ending film", "Dilarang: Kata kasar"]
    assert not any(p.wajib for p in b.poin if p.kategori in ("narasi", "tujuan", "kesan", "target_audiens"))
    assert len(poin(b, "instruksi")) == 3 and poin(b, "ugc_wajah")[0].wajib
    # customSections: "Ketentuan Tambahan" wajib, "Inspirasi" info
    cs = [p for p in b.poin if p.sumber.startswith("customSections")]
    assert any(p.wajib and "vertikal" in p.teks for p in cs) and any(p.cara_nilai == "info" and "POV" in p.teks for p in cs)
    assert not b.catatan_parser, b.catatan_parser
    return f"{len(b.poin)} poin, hash {b.hash}"


@test
def brief_id_dan_hash_stabil():
    a, b = brief_dari("film"), brief_dari("film")
    assert a.hash == b.hash and [p.model_dump() for p in a.poin] == [p.model_dump() for p in b.poin]
    d = json.loads((DATA / "brief-film.json").read_text(encoding="utf-8"))
    acak = dict(reversed(list(d.items())))  # urutan key JSON berbeda → id & hash tetap
    c = brief.parse_brief(CampaignDB(id="c-77", title="FILM X — Campaign Desember", brand="Studio X", brief_detail=acak))
    assert c.hash == a.hash and [p.id + p.teks for p in c.poin] == [p.id + p.teks for p in a.poin]
    # string JSON (juga dobel-encode) = objek
    s = brief.parse_brief(CampaignDB(id="c-77", title="FILM X — Campaign Desember", brand="Studio X", brief_detail=json.dumps(json.dumps(d))))
    assert s.hash == a.hash and len(s.poin) == len(a.poin)
    d2 = dict(d, cta="Ajak nonton di bioskop sekarang")
    e = brief.parse_brief(CampaignDB(id="c-77", title="FILM X — Campaign Desember", brand="Studio X", brief_detail=d2))
    assert e.hash != a.hash


@test
def brief_tipe_aneh():
    b = brief_dari("aneh")
    t = [p.teks for p in b.poin]
    assert t[0] == "Logo BrandY di awal" and t[1] == "Sebut promo 50%", t[:2]  # HTML <ul><li><b> dibersihkan
    mw = poin(b, "material_wajib")
    assert len(mw) == 1 and mw[0].pilihan == ["Jingle BrandY", "Key visual promo"], [p.model_dump() for p in mw]
    assert poin(b, "cta")[0].teks == "Download aplikasi BrandY sekarang"
    cap = poin(b, "caption_wajib")[0]
    assert cap.cara_nilai == "ai" and "HEMAT50" in cap.teks  # kalimat perintah → AI, bukan teks persis
    assert b.hashtag_wajib == ["#brandy", "#promo50", "@brandy.id"], b.hashtag_wajib
    assert b.durasi_min == 20 and b.durasi_max == 90
    assert [p.teks for p in poin(b, "dilarang")] == ["Dilarang: Menyebut merek pesaing", "Dilarang: Menampilkan harga lama"]
    assert "5.000" in poin(b, "followers")[0].teks
    assert not poin(b, "ugc_wajah")  # "opsional" → bukan poin wajib
    assert any("keyAneh" in c for c in b.catatan_parser), b.catatan_parser
    assert b.materi_links == ["https://drive.google.com/file/d/1ZZZ/view", "https://drive.google.com/file/d/1YYY/view"]
    assert poin(b, "lainnya")[0].wajib  # "Pastikan audio jernih" = kalimat perintah


@test
def brief_rusak_tidak_pernah_melempar():
    for raw in (None, "", "bukan json {", "[]", 42, [{"key": "cta", "value": "Ajak beli"}], {"cta": None, "elemenWajib": []},
                {"durasiMin": "abc", "durasiMax": "1 menit 30 detik"}, {"elemenWajib": [[["dalam"]], {"x": {"y": "z"}}]}):
        b = brief.parse_brief(CampaignDB(id="c1", title="T", rules="Wajib sebut judul\nDilarang kata kasar", hashtags=["#a"],
                                         min_video_duration=10, brief_detail=raw))
        assert b.campaign_id == "c1"
        if raw in (None, "", "bukan json {", "[]", 42):
            assert [p.kategori for p in b.poin][:2] == ["hashtag", "durasi"] and b.durasi_min == 10, [p.kategori for p in b.poin]
            assert any(p.kategori == "dilarang" for p in b.poin) and b.catatan_parser
    b = brief.parse_brief(CampaignDB(id="c1", brief_detail=[{"key": "cta", "value": "Ajak beli"}]))
    assert poin(b, "cta")[0].teks == "Ajak beli"
    b = brief.parse_brief(CampaignDB(id="c1", brief_detail={"durasiMin": "abc", "durasiMax": "1 menit 30 detik"}))
    assert b.durasi_min is None and b.durasi_max == 90 and any("durasiMin" in c for c in b.catatan_parser)
    b = brief.parse_brief(CampaignDB(id="c1", brief_detail={"durasiMin": 60, "durasiMax": 15}))
    assert (b.durasi_min, b.durasi_max) == (15, 60)


@test
def brief_identitas_orang():
    b = brief_dari("artis")
    m = [p for p in b.poin if p.cara_nilai == "manusia"]
    assert len(m) == 4 and all(p.alasan_manusia == "identitas_orang" for p in m), [p.teks for p in m]
    assert poin(b, "cta")[0].cara_nilai == "ai"
    ya = ["Artis bukan pemain film", "Tampilkan artis X sebelum berjilbab", "Aktor memakai prostetik", "Reza Rahadian harus tampil",
          "Video wajib menampilkan pemeran utama", "Jangan tampilkan selebriti selain pemain resmi", "Pemain asli film harus muncul",
          "Dilarang memakai cuplikan artis lain", "Bukan cosplayer atau lookalike",
          # nama SESUDAH kata kerja, tanpa kata "artis/aktor"
          "Wajib menampilkan Reza Rahadian", "Footage wajib: adegan Dian Sastro menangis", "Harus ada Raffi Ahmad di video",
          "Video harus menampilkan Joko Anwar sebagai sutradara"]
    tidak = ["Wajah clipper wajib tampil", "Pakai lagu OST resmi", "Tampilkan poster film", "Buat video mirip contoh",
             "Logo Brand Resmi harus terlihat", "CTA nonton di bioskop", "Video podcast tampil di awal", "Gunakan model video 9:16",
             "Tampilkan wajah kamu sendiri", "Sebut tanggal tayang 12 Desember", "Wajib menampilkan Logo Netflix",
             "Harus ada Call To Action", "Tampilkan Poster Resmi Film", "Wajib ada Promo Spesial"]
    salah = [t for t in ya if not brief.deteksi_identitas_orang(t)] + [t for t in tidak if brief.deteksi_identitas_orang(t)]
    assert not salah, salah
    # judul film / brand (dari campaign) bukan nama orang — parser & aturan sama-sama memakai pengecualian ini
    assert brief.deteksi_identitas_orang("Wajib menampilkan Agak Laen Menyala") is True
    assert brief.deteksi_identitas_orang("Wajib menampilkan Agak Laen Menyala", ["Agak Laen: Menyala Pantiku"]) is False
    assert brief.deteksi_identitas_orang("Wajib menampilkan Samsung Galaxy", ["Samsung"]) is False
    b2 = brief.parse_brief(CampaignDB(id="c9", title="Agak Laen: Menyala Pantiku", brief_detail={
        "elemenWajib": ["Wajib menampilkan Agak Laen Menyala", "Wajib menampilkan Reza Rahadian"]}))
    cara = {p.teks: p.cara_nilai for p in b2.poin}
    assert cara["Wajib menampilkan Agak Laen Menyala"] == "ai" and cara["Wajib menampilkan Reza Rahadian"] == "manusia", cara


@test
def brief_prompt_deterministik_tanpa_link():
    b = brief_dari("film")
    t1, t2 = brief.teks_brief_untuk_prompt(b), brief.teks_brief_untuk_prompt(brief_dari("film"))
    assert t1 == t2
    for p in b.poin:
        assert f"[{p.id}]" in t1
    assert "http" not in t1 and "tiktok" not in t1.lower() and "clipperlain" not in t1
    assert "@filmx_official" in t1  # tag brand boleh tampil
    assert "1 contoh video" in t1
    bagian_ai = t1.split("## Poin yang TIDAK")[0]
    assert "[p09]" not in bagian_ai and "[p23]" not in bagian_ai and "[p01]" in bagian_ai  # durasi & followers di luar daftar AI
    assert not re.search(r"\b20\d\d-\d\d-\d\d", t1)  # tanpa tanggal / waktu


# ================================================================== aturan kode
@test
def aturan_cek_kode_durasi_hashtag_caption():
    b = brief_dari("film")
    by = lambda m: {c.kategori: (c.hasil, c.bukti) for c in aturan.cek_kode(b, m)}  # noqa: E731
    r = by(materi_ok(durasi=14.2))
    assert r["durasi"][0] == "lolos", r["durasi"]  # toleransi 1 detik
    assert by(materi_ok(durasi=13.5))["durasi"][0] == "tidak"
    assert by(materi_ok(durasi=61.5))["durasi"][0] == "tidak"
    assert by(materi_ok(durasi=61.0))["durasi"][0] == "lolos"
    m = materi_ok()
    m = m.model_copy(update={"meta": m.meta.model_copy(update={"durasi_detik": None})})
    assert by(m)["durasi"][0] == "tidak_bisa_dinilai"
    assert r["hashtag"][0] == "lolos" and r["caption_wajib"][0] == "lolos", r
    r = by(materi_ok(caption="Seru banget #filmx", hashtags=["#filmx"]))
    assert r["hashtag"][0] == "tidak" and "#konten" in r["hashtag"][1], r["hashtag"]
    assert r["caption_wajib"][0] == "tidak"
    kosong = materi_ok(caption="", hashtags=[])
    r = by(kosong)  # caption tidak ada di data, tapi sistem Konten.com mencatat hashtag_present = True
    assert r["hashtag"][0] == "lolos" and "sistem Konten.com" in r["hashtag"][1] and r["caption_wajib"][0] == "tidak_bisa_dinilai"
    r = by(kosong.model_copy(update={"meta": kosong.meta.model_copy(update={"hashtag_present": None})}))
    assert r["hashtag"][0] == "tidak_bisa_dinilai"
    r = by(kosong.model_copy(update={"meta": kosong.meta.model_copy(update={"hashtag_present": False})}))
    assert r["hashtag"][0] == "tidak"
    # hashtag huruf besar / tanpa daftar → dibaca dari caption
    assert by(materi_ok(caption="Nonton FILM X tayang 12 Desember di bioskop Wajib nonton Tag @filmx_official #FilmX #Konten", hashtags=[]))["hashtag"][0] == "lolos"
    # tag @ akun saja yang kurang → tidak bisa dinilai (bisa di-tag lewat fitur platform)
    ba = brief_dari("aneh")
    r = {c.kategori: c.hasil for c in aturan.cek_kode(ba, materi_ok(caption="Promo #brandy #promo50", hashtags=["#brandy", "#promo50"]))}
    assert r["hashtag"] == "tidak_bisa_dinilai", r


def nilai(b, jawaban: dict | None, materi=None, ref=None, cfg=None, gagal=None, label=None):
    ai = KeputusanAI.model_validate(jawaban) if jawaban is not None else None
    return aturan.terapkan_aturan(ai, b, materi or materi_ok(), ref if ref is not None else ref_ada(trailer=True), cfg or Cfg(),
                                  gagal=gagal, label_alasan=label)


@test
def aturan_approve_bersih_dan_data_akun():
    b = brief_dari("film")
    f = nilai(b, ai_semua(b))
    assert f.saran == "approve" and f.alasan_kode is None and f.serah == ["data_akun"], (f.saran, f.serah)
    ids = [c.poin_id for c in f.checklist]
    assert "p05" not in ids and "p10" not in ids  # poin info tidak masuk checklist
    fol = next(c for c in f.checklist if c.kategori == "followers")
    assert fol.hasil == "tidak_bisa_dinilai" and fol.oleh == "kode"
    assert next(c for c in f.checklist if c.kategori == "durasi").oleh == "kode"


@test
def aturan_identitas_dipaksa_manusia():
    b = brief_dari("artis")
    j = ai_semua(b)
    j["checklist"].append({"poin_id": "p01", "hasil": "lolos", "bukti": "frame 1: itu artis asli", "bukti_frame": [1], "bukti_detik": []})
    f = nilai(b, j)
    c1 = next(c for c in f.checklist if c.poin_id == "p01")
    assert c1.hasil == "tidak_bisa_dinilai" and c1.oleh == "manusia" and "mengenali orang" in c1.bukti, c1
    assert f.saran == "cek_manusia" and "identitas_orang" in f.serah, (f.saran, f.serah)
    # poin yang lolos parser sebagai "ai" tapi teksnya menyangkut identitas → tetap dipaksa di aturan
    b2 = b.model_copy(update={"poin": [p.model_copy(update={"cara_nilai": "ai", "alasan_manusia": None}) for p in b.poin]})
    f2 = nilai(b2, ai_semua(b2))
    ids = {p.id for p in b.poin if p.alasan_manusia == "identitas_orang"}
    assert len(ids) == 4 and f2.saran == "cek_manusia" and all(c.oleh == "manusia" for c in f2.checklist if c.poin_id in ids)
    # reject karena poin lain yang jelas dilanggar tetap sah
    f3 = nilai(b, ai_semua(b, saran="reject", alasan_kode="cta_tidak_ada", kecuali={poin(b, "cta")[0].id: ("tidak", "transkrip 00:00-00:20 tanpa ajakan")}))
    assert f3.saran == "reject" and f3.alasan_kode == "cta_tidak_ada" and f3.serah == ["identitas_orang"], f3.serah  # reject sah, tapi poin identitas yang tertunda tetap terlihat reviewer


@test
def aturan_materi_belum_ada_dan_musik():
    b = brief_dari("film")
    f = nilai(b, ai_semua(b), ref=ReferensiCampaign(campaign_id="c-77", status="belum_ada"))
    mw = next(c for c in f.checklist if c.kategori == "material_wajib")
    assert mw.hasil == "tidak_bisa_dinilai" and mw.oleh == "kode" and "Materi referensi" in mw.bukti
    assert f.saran == "cek_manusia" and "materi_belum_ada" in f.serah, f.serah
    # lagu ada tapi pencocok musik tidak menemukan → AI "lolos" tidak sah
    m = materi_ok(varian="tanpa_musik")
    f = nilai(b, ai_semua(b), materi=m)
    mw = next(c for c in f.checklist if c.kategori == "material_wajib")
    assert mw.hasil == "tidak_bisa_dinilai" and "lagu" in mw.bukti.lower() and f.saran == "cek_manusia"
    # AI "tidak" + panako tidak_cocok → sah → reject
    f = nilai(b, ai_semua(b, saran="reject", alasan_kode="tidak_sesuai_brief",
                         kecuali={"p03": ("tidak", "musik: pencocok panako tidak menemukan lagu OST")}), materi=m)
    assert f.saran == "reject" and next(c for c in f.checklist if c.kategori == "material_wajib").hasil == "tidak"
    # chroma (cadangan) tidak_cocok → tidak cukup untuk "tidak"
    m2 = m.model_copy(update={"musik": HasilMusik(status="tidak_cocok", mesin="chroma")})
    f = nilai(b, ai_semua(b, saran="reject", alasan_kode="tidak_sesuai_brief", kecuali={"p03": ("tidak", "musik: tidak cocok")}), materi=m2)
    assert f.saran == "cek_manusia" and "bukti_kurang" in f.serah, (f.saran, f.serah)


@test
def aturan_reject_harus_berbukti_dan_beralasan():
    b = brief_dari("film")
    label = {"cta_tidak_ada": "CTA wajib tidak ada", "tidak_sesuai_brief": "Konten tidak sesuai brief campaign"}
    f = nilai(b, ai_semua(b, saran="reject", alasan_kode="cta_tidak_ada", kecuali={"p06": ("tidak", "transkrip & OCR tanpa ajakan nonton")}),
              label=label)
    assert f.saran == "reject" and f.alasan_kode == "cta_tidak_ada" and f.alasan_label == "CTA wajib tidak ada" and not f.serah
    f = nilai(b, ai_semua(b, saran="reject", alasan_kode="cta_tidak_ada"))  # tidak ada poin "tidak"
    assert f.saran == "cek_manusia" and f.serah[0] == "bukti_kurang", f.serah
    f = nilai(b, ai_semua(b, saran="reject", alasan_kode=None, kecuali={"p06": ("tidak", "tanpa ajakan")}))
    assert f.saran == "cek_manusia" and "alasan_tidak_jelas" in f.serah
    f = nilai(b, ai_semua(b, saran="reject", alasan_kode="cta_tidak_ada", kecuali={"p06": ("tidak", "   ")}))
    assert f.saran == "cek_manusia"  # bukti kosong → hasil dibuang
    # alasan di luar video (followers) → diganti kode poin yang benar-benar dilanggar
    f = nilai(b, ai_semua(b, saran="reject", alasan_kode="followers_kurang", kecuali={"p06": ("tidak", "tanpa ajakan nonton")}))
    assert f.saran == "reject" and f.alasan_kode == "cta_tidak_ada", f.alasan_kode
    # approve padahal durasi (kode) gagal → reject sah
    f = nilai(b, ai_semua(b, keyakinan=72), materi=materi_ok(durasi=9.8))
    assert f.saran == "reject" and f.alasan_kode == "tidak_sesuai_brief" and f.keyakinan >= 90 and "9.8" in f.alasan_spesifik
    # approve padahal AI sendiri menandai poin "tidak" → tidak konsisten
    f = nilai(b, ai_semua(b, kecuali={"p01": ("tidak", "judul tidak terlihat di frame 1-8")}))
    assert f.saran == "cek_manusia" and "alasan_tidak_jelas" in f.serah
    # AI reject karena durasi tapi ragu → fakta kode tetap meyakinkan (konsisten dengan jalur approve)
    f = nilai(b, ai_semua(b, saran="reject", alasan_kode="tidak_sesuai_brief", keyakinan=55), materi=materi_ok(durasi=9.8))
    assert f.saran == "reject" and f.keyakinan == 90


@test
def aturan_keyakinan_checklist_kurang_bukti():
    b = brief_dari("film")
    f = nilai(b, ai_semua(b, keyakinan=60))
    assert f.saran == "cek_manusia" and "keyakinan_rendah" in f.serah and f.keyakinan == 60
    f = nilai(b, ai_semua(b, keyakinan=150))
    assert f.keyakinan == 100 and f.saran == "approve"
    f = nilai(b, ai_semua(b, keyakinan=-5))
    assert f.keyakinan == 0 and f.saran == "cek_manusia"
    f = nilai(b, ai_semua(b, keyakinan=60), cfg=Cfg(min_confidence=50))
    assert f.saran == "approve"
    j = ai_semua(b)
    j["checklist"] = [c for c in j["checklist"] if c["poin_id"] != "p01"]
    j["checklist"].append({"poin_id": "p99", "hasil": "lolos", "bukti": "x", "bukti_frame": [], "bukti_detik": []})
    j["checklist"][0] = {**j["checklist"][0], "bukti_frame": [0, 2, 99], "bukti_detik": [-1, 3.4, 9999]}
    f = nilai(b, j)
    assert "p99" not in [c.poin_id for c in f.checklist]
    c1 = next(c for c in f.checklist if c.poin_id == "p01")
    assert c1.hasil == "tidak_bisa_dinilai" and c1.bukti == aturan.BUKTI_TIDAK_DINILAI
    assert f.saran == "cek_manusia" and "poin_tidak_bisa_dinilai" in f.serah
    c = next(c for c in f.checklist if c.poin_id == j["checklist"][0]["poin_id"])
    assert c.bukti_frame == [2] and c.bukti_detik == [3.4], (c.bukti_frame, c.bukti_detik)
    f = nilai(b, ai_semua(b, kecuali={"p02": ("lolos", "")}))
    assert next(c for c in f.checklist if c.poin_id == "p02").bukti == aturan.BUKTI_TANPA_BUKTI and f.saran == "cek_manusia"


@test
def aturan_video_tidak_bisa_diakses_dan_ai_gagal():
    b = brief_dari("film")
    m = pm.materi_contoh("1", "tidak_bisa_diakses")
    f = nilai(b, None, materi=m)
    assert f.saran == "cek_manusia" and f.serah[0] == "video_tidak_bisa_diakses" and f.alasan_kode == "tidak_bisa_diakses"
    assert f.alasan_label == "Video tidak bisa diakses" and f.keyakinan == 0
    f = nilai(b, None, gagal="ai_menolak")
    assert f.saran == "cek_manusia" and f.serah[0] == "ai_menolak" and "menolak" in f.alasan_spesifik
    f = nilai(b, None, materi=materi_ok(durasi=5), gagal="ai_gagal")
    assert f.saran == "cek_manusia" and f.alasan_kode == "tidak_sesuai_brief"  # petunjuk dari pelanggaran kode


# ================================================================== biaya
class SupaBiaya:
    def __init__(self, gagal: int = 0):
        self.gagal = gagal
        self.hari: dict[str, float] = {}
        self.kirim: list[tuple] = []

    def tambah_biaya(self, day, cost, calls, inp, out, cr, cw):
        if self.gagal:
            self.gagal -= 1
            raise RuntimeError("Supabase putus")
        self.kirim.append((day, round(cost, 8), calls, inp, out, cr, cw))
        self.hari[day] = round(self.hari.get(day, 0) + cost, 8)
        return self.hari[day]

    def select(self, table, **kw):
        if self.gagal:
            raise RuntimeError("Supabase putus")
        day = kw.get("day", "eq.").split(".", 1)[1]
        return [{"cost_usd": self.hari[day]}] if day in self.hari else []


@test
def biaya_hitung_tangan():
    u = {"input_tokens": 4000, "output_tokens": 1500, "cache_read_input_tokens": 3000, "cache_creation_input_tokens": 3500,
         "cache_creation": {"ephemeral_1h_input_tokens": 3500, "ephemeral_5m_input_tokens": 0}}
    p = biaya.hitung_biaya(u, "claude-haiku-5-5", "medium")
    # (4000×0,10 + 1500×0,50 + 3000×0,01 + 3500×0,20) / 1 jt = (400 + 750 + 30 + 700) / 1e6
    assert abs(p.biaya_usd - 0.00188) < 1e-12, p.biaya_usd
    assert (p.input, p.output, p.cache_read, p.cache_write_1h, p.cache_write_5m) == (4000, 1500, 3000, 3500, 0)
    p = biaya.hitung_biaya({**u, "cache_creation": {"ephemeral_1h_input_tokens": 0, "ephemeral_5m_input_tokens": 3500}}, "m", "low")
    assert abs(p.biaya_usd - (400 + 750 + 30 + 3500 * 0.125) / 1e6) < 1e-12  # tulis 5 mnt = 1,25×
    p = biaya.hitung_biaya({"input_tokens": 1000, "output_tokens": 100, "cache_creation_input_tokens": 600}, "m", "low")
    assert p.cache_write_1h == 600 and abs(p.biaya_usd - (100 + 50 + 120) / 1e6) < 1e-12  # rincian TTL hilang → anggap 1 jam
    # prompt > 100K token → tarif panjang ($0,50 / $2,50), pengali cache sama
    p = biaya.hitung_biaya({"input_tokens": 90_000, "output_tokens": 1000, "cache_read_input_tokens": 20_000}, "m", "low")
    assert abs(p.biaya_usd - (90_000 * 0.5 + 1000 * 2.5 + 20_000 * 0.05) / 1e6) < 1e-12, p.biaya_usd
    p = biaya.hitung_biaya(None, "m", "low")
    assert p.biaya_usd == 0 and p.input == 0
    # objek SDK asli
    from anthropic.types import Usage
    p = biaya.hitung_biaya(Usage.model_validate(u), "m", "low")
    assert abs(p.biaya_usd - 0.00188) < 1e-12
    return "Rp %.2f per contoh" % (0.00188 * 18000)


@test
def biaya_batas_harian_dan_supabase_putus():
    d = TMP / "biaya1"
    s = SupaBiaya()
    bud = biaya.Budget(Cfg(daily_budget_usd=0.01), s, d)
    bud.now = lambda: datetime(2026, 11, 12, 17, 30, tzinfo=timezone.utc)  # = 13 Nov 00:30 WIB
    assert bud.hari_ini().isoformat() == "2026-11-13"
    p = PemakaianAI(input=1000, output=500, cache_read=200, cache_write_1h=100, biaya_usd=0.004)
    assert abs(bud.catat(p) - 0.004) < 1e-9
    bud.cek(0.004)  # 0,008 ≤ 0,01
    bud.catat(p)
    try:
        bud.cek(0.004)
        raise AssertionError("harus AnggaranHabis")
    except biaya.AnggaranHabis as e:
        assert "Batas biaya harian $0.01" in str(e) and "Lanjutkan besok" in str(e)
    # Supabase putus → dicatat lokal, dikirim sekali kemudian (tanpa dobel)
    s.gagal = 1
    total = bud.catat(p)
    assert abs(total - 0.012) < 1e-9, total
    assert abs(bud.terpakai() - 0.012) < 1e-9
    lokal = json.loads((d / "biaya-harian.json").read_text())
    assert lokal["2026-11-13"]["tertunda"]["calls"] == 1
    total = bud.catat(p)
    assert abs(total - 0.016) < 1e-9 and abs(s.hari["2026-11-13"] - 0.016) < 1e-9, (total, s.hari)
    assert "tertunda" not in json.loads((d / "biaya-harian.json").read_text())["2026-11-13"]
    assert sum(k[2] for k in s.kirim) == 4
    # tanpa Supabase sama sekali
    bud2 = biaya.Budget(Cfg(daily_budget_usd=2), None, TMP / "biaya2")
    bud2.catat(p)
    assert abs(bud2.terpakai() - 0.004) < 1e-9
    bud0 = biaya.Budget(Cfg(daily_budget_usd=0), None, TMP / "biaya3")
    try:
        bud0.cek()
        raise AssertionError("batas 0 = AI tidak dipakai")
    except biaya.AnggaranHabis:
        pass


# ================================================================== alasan
class SupaAlasan:
    def __init__(self, rows=None, gagal=False):
        self.rows = rows or []
        self.insert_rows: list[dict] = []
        self.gagal = gagal

    def insert(self, table, rows, on_conflict=None, merge=False):
        assert table == "review_reasons" and on_conflict == "label" and merge
        self.insert_rows.extend(rows)
        return rows

    def select(self, table, **kw):
        if self.gagal:
            raise RuntimeError("putus")
        return self.rows


@test
def alasan_label_dan_sinkron():
    for kode, label in alasan.KODE_LABEL_BAWAAN.items():
        assert alasan.kode_untuk_label(label) == kode, label
    tebak = {"Konten kurang sesuai brief": "tidak_sesuai_brief", "Tidak ada CTA": "cta_tidak_ada", "Follower < 1000": "followers_kurang",
             "Views mencurigakan": "engagement_bot", "Belum pasang link bio": "link_bio_tidak_ada", "Sudah pernah disubmit": "duplikat",
             "Video private / dihapus": "tidak_bisa_diakses", "Link video rusak": "tidak_bisa_diakses", "Alasan lain": "lainnya",
             "xyz": "lainnya", "Durasi kurang dari 15 detik": "tidak_sesuai_brief", "cta_tidak_ada": "cta_tidak_ada"}
    salah = {k: alasan.kode_untuk_label(k) for k, v in tebak.items() if alasan.kode_untuk_label(k) != v}
    assert not salah, salah
    assert alasan.kode_untuk_label(None) is None and alasan.kode_untuk_label("  ") is None
    s = SupaAlasan()
    n = alasan.sinkron(s, [("CTA wajib tidak ada", 120, "2026-07-01T00:00:00+07:00", "2026-11-10T00:00:00+07:00"),
                           ("Tidak ada  ajakan nonton", 7, None, None), ("Tidak ada ajakan nonton", 3, None, None), ("", 5, None, None)])
    assert n == 2 and {r["label"]: r["uses"] for r in s.insert_rows} == {"CTA wajib tidak ada": 120, "Tidak ada ajakan nonton": 10}
    assert all(r["code"] == "cta_tidak_ada" for r in s.insert_rows)
    d = alasan.muat_daftar(SupaAlasan([{"label": "CTA tidak ada (wajib)", "code": "cta_tidak_ada", "uses": 300},
                                       {"label": "CTA wajib tidak ada", "code": "cta_tidak_ada", "uses": 120},
                                       {"label": "Aneh", "code": "bukan_kode", "uses": 999}]))
    assert d["cta_tidak_ada"] == "CTA tidak ada (wajib)" and d["duplikat"] == "Video duplikat / sudah disubmit"
    assert alasan.kode_untuk_label("CTA tidak ada (wajib)") == "cta_tidak_ada"
    assert alasan.muat_daftar(SupaAlasan(gagal=True)) == alasan.KODE_LABEL_BAWAAN
    assert alasan.label_untuk_kode("cta_tidak_ada", d) == "CTA tidak ada (wajib)" and alasan.label_untuk_kode(None) is None
    assert alasan.DI_LUAR_VIDEO == {"followers_kurang", "link_bio_tidak_ada", "duplikat", "engagement_bot", "tidak_bisa_diakses"}


# label alasan reject ASLI Konten.com (output `sinkron-alasan` di laptop user, 12-11-2026): (label, jumlah pakai, kode harapan,
# di luar jangkauan AI). 15 label resmi + label bebas yang dikutip user (sisa ±11 label bebas jarang belum diterima).
LABEL_ASLI = [
    ("Konten tidak sesuai brief campaign", 12744, "tidak_sesuai_brief", False),
    ("CTA wajib tidak ada", 1835, "cta_tidak_ada", False),
    ("Caption tidak sesuai brief", 1653, "tidak_sesuai_brief", False),
    ("Engagement mencurigakan / bot", 1166, "engagement_bot", True),
    ("Lainnya", 1117, "lainnya", False),
    ("Video duplikat / sudah disubmit", 595, "duplikat", True),
    ("Link di bio belum ada", 552, "link_bio_tidak_ada", True),
    ("Video tidak bisa diakses", 489, "tidak_bisa_diakses", True),
    ("Salah campaign", 349, "tidak_sesuai_brief", False),
    ("Brand tidak di-mention (wajib)", 280, "tidak_sesuai_brief", False),
    ("Followers belum memenuhi syarat", 181, "followers_kurang", True),
    ("Brand safety / pelanggaran", 72, "lainnya", False),
    ("Durasi video tidak sesuai", 59, "tidak_sesuai_brief", False),
    ("Konten tidak sesuai brief", 32, "tidak_sesuai_brief", False),
    ("Video pakai Ads (promosi berbayar)", 22, "lainnya", True),
    ("Konten tidak sesuai brief - Minimal 1000 follower untuk klaim", 3, "followers_kurang", True),
    ("harus ada hook di 3 detik pertama", 2, "tidak_sesuai_brief", False),
    ("tidak ada menampilkan kemasan produk", 2, "tidak_sesuai_brief", False),
    ("Duplikat konten - Tidak boleh mengambil video dari orang lain", 2, "duplikat", True),
    ("Lainnya - Konten tidak bisa diakses", 1, "tidak_bisa_diakses", True),
    ("tidak memasang bio [akun] + wajib ada hook", 1, "link_bio_tidak_ada", True),
]
# variasi label bebas yang wajar (BUKAN dari output asli) — memastikan kata kunci baru tidak salah arah
LABEL_VARIASI = {"Brand tidak di tag": "tidak_sesuai_brief", "Tidak mention akun brand": "tidak_sesuai_brief",
                 "Logo produk tidak ditampilkan": "tidak_sesuai_brief", "Salah kampanye": "tidak_sesuai_brief",
                 "Video promosi berbayar / ads": "lainnya", "Mengambil konten orang lain": "duplikat",
                 "Pelanggaran brief": "tidak_sesuai_brief", "Konten SARA / pelanggaran": "lainnya"}


@test
def alasan_label_asli_konten():
    salah = [(lab, alasan.kode_untuk_label(lab), kode) for lab, _n, kode, _l in LABEL_ASLI if alasan.kode_untuk_label(lab) != kode]
    salah += [(lab, alasan.kode_untuk_label(lab), kode) for lab, kode in LABEL_VARIASI.items() if alasan.kode_untuk_label(lab) != kode]
    assert not salah, salah
    luar = [(lab, l) for lab, _n, kode, l in LABEL_ASLI if alasan.di_luar_video(alasan.kode_untuk_label(lab), lab) != l]
    assert not luar, luar
    assert alasan.label_di_luar_video("Video pakai Ads (promosi berbayar)") and not alasan.label_di_luar_video("Brand safety / pelanggaran")
    assert not alasan.label_di_luar_video("Download aplikasi") and not alasan.label_di_luar_video(None)
    # sinkron: semua label tersimpan dengan kode yang benar
    s = SupaAlasan()
    n = alasan.sinkron(s, [(lab, jml, None, None) for lab, jml, _k, _l in LABEL_ASLI])
    assert n == len(LABEL_ASLI) and {r["label"]: r["code"] for r in s.insert_rows} == {lab: k for lab, _n, k, _l in LABEL_ASLI}
    # muat_daftar: label paling sering per kode = label resmi; kode lama yang tersimpan (aturan lama: "Salah campaign" → lainnya)
    # tidak menang atas aturan baru
    rows = [{"label": lab, "code": "lainnya" if lab in ("Salah campaign", "Brand tidak di-mention (wajib)") else k, "uses": jml}
            for lab, jml, k, _l in LABEL_ASLI]
    d = alasan.muat_daftar(SupaAlasan(rows))
    assert d["tidak_sesuai_brief"] == "Konten tidak sesuai brief campaign" and d["lainnya"] == "Lainnya", d
    assert d["followers_kurang"] == "Followers belum memenuhi syarat" and d["duplikat"] == "Video duplikat / sudah disubmit"
    assert alasan.kode_untuk_label("Salah campaign") == "tidak_sesuai_brief"
    # label asing yang tidak dikenali aturan → kode tersimpan di review_reasons dipakai
    alasan.muat_daftar(SupaAlasan([{"label": "qwerty zzz", "code": "engagement_bot", "uses": 1}]))
    assert alasan.kode_untuk_label("qwerty zzz") == "engagement_bot"
    # label yang tersedia untuk saran AI (label_untuk_kode) = label resmi yang paling sering dipakai
    assert alasan.label_untuk_kode("tidak_sesuai_brief", d) == "Konten tidak sesuai brief campaign"
    return f"{len(LABEL_ASLI)} label asli + {len(LABEL_VARIASI)} variasi"


@test
def brief_key_asli_tag_durasi_konteks():
    d = json.loads((DATA / "brief-konten-asli.json").read_text(encoding="utf-8"))
    b = brief.parse_brief(CampaignDB(id="c-31", title="Kopi Senja Ramadan", brand="PT Kopi Senja", brief_detail=d))
    assert not b.catatan_parser, b.catatan_parser  # semua key asli dikenal
    tag = [p for p in b.poin if p.sumber == "tagSocialMedia"]
    assert len(tag) == 1 and tag[0].wajib and tag[0].cara_nilai == "kode" and tag[0].kode_alasan == "tidak_sesuai_brief"
    assert "@kopisenja.id" in tag[0].teks and "@kopisenja.id" not in b.hashtag_wajib
    assert (b.durasi_min, b.durasi_max) == (30, 60) and poin(b, "durasi")[0].sumber == "durasiVideo"
    kt = brief.konteks_brief(b)
    assert kt["Jenis kampanye"] == "UGC Review Produk" and kt["Judul file dari brand"].startswith("Kopi Senja")
    assert kt["Nama brand / artis"] == "Kopi Senja"
    t = brief.teks_brief_untuk_prompt(b)
    assert "@kopisenja.id" in t and "[akun]" not in t  # handle brand tidak disamarkan pembersih privasi
    from review_worker.media import susun
    assert "@kopisenja.id" in susun.tag_boleh(b) and "@kopisenja.id" in hakim._tag_boleh(b)
    assert privasi.bersihkan_teks("Mampir ke @kopisenja.id ya, aku @clipper_x", izinkan=susun.tag_boleh(b)) == \
        "Mampir ke @kopisenja.id ya, aku [akun]"
    # durasiMin/durasiMax terisi → durasiVideo hanya mengisi sisi yang kosong
    b2 = brief.parse_brief(CampaignDB(id="c", brief_detail=dict(d, durasiMin="20", durasiVideo="maks 45 detik")))
    assert (b2.durasi_min, b2.durasi_max) == (20, 45) and poin(b2, "durasi")[0].sumber == "durasiMin/durasiVideo"
    kasus = {"30-60 detik": (30, 60), "min 30 detik": (30, None), "Minimal 15 detik, maksimal 1 menit": (15, 60),
             "maks 60 detik": (None, 60), "30": (30, None), 45: (45, None), "15s - 1 menit": (15, 60), "1-2 menit": (60, 120),
             "30 detik ke atas": (30, None), "di bawah 90 detik": (None, 90), "Rasio 9-16, durasi 30 detik": (30, None),
             "Bebas": (None, None), "": (None, None), '{"min": 15, "max": "45 detik"}': (15, 45)}
    for raw, harap in kasus.items():
        raw = json.loads(raw) if isinstance(raw, str) and raw[:1] == "{" else raw
        assert brief._durasi_video(raw) == harap, (raw, brief._durasi_video(raw))
    b3 = brief.parse_brief(CampaignDB(id="c", min_video_duration=10, brief_detail=dict(d, durasiVideo="Bebas")))
    assert (b3.durasi_min, b3.durasi_max) == (10, None) and any("durasiVideo" in c for c in b3.catatan_parser)
    # bentuk tagSocialMedia lain: per platform, tanpa '@', link profil, flag wajib tanpa akun, kosong
    bentuk = {
        json.dumps({"tiktok": "@kopisenja.tt", "instagram": "kopisenja.ig"}): "TikTok @kopisenja.tt; Instagram @kopisenja.ig",
        "kopisenja": "@kopisenja", "https://www.instagram.com/kopisenja.id/": "@kopisenja.id",
        json.dumps([{"platform": "TikTok", "username": "kopisenja"}]): "TikTok @kopisenja",
        "Wajib tag akun resmi brand": "akun brand (nama akun tidak tertulis di brief)", "ya": "akun brand (nama akun tidak tertulis di brief)",
        "": None, "tidak": None,
    }
    for raw, harap in bentuk.items():
        nilai_raw = json.loads(raw) if raw[:1] in ("[", "{") else raw
        bb = brief.parse_brief(CampaignDB(id="c", brief_detail=dict(d, tagSocialMedia=nilai_raw)))
        tp = [p for p in bb.poin if p.sumber == "tagSocialMedia"]
        if harap is None:
            assert not tp, (raw, [p.teks for p in tp])
        else:
            assert len(tp) == 1 and tp[0].teks.endswith(harap), (raw, [p.teks for p in tp])
    return f"{len(b.poin)} poin, {len(kasus)} bentuk durasiVideo, {len(bentuk)} bentuk tagSocialMedia"


@test
def aturan_tag_akun_tidak_terlihat_cek_manusia_bukan_reject():
    d = json.loads((DATA / "brief-konten-asli.json").read_text(encoding="utf-8"))
    b = brief.parse_brief(CampaignDB(id="c-31", title="Kopi Senja Ramadan", brand="PT Kopi Senja", brief_detail=d))
    pid = next(p.id for p in b.poin if p.sumber == "tagSocialMedia")

    def tag(m):
        return next((c.hasil, c.bukti) for c in aturan.cek_kode(b, m) if c.poin_id == pid)

    ada = materi_ok(durasi=40, caption="Ngopi sore! @kopisenja.id #kopisenja #ngopisore", hashtags=["#kopisenja", "#ngopisore"])
    assert tag(ada)[0] == "lolos"
    tanpa = materi_ok(durasi=40, caption="Ngopi sore! #kopisenja #ngopisore", hashtags=["#kopisenja", "#ngopisore"])
    assert tag(tanpa)[0] == "tidak_bisa_dinilai" and "cek manusia" in tag(tanpa)[1]
    kosong = materi_ok(durasi=40, caption="", hashtags=[])
    assert tag(kosong)[0] == "tidak_bisa_dinilai"
    # AI approve + tag tidak terlihat → cek manusia (bukan reject); AI reject karena poin lain tetap reject
    f = nilai(b, ai_semua(b), materi=tanpa)
    assert f.saran == "cek_manusia" and "poin_tidak_bisa_dinilai" in f.serah, (f.saran, f.serah)
    assert nilai(b, ai_semua(b), materi=ada).saran == "approve"
    f = nilai(b, ai_semua(b, saran="reject", alasan_kode="tidak_sesuai_brief"), materi=tanpa)
    assert f.saran != "reject", "tag akun tidak terlihat bukan alasan reject"
    # per platform: hanya akun platform video yang dicek
    b2 = brief.parse_brief(CampaignDB(id="c", brief_detail=dict(d, tagSocialMedia={"tiktok": "@kopisenja.tt", "instagram": "@kopisenja.ig"})))
    p2 = next(p.id for p in b2.poin if p.sumber == "tagSocialMedia")
    m_tt = materi_ok(durasi=40, caption="Enak @kopisenja.tt #kopisenja #ngopisore", hashtags=["#kopisenja"])
    m_tt = m_tt.model_copy(update={"meta": m_tt.meta.model_copy(update={"platform": "tiktok"})})
    assert next(c.hasil for c in aturan.cek_kode(b2, m_tt) if c.poin_id == p2) == "lolos"
    m_ig = m_tt.model_copy(update={"meta": m_tt.meta.model_copy(update={"platform": "instagram"})})
    assert next(c.hasil for c in aturan.cek_kode(b2, m_ig) if c.poin_id == p2) == "tidak_bisa_dinilai"
    # campuran akun per platform + akun umum: video TikTok wajib akun TikTok + akun umum
    b3 = brief.parse_brief(CampaignDB(id="c", brief_detail=dict(d, tagSocialMedia=[{"platform": "tiktok", "username": "kopi.tt"}, "@kopisenja.id"])))
    p3 = next(p for p in b3.poin if p.sumber == "tagSocialMedia")
    assert p3.teks.endswith("TikTok @kopi.tt; semua platform @kopisenja.id"), p3.teks
    m3 = m_tt.model_copy(update={"meta": m_tt.meta.model_copy(update={"caption": "Enak @kopi.tt #kopisenja"})})
    assert next(c.hasil for c in aturan.cek_kode(b3, m3) if c.poin_id == p3.id) == "tidak_bisa_dinilai"
    m3 = m_tt.model_copy(update={"meta": m_tt.meta.model_copy(update={"caption": "Enak @kopi.tt @kopisenja.id #kopisenja"})})
    assert next(c.hasil for c in aturan.cek_kode(b3, m3) if c.poin_id == p3.id) == "lolos"
    # brief hanya punya akun untuk platform LAIN (+ tanpa akun umum) → tidak berlaku untuk video ini (bukan cek manusia)
    b4 = brief.parse_brief(CampaignDB(id="c", brief_detail=dict(d, tagSocialMedia="TikTok: @kopi.tt")))
    p4 = next(p for p in b4.poin if p.sumber == "tagSocialMedia")
    assert p4.teks.endswith("TikTok @kopi.tt"), p4.teks
    m_ig4 = m_tt.model_copy(update={"meta": m_tt.meta.model_copy(update={"platform": "instagram", "caption": "Enak #kopisenja"})})
    assert next(c.hasil for c in aturan.cek_kode(b4, m_ig4) if c.poin_id == p4.id) == "lolos"
    m_tt4 = m_ig4.model_copy(update={"meta": m_ig4.meta.model_copy(update={"platform": "tiktok"})})
    assert next(c.hasil for c in aturan.cek_kode(b4, m_tt4) if c.poin_id == p4.id) == "tidak_bisa_dinilai"
    m_x4 = m_ig4.model_copy(update={"meta": m_ig4.meta.model_copy(update={"platform": None})})  # platform tak diketahui → semua dicek
    assert next(c.hasil for c in aturan.cek_kode(b4, m_x4) if c.poin_id == p4.id) == "tidak_bisa_dinilai"
    # per platform + akun umum: video Instagram hanya wajib akun umum (akun khusus TikTok tidak dicek di caption Instagram)
    b5 = brief.parse_brief(CampaignDB(id="c", brief_detail=dict(d, tagSocialMedia=[{"platform": "tiktok", "username": "kopi.tt"}, "@kopisenja.id"])))
    p5 = next(p for p in b5.poin if p.sumber == "tagSocialMedia")
    m5 = m_ig4.model_copy(update={"meta": m_ig4.meta.model_copy(update={"caption": "Enak @kopisenja.id #kopisenja"})})
    assert next(c.hasil for c in aturan.cek_kode(b5, m5) if c.poin_id == p5.id) == "lolos"
    # string per platform "TikTok: @a, Instagram: @b" → akun per platform (tidak dua-duanya diwajibkan)
    b6 = brief.parse_brief(CampaignDB(id="c", brief_detail=dict(d, tagSocialMedia="TikTok: @kopi.tt, Instagram: @kopi.ig")))
    p6 = next(p for p in b6.poin if p.sumber == "tagSocialMedia")
    assert p6.teks.endswith("TikTok @kopi.tt; Instagram @kopi.ig"), p6.teks
    m6 = m_ig4.model_copy(update={"meta": m_ig4.meta.model_copy(update={"caption": "Enak @kopi.ig #kopisenja"})})
    assert next(c.hasil for c in aturan.cek_kode(b6, m6) if c.poin_id == p6.id) == "lolos"


@test
def brief_tag_akun_isian_kosong_bukan_wajib():
    """tagSocialMedia berisi isian negatif / kosong ("Tidak ada", "N/A", "none", "kosong", "tidak wajib") → TIDAK ada poin tag wajib
    (dulu: poin wajib tanpa akun / akun palsu @none @kosong @tidak → video campaign itu tidak pernah bisa auto-approve)"""
    d = json.loads((DATA / "brief-konten-asli.json").read_text(encoding="utf-8"))
    kosong = ["Tidak ada", "tidak perlu", "N/A", "n/a", "none", "None", "kosong", "tidak wajib", "Tidak perlu tag", "-", "null",
              "Tidak ada tag wajib", "tidak.", "Opsional", "nggak perlu"]
    for raw in kosong:
        assert brief._tag_akun(raw) == ([], False), (raw, brief._tag_akun(raw))
        b = brief.parse_brief(CampaignDB(id="c", brief_detail=dict(d, tagSocialMedia=raw)))
        assert not [p for p in b.poin if p.sumber == "tagSocialMedia"], raw
    # akun asli tetap terbaca; isian negatif dengan akun eksplisit tetap memakai akunnya
    assert brief._tag_akun("brandx") == ([(None, "@brandx")], False)
    assert brief._tag_akun("Tidak perlu tag, tapi mention @brand_x di caption") == ([(None, "@brand_x")], False)
    assert brief._tag_akun("Wajib tag akun brand") == ([], True)
    assert brief._tag_akun("IG & TikTok: @a.b") == ([("Instagram", "@a.b"), ("TikTok", "@a.b")], False)
    return f"{len(kosong)} isian kosong/negatif"


@test
def brief_durasi_video_teks_bebas():
    """durasiVideo teks bebas: negasi, mm:ss, "X menit Y detik"; bacaan tidak pasti → pelanggaran = cek manusia (bukan reject 90)"""
    kasus = {"tidak lebih dari 60 detik": (None, 60, True), "Tidak boleh lebih dari 1 menit": (None, 60, True),
             "bukan lebih dari 60 detik": (None, 60, True), "tidak kurang dari 30 detik": (30, None, True),
             "1:30 menit": (90, None, False), "1 min 30 detik": (90, None, False), "1 menit 30 detik": (90, None, False),
             "maks 2:30": (None, 150, True), "min 1:00": (60, None, True), "maksimal 1 menit 30 detik": (None, 90, True),
             "min 30 detik, jangan lebih dari 1 menit": (30, 60, True), "30-60 detik": (30, 60, True),
             "Durasi video 30-60 detik": (30, 60, True), "30-60 detik, wajib hook 3 detik pertama": (30, 60, False),
             "15 detik": (15, None, False), "Rasio 9:16, durasi 30 detik": (30, None, False), "no more than 60 seconds": (None, 60, True)}
    for raw, harap in kasus.items():
        assert brief._durasi_video_rinci(raw) == harap, (raw, brief._durasi_video_rinci(raw))
    d = json.loads((DATA / "brief-konten-asli.json").read_text(encoding="utf-8"))
    d = dict(d, durasiMin="", durasiMax="")

    def br(teks, **kw):
        return brief.parse_brief(CampaignDB(id="c-31", title="Kopi Senja Ramadan", brand="PT Kopi Senja",
                                            brief_detail=dict(d, durasiVideo=teks, **kw)))

    def m(dur):  # caption memenuhi hashtag / tag akun brief asli → satu-satunya pembeda = durasi
        return materi_ok(durasi=dur, caption="Ngopi sore! @kopisenja.id #kopisenja #ngopisore", hashtags=["#kopisenja", "#ngopisore"])

    def cek(b, dur):
        pid = poin(b, "durasi")[0].id
        return next((c.hasil, c.bukti) for c in aturan.cek_kode(b, m(dur)) if c.poin_id == pid)

    b = br("tidak lebih dari 60 detik")
    assert (b.durasi_min, b.durasi_max) == (None, 60) and poin(b, "durasi")[0].teks == "Durasi video maksimal 60 detik"
    assert cek(b, 25)[0] == "lolos" and cek(b, 75)[0] == "tidak"
    b = br("1:30 menit")  # dulu: minimal 1800 detik → semua video ditolak
    assert b.durasi_min == 90 and b.durasi_ragu == ["min"] and b.durasi_teks == ["min"]
    assert cek(b, 95)[0] == "lolos"
    h, bukti = cek(b, 40)
    assert h == "tidak_bisa_dinilai" and "cek manusia" in bukti, (h, bukti)  # tebakan "minimal" → bukan fakta reject
    # AI approve + durasi teks bebas tidak pasti di luar batas → cek manusia (bukan reject keyakinan 90)
    assert nilai(b, ai_semua(b), materi=m(95)).saran == "approve"
    f = nilai(b, ai_semua(b), materi=m(40))
    assert f.saran == "cek_manusia" and "poin_tidak_bisa_dinilai" in f.serah, (f.saran, f.serah)
    # teks bebas yang pasti ("30-60 detik") tetap fakta kode → reject, keyakinan 80 (bukan 90 seperti angka durasiMin/Max)
    b = br("30-60 detik")
    assert b.durasi_teks == ["min", "max"] and b.durasi_ragu == []
    f = nilai(b, ai_semua(b, keyakinan=72), materi=m(75))
    assert f.saran == "reject" and f.keyakinan == 80, (f.saran, f.keyakinan)
    b = br("bebas", durasiMin=30, durasiMax=60)  # angka durasiMin/Max → keyakinan 90 seperti sebelumnya
    f = nilai(b, ai_semua(b, keyakinan=72), materi=m(75))
    assert f.saran == "reject" and f.keyakinan == 90 and b.durasi_teks == [], (f.saran, f.keyakinan)
    # prompt menandai durasi perkiraan
    assert "perkiraan" in brief.teks_brief_untuk_prompt(br("1:30 menit")) and "perkiraan" not in brief.teks_brief_untuk_prompt(br("30-60 detik"))
    return f"{len(kasus)} bentuk durasiVideo"


# ================================================================== condong AI (approve/reject + keyakinan) — aturan a4
@test
def skema_dan_rubrik_condong():
    sk = hakim.skema_keputusan()
    pr = sk["properties"]
    assert "condong" in sk["required"] and "keyakinan_condong" in sk["required"]
    assert pr["condong"].get("enum") == ["approve", "reject"] and "anyOf" not in pr["condong"], pr["condong"]  # tanpa null: SELALU diisi
    assert pr["keyakinan_condong"].get("type") == "integer" and "minimum" not in pr["keyakinan_condong"]
    assert "Abaikan poin BUTUH CEK MANUSIA" in pr["condong"]["description"]
    # rubrik terbaru menjelaskan condong; teks rubrik statis tetap blok system pertama (prefix cache)
    r = rubrik.muat_rubrik()
    assert r.versi == "v2" and "keyakinan_condong" in r.teks and "condong" in r.teks and "JANGAN menebak identitas" in r.teks
    assert rubrik.muat_rubrik("v1").hash != r.hash and aturan.ATURAN_VERSI == "a4"
    h, _ = hakim_palsu(ai_semua(brief_dari("film")))
    req = h.bangun_permintaan(brief_dari("film"), materi_ok(), ref_ada())
    assert req["system"][0]["text"] == r.teks and "condong" in req["messages"][0]["content"][-1]["text"]
    # jawaban format lama (tanpa condong) tetap terbaca
    assert KeputusanAI.model_validate(ai_semua(brief_dari("film"), condong=None)).condong is None


@test
def aturan_condong():
    b = brief_dari("film")
    cta = poin(b, "cta")[0].id
    # approve bersih → condong approve, keyakinan dari AI
    f = nilai(b, ai_semua(b, keyakinan=88, keyakinan_condong=83))
    assert (f.saran, f.condong, f.keyakinan_condong) == ("approve", "approve", 83), (f.saran, f.condong, f.keyakinan_condong)
    # AI menyerahkan ke manusia tapi condong reject 64 (CTA tidak ada, ada bukti) → tanda cek manusia TETAP + condong reject 64
    j = ai_semua(b, saran="cek_manusia", keyakinan=60, condong="reject", keyakinan_condong=64,
                 kecuali={cta: ("tidak", "transkrip 00:00-00:20 tanpa ajakan; OCR & caption juga tidak")})
    f = nilai(b, j)
    assert f.saran == "cek_manusia" and f.serah and (f.condong, f.keyakinan_condong) == ("reject", 64), (f.saran, f.condong, f.keyakinan_condong)
    # keyakinan saran rendah → cek manusia, condong tetap ada
    f = nilai(b, ai_semua(b, keyakinan=55, keyakinan_condong=58))
    assert f.saran == "cek_manusia" and "keyakinan_rendah" in f.serah and (f.condong, f.keyakinan_condong) == ("approve", 58)
    # dijepit 50..100
    assert nilai(b, ai_semua(b, saran="cek_manusia", keyakinan=40, keyakinan_condong=20)).keyakinan_condong == 50
    assert nilai(b, ai_semua(b, keyakinan=88, keyakinan_condong=150)).keyakinan_condong == 100
    # fakta kode: durasi 9.8 dtk < minimal 15 → condong reject (keyakinan fakta kode 90) walau AI condong approve 85
    f = nilai(b, ai_semua(b, keyakinan=85), materi=materi_ok(durasi=9.8))
    assert f.saran == "reject" and (f.condong, f.keyakinan_condong) == ("reject", 90), (f.saran, f.condong, f.keyakinan_condong)
    f = nilai(b, ai_semua(b, saran="cek_manusia", keyakinan=50, condong="reject", keyakinan_condong=95), materi=materi_ok(durasi=9.8))
    assert (f.condong, f.keyakinan_condong) == ("reject", 95)
    # hashtag wajib hilang (fakta kode) → condong reject 80
    f = nilai(b, ai_semua(b, saran="cek_manusia", keyakinan=60, condong="approve", keyakinan_condong=77),
              materi=materi_ok(caption="Seru banget filmnya", hashtags=()))
    assert f.condong == "reject" and f.keyakinan_condong == 80, (f.condong, f.keyakinan_condong)
    # saran final reject (lolos aturan) tapi AI condong approve (tidak konsisten) → condong ikut saran
    f = nilai(b, ai_semua(b, saran="reject", alasan_kode="cta_tidak_ada", keyakinan=84, condong="approve", keyakinan_condong=70,
                          kecuali={cta: ("tidak", "transkrip 00:00-00:20 tanpa ajakan")}))
    assert f.saran == "reject" and (f.condong, f.keyakinan_condong) == ("reject", 84)
    # AI gagal / menolak / video tidak bisa diakses → tanpa condong
    assert nilai(b, None, gagal="ai_gagal").condong is None and nilai(b, None, gagal="ai_menolak").keyakinan_condong is None
    m = materi_ok().model_copy(update={"status": "tidak_bisa_diakses", "error": "Video tidak bisa diakses."})
    f = nilai(b, ai_semua(b), materi=m)
    assert f.condong is None and f.keyakinan_condong is None and f.saran == "cek_manusia"
    # jawaban lama tanpa condong: saran approve → condong approve (keyakinan saran); cek_manusia + poin wajib "tidak" → reject 50
    f = nilai(b, ai_semua(b, keyakinan=88, condong=None))
    assert (f.condong, f.keyakinan_condong) == ("approve", 88)
    f = nilai(b, ai_semua(b, saran="cek_manusia", keyakinan=60, condong=None, kecuali={cta: ("tidak", "transkrip tanpa ajakan")}))
    assert (f.condong, f.keyakinan_condong) == ("reject", 50)
    return "approve/reject/cek_manusia + fakta kode + jepit + gagal = None"


@test
def aturan_condong_identitas_tidak_ditebak():
    b = brief_dari("artis")
    ids = [p.id for p in b.poin if p.alasan_manusia == "identitas_orang"]
    # poin identitas → tetap tanda cek manusia; condong AI dari poin lain (approve 75) dipertahankan
    f = nilai(b, ai_semua(b, saran="cek_manusia", keyakinan=60, condong="approve", keyakinan_condong=75))
    assert f.saran == "cek_manusia" and "identitas_orang" in f.serah and (f.condong, f.keyakinan_condong) == ("approve", 75)
    # AI melanggar rubrik: menilai poin identitas "tidak" lalu condong reject yakin → tidak ada poin lain yang dilanggar →
    # keyakinan dijepit 50 (identitas tidak boleh jadi dasar condong)
    j = ai_semua(b, saran="cek_manusia", keyakinan=60, condong="reject", keyakinan_condong=85)
    j["checklist"] += [{"poin_id": i, "hasil": "tidak", "bukti": "frame 1: bukan artis asli", "bukti_frame": [1], "bukti_detik": []}
                       for i in ids]
    f = nilai(b, j)
    assert f.condong == "reject" and f.keyakinan_condong == 50 and "identitas_orang" in f.serah, (f.condong, f.keyakinan_condong)
    assert all(c.oleh == "manusia" and c.hasil == "tidak_bisa_dinilai" for c in f.checklist if c.poin_id in ids)
    # condong reject didukung poin lain (CTA tidak ada) → keyakinan AI dipakai, tanda identitas tetap
    cta = poin(b, "cta")[0].id
    f = nilai(b, ai_semua(b, saran="cek_manusia", keyakinan=60, condong="reject", keyakinan_condong=81,
                          kecuali={cta: ("tidak", "transkrip & OCR tanpa ajakan nonton")}))
    assert (f.condong, f.keyakinan_condong) == ("reject", 81) and "identitas_orang" in f.serah


@test
def hakim_condong_lewat_sdk_tiruan():
    b = brief_dari("film")
    h, _ = hakim_palsu(ai_semua(b, saran="cek_manusia", keyakinan=62, condong="approve", keyakinan_condong=82))
    f = h.nilai(b, materi_ok(), ref_ada(trailer=True))
    assert f.saran == "cek_manusia" and (f.condong, f.keyakinan_condong) == ("approve", 82), (f.saran, f.condong, f.keyakinan_condong)
    # keyakinan_condong desimal / string di jawaban teks bebas → tetap terbaca (cadangan _urai)
    j = ai_semua(b, keyakinan_condong=79)
    j["keyakinan_condong"] = "79.4"
    resp = pa.buat_respons("Hasil:\n" + json.dumps(j), "end_turn", {"input_tokens": 1, "output_tokens": 1}, "req_c")
    ai = hakim.Hakim._urai(resp)
    assert ai is not None and ai.condong == "approve" and ai.keyakinan_condong == 79


@test
def brief_identitas_benda_dan_brand():
    """perbaikan: 'Nama Huruf Besar + terlihat/tampil/muncul' yang sebenarnya benda/produk/judul BUKAN identitas orang"""
    d = brief.deteksi_identitas_orang
    tidak = ["Kemasan Kopi Senja terlihat jelas", "Logo Brand X tampil", "Logo Kopi Kenangan tampil di akhir video",
             "Judul film Agak Laen muncul di awal video", "Poster Film Agak Laen muncul", "Wajib menampilkan kemasan Kopi Senja",
             "Produk Sabun Wangi harus terlihat", "Botol Teh Pucuk Harum terlihat di tangan", "Tulisan Promo Gajian tampil di layar",
             "Wajib ada logo Kopi Kenangan", "Nama Aplikasi Gojek muncul", "Judul Film Pengabdi Setan tampil"]
    ya = ["Artis bukan pemain film", "artis X sebelum berjilbab", "Tampilkan artis X sebelum berjilbab", "aktor pakai prostetik",
          "Reza Rahadian harus tampil", "Wajib menampilkan Reza Rahadian", "Wajib ada cuplikan Reza Rahadian",
          "Foto Reza Rahadian tampil di akhir", "Pastikan Dian Sastro muncul", "Footage wajib: adegan Dian Sastro menangis",
          # kata benda di dekat (bukan TEPAT di depan) nama orang tidak boleh membatalkan deteksi
          "Video menampilkan produk bersama Raffi Ahmad", "Tampilkan logo dan Raffi Ahmad", "Pastikan logo dan Raffi Ahmad tampil",
          "Saat minum kopi Raffi Ahmad harus terlihat", "Di acara Raffi Ahmad muncul", "Pada adegan konser Raisa Andriana muncul",
          "Video Dian Sastro tampil", "Bersama Novel Baswedan", "Tampilkan Video Dian Sastro", "Konser Raisa Andriana tampil",
          "Tampilkan logo. Raffi Ahmad harus terlihat"]
    tidak += ["Botol Aqua Life terlihat", "Menampilkan merek Kopi Senja", "Poster Agak Laen terlihat", "Festival Kopi Senja tampil",
              "Ada Kopi Kenangan", "Produk Indomie Goreng terlihat", "Logo Brand Resmi harus terlihat"]
    salah = [t for t in tidak if d(t)] + [t for t in ya if not d(t)]
    assert not salah, salah
    # namaBrandArtist: brand / produk (konteks bukan artis) → bukan orang; poin yang menyebut penyanyi/artis tetap orang
    ab, nb = brief.pengecualian_identitas("Campaign Desember", "PT Minuman", "Kopi Senja", "Promosi produk minuman")
    assert nb == ("Kopi Senja",) and not d("Kopi Senja harus tampil", ab, nb) and not d("Wajib menampilkan Kopi Senja", ab, nb)
    assert d("Penyanyi Kopi Senja harus tampil", ab, nb) and d("Artis Kopi Senja wajib muncul", ab, nb)
    # konteks artis/musik → namaBrandArtist = nama orang
    ab, nb = brief.pengecualian_identitas("Single Baru", "Label X", "Raisa Andriana", "Promosi lagu baru")
    assert nb == () and d("Raisa Andriana harus tampil", ab, nb) and d("Wajib menampilkan Raisa Andriana", ab, nb)
    ab, nb = brief.pengecualian_identitas(None, None, "Artis: Raisa Andriana", None)
    assert nb == () and d("Raisa Andriana harus tampil", ab, nb)
    # lewat parser (jenisKampanye + namaBrandArtist di brief_detail) dan aturan memakai pengecualian yang sama
    camp = CampaignDB(id="c-kopi", title="Ngopi Sore", brand="PT Senja", brief_detail={
        "jenisKampanye": "Produk minuman", "namaBrandArtist": "Kopi Senja",
        "elemenWajib": ["Kemasan Kopi Senja terlihat jelas", "Kopi Senja harus tampil", "Reza Rahadian harus tampil"]})
    bk = brief.parse_brief(camp)
    cara = {p.teks: p.cara_nilai for p in bk.poin}
    assert cara["Kemasan Kopi Senja terlihat jelas"] == "ai" and cara["Kopi Senja harus tampil"] == "ai", cara
    assert cara["Reza Rahadian harus tampil"] == "manusia", cara
    assert brief.pengecualian_brief(bk)[1] == ("Kopi Senja",)
    f = aturan.terapkan_aturan(KeputusanAI.model_validate(ai_semua(bk)), bk, materi_ok(), ref_ada(), Cfg())
    oleh = {c.teks: c.oleh for c in f.checklist}
    assert oleh["Kemasan Kopi Senja terlihat jelas"] == "ai" and oleh["Kopi Senja harus tampil"] == "ai" and oleh["Reza Rahadian harus tampil"] == "manusia"
    camp2 = CampaignDB(id="c-lagu", title="Single Baru", brand="Label X", brief_detail={
        "jenisKampanye": "Promosi lagu baru", "namaBrandArtist": "Raisa Andriana",
        "elemenWajib": ["Raisa Andriana harus tampil", "Poster Single Baru terlihat jelas"]})
    b2 = brief.parse_brief(camp2)
    cara2 = {p.teks: p.cara_nilai for p in b2.poin}
    assert cara2["Raisa Andriana harus tampil"] == "manusia" and cara2["Poster Single Baru terlihat jelas"] == "ai", cara2
    assert brief.pengecualian_brief(b2)[1] == ()
    return f"{len(tidak)} negatif + {len(ya)} positif + namaBrandArtist"


# ================================================================== rubrik
@test
def rubrik_versi_hash_dan_panjang():
    r = rubrik.muat_rubrik()
    assert r.versi == rubrik.daftar_versi()[-1] and re.fullmatch(r"[0-9a-f]{12}", r.hash)
    assert rubrik.muat_rubrik("v1").hash == rubrik.muat_rubrik("1").hash
    assert rubrik.muat_rubrik("v99").versi == r.versi  # versi tidak ada → terbaru
    # CRLF (checkout Windows) / BOM → teks & hash sama
    f = TMP / "v1-crlf.md"
    f.write_bytes(b"\xef\xbb\xbf" + (rubrik.RUBRIK_DIR / f"{r.versi}.md").read_bytes().replace(b"\n", b"\r\n"))
    assert rubrik.baca_teks(f) == r.teks and rubrik.hitung_hash(rubrik.baca_teks(f)) == r.hash
    # minimum prefix cache Haiku 5.5 = 512 token: perkiraan kasar ≥ 3× lipat (± 3,5 karakter / token teks Indonesia)
    assert len(r.teks) / 3.5 > 1500, len(r.teks)
    for kode in alasan.KODE_LABEL_BAWAAN:
        assert f"`{kode}`" in r.teks, kode
    for wajib in ("JANGAN menebak identitas", "cek_manusia", "Bukti WAJIB", "fakta_kode"):
        assert wajib in r.teks, wajib
    assert not privasi.ada_data_pribadi(r.teks.replace("[akun]", ""))
    assert r.catatan and rubrik.baris_supabase(r)["version"] == r.versi
    return f"{r.versi} {r.hash} · {len(r.teks)} karakter ≈ {len(r.teks) // 4}–{len(r.teks) // 3} token"


# ================================================================== hakim (klien palsu)
@test
def hakim_susunan_permintaan():
    b = brief_dari("film")
    h, _k = hakim_palsu(None)
    m = materi_ok()
    req = h.bangun_permintaan(b, m, ref_ada())
    assert set(req) == {"model", "max_tokens", "system", "messages", "output_config"}, set(req)  # tanpa temperature/top_p/thinking/fallbacks
    assert req["model"] == "claude-haiku-5-5" and req["max_tokens"] == 8000
    s0, s1 = req["system"]
    assert s0["text"] == h.rubrik.teks and s0["cache_control"] == {"type": "ephemeral", "ttl": "1h"}
    assert s1["text"] == brief.teks_brief_untuk_prompt(b) and s1["cache_control"] == {"type": "ephemeral", "ttl": "1h"}
    assert len(req["messages"]) == 1 and req["messages"][-1]["role"] == "user"  # tanpa prefill
    konten = req["messages"][0]["content"]
    assert not any("cache_control" in c for c in konten)  # materi video tidak di-cache
    gambar = [c for c in konten if c["type"] == "image"]
    assert len(gambar) == len(m.frames) == 8
    for i, c in enumerate(konten[:-1:2]):
        assert c["type"] == "text" and c["text"].startswith(f"Frame {i + 1} · detik ")
        img = konten[2 * i + 1]
        assert img["source"]["media_type"] == "image/jpeg" and base64.standard_b64decode(img["source"]["data"])[:3] == b"\xff\xd8\xff"
    assert konten[-1]["type"] == "text" and konten[-1]["text"].startswith("MATERI VIDEO (JSON")
    oc = req["output_config"]
    assert oc["effort"] == "medium" and oc["format"]["type"] == "json_schema" and oc["format"]["schema"] == hakim.skema_keputusan()
    # deterministik (cache) & tanpa path / id video / link
    assert h.bangun_permintaan(b, m, ref_ada()) == req
    j = konten[-1]["text"]
    for terlarang in (str(TMP), "f01.jpg", "48213", "http", "material_id", "00000000-0000-4000"):
        assert terlarang not in j, terlarang
    d = json.loads(j.split("\n", 1)[1].split("\n\nNilai video")[0])
    assert d["poin_dinilai_ai"] == [p.id for p in b.poin if p.cara_nilai == "ai"]
    assert {x["poin_id"] for x in d["fakta_kode"]} == {p.id for p in b.poin if p.cara_nilai == "kode"}
    assert d["musik"]["status"] == "cocok" and d["musik"]["terbaik"]["lagu_referensi"] == "ost-utama.wav"
    assert d["materi_referensi"]["lagu_siap"] and d["materi_referensi"]["poin_butuh_materi"]["p03"] == ["lagu"]
    # effort tinggi → ruang token lebih besar
    h2 = hakim.Hakim(Cfg(effort="high"), None, h.rubrik, client=_k)
    assert h2.bangun_permintaan(b, m, ref_ada())["max_tokens"] == 12000
    assert hakim.Hakim(Cfg(effort="ngawur"), None, h.rubrik).effort == "medium"


@test
def hakim_skema_sama_dengan_sdk():
    import anthropic

    s = hakim.skema_keputusan()
    assert anthropic.transform_schema(s) == s  # bentuk sudah sesuai yang diterima API (SDK tidak mengubah apa-apa lagi)

    def periksa(x, jalur="$"):
        if isinstance(x, dict):
            if x.get("type") == "object":
                assert x.get("additionalProperties") is False and set(x["required"]) == set(x["properties"]), jalur
            for k in ("minimum", "maximum", "minLength", "maxLength", "default", "title"):
                assert k not in x, f"{jalur}.{k}"
            for k, v in x.items():
                periksa(v, f"{jalur}.{k}")
        elif isinstance(x, list):
            for i, v in enumerate(x):
                periksa(v, f"{jalur}[{i}]")
    periksa(s)
    enum = s["properties"]["alasan_kode"]["anyOf"][0]["enum"]
    assert enum == list(alasan.KODE_LABEL_BAWAAN), enum
    # jawaban sesuai skema tervalidasi KeputusanAI
    KeputusanAI.model_validate(ai_semua(brief_dari("film")))


@test
def hakim_nilai_cache_dan_biaya():
    b = brief_dari("film")
    bud = biaya.Budget(Cfg(), SupaBiaya(), TMP / "biaya-hakim")
    h, k = hakim_palsu(ai_semua(b), budget=bud, label={"cta_tidak_ada": "CTA wajib tidak ada"})
    f1 = h.nilai(b, materi_ok(), ref_ada(trailer=True))
    f2 = h.nilai(b, materi_ok(), ref_ada(trailer=True))
    assert f1.saran == "approve" and f2.saran == "approve" and h.status == "ok"
    p1, p2 = f1.pemakaian, f2.pemakaian
    assert p1.cache_write_1h > 0 and p1.cache_read == 0, p1
    assert p2.cache_read == p1.cache_write_1h and p2.cache_write_1h == 0, p2  # panggilan ke-2 membaca cache rubrik+brief
    assert p2.biaya_usd < p1.biaya_usd and p1.request_id == "req_palsu_0001" and p1.stop_reason == "end_turn"
    assert f1.rubrik_versi == h.rubrik.versi and f1.rubrik_hash == h.rubrik.hash and p1.model == "claude-haiku-5-5"
    assert abs(bud.terpakai() - (p1.biaya_usd + p2.biaya_usd)) < 1e-9
    # campaign lain → brief beda: rubrik tetap terbaca dari cache, brief ditulis baru
    b2 = brief_dari("aneh", cid="c-88")
    h.nilai(b2, materi_ok(), ref_ada())
    p3 = h.nilai(b2, materi_ok(), ref_ada()).pemakaian
    assert p3.cache_read > 0
    per_video = (p1.biaya_usd + p2.biaya_usd) / 2
    return f"video pertama ${p1.biaya_usd:.5f}, berikutnya ${p2.biaya_usd:.5f} (≈ Rp {p2.biaya_usd * 18000:.1f}); rata2 ${per_video:.5f}"


@test
def hakim_refusal_maxtokens_rusak():
    b = brief_dari("film")
    bud = biaya.Budget(Cfg(), None, TMP / "biaya-refusal")
    for jawab, serah in (("refusal", "ai_menolak"), ("max_tokens", "ai_gagal"), ("rusak", "ai_gagal")):
        h, k = hakim_palsu(jawab, budget=bud)
        f = h.nilai(b, materi_ok(), ref_ada())
        assert f.saran == "cek_manusia" and f.serah[0] == serah, (jawab, f.serah)
        assert f.condong is None and f.keyakinan_condong is None, (jawab, f.condong)  # gagal / menolak → tanpa condong (bukan tebakan)
        assert f.pemakaian.stop_reason in ("refusal", "max_tokens", "end_turn") and len(k.panggilan) == 1
        assert f.pemakaian.input > 0  # tetap ditagih → dicatat
    assert bud.terpakai() > 0
    # JSON di tengah teks / keyakinan desimal / key tambahan → masih terbaca
    j = ai_semua(b)
    j["keyakinan"] = 87.6
    j["tambahan"] = "x"
    resp = pa.buat_respons("Berikut hasilnya:\n" + json.dumps(j), "end_turn", {"input_tokens": 1, "output_tokens": 1}, "req_x")
    ai = hakim.Hakim._urai(resp)
    assert ai is not None and ai.keyakinan == 88


@test
def hakim_error_sdk_tidak_crash():
    b = brief_dari("film")
    for jenis, n_coba, status in (("auth", 1, "gagal"), ("izin", 1, "gagal"), ("buruk", 1, "gagal"), ("server", 2, "gagal"),
                                  ("sibuk", 2, "gagal"), ("batas", 2, "gagal"), ("koneksi", 2, "gagal"), ("timeout", 2, "gagal")):
        h, k = hakim_palsu(pa.galat(jenis))
        f = h.nilai(b, materi_ok(), ref_ada())
        assert f.saran == "cek_manusia" and f.serah[0] == "ai_gagal", (jenis, f.serah)
        assert len(k.panggilan) == n_coba and h.status == status, (jenis, len(k.panggilan), h.status)
        # error yang PASTI berulang untuk semua video (kunci / izin) → h.mati (uji berhenti); sementara / 400 biasa → tidak
        assert bool(h.mati) == (jenis in ("auth", "izin")) and h.galat_terakhir, (jenis, h.mati)
    # gangguan sekali lalu pulih
    h, k = hakim_palsu([pa.galat("server"), ai_semua(b)])
    assert h.nilai(b, materi_ok(), ref_ada(trailer=True)).saran == "approve" and len(k.panggilan) == 2
    # kunci ditolak lalu berhasil (kunci diganti di klien) → mati kembali None
    h, k = hakim_palsu([pa.galat("auth"), ai_semua(b)])
    h.nilai(b, materi_ok(), ref_ada(trailer=True))
    assert h.mati and "401" in h.mati
    h.nilai(b, materi_ok(), ref_ada(trailer=True))
    assert h.mati is None
    # error tak dikenal
    h, k = hakim_palsu(ValueError("aneh"))
    assert h.nilai(b, materi_ok(), ref_ada()).serah == ["ai_gagal"]


@test
def hakim_kunci_kosong_anggaran_akses():
    b = brief_dari("film")
    h = hakim.Hakim(Cfg(anthropic_key_ada=False), None, rubrik_aktif())
    f = h.nilai(b, materi_ok(), ref_ada())
    assert f.saran == "cek_manusia" and f.serah == ["ai_gagal"] and h.status == "kunci_kosong" and "ANTHROPIC_API_KEY" in f.ringkasan
    assert h.mati and "ANTHROPIC_API_KEY" in h.mati
    # anggaran habis → diteruskan, API tidak dipanggil
    bud = biaya.Budget(Cfg(daily_budget_usd=0.001), None, TMP / "biaya-habis")
    h, k = hakim_palsu(ai_semua(b), budget=bud)
    try:
        h.nilai(b, materi_ok(), ref_ada())
        raise AssertionError("harus AnggaranHabis")
    except biaya.AnggaranHabis:
        assert not k.panggilan
    # video tidak bisa diakses → tanpa panggilan AI
    h, k = hakim_palsu(ai_semua(b))
    f = h.nilai(b, pm.materi_contoh("9", "tidak_bisa_diakses"), ref_ada())
    assert not k.panggilan and f.serah == ["video_tidak_bisa_diakses"] and f.pemakaian.biaya_usd == 0
    # brief kosong → tanpa AI
    kosong = brief.parse_brief(CampaignDB(id="c0", brief_detail=None))
    f = h.nilai(kosong, materi_ok(), ref_ada())
    assert not k.panggilan and f.saran == "cek_manusia" and f.serah == ["poin_tidak_bisa_dinilai"]


@test
def hakim_privasi_materi():
    b = brief_dari("film")
    m = materi_ok(caption="Halo @budi.clipper hub 0812-3456-7890 / budi@mail.com https://bit.ly/x Tag @filmx_official #filmx")
    from review_worker.skema import SegmenTranskrip, TeksOCR, OCRFrame
    tr = m.transkrip.model_copy(update={"segmen": m.transkrip.segmen + [SegmenTranskrip(mulai=12, selesai=14, teks="follow @budi_clip ya")]})
    ocr = m.ocr + [OCRFrame(frame_idx=6, detik=15.4, teks=[TeksOCR(teks="@budi_clip", yakin=0.9)])]
    m = m.model_copy(update={"transkrip": tr, "ocr": ocr})
    h, k = hakim_palsu(ai_semua(b))
    req = h.bangun_permintaan(b, m, ref_ada())
    teks = "\n".join(c["text"] for c in req["messages"][0]["content"] if c["type"] == "text")
    teks += "\n" + "\n".join(s["text"] for s in req["system"])
    sisa = teks.replace("@filmx_official", "")
    assert not privasi.ada_data_pribadi(sisa), re.findall(r"@\w+|\d{8,}|\S+@\S+", sisa)[:5]
    assert "budi" not in teks.lower() and "@filmx_official" in teks


@test
def hakim_sdk_asli_lewat_transport_tiruan():
    """SDK anthropic ASLI: kwargs kita diterima messages.create, body JSON sesuai, respons diurai SDK (blok thinking dulu)"""
    import anthropic
    import httpx2

    b = brief_dari("film")
    dikirim: list[dict] = []
    jawaban = ai_semua(b)

    def handler(request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content)
        dikirim.append({"url": str(request.url), "headers": dict(request.headers), "body": body})
        msg = {"id": "msg_01", "type": "message", "role": "assistant", "model": "claude-haiku-5-5",
               "content": [{"type": "thinking", "thinking": "", "signature": "abc"}, {"type": "text", "text": json.dumps(jawaban)}],
               "stop_reason": "end_turn", "stop_sequence": None, "stop_details": None,
               "usage": {"input_tokens": 3900, "output_tokens": 1450, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 4100,
                         "cache_creation": {"ephemeral_1h_input_tokens": 4100, "ephemeral_5m_input_tokens": 0}}}
        return httpx2.Response(200, json=msg, headers={"request-id": "req_asli_01"})

    klien = anthropic.Anthropic(api_key="sk-ant-tes-bukan-kunci", max_retries=0, timeout=10,
                                http_client=anthropic.DefaultHttpxClient(transport=httpx2.MockTransport(handler)))
    h = hakim.Hakim(Cfg(), None, rubrik_aktif(), client=klien)
    f = h.nilai(b, materi_ok(), ref_ada(trailer=True))
    assert f.saran == "approve", (f.saran, f.serah)
    assert f.pemakaian.request_id == "req_asli_01" and f.pemakaian.cache_write_1h == 4100
    body = dikirim[0]["body"]
    assert dikirim[0]["url"].endswith("/v1/messages")
    assert body["system"][0]["cache_control"] == {"type": "ephemeral", "ttl": "1h"} and body["system"][1]["cache_control"]["ttl"] == "1h"
    assert body["output_config"]["effort"] == "medium" and body["output_config"]["format"]["type"] == "json_schema"
    for k in ("temperature", "top_p", "top_k", "thinking", "fallbacks", "stream"):
        assert k not in body, k
    assert body["messages"][0]["content"][1]["type"] == "image"
    return f"SDK {anthropic.__version__}"


@test
def hakim_dengan_pipeline_palsu():
    """pipeline.proses_video (worker-inti) + parse_brief + Hakim ASLI (klien palsu) + Budget + SupaPalsu/ReplikaPalsu:
    antarmuka antar modul cocok, hasil tersimpan tanpa data pribadi. Media (unduh/frame/OCR/ASR) ditiru palsu_media."""
    try:
        import palsu_db
        from review_worker import config, pipeline, runtime
        from review_worker.media import materi as media_materi, susun
        from review_worker.skema import KeputusanManusia, VideoDB
    except Exception as e:  # noqa: BLE001 — modul pembangun lain belum siap
        return f"DILEWATI ({type(e).__name__}: {e})"
    d = json.loads((DATA / "brief-film.json").read_text(encoding="utf-8"))
    camp = CampaignDB(id="c-77", title="FILM X", brand="Studio X", brief_detail=d)
    video = VideoDB(id="48213", campaign_id="c-77", url="https://www.tiktok.com/@budi.clipper/video/7311111111111111111",
                    platform="tiktok", caption="Halo @budi.clipper #filmx", hashtags=["#filmx", "#konten"])
    km = KeputusanManusia(video_id="48213", keputusan="approve", reviewer="R-abc123", diputuskan="2026-11-01T10:00:00+07:00")
    rep = palsu_db.ReplikaPalsu(video=[video], campaign=[camp], keputusan={"48213": km})
    supa = palsu_db.SupaPalsu()
    cfg = config.load(TMP / "tidak-ada.env")
    rt = runtime.Runtime(cfg=cfg, supa=supa, replika=rep, gpu=pm.GpuPalsu())
    asli = (susun.buat_materi_video, media_materi.referensi_campaign)
    try:
        susun.buat_materi_video = lambda rt_, v, br, ref, kerja, cek_batal=None: materi_ok()
        media_materi.referensi_campaign = lambda rt_, cid: ref_ada(trailer=True)
        rt.budget = biaya.Budget(cfg, supa, cfg.data)
        rt.rubrik = rubrik_aktif()
        b = brief.parse_brief(camp)
        rt.hakim = hakim.Hakim(cfg, rt.budget, rt.rubrik, client=pa.KlienPalsu(ai_semua(b)))
        h = pipeline.proses_video(rt, "48213", scope="job:tes", job_id="00000000-0000-4000-8000-000000000001")
    finally:
        susun.buat_materi_video, media_materi.referensi_campaign = asli
    assert h.pipeline_status == "ok" and h.suggestion == "approve", (h.pipeline_status, h.suggestion, h.error, h.handoff_reasons)
    assert h.final_truth == "approve" and h.match is True and h.rubric_version == rubrik.daftar_versi()[-1] and h.cost_usd > 0
    assert h.tokens["cache_write_1h"] > 0 and h.stage_sec.get("hakim") is not None
    assert len(h.checklist) == len([p for p in b.poin if p.cara_nilai != "info"])
    row = supa.tabel["review_results"][0]
    teks = json.dumps(row, ensure_ascii=False)
    assert "budi" not in teks and "tiktok.com" not in teks, "data pribadi bocor ke Supabase"
    assert supa.tabel.get("review_usage_daily") and supa.tabel["review_usage_daily"][0]["calls"] == 1
    return f"hasil tersimpan: saran {h.suggestion} ({h.confidence}), ${h.cost_usd:.5f}"


def main() -> int:
    logging.basicConfig(level=logging.WARNING)
    only = [a.lower() for a in sys.argv[1:]]
    for fn in TESTS:
        if not only or any(o in fn.__name__.lower() for o in only):
            run_test(fn)
    ok = sum(1 for r in results if r[1])
    print(f"\n=== {ok}/{len(results)} tes lolos ===")
    for n, good, info in results:
        if not good:
            print(f"  GAGAL: {n} — {info}")
    logging.shutdown()
    shutil.rmtree(TMP, ignore_errors=True)
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
