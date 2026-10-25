"""Job kind 'beats': deteksi BPM & ketukan. settings.src = path storage atau "asset:music/<file>" (file repo assets/audio/music)."""
from __future__ import annotations

import re
import shutil
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from . import beats
from . import log as vlog
from .jobctx import JobCtx, JobError

log = vlog.get("beats")

SAFE_FILE = re.compile(r"^[\w.-]+\.(mp3|wav|m4a|ogg|aac|flac)$", re.I)


def resolve_src(src: str, repo: Path) -> tuple[str, str]:
    """→ ("asset", path lokal) atau ("storage", path bucket). Terima juga URL /api/studio/asset|file."""
    s = (src or "").strip()
    if s.startswith("/api/studio/asset/"):
        parts = unquote(urlsplit(s).path).split("/")
        s = f"asset:{parts[-2]}/{parts[-1]}" if len(parts) >= 2 else s
    elif s.startswith("/api/studio/file"):
        p = parse_qs(urlsplit(s).query).get("p", [""])[0]
        s = p
    if s.startswith("asset:"):
        rest = s[len("asset:") :].lstrip("/")
        d, _, f = rest.partition("/")
        if d not in ("music", "sfx") or not SAFE_FILE.match(f):
            raise JobError("File musik tidak valid.")
        return "asset", str(repo / "assets" / "audio" / d / f)
    if not s or ".." in s:
        raise JobError("Sumber musik kosong / tidak valid.")
    return "storage", s


def run(ctx: JobCtx) -> None:
    rt = ctx.rt
    st = ctx.job.get("settings") or {}
    kind, ref = resolve_src(str(st.get("src") or ""), rt.cfg.repo)
    work = rt.cfg.tmp / f"beats-{ctx.id}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        if kind == "asset":
            path = Path(ref)
            if not path.exists():
                raise JobError("File musik tidak ada di folder assets/audio laptop (repo belum di-update?).")
        else:
            ctx.progress(0.1, "Mengunduh musik…", force=True)
            path = work / ("musik" + (Path(ref).suffix or ".mp3"))
            try:
                rt.supa.download(ref, path)
            except Exception as e:
                raise JobError("File musik tidak ditemukan di penyimpanan.") from e
        ctx.progress(0.4, "Mendeteksi ketukan musik…", force=True)
        try:
            res = beats.analyze(path)
        except Exception as e:
            log.exception("Analisis ketukan gagal")
            raise JobError("Musik tidak bisa dibaca. Coba file mp3/wav lain.") from e
        msg = f"Ketemu {res['bpm']:.0f} BPM, {len(res['beats'])} ketukan" if res.get("bpm") else "Ketukan tidak jelas — potongan tidak ditempel ke ketukan"
        ctx.done({"result": res, "engine_used": "librosa"}, msg)
    finally:
        shutil.rmtree(work, ignore_errors=True)
