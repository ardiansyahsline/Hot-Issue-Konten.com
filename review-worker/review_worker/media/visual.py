"""Kemiripan frame vs poster / potongan trailer (pemilik: worker-media). pHash (DCT 32x32 → 64 bit) + dHash ditulis sendiri
(numpy + scipy.fft + Pillow yang sudah ada, tanpa paket imagehash), dihitung di beberapa potongan tengah (9:16 dari 16:9).

Kenapa potongan: video clipper biasanya 9:16, sedangkan poster/trailer 2:3 atau 16:9 — trailer sering ditaruh di pita tengah
(letterbox) atau di-crop tengah. Jadi tiap gambar punya beberapa sidik (utuh, tengah 9:16, tengah 1:1, pita 16:9 di tengah)
dan jarak = minimum pasangan. Cocok kalau jarak pHash ≤ 10 dari 64 bit (dan dHash tidak bertentangan). skor = 1 − jarak/64.
Ringan (milidetik per frame), tanpa GPU. Bukan pengenal wajah — tidak mengenali orang sama sekali."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import numpy as np

from ..log import get
from ..skema import CocokVisual, Frame, HasilVisual, ReferensiCampaign

log = get("visual")
JARAK_COCOK = 10
JARAK_PASTI = 6  # ≤ ini cukup pHash saja
DHASH_MAKS = 18
TRAILER_TIAP = 2.0  # detik antar keyframe trailer
TRAILER_MAKS_FRAME = 90


def _buka(path_or_img):
    from PIL import Image, ImageOps

    if isinstance(path_or_img, (str, Path)):
        im = Image.open(path_or_img)
        im = ImageOps.exif_transpose(im)
    else:
        im = path_or_img
    return im.convert("L")


def _phash_img(im) -> int:
    from PIL import Image
    from scipy.fft import dctn

    a = np.asarray(im.resize((32, 32), Image.Resampling.LANCZOS), dtype=np.float64)
    d = dctn(a, type=2, norm="ortho")[:8, :8]
    med = np.median(d.flatten()[1:])  # tanpa komponen DC
    return _bits(d.flatten() > med)


def _dhash_img(im) -> int:
    from PIL import Image

    a = np.asarray(im.resize((9, 8), Image.Resampling.LANCZOS), dtype=np.float64)
    return _bits((a[:, 1:] > a[:, :-1]).flatten())


def _bits(b: np.ndarray) -> int:
    v = 0
    for x in b.astype(bool).tolist():
        v = (v << 1) | int(x)
    return v


def phash(path: Path) -> int:
    return _phash_img(_buka(path))


def jarak(a: int, b: int) -> int:
    return int(bin(int(a) ^ int(b)).count("1"))


def _potongan(im) -> list:
    """utuh + potongan tengah 9:16, 1:1, dan pita 16:9 (untuk video vertikal berisi trailer letterbox)"""
    w, h = im.size
    out = [im]

    def tengah(rw: float, rh: float):
        if w / h > rw / rh:  # terlalu lebar → potong kiri-kanan
            nw = int(h * rw / rh)
            x = (w - nw) // 2
            return im.crop((x, 0, x + nw, h))
        nh = int(w * rh / rw)
        y = (h - nh) // 2
        return im.crop((0, y, w, y + nh))

    for rw, rh in ((9, 16), (1, 1), (16, 9)):
        r = rw / rh
        if abs(w / h - r) > 0.08:
            c = tengah(rw, rh)
            if c.size[0] >= 32 and c.size[1] >= 32:
                out.append(c)
    return out


def sidik_img(im) -> dict:
    ps = [_phash_img(c) for c in _potongan(im)]
    ds = [_dhash_img(c) for c in _potongan(im)]
    return {"phash": [f"{p:016x}" for p in ps], "dhash": [f"{d:016x}" for d in ds]}


def sidik_gambar(path: Path) -> dict:
    """→ {"phash": [hex…], "dhash": [hex…]} untuk beberapa potongan (disimpan di review_materials.fingerprint.image)"""
    return sidik_img(_buka(path))


def sidik_video(path: Path, tiap: float = TRAILER_TIAP, maks: int = TRAILER_MAKS_FRAME) -> dict:
    """keyframe trailer tiap `tiap` detik → {"phash": [...], "dhash": [...], "detik": [...]} (satu set potongan per keyframe)"""
    import cv2
    from PIL import Image

    cap = cv2.VideoCapture(str(path))
    ps, ds, ts = [], [], []
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        dur = n / fps if fps > 0 else 0
        t = 0.5
        while t < max(dur, 0.6) and len(ts) < maks:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, img = cap.read()
            if not ok or img is None:
                break
            if float(img.mean()) > 12:  # lewati frame hitam / judul gelap
                im = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)).convert("L")
                s = sidik_img(im)
                ps.append(s["phash"])
                ds.append(s["dhash"])
                ts.append(round(t, 2))
            t += tiap
    finally:
        cap.release()
    return {"phash": ps, "dhash": ds, "detik": ts}


def _hex_list(v) -> list[int]:
    out = []
    for x in v or []:
        try:
            out.append(int(str(x), 16))
        except ValueError:
            pass
    return out


def _sidik_ref(m) -> Optional[list[tuple[list[int], list[int]]]]:
    """[(phash potongan…, dhash potongan…)] per gambar referensi — dibaca dari <id>.sidik.json (dibuat materi.py) atau dihitung"""
    path = Path(m.path_lokal)
    sidecar = path.with_name(f"{m.id}.sidik.json")
    data = None
    if sidecar.exists():
        try:
            data = json.loads(sidecar.read_text(encoding="utf-8")).get("image")
        except (OSError, ValueError):
            data = None
    if data is None:
        if not path.exists():
            return None
        data = sidik_video(path) if m.jenis == "trailer" else sidik_gambar(path)
        try:
            sidecar.write_text(json.dumps({"image": data}), encoding="utf-8")
        except OSError:
            pass
    ph, dh = data.get("phash") or [], data.get("dhash") or []
    if ph and isinstance(ph[0], list):  # trailer: list per keyframe
        return [(_hex_list(p), _hex_list(d)) for p, d in zip(ph, dh, strict=False)]
    return [(_hex_list(ph), _hex_list(dh))]


def _jarak_terbaik(fp: list[int], fd: list[int], rp: list[int], rd: list[int]) -> tuple[int, int]:
    """(jarak pHash minimum, jarak dHash pada pasangan potongan yang sama)"""
    best = (65, 65)
    for i, a in enumerate(fp):
        for j, b in enumerate(rp):
            dj = jarak(a, b)
            dd = jarak(fd[i], rd[j]) if i < len(fd) and j < len(rd) else 64
            if (dj, dd) < best:
                best = (dj, dd)
    return best


def cocokkan_visual(frames: list[Frame], ref: ReferensiCampaign, batas: int = JARAK_COCOK) -> HasilVisual:
    visual_ref = [m for m in ref.materi if m.jenis in ("poster", "trailer") and m.status == "siap"]
    if not visual_ref:
        return HasilVisual(status="tidak_ada_referensi", catatan="Belum ada poster / trailer referensi untuk campaign ini.")
    try:
        sidik_frame = []
        for f in frames:
            if Path(f.path).exists():
                s = sidik_gambar(Path(f.path))
                sidik_frame.append((f, _hex_list(s["phash"]), _hex_list(s["dhash"])))
        cocok: list[CocokVisual] = []
        dicek = 0
        for m in visual_ref:
            sets = _sidik_ref(m)
            if not sets:
                continue
            dicek += 1
            terbaik: Optional[tuple[int, int, Frame]] = None
            for f, fp, fd in sidik_frame:
                for rp, rd in sets:
                    dj, dd = _jarak_terbaik(fp, fd, rp, rd)
                    if terbaik is None or (dj, dd) < terbaik[:2]:
                        terbaik = (dj, dd, f)
            if terbaik and (terbaik[0] <= JARAK_PASTI or (terbaik[0] <= batas and terbaik[1] <= DHASH_MAKS)):
                dj, _dd, f = terbaik
                cocok.append(CocokVisual(material_id=m.id, jenis=m.jenis, frame_idx=f.idx, detik=f.detik, jarak=dj,
                                         skor=round(1 - dj / 64.0, 3)))
        if not dicek:
            return HasilVisual(status="gagal", catatan="File poster / trailer referensi tidak bisa dibaca.")
        cocok.sort(key=lambda c: c.jarak)
        if cocok:
            return HasilVisual(status="ada", cocok=cocok[:5],
                               catatan=f"{len(cocok)} dari {dicek} materi visual mirip dengan frame video (pHash).")
        return HasilVisual(status="tidak_ada", catatan=f"Tidak ada frame yang mirip {dicek} poster / trailer referensi "
                                                       "(bisa jadi diedit berat — cek manusia bila poin ini wajib).")
    except Exception as e:  # noqa: BLE001
        log.warning("cek visual gagal (%s)", type(e).__name__)
        return HasilVisual(status="gagal", catatan="Cek kemiripan visual gagal.")

