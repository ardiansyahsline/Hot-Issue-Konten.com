"""Selftest worker-media (review_worker/media/*): TANPA GPU, VPN, DB replika, internet, kunci API.

Dipakai: video sintetis buatan ffmpeg (3 adegan + teks layar + @username + suara + lagu), server HTTP lokal (yt-dlp asli),
Supabase palsu (tests/palsu_db.SupaPalsu), gdown palsu (fungsi ditambal), faster-whisper & EasyOCR palsu. Panako ASLI dipakai
kalau Java + panako.jar ada (env SELFTEST_PANAKO_JAR / REVIEW_PANAKO_JAR atau tools/panako/panako.jar) — kalau tidak, tes Panako
dilewati dan dicatat. EasyOCR ASLI dicoba kalau paket + model tersedia (SELFTEST_EASYOCR=1).

Jalankan:  .venv\\Scripts\\python tests\\selftest_media.py   (atau python tests/selftest_media.py [nama_tes …])
"""
from __future__ import annotations

import functools
import http.server
import json
import logging
import os
import re
import shutil
import socketserver
import sys
import tempfile
import threading
import time
import traceback
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402

from review_worker.config import Cfg  # noqa: E402
from review_worker.jobctx import Cancelled  # noqa: E402
from review_worker.media import asr, ff, frames, materi, musik, ocr, susun, unduh, visual  # noqa: E402
from review_worker.skema import BriefCampaign, CampaignDB, Frame, MateriRef, MateriVideo, OCRFrame, PoinBrief, ReferensiCampaign, TeksOCR, VideoDB  # noqa: E402
from palsu_media import GpuPalsu, RtPalsu, materi_contoh, referensi_contoh  # noqa: E402

os.environ.setdefault("NO_PROXY", "127.0.0.1,localhost")
os.environ["no_proxy"] = os.environ["NO_PROXY"] + ",127.0.0.1,localhost"
TMP = Path(tempfile.mkdtemp(prefix="selftest-media-"))
FONT = next((str(p) for p in [Path("C:/Windows/Fonts/arial.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
                              Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf")] if p.exists()), None)
CATATAN: list[str] = []
LOG_REKAM: list[str] = []


class _Rekam(logging.Handler):
    def emit(self, record):  # semua log modul media direkam → dicek tidak memuat link / username
        LOG_REKAM.append(record.getMessage())


logging.getLogger("review").addHandler(_Rekam())
logging.getLogger("review").setLevel(logging.DEBUG)


def cfg_uji(**kw) -> Cfg:
    data = TMP / "data"
    c = Cfg(root=ROOT, data=data, tmp=data / "tmp", logs=data / "logs", laporan=data / "laporan", materi=data / "materi")
    c.dl_jeda_detik = 0
    c.musik = os.environ.get("SELFTEST_MUSIK", "panako")
    jar = os.environ.get("SELFTEST_PANAKO_JAR") or os.environ.get("REVIEW_PANAKO_JAR") or ""
    c.panako_jar = jar
    for k, v in kw.items():
        setattr(c, k, v)
    for d in (c.data, c.tmp, c.materi):
        d.mkdir(parents=True, exist_ok=True)
    return c


# ------------------------------------------------------------------ bahan sintetis
def lagu_sintetis(path: Path, seed: int, detik: float, sr: int = 22050) -> Path:
    import soundfile as sf

    r, out, t = np.random.default_rng(seed), [], 0.0
    while t < detik:
        d = float(r.choice([0.125, 0.25, 0.25, 0.5]))
        n = int(sr * d)
        tt = np.arange(n) / sr
        x = sum(np.sin(2 * np.pi * (220 * 2 ** (int(r.integers(0, 24)) / 12)) * tt) * 0.5 ** k for k in range(3))
        x = x * np.minimum(1, np.arange(n) / 200) * np.exp(-tt * 3)
        if r.random() < 0.4:
            x = x + r.standard_normal(n) * np.exp(-tt * 30) * 0.5
        out.append(x)
        t += d
    y = np.concatenate(out)
    sf.write(str(path), (y / np.abs(y).max() * 0.8).astype(np.float32), sr)
    return path


def poster_sintetis(path: Path, seed: int = 3, ukuran=(600, 900)) -> Path:
    from PIL import Image, ImageDraw

    r = np.random.default_rng(seed)
    im = Image.new("RGB", ukuran, tuple(int(x) for x in r.integers(0, 255, 3)))
    d = ImageDraw.Draw(im)
    for _ in range(14):
        x0, y0 = int(r.integers(0, ukuran[0])), int(r.integers(0, ukuran[1]))
        d.ellipse([x0, y0, x0 + int(r.integers(60, 260)), y0 + int(r.integers(60, 260))],
                  fill=tuple(int(x) for x in r.integers(0, 255, 3)))
    d.rectangle([40, ukuran[1] - 160, ukuran[0] - 40, ukuran[1] - 60], fill=(250, 250, 250))
    im.save(path, "JPEG", quality=92)
    return path


_BAHAN: dict = {}


def bahan() -> dict:
    """lagu referensi (60 dtk), lagu lain, poster, trailer, dan video clipper sintetis 1080x1920 ±16 dtk:
    adegan 1 = warna + teks "TAYANG 12 DESEMBER" + "@clipper_rahasia"; adegan 2 = poster di tengah (letterbox);
    adegan 3 = pola testsrc2. Audio = potongan lagu referensi detik 20–36 dipercepat 4% (tempo + nada) + derau."""
    if _BAHAN:
        return _BAHAN
    d = TMP / "bahan"
    d.mkdir(parents=True, exist_ok=True)
    ref = lagu_sintetis(d / "ost-utama.wav", 1, 60)
    lain = lagu_sintetis(d / "lagu-lain.wav", 2, 40)
    ff.run(["-i", str(ref), "-b:a", "128k", str(d / "ost-utama.mp3")])
    poster = poster_sintetis(d / "poster-resmi.jpg")
    # trailer 16:9 berisi poster (detik 0–4) lalu testsrc → audio = lagu lain (supaya audio trailer ≠ lagu)
    ff.run(["-loop", "1", "-t", "4", "-i", str(poster), "-f", "lavfi", "-t", "4", "-i", "testsrc2=s=1280x720:r=25",
            "-i", str(lain), "-filter_complex",
            "[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25[a];"
            "[1:v]setsar=1[b];[a][b]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", "-t", "8", "-c:v", "libx264",
            "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(d / "trailer-resmi.mp4")])
    teks = ""
    if FONT:
        f = FONT.replace("\\", "/").replace(":", "\\:")
        teks = (f",drawtext=fontfile='{f}':text='TAYANG 12 DESEMBER':fontsize=80:fontcolor=white:x=(w-tw)/2:y=h*0.7:box=1:"
                f"boxcolor=black@0.6,drawtext=fontfile='{f}':text='@clipper_rahasia':fontsize=56:fontcolor=white:x=40:y=120")
    musik_klip = d / "musik-klip.wav"
    ff.run(["-ss", "20", "-t", "17", "-i", str(ref), "-af", "asetrate=22050*1.04,aresample=22050", "-ac", "1", str(musik_klip)])
    video = d / "clipper.mp4"
    ff.run(["-f", "lavfi", "-t", "5", "-i", "color=c=0x2050a0:s=1080x1920:r=25", "-loop", "1", "-t", "6", "-i", str(poster),
            "-f", "lavfi", "-t", "5", "-i", "testsrc2=s=1080x1920:r=25", "-i", str(musik_klip),
            "-f", "lavfi", "-t", "16", "-i", "anoisesrc=a=0.03:c=pink:r=22050:seed=7", "-filter_complex",
            f"[0:v]setsar=1{teks}[a];[1:v]scale=1080:-2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x101010,setsar=1,fps=25[b];"
            f"[2:v]setsar=1[c];[a][b][c]concat=n=3:v=1:a=0[v];[3:a][4:a]amix=inputs=2:duration=first[au]",
            "-map", "[v]", "-map", "[au]", "-t", "16", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ar", "44100", str(video)], timeout=300)
    pendek = d / "pendek.mp4"
    ff.run(["-f", "lavfi", "-t", "4", "-i", "testsrc2=s=720x1280:r=25", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt",
            "yuv420p", str(pendek)])
    _BAHAN.update(ref=ref, lain=lain, mp3=d / "ost-utama.mp3", poster=poster, trailer=d / "trailer-resmi.mp4", video=video,
                  pendek=pendek, musik_klip=musik_klip, dir=d)
    return _BAHAN


class _Diam(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


_SERVER: dict = {}


def server() -> str:
    """server HTTP lokal untuk yt-dlp (extractor generic) — folder bahan"""
    if not _SERVER:
        h = functools.partial(_Diam, directory=str(bahan()["dir"]))
        class _Server(socketserver.ThreadingTCPServer):
            daemon_threads = True

            def handle_error(self, request, client_address):  # yt-dlp memutus koneksi saat file terlalu besar → wajar
                pass

        s = _Server(("127.0.0.1", 0), h)
        threading.Thread(target=s.serve_forever, daemon=True).start()
        _SERVER["url"] = f"http://127.0.0.1:{s.server_address[1]}"
    return _SERVER["url"]


def panako_ada(cfg) -> bool:
    return bool(musik.cari_java(cfg) and musik.cari_jar(cfg))


# ================================================================== tes
def t_ffmpeg_dasar():
    b = bahan()
    assert ff.tersedia()
    d = ff.durasi(b["video"])
    assert 15.5 <= d <= 16.5, d
    assert ff.ada_audio(b["video"]) and ff.ada_video(b["video"])
    assert ff.resolusi(b["video"]) == "1080x1920", ff.resolusi(b["video"])
    wav = ff.ambil_audio(b["video"], TMP / "a.wav")
    import soundfile as sf

    info = sf.info(str(wav))
    assert info.samplerate == 16000 and info.channels == 1
    return f"video sintetis {d:.1f} dtk 1080x1920, audio → WAV 16 kHz mono"


def t_frame_pilih():
    b = bahan()
    fr, dur = frames.pilih_frame(b["video"], TMP / "fr", cfg_uji())
    assert 6 <= len(fr) <= 10, len(fr)
    assert [f.idx for f in fr] == list(range(1, len(fr) + 1))
    assert [f.detik for f in fr] == sorted(f.detik for f in fr)
    assert all(max(f.lebar, f.tinggi) <= 768 and Path(f.path).exists() for f in fr)
    adegan = {f.adegan for f in fr}
    assert len(adegan) >= 3, adegan  # tiap adegan terwakili
    from PIL import Image

    with Image.open(fr[0].path) as im:
        assert max(im.size) <= 768
    return f"{len(fr)} frame, {len(adegan)} adegan terwakili, sisi ≤ 768 px"


def t_frame_pendek():
    fr, dur = frames.pilih_frame(bahan()["pendek"], TMP / "fr2", cfg_uji())
    assert 3 <= len(fr) <= 6 and dur < 6, (len(fr), dur)
    w = frames.pilih_waktu(60.0, [(0, 60)], 10)
    assert len(w) == 10 and all(0 < t < 60 for t, _ in w)
    w2 = frames.pilih_waktu(30.0, [(i, i + 0.5) for i in range(60)], 8)  # 60 adegan pendek → tetap 8, tersebar
    assert len(w2) == 8 and w2[-1][0] - w2[0][0] > 20
    return f"video 4 dtk → {len(fr)} frame; banyak adegan → tetap tersebar"


def t_unduh_ytdlp_lokal():
    url = server()
    c = cfg_uji(dl_max_mb=50)
    n_log = len(LOG_REKAM)
    p = unduh.unduh_video(f"{url}/clipper.mp4", TMP / "dl1", c)
    assert p.exists() and p.stat().st_size > 10000 and ff.ada_video(p)
    for salah, kata in ((f"{url}/tidak-ada.mp4", "dihapus"), ("", "link video tidak ada")):
        try:
            unduh.unduh_video(salah, TMP / "dl2", c)
            raise AssertionError("harus gagal")
        except unduh.TidakBisaDiakses as e:
            assert kata in str(e).lower() or "tidak bisa diakses" in str(e).lower(), str(e)
    try:  # batas ukuran 0,05 MB
        unduh.unduh_video(f"{url}/clipper.mp4", TMP / "dl3", cfg_uji(dl_max_mb=0.05))
    except unduh.TidakBisaDiakses as e:
        assert "batas" in str(e) or "ukuran" in str(e), str(e)
    else:
        raise AssertionError("file > batas harus ditolak")
    assert not list((TMP / "dl3").glob("video.*")), "sisa unduhan harus dihapus"
    args = unduh.perintah("https://www.tiktok.com/@clipper_rahasia/video/123", TMP, c)
    for a in ("--ignore-config", "--no-playlist", "--limit-rate", "--max-filesize", "--no-cookies-from-browser"):
        assert a in args, a
    assert "--cookies" not in args
    baru = LOG_REKAM[n_log:]
    assert not any(re.search(r"https?://|127\.0\.0\.1|clipper_rahasia", m) for m in baru), baru
    return "yt-dlp asli (server lokal): unduh ok, 404 → 'dihapus', terlalu besar ditolak, log tanpa link"


def t_unduh_pesan():
    m = unduh._pesan_awam
    assert "private" in m("ERROR: [TikTok] 123: This video is private")
    assert "login" in m("ERROR: [Instagram] abc: Requested content is not available, rate-limit reached or login required")
    assert "dihapus" in m("ERROR: [TikTok] 123: Video not available, status code 10204")
    assert "wilayah" in m("ERROR: The uploader has not made this video available in your country (geo restricted)")
    assert "ukuran" in m("File is larger than max-filesize (12345 bytes > 100 bytes). Aborting.")
    assert m("sesuatu aneh") == "Video tidak bisa diakses (gagal diunduh)."
    return "pesan error yt-dlp → kalimat awam"


class _Seg:
    def __init__(self, s, e, t, nsp=0.05, lp=-0.3):
        self.start, self.end, self.text, self.no_speech_prob, self.avg_logprob = s, e, t, nsp, lp


def _whisper_palsu(gagal_cuda: bool = True):
    dibuat = []

    class WM:
        def __init__(self, nama, device="auto", compute_type="", download_root=None, local_files_only=False, **kw):
            dibuat.append((device, compute_type, local_files_only))
            if device == "cuda" and gagal_cuda:
                raise RuntimeError("CUDA driver tidak ada")
            if local_files_only and "kosong" in str(download_root):
                raise RuntimeError("Unable to open file 'model.bin' in model snapshot (local files only)")

        def transcribe(self, audio, **kw):
            assert kw.get("language") == "id"
            if not isinstance(audio, str):
                return iter([]), None
            return iter([_Seg(0.0, 3.2, " Nonton film ini di bioskop mulai 12 Desember"),
                         _Seg(3.3, 6.0, " follow @clipper_rahasia ya, WA 0812-3456-7890"),
                         _Seg(6.0, 8.0, " tag @filmx_official"),
                         _Seg(8.0, 9.0, " Terima kasih telah menonton"),
                         _Seg(9.0, 12.0, " la la la", nsp=0.9, lp=-1.4)]), None

    mod = types.ModuleType("faster_whisper")
    mod.WhisperModel = WM  # type: ignore[attr-defined]
    return mod, dibuat


def t_asr_palsu():
    mod, dibuat = _whisper_palsu()
    lama = sys.modules.get("faster_whisper")
    sys.modules["faster_whisper"] = mod
    try:
        c = cfg_uji(whisper_cache=TMP / "whisper-ada")
        (TMP / "whisper-ada").mkdir(exist_ok=True)
        a = asr.ASR(c)
        tr = a.transkrip(TMP / "a.wav", boleh=["@filmx_official"])
        assert a.device == "cpu", a.device  # cuda gagal → cpu
        teks = [s.teks for s in tr.segmen]
        assert teks[0].startswith("Nonton film ini"), teks
        assert not any("clipper_rahasia" in t or "0812" in t for t in teks), teks
        assert any("@filmx_official" in t for t in teks), teks  # tag wajib campaign tetap
        assert not any("Terima kasih" in t or "la la" in t for t in teks), teks  # halusinasi / musik dibuang
        assert tr.bahasa == "id" and tr.model == c.whisper_model and tr.teks_penuh
        a.tutup()
        assert a.model is None
    finally:
        if lama is None:
            sys.modules.pop("faster_whisper", None)
        else:
            sys.modules["faster_whisper"] = lama
    return f"faster-whisper palsu: cuda gagal → cpu ({len(dibuat)} percobaan muat), @handle & no HP dibuang, halusinasi dibuang"


def _frame_teks(path: Path) -> Frame:
    from PIL import Image, ImageDraw

    im = Image.new("RGB", (432, 768), (40, 90, 160))
    d = ImageDraw.Draw(im)
    for y in range(0, 768, 8):  # tekstur supaya blur terukur
        d.line([(0, y), (432, y)], fill=(255, 255, 255) if (y // 8) % 2 else (0, 0, 0), width=2)
    im.save(path, "JPEG", quality=95)
    return Frame(idx=1, detik=1.0, path=str(path), lebar=432, tinggi=768)


def t_ocr_samarkan():
    f = _frame_teks(TMP / "ocr1.jpg")
    mentah = [OCRFrame(frame_idx=1, detik=1.0, teks=[
        TeksOCR(teks="TAYANG 12 DESEMBER", yakin=0.9, kotak=[20, 600, 410, 650]),
        TeksOCR(teks="@clipper_rahasia", yakin=0.8, kotak=[20, 60, 260, 100]),
        TeksOCR(teks="TikTok", yakin=0.9, kotak=[20, 700, 120, 730]),
        TeksOCR(teks="clipperku.official", yakin=0.7, kotak=[130, 700, 400, 730]),
        TeksOCR(teks="Follow @filmx_official", yakin=0.8, kotak=[20, 400, 300, 440]),
        TeksOCR(teks="DM 081234567890", yakin=0.8, kotak=[20, 300, 300, 340]),
        TeksOCR(teks="rina_1998", yakin=0.8, kotak=[20, 200, 200, 240])])]  # '@' tidak terbaca OCR
    import cv2

    asli = cv2.imread(f.path)
    hasil = ocr.samarkan_handle([f], mentah, boleh=["@filmx_official"])
    baru = cv2.imread(f.path)
    teks = [t.teks for t in hasil[0].teks]
    assert "TAYANG 12 DESEMBER" in teks, teks
    assert not any("clipper" in t for t in teks), teks
    assert any("@filmx_official" in t for t in teks), teks
    assert not any("0812" in t for t in teks) and "rina_1998" not in teks, teks
    for kata, harap in (("clipper_rahasia", True), ("budi.santoso", True), ("rina1998", True), ("TAYANG", False),
                        ("12DESEMBER", False), ("filmx_official", False), ("#filmx", False), ("Desember", False)):
        assert ocr.mirip_username(kata, {"@filmx_official"}) is harap, kata
    std = lambda im, k: float(im[k[1]:k[3], k[0]:k[2]].std())  # noqa: E731
    assert std(baru, [20, 60, 260, 100]) < std(asli, [20, 60, 260, 100]) * 0.5, "kotak @handle harus diburamkan"
    assert std(baru, [130, 700, 400, 730]) < std(asli, [130, 700, 400, 730]) * 0.5, "username di watermark TikTok diburamkan"
    assert abs(std(baru, [20, 600, 410, 650]) - std(asli, [20, 600, 410, 650])) < 6, "teks brief tidak diburamkan"
    return f"@handle + username watermark diburamkan di JPEG, no HP dibuang, tag wajib & teks brief tetap ({teks})"


def t_ocr_mati_dan_palsu():
    o = ocr.OCR(cfg_uji(ocr="mati"))
    assert o.baca([_frame_teks(TMP / "ocr2.jpg")]) == [] and o.mode == "mati"

    class ReaderPalsu:
        def readtext(self, path, detail=1, paragraph=False):
            return [([[10, 10], [200, 10], [200, 40], [10, 40]], "PROMO", 0.9), ([[0, 0], [5, 0], [5, 5], [0, 5]], "x", 0.9),
                    ([[0, 50], [90, 50], [90, 70], [0, 70]], "samar", 0.1)]

    o2 = ocr.OCR(cfg_uji())
    o2.reader, o2.mode = ReaderPalsu(), "easyocr-cpu"
    f3 = _frame_teks(TMP / "ocr3.jpg")
    h = o2.baca([f3])
    assert [t.teks for t in h[0].teks] == ["PROMO", "samar"] and h[0].teks[0].kotak == [10, 10, 200, 40]  # samar: dicek blur
    assert [t.teks for t in ocr.samarkan_handle([f3], h)[0].teks] == ["PROMO"]  # yakin < 0,30 tidak dikirim ke AI

    class ReaderRusak:
        def readtext(self, path, detail=1, paragraph=False):
            raise RuntimeError("CUDA error")

    o2.reader = ReaderRusak()
    assert o2.baca([f3]) == []  # frame gagal dibaca tidak dianggap "sudah di-OCR"
    return "REVIEW_OCR=mati → kosong; yakin rendah hanya untuk blur; teks 1 huruf dibuang; frame error tidak ikut; kotak [x1,y1,x2,y2]"


def t_ocr_handle_samar_diburamkan():
    f = _frame_teks(TMP / "ocr-samar.jpg")
    import cv2

    asli = cv2.imread(f.path)
    mentah = [OCRFrame(frame_idx=1, detik=1.0, teks=[TeksOCR(teks="@clipper_rahasia", yakin=0.15, kotak=[20, 60, 260, 100]),
                                                     TeksOCR(teks="budisantoso99", yakin=0.12, kotak=[20, 200, 260, 240])])]
    h = ocr.samarkan_handle([f], mentah)
    baru = cv2.imread(f.path)
    std = lambda im, k: float(im[k[1]:k[3], k[0]:k[2]].std())  # noqa: E731
    assert h[0].teks == []
    for k in ([20, 60, 260, 100], [20, 200, 260, 240]):
        assert std(baru, k) < std(asli, k) * 0.5, k
    return "handle yang terbaca samar (yakin 0,12–0,15) tetap diburamkan, teksnya tidak dikirim"


def t_ocr_tanpa_ocr_zona_watermark():
    f = _frame_teks(TMP / "ocr-zona.jpg")
    import cv2

    asli = cv2.imread(f.path)
    assert ocr.samarkan_tanpa_ocr([f]) == 1
    baru = cv2.imread(f.path)
    std = lambda im, k: float(im[k[1]:k[3], k[0]:k[2]].std())  # noqa: E731
    for k in ([20, 30, 260, 100], [20, 680, 410, 760]):  # pita atas-kiri (watermark TikTok) & pita bawah (IG / TikTok)
        assert std(baru, k) < std(asli, k) * 0.5, k
    assert abs(std(baru, [20, 300, 410, 500]) - std(asli, [20, 300, 410, 500])) < 6, "tengah frame tidak diburamkan"
    rusak = Frame(idx=2, detik=2.0, path=str(TMP / "ocr-rusak.jpg"), lebar=10, tinggi=10)
    Path(rusak.path).write_bytes(b"bukan jpeg")
    assert ocr.samarkan_tanpa_ocr([rusak]) == 0 and not Path(rusak.path).exists(), "frame yang gagal diburamkan dibuang"
    return "OCR mati / error → pita watermark atas-kiri & bawah diburamkan; frame yang gagal diburamkan tidak dikirim"


def t_ocr_easyocr_asli():
    if os.environ.get("SELFTEST_EASYOCR") != "1":
        CATATAN.append("EasyOCR asli dilewati (set SELFTEST_EASYOCR=1; butuh paket easyocr + unduh model ±100 MB)")
        return "dilewati"
    from PIL import Image, ImageDraw, ImageFont

    im = Image.new("RGB", (432, 768), (20, 20, 20))
    d = ImageDraw.Draw(im)
    fnt = ImageFont.truetype(FONT, 32) if FONT else None
    d.text((20, 500), "TAYANG 12 DESEMBER", fill=(255, 255, 255), font=fnt)
    d.text((30, 80), "@clipper_rahasia", fill=(255, 255, 255), font=fnt)
    p = TMP / "ocr-asli.jpg"
    im.save(p, "JPEG", quality=95)
    o = ocr.OCR(cfg_uji())
    t0 = time.monotonic()
    h = o.baca([Frame(idx=1, detik=0, path=str(p), lebar=432, tinggi=768)])
    assert o.mode.startswith("easyocr"), (o.mode, o.error)
    mentah = " ".join(t.teks for t in h[0].teks)
    assert "TAYANG" in mentah.upper() and "DESEMBER" in mentah.upper(), mentah
    bersih = ocr.samarkan_handle([Frame(idx=1, detik=0, path=str(p), lebar=432, tinggi=768)], h)
    assert not any("clipper" in t.teks.lower() for t in bersih[0].teks), bersih
    o.tutup()
    return f"EasyOCR asli ({o.mode if o.reader else 'cpu'}, {time.monotonic() - t0:.1f} dtk): '{mentah}' → handle dibuang"


def t_visual():
    b = bahan()
    fr, _ = frames.pilih_frame(b["video"], TMP / "fr-vis", cfg_uji())
    d = TMP / "vis"
    d.mkdir(exist_ok=True)
    shutil.copy(b["poster"], d / "p1.jpg")
    poster_sintetis(d / "p2.jpg", seed=99)
    shutil.copy(b["trailer"], d / "t1.mp4")
    ref = ReferensiCampaign(campaign_id="c1", status="ada", materi=[
        MateriRef(id="p1", jenis="poster", nama="poster-resmi.jpg", path_lokal=str(d / "p1.jpg"), status="siap"),
        MateriRef(id="p2", jenis="poster", nama="poster-lain.jpg", path_lokal=str(d / "p2.jpg"), status="siap"),
        MateriRef(id="t1", jenis="trailer", nama="trailer.mp4", path_lokal=str(d / "t1.mp4"), status="siap")])
    h = visual.cocokkan_visual(fr, ref)
    ids = {c.material_id for c in h.cocok}
    assert h.status == "ada" and "p1" in ids and "p2" not in ids, h
    terbaik = [c for c in h.cocok if c.material_id == "p1"][0]
    assert 5.0 <= terbaik.detik <= 11.0, terbaik  # adegan poster = detik 5–11
    assert (d / "t1.sidik.json").exists()
    # gambar sama setelah dikecilkan + JPEG kasar → jarak kecil; gambar beda → jauh
    from PIL import Image

    Image.open(b["poster"]).resize((150, 225)).save(d / "kecil.jpg", "JPEG", quality=40)
    assert visual.jarak(visual.phash(b["poster"]), visual.phash(d / "kecil.jpg")) <= 6
    assert visual.jarak(visual.phash(b["poster"]), visual.phash(d / "p2.jpg")) > 16
    kosong = visual.cocokkan_visual(fr, ReferensiCampaign(campaign_id="c1", status="belum_ada"))
    assert kosong.status == "tidak_ada_referensi"
    hanya_lain = visual.cocokkan_visual(fr, ReferensiCampaign(campaign_id="c1", status="ada", materi=ref.materi[1:2]))
    assert hanya_lain.status == "tidak_ada", hanya_lain
    return f"poster resmi ditemukan di frame {terbaik.frame_idx} (detik {terbaik.detik}, jarak {terbaik.jarak}); poster lain tidak"


def t_musik_chroma():
    b = bahan()
    c = cfg_uji(musik="chroma")
    musik._mesin_cache.clear()
    assert musik.cek_mesin(c)[0] == "chroma"
    d = TMP / "mc"
    d.mkdir(exist_ok=True)
    ref = ReferensiCampaign(campaign_id="c1", status="ada", materi=[
        MateriRef(id="L1", jenis="lagu", nama="ost-utama.wav", path_lokal=str(_wav16(b["ref"], d / "L1.wav")), status="siap"),
        MateriRef(id="L2", jenis="lagu", nama="lagu-lain.wav", path_lokal=str(_wav16(b["lain"], d / "L2.wav")), status="siap")])
    q = ff.ambil_audio(b["video"], d / "q.wav")
    rt = RtPalsu(cfg=c)
    h = musik.cocokkan_musik(rt, q, ref, d)
    assert h.status == "cocok" and h.mesin == "chroma" and h.terbaik.material_id == "L1", h
    assert 14 <= h.terbaik.ref_mulai + 0 <= 26, h.terbaik  # potongan diambil dari detik 20 lagu
    assert h.terbaik.yakin <= musik.CHROMA_YAKIN_MAKS
    q2 = d / "q2.wav"
    ff.run(["-ss", "5", "-t", "16", "-i", str(b["lain"]), "-ar", "16000", "-ac", "1", str(q2)])
    ref1 = ReferensiCampaign(campaign_id="c1", status="ada", materi=ref.materi[:1])
    h2 = musik.cocokkan_musik(rt, q2, ref1, d)
    assert h2.status == "tidak_cocok", h2
    musik._mesin_cache.clear()
    return (f"chroma: lagu campaign (dipercepat 4%) cocok detik {h.terbaik.mulai}–{h.terbaik.selesai} di video, "
            f"{h.terbaik.ref_mulai}–{h.terbaik.ref_selesai} di lagu, yakin {h.terbaik.yakin}; lagu lain tidak cocok")


def _wav16(src: Path, dst: Path) -> Path:
    return ff.ambil_audio(src, dst, sr=16000)


def t_musik_panako_asli():
    c = cfg_uji(musik="panako")
    musik._mesin_cache.clear()
    if not panako_ada(c):
        CATATAN.append("Panako asli dilewati: Java / panako.jar tidak ditemukan (set SELFTEST_PANAKO_JAR)")
        return "dilewati"
    t0 = time.monotonic()
    mesin, pesan = musik.cek_mesin(c)
    assert mesin == "panako", (mesin, pesan)
    b = bahan()
    d = TMP / "mp"
    d.mkdir(exist_ok=True)
    ref = ReferensiCampaign(campaign_id="cpanako", status="ada", materi=[
        MateriRef(id="L1", jenis="lagu", nama="ost-utama.wav", path_lokal=str(_wav16(b["ref"], d / "L1.wav")), status="siap"),
        MateriRef(id="L2", jenis="lagu", nama="lagu-lain.wav", path_lokal=str(_wav16(b["lain"], d / "L2.wav")), status="siap")])
    rt = RtPalsu(cfg=c)
    musik.indeks_lagu(rt, "cpanako", ref.materi)
    assert list(musik.folder_indeks(c, "cpanako").glob("panako/*.tdb")), "cache sidik jari .tdb per campaign"
    q = ff.ambil_audio(b["video"], d / "q.wav")
    t1 = time.monotonic()
    h = musik.cocokkan_musik(rt, q, ref, d)
    dt = time.monotonic() - t1
    assert h.status == "cocok" and h.mesin == "panako" and h.terbaik.material_id == "L1", h
    assert 1.02 <= (h.terbaik.faktor_tempo or 0) <= 1.06, h.terbaik  # dipercepat 4%
    assert h.terbaik.mulai < 8 and h.terbaik.selesai > 9, h.terbaik
    assert h.terbaik.yakin >= 0.5
    q2 = d / "q2.wav"
    ff.run(["-ss", "5", "-t", "16", "-i", str(b["lain"]), "-ar", "16000", "-ac", "1", str(q2)])
    h2 = musik.cocokkan_musik(rt, q2, ReferensiCampaign(campaign_id="cpanako", status="ada", materi=ref.materi[:1]), d)
    assert h2.status == "tidak_cocok", h2
    salah = 0
    for sd in range(20, 26):  # 6 lagu acak lain → tidak boleh dianggap lagu campaign
        p = ff.ambil_audio(lagu_sintetis(d / f"acak{sd}.wav", sd, 20), d / f"acak{sd}-16.wav")
        salah += musik.cocokkan_musik(rt, p, ref, d).status == "cocok"
    assert salah == 0, f"{salah} salah-cocok"
    musik._mesin_cache.clear()
    return (f"Panako ASLI (strategi PANAKO, storage memori): cocok tempo ×{h.terbaik.faktor_tempo} nada ×{h.terbaik.faktor_nada}, "
            f"video {h.terbaik.mulai}–{h.terbaik.selesai} dtk ↔ lagu {h.terbaik.ref_mulai}–{h.terbaik.ref_selesai} dtk, "
            f"skor {h.terbaik.skor:.0f}, yakin {h.terbaik.yakin}; lagu lain tidak cocok; query {dt:.1f} dtk (total {time.monotonic() - t0:.0f} dtk)")


def t_musik_tanpa_java():
    musik._mesin_cache.clear()
    c = cfg_uji(java=str(TMP / "tidak-ada" / "java"), panako_jar=str(TMP / "tidak-ada.jar"))
    lama_path = os.environ.get("PATH", "")
    os.environ["PATH"] = str(TMP / "kosong")  # java dari PATH juga tidak ada
    try:
        mesin, pesan = musik.cek_mesin(c)
    finally:
        os.environ["PATH"] = lama_path
        musik._mesin_cache.clear()
    assert mesin == "chroma" and "cadangan" in pesan, (mesin, pesan)
    c2 = cfg_uji(musik="mati")
    assert musik.cek_mesin(c2)[0] == "tidak_ada"
    h = musik.cocokkan_musik(RtPalsu(cfg=c2), TMP / "a.wav", referensi_contoh(), TMP)
    assert h.status == "nonaktif"
    h2 = musik.cocokkan_musik(RtPalsu(cfg=cfg_uji(musik="chroma")), TMP / "a.wav",
                              ReferensiCampaign(campaign_id="x", status="belum_ada"), TMP)
    assert h2.status == "tidak_ada_referensi"
    musik._mesin_cache.clear()
    return f"tanpa Java → '{pesan}'; REVIEW_MUSIK=mati → nonaktif; tanpa lagu → tidak_ada_referensi"


def t_tautan_drive():
    t = materi.tautan_drive
    assert t("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing") == ("folder", "1AbCdEfGhIjKlMnOp")
    assert t("https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOpQ") == ("folder", "1AbCdEfGhIjKlMnOpQ")
    assert t("https://drive.google.com/file/d/1ZyXwVuTsRqPoNm/view?usp=drive_link") == ("file", "1ZyXwVuTsRqPoNm")
    assert t("https://drive.google.com/open?id=1ZyXwVuTsRqPoNm") == ("file", "1ZyXwVuTsRqPoNm")
    assert t("https://youtu.be/abc")[0] == "youtube"
    assert t("https://example.com/x") == (None, None)
    assert materi.tebak_jenis("OST Film X (Lyric Video).mp4") == "lagu"
    assert materi.tebak_jenis("Official Trailer.mov") == "trailer" and materi.tebak_jenis("KEY ART.png") == "poster"
    assert materi.tebak_jenis("brief.pdf") is None
    pilih = materi._pilih_kandidat([{"id": str(i), "nama": n, "size": s} for i, (n, s) in enumerate([
        ("Poster Resmi.jpg", 2e6), ("feed-1.jpg", 1e6), ("feed-2.jpg", 1e6), ("feed-3.jpg", 1e6), ("Trailer Final.mp4", 90e6),
        ("RAW master.mov", 2e9), ("ost.mp3", 5e6), ("brief.pdf", 1e5)])])
    nama = [p["nama"] for p in pilih]
    assert nama[0] == "ost.mp3" and "Poster Resmi.jpg" in nama and "Trailer Final.mp4" in nama and "RAW master.mov" not in nama, nama
    assert sum(1 for p in pilih if p["jenis"] == "poster") == 3
    return f"link Drive folder/file/open?id dikenali; folder besar → dipilih {nama}"


class _GdownPalsu:
    """gdown.download_folder / gdown.download ditambal: isi folder 'Drive' = file lokal"""

    def __init__(self, isi: dict[str, Path], private: bool = False):
        self.isi, self.private, self.unduh = isi, private, []

    def download_folder(self, id=None, output=None, quiet=False, use_cookies=True, skip_download=False, timeout=None, **kw):
        assert use_cookies is False and skip_download
        if self.private:
            raise RuntimeError("Cannot retrieve the folder information from the link. You may need to change the permission")
        G = types.SimpleNamespace
        return [G(id=k, path=f"Materi/{v.name}", local_path=str(Path(output) / v.name)) for k, v in self.isi.items()]

    def download(self, url=None, output=None, quiet=False, id=None, use_cookies=True, speed=None, progress=None, cancel=None, **kw):
        assert use_cookies is False and speed and speed > 0
        if self.private:
            raise RuntimeError("Cannot retrieve the public link of the file.")
        src = self.isi[id]
        self.unduh.append(src.name)
        n = src.stat().st_size
        for sudah in range(0, n + 1, max(1, n // 4)):
            if progress:
                progress(min(sudah, n), n)
            if cancel is not None and cancel.is_set():
                raise RuntimeError("DownloadCancelled")
        tujuan = Path(output) / src.name
        shutil.copy(src, tujuan)
        return str(tujuan)


def _rt_materi(supa=None, **kw):
    from palsu_db import SupaPalsu

    return RtPalsu(cfg=cfg_uji(musik=os.environ.get("SELFTEST_MUSIK", "chroma"), **kw), supa=supa if supa is not None else SupaPalsu())


def _brief(cid: str, links: list[str]) -> BriefCampaign:
    return BriefCampaign(campaign_id=cid, judul="Film X", brand="Studio X", materi_links=links,
                         poin=[PoinBrief(id="p01", kategori="cta", teks="Ajak nonton, tag @filmx_official")])


def t_materi_gdrive_palsu():
    import gdown

    b = bahan()
    besar = TMP / "besar-trailer.mp4"
    with open(besar, "wb") as f:  # 30 MB "trailer" palsu → melebihi batas uji 20 MB
        f.truncate(30 * 1024 * 1024)
    isi = {"idL": b["mp3"], "idP": b["poster"], "idT": b["trailer"], "idPdf": TMP / "brief.pdf", "idB": besar}
    (TMP / "brief.pdf").write_bytes(b"%PDF-1.4")
    palsu = _GdownPalsu(isi)
    asli = (gdown.download_folder, gdown.download)
    gdown.download_folder, gdown.download = palsu.download_folder, palsu.download
    lama_max = dict(materi.MAKS_FILE_MB)
    materi.MAKS_FILE_MB["trailer"] = 20
    try:
        rt = _rt_materi()
        cid = "c-gd1"
        camp = CampaignDB(id=cid, title="Film X", brief_detail={})
        prog = []
        ref = materi.siapkan_materi_campaign(rt, camp, _brief(cid, ["https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp"]),
                                             progres=lambda p, m: prog.append(p))
        rows = rt.supa.select("review_materials", campaign_id=f"eq.{cid}")
        jenis = sorted(r["kind"] for r in rows)
        assert jenis == ["lagu", "poster", "trailer"], jenis
        assert all(r["source"] == "gdrive" and r["status"] == "siap" and r["storage_path"].startswith(f"materi/{cid}/auto/")
                   for r in rows), rows
        assert all(r["storage_path"] in rt.supa.storage for r in rows)
        assert all(len(rt.supa.storage[r["storage_path"]][0]) <= materi.UPLOAD_MAKS for r in rows)
        tr = [r for r in rows if r["kind"] == "trailer"][0]
        assert tr["fingerprint"]["image"]["phash"] and tr["fingerprint"]["audio"]["ok"]
        po = [r for r in rows if r["kind"] == "poster"][0]
        assert len(po["fingerprint"]["image"]["phash"]) >= 2
        camp_row = rt.supa.select("review_campaigns", campaign_id=f"eq.{cid}")[0]
        assert camp_row["materi_status"] == "ada", camp_row
        assert ref.status == "ada" and ref.ada("lagu") and ref.ada("poster") and ref.ada("trailer"), ref
        gd = json.loads((materi.folder_campaign(rt.cfg, cid) / "materi.json").read_text(encoding="utf-8"))["gdrive"]
        assert gd["hasil"] == "sebagian" and "terlalu besar" in gd["pesan"], gd  # trailer 30 MB > batas → dibatalkan
        assert prog and prog[-1] == 1.0
        assert not (Path(rt.cfg.tmp) / f"materi-{cid}").exists(), "folder unduhan sementara dihapus"
        n = len(palsu.unduh)
        materi.siapkan_materi_campaign(rt, camp, _brief(cid, ["https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp"]))
        assert len(palsu.unduh) == n, "link sama → tidak diunduh ulang"
        materi.siapkan_materi_campaign(rt, camp, _brief(cid, ["https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp"]), paksa=True)
        assert len(palsu.unduh) > n and len(rt.supa.select("review_materials", campaign_id=f"eq.{cid}")) == 3, "paksa → duplikat sha dilewati"
    finally:
        gdown.download_folder, gdown.download = asli
        materi.MAKS_FILE_MB.clear()
        materi.MAKS_FILE_MB.update(lama_max)
    return f"gdown palsu: lagu+poster+trailer siap & diunggah, file besar/pdf dilewati, status 'ada' ({camp_row['materi_message']})"


def t_materi_private_dan_kosong():
    import gdown

    palsu = _GdownPalsu({}, private=True)
    asli = (gdown.download_folder, gdown.download)
    gdown.download_folder, gdown.download = palsu.download_folder, palsu.download
    try:
        rt = _rt_materi()
        ref = materi.siapkan_materi_campaign(rt, CampaignDB(id="c-priv"), _brief("c-priv", ["https://drive.google.com/drive/folders/1PrivAteFolDer1"]))
        assert ref.status == "belum_ada" and "private" in ref.pesan.lower() and "upload manual" in ref.pesan.lower(), ref
        row = rt.supa.select("review_campaigns", campaign_id="eq.c-priv")[0]
        assert row["materi_status"] == "belum_ada"
        ref2 = materi.siapkan_materi_campaign(rt, CampaignDB(id="c-kosong"), _brief("c-kosong", []))
        assert ref2.status == "belum_ada" and "tidak mencantumkan" in ref2.pesan, ref2
        rt_lokal = RtPalsu(cfg=cfg_uji())  # tanpa Supabase sama sekali → tetap jalan (manifest lokal)
        ref3 = materi.siapkan_materi_campaign(rt_lokal, CampaignDB(id="c-lokal"), _brief("c-lokal", []))
        assert ref3.status == "belum_ada"
    finally:
        gdown.download_folder, gdown.download = asli
    return f"private → '{ref.pesan}'; tanpa link → belum_ada; tanpa Supabase tetap jalan"


def t_materi_manual_dan_pulih():
    b = bahan()
    rt = _rt_materi()
    s = rt.supa
    cid = "c-man"
    s.upload(f"materi/{cid}/manual/lagu-ost.mp3", b["mp3"], "audio/mpeg")
    s.upload(f"materi/{cid}/manual/poster.jpg", b["poster"], "image/jpeg")
    s.upload(f"materi/{cid}/manual/rusak.mp3", b"bukan audio", "audio/mpeg")
    for nama, kind in (("lagu-ost.mp3", "lagu"), ("poster.jpg", "poster"), ("rusak.mp3", "lagu")):
        s.insert("review_materials", {"campaign_id": cid, "kind": kind, "source": "manual", "status": "antri_sidik",
                                      "storage_path": f"materi/{cid}/manual/{nama}", "file_name": nama, "mime": "x"})
    s.insert("review_campaigns", {"campaign_id": cid, "materi_status": "belum_ada"}, on_conflict="campaign_id", merge=True)
    n = materi.proses_upload_manual(rt)
    rows = {r["file_name"]: r for r in s.select("review_materials", campaign_id=f"eq.{cid}")}
    assert n == 2, n
    assert rows["lagu-ost.mp3"]["status"] == "siap" and rows["lagu-ost.mp3"]["fingerprint"]["audio"]["ok"]
    assert rows["poster.jpg"]["status"] == "siap" and rows["poster.jpg"]["fingerprint"]["image"]["phash"]
    assert rows["rusak.mp3"]["status"] == "gagal" and rows["rusak.mp3"]["message"], rows["rusak.mp3"]
    camp = s.select("review_campaigns", campaign_id=f"eq.{cid}")[0]
    assert camp["materi_status"] == "ada", camp
    ref = materi.referensi_campaign(rt, cid)
    assert ref.ada("lagu") and ref.ada("poster")
    # file lokal hilang (folder data dihapus) → dipulihkan dari bucket
    shutil.rmtree(materi.folder_campaign(rt.cfg, cid))
    rt.cache.clear()
    ref2 = materi.referensi_campaign(rt, cid)
    assert ref2.ada("lagu") and ref2.ada("poster") and all(Path(m.path_lokal).exists() for m in ref2.materi if m.status == "siap"), ref2
    # materi dihapus di website → hilang juga di laptop
    s.delete("review_materials", {"file_name": "eq.poster.jpg"})
    rt.cache.clear()
    assert not materi.referensi_campaign(rt, cid).ada("poster")
    return "upload manual: 2 siap (sidik audio + pHash), file rusak → gagal + pesan; file lokal hilang → dipulihkan dari bucket"


def _rt_susun(musik_mesin: str):
    from palsu_db import SupaPalsu

    rt = RtPalsu(cfg=cfg_uji(musik=musik_mesin), supa=SupaPalsu())
    mod, _ = _whisper_palsu(gagal_cuda=False)
    sys.modules["faster_whisper"] = mod
    (TMP / "whisper-ada").mkdir(exist_ok=True)
    rt.cfg.whisper_cache = TMP / "whisper-ada"

    class ReaderPalsu:  # OCR palsu: membaca teks yang memang digambar di adegan 1 (lihat bahan())
        def readtext(self, path, detail=1, paragraph=False):
            import cv2

            im = cv2.imread(path)
            if im is None or abs(int(im[30, 30][0]) - 0xa0) > 30:  # hanya frame adegan biru
                return []
            h, w = im.shape[:2]
            s = w / 1080
            return [([[40 * s, 120 * s], [600 * s, 120 * s], [600 * s, 190 * s], [40 * s, 190 * s]], "@clipper_rahasia", 0.88),
                    ([[100 * s, 1340 * s], [980 * s, 1340 * s], [980 * s, 1430 * s], [100 * s, 1430 * s]], "TAYANG 12 DESEMBER", 0.93)]

    o = ocr.dapatkan(rt)
    o.reader, o.mode = ReaderPalsu(), "easyocr-cpu"
    return rt


def t_susun_ujung_ke_ujung():
    import gdown

    b = bahan()
    url = server()
    mesin = "panako" if panako_ada(cfg_uji()) else "chroma"
    musik._mesin_cache.clear()
    rt = _rt_susun(mesin)
    cid = "c-e2e"
    palsu = _GdownPalsu({"idL": b["mp3"], "idP": b["poster"], "idT": b["trailer"]})
    asli = (gdown.download_folder, gdown.download)
    gdown.download_folder, gdown.download = palsu.download_folder, palsu.download
    try:
        brief = _brief(cid, ["https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp"])
        ref = materi.siapkan_materi_campaign(rt, CampaignDB(id=cid), brief)
    finally:
        gdown.download_folder, gdown.download = asli
    video = VideoDB(id="900001", campaign_id=cid, url=f"{url}/clipper.mp4", platform="tiktok", platform_video_id="7300000000000000001",
                    caption="Seru banget! follow @clipper_rahasia, WA 081234567890, link bio https://bit.ly/x #FilmX #Konten",
                    hashtags=[], hashtag_present=True, bot_score=0.1, current_views=1200)
    kerja = Path(rt.cfg.tmp) / video.id
    t0 = time.monotonic()
    m = susun.buat_materi_video(rt, video, brief, ref, kerja)
    dt = time.monotonic() - t0
    MateriVideo.model_validate(m.model_dump())
    assert m.status == "ok", (m.status, m.error)
    assert 6 <= len(m.frames) <= 10 and all(Path(f.path).exists() for f in m.frames)
    assert m.meta.durasi_detik and 15 <= m.meta.durasi_detik <= 17 and m.meta.resolusi == "1080x1920"
    assert m.meta.hashtags == ["#filmx", "#konten"], m.meta.hashtags
    js = json.dumps(m.model_dump(), ensure_ascii=False)
    for bocor in ("clipper_rahasia", "081234567890", "bit.ly", "127.0.0.1", "http://", "https://"):
        assert bocor not in js, bocor
    assert any("TAYANG 12 DESEMBER" in t.teks for o in m.ocr for t in o.teks), m.ocr
    assert m.transkrip.segmen and "@filmx_official" in m.transkrip.teks_penuh
    assert m.musik.status == "cocok" and m.musik.mesin == mesin and m.musik.terbaik.nama.startswith("ost-utama"), m.musik
    assert m.visual.status == "ada" and any(c.jenis == "poster" for c in m.visual.cocok), m.visual
    assert set(m.waktu_tahap) >= {"unduh", "frame", "ocr", "asr", "musik", "visual"}, m.waktu_tahap
    assert not list((kerja / "unduh").glob("video.*")), "file video dihapus sesudah frame & audio diambil"
    assert rt.gpu.tahap == ["ocr", "asr"], rt.gpu.tahap
    # frame adegan 1 yang memuat @handle sudah diburamkan (bukan JPEG asli)
    return (f"MateriVideo lengkap dalam {dt:.1f} dtk (mesin musik {mesin}): {len(m.frames)} frame, OCR bersih, transkrip, "
            f"musik cocok yakin {m.musik.terbaik.yakin}, visual {len(m.visual.cocok)} cocok; tanpa username/no HP/link")


def t_susun_tidak_bisa_diakses_dan_batal():
    url = server()
    rt = _rt_susun("chroma")
    brief = _brief("c-x", [])
    ref = ReferensiCampaign(campaign_id="c-x", status="belum_ada")
    v = VideoDB(id="900002", campaign_id="c-x", url=f"{url}/hilang.mp4", caption="halo @clipper_rahasia")
    m = susun.buat_materi_video(rt, v, brief, ref, Path(rt.cfg.tmp) / v.id)
    assert m.status == "tidak_bisa_diakses" and m.error and not m.frames and "clipper" not in m.meta.caption, m
    v2 = VideoDB(id="900003", campaign_id="c-x", url=None)
    assert susun.buat_materi_video(rt, v2, brief, ref, Path(rt.cfg.tmp) / v2.id).status == "tidak_bisa_diakses"
    v3 = VideoDB(id="900004", campaign_id="c-x", url=f"{url}/clipper.mp4")
    n = {"x": 0}

    def batal():
        n["x"] += 1
        if n["x"] >= 2:
            raise Cancelled("dibatalkan")

    try:
        susun.buat_materi_video(rt, v3, brief, ref, Path(rt.cfg.tmp) / v3.id, cek_batal=batal)
        raise AssertionError("Cancelled harus diteruskan")
    except Cancelled:
        pass
    v4 = VideoDB(id="900005", campaign_id="c-x", url=f"{url}/ost-utama.mp3")  # bukan video
    m4 = susun.buat_materi_video(rt, v4, brief, ref, Path(rt.cfg.tmp) / v4.id)
    assert m4.status in ("tidak_bisa_diakses", "gagal"), m4.status
    return f"404 → '{m.error}'; tanpa link → tidak_bisa_diakses; batal diteruskan; file audio → {m4.status}"


def t_susun_ocr_mati_tetap_samar():
    """REVIEW_OCR=mati / EasyOCR gagal: frame ke AI tetap tanpa watermark @username (pita atas-kiri diburamkan)"""
    import cv2

    url = server()
    hasil = []
    for varian in ("mati", "error"):
        rt = _rt_susun("chroma")
        o = ocr.dapatkan(rt)
        if varian == "mati":
            o.reader, o.mode = None, "mati"
        else:
            class ReaderRusak:
                def readtext(self, path, detail=1, paragraph=False):
                    raise RuntimeError("CUDA error")

            o.reader = ReaderRusak()
        v = VideoDB(id=f"90001{len(hasil)}", campaign_id="c-x", url=f"{url}/clipper.mp4")
        m = susun.buat_materi_video(rt, v, _brief("c-x", []), ReferensiCampaign(campaign_id="c-x", status="belum_ada"),
                                    Path(rt.cfg.tmp) / v.id)
        assert m.status == "ok" and m.frames and m.ocr == [], (m.status, m.ocr)
        biru = 0
        for f in m.frames:
            im = cv2.imread(f.path)
            h, w = im.shape[:2]
            if abs(int(im[h // 2, 5][0]) - 0xa0) > 30:
                continue  # hanya adegan biru yang memuat "@clipper_rahasia" di kiri atas
            biru += 1
            s = w / 1080
            k = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)[int(110 * s):int(200 * s), int(40 * s):int(600 * s)]
            assert float(k.std()) < 12, f"teks @clipper_rahasia masih tajam (std {k.std():.1f}) di frame {f.idx}"
        assert biru, "adegan biru harus terpilih"
        hasil.append(f"{varian}: {biru} frame berwatermark diburamkan")
    return "; ".join(hasil)


def t_palsu_media():
    for v in ("lengkap", "tanpa_cta", "tanpa_musik", "tidak_bisa_diakses", "gagal"):
        m = materi_contoh("1", v, folder=TMP / f"pm-{v}")
        MateriVideo.model_validate(m.model_dump())
        if m.status == "ok":
            assert 6 <= len(m.frames) <= 10 and all(Path(f.path).exists() for f in m.frames)
    assert "12 Desember" not in materi_contoh("1", "tanpa_cta", folder=TMP / "pm2").transkrip.teks_penuh
    r = referensi_contoh(lagu=False)
    assert not r.ada("lagu") and r.ada("poster") and r.status == "sebagian"
    g = GpuPalsu()
    with g.pegang("asr") as ok:
        assert ok
    return "materi_contoh 5 varian sah + referensi_contoh + GpuPalsu"


def t_driver_dan_lisensi():
    src = (ROOT / "tools" / "PanakoSekali.java").read_text(encoding="utf-8")
    assert "AGPL-3.0" in src and "PANAKO_STORAGE" in src and "MEM" in src
    ps = (ROOT / "tools" / "pasang-panako.ps1").read_bytes()
    assert ps.isascii(), "pasang-panako.ps1 harus ASCII (PowerShell 5.1)"
    assert b"\r\n" in ps, "pasang-panako.ps1 harus CRLF"
    for kata in (b"Temurin", b"PanakoSekali", b"repo.maven.apache.org", b"lmdbjava"):
        assert kata in ps, kata
    req = (ROOT / "requirements-gpu.txt").read_text(encoding="utf-8")
    assert "easyocr==1.7.2" in req
    return "PanakoSekali.java AGPL + storage memori; pasang-panako.ps1 ASCII/CRLF; requirements-gpu.txt"


TES = [t_ffmpeg_dasar, t_frame_pilih, t_frame_pendek, t_unduh_ytdlp_lokal, t_unduh_pesan, t_asr_palsu, t_ocr_samarkan,
       t_ocr_mati_dan_palsu, t_ocr_handle_samar_diburamkan, t_ocr_tanpa_ocr_zona_watermark, t_ocr_easyocr_asli, t_visual, t_musik_chroma, t_musik_panako_asli, t_musik_tanpa_java, t_tautan_drive,
       t_materi_gdrive_palsu, t_materi_private_dan_kosong, t_materi_manual_dan_pulih, t_susun_ujung_ke_ujung,
       t_susun_tidak_bisa_diakses_dan_batal, t_susun_ocr_mati_tetap_samar, t_palsu_media, t_driver_dan_lisensi]


def main(argv: list[str]) -> int:
    pilih = [t for t in TES if not argv or t.__name__ in argv or t.__name__[2:] in argv]
    gagal = 0
    t_all = time.monotonic()
    for t in pilih:
        t0 = time.monotonic()
        try:
            hasil = t()
            print(f"OK    {t.__name__:<40} {time.monotonic() - t0:5.1f}s  {hasil}")
        except Exception:  # noqa: BLE001
            gagal += 1
            print(f"GAGAL {t.__name__:<40} {time.monotonic() - t0:5.1f}s")
            traceback.print_exc()
    for c in CATATAN:
        print(f"CATATAN: {c}")
    print(f"\n{len(pilih) - gagal}/{len(pilih)} lolos dalam {time.monotonic() - t_all:.0f} dtk")
    shutil.rmtree(TMP, ignore_errors=True)
    return 1 if gagal else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
