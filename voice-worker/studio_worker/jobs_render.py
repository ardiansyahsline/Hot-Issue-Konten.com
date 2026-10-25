"""
Antrian render MP4 di laptop (studio_render_jobs) pakai Remotion CLI (@remotion/cli@4.0.535, dipasang install.ps1 dengan --no-save).

Langkah:
  1. salin SFX/musik repo & unduh file storage yang dipakai timeline ke folder public sementara;
     src "/api/studio/asset/<dir>/<file>" → "/public/<dir>/<file>", "/api/studio/file?p=<path>" → "/public/st/<hash>.<ext>"
     (data:audio/... dari VO cadangan juga ditulis jadi file; SFX tambahan studio_sfx dikirim sebagai props.sfxExtra)
  2. `remotion bundle remotion/index.ts --public-dir=<tmp>` lalu SFX bawaan juga ditaruh di <bundle>/api/studio/asset/<dir>/
     (komposisi menghitung alamat SFX bawaan sendiri lewat sfxSrc(), jadi alamat itu harus tetap bisa dibuka server render)
  3. `remotion render <bundle> StudioVideo out.mp4 --props=props.json --concurrency=2` (progres dibaca dari output CLI)
  4. ffmpeg loudnorm 2 tahap → -14 LUFS / TP -1 dBTP (video di-copy), upload renders/<id>.mp4
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import queue
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qs, unquote, urlsplit

from . import ff, mix
from . import log as vlog
from .jobctx import Cancelled, JobCtx, JobError

log = vlog.get("render")

SAFE_FILE = re.compile(r"^[\w.-]+\.(mp3|wav|m4a|ogg|aac|flac|png|jpe?g|webp|gif|svg|mp4|webm|mov)$", re.I)
ASSET = re.compile(r"^/api/studio/asset/(sfx|music)/([^/?#]+)$")
DATA_URL = re.compile(r"^data:(audio|image)/([\w.+-]+);base64,([A-Za-z0-9+/=]+)$")
MAX_UPLOAD = 200 * 1024 * 1024
EXT_OF = {"mpeg": ".mp3", "mp3": ".mp3", "wav": ".wav", "x-wav": ".wav", "png": ".png", "jpeg": ".jpg", "webp": ".webp", "gif": ".gif", "svg+xml": ".svg"}


# ---------------------------------------------------------------- cek kesiapan
def cli_js(repo: Path) -> Path | None:
    p = repo / "node_modules" / "@remotion" / "cli" / "remotion-cli.js"
    return p if p.exists() else None


def node_bin() -> str | None:
    return shutil.which("node")


def check(cfg) -> tuple[bool, str]:
    if not cfg.render:
        return False, "render dimatikan (RENDER_ENABLED=0)"
    if not node_bin():
        return False, "Node.js belum terpasang"
    if not (cfg.repo / "remotion" / "index.ts").exists():
        return False, "remotion/index.ts tidak ada di repo (git pull dulu)"
    if not cli_js(cfg.repo):
        return False, "@remotion/cli belum terpasang (jalankan install.ps1)"
    if not ff.available():
        return False, "ffmpeg belum terpasang"
    return True, "siap"


# ---------------------------------------------------------------- tulis ulang alamat file di timeline
def _storage_path(src: str) -> str | None:
    q = urlsplit(src).query
    p = parse_qs(q).get("p", [""])[0]
    return p if p and ".." not in p.split("/") else None


def rewrite_timeline(tl, public: Path, repo: Path, fetch: Callable[[str, Path], None]) -> tuple[object, list[str]]:
    """ganti semua alamat /api/studio/... di timeline dengan /public/... dan siapkan filenya. Balikan (timeline baru, daftar file gagal)."""
    missing: list[str] = []
    done: dict[str, str] = {}

    def fix(s: str) -> str:
        if s in done:
            return done[s]
        out = s
        if s.startswith("/api/studio/asset/"):
            m = ASSET.match(urlsplit(s).path)
            f = unquote(m.group(2)) if m else ""
            if m and SAFE_FILE.match(f):
                d = m.group(1)
                src = repo / "assets" / "audio" / d / f
                dst = public / d / f
                if src.exists():
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    if not dst.exists():
                        shutil.copyfile(src, dst)
                    out = f"/public/{d}/{f}"
                else:
                    missing.append(s)
        elif s.startswith("/api/studio/file"):
            p = _storage_path(s)
            if p:
                ext = Path(p).suffix.lower()
                ext = ext if re.fullmatch(r"\.[a-z0-9]{2,5}", ext) else ".bin"
                name = hashlib.sha1(p.encode("utf-8")).hexdigest()[:16] + ext
                dst = public / "st" / name
                try:
                    if not dst.exists():
                        fetch(p, dst)
                    out = f"/public/st/{name}"
                except Exception as e:
                    log.warning("File %s tidak bisa diunduh: %s", p, e)
                    missing.append(p)
        elif s.startswith("data:"):
            m = DATA_URL.match(s)
            if m:
                try:
                    raw = base64.b64decode(m.group(3), validate=True)
                    name = hashlib.sha1(raw).hexdigest()[:16] + EXT_OF.get(m.group(2).lower(), ".bin")
                    dst = public / "st" / name
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    dst.write_bytes(raw)
                    out = f"/public/st/{name}"
                except (binascii.Error, ValueError):
                    missing.append("data-url")
        done[s] = out
        return out

    def walk(v):
        if isinstance(v, str):
            return fix(v) if v.startswith(("/api/studio/", "data:")) else v
        if isinstance(v, list):
            return [walk(x) for x in v]
        if isinstance(v, dict):
            return {k: walk(x) for k, x in v.items()}
        return v

    return walk(tl), missing


def copy_assets(repo: Path, public: Path) -> int:
    """semua SFX & musik repo → <public>/sfx & <public>/music (remotion/Root.tsx memetakan /api/studio/asset/<dir>/<file> ke sana)"""
    n = 0
    for d in ("sfx", "music"):
        src = repo / "assets" / "audio" / d
        if not src.is_dir():
            continue
        (public / d).mkdir(parents=True, exist_ok=True)
        for f in src.iterdir():
            if f.is_file() and SAFE_FILE.match(f.name) and not (public / d / f.name).exists():
                shutil.copyfile(f, public / d / f.name)
                n += 1
    return n


def builtin_ids(repo: Path) -> set[str]:
    try:
        return {x["id"] for x in json.loads((repo / "assets" / "audio" / "sfx" / "sfx.json").read_text(encoding="utf-8"))}
    except Exception:
        return set()


def extra_sfx(supa, tl: dict, public: Path, repo: Path) -> list[dict]:
    """SFX tambahan (studio_sfx: Sonniss / Freesound) yang dipakai timeline → diunduh + dikirim sebagai props.sfxExtra"""
    used = {str(c.get("id")) for s in tl.get("scenes") or [] if isinstance(s, dict) for c in s.get("sfx") or [] if isinstance(c, dict) and c.get("id")}
    need = sorted(i for i in used - builtin_ids(repo) if re.fullmatch(r"[a-z0-9][a-z0-9-]{1,60}", i))
    if not need:
        return []
    out = []
    for r in supa.select("studio_sfx", select="*", id=f"in.({','.join(need)})"):
        p = str(r.get("path") or "")
        if not p or r.get("id") not in need:
            continue
        name = hashlib.sha1(p.encode("utf-8")).hexdigest()[:16] + (Path(p).suffix.lower() or ".mp3")
        dst = public / "st" / name
        try:
            if not dst.exists():
                supa.download(p, dst)
        except Exception as e:
            log.warning("SFX tambahan %s tidak bisa diunduh: %s", r.get("id"), e)
            continue
        out.append(
            {
                "id": r["id"], "file": Path(p).name, "cat": r.get("cat") or "ui", "tags": r.get("tags") or [], "dur": float(r.get("dur") or 1),
                "lufs": float(r.get("lufs") or -20), "tp": float(r.get("tp") or -3), "hit": float(r.get("hit") or 0), "peak": float(r.get("peak") or 0),
                "use": r.get("use_for") or "", "src": f"/public/st/{name}",
            }
        )
    return out


def stage_builtin_assets(repo: Path, bundle: Path) -> int:
    """SFX & musik repo juga disajikan di alamat aslinya (/api/studio/asset/<dir>/<file>) di dalam bundle"""
    n = 0
    for d in ("sfx", "music"):
        src = repo / "assets" / "audio" / d
        if not src.is_dir():
            continue
        dst = bundle / "api" / "studio" / "asset" / d
        dst.mkdir(parents=True, exist_ok=True)
        for f in src.iterdir():
            if f.is_file() and SAFE_FILE.match(f.name):
                shutil.copyfile(f, dst / f.name)
                n += 1
    return n


# ---------------------------------------------------------------- proses Remotion CLI
PROG = re.compile(r"(Bundling|Render\w*|Encod\w*|Stitch\w*)\D*?(\d+)\s*/\s*(\d+)")
PCT = re.compile(r"Bundling\s+(\d+)%")


def parse_progress(line: str) -> tuple[str, float] | None:
    """baris output CLI → (tahap, 0..1)"""
    m = PCT.search(line)
    if m:
        return "bundle", int(m.group(1)) / 100
    m = PROG.search(line)
    if not m:
        return None
    a, b = int(m.group(2)), int(m.group(3))
    if b <= 0:
        return None
    stage = "render" if m.group(1).startswith("Render") else "encode" if m.group(1).startswith(("Encod", "Stitch")) else "bundle"
    return stage, min(1.0, a / b)


def _kill(p: subprocess.Popen) -> None:
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)], capture_output=True, timeout=30, creationflags=ff.CHILD_FLAGS)
        else:
            p.kill()
    except Exception:
        pass


def run_cli(args: list[str], cwd: Path, on_line: Callable[[str], None], should_stop: Callable[[], bool], timeout: float) -> tuple[int, list[str]]:
    env = {**os.environ, "NO_COLOR": "1", "FORCE_COLOR": "0"}
    p = subprocess.Popen(
        args, cwd=str(cwd), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=env, creationflags=ff.CHILD_FLAGS
    )
    q: queue.Queue = queue.Queue()

    def reader() -> None:
        assert p.stdout is not None
        buf = b""
        while True:
            ch = p.stdout.read1(4096) if hasattr(p.stdout, "read1") else p.stdout.read(4096)  # type: ignore[attr-defined]
            if not ch:
                break
            buf += ch
            parts = re.split(rb"[\r\n]+", buf)
            buf = parts.pop()
            for x in parts:
                q.put(x.decode("utf-8", "replace"))
        if buf:
            q.put(buf.decode("utf-8", "replace"))
        q.put(None)

    threading.Thread(target=reader, daemon=True).start()
    tail: list[str] = []
    t0 = time.time()
    last_check = 0.0
    while True:
        try:
            line = q.get(timeout=1.0)
        except queue.Empty:
            line = ""
        if line is None:
            break
        if line.strip():
            tail = (tail + [line.strip()])[-25:]
            on_line(line)
        now = time.time()
        if now - last_check > 3:
            last_check = now
            if should_stop():
                _kill(p)
                raise Cancelled("batal")
            if now - t0 > timeout:
                _kill(p)
                raise JobError("Render terlalu lama dan dihentikan. Coba video yang lebih pendek.")
    return p.wait(), tail


# ---------------------------------------------------------------- job
def run(ctx: JobCtx) -> None:
    rt = ctx.rt
    cfg = rt.cfg
    ok, why = check(cfg)
    if not ok:
        raise JobError(f"Laptop belum bisa render: {why}.")
    job = ctx.job
    tl = job.get("timeline")
    if not isinstance(tl, dict) or not tl.get("scenes"):
        raise JobError("Timeline kosong — tidak ada yang bisa dirender.")
    work = cfg.tmp / f"render-{ctx.id}"
    shutil.rmtree(work, ignore_errors=True)
    public, bundle = work / "public", work / "bundle"
    public.mkdir(parents=True, exist_ok=True)
    node, cli = node_bin(), cli_js(cfg.repo)
    assert node and cli
    conf = cfg.repo / "remotion.config.mjs"
    conf_arg = [f"--config={conf}"] if conf.exists() else []

    def stop() -> bool:
        try:
            ctx.check_cancel()
            return False
        except Cancelled:
            return True

    def on_line(line: str) -> None:
        log.debug("remotion: %s", line)
        pr = parse_progress(line)
        if not pr:
            return
        st, f = pr
        base, span, label = {"bundle": (0.08, 0.1, "Menyiapkan komposisi…"), "render": (0.2, 0.6, "Merender gambar…"), "encode": (0.8, 0.08, "Menyusun video…")}[st]
        ctx.progress(base + span * f, f"{label} {int(f * 100)}%")

    try:
        ctx.progress(0.02, "Menyiapkan file audio & gambar…", force=True)
        tl2, missing = rewrite_timeline(tl, public, cfg.repo, lambda p, dst: rt.supa.download(p, dst))
        if missing:
            log.warning("Render %s: %d file tidak ketemu: %s", ctx.id, len(missing), missing[:5])
        assert isinstance(tl2, dict)
        variant = job.get("variant") or "vo"
        if variant == "tanpa-vo":
            tl2["muteVo"] = True
        copy_assets(cfg.repo, public)
        extra = extra_sfx(rt.supa, tl2, public, cfg.repo)
        props = work / "props.json"
        body = {"timeline": tl2, "audio": "novo" if variant == "tanpa-vo" else "all", "showSafeZone": False, "sfxExtra": extra}
        props.write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")

        ctx.progress(0.05, "Menyiapkan komposisi…", force=True)
        code, tail = run_cli([node, str(cli), "bundle", "remotion/index.ts", f"--out-dir={bundle}", f"--public-dir={public}", "--log=info", *conf_arg], cfg.repo, on_line, stop, 15 * 60)
        if code != 0 or not (bundle / "index.html").exists():
            log.error("remotion bundle gagal:\n%s", "\n".join(tail))
            raise JobError("Komposisi video gagal disiapkan di laptop (cek log worker).")
        stage_builtin_assets(cfg.repo, bundle)

        raw = work / "raw.mp4"
        ctx.progress(0.2, "Merender gambar…", force=True)
        args = [node, str(cli), "render", str(bundle), "StudioVideo", str(raw), f"--props={props}", f"--concurrency={cfg.render_concurrency}", "--codec=h264", "--log=info", *conf_arg]
        browser = getattr(cfg, "render_browser", "")
        if browser:  # Chrome headless sendiri (kalau unduhan otomatis Remotion diblokir jaringan)
            args.append(f"--browser-executable={browser}")
        code, tail = run_cli(args, cfg.repo, on_line, stop, cfg.render_timeout_min * 60)
        if code != 0 or not raw.exists():
            log.error("remotion render gagal:\n%s", "\n".join(tail))
            raise JobError("Render video gagal di laptop (cek log worker).")

        ctx.progress(0.9, "Menyamakan volume akhir (-14 LUFS)…", force=True)
        final = work / "final.mp4"
        if ff.has_audio(raw):
            mix.loudnorm_2pass(raw, final, video=True)
        else:
            shutil.copyfile(raw, final)
        size = final.stat().st_size
        if size > MAX_UPLOAD:
            raise JobError("File video terlalu besar untuk penyimpanan (maks 200 MB). Coba durasi lebih pendek.")
        ctx.progress(0.95, "Mengunggah video…", force=True)
        path = rt.supa.upload(f"renders/{ctx.id}.mp4", final, "video/mp4", timeout=1800)
        msg = "Video siap diunduh" + (f" ({len(missing)} file tidak ketemu, dilewati)" if missing else "")
        ctx.done({"result_path": path}, msg)
        log.info("Render %s selesai: %.1f MB", ctx.id, size / 1024 / 1024)
    finally:
        shutil.rmtree(work, ignore_errors=True)
