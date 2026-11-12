"""Susun "materi video" untuk hakim (pemilik: worker-media). KONTRAK.md §4.2.
Urutan: unduh → frame → OCR (GPU) → samarkan handle → audio → ASR (GPU) → musik → visual → meta bersih. Tiap tahap GPU di
dalam rt.gpu.pegang(...). Gagal unduh → MateriVideo(status="tidak_bisa_diakses", error=...) tanpa melempar.

Tahap pelengkap (OCR, ASR, musik, visual) yang error TIDAK menggagalkan video: hasilnya kosong + catatan, hakim menilai
dengan bukti yang ada (poin yang butuh bukti itu jadi "tidak bisa dinilai"). File video dihapus segera sesudah frame & audio
diambil (sisa folder kerja dihapus pipeline). Batal dari website (Cancelled) & Ctrl+C selalu diteruskan."""
from __future__ import annotations

import re
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterable, Optional

from .. import privasi
from ..jobctx import Cancelled
from ..log import get
from ..skema import (BriefCampaign, HasilMusik, HasilVisual, MateriVideo, MetaVideo, ReferensiCampaign, Transkrip,
                     VideoDB)
from . import asr as asr_mod
from . import ff, frames as frames_mod, musik, ocr as ocr_mod, visual
from .unduh import TidakBisaDiakses, unduh_video

log = get("susun")
MAKS_CAPTION = 1500
_TAG = re.compile(r"@[A-Za-z0-9._]{2,30}")


def tag_boleh(brief: Optional[BriefCampaign]) -> list[str]:
    """@akun yang DIWAJIBKAN brief (akun brand) — boleh tetap terlihat di caption / OCR / transkrip"""
    if brief is None:
        return []
    out = {t.strip() for t in brief.hashtag_wajib if t.strip().startswith("@")}
    for p in brief.poin:
        out.update(m.group(0).rstrip(".") for m in _TAG.finditer(p.teks or ""))
    if brief.caption_wajib:
        out.update(m.group(0).rstrip(".") for m in _TAG.finditer(brief.caption_wajib))
    return sorted(out)


def meta_bersih(video: VideoDB, durasi: Optional[float], resolusi: Optional[str], boleh: Iterable[str] = ()) -> MetaVideo:
    caption = asr_mod.bersihkan(video.caption or "", boleh, MAKS_CAPTION) if video.caption else ""
    tags = list(video.hashtags or [])
    if not tags and video.caption:
        tags = re.findall(r"#[^\s#@]+", video.caption)
    return MetaVideo(platform=video.platform, durasi_detik=round(durasi, 2) if durasi else video.durasi_detik, caption=caption,
                     hashtags=privasi.bersihkan_hashtag(tags), hashtag_present=video.hashtag_present, bot_score=video.bot_score,
                     current_views=video.current_views, resolusi=resolusi)


@contextmanager
def _gpu(rt, alasan: str, cek_batal):
    g = getattr(rt, "gpu", None)
    if g is None:
        yield False
        return
    with g.pegang(alasan, cek_batal=cek_batal) as ok:
        yield ok


def buat_materi_video(rt, video: VideoDB, brief: BriefCampaign, ref: ReferensiCampaign, kerja: Path,
                      cek_batal: Optional[Callable[[], None]] = None) -> MateriVideo:
    cfg = rt.cfg
    batal = cek_batal or (lambda: None)
    waktu: dict[str, float] = {}
    boleh = tag_boleh(brief)
    kerja.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def tahap(nama: str):
        t0 = time.monotonic()
        try:
            yield
        finally:
            waktu[nama] = round(waktu.get(nama, 0.0) + time.monotonic() - t0, 2)

    dasar = dict(video_id=video.id, campaign_id=video.campaign_id)
    # 1. unduh
    try:
        with tahap("unduh"):
            path = unduh_video(video.url or "", kerja / "unduh", cfg)
    except TidakBisaDiakses as e:
        return MateriVideo(**dasar, status="tidak_bisa_diakses", error=str(e)[:300],
                           meta=meta_bersih(video, None, None, boleh), waktu_tahap=waktu)
    batal()
    # 2. frame + info file
    try:
        with tahap("frame"):
            resol = ff.resolusi(path)
            frames, durasi = frames_mod.pilih_frame(path, kerja / "frames", cfg)
    except Cancelled:
        raise
    except Exception as e:  # noqa: BLE001
        log.warning("frame gagal (%s)", type(e).__name__)
        return MateriVideo(**dasar, status="gagal", error="Video rusak / tidak bisa dibaca.",
                           meta=meta_bersih(video, None, None, boleh), waktu_tahap=waktu)
    meta = meta_bersih(video, durasi, resol, boleh)
    # 3. audio (lalu file video tidak diperlukan lagi → dihapus)
    wav: Optional[Path] = None
    try:
        if ff.ada_audio(path):
            wav = ff.ambil_audio(path, kerja / "audio.wav", sr=16000)
    except Exception as e:  # noqa: BLE001
        log.warning("ambil audio gagal (%s)", type(e).__name__)
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
    batal()
    # 4. OCR + samarkan @handle di frame
    ocr_list = []
    with tahap("ocr"):
        try:
            o = ocr_mod.dapatkan(rt)
            if o.mode != "mati":
                with _gpu(rt, "ocr", batal):
                    mentah = o.baca(frames)
            else:
                mentah = []
            ocr_list = ocr_mod.samarkan_handle(frames, mentah, boleh)
        except Cancelled:
            raise
        except Exception as e:  # noqa: BLE001
            log.warning("OCR gagal (%s)", type(e).__name__)
            ocr_list = []
    frames = [f for f in frames if Path(f.path).exists()]  # frame yang gagal disamarkan sudah dibuang (privasi)
    batal()
    # 5. ASR
    transkrip = Transkrip(model="")
    with tahap("asr"):
        if wav is not None:
            try:
                a = asr_mod.dapatkan(rt)
                with _gpu(rt, "asr", batal):
                    transkrip = a.transkrip(wav, boleh)
            except Cancelled:
                raise
            except Exception as e:  # noqa: BLE001
                log.warning("ASR gagal (%s)", type(e).__name__)
                transkrip = Transkrip(model="gagal")
    batal()
    # 6. musik
    with tahap("musik"):
        try:
            musik_h = musik.cocokkan_musik(rt, wav, ref, kerja) if wav is not None else (
                HasilMusik(status="tidak_ada_referensi", catatan="Belum ada lagu referensi.") if not musik._materi_audio(ref)
                else HasilMusik(status="tidak_cocok", mesin=musik.cek_mesin(cfg)[0], catatan="Video tanpa suara."))
        except Cancelled:
            raise
        except Exception as e:  # noqa: BLE001
            log.warning("musik gagal (%s)", type(e).__name__)
            musik_h = HasilMusik(status="gagal", catatan="Cek musik gagal.")
    batal()
    # 7. visual
    with tahap("visual"):
        try:
            vis = visual.cocokkan_visual(frames, ref)
        except Exception as e:  # noqa: BLE001
            log.warning("visual gagal (%s)", type(e).__name__)
            vis = HasilVisual(status="gagal", catatan="Cek kemiripan visual gagal.")
    return MateriVideo(**dasar, status="ok", frames=frames, transkrip=transkrip, ocr=ocr_list, musik=musik_h, visual=vis,
                       meta=meta, waktu_tahap=waktu)
