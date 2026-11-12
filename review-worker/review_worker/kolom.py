"""Pemetaan kolom DB replika (pemilik: worker-inti). Isi dari kolom.toml (bisa diedit user sesudah `review kenali-skema`).
Nama kolom SEBENARNYA belum diketahui → tiap query lewat sini; kolom wajib tidak ada → KolomError dengan pesan awam
("Kolom alif.tracked_videos.video_url tidak ada. Jalankan: review kenali-skema, lalu sesuaikan kolom.toml").

Sesudah tersambung, replika.py memanggil `sesuaikan(skema)`: kolom OPSIONAL yang tidak ada di DB dibuang dari pemetaan (dicatat),
tabel opsional (staff / appeals / history) yang tidak ada → dimatikan; kolom WAJIB tidak ada → KolomError."""
from __future__ import annotations

import difflib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

try:
    import tomllib  # Python ≥ 3.11
except ModuleNotFoundError:  # pragma: no cover
    tomllib = None  # type: ignore[assignment]

# kolom wajib per tabel logis (kunci kiri di kolom.toml). Tabel tanpa daftar di TABEL_WAJIB = opsional (boleh tidak ada).
WAJIB: dict[str, list[str]] = {
    "videos": ["id", "campaign_id", "url", "status"],
    "campaigns": ["id", "brief_detail"],
    "audit": ["action", "details", "created_at", "target_id"],
    "appeals": ["video_id", "status"],
    "staff": ["id"],
    "history": ["video_id", "status"],
}
TABEL_WAJIB = ("videos", "campaigns", "audit")
TABEL_BAWAAN = {"videos": "tracked_videos", "campaigns": "campaigns", "audit": "audit_log", "staff": "staff", "appeals": "appeals",
                "history": "video_status_history"}
# cadangan kalau kunci [nilai] tidak ada di kolom.toml — nilai ASLI Konten.com (kenali-skema --nilai, 12-11-2026)
NILAI_BAWAAN: dict[str, list[str]] = {
    "status_approve": ["approved", "approved_flag"],
    "status_reject": ["rejected"],
    "audit_approve": ["video_approve"],
    "audit_reject": ["video_reject"],
    "banding_dibatalkan": ["granted"],
    "banding_dikuatkan": ["denied", "resubmit_allowed"],  # resubmit_allowed = penolakan tetap (clipper boleh kirim ulang)
    "banding_menunggu": ["under_review"],
    "banding_target": [],  # appeals.target_type untuk banding video; kosong = tidak disaring
}
SARAN_EDIT = "Jalankan: review kenali-skema, lalu sesuaikan kolom.toml"


class KolomError(Exception):
    """pemetaan kolom tidak cocok dengan DB replika — pesan sudah awam"""


@dataclass
class Kolom:
    schema: str = "alif"
    tabel: dict[str, str] = field(default_factory=dict)  # kunci logis → nama tabel: videos, campaigns, audit, staff, appeals, history
    kolom: dict[str, dict[str, str]] = field(default_factory=dict)  # kunci logis tabel → {kunci logis kolom → nama kolom}
    wajib: dict[str, list[str]] = field(default_factory=dict)  # kunci logis tabel → kunci kolom wajib
    nilai: dict[str, dict[str, list[str]]] = field(default_factory=dict)  # mis. status approve/reject, action audit, hasil banding
    mati: set = field(default_factory=set)  # tabel opsional yang tidak ada di DB (diisi sesuaikan)
    catatan: list = field(default_factory=list)  # kolom opsional yang dibuang (untuk log `review cek`)
    asli: dict = field(default_factory=dict)  # salinan pemetaan dari kolom.toml (validasi tetap melihat kolom yang sudah dibuang)

    def nama(self, t: str) -> str:
        """nama tabel asli (tanpa schema)"""
        if t not in self.tabel:
            raise KolomError(f"Tabel '{t}' tidak ada di kolom.toml [tabel]. {SARAN_EDIT}")
        return self.tabel[t]

    def ada(self, t: str) -> bool:
        """tabel dipetakan & ada di DB (tabel opsional yang tidak ada → False)"""
        return t in self.tabel and t not in self.mati

    def tbl(self, t: str):
        """nama tabel lengkap ber-kutip, mis. '"alif"."tracked_videos"' (psycopg.sql.Identifier)"""
        from psycopg import sql

        if t in self.mati:
            raise KolomError(f"Tabel {self.schema}.{self.tabel.get(t, t)} tidak ada di database Konten.com. {SARAN_EDIT}")
        return sql.Identifier(self.schema, self.nama(t))

    def col(self, t: str, c: str, wajib: bool = True) -> Optional[str]:
        """nama kolom asli; tidak dipetakan & wajib → KolomError; opsional → None"""
        v = (self.kolom.get(t) or {}).get(c)
        if v:
            return v
        if wajib:
            raise KolomError(f"Kolom {self.schema}.{self.tabel.get(t, t)}.{c} belum dipetakan di kolom.toml [{t}]. {SARAN_EDIT}")
        return None

    def val(self, k: str) -> list[str]:
        """daftar nilai [nilai] (huruf kecil), mis. val("audit_reject") → ["video_reject"]"""
        return [str(x).strip().lower() for x in (self.nilai.get("nilai", {}).get(k) or NILAI_BAWAAN.get(k, [])) if str(x).strip()]

    def validasi(self, skema: dict[str, list[str]]) -> list[str]:
        """skema = {tabel: [kolom…]} hasil information_schema → daftar masalah (kalimat awam); kosong = cocok"""
        masalah: list[str] = []
        peta_asli = self.asli or self.kolom
        for t, nama in self.tabel.items():
            ada = skema.get(nama)
            wajib_tbl = t in TABEL_WAJIB
            if ada is None:
                if wajib_tbl:
                    masalah.append(f"Tabel {self.schema}.{nama} tidak ada.{_mirip(nama, list(skema))}")
                else:
                    masalah.append(f"(opsional) Tabel {self.schema}.{nama} tidak ada — fitur terkait dimatikan.{_mirip(nama, list(skema))}")
                continue
            for c, col in (peta_asli.get(t) or {}).items():
                if col in ada:
                    continue
                wajib = c in (self.wajib.get(t) or [])
                awal = "" if wajib else "(opsional) "
                masalah.append(f"{awal}Kolom {self.schema}.{nama}.{col} tidak ada (kunci [{t}] {c}).{_mirip(col, ada)}")
            for c in self.wajib.get(t) or []:
                if c not in (peta_asli.get(t) or {}):
                    masalah.append(f"Kolom wajib [{t}] {c} belum dipetakan di kolom.toml.")
        return masalah

    def sesuaikan(self, skema: dict[str, list[str]]) -> None:
        """pakai hasil information_schema: buang kolom opsional yang tidak ada, matikan tabel opsional yang tidak ada,
        KolomError untuk yang wajib (pesan pertama yang paling penting)"""
        wajib_hilang: list[str] = []
        for t, nama in list(self.tabel.items()):
            ada = skema.get(nama)
            if ada is None:
                if t in TABEL_WAJIB:
                    wajib_hilang.append(f"Tabel {self.schema}.{nama} tidak ada di database Konten.com.{_mirip(nama, list(skema))}")
                else:
                    self.mati.add(t)
                    self.catatan.append(f"tabel {nama} tidak ada (dimatikan)")
                continue
            peta = self.kolom.get(t) or {}
            for c, col in list(peta.items()):
                if col in ada:
                    continue
                if c in (self.wajib.get(t) or []):
                    if t in TABEL_WAJIB:
                        wajib_hilang.append(f"Kolom {self.schema}.{nama}.{col} tidak ada.{_mirip(col, ada)}")
                    else:  # tabel opsional dengan kolom wajib hilang → tabelnya dimatikan
                        self.mati.add(t)
                        self.catatan.append(f"tabel {nama}: kolom {col} tidak ada (dimatikan)")
                else:
                    peta.pop(c)
                    self.catatan.append(f"kolom {nama}.{col} tidak ada (dilewati)")
        if wajib_hilang:
            raise KolomError(" ".join(wajib_hilang) + f" {SARAN_EDIT}")


def _mirip(nama: str, pilihan: list[str]) -> str:
    m = difflib.get_close_matches(nama, pilihan, n=3, cutoff=0.5)
    return f" Mungkin maksudnya: {', '.join(m)}." if m else ""


def dari_dict(d: dict[str, Any]) -> Kolom:
    tabel = {**TABEL_BAWAAN, **{k: str(v) for k, v in (d.get("tabel") or {}).items() if v}}
    kolom = {t: {k: str(v) for k, v in (d.get(t) or {}).items() if isinstance(v, str) and v.strip()} for t in tabel}
    nilai = {"nilai": {k: [str(x) for x in (v if isinstance(v, list) else [v])] for k, v in (d.get("nilai") or {}).items()}}
    wajib = {t: list(WAJIB.get(t, [])) for t in tabel}
    for t, c in (d.get("wajib") or {}).items():  # opsional: [wajib] videos = ["id", ...]
        if isinstance(c, list):
            wajib[t] = [str(x) for x in c]
    return Kolom(schema=str(d.get("schema") or "alif"), tabel=tabel, kolom=kolom, wajib=wajib, nilai=nilai,
                 asli={t: dict(c) for t, c in kolom.items()})


def muat(path: Path) -> Kolom:
    """baca kolom.toml (tomllib). File tidak ada / rusak → KolomError"""
    if tomllib is None:  # pragma: no cover
        raise KolomError("Python terlalu lama (butuh 3.11+). Jalankan install.ps1 lagi.")
    try:
        raw = Path(path).read_bytes()
    except OSError:
        raise KolomError(f"File pemetaan kolom tidak ada: {path}. Ambil lagi dari GitHub (git pull) atau salin dari repo.") from None
    try:
        d = tomllib.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, tomllib.TOMLDecodeError) as e:
        raise KolomError(f"kolom.toml rusak / salah tulis ({str(e)[:120]}). Periksa tanda kutip & tanda = di baris itu.") from None
    return dari_dict(d)
