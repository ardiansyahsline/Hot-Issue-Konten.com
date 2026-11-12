"""Laporan HTML bahasa awam untuk diajukan ke official Konten.com (pemilik: hakim-uji). KONTRAK.md §6.3.
Satu file, CSS inline, grafik batang HTML+CSS (tanpa SVG/gambar — teks tetap terbaca di HP), TANPA JavaScript, tanpa gambar frame, tanpa data pribadi (video ditulis "Video #<id>").
Disimpan data/laporan/<run_id>.html + bucket asisten-review laporan/<run_id>.html.

Website menyajikannya dengan CSP `default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox` → hanya <style> / atribut style
inline (tanpa font / gambar / skrip luar). Tema mengikuti perangkat (terang / gelap); saat dicetak selalu terang.
Semua teks bebas (alasan AI, bukti, judul campaign) dilewatkan privasi.bersihkan_teks lalu html.escape."""
from __future__ import annotations

import html
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from . import VERSION
from . import log as rlog
from . import metrik as mk
from .privasi import ada_data_pribadi, bersihkan_teks

log = rlog.get("laporan")
WIB = timezone(timedelta(hours=7))

SARAN_LABEL = {"approve": "Approve", "reject": "Reject", "cek_manusia": "Butuh cek manusia"}
HASIL_LABEL = {"lolos": "Lolos", "tidak": "Tidak", "tidak_bisa_dinilai": "Tidak bisa dinilai"}
SERAH_LABEL = {  # sama dengan lib/asistenReview.ts SERAH_LABEL
    "keyakinan_rendah": "AI kurang yakin", "identitas_orang": "Perlu mengenali orang (artis/aktor)",
    "materi_belum_ada": "Materi referensi belum ada", "poin_tidak_bisa_dinilai": "Ada poin wajib yang tidak bisa dinilai",
    "bukti_kurang": "Bukti AI kurang", "alasan_tidak_jelas": "Alasan reject tidak jelas", "ai_menolak": "AI menolak menilai",
    "ai_gagal": "AI gagal / kunci kosong", "video_tidak_bisa_diakses": "Video tidak bisa diakses",
    "anggaran_habis": "Batas biaya harian habis", "data_akun": "Butuh data akun (followers, niche)",
}
TAHAP_LABEL = {"unduh": "Unduh video", "frame": "Ambil frame", "ocr": "Baca teks layar", "asr": "Suara → teks", "musik": "Cocok musik",
               "visual": "Cocok poster/trailer", "hakim": "Penilaian AI"}
BANDING_LABEL = {"dibatalkan": "banding: keputusan dibatalkan", "dikuatkan": "banding: keputusan dikuatkan", "menunggu": "banding: menunggu"}
MUSIK_LABEL = {"panako": "Panako (utama)", "olaf": "Olaf (cadangan ringan)", "chroma": "pencocok internal (cadangan)", "tidak_ada": "tidak ada"}


# ------------------------------------------------------------------ format
def _t(s: Any, maks: Optional[int] = None) -> str:
    """teks bebas → bersih data pribadi + aman HTML"""
    return html.escape(bersihkan_teks(None if s is None else str(s), maks), quote=True)


def _vid(v: Any) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "", str(v or ""))[:64] or "?"


def _sis(v: Any, maks: int = 64) -> str:
    """nilai sistem (id run, hash rubrik, nama model, versi) — hanya huruf/angka/.-_ (tanpa pembersih data pribadi)"""
    return re.sub(r"[^A-Za-z0-9._-]", "", str(v or ""))[:maks]


def _n(x: Any) -> str:
    try:
        return f"{int(round(float(x))):,}".replace(",", ".")
    except (TypeError, ValueError):
        return "-"


def _d(x: Any, dec: int = 1) -> str:
    try:
        s = f"{float(x):,.{dec}f}"
    except (TypeError, ValueError):
        return "-"
    return s.replace(",", "_").replace(".", ",").replace("_", ".")


def _pct(x: Any) -> str:
    v = x.get("persen") if isinstance(x, dict) else x
    return "-" if v is None else f"{_d(v)}%"


def _ci(p: Any) -> str:
    ci = p.get("ci95") if isinstance(p, dict) else None
    return f"rentang wajar 95%: {_d(ci[0])}–{_d(ci[1])}%" if ci else "belum ada data"


def _rp(x: Any, dec: int = 0) -> str:
    return "-" if x is None else f"Rp {_d(x, dec)}"


def _waktu(iso: Any) -> str:
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return t.astimezone(WIB).strftime("%d-%m-%Y %H:%M WIB")
    except (TypeError, ValueError):
        return "-"


def _rasio(a: int, b: int) -> str:
    return "-" if not b else f"{_d(a / b * 100)}%"


def rasio_asli(mt: dict, sp: dict) -> Optional[dict]:
    """angka sampel 50/50 → perkiraan pada perbandingan approve:reject ASLI (kolam kandidat sample_params). Tingkat per kelas
    (baris matriks) tidak bergantung perbandingan; setuju / presisi reject / bahaya / cek manusia dibobot ulang. None = data kurang."""
    na, nr = float(sp.get("n_kandidat_approve") or 0), float(sp.get("n_kandidat_reject") or 0)
    a, r = mt.get("approve") or {}, mt.get("reject") or {}
    ta, tr = sum(a.values()), sum(r.values())
    if na <= 0 or nr <= 0 or not ta or not tr:
        return None
    wa, wr = na / (na + nr), nr / (na + nr)
    pa = {k: a.get(k, 0) / ta for k in ("approve", "reject", "cek_manusia")}
    pr = {k: r.get(k, 0) / tr for k in ("approve", "reject", "cek_manusia")}
    putus = wa * (pa["approve"] + pa["reject"]) + wr * (pr["approve"] + pr["reject"])
    ai_rej = wa * pa["reject"] + wr * pr["reject"]
    return {
        "persen_approve": wa * 100, "persen_reject": wr * 100, "kelas_approve": {k: v * 100 for k, v in pa.items()},
        "kelas_reject": {k: v * 100 for k, v in pr.items()},
        "setuju_akhir": (wa * pa["approve"] + wr * pr["reject"]) / putus * 100 if putus else None,
        "presisi_reject": wr * pr["reject"] / ai_rej * 100 if ai_rej else None,
        "bahaya": wr * pr["approve"] / putus * 100 if putus else None,
        "cek_manusia": (wa * pa["cek_manusia"] + wr * pr["cek_manusia"]) * 100,
    }


# ------------------------------------------------------------------ grafik batang (HTML+CSS murni: tanpa JS, teks tetap terbaca di HP;
# angka juga ada di tabel / kalimat — warna tidak pernah jadi satu-satunya penanda)
def _bar_tumpuk(baris: list[tuple[str, list[tuple[int, str, str]]]]) -> str:
    """batang mendatar bertumpuk: [(label, [(nilai, kelas_css, nama), …])]"""
    out = ['<div class="grafik" role="img" aria-label="Grafik batang bertumpuk">']
    for label, seg in baris:
        total = sum(v for v, _, _ in seg) or 1
        isi = "".join(
            f'<span class="seg {kelas}" style="flex-grow:{v}" title="{html.escape(nama)}: {v}">{v if v / total >= 0.08 else ""}</span>'
            for v, kelas, nama in seg if v > 0)
        out.append(f'<div class="g-baris"><div class="g-lbl">{html.escape(label)}</div><div class="g-tumpuk">{isi}</div></div>')
    out.append("</div>")
    return "".join(out)


def _bar_tunggal(data: list[tuple[str, float, str]], satuan: str = "") -> str:
    """batang mendatar satu seri: [(label, nilai, teks_nilai)]"""
    if not data:
        return ""
    maks = max(v for _, v, _ in data) or 1
    out = ['<div class="grafik" role="img" aria-label="Grafik batang">']
    for label, v, teks in data:
        out.append(f'<div class="g-baris"><div class="g-lbl">{html.escape(label)}</div><div class="g-satu">'
                   f'<span class="seg b-seri" style="width:{max(1.0, v / maks * 100):.1f}%"></span>'
                   f'<span class="g-nilai">{html.escape(teks)}{html.escape(satuan)}</span></div></div>')
    out.append("</div>")
    return "".join(out)


# ------------------------------------------------------------------ potongan
CSS = """
:root{color-scheme:light;--bg:#fcfcfb;--kartu:#ffffff;--garis:#e4e2dc;--teks:#0b0b0b;--teks2:#52514e;--teks3:#76746e;
--aksen:#2a78d6;--good:#0ca30c;--crit:#d03b3b;--warn:#b77b00;--netral:#9a988f;--seri:#2a78d6;--lembut:#f3f2ee}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#1a1a19;--kartu:#232322;--garis:#3a3a37;--teks:#f0efec;
--teks2:#c3c2b7;--teks3:#9d9c93;--aksen:#3987e5;--netral:#76756e;--seri:#3987e5;--lembut:#2b2b29;--warn:#fab219}}
@media print{:root{color-scheme:light;--bg:#fff;--kartu:#fff;--garis:#ccc;--teks:#000;--teks2:#333;--teks3:#555;--lembut:#f4f4f4;--netral:#9a988f}
.kartu,.tile{break-inside:avoid}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--teks);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:880px;margin:0 auto;padding:20px 16px 48px}
h1{font-size:1.55rem;line-height:1.25;margin:0 0 4px}
h2{font-size:1.12rem;margin:30px 0 10px;padding-top:8px;border-top:1px solid var(--garis)}
h3{font-size:1rem;margin:16px 0 6px}
p{margin:6px 0}
.sub{color:var(--teks2);margin:0 0 14px}
.label-uji{display:inline-block;font-size:.75rem;font-weight:700;letter-spacing:.04em;padding:2px 8px;border-radius:999px;
background:var(--lembut);color:var(--teks2);border:1px solid var(--garis)}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:6px 16px;font-size:.88rem;color:var(--teks2);margin:12px 0}
.meta b{display:block;color:var(--teks);font-weight:600;overflow-wrap:anywhere}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:14px 0}
.tile{background:var(--kartu);border:1px solid var(--garis);border-radius:12px;padding:14px}
.tile .judul{font-size:.86rem;color:var(--teks2)}
.tile .angka{font-size:2.1rem;font-weight:700;line-height:1.15;margin:4px 0}
.tile .ket{font-size:.8rem;color:var(--teks3)}
.kartu{background:var(--kartu);border:1px solid var(--garis);border-radius:12px;padding:12px 14px;margin:10px 0}
.peringatan{border-left:4px solid var(--warn)}
.tabel{overflow-x:auto;margin:8px 0;-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;width:100%;font-size:.86rem}
th,td{text-align:left;padding:6px 6px;overflow-wrap:anywhere;border-bottom:1px solid var(--garis);vertical-align:top}
th{color:var(--teks2);font-weight:600;background:var(--lembut);overflow-wrap:normal;font-size:.8rem;line-height:1.3}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
td.n,.nw{white-space:nowrap}
.benar{color:var(--good);font-weight:600}.salah{color:var(--crit);font-weight:600}.cek{color:var(--teks2)}
ul.daftar{margin:6px 0;padding-left:20px}ul.daftar li{margin:3px 0}
.tag{display:inline-block;font-size:.72rem;padding:1px 7px;border-radius:999px;border:1px solid var(--garis);color:var(--teks2);white-space:nowrap}
.legenda{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:.82rem;color:var(--teks2);margin:4px 0}
.legenda i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.grafik{margin:8px 0}
.g-baris{display:grid;grid-template-columns:minmax(96px,34%) 1fr;gap:8px;align-items:center;margin:6px 0;font-size:.84rem}
.g-lbl{color:var(--teks2);line-height:1.25}
.g-tumpuk{display:flex;gap:2px;height:26px}
.g-tumpuk .seg{display:flex;align-items:center;padding-left:6px;color:#fff;font-weight:700;font-size:.8rem;border-radius:4px;min-width:3px;
overflow:hidden;white-space:nowrap}
.g-satu{display:flex;align-items:center;gap:6px;min-width:0}
.g-satu .seg{display:block;height:16px;border-radius:4px;flex:none;max-width:72%}
.g-nilai{font-size:.8rem;white-space:nowrap;color:var(--teks)}
.b-benar{background:var(--good)}.b-salah{background:var(--crit)}.b-cek{background:var(--netral)}.b-seri{background:var(--seri)}
@media print{.seg{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
.kasus h3{margin:4px 0}.kasus .baris{font-size:.88rem;color:var(--teks2)}
.bukti{font-size:.85rem;margin:6px 0 0;padding-left:18px}.bukti li{margin:2px 0}
footer{margin-top:36px;font-size:.8rem;color:var(--teks3)}
"""


def _tabel(kepala: list[tuple[str, bool]], isi: list[list[str]]) -> str:
    th = "".join(f'<th class="n">{k}</th>' if kanan else f"<th>{k}</th>" for k, kanan in kepala)
    rows = []
    for r in isi:
        rows.append("<tr>" + "".join(f'<td class="n">{c}</td>' if kepala[i][1] else f"<td>{c}</td>" for i, c in enumerate(r)) + "</tr>")
    return f'<div class="tabel"><table><thead><tr>{th}</tr></thead><tbody>{"".join(rows)}</tbody></table></div>'


def _tile(judul: str, angka: str, ket: str) -> str:
    return f'<div class="tile"><div class="judul">{judul}</div><div class="angka">{angka}</div><div class="ket">{ket}</div></div>'


def _kasus(r: dict, jenis: str) -> str:
    s = mk.saran(r)
    truth = mk.kebenaran_baris(r)
    benar = s == truth
    judul = f"Video #{_vid(r.get('video_id'))}" + (f" · {_t(r.get('campaign_title'), 120)}" if r.get("campaign_title") else "")
    hasil = '<span class="benar">✓ AI benar</span>' if benar else '<span class="salah">✗ AI salah</span>'
    bahaya = (' <span class="tag">paling berbahaya: lolos padahal seharusnya reject</span>'
              if s == "approve" and truth == "reject" else "")
    akhir = SARAN_LABEL.get(truth or "", "-")
    band = f" ({BANDING_LABEL[r['appeal']]})" if r.get("appeal") in BANDING_LABEL else ""
    poin = [c for c in (r.get("checklist") or []) if isinstance(c, dict)]
    urut = {"tidak": 0, "lolos": 1, "tidak_bisa_dinilai": 2}
    poin.sort(key=lambda c: (urut.get(c.get("hasil"), 3), not c.get("wajib", True)))
    bukti = "".join(
        f"<li><b>{_t(c.get('teks'), 140)}</b> — {HASIL_LABEL.get(c.get('hasil'), '-')}"
        + (f": {_t(c.get('bukti'), 220)}" if c.get("bukti") else "") + "</li>"
        for c in poin[:3])
    alasan = ""
    if r.get("official_reason") and s == "reject":
        alasan = f"<div class=\"baris\">Alasan resmi pilihan AI: {_t(r.get('official_reason'), 120)}</div>"
    if r.get("specific_reason"):
        alasan += f"<div class=\"baris\">Alasan AI: {_t(r.get('specific_reason'), 300)}</div>"
    rev = SARAN_LABEL.get(r.get("human_decision") or "", "-")
    alasan_rev = f" — {_t(r.get('human_reason'), 120)}" if r.get("human_decision") == "reject" and r.get("human_reason") else ""
    return (f'<div class="kartu kasus"><h3>{judul}</h3><div>{hasil}{bahaya}</div>'
            f'<div class="baris">Saran AI: <b>{SARAN_LABEL.get(s, "-")}</b> (keyakinan {_n(r.get("confidence"))}) · '
            f'Reviewer: <b>{rev}</b>{alasan_rev} · Hasil akhir: <b>{akhir}</b>{band}</div>{alasan}'
            + (f'<ul class="bukti">{bukti}</ul>' if bukti else "") + "</div>")


# ------------------------------------------------------------------ utama
def buat_laporan(run: dict, metrik: dict, baris: list[dict], pembanding: Optional[dict] = None) -> str:
    """pembanding = {"run": run_lama, "metrik": metrik_lama, "baris"?: hasil_lama} untuk tabel "rubrik lama vs baru" """
    m = metrik or mk.hitung_metrik(baris, None)
    run = run or {}
    sp = run.get("sample_params") or {}
    mt = m.get("matriks") or {t: {s: 0 for s in mk.SARAN} for t in mk.AR}
    a, rj = mt.get("approve", {}), mt.get("reject", {})
    benar_n = a.get("approve", 0) + rj.get("reject", 0)
    bahaya, ketat = rj.get("approve", 0), a.get("reject", 0)
    cek = a.get("cek_manusia", 0) + rj.get("cek_manusia", 0)
    diputus = benar_n + bahaya + ketat
    n_dinilai = int(m.get("n_dinilai") or 0)
    bagian: list[str] = []

    # ---------------- kepala
    status = run.get("status") or "selesai"
    rid = str(run.get("id") or "")
    judul_run = _t(run.get("label"), 120) or "Uji akurasi"
    rentang = (f"{sp.get('tanggal_awal')} s/d {sp.get('tanggal_akhir')}" if sp.get("tanggal_awal")
               else (f"{sp.get('dari')} s/d {sp.get('sampai')}" if sp.get("dari") else "-"))
    bagian.append(
        '<span class="label-uji">MODE UJI · AI hanya menyarankan, reviewer yang memutuskan</span>'
        f'<h1>Laporan Uji Akurasi Asisten Review Video</h1><p class="sub">{judul_run} — membandingkan saran AI dengan keputusan '
        f'reviewer Konten.com (dan hasil banding) pada {_n(m.get("n_diproses"))} video lama.</p>'
        '<div class="meta">'
        f'<div>Run<b>{_sis(rid) or "-"}</b></div>'
        f'<div>Tanggal uji<b>{_waktu(run.get("finished_at") or run.get("started_at"))}</b></div>'
        f'<div>Versi rubrik<b>{_sis(run.get("rubric_version")) or "-"} · {_sis(run.get("rubric_hash")) or "-"}</b></div>'
        f'<div>Model AI<b>{_sis(run.get("model")) or "-"} · effort {_sis(run.get("effort")) or "-"}</b></div>'
        f'<div>Sampel<b>{_n(m.get("n_diproses"))} dari {_n(m.get("n_sampel"))} video</b></div>'
        f'<div>Tanggal keputusan reviewer<b>{_t(rentang)}</b></div>'
        f'<div>Komposisi sampel<b>{_n(sp.get("n_approve"))} approve · {_n(sp.get("n_reject"))} reject</b></div>'
        f'<div>Keragaman<b>{_n(sp.get("n_campaign"))} campaign · {_n(sp.get("n_reviewer"))} reviewer · {_n(sp.get("n_tanggal"))} hari</b></div>'
        "</div>")
    if status != "selesai":
        ket = {"berhenti_biaya": "berhenti karena batas biaya harian", "batal": "dibatalkan", "gagal": "berhenti karena error",
               "proses": "masih berjalan"}.get(status, status)
        bagian.append(f'<div class="kartu peringatan"><b>Angka sementara.</b> Run ini {ket} — baru {_n(m.get("n_diproses"))} dari '
                      f'{_n(m.get("n_sampel"))} video yang diproses.</div>')

    # ---------------- inti
    sa, sr = m.get("setuju_akhir") or {}, m.get("setuju_reviewer") or {}
    bagian.append("<h2>Inti hasil</h2>")
    bagian.append('<div class="tiles">'
                  + _tile("Setuju dengan reviewer", _pct(sr), f"dari {_n(sr.get('n'))} video yang diputuskan AI · {_ci(sr)}")
                  + _tile("Setuju dengan hasil akhir (sesudah banding)", _pct(sa), f"dari {_n(sa.get('n'))} video yang diputuskan AI · {_ci(sa)}")
                  + _tile("Diserahkan ke manusia", _pct(m.get("persen_cek_manusia")),
                          f"{_n(cek)} dari {_n(n_dinilai)} video — AI ragu, bukti kurang, atau perlu mengenali orang")
                  + "</div>")
    if n_dinilai:
        bagian.append(
            f"<p>Dari <b>{_n(n_dinilai)}</b> video yang bisa dinilai, AI memutuskan sendiri <b>{_n(diputus)}</b> video "
            f"({_pct(m.get('cakupan'))}) dan <b>{_n(benar_n)}</b> di antaranya benar menurut hasil akhir. "
            f"{_n(cek)} video sisanya diserahkan ke reviewer. Kalau dihitung dari semua video yang bisa dinilai (termasuk yang "
            f"diserahkan), AI menyelesaikan sendiri dengan benar <b>{_pct(m.get('akurasi_tanpa_cek_manusia'))}</b>.</p>"
            f"<p>Kesalahan paling berbahaya — <b>AI bilang approve padahal seharusnya reject</b> — terjadi <b>{_n(bahaya)}</b> kali "
            f"({_rasio(bahaya, diputus)} dari keputusan AI).</p>")
    else:
        bagian.append("<p>Belum ada video yang bisa dinilai di run ini.</p>")

    # ---------------- tabel salah-benar
    bagian.append("<h2>Tabel salah-benar</h2><p>Baris = hasil akhir yang benar (keputusan reviewer, atau hasil banding kalau "
                  "keputusannya dibatalkan). Kolom = saran AI.</p>")
    bagian.append(_tabel([("Hasil akhir", False), ("AI: Approve", True), ("AI: Reject", True), ("AI: Butuh cek manusia", True), ("Jumlah", True)], [
        ["Seharusnya <b>approve</b>", f'<span class="benar">{_n(a.get("approve"))}</span>', f'<span class="salah">{_n(ketat)}</span>',
         f'<span class="cek">{_n(a.get("cek_manusia"))}</span>', _n(sum(a.values()))],
        ["Seharusnya <b>reject</b>", f'<span class="salah">{_n(bahaya)}</span>', f'<span class="benar">{_n(rj.get("reject"))}</span>',
         f'<span class="cek">{_n(rj.get("cek_manusia"))}</span>', _n(sum(rj.values()))],
    ]))
    bagian.append(
        '<ul class="daftar">'
        f'<li><span class="benar">✓</span> AI bilang approve dan memang approve: <b>{_n(a.get("approve"))}</b></li>'
        f'<li><span class="benar">✓</span> AI bilang reject dan memang reject: <b>{_n(rj.get("reject"))}</b></li>'
        f'<li><span class="salah">✗</span> AI bilang approve padahal seharusnya reject: <b>{_n(bahaya)}</b> (paling berbahaya)</li>'
        f'<li><span class="salah">✗</span> AI bilang reject padahal seharusnya approve: <b>{_n(ketat)}</b></li>'
        f'<li>Diserahkan ke manusia: <b>{_n(cek)}</b> ({_n(a.get("cek_manusia"))} seharusnya approve, {_n(rj.get("cek_manusia"))} seharusnya reject)</li>'
        "</ul>")
    bagian.append('<div class="legenda"><span><i class="b-benar"></i>AI benar</span><span><i class="b-salah"></i>AI salah</span>'
                  '<span><i class="b-cek"></i>Diserahkan ke manusia</span></div>')
    bagian.append(_bar_tumpuk([
        ("Seharusnya approve", [(a.get("approve", 0), "b-benar", "AI benar"), (ketat, "b-salah", "AI salah"),
                                (a.get("cek_manusia", 0), "b-cek", "Cek manusia")]),
        ("Seharusnya reject", [(rj.get("reject", 0), "b-benar", "AI benar"), (bahaya, "b-salah", "AI salah"),
                               (rj.get("cek_manusia", 0), "b-cek", "Cek manusia")]),
    ]))
    pr, rc = m.get("presisi_reject") or {}, m.get("recall_reject") or {}
    bagian.append("<h3>Ketepatan saran reject</h3><ul class=\"daftar\">"
                  f"<li>Kalau AI bilang <b>reject</b>, <b>{_pct(pr)}</b> memang seharusnya reject ({_n(pr.get('benar'))} dari {_n(pr.get('n'))}; {_ci(pr)}).</li>"
                  f"<li>Dari semua video yang seharusnya reject, AI menangkap <b>{_pct(rc)}</b> sebagai reject ({_n(rc.get('benar'))} dari "
                  f"{_n(rc.get('n'))}); sisanya lolos atau diserahkan ke manusia.</li></ul>")
    ra = rasio_asli(mt, sp)
    if ra:
        ka, kr = ra["kelas_approve"], ra["kelas_reject"]
        bagian.append(
            "<h3>Kalau dipakai sehari-hari (perbandingan approve/reject asli)</h3>"
            "<p>Sampel uji sengaja dibuat seimbang (separuh approve, separuh reject). Di pekerjaan sehari-hari perbandingannya "
            f"sekitar <b>{_d(ra['persen_approve'], 0)}% approve : {_d(ra['persen_reject'], 0)}% reject</b> (dari keputusan reviewer "
            "di rentang tanggal yang sama). Angka per jenis video di bawah ini tidak terpengaruh perbandingan itu:</p>"
            '<ul class="daftar">'
            f"<li>Video yang seharusnya <b>approve</b>: AI approve {_d(ka['approve'])}%, reject {_d(ka['reject'])}%, "
            f"serahkan ke manusia {_d(ka['cek_manusia'])}%.</li>"
            f"<li>Video yang seharusnya <b>reject</b>: AI reject {_d(kr['reject'])}%, approve {_d(kr['approve'])}%, "
            f"serahkan ke manusia {_d(kr['cek_manusia'])}%.</li></ul>"
            "<p>Angka gabungan berikut <b>bisa berbeda cukup jauh</b> dari angka sampel karena bergantung perbandingan approve/reject "
            "(perkiraan kasar, dihitung ulang dengan perbandingan asli):</p>")
        bagian.append(_tabel([("Ukuran", False), ("Pada sampel uji", True), ("Perkiraan sehari-hari", True)], [
            ["Setuju dengan hasil akhir", _pct(sa), _pct(ra["setuju_akhir"])],
            ["Kalau AI bilang reject, memang reject", _pct(pr), _pct(ra["presisi_reject"])],
            ["AI approve padahal seharusnya reject (dari keputusan AI)", _rasio(bahaya, diputus), _pct(ra["bahaya"])],
            ["Diserahkan ke manusia", _pct(m.get("persen_cek_manusia")), _pct(ra["cek_manusia"])],
        ]))

    # ---------------- per alasan
    pa = m.get("per_alasan") or []
    if pa:
        bagian.append("<h2>Akurasi per alasan reject</h2><p>Video yang di-reject reviewer (hasil akhir tetap reject), "
                      "dikelompokkan menurut alasan resmi reviewer.</p>")
        bagian.append(_tabel([("Alasan reviewer", False), ("Video", True), ("AI reject", True), ("Alasan sama", True),
                              ("AI approve", True), ("Cek manusia", True), ("Tepat", True)], [
            [_t(x.get("label"), 100) + (' <span class="tag">di luar jangkauan AI</span>' if x.get("di_luar_video") else ""),
             _n(x.get("n")), _n(x.get("ai_reject")), _n(x.get("ai_reject_alasan_sama")), _n(x.get("ai_approve")), _n(x.get("ai_cek")),
             _pct(x.get("akurasi"))] for x in pa]))
        bagian.append("<p class=\"sub\">Tepat = AI reject ÷ (AI reject + AI approve). Alasan sama = AI reject dengan alasan resmi yang sama dengan reviewer. Alasan bertanda <i>di luar jangkauan AI</i> "
                      "(followers, link di bio, video duplikat, engagement/bot, video pakai Ads, video tidak bisa diakses saat dicek reviewer) tidak terlihat dari isi "
                      "video, jadi tidak dihitung sebagai kesalahan AI.</p>")

    # ---------------- per campaign
    pc = m.get("per_campaign") or []
    if pc:
        bagian.append("<h2>Akurasi per campaign</h2>")
        bagian.append(_tabel([("Campaign", False), ("Video", True), ("Benar", True), ("Salah", True), ("Cek manusia", True), ("Akurasi", True)], [
            [_t(c.get("title"), 90) or f"Campaign {_vid(c.get('campaign_id'))}", _n(c.get("n")), _n(c.get("benar")), _n(c.get("salah")),
             _n(c.get("cek")), _pct(c.get("akurasi"))] for c in pc[:30]]))
        if len(pc) > 30:
            bagian.append(f"<p class=\"sub\">…dan {_n(len(pc) - 30)} campaign lain dengan sampel lebih sedikit.</p>")
        bagian.append("<p class=\"sub\">Akurasi = benar ÷ (benar + salah), hanya video yang diputuskan AI.</p>")

    # ---------------- per reviewer
    prv = [x for x in (m.get("per_reviewer") or []) if (x.get("n") or 0) + (x.get("cek") or 0) > 0]
    if prv:
        bagian.append("<h2>Kesesuaian dengan tiap reviewer</h2><p>Nama reviewer disamarkan (kode acak tetap).</p>")
        bagian.append(_tabel([("Reviewer", False), ("Diputuskan AI", True), ("Setuju", True), ("Persen", True), ("Cek manusia", True)], [
            [f'<span class="nw">{_t(x.get("reviewer"), 30)}</span>', _n(x.get("n")), _n(x.get("setuju")), _pct(x.get("persen")), _n(x.get("cek"))] for x in prv[:20]]))

    # ---------------- banding
    b = m.get("banding") or {}
    bagian.append("<h2>Banding</h2>")
    if b.get("n"):
        bagian.append(f"<p>{_n(b.get('n'))} video di sampel pernah dibanding. {_n(b.get('dibatalkan'))} keputusannya dibatalkan "
                      f"(hasil banding dipakai sebagai jawaban benar); di video yang dibatalkan itu, saran AI sama dengan hasil banding "
                      f"<b>{_n(b.get('ai_benar_saat_dibatalkan'))}</b> kali. Dikuatkan: {_n(b.get('dikuatkan'))}, masih menunggu: "
                      f"{_n(b.get('menunggu'))} (dihitung memakai keputusan reviewer).</p>")
    else:
        bagian.append("<p>Tidak ada video di sampel ini yang dibanding.</p>")

    # ---------------- serah ke manusia
    serah = m.get("serah") or {}
    if serah:
        bagian.append("<h2>Kenapa diserahkan ke manusia</h2><p>Satu video bisa punya lebih dari satu alasan.</p>")
        bagian.append(_bar_tunggal([(SERAH_LABEL.get(k, k), float(v), _n(v)) for k, v in list(serah.items())[:11]], " video"))

    # ---------------- biaya
    by = m.get("biaya") or {}
    tok = by.get("token") or {}
    bagian.append("<h2>Biaya</h2>")
    bagian.append('<div class="tiles">'
                  + _tile("Biaya AI per video", _rp(by.get("per_video_idr"), 1), f"${_d(by.get('per_video_usd'), 5)} · kurs {_rp(by.get('kurs'))}/US$")
                  + _tile("Perkiraan per bulan", _rp(by.get("per_bulan_idr")),
                          f"{_n(by.get('video_per_hari'))} video/hari × 30 hari · per hari {_rp(by.get('per_hari_idr'))}")
                  + _tile("Total biaya uji ini", f"${_d(by.get('total_usd'), 4)}",
                          f"{_rp((by.get('total_usd') or 0) * (by.get('kurs') or 18000))} · {_n(by.get('n_video_ai'))} video dinilai AI")
                  + "</div>")
    bagian.append(f"<p class=\"sub\">Token: masukan {_n(tok.get('input'))} · keluaran {_n(tok.get('output'))} (termasuk proses berpikir AI) · "
                  f"dibaca dari cache {_n(tok.get('cache_read'))} · ditulis ke cache {_n(tok.get('cache_write'))}. Bagian prompt yang terpakai "
                  f"ulang dari cache: {_pct(by.get('cache_hit_persen'))}. Harga Claude Haiku 5.5: US$0,10 per 1 juta token masukan, "
                  "US$0,50 per 1 juta token keluaran; baca cache 0,1×, tulis cache 1 jam 2×. Biaya lain (listrik laptop, internet) tidak dihitung.</p>")

    # ---------------- waktu
    w = m.get("waktu") or {}
    bagian.append("<h2>Waktu proses</h2>")
    bagian.append(f"<p>Per video (unduh sampai saran AI): median <b>{_d(w.get('median_detik'))} detik</b>, 90% video selesai dalam "
                  f"<b>{_d(w.get('p90_detik'))} detik</b>, rata-rata {_d(w.get('rata_detik'))} detik — di laptop dengan GPU RTX 5050, "
                  "satu video sekaligus.</p>")
    tahap = w.get("per_tahap") or {}
    if tahap:
        bagian.append("<h3>Rata-rata per tahap</h3>")
        bagian.append(_bar_tunggal([(TAHAP_LABEL.get(k, k), float(v), _d(v)) for k, v in tahap.items()], " dtk"))

    # ---------------- contoh kasus
    benar_c, salah_c = mk.pilih_contoh(baris)
    bagian.append("<h2>Contoh kasus</h2><p>Tanpa nama, akun, atau link clipper — hanya nomor video Konten.com.</p>")
    if salah_c:
        bagian.append("<h3>AI salah</h3>" + "".join(_kasus(r, "salah") for r in salah_c))
    if benar_c:
        bagian.append("<h3>AI benar</h3>" + "".join(_kasus(r, "benar") for r in benar_c))
    if not (benar_c or salah_c):
        bagian.append("<p>Belum ada contoh.</p>")

    # ---------------- banding versi rubrik
    if pembanding and pembanding.get("metrik"):
        lama_run = pembanding.get("run") or {}
        bv = mk.bandingkan_versi(pembanding["metrik"], m, pembanding.get("baris"), baris)
        bagian.append(f"<h2>Rubrik lama vs baru</h2><p>Lama: {_sis(lama_run.get('rubric_version')) or '-'} "
                      f"({_sis(str(lama_run.get('id') or ''))}) · Baru: {_sis(run.get('rubric_version')) or '-'} — sampel video yang sama.</p>")
        isi = []
        for x in bv["tabel"]:
            sel = "-" if x["selisih"] is None else (("+" if x["selisih"] > 0 else "") + _d(x["selisih"]) + " poin")
            kls = "benar" if x["membaik"] else ("salah" if x["membaik"] is False else "")
            isi.append([x["label"], _pct(x["lama"]), _pct(x["baru"]), f'<span class="{kls}">{sel}</span>'])
        bagian.append(_tabel([("Ukuran", False), ("Lama", True), ("Baru", True), ("Selisih", True)], isi))
        bp = bv["berpasangan"]
        if bp["dibanding"]:
            bagian.append(f"<p>Pada {_n(bp['dibanding'])} video yang sama: <span class=\"benar\">{_n(bp['jadi_benar'])} jadi benar</span>, "
                          f"<span class=\"salah\">{_n(bp['jadi_salah'])} jadi salah</span>, {_n(bp['sama_benar'])} tetap benar, "
                          f"{_n(bp['sama_salah'])} tetap salah, {_n(bp['lain'])} lainnya (cek manusia).</p>")

    # ---------------- tidak dihitung + keterbatasan
    bagian.append("<h2>Video yang tidak dihitung dalam akurasi</h2><ul class=\"daftar\">"
                  f"<li>Video tidak bisa diakses (dihapus, private, atau butuh login): <b>{_n(m.get('n_tidak_bisa_diakses'))}</b></li>"
                  f"<li>Gagal diproses di laptop: <b>{_n(m.get('n_gagal'))}</b></li>"
                  f"<li>Di-reject karena alasan di luar isi video (followers, link di bio, duplikat, engagement/bot, video pakai Ads, tidak bisa diakses saat dicek reviewer): <b>{_n(m.get('n_di_luar_video'))}</b></li>"
                  f"<li>Tanpa keputusan reviewer yang jelas: <b>{_n(m.get('n_tanpa_keputusan'))}</b></li></ul>")
    tl = m.get("termasuk_di_luar_video") or {}
    if m.get("n_di_luar_video"):
        bagian.append(f"<p class=\"sub\">Kalau video beralasan di luar isi video ikut dihitung, setuju dengan hasil akhir menjadi "
                      f"{_pct(tl.get('setuju_akhir'))} ({_n((tl.get('setuju_akhir') or {}).get('n'))} video).</p>")
    mesin = {}
    for r in baris:
        e = (r.get("music") or {}).get("mesin") if isinstance(r.get("music"), dict) else None
        if e and (r.get("music") or {}).get("status") not in ("tidak_ada_referensi", "nonaktif"):
            mesin[e] = mesin.get(e, 0) + 1
    ket_mesin = ", ".join(f"{MUSIK_LABEL.get(k, k)}: {_n(v)}" for k, v in sorted(mesin.items(), key=lambda kv: -kv[1])) or "belum dipakai"
    catatan = "".join(f"<li>{_t(c, 200)}</li>" for c in (sp.get("catatan") or []))
    bagian.append(
        "<h2>Catatan &amp; keterbatasan</h2><ul class=\"daftar\">"
        "<li>AI hanya <b>menyarankan</b>. Keputusan approve/reject tetap di tangan reviewer.</li>"
        "<li>Jawaban benar diambil dari keputusan reviewer lama; kalau keputusan itu dibatalkan saat banding, hasil banding yang dipakai. "
        "Reviewer juga bisa keliru, jadi angka di atas adalah tingkat kesesuaian, bukan kebenaran mutlak.</li>"
        "<li>Rentang wajar 95% (metode Wilson) menunjukkan seberapa jauh angka bisa bergeser karena ukuran sampel; makin banyak video, "
        "makin sempit rentangnya.</li>"
        "<li>Sampel dipilih seimbang approve/reject dan disebar ke banyak campaign, reviewer, dan hari. Di pekerjaan sehari-hari "
        "perbandingan approve/reject berbeda, sehingga angka gabungan (setuju, ketepatan saran reject, approve padahal reject, "
        "% cek manusia) <b>bisa berbeda cukup jauh</b> — lihat tabel \"Kalau dipakai sehari-hari\". Angka per jenis video "
        "(seharusnya approve / seharusnya reject) tidak terpengaruh.</li>"
        "<li>Poin brief yang butuh mengenali orang tertentu (artis/aktor) <b>selalu</b> diserahkan ke manusia — AI tidak menebak identitas orang.</li>"
        "<li>Poin \"wajib pakai materi\" (lagu, poster, trailer) hanya bisa dinilai kalau materi referensi campaign tersedia; kalau belum, "
        "diserahkan ke manusia.</li>"
        f"<li>Pencocokan musik memakai: {ket_mesin}. Panako belum didukung resmi di Windows, jadi laptop bisa memakai cadangan yang "
        "sedikit kurang tahan perubahan tempo.</li>"
        "<li>Video Instagram/YouTube tertentu tidak bisa diunduh tanpa login; video seperti itu dicatat \"tidak bisa diakses\".</li>"
        f"{catatan}</ul>")

    body = "".join(bagian)
    if ada_data_pribadi(re.sub(r"<[^>]+>", " ", body)):  # pengaman terakhir — semestinya tidak pernah terjadi
        log.warning("Laporan run %s memuat pola mirip data pribadi — periksa sumber teks.", rid[:8])
    dibuat = datetime.now(WIB).strftime("%d-%m-%Y %H:%M WIB")
    return ("<!doctype html><html lang=\"id\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            "<meta name=\"color-scheme\" content=\"light dark\"><meta name=\"robots\" content=\"noindex\">"
            f"<title>Laporan Uji Akurasi — {_sis(run.get('rubric_version')) or 'rubrik'} — {_sis(rid[:8])}</title>"
            f"<style>{CSS}</style></head><body><main>{body}"
            f"<footer>Dibuat otomatis oleh review-worker {VERSION} pada {dibuat}. Laporan internal MODE UJI CS Tracker — "
            "tanpa data pribadi clipper.</footer></main></body></html>")


def _pembanding(rt, simp, run: dict) -> Optional[dict]:
    lama_id = (run.get("sample_params") or {}).get("ulang_dari")
    if not lama_id:
        return None
    try:
        lama = simp.ambil_run(str(lama_id))
        if lama is None:
            return None
        bl = simp.hasil_run(str(lama_id))
        return {"run": lama, "metrik": mk.hitung_metrik(bl, rt.cfg, n_sampel=len(lama.get("sample") or [])), "baris": bl}
    except Exception as e:
        log.info("Run pembanding %s tidak terbaca (%s).", str(lama_id)[:8], str(e)[:100])
        return None


def simpan_laporan(rt, run_id: str, *, run: Optional[dict] = None, baris: Optional[list[dict]] = None,
                   metrik_run: Optional[dict] = None) -> str:
    """ambil run + hasil dari Supabase, hitung ulang metrik, tulis file + upload; balikan path storage ("" kalau tanpa Supabase).
    run / baris / metrik_run opsional (dipakai uji.tutup_run supaya tidak mengambil ulang)."""
    from .uji import Simpanan

    simp = Simpanan(rt)
    rid = str(run_id)
    if run is None:
        run = simp.ambil_run(rid)
        if run is None:
            raise LookupError(f"Run {rid[:8]} tidak ditemukan.")
    if baris is None:
        baris = simp.hasil_run(rid)
    m = metrik_run or mk.hitung_metrik(baris, rt.cfg, n_sampel=len(run.get("sample") or []))
    isi = buat_laporan(run, m, baris, _pembanding(rt, simp, run))
    folder = Path(rt.cfg.laporan)
    folder.mkdir(parents=True, exist_ok=True)
    f = folder / f"{_vid(rid)}.html"
    tmp = f.with_suffix(".part")
    tmp.write_text(isi, encoding="utf-8")
    tmp.replace(f)
    log.info("Laporan run %s ditulis: %s", rid[:8], f)
    if getattr(rt, "supa", None) is None:
        return ""
    path = f"laporan/{_vid(rid)}.html"
    rt.supa.upload(path, isi.encode("utf-8"), "text/html")
    patch: dict = {"report_path": path}
    if metrik_run is None:
        patch.update({"metrics": m, "cost_usd": m["biaya"]["total_usd"]})
    simp.ubah_run(rid, patch)
    return path
