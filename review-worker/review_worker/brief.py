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
    ("tagSocialMedia", "hashtag", "kode", True, False, "tidak_sesuai_brief"),  # akun brand wajib di-tag (sumber tagSocialMedia)
    ("durasi", "durasi", "kode", True, False, "tidak_sesuai_brief"),  # durasiMin + durasiMax (cadangan durasiVideo) jadi satu poin
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
_KONTEKS_KEYS = ("penjelasanBrand", "caption", "contohVideo", "materi", "judulFile", "jenisKampanye", "namaBrandArtist")
_LAIN_KEYS = ("materialWajibChoice", "footageWajibChoice", "durasiMin", "durasiMax", "durasiVideo")
# konteks teks pendek (bacaan AI, bukan poin). namaBrandArtist bisa nama artis: SENGAJA tidak masuk daftar pengecualian
# identitas (abaikan) — poin yang menyebut artis tetap butuh cek manusia.
_KONTEKS_LABEL = {"jenisKampanye": "Jenis kampanye", "namaBrandArtist": "Nama brand / artis", "judulFile": "Judul file dari brand"}
# key brief_detail dikenal (dinormalkan: huruf kecil, tanpa _ - spasi)
_SEMUA = [k for k, *_ in _POIN_KEYS if k != "durasi"] + list(_KONTEKS_KEYS) + list(_LAIN_KEYS)
_NORM = {re.sub(r"[^a-z0-9]", "", k.lower()): k for k in _SEMUA}
# alias yang wajar (data lama / ketikan berbeda)
_NORM.update({"hashtag": "hashtags", "hastag": "hashtags", "hastags": "hashtags", "durasiminimal": "durasiMin",
              "durasimaksimal": "durasiMax", "durasimin": "durasiMin", "durasimax": "durasiMax", "minfollowers": "minimumFollowers",
              "customsection": "customSections", "materials": "materi", "material": "materi", "contohvideos": "contohVideo",
              "tujuan": "tujuanCampaign", "instruksi": "instruksiBrief", "dilarang": "dilarangDilakukan",
              "boleh": "bolehDilakukan", "elemen": "elemenWajib", "dos": "bolehDilakukan", "donts": "dilarangDilakukan",
              "tagsocialmedia": "tagSocialMedia", "tagsosmed": "tagSocialMedia", "tagakun": "tagSocialMedia", "durasi": "durasiVideo"})

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
]
# nama orang (2-3 kata Huruf Besar) diikuti kata kerja tampil/muncul — dicek dengan konteks (_nama_orang): "Kemasan Kopi Senja
# terlihat jelas" / "Logo Brand X tampil" / "judul film Agak Laen muncul" = benda, bukan orang. Deret Huruf Besar sampai 5 kata supaya
# "Video Dian Sastro tampil" tetap tertangkap (kata depan "Video" dilewati, sisanya "Dian Sastro" dicek)
_NAMA_TAMPIL = re.compile(r"\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){1,4})\s+(?:harus\s+|wajib\s+|tidak\s+boleh\s+|jangan\s+)?"
                          r"(?:tampil|muncul|terlihat)\b")
_ORANG_RE = re.compile(_ORANG + r"\b", re.I)
# kata kerja / benda tampil + (≤ 3 kata kecil) + Nama 2-3 kata Huruf Besar: "Wajib menampilkan Reza Rahadian", "adegan Dian Sastro
# menangis", "Harus ada Raffi Ahmad di video", "menampilkan Joko Anwar sebagai sutradara" (nama SESUDAH kata kerja, tanpa "artis")
_NAMA_SESUDAH = re.compile(r"(?i:\b(?:menampilkan|tampilkan|ditampilkan|tampil|munculkan|memunculkan|muncul|ada|hadir(?:kan)?|"
                           r"menghadirkan|adegan|wajah|muka|foto|footage|cuplikan|potongan|bersama|featuring|feat|ft|ajak|bareng)\b)"
                           r"\.?\s+((?:[a-z]+\s+){0,3}?)((?:[A-Z][a-z]{2,})(?:\s+[A-Z][a-z]{2,}){1,4})\b")
# benda / produk / karya (bukan orang): kata ini DI DALAM "nama" Huruf Besar → itu nama benda ("Kemasan Kopi Senja", "Logo Brand X",
# "Botol Aqua Life"). Kata yang juga nama orang (mis. "Novel" Baswedan) SENGAJA tidak dimasukkan.
_BENDA = frozenset(("kemasan", "packaging", "package", "botol", "kaleng", "bungkus", "sachet", "kotak", "box", "dus", "label", "stiker",
                    "sticker", "logo", "poster", "banner", "spanduk", "baliho", "judul", "film", "movie", "serial", "brand", "merek", "merk",
                    "produk", "product", "tulisan", "teks", "text", "nama", "aplikasi", "app", "website", "situs",
                    "menu", "toko", "store", "outlet", "gerai", "kafe", "cafe", "restoran", "minuman", "makanan", "snack", "kopi",
                    "coffee", "teh", "susu", "mie", "sabun", "sampo", "shampoo", "parfum", "serum", "lipstik", "skincare", "game",
                    "ponsel", "kartu", "voucher", "promo", "paket", "edisi", "varian", "rasa", "seri", "album", "single", "lagu",
                    "buku", "maskot", "mascot", "kartun", "animasi", "watermark", "caption", "hashtag"))
# kata benda kecil yang TEPAT di depan nama menandai nama itu benda: "merek Kopi Senja", "logo Kopi Kenangan", "judul film Agak Laen".
# Lebih sempit dari _BENDA: kategori produk umum ("minum kopi Raffi Ahmad") & acara ("di acara Raffi Ahmad") tidak menandai benda.
_PENANDA_BENDA = frozenset(("kemasan", "packaging", "package", "botol", "kaleng", "bungkus", "sachet", "kotak", "box", "dus", "label",
                            "stiker", "sticker", "logo", "poster", "banner", "spanduk", "baliho", "judul", "film", "movie", "serial",
                            "brand", "merek", "merk", "produk", "product", "tulisan", "teks", "text", "nama", "aplikasi", "app",
                            "website", "situs", "menu", "toko", "store", "outlet", "gerai", "varian", "edisi", "album", "single",
                            "lagu", "buku", "maskot", "mascot", "watermark", "caption", "hashtag", "voucher", "promo", "game"))
# kata Huruf Besar di DEPAN nama yang hanya menyebut media / acara tempat orang itu muncul: dilewati, sisanya tetap dicek sebagai nama
# ("Video Dian Sastro tampil", "Konser Raisa Andriana", "Footage Reza Rahadian")
_LEWATI = frozenset(("video", "footage", "adegan", "scene", "foto", "cuplikan", "potongan", "klip", "wajah", "muka", "highlight",
                     "trailer", "teaser", "konser", "acara", "event", "festival", "link", "tanggal", "materi", "konten", "tag",
                     "akun", "sound", "audio", "subtitle", "durasi", "harga", "kode", "tiket", "bersama", "featuring", "feat"))
# _BENDA / _PENANDA_BENDA SENGAJA tanpa foto / gambar / cuplikan / adegan / video / karakter / acara — "cuplikan Reza Rahadian" tetap orang
# konteks campaign yang membuat namaBrandArtist = nama orang (artis / musisi): kalau tidak ada, nama itu dianggap brand / produk
_ARTIS_KONTEKS = re.compile(r"\b(?:artis|aktor|aktris|pemain|pemeran|penyanyi|musisi|musik|music|lagu|song|single|album|band|idol|"
                            r"rapper|konser|selebriti|seleb|selebgram|influencer|talent|kreator|youtuber|tiktoker|komedian)\b", re.I)
# kata Huruf Besar umum di brief (bukan nama orang) — satu kata ini di "nama" → bukan orang
_UMUM = frozenset(("logo", "poster", "caption", "hashtag", "lagu", "musik", "video", "teks", "judul", "link", "tanggal", "brand",
                   "produk", "film", "trailer", "footage", "materi", "konten", "tag", "akun", "sound", "audio", "watermark",
                   "subtitle", "durasi", "harga", "promo", "kode", "aplikasi", "app", "tiket", "official", "resmi", "instagram",
                   "youtube", "tiktok", "netflix", "disney", "bioskop", "cinema", "indonesia", "jakarta", "call", "action",
                   "diskon", "spesial", "special", "edisi", "season", "episode", "series", "seri", "hari", "raya", "ramadan",
                   "lebaran", "natal", "tahun", "baru", "gratis", "free", "store", "play", "google", "apple", "spotify", "shopee",
                   "tokopedia", "scene", "adegan", "opening", "ending", "closing", "intro", "outro", "teaser", "highlight",
                   "behind", "the", "scenes", "making", "soundtrack", "theme", "song", "key", "visual", "banner", "thumbnail"))
# kata yang berarti "orang mana pun" (bukan identitas tertentu) → tidak dianggap identitas
_BUKAN_IDENTITAS = re.compile(r"^\s*(?:wajah\s+(?:kamu|clipper|kreator|sendiri)|tampilkan\s+wajah\s+(?:kamu|sendiri))\b", re.I)


def _kata(s: Optional[str]) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", (s or "").lower()) if len(w) >= 3}


def pengecualian_identitas(judul: Optional[str] = None, brand: Optional[str] = None, nama_brand_artist: Optional[str] = None,
                           jenis_kampanye: Optional[str] = None) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """(abaikan, nama_brand) untuk deteksi_identitas_orang. abaikan = judul campaign + brand (selalu bukan orang). nama_brand =
    namaBrandArtist HANYA kalau konteks campaign bukan artis/musik (jenisKampanye & isi namaBrandArtist tanpa kata artis/aktor/
    penyanyi/lagu/…); konteks artis → nama itu tetap dianggap orang (kosong)."""
    abaikan = tuple(x for x in (judul, brand) if x)
    nba = (nama_brand_artist or "").strip()
    if not nba or _ARTIS_KONTEKS.search(f"{nba} {jenis_kampanye or ''}"):
        return abaikan, ()
    return abaikan, (nba,)


def pengecualian_brief(brief: BriefCampaign) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """pengecualian_identitas dari BriefCampaign (konteks namaBrandArtist / jenisKampanye yang dicatat parser)"""
    kt = konteks_brief(brief)
    return pengecualian_identitas(brief.judul, brief.brand, kt.get(_KONTEKS_LABEL["namaBrandArtist"]),
                                  kt.get(_KONTEKS_LABEL["jenisKampanye"]))


def _kata_tepat_sebelum(t: str, i: int) -> Optional[str]:
    """kata (huruf saja) yang TEPAT di depan posisi i, hanya dipisah spasi — tanda baca / kata lain di antaranya → None"""
    m = re.search(r"([A-Za-z]+)\s+$", t[max(0, i - 40):i])
    return m.group(1).lower() if m else None


def _nama_orang(nama: str, sebelum: Optional[str], kecuali: set[str]) -> bool:
    """deret Huruf Besar = kemungkinan nama orang? Tidak kalau kata TEPAT di depannya penanda benda ("merek Kopi Senja"), atau
    (sesudah kata media/acara di depan dilewati) memuat kata umum / benda / judul-brand campaign ("Kemasan Kopi Senja", "Logo
    Brand X"). Sisa minimal 2 kata ("Video Dian Sastro" → "Dian Sastro" = orang)."""
    if sebelum in _PENANDA_BENDA:
        return False
    kata = [w.lower() for w in nama.split()]
    while kata and kata[0] in _LEWATI:
        kata = kata[1:]
    return len(kata) >= 2 and not any(w in _UMUM or w in _BENDA or w in kecuali for w in kata)


def deteksi_identitas_orang(teks: str, abaikan: Iterable[str] = (), nama_brand: Iterable[str] = ()) -> bool:
    """poin menyangkut mengenali orang tertentu (artis / aktor / pemain / selebriti / tokoh X, "sebelum berjilbab", prostetik,
    "bukan pemain film", nama orang + kata kerja tampil/muncul, kata kerja tampil + nama orang) → True.
    abaikan = judul campaign / brand: nama Huruf Besar yang memuat kata dari situ (judul film, nama produk) bukan orang.
    nama_brand = namaBrandArtist di campaign non-artis (pengecualian_identitas): bukan orang, KECUALI poin itu sendiri menyebut
    artis/aktor/pemain/penyanyi. Nama benda ("Kemasan Kopi Senja terlihat jelas", "Logo Brand X tampil") bukan orang."""
    if not teks:
        return False
    t = re.sub(r"\s+", " ", str(teks))
    if _BUKAN_IDENTITAS.search(t):
        return False
    if any(p.search(t) for p in _IDENTITAS_POLA):
        return True
    kecuali = set().union(*(_kata(a) for a in abaikan)) if abaikan else set()
    if nama_brand and not _ORANG_RE.search(t):
        kecuali |= set().union(*(_kata(a) for a in nama_brand))
    for m in _NAMA_TAMPIL.finditer(t):
        if _nama_orang(m.group(1), _kata_tepat_sebelum(t, m.start()), kecuali):
            return True
    for m in _NAMA_SESUDAH.finditer(t):
        kecil = m.group(1).split()
        if _nama_orang(m.group(2), kecil[-1].lower() if kecil else None, kecuali):
            return True
    return False


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


# ------------------------------------------------------------------ durasiVideo (teks bebas) & tagSocialMedia
_NUM = r"(\d+(?:[.,]\d+)?)\s*(detik|dtk|seconds?|secs?|s|menit|mnt|minutes?|min|m)?\b"
_RENTANG = re.compile(_NUM + r"\s*(?:-|–|—|~|s/?d|sampai|hingga|to)\s*" + _NUM, re.I)
# negasi lebih dulu ("tidak lebih dari 60" = MAKS 60, "tidak kurang dari 30" = MIN 30); bagian yang sudah terbaca dikosongkan
# supaya "lebih dari 60" di dalamnya tidak terbaca lagi sebagai minimal
_NEG = r"(?:tidak|tdk|bukan|jangan|not|no)\s+(?:boleh\s+|ada\s+yang\s+)?"
_MAKS_NEG = re.compile(_NEG + r"(?:lebih\s+(?:lama\s+)?dari|lebih|melebihi|lewat(?:\s+dari)?|di\s*atas|more\s+than|longer\s+than|"
                       r"exceed(?:ing)?)\s*:?\s*" + _NUM, re.I)
_MIN_NEG = re.compile(_NEG + r"(?:kurang\s+dari|kurang|di\s*bawah|less\s+than|shorter\s+than)\s*:?\s*" + _NUM, re.I)
_MAKS = re.compile(r"(?:\bmaks(?:imal|imum)?\b|\bmax(?:imal|imum)?\b|paling lama|di\s*bawah|kurang dari|"
                   r"\bhingga\b|\bsampai\b|\bup to\b|<=?|≤)\s*:?\s*" + _NUM, re.I)
_MIN = re.compile(r"(?:\bmin(?:imal|imum)?\b|paling (?:sedikit|singkat|pendek)|di\s*atas|lebih dari|setidaknya|at least|>=?|≥)"
                  r"\s*:?\s*" + _NUM, re.I)
_KE_ATAS = re.compile(_NUM + r"\s*(?:ke\s*atas|atau lebih|lebih)\b", re.I)
_KE_BAWAH = re.compile(_NUM + r"\s*(?:ke\s*bawah|atau kurang)\b", re.I)
# "1:30" / "1:30 menit" / "01:30" → 90 detik; "1 menit 30 detik" / "1 min 30 detik" / "1m30s" → 90 detik (dinormalkan dulu)
_MMSS = re.compile(r"(?<![\d:.])(\d{1,2}):([0-5]\d)(?![\d:])(\s*(?:menit|mnt|minutes?|min|m)\b)?", re.I)
_MNT_DTK = re.compile(r"(\d+(?:\.\d+)?)\s*(?:menit|mnt|minutes?|min|m)\s*(?:dan\s+|&\s*|,\s*)?(\d+(?:\.\d+)?)\s*"
                      r"(?:detik|dtk|seconds?|secs?|s)\b", re.I)
# sisa kata yang boleh tertinggal tanpa membuat bacaan durasi "ragu"
_DURASI_SISA = re.compile(r"\b(?:durasi|berdurasi|video|videonya|konten|klip|clip|dan|serta|ya|per|tiap|setiap|detik|dtk|total|panjang|"
                          r"duration|and)\b|[\s.,;:()/\-–—!]+", re.I)


def _detik(angka: str, satuan: Optional[str]) -> Optional[float]:
    return _angka_detik(f"{angka} {satuan or 'detik'}")


def _normal_durasi(t: str) -> str:
    """mm:ss dan "X menit Y detik" → "N detik" (supaya pola min/maks/rentang membaca angka yang benar)"""
    def mmss(m: re.Match) -> str:
        sebelum = t[max(0, m.start() - 12):m.start()]
        if re.search(r"rasio|ratio|aspek|aspect|format|ukuran", sebelum) or (m.group(0).strip() in ("9:16", "16:9") and not m.group(3)):
            return m.group(0)  # "rasio 9:16" bukan durasi
        return f"{int(m.group(1)) * 60 + int(m.group(2))} detik"
    t = _MMSS.sub(mmss, t)
    return _MNT_DTK.sub(lambda m: f"{float(m.group(1)) * 60 + float(m.group(2)):g} detik", t)


def _durasi_video(v: Any) -> tuple[Optional[float], Optional[float]]:
    """durasiVideo → (min, maks) detik. Lihat _durasi_video_rinci."""
    lo, hi, _ = _durasi_video_rinci(v)
    return lo, hi


def _durasi_video_rinci(v: Any) -> tuple[Optional[float], Optional[float], bool]:
    """durasiVideo → (min, maks, pasti) detik. '30-60 detik' → (30, 60); 'min 30 detik' → (30, None); 'maks 1 menit' → (None, 60);
    'tidak lebih dari 60 detik' → (None, 60); '1:30 menit' / '1 menit 30 detik' → 90; angka / '30 detik' saja → (30, None)
    (DIANGGAP minimal, jadi tidak pasti); objek {min, max}; tidak terbaca → (None, None).
    pasti=False kalau ada teks lain yang tidak terbaca / batas hanya tebakan → aturan TIDAK memakainya untuk reject (cek manusia)."""
    if v is None or isinstance(v, bool):
        return None, None, False
    if isinstance(v, dict):
        lo = _angka_detik(_cari(v, ("min", "minimal", "minimum", "durasimin", "dari")))
        hi = _angka_detik(_cari(v, ("max", "maks", "maksimal", "maximum", "durasimax", "sampai")))
        if lo is None and hi is None:
            return _durasi_video_rinci(_cari(v, ("value", "nilai", "durasi", "text", "teks")))
        return lo, hi, True
    if isinstance(v, list):
        for x in v:
            lo, hi, pasti = _durasi_video_rinci(x)
            if lo is not None or hi is not None:
                return lo, hi, pasti
        return None, None, False
    if isinstance(v, (int, float)):
        return _angka_detik(v), None, False
    t0 = " ".join(_teks_mentah(v)).lower().replace(",", ".")
    t = _normal_durasi(t0)
    for m in _RENTANG.finditer(t):
        if not (m.group(2) or m.group(4)) and m.group(0).strip() != t.strip(" .detik"):
            continue  # "rasio 9-16" bukan durasi: rentang tanpa satuan hanya kalau isinya memang rentang saja
        s1, s2 = m.group(2) or m.group(4), m.group(4) or m.group(2)  # "1-2 menit": satuan kedua berlaku untuk keduanya
        sisa = _DURASI_SISA.sub("", t[:m.start()] + " " + t[m.end():])
        return _detik(m.group(1), s1), _detik(m.group(3), s2), not sisa
    lo = hi = None
    kerja = t
    for pola, sisi in ((_MAKS_NEG, "hi"), (_MIN_NEG, "lo"), (_MAKS, "hi"), (_KE_BAWAH, "hi"), (_MIN, "lo"), (_KE_ATAS, "lo")):
        m = pola.search(kerja)
        if not m:
            continue
        x = _detik(m.group(1), m.group(2))
        if sisi == "hi" and hi is None:
            hi = x
        elif sisi == "lo" and lo is None:
            lo = x
        kerja = kerja[:m.start()] + " " * (m.end() - m.start()) + kerja[m.end():]  # bagian ini sudah terbaca
    if lo is not None or hi is not None:
        return lo, hi, not _DURASI_SISA.sub("", kerja)
    # "30 detik" / "1:30" / "30" saja → dianggap minimal (tebakan → tidak pasti)
    m = re.search(r"(\d+(?:\.\d+)?)\s*(detik|dtk|seconds?|secs?|s|menit|mnt|minutes?|m)\b", t)
    if m:
        lo = _detik(m.group(1), m.group(2))
    elif re.fullmatch(r"\s*(?:\d+(?:\.\d+)?|\d{1,2}:\d{2})\s*", t0):
        lo = _angka_detik(t0.strip())
    return lo, None, False


_PLATFORM_TAG = {"tiktok": "TikTok", "tt": "TikTok", "tik tok": "TikTok", "instagram": "Instagram", "ig": "Instagram", "insta": "Instagram",
                 "youtube": "YouTube", "yt": "YouTube"}
_AKUN_URL = re.compile(r"(?:tiktok\.com|instagram\.com|youtube\.com)/@?([A-Za-z0-9_.]{2,30})", re.I)
_BUKAN_HANDLE = frozenset("tag mention akun account wajib harus dan atau di ke resmi official brand sosmed social media "
                          "username user caption video yang untuk none null nil nan kosong tidak tdk ada perlu usah boleh ya iya "
                          "no yes na n/a tanpa bebas opsional optional ga gak nggak enggak belum nihil required".split())
# isi tagSocialMedia yang berarti "tidak ada tag wajib" (isian kosong / negatif) → bukan poin wajib
_TAG_KOSONG = re.compile(r"(?:-+|\.+|tidak|tdk|ga|gak|nggak|enggak|engga|no|none|null|nil|nan|n/?a|kosong|nihil|belum ada|tanpa(?: tag)?|"
                         r"bebas|opsional|optional|(?:tidak|tdk|ga|gak|nggak|enggak|no|not|belum)\s+(?:ada|perlu|wajib|usah|harus|"
                         r"diperlukan|diwajibkan|required|needed|need|tag)\b.*)", re.I | re.S)
# "TikTok: @a, Instagram: @b" / "IG & TikTok: @a" → label platform (wajib diikuti ':' supaya kalimat biasa tidak terpecah)
_PLAT_KATA = r"(?:tiktok|tik tok|tt|instagram|insta|ig|youtube|yt)"
_LABEL_PLAT = re.compile(r"(?<![\w@./])(" + _PLAT_KATA + r"(?:\s*(?:&|dan|,|/|\+|and)\s*" + _PLAT_KATA + r")*)\s*:", re.I)


def _akun_teks(t: str) -> list[str]:
    """'@a, @b' / 'brandx' / 'https://www.tiktok.com/@brandx' → ['@a', '@b']; kalimat biasa tanpa handle → []"""
    out: list[str] = []
    for m in _AKUN_URL.finditer(t):
        if m.group(1).lower() not in ("reel", "reels", "stories", "explore", "channel", "user", "watch", "shorts", "video", "tv"):
            out.append("@" + m.group(1).rstrip("."))
    t2 = _URL.sub(" ", t)
    out += [m.group(0).rstrip(".") for m in _HANDLE_BRIEF.finditer(t2)]
    out += [m.group(0) for m in re.finditer(r"(?<![\w&])#[\wÀ-￿]+", t2)]
    if not out:  # tanpa '@': hanya kalau isinya memang seperti daftar nama akun (1-3 kata berbentuk handle), bukan kalimat
        kata = [w.strip(".:") for w in re.split(r"[\s,;/|]+", t2) if w.strip(".:")]
        kata = [w for w in kata if w.lower() not in _PLATFORM_TAG and w.lower() not in _BUKAN_HANDLE]
        if 1 <= len(kata) <= 3 and all(re.fullmatch(r"[A-Za-z0-9_.]{2,30}", w) for w in kata) and \
                (len(kata) == 1 or all(re.search(r"[._\d]", w) for w in kata)):
            out = ["@" + w for w in kata]
    hasil: list[str] = []
    for h in out:
        if h.lower() not in [x.lower() for x in hasil]:
            hasil.append(h)
    return hasil


def _tag_per_platform(t: str) -> Optional[list[tuple[Optional[str], str]]]:
    """'TikTok: @a, Instagram: @b' → [('TikTok', '@a'), ('Instagram', '@b')]; teks sebelum label pertama = akun umum (None);
    label tanpa akun ("IG & TikTok: @a" / "IG: TikTok: @a") ikut akun sesudahnya. Tanpa label platform → None."""
    label = list(_LABEL_PLAT.finditer(t))
    if not label:
        return None
    out: list[tuple[Optional[str], str]] = [(None, a) for a in _akun_teks(t[:label[0].start()])]
    tunggu: list[str] = []
    for i, m in enumerate(label):
        plat = [_PLATFORM_TAG[re.sub(r"\s+", "", x.lower())] for x in re.findall(_PLAT_KATA, m.group(1), re.I)]
        tunggu += [x for x in plat if x not in tunggu]
        akun = _akun_teks(t[m.end():label[i + 1].start() if i + 1 < len(label) else len(t)])
        if akun:
            out += [(pf, a) for pf in tunggu for a in akun]
            tunggu = []
    return out if out else None


def _tag_akun(v: Any, kedalaman: int = 0) -> tuple[list[tuple[Optional[str], str]], bool]:
    """tagSocialMedia → ([(platform | None, '@akun' / '#tag')], diwajibkan_tanpa_akun). Objek per platform ({"tiktok": "@a"}
    atau [{"platform": "tiktok", "username": "a"}]) → akun per platform. true / 'wajib' tanpa akun → (_, True)."""
    if v is None or kedalaman > 4:
        return [], False
    if isinstance(v, bool):
        return [], v
    if isinstance(v, str) and v.strip()[:1] in "[{":
        try:
            return _tag_akun(json.loads(v), kedalaman + 1)
        except ValueError:
            pass
    if isinstance(v, (str, int, float)):
        t = str(v).strip()
        if _jadi_bool(t) is not None:
            return [], bool(_jadi_bool(t))
        if "@" not in t and _TAG_KOSONG.fullmatch(t.strip(" .!")):  # "Tidak ada", "tidak perlu", "N/A", "none", "kosong", "-"
            return [], False
        per = _tag_per_platform(t)
        if per is not None:
            return per, False
        akun = _akun_teks(t)
        return [(None, a) for a in akun], (not akun and bool(t))
    out: list[tuple[Optional[str], str]] = []
    wajib = False
    if isinstance(v, list):
        for x in v:
            o, w = _tag_akun(x, kedalaman + 1)
            out += o
            wajib = wajib or w
        return out, wajib
    if isinstance(v, dict):
        low = {str(k).lower().strip(): x for k, x in v.items()}
        plat = _PLATFORM_TAG.get(str(low.get("platform") or low.get("sosmed") or low.get("media") or "").lower().strip())
        for k, x in low.items():
            if k in ("platform", "sosmed", "media"):
                continue
            o, w = _tag_akun(x, kedalaman + 1)
            kk = re.sub(r"[^a-z]", "", k)
            p_k = _PLATFORM_TAG.get(kk) or next((n for a, n in _PLATFORM_TAG.items() if len(a) > 2 and a in kk), None) or plat
            out += [(p_k or pf, a) for pf, a in o]
            wajib = wajib or w
    return out, wajib


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


def _teks_konteks(d: dict, k: str, izinkan) -> str:
    """teks konteks pendek (jenisKampanye / namaBrandArtist / judulFile) — sama persis untuk konteks prompt & pengecualian identitas"""
    return " ".join(it["teks"] for it in _items(d.get(k), izinkan) if it.get("bool") is None).strip()[:300]


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
    akun_tag, tag_tanpa_akun = _tag_akun(d.get("tagSocialMedia"))
    # akun brand yang wajib di-tag (juga yang ditulis tanpa '@') boleh tetap terlihat — data brand, bukan data clipper
    izinkan = sorted(set(_handles_brief(campaign.brief_detail)) | {a for _, a in akun_tag if a.startswith("@")})
    # judul film / brand bukan nama orang; namaBrandArtist juga bukan orang kecuali konteks campaign artis/musik
    abaikan, nama_brand = pengecualian_identitas(campaign.title, campaign.brand, _teks_konteks(d, "namaBrandArtist", izinkan),
                                                 _teks_konteks(d, "jenisKampanye", izinkan))
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
        if cara in ("ai", "kode") and (deteksi_identitas_orang(teks, abaikan, nama_brand)
                                       or any(deteksi_identitas_orang(p, abaikan, nama_brand) for p in pil)):
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
    sumber_durasi = [k for k in ("durasiMin", "durasiMax") if d.get(k) not in (None, "")]
    durasi_teks: list[str] = []  # sisi ("min" / "max") yang diambil dari teks bebas durasiVideo
    durasi_ragu: list[str] = []  # ... dan bacaannya tidak pasti (tebakan / ada teks lain) → tidak dipakai untuk reject
    if (dmin is None or dmax is None) and d.get("durasiVideo") not in (None, "", [], {}):  # cadangan: teks bebas durasiVideo
        vlo, vhi, vpasti = _durasi_video_rinci(d.get("durasiVideo"))
        if vlo is None and vhi is None:
            catatan.append("durasiVideo tidak terbaca sebagai durasi")
        elif (dmin is None and vlo is not None) or (dmax is None and vhi is not None):
            for sisi, kosong, x in (("min", dmin is None, vlo), ("max", dmax is None, vhi)):
                if kosong and x is not None:
                    durasi_teks.append(sisi)
                    if not vpasti:
                        durasi_ragu.append(sisi)
            dmin = dmin if dmin is not None else vlo
            dmax = dmax if dmax is not None else vhi
            sumber_durasi.append("durasiVideo")
            if not vpasti:
                catatan.append("durasiVideo dibaca dari teks bebas yang tidak pasti — pelanggaran durasi dicek manusia")
    if dmin is None and campaign.min_video_duration:
        dmin = _angka_detik(campaign.min_video_duration)
        if dmin is not None:
            sumber_durasi.append("min_video_duration")
    if dmin is not None and dmax is not None and dmin > dmax:
        catatan.append("durasiMin > durasiMax — ditukar")
        dmin, dmax = dmax, dmin
        tukar = {"min": "max", "max": "min"}
        durasi_teks, durasi_ragu = [tukar[x] for x in durasi_teks], [tukar[x] for x in durasi_ragu]

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
                tambah("durasi", t, "/".join(sumber_durasi) or "min_video_duration", "kode", True, False, kode)
            continue
        if key == "hashtags":
            if tags:
                tambah("hashtag", "Caption memuat hashtag / tag wajib: " + " ".join(tags), "hashtags", "kode", True, False, kode)
            continue
        if key == "tagSocialMedia":
            _poin_tag_akun(tambah, akun_tag, tag_tanpa_akun, kode)
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
    for k, nama in _KONTEKS_LABEL.items():
        isi = _teks_konteks(d, k, izinkan)
        if isi:
            konteks[nama] = isi
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
                         durasi_teks=durasi_teks, durasi_ragu=durasi_ragu,
                         hashtag_wajib=tags, caption_wajib=caption_wajib, materi_links=links, hash=h, catatan_parser=catatan[:30])


TEKS_TAG_AKUN = "Tag / mention akun wajib"


def _poin_tag_akun(tambah, akun: list[tuple[Optional[str], str]], tanpa_akun: bool, kode: str) -> None:
    """tagSocialMedia → satu poin wajib cara "kode" (aturan._cek_tag_akun): akun ada di caption → lolos; tidak terlihat /
    caption kosong → BUTUH CEK MANUSIA (bisa di-tag lewat fitur tag platform), TIDAK PERNAH reject."""
    if akun:
        per_plat: dict[str, list[str]] = {}
        for plat, a in akun[:20]:
            per_plat.setdefault(plat or "", []).append(a)
        if list(per_plat) == [""]:
            t = f"{TEKS_TAG_AKUN}: " + " ".join(per_plat[""])
        else:
            t = f"{TEKS_TAG_AKUN}: " + "; ".join(f"{p or 'semua platform'} " + " ".join(xs) for p, xs in per_plat.items())
        tambah("hashtag", t, "tagSocialMedia", "kode", True, False, kode)
    elif tanpa_akun:
        tambah("hashtag", f"{TEKS_TAG_AKUN}: akun brand (nama akun tidak tertulis di brief)", "tagSocialMedia", "kode", True,
               False, kode)


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
    ragu = " (perkiraan dari teks durasi di brief — bisa keliru)" if brief.durasi_ragu else ""
    if lo is not None and hi is not None:
        L.append(f"Durasi diminta: {lo:g}–{hi:g} detik{ragu}")
    elif lo is not None:
        L.append(f"Durasi diminta: minimal {lo:g} detik{ragu}")
    elif hi is not None:
        L.append(f"Durasi diminta: maksimal {hi:g} detik{ragu}")
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
