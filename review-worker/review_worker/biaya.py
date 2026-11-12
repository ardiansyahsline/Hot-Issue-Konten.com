"""Harga Claude Haiku 5.5 + batas biaya harian (pemilik: hakim-ai). KONTRAK.md §5.5.
Harga per 1 juta token (prompt ≤ 100K): input $0,10 · output $0,50 · baca cache 0,1× · tulis cache 5 mnt 1,25× · 1 jam 2×.
Prompt > 100K token: $0,50 / $2,50 (pengali sama). Hari = tanggal WIB (Asia/Jakarta)."""
from __future__ import annotations

import json
import os
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from . import log as rlog
from .skema import PemakaianAI

log = rlog.get("biaya")

HARGA = {"input": 0.10, "output": 0.50, "baca_cache": 0.1, "tulis_5m": 1.25, "tulis_1h": 2.0, "batas_prompt": 100_000, "pengali_panjang": 5.0}
# WIB tanpa musim panas → offset tetap (Windows tanpa paket tzdata tidak punya database zona waktu)
WIB = timezone(timedelta(hours=7), "WIB")
SIMPAN_HARI = 45  # riwayat biaya lokal yang disimpan
CACHE_REMOTE_DETIK = 20.0


class AnggaranHabis(Exception):
    """batas REVIEW_DAILY_BUDGET_USD hari ini tercapai — pesan awam"""


def _ambil(obj: Any, nama: str) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(nama)
    return getattr(obj, nama, None)


def _int(v: Any) -> int:
    try:
        return max(0, int(v or 0))
    except (TypeError, ValueError):
        return 0


def hitung_biaya(usage: Any, model: str, effort: str, detik: float = 0.0, stop_reason: Optional[str] = None,
                 request_id: Optional[str] = None) -> PemakaianAI:
    """usage = response.usage SDK (input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
    cache_creation.ephemeral_1h_input_tokens / ephemeral_5m_input_tokens; field hilang = 0)"""
    inp = _int(_ambil(usage, "input_tokens"))
    out = _int(_ambil(usage, "output_tokens"))
    baca = _int(_ambil(usage, "cache_read_input_tokens"))
    tulis = _int(_ambil(usage, "cache_creation_input_tokens"))
    cc = _ambil(usage, "cache_creation")
    w1h = _int(_ambil(cc, "ephemeral_1h_input_tokens"))
    w5m = _int(_ambil(cc, "ephemeral_5m_input_tokens"))
    if cc is None or (w1h + w5m == 0 and tulis > 0):
        w1h, w5m = tulis, 0  # rincian TTL tidak ada → anggap 1 jam (kita hanya memakai ttl 1h; perkiraan aman / lebih mahal)
    elif w1h + w5m < tulis:
        w1h += tulis - (w1h + w5m)
    prompt = inp + baca + w1h + w5m
    kali = HARGA["pengali_panjang"] if prompt > HARGA["batas_prompt"] else 1.0
    harga_in = HARGA["input"] * kali
    usd = (inp * harga_in + out * HARGA["output"] * kali + baca * harga_in * HARGA["baca_cache"]
           + w5m * harga_in * HARGA["tulis_5m"] + w1h * harga_in * HARGA["tulis_1h"]) / 1_000_000
    return PemakaianAI(input=inp, output=out, cache_read=baca, cache_write_1h=w1h, cache_write_5m=w5m, biaya_usd=round(usd, 8),
                       model=model or "", effort=effort or "", stop_reason=stop_reason, request_id=request_id, detik=round(float(detik or 0), 3))


def hari_wib(now: Optional[datetime] = None) -> date:
    return (now or datetime.now(timezone.utc)).astimezone(WIB).date()


class Budget:
    def __init__(self, cfg, supa, data_dir: Path):
        self.cfg = cfg
        self.supa = supa
        self.file = Path(data_dir) / "biaya-harian.json"
        self._lock = threading.RLock()
        self._remote: tuple[str, float, float] = ("", 0.0, 0.0)  # (hari, usd, waktu monotonic)
        self.now = lambda: datetime.now(timezone.utc)  # bisa diganti tes

    @property
    def batas(self) -> float:
        try:
            return float(getattr(self.cfg, "daily_budget_usd", 2.0))
        except (TypeError, ValueError):
            return 2.0

    def hari_ini(self) -> date:
        return hari_wib(self.now())

    # ------------------------------------------------------------------ file lokal data/biaya-harian.json
    def _baca(self) -> dict:
        try:
            d = json.loads(self.file.read_text(encoding="utf-8"))
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def _tulis(self, d: dict) -> None:
        hari = sorted(k for k in d if len(k) == 10)
        for k in hari[:-SIMPAN_HARI]:
            d.pop(k, None)
        try:
            self.file.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.file.with_suffix(".tmp")
            tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
            os.replace(tmp, self.file)
        except OSError as e:
            log.warning("Catatan biaya lokal tidak bisa disimpan (%s).", e)

    def _lokal(self, hari: str) -> float:
        try:
            return float((self._baca().get(hari) or {}).get("usd") or 0.0)
        except (TypeError, ValueError):
            return 0.0

    def _remote_usd(self, hari: str, paksa: bool = False) -> Optional[float]:
        if self.supa is None:
            return None
        h, usd, t = self._remote
        if not paksa and h == hari and time.monotonic() - t < CACHE_REMOTE_DETIK:
            return usd
        try:
            rows = self.supa.select("review_usage_daily", select="cost_usd", day=f"eq.{hari}") or []
            usd = float(rows[0].get("cost_usd") or 0) if rows else 0.0
        except Exception as e:
            log.debug("biaya Supabase tidak terbaca: %s", e)
            return None
        self._remote = (hari, usd, time.monotonic())
        return usd

    def terpakai(self) -> float:
        """USD hari ini (Supabase review_usage_daily; Supabase putus → data/biaya-harian.json)"""
        hari = self.hari_ini().isoformat()
        with self._lock:
            lokal = self._lokal(hari)
            remote = self._remote_usd(hari)
        return max(lokal, remote or 0.0)  # tidak pernah kurang dari catatan laptop sendiri

    def cek(self, perkiraan_usd: float = 0.004) -> None:
        """terpakai + perkiraan > batas → AnggaranHabis (dicek SEBELUM tiap panggilan AI)"""
        batas = self.batas
        pakai = self.terpakai()
        if pakai + max(0.0, perkiraan_usd) > batas:
            raise AnggaranHabis(f"Batas biaya harian ${batas:g} tercapai (terpakai ${pakai:.2f}) — klik Lanjutkan besok.")

    def catat(self, p: PemakaianAI) -> float:
        """tambah ke Supabase (rpc review_add_usage) + file lokal; balikan total hari ini"""
        hari = self.hari_ini().isoformat()
        tulis = int(p.cache_write_1h) + int(p.cache_write_5m)
        with self._lock:
            d = self._baca()
            e = d.setdefault(hari, {})
            e["usd"] = round(float(e.get("usd") or 0) + float(p.biaya_usd), 8)
            for k, v in (("calls", 1), ("input", p.input), ("output", p.output), ("cache_read", p.cache_read), ("cache_write", tulis)):
                e[k] = int(e.get(k) or 0) + int(v)
            # yang belum terkirim ke Supabase (dikirim bersama panggilan berikutnya)
            t = e.setdefault("tertunda", {})
            t["usd"] = round(float(t.get("usd") or 0) + float(p.biaya_usd), 8)
            for k, v in (("calls", 1), ("input", p.input), ("output", p.output), ("cache_read", p.cache_read), ("cache_write", tulis)):
                t[k] = int(t.get(k) or 0) + int(v)
            self._tulis(d)
            lokal = float(e["usd"])
            remote = self._kirim_tertunda(d)
        return max(lokal, remote or 0.0)

    def _kirim_tertunda(self, d: dict) -> Optional[float]:
        """kirim semua hari yang masih tertunda ke rpc review_add_usage; balikan total hari ini menurut Supabase"""
        if self.supa is None:
            return None
        hari_ini = self.hari_ini().isoformat()
        total_hari_ini: Optional[float] = None
        for hari in sorted(k for k in d if len(k) == 10):
            t = (d.get(hari) or {}).get("tertunda")
            if not t or not (t.get("calls") or t.get("usd")):
                continue
            try:
                tot = self.supa.tambah_biaya(hari, float(t.get("usd") or 0), int(t.get("calls") or 0), int(t.get("input") or 0),
                                             int(t.get("output") or 0), int(t.get("cache_read") or 0), int(t.get("cache_write") or 0))
            except Exception as e:
                log.warning("Biaya belum terkirim ke Supabase (%s) — dicatat di laptop, dikirim nanti.", str(e)[:120])
                self._tulis(d)  # hari yang sudah terkirim jangan dikirim dua kali
                return total_hari_ini
            d[hari].pop("tertunda", None)
            if hari == hari_ini:
                total_hari_ini = float(tot or 0)
                self._remote = (hari, total_hari_ini, time.monotonic())
        self._tulis(d)
        return total_hari_ini
