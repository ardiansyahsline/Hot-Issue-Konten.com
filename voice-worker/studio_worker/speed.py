"""
Catatan kecepatan mesin suara laptop — dipakai untuk:
  - batas waktu per baris & jumlah versi yang masih muat (jobs_tts),
  - perkiraan waktu selesai job di Studio (pesan job "· sisa ±40 dtk" + info.speed di detak jantung),
  - laporan cepat/lambat di log.

Satuan utamanya `ratio` = detik proses per detik suara jadi, untuk n versi yang dibuat SEKALIGUS (batch). Nilai disimpan sebagai
rata-rata bergerak (EMA) per mesin & jumlah versi di data/speed.json, jadi perkiraan sudah masuk akal sejak job pertama sesudah
worker dinyalakan ulang. Belum ada data → perkiraan kasar dari PRIOR (sengaja pesimis supaya perkiraan tidak terlalu optimis).
"""
from __future__ import annotations

import json
import math
import os
import threading
import time
from pathlib import Path

# ±14,5 huruf per detik bicara bahasa Indonesia (sama dengan jobs_tts.score_take / take_budget)
CHARS_PER_SEC = 14.5
# detik proses per detik suara kalau belum pernah diukur (1 versi). Chatterbox lama di RTX 5050: ±4,9 (6,5 dtk suara = 32 dtk)
PRIOR = {"chatterbox": 4.0, "pocket": 1.5}
PRIOR_OTHER = 3.0
# tiap versi tambahan dalam satu batch kira-kira menambah sekian kali waktu 1 versi (GPU: batch hampir gratis; CPU: hampir linear)
BATCH_EXTRA = {"chatterbox": 0.25, "pocket": 1.0}
EMA = 0.3  # bobot pengukuran baru
MAX_N = 6


def est_audio_sec(chars: int) -> float:
    """perkiraan panjang suara (detik) dari jumlah huruf teks ucapan"""
    return max(0.6, float(chars) / CHARS_PER_SEC)


def fmt_left(sec: float) -> str:
    """'40 dtk' / '2 mnt' — dibulatkan supaya tidak berkedip tiap detik (dipakai pesan job; website membaca pola ini)"""
    s = max(0.0, float(sec))
    if s < 60:
        return f"{max(5, int(math.ceil(s / 5.0)) * 5)} dtk"
    return f"{int(round(s / 60.0))} mnt"


class Speed:
    def __init__(self, path: Path | None = None):
        self.path = Path(path) if path else None
        self.lock = threading.Lock()
        # {engine: {"r": {"1": ratio, "3": ratio}, "load": detik muat model, "n": jumlah ukuran, "at": epoch}}
        self.data: dict = {}
        self._load()

    # ------------------------------------------------------------------ simpan
    def _load(self) -> None:
        if not self.path:
            return
        try:
            d = json.loads(self.path.read_text(encoding="utf-8"))
            self.data = d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            self.data = {}

    def _save(self) -> None:
        if not self.path:
            return
        try:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError:
            pass  # catatan kecepatan tidak boleh mengganggu job

    # ------------------------------------------------------------------ catat
    def record(self, engine: str, audio_sec: float, wall_sec: float, takes: int = 1) -> None:
        """satu batch selesai: `takes` versi berisi total ±audio_sec detik suara PER VERSI, butuh wall_sec detik"""
        if not (audio_sec > 0.3 and wall_sec > 0 and math.isfinite(audio_sec) and math.isfinite(wall_sec)):
            return
        n = str(max(1, min(MAX_N, int(takes))))
        ratio = wall_sec / audio_sec
        with self.lock:
            e = self.data.setdefault(engine, {})
            r = e.setdefault("r", {})
            old = r.get(n)
            r[n] = round(ratio if not isinstance(old, (int, float)) else (1 - EMA) * float(old) + EMA * ratio, 4)
            e["n"] = int(e.get("n") or 0) + 1
            e["at"] = int(time.time())
            self._save()

    def record_load(self, engine: str, sec: float) -> None:
        if sec > 0 and math.isfinite(sec):
            with self.lock:
                self.data.setdefault(engine, {})["load"] = round(float(sec), 1)
                self._save()

    # ------------------------------------------------------------------ perkiraan
    def ratio(self, engine: str, takes: int = 1) -> float:
        """detik proses per detik suara untuk `takes` versi sekaligus (hasil ukur kalau ada, selain itu turunan dari ukuran lain / PRIOR)"""
        n = max(1, min(MAX_N, int(takes)))
        extra = BATCH_EXTRA.get(engine, 0.5)
        with self.lock:
            r = dict((self.data.get(engine) or {}).get("r") or {})
        if isinstance(r.get(str(n)), (int, float)):
            return float(r[str(n)])
        known = [(int(k), float(v)) for k, v in r.items() if str(k).isdigit() and isinstance(v, (int, float))]
        if known:  # skala dari jumlah versi terdekat yang sudah diukur
            k, v = min(known, key=lambda kv: abs(kv[0] - n))
            return v * (1 + extra * (n - 1)) / (1 + extra * (k - 1))
        return PRIOR.get(engine, PRIOR_OTHER) * (1 + extra * (n - 1))

    def measured(self, engine: str) -> bool:
        with self.lock:
            return bool((self.data.get(engine) or {}).get("r"))

    def estimate(self, engine: str, chars: int, takes: int = 1) -> float:
        """perkiraan detik membuat `takes` versi untuk teks sepanjang `chars` huruf (sekaligus)"""
        return est_audio_sec(chars) * self.ratio(engine, takes)

    def load_sec(self, engine: str) -> float | None:
        with self.lock:
            v = (self.data.get(engine) or {}).get("load")
        return float(v) if isinstance(v, (int, float)) else None

    def summary(self) -> dict:
        """ringkasan untuk detak jantung (studio_workers.info.speed): website memakai `ratio` untuk perkiraan job yang masih antri"""
        out = {}
        with self.lock:
            items = list(self.data.items())
        for eng, e in items:
            r = e.get("r") or {}
            out[eng] = {"ratio": {k: round(float(v), 2) for k, v in r.items() if isinstance(v, (int, float))}, "load": e.get("load"), "n": e.get("n")}
        return {"chars_per_sec": CHARS_PER_SEC, "engines": out}
