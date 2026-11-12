"""Aturan KODE sesudah jawaban AI (pemilik: hakim-ai). KONTRAK.md §5.2. Tidak bergantung pada kepatuhan prompt:
identitas orang → selalu butuh cek manusia; materi referensi belum ada → poin "wajib pakai materi" tidak bisa dinilai;
durasi / hashtag / caption wajib dicek kode; keyakinan < REVIEW_MIN_CONFIDENCE → cek_manusia; reject tanpa bukti / alasan →
cek_manusia; AI menolak / gagal → cek_manusia."""
from __future__ import annotations

import re
import unicodedata
from typing import Optional

from .alasan import DI_LUAR_VIDEO, label_untuk_kode
from .brief import TOLERANSI_DURASI, deteksi_identitas_orang, jenis_materi_poin
from .privasi import bersihkan_teks
from .skema import (BriefCampaign, CekPoin, CekPoinAI, KeputusanAI, KodeSerah, MateriVideo, PenilaianFinal, PoinBrief,
                    ReferensiCampaign)

ATURAN_VERSI = "a1"  # naikkan kalau aturan berubah (ikut hash rubrik)

BUKTI_IDENTITAS = "Butuh cek manusia: menyangkut mengenali orang tertentu (AI tidak boleh menebak identitas orang)."
BUKTI_MATERI = "Materi referensi campaign belum ada, jadi tidak bisa dibandingkan. Upload di halaman Materi."
BUKTI_DATA_AKUN = "Di luar isi video: dicek reviewer dari data akun (followers / niche)."
BUKTI_TIDAK_DINILAI = "AI tidak menilai poin ini."
BUKTI_TANPA_BUKTI = "AI tidak menyebut bukti, jadi hasilnya tidak dipakai."
SERAH_TEKS = {
    "keyakinan_rendah": "AI kurang yakin",
    "identitas_orang": "ada poin yang menyangkut mengenali orang tertentu",
    "materi_belum_ada": "materi referensi campaign belum ada",
    "poin_tidak_bisa_dinilai": "ada poin wajib yang tidak bisa dinilai dari video",
    "bukti_kurang": "bukti pelanggaran tidak cukup jelas",
    "alasan_tidak_jelas": "alasan AI tidak konsisten dengan checklist",
    "ai_menolak": "AI menolak menilai video ini",
    "ai_gagal": "AI tidak bisa dipakai saat ini",
    "video_tidak_bisa_diakses": "video tidak bisa diakses",
    "anggaran_habis": "batas biaya harian tercapai",
    "data_akun": "syarat akun (followers / niche) dicek reviewer",
}


def _min_conf(cfg) -> int:
    try:
        return max(0, min(100, int(getattr(cfg, "min_confidence", 70))))
    except (TypeError, ValueError):
        return 70


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(ch for ch in s if not unicodedata.combining(ch)).lower()


# ------------------------------------------------------------------ poin "kode" (deterministik)
def _cek_durasi(brief: BriefCampaign, materi: MateriVideo) -> tuple[str, str]:
    d = materi.meta.durasi_detik
    lo, hi = brief.durasi_min, brief.durasi_max
    if d is None or d <= 0:
        return "tidak_bisa_dinilai", "Durasi video tidak diketahui."
    if lo is not None and d < lo - TOLERANSI_DURASI:
        return "tidak", f"Durasi video {d:.1f} detik, kurang dari minimal {lo:g} detik."
    if hi is not None and d > hi + TOLERANSI_DURASI:
        return "tidak", f"Durasi video {d:.1f} detik, lebih dari maksimal {hi:g} detik."
    batas = " – ".join(x for x in (f"min {lo:g}" if lo is not None else "", f"maks {hi:g}" if hi is not None else "") if x)
    return "lolos", f"Durasi video {d:.1f} detik (diminta {batas} detik)."


def _tag_video(materi: MateriVideo) -> tuple[set[str], str]:
    cap = _norm(materi.meta.caption or "")
    tags = {_norm(t).lstrip("#") for t in materi.meta.hashtags or [] if t}
    tags |= {m.group(1) for m in re.finditer(r"#([\w]+)", cap)}
    return tags, cap


def _cek_hashtag(p: PoinBrief, brief: BriefCampaign, materi: MateriVideo) -> tuple[str, str]:
    wajib = [t for t in brief.hashtag_wajib if t]
    if not wajib:
        wajib = re.findall(r"[#@][\w.]+", p.teks)
    tags, cap = _tag_video(materi)
    if not tags and not cap.strip():
        if materi.meta.hashtag_present is True:
            return "lolos", "Caption tidak tersedia di data, tapi sistem Konten.com mencatat hashtag ada."
        if materi.meta.hashtag_present is False:
            return "tidak", "Sistem Konten.com mencatat hashtag wajib tidak ada (caption tidak tersedia di data)."
        return "tidak_bisa_dinilai", "Caption dan hashtag video tidak tersedia di data."
    kurang_hash, kurang_tag = [], []
    for t in wajib:
        n = _norm(t)
        if n.startswith("@"):
            if not re.search(r"(?<![\w.])" + re.escape(n) + r"(?![\w])", cap):
                kurang_tag.append(t)
        elif n.lstrip("#") not in tags:
            kurang_hash.append(t)
    if kurang_hash:
        return "tidak", "Caption tidak memuat hashtag wajib: " + " ".join(kurang_hash) + "."
    if kurang_tag:
        return "tidak_bisa_dinilai", ("Tag akun " + " ".join(kurang_tag) + " tidak terlihat di caption (bisa jadi di-tag lewat fitur "
                                      "tag platform) — cek manusia.")
    return "lolos", "Caption memuat semua hashtag / tag wajib: " + " ".join(wajib) + "."


def _token(s: str) -> list[str]:
    return [t for t in re.findall(r"[#@]?\w+", _norm(s)) if len(t) >= 2]


def _cek_caption(p: PoinBrief, brief: BriefCampaign, materi: MateriVideo) -> tuple[str, str]:
    m = re.search(r"\"(.+)\"\s*$", p.teks, re.S)
    wajib = (m.group(1) if m else brief.caption_wajib or "").strip()
    if not wajib:
        return "tidak_bisa_dinilai", "Teks caption wajib tidak terbaca dari brief."
    cap = materi.meta.caption or ""
    if not cap.strip():
        return "tidak_bisa_dinilai", "Caption video tidak tersedia di data."
    tw, tc = _token(wajib), set(_token(cap))
    if not tw:
        return "tidak_bisa_dinilai", "Teks caption wajib tidak terbaca dari brief."
    skor = sum(1 for t in tw if t in tc) / len(tw)
    if skor >= 0.8:
        return "lolos", f"Caption memuat teks wajib ({skor:.0%} kata cocok)."
    if skor < 0.4:
        return "tidak", f"Caption tidak memuat teks wajib dari brand (hanya {skor:.0%} kata cocok)."
    return "tidak_bisa_dinilai", f"Caption hanya mirip sebagian dengan teks wajib ({skor:.0%} kata cocok) — cek manusia."


def cek_kode(brief: BriefCampaign, materi: MateriVideo) -> list[CekPoin]:
    """poin cara_nilai "kode" (durasi vs durasiMin/Max ±1 dtk, hashtag wajib di caption/hashtags, caption wajib) — juga
    dikirim ke AI sebagai fakta"""
    out: list[CekPoin] = []
    for p in brief.poin:
        if p.cara_nilai != "kode":
            continue
        if p.kategori == "durasi":
            hasil, bukti = _cek_durasi(brief, materi)
        elif p.kategori == "hashtag":
            hasil, bukti = _cek_hashtag(p, brief, materi)
        elif p.kategori == "caption_wajib":
            hasil, bukti = _cek_caption(p, brief, materi)
        else:
            hasil, bukti = "tidak_bisa_dinilai", "Belum ada pengecekan otomatis untuk poin ini."
        out.append(CekPoin(poin_id=p.id, kategori=p.kategori, teks=p.teks, wajib=p.wajib, hasil=hasil, bukti=bukti, oleh="kode"))
    return out


# ------------------------------------------------------------------ poin per poin
def _materi_relevan(p: PoinBrief, ref: Optional[ReferensiCampaign]) -> bool:
    if ref is None:
        return False
    jenis = jenis_materi_poin(p)
    if not jenis:
        return any(m.status == "siap" for m in ref.materi)
    return any(ref.ada(j) for j in jenis)


def _bersih_bukti(c: CekPoinAI, materi: MateriVideo) -> tuple[str, list[int], list[float]]:
    n = len(materi.frames)
    dur = materi.meta.durasi_detik
    frames = sorted({int(i) for i in c.bukti_frame if 1 <= int(i) <= n})[:10]
    batas = (dur + 1.0) if dur else 6 * 3600.0
    detik = sorted({round(float(x), 2) for x in c.bukti_detik if 0 <= float(x) <= batas})[:10]
    return bersihkan_teks(c.bukti, 600), frames, detik


def _nilai_poin(p: PoinBrief, ai_c: Optional[CekPoinAI], kode_c: Optional[CekPoin], materi: MateriVideo,
                ref: Optional[ReferensiCampaign], akses_gagal: bool, flags: set[str], abaikan: tuple = ()) -> CekPoin:
    dasar = dict(poin_id=p.id, kategori=p.kategori, teks=p.teks, wajib=p.wajib)
    # 1. menyangkut mengenali orang tertentu → selalu manusia (dicek ulang di sini, tidak percaya cara_nilai saja)
    if p.cara_nilai == "manusia" or deteksi_identitas_orang(p.teks, abaikan) or any(deteksi_identitas_orang(x, abaikan) for x in p.pilihan):
        if p.wajib:
            flags.add("identitas_orang" if (p.alasan_manusia in (None, "identitas_orang")) else "poin_tidak_bisa_dinilai")
        bukti = BUKTI_IDENTITAS if p.alasan_manusia in (None, "identitas_orang") else "Butuh cek manusia."
        return CekPoin(**dasar, hasil="tidak_bisa_dinilai", bukti=bukti, oleh="manusia")
    # 4. data akun (followers / niche) → di luar video
    if p.cara_nilai == "data_akun":
        return CekPoin(**dasar, hasil="tidak_bisa_dinilai", bukti=BUKTI_DATA_AKUN, oleh="kode")
    # 3. poin kode → hasil kode menimpa AI
    if p.cara_nilai == "kode":
        if kode_c is not None:
            return kode_c
        return CekPoin(**dasar, hasil="tidak_bisa_dinilai", bukti="Belum ada pengecekan otomatis untuk poin ini.", oleh="kode")
    if akses_gagal:
        return CekPoin(**dasar, hasil="tidak_bisa_dinilai", bukti="Video tidak bisa diproses, poin tidak dinilai.", oleh="kode")
    # 2. butuh materi referensi yang belum ada
    if p.butuh_materi and not _materi_relevan(p, ref):
        if p.wajib:
            flags.add("materi_belum_ada")
        return CekPoin(**dasar, hasil="tidak_bisa_dinilai", bukti=BUKTI_MATERI, oleh="kode")
    # 8. AI tidak menilai poin ini
    if ai_c is None:
        return CekPoin(**dasar, hasil="tidak_bisa_dinilai", bukti=BUKTI_TIDAK_DINILAI, oleh="ai")
    bukti, frames, detik = _bersih_bukti(ai_c, materi)
    hasil = ai_c.hasil
    if hasil != "tidak_bisa_dinilai" and not bukti.strip():
        return CekPoin(**dasar, hasil="tidak_bisa_dinilai", bukti=BUKTI_TANPA_BUKTI, oleh="ai")
    # musik: AI tidak mendengar audio → "lolos" / "tidak" soal lagu campaign hanya sah bila pencocok musik mendukung
    if p.butuh_materi and "lagu" in jenis_materi_poin(p) and hasil != "tidak_bisa_dinilai":
        mus = materi.musik
        dukung = (mus.status == "cocok") if hasil == "lolos" else (mus.status == "tidak_cocok" and mus.mesin in ("panako", "olaf"))
        if not dukung:
            ket = {"cocok": "pencocok musik menemukan lagu campaign", "tidak_cocok": "pencocok musik tidak menemukan lagu campaign",
                   "gagal": "pencocok musik gagal", "nonaktif": "pencocok musik mati",
                   "tidak_ada_referensi": "lagu referensi belum ada"}.get(mus.status, mus.status)
            extra = " (mesin cadangan chroma, kurang tajam)" if mus.mesin == "chroma" else ""
            return CekPoin(**dasar, hasil="tidak_bisa_dinilai", bukti=f"Soal lagu: {ket}{extra} — tidak cukup untuk memutuskan.",
                           bukti_frame=frames, bukti_detik=detik, oleh="kode")
    return CekPoin(**dasar, hasil=hasil, bukti=bukti or "Tidak bisa dinilai dari materi video.", bukti_frame=frames,
                   bukti_detik=detik, oleh="ai")


def _kalimat(s: str, maks: int = 300) -> str:
    return bersihkan_teks(re.sub(r"\s+", " ", s or "").strip(), maks)


# ------------------------------------------------------------------ gabungan akhir
def terapkan_aturan(ai: Optional[KeputusanAI], brief: BriefCampaign, materi: MateriVideo, ref: ReferensiCampaign, cfg,
                    gagal: Optional[KodeSerah] = None, label_alasan: Optional[dict[str, str]] = None) -> PenilaianFinal:
    """gabung checklist AI + kode + paksaan manusia → PenilaianFinal (tanpa pemakaian; diisi hakim)"""
    akses_gagal = materi.status != "ok"
    ids = {p.id for p in brief.poin}
    ai_map: dict[str, CekPoinAI] = {}
    if ai is not None:
        for c in ai.checklist:  # poin_id asing dibuang, ganda → yang pertama
            if c.poin_id in ids and c.poin_id not in ai_map:
                ai_map[c.poin_id] = c
    kode_map = {c.poin_id: c for c in cek_kode(brief, materi)}
    flags: set[str] = set()
    poin_by_id = {p.id: p for p in brief.poin}
    abaikan = tuple(x for x in (brief.judul, brief.brand) if x)  # judul film / brand bukan nama orang (sama dengan parser)
    checklist = [_nilai_poin(p, ai_map.get(p.id), kode_map.get(p.id), materi, ref, akses_gagal, flags, abaikan)
                 for p in brief.poin if p.cara_nilai != "info"]

    wajib = [c for c in checklist if c.wajib and poin_by_id[c.poin_id].cara_nilai != "data_akun"]
    langgar = [c for c in wajib if c.hasil == "tidak" and c.bukti.strip() and c.oleh != "manusia"]
    langgar_kode = [c for c in langgar if c.oleh == "kode"]
    tbd = [c for c in wajib if c.hasil == "tidak_bisa_dinilai"]
    ada_data_akun = any(poin_by_id[c.poin_id].cara_nilai == "data_akun" for c in checklist)
    serah: list[str] = []

    def tambah(k: str) -> None:
        if k not in serah:
            serah.append(k)

    def kode_pelanggaran(cs: list[CekPoin]) -> Optional[str]:
        """kode alasan dari poin yang dilanggar (CTA didahulukan)"""
        if not cs:
            return None
        cs = sorted(cs, key=lambda c: (poin_by_id[c.poin_id].kode_alasan != "cta_tidak_ada", c.poin_id))
        return poin_by_id[cs[0].poin_id].kode_alasan

    ringkasan = _kalimat(ai.ringkasan if ai else "", 400)
    if akses_gagal:
        # 9. video tidak bisa diakses / gagal → tanpa AI
        saran, keyakinan = "cek_manusia", 0
        tambah("anggaran_habis" if materi.status == "dilewati_biaya" else "video_tidak_bisa_diakses")
        alasan_kode = "tidak_bisa_diakses" if materi.status == "tidak_bisa_diakses" else None
        spesifik = _kalimat(materi.error or "Video tidak bisa diakses.")
    elif ai is None:
        saran, keyakinan = "cek_manusia", 0
        tambah(gagal or "ai_gagal")
        alasan_kode = kode_pelanggaran(langgar_kode)
        spesifik = f"Butuh cek manusia: {SERAH_TEKS.get(gagal or 'ai_gagal', 'AI tidak bisa dipakai')}."
    else:
        saran = ai.saran
        keyakinan = max(0, min(100, int(ai.keyakinan)))
        alasan_kode = ai.alasan_kode
        spesifik = _kalimat(ai.alasan_spesifik)
        if saran == "reject":
            if not langgar:
                saran = "cek_manusia"
                tambah("bukti_kurang")
            elif not alasan_kode:
                saran = "cek_manusia"
                tambah("alasan_tidak_jelas")
            else:
                boleh = {poin_by_id[c.poin_id].kode_alasan for c in langgar} | {"tidak_sesuai_brief"}
                if alasan_kode in DI_LUAR_VIDEO or alasan_kode not in boleh:
                    alasan_kode = kode_pelanggaran(langgar)  # alasan harus sesuai poin yang benar-benar dilanggar
                if langgar_kode:  # pelanggaran fakta kode (durasi / hashtag / caption) = keyakinan sama dengan jalur approve
                    keyakinan = max(keyakinan, 90 if any(c.kategori == "durasi" for c in langgar_kode) else 80)
        elif saran == "approve":
            if langgar_kode:  # pelanggaran yang dicek kode (durasi / hashtag / caption) sah sebagai alasan reject
                c = sorted(langgar_kode, key=lambda c: c.kategori != "durasi")[0]
                saran, alasan_kode = "reject", poin_by_id[c.poin_id].kode_alasan
                keyakinan = max(keyakinan, 90 if c.kategori == "durasi" else 80)
                spesifik = _kalimat(c.bukti)
            elif langgar:
                saran = "cek_manusia"
                tambah("alasan_tidak_jelas")
            elif tbd:
                saran = "cek_manusia"
                tambah("poin_tidak_bisa_dinilai")
            elif not wajib:
                saran = "cek_manusia"
                tambah("bukti_kurang")
            else:
                alasan_kode = None
        else:  # AI sendiri memilih cek_manusia
            tambah("poin_tidak_bisa_dinilai" if tbd else "keyakinan_rendah")
        # 7. keyakinan di bawah ambang → cek manusia
        if saran in ("approve", "reject") and keyakinan < _min_conf(cfg):
            saran = "cek_manusia"
            tambah("keyakinan_rendah")
        if saran == "cek_manusia" and ai.saran != "cek_manusia":
            alasan_ai = {"approve": "approve", "reject": "reject"}[ai.saran]
            spesifik = _kalimat(f"Butuh cek manusia: {', '.join(SERAH_TEKS[k] for k in serah) or 'perlu dicek'}. "
                                f"Saran awal AI: {alasan_ai} — {ai.alasan_spesifik}")
        if saran == "cek_manusia" and ai.saran == "approve":
            alasan_kode = kode_pelanggaran(langgar) if langgar else None

    if saran == "cek_manusia":
        # alasan khusus yang ikut menjelaskan kenapa butuh manusia
        for k in ("identitas_orang", "materi_belum_ada"):
            if k in flags:
                tambah(k)
        if not serah:
            tambah("poin_tidak_bisa_dinilai" if tbd else "keyakinan_rendah")
    else:
        serah = []
        if saran == "approve":
            alasan_kode = None
            if ada_data_akun:
                tambah("data_akun")  # hanya dicatat: syarat akun dicek reviewer, approve tetap
        else:
            # reject tetap jalan, tapi poin identitas orang / materi yang belum bisa dinilai tetap terlihat oleh reviewer
            for k in ("identitas_orang", "materi_belum_ada"):
                if k in flags:
                    tambah(k)
    alasan_label = label_untuk_kode(alasan_kode, label_alasan) if alasan_kode else None
    return PenilaianFinal(saran=saran, keyakinan=keyakinan, alasan_kode=alasan_kode, alasan_label=alasan_label,
                          alasan_spesifik=spesifik, ringkasan=ringkasan, checklist=checklist, serah=serah)  # type: ignore[arg-type]
