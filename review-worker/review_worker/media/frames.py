"""Pilih 6–10 frame (pemilik: worker-media): PySceneDetect (AdaptiveDetector) + sampling merata, sisi terpanjang ≤ 768 px, JPEG.

Cara pilih: titik tengah tiap adegan (pergantian shot) diutamakan supaya tiap shot terwakili, lalu diisi sampel merata
sepanjang video sampai N frame (N = 6 untuk < 20 dtk, 8 untuk < 45 dtk, 10 selebihnya; video < 6 dtk → sebanyak adegan,
min 3). Frame hampir hitam (transisi) digeser sedikit. Gagal deteksi adegan → sampling merata saja (tidak pernah gagal total
selama video bisa dibaca)."""
from __future__ import annotations

from pathlib import Path

from ..log import get
from ..skema import Frame
from . import ff

log = get("frames")


def jumlah_target(durasi: float, cfg, n_adegan: int = 1) -> int:
    lo, hi = int(getattr(cfg, "frames_min", 6)), int(getattr(cfg, "frames_max", 10))
    if durasi < 6:
        return max(3, min(hi, n_adegan))
    n = 6 if durasi < 20 else 8 if durasi < 45 else 10
    return max(lo, min(hi, n))


def deteksi_adegan(video: Path, durasi: float) -> list[tuple[float, float]]:
    """[(mulai, selesai)] detik. Kosong / satu adegan kalau PySceneDetect tidak ada atau gagal."""
    try:
        from scenedetect import AdaptiveDetector, SceneManager, open_video

        v = open_video(str(video))
        sm = SceneManager()
        sm.auto_downscale = True  # cepat: dianalisis di resolusi kecil
        sm.add_detector(AdaptiveDetector(min_scene_len=8))
        sm.detect_scenes(video=v, show_progress=False)
        adegan = [(a.get_seconds(), b.get_seconds()) for a, b in sm.get_scene_list()]
        return adegan or [(0.0, durasi)]
    except Exception as e:  # noqa: BLE001 — cadangan sampling merata
        log.warning("deteksi adegan gagal (%s) → sampling merata", type(e).__name__)
        return [(0.0, durasi)]


def pilih_waktu(durasi: float, adegan: list[tuple[float, float]], n: int) -> list[tuple[float, int]]:
    """→ [(detik, nomor_adegan)] urut, panjang ≤ n, jarak antar titik ≥ ±durasi/(3n)"""
    if durasi <= 0:
        return [(0.0, 0)]
    pinggir = min(0.3, durasi * 0.05)
    batas = lambda t: min(max(t, pinggir), max(pinggir, durasi - pinggir))  # noqa: E731
    jarak_min = durasi / (3.0 * n)
    calon = [(batas((a + b) / 2), i) for i, (a, b) in enumerate(adegan) if b - a > 0.15]
    if len(calon) > n:  # adegan terlalu banyak → ambil yang tersebar merata di sepanjang video
        step = len(calon) / n
        calon = [calon[int(i * step + step / 2)] for i in range(n)]
    pilih: list[tuple[float, int]] = []
    for t, i in sorted(calon):
        if all(abs(t - u) >= jarak_min for u, _ in pilih):
            pilih.append((t, i))
    merata = [batas((k + 0.5) * durasi / n) for k in range(n)]
    # isi kekosongan: sampel merata yang paling jauh dari titik terpilih dulu
    merata.sort(key=lambda t: -min([abs(t - u) for u, _ in pilih] or [durasi]))
    for t in merata:
        if len(pilih) >= n:
            break
        if all(abs(t - u) >= jarak_min for u, _ in pilih):
            pilih.append((t, _adegan_di(t, adegan)))
    return sorted(pilih)[:n]


def _adegan_di(t: float, adegan: list[tuple[float, float]]) -> int:
    for i, (a, b) in enumerate(adegan):
        if a <= t < b:
            return i
    return max(0, len(adegan) - 1)


def _simpan(img, keluar: Path, sisi: int):
    import cv2

    h, w = img.shape[:2]
    skala = min(1.0, sisi / float(max(h, w)))
    if skala < 1.0:
        img = cv2.resize(img, (max(1, round(w * skala)), max(1, round(h * skala))), interpolation=cv2.INTER_AREA)
    if not cv2.imwrite(str(keluar), img, [int(cv2.IMWRITE_JPEG_QUALITY), 85]):
        raise OSError("gagal menulis JPEG")
    return img.shape[1], img.shape[0]


def pilih_frame(video: Path, keluar: Path, cfg) -> tuple[list[Frame], float]:
    """→ (frames urut detik, idx 1..N; durasi video detik)"""
    import cv2

    keluar.mkdir(parents=True, exist_ok=True)
    sisi = int(getattr(cfg, "frame_sisi", 768) or 768)
    durasi = ff.durasi(video)
    cap = cv2.VideoCapture(str(video))
    try:
        if durasi <= 0 and cap.isOpened():
            fps, nfr = cap.get(cv2.CAP_PROP_FPS) or 0, cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
            durasi = float(nfr / fps) if fps > 0 else 0.0
        if durasi <= 0:
            raise ff.FFError("video tidak bisa dibaca (durasi 0)")
        adegan = deteksi_adegan(video, durasi)
        n = jumlah_target(durasi, cfg, len(adegan))
        waktu = pilih_waktu(durasi, adegan, n)
        frames: list[Frame] = []
        for k, (t, ad) in enumerate(waktu, start=1):
            path = keluar / f"f{k:02d}.jpg"
            img = None
            for geser in (0.0, 0.4, -0.4, 0.9):  # frame hitam (transisi / fade) → geser sedikit
                tt = min(max(0.0, t + geser), max(0.0, durasi - 0.05))
                cap.set(cv2.CAP_PROP_POS_MSEC, tt * 1000.0)
                ok, im = cap.read()
                if ok and im is not None:
                    img, t_pakai = im, tt
                    if float(im.mean()) > 12:
                        break
            if img is not None:
                lebar, tinggi = _simpan(img, path, sisi)
            else:  # OpenCV tidak bisa seek (codec tertentu) → ffmpeg
                t_pakai = t
                ff.frame_jpeg(video, t, path, sisi)
                im = cv2.imread(str(path))
                if im is None:
                    continue
                tinggi, lebar = im.shape[:2]
            frames.append(Frame(idx=k, detik=round(t_pakai, 2), path=str(path), lebar=int(lebar), tinggi=int(tinggi), adegan=ad))
    finally:
        cap.release()
    if not frames:
        raise ff.FFError("tidak ada frame yang bisa dibaca")
    frames.sort(key=lambda f: f.detik)
    for i, f in enumerate(frames, start=1):  # idx 1..N urut detik (geser frame hitam bisa mengubah urutan)
        if f.idx != i:
            baru = Path(f.path).with_name(f"g{i:02d}.jpg")
            Path(f.path).replace(baru)
            f.path, f.idx = str(baru), i
    return frames, durasi
