"""Format data BERSAMA antar modul review-worker (kontrak — lihat KONTRAK.md §4). Ubah hanya lewat arsitek / orkestrator.

Aturan privasi (berlaku untuk semua model di sini): TIDAK ada nama / email / no HP / username / link video clipper.
- VideoDB.url hanya hidup di memori laptop untuk mengunduh (repr disembunyikan), tidak pernah dikirim ke AI / Supabase / log.
- Reviewer = pseudonim "R-xxxxxx" (HMAC id staff, privasi.pseudonim), bukan nama.
- Teks dari video (caption, transkrip, OCR) dibersihkan privasi.bersihkan_teks() sebelum masuk MateriVideo.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# ------------------------------------------------------------------ kode tetap (sama dengan CHECK di migration-23)
Saran = Literal["approve", "reject", "cek_manusia"]
Keputusan = Literal["approve", "reject"]
HasilPoin = Literal["lolos", "tidak", "tidak_bisa_dinilai"]
StatusPipeline = Literal["ok", "tidak_bisa_diakses", "gagal", "dilewati_biaya"]
Banding = Literal["dibatalkan", "dikuatkan", "menunggu"]
# kode alasan reject resmi (review_reasons.code); label persis diambil dari audit_log (sinkron-alasan)
KodeAlasan = Literal[
    "tidak_sesuai_brief", "cta_tidak_ada", "followers_kurang", "engagement_bot",
    "link_bio_tidak_ada", "duplikat", "tidak_bisa_diakses", "lainnya",
]
# kenapa diserahkan ke manusia (review_results.handoff_reasons) — KONTRAK.md §5.4
KodeSerah = Literal[
    "keyakinan_rendah", "identitas_orang", "materi_belum_ada", "poin_tidak_bisa_dinilai", "bukti_kurang",
    "alasan_tidak_jelas", "ai_menolak", "ai_gagal", "video_tidak_bisa_diakses", "anggaran_habis", "data_akun",
]


class _M(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ------------------------------------------------------------------ dari DB replika (replika.py, worker-inti)
class VideoRef(_M):
    """rujukan video dari website / CLI: id Konten.com, atau id di platform (TANPA username)"""
    jenis: Literal["id", "platform"]
    nilai: str
    platform: Optional[Literal["tiktok", "instagram", "youtube", "lainnya"]] = None


class VideoDB(_M):
    id: str
    campaign_id: Optional[str] = None
    url: Optional[str] = Field(default=None, repr=False)  # RAHASIA: hanya untuk unduh
    platform: Optional[str] = None  # tiktok / instagram / youtube / lainnya (ditebak dari url kalau kolom tidak ada)
    platform_video_id: Optional[str] = None  # id video di platform (tanpa username)
    status: Optional[str] = None
    caption: Optional[str] = None  # MENTAH — bersihkan dulu sebelum ke AI
    hashtags: list[str] = Field(default_factory=list)
    hashtag_present: Optional[bool] = None
    bot_score: Optional[float] = None
    current_views: Optional[int] = None
    durasi_detik: Optional[float] = None
    dibuat: Optional[str] = None  # ISO


class CampaignDB(_M):
    id: str
    title: Optional[str] = None
    brand: Optional[str] = None
    status: Optional[str] = None
    rules: Optional[str] = None
    hashtags: list[str] = Field(default_factory=list)
    min_video_duration: Optional[float] = None
    brief_detail: object = None  # JSON mentah (dict / list / str / None) — diurai brief.parse_brief
    source_video_url: Optional[str] = Field(default=None, repr=False)


class KeputusanManusia(_M):
    video_id: str
    keputusan: Optional[Keputusan] = None
    alasan_label: Optional[str] = None  # label alasan resmi (audit_log.details.reason) — catatan bebas TIDAK diambil
    reviewer: Optional[str] = None  # pseudonim R-xxxxxx
    diputuskan: Optional[str] = None  # ISO
    banding: Optional[Banding] = None
    status_sekarang: Optional[str] = None  # tracked_videos.status terkini (mentah)


class KandidatSampel(_M):
    video_id: str
    campaign_id: Optional[str] = None
    keputusan: Keputusan
    alasan_label: Optional[str] = None
    reviewer: Optional[str] = None
    tanggal: str  # YYYY-MM-DD (WIB)


# ------------------------------------------------------------------ brief (brief.py, hakim-ai)
KategoriPoin = Literal[
    "elemen_wajib", "material_wajib", "footage_wajib", "footage_opsional", "cta", "caption_wajib", "hashtag",
    "durasi", "boleh", "dilarang", "instruksi", "narasi", "tujuan", "kesan", "ugc_wajah", "tipe_konten",
    "target_audiens", "followers", "niche_akun", "lainnya",
]


class PoinBrief(_M):
    id: str  # "p01", "p02", ... urut stabil (hash brief sama → id sama)
    kategori: KategoriPoin
    teks: str  # kalimat poin (≤ 400 karakter)
    wajib: bool = True
    pilihan: list[str] = Field(default_factory=list)  # "+Choice": cukup SALAH SATU terpenuhi
    sumber: str = ""  # key brief_detail asal, mis. "elemenWajib[2]"
    cara_nilai: Literal["ai", "kode", "manusia", "data_akun", "info"] = "ai"
    # cara_nilai manusia: alasan_manusia wajib diisi; data_akun = di luar video (followers / niche akun) → tidak dinilai AI
    alasan_manusia: Optional[Literal["identitas_orang", "butuh_materi_referensi", "lainnya"]] = None
    butuh_materi: bool = False  # perlu materi referensi campaign (lagu / poster / trailer)
    kode_alasan: KodeAlasan = "tidak_sesuai_brief"  # alasan resmi kalau poin ini dilanggar


class BriefCampaign(_M):
    campaign_id: str
    judul: Optional[str] = None
    brand: Optional[str] = None
    poin: list[PoinBrief] = Field(default_factory=list)
    durasi_min: Optional[float] = None  # detik
    durasi_max: Optional[float] = None
    hashtag_wajib: list[str] = Field(default_factory=list)
    caption_wajib: Optional[str] = None
    materi_links: list[str] = Field(default_factory=list)  # link Google Drive (brief_detail.materi)
    hash: str = ""  # sha256 brief_detail ternormalisasi (12 hex)
    catatan_parser: list[str] = Field(default_factory=list)  # key aneh / tipe tak terduga (untuk log, tanpa isi pribadi)


# ------------------------------------------------------------------ materi video (media/susun.py, worker-media)
class Frame(_M):
    idx: int  # 1..N (dipakai AI sebagai "frame 3")
    detik: float
    path: str  # JPEG lokal, sisi terpanjang ≤ 768 px, handle @username sudah disamarkan
    lebar: int
    tinggi: int
    adegan: int = 0  # nomor adegan PySceneDetect


class SegmenTranskrip(_M):
    mulai: float
    selesai: float
    teks: str


class Transkrip(_M):
    bahasa: str = "id"
    segmen: list[SegmenTranskrip] = Field(default_factory=list)
    teks_penuh: str = ""
    model: str = ""


class TeksOCR(_M):
    teks: str
    yakin: float  # 0..1
    kotak: list[int] = Field(default_factory=list)  # [x1, y1, x2, y2] di frame kecil


class OCRFrame(_M):
    frame_idx: int
    detik: float
    teks: list[TeksOCR] = Field(default_factory=list)


class CocokLagu(_M):
    material_id: str  # review_materials.id
    nama: str  # nama file lagu referensi (bukan data clipper)
    mulai: float  # detik di video clipper
    selesai: float
    ref_mulai: float  # detik di lagu referensi
    ref_selesai: float
    skor: float  # skor mentah mesin (Panako: jumlah sidik jari cocok)
    faktor_tempo: Optional[float] = None  # 1.03 = 3% lebih cepat
    faktor_nada: Optional[float] = None
    yakin: float  # 0..1 dinormalisasi worker-media


class HasilMusik(_M):
    status: Literal["cocok", "tidak_cocok", "tidak_ada_referensi", "gagal", "nonaktif"]
    mesin: Literal["panako", "olaf", "chroma", "tidak_ada"] = "tidak_ada"
    terbaik: Optional[CocokLagu] = None
    semua: list[CocokLagu] = Field(default_factory=list)
    demucs: bool = False  # vokal dipisah dulu (kecocokan awal rendah)
    catatan: str = ""


class CocokVisual(_M):
    material_id: str
    jenis: Literal["poster", "trailer"]
    frame_idx: int
    detik: float
    jarak: int  # jarak Hamming pHash terbaik (0..64)
    skor: float  # 0..1


class HasilVisual(_M):
    status: Literal["ada", "tidak_ada", "tidak_ada_referensi", "gagal", "nonaktif"]
    cocok: list[CocokVisual] = Field(default_factory=list)
    catatan: str = ""


class MetaVideo(_M):
    """sudah bersih dari data pribadi"""
    platform: Optional[str] = None
    durasi_detik: Optional[float] = None
    caption: str = ""  # tanpa @handle / email / no HP / link
    hashtags: list[str] = Field(default_factory=list)
    hashtag_present: Optional[bool] = None
    bot_score: Optional[float] = None
    current_views: Optional[int] = None
    resolusi: Optional[str] = None  # "1080x1920"


class MateriVideo(_M):
    video_id: str
    campaign_id: Optional[str] = None
    status: StatusPipeline = "ok"
    error: Optional[str] = None  # kalimat awam, mis. "Video tidak bisa diakses (dihapus / private)."
    frames: list[Frame] = Field(default_factory=list)
    transkrip: Transkrip = Field(default_factory=Transkrip)
    ocr: list[OCRFrame] = Field(default_factory=list)
    musik: HasilMusik = Field(default_factory=lambda: HasilMusik(status="nonaktif"))
    visual: HasilVisual = Field(default_factory=lambda: HasilVisual(status="nonaktif"))
    meta: MetaVideo = Field(default_factory=MetaVideo)
    waktu_tahap: dict[str, float] = Field(default_factory=dict)  # {unduh, frame, ocr, asr, musik, visual}


# ------------------------------------------------------------------ referensi campaign (media/materi.py, worker-media)
class MateriRef(_M):
    id: str  # review_materials.id
    jenis: Literal["lagu", "poster", "trailer", "lainnya"]
    nama: str
    path_lokal: str  # file lokal di data/materi/<campaign>/
    status: Literal["antri_sidik", "proses", "siap", "gagal"]


class ReferensiCampaign(_M):
    campaign_id: str
    status: Literal["belum_dicek", "proses", "ada", "sebagian", "belum_ada", "gagal"]
    pesan: str = ""
    materi: list[MateriRef] = Field(default_factory=list)

    def ada(self, jenis: str) -> bool:
        return any(m.jenis == jenis and m.status == "siap" for m in self.materi)


# ------------------------------------------------------------------ keluaran AI (skema JSON untuk Claude — hakim.py)
class CekPoinAI(_M):
    poin_id: str
    hasil: HasilPoin
    bukti: str  # WAJIB: "frame 3 (detik 12.4): ...", "transkrip 00:08: '...'", "OCR frame 5: '...'", "musik: ..."
    bukti_frame: list[int] = Field(default_factory=list)
    bukti_detik: list[float] = Field(default_factory=list)


class KeputusanAI(_M):
    """persis yang diminta ke Claude (output_config.format json_schema). Tanpa minimum/maximum (tidak didukung) — dicek di kode."""
    checklist: list[CekPoinAI]
    saran: Saran
    alasan_kode: Optional[KodeAlasan] = None  # wajib kalau saran reject
    alasan_spesifik: str  # 1 kalimat spesifik
    keyakinan: int  # 0..100 (dijepit di kode)
    ringkasan: str = ""  # ≤ 2 kalimat untuk reviewer


class CekPoin(_M):
    """checklist FINAL (sesudah aturan kode) — disimpan di review_results.checklist (KONTRAK.md §5.3)"""
    poin_id: str
    kategori: KategoriPoin
    teks: str
    wajib: bool
    hasil: HasilPoin
    bukti: str
    bukti_frame: list[int] = Field(default_factory=list)
    bukti_detik: list[float] = Field(default_factory=list)
    oleh: Literal["ai", "kode", "manusia"] = "ai"  # siapa yang menetapkan hasil (manusia = dipaksa "butuh cek manusia")


class PemakaianAI(_M):
    input: int = 0
    output: int = 0
    cache_read: int = 0
    cache_write_1h: int = 0
    cache_write_5m: int = 0
    biaya_usd: float = 0.0
    model: str = ""
    effort: str = ""
    stop_reason: Optional[str] = None
    request_id: Optional[str] = None
    detik: float = 0.0


class PenilaianFinal(_M):
    """hasil hakim + aturan kode — siap disimpan"""
    saran: Saran
    keyakinan: int  # 0..100
    alasan_kode: Optional[KodeAlasan] = None
    alasan_label: Optional[str] = None  # label resmi persis (review_reasons.label)
    alasan_spesifik: str = ""
    ringkasan: str = ""
    checklist: list[CekPoin] = Field(default_factory=list)
    serah: list[KodeSerah] = Field(default_factory=list)  # kenapa butuh cek manusia
    pemakaian: PemakaianAI = Field(default_factory=PemakaianAI)
    rubrik_versi: str = ""
    rubrik_hash: str = ""


class Rubrik(_M):
    versi: str  # "v1"
    hash: str  # 12 hex
    teks: str  # blok system pertama (di-cache 1 jam)
    catatan: str = ""


# ------------------------------------------------------------------ satu baris review_results (pipeline.py → supa)
class HasilVideo(_M):
    scope: str  # "run:<uuid>" | "job:<uuid>"
    run_id: Optional[str] = None
    job_id: Optional[str] = None
    video_id: str
    platform: Optional[str] = None
    platform_video_id: Optional[str] = None
    campaign_id: Optional[str] = None
    campaign_title: Optional[str] = None
    brand: Optional[str] = None
    rubric_version: Optional[str] = None
    rubric_hash: Optional[str] = None
    model: Optional[str] = None
    pipeline_status: StatusPipeline = "ok"
    suggestion: Optional[Saran] = None
    confidence: Optional[int] = None
    official_reason: Optional[str] = None
    official_code: Optional[KodeAlasan] = None
    specific_reason: Optional[str] = None
    handoff_reasons: list[KodeSerah] = Field(default_factory=list)
    checklist: list[dict] = Field(default_factory=list)  # CekPoin.model_dump()
    music: dict = Field(default_factory=dict)  # HasilMusik.model_dump()
    visual: dict = Field(default_factory=dict)  # HasilVisual.model_dump()
    meta: dict = Field(default_factory=dict)  # {durasi_detik, n_hashtag, hashtag_present, bot_score, n_frame, ringkasan}
    human_decision: Optional[Keputusan] = None
    human_reason: Optional[str] = None
    human_code: Optional[KodeAlasan] = None
    reviewer: Optional[str] = None
    decided_at: Optional[str] = None
    appeal: Optional[Banding] = None
    final_truth: Optional[Keputusan] = None
    match: Optional[bool] = None
    cost_usd: float = 0.0
    tokens: dict = Field(default_factory=dict)  # {input, output, cache_read, cache_write_1h, cache_write_5m}
    process_sec: Optional[float] = None
    stage_sec: dict[str, float] = Field(default_factory=dict)
    error: Optional[str] = None

    def baris_supabase(self) -> dict:
        """dict siap upsert ke review_results (on_conflict=scope,video_id)"""
        return self.model_dump(mode="json")
