"""
Tes mandiri render MP4 cepat (studio_worker/render_cache.py + bagian cache, tab paralel & migrasi .env) TANPA Remotion / GPU / internet:
  .venv\\Scripts\\python selftest_render_cache.py           (semua tes)
  .venv\\Scripts\\python selftest_render_cache.py migrasi   (hanya tes yang namanya mengandung kata itu)
Yang dites: kunci cache berubah kalau kode / versi Remotion / aset bawaan berubah (dan TIDAK berubah kalau hanya mtime kode atau
node_modules lain), cache dibangun atomik & 2 terbaru disimpan, hardlink per job tidak pernah menulis ke file cache (tulisan nyasar
ketahuan → dibangun ulang), cadangan salin kalau hardlink gagal, job render lengkap (Remotion CLI & Supabase dipalsukan): cache miss →
bundle, hit → langsung render, render gagal karena cache → dibangun ulang sekali, error komposisi biasa tidak diulang, file suara VO
tidak diunduh untuk versi tanpa VO, pra-bangun di latar + job menunggu kuncinya (gagal → tidak diulang tiap cek berkala), tab
paralel auto dari CPU & RAM palsu, migrasi "RENDER_CONCURRENCY=2" .env lama (2 varian, CRLF/BOM terjaga, angka pemakai dihormati,
sekali saja, hanya oleh worker yang memegang kunci satu-instance), flag --concurrency CLI Remotion menang atas
Config.setConcurrency di remotion.config.mjs, kunci ikut node_modules/.package-lock.json (paket lain yang di-bundle), sisa folder job
lama yang tidak terhapus tidak menggagalkan job, sisa sekali-pakai PID lama dibersihkan, tab tidak pernah lebih dari thread CPU
(batas Remotion), dan .env ANSI / UTF-16 tetap terbaca.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

from studio_worker import config  # noqa: E402

config.apply_thread_limits(2)

from studio_worker import jobs_render, render_cache  # noqa: E402
from studio_worker.jobctx import Cancelled, JobCtx, Runtime  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
TMP = Path(tempfile.mkdtemp(prefix="vw-selftest-cache-"))
IS_WIN = os.name == "nt"
results: list[tuple[str, bool, str]] = []
TESTS: list = []
LOGOS = tuple(jobs_render.PRESET_LOGOS.values())

_records: list[logging.LogRecord] = []


class _Cap(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        _records.append(record)


_vw = logging.getLogger("vw")
_vw.setLevel(logging.DEBUG)
_vw.propagate = False
_vw.addHandler(_Cap())


def logs(level: int = logging.INFO) -> list[str]:
    return [r.getMessage() for r in _records if r.levelno >= level]


def test(fn):
    TESTS.append(fn)
    return fn


_orig = {"run_cli": jobs_render.run_cli, "link": os.link, "ram": config.total_ram_gb}


def reset() -> None:
    t = jobs_render._pre.get("thread")
    if t is not None:
        t.join(timeout=30)
    jobs_render._pre.update(thread=None)
    jobs_render._pre["stop"].clear()
    jobs_render.run_cli = _orig["run_cli"]
    os.link = _orig["link"]
    config.total_ram_gb = _orig["ram"]
    jobs_render._gpu.update(prepared=False, nvenc_bad=False, angle_bad=False, thread=None, said=False)
    jobs_render.last_probe = {}


def run_test(fn) -> None:
    name = fn.__name__.removeprefix("t_").replace("_", " ")
    t0 = time.time()
    reset()
    _records.clear()
    try:
        info = fn() or ""
        results.append((name, True, f"{info} ({time.time() - t0:.1f} dtk)"))
        print(f"[OK]    {name} {info}")
    except Exception as e:
        results.append((name, False, f"{type(e).__name__}: {e}"))
        print(f"[GAGAL] {name}: {e}")
        traceback.print_exc()
    finally:
        reset()


def fake_repo(d: Path) -> Path:
    """repo mini: kode komposisi, config, versi paket Remotion, SFX/musik & logo preset"""
    for rel, body in {
        "remotion/index.ts": "export {};\n",
        "remotion/Root.tsx": "// root\n",
        "components/remotion/studio/fx.tsx": "export const Grain = 1;\n",
        "lib/studio/timeline.ts": "export const FPS = 30;\n",
        "remotion.config.mjs": "// config\n",
        "package.json": "{}\n",
        "package-lock.json": "{}\n",
        "tsconfig.json": "{}\n",
        "node_modules/@remotion/cli/package.json": '{"version": "4.0.535"}',
        "node_modules/@remotion/cli/remotion-cli.js": "// palsu\n",
        "node_modules/remotion/package.json": '{"version": "4.0.535"}',
        "node_modules/lain/index.js": "// paket lain\n",
        "node_modules/.package-lock.json": '{"packages": {"node_modules/mediabunny": {"version": "1.61.3"}}}',
        "assets/audio/sfx/ui-pop.mp3": "pop",
        "assets/audio/sfx/whoosh.mp3": "whoosh",
        "assets/audio/music/lagu.mp3": "lagu",
        "public/konten-logo.png": "png",
        "public/brand/tws-logo.svg": "<svg/>",
    }.items():
        p = d / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
    return d


def key(repo: Path) -> str:
    return render_cache.cache_key(repo, jobs_render.SAFE_FILE, LOGOS)


def fake_build(calls: list, sleep: float = 0.0):
    """pengganti build_bundle: isi mirip bundle Remotion (index.html, chunk, public dasar, SFX bawaan di alamat asli)"""

    def build(out: Path) -> None:
        calls.append(out)
        if sleep:
            time.sleep(sleep)
        for rel, body in {"index.html": "<html></html>", "bundle.js": "js" * 50, "6.bundle.js": "chunk", "public/sfx/ui-pop.mp3": "pop",
                          "public/brand/konten-logo.png": "png", "api/studio/asset/sfx/ui-pop.mp3": "pop"}.items():
            p = out / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(body, encoding="utf-8")

    return build


# ---------------------------------------------------------------- kunci cache
@test
def t_kunci_cache_berubah_saat_file_berubah():
    repo = fake_repo(TMP / "repo-kunci")
    k0 = key(repo)
    assert k0 == key(repo), "kunci harus stabil"
    fx = repo / "components" / "remotion" / "studio" / "fx.tsx"
    st = fx.stat()
    os.utime(fx, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    assert key(repo) == k0, "kode: isi yang dihitung, bukan mtime (git checkout ulang tidak membangun ulang)"
    (repo / "node_modules" / "lain" / "index.js").write_text("// berubah\n")
    (repo / "components" / ".cache").mkdir()
    (repo / "components" / ".cache" / "x").write_text("x")
    assert key(repo) == k0, "node_modules paket lain & folder tersembunyi tidak ikut kunci (package-lock.json yang ikut)"
    hidden = repo / "node_modules" / ".package-lock.json"
    body = hidden.read_text()
    hidden.write_text(body)  # npm ci / npm i dengan pohon paket sama: file ditulis ulang, isi sama → tidak bangun ulang
    st = hidden.stat()
    os.utime(hidden, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    assert key(repo) == k0, "node_modules/.package-lock.json ditulis ulang dengan isi sama → kunci tetap"
    changes = {
        "kode komponen": lambda: fx.write_text("export const Grain = 2;\n"),
        "file kode baru": lambda: (repo / "lib" / "studio" / "baru.ts").write_text("export {};\n"),
        "remotion.config.mjs": lambda: (repo / "remotion.config.mjs").write_text("// config 2\n"),
        "package-lock.json": lambda: (repo / "package-lock.json").write_text('{"v": 2}\n'),
        "versi @remotion/cli": lambda: (repo / "node_modules" / "@remotion" / "cli" / "package.json").write_text('{"version": "4.0.536"}'),
        # git pull lalu install.ps1 (npm i) memperbarui paket lain yang ikut di-bundle (mediabunny, react, @fontsource…)
        "node_modules terpasang (npm i)": lambda: hidden.write_text('{"packages": {"node_modules/mediabunny": {"version": "1.62.0"}}}'),
        "SFX baru": lambda: (repo / "assets" / "audio" / "sfx" / "boom.mp3").write_text("boom"),
        "ukuran SFX": lambda: (repo / "assets" / "audio" / "sfx" / "ui-pop.mp3").write_text("pop pop"),
        "logo preset": lambda: (repo / "public" / "konten-logo.png").write_text("png2"),
        "file brand baru": lambda: (repo / "public" / "brand" / "lain.svg").write_text("<svg/>"),
    }
    seen = {k0}
    for name, change in changes.items():
        change()
        k = key(repo)
        assert k not in seen, f"kunci tidak berubah saat {name} berubah"
        seen.add(k)
    sfx = repo / "assets" / "audio" / "sfx" / "whoosh.mp3"
    st = sfx.stat()
    os.utime(sfx, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    assert key(repo) not in seen, "aset bawaan: daftar + ukuran + mtime ikut kunci"
    t0 = time.perf_counter()
    real = key(REPO)
    ms = (time.perf_counter() - t0) * 1000
    assert len(real) == 20
    return f"{len(changes) + 1} jenis perubahan → kunci baru; kunci repo asli dihitung {ms:.0f} ms"


# ---------------------------------------------------------------- cache & hardlink
@test
def t_cache_atomik_hardlink_tidak_menulis_ke_cache():
    tmp = TMP / "data-link" / "tmp"
    k = "k" * 20
    calls: list = []
    src, key1, built = render_cache.ensure(tmp, lambda: k, fake_build(calls))
    assert built and key1 == k and len(calls) == 1 and src == render_cache.root(tmp) / k / "bundle"
    assert calls[0].parent.name.startswith(".baru-") and not calls[0].exists(), "dibangun di folder sementara lalu di-rename"
    assert not [p for p in render_cache.root(tmp).iterdir() if p.name.startswith(".baru-")]
    man = json.loads((src.parent / render_cache.MANIFEST).read_text())
    assert man["key"] == k and "index.html" in man["files"] and "api/studio/asset/sfx/ui-pop.mp3" in man["files"]
    before = {p: (p.read_bytes(), os.stat(p).st_mtime_ns) for p in src.rglob("*") if p.is_file()}
    # job: hardlink + file job baru (st/) + file job yang namanya sama dengan file cache (logo yang dirujuk timeline)
    job = TMP / "data-link" / "job"
    pub = TMP / "data-link" / "job-public"
    (pub / "st").mkdir(parents=True)
    (pub / "st" / "abc.png").write_bytes(b"gambar job")
    (pub / "brand").mkdir()
    (pub / "brand" / "konten-logo.png").write_bytes(b"BEDA")
    linked, copied = render_cache.link_tree(src, job)
    assert linked == len(before) and copied == 0, (linked, copied)
    for p in before:
        assert os.path.samefile(p, job / p.relative_to(src)), "harus hardlink (satu file, dua nama)"
    n = render_cache.merge_new(pub, job / "public")
    assert n == 1 and (job / "public" / "st" / "abc.png").read_bytes() == b"gambar job"
    assert (job / "public" / "brand" / "konten-logo.png").read_text() == "png", "file cache ber-hardlink tidak boleh ditimpa"
    after = {p: (p.read_bytes(), os.stat(p).st_mtime_ns) for p in src.rglob("*") if p.is_file()}
    assert after == before and render_cache.intact(src.parent, k), "isi & mtime cache harus utuh sesudah job"
    shutil.rmtree(job)
    assert render_cache.intact(src.parent, k) and all(p.exists() for p in before), "hapus folder job tidak menyentuh cache"
    # hit: tidak dibangun lagi
    src2, _, built2 = render_cache.ensure(tmp, lambda: k, fake_build(calls))
    assert src2 == src and not built2 and len(calls) == 1
    # tulisan nyasar lewat hardlink (bug) → ketahuan (mtime/ukuran beda) → dibangun ulang, bukan dipakai rusak
    render_cache.link_tree(src, job)
    time.sleep(0.02)
    (job / "bundle.js").write_text("rusak")
    assert not render_cache.intact(src.parent, k)
    src3, _, built3 = render_cache.ensure(tmp, lambda: k, fake_build(calls))
    assert built3 and len(calls) == 2 and (src3 / "bundle.js").read_text() == "js" * 50
    assert any("rusak" in m for m in logs(logging.WARNING)), logs()
    # file yang hilang dari cache → juga dibangun ulang
    (src3 / "6.bundle.js").unlink()
    _, _, built4 = render_cache.ensure(tmp, lambda: k, fake_build(calls))
    assert built4 and len(calls) == 3
    return "rename atomik, hardlink = file yang sama, file job tidak menimpa cache, tulisan nyasar & file hilang → dibangun ulang"


@test
def t_hardlink_gagal_pakai_salinan():
    tmp = TMP / "data-salin" / "tmp"
    src, _, _ = render_cache.ensure(tmp, lambda: "s" * 20, fake_build([]))

    def no_link(a, b):
        raise OSError(1, "Operation not permitted (FAT32/exFAT palsu)")

    os.link = no_link  # type: ignore[assignment]
    job = TMP / "data-salin" / "job"
    linked, copied = render_cache.link_tree(src, job)
    assert linked == 0 and copied == 6, (linked, copied)
    assert (job / "index.html").read_text() == "<html></html>" and not os.path.samefile(src / "index.html", job / "index.html")
    (job / "bundle.js").write_text("job boleh menulis salinannya")
    assert render_cache.intact(src.parent, "s" * 20)
    pub = TMP / "data-salin" / "pub"
    (pub / "st").mkdir(parents=True)
    (pub / "st" / "a.mp3").write_bytes(b"a")
    assert render_cache.merge_new(pub, job / "public") == 1 and (job / "public" / "st" / "a.mp3").read_bytes() == b"a"
    return "hardlink ditolak sistem file → salin biasa (cache tetap utuh)"


@test
def t_rename_gagal_dipakai_sekali():
    """Windows: folder baru masih dipegang antivirus → rename dicoba ulang; tetap gagal → dipakai untuk job ini saja"""
    tmp = TMP / "data-rename" / "tmp"
    calls: list = []
    real_replace, tries = os.replace, render_cache.RENAME_TRIES
    n = {"replace": 0}

    def busy_replace(a, b):
        if Path(a).name.startswith(".baru-"):
            n["replace"] += 1
            raise PermissionError(5, "Access is denied (palsu)")
        return real_replace(a, b)

    try:
        render_cache.RENAME_TRIES = 3
        os.replace = busy_replace  # type: ignore[assignment]
        src, k, built = render_cache.ensure(tmp, lambda: "r" * 20, fake_build(calls))
        assert built and n["replace"] == 3 and src.parent.name.startswith(".baru-") and (src / "index.html").exists()
        assert not (render_cache.root(tmp) / ("r" * 20)).exists() and any("video ini saja" in m for m in logs(logging.WARNING))
        job = TMP / "data-rename" / "job"
        render_cache.link_tree(src, job)
        assert (job / "index.html").read_text() == "<html></html>"
    finally:
        os.replace = real_replace  # type: ignore[assignment]
        render_cache.RENAME_TRIES = tries
    src2, _, built2 = render_cache.ensure(tmp, lambda: "r" * 20, fake_build(calls))
    assert built2 and len(calls) == 2 and src2.parent.name == "r" * 20 and not src.parent.exists(), "sisa sekali-pakai dibuang"
    assert (job / "index.html").read_text() == "<html></html>", "folder job yang sudah di-hardlink tetap utuh"
    return "rename dicoba ulang, tetap gagal → dipakai sekali, job berikutnya membangun & menyimpan"


@test
def t_simpan_dua_cache_terbaru():
    tmp = TMP / "data-prune" / "tmp"
    for i, k in enumerate(("a" * 20, "b" * 20, "c" * 20)):
        render_cache.ensure(tmp, lambda k=k: k, fake_build([]))
        time.sleep(0.05)
    r = render_cache.root(tmp)
    assert sorted(p.name for p in r.iterdir()) == ["b" * 20, "c" * 20], list(r.iterdir())
    # dipakai lagi → jadi yang terbaru; bangun kunci baru → "b" (paling lama dipakai) yang dibuang
    render_cache.ensure(tmp, lambda: "b" * 20, fake_build([]))
    time.sleep(0.05)
    render_cache.ensure(tmp, lambda: "d" * 20, fake_build([]))
    assert sorted(p.name for p in r.iterdir()) == ["b" * 20, "d" * 20], list(r.iterdir())
    # sisa bangun yang mati di tengah jalan: dibuang kalau sudah basi
    stale = r / ".baru-dead-1-x"
    stale.mkdir()
    old = time.time() - render_cache.STALE_BUILD_SEC - 10
    os.utime(stale, (old, old))
    render_cache.prune(tmp)
    assert not stale.exists()
    return "2 cache terbaru disimpan, sisa bangun yang basi dibersihkan"


@test
def t_kode_berubah_di_tengah_bangun():
    tmp = TMP / "data-tengah" / "tmp"
    keys = iter(["x" * 20, "y" * 20, "y" * 20, "y" * 20])
    calls: list = []
    src, k, built = render_cache.ensure(tmp, lambda: next(keys), fake_build(calls))
    assert built and k == "y" * 20 and len(calls) == 2 and src.parent.name == "y" * 20
    assert not (render_cache.root(tmp) / ("x" * 20)).exists()
    return "git pull saat bundle → dibangun sekali lagi, disimpan dengan kunci baru"


@test
def t_sisa_folder_job_lama_tidak_menggagalkan_link():
    """job diulang dengan id sama (recover_stale) & folder job lama tidak terhapus tuntas (file dipegang program lain tanpa
    share-delete): file yang sudah hardlink ke cache dipakai (dulu SameFileError → "Tugas gagal"), file lain dihapus lalu di-link,
    file lain yang tidak bisa dihapus ditimpa salinan (seperti dulu). Cache tetap utuh."""
    tmp = TMP / "data-sisa" / "tmp"
    k = "w" * 20
    src, _, _ = render_cache.ensure(tmp, lambda: k, fake_build([]))
    job = TMP / "data-sisa" / "job"
    render_cache.link_tree(src, job)  # sisa job lama: semua hardlink ke cache ini
    for name, body in (("bundle.js", "sisa lain"), ("6.bundle.js", "sisa terkunci")):  # file lain (mis. cache versi lama)
        (job / name).unlink()
        (job / name).write_text(body)
    real_unlink = os.unlink

    def locked(path, *a, **kw):
        if Path(path) == job / "6.bundle.js":
            raise PermissionError(13, "The process cannot access the file because it is being used by another process (palsu)")
        return real_unlink(path, *a, **kw)

    os.unlink = locked  # type: ignore[assignment]
    try:
        linked, copied = render_cache.link_tree(src, job)
    finally:
        os.unlink = real_unlink  # type: ignore[assignment]
    assert (linked, copied) == (5, 1), (linked, copied)
    assert os.path.samefile(src / "index.html", job / "index.html"), "sudah hardlink ke cache → dipakai apa adanya"
    assert os.path.samefile(src / "bundle.js", job / "bundle.js"), "file lain yang bisa dihapus → diganti hardlink"
    assert (job / "6.bundle.js").read_text() == "chunk" and not os.path.samefile(src / "6.bundle.js", job / "6.bundle.js")
    assert render_cache.intact(src.parent, k), "cache tidak boleh berubah"
    # folder job baru (normal): tanpa cek tambahan, semua hardlink
    linked, copied = render_cache.link_tree(src, TMP / "data-sisa" / "job-baru")
    assert (linked, copied) == (6, 0), (linked, copied)
    return "hardlink sisa dipakai, file lain diganti / ditimpa, cache utuh"


@test
def t_rename_selalu_gagal_sisa_lama_dibuang():
    """rename .baru selalu ditolak di laptop itu (antivirus / OneDrive / pengindeks) + worker menyala ulang (PID baru): sisa
    sekali-pakai milik PID lain yang sudah basi (> STALE_BUILD_SEC) ikut dibuang — dulu menumpuk ±49 MB per worker menyala"""
    tmp = TMP / "data-sisa-pid" / "tmp"
    r = render_cache.root(tmp)
    stale, young = r / ".baru-qqqqqqqq-1111-aaaaaa", r / ".baru-qqqqqqqq-2222-bbbbbb"
    for d in (stale, young):
        (d / "bundle").mkdir(parents=True)
        (d / "bundle" / "index.html").write_text("<html></html>")
    old = time.time() - render_cache.STALE_BUILD_SEC - 60
    os.utime(stale, (old, old))
    real_replace, tries = os.replace, render_cache.RENAME_TRIES

    def deny(a, b):
        if Path(a).name.startswith(".baru-"):
            raise PermissionError(5, "Access is denied (palsu)")
        return real_replace(a, b)

    try:
        render_cache.RENAME_TRIES = 2
        os.replace = deny  # type: ignore[assignment]
        src, _, built = render_cache.ensure(tmp, lambda: "q" * 20, fake_build([]))
    finally:
        os.replace = real_replace  # type: ignore[assignment]
        render_cache.RENAME_TRIES = tries
    assert built and src.parent.name.startswith(f".baru-qqqqqqqq-{os.getpid()}-") and (src / "index.html").exists(), src
    assert not stale.exists(), "sisa sekali-pakai PID lain yang > 6 jam harus dibuang"
    assert young.exists(), "folder .baru yang masih baru tidak disentuh"
    return "sisa basi PID lama dibuang, folder sekali-pakai job ini & yang masih baru aman"


# ---------------------------------------------------------------- job render lengkap
class MiniSupa:
    def __init__(self, job: dict, files: dict | None = None):
        self.job = job
        self.files = dict(files or {})
        self.downloads: list[str] = []
        self.uploaded: dict[str, bytes] = {}

    def select(self, table, **params):
        if table == "studio_render_jobs" and "status" in params.get("select", ""):
            return [{"status": self.job["status"]}]
        return []

    def update(self, table, filters, patch):
        if filters.get("id") == f"eq.{self.job['id']}" and self.job["status"] == "proses":
            self.job.update(patch)
            return [dict(self.job)]
        return []

    def upload(self, path, data, content_type, timeout=0):
        self.uploaded[path] = data.read_bytes() if isinstance(data, Path) else data
        return path

    def download(self, path, dest=None, timeout=0):
        self.downloads.append(path)
        if path not in self.files:
            raise FileNotFoundError(path)
        if dest is not None:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(self.files[path])
        return self.files[path]


def job_env(name: str, **kw):
    if not shutil.which("node") or not shutil.which("ffmpeg"):
        return None
    repo = fake_repo(TMP / f"repo-{name}")
    data = TMP / f"data-{name}"
    (data / "tmp").mkdir(parents=True, exist_ok=True)
    base = dict(render=True, render_gpu="off", render_bitrate="5M", render_browser="", render_timeout_min=40, render_concurrency=3,
                render_conc_info="auto: 12 thread, 15,7 GB RAM", repo=repo, tmp=data / "tmp")
    base.update(kw)
    return SimpleNamespace(**base)


def timeline() -> dict:
    return {
        "brand": {"logo": "/api/studio/file?p=uploads%2Fu1%2Flogo.png"},
        "scenes": [{"id": "s1", "dur": 2, "layout": {"kind": "title"}, "bg": {"media": None}, "sfx": []}],
        "vo": {"engine": "chatterbox", "full": "/api/studio/file?p=vo/j1/full.mp3",
               "lines": [{"sceneId": "s1", "src": "/api/studio/file?p=vo/j1/s1.mp3", "dur": 1.5, "at": 0.2, "words": [{"w": "halo", "s": 0, "e": 0.4}]}]},
    }


def make_cli(calls: list, seen: dict, mode: dict):
    def fake_cli(args, cwd, on_line, should_stop, timeout):
        calls.append(list(args))
        if args[2] == "bundle":
            out = Path(next(a.split("=", 1)[1] for a in args if a.startswith("--out-dir=")))
            pub = Path(next(a.split("=", 1)[1] for a in args if a.startswith("--public-dir=")))
            seen.setdefault("bundle_public", []).append(sorted(p.relative_to(pub).as_posix() for p in pub.rglob("*") if p.is_file()))
            if mode.get("bundle_fail"):  # mis. paket npm baru belum dipasang (git pull tanpa npm ci)
                return 1, [mode["bundle_fail"]]
            if mode.get("bundle_sleep"):
                end = time.time() + mode["bundle_sleep"]
                while time.time() < end:
                    if should_stop():
                        raise Cancelled("batal")
                    time.sleep(0.05)
            shutil.copytree(pub, out / "public")  # seperti Remotion: public disalin ke <out>/public
            (out / "index.html").write_text("<html></html>")
            (out / "bundle.js").write_text("// bundle")
            on_line("Bundling 100%")
            return 0, ["Bundled"]
        if args[2] == "render":
            bundle = Path(args[3])
            props = json.loads(Path(next(a.split("=", 1)[1] for a in args if a.startswith("--props="))).read_text())
            logo = props["timeline"]["brand"]["logo"]
            seen.setdefault("props", []).append(props)
            # file job sudah ada di bundle/public saat render (alamat /public/st/<hash> → <bundle>/public/st/<hash>)
            assert (bundle / logo.lstrip("/")).read_bytes() == b"logo job", logo
            assert (bundle / "public" / "sfx" / "ui-pop.mp3").exists() and (bundle / "api" / "studio" / "asset" / "sfx" / "ui-pop.mp3").exists()
            fail = mode.pop("fail", None)
            if fail:
                on_line("Rendered 3/60")
                return 1, ["Rendered 3/60", fail]
            Path(args[5]).write_bytes(b"\0\0\0\x18ftypmp42")
            on_line("Rendered 60/60")
            return 0, ["Encoded 60/60"]
        raise AssertionError(args)

    return fake_cli


def run_job(cfg, jid: str, variant: str = "tanpa-vo") -> tuple[dict, MiniSupa]:
    job = {"id": jid, "status": "proses", "timeline": timeline(), "variant": variant, "created_by": "u1"}  # uploads/u1/ boleh dibaca
    sb = MiniSupa(job, {"uploads/u1/logo.png": b"logo job", "vo/j1/s1.mp3": b"vo", "vo/j1/full.mp3": b"vo"})
    jobs_render.run(JobCtx(Runtime(cfg=cfg, supa=sb), "studio_render_jobs", job, min_gap=0))  # type: ignore[arg-type]
    return job, sb


def cache_state(cfg) -> dict:
    r = render_cache.root(cfg.tmp)
    return {p.relative_to(r).as_posix(): (p.read_bytes(), os.stat(p).st_mtime_ns) for p in r.rglob("*") if p.is_file() and p.name != render_cache.USED}


@test
def t_job_render_cache_miss_lalu_hit():
    cfg = job_env("job")
    if cfg is None:
        return "dilewati (butuh node + ffmpeg untuk check())"
    calls: list = []
    seen: dict = {}
    mode: dict = {}
    jobs_render.run_cli = make_cli(calls, seen, mode)  # type: ignore[assignment]
    job1, sb1 = run_job(cfg, "c1")
    assert job1["status"] == "selesai" and "renders/c1.mp4" in sb1.uploaded, job1
    assert [a[2] for a in calls] == ["bundle", "render"], [a[2] for a in calls]
    # bundle dibangun dengan public DASAR (SFX, musik, logo preset) — file job tidak ikut cache
    pub_files = seen["bundle_public"][0]
    assert "sfx/ui-pop.mp3" in pub_files and "music/lagu.mp3" in pub_files and "brand/konten-logo.png" in pub_files, pub_files
    assert not any(f.startswith("st/") for f in pub_files), pub_files
    # tanpa VO: file suara VO tidak diunduh, baris VO (waktu & kata untuk tampilan) tetap utuh
    assert sb1.downloads == ["uploads/u1/logo.png"], sb1.downloads
    vo = seen["props"][0]["timeline"]["vo"]
    assert vo["lines"][0]["src"] == "/api/studio/file?p=vo/j1/s1.mp3" and vo["lines"][0]["words"] and vo["full"] == "/api/studio/file?p=vo/j1/full.mp3", vo
    assert seen["props"][0]["audio"] == "novo" and seen["props"][0]["timeline"]["muteVo"] is True
    assert "--concurrency=3" in calls[1]
    assert "Render: 3 tab paralel (auto: 12 thread, 15,7 GB RAM)" in logs(), logs()
    assert not (cfg.tmp / "render-c1").exists(), "folder job dihapus"
    state = cache_state(cfg)
    assert state and render_cache.intact(next(render_cache.root(cfg.tmp).iterdir()), key(cfg.repo))
    # job kedua (kode sama): langsung render dari cache, cache tidak tersentuh
    calls.clear()
    job2, sb2 = run_job(cfg, "c2")
    assert job2["status"] == "selesai" and [a[2] for a in calls] == ["render"], [a[2] for a in calls]
    assert cache_state(cfg) == state, "job tidak boleh menulis ke file cache"
    assert any("dari cache" in m for m in logs()), logs()
    # versi DENGAN VO: file VO tetap diunduh seperti dulu
    calls.clear()
    job3, sb3 = run_job(cfg, "c3", variant="vo")
    assert job3["status"] == "selesai" and sorted(sb3.downloads) == ["uploads/u1/logo.png", "vo/j1/full.mp3", "vo/j1/s1.mp3"], sb3.downloads
    assert seen["props"][-1]["timeline"]["vo"]["lines"][0]["src"].startswith("/public/st/") and [a[2] for a in calls] == ["render"]
    # kode komposisi berubah → kunci baru → bundle sekali lagi
    calls.clear()
    (cfg.repo / "components" / "remotion" / "studio" / "fx.tsx").write_text("export const Grain = 3;\n")
    job4, _ = run_job(cfg, "c4")
    assert job4["status"] == "selesai" and [a[2] for a in calls] == ["bundle", "render"], [a[2] for a in calls]
    assert len([p for p in render_cache.root(cfg.tmp).iterdir() if p.is_dir()]) == 2
    return "miss: bundle+render · hit: render saja (cache utuh) · kode berubah: bundle lagi · tanpa VO: 1 unduhan (bukan 3)"


@test
def t_render_gagal_karena_cache_dibangun_ulang_sekali():
    cfg = job_env("ulang")
    if cfg is None:
        return "dilewati (butuh node + ffmpeg untuk check())"
    calls: list = []
    seen: dict = {}
    mode: dict = {}
    jobs_render.run_cli = make_cli(calls, seen, mode)  # type: ignore[assignment]
    run_job(cfg, "u0")  # isi cache
    calls.clear()
    mode["fail"] = "ChunkLoadError: Loading chunk 6 failed. (missing: http://localhost:3000/6.bundle.js)"
    job, _ = run_job(cfg, "u1")
    assert job["status"] == "selesai", job
    assert [a[2] for a in calls] == ["render", "bundle", "render"], [a[2] for a in calls]
    assert any("cache komposisi" in m for m in logs(logging.WARNING)), logs()
    # error komposisi biasa (bukan bundle) → tidak dibangun ulang, langsung gagal
    calls.clear()
    mode["fail"] = 'Error: A delayRender() "Loading <Img>" was called but not cleared after 28000ms at http://localhost:3000/bundle.js:2:345'
    try:
        run_job(cfg, "u2")
        raise AssertionError("harusnya JobError")
    except jobs_render.JobError as e:
        assert "Render video gagal" in str(e), e
    assert [a[2] for a in calls] == ["render"], [a[2] for a in calls]
    # bundle baru dibangun di job ini lalu gagal karena "chunk" → tidak diulang (bukan masalah cache)
    calls.clear()
    (cfg.repo / "lib" / "studio" / "timeline.ts").write_text("export const FPS = 25;\n")
    mode["fail"] = "ChunkLoadError: Loading chunk 6 failed."
    try:
        run_job(cfg, "u3")
        raise AssertionError("harusnya JobError")
    except jobs_render.JobError:
        pass
    assert [a[2] for a in calls] == ["bundle", "render"], [a[2] for a in calls]
    return "chunk hilang di cache → bangun ulang + render sekali lagi; error komposisi biasa tidak diulang"


@test
def t_pra_bangun_latar_job_menunggu():
    cfg = job_env("latar")
    if cfg is None:
        return "dilewati (butuh node + ffmpeg untuk check())"
    calls: list = []
    seen: dict = {}
    mode: dict = {"bundle_sleep": 1.0}
    jobs_render.run_cli = make_cli(calls, seen, mode)  # type: ignore[assignment]
    jobs_render.prebuild(cfg)
    time.sleep(0.2)
    assert render_cache.busy()
    t0 = time.monotonic()
    job, _ = run_job(cfg, "l1")  # datang saat bangun latar → menunggu kunci, TIDAK bundle sendiri
    assert job["status"] == "selesai" and [a[2] for a in calls] == ["bundle", "render"], [a[2] for a in calls]
    assert time.monotonic() - t0 >= 0.6
    assert any("disiapkan di latar" in m for m in logs()), logs()
    jobs_render._pre["thread"].join(timeout=10)
    calls.clear()
    jobs_render.prebuild(cfg)  # cache sudah ada → tidak bundle lagi
    jobs_render._pre["thread"].join(timeout=10)
    assert not calls, calls
    # worker berhenti di tengah bangun latar → dihentikan rapi (tanpa cache setengah jadi)
    (cfg.repo / "remotion" / "Root.tsx").write_text("// root 2\n")
    mode["bundle_sleep"] = 5.0
    jobs_render.prebuild(cfg)
    time.sleep(0.3)
    t1 = time.monotonic()
    jobs_render.stop_prebuild()
    assert time.monotonic() - t1 < 3 and not jobs_render._pre["thread"].is_alive()
    assert not render_cache.intact(render_cache.root(cfg.tmp) / key(cfg.repo), key(cfg.repo))
    assert not [p for p in render_cache.root(cfg.tmp).iterdir() if p.name.startswith(".baru-")]
    return "job menunggu bangun latar lalu memakai hasilnya; cache ada → latar diam; berhenti → rapi"


@test
def t_pra_bangun_gagal_tidak_diulang_tiap_cek():
    """bundle latar gagal (mis. git pull membawa paket npm baru, npm ci belum dijalankan) → cek berkala 10 menit TIDAK menjalankan
    bundle yang sama lagi; job render tetap mencoba sendiri; kode berubah (kunci baru) → latar mencoba lagi"""
    cfg = job_env("latar-gagal")
    if cfg is None:
        return "dilewati (butuh node + ffmpeg untuk check())"
    calls: list = []
    seen: dict = {}
    mode: dict = {"bundle_fail": "Module not found: Error: Can't resolve 'paket-baru' in '/repo/components'"}
    jobs_render.run_cli = make_cli(calls, seen, mode)  # type: ignore[assignment]
    jobs_render._pre["stop"].clear()  # tes sebelumnya menghentikan latar (= worker berhenti)
    jobs_render._pre["gagal"] = None
    n_err = len([m for m in logs(logging.ERROR) if "remotion bundle gagal" in m])
    try:
        for _ in range(3):  # = worker menyala + 2× cek berkala saat menganggur
            jobs_render.prebuild(cfg)
            jobs_render._pre["thread"].join(timeout=10)
        assert [a[2] for a in calls] == ["bundle"], [a[2] for a in calls]
        assert len([m for m in logs(logging.ERROR) if "remotion bundle gagal" in m]) == n_err + 1, logs(logging.ERROR)
        calls.clear()
        try:
            run_job(cfg, "g1")
            raise AssertionError("harusnya JobError")
        except jobs_render.JobError as e:
            assert "Komposisi video gagal disiapkan" in str(e), e
        assert [a[2] for a in calls] == ["bundle"], [a[2] for a in calls]
        # pemakai menjalankan npm ci + kode berubah (git pull) → kunci baru → latar mencoba lagi & cache siap
        calls.clear()
        mode.pop("bundle_fail")
        (cfg.repo / "remotion" / "Root.tsx").write_text("// root diperbaiki\n")
        jobs_render.prebuild(cfg)
        jobs_render._pre["thread"].join(timeout=10)
        assert [a[2] for a in calls] == ["bundle"], [a[2] for a in calls]
        assert render_cache.intact(render_cache.root(cfg.tmp) / key(cfg.repo), key(cfg.repo))
    finally:
        jobs_render._pre["gagal"] = None
    return "gagal sekali → 3 cek = 1× bundle (bukan 3); job tetap mencoba; kode berubah → dicoba lagi"


# ---------------------------------------------------------------- tab paralel
@test
def t_tab_paralel_auto_cpu_ram_palsu():
    cases = {(12, 16.0): 6, (12, 15.7): 6, (12, 8.0): 2, (12, 12.0): 6, (12, 10.0): 5, (8, 16.0): 4, (4, 16.0): 2, (2, 64.0): 2,
             (32, 64.0): 6, (12, None): 6, (6, None): 3, (12, 6.5): 1, (12, 4.0): 1}
    for (cpu, ram), want in cases.items():
        got = config.render_tabs(cpu, ram)
        assert got == want, (cpu, ram, got, want)
    ram = config.total_ram_gb()
    assert ram is None or 0.5 < ram < 4096, ram
    real_name = os.name
    if not IS_WIN:  # jalur Windows tanpa ctypes.windll (Linux) → None, bukan crash
        try:
            os.name = "nt"  # type: ignore[misc]
            assert config.total_ram_gb() is None
        finally:
            os.name = real_name  # type: ignore[misc]
    config.total_ram_gb = lambda: 8.0  # type: ignore[assignment]
    assert config.auto_render_concurrency(12) == 2 and config.auto_render_concurrency(12, 32.0) == 6
    keys = ("RENDER_CONCURRENCY", "DATA_DIR")
    old = {k: os.environ.get(k) for k in keys}
    try:
        os.environ["DATA_DIR"] = str(TMP / "data-tab")
        os.environ.pop("RENDER_CONCURRENCY", None)
        c = config.load(TMP / "tidak-ada.env")  # tanpa .env → bawaan auto
        assert c.render_conc_auto and c.render_concurrency == config.render_tabs(config.cpu_limit(), 8.0), c.render_concurrency
        assert c.render_conc_info.startswith(f"auto: {config.cpu_limit()} thread, 8,0 GB RAM"), c.render_conc_info
        for raw, want in (("auto", None), ("AUTO", None), ("", None), ("4", 4), ("1", 1), ("12", 8), ("0", 1), ("tiga", None)):
            os.environ["RENDER_CONCURRENCY"] = raw
            c = config.load(TMP / "tidak-ada.env")
            if want is None:
                assert c.render_conc_auto and c.render_concurrency == config.render_tabs(config.cpu_limit(), 8.0), (raw, c.render_concurrency)
            else:
                n = min(want, config.cpu_limit())  # lebih dari thread CPU → dibatasi (t_tab_tidak_lebih_dari_thread_cpu)
                assert not c.render_conc_auto and c.render_concurrency == n and c.render_conc_info.startswith(f"RENDER_CONCURRENCY={want} di .env"), (raw, c)
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    return f"laptop 12 thread/16 GB → 6 tab, 8 GB → 2, 4 GB → 1; di sini RAM {ram and round(ram, 1)} GB → auto {config.render_tabs(config.cpu_limit(), ram)}"


@test
def t_tab_tidak_lebih_dari_thread_cpu():
    """Remotion menolak --concurrency > thread CPU ("concurrency is set higher than the amount of CPU cores available") → semua
    render gagal. Angka di .env & auto dibatasi cpu_limit(); 1 thread → 1 tab (dulu TABS_MIN memberi 2)."""
    assert config.render_tabs(1, 64.0) == 1 and config.render_tabs(1, None) == 1 and config.render_tabs(2, 64.0) == 2
    real = config.cpu_limit
    keys = ("RENDER_CONCURRENCY", "DATA_DIR")
    old = {k: os.environ.get(k) for k in keys}
    try:
        os.environ["DATA_DIR"] = str(TMP / "data-tab-cpu")
        config.total_ram_gb = lambda: 32.0  # type: ignore[assignment]
        config.cpu_limit = lambda: 4  # type: ignore[assignment]
        for raw, want, info in (("6", 4, "RENDER_CONCURRENCY=6 di .env, dibatasi 4 thread CPU"), ("12", 4, "RENDER_CONCURRENCY=8 di .env, dibatasi 4 thread CPU"),
                                ("4", 4, "RENDER_CONCURRENCY=4 di .env"), ("3", 3, "RENDER_CONCURRENCY=3 di .env")):
            os.environ["RENDER_CONCURRENCY"] = raw
            c = config.load(TMP / "tidak-ada.env")
            assert (c.render_concurrency, c.render_conc_auto, c.render_conc_info) == (want, False, info), (raw, c.render_concurrency, c.render_conc_info)
            assert jobs_render.tabs_note(c) == info
        config.cpu_limit = lambda: 1  # type: ignore[assignment]
        os.environ["RENDER_CONCURRENCY"] = "auto"
        c = config.load(TMP / "tidak-ada.env")
        assert c.render_concurrency == 1 and c.render_conc_info.startswith("auto: 1 thread"), (c.render_concurrency, c.render_conc_info)
    finally:
        config.cpu_limit = real  # type: ignore[assignment]
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    lim = config.cpu_limit()
    assert 1 <= lim <= (os.cpu_count() or lim)
    # batas Python tidak boleh melebihi batas Remotion asli di laptop ini (getCpuCount = min(nproc, os.availableParallelism()))
    node = shutil.which("node")
    js = REPO / "node_modules" / "@remotion" / "renderer" / "dist" / "get-cpu-count.js"
    if not node or not js.exists():
        return f"batas {lim} thread (Remotion tidak dicek: node / @remotion/renderer tidak ada)"
    def remotion_cpus(env: dict) -> int:
        r = subprocess.run([node, "-e", f"console.log(require({json.dumps(str(js))}).getCpuCount())"], capture_output=True, text=True, timeout=60, env=env)
        assert r.returncode == 0, r.stderr
        return int(r.stdout.strip().splitlines()[-1])

    # env proses render = jobs_render.cli_env(): OMP_NUM_THREADS dari apply_thread_limits (di sini 2) TIDAK ikut — `nproc` membacanya
    assert os.environ.get("OMP_NUM_THREADS") and "OMP_NUM_THREADS" not in jobs_render.cli_env()
    rem = remotion_cpus(jobs_render.cli_env())
    assert lim <= rem, (lim, rem)
    raw = remotion_cpus(dict(os.environ))
    return f".env 6 → 4 tab di laptop 4 thread, 1 thread → 1; di sini batas {lim} thread, Remotion {rem} (dengan OMP_NUM_THREADS ikut: {raw})"


@test
def t_env_ansi_utf16_tetap_dibaca():
    """.env yang disimpan ANSI (Notepad lama / PowerShell 5.1 Set-Content) atau UTF-16 (PowerShell 5.1 `>` / Out-File) dengan satu
    huruf non-ASCII: dulu python-dotenv (UTF-8 ketat) melempar UnicodeDecodeError saat import worker.py → worker tidak bisa menyala
    (jalankan.bat mengulang tiap 15 dtk). Sekarang tetap dibaca + 1 catatan untuk log."""
    try:
        import dotenv  # noqa: F401
    except ImportError:
        return "dilewati (python-dotenv belum terpasang)"
    keys = ("UPLOAD_WORKERS", "TAKES", "PRELOAD", "RENDER_CONCURRENCY", "DATA_DIR")
    old = {k: os.environ.get(k) for k in keys}
    body = "# catatan Alif: suara “natural” é ñ\r\nUPLOAD_WORKERS=5\r\nTAKES=2\r\n"
    cases = {
        "ANSI": (body.replace("“", '"').replace("”", '"').encode("cp1252"), "ANSI"),
        "UTF-16": (("\ufeff" + body).encode("utf-16-le"), "UTF-16"),
        "UTF-8+BOM": (b"\xef\xbb\xbf" + body.encode("utf-8"), ""),
        "UTF-8": (body.replace("\r\n", "\n").encode("utf-8"), ""),
    }
    got = []
    try:
        for name, (raw, enc) in cases.items():
            for k in keys:
                os.environ.pop(k, None)
            os.environ["DATA_DIR"] = str(TMP / "data-enc")
            f = TMP / f"enc-{name}.env"
            f.write_bytes(raw)
            c = config.load(f)
            assert (c.upload_workers, c.takes) == (5, 2), (name, c.upload_workers, c.takes)
            if enc:
                assert enc in c.env_note and "UTF-8" in c.env_note, (name, c.env_note)
            else:
                assert c.env_note == "", (name, c.env_note)
            assert f.read_bytes() == raw, "file .env tidak diubah"
            got.append(name)
        # "PRELOAD=0" bawaan .env lama di file ANSI: _preload membaca file itu juga → tidak crash, tetap dikenali sebagai bawaan lama
        for k in keys:
            os.environ.pop(k, None)
        os.environ["DATA_DIR"] = str(TMP / "data-enc")
        f = TMP / "enc-preload.env"
        f.write_bytes(("# é\r\n" + config._OLD_PRELOAD.replace("\n", "\r\n") + "\r\n").encode("cp1252"))
        c = config.load(f)
        assert c.preload and c.preload_old_default and "ANSI" in c.env_note
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    assert config.read_env_text(TMP / "tidak-ada.env") == (None, "")
    src = (HERE / "worker.py").read_text(encoding="utf-8")
    main = src[src.index("def main()"):]
    assert main.index("CFG.env_note") < main.index("CFG.missing()"), "catatan encoding ditulis ke log sebelum cek kunci Supabase"
    return ", ".join(got) + " terbaca; PRELOAD=0 lama di file ANSI dikenali"


# ---------------------------------------------------------------- migrasi .env
OLD_A = (
    "# render MP4 di laptop (butuh Node.js + install.ps1)\nRENDER_ENABLED=1\n"
    "# tab Chrome render paralel: angka 1-8, atau auto = setengah jumlah core CPU (2-4). Bawaan 2\nRENDER_CONCURRENCY=2\nRENDER_TIMEOUT_MIN=40\n"
)
OLD_B = "SUPABASE_URL=https://x.supabase.co\n# render MP4 di laptop (butuh Node.js + install.ps1)\nRENDER_ENABLED=1\nRENDER_CONCURRENCY=2\nRENDER_TIMEOUT_MIN=40\n"


def _load_env(p: Path):
    keys = ("RENDER_CONCURRENCY", "RENDER_ENABLED", "RENDER_TIMEOUT_MIN", "SUPABASE_URL", "DATA_DIR")
    old = {k: os.environ.get(k) for k in keys}
    try:
        for k in keys:
            os.environ.pop(k, None)
        os.environ["DATA_DIR"] = str(TMP / "data-env")
        return config.load(p, migrate=True)
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


@test
def t_migrasi_env_lama_dua_varian():
    try:
        import dotenv  # noqa: F401
    except ImportError:
        return "dilewati (python-dotenv belum terpasang)"
    config.total_ram_gb = lambda: 16.0  # type: ignore[assignment]
    want_n = config.render_tabs(config.cpu_limit(), 16.0)
    out = []
    for name, text, eol, bom in (("A-komentar-lama-CRLF", OLD_A, "\r\n", False), ("B-tanpa-komentar-LF", OLD_B, "\n", False),
                                 ("A-BOM-CRLF", OLD_A, "\r\n", True), ("B-tanpa-enter-akhir", OLD_B.rstrip("\n").replace("\nRENDER_TIMEOUT_MIN=40", ""), "\n", False)):
        p = TMP / f"env-{name}"
        raw = (b"\xef\xbb\xbf" if bom else b"") + text.replace("\n", eol).encode("utf-8")
        p.write_bytes(raw)
        c = _load_env(p)
        new = p.read_bytes()
        assert c.render_conc_auto and c.render_concurrency == want_n, (name, c.render_concurrency)
        assert c.env_migrated.startswith("RENDER_CONCURRENCY=2 di .env adalah bawaan lama") and f"sekarang {want_n} tab" in c.env_migrated, c.env_migrated
        assert new.startswith(b"\xef\xbb\xbf") == bom, name
        body = new.decode("utf-8-sig")
        if eol == "\r\n":
            assert "\r\n" in body and "\n" not in body.replace("\r\n", ""), "CRLF harus terjaga"
        else:
            assert "\r" not in body
        lines = body.replace("\r\n", "\n").split("\n")
        i = lines.index("RENDER_CONCURRENCY=auto")
        assert lines[i - 1] == config.CONC_COMMENT, lines
        assert config._OLD_CONC_COMMENT not in body and body.count("RENDER_CONCURRENCY") == 1
        old_lines = [x for x in text.split("\n") if x not in ("RENDER_CONCURRENCY=2", config._OLD_CONC_COMMENT)]
        assert [x for x in lines if x not in ("RENDER_CONCURRENCY=auto", config.CONC_COMMENT)] == old_lines, "baris lain tidak boleh berubah"
        # sekali saja: jalan lagi → file tidak berubah, tanpa pesan
        c2 = _load_env(p)
        assert p.read_bytes() == new and not c2.env_migrated and c2.render_conc_auto
        # pemakai sengaja memilih 2 SESUDAH migrasi (komentar baru ada) → dihormati
        p.write_bytes(new.replace(b"RENDER_CONCURRENCY=auto", b"RENDER_CONCURRENCY=2"))
        c3 = _load_env(p)
        assert c3.render_concurrency == 2 and not c3.render_conc_auto and not c3.env_migrated and b"RENDER_CONCURRENCY=2" in p.read_bytes()
        out.append(name)
    # angka lain dari pemakai → tidak disentuh
    for val in ("3", "1", "auto", "2 # dua"):
        p = TMP / f"env-user-{val[0]}"
        raw = OLD_A.replace("RENDER_CONCURRENCY=2", f"RENDER_CONCURRENCY={val}").replace("\n", "\r\n").encode()
        p.write_bytes(raw)
        c = _load_env(p)
        assert p.read_bytes() == raw and not c.env_migrated, val
        if val in ("3", "1"):
            assert c.render_concurrency == min(int(val), config.cpu_limit()) and not c.render_conc_auto
    # dua baris RENDER_CONCURRENCY (diedit pemakai) → tidak disentuh
    p = TMP / "env-dobel"
    raw = (OLD_B + "RENDER_CONCURRENCY=4\n").encode()
    p.write_bytes(raw)
    assert _load_env(p) and p.read_bytes() == raw
    # .env tidak bisa ditulis → tetap dianggap auto, pesan menyebut alasannya
    if not IS_WIN and os.geteuid() != 0:
        d = TMP / "env-ro"
        d.mkdir()
        p = d / ".env"
        p.write_text(OLD_B)
        d.chmod(0o500)
        try:
            c = _load_env(p)
            assert c.render_conc_auto and "tidak bisa ditulis" in c.env_migrated, c.env_migrated
        finally:
            d.chmod(0o700)
    # RENDER_CONCURRENCY dari env sistem (bukan .env) menang seperti biasa
    p = TMP / "env-sistem"
    p.write_text(OLD_B)
    os.environ["RENDER_CONCURRENCY"] = "5"
    try:
        c = config.load(p, migrate=True)
        assert c.render_concurrency == min(5, config.cpu_limit())
    finally:
        os.environ.pop("RENDER_CONCURRENCY", None)
    return f"{len(out)} varian .env lama → auto ({want_n} tab di sini dengan RAM 16 GB palsu); angka pemakai dihormati"


# worker.py asli dijalankan sebagai __main__ (persis jalankan.bat) di proses terpisah dengan .env uji (config.load dibelokkan);
# berhenti tepat sesudah log "mulai" (Supa palsu → tanpa internet / mesin suara)
_WORKER_PROBE = r"""
import json, os, runpy, sys
from pathlib import Path
here, env, mode = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
sys.path.insert(0, here)
from studio_worker import config, supa
real, got = config.load, []
def load(*a, **k):  # worker.py membaca .env uji, bukan .env laptop
    got.append(real(env, **{x: y for x, y in k.items() if x != "env_file"}))
    return got[-1]
config.load = load
class Stop(Exception):
    pass
def stop(*a, **k):
    raise Stop()
supa.Supa = stop
held = None
if mode == "kedua":  # worker lain sudah jalan = kunci dipegang proses ini lebih dulu (cara kunci sama dengan worker.single_instance)
    data = Path(os.environ["DATA_DIR"])
    data.mkdir(parents=True, exist_ok=True)
    held = open(data / "worker.lock", "a+")
    if os.name == "nt":
        import msvcrt
        msvcrt.locking(held.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(held.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
try:
    runpy.run_path(str(Path(here) / "worker.py"), run_name="__main__")
    rc = "selesai"
except SystemExit as e:
    rc = e.code
except Stop:
    rc = "lanjut"
cfg = got[0]
print("HASIL " + json.dumps({"rc": rc, "tabs": cfg.render_concurrency, "auto": cfg.render_conc_auto}))
"""


@test
def t_migrasi_hanya_worker_pemegang_kunci():
    """cek_gpu.py / siapkan_model.py (install.ps1) & worker KEDUA yang langsung berhenti ("Worker sudah jalan") tidak menulis .env;
    migrasi + 1 baris log hanya di worker yang memegang kunci satu-instance"""
    p = TMP / "env-bukan-worker"
    p.write_text(OLD_B)
    keys = ("RENDER_CONCURRENCY", "RENDER_ENABLED", "RENDER_TIMEOUT_MIN", "SUPABASE_URL", "DATA_DIR")
    old = {k: os.environ.get(k) for k in keys}
    try:
        for k in keys:
            os.environ.pop(k, None)
        os.environ["DATA_DIR"] = str(TMP / "data-env")
        c = config.load(p)
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    assert p.read_text() == OLD_B and not c.env_migrated and c.render_concurrency == 2
    src = (HERE / "worker.py").read_text(encoding="utf-8")
    main = src[src.index("def main()"):]
    assert "CFG = config.load()\n" in src and main.index("single_instance(") < main.index("config.migrate_env(CFG)"), "migrasi harus sesudah kunci"
    # proses nyata worker.py
    env = {k: v for k, v in os.environ.items() if not k.startswith(("RENDER_", "SUPABASE_", "NEXT_PUBLIC_SUPABASE", "DATA_DIR", "PRELOAD"))}
    env["DATA_DIR"] = str(TMP / "data-kunci")
    env["PYTHONIOENCODING"] = "utf-8"
    probe = TMP / "probe_worker.py"
    probe.write_text(_WORKER_PROBE, encoding="utf-8")
    ev = TMP / "env-worker"
    text = OLD_B.replace("SUPABASE_URL=https://x.supabase.co\n", "SUPABASE_URL=https://abcdefghij.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=palsu\n")
    raw = text.replace("\n", "\r\n").encode()
    ev.write_bytes(raw)
    out = {}
    for mode in ("kedua", "pertama"):
        r = subprocess.run([sys.executable, str(probe), str(HERE), str(ev), mode], capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=120, env=env, cwd=str(TMP))
        line = next((ln for ln in r.stdout.splitlines() if ln.startswith("HASIL ")), None)
        assert line, (mode, r.returncode, r.stdout[-1500:], r.stderr[-1500:])
        out[mode] = (json.loads(line[6:]), r.stdout + r.stderr, ev.read_bytes())
    res, txt, after = out["kedua"]
    assert res["rc"] == 0 and "Worker sudah jalan" in txt, (res, txt[-800:])
    assert after == raw and "bawaan lama" not in txt, "worker kedua tidak boleh menulis .env"
    res, txt, after = out["pertama"]
    assert res["rc"] == "lanjut" and res["auto"], res
    assert b"RENDER_CONCURRENCY=auto\r\n" in after and b"RENDER_CONCURRENCY=2" not in after, after
    msg = [ln for ln in txt.splitlines() if "RENDER_CONCURRENCY=2 di .env adalah bawaan lama" in ln]
    assert len(msg) == 1 and f"sekarang {res['tabs']} tab" in msg[0], txt[-1500:]
    return f"skrip lain & worker kedua tidak menyentuh .env; worker pemegang kunci memigrasi + 1 baris log ({res['tabs']} tab)"


@test
def t_env_example_sudah_bawaan_baru():
    txt = (HERE / ".env.example").read_text(encoding="utf-8")
    lines = txt.splitlines()
    i = lines.index("RENDER_CONCURRENCY=auto")
    assert lines[i - 1] == config.CONC_COMMENT, lines[i - 1]
    p = TMP / "env-dari-example"
    p.write_text(txt)
    assert config.migrate_render_concurrency(p) == "" and p.read_text() == txt, ".env baru dari .env.example tidak perlu dimigrasi"
    return "salinan .env.example baru = auto, tidak dimigrasi"


# ---------------------------------------------------------------- Remotion: flag CLI menang atas remotion.config.mjs
@test
def t_flag_concurrency_cli_menang_atas_config():
    node = shutil.which("node")
    opt = REPO / "node_modules" / "@remotion" / "renderer" / "dist" / "options" / "concurrency.js"
    if not node or not opt.exists():
        return "dilewati (node / @remotion/renderer tidak ada)"
    js = (
        f"const o=require({json.dumps(str(opt))}).concurrencyOption; o.setConfig(2);"
        "const a=o.getValue({commandLine:{concurrency:6}}); const b=o.getValue({commandLine:{}});"
        "console.log(JSON.stringify([a,b]))"
    )
    r = subprocess.run([node, "-e", js], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    a, b = json.loads(r.stdout.strip().splitlines()[-1])
    assert a == {"source": "cli", "value": 6} and b == {"source": "config", "value": 2}, (a, b)
    conf = (REPO / "remotion.config.mjs").read_text(encoding="utf-8")
    assert "Config.setConcurrency(" in conf  # hanya untuk render CLI manual; worker selalu memberi --concurrency
    return "--concurrency=6 dari worker menang atas Config.setConcurrency(2)"


def main() -> int:
    only = [a.lower() for a in sys.argv[1:]]
    for fn in TESTS:
        if not only or any(o in fn.__name__.lower() for o in only):
            run_test(fn)
    ok = sum(1 for r in results if r[1])
    print(f"\n=== {ok}/{len(results)} tes lolos ===")
    for n, good, info in results:
        if not good:
            print(f"  GAGAL: {n} — {info}")
    shutil.rmtree(TMP, ignore_errors=True)
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
