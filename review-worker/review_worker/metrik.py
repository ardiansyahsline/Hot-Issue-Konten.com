"""Ringkasan akurasi + biaya satu run (pemilik: hakim-uji). Format = review_runs.metrics (KONTRAK.md §6.2) — dibaca website.

Definisi (dipakai juga oleh laporan HTML — bahasa awam di laporan.py):
- Kebenaran akhir = keputusan reviewer, kecuali dibatalkan saat banding → kebalikannya (kebenaran.tentukan).
- "Bisa dinilai" (n_dinilai) = pipeline_status ok + ada keputusan reviewer + alasan reject BUKAN di luar video. Video yang
  di-reject karena followers / link bio / duplikat (alasan.DI_LUAR_VIDEO) tidak bisa dilihat AI → dihitung terpisah
  (n_di_luar_video, per_alasan[].di_luar_video) dan tidak menghukum akurasi. Video tidak bisa diakses / gagal juga terpisah.
- setuju_reviewer / setuju_akhir = hanya video yang DIPUTUSKAN AI (approve/reject): berapa yang sama dengan reviewer /
  kebenaran akhir. akurasi_tanpa_cek_manusia = SEMUA video yang bisa dinilai sebagai penyebut: berapa yang AI putuskan
  sendiri DAN benar (cek manusia dihitung "belum selesai", bukan benar) — angka jujur untuk "kalau tanpa reviewer".
- Persen = {n, benar, persen, ci95:[bawah, atas]} — interval kepercayaan Wilson 95% (ci95 = tambahan, aman untuk tipe TS).
- matriks[kebenaran][saran] hanya video yang bisa dinilai.
- Tambahan di luar tipe RunMetrics (diabaikan website lama): setuju_reviewer_semua, presisi_reject, recall_reject, cakupan,
  n_di_luar_video, n_tanpa_keputusan, termasuk_di_luar_video, banding.dikuatkan/menunggu, biaya.n_video_ai/cache_hit_persen.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Any, Iterable, Optional

from .alasan import DI_LUAR_VIDEO, KODE_LABEL_BAWAAN
from .privasi import bersihkan_teks

AR = ("approve", "reject")
SARAN = ("approve", "reject", "cek_manusia")
Z95 = 1.959963984540054
_BALIK = {"approve": "reject", "reject": "approve"}


# ------------------------------------------------------------------ angka dasar
def _r1(x: Optional[float]) -> Optional[float]:
    return None if x is None else round(float(x) + 0.0, 1)


def wilson(benar: int, n: int, z: float = Z95) -> Optional[tuple[float, float]]:
    """interval kepercayaan Wilson (persen 0..100, 1 desimal); n = 0 → None"""
    if n <= 0:
        return None
    p = benar / n
    z2 = z * z
    pusat = (p + z2 / (2 * n)) / (1 + z2 / n)
    lebar = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n)
    return round(max(0.0, pusat - lebar) * 100, 1), round(min(1.0, pusat + lebar) * 100, 1)


def persen(benar: int, n: int) -> dict:
    ci = wilson(benar, n)
    return {"n": int(n), "benar": int(benar), "persen": _r1(benar / n * 100) if n else None, "ci95": list(ci) if ci else None}


def median(xs: list[float]) -> Optional[float]:
    s = sorted(xs)
    if not s:
        return None
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def p90(xs: list[float]) -> Optional[float]:
    """persentil 90 metode nearest-rank (mudah dihitung tangan: urutkan, ambil urutan ke-⌈0,9·n⌉)"""
    s = sorted(xs)
    if not s:
        return None
    return s[max(0, math.ceil(0.9 * len(s)) - 1)]


def _num(v: Any) -> float:
    try:
        f = float(v)
        return f if math.isfinite(f) else 0.0
    except (TypeError, ValueError):
        return 0.0


# ------------------------------------------------------------------ klasifikasi baris
def kebenaran_baris(r: dict) -> Optional[str]:
    """final_truth; kosong (baris lama / lokal) → dihitung dari human_decision + appeal"""
    t = r.get("final_truth")
    if t in AR:
        return t
    h = r.get("human_decision")
    if h not in AR:
        return None
    return _BALIK[h] if r.get("appeal") == "dibatalkan" else h


def di_luar_video(r: dict) -> bool:
    """reject (akhir) karena alasan yang tidak terlihat di video (followers / link bio / duplikat)"""
    return r.get("human_decision") == "reject" and kebenaran_baris(r) == "reject" and r.get("human_code") in DI_LUAR_VIDEO


def bisa_dinilai(r: dict) -> bool:
    return r.get("pipeline_status", "ok") == "ok" and kebenaran_baris(r) in AR and not di_luar_video(r)


def saran(r: dict) -> str:
    s = r.get("suggestion")
    return s if s in SARAN else "cek_manusia"


def unik(baris: Iterable[dict]) -> list[dict]:
    """satu baris per video (yang terakhir menang) — urutan pertama kali muncul dipertahankan"""
    out: dict[str, dict] = {}
    for r in baris or []:
        if isinstance(r, dict) and r.get("video_id") is not None:
            out[str(r["video_id"])] = r
    return list(out.values())


# ------------------------------------------------------------------ contoh kasus
def _ragam(rows: list[dict], n: int) -> list[dict]:
    """ambil n baris, campaign berbeda didahulukan (lalu sisanya), urutan masukan dipertahankan"""
    pilih, sisa, lihat = [], [], set()
    for r in rows:
        c = r.get("campaign_id")
        (sisa if c in lihat else pilih).append(r)
        lihat.add(c)
    return (pilih + sisa)[:n]


def _urut_yakin(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda r: (-int(r.get("confidence") or 0), str(r.get("video_id"))))


def pilih_contoh(baris: list[dict], n: int = 5) -> tuple[list[dict], list[dict]]:
    """(benar, salah) masing-masing ≤ n. Salah: AI approve padahal reject (paling berbahaya) dulu, lalu AI reject padahal approve,
    keyakinan tertinggi dulu. Benar: reject & approve bergantian, keyakinan tertinggi, campaign beragam."""
    d = [r for r in unik(baris) if bisa_dinilai(r) and saran(r) in AR]
    bahaya = _urut_yakin([r for r in d if saran(r) == "approve" and kebenaran_baris(r) == "reject"])
    ketat = _urut_yakin([r for r in d if saran(r) == "reject" and kebenaran_baris(r) == "approve"])
    salah = _ragam(bahaya, n)
    salah += _ragam(ketat, n - len(salah))
    br = _ragam(_urut_yakin([r for r in d if saran(r) == "reject" and kebenaran_baris(r) == "reject"]), n)
    ba = _ragam(_urut_yakin([r for r in d if saran(r) == "approve" and kebenaran_baris(r) == "approve"]), n)
    benar: list[dict] = []
    for i in range(n):
        for grup in (br, ba):
            if i < len(grup) and len(benar) < n:
                benar.append(grup[i])
    return benar, salah


def _ids(rows: list[dict]) -> list[int]:
    out = []
    for r in rows:
        try:
            out.append(int(r["id"]))
        except (KeyError, TypeError, ValueError):
            pass  # baris lokal (tanpa Supabase) tidak punya id
    return out


# ------------------------------------------------------------------ utama
def hitung_metrik(baris: list[dict], cfg, n_sampel: Optional[int] = None) -> dict:
    """baris = review_results satu run (dict dari Supabase / HasilVideo.baris_supabase()). n_sampel = ukuran sampel run
    (bawaan = jumlah baris). Video tidak_bisa_diakses / gagal tidak masuk penyebut akurasi (dihitung terpisah)."""
    rows = unik(baris)
    kurs = _num(getattr(cfg, "kurs_idr", 18000)) or 18000.0
    per_hari = int(_num(getattr(cfg, "video_per_hari", 2000)) or 2000)

    ok = [r for r in rows if r.get("pipeline_status", "ok") == "ok"]
    E = [r for r in ok if bisa_dinilai(r)]
    luar = [r for r in ok if kebenaran_baris(r) in AR and di_luar_video(r)]
    D = [r for r in E if saran(r) in AR]
    benar_rev = sum(saran(r) == r.get("human_decision") for r in D)
    benar_akhir = sum(saran(r) == kebenaran_baris(r) for r in D)

    matriks = {t: {s: 0 for s in SARAN} for t in AR}
    for r in E:
        matriks[kebenaran_baris(r)][saran(r)] += 1
    ai_reject = matriks["approve"]["reject"] + matriks["reject"]["reject"]
    n_reject = sum(matriks["reject"].values())
    n_cek = matriks["approve"]["cek_manusia"] + matriks["reject"]["cek_manusia"]

    # per alasan reject (reject akhir yang memang di-reject reviewer; dikelompokkan kode alasan reviewer)
    grup: dict[str, list[dict]] = defaultdict(list)
    for r in ok:
        if r.get("human_decision") == "reject" and kebenaran_baris(r) == "reject":
            grup[r.get("human_code") or "lainnya"].append(r)
    per_alasan = []
    for kode, rs in grup.items():
        label = Counter(r.get("human_reason") for r in rs if r.get("human_reason")).most_common(1)
        rj = [r for r in rs if saran(r) == "reject"]
        ap = sum(saran(r) == "approve" for r in rs)
        per_alasan.append({
            "code": kode, "label": bersihkan_teks(label[0][0], 160) if label else KODE_LABEL_BAWAAN.get(kode, kode), "n": len(rs), "ai_reject": len(rj),
            "ai_reject_alasan_sama": sum(r.get("official_code") == kode for r in rj), "ai_approve": ap,
            "ai_cek": sum(saran(r) == "cek_manusia" for r in rs), "di_luar_video": kode in DI_LUAR_VIDEO,
            "akurasi": _r1(len(rj) / (len(rj) + ap) * 100) if (len(rj) + ap) else None,
        })
    per_alasan.sort(key=lambda x: (x["di_luar_video"], -x["n"], x["code"]))

    pc: dict[str, dict] = {}
    for r in E:
        cid = str(r.get("campaign_id") or "-")
        c = pc.setdefault(cid, {"campaign_id": cid, "title": None, "n": 0, "benar": 0, "salah": 0, "cek": 0, "akurasi": None})
        c["title"] = c["title"] or (bersihkan_teks(r.get("campaign_title"), 200) or None)
        c["n"] += 1
        s = saran(r)
        if s == "cek_manusia":
            c["cek"] += 1
        elif s == kebenaran_baris(r):
            c["benar"] += 1
        else:
            c["salah"] += 1
    for c in pc.values():
        c["akurasi"] = _r1(c["benar"] / (c["benar"] + c["salah"]) * 100) if (c["benar"] + c["salah"]) else None
    per_campaign = sorted(pc.values(), key=lambda c: (-c["n"], c["campaign_id"]))

    pr: dict[str, dict] = {}
    for r in E:
        nama = bersihkan_teks(r.get("reviewer"), 40) or "(tanpa data)"
        x = pr.setdefault(nama, {"reviewer": nama, "n": 0, "setuju": 0, "persen": None, "cek": 0})
        if saran(r) in AR:
            x["n"] += 1
            x["setuju"] += int(saran(r) == r.get("human_decision"))
        else:
            x["cek"] += 1
    for x in pr.values():
        x["persen"] = _r1(x["setuju"] / x["n"] * 100) if x["n"] else None
    per_reviewer = sorted(pr.values(), key=lambda x: (-(x["n"] + x["cek"]), x["reviewer"]))[:100]

    serah: Counter = Counter()
    for r in rows:
        if saran(r) == "cek_manusia":
            for k in r.get("handoff_reasons") or []:
                serah[str(k)] += 1

    dengan_kep = [r for r in ok if kebenaran_baris(r) in AR]
    batal = [r for r in dengan_kep if r.get("appeal") == "dibatalkan"]
    banding = {"n": sum(r.get("appeal") in ("dibatalkan", "dikuatkan", "menunggu") for r in dengan_kep), "dibatalkan": len(batal),
               "ai_benar_saat_dibatalkan": sum(saran(r) == kebenaran_baris(r) for r in batal),
               "dikuatkan": sum(r.get("appeal") == "dikuatkan" for r in dengan_kep),
               "menunggu": sum(r.get("appeal") == "menunggu" for r in dengan_kep)}

    tok = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
    total, n_ai = 0.0, 0
    for r in rows:
        t = r.get("tokens") or {}
        i, o, cr = int(_num(t.get("input"))), int(_num(t.get("output"))), int(_num(t.get("cache_read")))
        cw = int(_num(t.get("cache_write_1h"))) + int(_num(t.get("cache_write_5m"))) + int(_num(t.get("cache_write")))
        tok["input"] += i
        tok["output"] += o
        tok["cache_read"] += cr
        tok["cache_write"] += cw
        c = _num(r.get("cost_usd"))
        total += c
        n_ai += int(c > 0 or i + o > 0)
    per_video = total / n_ai if n_ai else 0.0
    prompt = tok["input"] + tok["cache_read"] + tok["cache_write"]
    biaya = {"total_usd": round(total, 6), "per_video_usd": round(per_video, 6), "per_video_idr": round(per_video * kurs, 2),
             "kurs": kurs, "per_hari_idr": int(round(per_video * kurs * per_hari)), "per_bulan_idr": int(round(per_video * kurs * per_hari * 30)),
             "video_per_hari": per_hari, "token": tok, "n_video_ai": n_ai,
             "cache_hit_persen": _r1(tok["cache_read"] / prompt * 100) if prompt else None}

    detik = [_num(r.get("process_sec")) for r in ok if r.get("process_sec") is not None]
    tahap: dict[str, list[float]] = defaultdict(list)
    for r in ok:
        for k, v in (r.get("stage_sec") or {}).items():
            tahap[str(k)].append(_num(v))
    waktu = {"rata_detik": _r1(sum(detik) / len(detik)) if detik else None, "median_detik": _r1(median(detik)),
             "p90_detik": _r1(p90(detik)), "per_tahap": {k: round(sum(v) / len(v), 2) for k, v in sorted(tahap.items()) if v}}

    benar_c, salah_c = pilih_contoh(rows)
    D_semua = [r for r in ok if kebenaran_baris(r) in AR and saran(r) in AR]  # termasuk alasan di luar video
    return {
        "versi": 1,
        "n_sampel": int(n_sampel if n_sampel is not None else len(rows)),
        "n_diproses": len(rows),
        "n_tidak_bisa_diakses": sum(r.get("pipeline_status") == "tidak_bisa_diakses" for r in rows),
        "n_gagal": sum(r.get("pipeline_status") in ("gagal", "dilewati_biaya") for r in rows),
        "n_dinilai": len(E),
        "n_di_luar_video": len(luar),
        "n_tanpa_keputusan": sum(kebenaran_baris(r) is None for r in ok),
        "setuju_reviewer": persen(benar_rev, len(D)),
        "setuju_akhir": persen(benar_akhir, len(D)),
        "akurasi_tanpa_cek_manusia": persen(benar_akhir, len(E)),
        "setuju_reviewer_semua": persen(benar_rev, len(E)),
        "persen_cek_manusia": _r1(n_cek / len(E) * 100) if E else None,
        "cakupan": _r1(len(D) / len(E) * 100) if E else None,
        "presisi_reject": persen(matriks["reject"]["reject"], ai_reject),
        "recall_reject": persen(matriks["reject"]["reject"], n_reject),
        "termasuk_di_luar_video": {
            "setuju_reviewer": persen(sum(saran(r) == r.get("human_decision") for r in D_semua), len(D_semua)),
            "setuju_akhir": persen(sum(saran(r) == kebenaran_baris(r) for r in D_semua), len(D_semua)),
        },
        "matriks": matriks,
        "per_alasan": per_alasan,
        "per_campaign": per_campaign,
        "per_reviewer": per_reviewer,
        "serah": dict(sorted(serah.items(), key=lambda kv: (-kv[1], kv[0]))),
        "banding": banding,
        "biaya": biaya,
        "waktu": waktu,
        "contoh": {"benar": _ids(benar_c), "salah": _ids(salah_c)},
    }


# ------------------------------------------------------------------ banding versi rubrik
BANDING_KUNCI = [  # (kunci, label awam, lebih besar = lebih baik?)
    ("setuju_akhir", "Setuju dengan hasil akhir (yang diputuskan AI)", True),
    ("setuju_reviewer", "Setuju dengan reviewer (yang diputuskan AI)", True),
    ("akurasi_tanpa_cek_manusia", "Benar tanpa bantuan manusia (dari semua video)", True),
    ("persen_cek_manusia", "Diserahkan ke manusia", False),
    ("presisi_reject", "Kalau AI bilang reject, benar-benar reject", True),
    ("recall_reject", "Video yang seharusnya reject dan tertangkap AI", True),
]


def _nilai_persen(v: Any) -> Optional[float]:
    if isinstance(v, dict):
        v = v.get("persen")
    return None if v is None else float(v)


def bandingkan_versi(lama: dict, baru: dict, baris_lama: Optional[list[dict]] = None, baris_baru: Optional[list[dict]] = None) -> dict:
    """tabel rubrik lama vs baru + perbandingan berpasangan (video yang sama di kedua run)"""
    tabel = []
    for k, label, naik_baik in BANDING_KUNCI:
        a, b = _nilai_persen(lama.get(k)), _nilai_persen(baru.get(k))
        d = None if a is None or b is None else round(b - a, 1)
        tabel.append({"kunci": k, "label": label, "lama": a, "baru": b, "selisih": d,
                      "membaik": None if not d else (d > 0) == naik_baik})
    m = {"dibanding": 0, "sama_benar": 0, "jadi_benar": 0, "jadi_salah": 0, "sama_salah": 0, "lain": 0}
    if baris_lama is not None and baris_baru is not None:
        a_map = {str(r["video_id"]): r for r in unik(baris_lama)}
        for r in unik(baris_baru):
            a = a_map.get(str(r["video_id"]))
            if a is None or not (bisa_dinilai(a) and bisa_dinilai(r)):
                continue
            m["dibanding"] += 1
            ba, bb = saran(a) == kebenaran_baris(a), saran(r) == kebenaran_baris(r)
            if ba and bb:
                m["sama_benar"] += 1
            elif bb:
                m["jadi_benar"] += 1
            elif ba:
                m["jadi_salah"] += 1
            elif saran(a) in AR and saran(r) in AR:
                m["sama_salah"] += 1
            else:
                m["lain"] += 1  # salah satu / keduanya cek manusia tanpa ada yang benar
    return {"tabel": tabel, "berpasangan": m}
