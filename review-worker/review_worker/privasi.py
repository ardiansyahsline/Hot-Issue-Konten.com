"""Pembersih data pribadi clipper (pemilik: worker-inti). Dipakai SEMUA modul sebelum teks dikirim ke AI / Supabase / log.

Yang dibuang (diganti penanda netral supaya kalimat tetap terbaca AI): email → [email], no HP (+62 / 62 / 08…, ≥ 8 digit
beruntun) → [telepon], @handle → [akun], link http(s) / www / domain/jalur (termasuk linktr.ee, youtu.be, beacons.ai,
taplink.cc …) → [tautan]. Hashtag (#…) DIBIARKAN. Teks dari VIDEO (caption, transkrip, OCR) juga lewat nama_akun=True:
username tanpa '@' ("follow ig budisantoso99", "rina_1998") → [akun].
Tag wajib campaign (mis. "@brandresmi" dari brief) boleh dikecualikan lewat `izinkan` — itu data brand, bukan data clipper.
BATAS: nama orang biasa yang ditulis / diucapkan clipper ("aku Budi Santoso") TIDAK bisa dikenali otomatis.
"""
from __future__ import annotations

import hashlib
import hmac
import re
from typing import Iterable, Optional

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
LINK_RE = re.compile(
    r"(?:https?://|www\.)\S+"  # link lengkap
    r"|\b(?:[A-Za-z0-9-]+\.)+(?:com|id|co|net|org|io|ly|me|link|gg|tv|app|site|xyz|info|biz|my|sg"  # domain/jalur (bit.ly/x)
    r"|ee|be|ai|bio|cc|to|us|tt|so|page|lol|fm|gl|im|ws|la|in|tk|ink|click|store|shop|online|live|top|vip|art|pro"  # linktr.ee, youtu.be,
    r"|social|space|website|tech|blog|one|uk|au|jp|kr|ph|vn|th|cn|eu|de|fr|nl|es|it|br|ca|tw|ru)/\S*",  # beacons.ai, taplink.cc …
    re.I,
)
# no HP Indonesia: +62 / 62 / 0 lalu 8xx, boleh dipisah spasi / titik / strip; atau ≥ 8 digit beruntun (wa.me, nomor lain)
TELP_RE = re.compile(r"(?<![\w#])(?:\+?62|0)[\s.-]?8\d{1,3}(?:[\s.-]?\d{2,5}){2,3}(?!\w)|(?<![\w#-])\+?\d{8,}(?![\w-])")
HANDLE_RE = re.compile(r"(?<![\w@.])@[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?")
PENANDA = ("[email]", "[telepon]", "[akun]", "[tautan]")
# username TANPA '@' di teks video: kata sesudah nama platform ("ig budi.santoso", "tiktok: rina1998"), atau kata yang bentuknya
# nama akun (ada '_' di tengah, atau huruf lalu ≥ 2 angka: "clipper_rahasia", "budisantoso99"). Kata umum sesudah platform dibiarkan.
_PLATFORM_RE = re.compile(
    r"\b(ig|insta|instagram|tiktok|twitter|threads|fb|facebook|yt|youtube|akun|acc|username|uname)\b"
    r"(\s*[:=-]?\s*(?:(?:aku|saya|kami|kita|gue|gw|ku|kak)\s+)?)([A-Za-z0-9][A-Za-z0-9._]{2,29})", re.I)
_KATA_RE = re.compile(r"(?<![\w#@\[./-])[A-Za-z0-9][A-Za-z0-9._]{2,29}[A-Za-z0-9_](?![\w@/-])")
_BUKAN_AKUN = frozenset(
    "aku saya kami kita gue gw ku kak kakak kalian kamu dia mereka ya yaa yah dong deh nih sih kok aja saja juga lagi dulu "
    "ini itu nya yang dan atau di ke dari untuk buat biar sama terus ada sekarang nanti resmi official brand story reels "
    "live post posting video konten followers follower akun account link bio shop ads iklan trend viral fyp kemarin".split())


def _mirip_akun(kata: str) -> bool:
    """bentuk nama akun: '_' di antara huruf/angka, atau huruf (≥ 3) lalu ≥ 2 angka. Kata kapital semua (CTA/judul) bukan."""
    if kata.isupper() or kata.isdigit():
        return False
    k = kata.lower().rstrip(".")
    return bool(re.search(r"[a-z0-9]_[a-z0-9]", k) or k.startswith("_") or k.endswith("_")
                or re.fullmatch(r"[a-z][a-z._]{2,}\d{2,}", k))


def samarkan_nama_akun(s: str, izinkan: Iterable[str] = ()) -> str:
    """username tanpa '@' di caption / transkrip / OCR → [akun] (lihat _PLATFORM_RE & _mirip_akun). izinkan = akun brand."""
    if not s:
        return s
    boleh = {_norm_tag(x) for x in izinkan if x}

    def platform(m: re.Match) -> str:
        kata = m.group(3).rstrip(".")
        if kata.lower() in _BUKAN_AKUN or kata.lower() in boleh or kata.isupper() or len(kata) < 3:
            return m.group(0)
        return m.group(1) + m.group(2) + "[akun]" + m.group(3)[len(kata):]

    t = _PLATFORM_RE.sub(platform, s)
    return _KATA_RE.sub(lambda m: "[akun]" if _mirip_akun(m.group(0)) and _norm_tag(m.group(0).rstrip(".")) not in boleh
                        else m.group(0), t)


def kandidat_akun(s: str) -> list[str]:
    """kata di teks BRIEF yang akan dianggap nama akun oleh samarkan_nama_akun → dipakai sebagai izinkan (akun brand)"""
    if not s:
        return []
    out = [m.group(3).rstrip(".") for m in _PLATFORM_RE.finditer(s)]
    out += [m.group(0).rstrip(".") for m in _KATA_RE.finditer(s) if _mirip_akun(m.group(0))]
    return [x for x in out if x.lower() not in _BUKAN_AKUN]
_SPASI = re.compile(r"[ \t ]+")


def _norm_tag(t: str) -> str:
    return (t or "").strip().lower().lstrip("@")


def bersihkan_teks(s: Optional[str], maks: Optional[int] = None, izinkan: Iterable[str] = (), nama_akun: bool = False) -> str:
    """buang @handle, email, no HP (≥ 8 digit beruntun / format +62 / 08…), link http(s)/www, lalu rapikan spasi.
    Hashtag (#…) DIBIARKAN. maks = potong ke sekian karakter (akhiran "…"). izinkan = @tag wajib campaign yang boleh tetap.
    nama_akun=True (teks dari video): username tanpa '@' juga dibuang (samarkan_nama_akun)."""
    if not s:
        return ""
    t = samarkan(str(s).replace("\r\n", "\n").replace("\r", "\n"), izinkan)
    if nama_akun:
        t = samarkan_nama_akun(t, izinkan)
    # rapikan: spasi ganda, penanda berulang beruntun ("[akun] [akun]" → "[akun]"), baris kosong berlebih
    t = "\n".join(_SPASI.sub(" ", baris).strip() for baris in t.split("\n"))
    t = re.sub(r"(\[(?:email|telepon|akun|tautan)\])(?:[\s,;]*\1)+", r"\1", t)
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    if maks is not None and maks > 0 and len(t) > maks:
        t = t[: max(1, maks - 1)].rstrip() + "…"
    return t


def samarkan(s: str, izinkan: Iterable[str] = ()) -> str:
    """ganti email / link / no HP / @handle dengan penanda TANPA merapikan spasi (dipakai log: indentasi traceback tetap)"""
    if not s:
        return s
    boleh = {_norm_tag(x) for x in izinkan if x}
    t = EMAIL_RE.sub("[email]", s)
    t = LINK_RE.sub("[tautan]", t)
    t = TELP_RE.sub("[telepon]", t)
    return HANDLE_RE.sub(lambda m: m.group(0) if _norm_tag(m.group(0)) in boleh else "[akun]", t)


def bersihkan_hashtag(tags: Iterable[str]) -> list[str]:
    """normalisasi '#Tag' → '#tag', buang yang mirip @handle / link, unik, urut tetap"""
    out: list[str] = []
    for raw in tags or []:
        if raw is None:
            continue
        for part in re.split(r"[\s,]+", str(raw)):
            t = part.strip().strip("'\"").lower()
            if not t or "@" in t or "/" in t or "http" in t or "." in t.strip("#"):
                continue
            t = "#" + t.lstrip("#")
            if not re.fullmatch(r"#[\wÀ-￿]{1,80}", t):
                continue
            if t not in out:
                out.append(t)
    return out


def ada_data_pribadi(s: str) -> bool:
    """True kalau masih ada pola email / no HP / @handle / link (dipakai assert sebelum kirim ke AI). Penanda [akun] dll. aman."""
    if not s:
        return False
    t = str(s)
    for p in PENANDA:
        t = t.replace(p, " ")
    return bool(EMAIL_RE.search(t) or LINK_RE.search(t) or TELP_RE.search(t) or HANDLE_RE.search(t))


def pseudonim(staff_id: Optional[str], salt: str) -> Optional[str]:
    """id staff reviewer → "R-" + 6 hex pertama HMAC-SHA256(salt, id). None → None. Nama staff TIDAK pernah dibaca."""
    if staff_id is None or str(staff_id).strip() == "":
        return None
    h = hmac.new((salt or "").encode("utf-8"), str(staff_id).strip().encode("utf-8"), hashlib.sha256).hexdigest()
    return "R-" + h[:6]
