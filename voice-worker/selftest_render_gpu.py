"""
Tes mandiri render MP4 pakai GPU NVIDIA (studio_worker/gpu_pref.py + bagian GPU di jobs_render.py) TANPA Windows / GPU / internet:
  .venv\\Scripts\\python selftest_render_gpu.py           (semua tes)
  .venv\\Scripts\\python selftest_render_gpu.py probe     (hanya tes yang namanya mengandung kata itu)
Yang dites: pengaturan .env (RENDER_GPU / RENDER_BITRATE / RENDER_CONCURRENCY=auto), deteksi NVIDIA (nvidia-smi palsu, torch hanya
kalau sudah di-import), path Chrome Remotion (dibandingkan langsung dengan kode Remotion lewat node kalau ada), registry Windows palsu
(winreg ditambal), pembacaan hasil cek GPU (ANGLE NVIDIA / Intel / AMD / SwiftShader), cek GPU dengan Chrome palsu & Chrome headless
asli (kalau ada, mis. Playwright), susunan argumen render, alur cadangan (render GPU gagal karena GPU → ulang sekali encode CPU;
error lain tidak diulang), pola pesan error GPU, tanda "NVENC tidak bisa" per sesi, dan job render lengkap (Remotion CLI & Supabase
dipalsukan; perkiraan sisa tidak basi saat render ulang, kecepatan render dicatat untuk perkiraan antri di website).
"""
from __future__ import annotations

import glob
import html
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
from types import ModuleType, SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

from studio_worker import config  # noqa: E402

config.apply_thread_limits(2)

from studio_worker import gpu_pref, jobs_render  # noqa: E402
from studio_worker.jobctx import Cancelled, JobCtx, Runtime  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
TMP = Path(tempfile.mkdtemp(prefix="vw-selftest-gpu-"))
IS_WIN = os.name == "nt"
results: list[tuple[str, bool, str]] = []
TESTS: list = []

NV = "NVIDIA GeForce RTX 5050 Laptop GPU"
R_NV = "ANGLE (NVIDIA, NVIDIA GeForce RTX 5050 Laptop GPU (0x00002D98) Direct3D11 vs_5_0 ps_5_0, D3D11)"
R_INTEL = "ANGLE (Intel, Intel(R) UHD Graphics (0x0000A7A8) Direct3D11 vs_5_0 ps_5_0, D3D11)"
R_AMD = "ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)"
R_SWS = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)"
R_WARP = "ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)"
NVENC_FAIL = ["Rendered 12/300", "[h264_nvenc @ 0000020c] OpenEncodeSessionEx failed: unsupported device (2): (no details)",
              "Error: ffmpeg quit with code 1"]

# ---------------------------------------------------------------- log ditangkap (INFO ikut)
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


_orig = {"smi": gpu_pref._query_smi, "is_win": gpu_pref.IS_WIN, "run_cli": jobs_render.run_cli, "set_pref": gpu_pref.set_preference,
         "winreg": sys.modules.get("winreg")}


def reset() -> None:
    """status per sesi dikosongkan (tiap tes = sesi worker baru)"""
    t = jobs_render._gpu.get("thread")
    if t is not None:
        t.join(timeout=30)
    gpu_pref._query_smi = _orig["smi"]
    gpu_pref.IS_WIN = _orig["is_win"]
    gpu_pref.set_preference = _orig["set_pref"]
    jobs_render.run_cli = _orig["run_cli"]
    gpu_pref._nv.clear()
    gpu_pref._pref_logged.clear()
    jobs_render._gpu.update(prepared=False, nvenc_bad=False, angle_bad=False, thread=None, said=False)
    jobs_render.last_probe = {}
    if _orig["winreg"] is None:  # winreg palsu dilepas (di Windows: winreg asli dikembalikan)
        sys.modules.pop("winreg", None)
    else:
        sys.modules["winreg"] = _orig["winreg"]


def smi(name: str | None) -> None:
    gpu_pref._query_smi = lambda: name  # type: ignore[assignment]
    gpu_pref._nv.clear()


def cfg_of(**kw) -> SimpleNamespace:
    base = dict(render=True, render_gpu="auto", render_bitrate="10M", render_browser="", render_timeout_min=40, render_concurrency=2, repo=TMP / "repo-kosong")
    base.update(kw)
    return SimpleNamespace(**base)


def dump_dom(o: dict) -> str:
    """meniru output --dump-dom Chrome: teks <pre> di-escape (& < >), skrip sudah terhapus"""
    text = "GPUPROBE:" + json.dumps(o) + ":GPUPROBE"
    return f'<html><head></head><body><pre id="r">{html.escape(text, quote=False)}</pre>\n</body></html>\n'


def fake_chrome(path: Path, out: str = "", sleep: float = 0.0, code: int = 0) -> Path:
    """Chrome palsu (skrip sh): catat argumen ke <path>.args lalu cetak output --dump-dom"""
    path.parent.mkdir(parents=True, exist_ok=True)
    body = f'#!/bin/sh\nprintf "%s\\n" "$@" > "{path}.args"\n'
    if sleep:
        body += f"sleep {sleep}\n"
    body += "cat <<'EOF_DOM'\n" + out + "EOF_DOM\n" + f"exit {code}\n"
    path.write_text(body, encoding="utf-8")
    path.chmod(0o755)
    return path


class FakeWinreg(ModuleType):
    """winreg palsu: satu kunci HKCU\\...\\UserGpuPreferences di memori"""

    HKEY_CURRENT_USER = "HKCU"
    KEY_READ = 1
    KEY_SET_VALUE = 2
    REG_SZ = 1
    REG_DWORD = 4

    def __init__(self, values: dict | None = None, fail: Exception | None = None):
        super().__init__("winreg")
        self.values: dict[str, tuple[object, int]] = dict(values or {})
        self.fail = fail
        self.writes: list[tuple[str, str]] = []
        self.opened: list[tuple] = []

    def CreateKeyEx(self, root, sub, reserved=0, access=0):  # noqa: N802
        if self.fail:
            raise self.fail
        self.opened.append((root, sub, access))
        reg = self

        class Key:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        Key.reg = reg  # type: ignore[attr-defined]
        return Key()

    def QueryValueEx(self, key, name):  # noqa: N802
        if name not in self.values:
            raise FileNotFoundError(2, "tidak ada", name)
        return self.values[name]

    def SetValueEx(self, key, name, reserved, typ, value):  # noqa: N802
        self.values[name] = (value, typ)
        self.writes.append((name, value))


# ---------------------------------------------------------------- tes
@test
def t_pengaturan_env_render_gpu():
    assert config.render_gpu_mode("") == "auto" and config.render_gpu_mode("AUTO") == "auto" and config.render_gpu_mode("asal") == "auto"
    assert config.render_gpu_mode("off") == "off" and config.render_gpu_mode("0") == "off" and config.render_gpu_mode("mati") == "off"
    assert config.render_gpu_mode("NVIDIA") == "nvidia"
    for raw, want in (("10M", "10M"), ("10m", "10M"), ("8", "8M"), ("12 Mbps", "12M"), ("8000k", "8000K"), ("7,5M", "7.5M"), ("", "5M"), ("abc", "5M"), ("0", "5M")):
        got = config.render_bitrate(raw)
        assert got == want, (raw, got)
        assert got[-1] in "KkM"  # syarat validateBitrate() Remotion
    # auto: separuh thread CPU 2..6, dibatasi RAM (selftest_render_cache.py menguji lebih lengkap)
    assert [config.render_tabs(n, 64.0) for n in (1, 4, 6, 8, 16, 32)] == [2, 2, 3, 4, 6, 6]
    assert config.render_tabs(12, 8.0) == 2 and config.render_tabs(12, None) == 6
    keys = ("RENDER_GPU", "RENDER_BITRATE", "RENDER_CONCURRENCY", "DATA_DIR")
    old = {k: os.environ.get(k) for k in keys}
    try:
        os.environ.update(RENDER_GPU="off", RENDER_BITRATE="8m", RENDER_CONCURRENCY="auto", DATA_DIR=str(TMP / "data"))
        c = config.load(TMP / "tidak-ada.env")
        assert c.render_gpu == "off" and c.render_bitrate == "8M", (c.render_gpu, c.render_bitrate)
        assert c.render_concurrency == config.auto_render_concurrency(), c.render_concurrency
        os.environ.update(RENDER_CONCURRENCY="3")
        os.environ.pop("RENDER_GPU")
        os.environ.pop("RENDER_BITRATE")
        c = config.load(TMP / "tidak-ada.env")
        # bawaan 5M ≈ ukuran CRF 18 lama (10M = MP4 2–3× lebih besar → lewat batas upload Supabase gratis 50 MB)
        assert c.render_concurrency == 3 and c.render_gpu == "auto" and c.render_bitrate == "5M"
        assert config.Config.render_bitrate == "5M"
        os.environ.pop("RENDER_CONCURRENCY")
        c = config.load(TMP / "tidak-ada.env")
        assert c.render_conc_auto and c.render_concurrency == config.auto_render_concurrency()  # bawaan baru: auto
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    return f"auto concurrency di sini = {config.auto_render_concurrency()}"


@test
def t_deteksi_nvidia_smi_palsu_dan_torch():
    if IS_WIN:
        return "dilewati di Windows (nvidia-smi palsu berupa skrip sh)"
    bindir = TMP / "bin-smi"
    bindir.mkdir(parents=True, exist_ok=True)
    smi_exe = bindir / "nvidia-smi"
    smi_exe.write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" > "{smi_exe}.args"\necho "{NV}"\n', encoding="utf-8")
    smi_exe.chmod(0o755)
    old_path = os.environ.get("PATH", "")
    torch_before = "torch" in sys.modules
    try:
        os.environ["PATH"] = f"{bindir}{os.pathsep}{old_path}"
        assert gpu_pref.nvidia_name(refresh=True) == NV
        args = (bindir / "nvidia-smi.args").read_text().split()
        assert args == ["--query-gpu=name", "--format=csv,noheader"], args
        smi_exe.write_text("#!/bin/sh\necho 'NVIDIA-SMI has failed because it could not communicate with the NVIDIA driver.'\nexit 9\n")
        assert gpu_pref.nvidia_name() == NV  # disimpan per sesi
        assert gpu_pref.nvidia_name(refresh=True) is None
        assert ("torch" in sys.modules) == torch_before, "torch tidak boleh di-import hanya untuk cek GPU"
        os.environ["PATH"] = str(TMP / "bin-kosong")
        fake = ModuleType("torch")
        fake.cuda = SimpleNamespace(is_available=lambda: True, get_device_name=lambda i=0: NV)  # type: ignore[attr-defined]
        fake.version = SimpleNamespace(cuda="12.8", hip=None)  # type: ignore[attr-defined]
        if not torch_before:
            sys.modules["torch"] = fake
            assert gpu_pref.nvidia_name(refresh=True) == NV  # torch yang SUDAH di-import dipakai
            fake.cuda = SimpleNamespace(is_available=lambda: False, get_device_name=lambda i=0: "")  # type: ignore[attr-defined]
            assert gpu_pref.nvidia_name(refresh=True) is None
    finally:
        os.environ["PATH"] = old_path
        if not torch_before:
            sys.modules.pop("torch", None)
    return "nvidia-smi dibaca, gagal → None, torch tidak di-import"


@test
def t_path_chrome_remotion():
    repo = TMP / "repo path spasi"
    (repo / "sub").mkdir(parents=True, exist_ok=True)
    (repo / "package.json").write_text("{}")
    win = gpu_pref.chrome_path(repo, system="win32", machine="AMD64")
    want_parts = ("node_modules", ".remotion", "chrome-headless-shell", "win64", "chrome-headless-shell-win64", "chrome-headless-shell.exe")
    assert win.parts[-6:] == want_parts and Path(*win.parts[:-6]) == repo, win
    assert gpu_pref.chrome_path(repo / "sub", system="win32").parts[:-6] == repo.parts  # package.json dicari ke atas
    assert gpu_pref.chrome_path(repo, system="linux", machine="x86_64").parts[-3:] == ("linux64", "chrome-headless-shell-linux64", "chrome-headless-shell")
    assert gpu_pref.chrome_path(repo, system="linux", machine="aarch64").parts[-3] == "linux-arm64"
    assert gpu_pref.chrome_path(repo, system="darwin", machine="arm64").parts[-3] == "mac-arm64"
    own = repo / "node_modules" / ".remotion" / "chrome-headless-shell" / "win64" / "chrome-headless-shell-win64" / "headless_shell"
    own.parent.mkdir(parents=True, exist_ok=True)
    own.write_text("")
    assert gpu_pref.chrome_path(repo, system="win32") == own  # build Remotion sendiri (sama dengan getExecutablePath)
    own.unlink()
    custom = TMP / "Chrome Saya" / "chrome-headless-shell.exe"
    assert gpu_pref.chrome_path(repo, str(custom)) == custom.resolve()  # REMOTION_BROWSER menang
    assert gpu_pref.chrome_path(repo, "chrome/headless.exe") == (repo / "chrome" / "headless.exe").resolve()  # relatif = dari root repo
    lone = Path(tempfile.mkdtemp(prefix="vw-tanpa-pkg-"))
    try:
        has_pkg = any((p / "package.json").is_file() for p in [lone, *lone.parents])
        if not has_pkg:
            assert gpu_pref.chrome_path(lone, system="win32").parts[:-4] == (*lone.parts, ".remotion")
    finally:
        shutil.rmtree(lone, ignore_errors=True)
    # bandingkan langsung dengan kode Remotion (BrowserFetcher.getRevisionInfo) kalau node + @remotion/renderer ada
    node = shutil.which("node")
    bf = next((p / "node_modules/@remotion/renderer/dist/browser/BrowserFetcher.js" for p in [REPO, *REPO.parents]
               if (p / "node_modules/@remotion/renderer/dist/browser/BrowserFetcher.js").is_file()), None)
    if not node or not bf:
        return "path Windows/Linux/mac benar (node / @remotion/renderer tidak ada → tidak dibandingkan dengan Remotion)"
    js = "const b=require(process.argv[1]);process.stdout.write(b.getRevisionInfo('headless-shell').executablePath)"
    r = subprocess.run([node, "-e", js, str(bf)], cwd=str(repo / "sub"), capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr[-500:]
    assert Path(r.stdout) == gpu_pref.chrome_path(repo / "sub"), (r.stdout, gpu_pref.chrome_path(repo / "sub"))
    return f"sama persis dengan Remotion ({Path(r.stdout).relative_to(repo)})"


@test
def t_registry_windows_palsu():
    exe = Path(r"C:\Konten.com\Hot Issue\node_modules\.remotion\chrome-headless-shell\win64\chrome-headless-shell-win64\chrome-headless-shell.exe")
    reg = FakeWinreg()
    assert gpu_pref.prefer_high_performance(exe, reg) == "diatur"
    assert reg.values[str(exe)] == ("GpuPreference=2;", reg.REG_SZ), reg.values
    assert reg.opened[0][:2] == ("HKCU", r"Software\Microsoft\DirectX\UserGpuPreferences")
    assert gpu_pref.prefer_high_performance(exe, reg) == "sudah" and len(reg.writes) == 1  # idempoten: tidak ditulis ulang
    reg2 = FakeWinreg({str(exe): ("SwapEffectUpgradeEnable=1;GpuPreference=1;", 1)})
    assert gpu_pref.prefer_high_performance(exe, reg2) == "diatur"
    assert reg2.values[str(exe)][0] == "SwapEffectUpgradeEnable=1;GpuPreference=2;"  # setelan lain dipertahankan
    assert gpu_pref.merge_pref("SwapEffectUpgradeEnable=1;") == "SwapEffectUpgradeEnable=1;GpuPreference=2;"
    reg3 = FakeWinreg({str(exe): (7, 4)})  # tipe aneh (DWORD) → ditimpa REG_SZ yang benar
    assert gpu_pref.prefer_high_performance(exe, reg3) == "diatur" and reg3.values[str(exe)] == ("GpuPreference=2;", 1)
    bad = FakeWinreg(fail=PermissionError(5, "Akses ditolak"))
    st = gpu_pref.prefer_high_performance(exe, bad)
    assert st.startswith("gagal:"), st
    # set_preference: tidak pernah melempar, log sekali per exe per sesi
    _records.clear()
    assert gpu_pref.set_preference(exe, bad).startswith("gagal:")
    gpu_pref.set_preference(exe, bad)
    warn = logs(logging.WARNING)
    assert len(warn) == 1 and "Settings > System > Display > Graphics" in warn[0] and "High performance" in warn[0], warn
    _records.clear()
    gpu_pref._pref_logged.clear()
    reg4 = FakeWinreg()
    gpu_pref.set_preference(exe, reg4)
    gpu_pref.set_preference(exe, reg4)
    assert len(logs()) == 1 and "performa tinggi" in logs()[0], logs()
    # winreg ditambal di sys.modules (jalur yang dipakai di laptop: prefer_high_performance(exe) tanpa argumen)
    gpu_pref.IS_WIN = True
    sys.modules["winreg"] = reg5 = FakeWinreg()
    assert gpu_pref.prefer_high_performance(exe) == "diatur" and str(exe) in reg5.values
    gpu_pref.IS_WIN = False
    assert gpu_pref.prefer_high_performance(exe) == "bukan-windows"
    return "tulis sekali, idempoten, setelan lain tetap, gagal → peringatan + langkah manual"


@test
def t_baca_hasil_cek_gpu():
    cases = [(R_NV, "nvidia", NV, "D3D11"), (R_INTEL, "intel", "Intel(R) UHD Graphics", "D3D11"), (R_AMD, "amd", "AMD Radeon(TM) Graphics", "D3D11"),
             (R_SWS, "software", "SwiftShader (CPU, tanpa GPU)", ""), (R_WARP, "software", None, "")]
    for r, kind, name, api in cases:
        out = dump_dom({"v": "Google Inc.", "r": r})
        # skrip yang ikut ter-dump tidak boleh terbaca sebagai hasil
        out = out.replace("</body>", "<script>document.getElementById('r').textContent='GPU'+'PROBE:'+JSON.stringify(o)</script></body>")
        res = gpu_pref.parse_probe(out)
        assert res["ok"] and res["kind"] == kind, (r, res)
        if name:
            assert res["name"] == name, (r, res["name"])
        assert res["api"] == api, (r, res["api"])
        assert res["renderer"] == r
    # nama berisi & (di-escape Chrome jadi &amp;)
    assert gpu_pref.parse_probe(dump_dom({"v": "x", "r": "ANGLE (NVIDIA, NVIDIA RTX A&B (0x1) Direct3D11 vs_5_0 ps_5_0, D3D11)"}))["name"] == "NVIDIA RTX A&B"
    assert gpu_pref.parse_probe(dump_dom({"err": "no-webgl"}))["kind"] == "tanpa-webgl"
    assert gpu_pref.parse_probe(dump_dom({"err": "SecurityError"}))["kind"] == "gagal"
    assert gpu_pref.parse_probe("<html><body>kosong</body></html>")["kind"] == "gagal"
    assert gpu_pref.parse_probe("")["kind"] == "gagal"
    assert gpu_pref.classify("ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.5.0 NVIDIA 535.54)") == "nvidia"
    assert gpu_pref.classify("llvmpipe (LLVM 15.0.7, 256 bits)") == "software"
    assert gpu_pref.classify("ANGLE (Intel, Mesa Intel(R) Graphics (ADL GT2), OpenGL 4.6)") == "intel"
    # isi skrip probe: memakai ekstensi debug renderer, penanda dirangkai
    assert "UNMASKED_RENDERER_WEBGL" in gpu_pref.PROBE_HTML and "WEBGL_debug_renderer_info" in gpu_pref.PROBE_HTML
    assert "GPUPROBE:" not in gpu_pref.PROBE_HTML and gpu_pref.probe_url().startswith("data:text/html")
    # laporan log: NVIDIA = info; Intel / SwiftShader = peringatan + langkah manual
    exe = Path(r"C:\repo\chrome-headless-shell.exe")
    _records.clear()
    gpu_pref.report(gpu_pref.parse_probe(dump_dom({"v": "x", "r": R_NV})), NV, exe)
    assert logs() == [f"Render memakai GPU: {NV} (ANGLE, D3D11)"], logs()
    for r in (R_INTEL, R_SWS):
        _records.clear()
        gpu_pref.report(gpu_pref.parse_probe(dump_dom({"v": "x", "r": r})), NV, exe)
        w = logs(logging.WARNING)
        assert len(w) == 1 and "Render memakai GPU:" in w[0] and "Settings > System > Display > Graphics" in w[0] and str(exe) in w[0], w
        assert "High performance" in w[0]
    _records.clear()
    gpu_pref.report(gpu_pref.parse_probe(dump_dom({"err": "no-webgl"})), NV, exe)
    assert logs(logging.WARNING) and "WebGL" in logs(logging.WARNING)[0]
    return "NVIDIA / Intel / AMD / SwiftShader / WARP / tanpa WebGL"


@test
def t_cek_gpu_chrome_palsu():
    if IS_WIN:
        return "dilewati di Windows (Chrome palsu berupa skrip sh)"
    exe = fake_chrome(TMP / "Chrome Palsu" / "chrome-headless-shell", dump_dom({"v": "Google Inc. (NVIDIA)", "r": R_NV}))
    res = gpu_pref.probe(exe)
    assert res["ok"] and res["kind"] == "nvidia" and res["name"] == NV, res
    args = Path(f"{exe}.args").read_text().splitlines()
    assert "--use-gl=angle" in args and "--dump-dom" in args and "--headless" in args, args  # flag GL sama dengan render --gl=angle
    assert args[-1].startswith("data:text/html") and any(a.startswith("--user-data-dir=") for a in args)
    ud = next(a.split("=", 1)[1] for a in args if a.startswith("--user-data-dir="))
    assert not Path(ud).exists(), "folder profil sementara harus dihapus"
    slow = fake_chrome(TMP / "Chrome Lambat" / "chrome-headless-shell", dump_dom({"v": "x", "r": R_NV}), sleep=30)
    t0 = time.time()
    res = gpu_pref.probe(slow, timeout=2)
    assert res["kind"] == "gagal" and "tidak menjawab" in res["error"] and time.time() - t0 < 15, res
    crash = fake_chrome(TMP / "Chrome Rusak" / "chrome-headless-shell", "", code=3)
    res = gpu_pref.probe(crash)
    assert res["kind"] == "gagal" and "kode 3" in res["error"], res
    res = gpu_pref.probe(TMP / "tidak-ada" / "chrome")
    assert res["kind"] == "gagal" and "tidak bisa dijalankan" in res["error"], res
    return "argumen ANGLE benar, batas waktu, Chrome rusak / tidak ada"


@test
def t_cek_gpu_chrome_headless_asli():
    # Chrome render Remotion di laptop (sudah diunduh) / chrome-headless-shell Playwright di container
    cands = [str(gpu_pref.chrome_path(REPO)), *sorted(glob.glob("/opt/pw-browsers/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell"))]
    env = os.environ.get("TES_CHROME")
    if env:
        cands.insert(0, env)
    exe = next((Path(c) for c in cands if Path(c).is_file()), None)
    if not exe:
        return "dilewati (tidak ada chrome-headless-shell; isi TES_CHROME=<path> untuk mencoba)"
    res = gpu_pref.probe(exe)  # flag render (--use-gl=angle): di laptop = GPU asli; di container tanpa GPU → tanpa WebGL / SwiftShader
    assert res["kind"] != "gagal", res
    sw = gpu_pref.probe(exe, ("--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"))  # = --gl=swangle
    assert sw["ok"] and sw["kind"] == "software" and "SwiftShader" in (sw["renderer"] or ""), sw
    return f"{exe.name}: --gl=angle → {res['kind']} {res.get('name') or res.get('error')}; swangle → {sw['renderer']} ({sw['sec']} dtk)"


@test
def t_susun_argumen_render():
    c = cfg_of()
    smi(NV)
    assert jobs_render.gpu_args(c) == ["--gl=angle", "--hardware-acceleration=if-possible", "--video-bitrate=10M"]
    assert jobs_render.gpu_args(cfg_of(render_bitrate="8M"))[-1] == "--video-bitrate=8M"
    assert jobs_render.gpu_args(cfg_of(render_gpu="off")) == []  # off = seperti dulu walau ada NVIDIA
    assert jobs_render.gpu_args(cfg_of(render_gpu="salah-ketik"))[0] == "--gl=angle"  # nilai aneh = auto
    smi(None)
    assert jobs_render.gpu_args(c) == []  # tanpa NVIDIA: argumen lama persis
    assert jobs_render.gpu_args(cfg_of(render_gpu="nvidia"))[:2] == ["--gl=angle", "--hardware-acceleration=if-possible"]  # dipaksa
    assert jobs_render.gpu_args(SimpleNamespace(repo=TMP)) == []  # cfg lama tanpa field baru: auto, tanpa NVIDIA → kosong
    assert jobs_render.gpu_args(SimpleNamespace(repo=TMP, render_gpu="nvidia"))[-1] == "--video-bitrate=5M"  # tanpa RENDER_BITRATE → 5M
    smi(NV)
    jobs_render._gpu["nvenc_bad"] = True
    jobs_render.last_probe = {"aktif": True, "kind": "nvidia"}
    assert jobs_render.gpu_args(c) == ["--gl=angle"]  # NVENC tidak bisa: encode CPU, gambar tetap ANGLE NVIDIA
    assert jobs_render.render_gpu_info()["encode"] == "cpu" and jobs_render.render_gpu_info()["gl"] == "angle"
    jobs_render.last_probe = {"aktif": True, "kind": "intel"}
    assert jobs_render.gpu_args(c) == []  # Chrome tidak terbukti di NVIDIA → persis cara lama
    jobs_render._gpu.update(nvenc_bad=False, angle_bad=True)
    assert jobs_render.gpu_args(c) == ["--hardware-acceleration=if-possible", "--video-bitrate=10M"]
    assert jobs_render.render_gpu_info()["encode"] == "nvenc" and jobs_render.render_gpu_info()["gl"] == "bawaan"
    # check() tidak berubah untuk render mati
    assert jobs_render.check(SimpleNamespace(render=False)) == (False, "render dimatikan (RENDER_ENABLED=0)")
    assert jobs_render._gpu["thread"] is None
    return "auto/nvidia/off, bitrate, NVENC tidak bisa, angle tidak bisa"


def _fake_run(script: list[tuple[int, list[str]]], raw: Path, calls: list[list[str]]):
    """run(args, limit) palsu: tiap panggilan ambil hasil berikutnya; kode 0 → raw.mp4 dibuat"""

    def run(args: list[str], limit: float):
        calls.append(list(args))
        assert limit >= 300, limit
        code, tail = script[len(calls) - 1]
        if code == 0:
            raw.write_bytes(b"mp4")
        return code, tail

    return run


@test
def t_alur_cadangan_encode_cpu():
    base = ["node", "cli.js", "render", "bundle", "StudioVideo", "raw.mp4", "--codec=h264"]
    raw = TMP / "raw.mp4"
    c = cfg_of()
    smi(NV)
    jobs_render.last_probe = {"aktif": True, "kind": "nvidia"}
    # 1. NVENC gagal (pesan NVENC) → ulang sekali tanpa GPU → berhasil; sesi ditandai NVENC tidak bisa
    raw.unlink(missing_ok=True)
    calls: list[list[str]] = []
    retried: list[int] = []
    code, _ = jobs_render.render_cli(c, base, raw, _fake_run([(1, NVENC_FAIL), (0, [])], raw, calls), lambda: retried.append(1))
    assert code == 0 and raw.exists() and len(calls) == 2 and retried == [1], calls
    assert calls[0] == [*base, "--gl=angle", "--hardware-acceleration=if-possible", "--video-bitrate=10M"]
    assert calls[1] == base  # tanpa --hardware-acceleration, --gl, --video-bitrate = cara lama (encode CPU, CRF bawaan)
    assert jobs_render._gpu["nvenc_bad"] and not jobs_render._gpu["angle_bad"]
    w = "\n".join(logs(logging.WARNING))
    assert "diulang sekali" in w and "OpenEncodeSessionEx" in w and "NVENC" in w, w
    # 2. render berikutnya langsung encode CPU (tetap --gl=angle karena Chrome terbukti NVIDIA), satu kali jalan
    raw.unlink()
    calls = []
    code, _ = jobs_render.render_cli(c, base, raw, _fake_run([(0, [])], raw, calls))
    assert code == 0 and calls == [[*base, "--gl=angle"]], calls
    # 3. --gl=angle gagal juga → ulang tanpa GPU → angle ditandai; berikutnya argumen lama persis
    raw.unlink()
    calls = []
    jobs_render.render_cli(c, base, raw, _fake_run([(1, ["GPU process crashed"]), (0, [])], raw, calls))
    assert jobs_render._gpu["angle_bad"] and calls[1] == base
    raw.unlink()
    calls = []
    jobs_render.render_cli(c, base, raw, _fake_run([(0, [])], raw, calls))
    assert calls == [base]
    # 4. gagal bukan karena GPU (error komposisi) → TIDAK dirender dua kali, NVENC tidak dimatikan
    reset()
    smi(NV)
    raw.unlink(missing_ok=True)
    calls = []
    code, tail = jobs_render.render_cli(c, base, raw, _fake_run([(1, ["Error: composition StudioVideo not found"]), (0, [])], raw, calls))
    assert code == 1 and len(calls) == 1 and not jobs_render._gpu["nvenc_bad"] and not jobs_render._gpu["angle_bad"], calls
    assert any("bukan karena GPU" in x and "tidak diulang" in x for x in logs(logging.WARNING)), logs(logging.WARNING)
    calls = []
    code, _ = jobs_render.render_cli(c, base, raw, _fake_run([(1, ["Rendered 1500/1800", "Error: A delayRender() \"Loading <Img>\" was called but not cleared after 28000ms", "at Rectangle (bundle.js:1:2)"]), (0, [])], raw, calls))
    assert code == 1 and len(calls) == 1, calls
    # 5. pesan menyebut encoder (tanpa kata NVENC) → diulang; ulangan tanpa GPU berhasil → NVENC ditandai (bukti dari ulangan)
    calls = []
    jobs_render.render_cli(c, base, raw, _fake_run([(1, ["[h264 @ 0x1] Error while opening encoder for output stream #0:0", "Error: ffmpeg quit with code 1"]), (0, [])], raw, calls))
    assert len(calls) == 2 and jobs_render._gpu["nvenc_bad"]
    # 6. tanpa NVIDIA: tidak ada argumen tambahan & tidak diulang
    reset()
    smi(None)
    raw.unlink(missing_ok=True)
    calls = []
    code, _ = jobs_render.render_cli(c, base, raw, _fake_run([(1, ["Error"]), (0, [])], raw, calls))
    assert code == 1 and calls == [base]
    # 7. batal dari website saat render GPU → tidak diulang
    smi(NV)
    calls = []

    def cancel(args, limit):
        calls.append(args)
        raise Cancelled("batal")

    try:
        jobs_render.render_cli(c, base, raw, cancel)
        raise AssertionError("Cancelled harus diteruskan")
    except Cancelled:
        pass
    assert len(calls) == 1 and not jobs_render._gpu["nvenc_bad"]
    return "ulang sekali hanya kalau error GPU, tanda per sesi, bukan-GPU tidak diulang & tidak mematikan NVENC, batal tidak diulang"


@test
def t_pola_error_gpu():
    gpu = [
        "[h264_nvenc @ 0000020c] OpenEncodeSessionEx failed: unsupported device (2): (no details)",
        "No NVENC capable devices found",
        "Error: GPU process exited unexpectedly: exit_code=34",
        "[ERROR:gpu_process_host.cc(991)] GPU process exited unexpectedly",
        "Passthrough is not supported, GL is disabled, ANGLE is",
        "WebGL context lost",
        "Failed to create D3D11 device",
        "Your graphics driver is too old",
        "CUDA_ERROR_NO_DEVICE",
        "When using hardware accelerated encoding, the option \"crf\" is not supported",
        "[h264 @ 0x1] Error while opening encoder for output stream #0:0",
        "glGetString returned NULL",
        "eglInitialize failed: EGL_NOT_INITIALIZED",
    ]
    other = [
        "Error: composition StudioVideo not found",
        "Error: A delayRender() was called but not cleared after 28000ms",
        "TypeError: Cannot read properties of undefined (reading 'angle') at Rectangle (bundle.js:1:2)",
        "at Triangle.render (bundle.js:9:9)",
        "Error: ENOENT: no such file or directory, open '/public/st/abc.mp3'",
        "Error: ffmpeg quit with code 1",
        "Rendered 1500/1800",
        "Error: Target closed",
    ]
    miss = [x for x in gpu if not jobs_render.GPU_ERR.search(x)]
    wrong = [x for x in other if jobs_render.GPU_ERR.search(x)]
    assert not miss and not wrong, (miss, wrong)
    return f"{len(gpu)} pesan GPU dikenali, {len(other)} pesan lain tidak (tidak dirender dua kali)"


@test
def t_siapkan_gpu_sekali_per_sesi():
    if IS_WIN:
        return "dilewati di Windows (Chrome palsu berupa skrip sh)"
    repo = TMP / "repo-siap"
    repo.mkdir(parents=True, exist_ok=True)
    (repo / "package.json").write_text("{}")
    c = cfg_of(repo=repo)
    exe = gpu_pref.chrome_path(repo)
    smi(NV)
    prefs: list[Path] = []
    gpu_pref.set_preference = lambda e, w=None: prefs.append(e) or "diatur"  # type: ignore[assignment]
    # dari check(): Chrome belum diunduh → tidak mengunduh, dicoba lagi nanti
    jobs_render.start_gpu_check(c)
    jobs_render._gpu["thread"].join(timeout=30)
    assert jobs_render.last_probe["status"] == "Chrome render belum diunduh" and not jobs_render._gpu["prepared"] and not prefs
    # dari job render: ensure (remotion browser ensure palsu) membuat exe → preferensi + cek GPU
    ens: list[int] = []
    p = jobs_render.prepare_gpu(c, lambda: ens.append(1) or fake_chrome(exe, dump_dom({"v": "Google Inc. (NVIDIA)", "r": R_NV})))
    assert ens == [1] and prefs == [exe] and p["kind"] == "nvidia" and p["chrome"] == NV and p["nvidia"] == NV, p
    assert jobs_render._gpu["prepared"]
    info = jobs_render.render_gpu_info()
    assert info["encode"] == "nvenc" and info["gl"] == "angle" and info["aktif"], info
    json.dumps(info)  # harus bisa dikirim lewat detak jantung
    # kedua kali: tidak ada ensure / probe / registry lagi
    exe.write_text("#!/bin/sh\nexit 1\n")
    p2 = jobs_render.prepare_gpu(c, lambda: ens.append(2))
    t_before = jobs_render._gpu["thread"]
    jobs_render.start_gpu_check(c)
    assert p2 is p and ens == [1] and prefs == [exe] and jobs_render._gpu["thread"] is t_before  # tidak ada thread baru
    # tanpa NVIDIA: dicatat, tanpa probe
    reset()
    smi(None)
    p3 = jobs_render.prepare_gpu(c, lambda: ens.append(3))
    assert p3["aktif"] is False and "tidak terdeteksi" in p3["status"] and ens == [1] and jobs_render._gpu["prepared"]
    assert jobs_render.render_gpu_info() == p3
    reset()
    p4 = jobs_render.prepare_gpu(cfg_of(repo=repo, render_gpu="off"))
    assert p4["status"] == "RENDER_GPU=off" and p4["nvidia"] is None
    # Intel: tetap dicatat + peringatan
    reset()
    smi(NV)
    gpu_pref.set_preference = lambda e, w=None: "sudah"  # type: ignore[assignment]
    fake_chrome(exe, dump_dom({"v": "Google Inc. (Intel)", "r": R_INTEL}))
    _records.clear()
    p5 = jobs_render.prepare_gpu(c)
    assert p5["kind"] == "intel" and any("BUKAN NVIDIA" in x for x in logs(logging.WARNING)), (p5, logs())
    return "check() tidak mengunduh, job render: ensure → registry → cek GPU, sekali per sesi"


class MiniSupa:
    """Supabase palsu secukupnya untuk job render"""

    def __init__(self, job: dict):
        self.job = job
        self.files: dict[str, bytes] = {}
        self.patches: list[dict] = []

    def select(self, table, **params):
        if table == "studio_render_jobs" and "status" in params.get("select", ""):
            return [{"status": self.job["status"]}]
        return []

    def update(self, table, filters, patch):
        if filters.get("id") == f"eq.{self.job['id']}" and self.job["status"] == "proses":
            self.job.update(patch)
            self.patches.append(dict(patch))
            return [dict(self.job)]
        return []

    def upload(self, path, data, content_type, timeout=0):
        self.files[path] = data.read_bytes() if isinstance(data, Path) else data
        return path

    def download(self, path, dest=None, timeout=0):
        raise FileNotFoundError(path)


@test
def t_job_render_lengkap_nvenc_gagal_lalu_cpu():
    if IS_WIN:
        return "dilewati di Windows (Chrome palsu berupa skrip sh)"
    if not shutil.which("node") or not shutil.which("ffmpeg"):
        return "dilewati (butuh node + ffmpeg untuk check())"
    repo = TMP / "repo-job"
    (repo / "remotion").mkdir(parents=True, exist_ok=True)
    (repo / "remotion" / "index.ts").write_text("// palsu")
    (repo / "node_modules" / "@remotion" / "cli").mkdir(parents=True, exist_ok=True)
    (repo / "node_modules" / "@remotion" / "cli" / "remotion-cli.js").write_text("// palsu")
    (repo / "package.json").write_text("{}")
    data = TMP / "data-job"
    c = cfg_of(repo=repo, tmp=data / "tmp")
    (data / "tmp").mkdir(parents=True, exist_ok=True)
    exe = gpu_pref.chrome_path(repo)
    smi(NV)
    gpu_pref.IS_WIN = True  # jalur Windows: preferensi GPU ditulis ke winreg palsu
    sys.modules["winreg"] = reg = FakeWinreg()
    calls: list[list[str]] = []
    mode = {"komposisi_rusak": False}
    GPU_TRY_SEC = 0.6  # lama percobaan GPU yang gagal (tidak boleh ikut perkiraan sisa & catatan kecepatan)

    def fake_cli(args, cwd, on_line, should_stop, timeout):
        calls.append(list(args))
        assert Path(cwd) == repo
        if args[2] == "bundle":
            out = Path(next(a.split("=", 1)[1] for a in args if a.startswith("--out-dir=")))
            out.mkdir(parents=True, exist_ok=True)
            (out / "index.html").write_text("<html></html>")
            on_line("Bundling 100%")
            return 0, ["Bundled"]
        if args[2:4] == ["browser", "ensure"]:
            fake_chrome(exe, dump_dom({"v": "Google Inc. (NVIDIA)", "r": R_NV}))
            return 0, [f"Has browser at {exe}"]
        if args[2] == "render":
            if mode["komposisi_rusak"]:
                on_line("Rendered 30/300")
                return 1, ["Rendered 30/300", "Error: A delayRender() \"Loading <Img>\" was called but not cleared after 28000ms"]
            if "--hardware-acceleration=if-possible" in args:
                on_line("Rendered 12/300")
                time.sleep(GPU_TRY_SEC)
                on_line("Rendered 60/300")  # perkiraan sisa sudah ada sebelum gagal
                return 1, NVENC_FAIL
            Path(args[5]).write_bytes(b"\0\0\0\x18ftypmp42")  # bukan video asli: tanpa audio → loudnorm dilewati
            on_line("Rendered 300/300")
            return 0, ["Encoded 300/300"]
        raise AssertionError(args)

    jobs_render.run_cli = fake_cli  # type: ignore[assignment]
    ok, why = jobs_render.check(c)
    assert ok, why
    jobs_render._gpu["thread"].join(timeout=30)  # check(): Chrome belum ada → tidak diunduh
    assert not calls and jobs_render.last_probe["status"] == "Chrome render belum diunduh"
    job = {"id": "r1", "status": "proses", "timeline": {"scenes": [{"id": "s1", "dur": 2}]}, "created_by": None}
    sb = MiniSupa(job)
    from studio_worker.speed import Speed

    sp = Speed(None)
    rt = Runtime(cfg=c, supa=sb, speed=sp)  # type: ignore[arg-type]
    ctx = JobCtx(rt, "studio_render_jobs", job, min_gap=0)
    asked: list[str] = []  # pesan yang DIMINTA job (pengirim progres latar menggabung kiriman: yang terbaru menang)
    left_at: dict[str, float | None] = {}  # sisa perkiraan (ctx.left) saat pesan itu diminta = yang ikut terkirim
    orig_progress = ctx.progress

    def spy(p, msg=None, force=False):
        if msg:
            asked.append(msg)
            left_at[msg] = ctx.left()
        return orig_progress(p, msg, force)

    ctx.progress = spy  # type: ignore[method-assign]
    t_job = time.monotonic()
    jobs_render.run(ctx)
    t_job = time.monotonic() - t_job
    assert job["status"] == "selesai" and job["result_path"] == "renders/r1.mp4" and "renders/r1.mp4" in sb.files, job
    # sisa waktu percobaan GPU yang gagal tidak ikut di pesan render ulang
    assert left_at.get("Merender gambar… 20%") is not None, left_at
    assert left_at["Merender ulang (encode CPU)…"] is None, left_at
    # kecepatan render tercatat (website: perkiraan render antri = detik video × ratio), tanpa waktu percobaan GPU yang gagal
    ratio = sp.summary()["engines"]["render"]["ratio"]["1"]
    wall = sp.data["render"]["r"]["1"] * 2.0  # video 2 dtk (timeline; mp4 palsu tidak bisa dibaca ffprobe)
    assert 0 < wall <= t_job - GPU_TRY_SEC + 0.05, (wall, t_job)
    kinds = [a[2] if a[2] != "browser" else "ensure" for a in calls]
    assert kinds == ["bundle", "ensure", "render", "render"], kinds
    r1, r2 = calls[2], calls[3]
    assert "--gl=angle" in r1 and "--hardware-acceleration=if-possible" in r1 and "--video-bitrate=10M" in r1, r1
    assert not any(a.startswith(("--gl", "--hardware-acceleration", "--video-bitrate")) for a in r2), r2
    assert "--codec=h264" in r2 and "--concurrency=2" in r2
    assert reg.values[str(exe)] == ("GpuPreference=2;", 1), reg.values
    msgs = [m.split(" · sisa ±")[0] for m in asked]
    assert "Menyiapkan Chrome render…" in msgs and "Merender ulang (encode CPU)…" in msgs, msgs
    assert jobs_render._gpu["nvenc_bad"] and jobs_render.render_gpu_info()["encode"] == "cpu"
    assert any(x.startswith(f"Render memakai GPU: {NV}") for x in logs())
    # job kedua di sesi yang sama: tanpa ensure & tanpa bundle (cache komposisi), langsung encode CPU (tetap ANGLE), sekali jalan
    calls.clear()
    job2 = {"id": "r2", "status": "proses", "timeline": {"scenes": [{"id": "s1", "dur": 2}]}, "created_by": None}
    sb2 = MiniSupa(job2)
    jobs_render.run(JobCtx(Runtime(cfg=c, supa=sb2, speed=sp), "studio_render_jobs", job2, min_gap=0))  # type: ignore[arg-type]
    assert job2["status"] == "selesai", job2
    assert [a[2] for a in calls] == ["render"] and "--gl=angle" in calls[0] and not any(a.startswith("--hardware") for a in calls[0]), calls
    assert len(reg.writes) == 1 and sp.data["render"]["n"] == 2
    # job ketiga: error komposisi (bukan GPU) → langsung gagal, tidak dirender dua kali
    calls.clear()
    mode["komposisi_rusak"] = True
    job3 = {"id": "r3", "status": "proses", "timeline": {"scenes": [{"id": "s1", "dur": 2}]}, "created_by": None}
    try:
        jobs_render.run(JobCtx(Runtime(cfg=c, supa=MiniSupa(job3), speed=sp), "studio_render_jobs", job3, min_gap=0))  # type: ignore[arg-type]
        raise AssertionError("harusnya JobError")
    except jobs_render.JobError as e:
        assert "Render video gagal" in str(e), e
    assert [a[2] for a in calls] == ["render"], calls
    assert sp.data["render"]["n"] == 2  # gagal → tidak dicatat
    return f"bundle → ensure → registry → NVENC gagal → ulang CPU → selesai (kecepatan render {ratio}× tercatat); job kedua langsung CPU dari cache komposisi; error komposisi tidak diulang"


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
