"""Kenali platform & id video dari link (pemilik: worker-inti). Username di link DIBUANG (tidak pernah dikembalikan).
Aturan sama dengan lib/asistenReview.ts (parseVideoRef / linkVideo) supaya website & laptop sepakat."""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import parse_qs, urlsplit

from .skema import VideoRef

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def _urai(url: str):
    s = (url or "").strip()
    if not re.match(r"^https?://", s, re.I):
        s = "https://" + s
    try:
        u = urlsplit(s)
    except ValueError:
        return None
    host = (u.hostname or "").lower()
    host = re.sub(r"^(www|m|vm|vt)\.", "", host)
    parts = [p for p in u.path.split("/") if p]
    return host, parts, u.query, (u.hostname or "").lower()


def tebak_platform(url: Optional[str]) -> tuple[str, Optional[str]]:
    """link → (platform, platform_video_id).
    tiktok: /video/(\\d+) atau vm.tiktok.com/<kode> (kode pendek = id None); instagram: /(reel|reels|p|tv)/<shortcode>;
    youtube: shorts/<id>, watch?v=<id>, youtu.be/<id>; lainnya → ("lainnya", None)."""
    if not url:
        return "lainnya", None
    r = _urai(url)
    if r is None:
        return "lainnya", None
    host, parts, query, _ = r
    if host == "tiktok.com" or host.endswith(".tiktok.com"):
        if "video" in parts:
            i = parts.index("video")
            vid = parts[i + 1] if i + 1 < len(parts) else ""
            return "tiktok", vid if re.fullmatch(r"\d{8,25}", vid) else None
        return "tiktok", None  # vm.tiktok.com/<kode> / /t/<kode>: kode pendek, bukan id video
    if host == "instagram.com" or host.endswith(".instagram.com"):
        for i, p in enumerate(parts):
            if p in ("reel", "reels", "p", "tv") and i + 1 < len(parts):
                vid = parts[i + 1]
                return "instagram", vid if ID_RE.fullmatch(vid) else None
        return "instagram", None
    if host == "youtu.be":
        vid = parts[0] if parts else ""
        return "youtube", vid if ID_RE.fullmatch(vid) else None
    if host == "youtube.com" or host.endswith(".youtube.com"):
        vid = parts[1] if parts[:1] == ["shorts"] and len(parts) > 1 else (parse_qs(query).get("v") or [""])[0]
        return "youtube", vid if vid and ID_RE.fullmatch(vid) else None
    return "lainnya", None


def link_publik(platform: Optional[str], vid: Optional[str]) -> Optional[str]:
    """link TANPA username (sama dengan lib/asistenReview.ts linkVideo): tiktok https://www.tiktok.com/embed/v2/<id>,
    instagram https://www.instagram.com/reel/<id>/, youtube https://youtu.be/<id>"""
    if not vid or not ID_RE.fullmatch(str(vid)):
        return None
    if platform == "tiktok":
        return f"https://www.tiktok.com/embed/v2/{vid}"
    if platform == "instagram":
        return f"https://www.instagram.com/reel/{vid}/"
    if platform == "youtube":
        return f"https://youtu.be/{vid}"
    return None


def ref_dari_teks(teks: str) -> Optional[VideoRef]:
    """versi Python parseVideoRef (CLI `review video <id-atau-link>`): uuid / angka ≤ 12 digit = id Konten.com,
    angka 15–20 digit = id TikTok, link → id platform. Tidak dikenali → None."""
    s = (teks or "").strip()
    if not s:
        return None
    if UUID_RE.fullmatch(s):
        return VideoRef(jenis="id", nilai=s.lower())
    if re.fullmatch(r"\d{1,12}", s):
        return VideoRef(jenis="id", nilai=s)
    if re.fullmatch(r"\d{15,20}", s):
        return VideoRef(jenis="platform", platform="tiktok", nilai=s)
    plat, vid = tebak_platform(s)
    if plat != "lainnya" and vid:
        return VideoRef(jenis="platform", platform=plat, nilai=vid)  # type: ignore[arg-type]
    return None
