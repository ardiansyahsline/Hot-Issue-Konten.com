"""Tiruan media untuk selftest pembangun lain (pemilik: worker-media). TANPA ffmpeg / GPU / jaringan.

- materi_contoh(video_id, varian="lengkap", folder=None) → MateriVideo sah (frame JPEG kecil 216x384 dibuat Pillow di folder
  sementara, supaya hakim bisa base64-kan gambar). Varian: "lengkap" (CTA terucap + tertulis, musik cocok, poster mirip),
  "tanpa_cta", "tanpa_musik", "tidak_bisa_diakses", "gagal".
- referensi_contoh(campaign_id, lagu=True, poster=True) → ReferensiCampaign.
- GpuPalsu (with pegang(...) → True, catat urutan tahap) & RtPalsu(cfg, supa, gpu) untuk memanggil media.* langsung.
Semua teks sudah "bersih" (tanpa @username / email / no HP) seperti keluaran asli susun.buat_materi_video.
"""
from __future__ import annotations

import sys
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from review_worker.skema import (CocokLagu, CocokVisual, Frame, HasilMusik, HasilVisual, MateriRef, MateriVideo,  # noqa: E402
                                 MetaVideo, OCRFrame, ReferensiCampaign, SegmenTranskrip, TeksOCR, Transkrip)

MATERIAL_LAGU = "00000000-0000-4000-8000-00000000a001"
MATERIAL_POSTER = "00000000-0000-4000-8000-00000000a002"


def _jpeg(path: Path, teks: str, warna: tuple[int, int, int]) -> None:
    from PIL import Image, ImageDraw

    im = Image.new("RGB", (216, 384), warna)
    d = ImageDraw.Draw(im)
    d.rectangle([10, 300, 206, 340], fill=(0, 0, 0))
    d.text((16, 312), teks[:28], fill=(255, 255, 255))
    im.save(path, "JPEG", quality=80)


def materi_contoh(video_id: str = "48213", varian: str = "lengkap", folder: Optional[Path] = None,
                  campaign_id: str = "c-77") -> MateriVideo:
    meta = MetaVideo(platform="tiktok", durasi_detik=24.6, caption="Wajib nonton! Tayang 12 Desember #filmx #konten",
                     hashtags=["#filmx", "#konten"], hashtag_present=True, bot_score=0.12, current_views=5400, resolusi="1080x1920")
    if varian == "tidak_bisa_diakses":
        return MateriVideo(video_id=video_id, campaign_id=campaign_id, status="tidak_bisa_diakses",
                           error="Video tidak bisa diakses: sudah dihapus / tidak tersedia.", meta=meta, waktu_tahap={"unduh": 2.1})
    if varian == "gagal":
        return MateriVideo(video_id=video_id, campaign_id=campaign_id, status="gagal", error="Video rusak / tidak bisa dibaca.",
                           meta=meta, waktu_tahap={"unduh": 3.0, "frame": 0.2})
    folder = Path(folder or tempfile.mkdtemp(prefix=f"materi-{video_id}-"))
    folder.mkdir(parents=True, exist_ok=True)
    teks_frame = ["FILM X", "pemeran utama", "adegan aksi", "TAYANG 12 DESEMBER", "poster resmi", "di bioskop", "tiket", "#filmx"]
    frames = []
    for i, t in enumerate(teks_frame, start=1):
        p = folder / f"f{i:02d}.jpg"
        _jpeg(p, t, (30 * i % 255, 80, 140))
        frames.append(Frame(idx=i, detik=round(0.4 + (i - 1) * 3.0, 2), path=str(p), lebar=216, tinggi=384, adegan=i - 1))
    cta = varian != "tanpa_cta"
    segmen = [SegmenTranskrip(mulai=0.0, selesai=3.2, teks="Film ini seru banget, aksinya keren parah."),
              SegmenTranskrip(mulai=3.4, selesai=7.9, teks="Ceritanya bikin penasaran sampai akhir.")]
    if cta:
        segmen.append(SegmenTranskrip(mulai=8.0, selesai=11.5, teks="Nonton film ini di bioskop mulai 12 Desember ya!"))
    ocr = [OCRFrame(frame_idx=1, detik=0.4, teks=[TeksOCR(teks="FILM X", yakin=0.95, kotak=[20, 300, 200, 340])]),
           OCRFrame(frame_idx=2, detik=3.4, teks=[]),
           OCRFrame(frame_idx=4, detik=9.4, teks=[TeksOCR(teks="TAYANG 12 DESEMBER" if cta else "SERU BANGET", yakin=0.93,
                                                          kotak=[20, 300, 205, 340])])]
    if varian == "tanpa_musik":
        musik = HasilMusik(status="tidak_cocok", mesin="panako", catatan="Lagu campaign tidak terdengar di video.")
    else:
        lagu = CocokLagu(material_id=MATERIAL_LAGU, nama="ost-utama.wav", mulai=2.1, selesai=18.7, ref_mulai=45.0, ref_selesai=61.4,
                         skor=19, faktor_tempo=1.03, faktor_nada=1.02, yakin=0.92)
        musik = HasilMusik(status="cocok", mesin="panako", terbaik=lagu, semua=[lagu])
    vis = HasilVisual(status="ada", cocok=[CocokVisual(material_id=MATERIAL_POSTER, jenis="poster", frame_idx=5, detik=12.4,
                                                       jarak=6, skor=0.906)], catatan="1 dari 1 materi visual mirip.")
    teks = " ".join(s.teks for s in segmen)
    return MateriVideo(video_id=video_id, campaign_id=campaign_id, status="ok", frames=frames,
                       transkrip=Transkrip(bahasa="id", segmen=segmen, teks_penuh=teks, model="large-v3-turbo"), ocr=ocr,
                       musik=musik, visual=vis, meta=meta,
                       waktu_tahap={"unduh": 4.1, "frame": 1.3, "ocr": 2.2, "asr": 3.0, "musik": 5.5, "visual": 0.2})


def referensi_contoh(campaign_id: str = "c-77", lagu: bool = True, poster: bool = True, folder: Optional[Path] = None) -> ReferensiCampaign:
    folder = Path(folder or tempfile.gettempdir())
    materi = []
    if lagu:
        materi.append(MateriRef(id=MATERIAL_LAGU, jenis="lagu", nama="ost-utama.wav", path_lokal=str(folder / f"{MATERIAL_LAGU}.wav"),
                                status="siap"))
    if poster:
        materi.append(MateriRef(id=MATERIAL_POSTER, jenis="poster", nama="poster.jpg", path_lokal=str(folder / f"{MATERIAL_POSTER}.jpg"),
                                status="siap"))
    status = "ada" if lagu and poster else "sebagian" if (lagu or poster) else "belum_ada"
    pesan = "" if materi else "Folder Google Drive private / tidak bisa diunduh otomatis. Upload manual di halaman Materi."
    return ReferensiCampaign(campaign_id=campaign_id, status=status, pesan=pesan, materi=materi)


class GpuPalsu:
    """pengganti gpu_bersama.KunciGPU: selalu dapat kunci, mencatat tahap yang memegang GPU"""

    def __init__(self):
        self.tahap: list[str] = []
        self.dipegang = False

    @contextmanager
    def pegang(self, alasan: str, *, prioritas: bool = False, tunggu_maks: Optional[float] = None, cek_batal=None):
        assert not self.dipegang, "kunci GPU dipegang bertumpuk"
        if cek_batal:
            cek_batal()
        self.tahap.append(alasan)
        self.dipegang = True
        try:
            yield True
        finally:
            self.dipegang = False

    def ada_yang_minta(self) -> bool:
        return False

    def pemegang(self):
        return None


@dataclass
class RtPalsu:
    cfg: Any
    supa: Any = None
    replika: Any = None
    gpu: Any = field(default_factory=GpuPalsu)
    budget: Any = None
    hakim: Any = None
    rubrik: Any = None
    cache: dict = field(default_factory=dict)
    status: dict = field(default_factory=lambda: {"status": "siap", "job": None})
    job: Any = None

    def selipkan(self) -> int:
        return 0
