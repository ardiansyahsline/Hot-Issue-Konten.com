"""Isi bersama selama worker hidup (pemilik: worker-inti). Model berat (ASR, OCR) dimuat malas oleh worker-media
lewat rt.cache (dict) dan dilepas saat lama menganggur / voice-worker butuh GPU (lepas_model)."""
from __future__ import annotations

import gc
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from . import VERSION
from . import log as rlog

log = rlog.get("runtime")
SINGKAT = ["video", "materi", "sinkron"]  # pekerjaan pendek yang boleh diselipkan di antara video uji
MODEL_BERAT = ("asr", "ocr", "demucs")  # kunci rt.cache yang punya .tutup() (worker-media)


@dataclass
class Runtime:
    cfg: Any  # config.Cfg
    supa: Any  # supa.Supa (None di mode CLI tanpa Supabase → hasil hanya ke data/hasil-lokal.jsonl)
    replika: Any  # replika.Replika
    gpu: Any  # gpu_bersama.KunciGPU("review-worker")
    budget: Any = None  # biaya.Budget (hakim-ai)
    hakim: Any = None  # hakim.Hakim (hakim-ai), dibuat malas
    rubrik: Any = None  # skema.Rubrik aktif
    cache: dict = field(default_factory=dict)  # model ASR/OCR, brief per campaign, referensi per campaign
    status: dict = field(default_factory=lambda: {"status": "siap", "job": None})
    job: Optional[Any] = None  # JobCtx yang sedang jalan
    # --- tambahan worker-inti
    stop: threading.Event = field(default_factory=threading.Event)  # Ctrl+C sekali → berhenti sesudah video ini
    ai_status: str = ""  # "ok" / "kunci_kosong" / "gagal" (diisi hakim-ai kalau mau; kosong = ditebak dari kunci)
    terakhir_gpu: float = field(default_factory=time.monotonic)  # terakhir model GPU dipakai (lepas sesudah menganggur)
    _menyelip: bool = False
    _info_cache: dict = field(default_factory=dict)

    def selipkan(self) -> int:
        """dipanggil uji.jalankan_uji DI ANTARA video: kerjakan pekerjaan pendek yang antri (video / materi / sinkron) sampai habis
        (klaim review_claim_job dengan p_kinds tanpa 'uji'). Balikan jumlah yang dikerjakan."""
        if self.supa is None or self._menyelip or self.stop.is_set():
            return 0
        from . import antrian
        from .supa import SupaError

        n = 0
        self._menyelip = True
        simpan_status, simpan_job = dict(self.status), self.job
        try:
            while not self.stop.is_set() and n < 50:
                try:
                    job = self.supa.klaim_job(SINGKAT)
                except SupaError as e:
                    log.warning("Cek pekerjaan pendek gagal (%s) — uji dilanjutkan.", str(e)[:120])
                    break
                if not job:
                    break
                log.info("Menyelipkan pekerjaan %s di sela uji.", job.get("kind"))
                antrian.tangani(self, job)
                n += 1
        finally:
            self.status, self.job = simpan_status, simpan_job
            self._menyelip = False
        return n

    # ------------------------------------------------------------------ hakim (dibuat malas: impor anthropic hanya saat perlu)
    def siapkan_hakim(self):
        if self.hakim is not None:
            return self.hakim
        from . import alasan, biaya, hakim, rubrik

        if self.budget is None:
            self.budget = biaya.Budget(self.cfg, self.supa, self.cfg.data)
        if self.rubrik is None:
            self.rubrik = rubrik.muat_rubrik(getattr(self.cfg, "rubrik", "") or None)
        label = None
        if self.supa is not None:
            try:
                label = alasan.muat_daftar(self.supa)
            except Exception as e:  # daftar alasan resmi belum disinkron → label bawaan
                log.info("Daftar alasan resmi belum bisa dibaca (%s) — pakai label bawaan.", str(e)[:100])
        self.hakim = hakim.Hakim(self.cfg, self.budget, self.rubrik, label_alasan=label)
        return self.hakim

    # ------------------------------------------------------------------ GPU / model
    def lepas_model(self, alasan: str = "") -> int:
        """lepas model ASR / OCR / Demucs dari VRAM (voice-worker butuh GPU / lama menganggur)"""
        n = 0
        for k in MODEL_BERAT:
            obj = self.cache.pop(k, None)
            if obj is None:
                continue
            n += 1
            try:
                tutup = getattr(obj, "tutup", None)
                if callable(tutup):
                    tutup()
            except Exception as e:
                log.debug("lepas %s gagal: %s", k, e)
        if n:
            gc.collect()
            torch = sys.modules.get("torch")
            try:
                if torch is not None and torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass
            log.info("Model GPU dilepas (%s)%s.", n, f" — {alasan}" if alasan else "")
        return n

    def cek_gpu_bersama(self) -> None:
        """dipanggil antar video: voice-worker sudah > 2x berturut-turut harus ditunggu → model dilepas (VRAM 8 GB)"""
        try:
            if getattr(self.gpu, "mengalah", 0) > 2 and any(k in self.cache for k in MODEL_BERAT):
                self.lepas_model("voice-worker butuh GPU")
                self.gpu.mengalah = 0
        except Exception:
            pass

    # ------------------------------------------------------------------ detak jantung (format KONTRAK.md §1.6)
    def info_detak(self) -> dict:
        c = self._info_cache
        if "gpu" not in c:
            c["gpu"] = info_gpu()
        if "musik" not in c:
            c["musik"] = mesin_musik(self.cfg)
        st = dict(self.status)
        if getattr(self.gpu, "menunggu", False) and st.get("status") not in ("berhenti_biaya", "mati"):
            st["status"] = "menunggu_gpu"
        budget = c.get("budget")
        if self.budget is not None and (budget is None or time.monotonic() - c.get("budget_t", 0) > 60):
            try:
                budget = {"usd_hari_ini": round(float(self.budget.terpakai()), 4), "batas": self.cfg.daily_budget_usd}
            except Exception:
                budget = budget or {"usd_hari_ini": None, "batas": self.cfg.daily_budget_usd}
            c["budget"], c["budget_t"] = budget, time.monotonic()
        ai = self.ai_status or ("ok" if self.cfg.anthropic_key_ada else "kunci_kosong")
        ocr = "mati" if self.cfg.ocr == "mati" else ("easyocr-gpu" if c["gpu"].get("nama") else "easyocr-cpu")
        o = self.cache.get("ocr")
        if o is not None and getattr(o, "perangkat", None) in ("gpu", "cpu", "cuda"):
            ocr = "easyocr-cpu" if getattr(o, "perangkat") == "cpu" else "easyocr-gpu"
        return {
            "status": st.get("status", "siap"),
            "job": st.get("job"),
            "versi": VERSION,
            "gpu": c["gpu"],
            "db": getattr(self.replika, "status_db", "belum_dicek") if self.replika is not None else "belum_dicek",
            "ai": ai,
            "musik": c["musik"],
            "ocr": ocr,
            "budget": budget or {"usd_hari_ini": None, "batas": self.cfg.daily_budget_usd},
            "rubric_version": getattr(self.rubrik, "versi", None),
        }


def info_gpu() -> dict:
    """nama + VRAM GPU NVIDIA lewat nvidia-smi (tanpa memuat torch di proses utama); tidak ada → {nama: None}"""
    torch = sys.modules.get("torch")
    try:
        if torch is not None and torch.cuda.is_available():
            p = torch.cuda.get_device_properties(0)
            return {"nama": torch.cuda.get_device_name(0), "vram_gb": round(p.total_memory / 1024**3)}
    except Exception:
        pass
    exe = shutil.which("nvidia-smi")
    if not exe:
        return {"nama": None, "vram_gb": None}
    try:
        kw: dict = {"capture_output": True, "text": True, "timeout": 10}
        if sys.platform == "win32":
            kw["creationflags"] = 0x08000000  # tanpa jendela
        out = subprocess.run([exe, "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], **kw).stdout.strip().splitlines()
        nama, mem = [x.strip() for x in out[0].split(",")[:2]]
        return {"nama": nama, "vram_gb": round(float(mem) / 1024)}
    except Exception:
        return {"nama": None, "vram_gb": None}


def mesin_musik(cfg) -> str:
    """mesin musik yang siap (panako / olaf / chroma / tidak_ada) — dari worker-media; error → tidak_ada"""
    if getattr(cfg, "musik", "") == "mati":
        return "tidak_ada"
    try:
        from .media import musik

        m, _ = musik.cek_mesin(cfg)
        return m if m in ("panako", "olaf", "chroma", "tidak_ada") else "tidak_ada"
    except Exception:
        return "tidak_ada"
