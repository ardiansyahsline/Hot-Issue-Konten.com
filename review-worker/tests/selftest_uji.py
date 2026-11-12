"""Selftest bagian UJI AKURASI review-worker (pemilik: hakim-uji) — TANPA GPU, VPN, DB replika asli, kunci API, internet.
  .venv\\Scripts\\python tests\\selftest_uji.py             (semua tes)
  .venv\\Scripts\\python tests\\selftest_uji.py metrik      (hanya tes yang namanya mengandung kata itu)
Isi: kebenaran akhir, Wilson/median/p90 & metrik dihitung tangan, sampel berlapis (seimbang, batas campaign/reviewer/tanggal,
alasan sebanding, deterministik), jalannya job uji lewat antrian (progres, selipan job video, laporan ke bucket), batas biaya →
berhenti_biaya → Lanjutkan, batal / Ctrl+C, ulangi dengan rubrik baru (+ banding versi), mode lokal tanpa Supabase, laporan 500
baris palsu tanpa data pribadi, dan integrasi pipeline ASLI + hakim ASLI dengan klien Anthropic palsu (media ditiru).
Contoh laporan ditulis ke env REVIEW_CONTOH_LAPORAN (kalau diisi)."""
from __future__ import annotations

import dataclasses
import hashlib
import html as htmlmod
import logging
import os
import random
import re
import shutil
import sys
import tempfile
import time
import traceback
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
TMP = Path(tempfile.mkdtemp(prefix="rw-selftest-uji-"))
os.environ["REVIEW_DATA_DIR"] = str(TMP / "data")
os.environ["HOTISSUE_GPU_DIR"] = str(TMP / "gpu")
for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"):
    os.environ.pop(k, None)

from review_worker import antrian, config, jobctx, kebenaran, laporan, metrik, pipeline, privasi, runtime, uji  # noqa: E402
from review_worker import log as rlog  # noqa: E402
from review_worker.biaya import AnggaranHabis  # noqa: E402
from review_worker.skema import (CampaignDB, HasilVideo, KandidatSampel, KeputusanManusia, Rubrik, VideoDB)  # noqa: E402
from palsu_db import ReplikaPalsu, SupaPalsu, contoh  # noqa: E402

CFG0 = config.load(TMP / "tidak-ada.env")
rlog.setup(CFG0.logs)
CFG = dataclasses.replace(CFG0, anthropic_key_ada=True, worker_id="review-tes")
results: list[tuple[str, bool, str]] = []
TESTS: list = []
PROSES_ASLI = pipeline.proses_video
RUBRIK = Rubrik(versi="v1", hash="aaaaaaaaaaaa", teks="rubrik tes " * 300)
RUBRIK2 = Rubrik(versi="v2", hash="bbbbbbbbbbbb", teks="rubrik tes baru " * 300)
ALASAN = [("Konten tidak sesuai brief campaign", "tidak_sesuai_brief", 50), ("CTA wajib tidak ada", "cta_tidak_ada", 25),
          ("Followers belum memenuhi syarat", "followers_kurang", 10), ("Engagement mencurigakan / bot", "engagement_bot", 8),
          ("Link di bio belum ada", "link_bio_tidak_ada", 4), ("Video duplikat / sudah disubmit", "duplikat", 3)]
PII = "hubungi @clipper_rahasia atau rahasia.clipper@gmail.com / 0812-3456-7890 https://www.tiktok.com/@clipper_rahasia/video/1"


def test(fn):
    TESTS.append(fn)
    return fn


def run_test(fn) -> None:
    name = fn.__name__.removeprefix("t_").replace("_", " ")
    t0 = time.time()
    try:
        info = fn() or ""
        results.append((name, True, str(info)))
        print(f"[OK]    {name} ({time.time() - t0:.1f} dtk) {info}")
    except Exception as e:  # noqa: BLE001
        results.append((name, False, f"{type(e).__name__}: {e}"))
        print(f"[GAGAL] {name}: {type(e).__name__}: {e}")
        traceback.print_exc()
    finally:
        pipeline.proses_video = PROSES_ASLI


# ================================================================== dunia palsu
def dunia(n: int = 3000, n_campaign: int = 40, n_reviewer: int = 30, n_hari: int = 100, seed: int = 1):
    """video + campaign + keputusan reviewer palsu (url berisi username palsu → tes privasi)"""
    rng = random.Random(seed)
    camps = [CampaignDB(id=f"c-{i}", title=f"Film Contoh {i}", brand="Brand Contoh", status="aktif", brief_detail={"cta": "Ajak nonton"})
             for i in range(1, n_campaign + 1)]
    bobot_c = [rng.random() ** 2 + 0.02 for _ in camps]  # campaign tidak rata (ada yang sangat besar)
    vids, kep = [], {}
    for i in range(n):
        vid = str(50000 + i)
        c = rng.choices(camps, bobot_c)[0]
        reject = rng.random() < 0.35
        alasan = rng.choices(ALASAN, [a[2] for a in ALASAN])[0][0] if reject else None
        hari = 1 + rng.randrange(n_hari)
        tgl = f"2026-{6 + (hari - 1) // 28:02d}-{1 + (hari - 1) % 28:02d}"
        banding = None
        r = rng.random()
        if r < 0.04:
            banding = "dibatalkan"
        elif r < 0.07:
            banding = "dikuatkan"
        elif r < 0.08:
            banding = "menunggu"
        vids.append(VideoDB(id=vid, campaign_id=c.id, url=f"https://www.tiktok.com/@clipper{i}/video/{7300000000000000000 + i}",
                            platform="tiktok", platform_video_id=str(7300000000000000000 + i), status="rejected" if reject else "approved",
                            caption=f"Seru! {PII}", durasi_detik=20.0))
        kep[vid] = KeputusanManusia(video_id=vid, keputusan="reject" if reject else "approve", alasan_label=alasan,
                                    reviewer=f"R-{rng.randrange(n_reviewer) * 7919 % 999999:06d}" if rng.random() < 0.97 else None,
                                    diputuskan=f"{tgl}T03:00:00+00:00", banding=banding)
    return vids, camps, kep


def kandidat_dari(kep: dict, vids: list[VideoDB]) -> list[KandidatSampel]:
    cmap = {v.id: v.campaign_id for v in vids}
    return [KandidatSampel(video_id=k.video_id, campaign_id=cmap.get(k.video_id), keputusan=k.keputusan, alasan_label=k.alasan_label,
                           reviewer=k.reviewer, tanggal=k.diputuskan[:10]) for k in kep.values()]


def _h(s: str) -> int:
    return int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)


KENDALI = {"habis_setelah": None, "panggil": [], "batal_setelah": None, "stop_setelah": None, "job": None, "rt": None, "supa": None}


def proses_palsu(rt, video_id, *, scope, run_id=None, job_id=None, cek_batal=None, simpan=True, video=None, progres=None):
    """pengganti pipeline.proses_video: saran AI ditentukan hash id (±70% benar, ±12% salah, sisanya cek manusia / tak bisa
    diakses); teks memuat data pribadi palsu supaya laporan teruji membersihkannya"""
    from review_worker.alasan import kode_untuk_label

    k = KENDALI
    if k["habis_setelah"] is not None and len(k["panggil"]) >= k["habis_setelah"]:
        raise AnggaranHabis("Batas biaya harian $2 tercapai.")
    k["panggil"].append((scope, str(video_id)))
    n = len(k["panggil"])
    if k["batal_setelah"] is not None and n >= k["batal_setelah"] and k["supa"] is not None:
        k["supa"].update("review_jobs", {"id": f"eq.{k['job']}"}, {"status": "batal"})
    if k["stop_setelah"] is not None and n >= k["stop_setelah"]:
        rt.stop.set()
    vid = str(video_id)
    v = rt.replika.video.get(vid)
    km = rt.replika.keputusan_manusia([vid]).get(vid)
    hasil = HasilVideo(scope=scope, run_id=run_id, job_id=job_id, video_id=vid, campaign_id=v.campaign_id if v else None,
                       campaign_title=f"Film {v.campaign_id} {PII}" if v else None, model="claude-haiku-5-5",
                       rubric_version=rt.rubrik.versi, rubric_hash=rt.rubrik.hash)
    truth, _ = kebenaran.tentukan(km)
    h = _h(vid + rt.rubrik.hash) % 100
    if h < 3:
        hasil.pipeline_status, hasil.suggestion, hasil.error = "tidak_bisa_diakses", "cek_manusia", "Video tidak bisa diakses."
        hasil.handoff_reasons = ["video_tidak_bisa_diakses"]
    else:
        if h < 72:
            s = truth
        elif h < 84:
            s = {"approve": "reject", "reject": "approve"}.get(truth or "", "cek_manusia")
        else:
            s = "cek_manusia"
        hasil.suggestion = s or "cek_manusia"
        hasil.confidence = 55 + h % 45
        if hasil.suggestion == "reject":
            hasil.official_code = kode_untuk_label(km.alasan_label) if km and km.alasan_label else "tidak_sesuai_brief"
            hasil.official_reason = "Konten tidak sesuai brief campaign"
        if hasil.suggestion == "cek_manusia":
            hasil.handoff_reasons = ["keyakinan_rendah"] if h % 2 else ["identitas_orang", "poin_tidak_bisa_dinilai"]
        hasil.specific_reason = f"CTA tidak terdengar di detik 12. {PII}"
        hasil.checklist = [{"poin_id": "p01", "kategori": "cta", "teks": "Ajak nonton di bioskop", "wajib": True,
                            "hasil": "tidak" if hasil.suggestion == "reject" else "lolos", "bukti": f"transkrip 00:12 '{PII}'",
                            "bukti_frame": [3], "bukti_detik": [12.0], "oleh": "ai"}]
        hasil.music = {"status": "cocok", "mesin": "chroma"}
        hasil.cost_usd = 0.0013
        hasil.tokens = {"input": 4000, "output": 1400, "cache_read": 1800 if n > 1 else 0, "cache_write_1h": 0 if n > 1 else 1800,
                        "cache_write_5m": 0}
        hasil.stage_sec = {"unduh": 4.0, "asr": 3.0, "hakim": 6.0}
        hasil.process_sec = 10.0 + h % 7
    pipeline._isi_manusia(hasil, km)
    if simpan:
        pipeline._simpan(rt, hasil)
    return hasil


class BudgetPalsu:
    def __init__(self):
        self.habis = False

    def cek(self, perkiraan_usd: float = 0.004):
        if self.habis:
            raise AnggaranHabis("Batas biaya harian $2 tercapai.")

    def terpakai(self):
        return 0.0


def buat_rt(supa=True, n: int = 1200, rubrik: Rubrik = RUBRIK, data: tuple | None = None):
    vids, camps, kep = data or dunia(n)
    rep = ReplikaPalsu(vids, camps, kep)
    sp = SupaPalsu("review-tes") if supa else None
    cfg = dataclasses.replace(CFG, data=TMP / f"data-{time.monotonic_ns()}")
    cfg = dataclasses.replace(cfg, laporan=cfg.data / "laporan", tmp=cfg.data / "tmp")
    cfg.data.mkdir(parents=True, exist_ok=True)
    rt = runtime.Runtime(cfg=cfg, supa=sp, replika=rep, gpu=SimpleNamespace(menunggu=False, mengalah=0))
    rt.rubrik, rt.hakim, rt.budget = rubrik, SimpleNamespace(rubrik=rubrik), BudgetPalsu()
    KENDALI.update(habis_setelah=None, panggil=[], batal_setelah=None, stop_setelah=None, job=None, rt=rt, supa=sp)
    pipeline.proses_video = proses_palsu
    return rt


def jalankan_job(rt, params: dict, created_by=None) -> dict:
    """job uji lewat jalur website: insert (RLS palsu) → klaim → antrian.tangani"""
    j = rt.supa.tambah_job("uji", params, created_by)
    KENDALI["job"] = j["id"]
    got = rt.supa.klaim_job(["uji"])
    assert got and got["id"] == j["id"], got
    antrian.tangani(rt, got)
    time.sleep(0.05)
    return rt.supa.select("review_jobs", id=f"eq.{j['id']}")[0]


# ================================================================== tes
@test
def t_kebenaran():
    km = lambda k, b=None: KeputusanManusia(video_id="1", keputusan=k, banding=b)  # noqa: E731
    assert kebenaran.tentukan(None) == (None, None)
    assert kebenaran.tentukan(km("approve")) == ("approve", None)
    assert kebenaran.tentukan(km("reject", "dibatalkan")) == ("approve", "dibatalkan")
    assert kebenaran.tentukan(km("approve", "dibatalkan")) == ("reject", "dibatalkan")
    assert kebenaran.tentukan(km("reject", "dikuatkan")) == ("reject", "dikuatkan")
    assert kebenaran.tentukan(km("reject", "menunggu")) == ("reject", "menunggu")
    assert kebenaran.tentukan(km(None, "menunggu")) == (None, "menunggu")
    assert kebenaran.cocok("approve", "approve") is True and kebenaran.cocok("reject", "approve") is False
    assert kebenaran.cocok("cek_manusia", "approve") is None and kebenaran.cocok("approve", None) is None
    return "banding dibatalkan → kebalikan; cek manusia → None"


@test
def t_wilson_median_p90():
    assert metrik.wilson(8, 10) == (49.0, 94.3), metrik.wilson(8, 10)  # nilai buku teks
    assert metrik.wilson(0, 10) == (0.0, 27.8), metrik.wilson(0, 10)
    assert metrik.wilson(10, 10) == (72.2, 100.0), metrik.wilson(10, 10)
    assert metrik.wilson(0, 0) is None and metrik.persen(0, 0)["persen"] is None
    assert metrik.persen(1, 3) == {"n": 3, "benar": 1, "persen": 33.3, "ci95": [6.1, 79.2]}, metrik.persen(1, 3)
    assert metrik.median([5, 1, 3]) == 3 and metrik.median([4, 1, 3, 2]) == 2.5 and metrik.median([]) is None
    xs = list(range(1, 21))  # 1..20 → ⌈0,9·20⌉ = 18 → nilai 18
    assert metrik.p90(xs) == 18 and metrik.p90([7]) == 7 and metrik.p90(list(range(1, 11))) == 9
    return "Wilson 8/10 = 49,0–94,3%"


def _b(i, s, h, *, truth=None, appeal=None, code=None, st="ok", cid="c-1", rev="R-1", cost=0.002, sec=10.0, oc=None, serah=None):
    return {"id": i, "video_id": str(i), "campaign_id": cid, "campaign_title": f"Film {cid}", "pipeline_status": st, "suggestion": s,
            "confidence": 80, "human_decision": h, "final_truth": truth or h, "appeal": appeal, "human_code": code,
            "human_reason": {"cta_tidak_ada": "CTA wajib tidak ada", "followers_kurang": "Followers belum memenuhi syarat",
                             "tidak_sesuai_brief": "Konten tidak sesuai brief campaign"}.get(code), "official_code": oc,
            "reviewer": rev, "cost_usd": cost, "tokens": {"input": 100, "output": 50, "cache_read": 300, "cache_write_1h": 100},
            "process_sec": sec, "stage_sec": {"unduh": 2.0, "hakim": sec - 2}, "handoff_reasons": serah or []}


@test
def t_metrik_dihitung_tangan():
    # 12 baris: 1 tak bisa diakses, 1 gagal, 1 di luar video (followers) → 9 bisa dinilai
    B = [
        _b(1, "approve", "approve", sec=10),                                                   # benar
        _b(2, "approve", "approve", sec=12, cid="c-2", rev="R-2"),                             # benar
        _b(3, "reject", "reject", code="cta_tidak_ada", oc="cta_tidak_ada", sec=14),           # benar, alasan sama
        _b(4, "reject", "reject", code="tidak_sesuai_brief", oc="cta_tidak_ada", sec=16, cid="c-2"),  # benar, alasan beda
        _b(5, "approve", "reject", code="cta_tidak_ada", sec=18, cid="c-2"),                   # SALAH berbahaya
        _b(6, "reject", "approve", sec=20, rev="R-2"),                                         # salah (terlalu ketat)
        _b(7, "cek_manusia", "approve", sec=22, serah=["keyakinan_rendah"]),                   # cek
        _b(8, "cek_manusia", "reject", code="tidak_sesuai_brief", sec=24, serah=["identitas_orang", "keyakinan_rendah"]),
        _b(9, "approve", "reject", truth="approve", appeal="dibatalkan", code="tidak_sesuai_brief", sec=26),  # benar vs akhir, beda vs reviewer
        _b(10, "approve", "reject", code="followers_kurang", sec=28),                          # di luar video
        _b(11, "cek_manusia", "approve", st="tidak_bisa_diakses", cost=0, sec=3, serah=["video_tidak_bisa_diakses"]),
        _b(12, "cek_manusia", "reject", st="gagal", cost=0, sec=2, serah=["ai_gagal"]),
    ]
    for r in B[10:]:
        r["tokens"] = {}
    m = metrik.hitung_metrik(B, SimpleNamespace(kurs_idr=18000, video_per_hari=2000), n_sampel=15)
    assert (m["n_sampel"], m["n_diproses"], m["n_tidak_bisa_diakses"], m["n_gagal"], m["n_dinilai"], m["n_di_luar_video"]) == (15, 12, 1, 1, 9, 1), m
    # diputuskan AI (bisa dinilai) = 1,2,3,4,5,6,9 = 7; sama dengan reviewer: 1,2,3,4 = 4; sama dengan akhir: 1,2,3,4,9 = 5
    assert m["setuju_reviewer"]["n"] == 7 and m["setuju_reviewer"]["benar"] == 4 and m["setuju_reviewer"]["persen"] == 57.1
    assert m["setuju_akhir"]["benar"] == 5 and m["setuju_akhir"]["persen"] == 71.4
    assert m["akurasi_tanpa_cek_manusia"] == metrik.persen(5, 9) and m["akurasi_tanpa_cek_manusia"]["persen"] == 55.6
    assert m["persen_cek_manusia"] == 22.2 and m["cakupan"] == 77.8  # 2/9, 7/9
    assert m["matriks"] == {"approve": {"approve": 3, "reject": 1, "cek_manusia": 1}, "reject": {"approve": 1, "reject": 2, "cek_manusia": 1}}, m["matriks"]
    assert m["presisi_reject"]["benar"] == 2 and m["presisi_reject"]["n"] == 3 and m["recall_reject"]["n"] == 4
    pa = {x["code"]: x for x in m["per_alasan"]}
    assert pa["cta_tidak_ada"] == {"code": "cta_tidak_ada", "label": "CTA wajib tidak ada", "n": 2, "ai_reject": 1, "ai_reject_alasan_sama": 1,
                                   "ai_approve": 1, "ai_cek": 0, "di_luar_video": False, "akurasi": 50.0}, pa["cta_tidak_ada"]
    assert pa["tidak_sesuai_brief"]["n"] == 2 and pa["tidak_sesuai_brief"]["ai_reject_alasan_sama"] == 0 and pa["tidak_sesuai_brief"]["ai_cek"] == 1
    assert pa["followers_kurang"]["di_luar_video"] and m["per_alasan"][-1]["code"] == "followers_kurang"
    pc = {c["campaign_id"]: c for c in m["per_campaign"]}
    assert (pc["c-1"]["n"], pc["c-1"]["benar"], pc["c-1"]["salah"], pc["c-1"]["cek"], pc["c-1"]["akurasi"]) == (6, 3, 1, 2, 75.0), pc["c-1"]
    assert (pc["c-2"]["benar"], pc["c-2"]["salah"], pc["c-2"]["akurasi"]) == (2, 1, 66.7)
    pr = {x["reviewer"]: x for x in m["per_reviewer"]}
    assert (pr["R-1"]["n"], pr["R-1"]["setuju"], pr["R-1"]["cek"]) == (5, 3, 2) and pr["R-2"]["persen"] == 50.0
    assert m["serah"] == {"keyakinan_rendah": 2, "ai_gagal": 1, "identitas_orang": 1, "video_tidak_bisa_diakses": 1}, m["serah"]
    assert m["banding"]["n"] == 1 and m["banding"]["dibatalkan"] == 1 and m["banding"]["ai_benar_saat_dibatalkan"] == 1
    by = m["biaya"]
    assert by["total_usd"] == 0.02 and by["n_video_ai"] == 10 and by["per_video_usd"] == 0.002
    assert by["per_video_idr"] == 36.0 and by["per_hari_idr"] == 72000 and by["per_bulan_idr"] == 2160000
    assert by["token"] == {"input": 1000, "output": 500, "cache_read": 3000, "cache_write": 1000} and by["cache_hit_persen"] == 60.0
    w = m["waktu"]  # ok = baris 1..10: 10,12,…,28 → rata 19, median 19, p90 = urutan ke-9 = 26
    assert (w["rata_detik"], w["median_detik"], w["p90_detik"]) == (19.0, 19.0, 26.0), w
    assert w["per_tahap"] == {"hakim": 17.0, "unduh": 2.0}
    assert m["contoh"]["salah"][0] == 5 and set(m["contoh"]["salah"]) == {5, 6}, m["contoh"]
    assert set(m["contoh"]["benar"]) == {1, 2, 3, 4, 9}
    t = m["termasuk_di_luar_video"]["setuju_akhir"]
    assert (t["n"], t["benar"]) == (8, 5)
    return "57,1% vs reviewer · 71,4% vs akhir · 55,6% tanpa cek · matriks 3×2 tepat"


@test
def t_sampel_berlapis():
    vids, _c, kep = dunia(3000)
    kand = kandidat_dari(kep, vids)
    ids, info = uji.pilih_sampel_rinci(kand, 500, 7)
    assert len(ids) == 500 == len(set(ids)) and info["n_approve"] == 250 and info["n_reject"] == 250 and info["seimbang"], info
    k = {x.video_id: x for x in kand}
    from collections import Counter
    pc, pr, pt = Counter(k[i].campaign_id for i in ids), Counter(k[i].reviewer for i in ids if k[i].reviewer), Counter(k[i].tanggal for i in ids)
    assert max(pc.values()) <= 75 and max(pr.values()) <= 125 and max(pt.values()) <= 50, (max(pc.values()), max(pr.values()), max(pt.values()))
    assert len(pc) >= 20 and len(pt) >= 10 and info["longgar"] == 1, (len(pc), len(pt), info["longgar"])
    # reject per alasan sebanding frekuensi kandidat (selisih ≤ 3 dari kuota sisa terbesar)
    rej = [x for x in kand if x.keputusan == "reject"]
    frek = Counter(x.alasan_label.lower() for x in rej)
    for lab, jml in frek.items():
        harap = 250 * jml / len(rej)
        assert abs(info["reject_per_alasan"].get(lab, 0) - harap) <= 3, (lab, info["reject_per_alasan"].get(lab), harap)
    # deterministik walau urutan masukan acak; seed lain → sampel lain
    acak = kand[:]
    random.Random(99).shuffle(acak)
    assert uji.pilih_sampel(acak, 500, 7) == ids and uji.pilih_sampel(kand, 500, 8) != ids
    # dikelompokkan per campaign (cache brief): tiap campaign muncul sebagai satu blok berurutan
    urutan = [k[i].campaign_id for i in ids]
    blok = [c for j, c in enumerate(urutan) if j == 0 or urutan[j - 1] != c]
    assert len(blok) == len(set(blok)), "campaign tidak berkelompok"
    # 50 video: batas 8 per campaign, 13 per reviewer, 5 per tanggal
    i50, inf50 = uji.pilih_sampel_rinci(kand, 50, 3)
    assert len(i50) == 50 and inf50["batas"] == {"campaign": 8, "reviewer": 13, "tanggal": 5} and inf50["maks_per_tanggal"] <= 5
    return f"500: 250/250, {len(pc)} campaign, {len(pr)} reviewer, {len(pt)} hari; maks campaign {max(pc.values())}"


@test
def t_sampel_kurang_dan_longgar():
    kand = [KandidatSampel(video_id=str(i), campaign_id=f"c-{i % 30}", keputusan="reject" if i < 20 else "approve",
                           alasan_label="CTA wajib tidak ada" if i < 20 else None, reviewer=f"R-{i % 9}", tanggal=f"2026-09-{1 + i % 28:02d}")
            for i in range(320)]
    ids, info = uji.pilih_sampel_rinci(kand, 100, 1)
    assert len(ids) == 100 and info["n_reject"] == 20 and info["n_approve"] == 80 and not info["seimbang"]
    assert any("reject hanya 20" in c for c in info["catatan"]), info["catatan"]
    # hanya 2 campaign & 1 hari → batas harus dilonggarkan, tetap terisi penuh
    sempit = [KandidatSampel(video_id=str(i), campaign_id=f"c-{i % 2}", keputusan="approve" if i % 2 else "reject", reviewer="R-1",
                             tanggal="2026-09-01") for i in range(80)]
    ids2, info2 = uji.pilih_sampel_rinci(sempit, 50, 1)
    assert len(ids2) == 50 and info2["longgar"] in (None, 4) and any("dilonggarkan" in c for c in info2["catatan"]), info2
    ids3, info3 = uji.pilih_sampel_rinci(sempit[:10], 50, 1)
    assert len(ids3) == 10 and any("hanya 10" in c for c in info3["catatan"])
    assert uji.pilih_sampel([], 50, 1) == []
    return "kekurangan reject diisi approve; batas dilonggarkan tercatat"


@test
def t_job_uji_lewat_antrian():
    rt = buat_rt()
    vjob = rt.supa.tambah_job("video", {"ref": {"jenis": "id", "nilai": "50007"}})  # akan diselipkan di sela uji
    job = jalankan_job(rt, {"jumlah": 50})
    assert job["status"] == "selesai", job
    assert job["message"].startswith("Uji selesai: 50 video") and "Buka Ringkasan" in job["message"], job["message"]
    assert job["done"] == 50 and job["total"] == 50 and job["run_id"], job
    run = rt.supa.select("review_runs", id=f"eq.{job['run_id']}")[0]
    assert run["status"] == "selesai" and run["done"] == 50 and run["sample_size"] == 50 and len(run["sample"]) == 50
    assert run["rubric_version"] == "v1" and run["rubric_hash"] == RUBRIK.hash and run["model"] == "claude-haiku-5-5" and run["effort"] == "medium"
    assert run["job_id"] == job["id"] and run["sample_params"]["seed"] == uji.seed_bawaan() and run["finished_at"]
    assert run["sample_params"]["dari"] and run["sample_params"]["sampai"]
    hasil = rt.supa.select("review_results", run_id=f"eq.{run['id']}")
    assert len(hasil) == 50 and all(r["scope"] == f"run:{run['id']}" for r in hasil)
    m = run["metrics"]
    assert m == metrik.hitung_metrik(hasil, rt.cfg, n_sampel=50), "metrik run ≠ hitung ulang"
    assert abs(float(run["cost_usd"]) - m["biaya"]["total_usd"]) < 1e-9
    assert run["report_path"] == f"laporan/{run['id']}.html"
    isi, mime = rt.supa.storage[run["report_path"]]
    assert mime == "text/html" and b"Laporan Uji Akurasi" in isi and (rt.cfg.laporan / f"{run['id']}.html").is_file()
    assert rt.supa.select("review_rubrics", version="eq.v1")[0]["hash"] == RUBRIK.hash
    v = rt.supa.select("review_jobs", id=f"eq.{vjob['id']}")[0]
    assert v["status"] == "selesai", v
    assert rt.supa.select("review_results", scope=f"eq.job:{vjob['id']}"), "job video selipan tidak tersimpan"
    urutan = [s for s, _ in KENDALI["panggil"]]
    assert urutan.index(f"job:{vjob['id']}") == 1, "job video tidak diselipkan sesudah video uji pertama"
    return f"setuju akhir {m['setuju_akhir']['persen']}% · cek {m['persen_cek_manusia']}% · selipan video OK"


@test
def t_batas_biaya_lalu_lanjutkan():
    rt = buat_rt()
    KENDALI["habis_setelah"] = 10
    job = jalankan_job(rt, {"jumlah": 50})
    assert job["status"] == "gagal" and "Batas biaya harian $2 tercapai — klik Lanjutkan besok." == job["message"], job
    run = rt.supa.select("review_runs", id=f"eq.{job['run_id']}")[0]
    assert run["status"] == "berhenti_biaya" and run["done"] == 10 and run["metrics"]["n_diproses"] == 10, run["status"]
    assert run["report_path"] and b"Angka sementara" in rt.supa.storage[run["report_path"]][0]
    assert rt.status.get("status") == "berhenti_biaya"
    # budget sudah habis saat tombol Lanjutkan → tidak mulai
    rt.budget.habis = True
    KENDALI["habis_setelah"] = None
    job2 = jalankan_job(rt, {"lanjut_run": run["id"]})
    assert job2["status"] == "gagal" and len(KENDALI["panggil"]) == 10 and "sudah tercapai hari ini" in job2["message"], job2
    rt.budget.habis = False
    job3 = jalankan_job(rt, {"lanjut_run": run["id"]})
    assert job3["status"] == "selesai" and job3["run_id"] == run["id"], job3
    run = rt.supa.select("review_runs", id=f"eq.{run['id']}")[0]
    vids = [v for _, v in KENDALI["panggil"]]
    assert run["status"] == "selesai" and run["done"] == 50 and len(vids) == 50 == len(set(vids)), (run["status"], len(vids))
    return "berhenti_biaya di video 10 → Lanjutkan meneruskan 40 sisanya tanpa mengulang"


@test
def t_batal_dan_ctrl_c():
    rt = buat_rt()
    jobctx.CANCEL_CHECK_SEC = 0.0  # tes cepat: pembatalan dari website langsung terlihat di titik aman berikutnya
    KENDALI["batal_setelah"] = 5
    job = jalankan_job(rt, {"jumlah": 50})
    assert job["status"] == "batal", job
    run = rt.supa.select("review_runs", id=f"eq.{job['run_id']}")[0]
    assert run["status"] == "batal" and run["done"] == 5 and run["finished_at"], run
    jobctx.CANCEL_CHECK_SEC = 5.0
    # Ctrl+C sekali: video yang sedang jalan selesai, job kembali antri dengan lanjut_run
    rt = buat_rt()
    KENDALI["stop_setelah"] = 7
    job = jalankan_job(rt, {"jumlah": 50})
    assert job["status"] == "antri" and job["params"] == {"lanjut_run": job["run_id"]}, job
    run = rt.supa.select("review_runs", id=f"eq.{job['run_id']}")[0]
    assert run["status"] == "proses" and run["done"] == 7, run
    rt.stop.clear()
    KENDALI["stop_setelah"] = None
    got = rt.supa.klaim_job(["uji"])
    antrian.tangani(rt, got)
    run = rt.supa.select("review_runs", id=f"eq.{run['id']}")[0]
    assert run["status"] == "selesai" and run["done"] == 50 and len({v for _, v in KENDALI["panggil"]}) == 50
    return "batal → run batal; Ctrl+C → antri lagi lalu selesai"


@test
def t_ulangi_rubrik_baru_dan_banding_versi():
    rt = buat_rt()
    job = jalankan_job(rt, {"jumlah": 50})
    lama = rt.supa.select("review_runs", id=f"eq.{job['run_id']}")[0]
    rt.rubrik, rt.hakim = RUBRIK2, SimpleNamespace(rubrik=RUBRIK2)
    # Lanjutkan run lama dengan rubrik lain → ditolak (hasil tidak tercampur)
    try:
        uji.jalankan_uji(rt, None, lanjut_run=lama["id"])
        raise AssertionError("lanjut dengan rubrik beda harus ditolak")
    except jobctx.JobError as e:
        assert "Rubrik sudah berubah" in str(e)
    job2 = jalankan_job(rt, {"ulang_run": lama["id"]})
    assert job2["status"] == "selesai", job2
    baru = rt.supa.select("review_runs", id=f"eq.{job2['run_id']}")[0]
    assert baru["id"] != lama["id"] and baru["sample"] == lama["sample"] and baru["rubric_version"] == "v2"
    assert baru["label"] == f"ulang dari {lama['id'][:8]}" and baru["sample_params"]["ulang_dari"] == lama["id"]
    isi = rt.supa.storage[baru["report_path"]][0].decode()
    assert "Rubrik lama vs baru" in isi and "jadi benar" in isi
    bv = metrik.bandingkan_versi(lama["metrics"], baru["metrics"], rt.supa.select("review_results", run_id=f"eq.{lama['id']}"),
                                 rt.supa.select("review_results", run_id=f"eq.{baru['id']}"))
    bp = bv["berpasangan"]
    assert bp["dibanding"] == sum(bp[k] for k in ("sama_benar", "jadi_benar", "jadi_salah", "sama_salah", "lain")) > 0
    assert bv["tabel"][0]["kunci"] == "setuju_akhir" and bv["tabel"][0]["selisih"] == round(
        baru["metrics"]["setuju_akhir"]["persen"] - lama["metrics"]["setuju_akhir"]["persen"], 1)
    # run tidak ada / id tidak valid
    for p, kata in (({"ulang_run": "00000000-0000-0000-0000-000000000000"}, "tidak ditemukan"), ):
        j = jalankan_job(rt, p)
        assert j["status"] == "gagal" and kata in j["message"], j
    try:
        uji.jalankan_uji(rt, None, lanjut_run="bukan-uuid")
        raise AssertionError("id tidak valid harus ditolak")
    except jobctx.JobError:
        pass
    return f"berpasangan: {bp}"


@test
def t_mode_lokal_tanpa_supabase():
    rt = buat_rt(supa=False, n=400)
    run_id = uji.jalankan_uji(rt, None, jumlah=30, seed=5)
    f = rt.cfg.data / "runs" / f"{run_id}.json"
    import json
    run = json.loads(f.read_text(encoding="utf-8"))
    assert run["status"] == "selesai" and run["done"] == 30 and run["metrics"]["n_diproses"] == 30
    assert (rt.cfg.laporan / f"{run_id}.html").is_file()
    # lanjut di mode lokal: Ctrl+C di video 4, lalu --lanjut
    rt2 = buat_rt(supa=False, n=400)
    KENDALI["stop_setelah"] = 4
    try:
        uji.jalankan_uji(rt2, None, jumlah=20, seed=5)
        raise AssertionError("harus berhenti")
    except KeyboardInterrupt:
        pass
    rid = next((rt2.cfg.data / "runs").glob("*.json")).stem
    KENDALI["stop_setelah"] = None
    rt2.stop.clear()
    assert uji.jalankan_uji(rt2, None, lanjut_run=rid) == rid
    run2 = json.loads((rt2.cfg.data / "runs" / f"{rid}.json").read_text(encoding="utf-8"))
    assert run2["status"] == "selesai" and run2["done"] == 20 and len({v for _, v in KENDALI["panggil"]}) == 20
    # tanpa kunci AI → ditolak dengan pesan awam (tanpa memproses video)
    rt3 = buat_rt(supa=False, n=50)
    rt3.cfg = dataclasses.replace(rt3.cfg, anthropic_key_ada=False)
    rt3.hakim = None
    try:
        uji.jalankan_uji(rt3, None, jumlah=10)
        raise AssertionError("tanpa kunci harus ditolak")
    except jobctx.JobError as e:
        assert "ANTHROPIC_API_KEY" in str(e) and not KENDALI["panggil"]
    return "run lokal + hasil-lokal.jsonl + laporan; --lanjut lokal OK"


def _cek_tanpa_pii(isi: str) -> None:
    assert "<script" not in isi.lower() and "<img" not in isi.lower() and "http" not in isi.lower(), "skrip/gambar/link luar"
    for jejak in ("clipper_rahasia", "rahasia.clipper", "gmail", "0812", "3456-7890", "tiktok.com", "/video/"):
        assert jejak not in isi, f"data pribadi bocor: {jejak}"
    body = isi.split("</style>", 1)[1]
    teks = htmlmod.unescape(re.sub(r"<[^>]+>", " ", body))
    assert not privasi.ada_data_pribadi(teks), "pola data pribadi tersisa"


@test
def t_laporan_500_baris_tanpa_data_pribadi():
    rng = random.Random(4)
    B = []
    for i in range(500):
        truth = "reject" if i % 2 else "approve"
        u = rng.random()
        s = truth if u < 0.74 else ({"approve": "reject", "reject": "approve"}[truth] if u < 0.86 else "cek_manusia")
        code = rng.choice([a[1] for a in ALASAN]) if truth == "reject" else None
        st = "tidak_bisa_diakses" if u > 0.985 else "ok"
        B.append({"id": 1000 + i, "video_id": str(880000 + i), "campaign_id": f"c-{i % 37}", "campaign_title": f"Film {i % 37} {PII}",
                  "pipeline_status": st, "suggestion": s, "confidence": rng.randrange(40, 100), "human_decision": truth,
                  "final_truth": truth, "appeal": rng.choice([None] * 20 + ["dikuatkan"]), "human_code": code,
                  "human_reason": next((a[0] for a in ALASAN if a[1] == code), None), "official_code": code if s == "reject" else None,
                  "official_reason": "Konten tidak sesuai brief campaign" if s == "reject" else None,
                  "specific_reason": f"Tidak ada ajakan menonton. {PII}", "reviewer": f"R-{i % 23:06d}",
                  "checklist": [{"poin_id": "p01", "kategori": "cta", "teks": f"Ajak nonton {PII}", "wajib": True, "hasil": "tidak",
                                 "bukti": f"OCR frame 4: {PII}", "oleh": "ai"}],
                  "music": {"status": "cocok", "mesin": rng.choice(["panako", "chroma"])}, "handoff_reasons": ["keyakinan_rendah"] if s == "cek_manusia" else [],
                  "cost_usd": round(rng.uniform(0.0009, 0.0018), 6), "tokens": {"input": 3900, "output": 1300, "cache_read": 1800, "cache_write_1h": 4},
                  "process_sec": rng.uniform(15, 60), "stage_sec": {"unduh": 5.0, "frame": 1.2, "ocr": 2.5, "asr": 4.0, "musik": 6.0, "hakim": 7.5}})
    cfg = SimpleNamespace(kurs_idr=18000, video_per_hari=2000)
    m = metrik.hitung_metrik(B, cfg, n_sampel=500)
    run = {"id": "12345678-aaaa-bbbb-cccc-1234567890ab", "label": "uji 500 video", "status": "selesai", "rubric_version": "v1",
           "rubric_hash": "0f1e2d3c4b5a", "model": "claude-haiku-5-5", "effort": "medium", "finished_at": "2026-11-12T10:00:00+00:00",
           "sample_params": {"n_approve": 250, "n_reject": 250, "n_campaign": 37, "n_reviewer": 23, "n_tanggal": 96,
                             "tanggal_awal": "2026-07-15", "tanggal_akhir": "2026-11-10", "catatan": [f"catatan {PII}"]}}
    t0 = time.perf_counter()
    isi = laporan.buat_laporan(run, m, B)
    dt = time.perf_counter() - t0
    _cek_tanpa_pii(isi)
    mt = m["matriks"]
    for kata in ("Laporan Uji Akurasi", "Setuju dengan reviewer", "Setuju dengan hasil akhir", "Diserahkan ke manusia",
                 f"AI bilang approve padahal seharusnya reject: <b>{mt['reject']['approve']}</b>", "rentang wajar 95%",
                 "Akurasi per alasan reject", "di luar jangkauan AI", "Akurasi per campaign", "Perkiraan per bulan", "2.000 video/hari",
                 "Waktu proses", "Contoh kasus", "Video #8800", "Catatan &amp; keterbatasan", "claude-haiku-5-5", "0f1e2d3c4b5a",
                 "prefers-color-scheme:dark", 'class="grafik"', 'name="viewport"', "R-0000", "<b>12345678-aaaa-bbbb-cccc-1234567890ab</b>"):
        assert kata in isi, f"laporan kurang: {kata}"
    assert f"{m['setuju_akhir']['persen']:.1f}%".replace(".", ",") in isi
    assert "Angka sementara" not in isi and len(isi) < 400_000, len(isi)
    out = os.environ.get("REVIEW_CONTOH_LAPORAN")
    if out:
        Path(out).write_text(isi, encoding="utf-8")
    # laporan run kosong / sementara tidak error
    kosong = laporan.buat_laporan({"id": "x", "status": "berhenti_biaya"}, metrik.hitung_metrik([], cfg), [])
    assert "Angka sementara" in kosong and "Belum ada video yang bisa dinilai" in kosong
    return f"{len(isi) // 1024} KB, {dt * 1000:.0f} ms, tanpa data pribadi"


@test
def t_integrasi_pipeline_dan_hakim_asli():
    """pipeline.proses_video ASLI + brief/hakim/aturan/biaya ASLI + KlienPalsu (bentuk respons SDK) — media ditiru palsu_media"""
    from palsu_anthropic import KlienPalsu
    from palsu_media import materi_contoh, referensi_contoh
    from review_worker import biaya, brief as brief_mod, hakim as hakim_mod, rubrik as rubrik_mod
    from review_worker.media import materi as materi_mod, susun

    vids, camps, kep = contoh(2, 6)
    rt = buat_rt(data=(vids, camps, kep))
    pipeline.proses_video = PROSES_ASLI
    rub = rubrik_mod.muat_rubrik(None)
    poin = brief_mod.parse_brief(camps[0]).poin

    def jawab(saran):
        return {"checklist": [{"poin_id": p.id, "hasil": "lolos" if saran == "approve" else "tidak",
                               "bukti": "frame 3 (detik 6.4): judul film tampil; transkrip 00:08 'nonton di bioskop'",
                               "bukti_frame": [3], "bukti_detik": [6.4]} for p in poin],
                "saran": saran, "alasan_kode": None if saran == "approve" else "cta_tidak_ada",
                "alasan_spesifik": "CTA ajakan nonton terdengar di detik 8." if saran == "approve" else "Tidak ada ajakan nonton.",
                "keyakinan": 88, "ringkasan": "Contoh."}
    klien = KlienPalsu([jawab("approve"), jawab("reject")] * 10)
    rt.rubrik = rub
    rt.budget = biaya.Budget(rt.cfg, rt.supa, rt.cfg.data)
    rt.hakim = hakim_mod.Hakim(rt.cfg, rt.budget, rub, client=klien)
    asli = (susun.buat_materi_video, materi_mod.referensi_campaign)
    def materi_palsu(rt_, video, brief, ref, kerja, cek_batal=None):
        m = materi_contoh(video.id, folder=kerja, campaign_id=video.campaign_id)
        if int(video.id) % 3:  # sebagian video memakai hashtag wajib campaign → bisa approve
            m.meta.hashtags, m.meta.caption = ["#filmcontoh"], "Wajib nonton! #filmcontoh"
        return m
    susun.buat_materi_video = materi_palsu
    materi_mod.referensi_campaign = lambda rt_, cid: referensi_contoh(cid, folder=TMP)
    try:
        job = jalankan_job(rt, {"jumlah": 12})
    finally:
        susun.buat_materi_video, materi_mod.referensi_campaign = asli
    assert job["status"] == "selesai", job
    run = rt.supa.select("review_runs", id=f"eq.{job['run_id']}")[0]
    hasil = rt.supa.select("review_results", run_id=f"eq.{run['id']}")
    assert len(hasil) == 12 and run["rubric_version"] == rub.versi and run["rubric_hash"] == rub.hash
    assert all(r["rubric_hash"] == rub.hash for r in hasil if r["pipeline_status"] == "ok")
    assert len(klien.panggilan) == 12 and all(r["cost_usd"] > 0 for r in hasil), [r["cost_usd"] for r in hasil]
    assert sum(r["tokens"]["cache_read"] for r in hasil) > 0, "cache tidak pernah terbaca"
    assert all(r["human_decision"] in ("approve", "reject") and r["final_truth"] for r in hasil)
    m = run["metrics"]
    assert m["n_diproses"] == 12 and m["biaya"]["n_video_ai"] == 12 and m["biaya"]["cache_hit_persen"] > 0
    ditolak = next(r for r in hasil if r["human_decision"] == "reject" and r["appeal"] == "dibatalkan")
    assert ditolak["final_truth"] == "approve", "banding dibatalkan harus membalik kebenaran"
    _cek_tanpa_pii(rt.supa.storage[run["report_path"]][0].decode())
    pakai = rt.supa.select("review_usage_daily")
    assert pakai and pakai[0]["calls"] == 12, pakai
    return (f"12 video lewat pipeline+hakim asli · ${m['biaya']['total_usd']:.4f} · cache {m['biaya']['cache_hit_persen']}% · "
            f"saran {dict((s, sum(r['suggestion'] == s for r in hasil)) for s in ('approve', 'reject', 'cek_manusia'))}")


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
    logging.shutdown()
    shutil.rmtree(TMP, ignore_errors=True)
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
