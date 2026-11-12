"""OCR teks layar (pemilik: worker-media): EasyOCR ['id','en'] GPU (torch cu128), cadangan CPU; REVIEW_OCR=mati → kosong.
samarkan_handle(): kotak OCR berisi @username / watermark akun di-blur di file frame SEBELUM frame dikirim ke AI.

Kenapa EasyOCR, bukan PaddleOCR: PaddlePaddle GPU untuk RTX 50 (sm_120) di Windows butuh wheel khusus & punya masalah yang
diketahui, sedangkan EasyOCR berjalan di atas torch 2.8 cu128 yang sudah terbukti jalan di laptop (KONTRAK.md §7).
Model EasyOCR (±100 MB) diunduh sekali ke data/models/easyocr."""
from __future__ import annotations

import gc
import re
import threading
from pathlib import Path
from typing import Iterable, Optional

from .. import privasi
from ..log import get
from ..skema import Frame, OCRFrame, TeksOCR
from .asr import bersihkan

log = get("ocr")
YAKIN_MIN = 0.30
_WATERMARK = re.compile(r"^(tik ?tok|tiktok|instagram|reels?|youtube|shorts|capcut)$", re.I)
_MIRIP_HANDLE = re.compile(r"^@?[A-Za-z0-9._]{3,30}$")
_PENANDA = re.compile(r"\[(email|telepon|akun|tautan)\]")


class OCR:
    def __init__(self, cfg):
        self.cfg = cfg
        self.reader = None
        self.mode = "mati" if str(getattr(cfg, "ocr", "easyocr")).lower() in ("mati", "off", "0", "") else "belum_dimuat"
        self.error: Optional[str] = None
        self.lock = threading.Lock()

    def _muat(self) -> None:
        if self.reader is not None or self.mode == "mati":
            return
        try:
            import easyocr
        except Exception as e:  # noqa: BLE001
            self.mode, self.error = "mati", f"EasyOCR tidak terpasang ({type(e).__name__})"
            log.warning("%s — OCR dilewati (teks layar tidak dibaca)", self.error)
            return
        folder = Path(getattr(self.cfg, "data", Path("data"))) / "models" / "easyocr"
        folder.mkdir(parents=True, exist_ok=True)
        gpu_ok = False
        try:
            import torch

            gpu_ok = bool(torch.cuda.is_available())
        except Exception:
            pass
        for gpu in ([True, False] if gpu_ok else [False]):
            try:
                self.reader = easyocr.Reader(["id", "en"], gpu=gpu, model_storage_directory=str(folder),
                                             user_network_directory=str(folder / "user"), download_enabled=True, verbose=False)
                self.mode = "easyocr-gpu" if gpu else "easyocr-cpu"
                log.info("EasyOCR siap (%s)", self.mode)
                return
            except Exception as e:  # noqa: BLE001
                self.error = f"{type(e).__name__}: {str(e)[:160]}"
                log.warning("EasyOCR %s gagal: %s", "GPU" if gpu else "CPU", self.error)
        self.mode = "mati"

    def baca(self, frames: list[Frame]) -> list[OCRFrame]:
        """teks MENTAH per frame (bisa memuat @username) — WAJIB lewat samarkan_handle() sebelum dipakai"""
        with self.lock:
            self._muat()
            if self.reader is None:
                return []
            hasil: list[OCRFrame] = []
            for f in frames:
                teks: list[TeksOCR] = []
                try:
                    baris = self.reader.readtext(f.path, detail=1, paragraph=False)
                except Exception as e:  # noqa: BLE001 — satu frame rusak tidak menggagalkan semua
                    log.warning("OCR frame %d gagal (%s)", f.idx, type(e).__name__)
                    baris = []
                for kotak, isi, yakin in baris:
                    isi = str(isi or "").strip()
                    if float(yakin) < YAKIN_MIN or len(isi) < 2:
                        continue
                    xs = [int(round(p[0])) for p in kotak]
                    ys = [int(round(p[1])) for p in kotak]
                    teks.append(TeksOCR(teks=isi, yakin=round(float(yakin), 3), kotak=[min(xs), min(ys), max(xs), max(ys)]))
                hasil.append(OCRFrame(frame_idx=f.idx, detik=f.detik, teks=teks))
            return hasil

    def tutup(self) -> None:
        r, self.reader = self.reader, None
        if r is None:
            return
        if self.mode != "mati":
            self.mode = "belum_dimuat"
        del r
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass


def _pribadi(teks: str, tetangga: list[str], boleh: set[str]) -> bool:
    """teks ini nama akun / data pribadi? (@handle, email, no HP, link, atau kata tunggal di sebelah watermark TikTok/IG)"""
    t = teks.strip()
    if t.lower() in boleh:
        return False
    if "@" in t or privasi.ada_data_pribadi(t):
        return True
    if _MIRIP_HANDLE.match(t) and not t.isdigit() and any(_WATERMARK.match(x.strip()) for x in tetangga):
        return True  # watermark platform: logo "TikTok" + username di sebelahnya
    return False


def _blur(path: Path, kotak: list[list[int]]) -> None:
    import cv2

    img = cv2.imread(str(path))
    if img is None:
        return
    h, w = img.shape[:2]
    for x1, y1, x2, y2 in kotak:
        pad = max(4, (y2 - y1) // 3)
        x1, y1, x2, y2 = max(0, x1 - pad), max(0, y1 - pad), min(w, x2 + pad), min(h, y2 + pad)
        if x2 - x1 < 2 or y2 - y1 < 2:
            continue
        roi = img[y1:y2, x1:x2]
        kecil = cv2.resize(roi, (max(1, (x2 - x1) // 12), max(1, (y2 - y1) // 12)), interpolation=cv2.INTER_AREA)
        img[y1:y2, x1:x2] = cv2.GaussianBlur(cv2.resize(kecil, (x2 - x1, y2 - y1), interpolation=cv2.INTER_NEAREST), (0, 0), 3)
    cv2.imwrite(str(path), img, [int(cv2.IMWRITE_JPEG_QUALITY), 85])


def samarkan_handle(frames: list[Frame], ocr: list[OCRFrame], boleh: Iterable[str] = ()) -> list[OCRFrame]:
    """blur kotak @handle di file JPEG frame, balikan OCR yang teks pribadinya sudah dibuang (privasi.bersihkan_teks).
    boleh = tag wajib campaign (mis. "@akunbrand" dari brief) yang tetap dibiarkan."""
    boleh_l = {b.strip().lower() for b in boleh if b and b.strip()}
    per_frame = {f.idx: f for f in frames}
    keluar: list[OCRFrame] = []
    for of in ocr:
        semua = [t.teks for t in of.teks]
        blur: list[list[int]] = []
        bersih: list[TeksOCR] = []
        for i, t in enumerate(of.teks):
            tetangga = semua[max(0, i - 2): i] + semua[i + 1: i + 3]
            if _pribadi(t.teks, tetangga, boleh_l):
                if len(t.kotak) == 4:
                    blur.append(list(t.kotak))
                sisa = bersihkan(t.teks, boleh_l)
                mentah = t.teks.strip().lstrip("@").lower()
                if not _PENANDA.sub("", sisa).strip(" ,.;:-|") or sisa.lower() == mentah:
                    continue  # isinya cuma nama akun (atau tidak bisa dibersihkan) → buang seluruhnya
                t = TeksOCR(teks=sisa, yakin=t.yakin, kotak=t.kotak)
            else:
                isi = bersihkan(t.teks, boleh_l)
                if not isi:
                    continue
                t = TeksOCR(teks=isi, yakin=t.yakin, kotak=t.kotak)
            bersih.append(t)
        f = per_frame.get(of.frame_idx)
        if blur and f is not None:
            try:
                _blur(Path(f.path), blur)
            except Exception as e:  # noqa: BLE001
                log.warning("blur frame %d gagal (%s) — frame tidak dikirim", f.idx, type(e).__name__)
                Path(f.path).unlink(missing_ok=True)  # lebih aman tidak dikirim daripada bocor
        keluar.append(OCRFrame(frame_idx=of.frame_idx, detik=of.detik, teks=bersih))
    return keluar


def dapatkan(rt) -> OCR:
    o = rt.cache.get("ocr")
    if o is None:
        o = rt.cache["ocr"] = OCR(rt.cfg)
    return o
