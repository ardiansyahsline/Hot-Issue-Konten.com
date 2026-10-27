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
from .supa import norm_path

log = vlog.get("render")

SAFE_FILE = re.compile(r"^[\w.-]+\.(mp3|wav|m4a|ogg|aac|flac|png|jpe?g|webp|gif|svg|mp4|webm|mov)$", re.I)
ASSET = re.compile(r"^/api/studio/asset/(sfx|music)/([^/?#]+)$")
DATA_URL = re.compile(r"^data:(audio|image)/([\w.+-]+);base64,([A-Za-z0-9+/=]+)$")
MAX_UPLOAD = 200 * 1024 * 1024
EXT_OF = {"mpeg": ".mp3", "mp3": ".mp3", "wav": ".wav", "x-wav": ".wav", "png": ".png", "jpeg": ".jpg", "webp": ".webp", "gif": ".gif", "svg+xml": ".svg"}
SHARED_DIRS = {"voices", "sfx", "tts", "vo"}  # folder storage yang boleh dibaca semua user Studio
# logo brand bawaan (BRANDS di lib/studio/timeline.ts) → file di folder public repo; remotion/Root.tsx memetakannya ke <public>/brand/<file>
PRESET_LOGOS = {"/konten-logo.png": "konten-logo.png", "/brand/tws-logo.svg": "brand/tws-logo.svg"}
# perkiraan sisa waktu render (linear dari waktu berjalan) baru ditampilkan sesudah progres sekian — di awal masih terlalu meleset
ETA_MIN_FRAC = 0.10


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


def owner_can_read(supa, owner: str | None) -> Callable[[str], bool]:
    """aturan baca storage untuk pemilik job (created_by) — sama dengan studioCanRead (lib/studio/storage.server.ts) & RLS studio_read:
    admin semua; voices/ sfx/ tts/ vo/ dipakai bersama; uploads/<id pemilik>/ saja; renders/ hanya kalau baris studio_render_jobs-nya milik pemilik"""
    admin: list[bool] = []

    def can(p: str) -> bool:
        dirs = p.split("/")[:-1]  # folder saja, seperti storage.foldername()
        if dirs and dirs[0] in SHARED_DIRS:
            return True
        if not owner:  # pemilik sudah dihapus (created_by null): hanya folder bersama
            return False
        if not admin:  # cek admin sekali saja per job
            admin.append(bool(supa.select("profiles", select="id", id=f"eq.{owner}", role="eq.admin")))
        if admin[0]:
            return True
        if dirs[:1] == ["uploads"]:
            return len(dirs) > 1 and dirs[1] == owner
        if dirs[:1] != ["renders"]:
            return False
        return bool(supa.select("studio_render_jobs", select="id", result_path=f"eq.{p}", created_by=f"eq.{owner}", limit="1"))

    return can


def rewrite_timeline(tl, public: Path, repo: Path, fetch: Callable[[str, Path], None], can_read: Callable[[str], bool] | None = None) -> tuple[object, list[str]]:
    """ganti semua alamat /api/studio/... di timeline dengan /public/... dan siapkan filenya. Balikan (timeline baru, daftar file gagal).
    File storage yang tidak boleh dibaca pemilik job (can_read) dianggap gagal. Media yang gagal disiapkan dibuang dari timeline
    (logo/klip/latar/VO → null, musik → "bed") supaya render tidak batal karena file 404."""
    missing: list[str] = []
    bad: set[str] = set()  # alamat asli yang gagal disiapkan
    done: dict[str, str] = {}

    def fix(s: str) -> str:
        if s in done:
            return done[s]
        out = s
        if s in PRESET_LOGOS:  # alamat tetap, filenya disalin ke <public>/brand/
            src = repo / "public" / PRESET_LOGOS[s]
            dst = public / "brand" / src.name
            if src.exists():
                dst.parent.mkdir(parents=True, exist_ok=True)
                if not dst.exists():
                    shutil.copyfile(src, dst)
            else:
                missing.append(s)
                bad.add(s)
        elif s.startswith("/api/studio/asset/"):
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
                    bad.add(s)
        elif s.startswith("/api/studio/file"):
            p = _storage_path(s)
            if p:
                ext = Path(p).suffix.lower()
                ext = ext if re.fullmatch(r"\.[a-z0-9]{2,5}", ext) else ".bin"
                name = hashlib.sha1(p.encode("utf-8")).hexdigest()[:16] + ext
                dst = public / "st" / name
                try:
                    if can_read and not can_read(norm_path(p)):
                        raise PermissionError("pemilik job tidak boleh membaca file ini")
                    if not dst.exists():
                        fetch(p, dst)
                    out = f"/public/st/{name}"
                except Exception as e:
                    log.warning("File %s tidak bisa diunduh: %s", p, e)
                    missing.append(p)
                    bad.add(s)
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
                    bad.add(s)
        done[s] = out
        return out

    def walk(v):
        if isinstance(v, str):
            return fix(v) if v.startswith(("/api/studio/", "data:")) or v in PRESET_LOGOS else v
        if isinstance(v, list):
            return [walk(x) for x in v]
        if isinstance(v, dict):
            return {k: walk(x) for k, x in v.items()}
        return v

    def gone(v) -> bool:
        return isinstance(v, str) and v in bad

    out = walk(tl)
    if bad and isinstance(out, dict):  # media yang tidak ada di folder public → buang (komposisi menganggap null = tanpa media)
        brand = out.get("brand")
        if isinstance(brand, dict) and gone(brand.get("logo")):
            brand["logo"] = None
        for sc in out.get("scenes") or []:
            for key, field in (("layout", "src"), ("bg", "media")):
                o = sc.get(key) if isinstance(sc, dict) else None
                if isinstance(o, dict) and gone(o.get(field)):
                    o[field] = None
        music = out.get("music")
        if isinstance(music, dict) and gone(music.get("src")):
            music["src"] = "bed"
        vo = out.get("vo")
        if isinstance(vo, dict):
            if gone(vo.get("full")):
                vo["full"] = None
            if isinstance(vo.get("lines"), list):
                vo["lines"] = [x for x in vo["lines"] if not (isinstance(x, dict) and gone(x.get("src")))]
    return out, missing


def copy_assets(repo: Path, public: Path) -> int:
    """semua SFX & musik repo → <public>/sfx & <public>/music (remotion/Root.tsx memetakan /api/studio/asset/<dir>/<file> ke sana),
    logo brand bawaan → <public>/brand/<file>"""
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
    for rel in PRESET_LOGOS.values():
        f = repo / "public" / rel
        if f.is_file() and not (public / "brand" / f.name).exists():
            (public / "brand").mkdir(parents=True, exist_ok=True)
            shutil.copyfile(f, public / "brand" / f.name)
            n += 1
    return n


def builtin_ids(repo: Path) -> set[str]:
    """id SFX bawaan = SFX_BUILTIN di lib/studio/sfxMeta.ts (sama dengan website & komposisi: extraSfxOf / sfxById), BUKAN sfx.json —
    SFX dari `tambah_sfx.py --juga-json` masuk sfx.json tapi bagi komposisi tetap SFX tambahan (studio_sfx → props.sfxExtra)"""
    try:
        src = (repo / "lib" / "studio" / "sfxMeta.ts").read_text(encoding="utf-8")
    except OSError:
        return set()  # tidak terbaca: semua id dicari di studio_sfx (aman, sfxById tetap mengutamakan bawaan)
    m = re.search(r"SFX_BUILTIN\b[^=]*=\s*\[(.*?)^\];", src, re.S | re.M)
    return set(re.findall(r"""[{,]\s*id\s*:\s*["'`]([^"'`]+)["'`]""", m.group(1))) if m else set()


def _num(v, d: float) -> float:
    """angka dari studio_sfx; hanya None yang pakai nilai bawaan (0 sah: SFX Freesound disimpan tp 0 = puncak skala penuh)"""
    return float(v) if v is not None else d


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
                "lufs": _num(r.get("lufs"), -20.0), "tp": _num(r.get("tp"), -3.0), "hit": _num(r.get("hit"), 0.0), "peak": _num(r.get("peak"), 0.0),
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
    try:
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
                    raise Cancelled("batal")
                if now - t0 > timeout:
                    raise JobError("Render terlalu lama dan dihentikan. Coba video yang lebih pendek.")
    except BaseException:  # batal (juga dari progres), jaringan putus, Ctrl+C kedua → node & Chrome jangan ditinggal jalan
        _kill(p)
        try:
            p.wait(timeout=30)
        except Exception:
            pass
        raise
    return p.wait(), tail


# ---------------------------------------------------------------- job
def render_left(elapsed: float, frac: float) -> float | None:
    """perkiraan sisa render (detik) untuk pesan "· sisa ±N": linear dari waktu berjalan, baru dipercaya sesudah ≥ 10% progres"""
    if frac < ETA_MIN_FRAC or frac <= 0 or elapsed < 0:
        return None
    return max(0.0, elapsed * (1.0 - min(1.0, frac)) / frac)


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
        except Exception:  # internet putus sebentar: render jalan terus, dicek lagi 3 dtk kemudian
            return False

    t_start = getattr(ctx, "t0", None) or time.monotonic()

    def eta(frac: float) -> None:
        left = render_left(time.monotonic() - t_start, frac)
        if left is not None:
            ctx.eta(left)

    def on_line(line: str) -> None:
        log.debug("remotion: %s", line)
        pr = parse_progress(line)
        if not pr:
            return
        st, f = pr
        base, span, label = {"bundle": (0.08, 0.1, "Menyiapkan komposisi…"), "render": (0.2, 0.6, "Merender gambar…"), "encode": (0.8, 0.08, "Menyusun video…")}[st]
        eta(base + span * f)
        ctx.progress(base + span * f, f"{label} {int(f * 100)}%")

    try:
        ctx.progress(0.02, "Menyiapkan file audio & gambar…", force=True)
        can_read = owner_can_read(rt.supa, job.get("created_by"))  # service role bisa baca semua: batasi ke file yang boleh dibuka pemilik job
        tl2, missing = rewrite_timeline(tl, public, cfg.repo, lambda p, dst: rt.supa.download(p, dst), can_read)
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
        eta(0.2)
        ctx.progress(0.2, "Merender gambar…", force=True)
        args = [node, str(cli), "render", str(bundle), "StudioVideo", str(raw), f"--props={props}", f"--concurrency={cfg.render_concurrency}", "--codec=h264", "--log=info", *conf_arg]
        browser = getattr(cfg, "render_browser", "")
        if browser:  # Chrome headless sendiri (kalau unduhan otomatis Remotion diblokir jaringan)
            args.append(f"--browser-executable={browser}")
        code, tail = run_cli(args, cfg.repo, on_line, stop, cfg.render_timeout_min * 60)
        if code != 0 or not raw.exists():
            log.error("remotion render gagal:\n%s", "\n".join(tail))
            raise JobError("Render video gagal di laptop (cek log worker).")

        eta(0.9)
        ctx.progress(0.9, "Menyamakan volume akhir (-14 LUFS)…", force=True)
        final = work / "final.mp4"
        if ff.has_audio(raw):
            mix.loudnorm_2pass(raw, final, video=True)
        else:
            shutil.copyfile(raw, final)
        size = final.stat().st_size
        if size > MAX_UPLOAD:
            raise JobError("File video terlalu besar untuk penyimpanan (maks 200 MB). Coba durasi lebih pendek.")
        eta(0.95)
        ctx.progress(0.95, "Mengunggah video…", force=True)
        path = rt.supa.upload(f"renders/{ctx.id}.mp4", final, "video/mp4", timeout=1800)
        msg = "Video siap diunduh" + (f" ({len(missing)} file tidak ketemu, dilewati)" if missing else "")
        ctx.done({"result_path": path}, msg)
        log.info("Render %s selesai: %.1f MB", ctx.id, size / 1024 / 1024)
    finally:
        shutil.rmtree(work, ignore_errors=True)
