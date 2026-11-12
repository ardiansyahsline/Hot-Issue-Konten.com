"""
review-worker — Asisten Review Video (MODE UJI). Perintah (pemilik: worker-inti; KONTRAK.md §3.2):
  review cek                         cek .env, DB replika (VPN), Supabase, kunci AI, GPU, ffmpeg, Java/Panako, OCR
  review kenali-skema [--nilai]      baca information_schema alif.* → data/skema.json + cocokkan dengan kolom.toml
  review sinkron-alasan              daftar alasan reject resmi dari audit_log → Supabase review_reasons
  review uji --jumlah 50 [--seed N] [--label teks] [--lanjut RUN] [--ulang RUN] [--dari YYYY-MM-DD --sampai YYYY-MM-DD]
  review video <id-atau-link> [...]  uji manual video tertentu (link tidak disimpan; hanya id)
  review materi <campaign_id> [--paksa]
  review laporan <run_id>            buat ulang laporan HTML → data/laporan/<run_id>.html (+ upload)
  review jalan                       tunggu antrian dari website (tab "Asisten Review (Uji)")
Jalankan dari jalankan.bat / NYALAKAN-ASISTEN-REVIEW.bat, atau `.venv\\Scripts\\python review.py <perintah>`.
Kode keluar: 0 ok, 1 gagal, 2 pengaturan kurang.
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from review_worker import config  # noqa: E402  (pertama: HF_HOME dll. sebelum library berat)

OK, GAGAL, KURANG = 0, 1, 2


def _rt(cfg, butuh_supa: bool = False):
    """Runtime untuk perintah CLI. Supabase kosong → None (uji/video menyimpan ke data/hasil-lokal.jsonl)."""
    from review_worker import kolom as kolom_mod
    from review_worker.gpu_bersama import KunciGPU
    from review_worker.replika import Replika
    from review_worker.runtime import Runtime
    from review_worker.supa import Supa

    supa = Supa(cfg.supabase_url, cfg.service_key, cfg.worker_id) if cfg.ada_supabase() else None
    if butuh_supa and supa is None:
        raise SystemExit(_kurang(cfg))
    return Runtime(cfg=cfg, supa=supa, replika=Replika(cfg, kolom_mod.muat(cfg.kolom_file)), gpu=KunciGPU("review-worker"))


def _kurang(cfg) -> int:
    miss = cfg.missing()
    bad = config.url_problem(cfg.supabase_url)
    print(f"Pengaturan belum lengkap: isi {', '.join(miss)} di review-worker\\.env (notepad .env)." if miss else bad)
    return KURANG


# ------------------------------------------------------------------ cek
def _baris(ok: bool | None, judul: str, ket: str = "") -> bool:
    tanda = "OK   " if ok else ("--   " if ok is None else "GAGAL")
    print(f"  [{tanda}] {judul}" + (f" — {ket}" if ket else ""))
    return bool(ok) or ok is None


def _pgpass() -> Path:
    if os.environ.get("PGPASSFILE"):
        return Path(os.environ["PGPASSFILE"])
    if os.name == "nt":
        return Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming") / "postgresql" / "pgpass.conf"
    return Path.home() / ".pgpass"


def cmd_cek(cfg, args) -> int:
    from review_worker.runtime import info_gpu, mesin_musik

    print("Cek Asisten Review (tanpa panggilan AI berbayar, tanpa mengubah apa pun):")
    penting = True
    env_ada = cfg.env_file is not None and cfg.env_file.exists()
    _baris(env_ada, "File .env", str(cfg.env_file) if env_ada else "belum ada — salin .env.example jadi .env lalu isi")
    if cfg.env_note:
        _baris(None, "Catatan .env", cfg.env_note)
    supa_ok = cfg.ada_supabase()
    penting &= _baris(supa_ok, "SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY", "terisi" if supa_ok else (config.url_problem(cfg.supabase_url) or
                                                                                                        "isi di .env"))
    # DB replika: hanya NAMA env yang dicetak, nilai tidak
    pg = [f"{k} ({cfg.pg_dari_env.get(k)})" for k in config.PG_ENV if os.environ.get(k)]
    _baris(bool(os.environ.get("PGHOST")), "Env DB replika", ", ".join(pg) if pg else "PGHOST dkk. belum di-set (env Windows atau .env)")
    pp = _pgpass()
    _baris(pp.exists(), "pgpass.conf (password DB)", "ada" if pp.exists() else f"tidak ditemukan di {pp}")
    rt = None
    try:
        rt = _rt(cfg)
    except Exception as e:
        penting &= _baris(False, "kolom.toml", str(e))
    if rt is not None:
        db = rt.replika.cek_koneksi()
        penting &= _baris(db is None, "DB Konten.com (VPN) read-only", "tersambung, sesi read-only terverifikasi" if db is None else db)
        if db is None:
            try:
                masalah = rt.replika.cek_pemetaan()
                wajib = [m for m in masalah if not m.startswith("(opsional)")]
                penting &= _baris(not wajib, "Pemetaan kolom.toml", "cocok" if not masalah else f"{len(masalah)} catatan — jalankan: review kenali-skema")
                for m in masalah[:8]:
                    print("        - " + m)
            except Exception as e:
                penting &= _baris(False, "Pemetaan kolom.toml", str(e))
        if rt.supa is not None:
            try:
                rt.supa.select("review_workers", select="id", limit="1")
                _baris(True, "Supabase CS Tracker", "tersambung, tabel migration-23 ada")
            except Exception as e:
                penting &= _baris(False, "Supabase CS Tracker", str(e)[:200])
    ant = importlib.util.find_spec("anthropic") is not None
    _baris(cfg.anthropic_key_ada and ant, "Kunci AI (ANTHROPIC_API_KEY)",
           ("terisi" if cfg.anthropic_key_ada else "KOSONG — AI mati, hasil jadi 'butuh cek manusia'") + ("" if ant else "; paket anthropic belum terpasang"))
    print(f"        model {cfg.model}, effort {cfg.effort}, batas ${cfg.daily_budget_usd:g}/hari, ambang keyakinan {cfg.min_confidence}")
    g = info_gpu()
    _baris(bool(g.get("nama")) or None, "GPU NVIDIA", f"{g['nama']} ({g['vram_gb']} GB)" if g.get("nama") else "tidak terdeteksi — ASR/OCR pakai CPU (lambat)")
    ff = shutil.which("ffmpeg")
    ver = ""
    if ff:
        try:
            ver = subprocess.run([ff, "-hide_banner", "-version"], capture_output=True, text=True, timeout=15).stdout.splitlines()[0][:60]
        except Exception:
            ver = "ada"
    penting &= _baris(bool(ff), "ffmpeg", ver or "belum terpasang (winget install Gyan.FFmpeg)")
    try:
        from review_worker.media import musik

        mesin, pesan = musik.cek_mesin(cfg)
    except Exception as e:
        mesin, pesan = mesin_musik(cfg), f"cek mesin musik gagal ({type(e).__name__})"
    _baris(mesin in ("panako", "olaf") or (None if mesin == "chroma" else False), "Musik (Java + Panako)", f"{mesin}: {pesan}")
    if cfg.ocr == "mati":
        _baris(None, "OCR teks layar", "dimatikan (REVIEW_OCR=mati)")
    else:
        _baris(importlib.util.find_spec("easyocr") is not None, "OCR teks layar (EasyOCR)", "terpasang" if importlib.util.find_spec("easyocr")
               else "belum terpasang — jalankan install.ps1")
    for mod, nama in (("yt_dlp", "yt-dlp (unduh video)"), ("scenedetect", "PySceneDetect (frame)"), ("faster_whisper", "faster-whisper (suara)"),
                      ("gdown", "gdown (materi Google Drive)"), ("psycopg", "psycopg (DB replika)")):
        ada = importlib.util.find_spec(mod) is not None
        penting &= _baris(ada, nama, "terpasang" if ada else "belum terpasang — jalankan install.ps1")
    print("Hasil: " + ("SIAP." if penting else "ada yang perlu dibereskan (baris GAGAL di atas)."))
    if rt is not None:
        rt.replika.tutup()
    return OK if penting else GAGAL


# ------------------------------------------------------------------ perintah lain
def cmd_kenali(cfg, args) -> int:
    rt = _rt(cfg)
    try:
        masalah = rt.replika.kenali_skema(nilai=bool(args.nilai))
        return OK if masalah is not None else GAGAL
    finally:
        rt.replika.tutup()


def cmd_sinkron(cfg, args) -> int:
    from review_worker import antrian

    rt = _rt(cfg)
    n = antrian.sinkron_alasan(rt)
    print(f"{n} alasan reject resmi " + ("disinkron ke Supabase." if rt.supa is not None else "(Supabase belum diisi — hanya ditampilkan)."))
    return OK


def cmd_uji(cfg, args) -> int:
    from review_worker import uji

    if not (args.jumlah or args.lanjut or args.ulang):
        print("Isi --jumlah (mis. 50), atau --lanjut <run> / --ulang <run>.")
        return KURANG
    rt = _rt(cfg)
    rt.replika.rentang = (args.dari, args.sampai)
    if rt.supa is None:
        print("Supabase belum diisi → hasil disimpan lokal (data/hasil-lokal.jsonl) + laporan lokal.")
    run_id = uji.jalankan_uji(rt, None, jumlah=None if (args.lanjut or args.ulang) else args.jumlah, lanjut_run=args.lanjut,
                              ulang_run=args.ulang, label=args.label, seed=args.seed)
    print(f"Uji selesai. Run: {run_id}. Laporan: {cfg.laporan / (str(run_id) + '.html')}")
    return OK


def cmd_video(cfg, args) -> int:
    from review_worker import pipeline
    from review_worker.platform import ref_dari_teks

    rt = _rt(cfg)
    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    gagal = 0
    for i, teks in enumerate(args.ref, 1):
        ref = ref_dari_teks(teks)
        label = f"#{i}"
        if ref is None:
            print(f"{label}: tidak dikenali (tempel ID video Konten.com atau link TikTok / Instagram / YouTube).")
            gagal += 1
            continue
        video = pipeline.dengan_replika(rt, lambda: rt.replika.cari_video(ref))
        if video is None:
            print(f"{label}: video tidak ditemukan di database Konten.com.")
            gagal += 1
            continue
        h = pipeline.proses_video(rt, video.id, scope=f"job:cli-{stamp}", video=video)
        cek = [c.get("hasil") for c in h.checklist]
        print(f"{label} Video #{h.video_id} · {h.campaign_title or h.campaign_id or '-'}")
        print(f"    status: {h.pipeline_status}" + (f" ({h.error})" if h.error else ""))
        print(f"    saran AI: {h.suggestion} (yakin {h.confidence})" + (f" — {h.official_reason}" if h.official_reason else ""))
        if h.specific_reason:
            print(f"    alasan: {h.specific_reason}")
        print(f"    checklist: {cek.count('lolos')} lolos · {cek.count('tidak')} tidak · {cek.count('tidak_bisa_dinilai')} tidak bisa dinilai")
        print(f"    musik: {(h.music or {}).get('status', '-')} · keputusan reviewer: {h.human_decision or '-'} · cocok: {h.match}")
        print(f"    biaya: ${h.cost_usd:.4f} (± Rp {h.cost_usd * cfg.kurs_idr:,.0f}) · waktu {h.process_sec} dtk")
    rt.replika.tutup()
    return OK if not gagal else GAGAL


def cmd_materi(cfg, args) -> int:
    from review_worker import pipeline
    from review_worker.media import materi

    rt = _rt(cfg, butuh_supa=True)
    campaign, brief = pipeline.brief_campaign(rt, args.campaign_id)
    ref = materi.siapkan_materi_campaign(rt, campaign, brief, paksa=bool(args.paksa),
                                         progres=lambda p, m: print(f"  {int(p * 100):>3}% {m}"))
    try:
        materi.proses_upload_manual(rt, args.campaign_id)
    except Exception as e:
        print(f"  sidik jari upload manual gagal: {e}")
    print(f"Materi campaign {args.campaign_id}: {ref.status}" + (f" — {ref.pesan}" if ref.pesan else ""))
    return OK


def cmd_laporan(cfg, args) -> int:
    from review_worker import laporan

    rt = _rt(cfg)
    path = laporan.simpan_laporan(rt, args.run_id)
    print(f"Laporan: {cfg.laporan / (args.run_id + '.html')}" + (f" (website: {path})" if path else ""))
    return OK


def cmd_jalan(cfg, args) -> int:
    from review_worker import antrian

    if not cfg.ada_supabase():
        return _kurang(cfg)
    return antrian.jalan(_rt(cfg))


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="review", description="Asisten Review Video (MODE UJI) — AI hanya menyarankan, reviewer memutuskan.")
    sub = p.add_subparsers(dest="perintah", required=True)
    sub.add_parser("cek", help="cek pengaturan & koneksi (tanpa biaya)")
    k = sub.add_parser("kenali-skema", help="daftar kolom schema alif → data/skema.json")
    k.add_argument("--nilai", action="store_true", help="juga nilai unik kolom status/aksi + nama key brief_detail (tanpa data pribadi)")
    sub.add_parser("sinkron-alasan", help="alasan reject resmi dari audit_log → Supabase")
    u = sub.add_parser("uji", help="uji akurasi pada keputusan lama")
    u.add_argument("--jumlah", type=int)
    u.add_argument("--seed", type=int)
    u.add_argument("--label")
    u.add_argument("--lanjut", metavar="RUN")
    u.add_argument("--ulang", metavar="RUN")
    u.add_argument("--dari", metavar="YYYY-MM-DD")
    u.add_argument("--sampai", metavar="YYYY-MM-DD")
    v = sub.add_parser("video", help="uji manual video tertentu")
    v.add_argument("ref", nargs="+", help="id video Konten.com atau link video")
    m = sub.add_parser("materi", help="siapkan materi referensi campaign")
    m.add_argument("campaign_id")
    m.add_argument("--paksa", action="store_true")
    lp = sub.add_parser("laporan", help="buat ulang laporan HTML satu run")
    lp.add_argument("run_id")
    sub.add_parser("jalan", help="tunggu antrian dari website")
    return p


PERINTAH = {"cek": cmd_cek, "kenali-skema": cmd_kenali, "sinkron-alasan": cmd_sinkron, "uji": cmd_uji, "video": cmd_video,
            "materi": cmd_materi, "laporan": cmd_laporan, "jalan": cmd_jalan}


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    cfg = config.load()
    from review_worker import log as rlog
    from review_worker.kolom import KolomError
    from review_worker.replika import ReplikaError
    from review_worker.supa import SupaError

    rlog.setup(cfg.logs)
    try:
        return PERINTAH[args.perintah](cfg, args)
    except SystemExit as e:
        return int(e.code or 0)
    except (KolomError, ReplikaError, SupaError) as e:
        print(f"GAGAL: {e}")
        return GAGAL
    except NotImplementedError as e:
        print(f"Bagian ini belum terpasang di versi ini ({e}). Ambil update terbaru (git pull).")
        return GAGAL
    except KeyboardInterrupt:
        print("Dihentikan.")
        return GAGAL
    except Exception as e:  # pesan awam; detail di log
        rlog.get("cli").exception("Perintah %s error", args.perintah)
        print(f"GAGAL: {type(e).__name__}: {rlog.saring(str(e))[:300]} (detail di data\\logs)")
        return GAGAL


if __name__ == "__main__":
    sys.exit(main())
