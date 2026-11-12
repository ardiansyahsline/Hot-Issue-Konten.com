"""Materi referensi per campaign (pemilik: worker-media). KONTRAK.md §4.3.
Otomatis: link brief_detail.materi → gdown (link publik, tanpa cookies; opsional GOOGLE_DRIVE_API_KEY untuk daftar isi folder),
sekali per campaign (status di review_campaigns.materi_*), folder besar → hanya poster (jpg/png/webp), trailer (mp4/mov →
potongan ≤ 180 dtk 540p + audio penuh + keyframe), audio (mp3/wav/m4a…), total ≤ REVIEW_MATERI_MAX_MB. Upload ke bucket
asisten-review materi/<campaign>/auto/…, baris review_materials source 'gdrive'. Manual: baris 'antri_sidik' dari website →
unduh dari bucket, buat sidik jari (Panako store / pHash) → 'siap'. Gagal / private → materi_status 'belum_ada' + pesan awam.

Lokal (data/materi/<campaign>/, di-gitignore): <id>.wav (lagu / audio trailer, 16 kHz mono), <id>.jpg (poster), <id>.mp4
(potongan trailer), <id>.sidik.json (pHash/dHash), panako/ (cache sidik jari Panako), materi.json (manifest + status unduhan
Google Drive; dipakai juga kalau Supabase tidak terjangkau). Materi = data brand, bukan data clipper."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import parse_qs, urlparse

from ..log import get
from ..skema import BriefCampaign, CampaignDB, MateriRef, ReferensiCampaign
from . import ff, musik, visual
from .unduh import TidakBisaDiakses, _rate_bytes, unduh_video

log = get("materi")
EXT_GAMBAR = {".jpg", ".jpeg", ".png", ".webp"}
EXT_AUDIO = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".flac", ".wma"}
EXT_VIDEO = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
MAKS_FILE_MB = {"poster": 25, "lagu": 80, "trailer": 400}
MAKS_JUMLAH = {"poster": 3, "lagu": 4, "trailer": 2}
TRAILER_DETIK = 180.0
LAGU_DETIK = 600.0
UPLOAD_MAKS = 49 * 1024 * 1024  # bucket asisten-review ≤ 50 MB/file
CACHE_DETIK = 600.0  # rt.cache["ref"] dianggap segar selama ini
_KATA_LAGU = re.compile(r"\b(ost|soundtrack|lagu|song|music|musik|audio|bgm|lyric|lirik|instrumental|jingle|sound)\b", re.I)
_KATA_POSTER = re.compile(r"(poster|key ?art|keyart|official|thumbnail|cover)", re.I)
_KATA_TRAILER = re.compile(r"(trailer|teaser|official)", re.I)
_KATA_BURUK = re.compile(r"(bts|behind|raw|master|proxy|project|\.prproj|draft)", re.I)
_lock = threading.Lock()


class _MateriGagal(Exception):
    """pesan awam untuk review_materials.message"""


# ------------------------------------------------------------------ lokal
def folder_campaign(cfg, campaign_id: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", campaign_id or ""):
        raise ValueError("campaign_id tidak valid")
    d = Path(getattr(cfg, "materi", Path("data/materi"))) / campaign_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _manifest_path(cfg, cid: str) -> Path:
    return folder_campaign(cfg, cid) / "materi.json"


def _muat_manifest(cfg, cid: str) -> dict:
    p = _manifest_path(cfg, cid)
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(d, dict):
            d.setdefault("items", {})
            return d
    except (OSError, ValueError):
        pass
    return {"items": {}, "gdrive": None}


def _simpan_manifest(cfg, cid: str, d: dict) -> None:
    p = _manifest_path(cfg, cid)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    tmp.replace(p)


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def _nama_aman(nama: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(nama).name).strip("-.") or "file"
    stem, ext = os.path.splitext(base)
    return (stem[:60] or "file") + ext[:8].lower()


def _mime(path: Path) -> str:
    ext = path.suffix.lower()
    return {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp3": "audio/mpeg",
            ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".oga": "audio/ogg",
            ".opus": "audio/ogg", ".flac": "audio/flac", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
            ".m4v": "video/mp4"}.get(ext, "application/octet-stream")


def tebak_jenis(nama: str, mime: str = "") -> Optional[str]:
    """nama file / MIME → lagu / poster / trailer (None = bukan materi yang dipakai)"""
    ext = Path(nama or "").suffix.lower()
    mime = (mime or "").lower()
    if ext in EXT_AUDIO or mime.startswith("audio/"):
        return "lagu"
    if ext in EXT_GAMBAR or mime.startswith("image/"):
        return "poster"
    if ext in EXT_VIDEO or mime.startswith("video/"):
        return "lagu" if _KATA_LAGU.search(Path(nama).stem.replace("_", " ")) else "trailer"
    return None


def _skor_nama(nama: str, jenis: str) -> int:
    n = Path(nama).stem.replace("_", " ")
    s = {"poster": 3 if _KATA_POSTER.search(n) else 0, "trailer": 3 if _KATA_TRAILER.search(n) else 0,
         "lagu": 3 if _KATA_LAGU.search(n) else 0}.get(jenis, 0)
    return s - (4 if _KATA_BURUK.search(n) else 0)


# ------------------------------------------------------------------ olah satu file → materi lokal siap
def _olah(cfg, cid: str, mid: str, src: Path, jenis: str) -> dict:
    """src (file mentah) → file lokal ternormalisasi + sidik gambar. → {path, durasi, image, upload: Path, mime}"""
    d = folder_campaign(cfg, cid)
    if jenis == "lagu":
        wav = d / f"{mid}.wav"
        ff.ambil_audio(src, wav, sr=16000, maks_detik=LAGU_DETIK)
        dur = ff.durasi(wav)
        if dur < 3:
            raise _MateriGagal("Audio terlalu pendek / kosong.")
        up = src if src.suffix.lower() in EXT_AUDIO and src.stat().st_size <= UPLOAD_MAKS else wav
        return {"path": wav, "durasi": dur, "image": None, "upload": up, "mime": _mime(up)}
    if jenis == "poster":
        from PIL import Image, ImageOps

        jpg = d / f"{mid}.jpg"
        try:
            with Image.open(src) as im:
                im = ImageOps.exif_transpose(im).convert("RGB")
                im.thumbnail((1600, 1600))
                im.save(jpg, "JPEG", quality=88)
        except Exception as e:  # noqa: BLE001
            raise _MateriGagal("Gambar tidak bisa dibuka.") from e
        img = visual.sidik_gambar(jpg)
        (d / f"{mid}.sidik.json").write_text(json.dumps({"image": img}), encoding="utf-8")
        return {"path": jpg, "durasi": None, "image": img, "upload": jpg, "mime": "image/jpeg"}
    if jenis == "trailer":
        if not ff.ada_video(src):
            raise _MateriGagal("File trailer tidak berisi video.")
        dur = ff.durasi(src)
        mp4 = d / f"{mid}.mp4"
        lama = min(dur or TRAILER_DETIK, TRAILER_DETIK)
        ff.potong(src, mp4, 0.0, lama, tinggi_maks=540, crf=30)
        if mp4.stat().st_size > UPLOAD_MAKS:
            ff.potong(src, mp4, 0.0, lama, tinggi_maks=360, crf=34)
        if ff.ada_audio(src):  # audio trailer penuh (≤ 10 mnt) ikut diindeks Panako — clipper sering memakai audio trailer
            try:
                ff.ambil_audio(src, d / f"{mid}.wav", sr=16000, maks_detik=LAGU_DETIK)
            except ff.FFError:
                pass
        img = visual.sidik_video(mp4)
        (d / f"{mid}.sidik.json").write_text(json.dumps({"image": img}), encoding="utf-8")
        return {"path": mp4, "durasi": ff.durasi(mp4), "image": img, "upload": mp4, "mime": "video/mp4"}
    raise _MateriGagal("Jenis file tidak dikenal (pakai lagu / gambar poster / video trailer).")


def _ringkas_image(img: Optional[dict]) -> Optional[dict]:
    """fingerprint.image di Supabase: poster utuh; trailer dibatasi 60 keyframe (sidecar lokal tetap lengkap)"""
    if not img:
        return None
    if img.get("phash") and isinstance(img["phash"][0], list):
        return {"phash": img["phash"][:60], "dhash": (img.get("dhash") or [])[:60], "detik": (img.get("detik") or [])[:60]}
    return img


def _path_lokal(cfg, cid: str, mid: str, jenis: str) -> Path:
    ext = {"lagu": ".wav", "poster": ".jpg", "trailer": ".mp4"}.get(jenis, ".bin")
    return Path(getattr(cfg, "materi", Path("data/materi"))) / cid / f"{mid}{ext}"


# ------------------------------------------------------------------ Supabase kecil (semua error → None, tidak pernah crash)
def _sb(rt, fn: str, *a, **kw):
    s = getattr(rt, "supa", None)
    if s is None:
        return None
    try:
        return getattr(s, fn)(*a, **kw)
    except Exception as e:  # noqa: BLE001
        log.warning("Supabase %s gagal (%s)", fn, type(e).__name__)
        return None


def _set_status(rt, cid: str, status: str, pesan: str) -> None:
    _sb(rt, "insert", "review_campaigns", {"campaign_id": cid, "materi_status": status, "materi_message": pesan[:300],
                                           "materi_checked_at": _now()}, on_conflict="campaign_id", merge=True)
    m = _muat_manifest(rt.cfg, cid)
    m["status"], m["pesan"] = status, pesan
    _simpan_manifest(rt.cfg, cid, m)
    rt.cache.setdefault("ref", {}).pop(cid, None)


def _now() -> str:
    try:
        from ..supa import now_iso

        return now_iso()
    except Exception:  # stub / belum ada
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ------------------------------------------------------------------ Google Drive
def tautan_drive(link: str) -> tuple[Optional[str], Optional[str]]:
    """→ (jenis 'folder' / 'file' / 'youtube' / None, id)"""
    try:
        u = urlparse(str(link).strip())
    except ValueError:
        return None, None
    host = (u.netloc or "").lower()
    if host.endswith("youtube.com") or host.endswith("youtu.be"):
        return "youtube", None
    if not (host.endswith("drive.google.com") or host.endswith("docs.google.com") or host.endswith("drive.usercontent.google.com")):
        return None, None
    m = re.search(r"/folders/([A-Za-z0-9_-]{10,})", u.path)
    if m:
        return "folder", m.group(1)
    m = re.search(r"/file/d/([A-Za-z0-9_-]{10,})", u.path)
    if m:
        return "file", m.group(1)
    q = parse_qs(u.query)
    if q.get("id"):
        return ("folder" if "folder" in u.path else "file"), q["id"][0]
    return None, None


def _api_key() -> str:
    return (os.environ.get("GOOGLE_DRIVE_API_KEY") or "").strip()


def _daftar_api(fid: str, kedalaman: int = 0) -> list[dict]:
    """Drive API v3 (GOOGLE_DRIVE_API_KEY, folder publik): [{id, nama, mime, size}] — rekursif 2 tingkat"""
    import httpx

    out, token = [], None
    with httpx.Client(timeout=30) as c:
        while True:
            params = {"q": f"'{fid}' in parents and trashed = false", "fields": "nextPageToken,files(id,name,mimeType,size)",
                      "pageSize": 200, "key": _api_key(), "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"}
            if token:
                params["pageToken"] = token
            r = c.get("https://www.googleapis.com/drive/v3/files", params=params)
            if r.status_code in (403, 404):
                raise _MateriGagal("Folder Google Drive private / tidak bisa dibaca dengan API key.")
            r.raise_for_status()
            j = r.json()
            for f in j.get("files", []):
                if f.get("mimeType") == "application/vnd.google-apps.folder":
                    if kedalaman < 2:
                        out += _daftar_api(f["id"], kedalaman + 1)
                    continue
                out.append({"id": f["id"], "nama": f.get("name") or f["id"], "mime": f.get("mimeType") or "",
                            "size": int(f["size"]) if f.get("size") else None})
            token = j.get("nextPageToken")
            if not token:
                return out


def _daftar_gdown(fid: str, kerja: Path) -> list[dict]:
    import gdown

    try:
        files = gdown.download_folder(id=fid, output=str(kerja), quiet=True, use_cookies=False, skip_download=True, timeout=30)
    except Exception as e:  # noqa: BLE001 — private / bukan folder / diblokir
        raise _MateriGagal("Folder Google Drive private / tidak bisa diunduh otomatis.") from e
    return [{"id": f.id, "nama": Path(str(f.path)).name, "mime": "", "size": None} for f in (files or [])]


def _unduh_drive(fid: str, tujuan_dir: Path, batas: int, cfg, nama: Optional[str] = None) -> Path:
    """satu file Drive → tujuan_dir. Dibatalkan otomatis kalau melewati batas byte (file terlalu besar)."""
    tujuan_dir.mkdir(parents=True, exist_ok=True)
    rate = _rate_bytes(getattr(cfg, "dl_rate", "4M"))
    if _api_key():
        import httpx

        nm = _nama_aman(nama or fid)
        out = tujuan_dir / nm
        n = 0
        with httpx.Client(timeout=60, follow_redirects=True) as c, \
                c.stream("GET", f"https://www.googleapis.com/drive/v3/files/{fid}",
                         params={"alt": "media", "key": _api_key(), "supportsAllDrives": "true"}) as r:
            if r.status_code in (403, 404):
                raise _MateriGagal("File Google Drive private / tidak bisa diunduh.")
            r.raise_for_status()
            mulai = time.monotonic()
            with open(out, "wb") as f:
                for b in r.iter_bytes(1 << 16):
                    n += len(b)
                    if n > batas:
                        raise _MateriGagal("File terlalu besar untuk diunduh otomatis.")
                    f.write(b)
                    harus = n / rate - (time.monotonic() - mulai)  # batas laju sama dengan unduh video
                    if harus > 0:
                        time.sleep(min(harus, 1.0))
        return out
    import gdown

    batal = threading.Event()
    besar = {"x": False}

    def progres(sudah: int, total: Optional[int]) -> None:
        if (total and total > batas) or sudah > batas:
            besar["x"] = True
            batal.set()

    try:
        hasil = gdown.download(id=fid, output=str(tujuan_dir) + os.sep, quiet=True, use_cookies=False, speed=rate, timeout=60,
                               retries=1, progress=progres, cancel=batal)
    except Exception as e:  # noqa: BLE001
        for sisa in tujuan_dir.glob("*.part"):
            sisa.unlink(missing_ok=True)
        if besar["x"]:
            raise _MateriGagal("File terlalu besar untuk diunduh otomatis.") from e
        raise _MateriGagal("File Google Drive private / tidak bisa diunduh otomatis.") from e
    if not hasil or not Path(str(hasil)).exists():
        raise _MateriGagal("File Google Drive tidak bisa diunduh.")
    return Path(str(hasil))


def _pilih_kandidat(files: list[dict]) -> list[dict]:
    """pilih poster / trailer / lagu dari isi folder (urut: lagu → poster → trailer, kecil dulu)"""
    per: dict[str, list[dict]] = {"lagu": [], "poster": [], "trailer": []}
    for f in files:
        j = tebak_jenis(f["nama"], f.get("mime", ""))
        if j is None:
            continue
        if f.get("size") and f["size"] > MAKS_FILE_MB[j] * 1024 * 1024:
            continue
        per[j].append(dict(f, jenis=j, skor=_skor_nama(f["nama"], j)))
    out = []
    for j in ("lagu", "poster", "trailer"):
        per[j].sort(key=lambda f: (-f["skor"], f.get("size") or 0, f["nama"]))
        out += [f for f in per[j] if f["skor"] > -3][:MAKS_JUMLAH[j]]
    return out


# ------------------------------------------------------------------ simpan materi (lokal + Supabase)
def _baris_supabase(rt, cid: str) -> Optional[list[dict]]:
    return _sb(rt, "select", "review_materials", campaign_id=f"eq.{cid}",
               select="id,campaign_id,kind,source,status,storage_path,file_name,mime,size_bytes,duration_sec,sha256,fingerprint,message",
               order="created_at.asc")


def _daftarkan(rt, cid: str, src: Path, jenis: str, nama_asli: str, sumber: str = "gdrive", mid: Optional[str] = None,
               storage_path: Optional[str] = None) -> Optional[dict]:
    """olah file + simpan manifest + (gdrive) upload & insert / (manual) update baris. → item manifest, None kalau duplikat"""
    sha = _sha256(src)
    man = _muat_manifest(rt.cfg, cid)
    if sumber == "gdrive" and any(it.get("sha256") == sha for it in man["items"].values()):
        return None
    mid = mid or str(uuid.uuid4())
    hasil = _olah(rt.cfg, cid, mid, src, jenis)
    up: Path = hasil["upload"]
    if storage_path is None:
        storage_path = f"materi/{cid}/auto/{sha[:10]}-{_nama_aman(nama_asli)}"
        if Path(storage_path).suffix.lower() != up.suffix.lower():
            storage_path = str(Path(storage_path).with_suffix(up.suffix.lower())).replace("\\", "/")
    item = {"id": mid, "jenis": jenis, "nama": Path(nama_asli).name[:120], "sumber": sumber, "status": "siap",
            "storage_path": storage_path, "sha256": sha, "file": Path(hasil["path"]).name,
            "durasi": hasil["durasi"], "waktu": _now()}
    fp = {"image": _ringkas_image(hasil["image"])} if hasil["image"] else {}
    if jenis in ("lagu", "trailer") and (jenis == "lagu" or (folder_campaign(rt.cfg, cid) / f"{mid}.wav").exists()):
        fp["audio"] = {"mesin": musik.cek_mesin(rt.cfg)[0], "ok": True, "durasi": hasil["durasi"]}
    baris = {"id": mid, "campaign_id": cid, "kind": jenis, "source": sumber, "status": "siap", "storage_path": storage_path,
             "file_name": item["nama"], "mime": hasil["mime"], "size_bytes": up.stat().st_size,
             "duration_sec": hasil["durasi"], "sha256": sha, "fingerprint": fp, "message": None}
    if sumber == "gdrive":
        if getattr(rt, "supa", None) is not None:
            if _sb(rt, "upload", storage_path, up, hasil["mime"]) is None:
                item["status_upload"] = "gagal"  # tetap dipakai lokal; diunggah ulang kali berikutnya
            elif _sb(rt, "insert", "review_materials", baris, on_conflict="campaign_id,sha256", ignore=True) is None:
                item["status_upload"] = "gagal"
    else:
        _sb(rt, "update", "review_materials", {"id": f"eq.{mid}"},
            {k: baris[k] for k in ("status", "mime", "size_bytes", "duration_sec", "sha256", "fingerprint", "message")})
    with _lock:
        man = _muat_manifest(rt.cfg, cid)
        man["items"][mid] = item
        _simpan_manifest(rt.cfg, cid, man)
    return item


def _hitung_status(items: list[dict], pesan_gdrive: str) -> tuple[str, str]:
    siap = [i for i in items if i.get("status") == "siap"]
    ada_lagu = any(i["jenis"] == "lagu" for i in siap)
    ada_visual = any(i["jenis"] in ("poster", "trailer") for i in siap)
    if ada_lagu and ada_visual:
        return "ada", f"{len(siap)} materi siap (lagu & poster/trailer)."
    if ada_lagu or ada_visual:
        kurang = "poster / trailer" if ada_lagu else "lagu"
        return "sebagian", f"{len(siap)} materi siap; {kurang} belum ada. Upload manual di halaman Materi bila perlu."
    return "belum_ada", pesan_gdrive or "Materi belum ada. Upload manual di halaman Materi."


def siapkan_materi_campaign(rt, campaign: CampaignDB, brief: BriefCampaign, paksa: bool = False,
                            progres: Optional[Callable[[float, str], None]] = None) -> ReferensiCampaign:
    cid = campaign.id
    tahu = progres or (lambda p, m: None)
    man = _muat_manifest(rt.cfg, cid)
    links = [str(x).strip() for x in (brief.materi_links or []) if str(x).strip()]
    links_hash = hashlib.sha256("\n".join(sorted(links)).encode()).hexdigest()[:12]
    lama = man.get("gdrive") or {}
    pesan_gdrive = lama.get("pesan", "")
    if paksa or lama.get("links_hash") != links_hash:
        _set_status(rt, cid, "proses", "Mengunduh materi dari Google Drive…")
        tahu(0.05, "Membaca link materi")
        pesan_gdrive, hasil = _unduh_dari_link(rt, cid, links, tahu)
        man = _muat_manifest(rt.cfg, cid)
        man["gdrive"] = {"links_hash": links_hash, "hasil": hasil, "pesan": pesan_gdrive, "waktu": _now(), "n_link": len(links)}
        _simpan_manifest(rt.cfg, cid, man)
    tahu(0.8, "Memproses upload manual")
    try:
        proses_upload_manual(rt, cid)
    except Exception as e:  # noqa: BLE001
        log.warning("upload manual campaign gagal diproses (%s)", type(e).__name__)
    rt.cache.setdefault("ref", {}).pop(cid, None)
    ref = referensi_campaign(rt, cid, _tanpa_manual=True)
    try:
        musik.indeks_lagu(rt, cid, [m for m in ref.materi if m.status == "siap" and m.jenis in ("lagu", "trailer")])
    except Exception as e:  # noqa: BLE001
        log.warning("indeks lagu gagal (%s)", type(e).__name__)
    status, pesan = _hitung_status([{"jenis": m.jenis, "status": m.status} for m in ref.materi], pesan_gdrive)
    _set_status(rt, cid, status, pesan)
    tahu(1.0, "Selesai")
    return ReferensiCampaign(campaign_id=cid, status=status, pesan=pesan, materi=ref.materi)


def _unduh_dari_link(rt, cid: str, links: list[str], tahu) -> tuple[str, str]:
    """→ (pesan awam, ringkasan hasil ok / sebagian / private / kosong / gagal)"""
    if not links:
        return "Brief tidak mencantumkan link materi. Upload manual di halaman Materi.", "kosong"
    kerja = Path(getattr(rt.cfg, "tmp", Path("data/tmp"))) / f"materi-{cid}"
    shutil.rmtree(kerja, ignore_errors=True)
    kerja.mkdir(parents=True, exist_ok=True)
    sisa = int(getattr(rt.cfg, "materi_max_mb", 300) or 300) * 1024 * 1024
    n_ok, masalah = 0, []
    try:
        calon: list[dict] = []
        for link in links[:10]:
            jenis, fid = tautan_drive(link)
            try:
                if jenis == "folder":
                    calon += _daftar_api(fid) if _api_key() else _daftar_gdown(fid, kerja / "daftar")
                elif jenis == "file":
                    calon.append({"id": fid, "nama": "", "mime": "", "size": None, "satuan": True})
                elif jenis == "youtube":
                    calon.append({"id": None, "nama": "trailer-youtube.mp4", "mime": "video/mp4", "size": None, "url": link})
                else:
                    masalah.append("link bukan Google Drive")
            except _MateriGagal as e:
                masalah.append(str(e))
        satuan = [c for c in calon if c.get("satuan") or c.get("url")]
        dipilih = _pilih_kandidat([c for c in calon if not (c.get("satuan") or c.get("url"))]) + satuan
        if not dipilih and not masalah:
            masalah.append("folder tidak berisi lagu / poster / trailer")
        for i, f in enumerate(dipilih):
            tahu(0.1 + 0.6 * i / max(1, len(dipilih)), f"Mengunduh materi {i + 1}/{len(dipilih)}")
            if sisa <= 1024 * 1024:
                masalah.append("batas ukuran total materi tercapai")
                break
            tujuan = kerja / f"f{i:02d}"
            try:
                if f.get("url"):
                    batas = min(sisa, MAKS_FILE_MB["trailer"] * 1024 * 1024)
                    c = _CfgUnduh(rt.cfg, batas)
                    path = unduh_video(f["url"], tujuan, c)
                    jenis = "trailer"
                else:
                    batas = min(sisa, max(MAKS_FILE_MB.values()) * 1024 * 1024 if f.get("satuan") else MAKS_FILE_MB[f["jenis"]] * 1024 * 1024)
                    path = _unduh_drive(f["id"], tujuan, batas, rt.cfg, f.get("nama") or None)
                    jenis = f.get("jenis") or tebak_jenis(path.name)
                    if jenis is None:
                        masalah.append("ada file yang bukan lagu / gambar / video")
                        continue
                    if path.stat().st_size > MAKS_FILE_MB[jenis] * 1024 * 1024:
                        masalah.append(f"{jenis} terlalu besar")
                        continue
                sisa -= path.stat().st_size
                if _daftarkan(rt, cid, path, jenis, f.get("nama") or path.name) is not None:
                    n_ok += 1
            except (_MateriGagal, TidakBisaDiakses) as e:
                masalah.append(str(e).replace("Video tidak bisa diakses: ", ""))
            except Exception as e:  # noqa: BLE001
                log.warning("olah materi gagal (%s)", type(e).__name__)
                masalah.append("ada file yang gagal diolah")
            finally:
                shutil.rmtree(tujuan, ignore_errors=True)
    finally:
        shutil.rmtree(kerja, ignore_errors=True)
    if n_ok and not masalah:
        return f"{n_ok} materi diunduh otomatis dari Google Drive.", "ok"
    if n_ok:
        return f"{n_ok} materi diunduh otomatis; sebagian gagal ({masalah[0]}).", "sebagian"
    pesan = masalah[0] if masalah else "tidak bisa diunduh"
    if "private" in pesan.lower():
        return "Folder Google Drive private / tidak bisa diunduh otomatis. Upload manual di halaman Materi.", "private"
    return f"Materi belum ada ({pesan}). Upload manual di halaman Materi.", "gagal"


class _CfgUnduh:
    """cfg untuk unduh_video trailer YouTube: batas ukuran mengikuti sisa kuota materi"""

    def __init__(self, cfg, batas: int):
        self._cfg = cfg
        self.dl_max_mb = max(1, batas // (1024 * 1024))

    def __getattr__(self, k):
        return getattr(self._cfg, k)


# ------------------------------------------------------------------ upload manual dari website
def proses_upload_manual(rt, campaign_id: Optional[str] = None) -> int:
    """sidik jari untuk baris 'antri_sidik' (dipanggil antrian saat menganggur & sebelum campaign itu diproses)"""
    if getattr(rt, "supa", None) is None:
        return 0
    filt = {"status": "eq.antri_sidik", "select": "id,campaign_id,kind,storage_path,file_name,mime", "order": "created_at.asc",
            "limit": "20"}
    if campaign_id:
        filt["campaign_id"] = f"eq.{campaign_id}"
    rows = _sb(rt, "select", "review_materials", **filt) or []
    n = 0
    tersentuh = set()
    for r in rows:
        mid, cid = r["id"], r["campaign_id"]
        _sb(rt, "update", "review_materials", {"id": f"eq.{mid}", "status": "eq.antri_sidik"}, {"status": "proses"})
        kerja = Path(getattr(rt.cfg, "tmp", Path("data/tmp"))) / f"manual-{mid}"
        shutil.rmtree(kerja, ignore_errors=True)
        kerja.mkdir(parents=True, exist_ok=True)
        try:
            nama = r.get("file_name") or Path(r["storage_path"]).name
            src = kerja / _nama_aman(nama)
            rt.supa.download(r["storage_path"], src)
            if not src.exists() or src.stat().st_size == 0:
                raise _MateriGagal("File upload tidak bisa diambil dari penyimpanan.")
            jenis = r.get("kind") if r.get("kind") in ("lagu", "poster", "trailer") else tebak_jenis(nama, r.get("mime") or "")
            if jenis is None:
                raise _MateriGagal("Jenis file tidak dikenal (pakai lagu / gambar poster / video trailer).")
            _daftarkan(rt, cid, src, jenis, nama, sumber="manual", mid=mid, storage_path=r["storage_path"])
            n += 1
            tersentuh.add(cid)
        except Exception as e:  # noqa: BLE001
            pesan = str(e) if isinstance(e, _MateriGagal) else "File tidak bisa diolah (rusak / format tidak didukung)."
            log.warning("upload manual gagal diolah (%s)", type(e).__name__)
            _sb(rt, "update", "review_materials", {"id": f"eq.{mid}"}, {"status": "gagal", "message": pesan[:300]})
        finally:
            shutil.rmtree(kerja, ignore_errors=True)
    for cid in tersentuh:
        rt.cache.setdefault("ref", {}).pop(cid, None)
        ref = referensi_campaign(rt, cid, _tanpa_manual=True)
        try:
            musik.indeks_lagu(rt, cid, [m for m in ref.materi if m.status == "siap" and m.jenis in ("lagu", "trailer")])
        except Exception:  # noqa: BLE001
            pass
        man = _muat_manifest(rt.cfg, cid)
        st, pesan = _hitung_status([{"jenis": m.jenis, "status": m.status} for m in ref.materi],
                                   (man.get("gdrive") or {}).get("pesan", ""))
        if ref.status != "belum_dicek":  # campaign yang belum pernah dicek → biarkan pipeline menjalankan siapkan sekali
            _set_status(rt, cid, st, pesan)
    return n


# ------------------------------------------------------------------ baca referensi untuk satu video
def _pulihkan_lokal(rt, cid: str, it: dict) -> bool:
    """file lokal hilang (laptop lain / folder data dihapus) → unduh dari bucket lalu olah ulang"""
    if not it.get("storage_path") or getattr(rt, "supa", None) is None:
        return False
    kerja = Path(getattr(rt.cfg, "tmp", Path("data/tmp"))) / f"pulih-{it['id']}"
    shutil.rmtree(kerja, ignore_errors=True)
    kerja.mkdir(parents=True, exist_ok=True)
    try:
        src = kerja / _nama_aman(Path(it["storage_path"]).name)
        rt.supa.download(it["storage_path"], src)
        hasil = _olah(rt.cfg, cid, it["id"], src, it["jenis"])
        with _lock:
            man = _muat_manifest(rt.cfg, cid)
            man["items"][it["id"]] = dict(it, file=Path(hasil["path"]).name, durasi=hasil["durasi"])
            _simpan_manifest(rt.cfg, cid, man)
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("materi lokal tidak bisa dipulihkan (%s)", type(e).__name__)
        return False
    finally:
        shutil.rmtree(kerja, ignore_errors=True)


def referensi_campaign(rt, campaign_id: str, _tanpa_manual: bool = False) -> ReferensiCampaign:
    """baca review_materials + cache lokal (unduh dari bucket kalau file lokal hilang); cache di rt.cache["ref"]"""
    cache = rt.cache.setdefault("ref", {})
    c = cache.get(campaign_id)
    if c and time.monotonic() - c[0] < CACHE_DETIK:
        return c[1]
    rows = _baris_supabase(rt, campaign_id)
    if not _tanpa_manual and rows and any(r.get("status") == "antri_sidik" for r in rows):
        try:
            proses_upload_manual(rt, campaign_id)
            rows = _baris_supabase(rt, campaign_id)
        except Exception:  # noqa: BLE001
            pass
    man = _muat_manifest(rt.cfg, campaign_id)
    camp = _sb(rt, "select", "review_campaigns", campaign_id=f"eq.{campaign_id}", select="materi_status,materi_message")
    status = (camp[0].get("materi_status") if camp else None) or man.get("status") or "belum_dicek"
    pesan = (camp[0].get("materi_message") if camp else None) or man.get("pesan") or ""
    if status == "belum_dicek" and man.get("gdrive"):
        status = man.get("status") or "belum_dicek"
    items = {k: dict(v) for k, v in man["items"].items()}
    if rows is not None:  # Supabase = sumber kebenaran: materi yang dihapus di website ikut hilang di sini
        baru = {}
        for r in rows:
            it = items.get(r["id"], {})
            it.update({"id": r["id"], "jenis": r.get("kind") or "lainnya", "nama": r.get("file_name") or "",
                       "status": r.get("status"), "storage_path": r.get("storage_path"), "sumber": r.get("source")})
            baru[r["id"]] = it
        items = baru
    materi: list[MateriRef] = []
    for it in items.values():
        jenis = it.get("jenis") if it.get("jenis") in ("lagu", "poster", "trailer", "lainnya") else "lainnya"
        st = it.get("status") if it.get("status") in ("antri_sidik", "proses", "siap", "gagal") else "gagal"
        lokal = _path_lokal(rt.cfg, campaign_id, it["id"], jenis)
        if st == "siap" and jenis != "lainnya" and not lokal.exists() and not _pulihkan_lokal(rt, campaign_id, dict(it, jenis=jenis)):
            st = "gagal"
        materi.append(MateriRef(id=it["id"], jenis=jenis, nama=(it.get("nama") or it["id"])[:120], path_lokal=str(lokal), status=st))
    ref = ReferensiCampaign(campaign_id=campaign_id, status=status if status in (
        "belum_dicek", "proses", "ada", "sebagian", "belum_ada", "gagal") else "gagal", pesan=pesan, materi=materi)
    cache[campaign_id] = (time.monotonic(), ref)
    return ref
