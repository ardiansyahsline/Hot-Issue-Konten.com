"""Hakim AI = Claude Haiku 5.5 lewat Anthropic API langsung (SDK resmi `anthropic`) (pemilik: hakim-ai). KONTRAK.md §5.1.
Kunci: env ANTHROPIC_API_KEY (dibaca SDK). Kunci kosong → nilai() mengembalikan cek_manusia + serah "ai_gagal" (tanpa crash).
Susunan prompt (urutan WAJIB, untuk cache): system[0] = rubrik (cache_control ephemeral ttl 1h), system[1] = brief campaign
(cache 1h), messages[0].user = frame (gambar base64 JPEG + label "Frame N · detik T") lalu satu blok teks JSON materi.
Keluaran: output_config.format json_schema dari skema.KeputusanAI (+ effort REVIEW_EFFORT, bawaan medium). Tanpa temperature,
tanpa prefill, tanpa fallbacks. stop_reason "refusal" / "max_tokens" / JSON tidak valid → cek_manusia. Usage (cache_read /
cache_creation) dicatat ke log + PemakaianAI."""
from __future__ import annotations

import base64
import copy
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Optional

from pydantic import ValidationError

from . import log as rlog
from .aturan import cek_kode, terapkan_aturan
from .biaya import hitung_biaya
from .brief import jenis_materi_poin, teks_brief_untuk_prompt
from .privasi import bersihkan_teks
from .skema import BriefCampaign, KeputusanAI, MateriVideo, PemakaianAI, PenilaianFinal, ReferensiCampaign, Rubrik

log = rlog.get("hakim")

MAX_TOKENS = {"low": 8000, "medium": 8000, "high": 12000, "xhigh": 16000, "max": 16000}  # thinking ikut dihitung
TIMEOUT_DETIK = 180.0
MAKS_FRAME = 10
MAKS_GAMBAR_BYTE = 4_500_000  # batas API 5 MB per gambar
MAKS_TRANSKRIP = 6000  # karakter
MAKS_OCR = 2500
PERKIRAAN_USD = 0.004  # dipakai Budget.cek sebelum panggilan (perkiraan atas, ±3× rata-rata)
JEDA_ULANG = 20.0  # detik sebelum mencoba lagi sekali (di luar retry bawaan SDK)

# penjelasan field untuk skema keluaran (skema.KeputusanAI FINAL; deskripsi ditambah di sini, tidak mengubah validasi)
_DESKRIPSI = {
    "KeputusanAI": "Keputusan saran untuk satu video. AI hanya menyarankan; reviewer manusia yang memutuskan.",
    "checklist": "Satu entri untuk SETIAP poin brief berlabel DINILAI AI (id persis dari brief), masing-masing sekali. "
                 "Jangan memasukkan poin yang dicek kode / data akun / butuh cek manusia.",
    "saran": "approve = semua poin wajib lolos dengan bukti; reject = ada poin wajib yang jelas tidak terpenuhi dengan bukti; "
             "cek_manusia = ragu, materi kurang, atau ada hal yang tidak bisa dinilai.",
    "alasan_kode": "Kode alasan reject resmi. WAJIB diisi bila saran reject; null bila approve.",
    "alasan_spesifik": "SATU kalimat bahasa Indonesia yang spesifik untuk video ini (sebut poin & bukti). Tanpa nama orang.",
    "keyakinan": "Seberapa yakin saranmu benar, bilangan bulat 0-100.",
    "condong": "Pendapatmu SENDIRI: kalau kamu yang harus memutuskan sekarang, video ini approve atau reject? SELALU diisi, juga "
               "saat saran cek_manusia. Abaikan poin BUTUH CEK MANUSIA (identitas orang) dan DATA AKUN: condong dihitung dari "
               "poin lain. fakta_kode wajib bernilai tidak = condong reject.",
    "keyakinan_condong": "Seberapa yakin condongmu benar (sama dengan keputusan reviewer berpengalaman), bilangan bulat 50-100: "
                         "50 = setengah-setengah / menebak, 70 = cukup yakin, 90 = sangat yakin. Jujur, jangan dinaikkan.",
    "ringkasan": "Maksimal 2 kalimat untuk reviewer: isi video & hal penting yang perlu dicek.",
    "CekPoinAI": "Hasil satu poin brief.",
    "poin_id": "id poin persis dari brief, mis. p03.",
    "hasil": "lolos = terpenuhi (untuk larangan: tidak dilanggar); tidak = jelas tidak terpenuhi / dilanggar; "
             "tidak_bisa_dinilai = materi video tidak cukup untuk memastikan.",
    "bukti": "WAJIB. Bukti konkret: 'frame 3 (detik 12.4): ...', 'transkrip 00:08: \"...\"', 'OCR frame 5: \"...\"', "
             "'musik: ...', 'caption: \"...\"'. Untuk tidak_bisa_dinilai: sebut apa yang kurang. Jangan menyebut nama orang.",
    "bukti_frame": "Nomor frame (1..N) yang menjadi bukti; kosong bila bukti bukan dari gambar.",
    "bukti_detik": "Detik video yang menjadi bukti (dari label frame / transkrip).",
}
_BUANG = ("title", "default", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern",
          "maxItems", "multipleOf")
_SKEMA: Optional[dict] = None
_KREDIT = re.compile(r"credit balance|billing|kredit|saldo", re.I)


def _ketat(s: Any, nama: Optional[str] = None) -> Any:
    """skema pydantic → bentuk structured outputs: additionalProperties false + semua properti required di tiap objek,
    tanpa batas angka / panjang (tidak didukung; dicek di kode), tanpa title/default, deskripsi ditambahkan"""
    if isinstance(s, list):
        return [_ketat(x) for x in s]
    if not isinstance(s, dict):
        return s
    out: dict = {}
    for k, v in s.items():
        if k in _BUANG:
            continue
        if k == "properties" and isinstance(v, dict):
            out[k] = {pk: _ketat(pv, pk) for pk, pv in v.items()}
        elif k == "$defs" and isinstance(v, dict):
            out[k] = {dk: _ketat(dv, dk) for dk, dv in v.items()}
        else:
            out[k] = _ketat(v)
    if isinstance(out.get("enum"), list) and out["enum"]:
        out.pop("type", None)  # enum saja (bentuk yang sama dengan anthropic.transform_schema)
    if nama in _DESKRIPSI and "$ref" not in out:
        out["description"] = _DESKRIPSI[nama]
    if out.get("type") == "object" and isinstance(out.get("properties"), dict):
        out["additionalProperties"] = False
        out["required"] = list(out["properties"].keys())
    return out


# field yang Optional di Pydantic (jawaban lama tetap terbaca) tapi WAJIB diisi AI → cabang null dibuang dari skema API
_WAJIB_ISI = ("condong", "keyakinan_condong")


def _tanpa_null(s: dict) -> dict:
    """{"anyOf": [X, {"type": "null"}], ...} → X (+ deskripsi)"""
    cabang = [c for c in s.get("anyOf") or [] if c.get("type") != "null"]
    if len(cabang) != 1:
        return s
    out = dict(cabang[0])
    if "description" in s:
        out["description"] = s["description"]
    return out


def skema_keputusan() -> dict:
    """JSON schema keluaran (stabil → cache grammar structured outputs tetap terpakai)"""
    global _SKEMA
    if _SKEMA is None:
        s = _ketat(KeputusanAI.model_json_schema())
        s["description"] = _DESKRIPSI["KeputusanAI"]
        for k in _WAJIB_ISI:
            s["properties"][k] = _tanpa_null(s["properties"][k])
        _SKEMA = s
    return copy.deepcopy(_SKEMA)


def _mm_ss(x: float) -> str:
    x = max(0.0, float(x or 0))
    return f"{int(x // 60):02d}:{x % 60:04.1f}"


def _media_type(data: bytes) -> str:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return ""


def _tag_boleh(brief: BriefCampaign) -> list[str]:
    """@akun yang ditulis brand di brief (boleh tetap terlihat di caption / OCR / transkrip)"""
    out = {t for t in brief.hashtag_wajib if t.startswith("@")}
    for p in brief.poin:
        out.update(m.group(0).rstrip(".") for m in re.finditer(r"@[A-Za-z0-9._]{2,30}", p.teks or ""))
    return sorted(out)


def _pilih_frame(frames: list) -> list:
    if len(frames) <= MAKS_FRAME:
        return list(frames)
    step = (len(frames) - 1) / (MAKS_FRAME - 1)
    return [frames[round(i * step)] for i in range(MAKS_FRAME)]


def _ambil(obj: Any, nama: str, d: Any = None) -> Any:
    if obj is None:
        return d
    if isinstance(obj, dict):
        return obj.get(nama, d)
    return getattr(obj, nama, d)


class Hakim:
    def __init__(self, cfg, budget, rubrik: Rubrik, client: Optional[Any] = None, label_alasan: Optional[dict[str, str]] = None):
        """client = anthropic.Anthropic() (dibuat malas) atau tiruan untuk tes (bentuk respons sama dengan SDK)"""
        self.cfg = cfg
        self.budget = budget
        self.rubrik = rubrik
        self.client = client
        self.label_alasan = label_alasan
        self.status = "belum_dicek"  # ok / kunci_kosong / gagal (dibaca runtime untuk detak jantung)
        self.sleep = time.sleep
        self.n_panggil = 0
        self._cache_diperingatkan = False
        # pesan awam bila AI PASTI tidak bisa dipakai untuk video mana pun (kunci ditolak / tanpa izin / model salah / kredit
        # habis / kunci kosong). Dibaca uji.jalankan_uji → uji dihentikan, bukan 500 video "cek manusia". Kembali None sesudah
        # panggilan berhasil. Video tunggal tetap cek_manusia.
        self.mati: Optional[str] = None
        self.galat_terakhir: Optional[str] = None  # pesan awam error panggilan terakhir (untuk pesan uji berhenti)

    # ------------------------------------------------------------------ pengaturan
    @property
    def model(self) -> str:
        return str(getattr(self.cfg, "model", "") or "claude-haiku-5-5")

    @property
    def effort(self) -> str:
        e = str(getattr(self.cfg, "effort", "") or "medium").lower()
        return e if e in MAX_TOKENS else "medium"

    def _kunci_ada(self) -> bool:
        return bool(getattr(self.cfg, "anthropic_key_ada", False) or (os.environ.get("ANTHROPIC_API_KEY") or "").strip())

    def _klien(self) -> Optional[Any]:
        if self.client is not None:
            return self.client
        if not self._kunci_ada():
            self.status = "kunci_kosong"
            self.mati = "Kunci ANTHROPIC_API_KEY belum diisi di review-worker\\.env."
            return None
        try:
            import anthropic
        except ImportError:
            log.error("Paket anthropic belum terpasang — jalankan install.ps1 lagi.")
            self.status = "gagal"
            self.mati = "Paket anthropic belum terpasang — jalankan install.ps1 lagi."
            return None
        # kunci dibaca SDK sendiri dari env ANTHROPIC_API_KEY (tidak pernah disalin / dicatat)
        self.client = anthropic.Anthropic(max_retries=3, timeout=TIMEOUT_DETIK)
        return self.client

    # ------------------------------------------------------------------ permintaan
    def materi_json(self, brief: BriefCampaign, materi: MateriVideo, ref: ReferensiCampaign) -> dict:
        """materi video untuk AI (TANPA path / url / id / data pribadi; teks dibersihkan ulang) — deterministik"""
        boleh = _tag_boleh(brief)
        frames = _pilih_frame(materi.frames)
        idx_kirim = {f.idx for f in frames}
        seg, total = [], 0
        for s in materi.transkrip.segmen:
            t = bersihkan_teks(s.teks, 400, izinkan=boleh)
            if not t:
                continue
            total += len(t)
            if total > MAKS_TRANSKRIP:
                seg.append({"waktu": _mm_ss(s.mulai), "teks": "… (transkrip dipotong)"})
                break
            seg.append({"waktu": f"{_mm_ss(s.mulai)}-{_mm_ss(s.selesai)}", "teks": t})
        ocr, total = [], 0
        for o in sorted(materi.ocr, key=lambda o: (o.frame_idx, o.detik)):
            teks = [bersihkan_teks(x.teks, 200, izinkan=boleh) for x in o.teks if x.yakin >= 0.3 and x.teks.strip()]
            teks = [t for t in teks if t]
            if not teks:
                continue
            total += sum(len(t) for t in teks)
            if total > MAKS_OCR:
                break
            ocr.append({"frame": o.frame_idx, "detik": round(o.detik, 1), "teks": teks})
        mus = materi.musik
        terbaik = None
        if mus.terbaik is not None:
            b = mus.terbaik
            terbaik = {"lagu_referensi": bersihkan_teks(b.nama, 120), "detik_video": f"{b.mulai:.1f}-{b.selesai:.1f}",
                       "detik_lagu": f"{b.ref_mulai:.1f}-{b.ref_selesai:.1f}", "yakin": round(b.yakin, 2),
                       "tempo": b.faktor_tempo, "nada": b.faktor_nada}
        vis = materi.visual
        refm = ref.materi if ref is not None else []
        ai_ids = [p.id for p in brief.poin if p.cara_nilai == "ai"]
        butuh = {p.id: sorted(jenis_materi_poin(p)) for p in brief.poin if p.cara_nilai == "ai" and p.butuh_materi}
        meta = materi.meta
        return {
            "poin_dinilai_ai": ai_ids,
            "video": {"platform": meta.platform, "durasi_detik": meta.durasi_detik, "resolusi": meta.resolusi,
                      "jumlah_frame_dikirim": len(frames),
                      "frame": [{"frame": f.idx, "detik": round(f.detik, 1), "adegan": f.adegan} for f in frames]},
            "caption": bersihkan_teks(meta.caption, 1500, izinkan=boleh),
            "hashtags": list(meta.hashtags)[:40],
            "hashtag_present_menurut_sistem": meta.hashtag_present,
            "data_sistem": {"bot_score": meta.bot_score, "views": meta.current_views,
                            "catatan": "angka dari sistem Konten.com; bukan dasar reject sendirian"},
            "transkrip": seg,
            "teks_layar_ocr": ocr,
            "musik": {"status": mus.status, "mesin": mus.mesin, "terbaik": terbaik, "jumlah_cocok": len(mus.semua),
                      "vokal_dipisah": mus.demucs, "catatan": bersihkan_teks(mus.catatan, 300)},
            "visual": {"status": vis.status, "catatan": bersihkan_teks(vis.catatan, 300),
                       "cocok": [{"jenis": c.jenis, "frame": c.frame_idx, "detik": round(c.detik, 1), "skor": round(c.skor, 2)}
                                 for c in vis.cocok if c.frame_idx in idx_kirim or not idx_kirim][:10]},
            "materi_referensi": {"status": ref.status if ref is not None else "belum_dicek",
                                 "lagu_siap": any(m.jenis == "lagu" and m.status == "siap" for m in refm),
                                 "poster_siap": any(m.jenis == "poster" and m.status == "siap" for m in refm),
                                 "trailer_siap": any(m.jenis == "trailer" and m.status == "siap" for m in refm),
                                 "poin_butuh_materi": butuh},
            "fakta_kode": [{"poin_id": c.poin_id, "hasil": c.hasil, "bukti": c.bukti} for c in cek_kode(brief, materi)],
        }

    def bangun_permintaan(self, brief: BriefCampaign, materi: MateriVideo, ref: ReferensiCampaign) -> dict:
        """kwargs messages.create (model, max_tokens, system, messages, output_config) — deterministik, bisa dites tanpa API"""
        konten: list[dict] = []
        hilang = []
        for f in _pilih_frame(materi.frames):
            try:
                data = Path(f.path).read_bytes()
            except OSError:
                hilang.append(f.idx)
                continue
            mt = _media_type(data)
            if not mt or len(data) > MAKS_GAMBAR_BYTE:
                hilang.append(f.idx)
                continue
            konten.append({"type": "text", "text": f"Frame {f.idx} · detik {f.detik:.1f}"})
            konten.append({"type": "image", "source": {"type": "base64", "media_type": mt,
                                                       "data": base64.standard_b64encode(data).decode("ascii")}})
        mj = self.materi_json(brief, materi, ref)
        if hilang:
            mj["video"]["frame_tidak_terkirim"] = hilang
        teks = ("MATERI VIDEO (JSON, sudah dibersihkan dari data pribadi):\n"
                + json.dumps(mj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                + "\n\nNilai video ini sesuai rubrik dan brief di atas. Isi checklist untuk SEMUA id di poin_dinilai_ai, "
                  "sebut bukti untuk tiap poin, beri condong approve/reject + keyakinan_condong (selalu), lalu saran, alasan, "
                  "dan keyakinan. Kalau ragu, saran cek_manusia — condong tetap diisi.")
        konten.append({"type": "text", "text": teks})
        return {
            "model": self.model,
            "max_tokens": MAX_TOKENS[self.effort],
            "system": [
                {"type": "text", "text": self.rubrik.teks, "cache_control": {"type": "ephemeral", "ttl": "1h"}},
                {"type": "text", "text": teks_brief_untuk_prompt(brief), "cache_control": {"type": "ephemeral", "ttl": "1h"}},
            ],
            "messages": [{"role": "user", "content": konten}],
            "output_config": {"effort": self.effort, "format": {"type": "json_schema", "schema": skema_keputusan()}},
        }

    # ------------------------------------------------------------------ panggilan
    def _jenis_error(self, e: Exception) -> tuple[str, bool]:
        """(pesan awam untuk log, boleh dicoba lagi?) — rantai error SDK: APIConnectionError (termasuk APITimeoutError),
        APIStatusError (RateLimitError 429, InternalServerError ≥ 500, OverloadedError 529, AuthenticationError 401, …)"""
        try:
            import anthropic
        except ImportError:
            anthropic = None  # type: ignore[assignment]
        kode = getattr(e, "status_code", None)
        if anthropic is not None:
            if isinstance(e, anthropic.AuthenticationError):
                self.status = "gagal"
                self.mati = "Kunci ANTHROPIC_API_KEY ditolak (401). Cek isi .env."
                return self.mati, False
            if isinstance(e, anthropic.PermissionDeniedError):
                self.status = "gagal"
                self.mati = "Kunci AI tidak punya izin untuk model ini (403)."
                return self.mati, False
            if isinstance(e, anthropic.NotFoundError):
                self.mati = f"Model {self.model} tidak dikenal (404). Cek REVIEW_MODEL."
                return self.mati, False
            if isinstance(e, anthropic.BadRequestError):
                pesan = str(getattr(e, "message", e))[:200]
                if _KREDIT.search(pesan):  # kredit / tagihan habis = pasti gagal untuk semua video
                    self.mati = "Saldo / kredit Anthropic habis (400). Isi saldo di console Anthropic."
                    return self.mati, False
                return f"Permintaan ke AI ditolak (400): {pesan}", False
            if isinstance(e, anthropic.RateLimitError):
                return "Batas kecepatan AI tercapai (429).", True
            if isinstance(e, anthropic.APITimeoutError):
                return "AI terlalu lama menjawab (timeout).", True
            if isinstance(e, anthropic.APIConnectionError):
                return "Internet / server AI tidak terjangkau.", True
            if isinstance(e, anthropic.APIStatusError):
                return f"Server AI bermasalah ({kode}).", bool(kode and (kode >= 500 or kode in (408, 409, 429)))
        if isinstance(kode, int):
            return f"AI error {kode}.", kode >= 500 or kode in (408, 409, 429)
        return f"AI error ({type(e).__name__}).", False

    def _panggil(self, klien: Any, req: dict) -> tuple[Optional[Any], Optional[str]]:
        """SDK sudah retry 3× (koneksi, 408/409/429/≥500); di sini sekali lagi sesudah jeda untuk gangguan sementara"""
        for coba in range(2):
            try:
                self.n_panggil += 1
                return klien.messages.create(**req), None
            except Exception as e:  # noqa: BLE001 — error apa pun → cek manusia, job tidak crash
                pesan, ulang = self._jenis_error(e)
                if ulang and coba == 0:
                    log.warning("%s Coba lagi %.0f dtk…", pesan, JEDA_ULANG)
                    self.sleep(JEDA_ULANG)
                    continue
                log.error("%s Video diserahkan ke manusia.", pesan)
                self.galat_terakhir = pesan
                return None, pesan
        return None, "AI gagal"

    @staticmethod
    def _urai(resp: Any) -> Optional[KeputusanAI]:
        """jawaban → KeputusanAI. Blok dibaca per type (bisa diawali blok thinking); parsed_output (messages.parse) dipakai
        kalau ada; JSON rusak → None"""
        po = _ambil(resp, "parsed_output")
        if isinstance(po, KeputusanAI):
            return po
        teks = "".join(str(_ambil(b, "text", "") or "") for b in (_ambil(resp, "content") or []) if _ambil(b, "type") == "text")
        if isinstance(po, dict):
            teks = json.dumps(po)
        teks = teks.strip()
        if not teks:
            return None
        try:
            return KeputusanAI.model_validate_json(teks)
        except ValidationError:
            pass
        # cadangan: JSON di tengah teks / angka keyakinan desimal / key tambahan
        m = re.search(r"\{.*\}", teks, re.S)
        if not m:
            return None
        try:
            d = json.loads(m.group(0))
        except ValueError:
            return None
        if not isinstance(d, dict):
            return None
        boleh = set(KeputusanAI.model_fields)
        d = {k: v for k, v in d.items() if k in boleh}
        if isinstance(d.get("keyakinan"), (float, str)):
            try:
                d["keyakinan"] = int(round(float(d["keyakinan"])))
            except ValueError:
                return None
        if isinstance(d.get("keyakinan_condong"), (float, str)):
            try:
                d["keyakinan_condong"] = int(round(float(d["keyakinan_condong"])))
            except ValueError:
                d["keyakinan_condong"] = None  # condong tetap terbaca; keyakinan diturunkan di aturan
        if d.get("condong") not in (None, "approve", "reject"):
            d["condong"] = None
        if isinstance(d.get("checklist"), list):
            boleh_c = {"poin_id", "hasil", "bukti", "bukti_frame", "bukti_detik"}
            d["checklist"] = [{k: v for k, v in c.items() if k in boleh_c} for c in d["checklist"] if isinstance(c, dict)]
        try:
            return KeputusanAI.model_validate(d)
        except ValidationError:
            return None

    def _catat_log(self, p: PemakaianAI) -> None:
        log.info("AI %s effort=%s · input %d · output %d · cache baca %d · tulis 1j %d · tulis 5m %d · $%.5f · %s · %s",
                 p.model, p.effort, p.input, p.output, p.cache_read, p.cache_write_1h, p.cache_write_5m, p.biaya_usd,
                 p.stop_reason or "-", p.request_id or "-")
        if self.n_panggil >= 2 and p.cache_read == 0 and not self._cache_diperingatkan:
            self._cache_diperingatkan = True
            log.warning("Cache prompt tidak terbaca (cache_read 0) — biaya lebih mahal. Cek rubrik/brief tidak berubah tiap video.")

    def nilai(self, brief: BriefCampaign, materi: MateriVideo, ref: ReferensiCampaign) -> PenilaianFinal:
        """budget.cek() → panggil API (retry SDK bawaan) → validasi → aturan.terapkan_aturan → budget.catat().
        AnggaranHabis DITERUSKAN. materi.status bukan "ok" → tanpa panggilan AI (cek_manusia)."""
        t0 = time.monotonic()
        pem = PemakaianAI(model=self.model, effort=self.effort)

        def selesai(ai: Optional[KeputusanAI], gagal: Optional[str] = None, p: PemakaianAI = pem, catatan: str = "") -> PenilaianFinal:
            f = terapkan_aturan(ai, brief, materi, ref, self.cfg, gagal=gagal, label_alasan=self.label_alasan)  # type: ignore[arg-type]
            if not p.detik:
                p = p.model_copy(update={"detik": round(time.monotonic() - t0, 3)})
            upd = {"pemakaian": p, "rubrik_versi": self.rubrik.versi, "rubrik_hash": self.rubrik.hash}
            if catatan:
                upd["ringkasan"] = catatan
            return f.model_copy(update=upd)

        if materi.status != "ok":
            return selesai(None)
        if not [p for p in brief.poin if p.cara_nilai != "info"]:
            f = selesai(None, catatan="Brief campaign kosong / tidak terbaca — tidak ada poin untuk dinilai.")
            return f.model_copy(update={"serah": ["poin_tidak_bisa_dinilai"], "alasan_spesifik":
                                        "Butuh cek manusia: brief campaign kosong, tidak ada poin yang bisa dinilai."})
        klien = self._klien()
        if klien is None:
            return selesai(None, "ai_gagal", catatan="Kunci AI belum diisi (ANTHROPIC_API_KEY) — saran AI mati." if
                           self.status == "kunci_kosong" else "AI tidak bisa dipakai saat ini.")
        if self.budget is not None:
            self.budget.cek(PERKIRAAN_USD)  # AnggaranHabis diteruskan ke pipeline / uji
        req = self.bangun_permintaan(brief, materi, ref)
        t1 = time.monotonic()
        resp, err = self._panggil(klien, req)
        if resp is None:
            if self.status not in ("gagal", "kunci_kosong"):
                self.status = "gagal"
            return selesai(None, "ai_gagal", catatan=err or "")
        self.mati = None  # AI terjangkau lagi
        stop = _ambil(resp, "stop_reason")
        p = hitung_biaya(_ambil(resp, "usage"), str(_ambil(resp, "model", "") or self.model), self.effort,
                         detik=time.monotonic() - t1, stop_reason=stop, request_id=_ambil(resp, "_request_id"))
        self._catat_log(p)
        if self.budget is not None:
            try:
                self.budget.catat(p)
            except Exception as e:  # catat biaya gagal tidak boleh menggagalkan video
                log.warning("Biaya AI tidak tercatat (%s).", str(e)[:120])
        self.status = "ok"
        if stop == "refusal":
            sd = _ambil(resp, "stop_details")
            log.warning("AI menolak menilai (kategori %s) — diserahkan ke manusia.", _ambil(sd, "category") or "-")
            return selesai(None, "ai_menolak", p)
        if stop == "max_tokens":
            log.warning("Jawaban AI terpotong (max_tokens %d) — diserahkan ke manusia.", req["max_tokens"])
            return selesai(None, "ai_gagal", p)
        ai = self._urai(resp)
        if ai is None:
            log.warning("Jawaban AI bukan JSON yang sah — diserahkan ke manusia.")
            return selesai(None, "ai_gagal", p)
        return selesai(ai, None, p)
