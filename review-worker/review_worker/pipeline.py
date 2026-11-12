"""Satu video dari awal sampai tersimpan (pemilik: worker-inti). KONTRAK.md §4.1.
replika.ambil_video → brief (cache per campaign) → referensi materi → media.susun.buat_materi_video → hakim.nilai
→ keputusan manusia + kebenaran akhir → supa.simpan_hasil. Folder kerja sementara selalu dihapus (finally).
Error per video TIDAK menghentikan uji: dicatat sebagai pipeline_status 'gagal' / 'tidak_bisa_diakses' + saran cek_manusia.

Yang DITERUSKAN (menghentikan uji, bukan dicatat per video): AnggaranHabis (batas biaya harian), Cancelled / Berhenti /
KeyboardInterrupt, KolomError (pemetaan kolom salah — semua video pasti gagal), ReplikaError sesudah menunggu VPN
30 mnt (pipeline sendiri yang menunggu & mencoba lagi tiap 60 dtk)."""
from __future__ import annotations

import json
import re
import shutil
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from . import log as rlog
from .jobctx import Cancelled
from .kolom import KolomError
from .privasi import bersihkan_teks
from .replika import ReplikaError
from .skema import BriefCampaign, CampaignDB, HasilVideo, VideoDB
from .supa import SupaError

log = rlog.get("pipeline")
BRIEF_TTL = 6 * 3600.0  # brief campaign dibaca ulang dari replika paling lama tiap 6 jam (brand bisa mengubah brief)
TMP_BASI = 6 * 3600.0  # sisa folder sementara lebih tua dari ini dihapus saat worker mulai
GAGAL_UMUM = "Proses video gagal di laptop."
TIDAK_ADA = "Video tidak ditemukan di database Konten.com."


def _anggaran_habis():
    """kelas AnggaranHabis milik hakim-ai (impor malas; modul belum ada → kelas tiruan yang tidak pernah dilempar)"""
    try:
        from .biaya import AnggaranHabis

        return AnggaranHabis
    except Exception:  # pragma: no cover
        class _Tak(Exception):
            pass

        return _Tak


def _aman(nama: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(nama))[:64] or "video"


def bersihkan_tmp(cfg, umur: float = TMP_BASI) -> int:
    """hapus sisa folder data/tmp/<video> yang lebih tua dari `umur` (laptop mati di tengah video)"""
    n = 0
    tmp = Path(cfg.tmp)
    if not tmp.is_dir():
        return 0
    batas = time.time() - umur
    for p in tmp.iterdir():
        try:
            if p.stat().st_mtime < batas:
                shutil.rmtree(p, ignore_errors=True) if p.is_dir() else p.unlink()
                n += 1
        except OSError:
            pass
    if n:
        log.info("Sisa %d file/folder video sementara lama dihapus.", n)
    return n


def dengan_replika(rt, fn: Callable[[], Any], cek_batal: Optional[Callable[[], None]] = None) -> Any:
    """panggil DB replika; VPN putus → tunggu & coba lagi tiap 60 dtk sampai 30 mnt, lalu ReplikaError"""
    try:
        return fn()
    except ReplikaError:
        tunggu = getattr(rt.replika, "tunggu_koneksi", None)
        if tunggu is None:
            raise
        lama = float(getattr(rt.cfg, "replika_tunggu_menit", 30)) * 60
        log.warning("DB Konten.com terputus — menunggu VPN tersambung lagi (maks %d mnt)…", int(lama // 60))
        tunggu(maks_detik=lama, cek_batal=cek_batal)
        return fn()


# ------------------------------------------------------------------ brief per campaign
def brief_campaign(rt, campaign_id: str) -> tuple[CampaignDB, BriefCampaign]:
    """ambil campaign dari replika + brief.parse_brief, cache di rt.cache["brief"][campaign_id]; upsert review_campaigns
    (judul, brand, status, brief_points, brief_hash, duration_min/max) — data brand, bukan data clipper"""
    from .brief import parse_brief

    cid = str(campaign_id)
    cache = rt.cache.setdefault("brief", {})
    hit = cache.get(cid)
    if hit and time.monotonic() - hit[2] < BRIEF_TTL:
        return hit[0], hit[1]
    campaign = dengan_replika(rt, lambda: rt.replika.ambil_campaign(cid))
    if campaign is None:
        raise LookupError(f"Campaign {cid} tidak ditemukan di database Konten.com.")
    brief = parse_brief(campaign)
    for c in brief.catatan_parser[:10]:
        log.info("Brief campaign %s: %s", cid, c)
    cache[cid] = (campaign, brief, time.monotonic())
    if rt.supa is not None and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", cid):
        row = {
            "campaign_id": cid,
            "title": bersihkan_teks(brief.judul or campaign.title, 300) or None,
            "brand": bersihkan_teks(brief.brand or campaign.brand, 200) or None,
            "campaign_status": campaign.status,
            "brief_points": [p.model_dump(mode="json") for p in brief.poin],
            "brief_hash": brief.hash or None,
            "duration_min": int(brief.durasi_min) if brief.durasi_min is not None else None,
            "duration_max": int(round(brief.durasi_max)) if brief.durasi_max is not None else None,
            "last_seen_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        try:
            rt.supa.insert("review_campaigns", row, on_conflict="campaign_id", merge=True)
        except SupaError as e:
            log.warning("Data campaign %s belum tersimpan di Supabase (%s).", cid, str(e)[:120])
    return campaign, brief


def _referensi(rt, campaign: CampaignDB, brief: BriefCampaign):
    """referensi materi campaign; belum pernah dicek → siapkan sekali (gdown). Upload manual yang antri disidik dulu."""
    from .media import materi as m
    from .skema import ReferensiCampaign

    cid = campaign.id
    try:
        ref = m.referensi_campaign(rt, cid)
        if any(x.status == "antri_sidik" for x in ref.materi):
            m.proses_upload_manual(rt, cid)
            rt.cache.get("ref", {}).pop(cid, None)
            ref = m.referensi_campaign(rt, cid)
        if ref.status == "belum_dicek":
            ref = m.siapkan_materi_campaign(rt, campaign, brief)
        return ref
    except (Cancelled, KeyboardInterrupt):
        raise
    except Exception as e:  # materi bermasalah tidak menghentikan video: poin "wajib pakai materi" jadi cek manusia
        log.warning("Materi referensi campaign %s tidak bisa disiapkan (%s: %s).", cid, type(e).__name__, str(e)[:150])
        return ReferensiCampaign(campaign_id=cid, status="gagal", pesan="Materi referensi gagal disiapkan di laptop.")


CONDONG_LOKAL = "condong-lokal.jsonl"
CONDONG_TERKIRIM = "condong-lokal-terkirim.jsonl"  # arsip baris yang sudah ditulis balik ke Supabase
PULIH_CONDONG_JEDA = 600.0  # tulis-balik yang gagal dicoba lagi paling cepat 10 menit kemudian
_KUNCI_CONDONG = threading.Lock()


def _simpan_condong_lokal(rt, hasil: HasilVideo) -> None:
    """migration-24 belum dijalankan (Supabase menolak kolom ai_lean) → condong disimpan di data/condong-lokal.jsonl supaya
    metrik & laporan uji tetap bisa menghitung akurasi condong (uji.Simpanan.hasil_run menggabungkannya). Sesudah migration-24
    dijalankan, pulihkan_condong_lokal menulisnya balik ke review_results (website ikut menampilkan condong)."""
    if not hasil.ai_lean:
        return
    try:
        with _KUNCI_CONDONG, open(Path(rt.cfg.data) / CONDONG_LOKAL, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"scope": hasil.scope, "video_id": hasil.video_id, "ai_lean": hasil.ai_lean,
                                 "ai_lean_confidence": hasil.ai_lean_confidence, "suggestion": hasil.suggestion,
                                 "rubric_hash": hasil.rubric_hash}, ensure_ascii=False) + "\n")
    except OSError as e:
        log.warning("Condong AI video %s tidak bisa disimpan lokal: %s", hasil.video_id, e)


def pulihkan_condong_lokal(rt, paksa: bool = False) -> Optional[int]:
    """migration-24 sudah dijalankan → condong yang dulu hanya tersimpan di data/condong-lokal.jsonl ditulis balik ke
    review_results (per scope + video_id), supaya kartu / filter website & angka Ringkasan sama. Hanya baris yang ai_lean-nya
    masih kosong DAN (kalau tercatat) saran & rubriknya masih sama — hasil yang sudah dinilai ulang tidak ditimpa. Semua
    terkirim → baris dipindah ke condong-lokal-terkirim.jsonl. Balikan jumlah baris yang diperbarui, None = belum dicoba / gagal
    (dicoba lagi nanti). Dipanggil otomatis sesudah hasil tersimpan dengan kolom condong (jeda 10 menit antar percobaan)."""
    supa = rt.supa
    f = Path(rt.cfg.data) / CONDONG_LOKAL
    if supa is None or getattr(supa, "tanpa_condong", False) is True or not f.is_file():
        return None
    now = time.monotonic()
    if not paksa and now - (getattr(rt, "_pulih_condong_coba", None) or -1e9) < PULIH_CONDONG_JEDA:
        return None
    rt._pulih_condong_coba = now
    with _KUNCI_CONDONG:
        try:
            baris = f.read_text(encoding="utf-8").splitlines()
        except OSError as e:
            log.warning("%s tidak terbaca: %s", CONDONG_LOKAL, e)
            return None
        terakhir: dict[tuple[str, str], dict] = {}  # baris terakhir per video (dinilai ulang → yang terbaru)
        for b in baris:
            try:
                r = json.loads(b)
            except ValueError:
                continue
            if (isinstance(r, dict) and r.get("scope") and r.get("video_id") is not None
                    and r.get("ai_lean") in ("approve", "reject") and isinstance(r.get("ai_lean_confidence"), int)):
                terakhir[(str(r["scope"]), str(r["video_id"]))] = r
        n = 0
        try:
            for (scope, vid), r in terakhir.items():
                filt = {"scope": f"eq.{scope}", "video_id": f"eq.{vid}", "ai_lean": "is.null"}
                if r.get("suggestion"):
                    filt["suggestion"] = f"eq.{r['suggestion']}"
                if r.get("rubric_hash"):
                    filt["rubric_hash"] = f"eq.{r['rubric_hash']}"
                got = supa.update("review_results", filt, {"ai_lean": r["ai_lean"],
                                                           "ai_lean_confidence": max(0, min(100, r["ai_lean_confidence"]))})
                n += len(got or [])
        except SupaError as e:
            from .supa import _kolom_hilang

            if _kolom_hilang(str(e)):  # migration-24 belum dijalankan: tetap di cadangan lokal (bukan masalah)
                log.info("Kolom condong AI belum ada di Supabase — condong lama tetap di %s.", CONDONG_LOKAL)
            else:
                log.warning("Condong AI lama belum bisa ditulis ke Supabase (%s) — dicoba lagi nanti.", str(e)[:120])
            return None
        try:
            with open(Path(rt.cfg.data) / CONDONG_TERKIRIM, "a", encoding="utf-8") as fh:
                fh.writelines(b + "\n" for b in baris)
            f.unlink()
        except OSError as e:
            log.warning("%s tidak bisa diarsipkan: %s", CONDONG_LOKAL, e)
    log.info("Condong AI lama (sebelum migration-24) ditulis ke Supabase: %d hasil diperbarui.", n)
    return n


def _simpan(rt, hasil: HasilVideo) -> Optional[dict]:
    row = hasil.baris_supabase()
    if rt.supa is not None:
        try:
            got = rt.supa.simpan_hasil(row)
            if getattr(rt.supa, "tanpa_condong", False) is True:
                _simpan_condong_lokal(rt, hasil)
            else:  # kolom condong ada (migration-24 sudah jalan) → condong lama dari cadangan lokal ditulis balik sekali
                pulihkan_condong_lokal(rt)
            return got
        except SupaError as e:
            log.warning("Hasil video %s belum tersimpan di Supabase (%s) — disimpan lokal dulu.", hasil.video_id, str(e)[:120])
    f = Path(rt.cfg.data) / "hasil-lokal.jsonl"
    try:
        with open(f, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({**row, "disimpan": datetime.now(timezone.utc).isoformat(timespec="seconds")}, ensure_ascii=False) + "\n")
    except OSError as e:
        log.error("Hasil video %s tidak bisa disimpan lokal: %s", hasil.video_id, e)
    return None


def _manusia(rt, video_id: str, cek_batal) -> Any:
    km = dengan_replika(rt, lambda: rt.replika.keputusan_manusia([video_id]), cek_batal)
    return (km or {}).get(str(video_id))


def _isi_manusia(hasil: HasilVideo, km) -> None:
    from . import kebenaran
    from .alasan import kode_untuk_label

    if km is None:
        return
    hasil.human_decision = km.keputusan
    hasil.human_reason = km.alasan_label
    hasil.human_code = kode_untuk_label(km.alasan_label) if km.alasan_label else None
    hasil.reviewer = km.reviewer
    hasil.decided_at = km.diputuskan
    truth, appeal = kebenaran.tentukan(km)
    hasil.final_truth, hasil.appeal = truth, appeal
    hasil.match = kebenaran.cocok(hasil.suggestion, truth)


def proses_video(rt, video_id: str, *, scope: str, run_id: Optional[str] = None, job_id: Optional[str] = None,
                 cek_batal: Optional[Callable[[], None]] = None, simpan: bool = True, video: Optional[VideoDB] = None,
                 progres: Optional[Callable[[float, str], None]] = None) -> HasilVideo:
    """scope "run:<id>" (uji) / "job:<id>" (video tunggal). simpan=False dipakai tes. AnggaranHabis dari hakim DITERUSKAN
    (uji berhenti), Cancelled diteruskan, error lain → HasilVideo gagal.
    Tambahan opsional: video = VideoDB yang sudah diambil (job video: tidak query dua kali), progres(p, pesan) = progres kasar."""
    from .media import susun

    AnggaranHabis = _anggaran_habis()
    t0 = time.monotonic()
    vid = str(video_id)
    kerja = Path(rt.cfg.tmp) / _aman(vid)
    hasil = HasilVideo(scope=scope, run_id=run_id, job_id=job_id, video_id=vid, model=getattr(rt.cfg, "model", None))

    def lapor(p: float, pesan: str) -> None:
        if progres:
            try:
                progres(p, pesan)
            except (Cancelled, KeyboardInterrupt):
                raise
            except Exception:
                pass

    try:
        lapor(0.05, "Mengambil data video dari database Konten.com…")
        if video is None:
            video = dengan_replika(rt, lambda: rt.replika.ambil_video(vid), cek_batal)
        if video is None:
            raise LookupError(TIDAK_ADA)
        hasil.platform, hasil.platform_video_id, hasil.campaign_id = video.platform, video.platform_video_id, video.campaign_id
        if not video.campaign_id:
            raise LookupError("Video tidak punya campaign di database Konten.com.")
        lapor(0.12, "Membaca brief campaign…")
        campaign, brief = brief_campaign(rt, video.campaign_id)
        hasil.campaign_title = bersihkan_teks(brief.judul or campaign.title, 300) or None
        hasil.brand = bersihkan_teks(brief.brand or campaign.brand, 200) or None
        lapor(0.2, "Menyiapkan materi referensi campaign…")
        ref = _referensi(rt, campaign, brief)
        if cek_batal:
            cek_batal()
        lapor(0.3, "Mengunduh & mengolah video (frame, teks layar, suara, musik)…")
        kerja.mkdir(parents=True, exist_ok=True)
        materi = susun.buat_materi_video(rt, video, brief, ref, kerja, cek_batal)
        rt.terakhir_gpu = time.monotonic()
        if cek_batal:
            cek_batal()
        lapor(0.8, "Meminta saran AI…")
        hakim = rt.siapkan_hakim()
        nilai = hakim.nilai(brief, materi, ref)
        hasil.pipeline_status = materi.status
        hasil.error = materi.error
        hasil.rubric_version, hasil.rubric_hash = nilai.rubrik_versi or None, nilai.rubrik_hash or None
        hasil.model = nilai.pemakaian.model or hasil.model
        hasil.suggestion, hasil.confidence = nilai.saran, max(0, min(100, int(nilai.keyakinan)))
        hasil.official_code, hasil.official_reason = nilai.alasan_kode, nilai.alasan_label
        hasil.specific_reason = bersihkan_teks(nilai.alasan_spesifik, 500) or None
        hasil.handoff_reasons = list(dict.fromkeys(nilai.serah))
        if nilai.condong in ("approve", "reject") and nilai.keyakinan_condong is not None:  # condong AI (migration-24)
            hasil.ai_lean, hasil.ai_lean_confidence = nilai.condong, max(0, min(100, int(nilai.keyakinan_condong)))
        hasil.checklist = [{**c.model_dump(mode="json"), "bukti": bersihkan_teks(c.bukti, 600)} for c in nilai.checklist]
        hasil.music = materi.musik.model_dump(mode="json")
        hasil.visual = materi.visual.model_dump(mode="json")
        hasil.meta = {"durasi_detik": materi.meta.durasi_detik, "n_hashtag": len(materi.meta.hashtags),
                      "hashtag_present": materi.meta.hashtag_present, "bot_score": materi.meta.bot_score, "n_frame": len(materi.frames),
                      "ringkasan": bersihkan_teks(nilai.ringkasan, 500)}
        p = nilai.pemakaian
        hasil.cost_usd = round(float(p.biaya_usd or 0), 6)
        hasil.tokens = {"input": p.input, "output": p.output, "cache_read": p.cache_read, "cache_write_1h": p.cache_write_1h,
                        "cache_write_5m": p.cache_write_5m}
        hasil.stage_sec = {**{k: round(float(v), 2) for k, v in materi.waktu_tahap.items()}, "hakim": round(float(p.detik or 0), 2)}
        lapor(0.9, "Mencocokkan dengan keputusan reviewer…")
        _isi_manusia(hasil, _manusia(rt, vid, cek_batal))
    except (AnggaranHabis, Cancelled, KeyboardInterrupt, KolomError, ReplikaError):
        raise
    except LookupError as e:
        hasil.pipeline_status, hasil.suggestion, hasil.error = "gagal", "cek_manusia", str(e)[:300]
        hasil.handoff_reasons = ["ai_gagal"]
    except Exception as e:
        log.exception("Video %s gagal diproses (%s).", vid, type(e).__name__)
        hasil.pipeline_status, hasil.suggestion = "gagal", "cek_manusia"
        hasil.error = f"{GAGAL_UMUM} ({type(e).__name__})"
        hasil.handoff_reasons = ["ai_gagal"]
    finally:
        shutil.rmtree(kerja, ignore_errors=True)
        cek_gpu = getattr(rt, "cek_gpu_bersama", None)
        if callable(cek_gpu):
            cek_gpu()
    # gagal pun: keputusan reviewer tetap dicatat (laporan menghitung video gagal terpisah)
    if hasil.pipeline_status == "gagal" and hasil.human_decision is None and hasil.error != TIDAK_ADA:
        try:
            _isi_manusia(hasil, _manusia(rt, vid, cek_batal))
        except (Cancelled, KeyboardInterrupt, KolomError, ReplikaError):
            raise
        except Exception:
            pass
    hasil.process_sec = round(time.monotonic() - t0, 2)
    log.info("Video %s: %s%s · condong %s · %s · %.0f dtk · $%.4f", vid, hasil.suggestion or "-",
             f" ({hasil.confidence})" if hasil.confidence is not None else "",
             f"{hasil.ai_lean} {hasil.ai_lean_confidence}%" if hasil.ai_lean else "-", hasil.pipeline_status, hasil.process_sec,
             hasil.cost_usd)
    if simpan:
        lapor(0.97, "Menyimpan hasil…")
        _simpan(rt, hasil)
    return hasil
