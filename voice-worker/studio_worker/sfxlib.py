"""Bahan bersama tambah_sfx.py & freesound_cc0.py: konversi mp3, ukur LUFS / true peak / durasi / hit, tebak kategori & tag, id unik, upload."""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

import numpy as np

from . import ff, meter
from .supa import Supa

SR = 48000
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,60}$")

# urutan = prioritas (frasa panjang & kategori spesifik dulu)
CATS: list[tuple[str, list[str]]] = [
    ("bass-drop", ["bass drop", "bassdrop", "sub drop", "subdrop", "downer", "bass hit"]),
    ("braam", ["braam", "brahm", "bram", "horn blast", "foghorn"]),
    ("riser", ["riser", "uplifter", "upriser", "build up", "buildup", "swell", "rise", "tension"]),
    ("whoosh", ["whoosh", "woosh", "swoosh", "swish", "swipe", "pass by", "passby", "fly by", "flyby", "whip", "wind"]),
    ("boom", ["boom", "explosion", "explode", "thunder", "sub boom", "cinematic hit", "trailer hit"]),
    ("impact", ["impact", "hit", "punch", "slam", "thud", "smash", "crash", "stinger", "kick", "strike"]),
    ("glitch", ["glitch", "digital", "error", "static", "stutter", "bitcrush", "distort", "data", "malfunction"]),
    ("koin", ["coin", "coins", "cash", "money", "register", "koin", "uang", "payout", "jackpot"]),
    ("magic", ["magic", "sparkle", "shimmer", "chime", "fairy", "spell", "twinkle", "glitter", "harp", "bell", "magis"]),
    ("ui", ["ui", "click", "button", "notification", "notif", "beep", "interface", "menu", "pop", "blip", "tap", "select", "confirm", "alert", "ping", "toggle", "hover"]),
    ("foley", ["foley", "paper", "cloth", "footstep", "door", "keyboard", "typing", "page", "book", "pen", "zipper", "kertas"]),
    ("ambience", ["ambience", "ambiance", "ambient", "atmos", "atmosphere", "room tone", "roomtone", "drone", "background", "texture", "pad"]),
    ("transisi", ["transition", "trans", "sweep", "reverse", "rewind", "snap", "transisi"]),
]
TAG_ID = {
    "bass-drop": ["bass", "drop"],
    "braam": ["braam", "epik"],
    "riser": ["riser", "naik", "tegang"],
    "whoosh": ["whoosh", "cepat"],
    "boom": ["boom", "sinematik", "berat"],
    "impact": ["impact", "pukulan"],
    "glitch": ["glitch", "digital"],
    "koin": ["koin", "uang"],
    "magic": ["magis", "ajaib"],
    "ui": ["ui", "klik"],
    "foley": ["foley"],
    "ambience": ["ambience", "latar"],
    "transisi": ["transisi"],
}
USE_FOR = {
    "bass-drop": "Drop singkat / awal montage",
    "braam": "Reveal besar / pembuka trailer",
    "riser": "Membangun ketegangan sebelum reveal (taruh berakhir tepat di reveal)",
    "whoosh": "Transisi cepat / teks atau kartu masuk",
    "boom": "Ketukan berat di reveal & outro",
    "impact": "Judul / angka muncul (aksen)",
    "glitch": "Transisi digital / data berantakan",
    "koin": "Uang / saldo / angka muncul",
    "magic": "AI bekerja / momen ajaib",
    "ui": "Klik / notifikasi / UI muncul",
    "foley": "Detail kecil (kertas, ketikan)",
    "ambience": "Latar suasana (pelan, di bawah musik)",
    "transisi": "Pergantian adegan",
}
STOP = {"sfx", "sound", "sounds", "fx", "the", "and", "of", "a", "wav", "mp3", "stereo", "mono", "44k", "48k", "96k", "24bit", "16bit", "edit", "version", "ver", "var", "take", "final"}


def _ascii(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")


def tokens(s: str) -> list[str]:
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", _ascii(s))
    return [t for t in re.split(r"[^a-z0-9]+", s.lower()) if t]


def guess(name: str, folders: list[str], dur: float) -> tuple[str, list[str]]:
    """tebak kategori + tag dari nama file & folder"""
    words = tokens(" ".join([name, *folders]))
    text = " " + " ".join(words) + " "
    cat = None
    hits: list[str] = []
    for c, keys in CATS:
        found = [k for k in keys if f" {k} " in text]
        if found:
            hits.extend(found)
            cat = cat or c
    if cat is None:
        cat = "ambience" if dur > 10 else "ui" if dur < 1.2 else "transisi"
    tags: list[str] = []
    for t in [*TAG_ID.get(cat, []), *[h.replace(" ", "-") for h in hits], *[w for w in tokens(name) if len(w) > 2 and w not in STOP and not w.isdigit()]]:
        if t not in tags:
            tags.append(t)
    return cat, tags[:8]


def slug(s: str, maxlen: int = 50) -> str:
    x = re.sub(r"[^a-z0-9]+", "-", _ascii(s).lower()).strip("-")
    x = re.sub(r"-{2,}", "-", x)[:maxlen].strip("-")
    return x if len(x) >= 2 else "sfx"


def unique_id(base: str, taken: set[str]) -> str:
    base = slug(base)
    if not base[0].isalnum():
        base = "s" + base
    cand, k = base, 2
    while cand in taken or not ID_RE.match(cand):
        cand = f"{base[:55]}-{k}"
        k += 1
    taken.add(cand)
    return cand


def convert_mp3(src: Path, dst: Path) -> Path:
    """mp3 48 kHz 192 kbps (stereo tetap stereo)"""
    dst.parent.mkdir(parents=True, exist_ok=True)
    ch = 2 if any((s.get("channels") or 1) >= 2 for s in ff.probe(src).get("streams", []) if s.get("codec_type") == "audio") else 1
    ff.run(["-i", str(src), "-vn", "-ac", str(ch), "-ar", str(SR), "-c:a", "libmp3lame", "-b:a", "192k", str(dst)])
    return dst


def analyze(path: Path, cat: str | None = None) -> dict:
    """durasi, LUFS, true peak, hit (onset terkuat; riser = puncak; ambience panjang = 0), peak (detik paling keras)"""
    import librosa

    st = ff.decode(path, SR, mono=False)
    mono = st.mean(axis=1) if st.ndim == 2 else st
    dur = len(mono) / SR
    loud = meter.lufs(st, SR)
    tp = meter.true_peak_db(st, SR)
    fd = meter.frame_db(mono, SR, 0.05, 0.01)
    peak = float(np.argmax(fd) * 0.01) if fd.size else 0.0
    y22 = librosa.resample(mono, orig_sr=SR, target_sr=22050) if mono.size else mono
    hit = 0.0
    if y22.size > 2048:
        env = librosa.onset.onset_strength(y=y22, sr=22050)
        if env.size and float(env.max()) > 0:
            hit = float(librosa.frames_to_time(int(np.argmax(env)), sr=22050))
    if cat == "riser":
        hit = peak
    elif cat == "ambience" or dur > 12:
        hit = 0.0
    return {"dur": round(dur, 2), "lufs": round(loud, 1), "tp": round(tp, 1), "hit": round(min(hit, dur), 2), "peak": round(min(peak, dur), 2)}


def existing_ids(supa: Supa | None, repo: Path) -> set[str]:
    taken: set[str] = set()
    try:
        taken |= {x["id"] for x in json.loads((repo / "assets" / "audio" / "sfx" / "sfx.json").read_text(encoding="utf-8"))}
    except Exception:
        pass
    if supa is not None:
        off = 0
        while True:
            rows = supa.select("studio_sfx", select="id", order="id.asc", limit="1000", offset=str(off))
            taken |= {r["id"] for r in rows}
            if len(rows) < 1000:
                break
            off += 1000
    return taken


def upload(supa: Supa, sid: str, mp3: Path, meta: dict, cat: str, tags: list[str], source: str, license: str, credit: str | None, use_for: str | None = None) -> dict:
    path = supa.upload(f"sfx/{sid}.mp3", mp3, "audio/mpeg")
    row = {
        "id": sid,
        "path": path,
        "cat": cat,
        "tags": tags,
        "dur": meta["dur"],
        "lufs": meta["lufs"],
        "tp": meta["tp"],
        "hit": meta["hit"],
        "peak": meta["peak"],
        "use_for": use_for or USE_FOR.get(cat),
        "source": source,
        "license": license,
        "credit": credit,
        "created_by": None,
    }
    supa.insert("studio_sfx", row, on_conflict="id", merge=True)
    return row


def append_json(repo: Path, entry: dict, mp3: Path) -> None:
    """tambah ke assets/audio/sfx/sfx.json + salin mp3 ke folder SFX repo (opsi --juga-json)"""
    folder = repo / "assets" / "audio" / "sfx"
    jf = folder / "sfx.json"
    data = json.loads(jf.read_text(encoding="utf-8")) if jf.exists() else []
    data = [x for x in data if x.get("id") != entry["id"]] + [entry]
    (folder / entry["file"]).write_bytes(mp3.read_bytes())
    jf.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
