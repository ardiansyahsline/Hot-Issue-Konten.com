"""Urai alif.campaigns.brief_detail (JSON) → daftar poin brief yang dinilai satu per satu (pemilik: hakim-ai). KONTRAK.md §4.4.
Tahan banting: key hilang, tipe beda (string / array / objek / angka-string), "+Choice" (materialWajibChoice dst.) = cukup salah
satu, customSections, HTML / markdown ringan. Kolom brief_instructions / brief_dos / brief_donts / brief_goal / brief_narrative
TIDAK dipakai. Poin yang butuh mengenali orang tertentu → cara_nilai "manusia" (deteksi_identitas_orang, dipaksa juga di aturan.py)."""
from __future__ import annotations

import hashlib
import html
import json
import re
from typing import Any, Iterable, Optional

from .privasi import bersihkan_hashtag, bersihkan_teks
from .skema import BriefCampaign, CampaignDB, PoinBrief

MAKS_TEKS = 400  # karakter per poin
MAKS_PER_KEY = 15
MAKS_POIN = 60
MAKS_KONTEKS = 1500
TOLERANSI_DURASI = 1.0  # detik (dipakai aturan.cek_kode)

# urutan key TETAP → id p01.. stabil (KONTRAK.md §4.4). (key, kategori, cara_nilai, wajib, butuh_materi, kode_alasan)
_POIN_KEYS: list[tuple[str, str, str, bool, bool, str]] = [
    ("elemenWajib", "elemen_wajib", "ai", True, False, "tidak_sesuai_brief"),
    ("materialWajib", "material_wajib", "ai", True, True, "tidak_sesuai_brief"),
    ("footageWajib", "footage_wajib", "ai", True, True, "tidak_sesuai_brief"),
    ("footageOpsional", "footage_opsional", "info", False, False, "tidak_sesuai_brief"),
    ("cta", "cta", "ai", True, False, "cta_tidak_ada"),
    ("captionWajib", "caption_wajib", "kode", True, False, "tidak_sesuai_brief"),
    ("hashtags", "hashtag", "kode", True, False, "tidak_sesuai_brief"),
    ("durasi", "durasi", "kode", True, False, "tidak_sesuai_brief"),  # durasiMin + durasiMax jadi satu poin
    ("bolehDilakukan", "boleh", "info", False, False, "tidak_sesuai_brief"),
    ("dilarangDilakukan", "dilarang", "ai", True, False, "tidak_sesuai_brief"),
    ("ugcWajahClipper", "ugc_wajah", "ai", True, False, "tidak_sesuai_brief"),
    ("tipeKonten", "tipe_konten", "ai", True, False, "tidak_sesuai_brief"),
    ("kesanDiinginkan", "kesan", "ai", False, False, "tidak_sesuai_brief"),
    ("narasi", "narasi", "ai", False, False, "tidak_sesuai_brief"),
    ("tujuanCampaign", "tujuan", "ai", False, False, "tidak_sesuai_brief"),
    ("instruksiBrief", "instruksi", "ai", True, False, "tidak_sesuai_brief"),
    ("targetAudiens", "target_audiens", "ai", False, False, "tidak_sesuai_brief"),
    ("minimumFollowers", "followers", "data_akun", True, False, "followers_kurang"),
    ("nicheAkunDisetujui", "niche_akun", "data_akun", True, False, "lainnya"),
    ("customSections", "lainnya", "ai", True, False, "tidak_sesuai_brief"),
]
_KONTEKS_KEYS = ("penjelasanBrand", "caption", "contohVideo", "materi")
_LAIN_KEYS = ("materialWajibChoice", "footageWajibChoice", "durasiMin", "durasiMax")
# key brief_detail dikenal (dinormalkan: huruf kecil, tanpa _ - spasi)
_SEMUA = [k for k, *_ in _POIN_KEYS if k != "durasi"] + list(_KONTEKS_KEYS) + list(_LAIN_KEYS)
_NORM = {re.sub(r"[^a-z0-9]", "", k.lower()): k for k in _SEMUA}
# alias yang wajar (data lama / ketikan berbeda)
_NORM.update({"hashtag": "hashtags", "hastag": "hashtags", "hastags": "hashtags", "durasiminimal": "durasiMin",
              "durasimaksimal": "durasiMax", "durasimin": "durasiMin", "durasimax": "durasiMax", "minfollowers": "minimumFollowers",
              "customsection": "customSections", "materials": "materi", "material": "materi", "contohvideos": "contohVideo",
              "tujuan": "tujuanCampaign", "instruksi": "instruksiBrief", "dilarang": "dilarangDilakukan",
              "boleh": "bolehDilakukan", "elemen": "elemenWajib", "dos": "bolehDilakukan", "donts": "dilarangDilakukan"})

# kata perintah → poin narasi/tujuan/kesan/target/custom jadi wajib
_PERINTAH = re.compile(r"\b(wajib|harus|jangan|dilarang|pastikan|tidak boleh|gak boleh|nggak boleh|ga boleh|must|required|"
                       r"mandatory|minimal|maksimal|diharuskan|diwajibkan|hindari)\b", re.I)
_KATA_TEKS = ("text", "teks", "isi", "value", "nilai", "label", "deskripsi", "description", "content", "konten", "nama", "name",
              "title", "judul", "item", "poin", "point")
_KATA_JUDUL = ("judul", "title", "nama", "name", "heading", "label")
_KATA_ISI = ("isi", "content", "konten", "items", "item", "poin", "points", "list", "value", "nilai", "deskripsi", "description",
             "text", "teks")
_URL = re.compile(r"https?://[^\s\"'<>)\]]+", re.I)
_HANDLE_BRIEF = re.compile(r"(?<![\w@.])@[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?")

# ------------------------------------------------------------------ deteksi poin yang butuh mengenali ORANG tertentu
_ORANG = (r"\b(?:artis|aktor|aktris|pemeran|pemain(?:\s+film)?|selebriti|seleb|selebgram|influencer|penyanyi|idol|tokoh|"
          r"figur(?:\s+publik)?|bintang(?:\s+film|\s+tamu)?|cast|talent|publik\s+figur|public\s+figure|youtuber|tiktoker|komedian|"
          r"presenter|atlet|brand\s+ambassador|ambassador)")
# kata benda umum yang sering ditulis Huruf Besar di brief (bukan nama orang)
_BUKAN_NAMA = (r"(?!(?:Logo|Poster|Caption|Hashtag|Lagu|Musik|Video|Teks|Judul|Link|Tanggal|Brand|Produk|Film|Trailer|Footage|"
               r"Materi|Konten|Tag|Akun|Sound|Audio|Watermark|Subtitle|Durasi|Harga|Promo|Kode|Aplikasi|App|Tiket)\b)")
_IDENTITAS_POLA = [
    # "bukan pemain film", "artis yang bukan pemain", "orang lain selain cast"
    re.compile(r"\bbukan\s+(?:para\s+)?" + _ORANG, re.I),
    re.compile(_ORANG + r"\b[^.;\n]{0,40}\bbukan\b", re.I),
    re.compile(r"\b(?:selain|kecuali)\s+(?:para\s+)?" + _ORANG, re.I),
    # artis/aktor + kata kerja tampil/muncul/ada/pakai/sebelum/sesudah …
    re.compile(_ORANG + r"\b[^.;\n]{0,50}\b(?:tampil|muncul|terlihat|kelihatan|ada di|hadir|memakai|pakai|mengenakan|sebelum|sesudah|"
               r"setelah|saat masih|waktu masih|ketika masih|asli|yang sama|tertentu|bernama|berjilbab|berhijab)\b", re.I),
    re.compile(r"\b(?:tampil|muncul|terlihat|menampilkan|tampilkan|wajah|foto|footage|cuplikan|potongan|video)\b[^.;\n]{0,30}" + _ORANG + r"\b",
               re.I),
    # penampilan pribadi seseorang
    re.compile(r"\b(?:sebelum|sesudah|setelah)\s+(?:ber)?(?:jilbab|hijab|operasi|transformasi|menikah|cerai|hamil)\b", re.I),
    re.compile(r"\b(?:prostetik|prosthetic|make[\s-]?up\s+karakter|riasan\s+karakter)\b", re.I),
    re.compile(r"\b(?:mirip|kembaran|menyerupai|meniru)\s+(?:wajah|muka|gaya|penampilan|suara)?\s*" + _ORANG, re.I),
    re.compile(r"\b(?:look\s*alike|lookalike|cosplay(?:er)?|impersonat\w*|kembaran)\b", re.I),
    re.compile(r"\b(?:identitas\s+(?:orang|artis|pemeran|pemain|tokoh)|siapa\s+(?:orang|pemeran|artis|pemain)|"
               r"(?:kenali|mengenali|dikenali)\s+(?:orang|wajah|artis|pemeran|pemain)|nama\s+(?:artis|aktor|pemain|pemeran|tokoh))\b", re.I),
    # nama orang (2-3 kata Huruf Besar) diikuti kata kerja tampil/muncul
    re.compile(r"\b" + _BUKAN_NAMA + r"[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){1,2}\s+(?:harus\s+|wajib\s+|tidak\s+boleh\s+|jangan\s+)?"
               r"(?:tampil|muncul|terlihat)\b"),
]
# kata yang berarti "orang mana pun" (bukan identitas tertentu) → tidak dianggap identitas
_BUKAN_IDENTITAS = re.compile(r"^\s*(?:wajah\s+(?:kamu|clipper|kreator|sendiri)|tampilkan\s+wajah\s+(?:kamu|sendiri))\b", re.I)


def deteksi_identitas_orang(teks: str) -> bool:
    """poin menyangkut mengenali orang tertentu (artis / aktor / pemain / selebriti / tokoh X, "sebelum berjilbab", prostetik,
    "bukan pemain film", nama orang + kata kerja tampil/muncul) → True"""
    if not teks:
        return False
    t = re.sub(r"\s+", " ", str(teks))
    if _BUKAN_IDENTITAS.search(t):
        return False
    return any(p.search(t) for p in _IDENTITAS_POLA)


# ------------------------------------------------------------------ jenis materi referensi yang dibutuhkan sebuah poin
_LAGU = re.compile(r"\b(lagu|musik|music|sound|soundtrack|ost|backsound|back\s*sound|audio|jingle|instrumen\w*|bgm|theme\s*song)\b", re.I)
_POSTER = re.compile(r"\b(poster|key\s*visual|kv|logo|banner|thumbnail|artwork|brand\s*asset\w*|aset\s*brand)\b", re.I)
_TRAILER = re.compile(r"\b(trailer|teaser|footage|cuplikan|potongan\s+(?:film|video|adegan)|scene|adegan\s+resmi|klip\s+resmi|"
                      r"materi\s+video|video\s+resmi)\b", re.I)
_PAKAI_MATERI = re.compile(r"\b(pakai|gunakan|menggunakan|memakai|sertakan|masukkan|wajib\s+ada|harus\s+ada|tampilkan|use|include)\b"
                           r"[^.;\n]{0,40}\b(lagu|musik|sound|soundtrack|ost|backsound|audio|jingle|poster|trailer|teaser|footage|"
                           r"cuplikan|materi|aset|asset|key\s*visual|logo)\b", re.I)


def jenis_materi_poin(p: PoinBrief) -> set[str]:
    """jenis materi referensi (lagu / poster / trailer) yang dibutuhkan poin; kosong = materi apa pun yang siap"""
    t = " ".join([p.teks] + list(p.pilihan))
    out: set[str] = set()
    if _LAGU.search(t):
        out.add("lagu")
    if _POSTER.search(t):
        out.add("poster")
    if _TRAILER.search(t):
        out.add("trailer")
    return out


def butuh_lagu(p: PoinBrief) -> bool:
    return p.butuh_materi and "lagu" in jenis_materi_poin(p)


# ------------------------------------------------------------------ normalisasi nilai brief_detail
def _bersih(s: Any, izinkan: Iterable[str] = ()) -> str:
    """HTML / markdown ringan → teks polos; link → [tautan] (link di brief tidak dikirim ke AI); spasi dirapikan"""
    if s is None:
        return ""
    if isinstance(s, bool):
        return "ya" if s else "tidak"
    if isinstance(s, float) and s.is_integer():
        s = int(s)
    t = str(s)
    if "<" in t and ">" in t:
        t = re.sub(r"(?i)<\s*br\s*/?>|</\s*(p|div|li|h\d|tr)\s*>", "\n", t)
        t = re.sub(r"(?i)<\s*li[^>]*>", "\n- ", t)
        t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t)
    t = re.sub(r"\*\*|__|~~|`", "", t)  # tebal / miring markdown
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", t)
    t = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", t)
    return bersihkan_teks(t, izinkan=izinkan)


def _pecah_baris(t: str) -> list[str]:
    """teks panjang → butir (baris / bullet / nomor). Satu paragraf tanpa bullet tetap satu butir (dipotong per kalimat kalau
    > MAKS_TEKS)."""
    if not t:
        return []
    baris = [b.strip() for b in re.split(r"\n+|(?:^|\s)[•●▪◦➤►✓✔✅❌⛔·]\s+|(?<=\S)\s+(?=\d{1,2}[.)]\s+[A-Za-zÀ-ÿ])", t) if b and b.strip()]
    out = []
    for b in baris:
        b = re.sub(r"^\s*(?:[-*+•●▪◦➤►✓✔✅❌⛔·]|\d{1,2}[.)]|[a-z][.)])\s*", "", b).strip(" ;,")
        if not b or re.fullmatch(r"[\W_]+", b):
            continue
        if len(b) > MAKS_TEKS:
            kal = [k.strip() for k in re.split(r"(?<=[.!?])\s+", b) if k.strip()]
            buf = ""
            for k in kal:
                if buf and len(buf) + 1 + len(k) > MAKS_TEKS:
                    out.append(buf)
                    buf = k
                else:
                    buf = f"{buf} {k}".strip()
            if buf:
                out.append(buf)
        else:
            out.append(b)
    return out


# key yang isinya daftar butir: satu string berisi beberapa kalimat pendek → satu poin per kalimat
_KEY_DAFTAR = ("elemenWajib", "dilarangDilakukan", "bolehDilakukan", "instruksiBrief")


def _pecah_kalimat(t: str) -> list[str]:
    """'Menyebut merek pesaing. Menampilkan harga lama' → 2 butir; kalimat < 8 huruf / angka desimal tidak dipecah"""
    kal = [k.strip(" .") for k in re.split(r"(?<=[a-zA-Z\)%\"])[.!;]\s+(?=[A-ZÀ-Ý])", t) if k.strip(" .")]
    if len(kal) < 2 or any(len(k) < 8 for k in kal):
        return [t]
    return kal


def _cari(d: dict, kunci: Iterable[str]) -> Any:
    low = {str(k).lower(): v for k, v in d.items()}
    for k in kunci:
        if k in low and low[k] not in (None, "", [], {}):
            return low[k]
    return None


def _items(v: Any, izinkan: Iterable[str] = (), kedalaman: int = 0) -> list[dict]:
    """nilai apa pun → [{"teks", "wajib"?: bool, "pilihan"?: [...]}]. String dipecah per baris; objek {text, wajib} dikenali."""
    if v is None or kedalaman > 4:
        return []
    if isinstance(v, str):
        s = v.strip()
        if s[:1] in "[{" and s[-1:] in "]}":  # JSON di dalam string
            try:
                return _items(json.loads(s), izinkan, kedalaman + 1)
            except ValueError:
                pass
        return [{"teks": b} for b in _pecah_baris(_bersih(s, izinkan))]
    if isinstance(v, bool):
        return [{"teks": "ya" if v else "tidak", "bool": v}]
    if isinstance(v, (int, float)):
        return [{"teks": _bersih(v)}]
    if isinstance(v, list):
        out: list[dict] = []
        for x in v:
            out.extend(_items(x, izinkan, kedalaman + 1))
        return out
    if isinstance(v, dict):
        wajib = v.get("wajib", v.get("required", v.get("mandatory")))
        wajib = _jadi_bool(wajib)
        teks = _cari(v, _KATA_TEKS)
        if teks is None:
            # objek tanpa key teks yang dikenal → tiap nilai jadi butir ("key: nilai")
            out = []
            for k, x in v.items():
                for it in _items(x, izinkan, kedalaman + 1):
                    if not isinstance(k, str) or k.isdigit():
                        out.append(it)
                    else:
                        out.append({**it, "teks": f"{_bersih(k)}: {it['teks']}"})
            return out
        sub = _items(teks, izinkan, kedalaman + 1)
        if wajib is not None:
            sub = [{**it, "wajib": wajib} for it in sub]
        return sub
    return [{"teks": _bersih(v, izinkan)}]


def _jadi_bool(v: Any) -> Optional[bool]:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("true", "ya", "iya", "y", "yes", "wajib", "1", "harus", "required", "on"):
            return True
        if s in ("false", "tidak", "tdk", "no", "n", "0", "opsional", "optional", "bebas", "off", "-", "tidak wajib"):
            return False
    return None


def _angka_detik(v: Any) -> Optional[float]:
    """'15', '15 detik', '1 menit', '1:30', '00:00:45', 15.0, {"value": 15} → detik; tidak terbaca → None"""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, dict):
        v = _cari(v, ("value", "nilai", "detik", "seconds", "durasi"))
        return _angka_detik(v)
    if isinstance(v, (int, float)):
        x = float(v)
    else:
        s = str(v).strip().lower().replace(",", ".")
        m = re.fullmatch(r"(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.\d+)?", s)
        if m:
            return float(int(m.group(1) or 0) * 3600 + int(m.group(2)) * 60 + int(m.group(3)))
        m = re.search(r"(\d+(?:\.\d+)?)\s*(menit|mnt|minute|min|m\b)?", s)
        if not m:
            return None
        x = float(m.group(1)) * (60.0 if m.group(2) else 1.0)
        m2 = re.search(r"(\d+(?:\.\d+)?)\s*(detik|dtk|second|sec|s\b)", s)
        if m.group(2) and m2 and m2.start() > m.start():  # "1 menit 30 detik"
            x += float(m2.group(1))
    if x <= 0 or x > 6 * 3600:
        return None
    return round(x, 2)


def _teks_mentah(v: Any, kedalaman: int = 0) -> list[str]:
    """semua string di dalam nilai (tanpa dibersihkan) — untuk membaca tag @brand / #hashtag apa adanya"""
    if v is None or kedalaman > 4:
        return []
    if isinstance(v, str):
        s = v.strip()
        if s[:1] in "[{" and s[-1:] in "]}":
            try:
                return _teks_mentah(json.loads(s), kedalaman + 1)
            except ValueError:
                pass
        return [html.unescape(re.sub(r"<[^>]+>", " ", s))]
    if isinstance(v, (list, tuple)):
        return [x for it in v for x in _teks_mentah(it, kedalaman + 1)]
    if isinstance(v, dict):
        return [x for it in v.values() for x in _teks_mentah(it, kedalaman + 1)]
    return [] if isinstance(v, bool) else [str(v)]


def _tag_list(v: Any) -> list[str]:
    """hashtag / tag akun wajib → ['#a', '@brand']; teks bebas dipecah per spasi/koma (tag tanpa '#' dianggap hashtag)"""
    mentah: list[str] = []
    for t in _teks_mentah(v):
        mentah.extend(re.findall(r"[#@][\wÀ-￿.]+", t) or [w for w in re.split(r"[\s,;]+", t) if w])
    hasil: list[str] = []
    for t in mentah:
        t = t.strip().rstrip(".,;:")
        if not t:
            continue
        if t.startswith("@"):
            if re.fullmatch(r"@[A-Za-z0-9_.]{2,30}", t) and t.lower() not in [h.lower() for h in hasil]:
                hasil.append(t)
            continue
        for h in bersihkan_hashtag([t]):
            if h not in hasil:
                hasil.append(h)
    return hasil[:30]


def _handles_brief(raw: Any) -> list[str]:
    """@akun yang ditulis BRAND di brief (mis. 'tag @filmx_official') — boleh tetap terlihat (data brand, bukan data clipper)"""
    try:
        s = json.dumps(raw, ensure_ascii=False) if not isinstance(raw, str) else raw
    except (TypeError, ValueError):
        s = str(raw)
    return sorted({m.group(0) for m in _HANDLE_BRIEF.finditer(s or "")})


def _muat_json(raw: Any, catatan: list[str]) -> Optional[dict]:
    v = raw
    for _ in range(3):  # string JSON (kadang di-encode dua kali)
        if isinstance(v, (bytes, bytearray)):
            v = v.decode("utf-8", "replace")
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return None
            try:
                v = json.loads(s)
                continue
            except ValueError:
                catatan.append("brief_detail bukan JSON yang valid — dipakai kolom cadangan (rules, hashtags, min_video_duration)")
                return None
        break
    if isinstance(v, list):  # [{key, value}] atau [{...}] → gabung
        gab: dict = {}
        for x in v:
            if isinstance(x, dict):
                if "key" in x and "value" in x and isinstance(x["key"], str):
                    gab[x["key"]] = x["value"]
                else:
                    gab.update(x)
        if gab:
            catatan.append("brief_detail berbentuk array — digabung jadi satu objek")
            return gab
        catatan.append("brief_detail berbentuk array tanpa objek — diabaikan")
        return None
    if isinstance(v, dict):
        return v
    if v is not None:
        catatan.append(f"brief_detail bertipe {type(v).__name__} — diabaikan")
    return None


def _normalkan_key(d: dict, catatan: list[str]) -> dict:
    """key → nama baku (case / _ / - / spasi bebas). Key tak dikenal dicatat (tanpa isi)."""
    out: dict = {}
    for k, v in d.items():
        nk = _NORM.get(re.sub(r"[^a-z0-9]", "", str(k).lower()))
        if nk is None:
            catatan.append(f"key tak dikenal di brief_detail: {str(k)[:40]} (diabaikan)")
            continue
        if nk in out and out[nk] not in (None, "", [], {}):
            continue  # key ganda: pakai yang pertama terisi
        out[nk] = v
    return out


def _hash(d: Any) -> str:
    try:
        s = json.dumps(d, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    except (TypeError, ValueError):
        s = str(d)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:12]


# konteks per brief (penjelasan brand, contoh caption) — skema.BriefCampaign belum punya field konteks → disimpan per hash
_KONTEKS: dict[str, dict[str, str]] = {}


def konteks_brief(brief: BriefCampaign) -> dict[str, str]:
    k = getattr(brief, "konteks", None)
    if isinstance(k, dict):
        return k
    return _KONTEKS.get(brief.hash, {})


# ------------------------------------------------------------------ parser utama
def parse_brief(campaign: CampaignDB) -> BriefCampaign:
    """tidak pernah melempar: brief_detail rusak / kosong → BriefCampaign dengan poin dari kolom cadangan (rules, hashtags,
    min_video_duration) + catatan_parser. Id poin stabil (urutan key tetap: lihat KONTRAK.md §4.4)."""
    catatan: list[str] = []
    try:
        return _parse(campaign, catatan)
    except Exception as e:  # jaring pengaman: jangan pernah menggagalkan video karena brief aneh
        catatan.append(f"brief tidak bisa diurai ({type(e).__name__}) — dipakai kolom cadangan saja")
        try:
            return _parse(campaign.model_copy(update={"brief_detail": None}), catatan)
        except Exception:
            return BriefCampaign(campaign_id=str(campaign.id), judul=campaign.title, brand=campaign.brand, catatan_parser=catatan)


def _parse(campaign: CampaignDB, catatan: list[str]) -> BriefCampaign:
    d = _muat_json(campaign.brief_detail, catatan) or {}
    d = _normalkan_key(d, catatan) if d else {}
    izinkan = _handles_brief(campaign.brief_detail)
    poin: list[PoinBrief] = []
    konteks: dict[str, str] = {}

    def tambah(kategori: str, teks: str, sumber: str, cara: str, wajib: bool, butuh: bool, kode: str,
               pilihan: Optional[list[str]] = None) -> None:
        teks = (teks or "").strip()
        if not teks or len(poin) >= MAKS_POIN:
            return
        if len(teks) > MAKS_TEKS:
            teks = teks[: MAKS_TEKS - 1].rstrip() + "…"
        pil = [p[:200] for p in (pilihan or []) if p][:12]
        alasan_m = None
        # menyangkut mengenali orang tertentu → selalu butuh cek manusia (poin info tidak dinilai, dibiarkan)
        if cara in ("ai", "kode") and (deteksi_identitas_orang(teks) or any(deteksi_identitas_orang(p) for p in pil)):
            cara, alasan_m = "manusia", "identitas_orang"
        if cara == "ai" and not butuh and _PAKAI_MATERI.search(teks) and kategori not in ("dilarang", "boleh", "footage_opsional"):
            butuh = True
        poin.append(PoinBrief(id=f"p{len(poin) + 1:02d}", kategori=kategori, teks=teks, wajib=wajib, pilihan=pil, sumber=sumber,
                              cara_nilai=cara, alasan_manusia=alasan_m, butuh_materi=butuh, kode_alasan=kode))

    # --- durasi (durasiMin / durasiMax, cadangan min_video_duration)
    dmin = _angka_detik(d.get("durasiMin"))
    dmax = _angka_detik(d.get("durasiMax"))
    if d.get("durasiMin") not in (None, "") and dmin is None:
        catatan.append("durasiMin tidak terbaca sebagai angka")
    if d.get("durasiMax") not in (None, "") and dmax is None:
        catatan.append("durasiMax tidak terbaca sebagai angka")
    if dmin is None and campaign.min_video_duration:
        dmin = _angka_detik(campaign.min_video_duration)
    if dmin is not None and dmax is not None and dmin > dmax:
        catatan.append("durasiMin > durasiMax — ditukar")
        dmin, dmax = dmax, dmin

    # --- hashtag & caption wajib
    tags = _tag_list(d.get("hashtags")) if d.get("hashtags") not in (None, "", []) else []
    if not tags and campaign.hashtags:
        tags = _tag_list(campaign.hashtags)
    cap_contoh = " ".join(it["teks"] for it in _items(d.get("caption"), izinkan)).strip()
    cap_wajib_raw = d.get("captionWajib")
    caption_wajib: Optional[str] = None
    cap_poin: list[tuple[str, str]] = []  # (teks poin, cara)
    flag = _jadi_bool(cap_wajib_raw) if isinstance(cap_wajib_raw, (bool, int, float, str)) else None
    if flag is True and (isinstance(cap_wajib_raw, bool) or len(str(cap_wajib_raw)) <= 8):
        if cap_contoh:
            caption_wajib = cap_contoh[:MAKS_TEKS]
            cap_poin.append((f"Caption wajib memakai caption dari brand: \"{caption_wajib}\"", "kode"))
        else:
            catatan.append("captionWajib = ya tapi caption brand kosong")
    elif flag is None and cap_wajib_raw not in (None, "", [], {}):
        for it in _items(cap_wajib_raw, izinkan):
            t = it["teks"]
            # kalimat perintah ("caption harus menyebut tanggal tayang") → dinilai AI; teks caption persis → dicek kode
            if _PERINTAH.search(t) or re.search(r"\b(sebut|cantumkan|tulis|mention|tag|menyebut)\b", t, re.I):
                cap_poin.append((f"Caption: {t}", "ai"))
            else:
                caption_wajib = caption_wajib or t
                cap_poin.append((f"Caption wajib memuat: \"{t}\"", "kode"))
    if cap_contoh:
        konteks["Contoh caption dari brand"] = cap_contoh[:MAKS_KONTEKS]

    # --- poin per key (urutan tetap)
    for key, kategori, cara, wajib, butuh, kode in _POIN_KEYS:
        if key == "durasi":
            if dmin is not None or dmax is not None:
                if dmin is not None and dmax is not None:
                    t = f"Durasi video {dmin:g}–{dmax:g} detik"
                elif dmin is not None:
                    t = f"Durasi video minimal {dmin:g} detik"
                else:
                    t = f"Durasi video maksimal {dmax:g} detik"
                tambah("durasi", t, "durasiMin/durasiMax" if (d.get("durasiMin") or d.get("durasiMax")) else "min_video_duration",
                       "kode", True, False, kode)
            continue
        if key == "hashtags":
            if tags:
                tambah("hashtag", "Caption memuat hashtag / tag wajib: " + " ".join(tags), "hashtags", "kode", True, False, kode)
            continue
        if key == "captionWajib":
            for i, (t, c) in enumerate(cap_poin):
                tambah("caption_wajib", t, f"captionWajib[{i}]" if len(cap_poin) > 1 else "captionWajib", c, True, False, kode)
            continue
        v = d.get(key)
        if key in ("materialWajib", "footageWajib"):
            _poin_material(tambah, key, kategori, kode, v, d.get(key + "Choice"), izinkan, catatan)
            continue
        if v in (None, "", [], {}):
            continue
        if key == "ugcWajahClipper":
            _poin_ugc(tambah, v, izinkan)
            continue
        if key == "minimumFollowers":
            n = _angka_followers(v)
            t = f"Akun clipper minimal {n:,} followers".replace(",", ".") if n else "Followers akun: " + "; ".join(
                it["teks"] for it in _items(v, izinkan))
            tambah("followers", t, key, "data_akun", True, False, kode)
            continue
        if key == "nicheAkunDisetujui":
            isi = "; ".join(it["teks"] for it in _items(v, izinkan))[:MAKS_TEKS - 30]
            if isi:
                tambah("niche_akun", f"Niche akun yang disetujui: {isi}", key, "data_akun", True, False, kode)
            continue
        if key == "customSections":
            _poin_custom(tambah, v, izinkan)
            continue
        semua = _items(v, izinkan)
        if key in _KEY_DAFTAR and len(semua) == 1 and isinstance(v, str):
            semua = [{**semua[0], "teks": k} for k in _pecah_kalimat(semua[0]["teks"])]
        items = semua[:MAKS_PER_KEY]
        if len(semua) > MAKS_PER_KEY:
            catatan.append(f"{key}: lebih dari {MAKS_PER_KEY} butir — sisanya diabaikan")
        for i, it in enumerate(items):
            t = it["teks"]
            if it.get("bool") is not None:  # nilai ya/tidak polos tidak berarti apa-apa sebagai poin
                continue
            w = wajib
            if not wajib and _PERINTAH.search(t):
                w = True
            if it.get("wajib") is not None:
                w = bool(it["wajib"])
            if kategori == "dilarang" and not re.match(r"(?i)^(dilarang|jangan|tidak boleh)", t):
                t = f"Dilarang: {t}"
            # narasi / tujuan / kesan / target tetap dinilai AI; wajib=False → tidak memblok approve
            tambah(kategori, t, f"{key}[{i}]" if len(items) > 1 else key, cara, w, butuh, kode)

    # --- konteks (bukan poin)
    pb = " ".join(it["teks"] for it in _items(d.get("penjelasanBrand"), izinkan)).strip()
    if pb:
        konteks["Penjelasan brand"] = pb[:MAKS_KONTEKS]
    contoh = d.get("contohVideo")
    if contoh not in (None, "", [], {}):
        n = len(contoh) if isinstance(contoh, list) else 1
        teks_contoh = " ".join(it["teks"] for it in _items(contoh) if "[tautan]" not in it["teks"]).strip()
        konteks["Contoh video"] = (f"{n} contoh video dari brand (link tidak dikirim)" + (f": {teks_contoh}" if teks_contoh else ""))[:600]
    links = _links(d.get("materi"))

    # --- cadangan: brief_detail kosong → kolom rules
    if not d:
        if campaign.rules:
            for i, it in enumerate(_items(campaign.rules, izinkan)[:MAKS_PER_KEY]):
                kat, kd = ("cta", "cta_tidak_ada") if re.search(r"\bcta\b|call to action", it["teks"], re.I) else ("instruksi", "tidak_sesuai_brief")
                if re.match(r"(?i)^(dilarang|jangan|tidak boleh)", it["teks"]):
                    kat = "dilarang"
                tambah(kat, it["teks"], f"rules[{i}]", "ai", True, False, kd)
        if campaign.brief_detail in (None, "", {}, []):
            catatan.append("brief_detail kosong — dipakai kolom cadangan (rules, hashtags, min_video_duration)")

    judul = bersihkan_teks(campaign.title, 300) or None
    brand = bersihkan_teks(campaign.brand, 200) or None
    h = _hash({"brief_detail": d, "rules": None if d else campaign.rules, "hashtags": tags, "min": dmin, "max": dmax,
               "judul": judul, "brand": brand})
    _KONTEKS[h] = dict(sorted(konteks.items()))
    if len(_KONTEKS) > 500:  # batasi memori
        _KONTEKS.pop(next(iter(_KONTEKS)))
    return BriefCampaign(campaign_id=str(campaign.id), judul=judul, brand=brand, poin=poin, durasi_min=dmin, durasi_max=dmax,
                         hashtag_wajib=tags, caption_wajib=caption_wajib, materi_links=links, hash=h, catatan_parser=catatan[:30])


def _poin_material(tambah, key: str, kategori: str, kode: str, v: Any, choice: Any, izinkan, catatan: list[str]) -> None:
    """materialWajib / footageWajib (+Choice). Choice berupa daftar → satu poin "pakai salah satu"; Choice berupa tanda
    (true / 'salah satu' / angka N) → daftar utama jadi satu poin pilihan."""
    items = [it["teks"] for it in _items(v, izinkan) if it.get("bool") is None][:MAKS_PER_KEY]
    nama = "materi" if key == "materialWajib" else "footage"
    pilih_n: Optional[int] = None
    choice_items: list[str] = []
    if choice not in (None, "", [], {}):
        if isinstance(choice, bool) or (isinstance(choice, str) and _jadi_bool(choice) is not None and len(choice) <= 8):
            pilih_n = 1 if _jadi_bool(choice) else None
        elif isinstance(choice, (int, float)) and not isinstance(choice, bool):
            pilih_n = max(1, int(choice))
        elif isinstance(choice, str) and re.search(r"\b(salah satu|pilih|one of|any|minimal)\b", choice, re.I) and items:
            m = re.search(r"\d+", choice)
            pilih_n = int(m.group(0)) if m else 1
        else:
            choice_items = [it["teks"] for it in _items(choice, izinkan) if it.get("bool") is None][:MAKS_PER_KEY]
    if pilih_n is not None and items:
        if pilih_n >= len(items):
            pilih_n = None  # "pilih N dari N" = semua wajib
        else:
            t = (f"Pakai minimal {pilih_n} dari {nama} wajib berikut" if pilih_n > 1 else f"Pakai salah satu {nama} wajib berikut")
            tambah(kategori, t + ": " + " / ".join(items), key + "Choice", "ai", True, True, kode, pilihan=items)
            return
    for i, t in enumerate(items):
        tambah(kategori, f"Wajib pakai {nama}: {t}", f"{key}[{i}]" if len(items) > 1 else key, "ai", True, True, kode)
    if choice_items:
        if len(choice_items) == 1:
            tambah(kategori, f"Wajib pakai {nama}: {choice_items[0]}", key + "Choice", "ai", True, True, kode)
        else:
            tambah(kategori, f"Pakai salah satu {nama} berikut: " + " / ".join(choice_items), key + "Choice", "ai", True, True, kode,
                   pilihan=choice_items)
    if not items and not choice_items and v not in (None, "", [], {}):
        catatan.append(f"{key} terisi tapi tidak ada butir yang terbaca")


def _poin_ugc(tambah, v: Any, izinkan) -> None:
    b = _jadi_bool(v) if not isinstance(v, (list, dict)) else None
    if b is True:
        tambah("ugc_wajah", "Wajah clipper wajib tampil di video (gaya UGC, bicara/tampil langsung ke kamera)", "ugcWajahClipper",
               "ai", True, False, "tidak_sesuai_brief")
        return
    if b is False:
        return  # tidak diwajibkan → bukan poin
    for it in _items(v, izinkan)[:3]:
        t = it["teks"]
        low = t.lower()
        if re.search(r"\b(tidak boleh|dilarang|jangan)\b", low):
            tambah("ugc_wajah", f"Wajah clipper: {t}", "ugcWajahClipper", "ai", True, False, "tidak_sesuai_brief")
        elif re.search(r"\b(opsional|optional|boleh|bebas)\b", low):
            tambah("ugc_wajah", f"Wajah clipper: {t}", "ugcWajahClipper", "info", False, False, "tidak_sesuai_brief")
        else:
            tambah("ugc_wajah", f"Wajah clipper: {t}", "ugcWajahClipper", "ai", True, False, "tidak_sesuai_brief")


def _poin_custom(tambah, v: Any, izinkan) -> None:
    secs = v if isinstance(v, list) else [v]
    for si, s in enumerate(secs[:10]):
        if isinstance(s, dict):
            judul = _bersih(_cari(s, _KATA_JUDUL), izinkan)[:80]
            isi_raw = None
            for k in _KATA_ISI:
                for kk, vv in s.items():
                    if str(kk).lower() == k and vv not in (None, "", [], {}) and k not in _KATA_JUDUL:
                        isi_raw = vv
                        break
                if isi_raw is not None:
                    break
            items = _items(isi_raw, izinkan) if isi_raw is not None else []
        else:
            judul, items = "", _items(s, izinkan)
        opsional = bool(re.search(r"\b(opsional|optional|inspirasi|referensi|tips|ide|saran|catatan)\b", judul, re.I))
        for i, it in enumerate(items[:MAKS_PER_KEY]):
            t = f"{judul}: {it['teks']}" if judul else it["teks"]
            w = bool(_PERINTAH.search(t)) or (bool(re.search(r"\b(wajib|harus|aturan|syarat|ketentuan)\b", judul, re.I)) and not opsional)
            if it.get("wajib") is not None:
                w = bool(it["wajib"])
            kat = "dilarang" if re.match(r"(?i)^(.*:\s*)?(dilarang|jangan|tidak boleh)", t) else "lainnya"
            tambah(kat, t, f"customSections[{si}][{i}]", "ai" if (w or not opsional) else "info", w, False, "tidak_sesuai_brief")


def _angka_followers(v: Any) -> Optional[int]:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(v) if v > 0 else None
    if isinstance(v, dict):
        return _angka_followers(_cari(v, ("value", "nilai", "min", "minimum", "jumlah")))
    s = str(v or "").lower().replace(" ", "")
    m = re.search(r"(\d+(?:[.,]\d+)*)(rb|ribu|k|jt|juta|m)?", s)
    if not m:
        return None
    num = m.group(1)
    suf = m.group(2)
    if suf:
        x = float(num.replace(",", "."))
        x *= 1000 if suf in ("rb", "ribu", "k") else 1_000_000
    else:
        x = float(num.replace(".", "").replace(",", ""))
    return int(x) if x > 0 else None


def _links(v: Any) -> list[str]:
    """link materi (Google Drive dll.) dari string / list / objek → unik, urut tetap (tidak dikirim ke AI)"""
    try:
        s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
    except (TypeError, ValueError):
        s = str(v)
    out: list[str] = []
    for m in _URL.finditer(s or ""):
        u = m.group(0).rstrip(".,;\\")
        if u not in out:
            out.append(u)
    return out[:20]


# ------------------------------------------------------------------ teks brief untuk prompt (blok system ke-2, di-cache 1 jam)
_CARA_LABEL = {
    "ai": "DINILAI AI",
    "kode": "DICEK KODE (hasilnya ada di materi video, jangan dinilai ulang)",
    "manusia": "BUTUH CEK MANUSIA (menyangkut mengenali orang tertentu — JANGAN dinilai, JANGAN menebak identitas)",
    "data_akun": "DATA AKUN (di luar video — tidak dinilai dari video)",
    "info": "INFO (tidak dinilai)",
}


def teks_brief_untuk_prompt(brief: BriefCampaign) -> str:
    """blok system kedua (di-cache 1 jam per campaign): deterministik (tanpa waktu / acak), poin berurutan dengan id"""
    L: list[str] = ["# BRIEF CAMPAIGN (data brand, bukan data clipper)", ""]
    L.append(f"Campaign: {brief.judul or '-'}")
    L.append(f"Brand: {brief.brand or '-'}")
    lo, hi = brief.durasi_min, brief.durasi_max
    if lo is not None and hi is not None:
        L.append(f"Durasi diminta: {lo:g}–{hi:g} detik")
    elif lo is not None:
        L.append(f"Durasi diminta: minimal {lo:g} detik")
    elif hi is not None:
        L.append(f"Durasi diminta: maksimal {hi:g} detik")
    if brief.hashtag_wajib:
        L.append("Hashtag / tag wajib: " + " ".join(brief.hashtag_wajib))
    kt = konteks_brief(brief)
    if kt:
        L += ["", "## Konteks dari brand (bacaan, bukan poin)"]
        for k in sorted(kt):
            L.append(f"- {k}: {kt[k]}")
    dinilai = [p for p in brief.poin if p.cara_nilai == "ai"]
    lain = [p for p in brief.poin if p.cara_nilai != "ai"]
    L += ["", "## Poin yang WAJIB kamu nilai (masukkan SEMUA id ini ke checklist, masing-masing sekali)"]
    if not dinilai:
        L.append("(tidak ada — isi checklist dengan array kosong)")
    for p in dinilai:
        L.append(_baris_poin(p))
    if lain:
        L += ["", "## Poin yang TIDAK kamu nilai (sudah ditangani kode / manusia — JANGAN dimasukkan ke checklist; boleh dipakai "
                  "sebagai pertimbangan saran akhir sesuai rubrik)"]
        for p in lain:
            L.append(_baris_poin(p))
    L.append("")
    L.append(f"(id brief {brief.hash or '-'})")
    return "\n".join(L)


def _baris_poin(p: PoinBrief) -> str:
    tanda = "WAJIB" if p.wajib else "tidak wajib"
    bagian = [f"[{p.id}] ({p.kategori} · {tanda} · {_CARA_LABEL.get(p.cara_nilai, p.cara_nilai)}"]
    if p.butuh_materi:
        jm = sorted(jenis_materi_poin(p))
        bagian.append(" · butuh materi referensi" + (f" ({', '.join(jm)})" if jm else ""))
    bagian.append(f") {p.teks}")
    s = "".join(bagian)
    if p.pilihan:
        s += "\n    pilihan (cukup SALAH SATU terpenuhi): " + " | ".join(p.pilihan)
    return s
