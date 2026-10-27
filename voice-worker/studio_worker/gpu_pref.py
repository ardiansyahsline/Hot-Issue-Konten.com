"""Render MP4 di GPU NVIDIA pada laptop hybrid (Intel + NVIDIA / Optimus, Windows).

Kenapa perlu: Remotion merender tiap frame di Chrome headless (chrome-headless-shell.exe). Windows memberi aplikasi yang tidak
dikenalnya GPU HEMAT DAYA (Intel), dan Chrome memakai adapter bawaan itu → render lambat di Intel padahal ada RTX.
Remotion tidak punya opsi argumen Chrome bebas, jadi pemilihan GPU dilakukan dari sisi Windows (tanpa hak admin, tanpa paket baru):
  1. nvidia_name()         : ada GPU NVIDIA? (nvidia-smi; torch.cuda hanya kalau torch SUDAH di-import oleh worker)
  2. chrome_path()         : path chrome-headless-shell yang dipakai Remotion 4.0.535 (dihitung persis seperti Remotion) / REMOTION_BROWSER
  3. set_preference()      : HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences  "<path exe>" = "GpuPreference=2;"
                             (sama dengan Settings > System > Display > Graphics > High performance; proses GPU Chrome = exe yang sama)
  4. probe() / report()    : jalankan exe itu dengan flag ANGLE yang sama dengan render (--use-gl=angle), baca nama GPU dari WebGL
                             (WEBGL_debug_renderer_info → UNMASKED_RENDERER_WEBGL) → log "Render memakai GPU: …"
"""
from __future__ import annotations

import html
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import quote

from . import log as vlog

log = vlog.get("render")

IS_WIN = os.name == "nt"
CHILD_FLAGS = (0x08000000 | 0x00004000) if IS_WIN else 0  # sama dengan ff.CHILD_FLAGS: tanpa jendela hitam, prioritas rendah

# ---------------------------------------------------------------- 1. ada NVIDIA?
_nv_lock = threading.Lock()
_nv: dict = {}  # {"name": str | None} — dicek sekali per sesi


def _smi_paths() -> list[str]:
    out = []
    w = shutil.which("nvidia-smi")
    if w:
        out.append(w)
    if IS_WIN:  # driver lama menaruhnya di luar PATH
        for base in (os.environ.get("SystemRoot", r"C:\Windows") + r"\System32", (os.environ.get("ProgramFiles") or r"C:\Program Files") + r"\NVIDIA Corporation\NVSMI"):
            p = os.path.join(base, "nvidia-smi.exe")
            if os.path.isfile(p) and p not in out:
                out.append(p)
    return out


def _query_smi() -> str | None:
    """nama GPU NVIDIA pertama dari nvidia-smi, None kalau tidak ada / driver bermasalah"""
    for exe in _smi_paths():
        try:
            r = subprocess.run([exe, "--query-gpu=name", "--format=csv,noheader"], capture_output=True, text=True, timeout=15, creationflags=CHILD_FLAGS)
        except (OSError, subprocess.SubprocessError):
            continue
        if r.returncode == 0:
            names = [x.strip() for x in (r.stdout or "").splitlines() if x.strip()]
            if names:
                return names[0]
    return None


def _query_torch() -> str | None:
    """hanya kalau torch SUDAH di-import (jangan memuat torch ±2 dtk hanya untuk ini)"""
    torch = sys.modules.get("torch")
    if torch is None:
        return None
    try:
        if torch.cuda.is_available():
            name = str(torch.cuda.get_device_name(0))
            return name if is_nvidia(name) else None
    except Exception:
        pass
    return None


def nvidia_name(refresh: bool = False) -> str | None:
    """nama GPU NVIDIA (mis. "NVIDIA GeForce RTX 5050 Laptop GPU") atau None. Disimpan per sesi."""
    with _nv_lock:
        if refresh or "name" not in _nv:
            _nv["name"] = _query_smi() or _query_torch()
        return _nv["name"]


def is_nvidia(s: str | None) -> bool:
    return bool(s) and bool(re.search(r"nvidia|geforce|quadro|tesla|\brtx\b|\bgtx\b", str(s), re.I))


# ---------------------------------------------------------------- 2. path Chrome Remotion
def remotion_platform(system: str | None = None, machine: str | None = None) -> str:
    """sama dengan getPlatform() di @remotion/renderer/dist/browser/BrowserFetcher.js"""
    s = system or sys.platform
    arm = (machine or platform.machine() or "").lower() in ("arm64", "aarch64")
    if s.startswith("win"):
        return "win64"
    if s.startswith("darwin"):
        return "mac-arm64" if arm else "mac-x64"
    return "linux-arm64" if arm else "linux64"


def remotion_cache_dir(cwd: Path) -> Path:
    """sama dengan getDownloadsCacheDir() (get-download-destination.js): folder package.json terdekat ke atas dari cwd
    → <folder>/node_modules/.remotion; tanpa package.json → <cwd>/.remotion. Remotion dijalankan dengan cwd = root repo."""
    d = Path(cwd)
    while True:
        if (d / "package.json").is_file():
            return d / "node_modules" / ".remotion"
        if d.parent == d:
            return Path(cwd) / ".remotion"
        d = d.parent


def chrome_path(repo: Path, browser: str = "", system: str | None = None, machine: str | None = None) -> Path:
    """exe Chrome yang dipakai `remotion render` (chromeMode headless-shell, bawaan Remotion):
    <repo>/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe
    (build Remotion sendiri bernama headless_shell → dipakai kalau ada, sama dengan getExecutablePath()). REMOTION_BROWSER menang."""
    if browser:  # path relatif dibaca Remotion dari cwd-nya = root repo
        p = Path(browser).expanduser()
        return (p if p.is_absolute() else Path(repo) / p).resolve()
    plat = remotion_platform(system, machine)
    shell = remotion_cache_dir(repo) / "chrome-headless-shell" / plat / f"chrome-headless-shell-{plat}"
    own = shell / "headless_shell"
    if own.exists():
        return own
    return shell / ("chrome-headless-shell.exe" if plat == "win64" else "chrome-headless-shell")


# ---------------------------------------------------------------- 3. preferensi GPU Windows (registry pengguna, tanpa admin)
GPU_PREF_KEY = r"Software\Microsoft\DirectX\UserGpuPreferences"
HIGH_PERF = "2"  # 0 = biar Windows, 1 = hemat daya (Intel), 2 = performa tinggi (NVIDIA)


def merge_pref(cur: str | None) -> str:
    """"SwapEffectUpgradeEnable=1;" → "SwapEffectUpgradeEnable=1;GpuPreference=2;" (setelan lain di nilai yang sama dipertahankan)"""
    pairs: list[list[str]] = []
    for part in (cur or "").split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            if k.strip():
                pairs.append([k.strip(), v.strip()])
    for p in pairs:
        if p[0].lower() == "gpupreference":
            p[1] = HIGH_PERF
            break
    else:
        pairs.append(["GpuPreference", HIGH_PERF])
    return "".join(f"{k}={v};" for k, v in pairs)


def prefer_high_performance(exe: Path, winreg_mod=None) -> str:
    """set "GpuPreference=2;" untuk exe ini. Balikan "sudah" (tidak diubah) / "diatur" / "bukan-windows" / "gagal: …".
    Idempoten: nilai yang sudah benar tidak ditulis ulang."""
    if winreg_mod is None:
        if not IS_WIN:
            return "bukan-windows"
        import winreg as winreg_mod  # type: ignore[no-redef]
    name = str(exe)
    try:
        with winreg_mod.CreateKeyEx(winreg_mod.HKEY_CURRENT_USER, GPU_PREF_KEY, 0, winreg_mod.KEY_READ | winreg_mod.KEY_SET_VALUE) as k:
            try:
                cur, typ = winreg_mod.QueryValueEx(k, name)
            except FileNotFoundError:
                cur, typ = None, None
            cur = cur if typ == winreg_mod.REG_SZ and isinstance(cur, str) else None
            new = merge_pref(cur)
            if cur == new:
                return "sudah"
            winreg_mod.SetValueEx(k, name, 0, winreg_mod.REG_SZ, new)
            return "diatur"
    except OSError as e:
        return f"gagal: {e}"


_pref_logged: set[str] = set()


def set_preference(exe: Path, winreg_mod=None) -> str:
    """prefer_high_performance + log SEKALI per exe per sesi. Tidak pernah melempar error (gagal → peringatan saja)."""
    try:
        st = prefer_high_performance(exe, winreg_mod)
    except Exception as e:  # winreg aneh / kebijakan kantor: render tetap jalan
        st = f"gagal: {e}"
    key = str(exe).lower()
    if key not in _pref_logged and st != "bukan-windows":
        _pref_logged.add(key)
        if st == "diatur":
            log.info("Chrome render diatur memakai GPU performa tinggi (NVIDIA) di pengaturan Windows: %s", exe)
        elif st == "sudah":
            log.info("Chrome render sudah diatur memakai GPU performa tinggi (NVIDIA) di Windows.")
        else:
            log.warning("Tidak bisa mengatur GPU Chrome render di Windows (%s). %s", st[7:200], manual_steps(exe))
    return st


def manual_steps(exe: Path, lead: str = "Atur manual sekali") -> str:
    return (
        f"{lead}: Settings > System > Display > Graphics > Add desktop app (Browse) > pilih "
        f"{exe} > Options > High performance (NVIDIA) > Save, lalu nyalakan ulang worker."
    )


# ---------------------------------------------------------------- 4. GPU yang benar-benar dipakai Chrome
# skrip ditulis ke DOM lalu dibaca lewat --dump-dom. Penanda dirangkai di JS ('GPU'+'PROBE:') supaya teks skrip sendiri
# (ikut ter-dump kalau tidak terhapus) tidak terbaca sebagai hasil.
PROBE_HTML = (
    "<!doctype html><html><body><pre id=r></pre><script>"
    "var o={};try{var c=document.createElement('canvas');"
    "var g=c.getContext('webgl2')||c.getContext('webgl')||c.getContext('experimental-webgl');"
    "if(!g){o.err='no-webgl'}else{var e=g.getExtension('WEBGL_debug_renderer_info');"
    "o.v=String(e?g.getParameter(e.UNMASKED_VENDOR_WEBGL):g.getParameter(g.VENDOR));"
    "o.r=String(e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER));}}catch(x){o.err=String(x)}"
    "document.getElementById('r').textContent='GPU'+'PROBE:'+JSON.stringify(o)+':GPU'+'PROBE';"
    "try{document.currentScript.remove()}catch(x){}"
    "</script></body></html>"
)
PROBE_RE = re.compile(r"GPUPROBE:(\{.*?\}):GPUPROBE", re.S)
# flag render Remotion --gl=angle (getOpenGlRenderer: ['--use-gl=angle']) + flag Remotion lain yang memengaruhi GPU
RENDER_GL_FLAGS = ("--use-gl=angle",)
BASE_FLAGS = ("--headless", "--ignore-gpu-blocklist", "--no-sandbox", "--no-first-run", "--disable-extensions", "--mute-audio",
              "--disable-background-networking", "--disable-component-update", "--disable-sync", "--hide-scrollbars")


def probe_url() -> str:
    return "data:text/html;charset=utf-8," + quote(PROBE_HTML, safe="")


def classify(renderer: str | None, vendor: str | None = None) -> str:
    """"nvidia" / "intel" / "amd" / "apple" / "software" (SwiftShader/llvmpipe = CPU) / "lain" / "tanpa-webgl" """
    s = f"{renderer or ''} {vendor or ''}".lower()
    if not s.strip():
        return "tanpa-webgl"
    if re.search(r"swiftshader|llvmpipe|softpipe|software|basic render|subzero", s):
        return "software"
    if is_nvidia(s):
        return "nvidia"
    if "intel" in s:
        return "intel"
    if re.search(r"\bamd\b|radeon|\bati\b", s):
        return "amd"
    if "apple" in s:
        return "apple"
    return "lain"


ANGLE_RE = re.compile(r"^ANGLE \((?P<vendor>[^,]+), (?P<dev>.+), (?P<api>[^,]+)\)$")


def gpu_name(renderer: str | None) -> tuple[str, str]:
    """"ANGLE (NVIDIA, NVIDIA GeForce RTX 5050 Laptop GPU (0x00002D98) Direct3D11 vs_5_0 ps_5_0, D3D11)"
    → ("NVIDIA GeForce RTX 5050 Laptop GPU", "D3D11")"""
    r = (renderer or "").strip()
    if not r:
        return "", ""
    if classify(r) == "software":
        return "SwiftShader (CPU, tanpa GPU)" if "swiftshader" in r.lower() else f"{r} (CPU, tanpa GPU)", ""
    m = ANGLE_RE.match(r)
    if not m:
        return r, ""
    dev = re.sub(r"\s*\(0x[0-9A-Fa-f]+\).*$", "", m.group("dev")).strip()
    dev = re.sub(r"\s+Direct3D\s*\d+.*$", "", dev).strip()
    return dev or m.group("dev").strip(), m.group("api").strip()


def parse_probe(out: str) -> dict:
    """output --dump-dom → {"ok", "kind", "name", "api", "renderer", "vendor", "error"}"""
    m = PROBE_RE.search(html.unescape(out or ""))
    if not m:
        return {"ok": False, "kind": "gagal", "name": "", "api": "", "renderer": None, "vendor": None, "error": "output Chrome tidak berisi hasil cek"}
    try:
        d = json.loads(m.group(1))
    except ValueError as e:
        return {"ok": False, "kind": "gagal", "name": "", "api": "", "renderer": None, "vendor": None, "error": f"hasil cek rusak ({e})"}
    if d.get("err"):
        kind = "tanpa-webgl" if d["err"] == "no-webgl" else "gagal"
        return {"ok": False, "kind": kind, "name": "", "api": "", "renderer": None, "vendor": None, "error": str(d["err"])[:200]}
    r, v = d.get("r") or "", d.get("v") or ""
    name, api = gpu_name(r)
    return {"ok": True, "kind": classify(r, v), "name": name, "api": api, "renderer": r, "vendor": v, "error": None}


def _kill_tree(p: subprocess.Popen) -> None:
    """Chrome + proses anaknya (GPU, renderer) — kalau hanya induknya yang dimatikan, anaknya menahan pipa output"""
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)], capture_output=True, timeout=30, creationflags=CHILD_FLAGS)
        else:
            import signal

            os.killpg(p.pid, signal.SIGKILL)  # Popen(start_new_session=True) → satu grup proses
    except Exception:
        try:
            p.kill()
        except Exception:
            pass


def probe(exe: Path, flags: tuple[str, ...] | list[str] = RENDER_GL_FLAGS, timeout: float = 20.0) -> dict:
    """jalankan Chrome render (headless) dengan flag GL render, baca GPU WebGL. Tidak pernah melempar error."""
    t0 = time.time()
    ud = Path(tempfile.mkdtemp(prefix="vw-gpucek-"))
    args = [str(exe), *BASE_FLAGS, *flags, f"--user-data-dir={ud}", "--dump-dom", probe_url()]
    res: dict
    try:
        p = subprocess.Popen(
            args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, creationflags=CHILD_FLAGS, start_new_session=os.name != "nt"
        )
        try:
            out, err = p.communicate(timeout=timeout)
            res = parse_probe(out.decode("utf-8", "replace"))
            if res["kind"] == "gagal" and p.returncode:
                tail = [x for x in err.decode("utf-8", "replace").splitlines() if x.strip()][-1:]
                res["error"] = f"Chrome keluar dengan kode {p.returncode}" + (f": {tail[0][:160]}" if tail else "")
        except subprocess.TimeoutExpired:
            _kill_tree(p)
            try:
                p.communicate(timeout=5)
            except Exception:
                pass
            res = {"ok": False, "kind": "gagal", "name": "", "api": "", "renderer": None, "vendor": None, "error": f"Chrome tidak menjawab dalam {timeout:.0f} dtk"}
    except OSError as e:
        res = {"ok": False, "kind": "gagal", "name": "", "api": "", "renderer": None, "vendor": None, "error": f"Chrome tidak bisa dijalankan ({e})"}
    finally:
        shutil.rmtree(ud, ignore_errors=True)
    res["sec"] = round(time.time() - t0, 1)
    res["exe"] = str(exe)
    return res


def report(res: dict, nvidia: str | None, exe: Path) -> None:
    """log hasil probe: info kalau NVIDIA, peringatan jelas (dengan langkah manual) kalau masih Intel / SwiftShader / gagal"""
    kind, name = res.get("kind"), res.get("name") or res.get("renderer") or "?"
    api = f", {res['api']}" if res.get("api") else ""
    if kind == "nvidia":
        log.info("Render memakai GPU: %s (ANGLE%s)", name, api)
        return
    if kind in ("intel", "amd", "apple", "lain"):
        log.warning("Render memakai GPU: %s (ANGLE%s) — BUKAN NVIDIA%s. Render tetap jalan, tapi lebih lambat. %s",
                    name, api, f" ({nvidia})" if nvidia else "", manual_steps(exe))
        return
    if kind == "software":
        log.warning("Render memakai GPU: %s — Chrome render tidak memakai GPU sama sekali. Update driver NVIDIA (≥ 570), lalu %s",
                    name, manual_steps(exe, "atur manual sekali"))
        return
    if kind == "tanpa-webgl":
        log.warning("Chrome render tidak bisa membuka WebGL dengan GPU (--gl=angle). Render tetap jalan (gambar dihitung CPU). "
                    "Update driver NVIDIA (≥ 570), lalu %s", manual_steps(exe, "atur manual sekali"))
        return
    log.warning("Cek GPU Chrome render gagal (%s) — render tetap jalan.", res.get("error") or "?")
